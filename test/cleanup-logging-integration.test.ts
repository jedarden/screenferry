/**
 * Integration tests for cleanup logging with actual storage operations.
 *
 * Verifies that cleanup operations produce comprehensive, queryable logs
 * and metrics that can be inspected for debugging and monitoring.
 *
 * Reference: bead bf-4pmk
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CleanupLogger, LogLevel, formatCleanupMetricsSummary } from '../src/platform/cleanup-logger.js';

describe('Cleanup Logging Integration', () => {
  describe('Queryable and Verifiable Metrics', () => {
    it('provides queryable logs after cleanup operation', () => {
      const logger = new CleanupLogger('test-cleanup');

      // Simulate a realistic cleanup operation
      logger.info('Starting cleanup', { directory: '/test' });
      logger.incrementFilesScanned(100);

      for (let i = 0; i < 10; i++) {
        logger.incrementOrphansIdentified();

        if (i < 8) {
          logger.incrementDeletionsSucceeded();
          logger.debug('Deletion succeeded', { streamId: 100 + i });
        } else {
          logger.incrementDeletionsFailed();
          const errorMsg = `Permission denied for file ${i}`;
          logger.error('Deletion failed', { streamId: 100 + i, error: errorMsg });
          logger.recordError(100 + i, `file-${i}.dat`, errorMsg);
        }
      }

      const metrics = logger.complete();

      // Verify metrics are queryable
      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(8);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors.length).toBe(2);
      expect(metrics.duration).toBeGreaterThanOrEqual(0);

      // Verify logs are queryable
      const allLogs = logger.getLogs();
      expect(allLogs.length).toBeGreaterThan(0);

      // Verify filtering by level works
      const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);
      expect(errorLogs.length).toBe(2);

      const debugLogs = logger.getLogsByLevel(LogLevel.DEBUG);
      expect(debugLogs.length).toBeGreaterThan(0);

      // Verify time range filtering
      const startTime = allLogs[0].timestamp;
      const endTime = allLogs[allLogs.length - 1].timestamp;
      const filteredLogs = logger.getLogsByTimeRange(startTime, endTime);
      expect(filteredLogs.length).toBeGreaterThan(0);
    });

    it('captures structured data in log entries', () => {
      const logger = new CleanupLogger('structured-test');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('Operation started', {
        cleanupType: 'orphan-removal',
        directory: '/test/path',
        maxAge: 86400000,
        activeStreamIds: [100, 200, 300],
      });

      const logs = logger.getLogs();
      // Find the explicit log entry, not the automatic start log
      const logEntry = logs.find(log => log.message === 'Operation started');
      expect(logEntry).toBeDefined();

      // Verify required fields
      expect(logEntry!.level).toBe(LogLevel.INFO);
      expect(logEntry!.timestamp).toBeDefined();
      expect(logEntry!.operation).toBe('structured-test');
      expect(logEntry!.message).toBe('Operation started');

      // Verify custom data is preserved
      expect(logEntry!.cleanupType).toBe('orphan-removal');
      expect(logEntry!.directory).toBe('/test/path');
      expect(logEntry!.maxAge).toBe(86400000);
      expect(logEntry!.activeStreamIds).toEqual([100, 200, 300]);

      // Verify console output includes JSON
      expect(logSpy).toHaveBeenCalled();
      const callArgs = logSpy.mock.calls[0];
      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.cleanupType).toBe('orphan-removal');
      expect(loggedJson.directory).toBe('/test/path');

      logSpy.mockRestore();
    });

    it('generates human-readable metrics summary', () => {
      const metrics = {
        startTime: '2024-01-15T10:30:00.000Z',
        endTime: '2024-01-15T10:30:05.500Z',
        duration: 5500,
        filesScanned: 250,
        orphansIdentified: 15,
        deletionsSucceeded: 12,
        deletionsFailed: 3,
        errors: [
          { streamId: 101, filename: 'corrupt1.dat', error: 'Permission denied', timestamp: '2024-01-15T10:30:02.000Z' },
          { streamId: 102, filename: 'corrupt2.dat', error: 'File locked', timestamp: '2024-01-15T10:30:03.000Z' },
          { streamId: 103, filename: 'corrupt3.dat', error: 'I/O error', timestamp: '2024-01-15T10:30:04.000Z' },
        ],
      };

      const summary = formatCleanupMetricsSummary(metrics);

      // Verify all key information is present
      expect(summary).toContain('Cleanup Metrics Summary');
      expect(summary).toContain('Duration: 5500.00ms');
      expect(summary).toContain('Files scanned: 250');
      expect(summary).toContain('Orphans identified: 15');
      expect(summary).toContain('Deletions succeeded: 12');
      expect(summary).toContain('Deletions failed: 3');
      expect(summary).toContain('Errors:');
      expect(summary).toContain('corrupt1.dat (101): Permission denied');
      expect(summary).toContain('corrupt2.dat (102): File locked');
      expect(summary).toContain('corrupt3.dat (103): I/O error');
    });

    it('tracks timing information for performance monitoring', async () => {
      const logger = new CleanupLogger('timing-test');

      // Simulate some work
      logger.info('Starting operation');
      await new Promise(resolve => setTimeout(resolve, 10));
      logger.incrementFilesScanned(50);
      await new Promise(resolve => setTimeout(resolve, 10));
      logger.incrementOrphansIdentified(5);
      await new Promise(resolve => setTimeout(resolve, 10));

      const metrics = logger.complete();

      // Verify timing is captured
      expect(metrics.startTime).toBeDefined();
      expect(metrics.endTime).toBeDefined();
      expect(metrics.duration).toBeGreaterThanOrEqual(30); // At least 30ms of delays
      expect(metrics.duration).toBeLessThan(500); // Should complete within 500ms

      // Verify timestamps are valid ISO 8601
      expect(metrics.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(metrics.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('provides filterable logs for debugging', () => {
      const logger = new CleanupLogger('filterable-test');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Generate various log levels
      logger.debug('Debug message 1');
      logger.info('Info message 1');
      logger.warn('Warning message 1');
      logger.error('Error message 1');
      logger.info('Info message 2');
      logger.error('Error message 2');

      // Verify all logs are captured (including automatic start log)
      const allLogs = logger.getLogs();
      expect(allLogs.length).toBe(7); // start log + 6 explicit logs

      // Verify filtering by level
      const debugLogs = logger.getLogsByLevel(LogLevel.DEBUG);
      expect(debugLogs.length).toBe(1);

      const infoLogs = logger.getLogsByLevel(LogLevel.INFO);
      expect(infoLogs.length).toBe(3); // start log + 2 explicit logs

      const warnLogs = logger.getLogsByLevel(LogLevel.WARN);
      expect(warnLogs.length).toBe(1);

      const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);
      expect(errorLogs.length).toBe(2);

      // Verify filtering by time range
      if (allLogs.length >= 2) {
        const startTime = allLogs[1].timestamp;
        const endTime = allLogs[4].timestamp;
        const timeFilteredLogs = logger.getLogsByTimeRange(startTime, endTime);
        expect(timeFilteredLogs.length).toBeGreaterThanOrEqual(2);
      }

      // Verify console output routing
      expect(consoleSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('handles operations with no errors gracefully', () => {
      const logger = new CleanupLogger('no-errors-test');

      logger.info('Starting operation');
      logger.incrementFilesScanned(100);
      logger.incrementOrphansIdentified(10);
      logger.incrementDeletionsSucceeded(10);

      const metrics = logger.complete();

      // Verify all metrics are present
      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(10);
      expect(metrics.deletionsFailed).toBe(0);
      expect(metrics.errors).toEqual([]);

      // Verify formatting handles empty errors
      const summary = formatCleanupMetricsSummary(metrics);
      expect(summary).toContain('Deletions failed: 0');
      expect(summary).not.toContain('Errors:');
    });

    it('handles operations with all failures', () => {
      const logger = new CleanupLogger('all-failures-test');

      logger.info('Starting operation');
      logger.incrementFilesScanned(10);
      logger.incrementOrphansIdentified(5);
      logger.incrementDeletionsFailed(5);

      for (let i = 0; i < 5; i++) {
        logger.recordError(100 + i, `file-${i}.dat`, `Deletion failed ${i}`);
      }

      const metrics = logger.complete();

      expect(metrics.deletionsSucceeded).toBe(0);
      expect(metrics.deletionsFailed).toBe(5);
      expect(metrics.errors.length).toBe(5);

      // Verify summary shows all failures
      const summary = formatCleanupMetricsSummary(metrics);
      expect(summary).toContain('Deletions succeeded: 0');
      expect(summary).toContain('Deletions failed: 5');
      expect(summary).toContain('Errors:');
    });
  });

  describe('Realistic Cleanup Scenarios', () => {
    it('handles large-scale cleanup operation', () => {
      const logger = new CleanupLogger('large-scale-test');

      logger.info('Starting large-scale cleanup', { directory: '/large-test' });
      logger.incrementFilesScanned(10000);

      // Simulate finding 500 orphans
      logger.incrementOrphansIdentified(500);

      // Simulate successful deletions
      logger.incrementDeletionsSucceeded(485);

      // Simulate 15 failures with different error types
      const errorTypes = [
        'Permission denied',
        'File not found',
        'I/O error',
        'File locked',
        'Disk full',
      ];

      for (let i = 0; i < 15; i++) {
        const streamId = 1000 + i;
        const filename = `orphan-${i}.dat`;
        const error = errorTypes[i % errorTypes.length];
        logger.incrementDeletionsFailed();
        logger.error('Deletion failed', { streamId, filename, error });
        logger.recordError(streamId, filename, error);
      }

      const metrics = logger.complete();

      // Verify metrics are accurate
      expect(metrics.filesScanned).toBe(10000);
      expect(metrics.orphansIdentified).toBe(500);
      expect(metrics.deletionsSucceeded).toBe(485);
      expect(metrics.deletionsFailed).toBe(15);
      expect(metrics.errors.length).toBe(15);

      // Verify logs contain all operations
      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThan(0);

      // Verify error logs are queryable
      const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);
      expect(errorLogs.length).toBe(15);
    });

    it('handles rapid cleanup operation', async () => {
      const logger = new CleanupLogger('rapid-test');

      logger.info('Starting rapid cleanup');

      // Rapid operations
      for (let i = 0; i < 100; i++) {
        logger.incrementFilesScanned();
        if (i % 10 === 0) {
          logger.incrementOrphansIdentified();
          logger.incrementDeletionsSucceeded();
          logger.debug(`Processed file ${i}`, { index: i });
        }
      }

      const metrics = logger.complete();

      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(10);
      expect(metrics.deletionsFailed).toBe(0);

      // Verify all debug logs were captured
      const debugLogs = logger.getLogsByLevel(LogLevel.DEBUG);
      expect(debugLogs.length).toBe(10);
    });
  });
});

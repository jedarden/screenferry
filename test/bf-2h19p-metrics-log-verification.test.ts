/**
 * Metrics log verification test.
 *
 * Tests verify that metrics log is emitted with all required counts
 * when cleanup operations complete.
 *
 * Reference: bead bf-2h19p
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CleanupLogger, formatCleanupMetricsSummary, LogLevel, CleanupMetrics } from '../src/platform/cleanup-logger.js';

describe('bf-2h19p: metrics log verification', () => {
  let logger: CleanupLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new CleanupLogger('metrics-test');
  });

  describe('metrics log emission', () => {
    it('verifies metrics log is emitted with all required count fields', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Simulate cleanup operations
      logger.incrementFilesScanned(100);
      logger.incrementOrphansIdentified(10);
      logger.incrementDeletionsSucceeded(8);
      logger.incrementDeletionsFailed(2);

      const metrics = logger.complete();
      const logs = logger.getLogs();
      const completionLog = logs.find(log => log.message === 'Cleanup operation completed');

      // Verify completion log exists
      expect(completionLog).toBeDefined();
      expect(completionLog!.level).toBe(LogLevel.INFO);

      // Verify all required count fields are present in the log
      expect(completionLog!.filesScanned).toBeDefined();
      expect(completionLog!.filesScanned).toBe(100);
      expect(completionLog!.orphansIdentified).toBeDefined();
      expect(completionLog!.orphansIdentified).toBe(10);
      expect(completionLog!.deletionsSucceeded).toBeDefined();
      expect(completionLog!.deletionsSucceeded).toBe(8);
      expect(completionLog!.deletionsFailed).toBeDefined();
      expect(completionLog!.deletionsFailed).toBe(2);
      expect(completionLog!.errorCount).toBeDefined();
      expect(completionLog!.errorCount).toBe(0);

      // Verify console output includes all counts
      expect(logSpy).toHaveBeenCalled();
      const completionCallArgs = logSpy.mock.calls.find(call =>
        call[1] && JSON.parse(call[1] as string).message === 'Cleanup operation completed'
      );
      expect(completionCallArgs).toBeDefined();

      const loggedJson = JSON.parse(completionCallArgs![1] as string);
      expect(loggedJson.filesScanned).toBe(100);
      expect(loggedJson.orphansIdentified).toBe(10);
      expect(loggedJson.deletionsSucceeded).toBe(8);
      expect(loggedJson.deletionsFailed).toBe(2);
      expect(loggedJson.errorCount).toBe(0);
    });

    it('verifies metrics log includes error count when errors exist', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.incrementFilesScanned(50);
      logger.incrementOrphansIdentified(5);
      logger.incrementDeletionsSucceeded(3);
      logger.incrementDeletionsFailed(2);
      logger.recordError(123, 'file1.dat', 'Permission denied', 'PermissionError');
      logger.recordError(456, 'file2.bin', 'Not found', 'NotFoundError');

      const metrics = logger.complete();
      const logs = logger.getLogs();
      const completionLog = logs.find(log => log.message === 'Cleanup operation completed');

      expect(completionLog).toBeDefined();
      expect(completionLog!.errorCount).toBe(2);
      expect(completionLog!.filesScanned).toBe(50);
      expect(completionLog!.orphansIdentified).toBe(5);
      expect(completionLog!.deletionsSucceeded).toBe(3);
      expect(completionLog!.deletionsFailed).toBe(2);

      // Verify console output includes error count
      const loggedJson = JSON.parse(logSpy.mock.calls.find(call =>
        call[1] && JSON.parse(call[1] as string).message === 'Cleanup operation completed'
      )![1] as string);
      expect(loggedJson.errorCount).toBe(2);
    });

    it('verifies metrics object structure is complete and queryable', () => {
      logger.incrementFilesScanned(25);
      logger.incrementOrphansIdentified(7);
      logger.incrementDeletionsSucceeded(5);
      logger.incrementDeletionsFailed(2);
      logger.recordError(1, 'fail1.dat', 'Error 1', 'ErrorType1');
      logger.recordError(2, 'fail2.dat', 'Error 2', 'ErrorType2');

      const metrics = logger.complete();

      // Verify CleanupMetrics interface compliance
      expect(metrics).toMatchObject<CleanupMetrics>({
        startTime: expect.any(String),
        endTime: expect.any(String),
        duration: expect.any(Number),
        filesScanned: 25,
        orphansIdentified: 7,
        deletionsSucceeded: 5,
        deletionsFailed: 2,
        errors: expect.any(Array),
      });

      // Verify individual error objects are queryable
      expect(metrics.errors).toHaveLength(2);
      expect(metrics.errors[0]).toMatchObject({
        streamId: 1,
        filename: 'fail1.dat',
        error: 'Error 1',
        errorType: 'ErrorType1',
        timestamp: expect.any(String),
      });

      // Verify timestamps are valid ISO format
      expect(metrics.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(metrics.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify duration is reasonable
      expect(metrics.duration).toBeGreaterThanOrEqual(0);
      expect(metrics.duration).toBeLessThan(10000); // Should complete in under 10s
    });

    it('verifies metrics log with zero values is still complete', () => {
      logger.incrementFilesScanned(0);
      logger.incrementOrphansIdentified(0);
      logger.incrementDeletionsSucceeded(0);
      logger.incrementDeletionsFailed(0);

      const metrics = logger.complete();
      const logs = logger.getLogs();
      const completionLog = logs.find(log => log.message === 'Cleanup operation completed');

      expect(completionLog).toBeDefined();
      expect(completionLog!.filesScanned).toBe(0);
      expect(completionLog!.orphansIdentified).toBe(0);
      expect(completionLog!.deletionsSucceeded).toBe(0);
      expect(completionLog!.deletionsFailed).toBe(0);
      expect(completionLog!.errorCount).toBe(0);
    });
  });

  describe('metrics queryability', () => {
    it('verifies metrics can be queried by individual count fields', () => {
      logger.incrementFilesScanned(100);
      logger.incrementOrphansIdentified(15);
      logger.incrementDeletionsSucceeded(12);
      logger.incrementDeletionsFailed(3);
      logger.recordError(1, 'file1.dat', 'Error 1');
      logger.recordError(2, 'file2.dat', 'Error 2');
      logger.recordError(3, 'file3.dat', 'Error 3');

      const metrics = logger.complete();

      // Query by individual count fields
      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(15);
      expect(metrics.deletionsSucceeded).toBe(12);
      expect(metrics.deletionsFailed).toBe(3);

      // Query errors by count
      expect(metrics.errors).toHaveLength(3);

      // Query errors by filtering
      const file1Errors = metrics.errors.filter(e => e.filename === 'file1.dat');
      expect(file1Errors).toHaveLength(1);
    });

    it('verifies metrics can be queried by error type', () => {
      logger.recordError(1, 'file1.dat', 'Error 1', 'PermissionError');
      logger.recordError(2, 'file2.dat', 'Error 2', 'NotFoundError');
      logger.recordError(3, 'file3.dat', 'Error 3', 'PermissionError');
      logger.recordError(4, 'file4.dat', 'Error 4', 'NetworkError');

      const metrics = logger.complete();

      // Query by error type
      const permissionErrors = metrics.errors.filter(e => e.errorType === 'PermissionError');
      const notFoundErrors = metrics.errors.filter(e => e.errorType === 'NotFoundError');
      const networkErrors = metrics.errors.filter(e => e.errorType === 'NetworkError');

      expect(permissionErrors).toHaveLength(2);
      expect(notFoundErrors).toHaveLength(1);
      expect(networkErrors).toHaveLength(1);
    });

    it('verifies metrics can be queried by stream ID', () => {
      logger.recordError(100, 'file1.dat', 'Error 1', 'ErrorType1');
      logger.recordError(200, 'file2.dat', 'Error 2', 'ErrorType2');
      logger.recordError(100, 'file3.dat', 'Error 3', 'ErrorType3');

      const metrics = logger.complete();

      // Query by stream ID
      const stream100Errors = metrics.errors.filter(e => e.streamId === 100);
      const stream200Errors = metrics.errors.filter(e => e.streamId === 200);

      expect(stream100Errors).toHaveLength(2);
      expect(stream200Errors).toHaveLength(1);
    });
  });

  describe('formatCleanupMetricsSummary verification', () => {
    it('verifies formatted output contains all required count information', () => {
      const metrics: CleanupMetrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:05.500Z',
        duration: 5500,
        filesScanned: 200,
        orphansIdentified: 15,
        deletionsSucceeded: 12,
        deletionsFailed: 3,
        errors: [
          { streamId: 1, filename: 'file1.dat', error: 'Error 1', errorType: 'ErrorType1', timestamp: '2024-01-01T10:00:01.000Z' },
          { streamId: 2, filename: 'file2.dat', error: 'Error 2', errorType: 'ErrorType2', timestamp: '2024-01-01T10:00:02.000Z' },
          { streamId: 3, filename: 'file3.dat', error: 'Error 3', errorType: 'ErrorType3', timestamp: '2024-01-01T10:00:03.000Z' },
        ],
      };

      const formatted = formatCleanupMetricsSummary(metrics);

      // Verify all counts are present in formatted output
      expect(formatted).toContain('Files scanned: 200');
      expect(formatted).toContain('Orphans identified: 15');
      expect(formatted).toContain('Deletions succeeded: 12');
      expect(formatted).toContain('Deletions failed: 3');

      // Verify timing information
      expect(formatted).toContain('5500.00ms');
      expect(formatted).toContain('2024-01-01T10:00:00.000Z');
      expect(formatted).toContain('2024-01-01T10:00:05.500Z');

      // Verify errors section with all details
      expect(formatted).toContain('Errors:');
      expect(formatted).toContain('[ErrorType1] Error 1');
      expect(formatted).toContain('[ErrorType2] Error 2');
      expect(formatted).toContain('[ErrorType3] Error 3');
      expect(formatted).toContain('file1.dat (1)');
      expect(formatted).toContain('file2.dat (2)');
      expect(formatted).toContain('file3.dat (3)');
    });

    it('verifies formatted output handles zero count values', () => {
      const zeroMetrics: CleanupMetrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:00.050Z',
        duration: 50,
        filesScanned: 0,
        orphansIdentified: 0,
        deletionsSucceeded: 0,
        deletionsFailed: 0,
        errors: [],
      };

      const formatted = formatCleanupMetricsSummary(zeroMetrics);

      expect(formatted).toContain('Files scanned: 0');
      expect(formatted).toContain('Orphans identified: 0');
      expect(formatted).toContain('Deletions succeeded: 0');
      expect(formatted).toContain('Deletions failed: 0');
      expect(formatted).not.toContain('Errors:');
    });
  });

  describe('integration: full metrics workflow', () => {
    it('verifies complete metrics workflow from operation to queryable result', async () => {
      const workflowLogger = new CleanupLogger('metrics-workflow-test');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Simulate realistic cleanup workflow
      workflowLogger.info('Starting orphan scan', { directory: '/tmp/test' });
      workflowLogger.incrementFilesScanned(150);

      workflowLogger.incrementOrphansIdentified(12);
      workflowLogger.info('Orphans found', { count: 12 });

      // Simulate mixed success/failure deletions
      for (let i = 0; i < 12; i++) {
        if (i < 10) {
          workflowLogger.incrementDeletionsSucceeded();
          workflowLogger.debug(`Deleted stream ${100 + i}`, { streamId: 100 + i });
        } else {
          workflowLogger.incrementDeletionsFailed();
          const error = i === 10 ? 'Permission denied' : 'File not found';
          const errorType = i === 10 ? 'PermissionError' : 'NotFoundError';
          workflowLogger.error('Deletion failed', {
            streamId: 100 + i,
            filename: `file-${i}.dat`,
            error,
            errorType,
          });
          workflowLogger.recordError(100 + i, `file-${i}.dat`, error, errorType);
        }
      }

      const metrics = workflowLogger.complete();
      const logs = workflowLogger.getLogs();

      // Verify metrics object is complete
      expect(metrics.filesScanned).toBe(150);
      expect(metrics.orphansIdentified).toBe(12);
      expect(metrics.deletionsSucceeded).toBe(10);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors).toHaveLength(2);
      expect(metrics.duration).toBeGreaterThanOrEqual(0);

      // Verify completion log with all counts
      const completionLog = logs.find(l => l.message === 'Cleanup operation completed');
      expect(completionLog).toBeDefined();
      expect(completionLog!.filesScanned).toBe(150);
      expect(completionLog!.orphansIdentified).toBe(12);
      expect(completionLog!.deletionsSucceeded).toBe(10);
      expect(completionLog!.deletionsFailed).toBe(2);
      expect(completionLog!.errorCount).toBe(2);

      // Verify console output was called
      expect(logSpy).toHaveBeenCalled();

      // Verify queryability
      const permissionErrors = metrics.errors.filter(e => e.errorType === 'PermissionError');
      const notFoundErrors = metrics.errors.filter(e => e.errorType === 'NotFoundError');
      expect(permissionErrors).toHaveLength(1);
      expect(notFoundErrors).toHaveLength(1);
    });
  });
});

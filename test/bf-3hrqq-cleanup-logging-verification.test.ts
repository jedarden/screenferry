/**
 * Cleanup logging verification tests.
 *
 * Tests verify that cleanup logging output is complete, structured, and queryable.
 * Focuses on verification of log emissions, metrics completeness, and error logging.
 *
 * Reference: bead bf-3hrqq
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CleanupLogger, formatCleanupMetricsSummary, LogLevel, CleanupMetrics, CleanupLogEntry } from '../src/platform/cleanup-logger.js';

describe('bf-3hrqq: cleanup logging verification', () => {
  let logger: CleanupLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new CleanupLogger('verification-test');
  });

  describe('cleanup start log emission', () => {
    it('verifies cleanup start log is emitted with required fields', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger = new CleanupLogger('test-cleanup');

      const logs = logger.getLogs();
      const startLog = logs.find(log => log.message === 'Cleanup operation started');

      expect(startLog).toBeDefined();
      expect(startLog!.level).toBe(LogLevel.INFO);
      expect(startLog!.operation).toBe('test-cleanup');
      expect(startLog!.startTime).toBeDefined();
      expect(startLog!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify console output
      expect(logSpy).toHaveBeenCalled();
      const callArgs = logSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[Cleanup:test-cleanup]');

      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.message).toBe('Cleanup operation started');
      expect(loggedJson.operation).toBe('test-cleanup');
      expect(loggedJson.startTime).toBeDefined();
    });

    it('verifies start log is queryable by level filter', () => {
      logger = new CleanupLogger('queryable-start');

      const infoLogs = logger.getLogsByLevel(LogLevel.INFO);
      const startLogs = infoLogs.filter(log => log.message === 'Cleanup operation started');

      expect(startLogs).toHaveLength(1);
      expect(startLogs[0].operation).toBe('queryable-start');
      expect(startLogs[0].startTime).toBeDefined();
    });

    it('verifies start log timestamp is valid ISO 8601 format', () => {
      logger = new CleanupLogger('timestamp-verification');

      const logs = logger.getLogs();
      const startLog = logs.find(log => log.message === 'Cleanup operation started');

      expect(startLog).toBeDefined();
      expect(startLog!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify it's parseable
      const date = new Date(startLog!.timestamp);
      expect(date.toISOString()).toBe(startLog!.timestamp);
    });

    it('verifies multiple operations create distinct start logs', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const logger1 = new CleanupLogger('operation-1');
      await new Promise(resolve => setTimeout(resolve, 5)); // Small delay to ensure different timestamps
      const logger2 = new CleanupLogger('operation-2');

      const logs1 = logger1.getLogs();
      const logs2 = logger2.getLogs();

      const startLog1 = logs1.find(log => log.message === 'Cleanup operation started');
      const startLog2 = logs2.find(log => log.message === 'Cleanup operation started');

      expect(startLog1!.operation).toBe('operation-1');
      expect(startLog2!.operation).toBe('operation-2');
      expect(startLog1!.timestamp).not.toBe(startLog2!.timestamp);

      // Verify both were logged to console
      expect(logSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('metrics log completeness verification', () => {
    it('verifies metrics log contains all required count fields', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.incrementFilesScanned(100);
      logger.incrementOrphansIdentified(10);
      logger.incrementDeletionsSucceeded(8);
      logger.incrementDeletionsFailed(2);

      const metrics = logger.complete();
      const logs = logger.getLogs();
      const completionLog = logs.find(log => log.message === 'Cleanup operation completed');

      expect(completionLog).toBeDefined();
      expect(completionLog!.level).toBe(LogLevel.INFO);

      // Verify all required fields are present
      expect(completionLog!.duration).toBeDefined();
      expect(completionLog!.filesScanned).toBe(100);
      expect(completionLog!.orphansIdentified).toBe(10);
      expect(completionLog!.deletionsSucceeded).toBe(8);
      expect(completionLog!.deletionsFailed).toBe(2);
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

  describe('error logging verification', () => {
    it('verifies error logging when errors occur during cleanup', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate error logging with both logger.error() and recordError()
      logger.error('Deletion failed', {
        streamId: 123,
        filename: 'file1.dat',
        error: 'Permission denied',
        errorType: 'PermissionError',
      });
      logger.recordError(123, 'file1.dat', 'Permission denied', 'PermissionError');

      logger.error('Deletion failed', {
        streamId: 456,
        filename: 'file2.bin',
        error: 'File not found',
        errorType: 'NotFoundError',
      });
      logger.recordError(456, 'file2.bin', 'File not found', 'NotFoundError');

      logger.incrementDeletionsFailed(2);

      const metrics = logger.complete();
      const logs = logger.getLogs();
      const errorLogs = logs.filter(log => log.level === LogLevel.ERROR);

      // Verify errors are logged
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(metrics.errors).toHaveLength(2);

      // Verify errorSpy was called
      expect(errorSpy).toHaveBeenCalled();

      // Verify error structure
      expect(metrics.errors[0]).toMatchObject({
        streamId: 123,
        filename: 'file1.dat',
        error: 'Permission denied',
        errorType: 'PermissionError',
        timestamp: expect.any(String),
      });

      expect(metrics.errors[1]).toMatchObject({
        streamId: 456,
        filename: 'file2.bin',
        error: 'File not found',
        errorType: 'NotFoundError',
        timestamp: expect.any(String),
      });
    });

    it('verifies error logging is queryable by error type', () => {
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

    it('verifies error logging is queryable by stream ID', () => {
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

    it('verifies error logging output includes all error details', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('Deletion failed', {
        streamId: 999,
        filename: 'critical.dat',
        error: 'Critical failure',
        errorType: 'CriticalError',
      });

      expect(errorSpy).toHaveBeenCalled();
      const callArgs = errorSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[Cleanup:verification-test]');

      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.level).toBe('error');
      expect(loggedJson.message).toBe('Deletion failed');
      expect(loggedJson.streamId).toBe(999);
      expect(loggedJson.filename).toBe('critical.dat');
      expect(loggedJson.error).toBe('Critical failure');
      expect(loggedJson.errorType).toBe('CriticalError');
    });

    it('verifies error logging without error type still records error', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Log error with logger.error() to verify console output
      logger.error('Deletion failed', {
        filename: 'unknown.dat',
        error: 'Unknown error',
      });

      // Record error in metrics
      logger.recordError(undefined, 'unknown.dat', 'Unknown error');

      const metrics = logger.complete();

      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0].error).toBe('Unknown error');
      expect(metrics.errors[0].errorType).toBeUndefined();
      expect(metrics.errors[0].filename).toBe('unknown.dat');
      expect(metrics.errors[0].streamId).toBeUndefined();

      // Verify it was still logged to console
      expect(errorSpy).toHaveBeenCalled();

      // Verify the logged JSON structure
      const callArgs = errorSpy.mock.calls[0];
      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.error).toBe('Unknown error');
      expect(loggedJson.filename).toBe('unknown.dat');
    });
  });

  describe('log structure and queryability verification', () => {
    it('verifies all log entries have required base fields', () => {
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      const logs = logger.getLogs();

      logs.forEach(log => {
        // Every log entry must have these required fields
        expect(log).toHaveProperty('level');
        expect(log).toHaveProperty('timestamp');
        expect(log).toHaveProperty('operation');
        expect(log).toHaveProperty('message');

        // Verify field types
        expect(typeof log.level).toBe('string');
        expect(typeof log.timestamp).toBe('string');
        expect(typeof log.operation).toBe('string');
        expect(typeof log.message).toBe('string');

        // Verify timestamp format
        expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

        // Verify operation name consistency
        expect(log.operation).toBe('verification-test');
      });
    });

    it('verifies logs are queryable by level', () => {
      logger.debug('Debug 1');
      logger.debug('Debug 2');
      logger.info('Info 1');
      logger.warn('Warning 1');
      logger.warn('Warning 2');
      logger.error('Error 1');

      const debugLogs = logger.getLogsByLevel(LogLevel.DEBUG);
      const infoLogs = logger.getLogsByLevel(LogLevel.INFO);
      const warnLogs = logger.getLogsByLevel(LogLevel.WARN);
      const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);

      expect(debugLogs).toHaveLength(2);
      expect(infoLogs.length).toBeGreaterThanOrEqual(2); // At least start log + explicit info
      expect(warnLogs).toHaveLength(2);
      expect(errorLogs).toHaveLength(1);

      // Verify all returned logs have correct level
      debugLogs.forEach(log => expect(log.level).toBe(LogLevel.DEBUG));
      infoLogs.forEach(log => expect(log.level).toBe(LogLevel.INFO));
      warnLogs.forEach(log => expect(log.level).toBe(LogLevel.WARN));
      errorLogs.forEach(log => expect(log.level).toBe(LogLevel.ERROR));
    });

    it('verifies logs are queryable by time range', async () => {
      const logger1 = new CleanupLogger('time-range-test');

      logger1.info('Message 1');
      await new Promise(resolve => setTimeout(resolve, 50));
      logger1.info('Message 2');
      await new Promise(resolve => setTimeout(resolve, 50));
      logger1.info('Message 3');

      const allLogs = logger1.getLogs();
      const startTime = allLogs[0].timestamp;
      const endTime = allLogs[allLogs.length - 1].timestamp;

      const filteredLogs = logger1.getLogsByTimeRange(startTime, endTime);

      expect(filteredLogs.length).toBeGreaterThanOrEqual(3);

      // Verify all timestamps are within range (string comparison works for ISO 8601)
      filteredLogs.forEach(log => {
        expect(log.timestamp >= startTime).toBe(true);
        expect(log.timestamp <= endTime).toBe(true);
      });
    });

    it('verifies log entries can be queried by custom fields', () => {
      logger.info('File operation', { filename: 'test.dat', operation: 'read' });
      logger.info('Another operation', { filename: 'other.bin', operation: 'write' });
      logger.info('Third operation', { filename: 'test.dat', operation: 'delete' });

      const logs = logger.getLogs();

      // Query by custom field
      const testDatLogs = logs.filter(log => log.filename === 'test.dat');
      expect(testDatLogs).toHaveLength(2);

      const readOps = logs.filter(log => log.operation === 'read');
      expect(readOps).toHaveLength(1);
    });

    it('verifies console output is parseable JSON', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.info('Info message', { data: 'value' });
      logger.warn('Warning message', { warning: 'test' });
      logger.error('Error message', { error: 'fail' });

      // Verify each console output is parseable JSON
      [logSpy, warnSpy, errorSpy].forEach(spy => {
        expect(spy).toHaveBeenCalled();
        const callArgs = spy.mock.calls[0];
        expect(callArgs).toHaveLength(2);
        expect(callArgs[0]).toMatch(/^\[Cleanup:verification-test\]$/);

        // Second arg must be valid JSON
        expect(() => JSON.parse(callArgs[1] as string)).not.toThrow();

        const parsed = JSON.parse(callArgs[1] as string);
        expect(parsed).toHaveProperty('level');
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('operation');
        expect(parsed).toHaveProperty('message');
      });
    });
  });

  describe('integration: full cleanup workflow verification', () => {
    it('verifies complete cleanup workflow with all logging stages', async () => {
      const workflowLogger = new CleanupLogger('integration-workflow');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate realistic cleanup workflow
      workflowLogger.info('Starting orphan scan', { directory: '/tmp/test' });
      workflowLogger.incrementFilesScanned(150);

      workflowLogger.incrementOrphansIdentified(12);
      workflowLogger.info('Orphans found', { count: 12 });

      // Simulate mixed success/failure deletions
      for (let i = 0; i < 12; i++) {
        if (i < 9) {
          workflowLogger.incrementDeletionsSucceeded();
          workflowLogger.debug(`Deleted stream ${100 + i}`, { streamId: 100 + i });
        } else if (i < 11) {
          workflowLogger.incrementDeletionsFailed();
          const error = i === 9 ? 'Permission denied' : 'File not found';
          const errorType = i === 9 ? 'PermissionError' : 'NotFoundError';
          workflowLogger.error('Deletion failed', {
            streamId: 100 + i,
            filename: `file-${i}.dat`,
            error,
            errorType,
          });
          workflowLogger.recordError(100 + i, `file-${i}.dat`, error, errorType);
        } else {
          // Network timeout with retry
          workflowLogger.warn('Deletion failed, retrying', {
            streamId: 100 + i,
            filename: `file-${i}.dat`,
            attempt: { current: 1, max: 2 },
            error: 'Network timeout',
            errorType: 'NetworkError',
          });
          await new Promise(resolve => setTimeout(resolve, 10));
          workflowLogger.incrementDeletionsSucceeded();
        }
      }

      const metrics = workflowLogger.complete();
      const logs = workflowLogger.getLogs();

      // Verify start log
      const startLog = logs.find(l => l.message === 'Cleanup operation started');
      expect(startLog).toBeDefined();
      expect(startLog!.operation).toBe('integration-workflow');

      // Verify completion log with all counts
      const completionLog = logs.find(l => l.message === 'Cleanup operation completed');
      expect(completionLog).toBeDefined();
      expect(completionLog!.filesScanned).toBe(150);
      expect(completionLog!.orphansIdentified).toBe(12);
      expect(completionLog!.deletionsSucceeded).toBe(10);
      expect(completionLog!.deletionsFailed).toBe(2);
      expect(completionLog!.errorCount).toBe(2);

      // Verify metrics object
      expect(metrics.filesScanned).toBe(150);
      expect(metrics.orphansIdentified).toBe(12);
      expect(metrics.deletionsSucceeded).toBe(10);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors).toHaveLength(2);
      expect(metrics.duration).toBeGreaterThanOrEqual(10); // At least the retry delay

      // Verify error logs
      const errorLogs = logs.filter(l => l.level === LogLevel.ERROR);
      expect(errorLogs.length).toBeGreaterThan(0);

      // Verify warning logs
      const warnLogs = logs.filter(l => l.level === LogLevel.WARN);
      expect(warnLogs.length).toBeGreaterThan(0);
      const retryLog = warnLogs.find(l => l.message?.includes('retrying'));
      expect(retryLog).toBeDefined();
      expect(retryLog!.attempt).toBeDefined();

      // Verify all console outputs were called
      expect(logSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();

      // Verify queryability by different criteria
      const permissionErrors = metrics.errors.filter(e => e.errorType === 'PermissionError');
      const notFoundErrors = metrics.errors.filter(e => e.errorType === 'NotFoundError');
      expect(permissionErrors).toHaveLength(1);
      expect(notFoundErrors).toHaveLength(1);

      const debugLogs = workflowLogger.getLogsByLevel(LogLevel.DEBUG);
      expect(debugLogs.length).toBeGreaterThanOrEqual(9); // At least 9 deletion success logs
    });

    it('verifies cleanup handles error-free scenario correctly', () => {
      const cleanLogger = new CleanupLogger('error-free-cleanup');

      cleanLogger.incrementFilesScanned(75);
      cleanLogger.incrementOrphansIdentified(5);
      cleanLogger.incrementDeletionsSucceeded(5);
      cleanLogger.incrementDeletionsFailed(0);

      const metrics = cleanLogger.complete();
      const logs = cleanLogger.getLogs();

      // Verify no error logs
      const errorLogs = logs.filter(l => l.level === LogLevel.ERROR);
      expect(errorLogs).toHaveLength(0);

      // Verify metrics show no errors
      expect(metrics.errors).toHaveLength(0);
      expect(metrics.deletionsFailed).toBe(0);

      // Verify completion log shows zero error count
      const completionLog = logs.find(l => l.message === 'Cleanup operation completed');
      expect(completionLog!.errorCount).toBe(0);
    });
  });

  describe('formatCleanupMetricsSummary verification', () => {
    it('verifies formatted output contains all required information', () => {
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

      // Verify all counts are present
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

    it('verifies formatted output handles zero values', () => {
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
});

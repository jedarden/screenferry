/**
 * Unit tests for cleanup logging functionality.
 *
 * Tests structured logging with timing, counts, and error tracking.
 *
 * Reference: bead bf-4pmk
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { CleanupLogger, formatCleanupMetricsSummary, LogLevel } from '../src/platform/cleanup-logger.js';

describe('CleanupLogger', () => {
  let logger: CleanupLogger;

  beforeEach(() => {
    // Clear console mocks before each test
    vi.clearAllMocks();
  });

  describe('basic logging', () => {
    it('creates logger with operation name', () => {
      logger = new CleanupLogger('test-operation');
      expect(logger).toBeDefined();
    });

    it('emits cleanup start log with required fields', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Create logger - this should emit the start log
      logger = new CleanupLogger('test-cleanup-start');

      // Get all logs from the logger
      const logs = logger.getLogs();

      // Find the start log
      const startLog = logs.find(log =>
        log.message === 'Cleanup operation started' &&
        log.level === LogLevel.INFO
      );

      // Verify start log exists
      expect(startLog).toBeDefined();

      // Verify log structure contains required fields
      expect(startLog!.level).toBe(LogLevel.INFO);
      expect(startLog!.timestamp).toBeDefined();
      expect(startLog!.operation).toBe('test-cleanup-start');
      expect(startLog!.message).toBe('Cleanup operation started');

      // Verify timestamp is valid ISO format
      expect(startLog!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify operation name is present in the log
      expect(startLog!.operation).toBe('test-cleanup-start');

      // Verify start time field is present
      expect(startLog!.startTime).toBeDefined();
      expect(startLog!.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // Verify console output was called
      expect(logSpy).toHaveBeenCalled();
      const callArgs = logSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[Cleanup:test-cleanup-start]');

      // Verify the logged JSON can be parsed
      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.message).toBe('Cleanup operation started');
      expect(loggedJson.operation).toBe('test-cleanup-start');
      expect(loggedJson.level).toBe(LogLevel.INFO);
      expect(loggedJson.timestamp).toBeDefined();
      expect(loggedJson.startTime).toBeDefined();
    });

    it('logs debug messages', () => {
      logger = new CleanupLogger('test-operation');
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      logger.debug('Test debug message', { key: 'value' });

      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      const debugLog = logs.find(log => log.level === LogLevel.DEBUG);
      expect(debugLog).toBeDefined();
      expect(debugLog!.message).toBe('Test debug message');
      expect(debugLog!.key).toBe('value');
      expect(debugSpy).toHaveBeenCalled();
    });

    it('logs info messages', () => {
      logger = new CleanupLogger('test-operation');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('Test info message', { count: 5 });

      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      const infoLog = logs.find(log => log.message === 'Test info message');
      expect(infoLog).toBeDefined();
      expect(infoLog!.level).toBe(LogLevel.INFO);
      expect(infoLog!.count).toBe(5);
      expect(logSpy).toHaveBeenCalled();
    });

    it('logs warning messages', () => {
      logger = new CleanupLogger('test-operation');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('Test warning message', { warning: 'test' });

      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      const warnLog = logs.find(log => log.message === 'Test warning message');
      expect(warnLog).toBeDefined();
      expect(warnLog!.level).toBe(LogLevel.WARN);
      expect(warnLog!.warning).toBe('test');
      expect(warnSpy).toHaveBeenCalled();
    });

    it('logs error messages', () => {
      logger = new CleanupLogger('test-operation');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('Test error message', { error: 'test error' });

      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThanOrEqual(2);
      const errorLog = logs.find(log => log.message === 'Test error message');
      expect(errorLog).toBeDefined();
      expect(errorLog!.level).toBe(LogLevel.ERROR);
      expect(errorLog!.error).toBe('test error');
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('metrics tracking', () => {
    it('tracks files scanned', () => {
      logger = new CleanupLogger('test-operation');

      logger.incrementFilesScanned();
      logger.incrementFilesScanned(5);

      const metrics = logger.complete();
      expect(metrics.filesScanned).toBe(6);
    });

    it('tracks orphans identified', () => {
      logger = new CleanupLogger('test-operation');

      logger.incrementOrphansIdentified();
      logger.incrementOrphansIdentified(3);

      const metrics = logger.complete();
      expect(metrics.orphansIdentified).toBe(4);
    });

    it('tracks deletions succeeded', () => {
      logger = new CleanupLogger('test-operation');

      logger.incrementDeletionsSucceeded();
      logger.incrementDeletionsSucceeded(7);

      const metrics = logger.complete();
      expect(metrics.deletionsSucceeded).toBe(8);
    });

    it('tracks deletions failed', () => {
      logger = new CleanupLogger('test-operation');

      logger.incrementDeletionsFailed();
      logger.incrementDeletionsFailed(2);

      const metrics = logger.complete();
      expect(metrics.deletionsFailed).toBe(3);
    });

    it('records errors', () => {
      logger = new CleanupLogger('test-operation');

      logger.recordError(123, 'test-file.dat', 'Permission denied');
      logger.recordError(456, 'another-file.bin', 'File not found');

      const metrics = logger.complete();
      expect(metrics.errors).toHaveLength(2);
      expect(metrics.errors[0]).toEqual({
        streamId: 123,
        filename: 'test-file.dat',
        error: 'Permission denied',
        errorType: undefined,
        timestamp: expect.any(String),
      });
      expect(metrics.errors[1]).toEqual({
        streamId: 456,
        filename: 'another-file.bin',
        error: 'File not found',
        errorType: undefined,
        timestamp: expect.any(String),
      });
    });

    it('records errors with error type', () => {
      logger = new CleanupLogger('test-operation');

      logger.recordError(123, 'test-file.dat', 'Permission denied', 'PermissionError');
      logger.recordError(456, 'another-file.bin', 'File not found', 'NotFoundError');
      logger.recordError(789, 'third-file.bin', 'Network timeout', 'NetworkError');

      const metrics = logger.complete();
      expect(metrics.errors).toHaveLength(3);
      expect(metrics.errors[0]).toMatchObject({
        streamId: 123,
        filename: 'test-file.dat',
        error: 'Permission denied',
        errorType: 'PermissionError',
      });
      expect(metrics.errors[0].timestamp).toBeDefined();
      expect(metrics.errors[1]).toMatchObject({
        streamId: 456,
        filename: 'another-file.bin',
        error: 'File not found',
        errorType: 'NotFoundError',
      });
      expect(metrics.errors[1].timestamp).toBeDefined();
      expect(metrics.errors[2]).toMatchObject({
        streamId: 789,
        filename: 'third-file.bin',
        error: 'Network timeout',
        errorType: 'NetworkError',
      });
      expect(metrics.errors[2].timestamp).toBeDefined();
    });

    it('records errors with undefined values', () => {
      logger = new CleanupLogger('test-operation');

      logger.recordError(undefined, undefined, 'Unknown error');

      const metrics = logger.complete();
      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0]).toEqual({
        streamId: undefined,
        filename: undefined,
        error: 'Unknown error',
        errorType: undefined,
        timestamp: expect.any(String),
      });
    });
  });

  describe('completion metrics', () => {
    it('returns complete metrics on completion', () => {
      logger = new CleanupLogger('test-operation');
      logger.incrementFilesScanned(10);
      logger.incrementOrphansIdentified(3);
      logger.incrementDeletionsSucceeded(2);
      logger.incrementDeletionsFailed(1);
      logger.recordError(123, 'file1.dat', 'Error 1');

      const metrics = logger.complete();

      expect(metrics.startTime).toBeDefined();
      expect(metrics.endTime).toBeDefined();
      expect(metrics.duration).toBeGreaterThanOrEqual(0);
      expect(metrics.filesScanned).toBe(10);
      expect(metrics.orphansIdentified).toBe(3);
      expect(metrics.deletionsSucceeded).toBe(2);
      expect(metrics.deletionsFailed).toBe(1);
      expect(metrics.errors).toHaveLength(1);
    });

    it('calculates duration correctly', async () => {
      logger = new CleanupLogger('test-operation');

      // Add a small delay to ensure measurable duration
      await new Promise(resolve => setTimeout(resolve, 10));

      const metrics = logger.complete();
      expect(metrics.duration).toBeGreaterThanOrEqual(10);
      expect(metrics.duration).toBeLessThan(100); // Should be fast
    });
  });

  describe('log filtering', () => {
    beforeEach(() => {
      logger = new CleanupLogger('test-operation');
      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Log various levels
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
    });

    it('gets all logs', () => {
      const allLogs = logger.getLogs();
      expect(allLogs.length).toBeGreaterThanOrEqual(5); // start log + 4 level logs
    });

    it('filters logs by level', () => {
      const debugLogs = logger.getLogsByLevel(LogLevel.DEBUG);
      expect(debugLogs).toHaveLength(1);
      expect(debugLogs[0].level).toBe(LogLevel.DEBUG);

      const infoLogs = logger.getLogsByLevel(LogLevel.INFO);
      expect(infoLogs.length).toBeGreaterThanOrEqual(1); // start log + explicit info log
      expect(infoLogs[0].level).toBe(LogLevel.INFO);

      const warnLogs = logger.getLogsByLevel(LogLevel.WARN);
      expect(warnLogs).toHaveLength(1);
      expect(warnLogs[0].level).toBe(LogLevel.WARN);

      const errorLogs = logger.getLogsByLevel(LogLevel.ERROR);
      expect(errorLogs).toHaveLength(1);
      expect(errorLogs[0].level).toBe(LogLevel.ERROR);
    });

    it('filters logs by time range', () => {
      const allLogs = logger.getLogs();
      const startTime = allLogs[0].timestamp;
      const endTime = allLogs[allLogs.length - 1].timestamp;

      const filteredLogs = logger.getLogsByTimeRange(startTime, endTime);
      expect(filteredLogs.length).toBeGreaterThan(0);
      expect(filteredLogs.length).toBeLessThanOrEqual(5); // start log + 4 level logs
    });
  });

  describe('structured log format', () => {
    it('includes required fields in log entries', () => {
      logger = new CleanupLogger('test-operation');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('Test message', { custom: 'data' });

      const logs = logger.getLogs();
      const log = logs.find(l => l.message === 'Test message');

      expect(log).toBeDefined();
      expect(log!.level).toBeDefined();
      expect(log!.timestamp).toBeDefined();
      expect(log!.operation).toBe('test-operation');
      expect(log!.message).toBe('Test message');
      expect(log!.custom).toBe('data');
    });

    it('creates valid ISO timestamps', () => {
      logger = new CleanupLogger('test-operation');
      logger.info('Test');

      const logs = logger.getLogs();
      const timestamp = logs[0].timestamp;

      // ISO 8601 format validation
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('outputs JSON to console', () => {
      logger = new CleanupLogger('test-operation');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      logger.info('Test message', { count: 5 });

      expect(logSpy).toHaveBeenCalled();
      const callArgs = logSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[Cleanup:test-operation]');

      // Second argument should be JSON string
      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.message).toBe('Test message');
      expect(loggedJson.count).toBe(5);
    });
  });

  describe('formatCleanupMetricsSummary', () => {
    it('formats metrics as human-readable string', () => {
      const metrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:05.000Z',
        duration: 5000,
        filesScanned: 100,
        orphansIdentified: 10,
        deletionsSucceeded: 8,
        deletionsFailed: 2,
        errors: [
          { streamId: 1, filename: 'file1.dat', error: 'Error 1', errorType: 'PermissionError', timestamp: '2024-01-01T10:00:01.000Z' },
          { streamId: 2, filename: 'file2.dat', error: 'Error 2', errorType: 'NotFoundError', timestamp: '2024-01-01T10:00:02.000Z' },
        ],
      };

      const formatted = formatCleanupMetricsSummary(metrics);

      expect(formatted).toContain('Cleanup Metrics Summary');
      expect(formatted).toContain('Files scanned: 100');
      expect(formatted).toContain('Orphans identified: 10');
      expect(formatted).toContain('Deletions succeeded: 8');
      expect(formatted).toContain('Deletions failed: 2');
      expect(formatted).toContain('5000.00ms');
      expect(formatted).toContain('Errors:');
      expect(formatted).toContain('file1.dat (1): [PermissionError] Error 1');
      expect(formatted).toContain('file2.dat (2): [NotFoundError] Error 2');
    });

    it('handles metrics with no errors', () => {
      const metrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:01.000Z',
        duration: 1000,
        filesScanned: 50,
        orphansIdentified: 5,
        deletionsSucceeded: 5,
        deletionsFailed: 0,
        errors: [],
      };

      const formatted = formatCleanupMetricsSummary(metrics);

      expect(formatted).toContain('Deletions failed: 0');
      expect(formatted).not.toContain('Errors:');
    });

    it('handles errors without error type', () => {
      const metrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:03.000Z',
        duration: 3000,
        filesScanned: 75,
        orphansIdentified: 7,
        deletionsSucceeded: 5,
        deletionsFailed: 2,
        errors: [
          { streamId: 1, filename: 'file1.dat', error: 'Error 1', timestamp: '2024-01-01T10:00:01.000Z' },
          { streamId: 2, filename: 'file2.dat', error: 'Error 2', timestamp: '2024-01-01T10:00:02.000Z' },
        ],
      };

      const formatted = formatCleanupMetricsSummary(metrics);

      expect(formatted).toContain('Errors:');
      expect(formatted).toContain('file1.dat (1): Error 1');
      expect(formatted).toContain('file2.dat (2): Error 2');
    });

    it('handles zero metrics', () => {
      const metrics = {
        startTime: '2024-01-01T10:00:00.000Z',
        endTime: '2024-01-01T10:00:00.100Z',
        duration: 100,
        filesScanned: 0,
        orphansIdentified: 0,
        deletionsSucceeded: 0,
        deletionsFailed: 0,
        errors: [],
      };

      const formatted = formatCleanupMetricsSummary(metrics);

      expect(formatted).toContain('Files scanned: 0');
      expect(formatted).toContain('Orphans identified: 0');
      expect(formatted).toContain('Deletions succeeded: 0');
      expect(formatted).toContain('Deletions failed: 0');
    });
  });

  describe('realistic cleanup scenario', () => {
    it('tracks realistic cleanup operation', async () => {
      logger = new CleanupLogger('realistic-cleanup');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Simulate scanning files
      logger.info('Starting orphan scan', { directory: '/test' });
      logger.incrementFilesScanned(100);

      // Simulate finding orphans
      logger.incrementOrphansIdentified(10);
      logger.info('Orphans identified', { count: 10 });

      // Simulate deletions
      for (let i = 0; i < 10; i++) {
        if (i < 8) {
          logger.incrementDeletionsSucceeded();
          logger.debug('Deletion succeeded', { streamId: 100 + i });
        } else if (i === 8) {
          logger.incrementDeletionsFailed();
          logger.error('Deletion failed', {
            streamId: 100 + i,
            error: 'Permission denied',
            errorType: 'PermissionError',
          });
          logger.recordError(100 + i, `file-${i}.dat`, 'Permission denied', 'PermissionError');
        } else {
          logger.incrementDeletionsFailed();
          logger.error('Deletion failed', {
            streamId: 100 + i,
            error: 'File not found',
            errorType: 'NotFoundError',
          });
          logger.recordError(100 + i, `file-${i}.dat`, 'File not found', 'NotFoundError');
        }
      }

      const metrics = logger.complete();

      // Verify metrics
      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(8);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors).toHaveLength(2);
      expect(metrics.errors[0].errorType).toBe('PermissionError');
      expect(metrics.errors[1].errorType).toBe('NotFoundError');
      expect(metrics.duration).toBeGreaterThanOrEqual(0);

      // Verify logs were created
      const logs = logger.getLogs();
      expect(logs.length).toBeGreaterThan(10);

      // Verify completion log was created
      const completionLogs = logs.filter(log => log.message?.includes('completed'));
      expect(completionLogs.length).toBeGreaterThan(0);
    });
  });
});

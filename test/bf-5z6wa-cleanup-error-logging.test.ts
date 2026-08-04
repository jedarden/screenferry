/**
 * Integration tests for cleanup error logging with error types.
 *
 * Tests that cleanup operations properly log error types (e.g., NotFoundError,
 * PermissionError) along with error messages and file context for debugging.
 *
 * Reference: bead bf-5z6wa
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AsyncCleanupWorker, type DeletionResult } from '../src/platform/async-cleanup-worker.js';
import { CleanupLogger } from '../src/platform/cleanup-logger.js';

describe('bf-5z6wa: cleanup error logging', () => {
  describe('DeletionResult includes error type', () => {
    it('includes errorType field in interface', () => {
      const result: DeletionResult = {
        streamId: 123,
        filename: 'test.dat',
        success: false,
        error: 'File not found',
        errorType: 'NotFoundError',
        timestamp: Date.now(),
        duration: 100,
      };

      expect(result.errorType).toBe('NotFoundError');
    });

    it('allows undefined errorType for backward compatibility', () => {
      const result: DeletionResult = {
        streamId: 123,
        filename: 'test.dat',
        success: false,
        error: 'Some error',
        timestamp: Date.now(),
        duration: 100,
      };

      expect(result.errorType).toBeUndefined();
    });
  });

  describe('AsyncCleanupWorker error type capture', () => {
    it('captures error type from thrown errors', async () => {
      const mockStorage = {
        deleteOutput: vi.fn().mockRejectedValue(new TypeError('Invalid path')),
      };

      const worker = new AsyncCleanupWorker(mockStorage as any, {
        maxRetries: 1,
        batchSize: 1,
        delayBetweenBatches: 0,
      });

      const orphans = [
        { streamId: 1, filename: 'file1.dat' },
      ];

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.failed).toBe(1);
      expect(metrics.failures[0].errorType).toBe('TypeError');
      expect(metrics.failures[0].error).toBe('Invalid path');
    });

    it('captures different error types for different failures', async () => {
      const mockStorage = {
        deleteOutput: vi.fn()
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockRejectedValueOnce(new TypeError('Invalid argument'))
          .mockRejectedValueOnce(new RangeError('Out of range')),
      };

      const worker = new AsyncCleanupWorker(mockStorage as any, {
        maxRetries: 1,
        batchSize: 3,
        delayBetweenBatches: 0,
      });

      const orphans = [
        { streamId: 1, filename: 'file1.dat' },
        { streamId: 2, filename: 'file2.dat' },
        { streamId: 3, filename: 'file3.dat' },
      ];

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.failed).toBe(3);
      expect(metrics.failures[0].errorType).toBe('Error');
      expect(metrics.failures[1].errorType).toBe('TypeError');
      expect(metrics.failures[2].errorType).toBe('RangeError');
    });

    it('handles non-Error objects', async () => {
      const mockStorage = {
        deleteOutput: vi.fn().mockRejectedValue('String error'),
      };

      const worker = new AsyncCleanupWorker(mockStorage as any, {
        maxRetries: 1,
        batchSize: 1,
        delayBetweenBatches: 0,
      });

      const orphans = [
        { streamId: 1, filename: 'file1.dat' },
      ];

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.failed).toBe(1);
      expect(metrics.failures[0].errorType).toBe('Error'); // String errors are wrapped in Error
    });
  });

  describe('CleanupLogger error type recording', () => {
    it('records error type with error details', () => {
      const logger = new CleanupLogger('test-operation');

      logger.recordError(123, 'file1.dat', 'Permission denied', 'PermissionError');
      logger.recordError(456, 'file2.dat', 'Not found', 'NotFoundError');

      const metrics = logger.complete();

      expect(metrics.errors).toHaveLength(2);
      expect(metrics.errors[0].errorType).toBe('PermissionError');
      expect(metrics.errors[1].errorType).toBe('NotFoundError');
    });

    it('allows omitting error type', () => {
      const logger = new CleanupLogger('test-operation');

      logger.recordError(123, 'file1.dat', 'Some error');

      const metrics = logger.complete();

      expect(metrics.errors).toHaveLength(1);
      expect(metrics.errors[0].errorType).toBeUndefined();
      expect(metrics.errors[0].error).toBe('Some error');
    });
  });

  describe('Error log structure and distinguishability', () => {
    it('logs errors with ERROR level', () => {
      const logger = new CleanupLogger('test-operation');
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      logger.error('Deletion failed', {
        streamId: 123,
        filename: 'file.dat',
        error: 'Permission denied',
        errorType: 'PermissionError',
      });

      expect(errorSpy).toHaveBeenCalled();
      const callArgs = errorSpy.mock.calls[0];
      expect(callArgs[0]).toBe('[Cleanup:test-operation]');

      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.level).toBe('error');
      expect(loggedJson.operation).toBe('test-operation');
      expect(loggedJson.errorType).toBe('PermissionError');
    });

    it('error logs include errorType field', () => {
      const logger = new CleanupLogger('test-operation');

      logger.error('Test error', {
        error: 'Test message',
        errorType: 'TestError',
      });

      const logs = logger.getLogs();
      const errorLog = logs.find(log => log.message === 'Test error');

      expect(errorLog).toBeDefined();
      expect(errorLog!.errorType).toBe('TestError');
    });

    it('warn logs during retry include errorType', () => {
      const logger = new CleanupLogger('test-operation');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      logger.warn('Deletion attempt failed, will retry', {
        streamId: 123,
        filename: 'file.dat',
        attempt: { current: 1, max: 2 },
        error: 'Temporary failure',
        errorType: 'NetworkError',
      });

      expect(warnSpy).toHaveBeenCalled();
      const callArgs = warnSpy.mock.calls[0];
      const loggedJson = JSON.parse(callArgs[1] as string);
      expect(loggedJson.level).toBe('warn');
      expect(loggedJson.errorType).toBe('NetworkError');
    });
  });

  describe('Formatting functions include error types', () => {
    it('formatCleanupMetrics includes error types', async () => {
      const { formatCleanupMetrics } = await import('../src/platform/async-cleanup-worker.js');
      const metrics = {
        total: 3,
        succeeded: 1,
        failed: 2,
        duration: 500,
        results: [],
        failures: [
          {
            streamId: 1,
            filename: 'file1.dat',
            success: false,
            error: 'Permission denied',
            errorType: 'PermissionError',
            timestamp: Date.now(),
            duration: 100,
          },
          {
            streamId: 2,
            filename: 'file2.dat',
            success: false,
            error: 'Not found',
            errorType: 'NotFoundError',
            timestamp: Date.now(),
            duration: 100,
          },
        ],
      };

      const formatted = formatCleanupMetrics(metrics);

      expect(formatted).toContain('[PermissionError] Permission denied');
      expect(formatted).toContain('[NotFoundError] Not found');
    });

    it('formatCleanupMetrics handles missing error types', async () => {
      const { formatCleanupMetrics } = await import('../src/platform/async-cleanup-worker.js');
      const metrics = {
        total: 2,
        succeeded: 0,
        failed: 2,
        duration: 500,
        results: [],
        failures: [
          {
            streamId: 1,
            filename: 'file1.dat',
            success: false,
            error: 'Error without type',
            timestamp: Date.now(),
            duration: 100,
          },
        ],
      };

      const formatted = formatCleanupMetrics(metrics);

      expect(formatted).toContain('file1.dat (1): Error without type');
      expect(formatted).not.toContain('[]');
    });
  });

  describe('Integration: full cleanup workflow with error types', () => {
    it('complete cleanup workflow captures and formats error types', async () => {
      const mockStorage = {
        deleteOutput: vi.fn()
          .mockResolvedValueOnce() // First succeeds
          .mockRejectedValueOnce(new ReferenceError('File reference lost')) // Second fails
          .mockRejectedValueOnce(new SyntaxError('Invalid path syntax')) // Third fails
          .mockResolvedValueOnce(), // Fourth succeeds
      };

      const logger = new CleanupLogger('integration-test');
      const worker = new AsyncCleanupWorker(
        mockStorage as any,
        {
          maxRetries: 1,
          batchSize: 2,
          delayBetweenBatches: 0,
        },
        logger
      );

      const orphans = [
        { streamId: 1, filename: 'success1.dat' },
        { streamId: 2, filename: 'fail1.dat' },
        { streamId: 3, filename: 'fail2.dat' },
        { streamId: 4, filename: 'success2.dat' },
      ];

      const metrics = await worker.processDeletions(orphans);
      const cleanupMetrics = logger.complete();

      // Verify metrics
      expect(metrics.total).toBe(4);
      expect(metrics.succeeded).toBe(2);
      expect(metrics.failed).toBe(2);

      // Verify error types are captured (order may vary due to batch processing)
      const failureTypes = metrics.failures.map(f => f.errorType).sort();
      expect(failureTypes).toEqual(['ReferenceError', 'SyntaxError']);

      // Verify logger metrics match
      expect(cleanupMetrics.deletionsSucceeded).toBe(2);
      expect(cleanupMetrics.deletionsFailed).toBe(2);
      expect(cleanupMetrics.errors).toHaveLength(2);

      const loggerErrorTypes = cleanupMetrics.errors.map(e => e.errorType).sort();
      expect(loggerErrorTypes).toEqual(['ReferenceError', 'SyntaxError']);

      // Verify logs contain error types
      const errorLogs = logger.getLogsByLevel('error' as any);
      expect(errorLogs.length).toBeGreaterThan(0);

      const deletionErrorLogs = errorLogs.filter(log =>
        log.message?.includes('All deletion attempts failed')
      );
      expect(deletionErrorLogs.length).toBe(2);

      const loggedErrorTypes = deletionErrorLogs.map(log => log.errorType).sort();
      expect(loggedErrorTypes).toEqual(['ReferenceError', 'SyntaxError']);
    });

    it('error logging does not cascade failures', async () => {
      const mockStorage = {
        deleteOutput: vi.fn().mockRejectedValue(new Error('Deletion failed')),
      };

      // Even if console.error fails, the cleanup should continue
      const originalError = console.error;
      console.error = vi.fn().mockImplementation(() => {
        throw new Error('Console error failed');
      });

      try {
        const worker = new AsyncCleanupWorker(mockStorage as any, {
          maxRetries: 1,
          batchSize: 1,
          delayBetweenBatches: 0,
        });

        const orphans = [
          { streamId: 1, filename: 'file1.dat' },
          { streamId: 2, filename: 'file2.dat' },
        ];

        // Should not throw despite console.error failing
        const metrics = await worker.processDeletions(orphans);

        expect(metrics.total).toBe(2);
        expect(metrics.failed).toBe(2);
      } finally {
        console.error = originalError;
      }
    });
  });
});

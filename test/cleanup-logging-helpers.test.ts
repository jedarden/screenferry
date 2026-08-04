/**
 * Test infrastructure verification for cleanup logging helpers.
 *
 * Verifies that test helper utilities work correctly and the
 * test framework is properly configured.
 *
 * Reference: bead bf-h5589
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { CleanupLogger, LogLevel } from '../src/platform/cleanup-logger.js';
import {
  createConsoleSpies,
  restoreConsoleSpies,
  parseLoggedJson,
  assertLogHasRequiredFields,
  assertConsolePrefix,
  findLogsByLevel,
  findLogsByMessage,
  findLogByExactMessage,
  assertMetricsMatch,
  assertMetricsTimingValid,
  runMockCleanup,
  createMockMetrics,
  cleanupTestState,
  createTestLogger,
  assertAllOutputsParseable,
  countErrorsByType,
  findErrorsByStreamId,
} from './helpers/cleanup-logging-helpers.js';

describe('cleanup logging test infrastructure', () => {
  beforeEach(() => {
    cleanupTestState();
  });

  describe('console spy utilities', () => {
    it('creates and restores console spies', () => {
      const spies = createConsoleSpies();

      expect(spies.debug).toBeDefined();
      expect(spies.log).toBeDefined();
      expect(spies.warn).toBeDefined();
      expect(spies.error).toBeDefined();

      restoreConsoleSpies(spies);
    });

    it('parses logged JSON from spy calls', () => {
      const logger = createTestLogger('json-parse-test');
      const spies = createConsoleSpies();

      logger.info('Test message', { key: 'value' });

      const loggedJson = parseLoggedJson<{ message: string; key: string }>(spies.log);
      expect(loggedJson.message).toBe('Test message');
      expect(loggedJson.key).toBe('value');

      restoreConsoleSpies(spies);
    });
  });

  describe('log assertion utilities', () => {
    it('asserts log has required fields', () => {
      const logger = createTestLogger('required-fields-test');
      logger.info('Test message');

      const logs = logger.getLogs();
      const log = logs.find(l => l.message === 'Test message');

      expect(log).toBeDefined();
      assertLogHasRequiredFields(log!, 'required-fields-test');
    });

    it('asserts console prefix is correct', () => {
      const logger = createTestLogger('prefix-test');
      const spies = createConsoleSpies();

      logger.info('Test');

      assertConsolePrefix(spies.log, 'prefix-test');

      restoreConsoleSpies(spies);
    });
  });

  describe('log filtering utilities', () => {
    it('finds logs by level', () => {
      const logger = createTestLogger('filter-level-test');
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      const logs = logger.getLogs();
      const debugLogs = findLogsByLevel(logs, LogLevel.DEBUG);
      const infoLogs = findLogsByLevel(logs, LogLevel.INFO);
      const warnLogs = findLogsByLevel(logs, LogLevel.WARN);
      const errorLogs = findLogsByLevel(logs, LogLevel.ERROR);

      expect(debugLogs).toHaveLength(1);
      expect(infoLogs.length).toBeGreaterThanOrEqual(1); // At least start log + explicit info
      expect(warnLogs).toHaveLength(1);
      expect(errorLogs).toHaveLength(1);
    });

    it('finds logs by message content', () => {
      const logger = createTestLogger('filter-message-test');
      logger.info('Starting operation');
      logger.info('Processing data');
      logger.info('Finishing operation');

      const logs = logger.getLogs();
      const operationLogs = findLogsByMessage(logs, 'operation');

      expect(operationLogs.length).toBeGreaterThanOrEqual(2); // Starting + Finishing
    });

    it('finds log by exact message', () => {
      const logger = createTestLogger('exact-match-test');
      logger.info('Exact match message');
      logger.info('Different message');

      const logs = logger.getLogs();
      const exactLog = findLogByExactMessage(logs, 'Exact match message');

      expect(exactLog).toBeDefined();
      expect(exactLog!.message).toBe('Exact match message');
    });
  });

  describe('metrics assertion utilities', () => {
    it('asserts metrics match expected values', () => {
      const logger = createTestLogger('metrics-match-test');
      logger.incrementFilesScanned(50);
      logger.incrementOrphansIdentified(5);
      logger.incrementDeletionsSucceeded(3);
      logger.incrementDeletionsFailed(2);

      const metrics = logger.complete();

      assertMetricsMatch(metrics, {
        filesScanned: 50,
        orphansIdentified: 5,
        deletionsSucceeded: 3,
        deletionsFailed: 2,
      });
    });

    it('asserts metrics timing is valid', async () => {
      const logger = createTestLogger('timing-test');

      logger.info('Starting');
      await new Promise(resolve => setTimeout(resolve, 10));
      logger.info('Complete');

      const metrics = logger.complete();

      assertMetricsTimingValid(metrics);
      expect(metrics.duration).toBeGreaterThanOrEqual(10);
    });
  });

  describe('mock cleanup operations', () => {
    it('runs mock cleanup with defaults', () => {
      const logger = createTestLogger('mock-defaults-test');
      const spies = createConsoleSpies();

      runMockCleanup(logger, {});

      const metrics = logger.complete();

      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(8);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors).toHaveLength(0);

      restoreConsoleSpies(spies);
    });

    it('runs mock cleanup with custom values', () => {
      const logger = createTestLogger('mock-custom-test');
      const spies = createConsoleSpies();

      runMockCleanup(logger, {
        filesScanned: 250,
        orphansIdentified: 25,
        deletionsSucceeded: 20,
        deletionsFailed: 5,
        errors: [
          { streamId: 1, filename: 'fail1.dat', error: 'Error 1', errorType: 'ErrorType1' },
          { streamId: 2, filename: 'fail2.dat', error: 'Error 2', errorType: 'ErrorType2' },
        ],
      });

      const metrics = logger.complete();

      expect(metrics.filesScanned).toBe(250);
      expect(metrics.orphansIdentified).toBe(25);
      expect(metrics.deletionsSucceeded).toBe(20);
      expect(metrics.deletionsFailed).toBe(5);
      expect(metrics.errors).toHaveLength(2);

      restoreConsoleSpies(spies);
    });
  });

  describe('mock metrics creation', () => {
    it('creates mock metrics with defaults', () => {
      const metrics = createMockMetrics();

      expect(metrics.filesScanned).toBe(100);
      expect(metrics.orphansIdentified).toBe(10);
      expect(metrics.deletionsSucceeded).toBe(8);
      expect(metrics.deletionsFailed).toBe(2);
      expect(metrics.errors).toHaveLength(2);
    });

    it('creates mock metrics with overrides', () => {
      const metrics = createMockMetrics({
        filesScanned: 500,
        orphansIdentified: 50,
        deletionsSucceeded: 45,
        deletionsFailed: 5,
        errors: [],
      });

      expect(metrics.filesScanned).toBe(500);
      expect(metrics.orphansIdentified).toBe(50);
      expect(metrics.deletionsSucceeded).toBe(45);
      expect(metrics.deletionsFailed).toBe(5);
      expect(metrics.errors).toHaveLength(0);
    });
  });

  describe('test logger creation', () => {
    it('creates logger with default operation name', () => {
      const logger = createTestLogger();
      expect(logger).toBeDefined();
    });

    it('creates logger with custom operation name', () => {
      const logger = createTestLogger('custom-operation');
      const logs = logger.getLogs();

      expect(logs[0].operation).toBe('custom-operation');
    });
  });

  describe('console output verification', () => {
    it('asserts all outputs are parseable JSON', () => {
      const logger = createTestLogger('parseable-test');
      const spies = createConsoleSpies();

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');

      assertAllOutputsParseable(spies);

      restoreConsoleSpies(spies);
    });
  });

  describe('error query utilities', () => {
    it('counts errors by type', () => {
      const metrics = createMockMetrics({
        errors: [
          { streamId: 1, filename: 'f1', error: 'e1', errorType: 'PermissionError', timestamp: '2024-01-01T10:00:01.000Z' },
          { streamId: 2, filename: 'f2', error: 'e2', errorType: 'PermissionError', timestamp: '2024-01-01T10:00:02.000Z' },
          { streamId: 3, filename: 'f3', error: 'e3', errorType: 'NotFoundError', timestamp: '2024-01-01T10:00:03.000Z' },
        ],
      });

      const permissionCount = countErrorsByType(metrics, 'PermissionError');
      const notFoundCount = countErrorsByType(metrics, 'NotFoundError');

      expect(permissionCount).toBe(2);
      expect(notFoundCount).toBe(1);
    });

    it('finds errors by stream ID', () => {
      const metrics = createMockMetrics({
        errors: [
          { streamId: 100, filename: 'f1', error: 'e1', timestamp: '2024-01-01T10:00:01.000Z' },
          { streamId: 100, filename: 'f2', error: 'e2', timestamp: '2024-01-01T10:00:02.000Z' },
          { streamId: 200, filename: 'f3', error: 'e3', timestamp: '2024-01-01T10:00:03.000Z' },
        ],
      });

      const stream100Errors = findErrorsByStreamId(metrics, 100);
      const stream200Errors = findErrorsByStreamId(metrics, 200);

      expect(stream100Errors).toHaveLength(2);
      expect(stream200Errors).toHaveLength(1);
    });
  });

  describe('test state cleanup', () => {
    it('cleans up test state', () => {
      const logger1 = createTestLogger('cleanup-test-1');
      logger1.info('Test 1');

      cleanupTestState();

      const logger2 = createTestLogger('cleanup-test-2');
      logger2.info('Test 2');

      const logs1 = logger1.getLogs();
      const logs2 = logger2.getLogs();

      // Both loggers should have their own independent logs
      expect(logs1.length).toBeGreaterThan(0);
      expect(logs2.length).toBeGreaterThan(0);
    });
  });

  describe('integration: complete test workflow', () => {
    it('demonstrates complete helper workflow', () => {
      // Setup
      const spies = createConsoleSpies();
      const logger = createTestLogger('integration-test');

      // Run mock cleanup
      runMockCleanup(logger, {
        filesScanned: 150,
        orphansIdentified: 15,
        deletionsSucceeded: 12,
        deletionsFailed: 3,
        errors: [
          { streamId: 1, filename: 'fail1.dat', error: 'Error 1', errorType: 'ErrorType1' },
          { streamId: 2, filename: 'fail2.dat', error: 'Error 2', errorType: 'ErrorType2' },
          { streamId: 3, filename: 'fail3.dat', error: 'Error 3', errorType: 'ErrorType3' },
        ],
      });

      // Complete and verify
      const metrics = logger.complete();
      const logs = logger.getLogs();

      // Verify metrics
      assertMetricsMatch(metrics, {
        filesScanned: 150,
        orphansIdentified: 15,
        deletionsSucceeded: 12,
        deletionsFailed: 3,
      });
      assertMetricsTimingValid(metrics);

      // Verify logs
      assertLogHasRequiredFields(logs[0], 'integration-test');
      const errorLogs = findLogsByLevel(logs, LogLevel.ERROR);
      expect(errorLogs.length).toBeGreaterThanOrEqual(3);

      // Verify console output
      assertConsolePrefix(spies.log, 'integration-test');
      assertAllOutputsParseable(spies);

      // Verify error queries
      expect(countErrorsByType(metrics, 'ErrorType1')).toBe(1);
      expect(findErrorsByStreamId(metrics, 1)).toHaveLength(1);

      // Cleanup
      restoreConsoleSpies(spies);
      cleanupTestState();
    });
  });
});

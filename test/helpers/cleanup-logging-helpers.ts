/**
 * Test helper utilities for cleanup logging verification tests.
 *
 * Provides reusable utilities for:
 * - Console log capture and verification
 * - Log entry assertion helpers
 * - Mock cleanup operations
 * - Metrics verification helpers
 *
 * Reference: bead bf-h5589
 */

import { CleanupLogger, CleanupMetrics, CleanupLogEntry, LogLevel } from '../../src/platform/cleanup-logger.js';
import { vi, expect } from 'vitest';

/**
 * Type for a spy function returned by vi.spyOn.
 */
type SpyInstance = ReturnType<typeof vi.spyOn>;

/**
 * Console spy collection for capturing all console output.
 */
export interface ConsoleSpies {
  debug: SpyInstance;
  log: SpyInstance;
  warn: SpyInstance;
  error: SpyInstance;
}

/**
 * Creates spies on all console methods for log capture.
 *
 * @returns ConsoleSpies object with spies on debug, log, warn, and error
 */
export function createConsoleSpies(): ConsoleSpies {
  return {
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

/**
 * Restores all console methods and clears mock state.
 *
 * @param spies - ConsoleSpies object to restore
 */
export function restoreConsoleSpies(spies: ConsoleSpies): void {
  Object.values(spies).forEach(spy => spy.mockRestore());
  vi.clearAllMocks();
}

/**
 * Parses logged JSON from console spy calls.
 *
 * @param spy - Vitest spy instance
 * @param callIndex - Index of the call to parse (default: 0)
 * @returns Parsed JSON object from the second argument of the call
 */
export function parseLoggedJson<T = unknown>(spy: SpyInstance, callIndex: number = 0): T {
  const calls = spy.mock.calls;
  if (!calls[callIndex] || calls[callIndex].length < 2) {
    throw new Error(`No JSON found in spy call at index ${callIndex}`);
  }
  return JSON.parse(calls[callIndex][1] as string) as T;
}

/**
 * Asserts that a log entry has all required base fields.
 *
 * @param log - Log entry to verify
 * @param operation - Expected operation name
 */
export function assertLogHasRequiredFields(log: CleanupLogEntry, operation: string): void {
  expect(log).toHaveProperty('level');
  expect(log).toHaveProperty('timestamp');
  expect(log).toHaveProperty('operation');

  expect(typeof log.level).toBe('string');
  expect(typeof log.timestamp).toBe('string');
  expect(typeof log.operation).toBe('string');

  if (log.message !== undefined) {
    expect(typeof log.message).toBe('string');
  }

  if (log.timestamp !== undefined) {
    expect(log.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  if (log.operation !== undefined) {
    expect(log.operation).toBe(operation);
  }
}

/**
 * Asserts that console output includes expected cleanup prefix.
 *
 * @param spy - Console spy to check
 * @param operation - Expected operation name in prefix
 */
export function assertConsolePrefix(spy: SpyInstance, operation: string): void {
  expect(spy).toHaveBeenCalled();
  const callArgs = spy.mock.calls[0];
  if (callArgs !== undefined && callArgs[0] !== undefined) {
    expect(callArgs[0]).toBe(`[Cleanup:${operation}]`);
  }
}

/**
 * Finds logs by level in a log array.
 *
 * @param logs - Array of log entries
 * @param level - Log level to filter by
 * @returns Filtered array of logs with specified level
 */
export function findLogsByLevel(logs: CleanupLogEntry[], level: LogLevel): CleanupLogEntry[] {
  return logs.filter(log => log.level === level);
}

/**
 * Finds logs by message content.
 *
 * @param logs - Array of log entries
 * @param message - Message text to search for (partial match)
 * @returns Filtered array of logs with matching message
 */
export function findLogsByMessage(logs: CleanupLogEntry[], message: string): CleanupLogEntry[] {
  return logs.filter(log => log.message?.includes(message));
}

/**
 * Finds a specific log entry by exact message match.
 *
 * @param logs - Array of log entries
 * @param message - Exact message text to match
 * @returns First matching log entry or undefined
 */
export function findLogByExactMessage(logs: CleanupLogEntry[], message: string): CleanupLogEntry | undefined {
  return logs.find(log => log.message !== undefined && log.message === message);
}

/**
 * Asserts that metrics match expected values.
 *
 * @param actual - Actual metrics from logger
 * @param expected - Expected metric values
 */
export function assertMetricsMatch(
  actual: CleanupMetrics,
  expected: Partial<CleanupMetrics>
): void {
  if (expected.filesScanned !== undefined && actual.filesScanned !== undefined) {
    expect(actual.filesScanned).toBe(expected.filesScanned);
  }
  if (expected.orphansIdentified !== undefined && actual.orphansIdentified !== undefined) {
    expect(actual.orphansIdentified).toBe(expected.orphansIdentified);
  }
  if (expected.deletionsSucceeded !== undefined && actual.deletionsSucceeded !== undefined) {
    expect(actual.deletionsSucceeded).toBe(expected.deletionsSucceeded);
  }
  if (expected.deletionsFailed !== undefined && actual.deletionsFailed !== undefined) {
    expect(actual.deletionsFailed).toBe(expected.deletionsFailed);
  }
  if (expected.errors !== undefined && actual.errors !== undefined) {
    expect(actual.errors).toHaveLength(expected.errors.length);
  }
}

/**
 * Asserts that metrics has valid timing information.
 *
 * @param metrics - Metrics to verify
 */
export function assertMetricsTimingValid(metrics: CleanupMetrics): void {
  expect(metrics.startTime).toBeDefined();
  expect(metrics.endTime).toBeDefined();
  if (metrics.duration !== undefined) {
    expect(metrics.duration).toBeGreaterThanOrEqual(0);
  }

  // Verify ISO 8601 format
  if (metrics.startTime !== undefined) {
    expect(metrics.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }
  if (metrics.endTime !== undefined) {
    expect(metrics.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  }

  // Verify timestamps are parseable
  if (metrics.startTime !== undefined && metrics.endTime !== undefined) {
    const startDate = new Date(metrics.startTime);
    const endDate = new Date(metrics.endTime);
    expect(startDate.toISOString()).toBe(metrics.startTime);
    expect(endDate.toISOString()).toBe(metrics.endTime);
  }
}

/**
 * Configuration for mock cleanup operations.
 */
export interface MockCleanupConfig {
  filesScanned?: number | undefined;
  orphansIdentified?: number | undefined;
  deletionsSucceeded?: number | undefined;
  deletionsFailed?: number | undefined;
  errors?: Array<{
    streamId?: number | undefined;
    filename?: string | undefined;
    error: string;
    errorType?: string | undefined;
  }> | undefined;
}

/**
 * Runs a mock cleanup operation with specified configuration.
 *
 * @param logger - CleanupLogger instance
 * @param config - Configuration for the mock operation
 */
export function runMockCleanup(logger: CleanupLogger, config: MockCleanupConfig): void {
  const {
    filesScanned = 100,
    orphansIdentified = 10,
    deletionsSucceeded = 8,
    deletionsFailed = 2,
    errors = [],
  } = config;

  logger.info('Starting mock cleanup', { directory: '/mock/test' });

  // Simulate scanning
  logger.incrementFilesScanned(filesScanned);
  logger.debug(`Scanned ${filesScanned} files`);

  // Simulate finding orphans
  logger.incrementOrphansIdentified(orphansIdentified);
  logger.info(`Found ${orphansIdentified} orphans`);

  // Simulate successful deletions
  logger.incrementDeletionsSucceeded(deletionsSucceeded);
  if (deletionsSucceeded > 0) {
    logger.debug(`Deleted ${deletionsSucceeded} files successfully`);
  }

  // Simulate failed deletions with errors
  logger.incrementDeletionsFailed(deletionsFailed);
  errors.forEach((errorConfig) => {
    logger.error('Deletion failed', errorConfig);
    if (errorConfig.streamId !== undefined && errorConfig.filename !== undefined) {
      logger.recordError(
        errorConfig.streamId,
        errorConfig.filename,
        errorConfig.error,
        errorConfig.errorType
      );
    }
  });

  logger.info('Mock cleanup complete');
}

/**
 * Creates a mock metrics object for testing.
 *
 * @param overrides - Optional overrides for default values
 * @returns Mock CleanupMetrics object
 */
export function createMockMetrics(overrides?: Partial<CleanupMetrics>): CleanupMetrics {
  const defaultMetrics: CleanupMetrics = {
    startTime: '2024-01-01T10:00:00.000Z',
    endTime: '2024-01-01T10:00:05.000Z',
    duration: 5000,
    filesScanned: 100,
    orphansIdentified: 10,
    deletionsSucceeded: 8,
    deletionsFailed: 2,
    errors: [
      {
        streamId: 1,
        filename: 'file1.dat',
        error: 'Permission denied',
        errorType: 'PermissionError',
        timestamp: '2024-01-01T10:00:01.000Z',
      },
      {
        streamId: 2,
        filename: 'file2.dat',
        error: 'File not found',
        errorType: 'NotFoundError',
        timestamp: '2024-01-01T10:00:02.000Z',
      },
    ],
  };

  return { ...defaultMetrics, ...overrides };
}

/**
 * Cleans up and resets test state.
 *
 * Call this in beforeEach or afterEach to ensure test isolation.
 */
export function cleanupTestState(): void {
  vi.clearAllMocks();
}

/**
 * Creates a CleanupLogger instance with test-friendly defaults.
 *
 * @param operationName - Name for the cleanup operation
 * @returns Configured CleanupLogger instance
 */
export function createTestLogger(operationName: string = 'test-operation'): CleanupLogger {
  return new CleanupLogger(operationName);
}

/**
 * Asserts that all console outputs are parseable JSON.
 *
 * @param spies - ConsoleSpies object to verify
 */
export function assertAllOutputsParseable(spies: ConsoleSpies): void {
  Object.entries(spies).forEach(([level, spy]) => {
    if (spy.mock.calls.length === 0) return;

    spy.mock.calls.forEach((callArgs: unknown[], callIndex: number) => {
      expect(callArgs).toHaveLength(2);
      const secondArg = callArgs[1];
      if (secondArg !== undefined) {
        expect(() => JSON.parse(secondArg as string)).not.toThrow();

        const parsed = JSON.parse(secondArg as string);
        expect(parsed).toHaveProperty('level');
        expect(parsed).toHaveProperty('timestamp');
        expect(parsed).toHaveProperty('operation');
        expect(parsed).toHaveProperty('message');
      }
    });
  });
}

/**
 * Verifies that a specific error type appears in metrics errors.
 *
 * @param metrics - Metrics to check
 * @param errorType - Error type to search for
 * @returns Number of errors with the specified type
 */
export function countErrorsByType(metrics: CleanupMetrics, errorType: string): number {
  return metrics.errors.filter(e => e.errorType === errorType).length;
}

/**
 * Verifies that errors for a specific stream ID appear in metrics.
 *
 * @param metrics - Metrics to check
 * @param streamId - Stream ID to search for
 * @returns Array of errors for the specified stream
 */
export function findErrorsByStreamId(metrics: CleanupMetrics, streamId: number): CleanupMetrics['errors'] {
  return metrics.errors.filter(e => e.streamId === streamId);
}

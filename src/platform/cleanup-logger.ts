/**
 * Structured logging utility for cleanup operations.
 *
 * ## T4 Privacy Compliance Context (plan.md §12 T4b, E11)
 *
 * **This logger supports T4b/E11 cleanup operations with audit trails.**
 * While not directly implementing deletion requirements, this logger provides
 * the structured logging needed to verify that cleanup operations complete
 * successfully for privacy compliance.
 *
 * **Why logging is critical for T4 compliance:**
 * The flagship use case involves transferring SSH keys, PSBTs, and TOTP seeds —
 * high-value secrets where deletion MUST be verifiable. This logger provides
 * detailed metrics and error tracking to confirm cleanup succeeded.
 *
 * **T4b requirement (plan.md §12):**
 * > Wipe receiver outputs on completion, on cancel, and on startup-reap (E11).
 *
 * **Reference:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 *
 * Provides consistent, filterable logging with:
 * - JSON-structured logs for machine parsing
 * - Timing information for performance tracking
 * - Count metrics for operations
 * - Error tracking and reporting
 *
 * Reference: bead bf-4pmk
 */

/**
 * Log levels for filtering.
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Structured log entry.
 */
export interface CleanupLogEntry {
  /** Log level */
  level: LogLevel;
  /** Timestamp in ISO format */
  timestamp: string;
  /** Operation being logged */
  operation: string;
  /** Additional properties */
  [key: string]: any;
}

/**
 * Cleanup metrics summary.
 */
export interface CleanupMetrics {
  /** Operation start timestamp */
  startTime: string;
  /** Operation end timestamp */
  endTime: string;
  /** Total duration in milliseconds */
  duration: number;
  /** Number of files scanned */
  filesScanned: number;
  /** Number of orphans identified */
  orphansIdentified: number;
  /** Number of files deleted successfully */
  deletionsSucceeded: number;
  /** Number of deletion failures */
  deletionsFailed: number;
  /** Errors encountered */
  errors: Array<{
    streamId?: number;
    filename?: string;
    error: string;
    timestamp: string;
  }>;
}

/**
 * Cleanup logger class.
 */
export class CleanupLogger {
  private logs: CleanupLogEntry[] = [];
  private metrics: Partial<CleanupMetrics>;
  private startTime: number;
  private operationName: string;

  constructor(operationName: string) {
    this.operationName = operationName;
    this.startTime = Date.now();
    const startTime = new Date().toISOString();
    this.metrics = {
      startTime,
      filesScanned: 0,
      orphansIdentified: 0,
      deletionsSucceeded: 0,
      deletionsFailed: 0,
      errors: [],
    };

    // Log operation start with timestamp
    this.log(LogLevel.INFO, 'Cleanup operation started', {
      startTime,
      operation: operationName,
    });
  }

  /**
   * Log a debug message.
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log an info message.
   */
  info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log an error message.
   */
  error(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, data);
  }

  /**
   * Internal log method.
   */
  private log(level: LogLevel, message: string, data?: Record<string, any>): void {
    const entry: CleanupLogEntry = {
      level,
      timestamp: new Date().toISOString(),
      operation: this.operationName,
      message,
      ...data,
    };

    this.logs.push(entry);

    // Also output to console with appropriate prefix
    const consoleLog = level === LogLevel.ERROR ? console.error :
                      level === LogLevel.WARN ? console.warn :
                      level === LogLevel.DEBUG ? console.debug :
                      console.log;

    consoleLog(`[Cleanup:${this.operationName}]`, JSON.stringify(entry));
  }

  /**
   * Increment files scanned count.
   */
  incrementFilesScanned(count: number = 1): void {
    (this.metrics.filesScanned as number) += count;
  }

  /**
   * Increment orphans identified count.
   */
  incrementOrphansIdentified(count: number = 1): void {
    (this.metrics.orphansIdentified as number) += count;
  }

  /**
   * Increment deletions succeeded count.
   */
  incrementDeletionsSucceeded(count: number = 1): void {
    (this.metrics.deletionsSucceeded as number) += count;
  }

  /**
   * Increment deletions failed count.
   */
  incrementDeletionsFailed(count: number = 1): void {
    (this.metrics.deletionsFailed as number) += count;
  }

  /**
   * Record an error.
   */
  recordError(streamId: number | undefined, filename: string | undefined, error: string): void {
    this.metrics.errors!.push({
      streamId,
      filename,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Complete the logging and return final metrics.
   */
  complete(): CleanupMetrics {
    const endTime = Date.now();
    const duration = endTime - this.startTime;

    const finalMetrics: CleanupMetrics = {
      startTime: this.metrics.startTime!,
      endTime: new Date().toISOString(),
      duration,
      filesScanned: this.metrics.filesScanned!,
      orphansIdentified: this.metrics.orphansIdentified!,
      deletionsSucceeded: this.metrics.deletionsSucceeded!,
      deletionsFailed: this.metrics.deletionsFailed!,
      errors: this.metrics.errors!,
    };

    this.info('Cleanup operation completed', {
      duration: `${duration.toFixed(2)}ms`,
      filesScanned: finalMetrics.filesScanned,
      orphansIdentified: finalMetrics.orphansIdentified,
      deletionsSucceeded: finalMetrics.deletionsSucceeded,
      deletionsFailed: finalMetrics.deletionsFailed,
      errorCount: finalMetrics.errors.length,
    });

    return finalMetrics;
  }

  /**
   * Get all log entries.
   */
  getLogs(): CleanupLogEntry[] {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level.
   */
  getLogsByLevel(level: LogLevel): CleanupLogEntry[] {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Get logs filtered by time range.
   */
  getLogsByTimeRange(startTime: string, endTime: string): CleanupLogEntry[] {
    return this.logs.filter(log =>
      log.timestamp >= startTime && log.timestamp <= endTime
    );
  }
}

/**
 * Format metrics as human-readable string.
 */
export function formatCleanupMetricsSummary(metrics: CleanupMetrics): string {
  const lines = [
    '=== Cleanup Metrics Summary ===',
    `Operation: ${metrics.startTime} → ${metrics.endTime}`,
    `Duration: ${metrics.duration.toFixed(2)}ms`,
    '',
    'Counts:',
    `  Files scanned: ${metrics.filesScanned}`,
    `  Orphans identified: ${metrics.orphansIdentified}`,
    `  Deletions succeeded: ${metrics.deletionsSucceeded}`,
    `  Deletions failed: ${metrics.deletionsFailed}`,
  ];

  if (metrics.errors.length > 0) {
    lines.push('', 'Errors:');
    metrics.errors.forEach((err, i) => {
      lines.push(`  ${i + 1}. ${err.filename || 'unknown'} (${err.streamId || 'unknown'}): ${err.error}`);
    });
  }

  return lines.join('\n');
}

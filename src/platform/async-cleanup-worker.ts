/**
 * Async cleanup deletion worker for orphaned files.
 *
 * ## T4 Privacy Compliance (Critical - plan.md §12 T4b, E11)
 *
 * **This module implements the background deletion portion of T4b compliance.**
 * The worker handles the actual deletion of orphaned files identified by
 * startup cleanup (E11) and after-export cleanup (T4b).
 *
 * **Why background deletion is critical:**
 * The flagship use case involves transferring SSH keys, PSBTs, and TOTP seeds —
 * high-value secrets that MUST be deleted reliably even if individual deletions
 * fail temporarily. This worker provides retry logic and batch processing
 * to ensure cleanup completes without blocking the UI.
 *
 * **E11 requirement (plan.md §12):**
 * > On startup, reap abandoned staging files with no active session.
 *
 * **T4b requirement (plan.md §12):**
 * > Wipe receiver outputs on completion, on cancel, and on startup-reap (E11).
 *
 * **Implementation:**
 * - Batch processing to avoid blocking UI
 * - Retry logic for transient deletion failures
 * - Error handling for each file (continues even if some fail)
 * - Progress logging for debugging
 *
 * **Reference:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 *
 * Processes file deletions asynchronously with:
 * - Batch processing to avoid blocking
 * - Error handling for each file
 * - Success/failure tracking
 * - Progress logging
 *
 * Reference: bead bf-408r
 */

import type { OrphanedFile, StorageManager } from './storage.js';
import { CleanupLogger, type CleanupMetrics } from './cleanup-logger.js';

/**
 * Result of a single file deletion attempt.
 */
export interface DeletionResult {
  /** Stream ID of the file */
  streamId: number;
  /** Filename for logging */
  filename: string;
  /** Whether deletion succeeded */
  success: boolean;
  /** Error message if deletion failed */
  error?: string;
  /** Error type/name if deletion failed (e.g., 'NotFoundError', 'PermissionError') */
  errorType?: string;
  /** Timestamp of deletion attempt */
  timestamp: number;
  /** Duration of deletion attempt in milliseconds */
  duration: number;
}

/**
 * Metrics for a cleanup worker run.
 */
export interface CleanupWorkerMetrics {
  /** Total files processed */
  total: number;
  /** Number of successful deletions */
  succeeded: number;
  /** Number of failed deletions */
  failed: number;
  /** Total duration in milliseconds */
  duration: number;
  /** Per-file results */
  results: DeletionResult[];
  /** Failed deletion results (subset of results) */
  failures: DeletionResult[];
}

/**
 * Configuration for cleanup worker.
 */
export interface CleanupWorkerConfig {
  /** Number of files to process in each batch */
  batchSize: number;
  /** Delay between batches in milliseconds */
  delayBetweenBatches: number;
  /** Maximum number of retry attempts for failed deletions */
  maxRetries: number;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: CleanupWorkerConfig = {
  batchSize: 5,
  delayBetweenBatches: 100,
  maxRetries: 2,
};

/**
 * Progress callback during cleanup.
 */
export interface CleanupProgressCallback {
  (progress: {
    current: number;
    total: number;
    succeeded: number;
    failed: number;
  }): void;
}

/**
 * Async cleanup deletion worker.
 *
 * Processes orphaned file deletions in batches to avoid blocking
 * the main thread. Handles errors gracefully and provides detailed
 * metrics.
 */
export class AsyncCleanupWorker {
  private config: CleanupWorkerConfig;
  private storageManager: StorageManager;
  private logger: CleanupLogger;

  constructor(
    storageManager: StorageManager,
    config: Partial<CleanupWorkerConfig> = {},
    logger?: CleanupLogger
  ) {
    this.storageManager = storageManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger || new CleanupLogger('async-cleanup-worker');
  }

  /**
   * Process orphaned file deletions asynchronously.
   *
   * ## T4 Privacy Compliance (Critical - plan.md §12 T4b, E11)
   *
   * **This method executes the background deletion for T4b/E11 cleanup.**
   * It processes the list of orphaned files identified by startup cleanup (E11)
   * or after export completion (T4b), ensuring reliable deletion without UI blocking.
   *
   * **Why background processing is critical:**
   * The flagship use case involves transferring SSH keys, PSBTs, and TOTP seeds —
   * high-value secrets that MUST be deleted reliably. Batch processing prevents
   * UI freezing while retry logic ensures deletion succeeds even with transient errors.
   *
   * **T4b requirement (plan.md §12):**
   * > Wipe receiver outputs on completion, on cancel, and on startup-reap (E11).
   *
   * **Implementation:**
   * - Processes files in configurable batches (default: 5 at a time)
   * - Retry logic for each file (default: 2 attempts with exponential backoff)
   * - Continues on individual failures (logs but doesn't abort)
   * - Progress callbacks for UI feedback
   *
   * **Reference:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
   *
   * @param orphans - List of orphaned files to delete
   * @param onProgress - Optional progress callback
   * @returns Cleanup metrics with success/failure counts
   */
  async processDeletions(
    orphans: OrphanedFile[],
    onProgress?: CleanupProgressCallback
  ): Promise<CleanupWorkerMetrics> {
    this.logger.info('Starting deletion of orphaned files', {
      total: orphans.length,
      config: {
        batchSize: this.config.batchSize,
        delayBetweenBatches: this.config.delayBetweenBatches,
        maxRetries: this.config.maxRetries,
      },
    });

    // Track files scanned for metrics
    this.logger.incrementFilesScanned(orphans.length);
    this.logger.incrementOrphansIdentified(orphans.length);

    const results: DeletionResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process files in batches
    for (let i = 0; i < orphans.length; i += this.config.batchSize) {
      const batch = orphans.slice(i, i + this.config.batchSize);
      const batchNumber = Math.floor(i / this.config.batchSize) + 1;
      const totalBatches = Math.ceil(orphans.length / this.config.batchSize);

      this.logger.debug('Processing batch', {
        batch: {
          number: batchNumber,
          total: totalBatches,
          size: batch.length,
        },
      });

      // Process all files in current batch concurrently
      const batchResults = await Promise.allSettled(
        batch.map(orphan => this.deleteWithRetry(orphan))
      );

      // Collect results from this batch
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          if (result.value.success) {
            succeeded++;
            this.logger.incrementDeletionsSucceeded();
          } else {
            failed++;
            this.logger.incrementDeletionsFailed();
            this.logger.recordError(
              result.value.streamId,
              result.value.filename,
              result.value.error || 'Unknown error',
              result.value.errorType
            );
          }
        } else {
          // Promise was rejected (should not happen with deleteWithRetry error handling)
          const errorResult: DeletionResult = {
            streamId: -1,
            filename: 'unknown',
            success: false,
            error: `Promise rejected: ${result.reason}`,
            errorType: 'PromiseRejection',
            timestamp: Date.now(),
            duration: 0,
          };
          results.push(errorResult);
          failed++;
          this.logger.incrementDeletionsFailed();
          this.logger.recordError(-1, 'unknown', `Promise rejected: ${result.reason}`, 'PromiseRejection');
        }
      }

      // Report progress
      if (onProgress) {
        onProgress({
          current: i + batch.length,
          total: orphans.length,
          succeeded,
          failed,
        });
      }

      // Add delay between batches (except after last batch)
      if (i + this.config.batchSize < orphans.length && this.config.delayBetweenBatches > 0) {
        await this.delay(this.config.delayBetweenBatches);
      }
    }

    const failures = results.filter(r => !r.success);

    // Complete logging and get metrics
    const cleanupMetrics = this.logger.complete();

    if (failures.length > 0) {
      this.logger.warn('Some deletions failed', {
        count: failures.length,
        failures: failures.map(f => ({
          streamId: f.streamId,
          filename: f.filename,
          error: f.error,
        })),
      });
    }

    return {
      total: orphans.length,
      succeeded,
      failed,
      duration: cleanupMetrics.duration,
      results,
      failures,
    };
  }

  /**
   * Delete a single file with retry logic.
   *
   * ## T4 Privacy Compliance (Critical - plan.md §12 T4b, E11)
   *
   * **This method implements reliable deletion for T4b/E11 compliance.**
   * It retries deletion attempts to handle transient failures (file locks, browser quirks)
   * that could otherwise leave plaintext secrets exposed in OPFS.
   *
   * **Why retry logic is critical:**
   * The flagship use case involves transferring SSH keys, PSBTs, and TOTP seeds —
   * high-value secrets where deletion MUST succeed even with transient errors.
   * Browser OPFS can have temporary locks or timing issues; retries prevent
   * premature failure that would leave secrets exposed.
   *
   * **T4b requirement (plan.md §12):**
   * > Wipe receiver outputs on completion, on cancel, and on startup-reap (E11).
   *
   * **Implementation:**
   * - Multiple retry attempts (default: 2) with exponential backoff
   * - Detailed logging for each attempt (success/failure)
   * - Returns detailed result even on final failure
   *
   * **Reference:** docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
   *
   * @param orphan - Orphaned file metadata
   * @returns Deletion result
   */
  private async deleteWithRetry(orphan: OrphanedFile): Promise<DeletionResult> {
    const startTime = performance.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.storageManager.deleteOutput(orphan.streamId, orphan.filename);

        const duration = performance.now() - startTime;
        const result: DeletionResult = {
          streamId: orphan.streamId,
          filename: orphan.filename,
          success: true,
          timestamp: Date.now(),
          duration,
        };

        if (attempt > 1) {
          this.logger.info('File deleted on retry', {
            file: {
              streamId: orphan.streamId,
              filename: orphan.filename,
            },
            attempt: {
              current: attempt,
              max: this.config.maxRetries,
            },
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Log retry attempt
        if (attempt < this.config.maxRetries) {
          this.logger.warn('Deletion attempt failed, will retry', {
            file: {
              streamId: orphan.streamId,
              filename: orphan.filename,
            },
            attempt: {
              current: attempt,
              max: this.config.maxRetries,
            },
            error: lastError.message,
            errorType: lastError.constructor.name || lastError.name || 'Unknown',
          });

          // Exponential backoff before retry
          await this.delay(Math.pow(2, attempt) * 50);
        }
      }
    }

    // All retries exhausted
    const duration = performance.now() - startTime;
    const errorType = lastError?.constructor.name || lastError?.name || 'Unknown';
    const result: DeletionResult = {
      streamId: orphan.streamId,
      filename: orphan.filename,
      success: false,
      error: lastError?.message || 'Unknown error',
      errorType,
      timestamp: Date.now(),
      duration,
    };

    this.logger.error('All deletion attempts failed', {
      file: {
        streamId: orphan.streamId,
        filename: orphan.filename,
      },
      attempts: this.config.maxRetries,
      error: lastError?.message || 'Unknown error',
      errorType,
    });

    return result;
  }

  /**
   * Delay helper.
   *
   * @param ms - Milliseconds to delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create and run an async cleanup worker.
 *
 * Convenience function that creates a worker and processes deletions.
 *
 * @param storageManager - Storage manager instance
 * @param orphans - List of orphaned files to delete
 * @param config - Optional worker configuration
 * @param onProgress - Optional progress callback
 * @param logger - Optional cleanup logger (defaults to new instance)
 * @returns Cleanup metrics
 */
export async function runAsyncCleanup(
  storageManager: StorageManager,
  orphans: OrphanedFile[],
  config?: Partial<CleanupWorkerConfig>,
  onProgress?: CleanupProgressCallback,
  logger?: CleanupLogger
): Promise<CleanupWorkerMetrics> {
  const worker = new AsyncCleanupWorker(storageManager, config, logger);
  return worker.processDeletions(orphans, onProgress);
}

/**
 * Format deletion metrics as a human-readable string.
 *
 * @param metrics - Cleanup metrics
 * @returns Formatted string
 */
export function formatCleanupMetrics(metrics: CleanupWorkerMetrics): string {
  const lines = [
    `Cleanup Results:`,
    `  Total: ${metrics.total}`,
    `  Succeeded: ${metrics.succeeded}`,
    `  Failed: ${metrics.failed}`,
    `  Duration: ${metrics.duration.toFixed(0)}ms`,
  ];

  if (metrics.failures.length > 0) {
    lines.push(`\nFailed deletions:`);
    for (const failure of metrics.failures) {
      const errorType = failure.errorType ? ` [${failure.errorType}]` : '';
      lines.push(`  - ${failure.filename} (${failure.streamId}):${errorType} ${failure.error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Async cleanup deletion worker for orphaned files.
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

  constructor(storageManager: StorageManager, config: Partial<CleanupWorkerConfig> = {}) {
    this.storageManager = storageManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Process orphaned file deletions asynchronously.
   *
   * @param orphans - List of orphaned files to delete
   * @param onProgress - Optional progress callback
   * @returns Cleanup metrics with success/failure counts
   */
  async processDeletions(
    orphans: OrphanedFile[],
    onProgress?: CleanupProgressCallback
  ): Promise<CleanupWorkerMetrics> {
    const startTime = performance.now();
    const total = orphans.length;

    console.log(`[AsyncCleanupWorker] Starting deletion of ${total} orphaned file(s)`);
    console.log(`[AsyncCleanupWorker] Config: batch size=${this.config.batchSize}, delay=${this.config.delayBetweenBatches}ms, retries=${this.config.maxRetries}`);

    const results: DeletionResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process files in batches
    for (let i = 0; i < orphans.length; i += this.config.batchSize) {
      const batch = orphans.slice(i, i + this.config.batchSize);
      const batchNumber = Math.floor(i / this.config.batchSize) + 1;
      const totalBatches = Math.ceil(orphans.length / this.config.batchSize);

      console.log(`[AsyncCleanupWorker] Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)`);

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
          } else {
            failed++;
          }
        } else {
          // Promise was rejected (should not happen with deleteWithRetry error handling)
          const errorResult: DeletionResult = {
            streamId: -1,
            filename: 'unknown',
            success: false,
            error: `Promise rejected: ${result.reason}`,
            timestamp: Date.now(),
            duration: 0,
          };
          results.push(errorResult);
          failed++;
        }
      }

      // Report progress
      if (onProgress) {
        onProgress({
          current: i + batch.length,
          total,
          succeeded,
          failed,
        });
      }

      // Add delay between batches (except after last batch)
      if (i + this.config.batchSize < orphans.length && this.config.delayBetweenBatches > 0) {
        await this.delay(this.config.delayBetweenBatches);
      }
    }

    const duration = performance.now() - startTime;
    const failures = results.filter(r => !r.success);

    console.log(`[AsyncCleanupWorker] Deletion complete: ${succeeded} succeeded, ${failed} failed, ${duration.toFixed(0)}ms`);

    if (failures.length > 0) {
      console.warn('[AsyncCleanupWorker] Failed deletions:', failures.map(f => `${f.filename} (${f.streamId}): ${f.error}`));
    }

    return {
      total,
      succeeded,
      failed,
      duration,
      results,
      failures,
    };
  }

  /**
   * Delete a single file with retry logic.
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
          console.log(`[AsyncCleanupWorker] Deleted ${orphan.filename} (stream ${orphan.streamId}) on attempt ${attempt}/${this.config.maxRetries}`);
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Log retry attempt
        if (attempt < this.config.maxRetries) {
          console.warn(`[AsyncCleanupWorker] Deletion attempt ${attempt}/${this.config.maxRetries} failed for ${orphan.filename} (${orphan.streamId}): ${lastError.message}`);

          // Exponential backoff before retry
          await this.delay(Math.pow(2, attempt) * 50);
        }
      }
    }

    // All retries exhausted
    const duration = performance.now() - startTime;
    const result: DeletionResult = {
      streamId: orphan.streamId,
      filename: orphan.filename,
      success: false,
      error: lastError?.message || 'Unknown error',
      timestamp: Date.now(),
      duration,
    };

    console.error(`[AsyncCleanupWorker] Failed to delete ${orphan.filename} (${orphan.streamId}) after ${this.config.maxRetries} attempts: ${lastError?.message}`);

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
 * @returns Cleanup metrics
 */
export async function runAsyncCleanup(
  storageManager: StorageManager,
  orphans: OrphanedFile[],
  config?: Partial<CleanupWorkerConfig>,
  onProgress?: CleanupProgressCallback
): Promise<CleanupWorkerMetrics> {
  const worker = new AsyncCleanupWorker(storageManager, config);
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
      lines.push(`  - ${failure.filename} (${failure.streamId}): ${failure.error}`);
    }
  }

  return lines.join('\n');
}

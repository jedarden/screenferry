/**
 * Basic heap measurement utilities for integration tests.
 *
 * Provides standalone functions for capturing heap usage statistics.
 * These utilities are simpler than the full MemoryProfiler class and
 * are designed for single-point memory measurements.
 *
 * Reference: bead bf-i0wkw
 */

/**
 * Basic heap usage metrics at a point in time.
 */
export interface HeapMetrics {
  /** Timestamp when the snapshot was taken (milliseconds since epoch) */
  timestamp: number;
  /** Current size of the V8 heap in bytes */
  heapUsed: number;
  /** Total size of the V8 heap in bytes */
  heapTotal: number;
  /** Memory allocated outside V8 (e.g., Buffers) in bytes */
  external: number;
  /** Resident Set Size - total memory allocated for the process (bytes) */
  rss: number;
  /** Total size of all ArrayBuffers in bytes */
  arrayBuffers: number;
}

/**
 * Capture current heap usage statistics.
 *
 * This function captures a snapshot of the Node.js process memory usage
 * at the moment it is called. It uses the built-in process.memoryUsage()
 * function which returns memory statistics from the V8 engine.
 *
 * @returns HeapMetrics object with current memory usage statistics
 *
 * @example
 * ```ts
 * const before = captureHeapMetrics();
 * // ... perform operation ...
 * const after = captureHeapMetrics();
 * const delta = after.heapUsed - before.heapUsed;
 * console.log(`Heap delta: ${(delta / 1024 / 1024).toFixed(2)} MB`);
 * ```
 */
export function captureHeapMetrics(): HeapMetrics {
  const usage = process.memoryUsage();

  return {
    timestamp: Date.now(),
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss,
    arrayBuffers: usage.arrayBuffers,
  };
}

/**
 * Calculate the difference between two heap metrics snapshots.
 *
 * @param baseline - The baseline (before) metrics
 * @param current - The current (after) metrics
 * @returns Object containing the difference for each metric
 *
 * @example
 * ```ts
 * const before = captureHeapMetrics();
 * await someOperation();
 * const after = captureHeapMetrics();
 * const delta = calculateHeapDelta(before, after);
 * console.log(`Heap used delta: ${(delta.heapUsed / 1024 / 1024).toFixed(2)} MB`);
 * ```
 */
export function calculateHeapDelta(
  baseline: HeapMetrics,
  current: HeapMetrics
): {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  arrayBuffers: number;
  elapsedMs: number;
} {
  return {
    heapUsed: current.heapUsed - baseline.heapUsed,
    heapTotal: current.heapTotal - baseline.heapTotal,
    external: current.external - baseline.external,
    rss: current.rss - baseline.rss,
    arrayBuffers: current.arrayBuffers - baseline.arrayBuffers,
    elapsedMs: current.timestamp - baseline.timestamp,
  };
}

/**
 * Format heap metrics for human-readable display.
 *
 * @param metrics - The metrics to format
 * @returns Formatted string representation
 *
 * @example
 * ```ts
 * const metrics = captureHeapMetrics();
 * console.log(formatHeapMetrics(metrics));
 * // Output: "Heap: 45.23 MB used / 100.00 MB total | RSS: 150.50 MB"
 * ```
 */
export function formatHeapMetrics(metrics: HeapMetrics): string {
  const heapUsedMB = (metrics.heapUsed / 1024 / 1024).toFixed(2);
  const heapTotalMB = (metrics.heapTotal / 1024 / 1024).toFixed(2);
  const externalMB = (metrics.external / 1024 / 1024).toFixed(2);
  const rssMB = (metrics.rss / 1024 / 1024).toFixed(2);

  return `Heap: ${heapUsedMB} MB used / ${heapTotalMB} MB total | External: ${externalMB} MB | RSS: ${rssMB} MB`;
}

/**
 * Format heap delta for human-readable display.
 *
 * @param delta - The delta to format (from calculateHeapDelta)
 * @returns Formatted string representation with signs (+/-)
 *
 * @example
 * ```ts
 * const before = captureHeapMetrics();
 * await someOperation();
 * const after = captureHeapMetrics();
 * const delta = calculateHeapDelta(before, after);
 * console.log(formatHeapDelta(delta));
 * // Output: "Heap: +5.23 MB | RSS: +8.50 MB | Elapsed: 1234 ms"
 * ```
 */
export function formatHeapDelta(delta: ReturnType<typeof calculateHeapDelta>): string {
  const formatBytes = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    const sign = mb >= 0 ? '+' : '';
    return `${sign}${mb.toFixed(2)} MB`;
  };

  return `Heap: ${formatBytes(delta.heapUsed)} | RSS: ${formatBytes(delta.rss)} | Elapsed: ${delta.elapsedMs} ms`;
}

/**
 * Assert that heap growth does not exceed a threshold.
 *
 * @param baseline - The baseline (before) metrics
 * @param current - The current (after) metrics
 * @param maxGrowthBytes - Maximum allowed heap growth in bytes (default: 10 MB)
 * @throws Error if heap growth exceeds the threshold
 *
 * @example
 * ```ts
 * const before = captureHeapMetrics();
 * await someOperation();
 * const after = captureHeapMetrics();
 * assertHeapGrowth(before, after, 10 * 1024 * 1024); // Max 10 MB growth
 * ```
 */
export function assertHeapGrowth(
  baseline: HeapMetrics,
  current: HeapMetrics,
  maxGrowthBytes: number = 10 * 1024 * 1024
): void {
  const growth = current.heapUsed - baseline.heapUsed;

  if (growth > maxGrowthBytes) {
    const growthMB = (growth / 1024 / 1024).toFixed(2);
    const maxMB = (maxGrowthBytes / 1024 / 1024).toFixed(2);
    throw new Error(
      `Heap growth of ${growthMB} MB exceeds maximum allowed ${maxMB} MB`
    );
  }
}

/**
 * Assert that current heap usage does not exceed a threshold.
 *
 * @param current - The current metrics to check
 * @param maxHeapBytes - Maximum allowed heap usage in bytes (default: 500 MB)
 * @throws Error if heap usage exceeds the threshold
 *
 * @example
 * ```ts
 * const metrics = captureHeapMetrics();
 * assertHeapUsage(metrics, 500 * 1024 * 1024); // Max 500 MB
 * ```
 */
export function assertHeapUsage(
  current: HeapMetrics,
  maxHeapBytes: number = 500 * 1024 * 1024
): void {
  if (current.heapUsed > maxHeapBytes) {
    const usedMB = (current.heapUsed / 1024 / 1024).toFixed(2);
    const maxMB = (maxHeapBytes / 1024 / 1024).toFixed(2);
    throw new Error(
      `Heap usage ${usedMB} MB exceeds maximum allowed ${maxMB} MB`
    );
  }
}

/**
 * Get heap usage as a percentage of total heap size.
 *
 * @param metrics - The metrics to analyze
 * @returns Heap usage percentage (0-100)
 *
 * @example
 * ```ts
 * const metrics = captureHeapMetrics();
 * const usagePercent = getHeapUsagePercent(metrics);
 * console.log(`Heap is ${usagePercent.toFixed(1)}% full`);
 * ```
 */
export function getHeapUsagePercent(metrics: HeapMetrics): number {
  if (metrics.heapTotal === 0) {
    return 0;
  }
  return (metrics.heapUsed / metrics.heapTotal) * 100;
}

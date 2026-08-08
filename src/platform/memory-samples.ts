/**
 * Memory sample data structure and storage (bf-3r7gi).
 *
 * Defines the basic structure for memory samples collected during test execution.
 * This provides a simple, focused interface for tracking heap usage at block intervals.
 *
 * Reference: bead bf-3r7gi
 */

/**
 * Memory sample collected at a specific point during execution.
 */
export interface MemorySample {
  /** Block number when the sample was collected */
  blockNumber: number;
  /** Timestamp when the sample was collected (milliseconds since epoch) */
  timestamp: number;
  /** Heap usage in bytes at the time of sampling */
  heapUsage: number;
}

/**
 * Storage for memory samples collected during test execution.
 */
export type MemorySampleStorage = MemorySample[];

/**
 * Create a new memory sample.
 *
 * @param blockNumber - Block number when the sample is collected
 * @param heapUsage - Heap usage in bytes (if not provided, current heap usage is measured)
 * @returns A new memory sample
 */
export function createMemorySample(
  blockNumber: number,
  heapUsage?: number
): MemorySample {
  return {
    blockNumber,
    timestamp: Date.now(),
    heapUsage: heapUsage ?? process.memoryUsage().heapUsed,
  };
}

/**
 * Create empty memory sample storage.
 *
 * @returns A new empty array for storing memory samples
 */
export function createMemorySampleStorage(): MemorySampleStorage {
  return [];
}

/**
 * Add a memory sample to storage.
 *
 * @param storage - The memory sample storage array
 * @param sample - The memory sample to add
 * @returns The updated storage with the new sample
 */
export function addMemorySample(
  storage: MemorySampleStorage,
  sample: MemorySample
): MemorySampleStorage {
  storage.push(sample);
  return storage;
}

/**
 * Get memory samples by block number range.
 *
 * @param storage - The memory sample storage
 * @param startBlock - Starting block number (inclusive)
 * @param endBlock - Ending block number (inclusive)
 * @returns Array of samples within the specified block range
 */
export function getSamplesInRange(
  storage: MemorySampleStorage,
  startBlock: number,
  endBlock: number
): MemorySample[] {
  return storage.filter(
    sample => sample.blockNumber >= startBlock && sample.blockNumber <= endBlock
  );
}

/**
 * Get the latest memory sample from storage.
 *
 * @param storage - The memory sample storage
 * @returns The latest sample or undefined if storage is empty
 */
export function getLatestSample(storage: MemorySampleStorage): MemorySample | undefined {
  return storage.length > 0 ? storage[storage.length - 1] : undefined;
}

/**
 * Calculate heap growth between two samples.
 *
 * @param earlier - The earlier memory sample
 * @param later - The later memory sample
 * @returns Heap growth in bytes (positive = growth, negative = reduction)
 */
export function calculateHeapGrowth(
  earlier: MemorySample,
  later: MemorySample
): number {
  return later.heapUsage - earlier.heapUsage;
}

/**
 * Capture a memory sample with error handling.
 *
 * This function captures current heap usage and stores it in the provided
 * storage array. It handles memory capture errors gracefully by returning
 * a success indicator rather than throwing.
 *
 * Integrates with existing memory utilities (bf-i0wkw) via process.memoryUsage().
 *
 * @param storage - The memory sample storage array
 * @param blockNumber - Current block number when sample is captured
 * @returns true if sample was captured and stored successfully, false on error
 *
 * @example
 * ```ts
 * const samples = createMemorySampleStorage();
 * for (let i = 0; i < 1000; i++) {
 *   processBlock(i);
 *   captureMemorySample(samples, i); // Hook into test loop
 * }
 * ```
 */
export function captureMemorySample(
  storage: MemorySampleStorage,
  blockNumber: number
): boolean {
  try {
    const sample = createMemorySample(blockNumber);
    addMemorySample(storage, sample);
    return true;
  } catch (error) {
    // Handle memory capture errors gracefully - log but don't throw
    // This ensures test loops can continue even if memory sampling fails
    console.error(`Failed to capture memory sample at block ${blockNumber}:`, error);
    return false;
  }
}

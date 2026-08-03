/**
 * Memory-bounded block storage (bf-1jet).
 *
 * Implements a fixed-memory block storage layer that maintains ≤1 MB working set:
 * - 264 KB payload GE context storage
 * - 264 KB manifest GE context storage
 * - LRU eviction when capacity exceeded
 * - Memory tracking and telemetry
 *
 * Design principles:
 * - Fixed memory ceiling regardless of block count
 * - Block churn: old blocks evicted as new ones arrive
 * - Two separate pools: payload and manifest (per I5 resolution, bf-28b)
 * - O(1) get/set operations with linked hash map
 *
 * Reference: plan.md §8.1, I6a, D19
 */

import { K, L } from '../params.js';

/**
 * GE context memory size calculation.
 *
 * Per fountain decoder structure:
 * - Matrix: K²/8 bytes (coefficient masks in pivMask)
 * - Payload: K×L bytes (fragment data in pivPay)
 *
 * At K=768, L=256: 72 KB + 192 KB = 264 KB per context.
 */
export function calculateGEContextSize(k: number = K, l: number = L): number {
  const matrixSize = (k * k) / 8;  // Coefficient storage
  const payloadSize = k * l;        // Fragment storage
  return matrixSize + payloadSize;
}

/**
 * Default memory limits for the two context pools.
 *
 * Total: 528 KB (264 KB payload + 264 KB manifest).
 * This fits comfortably within the 1 MB I6a working set,
 * leaving ~472 KB for other runtime needs.
 */
export const PAYLOAD_CONTEXT_LIMIT = 264 * 1024;  // 264 KB
export const MANIFEST_CONTEXT_LIMIT = 264 * 1024; // 264 KB

/**
 * Memory pool statistics for telemetry.
 */
export interface MemoryPoolStats {
  /** Pool type ('payload' or 'manifest') */
  pool: 'payload' | 'manifest';
  /** Current memory usage in bytes */
  currentBytes: number;
  /** Maximum capacity in bytes */
  capacityBytes: number;
  /** Number of contexts stored */
  contextCount: number;
  /** Total eviction events */
  evictions: number;
  /** Current utilization ratio (0-1) */
  utilization: number;
}

/**
 * Storage statistics for telemetry.
 */
export interface StorageStats {
  /** Payload pool statistics */
  payload: MemoryPoolStats;
  /** Manifest pool statistics */
  manifest: MemoryPoolStats;
  /** Total memory usage across both pools */
  totalBytes: number;
  /** Total capacity across both pools */
  totalCapacity: number;
  /** Combined utilization ratio (0-1) */
  totalUtilization: number;
}

/**
 * GE context storage entry.
 *
 * Stores the decoder state for a specific block index.
 * Size is roughly calculateGEContextSize() bytes.
 */
export interface ContextEntry {
  /** Block index for this context */
  blockIndex: number;
  /** GE decoder pivots (Map<seq, GERow>) */
  pivots: Map<number, GERow>;
  /** Current decoder rank */
  rank: number;
  /** Timestamp for LRU tracking */
  lastAccess: number;
  /** Estimated memory size in bytes */
  sizeBytes: number;
}

/**
 * GE row representation (from fountain decoder).
 *
 * Minimal representation needed to reconstruct decoder state.
 */
export interface GERow {
  /** Coefficient mask (Uint32Array from decoder pivMask) */
  mask: Uint32Array | null;
  /** Payload data (Uint8Array from decoder pivPay) */
  payload: Uint8Array | null;
}

/**
 * Memory pool for GE contexts with LRU eviction.
 *
 * Implements fixed-size storage with automatic churn:
 * - When adding would exceed capacity, evict least-recently-used
 * - O(1) access via block index
 * - O(1) insertion with potential eviction
 * - Memory tracking per entry
 */
class MemoryPool {
  private readonly storage: Map<number, ContextEntry>;
  private readonly lruList: LRUListNode[];
  private readonly lruMap: Map<number, LRUListNode>;
  private currentBytes: number;
  private evictions: number;
  private head: LRUListNode | null;
  private tail: LRUListNode | null;

  constructor(
    private readonly capacity: number,
    private readonly poolType: 'payload' | 'manifest'
  ) {
    this.storage = new Map();
    this.lruList = [];
    this.lruMap = new Map();
    this.currentBytes = 0;
    this.evictions = 0;
    this.head = null;
    this.tail = null;
  }

  /**
   * Get a context entry by block index.
   *
   * Updates access time for LRU tracking.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Context entry if found, undefined otherwise
   */
  get(blockIndex: number): ContextEntry | undefined {
    const entry = this.storage.get(blockIndex);
    if (!entry) return undefined;

    // Update LRU order
    this.moveToFront(blockIndex);
    entry.lastAccess = Date.now();

    return entry;
  }

  /**
   * Store a context entry, evicting if necessary.
   *
   * If the new entry would exceed capacity, evicts least-recently-used
   * entries until there's room. Returns the evicted block indices.
   *
   * @param entry - Context entry to store
   * @returns Array of evicted block indices (may be empty)
   */
  set(entry: ContextEntry): number[] {
    const evicted: number[] = [];

    // Check if replacing existing entry
    const existing = this.storage.get(entry.blockIndex);
    if (existing) {
      this.currentBytes -= existing.sizeBytes;
      this.removeLRU(entry.blockIndex);
    }

    // Evict until there's room
    while (this.currentBytes + entry.sizeBytes > this.capacity && this.storage.size > 0) {
      const lruBlockIndex = this.evictLRU();
      if (lruBlockIndex === null) break; // Shouldn't happen
      evicted.push(lruBlockIndex);
      this.evictions++;
    }

    // Check if entry fits
    if (entry.sizeBytes > this.capacity) {
      throw new Error(
        `Context size (${entry.sizeBytes} bytes) exceeds pool capacity (${this.capacity} bytes)`
      );
    }

    // Store the entry
    this.storage.set(entry.blockIndex, entry);
    this.currentBytes += entry.sizeBytes;
    this.insertLRU(entry.blockIndex);

    return evicted;
  }

  /**
   * Check if a block index is stored.
   */
  has(blockIndex: number): boolean {
    return this.storage.has(blockIndex);
  }

  /**
   * Remove a specific entry.
   *
   * @param blockIndex - Block index to remove
   * @returns true if entry was removed, false if not found
   */
  delete(blockIndex: number): boolean {
    const entry = this.storage.get(blockIndex);
    if (!entry) return false;

    this.currentBytes -= entry.sizeBytes;
    this.storage.delete(blockIndex);
    this.removeLRU(blockIndex);
    return true;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.storage.clear();
    this.lruList.length = 0;
    this.lruMap.clear();
    this.currentBytes = 0;
    this.head = null;
    this.tail = null;
  }

  /**
   * Get current memory usage in bytes.
   */
  getMemoryUsage(): number {
    return this.currentBytes;
  }

  /**
   * Get number of stored contexts.
   */
  size(): number {
    return this.storage.size;
  }

  /**
   * Get pool statistics for telemetry.
   */
  getStats(): MemoryPoolStats {
    return {
      pool: this.poolType,
      currentBytes: this.currentBytes,
      capacityBytes: this.capacity,
      contextCount: this.storage.size,
      evictions: this.evictions,
      utilization: this.currentBytes / this.capacity,
    };
  }

  /**
   * Get all stored block indices.
   */
  keys(): IterableIterator<number> {
    return this.storage.keys();
  }

  /**
   * Convert pivots Map to GERow array for serialization.
   */
  private pivotsToGERow(pivots: Map<number, GERow>): GERow[] {
    const rows: GERow[] = [];
    for (const row of pivots.values()) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Evict the least-recently-used entry.
   *
   * @returns Block index of evicted entry, or null if pool is empty
   */
  private evictLRU(): number | null {
    if (!this.tail) return null;

    const blockIndex = this.tail.blockIndex;
    const entry = this.storage.get(blockIndex);
    if (!entry) return null;

    this.currentBytes -= entry.sizeBytes;
    this.storage.delete(blockIndex);
    this.removeLRU(blockIndex);

    return blockIndex;
  }

  /**
   * Insert a node at the front of the LRU list (most recently used).
   */
  private insertLRU(blockIndex: number): void {
    const node: LRUListNode = { blockIndex, prev: null, next: null };
    this.lruMap.set(blockIndex, node);

    if (!this.head) {
      // First node
      this.head = node;
      this.tail = node;
    } else {
      // Insert at front
      node.next = this.head;
      this.head.prev = node;
      this.head = node;
    }
  }

  /**
   * Move a node to the front of the LRU list.
   */
  private moveToFront(blockIndex: number): void {
    const node = this.lruMap.get(blockIndex);
    if (!node || node === this.head) return;

    // Remove from current position
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    if (node === this.tail) {
      this.tail = node.prev;
    }

    // Insert at front
    node.prev = null;
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
  }

  /**
   * Remove a node from the LRU list.
   */
  private removeLRU(blockIndex: number): void {
    const node = this.lruMap.get(blockIndex);
    if (!node) return;

    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }

    this.lruMap.delete(blockIndex);
  }
}

/**
 * LRU list node for tracking access order.
 */
interface LRUListNode {
  blockIndex: number;
  prev: LRUListNode | null;
  next: LRUListNode | null;
}

/**
 * Memory-bounded block storage.
 *
 * Manages two separate memory pools for payload and manifest contexts,
 * each with fixed capacity and LRU eviction. Provides unified interface
 * for storing and retrieving GE decoder state.
 *
 * Memory constraint: Total storage ≤ 528 KB (264 KB × 2 pools).
 * This satisfies I6a requirement for 1 MB working set.
 */
export class BlockStorage {
  private readonly payloadPool: MemoryPool;
  private readonly manifestPool: MemoryPool;
  private readonly onEvictCallbacks: Map</* blockIndex */ number, () => void>;

  constructor(
    payloadLimit: number = PAYLOAD_CONTEXT_LIMIT,
    manifestLimit: number = MANIFEST_CONTEXT_LIMIT
  ) {
    this.payloadPool = new MemoryPool(payloadLimit, 'payload');
    this.manifestPool = new MemoryPool(manifestLimit, 'manifest');
    this.onEvictCallbacks = new Map();
  }

  /**
   * Get a payload context by block index.
   *
   * @param blockIndex - Block index (0 to blockCount-1)
   * @returns Context entry if found
   */
  getPayload(blockIndex: number): ContextEntry | undefined {
    return this.payloadPool.get(blockIndex);
  }

  /**
   * Store a payload context, evicting if necessary.
   *
   * @param entry - Context entry to store
   * @returns Evicted block indices
   */
  setPayload(entry: ContextEntry): number[] {
    return this.payloadPool.set(entry);
  }

  /**
   * Check if payload context exists.
   */
  hasPayload(blockIndex: number): boolean {
    return this.payloadPool.has(blockIndex);
  }

  /**
   * Remove a payload context.
   */
  deletePayload(blockIndex: number): boolean {
    return this.payloadPool.delete(blockIndex);
  }

  /**
   * Get a manifest context by block index.
   *
   * @param blockIndex - Block index (typically 0xFFFFFF for manifest)
   * @returns Context entry if found
   */
  getManifest(blockIndex: number): ContextEntry | undefined {
    return this.manifestPool.get(blockIndex);
  }

  /**
   * Store a manifest context, evicting if necessary.
   *
   * @param entry - Context entry to store
   * @returns Evicted block indices
   */
  setManifest(entry: ContextEntry): number[] {
    return this.manifestPool.set(entry);
  }

  /**
   * Check if manifest context exists.
   */
  hasManifest(blockIndex: number): boolean {
    return this.manifestPool.has(blockIndex);
  }

  /**
   * Remove a manifest context.
   */
  deleteManifest(blockIndex: number): boolean {
    return this.manifestPool.delete(blockIndex);
  }

  /**
   * Get comprehensive storage statistics.
   */
  getStats(): StorageStats {
    const payloadStats = this.payloadPool.getStats();
    const manifestStats = this.manifestPool.getStats();

    return {
      payload: payloadStats,
      manifest: manifestStats,
      totalBytes: payloadStats.currentBytes + manifestStats.currentBytes,
      totalCapacity: payloadStats.capacityBytes + manifestStats.capacityBytes,
      totalUtilization:
        (payloadStats.currentBytes + manifestStats.currentBytes) /
        (payloadStats.capacityBytes + manifestStats.capacityBytes),
    };
  }

  /**
   * Clear all stored contexts.
   */
  clear(): void {
    this.payloadPool.clear();
    this.manifestPool.clear();
  }

  /**
   * Get total memory usage across both pools.
   */
  getTotalMemoryUsage(): number {
    return this.payloadPool.getMemoryUsage() + this.manifestPool.getMemoryUsage();
  }

  /**
   * Validate memory constraints.
   *
   * @returns true if storage within limits
   */
  validateConstraints(): boolean {
    const stats = this.getStats();
    return stats.totalBytes <= stats.totalCapacity;
  }

  /**
   * Get all stored payload block indices.
   */
  getPayloadKeys(): IterableIterator<number> {
    return this.payloadPool.keys();
  }

  /**
   * Get all stored manifest block indices.
   */
  getManifestKeys(): IterableIterator<number> {
    return this.manifestPool.keys();
  }

  /**
   * Calculate expected context size for given K value.
   */
  static calculateContextSize(k: number = K, l: number = L): number {
    return calculateGEContextSize(k, l);
  }

  /**
   * Get default capacity constants.
   */
  static get CAPACITY_PAYLOAD() {
    return PAYLOAD_CONTEXT_LIMIT;
  }

  static get CAPACITY_MANIFEST() {
    return MANIFEST_CONTEXT_LIMIT;
  }

  static get CAPACITY_TOTAL() {
    return PAYLOAD_CONTEXT_LIMIT + MANIFEST_CONTEXT_LIMIT;
  }
}

/**
 * Factory function to create a ContextEntry from decoder state.
 *
 * @param blockIndex - Block index
 * @param pivots - GE decoder pivots (Map<seq, GERow>)
 * @param rank - Current decoder rank
 * @param k - K value for size calculation
 * @param l - L value for size calculation
 * @returns Context entry with calculated size
 */
export function createContextEntry(
  blockIndex: number,
  pivots: Map<number, GERow>,
  rank: number,
  k: number = K,
  l: number = L
): ContextEntry {
  // Estimate size based on K and L
  const sizeBytes = calculateGEContextSize(k, l);

  return {
    blockIndex,
    pivots,
    rank,
    lastAccess: Date.now(),
    sizeBytes,
  };
}

/**
 * Calculate maximum number of contexts that fit in a pool.
 *
 * @param poolCapacity - Pool capacity in bytes
 * @param k - K value (default 768)
 * @param l - L value (default 256)
 * @returns Maximum contexts that can fit
 */
export function calculateMaxContextsPerPool(
  poolCapacity: number,
  k: number = K,
  l: number = L
): number {
  const contextSize = calculateGEContextSize(k, l);
  return Math.floor(poolCapacity / contextSize);
}

/**
 * Validate storage configuration meets I6a constraint.
 *
 * @param payloadLimit - Payload pool capacity
 * @param manifestLimit - Manifest pool capacity
 * @returns true if total ≤ 1 MB
 */
export function validateI6aConstraint(
  payloadLimit: number,
  manifestLimit: number
): boolean {
  const total = payloadLimit + manifestLimit;
  const limit = 1_048_576; // 1 MB
  return total <= limit;
}

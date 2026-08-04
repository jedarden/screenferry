/**
 * Encode-side block storage for fountain-encoded blocks.
 *
 * Implements memory-bounded caching of encoded blocks for QR transmission:
 * - Stores encoded blocks by blockIndex for quick access
 * - LRU eviction when memory limit exceeded
 * - Memory tracking and telemetry for leak detection
 * - Async write support for storage backend integration
 *
 * Unlike bounded-storage.ts (receiver-side decoder state), this stores
 * sender-side encoded blocks ready for QR display.
 *
 * Reference: plan.md §8.1, D19
 */

import { L, BLOCK } from '../params.js';

/**
 * Encoded block metadata.
 */
export interface EncodedBlockMetadata {
  /** Block index */
  blockIndex: number;
  /** Number of fragments (K) */
  k: number;
  /** Fragment length (L) */
  fragmentLen: number;
  /** Original block size in bytes */
  blockSize: number;
  /** Timestamp when block was encoded */
  encodedAt: number;
  /** Estimated memory size in bytes */
  sizeBytes: number;
}

/**
 * Encoded block entry with fountain-encoded packets.
 */
export interface EncodedBlockEntry {
  /** Block metadata */
  metadata: EncodedBlockMetadata;
  /** Encoded fragments (fountain packets) */
  fragments: Uint8Array[];
  /** Last access timestamp for LRU tracking */
  lastAccess: number;
}

/**
 * Storage pool configuration.
 */
export interface EncodeStorageConfig {
  /** Maximum memory for encoded blocks in bytes (default: 10 MB) */
  maxMemoryBytes?: number;
  /** Maximum number of blocks to cache (default: 50 blocks) */
  maxBlocks?: number;
  /** Whether to enable detailed memory tracking (default: true) */
  enableMemoryTracking?: boolean;
}

/**
 * Default configuration.
 *
 * Memory limit: 10 MB ~ 50 blocks at 192 KB/block.
 * This provides sufficient cache for transmission while
 * preventing unbounded growth.
 */
const DEFAULT_CONFIG: Required<EncodeStorageConfig> = {
  maxMemoryBytes: 10 * 1024 * 1024, // 10 MB
  maxBlocks: 50,
  enableMemoryTracking: true,
};

/**
 * Storage statistics for telemetry.
 */
export interface EncodeStorageStats {
  /** Current memory usage in bytes */
  currentBytes: number;
  /** Maximum memory capacity in bytes */
  maxBytes: number;
  /** Number of blocks currently stored */
  blockCount: number;
  /** Maximum blocks capacity */
  maxBlocks: number;
  /** Total eviction events */
  evictions: number;
  /** Current memory utilization (0-1) */
  utilization: number;
  /** Cache hit rate (hits / total accesses) */
  hitRate: number;
  /** Total cache accesses */
  totalAccesses: number;
  /** Cache hits */
  cacheHits: number;
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
 * Encode-side block storage with LRU eviction.
 *
 * Caches encoded blocks for quick access during QR transmission.
 * Enforces memory limits via LRU eviction when capacity exceeded.
 */
export class EncodeBlockStorage {
  private readonly config: Required<EncodeStorageConfig>;
  private readonly storage: Map<number, EncodedBlockEntry>;
  private readonly lruMap: Map<number, LRUListNode>;
  private currentBytes: number;
  private evictions: number;
  private head: LRUListNode | null;
  private tail: LRUListNode | null;

  // Statistics
  private totalAccesses: number = 0;
  private cacheHits: number = 0;

  constructor(config: EncodeStorageConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = new Map();
    this.lruMap = new Map();
    this.currentBytes = 0;
    this.evictions = 0;
    this.head = null;
    this.tail = null;
  }

  /**
   * Get an encoded block by block index.
   *
   * Updates access time for LRU tracking on cache hit.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Encoded block entry if found, undefined otherwise
   */
  get(blockIndex: number): EncodedBlockEntry | undefined {
    this.totalAccesses++;

    const entry = this.storage.get(blockIndex);
    if (!entry) return undefined;

    this.cacheHits++;
    this.moveToFront(blockIndex);
    entry.lastAccess = Date.now();

    return entry;
  }

  /**
   * Store an encoded block, evicting if necessary.
   *
   * Evicts least-recently-used blocks until there's room for the new entry.
   * Returns the evicted block indices.
   *
   * @param entry - Encoded block entry to store
   * @returns Array of evicted block indices (may be empty)
   */
  set(entry: EncodedBlockEntry): number[] {
    const evicted: number[] = [];

    // Check if replacing existing entry
    const existing = this.storage.get(entry.metadata.blockIndex);
    if (existing) {
      this.currentBytes -= existing.metadata.sizeBytes;
      this.removeLRU(entry.metadata.blockIndex);
    }

    // Evict until there's room (both memory and block count limits)
    while (
      (this.currentBytes + entry.metadata.sizeBytes > this.config.maxMemoryBytes ||
       this.storage.size >= this.config.maxBlocks) &&
      this.storage.size > 0
    ) {
      const lruBlockIndex = this.evictLRU();
      if (lruBlockIndex === null) break;
      evicted.push(lruBlockIndex);
      this.evictions++;
    }

    // Check if entry fits
    if (entry.metadata.sizeBytes > this.config.maxMemoryBytes) {
      throw new Error(
        `Encoded block size (${entry.metadata.sizeBytes} bytes) exceeds storage capacity (${this.config.maxMemoryBytes} bytes)`
      );
    }

    // Store the entry
    this.storage.set(entry.metadata.blockIndex, entry);
    this.currentBytes += entry.metadata.sizeBytes;
    this.insertLRU(entry.metadata.blockIndex);

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

    this.currentBytes -= entry.metadata.sizeBytes;
    this.storage.delete(blockIndex);
    this.removeLRU(blockIndex);
    return true;
  }

  /**
   * Clear all entries and reset statistics.
   */
  clear(): void {
    this.storage.clear();
    this.lruMap.clear();
    this.currentBytes = 0;
    this.evictions = 0;
    this.head = null;
    this.tail = null;
    this.totalAccesses = 0;
    this.cacheHits = 0;
  }

  /**
   * Get current memory usage in bytes.
   */
  getMemoryUsage(): number {
    return this.currentBytes;
  }

  /**
   * Get number of stored blocks.
   */
  size(): number {
    return this.storage.size;
  }

  /**
   * Get storage statistics for telemetry.
   */
  getStats(): EncodeStorageStats {
    return {
      currentBytes: this.currentBytes,
      maxBytes: this.config.maxMemoryBytes,
      blockCount: this.storage.size,
      maxBlocks: this.config.maxBlocks,
      evictions: this.evictions,
      utilization: this.currentBytes / this.config.maxMemoryBytes,
      hitRate: this.totalAccesses > 0 ? this.cacheHits / this.totalAccesses : 0,
      totalAccesses: this.totalAccesses,
      cacheHits: this.cacheHits,
    };
  }

  /**
   * Get all stored block indices.
   */
  keys(): IterableIterator<number> {
    return this.storage.keys();
  }

  /**
   * Validate memory constraints.
   *
   * @returns true if storage within limits
   */
  validateConstraints(): boolean {
    return (
      this.currentBytes <= this.config.maxMemoryBytes &&
      this.storage.size <= this.config.maxBlocks
    );
  }

  /**
   * Calculate expected block size for given K and fragment length.
   */
  static calculateBlockSize(k: number, fragmentLen: number = L): number {
    // Each fragment is fragmentLen bytes
    // We store K fragments as Uint8Array
    return k * fragmentLen;
  }

  /**
   * Create encoded block metadata.
   */
  static createMetadata(
    blockIndex: number,
    k: number,
    fragmentLen: number = L,
    blockSize: number = BLOCK
  ): EncodedBlockMetadata {
    const sizeBytes = this.calculateBlockSize(k, fragmentLen);

    return {
      blockIndex,
      k,
      fragmentLen,
      blockSize,
      encodedAt: Date.now(),
      sizeBytes,
    };
  }

  /**
   * Evict the least-recently-used entry.
   *
   * @returns Block index of evicted entry, or null if storage is empty
   */
  private evictLRU(): number | null {
    if (!this.tail) return null;

    const blockIndex = this.tail.blockIndex;
    const entry = this.storage.get(blockIndex);
    if (!entry) return null;

    this.currentBytes -= entry.metadata.sizeBytes;
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
 * Create encoded block entry from fragments.
 */
export function createEncodedBlockEntry(
  blockIndex: number,
  fragments: Uint8Array[],
  blockSize: number = BLOCK,
  fragmentLen: number = L
): EncodedBlockEntry {
  const metadata = EncodeBlockStorage.createMetadata(
    blockIndex,
    fragments.length,
    fragmentLen,
    blockSize
  );

  return {
    metadata,
    fragments,
    lastAccess: Date.now(),
  };
}

/**
 * Validate storage configuration meets memory constraints.
 */
export function validateEncodeStorageConfig(config: EncodeStorageConfig): boolean {
  const maxMemory = config.maxMemoryBytes ?? DEFAULT_CONFIG.maxMemoryBytes;
  const maxBlocks = config.maxBlocks ?? DEFAULT_CONFIG.maxBlocks;

  // Ensure we can store at least one maximum-size block
  const maxBlockSize = BLOCK; // 192 KB

  return maxMemory >= maxBlockSize && maxBlocks >= 1;
}

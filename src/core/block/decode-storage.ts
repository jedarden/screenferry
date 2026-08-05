/**
 * Decode-side packet storage for fountain code reconstruction.
 *
 * Implements memory-bounded caching of fountain packets during reception:
 * - Stores received packets by (blockIndex, seq) for decoder consumption
 * - LRU eviction when memory limit exceeded
 * - Memory tracking and telemetry for leak detection
 * - Block completion tracking for decode pipeline
 * - Batch retrieval of all packets for a specific block
 *
 * Unlike encode-storage.ts (sender-side encoded blocks), this stores
 * receiver-side fountain packets waiting to be decoded.
 *
 * Reference: plan.md §8.1, D19
 */

import { L } from '../params.js';

/**
 * Fountain packet metadata.
 */
export interface FountainPacketMetadata {
  /** Block index */
  blockIndex: number;
  /** Sequence number within block */
  seq: number;
  /** Packet length in bytes */
  packetLen: number;
  /** Timestamp when packet was received */
  receivedAt: number;
  /** Estimated memory size in bytes */
  sizeBytes: number;
}

/**
 * Fountain packet entry with payload.
 */
export interface FountainPacketEntry {
  /** Packet metadata */
  metadata: FountainPacketMetadata;
  /** Packet payload (fountain-encoded data) */
  payload: Uint8Array;
  /** Last access timestamp for LRU tracking */
  lastAccess: number;
}

/**
 * Decode storage configuration.
 */
export interface DecodeStorageConfig {
  /** Maximum memory for fountain packets in bytes (default: 5 MB) */
  maxMemoryBytes?: number;
  /** Maximum number of packets to store (default: 5000) */
  maxPackets?: number;
  /** Whether to enable detailed memory tracking (default: true) */
  enableMemoryTracking?: boolean;
}

/**
 * Default configuration.
 *
 * Memory limit: 5 MB ~ 5000 packets at 1 KB/packet.
 * This provides sufficient buffer for reception while preventing unbounded growth.
 */
const DEFAULT_CONFIG: Required<DecodeStorageConfig> = {
  maxMemoryBytes: 5 * 1024 * 1024, // 5 MB
  maxPackets: 5000,
  enableMemoryTracking: true,
};

/**
 * Storage statistics for telemetry.
 */
export interface DecodeStorageStats {
  /** Current memory usage in bytes */
  currentBytes: number;
  /** Maximum memory capacity in bytes */
  maxBytes: number;
  /** Number of packets currently stored */
  packetCount: number;
  /** Maximum packets capacity */
  maxPackets: number;
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
 * Block completion status.
 */
export interface BlockCompletion {
  /** Block index */
  blockIndex: number;
  /** Number of packets received */
  packetsReceived: number;
  /** Number of unique packets (deduplicated) */
  uniquePackets: number;
  /** Estimated completion (0-1, based on K) */
  estimatedProgress: number;
  /** Whether block is complete (rank == K) */
  complete: boolean;
}

/**
 * LRU list node for tracking access order.
 */
interface LRUListNode {
  key: string; // "blockIndex:seq"
  prev: LRUListNode | null;
  next: LRUListNode | null;
}

/**
 * Composite key for packet storage: "blockIndex:seq".
 */
function makePacketKey(blockIndex: number, seq: number): string {
  return `${blockIndex}:${seq}`;
}

/**
 * Parse composite key into components.
 */
function parsePacketKey(key: string): { blockIndex: number; seq: number } {
  const parts = key.split(':').map(Number);
  const blockIndex = parts[0] ?? 0;
  const seq = parts[1] ?? 0;
  return { blockIndex, seq };
}

/**
 * Decode-side fountain packet storage with LRU eviction.
 *
 * Caches received fountain packets for decoder consumption.
 * Enforces memory limits via LRU eviction when capacity exceeded.
 */
export class DecodePacketStorage {
  private readonly config: Required<DecodeStorageConfig>;
  private readonly storage: Map<string, FountainPacketEntry>;
  private readonly lruMap: Map<string, LRUListNode>;
  private readonly blockTrackers: Map<number, Set<number>>; // blockIndex -> set of seq
  private currentBytes: number;
  private evictions: number;
  private head: LRUListNode | null;
  private tail: LRUListNode | null;

  // Statistics
  private totalAccesses: number = 0;
  private cacheHits: number = 0;

  constructor(config: DecodeStorageConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = new Map();
    this.lruMap = new Map();
    this.blockTrackers = new Map();
    this.currentBytes = 0;
    this.evictions = 0;
    this.head = null;
    this.tail = null;
  }

  /**
   * Get a packet by block index and sequence number.
   *
   * Updates access time for LRU tracking on cache hit.
   *
   * @param blockIndex - Block index
   * @param seq - Sequence number within block
   * @returns Packet entry if found, undefined otherwise
   */
  get(blockIndex: number, seq: number): FountainPacketEntry | undefined {
    this.totalAccesses++;

    const key = makePacketKey(blockIndex, seq);
    const entry = this.storage.get(key);
    if (!entry) return undefined;

    this.cacheHits++;
    this.moveToFront(key);
    entry.lastAccess = Date.now();

    return entry;
  }

  /**
   * Store a fountain packet, evicting if necessary.
   *
   * Evicts least-recently-used packets until there's room for the new entry.
   * Returns the evicted packet keys.
   *
   * @param entry - Packet entry to store
   * @returns Array of evicted packet keys (may be empty)
   */
  set(entry: FountainPacketEntry): string[] {
    const evicted: string[] = [];
    const key = makePacketKey(entry.metadata.blockIndex, entry.metadata.seq);

    // Check if replacing existing entry
    const existing = this.storage.get(key);
    if (existing) {
      this.currentBytes -= existing.metadata.sizeBytes;
      this.removeLRU(key);
    }

    // Evict until there's room (both memory and packet count limits)
    while (
      (this.currentBytes + entry.metadata.sizeBytes > this.config.maxMemoryBytes ||
       this.storage.size >= this.config.maxPackets) &&
      this.storage.size > 0
    ) {
      const lruKey = this.evictLRU();
      if (lruKey === null) break;
      evicted.push(lruKey);
      this.evictions++;
    }

    // Check if entry fits
    if (entry.metadata.sizeBytes > this.config.maxMemoryBytes) {
      throw new Error(
        `Packet size (${entry.metadata.sizeBytes} bytes) exceeds storage capacity (${this.config.maxMemoryBytes} bytes)`
      );
    }

    // Store the entry
    this.storage.set(key, entry);
    this.currentBytes += entry.metadata.sizeBytes;
    this.insertLRU(key);

    // Update block tracker
    const { blockIndex, seq } = parsePacketKey(key);
    if (!this.blockTrackers.has(blockIndex)) {
      this.blockTrackers.set(blockIndex, new Set());
    }
    this.blockTrackers.get(blockIndex)!.add(seq);

    return evicted;
  }

  /**
   * Check if a specific packet is stored.
   *
   * @param blockIndex - Block index
   * @param seq - Sequence number within block
   * @returns true if packet exists
   */
  has(blockIndex: number, seq: number): boolean {
    return this.storage.has(makePacketKey(blockIndex, seq));
  }

  /**
   * Get all packets for a specific block index.
   *
   * Returns an array of (seq, payload) tuples sorted by sequence number.
   * Useful for feeding packets to the decoder.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Array of [seq, payload] tuples, empty if block not found
   */
  getBlockPackets(blockIndex: number): Array<[number, Uint8Array]> {
    const tracker = this.blockTrackers.get(blockIndex);
    if (!tracker) return [];

    const packets: Array<[number, Uint8Array]> = [];
    for (const seq of tracker) {
      const entry = this.storage.get(makePacketKey(blockIndex, seq));
      if (entry) {
        packets.push([seq, entry.payload]);
      }
    }

    // Sort by sequence number
    packets.sort((a, b) => a[0] - b[0]);

    return packets;
  }

  /**
   * Get block completion status.
   *
   * @param blockIndex - Block index to check
   * @param k - Expected K (number of source fragments) for progress estimation
   * @returns Block completion status
   */
  getBlockCompletion(blockIndex: number, k: number): BlockCompletion {
    const tracker = this.blockTrackers.get(blockIndex);
    if (!tracker) {
      return {
        blockIndex,
        packetsReceived: 0,
        uniquePackets: 0,
        estimatedProgress: 0,
        complete: false,
      };
    }

    const uniquePackets = tracker.size;
    return {
      blockIndex,
      packetsReceived: uniquePackets, // Assuming no duplicates for now
      uniquePackets,
      estimatedProgress: Math.min(uniquePackets / k, 1),
      complete: uniquePackets >= k, // Approximate - actual completion requires decoder state
    };
  }

  /**
   * Remove all packets for a specific block index.
   *
   * Useful for garbage-collecting completed blocks or resetting state.
   *
   * @param blockIndex - Block index to remove
   * @returns Number of packets removed
   */
  removeBlock(blockIndex: number): number {
    const tracker = this.blockTrackers.get(blockIndex);
    if (!tracker) return 0;

    let removed = 0;
    for (const seq of tracker) {
      const key = makePacketKey(blockIndex, seq);
      const entry = this.storage.get(key);
      if (entry) {
        this.currentBytes -= entry.metadata.sizeBytes;
        this.removeLRU(key);
        this.storage.delete(key);
        removed++;
      }
    }

    this.blockTrackers.delete(blockIndex);
    return removed;
  }

  /**
   * Get total number of blocks being tracked.
   *
   * @returns Number of unique block indices
   */
  getBlockCount(): number {
    return this.blockTrackers.size;
  }

  /**
   * Clear all stored packets and reset state.
   */
  clear(): void {
    this.storage.clear();
    this.lruMap.clear();
    this.blockTrackers.clear();
    this.currentBytes = 0;
    this.evictions = 0;
    this.head = null;
    this.tail = null;
    this.totalAccesses = 0;
    this.cacheHits = 0;
  }

  /**
   * Get current memory usage.
   *
   * @returns Current memory usage in bytes
   */
  getMemoryUsage(): number {
    return this.currentBytes;
  }

  /**
   * Get number of stored packets.
   *
   * @returns Number of packets in storage
   */
  size(): number {
    return this.storage.size;
  }

  /**
   * Get storage statistics.
   *
   * @returns Storage statistics
   */
  getStats(): DecodeStorageStats {
    const utilization = this.currentBytes / this.config.maxMemoryBytes;
    const hitRate = this.totalAccesses > 0 ? this.cacheHits / this.totalAccesses : 0;

    return {
      currentBytes: this.currentBytes,
      maxBytes: this.config.maxMemoryBytes,
      packetCount: this.storage.size,
      maxPackets: this.config.maxPackets,
      evictions: this.evictions,
      utilization,
      hitRate,
      totalAccesses: this.totalAccesses,
      cacheHits: this.cacheHits,
    };
  }

  /**
   * Validate memory constraints.
   *
   * Checks that storage is operating within configured limits.
   * Returns true if all constraints are satisfied.
   *
   * @returns true if storage within limits
   */
  validateConstraints(): boolean {
    // Check memory limit
    if (this.currentBytes > this.config.maxMemoryBytes) {
      console.error('[DecodeStorage] Memory limit exceeded:', {
        current: this.currentBytes,
        max: this.config.maxMemoryBytes,
      });
      return false;
    }

    // Check packet count limit
    if (this.storage.size > this.config.maxPackets) {
      console.error('[DecodeStorage] Packet count limit exceeded:', {
        current: this.storage.size,
        max: this.config.maxPackets,
      });
      return false;
    }

    return true;
  }

  /**
   * Move a node to the front of the LRU list.
   */
  private moveToFront(key: string): void {
    const node = this.lruMap.get(key);
    if (!node) return;

    this.removeLRU(key);
    this.insertLRU(key);
  }

  /**
   * Insert a node at the front of the LRU list.
   */
  private insertLRU(key: string): void {
    const node: LRUListNode = { key, prev: null, next: this.head };
    this.lruMap.set(key, node);

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Remove a node from the LRU list.
   */
  private removeLRU(key: string): void {
    const node = this.lruMap.get(key);
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

    this.lruMap.delete(key);
  }

  /**
   * Evict the least-recently-used packet.
   *
   * @returns Evicted packet key, or null if storage is empty
   */
  private evictLRU(): string | null {
    if (!this.tail) return null;

    const lruKey = this.tail.key;
    const entry = this.storage.get(lruKey);
    if (entry) {
      this.currentBytes -= entry.metadata.sizeBytes;
      this.storage.delete(lruKey);

      // Update block tracker
      const { blockIndex, seq } = parsePacketKey(lruKey);
      const tracker = this.blockTrackers.get(blockIndex);
      if (tracker) {
        tracker.delete(seq);
        if (tracker.size === 0) {
          this.blockTrackers.delete(blockIndex);
        }
      }
    }

    this.removeLRU(lruKey);
    return lruKey;
  }
}

/**
 * Create a fountain packet entry.
 *
 * @param blockIndex - Block index
 * @param seq - Sequence number within block
 * @param payload - Packet payload
 * @param receivedAt - Timestamp when received (default: now)
 * @returns Packet entry
 */
export function createFountainPacketEntry(
  blockIndex: number,
  seq: number,
  payload: Uint8Array,
  receivedAt?: number
): FountainPacketEntry {
  const sizeBytes = payload.length;
  const metadata: FountainPacketMetadata = {
    blockIndex,
    seq,
    packetLen: payload.length,
    receivedAt: receivedAt ?? Date.now(),
    sizeBytes,
  };

  return {
    metadata,
    payload,
    lastAccess: receivedAt ?? Date.now(),
  };
}

/**
 * Validate decode storage configuration.
 *
 * @param config - Configuration to validate
 * @returns true if configuration is valid
 */
export function validateDecodeStorageConfig(config: DecodeStorageConfig): boolean {
  if (config.maxMemoryBytes !== undefined && config.maxMemoryBytes <= 0) {
    console.error('[DecodeStorage] maxMemoryBytes must be positive');
    return false;
  }

  if (config.maxPackets !== undefined && config.maxPackets <= 0) {
    console.error('[DecodeStorage] maxPackets must be positive');
    return false;
  }

  return true;
}

/**
 * Calculate expected memory usage for a file transfer.
 *
 * @param fileSize - Size of file to transfer in bytes
 * @param packetCacheSize - Number of packets to cache (default: 5000)
 * @returns Expected memory usage in bytes
 */
export function estimateDecodeMemoryUsage(
  fileSize: number,
  packetCacheSize: number = 5000
): number {
  const avgPacketSize = L; // Each packet is L bytes
  return Math.min(packetCacheSize, fileSize / L) * avgPacketSize;
}

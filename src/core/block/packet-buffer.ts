/**
 * Storage-backed packet buffer for encode→decode roundtrip (bf-2qgx).
 *
 * Provides storage layer for large-scale block sequencing:
 * - Stores encoded packets by block index for decoder retrieval
 * - Memory-bounded: evicts old blocks as new ones arrive
 * - Integrates with BlockScheduler for realistic transmission simulation
 * - Tracks block completion and memory statistics
 *
 * This simulates the real-world scenario where:
 * 1. Encoder generates packets and stores them (simulating network transmission)
 * 2. Decoder retrieves packets on-demand (simulating receiver-side buffering)
 * 3. Memory is bounded with LRU eviction (I6a requirement)
 *
 * Reference: plan.md §8.1, D19, I6a, bf-2qgx
 */

import { K, L } from '../params.js';
import { BlockStorage, createContextEntry, calculateGEContextSize } from './bounded-storage.js';

/**
 * Encoded packet with metadata.
 */
export interface EncodedPacket {
  /** Sequence number within block */
  seq: number;
  /** Encoded payload */
  payload: Uint8Array;
}

/**
 * Block storage entry with completion tracking.
 */
export interface BlockEntry {
  /** Block index */
  blockIndex: number;
  /** Encoded packets for this block */
  packets: EncodedPacket[];
  /** Block hash for verification */
  hash: Uint8Array;
  /** Whether block is fully encoded (all dwell packets generated) */
  complete: boolean;
  /** Timestamp for LRU tracking */
  timestamp: number;
  /** Estimated memory size in bytes */
  sizeBytes: number;
}

/**
 * Buffer statistics for monitoring.
 */
export interface BufferStats {
  /** Number of blocks stored */
  blockCount: number;
  /** Number of complete blocks */
  completeBlocks: number;
  /** Total memory usage in bytes */
  memoryBytes: number;
  /** Total packets stored */
  totalPackets: number;
  /** Evicted block count */
  evictions: number;
}

/**
 * Storage-backed packet buffer for encode→decode roundtrip.
 *
 * Acts as the "network" between encoder and decoder:
 * - Encoder stores packets by block index (simulating transmission)
 * - Decoder retrieves packets by block index (simulating reception)
 * - Memory-bounded with LRU eviction (maintains I6a constraint)
 */
export class PacketBuffer {
  private readonly storage: Map<number, BlockEntry>;
  private readonly blockStorage: BlockStorage;
  private evictions: number;
  private totalPackets: number;

  constructor() {
    this.storage = new Map();
    this.blockStorage = new BlockStorage();
    this.evictions = 0;
    this.totalPackets = 0;
  }

  /**
   * Store encoded packets for a block.
   *
   * @param blockIndex - Block index
   * @param packets - Encoded packets to store
   * @param hash - Block hash for verification
   * @param complete - Whether block encoding is complete
   * @returns Evicted block indices (may be empty)
   */
  storeBlock(
    blockIndex: number,
    packets: EncodedPacket[],
    hash: Uint8Array,
    complete: boolean = false
  ): number[] {
    const evicted: number[] = [];

    // Calculate size
    const sizeBytes = this.calculateBlockSize(packets);

    // Check if replacing existing entry
    const existing = this.storage.get(blockIndex);
    if (existing) {
      this.totalPackets -= existing.packets.length;
      this.storage.delete(blockIndex);
    }

    // Evict blocks if memory limit exceeded
    // Use a simple heuristic: keep ~100 blocks max (empirically fits memory budget)
    const MAX_BLOCKS = 100;
    while (this.storage.size >= MAX_BLOCKS && this.storage.size > 0) {
      const lruBlock = this.findLRUBlock();
      if (lruBlock === null) break;
      this.storage.delete(lruBlock);
      evicted.push(lruBlock);
      this.evictions++;
    }

    // Store the block
    const entry: BlockEntry = {
      blockIndex,
      packets: packets.map(p => ({ seq: p.seq, payload: p.payload.slice() })),
      hash: hash.slice(),
      complete,
      timestamp: Date.now(),
      sizeBytes,
    };

    this.storage.set(blockIndex, entry);
    this.totalPackets += packets.length;

    return evicted;
  }

  /**
   * Retrieve encoded packets for a block.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Block entry if found, undefined otherwise
   */
  getBlock(blockIndex: number): BlockEntry | undefined {
    const entry = this.storage.get(blockIndex);
    if (entry) {
      // Update timestamp for LRU
      entry.timestamp = Date.now();
    }
    return entry;
  }

  /**
   * Check if a block is stored.
   *
   * @param blockIndex - Block index to check
   * @returns true if block exists
   */
  hasBlock(blockIndex: number): boolean {
    return this.storage.has(blockIndex);
  }

  /**
   * Check if a block is complete (fully encoded).
   *
   * @param blockIndex - Block index to check
   * @returns true if block exists and is complete
   */
  isBlockComplete(blockIndex: number): boolean {
    const entry = this.storage.get(blockIndex);
    return entry?.complete ?? false;
  }

  /**
   * Remove a specific block.
   *
   * @param blockIndex - Block index to remove
   * @returns true if block was removed
   */
  deleteBlock(blockIndex: number): boolean {
    const entry = this.storage.get(blockIndex);
    if (!entry) return false;

    this.totalPackets -= entry.packets.length;
    return this.storage.delete(blockIndex);
  }

  /**
   * Clear all stored blocks.
   */
  clear(): void {
    this.storage.clear();
    this.totalPackets = 0;
    this.evictions = 0;
  }

  /**
   * Get current buffer statistics.
   *
   * @returns Buffer statistics
   */
  getStats(): BufferStats {
    let completeBlocks = 0;
    let memoryBytes = 0;

    for (const entry of this.storage.values()) {
      if (entry.complete) completeBlocks++;
      memoryBytes += entry.sizeBytes;
    }

    return {
      blockCount: this.storage.size,
      completeBlocks,
      memoryBytes,
      totalPackets: this.totalPackets,
      evictions: this.evictions,
    };
  }

  /**
   * Get all stored block indices.
   *
   * @returns Array of block indices
   */
  getStoredBlocks(): number[] {
    return Array.from(this.storage.keys()).sort((a, b) => a - b);
  }

  /**
   * Validate memory constraints.
   *
   * @returns true if buffer within memory limits
   */
  validateMemoryConstraints(): boolean {
    const stats = this.getStats();
    // Rough estimate: should stay under 10MB for packet buffer
    const MAX_PACKET_BUFFER_MEMORY = 10 * 1024 * 1024;
    return stats.memoryBytes < MAX_PACKET_BUFFER_MEMORY;
  }

  /**
   * Find the least-recently-used block.
   *
   * @returns Block index of LRU block, or null if empty
   */
  private findLRUBlock(): number | null {
    if (this.storage.size === 0) return null;

    let lruBlock: number | null = null;
    let oldestTime = Infinity;

    for (const [blockIndex, entry] of this.storage.entries()) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        lruBlock = blockIndex;
      }
    }

    return lruBlock;
  }

  /**
   * Calculate memory size for a block's packets.
   *
   * @param packets - Encoded packets
   * @returns Estimated size in bytes
   */
  private calculateBlockSize(packets: EncodedPacket[]): number {
    let size = 0;
    for (const packet of packets) {
      // Each packet: seq (4 bytes) + payload length + overhead
      size += 4 + packet.payload.length + 32; // 32 bytes overhead per packet
    }
    return size;
  }
}

/**
 * Create a packet buffer with default configuration.
 *
 * @returns New packet buffer
 */
export function createPacketBuffer(): PacketBuffer {
  return new PacketBuffer();
}
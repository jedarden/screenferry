/**
 * Block encoding pipeline — scheduler + encoder + storage integration.
 *
 * Implements the complete encode path for file transfer:
 * - Partitions source file into blocks
 * - Schedules block encoding using BlockScheduler
 * - Encodes blocks using fountain codes (LTEncoder)
 * - Stores encoded blocks in memory-bounded cache
 * - Provides encoded blocks for QR transmission
 *
 * This is the sender-side complement to the receiver's decode pipeline.
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { BlockScheduler, createDwellConfig, type BlockCursor } from './schedule.js';
import { LTEncoder, type EncoderOpts } from '../fountain/encoder.js';
import {
  EncodeBlockStorage,
  createEncodedBlockEntry,
  type EncodedBlockEntry,
  type EncodeStorageConfig,
  type EncodeStorageStats,
} from './encode-storage.js';
import {
  geometry,
  blockRange,
  toFragments,
  type BlockGeometry,
} from './partition.js';
import { BLOCK, L, K } from '../params.js';

/**
 * Pipeline configuration.
 */
export interface EncodePipelineConfig {
  /** Block storage configuration */
  storageConfig?: EncodeStorageConfig;
  /** Custom dwell packets (default: K * DWELL_FACTOR) */
  dwellPackets?: number;
  /** Stream identifier for encoding */
  streamId: number;
  /** Callback when a block is encoded and stored */
  onBlockEncoded?: (blockIndex: number, entry: EncodedBlockEntry) => void;
  /** Callback when a block is evicted from cache */
  onBlockEvicted?: (blockIndex: number) => void;
}

/**
 * Pipeline state.
 */
export interface EncodePipelineState {
  /** Total blocks in stream */
  totalBlocks: number;
  /** Blocks encoded and stored */
  blocksEncoded: number;
  /** Current scheduler position */
  currentCursor: BlockCursor;
  /** Whether pipeline is running */
  running: boolean;
  /** Storage statistics */
  storageStats: EncodeStorageStats;
}

/**
 * Encode result with block index and encoded entry.
 */
export interface EncodeResult {
  /** Block index that was encoded */
  blockIndex: number;
  /** Encoded block entry */
  entry: EncodedBlockEntry;
  /** Whether this was a cache hit */
  cached: boolean;
}

/**
 * Block encoding pipeline.
 *
 * Orchestrates the complete encode path:
 * 1. Partitions file into blocks
 * 2. Schedules encoding using BlockScheduler
 * 3. Encodes blocks with fountain codes
 * 4. Caches encoded blocks for transmission
 * 5. Manages memory with LRU eviction
 */
export class BlockEncodePipeline {
  private readonly config: Required<Omit<EncodePipelineConfig, 'onBlockEncoded' | 'onBlockEvicted'>> &
    Pick<EncodePipelineConfig, 'onBlockEncoded' | 'onBlockEvicted'>;
  private readonly sourceData: Uint8Array;
  private readonly blockGeom: BlockGeometry;
  private readonly scheduler: BlockScheduler;
  private readonly storage: EncodeBlockStorage;
  private readonly blockCache: Map<number, EncodedBlockEntry>;

  private running: boolean = false;
  private blocksEncoded: number = 0;

  constructor(sourceData: Uint8Array, config: EncodePipelineConfig) {
    this.sourceData = sourceData;
    this.blockGeom = geometry(sourceData.length, BLOCK, L);

    // Validate config
    if (!config.streamId && config.streamId !== 0) {
      throw new Error('streamId is required');
    }

    this.config = {
      storageConfig: config.storageConfig ?? {},
      dwellPackets: config.dwellPackets ?? Math.ceil(K * 1.6),
      streamId: config.streamId,
      ...(config.onBlockEncoded !== undefined && { onBlockEncoded: config.onBlockEncoded }),
      ...(config.onBlockEvicted !== undefined && { onBlockEvicted: config.onBlockEvicted }),
    };

    // Create scheduler
    const dwellConfig = createCustomDwellConfig(
      this.config.dwellPackets,
      this.blockGeom.blockCount
    );
    this.scheduler = new BlockScheduler(dwellConfig);

    // Create storage
    this.storage = new EncodeBlockStorage(this.config.storageConfig);

    // Cache for fast access
    this.blockCache = new Map();
  }

  /**
   * Start the encoding pipeline.
   */
  start(): void {
    if (this.running) {
      throw new Error('Pipeline is already running');
    }

    this.running = true;
    this.blocksEncoded = 0;

    console.debug('[EncodePipeline] Started:', {
      totalBytes: this.sourceData.length,
      totalBlocks: this.blockGeom.blockCount,
      dwellPackets: this.config.dwellPackets,
      streamId: this.config.streamId,
    });
  }

  /**
   * Stop the encoding pipeline.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    console.debug('[EncodePipeline] Stopped:', {
      blocksEncoded: this.blocksEncoded,
      storageStats: this.storage.getStats(),
    });
  }

  /**
   * Encode the next block in the schedule.
   *
   * Advances the scheduler, encodes the block if not cached,
   * and returns the encoded entry.
   *
   * @returns Encode result with block index and entry
   */
  encodeNext(): EncodeResult {
    if (!this.running) {
      throw new Error('Pipeline is not running - call start() first');
    }

    // Get next block from scheduler
    const cursor = this.scheduler.advance();
    const blockIndex = cursor.blockIndex;

    // Check if already cached
    const cached = this.storage.get(blockIndex);
    if (cached) {
      return { blockIndex, entry: cached, cached: true };
    }

    // Encode the block
    const entry = this.encodeBlock(blockIndex);

    // Store in cache
    const evicted = this.storage.set(entry);
    this.blockCache.set(blockIndex, entry);

    // Notify callbacks
    this.config.onBlockEncoded?.(blockIndex, entry);
    for (const evictedBlockIndex of evicted) {
      this.blockCache.delete(evictedBlockIndex);
      this.config.onBlockEvicted?.(evictedBlockIndex);
    }

    this.blocksEncoded++;

    return { blockIndex, entry, cached: false };
  }

  /**
   * Encode a specific block by index.
   *
   * Useful for repair mode or pre-fetching specific blocks.
   *
   * @param blockIndex - Block index to encode
   * @returns Encoded block entry
   */
  encodeBlock(blockIndex: number): EncodedBlockEntry {
    if (blockIndex < 0 || blockIndex >= this.blockGeom.blockCount) {
      throw new Error(`Block index ${blockIndex} out of range [0, ${this.blockGeom.blockCount})`);
    }

    // Get block byte range
    const { start, end } = blockRange(this.blockGeom, blockIndex);
    const blockData = this.sourceData.subarray(start, end);

    // Split into fragments
    const fragments = toFragments(blockData, L);

    // Create fountain encoder
    const encoderOpts: EncoderOpts = {
      streamId: this.config.streamId,
      blockIndex,
      fragments,
    };

    // Encode using fountain codes
    const encoder = new LTEncoder(encoderOpts);

    // Encode first dwell packets and store them
    const encodedFragments: Uint8Array[] = [];
    const dwellPackets = this.config.dwellPackets;

    for (let seq = 0; seq < dwellPackets; seq++) {
      const packet = encoder.encode(seq);
      encodedFragments.push(packet);
    }

    // Create entry
    const entry = createEncodedBlockEntry(
      blockIndex,
      encodedFragments,
      blockData.length,
      L
    );

    return entry;
  }

  /**
   * Get an encoded block by index (cache hit).
   *
   * Returns the cached entry if available, undefined otherwise.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Encoded block entry if cached
   */
  getBlock(blockIndex: number): EncodedBlockEntry | undefined {
    return this.storage.get(blockIndex);
  }

  /**
   * Check if a block is encoded and cached.
   *
   * @param blockIndex - Block index to check
   * @returns true if block is cached
   */
  hasBlock(blockIndex: number): boolean {
    return this.storage.has(blockIndex);
  }

  /**
   * Pre-encode all blocks (cache warming).
   *
   * Encodes all blocks upfront to populate the cache.
   * Useful for small files or when latency is critical.
   *
   * @returns Number of blocks encoded
   */
  preEncodeAll(): number {
    let count = 0;
    for (let i = 0; i < this.blockGeom.blockCount; i++) {
      if (!this.storage.has(i)) {
        const entry = this.encodeBlock(i);
        const evicted = this.storage.set(entry);
        this.blockCache.set(i, entry);

        this.config.onBlockEncoded?.(i, entry);
        for (const evictedBlockIndex of evicted) {
          this.blockCache.delete(evictedBlockIndex);
          this.config.onBlockEvicted?.(evictedBlockIndex);
        }

        count++;
      }
    }
    this.blocksEncoded += count;
    return count;
  }

  /**
   * Get pipeline state.
   *
   * @returns Current pipeline state
   */
  getState(): EncodePipelineState {
    return {
      totalBlocks: this.blockGeom.blockCount,
      blocksEncoded: this.blocksEncoded,
      currentCursor: this.scheduler.getCursor(),
      running: this.running,
      storageStats: this.storage.getStats(),
    };
  }

  /**
   * Get storage statistics.
   *
   * @returns Storage statistics
   */
  getStorageStats(): EncodeStorageStats {
    return this.storage.getStats();
  }

  /**
   * Validate memory constraints.
   *
   * @returns true if storage within limits
   */
  validateConstraints(): boolean {
    return this.storage.validateConstraints();
  }

  /**
   * Clear all cached blocks and reset state.
   */
  clear(): void {
    this.storage.clear();
    this.blockCache.clear();
    this.blocksEncoded = 0;
  }

  /**
   * Get block geometry information.
   *
   * @returns Block geometry
   */
  getBlockGeometry(): BlockGeometry {
    return { ...this.blockGeom };
  }

  /**
   * Get scheduler instance (for testing/inspection).
   *
   * @returns Block scheduler
   */
  getScheduler(): BlockScheduler {
    return this.scheduler;
  }

  /**
   * Get storage instance (for testing/inspection).
   *
   * @returns Encode block storage
   */
  getStorage(): EncodeBlockStorage {
    return this.storage;
  }
}

/**
 * Create custom dwell configuration.
 */
function createCustomDwellConfig(
  dwellPackets: number,
  blockCount: number
): ReturnType<typeof createDwellConfig> {
  // Import and use the function from schedule.ts
  // We'll re-implement here to avoid circular dependency
  return {
    dwellPackets,
    blockCount,
  };
}

/**
 * Factory function to create an encode pipeline.
 */
export function createEncodePipeline(
  sourceData: Uint8Array,
  config: EncodePipelineConfig
): BlockEncodePipeline {
  return new BlockEncodePipeline(sourceData, config);
}

/**
 * Calculate expected memory usage for a file transfer.
 *
 * @param fileSize - Size of file to transfer in bytes
 * @param blockCacheSize - Number of blocks to cache (default: 50)
 * @returns Expected memory usage in bytes
 */
export function estimateEncodeMemoryUsage(
  fileSize: number,
  blockCacheSize: number = 50
): number {
  const geom = geometry(fileSize, BLOCK, L);
  const blocksToCache = Math.min(geom.blockCount, blockCacheSize);

  // Each cached block stores K fragments of L bytes
  // K varies by block, but we'll use average
  const avgFragmentsPerBlock = Math.ceil(BLOCK / L);
  const avgBlockSize = avgFragmentsPerBlock * L;

  return blocksToCache * avgBlockSize;
}

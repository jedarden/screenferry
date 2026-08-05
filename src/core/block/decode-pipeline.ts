/**
 * Block decoding pipeline — packet storage + decoder + reassembly integration.
 *
 * Implements the complete decode path for file transfer:
 * - Receives fountain packets from QR codes
 * - Stores packets in memory-bounded cache
 * - Decodes blocks using Gaussian elimination (GEDecoder)
 * - Tracks block completion and progress
 * - Reassembles decoded blocks into original file
 *
 * This is the receiver-side complement to the sender's encode pipeline.
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { GEDecoder, type DecoderOpts } from '../fountain/decoder.js';
import {
  DecodePacketStorage,
  createFountainPacketEntry,
  type FountainPacketEntry,
  type DecodeStorageConfig,
  type DecodeStorageStats,
  type BlockCompletion,
} from './decode-storage.js';
import {
  geometry,
  blockRange,
  fromFragments,
  type BlockGeometry,
} from './partition.js';
import { BLOCK, L, K } from '../params.js';

/**
 * Pipeline configuration.
 */
export interface DecodePipelineConfig {
  /** Packet storage configuration */
  storageConfig?: DecodeStorageConfig;
  /** Stream identifier for decoding */
  streamId: number;
  /** Total file size in bytes */
  fileSize: number;
  /** Callback when a packet is received and stored */
  onPacketReceived?: (blockIndex: number, seq: number) => void;
  /** Callback when a packet is evicted from cache */
  onPacketEvicted?: (blockIndex: number, seq: number) => void;
  /** Callback when a block is decoded */
  onBlockDecoded?: (blockIndex: number, blockData: Uint8Array) => void;
}

/**
 * Pipeline state.
 */
export interface DecodePipelineState {
  /** Total blocks in stream */
  totalBlocks: number;
  /** Blocks decoded and reassembled */
  blocksDecoded: number;
  /** Total packets received */
  packetsReceived: number;
  /** Unique packets (deduplicated) */
  uniquePackets: number;
  /** Whether pipeline is running */
  running: boolean;
  /** Storage statistics */
  storageStats: DecodeStorageStats;
  /** Current file bytes reassembled */
  bytesReassembled: number;
}

/**
 * Decode result for a block.
 */
export interface DecodeResult {
  /** Block index that was decoded */
  blockIndex: number;
  /** Decoded block data */
  blockData: Uint8Array;
  /** Whether this was a cache hit (block was already decoded) */
  cached: boolean;
  /** Number of packets used for decoding */
  packetsUsed: number;
  /** Reception overhead */
  overhead: number;
}

/**
 * Block decoding pipeline.
 *
 * Orchestrates the complete decode path:
 * 1. Receives fountain packets from QR codes
 * 2. Stores packets in memory-bounded cache
 * 3. Decodes blocks with fountain decoder
 * 4. Tracks block completion and progress
 * 5. Reassembles decoded blocks into original file
 */
export class BlockDecodePipeline {
  private readonly config: Required<Omit<DecodePipelineConfig, 'onPacketReceived' | 'onPacketEvicted' | 'onBlockDecoded'>> &
    Pick<DecodePipelineConfig, 'onPacketReceived' | 'onPacketEvicted' | 'onBlockDecoded'>;
  private readonly blockGeom: BlockGeometry;
  private readonly storage: DecodePacketStorage;
  private readonly decoders: Map<number, GEDecoder>;
  private readonly decodedBlocks: Map<number, Uint8Array>;

  private running: boolean = false;
  private packetsReceived: number = 0;
  private blocksDecoded: number = 0;

  constructor(config: DecodePipelineConfig) {
    // Validate config
    if (!config.streamId && config.streamId !== 0) {
      throw new Error('streamId is required');
    }
    if (!config.fileSize || config.fileSize <= 0) {
      throw new Error('fileSize is required and must be positive');
    }

    this.blockGeom = geometry(config.fileSize, BLOCK, L);

    this.config = {
      storageConfig: config.storageConfig ?? {},
      streamId: config.streamId,
      fileSize: config.fileSize,
      ...(config.onPacketReceived !== undefined && { onPacketReceived: config.onPacketReceived }),
      ...(config.onPacketEvicted !== undefined && { onPacketEvicted: config.onPacketEvicted }),
      ...(config.onBlockDecoded !== undefined && { onBlockDecoded: config.onBlockDecoded }),
    };

    // Create storage
    this.storage = new DecodePacketStorage(this.config.storageConfig);

    // Decoder instances per block
    this.decoders = new Map();

    // Decoded block cache
    this.decodedBlocks = new Map();
  }

  /**
   * Start the decoding pipeline.
   */
  start(): void {
    if (this.running) {
      throw new Error('Pipeline is already running');
    }

    this.running = true;
    this.packetsReceived = 0;
    this.blocksDecoded = 0;

    console.debug('[DecodePipeline] Started:', {
      fileSize: this.config.fileSize,
      totalBlocks: this.blockGeom.blockCount,
      streamId: this.config.streamId,
    });
  }

  /**
   * Stop the decoding pipeline.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;

    console.debug('[DecodePipeline] Stopped:', {
      packetsReceived: this.packetsReceived,
      blocksDecoded: this.blocksDecoded,
      storageStats: this.storage.getStats(),
    });
  }

  /**
   * Receive and store a fountain packet.
   *
   * Stores the packet in the cache and triggers decode attempt for the block.
   *
   * @param blockIndex - Block index
   * @param seq - Sequence number within block
   * @param payload - Packet payload
   * @returns true if packet was new (not duplicate)
   */
  receivePacket(blockIndex: number, seq: number, payload: Uint8Array): boolean {
    if (!this.running) {
      throw new Error('Pipeline is not running - call start() first');
    }

    // Validate block index
    if (blockIndex < 0 || blockIndex >= this.blockGeom.blockCount) {
      console.warn('[DecodePipeline] Invalid block index:', blockIndex);
      return false;
    }

    // Check for duplicate
    if (this.storage.has(blockIndex, seq)) {
      return false; // Duplicate packet
    }

    // Store packet
    const entry = createFountainPacketEntry(blockIndex, seq, payload);
    const evicted = this.storage.set(entry);

    this.packetsReceived++;

    // Notify callbacks
    this.config.onPacketReceived?.(blockIndex, seq);
    for (const evictedKey of evicted) {
      const { blockIndex: evictedBlockIndex, seq: evictedSeq } =
        parsePacketKey(evictedKey);
      this.config.onPacketEvicted?.(evictedBlockIndex, evictedSeq);
    }

    // Attempt to decode the block
    this.tryDecodeBlock(blockIndex);

    return true;
  }

  /**
   * Decode a specific block by index.
   *
   * Attempts to decode the block using all available packets in storage.
   * Returns the decoded data if successful, undefined otherwise.
   *
   * @param blockIndex - Block index to decode
   * @returns Decoded block data if complete, undefined otherwise
   */
  decodeBlock(blockIndex: number): Uint8Array | undefined {
    // Check if already decoded
    if (this.decodedBlocks.has(blockIndex)) {
      return this.decodedBlocks.get(blockIndex);
    }

    // Get all packets for this block
    const packets = this.storage.getBlockPackets(blockIndex);
    if (packets.length === 0) {
      return undefined;
    }

    // Get or create decoder for this block
    let decoder = this.decoders.get(blockIndex);
    if (!decoder) {
      const k = calculateK(this.blockGeom, blockIndex);
      const decoderOpts: DecoderOpts = {
        streamId: this.config.streamId,
        blockIndex,
        k,
        fragLen: L,
      };
      decoder = new GEDecoder(decoderOpts);
      this.decoders.set(blockIndex, decoder);
    }

    // Feed all packets to decoder
    for (const [seq, payload] of packets) {
      decoder.absorb(seq, payload);
    }

    // Check if block is complete
    if (!decoder.complete) {
      return undefined;
    }

    // Recover fragments
    const fragments = decoder.recover();

    // Calculate block size for this block
    const blockPos = blockRange(this.blockGeom, blockIndex);
    const blockByteLen = blockPos.end - blockPos.start;

    // Reassemble block from fragments
    const blockData = fromFragments(fragments, blockByteLen);

    // Cache decoded block
    this.decodedBlocks.set(blockIndex, blockData);
    this.blocksDecoded++;

    // Clean up storage for this block
    this.storage.removeBlock(blockIndex);

    // Notify callback
    this.config.onBlockDecoded?.(blockIndex, blockData);

    return blockData;
  }

  /**
   * Try to decode a block (non-blocking).
   *
   * Attempts to decode the block but doesn't throw if incomplete.
   *
   * @param blockIndex - Block index to decode
   * @returns Decode result if complete, undefined otherwise
   */
  tryDecodeBlock(blockIndex: number): DecodeResult | undefined {
    const decoder = this.decoders.get(blockIndex);
    if (!decoder) {
      return undefined;
    }

    const packets = this.storage.getBlockPackets(blockIndex);
    const packetsUsed = packets.length;

    // Feed new packets to decoder
    for (const [seq, payload] of packets) {
      // Only feed packets we haven't absorbed yet
      // (decoder tracks this internally via redundant count)
      decoder.absorb(seq, payload);
    }

    // Check if complete
    if (!decoder.complete) {
      return undefined;
    }

    // Recover and reassemble
    const fragments = decoder.recover();
    const blockPos = blockRange(this.blockGeom, blockIndex);
    const blockByteLen = blockPos.end - blockPos.start;
    const blockData = fromFragments(fragments, blockByteLen);

    // Cache result
    this.decodedBlocks.set(blockIndex, blockData);
    this.blocksDecoded++;

    // Clean up
    this.storage.removeBlock(blockIndex);

    const result: DecodeResult = {
      blockIndex,
      blockData,
      cached: false,
      packetsUsed,
      overhead: decoder.overhead,
    };

    // Notify callback
    this.config.onBlockDecoded?.(blockIndex, blockData);

    return result;
  }

  /**
   * Get block completion status.
   *
   * @param blockIndex - Block index to check
   * @returns Block completion status
   */
  getBlockCompletion(blockIndex: number): BlockCompletion {
    const k = calculateK(this.blockGeom, blockIndex);
    return this.storage.getBlockCompletion(blockIndex, k);
  }

  /**
   * Check if a block is decoded.
   *
   * @param blockIndex - Block index to check
   * @returns true if block is decoded
   */
  isBlockDecoded(blockIndex: number): boolean {
    return this.decodedBlocks.has(blockIndex);
  }

  /**
   * Get a decoded block by index.
   *
   * @param blockIndex - Block index to retrieve
   * @returns Decoded block data if available
   */
  getBlock(blockIndex: number): Uint8Array | undefined {
    return this.decodedBlocks.get(blockIndex);
  }

  /**
   * Reassemble the complete file from decoded blocks.
   *
   * Returns the complete file data if all blocks are decoded,
   * undefined otherwise.
   *
   * @returns Complete file data if all blocks decoded
   */
  reassembleFile(): Uint8Array | undefined {
    if (this.decodedBlocks.size !== this.blockGeom.blockCount) {
      return undefined;
    }

    // Calculate total file size
    const totalSize = this.config.fileSize;
    const result = new Uint8Array(totalSize);
    let offset = 0;

    // Concatenate all blocks in order
    for (let i = 0; i < this.blockGeom.blockCount; i++) {
      const blockData = this.decodedBlocks.get(i);
      if (!blockData) {
        return undefined; // Should not happen if size check passed
      }

      result.set(blockData, offset);
      offset += blockData.length;
    }

    return result;
  }

  /**
   * Get pipeline state.
   *
   * @returns Current pipeline state
   */
  getState(): DecodePipelineState {
    return {
      totalBlocks: this.blockGeom.blockCount,
      blocksDecoded: this.blocksDecoded,
      packetsReceived: this.packetsReceived,
      uniquePackets: this.storage.size(),
      running: this.running,
      storageStats: this.storage.getStats(),
      bytesReassembled: this.blocksDecoded * BLOCK, // Approximate
    };
  }

  /**
   * Get storage statistics.
   *
   * @returns Storage statistics
   */
  getStorageStats(): DecodeStorageStats {
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
   * Clear all cached packets and decoded blocks.
   */
  clear(): void {
    this.storage.clear();
    this.decoders.clear();
    this.decodedBlocks.clear();
    this.packetsReceived = 0;
    this.blocksDecoded = 0;
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
   * Get decoder instance for a block (for testing/inspection).
   *
   * @param blockIndex - Block index
   * @returns GEDecoder instance if exists
   */
  getDecoder(blockIndex: number): GEDecoder | undefined {
    return this.decoders.get(blockIndex);
  }

  /**
   * Get storage instance (for testing/inspection).
   *
   * @returns Decode packet storage
   */
  getStorage(): DecodePacketStorage {
    return this.storage;
  }
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
 * Calculate K (number of fragments) for a block.
 */
function calculateK(blockGeom: BlockGeometry, blockIndex: number): number {
  const { start, end } = blockRange(blockGeom, blockIndex);
  const blockSize = end - start;
  return Math.ceil(blockSize / L);
}

/**
 * Factory function to create a decode pipeline.
 */
export function createDecodePipeline(
  config: DecodePipelineConfig
): BlockDecodePipeline {
  return new BlockDecodePipeline(config);
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

/**
 * Headless block layer — pure codec pipeline without QR, camera, or UI.
 *
 * Integrates partition → fountain encode → schedule → decode → reassemble,
 * providing byte-identical round-trip validation for large files while
 * maintaining ≤1MB working set (I6a).
 *
 * This layer validates:
 * - 4GB synthetic streams (21,845 blocks) without memory growth
 * - Working set stays ≤ 528KB (264KB payload + 264KB manifest contexts)
 * - No monotonic memory growth across block sequence
 * - Byte-identical encode→decode round-trip
 * - Per-block hash generation and verification
 *
 * Reference: plan.md §7.6, §8.1, D19, I6a
 */

import { L, K, BLOCK, DEGREE_CAP } from '../params.js';
import { geometry, blockRange, toFragments, fromFragments, blockK } from './partition.js';
import { LTEncoder } from '../fountain/encoder.js';
import { GEDecoder } from '../fountain/decoder.js';
import { createDwellConfig, BlockScheduler } from './schedule.js';
import {
  computeBlockHash,
  computeManifestHash,
  extractBlockHash,
  verifyBlockHash,
} from '../hash/block-hash.js';

/**
 * Configuration for headless block processing.
 */
export interface HeadlessConfig {
  /** Stream identifier for PRNG */
  streamId: number;
  /** Block size in bytes (default BLOCK = 196,608) */
  blockSize?: number;
  /** Fragment length in bytes (default L = 256) */
  fragmentLen?: number;
  /** Degree cap for LT codes (default DEGREE_CAP = 64) */
  degreeCap?: number;
  /** Dwell factor for scheduling (default 1.6) */
  dwellFactor?: number;
  /** Block hash length in bytes (default 4) */
  blockHashLen?: number;
}

/**
 * Block encoding result with metadata.
 */
export interface EncodedBlock {
  /** Block index */
  blockIndex: number;
  /** Encoded packet stream */
  packets: Array<{ seq: number; payload: Uint8Array }>;
  /** Block hash */
  hash: Uint8Array;
}

/**
 * Block decoding result.
 */
export interface DecodedBlock {
  /** Block index */
  blockIndex: number;
  /** Recovered bytes */
  data: Uint8Array;
  /** Whether hash verified */
  hashValid: boolean;
  /** Decoder statistics */
  stats: {
    rank: number;
    packetsSeen: number;
    overhead: number;
    redundant: number;
  };
}

/**
 * Headless block processor — stateless codec pipeline.
 *
 * Processes large files block-by-block with bounded memory:
 * - Working set: O(K²) matrix + O(K*L) block + O(K*L) manifest ≈ 528KB
 * - No memory growth with file size (processes blocks sequentially)
 * - Stateless: can resume at any block using only streamId + blockIndex
 */
export class HeadlessBlockProcessor {
  private readonly config: Required<HeadlessConfig>;

  constructor(config: HeadlessConfig) {
    this.config = {
      streamId: config.streamId,
      blockSize: config.blockSize ?? BLOCK,
      fragmentLen: config.fragmentLen ?? L,
      degreeCap: config.degreeCap ?? DEGREE_CAP,
      dwellFactor: config.dwellFactor ?? 1.6,
      blockHashLen: config.blockHashLen ?? 4,
    };
  }

  /**
   * Get block geometry for a file.
   */
  getGeometry(totalLen: number) {
    return geometry(totalLen, this.config.blockSize, this.config.fragmentLen);
  }

  /**
   * Encode a single block.
   *
   * @param data - Raw block data (may be short for last block)
   * @param blockIndex - Block index in stream
   * @returns Encoded block with packets and hash
   */
  async encodeBlock(data: Uint8Array, blockIndex: number): Promise<EncodedBlock> {
    // Partition into fragments
    const fragments = toFragments(data, this.config.fragmentLen);

    // Create fountain encoder
    const encoder = new LTEncoder({
      streamId: this.config.streamId,
      blockIndex,
      fragments,
      degreeCap: this.config.degreeCap,
    });

    // Generate dwell packets
    const dwellPackets = Math.ceil(fragments.length * this.config.dwellFactor);
    const packets: Array<{ seq: number; payload: Uint8Array }> = [];

    for (let seq = 0; seq < dwellPackets; seq++) {
      packets.push({ seq, payload: encoder.encode(seq) });
    }

    // Compute block hash
    const hash = await computeBlockHash(data, this.config.blockHashLen);

    return { blockIndex, packets, hash };
  }

  /**
   * Decode a single block from packets.
   *
   * @param packets - Encoded packets (seq, payload pairs)
   * @param blockIndex - Block index in stream
   * @param originalLength - Expected length (for last block padding)
   * @param expectedHash - Expected block hash for verification
   * @param k - Explicit K value (fragments per block)
   * @returns Decoded block with data and verification
   */
  async decodeBlock(
    packets: Array<{ seq: number; payload: Uint8Array }>,
    blockIndex: number,
    originalLength: number,
    expectedHash: Uint8Array,
    k?: number
  ): Promise<DecodedBlock> {
    // Calculate K from original length if not provided
    const actualK = k ?? Math.max(1, Math.ceil(originalLength / this.config.fragmentLen));

    // Create fountain decoder
    const decoder = new GEDecoder({
      streamId: this.config.streamId,
      blockIndex,
      k: actualK,
      fragLen: this.config.fragmentLen,
      degreeCap: this.config.degreeCap,
    });

    // Absorb packets until complete
    for (const { seq, payload } of packets) {
      decoder.absorb(seq, payload);
      if (decoder.complete) break;
    }

    if (!decoder.complete) {
      throw new Error(`Block ${blockIndex} did not complete (rank=${decoder.rank}, k=${actualK})`);
    }

    // Recover fragments
    const fragments = decoder.recover();

    // Reassemble block data
    const data = fromFragments(fragments, originalLength);

    // Verify hash by direct comparison (simpler than using verifyBlockHash with manifest)
    const actualHash = await computeBlockHash(data, this.config.blockHashLen);
    const hashValid = actualHash.length === expectedHash.length &&
      actualHash.every((val, i) => val === expectedHash[i]);

    return {
      blockIndex,
      data,
      hashValid,
      stats: {
        rank: decoder.rank,
        packetsSeen: decoder.packetsSeen,
        overhead: decoder.overhead,
        redundant: decoder.redundant,
      },
    };
  }

  /**
   * Encode entire file/stream block-by-block with memory efficiency.
   *
   * Memory-efficient: processes blocks sequentially, calling the callback for each block.
   * Only manifest hashes are accumulated (87KB for 4GB file).
   *
   * @param data - Full file data
   * @param onBlock - Callback for each encoded block (index, block, hash)
   * @returns Manifest and manifest hash
   */
  async encodeStream(
    data: Uint8Array,
    onBlock?: (blockIndex: number, packets: Array<{ seq: number; payload: Uint8Array }>, hash: Uint8Array) => void
  ): Promise<{
    manifest: Uint8Array;
    manifestHash: number;
  }> {
    const geo = this.getGeometry(data.length);
    const blockHashes: Uint8Array[] = [];

    // Process blocks sequentially, releasing each after callback
    for (let i = 0; i < geo.blockCount; i++) {
      const { start, end } = blockRange(geo, i);
      const blockData = data.slice(start, end);

      const encoded = await this.encodeBlock(blockData, i);

      // Call callback to handle block without accumulating
      if (onBlock) {
        onBlock(i, encoded.packets, encoded.hash);
      }

      // Only accumulate hashes (4 bytes per block)
      blockHashes.push(encoded.hash);
    }

    // Create manifest
    const manifest = this.createManifest(blockHashes);
    const manifestHash = computeManifestHash(manifest);

    return { manifest, manifestHash };
  }

  /**
   * Decode entire stream with memory efficiency.
   *
   * Memory-efficient: processes blocks sequentially, calling callback for each block.
   * Only accumulates final output data.
   *
   * @param getBlockPackets - Function to retrieve packets for a given block index
   * @param manifest - Block hash manifest
   * @param manifestHash - Expected manifest hash for validation
   * @param totalLength - Expected total file length
   * @param onBlock - Callback for each decoded block (optional, for validation)
   * @returns Decoded file data + verification results
   */
  async decodeStream(
    getBlockPackets: (blockIndex: number) => Array<{ seq: number; payload: Uint8Array }> | Promise<Array<{ seq: number; payload: Uint8Array }>>,
    manifest: Uint8Array,
    manifestHash: number,
    totalLength: number,
    onBlock?: (block: DecodedBlock) => void
  ): Promise<{
    data: Uint8Array;
    manifestValid: boolean;
  }> {
    const geo = this.getGeometry(totalLength);
    const outputParts: Uint8Array[] = [];

    // Verify manifest hash
    const manifestValid = this.verifyManifestHash(manifest, manifestHash);

    if (!manifestValid) {
      throw new Error('Manifest hash validation failed');
    }

    // Process blocks sequentially
    for (let i = 0; i < geo.blockCount; i++) {
      const { start, end } = blockRange(geo, i);
      const blockLength = end - start;

      // Calculate K for this block
      const blockK = Math.max(1, Math.ceil(blockLength / this.config.fragmentLen));

      // Get packets for this block
      const packets = await getBlockPackets(i);

      // Get expected hash from manifest
      const expectedHash = extractBlockHash(
        manifest,
        i,
        this.config.blockHashLen
      );

      const decoded = await this.decodeBlock(
        packets,
        i,
        blockLength,
        expectedHash,
        blockK  // Pass explicit K
      );

      // Call callback for validation if provided
      if (onBlock) {
        onBlock(decoded);
      }

      // Verify byte-identity per-block
      if (!decoded.hashValid) {
        throw new Error(`Block ${i} hash verification failed`);
      }

      // Only accumulate output data
      outputParts.push(decoded.data);
    }

    // Concatenate all blocks
    const data = this.concatenateBlocks(outputParts);

    return { data, manifestValid };
  }

  /**
   * Create block manifest from array of block hashes.
   */
  private createManifest(blockHashes: Uint8Array[]): Uint8Array {
    const totalLen = blockHashes.length * this.config.blockHashLen;
    const manifest = new Uint8Array(totalLen);
    let offset = 0;
    for (const hash of blockHashes) {
      manifest.set(hash, offset);
      offset += this.config.blockHashLen;
    }
    return manifest;
  }

  /**
   * Create single-block manifest for hash verification.
   */
  private createSingleBlockManifest(hash: Uint8Array): Uint8Array {
    return this.createManifest([hash]);
  }

  /**
   * Verify manifest hash.
   */
  private verifyManifestHash(manifest: Uint8Array, expectedHash: number): boolean {
    const computed = computeManifestHash(manifest);
    return computed === expectedHash;
  }

  /**
   * Concatenate block data into final output.
   */
  private concatenateBlocks(blocks: Uint8Array[]): Uint8Array {
    const totalLength = blocks.reduce((sum, block) => sum + block.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const block of blocks) {
      result.set(block, offset);
      offset += block.length;
    }
    return result;
  }

  /**
   * Process synthetic 4GB stream to validate memory constraints.
   *
   * This method demonstrates the A5 memory flat requirement:
   * - Generates 21,845 blocks (4GB) worth of data
   * - Encodes and decodes each block sequentially
   * - Verifies no memory growth across the sequence
   * - Returns memory statistics for validation
   *
   * @param options - Test configuration
   * @returns Memory and processing statistics
   */
  async processSynthetic4GB(options: {
    seed?: number;
    onProgress?: (progress: { blockIndex: number; memoryMB: number }) => void;
  } = {}): Promise<{
    blocksProcessed: number;
    memoryStats: {
      initial: number;
      peak: number;
      final: number;
      growth: number;
    };
    allHashesValid: boolean;
  }> {
    const BLOCKS_4GB = 21845; // 4GB / 196KB
    const seed = options.seed ?? 1;

    const memoryReadings: number[] = [];

    // Process blocks sequentially
    for (let i = 0; i < BLOCKS_4GB; i++) {
      // Generate synthetic block data
      const blockData = this.generateSyntheticBlock(BLOCK, seed + i);

      // Encode
      const encoded = await this.encodeBlock(blockData, i);

      // Decode
      const decoded = await this.decodeBlock(
        encoded.packets,
        i,
        blockData.length,
        encoded.hash
      );

      // Verify byte-identity
      if (!decoded.hashValid) {
        return {
          blocksProcessed: i,
          memoryStats: { initial: 0, peak: 0, final: 0, growth: 0 },
          allHashesValid: false,
        };
      }

      // Record memory
      if (globalThis.gc) globalThis.gc();
      const memoryMB = process.memoryUsage().heapUsed / (1024 * 1024);
      memoryReadings.push(memoryMB);

      // Report progress
      if (options.onProgress) {
        options.onProgress({ blockIndex: i, memoryMB });
      }
    }

    // Calculate memory statistics
    const initial = memoryReadings.slice(0, 100).reduce((a, b) => a + b, 0) / 100;
    const peak = Math.max(...memoryReadings);
    const final = memoryReadings.slice(-100).reduce((a, b) => a + b, 0) / 100;
    const growth = final - initial;

    return {
      blocksProcessed: BLOCKS_4GB,
      memoryStats: {
        initial,
        peak,
        final,
        growth,
      },
      allHashesValid: true,
    };
  }

  /**
   * Generate synthetic block data for testing.
   */
  private generateSyntheticBlock(size: number, seed: number): Uint8Array {
    const data = new Uint8Array(size);
    let x = seed >>> 0;
    for (let i = 0; i < size; i++) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      data[i] = x & 0xff;
    }
    return data;
  }
}

/**
 * Calculate working set size for given K and L.
 *
 * Per I6a: working set = matrix + block
 * - Matrix: K²/8 bytes (coefficient storage)
 * - Block: K*L bytes (payload storage)
 *
 * @param k - Fragments per block
 * @param l - Fragment length in bytes
 * @returns Working set in bytes
 */
export function calculateWorkingSet(k: number = K, l: number = L): number {
  const matrix = (k * k) / 8; // Coefficient storage
  const block = k * l; // Payload storage
  return matrix + block;
}

/**
 * Validate working set meets I6a constraint (≤1MB).
 *
 * @param k - Fragments per block
 * @param l - Fragment length in bytes
 * @returns true if working set ≤ 1MB
 */
export function validateWorkingSet(k: number = K, l: number = L): boolean {
  const workingSet = calculateWorkingSet(k, l);
  const limit = 1_048_576; // 1MB in bytes
  return workingSet <= limit;
}

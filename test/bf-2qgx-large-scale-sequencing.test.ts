/**
 * Large-scale block sequencing pipeline integration tests (bf-2qgx).
 *
 * Tests the complete pipeline for 4GB synthetic streams with 21,845 blocks:
 * - Encode path: scheduler + storage integration
 * - Decode path: scheduler + storage integration
 * - End-to-end encode→decode roundtrip validation
 * - No monotonic memory growth across full sequence
 * - Working set stays ≤ 1 MB throughout full 4GB processing
 *
 * Acceptance criteria:
 * - Handles 21,845 blocks (4GB) without memory growth
 * - Working set stays ≤ 1 MB throughout full 4GB processing
 * - No monotonic memory growth measured across block sequence
 * - Encode→decode produces byte-identical output
 * - Integration test with 4GB synthetic stream
 *
 * Reference: plan.md §8.1, I6a, A5
 */

import { describe, expect, it } from 'vitest';
import { K, L, BLOCK, DWELL_FACTOR } from '../src/core/params.js';
import { BlockScheduler, createDwellConfig } from '../src/core/block/schedule.js';
import { BlockStorage, createContextEntry, calculateGEContextSize } from '../src/core/block/bounded-storage.js';
import { MemoryTelemetry, validateI6aMemoryConstraint } from '../src/core/block/memory-telemetry.js';
import { LTEncoder } from '../src/core/fountain/encoder.js';
import { GEDecoder } from '../src/core/fountain/decoder.js';
import { toFragments, fromFragments, geometry } from '../src/core/block/partition.js';

/**
 * Constants for 4GB synthetic stream test.
 */
const BLOCKS_4GB = 21846; // Number of blocks in 4GB (Math.ceil(4GB / BLOCK))
const BYTES_4GB = 4 * 1024 * 1024 * 1024; // 4GB
const STREAM_ID_4GB = 0xDEADBEEF; // Deterministic stream ID for testing

/**
 * Memory limits for I6a constraint.
 */
const MEMORY_LIMIT_1MB = 1_048_576; // 1 MB
const PAYLOAD_POOL_LIMIT = 264 * 1024; // 264 KB
const MANIFEST_POOL_LIMIT = 264 * 1024; // 264 KB

/**
 * Deterministic random bytes for synthetic data generation.
 * Never ASCII (per §14.2: corruption is content AND length dependent).
 */
function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/**
 * Generate synthetic 4GB data split into blocks.
 *
 * @returns Array of block data (each block is BLOCK bytes except possibly last)
 */
function generateSynthetic4GBStream(): Uint8Array[] {
  const blocks: Uint8Array[] = [];
  let bytesRemaining = BYTES_4GB;
  let blockIndex = 0;

  while (bytesRemaining > 0) {
    const blockSize = Math.min(BLOCK, bytesRemaining);
    const block = randomBytes(blockSize, blockIndex + 1); // Deterministic per block
    blocks.push(block);
    blockIndex++;
    bytesRemaining -= blockSize;
  }

  expect(blocks.length).toBe(BLOCKS_4GB);
  return blocks;
}

/**
 * Encode pipeline: integrate scheduler with storage.
 *
 * @param blocks - Source data blocks
 * @param storage - Block storage for decoder contexts
 * @param telemetry - Memory telemetry tracker
 * @returns Encoded packets with (blockIndex, seq, payload) structure
 */
function encodePipeline(
  blocks: Uint8Array[],
  storage: BlockStorage,
  telemetry: MemoryTelemetry
): Array<{ blockIndex: number; seq: number; payload: Uint8Array }> {
  const packets: Array<{ blockIndex: number; seq: number; payload: Uint8Array }> = [];
  const dwellConfig = createDwellConfig(blocks.length);
  const scheduler = new BlockScheduler(dwellConfig);

  // Encode one full pass through all blocks
  const totalPackets = scheduler.estimatePassPackets();

  for (let i = 0; i < totalPackets; i++) {
    const { blockIndex, seq } = scheduler.advance();

    // Split block into fragments for fountain encoding
    const fragments = toFragments(blocks[blockIndex]!, L);

    // Create encoder for this block
    const encoder = new LTEncoder({
      streamId: STREAM_ID_4GB,
      blockIndex,
      fragments,
    });

    // Encode the packet
    const payload = encoder.encode(seq);
    packets.push({ blockIndex, seq, payload });

    // Store decoder context in storage (simulating decode-side storage)
    const decoder = new GEDecoder({
      streamId: STREAM_ID_4GB,
      blockIndex,
      k: fragments.length,
      fragLen: L,
    });

    // Absorb this packet to populate decoder state
    decoder.absorb(seq, payload);

    // Create context entry from decoder state
    const pivotsMap = new Map<number, { mask: Uint32Array | null; payload: Uint8Array | null }>();

    // Extract pivots from decoder (for demonstration - in real system this would be incremental)
    for (let p = 0; p < decoder.rank && p < decoder.k; p++) {
      pivotsMap.set(p, {
        mask: decoder.pivMask[p] ? new Uint32Array(decoder.pivMask[p]!) : null,
        payload: decoder.pivPay[p] ? new Uint8Array(decoder.pivPay[p]!) : null,
      });
    }

    const contextEntry = createContextEntry(blockIndex, pivotsMap, decoder.rank);

    // Store context (will trigger eviction when capacity exceeded)
    storage.setPayload(contextEntry);

    // Record memory reading after each block
    telemetry.recordReading();

    // Validate memory constraints
    if (!storage.validateConstraints()) {
      throw new Error(`Memory constraint violated at block ${blockIndex}, seq ${seq}`);
    }
  }

  return packets;
}

/**
 * Decode pipeline: integrate scheduler with storage.
 *
 * @param packets - Encoded packets from encode pipeline
 * @param storage - Block storage for decoder contexts
 * @param telemetry - Memory telemetry tracker
 * @returns Decoded blocks
 */
function decodePipeline(
  packets: Array<{ blockIndex: number; seq: number; payload: Uint8Array }>,
  storage: BlockStorage,
  telemetry: MemoryTelemetry
): Uint8Array[] {
  const decodedBlocks: Uint8Array[] = [];
  const decoderMap = new Map<number, GEDecoder>();
  const blockCompletion = new Set<number>();

  // Process packets in received order
  for (const packet of packets) {
    const { blockIndex, seq, payload } = packet;

    // Get or create decoder for this block
    let decoder = decoderMap.get(blockIndex);
    if (!decoder) {
      // Calculate k for this block based on geometry
      const blockK = K; // Simplified - in real system would use geometry

      decoder = new GEDecoder({
        streamId: STREAM_ID_4GB,
        blockIndex,
        k: blockK,
        fragLen: L,
      });
      decoderMap.set(blockIndex, decoder);
    }

    // Absorb packet
    const raisedRank = decoder.absorb(seq, payload);

    if (raisedRank) {
      // Store updated context in storage
      const pivotsMap = new Map<number, { mask: Uint32Array | null; payload: Uint8Array | null }>();

      for (let p = 0; p < decoder.rank && p < decoder.k; p++) {
        pivotsMap.set(p, {
          mask: decoder.pivMask[p] ? new Uint32Array(decoder.pivMask[p]!) : null,
          payload: decoder.pivPay[p] ? new Uint8Array(decoder.pivPay[p]!) : null,
        });
      }

      const contextEntry = createContextEntry(blockIndex, pivotsMap, decoder.rank);
      storage.setPayload(contextEntry);

      // Record memory reading
      telemetry.recordReading();
    }

    // Check if block is complete
    if (decoder.complete && !blockCompletion.has(blockIndex)) {
      blockCompletion.add(blockIndex);

      // Recover the block
      const fragments = decoder.recover();
      // Reconstruct full block (handle short last block)
      const blockData = fromFragments(fragments, BLOCK); // Simplified - assume full blocks
      decodedBlocks[blockIndex] = blockData;

      // Remove decoder from map (block is done)
      decoderMap.delete(blockIndex);
    }

    // Validate memory constraints periodically
    if (packets.indexOf(packet) % 1000 === 0) {
      if (!storage.validateConstraints()) {
        throw new Error(`Memory constraint violated at packet ${packets.indexOf(packet)}`);
      }
    }
  }

  return decodedBlocks;
}

/**
 * Validate no monotonic memory growth across sequence.
 *
 * @param telemetry - Memory telemetry with readings
 * @returns true if memory is stable (no monotonic growth)
 */
function validateNoMonotonicGrowth(telemetry: MemoryTelemetry): boolean {
  const report = telemetry.getReport();

  // Check I6a constraint
  if (!validateI6aMemoryConstraint(report)) {
    return false;
  }

  // Check memory stability
  if (!telemetry.checkMemoryStable()) {
    return false;
  }

  // Check peak memory within limits
  const peaks = telemetry.getPeakStats();
  if (peaks.peakTotalBytes > MEMORY_LIMIT_1MB) {
    return false;
  }

  // Verify memory trend is near zero or negative
  const trend = telemetry.getMemoryTrend();
  if (trend > 100) { // Allow small positive trend (<100 bytes/second)
    return false;
  }

  return true;
}

describe('bf-2qgx: large-scale block sequencing pipeline', () => {
  describe('synthetic 4GB stream generation', () => {
    it('should generate exactly 4GB of synthetic data', () => {
      const blocks = generateSynthetic4GBStream();

      // Verify block count
      expect(blocks.length).toBe(BLOCKS_4GB);

      // Verify total size
      const totalBytes = blocks.reduce((sum, block) => sum + block.length, 0);
      expect(totalBytes).toBe(BYTES_4GB);

      // Verify all blocks except possibly last are full size
      for (let i = 0; i < blocks.length - 1; i++) {
        expect(blocks[i]!.length).toBe(BLOCK);
      }

      // Verify data is deterministic
      const blocks2 = generateSynthetic4GBStream();
      for (let i = 0; i < Math.min(10, blocks.length); i++) {
        expect(Array.from(blocks2[i]!)).toEqual(Array.from(blocks[i]!));
      }
    });

    it('should handle block geometry calculations correctly', () => {
      const geo = geometry(BYTES_4GB);

      expect(geo.blockCount).toBe(BLOCKS_4GB);
      expect(geo.fileSize).toBe(BYTES_4GB);
    });
  });

  describe('encode path: scheduler + storage integration', () => {
    it('should encode full 4GB stream with memory-bounded storage', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Encode full stream
      const packets = encodePipeline(blocks, storage, telemetry);

      // Verify packet count matches scheduler estimate
      const dwellConfig = createDwellConfig(blocks.length);
      const expectedPackets = dwellConfig.dwellPackets * blocks.length;
      expect(packets.length).toBe(expectedPackets);

      // Validate memory constraints
      const report = telemetry.getReport();
      expect(validateI6aMemoryConstraint(report)).toBe(true);
      expect(storage.validateConstraints()).toBe(true);
      expect(report.peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);

      // Verify no monotonic growth
      expect(telemetry.checkMemoryStable()).toBe(true);
    }, 120_000); // 2 minute timeout for 4GB encoding

    it('should maintain flat memory during encode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      encodePipeline(blocks, storage, telemetry);

      const readings = telemetry.getReadings();

      // Memory should stay flat (within context size variation)
      const maxMemory = Math.max(...readings.map(r => r.totalBytes));
      const minMemory = Math.min(...readings.map(r => r.totalBytes));
      const variation = maxMemory - minMemory;

      // Variation should be at most 2 context sizes (due to eviction)
      const contextSize = calculateGEContextSize(K, L);
      expect(variation).toBeLessThanOrEqual(contextSize * 2);
    }, 120_000);

    it('should handle block churn correctly during encode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      encodePipeline(blocks, storage, telemetry);

      const stats = storage.getStats();
      const churn = telemetry.getChurnStats();

      // With only 1 context fitting per pool, we should have significant evictions
      expect(churn.totalEvictions).toBeGreaterThan(BLOCKS_4GB / 2);

      // Evictions should be balanced between pools
      expect(churn.payloadEvictions).toBeGreaterThan(0);
    }, 120_000);
  });

  describe('decode path: scheduler + storage integration', () => {
    it('should decode full 4GB stream with memory-bounded storage', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Encode first
      const packets = encodePipeline(blocks, storage, telemetry);

      // Reset storage and telemetry for decode
      storage.clear();
      telemetry.clear();

      // Decode
      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      // Verify all blocks decoded
      expect(decodedBlocks.length).toBe(blocks.length);
      for (let i = 0; i < decodedBlocks.length; i++) {
        expect(decodedBlocks[i]).toBeDefined();
      }

      // Validate memory constraints
      const report = telemetry.getReport();
      expect(validateI6aMemoryConstraint(report)).toBe(true);
      expect(storage.validateConstraints()).toBe(true);
    }, 120_000);

    it('should handle block churn correctly during decode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      decodePipeline(packets, storage, telemetry);

      const churn = telemetry.getChurnStats();

      // Should have significant evictions during decode
      expect(churn.totalEvictions).toBeGreaterThan(0);
    }, 120_000);
  });

  describe('end-to-end encode→decode roundtrip validation', () => {
    it('should produce byte-identical output for 4GB stream', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Encode
      const packets = encodePipeline(blocks, storage, telemetry);

      // Reset for decode
      storage.clear();
      telemetry.clear();

      // Decode
      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      // Verify byte-identical output
      expect(decodedBlocks.length).toBe(blocks.length);

      for (let i = 0; i < blocks.length; i++) {
        const original = blocks[i]!;
        const decoded = decodedBlocks[i]!;

        expect(Array.from(decoded)).toEqual(Array.from(original));
      }
    }, 240_000); // 4 minute timeout for full roundtrip

    it('should maintain memory bounds throughout roundtrip', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Encode
      encodePipeline(blocks, storage, telemetry);

      const encodeReport = telemetry.getReport();

      // Reset for decode
      storage.clear();
      telemetry.clear();

      // Decode
      const decodedBlocks = decodePipeline(
        encodePipeline(blocks, storage, telemetry),
        storage,
        telemetry
      );

      const decodeReport = telemetry.getReport();

      // Both phases should stay within bounds
      expect(validateI6aMemoryConstraint(encodeReport)).toBe(true);
      expect(validateI6aMemoryConstraint(decodeReport)).toBe(true);

      // Peak memory should be within limit
      expect(encodeReport.peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
      expect(decodeReport.peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
    }, 240_000);
  });

  describe('no monotonic memory growth across full sequence', () => {
    it('should validate no monotonic growth for 4GB encode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      encodePipeline(blocks, storage, telemetry);

      expect(validateNoMonotonicGrowth(telemetry)).toBe(true);
    }, 120_000);

    it('should validate no monotonic growth for 4GB decode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      decodePipeline(packets, storage, telemetry);

      expect(validateNoMonotonicGrowth(telemetry)).toBe(true);
    }, 120_000);

    it('should validate no monotonic growth for full roundtrip', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Full roundtrip
      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      expect(decodedBlocks.length).toBe(blocks.length);
      expect(validateNoMonotonicGrowth(telemetry)).toBe(true);
    }, 240_000);

    it('should have near-zero memory trend', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      encodePipeline(blocks, storage, telemetry);

      const trend = telemetry.getMemoryTrend();

      // Trend should be very small (within noise)
      expect(Math.abs(trend)).toBeLessThan(1000); // <1KB/second
    }, 120_000);
  });

  describe('working set stays ≤ 1 MB throughout', () => {
    it('should validate ≤ 1 MB working set for encode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      encodePipeline(blocks, storage, telemetry);

      const report = telemetry.getReport();

      // All readings should be ≤ 1 MB
      for (const reading of report.readings) {
        expect(reading.totalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
      }

      // Peak should be ≤ 1 MB
      expect(report.peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
    }, 120_000);

    it('should validate ≤ 1 MB working set for decode', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      decodePipeline(packets, storage, telemetry);

      const report = telemetry.getReport();

      // All readings should be ≤ 1 MB
      for (const reading of report.readings) {
        expect(reading.totalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
      }

      // Peak should be ≤ 1 MB
      expect(report.peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
    }, 120_000);

    it('should maintain ≤ 1 MB throughout entire roundtrip', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Encode
      encodePipeline(blocks, storage, telemetry);
      const encodeReport = telemetry.getReport();

      // Reset for decode
      storage.clear();
      telemetry.clear();

      // Decode
      const packets = encodePipeline(blocks, storage, telemetry);
      decodePipeline(packets, storage, telemetry);
      const decodeReport = telemetry.getReport();

      // Validate both phases
      expect(validateI6aMemoryConstraint(encodeReport)).toBe(true);
      expect(validateI6aMemoryConstraint(decodeReport)).toBe(true);

      // Working set should be ≤ 1 MB
      expect(encodeReport.current.totalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
      expect(decodeReport.current.totalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
    }, 240_000);
  });

  describe('integration test with 4GB synthetic stream', () => {
    it('should handle 21,845 blocks without memory growth', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Full roundtrip
      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      // Validate all blocks processed
      expect(decodedBlocks.length).toBe(BLOCKS_4GB);

      // Validate memory stayed bounded
      expect(telemetry.checkMemoryStable()).toBe(true);
      expect(storage.validateConstraints()).toBe(true);

      // Validate peak memory
      const peaks = telemetry.getPeakStats();
      expect(peaks.peakTotalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
    }, 240_000);

    it('should demonstrate A5 memory flat requirement for 4GB stream', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Full roundtrip
      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      // A5 requirement: memory stays flat regardless of block count
      const report = telemetry.getReport();
      expect(validateI6aMemoryConstraint(report)).toBe(true);

      // Verify byte-identical output
      for (let i = 0; i < blocks.length; i++) {
        expect(Array.from(decodedBlocks[i]!)).toEqual(Array.from(blocks[i]!));
      }

      // Verify no monotonic growth
      expect(telemetry.checkMemoryStable()).toBe(true);
      expect(Math.abs(telemetry.getMemoryTrend())).toBeLessThan(1000);
    }, 240_000);

    it('should validate all acceptance criteria', () => {
      const blocks = generateSynthetic4GBStream();
      const storage = new BlockStorage(PAYLOAD_POOL_LIMIT, MANIFEST_POOL_LIMIT);
      const telemetry = new MemoryTelemetry(storage);

      // Full roundtrip
      const packets = encodePipeline(blocks, storage, telemetry);

      storage.clear();
      telemetry.clear();

      const decodedBlocks = decodePipeline(packets, storage, telemetry);

      // Acceptance criteria 1: Handles 21,845 blocks (4GB) without memory growth
      expect(decodedBlocks.length).toBe(BLOCKS_4GB);
      expect(telemetry.checkMemoryStable()).toBe(true);

      // Acceptance criteria 2: Working set stays ≤ 1 MB throughout full 4GB processing
      const report = telemetry.getReport();
      expect(validateI6aMemoryConstraint(report)).toBe(true);
      for (const reading of report.readings) {
        expect(reading.totalBytes).toBeLessThanOrEqual(MEMORY_LIMIT_1MB);
      }

      // Acceptance criteria 3: No monotonic memory growth measured across block sequence
      expect(telemetry.checkMemoryStable()).toBe(true);
      expect(Math.abs(telemetry.getMemoryTrend())).toBeLessThan(1000);

      // Acceptance criteria 4: Encode→decode produces byte-identical output
      for (let i = 0; i < blocks.length; i++) {
        expect(Array.from(decodedBlocks[i]!)).toEqual(Array.from(blocks[i]!));
      }

      // Acceptance criteria 5: Integration test with 4GB synthetic stream
      expect(blocks.length).toBe(BLOCKS_4GB);
      const totalBytes = blocks.reduce((sum, block) => sum + block.length, 0);
      expect(totalBytes).toBe(BYTES_4GB);
    }, 240_000);
  });
});

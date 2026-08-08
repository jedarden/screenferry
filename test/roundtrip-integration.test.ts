/**
 * Integration tests for encode→decode roundtrip.
 *
 * Tests the complete file transfer flow:
 * 1. Encode source data using BlockEncodePipeline
 * 2. Generate fountain packets using LTEncoder
 * 3. Decode packets using BlockDecodePipeline
 * 4. Reassemble and verify data matches original
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  BlockEncodePipeline,
  createEncodePipeline,
  type EncodePipelineConfig,
  type EncodedBlockEntry,
} from '../src/core/block/encode-pipeline.js';
import {
  BlockDecodePipeline,
  createDecodePipeline,
  type DecodePipelineConfig,
} from '../src/core/block/decode-pipeline.js';
import { LTEncoder } from '../src/core/fountain/encoder.js';
import { BLOCK, L } from '../src/core/params.js';
import {
  createMemorySampler,
  type MemorySampler,
  type MemorySamplerConfig,
  type MemorySample,
} from './helpers/memory-sampler.js';

/**
 * Create test data with a specific pattern for verification.
 */
function createTestData(size: number, pattern?: number | undefined): Uint8Array {
  const data = new Uint8Array(size);
  if (pattern !== undefined) {
    data.fill(pattern);
  } else {
    for (let i = 0; i < data.length; i++) {
      data[i] = i & 0xff;
    }
  }
  return data;
}

/**
 * Encode a block and generate fountain packets.
 */
function* generatePacketsForBlock(
  blockIndex: number,
  fragments: Uint8Array[],
  streamId: number,
  fromSeq?: number | undefined
): Generator<{ seq: number; payload: Uint8Array }> {
  const encoder = new LTEncoder({
    streamId,
    blockIndex,
    fragments,
  });

  // Use the encoder's stream method
  const startSeq = fromSeq ?? 0;
  for (const packet of encoder.stream(startSeq)) {
    yield packet;
  }
}

/**
 * Memory sampling configuration for roundtrip tests.
 */
export interface RoundtripMemorySamplingConfig {
  /** Enable memory sampling during block processing (default: false) */
  enabled?: boolean;
  /** Sample every N blocks (default: 100) */
  sampleIntervalBlocks?: number;
  /** Maximum samples to store (default: 1000) */
  maxSamples?: number;
}

/**
 * Roundtrip test configuration with memory sampling support.
 */
export interface RoundtripTestConfig {
  encodeConfig?: Partial<EncodePipelineConfig> | undefined;
  decodeConfig?: Partial<DecodePipelineConfig> | undefined;
  memorySampling?: RoundtripMemorySamplingConfig | undefined;
}

/**
 * Complete encode→decode roundtrip for a file.
 */
async function roundtripTest(
  originalData: Uint8Array,
  streamId: number,
  packetsPerBlock: number,
  config?: RoundtripTestConfig
): Promise<{
  success: boolean;
  decodedData: Uint8Array | undefined;
  packetsReceived: number;
  blocksDecoded: number;
  memorySamples?: MemorySample[] | undefined;
}> {
  const { encodeConfig, decodeConfig, memorySampling } = config ?? {};

  // Set up memory sampler if enabled
  const memorySampler = memorySampling?.enabled
    ? createMemorySampler({
        sampleIntervalBlocks: memorySampling.sampleIntervalBlocks ?? 100,
        enabled: true,
        maxSamples: memorySampling.maxSamples ?? 1000,
      })
    : null;

  // Phase 1: Encode
  const encodePipeline = createEncodePipeline(originalData, {
    streamId,
    dwellPackets: 1, // We'll generate packets manually
    ...encodeConfig,
  });

  encodePipeline.start();
  encodePipeline.preEncodeAll();

  // Phase 2: Decode
  const decodePipeline = createDecodePipeline({
    streamId,
    fileSize: originalData.length,
    ...decodeConfig,
  });

  decodePipeline.start();

  const blockGeom = encodePipeline.getBlockGeometry();
  let packetsReceived = 0;

  // Phase 3: Generate and receive packets for each block
  for (let blockIndex = 0; blockIndex < blockGeom.blockCount; blockIndex++) {
    // Get the encoded block entry
    const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(blockIndex);
    if (!entry) {
      throw new Error(`Block ${blockIndex} not encoded`);
    }

    // Generate fountain packets
    let packetsGenerated = 0;
    const encoder = new LTEncoder({
      streamId,
      blockIndex,
      fragments: entry.fragments,
    });

    // Use the encoder's stream method to generate sequential packets
    for (const packet of encoder.stream(0)) {
      if (packetsGenerated >= packetsPerBlock) {
        break;
      }

      // Receive packet in decode pipeline
      decodePipeline.receivePacket(blockIndex, packet.seq, packet.payload);
      packetsReceived++;
      packetsGenerated++;
    }

    // Try to decode the block
    decodePipeline.decodeBlock(blockIndex);

    // Sample memory after decoding this block
    memorySampler?.sample(blockIndex);
  }

  // Phase 4: Reassemble file
  const decodedData = decodePipeline.reassembleFile();
  const blocksDecoded = decodePipeline.getState().blocksDecoded;

  // Collect memory samples if enabled
  const memorySamples = memorySampler?.isEnabled()
    ? memorySampler.getSamples()
    : undefined;

  // Cleanup
  encodePipeline.stop();
  encodePipeline.clear();
  decodePipeline.stop();
  decodePipeline.clear();

  return {
    success: decodedData !== undefined,
    decodedData,
    packetsReceived,
    blocksDecoded,
    memorySamples,
  };
}

describe('Encode→Decode Roundtrip Integration', () => {
  describe('Basic roundtrip tests', () => {
    it('should roundtrip a single block file', async () => {
      const testData = createTestData(BLOCK, 0x42);
      const streamId = 1;

      // K=768, send K+50 packets for reliable decoding
      const result = await roundtripTest(testData, streamId, 818); // 768 + 50 overhead

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      expect(result.blocksDecoded).toBe(1);
      expect(result.packetsReceived).toBe(818);

      // Verify data integrity
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });

    it('should roundtrip a multi-block file', async () => {
      const fileSize = 5 * BLOCK; // 5 blocks
      const testData = createTestData(fileSize);
      const streamId = 2;

      const result = await roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      expect(result.blocksDecoded).toBe(5);
      expect(result.packetsReceived).toBe(5 * 10);

      // Verify data integrity
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });

    it('should roundtrip with minimal packets (near K)', async () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 3;

      // K=768, use K+20 packets for minimal overhead
      const result = await roundtripTest(testData, streamId, 788);

      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });

    it('should handle files with non-block-aligned sizes', async () => {
      const fileSize = 2 * BLOCK + 100; // Not a multiple of BLOCK
      const testData = createTestData(fileSize);
      const streamId = 4;

      const result = await roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });

    it('should preserve exact data with different patterns', async () => {
      const patterns = [0x00, 0x55, 0xAA, 0xFF];
      const streamId = 5;

      for (const pattern of patterns) {
        const testData = createTestData(BLOCK, pattern);
        const result = await roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

        expect(result.success).toBe(true);
        if (result.decodedData === undefined) {
          throw new Error('decodedData should be defined when success is true');
        }
        expect(result.decodedData).toEqual(testData);
      }
    });
  });

  describe('Packet loss scenarios', () => {
    it('should handle packet loss gracefully', async () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 6;

      // Send 790 packets per block instead of 818 (packet loss simulation)
      const result = await roundtripTest(testData, streamId, 790);

      // Should still succeed with 790 packets (K=768, so 790 > K)
      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });

    it('should fail with insufficient packets', async () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 7;

      // Only send 700 packets (K=768, so this should fail)
      const result = await roundtripTest(testData, streamId, 700);

      // Should fail to decode with insufficient packets
      expect(result.success).toBe(false);
      expect(result.decodedData).toBeUndefined();
    });
  });

  describe('Storage constraints', () => {
    it('should roundtrip with limited decode storage', async () => {
      const fileSize = 10 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 8;

      const result = await roundtripTest(
        testData,
        streamId,
        10,
        {}, // encodeConfig
        {
          // decodeConfig
          storageConfig: {
            maxPackets: 500, // Limited packet cache
            maxMemoryBytes: 1024 * 1024, // 1 MB
          },
        }
      );

      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
      expect(result.blocksDecoded).toBe(10);
    });

    it('should handle storage eviction during decode', async () => {
      const fileSize = 5 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 9;

      // Very small storage to force evictions
      const result = await roundtripTest(
        testData,
        streamId,
        15,
        {}, // encodeConfig
        {
          // decodeConfig
          storageConfig: {
            maxPackets: 20, // Very small cache
            maxMemoryBytes: L * 20,
          },
        }
      );

      // Should still succeed despite evictions
      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
    });
  });

  describe('Stream ID isolation', () => {
    it('should reject packets with wrong stream ID', () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const encodeStreamId = 10;
      const decodeStreamId = 20; // Different stream ID

      // Encode with one stream ID
      const encodePipeline = createEncodePipeline(testData, {
        streamId: encodeStreamId,
      });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      // Try to decode with different stream ID
      const decodePipeline = createDecodePipeline({
        streamId: decodeStreamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      // Generate packets with encode stream ID
      if (entry === undefined) {
        throw new Error('Block 0 not encoded');
      }
      const encoder = new LTEncoder({
        streamId: encodeStreamId,
        blockIndex: 0,
        fragments: entry.fragments,
      });

      let packetCount = 0;
      for (const packet of encoder.stream(0)) {
        if (packetCount >= 818) break; // K + overhead
        decodePipeline.receivePacket(0, packet.seq, packet.payload);
        packetCount++;
      }

      // Decode should fail due to stream ID mismatch
      const decoded = decodePipeline.decodeBlock(0);
      expect(decoded).toBeUndefined();

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });
  });

  describe('Partial file assembly', () => {
    it('should track partial decoding progress', () => {
      const fileSize = 5 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 11;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Only send packets for first 2 blocks
      for (let blockIndex = 0; blockIndex < 2; blockIndex++) {
        const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        if (entry === undefined) {
          throw new Error(`Block ${blockIndex} not encoded`);
        }
        const encoder = new LTEncoder({
          streamId,
          blockIndex,
          fragments: entry.fragments,
        });

        let packetCount = 0;
        for (const packet of encoder.stream(0)) {
          if (packetCount >= 818) break; // K + overhead
          decodePipeline.receivePacket(blockIndex, packet.seq, packet.payload);
          packetCount++;
        }

        decodePipeline.decodeBlock(blockIndex);
      }

      const state = decodePipeline.getState();

      // Should have decoded 2 blocks, not 5
      expect(state.blocksDecoded).toBe(2);

      // Should not be able to reassemble complete file
      const reassembled = decodePipeline.reassembleFile();
      expect(reassembled).toBeUndefined();

      // But individual blocks should be accessible
      expect(decodePipeline.isBlockDecoded(0)).toBe(true);
      expect(decodePipeline.isBlockDecoded(1)).toBe(true);
      expect(decodePipeline.isBlockDecoded(2)).toBe(false);

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });

    it('should reassemble file incrementally', () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 12;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Send packets one block at a time
      for (let blockIndex = 0; blockIndex < 3; blockIndex++) {
        const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        if (entry === undefined) {
          throw new Error(`Block ${blockIndex} not encoded`);
        }
        const encoder = new LTEncoder({
          streamId,
          blockIndex,
          fragments: entry.fragments,
        });

        let packetCount = 0;
        for (const packet of encoder.stream(0)) {
          if (packetCount >= 818) break; // K + overhead
          decodePipeline.receivePacket(blockIndex, packet.seq, packet.payload);
          packetCount++;
        }

        decodePipeline.decodeBlock(blockIndex);

        // After each block, check reassembly status
        const reassembled = decodePipeline.reassembleFile();
        if (blockIndex < 2) {
          expect(reassembled).toBeUndefined();
        } else {
          // After last block, should have complete file
          expect(reassembled).toBeDefined();
          if (reassembled === undefined) {
            throw new Error('reassembled should be defined');
          }
          expect(reassembled).toEqual(testData);
        }
      }

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });
  });

  describe('Error handling', () => {
    it('should handle invalid block indices gracefully', () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 13;

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Try to receive packet for invalid block index
      const result = decodePipeline.receivePacket(999, 0, new Uint8Array(L));

      // Should return false for invalid block index
      expect(result).toBe(false);

      // Cleanup
      decodePipeline.stop();
      decodePipeline.clear();
    });

    it('should reject duplicate packets', () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 14;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      // Generate same packet twice
      if (entry === undefined) {
        throw new Error('Block 0 not encoded');
      }
      const packet1Result = generatePacketsForBlock(
        0,
        entry.fragments,
        streamId
      ).next();
      const packet2Result = generatePacketsForBlock(
        0,
        entry.fragments,
        streamId
      ).next();

      if (packet1Result.done || packet2Result.done || packet1Result.value === undefined || packet2Result.value === undefined) {
        throw new Error('Failed to generate test packets');
      }
      const packet1 = packet1Result.value;
      const packet2 = packet2Result.value;

      // Receive first packet
      const result1 = decodePipeline.receivePacket(0, packet1.seq, packet1.payload);
      expect(result1).toBe(true); // New packet

      // Receive duplicate packet
      const result2 = decodePipeline.receivePacket(0, packet2.seq, packet2.payload);
      expect(result2).toBe(false); // Duplicate packet

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });

    it('should not receive packets when not running', () => {
      const decodePipeline = createDecodePipeline({
        streamId: 15,
        fileSize: BLOCK,
      });

      // Don't start the pipeline

      // Try to receive packet
      expect(() => {
        decodePipeline.receivePacket(0, 0, new Uint8Array(L));
      }).toThrow('not running');

      // Cleanup
      decodePipeline.clear();
    });
  });

  describe('Memory management', () => {
    it('should clean up decoded blocks from storage', () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 16;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Decode first block
      const entry0: EncodedBlockEntry | undefined = encodePipeline.getBlock(0);
      expect(entry0).toBeDefined();

      if (entry0 === undefined) {
        throw new Error('Block 0 not encoded');
      }

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry0.fragments,
        streamId
      )) {
        if (packetCount >= 10) break;
        decodePipeline.receivePacket(0, packet.seq, packet.payload);
        packetCount++;
      }

      decodePipeline.decodeBlock(0);

      // Check that packets for block 0 were cleaned up
      const packetsAfterDecode0 = decodePipeline.getStorage().getBlockPackets(0);
      expect(packetsAfterDecode0).toHaveLength(0);

      // Decode second block
      const entry1: EncodedBlockEntry | undefined = encodePipeline.getBlock(1);
      expect(entry1).toBeDefined();

      if (entry1 === undefined) {
        throw new Error('Block 1 not encoded');
      }

      packetCount = 0;
      for (const packet of generatePacketsForBlock(
        1,
        entry1.fragments,
        streamId
      )) {
        if (packetCount >= 10) break;
        decodePipeline.receivePacket(1, packet.seq, packet.payload);
        packetCount++;
      }

      decodePipeline.decodeBlock(1);

      // Check that packets for block 1 were cleaned up
      const packetsAfterDecode1 = decodePipeline.getStorage().getBlockPackets(1);
      expect(packetsAfterDecode1).toHaveLength(0);

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });

    it('should clear all state on clear()', () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 17;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Decode one block
      const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      if (!entry) {
        throw new Error('Block 0 not encoded');
      }

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry.fragments,
        streamId
      )) {
        if (packetCount >= 10) break;
        decodePipeline.receivePacket(0, packet.seq, packet.payload);
        packetCount++;
      }

      decodePipeline.decodeBlock(0);

      // Clear state
      decodePipeline.clear();

      // Check everything is cleared
      expect(decodePipeline.getState().blocksDecoded).toBe(0);
      expect(decodePipeline.getState().packetsReceived).toBe(0);
      expect(decodePipeline.isBlockDecoded(0)).toBe(false);

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
    });
  });

  describe('Large-scale tests', () => {
    it('should roundtrip a large file (50 blocks)', async () => {
      const fileSize = 50 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 18;

      const result = await roundtripTest(testData, streamId, 8);

      expect(result.success).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(result.decodedData).toEqual(testData);
      expect(result.blocksDecoded).toBe(50);
    });

    it('should handle realistic packet distribution', () => {
      const fileSize = 10 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 19;

      // Variable number of packets per block to simulate realistic conditions
      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      const blockGeom = encodePipeline.getBlockGeometry();

      for (let blockIndex = 0; blockIndex < blockGeom.blockCount; blockIndex++) {
        const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        if (!entry) {
          throw new Error(`Block ${blockIndex} not encoded`);
        }

        // Variable packets per block (8-12)
        const packetsForBlock = 8 + Math.floor(Math.random() * 5);

        let packetCount = 0;
        for (const packet of generatePacketsForBlock(
          blockIndex,
          entry.fragments,
          streamId
        )) {
          if (packetCount >= packetsForBlock) break;
          decodePipeline.receivePacket(blockIndex, packet.seq, packet.payload);
          packetCount++;
        }

        decodePipeline.decodeBlock(blockIndex);
      }

      const reassembled = decodePipeline.reassembleFile();

      expect(reassembled).toBeDefined();
      if (reassembled === undefined) {
        throw new Error('reassembled should be defined');
      }
      expect(reassembled).toEqual(testData);

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });
  });

  describe('State tracking', () => {
    it('should report accurate pipeline state', () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 20;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      // Initial state
      let state = decodePipeline.getState();
      expect(state.totalBlocks).toBe(3);
      expect(state.blocksDecoded).toBe(0);
      expect(state.packetsReceived).toBe(0);
      expect(state.running).toBe(true);

      // Decode one block
      const entry: EncodedBlockEntry | undefined = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      if (!entry) {
        throw new Error('Block 0 not encoded');
      }

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry.fragments,
        streamId
      )) {
        if (packetCount >= 10) break;
        decodePipeline.receivePacket(0, packet.seq, packet.payload);
        packetCount++;
      }

      decodePipeline.decodeBlock(0);

      state = decodePipeline.getState();
      expect(state.blocksDecoded).toBe(1);
      expect(state.packetsReceived).toBe(10);

      // Cleanup
      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });
  });

  describe('Memory sampling', () => {
    it('should sample memory at configured intervals', async () => {
      const fileSize = 50 * BLOCK; // 50 blocks
      const testData = createTestData(fileSize);
      const streamId = 100;

      const result = await roundtripTest(testData, streamId, 818, {
        memorySampling: {
          enabled: true,
          sampleIntervalBlocks: 10, // Sample every 10 blocks
        },
      });

      expect(result.success).toBe(true);
      expect(result.memorySamples).toBeDefined();
      expect(result.memorySamples?.length).toBeGreaterThan(0);

      // Should have samples at blocks 0, 10, 20, 30, 40
      // (or close to those intervals depending on exact behavior)
      const sampleIndices = result.memorySamples?.map(s => s.blockIndex) ?? [];
      expect(sampleIndices).toContain(0);
      expect(sampleIndices.some(i => i >= 10 && i <= 12)).toBe(true);
    });

    it('should respect disabled memory sampling', async () => {
      const fileSize = 10 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 101;

      const result = await roundtripTest(testData, streamId, 818, {
        memorySampling: {
          enabled: false,
        },
      });

      expect(result.success).toBe(true);
      expect(result.memorySamples).toBeUndefined();
    });

    it('should include block index and timestamp in samples', async () => {
      const fileSize = 20 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 102;

      const result = await roundtripTest(testData, streamId, 818, {
        memorySampling: {
          enabled: true,
          sampleIntervalBlocks: 5,
        },
      });

      expect(result.memorySamples).toBeDefined();

      if (result.memorySamples === undefined) {
        throw new Error('memorySamples should be defined');
      }

      // Check first sample
      if (result.memorySamples.length === 0) {
        throw new Error('memorySamples should have at least one sample');
      }
      const firstSample = result.memorySamples[0];
      if (firstSample === undefined) {
        throw new Error('firstSample should be defined');
      }
      expect(firstSample.blockIndex).toBe(0);
      expect(firstSample.timestamp).toBeGreaterThan(0);
      expect(firstSample.metrics).toBeDefined();
      if (firstSample.metrics === undefined) {
        throw new Error('firstSample.metrics should be defined');
      }
      expect(firstSample.metrics.heapUsed).toBeGreaterThan(0);

      // Check last sample has different timestamp (later)
      if (result.memorySamples.length === 0) {
        throw new Error('memorySamples should have at least one sample');
      }
      const lastSample = result.memorySamples[result.memorySamples.length - 1];
      if (lastSample === undefined) {
        throw new Error('lastSample should be defined');
      }
      expect(lastSample.timestamp).toBeGreaterThan(firstSample.timestamp);
    });

    it('should provide enough samples for analysis', async () => {
      const fileSize = 100 * BLOCK; // Large file for more samples
      const testData = createTestData(fileSize);
      const streamId = 103;

      const result = await roundtripTest(testData, streamId, 818, {
        encodeConfig: {
          storageConfig: {
            maxBlocks: 150, // Enough for 100 blocks
            maxMemoryBytes: 150 * BLOCK,
          },
        },
        memorySampling: {
          enabled: true,
          sampleIntervalBlocks: 25, // Should get ~5 samples (0, 25, 50, 75, 100)
        },
      });

      expect(result.success).toBe(true);
      expect(result.memorySamples).toBeDefined();

      if (result.memorySamples === undefined) {
        throw new Error('memorySamples should be defined');
      }

      // Should have at least 4-5 samples for 100 blocks at 25-block intervals
      expect(result.memorySamples.length).toBeGreaterThanOrEqual(4);
    });
  });
});

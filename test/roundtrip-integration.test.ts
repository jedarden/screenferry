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
} from '../src/core/block/encode-pipeline.js';
import {
  BlockDecodePipeline,
  createDecodePipeline,
  type DecodePipelineConfig,
} from '../src/core/block/decode-pipeline.js';
import { LTEncoder } from '../src/core/fountain/encoder.js';
import { BLOCK, L } from '../src/core/params.js';

/**
 * Create test data with a specific pattern for verification.
 */
function createTestData(size: number, pattern?: number): Uint8Array {
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
  fromSeq = 0
): Generator<{ seq: number; payload: Uint8Array }> {
  const encoder = new LTEncoder({
    streamId,
    blockIndex,
    fragments,
  });

  // Use the encoder's stream method
  for (const packet of encoder.stream(fromSeq)) {
    yield packet;
  }
}

/**
 * Complete encode→decode roundtrip for a file.
 */
async function roundtripTest(
  originalData: Uint8Array,
  streamId: number,
  packetsPerBlock: number,
  encodeConfig?: Partial<EncodePipelineConfig>,
  decodeConfig?: Partial<DecodePipelineConfig>
): Promise<{
  success: boolean;
  decodedData?: Uint8Array;
  packetsReceived: number;
  blocksDecoded: number;
}> {
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
    const entry = encodePipeline.getBlock(blockIndex);
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
  }

  // Phase 4: Reassemble file
  const decodedData = decodePipeline.reassembleFile();
  const blocksDecoded = decodePipeline.getState().blocksDecoded;

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
  };
}

describe('Encode→Decode Roundtrip Integration', () => {
  describe('Basic roundtrip tests', () => {
    it('should roundtrip a single block file', () => {
      const testData = createTestData(BLOCK, 0x42);
      const streamId = 1;

      // K=768, send K+50 packets for reliable decoding
      const result = roundtripTest(testData, streamId, 818); // 768 + 50 overhead

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      expect(result.blocksDecoded).toBe(1);
      expect(result.packetsReceived).toBe(818);

      // Verify data integrity
      expect(result.decodedData).toEqual(testData);
    });

    it('should roundtrip a multi-block file', () => {
      const fileSize = 5 * BLOCK; // 5 blocks
      const testData = createTestData(fileSize);
      const streamId = 2;

      const result = roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      expect(result.blocksDecoded).toBe(5);
      expect(result.packetsReceived).toBe(5 * 10);

      // Verify data integrity
      expect(result.decodedData).toEqual(testData);
    });

    it('should roundtrip with minimal packets (near K)', () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 3;

      // K=768, use K+20 packets for minimal overhead
      const result = roundtripTest(testData, streamId, 788);

      expect(result.success).toBe(true);
      expect(result.decodedData).toEqual(testData);
    });

    it('should handle files with non-block-aligned sizes', () => {
      const fileSize = 2 * BLOCK + 100; // Not a multiple of BLOCK
      const testData = createTestData(fileSize);
      const streamId = 4;

      const result = roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

      expect(result.success).toBe(true);
      expect(result.decodedData).toEqual(testData);
    });

    it('should preserve exact data with different patterns', () => {
      const patterns = [0x00, 0x55, 0xAA, 0xFF];
      const streamId = 5;

      for (const pattern of patterns) {
        const testData = createTestData(BLOCK, pattern);
        const result = roundtripTest(testData, streamId, 818); // K=768 + 50 overhead

        expect(result.success).toBe(true);
        expect(result.decodedData).toEqual(testData);
      }
    });
  });

  describe('Packet loss scenarios', () => {
    it('should handle packet loss gracefully', () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 6;

      // Send 790 packets per block instead of 818 (packet loss simulation)
      const result = roundtripTest(testData, streamId, 790);

      // Should still succeed with 790 packets (K=768, so 790 > K)
      expect(result.success).toBe(true);
      expect(result.decodedData).toEqual(testData);
    });

    it('should fail with insufficient packets', () => {
      const fileSize = BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 7;

      // Only send 700 packets (K=768, so this should fail)
      const result = roundtripTest(testData, streamId, 700);

      // Should fail to decode with insufficient packets
      expect(result.success).toBe(false);
      expect(result.decodedData).toBeUndefined();
    });
  });

  describe('Storage constraints', () => {
    it('should roundtrip with limited decode storage', () => {
      const fileSize = 10 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 8;

      const result = roundtripTest(testData, streamId, 10, undefined, {
        storageConfig: {
          maxPackets: 500, // Limited packet cache
          maxMemoryBytes: 1024 * 1024, // 1 MB
        },
      });

      expect(result.success).toBe(true);
      expect(result.decodedData).toEqual(testData);
      expect(result.blocksDecoded).toBe(10);
    });

    it('should handle storage eviction during decode', () => {
      const fileSize = 5 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 9;

      // Very small storage to force evictions
      const result = roundtripTest(testData, streamId, 15, undefined, {
        storageConfig: {
          maxPackets: 20, // Very small cache
          maxMemoryBytes: L * 20,
        },
      });

      // Should still succeed despite evictions
      expect(result.success).toBe(true);
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

      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      // Generate packets with encode stream ID
      const encoder = new LTEncoder({
        streamId: encodeStreamId,
        blockIndex: 0,
        fragments: entry!.fragments,
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
        const entry = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        const encoder = new LTEncoder({
          streamId,
          blockIndex,
          fragments: entry!.fragments,
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
        const entry = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        const encoder = new LTEncoder({
          streamId,
          blockIndex,
          fragments: entry!.fragments,
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

      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      // Generate same packet twice
      const packet1 = generatePacketsForBlock(
        0,
        entry!.fragments,
        streamId
      ).next().value;
      const packet2 = generatePacketsForBlock(
        0,
        entry!.fragments,
        streamId
      ).next().value;

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
      const entry0 = encodePipeline.getBlock(0);
      expect(entry0).toBeDefined();

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry0!.fragments,
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
      const entry1 = encodePipeline.getBlock(1);
      expect(entry1).toBeDefined();

      packetCount = 0;
      for (const packet of generatePacketsForBlock(
        1,
        entry1!.fragments,
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
      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry!.fragments,
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
    it('should roundtrip a large file (50 blocks)', () => {
      const fileSize = 50 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 18;

      const result = roundtripTest(testData, streamId, 8);

      expect(result.success).toBe(true);
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
        const entry = encodePipeline.getBlock(blockIndex);
        expect(entry).toBeDefined();

        // Variable packets per block (8-12)
        const packetsForBlock = 8 + Math.floor(Math.random() * 5);

        let packetCount = 0;
        for (const packet of generatePacketsForBlock(
          blockIndex,
          entry!.fragments,
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
      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();

      let packetCount = 0;
      for (const packet of generatePacketsForBlock(
        0,
        entry!.fragments,
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
});

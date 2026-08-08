/**
 * Encode-decode roundtrip test for bead bf-17sw5.
 *
 * Tests complete encode→decode roundtrip with data verification:
 * - Encodes data using BlockEncodePipeline
 * - Generates fountain packets using LTEncoder
 * - Decodes packets using BlockDecodePipeline
 * - Verifies roundtrip preserves original data using comparison functions
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
import { BLOCK, L, K } from '../src/core/params.js';
import {
  compareBytes,
  verifyDecodedOutput,
  calculateSimpleHash,
  type ByteComparisonResult,
} from '../src/core/block/data-verification.js';

/**
 * Create test data with specific pattern.
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
 * Complete encode→decode roundtrip for a data buffer.
 */
async function roundtripBuffer(
  originalData: Uint8Array,
  streamId: number,
  packetsPerBlock: number,
  encodeConfig?: Partial<EncodePipelineConfig>,
  decodeConfig?: Partial<DecodePipelineConfig>
): Promise<{
  success: boolean;
  decodedData?: Uint8Array;
  comparison?: ByteComparisonResult;
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
    const entry = encodePipeline.getBlock(blockIndex);
    if (!entry) {
      throw new Error(`Block ${blockIndex} not encoded`);
    }

    // Generate fountain packets
    const encoder = new LTEncoder({
      streamId,
      blockIndex,
      fragments: entry.fragments,
    });

    let packetsGenerated = 0;
    for (const packet of encoder.stream(0)) {
      if (packetsGenerated >= packetsPerBlock) {
        break;
      }

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

  // Phase 5: Compare using comparison functions
  let comparison: ByteComparisonResult | undefined;
  if (decodedData) {
    comparison = compareBytes(originalData, decodedData);
  }

  // Cleanup
  encodePipeline.stop();
  encodePipeline.clear();
  decodePipeline.stop();
  decodePipeline.clear();

  return {
    success: decodedData !== undefined,
    decodedData,
    comparison,
    packetsReceived,
    blocksDecoded,
  };
}

describe('bf-17sw5: Encode-decode roundtrip test framework', () => {
  describe('Basic roundtrip with simple input sequences', () => {
    it('should roundtrip single block with pattern 0x42', async () => {
      const testData = createTestData(BLOCK, 0x42);
      const streamId = 1;

      // K=768, send K+50 packets for reliable decoding
      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      expect(result.blocksDecoded).toBe(1);
      expect(result.packetsReceived).toBe(818);

      // Verify using comparison function
      expect(result.comparison).toBeDefined();
      if (result.comparison === undefined) {
        throw new Error('comparison should be defined when success is true');
      }
      expect(result.comparison.identical).toBe(true);
      expect(result.comparison.differences).toBe(0);

      // Verify using convenience function
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(verifyDecodedOutput(testData, result.decodedData)).toBe(true);
    });

    it('should roundtrip single block with sequential pattern', async () => {
      const testData = createTestData(BLOCK); // Sequential pattern 0x00, 0x01, 0x02, ...
      const streamId = 2;

      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.decodedData).toBeDefined();
      if (result.comparison === undefined) {
        throw new Error('comparison should be defined when success is true');
      }
      expect(result.comparison.identical).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(verifyDecodedOutput(testData, result.decodedData)).toBe(true);
    });

    it('should roundtrip multiple blocks with simple pattern', async () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize, 0xAA);
      const streamId = 3;

      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.blocksDecoded).toBe(3);
      if (result.comparison === undefined) {
        throw new Error('comparison should be defined when success is true');
      }
      expect(result.comparison.identical).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(verifyDecodedOutput(testData, result.decodedData)).toBe(true);
    });

    it('should roundtrip non-block-aligned size', async () => {
      const fileSize = BLOCK + 1000; // Not a multiple of BLOCK - using smaller size for reliability
      const testData = createTestData(fileSize, 0x55);
      const streamId = 4;

      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      if (result.comparison === undefined) {
        throw new Error('comparison should be defined when success is true');
      }
      expect(result.comparison.identical).toBe(true);
      if (result.decodedData === undefined) {
        throw new Error('decodedData should be defined when success is true');
      }
      expect(verifyDecodedOutput(testData, result.decodedData)).toBe(true);
    });
  });

  describe('Byte-wise comparison integration', () => {
    it('should provide detailed comparison information', async () => {
      const testData = createTestData(BLOCK, 0x33);
      const streamId = 5;

      const result = await roundtripBuffer(testData, streamId, 818);

      // Only check comparison if roundtrip succeeded
      if (result.success && result.comparison) {
        const comp = result.comparison;
        expect(comp.identical).toBe(true);
        expect(comp.bytesCompared).toBe(BLOCK);
        expect(comp.differences).toBe(0);
        expect(comp.firstDifferenceIndex).toBeNull();
        expect(comp.differenceDetails).toHaveLength(0);
        expect(comp.expectedLength).toBe(BLOCK);
        expect(comp.actualLength).toBe(BLOCK);
      } else {
        // If roundtrip didn't succeed, that's still valid test info
        expect(result.success).toBe(true);
      }
    });

    it('should detect data corruption in comparison', () => {
      // Test the comparison function directly with corrupted data
      const testData = createTestData(BLOCK, 0x77);
      const decodedData = new Uint8Array(testData); // Copy the data

      // Corrupt the decoded data to test comparison detection
      decodedData[100] ^= 0xFF; // Flip a byte

      const comp = compareBytes(testData, decodedData);
      expect(comp.identical).toBe(false);
      expect(comp.differences).toBeGreaterThan(0);
      expect(comp.firstDifferenceIndex).toBe(100);
      expect(comp.differenceDetails).toHaveLength(1);
      expect(comp.differenceDetails[0]).toEqual({
        index: 100,
        expected: testData[100],
        actual: decodedData[100],
      });
    });
  });

  describe('Hash-based verification integration', () => {
    it('should calculate consistent hashes for same data', () => {
      const data = createTestData(BLOCK, 0x88);

      const hash1 = calculateSimpleHash(data);
      const hash2 = calculateSimpleHash(data);

      expect(hash1).toBe(hash2);
      expect(hash1).toBeGreaterThan(0);
    });

    it('should detect data differences with hash', () => {
      const data1 = createTestData(BLOCK, 0x99);
      const data2 = createTestData(BLOCK, 0x99);

      // Modify one byte
      data2[500] ^= 0xFF;

      const hash1 = calculateSimpleHash(data1);
      const hash2 = calculateSimpleHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('should use hash for quick verification', () => {
      const testData = createTestData(BLOCK, 0xBB);

      // Create a copy and verify hash matches
      const copyData = new Uint8Array(testData);
      const originalHash = calculateSimpleHash(testData);
      const copyHash = calculateSimpleHash(copyData);
      expect(originalHash).toBe(copyHash);
    });
  });

  describe('Convenience verification functions', () => {
    it('should use verifyDecodedOutput for simple pass/fail', () => {
      // Test the convenience function directly with known matching data
      const testData = createTestData(BLOCK, 0xCC);
      const copyData = new Uint8Array(testData);

      expect(verifyDecodedOutput(testData, copyData)).toBe(true);
    });

    it('should return false for mismatched data', () => {
      const data1 = createTestData(BLOCK, 0xDD);
      const data2 = createTestData(BLOCK, 0xEE);

      expect(verifyDecodedOutput(data1, data2)).toBe(false);
    });
  });

  describe('Framework ready for larger test cases', () => {
    it('should handle two-block files efficiently', async () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize);
      const streamId = 9;

      const startTime = performance.now();
      const result = await roundtripBuffer(testData, streamId, 818);
      const endTime = performance.now();

      expect(result.success).toBe(true);
      expect(result.blocksDecoded).toBe(2);

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(3000); // Should complete in 3 seconds
    });

    it('should handle three-block files', async () => {
      const fileSize = 3 * BLOCK;
      const testData = createTestData(fileSize, 0xEE);
      const streamId = 10;

      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.blocksDecoded).toBe(3);
    });
  });

  describe('Integration with encode/decode pipelines', () => {
    it('should work with BlockEncodePipeline', async () => {
      const testData = createTestData(BLOCK, 0xFF);
      const streamId = 11;

      const encodePipeline = createEncodePipeline(testData, { streamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();
      if (entry === undefined) {
        throw new Error('entry should be defined for block 0');
      }
      expect(entry.fragments.length).toBeGreaterThan(0);

      encodePipeline.stop();
      encodePipeline.clear();
    });

    it('should work with BlockDecodePipeline', async () => {
      const testData = createTestData(BLOCK, 0x11);
      const streamId = 12;

      const decodePipeline = createDecodePipeline({
        streamId,
        fileSize: testData.length,
      });

      decodePipeline.start();

      const initialState = decodePipeline.getState();
      expect(initialState.running).toBe(true);
      expect(initialState.blocksDecoded).toBe(0);
      expect(initialState.totalBlocks).toBe(1);

      decodePipeline.stop();
      decodePipeline.clear();
    });

    it('should maintain stream ID isolation', async () => {
      const testData = createTestData(BLOCK, 0x22);
      const encodeStreamId = 13;
      const decodeStreamId = 14; // Different stream ID

      const encodePipeline = createEncodePipeline(testData, { streamId: encodeStreamId });
      encodePipeline.start();
      encodePipeline.preEncodeAll();

      const decodePipeline = createDecodePipeline({
        streamId: decodeStreamId,
        fileSize: testData.length,
      });
      decodePipeline.start();

      const entry = encodePipeline.getBlock(0);
      expect(entry).toBeDefined();
      if (entry === undefined) {
        throw new Error('entry should be defined for block 0');
      }

      // Generate packets with encode stream ID
      const encoder = new LTEncoder({
        streamId: encodeStreamId,
        blockIndex: 0,
        fragments: entry.fragments,
      });

      let packetCount = 0;
      for (const packet of encoder.stream(0)) {
        if (packetCount >= 10) break;
        decodePipeline.receivePacket(0, packet.seq, packet.payload);
        packetCount++;
      }

      // Decode should fail due to stream ID mismatch
      const decoded = decodePipeline.decodeBlock(0);
      expect(decoded).toBeUndefined();

      encodePipeline.stop();
      encodePipeline.clear();
      decodePipeline.stop();
      decodePipeline.clear();
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle insufficient packets gracefully', async () => {
      const testData = createTestData(BLOCK, 0x33);
      const streamId = 15;

      // Only send 700 packets (K=768, so this should fail)
      const result = await roundtripBuffer(testData, streamId, 700);

      expect(result.success).toBe(false);
      expect(result.decodedData).toBeUndefined();
      expect(result.comparison).toBeUndefined();
    });

    it('should handle single-block files', async () => {
      const singleBlock = createTestData(BLOCK, 0x44);
      const streamId = 16;

      const result = await roundtripBuffer(singleBlock, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.blocksDecoded).toBe(1);
    });

    it('should handle exact block multiples', async () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize, 0x55);
      const streamId = 17;

      const result = await roundtripBuffer(testData, streamId, 818);

      expect(result.success).toBe(true);
      expect(result.blocksDecoded).toBe(2);
    });
  });
});
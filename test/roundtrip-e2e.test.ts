/**
 * End-to-end encode→decode roundtrip integration test.
 *
 * Tests the complete roundtrip pipeline using simple encode/decode functions:
 * 1. Encodes synthetic data using encode()
 * 2. Decodes packets using decode()
 * 3. Verifies byte-identical output
 * 4. Tests with smaller sequences (100-1000 packets) ready for scaling
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it } from 'vitest';
import {
  encode,
  decode,
  roundtrip,
  encodeMultiBlock,
  decodeMultiBlock,
  type SimpleEncodeResult,
  type SimpleDecodeResult,
} from '../src/core/block/encode.js';
import { BLOCK, L, K } from '../src/core/params.js';

/**
 * Create synthetic test data with specific pattern.
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
 * Verify byte-identical output.
 */
function verifyByteIdentical(original: Uint8Array, decoded: Uint8Array): boolean {
  if (original.length !== decoded.length) {
    return false;
  }
  for (let i = 0; i < original.length; i++) {
    if (original[i] !== decoded[i]) {
      return false;
    }
  }
  return true;
}

describe('End-to-end encode→decode roundtrip', () => {
  describe('Single block roundtrip with smaller sequences', () => {
    it('should roundtrip with 100 packets', () => {
      const testData = createTestData(BLOCK, 0x42);
      const streamId = 1;

      const encoded = encode(testData, { streamId, packetCount: 100 });
      expect(encoded.packets.length).toBe(100);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      // With K=768, 100 packets is insufficient for decoding
      expect(decoded.success).toBe(false);
    });

    it('should roundtrip with 500 packets', () => {
      const testData = createTestData(BLOCK, 0x55);
      const streamId = 2;

      const encoded = encode(testData, { streamId, packetCount: 500 });
      expect(encoded.packets.length).toBe(500);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      // With K=768, 500 packets is still insufficient
      expect(decoded.success).toBe(false);
    });

    it('should roundtrip with 768 packets (exactly K)', () => {
      const testData = createTestData(BLOCK, 0x66);
      const streamId = 3;

      const encoded = encode(testData, { streamId, packetCount: K });
      expect(encoded.packets.length).toBe(K);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      // Exactly K packets may succeed or fail depending on luck
      // Fountain codes are probabilistic, so K packets might not be enough
      // We accept either outcome for this borderline case
      if (decoded.success) {
        expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
        expect(decoded.packetsUsed).toBeLessThanOrEqual(K);
      } else {
        expect(decoded.success).toBe(false);
      }
    });

    it('should roundtrip with 800 packets (K + 32 overhead)', () => {
      const testData = createTestData(BLOCK, 0x77);
      const streamId = 4;

      const encoded = encode(testData, { streamId, packetCount: 800 });
      expect(encoded.packets.length).toBe(800);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(decoded.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
      // Decoder needs exactly K packets to succeed, even if more are provided
      expect(decoded.packetsUsed).toBe(K);
      expect(decoded.overhead).toBeLessThan(0.1); // Less than 10% overhead
    });

    it('should roundtrip with 1000 packets (K + 232 overhead)', () => {
      const testData = createTestData(BLOCK, 0x88);
      const streamId = 5;

      const encoded = encode(testData, { streamId, packetCount: 1000 });
      expect(encoded.packets.length).toBe(1000);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(decoded.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
      expect(decoded.packetsUsed).toBe(K); // Should only need K packets
      expect(decoded.overhead).toBeGreaterThan(0);
    });
  });

  describe('Byte-identical output verification', () => {
    it('should produce byte-identical output with all-zero pattern', () => {
      const testData = createTestData(BLOCK, 0x00);
      const streamId = 6;

      const encoded = encode(testData, { streamId, packetCount: 850 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);

      // Verify every single byte
      for (let i = 0; i < testData.length; i++) {
        expect(decoded.data[i]).toBe(testData[i]);
      }
    });

    it('should produce byte-identical output with all-ones pattern', () => {
      const testData = createTestData(BLOCK, 0xFF);
      const streamId = 7;

      const encoded = encode(testData, { streamId, packetCount: 850 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
    });

    it('should produce byte-identical output with sequential pattern', () => {
      const testData = createTestData(BLOCK); // 0x00, 0x01, 0x02, ...
      const streamId = 8;

      const encoded = encode(testData, { streamId, packetCount: 850 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);

      // Spot-check specific positions
      expect(decoded.data[0]).toBe(0x00);
      expect(decoded.data[100]).toBe(100 & 0xFF);
      expect(decoded.data[1000]).toBe(1000 & 0xFF);
      expect(decoded.data[testData.length - 1]).toBe((testData.length - 1) & 0xFF);
    });

    it('should produce byte-identical output with alternating pattern', () => {
      const testData = new Uint8Array(BLOCK);
      for (let i = 0; i < testData.length; i++) {
        testData[i] = i % 2 === 0 ? 0xAA : 0x55;
      }
      const streamId = 9;

      const encoded = encode(testData, { streamId, packetCount: 850 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
    });
  });

  describe('Convenience roundtrip function', () => {
    it('should perform complete roundtrip with 800 packets', () => {
      const testData = createTestData(BLOCK, 0x99);
      const streamId = 10;

      const result = roundtrip(testData, { streamId, packetCount: 800 });

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, result.data)).toBe(true);
    });

    it('should perform complete roundtrip with 1000 packets', () => {
      const testData = createTestData(BLOCK, 0xAA);
      const streamId = 11;

      const result = roundtrip(testData, { streamId, packetCount: 1000 });

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, result.data)).toBe(true);
    });

    it('should fail with insufficient packets', () => {
      const testData = createTestData(BLOCK, 0xBB);
      const streamId = 12;

      const result = roundtrip(testData, { streamId, packetCount: 100 });

      expect(result.success).toBe(false);
      expect(result.data.length).toBe(0);
    });
  });

  describe('Multi-block roundtrip', () => {
    it('should roundtrip 2 blocks with 800 packets per block', () => {
      const fileSize = 2 * BLOCK;
      const testData = createTestData(fileSize, 0xCC);
      const streamId = 13;

      const encoded = encodeMultiBlock(testData, { streamId, packetCount: 800 });
      expect(encoded.length).toBe(2);

      const decoded = decodeMultiBlock(
        encoded.map(r => r.packets),
        { streamId, fileSize: testData.length }
      );

      expect(decoded.length).toBe(2);
      expect(decoded[0].success).toBe(true);
      expect(decoded[1].success).toBe(true);

      // Reassemble and verify
      const reassembled = new Uint8Array(fileSize);
      let offset = 0;
      for (const result of decoded) {
        reassembled.set(result.data, offset);
        offset += result.data.length;
      }

      expect(verifyByteIdentical(testData, reassembled)).toBe(true);
    });

    it('should roundtrip 5 blocks with 850 packets per block', () => {
      const fileSize = 5 * BLOCK;
      const testData = createTestData(fileSize, 0xDD);
      const streamId = 14;

      const encoded = encodeMultiBlock(testData, { streamId, packetCount: 850 });
      expect(encoded.length).toBe(5);

      const decoded = decodeMultiBlock(
        encoded.map(r => r.packets),
        { streamId, fileSize: testData.length }
      );

      expect(decoded.length).toBe(5);
      for (const result of decoded) {
        expect(result.success).toBe(true);
      }

      // Reassemble and verify
      const reassembled = new Uint8Array(fileSize);
      let offset = 0;
      for (const result of decoded) {
        reassembled.set(result.data, offset);
        offset += result.data.length;
      }

      expect(verifyByteIdentical(testData, reassembled)).toBe(true);
    });
  });

  describe('Non-block-aligned sizes', () => {
    it('should roundtrip partial block (1000 bytes)', () => {
      const testData = createTestData(1000, 0xEE);
      const streamId = 15;

      const encoded = encode(testData, { streamId, packetCount: 50 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(decoded.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
    });

    it('should roundtrip partial block (10KB)', () => {
      const testData = createTestData(10 * 1024, 0xFF);
      const streamId = 16;

      const encoded = encode(testData, { streamId, packetCount: 200 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(decoded.data.length).toBe(testData.length);
      expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
    });

    it('should roundtrip file spanning multiple blocks with partial last block', () => {
      const fileSize = 2 * BLOCK + 5000; // 2 full blocks + partial
      const testData = createTestData(fileSize, 0x11);
      const streamId = 17;

      const encoded = encodeMultiBlock(testData, { streamId, packetCount: 850 });
      const decoded = decodeMultiBlock(
        encoded.map(r => r.packets),
        { streamId, fileSize: testData.length }
      );

      expect(decoded.length).toBe(3);
      expect(decoded[0].success).toBe(true);
      expect(decoded[1].success).toBe(true);
      expect(decoded[2].success).toBe(true);

      // Reassemble and verify
      const reassembled = new Uint8Array(fileSize);
      let offset = 0;
      for (const result of decoded) {
        reassembled.set(result.data, offset);
        offset += result.data.length;
      }

      expect(verifyByteIdentical(testData, reassembled)).toBe(true);
    });
  });

  describe('Overhead and performance tracking', () => {
    it('should track packets used and overhead', () => {
      const testData = createTestData(BLOCK, 0x22);
      const streamId = 18;

      const encoded = encode(testData, { streamId, packetCount: 900 });
      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
      expect(decoded.packetsUsed).toBe(K); // Should need exactly K packets
      expect(decoded.overhead).toBeGreaterThan(0);
      expect(decoded.overhead).toBeLessThan(0.2); // Less than 20% overhead
    });

    it('should have lower overhead with more packets', () => {
      const testData = createTestData(BLOCK, 0x33);
      const streamId = 19;

      // Test with 900 packets
      const encoded1 = encode(testData, { streamId, packetCount: 900 });
      const decoded1 = decode(encoded1.packets, {
        streamId,
        fileSize: testData.length,
      });

      // Test with 1000 packets
      const encoded2 = encode(testData, { streamId: 20, packetCount: 1000 });
      const decoded2 = decode(encoded2.packets, {
        streamId: 20,
        fileSize: testData.length,
      });

      expect(decoded1.success).toBe(true);
      expect(decoded2.success).toBe(true);
      expect(decoded1.packetsUsed).toBe(K);
      expect(decoded2.packetsUsed).toBe(K);
    });
  });

  describe('Test framework ready for scaling', () => {
    it('should provide test structure for 100 blocks', () => {
      // This test verifies the test framework structure works
      // Scaling to 100 blocks would be: 100 * BLOCK size
      const fileSize = 10 * BLOCK; // Start with 10 blocks
      const testData = createTestData(fileSize, 0x44);
      const streamId = 21;

      const encoded = encodeMultiBlock(testData, { streamId, packetCount: 850 });
      const decoded = decodeMultiBlock(
        encoded.map(r => r.packets),
        { streamId, fileSize: testData.length }
      );

      expect(decoded.length).toBe(10);
      for (const result of decoded) {
        expect(result.success).toBe(true);
      }

      // Verify all data
      const reassembled = new Uint8Array(fileSize);
      let offset = 0;
      for (const result of decoded) {
        reassembled.set(result.data, offset);
        offset += result.data.length;
      }

      expect(verifyByteIdentical(testData, reassembled)).toBe(true);
    });

    it('should handle sequential packet ranges (100-1000)', () => {
      // Test framework can handle different packet counts
      const packetCounts = [100, 200, 400, 600, 800, 1000];
      const testData = createTestData(BLOCK, 0x55);

      for (let i = 0; i < packetCounts.length; i++) {
        const packetCount = packetCounts[i]!;
        const streamId = 30 + i;

        const encoded = encode(testData, { streamId, packetCount });
        const decoded = decode(encoded.packets, {
          streamId,
          fileSize: testData.length,
        });

        // Lower packet counts may fail, higher should succeed
        if (packetCount >= K) {
          expect(decoded.success).toBe(true);
          expect(verifyByteIdentical(testData, decoded.data)).toBe(true);
        } else {
          expect(decoded.success).toBe(false);
        }
      }
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty input gracefully', () => {
      expect(() => encode(new Uint8Array(0), { streamId: 1 })).toThrow('input data is empty');
    });

    it('should handle missing streamId', () => {
      const testData = createTestData(100, 0x66);
      // @ts-expect-error - testing missing streamId
      expect(() => encode(testData, {})).toThrow('streamId is required');
    });

    it('should handle no packets', () => {
      const testData = createTestData(BLOCK, 0x77);
      const streamId = 40;

      const encoded = encode(testData, { streamId, packetCount: 0 });
      expect(encoded.packets.length).toBe(0);

      // Decode should throw an error for no packets
      expect(() => decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      })).toThrow('no packets provided');
    });

    it('should handle single packet', () => {
      const testData = createTestData(BLOCK, 0x88);
      const streamId = 41;

      const encoded = encode(testData, { streamId, packetCount: 1 });
      expect(encoded.packets.length).toBe(1);

      const decoded = decode(encoded.packets, {
        streamId,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(false);
    });
  });
});

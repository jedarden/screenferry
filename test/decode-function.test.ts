/**
 * Test the simple decode function for roundtrip testing.
 *
 * Tests that the decode function correctly reverses the encode function
 * and produces the original data.
 */

import { describe, expect, it } from 'vitest';
import {
  encode,
  decode,
  encodeMultiBlock,
  decodeMultiBlock,
  encodeSingleBlock,
  decodeSingleBlock,
  roundtrip,
  type SimpleEncodeOptions,
  type SimpleDecodeOptions,
} from '../src/core/block/encode.js';
import { BLOCK, L, K } from '../src/core/params.js';

describe('Simple decode function', () => {
  describe('Single block roundtrip', () => {
    it('should decode single block with sufficient packets', () => {
      const testData = new Uint8Array(BLOCK);
      for (let i = 0; i < testData.length; i++) {
        testData[i] = i & 0xff;
      }

      const encodeOptions: SimpleEncodeOptions = {
        streamId: 1,
        packetCount: K + 50, // More than K for reliable decoding
      };

      const encoded = encode(testData, encodeOptions);
      expect(encoded.packets.length).toBe(K + 50);

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 1,
        fileSize: testData.length,
      };

      const decoded = decode(encoded.packets, decodeOptions);

      expect(decoded.success).toBe(true);
      expect(decoded.data.length).toBe(testData.length);
      expect(decoded.packetsUsed).toBeGreaterThan(0);
      expect(decoded.overhead).toBeGreaterThanOrEqual(0);

      // Verify data matches
      for (let i = 0; i < testData.length; i++) {
        expect(decoded.data[i]).toBe(testData[i]);
      }
    });

    it('should handle insufficient packets gracefully', () => {
      const testData = new Uint8Array(BLOCK);
      testData.fill(0x42);

      const encodeOptions: SimpleEncodeOptions = {
        streamId: 2,
        packetCount: K - 10, // Less than K - should fail
      };

      const encoded = encode(testData, encodeOptions);

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 2,
        fileSize: testData.length,
      };

      const decoded = decode(encoded.packets, decodeOptions);

      expect(decoded.success).toBe(false);
      expect(decoded.data.length).toBe(0);
    });
  });

  describe('Multi-block roundtrip', () => {
    it('should encode and decode multiple blocks', () => {
      const fileSize = 3 * BLOCK;
      const testData = new Uint8Array(fileSize);
      for (let i = 0; i < testData.length; i++) {
        testData[i] = (i * 7) & 0xff;
      }

      const encodeOptions: SimpleEncodeOptions = {
        streamId: 3,
        packetCount: K + 50,
      };

      const encoded = encodeMultiBlock(testData, encodeOptions);
      expect(encoded.length).toBe(3);

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 3,
        fileSize: testData.length,
      };

      const decoded = decodeMultiBlock(
        encoded.map((r) => r.packets),
        decodeOptions
      );

      expect(decoded.length).toBe(3);

      // Verify all blocks decoded successfully
      let totalDecodedBytes = 0;
      for (let i = 0; i < decoded.length; i++) {
        expect(decoded[i].success).toBe(true);
        totalDecodedBytes += decoded[i].data.length;

        // Verify block data matches original
        const start = i * BLOCK;
        const end = Math.min(start + BLOCK, testData.length);
        const originalBlock = testData.subarray(start, end);

        for (let j = 0; j < originalBlock.length; j++) {
          expect(decoded[i].data[j]).toBe(originalBlock[j]);
        }
      }

      expect(totalDecodedBytes).toBe(testData.length);
    });
  });

  describe('Single block selective encoding/decoding', () => {
    it('should encode and decode specific block', () => {
      const fileSize = 5 * BLOCK;
      const testData = new Uint8Array(fileSize);
      testData.fill(0x55);

      const blockIndex = 2; // Encode/decode the middle block

      const encodeOptions: SimpleEncodeOptions = {
        streamId: 4,
        packetCount: K + 50,
      };

      const encoded = encodeSingleBlock(testData, blockIndex, encodeOptions);
      expect(encoded.fragmentCount).toBeGreaterThan(0);

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 4,
        fileSize: testData.length,
      };

      const decoded = decodeSingleBlock(encoded.packets, blockIndex, decodeOptions);

      expect(decoded.success).toBe(true);

      // Verify the decoded block matches the original
      const start = blockIndex * BLOCK;
      const end = Math.min(start + BLOCK, testData.length);
      const originalBlock = testData.subarray(start, end);

      expect(decoded.data.length).toBe(originalBlock.length);
      for (let i = 0; i < originalBlock.length; i++) {
        expect(decoded.data[i]).toBe(originalBlock[i]);
      }
    });
  });

  describe('Roundtrip convenience function', () => {
    it('should perform complete encode→decode roundtrip', () => {
      const testData = new Uint8Array(BLOCK);
      for (let i = 0; i < testData.length; i++) {
        testData[i] = (i * 3) & 0xff;
      }

      const encodeOptions: SimpleEncodeOptions = {
        streamId: 5,
        packetCount: K + 100,
      };

      const result = roundtrip(testData, encodeOptions);

      expect(result.success).toBe(true);
      expect(result.data.length).toBe(testData.length);

      // Verify data integrity
      for (let i = 0; i < testData.length; i++) {
        expect(result.data[i]).toBe(testData[i]);
      }
    });

    it('should handle various data patterns', () => {
      const patterns = [
        0x00, // All zeros
        0xff, // All ones
        0x55, // Alternating bits pattern
        0xaa, // Alternating bits pattern (inverse)
      ];

      for (const pattern of patterns) {
        const testData = new Uint8Array(BLOCK);
        testData.fill(pattern);

        const encodeOptions: SimpleEncodeOptions = {
          streamId: 6,
          packetCount: K + 50,
        };

        const result = roundtrip(testData, encodeOptions);

        expect(result.success).toBe(true);
        expect(result.data.length).toBe(testData.length);

        // Verify pattern preserved
        for (let i = 0; i < testData.length; i++) {
          expect(result.data[i]).toBe(pattern);
        }
      }
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle empty packet array', () => {
      const decodeOptions: SimpleDecodeOptions = {
        streamId: 7,
        fileSize: BLOCK,
      };

      expect(() => decode([], decodeOptions)).toThrow('no packets provided');
    });

    it('should require streamId', () => {
      const testData = new Uint8Array(BLOCK);
      const encoded = encode(testData, { streamId: 8, packetCount: K + 50 });

      const decodeOptions: SimpleDecodeOptions = {
        streamId: NaN as unknown as number,
        fileSize: BLOCK,
      };

      expect(() => decode(encoded.packets, decodeOptions)).toThrow('streamId is required');
    });

    it('should require fileSize or geometry', () => {
      const testData = new Uint8Array(BLOCK);
      const encoded = encode(testData, { streamId: 9, packetCount: K + 50 });

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 9,
      };

      expect(() => decode(encoded.packets, decodeOptions)).toThrow(
        'either fileSize or geometry must be provided'
      );
    });

    it('should validate block index range', () => {
      const testData = new Uint8Array(BLOCK);
      const encoded = encode(testData, { streamId: 10, packetCount: K + 50 });

      const decodeOptions: SimpleDecodeOptions = {
        streamId: 10,
        fileSize: BLOCK,
      };

      expect(() => decodeSingleBlock(encoded.packets, 5, decodeOptions)).toThrow(
        'block index 5 out of range'
      );
    });
  });

  describe('Integration with existing code', () => {
    it('should be compatible with BlockEncodePipeline output format', () => {
      // This test verifies the decode function accepts the same packet format
      // that would be produced by the full BlockEncodePipeline
      const testData = new Uint8Array(BLOCK);
      testData.fill(0x77);

      const encoded = encode(testData, { streamId: 11, packetCount: K + 50 });

      // Verify packet format matches expected structure
      expect(encoded.packets[0]).toHaveProperty('seq');
      expect(encoded.packets[0]).toHaveProperty('payload');
      expect(typeof encoded.packets[0].seq).toBe('number');
      expect(encoded.packets[0].payload).toBeInstanceOf(Uint8Array);

      const decoded = decode(encoded.packets, {
        streamId: 11,
        fileSize: testData.length,
      });

      expect(decoded.success).toBe(true);
    });
  });
});

/**
 * Tests for byte-wise comparison logic.
 *
 * Validates the compareBytes and verifyDecodedOutput functions for
 * exact byte array matching with detailed diff reporting.
 *
 * Reference: bf-4o70y
 */

import { describe, expect, it } from 'vitest';
import {
  compareBytes,
  verifyDecodedOutput,
  type ByteComparisonResult,
} from '../src/core/block/data-verification.js';

describe('Byte-wise Comparison', () => {
  describe('compareBytes', () => {
    describe('Basic functionality', () => {
      it('should return true for identical byte arrays', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 2, 3, 4, 5]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(true);
        expect(result.differences).toBe(0);
        expect(result.firstDifferenceIndex).toBe(null);
        expect(result.differenceDetails).toHaveLength(0);
      });

      it('should return false for different byte arrays', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 2, 9, 4, 5]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(1);
        expect(result.firstDifferenceIndex).toBe(2);
        expect(result.differenceDetails).toHaveLength(1);
        expect(result.differenceDetails[0]).toEqual({
          index: 2,
          expected: 3,
          actual: 9,
        });
      });

      it('should detect multiple differences', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([9, 2, 8, 4, 7]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(3);
        expect(result.firstDifferenceIndex).toBe(0);
        expect(result.differenceDetails.length).toBeGreaterThanOrEqual(1);
      });

      it('should return false for any single difference', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 2, 3, 4, 6]); // Last byte different

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(1);
        expect(result.firstDifferenceIndex).toBe(4);
      });

      it('should detect difference at first byte', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([9, 2, 3, 4, 5]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(1);
        expect(result.firstDifferenceIndex).toBe(0);
        expect(result.differenceDetails[0]).toEqual({
          index: 0,
          expected: 1,
          actual: 9,
        });
      });
    });

    describe('Length mismatches', () => {
      it('should detect when actual is shorter', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 2, 3]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(2); // 2 extra bytes in expected
        expect(result.firstDifferenceIndex).toBe(3); // At end of actual
        expect(result.expectedLength).toBe(5);
        expect(result.actualLength).toBe(3);
      });

      it('should detect when actual is longer', () => {
        const expected = new Uint8Array([1, 2, 3]);
        const actual = new Uint8Array([1, 2, 3, 4, 5]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(2); // 2 extra bytes in actual
        expect(result.firstDifferenceIndex).toBe(3); // At end of expected
        expect(result.expectedLength).toBe(3);
        expect(result.actualLength).toBe(5);
      });

      it('should handle empty arrays', () => {
        const expected = new Uint8Array([]);
        const actual = new Uint8Array([]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(true);
        expect(result.differences).toBe(0);
        expect(result.bytesCompared).toBe(0);
      });

      it('should detect empty vs non-empty', () => {
        const expected = new Uint8Array([]);
        const actual = new Uint8Array([1, 2, 3]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(3);
        expect(result.firstDifferenceIndex).toBe(0);
      });

      it('should detect non-empty vs empty', () => {
        const expected = new Uint8Array([1, 2, 3]);
        const actual = new Uint8Array([]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(3);
        expect(result.firstDifferenceIndex).toBe(0);
      });
    });

    describe('Difference details reporting', () => {
      it('should provide clear diff information on mismatch', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 2, 9, 4, 5]);

        const result = compareBytes(expected, actual);

        expect(result.differenceDetails).toHaveLength(1);
        expect(result.differenceDetails[0].index).toBe(2);
        expect(result.differenceDetails[0].expected).toBe(3);
        expect(result.differenceDetails[0].actual).toBe(9);
      });

      it('should limit difference details to 10 entries', () => {
        const expected = new Uint8Array(20);
        const actual = new Uint8Array(20);

        // Create differences at all positions
        for (let i = 0; i < 20; i++) {
          expected[i] = i;
          actual[i] = i + 1;
        }

        const result = compareBytes(expected, actual);

        expect(result.differences).toBe(20);
        expect(result.differenceDetails.length).toBe(10); // Limited to 10
        expect(result.differenceDetails[0].index).toBe(0);
      });

      it('should include all comparison metadata', () => {
        const expected = new Uint8Array([1, 2, 3]);
        const actual = new Uint8Array([1, 2, 3]);

        const result = compareBytes(expected, actual);

        expect(result).toHaveProperty('identical');
        expect(result).toHaveProperty('bytesCompared');
        expect(result).toHaveProperty('differences');
        expect(result).toHaveProperty('firstDifferenceIndex');
        expect(result).toHaveProperty('differenceDetails');
        expect(result).toHaveProperty('expectedLength');
        expect(result).toHaveProperty('actualLength');
      });
    });

    describe('Edge cases', () => {
      it('should handle all zero bytes', () => {
        const expected = new Uint8Array([0, 0, 0, 0, 0]);
        const actual = new Uint8Array([0, 0, 0, 0, 0]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(true);
      });

      it('should handle all maximum byte values', () => {
        const expected = new Uint8Array([255, 255, 255]);
        const actual = new Uint8Array([255, 255, 255]);

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(true);
      });

      it('should detect single bit difference', () => {
        const expected = new Uint8Array([0b00000001]);
        const actual = new Uint8Array([0b00000011]); // One bit different

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(1);
      });

      it('should handle large arrays efficiently', () => {
        const size = 100000;
        const expected = new Uint8Array(size);
        const actual = new Uint8Array(size);

        // Fill with identical pattern
        for (let i = 0; i < size; i++) {
          expected[i] = i & 0xff;
          actual[i] = i & 0xff;
        }

        const start = performance.now();
        const result = compareBytes(expected, actual);
        const duration = performance.now() - start;

        expect(result.identical).toBe(true);
        expect(duration).toBeLessThan(100); // Should complete in < 100ms
      });

      it('should handle large arrays with single difference', () => {
        const size = 100000;
        const expected = new Uint8Array(size);
        const actual = new Uint8Array(size);

        for (let i = 0; i < size; i++) {
          expected[i] = i & 0xff;
          actual[i] = i & 0xff;
        }

        // Introduce single difference near end
        actual[size - 1] = 99;

        const start = performance.now();
        const result = compareBytes(expected, actual);
        const duration = performance.now() - start;

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(1);
        expect(result.firstDifferenceIndex).toBe(size - 1);
        expect(duration).toBeLessThan(100); // Should complete quickly despite finding diff late
      });
    });

    describe('Combined scenarios', () => {
      it('should handle byte differences with length mismatch', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5]);
        const actual = new Uint8Array([1, 9, 3, 4]); // Byte diff + shorter

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(2); // 1 byte diff + 1 length diff
        expect(result.firstDifferenceIndex).toBe(1); // Byte diff found first
      });

      it('should find first difference correctly with multiple issues', () => {
        const expected = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
        const actual = new Uint8Array([1, 9, 3, 10, 5]); // Multiple diffs + shorter

        const result = compareBytes(expected, actual);

        expect(result.identical).toBe(false);
        expect(result.differences).toBe(4); // 2 byte diffs + 2 length diff
        expect(result.firstDifferenceIndex).toBe(1); // First byte diff
      });
    });
  });

  describe('verifyDecodedOutput', () => {
    it('should return true for identical arrays', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const decoded = new Uint8Array([1, 2, 3, 4, 5]);

      const result = verifyDecodedOutput(original, decoded);

      expect(result).toBe(true);
    });

    it('should return false for any difference', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const decoded = new Uint8Array([1, 2, 3, 4, 6]);

      const result = verifyDecodedOutput(original, decoded);

      expect(result).toBe(false);
    });

    it('should return false for length mismatch', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const decoded = new Uint8Array([1, 2, 3]);

      const result = verifyDecodedOutput(original, decoded);

      expect(result).toBe(false);
    });

    it('should handle empty arrays', () => {
      const original = new Uint8Array([]);
      const decoded = new Uint8Array([]);

      const result = verifyDecodedOutput(original, decoded);

      expect(result).toBe(true);
    });

    it('should be simple pass/fail convenience function', () => {
      const original = new Uint8Array([1, 2, 3]);
      const decoded = new Uint8Array([1, 2, 3]);

      // Should return boolean, not object
      const result = verifyDecodedOutput(original, decoded);

      expect(typeof result).toBe('boolean');
      expect(result).toBe(true);
    });
  });

  describe('Integration scenarios', () => {
    it('should verify decoded video frame data', () => {
      // Simulate video frame data
      const originalFrame = new Uint8Array(1920 * 1080 * 3); // RGB frame
      const decodedFrame = new Uint8Array(1920 * 1080 * 3);

      // Fill with test pattern
      for (let i = 0; i < originalFrame.length; i++) {
        originalFrame[i] = i & 0xff;
        decodedFrame[i] = i & 0xff;
      }

      const result = compareBytes(originalFrame, decodedFrame);

      expect(result.identical).toBe(true);
      expect(result.bytesCompared).toBe(1920 * 1080 * 3);
    });

    it('should detect corruption in data stream', () => {
      const original = new Uint8Array(1000);
      const corrupted = new Uint8Array(1000);

      for (let i = 0; i < 1000; i++) {
        original[i] = i & 0xff;
        corrupted[i] = i & 0xff;
      }

      // Introduce corruption at random position
      corrupted[42] = 255;
      corrupted[500] = 0;

      const result = compareBytes(original, corrupted);

      expect(result.identical).toBe(false);
      expect(result.differences).toBe(2);
      expect(result.firstDifferenceIndex).toBe(42);
    });

    it('should validate round-trip encoding/decoding', () => {
      // Simulate encode/decode round-trip
      const original = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);

      // Simulate perfect encoding/decoding
      const encoded = new Uint8Array(original); // Copy
      const decoded = new Uint8Array(encoded);  // Copy

      const result = verifyDecodedOutput(original, decoded);

      expect(result).toBe(true);
    });
  });
});

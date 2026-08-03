/**
 * Tests for block bitmap operations (D22, plan.md §8.3).
 *
 * Verifies:
 * - Bitmap creation and manipulation
 * - Block completion tracking
 * - Serialization/deserialization for resume tokens
 * - Efficient bitmap operations for large block counts
 */

import {describe, it, expect} from 'vitest';
import {
  getBitmapSize,
  createEmptyBitmap,
  createBitmapWithBlocks,
  isBitmapBitSet,
  setBitmapBit,
  clearBitmapBit,
  countSetBits,
  getMissingBlocks,
  getCompleteBlocks,
  isBitmapComplete,
  bitmapAnd,
  bitmapOr,
  bitmapXor,
  bitmapEquals,
  serializeBitmap,
  deserializeBitmap,
  bitmapToString,
  getBitmapProgress,
  validateBitmapSize,
} from '../src/core/block/bitmap.js';

describe('block-bitmap', () => {
  describe('getBitmapSize', () => {
    it('should calculate correct size for small block counts', () => {
      expect(getBitmapSize(1)).toBe(1); // 1 bit -> 1 byte
      expect(getBitmapSize(8)).toBe(1); // 8 bits -> 1 byte
      expect(getBitmapSize(9)).toBe(2); // 9 bits -> 2 bytes
    });

    it('should calculate correct size for large block counts', () => {
      // 4 GB file with 192 KB blocks = 21,845 blocks
      const blockCount = 21845;
      const size = getBitmapSize(blockCount);
      expect(size).toBe(2731); // ceil(21845 / 8) = 2731 bytes (~2.7 KB)
    });

    it('should handle zero blocks', () => {
      expect(getBitmapSize(0)).toBe(0);
    });
  });

  describe('createEmptyBitmap', () => {
    it('should create zero-filled bitmap', () => {
      const bitmap = createEmptyBitmap(100);
      expect(bitmap.length).toBe(getBitmapSize(100));
      // Check all bytes are zero
      for (const byte of bitmap) {
        expect(byte).toBe(0);
      }
    });

    it('should have no bits set', () => {
      const bitmap = createEmptyBitmap(100);
      for (let i = 0; i < 100; i++) {
        expect(isBitmapBitSet(bitmap, i)).toBe(false);
      }
    });
  });

  describe('createBitmapWithBlocks', () => {
    it('should create bitmap with specified blocks set', () => {
      const setBlocks = [0, 5, 10, 50];
      const bitmap = createBitmapWithBlocks(100, setBlocks);

      for (const blockIndex of setBlocks) {
        expect(isBitmapBitSet(bitmap, blockIndex)).toBe(true);
      }

      expect(isBitmapBitSet(bitmap, 1)).toBe(false);
      expect(isBitmapBitSet(bitmap, 20)).toBe(false);
    });

    it('should handle empty setBlocks array', () => {
      const bitmap = createBitmapWithBlocks(100, []);
      expect(countSetBits(bitmap)).toBe(0);
    });

    it('should ignore out-of-range block indices', () => {
      const setBlocks = [-1, 50, 100, 150]; // -1 and 150 are out of range
      const bitmap = createBitmapWithBlocks(100, setBlocks);

      expect(isBitmapBitSet(bitmap, 50)).toBe(true);
      expect(countSetBits(bitmap)).toBe(1); // Only 50 is valid
    });
  });

  describe('setBitmapBit and isBitmapBitSet', () => {
    it('should set individual bits correctly', () => {
      const bitmap = createEmptyBitmap(100);

      setBitmapBit(bitmap, 0);
      expect(isBitmapBitSet(bitmap, 0)).toBe(true);
      expect(isBitmapBitSet(bitmap, 1)).toBe(false);

      setBitmapBit(bitmap, 50);
      expect(isBitmapBitSet(bitmap, 50)).toBe(true);

      setBitmapBit(bitmap, 99);
      expect(isBitmapBitSet(bitmap, 99)).toBe(true);
    });

    it('should set bits across byte boundaries', () => {
      const bitmap = createEmptyBitmap(20);

      // Set bits at byte boundaries
      setBitmapBit(bitmap, 7); // Last bit of byte 0
      setBitmapBit(bitmap, 8); // First bit of byte 1
      setBitmapBit(bitmap, 15); // Last bit of byte 1
      setBitmapBit(bitmap, 16); // First bit of byte 2

      expect(isBitmapBitSet(bitmap, 7)).toBe(true);
      expect(isBitmapBitSet(bitmap, 8)).toBe(true);
      expect(isBitmapBitSet(bitmap, 15)).toBe(true);
      expect(isBitmapBitSet(bitmap, 16)).toBe(true);
    });

    it('should be idempotent', () => {
      const bitmap = createEmptyBitmap(100);

      setBitmapBit(bitmap, 50);
      setBitmapBit(bitmap, 50); // Set again

      expect(isBitmapBitSet(bitmap, 50)).toBe(true);
      expect(countSetBits(bitmap)).toBe(1);
    });
  });

  describe('clearBitmapBit', () => {
    it('should clear individual bits', () => {
      const bitmap = createBitmapWithBlocks(100, [0, 50, 99]);

      clearBitmapBit(bitmap, 50);

      expect(isBitmapBitSet(bitmap, 0)).toBe(true);
      expect(isBitmapBitSet(bitmap, 50)).toBe(false);
      expect(isBitmapBitSet(bitmap, 99)).toBe(true);
    });

    it('should be idempotent', () => {
      const bitmap = createBitmapWithBlocks(100, [50]);

      clearBitmapBit(bitmap, 50);
      clearBitmapBit(bitmap, 50); // Clear again

      expect(isBitmapBitSet(bitmap, 50)).toBe(false);
    });
  });

  describe('countSetBits', () => {
    it('should count zero bits in empty bitmap', () => {
      const bitmap = createEmptyBitmap(100);
      expect(countSetBits(bitmap)).toBe(0);
    });

    it('should count all bits when all set', () => {
      const bitmap = createEmptyBitmap(100);
      for (let i = 0; i < 100; i++) {
        setBitmapBit(bitmap, i);
      }
      expect(countSetBits(bitmap)).toBe(100);
    });

    it('should count specific bits', () => {
      const bitmap = createBitmapWithBlocks(100, [0, 5, 10, 15, 20]);
      expect(countSetBits(bitmap)).toBe(5);
    });

    it('should handle large bitmaps efficiently', () => {
      // Test with 4 GB file size (~21K blocks)
      const blockCount = 21845;
      const bitmap = createEmptyBitmap(blockCount);

      // Set every 10th block
      for (let i = 0; i < blockCount; i += 10) {
        setBitmapBit(bitmap, i);
      }

      const count = countSetBits(bitmap);
      expect(count).toBe(Math.ceil(blockCount / 10));
    });
  });

  describe('getMissingBlocks and getCompleteBlocks', () => {
    it('should return all blocks as missing from empty bitmap', () => {
      const bitmap = createEmptyBitmap(10);
      const missing = getMissingBlocks(bitmap, 10);

      expect(missing).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should return no blocks as complete from empty bitmap', () => {
      const bitmap = createEmptyBitmap(10);
      const complete = getCompleteBlocks(bitmap, 10);

      expect(complete).toEqual([]);
    });

    it('should return correct missing and complete blocks', () => {
      const bitmap = createBitmapWithBlocks(10, [1, 3, 5, 7, 9]);
      const missing = getMissingBlocks(bitmap, 10);
      const complete = getCompleteBlocks(bitmap, 10);

      expect(missing).toEqual([0, 2, 4, 6, 8]);
      expect(complete).toEqual([1, 3, 5, 7, 9]);
    });

    it('should return empty missing array when all complete', () => {
      const bitmap = createBitmapWithBlocks(10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const missing = getMissingBlocks(bitmap);

      expect(missing).toEqual([]);
    });
  });

  describe('isBitmapComplete', () => {
    it('should return false for empty bitmap', () => {
      const bitmap = createEmptyBitmap(10);
      expect(isBitmapComplete(bitmap)).toBe(false);
    });

    it('should return true when all bits set', () => {
      const bitmap = createBitmapWithBlocks(8, [0, 1, 2, 3, 4, 5, 6, 7]);
      expect(isBitmapComplete(bitmap)).toBe(true);
    });

    it('should return false when any bit unset', () => {
      const bitmap = createBitmapWithBlocks(8, [0, 1, 2, 3, 4, 5, 6]); // Missing 7
      expect(isBitmapComplete(bitmap)).toBe(false);
    });

    it('should handle partial byte correctly', () => {
      // 10 bits = 2 bytes, but only 10 bits are valid
      const bitmap = createEmptyBitmap(10);
      for (let i = 0; i < 10; i++) {
        setBitmapBit(bitmap, i);
      }
      expect(isBitmapComplete(bitmap)).toBe(true);

      // Clear one valid bit
      clearBitmapBit(bitmap, 5);
      expect(isBitmapComplete(bitmap)).toBe(false);
    });
  });

  describe('bitmap operations (AND, OR, XOR)', () => {
    let a: Uint8Array;
    let b: Uint8Array;

    beforeEach(() => {
      a = createBitmapWithBlocks(16, [0, 1, 2, 8, 9, 10]);
      b = createBitmapWithBlocks(16, [2, 3, 4, 10, 11, 12]);
    });

    it('should compute AND correctly', () => {
      const result = bitmapAnd(a, b);
      const expected = createBitmapWithBlocks(16, [2, 10]); // Intersection

      expect(bitmapEquals(result, expected)).toBe(true);
    });

    it('should compute OR correctly', () => {
      const result = bitmapOr(a, b);
      const expected = createBitmapWithBlocks(16, [0, 1, 2, 3, 4, 8, 9, 10, 11, 12]); // Union

      expect(bitmapEquals(result, expected)).toBe(true);
    });

    it('should compute XOR correctly', () => {
      const result = bitmapXor(a, b);
      const expected = createBitmapWithBlocks(16, [0, 1, 3, 4, 8, 9, 11, 12]); // Symmetric difference

      expect(bitmapEquals(result, expected)).toBe(true);
    });

    it('should handle empty bitmaps', () => {
      const empty = createEmptyBitmap(16);

      expect(bitmapEquals(bitmapAnd(a, empty), empty)).toBe(true);
      expect(bitmapEquals(bitmapOr(a, empty), a)).toBe(true);
      expect(bitmapEquals(bitmapXor(a, empty), a)).toBe(true);
    });
  });

  describe('bitmapEquals', () => {
    it('should return true for identical bitmaps', () => {
      const a = createBitmapWithBlocks(10, [0, 5, 9]);
      const b = createBitmapWithBlocks(10, [0, 5, 9]);

      expect(bitmapEquals(a, b)).toBe(true);
    });

    it('should return false for different bitmaps', () => {
      const a = createBitmapWithBlocks(10, [0, 5, 9]);
      const b = createBitmapWithBlocks(10, [1, 5, 9]);

      expect(bitmapEquals(a, b)).toBe(false);
    });

    it('should return false for different sizes', () => {
      const a = createEmptyBitmap(10);
      const b = createEmptyBitmap(20);

      expect(bitmapEquals(a, b)).toBe(false);
    });
  });

  describe('serialize and deserialize', () => {
    it('should serialize and deserialize correctly', () => {
      const bitmap = createBitmapWithBlocks(100, [0, 50, 99]);
      const serialized = serializeBitmap(bitmap);
      const deserialized = deserializeBitmap(serialized);

      expect(bitmapEquals(bitmap, deserialized)).toBe(true);
    });

    it('should handle empty bitmap', () => {
      const bitmap = createEmptyBitmap(100);
      const serialized = serializeBitmap(bitmap);
      const deserialized = deserializeBitmap(serialized);

      expect(bitmapEquals(bitmap, deserialized)).toBe(true);
    });

    it('should handle large bitmap', () => {
      const blockCount = 21845; // ~4 GB file
      const bitmap = createEmptyBitmap(blockCount);

      // Set some blocks
      for (let i = 0; i < blockCount; i += 100) {
        setBitmapBit(bitmap, i);
      }

      const serialized = serializeBitmap(bitmap);
      const deserialized = deserializeBitmap(serialized);

      expect(bitmapEquals(bitmap, deserialized)).toBe(true);
    });

    it('should throw on invalid base64', () => {
      expect(() => deserializeBitmap('not-base64!!!')).toThrow();
    });

    it('should produce compact serialization', () => {
      const bitmap = createEmptyBitmap(100);
      const serialized = serializeBitmap(bitmap);

      // Base64 encoding: 100 bytes -> ~133 chars
      expect(serialized.length).toBeLessThan(150);
    });
  });

  describe('bitmapToString', () => {
    it('should convert small bitmap to string', () => {
      const bitmap = createBitmapWithBlocks(10, [0, 5, 9]);
      const str = bitmapToString(bitmap);

      expect(str).toContain('C'); // Complete
      expect(str).toContain('.'); // Incomplete
    });

    it('should respect maxLength', () => {
      const bitmap = createEmptyBitmap(100);
      const str = bitmapToString(bitmap, 20);

      // Should show 20 chars plus '...'
      expect(str.length).toBeLessThanOrEqual(23);
    });

    it('should show all complete for full bitmap', () => {
      const bitmap = createBitmapWithBlocks(8, [0, 1, 2, 3, 4, 5, 6, 7]);
      const str = bitmapToString(bitmap);

      expect(str).toBe('CCCCCCCC');
    });

    it('should show all incomplete for empty bitmap', () => {
      const bitmap = createEmptyBitmap(8);
      const str = bitmapToString(bitmap);

      expect(str).toBe('........');
    });
  });

  describe('getBitmapProgress', () => {
    it('should return 0.0 for empty bitmap', () => {
      const bitmap = createEmptyBitmap(100);
      expect(getBitmapProgress(bitmap)).toBe(0.0);
    });

    it('should return 1.0 for complete bitmap', () => {
      const bitmap = createBitmapWithBlocks(10, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(getBitmapProgress(bitmap)).toBe(1.0);
    });

    it('should return correct progress for partial bitmap', () => {
      const bitmap = createBitmapWithBlocks(100, [0, 1, 2, 3, 4]);
      expect(getBitmapProgress(bitmap)).toBe(0.05);
    });

    it('should handle zero block count', () => {
      const bitmap = createEmptyBitmap(0);
      expect(getBitmapProgress(bitmap)).toBe(1.0); // Edge case
    });
  });

  describe('validateBitmapSize', () => {
    it('should validate correct size', () => {
      const bitmap = createEmptyBitmap(100);
      expect(validateBitmapSize(bitmap, 100)).toBe(true);
    });

    it('should reject incorrect size', () => {
      const bitmap = createEmptyBitmap(100);
      expect(validateBitmapSize(bitmap, 200)).toBe(false);
    });

    it('should handle size 0', () => {
      const bitmap = createEmptyBitmap(0);
      expect(validateBitmapSize(bitmap, 0)).toBe(true);
    });
  });

  describe('D22 resume token scenarios', () => {
    it('should efficiently store 4 GB file bitmap', () => {
      const blockCount = 21845; // 4 GB / 192 KB
      const bitmap = createEmptyBitmap(blockCount);

      // Should be ~2.7 KB as per plan.md §8.3
      expect(bitmap.length).toBe(2731); // ceil(21845 / 8)
      expect(bitmap.length).toBeLessThan(3000); // Under 3 KB
    });

    it('should handle interrupted transfer scenario', () => {
      // Simulate transfer interrupted at 50%
      const blockCount = 100;
      const bitmap = createEmptyBitmap(blockCount);

      // Complete first 50 blocks
      for (let i = 0; i < 50; i++) {
        setBitmapBit(bitmap, i);
      }

      const missing = getMissingBlocks(bitmap);
      const complete = getCompleteBlocks(bitmap);

      expect(missing.length).toBe(50);
      expect(complete.length).toBe(50);
      expect(getBitmapProgress(bitmap)).toBe(0.5);

      // Serialize for resume token
      const serialized = serializeBitmap(bitmap);
      const restored = deserializeBitmap(serialized);

      expect(bitmapEquals(bitmap, restored)).toBe(true);
    });

    it('should handle near-complete transfer', () => {
      // Simulate transfer with only last few blocks missing
      const blockCount = 100;
      const bitmap = createBitmapWithBlocks(
        blockCount,
        Array.from({length: 95}, (_, i) => i)
      );

      const missing = getMissingBlocks(bitmap);

      expect(missing).toEqual([95, 96, 97, 98, 99]);
      expect(getBitmapProgress(bitmap)).toBe(0.95);
    });

    it('should handle scattered block completion (repair scenario)', () => {
      // Simulate blocks collected out of order via repair code
      const blockCount = 100;
      const scatteredBlocks = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
      const bitmap = createBitmapWithBlocks(blockCount, scatteredBlocks);

      const missing = getMissingBlocks(bitmap);
      const complete = getCompleteBlocks(bitmap);

      expect(complete).toEqual(scatteredBlocks);
      expect(missing.length).toBe(90); // 100 - 10
      expect(countSetBits(bitmap)).toBe(10);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle very large block counts efficiently', () => {
      // Test with 10 TB file size (extreme case)
      const blockCount = 52_428_800; // 10 TB / 192 KB
      const startTime = performance.now();

      const bitmap = createEmptyBitmap(blockCount);
      const size = getBitmapSize(blockCount);

      const endTime = performance.now();

      // Should be fast (allocation only)
      expect(endTime - startTime).toBeLessThan(100); // < 100ms

      // Size should be ~6.5 MB for 10 TB
      expect(size).toBe(6_553_600);
    });

    it('should handle single block', () => {
      const bitmap = createEmptyBitmap(1);
      expect(getBitmapSize(1)).toBe(1);

      setBitmapBit(bitmap, 0);
      expect(isBitmapComplete(bitmap)).toBe(true);
      expect(getBitmapProgress(bitmap)).toBe(1.0);
    });

    it('should handle exact byte boundary', () => {
      // 8 blocks = exactly 1 byte
      const bitmap = createEmptyBitmap(8);
      expect(getBitmapSize(8)).toBe(1);

      for (let i = 0; i < 8; i++) {
        setBitmapBit(bitmap, i);
      }

      expect(isBitmapComplete(bitmap)).toBe(true);
    });

    it('should handle just over byte boundary', () => {
      // 9 blocks = 2 bytes (1 bit used in second byte)
      const bitmap = createEmptyBitmap(9);
      expect(getBitmapSize(9)).toBe(2);

      for (let i = 0; i < 9; i++) {
        setBitmapBit(bitmap, i);
      }

      expect(isBitmapComplete(bitmap)).toBe(true);
    });
  });
});

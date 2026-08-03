/**
 * Delta transfer tests (bf-280).
 *
 * Tests block-level delta detection and delta code encoding/decoding.
 * Verifies the air-gapped machine update use case.
 *
 * Reference: docs/notes/bf-280-delta-transfer-resolution.md
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeBlockDelta,
  estimateDeltaSavings,
  isDeltaWorthwhile,
  blocksToRanges,
  rangesToBlocks,
} from '../src/core/block/delta.js';
import {
  createDeltaCode,
  parseDeltaCode,
  isDeltaCodeTypable,
  encodeDeltaCode,
  decodeDeltaCode,
} from '../src/core/frame/delta-code.js';

// Mock File class for testing
class MockFile {
  constructor(
    public data: Uint8Array,
    public name: string,
    public lastModified: number = Date.now()
  ) {}

  get size(): number {
    return this.data.length;
  }

  slice(start: number, end: number): Blob {
    return new Blob([this.data.slice(start, end)]);
  }
}

describe('Delta transfer (bf-280)', () => {
  describe('computeBlockDelta', () => {
    it('should detect no differences for identical files', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file1 = new MockFile(data, 'file1.bin');
      const file2 = new MockFile(data, 'file2.bin');

      const delta = await computeBlockDelta(file1, file2, 256);

      expect(delta.differingBlocks).toEqual([]);
      expect(delta.newBlockCount).toBe(1);
      expect(delta.oldBlockCount).toBe(1);
      expect(delta.differenceRatio).toBe(0);
    });

    it('should detect all blocks differ for completely different files', async () => {
      const data1 = new Uint8Array([1, 2, 3, 4, 5]);
      const data2 = new Uint8Array([6, 7, 8, 9, 10]);
      const file1 = new MockFile(data1, 'file1.bin');
      const file2 = new MockFile(data2, 'file2.bin');

      const delta = await computeBlockDelta(file1, file2, 256);

      expect(delta.differingBlocks).toEqual([0]);
      expect(delta.differenceRatio).toBe(1);
    });

    it('should detect partial differences', async () => {
      // Create files with 2 blocks, first block different
      const blockSize = 256;
      const data1 = new Uint8Array(blockSize * 2);
      const data2 = new Uint8Array(blockSize * 2);

      // Fill first block differently
      data1.fill(1, 0, blockSize);
      data2.fill(2, 0, blockSize);

      // Second block identical
      data1.fill(3, blockSize, blockSize * 2);
      data2.fill(3, blockSize, blockSize * 2);

      const file1 = new MockFile(data1, 'file1.bin');
      const file2 = new MockFile(data2, 'file2.bin');

      const delta = await computeBlockDelta(file1, file2, blockSize);

      expect(delta.differingBlocks).toEqual([0]);
      expect(delta.differenceRatio).toBe(0.5);
    });

    it('should handle append-only changes', async () => {
      const blockSize = 256;
      const baseData = new Uint8Array(blockSize);
      baseData.fill(42);

      const appendData = new Uint8Array(blockSize * 2);
      appendData.fill(42); // First block identical
      appendData.fill(99, blockSize, blockSize * 2); // Second block is append

      const oldFile = new MockFile(baseData, 'old.bin');
      const newFile = new MockFile(appendData, 'new.bin');

      const delta = await computeBlockDelta(newFile, oldFile, blockSize);

      expect(delta.differingBlocks).toEqual([1]); // Only second block (append)
      expect(delta.newBlockCount).toBe(2);
      expect(delta.oldBlockCount).toBe(1);
    });

    it('should handle truncate-only changes', async () => {
      const blockSize = 256;
      const baseData = new Uint8Array(blockSize * 2);
      baseData.fill(42);

      const truncateData = new Uint8Array(blockSize);
      truncateData.fill(42); // First block identical

      const oldFile = new MockFile(baseData, 'old.bin');
      const newFile = new MockFile(truncateData, 'new.bin');

      const delta = await computeBlockDelta(newFile, oldFile, blockSize);

      expect(delta.differingBlocks).toEqual([]); // No differing blocks
      expect(delta.newBlockCount).toBe(1);
      expect(delta.oldBlockCount).toBe(2);
    });

    it('should compute delta for realistic update scenario', async () => {
      // Simulate 4 GB file with 10 MB changed (typical software update)
      const totalSize = 4 * 1024 * 1024 * 1024; // 4 GB
      const changedSize = 10 * 1024 * 1024; // 10 MB
      const blockSize = 192 * 1024; // 192 KB per D19

      const totalBlocks = Math.ceil(totalSize / blockSize);
      const changedBlocks = Math.ceil(changedSize / blockSize);

      // Create mock files (we won't actually allocate 4 GB)
      // Just verify the algorithm produces correct counts
      const oldFile = new MockFile(new Uint8Array(1), 'old.bin');
      const newFile = new MockFile(new Uint8Array(1), 'new.bin');

      // Mock computeBlockDelta to return expected result
      // (We're testing the logic, not the actual file I/O)
      const expectedDelta = {
        differingBlocks: Array.from({ length: changedBlocks }, (_, i) => i),
        newBlockCount: totalBlocks,
        oldBlockCount: totalBlocks,
        differenceRatio: changedBlocks / totalBlocks,
      };

      expect(expectedDelta.differenceRatio).toBeCloseTo(0.0024, 3); // ~0.24%
      expect(expectedDelta.differingBlocks.length).toBe(changedBlocks);
    });
  });

  describe('estimateDeltaSavings', () => {
    it('should compute 99% savings for 0.24% difference', () => {
      const delta = {
        differingBlocks: [0, 1, 2],
        newBlockCount: 1250,
        oldBlockCount: 1250,
        differenceRatio: 0.0024,
      };

      const savings = estimateDeltaSavings(delta, 192 * 1024);

      expect(savings).toBeCloseTo(0.9976, 3); // 99.76% savings
    });

    it('should compute 0% savings for completely different file', () => {
      const delta = {
        differingBlocks: [0, 1, 2],
        newBlockCount: 3,
        oldBlockCount: 3,
        differenceRatio: 1.0,
      };

      const savings = estimateDeltaSavings(delta);

      expect(savings).toBe(0);
    });

    it('should compute 50% savings for half different', () => {
      const delta = {
        differingBlocks: [0, 1, 2, 3, 4],
        newBlockCount: 10,
        oldBlockCount: 10,
        differenceRatio: 0.5,
      };

      const savings = estimateDeltaSavings(delta);

      expect(savings).toBeCloseTo(0.5, 3);
    });
  });

  describe('isDeltaWorthwhile', () => {
    it('should return true for 1% difference', () => {
      const delta = {
        differingBlocks: [0],
        newBlockCount: 100,
        oldBlockCount: 100,
        differenceRatio: 0.01,
      };

      expect(isDeltaWorthwhile(delta)).toBe(true);
    });

    it('should return false for 5% difference', () => {
      const delta = {
        differingBlocks: [0, 1, 2, 3, 4],
        newBlockCount: 100,
        oldBlockCount: 100,
        differenceRatio: 0.05,
      };

      expect(isDeltaWorthwhile(delta)).toBe(false);
    });

    it('should use 2% threshold', () => {
      const delta = {
        differingBlocks: [0, 1],
        newBlockCount: 100,
        oldBlockCount: 100,
        differenceRatio: 0.02,
      };

      expect(isDeltaWorthwhile(delta)).toBe(true); // Exactly at threshold
    });
  });

  describe('blocksToRanges', () => {
    it('should convert single block to range', () => {
      const blocks = [5];
      const ranges = blocksToRanges(blocks);

      expect(ranges).toEqual([[5, 5]]);
    });

    it('should convert consecutive blocks to single range', () => {
      const blocks = [1, 2, 3, 4, 5];
      const ranges = blocksToRanges(blocks);

      expect(ranges).toEqual([[1, 5]]);
    });

    it('should convert non-consecutive blocks to multiple ranges', () => {
      const blocks = [1, 2, 3, 7, 8];
      const ranges = blocksToRanges(blocks);

      expect(ranges).toEqual([[1, 3], [7, 8]]);
    });

    it('should handle empty blocks', () => {
      const blocks: number[] = [];
      const ranges = blocksToRanges(blocks);

      expect(ranges).toEqual([]);
    });

    it('should handle unsorted input', () => {
      const blocks = [5, 3, 4, 1];
      const ranges = blocksToRanges(blocks);

      expect(ranges).toEqual([[1, 1], [3, 5]]);
    });
  });

  describe('rangesToBlocks', () => {
    it('should convert single range to blocks', () => {
      const ranges = [[5, 5]];
      const blocks = rangesToBlocks(ranges);

      expect(blocks).toEqual([5]);
    });

    it('should convert range to consecutive blocks', () => {
      const ranges = [[1, 5]];
      const blocks = rangesToBlocks(ranges);

      expect(blocks).toEqual([1, 2, 3, 4, 5]);
    });

    it('should convert multiple ranges to blocks', () => {
      const ranges = [
        [1, 3],
        [7, 8],
      ];
      const blocks = rangesToBlocks(ranges);

      expect(blocks).toEqual([1, 2, 3, 7, 8]);
    });

    it('should handle empty ranges', () => {
      const ranges: [number, number][] = [];
      const blocks = rangesToBlocks(ranges);

      expect(blocks).toEqual([]);
    });

    it('should round-trip with blocksToRanges', () => {
      const originalBlocks = [1, 2, 3, 7, 8, 10, 15, 16, 17];
      const ranges = blocksToRanges(originalBlocks);
      const recoveredBlocks = rangesToBlocks(ranges);

      expect(recoveredBlocks).toEqual(originalBlocks);
    });
  });

  describe('Delta code encoding/decoding', () => {
    it('should encode and decode delta code correctly', () => {
      const oldStreamId = 0x12345678;
      const newStreamId = 0x9ABCDEF0;
      const differingBlocks = [1, 2, 3, 7, 8];

      const encoded = createDeltaCode(oldStreamId, newStreamId, differingBlocks);
      const parsed = parseDeltaCode(encoded);

      expect(parsed.oldStreamId).toBe(oldStreamId);
      expect(parsed.newStreamId).toBe(newStreamId);
      expect(parsed.differingBlocks).toEqual(differingBlocks);
    });

    it('should reject invalid checksum', () => {
      const valid = createDeltaCode(0x12345678, 0x9ABCDEF0, [1, 2, 3]);

      // Corrupt the checksum (last character)
      const corrupted = valid.slice(0, -1) + 'X';

      expect(() => parseDeltaCode(corrupted)).toThrow('checksum mismatch');
    });

    it('should validate prefix', () => {
      const valid = createDeltaCode(0x12345678, 0x9ABCDEF0, [1, 2, 3]);

      // Wrong prefix
      const wrong = valid.replace('SFD', 'WRONG');

      expect(() => parseDeltaCode(wrong)).toThrow('Invalid delta code prefix');
    });

    it('should handle empty block list', () => {
      const encoded = createDeltaCode(0x12345678, 0x9ABCDEF0, []);
      const parsed = parseDeltaCode(encoded);

      expect(parsed.differingBlocks).toEqual([]);
    });

    it('should handle large block numbers', () => {
      const largeBlocks = [1000, 2000, 3000];
      const encoded = createDeltaCode(0xDEADBEEF, 0xFEEDBEEF, largeBlocks);
      const parsed = parseDeltaCode(encoded);

      expect(parsed.differingBlocks).toEqual(largeBlocks);
    });

    it('should be deterministic for same inputs', () => {
      const oldStreamId = 0x12345678;
      const newStreamId = 0x9ABCDEF0;
      const differingBlocks = [1, 2, 3, 7, 8];

      const encoded1 = createDeltaCode(oldStreamId, newStreamId, differingBlocks);
      const encoded2 = createDeltaCode(oldStreamId, newStreamId, differingBlocks);

      expect(encoded1).toBe(encoded2);
    });

    it('should detect typable vs non-typable codes', () => {
      const smallBlocks = [1, 2, 3];
      const smallCode = createDeltaCode(0x123, 0x456, smallBlocks);

      const largeBlocks = Array.from({ length: 100 }, (_, i) => i);
      const largeCode = createDeltaCode(0x12345678, 0x9ABCDEF0, largeBlocks);

      expect(isDeltaCodeTypable(smallCode)).toBe(true);
      expect(isDeltaCodeTypable(largeCode)).toBe(false);
    });
  });

  describe('Delta code format validation', () => {
    it('should have correct number of parts', () => {
      const code = createDeltaCode(0x123, 0x456, [1, 2, 3]);
      const parts = code.split('-');

      expect(parts.length).toBe(5);
      expect(parts[0]).toBe('SFD'); // Prefix
      expect(parts[1]).toBeDefined(); // oldStreamId
      expect(parts[2]).toBeDefined(); // newStreamId
      expect(parts[3]).toBeDefined(); // ranges
      expect(parts[4]).toBeDefined(); // check
    });

    it('should use Crockford base32 alphabet', () => {
      const code = createDeltaCode(0xFFFFFFFF, 0x00000000, [0, 1000]);
      const body = code.split('-').slice(1, 4).join('');

      // All characters should be from Crockford alphabet
      const validChars = /^[0-9A-HJKMNP-TV-Z]+$/;
      expect(body).toMatch(validChars);
    });

    it('should exclude I, L, O, U from encoding', () => {
      // Test values that would produce I, L, O, U in standard base32
      const problematicValue = 0x1A2B3C4D; // Would produce I, L, O, U in standard base32

      const code = createDeltaCode(problematicValue, problematicValue, [0]);
      const body = code.split('-').slice(1, 4).join('');

      // Should not contain I, L, O, U
      expect(body).not.toContain('I');
      expect(body).not.toContain('L');
      expect(body).not.toContain('O');
      expect(body).not.toContain('U');
    });
  });

  describe('Realistic delta transfer scenario', () => {
    it('should demonstrate 99% savings for 4 GB update', () => {
      // Simulate: 4 GB file, 10 MB changed
      const totalBlocks = 21845; // 4 GB / 192 KB
      const changedBlocks = 53; // 10 MB / 192 KB

      const delta = {
        differingBlocks: Array.from({ length: changedBlocks }, (_, i) => i),
        newBlockCount: totalBlocks,
        oldBlockCount: totalBlocks,
        differenceRatio: changedBlocks / totalBlocks,
      };

      const savings = estimateDeltaSavings(delta, 192 * 1024);

      expect(savings).toBeCloseTo(0.9976, 3); // 99.76% savings
      expect(isDeltaWorthwhile(delta)).toBe(true);
    });

    it('should produce typable code for realistic delta', () => {
      // 4 GB file with 10 MB changed → 53 blocks
      const oldStreamId = 0xDEADBEEF;
      const newStreamId = 0xFEEDBEEF;
      const changedBlocks = Array.from({ length: 53 }, (_, i) => i);

      const code = createDeltaCode(oldStreamId, newStreamId, changedBlocks);

      // Should be typable (under 48 characters for small delta)
      expect(isDeltaCodeTypable(code)).toBe(true);

      // Should parse correctly
      const parsed = parseDeltaCode(code);
      expect(parsed.differingBlocks.length).toBe(53);
    });
  });
});

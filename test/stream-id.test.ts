/**
 * Tests for streamId derivation (plan.md §7.5, D22).
 *
 * Verifies:
 * - Deterministic streamId generation from file metadata and samples
 * - Same file produces same streamId (resume requirement)
 * - Different files produce different streamIds
 * - Small file handling
 * - Sample extraction logic
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {
  computeStreamId,
  computeStreamIdFromBytes,
  computeStreamIdFromSamples,
  validateStreamId,
  STREAM_ID_SAMPLE_SIZE,
} from '../src/core/hash/stream-id.js';

// Mock File object for browser-like testing
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

describe('stream-id', () => {
  describe('computeStreamIdFromSamples', () => {
    it('should compute deterministic streamId from samples', () => {
      const originalSize = 1000;
      const lastModified = 1234567890;
      const firstSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      const middleSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(2);
      const lastSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(3);

      const streamId1 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        firstSample,
        middleSample,
        lastSample
      );
      const streamId2 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        firstSample,
        middleSample,
        lastSample
      );

      expect(streamId1).toBe(streamId2);
      expect(streamId1).toBeGreaterThan(0);
    });

    it('should detect changes in originalSize', () => {
      const lastModified = 1234567890;
      const samples = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);

      const streamId1 = computeStreamIdFromSamples(
        1000,
        lastModified,
        samples,
        samples,
        samples
      );
      const streamId2 = computeStreamIdFromSamples(
        2000, // Different size
        lastModified,
        samples,
        samples,
        samples
      );

      expect(streamId1).not.toBe(streamId2);
    });

    it('should detect changes in lastModified', () => {
      const originalSize = 1000;
      const samples = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);

      const streamId1 = computeStreamIdFromSamples(
        originalSize,
        1234567890,
        samples,
        samples,
        samples
      );
      const streamId2 = computeStreamIdFromSamples(
        originalSize,
        1234567891, // Different mtime
        samples,
        samples,
        samples
      );

      expect(streamId1).not.toBe(streamId2);
    });

    it('should detect changes in firstSample', () => {
      const originalSize = 1000;
      const lastModified = 1234567890;
      const baseSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      const modifiedSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      modifiedSample[0] = 2; // Flip one bit

      const streamId1 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        baseSample,
        baseSample,
        baseSample
      );
      const streamId2 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        modifiedSample, // Changed
        baseSample,
        baseSample
      );

      expect(streamId1).not.toBe(streamId2);
    });

    it('should detect changes in middleSample', () => {
      const originalSize = 1000;
      const lastModified = 1234567890;
      const baseSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      const modifiedSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      modifiedSample[STREAM_ID_SAMPLE_SIZE - 1] = 2; // Flip last bit

      const streamId1 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        baseSample,
        baseSample,
        baseSample
      );
      const streamId2 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        baseSample,
        modifiedSample, // Changed
        baseSample
      );

      expect(streamId1).not.toBe(streamId2);
    });

    it('should detect changes in lastSample', () => {
      const originalSize = 1000;
      const lastModified = 1234567890;
      const baseSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      const modifiedSample = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);
      modifiedSample[10] = 2; // Flip one bit

      const streamId1 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        baseSample,
        baseSample,
        baseSample
      );
      const streamId2 = computeStreamIdFromSamples(
        originalSize,
        lastModified,
        baseSample,
        baseSample,
        modifiedSample // Changed
      );

      expect(streamId1).not.toBe(streamId2);
    });
  });

  describe('computeStreamIdFromBytes', () => {
    it('should compute deterministic streamId for small files', () => {
      const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const lastModified = 1234567890;

      const streamId1 = computeStreamIdFromBytes(fileBytes, lastModified);
      const streamId2 = computeStreamIdFromBytes(fileBytes, lastModified);

      expect(streamId1).toBe(streamId2);
      expect(streamId1).toBeGreaterThan(0);
    });

    it('should throw for zero-byte files', () => {
      const fileBytes = new Uint8Array(0);
      const lastModified = 1234567890;

      expect(() => computeStreamIdFromBytes(fileBytes, lastModified)).toThrow(
        'Cannot compute streamId for zero-byte file (E1)'
      );
    });

    it('should handle small file (< 3 samples)', () => {
      const fileBytes = new Uint8Array(STREAM_ID_SAMPLE_SIZE);
      fileBytes.fill(42);
      const lastModified = 1234567890;

      const streamId = computeStreamIdFromBytes(fileBytes, lastModified);

      // For small files, all three samples are the same (the whole file)
      // So we can verify by constructing the expected streamId
      const expected = computeStreamIdFromSamples(
        fileBytes.length,
        lastModified,
        fileBytes,
        fileBytes,
        fileBytes
      );

      expect(streamId).toBe(expected);
    });

    it('should extract three samples from large files', () => {
      // Create a 1MB file
      const fileSize = 1024 * 1024;
      const fileBytes = new Uint8Array(fileSize);

      // Fill with pattern to distinguish samples
      for (let i = 0; i < fileSize; i++) {
        fileBytes[i] = i % 256;
      }

      const lastModified = 1234567890;
      const streamId = computeStreamIdFromBytes(fileBytes, lastModified);

      // Verify it's deterministic
      const streamId2 = computeStreamIdFromBytes(fileBytes, lastModified);
      expect(streamId).toBe(streamId2);

      // Verify it's different from small file with same first bytes
      const smallFile = fileBytes.slice(0, STREAM_ID_SAMPLE_SIZE * 3);
      const smallStreamId = computeStreamIdFromBytes(smallFile, lastModified);
      expect(streamId).not.toBe(smallStreamId);
    });

    it('should produce same streamId for same file bytes', () => {
      const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const lastModified = 1234567890;

      const streamId1 = computeStreamIdFromBytes(fileBytes, lastModified);
      const streamId2 = computeStreamIdFromBytes(new Uint8Array([1, 2, 3, 4, 5]), lastModified);

      expect(streamId1).toBe(streamId2);
    });
  });

  describe('computeStreamId (File object)', () => {
    it('should compute deterministic streamId from File', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file = new MockFile(data, 'test.bin', 1234567890);

      const streamId1 = await computeStreamId(file);
      const streamId2 = await computeStreamId(file);

      expect(streamId1).toBe(streamId2);
      expect(streamId1).toBeGreaterThan(0);
    });

    it('should throw for zero-byte files', async () => {
      const file = new MockFile(new Uint8Array(0), 'empty.bin', 1234567890);

      await expect(computeStreamId(file)).rejects.toThrow(
        'Cannot compute streamId for zero-byte file (E1)'
      );
    });

    it('should handle files smaller than 3 samples', async () => {
      const smallData = new Uint8Array(STREAM_ID_SAMPLE_SIZE);
      smallData.fill(99);
      const file = new MockFile(smallData, 'small.bin', 1234567890);

      const streamId = await computeStreamId(file);

      // Should match the bytes-based computation
      const expectedStreamId = computeStreamIdFromBytes(smallData, 1234567890);
      expect(streamId).toBe(expectedStreamId);
    });

    it('should sample correctly from large files', async () => {
      const largeData = new Uint8Array(1024 * 1024); // 1 MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }
      const file = new MockFile(largeData, 'large.bin', 1234567890);

      const streamId = await computeStreamId(file);

      // Should be deterministic
      const streamId2 = await computeStreamId(file);
      expect(streamId).toBe(streamId2);

      // Should match bytes-based computation
      const expectedStreamId = computeStreamIdFromBytes(largeData, 1234567890);
      expect(streamId).toBe(expectedStreamId);
    });

    it('should produce different streamIds for different files', async () => {
      const file1 = new MockFile(new Uint8Array([1, 2, 3, 4, 5]), 'file1.bin', 1234567890);
      const file2 = new MockFile(new Uint8Array([1, 2, 3, 4, 6]), 'file2.bin', 1234567890);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      expect(streamId1).not.toBe(streamId2);
    });

    it('should produce different streamIds for same content with different mtime', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file1 = new MockFile(data, 'file1.bin', 1234567890);
      const file2 = new MockFile(data, 'file2.bin', 1234567891);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      expect(streamId1).not.toBe(streamId2);
    });

    it('should produce same streamId for same file re-selected (D22 resume)', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file1 = new MockFile(data, 'test.bin', 1234567890);

      // Simulate user re-selecting the same file
      const file2 = new MockFile(data, 'test.bin', 1234567890);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      expect(streamId1).toBe(streamId2);
    });
  });

  describe('validateStreamId', () => {
    it('should return true for matching streamId', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file = new MockFile(data, 'test.bin', 1234567890);

      const expectedStreamId = await computeStreamId(file);
      const isValid = await validateStreamId(file, expectedStreamId);

      expect(isValid).toBe(true);
    });

    it('should return false for non-matching streamId', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const file = new MockFile(data, 'test.bin', 1234567890);

      const isValid = await validateStreamId(file, 999999); // Wrong streamId

      expect(isValid).toBe(false);
    });

    it('should be used for E18 resume mismatch detection', async () => {
      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      const originalFile = new MockFile(originalData, 'original.bin', 1234567890);
      const originalStreamId = await computeStreamId(originalFile);

      // User no longer has the original file, selects a different one
      const differentData = new Uint8Array([5, 4, 3, 2, 1]);
      const differentFile = new MockFile(differentData, 'different.bin', 1234567890);

      const isValid = await validateStreamId(differentFile, originalStreamId);

      expect(isValid).toBe(false);
    });
  });

  describe('D22 resume requirement', () => {
    it('should guarantee same streamId for same file (resume works)', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const lastModified = 1234567890;

      const file1 = new MockFile(data, 'resume-test.bin', lastModified);
      const file2 = new MockFile(data, 'resume-test.bin', lastModified);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      expect(streamId1).toBe(streamId2);
    });

    it('should guarantee different streamId for different files', async () => {
      const data1 = new Uint8Array([1, 2, 3, 4, 5]);
      const data2 = new Uint8Array([1, 2, 3, 4, 6]);

      const file1 = new MockFile(data1, 'file1.bin', 1234567890);
      const file2 = new MockFile(data2, 'file2.bin', 1234567890);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      expect(streamId1).not.toBe(streamId2);
    });

    it('should handle collision case: middle-only edit with same size/mtime', async () => {
      // This is the "collision" case mentioned in plan.md
      // A file edited ONLY in the middle, keeping size and mtime, collides
      // Mitigated by including lastModified and per-block hashes

      const size = 1024 * 1024; // 1 MB
      const file1Data = new Uint8Array(size);
      const file2Data = new Uint8Array(size);

      // Fill with pattern
      for (let i = 0; i < size; i++) {
        file1Data[i] = i % 256;
        file2Data[i] = i % 256;
      }

      // Edit middle of file2 only
      const middleOffset = size / 2;
      for (let i = 0; i < 100; i++) {
        file2Data[middleOffset + i] = (file2Data[middleOffset + i]! + 1) % 256;
      }

      // Same lastModified (collision scenario)
      const lastModified = 1234567890;

      const file1 = new MockFile(file1Data, 'file1.bin', lastModified);
      const file2 = new MockFile(file2Data, 'file2.bin', lastModified);

      const streamId1 = await computeStreamId(file1);
      const streamId2 = await computeStreamId(file2);

      // StreamIds should differ (middle sample catches it)
      expect(streamId1).not.toBe(streamId2);
    });
  });

  describe('Plan §7.5 normative requirements', () => {
    it('should use originalSize (uncompressed) not compressed size', () => {
      // This test verifies the design requirement: streamId uses originalSize
      // to ensure same file produces same streamId regardless of compression

      const originalSize = 1000;
      const compressedSize = 500; // Different!
      const lastModified = 1234567890;
      const samples = new Uint8Array(STREAM_ID_SAMPLE_SIZE).fill(1);

      const streamId = computeStreamIdFromSamples(
        originalSize, // Uses original size
        lastModified,
        samples,
        samples,
        samples
      );

      // Verify it uses originalSize by testing with different size
      const streamId2 = computeStreamIdFromSamples(
        compressedSize, // Would produce different streamId
        lastModified,
        samples,
        samples,
        samples
      );

      expect(streamId).not.toBe(streamId2);
    });

    it('should NOT be a content-integrity hash', () => {
      // streamId is an identifier, NOT a content-integrity hash
      // It uses samples, not full payload

      const file1 = new Uint8Array(STREAM_ID_SAMPLE_SIZE * 10);
      const file2 = new Uint8Array(STREAM_ID_SAMPLE_SIZE * 10);

      // Same content in sample positions, different elsewhere
      for (let i = 0; i < STREAM_ID_SAMPLE_SIZE; i++) {
        file1[i] = i;
        file2[i] = i;
      }
      // Middle sample same
      const middleOffset = Math.floor((file1.length - STREAM_ID_SAMPLE_SIZE) / 2);
      for (let i = 0; i < STREAM_ID_SAMPLE_SIZE; i++) {
        file1[middleOffset + i] = i;
        file2[middleOffset + i] = i;
      }
      // Last sample same
      for (let i = 0; i < STREAM_ID_SAMPLE_SIZE; i++) {
        file1[file1.length - STREAM_ID_SAMPLE_SIZE + i] = i;
        file2[file2.length - STREAM_ID_SAMPLE_SIZE + i] = i;
      }

      // Different content in non-sampled positions
      file1[middleOffset - 1] = 42;
      file2[middleOffset - 1] = 99;

      const lastModified = 1234567890;
      const streamId1 = computeStreamIdFromBytes(file1, lastModified);
      const streamId2 = computeStreamIdFromBytes(file2, lastModified);

      // Same streamId despite different content (not a content hash)
      expect(streamId1).toBe(streamId2);
    });

    it('should cost ~200 KB reads regardless of file size', async () => {
      // Small file
      const smallFile = new MockFile(
        new Uint8Array(STREAM_ID_SAMPLE_SIZE * 3),
        'small.bin',
        1234567890
      );

      // Large file (10 MB)
      const largeData = new Uint8Array(10 * 1024 * 1024);
      const largeFile = new MockFile(largeData, 'large.bin', 1234567890);

      // Both should complete quickly (not reading entire file)
      const start1 = performance.now();
      await computeStreamId(smallFile);
      const time1 = performance.now() - start1;

      const start2 = performance.now();
      await computeStreamId(largeFile);
      const time2 = performance.now() - start2;

      // Large file should not be significantly slower than small file
      // (both read ~200 KB, not 10 MB)
      expect(time2).toBeLessThan(time1 * 10); // Generous bound
    });
  });
});

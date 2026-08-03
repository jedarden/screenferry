/**
 * Integration test for out-of-order block writes with hash verification.
 *
 * Verifies that:
 * - Blocks arriving out of order write to correct positions
 * - Per-block hashes pass during out-of-order writes
 * - Whole-file hash passes after completion (file not scrambled)
 *
 * This is the verification phase for the fix - proving the system correctly
 * handles out-of-order delivery without scrambling the file.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  createPositionalWriteHandleFactory,
  writeBlock,
  PositionalWriteHandle,
} from '../src/core/io/positional-write.js';
import {
  computeBlockHash,
  computeManifestHash,
  verifyBlockHash,
} from '../src/core/hash/block-hash.js';
import {
  IncrementalHasher,
  validateWholeFileHash,
  compareHashes,
} from '../src/core/hash/whole-file-hash.js';

describe('Out-of-order block writes with hash verification', () => {
  let factory: ReturnType<typeof createPositionalWriteHandleFactory>;
  let testFilePath: string;

  beforeEach(() => {
    factory = createPositionalWriteHandleFactory();
    testFilePath = `test-out-of-order-${Date.now()}.tmp`;
  });

  afterEach(async () => {
    // Cleanup test file
    try {
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;

      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          try {
            currentDir = await currentDir.getDirectoryHandle(part);
          } catch {
            // Directory doesn't exist, skip
          }
        }
      }

      const fileName = pathParts[pathParts.length - 1];
      try {
        await currentDir.removeEntry(fileName);
      } catch {
        // File doesn't exist, skip
      }
    } catch {
      // Cleanup failed, continue
    }
  });

  describe('out-of-order block delivery with hash verification', () => {
    it('should write blocks out of order and verify all hashes pass', async () => {
      // Setup: Create a file with 10 blocks
      const blockCount = 10;
      const blockSize = 192; // 192 bytes per block (small for testing)
      const blockHashLen = 4; // 4-byte truncated SHA-256
      const fileSize = blockCount * blockSize;

      // Create original data with known pattern for verification
      const originalData = new Uint8Array(fileSize);
      for (let i = 0; i < fileSize; i++) {
        originalData[i] = i % 256;
      }

      // Compute original file hash for final verification
      const originalHasher = new IncrementalHasher('SHA-256');
      await originalHasher.update(originalData);
      const originalWholeFileHash = await originalHasher.finalize();

      // Compute block hashes and build manifest
      const manifest = new Uint8Array(blockCount * blockHashLen);
      const blocks: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const blockStart = i * blockSize;
        const blockEnd = blockStart + blockSize;
        const block = originalData.slice(blockStart, blockEnd);
        blocks.push(block);

        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      // Create write handle
      const handle = await factory.createHandle(testFilePath, fileSize);

      // Simulate out-of-order arrival: [2, 0, 4, 1, 3, 6, 5, 8, 7, 9]
      const arrivalOrder = [2, 0, 4, 1, 3, 6, 5, 8, 7, 9];
      const verifiedBlocks: number[] = [];

      // Write blocks in out-of-order sequence, verifying each hash
      for (const blockIndex of arrivalOrder) {
        const block = blocks[blockIndex]!;

        // Verify block hash matches manifest
        const hashValid = await verifyBlockHash(block, blockIndex, manifest, blockHashLen);
        expect(hashValid).toBe(true);
        verifiedBlocks.push(blockIndex);

        // Write block to its correct position
        await writeBlock(handle, block, blockIndex, blockSize);
      }

      // Close write handle
      await handle.close();

      // Read back the file and verify it's not scrambled
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      const reconstructedData = new Uint8Array(content);

      // Verify file layout matches original (not scrambled)
      expect(reconstructedData.length).toBe(originalData.length);
      for (let i = 0; i < originalData.length; i++) {
        expect(reconstructedData[i]).toBe(originalData[i]);
      }

      // Verify whole-file hash matches
      const reconstructedValid = await validateWholeFileHash(
        reconstructedData,
        originalWholeFileHash
      );
      expect(reconstructedValid).toBe(true);

      // Verify all blocks were processed
      expect(verifiedBlocks.length).toBe(blockCount);
      expect(new Set(verifiedBlocks).size).toBe(blockCount); // All unique
    });

    it('should handle extreme out-of-order (reverse order) delivery', async () => {
      const blockCount = 20;
      const blockSize = 128;
      const blockHashLen = 4;
      const fileSize = blockCount * blockSize;

      // Create original data
      const originalData = new Uint8Array(fileSize);
      for (let i = 0; i < fileSize; i++) {
        originalData[i] = (i * 7) % 256; // Different pattern
      }

      // Compute original file hash
      const originalHasher = new IncrementalHasher('SHA-256');
      await originalHasher.update(originalData);
      const originalWholeFileHash = await originalHasher.finalize();

      // Build manifest
      const manifest = new Uint8Array(blockCount * blockHashLen);
      const blocks: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const blockStart = i * blockSize;
        const blockEnd = blockStart + blockSize;
        const block = originalData.slice(blockStart, blockEnd);
        blocks.push(block);

        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      const handle = await factory.createHandle(testFilePath, fileSize);

      // Reverse order delivery: [19, 18, 17, ..., 1, 0]
      for (let i = blockCount - 1; i >= 0; i--) {
        const block = blocks[i]!;

        const hashValid = await verifyBlockHash(block, i, manifest, blockHashLen);
        expect(hashValid).toBe(true);

        await writeBlock(handle, block, i, blockSize);
      }

      await handle.close();

      // Verify reconstruction
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      const reconstructedData = new Uint8Array(content);

      // Verify data integrity
      expect(reconstructedData.length).toBe(originalData.length);
      for (let i = 0; i < originalData.length; i++) {
        expect(reconstructedData[i]).toBe(originalData[i]);
      }

      // Verify whole-file hash
      const isValid = await validateWholeFileHash(
        reconstructedData,
        originalWholeFileHash
      );
      expect(isValid).toBe(true);
    });

    it('should handle random out-of-order delivery', async () => {
      const blockCount = 15;
      const blockSize = 64;
      const blockHashLen = 4;
      const fileSize = blockCount * blockSize;

      // Create original data
      const originalData = new Uint8Array(fileSize);
      for (let i = 0; i < fileSize; i++) {
        originalData[i] = i;
      }

      // Compute hashes
      const originalHasher = new IncrementalHasher('SHA-256');
      await originalHasher.update(originalData);
      const originalWholeFileHash = await originalHasher.finalize();

      // Build manifest and blocks
      const manifest = new Uint8Array(blockCount * blockHashLen);
      const blocks: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const block = originalData.slice(i * blockSize, (i + 1) * blockSize);
        blocks.push(block);

        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      const handle = await factory.createHandle(testFilePath, fileSize);

      // Random shuffle
      const indices = Array.from({length: blockCount}, (_, i) => i);
      // Fisher-Yates shuffle
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j]!, indices[i]!];
      }

      // Process in random order
      for (const blockIndex of indices) {
        const block = blocks[blockIndex]!;

        const hashValid = await verifyBlockHash(block, blockIndex, manifest, blockHashLen);
        expect(hashValid).toBe(true);

        await writeBlock(handle, block, blockIndex, blockSize);
      }

      await handle.close();

      // Verify reconstruction
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      const reconstructedData = new Uint8Array(content);

      expect(reconstructedData).toEqual(originalData);

      const isValid = await validateWholeFileHash(
        reconstructedData,
        originalWholeFileHash
      );
      expect(isValid).toBe(true);
    });

    it('should detect corrupted block during out-of-order delivery', async () => {
      const blockCount = 8;
      const blockSize = 64;
      const blockHashLen = 4;
      const fileSize = blockCount * blockSize;

      // Create original data and manifest
      const originalData = new Uint8Array(fileSize);
      for (let i = 0; i < fileSize; i++) {
        originalData[i] = i;
      }

      const manifest = new Uint8Array(blockCount * blockHashLen);
      const blocks: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const block = originalData.slice(i * blockSize, (i + 1) * blockSize);
        blocks.push(block);

        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      const handle = await factory.createHandle(testFilePath, fileSize);

      // Write blocks 0-2 correctly
      await writeBlock(handle, blocks[0]!, 0, blockSize);
      await writeBlock(handle, blocks[1]!, 1, blockSize);
      await writeBlock(handle, blocks[2]!, 2, blockSize);

      // Corrupt block 3
      const corruptedBlock = new Uint8Array(blocks[3]!);
      corruptedBlock[0] ^= 0xFF; // Flip bits in first byte

      // Verify corrupted block fails
      const hashValid = await verifyBlockHash(corruptedBlock, 3, manifest, blockHashLen);
      expect(hashValid).toBe(false);

      // Verify original block 3 passes
      const originalValid = await verifyBlockHash(blocks[3]!, 3, manifest, blockHashLen);
      expect(originalValid).toBe(true);

      // Write remaining blocks correctly
      for (let i = 4; i < blockCount; i++) {
        await writeBlock(handle, blocks[i]!, i, blockSize);
      }

      await handle.close();

      // Verify file is valid (with corrupted block not written)
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      const data = new Uint8Array(content);

      // Block 3 should be zeros (never written)
      const block3Start = 3 * blockSize;
      for (let i = 0; i < blockSize; i++) {
        expect(data[block3Start + i]).toBe(0);
      }
    });

    it('should handle sparse writes during out-of-order delivery', async () => {
      const blockCount = 10;
      const blockSize = 32;
      const blockHashLen = 4;
      const fileSize = blockCount * blockSize;

      // Create original data
      const originalData = new Uint8Array(fileSize);
      for (let i = 0; i < fileSize; i++) {
        originalData[i] = i % 256;
      }

      // Build manifest
      const manifest = new Uint8Array(blockCount * blockHashLen);
      const blocks: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const block = originalData.slice(i * blockSize, (i + 1) * blockSize);
        blocks.push(block);

        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      const handle = await factory.createHandle(testFilePath, fileSize);

      // Write only blocks 0, 2, 4, 6, 8 (sparse pattern)
      const blocksToWrite = [0, 2, 4, 6, 8];
      for (const blockIndex of blocksToWrite) {
        const block = blocks[blockIndex]!;

        const hashValid = await verifyBlockHash(block, blockIndex, manifest, blockHashLen);
        expect(hashValid).toBe(true);

        await writeBlock(handle, block, blockIndex, blockSize);
      }

      await handle.close();

      // Verify sparse write pattern
      const root = await navigator.storage.getDirectory();
      const pathParts = testFilePath.split('/');
      let currentDir = root;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i];
        if (part) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.arrayBuffer();
      const data = new Uint8Array(content);

      // Written blocks should match original
      for (const blockIndex of blocksToWrite) {
        const blockStart = blockIndex * blockSize;
        const block = originalData.slice(blockStart, blockStart + blockSize);
        const writtenBlock = data.slice(blockStart, blockStart + blockSize);
        expect(writtenBlock).toEqual(block);
      }

      // Unwritten blocks should be zeros
      for (let i = 0; i < blockCount; i++) {
        if (!blocksToWrite.includes(i)) {
          const blockStart = i * blockSize;
          for (let j = 0; j < blockSize; j++) {
            expect(data[blockStart + j]).toBe(0);
          }
        }
      }
    });

    it('should verify hash computation is deterministic', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const blockHashLen = 4;

      const hash1 = await computeBlockHash(block, blockHashLen);
      const hash2 = await computeBlockHash(block, blockHashLen);
      const hash3 = await computeBlockHash(block, blockHashLen);

      expect(hash1).toEqual(hash2);
      expect(hash2).toEqual(hash3);
      expect(hash1).toEqual(hash3);
    });

    it('should verify manifest hash computation is deterministic', () => {
      const manifest = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      const hash1 = computeManifestHash(manifest);
      const hash2 = computeManifestHash(manifest);
      const hash3 = computeManifestHash(manifest);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
      expect(hash1).toBe(hash3);
    });
  });

  describe('incremental whole-file hash computation', () => {
    it('should compute same hash incrementally vs all at once', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      // All at once
      const hasher1 = new IncrementalHasher('SHA-256');
      await hasher1.update(data);
      const hash1 = await hasher1.finalize();

      // Incrementally
      const hasher2 = new IncrementalHasher('SHA-256');
      for (let i = 0; i < data.length; i++) {
        await hasher2.update(new Uint8Array([data[i]!]));
      }
      const hash2 = await hasher2.finalize();

      expect(compareHashes(hash1, hash2)).toBe(true);
    });

    it('should produce different hashes for different data', async () => {
      const hasher1 = new IncrementalHasher('SHA-256');
      await hasher1.update(new Uint8Array([1, 2, 3, 4]));
      const hash1 = await hasher1.finalize();

      const hasher2 = new IncrementalHasher('SHA-256');
      await hasher2.update(new Uint8Array([1, 2, 3, 5]));
      const hash2 = await hasher2.finalize();

      expect(compareHashes(hash1, hash2)).toBe(false);
    });
  });
});

/**
 * Tests for hash verification during out-of-order block writes.
 *
 * Verifies that:
 * 1. Blocks arriving out of order write to correct positions
 * 2. Per-block hashes pass during out-of-order writes
 * 3. Whole-file hash passes after completion (not scrambled)
 *
 * Reference: bf-2aoi
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  PositionalWriteHandle,
  PositionalWriteHandleFactory,
  createPositionalWriteHandleFactory,
} from '../src/core/io/positional-write.js';
import {WritePositionTrackerImpl, writeTrackedBlock, BaseRecvState} from '../src/core/session/types.js';

describe('Out-of-order hash verification', () => {
  let factory: PositionalWriteHandleFactory;
  let testFilePath: string;

  beforeEach(() => {
    factory = createPositionalWriteHandleFactory();
    testFilePath = `test-hash-verify-${Date.now()}.tmp`;
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

  /**
   * Compute SHA-256 hash of data.
   */
  async function sha256(data: Uint8Array): Promise<Uint8Array> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(hashBuffer);
  }

  /**
   * Truncate hash to specified length.
   */
  function truncateHash(hash: Uint8Array, length: number): Uint8Array {
    return hash.subarray(0, length);
  }

  /**
   * Verify a block's hash matches expected.
   */
  async function verifyBlockHash(
    blockData: Uint8Array,
    expectedHash: Uint8Array
  ): Promise<boolean> {
    const actualHash = await sha256(blockData);
    const truncated = truncateHash(actualHash, expectedHash.length);

    if (truncated.length !== expectedHash.length) {
      return false;
    }

    for (let i = 0; i < expectedHash.length; i++) {
      if (truncated[i] !== expectedHash[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Verify whole-file hash matches expected.
   */
  async function verifyWholeFileHash(
    fileData: Uint8Array,
    expectedHash: Uint8Array
  ): Promise<boolean> {
    const actualHash = await sha256(fileData);

    if (actualHash.length !== expectedHash.length) {
      return false;
    }

    for (let i = 0; i < expectedHash.length; i++) {
      if (actualHash[i] !== expectedHash[i]) {
        return false;
      }
    }

    return true;
  }

  describe('out-of-order writes with hash verification', () => {
    it('should write blocks out of order and pass per-block hash checks', async () => {
      const blockSize = 4;
      const blockCount = 4;
      const blockHashLen = 4; // Truncated to 4 bytes for testing

      // Create test data: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
      const blocks: Uint8Array[] = [];
      const blockHashes: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array(blockSize);
        for (let j = 0; j < blockSize; j++) {
          block[j] = i * blockSize + j;
        }
        blocks.push(block);

        // Compute and store expected hash for this block
        const fullHash = await sha256(block);
        blockHashes.push(truncateHash(fullHash, blockHashLen));
      }

      // Write blocks out of order: 2, 0, 3, 1
      const writeOrder = [2, 0, 3, 1];
      const handle = await factory.createHandle(testFilePath, blockCount * blockSize);

      // Create mock state for tracking
      const bitmapBytes = Math.ceil(blockCount / 8);
      const mockState: BaseRecvState = {
        streamId: 1,
        meta: {
          streamId: 1,
          wireVersion: 1,
          fileSize: blockCount * blockSize,
          blockSize,
          blockCount,
          fragmentLen: 100,
          degreeCap: 64,
          flags: 0,
          blockHashLen,
          wholeFileHash: new Uint8Array(32),
          filename: 'test.bin',
          mimeType: 'application/octet-stream',
        },
        complete: new Uint8Array(bitmapBytes),
        writtenBlocks: new Uint8Array(bitmapBytes),
      };

      // Write blocks out of order and verify each hash
      for (const blockIndex of writeOrder) {
        const blockData = blocks[blockIndex];
        const expectedHash = blockHashes[blockIndex];

        // Verify hash before write
        const hashValid = await verifyBlockHash(blockData, expectedHash);
        expect(hashValid).toBe(true);

        // Write the block
        await writeTrackedBlock(mockState, handle, blockData, blockIndex, blockSize);
      }

      await handle.close();

      // Verify file layout is correct by reading back
      const reopened = await factory.reopenHandle(testFilePath);
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

      // Verify correct layout: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
      expect(data[0]).toBe(0);
      expect(data[1]).toBe(1);
      expect(data[2]).toBe(2);
      expect(data[3]).toBe(3);
      expect(data[4]).toBe(4);
      expect(data[5]).toBe(5);
      expect(data[6]).toBe(6);
      expect(data[7]).toBe(7);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(9);
      expect(data[10]).toBe(10);
      expect(data[11]).toBe(11);
      expect(data[12]).toBe(12);
      expect(data[13]).toBe(13);
      expect(data[14]).toBe(14);
      expect(data[15]).toBe(15);

      await reopened.close();
    });

    it('should verify whole-file hash after out-of-order writes', async () => {
      const blockSize = 8;
      const blockCount = 5;

      // Create test data with known pattern
      const blocks: Uint8Array[] = [];
      const allData = new Uint8Array(blockCount * blockSize);

      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array(blockSize);
        for (let j = 0; j < blockSize; j++) {
          const value = (i * blockSize + j) % 256;
          block[j] = value;
          allData[i * blockSize + j] = value;
        }
        blocks.push(block);
      }

      // Compute expected whole-file hash
      const expectedWholeFileHash = await sha256(allData);

      // Write blocks in reverse order
      const handle = await factory.createHandle(testFilePath, blockCount * blockSize);

      const bitmapBytes = Math.ceil(blockCount / 8);
      const mockState: BaseRecvState = {
        streamId: 1,
        meta: {
          streamId: 1,
          wireVersion: 1,
          fileSize: blockCount * blockSize,
          blockSize,
          blockCount,
          fragmentLen: 100,
          degreeCap: 64,
          flags: 0,
          blockHashLen: 4,
          wholeFileHash: expectedWholeFileHash,
          filename: 'test.bin',
          mimeType: 'application/octet-stream',
        },
        complete: new Uint8Array(bitmapBytes),
        writtenBlocks: new Uint8Array(bitmapBytes),
      };

      // Write blocks in reverse order (4, 3, 2, 1, 0)
      for (let i = blockCount - 1; i >= 0; i--) {
        await writeTrackedBlock(mockState, handle, blocks[i], i, blockSize);
      }

      await handle.close();

      // Read back and verify whole-file hash
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

      // Verify whole-file hash matches expected
      const hashValid = await verifyWholeFileHash(data, expectedWholeFileHash);
      expect(hashValid).toBe(true);

      // Also verify the data is not scrambled
      for (let i = 0; i < allData.length; i++) {
        expect(data[i]).toBe(allData[i]);
      }
    });

    it('should handle large block count out-of-order writes', async () => {
      const blockSize = 16;
      const blockCount = 100;

      // Create test data
      const blocks: Uint8Array[] = [];
      const allData = new Uint8Array(blockCount * blockSize);

      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array(blockSize);
        for (let j = 0; j < blockSize; j++) {
          const value = (i * blockSize + j) % 256;
          block[j] = value;
          allData[i * blockSize + j] = value;
        }
        blocks.push(block);
      }

      // Compute expected whole-file hash
      const expectedWholeFileHash = await sha256(allData);

      // Write blocks in random order (for testing, use even-odd pattern)
      const handle = await factory.createHandle(testFilePath, blockCount * blockSize);

      const bitmapBytes = Math.ceil(blockCount / 8);
      const mockState: BaseRecvState = {
        streamId: 1,
        meta: {
          streamId: 1,
          wireVersion: 1,
          fileSize: blockCount * blockSize,
          blockSize,
          blockCount,
          fragmentLen: 100,
          degreeCap: 64,
          flags: 0,
          blockHashLen: 4,
          wholeFileHash: expectedWholeFileHash,
          filename: 'test.bin',
          mimeType: 'application/octet-stream',
        },
        complete: new Uint8Array(bitmapBytes),
        writtenBlocks: new Uint8Array(bitmapBytes),
      };

      // Write even blocks first, then odd blocks (simulates extreme out-of-order)
      for (let i = 0; i < blockCount; i += 2) {
        await writeTrackedBlock(mockState, handle, blocks[i], i, blockSize);
      }
      for (let i = 1; i < blockCount; i += 2) {
        await writeTrackedBlock(mockState, handle, blocks[i], i, blockSize);
      }

      await handle.close();

      // Read back and verify whole-file hash
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

      // Verify whole-file hash matches expected
      const hashValid = await verifyWholeFileHash(data, expectedWholeFileHash);
      expect(hashValid).toBe(true);

      // Spot-check several positions to ensure no scrambling
      const checkPositions = [0, blockSize, 2 * blockSize, blockCount * blockSize - 1];
      for (const pos of checkPositions) {
        expect(data[pos]).toBe(allData[pos]);
      }
    });

    it('should detect corrupted blocks during hash verification', async () => {
      const blockSize = 4;
      const blockCount = 4;
      const blockHashLen = 4;

      // Create test data
      const blocks: Uint8Array[] = [];
      const blockHashes: Uint8Array[] = [];

      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array(blockSize);
        for (let j = 0; j < blockSize; j++) {
          block[j] = i * blockSize + j;
        }
        blocks.push(block);

        const fullHash = await sha256(block);
        blockHashes.push(truncateHash(fullHash, blockHashLen));
      }

      // Corrupt block 1's data
      const corruptedBlock = new Uint8Array(blocks[1]);
      corruptedBlock[0] ^= 0xFF; // Flip all bits in first byte

      // Verify that the corrupted block's hash does NOT match
      const hashValid = await verifyBlockHash(corruptedBlock, blockHashes[1]);
      expect(hashValid).toBe(false);
    });

    it('should detect scrambled whole file with wrong hash', async () => {
      const blockSize = 4;
      const blockCount = 4;

      // Create test data
      const allData = new Uint8Array(blockCount * blockSize);
      for (let i = 0; i < allData.length; i++) {
        allData[i] = i;
      }

      // Create scrambled data (wrong order)
      const scrambledData = new Uint8Array(allData.length);
      for (let i = 0; i < allData.length; i++) {
        scrambledData[i] = allData[allData.length - 1 - i]; // Reverse order
      }

      // Compute hash of correct data
      const correctHash = await sha256(allData);

      // Verify that scrambled data's hash does NOT match correct hash
      const hashValid = await verifyWholeFileHash(scrambledData, correctHash);
      expect(hashValid).toBe(false);
    });
  });

  describe('position tracking during out-of-order writes', () => {
    it('should track write progress correctly with out-of-order writes', async () => {
      const blockSize = 8;
      const blockCount = 10;

      // Create mock state
      const bitmapBytes = Math.ceil(blockCount / 8);
      const mockState: BaseRecvState = {
        streamId: 1,
        meta: {
          streamId: 1,
          wireVersion: 1,
          fileSize: blockCount * blockSize,
          blockSize,
          blockCount,
          fragmentLen: 100,
          degreeCap: 64,
          flags: 0,
          blockHashLen: 4,
          wholeFileHash: new Uint8Array(32),
          filename: 'test.bin',
          mimeType: 'application/octet-stream',
        },
        complete: new Uint8Array(bitmapBytes),
        writtenBlocks: new Uint8Array(bitmapBytes),
      };

      const tracker = new WritePositionTrackerImpl(mockState);
      const handle = await factory.createHandle(testFilePath, blockCount * blockSize);

      // Create test blocks
      const blocks: Uint8Array[] = [];
      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array(blockSize);
        for (let j = 0; j < blockSize; j++) {
          block[j] = i * blockSize + j;
        }
        blocks.push(block);
      }

      // Write blocks out of order
      const writeOrder = [5, 2, 8, 0, 7, 3, 9, 1, 6, 4];

      for (const blockIndex of writeOrder) {
        await writeTrackedBlock(mockState, handle, blocks[blockIndex], blockIndex, blockSize);

        // Update tracker
        tracker.markBlockWritten(blockIndex);

        // Verify block is marked as written
        expect(tracker.isBlockWritten(blockIndex)).toBe(true);
      }

      // Verify all blocks are written
      expect(tracker.isComplete()).toBe(true);
      expect(tracker.blocksWritten).toBe(blockCount);

      await handle.close();
    });

    it('should handle write position advancement correctly', async () => {
      const blockSize = 4;
      const blockCount = 6;

      const bitmapBytes = Math.ceil(blockCount / 8);
      const mockState: BaseRecvState = {
        streamId: 1,
        meta: {
          streamId: 1,
          wireVersion: 1,
          fileSize: blockCount * blockSize,
          blockSize,
          blockCount,
          fragmentLen: 100,
          degreeCap: 64,
          flags: 0,
          blockHashLen: 4,
          wholeFileHash: new Uint8Array(32),
          filename: 'test.bin',
          mimeType: 'application/octet-stream',
        },
        complete: new Uint8Array(bitmapBytes),
        writtenBlocks: new Uint8Array(bitmapBytes),
      };

      const tracker = new WritePositionTrackerImpl(mockState);
      const handle = await factory.createHandle(testFilePath, blockCount * blockSize);

      // Write blocks in order first
      for (let i = 0; i < 3; i++) {
        const block = new Uint8Array(blockSize);
        block.fill(i);
        await writeTrackedBlock(mockState, handle, block, i, blockSize);
        tracker.markBlockWritten(i);
      }

      // Position should be at 3
      expect(tracker.currentPosition).toBe(3);

      // Write block 5 (out of order)
      const block5 = new Uint8Array(blockSize);
      block5.fill(5);
      await writeTrackedBlock(mockState, handle, block5, 5, blockSize);
      tracker.markBlockWritten(5);

      // Position should still be at 3 (block 3 not written yet)
      expect(tracker.currentPosition).toBe(3);

      // Write block 3
      const block3 = new Uint8Array(blockSize);
      block3.fill(3);
      await writeTrackedBlock(mockState, handle, block3, 3, blockSize);
      tracker.markBlockWritten(3);

      // Position should advance to 4
      expect(tracker.currentPosition).toBe(4);

      await handle.close();
    });
  });
});

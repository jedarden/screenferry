/**
 * Tests for positional write interface.
 *
 * Tests write order independence, offset validation, error cases,
 * and resume scenarios.
 *
 * Reference: docs/notes/bf-60mq-positional-write-interface.md
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  PositionalWriteHandle,
  PositionalWriteHandleFactory,
  WriteError,
  createPositionalWriteHandleFactory,
  writeBlock,
} from '../src/core/io/positional-write.js';

describe('PositionalWriteHandle', () => {
  let factory: PositionalWriteHandleFactory;
  let testFilePath: string;

  beforeEach(() => {
    factory = createPositionalWriteHandleFactory();
    testFilePath = `test-${Date.now()}.tmp`;
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

  describe('createHandle', () => {
    it('should create a new handle', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      expect(handle).toBeDefined();
      expect(typeof handle.write).toBe('function');
      expect(typeof handle.close).toBe('function');
      expect(typeof handle.getSize).toBe('function');
    });

    it('should pre-allocate file to expected size', async () => {
      const expectedSize = 1024;
      const handle = await factory.createHandle(testFilePath, expectedSize);

      const size = await handle.getSize();
      expect(size).toBe(expectedSize);

      await handle.close();
    });

    it('should handle nested directory paths', async () => {
      const nestedPath = `test/subdir/${Date.now()}.tmp`;
      const handle = await factory.createHandle(nestedPath, 512);

      expect(handle).toBeDefined();
      await handle.close();
    });
  });

  describe('reopenHandle', () => {
    it('should reopen an existing file', async () => {
      // Create and write initial data
      const handle1 = await factory.createHandle(testFilePath, 1024);
      const data1 = new Uint8Array([1, 2, 3, 4]);
      await handle1.write(data1, { at: 0 });
      await handle1.close();

      // Reopen and verify
      const handle2 = await factory.reopenHandle(testFilePath);
      const size = await handle2.getSize();
      expect(size).toBeGreaterThanOrEqual(4);

      await handle2.close();
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = `nonexistent-${Date.now()}.tmp`;

      await expect(factory.reopenHandle(nonExistentPath)).rejects.toThrow();
    });
  });

  describe('write order independence', () => {
    it('should write blocks out of order and maintain correct file layout', async () => {
      const blockSize = 4;
      const handle = await factory.createHandle(testFilePath, 20);

      // Write blocks out of order: 2, 0, 3, 1
      const block2 = new Uint8Array([8, 9, 10, 11]);
      const block0 = new Uint8Array([0, 1, 2, 3]);
      const block3 = new Uint8Array([12, 13, 14, 15]);
      const block1 = new Uint8Array([4, 5, 6, 7]);

      await handle.write(block2, { at: 2 * blockSize });
      await handle.write(block0, { at: 0 });
      await handle.write(block3, { at: 3 * blockSize });
      await handle.write(block1, { at: 1 * blockSize });

      await handle.close();

      // Verify file layout is correct
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

    it('should handle sparse writes (missing blocks)', async () => {
      const blockSize = 4;
      const handle = await factory.createHandle(testFilePath, 20);

      // Write only blocks 0 and 2, leaving block 1 empty
      const block0 = new Uint8Array([0, 1, 2, 3]);
      const block2 = new Uint8Array([8, 9, 10, 11]);

      await handle.write(block0, { at: 0 });
      await handle.write(block2, { at: 2 * blockSize });

      await handle.close();
    });
  });

  describe('writeBlock helper', () => {
    it('should calculate correct offset and write block', async () => {
      const blockSize = 8;
      const handle = await factory.createHandle(testFilePath, 32);

      const block0 = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      const block3 = new Uint8Array([24, 25, 26, 27, 28, 29, 30, 31]);

      await writeBlock(handle, block0, 0, blockSize);
      await writeBlock(handle, block3, 3, blockSize);

      await handle.close();

      // Verify correct positions
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

      expect(data[0]).toBe(0);
      expect(data[7]).toBe(7);
      expect(data[24]).toBe(24);
      expect(data[31]).toBe(31);

      await reopened.close();
    });
  });

  describe('offset validation', () => {
    it('should reject negative offsets', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      await expect(handle.write(data, { at: -1 })).rejects.toThrow(WriteError);

      await handle.close();
    });

    it('should accept zero offset', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      await expect(handle.write(data, { at: 0 })).resolves.toBe(4);

      await handle.close();
    });

    it('should accept large offsets', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      await expect(handle.write(data, { at: 10000 })).resolves.toBe(4);

      await handle.close();
    });
  });

  describe('error handling', () => {
    it('should throw WriteError for closed handle', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      await handle.close();

      await expect(handle.write(data, { at: 0 })).rejects.toThrow(WriteError);
    });

    it('should throw WriteError with correct code for closed handle', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      await handle.close();

      try {
        await handle.write(data, { at: 0 });
        expect.fail('Should have thrown WriteError');
      } catch (e) {
        expect(e).toBeInstanceOf(WriteError);
        if (e instanceof WriteError) {
          expect(e.code).toBe('HANDLE_CLOSED');
        }
      }
    });

    it('should throw WriteError for invalid offset', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);
      const data = new Uint8Array([1, 2, 3, 4]);

      try {
        await handle.write(data, { at: -1 });
        expect.fail('Should have thrown WriteError');
      } catch (e) {
        expect(e).toBeInstanceOf(WriteError);
        if (e instanceof WriteError) {
          expect(e.code).toBe('INVALID_OFFSET');
          expect(e.context.offset).toBe(-1);
        }
      }

      await handle.close();
    });
  });

  describe('flush', () => {
    it('should provide flush method', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);

      expect(typeof handle.flush).toBe('function');

      const data = new Uint8Array([1, 2, 3, 4]);
      await handle.write(data, { at: 0 });
      await handle.flush?.();

      await handle.close();
    });

    it('should not throw on flush', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);

      const data = new Uint8Array([1, 2, 3, 4]);
      await handle.write(data, { at: 0 });

      await expect(handle.flush?.()).resolves.toBeUndefined();

      await handle.close();
    });
  });

  describe('resume scenario', () => {
    it('should support write after close and reopen', async () => {
      const blockSize = 4;

      // Phase 1: Write initial blocks
      const handle1 = await factory.createHandle(testFilePath, 20);
      await handle1.write(new Uint8Array([0, 1, 2, 3]), { at: 0 });
      await handle1.write(new Uint8Array([4, 5, 6, 7]), { at: 1 * blockSize });
      await handle1.close();

      // Phase 2: Resume (reopen) and write remaining blocks
      const handle2 = await factory.reopenHandle(testFilePath);
      await handle2.write(new Uint8Array([8, 9, 10, 11]), { at: 2 * blockSize });
      await handle2.write(new Uint8Array([12, 13, 14, 15]), { at: 3 * blockSize });
      await handle2.close();

      // Verify all blocks written correctly
      const handle3 = await factory.reopenHandle(testFilePath);
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

      expect(data[0]).toBe(0);
      expect(data[7]).toBe(7);
      expect(data[8]).toBe(8);
      expect(data[15]).toBe(15);

      await handle3.close();
    });
  });

  describe('concurrent write simulation', () => {
    it('should handle multiple writes in sequence', async () => {
      const handle = await factory.createHandle(testFilePath, 1024);

      // Simulate multiple blocks completing simultaneously
      const writes = [
        handle.write(new Uint8Array([0, 1, 2, 3]), { at: 0 }),
        handle.write(new Uint8Array([4, 5, 6, 7]), { at: 4 }),
        handle.write(new Uint8Array([8, 9, 10, 11]), { at: 8 }),
      ];

      await Promise.all(writes);
      await handle.close();
    });
  });
});

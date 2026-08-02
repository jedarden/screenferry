/**
 * Vitest setup file.
 *
 * Mocks browser APIs not available in Node/jsdom environment.
 */

import { beforeEach } from 'vitest';

/**
 * Mock OPFS (Origin Private File System) storage.
 *
 * jsdom doesn't implement navigator.storage.getDirectory(), so we
 * provide a minimal in-memory mock for tests.
 */
class MockFileSystemDirectoryHandle {
  private entries = new Map<string, MockFileSystemDirectoryHandle | MockFileSystemFileHandle>();

  constructor(private _name: string) {}

  get name() {
    return this._name;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockFileSystemDirectoryHandle> {
    const entry = this.entries.get(name);

    if (entry instanceof MockFileSystemDirectoryHandle) {
      return entry;
    }

    if (options?.create) {
      const dir = new MockFileSystemDirectoryHandle(name);
      this.entries.set(name, dir);
      return dir;
    }

    throw new DOMException('Directory not found', 'NotFoundError');
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileSystemFileHandle> {
    const entry = this.entries.get(name);

    if (entry instanceof MockFileSystemFileHandle) {
      return entry;
    }

    if (options?.create) {
      const file = new MockFileSystemFileHandle(name);
      this.entries.set(name, file);
      return file;
    }

    throw new DOMException('File not found', 'NotFoundError');
  }

  async removeEntry(name: string): Promise<void> {
    this.entries.delete(name);
  }

  get kind() {
    return 'directory';
  }
}

class MockFileSystemFileHandle {
  private data = new Uint8Array(0);
  private syncHandle: MockFileSystemSyncAccessHandle | null = null;

  constructor(private _name: string) {}

  get name() {
    return this._name;
  }

  async createWritable(): Promise<MockFileSystemWritableFileStream> {
    return new MockFileSystemWritableFileStream(this);
  }

  async createSyncAccessHandle(): Promise<MockFileSystemSyncAccessHandle> {
    // Return existing handle if already open (reuse pattern)
    if (this.syncHandle) {
      return this.syncHandle;
    }
    this.syncHandle = new MockFileSystemSyncAccessHandle(this);
    return this.syncHandle;
  }

  async getFile(): Promise<{ size: number; arrayBuffer: () => Promise<ArrayBuffer> }> {
    return {
      size: this.data.length,
      arrayBuffer: async () => this.data.buffer.slice(0),
    };
  }

  get kind() {
    return 'file';
  }

  // Internal methods for mock implementation
  _read(offset: number, size: number): Uint8Array {
    return this.data.slice(offset, offset + size);
  }

  _write(offset: number, data: Uint8Array): void {
    // Expand buffer if needed
    if (offset + data.length > this.data.length) {
      const newData = new Uint8Array(offset + data.length);
      newData.set(this.data);
      this.data = newData;
    }
    this.data.set(data, offset);
  }

  _truncate(size: number): void {
    const newData = new Uint8Array(size);
    newData.set(this.data.slice(0, size));
    this.data = newData;
  }

  _closeSyncHandle(): void {
    this.syncHandle = null;
  }
}

class MockFileSystemSyncAccessHandle {
  constructor(private fileHandle: MockFileSystemFileHandle) {}

  write(buffer: Uint8Array, options?: { at?: number }): number {
    const offset = options?.at ?? 0;
    this.fileHandle._write(offset, buffer);
    return buffer.length;
  }

  read(buffer: Uint8Array, options?: { at?: number }): number {
    const offset = options?.at ?? 0;
    const data = this.fileHandle._read(offset, buffer.length);
    buffer.set(data);
    return data.length;
  }

  truncate(size: number): void {
    this.fileHandle._truncate(size);
  }

  flush(): void {
    // No-op for in-memory mock
  }

  close(): void {
    this.fileHandle._closeSyncHandle();
  }

  get getSize(): number {
    return this.fileHandle._read(0, Number.MAX_SAFE_INTEGER).length;
  }
}

class MockFileSystemWritableFileStream {
  private closed = false;
  private offset = 0;

  constructor(private fileHandle: MockFileSystemFileHandle) {}

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new DOMException('Stream closed', 'InvalidStateError');
    }
    this.fileHandle._write(this.offset, data);
    this.offset += data.length;
  }

  async seek(offset: number): Promise<void> {
    if (this.closed) {
      throw new DOMException('Stream closed', 'InvalidStateError');
    }
    this.offset = offset;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

// Set up mock navigator.storage with singleton root
let mockRoot: MockFileSystemDirectoryHandle | null = null;

const mockStorage = {
  getDirectory: async () => {
    if (!mockRoot) {
      mockRoot = new MockFileSystemDirectoryHandle('root');
    }
    return mockRoot;
  },
};

// Extend Navigator interface
declare global {
  interface Navigator {
    storage: typeof mockStorage;
  }
}

beforeEach(() => {
  // Reset OPFS root before each test
  mockRoot = null;
  if (typeof navigator !== 'undefined') {
    (navigator as any).storage = mockStorage;
  }
});

// Polyfill navigator.storage for jsdom
if (typeof navigator !== 'undefined' && !navigator.storage) {
  (navigator as any).storage = mockStorage;
}

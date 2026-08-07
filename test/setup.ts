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
 *
 * This class implements the FileSystemDirectoryHandle interface to ensure
 * type compatibility with production code.
 */
class MockFileSystemDirectoryHandle implements FileSystemDirectoryHandle {
  private _entries = new Map<string, MockFileSystemDirectoryHandle | MockFileSystemFileHandle>();

  constructor(private _name: string) {}

  get name() {
    return this._name;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    const entry = this._entries.get(name);

    if (entry instanceof MockFileSystemDirectoryHandle) {
      return entry as unknown as FileSystemDirectoryHandle;
    }

    if (options?.create) {
      const dir = new MockFileSystemDirectoryHandle(name);
      this._entries.set(name, dir);
      return dir as unknown as FileSystemDirectoryHandle;
    }

    throw new DOMException('Directory not found', 'NotFoundError');
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    let entry = this._entries.get(name);

    if (entry instanceof MockFileSystemFileHandle) {
      return entry as unknown as FileSystemFileHandle;
    }

    if (options?.create) {
      const file = new MockFileSystemFileHandle(name);
      this._entries.set(name, file);
      return file as unknown as FileSystemFileHandle;
    }

    throw new DOMException('File not found', 'NotFoundError');
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    // For this mock, we ignore the recursive option and just delete the entry
    // This matches the behavior needed for the tests
    this._entries.delete(name);
  }

  get kind(): 'directory' {
    return 'directory';
  }

  async isSameEntry(other: FileSystemDirectoryHandle): Promise<boolean> {
    // For mock implementation, check if references are identical
    // Cast this to the interface type for comparison
    if (other === (this as unknown as FileSystemDirectoryHandle)) return true;
    // Type guard to check if other is also a mock
    const mockOther = other as unknown as MockFileSystemDirectoryHandle;
    return mockOther instanceof MockFileSystemDirectoryHandle && mockOther._name === this._name;
  }

  async resolve(descendant: FileSystemDirectoryHandle | FileSystemFileHandle): Promise<string[] | null> {
    // Not implemented for mock - return null to indicate not a descendant
    return null;
  }

  /**
   * Returns an async iterator over directory entries.
   * Matches the File System Access API specification entries() method.
   */
  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const [name, entry] of this._entries) {
      yield [name, entry as unknown as FileSystemHandle];
    }
  }

  /**
   * Returns an async iterator over entry names.
   * Matches the File System Access API specification keys() method.
   */
  async *keys(): AsyncIterableIterator<string> {
    for (const [name] of this._entries) {
      yield name;
    }
  }

  /**
   * Returns an async iterator over entry handles.
   * This is the method used by listOutputs() and scanOrphanedFiles().
   * Matches the File System Access API specification values() method.
   */
  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const [name, entry] of this._entries) {
      yield entry as unknown as FileSystemHandle;
    }
  }

  /**
   * Async iterator implementation for for-await-of loops.
   * Delegates to entries() method.
   */
  async *[Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator<[string, FileSystemHandle]> {
    for await (const entry of this.entries()) {
      yield entry;
    }
  }
}

class MockFileSystemFileHandle implements FileSystemFileHandle {
  private data = new Uint8Array(0);
  private syncHandle: MockFileSystemSyncAccessHandle | null = null;

  constructor(private _name: string) {}

  get name() {
    return this._name;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    return new MockFileSystemWritableFileStream(this) as unknown as FileSystemWritableFileStream;
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    // Return existing handle if already open (reuse pattern)
    if (this.syncHandle) {
      return this.syncHandle as unknown as FileSystemSyncAccessHandle;
    }
    this.syncHandle = new MockFileSystemSyncAccessHandle(this);
    return this.syncHandle as unknown as FileSystemSyncAccessHandle;
  }

  async getFile(): Promise<File> {
    // Create a mock File object with all required methods
    const dataClone = new Uint8Array(this.data);
    const mockFile = {
      name: this._name,
      size: this.data.length,
      type: 'application/octet-stream',
      lastModified: Date.now(),
      async arrayBuffer(): Promise<ArrayBuffer> {
        return dataClone.buffer.slice(0);
      },
      async text(): Promise<string> {
        const decoder = new TextDecoder();
        return decoder.decode(dataClone);
      },
      slice(begin?: number, end?: number): Blob {
        const start = begin ?? 0;
        const stop = end ?? dataClone.length;
        return new Blob([dataClone.slice(start, stop)]);
      },
      stream(): ReadableStream<Uint8Array> {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(dataClone);
            controller.close();
          },
        });
      },
    } as File;

    return mockFile;
  }

  get kind(): 'file' {
    return 'file';
  }

  async isSameEntry(other: FileSystemFileHandle): Promise<boolean> {
    // For mock implementation, check if references are identical
    // Cast this to the interface type for comparison
    if (other === (this as unknown as FileSystemFileHandle)) return true;
    // Type guard to check if other is also a mock
    const mockOther = other as unknown as MockFileSystemFileHandle;
    return mockOther instanceof MockFileSystemFileHandle && mockOther._name === this._name;
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

  async write(data: Uint8Array | string): Promise<void> {
    if (this.closed) {
      throw new DOMException('Stream closed', 'InvalidStateError');
    }
    // Convert string to Uint8Array
    const bytes = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data;
    this.fileHandle._write(this.offset, bytes);
    this.offset += bytes.length;
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
  getDirectory: (): FileSystemDirectoryHandle => {
    if (!mockRoot) {
      mockRoot = new MockFileSystemDirectoryHandle('root');
    }
    return mockRoot;
  },
  async estimate() {
    // Return a mock storage estimate with generous values
    return {
      quota: 1000000000000, // 1 TB
      usage: 0,
    };
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

/**
 * Add ImageData to global scope if not available.
 *
 * jsdom doesn't provide ImageData by default, but it's needed for canvas operations.
 */
if (typeof ImageData === 'undefined') {
  // Create a minimal ImageData implementation
  class PolyfillImageData implements ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(width: number, height: number);
    constructor(data: Uint8ClampedArray, width: number, height: number);
    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight?: number, height?: number) {
      if (typeof dataOrWidth === 'number') {
        // ImageData(width, height) constructor
        this.width = dataOrWidth;
        this.height = widthOrHeight as number;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        // ImageData(data, width, height) constructor
        this.data = dataOrWidth;
        this.width = widthOrHeight as number;
        this.height = height as number;
      }
    }
  }

  (globalThis as any).ImageData = PolyfillImageData;
}

/**
 * Mock HTMLCanvasElement.getContext for jsdom.
 *
 * jsdom doesn't implement canvas 2D context, so we provide a minimal mock
 * that supports the operations needed by the stub-camera tests.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(
    contextType: string,
    _options?: unknown
  ): CanvasRenderingContext2D | null {
    if (contextType === '2d') {
      // Create a mock 2D context if one doesn't exist for this canvas
      if (!(this as any)._mockContext) {
        const GlobalImageData = (globalThis as any).ImageData || ImageData;
        const mockImageData = new GlobalImageData(this.width, this.height);
        let mockImageDataCurrent = mockImageData;

        (this as any)._mockContext = {
          _canvas: this,
          _imageData: mockImageDataCurrent,

          fillStyle: '#000000',
          fillRect(x: number, y: number, w: number, h: number) {
            // Simple mock - just track that fillRect was called
            const imageData = this._imageData;
            const data = imageData.data;

            // Convert fillStyle to RGB (very basic mock)
            let r = 0, g = 0, b = 0;
            if (typeof this.fillStyle === 'string') {
              if (this.fillStyle === '#000000') { r = 0; g = 0; b = 0; }
              else if (this.fillStyle === '#FFFFFF') { r = 255; g = 255; b = 255; }
              else if (this.fillStyle === '#FF0000' || this.fillStyle === 'red') { r = 255; g = 0; b = 0; }
              else if (this.fillStyle === '#0000FF' || this.fillStyle === 'blue') { r = 0; g = 0; b = 255; }
            }

            // Fill pixels (clamp coordinates to canvas bounds)
            const startX = Math.max(0, Math.floor(x));
            const startY = Math.max(0, Math.floor(y));
            const endX = Math.min(imageData.width, Math.floor(x + w));
            const endY = Math.min(imageData.height, Math.floor(y + h));

            for (let py = startY; py < endY; py++) {
              for (let px = startX; px < endX; px++) {
                const idx = (py * imageData.width + px) * 4;
                if (idx >= 0 && idx < data.length - 3) {
                  data[idx] = r;
                  data[idx + 1] = g;
                  data[idx + 2] = b;
                  data[idx + 3] = 255;
                }
              }
            }
          },

          getImageData(x: number, y: number, w: number, h: number): ImageData {
            // Return a copy of the current image data
            const sourceData = this._imageData;
            const result = new ImageData(w, h);

            // Copy pixels from source to result
            for (let py = 0; py < h; py++) {
              for (let px = 0; px < w; px++) {
                const srcX = x + px;
                const srcY = y + py;
                if (srcX >= 0 && srcX < sourceData.width && srcY >= 0 && srcY < sourceData.height) {
                  const srcIdx = (srcY * sourceData.width + srcX) * 4;
                  const dstIdx = (py * w + px) * 4;
                  result.data[dstIdx] = sourceData.data[srcIdx];
                  result.data[dstIdx + 1] = sourceData.data[srcIdx + 1];
                  result.data[dstIdx + 2] = sourceData.data[srcIdx + 2];
                  result.data[dstIdx + 3] = sourceData.data[srcIdx + 3];
                }
              }
            }

            return result;
          },

          putImageData(imageData: ImageData, x: number, y: number): void {
            // Copy pixels from source to current image data
            const destData = this._imageData;
            for (let py = 0; py < imageData.height; py++) {
              for (let px = 0; px < imageData.width; px++) {
                const dstX = x + px;
                const dstY = y + py;
                if (dstX >= 0 && dstX < destData.width && dstY >= 0 && dstY < destData.height) {
                  const srcIdx = (py * imageData.width + px) * 4;
                  const dstIdx = (dstY * destData.width + dstX) * 4;
                  destData.data[dstIdx] = imageData.data[srcIdx];
                  destData.data[dstIdx + 1] = imageData.data[srcIdx + 1];
                  destData.data[dstIdx + 2] = imageData.data[srcIdx + 2];
                  destData.data[dstIdx + 3] = imageData.data[srcIdx + 3];
                }
              }
            }
          }
        };
      }
      return (this as any)._mockContext as CanvasRenderingContext2D;
    }
    // Fall back to original implementation for other context types
    return originalGetContext.call(this, contextType, _options);
  };
}

/**
 * Mock MediaStream and related APIs for jsdom.
 *
 * jsdom doesn't implement mediaDevices or MediaStream, so we provide minimal mocks
 * that support the stub-camera test operations.
 */

// Mock MediaStreamTrack interface
class MockMediaStreamTrack {
  kind: 'video' | 'audio' = 'video';
  id: string;
  enabled = true;
  muted = false;
  _readyState: MediaStreamTrackState = 'live';
  label: string;
  _settings: MediaTrackSettings;
  _capabilities: MediaTrackCapabilities;
  _constraints: MediaTrackConstraints;

  constructor(
    id: string,
    kind: 'video' | 'audio' = 'video',
    settings?: Partial<MediaTrackSettings>
  ) {
    this.id = id;
    this.kind = kind;
    this.label = `Mock Track (${id})`;
    this._settings = {
      width: settings?.width ?? 640,
      height: settings?.height ?? 480,
      frameRate: settings?.frameRate ?? 0,
    };
    this._capabilities = {
      width: { min: 1, max: 3840 },
      height: { min: 1, max: 2160 },
      frameRate: { min: 0, max: 60 },
    };
    this._constraints = {};
  }

  get readyState(): MediaStreamTrackState {
    return this._readyState;
  }

  getSettings(): MediaTrackSettings {
    return this._settings;
  }

  getCapabilities(): MediaTrackCapabilities {
    return this._capabilities;
  }

  getConstraints(): MediaTrackConstraints {
    return this._constraints;
  }

  applyConstraints(): Promise<void> {
    return Promise.resolve();
  }

  stop(): void {
    this._readyState = 'ended';
    this.enabled = false;
  }

  clone(): MediaStreamTrack {
    const cloned = new MockMediaStreamTrack(`${this.id}-clone`, this.kind, this._settings);
    (cloned as any)._readyState = this._readyState;
    return cloned as unknown as MediaStreamTrack;
  }
}

// Mock MediaStream interface
class MockMediaStream implements MediaStream {
  id: string;
  _tracks: MediaStreamTrack[];
  active: boolean;

  constructor(tracks: MediaStreamTrack[] = []) {
    this.id = `mock-stream-${Date.now()}-${Math.random()}`;
    this._tracks = [...tracks];
    this.active = tracks.some((t) => t.readyState === 'live');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this._tracks.filter((t) => t.kind === 'video');
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this._tracks.filter((t) => t.kind === 'audio');
  }

  getTracks(): MediaStreamTrack[] {
    return [...this._tracks];
  }

  getTrackById(id: string): MediaStreamTrack | null {
    return this._tracks.find((t) => t.id === id) ?? null;
  }

  addTrack(track: MediaStreamTrack): void {
    if (!this._tracks.includes(track)) {
      this._tracks.push(track);
      this.active = this._tracks.some((t) => t.readyState === 'live');
    }
  }

  removeTrack(track: MediaStreamTrack): void {
    const index = this._tracks.indexOf(track);
    if (index > -1) {
      this._tracks.splice(index, 1);
      this.active = this._tracks.some((t) => t.readyState === 'live');
    }
  }

  clone(): MediaStream {
    return new MockMediaStream(this._tracks.map((t) => t.clone())) as unknown as MediaStream;
  }

  onaddtrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => unknown) | null = null;
  onremovetrack: ((this: MediaStream, ev: MediaStreamTrackEvent) => unknown) | null = null;
}

// Make MediaStream available globally if it doesn't exist
if (typeof MediaStream === 'undefined') {
  (globalThis as any).MediaStream = MockMediaStream;
}

// Extend navigator with mock mediaDevices if needed
declare global {
  interface Navigator {
    mediaDevices?: MediaDevices;
  }
}

if (typeof navigator !== 'undefined' && !navigator.mediaDevices) {
  // Create a minimal mock mediaDevices
  const mockMediaDevices: Partial<MediaDevices> = {
    getUserMedia: async (_constraints: MediaStreamConstraints): Promise<MediaStream> => {
      // Return a mock stream with a video track
      const mockTrack = new MockMediaStreamTrack(`mock-track-${Date.now()}`, 'video');
      return new MockMediaStream([mockTrack as unknown as MediaStreamTrack]) as unknown as MediaStream;
    },

    enumerateDevices: async () => {
      return [
        {
          kind: 'videoinput',
          deviceId: 'mock-camera',
          label: 'Mock Camera',
          groupId: 'mock-group',
        },
      ];
    },

    getSupportedConstraints: () => ({
      width: true,
      height: true,
      frameRate: true,
    }),
  };

  navigator.mediaDevices = mockMediaDevices as MediaDevices;
}

/**
 * Positional write interface for out-of-order block writes.
 *
 * Mirrors worker-side OPFS createSyncAccessHandle semantics with
 * write(buf, {at}) capability for repair/resume scenarios.
 *
 * Reference: docs/notes/bf-60mq-positional-write-interface.md
 */

/**
 * Write options for positional writes.
 */
export interface WriteOptions {
  /**
   * File offset in bytes where write should begin.
   * Must be non-negative.
   */
  at: number;

  /**
   * Optional flag to truncate file at this position.
   * If true, file is truncated to `at` bytes after write.
   */
  truncate?: boolean;
}

/**
 * Write error with code and context.
 */
export class WriteError extends Error {
  constructor(
    public code: 'QUOTA_EXCEEDED' | 'IO_ERROR' | 'INVALID_OFFSET' | 'HANDLE_CLOSED',
    message: string,
    public context: {
      offset?: number;
      bytesAttempted?: number;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

/**
 * Positional write handle for out-of-order block writes.
 *
 * Mirrors worker-side OPFS createSyncAccessHandle semantics with
 * write(buf, {at}) capability for repair/resume scenarios.
 */
export interface PositionalWriteHandle {
  /**
   * Write data at a specific file offset.
   *
   * @param buffer - Data to write
   * @param options - Write options including position
   * @returns Promise resolving to bytes written
   * @throws WriteError if quota exceeded or I/O error occurs
   */
  write(buffer: Uint8Array, options: WriteOptions): Promise<number>;

  /**
   * Close the handle and flush all writes.
   *
   * @returns Promise resolving when closed
   */
  close(): Promise<void>;

  /**
   * Get current file size.
   *
   * @returns Promise resolving to file size in bytes
   */
  getSize(): Promise<number>;

  /**
   * Flush writes to disk (optional, for checkpointing).
   *
   * @returns Promise resolving when flushed
   */
  flush?: () => Promise<void>;
}

/**
 * Abstraction over different write backends.
 */
interface WriteBackend {
  write(buffer: Uint8Array, offset: number): Promise<number>;
  close(): Promise<void>;
  getSize(): Promise<number>;
}

/**
 * OPFS backend using createSyncAccessHandle (worker context).
 *
 * This is the primary backend for out-of-order writes.
 */
class OPFSWriteBackend implements WriteBackend {
  private fileHandle: FileSystemFileHandle;
  private syncHandle: FileSystemSyncAccessHandle | null = null;
  private closed = false;

  constructor(fileHandle: FileSystemFileHandle) {
    this.fileHandle = fileHandle;
  }

  async write(buffer: Uint8Array, offset: number): Promise<number> {
    if (this.closed) {
      throw new WriteError(
        'HANDLE_CLOSED',
        'Cannot write to closed handle',
        { offset, bytesAttempted: buffer.length }
      );
    }

    if (!this.syncHandle) {
      this.syncHandle = await this.fileHandle.createSyncAccessHandle();
    }

    try {
      // Positional write using sync handle
      this.syncHandle.write(buffer, { at: offset });
      return buffer.length;
    } catch (e) {
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        throw new WriteError(
          'QUOTA_EXCEEDED',
          'Storage quota exceeded',
          { offset, bytesAttempted: buffer.length, cause: e }
        );
      }
      throw new WriteError(
        'IO_ERROR',
        `Write failed: ${e instanceof Error ? e.message : String(e)}`,
        { offset, bytesAttempted: buffer.length, cause: e instanceof Error ? e : undefined }
      );
    }
  }

  async close(): Promise<void> {
    if (this.syncHandle) {
      this.syncHandle.close();
      this.syncHandle = null;
    }
    this.closed = true;
  }

  async getSize(): Promise<number> {
    const file = await this.fileHandle.getFile();
    return file.size;
  }
}

/**
 * Fallback backend using FileSystemWritableFileStream.
 *
 * Used when createSyncAccessHandle is unavailable (main thread).
 * Requires seek() which may not be supported in all browsers.
 */
class StreamWriteBackend implements WriteBackend {
  private writable: FileSystemWritableFileStream | null = null;
  private closed = false;
  private currentOffset = 0;

  async open(fileHandle: FileSystemFileHandle): Promise<void> {
    this.writable = await fileHandle.createWritable();
    this.currentOffset = 0;
  }

  async write(buffer: Uint8Array, offset: number): Promise<number> {
    if (this.closed || !this.writable) {
      throw new WriteError(
        'HANDLE_CLOSED',
        'Cannot write to closed handle',
        { offset, bytesAttempted: buffer.length }
      );
    }

    try {
      // Seek to position (if supported)
      if (offset !== this.currentOffset) {
        await this.writable.seek(offset);
        this.currentOffset = offset;
      }

      // Write data
      await this.writable.write(buffer);
      this.currentOffset += buffer.length;
      return buffer.length;
    } catch (e) {
      throw new WriteError(
        'IO_ERROR',
        `Write failed: ${e instanceof Error ? e.message : String(e)}`,
        { offset, bytesAttempted: buffer.length, cause: e instanceof Error ? e : undefined }
      );
    }
  }

  async close(): Promise<void> {
    if (this.writable) {
      await this.writable.close();
      this.writable = null;
    }
    this.closed = true;
  }

  async getSize(): Promise<number> {
    if (!this.writable) {
      throw new WriteError('HANDLE_CLOSED', 'Handle is closed', {});
    }
    // Note: WritableStream doesn't expose size directly
    // This may need alternative implementation
    throw new WriteError('IO_ERROR', 'getSize() not supported on Stream backend', {});
  }
}

/**
 * Factory for creating positional write handles.
 */
export interface PositionalWriteHandleFactory {
  /**
   * Create a new positional write handle for a file.
   *
   * @param filePath - Virtual path within OPFS
   * @param expectedSize - Expected final file size (for pre-allocation)
   * @returns Promise resolving to write handle
   */
  createHandle(
    filePath: string,
    expectedSize: number
  ): Promise<PositionalWriteHandle>;

  /**
   * Reopen an existing file for positional writes.
   *
   * Used during resume to re-establish handle to partial output.
   *
   * @param filePath - Virtual path within OPFS
   * @returns Promise resolving to write handle
   */
  reopenHandle(
    filePath: string
  ): Promise<PositionalWriteHandle>;
}

/**
 * OPFS-based positional write handle implementation.
 */
class OPFSPositionalWriteHandle implements PositionalWriteHandle {
  private backend: OPFSWriteBackend;

  constructor(backend: OPFSWriteBackend) {
    this.backend = backend;
  }

  async write(buffer: Uint8Array, options: WriteOptions): Promise<number> {
    if (options.at < 0) {
      throw new WriteError(
        'INVALID_OFFSET',
        `Offset must be non-negative, got ${options.at}`,
        { offset: options.at, bytesAttempted: buffer.length }
      );
    }
    return this.backend.write(buffer, options.at);
  }

  async close(): Promise<void> {
    return this.backend.close();
  }

  async getSize(): Promise<number> {
    return this.backend.getSize();
  }

  async flush(): Promise<void> {
    // OPFS sync handle flushes on write; explicit flush is a no-op
    // but provided for interface compatibility
  }
}

/**
 * Factory implementation for creating positional write handles.
 */
class PositionalWriteHandleFactoryImpl implements PositionalWriteHandleFactory {
  private opfsRoot: FileSystemDirectoryHandle | null = null;

  private async getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsRoot) {
      this.opfsRoot = await navigator.storage.getDirectory();
    }
    return this.opfsRoot;
  }

  async createHandle(
    filePath: string,
    expectedSize: number
  ): Promise<PositionalWriteHandle> {
    const root = await this.getOPFSRoot();

    // Parse path and create nested directories if needed
    const pathParts = filePath.split('/');
    let currentDir = root;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (part) {
        currentDir = await currentDir.getDirectoryHandle(part, { create: true });
      }
    }

    const fileName = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });

    // Pre-allocate file if supported (truncate to expected size)
    try {
      const syncHandle = await fileHandle.createSyncAccessHandle();
      syncHandle.truncate(expectedSize);
      syncHandle.close();
    } catch {
      // Pre-allocation not supported, continue without it
    }

    const backend = new OPFSWriteBackend(fileHandle);
    return new OPFSPositionalWriteHandle(backend);
  }

  async reopenHandle(filePath: string): Promise<PositionalWriteHandle> {
    const root = await this.getOPFSRoot();

    // Parse path and navigate to file
    const pathParts = filePath.split('/');
    let currentDir = root;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (part) {
        currentDir = await currentDir.getDirectoryHandle(part);
      }
    }

    const fileName = pathParts[pathParts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: false });

    const backend = new OPFSWriteBackend(fileHandle);
    return new OPFSPositionalWriteHandle(backend);
  }
}

/**
 * Create a new positional write handle factory.
 *
 * @returns Factory instance for creating handles
 */
export function createPositionalWriteHandleFactory(): PositionalWriteHandleFactory {
  return new PositionalWriteHandleFactoryImpl();
}

/**
 * Write a decoded block to its correct position.
 *
 * Helper function for writing blocks in correct position regardless of arrival order.
 *
 * @param handle - Positional write handle
 * @param blockData - Decoded block data
 * @param blockIndex - Block index (determines offset)
 * @param blockSize - Block size from beacon
 * @throws WriteError if write fails
 */
export async function writeBlock(
  handle: PositionalWriteHandle,
  blockData: Uint8Array,
  blockIndex: number,
  blockSize: number
): Promise<void> {
  const offset = blockIndex * blockSize;

  // Write at specific offset - order independent!
  await handle.write(blockData, { at: offset });
}

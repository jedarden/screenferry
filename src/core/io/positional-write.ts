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
   * Read data from a specific file offset.
   *
   * @param offset - File offset in bytes where read should begin
   * @param length - Number of bytes to read
   * @returns Promise resolving to bytes read
   * @throws WriteError if I/O error occurs
   */
  read(offset: number, length: number): Promise<Uint8Array>;

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
  read(offset: number, length: number): Promise<Uint8Array>;
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
        e instanceof Error
          ? { offset, bytesAttempted: buffer.length, cause: e }
          : { offset, bytesAttempted: buffer.length }
      );
    }
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.closed) {
      throw new WriteError(
        'HANDLE_CLOSED',
        'Cannot read from closed handle',
        { offset, bytesAttempted: length }
      );
    }

    if (!this.syncHandle) {
      this.syncHandle = await this.fileHandle.createSyncAccessHandle();
    }

    try {
      const buffer = new Uint8Array(length);
      const bytesRead = this.syncHandle.read(buffer, { at: offset });
      return buffer.subarray(0, bytesRead);
    } catch (e) {
      throw new WriteError(
        'IO_ERROR',
        `Read failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error
          ? { offset, bytesAttempted: length, cause: e }
          : { offset, bytesAttempted: length }
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

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (offset < 0) {
      throw new WriteError(
        'INVALID_OFFSET',
        `Offset must be non-negative, got ${offset}`,
        { offset, bytesAttempted: length }
      );
    }
    return this.backend.read(offset, length);
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
  private opfsRoot!: FileSystemDirectoryHandle;

  private async getOPFSRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.opfsRoot) {
      const root = await navigator.storage.getDirectory();
      if (!root) {
        throw new WriteError('IO_ERROR', 'OPFS not available', {});
      }
      // Type assertion via unknown to handle both production (real FileSystemDirectoryHandle)
      // and test environments (MockFileSystemDirectoryHandle)
      this.opfsRoot = root as unknown as FileSystemDirectoryHandle;
    }
    return this.opfsRoot;
  }

  async createHandle(
    filePath: string,
    expectedSize: number
  ): Promise<PositionalWriteHandle> {
    const root = await this.getOPFSRoot();

    // Parse path and create nested directories if needed
    const pathParts = filePath.split('/').filter(Boolean);
    let currentDir = root;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (part) {
        currentDir = await currentDir.getDirectoryHandle(part, { create: true });
      }
    }

    const fileName = pathParts[pathParts.length - 1];
    if (!fileName) {
      throw new WriteError('INVALID_OFFSET', 'Invalid file path', { offset: 0 });
    }
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
    const pathParts = filePath.split('/').filter(Boolean);
    let currentDir = root;

    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (part) {
        currentDir = await currentDir.getDirectoryHandle(part);
      }
    }

    const fileName = pathParts[pathParts.length - 1];
    if (!fileName) {
      throw new WriteError('INVALID_OFFSET', 'Invalid file path', { offset: 0 });
    }
    const fileHandle = await currentDir.getFileHandle(fileName);

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

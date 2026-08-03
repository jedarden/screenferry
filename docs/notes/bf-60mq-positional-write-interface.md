# Positional Write Interface Design (bf-60mq)

## Overview

Design a positional write interface that mirrors the worker-side OPFS `createSyncAccessHandle` API, enabling out-of-order block writes without buffering. This is critical for repair/resume scenarios where blocks arrive out of sequence.

## Requirements

### Functional Requirements

1. **Positional writes**: `write(buf, {at})` method that writes to specific file offsets
2. **Order independence**: Writes must not depend on arrival order
3. **No buffering**: Interface should not require in-memory buffering of blocks
4. **OPFS compatibility**: Must work with worker-side `createSyncAccessHandle` semantics
5. **Type safety**: TypeScript interfaces with clear type definitions

### Non-Functional Requirements

1. **Performance**: Minimal overhead for write operations
2. **Error handling**: Graceful handling of write failures, quota exhaustion
3. **State compatibility**: Must integrate with existing receiver session states

## API Design

### Core Interface

```typescript
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
```

### Factory Interface

```typescript
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
```

## Implementation Architecture

### Layer 1: Abstraction Layer

```typescript
/**
 * Abstraction over different write backends.
 */
interface WriteBackend {
  write(buffer: Uint8Array, offset: number): Promise<number>;
  close(): Promise<void>;
  getSize(): Promise<number>;
}
```

### Layer 2: OPFS Backend (Primary)

```typescript
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
```

### Layer 2: FileSystemWritableFileStream Backend (Fallback)

```typescript
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
    throw new Error('getSize() not supported on Stream backend');
  }
}
```

## Integration with Receiver States

### Modified ReceivingState

```typescript
export interface ReceivingState extends BaseRecvState {
  type: 'receiving';
  active: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
    consecutiveHigher: number;
    switchThreshold: number;
  } | null;
  
  // NEW: Use positional write handle instead of stream
  out: PositionalWriteHandle | null;
  
  manifest: BlockHashManifest | null;
  stats: {
    fps: number;
    cameraPxPerModule: number;
    packetsPerSec: number;
    eta: number;
    dutyCycle: number;
  };
}
```

### Block Write Logic

```typescript
/**
 * Write a decoded block to its correct position.
 *
 * @param handle - Positional write handle
 * @param blockData - Decoded block data
 * @param blockIndex - Block index (determines offset)
 * @param blockSize - Block size from beacon
 */
async function writeBlock(
  handle: PositionalWriteHandle,
  blockData: Uint8Array,
  blockIndex: number,
  blockSize: number
): Promise<void> {
  const offset = blockIndex * blockSize;
  
  // Write at specific offset - order independent!
  await handle.write(blockData, { at: offset });
}
```

## Usage Example

### Main Thread (Sender/Receiver)

```typescript
// During receive session initialization
const factory = new PositionalWriteHandleFactory();
const handle = await factory.createHandle(
  `screenferry-${streamId}.tmp`,
  meta.originalSize
);

// When a block is decoded (can arrive out of order!)
await writeBlock(handle, decodedBlock, blockIndex, meta.blockSize);

// On completion
await handle.close();
```

### Worker Context

```typescript
// In worker, direct access to sync handle
const opfsRoot = await navigator.storage.getDirectory();
const fileHandle = await opfsRoot.getFileHandle(fileName, { create: true });
const syncHandle = await fileHandle.createSyncAccessHandle();

// Direct positional write (synchronous!)
syncHandle.write(blockData, { at: blockIndex * blockSize });

syncHandle.close();
```

## Error Handling Strategy

### Quota Exceeded

```typescript
try {
  await handle.write(block, { at: offset });
} catch (e) {
  if (e instanceof WriteError && e.code === 'QUOTA_EXCEEDED') {
    // Transition to QUOTA_EXHAUSTED state
    return transitionToQuotaExhausted(state, e.context);
  }
  throw e;
}
```

### Resume Handling

```typescript
// On resume from PAUSED state
const handle = await factory.reopenHandle(`screenferry-${streamId}.tmp`);

// Restore can continue immediately - blocks can be written out of order
// Missing blocks will be filled in during repair
```

## Performance Considerations

### Advantages

1. **No buffering**: Blocks written directly to final position
2. **Order independence**: No need to queue or reorder blocks
3. **Memory efficiency**: Only one block in memory at a time
4. **Repair efficiency**: Missing blocks can be filled directly

### Potential Issues

1. **Seek overhead**: Frequent seeking may impact performance
   - **Mitigation**: OS/filesystem typically handles this efficiently
2. **Fragmentation**: Out-of-order writes may fragment files
   - **Mitigation**: OPFS handles this internally
3. **Fallback limitations**: Stream backend may not support seek()
   - **Mitigation**: Use worker context when possible

## Testing Strategy

### Unit Tests

1. **Write order independence**: Write blocks 5, 2, 8, 1, 9 and verify file integrity
2. **Offset validation**: Test writes at various offsets
3. **Error cases**: Quota exceeded, invalid offset, closed handle
4. **Resume scenario**: Close and reopen handle, continue writing

### Integration Tests

1. **Full receive flow**: Start session, receive blocks out of order, complete
2. **Repair flow**: Receive partial file, pause, resume, fill missing blocks
3. **Large file**: Test with file requiring many blocks (>10,000)

### Browser Compatibility Tests

1. **OPFS support**: Verify createSyncAccessHandle availability
2. **Fallback behavior**: Test StreamWriteBackend when sync handle unavailable
3. **Worker vs main thread**: Verify both contexts work correctly

## Migration Path

### Phase 1: Interface Definition

1. Create `src/core/io/positional-write.ts` with interfaces
2. Add factory and backend abstractions
3. Document API and usage patterns

### Phase 2: OPFS Implementation

1. Implement `OPFSWriteBackend`
2. Create factory for handle creation
3. Add unit tests for OPFS backend

### Phase 3: Integration

1. Modify `ReceivingState` to use `PositionalWriteHandle`
2. Update block write logic to use positional writes
3. Add integration tests

### Phase 4: Fallback Implementation

1. Implement `StreamWriteBackend`
2. Add capability detection and fallback logic
3. Test across browsers

## Open Questions

1. **Pre-allocation**: Should we pre-allocate file space to avoid fragmentation?
   - **Recommendation**: Yes, if OPFS supports it

2. **Flush strategy**: Should we expose explicit `flush()` for checkpointing?
   - **Recommendation**: Yes, for crash recovery during long transfers

3. **Concurrent writes**: Can multiple handles write to same file?
   - **Recommendation**: No, single writer per file

4. **Block completion tracking**: How do we track which blocks are written?
   - **Answer**: Use existing bitmap in `RecvSessionState.complete`

## References

- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API)
- [OPFS createSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)
- [WritableStream write()](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream/write)
- ScreenFerry plan.md §6.2 (RecvSession.out type)

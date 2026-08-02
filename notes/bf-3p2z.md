# RecvSession.out Type Audit and §6.2 OPFS Requirements Mismatch

**Bead:** `bf-3p2z`
**Related:** §6.2 (Threads and ownership), §7.3 (Session state)

## Executive Summary

**CRITICAL MISMATCH IDENTIFIED:** The current `RecvSession.out` type (`FileSystemWritableFileStream`) is incompatible with §6.2's OPFS requirements. This prevents correct out-of-order block writing during repair/resume scenarios.

**Root Issue:** `FileSystemWritableFileStream` is a sequential append-only stream, while the architecture requires positional writes to handle blocks arriving out of order.

---

## Current Implementation

### Location
- **File:** `/home/coding/screenferry/src/core/session/types.ts`
- **Lines:** 111, 127

### Current Type Definition

```typescript
export interface ReceivingState extends BaseRecvState {
  type: 'receiving';
  // ...
  out: FileSystemWritableFileStream;  // ← Sequential stream
  // ...
}

export interface VerifyingState extends BaseRecvState {
  type: 'verifying';
  out: FileSystemWritableFileStream;  // ← Sequential stream
  // ...
}
```

### API Characteristics of `FileSystemWritableFileStream`

**From MDN Web API:**
- **Interface:** Async, sequential stream
- **Write method:** `write(chunk: Blob | BufferSource | Uint8Array)`
- **Positioning:** NO positional write support — always appends to current cursor
- **Thread:** Can be used in main thread or workers (but not with `createSyncAccessHandle`)
- **Seek:** `seek(position)` moves cursor but then writes sequentially from there
- **Use case:** Sequential file construction, not random-access writes

**The problem:** When blocks arrive out of order (e.g., block 5 arrives before block 3), a sequential stream writes them in arrival order, scrambling the file:
```
Expected: [Block 0][Block 1][Block 2][Block 3][Block 4][Block 5]...
Actual:   [Block 0][Block 1][Block 2][Block 5][Block 3][Block 4]...
                                                   ^^^^^ Scrambled!
```

---

## §6.2 Requirements (from plan.md)

### Specification

**From plan.md §6.2 (Lines 338-354):**

| Component | Thread | Owns |
|---|---|---|
| UI, canvas paint | main | display |
| Frame encoder | worker | ring buffer (depth 3, I7) |
| QR decode pool | N workers | `VideoFrame` — MUST `close()` each or the pipeline stalls |
| GE decoder | 1 worker | the 72 KB matrix; single-owner, no sharing |
| **OPFS writer** | **worker** | **`createSyncAccessHandle` is worker-only** |

### Required API: `createSyncAccessHandle`

**From MDN Web API - FileSystemFileHandle.createSyncAccessHandle():**
- **Interface:** Synchronous, positional write API
- **Worker-only:** Can ONLY be called from a Worker context, not main thread
- **Write method:** `write(buffer: BufferSource, options?: {at: number})`
- **Positioning:** Supports **positional writes** via `write(buf, {at})`
- **Thread:** Worker-only (throws on main thread)
- **Use case:** Random-access writes, perfect for out-of-order blocks

**Positional write example:**
```typescript
const handle = await fileHandle.createSyncAccessHandle();
// Blocks arrive out of order — write at correct positions:
handle.write(block5,  {at: 5 * blockSize});   // Write block 5 at position 5
handle.write(block3,  {at: 3 * blockSize});   // Write block 3 at position 3
handle.write(block10, {at: 10 * blockSize});  // Write block 10 at position 10
await handle.close();
```

---

## The Mismatch

### Problem Statement

**Repair/resume scenarios require out-of-order block writing:**

1. **Repair code** (§8.2): Sender transmits only missing blocks
   - If blocks 3, 7, 15 are missing, receiver gets only those blocks
   - Must write them at positions 3, 7, 15 — not append sequentially

2. **Resume** (D22): Receiver resumes from interrupted transfer
   - Bitmap shows blocks 0-999 complete, blocks 1000+ missing
   - Incoming blocks 1000+ must be written at correct positions
   - Sequential stream would overwrite existing data or append incorrectly

3. **Late join**: Receiver joins mid-transfer
   - Starts receiving at block 5000
   - Must write at position 5000, not position 0

### Why `FileSystemWritableFileStream` Fails

**Attempted workaround with `seek()`:**
```typescript
await out.seek(blockIndex * blockSize);  // Move cursor
await out.write(blockData);               // Write sequentially
```

**Problems:**
- Still sequential — blocks arriving out of order are written in arrival order
- Concurrent block completions would race on the cursor position
- No atomic positional guarantees

### What `createSyncAccessHandle` Provides

**Correct implementation:**
```typescript
const handle = await fileHandle.createSyncAccessHandle();

// Atomic positional writes, regardless of arrival order:
handle.write(blockData, {at: blockIndex * blockSize});

// No cursor races — each write is independent
```

---

## Architectural Impact

### Current Data Flow (INCORRECT)

```
GE Decoder (worker) → decoded block (192 KB)
                    ↓
            FileSystemWritableFileStream (main thread?)
                    ↓
              Sequential append (WRONG for out-of-order!)
```

### Required Data Flow (CORRECT per §6.2)

```
GE Decoder (worker) → decoded block (192 KB)
                    ↓
            OPFS Worker (separate thread per §6.2)
                    ↓
      createSyncAccessHandle.write(buf, {at: blockIndex * blockSize})
                    ↓
              Correct positional write
```

### Thread Violation

**Current:** `FileSystemWritableFileStream` typically used on main thread
**Required:** `createSyncAccessHandle` is **worker-only**

The current implementation either:
1. Violates §6.2's "OPFS writer | worker" requirement, OR
2. Uses a suboptimal API even in a worker (can use `createSyncAccessHandle` instead)

---

## Block Transfer Scenarios

### Scenario 1: Normal Sequential Arrival
```
Blocks arrive: 0, 1, 2, 3, 4, 5...
Both APIs work (but createSyncAccessHandle is still required per §6.2)
```

### Scenario 2: Repair Code (Missing Blocks)
```
Missing blocks: 3, 7, 15
Repair transmission sends: [3], [7], [15]
❌ FileSystemWritableFileStream: Writes sequentially → file scrambled
✅ createSyncAccessHandle: write(buf, {at: 3*size}) → correct
```

### Scenario 3: Resume from Interruption
```
Completed blocks: 0-999 (bitmap shows this)
Resuming from: block 1000
Blocks arrive: 1000, 1005, 1002, 1010, 1001... (out of order!)
❌ FileSystemWritableFileStream: Writes in arrival order → wrong positions
✅ createSyncAccessHandle: Each write uses {at: N*size} → correct
```

### Scenario 4: Late Join
```
User joins transfer at block 5000
Blocks arrive: 5000, 5001, 5002...
❌ FileSystemWritableFileStream: Needs seek to 5000*size, then sequential
✅ createSyncAccessHandle: write(buf, {at: 5000*size}) from first block
```

---

## Related Requirements

### From plan.md:

**§6.2 (Threads and ownership):**
> "OPFS writer | worker | `createSyncAccessHandle` is worker-only"

**§8.2 (Repair code):**
> "The receiver knows exactly which blocks it lacks. The user reads a code off one screen and types it into the other:
> Receiver: 'Missing 3 blocks. Repair code: `SF1-K7F2M9-3B-X4`'
> Sender: [paste] → transmits only those blocks"
> → Requires writing only specific blocks at specific positions

**§8.3 (Resume D22):**
> "The receiver persists `{streamId, meta, bitmap}` plus the OPFS output after every completed block."
> → Blocks are completed out of order due to channel loss

**D20 (Stream both ends):**
> "Multi-GB `ArrayBuffer` is not allocatable. `File.slice()` sender-side, OPFS receiver-side."
> → Confirms OPFS is the correct storage mechanism, but must use correct API

---

## Required Changes

### Type Definition Change

**Current (`src/core/session/types.ts`):**
```typescript
out: FileSystemWritableFileStream;  // Wrong API
```

**Required:**
```typescript
// Option 1: Store the sync access handle directly
out: FileSystemSyncAccessHandle;    // Correct API per §6.2

// Option 2: Store the file handle and create access handle as needed
outHandle: FileSystemFileHandle;
out: FileSystemSyncAccessHandle | null;  // Created in worker
```

### Implementation Requirements

1. **OPFS Writer Worker:** Create dedicated worker per §6.2
2. **Handle Lifecycle:**
   - Create `FileSystemSyncAccessHandle` in worker on session start
   - Use `write(buffer, {at: blockIndex * blockSize})` for each completed block
   - Call `close()` on completion/error
3. **Thread Safety:** Ensure all writes happen from the same worker thread
4. **Error Handling:** Handle quota exhaustion gracefully with positional state intact

### Worker Message Flow

```
Main Thread                    OPFS Worker
     │                              │
     ├─ createOutputStream() ────→│
     │                              ├─ createSyncAccessHandle()
     │                              ├─ store handle
     │←─────────────────────────────┤
     │                              │
     ├─ writeBlock(blockIndex) ───→│
     │                              ├─ handle.write(buf, {at: index * size})
     │←─────────────────────────────┤
     │                              │
     ├─ close() ───────────────────→│
     │                              ├─ handle.close()
     │                              ├─ release handle
     │←─────────────────────────────┤
```

---

## Testing Requirements

### Unit Tests Needed

1. **Sequential block write:** Verify blocks 0, 1, 2, 3 written correctly
2. **Out-of-order write:** Write blocks 3, 1, 2 → verify correct file layout
3. **Repair scenario:** Write only blocks 3, 7, 15 → verify sparse file correct
4. **Resume scenario:** Write blocks 0-999, resume, write 1000-1005 → verify correct
5. **Concurrent writes:** Multiple blocks complete simultaneously → verify no races

### Integration Tests Needed

1. **Full repair flow:** Generate repair code → sender transmits → receiver writes correctly
2. **Resume flow:** Interrupt transfer → reload → resume → verify file integrity
3. **Late join:** Start mid-transfer → verify output matches original

---

## Migration Path

### Phase 1: Type Changes
- Update `RecvSession` types to use `FileSystemSyncAccessHandle`
- Update all references to `out` to use positional writes

### Phase 2: Worker Implementation
- Create `workers/opfs.worker.ts` per §6.2 module layout
- Implement message-based OPFS write interface
- Move OPFS operations from main thread to worker

### Phase 3: Testing
- Add unit tests for positional writes
- Add integration tests for repair/resume scenarios
- Verify thread safety and error handling

### Phase 4: Documentation
- Update plan.md §7.3 to reflect correct type
- Ensure §6.2 worker ownership is clear
- Update API documentation

---

## References

1. **plan.md §6.2** - Threads and ownership (OPFS writer | worker)
2. **plan.md §7.3** - Session state (current `out: FileSystemWritableFileStream`)
3. **plan.md §8.2** - Repair code (missing block transmission)
4. **plan.md §8.3** - Resume (D22 bitmap persistence)
5. **MDN - FileSystemSyncAccessHandle.write()** - Positional write API
6. **MDN - FileSystemWritableFileStream** - Sequential stream API
7. **src/core/session/types.ts:111,127** - Current type definitions

---

## Conclusion

The current `RecvSession.out` type (`FileSystemWritableFileStream`) is **fundamentally incompatible** with the architecture's requirements for out-of-order block writing during repair and resume scenarios.

**Required fix per §6.2:**
1. Change type to `FileSystemSyncAccessHandle`
2. Move OPFS writes to dedicated worker
3. Use `write(buffer, {at: position})` for positional writes

This is not an API preference — it is an **architectural requirement** that must be satisfied for repair and resume to work correctly.

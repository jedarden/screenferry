# Missing Implementation Details: Sender Initialization Flow

**Bead:** bf-17pi
**Date:** 2026-08-03
**Status:** Final verification - identifies all missing components

## Overview

This document identifies all functions, components, and error handling that are **called but not yet implemented** in the sender initialization flow. The analysis is based on:

1. The comprehensive initialization flow documented in `bf-2ygc-sender-initialization-flow.md`
2. Actual codebase inspection of `/home/coding/screenferry/src/`
3. Cross-reference between planned phases and implemented code

---

## Summary of Findings

**Implemented:** 6 of 8 core infrastructure components
**Missing:** 14 critical initialization and execution components
**Partial:** 2 components (types defined, no runtime implementation)

### Implemented Components ✅

1. **State Type Definitions** (`src/core/session/types.ts`)
   - All sender state types defined (IdleSenderState, SendingState, etc.)
   - State transition validation functions exist (`assertSendTransition`)
   - Resume token infrastructure implemented

2. **Fountain Encoder** (`src/core/fountain/encoder.ts`)
   - Full LT fountain encoder implementation
   - Supports both regular and repetition modes (E2)
   - Endless stream generation as required by D24

3. **Beacon Encoding** (`src/core/frame/beacon.ts`)
   - Complete beacon metadata parsing and encoding
   - T1 bounds checking with K validation (D26)
   - Compression/resume conflict flag handling (bf-17s0)

4. **Header Encoding** (`src/core/frame/header.ts`)
   - 13-byte packet header encoding/decoding
   - CRC-8 validation with fast reject

5. **Parameters & Constants** (`src/core/params.ts`)
   - All wire protocol constants defined (K, L, BLOCK, etc.)
   - K validation against I6a memory constraint

6. **Error Infrastructure** (`src/core/errors/error-codes.ts`)
   - Comprehensive error codes and user-facing messages
   - Livelock detection for E12 retry loops

---

## Missing Implementation by Phase

### Phase 1: Storage Pre-flight Check ❌

**Planned:** `src/platform/storage-preflight.ts`
**Status:** **FILE DOES NOT EXIST**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
checkStoragePreflight(fileSize: number): Promise<{
  sufficient: boolean;
  error?: string;
}>
```

**Missing Implementation:**
- `navigator.storage.estimate()` calls
- Staging overhead calculation (file size × 1.1)
- Browser-specific safety margin application (Chrome/Edge 60%, Firefox 10%, Safari 1 GB)
- User-facing error display when insufficient

**Error Handling:** None - no pre-flight validation exists

**Impact:** User can select files that cannot be stored, leading to late failure

---

### Phase 2: File Selection and Compression Decision ❌

**Status:** **NOT IMPLEMENTED**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
sampleCompressibility(file: File): Promise<{ratio: number; compressible: boolean}>
detectAlreadyCompressed(file: File): boolean
shouldCompress(file: File, sampleResult?: CompressionSample): boolean
```

**Missing Implementation:**
- File picker UI element (button, file input)
- File fingerprinting (size + lastModified for E5 source-changed detection)
- Compression sampling (read first 1 MB, test with CompressionStream)
- Already-compressed detection (magic byte checks for common formats)
- User setting for compression preference

**Error Handling:** None - no compression pipeline exists

**Impact:** 
- No way to initiate file transfer
- Cannot assess compression benefit
- Missing privacy cleanup (T4a - staging file lifecycle)

---

### Phase 3: Compression Staging ❌

**Status:** **NOT IMPLEMENTED**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
stageCompressedFile(file: File): Promise<FileSystemFileHandle>
cleanupStagingFile(handle: FileSystemFileHandle): Promise<void>
```

**Missing Implementation:**
- OPFS file creation for compressed output
- CompressionStream piping (`file.stream().pipeThrough(new CompressionStream('gzip'))`)
- Staging file lifecycle management (T4a privacy requirement)
- Startup cleanup integration (E11)

**Privacy Violation:** T4a requires staging files to be wiped on:
- Transfer completion
- User cancel
- Startup cleanup (E11)
- Sender crash/restart

**Impact:** 
- Compression cannot be used
- Privacy requirement violation
- Missing E11 integration

---

### Phase 4: Session Parameter Derivation ❌

**Status:** **NOT IMPLEMENTED**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
deriveSessionParameters(file: File, staging: FileSystemFileHandle | null): SessionParams
```

**Missing Implementation:**
- Block size derivation (K = 768 default, L = 256 fixed)
- Block count calculation (`ceil(payloadLen / blockSize)`)
- StreamId derivation (`crc32(originalSize || filename)` per I3)
- Degree cap validation (64 max)
- Flags calculation (Compressed | ResumeDisabled when compression enabled)

**Error Handling:** None - parameters not derived

**Impact:** Cannot initialize sender session state

---

### Phase 5: Beacon Metadata Creation ⚠️

**Status:** PARTIAL - encoding exists, metadata creation missing

**Existing:**
- `encodeBeacon(meta: BeaconMeta)` - fully implemented ✅

**Missing:**
```typescript
// NOT IMPLEMENTED
createBeaconMetadata(sessionParams: SessionParams, file: File): BeaconMeta
computeWholeFileHash(file: File): Promise<Uint8Array> // 32-byte SHA-256
computeManifestHash(manifest: BlockHashManifest): Uint8Array // 4-byte CRC-32
```

**Missing Implementation:**
- Whole-file SHA-256 hash calculation
- Manifest hash derivation (chains beacon→manifest→blocks per §7.6)
- BeaconMeta object construction with all required fields

**Impact:** Can encode beacon but cannot create the metadata to encode

---

### Phase 6: Sender Session Creation ❌

**Status:** TYPES ONLY - no runtime implementation

**Existing:**
- Type definitions (IdleSenderState, SendingState, etc.) ✅
- State transition validation (`assertSendTransition`) ✅

**Missing:**
```typescript
// NOT IMPLEMENTED
createSendingState(file: File, sessionParams: SessionParams): SendingState
transitionToSending(state: IdleSenderState, file: File): SendingState
transitionToPaused(state: SendingState): PausedSenderState
transitionToStopping(state: SendingState, reason: StopReason): StoppingState
```

**Missing Implementation:**
- Actual state transition logic (only validation exists)
- SendingState object construction
- Cursor initialization (`{blockIndex: 0, seq: 0}`)
- Dwell packet calculation (`1.6 × K = 1229`)
- Source fingerprint storage for E5 source-changed detection

**Impact:** Cannot create or manage sender session state

---

### Phase 7: Frame Encoder Initialization ❌

**Status:** **NOT IMPLEMENTED**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
createFrameEncoder(sessionState: SendingState): FrameEncoder
```

**Missing Components:**
- Frame encoder worker thread pool initialization
- Packet queue → tile distribution logic
- Modulation layer integration (Stage 1: tiled mono QR encoding)

**Existing:**
- Fountain encoder (separate component) ✅
- Header encoder (separate component) ✅

**Impact:** Cannot generate frames for display

---

### Phase 8: Display and Frame Loop ❌

**Status:** **NOT IMPLEMENTED**

**Missing Functions:**
```typescript
// NOT IMPLEMENTED
startFrameLoop(sessionState: SendingState, encoder: FrameEncoder): void
emitBeaconTile(sessionState: SendingState): ImageData
throttleFrameRate(targetFps: number): void
```

**Missing Implementation:**
- requestAnimationFrame loop
- Block streaming (`File.slice()` for large files)
- Dwell counting (emit 1.6×K packets per block)
- Beacon emission timing (every ~2 seconds per D17)
- Frame rate throttling (≤½ camera fps per D9)
- Canvas rendering
- Profile mixing (D16: R1/R2/R3 within frame)

**Error Handling:**
- No error handling for frame generation failures
- No recovery from encode errors

**Impact:** Cannot display transmission to receiver

---

## Additional Missing Components

### 9. Sender UI Components ❌

**Status:** **NOT IMPLEMENTED**

**Missing Elements:**
- File picker button
- Progress display (sender doesn't know receiver progress, but can show emission state)
- Cancel/stop controls
- Compression enable/disable toggle
- K override setting for desktop receivers (D26)

**Impact:** No user interface for initiating or controlling transmission

---

### 10. Error Handling Gaps ❌

**Missing Error Scenarios:**

1. **Storage pre-flight failures:**
   - Quota API not available
   - Estimate fails
   - Insufficient space after staging

2. **Compression failures:**
   - CompressionStream not supported
   - Compression fails mid-stream
   - Staging write failures

3. **Session initialization failures:**
   - File handle revoked (E5 source-changed)
   - OPFS not available
   - State transition violations

4. **Frame loop failures:**
   - Worker thread crashes
   - Modulation encoding failures
   - Canvas rendering errors

5. **Cleanup failures:**
   - Staging file deletion fails
   - Worker termination hangs
   - State persistence fails

**Impact:** Errors will cause unhandled rejections or silent failures

---

## Edge Cases Not Covered

### 11. File Edge Cases ❌

**Missing Handling:**
- Empty files (0 bytes)
- Files larger than MAX_FILE_SIZE (281 TB limit)
- Filenames exceeding BEACON_LIMITS.MAX_FILENAME_BYTES (128 bytes)
- MIME types exceeding BEACON_LIMITS.MAX_MIMETYPE_BYTES (58 bytes)
- Files with invalid UTF-8 filenames
- Files with path separators in names (security: directory traversal)

**Impact:** Malicious or unusual files may cause crashes or security issues

---

### 12. Resource Exhaustion ❌

**Missing Protection:**
- No limit on concurrent frame encodes
- No memory limit for large file staging
- No backpressure when frame generation exceeds display capacity
- No detection of OPFS quota exhaustion during staging

**Impact:** Resource exhaustion leading to tab crashes or browser hangs

---

### 13. Concurrency and Race Conditions ❌

**Missing Synchronization:**
- No protection against concurrent state transitions
- No handling of rapid file picker changes
- No cleanup guarantee on tab close
- No atomic state updates

**Impact:** Race conditions in state machine, resource leaks

---

## Architecture Gaps

### 14. Missing State Machine Runtime ❌

**Status:** TYPES ONLY

**Existing:**
- State type definitions ✅
- Transition validation (`assertSendTransition`) ✅

**Missing:**
```typescript
// NOT IMPLEMENTED - no runtime state machine
class SenderStateMachine {
  private currentState: SendSessionState;
  
  transition(targetState: SendSessionState): void;
  getState(): SendSessionState;
  canTransition(to: string): boolean;
}
```

**Impact:** No way to manage state transitions at runtime

---

## Implementation Priority

### Critical (blocks basic functionality)
1. **Sender UI** - file picker, basic controls
2. **Sender Session State Machine** - runtime transition logic
3. **Session Parameter Derivation** - create SendingState objects
4. **Frame Encoder Initialization** - integrate components

### High (enables core transmission)
5. **Frame Loop** - display transmission
6. **Storage Pre-flight** - prevent late failures
7. **Beacon Metadata Creation** - whole-file hashing

### Medium (optimization and UX)
8. **Compression Pipeline** - staging + cleanup
9. **Error Handling** - comprehensive error recovery
10. **Edge Case Handling** - file validation, resource limits

### Low (polish and robustness)
11. **Concurrency Protection** - prevent race conditions
12. **Performance Monitoring** - frame rate throttling, backpressure
13. **Cleanup Guarantees** - tab close handling

---

## Conclusion

The sender initialization flow has **excellent foundational infrastructure** (state types, fountain encoder, beacon encoding) but is missing **all runtime implementation** for the actual sender functionality:

**14 critical missing components** prevent any sender functionality from working:
- No UI to initiate transmission
- No state machine to manage sender lifecycle
- No frame generation or display
- No compression or staging
- No error handling or edge case protection

The architecture is sound and well-documented, but the sender implementation is essentially a **shell with no execution logic**.

---

## References

- **Plan:** `docs/plan/plan.md` - Complete application specification
- **State Machine:** `docs/notes/session-state-machine.md` - State transition rules
- **Sender Flow:** `bf-2ygc-sender-initialization-flow.md` - Comprehensive initialization trace
- **Compression/Resume Conflict:** `bf-17s0-resume-compression-conflict.md` - Flag requirements
- **Block Hash Manifest:** `bf-28q-manifest-resume-persistence.md` - Resume token structure

**Next Steps:** Implement critical components 1-4 in priority order to enable basic sender functionality.

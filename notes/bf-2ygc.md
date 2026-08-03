# Sender Initialization Flow Documentation

## Overview

This document traces the complete sender initialization flow for ScreenFerry, from application startup through sender session creation. It serves as a comprehensive reference for understanding the order of operations, sub-functions called during initialization, and current implementation status.

**Bead:** bf-2ygc
**Date:** 2026-08-03
**Status:** Documentation Complete

---

## Current Implementation Status

### ✅ Implemented: Phase 0 - App Initialization

**Location:** `src/app.ts`, `src/platform/init.ts`

The application currently implements basic initialization only:

```
┌─────────────────────────────────────────────────────────────┐
│  1. DOM ready → main()                                      │
│     ├─ Check document.readyState                           │
│     └─ Add DOMContentLoaded listener if needed              │
│                                                         │
│  2. runAppInit() → parallel execution:                     │
│     ├─ runHealthCheck({ skipSlow: true })                  │
│     │  ├─ OPFS availability check                           │
│     │  ├─ Storage quota estimate                           │
│     │  ├─ Camera permission check                          │
│     │  └─ Return health status                              │
│     ├─ runStartupCleanup(new Set())                        │
│     │  └─ Clean orphaned receiver outputs from OPFS        │
│     └─ Return InitResult                                   │
│                                                         │
│  3. Update UI                                              │
│     ├─ Show initialization status                           │
│     ├─ Display initResult JSON                             │
│     └─ Add version footer (bf-13h)                         │
└─────────────────────────────────────────────────────────────┘
```

**Entry Point:** `src/app.ts::main()`
**Key Functions:**
- `runAppInit()` - Main initialization orchestrator
- `runHealthCheck()` - System capability checks
- `runStartupCleanup()` - OPFS cleanup

**Missing:** No sender UI, no file picker, no sender session state machine

---

## Planned Sender Initialization Flow

### 🔄 Phase 1: User Initiates Send (Not Yet Implemented)

```
USER ACTION: Click "Send File" button
              ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Storage Pre-flight Check (bf-4d6)                 │
│  Location: src/platform/storage-preflight.ts (PLANNED)      │
│                                                         │
│  checkStoragePreflight(file.size)                          │
│  ├─ navigator.storage.estimate()                          │
│  ├─ Calculate staging overhead: file.size × 1.1           │
│  ├─ Apply browser-specific safety margin:                  │
│  │  ├─ Chrome/Edge: ~60% of free disk                      │
│  │  ├─ Firefox: ~10% of disk, capped ~10 GB               │
│  │  └─ Safari/iOS: ~1 GB before prompting                  │
│  └─ Return: { sufficient: boolean, error?: string }         │
│                                                         │
│  IF insufficient:                                           │
│  └─ Show error dialog, block file picker                   │
│  ELSE:                                                     │
│  └─ Proceed to file selection                             │
└─────────────────────────────────────────────────────────────┘
```

**Sub-functions:**
- `navigator.storage.estimate()` - Browser API for quota check
- `calculateStagingOverhead()` - Compute space needed for compression staging

---

### 🔄 Phase 2: File Selection and Compression Decision (Not Yet Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: File Selection                                     │
│  Input: <input type="file"> → File object                   │
│                                                         │
│  Create source fingerprint for E5 detection:               │
│  ├─ size: file.size                                         │
│  └─ lastModified: file.lastModified                         │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Compressibility Sampling (D8)                      │
│  Location: (PLANNED)                                         │
│                                                         │
│  IF file.size >= 10 MB:                                     │
│    ├─ Read first 1 MB sample chunk                          │
│    ├─ compressionStream = new CompressionStream('gzip')     │
│    ├─ Compress sample → compressedSize                      │
│    ├─ ratio = compressedSize / sampleSize                   │
│    ├─ IF ratio < 0.9 AND not already compressed:            │
│    │  └─ Enable compression                                 │
│    └─ ELSE: Skip compression                                │
│  ELSE:                                                     │
│    └─ Skip compression (overhead not worth it)              │
│                                                         │
│  Compression detection:                                      │
│  ├─ Check magic bytes for already-compressed formats       │
│  └─ Skip .gz, .zip, .mp4, .jpg, etc.                       │
└─────────────────────────────────────────────────────────────┘
```

**Sub-functions:**
- `readSampleChunk(file, sampleSize)` - Read sample for compressibility test
- `testCompressibility(sample)` - Compress sample and calculate ratio
- `isAlreadyCompressed(filename)` - Check magic bytes

**Key Decision (D8):** Compression disabled if enabled because:
- CompressionStream is non-deterministic across browser restarts
- Resume is NOT supported when compression is enabled (bf-17s0)

---

### 🔄 Phase 3: Compression Staging (If Enabled) (Not Yet Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Compression Staging (D8)                            │
│  Location: (PLANNED)                                         │
│                                                         │
│  IF compression enabled:                                    │
│    ├─ staging = await navigator.storage.getDirectory()      │
│    ├─ stagingHandle = staging.getFileHandle(                 │
│  │      `staging-${streamId}`, { create: true }            │
│  │    )                                                    │
│    ├- writable = await stagingHandle.createWritable()       │
│    ├─ compressedStream = file.stream().pipeThrough(         │
│  │      new CompressionStream('gzip')                      │
│  │    )                                                    │
│    ├─ await compressedStream.pipeTo(writable)               │
│    └─ Store stagingHandle for session                       │
│  ELSE:                                                     │
│    └─ staging = null                                        │
└─────────────────────────────────────────────────────────────┘
```

**Privacy Requirement (T4a):** Staging file MUST be wiped on:
- Transfer completion
- User cancel
- Startup cleanup (E11)
- Sender crash/restart

**Sub-functions:**
- `createStagingFile(streamId)` - Create OPFS file for compressed data
- `compressToStaging(file, stagingHandle)` - Stream compression to OPFS

---

### 🔄 Phase 4: Session Parameter Derivation (Partially Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Derive Session Parameters                          │
│  Constants: src/core/params.ts (IMPLEMENTED)                │
│                                                         │
│  Fixed Constants (from params.ts):                         │
│  ├─ L = 256 bytes (fragment length, I1)                     │
│  ├─ K = 768 (fragments per block, D19)                    │
│  ├- DEGREE_CAP = 64 (maximum degree, D25)                  │
│  ├─ BLOCK = K × L = 196,608 bytes (192 KB)                │
│  ├─ HEADER = 13 bytes (packet header, D21)                 │
│  ├─ PACKET = HEADER + L = 269 bytes                       │
│  ├─ DWELL_FACTOR = 1.6 (packets per block, §8.1)          │
│  └─ WIRE_VERSION = 1                                        │
│                                                         │
│  Derived Parameters:                                       │
│  ├─ blockSize = BLOCK = 196,608 bytes                     │
│  ├─ payloadLen = staging?.size || file.size                │
│  ├─ blockCount = ceil(payloadLen / blockSize)              │
│  ├─ streamId = crc32(originalSize || filename)            │
│  │  (I3: derived from file identity, not random)           │
│  ├─ blockHashLen = 4 bytes (CRC-32)                        │
│  ├─ fragmentLen = L = 256                                   │
│  └─ dwellPackets = DWELL_FACTOR × K = 1,229 packets        │
│                                                         │
│  Beacon Flags:                                             │
│  ├─ IF compression enabled:                                │
│  │  └─ flags = Compressed | ResumeDisabled                 │
│  └─ ELSE:                                                   │
│     └─ flags = None                                         │
└─────────────────────────────────────────────────────────────┘
```

**Key Invariants:**
- **I1:** L (fragment length) is immutable per session
- **I3:** streamId derived from file identity, not random
- **D26:** K is conservative (assume weakest receiver)

**Implementation Status:**
- ✅ Constants defined in `src/core/params.ts`
- ❌ Parameter derivation logic not yet implemented

---

### 🔄 Phase 5: Beacon Metadata Creation (Partially Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 6: Create Beacon Metadata (D17, D21)                  │
│  Location: src/core/frame/beacon.ts (PARSE IMPLEMENTED)     │
│                                                         │
│  Compute whole-file hash:                                  │
│  ├─ source = staging || file                                │
│  ├- stream = source.stream()                                │
│  ├─ hashBuffer = await crypto.subtle.digest(               │
│  │      'SHA-256', stream)                                  │
│  │  )                                                     │
│  └─ wholeFileHash = new Uint8Array(hashBuffer)             │
│                                                         │
│  Create BeaconMeta object:                                  │
│  ├─ streamId: number (from Step 5)                         │
│  ├─ wireVersion: 1                                         │
│  ├─ originalSize: number (UNCOMPRESSED file size)           │
│  ├─ payloadLen: number (compressed if enabled)              │
│  ├─ blockSize: 196,608 (K × L)                              │
│  ├- blockCount: number (from Step 5)                       │
│  ├- fragmentLen: 256 (L)                                    │
│  ├─ degreeCap: 64                                          │
│  ├─ flags: Compressed? | ResumeDisabled?                   │
│  ├─ blockHashLen: 4                                        │
│  ├─ wholeFileHash: Uint8Array(32)                          │
│  ├─ manifestHash: Uint8Array(4)                            │
│  ├- filename: string (sanitized, T2)                        │
│  └─ mimeType: string                                       │
│                                                         │
│  Encode beacon:                                             │
│  └─ beaconBytes = encodeBeacon(meta)                       │
└─────────────────────────────────────────────────────────────┘
```

**Sub-functions:**
- `crypto.subtle.digest('SHA-256', stream)` - Browser crypto API
- `sanitizeFilename(filename)` - T2 filename sanitization
- `encodeBeacon(meta)` - IMPLEMENTED in `src/core/frame/beacon.ts`

**Implementation Status:**
- ✅ `encodeBeacon()` implemented
- ✅ `parseBeacon()` implemented (receiver side)
- ✅ Beacon validation and bounds checking
- ❌ Sender-side beacon creation flow not yet implemented

---

### 🔄 Phase 6: Sender Session Creation (Not Yet Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 7: Initialize Sender Session State                     │
│  Location: (PLANNED)                                         │
│  From: IdleSenderState → SendingState                       │
│  Types: src/core/session/types.ts (DEFINED)                │
│                                                         │
│  SendingState object:                                       │
│  ├─ type: 'sending'                                         │
│  ├─ source: File (original file reference)                 │
│  ├─ staging: FileSystemFileHandle | null                    │
│  ├─ streamId: number (from Step 5)                          │
│  ├─ blockSize: 196,608 (K × L bytes)                        │
│  ├─ blockCount: number (from Step 5)                        │
│  ├─ fragmentLen: 256 (L, readonly)                          │
│  ├─ K: 768 (readonly, D26)                                 │
│  ├─ cursor: {                                               │
│  │    blockIndex: 0,                                       │
│  │    seq: 0                                               │
│  │  }                                                      │
│  ├─ dwellPackets: 1,229 (1.6 × K)                          │
│  ├─ lastFrameEmitted: timestamp                             │
│  └─ sourceFingerprint: {                                   │
│       size: file.size,                                      │
│       lastModified: file.lastModified                       │
│     }                                                       │
│                                                         │
│  Validate state transition:                                 │
│  └─ assertSendTransition('idle', 'sending')  // ✓ valid     │
└─────────────────────────────────────────────────────────────┘
```

**Sub-functions:**
- `assertSendTransition(from, to)` - Validate state transition
- `createSendingState(params)` - Create SendingState object

**Implementation Status:**
- ✅ Session state types defined in `src/core/session/types.ts`
- ✅ State transition validation functions implemented
- ❌ Sender session creation logic not yet implemented

---

### 🔄 Phase 7: Frame Encoder Initialization (Partially Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 8: Initialize Frame Encoder                           │
│  Location: src/core/fountain/ (PARTIALLY IMPLEMENTED)        │
│                                                         │
│  Frame encoder components:                                  │
│  ├─ Fountain encoder (src/core/fountain/encoder.ts)        │
│  │  ├─ LTEncoder class ✓ IMPLEMENTED                       │
│  │  ├─ encode(seq) → packet ✓ IMPLEMENTED                 │
│  │  └─ stream(from) → Generator ✓ IMPLEMENTED             │
│  ├─ Header encoder (src/core/frame/header.ts)              │
│  │  └─ encodeHeader(header) → 13 bytes (PLANNED)           │
│  ├─ PRNG (src/core/fountain/prng.ts)                       │
│  │  ├─ splitmix32(seed) ✓ IMPLEMENTED                      │
│  │  ├- packetSeed(streamId, blockIndex, seq) ✓             │
│  │  ├- makeDegreeTable(k, cap) ✓ IMPLEMENTED               │
│  │  └─ deriveIndices(...) ✓ IMPLEMENTED                     │
│  └─ Modulation layer (Stage 1: tiled mono QR)              │
│     └─ encodeFrame(packets[]) → ImageData (PLANNED)         │
│                                                         │
│  Worker thread pool (plan.md §6.2):                        │
│  └─ Frame encoder worker (off main thread) (PLANNED)        │
└─────────────────────────────────────────────────────────────┘
```

**Sub-functions:**
- `new LTEncoder(opts)` - Create fountain encoder
- `encoder.encode(seq)` - Generate single packet
- `encoder.stream(fromSeq)` - Generate packet stream
- `deriveIndices(streamId, blockIndex, seq, k, ...)` - Deterministic index selection

**Implementation Status:**
- ✅ LTEncoder fully implemented
- ✅ PRNG fully implemented (SplitMix32, degree distribution, index derivation)
- ❌ Header encoder not yet implemented
- ❌ Modulation layer not yet implemented
- ❌ Worker thread pool not yet implemented

---

### 🔄 Phase 8: Display and Frame Loop (Not Yet Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 9: Start Display Frame Loop (D24)                     │
│  Location: (PLANNED)                                         │
│  From: plan.md §6.3.1                                       │
│                                                         │
│  Frame loop (requestAnimationFrame):                       │
│  WHILE state.type === 'sending':                            │
│    ├─ Generate frame N on-demand (no pre-rendering) ✓     │
│    ├─ Fetch current block: File.slice(...)                  │
│    ├- Read block into fragments[] array                     │
│    ├─ fountainEncoder = new LTEncoder({                    │
│  │      streamId, blockIndex, fragments, degreeCap         │
│  │    })                                                    │
│    ├- For dwell = 1.6 × K packets (1,229 total):           │
│  │  ├─ seq = cursor.seq++                                  │
│  │  ├─ packet = fountainEncoder.encode(seq)                 │
│  │  ├─ header = encodeHeader({ blockIndex, seq, flags })    │
│  │  └─ Queue { header, packet } for frame encoding          │
│    ├─ modulation.encodeFrame(packets[]) → ImageData         │
│    ├─ Render to canvas                                      │
│    ├- Every ~2 seconds: emit beacon tile (D17)               │
│    ├─ Sleep to meet ≤½ camera fps target (D9)               │
│    └─ Advance cursor:                                      │
│         cursor.blockIndex++                                │
│         if cursor.blockIndex >= blockCount:                  │
│           cursor.blockIndex = 0 (loop)                       │
│           cursor.seq = 0                                    │
└─────────────────────────────────────────────────────────────┘
```

**Key Invariants:**
- **D24:** Frames generated on-demand, never pre-rendered
- **D9:** Frame rate ≤½ measured receiver camera fps (45 fps max)
- **D17:** Beacons emitted every ~2 seconds at conservative profile (R1)
- **I7:** Ring buffer depth ≤ 3 frames
- **I3:** Stateless sender - any (blockIndex, seq) can be generated without replay

**Dwell Calculation (§8.1):**
```
dwellPackets = 1.6 × K = 1.6 × 768 = 1,229 packets

Why 1.6×:
- 1.0× would deliver K packets per block
- At 25% erasure, receiver needs 1.33× to reach rank K
- 1.6× provides safety margin for high loss scenarios
```

**Implementation Status:**
- ❌ Frame loop not yet implemented
- ❌ Canvas rendering not yet implemented
- ❌ Frame rate throttling not yet implemented
- ❌ Beacon emission timing not yet implemented

---

## State Transition Flow

### Complete Sender State Machine

```
┌─────────────────────────────────────────────────────────────┐
│                    SENDER STATE TRANSITIONS                  │
└─────────────────────────────────────────────────────────────┘

IdleSenderState
      │
      │ user initiates send
      ▼
SendingState ─────────────────────────────────────────────┐
      │                                                 │
      │ tab backgrounded (E8)                          │
      ▼                                                 │
PausedSenderState                                        │
      │                                                 │
      │ tab foregrounded                                │
      └───────────────────────────────────────────────│
                                                         │
                                                         │ user enters repair mode
                                                         ▼
                                                  RepairModeState
                                                         │
                                                         │ repair complete / cancel
                                                         │
      user cancel / source changed / error               │
      └─────────────────────────────────────────────────┘
                              ▼
                        StoppingState
                              │
                              │ graceful shutdown
                              ▼
                        IdleSenderState
```

**Transition Validation:** `src/core/session/types.ts::assertSendTransition()`

---

## Missing Implementation Summary

### ❌ Not Yet Implemented

1. **Sender UI**
   - File picker button
   - Progress display
   - Cancel/stop controls

2. **Storage Pre-flight Checks**
   - `checkStoragePreflight()` function
   - Browser-specific quota validation

3. **Compression Pipeline**
   - Compressibility sampling
   - CompressionStream to OPFS
   - Staging file lifecycle management

4. **Parameter Derivation**
   - Session parameter calculation
   - streamId derivation from file identity
   - Beacon flags assembly

5. **Sender Session State Machine**
   - IdleSenderState → SendingState transition
   - SendingState → PausedSenderState (E8: tab backgrounded)
   - SendingState → StoppingState (user cancel)

6. **Header Encoder**
   - 13-byte packet header encoding
   - BlockIndex, Seq, Flags fields

7. **Modulation Layer**
   - QR code encoding (Stage 1: tiled mono QR)
   - Tile distribution (R1/R2/R3 profiles)
   - ImageData generation

8. **Frame Loop**
   - Block streaming (File.slice for large files)
   - Dwell counting and packet generation
   - Beacon emission timing
   - Frame rate throttling (D9)

9. **Frame Display**
   - Canvas rendering
   - Profile mixing (D16: R1/R2/R3 within frame)
   - Camera frame rate measurement

---

## Key Invariants and Decisions

### Implementation Invariants

- **I1:** L (fragment length) is immutable per session
- **I3:** streamId derived from file identity, not random (enables stateless sender)
- **I6a:** Block-layer working set ≤ 1 MB (enforced by K_MAX)
- **I7:** Ring buffer depth ≤ 3 frames

### Design Decisions

- **D8:** Compress before blocking (with staging to OPFS)
- **D9:** Frame rate ≤½ camera fps
- **D17:** Beacons every ~2 seconds
- **D19:** K = 768, L = 256 B (192 KB blocks)
- **D20:** Stream both ends (no full-file materialization)
- **D24:** Stateless sender (on-demand frame generation)
- **D25:** Degree cap = 64
- **D26:** Sender assumes weakest receiver (conservative K)

### Compression/Resume Trade-off

- **Benefit:** 3-10× reduction in transfer time for compressible files
- **Cost:** Resume is NOT supported when compression enabled (bf-17s0)
- **Reason:** CompressionStream is non-deterministic across browser restarts
- **Solution:** Set BeaconFlags.ResumeDisabled when compression enabled

---

## References

### Source Files

| File | Status | Description |
|------|--------|-------------|
| `src/app.ts` | ✅ Implemented | Application entry point |
| `src/platform/init.ts` | ✅ Implemented | App initialization (health check, cleanup) |
| `src/core/params.ts` | ✅ Implemented | System constants (K, L, degree cap, etc.) |
| `src/core/session/types.ts` | ✅ Defined | Session state type definitions |
| `src/core/frame/beacon.ts` | ✅ Implemented | Beacon parsing/validation/encoding |
| `src/core/fountain/prng.ts` | ✅ Implemented | Deterministic PRNG for index derivation |
| `src/core/fountain/encoder.ts` | ✅ Implemented | LT fountain encoder |
| `src/core/frame/header.ts` | ❌ Missing | Packet header encoding |
| `src/modulation/qr-tiled/` | ❌ Missing | QR code modulation layer |

### Documentation References

| Document | Topic |
|----------|-------|
| `docs/plan/plan.md` | Complete application plan |
| `docs/notes/session-state-machine.md` | State machine specification |
| `docs/notes/bf-17s0-resume-compression-conflict.md` | Compression/resume conflict |
| `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` | Solution evaluation |
| `.claude/memory/bf-2ygc-sender-initialization-flow.md` | Comprehensive flow documentation |

---

## Summary

The current implementation provides only basic app initialization (health checks and cleanup). The full sender initialization flow requires implementation of:

1. **Storage pre-flight** - Quota validation before file selection
2. **File picker and compression pipeline** - User file selection with optional compression
3. **Sender session state machine** - State transitions and persistence
4. **Fountain and frame encoders** - Packet generation and QR encoding
5. **Modulation layer** - QR code tile generation
6. **Frame loop and display** - On-demand frame generation and rendering

The architecture is well-defined in the plan and session state machine documents. All core constants and types are implemented. The missing pieces are the implementation of the sender-side logic that leverages these foundations.

**Comprehensive Documentation:** See `.claude/memory/bf-2ygc-sender-initialization-flow.md` for detailed flow diagrams and step-by-step traces.

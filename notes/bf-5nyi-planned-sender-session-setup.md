# Planned Sender Session Setup

**Bead:** bf-5nyi
**Created:** 2026-08-02
**Status:** Planned (not yet implemented

## Overview

This document traces the **planned/intended sender session initialization** that is designed but not yet fully implemented in ScreenFerry. It covers what SHOULD happen during sender session creation according to the plan specification.

## Current State (What Exists Today)

### Minimal App Initialization

**Location:** `src/app.ts` and `src/platform/init.ts`

The current implementation provides only basic app shell initialization:

```typescript
// src/app.ts
async function main(): Promise<void> {
  const initResult = await runAppInit();  // Health check + cleanup
  app.innerHTML = `Application initialized successfully`;
}
```

**What exists:**
- Health checks (OPFS, storage, camera)
- Cleanup of orphaned receiver outputs
- Version footer display (bf-13h)

**What's missing:**
- No sender UI or initialization
- No file picker
- No sender session state machine
- No frame encoder
- No modulation layer (QR encoding)

### Type Definitions Only

**Location:** `src/core/session/types.ts`

Sender session states are defined but no implementation exists:

```typescript
export type SendSessionState =
  | IdleSenderState      // No session
  | SendingState         // Normal transmission
  | PausedSenderState    // Tab backgrounded (E8)
  | RepairModeState      // Sending only missing blocks
  | StoppingState;       // Graceful shutdown
```

**SendingState structure (fully planned):**

```typescript
export interface SendingState {
  type: 'sending';
  source: File;                          // Original file reference
  staging: FileSystemFileHandle | null;  // Compressed staging (D8)
  streamId: number;                      // File identity (I3)
  blockSize: number;                     // K × L = 192 KB
  blockCount: number;                    // Total blocks
  readonly fragmentLen: number;          // L = 256 (I1, immutable)
  readonly K: number;                     // 768 (default, D26)
  cursor: {
    blockIndex: number;  // Current block
    seq: number;        // Current packet seq
  };
  dwellPackets: number;       // 1.6 × K = 1229
  lastFrameEmitted: number;   // For timing
  sourceFingerprint: {
    size: number;              // E5: source changed detection
    lastModified: number;
  };
}
```

## Planned Sender Session Initialization Flow

### Phase 1: User Initiates Send

**Trigger:** User clicks "Send File" button

**Step 1: Storage Pre-flight Check (bf-4d6)**

Location: `src/platform/storage-preflight.ts` (partially implemented)

```typescript
async function checkStoragePreflight(fileSize: number): Promise<{
  sufficient: boolean;
  errorMessage?: string;
}> {
  const estimate = await navigator.storage.estimate();
  const stagingOverhead = fileSize * 1.1;  // Compression overhead
  const safetyMargin = getBrowserSpecificMargin();  // 20-50%

  const sufficient = estimate.quota > (fileSize + stagingOverhead) * safetyMargin;

  return { sufficient, errorMessage: insufficient ? 'Not enough storage' : undefined };
}
```

**Browser-specific validation (D19):**
- Chrome/Edge: ~60% of free disk
- Firefox: ~10% of disk, capped ~10 GB
- Safari/iOS: ~1 GB before prompting

**If insufficient:** Block file picker, show error
**If sufficient:** Proceed to compression check

### Phase 2: File Selection and Compression Decision

**Step 2: User Selects File**

```typescript
<input type="file" onchange="handleFileSelect(event)">
```

**File fingerprint for E5 (source changed detection):**

```typescript
interface SourceFingerprint {
  size: number;          // file.size
  lastModified: number;  // file.lastModified
}
```

**Step 3: Compression Sampling (D8)**

Location: NOT YET IMPLEMENTED

```typescript
async function shouldCompress(file: File): Promise<boolean> {
  // Skip if already compressed (detected by magic)
  if (isAlreadyCompressed(file)) return false;

  // Skip if file < 10 MB (overhead not worth it)
  if (file.size < 10_000_000) return false;

  // Sample first 1 MB
  const sample = await file.slice(0, 1_000_000).arrayBuffer();
  const compressed = await compressSample(sample);

  // Enable compression if ratio < 0.9 (10% reduction)
  return compressed.byteLength < sample.byteLength * 0.9;
}
```

**Compression trade-off (plan.md D8):**
- **Benefit:** 3-10× reduction in transfer time for compressible files
- **Cost:** Resume is NOT supported when compression enabled (bf-17s0)
- **Reason:** CompressionStream is non-deterministic across browser restarts

### Phase 3: Compression Staging (If Enabled)

**Step 4: Compression Staging (D8)**

Location: NOT YET IMPLEMENTED

```typescript
async function createStagingFile(
  file: File,
  compress: boolean
): Promise<FileSystemFileHandle | null> {
  if (!compress) return null;

  const staging = await navigator.storage.getDirectory();
  const stagingFile = await staging.getFileHandle(
    `staging-${Date.now()}.dat`,
    { create: true }
  );
  const writable = await stagingFile.createWritable();

  const stream = file.stream()
    .pipeThrough(new CompressionStream('gzip'));

  await stream.pipeTo(writable);

  return stagingFile;
}
```

**Privacy requirement (T4a):** Staging file MUST be wiped on:
- Transfer completion
- User cancel
- Startup cleanup (E11)
- Sender crash/restart

### Phase 4: Session Parameter Derivation

**Step 5: Derive Session Parameters**

Location: NOT YET IMPLEMENTED

```typescript
interface SessionParams {
  // Block size (K × L): D19
  K: number;           // 768 (default, D26)
  L: number;           // 256 bytes (I1, fixed)
  blockSize: number;   // K × L = 192 KB

  // Block count
  payloadLen: number;  // staging?.size || file.size
  blockCount: number; // ceil(payloadLen / blockSize)

  // Stream ID (plan.md §7.4, invariant I3)
  streamId: number;    // crc32(originalSize || filename)

  // Degree cap (D25)
  degreeCap: number;   // 64 (validated against K_MAX)

  // Block hash length
  blockHashLen: number;  // 4 bytes (CRC-32)

  // Flags
  flags: number;  // Compressed? | ResumeDisabled?
}
```

**Derivation logic:**

```typescript
function deriveSessionParams(
  file: File,
  staging: FileSystemFileHandle | null,
  compress: boolean
): SessionParams {
  const K = 768;  // Conservative default (D26)
  const L = 256;  // Immutable (I1)
  const blockSize = K * L;

  const payloadLen = staging
    ? staging.size  // Compressed size
    : file.size;    // Original size

  const blockCount = Math.ceil(payloadLen / blockSize);

  // Stream ID from file identity (I3)
  const streamId = crc32(
    Buffer.from(file.size.toString() + file.lastModified.toString())
  );

  // Flags: compression disables resume (bf-17s0)
  let flags = BeaconFlags.None;
  if (compress) {
    flags |= BeaconFlags.Compressed;
    flags |= BeaconFlags.ResumeDisabled;
  }

  return {
    K,
    L,
    blockSize,
    payloadLen,
    blockCount,
    streamId,
    degreeCap: 64,    // D25
    blockHashLen: 4,
    flags,
  };
}
```

**Key invariants:**
- **I1:** L (fragment length) is immutable per session
- **I3:** streamId derived from file identity, not random
- **D26:** K is conservative (assume weakest receiver)
- **D25:** Degree cap bounded to prevent encode explosion

### Phase 5: Beacon Metadata Creation

**Step 6: Create Beacon Metadata (D17, D21)**

Location: `src/core/frame/beacon.ts` (parser exists, encoder NOT implemented)

```typescript
async function createBeaconMeta(
  file: File,
  staging: FileSystemFileHandle | null,
  params: SessionParams
): Promise<BeaconMeta> {
  // Compute whole-file hash
  const source = staging || file;
  const stream = source.stream();
  const wholeFileHash = await hashSHA256(stream);

  // Compute manifest hash (CRC-32 of block hash manifest)
  // This requires computing all block hashes first
  const manifestHash = await computeManifestHash(file, params);

  return {
    streamId: params.streamId,
    wireVersion: 1,
    originalSize: file.size,  // UNCOMPRESSED
    payloadLen: params.payloadLen,  // May be compressed
    blockSize: params.blockSize,
    blockCount: params.blockCount,
    fragmentLen: params.L,
    degreeCap: params.degreeCap,
    flags: params.flags,
    blockHashLen: params.blockHashLen,
    wholeFileHash,  // 32 bytes
    manifestHash,   // 4 bytes
    filename: sanitizeFilename(file.name),
    mimeType: file.type || 'application/octet-stream',
  };
}
```

**Beacon metadata structure:**

```typescript
interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number;      // UNCOMPRESSED size
  payloadLen: number;        // Actual payload (after compression)
  blockSize: number;
  blockCount: number;
  fragmentLen: number;
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array;    // 32 bytes (SHA-256)
  manifestHash: Uint8Array;     // 4 bytes (CRC-32 of manifest)
  filename: string;
  mimeType: string;
}
```

**Manifest hash (plan.md §7.6):**
- CRC-32 of block hash manifest
- Chains beacon → manifest → blocks
- Detects manifest corruption

### Phase 6: Sender Session Creation

**Step 7: Initialize Sender Session State**

Location: NOT YET IMPLEMENTED

```typescript
async function createSenderSession(
  file: File,
  staging: FileSystemFileHandle | null,
  params: SessionParams,
  meta: BeaconMeta
): Promise<SendingState> {
  // State transition validation
  assertSendTransition('idle', 'sending');

  const sourceFingerprint = {
    size: file.size,
    lastModified: file.lastModified,
  };

  return {
    type: 'sending',
    source: file,
    staging: staging,
    streamId: params.streamId,
    blockSize: params.blockSize,
    blockCount: params.blockCount,
    fragmentLen: params.L,    // Readonly (I1)
    K: params.K,             // Readonly (D26)
    cursor: {
      blockIndex: 0,
      seq: 0,
    },
    dwellPackets: Math.floor(1.6 * params.K),  // 1.6× = 1229
    lastFrameEmitted: performance.now(),
    sourceFingerprint,
  };
}
```

**State transition validation (session-state-machine.md):**

```typescript
assertSendTransition('idle', 'sending')  // ✓ valid
```

### Phase 7: Frame Encoder Initialization

**Step 8: Initialize Frame Encoder**

Location: NOT YET IMPLEMENTED

**Frame encoder components:**

1. **Fountain encoder** (`src/core/fountain/encoder.ts` - EXISTS!)
   ```typescript
   const encoder = new LTEncoder({
     streamId: params.streamId,
     blockIndex: currentBlock,
     fragments: blockFragments,
     degreeCap: params.degreeCap,
   });
   ```

2. **Header encoder** (`src/core/frame/header.ts` - EXISTS!)
   ```typescript
   const header = encodeHeader({
     blockIndex,
     seq,
     flags: PacketFlags.Payload,
   });  // Returns 13 bytes
   ```

3. **PRNG** (`src/core/fountain/prng.ts` - EXISTS!)
   ```typescript
   const indices = deriveIndices(
     streamId,
     blockIndex,
     seq,
     K,
     degreeTable,
     scratch,
   );
   ```

4. **Modulation layer** (NOT YET IMPLEMENTED)
   - Stage 1: Tiled mono QR
   - Stage 2: + RGB tripling
   - Stage 3: Custom grid codec

**Worker thread pool (plan.md §6.2):**
- Frame encoder worker (off main thread)
- Pool size = navigator.hardwareConcurrency

### Phase 8: Display and Frame Loop

**Step 9: Start Display Frame Loop (D24)**

Location: NOT YET IMPLEMENTED

```typescript
async function runSenderLoop(state: SendingState): Promise<void> {
  const encoder = await initializeFrameEncoder(state);

  while (state.type === 'sending') {
    const frameStart = performance.now();

    // 1. Fetch current block
    const block = await fetchBlock(state.source, state.cursor.blockIndex, state.blockSize);

    // 2. Fountain encode block → K packets
    const packets = [];
    for (let seq = 0; seq < state.dwellPackets; seq++) {
      const packet = encoder.encodePacket(seq);
      packets.push(packet);
    }

    // 3. Modulate packets → frame
    const frame = encoder.encodeFrame(packets);

    // 4. Render to canvas
    renderFrame(frame);

    // 5. Every ~2 seconds: emit beacon tile (D17)
    if (shouldEmitBeacon()) {
      emitBeaconTile(meta);
    }

    // 6. Sleep to meet ≤½ camera fps target (D9)
    const frameTime = performance.now() - frameStart;
    const targetFps = 15;  // Conservative target
    const sleepTime = (1000 / targetFps) - frameTime;
    if (sleepTime > 0) {
      await sleep(sleepTime);
    }

    // 7. Advance cursor
    state.cursor.blockIndex++;
    if (state.cursor.blockIndex >= state.blockCount) {
      state.cursor.blockIndex = 0;  // Loop
    }

    state.lastFrameEmitted = performance.now();
  }
}
```

**Key invariants:**
- **D24:** Frames generated on-demand, never pre-rendered
- **D9:** Frame rate ≤½ measured receiver camera fps (45 fps max)
- **D17:** Beacons emitted every ~2 seconds at conservative profile (R1)
- **I7:** Ring buffer depth ≤ 3 frames

**Dwell calculation (plan.md §8.1):**
```
dwellPackets = 1.6 × K = 1.6 × 768 = 1229 packets

Why 1.6×:
- 1.0× would deliver K packets per block
- At 25% erasure, receiver needs 1.33× to reach rank K
- 1.6× provides safety margin for high loss scenarios
```

## Intended Sub-functions for Session Setup

### 1. Storage Preflight

```typescript
// src/platform/storage-preflight.ts (partial)
export async function checkStoragePreflight(fileSize: number): Promise<{
  sufficient: boolean;
  errorMessage?: string;
}>
```

**Purpose:** Validate enough storage exists for staging (if compression enabled)
**Browser margins:** Chrome/Edge 60%, Firefox 10%, Safari 1 GB

### 2. Compression Sampler

```typescript
// NOT YET IMPLEMENTED
export async function shouldCompress(file: File): Promise<boolean>

export async function createStagingFile(
  file: File,
  compress: boolean
): Promise<FileSystemFileHandle | null>
```

**Purpose:** Determine if compression is beneficial and create staging file
**Location:** Would be in `src/platform/compression.ts` (new file)

### 3. Session Parameter Derivation

```typescript
// NOT YET IMPLEMENTED
export function deriveSessionParams(
  file: File,
  staging: FileSystemFileHandle | null,
  compress: boolean
): SessionParams
```

**Purpose:** Calculate K, L, blockSize, blockCount, streamId, degreeCap, flags
**Location:** Would be in `src/platform/sender-session.ts` (new file)

### 4. Beacon Metadata Creation

```typescript
// NOT YET IMPLEMENTED (encoder side - parser exists)
export async function createBeaconMeta(
  file: File,
  staging: FileSystemFileHandle | null,
  params: SessionParams
): Promise<BeaconMeta>

export async function computeManifestHash(
  file: File,
  params: SessionParams
): Promise<Uint8Array>  // 4 bytes CRC-32
```

**Purpose:** Create beacon metadata with file hashes
**Location:** Would be in `src/core/frame/beacon.ts` (extend existing parser)

### 5. Sender Session Creation

```typescript
// NOT YET IMPLEMENTED
export async function createSenderSession(
  file: File,
  staging: FileSystemFileHandle | null,
  params: SessionParams,
  meta: BeaconMeta
): Promise<SendingState>
```

**Purpose:** Initialize sender session state
**Location:** Would be in `src/platform/sender-session.ts` (new file)

### 6. Frame Encoder Initialization

```typescript
// NOT YET IMPLEMENTED
export async function initializeFrameEncoder(
  state: SendingState
): Promise<FrameEncoder>
```

**Purpose:** Initialize fountain encoder, header encoder, PRNG, modulation layer
**Location:** Would be in `src/modulation/qr-tiled/encoder.ts` (new file)

### 7. Sender Frame Loop

```typescript
// NOT YET IMPLEMENTED
export async function runSenderLoop(state: SendingState): Promise<void>

async function fetchBlock(
  source: File,
  blockIndex: number,
  blockSize: number
): Promise<Uint8Array[]>

function shouldEmitBeacon(lastEmit: number): boolean
```

**Purpose:** Main sender loop generating frames on-demand
**Location:** Would be in `src/platform/sender-loop.ts` (new file)

### 8. Block Streaming

```typescript
// NOT YET IMPLEMENTED
export async function streamBlock(
  file: File,
  blockIndex: number,
  blockSize: number
): AsyncIterable<Uint8Array>
```

**Purpose:** Stream block fragments without materializing full block in memory
**Location:** Would be in `src/platform/block-stream.ts` (new file)

**Supports D20:** Stream both ends; never materialise the file

## Differences: Current vs Planned Implementation

| Component | Current State | Planned State |
|-----------|---------------|---------------|
| **App Initialization** | Health check + cleanup only | Full sender session setup |
| **Sender UI** | None | File picker, progress display, controls |
| **Sender Session State Machine** | Type definitions only | Full state machine implementation |
| **Storage Preflight** | Partial implementation | Complete with browser-specific margins |
| **Compression** | Not implemented | Sampling, staging, lifecycle management |
| **Session Parameters** | Not implemented | K, L, blockSize, streamId derivation |
| **Beacon Encoder** | Parser exists | Encoder with whole-file and manifest hashing |
| **Sender Session Creation** | Not implemented | IdleSenderState → SendingState transition |
| **Fountain Encoder** | EXISTS (LTEncoder) | Integrated into frame loop |
| **Header Encoder** | EXISTS (encodeHeader) | Integrated into packet generation |
| **PRNG** | EXISTS (deriveIndices) | Integrated into fountain encoder |
| **Modulation Layer** | Not implemented | Stage 1: tiled mono QR |
| **Frame Loop** | Not implemented | On-demand frame generation |
| **Frame Display** | Not implemented | Canvas rendering, profile mixing |
| **Block Streaming** | Not implemented | File.slice for large files |
| **State Persistence** | Not needed for sender | Stateless by design (D24) |

## Missing Implementation Summary

### Not Yet Implemented

1. **Sender UI**
   - File picker button
   - Progress display (sender doesn't know receiver progress, but can show emission state)
   - Cancel/stop controls

2. **Sender Session State Machine**
   - IdleSenderState → SendingState transition
   - SendingState → PausedSenderState (E8: tab backgrounded)
   - SendingState → StoppingState (user cancel)
   - State persistence (not needed for sender - stateless)

3. **Compression Pipeline**
   - Compressibility sampling
   - CompressionStream to OPFS
   - Staging file lifecycle management

4. **Fountain Encoder Integration**
   - Packet generation with PRNG-derived indices (LTEncoder exists!)
   - Degree sampling from ideal soliton distribution
   - XOR combination of fragments

5. **Frame Encoder**
   - Header encoding (encodeHeader exists!)
   - Packet queue → tile distribution
   - Modulation layer integration (Stage 1: tiled QR)

6. **Beacon Encoder**
   - Beacon packet generation
   - Beacon frame mixing (D17: replace some payload tiles)

7. **Frame Loop**
   - Block streaming (File.slice for large files)
   - Dwell counting
   - Beacon emission timing
   - Frame rate throttling (D9)

8. **Frame Display**
   - Canvas rendering
   - Profile mixing (D16: R1/R2/R3 within frame)
   - Camera frame rate measurement

## References

### Source Files

- `src/app.ts` - Application entry point (minimal)
- `src/platform/init.ts` - App initialization (health check + cleanup)
- `src/platform/storage-preflight.ts` - Storage pre-flight checks (partial)
- `src/core/session/types.ts` - Session state definitions (complete!)
- `src/core/frame/beacon.ts` - Beacon parsing/validation (parser only)
- `src/core/fountain/encoder.ts` - LT fountain encoder (complete!)
- `src/core/fountain/prng.ts` - Deterministic PRNG (complete!)
- `src/core/frame/header.ts` - Header encoding (complete!)
- `src/core/params.ts` - System constants (K, L, degree cap)

### Documentation

- `docs/plan/plan.md` - Complete application plan
- `docs/notes/session-state-machine.md` - State machine specification
- `docs/notes/bf-17s0-resume-compression-conflict.md` - Compression/resume conflict
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` - Solution evaluation
- `docs/notes/bf-2ygc-sender-initialization-flow.md` - Current app initialization trace

### Key Decisions

- **D19:** K = 768, L = 256 B (192 KB blocks)
- **D20:** Stream both ends (no full-file materialization)
- **D24:** Stateless sender (on-demand frame generation)
- **D26:** Sender assumes weakest receiver (conservative K)
- **D8:** Compress before blocking (with staging)
- **D22:** Resume supported only without compression
- **D17:** Beacons every ~2 seconds
- **D9:** Frame rate ≤½ camera fps

## Summary

The current implementation provides only basic app initialization (health checks and cleanup). The full sender initialization flow requires implementation of:

1. **Storage pre-flight** (partially implemented in `storage-preflight.ts`)
2. **File picker and compression pipeline**
3. **Sender session state machine**
4. **Fountain and frame encoders** (encoder exists, needs integration)
5. **Modulation layer (QR encoding)**
6. **Frame loop and display**

The architecture is well-defined in the plan and session state machine documents. The core fountain encoder (LTEncoder), header encoder, and PRNG are already implemented and ready for integration. The missing pieces are primarily the sender session orchestration, compression pipeline, frame loop, and modulation layer.

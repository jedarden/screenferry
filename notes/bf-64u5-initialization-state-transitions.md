# Initialization State Transitions

**Bead:** bf-64u5  
**Purpose:** Comprehensive flow diagram and step-by-step documentation of ScreenFerry initialization sequences and state transitions.

---

## Overview

ScreenFerry has two distinct initialization phases:

1. **Current App Initialization** (IMPLEMENTED) — Basic health checks and cleanup
2. **Sender Session Initialization** (PLANNED) — Full sender session setup and frame loop

This document maps all state transitions, async operations, and the relationship between current and planned initialization.

---

## Phase 0: Current App Initialization (IMPLEMENTED)

### State Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         APP INITIALIZATION                            │
│                          (Current State)                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  1. PAGE LOAD                                                        │
│     ├─ document.readyState === 'loading'                            │
│     ├─ Add DOMContentLoaded listener                                 │
│     └─ State: UNINITIALIZED                                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. DOM READY → main()                                              │
│     ├─ Remove loading listener if present                           │
│     ├─ Call main() directly if already loaded                        │
│     └─ State: INITIALIZING                                          │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  3. runAppInit() — ASYNC PARALLEL                                    │
│     Location: src/platform/init.ts                                   │
│                                                                      │
│     ├─ runHealthCheck({ skipSlow: true }) ────┐                    │
│     │  ├─ OPFS availability check               │                    │
│     │  ├─ Storage estimate check               │                    │
│     │  └─ Camera permission check               │                    │
│     │                                         │                    │
│     └─ runStartupCleanup(new Set()) ──────────┘                    │
│        ├─ Scan for orphaned receiver outputs                         │
│        ├─ Remove orphaned files from OPFS                           │
│        └─ Return cleanup count                                      │
│                                                                      │
│     State: INITIALIZING (async operations in flight)                │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  4. INITIALIZATION COMPLETE                                          │
│     ├─ healthCheckPassed: boolean                                    │
│     ├─ orphanedOutputsCleaned: number                               │
│     ├─ errors: string[]                                              │
│     └─ State: READY                                                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  5. UI UPDATE                                                        │
│     ├─ Display "Application initialized successfully"                │
│     ├─ Show initResult JSON                                          │
│     ├─ Add version footer (bf-13h)                                   │
│     └─ State: READY (UI rendered)                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### State Definitions (Current Implementation)

| State | Description | Entry | Exit |
|-------|-------------|-------|------|
| **UNINITIALIZED** | Page loading, DOM not ready | Page load starts | DOM fires `DOMContentLoaded` |
| **INITIALIZING** | Running health checks and cleanup | `main()` called | `runAppInit()` completes |
| **READY** | App initialized, waiting for user action | Health checks pass | User selects sender/receiver role |

### Async Operations (Current)

| Operation | Location | Trigger | Completion Signal |
|-----------|----------|---------|-------------------|
| **DOM Ready** | Browser | Page load | `DOMContentLoaded` event |
| **Health Check** | `src/platform/health-check.ts` | `runAppInit()` | Promise resolution |
| **Startup Cleanup** | `src/platform/storage.ts` | `runAppInit()` | Promise resolution |
| **UI Render** | `src/app.ts` | `runAppInit()` completes | DOM updated |

### Callback Flow (Current)

```typescript
// Entry point: src/app.ts
async function main(): Promise<void> {
  const app = document.getElementById('app');
  
  // ASYNC: Start initialization
  const initResult = await runAppInit();  // ← Parallel health + cleanup
  
  // ASYNC: UI update (microtask)
  app.innerHTML = `...`;  // ← DOM manipulation
  
  console.log('ScreenFerry initialized:', initResult);  // ← Logging
}

// Event-driven startup
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);  // ← Callback
} else {
  main();  // ← Direct call
}
```

---

## Phase 1: Sender Session Initialization (PLANNED)

### State Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SENDER SESSION INITIALIZATION                    │
│                          (Planned Future)                            │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  STATE: IDLE                                                         │
│  ├─ No file selected                                                │
│  ├─ No active session                                               │
│  └─ UI: Shows "Send file" button                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
                    USER CLICKS "SEND FILE"
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER                                         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 1: STORAGE PREFLIGHT CHECK (bf-4d6)                   │   │
│  │ Location: src/platform/storage-preflight.ts                 │   │
│  │                                                              │   │
│  │ checkStoragePreflight(file.size)                           │   │
│  │ ├─ navigator.storage.estimate()                           │   │
│  │ ├─ Calculate staging overhead (file size × 1.1)           │   │
│  │ ├─ Apply safety margin (browser-specific)                 │   │
│  │ └─ Return: sufficient? {yes, no} + error message          │   │
│  │                                                              │   │
│  │ IF insufficient:                                            │   │
│  │ └─ Show error, remain in IDLE                              │   │
│  │ ELSE:                                                       │   │
│  │ └─ Proceed to STEP 2                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 2: FILE SELECTION                                        │   │
│  │ Input type="file" → File object                              │   │
│  │                                                              │   │
│  │ File fingerprint for E5 (source changed detection):         │   │
│  │ ├─ file.size                                                │   │
│  │ └─ file.lastModified                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 3: COMPRESSION SAMPLING (D8)                           │   │
│  │ Location: (not yet implemented)                             │   │
│  │                                                              │   │
│  │ Sample first 1 MB to detect compressibility:                │   │
│  │ ├─ Read sample chunk                                        │   │
│  │ ├─ CompressionStream compress                               │   │
│  │ └─ If ratio < 0.9 → enable compression                     │   │
│  │                                                              │   │
│  │ Decision factors:                                            │   │
│  │ ├─ Skip if already compressed (magic bytes)                │   │
│  │ ├─ Skip if file < 10 MB (overhead not worth it)            │   │
│  │ └─ User setting (if provided)                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 4: COMPRESSION STAGING (D8)                            │   │
│  │ Location: (not yet implemented)                             │   │
│  │                                                              │   │
│  │ IF compression enabled:                                     │   │
│  │ ├─ Open OPFS file (staging)                                  │   │
│  │ ├─ stream = file.stream()                                   │   │
│  │ ├─ compressedStream = stream.pipeThrough(                   │   │
│  │ │     new CompressionStream('gzip')                         │   │
│  │ │   )                                                       │   │
│  │ ├─ Write to OPFS staging                                     │   │
│  │ └─ Set staging: FileSystemFileHandle                       │   │
│  │                                                              │   │
│  │ ELSE (no compression):                                       │   │
│  │ └─ Set staging: null                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 5: DERIVE SESSION PARAMETERS                          │   │
│  │ Location: (not yet implemented)                             │   │
│  │                                                              │   │
│  │ 1. Block size (K × L):                                       │   │
│  │    K = 768 (default, D26)                                   │   │
│  │    L = 256 bytes (I1, fixed)                                │   │
│  │    blockSize = K × L = 192 KB                               │   │
│  │                                                              │   │
│  │ 2. Block count:                                              │   │
│  │    payloadLen = staging?.size \|\| file.size                 │   │
│  │    blockCount = ceil(payloadLen / blockSize)                │   │
│  │                                                              │   │
│  │ 3. streamId (plan.md §7.4, invariant I3):                    │   │
│  │    streamId = crc32(originalSize \|\| filename)              │   │
│  │    Uses original UNCOMPRESSED size                           │   │
│  │                                                              │   │
│  │ 4. Degree cap (D25):                                          │   │
│  │    degreeCap = 64 (validated against K_MAX)                 │   │
│  │                                                              │   │
│  │ 5. Block hash length:                                         │   │
│  │    blockHashLen = 4 bytes (CRC-32)                           │   │
│  │                                                              │   │
│  │ 6. Flags:                                                    │   │
│  │    IF compression enabled:                                    │   │
│  │      flags = BeaconFlags.Compressed \|                       │   │
│  │              BeaconFlags.ResumeDisabled                       │   │
│  │    ELSE:                                                      │   │
│  │      flags = BeaconFlags.None                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 6: CREATE BEACON METADATA (D17, D21)                   │   │
│  │ Location: src/core/frame/beacon.ts                           │   │
│  │                                                              │   │
│  │ Compute whole-file hash:                                     │   │
│  │ ├─ stream = (staging \|\| file).stream()                    │   │
│  │ ├─ Hash through crypto.subtle.digest('SHA-256')            │   │
│  │ └─ 32 bytes → wholeFileHash                                  │   │
│  │                                                              │   │
│  │ BeaconMeta object:                                           │   │
│  │ ├─ streamId: number                                          │   │
│  │ ├─ wireVersion: 1                                            │   │
│  │ ├─ originalSize: number (UNCOMPRESSED)                        │   │
│  │ ├─ payloadLen: number (compressed size if enabled)            │   │
│  │ ├─ blockSize: number (192 KB)                                 │   │
│  │ ├─ blockCount: number                                        │   │
│  │ ├─ fragmentLen: 256 (L)                                      │   │
│  │ ├─ degreeCap: 64                                             │   │
│  │ ├─ flags: Compressed? | ResumeDisabled?                      │   │
│  │ ├─ blockHashLen: 4                                           │   │
│  │ ├─ wholeFileHash: Uint8Array(32)                             │   │
│  │ ├─ manifestHash: Uint8Array(4)                               │   │
│  │ ├─ filename: string                                          │   │
│  │ └─ mimeType: string                                           │   │
│  │                                                              │   │
│  │ Encode beacon:                                                │   │
│  │ └─ beaconBytes = encodeBeacon(meta)                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 7: INITIALIZE SENDER SESSION STATE                     │   │
│  │ Location: (not yet implemented)                             │   │
│  │ From: IdleSenderState                                         │   │
│  │ To: SendingState                                              │   │
│  │                                                              │   │
│  │ SendingState object:                                         │   │
│  │ ├─ type: 'sending'                                           │   │
│  │ ├─ source: File (original file reference)                    │   │
│  │ ├─ staging: FileSystemFileHandle \| null                    │   │
│  │ ├─ streamId: number                                          │   │
│  │ ├─ blockSize: 192 × 1024 (bytes)                             │   │
│  │ ├─ blockCount: number                                        │   │
│  │ ├─ fragmentLen: 256 (L, readonly)                            │   │
│  │ ├─ K: 768 (readonly, D26)                                    │   │
│  │ ├─ cursor: {                                                 │   │
│  │ │    blockIndex: 0,                                          │   │
│  │ │    seq: 0                                                  │   │
│  │ │  }                                                        │   │
│  │ ├─ dwellPackets: 1.6 × K = 1229                              │   │
│  │ ├─ lastFrameEmitted: timestamp                               │   │
│  │ └─ sourceFingerprint: {                                      │   │
│  │       size: file.size,                                       │   │
│  │       lastModified: file.lastModified                         │   │
│  │     }                                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 8: INITIALIZE FRAME ENCODER                            │   │
│  │ Location: (not yet implemented)                             │   │
│  │ From: plan.md §6.3.1                                         │   │
│  │                                                              │   │
│  │ Frame encoder components:                                    │   │
│  │ ├─ Fountain encoder (src/core/fountain/encoder.ts)          │   │
│  │ │  └─ encodePacket(block, seq, degree) → packet            │   │
│  │ ├─ Header encoder (src/core/frame/header.ts)                 │   │
│  │ │  └─ encodeHeader(header) → 13 bytes                       │   │
│  │ ├─ PRNG (src/core/fountain/prng.ts)                         │   │
│  │ │  └─ deriveIndices(streamId, blockIndex, seq, K)          │   │
│  │ └─ Modulation layer (Stage 1: tiled mono QR)                │   │
│  │     └─ encodeFrame(packets[]) → ImageData                    │   │
│  │                                                              │   │
│  │ Worker thread pool (plan.md §6.2):                            │   │
│  │ └─ Frame encoder worker (off main thread)                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: INITIALIZING_SENDER (cont.)                                  │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ STEP 9: START DISPLAY FRAME LOOP (D24)                      │   │
│  │ Location: (not yet implemented)                             │   │
│  │ From: plan.md §6.3.1                                         │   │
│  │                                                              │   │
│  │ Frame loop (requestAnimationFrame):                          │   │
│  │ WHILE state.type === 'sending':                              │   │
│  │   ├─ Generate frame N on-demand (no pre-rendering)          │   │
│  │   ├─ Fetch current block: File.slice(...)                   │   │
│  │   ├─ fountainEncode(block) → K packets                       │   │
│  │   ├─ For dwell = 1.6 × K packets:                            │   │
│  │   │  ├─ encodeHeader(blockIndex, seq)                       │   │
│  │   │  ├─ fountainEncode(seq) → packet                        │   │
│  │   │  └─ Queue packet for frame encoding                      │   │
│  │   ├─ modulation.encodeFrame(packets[]) → ImageData            │   │
│  │   ├─ Render to canvas                                         │   │
│  │   ├─ Every ~2 seconds: emit beacon tile (D17)                │   │
│  │   ├─ Sleep to meet ≤½ camera fps target (D9)                │   │
│  │   └─ Advance cursor:                                         │   │
│  │        cursor.blockIndex++                                    │   │
│  │        if cursor.blockIndex >= blockCount:                    │   │
│  │          cursor.blockIndex = 0 (loop)                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  STATE: SENDING                                                      │
│  ├─ Frame loop running at ≤½ measured camera fps (D9)              │
│  ├─ Blocks emitted cyclically with dwell (§8.1)                      │
│  ├─ Beacons emitted every ~2 seconds (D17)                          │
│  ├─ Stateless sender: frame N generated on-demand (D24)            │
│  └─ UI: Shows sending progress                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### State Definitions (Planned Sender)

| State | Description | Entry | Exit |
|-------|-------------|-------|------|
| **IDLE** | No file selected, no session | App initialization | User selects file |
| **INITIALIZING_SENDER** | Running pre-flight checks and setup | File selected | All steps complete |
| **SENDING** | Frame loop running, blocks emitting | Session init complete | User stops/error |
| **PAUSED** | Tab backgrounded, frame loop suspended | Visibility API | Tab foregrounded |
| **REPAIR_MODE** | Sending only missing blocks | Repair code entered | Repair complete |
| **STOPPING** | Graceful shutdown, cleanup | User cancel/error | Cleanup complete |
| **IDLE** (return) | Back to ready state | Cleanup complete | — |

### Async Operations (Planned Sender)

| Operation | Location | Trigger | Completion Signal |
|-----------|----------|---------|-------------------|
| **Storage Preflight** | `src/platform/storage-preflight.ts` | File selected | Promise resolution |
| **Compression Sampling** | (not implemented) | File selected | Sampling complete |
| **Compression Staging** | (not implemented) | Compression enabled | OPFS write complete |
| **Whole-file Hash** | `src/core/frame/beacon.ts` | Session setup | `crypto.subtle.digest()` |
| **Frame Encoding** | Worker thread | Frame loop | `postMessage()` |
| **Frame Rendering** | `requestAnimationFrame` | Frame loop | Frame displayed |
| **Beacon Emission** | Frame loop | Every ~2 seconds | Beacon tile rendered |

### Callback Flow (Planned Sender)

```typescript
// Entry point: user action
async function startSender(file: File): Promise<void> {
  // ASYNC: Storage pre-flight check
  const preflight = await checkStoragePreflight(file.size);
  if (!preflight.sufficient) {
    showError(preflight.error);
    return;  // Remain in IDLE
  }
  
  // ASYNC: Compression decision and staging (if enabled)
  const compression = await sampleCompressibility(file);
  const staging = compression.enabled 
    ? await compressToOPFS(file) 
    : null;
  
  // SYNC: Derive session parameters
  const params = deriveSessionParams(file, staging);
  
  // ASYNC: Compute whole-file hash
  const wholeFileHash = await computeWholeFileHash(staging || file);
  
  // SYNC: Create beacon metadata
  const beaconMeta = createBeaconMeta(params, wholeFileHash);
  
  // SYNC: Initialize sender state
  const senderState: SendingState = {
    type: 'sending',
    source: file,
    staging,
    streamId: params.streamId,
    // ... other fields
  };
  
  // ASYNC: Start frame loop (rAF-driven)
  startFrameLoop(senderState);
}

// Frame loop callback
function frameLoop(): void {
  if (senderState.type !== 'sending') return;
  
  // ASYNC: Generate frame on-demand
  const frame = generateFrame(senderState);
  
  // ASYNC: Render frame
  renderFrame(frame);
  
  // CONTINUE: Request next frame
  requestAnimationFrame(frameLoop);
}
```

---

## State Transition Matrix

### Combined Application State Machine

```
┌─────────────────────────────────────────────────────────────────────┐
│                      COMBINED STATE MACHINE                          │
│                   (Current + Planned Sender)                         │
└─────────────────────────────────────────────────────────────────────┘

                    ┌──────────────┐
                    │   UNINITIALIZED│
                    └───────┬───────┘
                            │ DOM ready
                            ↓
                    ┌──────────────┐
                    │  INITIALIZING │
                    └───────┬───────┘
                            │ runAppInit() complete
                            ↓
                    ┌──────────────┐
                    │     READY     │
                    └───────┬───────┘
                            │ User selects role
                ┌───────────┴───────────┐
                ↓                       ↓
    ┌───────────────────┐     ┌─────────────────┐
    │ SENDER_INIT_READY │     │ RECEIVER_IDLE   │
    └─────────┬─────────┘     └────────┬────────┘
              │                       │ User starts camera
              │ File selected         ↓
              ↓               ┌─────────────────┐
    ┌───────────────────┐   │   ACQUIRING     │
    │ INITIALIZING_SENDER│   └────────┬────────┘
    └─────────┬─────────┘            │ First beacon
              │                      ↓
              │              ┌─────────────────┐
              │              │   RECEIVING     │
              │              └────────┬────────┘
              │                       │ Complete
              ↓                       ↓
    ┌───────────────────┐     ┌─────────────────┐
    │     SENDING       │     │   VERIFYING     │
    └─────────┬─────────┘     └────────┬────────┘
              │                       │ Verified
              ↓                       ↓
    ┌───────────────────┐     ┌─────────────────┐
    │ PAUSED (optional) │     │    COMPLETE     │
    └─────────┬─────────┘     └─────────────────┘
              │
    ┌─────────┴─────────┐
    ↓                   ↓
┌─────────────┐  ┌──────────────┐
│  STOPPING   │  │  REPAIR_MODE  │
└──────┬──────┘  └───────┬───────┘
       │                 │
       └─────────┬───────┘
                 ↓
          ┌──────────────┐
          │     IDLE     │
          └──────────────┘
```

### State Transitions Summary

| From State | To State | Trigger | Async? |
|---|---|---|---|---|
| UNINITIALIZED | INITIALIZING | DOM ready | No |
| INITIALIZING | READY | `runAppInit()` complete | Yes |
| READY | SENDER_INIT_READY | User selects sender role | No |
| READY | RECEIVER_IDLE | User selects receiver role | No |
| SENDER_INIT_READY | INITIALIZING_SENDER | File selected | No |
| INITIALIZING_SENDER | SENDING | All init steps complete | Yes |
| SENDING | PAUSED | Tab backgrounded | No |
| PAUSED | SENDING | Tab foregrounded | No |
| SENDING | REPAIR_MODE | Repair code entered | No |
| REPAIR_MODE | SENDING | Repair complete | No |
| SENDING | STOPPING | User cancel/error | No |
| STOPPING | IDLE | Cleanup complete | Yes |
| RECEIVER_IDLE | ACQUIRING | Camera starts | Yes |
| ACQUIRING | RECEIVING | First beacon | No |
| RECEIVING | VERIFYING | All blocks collected | Yes |
| VERIFYING | COMPLETE | All verified | Yes |
| RECEIVING | PAUSED | Camera lost | No |
| PAUSED | RECEIVING | Camera re-acquired | Yes |

---

## Key Invariants and Constraints

### App Initialization (Current)

1. **DOM First**: No operations before DOM is ready
2. **Parallel Health**: Health checks and cleanup run concurrently
3. **Non-blocking**: Initialization doesn't block UI rendering
4. **Error Tolerant**: Health check failures don't prevent app start

### Sender Initialization (Planned)

1. **I1 (Immutable L)**: Fragment length L is immutable per session
2. **I3 (Deterministic streamId)**: streamId derived from file identity, not random
3. **D26 (Conservative K)**: K = 768, assumes weakest receiver
4. **D25 (Degree Cap)**: Bounded to prevent encode explosion
5. **D24 (On-demand Frames)**: No pre-rendering, frame N generated when needed
6. **D9 (Frame Rate Limit)**: ≤½ measured receiver camera fps
7. **D17 (Beacon Frequency)**: Every ~2 seconds at conservative profile
8. **I7 (Ring Buffer)**: Depth ≤ 3 frames

### Privacy and Cleanup

1. **T4a (Staging Wipe)**: Staging files wiped on complete/cancel/startup
2. **E11 (Startup Cleanup)**: Orphaned receiver outputs cleaned on init
3. **D22 (Resume Disabled with Compression)**: Compression = no resume support

---

## Implementation Status

### ✅ Currently Implemented

- [x] Basic app initialization (`runAppInit`)
- [x] Health checks (OPFS, storage, camera)
- [x] Startup cleanup (orphaned receiver outputs)
- [x] Version footer display
- [x] Session state machine specification

### 🚧 Not Yet Implemented

- [ ] Sender UI (file picker, progress display)
- [ ] Storage pre-flight check (`checkStoragePreflight`)
- [ ] Compression sampling and staging
- [ ] Session parameter derivation
- [ ] Beacon metadata creation
- [ ] Sender session state (IdleSenderState → SendingState)
- [ ] Frame encoder initialization
- [ ] Fountain encoder
- [ ] PRNG for index derivation
- [ ] Modulation layer (QR encoding)
- [ ] Frame loop (requestAnimationFrame-driven)
- [ ] Beacon emission timing
- [ ] Frame rate throttling
- [ ] Canvas rendering

---

## References

### Documentation
- `docs/plan/plan.md` — Complete application plan
- `docs/notes/session-state-machine.md` — State machine specification
- `docs/notes/bf-17s0-resume-compression-conflict.md` — Compression/resume conflict
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` — Solution evaluation
- `docs/notes/bf-2ygc-sender-initialization-flow.md` — Sender initialization flow (memory)

### Source Files
- `src/app.ts` — Application entry point
- `src/platform/init.ts` — App initialization
- `src/platform/storage-preflight.ts` — Storage pre-flight checks (partial)
- `src/core/session/types.ts` — Session state definitions

### Key Decisions
- **D8**: Compress before blocking (with staging)
- **D9**: Frame rate ≤½ camera fps
- **D17**: Beacons every ~2 seconds
- **D19**: K = 768, L = 256 B (192 KB blocks)
- **D22**: Resume supported only without compression
- **D24**: Stateless sender (on-demand frame generation)
- **D25**: Degree cap bounded
- **D26**: Conservative K (weakest receiver)
- **D27**: Thermal duty-cycle (pause when fps drops)

---

## Summary

ScreenFerry initialization occurs in two distinct phases:

**Phase 0 (Current)**: Basic app initialization handles health checks and cleanup in parallel, transitioning from UNINITIALIZED → INITIALIZING → READY. This phase is fully implemented and provides the foundation for all future work.

**Phase 1 (Planned)**: Sender session initialization involves 9 sequential steps (storage pre-flight → file selection → compression sampling → compression staging → parameter derivation → beacon creation → session state init → frame encoder init → frame loop start), transitioning from IDLE → INITIALIZING_SENDER → SENDING. This phase is specified but not yet implemented.

The state machine is designed to handle multiple error conditions (E5-E16) and edge cases, with explicit states for PAUSED, REPAIR_MODE, STOPPING, and various error states. All async operations are clearly identified, and the architecture supports both compressed (no resume) and uncompressed (resume supported) transfer modes.

**Next Steps**: Implement the planned sender initialization phases, starting with storage pre-flight checks and progressing through the frame loop setup.

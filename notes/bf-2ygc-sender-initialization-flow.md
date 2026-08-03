# Sender Initialization Flow Documentation

**Task:** Trace and document the complete sender initialization flow  
**Bead:** bf-2ygc  
**Date:** 2026-08-02

## Executive Summary

ScreenFerry is currently at **Phase 1** (core codec built) but sender initialization logic is **not yet implemented**. This document traces both the current initialization flow and the planned sender session initialization based on the architecture and type definitions.

**Current Status:**
- ✅ Core codec implemented (22 tests green)
- ✅ Sender session types defined (`core/session/types.ts`)
- ✅ Storage preflight checks implemented (`platform/storage-preflight.ts`)
- ❌ Actual sender session initialization NOT implemented
- ❌ File selection and validation NOT implemented
- ❌ Sender state machine NOT implemented

**Planned Phase:** Sender initialization would be part of **Phase 2** (Single-QR optical loop — the walking skeleton)

---

## Part 1: Current Application Initialization Flow

### Entry Point

**File:** `index.html` → `src/app.ts`

```html
<!-- index.html -->
<script type="module" src="/src/app.ts"></script>
```

**File:** `src/app.ts`

```typescript
async function main(): Promise<void> {
  const app = document.getElementById('app');
  
  // Run initialization
  const initResult = await runAppInit();
  
  // Update UI with version footer
  app.innerHTML = `...${initResult}...`;
}

// Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
```

### Initialization Sequence

**File:** `src/platform/init.ts` → `runAppInit()`

```
1. runAppInit() called
   │
   ├─→ Parallel execution:
   │   ├─→ runHealthCheck({ skipSlow: true })
   │   │   └─→ Checks OPFS, storage, camera capabilities
   │   │
   │   └─→ runStartupCleanup(new Set())
   │       └─→ Removes orphaned receiver outputs
   │
   ├─→ Collect results
   │   ├─→ healthCheckPassed: boolean
   │   ├─→ orphanedOutputsCleaned: number
   │   └─→ errors: string[]
   │
   └─→ Return InitResult
```

**Current Return Value:**
```typescript
{
  healthCheckPassed: boolean,
  orphanedOutputsCleaned: number,
  errors: string[]
}
```

**What's Missing:** No sender session creation, no file selection, no sender state machine.

---

## Part 2: Planned Sender Session Initialization

### Sender State Machine

**File:** `src/core/session/types.ts`

The sender has 5 defined states:

```typescript
type SendSessionState =
  | IdleSenderState        // No session
  | SendingState          // Normal transmission
  | PausedSenderState     // Tab backgrounded (E8)
  | RepairModeState       // Sending only missing blocks
  | StoppingState;        // Graceful shutdown
```

### SendingState Structure

```typescript
interface SendingState {
  type: 'sending';
  source: File;                        // Source file to transmit
  staging: FileSystemFileHandle;      // OPFS staging for compression
  streamId: number;                    // Unique session identifier
  blockSize: number;                   // Block size in bytes
  blockCount: number;                  // Total blocks in file
  readonly fragmentLen: number;        // L = 256 bytes (D15, I1)
  readonly K: number;                  // Fragments per block (default 768)
  cursor: {
    blockIndex: number;                // Current block position
    seq: number;                       // Packet sequence number
  };
  dwellPackets: number;                // Dwell: packets per block
  lastFrameEmitted: number;            // Timestamp of last frame
  sourceFingerprint: {
    size: number;                      // File size for resume detection
    lastModified: number;              // File mtime for resume detection
  };
}
```

### Valid State Transitions

```typescript
const VALID_SEND_TRANSITIONS = {
  'idle':        → ['sending'],
  'sending':     → ['paused', 'repair-mode', 'stopping'],
  'paused':      → ['sending'],
  'repair-mode': → ['sending', 'stopping'],
  'stopping':    → ['idle']
};
```

---

## Part 3: Planned Sender Initialization Flow

### Complete Initialization Sequence

```
USER ACTION: Select "Send" role in UI
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. STORAGE PREFLIGHT (before file picker)                    │
│    File: platform/storage-preflight.ts                      │
│                                                              │
│    ├─→ navigator.storage.estimate()                        │
│    ├─→ Calculate: required = fileSize × 1.1 (staging)      │
│    ├─→ Apply safety margin (20-50% browser-specific)       │
│    ├─→ Check: available >= required + margin               │
│    └─→ Return: StoragePreflightResult                      │
│         { sufficient, available, required, error }           │
└─────────────────────────────────────────────────────────────┘
   │
   │ IF insufficient → Show error: "Not enough storage..."
   │ ELSE → Continue
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. FILE SELECTION                                            │
│    UI: File picker input (<input type="file">)               │
│                                                              │
│    ├─→ User selects file                                    │
│    ├─→ File object created                                  │
│    ├─→ Validate: file.size > 0 (reject zero-byte E1)         │
│    ├─→ Validate: file.size <= 100 GB (or platform cap)       │
│    └─→ Pass file to sender initialization                  │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. SESSION PARAMETER CALCULATION                             │
│    Files: core/params.ts, core/block/partition.ts           │
│                                                              │
│    ├─→ Calculate blockCount = ceil(file.size / BLOCK_SIZE) │
│    ├─→ Set fragmentLen = L = 256 (D15, I1)                 │
│    ├─→ Set K = validateK(768) (D26)                        │
│    ├─→ Set dwellPackets = 1.6 × K (§8.1)                   │
│    └─→ Initialize cursor = { blockIndex: 0, seq: 0 }       │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. STREAM ID GENERATION                                      │
│    File: core/hash/stream-id.ts (NOT YET IMPLEMENTED)       │
│                                                              │
│    ├─→ Generate streamId from file content hash            │
│    ├─→ OR: Generate random streamId                        │
│    └─→ streamId is used for resume detection (E18)         │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. BEACON METADATA CONSTRUCTION                              │
│    File: core/frame/beacon.ts (NOT YET IMPLEMENTED)         │
│                                                              │
│    ├─→ Create BeaconMeta:                                   │
│    │   ├─→ streamId: number                                 │
│    │   ├─→ wireVersion: 1                                   │
│    │   ├─→ originalSize: file.size                         │
│    │   ├─→ payloadLen: compressed size or file.size         │
│    │   ├─→ blockSize: BLOCK_SIZE                            │
│    │   ├─→ blockCount: calculated above                    │
│    │   ├─→ fragmentLen: 256                                 │
│    │   ├─→ degreeCap: calculated (D25)                     │
│    │   ├─→ flags: compression/resume flags                 │
│    │   ├─→ blockHashLen: hash length                        │
│    │   ├─→ wholeFileHash: file hash                        │
│    │   ├─→ manifestHash: CRC-32 of block hash manifest     │
│    │   ├─→ filename: file.name                             │
│    │   └─→ mimeType: file.type or 'application/octet-stream'│
│    └─→ Beacon is encoded as special packets (PacketFlags.Beacon)│
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. SOURCE FINGERPRINTING (for resume detection)            │
│                                                              │
│    ├─→ Capture file.size                                    │
│    ├─→ Capture file.lastModified                           │
│    └─→ Store in sourceFingerprint                          │
│         Used for E18: "Resume offered for file the user     │
│         no longer has"                                       │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. MODULATION LAYER INITIALIZATION                           │
│    File: modulation/types.ts (interface only)                │
│                                                              │
│    ├─→ Select modulation implementation:                    │
│    │   ├─→ Stage 1: QR tiled (src/modulation/qr-tiled/)    │
│    │   ├─→ Stage 2: RGB tripling (planned)                  │
│    │   └─→ Stage 3: Custom codec (planned)                  │
│    │                                                         │
│    ├─→ Configure profile mix (D16):                         │
│    │   └─→ Fixed weights for Phase 3:                     │
│    │       ├─→ R1 (conservative v10-L): 15%                │
│    │       ├─→ R2 (nominal v15-L): 60%                     │
│    │       └─→ R3 (aggressive v20-L): 25%                   │
│    │                                                         │
│    ├─→ Set totalPacketsPerFrame                             │
│    ├─→ Set fragmentLen = 256                                │
│    └─→ Initialize encodeFrame() function                   │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. STATE TRANSITION: idle → sending                         │
│    File: core/session/types.ts                             │
│                                                              │
│    ├─→ Validate transition: isValidSendTransition('idle', 'sending')│
│    ├─→ Create SendingState object:                         │
│    │   {                                                     │
│    │     type: 'sending',                                   │
│    │     source: File,                                     │
│    │     staging: FileSystemFileHandle | null,             │
│    │     streamId: number,                                │
│    │     blockSize: number,                                │
│    │     blockCount: number,                              │
│    │     fragmentLen: 256,                                │
│    │     K: number,                                        │
│    │     cursor: { blockIndex: 0, seq: 0 },               │
│    │     dwellPackets: number,                             │
│    │     lastFrameEmitted: 0,                              │
│    │     sourceFingerprint: { size, lastModified }        │
│    │   }                                                    │
│    └─→ Update global sender state                           │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. FRAME ENCODER WORKER SPAWN                                │
│    Plan.md §6.2: "worker generator → ring buffer → rAF"     │
│                                                              │
│    ├─→ Spawn Web Worker for frame generation                │
│    ├─→ Set up ring buffer (depth 3, per I7)                 │
│    ├─→ Initialize fountain encoder (core/fountain/encoder.ts)│
│    ├─→ Initialize modulation encoder                        │
│    └─→ Start rAF (requestAnimationFrame) loop              │
└─────────────────────────────────────────────────────────────┘
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. TRANSMISSION START                                       │
│     Sender now in 'sending' state, emitting frames           │
│                                                              │
│     ├─→ Generate fountain-coded packets                    │
│     ├─→ Encode packets into QR tiles (modulation layer)    │
│     ├─→ Mix beacon packets into frames (D17)                │
│     ├─→ Emit frames via rAF to display                      │
│     └─→ Update cursor: blockIndex, seq                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 4: Key Sub-Functions Called During Initialization

### Storage Preflight
**File:** `platform/storage-preflight.ts`

```typescript
async function checkStoragePreflight(fileSize: number): Promise<StoragePreflightResult>
```

- Checks `navigator.storage.estimate()`
- Applies browser-specific safety margins
- Returns `{ sufficient, available, required, error }`

### Block Partition Calculation
**File:** `core/block/partition.ts`

```typescript
function calculateBlockCount(fileSize: number, blockSize: number): number
```

- Returns `ceil(fileSize / blockSize)`
- Determines how many blocks the file will be split into

### K Validation
**File:** `core/params.ts`

```typescript
function validateK(k: number, l: number = 256): number
```

- Ensures K ≤ K_MAX (2048) to maintain I6a's 1 MB working set constraint
- Throws if K would exceed memory limit
- Default K = 768 (conservative for all receivers)

### PRNG Seeding
**File:** `core/fountain/prng.ts`

```typescript
function seedPrng(streamId: number, blockIndex: number, seq: number): void
```

- Seeds deterministic PRNG for index derivation (D7)
- Enables stateless sender: frame N generates without replaying 1..N-1

### Beacon Encoding
**File:** `core/frame/beacon.ts` (NOT YET IMPLEMENTED)

```typescript
function encodeBeacon(meta: BeaconMeta): Uint8Array[]
```

- Encodes beacon metadata into special packets
- Packets marked with `PacketFlags.Beacon`
- Mixed into regular frames by frame mixer (D17)

### State Transition Validation
**File:** `core/session/types.ts`

```typescript
function isValidSendTransition(from: string, to: string): boolean
function assertSendTransition(from: string, to: string): void
```

- Validates state machine transitions
- Throws on invalid transitions

---

## Part 5: Order of Operations

### Initialization Order

1. **App Init** (current)
   - Health checks
   - Startup cleanup
   - Returns: `{ healthCheckPassed, orphanedOutputsCleaned, errors }`

2. **User Role Selection** (planned)
   - User selects "Send" or "Receive"
   - UI shows sender interface

3. **Storage Preflight** (planned)
   - Check quota before file picker
   - Refuse if insufficient space (D19)

4. **File Selection** (planned)
   - User picks file via `<input type="file">`
   - Validate file size, zero-byte check (E1)

5. **Session Setup** (planned)
   - Calculate parameters (blockSize, K, dwell)
   - Generate streamId
   - Create beacon metadata
   - Initialize modulation layer

6. **State Transition** (planned)
   - `idle` → `sending`
   - Create `SendingState` object

7. **Transmission Start** (planned)
   - Spawn frame encoder worker
   - Start rAF loop
   - Begin emitting frames

### What Gets Initialized First

1. **App-level:** Health checks, cleanup
2. **Storage-level:** Quota estimation, preflight
3. **File-level:** File object, validation
4. **Session-level:** Parameters, streamId, beacon
5. **State-level:** SendingState creation
6. **Worker-level:** Frame encoder, modulation
7. **Transmission-level:** rAF loop, packet emission

---

## Part 6: Missing Implementation

The following components are defined but **NOT YET IMPLEMENTED**:

### Core Components
- ❌ `core/frame/beacon.ts` — Beacon packet encoding
- ❌ `core/frame/repair-code.ts` — Repair code generation
- ❌ `core/hash/block-hash.ts` — Block hash calculation
- ❌ `core/hash/stream-id.ts` — Stream ID generation
- ❌ `core/hash/whole-file-hash.ts` — Whole file hash
- ❌ `core/block/schedule.ts` — Block transmission scheduling

### Sender Session Logic
- ❌ File selection handler
- ❌ Sender state machine implementation
- ❌ `idle` → `sending` transition logic
- ❌ Frame encoder worker
- ❌ rAF display loop
- ❌ Beacon packet injection into frames

### UI Components
- ❌ Sender/receiver role selection
- ❌ File picker interface
- ❌ Sender status display
- ❌ Progress tracking UI

### Integration Points
- ❌ Connection between app.ts and sender session
- ❌ Error handling for sender-side failures
- ❌ Resume detection (E18)
- ❌ Compression staging (if enabled)

---

## Part 7: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                        │
│  Role Selection → File Picker → Status Display → Progress   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      SENDER SESSION LAYER                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  State Machine: idle → sending → paused → stopping  │   │
│  │  (core/session/types.ts)                            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  SendingState stores:                                        │
│  • source: File                                              │
│  • streamId, blockSize, blockCount, K, fragmentLen          │
│  • cursor: { blockIndex, seq }                               │
│  • dwellPackets, lastFrameEmitted                            │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
┌──────────────────┐  ┌──────────────┐  ┌─────────────────┐
│ STORAGE LAYER   │  │ BEACON LAYER │  │ BLOCK LAYER     │
│ (storage-pref)  │  │ (beacon.ts)  │  │ (partition.ts)  │
│                 │  │              │  │                 │
│ • Quota check   │  │ • Metadata   │  │ • blockSize     │
│ • Safety margin │  │ • streamId   │  │ • blockCount    │
│ • Estimate API  │  │ • wholeHash  │  │ • K calculation │
└──────────────────┘  └──────────────┘  └─────────────────┘
                                                    │
                                                    ▼
                                      ┌─────────────────────────┐
                                      │  FOUNTAIN CODE LAYER     │
                                      │  (fountain/encoder.ts)   │
                                      │                         │
                                      │  • PRNG (D7)             │
                                      │  • Degree cap (D25)      │
                                      │  • Packet generation     │
                                      └─────────────┬───────────┘
                                                    │
                                                    ▼
                                      ┌─────────────────────────┐
                                      │  MODULATION LAYER       │
                                      │  (modulation/types.ts)  │
                                      │                         │
                                      │  • Profile mix (D16)     │
                                      │  • QR encode (Stage 1)   │
                                      │  • RGB tripling (Stage 2)│
                                      │  • Custom codec (Stage 3)│
                                      └─────────────┬───────────┘
                                                    │
                                                    ▼
                                      ┌─────────────────────────┐
                                      │  FRAME WORKER LAYER     │
                                      │  (worker → ring buffer) │
                                      │                         │
                                      │  • Frame encoder        │
                                      │  • Beacon mixer (D17)   │
                                      │  • rAF display loop      │
                                      └─────────────────────────┘
```

---

## Part 8: Summary

### What Exists Now
1. ✅ App initialization (`app.ts` → `runAppInit()`)
2. ✅ Health checks and cleanup
3. ✅ Sender session type definitions
4. ✅ Storage preflight logic
5. ✅ Core codec (fountain encode/decode)
6. ✅ PRNG for index derivation
7. ✅ Parameter validation (K, block size)

### What's Missing
1. ❌ File selection and validation
2. ❌ Sender state machine implementation
3. ❌ `idle` → `sending` transition
4. ❌ Beacon encoding
5. ❌ Frame encoder worker
6. ❌ Modulation layer implementation
7. ❌ rAF display loop
8. ❌ UI for sender role

### Implementation Status
- **Current Phase:** Phase 1 (Core codec, headless) — built but exit criteria NOT met
- **Next Phase:** Phase 2 (Single-QR optical loop) — would include sender initialization
- **Blockers:** Multiple core components not yet written (beacon, hash, block scheduling)

### Key Design Principles
1. **D20:** Stream both ends — never materialize full file in memory
2. **D24:** Sender is stateless — frame N generates without replaying 1..N-1
3. **D26:** Sender assumes weaker receiver — K is conservative
4. **D19:** Gate file picker on storage quota
5. **E18:** Resume detection via source fingerprint

---

## References

- **Plan:** `docs/plan/plan.md` — Complete application plan
- **Session Types:** `src/core/session/types.ts` — Sender/receiver state definitions
- **Storage Preflight:** `src/platform/storage-preflight.ts` — Quota checking
- **Params:** `src/core/params.ts` — K, L, BLOCK_SIZE constants
- **Phase Status:** `docs/plan/plan.md` §17 — What's implemented vs planned

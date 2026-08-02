# Session State Machine Specification

**Purpose:** Define all session states and transitions explicitly, replacing the nullable field approach (`streamId: number|null`, `meta: BeaconMeta|null`) that produces forgotten-transition bugs.

**References:** plan.md §7.3, §7.6, §8.3, D22, D27, edge cases E8-E10, E12, E16

---

## Receiver Session State Machine

### States Overview

The receiver has **10 primary states** grouped into three lifecycle phases:

```
┌─────────────────────────────────────────────────────────────────┐
│ ACQUISITION PHASE                                               │
│  ┌─────────┐     ┌────────────┐     ┌──────────────┐            │
│  │ IDLE    │───▶  │ ACQUIRING  │───▶  │ RECEIVING    │            │
│  └─────────┘     └────────────┘     └──────────────┘            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ COMPLETION PHASE                                               │
│  ┌──────────────┐     ┌─────────────┐     ┌───────────┐        │
│  │ RECEIVING    │───▶  │ VERIFYING   │───▶  │ COMPLETE  │        │
│  └──────────────┘     └─────────────┘     └───────────┘        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ RECOVERY & ERROR PHASE                                         │
│  ┌──────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │ PAUSED       │     │ REPAIR_WAITING   │     │ QUOTA_...   │ │
│  │              │◀───▶  │                  │     │ EXHAUSTED   │ │
│  └──────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                  │
│  ┌──────────────────────────────┐                               │
│  │ DECOMPRESS_FAILED            │                               │
│  └──────────────────────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
```

### Detailed State Specifications

#### 1. IDLE
**Entry:** App initialization, session reset, or after export
**Exit:** User starts camera (`getUserMedia`)

**Characteristics:**
- No session state persisted
- No camera active
- UI: Shows "Start receiving" or role selection

**Invariants:**
- `streamId === null`
- `meta === null`
- `complete === new Uint8Array(0)` (empty bitmap)

---

#### 2. ACQUIRING
**Entry:** Camera started (`getUserMedia` success)
**Exit:** First valid beacon received

**Characteristics:**
- Camera active, frame loop running
- Headers being decoded, but filtered by `streamId === null`
- UI: Shows "acquiring..." with live frame feedback
- Stalls detected: optical diagnostics (`E-NO-SIGNAL`, `E-TOO-FAR`, etc.)

**State fields:**
```ts
type AcquiringState = {
  type: 'acquiring',
  startTime: number,        // when camera started
  frameCount: number,        // for stall detection
  lastPacketTime: number,    // for optical stall detector
}
```

**Transitions:**
- **→ RECEIVING**: Valid beacon arrives, `streamId` locked, `meta` parsed
- **→ PAUSED**: Camera permission revoked (E9) or camera track ends
- **→ IDLE**: User cancels, camera error

**Invariants:**
- No packet routing occurs (no `streamId` to lock onto)
- Beacon validation is **strict** (T1 bounds checking)

---

#### 3. RECEIVING
**Entry:** First beacon parsed and accepted
**Exit:** All blocks collected (bitmap all 1s)

**Characteristics:**
- Normal operation: collecting blocks
- GE decoder active on one block at a time (I5)
- OPFS writes occur per completed block
- UI: Progress bar, ETA, current rate

**State fields:**
```ts
type ReceivingState = {
  type: 'receiving',
  streamId: number,                    // locked, never changes
  meta: BeaconMeta,                    // immutable after beacon
  complete: Uint8Array,               // block bitmap
  active: {                           // current block being decoded
    blockIndex: number,
    pivots: Map<number, GERow>,
    rank: number
  } | null,                           // null = between blocks
  out: FileSystemWritableFileStream,
  manifest: BlockHashManifest | null,  // from §7.6
  stats: {
    fps: number,
    cameraPxPerModule: number,
    packetsPerSec: number,
    eta: number,
    dutyCycle: number,               // D27: 0.0–1.0
  }
}
```

**Transitions:**
- **→ VERIFYING**: `bitmap.allSet()` && `manifest !== null`
- **→ PAUSED**: Camera lost (E9), tab backgrounded, or thermal duty-cycle (D27)
- **→ QUOTA_EXHAUSTED**: OPFS write fails (E10)
- **→ DECOMPRESS_FAILED**: Decompression error after all blocks verified (E15)
- **→ RECEIVING (self)**: Block hash fail (E12) → clear bitmap bit, re-collect

**Sub-transitions within RECEIVING:**
- **Block completion**: `rank === K` → verify hash → write OPFS → set bitmap bit → free matrix
- **Block hash failure** (E12): Discard block, clear bitmap bit, restart collection
- **Worker crash** (E16): Restart worker, discard only the active block, preserve bitmap

**Invariants:**
- `streamId` is **immutable** once locked (A9: wrong stream rejected)
- `meta` is **immutable** (gates all decode parameters)
- Exactly one block GE-active at a time (I5)
- Block writes to OPFS are **atomic** (hash verification first)

---

#### 4. VERIFYING
**Entry:** All blocks collected, manifest stream decoded
**Exit:** All blocks verified against manifest hashes

**Characteristics:**
- All blocks technically received, but retroactively verified
- UI: Shows "verifying..." (not "complete" yet)
- Occurs when manifest (blockIndex = 0xFFFFFF) decodes

**State fields:**
```ts
type VerifyingState = {
  type: 'verifying',
  streamId: number,
  meta: BeaconMeta,
  complete: Uint8Array,              // bitmap: all blocks marked received
  out: FileSystemWritableFileStream,
  manifest: BlockHashManifest,       // now decoded
  verificationProgress: {
    verified: number,
    total: number,
    failedBlocks: number[]          // blocks that failed hash
  }
}
```

**Transitions:**
- **→ COMPLETE**: All blocks verified successfully
- **→ RECEIVING**: Some blocks failed hash → clear those bits, re-collect (E12 extended)
- **→ DECOMPRESS_FAILED**: All blocks verified, but decompression fails (E15)

**Invariants:**
- No OPFS writes occur during verification
- Blocks are re-verified, not trusted (D22: resume MUST re-verify)

---

#### 5. COMPLETE
**Entry:** All blocks verified and (if compressed) decompressed
**Exit:** User exports file or app closes

**Characteristics:**
- File ready for export
- UI: Shows "Complete" with export/share button

**State fields:**
```ts
type CompleteState = {
  type: 'complete',
  streamId: number,
  meta: BeaconMeta,
  outputPath: string,                // OPFS file path
  outputSize: number,
  verified: boolean,
  compressed: boolean
}
```

**Transitions:**
- **→ IDLE**: Export successful, session cleared

**Invariants:**
- File exists in OPFS
- Whole-file hash (if present) has been validated

---

#### 6. PAUSED
**Entry:** Camera lost, tab backgrounded, or thermal duty-cycle
**Exit:** Camera re-acquired, user resumes, or transfer abandoned

**Characteristics:**
- Session state preserved (bitmap, meta)
- Camera may be off or frame loop suspended
- UI: Shows "Paused" with resume option

**State fields:**
```ts
type PausedState = {
  type: 'paused',
  previousState: ReceivingState,    // frozen state
  pauseReason: 'camera-lost' | 'tab-backgrounded' | 'thermal',
  pauseTime: number
}
```

**Transitions:**
- **→ RECEIVING**: Camera re-acquired (user grants permission again)
- **→ RECEIVING**: Tab foregrounded again (E8)
- **→ IDLE**: User abandons transfer

**Invariants:**
- `bitmap` is preserved (no blocks lost)
- `meta` and `streamId` unchanged
- **No new packets are decoded** but progress is retained

---

#### 7. REPAIR_WAITING
**Entry:** User invoked repair code flow (some blocks missing)
**Exit:** Valid repair code entered

**Characteristics:**
- Transfer incomplete but user has chosen repair path
- UI: Shows repair code input field

**State fields:**
```ts
type RepairWaitingState = {
  type: 'repair-waiting',
  streamId: number,
  meta: BeaconMeta,
  complete: Uint8Array,              // partial bitmap
  missingBlocks: number[],          // derived from bitmap
  repairCode: string | null
}
```

**Transitions:**
- **→ REPAIR_TRANSFERRING**: Valid repair code entered
- **→ RECEIVING**: User cancels repair, returns to normal collection

**Invariants:**
- Bitmap is **not modified** during repair wait

---

#### 8. REPAIR_TRANSFERRING
**Entry:** Valid repair code parsed
**Exit:** All missing blocks received

**Characteristics:**
- Sender is transmitting only the missing blocks
- Receiver is in a special mode expecting only those blocks
- UI: Shows repair progress

**State fields:**
```ts
type RepairTransferringState = {
  type: 'repair-transferring',
  streamId: number,
  meta: BeaconMeta,
  complete: Uint8Array,
  expectedBlocks: Set<number>,       // only these blocks accepted
  receivedCount: number
}
```

**Transitions:**
- **→ VERIFYING**: All expected blocks received
- **→ REPAIR_WAITING**: Some blocks still missing after timeout

**Invariants:**
- **Only packets in the expected set are accepted**
- Other packets are logged but discarded (E-FOREIGN-STREAM)

---

#### 9. QUOTA_EXHAUSTED
**Entry:** OPFS quota check fails during RECEIVING (E10)
**Exit:** Partial file exported or user clears space

**Characteristics:**
- Transfer cannot continue
- Partial file is kept (follows T4b lifecycle)
- UI: Shows quota exhausted with partial export option

**State fields:**
```ts
type QuotaExhaustedState = {
  type: 'quota-exhausted',
  streamId: number,
  meta: BeaconMeta,
  complete: Uint8Array,              // partial bitmap
  partialOutputPath: string,
  missingBlocks: number[]
}
```

**Transitions:**
- **→ IDLE**: Partial file exported, session ends

**Invariants:**
- **No silent truncation** (E10)
- User is warned before keeping partial artefact
- Partial file follows T4b deletion lifecycle

---

#### 10. DECOMPRESS_FAILED
**Entry:** All blocks verified, but decompression fails (E15)
**Exit:** User handles failure or keeps raw artefact

**Characteristics:**
- Blocks verified, but gzip stream invalid
- Compressed artefact is kept
- UI: Shows decompression failed, keeps raw data

**State fields:**
```ts
type DecompressFailedState = {
  type: 'decompress-failed',
  streamId: number,
  meta: BeaconMeta,
  compressedOutputPath: string,
  error: string
}
```

**Transitions:**
- **→ IDLE**: User acknowledges, raw artefact kept

**Invariants:**
- Raw (compressed) artefact is preserved
- Follows T4b deletion lifecycle
- No data is lost

---

### Receiver State Transitions Summary

| From State | To State | Trigger | Action |
|---|---|---|---|
| IDLE | ACQUIRING | User starts camera | `getUserMedia()` |
| ACQUIRING | RECEIVING | First valid beacon | Lock streamId, parse meta |
| ACQUIRING | PAUSED | Camera lost | Preserve state, await re-grant |
| ACQUIRING | IDLE | User cancels / error | Release camera |
| RECEIVING | VERIFYING | All blocks collected, manifest decoded | Begin hash verification |
| RECEIVING | PAUSED | Camera lost / thermal | Preserve state |
| RECEIVING | QUOTA_EXHAUSTED | OPFS quota exhausted (E10) | Stop, export partial |
| RECEIVING | RECEIVING | Block hash fail (E12) | Clear bitmap bit, re-collect |
| RECEIVING | RECEIVING | Worker crash (E16) | Restart worker, discard active block |
| VERIFYING | COMPLETE | All blocks verified | Prepare export |
| VERIFYING | RECEIVING | Some blocks failed hash | Clear failed bits, re-collect |
| VERIFYING | DECOMPRESS_FAILED | Decompression error (E15) | Keep compressed artefact |
| PAUSED | RECEIVING | Camera re-acquired / foregrounded | Resume with preserved state |
| PAUSED | IDLE | User abandons | Clear session |
| REPAIR_WAITING | REPAIR_TRANSFERRING | Valid repair code entered | Accept only expected blocks |
| REPAIR_TRANSFERRING | VERIFYING | All expected blocks received | Verify and complete |
| QUOTA_EXHAUSTED | IDLE | Partial export complete | Clear session, warn user |
| DECOMPRESS_FAILED | IDLE | User acknowledges | Keep artefact, clear session |

---

## Sender Session State Machine

### States Overview

The sender has **6 primary states**:

```
┌──────────────────────────────────────────────────────────┐
│  ┌─────────┐     ┌──────────┐     ┌─────────────┐      │
│  │ IDLE    │───▶  │ SENDING  │───▶  │ PAUSED      │      │
│  └─────────┘     └──────────┘     └─────────────┘      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  ┌─────────────┐     ┌──────────────┐     ┌─────────┐  │
│  │ REPAIR_MODE │───▶  │ STOPPING     │───▶  │ IDLE    │  │
│  └─────────────┘     └──────────────┘     └─────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Detailed State Specifications

#### 1. IDLE
**Entry:** App initialization, transfer complete, or cancel
**Exit:** User selects file and starts sending

**Characteristics:**
- No file selected
- No active session
- UI: Shows "Send file" button

**State fields:**
```ts
type IdleState = {
  type: 'idle'
}
```

---

#### 2. SENDING
**Entry:** File selected, compression (if enabled) complete, first frame rendered
**Exit:** User stops, tab backgrounded, or file change detected

**Characteristics:**
- Frame loop running at ≤½ measured camera fps (D9)
- Blocks emitted cyclically with dwell (§8.1)
- Beacons emitted every ~2 seconds (D17)
- Stateless sender: frame N generated on-demand without replaying 1…N−1 (D24)

**State fields:**
```ts
type SendingState = {
  type: 'sending',
  source: File,
  staging: FileSystemFileHandle | null,  // compressed copy (D8), wiped on complete
  streamId: number,                      // derived §7.4
  blockSize: number,                   // 192 KB
  blockCount: number,
  readonly fragmentLen: number,         // L (I1: immutable)
  readonly K: number,                   // D26
  cursor: {
    blockIndex: number,
    seq: number                         // within block
  },
  dwellPackets: number,                 // §8.1: 1.6K default
  lastFrameEmitted: number,
  sourceFingerprint: {
    size: number,
    lastModified: number
  }
}
```

**Transitions:**
- **→ PAUSED**: Tab backgrounded (E8, visibilitychange)
- **→ REPAIR_MODE**: User enters repair code from receiver
- **→ STOPPING**: User cancels, file changed (E5), or staging error
- **→ SENDING (self)**: Source file change detected (E5) → abort with E-SOURCE-CHANGED

**Sub-transitions within SENDING:**
- **Frame loop**: Generate frame → render → sleep to meet fps target → repeat
- **Beacon emission**: Every ~2 seconds, emit beacon at conservative profile
- **Source change detection** (E5): Re-check `file.size` and `lastModified` before each block read

**Invariants:**
- `L` is **immutable** (I1)
- Frames are generated on-demand, never pre-rendered (I7)
- Ring buffer depth ≤ 3 (I7)

---

#### 3. PAUSED
**Entry:** Tab backgrounded (E8)
**Exit:** Tab foregrounded

**Characteristics:**
- `rAF` stopped, frame loop suspended
- State preserved
- UI: Shows "Sending paused — keep this tab visible" (E-BACKGROUNDED)

**State fields:**
```ts
type PausedSenderState = {
  type: 'paused',
  previousState: SendingState,
  pauseTime: number
}
```

**Transitions:**
- **→ SENDING**: Tab foregrounded (visibilitychange)

**Invariants:**
- State unchanged, can resume seamlessly
- **Wake Lock does not cover background tabs** (E8), so pause is necessary

---

#### 4. REPAIR_MODE
**Entry:** User enters repair code from receiver
**Exit:** Missing blocks sent

**Characteristics:**
- Sender transmits **only** the blocks specified in repair code
- Normal dwell and beacons still apply
- UI: Shows repair progress

**State fields:**
```ts
type RepairModeState = {
  type: 'repair-mode',
  baseState: SendingState,
  targetBlocks: Set<number>,           // only these blocks emitted
  emittedCount: number,
  totalTarget: number
}
```

**Transitions:**
- **→ SENDING**: Repair complete, return to normal loop
- **→ STOPPING**: User cancels

**Invariants:**
- **Only blocks in target set are emitted**
- Other block indices are skipped in the loop

---

#### 5. STOPPING
**Entry:** User cancels or error condition
**Exit:** Cleanup complete, back to IDLE

**Characteristics:**
- Graceful shutdown: wipe staging file (D8, T4a)
- Frame loop stopped
- Resources released

**State fields:**
```ts
type StoppingState = {
  type: 'stopping',
  reason: 'user-cancel' | 'source-changed' | 'error',
  previousState: SendingState | RepairModeState
}
```

**Transitions:**
- **→ IDLE**: Cleanup complete

**Actions:**
- Wipe staging file (D8, T4a, E11)
- Close file handles
- Release camera/render resources

---

#### 6. COMPLETE
**Note:** The sender has **no COMPLETE state**. The sender cannot know when the receiver is done (no back-channel). The sender loops forever until explicitly stopped.

---

### Sender State Transitions Summary

| From State | To State | Trigger | Action |
|---|---|---|---|
| IDLE | SENDING | User selects file, starts send | Compress (if enabled), derive streamId, start frame loop |
| SENDING | PAUSED | Tab backgrounded (E8) | Stop frame loop, preserve state |
| SENDING | REPAIR_MODE | Repair code entered | Restrict emission to target blocks |
| SENDING | STOPPING | User cancel / source changed (E5) | Begin graceful shutdown |
| SENDING | SENDING | Source change detected (E5) | Abort with E-SOURCE-CHANGED |
| PAUSED | SENDING | Tab foregrounded | Resume frame loop |
| REPAIR_MODE | SENDING | Repair complete | Return to normal loop |
| REPAIR_MODE | STOPPING | User cancel | Begin shutdown |
| STOPPING | IDLE | Cleanup complete | Wipe staging, release resources |

---

## Implementation Guidelines

### Replacing Nullable Fields

**Current problematic pattern (plan.md §7.3):**
```ts
type RecvSession = {
  streamId: number | null;      // ❌nullable
  meta: BeaconMeta | null;      // ❌nullable
  // ...
}
```

**Replacement: Explicit states**
```ts
type RecvSessionState =
  | IdleState
  | AcquiringState
  | ReceivingState
  | VerifyingState
  | CompleteState
  | PausedState
  | RepairWaitingState
  | RepairTransferringState
  | QuotaExhaustedState
  | DecompressFailedState;

// Each state has exact fields, no nulls
type ReceivingState = {
  type: 'receiving';
  streamId: number;           // ✅always present in this state
  meta: BeaconMeta;           // ✅always present in this state
  // ...
};
```

### State Machine Enforcement

**Use TypeScript discriminated unions:**
```ts
function handlePacket(state: RecvSessionState, packet: Packet): RecvSessionState {
  switch (state.type) {
    case 'acquiring':
      // Can't route packets yet
      return state;
    case 'receiving':
      // Normal packet routing
      return routePacket(state, packet);
    case 'repair-transferring':
      // Only accept expected blocks
      if (state.expectedBlocks.has(packet.blockIndex)) {
        return handleRepairPacket(state, packet);
      }
      return state;
    // ...
  }
}
```

**Transition validation:**
```ts
function transition(from: RecvSessionState, to: RecvSessionState): RecvSessionState {
  // Assert transition is valid
  assertValidTransition(from.type, to.type);

  // Run exit/entry actions
  runExitActions(from);
  const result = runEntryActions(to);
  return result;
}
```

### State Persistence

**Resume token (D22):**
```ts
interface ResumeToken {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;         // bitmap
  timestamp: number;
}

// Only PAUSED and COMPLETE states can be persisted for resume
function canResume(state: RecvSessionState): boolean {
  return state.type === 'paused' || state.type === 'complete';
}
```

### Testing Requirements

**Unit tests:**
- Every state transition must be tested
- Invalid transitions must throw
- State serialization/deserialization for resume

**Integration tests:**
- Full session lifecycle (IDLE → COMPLETE)
- All error recovery paths (PAUSED → RECEIVING, E12 re-collect, etc.)
- Resume flow (D22)

**Property tests:**
- No forgotten transitions (all nullable field paths covered)
- State machine is total (no undefined states)

---

## Open Questions & Future Work

1. **D27 duty-cycle integration**: How exactly does duty-cycle trigger PAUSED state?
   - Proposal: `fps < 0.7 * baselineFps` for > 10s → transition to PAUSED
   - Requires baseline fps measurement at session start

2. **Resume with compression**: D22 + D8 conflict
   - Current spec: Resume disabled when compression enabled
   - Future: Deterministic compression to enable resume

3. **Multi-session framing**: D27 mentions "multi-GB as multi-session"
   - How does session state span multiple browser sessions?
   - Requires persistent OPFS + explicit session handoff

---

## Appendix: Edge Case Mapping

| Edge Case | State Impact | Primary State(s) |
|---|---|---|
| E8: Tab backgrounded (sender) | PAUSED | PAUSED (sender) |
| E9: Camera lost (receiver) | PAUSED | PAUSED (receiver) |
| E10: OPFS quota exhausted | QUOTA_EXHAUSTED | QUOTA_EXHAUSTED |
| E12: Block hash fail | Re-collect block | RECEIVING (self-transition) |
| E16: Worker crash | Restart worker, discard active block | RECEIVING (sub-transition) |
| E5: Source changed | Abort with error | STOPPING (sender) |
| E15: Decompression failed | Keep compressed artefact | DECOMPRESS_FAILED |
| D22: Resume | Restore from PAUSED | PAUSED ↔ RECEIVING |
| D27: Duty-cycle | Pause for thermal | PAUSED (thermal) |
| §7.6: Manifest verification | VERIFYING state | VERIFYING |
| §8.3: Resume re-verify | VERIFYING on resume | VERIFYING (from PAUSED) |

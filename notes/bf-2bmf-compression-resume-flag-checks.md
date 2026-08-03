# Compression and Resume Flag Checks in Initialization Flow

## Overview

This document traces the exact locations where compression and resume flags are first checked in the ScreenFerry initialization flow, based on bead bf-2bmf.

## Key Findings

### Compression Flag Checks

#### 1. Sender Side - Flag Setting (STEP 5: Session Parameter Derivation)

**Location:** Not yet implemented (planned location per docs/notes/bf-2ygc-sender-initialization-flow.md)

**File:** (To be implemented) `src/core/session/sender-init.ts`

**Function:** (To be implemented) Session parameter derivation

**Line:** (Not yet written)

**Code Pattern:**
```typescript
// STEP 5: Derive Session Parameters
// From: docs/notes/bf-2ygc-sender-initialization-flow.md STEP 5
let flags = BeaconFlags.None;
if (compressionEnabled) {
  flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
}
```

**Timing:** This happens AFTER compression sampling (STEP 3) and BEFORE beacon metadata creation (STEP 6).

**State Mutation Impact:** This is a READ-ONLY check that determines flag values. No state mutations occur at this point.

#### 2. Beacon Encoding (STEP 6: Beacon Metadata Creation)

**Location:** `src/core/frame/beacon.ts:592-711`

**Function:** `encodeBeacon(meta: BeaconMeta): Uint8Array`

**Line:** 684 - `writeU8(meta.flags);`

**Documentation Reference:** Lines 17-31, 572-587

**Code:**
```typescript
// Line 684 in encodeBeacon()
writeU8(meta.flags);  // Writes the flags byte to beacon
```

**Timing:** This happens during beacon metadata creation (STEP 6), AFTER session parameter derivation.

**State Mutation Impact:** No state mutations - this is pure serialization of already-determined flags.

### Resume Flag Checks

#### 1. Receiver Side - Beacon Parsing (First Point of Entry)

**Location:** `src/core/frame/beacon.ts:166-461`

**Function:** `parseBeacon(bytes: Uint8Array, localKMax: number, availableQuota: number, deviceContext?: DeviceContext): BeaconMeta`

**Line:** 249 - `const flags = readU8();`

**Code:**
```typescript
// Line 249 in parseBeacon()
const flags = readU8();  // Reads flags from beacon (STEP 2: Read all fields)
```

**Timing:** This happens during beacon parsing (STEP 2), BEFORE any validation or state mutations.

**State Mutation Impact:** READ-ONLY operation. No state mutations occur at this point.

#### 2. Receiver Side - Resume Disable Check (First Decision Point)

**Location:** `src/core/frame/beacon.ts:562-564`

**Function:** `isResumeDisabled(flags: number): boolean`

**Line:** 563 - `return (flags & BeaconFlags.ResumeDisabled) !== 0;`

**Documentation Reference:** Lines 532-561

**Code:**
```typescript
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.ResumeDisabled) !== 0;
}
```

**Timing:** This is called IMMEDIATELY after beacon parsing, BEFORE any receiver state is created.

**State Mutation Impact:** READ-ONLY operation. Returns boolean without side effects.

#### 3. Receiver Side - Resume Capability Check (State Creation Decision)

**Location:** `src/core/session/types.ts:417-429`

**Function:** `canResumeRecv(state: RecvSessionState): boolean`

**Line:** 424 - `if (isResumeDisabled(meta.flags))`

**Code:**
```typescript
export function canResumeRecv(state: RecvSessionState): boolean {
  if (state.type !== 'paused' && state.type !== 'complete') {
    return false;
  }

  // Check beacon flags for resume disabled
  const meta = state.type === 'paused' ? state.previousState.meta : state.meta;
  if (isResumeDisabled(meta.flags)) {
    return false;
  }

  return true;
}
```

**Timing:** Called during:
- Receiver state transition decisions
- Resume token creation
- State restoration validation

**State Mutation Impact:** READ-ONLY operation. No mutations.

#### 4. Receiver Side - Resume Token Creation (Persistence Decision)

**Location:** `src/core/session/types.ts:823-860`

**Function:** `createResumeToken(state: RecvSessionState): ResumeToken | null`

**Line:** 830 - `if (isResumeDisabled(meta.flags))`

**Code:**
```typescript
export function createResumeToken(state: RecvSessionState): ResumeToken | null {
  if (!canResumeRecv(state)) {
    return null;
  }

  // Check beacon flags for resume disabled (e.g., when compression is enabled)
  const meta = state.type === 'paused' ? state.previousState.meta : state.meta;
  if (isResumeDisabled(meta.flags)) {
    // Do NOT persist resume state when compression is enabled
    // This prevents silent corruption from non-deterministic compression
    return null;
  }
  // ... rest of function
}
```

**Timing:** Called when receiver enters PAUSED or COMPLETE state.

**State Mutation Impact:** This is a DECISION POINT that prevents state persistence (resume token creation) when compression is enabled.

## Initialization Flow Timeline

### Sender Side (Planned Implementation)

```
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: Compression Sampling (D8)                         │
│  Location: Not yet implemented                              │
│  Decision: Enable compression?                              │
│  Impact: Determines flag values later                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 5: Derive Session Parameters                         │
│  Location: Not yet implemented                              │
│  Decision: Set flags based on compression decision        │
│  Code: if (compressionEnabled) {                           │
│          flags = BeaconFlags.Compressed |                  │
│                  BeaconFlags.ResumeDisabled;               │
│        }                                                    │
│  Impact: READ-ONLY check → flag assignment                 │
│  State Mutations: NONE at this point                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 6: Create Beacon Metadata (D17, D21)                │
│  Location: src/core/frame/beacon.ts:592-711               │
│  Function: encodeBeacon()                                  │
│  Line: 684 - writeU8(meta.flags)                           │
│  Impact: Serializes flags to beacon                        │
│  State Mutations: NONE (pure serialization)                │
└─────────────────────────────────────────────────────────────┘
```

### Receiver Side (Implemented)

```
┌─────────────────────────────────────────────────────────────┐
│  Beacon Received from Camera                               │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 1: Parse Beacon                                       │
│  Location: src/core/frame/beacon.ts:166-461               │
│  Function: parseBeacon()                                   │
│  Line: 249 - const flags = readU8()                        │
│  Impact: READ flags from beacon                            │
│  State Mutations: NONE (pure parsing)                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 2: Check Resume Disabled                             │
│  Location: src/core/frame/beacon.ts:562-564               │
│  Function: isResumeDisabled(flags)                         │
│  Line: 563 - return (flags & BeaconFlags.ResumeDisabled)   │
│  Impact: Returns boolean decision                          │
│  State Mutations: NONE (pure function)                     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 3: State Transition Decision                         │
│  Location: src/core/session/types.ts:417-429               │
│  Function: canResumeRecv(state)                             │
│  Line: 424 - if (isResumeDisabled(meta.flags))             │
│  Impact: Determines if resume UI shown                     │
│  State Mutations: NONE (decision function)                  │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│  STEP 4: Resume Token Creation (if PAUSED/COMPLETE)       │
│  Location: src/core/session/types.ts:823-860              │
│  Function: createResumeToken(state)                         │
│  Line: 830 - if (isResumeDisabled(meta.flags))             │
│  Impact: Returns null if compression enabled               │
│  State Mutations: PREVENTS persistence (no token created)   │
└─────────────────────────────────────────────────────────────┘
```

## Summary Table

| Flag | First Check Location | Function | Line | Timing | State Mutations |
|------|---------------------|----------|------|--------|-----------------|
| **Compression (Sender)** | Not yet implemented | (To be created) | TBD | STEP 5 (after sampling) | NONE (READ-ONLY) |
| **Compression (Serialization)** | `src/core/frame/beacon.ts` | `encodeBeacon()` | 684 | STEP 6 | NONE (serialization) |
| **Resume (Receiver)** | `src/core/frame/beacon.ts` | `parseBeacon()` | 249 | Beacon parsing | NONE (READ-ONLY) |
| **Resume (Decision)** | `src/core/frame/beacon.ts` | `isResumeDisabled()` | 563 | After parsing | NONE (pure function) |
| **Resume (State Decision)** | `src/core/session/types.ts` | `canResumeRecv()` | 424 | State transitions | NONE (decision) |
| **Resume (Persistence)** | `src/core/session/types.ts` | `createResumeToken()` | 830 | Token creation | PREVENTS persistence |

## Key Insight

**All flag checks happen BEFORE any state mutations:**

1. **Sender side:** Compression decision is made during parameter derivation (STEP 5), which is a READ-ONLY operation that determines flag values. No state mutations occur.

2. **Receiver side:** Resume flag is checked during beacon parsing (STEP 1) and subsequent decision points (isResumeDisabled, canResumeRecv, createResumeToken). All are READ-ONLY operations that occur BEFORE receiver state is persisted.

3. **The critical interaction:** When `createResumeToken()` detects compression is enabled (line 830), it returns `null`, which PREVENTS state persistence. This is the FIRST point where flag checking has a behavioral impact (preventing resume token creation).

## References

- **Initialization flow:** docs/notes/bf-2ygc-sender-initialization-flow.md
- **Beacon parsing:** src/core/frame/beacon.ts:166-461 (parseBeacon)
- **Beacon encoding:** src/core/frame/beacon.ts:592-711 (encodeBeacon)
- **Resume check:** src/core/frame/beacon.ts:562-564 (isResumeDisabled)
- **Resume capability:** src/core/session/types.ts:417-429 (canResumeRecv)
- **Resume token:** src/core/session/types.ts:823-860 (createResumeToken)
- **Compression/resume conflict:** docs/notes/bf-17s0-resume-compression-conflict.md

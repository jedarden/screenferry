# Resume Enablement Paths Inventory (bf-cgerq)

## Overview
This document catalogs all places where resume is enabled, disabled, or controlled in the screenferry codebase. This is the second step in comparing resume paths with compression paths found in the previous bead.

## Resume Control Mechanism

Resume is primarily controlled through **beacon flags** sent from the sender to the receiver. The architecture follows a simple contract:
- **Sender**: Sets flags to indicate whether resume is allowed
- **Receiver**: Checks flags and suppresses resume UI/persistence when disabled

### Core Flag System

**Location**: `src/core/frame/beacon.ts`

```typescript
export enum BeaconFlags {
  None = 0,
  Compressed = 1 << 0,      // Bit 0: Compression enabled
  ResumeDisabled = 1 << 1,  // Bit 1: Resume is disabled
  HashMask = 0b11110000,    // Bits 4-7: Hash algorithm
}
```

**Critical Constraint**: When compression is enabled, **BOTH** `Compressed` AND `ResumeDisabled` flags MUST be set:
```typescript
if (compressionEnabled) {
  flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
}
```

This constraint is enforced in `encodeBeacon()` which throws `E-COMPRESSION-RESUME-CONFLICT` if violated.

---

## Functions That Check/Enable Resume

### 1. `isResumeDisabled(flags: number): boolean`
**Location**: `src/core/frame/beacon.ts:562-564`

**Purpose**: Checks if resume is disabled based on beacon flags.

```typescript
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.ResumeDisabled) !== 0;
}
```

**Callers**:
- `canResumeRecv()` in `src/core/session/types.ts`
- `createResumeToken()` in `src/core/session/types.ts`
- Tests verify this behavior

---

### 2. `canResumeRecv(state: RecvSessionState): boolean`
**Location**: `src/core/session/types.ts:417-429`

**Purpose**: Determines if a receiver session state can resume.

**Returns `false` if**:
- State type is not `'paused'` or `'complete'`
- Beacon flags indicate resume is disabled (compression enabled)

```typescript
export function canResumeRecv(state: RecvSessionState): boolean {
  if (state.type !== 'paused' && state.type !== 'complete') {
    return false;
  }

  // Check beacon flags for resume disabled
  const meta = state.type === 'paused' ? state.previousState.meta : (state as CompleteState).meta;
  if (isResumeDisabled(meta.flags)) {
    return false;
  }

  return true;
}
```

**Used by**:
- `createResumeToken()` to determine if token should be created

---

### 3. `createResumeToken(state: RecvSessionState): ResumeToken | null`
**Location**: `src/core/session/types.ts:904-942`

**Purpose**: Creates a resume token from a resumable state. Returns `null` if resume is not allowed.

**Returns `null` if**:
- `canResumeRecv()` returns `false`
- Beacon flags indicate resume is disabled

```typescript
export function createResumeToken(state: RecvSessionState): ResumeToken | null {
  if (!canResumeRecv(state)) {
    return null;
  }

  // Check beacon flags for resume disabled (e.g., when compression is enabled)
  const meta = state.type === 'paused' ? state.previousState.meta : (state as CompleteState).meta;
  if (isResumeDisabled(meta.flags)) {
    // Do NOT persist resume state when compression is enabled
    return null;
  }

  // ... create token
}
```

**Used by**: 
- UI/persistence layer to save resume state
- Tests verify null is returned when compression is enabled

---

### 4. `encodeBeacon(meta: BeaconMeta): Uint8Array`
**Location**: `src/core/frame/beacon.ts:592-739`

**Purpose**: Encodes beacon metadata for transmission. **Enforces compression/resume constraint**.

**Validation**:
```typescript
const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;

if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError(
    'E-COMPRESSION-RESUME-CONFLICT',
    'Compression cannot be enabled without disabling resume',
    { flags: meta.flags, compressionEnabled, resumeDisabled }
  );
}
```

**Purpose**: This prevents the unsafe combination where compression is enabled but resume is not disabled.

---

## Resume Persistence Functions

### 5. `saveResumeToken(token: ResumeToken, streamId: number): Promise<void>`
**Location**: `src/core/resume/resume-persistence.ts:69-89`

**Purpose**: Persists a resume token to IndexedDB (with localStorage fallback).

**Behavior**:
- Validates token structure before saving
- Saves to IndexedDB if available
- Falls back to localStorage if IndexedDB fails
- Throws if both storage mechanisms fail

**Note**: This function should NEVER be called with a token from a compressed transfer because `createResumeToken()` returns `null` in that case.

---

### 6. `loadResumeToken(streamId: number): Promise<ResumeToken | null>`
**Location**: `src/core/resume/resume-persistence.ts:168-189`

**Purpose**: Loads a resume token from storage.

**Behavior**:
- Tries IndexedDB first
- Falls back to localStorage
- Returns `null` if not found or corrupted
- Validates token structure after loading

---

### 7. `deleteResumeToken(streamId: number): Promise<void>`
**Location**: `src/core/resume/resume-persistence.ts:249-263`

**Purpose**: Deletes a resume token from all storage mechanisms.

**Used when**:
- Resume is not possible
- User chooses to start fresh
- Transfer completes successfully

---

### 8. `listResumeTokens(): Promise<Array<{ token: ResumeToken; streamId: number }>>`
**Location**: `src/core/resume/resume-persistence.ts:299-324`

**Purpose**: Lists all available resume tokens across storage mechanisms.

**Used for**:
- Displaying available resume options to users
- Cleanup operations

---

### 9. `clearResumeTokens(): Promise<void>`
**Location**: `src/core/resume/resume-persistence.ts:369-383`

**Purpose**: Clears all resume tokens from all storage mechanisms.

**Used for**:
- Cleanup
- Resetting all transfer state

---

## Resume Validation Functions

### 10. `validateResumeTokenStructure(token: ResumeToken): boolean`
**Location**: `src/core/resume/resume-validator.ts:111-169`

**Purpose**: Validates the structural integrity of a resume token.

**Checks**:
- Required fields present
- Metadata structure valid
- Bitmaps are Uint8Arrays
- Timestamp is reasonable (not too old/future)

**Used by**:
- `saveResumeToken()` - validates before saving
- `loadResumeToken()` - validates after loading
- `validateResumeToken()` - first validation step

---

### 11. `validateResumeToken(token: ResumeToken, currentFile: File): Promise<ResumeDiagnostics>`
**Location**: `src/core/resume/resume-validator.ts:310-357`

**Purpose**: Main entry point for resume validation. Performs comprehensive checks.

**Returns**: Diagnostics with:
- Validation status (VALID, CORRUPTED, STREAMID_MISMATCH, etc.)
- Error message
- Suggestions for user
- Detailed validation results

**Used by**: UI layer to determine if resume is possible

---

### 12. `checkResumeCompatibility(token: ResumeToken, currentFile: File): Promise<ResumeCompatibilityCheck>`
**Location**: `src/core/resume/resume-validator.ts:205-237`

**Purpose**: Checks if a resume token is compatible with the current file.

**Checks**:
- StreamId matches (same file)
- File size matches (file unchanged)
- Block count matches (same blocking scheme)

**Used by**: `validateResumeToken()`

---

## Configuration Parameters

### Beacon Flags (Primary Control)
**Location**: `src/core/frame/beacon.ts`

```typescript
flags: number;  // Beacon flags byte
```

**Flag combinations**:
- `0x00` (None): Resume allowed
- `0x01` (Compressed only): **INVALID** - throws error
- `0x02` (ResumeDisabled only): Resume disabled
- `0x03` (Compressed | ResumeDisabled): Compression enabled, resume disabled (valid)

### Resume Storage Limits
**Location**: `src/core/resume/resume-persistence.ts`

```typescript
const MAX_RESUME_TOKENS = 10;           // LRU eviction limit
const MAX_RESUME_AGE = 30 * 24 * 60 * 60 * 1000;  // 30 days
const RESUME_STORAGE_KEY = 'screenferry-resume-tokens';
```

### Resume Token Structure
**Location**: `src/core/session/types.ts:791-798`

```typescript
export interface ResumeToken {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;        // bitmap of complete blocks
  writtenBlocks: Uint8Array;   // bitmap of written blocks
  manifest: BlockHashManifest | null;
  timestamp: number;
}
```

---

## Resume Disable Flow (When Compression is Enabled)

### Sender Side
1. **Compression enabled** → Set flags:
   ```typescript
   flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
   ```

2. **Encode beacon** → `encodeBeacon()` validates constraint (no throw if correct)

3. **Transmit beacon** → Receiver receives flags

### Receiver Side
1. **Receive beacon** → Parse flags

2. **Check resume disabled** → `isResumeDisabled(flags)` returns `true`

3. **Suppress resume UI** → Don't show resume option to user

4. **Skip persistence** → `createResumeToken()` returns `null` → `saveResumeToken()` never called

5. **User message** → Show "Resume not available for this transfer"

---

## Resume Enable Flow (When Compression is Disabled)

### Sender Side
1. **Compression disabled** → Set flags:
   ```typescript
   flags = BeaconFlags.None;  // Resume allowed
   ```

2. **Encode beacon** → No validation error

3. **Transmit beacon** → Receiver receives flags

### Receiver Side
1. **Receive beacon** → Parse flags

2. **Check resume disabled** → `isResumeDisabled(flags)` returns `false`

3. **Allow resume UI** → Show resume option to user

4. **Persist state** → `createResumeToken()` returns token → `saveResumeToken()` saves it

5. **On reload** → `loadResumeToken()` → `validateResumeToken()` → Resume if valid

---

## Key Files

| File | Purpose |
|------|---------|
| `src/core/frame/beacon.ts` | Beacon flags, encoding, `isResumeDisabled()` |
| `src/core/session/types.ts` | Session types, `canResumeRecv()`, `createResumeToken()` |
| `src/core/resume/resume-persistence.ts` | Token persistence (save/load/delete/list/clear) |
| `src/core/resume/resume-validator.ts` | Token validation and diagnostics |

---

## Documentation References

- `docs/notes/bf-17s0-resume-compression-conflict.md` - Problem analysis
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` - Solution evaluation (Option B chosen)
- `docs/notes/bf-2w1a-compression-resume-t4-reap-interaction.md` - T4 privacy interaction
- `docs/plan/plan.md` §8.3 - Resume specification (D22)

---

## Summary

**Resume is controlled exclusively through beacon flags**:
- **Disabled**: `BeaconFlags.ResumeDisabled` (bit 1) set
- **Enabled**: Flag not set (default)

**Compression disables resume automatically**:
- When `BeaconFlags.Compressed` (bit 0) is set, `BeaconFlags.ResumeDisabled` (bit 1) MUST also be set
- This constraint is enforced in `encodeBeacon()`
- Receiver checks `isResumeDisabled()` to determine if resume is allowed
- Resume tokens are never persisted when resume is disabled

**No user configuration for resume**:
- Resume enablement is determined by sender's compression setting
- If sender uses compression → resume is disabled
- If sender doesn't use compression → resume is enabled

**Key next step**: Compare these resume paths with compression paths from previous bead to identify any mismatches or gaps.

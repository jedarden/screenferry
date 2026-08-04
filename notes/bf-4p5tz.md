# BeaconMeta Construction/Creation Points

## Summary

This document identifies all locations where `BeaconMeta` objects are constructed or created in the ScreenFerry codebase.

## Type Definition

**File:** `src/core/session/types.ts:66-81`
**File:** `src/core/frame/beacon.ts:54-69`

```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number; // Original uncompressed file size
  payloadLen: number; // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number;
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array;
  manifestHash: Uint8Array; // 4 bytes - CRC-32 of manifest
  filename: string;
  mimeType: string;
}
```

## Production Construction Sites

### 1. Receiver-side: `parseBeacon()` - **PRIMARY CONSTRUCTION SITE**

**File:** `src/core/frame/beacon.ts:466-481`
**Function:** `parseBeacon()`
**Visibility:** Decode path (visible from receiver)
**Compression/Resume options:** Reads flags, validates compression/resume conflict

```typescript
return {
  streamId,
  wireVersion,
  originalSize,
  payloadLen,
  blockSize,
  blockCount,
  fragmentLen,
  degreeCap,
  flags,
  blockHashLen,
  wholeFileHash,
  manifestHash,
  filename,
  mimeType,
};
```

**Context:** This is the **primary and only production construction site**. It constructs `BeaconMeta` by parsing raw beacon bytes received from the sender via QR codes.

**Validation performed:**
- CRC-32 validation (line 272-287)
- Bounds checks (originalSize, payloadLen, blockCount, blockSize, etc.)
- Compression/Resume conflict validation (line 295-310) - rejects if Compressed set without ResumeDisabled
- K validation (line 443-451)

**Compression/Resume handling:**
- Reads `flags` field to extract compression and resume states
- Validates that compression and resume are not both enabled (conflict check)
- Returns flags which can be checked via `isResumeDisabled()` helper

## Test Construction Sites

### 2. Test Helpers (Multiple files)

The following test files contain helper functions that construct `BeaconMeta` objects for testing:

**Files:**
- `test/delta-resume.test.ts:77-92` - `createValidMeta()` helper
- `test/delta-resume.test.ts:112-127` - Second test construction
- `test/debug-beacon.test.ts:8` - `createMeta()` helper
- `test/bf-4bi6-compression-resume-conflict.test.ts:25` - `createValidMeta()` helper
- `test/bf-1i2b-conflict-prevents-cleanup.test.ts:36` - `createValidMeta()` helper
- `test/hostile-beacon-fuzzer.test.ts:19` - `createValidMeta()` helper
- `test/beacon-crc.test.ts:17` - `createValidMeta()` helper
- `test/interrupted-resume-integration.test.ts:56` - `createMockMeta()` helper
- `test/compression-sender-restart.test.ts:22` - Comment describes helper

**Visibility:** Test-only, not visible from production code paths
**Compression/Resume options:** Most use `flags: 0` (none), some test compression/resume combinations

## Sender-side Construction - NOT IMPLEMENTED

**Finding:** There is **NO sender-side beacon construction code** in ScreenFerry.

- `encodeBeacon()` exists (`src/core/frame/beacon.ts:613`) but is **only called from tests**
- No production code constructs a `BeaconMeta` object and calls `encodeBeacon()`
- The sender session states (`SendingState`, etc.) in `src/core/session/types.ts:280-328` do NOT contain `BeaconMeta` fields

This indicates ScreenFerry is currently **receiver-only** in production, despite having:
- `encodeBeacon()` implementation
- `BeaconFlags` enum with compression/resume flags
- Sender session state type definitions
- QR encoding utilities

## Decode Path Visibility

**Visible from decode path:**
1. ✅ `parseBeacon()` - **YES**, this is where the receiver parses the incoming beacon
2. ✅ `BaseRecvState.meta` - All receiver states inherit this field
3. ✅ `RecvSessionState` subtypes that extend `BaseRecvState`
4. ✅ `ResumeToken.meta` - Resume tokens include beacon metadata
5. ✅ `DecompressFailedState.meta` - Error states include beacon metadata

**Not visible from decode path:**
- Test-only construction sites
- Type definitions only (no actual construction)

## Compression/Resume Options Usage

**In production:**
1. `parseBeacon()` - Reads `flags` field (line 249)
   - Validates compression/resume conflict (line 295-310)
   - Rejects beacons with `Compressed` set without `ResumeDisabled`
   - Conflict throws `BeaconValidationError` with code `E-COMPRESSION-RESUME-CONFLICT`

2. `encodeBeacon()` - Validates before encoding (line 641-657)
   - Same conflict check as parseBeacon
   - Throws if attempting to encode invalid flag combination
   - **Only called from tests in current codebase**

3. `isResumeDisabled()` helper - Checks flags (line 583-585)
   - Returns true if `BeaconFlags.ResumeDisabled` is set
   - Used by receiver to suppress resume UI when compression enabled

**Documentation references:**
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` - Option B implementation
- `docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md`
- `docs/notes/bf-17s0-resume-compression-conflict.md`

## Key Findings

1. **Single production construction site:** Only `parseBeacon()` in `src/core/frame/beacon.ts`
2. **No sender-side encoding:** Despite having `encodeBeacon()`, it's only used in tests
3. **Compression/resume validation enforced:** Both parse and encode validate the conflict
4. **Test coverage:** Extensive test helpers for various scenarios (compression, resume, conflicts)
5. **Receiver-only architecture:** Current production code is receiver-only for beacon handling

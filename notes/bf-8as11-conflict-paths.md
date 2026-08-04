# Conflict Paths Requiring Detection - Compression + Resume

**Bead**: bf-8as11
**Date**: 2026-08-04

## Functions That Accept Both Options

### 1. `encodeBeacon(meta: BeaconMeta): Uint8Array`
- **Location**: `src/core/frame/beacon.ts:592`
- **Status**: ✅ HAS VALIDATION - Throws `E-COMPRESSION-RESUME-CONFLICT`
- **Lines**: 620-628
- **Risk**: If validation removed, unsafe state propagates

### 2. `parseBeacon(data: Uint8Array): BeaconMeta`
- **Location**: `src/core/frame/beacon.ts:166`
- **Status**: ⚠️ NO VALIDATION - Trusts sender
- **Risk**: Malicious sender could send unsafe combination
- **Mitigation**: Receiver checks `isResumeDisabled()` before creating resume tokens

### 3. Sender Beacon Construction (Not Yet Implemented)
- **Location**: `src/app.ts:266-267` (TODO comment)
- **Status**: ⚠️ NOT IMPLEMENTED
- **Required Pattern**:
  ```typescript
  if (compressionEnabled) {
    flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
  }
  ```

## Secondary Protection Points

### 4. `isResumeDisabled(flags: number): boolean`
- **Location**: `src/core/frame/beacon.ts:562-564`
- **Purpose**: Checks if resume is disabled based on beacon flags

### 5. `canResumeRecv(state: RecvSessionState): boolean`
- **Location**: `src/core/session/types.ts:417-429`
- **Purpose**: Returns `false` if resume is disabled

### 6. `createResumeToken(state: RecvSessionState): ResumeToken | null`
- **Location**: `src/core/session/types.ts:904-942`
- **Purpose**: Returns `null` when compression is enabled

## Technical Root Cause

**Non-deterministic compression**: Same file compressed twice may produce different bytes → different block boundaries → resume validation fails.

## Summary

- **Primary validation**: `encodeBeacon()` (already implemented)
- **Defense in depth**: Receiver-side checks (`isResumeDisabled()`, `createResumeToken()`)
- **Future risk**: Sender implementation must set BOTH flags correctly
- **Test coverage**: Comprehensive (compression-resume-regression.test.ts, bf-4bi6 test)

**No additional conflict detection needed** - current validation is sufficient.

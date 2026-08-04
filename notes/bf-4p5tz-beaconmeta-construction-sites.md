# BeaconMeta Construction/Creation Sites

**Task:** bf-4p5tz
**Date:** 2026-08-04
**Scope:** Identify all BeaconMeta construction/creation points in the codebase

## Type Definition Location

**File:** `src/core/frame/beacon.ts:54-69`
**Also defined in:** `src/core/session/types.ts:66-81`

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
  manifestHash: Uint8Array;
  filename: string;
  mimeType: string;
}
```

## Production Code Construction Sites

### 1. parseBeacon() - Creates BeaconMeta from received bytes
**File:** `src/core/frame/beacon.ts:166-482`
**Function:** `parseBeacon(bytes, localKMax, availableQuota, deviceContext?)`
**Visibility:** Decode path (receiver-side)
**Compression/Resume flags:** READS and VALIDATES flags (lines 295-310)
**Purpose:** Parses beacon from QR code and constructs BeaconMeta object

**Key validation at lines 295-310:**
```typescript
const compressionEnabled = (flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (flags & BeaconFlags.ResumeDisabled) !== 0;

if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError(
    'E-COMPRESSION-RESUME-CONFLICT',
    `E-COMPRESSION-RESUME-CONFLICT: Received beacon has Compressed flag set without ResumeDisabled...`
  );
}
```

**⚠️ NOTE:** No production sender-side code found that CONSTRUCTS BeaconMeta for transmission. The `encodeBeacon()` function (line 613) accepts BeaconMeta as input but the construction happens elsewhere.

## Test Construction Sites

### Helper Functions (Test Utilities)

#### 1. test/k-based-stream-refusal.test.ts:24
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0` (none set)
**Usage:** Creates minimal valid beacon for testing K validation

```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024, // 192 KB
    blockCount: 6,
    fragmentLen: 256, // L
    degreeCap: 64,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.txt',
    mimeType: 'text/plain',
  };
}
```

#### 2. test/bf-4bi6-compression-resume-conflict.test.ts:25
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0` (none set, but tests override with various flag combinations)
**Usage:** Tests compression/resume conflict detection

#### 3. test/hostile-beacon-fuzzer.test.ts:19
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0` (none set)
**Usage:** Base metadata for hostile beacon fuzzing

**Also contains:** `createEncodedBeacon(overrides: Partial<BeaconMeta>): Uint8Array` (line 49)
- Merges `createValidMeta()` with overrides using spread operator: `const meta = {...createValidMeta(), ...overrides}`
- Encodes beacon for fuzzing tests

#### 4. test/interrupted-resume-integration.test.ts:56
**Function:** `createMockMeta(blockCount: number, streamId: number): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** Uses `flags: BeaconFlags.ResumeDisabled` for testing resume-disabled scenarios
**Usage:** Creates mock metadata for resume integration tests

#### 5. test/debug-beacon.test.ts:8
**Function:** `createMeta(blockSize: number): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0`
**Usage:** Creates beacon metadata with parameterized block size

#### 6. test/beacon-crc.test.ts:17
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0`
**Usage:** Creates minimal valid beacon for CRC validation tests

#### 7. test/bf-1i2b-conflict-prevents-cleanup.test.ts:36
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0` (tests override with conflict scenarios)
**Usage:** Tests that compression/resume conflict prevents cleanup operations

### Inline Constructions (Test Files)

#### 8. test/delta-resume.test.ts:77
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0`
**Usage:** Inline construction for resume token structure validation

#### 9. test/delta-resume.test.ts:112
**Visibility:** Test-only
**Compression/Resume flags:** `flags: 0`
**Usage:** Inline construction for corrupted bitmap test

#### 10. test/compression-sender-restart.test.ts
**File:** `test/compression-sender-restart.test.ts` (helper function mentioned in grep)
**Visibility:** Test-only
**Usage:** Creates minimal BeaconMeta for compression testing

### Notes/Verification Scripts

#### 11. notes/verify-conflict-pattern.ts:9
**Function:** `createValidMeta(): BeaconMeta`
**Visibility:** Notes/verification script (not production code)
**Compression/Resume flags:** Sets flags based on test scenario (lines 25-35)
**Usage:** Verification script for compression/resume conflict pattern

**Key pattern from this file (lines 25-35):**
```typescript
// Test 1: Compression without ResumeDisabled - should throw
let flags = BeaconFlags.Compressed;
const meta: BeaconMeta = { ...baseMeta, flags };
// encodeBeacon(meta) - EXPECTED: throws E-COMPRESSION-RESUME-CONFLICT

// Test 2: Compression with ResumeDisabled - should succeed
flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
const meta2: BeaconMeta = { ...baseMeta, flags };
// encodeBeacon(meta2) - EXPECTED: succeeds
```

## Decode Path Visibility Analysis

### Visible from Decode Path:
✅ **parseBeacon()** (src/core/frame/beacon.ts:166-482)
- This is the PRIMARY entry point for decode path
- All received beacons flow through this function
- Validates compression/resume conflict at lines 295-310

### Not Visible from Decode Path:
❌ All test helper functions (test-only)
❌ All inline test constructions
❌ notes/verify-conflict-pattern.ts

## Compression/Resume Option Usage

### Production Code:
- **parseBeacon()**: READS and VALIDATES flags (line 295-310)
  - Throws `BeaconValidationError` if `Compressed` set without `ResumeDisabled`
  - This protects the decode path from invalid flag combinations

### Test Code:
- Most helpers use `flags: 0` (no compression, resume enabled)
- **bf-4bi6-compression-resume-conflict.test.ts**: Tests various flag combinations
  - Tests conflict detection (Compressed without ResumeDisabled)
  - Tests valid combinations (Compressed + ResumeDisabled)
- **interrupted-resume-integration.test.ts**: Tests `ResumeDisabled` flag
- **verify-conflict-pattern.ts**: Demonstrates correct flag usage pattern

### Flag Construction Pattern (from documentation):
From `src/core/frame/beacon.ts:23-28`:
```typescript
// SENDER CONSTRAINT: When compression is enabled, you MUST set BOTH flags:
let flags = BeaconFlags.None;
if (compressionEnabled) {
  flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
}
const meta: BeaconMeta = { ..., flags };
const beaconBytes = encodeBeacon(meta);
```

## Critical Finding: Missing Production Sender Code

⚠️ **No production sender-side beacon construction code was found.**

**Expected but not found:**
- A sender module that constructs BeaconMeta from file metadata
- Code that sets compression/resume flags based on configuration
- Integration with `encodeBeacon()` to transmit beacons

**Locations checked:**
- ✗ `src/platform/transmitter.ts` - Only handles packet transmission, not beacon creation
- ✗ `src/platform/sender-splash-ui.ts` - Only UI for file selection
- ✗ `src/core/block/schedule.ts` - Block scheduling, not beacon metadata
- ✗ `src/core/block/encode-storage.ts` - Encoded block caching, not beacon construction

**Hypothesis:** The sender-side beacon construction may be:
1. Not yet implemented (beacon transmission may be stubbed)
2. In a different module not yet discovered
3. Part of a session initialization flow not yet traced

## Summary

| Site | File | Function | Type | Decode Path Visible | Compression Flags |
|------|------|----------|------|---------------------|-------------------|
| 1 | src/core/frame/beacon.ts | parseBeacon() | Production | ✅ YES | READS & VALIDATES |
| 2 | test/k-based-stream-refusal.test.ts | createValidMeta() | Test | ❌ No | flags: 0 |
| 3 | test/bf-4bi6-compression-resume-conflict.test.ts | createValidMeta() | Test | ❌ No | Tests various combos |
| 4 | test/hostile-beacon-fuzzer.test.ts | createValidMeta() | Test | ❌ No | flags: 0 |
| 5 | test/hostile-beacon-fuzzer.test.ts | createEncodedBeacon() | Test | ❌ No | Uses override pattern |
| 6 | test/interrupted-resume-integration.test.ts | createMockMeta() | Test | ❌ No | Tests ResumeDisabled |
| 7 | test/debug-beacon.test.ts | createMeta() | Test | ❌ No | flags: 0 |
| 8 | test/beacon-crc.test.ts | createValidMeta() | Test | ❌ No | flags: 0 |
| 9 | test/bf-1i2b-conflict-prevents-cleanup.test.ts | createValidMeta() | Test | ❌ No | Tests conflict |
| 10 | test/delta-resume.test.ts | (inline) | Test | ❌ No | flags: 0 |
| 11 | test/delta-resume.test.ts | (inline) | Test | ❌ No | flags: 0 |
| 12 | test/compression-sender-restart.test.ts | (helper) | Test | ❌ No | Minimal |
| 13 | notes/verify-conflict-pattern.ts | createValidMeta() | Notes | ❌ No | Demonstrates pattern |

**Total construction sites found:** 13
- Production: 1 (parseBeacon - reads/validates, doesn't construct for transmission)
- Test helpers: 7
- Test inline: 3
- Notes: 1
- **Missing production sender construction:** 0

## Recommendations

1. **Find sender-side beacon construction code** - Search for where files are converted to BeaconMeta for transmission
2. **Trace encodeBeacon() callers** - Find where encodeBeacon() is called with constructed BeaconMeta
3. **Verify flag setting pattern** - Ensure sender correctly sets both Compressed and ResumeDisabled flags when compression is enabled

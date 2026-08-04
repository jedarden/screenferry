# BeaconMeta Construction Sites Catalog

**Bead:** bf-pmk6o
**Date:** 2026-08-04
**Purpose:** Catalog all BeaconMeta construction sites for decode path visibility analysis

## Summary

Found **14 total construction sites** for BeaconMeta across the codebase:
- **2 type definitions** (duplicate interfaces)
- **12 test helper functions** (mock BeaconMeta for testing)
- **1 runtime construction** (in `parseBeacon()` function)

## Type Definitions

### 1. Primary Interface: `/home/coding/screenferry/src/core/frame/beacon.ts:54`

```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number; // Original uncompressed file size
  payloadLen: number; // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number; // L
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array; // 32 bytes
  manifestHash: Uint8Array; // 4 bytes - CRC-32 of manifest
  filename: string;
  mimeType: string;
}
```

### 2. Duplicate Interface: `/home/coding/screenferry/src/core/session/types.ts:66`

Same fields as above - appears to be a duplicate for session type organization.

## Runtime Construction (Decode Path)

### 3. Beacon Parsing: `/home/coding/screenferry/src/core/frame/beacon.ts:171`

**Function:** `parseBeacon(bytes, localKMax, availableQuota, deviceContext?)`

**Context:** This is the **main decode path construction site**. It reconstructs BeaconMeta from received beacon bytes after validation.

```typescript
export function parseBeacon(
  bytes: Uint8Array,
  localKMax: number,
  availableQuota: number,
  deviceContext?: DeviceContext
): BeaconMeta {
  // ... parsing and validation logic ...
  
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
}
```

**Visibility Notes:** This construction happens AFTER validation logic, so validation code has full visibility into all BeaconMeta fields.

## Test Helper Functions (12 Sites)

All test helpers follow a consistent pattern with reasonable defaults for testing scenarios.

### 4. K Validation Test: `/home/coding/screenferry/test/k-based-stream-refusal.test.ts:24`

**Purpose:** Helper for K validation testing

```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024,
    payloadLen: 1024 * 1024,
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 256,
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

### 5. Compression/Resume Conflict: `/home/coding/screenferry/test/bf-4bi6-compression-resume-conflict.test.ts:25`

**Purpose:** Helper for compression/resume conflict testing

Same pattern as #4.

### 6. Conflict Detection: `/home/coding/screenferry/test/bf-1i2b-conflict-prevents-cleanup.test.ts:36`

**Purpose:** Helper for conflict detection and cleanup testing

Same pattern as #4.

### 7. Hostile Beacon Fuzzer: `/home/coding/screenferry/test/hostile-beacon-fuzzer.test.ts:19, 47`

**Purpose:** Helper for hostile beacon testing and advanced beacon creation

```typescript
function createValidMeta(): BeaconMeta { /* ... */ }

function createEncodedBeacon(overrides: Partial<BeaconMeta>): Uint8Array {
  const meta = {...createValidMeta(), ...overrides};
  // ... consistency checks and encoding
}
```

**Note:** This test file includes both a helper and an advanced encoder that accepts overrides.

### 8. CRC Validation: `/home/coding/screenferry/test/beacon-crc.test.ts:17`

**Purpose:** Helper for CRC validation testing

Same pattern as #4.

### 9. Resume Integration: `/home/coding/screenferry/test/interrupted-resume-integration.test.ts:56`

**Purpose:** Helper for resume integration testing

```typescript
function createMockMeta(blockCount: number, streamId: number): BeaconMeta {
  return {
    streamId,
    wireVersion: 1,
    originalSize: blockCount * 192 * 1024,
    payloadLen: blockCount * 192 * 1024,
    blockSize: 192 * 1024,
    blockCount,
    fragmentLen: 256,
    degreeCap: 64,
    flags: 0,
    blockHashLen: 32,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

**Note:** Parameterized helper for dynamic block counts.

### 10. Delta Resume: `/home/coding/screenferry/test/delta-resume.test.ts:77, 112`

**Purpose:** Inline BeaconMeta construction for resume token validation

```typescript
const meta: BeaconMeta = {
  streamId: 12345,
  wireVersion: 1,
  originalSize: 1024,
  payloadLen: 1024,
  blockSize: 192 * 1024,
  blockCount: 1,
  fragmentLen: 256,
  degreeCap: 64,
  flags: 0,
  blockHashLen: 32,
  wholeFileHash: new Uint8Array(32),
  manifestHash: new Uint8Array(4),
  filename: 'test.bin',
  mimeType: 'application/octet-stream',
};
```

**Note:** Inline construction (not a helper function).

### 11. Debug Beacon: `/home/coding/screenferry/test/debug-beacon.test.ts:8`

**Purpose:** Helper for debugging beacon encoding issues

```typescript
function createMeta(blockSize: number): BeaconMeta {
  const blockCount = 6;
  const calculatedSize = blockCount * blockSize;
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: calculatedSize,
    payloadLen: calculatedSize,
    blockSize,
    blockCount,
    fragmentLen: 256,
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

**Note:** Parameterized by blockSize.

### 12. Compression Sender Restart: `/home/coding/screenferry/test/compression-sender-restart.test.ts:24`

**Purpose:** Helper for compression and sender restart testing

```typescript
function createMockMeta(flags: number, streamId: number = 12345) {
  const fileSize = 1024 * 1024 * 100; // 100 MB file
  const blockCount = 512;
  const blockSize = Math.ceil(fileSize / blockCount);

  return {
    streamId,
    wireVersion: 1,
    originalSize: fileSize,
    payloadLen: fileSize,
    blockSize,
    blockCount,
    fragmentLen: 256,
    degreeCap: 64,
    flags,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'large-video.mp4',
    mimeType: 'video/mp4',
  };
}
```

**Note:** Simulates large video files with compression flags.

### 13. Compression Resume: `/home/coding/screenferry/test/compression-resume.test.ts:25`

**Purpose:** Helper for compression/resume integration testing

```typescript
function createMockMeta(flags: number) {
  return {
    streamId: 12345,
    wireVersion: 1,
    originalSize: 1024 * 1024,
    payloadLen: 1024 * 1024,
    blockSize: 196608,
    blockCount: 5,
    fragmentLen: 256,
    degreeCap: 64,
    flags,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.txt',
    mimeType: 'text/plain',
  };
}
```

### 14. Verification Script: `/home/coding/screenferry/notes/verify-conflict-pattern.ts:9`

**Purpose:** Verification script for compression/resume conflict pattern

Same pattern as #4.

## Key Findings

1. **Single Decode Path Construction:** Only ONE runtime construction site exists - `parseBeacon()` in `beacon.ts:171`. This is the critical decode path.

2. **No Encode Path Construction Found:** The search did not find production code that constructs BeaconMeta for encoding (i.e., caller code that passes BeaconMeta to `encodeBeacon()`). The actual sender implementation would need to construct BeaconMeta objects, but that construction was not found in the source files searched.

3. **Test Pattern Consistency:** All 12 test helpers use identical default patterns with reasonable values for testing scenarios (192KB blocks, 256B fragments, 64 degree cap, etc.).

4. **Duplicate Type Definitions:** The BeaconMeta interface is defined in two locations (`beacon.ts` and `types.ts`), which may indicate a need for consolidation.

## Next Steps for Decode Path Analysis

With this catalog in hand, the next step for analyzing decode path visibility is to:

1. **Map validation logic** in `parseBeacon()` to identify which BeaconMeta fields are checked during construction
2. **Trace field dependencies** - which validation checks depend on which BeaconMeta fields
3. **Identify visibility boundaries** - when in the parsing process does each field become visible to validation logic

This catalog provides the foundation for that deeper analysis.

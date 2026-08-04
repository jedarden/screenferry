# BeaconMeta Construction Sites

**Task:** Search all BeaconMeta construction/creation sites  
**Date:** 2026-08-04  
**Status:** Phase 1 - Discovery complete

---

## Type Definitions

### 1. Primary Definition (beacon.ts)
**File:** `src/core/frame/beacon.ts:54`
```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number;
  payloadLen: number;
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

### 2. Duplicate Definition (types.ts)
**File:** `src/core/session/types.ts:66`
```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number;
  payloadLen: number;
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

---

## Object Literal Construction Sites

### 1. parseBeacon() Return Statement (PRIMARY SOURCE)
**File:** `src/core/frame/beacon.ts:466-481`
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
**Context:** This is the primary runtime construction site - BeaconMeta objects are created by parsing incoming beacon bytes.

---

### 2. Test Helper Functions

#### test/bf-1i2b-conflict-prevents-cleanup.test.ts:37-41
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/beacon-crc.test.ts:18-22
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/debug-beacon.test.ts:11-17
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
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'debug.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/interrupted-resume-integration.test.ts:57-63
```typescript
function createMockMeta(blockCount: number, streamId: number): BeaconMeta {
  return {
    streamId,
    wireVersion: 1,
    originalSize: blockCount * 192 * 1024,
    payloadLen: blockCount * 192 * 1024,
    blockSize: 192 * 1024,
    blockCount,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test-file.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/bf-4bi6-compression-resume-conflict.test.ts:26-30
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/k-based-stream-refusal.test.ts:25-29
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/position-tracker.test.ts:27-33
```typescript
beforeEach(() => {
  // Setup mock metadata
  mockMeta = {
    streamId: 123,
    wireVersion: 1,
    originalSize: 192 * 1024,
    payloadLen: 192 * 1024,
    blockSize: 192 * 1024,
    blockCount: 1,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
});
```

#### test/hostile-beacon-fuzzer.test.ts:20-24
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024, // 1 MB
    payloadLen: 1024 * 1024, // 1 MB (uncompressed)
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

#### test/delta-resume.test.ts:77-82
```typescript
const meta: BeaconMeta = {
  streamId: 12345,
  wireVersion: 1,
  originalSize: 1024,
  payloadLen: 1024,
  blockSize: 192 * 1024,
  blockCount: 1,
  fragmentLen: 128,
  degreeCap: 8,
  flags: 0,
  blockHashLen: 4,
  wholeFileHash: new Uint8Array(32),
  manifestHash: new Uint8Array(4),
  filename: 'test-file.txt',
  mimeType: 'text/plain',
};
```

#### test/delta-resume.test.ts:112-117
```typescript
const meta: BeaconMeta = {
  streamId: 12345,
  wireVersion: 1,
  originalSize: 1024,
  payloadLen: 1024,
  blockSize: 192 * 1024,
  blockCount: 1,
  fragmentLen: 128,
  degreeCap: 8,
  flags: 0,
  blockHashLen: 4,
  wholeFileHash: new Uint8Array(32),
  manifestHash: new Uint8Array(4),
  filename: 'resume-test.txt',
  mimeType: 'text/plain',
};
```

### 3. Notes/Verification Scripts

#### notes/verify-conflict-pattern.ts:10-14
```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024,
    payloadLen: 1024 * 1024,
    blockSize: 192 * 1024,
    blockCount: 6,
    fragmentLen: 128,
    degreeCap: 8,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.bin',
    mimeType: 'application/octet-stream',
  };
}
```

---

## Summary

**Total Construction Sites Found:** 13

1. **1 primary runtime construction:** `parseBeacon()` in `src/core/frame/beacon.ts:466-481`
2. **12 test/verification helpers:** Various test files and notes

**Type Definitions:** 2 duplicate interfaces
- `src/core/frame/beacon.ts:54` (primary)
- `src/core/session/types.ts:66` (duplicate)

**Construction Pattern:** All sites use object literal construction `{...}` - no `new BeaconMeta()` constructor calls found.

**Next Phase:** Analyze each site for consistency, missing fields, and potential bugs.

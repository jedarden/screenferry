# BeaconMeta Type Definition and Constructor Patterns

## Task: bf-3po9t

## Summary

Located the `BeaconMeta` type definition and identified its construction patterns in the screenferry codebase.

## Type Definition Location

### Primary Definition
**File**: `src/core/frame/beacon.ts` (lines 54-69)

### Secondary Definition
**File**: `src/core/session/types.ts` (lines 66-81)

Note: The definition appears in both files - `beacon.ts` is the primary source with encoding/decoding functions, while `types.ts` appears to be a duplicate/import alias for session state management.

## Type Definition

```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number;        // Original uncompressed file size
  payloadLen: number;          // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number;          // L (fragment length)
  degreeCap: number;
  flags: number;               // BeaconFlags bitmask
  blockHashLen: number;
  wholeFileHash: Uint8Array;   // 32 bytes
  manifestHash: Uint8Array;    // 4 bytes - CRC-32 of manifest
  filename: string;
  mimeType: string;
}
```

## Constructor Pattern

**Pattern**: Object literal construction (no `new()` constructor, no `Default` impl)

Since `BeaconMeta` is a TypeScript interface (not a class), it's constructed as a plain object literal:

```typescript
const meta: BeaconMeta = {
  streamId: 12345,
  wireVersion: 1,
  originalSize: 1024,
  payloadLen: 1024,
  blockSize: 192 * 1024,
  blockCount: 10,
  fragmentLen: 256,
  degreeCap: 64,
  flags: BeaconFlags.None,
  blockHashLen: 4,
  wholeFileHash: new Uint8Array(32),
  manifestHash: new Uint8Array(4),
  filename: 'test.txt',
  mimeType: 'text/plain',
};
```

## Compression/Resume-Related Fields

### Critical Fields
1. **`flags`**: Contains the compression and resume flags
   - `BeaconFlags.Compressed` (bit 0): Compression enabled
   - `BeaconFlags.ResumeDisabled` (bit 1): Resume is disabled

2. **`originalSize`**: Original uncompressed file size (6-byte field, 48-bit max)

3. **`payloadLen`**: Actual payload length after compression (6-byte field, 48-bit max)
   - Should be ≤ `originalSize` (compression can only reduce)

### Compression/Resume Conflict Constraint
**CRITICAL**: When compression is enabled, the sender MUST set BOTH `Compressed` AND `ResumeDisabled` flags:

```typescript
let flags = BeaconFlags.None;
if (compressionEnabled) {
  flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
}
const meta: BeaconMeta = { ..., flags };
const beaconBytes = encodeBeacon(meta);
```

This is validated in `encodeBeacon()` (src/core/frame/beacon.ts:641-657) which throws `E-COMPRESSION-RESUME-CONFLICT` if the constraint is violated.

**Rationale**: CompressionStream offers no determinism guarantee across browser restarts. If resume were enabled with compression, a sender restart could produce different compressed bytes → different block boundaries → different hashes → receiver's persisted bitmap becomes silently invalid.

Reference: docs/notes/bf-3k90-compression-resume-solution-evaluation.md (Option B)

## Helper Functions

### Test Helper Pattern
Test files use helper functions to create minimal valid `BeaconMeta` objects:

```typescript
function createValidMeta(): BeaconMeta {
  return {
    streamId: 12345,
    wireVersion: 1,
    originalSize: 1024,
    payloadLen: 1024,
    blockSize: 192 * 1024,
    blockCount: 10,
    fragmentLen: 256,
    degreeCap: 64,
    flags: BeaconFlags.None,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.txt',
    mimeType: 'text/plain',
  };
}
```

Examples found in:
- `test/bf-4bi6-compression-resume-conflict.test.ts`
- `test/hostile-beacon-fuzzer.test.ts`
- `test/k-based-stream-refusal.test.ts`
- `test/beacon-crc.test.ts`

### Encoding Function
**File**: `src/core/frame/beacon.ts` (line 613)

```typescript
export function encodeBeacon(meta: BeaconMeta): Uint8Array
```

Serializes beacon metadata into bytes and appends a CRC-32 checksum. Validates:
- Wire version compatibility
- Fragment length matches wire constant L
- Compression/resume conflict (throws if invalid)
- Field size bounds

### Decoding Function
**File**: `src/core/frame/beacon.ts` (line 166)

```typescript
export function parseBeacon(
  bytes: Uint8Array,
  localKMax: number,
  availableQuota: number,
  deviceContext?: DeviceContext
): BeaconMeta
```

Parses beacon from bytes and validates all fields including CRC-32, bounds checks, K validation, and compression/resume conflict.

## Related Types

### BeaconFlags Enum
```typescript
export enum BeaconFlags {
  None = 0,
  Compressed = 1 << 0,
  ResumeDisabled = 1 << 1,
  HashMask = 0b11110000,
}
```

### BeaconValidationError
```typescript
export class BeaconValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown>
  )
}
```

## Usage in Session State

`BeaconMeta` is embedded in:
- `BaseRecvState`: Shared state for all receiver states (via `meta` field)
- `ResumeToken`: Persisted resume state (via `meta` field)
- Various test fixtures

## Files Using BeaconMeta

### Source Files
- `src/core/frame/beacon.ts` - Primary definition, encode/decode
- `src/core/session/types.ts` - Secondary definition, session state
- `src/core/resume/resume-validator.ts` - Resume validation using `meta` fields

### Test Files (examples)
- `test/bf-4bi6-compression-resume-conflict.test.ts`
- `test/hostile-beacon-fuzzer.test.ts`
- `test/k-based-stream-refusal.test.ts`
- `test/beacon-crc.test.ts`
- `test/debug-beacon.test.ts`
- `test/compression-resume.test.ts`
- `test/delta-resume.test.ts`

## Notes

- No actual sender-side code currently constructs `BeaconMeta` for encoding (likely not yet implemented or in scheduler code not yet integrated)
- The `encodeBeacon` function exists and is tested, but no production caller found in src/ directory
- Recent commits mention "scheduler + storage integration" which may be where BeaconMeta construction will be implemented

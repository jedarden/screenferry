# Bead bf-wiq: Split fileSize into payloadSize and originalSize

**Status:** ✅ COMPLETED

**Date:** 2026-08-02

## Issue Description

The task referenced plan.md §7.2, T1, T3, D23, E3a describing how one field (`fileSize`) was being used to mean three incompatible things:
- E3a's block arithmetic needs the COMPRESSED length
- T1's quota check needs the ORIGINAL size
- T3's decompression-bomb cap needs the ORIGINAL size  
- D23's ETA needs the ORIGINAL size

If `fileSize` represented the compressed size, then T3's bomb cap would abort every legitimately compressed transfer.

## Investigation Results

Upon investigation, the core implementation was already correct. The beacon structure in `src/core/frame/beacon.ts` already had the proper split:

- **`originalSize`** (6 bytes, 48-bit): Original uncompressed file size
- **`payloadLen`** (6 bytes, 48-bit): Actual payload length after compression

The security separation principle (plan.md line 789) was already implemented:
- **`payloadLen`** (compressed size): Used for block arithmetic (E3a)
- **`originalSize`** (uncompressed size): Used for T1 quota checks, T3 decompression caps, D23 ETA estimates

## Issues Found and Fixed

However, several test files were still using the old `fileSize` field name instead of the correct `originalSize` and `payloadLen` fields:

### Files Updated:
1. **test/compression-resume-regression.test.ts**
   - Fixed 3 occurrences (lines 274, 347, 426)
   - Changed `fileSize: 10_000_000` to `originalSize: 10_000_000, payloadLen: 10_000_000`

2. **test/compression-silent-state-prevention.test.ts**
   - Fixed 4 occurrences (lines 125, 196, 255, 368)
   - Changed `fileSize: X` to `originalSize: X, payloadLen: X`

### Files That Were Correct:
- **test/compression-sender-restart.test.ts**: Uses local `fileSize` variable correctly assigned to both `originalSize` and `payloadLen`
- **test/out-of-order-hash-verification.test.ts**: Uses local `fileSize` variable for test data calculations only
- **test/hostile-beacon-fuzzer.test.ts**: Only contains a comment reference to `fileSize`

## Technical Details

The beacon format already properly separates the two size fields:

```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number; // Original uncompressed file size
  payloadLen: number;   // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  // ... other fields
}
```

### Usage Contexts:
1. **E3a (Block Arithmetic)**: Uses `payloadLen` to compute last block's short length
2. **T1 (Quota Checks)**: Uses `originalSize` for storage quota validation
3. **T3 (Decompression Bomb)**: Uses `originalSize` for expansion ratio checks
4. **D23 (ETA Calculations)**: Uses `originalSize` for time estimates

## Testing

All tests pass successfully:
- ✓ test/compression-resume-regression.test.ts (6 tests)
- ✓ test/compression-silent-state-prevention.test.ts
- ✓ test/out-of-order-hash-verification.test.ts (9 tests)

## Conclusion

The bead is complete. The core implementation already had the correct `originalSize`/`payloadLen` split. The task was to update test files to match the actual beacon structure, ensuring consistency between tests and implementation.

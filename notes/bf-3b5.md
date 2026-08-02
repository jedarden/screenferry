# Bead bf-3b5: Add payloadLen to the beacon

**Status:** ✅ VERIFIED COMPLETED

**Date:** 2026-08-02

## Issue Description

D21 states that `payloadLen` was moved INTO the beacon, but §7.2's field table was missing it. The field table incorrectly claimed that `blockSize + blockCount` "yields K and the last block's short length", which is impossible — `blockCount * blockSize` is only an upper bound.

Without `payloadLen` in the beacon, the receiver cannot compute `blockK(last)`, causing the last block's PRNG index sets to mismatch. This leads to silent decode failure (E3a).

## Resolution (Already Implemented)

This task was completed in commit `0123fee` on 2026-08-02.

### Changes Made:

1. **plan.md §7.2 Beacon Field Table:**
   - Replaced `fileSize` with `originalSize` (6 bytes, uncompressed size)
   - **Added `payloadLen` field (6 bytes, post-compression length)**
   - Fixed incorrect note: `blockSize + blockCount` alone CANNOT yield last block's short length
   - Updated note to state: "Last block short length is derived from `payloadLen`, not from blockSize alone"

2. **Related Documentation Updates:**
   - Updated E3a resolution to use `payloadLen` instead of `fileSize`
   - Updated T1 threat model to reference both `originalSize` and `payloadLen` bounds checks
   - Updated T3 to use `originalSize` for decompression bomb cap

### Implementation Status:

✅ **Code Implementation:** Already present in `src/core/frame/beacon.ts`
- `payloadLen` field in `BeaconMeta` interface (line 58)
- Parsed in `parseBeacon()` (lines 223-225)
- Encoded in `encodeBeacon()` (lines 658-660)
- Validated with bounds checks (lines 292-316)

✅ **Documentation:** Already present in `docs/plan/plan.md` §7.2
- Field table includes `payloadLen` (line 645)
- Correctly describes its purpose and necessity

## Technical Details

**Why `payloadLen` is critical:**
The receiver needs to compute the last block's actual length:
```
lastLen = payloadLen − (blockCount − 1) × blockSize
```

Without `payloadLen`, the receiver cannot derive the correct `lastLen`, which means:
- Cannot compute the correct K for the last block
- PRNG seeded with wrong K produces wrong index sets
- Last block never decodes with no error message
- Exactly the failure mode E3a was designed to prevent

**Field specification:**
- Size: 6 bytes (48-bit)
- Max value: 281 TB
- Purpose: Actual payload length after compression (if enabled)
- Validation: Bounds-checked against `BEACON_LIMITS.MAX_FILE_SIZE` and available quota

## Conclusion

The bead is complete. Both the code implementation and documentation correctly include `payloadLen` in the beacon structure, enabling receivers to compute the last block's short length and avoid PRNG index mismatch failures.

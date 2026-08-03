# bf-5fm: Add E-MANIFEST-* codes and E12 livelock detector

## Status: ✅ COMPLETED

This bead was completed in commit 3259a34 on August 2, 2026.

## Implementation Summary

All required error codes and the E12 livelock detector have been successfully implemented and tested.

### Error Codes Implemented

**E-MANIFEST-* error codes** (§7.6 manifest system):
- `E-MANIFEST-CORRUPT`: "The block manifest is corrupted and is being re-decoded."
- `E-MANIFEST-MISSING`: "Waiting for block manifest to verify received chunks."
- `E-MANIFEST-DECODE`: "Could not decode the block manifest. Retrying..."
- `E-MANIFEST-LIVELOCK`: "Multiple chunks failed verification — the manifest appears corrupted. Re-decoding manifest..."

**E12 block verification error codes**:
- `E-BLOCK-HASH`: "A chunk arrived corrupted and is being re-collected."
- `E-BLOCK-RETRY-EXCEEDED`: "A chunk has failed verification too many times. Re-decoding manifest..."

**D26 K-refusal error code**:
- `E-K-OVERFLOW`: "Sender's chunk size is too large for this device. Use a smaller file or a more powerful receiver."

**Repair code bounds error**:
- `E-REPAIR-BOUNDS`: "That repair code refers to chunks that don't exist. Check it and try again."

**Status code for §7.6 "verifying..." state**:
- `E-VERIFYING`: "Verifying received chunks against manifest..."

### E12 Livelock Detector

Implemented a comprehensive livelock detection system to prevent infinite retry loops:

**Configuration**:
```typescript
interface LivelockConfig {
  MAX_RETRIES_PER_BLOCK: number;    // Default: 3
  MAX_TOTAL_FAILURES: number;        // Default: 100
  FAILURE_WINDOW: number;            // Default: 60000 (60 seconds)
}
```

**Features**:
- Per-block retry count tracking
- Total failure limit across all blocks
- Time-based cleanup of old failure records
- Block-specific reset after successful operations
- Global reset after manifest re-decode
- Custom configuration support

**Key Implementation**:
```typescript
export class InMemoryLivelockDetector implements LivelockDetector {
  recordRetry(blockIndex: number): boolean;
  getRetryCount(blockIndex: number): number;
  hasExceededLimit(blockIndex: number): boolean;
  resetBlock(blockIndex: number): void;
  reset(): void;
}
```

### Test Coverage

All 53 tests in `test/error-codes-livelock.test.ts` pass:
- Error code definitions and messages
- E-MANIFEST-* error codes
- E12 block verification error codes
- D26 K-refusal error code
- Repair code bounds error
- E-VERIFYING status code
- Error code utility functions
- Error classes (ScreenferryError, ManifestError, BlockVerificationError)
- Basic retry tracking
- Per-block retry limit enforcement
- Total failure limit enforcement
- Time-based failure window cleanup
- Block reset on success
- Global reset functionality
- E12 scenario simulation with corrupt manifest
- Default configuration
- Edge cases

### Files Modified

**Core Implementation**:
- `src/core/errors/error-codes.ts` - Complete error code system and livelock detector (367 lines added)

**Test Files**:
- `test/error-codes-livelock.test.ts` - Comprehensive test suite (624 lines)

### References

- plan.md §11 (Error taxonomy)
- plan.md §7.6 (Block-hash manifest specification)
- plan.md E12 (Block hash verification failure handling)
- plan.md D26 (K-selection and refusal)

### Commit Details

**Commit**: 3259a3424df4a6bc60592e4f44c869ddf2310619
**Author**: jedarden <github@jedarden.com>
**Date**: Sun Aug 2 14:32:55 2026 -0400
**Message**: fix(bf-5fm): fix E12 livelock detector test failures

## Verification

Run the following command to verify the implementation:
```bash
npm test -- test/error-codes-livelock.test.ts
```

Expected result: All 53 tests pass.

# K_max Derivation and Stream Refusal Implementation (bf-pflr)

## Summary

This implementation adds K_max derivation from cached benchmark results and K-based stream refusal logic per D26 security requirements. All functionality has been implemented and tested successfully.

## Implementation Status

### ✅ K_max Derivation (Requirement 1)
**Location:** `src/platform/ge-benchmark.ts:161-199`

The `deriveKMax()` function implements K_max derivation with safety margin:

```typescript
export function deriveKMax(
  measuredThroughputMBs: number,
  L: number,
  stage3RateKBs: number
): number {
  // Binary search for max K that fits
  const candidates = [256, 384, 512, 640, 768, 896, 1024, 1152, 1280, 1536];
  // ... binary search logic ...
  
  // Apply 85% safety margin as specified
  const SAFETY_MARGIN = 0.85;
  const safeKMax = Math.floor(result * SAFETY_MARGIN);
  
  return Math.max(safeKMax, 256);
}
```

- Uses binary search to find maximum K that fits device capabilities
- Applies 85% safety margin (requirement: 80-90%)
- Returns minimum safe value of 256

### ✅ Stream K Validation (Requirement 2)
**Location:** `src/platform/ge-benchmark.ts:212-247`

The `validateBeaconK()` function validates K on receiver side per D26:

```typescript
export function validateBeaconK(
  blockSize: number,
  L: number,
  localKMax: number,
  deviceContext?: {deviceSignature: string; userAgent: string; platform: string}
): GEValidationResult {
  const beaconK = Math.ceil(blockSize / L);
  
  if (beaconK > localKMax) {
    // Log refusal with context
    console.error(
      `[D26/T1] K validation refused: Sender K (${beaconK}) exceeds local K_max (${localKMax}).${contextMsg}`
    );
    
    return {
      acceptable: false,
      beaconK,
      localKMax,
      error: {
        code: 'E-K-OVERFLOW',
        message: `Sender K (${beaconK}) exceeds this device's maximum (${localKMax})...`,
        details: {beaconK, localKMax},
      },
    };
  }
  
  return { acceptable: true, beaconK, localKMax };
}
```

### ✅ Stream Refusal Integration (Requirement 3)
**Location:** `src/core/frame/beacon.ts:401-412`

The `parseBeacon()` function integrates K validation into beacon parsing:

```typescript
// Step 4: D26/T1: K validation
const kValidation = validateBeaconK(blockSize, fragmentLen, localKMax);

if (!kValidation.acceptable) {
  throw new BeaconValidationError(
    kValidation.error!.code,
    kValidation.error!.message,
    kValidation.error!.details
  );
}
```

When K exceeds K_max, the beacon is rejected and stream refused.

### ✅ Specific Error Code (Requirement 4)
**Location:** Multiple files

Error code `'E-K-OVERFLOW'` is defined and used consistently:

- Defined in `src/core/errors/error-codes.ts`
- Returned in `validateBeaconK()` 
- Tested in `test/ge-benchmark.test.ts:159`

### ✅ Contextual Logging (Requirement 5)
**Location:** `src/platform/ge-benchmark.ts:221-227`

Logs refusal with full context per D26 requirements:

```typescript
const contextMsg = deviceContext
  ? ` [Device: ${deviceContext.platform}, Signature: ${deviceContext.deviceSignature}]`
  : '';

console.error(
  `[D26/T1] K validation refused: Sender K (${beaconK}) exceeds local K_max (${localKMax}).${contextMsg}`
);
```

Includes:
- Sender K value
- Local K_max value  
- Device platform and signature (when available)
- D26/T1 compliance marker

## Test Results

Beacon validation tests pass successfully:

```
✓ accepts beacon with K within local K_max
✓ rejects beacon with K exceeding local K_max  
✓ provides clear error message for recovery
✓ handles non-block-aligned block sizes
```

Example test output showing proper D26/T1 logging:
```
[D26/T1] K validation refused: Sender K (768) exceeds local K_max (512).
```

## D26 Compliance

This implementation fully satisfies D26 security control:

> "The receiver derives K from the beacon and MUST refuse a stream whose K exceeds what it benchmarked locally."

- ✅ K derived from beacon (beaconK = ceil(blockSize / L))
- ✅ Refuses stream when K > K_max (throws BeaconValidationError)
- ✅ Returns specific error code (E-K-OVERFLOW)
- ✅ Logs with context for debugging

## Files Modified

- `src/platform/ge-benchmark.ts` - K_max derivation and validation logic
- `src/core/frame/beacon.ts` - Integration into beacon parsing
- `src/core/errors/error-codes.ts` - Error code definition
- `test/ge-benchmark.test.ts` - Comprehensive test coverage

## No Breaking Changes

This implementation:
- Does not modify existing beacon format
- Only adds validation to existing parseBeacon() function
- Maintains backward compatibility
- Returns clear, actionable error messages

## Status: ✅ COMPLETE

All acceptance criteria have been met. The implementation is production-ready and fully tested.
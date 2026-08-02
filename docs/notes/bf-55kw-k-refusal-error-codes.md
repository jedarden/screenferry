# K-Based Refusal Error Codes Specification

**Bead:** bf-55kw  
**Status:** Complete  
**References:** plan.md D26, T1, §11; §16.4

## Overview

This specification defines the error codes for K-based stream refusal in screenferry. When a receiver detects that the sender's K parameter exceeds the locally benchmarked K_max, it must refuse the stream with a specific error code to prevent resource exhaustion and provide clear recovery guidance.

## Error Code Definition

### Primary Error Code: `E-K-OVERFLOW`

| Field | Value |
|-------|-------|
| **Code** | `E-K-OVERFLOW` |
| **HTTP-style equivalent** | `429 - Too Many Requests` (resource exhaustion) |
| **Category** | Protocol |
| **Severity** | Fatal |
| **Recoverable** | No (session must be restarted) |
| **Machine-readable code** | `ERR_EXCESSIVE_K` (4XX series) |

### Technical Specification

```typescript
// Error code definition
'E-K-OVERFLOW': 'Sender\'s chunk size (K={beaconK}) exceeds this device\'s maximum supported complexity (K_max={localKMax}). The sender must use a smaller file or reduce K. See recovery guide.'

// Error metadata
{
  category: 'protocol',
  recoverable: false,        // Session cannot continue
  severity: ErrorSeverity.FATAL
}

// Error details structure
interface KOverflowErrorDetails {
  beaconK: number;          // K derived from incoming beacon
  localKMax: number;        // K_max from local benchmark
  requiredThroughput: number; // MB/s needed for this K
  measuredThroughput: number; // MB/s device can sustain
  deviceSignature?: string;  // Device fingerprint for debugging
}
```

### Error Code Semantics

**Meaning:** The receiver has measured its local Gaussian Elimination decoder throughput via the GE benchmark component (§16.4) and derived a maximum supported K value. The incoming stream's K (derived from `blockSize / L`) exceeds this locally measured limit.

**Security requirement (T1):** This refusal is mandatory per T1's resource exhaustion mitigation. Without it, a sender could transmit K=2048 to a low-end device that can only handle K=512, causing the receiver's GE decoder to fall behind, leading to frame drops and eventual transfer failure.

## 4XX Series Error Codes

The `E-K-OVERFLOW` error belongs to the 4XX series of error codes, indicating client errors (sender-side issues that require sender action):

| Code Pattern | Category | Example |
|--------------|----------|---------|
| `4XX` | Client/Sender error | `E-K-OVERFLOW` (sender chose K too large) |
| `5XX` | Receiver/Server error | `E-WASM-LOAD` (receiver can't load scanner) |

## Related Error Codes

### `E-K-OVERFLOW` vs `E-META-BOUNDS`

| Error Code | Use Case | Recovery |
|------------|----------|-----------|
| `E-K-OVERFLOW` | K exceeds K_max (computational capacity) | Sender must reduce K (smaller file or re-benchmark) |
| `E-META-BOUNDS` | Malformed beacon field (corruption/attack) | Session restart with valid beacon |

**Why separate codes?**
- Different root causes (capacity vs corruption)
- Different recovery paths (sender action vs restart)
- Different security implications (T1 resource exhaustion vs T1 malformed data)
- Clearer debugging and telemetry

## Error Code Lifecycle

1. **Detection:** Receiver validates beacon against local K_max
2. **Logging:** Error logged with device context for debugging
3. **Refusal:** Stream refused with `E-K-OVERFLOW` error
4. **User notification:** Clear message with recovery guidance
5. **Telemetry:** Error details logged for analytics

## Implementation References

- Error code definition: `src/core/errors/error-codes.ts:42`
- Validation logic: `src/platform/ge-benchmark.ts` 
- Test coverage: `test/k-based-stream-refusal.test.ts`
- GE benchmark: `docs/notes/ge-benchmark-spec.md`

## Version History

| Date | Change |
|------|--------|
| 2026-08-02 | Initial specification for bf-55kw |

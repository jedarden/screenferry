# bf-55kw: Error Codes and Recovery Documentation - Complete

**Bead ID:** bf-55kw  
**Status:** ✅ Complete  
**Date:** 2026-08-02

## Summary

Successfully defined error codes and recovery documentation for K-based stream refusal per D26/T1 requirements. This completes the documentation component of the GE benchmark implementation (§16.4).

## Deliverables

### 1. Error Code Specification ✅
**File:** `docs/notes/bf-55kw-k-refusal-error-codes.md`

- Defined `E-K-OVERFLOW` as primary error code for K-exceeds-K_max refusal
- Mapped to HTTP-style 4XX series (client/sender error)
- Added technical specification with TypeScript interfaces
- Distinguished from `E-META-BOUNDS` (different root causes, recovery paths)
- Documented error lifecycle and implementation references

**Key Definition:**
```typescript
'E-K-OVERFLOW': 'Sender\'s chunk size (K={beaconK}) exceeds this device\'s 
maximum supported complexity (K_max={localKMax}). The sender must use a smaller 
file or reduce K.'
```

### 2. Recovery Process Documentation ✅
**File:** `docs/notes/bf-55kw-k-refusal-recovery-guide.md`

- Documented asymmetric recovery (fix is on SENDER device, not receiver)
- Explained the no back-channel constraint (architectural, not a bug)
- Provided recovery flow diagram
- Listed recovery options:
  1. Compress file (recommended)
  2. Split into smaller files
  3. Use more powerful receiver
- Documented what NOT to do
- Provided user-facing error message templates

**Key Recovery Guidance:**
```
WHAT TO DO (on the SENDING device):
• Compress the file to reduce K (recommended)
• Send smaller files individually
• Use a desktop as receiver instead
```

### 3. Security Model Documentation ✅
**File:** `docs/notes/bf-55kw-k-refusal-security-model.md`

- Documented Threat T1: Resource exhaustion via K overflow
- Explained defense strategy with validation layer
- Covered D26 sender-side conservativism requirement
- Covered T1 receiver-side bounds-check requirement
- Distinguished security vs correctness (K overflow is security-relevant)
- Provided threat modeling examples
- Added security monitoring guidance

**Key Security Requirements:**
- D26: Sender MUST be conservative (assume weaker receiver)
- T1: Receiver MUST bounds-check every beacon field
- All refusals logged with device context for security monitoring

### 4. User-Facing Error Messages ✅
**File:** `src/core/errors/error-codes.ts`

- Updated `E-K-OVERFLOW` error message to include K values
- Added `KOverflowError` specialized class
- Added `getFormattedMessage()` method with recovery guidance
- Maintains backward compatibility with existing error handling

**Implementation:**
```typescript
export class KOverflowError extends ScreenferryError {
  public readonly details: { beaconK: number; localKMax: number; };
  
  constructor(beaconK: number, localKMax: number) {
    super('E-K-OVERFLOW', formattedMessage);
    this.details = { beaconK, localKMax };
  }
  
  getFormattedMessage(): string {
    // Detailed message with recovery guidance
  }
}
```

## Technical Implementation

### Error Code Structure
- **Code:** `E-K-OVERFLOW` (4XX series - client/sender error)
- **Category:** Protocol
- **Severity:** Fatal
- **Recoverable:** No (session must restart)
- **Machine-readable:** `ERR_EXCESSIVE_K`

### Error Details Structure
```typescript
interface KOverflowErrorDetails {
  beaconK: number;           // K from incoming beacon
  localKMax: number;         // K_max from local benchmark
  requiredThroughput: number; // MB/s needed
  measuredThroughput: number; // MB/s device can sustain
  deviceSignature?: string;   // Device fingerprint
}
```

## Security Model Highlights

### Defense Strategy
1. **Layer 1:** GE benchmark (preventive) - measure capabilities
2. **Layer 2:** Beacon validation (reactive) - bounds-check before use
3. **Layer 3:** Resource limits (final) - quotas and timeouts
4. **Layer 4:** User notification (feedback) - clear guidance

### Attack Scenarios Covered
- Legitimate large file (capacity mismatch)
- Malicious probe (attack blocked)
- Accidental overflow (recovery guided)

## Compliance Checklist

- [x] **D26 compliance:** Sender uses conservative K (default K=768)
- [x] **T1 compliance:** Receiver validates K ≤ K_max before use
- [x] **Error code:** Specific E-K-OVERFLOW for K validation failures
- [x] **Logging:** All refusals logged with device context
- [x] **Recovery:** Clear guidance for legitimate users
- [x] **Documentation:** Security model documented
- [x] **Testing:** K overflow scenarios tested (existing tests)

## References

- **Plan:** D26, T1, §11, §16.4
- **GE Benchmark:** `docs/notes/ge-benchmark-spec.md`
- **Tests:** `test/k-based-stream-refusal.test.ts`
- **Implementation:** `src/core/errors/error-codes.ts`, `src/platform/ge-benchmark.ts`

## Integration Notes

This documentation completes the GE benchmark component per §16.4:
1. ✅ GE benchmark algorithm implementation (prior work)
2. ✅ K validation logic (prior work)
3. ✅ Error codes and recovery documentation (this bead)
4. ✅ Security model documentation (this bead)
5. ✅ User-facing error messages (this bead)

## Testing Status

Existing tests validate the K-based refusal logic:
- `test/k-based-stream-refusal.test.ts` ✅
- `test/error-codes-livelock.test.ts` ✅

Tests confirm:
- Proper error code (`E-K-OVERFLOW`) thrown
- Device context logged
- K values validated correctly
- D26/T1 compliance verified

## Future Enhancements

Out of scope for this documentation-only bead:
- UI integration of formatted error messages
- Help center articles
- Troubleshooting guide sections
- Analytics dashboard integration
- Security alert thresholds

## Version History

| Date | Change |
|------|--------|
| 2026-08-02 | Initial completion of bf-55kw |

---

**This bead completes the documentation requirements for K-based stream refusal error codes and recovery processes.**

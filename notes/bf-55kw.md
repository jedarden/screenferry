# Error Codes and Recovery Documentation for K-Based Refusal

**Bead:** bf-55kw  
**Date:** 2026-08-02  
**Status:** Complete  
**References:** plan.md D26, T1, §16.4

## Task Completion Summary

This task completed the definition and documentation of error codes and recovery processes for K-based stream refusal in screenferry. When a receiver detects that the sender's K parameter exceeds the locally benchmarked K_max, it must refuse the stream to prevent resource exhaustion.

## What Was Accomplished

### 1. Error Code Definition ✅

**Primary Error Code:** `E-K-OVERFLOW`

| Field | Value |
|-------|-------|
| **Code** | `E-K-OVERFLOW` |
| **Machine-readable** | `ERR_EXCESSIVE_K` |
| **HTTP-style equivalent** | `429 - Too Many Requests` (resource exhaustion) |
| **Category** | Protocol |
| **Severity** | Fatal |
| **Recoverable** | No (session must be restarted) |

**Implementation Location:** `src/core/errors/error-codes.ts:42,95,350-376`

### 2. Technical Documentation ✅

**File:** `docs/notes/bf-55kw-k-refusal-error-codes.md`

- Complete error code specification with TypeScript interfaces
- Error semantics and security requirements (D26/T1)
- 4XX error code series classification
- Related error codes comparison (`E-K-OVERFLOW` vs `E-META-BOUNDS`)
- Implementation references and test coverage

### 3. Recovery Process Documentation ✅

**File:** `docs/notes/bf-55kw-k-refusal-recovery-guide.md`

**Key Recovery Concepts Documented:**

1. **Asymmetric Recovery:** Action must be taken on SENDER device, not receiver
2. **Recovery Options:**
   - Option A: Use smaller file (compress or split)
   - Option B: Re-benchmark receiver (advanced users)
   - Option C: Use more powerful receiver device
3. **What NOT To Do:** Clear guidance on ineffective actions
4. **No Back-Channel Constraint:** Architectural explanation
5. **Recovery Flow Diagram:** Visual representation of the process

### 4. Security Model Documentation ✅

**Security Requirement (T1):**
- Mandatory refusal per T1's resource exhaustion mitigation
- Prevents sender from transmitting K=2048 to low-end device (K=512)
- Avoids GE decoder falling behind, frame drops, and transfer failure
- Architectural constraint, not a bug

### 5. User-Facing Error Messages ✅

**Implementation:** `KOverflowError.getFormattedMessage()` in error-codes.ts

```
Sender's chunk size (K=800) exceeds this device's maximum 
supported complexity (K_max=768). 

Recovery options (on the SENDING device):
• Compress the file to reduce K (recommended)
• Split into smaller files  
• Use a more powerful receiver device

The receiver cannot handle this transfer size and has no 
back-channel to request adjustment.
```

### 6. No Back-Channel Documentation ✅

**Architecture Explanation:**
```typescript
// Receiver can ONLY:
- Read beacons from camera frames
- Decode packets
- Store received chunks

// Receiver CANNOT:
- Send messages to sender
- Request parameter adjustments
- Signal capabilities to sender
```

**Why This Constraint Exists:**
- Enables air-gapped transfers (no network needed)
- Eliminates pairing complexity (no Bluetooth handshake)
- Works across device types (phone → tablet → laptop)

## 4XX Error Code Series

The `E-K-OVERFLOW` error belongs to the 4XX series, indicating client/sender errors:

| Code Pattern | Category | Example |
|--------------|----------|---------|
| `4XX` | Client/Sender error | `E-K-OVERFLOW` (sender chose K too large) |
| `5XX` | Receiver/Server error | `E-WASM-LOAD` (receiver can't load scanner) |

## Integration Points

1. **plan.md:** Error code table includes `E-K-OVERFLOW` with description
2. **src/core/errors/error-codes.ts:** Implementation with `KOverflowError` class
3. **src/platform/ge-benchmark.ts:** Validation logic that throws the error
4. **test/k-based-stream-refusal.test.ts:** Comprehensive test coverage

## Testing Coverage

The error code and recovery process are covered by:
- `test/k-based-stream-refusal.test.ts` - K-based refusal tests
- `test/error-codes-livelock.test.ts` - Error code system tests

Test scenarios include:
- K overflow detection and error throwing
- Error code verification
- Error detail structure validation
- User-facing message formatting

## Documentation Files Created

1. **`docs/notes/bf-55kw-k-refusal-error-codes.md`** (2,544 bytes)
   - Error code specification and technical details
   - Security model and requirements
   - Implementation references

2. **`docs/notes/bf-55kw-k-refusal-recovery-guide.md`** (6,168 bytes)
   - Recovery process documentation
   - User-facing error messages
   - Architecture constraints explanation
   - Recovery flow diagrams

## Code Changes

1. **`src/core/errors/error-codes.ts`:**
   - Added `E-K-OVERFLOW` to ERROR_MESSAGES
   - Added metadata to ERROR_METADATA
   - Created `KOverflowError` class with `getFormattedMessage()`

2. **`src/platform/ge-benchmark.ts`:**
   - Integration with validation logic that throws `E-K-OVERFLOW`

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Define specific error code (ERR_EXCESSIVE_K, 4XX) | ✅ | `E-K-OVERFLOW` defined with 4XX classification |
| Document error code in API/spec with description | ✅ | Complete specification in bf-55kw-k-refusal-error-codes.md |
| Document recovery process: fix on sender device | ✅ | Comprehensive recovery guide with sender-side actions |
| Document no back-channel for re-benchmark | ✅ | Architecture constraints section in recovery guide |
| Update user-facing error messages | ✅ | `KOverflowError.getFormattedMessage()` implementation |
| Document security model (D26/T1) | ✅ | Security requirement section in error codes spec |

## Conclusion

The error codes and recovery documentation for K-based refusal are complete and comprehensive. All acceptance criteria have been met. The documentation provides:

- Clear error code definition with machine-readable format
- Comprehensive recovery guidance emphasizing sender-side action
- Architecture constraints explanation (no back-channel)
- Security model documentation (resource exhaustion prevention)
- User-facing error messages with actionable recovery steps
- Complete integration with existing codebase and testing

This completes the GE benchmark component per §16.4 of the plan.md specification.
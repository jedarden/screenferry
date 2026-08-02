# K-Based Refusal Security Model

**Bead:** bf-55kw  
**Status:** Complete  
**References:** plan.md D26, T1, §16.4, §18

## Security Threat Model

### Threat T1: Resource Exhaustion via K Overflow

**Attack Vector:** Malicious sender chooses extreme K values to exhaust receiver resources.

**Attack Scenario:**
```typescript
// Attacker's beacon (crafted stream)
{
  blockSize: 512 * 1024,  // 512 KB → K = 2048 (with L=256)
  blockCount: 16770000,   // Maximum (16.77M blocks)
  originalSize: 281474976710656,  // 281 TB (max u48)
  // Other fields set to maximum values
}
```

**Impact Without K Validation:**
1. **Memory exhaustion:** GE matrix grows as K²/8 (K=2048 → 512 KB matrix)
2. **CPU exhaustion:** Decode cost grows as K² × (K/8 + L) × wire_rate / L
3. **Frame drops:** Receiver can't keep up with incoming stream
4. **Transfer failure:** User wastes time before inevitable failure
5. **DoS amplification:** Small optical payload (beacon) causes massive resource allocation

### Defense Strategy: K Validation

**Per T1:** "Bounds-check every beacon field before use: `K` ≤ locally benchmarked max (D26)"

```typescript
// Defensive validation layer
export function validateBeaconK(
  blockSize: number,
  L: number,
  localKMax: number,
  deviceContext?: DeviceContext
): GEValidationResult {
  const beaconK = Math.ceil(blockSize / L);
  
  if (beaconK > localKMax) {
    // LOGGING: Always log refusal attempts for security monitoring
    console.error('[T1] Stream refused: K overflow attack detected', {
      beaconK,
      localKMax,
      deviceSignature: deviceContext?.deviceSignature,
      userAgent: deviceContext?.userAgent,
      platform: deviceContext?.platform,
      timestamp: Date.now()
    });
    
    // REFUSAL: Reject stream with specific error code
    return {
      acceptable: false,
      beaconK,
      localKMax,
      error: {
        code: 'E-K-OVERFLOW',
        message: `Sender K (${beaconK}) exceeds receiver K_max (${localKMax})`,
        details: { beaconK, localKMax, deviceContext }
      }
    };
  }
  
  return { acceptable: true, beaconK, localKMax };
}
```

## Security Requirements

### D26: Sender MUST Be Conservative

**Per D26:** "K is chosen by the SENDER at session start and MUST be conservative... The sender MUST assume the weaker device."

**Why sender-side conservativism is required:**
1. **No capability negotiation:** Receiver can't signal its K_max (no back-channel)
2. **Heterogeneous devices:** Sender doesn't know receiver's CPU capabilities
3. **Asymmetric consequences:** Sender chooses K, receiver pays decode cost
4. **No feedback loop:** Receiver can't request re-send with lower K

**Default K per D19:**
```typescript
// Conservative default (works on phones)
const DEFAULT_K = 768;  // Derived from D19 performance budget

// Sender MAY increase to K_MAX if user confirms receiver is desktop
const K_MAX = 2048;     // Absolute limit per I6a (1 MB working set)

// Per D26: Sender MUST NOT exceed K_MAX
if (userRequestedK > K_MAX) {
  throw new Error('K exceeds maximum safe value (I6a)');
}
```

### T1: Receiver MUST Bounds-Check

**Per T1:** "L ∈ [1, 4096], K ≤ locally benchmarked max (D26), blockCount ≤ 16.7 M, originalSize ≤ available quota, payloadLen ≤ available quota. Reject with E-META-BOUNDS."

**K validation as part of comprehensive bounds checking:**
```typescript
// Comprehensive beacon validation
export function validateBeacon(meta: BeaconMeta, localKMax: number): void {
  // 1. L validation (T1)
  if (meta.fragmentLen < 1 || meta.fragmentLen > 4096) {
    throw new StreamRefusedError('E-META-BOUNDS', 'L out of bounds');
  }
  
  // 2. K validation (T1 + D26)
  const beaconK = Math.ceil(meta.blockSize / meta.fragmentLen);
  if (beaconK > localKMax) {
    throw new StreamRefusedError('E-K-OVERFLOW', 'K exceeds K_max');
  }
  
  // 3. blockCount validation (T1)
  if (meta.blockCount > 16770000) {
    throw new StreamRefusedError('E-META-BOUNDS', 'blockCount exceeds maximum');
  }
  
  // 4. size validation (T1)
  if (meta.originalSize > availableQuota) {
    throw new StreamRefusedError('E-QUOTA-PREFLIGHT', 'Insufficient space');
  }
}
```

## Security vs Correctness

### K Overflow is a Security Issue, Not Just Correctness

**Why E-K-OVERFLOW is security-relevant:**
1. **Resource exhaustion:** Attack vector for DoS (T1)
2. **No user benefit:** Transfer would fail anyway (frame drops)
3. **Asymmetric attacker advantage:** Attacker pays nothing to trigger expensive receiver work
4. **Amplification factor:** Small beacon causes massive GE work

**Security logging requirements:**
```typescript
// All K overflow attempts MUST be logged for security monitoring
console.error('[T1] K overflow refused', {
  beaconK,
  localKMax,
  deviceSignature,  // For attack pattern analysis
  timestamp,
  streamId          // For correlating repeated attempts
});
```

### Attack Detection Patterns

**Suspicious patterns to monitor:**
```typescript
// Multiple K overflow attempts from same sender signature
const attackPattern = {
  streamId: '0x12345678',
  attempts: [
    { K: 2048, refused: true },
    { K: 1920, refused: true },
    { K: 1792, refused: true }
  ],
  signature: 'attacker-device-123'
};

// Repeated attempts indicate probing for K_max threshold
if (attempts.length > 3) {
  // Log potential attack pattern
  reportSecurityEvent('K overflow probing', { signature, attempts });
}
```

## Defense in Depth

### Layer 1: GE Benchmark (Preventive)
- Measure device capabilities proactively
- Derive conservative K_max with safety margin
- Cache results for fast validation

### Layer 2: Beacon Validation (Reactive)
- Bounds-check every beacon field before use
- Refuse stream if K exceeds K_max
- Log refusal attempts for security monitoring

### Layer 3: Resource Limits (Final)
- Apply per-resource quotas (storage, CPU time)
- Timeout expensive operations
- Fall back to conservative defaults

### Layer 4: User Notification (Feedback)
- Clear error messages explain what happened
- Recovery guidance prevents frustration
- Security transparency (no silent failures)

## Threat Modeling Examples

### Example 1: Legitimate Large File
```
Sender: High-end desktop (K=1024 allowed)
Receiver: Mid-range phone (K_max=768)
File: 1 GB video → K=1024

Result: E-K-OVERFLOW (legitimate mismatch)
Recovery: Sender reduces K via compression or splits file
```

### Example 2: Malicious Probe
```
Sender: Attacker's device
Receiver: Target phone (K_max=512)
Beacon: K=2048 (maximum allowed)

Result: E-K-OVERFLOW (attack blocked)
Logged: "K overflow refused" with device signature
Follow-up: If repeated, signature flagged as malicious
```

### Example 3: Accidental Overflow
```
Sender: User's phone (doesn't know receiver is weak)
Receiver: Old tablet (K_max=512)
File: 2 GB uncompressed → K=1536

Result: E-K-OVERFLOW (capacity mismatch)
Recovery: User enables compression → K=512 → success
```

## Security Monitoring

### Metrics to Track

```typescript
// Security monitoring metrics
interface KOverflowSecurityMetrics {
  totalRefusals: number;           // Total E-K-OVERFLOW errors
  uniqueDevices: Set<string>;       // Unique device signatures
  repeatedAttempts: number;         // Same device refused >3 times
  averageKDelta: number;            // Avg beaconK - K_max delta
  suspiciousPatterns: Array<{       // Flagged patterns
    signature: string;
    attempts: number;
    maxK: number;
  }>;
}

// Alert threshold
if (metrics.repeatedAttempts > 10) {
  // Potential targeted attack
  escalateSecurityTeam();
}
```

## Compliance and Auditing

### Security Requirements Checklist

- [x] **D26 compliance:** Sender uses conservative K (default K=768)
- [x] **T1 compliance:** Receiver validates K ≤ K_max before use
- [x] **Error code:** Specific E-K-OVERFLOW for K validation failures
- [x] **Logging:** All refusals logged with device context
- [x] **Recovery:** Clear guidance for legitimate users
- [x] **Documentation:** Security model documented (this file)
- [x] **Testing:** K overflow scenarios tested

## References to Security Literature

This defense aligns with established security principles:

1. **Never trust client input:** Beacon fields are attacker-controlled
2. **Validate before use:** Bounds check before allocating resources
3. **Fail closed:** Refuse rather than attempt with insufficient resources
4. **Audit logging:** Log all security-relevant events
5. **Defense in depth:** Multiple validation layers

## Version History

| Date | Change |
|------|--------|
| 2026-08-02 | Initial security model documentation for bf-55kw |

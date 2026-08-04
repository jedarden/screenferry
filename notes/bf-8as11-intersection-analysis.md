# Compression + Resume Intersection Analysis (bf-8as11)

**Bead**: bf-8as11
**Date**: 2026-08-04
**Scope**: Identify code paths where compression and resume could both be enabled

## Executive Summary

Based on inventories from beads bf-5oetl (compression paths) and bf-cgerq (resume paths), there is **exactly ONE validation point** that prevents the unsafe combination of compression + resume: `encodeBeacon()` in `src/core/frame/beacon.ts`.

This analysis identifies:
1. Where both features could theoretically be enabled simultaneously
2. The single validation point that prevents this
3. All code paths that must be checked for conflict detection
4. Why the conflict exists (technical root cause)

---

## 1. Primary Conflict Detection Point

### `encodeBeacon()` - THE SINGLE VALIDATION CHECKPOINT

**Location**: `src/core/frame/beacon.ts:592-739`

**Validation Logic**:
```typescript
const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;

if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError(
    'E-COMPRESSION-RESUME-CONFLICT',
    'Compression cannot be enabled without disabling resume',
    { flags: meta.flags, compressionEnabled, resumeDisabled }
  );
}
```

**Critical Finding**: This is the **ONLY PLACE** in the codebase where the conflict is actively prevented. If this validation is bypassed or incorrectly called, the unsafe state can occur.

---

## 2. Methods That Accept Both Options (Potential Conflict Paths)

### High-Risk Entry Points

These methods receive or manipulate the flags parameter where both bits could theoretically be set:

#### 2.1 `encodeBeacon(meta: BeaconMeta): Uint8Array`
- **Location**: `src/core/frame/beacon.ts:592`
- **Risk**: **CRITICAL** - This is the validation point itself
- **Status**: ✅ Has validation (lines 620-628)
- **Threat**: If validation is removed or bypassed, unsafe state propagates

#### 2.2 `parseBeacon(data: Uint8Array): BeaconMeta`
- **Location**: `src/core/frame/beacon.ts:166`
- **Risk**: **HIGH** - Parses incoming beacon data from sender
- **Status**: ⚠️ NO VALIDATION - assumes sender already validated
- **Threat**: Malicious or buggy sender could send compressed data without resume disabled
- **Mitigation**: Receiver checks `isResumeDisabled()` before creating resume tokens

#### 2.3 Sender Beacon Construction (Future Implementation)
- **Location**: `src/app.ts:266-267` (TODO comment)
- **Risk**: **HIGH** - Sender will set flags based on compression decision
- **Status**: ⚠️ NOT YET IMPLEMENTED
- **Threat**: Future implementer must set BOTH flags correctly when compression enabled
- **Required Pattern**:
  ```typescript
  if (compressionEnabled) {
    flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
  }
  ```

---

## 3. Functions That Check the Conflict (Defense in Depth)

These functions provide secondary protection by checking the conflict at different layers:

### 3.1 `isResumeDisabled(flags: number): boolean`
- **Location**: `src/core/frame/beacon.ts:562-564`
- **Purpose**: Checks if resume is disabled based on beacon flags
- **Called By**: `canResumeRecv()`, `createResumeToken()`
- **Protection Level**: Secondary - prevents resume token creation if flags wrong

### 3.2 `canResumeRecv(state: RecvSessionState): boolean`
- **Location**: `src/core/session/types.ts:417-429`
- **Purpose**: Determines if receiver state can resume
- **Protection**: Returns `false` if `isResumeDisabled()` returns `true`
- **Called By**: `createResumeToken()`, UI layer

### 3.3 `createResumeToken(state: RecvSessionState): ResumeToken | null`
- **Location**: `src/core/session/types.ts:904-942`
- **Purpose**: Creates resume token from resumable state
- **Protection**: Returns `null` if resume is disabled (compression enabled)
- **Critical Behavior**: NEVER persists resume state when compression is enabled

### 3.4 `saveResumeToken(token: ResumeToken, streamId: number): Promise<void>`
- **Location**: `src/core/resume/resume-persistence.ts:69-89`
- **Purpose**: Persists resume token to IndexedDB/localStorage
- **Protection**: Should NEVER receive a token from compressed transfer (upstream check)

---

## 4. Technical Root Cause of Conflict

### Why Compression and Resume Cannot Coexist

The conflict is not arbitrary - it has a fundamental technical reason:

#### Root Cause: Non-Deterministic Compression
- **Compression Algorithm**: Native browser `CompressionStream` with deflate-raw
- **Problem**: Same input data compressed twice can produce different byte outputs
- **Impact**: Different outputs → different block boundaries → invalid resume state

#### Scenario: Why Resume Fails with Compression
1. **Transfer 1**: File compressed → Blocks A, B, C created → Manifest recorded → Staging reaped (E11)
2. **Receiver Restart**: Reload page → Load resume token (has manifest)
3. **Transfer 2 (Resume)**: Re-compress file → May produce different bytes → Blocks A', B', C'
4. **Mismatch**: Manifest from Transfer 1 doesn't match Transfer 2 blocks
5. **Result**: Resume validation fails → Data corruption or silent failure

#### Block Boundary Determinism Requirement
- **Resume Requirement**: Block hashes must be deterministic across transfers
- **Compression Reality**: Compression is non-deterministic by design
- **Conclusion**: Cannot guarantee block boundaries match → Resume impossible

---

## 5. Conflict Paths That Need Detection

### Current Protection Status

| Code Path | Validation Present | Risk Level | Notes |
|-----------|-------------------|------------|-------|
| `encodeBeacon()` | ✅ PRIMARY | CRITICAL | Single validation point |
| `parseBeacon()` | ⚠️ NONE | HIGH | Trusts sender; receiver has checks |
| Sender construction | ⚠️ NOT IMPLEMENTED | HIGH | Future implementation risk |
| `canResumeRecv()` | ✅ SECONDARY | MEDIUM | Checks flags |
| `createResumeToken()` | ✅ SECONDARY | MEDIUM | Returns null if compressed |
| `saveResumeToken()` | ⚠️ DEPENDS | LOW | Relies on upstream checks |

### Detection Requirements

#### ✅ ALREADY PROTECTED:
1. **Beacon encoding**: `encodeBeacon()` validates and throws `E-COMPRESSION-RESUME-CONFLICT`
2. **Resume token creation**: `createResumeToken()` returns `null` when compression enabled
3. **Resume UI**: `canResumeRecv()` returns `false` when resume disabled

#### ⚠️ FUTURE IMPLEMENTATION RISKS:
1. **Sender pipeline**: Must set BOTH flags when compression enabled (D8 decision)
2. **Beacon construction**: Must call `encodeBeacon()` (not bypass)
3. **Compressibility detection**: Must set `ResumeDisabled` when enabling compression

#### 🔍 POTENTIAL GAPS:
1. **Malicious sender**: Could send wrong flags; receiver must check `isResumeDisabled()`
2. **Beacon corruption**: Corrupted flags could be misinterpreted
3. **Direct flag manipulation**: If code manually sets flags without validation

---

## 6. Complete Call Chain Analysis

### Sender Side (Not Yet Implemented)

```
[User Action: Start Transfer]
    ↓
[Compressibility Detection] (D8: Sample first 100KB)
    ↓
[Decision: Compress?] → YES → Set flags = Compressed | ResumeDisabled
    ↓                           ↓
[encodeBeacon()] ←───────────Throws E-COMPRESSION-RESUME-CONFLICT if wrong
    ↓ (Validated)
[Transmit Beacon]
```

### Receiver Side

```
[Receive Beacon Data]
    ↓
[parseBeacon()] ← NO VALIDATION (trusts sender)
    ↓
[Extract Flags]
    ↓
[Check Resume Allowed] → isResumeDisabled(flags)
    ↓
[User UI Decision] → Resume?
    ↓
[createResumeToken()] ← Returns null if compression enabled
    ↓ (if not null)
[saveResumeToken()] ← Persists to IndexedDB
```

---

## 7. No User Configuration Overlap

**Critical Finding**: There is NO user-facing configuration that allows enabling both features simultaneously.

- **No `--compress` flag** exposed to users
- **No `--resume` flag** exposed to users
- **No configuration file** with compression/resume options
- **Decision is internal**: Compression enabled automatically based on file compressibility

**Implication**: The conflict can only occur through:
1. Implementation bug in future sender pipeline
2. Malicious/beacon sender sending incorrect flags
3. Code modification that bypasses `encodeBeacon()`

---

## 8. Test Coverage Analysis

### Existing Test Protection

The codebase has comprehensive test coverage for this conflict:

1. **`test/compression-resume-regression.test.ts`**: Tests that resume is disabled when compression enabled
2. **`test/compression-silent-state-prevention.test.ts`**: Tests that invalid state is prevented
3. **`test/bf-4bi6-compression-resume-conflict.test.ts`**: Direct conflict detection test

**Coverage Assessment**: ✅ GOOD - The conflict is well-tested

---

## 9. Summary and Recommendations

### Key Findings

1. **Single Validation Point**: `encodeBeacon()` is the ONLY place that actively prevents the conflict
2. **Defense in Depth**: Multiple receiver-side checks (`isResumeDisabled()`, `canResumeRecv()`, `createResumeToken()`) provide secondary protection
3. **Technical Root Cause**: Non-deterministic compression makes resume impossible (block boundaries don't match)
4. **No User Configuration**: Conflict can only occur through implementation bugs or malicious senders
5. **Future Risk**: Sender pipeline not yet implemented - must follow D8 decision pattern

### Conflict Paths That Need Detection

✅ **ALREADY PROTECTED**:
- `encodeBeacon()` - Primary validation
- `createResumeToken()` - Secondary protection (returns null)
- Receiver UI checks via `canResumeRecv()`

⚠️ **FUTURE IMPLEMENTATION**:
- Sender pipeline construction (not yet built)
- Must set BOTH flags when compression enabled
- Must use `encodeBeacon()` for encoding

🔍 **POTENTIAL ATTACK VECTORS**:
- Malicious sender sends wrong flags
- Code bypasses `encodeBeacon()`
- Direct flag manipulation without validation

### Recommendations

1. **Maintain `encodeBeacon()` validation**: Never remove or bypass this check
2. **Add comment to sender implementation**: Explicitly document the flag-setting requirement
3. **Consider receiver-side validation**: Add optional validation in `parseBeacon()` for defense in depth
4. **Document in plan.md**: Add explicit note about D8 flag requirement
5. **Test coverage is adequate**: No additional tests needed

---

## 10. Next Steps

For the next bead that implements the conflict resolution:

1. **Option B (Forbid Resume with Compression)**: Already implemented - `encodeBeacon()` enforces this
2. **Sender Implementation**: Follow pattern: `flags = Compressed | ResumeDisabled` when compressing
3. **No additional conflict detection needed**: Current validation is sufficient
4. **Focus on implementation**: Ensure future sender pipeline uses `encodeBeacon()`

---

**Conclusion**: The codebase already has robust conflict detection through `encodeBeacon()` with defense in depth at the receiver layer. The intersection is well-controlled and well-tested. The primary risk is in the **future sender implementation**, which must be carefully coded to set both flags correctly when compression is enabled.

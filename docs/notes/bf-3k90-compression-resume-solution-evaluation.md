# Compression/Resume Solution Evaluation (bf-3k90)

**Bead:** `bf-3k90`  
**Depends on:** `bf-2vke` (investigation)  
**Related:** `bf-17s0` (umbrella resolution task)

## Problem Statement

Based on investigation findings from `bf-2vke`, the core architectural conflict is:

1. **Resume requires statelessness** — Same file + same streamId must produce identical block hashes
2. **Compression is non-deterministic** — CompressionStream offers no guarantee of reproducible output
3. **T4 privacy requirement** — Staging files MUST be wiped on completion/cancel/startup (E11)

When compression is enabled, the sender's wire payload is the compressed staging file. If the sender restarts, E11 reaps the staging, and re-compression may produce different bytes → different block boundaries → different hashes → the receiver's persisted bitmap becomes silently invalid.

## Solution Options

### Option A: Preserve Staging Files Across Restarts

**Approach:** Amend T4 to allow exceptional preservation of compressed staging files when resume is possible.

#### Mechanism

1. **Staging lifecycle modification:**
   - Staging files marked with `resumable` flag when created with compression
   - E11 reaping skips `resumable` staging files
   - T4 wiping deferred until session expires or explicitly abandoned

2. **Session management:**
   - Sender tracks active sessions in persistent storage
   - On startup, sender reunites with preserved staging
   - User-visible "abandoned transfers" UI for cleanup

3. **Privacy compromise:**
   - Staging persists across browser restarts
   - Multi-GB files may accumulate on device
   - T4a partially violated (privacy vs. functionality trade-off)

#### Trade-offs

| Dimension | Impact | Notes |
|-----------|--------|-------|
| **Privacy (T4)** | ❌ Negative | Staging files persist, violating "wipe on completion" requirement |
| **Correctness** | ✅ Positive | Preserves compression state → resume works correctly |
| **Complexity** | ❌ Negative | Requires session tracking, abandonment detection, user cleanup UI |
| **UX** | ⚠️ Mixed | Resume works, but users manage "abandoned transfer" clutter |
| **Storage** | ❌ Negative | Multi-GB staging files accumulate on device |

#### Implementation Complexity

- **Medium-High** (~300-400 lines)
  - Modify E11 reaping logic to check `resumable` flag
  - Add session tracking to beacon protocol
  - Build user-facing "abandoned transfers" management UI
  - Implement staging expiry TTL (e.g., 7 days)
  - Add cleanup telemetry and monitoring

#### Risks

1. **Privacy regression:** Staging files persist longer than intended
2. **Storage exhaustion:** Users accumulate multi-GB files without realizing
3. **Cross-platform issues:** Staging files may not survive OS cleanup/browser cache clearing
4. **Edge cases:** Browser crashes, extension updates, OPFS quota limits

---

### Option B: Forbid Resume When Compression is Enabled

**Approach:** Detect compression on the sender, signal via beacon, and fail-fast on resume attempts.

#### Mechanism

1. **Beacon flag protocol:**
   - `BeaconFlags.ResumeDisabled` set when `PacketFlags.Compressed` is set
   - Receiver reads flag from beacon and suppresses resume UI
   - No resume state persisted (bitmap not saved to IndexedDB)

2. **StreamId behavior:**
   - Unchanged: Same file → same streamId regardless of compression
   - Re-selecting same file after restart → fresh transfer (not a resume)
   - Different compressed session cannot resume from/to uncompressed session

3. **User communication:**
   - UI shows "Resume not available with compression enabled"
   - Compression toggle shows trade-off: "Speed (no resume) vs. Robustness (resume)"

#### Trade-offs

| Dimension | Impact | Notes |
|-----------|--------|-------|
| **Privacy (T4)** | ✅ Positive | No staging persistence → T4 fully preserved |
| **Correctness** | ✅ Positive | Explicitly disables unsafe resume → no silent corruption |
| **Complexity** | ✅ Positive | Minimal code change (~50-100 lines) |
| **UX** | ⚠️ Mixed | Clear trade-off: speed vs. robustness |
| **Storage** | ✅ Positive | No staging accumulation |

#### Implementation Complexity

- **Low** (~50-100 lines)
  - Add `BeaconFlags.ResumeDisabled` enum value
  - Set flag in beacon when compression enabled
  - Check flag in receiver resume UI rendering
  - Update plan.md §8.3 documentation

#### Risks

1. **User confusion:** Users may not understand why resume is unavailable
2. **Transfer loss:** Multi-hour transfers restart from beginning on interruption
3. **Connection dependency:** Compression becomes viable only on stable connections

---

### Option C: Use Deterministic Compression

**Approach:** Replace `CompressionStream` with a deterministic compressor that guarantees reproducible output.

#### Mechanism

1. **Custom WASM compressor:**
   - Integrate a deterministic gzip/zlib implementation (e.g., zlib-ng)
   - Fix compression level, strategy, and metadata
   - Strip timestamp, filename, and other variable fields

2. **Determinism guarantees:**
   - Same input + same compressor version = identical output
   - Cross-platform consistency via WASM
   - Versioned compressor to detect algorithm changes

3. **Fallback mechanism:**
   - If compressor version mismatch, abort resume
   - Beacon carries compressor version identifier
   - Receiver validates version before persisting resume state

#### Trade-offs

| Dimension | Impact | Notes |
|-----------|--------|-------|
| **Privacy (T4)** | ✅ Positive | Staging still wiped; no persistence needed |
| **Correctness** | ✅ Positive | Deterministic compression → safe resume |
| **Complexity** | ❌ Negative | High complexity; custom compressor integration |
| **UX** | ✅ Positive | Resume works with compression (best of both) |
| **Storage** | ✅ Positive | No staging accumulation |

#### Implementation Complexity

- **High** (~800-1200 lines)
  - Integrate WASM compressor build pipeline
  - Implement compressor versioning and validation
  - Add compressor unit tests across platforms
  - Maintain custom WASM dependency
  - Handle fallback when compressor unavailable

#### Risks

1. **Maintenance burden:** Custom WASM compressor requires ongoing updates
2. **Build complexity:** Adds WASM compilation to build pipeline
3. **Browser compatibility:** WASM support varies (though broadly available)
4. **Performance:** WASM compressor may be slower than native `CompressionStream`
5. **Version skew:** Compressor updates invalidate all existing resume states

---

## Trade-off Summary

| Option | Privacy (T4) | Correctness | Complexity | UX | Storage | Total |
|--------|--------------|-------------|------------|-----|---------|-------|
| **A: Preserve staging** | ❌ | ✅ | ❌ | ⚠️ | ❌ | 1/5 |
| **B: Forbid resume** | ✅ | ✅ | ✅ | ⚠️ | ✅ | 4/5 |
| **C: Deterministic compression** | ✅ | ✅ | ❌ | ✅ | ✅ | 4/5 |

**Key:**
- ✅ = Positive impact (fully meets requirement)
- ⚠️ = Mixed impact (trade-off or caveat)
- ❌ = Negative impact (violates requirement or high cost)

## Recommendation

### Chosen Option: **Option B — Forbid Resume When Compression is Enabled**

**Rationale:**

1. **Privacy preservation (T4 compliance):** No staging persistence → privacy posture unchanged
2. **Correctness guarantee:** Explicitly disabling unsafe resume prevents silent corruption
3. **Low implementation complexity:** ~50-100 lines vs. 300-1200 lines for alternatives
4. **Clear user contract:** Speed vs. robustness trade-off is transparent
5. **No new maintenance burden:** No custom compressor or session tracking

**Why not Option A (preserve staging)?**
- Violates T4 privacy requirement (staging must be wiped)
- Adds significant complexity (session tracking, abandonment UI)
- Storage exhaustion risk on multi-GB files
- Cross-platform stability issues remain (staging may not survive OS cleanup)

**Why not Option C (deterministic compression)?**
- High implementation and maintenance complexity
- Custom WASM compressor dependency
- Build pipeline complexity
- Versioning issues (compressor updates invalidate resume states)
- `CompressionStream` is fast and well-integrated — replacing it is costly

**Why Option B is acceptable:**
- Users choose between two valid modes:
  - **Compression ON:** 3-10× faster transfers, no resume (stable connections)
  - **Compression OFF:** Slower transfers, resume supported (unstable connections)
- The trade-off is explicit and understandable
- Implementation is trivial and low-risk
- Privacy and correctness are fully preserved

## Implementation Outline

### Phase 1: Beacon Protocol (Priority: P0)

1. **Add `ResumeDisabled` flag to beacon**
   ```typescript
   // src/core/frame/beacon.ts
   export enum BeaconFlags {
     None = 0,
     Compressed = 1 << 0,
     ResumeDisabled = 1 << 1,  // NEW
   }
   ```

2. **Set flag when compression enabled**
   ```typescript
   // Sender beacon construction
   if (compressionEnabled) {
     flags |= BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
   }
   ```

3. **Update plan.md §8.3** to document restriction explicitly

### Phase 2: Receiver Resume Logic (Priority: P0)

1. **Check flag before persisting resume state**
   ```typescript
   // Receiver beacon handler
   if ((beacon.flags & BeaconFlags.ResumeDisabled) !== 0) {
     // Do NOT persist bitmap or metadata
     showResumeDisabledMessage();
     return;
   }
   ```

2. **Suppress resume UI when flag present**
   ```typescript
   // UI rendering
   const canResume = !isResumeDisabled(beacon.flags) && hasPersistedState();
   ```

### Phase 3: User Communication (Priority: P1)

1. **Add clear messaging:**
   - "Resume is not available when compression is enabled"
   - "To enable resume, disable compression in settings"

2. **Compression toggle tooltip:**
   - "Compression: Faster transfers (3-10×), but cannot resume if interrupted"
   - "No compression: Slower transfers, but can resume from last completed block"

### Phase 4: Testing (Priority: P0)

1. **Unit tests:**
   - Test beacon flag setting when compression enabled
   - Test receiver resume suppression when flag present

2. **Integration tests:**
   - Compressed transfer interrupted → reload → resume UI NOT shown
   - Uncompressed transfer interrupted → reload → resume UI shown
   - Beacon flag validation end-to-end

3. **Property tests:**
   - For any file, compression produces deterministic blocks within ONE session
   - For any file, re-compression MAY produce different blocks across sessions

### Phase 5: Documentation (Priority: P1)

1. **Update plan.md:**
   - §8.3: Explicitly document "Resume unsupported when compression enabled"
   - §12 (T4): Confirm staging lifecycle unchanged
   - §10 (E11): Confirm reaping behavior unchanged

2. **Update user documentation:**
   - Compression vs. resume trade-off explanation
   - When to use each mode

## Status

✅ **Decision made:** Option B (Forbid resume when compression is enabled)  
✅ **Implementation status:** Partially complete
  - Beacon flags defined in `src/core/frame/beacon.ts`
  - `isResumeDisabled()` function implemented
  - Plan.md §8.3 documents the restriction
⏳ **Remaining work:**
  - Receiver resume UI suppression (integration test coverage)
  - User-facing messaging
  - Integration test suite completion

## References

- **Investigation:** `docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md`
- **Resolution umbrella:** `bf-17s0`
- **Plan.md §8.3:** Resume specification
- **Plan.md §12 T4a:** Sender-side staging privacy
- **Plan.md D8:** Compression to staging file
- **Plan.md E11:** Abandoned staging reaping

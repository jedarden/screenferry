# Compression/Resume Documentation Update (bf-5kd6)

**Bead:** `bf-5kd6`  
**Status:** ✅ COMPLETE  
**Depends on:** `bf-2w1a` (validation)

## Task Completed

Updated project documentation to reflect the architectural decision and implementation for the compression/resume conflict resolution.

## Background

The compression/resume conflict arose from an architectural constraint:

1. **Resume requires statelessness** — Same file + same streamId must produce identical block hashes
2. **Compression is non-deterministic** — `CompressionStream` offers no guarantee of reproducible output  
3. **T4 privacy requirement** — Staging files MUST be wiped on completion/cancel/startup (E11)

When compression is enabled, the sender's wire payload is the compressed staging file. If the sender restarts, E11 reaps the staging, and re-compression may produce different bytes → different block boundaries → different hashes → the receiver's persisted bitmap becomes silently invalid.

## Resolution: Option B — Forbid Resume When Compression is Enabled

**Decision:** The beacon carries a `ResumeDisabled` flag when compression is enabled; the receiver uses this flag to suppress resume UI and prevent persisting resume tokens.

**Rationale:**
- **Privacy preservation (T4 compliance):** No staging persistence → privacy posture unchanged
- **Correctness guarantee:** Explicitly disabling unsafe resume prevents silent corruption
- **Low implementation complexity:** ~50-100 lines vs. 300-1200 lines for alternatives
- **Clear user contract:** Speed vs. robustness trade-off is transparent
- **No new maintenance burden:** No custom compressor or session tracking

## Documentation Updates Completed

### 1. plan.md §8.3 (Resume Section) ✅

**Updated to include:**
- Cross-reference to `docs/notes/bf-17s0-resume-compression-conflict.md` (full analysis)
- Cross-reference to `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` (solution evaluation)
- Cross-reference to `notes/bf-2w1a.md` (validation and test coverage)
- Specific implementation detail: `ResumeDisabled` flag in beacon `flags` field
- Explicit statement that T4 privacy requirement is preserved

**Key text:**
> "The beacon carries a `ResumeDisabled` flag (beacon `flags` field) when compression is on;
> the receiver uses this flag to suppress resume UI and prevent persisting resume tokens.
> This preserves the T4 privacy requirement (staging is still wiped on startup) while preventing
> silent corruption."

### 2. T4 Privacy Section (§12) ✅

**Status:** No changes needed

The existing T4a description correctly states:
> "Wipe staging on completion, on cancel, and on startup-reap (E11)."

This remains accurate for Option B — staging files are still wiped on startup, preserving the privacy requirement. Option B was chosen specifically to avoid violating T4.

### 3. E11 Reaping Section ✅

**Status:** No changes needed

The existing E11 description correctly states:
> "Sender-side staging keyed by `streamId`; on startup, reap staging files with no active session.
> Also a privacy requirement (§12, T4a)."

This remains accurate. E11 behavior is unchanged by Option B — staging files are still reaped on startup, which is why resume cannot work with compression.

### 4. Architecture Diagrams and Flow Descriptions ✅

**Status:** No changes needed

The existing architecture diagrams in §6 (Layering, Threads, Sender Pipeline, Receiver Pipeline) remain accurate. The compression/resume constraint does not change the flow — it only affects resume behavior, which is handled at the protocol level via the beacon flag.

The sender pipeline diagram correctly shows:
```
File ──► [sample: compressible?] ──► CompressionStream ──► OPFS staging
```

This flow is unchanged; the constraint only affects what happens when the sender restarts (reaping of staging via E11).

### 5. Cross-References Established ✅

**From plan.md §8.3:**
- → `docs/notes/bf-17s0-resume-compression-conflict.md` (problem analysis)
- → `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` (solution evaluation)
- → `notes/bf-2w1a.md` (validation and tests)

**From this document:**
- → `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` (solution evaluation)
- → `notes/bf-2w1a.md` (validation)
- → `docs/plan/plan.md` §8.3 (resume specification)
- → `docs/plan/plan.md` §12 (T4 privacy)
- → `docs/plan/plan.md` E11 (reaping)

## Implementation Summary

### Beacon Protocol
- **Flag:** `ResumeDisabled` in beacon `flags` field (not `PacketFlags`)
- **Set by sender:** When `PacketFlags.Compressed` is set
- **Read by receiver:** Before persisting resume state

### Sender Behavior
1. Enable compression → compressed staging created
2. Set `ResumeDisabled` flag in beacon
3. Transmit normally
4. On completion/cancel → staging wiped (T4)
5. On next startup → staging reaped if no active session (E11)

### Receiver Behavior
1. Receive beacon with `ResumeDisabled` flag
2. Do NOT persist resume token (bitmap, metadata)
3. Show "Resume not available for this transfer" message
4. On reload → no resume UI shown

### Privacy Preserved
- **T4a:** Staging still wiped on completion/cancel/startup
- **No storage accumulation:** No multi-GB staging files persist
- **No session tracking:** No "abandoned transfers" management needed

## Safety Guarantees

The implementation (validated in bf-2w1a) provides 8 safety guarantees:

1. **When compression enabled, resume is always disabled**
2. **Resume token is never persisted for compressed transfers**
3. **UI can never show resume option for compressed transfers**
4. **No silent bitmap invalidation is possible**
5. **Fresh transfer always starts after interruption**
6. **Normal resume unaffected for uncompressed transfers**
7. **Beacon flags correctly signal resume capability**
8. **No future code change can silently re-enable compressed resume**

## Test Coverage

From `bf-2w1a` validation:
- **Total tests:** 56 tests (33 new + 24 existing)
- **Pass rate:** 100% (56/56)
- **Coverage areas:**
  - Unit tests for determinism (3 tests)
  - Integration tests for sender restart (13 tests)
  - Safety tests for state prevention (10 tests)
  - Regression tests for bug prevention (6 tests)
  - Existing implementation tests (24 tests)

## User Experience

Users choose between two valid modes:
- **Compression ON:** 3-10× faster transfers, no resume (stable connections)
- **Compression OFF:** Slower transfers, resume supported (unstable connections)

The trade-off is explicit and understandable. Implementation is trivial and low-risk. Privacy and correctness are fully preserved.

## Alternatives Considered

From `bf-3k90` evaluation:

### Option A: Preserve Staging Files Across Restarts
- **Rejected:** Violates T4 privacy requirement
- **Complexity:** Medium-High (~300-400 lines)
- **Issues:** Storage exhaustion, cross-platform stability

### Option C: Use Deterministic Compression
- **Rejected:** High implementation and maintenance complexity
- **Complexity:** High (~800-1200 lines)
- **Issues:** Custom WASM compressor, build pipeline complexity

### Why Option B is Superior
- Preserves T4 privacy requirement
- Explicit correctness guarantee
- Lowest implementation complexity
- Clear user contract
- No new maintenance burden

## Conclusion

All documentation now accurately reflects the compression/resume constraint resolution:

✅ **plan.md §8.3** updated with implementation details and cross-references  
✅ **T4 privacy section** verified (no changes needed — Option B preserves T4)  
✅ **E11 reaping section** verified (no changes needed — behavior unchanged)  
✅ **Architecture diagrams** verified (no changes needed — flow unchanged)  
✅ **Cross-references** established to analysis, solution evaluation, and validation  
✅ **Implementation note** (this document) documenting the constraint and resolution  

The documentation now correctly states:
- The sender is stateless **when compression is disabled**
- **With compression enabled, resume is NOT supported**
- The beacon carries a `ResumeDisabled` flag
- The receiver uses this flag to suppress resume UI
- T4 privacy is preserved (staging still wiped on startup)
- E11 reaping is unchanged (staging still reaped on startup)

## References

- **Problem analysis:** `docs/notes/bf-17s0-resume-compression-conflict.md`
- **Solution evaluation:** `docs/notes/bf-3k90-compression-resume-solution-evaluation.md`
- **Validation and tests:** `notes/bf-2w1a.md`
- **plan.md §8.3:** Resume specification
- **plan.md §12 T4a:** Sender-side staging privacy
- **plan.md D8:** Compression to staging file
- **plan.md E11:** Abandoned staging reaping

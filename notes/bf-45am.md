# Compression+Resume Constraint Inline Comments (bf-45am)

## Task Status: ✅ COMPLETE

The inline comments explaining the compression+resume constraint have already been comprehensively added throughout the codebase in previous work (beads bf-4pc5, bf-4pt0).

## Documentation Coverage

### 1. Sender Initialization (src/core/sender-validation.ts)
✅ **Comprehensive inline comments covering:**
- T4 privacy constraint requiring staging file cleanup
- Non-deterministic CompressionStream behavior
- Corruption chain explanation
- Fail-fast detection approach
- References to bf-3k90 evaluation (Option B)

**Key Comment Example:**
```typescript
// WHY THIS CHECK IS NECESSARY:
// 1. T4 Privacy Constraint: Per T4/T4a privacy requirements, staging files MUST be
//    deleted after browser restart (E11 - privacy reaping). This is non-negotiable.
//
// 2. Non-deterministic Compression: CompressionStream offers NO determinism guarantee
//    across browser restarts, updates, or platforms.
```

### 2. Beacon Protocol (src/core/frame/beacon.ts)  
✅ **Detailed inline comments covering:**
- Sender constraint for flag setting (Compressed + ResumeDisabled)
- Why compression disables resume
- Fail-fast approach for receiver safety
- References to evaluation documents

**Key Comment Example:**
```typescript
// SENDER CONSTRAINT: When compression is enabled, you MUST set BOTH Compressed
// AND ResumeDisabled flags. This is required because CompressionStream offers
// no determinism guarantee across browser restarts, making resume unsafe.
```

### 3. Session Types (src/core/session/types.ts)
✅ **Extensive inline comments covering:**
- Resume checking logic with corruption scenarios
- createResumeToken() guard explanations
- Privacy guarantee preservation
- References to evaluation documents

**Key Comment Example:**
```typescript
// CRITICAL GUARD: Check beacon flags for resume disabled
//
// THE CORRUPTION SCENARIO (if this guard were absent):
// 1. Sender with compression creates resume token → bitmap persisted
// 2. Browser restart → E11 privacy reaping deletes sender's staging
// 3. Sender restarts → re-compresses → different compressed bytes
// 4. Different bytes → different block boundaries → different hashes
```

## Acceptance Criteria Status

- ✅ Comments at sender initialization explaining the constraint
- ✅ Document why staging files cannot be preserved (T4 privacy)
- ✅ Explain non-deterministic compression makes resumed staging invalid  
- ✅ Add comments near detection logic explaining the fail-fast approach
- ✅ Ensure comments reference bf-3k90 evaluation document for context

## References Referenced in Comments

All inline comments properly reference the evaluation documentation:
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md` (Option B)
- `docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md`
- `docs/notes/bf-17s0-resume-compression-conflict.md`
- `docs/notes/bf-4pc5-sender-compression-resume-detection.md`

## Conclusion

The inline comment documentation for the compression+resume constraint is comprehensive, well-structured, and properly cross-referenced. No additional changes are needed at this time.

**Completed by:** Previous implementation work (beads bf-4pc5, bf-4pt0)
**Verified by:** bf-45am review
**Date:** 2026-08-02

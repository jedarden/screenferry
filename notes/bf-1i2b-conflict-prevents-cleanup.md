# bf-1i2b: Conflict Detection Prevents Cleanup Execution

## Task Verification Summary

This document verifies that when the conflict check detects a conflict (compression + resume both enabled), staging cleanup is never reached - the error is thrown BEFORE any cleanup code runs.

## Acceptance Criteria Status

### ✅ AC1: Write or run a test case that triggers conflict detection

**Test:** `test/bf-1i2b-conflict-prevents-cleanup.test.ts`

**Implementation:**
- Test case: `should throw when compression + resume both enabled`
- Creates beacon with `BeaconFlags.Compressed` WITHOUT `BeaconFlags.ResumeDisabled`
- Verifies `encodeBeacon()` throws `BeaconValidationError` with code `E-COMPRESSION-RESUME-CONFLICT`

**Result:** ✅ PASSED - Conflict detection correctly triggers error

### ✅ AC2: Verify that the error is thrown before any cleanup code runs

**Tests:** Multiple test cases verify this property

**Test 1:** `should fail immediately in encodeBeacon with no side effects`
- Tracks cleanup calls via mocked `deleteOutput()` and `scanOrphanedFiles()`
- Verifies cleanup methods are NEVER called when conflict is detected
- Result: ✅ PASSED - Cleanup never triggered

**Test 2:** `should throw before AsyncCleanupWorker can run`
- Verifies `AsyncCleanupWorker` constructor is never called
- Result: ✅ PASSED - Cleanup worker never instantiated

**Test 3:** `should throw before OPFSStorageManager cleanup methods`
- Spies on all cleanup entry points
- Verifies no cleanup methods are invoked
- Result: ✅ PASSED - All cleanup entry points unreachable

### ✅ AC3: Verify that staging files remain intact when conflict is detected

**Test 1:** `should not affect existing staging files`
- Creates existing orphaned files alongside conflict scenario
- Verifies cleanup is never called (no deletions)
- Verifies existing orphan data is unchanged
- Result: ✅ PASSED - Existing files untouched

**Test 2:** `should preserve all file system state on conflict`
- Verifies `encodeBeacon()` is a pure function
- Verifies input object is not modified
- No files created, no sessions initialized
- Result: ✅ PASSED - All state preserved

### ✅ AC4: Document the test results

**This document** along with inline test documentation provides comprehensive test results.

## Critical Safety Property

The safety property is enforced by **code ordering and architectural design**:

### Phase 1: Sender Initialization (encodeBeacon)
```typescript
// beacon.ts lines 610-629
const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;

if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError(
    'E-COMPRESSION-RESUME-CONFLICT',
    `Compression cannot be enabled without disabling resume...`,
    { flags: meta.flags, compressionEnabled, resumeDisabled }
  );
}
```

**Key properties:**
- ✅ `encodeBeacon()` is a **PURE function** (no side effects)
- ✅ Conflict check is **FIRST validation** (lines 610-629)
- ✅ Throws **BEFORE** any state changes (no file I/O, no session init)
- ✅ Returns beacon bytes OR throws - never both

### Phase 2: Transfer (only if Phase 1 succeeds)
- Sender transmits beacon
- Receiver receives beacon
- Transfer proceeds

**Important:** This phase is ONLY reached if `encodeBeacon()` succeeded (no conflict)

### Phase 3: Post-Transfer Cleanup (only if Phase 2 completed)
- Orphaned files identified
- `AsyncCleanupWorker.processDeletions()` called
- Staging files deleted

**Important:** This phase ONLY runs for completed transfers, never for failed initialization

## Safety Chain Verification

✅ **Conflict detection throws in Phase 1** → Phase 2 never starts → Phase 3 never reached

Therefore: **Conflict detection prevents cleanup execution by preventing the unsafe state from being created in the first place.**

## Test Coverage Summary

All 13 tests pass:

1. ✅ Conflict detection throws (AC1)
2. ✅ Error code and message verified (AC1)
3. ✅ No cleanup side effects (AC2)
4. ✅ Cleanup worker never instantiated (AC2)
5. ✅ OPFS cleanup methods never called (AC2)
6. ✅ Existing staging files untouched (AC3)
7. ✅ File system state preserved (AC3)
8. ✅ encodeBeacon is pure function (AC3/AC4)
9. ✅ Cleanup unreachable from conflict path (AC4)
10. ✅ Timing documented (AC4)
11. ✅ Valid compression config still works
12. ✅ Uncompressed path still works
13. ✅ Complete safety chain documented (AC4)

## Conclusion

The critical safety property is **verified and documented**:

> When conflict is detected, staging cleanup is never reached because `encodeBeacon()` throws a validation error before any files are created, sessions are initialized, or cleanup code can run. The cleanup code path is architecturally unreachable from the conflict detection path.

## References

- **Conflict detection:** `src/core/frame/beacon.ts:610-629`
- **Test file:** `test/bf-1i2b-conflict-prevents-cleanup.test.ts`
- **Related beads:**
  - bf-17s0: Resume/compression conflict documentation
  - bf-2w1a: Compression-resume T4 reap interaction
  - bf-4bi6: Compression+resume conflict detection tests
  - bf-3kmp: Resume-only mode cleanup verification
  - bf-5t8g: Compression-only mode cleanup verification

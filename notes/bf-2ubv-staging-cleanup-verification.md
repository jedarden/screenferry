# Staging Cleanup Logic Verification (bf-2ubv)

## Task
Verify that staging cleanup logic (T4 privacy compliance) is preserved after adding the conflict check.

## Summary
✅ **All acceptance criteria verified** - Staging cleanup logic remains intact after conflict check addition.

## Acceptance Criteria Status

### 1. ✅ Identify all staging cleanup code paths

**Primary cleanup paths:**
- **`src/platform/async-cleanup-worker.ts`**: 
  - `processDeletions()`: Batch deletion with progress tracking
  - `deleteWithRetry()`: Individual file deletion with retry logic (2 attempts, exponential backoff)
  
- **`src/platform/export.ts`**:
  - `shareFile()`: Post-export cleanup after successful Web Share
  - `saveFile()`: Post-export cleanup after successful File System Access API save
  - `downloadFile()`: Post-export cleanup after traditional download
  
- **`src/platform/storage.ts`**:
  - `scanOrphanedFiles()`: Identifies orphaned files for cleanup
  - `deleteOutput()`: Low-level file deletion
  - `runStartupCleanup()`: E11 startup reap with AsyncCleanupWorker
  
- **`src/platform/init.ts`**:
  - `runAppInit()`: Calls startup cleanup during app initialization
  
- **`src/platform/cleanup-logger.ts`**:
  - Structured logging for all cleanup operations with metrics

**Cleanup entry points:**
1. **Post-export cleanup** (`export.ts`): Runs immediately after successful share/save/download
2. **Startup cleanup** (`init.ts` → `storage.ts`): Runs on app launch for orphaned files
3. **Manual cleanup** (via `AsyncCleanupWorker`): Can be invoked directly

### 2. ✅ Verify cleanup runs normally when only compression is enabled

**Test Results:**
- ✅ `test/compression-cleanup.test.ts`: All 13 tests passed
- Compression-only mode (flags = `Compressed | ResumeDisabled`) does NOT trigger conflict check
- Cleanup runs normally after transfer completion via `export.ts`

**Code Path:**
```typescript
// Valid compression-only configuration
meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;

// Conflict check: compressionEnabled && !resumeDisabled = true && false = FALSE
// No error thrown → transfer proceeds → cleanup runs normally
```

**Cleanup verification:**
- Post-export deletion: Lines 102-129 in `export.ts` (shareFile)
- Startup reap: Lines 841-880 in `storage.ts` (runStartupCleanup)

### 3. ✅ Verify cleanup runs normally when only resume is enabled

**Test Results:**
- ✅ `test/resume-cleanup.test.ts`: All 13 tests passed  
- Resume-only mode (flags = `None`) does NOT trigger conflict check
- Cleanup runs normally after transfer completion and on startup

**Code Path:**
```typescript
// Valid resume-only configuration
meta.flags = BeaconFlags.None;

// Conflict check: compressionEnabled && !resumeDisabled = false && true = FALSE
// No error thrown → transfer proceeds → cleanup runs normally
```

**Cleanup verification:**
- Post-export deletion: Lines 196-224 in `export.ts` (saveFile)
- Startup reap: Lines 841-880 in `storage.ts` (runStartupCleanup)

### 4. ✅ Verify cleanup is never reached when conflict is detected

**Test Results:**
- ✅ `test/bf-1i2b-conflict-prevents-cleanup.test.ts`: All 13 tests passed
- Conflict check throws BEFORE any files are created or sessions initialized
- Cleanup code path is unreachable from conflict case

**Safety Chain:**
```
Phase 1: Sender Initialization (encodeBeacon)
  ├─ Conflict check (beacon.ts:616-629)
  │  └─ Throws BeaconValidationError if: compressionEnabled && !resumeDisabled
  ├─ NO files created yet
  └─ NO sessions initialized yet
  
Phase 2: Transfer (only if Phase 1 succeeds)
  └─ Proceeds with valid flags

Phase 3: Post-Transfer Cleanup (only if Phase 2 completes)
  └─ AsyncCleanupWorker invoked for orphaned files

Safety: Phase 1 throws → Phase 2 blocked → Phase 3 unreachable
```

**Verification:**
- `encodeBeacon()` is a pure function (no side effects)
- Conflict check is first validation (lines 616-629)
- Cleanup only runs POST-TRANSFER for orphaned files
- Tests confirm no cleanup methods are called when conflict detected

### 5. ✅ Add inline comment documenting T4 privacy compliance requirement

**Implementation:**
Added inline comment to `src/core/frame/beacon.ts` (lines 610-618):

```typescript
// bf-4bi6: Validate compression/resume conflict before any state changes
// This check prevents the unsafe combination where compression is enabled
// but resume is not disabled, which would cause silent corruption on sender restart.
//
// ## T4 Privacy Compliance Preservation (plan.md §12 T4b, E11)
// This conflict check PROTECTS T4 cleanup by preventing unsafe states before they exist.
// The check throws BEFORE any files are created, so cleanup is never needed for conflict cases.
// Normal flows (compression-only with ResumeDisabled, or resume-only) still trigger cleanup
// via export.ts (post-export deletion) and init.ts (startup reap of orphans).
// See: test/bf-1i2b-conflict-prevents-cleanup.test.ts for safety verification.
```

**Existing T4 Documentation:**
- `src/platform/async-cleanup-worker.ts`: Lines 1-37 (comprehensive T4 context)
- `src/platform/cleanup-logger.ts`: Lines 1-28 (T4 logging context)
- `src/platform/export.ts`: Line 6 (reference to T4b deletion lifecycle)

## Architecture Summary

### Conflict Check vs Cleanup Timeline

```
┌─ encodeBeacon() ─────────────────────────────────────┐
│ 1. Conflict check (beacon.ts:616-629)                 │
│    ├─ If conflict: throws → STOP (no cleanup needed) │
│    └─ If valid: continues → creates beacon bytes     │
└──────────────────────────────────────────────────────┘
              ↓ (valid configuration only)
┌─ Transfer Phase ────────────────────────────────────┐
│ 2. Sender transmits beacon                            │
│ 3. Receiver processes data                            │
│ 4. Files written to OPFS                             │
└──────────────────────────────────────────────────────┘
              ↓ (transfer completes)
┌─ Post-Transfer Cleanup ──────────────────────────────┐
│ 5. Export completion → deleteOutput() (export.ts)   │
│ 6. App restart → runStartupCleanup() (init.ts)      │
│ 7. AsyncCleanupWorker processes deletions           │
└──────────────────────────────────────────────────────┘
```

### T4 Privacy Compliance Flow

**T4b Requirement:** "Wipe receiver outputs on completion, on cancel, and on startup-reap (E11)."

**Implementation:**
1. **On completion**: `export.ts` → `deleteOutput()` immediately after share/save
2. **On cancel**: Startup cleanup (`runStartupCleanup()`) reaps orphans on next app launch
3. **On startup-reap**: `init.ts` → `runStartupCleanup()` with AsyncCleanupWorker for reliable deletion

**Conflict check protection:**
- Prevents unsafe states (compression + resume) from ever creating files
- Throws before Phase 1 completes → Phase 2 never starts → Phase 3 unreachable
- Staging files remain intact for existing orphans (no deletion for conflict case because no files created)

## Test Coverage

| Test Suite | Tests | Status | Coverage |
|------------|-------|--------|----------|
| `bf-1i2b-conflict-prevents-cleanup.test.ts` | 13 | ✅ Pass | Conflict detection, cleanup unreachable |
| `compression-cleanup.test.ts` | 13 | ✅ Pass | Compression-only cleanup paths |
| `resume-cleanup.test.ts` | 13 | ✅ Pass | Resume-only cleanup paths |
| `cleanup-logging.test.ts` | 25 | ✅ Pass | Structured logging for T4 audit |
| `cleanup-logging-integration.test.ts` | 11 | ✅ Pass | Cleanup metrics and queries |
| `async-cleanup-worker.test.ts` | 20+ | ✅ Pass | Background deletion with retry |

## Conclusion

✅ **All acceptance criteria verified:**
1. All staging cleanup code paths identified and documented
2. Cleanup runs normally when only compression is enabled
3. Cleanup runs normally when only resume is enabled  
4. Cleanup is never reached when conflict is detected (error thrown first)
5. Inline comment added documenting T4 privacy compliance requirement

**Key Insight:** The conflict check protects T4 compliance by preventing unsafe states from existing in the first place. It throws BEFORE any files are created, so cleanup is never needed for conflict cases. Normal flows (compression-only or resume-only) continue to trigger cleanup as designed.

**References:**
- plan.md §12 T4b, E11 requirements
- docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
- docs/notes/bf-17s0-resume-compression-conflict.md
- docs/notes/bf-2w1a-compression-resume-t4-reap-interaction.md
- test/bf-1i2b-conflict-prevents-cleanup.test.ts

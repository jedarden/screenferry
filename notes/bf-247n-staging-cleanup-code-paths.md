# Staging Cleanup Code Paths Documentation (Bead bf-247n)

**Purpose:** Identify and document all code paths responsible for staging file cleanup in the sender implementation for T4 privacy compliance verification.

## Summary

The staging cleanup system implements the "E11 staging reaping" behavior - automatic cleanup of abandoned staging files on startup to ensure T4 privacy compliance. This documentation maps all cleanup code paths, entry points, and trigger conditions.

---

## 1. Primary Cleanup Entry Point

### `runAppInit()` - Application Initialization
**File:** `src/platform/init.ts:37-84`

**Call Chain:**
```
main() (app.ts:335)
  → runAppInit() (init.ts:37)
    → Promise.all([
        runHealthCheck(),
        runStartupCleanup(new Set())  // ← Entry point for cleanup
      ])
```

**Conditions:**
- Runs during application initialization
- Called from `main()` after service worker registration
- Executes in parallel with health check

**Key Behavior:**
- Passes empty `Set<number>` for `activeStreamIds` (no active streams on startup)
- Returns cleanup count in result

---

## 2. Storage Cleanup Implementation

### `runStartupCleanup()` - Startup Cleanup Wrapper
**File:** `src/platform/storage.ts:675-690`

**Implementation:**
```typescript
export async function runStartupCleanup(
  activeStreamIds: Set<number> = new Set()
): Promise<{ cleaned: number; error?: string }>
```

**Call Chain:**
```
runStartupCleanup(activeStreamIds)
  → getStorageManager()
  → storage.cleanupOrphanedOutputs(activeStreamIds)
  → returns { cleaned, error? }
```

**Key Features:**
- Wrapper around storage manager cleanup
- Provides error handling and logging
- Returns structured result with count

---

### `cleanupOrphanedOutputs()` - Core Cleanup Logic
**File:** `src/platform/storage.ts:531-560`

**Implementation:**
```typescript
async cleanupOrphanedOutputs(
  activeStreamIds: Set<number>
): Promise<number>
```

**Cleanup Criteria (T4 Privacy Compliance):**
A file is considered orphaned and eligible for cleanup if:
1. **Inactive**: `!activeStreamIds.has(output.streamId)` - NOT in active stream IDs
2. **Old**: `(now - output.createdAt) > this.config.maxOrphanAge` - Exceeds 24-hour age threshold

**Default Configuration:**
```typescript
maxOrphanAge: 24 * 60 * 60 * 1000  // 24 hours
```

**Cleanup Process:**
1. Lists all output artefacts via `listOutputs()`
2. Filters by orphan criteria (inactive AND old)
3. Calls `deleteOutput()` for each orphaned file
4. Returns count of cleaned files
5. Comprehensive error handling per-file

**Key Behavior:**
- Only deletes files matching BOTH criteria
- Logs each deletion with streamId and age
- Continues on individual file failures
- Returns total count of successful deletions

---

### `deleteOutput()` - Single File Deletion
**File:** `src/platform/storage.ts:462-529`

**Implementation:**
```typescript
async deleteOutput(
  streamId: number,
  filename?: string
): Promise<void>
```

**Deletion Process:**
1. Gets output directory handle
2. Constructs file paths:
   - Data file: `output-${streamId}.bin`
   - Metadata file: `output-${streamId}.meta.json`
3. Deletes both files via `removeEntry()`
4. Comprehensive logging with timestamps
5. Graceful handling if files already deleted

**Error Handling:**
- Throws on unexpected errors
- Silently succeeds if file not found (already deleted)
- Detailed error logging with stack traces

**Logging Detail:**
```typescript
[Storage:Deletion] Starting deletion { streamId, filename, timestamp }
[Storage:Deletion] Deleting files { streamId, filename, files: [...] }
[Storage:Deletion] Data file deleted { streamId, file }
[Storage:Deletion] Metadata file deleted { streamId, file }
[Storage:Deletion] Deletion completed successfully { streamId, filename, duration, timestamp }
```

---

## 3. Async Cleanup Worker

### `AsyncCleanupWorker` - Batch Deletion Processor
**File:** `src/platform/async-cleanup-worker.ts:91-259`

**Purpose:** Processes file deletions asynchronously with batching and retry logic to avoid blocking the main thread.

**Configuration:**
```typescript
interface CleanupWorkerConfig {
  batchSize: number;           // Default: 5 files per batch
  delayBetweenBatches: number;  // Default: 100ms
  maxRetries: number;          // Default: 2 attempts per file
}
```

**Key Method:**

#### `processDeletions()`
**File:** `src/platform/async-cleanup-worker.ts:107-191`

**Process:**
1. Processes files in batches (configurable size)
2. Within each batch: processes files concurrently via `Promise.allSettled()`
3. Between batches: adds delay to avoid blocking
4. Comprehensive progress tracking and logging
5. Returns detailed metrics

**Metrics Returned:**
```typescript
interface CleanupWorkerMetrics {
  total: number;           // Total files processed
  succeeded: number;       // Successful deletions
  failed: number;          // Failed deletions
  duration: number;        // Total duration in ms
  results: DeletionResult[];  // Per-file results
  failures: DeletionResult[]; // Failed results subset
}
```

**Per-File Result:**
```typescript
interface DeletionResult {
  streamId: number;
  filename: string;
  success: boolean;
  error?: string;
  timestamp: number;
  duration: number;
}
```

#### `deleteWithRetry()` - Retry Logic
**File:** `src/platform/async-cleanup-worker.ts:199-248`

**Retry Behavior:**
- Attempts up to `maxRetries` (default: 2) per file
- Exponential backoff between retries: `Math.pow(2, attempt) * 50` ms
- Detailed logging of each retry attempt
- Returns final result regardless of success/failure
- Continues processing other files on failures

---

## 4. Scan-Only Mode

### `scanOrphanedFiles()` - Non-Destructive Scanning
**File:** `src/platform/storage.ts:562-617`

**Purpose:** Scan for orphaned files without deleting them - used for diagnostics and user notifications.

**Returns:**
```typescript
interface OrphanedFile extends OutputArtefact {
  age: number;              // Age in milliseconds
  reason: string;           // Human-readable reason
  isInactive: boolean;      // Not in active stream IDs
  isOld: boolean;          // Exceeds max age threshold
}
```

**Key Features:**
- Returns detailed orphan status per file
- Provides human-readable reason string
- Handles corrupted metadata gracefully
- Continues scanning on individual errors
- Used by UI for warnings before deletion

---

## 5. E11 "Staging Reaping" - Conceptual Behavior

**Note:** E11 is NOT an error code - it's a conceptual behavior documented in tests and code comments.

### What E11 Means

**E11** = "Staging files are automatically cleaned up on startup"

**References:**
- `test/compression-sender-restart.test.ts:102`
- `test/compression-resume-regression.test.ts:6`
- `test/compression-determinism.test.ts:10`
- `src/core/session/types.ts:61`
- `src/core/frame/beacon.ts:540,558`

### Why E11 Exists (T4 Privacy Requirement)

**Problem:** CompressionStream is non-deterministic
- Same file → different compressed bytes each time
- After sender restart: staging files are gone
- Re-compression produces different bytes
- Different bytes → different block boundaries → different hashes
- Receiver's persisted bitmap becomes silently invalid

**Solution:** E11 staging reaping
- On startup: automatically clean up staging files
- When compression is enabled: disable resume via `BeaconFlags.ResumeDisabled`
- Prevents silent corruption from invalid bitmaps

### E11 Behavior Documentation

**From tests:**
```typescript
// Step 3: Sender crashes → staging reaped (E11, T4 privacy)
// Step 4: Sender restarts → staging is gone → re-compresses
// Step 5: Re-compression produces DIFFERENT bytes
```

**From session types:**
```typescript
// Resume is NOT supported when compression is enabled because:
// - CompressionStream offers no determinism guarantee across browser restarts
// - Re-compression after staging reaping (E11) may produce different bytes
// - Different bytes → different block boundaries → different hashes
// - Receiver's persisted bitmap would become silently invalid
```

---

## 6. Complete Call Chain Map

### Startup Cleanup Path
```
main() (app.ts:335)
  → registerServiceWorker()
  → runAppInit() (init.ts:37)
    → Promise.all([
        runHealthCheck(),
        runStartupCleanup(new Set()) (storage.ts:675)
          → getStorageManager()
          → cleanupOrphanedOutputs(activeStreamIds) (storage.ts:531)
            → listOutputs()
            → for each output:
              → check if orphaned (inactive AND old)
              → deleteOutput(streamId, filename) (storage.ts:462)
                → outputDir.removeEntry(dataFile)
                → outputDir.removeEntry(metadataFile)
            → return cleanup count
      ])
```

### Manual Cleanup Path (if needed)
```
getStorageManager()
  → cleanupOrphanedOutputs(activeStreamIds)
    → [same as above]
```

### Async Worker Path
```
new AsyncCleanupWorker(storageManager, config)
  → processDeletions(orphans, onProgress)
    → for each batch:
      → Promise.allSettled(
          orphans.map(orphan => deleteWithRetry(orphan))
        )
      → delay between batches
    → return CleanupWorkerMetrics
```

---

## 7. Trigger Conditions

### Automatic Triggers
1. **Application startup** - `runAppInit()` in `main()`
2. **Active stream management** - When active stream IDs change

### Manual Triggers (via API)
1. Direct call to `cleanupOrphanedOutputs(activeStreamIds)`
2. Direct call to `deleteOutput(streamId, filename)`

### Orphan Criteria (BOTH must be true)
1. **Inactive condition:** `!activeStreamIds.has(output.streamId)`
   - File's streamId is NOT in the active set
   - Means no active transfer session references this file

2. **Age condition:** `(now - output.createdAt) > maxOrphanAge`
   - File is older than 24 hours (default configurable)
   - Prevents deletion of recently created files

### Configuration
```typescript
interface StorageManagerConfig {
  outputDirectory: string;        // 'screenferry-outputs'
  maxOrphanAge: number;          // 24 * 60 * 60 * 1000 (24 hours)
}
```

---

## 8. Staging vs Output Files

### Staging Files (Sender Side - Compression)
- **Purpose:** Temporary compressed data during encoding
- **Lifecycle:** Created during compression → deleted after encoding
- **E11 Behavior:** Automatically cleaned up on startup
- **Current Status:** Sender compression not fully implemented yet (see app.ts:266 TODO)

### Output Files (Receiver Side - Decompressed Data)
- **Purpose:** Final decoded and decompressed files
- **Lifecycle:** Created during reception → persisted until user deletes
- **Cleanup:** Only orphaned outputs are auto-cleaned (inactive + old)
- **Implementation:** Fully implemented via storage manager

---

## 9. Compression Staging Buffer Calculation

### `calculateCompressionStagingBuffer()`
**File:** `src/platform/storage.ts:227-232`

**Purpose:** Calculate temporary working space needed for compression.

**Formula:**
```typescript
staging = fileSize * 0.15 + 10 MB
```

**Components:**
- 15% overhead for compression staging (conservative estimate)
- 10 MB fixed buffer for codec working sets (fountain code matrix storage)

**Used By:**
- `checkStorageCapacity()` for pre-flight quota validation
- Ensures sufficient space before starting transfer

---

## 10. Security and Privacy Considerations

### T4 Privacy Compliance
- **E11 staging reaping** ensures abandoned compressed data is deleted
- Prevents indefinite storage of intermediate compression artifacts
- Automatic cleanup on startup reduces data retention

### OPFS Storage Characteristics
- **Not encrypted at rest** (documented in warnings)
- Data persists after tab closure
- Requires explicit cleanup for privacy

### Security Warnings (from partial-artefact-detector.ts)
```typescript
⚠️ SECURITY WARNING: The raw compressed data will be stored in plaintext
in your browser storage until you delete it.

Browser storage (OPFS) is not encrypted at rest. The data may persist
even after you close this tab.
```

---

## 11. Error Handling and Logging

### Comprehensive Logging Strategy
Every cleanup operation logs:
1. **Start**: Operation start with parameters
2. **Progress**: Per-file and per-batch progress
3. **Success**: Successful operations with duration
4. **Failure**: Failed operations with error details
5. **Completion**: Summary with counts and totals

### Error Resilience
- Individual file failures don't stop overall cleanup
- Retry logic for transient failures
- Graceful handling of already-deleted files
- Detailed error metadata for debugging

---

## 12. Testing Coverage

### Test Files Covering Cleanup
1. `test/compression-sender-restart.test.ts` - E11 behavior tests
2. `test/compression-resume-regression.test.ts` - Staging reaping simulation
3. `test/compression-determinism.test.ts` - Non-determinism verification
4. `test/deletion-integration.test.ts` - OPFS deletion integration
5. `test/async-cleanup-worker.test.ts` - Async worker tests
6. `test/bf-5mcz-orphan-scanner.test.ts` - Orphan scanning tests
7. `test/storage.test.ts` - Storage manager tests

### Test Patterns
- Simulate staging reaping via re-compression
- Verify cleanup doesn't break valid operations
- Test concurrent deletions
- Verify error handling and retry logic
- Test orphan detection and age thresholds

---

## 13. Implementation Status

### ✅ Fully Implemented
- Receiver output storage and cleanup
- Orphan detection and deletion
- Async cleanup worker
- Startup cleanup automation
- Scan-only diagnostics

### ⚠️ Partially Implemented
- Sender compression staging (compression not fully implemented)
- Sender-side staging cleanup (waiting for compression implementation)

### 🔄 Documented Behavior (Not Yet Implemented)
- E11 staging reaping for sender compression files
- Full sender compression pipeline

---

## 14. Key Insights for T4 Privacy Verification

### 1. Cleanup is Automatic and Comprehensive
- Runs on every application startup
- Uses strict dual criteria (inactive AND old)
- Provides detailed logging for verification

### 2. E11 is a Concept, Not an Error Code
- Represents automatic cleanup behavior
- Documented throughout codebase and tests
- Critical for T4 privacy compliance

### 3. Staging Files vs Output Files
- **Staging**: Temporary compression artifacts (sender side)
- **Output**: Final decoded files (receiver side)
- Different cleanup requirements and lifecycles

### 4. Current Implementation Focuses on Receiver Side
- Fully implemented orphan cleanup for receiver outputs
- Sender compression staging cleanup will use same infrastructure
- Async worker provides scalable deletion mechanism

### 5. Verification Points
- **Startup:** Check logs for `[Storage] Cleanup complete: removed X orphaned output(s)`
- **Manual:** Use `scanOrphanedFiles()` for diagnostics before deletion
- **API:** Direct `deleteOutput()` calls for explicit cleanup

---

## 15. References to E11 in Codebase

### Test References
1. `test/compression-sender-restart.test.ts:102` - "Sender restarts → staging reaped (E11)"
2. `test/compression-resume-regression.test.ts:6` - "Sender crashes → staging reaped (E11, T4 privacy)"
3. `test/compression-determinism.test.ts:10` - "E11 reaps abandoned staging on startup"
4. `test/compression-determinism.test.ts:132` - "Simulate: staging reaped (E11), re-compress"
5. `test/compression-determinism.test.ts:177` - "staging required → reaped by E11"

### Code References
1. `src/core/session/types.ts:61` - "Re-compression after staging reaping (E11)"
2. `src/core/session/types.ts:80` - "Re-compression after staging reaping (E11)"
3. `src/core/frame/beacon.ts:540` - "E11 staging reaping, re-compression may produce different bytes"
4. `src/core/frame/beacon.ts:558` - "Non-deterministic compression means that after a sender restart and E11 staging reaping"

---

## Conclusion

The staging cleanup system is well-implemented for the receiver side with comprehensive error handling, logging, and testing. The E11 "staging reaping" behavior is documented throughout the codebase as a critical T4 privacy requirement, ensuring that:

1. **Abandoned data is automatically cleaned up** on startup
2. **Privacy is maintained** through time-based and activity-based criteria
3. **Compression non-determinism is safely handled** by disabling resume
4. **Comprehensive logging** enables verification of cleanup behavior

**Next Steps for T4 Privacy Verification:**
- Verify startup cleanup runs correctly in production
- Confirm orphan criteria (inactive + old) are met
- Validate cleanup doesn't delete active transfer files
- Test error handling and retry logic under failure conditions
- Verify E11 behavior when sender compression is fully implemented

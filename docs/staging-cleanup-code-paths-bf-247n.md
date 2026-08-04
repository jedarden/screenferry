# Staging Cleanup Code Paths Analysis (bf-247n)

**Bead:** `bf-247n`  
**Phase:** Phase 4 (Large-file machinery)  
**Date:** 2026-08-03

## Executive Summary

This analysis identifies all code paths responsible for **sender-side staging file cleanup** required for T4 privacy compliance. The investigation reveals that **sender-side staging cleanup is NOT yet implemented** because the sender transmission pipeline has not been built.

## Background: Staging Cleanup Requirements

Per plan.md §12, **T4a (Sender-side plaintext residue)** mandates:

> **D8** writes a *decompressed-equivalent* copy of the user's file to OPFS as staging. For the flagship use case (SSH keys, PSBTs, TOTP seeds) this is real exposure.

**Mitigated.** Wipe staging on completion, on cancel, and on startup-reap (E11).

### Required Cleanup Conditions (from plan.md)

| Condition | Description | Plan Reference |
|-----------|-------------|-----------------|
| **On completion** | Wipe staging after successful transfer | §12 T4a |
| **On cancel** | Wipe staging when user cancels | §12 T4a |
| **On startup-reap (E11)** | Reap staging files with no active session | §12 E11, T4a |

### Implementation Requirements

From `bf-2vke-compression-resume-t4-reap-interaction.md`:

> **Step 3: Privacy Reaping (E11, T4a)**
> - On sender restart, E11 reaps abandoned staging files
> - T4a privacy requirement mandates wiping staging on completion/cancel
> - **The compressed staging file is deleted**

## Current Implementation Status

### Sender Pipeline Status

**NOT IMPLEMENTED** — From `src/app.ts:266`:

```typescript
// TODO: Transition to transmission mode when sender pipeline is implemented
alert(`File selected: ${file.name} (${file.size} bytes)\n\nSender transmission mode will be implemented in future beads.`);
```

### Staging Handle Field

The `SendingState` type includes a staging field (`src/core/session/types.ts:283`):

```typescript
export interface SendingState {
  type: 'sending';
  source: File;
  staging: FileSystemFileHandle | null;  // ← Placeholder for staging file
  streamId: number;
  // ... other fields
}
```

**This field is a placeholder only** — no code currently creates, manages, or cleans up this staging file.

## What IS Implemented

### Receiver-Side Cleanup (T4b) ✅

**Fully implemented** in `src/platform/storage.ts` and `src/platform/export.ts`:

- **Automatic deletion after export**: `shareFile()` and `saveFile()` delete OPFS artefacts immediately after successful export
- **Startup orphan reaping**: `runStartupCleanup()` scans for and deletes orphaned receiver outputs on startup
- **Async cleanup worker**: `AsyncCleanupWorker` processes deletions with batch processing and retries

**Reference:** `docs/notes/bf-1yk1-t4b-deletion-lifecycle.md`

### Compression/Resume Conflict Detection ✅

**Implemented** in `src/core/frame/beacon.ts`:

```typescript
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.Compressed) !== 0;
}
```

This ensures that when compression is enabled, resume is disabled to prevent T4a violations from non-deterministic re-compression.

**Reference:** `docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md`

### Resume Persistence ✅

**Implemented** in `src/core/resume/resume-persistence.ts`:

- Handles receiver-side resume token persistence
- No sender-side staging cleanup logic

## Required Sender-Side Staging Cleanup Code Paths

When the sender pipeline is implemented, the following cleanup code paths MUST be implemented:

### 1. Staging File Creation (D8)

```typescript
// Function to be implemented
async function createStagingFile(file: File, streamId: number): Promise<FileSystemFileHandle> {
  // Compress file to OPFS staging area
  // Return handle for later cleanup
}
```

**Location:** TBD (sender pipeline module)

### 2. Completion Cleanup (T4a)

```typescript
// Function to be implemented
async function cleanupStagingOnComplete(staging: FileSystemFileHandle, streamId: number): Promise<void> {
  // Delete staging file after successful transfer completion
  // Called from sender state machine when transitioning to COMPLETE
}
```

**Location:** TBD (sender state machine)

### 3. Cancel Cleanup (T4a)

```typescript
// Function to be implemented
async function cleanupStagingOnCancel(staging: FileSystemFileHandle, streamId: number): Promise<void> {
  // Delete staging file when user cancels or transfer fails
  // Called from sender state machine on transition to IDLE/FAILED
}
```

**Location:** TBD (sender state machine)

### 4. Startup Reaping (E11)

```typescript
// Function to be implemented
async function reapAbandonedStaging(activeStreamIds: Set<number>): Promise<number> {
  // On app startup, scan for staging files with no active session
  // Delete abandoned staging files older than threshold
  // Return count of files reaped
}
```

**Location:** TBD (storage.ts or dedicated sender-cleanup.ts)

### 5. Integration with App Initialization

```typescript
// In src/platform/init.ts or similar
export async function runAppInit(): Promise<InitResult> {
  // ... existing health check and receiver cleanup ...
  
  // Reap abandoned sender staging files (E11)
  const stagingReaped = await reapAbandonedStaging(new Set());
  
  return {
    // ... existing fields ...
    stagingReaped,
  };
}
```

## Call Chain Mapping (When Implemented)

### Completion Scenario

```
User completes transfer
  ↓
Sender state machine: SENDING → COMPLETE
  ↓
cleanupStagingOnComplete(stagingHandle, streamId)
  ↓
Delete OPFS staging file
  ↓
Log cleanup success
```

### Cancel Scenario

```
User cancels transfer OR transfer fails
  ↓
Sender state machine: SENDING → IDLE/FAILED
  ↓
cleanupStagingOnCancel(stagingHandle, streamId)
  ↓
Delete OPFS staging file
  ↓
Log cleanup success
```

### Startup Reap Scenario

```
App initialization (runAppInit)
  ↓
Scan OPFS for sender staging files
  ↓
Identify files with no active session (streamId not in activeStreamIds)
  ↓
Delete abandoned files
  ↓
Log reap results
```

## Testing Requirements

When sender staging cleanup is implemented, the following tests MUST be added:

### Unit Tests

1. **Staging creation**: Verify staging file created correctly with compression
2. **Completion cleanup**: Assert staging deleted after successful transfer
3. **Cancel cleanup**: Assert staging deleted on user cancel
4. **Startup reap**: Assert abandoned staging files reaped on startup

### Integration Tests

1. **Full transfer lifecycle**: Create staging → complete transfer → assert cleanup
2. **Interrupted transfer**: Create staging → cancel → assert cleanup
3. **Orphan reaping**: Create staging → simulate crash → restart → assert reaped

### Security Tests

1. **T4a compliance**: Verify staging wiped in all three required scenarios
2. **No residue**: Assert OPFS empty after cleanup operations
3. **Active session protection**: Assert active staging not reaped

## References

- **Plan §12 T4a**: Sender-side plaintext residue mitigation
- **Plan §12 E11**: Abandoned staging file reaping
- **Plan D8**: Compression to staging file requirement
- **bf-2vke**: Compression/resume/T4-reap interaction analysis
- **bf-1yk1**: T4b deletion lifecycle (receiver-side, implemented)
- **src/core/session/types.ts**: SendingState type definition
- **src/platform/init.ts`: App initialization (receiver cleanup only)
- **src/platform/storage.ts`: Receiver storage manager (not sender staging)

## Conclusion

**Sender-side staging cleanup code paths do not currently exist.** The sender transmission pipeline has not been implemented, so no staging files are created or cleaned up. 

When the sender pipeline is built, it MUST include staging cleanup in all three required scenarios:
1. ✅ On completion (T4a)
2. ✅ On cancel (T4a)  
3. ✅ On startup-reap (E11)

The receiver-side cleanup (T4b) is fully implemented and can serve as a reference for the sender-side implementation pattern.

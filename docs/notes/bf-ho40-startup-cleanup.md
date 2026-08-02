# Startup Cleanup of Orphaned Receiver Outputs (bf-ho40)

## Overview

Automatic cleanup of orphaned decoded files when the receiver app starts up.

## Problem

When the receiver app crashes or is force-closed during a transfer, decoded output files can remain in OPFS (Origin Private File System) storage. These orphaned files accumulate over time, consuming storage quota with no way to recover them.

## Solution

On app startup, scan for and automatically delete orphaned output files.

## Orphan Criteria

An output file is considered orphaned when **BOTH** conditions are met:

1. **No active session reference**: The file's `streamId` is not in the set of currently active session IDs
2. **Older than max age**: The file's `createdAt` timestamp exceeds `maxOrphanAge` (default: 24 hours)

The age threshold prevents false positives during:
- Normal app restart (e.g., browser update, device reboot)
- Session resume (D22) where a paused session becomes active again
- Brief app closure during long transfers

## Implementation

### Storage Manager (`src/platform/storage.ts`)

**`OPFSStorageManager.cleanupOrphanedOutputs(activeStreamIds: Set<number>)`**

- Lists all output metadata files (`.meta.json`)
- Checks each output against orphan criteria
- Deletes both data file (`.bin`) and metadata file (`.meta.json`)
- Returns count of files cleaned up
- Logs each deletion with file details (streamId, filename, age)

**`runStartupCleanup(activeStreamIds: Set<number>)`**

- Convenience wrapper around storage manager
- Returns `{ cleaned: number, error?: string }`
- Handles errors gracefully (returns 0 cleaned on failure)

### App Initialization (`src/platform/init.ts`)

**`runAppInit()`**

- Runs startup cleanup in parallel with health check
- Uses empty `Set()` for active stream IDs (no active sessions on startup)
- Returns `InitResult` with `orphanedOutputsCleaned` count
- Logs initialization results (health status, cleanup count, errors)

**Non-blocking execution**: Cleanup runs in Promise.all with health check, so UI loads immediately without waiting for cleanup to complete.

## Configuration

### StorageManagerConfig

```typescript
{
  outputDirectory: string;      // OPFS subdirectory (default: 'screenferry-outputs')
  maxOrphanAge: number;        // Max age for orphans in ms (default: 24 hours)
}
```

### Custom Configuration

```typescript
import { configureStorageManager } from './platform/storage.js';

// Must be called before first getStorageManager() call
configureStorageManager({
  outputDirectory: 'custom-outputs',
  maxOrphanAge: 60 * 60 * 1000, // 1 hour
});
```

## Usage

### During App Initialization

```typescript
import { runAppInit } from './platform/init.js';

// Called during app startup
const result = await runAppInit();

console.log(`Cleaned ${result.orphanedOutputsCleaned} orphaned files`);
```

### Manual Cleanup (Advanced)

```typescript
import { getStorageManager } from './platform/storage.js';

const storage = getStorageManager();
const activeIds = new Set<number>([123, 456]); // Currently active streams
const cleaned = await storage.cleanupOrphanedOutputs(activeIds);
```

## Testing

### Unit Tests (`test/storage.test.ts`)

- **Age-based orphan detection**: Removes files older than max age
- **Active session protection**: Keeps files in active set regardless of age
- **Recent file protection**: Keeps recent files even if not active
- **Empty storage handling**: Handles no-op case gracefully
- **Mixed age handling**: Correctly filters mixed-age files
- **Error handling**: Continues cleanup even if individual deletions fail
- **Configuration options**: Respects custom `maxOrphanAge`

### Integration Tests (`test/init.test.ts`)

- **Parallel execution**: Runs cleanup alongside health check
- **Error collection**: Collects errors from both cleanup and health check
- **Result formatting**: Formats user-friendly status messages
- **Logging verification**: Verifies console output

## Metrics and Logging

### Console Logs

```
[Storage] Starting orphaned output cleanup...
[Storage] Cleaning up orphaned output: streamId=123, filename=test.dat, age=45 minutes
[Storage] Deleted output: streamId=123
[Storage] Cleanup complete: removed 3 orphaned output(s)
[Init] Initialization complete in 234ms
[Init] Health check: PASSED
[Init] Orphaned outputs cleaned: 3
```

### Return Values

- `runAppInit()` → `InitResult` with `orphanedOutputsCleaned` count
- `cleanupOrphanedOutputs()` → `number` (count of files removed)
- `runStartupCleanup()` → `{ cleaned: number, error?: string }`

## Security Considerations

- **Same-origin restriction**: OPFS is origin-private, no cross-origin access
- **No user data exposure**: Cleanup only removes app's own output files
- **No active session disruption**: Age threshold prevents deleting recent files that might be in use

## Performance

- **Non-blocking**: Runs in background, doesn't block app initialization
- **Incremental**: Processes files one at a time, no large memory allocations
- **Fast for typical usage**: Most apps have 0-2 orphaned files
- **Graceful degradation**: Continues on individual deletion failures

## Future Enhancements

- **Configurable age threshold**: Allow users to set custom orphan age in settings
- **Manual cleanup button**: UI button to trigger cleanup on demand
- **Cleanup statistics**: Track cleanup frequency and file age distribution
- **User notification**: Show toast when orphans are cleaned up

## References

- **Storage implementation**: `src/platform/storage.ts`
- **Init integration**: `src/platform/init.ts`
- **Session types**: `src/core/session/types.ts`
- **Tests**: `test/storage.test.ts`, `test/init.test.ts`
- **Bead**: bf-ho40

## Why: 

Without automatic cleanup, orphaned files accumulate indefinitely:
- Each incomplete transfer leaves a partial file in OPFS
- OPFS quota is limited (typically ~50-60% of total storage)
- No built-in cleanup mechanism in browsers
- Manual cleanup requires developer tools or browser data clearing

## How to apply:

The cleanup is automatic and runs on every app startup. No manual intervention needed. To verify cleanup is working:

1. Check browser console for `[Storage] Cleanup complete` log
2. Monitor `orphanedOutputsCleaned` count in `InitResult`
3. Run unit tests: `npm test -- storage.test.ts`
4. Run integration tests: `npm test -- init.test.ts`

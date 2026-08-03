# Deletion Lifecycle and Troubleshooting Guide (bf-9g4i)

## Overview

This document explains the complete deletion lifecycle for receiver output files in ScreenFerry, including when files are automatically deleted versus retained, how to verify deletion is working correctly, and how to troubleshoot common deletion issues.

## Table of Contents

- [Deletion Lifecycle](#deletion-lifecycle)
- [When Files Are Deleted vs Retained](#when-files-are-deleted-vs-retained)
- [Verifying Deletion in Production](#verifying-deletion-in-production)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Manual OPFS Cleanup](#manual-opfs-cleanup)
- [Log Output Examples](#log-output-examples)

## Deletion Lifecycle

### 1. File Creation

When a file is successfully received and decoded:

```
[Storage] Stored output: streamId=123, size=1024000
```

Files are stored in OPFS under `screenferry-outputs/` directory:
- **Data file**: `output-{streamId}.bin`
- **Metadata file**: `output-{streamId}.meta.json`

### 2. Active Retention

Files are **retained** during active transfers:
- File remains in OPFS while transfer is in progress
- File remains accessible after successful completion
- User can download/view the completed file

### 3. Export-Triggered Automatic Deletion ⭐

**IMPORTANT**: Files are automatically deleted immediately after successful export operations. This is a key security feature to minimize plaintext storage time.

**After Web Share API:**
```
[Export:Deletion] Starting deletion after share, {
  method: "share",
  streamId: 123,
  filename: "photo.jpg",
  timestamp: "2026-08-02T20:00:00.000Z"
}
[Export:Deletion] Deletion completed successfully, {
  method: "share",
  streamId: 123,
  filename: "photo.jpg",
  duration: "42.15ms",
  timestamp: "2026-08-02T20:00:00.042Z"
}
```

**After File System Access API save:**
```
[Export:Deletion] Starting deletion after save, {
  method: "save",
  streamId: 456,
  filename: "document.pdf"
}
[Export:Deletion] Deletion completed successfully, { method: "save", ... }
```

**After traditional download:**
```
[Export:Deletion] Starting deletion after download, {
  method: "download",
  streamId: 789,
  filename: "archive.zip"
}
[Export:Deletion] Deletion completed successfully, { method: "download", ... }
```

**Security Rationale**: OPFS stores files in plaintext. Immediate deletion after successful export minimizes the window where sensitive data persists in browser storage.

### 4. Manual Deletion

Users can manually delete files via the File List UI:

```
[FileListUI] Deleted file: example.jpg (streamId: 123)
[Storage:Deletion] Starting deletion { streamId: 123, filename: "example.jpg" }
[Storage:Deletion] Data file deleted { streamId: 123, file: "output-123.bin" }
[Storage:Deletion] Metadata file deleted { streamId: 123, file: "output-123.meta.json" }
[Storage:Deletion] Deletion completed successfully { streamId: 123, duration: "12.45ms" }
```

### 5. Navigation Guard Deletion

When users leave pages with partial (incomplete) artefacts, they can choose to delete the partial file:

```
[NavigationGuard] User chose to delete partial artefact: streamId=999
[Storage:Deletion] Starting deletion { streamId: 999, filename: "partial-download.jpg" }
[Storage:Deletion] Deletion completed successfully { streamId: 999, ... }
```

### 6. Automatic Startup Cleanup

Orphaned files are automatically cleaned up on app startup:

```
[Storage] Starting orphaned output cleanup...
[Storage] Cleaning up orphaned output: streamId=123, age=45 minutes
[Storage:Deletion] Starting deletion { streamId: 123, filename: "example.jpg" }
[Storage] Cleanup complete: removed 3 orphaned output(s)
```

## When Files Are Deleted vs Retained

### Files Are Deleted Automatically When:

1. **After successful export**: Immediately after share/save/download completes (T4b security feature)
2. **Orphaned files on startup**: Files older than 24 hours without active session reference
3. **Age threshold reached**: `createdAt` timestamp exceeds `maxOrphanAge` (default: 24 hours)
4. **No active session**: File's `streamId` not in active session set
5. **User chooses deletion**: User selects "delete" option when leaving page with partial artefact

### Files Are Retained When:

1. **Export fails or is cancelled**: If user cancels share/save, file is retained
2. **Active transfer**: File is part of an ongoing transfer session
3. **Recent completion**: File was created recently (within 24 hours)
4. **Active session reference**: File belongs to a paused/resumable session
5. **User chooses to keep**: User selects "keep" option for partial artefacts
6. **Manual preservation**: User doesn't manually delete via File List UI

### Export Deletion Criteria

| Export Method | Deletion Timing | Deletion Condition |
|--------------|----------------|-------------------|
| **Web Share API** | Immediate after `share()` resolves | User successfully selected destination and shared |
| **File System Access Save** | Immediate after `showSaveFilePicker()` completes | User successfully selected save location |
| **Traditional Download** | Immediate after download starts | Download triggered successfully (not cancelled) |
| **Export fails** | No deletion | Any error during export, user cancellation, or permission denial |

**Key Point**: Export-triggered deletion only happens on **success**, not on failure or cancellation. This ensures users don't lose their files if export doesn't complete.

### Deletion Safety Mechanisms

**Age Threshold Protection**: Prevents accidental deletion during:
- Normal app restart (browser update, device reboot)
- Session resume (paused sessions becoming active again)
- Brief app closure during long transfers

**Active Session Protection**: Files in active session set are never auto-deleted regardless of age.

## Verifying Deletion in Production

### 1. Console Log Monitoring

Check browser console for deletion activity:

**Successful manual deletion:**
```javascript
[Storage:Deletion] Starting deletion { 
  streamId: 123, 
  filename: "example.jpg", 
  timestamp: "2026-08-02T20:00:00.000Z" 
}
[Storage:Deletion] Deletion completed successfully { 
  streamId: 123, 
  filename: "example.jpg", 
  duration: "12.45ms" 
}
```

**Failed deletion:**
```javascript
[Storage:Deletion] Failed to delete output {
  streamId: 123, 
  filename: "example.jpg",
  error: {
    name: "NotFoundError", 
    message: "File not found"
  }
}
```

### 2. Startup Cleanup Verification

Check app initialization logs:

```javascript
[Storage] Starting orphaned output cleanup...
[Storage] Cleanup complete: removed 3 orphaned output(s)
[Init] Orphaned outputs cleaned: 3
```

### 3. Storage Quota Monitoring

Monitor storage usage changes after deletion:

```javascript
// Before deletion
navigator.storage.estimate().then(e => console.log('Before:', e));

// After deletion should show reduced usage
navigator.storage.estimate().then(e => console.log('After:', e));
```

### 4. Programmatic Verification

Use the storage manager API to verify deletion:

```typescript
import { getStorageManager } from './platform/storage.js';

const storage = getStorageManager();

// Check if file exists (should return null after deletion)
const metadata = await storage.getOutputMetadata(streamId);
if (metadata === null) {
  console.log('File successfully deleted');
}

// List all remaining files
const files = await storage.listOutputs();
console.log('Remaining files:', files.length);
```

## Troubleshooting Common Issues

### Issue 1: Files Not Being Deleted Automatically

**Symptoms:**
- Old files accumulating in OPFS
- No cleanup logs on app startup
- Storage quota warnings

**Diagnosis:**
1. Check console for `[Storage] Starting orphaned output cleanup...` log
2. Verify `runStartupCleanup()` is called during app initialization
3. Check if files are younger than 24-hour age threshold

**Solutions:**
```javascript
// Verify startup cleanup is running
// Check src/platform/init.ts for runAppInit() call

// Lower age threshold for testing
import { configureStorageManager } from './platform/storage.js';
configureStorageManager({
  maxOrphanAge: 60 * 60 * 1000 // 1 hour for testing
});
```

### Issue 2: Manual Deletion Failing Silently

**Symptoms:**
- User clicks delete but file remains
- No error toast shown
- No console logs

**Diagnosis:**
1. Check browser console for `[Storage:Deletion]` logs
2. Verify OPFS permissions
3. Check if file is locked by another process

**Solutions:**
```javascript
// Check if file exists before deletion
const metadata = await storage.getOutputMetadata(streamId);
if (!metadata) {
  console.log('File already deleted or never existed');
}

// Force refresh file list after deletion
await fileListUI.refreshFileList();
```

### Issue 3: Deletion Logs Show "File Not Found"

**Symptoms:**
```javascript
[Storage:Deletion] Files not found (already deleted) {
  streamId: 123,
  filename: "example.jpg"
}
```

**Diagnosis:**
- File was already deleted (normal condition)
- Metadata/file mismatch
- Race condition in deletion

**Solutions:**
- This is a **warning, not an error** - deletion is idempotent
- File is already gone, no action needed
- Verify UI file list is synchronized

### Issue 4: OPFS Storage Quota Exhausted

**Symptoms:**
- New transfers fail with quota errors
- Deletion doesn't free up space
- `navigator.storage.estimate()` shows 0 available

**Diagnosis:**
```javascript
const estimate = await navigator.storage.estimate();
console.log('Available:', estimate.quota - estimate.usage);
console.log('Usage:', estimate.usage);
```

**Solutions:**
1. **Manual cleanup**: Delete old files programmatically
2. **Browser data clearing**: Clear site data via DevTools
3. **Reduce orphan age**: Auto-cleanup more frequently

```javascript
// Emergency cleanup - delete all files
const storage = getStorageManager();
const files = await storage.listOutputs();
for (const file of files) {
  await storage.deleteOutput(file.streamId, file.filename);
}
```

### Issue 5: Export Deletion Not Triggering

**Symptoms:**
- Files remain after successful export
- No `[Export:Deletion]` logs after share/save/download
- Storage quota filling up despite successful exports

**Diagnosis:**
1. Check if export actually succeeded (user didn't cancel)
2. Verify export code paths have deletion calls
3. Check for JavaScript errors during export

**Solutions:**
```javascript
// Verify export is completing successfully
// Check for these logs indicating successful export:
// "[Export] Share successful" or "[Export] Save successful"

// If export succeeds but deletion doesn't trigger:
// 1. Check src/platform/export.ts for deletion calls
// 2. Verify no errors in console between export success and deletion
// 3. Test export flow manually and watch console logs
```

**Testing Export Deletion:**
```javascript
// 1. Initiate a transfer and receive file
// 2. Export file (share/save/download)
// 3. Check console for: [Export:Deletion] Starting deletion
// 4. Verify file gone from OPFS via DevTools
```

### Issue 6: Deletion Performance Problems

**Symptoms:**
- UI freezes during deletion
- Long duration times in logs
- Multiple file deletions blocking UI

**Diagnosis:**
Check deletion duration in logs:
```javascript
[Storage:Deletion] Deletion completed successfully { 
  duration: "1250.45ms"  // > 1 second indicates problem
}
```

**Solutions:**
```javascript
// Batch deletions with delays to avoid UI blocking
async function deleteMultipleFiles(streamIds: number[]) {
  for (const streamId of streamIds) {
    await storage.deleteOutput(streamId);
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
  }
}
```

## Manual OPFS Cleanup

### When Manual Cleanup Is Needed

- Automatic cleanup failing to run
- Emergency storage quota recovery
- Testing and development scenarios
- User-requested data clearing

### Method 1: Using Browser DevTools

1. **Open DevTools** → Application → Storage
2. **Find OPFS** section under "Storage"
3. **Locate origin** for your ScreenFerry app
4. **Expand "File System"** to see stored files
5. **Delete files individually** or clear entire origin

### Method 2: Using Storage Manager API

```javascript
import { getStorageManager } from './platform/storage.js';

// Get all files
const storage = getStorageManager();
const files = await storage.listOutputs();

// Delete specific file
await storage.deleteOutput(streamId, filename);

// Delete all files (emergency cleanup)
for (const file of files) {
  try {
    await storage.deleteOutput(file.streamId, file.filename);
    console.log(`Deleted: ${file.filename}`);
  } catch (error) {
    console.error(`Failed to delete: ${file.filename}`, error);
  }
}

// Run orphaned cleanup manually
const activeIds = new Set<number>(); // No active sessions
const cleaned = await storage.cleanupOrphanedOutputs(activeIds);
console.log(`Cleaned ${cleaned} orphaned files`);
```

### Method 3: Clear Site Data

```javascript
// Clear all OPFS data for the origin
await navigator.storage.delete();

// Alternatively, use clear site data via browser UI
// Chrome: Settings → Privacy → Site Settings → Storage → Your site
```

### Method 4: Low-Level OPFS Access

```javascript
// Direct OPFS access for advanced troubleshooting
const root = await navigator.storage.getDirectory();
const outputsDir = await root.getDirectoryHandle('screenferry-outputs');

// List all files
for await (const entry of outputsDir.values()) {
  console.log('File:', entry.name);
  
  // Delete specific file
  if (entry.kind === 'file') {
    await outputsDir.removeEntry(entry.name);
    console.log('Deleted:', entry.name);
  }
}
```

## Log Output Examples

### Export-Triggered Deletion (Most Common)

**After Web Share API:**
```javascript
[Export:Deletion] Starting deletion after share, {
  method: "share",
  streamId: 123,
  filename: "photo.jpg",
  timestamp: "2026-08-02T20:10:15.456Z"
}
[Export:Deletion] Deletion completed successfully, {
  method: "share",
  streamId: 123,
  filename: "photo.jpg",
  duration: "42.15ms",
  timestamp: "2026-08-02T20:10:15.498Z"
}
```

**After File System Access API:**
```javascript
[Export:Deletion] Starting deletion after save, {
  method: "save",
  streamId: 456,
  filename: "document.pdf",
  timestamp: "2026-08-02T20:12:30.789Z"
}
[Export:Deletion] Deletion completed successfully, {
  method: "save",
  streamId: 456,
  filename: "document.pdf",
  duration: "38.72ms",
  timestamp: "2026-08-02T20:12:30.828Z"
}
```

**After Traditional Download:**
```javascript
[Export:Deletion] Starting deletion after download, {
  method: "download",
  streamId: 789,
  filename: "archive.zip",
  timestamp: "2026-08-02T20:14:45.234Z"
}
[Export:Deletion] Deletion completed successfully, {
  method: "download",
  streamId: 789,
  filename: "archive.zip",
  duration: "35.18ms",
  timestamp: "2026-08-02T20:14:45.269Z"
}
```

### Navigation Guard Deletion

```javascript
[NavigationGuard] User chose to delete partial artefact: streamId=999
[Storage:Deletion] Starting deletion {
  streamId: 999,
  filename: "partial-download.jpg",
  timestamp: "2026-08-02T20:16:00.000Z"
}
[Storage:Deletion] Data file deleted {
  streamId: 999,
  file: "output-999.bin"
}
[Storage:Deletion] Metadata file deleted {
  streamId: 999,
  file: "output-999.meta.json"
}
[Storage:Deletion] Deletion completed successfully {
  streamId: 999,
  filename: "partial-download.jpg",
  duration: "9.45ms",
  timestamp: "2026-08-02T20:16:00.009Z"
}
```

### Successful Manual Deletion

```javascript
[FileListUI] Deleted file: photo.jpg (streamId: 456)
[Storage:Deletion] Starting deletion {
  streamId: 456,
  filename: "photo.jpg",
  timestamp: "2026-08-02T20:15:30.123Z"
}
[Storage:Deletion] Deleting files {
  streamId: 456,
  filename: "photo.jpg",
  files: ["output-456.bin", "output-456.meta.json"]
}
[Storage:Deletion] Data file deleted {
  streamId: 456,
  file: "output-456.bin"
}
[Storage:Deletion] Metadata file deleted {
  streamId: 456,
  file: "output-456.meta.json"
}
[Storage:Deletion] Deletion completed successfully {
  streamId: 456,
  filename: "photo.jpg",
  duration: "8.23ms",
  timestamp: "2026-08-02T20:15:30.131Z"
}
```

### Failed Deletion (File Not Found)

```javascript
[Storage:Deletion] Starting deletion {
  streamId: 789,
  filename: "missing.pdf",
  timestamp: "2026-08-02T20:20:00.000Z"
}
[Storage:Deletion] Files not found (already deleted) {
  streamId: 789,
  filename: "missing.pdf",
  duration: "2.15ms"
}
```

### Startup Cleanup Logs

```javascript
[Storage] Starting orphaned output cleanup...
[Storage] Cleaning up orphaned output: streamId=123, age=1450 minutes
[Storage:Deletion] Starting deletion { streamId: 123, filename: "old1.jpg" }
[Storage:Deletion] Deletion completed successfully { streamId: 123, duration: "6.78ms" }
[Storage] Cleaning up orphaned output: streamId=456, age=2890 minutes
[Storage:Deletion] Starting deletion { streamId: 456, filename: "old2.png" }
[Storage:Deletion] Deletion completed successfully { streamId: 456, duration: "7.12ms" }
[Storage] Cleaning up orphaned output: streamId=789, age=4320 minutes
[Storage:Deletion] Starting deletion { streamId: 789, filename: "old3.pdf" }
[Storage:Deletion] Deletion completed successfully { streamId: 789, duration: "6.89ms" }
[Storage] Cleanup complete: removed 3 orphaned output(s)
[Init] Orphaned outputs cleaned: 3
```

### Storage Capacity Check

```javascript
[Storage] Capacity check passed: {
  required: "15.2 MB",
  available: "2.3 GB",
  margin: "2.3 GB"
}
```

### Storage Capacity Warning

```javascript
[Storage] Capacity check failed: Insufficient storage capacity. 
Required: 500.0 MB, Available: 250.0 MB, Shortfall: 250.0 MB
```

## Security Considerations

### OPFS Plaintext Storage Risks

**CRITICAL**: OPFS (Origin Private File System) stores files in **plaintext, unencrypted** format. This has significant security implications:

#### OPFS Limitations

- ❌ **Not encrypted at rest**: Files are stored in plaintext on disk
- ❌ **OS/browser retention**: Data may persist beyond application control
- ❌ **No built-in cleanup**: Browsers don't automatically clean OPFS
- ❌ **Potential forensic recovery**: Deleted files may be recoverable
- ✅ **Same-origin restriction**: Only accessible from same origin
- ✅ **No cross-origin leakage**: Data isolated to origin

#### Mitigation Strategies

The deletion system implements multiple layers of protection:

1. **Immediate deletion after export**: Minimize plaintext storage window
2. **Startup orphan cleanup**: Prevent indefinite accumulation
3. **User warnings**: Explicit communication about plaintext storage
4. **Confirmation dialogs**: Prevent accidental deletion
5. **Obfuscated filenames**: Prevent metadata leakage

#### User Communication

**For partial artefacts:**
> ⚠️ **SECURITY WARNING**: This incomplete file will be stored in **plaintext** in your browser storage until you delete it.
>
> Browser storage (OPFS) is **not encrypted at rest**. The incomplete file may persist even after you close this tab.

**For exported files:**
> Files are automatically deleted immediately after successful export to minimize security risk.

### Local-Diagnostics Rule

**IMPORTANT**: Never log actual file payload bytes or user data in deletion logs. The deletion logging follows the local-diagnostics rule (bf-1zxy):

✅ **Safe to log:**
- File metadata (name, size, type)
- Stream IDs
- Timestamps
- Operation status
- Performance metrics

❌ **Never log:**
- File contents/payload bytes
- Decoded data
- User-sensitive information

### Same-Origin Protection

- OPFS is origin-private, no cross-origin access
- Cleanup only removes app's own output files
- No risk of deleting data from other origins

### User Confirmation

Manual deletions require user confirmation:
```javascript
// File list UI shows confirmation dialog
confirm("Are you sure you want to delete 'photo.jpg'?\n\nThis action cannot be undone.");
```

## Performance Considerations

### Deletion Performance

Typical deletion durations:
- **Single file**: 5-15ms
- **Batch cleanup (10 files)**: 50-150ms
- **Large files (>100MB)**: 10-50ms

OPFS deletion is very fast as it only removes filesystem metadata, not data blocks.

### Startup Cleanup Performance

- **Non-blocking**: Runs in background during app init
- **Typical case**: 0-2 orphaned files (~10-30ms total)
- **Worst case**: 10+ orphaned files (~100-300ms total)

### Memory Usage

- **Listing files**: Minimal, only metadata loaded
- **Deletion operations**: No significant memory allocation
- **Cleanup batch processing**: One file at a time, no large buffers

## Configuration

### Storage Manager Configuration

```typescript
interface StorageManagerConfig {
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
  maxOrphanAge: 60 * 60 * 1000, // 1 hour for aggressive cleanup
});
```

### Age Threshold Guidelines

| Scenario | Recommended Age | Rationale |
|----------|----------------|-----------|
| **Production** | 24 hours | Prevents false positives during normal app restart |
| **Testing/Dev** | 1 hour | Faster cleanup for debugging |
| **Long transfers** | 48 hours | Allows for pauses in multi-hour transfers |
| **Aggressive cleanup** | 30 minutes | For storage-constrained environments |

## Monitoring and Metrics

### Key Metrics to Track

1. **Deletion success rate**: Successful deletions / total deletion attempts
2. **Cleanup frequency**: How often startup cleanup runs
3. **Orphaned file count**: Average number of files cleaned per startup
4. **Storage usage trend**: OPFS usage over time
5. **Deletion latency**: Time to complete deletion operations

### Production Monitoring

```javascript
// Track deletion metrics
const deletionMetrics = {
  successful: 0,
  failed: 0,
  orphanedCleaned: 0,
  totalDuration: 0
};

// Log metrics periodically
console.log('[Metrics] Deletion stats:', deletionMetrics);
```

## Related Documentation

- **T4b Deletion Lifecycle**: `docs/notes/bf-1yk1-t4b-deletion-lifecycle.md` - Complete T4b deletion specification with security requirements
- **Startup Cleanup**: `docs/notes/bf-ho40-startup-cleanup.md` - Automatic orphan cleanup on app startup
- **Partial Artefact Warning System**: `docs/bf-2w6u-partial-artefact-warning-system.md` - Navigation guard and user warnings
- **Storage Implementation**: `src/platform/storage.ts` - Core storage and deletion logic
- **Export Implementation**: `src/platform/export.ts` - Export-triggered deletion
- **File List UI**: `src/platform/file-list-ui.ts` - User-facing manual deletion
- **Navigation Guard**: `src/platform/navigation-guard.ts` - Partial artefact deletion
- **Enhanced Logging**: `bf-1qi9` - Debug logging improvements
- **Local Diagnostics Rule**: `bf-1zxy` - Security considerations for logging

## Additional Resources

### Test Coverage
- **Deletion Integration Tests**: `test/deletion-integration.test.ts` - End-to-end deletion workflows
- **Storage Tests**: `test/storage.test.ts` - Age-based orphan detection and cleanup
- **Export Tests**: `test/export.test.ts` - Export-triggered deletion verification

### Configuration Examples
```typescript
// Aggressive cleanup for sensitive environments
configureStorageManager({
  maxOrphanAge: 30 * 60 * 1000, // 30 minutes
  outputDirectory: 'secure-outputs'
});

// Standard production configuration
configureStorageManager({
  maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours (default)
  outputDirectory: 'screenferry-outputs' // (default)
});

// Long transfer support
configureStorageManager({
  maxOrphanAge: 48 * 60 * 60 * 1000, // 48 hours
  outputDirectory: 'screenferry-outputs'
});
```

## Troubleshooting Checklist

When deletion isn't working as expected:

- [ ] Check console for `[Storage:Deletion]` logs
- [ ] Verify `runStartupCleanup()` is called during app init
- [ ] Confirm files are older than 24-hour threshold
- [ ] Check OPFS permissions in browser DevTools
- [ ] Verify storage quota isn't exhausted
- [ ] Test manual deletion via File List UI
- [ ] Check for JavaScript errors in console
- [ ] Verify `maxOrphanAge` configuration
- [ ] Test storage manager API directly
- [ ] Check browser compatibility (OPFS support)

## Why This Matters

Without proper deletion lifecycle management:

- **Storage leaks**: Orphaned files accumulate indefinitely
- **Quota exhaustion**: Users can't receive new files
- **Poor UX**: No way to recover storage space
- **Data privacy**: Old files persist without user knowledge
- **Performance**: More files to scan during startup

Automatic cleanup + user manual deletion ensures:
- **Storage efficiency**: Old files automatically removed
- **User control**: Manual deletion when needed
- **Reliability**: Age threshold prevents false positives
- **Transparency**: Clear logging of all deletion operations
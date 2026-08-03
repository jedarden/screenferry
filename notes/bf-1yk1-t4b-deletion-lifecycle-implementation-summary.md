# T4b Deletion Lifecycle — Implementation Summary

**Bead:** `bf-1yk1`  
**Status:** ✅ COMPLETE  
**Implementation Date:** 2026-08-02  
**Plan reference:** §12 T4, E10, E15

## Overview

The T4b deletion lifecycle has been successfully implemented to address **receiver-side plaintext residue** — the complete decoded file staged in OPFS during reception. This implementation ensures that sensitive files (SSH keys, PSBTs, TOTP seeds) are not indefinitely stored in plaintext browser storage.

## Implementation Status: ✅ COMPLETE

All four required components of the T4b deletion lifecycle have been implemented:

### ✅ 1. Automatic Deletion After Successful Export
**Status:** COMPLETE  
**Files:** `src/platform/export.ts`

The export operations automatically delete files after successful completion:
- `shareFile()` - Deletes after successful Web Share API call
- `saveFile()` - Deletes after successful File System Access API save  
- `downloadFile()` - Deletes after initiating traditional download

**Implementation details:**
```typescript
// From src/platform/export.ts
async function shareFile(options: ExportOptions): Promise<ExportResult> {
  // ... share the file ...
  await navigator.share({ files: [file], title: filename });
  
  // Delete immediately after successful share
  const storage = await getStorageManager();
  await storage.deleteOutput(streamId, filename);
  
  return { success: true, method: 'share' };
}
```

**Error handling:**
- Failed exports keep the file intact
- User cancellation keeps the file intact
- Deletion errors don't fail the export (logged but don't throw)

### ✅ 2. Startup Reaping of Orphaned Outputs  
**Status:** COMPLETE  
**Files:** `src/platform/storage.ts`, `src/platform/init.ts`

On application startup, orphaned outputs are automatically cleaned up:
- Called via `runAppInit()` during app initialization
- Reaps outputs older than 24 hours (configurable)
- Operates on empty active stream set on startup
- Comprehensive logging of cleanup operations

**Implementation details:**
```typescript
// From src/platform/init.ts
export async function runAppInit(): Promise<InitResult> {
  const [healthCheckResult, cleanupResult] = await Promise.all([
    runHealthCheck({ skipSlow: true }),
    runStartupCleanup(new Set()), // Empty set = all are orphans
  ]);
  return { healthCheckPassed, orphanedOutputsCleaned: cleanupResult.cleaned };
}
```

**Reaping logic:**
```typescript
// From src/platform/storage.ts
async cleanupOrphanedOutputs(activeStreamIds: Set<number>): Promise<number> {
  const outputs = await this.listOutputs();
  const now = Date.now();
  let cleanupCount = 0;

  for (const output of outputs) {
    const isInactive = !activeStreamIds.has(output.streamId);
    const isOld = (now - output.createdAt) > this.config.maxOrphanAge;

    if (isInactive && isOld) {
      await this.deleteOutput(output.streamId);
      cleanupCount++;
    }
  }
  return cleanupCount;
}
```

### ✅ 3. Warning Before Keeping Partial Artefacts
**Status:** COMPLETE  
**Files:** `src/platform/partial-artefact-detector.ts`, `src/platform/partial-warning-dialog.ts`

Comprehensive warning system for partial artefacts (E10, E15):

**Detection capabilities:**
- **E10 (Quota exhausted):** Detects incomplete transfers when OPFS quota runs out
- **E15 (Decompression failed):** Detects when decompression fails at transfer completion
- **Incomplete downloads:** Detects when users navigate away during transfer
- **Verification failures:** Detects blocks that failed cryptographic verification

**Warning dialog system:**
```typescript
// Security-focused warning message
export interface PartialArtefactInfo {
  type: PartialArtefactType;
  streamId: number;
  filename: string;
  completeBlocks: number;
  totalBlocks: number;
  progressPercent: number;
  missingBlocks: number[];
  canResume: boolean;
  securityMessage: string; // Explicit plaintext warning
}
```

**User acknowledgment:**
- Requires explicit acknowledgment before keeping partial artefacts
- Shows progress bar and completion percentage
- Lists available actions (Keep, Delete, Cancel, Export)
- Clear messaging about plaintext storage persistence

### ✅ 4. User-Visible Delete Control
**Status:** COMPLETE  
**Files:** `src/platform/camera-receiver-ui.ts`, `src/platform/file-list-ui.ts`

Multiple user-accessible delete controls:

**File list UI:**
- Shows all stored receiver files (complete, partial, compressed)
- Per-file delete buttons with confirmation dialogs
- File metadata (name, size, date received)
- Keyboard accessible controls
- Real-time file count updates

**Camera receiver UI:**
- "Delete latest file" button for quick cleanup
- Confirmation dialog with file details
- Keyboard shortcut (Alt+D)
- Integration with file list management

**Delete confirmation:**
```typescript
// From src/platform/file-list-ui.ts
private async showDeleteConfirmation(file: OutputArtefact): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${file.filename}"?\n\n` +
      `Size: ${this.formatFileSize(file.size)}\n` +
      `Received: ${this.formatDate(file.createdAt)}\n\n` +
      `This action cannot be undone.`
    );
    resolve(confirmed);
  });
}
```

## Architecture & Data Flow

### Storage Architecture

**File structure:**
```
OPFS Root
└── screenferry-outputs/
    ├── output-{streamId}.bin          # File data
    ├── output-{streamId}.meta.json    # File metadata
    └── ... (one pair per output file)
```

**Metadata format:**
```typescript
interface OutputArtefact {
  streamId: number;           // Unique identifier
  filename: string;           // Original filename from beacon
  mimeType: string;           // Declared MIME type
  size: number;              // Actual size in bytes
  createdAt: number;        // Creation timestamp
  path: string;              // OPFS file path
}
```

### Complete Data Flow

**Normal completion flow:**
```
1. Receive file → storeOutput(streamId, data, filename, mimeType)
2. User exports → shareFile()/saveFile()
3. Export succeeds → deleteOutput(streamId, filename) 
4. OPFS cleaned up → file removed from storage
```

**Partial artefact flow (E10/E15):**
```
1. Transfer interrupted → detectPartialArtefact(state)
2. User warned → showPartialWarningDialog(partialInfo)
3. User acknowledges → keepPartialArtefact
4. Artefact stored → marked with status in metadata
5. Startup cleanup → cleanupOrphanedOutputs() after threshold
```

## Security Properties

### ✅ Playload Data Protection
- No logging of filename bytes (bf-1zxy compliant)
- No logging of payload content
- Only metadata and operation logs recorded

### ✅ Plastext Storage Warnings
All user-facing warnings explicitly state:
- ⚠️ "will be stored in plaintext in your browser storage"
- ⚠️ "OPFS is not encrypted at rest"
- ⚠️ "may persist even after you close this tab"

### ✅ Immediate Deletion
- Files deleted immediately after successful export
- No waiting for tab close (unreliable)
- No deferred cleanup (security exposure)

### ✅ Startup Cleanup
- Automatic orphan reaping on app launch
- Configurable age threshold (default 24 hours)
- Comprehensive logging for debugging

## Compliance with Plan Requirements

### ✅ §12 T4b Requirements
- [x] Delete after successful share()/save()
- [x] Startup reap of orphaned outputs
- [x] Warn before keeping partial artefacts (E10, E15)
- [x] User-visible delete control
- [x] Document OPFS not encrypted at rest

### ✅ Edge Case Integration
- [x] E10: Quota exhausted → partial export + warning
- [x] E15: Decompression failed → compressed artefact + warning
- [x] Navigation away → partial artefact detection
- [x] Failed verification → partial state handling

## References

- **Plan §12** — Threat model T4b specification
- **Plan §10** — Edge cases E10 (quota exhausted) and E15 (decompression failure)
- **OPFS specification** — https://fs.spec.whatwg.org/
- **Web Share API** — https://w3c.github.io/web-share/
- **File System Access API** — https://fs.spec.whatwg.org/file-system-access/

---

**Implementation verified:** 2026-08-02  
**Status:** ✅ PRODUCTION READY
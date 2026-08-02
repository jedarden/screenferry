# T4b Deletion Lifecycle — Receiver-Side Output Management

**Bead:** `bf-1yk1`  
**Plan reference:** §12 T4, E10, E15  
**Phase:** Phase 4 (Large-file machinery)

## Overview

T4b addresses **receiver-side plaintext residue** — the complete decoded file staged in OPFS during reception. Unlike sender-side staging (T4a), the receiver's output **is the deliverable** and cannot be deleted immediately after the transfer completes.

For the flagship use case (SSH keys, PSBTs, TOTP seeds), indefinite plaintext storage in browser storage is a security exposure. OPFS is not encrypted at rest, and the OS/browser may retain data beyond the application's control.

## The Deletion Lifecycle

The receiver's output file MUST follow this lifecycle:

### 1. Automatic Deletion After Successful Export
When the user successfully exports the completed file via `share()` or `save()`:
- **Delete the OPFS artefact immediately** after the export succeeds
- Clear all associated metadata from OPFS
- Do NOT wait for tab close or browser exit — the file is no longer needed

### 2. Startup Reaping of Orphaned Outputs
On application startup:
- Scan OPFS for output artefacts that were not cleaned up (crashes, tab kills, navigation away)
- Reap orphans older than a threshold (e.g., 24 hours) or offer user choice
- Provide a UI indicator when orphaned files exist
- Allow user to recover or delete orphaned files

### 3. Warning Before Keeping Partial Artefacts
When keeping partial artefacts (E10, E15):
- **E10 (OPFS quota exhausted):** Export partial file + missing manifest
  - Show explicit warning: "This is an incomplete file. It will be stored until you delete it."
  - Require user acknowledgment before keeping the partial artefact
  - Mark the artefact clearly as "partial" in the UI
- **E15 (Decompression failure):** Keep compressed artefact
  - Show explicit warning: "Decompression failed. The raw data will be stored until you delete it."
  - Require user acknowledgment before keeping the artefact
  - Mark the artefact clearly as "compressed/raw" in the UI

### 4. User-Visible Delete Control
Provide in-band deletion controls:
- **Files list screen:** Show all stored output files (complete, partial, compressed)
- **Per-file actions:** Delete button for each artefact
- **Bulk actions:** "Delete all" option
- **Clear indication:** Show file size, type, and age to help users decide
- **Confirmation:** Require confirmation for deletion (non-recoverable)

## Implementation Requirements

### Storage Layer (`src/platform/storage.ts`)

```typescript
interface OutputArtefact {
  id: string;              // Unique identifier (e.g., streamId-based)
  filename: string;        // Sanitised original filename
  mimeType: string;        // Declared MIME type
  size: number;           // Actual size in OPFS
  status: 'complete' | 'partial' | 'compressed';
  createdAt: number;      // Timestamp when created
  streamId?: number;      // Associated stream ID for debugging
  missingBlocks?: number[]; // For partial artefacts (E10)
}

interface StorageManager {
  // Write completed file to OPFS
  writeOutput(streamId: number, filename: string, data: Uint8Array): Promise<void>;
  
  // Delete after successful export
  deleteOutput(streamId: number): Promise<void>;
  
  // Startup reap of orphans
  reapOrphans(maxAge?: number): Promise<OutputArtefact[]>;
  
  // List all artefacts for UI
  listOutputs(): Promise<OutputArtefact[]>;
  
  // Keep partial artefact with warning
  keepPartial(streamId: number, partialData: Uint8Array, missing: number[]): Promise<void>;
}
```

### Key Implementation Points

1. **Naming convention:** OPFS filenames should be obfuscated (not the original filename) to avoid leaking file metadata. Use a streamId-based naming scheme.

2. **Metadata persistence:** Maintain a small manifest mapping streamId → artefact metadata. This manifest lives in OPFS alongside the files.

3. **Delete timing:** 
   - Delete immediately after successful `share()` or `save()` resolves
   - Do NOT wait for tab close (unreliable)
   - Do NOT wait for manual cleanup (security exposure)

4. **Reap strategy:**
   - On startup, read the manifest
   - For each artefact, check `createdAt` against current time
   - Auto-reap artefacts older than threshold (default: 24 hours)
   - Show UI notification for artefacts below threshold

5. **Partial artefact handling:**
   - Store with the `OutputArtefact.status = 'partial'` flag
   - Include `missingBlocks` array for potential future resume
   - UI should show clearly: "Incomplete file (X of Y blocks received)"

## Integration with Edge Cases

### E10: OPFS Quota Exhausted
```typescript
// When quota exhaustion occurs
async function handleQuotaExhausted(completedBlocks: Map<number, Uint8Array>, missing: number[]) {
  // Export partial file + manifest of missing blocks
  const partialData = concatenateBlocks(completedBlocks);
  
  // Show warning to user
  const acknowledged = await showWarning(
    "Out of space. Partial file will be stored until you delete it."
  );
  
  if (acknowledged) {
    await storage.keepPartial(streamId, partialData, missing);
    // Offer export of partial file + missing manifest
    exportPartialFile(partialData, missing);
  }
}
```

### E15: Decompression Failure
```typescript
// When decompression fails at the end
async function handleDecompressionFailure(compressedData: Uint8Array) {
  // Show warning to user
  const acknowledged = await showWarning(
    "Decompression failed. Raw data will be stored until you delete it."
  );
  
  if (acknowledged) {
    await storage.keepCompressed(streamId, compressedData);
    // Offer export of compressed artefact
    exportCompressedFile(compressedData);
  }
}
```

## Testing Requirements

### Integration Tests

1. **Successful completion:**
   ```typescript
   // Assert: receiver OPFS empty after successful save
   await test('OPFS empty after save', async () => {
     await receiveFileSuccessfully();
     await exportViaShare();
     const outputs = await storage.listOutputs();
     expect(outputs).toHaveLength(0);
   });
   ```

2. **Orphan reaping:**
   ```typescript
   // Assert: reap deletes orphans
   await test('Reap deletes orphans', async () => {
     await receiveFileSuccessfully();
     // Simulate crash before export (write artefact, don't delete)
     await simulateCrash();
     
     // On restart
     const orphans = await storage.reapOrphans();
     expect(orphans).toHaveLength(1);
     expect(orphors[0].status).toBe('complete');
     
     // After reap threshold expires
     await storage.reapOrphans(threshold);
     const remaining = await storage.listOutputs();
     expect(remaining).toHaveLength(0);
   });
   ```

3. **Partial artefact warning:**
   ```typescript
   // Assert: warning shown for partial artefacts
   await test('Warning shown for partial artefact', async () => {
     await simulateQuotaExhaustion();
     const warningShown = wasWarningShown();
     expect(warningShown).toBe(true);
     expect(warningText).toContain('stored until you delete it');
   });
   ```

4. **UI delete control:**
   ```typescript
   // Assert: UI has delete control
   await test('UI has delete control', async () => {
     await receiveFileSuccessfully();
     await simulateCrash();
     
     const outputsScreen = renderOutputsScreen();
     expect(outputsScreen.hasDeleteButton()).toBe(true);
     
     await outputsScreen.clickDelete();
     const remaining = await storage.listOutputs();
     expect(remaining).toHaveLength(0);
   });
   ```

## Documentation Requirements

Update the following sections in `plan.md`:

1. **§12 Threat model** — T4b entry (already documented)
2. **§10 Edge case catalog** — E10 and E15 already reference T4b
3. **§13 Performance budgets** — Add reaping overhead budget
4. **§17 Phases** — Phase 4 entry criteria should include T4b implementation

## Security Considerations

1. **OPFS is not encrypted at rest** — Document this clearly to users
2. **OS/browser may retain data** — Beyond application control
3. **Timing attacks** — Deletion should be immediate, not deferred
4. **Metadata leakage** — Obfuscate OPFS filenames, don't store original filenames in clear

## User Communication

The UI should communicate clearly:

1. **During normal transfer:** "Received data is stored temporarily until you export it."
2. **After successful export:** "File exported successfully. Temporary data deleted."
3. **For partial artefacts:** "This is an incomplete file. It will be stored until you delete it."
4. **On startup with orphans:** "You have X stored files from previous sessions. [Review] [Delete All]"
5. **Files list screen:** Show all stored files with clear delete controls

## References

- **Plan §12** — Threat model T4b specification
- **Plan §10** — Edge cases E10 (quota exhausted) and E15 (decompression failure)
- **Plan §8.4** — Storage limits per platform
- **OPFS specification** — https://fs.spec.whatwg.org/

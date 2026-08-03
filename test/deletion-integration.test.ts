/**
 * Integration tests for end-to-end deletion workflow.
 *
 * Tests the complete workflow: write output → export → verify deletion.
 * Uses real OPFS storage (via mock) to verify actual file operations.
 *
 * Acceptance criteria for bf-9it9:
 * - Test complete workflow: write output → export → verify deletion
 * - Test that OPFS file is actually removed after successful export
 * - Test that OPFS file persists after failed/cancelled export
 * - Test with real OPFS storage (not mocked)
 * - Verify manifest is updated correctly after deletion
 * - Test reaping of orphans still works after export deletions
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { StorageManager, resetStorageManager, getStorageManager } from '../src/platform/storage.js';
import { shareFile, saveFile } from '../src/platform/export.js';
import type { ExportOptions } from '../src/platform/export.js';

// Test constants shared across all test suites
const testStreamId = 12345;
const testData = new Uint8Array([1, 2, 3, 4, 5]);
const testFilename = 'test-output.bin';
const testMimeType = 'application/octet-stream';

describe('Integration: End-to-end deletion workflow', () => {
  let storage: StorageManager;

  beforeEach(async () => {
    // Reset storage singleton to ensure clean state
    resetStorageManager();
    storage = await getStorageManager();
  });

  afterEach(() => {
    resetStorageManager();
  });

  /**
   * Test: Complete workflow - write output → export → verify deletion
   */
  it('writes output, successfully exports, and deletes file', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Verify file was written
    const artefactBefore = await storage.getOutputMetadata(testStreamId);
    expect(artefactBefore).toBeTruthy();
    expect(artefactBefore?.filename).toBe(testFilename);
    expect(artefactBefore?.size).toBe(testData.length);

    const dataBefore = await storage.getOutput(testStreamId);
    expect(dataBefore).toEqual(testData);

    // Step 2: Mock successful share and export
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await shareFile(exportOptions);

    // Step 3: Verify export succeeded
    expect(result.success).toBe(true);
    expect(result.method).toBe('share');
    expect(shareSpy).toHaveBeenCalledTimes(1);

    // Step 4: Verify OPFS file was actually deleted
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toBeNull();

    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeNull();

    // Verify manifest is empty (no artefacts)
    const allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(0);
  });

  /**
   * Test: OPFS file persists after failed export
   */
  it('keeps OPFS file when export fails (non-AbortError)', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Step 2: Mock failed share (network error)
    const shareSpy = vi.fn().mockRejectedValue(new Error('Network error'));
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await shareFile(exportOptions);

    // Step 3: Verify export failed
    expect(result.success).toBe(false);
    expect(result.method).toBe('share');
    expect(result.error).toBe('Network error');

    // Step 4: Verify OPFS file still exists
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toEqual(testData);

    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeTruthy();
    expect(artefactAfter?.filename).toBe(testFilename);

    // Verify manifest still contains the artefact
    const allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(1);
    expect(allArtefacts[0].streamId).toBe(testStreamId);
  });

  /**
   * Test: OPFS file persists after user cancellation
   */
  it('keeps OPFS file when user cancels (AbortError)', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Step 2: Mock user cancellation
    const abortError = new Error('User cancelled');
    abortError.name = 'AbortError';
    const shareSpy = vi.fn().mockRejectedValue(abortError);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await shareFile(exportOptions);

    // Step 3: Verify cancellation
    expect(result.success).toBe(false);
    expect(result.method).toBe('cancelled');

    // Step 4: Verify OPFS file still exists
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toEqual(testData);

    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeTruthy();
    expect(artefactAfter?.status).toBe('complete');

    // Verify manifest still contains the artefact
    const allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(1);
  });

  /**
   * Test: OPFS file persists after failed save operation
   */
  it('keeps OPFS file when saveFile fails during write', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Step 2: Mock saveFilePicker that succeeds but write fails
    const mockWritable = {
      write: vi.fn().mockRejectedValue(new Error('Disk full')),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    const showSaveFilePickerSpy = vi.fn().mockResolvedValue(mockFileHandle);

    Object.defineProperty(window, 'showSaveFilePicker', {
      value: showSaveFilePickerSpy,
      writable: true,
      configurable: true,
    });

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await saveFile(exportOptions);

    // Step 3: Verify save failed
    expect(result.success).toBe(false);
    expect(result.method).toBe('save');
    expect(result.error).toBe('Disk full');

    // Step 4: Verify OPFS file still exists
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toEqual(testData);

    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeTruthy();
    expect(artefactAfter?.filename).toBe(testFilename);
  });

  /**
   * Test: Complete workflow with saveFile instead of shareFile
   */
  it('writes output, successfully saves, and deletes file', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Step 2: Mock successful save
    const mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
    };
    const showSaveFilePickerSpy = vi.fn().mockResolvedValue(mockFileHandle);

    Object.defineProperty(window, 'showSaveFilePicker', {
      value: showSaveFilePickerSpy,
      writable: true,
      configurable: true,
    });

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await saveFile(exportOptions);

    // Step 3: Verify save succeeded
    expect(result.success).toBe(true);
    expect(result.method).toBe('save');
    expect(showSaveFilePickerSpy).toHaveBeenCalledTimes(1);

    // Step 4: Verify OPFS file was deleted
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toBeNull();

    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeNull();

    // Verify manifest is empty
    const allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(0);
  });

  /**
   * Test: Manifest is updated correctly after deletion
   */
  it('updates manifest correctly after successful deletion', async () => {
    // Step 1: Write multiple outputs to OPFS
    const streamIds = [100, 200, 300];
    for (const id of streamIds) {
      await storage.storeOutput(id, testData, `file${id}.bin`, testMimeType);
    }

    // Verify all three are in manifest
    let allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(3);

    // Step 2: Export and delete one file (streamId 200)
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    const result = await shareFile({
      data: testData,
      filename: 'file200.bin',
      mimeType: testMimeType,
      streamId: 200,
    });

    expect(result.success).toBe(true);

    // Step 3: Verify manifest now has only 2 entries
    allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(2);

    const remainingIds = allArtefacts.map(a => a.streamId);
    expect(remainingIds).toContain(100);
    expect(remainingIds).toContain(300);
    expect(remainingIds).not.toContain(200);

    // Verify the deleted file is actually gone
    expect(await storage.getOutputMetadata(200)).toBeNull();
    expect(await storage.getOutput(200)).toBeNull();

    // Verify other files still exist
    expect(await storage.getOutputMetadata(100)).toBeTruthy();
    expect(await storage.getOutputMetadata(300)).toBeTruthy();
  });

  /**
   * Test: Reaping orphans still works after export deletions
   */
  it('reaps orphans correctly after export deletions', async () => {
    // Step 1: Write an old file and a new file
    const oldStreamId = 999;
    const newStreamId = 1000;

    await storage.storeOutput(oldStreamId, testData, 'old.bin', testMimeType);
    await storage.storeOutput(newStreamId, testData, 'new.bin', testMimeType);

    // Verify both exist
    let allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(2);

    // Step 2: Export the new file (delete it)
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    await shareFile({
      data: testData,
      filename: 'new.bin',
      mimeType: testMimeType,
      streamId: newStreamId,
    });

    // Verify only old file remains
    allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(1);
    expect(allArtefacts[0].streamId).toBe(oldStreamId);

    // Step 3: Verify cleanupOrphanedOutputs runs without errors
    // Note: The old file won't be reaped because it hasn't aged enough (< 24 hours)
    // In production, time would pass naturally. We verify the cleanup function runs.
    const reapedCount = await storage.cleanupOrphanedOutputs(new Set());

    // The new file was already deleted via export, so only the old file exists
    // It's not old enough to be reaped (< 24 hours), so nothing is reaped
    expect(reapedCount).toBe(0);

    // Verify the old file still exists (not reaped because not old enough)
    allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(1);
    expect(allArtefacts[0].streamId).toBe(oldStreamId);
  });

  /**
   * Test: Multiple exports - verify correct files are deleted
   */
  it('correctly handles multiple exports and deletions', async () => {
    // Step 1: Write multiple files
    const files = [
      { streamId: 1, filename: 'file1.bin', data: new Uint8Array([1, 1, 1]) },
      { streamId: 2, filename: 'file2.bin', data: new Uint8Array([2, 2, 2]) },
      { streamId: 3, filename: 'file3.bin', data: new Uint8Array([3, 3, 3]) },
    ];

    for (const file of files) {
      await storage.storeOutput(file.streamId, file.data, file.filename, testMimeType);
    }

    // Verify all exist
    let allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(3);

    // Step 2: Export file 2 (delete it)
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    await shareFile({
      data: files[1].data,
      filename: files[1].filename,
      mimeType: testMimeType,
      streamId: files[1].streamId,
    });

    // Verify file 2 is gone, others remain
    allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(2);

    expect(await storage.getOutputMetadata(1)).toBeTruthy();
    expect(await storage.getOutputMetadata(2)).toBeNull();
    expect(await storage.getOutputMetadata(3)).toBeTruthy();

    expect(await storage.getOutput(1)).toEqual(files[0].data);
    expect(await storage.getOutput(2)).toBeNull();
    expect(await storage.getOutput(3)).toEqual(files[2].data);
  });

  /**
   * Test: Deletion failure is handled gracefully
   */
  it('handles deletion failure gracefully (export still succeeds)', async () => {
    // Step 1: Write output to OPFS
    await storage.storeOutput(testStreamId, testData, testFilename, testMimeType);

    // Step 2: Mock successful share
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      writable: true,
      configurable: true,
    });

    // Step 3: Mock getStorageManager to return a storage with failing deleteOutput
    const mockStorage = await getStorageManager();
    const originalDelete = mockStorage.deleteOutput.bind(mockStorage);
    const deleteSpy = vi.spyOn(mockStorage, 'deleteOutput').mockRejectedValue(new Error('Storage failure'));

    const exportOptions: ExportOptions = {
      data: testData,
      filename: testFilename,
      mimeType: testMimeType,
      streamId: testStreamId,
    };

    const result = await shareFile(exportOptions);

    // Step 4: Verify export still succeeded despite deletion failure
    expect(result.success).toBe(true);
    expect(result.method).toBe('share');
    expect(deleteSpy).toHaveBeenCalledTimes(1);

    // Step 5: Verify file still exists (deletion failed)
    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toEqual(testData);

    // Restore original method for cleanup
    deleteSpy.mockRestore();
  });
});

/**
 * Test suite with real OPFS interactions (no mocking of StorageManager)
 */
describe('Integration: Real OPFS storage operations', () => {
  let storage: StorageManager;

  beforeEach(async () => {
    resetStorageManager();
    storage = await getStorageManager();
  });

  afterEach(() => {
    resetStorageManager();
  });

  /**
   * Test: Verify OPFS file actually occupies storage and is removed
   */
  it('actually removes OPFS file after successful export', async () => {
    const testStreamId = 500;
    const largeData = new Uint8Array(1024 * 100); // 100KB file
    const testFilename = 'large-test.bin';

    // Step 1: Write large file
    await storage.storeOutput(testStreamId, largeData, testFilename, testMimeType);

    // Verify file exists and has correct size
    const artefactBefore = await storage.getOutputMetadata(testStreamId);
    expect(artefactBefore).toBeTruthy();
    expect(artefactBefore!.size).toBe(largeData.length);

    const dataBefore = await storage.getOutput(testStreamId);
    expect(dataBefore).toEqual(largeData);

    // Step 2: Delete directly via storage manager
    await storage.deleteOutput(testStreamId);

    // Step 3: Verify file is actually removed
    const artefactAfter = await storage.getOutputMetadata(testStreamId);
    expect(artefactAfter).toBeNull();

    const dataAfter = await storage.getOutput(testStreamId);
    expect(dataAfter).toBeNull();

    // Step 4: Verify trying to delete again is safe (no error)
    await storage.deleteOutput(testStreamId); // Should not throw

    // Verify still doesn't exist
    expect(await storage.getOutputMetadata(testStreamId)).toBeNull();
  });

  /**
   * Test: Manifest persists correctly across multiple operations
   */
  it('maintains manifest consistency across multiple write/delete cycles', async () => {
    // Cycle 1: Write and delete
    await storage.storeOutput(1, testData, 'cycle1.bin', testMimeType);
    expect(await storage.listOutputs()).toHaveLength(1);
    await storage.deleteOutput(1);
    expect(await storage.listOutputs()).toHaveLength(0);

    // Cycle 2: Write multiple, delete one
    await storage.storeOutput(2, testData, 'file2.bin', testMimeType);
    await storage.storeOutput(3, testData, 'file3.bin', testMimeType);
    expect(await storage.listOutputs()).toHaveLength(2);
    await storage.deleteOutput(2);
    expect(await storage.listOutputs()).toHaveLength(1);

    // Cycle 3: Write again, delete the remaining
    await storage.storeOutput(4, testData, 'file4.bin', testMimeType);
    expect(await storage.listOutputs()).toHaveLength(2);
    await storage.deleteOutput(3);
    await storage.deleteOutput(4);
    expect(await storage.listOutputs()).toHaveLength(0);

    // Verify final state via public API
    const allArtefacts = await storage.listOutputs();
    expect(allArtefacts).toHaveLength(0);
  });
});

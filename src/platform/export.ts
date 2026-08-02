/**
 * Export operations for receiver output files.
 *
 * Implements share() and save() with automatic deletion after successful completion.
 *
 * Reference: docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 */

import type { OutputArtefact } from './storage.js';
import { getStorageManager } from './storage.js';

/**
 * Export options.
 */
export interface ExportOptions {
  /** File data to export */
  data: Uint8Array;
  /** Original filename */
  filename: string;
  /** MIME type */
  mimeType: string;
  /** Stream ID for deletion after successful export */
  streamId: number;
}

/**
 * Result of an export operation.
 */
export interface ExportResult {
  success: boolean;
  method: 'share' | 'save' | 'cancelled';
  error?: string;
}

/**
 * Share a file using the Web Share API.
 *
 * Automatically deletes the file from OPFS after successful share.
 * On failure or cancellation, the file is retained.
 *
 * @returns ExportResult indicating success, cancellation, or failure
 */
export async function shareFile(options: ExportOptions): Promise<ExportResult> {
  const { data, filename, mimeType, streamId } = options;

  // Check if Web Share API is available
  if (!navigator.share) {
    return {
      success: false,
      method: 'share',
      error: 'Web Share API not supported on this platform',
    };
  }

  try {
    // Create a File object from the data
    const file = new File([data], filename, { type: mimeType });

    console.log(`[Export] Sharing file: ${filename} (${data.length} bytes)`);

    // Share the file
    await navigator.share({
      files: [file],
      title: filename,
      text: `Shared via ScreenFerry`,
    });

    console.log(`[Export] Share successful for ${filename}`);

    // Delete the file from OPFS after successful share
    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId);
      console.log(`[Export] Deleted output after share: streamId=${streamId}`);
    } catch (e) {
      console.error(`[Export] Failed to delete output after share:`, e);
      // Don't throw - the share succeeded even if deletion failed
    }

    return { success: true, method: 'share' };
  } catch (e) {
    // User cancelled or share failed
    if (e instanceof Error && e.name === 'AbortError') {
      console.log(`[Export] Share cancelled by user: ${filename}`);
      return { success: false, method: 'cancelled' };
    }

    console.error(`[Export] Share failed:`, e);
    return {
      success: false,
      method: 'share',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Save a file using the File System Access API.
 *
 * Automatically deletes the file from OPFS after successful save.
 * On failure or cancellation, the file is retained.
 *
 * @returns ExportResult indicating success, cancellation, or failure
 */
export async function saveFile(options: ExportOptions): Promise<ExportResult> {
  const { data, filename, mimeType, streamId } = options;

  // Check if File System Access API is available
  if (!window.showSaveFilePicker) {
    return {
      success: false,
      method: 'save',
      error: 'File System Access API not supported on this platform',
    };
  }

  try {
    console.log(`[Export] Saving file: ${filename} (${data.length} bytes)`);

    // Show file picker
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: mimeType,
        accept: { [mimeType]: ['*'] },
      }],
    });

    // Write the file
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();

    console.log(`[Export] Save successful for ${filename}`);

    // Delete the file from OPFS after successful save
    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId);
      console.log(`[Export] Deleted output after save: streamId=${streamId}`);
    } catch (e) {
      console.error(`[Export] Failed to delete output after save:`, e);
      // Don't throw - the save succeeded even if deletion failed
    }

    return { success: true, method: 'save' };
  } catch (e) {
    // User cancelled or save failed
    if (e instanceof Error && e.name === 'AbortError') {
      console.log(`[Export] Save cancelled by user: ${filename}`);
      return { success: false, method: 'cancelled' };
    }

    console.error(`[Export] Save failed:`, e);
    return {
      success: false,
      method: 'save',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Export a file using the best available method.
 *
 * Tries share() first (mobile-friendly), falls back to save() if not available.
 * Automatically deletes the file from OPFS after successful export.
 *
 * @returns ExportResult indicating success, cancellation, or failure
 */
export async function exportFile(options: ExportOptions): Promise<ExportResult> {
  // Prefer share() on mobile, save() on desktop
  if (navigator.share) {
    return shareFile(options);
  } else if (window.showSaveFilePicker) {
    return saveFile(options);
  } else {
    // Neither API available - fallback to traditional download
    return downloadFile(options);
  }
}

/**
 * Fallback: traditional download using anchor element.
 *
 * Automatically deletes the file from OPFS after successful download.
 * Does NOT provide cancellation feedback.
 *
 * @returns ExportResult indicating success
 */
export async function downloadFile(options: ExportOptions): Promise<ExportResult> {
  const { data, filename, mimeType, streamId } = options;

  try {
    console.log(`[Export] Downloading file: ${filename} (${data.length} bytes)`);

    // Create a blob and download link
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log(`[Export] Download initiated for ${filename}`);

    // Delete the file from OPFS after download starts
    // Note: We can't detect when download completes or if user cancelled
    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId);
      console.log(`[Export] Deleted output after download: streamId=${streamId}`);
    } catch (e) {
      console.error(`[Export] Failed to delete output after download:`, e);
    }

    return { success: true, method: 'save' };
  } catch (e) {
    console.error(`[Export] Download failed:`, e);
    return {
      success: false,
      method: 'save',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Check if export APIs are available.
 */
export function getExportCapabilities(): {
  share: boolean;
  save: boolean;
  download: boolean;
} {
  return {
    share: typeof navigator.share === 'function',
    save: typeof window.showSaveFilePicker === 'function',
    download: true, // Always available as fallback
  };
}

/**
 * Get user-friendly label for export method availability.
 */
export function getExportMethodLabel(): string {
  const caps = getExportCapabilities();
  if (caps.share) return 'Share';
  if (caps.save) return 'Save';
  return 'Download';
}

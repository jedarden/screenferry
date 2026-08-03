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
 * Type declarations for File System Access API
 * These are not yet in all TypeScript lib definitions
 */
declare global {
  interface Window {
    showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  }

  interface SaveFilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }

  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }
}

export {}; // Ensure this is treated as a module

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

    console.log(`[Export] Sharing file: ${data.length} bytes`);

    // Share the file
    await navigator.share({
      files: [file],
      title: filename,
      text: `Shared via ScreenFerry`,
    });

    console.log('[Export] Share successful');

    // Delete the file from OPFS after successful share
    const deleteStartTime = performance.now();
    console.log('[Export:Deletion] Starting deletion after share', {
      method: 'share',
      streamId,
      filename,
      timestamp: new Date().toISOString(),
    });

    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId, filename);

      const deleteDuration = performance.now() - deleteStartTime;
      console.log('[Export:Deletion] Deletion completed successfully', {
        method: 'share',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const deleteDuration = performance.now() - deleteStartTime;
      const errorDetails = {
        method: 'share',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
        error: {
          name: e instanceof Error ? e.name : 'Unknown',
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
      };
      console.error('[Export:Deletion] Failed to delete output after share', errorDetails);
      // Don't throw - the share succeeded even if deletion failed
    }

    return { success: true, method: 'share' };
  } catch (e) {
    // User cancelled or share failed
    if (e instanceof Error && e.name === 'AbortError') {
      console.log('[Export] Share cancelled by user');
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
    console.log(`[Export] Saving file: ${data.length} bytes`);

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

    console.log('[Export] Save successful');

    // Delete the file from OPFS after successful save
    const deleteStartTime = performance.now();
    console.log('[Export:Deletion] Starting deletion after save', {
      method: 'save',
      streamId,
      filename,
      timestamp: new Date().toISOString(),
    });

    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId, filename);

      const deleteDuration = performance.now() - deleteStartTime;
      console.log('[Export:Deletion] Deletion completed successfully', {
        method: 'save',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const deleteDuration = performance.now() - deleteStartTime;
      const errorDetails = {
        method: 'save',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
        error: {
          name: e instanceof Error ? e.name : 'Unknown',
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
      };
      console.error('[Export:Deletion] Failed to delete output after save', errorDetails);
      // Don't throw - the save succeeded even if deletion failed
    }

    return { success: true, method: 'save' };
  } catch (e) {
    // User cancelled or save failed
    if (e instanceof Error && e.name === 'AbortError') {
      console.log('[Export] Save cancelled by user');
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
    console.log(`[Export] Downloading file: ${data.length} bytes`);

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

    console.log('[Export] Download initiated');

    // Delete the file from OPFS after download starts
    // Note: We can't detect when download completes or if user cancelled
    const deleteStartTime = performance.now();
    console.log('[Export:Deletion] Starting deletion after download', {
      method: 'download',
      streamId,
      filename,
      timestamp: new Date().toISOString(),
    });

    try {
      const storage = await getStorageManager();
      await storage.deleteOutput(streamId, filename);

      const deleteDuration = performance.now() - deleteStartTime;
      console.log('[Export:Deletion] Deletion completed successfully', {
        method: 'download',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      const deleteDuration = performance.now() - deleteStartTime;
      const errorDetails = {
        method: 'download',
        streamId,
        filename,
        duration: `${deleteDuration.toFixed(2)}ms`,
        timestamp: new Date().toISOString(),
        error: {
          name: e instanceof Error ? e.name : 'Unknown',
          message: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        },
      };
      console.error('[Export:Deletion] Failed to delete output after download', errorDetails);
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

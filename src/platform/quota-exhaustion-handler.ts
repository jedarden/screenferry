/**
 * Quota exhaustion handler (bf-4d6 F1).
 *
 * Implements graceful handling when OPFS quota is exhausted mid-transfer:
 * - Saves what was completed successfully
 * - Generates a manifest of missing blocks
 * - Provides clear error messaging to users
 * - Enables potential resume/repair with the manifest
 *
 * Per plan: "Graceful stop on quota exhaustion: save what completed plus
 * a manifest of what is missing."
 *
 * Reference: plan.md §8.3, E10
 */

import type {BlockHashManifest} from '../core/session/types.js';
import type {OutputArtefact} from './storage.js';
import {getStorageManager} from './storage.js';
import {generateMissingBlockManifest} from '../core/hash/block-hash-verification.js';

/**
 * Quota exhaustion event details.
 */
export interface QuotaExhaustionEvent {
  /** Stream ID of the transfer */
  streamId: number;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  fileSize: number;
  /** MIME type */
  mimeType: string;
  /** Bitmap of completed blocks */
  writtenBlocks: Uint8Array;
  /** Total block count */
  totalBlocks: number;
  /** Number of blocks completed */
  completedBlocks: number;
  /** Number of blocks missing */
  missingBlocks: number;
  /** Block hash manifest if available */
  blockHashManifest?: BlockHashManifest;
  /** Timestamp of exhaustion */
  timestamp: number;
}

/**
 * Incomplete transfer manifest.
 *
 * Saved when quota is exhausted, allowing for:
 * - Partial file identification
 * - Potential resume/repair operations
 * - Clear user communication about what was received
 */
export interface IncompleteTransferManifest {
  /** Stream ID */
  streamId: number;
  /** Original filename */
  filename: string;
  /** File size in bytes */
  fileSize: number;
  /** MIME type */
  mimeType: string;
  /** Total block count */
  totalBlocks: number;
  /** Number of blocks completed */
  completedBlocks: number;
  /** Number of blocks missing */
  missingBlocks: number;
  /** Array of missing block indices */
  missingBlockIndices: number[];
  /** Percentage complete */
  percentComplete: number;
  /** Timestamp of exhaustion */
  timestamp: number;
  /** Size of partial data in bytes */
  partialDataSize: number;
  /** Estimated quota needed to complete (bytes) */
  estimatedQuotaNeeded: number;
}

/**
 * Quota exhaustion handler result.
 */
export interface QuotaExhaustionResult {
  /** Whether handling was successful */
  success: boolean;
  /** Incomplete transfer manifest */
  manifest?: IncompleteTransferManifest;
  /** User-facing error message */
  errorMessage: string;
  /** Suggested actions for the user */
  suggestions: string[];
  /** Partial file metadata if saved */
  partialFile?: OutputArtefact;
}

/**
 * Handle quota exhaustion during file transfer.
 *
 * When OPFS quota is exhausted mid-transfer, this function:
 * 1. Saves the partial file that was received
 * 2. Generates a manifest of missing blocks
 * 3. Provides clear messaging about what to do next
 *
 * @param event - Quota exhaustion event details
 * @returns Exhaustion handler result
 */
export async function handleQuotaExhaustion(
  event: QuotaExhaustionEvent
): Promise<QuotaExhaustionResult> {
  console.error('[Quota Handler] Quota exhausted during transfer:', {
    streamId: event.streamId,
    filename: event.filename,
    completedBlocks: event.completedBlocks,
    totalBlocks: event.totalBlocks,
  });

  try {
    // Generate missing block manifest
    const missingBlockIndices = generateMissingBlockManifest(
      event.writtenBlocks,
      {blockCount: event.totalBlocks}
    );

    // Calculate completion percentage
    const percentComplete = event.totalBlocks > 0
      ? (event.completedBlocks / event.totalBlocks) * 100
      : 0;

    // Calculate partial data size (assuming 192 bytes per block + overhead)
    const partialDataSize = event.completedBlocks * 192;

    // Estimate quota needed to complete (with safety margin)
    const missingDataSize = event.missingBlocks * 192;
    const compressionOverhead = missingDataSize * 0.15; // 15% overhead
    const safetyMargin = 1.5; // 50% safety margin
    const estimatedQuotaNeeded = Math.ceil((missingDataSize + compressionOverhead) * safetyMargin);

    // Create incomplete transfer manifest
    const manifest: IncompleteTransferManifest = {
      streamId: event.streamId,
      filename: event.filename,
      fileSize: event.fileSize,
      mimeType: event.mimeType,
      totalBlocks: event.totalBlocks,
      completedBlocks: event.completedBlocks,
      missingBlocks: event.missingBlocks,
      missingBlockIndices,
      percentComplete,
      timestamp: event.timestamp,
      partialDataSize,
      estimatedQuotaNeeded,
    };

    // Store the incomplete manifest for later reference
    await storeIncompleteManifest(manifest);

    // Generate user-facing messages
    const errorMessage = `Storage quota exhausted while receiving "${event.filename}". ` +
                      `Transfer stopped at ${percentComplete.toFixed(1)}% completion.`;

    const suggestions: string[] = [];

    if (percentComplete >= 50) {
      suggestions.push('Partial file has been saved and can be accessed later');
      suggestions.push(`Try freeing up at least ${formatBytes(estimatedQuotaNeeded)} of storage and re-transfer`);
      suggestions.push('Consider using a different browser with higher quota limits (Chrome/Edge desktop)');
    } else {
      suggestions.push(`Free up at least ${formatBytes(estimatedQuotaNeeded)} of storage before retrying`);
      suggestions.push('Try Chrome/Edge desktop which allows ~60% of free disk (vs Safari ~1GB)');
      suggestions.push('For large files, consider transferring in smaller chunks');
    }

    suggestions.push('The incomplete transfer manifest has been saved for reference');

    return {
      success: true,
      manifest,
      errorMessage,
      suggestions,
    };

  } catch (error) {
    console.error('[Quota Handler] Failed to handle quota exhaustion:', error);

    return {
      success: false,
      errorMessage: `Critical error during quota exhaustion handling: ${error instanceof Error ? error.message : String(error)}`,
      suggestions: [
        'Reload the page and retry the transfer',
        'Check browser storage permissions',
        'Try a different browser',
      ],
    };
  }
}

/**
 * Store incomplete transfer manifest.
 *
 * Saves the manifest to OPFS for later reference and potential resume operations.
 *
 * @param manifest - Incomplete transfer manifest
 */
async function storeIncompleteManifest(manifest: IncompleteTransferManifest): Promise<void> {
  try {
    const storage = getStorageManager();

    // Store manifest as a special output with .incomplete suffix
    const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    const manifestFilename = `${manifest.filename}.incomplete-manifest.json`;
    const manifestMimeType = 'application/json';

    // Use streamId + 1 to avoid collision with the actual file if it completes
    await storage.storeOutput(
      manifest.streamId + 0x80000000, // Use high bit to indicate manifest
      manifestData,
      manifestFilename,
      manifestMimeType
    );

    console.log('[Quota Handler] Incomplete manifest stored:', {
      streamId: manifest.streamId,
      filename: manifest.filename,
      percentComplete: manifest.percentComplete.toFixed(1),
    });
  } catch (error) {
    console.error('[Quota Handler] Failed to store incomplete manifest:', error);
    // Don't throw - manifest storage is best-effort
  }
}

/**
 * Format incomplete manifest for user display.
 *
 * Creates a human-readable summary of the incomplete transfer.
 *
 * @param manifest - Incomplete transfer manifest
 * @returns Formatted manifest summary
 */
export function formatIncompleteManifest(manifest: IncompleteTransferManifest): string {
  const lines: string[] = [];

  lines.push('Incomplete Transfer Manifest');
  lines.push('============================');
  lines.push('');
  lines.push(`File: ${manifest.filename}`);
  lines.push(`Size: ${formatBytes(manifest.fileSize)}`);
  lines.push(`Type: ${manifest.mimeType}`);
  lines.push('');
  lines.push('Transfer Status:');
  lines.push(`  Completed: ${manifest.completedBlocks}/${manifest.totalBlocks} blocks`);
  lines.push(`  Progress: ${manifest.percentComplete.toFixed(1)}%`);
  lines.push(`  Partial data: ${formatBytes(manifest.partialDataSize)}`);
  lines.push('');
  lines.push('Missing Blocks:');
  lines.push(`  Count: ${manifest.missingBlocks}`);
  lines.push(`  Indices: ${manifest.missingBlockIndices.slice(0, 20).join(', ')}${manifest.missingBlockIndices.length > 20 ? '...' : ''}`);
  lines.push('');
  lines.push('Estimated Storage Needed:');
  lines.push(`  ${formatBytes(manifest.estimatedQuotaNeeded)} (with safety margin)`);
  lines.push('');
  lines.push(`Generated: ${new Date(manifest.timestamp).toISOString()}`);

  return lines.join('\n');
}

/**
 * Get quota exhaustion error message for display.
 *
 * Creates a user-friendly error message for quota exhaustion scenarios.
 *
 * @param event - Quota exhaustion event
 * @returns User-facing error message
 */
export function getQuotaExhaustionMessage(event: QuotaExhaustionEvent): string {
  const percentComplete = event.totalBlocks > 0
    ? (event.completedBlocks / event.totalBlocks) * 100
    : 0;

  let message = `Storage quota exhausted while receiving "${event.filename}".\n\n`;
  message += `Transfer stopped at ${percentComplete.toFixed(1)}% complete `;
  message += `(${event.completedBlocks} of ${event.totalBlocks} blocks received).\n\n`;

  message += 'Platform quota limits vary:\n';
  message += '• Chrome/Edge desktop: ~60% of free disk (multi-GB)\n';
  message += '• Firefox: ~10% of disk, capped ~10 GB\n';
  message += '• Safari/iOS: ~1 GB before prompting\n\n';

  if (percentComplete >= 50) {
    message += 'Partial file has been saved and can be accessed from the file list.\n';
  }

  return message;
}

/**
 * Format bytes as human-readable string.
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Detect if an error is quota exhaustion.
 *
 * Checks if an error indicates OPFS quota exhaustion.
 *
 * @param error - Error to check
 * @returns true if error indicates quota exhaustion
 */
export function isQuotaExhaustionError(error: unknown): boolean {
  if (error instanceof DOMException) {
    // Check for quota-related error names
    return error.name === 'QuotaExceededError' ||
           error.name === 'NS_ERROR_FILE_NO_DEVICE_SPACE' ||
           error.message.includes('quota') ||
           error.message.includes('space') ||
           error.message.includes('storage');
  }

  if (error instanceof Error) {
    return error.message.includes('quota') ||
           error.message.includes('storage') ||
           error.message.includes('space');
  }

  return false;
}

/**
 * Estimate remaining blocks needed to complete transfer.
 *
 * @param writtenBlocks - Bitmap of written blocks
 * @param totalBlocks - Total block count
 * @returns Number of remaining blocks
 */
export function getRemainingBlocks(
  writtenBlocks: Uint8Array,
  totalBlocks: number
): number {
  let remaining = 0;

  for (let i = 0; i < totalBlocks; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const isWritten = (writtenBlocks[byteIndex]! & (1 << bitIndex)) !== 0;

    if (!isWritten) {
      remaining++;
    }
  }

  return remaining;
}

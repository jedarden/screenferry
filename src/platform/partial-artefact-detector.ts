/**
 * Partial artefact detection system.
 *
 * Detects when receiver artefacts are partial or incomplete,
 * which requires user warnings about persistent plaintext data.
 *
 * Reference: docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 */

import type {RecvSessionState} from '../core/session/types.js';
import type {OutputArtefact} from './storage.js';

/**
 * Partial artefact types.
 */
export enum PartialArtefactType {
  /** Quota exhausted during download (E10) */
  QUOTA_EXHAUSTED = 'quota-exhausted',
  /** Decompression failed after completion (E15) */
  DECOMPRESS_FAILED = 'decompress-failed',
  /** Navigation away before completion */
  INCOMPLETE_DOWNLOAD = 'incomplete-download',
  /** Verification failed */
  VERIFICATION_FAILED = 'verification-failed',
}

/**
 * Partial artefact info.
 */
export interface PartialArtefactInfo {
  /** Type of partial artefact */
  type: PartialArtefactType;
  /** Stream ID */
  streamId: number;
  /** Original filename */
  filename: string;
  /** Number of complete blocks */
  completeBlocks: number;
  /** Total number of blocks */
  totalBlocks: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Missing block indices */
  missingBlocks: number[];
  /** Whether artefact can be resumed */
  canResume: boolean;
  /** Security warning message */
  securityMessage: string;
}

/**
 * Check if a receiver state represents a partial artefact.
 *
 * @param state - Current receiver session state
 * @returns Partial artefact info or null if not partial
 */
export function detectPartialArtefact(state: RecvSessionState): PartialArtefactInfo | null {
  // Check for quota exhausted state (E10)
  if (state.type === 'quota-exhausted') {
    const completeCount = getBlocksWrittenCount(state);
    const totalCount = state.meta.blockCount;
    const missing = getMissingBlocks(state.complete);

    return {
      type: PartialArtefactType.QUOTA_EXHAUSTED,
      streamId: state.streamId,
      filename: state.meta.filename,
      completeBlocks: completeCount,
      totalBlocks: totalCount,
      progressPercent: (completeCount / totalCount) * 100,
      missingBlocks: state.missingBlocks,
      canResume: false, // Cannot resume quota exhaustion
      securityMessage: formatQuotaExhaustedWarning(completeCount, totalCount, state.meta.filename),
    };
  }

  // Check for decompression failed state (E15)
  if (state.type === 'decompress-failed') {
    return {
      type: PartialArtefactType.DECOMPRESS_FAILED,
      streamId: state.streamId,
      filename: state.meta.filename,
      completeBlocks: state.meta.blockCount,
      totalBlocks: state.meta.blockCount,
      progressPercent: 100,
      missingBlocks: [],
      canResume: false,
      securityMessage: formatDecompressFailedWarning(state.meta.filename),
    };
  }

  // Check for incomplete receiving state (user might navigate away)
  if (state.type === 'receiving') {
    const completeCount = getBlocksWrittenCount(state);
    const totalCount = state.meta.blockCount;

    // Only consider partial if less than 100% complete
    if (completeCount < totalCount) {
      const missing = getMissingBlocks(state.complete);

      return {
        type: PartialArtefactType.INCOMPLETE_DOWNLOAD,
        streamId: state.streamId,
        filename: state.meta.filename,
        completeBlocks: completeCount,
        totalBlocks: totalCount,
        progressPercent: (completeCount / totalCount) * 100,
        missingBlocks: missing,
        canResume: true, // Can resume from receiving state
        securityMessage: formatIncompleteDownloadWarning(completeCount, totalCount, state.meta.filename),
      };
    }
  }

  // Check for paused state (could be partial)
  if (state.type === 'paused') {
    const prevState = state.previousState;
    const completeCount = getBlocksWrittenCount(prevState);
    const totalCount = prevState.meta.blockCount;

    // Only consider partial if less than 100% complete
    if (completeCount < totalCount) {
      const missing = getMissingBlocks(prevState.complete);

      return {
        type: PartialArtefactType.INCOMPLETE_DOWNLOAD,
        streamId: prevState.streamId,
        filename: prevState.meta.filename,
        completeBlocks: completeCount,
        totalBlocks: totalCount,
        progressPercent: (completeCount / totalCount) * 100,
        missingBlocks: missing,
        canResume: true, // Paused states can be resumed
        securityMessage: formatIncompleteDownloadWarning(completeCount, totalCount, prevState.meta.filename),
      };
    }
  }

  // Check for verifying state with failed blocks
  if (state.type === 'verifying') {
    const failedCount = state.verificationProgress.failedBlocks.length;
    if (failedCount > 0) {
      const completeCount = getBlocksWrittenCount(state);
      const totalCount = state.meta.blockCount;

      return {
        type: PartialArtefactType.VERIFICATION_FAILED,
        streamId: state.streamId,
        filename: state.meta.filename,
        completeBlocks: completeCount - failedCount,
        totalBlocks: totalCount,
        progressPercent: ((completeCount - failedCount) / totalCount) * 100,
        missingBlocks: state.verificationProgress.failedBlocks,
        canResume: false,
        securityMessage: formatVerificationFailedWarning(failedCount, state.meta.filename),
      };
    }
  }

  return null; // Not a partial artefact
}

/**
 * Check if an output artefact is partial based on metadata.
 *
 * @param artefact - Output artefact metadata
 * @returns Partial artefact info or null if complete
 */
export function detectPartialFromMetadata(artefact: OutputArtefact): PartialArtefactInfo | null {
  // Assuming artefact has status field from the spec
  // This will need to be adapted based on actual OutputArtefact structure
  if (!('status' in artefact)) {
    return null; // No status field, assume complete
  }

  const status = (artefact as any).status;
  if (status === 'complete') {
    return null;
  }

  // Handle different partial statuses
  if (status === 'partial') {
    const missingBlocks = (artefact as any).missingBlocks || [];
    const totalBlocks = (artefact as any).totalBlocks || artefact.size; // Fallback estimate

    return {
      type: PartialArtefactType.INCOMPLETE_DOWNLOAD,
      streamId: artefact.streamId,
      filename: artefact.filename,
      completeBlocks: totalBlocks - missingBlocks.length,
      totalBlocks: totalBlocks,
      progressPercent: ((totalBlocks - missingBlocks.length) / totalBlocks) * 100,
      missingBlocks: missingBlocks,
      canResume: false, // Stored artefacts cannot be resumed in current implementation
      securityMessage: formatStoredPartialWarning(artefact.filename),
    };
  }

  if (status === 'compressed') {
    return {
      type: PartialArtefactType.DECOMPRESS_FAILED,
      streamId: artefact.streamId,
      filename: artefact.filename,
      completeBlocks: artefact.size, // Use size as proxy for "complete" blocks
      totalBlocks: artefact.size,
      progressPercent: 100,
      missingBlocks: [],
      canResume: false,
      securityMessage: formatStoredCompressedWarning(artefact.filename),
    };
  }

  return null;
}

/**
 * Check if navigation should trigger a partial artefact warning.
 *
 * @param state - Current receiver session state
 * @returns True if navigation should trigger warning
 */
export function shouldWarnOnNavigation(state: RecvSessionState): boolean {
  const partial = detectPartialArtefact(state);
  if (!partial) {
    return false;
  }

  // Don't warn if nearly complete (>95%) to avoid annoyance
  if (partial.progressPercent > 95) {
    return false;
  }

  // Warn for all other partial states
  return true;
}

/**
 * Get missing block indices from a bitmap.
 */
function getMissingBlocks(bitmap: Uint8Array): number[] {
  const missing: number[] = [];
  for (let i = 0; i < bitmap.length * 8; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const byte = bitmap[byteIndex]!;
    if (!(byte & (1 << bitIndex))) {
      missing.push(i);
    }
  }
  return missing;
}

/**
 * Get count of blocks written so far.
 */
function getBlocksWrittenCount(state: any): number {
  if (!('writtenBlocks' in state)) {
    return 0;
  }

  let count = 0;
  for (const byte of state.writtenBlocks) {
    count += popcount(byte);
  }
  return count;
}

/**
 * Population count (number of set bits) for a byte.
 */
function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

// Warning message formatters

function formatQuotaExhaustedWarning(complete: number, total: number, filename: string): string {
  const percent = Math.round((complete / total) * 100);
  return `⚠️ Storage quota exhausted\n\n` +
         `The file "${filename}" is ${percent}% complete (${complete} of ${total} blocks received).\n\n` +
         `⚠️ SECURITY WARNING: This incomplete file will be stored in plaintext in your browser storage until you delete it.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The incomplete file may persist even after you close this tab.\n\n` +
         `Options:\n` +
         `• Keep: Store the incomplete file for potential manual recovery\n` +
         `• Delete: Remove the incomplete file from storage\n` +
         `• Cancel: Return to the transfer`;
}

function formatDecompressFailedWarning(filename: string): string {
  return `⚠️ Decompression failed\n\n` +
         `The file "${filename}" was received but could not be decompressed.\n\n` +
         `⚠️ SECURITY WARNING: The raw compressed data will be stored in plaintext in your browser storage until you delete it.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The data may persist even after you close this tab.\n\n` +
         `Options:\n` +
         `• Keep: Store the compressed data for potential manual recovery\n` +
         `• Delete: Remove the data from storage\n` +
         `• Cancel: Stay on this screen`;
}

function formatIncompleteDownloadWarning(complete: number, total: number, filename: string): string {
  const percent = Math.round((complete / total) * 100);
  return `⚠️ Incomplete download\n\n` +
         `The file "${filename}" is ${percent}% complete (${complete} of ${total} blocks received).\n\n` +
         `⚠️ SECURITY WARNING: If you navigate away, this incomplete file will be stored in plaintext in your browser storage until you delete it.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The incomplete file may persist even after you close this tab.\n\n` +
         `Options:\n` +
         `• Continue: Keep the incomplete file and navigate away\n` +
         `• Delete: Remove the incomplete file and navigate away\n` +
         `• Cancel: Stay on this screen and continue the transfer`;
}

function formatVerificationFailedWarning(failedCount: number, filename: string): string {
  return `⚠️ Verification failed\n\n` +
         `The file "${filename}" has ${failedCount} block(s) that failed verification.\n\n` +
         `⚠️ SECURITY WARNING: This incomplete file will be stored in plaintext in your browser storage until you delete it.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The incomplete file may persist even after you close this tab.\n\n` +
         `Options:\n` +
         `• Keep: Store the incomplete file for potential manual recovery\n` +
         `• Delete: Remove the incomplete file from storage\n` +
         `• Cancel: Stay on this screen`;
}

function formatStoredPartialWarning(filename: string): string {
  return `⚠️ Incomplete file detected\n\n` +
         `The file "${filename}" is an incomplete download from a previous session.\n\n` +
         `⚠️ SECURITY WARNING: This incomplete file is stored in plaintext in your browser storage.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The file will persist until you delete it.\n\n` +
         `Options:\n` +
         `• Keep: Continue storing the incomplete file\n` +
         `• Delete: Remove the incomplete file from storage`;
}

function formatStoredCompressedWarning(filename: string): string {
  return `⚠️ Compressed data detected\n\n` +
         `The file "${filename}" could not be decompressed and is stored as raw compressed data.\n\n` +
         `⚠️ SECURITY WARNING: This data is stored in plaintext in your browser storage.\n\n` +
         `Browser storage (OPFS) is not encrypted at rest. The data will persist until you delete it.\n\n` +
         `Options:\n` +
         `• Keep: Continue storing the compressed data\n` +
         `• Delete: Remove the data from storage\n` +
         `• Export: Attempt to export the compressed file`;
}

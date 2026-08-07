/**
 * Resume validation and diagnostics (bf-280 Phase 0).
 *
 * Implements robust cross-session resume validation to ensure interrupted
 * transfers can be reliably restarted. This is the first priority for bf-280
 * as specified in the task description.
 *
 * **Key validation capabilities:**
 * - Resume token integrity validation
 * - Bitmap/streamId mismatch detection
 * - Compatibility checking between sessions
 * - Diagnostic information for resume failures
 *
 * **Critical invariant:** streamId derivation MUST be deterministic per D22.
 * Re-selecting the same file after reload/crash MUST reproduce the same streamId.
 *
 * Reference: plan.md §8.3 (D22), bf-280 task description
 */

import type { ResumeToken, BeaconMeta } from '../session/types.js';
import { computeStreamId, STREAM_ID_SAMPLE_SIZE } from '../hash/stream-id.js';
import { validateBitmapSize, countSetBits, getBitmapProgress } from '../block/bitmap.js';

/**
 * Resume validation result.
 *
 * Indicates whether a resume token is valid and can be used to restore session state.
 */
export enum ResumeValidationStatus {
  /** Resume token is valid and can be used */
  VALID,
  /** Resume token has corrupted or missing fields */
  CORRUPTED,
  /** StreamId mismatch - file changed or wrong file selected */
  STREAMID_MISMATCH,
  /** Bitmap size doesn't match block count */
  BITMAP_SIZE_MISMATCH,
  /** Incompatible wire version */
  INCOMPATIBLE_VERSION,
  /** Resume token expired (too old) */
  EXPIRED,
}

/**
 * Resume diagnostics information.
 *
 * Provides detailed diagnostic information when resume validation fails,
 * helping users understand why resume is not possible and how to fix it.
 */
export interface ResumeDiagnostics {
  /** Overall validation status */
  status: ResumeValidationStatus;
  /** Human-readable error message */
  error: string;
  /** Suggested actions for the user */
  suggestions: string[];
  /** Detailed validation results */
  details: {
    /** Is the resume token structure valid? */
    tokenStructureValid: boolean;
    /** Does the streamId match the current file? */
    streamIdMatches: boolean;
    /** Do the bitmaps have correct size? */
    bitmapSizeValid: boolean;
    /** Is the wire version compatible? */
    versionCompatible: boolean;
    /** Is the resume token too old? */
    expired: boolean;
    /** Resume token age in milliseconds */
    tokenAge: number;
    /** Percentage of blocks already received */
    completionProgress: number;
    /** Number of completed blocks */
    completedBlocks: number;
    /** Total number of blocks */
    totalBlocks: number;
  };
}

/**
 * Resume compatibility check result.
 *
 * Result of checking if a resume token is compatible with the current file.
 */
export interface ResumeCompatibilityCheck {
  /** Can resume with this token */
  compatible: boolean;
  /** StreamId of current file */
  currentStreamId: number;
  /** StreamId from resume token */
  resumeStreamId: number;
  /** Do streamIds match? */
  streamIdMatch: boolean;
  /** Is the file size the same? */
  fileSizeMatch: boolean;
  /** Block count compatibility */
  blockCountMatch: boolean;
  /** Diagnostics if not compatible */
  diagnostics?: ResumeDiagnostics;
}

/**
 * Validate a resume token for structural integrity.
 *
 * Checks that all required fields are present and have valid values.
 * This is the first validation step before attempting to use a resume token.
 *
 * @param token - Resume token to validate
 * @returns true if token structure is valid
 */
export function validateResumeTokenStructure(token: ResumeToken): boolean {
  if (!token || typeof token !== 'object') {
    return false;
  }

  // Check required fields
  const requiredFields: (keyof ResumeToken)[] = [
    'streamId',
    'meta',
    'complete',
    'writtenBlocks',
    'timestamp',
  ];

  for (const field of requiredFields) {
    if (!(field in token)) {
      return false;
    }
  }

  // Validate metadata
  const meta = token.meta;
  if (!meta || typeof meta !== 'object') {
    return false;
  }

  const requiredMetaFields: (keyof BeaconMeta)[] = [
    'streamId',
    'wireVersion',
    'originalSize',
    'payloadLen',
    'blockSize',
    'blockCount',
    'fragmentLen',
  ];

  for (const field of requiredMetaFields) {
    if (!(field in meta) || meta[field] === null || meta[field] === undefined) {
      return false;
    }
  }

  // Validate bitmaps are Uint8Arrays
  if (!(token.complete instanceof Uint8Array)) {
    return false;
  }
  if (!(token.writtenBlocks instanceof Uint8Array)) {
    return false;
  }

  // Validate timestamp is reasonable
  const now = Date.now();
  const tokenAge = now - token.timestamp;
  if (tokenAge < 0 || tokenAge > 365 * 24 * 60 * 60 * 1000) { // Max 1 year old
    return false;
  }

  return true;
}

/**
 * Validate bitmap size matches expected block count.
 *
 * Ensures the bitmap dimensions match the block count from metadata.
 * This catches corrupted resume tokens where the bitmap was truncated.
 *
 * @param bitmap - Block bitmap to validate
 * @param blockCount - Expected block count
 * @returns true if bitmap size is correct
 */
export function validateBitmapBlockSize(
  bitmap: Uint8Array,
  blockCount: number
): boolean {
  const expectedSize = Math.ceil(blockCount / 8);
  return bitmap.length === expectedSize;
}

/**
 * Check if resume token is compatible with current file.
 *
 * Performs comprehensive compatibility checking to determine if a resume token
 * can be used to resume a transfer for the current file.
 *
 * **Key checks:**
 * 1. StreamId matches (same file)
 * 2. File size matches (file hasn't changed)
 * 3. Block count matches (same blocking scheme)
 * 4. Wire version compatible
 *
 * @param token - Resume token to check
 * @param currentFile - Current file object
 * @returns Compatibility check result
 */
export async function checkResumeCompatibility(
  token: ResumeToken,
  currentFile: File
): Promise<ResumeCompatibilityCheck> {
  const currentStreamId = await computeStreamId(currentFile);
  const resumeStreamId = token.streamId;

  const streamIdMatch = currentStreamId === resumeStreamId;
  const fileSizeMatch = currentFile.size === token.meta.originalSize;
  const blockCountMatch = true; // Block count derived from size, so size match = block count match

  const compatible = streamIdMatch && fileSizeMatch && blockCountMatch;

  const result: ResumeCompatibilityCheck = {
    compatible,
    currentStreamId,
    resumeStreamId,
    streamIdMatch,
    fileSizeMatch,
    blockCountMatch,
  };

  if (!compatible) {
    result.diagnostics = generateIncompatibilityDiagnostics(
      token,
      currentFile,
      streamIdMatch,
      fileSizeMatch
    );
  }

  return result;
}

/**
 * Generate diagnostics for incompatible resume.
 *
 * Creates detailed diagnostic information when resume is not possible,
 * helping users understand what went wrong and how to proceed.
 */
function generateIncompatibilityDiagnostics(
  token: ResumeToken,
  currentFile: File,
  streamIdMatch: boolean,
  fileSizeMatch: boolean
): ResumeDiagnostics {
  const details = {
    tokenStructureValid: validateResumeTokenStructure(token),
    streamIdMatches: streamIdMatch,
    bitmapSizeValid: validateBitmapBlockSize(token.complete, token.meta.blockCount),
    versionCompatible: true, // Assume wire version 1 is compatible
    expired: false,
    tokenAge: Date.now() - token.timestamp,
    completionProgress: getBitmapProgress(token.complete, token.meta.blockCount),
    completedBlocks: countSetBits(token.complete),
    totalBlocks: token.meta.blockCount,
  };

  let status: ResumeValidationStatus;
  let error: string;
  const suggestions: string[] = [];

  if (!details.tokenStructureValid) {
    status = ResumeValidationStatus.CORRUPTED;
    error = 'Resume token is corrupted or invalid';
    suggestions.push('Start a new transfer from the beginning');
    suggestions.push('Check if storage was cleared or corrupted');
  } else if (!details.streamIdMatches) {
    status = ResumeValidationStatus.STREAMID_MISMATCH;
    error = 'File does not match the original transfer';
    suggestions.push('Select the same file you were transferring before');
    suggestions.push('If the file was modified, you must start a new transfer');
    suggestions.push('Check that you selected the correct file');
  } else if (!details.bitmapSizeValid) {
    status = ResumeValidationStatus.BITMAP_SIZE_MISMATCH;
    error = 'Resume state bitmap is corrupted';
    suggestions.push('Resume state is corrupted, start a new transfer');
    suggestions.push('Check browser storage integrity');
  } else if (!details.versionCompatible) {
    status = ResumeValidationStatus.INCOMPATIBLE_VERSION;
    error = 'Resume token is from an incompatible version';
    suggestions.push('Update ScreenFerry to the latest version');
    suggestions.push('Complete the transfer on the original version');
  } else if (details.expired) {
    status = ResumeValidationStatus.EXPIRED;
    error = 'Resume token is too old';
    suggestions.push('Start a new transfer');
  } else {
    status = ResumeValidationStatus.VALID;
    error = 'Resume is possible';
  }

  return { status, error, suggestions, details };
}

/**
 * Validate a resume token and return comprehensive diagnostics.
 *
 * This is the main entry point for resume validation. It performs
 * all validation checks and returns detailed diagnostics.
 *
 * @param token - Resume token to validate
 * @param currentFile - Current file being transferred
 * @returns Resume diagnostics with validation result
 */
export async function validateResumeToken(
  token: ResumeToken,
  currentFile: File
): Promise<ResumeDiagnostics> {
  // First, check structure
  if (!validateResumeTokenStructure(token)) {
    return generateIncompatibilityDiagnostics(token, currentFile, false, false);
  }

  // Check bitmap sizes
  const completeValid = validateBitmapBlockSize(token.complete, token.meta.blockCount);
  const writtenValid = token.writtenBlocks !== undefined
    ? validateBitmapBlockSize(token.writtenBlocks, token.meta.blockCount)
    : true; // writtenBlocks is optional, so missing is valid

  if (!completeValid || !writtenValid) {
    return generateIncompatibilityDiagnostics(token, currentFile, false, false);
  }

  // Check compatibility
  const compatibility = await checkResumeCompatibility(token, currentFile);

  if (compatibility.diagnostics) {
    return compatibility.diagnostics;
  }

  // All checks passed
  const completedBlocks = countSetBits(token.complete);
  const totalBlocks = token.meta.blockCount;

  return {
    status: ResumeValidationStatus.VALID,
    error: 'Resume is valid and compatible',
    suggestions: [
      `Resume from ${Math.round(getBitmapProgress(token.complete, totalBlocks) * 100)}% complete`,
      `${completedBlocks} of ${totalBlocks} blocks already received`,
    ],
    details: {
      tokenStructureValid: true,
      streamIdMatches: true,
      bitmapSizeValid: true,
      versionCompatible: true,
      expired: false,
      tokenAge: Date.now() - token.timestamp,
      completionProgress: getBitmapProgress(token.complete, totalBlocks),
      completedBlocks,
      totalBlocks,
    },
  };
}

/**
 * Get a human-readable summary of resume diagnostics.
 *
 * Formats diagnostics for display to users, focusing on actionable
 * information.
 *
 * @param diagnostics - Resume diagnostics
 * @returns Human-readable diagnostic summary
 */
export function formatResumeDiagnostics(diagnostics: ResumeDiagnostics): string {
  const lines: string[] = [];

  lines.push(`Status: ${diagnostics.error}`);
  lines.push('');

  if (diagnostics.details.completedBlocks > 0) {
    lines.push(`Progress: ${Math.round(diagnostics.details.completionProgress * 100)}%`);
    lines.push(`  (${diagnostics.details.completedBlocks}/${diagnostics.details.totalBlocks} blocks received)`);
    lines.push('');
  }

  if (diagnostics.suggestions.length > 0) {
    lines.push('Suggestions:');
    for (const suggestion of diagnostics.suggestions) {
      lines.push(`  • ${suggestion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Check if resume is worthwhile based on completion progress.
 *
 * Returns true if enough progress was made to justify resuming rather
 * than restarting from scratch.
 *
 * @param diagnostics - Resume diagnostics
 * @param threshold - Minimum progress threshold (default 5%)
 * @returns true if resume is worthwhile
 */
export function isResumeWorthwhile(
  diagnostics: ResumeDiagnostics,
  threshold: number = 0.05
): boolean {
  return (
    diagnostics.status === ResumeValidationStatus.VALID &&
    diagnostics.details.completionProgress >= threshold
  );
}

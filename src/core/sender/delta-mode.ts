/**
 * Sender delta mode implementation (bf-280 Phase 3).
 *
 * Implements sender-side delta transfer mode for processing SFD- codes.
 * Enables the sender to receive delta codes from receivers and transfer only
 * the blocks that differ between file versions.
 *
 * **Key capabilities:**
 * - Delta code validation and security checking
 * - Range verification to prevent corruption
 * - Delta mode state transitions
 * - File comparison and delta computation
 *
 * Reference: docs/notes/bf-280-delta-transfer-resolution.md
 */

import type { DeltaCode } from '../frame/delta-code.js';
import type { File } from '../io/types.js';
import {
  validateCompleteDeltaSecurity,
  addFileToAllowedSet,
  checkFileAccess,
  validateUserConfirmation,
  type DeltaSecurityValidation,
} from '../delta/delta-security.js';
import { computeBlockDelta, estimateDeltaSavings, type BlockDelta } from '../block/delta.js';
import { parseDeltaCode, createDeltaCode } from '../frame/delta-code.js';
import { computeStreamId } from '../hash/stream-id.js';
import { BLOCK } from '../params.js';

/**
 * Delta mode state.
 */
export enum DeltaModeState {
  /** Not in delta mode */
  IDLE = 'IDLE',
  /** Delta code entered, awaiting validation */
  CODE_ENTERED = 'CODE_ENTERED',
  /** Security validation in progress */
  VALIDATING = 'VALIDATING',
  /** Awaiting user confirmation */
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  /** Delta mode active, transferring differing blocks */
  TRANSFERRING = 'TRANSFERRING',
  /** Delta transfer complete */
  COMPLETE = 'COMPLETE',
  /** Delta mode failed (security error, validation failure) */
  FAILED = 'FAILED',
}

/**
 * Delta mode configuration.
 */
export interface DeltaModeConfig {
  /** Require user confirmation before starting delta transfer */
  requireConfirmation: boolean;
  /** Show detailed security diagnostics */
  showSecurityDetails: boolean;
  /** Maximum file size for delta operations (10 GB) */
  maxFileSize: number;
}

/**
 * Delta mode context.
 */
export interface DeltaModeContext {
  /** Current state */
  state: DeltaModeState;
  /** Parsed delta code */
  deltaCode?: DeltaCode;
  /** Old file (receiver's version) */
  oldFile?: File;
  /** New file (sender's version) */
  newFile?: File;
  /** Block delta result */
  blockDelta?: BlockDelta;
  /** Security validation result */
  securityValidation?: DeltaSecurityValidation;
  /** User confirmation flag */
  userConfirmed?: boolean;
  /** Error message if failed */
  error?: string;
  /** Configuration */
  config: DeltaModeConfig;
}

/**
 * Create default delta mode configuration.
 */
export function createDefaultDeltaConfig(): DeltaModeConfig {
  return {
    requireConfirmation: true,
    showSecurityDetails: true,
    maxFileSize: 10 * 1024 * 1024 * 1024, // 10 GB
  };
}

/**
 * Initialize delta mode context.
 */
export function createDeltaModeContext(
  config: DeltaModeConfig = createDefaultDeltaConfig()
): DeltaModeContext {
  return {
    state: DeltaModeState.IDLE,
    config,
  };
}

/**
 * Enter delta mode with delta code.
 *
 * Called when user enters a delta code (SFD- format) on the sender.
 * Validates the code and prepares for delta transfer.
 *
 * @param context - Delta mode context
 * @param deltaCodeString - Encoded delta code string
 * @param newFile - New file (sender's version)
 * @returns Updated context with validation results
 */
export async function enterDeltaMode(
  context: DeltaModeContext,
  deltaCodeString: string,
  newFile: File
): Promise<DeltaModeContext> {
  // Reset to initial state
  context.state = DeltaModeState.CODE_ENTERED;
  context.newFile = newFile;
  delete context.error;
  delete context.securityValidation;
  delete context.userConfirmed;

  try {
    // Parse delta code
    const parsed = parseDeltaCode(deltaCodeString);
    context.deltaCode = parsed;
    context.state = DeltaModeState.VALIDATING;

    // Add new file to allowed set
    const newStreamId = await computeStreamId(newFile);
    addFileToAllowedSet(newStreamId, newFile);

    // Check file size limits
    if (newFile.size > context.config.maxFileSize) {
      context.state = DeltaModeState.FAILED;
      context.error = `File too large for delta operation (${(newFile.size / 1024 / 1024 / 1024).toFixed(1)} GB > ${(context.config.maxFileSize / 1024 / 1024 / 1024).toFixed(1)} GB limit)`;
      return context;
    }

    // Security validation requires both files, so we need old file access
    const oldFileAccess = checkFileAccess(parsed.oldStreamId);
    if (!oldFileAccess.allowed) {
      context.state = DeltaModeState.FAILED;
      context.error = `Old file not accessible: ${oldFileAccess.reason}`;
      return context;
    }

    // At this point, we need the actual old file for complete validation
    // This will be provided by confirmDeltaMode()
    context.state = DeltaModeState.AWAITING_CONFIRMATION;
    return context;

  } catch (e) {
    const error = e as Error;
    context.state = DeltaModeState.FAILED;
    context.error = `Delta code parsing failed: ${error.message}`;
    return context;
  }
}

/**
 * Confirm and start delta transfer.
 *
 * Called when user confirms the delta operation. Performs complete
 * security validation and initiates delta transfer if all checks pass.
 *
 * @param context - Delta mode context
 * @param oldFile - Old file (receiver's version)
 * @param confirmed - User confirmation flag
 * @returns Updated context ready for delta transfer
 */
export async function confirmDeltaMode(
  context: DeltaModeContext,
  oldFile: File,
  confirmed: boolean
): Promise<DeltaModeContext> {
  if (context.state !== DeltaModeState.AWAITING_CONFIRMATION) {
    context.state = DeltaModeState.FAILED;
    context.error = 'Cannot confirm delta mode: not in awaiting confirmation state';
    return context;
  }

  context.oldFile = oldFile;
  context.userConfirmed = confirmed;

  // Validate user confirmation
  if (!validateUserConfirmation(confirmed)) {
    context.state = DeltaModeState.FAILED;
    context.error = 'Delta operation requires user confirmation';
    return context;
  }

  if (!context.deltaCode || !context.newFile) {
    context.state = DeltaModeState.FAILED;
    context.error = 'Missing delta code or new file';
    return context;
  }

  try {
    // Perform complete security validation
    const securityValidation = await validateCompleteDeltaSecurity(
      context.deltaCode,
      oldFile,
      context.newFile
    );

    context.securityValidation = securityValidation;

    if (!securityValidation.secure) {
      context.state = DeltaModeState.FAILED;
      context.error = 'Security validation failed: ' + securityValidation.violations.join(', ');
      return context;
    }

    // Compute block delta
    const blockDelta = await computeBlockDelta(context.newFile, oldFile, BLOCK);
    context.blockDelta = blockDelta;

    // Verify ranges match (defensive check)
    const actualRanges = blocksToRanges(blockDelta.differingBlocks);
    const claimedRanges = context.deltaCode.ranges;

    // Sort ranges for comparison
    actualRanges.sort((a, b) => a[0] - b[0]);
    claimedRanges.sort((a, b) => a[0] - b[0]);

    if (!rangesMatch(actualRanges, claimedRanges)) {
      context.state = DeltaModeState.FAILED;
      context.error = 'Computed ranges do not match claimed ranges in delta code';
      return context;
    }

    // All checks passed, ready to transfer
    context.state = DeltaModeState.TRANSFERRING;
    return context;

  } catch (e) {
    const error = e as Error;
    context.state = DeltaModeState.FAILED;
    context.error = `Delta mode confirmation failed: ${error.message}`;
    return context;
  }
}

/**
 * Compute delta from two files.
 *
 * Sender-side utility for computing delta between file versions.
 * Used internally and can be used for testing/diagnostics.
 *
 * @param newFile - New file (sender's version)
 * @param oldFile - Old file (receiver's version)
 * @returns Block delta result
 */
export async function computeDeltaFromFiles(
  newFile: File,
  oldFile: File
): Promise<BlockDelta> {
  return computeBlockDelta(newFile, oldFile, BLOCK);
}

/**
 * Estimate delta transfer savings.
 *
 * Computes the percentage savings from using delta transfer vs full transfer.
 *
 * @param blockDelta - Block delta result
 * @returns Savings ratio (0.0 to 1.0, where 1.0 = 100% savings)
 */
export function estimateSavings(blockDelta: BlockDelta): number {
  return estimateDeltaSavings(blockDelta, BLOCK);
}

/**
 * Generate delta code from file comparison.
 *
 * Creates a delta code that the receiver can use to request delta transfer.
 * This is the reverse of parsing - useful for testing and diagnostics.
 *
 * @param oldFile - Old file (receiver's version)
 * @param newFile - New file (sender's version)
 * @returns Encoded delta code string
 */
export async function generateDeltaCode(
  oldFile: File,
  newFile: File
): Promise<string> {
  const oldStreamId = await computeStreamId(oldFile);
  const newStreamId = await computeStreamId(newFile);

  const blockDelta = await computeBlockDelta(newFile, oldFile, BLOCK);

  return createDeltaCode(oldStreamId, newStreamId, blockDelta.differingBlocks);
}

/**
 * Get delta mode status for UI display.
 *
 * Returns human-readable status information for displaying delta mode state.
 *
 * @param context - Delta mode context
 * @returns Status object for UI
 */
export function getDeltaModeStatus(context: DeltaModeContext): {
  state: DeltaModeState;
  message: string;
  canProceed: boolean;
  securityValid: boolean;
  estimatedSavings: number;
  differingBlocks: number;
  totalBlocks: number;
} {
  const message = getStateMessage(context);
  const canProceed = context.state === DeltaModeState.TRANSFERRING;
  const securityValid = context.securityValidation?.secure ?? false;
  const estimatedSavings = context.blockDelta ? estimateSavings(context.blockDelta) : 0;
  const differingBlocks = context.blockDelta?.differingBlocks.length ?? 0;
  const totalBlocks = context.blockDelta?.newBlockCount ?? 0;

  return {
    state: context.state,
    message,
    canProceed,
    securityValid,
    estimatedSavings,
    differingBlocks,
    totalBlocks,
  };
}

/**
 * Reset delta mode context.
 *
 * Resets context back to idle state, clearing all transient data.
 */
export function resetDeltaMode(context: DeltaModeContext): void {
  context.state = DeltaModeState.IDLE;
  delete context.deltaCode;
  delete context.oldFile;
  delete context.newFile;
  delete context.blockDelta;
  delete context.securityValidation;
  delete context.userConfirmed;
  delete context.error;
}

/**
 * Get state-specific message for UI.
 */
function getStateMessage(context: DeltaModeContext): string {
  switch (context.state) {
    case DeltaModeState.IDLE:
      return 'Ready to enter delta mode';

    case DeltaModeState.CODE_ENTERED:
      return 'Delta code entered, validating...';

    case DeltaModeState.VALIDATING:
      return 'Validating delta code and checking security...';

    case DeltaModeState.AWAITING_CONFIRMATION:
      return 'Delta code validated. Confirm to start delta transfer.';

    case DeltaModeState.TRANSFERRING:
      const savings = context.blockDelta ? estimateSavings(context.blockDelta) : 0;
      const blocks = context.blockDelta?.differingBlocks.length ?? 0;
      const total = context.blockDelta?.newBlockCount ?? 0;
      return `Transferring ${blocks} differing blocks (saves ${(savings * 100).toFixed(1)}% of ${total} total blocks)`;

    case DeltaModeState.COMPLETE:
      return 'Delta transfer complete';

    case DeltaModeState.FAILED:
      return `Delta mode failed: ${context.error || 'Unknown error'}`;

    default:
      return 'Unknown state';
  }
}

/**
 * Compare ranges for equality.
 */
function rangesMatch(
  ranges1: [number, number][],
  ranges2: [number, number][]
): boolean {
  if (ranges1.length !== ranges2.length) {
    return false;
  }

  for (let i = 0; i < ranges1.length; i++) {
    const [start1, end1] = ranges1[i]!;
    const [start2, end2] = ranges2[i]!;
    if (start1 !== start2 || end1 !== end2) {
      return false;
    }
  }

  return true;
}

/**
 * Convert blocks to ranges (utility).
 */
function blocksToRanges(blocks: number[]): [number, number][] {
  if (blocks.length === 0) return [];

  const sorted = [...blocks].sort((a, b) => a - b);
  const ranges: [number, number][] = [];

  let start = sorted[0]!;
  let end = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! === end + 1) {
      end = sorted[i]!;
    } else {
      ranges.push([start, end]);
      start = sorted[i]!;
      end = sorted[i]!;
    }
  }

  ranges.push([start, end]);
  return ranges;
}

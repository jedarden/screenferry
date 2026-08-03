/**
 * Receiver delta UI components (bf-280 Phase 4).
 *
 * Implements UI components for receiver-side delta operations:
 * - Old file selection interface
 * - Delta code generation and display
 * - Delta transfer progress indication
 * - Air-gap scenario support
 *
 * Reference: docs/notes/bf-280-delta-transfer-resolution.md
 */

import type { DeltaGenerationResult, DeltaValidationResult } from '../core/receiver/delta-generator.js';
import {
  generateDeltaCode,
  validateDeltaTransfer,
  computeReceiverDelta,
  formatDeltaResult,
  estimateDeltaTime,
  formatEstimatedTime,
  getDeltaCodeInfo,
} from '../core/receiver/delta-generator.js';
import { isDeltaCodeTypable } from '../core/frame/delta-code.js';

/**
 * File selection component state.
 */
export interface FileSelectionState {
  /** New file selected (what you want) */
  newFile?: File;
  /** Old file selected (what you have) */
  oldFile?: File;
  /** Selection error if any */
  error?: string;
  /** Can generate delta code? */
  canGenerate: boolean;
}

/**
 * Delta code display state.
 */
export interface DeltaCodeDisplayState {
  /** Generated delta code */
  deltaCode?: string;
  /** Generation result */
  result?: DeltaGenerationResult;
  /** Should show as QR code? */
  showAsQR: boolean;
  /** Display format */
  displayFormat: 'text' | 'qr' | 'both';
}

/**
 * Delta progress state for receiver.
 */
export interface ReceiverDeltaProgressState {
  /** Current status */
  status: 'idle' | 'generating' | 'transferring' | 'complete' | 'error';
  /** Progress percentage */
  progress: number;
  /** Status message */
  message: string;
  /** Error if any */
  error?: string;
}

/**
 * Create file selection component.
 *
 * Returns state for file selection UI.
 */
export function createFileSelection(): FileSelectionState {
  return {
    canGenerate: false,
  };
}

/**
 * Update file selection.
 *
 * Updates the file selection state when user selects files.
 *
 * @param state - Current file selection state
 * @param newFile - New file (what you want)
 * @param oldFile - Old file (what you have)
 * @returns Updated file selection state
 */
export function updateFileSelection(
  state: FileSelectionState,
  newFile?: File,
  oldFile?: File
): FileSelectionState {
  const updated = { ...state, newFile, oldFile, error: undefined };

  // Validate file selection
  if (!newFile) {
    updated.error = 'Please select the target file (what you want to receive)';
    updated.canGenerate = false;
    return updated;
  }

  if (!oldFile) {
    updated.error = 'Please select the current file (what you already have)';
    updated.canGenerate = false;
    return updated;
  }

  // Check files are different
  if (newFile.size === oldFile.size && newFile.name === oldFile.name) {
    updated.error = 'Files appear to be identical - delta transfer not needed';
    updated.canGenerate = false;
    return updated;
  }

  updated.canGenerate = true;
  updated.error = undefined;
  return updated;
}

/**
 * Create delta code display component.
 *
 * Prepares delta code for display in various formats.
 *
 * @param result - Delta generation result
 * @returns Delta code display state
 */
export function createDeltaCodeDisplay(result: DeltaGenerationResult): DeltaCodeDisplayState {
  const showAsQR = !isDeltaCodeTypable(result.deltaCode);

  // Determine display format based on code length and user preference
  let displayFormat: 'text' | 'qr' | 'both' = 'text';
  if (showAsQR) {
    displayFormat = 'qr'; // Too long to type, must use QR
  } else if (result.deltaCode.length > 20) {
    displayFormat = 'both'; // Medium length, show both options
  }

  return {
    deltaCode: result.deltaCode,
    result,
    showAsQR,
    displayFormat,
  };
}

/**
 * Format delta code for display.
 *
 * Formats a delta code for human-readable display.
 *
 * @param deltaCode - Delta code string
 * @returns Formatted display string
 */
export function formatDeltaCodeForDisplay(deltaCode: string): string {
  const info = getDeltaCodeInfo(deltaCode);
  const parts = deltaCode.split('-');

  if (parts.length !== 5) return deltaCode;

  // Add visual grouping for readability
  const [prefix, oldStreamId, newStreamId, ranges, check] = parts;

  return `${prefix}-${oldStreamId}-${newStreamId}-${ranges}-${check}`;
}

/**
 * Format delta code as QR data.
 *
 * Prepares delta code for QR code encoding.
 *
 * @param deltaCode - Delta code string
 * @returns QR code data URL (placeholder - actual QR generation depends on QR library)
 */
export function formatDeltaCodeAsQR(deltaCode: string): string {
  // This would return a data URL for the QR code image
  // For now, return the code itself - actual QR generation
  // would use the QR encoding library
  return deltaCode;
}

/**
 * Create receiver delta progress component.
 *
 * Creates state for displaying delta transfer progress.
 *
 * @param status - Current status
 * @param progress - Progress percentage (0-1)
 * @param message - Status message
 * @returns Progress display state
 */
export function createReceiverDeltaProgress(
  status: 'idle' | 'generating' | 'transferring' | 'complete' | 'error',
  progress: number,
  message: string
): ReceiverDeltaProgressState {
  return {
    status,
    progress,
    message,
  };
}

/**
 * Format delta progress message.
 *
 * Creates a human-readable progress message.
 *
 * @param progress - Progress display state
 * @returns Formatted progress message
 */
export function formatDeltaProgress(progress: ReceiverDeltaProgressState): string {
  switch (progress.status) {
    case 'idle':
      return 'Ready to generate delta code';

    case 'generating':
      return 'Generating delta code...';

    case 'transferring':
      const percentage = (progress.progress * 100).toFixed(1);
      return `Transferring delta blocks: ${percentage}%`;

    case 'complete':
      return '✅ Delta transfer complete';

    case 'error':
      return `❌ Error: ${progress.error || 'Unknown error'}`;

    default:
      return 'Unknown status';
  }
}

/**
 * Delta generation UI handlers.
 */
export interface DeltaGenerationHandlers {
  /** New file selection handler */
  onNewFileSelect: (file: File) => void;
  /** Old file selection handler */
  onOldFileSelect: (file: File) => void;
  /** Generate delta code handler */
  onGenerate: () => void;
  /** Copy delta code handler */
  onCopy: () => void;
  /** Cancel handler */
  onCancel: () => void;
}

/**
 * Create delta generation handlers.
 *
 * Creates event handlers for delta generation UI.
 *
 * @param fileSelection - File selection state
 * @param onGenerate - Callback when delta generation starts
 * @returns UI event handlers
 */
export function createDeltaGenerationHandlers(
  fileSelection: FileSelectionState,
  onGenerate: (newFile: File, oldFile: File) => void
): DeltaGenerationHandlers {
  return {
    onNewFileSelect: (file: File) => {
      // Update file selection state
      updateFileSelection(fileSelection, file, fileSelection.oldFile);
    },

    onOldFileSelect: (file: File) => {
      // Update file selection state
      updateFileSelection(fileSelection, fileSelection.newFile, file);
    },

    onGenerate: () => {
      if (fileSelection.canGenerate && fileSelection.newFile && fileSelection.oldFile) {
        onGenerate(fileSelection.newFile, fileSelection.oldFile);
      }
    },

    onCopy: () => {
      // Copy delta code to clipboard
      // Implementation depends on clipboard API
    },

    onCancel: () => {
      // Reset delta generation state
    },
  };
}

/**
 * Get delta recommendation for user.
 *
 * Returns a user-friendly recommendation about whether to use delta transfer.
 *
 * @param result - Delta generation result
 * @returns Recommendation message
 */
export function getDeltaRecommendation(result: DeltaGenerationResult): string {
  if (!result.worthwhile) {
    const fullSize = result.blockDelta.newBlockCount * BLOCK;
    const deltaSize = result.transferSize;
    const savings = fullSize - deltaSize;

    return `⚠️  Delta transfer may not be worthwhile\n\n` +
           `Full transfer: ${(fullSize / 1024 / 1024).toFixed(1)} MB\n` +
           `Delta transfer: ${(deltaSize / 1024 / 1024).toFixed(1)} MB\n` +
           `Savings: ${(savings / 1024 / 1024).toFixed(1)} MB (${(result.savings * 100).toFixed(1)}%)\n\n` +
           `For savings under 2%, a full transfer may be faster and simpler.`;
  }

  const etaSeconds = estimateDeltaTime(result);
  const fullEtaSeconds = (result.blockDelta.newBlockCount * BLOCK) / (30 * 1024);

  return `✅ Delta transfer is recommended\n\n` +
         `Full transfer time: ${formatEstimatedTime(fullEtaSeconds)}\n` +
         `Delta transfer time: ${formatEstimatedTime(etaSeconds)}\n` +
         `Time saved: ${formatEstimatedTime(fullEtaSeconds - etaSeconds)}\n\n` +
         `${result.blockDelta.differingBlocks.length} blocks need to be transferred\n` +
         `out of ${result.blockDelta.newBlockCount} total blocks.`;
}

/**
 * Get receiver delta UI CSS classes.
 *
 * Returns CSS classes for delta UI state-dependent styling.
 *
 * @param status - Delta status
 * @returns CSS classes object
 */
export function getReceiverDeltaClasses(status: 'idle' | 'generating' | 'transferring' | 'complete' | 'error'): {
  container: string;
  status: string;
  progress: string;
} {
  const base = 'receiver-delta';
  const statusClass = `delta-status-${status}`;

  return {
    container: base,
    status: statusClass,
    progress: status === 'transferring' ? 'active' : '',
  };
}

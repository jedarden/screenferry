/**
 * Sender delta UI components (bf-280 Phase 3).
 *
 * Implements UI components for sender-side delta operations:
 * - Delta code entry and validation
 * - Security validation feedback
 * - File selection for delta comparison
 * - Delta transfer progress indication
 *
 * Reference: docs/notes/bf-280-delta-transfer-resolution.md
 */

import type { DeltaModeContext } from '../core/sender/delta-mode.js';
import {
  createDeltaModeContext,
  enterDeltaMode,
  confirmDeltaMode,
  resetDeltaMode,
  getDeltaModeStatus,
  type DeltaModeState,
} from '../core/sender/delta-mode.js';
import { isDeltaCodeTypable } from '../core/frame/delta-code.js';

/**
 * Delta code entry component state.
 */
export interface DeltaCodeEntryState {
  /** Current code input */
  codeInput: string;
  /** Validation error if any */
  validationError?: string;
  /** Is code valid format? */
  isValid: boolean;
  /** Should show as QR code? */
  showAsQR: boolean;
}

/**
 * Delta confirmation dialog state.
 */
export interface DeltaConfirmationState {
  /** Old file name */
  oldFileName: string;
  /** New file name */
  newFileName: string;
  /** Number of differing blocks */
  differingBlocks: number;
  /** Total blocks */
  totalBlocks: number;
  /** Estimated savings */
  savings: number;
  /** Security validation result */
  securityValid: boolean;
  /** Security details */
  securityDetails?: string;
  /** User confirmed flag */
  confirmed: boolean;
}

/**
 * Delta progress display state.
 */
export interface DeltaProgressState {
  /** Blocks transferred */
  blocksTransferred: number;
  /** Total differing blocks */
  totalBlocks: number;
  /** Transfer progress percentage */
  progress: number;
  /** Estimated time remaining */
  eta?: string;
}

/**
 * Create delta code entry component.
 *
 * Returns state and handlers for a delta code entry input.
 */
export function createDeltaCodeEntry(): DeltaCodeEntryState {
  return {
    codeInput: '',
    isValid: false,
    showAsQR: false,
  };
}

/**
 * Validate delta code format.
 *
 * Checks if the entered code has valid SFD- format.
 *
 * @param state - Entry component state
 * @param code - Code string to validate
 * @returns Updated state
 */
export function validateDeltaCodeEntry(
  state: DeltaCodeEntryState,
  code: string
): DeltaCodeEntryState {
  const updated = { ...state, codeInput: code };

  // Basic format check: starts with SFD-
  if (!code.startsWith('SFD-')) {
    updated.isValid = false;
    updated.validationError = 'Delta code must start with "SFD-"';
    return updated;
  }

  // Check for reasonable length (3-100 characters)
  if (code.length < 3 || code.length > 100) {
    updated.isValid = false;
    updated.validationError = 'Delta code has invalid length';
    return updated;
  }

  // Check for valid characters (basic check)
  const validChars = /^[0-9A-HJKMNP-TV-Z-]+$/;
  if (!validChars.test(code)) {
    updated.isValid = false;
    updated.validationError = 'Delta code contains invalid characters';
    return updated;
  }

  // Check if it should be displayed as QR code
  updated.showAsQR = !isDeltaCodeTypable(code);
  updated.isValid = true;
  updated.validationError = undefined;

  return updated;
}

/**
 * Format delta code for display.
 *
 * Formats a delta code for human-readable display, adding spacing
 * and visual grouping for better readability.
 *
 * @param code - Delta code string
 * @returns Formatted display string
 */
export function formatDeltaCodeForDisplay(code: string): string {
  const parts = code.split('-');
  if (parts.length !== 5) return code; // Unknown format, return as-is

  const [prefix, oldStreamId, newStreamId, ranges, check] = parts;

  // Format: SFD-XXXX-XXXX-XXXX-X with visual grouping
  return `${prefix}-${oldStreamId}-${newStreamId}-${ranges}-${check}`;
}

/**
 * Create delta confirmation dialog.
 *
 * Prepares state for the confirmation dialog shown before delta transfer.
 *
 * @param context - Delta mode context
 * @returns Confirmation dialog state
 */
export function createDeltaConfirmation(context: DeltaModeContext): DeltaConfirmationState {
  const status = getDeltaModeStatus(context);

  return {
    oldFileName: context.oldFile?.name || 'Unknown',
    newFileName: context.newFile?.name || 'Unknown',
    differingBlocks: status.differingBlocks,
    totalBlocks: status.totalBlocks,
    savings: status.estimatedSavings,
    securityValid: status.securityValid,
    securityDetails: context.securityValidation?.report,
    confirmed: false,
  };
}

/**
 * Format delta confirmation message.
 *
 * Creates a human-readable confirmation message for the user.
 *
 * @param confirmation - Confirmation dialog state
 * @returns Formatted confirmation message
 */
export function formatDeltaConfirmation(confirmation: DeltaConfirmationState): string {
  const lines: string[] = [];

  lines.push('Delta Transfer Confirmation');
  lines.push('');

  // File comparison
  lines.push('Files:');
  lines.push(`  From: ${confirmation.oldFileName}`);
  lines.push(`  To:   ${confirmation.newFileName}`);
  lines.push('');

  // Transfer details
  lines.push('Transfer details:');
  lines.push(`  Differing blocks: ${confirmation.differingBlocks} of ${confirmation.totalBlocks}`);
  lines.push(`  Savings: ${(confirmation.savings * 100).toFixed(1)}%`);
  lines.push(`  Transfer size: ${((confirmation.differingBlocks * 192) / 1024).toFixed(1)} MB`);
  lines.push('');

  // Security status
  lines.push('Security:');
  if (confirmation.securityValid) {
    lines.push('  ✅ Security validation passed');
  } else {
    lines.push('  ❌ Security validation failed');
    if (confirmation.securityDetails) {
      lines.push('');
      lines.push('Security details:');
      for (const line of confirmation.securityDetails.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Create delta progress display.
 *
 * Creates state for displaying delta transfer progress.
 *
 * @param blocksTransferred - Number of blocks transferred
 * @param totalBlocks - Total blocks to transfer
 * @returns Progress display state
 */
export function createDeltaProgress(
  blocksTransferred: number,
  totalBlocks: number
): DeltaProgressState {
  const progress = totalBlocks > 0 ? blocksTransferred / totalBlocks : 0;

  return {
    blocksTransferred,
    totalBlocks,
    progress,
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
export function formatDeltaProgress(progress: DeltaProgressState): string {
  const percentage = (progress.progress * 100).toFixed(1);
  const transferred = (progress.blocksTransferred * 192) / 1024; // MB
  const total = (progress.totalBlocks * 192) / 1024; // MB

  let message = `Delta transfer: ${progress.blocksTransferred}/${progress.totalBlocks} blocks (${percentage}%)`;
  message += `\nTransferred: ${transferred.toFixed(1)} MB of ${total.toFixed(1)} MB`;

  if (progress.eta) {
    message += `\nETA: ${progress.eta}`;
  }

  return message;
}

/**
 * Delta UI event handlers.
 */
export interface DeltaUIHandlers {
  /** Delta code input handler */
  onCodeInput: (code: string) => void;
  /** Delta code submit handler */
  onCodeSubmit: () => void;
  /** Confirmation handler */
  onConfirm: (confirmed: boolean) => void;
  /** Cancel handler */
  onCancel: () => void;
}

/**
 * Create delta UI handlers.
 *
 * Creates event handlers for delta UI components.
 *
 * @param context - Delta mode context
 * @param oldFile - Old file for confirmation
 * @returns UI event handlers
 */
export function createDeltaUIHandlers(
  context: DeltaModeContext,
  oldFile: File
): DeltaUIHandlers {
  return {
    onCodeInput: (code: string) => {
      // Update entry state (handled by component)
      validateDeltaCodeEntry(createDeltaCodeEntry(), code);
    },

    onCodeSubmit: async () => {
      // This would be called when user submits the delta code
      // Implementation depends on how the UI integrates with the sender
    },

    onConfirm: async (confirmed: boolean) => {
      await confirmDeltaMode(context, oldFile, confirmed);
    },

    onCancel: () => {
      resetDeltaMode(context);
    },
  };
}

/**
 * Get delta mode CSS classes for styling.
 *
 * Returns CSS classes for delta mode state-dependent styling.
 *
 * @param state - Delta mode state
 * @returns CSS classes object
 */
export function getDeltaModeClasses(state: DeltaModeState): {
  container: string;
  status: string;
  validation: string;
} {
  const base = 'delta-mode';
  const statusClass = `delta-status-${state.toLowerCase()}`;

  return {
    container: base,
    status: statusClass,
    validation: state === DeltaModeState.VALIDATING ? 'validating' :
                state === DeltaModeState.FAILED ? 'failed' :
                state === DeltaModeState.TRANSFERRING ? 'transferring' : '',
  };
}

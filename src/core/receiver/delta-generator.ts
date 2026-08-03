/**
 * Receiver delta generator (bf-280 Phase 4).
 *
 * Implements receiver-side delta code generation for air-gap scenarios.
 * Enables the receiver to compute differences between file versions and
 * generate delta codes for requesting efficient transfers.
 *
 * **Key capabilities:**
 * - Delta code generation from file comparison
 * - File selection for version comparison
 * - Delta validation and safety checks
 * - Transfer size estimation
 *
 * Reference: docs/notes/bf-280-delta-transfer-resolution.md
 */

import type { File } from '../io/types.js';
import { computeBlockDelta, estimateDeltaSavings, isDeltaWorthwhile, type BlockDelta } from '../block/delta.js';
import { createDeltaCode, parseDeltaCodeWithBlocks } from '../frame/delta-code.js';
import { computeStreamId } from '../hash/stream-id.js';
import { BLOCK } from '../params.js';

/**
 * Delta generation result.
 */
export interface DeltaGenerationResult {
  /** Generated delta code */
  deltaCode: string;
  /** Block delta details */
  blockDelta: BlockDelta;
  /** StreamId of old file (receiver's version) */
  oldStreamId: number;
  /** StreamId of new file (sender's version) */
  newStreamId: number;
  /** Estimated transfer savings */
  savings: number;
  /** Is delta worthwhile? */
  worthwhile: boolean;
  /** Transfer size in bytes */
  transferSize: number;
  /** Human-readable summary */
  summary: string;
}

/**
 * Delta validation result.
 */
export interface DeltaValidationResult {
  /** Is delta safe to apply? */
  safe: boolean;
  /** Validation errors if any */
  errors: string[];
  /** Warnings if any */
  warnings: string[];
}

/**
 * Generate delta code from two files.
 *
 * Compares two file versions and generates a delta code that can be
 * sent to the sender (via air-gap) to request only the differing blocks.
 *
 * @param newFile - New file (what you want to receive)
 * @param oldFile - Old file (what you already have)
 * @returns Delta generation result
 */
export async function generateDeltaCode(
  newFile: File,
  oldFile: File
): Promise<DeltaGenerationResult> {
  // Compute streamIds
  const oldStreamId = await computeStreamId(oldFile);
  const newStreamId = await computeStreamId(newFile);

  // Compute block delta
  const blockDelta = await computeBlockDelta(newFile, oldFile, BLOCK);

  // Estimate savings
  const savings = estimateDeltaSavings(blockDelta, BLOCK);

  // Check if delta is worthwhile
  const worthwhile = isDeltaWorthwhile(blockDelta);

  // Calculate transfer size
  const transferSize = blockDelta.differingBlocks.length * BLOCK;

  // Generate delta code
  const deltaCode = createDeltaCode(oldStreamId, newStreamId, blockDelta.differingBlocks);

  // Generate summary
  const summary = generateDeltaSummary(blockDelta, savings, transferSize);

  return {
    deltaCode,
    blockDelta,
    oldStreamId,
    newStreamId,
    savings,
    worthwhile,
    transferSize,
    summary,
  };
}

/**
 * Validate delta transfer is safe to apply.
 *
 * Performs safety checks to ensure applying a delta won't corrupt
 * the receiver's file.
 *
 * @param newFile - New file (target)
 * @param oldFile - Old file (current)
 * @param deltaCode - Delta code to validate
 * @returns Validation result
 */
export async function validateDeltaTransfer(
  newFile: File,
  oldFile: File,
  deltaCode: string
): Promise<DeltaValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Parse delta code
    const { deltaCode: parsed, differingBlocks } = parseDeltaCodeWithBlocks(deltaCode);

    // Verify streamIds match
    const actualOldStreamId = await computeStreamId(oldFile);
    const actualNewStreamId = await computeStreamId(newFile);

    if (parsed.oldStreamId !== actualOldStreamId) {
      errors.push(`oldStreamId mismatch: code has ${parsed.oldStreamId}, file has ${actualOldStreamId}`);
    }

    if (parsed.newStreamId !== actualNewStreamId) {
      errors.push(`newStreamId mismatch: code has ${parsed.newStreamId}, file has ${actualNewStreamId}`);
    }

    // Verify ranges are within bounds
    const blockCount = Math.ceil(newFile.size / BLOCK);
    for (const [start, end] of parsed.ranges) {
      if (start < 0 || start >= blockCount) {
        errors.push(`Range start ${start} out of bounds (0-${blockCount - 1})`);
      }
      if (end < 0 || end >= blockCount) {
        errors.push(`Range end ${end} out of bounds (0-${blockCount - 1})`);
      }
      if (start > end) {
        errors.push(`Invalid range: start ${start} > end ${end}`);
      }
    }

    // Verify delta is actually worthwhile
    const blockDelta = await computeBlockDelta(newFile, oldFile, BLOCK);
    if (!isDeltaWorthwhile(blockDelta)) {
      warnings.push('Delta transfer may not be worthwhile (savings < 2%)');
    }

  } catch (e) {
    errors.push(`Delta code parsing failed: ${(e as Error).message}`);
  }

  return {
    safe: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Compute receiver-side delta for diagnostics.
 *
 * Computes delta without generating a code, useful for diagnostics
 * and showing potential savings before code generation.
 *
 * @param newFile - New file (what you want)
 * @param oldFile - Old file (what you have)
 * @returns Block delta result
 */
export async function computeReceiverDelta(
  newFile: File,
  oldFile: File
): Promise<BlockDelta> {
  return computeBlockDelta(newFile, oldFile, BLOCK);
}

/**
 * Format delta summary for user display.
 *
 * Creates a human-readable summary of the delta operation.
 *
 * @param result - Delta generation result
 * @returns Formatted summary string
 */
export function formatDeltaResult(result: DeltaGenerationResult): string {
  const lines: string[] = [];

  lines.push('Delta Transfer Summary');
  lines.push('');

  // File information
  lines.push('Files:');
  lines.push(`  Current (old): ${result.oldStreamId.toString(16).toUpperCase()}`);
  lines.push(`  Target (new): ${result.newStreamId.toString(16).toUpperCase()}`);
  lines.push('');

  // Delta information
  lines.push('Delta details:');
  lines.push(`  Differing blocks: ${result.blockDelta.differingBlocks.length} of ${result.blockDelta.newBlockCount}`);
  lines.push(`  Difference ratio: ${(result.blockDelta.differenceRatio * 100).toFixed(2)}%`);
  lines.push(`  Savings: ${(result.savings * 100).toFixed(1)}%`);
  lines.push(`  Transfer size: ${(result.transferSize / 1024 / 1024).toFixed(1)} MB`);
  lines.push('');

  // Recommendation
  if (result.worthwhile) {
    lines.push('✅ Delta transfer is RECOMMENDED');
    lines.push(`   You'll save ${(result.savings * 100).toFixed(1)}% of transfer time`);
  } else {
    lines.push('⚠️  Delta transfer may NOT be worthwhile');
    lines.push(`   Only ${(result.savings * 100).toFixed(1)}% savings - full transfer may be faster`);
  }

  return lines.join('\n');
}

/**
 * Generate internal summary string.
 */
function generateDeltaSummary(
  blockDelta: BlockDelta,
  savings: number,
  transferSize: number
): string {
  const worthwhile = isDeltaWorthwhile(blockDelta);

  let summary = `${blockDelta.differingBlocks.length} blocks differ (${(blockDelta.differenceRatio * 100).toFixed(2)}% of ${blockDelta.newBlockCount} total)`;
  summary += `\nSavings: ${(savings * 100).toFixed(1)}% (${(transferSize / 1024 / 1024).toFixed(1)} MB)`;

  if (worthwhile) {
    summary += '\n✅ Delta transfer is recommended';
  } else {
    summary += '\n⚠️  Delta may not be worthwhile';
  }

  return summary;
}

/**
 * Estimate delta transfer time.
 *
 * Estimates how long the delta transfer will take based on
 * typical throughput rates.
 *
 * @param result - Delta generation result
 * @param throughput - Expected throughput in KB/s (default 30 KB/s)
 * @returns Estimated time in seconds
 */
export function estimateDeltaTime(
  result: DeltaGenerationResult,
  throughput: number = 30
): number {
  const transferSizeKB = result.transferSize / 1024;
  return transferSizeKB / throughput;
}

/**
 * Format estimated time for display.
 *
 * Converts seconds to human-readable time format.
 *
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatEstimatedTime(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Get delta code format information.
 *
 * Returns metadata about the delta code for display purposes.
 *
 * @param deltaCode - Delta code string
 * @returns Code format information
 */
export function getDeltaCodeInfo(deltaCode: string): {
  length: number;
  isTypable: boolean;
  partCount: number;
  prefix: string;
} {
  const parts = deltaCode.split('-');

  return {
    length: deltaCode.length,
    isTypable: deltaCode.length <= 48,
    partCount: parts.length,
    prefix: parts[0] || '',
  };
}

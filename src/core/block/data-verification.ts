/**
 * Data verification helper utilities for synthetic test data.
 *
 * Provides validation functions for sequence integrity, block ID uniqueness,
 * checksum verification, and constraint checking for synthetic test sequences.
 *
 * Functions return clear pass/fail results with detailed error information.
 *
 * Reference: plan.md §8.1, bf-4nlyp
 */

import {
  SyntheticBlockSequence,
  SyntheticBlock,
  SequenceConfig,
  SEQUENCE_SIZE_LIMITS,
} from './synthetic-test-schema.js';
import { calculateChecksum } from './synthetic-test-schema.js';

/**
 * Result from a verification operation.
 *
 * Provides clear pass/fail result with optional error details.
 */
export interface VerificationResult {
  /** Verification passed */
  passed: boolean;
  /** Error messages (if failed) */
  errors: string[];
  /** Warning messages (non-critical issues) */
  warnings: string[];
}

/**
 * Block ID uniqueness validation result.
 *
 * Details about block ID uniqueness check.
 */
export interface BlockIdUniquenessResult {
  /** All block IDs are unique */
  unique: boolean;
  /** Duplicate block IDs found (key: blockId, value: count) */
  duplicates: Map<number, number>;
  /** Total unique block IDs */
  uniqueCount: number;
  /** Total blocks checked */
  totalBlocks: number;
}

/**
 * Checksum validation result.
 *
 * Details about checksum verification.
 */
export interface ChecksumValidationResult {
  /** All checksums valid */
  valid: boolean;
  /** Blocks with invalid checksums (blockId, expected, actual) */
  invalidBlocks: Array<{ blockId: number; expected: number; actual: number }>;
  /** Blocks without checksum metadata */
  missingChecksums: number[];
}

/**
 * Sequence constraint validation result.
 *
 * Details about sequence constraint checks.
 */
export interface SequenceConstraintResult {
  /** All constraints satisfied */
  satisfied: boolean;
  /** Block count within valid range (100-1000) */
  blockCountValid: boolean;
  /** Total size calculation correct */
  totalSizeValid: boolean;
  /** Block IDs sequential (if applicable) */
  sequentialIds: boolean;
  /** Constraint violations */
  violations: string[];
}

/**
 * Detailed sequence integrity report.
 *
 * Comprehensive validation report with all verification results.
 */
export interface SequenceIntegrityReport {
  /** Sequence ID */
  sequenceId: string;
  /** Overall validation passed */
  passed: boolean;
  /** Block count validation */
  blockCount: SequenceConstraintResult;
  /** Block ID uniqueness */
  uniqueness: BlockIdUniquenessResult;
  /** Checksum validation */
  checksums: ChecksumValidationResult;
  /** Total size validation */
  totalSize: VerificationResult;
  /** Metadata consistency */
  metadata: VerificationResult;
  /** All errors combined */
  allErrors: string[];
  /** All warnings combined */
  allWarnings: string[];
}

/**
 * Validate block count is within 100-1000 range.
 *
 * Checks that block count meets the sequence constraint requirements.
 *
 * @param blockCount - Block count to validate
 * @returns Verification result
 *
 * @example
 * ```ts
 * const result = validateBlockCount(500);
 * console.log(result.passed); // true
 * ```
 */
export function validateBlockCount(blockCount: number): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (blockCount < SEQUENCE_SIZE_LIMITS.MIN_BLOCKS) {
    errors.push(
      `Block count ${blockCount} below minimum ${SEQUENCE_SIZE_LIMITS.MIN_BLOCKS}`
    );
  }

  if (blockCount > SEQUENCE_SIZE_LIMITS.MAX_BLOCKS) {
    errors.push(
      `Block count ${blockCount} above maximum ${SEQUENCE_SIZE_LIMITS.MAX_BLOCKS}`
    );
  }

  // Check for reasonable block counts
  if (blockCount <= 0) {
    errors.push('Block count must be positive');
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify block ID uniqueness in a sequence.
 *
 * Checks that all block IDs in the sequence are unique.
 *
 * @param sequence - Sequence to check
 * @returns Block ID uniqueness result
 *
 * @example
 * ```ts
 * const result = verifyBlockIdUniqueness(sequence);
 * console.log(result.unique); // true if all unique
 * ```
 */
export function verifyBlockIdUniqueness(sequence: SyntheticBlockSequence): BlockIdUniquenessResult {
  const blockIdCounts = new Map<number, number>();

  // Count occurrences of each block ID
  for (const block of sequence.blocks) {
    const count = blockIdCounts.get(block.blockId) ?? 0;
    blockIdCounts.set(block.blockId, count + 1);
  }

  // Find duplicates
  const duplicates = new Map<number, number>();
  for (const [blockId, count] of blockIdCounts.entries()) {
    if (count > 1) {
      duplicates.set(blockId, count);
    }
  }

  return {
    unique: duplicates.size === 0,
    duplicates,
    uniqueCount: blockIdCounts.size,
    totalBlocks: sequence.blocks.length,
  };
}

/**
 * Verify checksums for all blocks in a sequence.
 *
 * Validates that all blocks with checksum metadata have correct checksums.
 *
 * @param sequence - Sequence to validate
 * @returns Checksum validation result
 *
 * @example
 * ```ts
 * const result = verifyChecksums(sequence);
 * console.log(result.valid); // true if all checksums match
 * ```
 */
export function verifyChecksums(sequence: SyntheticBlockSequence): ChecksumValidationResult {
  const invalidBlocks: Array<{ blockId: number; expected: number; actual: number }> = [];
  const missingChecksums: number[] = [];

  for (const block of sequence.blocks) {
    if (block.metadata?.expectedChecksum !== undefined) {
      const actualChecksum = calculateChecksum(block.payload);
      if (actualChecksum !== block.metadata.expectedChecksum) {
        invalidBlocks.push({
          blockId: block.blockId,
          expected: block.metadata.expectedChecksum,
          actual: actualChecksum,
        });
      }
    } else {
      missingChecksums.push(block.blockId);
    }
  }

  return {
    valid: invalidBlocks.length === 0,
    invalidBlocks,
    missingChecksums,
  };
}

/**
 * Validate sequence constraints.
 *
 * Comprehensive check of sequence constraints including block count,
 * total size, and block ID sequentiality.
 *
 * @param sequence - Sequence to validate
 * @returns Sequence constraint result
 *
 * @example
 * ```ts
 * const result = validateSequenceConstraints(sequence);
 * console.log(result.satisfied); // true if all constraints met
 * ```
 */
export function validateSequenceConstraints(sequence: SyntheticBlockSequence): SequenceConstraintResult {
  const violations: string[] = [];

  // Block count validation
  const blockCountValid = sequence.blockCount >= SEQUENCE_SIZE_LIMITS.MIN_BLOCKS &&
                          sequence.blockCount <= SEQUENCE_SIZE_LIMITS.MAX_BLOCKS;
  if (!blockCountValid) {
    violations.push(
      `Block count ${sequence.blockCount} outside valid range [${SEQUENCE_SIZE_LIMITS.MIN_BLOCKS}, ${SEQUENCE_SIZE_LIMITS.MAX_BLOCKS}]`
    );
  }

  // Total size validation
  const calculatedSize = sequence.blocks.reduce((sum, block) => sum + block.payload.length, 0);
  const totalSizeValid = calculatedSize === sequence.totalSize;
  if (!totalSizeValid) {
    violations.push(
      `Total size mismatch: expected ${sequence.totalSize}, calculated ${calculatedSize}`
    );
  }

  // Block ID sequentiality check
  let sequentialIds = true;
  if (sequence.blocks.length > 0) {
    const sortedIds = [...sequence.blocks].map(b => b.blockId).sort((a, b) => a - b);
    for (let i = 1; i < sortedIds.length; i++) {
      const currentId = sortedIds[i];
      const previousId = sortedIds[i - 1];
      if (currentId !== undefined && previousId !== undefined && currentId !== previousId + 1) {
        sequentialIds = false;
        violations.push(
          `Block IDs not sequential: gap between ${previousId} and ${currentId}`
        );
        break;
      }
    }
  }

  return {
    satisfied: violations.length === 0,
    blockCountValid,
    totalSizeValid,
    sequentialIds,
    violations,
  };
}

/**
 * Verify total size calculation.
 *
 * Validates that the total size matches the sum of all block payload sizes.
 *
 * @param sequence - Sequence to verify
 * @returns Verification result
 */
export function verifyTotalSize(sequence: SyntheticBlockSequence): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const calculatedSize = sequence.blocks.reduce((sum, block) => sum + block.payload.length, 0);

  if (calculatedSize !== sequence.totalSize) {
    errors.push(
      `Total size mismatch: declared ${sequence.totalSize}, calculated ${calculatedSize}`
    );
  }

  // Warn if sequence size is at limits
  if (sequence.totalSize >= SEQUENCE_SIZE_LIMITS.MAX_SEQUENCE_SIZE) {
    warnings.push('Sequence at maximum size limit');
  }
  if (sequence.totalSize <= SEQUENCE_SIZE_LIMITS.MIN_SEQUENCE_SIZE) {
    warnings.push('Sequence at minimum size limit');
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Verify metadata consistency.
 *
 * Checks that metadata is present and consistent where expected.
 *
 * @param sequence - Sequence to verify
 * @returns Verification result
 */
export function verifyMetadataConsistency(sequence: SyntheticBlockSequence): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if metadata should be included based on config
  const includeMetadata = sequence.config.includeMetadata;

  if (includeMetadata) {
    // All blocks should have metadata
    const blocksWithoutMetadata = sequence.blocks.filter(b => !b.metadata);
    if (blocksWithoutMetadata.length > 0) {
      errors.push(
        `${blocksWithoutMetadata.length} blocks missing metadata (config.includeMetadata=true)`
      );
    }

    // All metadata should have pattern type
    const blocksWithoutPattern = sequence.blocks.filter(
      b => b.metadata && !b.metadata.patternType
    );
    if (blocksWithoutPattern.length > 0) {
      warnings.push(
        `${blocksWithoutPattern.length} blocks have metadata but missing patternType`
      );
    }
  }

  // Check timestamps are reasonable
  const now = Date.now();
  const blocksWithFutureTimestamps = sequence.blocks.filter(
    b => b.metadata && b.metadata.createdAt > now + 1000
  );
  if (blocksWithFutureTimestamps.length > 0) {
    warnings.push(
      `${blocksWithFutureTimestamps.length} blocks have future timestamps`
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Generate comprehensive sequence integrity report.
 *
 * Runs all verification checks and returns a detailed report.
 *
 * @param sequence - Sequence to validate
 * @returns Comprehensive integrity report
 *
 * @example
 * ```ts
 * const report = generateSequenceIntegrityReport(sequence);
 * if (report.passed) {
 *   console.log('Sequence is valid');
 * } else {
 *   console.error('Errors:', report.allErrors);
 * }
 * ```
 */
export function generateSequenceIntegrityReport(sequence: SyntheticBlockSequence): SequenceIntegrityReport {
  // Block count validation
  const blockCountResult = validateBlockCount(sequence.blockCount);
  const blockCount: SequenceConstraintResult = {
    satisfied: blockCountResult.passed,
    blockCountValid: blockCountResult.passed,
    totalSizeValid: true, // Will be checked separately
    sequentialIds: true,  // Will be checked separately
    violations: blockCountResult.errors,
  };

  // Block ID uniqueness
  const uniqueness = verifyBlockIdUniqueness(sequence);

  // Checksum validation
  const checksums = verifyChecksums(sequence);

  // Total size validation
  const totalSizeResult = verifyTotalSize(sequence);
  const totalSize: VerificationResult = {
    passed: totalSizeResult.passed,
    errors: totalSizeResult.errors,
    warnings: totalSizeResult.warnings,
  };

  // Metadata consistency
  const metadata = verifyMetadataConsistency(sequence);

  // Collect all errors and warnings
  const allErrors = [
    ...blockCountResult.errors,
    ...(uniqueness.unique ? [] : [`${uniqueness.duplicates.size} duplicate block IDs found`]),
    ...(checksums.valid ? [] : [`${checksums.invalidBlocks.length} blocks with invalid checksums`]),
    ...totalSizeResult.errors,
    ...metadata.errors,
  ];

  const allWarnings = [
    ...blockCountResult.warnings,
    ...totalSizeResult.warnings,
    ...metadata.warnings,
  ];

  const passed = allErrors.length === 0 &&
                 uniqueness.unique &&
                 checksums.valid &&
                 totalSizeResult.passed &&
                 metadata.passed;

  return {
    sequenceId: sequence.sequenceId,
    passed,
    blockCount,
    uniqueness,
    checksums,
    totalSize,
    metadata,
    allErrors,
    allWarnings,
  };
}

/**
 * Quick validation check - returns boolean only.
 *
 * Fast validation that only returns pass/fail without details.
 *
 * @param sequence - Sequence to validate
 * @returns true if sequence passes all checks
 *
 * @example
 * ```ts
 * if (quickValidateSequence(sequence)) {
 *   console.log('Sequence is valid');
 * }
 * ```
 */
export function quickValidateSequence(sequence: SyntheticBlockSequence): boolean {
  const report = generateSequenceIntegrityReport(sequence);
  return report.passed;
}

/**
 * Validate single block integrity.
 *
 * Checks that a single block has valid structure and checksum.
 *
 * @param block - Block to validate
 * @returns Verification result
 */
export function validateSingleBlock(block: SyntheticBlock): VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check payload exists
  if (!block.payload) {
    errors.push('Block missing payload');
    return { passed: false, errors, warnings };
  }

  // Check payload size
  if (block.payload.length === 0) {
    warnings.push('Block has empty payload');
  }

  // Verify checksum if present
  if (block.metadata?.expectedChecksum !== undefined) {
    const actualChecksum = calculateChecksum(block.payload);
    if (actualChecksum !== block.metadata.expectedChecksum) {
      errors.push(
        `Checksum mismatch: expected ${block.metadata.expectedChecksum}, got ${actualChecksum}`
      );
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Calculate hash for data integrity verification.
 *
 * Uses a simple hash algorithm for quick integrity checks.
 * For cryptographic purposes, use a proper hash library.
 *
 * @param data - Data to hash
 * @returns Hash value
 */
export function calculateSimpleHash(data: Uint8Array): number {
  let hash = 0x811c9dc5; // FNV offset basis

  for (const byte of data) {
    hash = hash ^ byte;
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }

  return hash >>> 0; // Force unsigned 32-bit
}

/**
 * Verify data integrity using hash comparison.
 *
 * @param data - Data to verify
 * @param expectedHash - Expected hash value
 * @returns true if hash matches
 */
export function verifyDataHash(data: Uint8Array, expectedHash: number): boolean {
  const actualHash = calculateSimpleHash(data);
  return actualHash === expectedHash;
}

/**
 * Result from byte-wise comparison.
 *
 * Details about byte array comparison with difference location.
 */
export interface ByteComparisonResult {
  /** Byte arrays are identical */
  identical: boolean;
  /** Number of bytes compared */
  bytesCompared: number;
  /** Number of differing bytes */
  differences: number;
  /** Index of first difference (if any) */
  firstDifferenceIndex: number | null;
  /** Details of differences (up to 10) */
  differenceDetails: Array<{
    index: number;
    expected: number;
    actual: number;
  }>;
  /** Length of expected array */
  expectedLength: number;
  /** Length of actual array */
  actualLength: number;
}

/**
 * Compare two byte arrays byte-by-byte.
 *
 * Performs exact comparison of two byte arrays and returns detailed
 * information about any differences found.
 *
 * @param expected - Expected byte array
 * @param actual - Actual byte array to compare
 * @returns Comparison result with pass/fail and diff information
 *
 * @example
 * ```ts
 * const expected = new Uint8Array([1, 2, 3, 4, 5]);
 * const actual = new Uint8Array([1, 2, 9, 4, 5]);
 * const result = compareBytes(expected, actual);
 * console.log(result.identical); // false
 * console.log(result.firstDifferenceIndex); // 2
 * console.log(result.differenceDetails[0]);
 * // { index: 2, expected: 3, actual: 9 }
 * ```
 */
export function compareBytes(expected: Uint8Array, actual: Uint8Array): ByteComparisonResult {
  const expectedLength = expected.length;
  const actualLength = actual.length;
  const bytesCompared = Math.min(expectedLength, actualLength);

  const differenceDetails: Array<{
    index: number;
    expected: number;
    actual: number;
  }> = [];

  let firstDifferenceIndex: number | null = null;
  let differences = 0;

  // Compare byte by byte
  for (let i = 0; i < bytesCompared; i++) {
    if (expected[i] !== actual[i]) {
      differences++;

      if (firstDifferenceIndex === null) {
        firstDifferenceIndex = i;
      }

      // Store up to 10 differences for detailed reporting
      if (differenceDetails.length < 10) {
        differenceDetails.push({
          index: i,
          expected: expected[i],
          actual: actual[i],
        });
      }
    }
  }

  // Account for length difference as additional differences
  if (expectedLength !== actualLength) {
    // Length mismatch is treated as differences beyond the shorter length
    const extraDifferences = Math.abs(expectedLength - actualLength);
    differences += extraDifferences;

    // If no byte differences found but lengths differ, first difference is at min length
    if (firstDifferenceIndex === null) {
      firstDifferenceIndex = bytesCompared;
    }
  }

  const identical = differences === 0;

  return {
    identical,
    bytesCompared,
    differences,
    firstDifferenceIndex,
    differenceDetails,
    expectedLength,
    actualLength,
  };
}

/**
 * Verify decoded output matches original input.
 *
 * Convenience function that performs byte-wise comparison and returns
 * a simple boolean result along with optional diff details.
 *
 * @param original - Original byte array
 * @param decoded - Decoded byte array to verify
 * @returns true if arrays match exactly
 *
 * @example
 * ```ts
 * const original = new Uint8Array([1, 2, 3, 4, 5]);
 * const decoded = new Uint8Array([1, 2, 3, 4, 5]);
 * if (verifyDecodedOutput(original, decoded)) {
 *   console.log('Decoding successful - exact match');
 * }
 * ```
 */
export function verifyDecodedOutput(original: Uint8Array, decoded: Uint8Array): boolean {
  const result = compareBytes(original, decoded);
  return result.identical;
}

/**
 * Generate validation error summary.
 *
 * Creates a human-readable summary of validation failures.
 *
 * @param report - Integrity report
 * @returns Formatted error summary
 */
export function formatValidationErrors(report: SequenceIntegrityReport): string {
  if (report.passed) {
    return `✓ Sequence ${report.sequenceId} is valid`;
  }

  const lines: string[] = [
    `✗ Sequence ${report.sequenceId} validation failed:`,
  ];

  if (report.blockCount.violations.length > 0) {
    lines.push('  Block count violations:');
    for (const violation of report.blockCount.violations) {
      lines.push(`    - ${violation}`);
    }
  }

  if (!report.uniqueness.unique) {
    lines.push(`  Duplicate block IDs: ${report.uniqueness.duplicates.size} duplicates found`);
    for (const [blockId, count] of report.uniqueness.duplicates) {
      lines.push(`    - Block ID ${blockId}: ${count} occurrences`);
    }
  }

  if (!report.checksums.valid) {
    lines.push(`  Checksum failures: ${report.checksums.invalidBlocks.length} blocks`);
    for (const invalid of report.checksums.invalidBlocks) {
      lines.push(
        `    - Block ${invalid.blockId}: expected ${invalid.expected}, got ${invalid.actual}`
      );
    }
  }

  if (report.totalSize.errors.length > 0) {
    lines.push('  Total size errors:');
    for (const error of report.totalSize.errors) {
      lines.push(`    - ${error}`);
    }
  }

  if (report.metadata.errors.length > 0) {
    lines.push('  Metadata errors:');
    for (const error of report.metadata.errors) {
      lines.push(`    - ${error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Verify sequence meets all requirements.
 *
 * Main entry point for sequence validation. Returns detailed result.
 *
 * @param sequence - Sequence to verify
 * @returns Verification result with clear pass/fail
 *
 * @example
 * ```ts
 * const result = verifySequenceRequirements(sequence);
 * if (!result.passed) {
 *   console.error('Validation failed:', result.errors);
 * }
 * ```
 */
export function verifySequenceRequirements(sequence: SyntheticBlockSequence): VerificationResult {
  const report = generateSequenceIntegrityReport(sequence);

  return {
    passed: report.passed,
    errors: report.allErrors,
    warnings: report.allWarnings,
  };
}

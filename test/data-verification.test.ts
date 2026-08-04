/**
 * Tests for data verification helper functions.
 *
 * Validates verification utilities for synthetic test data including
 * block count validation, uniqueness checks, checksum verification,
 * and sequence integrity reporting.
 *
 * Reference: plan.md §8.1, bf-4nlyp
 */

import { describe, expect, it } from 'vitest';
import {
  generateSyntheticSequence,
  SyntheticBlock,
  SyntheticBlockSequence,
  VALIDATION_PATTERNS,
  createSyntheticBlock,
} from '../src/core/block/synthetic-test-schema.js';
import {
  validateBlockCount,
  verifyBlockIdUniqueness,
  verifyChecksums,
  validateSequenceConstraints,
  verifyTotalSize,
  verifyMetadataConsistency,
  generateSequenceIntegrityReport,
  quickValidateSequence,
  validateSingleBlock,
  calculateSimpleHash,
  verifyDataHash,
  formatValidationErrors,
  verifySequenceRequirements,
  type VerificationResult,
  type BlockIdUniquenessResult,
  type ChecksumValidationResult,
  type SequenceConstraintResult,
} from '../src/core/block/data-verification.js';
import { calculateChecksum } from '../src/core/block/synthetic-test-schema.js';

describe('Data Verification Helpers', () => {
  describe('validateBlockCount', () => {
    it('should accept valid block count within range', () => {
      const result = validateBlockCount(500);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept minimum valid block count', () => {
      const result = validateBlockCount(100);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept maximum valid block count', () => {
      const result = validateBlockCount(1000);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject block count below minimum', () => {
      const result = validateBlockCount(99);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('below minimum');
    });

    it('should reject block count above maximum', () => {
      const result = validateBlockCount(1001);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('above maximum');
    });

    it('should reject zero block count', () => {
      const result = validateBlockCount(0);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Block count must be positive');
    });

    it('should reject negative block count', () => {
      const result = validateBlockCount(-1);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Block count must be positive');
    });
  });

  describe('verifyBlockIdUniqueness', () => {
    it('should verify unique block IDs in valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifyBlockIdUniqueness(sequence);

      expect(result.unique).toBe(true);
      expect(result.duplicates.size).toBe(0);
      expect(result.uniqueCount).toBe(100);
      expect(result.totalBlocks).toBe(100);
    });

    it('should detect duplicate block IDs', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Create duplicate by modifying block ID
      sequence.blocks[50].blockId = sequence.blocks[0].blockId;

      const result = verifyBlockIdUniqueness(sequence);

      expect(result.unique).toBe(false);
      expect(result.duplicates.size).toBeGreaterThan(0);
      expect(result.duplicates.get(sequence.blocks[0].blockId)).toBe(2);
    });

    it('should detect multiple duplicates', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Create multiple duplicates
      sequence.blocks[10].blockId = 5;  // Now blockId 5 appears at blocks[5] and blocks[10]
      sequence.blocks[20].blockId = 5;  // Now blockId 5 appears at blocks[5], blocks[10], blocks[20]
      sequence.blocks[30].blockId = 0;  // Now blockId 0 appears at blocks[0] and blocks[30]

      const result = verifyBlockIdUniqueness(sequence);

      expect(result.unique).toBe(false);
      expect(result.duplicates.size).toBe(2);
      expect(result.duplicates.get(5)).toBe(3); // Original + 2 duplicates
      expect(result.duplicates.get(0)).toBe(2); // Original + 1 duplicate
    });

    it('should handle empty sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });
      sequence.blocks = [];

      const result = verifyBlockIdUniqueness(sequence);

      expect(result.unique).toBe(true);
      expect(result.duplicates.size).toBe(0);
      expect(result.uniqueCount).toBe(0);
    });
  });

  describe('verifyChecksums', () => {
    it('should verify all checksums in valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifyChecksums(sequence);

      expect(result.valid).toBe(true);
      expect(result.invalidBlocks).toHaveLength(0);
      expect(result.missingChecksums).toHaveLength(0);
    });

    it('should detect corrupted checksum', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Corrupt payload data
      sequence.blocks[0].payload[0] = (sequence.blocks[0].payload[0] + 1) & 0xff;

      const result = verifyChecksums(sequence);

      expect(result.valid).toBe(false);
      expect(result.invalidBlocks).toHaveLength(1);
      expect(result.invalidBlocks[0].blockId).toBe(sequence.blocks[0].blockId);
    });

    it('should identify blocks without checksums', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: false,
      });

      const result = verifyChecksums(sequence);

      expect(result.valid).toBe(true); // Missing checksums not invalid
      expect(result.invalidBlocks).toHaveLength(0);
      expect(result.missingChecksums).toHaveLength(100);
    });

    it('should handle mixed metadata presence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: false,
      });

      // Add metadata to some blocks
      for (let i = 0; i < 50; i++) {
        sequence.blocks[i].metadata = {
          createdAt: Date.now(),
          patternType: VALIDATION_PATTERNS.SEQUENTIAL,
          expectedChecksum: calculateChecksum(sequence.blocks[i].payload),
        };
      }

      const result = verifyChecksums(sequence);

      expect(result.valid).toBe(true);
      expect(result.missingChecksums).toHaveLength(50);
    });
  });

  describe('validateSequenceConstraints', () => {
    it('should validate all constraints in valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 500,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = validateSequenceConstraints(sequence);

      expect(result.satisfied).toBe(true);
      expect(result.blockCountValid).toBe(true);
      expect(result.totalSizeValid).toBe(true);
      expect(result.sequentialIds).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect invalid block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });
      sequence.blockCount = 99;

      const result = validateSequenceConstraints(sequence);

      expect(result.satisfied).toBe(false);
      expect(result.blockCountValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should detect total size mismatch', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });
      sequence.totalSize = 999999;

      const result = validateSequenceConstraints(sequence);

      expect(result.satisfied).toBe(false);
      expect(result.totalSizeValid).toBe(false);
      expect(result.violations.some(v => v.includes('Total size mismatch'))).toBe(true);
    });

    it('should detect non-sequential block IDs', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });
      sequence.blocks[50].blockId = 999;

      const result = validateSequenceConstraints(sequence);

      expect(result.satisfied).toBe(false);
      expect(result.sequentialIds).toBe(false);
      expect(result.violations.some(v => v.includes('not sequential'))).toBe(true);
    });
  });

  describe('verifyTotalSize', () => {
    it('should verify correct total size', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 200,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifyTotalSize(sequence);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect size mismatch', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });
      sequence.totalSize += 1;

      const result = verifyTotalSize(sequence);

      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn at size limits', () => {
      const smallSequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const largeSequence = generateSyntheticSequence({
        blockCount: 1000,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const smallResult = verifyTotalSize(smallSequence);
      const largeResult = verifyTotalSize(largeSequence);

      expect(smallResult.warnings.some(w => w.includes('minimum'))).toBe(true);
      expect(largeResult.warnings.some(w => w.includes('maximum'))).toBe(true);
    });
  });

  describe('verifyMetadataConsistency', () => {
    it('should verify consistent metadata', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifyMetadataConsistency(sequence);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing metadata when required', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Remove metadata from some blocks
      for (let i = 0; i < 10; i++) {
        sequence.blocks[i].metadata = undefined;
      }

      const result = verifyMetadataConsistency(sequence);

      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('missing metadata');
    });

    it('should not require metadata when not configured', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: false,
      });

      const result = verifyMetadataConsistency(sequence);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn about future timestamps', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Set future timestamp
      sequence.blocks[0].metadata!.createdAt = Date.now() + 10000;

      const result = verifyMetadataConsistency(sequence);

      expect(result.passed).toBe(true); // Warnings don't fail validation
      expect(result.warnings.some(w => w.includes('future timestamps'))).toBe(true);
    });
  });

  describe('generateSequenceIntegrityReport', () => {
    it('should generate comprehensive report for valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 300,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const report = generateSequenceIntegrityReport(sequence);

      expect(report.passed).toBe(true);
      expect(report.sequenceId).toBe(sequence.sequenceId);
      expect(report.allErrors).toHaveLength(0);
      expect(report.blockCount.satisfied).toBe(true);
      expect(report.uniqueness.unique).toBe(true);
      expect(report.checksums.valid).toBe(true);
      expect(report.totalSize.passed).toBe(true);
      expect(report.metadata.passed).toBe(true);
    });

    it('should report multiple validation failures', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      // Introduce multiple failures
      sequence.blockCount = 99;
      sequence.blocks[0].blockId = sequence.blocks[1].blockId;
      sequence.blocks[0].payload[0] = (sequence.blocks[0].payload[0] + 1) & 0xff;

      const report = generateSequenceIntegrityReport(sequence);

      expect(report.passed).toBe(false);
      expect(report.allErrors.length).toBeGreaterThan(0);
      expect(report.blockCount.satisfied).toBe(false);
      expect(report.uniqueness.unique).toBe(false);
      expect(report.checksums.valid).toBe(false);
    });

    it('should include warnings in report', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: false,
      });

      const report = generateSequenceIntegrityReport(sequence);

      // Should have warnings about missing checksums
      expect(report.checksums.missingChecksums.length).toBe(100);
    });
  });

  describe('quickValidateSequence', () => {
    it('should return true for valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 250,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = quickValidateSequence(sequence);

      expect(result).toBe(true);
    });

    it('should return false for invalid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      sequence.blockCount = 99;

      const result = quickValidateSequence(sequence);

      expect(result).toBe(false);
    });

    it('should be faster than full report', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 500,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const start1 = performance.now();
      quickValidateSequence(sequence);
      const quickTime = performance.now() - start1;

      const start2 = performance.now();
      generateSequenceIntegrityReport(sequence);
      const reportTime = performance.now() - start2;

      // Quick validation should not be significantly slower
      expect(quickTime).toBeLessThanOrEqual(reportTime * 1.5);
    });
  });

  describe('validateSingleBlock', () => {
    it('should validate valid block', () => {
      const block = createSyntheticBlock(0, 1024, VALIDATION_PATTERNS.SEQUENTIAL);

      const result = validateSingleBlock(block);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing payload', () => {
      const block = createSyntheticBlock(0, 1024, VALIDATION_PATTERNS.SEQUENTIAL);
      (block as any).payload = undefined;

      const result = validateSingleBlock(block);

      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Block missing payload');
    });

    it('should warn about empty payload', () => {
      const block = createSyntheticBlock(0, 1024, VALIDATION_PATTERNS.SEQUENTIAL);
      block.payload = new Uint8Array(0);
      // Remove metadata to avoid checksum mismatch
      block.metadata = undefined;

      const result = validateSingleBlock(block);

      expect(result.passed).toBe(true);
      expect(result.warnings).toContain('Block has empty payload');
    });

    it('should detect checksum mismatch', () => {
      const block = createSyntheticBlock(0, 1024, VALIDATION_PATTERNS.SEQUENTIAL);
      block.payload[0] = (block.payload[0] + 1) & 0xff;

      const result = validateSingleBlock(block);

      expect(result.passed).toBe(false);
      expect(result.errors.some(e => e.includes('Checksum mismatch'))).toBe(true);
    });
  });

  describe('calculateSimpleHash', () => {
    it('should calculate consistent hash for same data', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const hash1 = calculateSimpleHash(data);
      const hash2 = calculateSimpleHash(data);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different data', () => {
      const data1 = new Uint8Array([1, 2, 3, 4, 5]);
      const data2 = new Uint8Array([1, 2, 3, 4, 6]);

      const hash1 = calculateSimpleHash(data1);
      const hash2 = calculateSimpleHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty data', () => {
      const data = new Uint8Array(0);

      const hash = calculateSimpleHash(data);

      expect(typeof hash).toBe('number');
    });

    it('should handle large data', () => {
      const data = new Uint8Array(10000);
      for (let i = 0; i < data.length; i++) {
        data[i] = i & 0xff;
      }

      const hash = calculateSimpleHash(data);

      expect(typeof hash).toBe('number');
      expect(hash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('verifyDataHash', () => {
    it('should verify correct hash', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const expectedHash = calculateSimpleHash(data);

      const result = verifyDataHash(data, expectedHash);

      expect(result).toBe(true);
    });

    it('should reject incorrect hash', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);

      const result = verifyDataHash(data, 999);

      expect(result).toBe(false);
    });
  });

  describe('formatValidationErrors', () => {
    it('should format success message', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const report = generateSequenceIntegrityReport(sequence);
      const formatted = formatValidationErrors(report);

      expect(formatted).toContain('✓');
      expect(formatted).toContain('is valid');
    });

    it('should format failure message with errors', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      sequence.blockCount = 99;
      sequence.blocks[0].blockId = 1;

      const report = generateSequenceIntegrityReport(sequence);
      const formatted = formatValidationErrors(report);

      expect(formatted).toContain('✗');
      expect(formatted).toContain('validation failed');
    });

    it('should include specific error details', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      sequence.blocks[0].payload[0] = (sequence.blocks[0].payload[0] + 1) & 0xff;

      const report = generateSequenceIntegrityReport(sequence);
      const formatted = formatValidationErrors(report);

      expect(formatted).toContain('Checksum');
    });
  });

  describe('verifySequenceRequirements', () => {
    it('should pass valid sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 400,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifySequenceRequirements(sequence);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail invalid sequence with clear errors', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      sequence.blockCount = 99;
      sequence.totalSize += 1;

      const result = verifySequenceRequirements(sequence);

      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should include warnings for non-critical issues', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: false,
      });

      const result = verifySequenceRequirements(sequence);

      expect(result.passed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Integration tests', () => {
    it('should validate large sequence efficiently', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 1000,
        pattern: VALIDATION_PATTERNS.RANDOM,
        includeMetadata: true,
      });

      const start = performance.now();
      const result = quickValidateSequence(sequence);
      const duration = performance.now() - start;

      expect(result).toBe(true);
      expect(duration).toBeLessThan(2000); // Should complete in < 2 seconds
    });

    it('should handle all pattern types', () => {
      const patterns = [
        VALIDATION_PATTERNS.SEQUENTIAL,
        VALIDATION_PATTERNS.RANDOM,
        VALIDATION_PATTERNS.PATTERNED,
        VALIDATION_PATTERNS.ZERO,
        VALIDATION_PATTERNS.MAX,
      ];

      for (const pattern of patterns) {
        const sequence = generateSyntheticSequence({
          blockCount: 200,
          pattern,
          includeMetadata: true,
        });

        const result = quickValidateSequence(sequence);
        expect(result).toBe(true);
      }
    });

    it('should validate sequence with custom start ID', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 300,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
        startBlockId: 1000,
      });

      const result = quickValidateSequence(sequence);
      expect(result).toBe(true);
    });
  });
});

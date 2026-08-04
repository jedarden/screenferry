/**
 * Verification test for synthetic data generation utilities.
 *
 * Validates that all acceptance criteria for bead bf-41f0q are met:
 * 1. Synthetic data generator produces consistent output
 * 2. Generator creates sequences in the 100-1000 block range
 * 3. Data structure matches encode/decode input requirements
 *
 * Reference: bead bf-41f0q
 */

import { describe, expect, it } from 'vitest';
import {
  generateSyntheticSequence,
  sequenceToBuffer,
  SEQUENCE_PRESETS,
  VALIDATION_PATTERNS,
  SEQUENCE_SIZE_LIMITS,
} from '../src/core/block/synthetic-test-schema.js';
import {
  quickValidateSequence,
  verifySequenceRequirements,
} from '../src/core/block/data-verification.js';

describe('Bead bf-41f0q: Synthetic Data Generation Utilities', () => {
  describe('Acceptance Criterion 1: Consistent output', () => {
    it('should produce identical output with same seed', () => {
      const seed = 12345;
      const config = {
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        seed,
      };

      const seq1 = generateSyntheticSequence(config);
      const seq2 = generateSyntheticSequence(config);

      // Note: sequenceId includes timestamp, so it will differ
      // The actual data should be identical
      expect(seq1.blocks[0].payload).toEqual(seq2.blocks[0].payload);
      expect(seq1.blocks[50].payload).toEqual(seq2.blocks[50].payload);
      expect(seq1.blocks[99].payload).toEqual(seq2.blocks[99].payload);

      // Total size should match
      expect(seq1.totalSize).toBe(seq2.totalSize);
      expect(seq1.blockCount).toBe(seq2.blockCount);
    });

    it('should produce different output with different seeds', () => {
      const config1 = {
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.RANDOM,
        seed: 12345,
      };
      const config2 = {
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.RANDOM,
        seed: 54321,
      };

      const seq1 = generateSyntheticSequence(config1);
      const seq2 = generateSyntheticSequence(config2);

      expect(seq1.sequenceId).not.toBe(seq2.sequenceId);
      expect(seq1.blocks[0].payload[0]).not.toBe(seq2.blocks[0].payload[0]);
    });

    it('should produce deterministic random patterns', () => {
      const seed = 99999;
      const config = {
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.RANDOM,
        seed,
      };

      const seq1 = generateSyntheticSequence(config);
      const seq2 = generateSyntheticSequence(config);

      // Random pattern should still be deterministic with same seed
      expect(seq1.blocks[0].payload).toEqual(seq2.blocks[0].payload);
      expect(seq1.blocks[50].payload).toEqual(seq2.blocks[50].payload);
    });
  });

  describe('Acceptance Criterion 2: 100-1000 block range', () => {
    it('should enforce minimum block count of 100', () => {
      expect(() => {
        generateSyntheticSequence({
          blockCount: 99,
          pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        });
      }).toThrow('at least 100');
    });

    it('should enforce maximum block count of 1000', () => {
      expect(() => {
        generateSyntheticSequence({
          blockCount: 1001,
          pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        });
      }).toThrow('at most 1000');
    });

    it('should accept minimum valid block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
      });

      expect(sequence.blockCount).toBe(100);
      expect(sequence.blocks).toHaveLength(100);
    });

    it('should accept maximum valid block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 1000,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
      });

      expect(sequence.blockCount).toBe(1000);
      expect(sequence.blocks).toHaveLength(1000);
    });

    it('should provide preset configurations in valid range', () => {
      expect(SEQUENCE_PRESETS.SMALL.blockCount).toBe(100);
      expect(SEQUENCE_PRESETS.MEDIUM.blockCount).toBe(500);
      expect(SEQUENCE_PRESETS.LARGE.blockCount).toBe(1000);

      // Verify all presets are within valid range
      expect(SEQUENCE_PRESETS.SMALL.blockCount).toBeGreaterThanOrEqual(
        SEQUENCE_SIZE_LIMITS.MIN_BLOCKS
      );
      expect(SEQUENCE_PRESETS.LARGE.blockCount).toBeLessThanOrEqual(
        SEQUENCE_SIZE_LIMITS.MAX_BLOCKS
      );
    });

    it('should generate medium sequence within range', () => {
      const sequence = generateSyntheticSequence(SEQUENCE_PRESETS.MEDIUM);

      expect(sequence.blockCount).toBe(500);
      expect(sequence.blocks).toHaveLength(500);
    });
  });

  describe('Acceptance Criterion 3: Encode/decode data structures', () => {
    it('should convert sequence to contiguous buffer for encoding', () => {
      const blockSize = 1024;
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        blockSize,
      });

      const buffer = sequenceToBuffer(sequence);

      expect(buffer.length).toBe(blockSize * 100);
      expect(buffer.length).toBe(sequence.totalSize);
    });

    it('should preserve data integrity during conversion', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
      });

      const buffer = sequenceToBuffer(sequence);

      // Verify first block data
      expect(buffer[0]).toBe(sequence.blocks[0].payload[0]);
      expect(buffer[1]).toBe(sequence.blocks[0].payload[1]);

      // Verify second block starts after first block
      const firstBlockSize = sequence.blocks[0].payload.length;
      expect(buffer[firstBlockSize]).toBe(sequence.blocks[1].payload[0]);
    });

    it('should produce valid data for verification', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 200,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const isValid = quickValidateSequence(sequence);
      expect(isValid).toBe(true);
    });

    it('should pass full verification requirements', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 300,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        includeMetadata: true,
      });

      const result = verifySequenceRequirements(sequence);
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('All acceptance criteria integration', () => {
    it('should meet all criteria in single test', () => {
      // Criterion 1: Consistent output
      const seed = 42;
      const config = {
        blockCount: 250,
        pattern: VALIDATION_PATTERNS.SEQUENTIAL,
        seed,
        includeMetadata: true,
      };

      const seq1 = generateSyntheticSequence(config);
      const seq2 = generateSyntheticSequence(config);

      // Verify consistency (data, not sequenceId which includes timestamp)
      expect(seq1.blocks[0].payload).toEqual(seq2.blocks[0].payload);

      // Criterion 2: Valid range
      expect(seq1.blockCount).toBeGreaterThanOrEqual(100);
      expect(seq1.blockCount).toBeLessThanOrEqual(1000);

      // Criterion 3: Data structure for encode/decode
      const buffer = sequenceToBuffer(seq1);
      expect(buffer.length).toBe(seq1.totalSize);

      // Verify data is valid
      const verification = verifySequenceRequirements(seq1);
      expect(verification.passed).toBe(true);
    });

    it('should handle all validation patterns correctly', () => {
      const patterns = [
        VALIDATION_PATTERNS.SEQUENTIAL,
        VALIDATION_PATTERNS.RANDOM,
        VALIDATION_PATTERNS.PATTERNED,
        VALIDATION_PATTERNS.ZERO,
        VALIDATION_PATTERNS.MAX,
      ];

      for (const pattern of patterns) {
        const sequence = generateSyntheticSequence({
          blockCount: 150,
          pattern,
          includeMetadata: true,
        });

        const isValid = quickValidateSequence(sequence);
        expect(isValid).toBe(true);
      }
    });
  });
});

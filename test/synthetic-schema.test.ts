/**
 * Tests for synthetic test data schema.
 *
 * Validates the synthetic block sequence schema used for encode→decode
 * roundtrip validation testing.
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it } from 'vitest';
import {
  generateSyntheticSequence,
  validateSyntheticSequence,
  sequenceToBuffer,
  createSyntheticBlock,
  calculateChecksum,
  generatePayload,
  SEQUENCE_SIZE_LIMITS,
  SEQUENCE_PRESETS,
  type SyntheticBlock,
  type SyntheticBlockSequence,
  type SequenceConfig,
} from '../src/core/block/synthetic-test-schema.js';
import { BLOCK } from '../src/core/params.js';

describe('Synthetic Test Schema', () => {
  describe('Size constraints', () => {
    it('should enforce minimum block count (100)', () => {
      expect(() => {
        generateSyntheticSequence({
          blockCount: 99,
          pattern: 'sequential',
        });
      }).toThrow('at least 100');
    });

    it('should enforce maximum block count (1000)', () => {
      expect(() => {
        generateSyntheticSequence({
          blockCount: 1001,
          pattern: 'sequential',
        });
      }).toThrow('at most 1000');
    });

    it('should accept minimum valid block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
      });
      expect(sequence.blockCount).toBe(100);
    });

    it('should accept maximum valid block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 1000,
        pattern: 'sequential',
      });
      expect(sequence.blockCount).toBe(1000);
    });
  });

  describe('Sequence generation', () => {
    it('should generate sequence with correct block count', () => {
      const config: SequenceConfig = {
        blockCount: 500,
        pattern: 'sequential',
      };
      const sequence = generateSyntheticSequence(config);

      expect(sequence.blocks).toHaveLength(500);
      expect(sequence.blockCount).toBe(500);
    });

    it('should generate blocks with sequential IDs', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
      });

      for (let i = 0; i < sequence.blocks.length; i++) {
        expect(sequence.blocks[i].blockId).toBe(i);
      }
    });

    it('should generate blocks with correct payload size', () => {
      const blockSize = BLOCK;
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        blockSize,
      });

      for (const block of sequence.blocks) {
        expect(block.payload.length).toBe(blockSize);
      }
    });

    it('should calculate total size correctly', () => {
      const blockSize = 1024; // 1 KB for easier calculation
      const blockCount = 100;
      const sequence = generateSyntheticSequence({
        blockCount,
        pattern: 'sequential',
        blockSize,
      });

      expect(sequence.totalSize).toBe(blockSize * blockCount);
    });

    it('should include metadata when requested', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: true,
      });

      for (const block of sequence.blocks) {
        expect(block.metadata).toBeDefined();
        expect(block.metadata?.createdAt).toBeDefined();
        expect(block.metadata?.patternType).toBe('sequential');
        expect(block.metadata?.expectedChecksum).toBeDefined();
      }
    });

    it('should exclude metadata when not requested', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: false,
      });

      for (const block of sequence.blocks) {
        expect(block.metadata).toBeUndefined();
      }
    });

    it('should support custom start block ID', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        startBlockId: 1000,
      });

      expect(sequence.blocks[0].blockId).toBe(1000);
      expect(sequence.blocks[99].blockId).toBe(1099);
    });

    it('should generate unique sequence IDs', () => {
      const sequence1 = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        seed: 12345,
      });
      const sequence2 = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        seed: 54321,
      });

      expect(sequence1.sequenceId).not.toBe(sequence2.sequenceId);
    });
  });

  describe('Payload patterns', () => {
    it('should generate sequential pattern', () => {
      const payload = generatePayload(256, 'sequential', 0);

      expect(payload[0]).toBe(0);
      expect(payload[1]).toBe(1);
      expect(payload[255]).toBe(255);
    });

    it('should generate zero pattern', () => {
      const payload = generatePayload(256, 'zero', 0);

      for (let i = 0; i < payload.length; i++) {
        expect(payload[i]).toBe(0);
      }
    });

    it('should generate max pattern', () => {
      const payload = generatePayload(256, 'max', 0);

      for (let i = 0; i < payload.length; i++) {
        expect(payload[i]).toBe(0xff);
      }
    });

    it('should generate patterned sequence', () => {
      const payload = generatePayload(256, 'patterned', 0);

      expect(payload[0]).toBe(0xde);
      expect(payload[1]).toBe(0xad);
      expect(payload[2]).toBe(0xbe);
      expect(payload[3]).toBe(0xef);
      expect(payload[4]).toBe(0xde); // Repeats
    });

    it('should generate deterministic random pattern with seed', () => {
      const seed = 12345;
      const payload1 = generatePayload(256, 'random', seed);
      const payload2 = generatePayload(256, 'random', seed);

      expect(payload1).toEqual(payload2);
    });

    it('should generate different random patterns with different seeds', () => {
      const payload1 = generatePayload(256, 'random', 12345);
      const payload2 = generatePayload(256, 'random', 54321);

      expect(payload1).not.toEqual(payload2);
    });
  });

  describe('Checksum validation', () => {
    it('should calculate checksum correctly', () => {
      const payload = new Uint8Array([1, 2, 3, 4, 5]);
      const checksum = calculateChecksum(payload);

      expect(checksum).toBe(15); // 1+2+3+4+5 = 15
    });

    it('should include expected checksum in metadata', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: true,
      });

      const block = sequence.blocks[0];
      const expectedChecksum = calculateChecksum(block.payload);

      expect(block.metadata?.expectedChecksum).toBe(expectedChecksum);
    });

    it('should validate checksums during sequence validation', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: true,
      });

      expect(validateSyntheticSequence(sequence)).toBe(true);
    });
  });

  describe('Sequence validation', () => {
    it('should validate correct sequence', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: true,
      });

      expect(validateSyntheticSequence(sequence)).toBe(true);
    });

    it('should reject sequence with incorrect total size', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
      });

      // Corrupt total size
      (sequence as any).totalSize = 999;

      expect(validateSyntheticSequence(sequence)).toBe(false);
    });

    it('should reject sequence with incorrect block count', () => {
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
      });

      // Corrupt block count
      (sequence as any).blockCount = 99;

      expect(validateSyntheticSequence(sequence)).toBe(false);
    });
  });

  describe('Sequence to buffer conversion', () => {
    it('should convert sequence to contiguous buffer', () => {
      const blockSize = 1024;
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        blockSize,
      });

      const buffer = sequenceToBuffer(sequence);

      expect(buffer.length).toBe(blockSize * 100);
    });

    it('should preserve data in buffer', () => {
      const blockSize = 256;
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
        blockSize,
      });

      const buffer = sequenceToBuffer(sequence);

      // Check first block data
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(1);
      expect(buffer[255]).toBe(255);

      // Check second block starts over
      expect(buffer[256]).toBe(0);
      expect(buffer[257]).toBe(1);
    });
  });

  describe('Single block creation', () => {
    it('should create synthetic block with default size', () => {
      const block = createSyntheticBlock(0);

      expect(block.blockId).toBe(0);
      expect(block.payload.length).toBe(BLOCK);
      expect(block.metadata).toBeDefined();
    });

    it('should create synthetic block with custom size', () => {
      const customSize = 1024;
      const block = createSyntheticBlock(0, customSize);

      expect(block.payload.length).toBe(customSize);
    });

    it('should create synthetic block with pattern', () => {
      const block = createSyntheticBlock(0, BLOCK, 'zero');

      for (let i = 0; i < block.payload.length; i++) {
        expect(block.payload[i]).toBe(0);
      }
    });

    it('should include metadata in created block', () => {
      const block = createSyntheticBlock(0);

      expect(block.metadata).toBeDefined();
      expect(block.metadata?.createdAt).toBeDefined();
      expect(block.metadata?.patternType).toBe('sequential');
      expect(block.metadata?.expectedChecksum).toBeDefined();
    });
  });

  describe('Presets', () => {
    it('should provide SMALL preset', () => {
      const preset = SEQUENCE_PRESETS.SMALL;

      expect(preset.blockCount).toBe(100);
      expect(preset.pattern).toBe('sequential');
      expect(preset.includeMetadata).toBe(true);
    });

    it('should provide MEDIUM preset', () => {
      const preset = SEQUENCE_PRESETS.MEDIUM;

      expect(preset.blockCount).toBe(500);
      expect(preset.pattern).toBe('sequential');
      expect(preset.includeMetadata).toBe(true);
    });

    it('should provide LARGE preset', () => {
      const preset = SEQUENCE_PRESETS.LARGE;

      expect(preset.blockCount).toBe(1000);
      expect(preset.pattern).toBe('sequential');
      expect(preset.includeMetadata).toBe(true);
    });

    it('should generate valid sequence from preset', () => {
      const sequence = generateSyntheticSequence(SEQUENCE_PRESETS.SMALL);

      expect(validateSyntheticSequence(sequence)).toBe(true);
    });
  });

  describe('Size limits constants', () => {
    it('should define minimum blocks', () => {
      expect(SEQUENCE_SIZE_LIMITS.MIN_BLOCKS).toBe(100);
    });

    it('should define maximum blocks', () => {
      expect(SEQUENCE_SIZE_LIMITS.MAX_BLOCKS).toBe(1000);
    });

    it('should define default block size', () => {
      expect(SEQUENCE_SIZE_LIMITS.DEFAULT_BLOCK_SIZE).toBe(BLOCK);
    });

    it('should define min fragment length', () => {
      expect(SEQUENCE_SIZE_LIMITS.MIN_FRAGMENT_LEN).toBe(256); // L
    });

    it('should define max sequence size', () => {
      expect(SEQUENCE_SIZE_LIMITS.MAX_SEQUENCE_SIZE).toBe(1000 * BLOCK);
    });

    it('should define min sequence size', () => {
      expect(SEQUENCE_SIZE_LIMITS.MIN_SEQUENCE_SIZE).toBe(100 * BLOCK);
    });
  });

  describe('Edge cases', () => {
    it('should handle minimum sequence size efficiently', () => {
      const start = Date.now();
      const sequence = generateSyntheticSequence({
        blockCount: 100,
        pattern: 'sequential',
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should complete quickly
      expect(sequence.blocks).toHaveLength(100);
    });

    it('should handle maximum sequence size within reasonable time', () => {
      const start = Date.now();
      const sequence = generateSyntheticSequence({
        blockCount: 1000,
        pattern: 'sequential',
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in reasonable time
      expect(sequence.blocks).toHaveLength(1000);
    });

    it('should handle all patterns without errors', () => {
      const patterns: Array<SequenceConfig['pattern']> = [
        'sequential',
        'random',
        'patterned',
        'zero',
        'max',
      ];

      for (const pattern of patterns) {
        expect(() => {
          generateSyntheticSequence({
            blockCount: 100,
            pattern,
          });
        }).not.toThrow();
      }
    });
  });

  describe('Type safety', () => {
    it('should export SyntheticBlock type', () => {
      const block: SyntheticBlock = {
        blockId: 0,
        payload: new Uint8Array(10),
        metadata: {
          createdAt: Date.now(),
          patternType: 'sequential',
        },
      };

      expect(block.blockId).toBeDefined();
      expect(block.payload).toBeDefined();
    });

    it('should export SyntheticBlockSequence type', () => {
      const sequence: SyntheticBlockSequence = {
        sequenceId: 'test-1',
        blocks: [],
        totalSize: 0,
        blockCount: 0,
        createdAt: Date.now(),
        config: {
          blockCount: 0,
          pattern: 'sequential',
        },
      };

      expect(sequence.sequenceId).toBeDefined();
      expect(sequence.blocks).toBeDefined();
    });

    it('should export SequenceConfig type', () => {
      const config: SequenceConfig = {
        blockCount: 100,
        pattern: 'sequential',
        includeMetadata: true,
      };

      expect(config.blockCount).toBeDefined();
      expect(config.pattern).toBeDefined();
    });
  });
});

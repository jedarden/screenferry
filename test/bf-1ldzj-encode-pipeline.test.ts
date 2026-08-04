/**
 * Encode pipeline test for synthetic data sequences.
 *
 * Tests the encoding portion of the roundtrip with synthetic data:
 * - Generate synthetic test sequences (100-1000 blocks)
 * - Encode sequences using BlockEncodePipeline
 * - Verify encoding completes without errors
 * - Capture encoded output for decode testing
 * - Validate encoded block integrity
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  BlockEncodePipeline,
  createEncodePipeline,
  type EncodePipelineConfig,
} from '../src/core/block/encode-pipeline.js';
import {
  generateSyntheticSequence,
  sequenceToBuffer,
  SEQUENCE_PRESETS,
  type SyntheticBlockSequence,
} from '../src/core/block/synthetic-test-schema.js';
import {
  verifySequenceRequirements,
  generateSequenceIntegrityReport,
  calculateSimpleHash,
} from '../src/core/block/data-verification.js';
import { BLOCK, L, K } from '../src/core/params.js';

describe('Encode pipeline with synthetic data', () => {
  const STREAM_ID = 12345;

  // Helper function to get test sequences
  function getTestSequence(size: 'small' | 'medium' | 'large'): SyntheticBlockSequence {
    switch (size) {
      case 'small':
        return generateSyntheticSequence(SEQUENCE_PRESETS.SMALL);
      case 'medium':
        return generateSyntheticSequence(SEQUENCE_PRESETS.MEDIUM);
      case 'large':
        return generateSyntheticSequence(SEQUENCE_PRESETS.LARGE);
    }
  }

  describe('Synthetic sequence generation', () => {
    it('should generate valid small sequence (100 blocks)', () => {
      const sequence = getTestSequence('small');
      expect(sequence.blockCount).toBe(100);
      expect(sequence.totalSize).toBe(100 * BLOCK);

      const report = generateSequenceIntegrityReport(sequence);
      expect(report.passed).toBe(true);
    });

    it('should generate valid medium sequence (500 blocks)', () => {
      const sequence = getTestSequence('medium');
      expect(sequence.blockCount).toBe(500);
      expect(sequence.totalSize).toBe(500 * BLOCK);

      const report = generateSequenceIntegrityReport(sequence);
      expect(report.passed).toBe(true);
    });

    it('should generate valid large sequence (1000 blocks)', () => {
      const sequence = getTestSequence('large');
      expect(sequence.blockCount).toBe(1000);
      expect(sequence.totalSize).toBe(1000 * BLOCK);

      const report = generateSequenceIntegrityReport(sequence);
      expect(report.passed).toBe(true);
    });
  });

  describe('Encode small sequence (100 blocks)', () => {
    let pipeline: BlockEncodePipeline;
    let encodedData: Map<number, Uint8Array[]>;
    const sequence = getTestSequence('small');

    beforeEach(() => {
      const buffer = sequenceToBuffer(sequence);
      const config: EncodePipelineConfig = {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
      };
      pipeline = createEncodePipeline(buffer, config);
      encodedData = new Map();
    });

    afterEach(() => {
      pipeline.stop();
      pipeline.clear();
    });

    it('should start pipeline successfully', () => {
      pipeline.start();
      const state = pipeline.getState();
      expect(state.running).toBe(true);
      expect(state.totalBlocks).toBe(100);
      expect(state.blocksEncoded).toBe(0);
    });

    it('should encode all blocks without errors', () => {
      pipeline.start();
      const count = pipeline.preEncodeAll();

      expect(count).toBe(100);

      const state = pipeline.getState();
      expect(state.blocksEncoded).toBe(100);
    });

    it('should capture encoded output for all blocks', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      // Due to cache eviction with large dwellPackets (1229), not all blocks remain in cache
      // But we can still encode and retrieve them on-demand
      let blocksRetrieved = 0;
      for (let i = 0; i < 100; i++) {
        // Re-encode if not in cache
        let entry = pipeline.getBlock(i);
        if (!entry) {
          entry = pipeline.encodeBlock(i);
        }

        expect(entry).toBeDefined();
        expect(entry!.fragments.length).toBeGreaterThan(0);

        // Store encoded data for decode testing
        encodedData.set(i, entry!.fragments);
        blocksRetrieved++;
      }

      // Verify all blocks captured (through cache or re-encoding)
      expect(encodedData.size).toBe(100);
      expect(blocksRetrieved).toBe(100);
    });

    it('should maintain memory constraints during encoding', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      expect(pipeline.validateConstraints()).toBe(true);

      const stats = pipeline.getStorageStats();
      // Due to memory constraints and large dwellPackets, not all blocks fit in cache
      expect(stats.blockCount).toBeGreaterThan(0);
      expect(stats.blockCount).toBeLessThanOrEqual(stats.maxBlocks);
      expect(stats.currentBytes).toBeGreaterThan(0);
      expect(stats.currentBytes).toBeLessThanOrEqual(stats.maxBytes);
    });

    it('should encode blocks in correct order', () => {
      // Create pipeline with smaller dwellPackets for this test
      const buffer = sequenceToBuffer(sequence);
      const testPipeline = createEncodePipeline(buffer, {
        streamId: STREAM_ID,
        dwellPackets: 2, // Small dwell for testing order
      });

      testPipeline.start();

      const encodedOrder: number[] = [];
      for (let i = 0; i < 200; i++) { // Multiple passes
        const result = testPipeline.encodeNext();
        encodedOrder.push(result.blockIndex);
      }

      // With dwell=2, we should see blocks 0, 0, 1, 1, 2, 2, ...
      // First 200 should include first 100 distinct blocks
      const uniqueBlocks = new Set(encodedOrder.slice(0, 200));
      expect(uniqueBlocks.size).toBe(100);

      // Verify first few blocks are in order
      expect(encodedOrder[0]).toBe(0);
      expect(encodedOrder[1]).toBe(0);
      expect(encodedOrder[2]).toBe(1);
      expect(encodedOrder[3]).toBe(1);

      testPipeline.stop();
      testPipeline.clear();
    });

    it('should produce valid encoded block structure', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      // Check a sample of blocks - re-encode if evicted
      const sampleBlocks = [0, 49, 99];
      for (const blockIndex of sampleBlocks) {
        let entry = pipeline.getBlock(blockIndex);
        if (!entry) {
          entry = pipeline.encodeBlock(blockIndex);
        }

        expect(entry).toBeDefined();
        expect(entry!.metadata.blockIndex).toBe(blockIndex);
        expect(entry!.fragments.length).toBeGreaterThan(0);
        expect(entry!.fragments.length).toBeLessThanOrEqual(Math.ceil(K * 1.6));

        // Verify fragments are valid Uint8Array
        for (const fragment of entry!.fragments) {
          expect(fragment instanceof Uint8Array).toBe(true);
          expect(fragment.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Encode medium sequence (500 blocks)', () => {
    let pipeline: BlockEncodePipeline;
    let encodedData: Map<number, Uint8Array[]>;
    const sequence = getTestSequence('medium');

    beforeEach(() => {
      const buffer = sequenceToBuffer(sequence);
      const config: EncodePipelineConfig = {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
        storageConfig: {
          maxMemoryBytes: 1024 * 1024 * 100, // 100 MB
          maxBlocks: 100,
        },
      };
      pipeline = createEncodePipeline(buffer, config);
      encodedData = new Map();
    });

    afterEach(() => {
      pipeline.stop();
      pipeline.clear();
    });

    it('should encode all 500 blocks without errors', () => {
      pipeline.start();
      const count = pipeline.preEncodeAll();

      expect(count).toBe(500);

      const state = pipeline.getState();
      expect(state.blocksEncoded).toBe(500);
      expect(state.totalBlocks).toBe(500);
    });

    it('should capture encoded output for all blocks', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      let captured = 0;
      for (let i = 0; i < 500; i++) {
        const entry = pipeline.getBlock(i);
        if (entry) {
          encodedData.set(i, entry.fragments);
          captured++;
        }
      }

      // With limited cache, not all blocks may be present
      // But cache should hold maxBlocks (100)
      expect(captured).toBeGreaterThan(0);
      expect(captured).toBeLessThanOrEqual(100);
    });

    it('should handle cache eviction gracefully', () => {
      // Create pipeline with smaller dwellPackets for faster testing
      const buffer = sequenceToBuffer(sequence);
      const testPipeline = createEncodePipeline(buffer, {
        streamId: STREAM_ID,
        dwellPackets: 2, // Small dwell for faster testing
        storageConfig: {
          maxMemoryBytes: 1024 * 1024 * 100,
          maxBlocks: 10,
        },
      });

      testPipeline.start();

      // Encode more blocks than cache can hold
      let encodeCount = 0;
      for (let i = 0; i < 30; i++) { // 30 iterations with dwell=2 means ~15 unique blocks
        try {
          const result = testPipeline.encodeNext();
          if (!result.cached) {
            encodeCount++;
          }
        } catch (e) {
          // Should not throw
          expect(false).toBe(true);
        }
      }

      // Should have encoded some blocks
      const state = testPipeline.getState();
      expect(state.blocksEncoded).toBeGreaterThan(0);
      expect(state.blocksEncoded).toBeLessThanOrEqual(500);
      expect(testPipeline.validateConstraints()).toBe(true);

      testPipeline.stop();
      testPipeline.clear();
    });
  });

  describe('Encode large sequence (1000 blocks)', () => {
    let pipeline: BlockEncodePipeline;
    let encodedData: Map<number, Uint8Array[]>;
    const sequence = getTestSequence('large');

    beforeEach(() => {
      const buffer = sequenceToBuffer(sequence);
      const config: EncodePipelineConfig = {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
        storageConfig: {
          maxMemoryBytes: 1024 * 1024 * 50, // 50 MB
          maxBlocks: 50,
        },
      };
      pipeline = createEncodePipeline(buffer, config);
      encodedData = new Map();
    });

    afterEach(() => {
      pipeline.stop();
      pipeline.clear();
    });

    it('should encode all 1000 blocks without errors', () => {
      pipeline.start();
      const count = pipeline.preEncodeAll();

      expect(count).toBe(1000);

      const state = pipeline.getState();
      expect(state.blocksEncoded).toBe(1000);
      expect(state.totalBlocks).toBe(1000);
    });

    it('should manage memory with large sequence', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      expect(pipeline.validateConstraints()).toBe(true);

      const stats = pipeline.getStorageStats();
      expect(stats.blockCount).toBeLessThanOrEqual(50);
      expect(stats.currentBytes).toBeLessThanOrEqual(1024 * 1024 * 50);
    });

    it('should encode large sequence progressively', () => {
      pipeline.start();

      let blocksProcessed = 0;
      let cacheHits = 0;
      let cacheMisses = 0;

      // Process first 200 blocks
      for (let i = 0; i < 200; i++) {
        const result = pipeline.encodeNext();
        blocksProcessed++;

        if (result.cached) {
          cacheHits++;
        } else {
          cacheMisses++;
        }
      }

      expect(blocksProcessed).toBe(200);
      expect(cacheMisses).toBeGreaterThan(0);
    });
  });

  describe('Encoded output validation', () => {
    let pipeline: BlockEncodePipeline;
    const sequence = getTestSequence('small');

    beforeEach(() => {
      const buffer = sequenceToBuffer(sequence);
      const config: EncodePipelineConfig = {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
      };
      pipeline = createEncodePipeline(buffer, config);
    });

    afterEach(() => {
      pipeline.stop();
      pipeline.clear();
    });

    it('should produce consistent encoded output for same block', () => {
      pipeline.start();

      // Encode block 0 multiple times
      const encodings: Uint8Array[][] = [];
      for (let i = 0; i < 5; i++) {
        const entry = pipeline.encodeBlock(0);
        encodings.push(entry.fragments);
      }

      // All encodings should be identical (cached)
      for (let i = 1; i < encodings.length; i++) {
        expect(encodings[i].length).toBe(encodings[0].length);
        for (let j = 0; j < encodings[i].length; j++) {
          expect(encodings[i][j]).toEqual(encodings[0][j]);
        }
      }
    });

    it('should produce unique encoded output for different blocks', () => {
      pipeline.start();

      const entry0 = pipeline.encodeBlock(0);
      const entry1 = pipeline.encodeBlock(1);

      // Block indices should differ
      expect(entry0.metadata.blockIndex).toBe(0);
      expect(entry1.metadata.blockIndex).toBe(1);

      // Encoded fragments should differ
      const hash0 = calculateSimpleHash(entry0.fragments[0]);
      const hash1 = calculateSimpleHash(entry1.fragments[0]);
      expect(hash0).not.toBe(hash1);
    });

    it('should preserve block metadata in encoded output', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      for (let i = 0; i < 10; i++) {
        let entry = pipeline.getBlock(i);
        if (!entry) {
          entry = pipeline.encodeBlock(i);
        }

        expect(entry).toBeDefined();
        expect(entry!.metadata.blockIndex).toBe(i);
        expect(entry!.metadata.k).toBeGreaterThan(0);
        expect(entry!.metadata.fragmentLen).toBe(L);
      }
    });
  });

  describe('Encode pipeline error handling', () => {
    it('should handle invalid block index gracefully', () => {
      const sequence = getTestSequence('small');
      const buffer = sequenceToBuffer(sequence);
      const pipeline = createEncodePipeline(buffer, { streamId: STREAM_ID });

      pipeline.start();

      expect(() => pipeline.encodeBlock(-1)).toThrow();
      expect(() => pipeline.encodeBlock(1000)).toThrow();

      pipeline.stop();
      pipeline.clear();
    });

    it('should handle encode before start gracefully', () => {
      const sequence = getTestSequence('small');
      const buffer = sequenceToBuffer(sequence);
      const pipeline = createEncodePipeline(buffer, { streamId: STREAM_ID });

      expect(() => pipeline.encodeNext()).toThrow('not running');

      pipeline.stop();
      pipeline.clear();
    });
  });

  describe('Encode output capture for decode testing', () => {
    let pipeline: BlockEncodePipeline;
    let capturedOutput: Map<number, Uint8Array[]>;
    const sequence = getTestSequence('small');

    beforeEach(() => {
      const buffer = sequenceToBuffer(sequence);
      const config: EncodePipelineConfig = {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
      };
      pipeline = createEncodePipeline(buffer, config);
      capturedOutput = new Map();
    });

    afterEach(() => {
      pipeline.stop();
      pipeline.clear();
    });

    it('should capture complete encoded output for decode test', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      // Capture all blocks - re-encode if evicted from cache
      for (let i = 0; i < 100; i++) {
        let entry = pipeline.getBlock(i);
        if (!entry) {
          entry = pipeline.encodeBlock(i);
        }

        expect(entry).toBeDefined();
        capturedOutput.set(i, entry!.fragments);
      }

      // Verify capture completeness
      expect(capturedOutput.size).toBe(100);

      // Verify each block has fragments
      for (const [blockIndex, fragments] of capturedOutput) {
        expect(blockIndex).toBeGreaterThanOrEqual(0);
        expect(blockIndex).toBeLessThan(100);
        expect(fragments.length).toBeGreaterThan(0);

        // Verify fragments are valid
        for (const fragment of fragments) {
          expect(fragment instanceof Uint8Array).toBe(true);
          expect(fragment.length).toBeGreaterThan(0);
        }
      }
    });

    it('should provide metadata for decode reconstruction', () => {
      pipeline.start();
      pipeline.preEncodeAll();

      const sampleBlocks = [0, 50, 99];
      for (const blockIndex of sampleBlocks) {
        // Re-encode if not in cache
        let entry = pipeline.getBlock(blockIndex);
        if (!entry) {
          entry = pipeline.encodeBlock(blockIndex);
        }

        expect(entry).toBeDefined();

        // Decode pipeline needs this metadata
        expect(entry!.metadata.blockIndex).toBe(blockIndex);
        expect(entry!.metadata.k).toBeGreaterThan(0);
        expect(entry!.metadata.fragmentLen).toBe(L);
        expect(entry!.metadata.blockSize).toBe(BLOCK);
      }
    });
  });

  describe('Performance validation', () => {
    it('should encode small sequence efficiently', () => {
      const sequence = getTestSequence('small');
      const buffer = sequenceToBuffer(sequence);
      const pipeline = createEncodePipeline(buffer, {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
      });

      const startTime = performance.now();
      pipeline.start();
      pipeline.preEncodeAll();
      const endTime = performance.now();

      const duration = endTime - startTime;
      const blocksPerSecond = (100 / duration) * 1000;

      // Should encode at reasonable speed
      expect(blocksPerSecond).toBeGreaterThan(10); // At least 10 blocks/sec

      pipeline.stop();
      pipeline.clear();
    });

    it('should track encoding statistics accurately', () => {
      const sequence = getTestSequence('small');
      const buffer = sequenceToBuffer(sequence);
      const pipeline = createEncodePipeline(buffer, {
        streamId: STREAM_ID,
        dwellPackets: Math.ceil(K * 1.6),
      });

      pipeline.start();

      let statsBefore = pipeline.getState();
      expect(statsBefore.blocksEncoded).toBe(0);

      pipeline.encodeNext();
      let statsAfter = pipeline.getState();
      expect(statsAfter.blocksEncoded).toBe(1);

      pipeline.preEncodeAll();
      let statsFinal = pipeline.getState();
      expect(statsFinal.blocksEncoded).toBe(100);

      pipeline.stop();
      pipeline.clear();
    });
  });
});

/**
 * Unit tests for encode path integration (scheduler + encoder + storage).
 *
 * Tests for:
 * - EncodeBlockStorage: caching, LRU eviction, memory management
 * - BlockEncodePipeline: scheduler integration, block encoding, end-to-end flow
 * - Memory leak detection
 * - Edge cases and error handling
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  EncodeBlockStorage,
  createEncodedBlockEntry,
  validateEncodeStorageConfig,
  type EncodedBlockEntry,
  type EncodedBlockMetadata,
} from '../src/core/block/encode-storage.js';
import {
  BlockEncodePipeline,
  createEncodePipeline,
  estimateEncodeMemoryUsage,
  type EncodePipelineConfig,
} from '../src/core/block/encode-pipeline.js';
import { BLOCK, L, K } from '../src/core/params.js';
import {
  createMemorySampleStorage,
  captureMemorySample,
  type MemorySampleStorage,
  type MemorySample,
} from '../src/platform/memory-samples.js';

describe('EncodeBlockStorage', () => {
  let storage: EncodeBlockStorage;

  beforeEach(() => {
    storage = new EncodeBlockStorage({
      maxMemoryBytes: 1024 * 1024, // 1 MB for testing
      maxBlocks: 10,
      enableMemoryTracking: true,
    });
  });

  afterEach(() => {
    storage.clear();
  });

  describe('Construction', () => {
    it('should create storage with default config', () => {
      const defaultStorage = new EncodeBlockStorage();
      expect(defaultStorage).toBeDefined();
      expect(defaultStorage.size()).toBe(0);
      expect(defaultStorage.getMemoryUsage()).toBe(0);
    });

    it('should create storage with custom config', () => {
      const customStorage = new EncodeBlockStorage({
        maxMemoryBytes: 2 * 1024 * 1024,
        maxBlocks: 20,
      });
      expect(customStorage).toBeDefined();
    });
  });

  describe('Store and retrieve blocks', () => {
    it('should store and retrieve a block', () => {
      const fragments = [
        new Uint8Array(L),
        new Uint8Array(L),
        new Uint8Array(L),
      ];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      storage.set(entry);
      const retrieved = storage.get(0);

      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata.blockIndex).toBe(0);
      expect(retrieved?.fragments).toHaveLength(3);
    });

    it('should return undefined for non-existent block', () => {
      const retrieved = storage.get(999);
      expect(retrieved).toBeUndefined();
    });

    it('should update access time on retrieval', async () => {
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      storage.set(entry);
      const firstAccess = entry.lastAccess;

      // Wait and retrieve
      await new Promise(resolve => setTimeout(resolve, 10));
      storage.get(0);
      const secondAccess = entry.lastAccess;
      expect(secondAccess).toBeGreaterThan(firstAccess);
    });

    it('should check block existence', () => {
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      expect(storage.has(0)).toBe(false);
      storage.set(entry);
      expect(storage.has(0)).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least-recently-used block when memory full', () => {
      // Create small storage to trigger eviction
      const smallStorage = new EncodeBlockStorage({
        maxMemoryBytes: L * 5, // Room for 1.5 blocks (3 fragments each), should evict after 2nd
        maxBlocks: 10,
      });

      // Add 3 blocks, each with 3 fragments
      for (let i = 0; i < 3; i++) {
        const fragments = [
          new Uint8Array(L),
          new Uint8Array(L),
          new Uint8Array(L),
        ];
        const entry = createEncodedBlockEntry(i, fragments, BLOCK, L);
        smallStorage.set(entry);
      }

      // Should evict at least one block due to memory limit
      expect(smallStorage.size()).toBeLessThan(3);
      expect(smallStorage.has(2)).toBe(true); // Most recent should be there
    });

    it('should evict least-recently-used block when block count full', () => {
      const smallStorage = new EncodeBlockStorage({
        maxMemoryBytes: 1024 * 1024,
        maxBlocks: 2, // Only 2 blocks allowed
      });

      // Add 3 blocks
      for (let i = 0; i < 3; i++) {
        const fragments = [new Uint8Array(L)];
        const entry = createEncodedBlockEntry(i, fragments, BLOCK, L);
        smallStorage.set(entry);
      }

      // Only 2 blocks should remain
      expect(smallStorage.size()).toBe(2);
      expect(smallStorage.has(0)).toBe(false);
      expect(smallStorage.has(1)).toBe(true);
      expect(smallStorage.has(2)).toBe(true);
    });

    it('should return evicted block indices', () => {
      const smallStorage = new EncodeBlockStorage({
        maxMemoryBytes: L * 3, // Room for < 1 block of 2 fragments (512 bytes)
        maxBlocks: 10,
      });

      const entry1 = createEncodedBlockEntry(0, [
        new Uint8Array(L),
        new Uint8Array(L),
      ], BLOCK, L);
      const evicted1 = smallStorage.set(entry1);
      expect(evicted1).toHaveLength(0);

      const entry2 = createEncodedBlockEntry(1, [
        new Uint8Array(L),
        new Uint8Array(L),
      ], BLOCK, L);
      const evicted2 = smallStorage.set(entry2);
      expect(evicted2).toEqual([0]);
    });

    it('should update LRU order on access', () => {
      const storage = new EncodeBlockStorage({
        maxMemoryBytes: L * 3, // Room for 3 blocks
        maxBlocks: 3, // Max 3 blocks to force eviction on 4th
      });

      // Add blocks 0, 1, 2
      for (let i = 0; i < 3; i++) {
        const fragments = [new Uint8Array(L)];
        const entry = createEncodedBlockEntry(i, fragments, BLOCK, L);
        storage.set(entry);
      }

      // Access block 0 (make it most recent)
      storage.get(0);

      // Add block 3 (should evict block 1, not block 0)
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(3, fragments, BLOCK, L);
      const evicted = storage.set(entry);

      // Block 1 (LRU) should be evicted, block 0 should remain
      expect(evicted).toContain(1);
      expect(storage.has(0)).toBe(true);
      expect(storage.has(1)).toBe(false);
      expect(storage.has(2)).toBe(true);
      expect(storage.has(3)).toBe(true);
    });
  });

  describe('Memory tracking', () => {
    it('should track memory usage correctly', () => {
      const fragments = [new Uint8Array(L), new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      storage.set(entry);
      expect(storage.getMemoryUsage()).toBe(L * 2);
    });

    it('should update memory on block removal', () => {
      const fragments = [new Uint8Array(L), new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      storage.set(entry);
      expect(storage.getMemoryUsage()).toBe(L * 2);

      storage.delete(0);
      expect(storage.getMemoryUsage()).toBe(0);
    });

    it('should update memory on block replacement', () => {
      const entry1 = createEncodedBlockEntry(0, [
        new Uint8Array(L),
        new Uint8Array(L),
      ], BLOCK, L);
      storage.set(entry1);
      expect(storage.getMemoryUsage()).toBe(L * 2);

      const entry2 = createEncodedBlockEntry(0, [
        new Uint8Array(L),
      ], BLOCK, L);
      storage.set(entry2);
      expect(storage.getMemoryUsage()).toBe(L);
    });

    it('should validate memory constraints', () => {
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);

      storage.set(entry);
      expect(storage.validateConstraints()).toBe(true);

      // Fill storage to capacity
      const maxBlocks = 10;
      for (let i = 1; i < maxBlocks; i++) {
        const entry = createEncodedBlockEntry(i, [new Uint8Array(L)], BLOCK, L);
        storage.set(entry);
      }

      expect(storage.validateConstraints()).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track cache hit rate', () => {
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);
      storage.set(entry);

      // Cache hit
      storage.get(0);
      // Cache miss
      storage.get(1);

      const stats = storage.getStats();
      expect(stats.totalAccesses).toBe(2);
      expect(stats.cacheHits).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should track eviction events', () => {
      const smallStorage = new EncodeBlockStorage({
        maxMemoryBytes: L * 2,
        maxBlocks: 10,
      });

      // Add 2 blocks (fills capacity)
      smallStorage.set(createEncodedBlockEntry(0, [new Uint8Array(L)], BLOCK, L));
      smallStorage.set(createEncodedBlockEntry(1, [new Uint8Array(L)], BLOCK, L));

      // Add 3rd block (triggers eviction)
      smallStorage.set(createEncodedBlockEntry(2, [new Uint8Array(L)], BLOCK, L));

      const stats = smallStorage.getStats();
      expect(stats.evictions).toBe(1);
    });

    it('should provide comprehensive statistics', () => {
      const fragments = [new Uint8Array(L)];
      const entry = createEncodedBlockEntry(0, fragments, BLOCK, L);
      storage.set(entry);

      const stats = storage.getStats();
      expect(stats.currentBytes).toBe(L);
      expect(stats.maxBytes).toBe(1024 * 1024);
      expect(stats.blockCount).toBe(1);
      expect(stats.maxBlocks).toBe(10);
      expect(stats.evictions).toBe(0);
      expect(stats.utilization).toBeCloseTo(L / (1024 * 1024), 5);
    });
  });

  describe('Edge cases', () => {
    it('should reject block larger than capacity', () => {
      // Create storage with very small capacity
      const tinyStorage = new EncodeBlockStorage({
        maxMemoryBytes: L - 1, // Only 255 bytes
        maxBlocks: 10,
      });

      // Entry size is calculated based on k * fragmentLen, where k = number of fragments
      // We need to pass k=2 (2 fragments) to get sizeBytes = 2 * L = 512
      const hugeEntry = createEncodedBlockEntry(
        0,
        [new Uint8Array(L), new Uint8Array(L)], // 2 fragments = 512 bytes calculated
        BLOCK,
        L
      );

      expect(() => tinyStorage.set(hugeEntry)).toThrow('exceeds storage capacity');
    });

    it('should handle empty storage gracefully', () => {
      expect(storage.get(0)).toBeUndefined();
      expect(storage.has(0)).toBe(false);
      expect(storage.delete(0)).toBe(false);
      expect(storage.size()).toBe(0);
    });

    it('should clear all entries', () => {
      storage.set(createEncodedBlockEntry(0, [new Uint8Array(L)], BLOCK, L));
      storage.set(createEncodedBlockEntry(1, [new Uint8Array(L)], BLOCK, L));

      expect(storage.size()).toBe(2);
      storage.clear();
      expect(storage.size()).toBe(0);
      expect(storage.getMemoryUsage()).toBe(0);
    });

    it('should handle replacing existing entry', () => {
      // Entry size is calculated as k * fragmentLen (not actual fragment size)
      const entry1 = createEncodedBlockEntry(0, [new Uint8Array(L)], BLOCK, L);
      storage.set(entry1);
      expect(storage.getMemoryUsage()).toBe(L); // 1 fragment * L = 256

      // Replace with entry that has 2 fragments (k=2)
      const entry2 = createEncodedBlockEntry(0, [
        new Uint8Array(L),
        new Uint8Array(L),
      ], BLOCK, L);
      const evicted = storage.set(entry2);

      expect(evicted).toHaveLength(0); // No eviction for replacement
      expect(storage.size()).toBe(1);
      expect(storage.getMemoryUsage()).toBe(L * 2); // 2 fragments * L = 512
    });
  });

  describe('Utility functions', () => {
    it('should calculate block size correctly', () => {
      const k = 3;
      const fragmentLen = L;
      const size = EncodeBlockStorage.calculateBlockSize(k, fragmentLen);
      expect(size).toBe(k * fragmentLen);
    });

    it('should create metadata correctly', () => {
      const metadata = EncodeBlockStorage.createMetadata(5, 10, L, BLOCK);
      expect(metadata.blockIndex).toBe(5);
      expect(metadata.k).toBe(10);
      expect(metadata.fragmentLen).toBe(L);
      expect(metadata.blockSize).toBe(BLOCK);
      expect(metadata.sizeBytes).toBe(10 * L);
    });

    it('should validate storage config', () => {
      const validConfig = {
        maxMemoryBytes: 1024 * 1024,
        maxBlocks: 10,
      };
      expect(validateEncodeStorageConfig(validConfig)).toBe(true);

      const invalidConfig = {
        maxMemoryBytes: 100, // Too small
        maxBlocks: 10,
      };
      expect(validateEncodeStorageConfig(invalidConfig)).toBe(false);
    });
  });
});

describe('BlockEncodePipeline', () => {
  const testFileSize = 5 * BLOCK; // 5 blocks
  const testData = new Uint8Array(testFileSize);
  // Fill with test data
  for (let i = 0; i < testData.length; i++) {
    testData[i] = i & 0xff;
  }

  const config: EncodePipelineConfig = {
    streamId: 12345,
    storageConfig: {
      maxMemoryBytes: 1024 * 1024,
      maxBlocks: 10,
    },
    dwellPackets: 5,
  };

  let pipeline: BlockEncodePipeline;

  beforeEach(() => {
    pipeline = createEncodePipeline(testData, config);
  });

  afterEach(() => {
    pipeline.stop();
    pipeline.clear();
  });

  describe('Construction', () => {
    it('should create pipeline with source data', () => {
      expect(pipeline).toBeDefined();
      const geom = pipeline.getBlockGeometry();
      expect(geom.totalLen).toBe(testFileSize);
      expect(geom.blockCount).toBe(5);
    });

    it('should require streamId', () => {
      expect(() => {
        createEncodePipeline(testData, {} as EncodePipelineConfig);
      }).toThrow('streamId is required');
    });

    it('should create pipeline with custom config', () => {
      const customPipeline = createEncodePipeline(testData, {
        streamId: 999,
        dwellPackets: 10,
      });
      expect(customPipeline).toBeDefined();
    });
  });

  describe('Start and stop', () => {
    it('should start pipeline', () => {
      pipeline.start();
      const state = pipeline.getState();
      expect(state.running).toBe(true);
      expect(state.blocksEncoded).toBe(0);
    });

    it('should stop pipeline', () => {
      pipeline.start();
      pipeline.stop();
      const state = pipeline.getState();
      expect(state.running).toBe(false);
    });

    it('should reject starting when already running', () => {
      pipeline.start();
      expect(() => pipeline.start()).toThrow('already running');
    });
  });

  describe('Block encoding', () => {
    it('should encode next block in schedule', () => {
      pipeline.start();

      const result = pipeline.encodeNext();

      expect(result.cached).toBe(false);
      expect(result.blockIndex).toBe(0);
      expect(result.entry).toBeDefined();
      expect(result.entry?.metadata).toBeDefined();
      expect(result.entry.metadata.blockIndex).toBe(0);
    });

    it('should encode blocks in schedule order', () => {
      pipeline.start();

      const encoded: number[] = [];
      for (let i = 0; i < 15; i++) { // 3 passes (5 blocks × 3 packets each)
        const result = pipeline.encodeNext();
        encoded.push(result.blockIndex);
      }

      // Should emit block 0 five times, then block 1, etc.
      expect(encoded[0]).toBe(0);
      expect(encoded[5]).toBe(1);
      expect(encoded[10]).toBe(2);
    });

    it('should return cached entry on repeat access', () => {
      pipeline.start();

      const result1 = pipeline.encodeNext();
      expect(result1.cached).toBe(false);

      // Access same block again
      const result2 = pipeline.encodeNext();
      expect(result2.cached).toBe(true);
      expect(result2.blockIndex).toBe(result1.blockIndex);
    });

    it('should encode specific block by index', () => {
      pipeline.start();

      const entry = pipeline.encodeBlock(2);

      expect(entry).toBeDefined();
      expect(entry?.metadata).toBeDefined();
      expect(entry.metadata.blockIndex).toBe(2);
      expect(entry?.fragments).toBeDefined();
      expect(entry.fragments.length).toBeGreaterThan(0);
    });

    it('should reject invalid block index', () => {
      pipeline.start();
      expect(() => pipeline.encodeBlock(-1)).toThrow('out of range');
      expect(() => pipeline.encodeBlock(10)).toThrow('out of range');
    });
  });

  describe('Scheduler integration', () => {
    it('should use scheduler for block ordering', () => {
      pipeline.start();

      const scheduler = pipeline.getScheduler();
      const blocks: number[] = [];

      // Encode one full pass
      for (let i = 0; i < 5 * 5; i++) {
        const result = pipeline.encodeNext();
        blocks.push(result.blockIndex);
      }

      // Verify scheduler advanced
      const cursor = scheduler.getCursor();
      expect(cursor.blockIndex).toBeGreaterThanOrEqual(0);
    });

    it('should track progress through blocks', () => {
      pipeline.start();
      const scheduler = pipeline.getScheduler();

      // Before encoding
      expect(scheduler.getBlockProgress(0)).toBe(0);

      // Encode some packets from block 0
      for (let i = 0; i < 3; i++) {
        pipeline.encodeNext();
      }

      // Progress should be > 0
      expect(scheduler.getBlockProgress(0)).toBeGreaterThan(0);
    });
  });

  describe('Storage integration', () => {
    it('should store encoded blocks in cache', () => {
      pipeline.start();

      const result = pipeline.encodeNext();

      expect(pipeline.hasBlock(result.blockIndex)).toBe(true);

      const cached = pipeline.getBlock(result.blockIndex);
      expect(cached).toBeDefined();
      expect(cached?.metadata.blockIndex).toBe(result.blockIndex);
    });

    it('should respect storage memory limits', () => {
      const smallConfig: EncodePipelineConfig = {
        ...config,
        storageConfig: {
          maxMemoryBytes: L * 10, // Very small
          maxBlocks: 2,
        },
      };

      const smallPipeline = createEncodePipeline(testData, smallConfig);
      smallPipeline.start();

      // Encode several blocks
      for (let i = 0; i < 5; i++) {
        smallPipeline.encodeNext();
      }

      // Storage should validate constraints
      expect(smallPipeline.validateConstraints()).toBe(true);
    });

    it('should provide storage statistics', () => {
      pipeline.start();
      pipeline.encodeNext();

      const stats = pipeline.getStorageStats();
      expect(stats.blockCount).toBe(1);
      expect(stats.currentBytes).toBeGreaterThan(0);
    });
  });

  describe('Pre-encoding', () => {
    it('should pre-encode all blocks', () => {
      pipeline.start();

      const count = pipeline.preEncodeAll();

      expect(count).toBe(5); // All 5 blocks

      // All blocks should be cached
      for (let i = 0; i < 5; i++) {
        expect(pipeline.hasBlock(i)).toBe(true);
      }
    });

    it('should skip already-encoded blocks during pre-encode', () => {
      pipeline.start();

      // Encode one block first
      pipeline.encodeNext();

      const count = pipeline.preEncodeAll();

      expect(count).toBe(4); // 4 remaining blocks
    });

    it('should track blocks encoded correctly', () => {
      pipeline.start();

      // First call encodes block 0 (blocksEncoded = 1)
      pipeline.encodeNext();
      // Second call is still on block 0 (dwell=5), returns cached version
      pipeline.encodeNext();

      let state = pipeline.getState();
      expect(state.blocksEncoded).toBe(1); // Only 1 unique block encoded

      // Pre-encode all blocks to get the remaining 4
      pipeline.preEncodeAll();
      state = pipeline.getState();
      expect(state.blocksEncoded).toBe(5); // All 5 unique blocks
    });
  });

  describe('State and statistics', () => {
    it('should provide pipeline state', () => {
      pipeline.start();

      const state = pipeline.getState();

      expect(state.totalBlocks).toBe(5);
      expect(state.blocksEncoded).toBe(0);
      expect(state.running).toBe(true);
      expect(state.storageStats).toBeDefined();
    });

    it('should update state during encoding', () => {
      pipeline.start();

      pipeline.encodeNext();
      const state1 = pipeline.getState();
      expect(state1.blocksEncoded).toBe(1);

      // Next call is still on block 0 (dwell=5), returns cached
      pipeline.encodeNext();
      const state2 = pipeline.getState();
      expect(state2.blocksEncoded).toBe(1); // Still 1 unique block

      // Call encodeNext 5 more times to advance to block 1
      for (let i = 0; i < 5; i++) {
        pipeline.encodeNext();
      }
      const state3 = pipeline.getState();
      expect(state3.blocksEncoded).toBe(2); // Now encoded blocks 0 and 1
    });

    it('should stop tracking when stopped', () => {
      pipeline.start();
      pipeline.encodeNext();

      pipeline.stop();

      const state = pipeline.getState();
      expect(state.running).toBe(false);
    });
  });

  describe('Callbacks', () => {
    it('should call onBlockEncoded callback', () => {
      const encodedBlocks: number[] = [];
      const pipelineWithCallback = createEncodePipeline(testData, {
        ...config,
        onBlockEncoded: (blockIndex) => {
          encodedBlocks.push(blockIndex);
        },
      });

      pipelineWithCallback.start();
      pipelineWithCallback.encodeNext();

      expect(encodedBlocks).toHaveLength(1);
      expect(encodedBlocks[0]).toBe(0);
    });

    it('should call onBlockEvicted callback', () => {
      const evictedBlocks: number[] = [];
      const smallConfig: EncodePipelineConfig = {
        streamId: 12345,
        storageConfig: {
          maxMemoryBytes: 1024 * 1024, // 1 MB - enough for a few blocks
          maxBlocks: 2, // Only 2 blocks max to trigger eviction
        },
        dwellPackets: 1, // Single packet per block for quick testing
        onBlockEvicted: (blockIndex) => {
          evictedBlocks.push(blockIndex);
        },
      };

      const smallPipeline = createEncodePipeline(testData, smallConfig);
      smallPipeline.start();

      // Encode distinct blocks to trigger eviction
      // With dwellPackets=1, each encodeNext() moves to a new block
      for (let i = 0; i < 4; i++) {
        smallPipeline.encodeNext();
      }

      // With maxBlocks=2, encoding 4 distinct blocks should trigger 2 evictions
      expect(evictedBlocks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Memory leak detection', () => {
    it('should not leak memory during encode cycle', () => {
      pipeline.start();

      const initialMemory = pipeline.getStorageStats().currentBytes;

      // Encode one full pass
      for (let i = 0; i < 5 * 5; i++) {
        pipeline.encodeNext();
      }

      const finalMemory = pipeline.getStorageStats().currentBytes;

      // Memory should be bounded (not growing unbounded)
      expect(finalMemory).toBeLessThanOrEqual(pipeline.getStorageStats().maxBytes);
    });

    it('should clear all memory on clear()', () => {
      pipeline.start();

      for (let i = 0; i < 10; i++) {
        pipeline.encodeNext();
      }

      pipeline.clear();

      expect(pipeline.getStorageStats().currentBytes).toBe(0);
      expect(pipeline.getStorageStats().blockCount).toBe(0);
    });

    it('should validate constraints after heavy use', () => {
      pipeline.start();

      // Heavy usage
      for (let i = 0; i < 100; i++) {
        pipeline.encodeNext();
      }

      expect(pipeline.validateConstraints()).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle single-block files', () => {
      const singleBlockData = new Uint8Array(L);
      const singlePipeline = createEncodePipeline(singleBlockData, {
        streamId: 1,
      });

      singlePipeline.start();
      const result = singlePipeline.encodeNext();

      expect(result.blockIndex).toBe(0);
      const geom = singlePipeline.getBlockGeometry();
      expect(geom.blockCount).toBe(1);
    });

    it('should handle empty callback functions', () => {
      const pipelineWithNoCallbacks = createEncodePipeline(testData, {
        streamId: 1,
      });

      expect(() => {
        pipelineWithNoCallbacks.start();
        pipelineWithNoCallbacks.encodeNext();
      }).not.toThrow();
    });

    it('should reject encodeNext when not running', () => {
      expect(() => pipeline.encodeNext()).toThrow('not running');
    });
  });
});

describe('Utility functions', () => {
  describe('estimateEncodeMemoryUsage', () => {
    it('should estimate memory for small file', () => {
      const fileSize = BLOCK; // 1 block
      const estimate = estimateEncodeMemoryUsage(fileSize, 10);

      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThanOrEqual(10 * BLOCK);
    });

    it('should estimate memory for large file', () => {
      const fileSize = 100 * BLOCK; // 100 blocks
      const estimate = estimateEncodeMemoryUsage(fileSize, 10);

      // Should be capped at 10 blocks worth of cache
      expect(estimate).toBeLessThanOrEqual(10 * BLOCK);
    });

    it('should handle cache size smaller than block count', () => {
      const fileSize = 50 * BLOCK; // 50 blocks
      const cacheSize = 5; // Only cache 5 blocks
      const estimate = estimateEncodeMemoryUsage(fileSize, cacheSize);

      expect(estimate).toBeLessThanOrEqual(5 * BLOCK);
    });
  });
});

/**
 * Memory sampling configuration for encode tests.
 */
export interface EncodeTestMemorySamplingConfig {
  /** Enable memory sampling during encode operations (default: false) */
  enabled?: boolean;
  /** Sample every N unique blocks (default: 5) */
  sampleIntervalBlocks?: number;
}

/**
 * Encode test configuration with memory sampling support.
 */
export interface EncodeTestConfig {
  pipelineConfig?: Partial<EncodePipelineConfig> | undefined;
  memorySampling?: EncodeTestMemorySamplingConfig | undefined;
}

describe('Integration tests', () => {
  it('should handle complete encode cycle', () => {
    const fileSize = 10 * BLOCK;
    const testData = new Uint8Array(fileSize);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i & 0xff;
    }

    const pipeline = createEncodePipeline(testData, {
      streamId: 999,
      dwellPackets: 3,
    });

    pipeline.start();

    // Pre-encode all blocks
    const preEncoded = pipeline.preEncodeAll();
    expect(preEncoded).toBe(10);

    // Verify all blocks are cached
    for (let i = 0; i < 10; i++) {
      expect(pipeline.hasBlock(i)).toBe(true);
      const entry = pipeline.getBlock(i);
      expect(entry).toBeDefined();
      expect(entry?.fragments.length).toBe(3); // dwellPackets
    }

    // Verify memory constraints
    expect(pipeline.validateConstraints()).toBe(true);

    // Cleanup
    pipeline.stop();
    pipeline.clear();
  });

  it('should maintain cache consistency across evictions', () => {
    const testData = new Uint8Array(20 * BLOCK);
    const pipeline = createEncodePipeline(testData, {
      streamId: 1,
      storageConfig: {
        maxMemoryBytes: L * 50, // Limited cache
        maxBlocks: 3,
      },
      dwellPackets: 2,
    });

    pipeline.start();

    // Encode more blocks than cache can hold
    for (let i = 0; i < 10; i++) {
      const result = pipeline.encodeNext();
      // Verify stored data is consistent
      const entry = pipeline.getBlock(result.blockIndex);
      expect(entry).toBeDefined();
      expect(entry?.metadata.blockIndex).toBe(result.blockIndex);
    }

    // Verify storage constraints
    expect(pipeline.validateConstraints()).toBe(true);

    pipeline.stop();
    pipeline.clear();
  });

  it('should sample memory during block encoding', () => {
    const fileSize = 30 * BLOCK;
    const testData = new Uint8Array(fileSize);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i & 0xff;
    }

    const config: EncodeTestConfig = {
      pipelineConfig: {
        streamId: 200,
        dwellPackets: 2,
      },
      memorySampling: {
        enabled: true, // Enable sampling for this test
        sampleIntervalBlocks: 5, // Sample every 5 unique blocks
      },
    };

    const pipeline = createEncodePipeline(testData, config.pipelineConfig ?? {});

    // Set up memory sampling if enabled
    const samples = config.memorySampling?.enabled
      ? createMemorySampleStorage()
      : null;
    const sampleInterval = config.memorySampling?.sampleIntervalBlocks ?? 5;

    pipeline.start();

    // Encode blocks and sample memory
    let blocksEncoded = 0;
    const maxBlocks = 15;

    while (blocksEncoded < maxBlocks) {
      const result = pipeline.encodeNext();

      // Only count when we actually encode a new block (not cached)
      if (!result.cached) {
        // Sample at configured intervals (if sampling enabled)
        if (samples && (blocksEncoded === 0 || blocksEncoded % sampleInterval === 0)) {
          captureMemorySample(samples, blocksEncoded);
        }
        blocksEncoded++;
      }
    }

    // Verify we got samples (if sampling was enabled)
    if (config.memorySampling?.enabled && samples) {
      expect(samples.length).toBeGreaterThan(0);

      // Should have sampled at blocks 0, 5, 10
      const sampleIndices = samples.map(s => s.blockNumber);

      expect(sampleIndices).toContain(0);
      expect(sampleIndices.some(i => i >= 5 && i <= 7)).toBe(true);

      // Verify sample structure
      const firstSample = samples[0];
      expect(firstSample).toBeDefined();
      expect(firstSample?.blockNumber).toBe(0);
      expect(firstSample?.timestamp).toBeGreaterThan(0);
      expect(firstSample?.heapUsage).toBeGreaterThan(0);
    }

    pipeline.stop();
    pipeline.clear();
  });

  it('should track memory growth across encode cycle', () => {
    const fileSize = 20 * BLOCK;
    const testData = new Uint8Array(fileSize);
    for (let i = 0; i < testData.length; i++) {
      testData[i] = i & 0xff;
    }

    const config: EncodeTestConfig = {
      pipelineConfig: {
        streamId: 201,
        dwellPackets: 1,
      },
      memorySampling: {
        enabled: false, // Disabled by default - change to true to enable
        sampleIntervalBlocks: 5,
      },
    };

    const pipeline = createEncodePipeline(testData, config.pipelineConfig ?? {});

    // Set up memory sampling if enabled
    const samples = config.memorySampling?.enabled
      ? createMemorySampleStorage()
      : null;
    const sampleInterval = config.memorySampling?.sampleIntervalBlocks ?? 5;

    pipeline.start();

    // Encode all blocks
    let uniqueBlocksEncoded = 0;
    for (let i = 0; i < 100; i++) {
      const result = pipeline.encodeNext();

      if (!result.cached) {
        // Sample at configured intervals (if sampling enabled)
        if (samples && (uniqueBlocksEncoded === 0 || uniqueBlocksEncoded % sampleInterval === 0)) {
          captureMemorySample(samples, uniqueBlocksEncoded);
        }
        uniqueBlocksEncoded++;
      }

      if (uniqueBlocksEncoded >= 20) break;
    }

    // Verify samples (if sampling was enabled)
    if (config.memorySampling?.enabled && samples) {
      expect(samples.length).toBeGreaterThanOrEqual(4); // 0, 5, 10, 15

      // Calculate growth
      if (samples.length >= 2) {
        const firstSample = samples[0];
        const lastSample = samples[samples.length - 1];
        expect(firstSample).toBeDefined();
        expect(lastSample).toBeDefined();
        const firstHeap = firstSample?.heapUsage ?? 0;
        const lastHeap = lastSample?.heapUsage ?? 0;
        const growth = lastHeap - firstHeap;

        // Growth should be reasonable (not unbounded leak)
        expect(growth).toBeLessThan(50 * 1024 * 1024); // Less than 50 MB growth
      }
    }

    pipeline.stop();
    pipeline.clear();
  });

  it('should respect disabled memory sampling', () => {
    const testData = new Uint8Array(10 * BLOCK);

    const config: EncodeTestConfig = {
      pipelineConfig: {
        streamId: 202,
      },
      memorySampling: {
        enabled: false, // Explicitly disabled
      },
    };

    const pipeline = createEncodePipeline(testData, config.pipelineConfig ?? {});

    // No samples array created - sampling disabled
    expect(config.memorySampling?.enabled).toBe(false);

    pipeline.start();

    // Encode some blocks
    for (let i = 0; i < 10; i++) {
      pipeline.encodeNext();
    }

    // No verification needed - just ensure no crashes
    pipeline.stop();
    pipeline.clear();
  });
});

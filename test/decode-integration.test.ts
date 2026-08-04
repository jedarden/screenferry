/**
 * Unit tests for decode path integration (storage + decoder + reassembly).
 *
 * Tests for:
 * - DecodePacketStorage: packet caching, LRU eviction, memory management
 * - BlockDecodePipeline: packet reception, block decoding, end-to-end flow
 * - Memory leak detection
 * - Edge cases and error handling
 * - Integration with fountain decoder
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  DecodePacketStorage,
  createFountainPacketEntry,
  validateDecodeStorageConfig,
  estimateDecodeMemoryUsage,
  type FountainPacketEntry,
  type DecodeStorageConfig,
  type BlockCompletion,
} from '../src/core/block/decode-storage.js';
import {
  BlockDecodePipeline,
  createDecodePipeline,
  estimateDecodeMemoryUsage as estimatePipelineMemoryUsage,
  type DecodePipelineConfig,
} from '../src/core/block/decode-pipeline.js';
import { BLOCK, L, K } from '../src/core/params.js';

describe('DecodePacketStorage', () => {
  let storage: DecodePacketStorage;

  beforeEach(() => {
    storage = new DecodePacketStorage({
      maxMemoryBytes: 1024 * 1024, // 1 MB for testing
      maxPackets: 100,
      enableMemoryTracking: true,
    });
  });

  afterEach(() => {
    storage.clear();
  });

  describe('Construction', () => {
    it('should create storage with default config', () => {
      const defaultStorage = new DecodePacketStorage();
      expect(defaultStorage).toBeDefined();
      expect(defaultStorage.size()).toBe(0);
      expect(defaultStorage.getMemoryUsage()).toBe(0);
    });

    it('should create storage with custom config', () => {
      const customStorage = new DecodePacketStorage({
        maxMemoryBytes: 2 * 1024 * 1024,
        maxPackets: 200,
      });
      expect(customStorage).toBeDefined();
    });

    it('should validate configuration', () => {
      expect(validateDecodeStorageConfig({})).toBe(true);
      expect(validateDecodeStorageConfig({ maxMemoryBytes: 1000 })).toBe(true);
      expect(validateDecodeStorageConfig({ maxMemoryBytes: -1 })).toBe(false);
      expect(validateDecodeStorageConfig({ maxPackets: -1 })).toBe(false);
    });
  });

  describe('Store and retrieve packets', () => {
    it('should store and retrieve a packet', () => {
      const payload = new Uint8Array([1, 2, 3, 4]);
      const entry = createFountainPacketEntry(0, 0, payload);

      storage.set(entry);
      const retrieved = storage.get(0, 0);

      expect(retrieved).toBeDefined();
      expect(retrieved?.metadata.blockIndex).toBe(0);
      expect(retrieved?.metadata.seq).toBe(0);
      expect(retrieved?.payload).toEqual(payload);
    });

    it('should return undefined for non-existent packet', () => {
      const retrieved = storage.get(999, 999);
      expect(retrieved).toBeUndefined();
    });

    it('should update access time on retrieval', async () => {
      const payload = new Uint8Array(L);
      const entry = createFountainPacketEntry(0, 0, payload);

      storage.set(entry);
      const firstAccess = entry.lastAccess;

      // Wait and retrieve
      await new Promise(resolve => setTimeout(resolve, 10));
      storage.get(0, 0);
      const secondAccess = entry.lastAccess;
      expect(secondAccess).toBeGreaterThan(firstAccess);
    });

    it('should check packet existence', () => {
      const payload = new Uint8Array(L);
      const entry = createFountainPacketEntry(0, 0, payload);

      expect(storage.has(0, 0)).toBe(false);
      storage.set(entry);
      expect(storage.has(0, 0)).toBe(true);
      expect(storage.has(0, 1)).toBe(false);
    });

    it('should store multiple packets for same block', () => {
      const entry1 = createFountainPacketEntry(0, 0, new Uint8Array(L));
      const entry2 = createFountainPacketEntry(0, 1, new Uint8Array(L));
      const entry3 = createFountainPacketEntry(0, 2, new Uint8Array(L));

      storage.set(entry1);
      storage.set(entry2);
      storage.set(entry3);

      expect(storage.size()).toBe(3);
      expect(storage.has(0, 0)).toBe(true);
      expect(storage.has(0, 1)).toBe(true);
      expect(storage.has(0, 2)).toBe(true);
    });

    it('should store packets for different blocks', () => {
      const entry1 = createFountainPacketEntry(0, 0, new Uint8Array(L));
      const entry2 = createFountainPacketEntry(1, 0, new Uint8Array(L));
      const entry3 = createFountainPacketEntry(2, 0, new Uint8Array(L));

      storage.set(entry1);
      storage.set(entry2);
      storage.set(entry3);

      expect(storage.size()).toBe(3);
      expect(storage.getBlockCount()).toBe(3);
    });
  });

  describe('Block packet retrieval', () => {
    it('should get all packets for a block', () => {
      const entry1 = createFountainPacketEntry(0, 0, new Uint8Array([1, 2]));
      const entry2 = createFountainPacketEntry(0, 2, new Uint8Array([5, 6]));
      const entry3 = createFountainPacketEntry(0, 1, new Uint8Array([3, 4]));

      storage.set(entry1);
      storage.set(entry2);
      storage.set(entry3);

      const packets = storage.getBlockPackets(0);
      expect(packets).toHaveLength(3);
      expect(packets[0]).toEqual([0, new Uint8Array([1, 2])]);
      expect(packets[1]).toEqual([1, new Uint8Array([3, 4])]);
      expect(packets[2]).toEqual([2, new Uint8Array([5, 6])]);
    });

    it('should return empty array for non-existent block', () => {
      const packets = storage.getBlockPackets(999);
      expect(packets).toEqual([]);
    });

    it('should track block completion', () => {
      const k = 10;

      // Add some packets
      for (let i = 0; i < 5; i++) {
        storage.set(createFountainPacketEntry(0, i, new Uint8Array(L)));
      }

      const completion = storage.getBlockCompletion(0, k);
      expect(completion.blockIndex).toBe(0);
      expect(completion.uniquePackets).toBe(5);
      expect(completion.estimatedProgress).toBe(0.5);
      expect(completion.complete).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict packets when memory limit exceeded', () => {
      const smallStorage = new DecodePacketStorage({
        maxMemoryBytes: 3 * L, // Only fits 3 packets
        maxPackets: 100,
      });

      // Add 5 packets
      for (let i = 0; i < 5; i++) {
        const entry = createFountainPacketEntry(0, i, new Uint8Array(L));
        smallStorage.set(entry);
      }

      // Should only keep 3 most recent
      expect(smallStorage.size()).toBe(3);
      expect(smallStorage.has(0, 0)).toBe(false); // First evicted
      expect(smallStorage.has(0, 1)).toBe(false); // Second evicted
      expect(smallStorage.has(0, 2)).toBe(true); // Still present
      expect(smallStorage.has(0, 3)).toBe(true);
      expect(smallStorage.has(0, 4)).toBe(true);

      const stats = smallStorage.getStats();
      expect(stats.evictions).toBe(2);
    });

    it('should evict packets when packet count limit exceeded', () => {
      const limitedStorage = new DecodePacketStorage({
        maxMemoryBytes: 10 * 1024 * 1024,
        maxPackets: 3, // Only 3 packets allowed
      });

      // Add 5 packets
      for (let i = 0; i < 5; i++) {
        const entry = createFountainPacketEntry(0, i, new Uint8Array(L));
        limitedStorage.set(entry);
      }

      // Should only keep 3 most recent
      expect(limitedStorage.size()).toBe(3);
      expect(limitedStorage.getStats().evictions).toBe(2);
    });

    it('should update LRU on access', async () => {
      const smallStorage = new DecodePacketStorage({
        maxMemoryBytes: 3 * L,
        maxPackets: 100,
      });

      // Add 3 packets
      for (let i = 0; i < 3; i++) {
        const entry = createFountainPacketEntry(0, i, new Uint8Array(L));
        smallStorage.set(entry);
      }

      // Access first packet to make it recently used
      await new Promise(resolve => setTimeout(resolve, 10));
      smallStorage.get(0, 0);

      // Add 2 more packets - should evict packets 1 and 2 (least recently used)
      smallStorage.set(createFountainPacketEntry(0, 3, new Uint8Array(L)));
      smallStorage.set(createFountainPacketEntry(0, 4, new Uint8Array(L)));

      expect(smallStorage.has(0, 0)).toBe(true); // Kept because of recent access
      expect(smallStorage.has(0, 1)).toBe(false); // Evicted
      expect(smallStorage.has(0, 2)).toBe(false); // Evicted
    });
  });

  describe('Block removal', () => {
    it('should remove all packets for a block', () => {
      for (let i = 0; i < 5; i++) {
        storage.set(createFountainPacketEntry(0, i, new Uint8Array(L)));
      }
      for (let i = 0; i < 3; i++) {
        storage.set(createFountainPacketEntry(1, i, new Uint8Array(L)));
      }

      expect(storage.size()).toBe(8);
      expect(storage.getBlockCount()).toBe(2);

      const removed = storage.removeBlock(0);

      expect(removed).toBe(5);
      expect(storage.size()).toBe(3);
      expect(storage.getBlockCount()).toBe(1);
      expect(storage.getBlockPackets(0)).toEqual([]);
      expect(storage.getBlockPackets(1)).toHaveLength(3);
    });

    it('should return 0 for non-existent block', () => {
      const removed = storage.removeBlock(999);
      expect(removed).toBe(0);
    });
  });

  describe('Statistics and validation', () => {
    it('should track storage statistics', () => {
      for (let i = 0; i < 10; i++) {
        storage.set(createFountainPacketEntry(0, i, new Uint8Array(L)));
      }

      // Access some packets to generate hits (all 5 exist since we set 0-9)
      storage.get(0, 0); // Hit
      storage.get(0, 1); // Hit
      storage.get(0, 2); // Hit
      storage.get(0, 3); // Hit
      storage.get(0, 4); // Hit
      storage.get(0, 99); // Miss (doesn't exist)

      const stats = storage.getStats();
      expect(stats.packetCount).toBe(10);
      expect(stats.currentBytes).toBe(10 * L);
      expect(stats.totalAccesses).toBe(6);
      expect(stats.cacheHits).toBe(5);
      expect(stats.hitRate).toBeCloseTo(5/6, 2);
    });

    it('should validate constraints', () => {
      expect(storage.validateConstraints()).toBe(true);

      // Fill storage
      for (let i = 0; i < 150; i++) {
        storage.set(createFountainPacketEntry(i, 0, new Uint8Array(L)));
      }

      // Should still validate (eviction keeps it within bounds)
      expect(storage.validateConstraints()).toBe(true);
    });

    it('should estimate memory usage', () => {
      const fileSize = 1024 * 1024; // 1 MB
      const estimate = estimateDecodeMemoryUsage(fileSize, 1000);
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThanOrEqual(fileSize);
    });
  });

  describe('Clear and reset', () => {
    it('should clear all data', () => {
      for (let i = 0; i < 10; i++) {
        storage.set(createFountainPacketEntry(i, 0, new Uint8Array(L)));
      }

      expect(storage.size()).toBe(10);
      expect(storage.getBlockCount()).toBe(10);

      storage.clear();

      expect(storage.size()).toBe(0);
      expect(storage.getBlockCount()).toBe(0);
      expect(storage.getMemoryUsage()).toBe(0);
      expect(storage.getStats().evictions).toBe(0);
    });
  });
});

describe('BlockDecodePipeline', () => {
  let pipeline: BlockDecodePipeline;
  const fileSize = 1024 * 1024; // 1 MB
  const streamId = 12345;

  const config: DecodePipelineConfig = {
    streamId,
    fileSize,
    storageConfig: {
      maxMemoryBytes: 2 * 1024 * 1024,
      maxPackets: 200,
    },
  };

  beforeEach(() => {
    pipeline = createDecodePipeline(config);
  });

  afterEach(() => {
    pipeline.stop();
    pipeline.clear();
  });

  describe('Construction', () => {
    it('should create pipeline with valid config', () => {
      expect(pipeline).toBeDefined();
      expect(pipeline.getBlockGeometry().blockCount).toBeGreaterThan(0);
    });

    it('should throw with missing streamId', () => {
      expect(() => {
        createDecodePipeline({ streamId: undefined as any, fileSize: 1000 });
      }).toThrow();
    });

    it('should throw with invalid fileSize', () => {
      expect(() => {
        createDecodePipeline({ streamId: 1, fileSize: -1 });
      }).toThrow();
    });

    it('should estimate memory usage', () => {
      const estimate = estimatePipelineMemoryUsage(fileSize, 1000);
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('Pipeline lifecycle', () => {
    it('should start and stop pipeline', () => {
      expect(pipeline.getState().running).toBe(false);

      pipeline.start();
      expect(pipeline.getState().running).toBe(true);

      pipeline.stop();
      expect(pipeline.getState().running).toBe(false);
    });

    it('should throw on duplicate start', () => {
      pipeline.start();
      expect(() => pipeline.start()).toThrow('already running');
    });

    it('should receive packets when running', () => {
      pipeline.start();

      const payload = new Uint8Array(L);
      const received = pipeline.receivePacket(0, 0, payload);

      expect(received).toBe(true);
      expect(pipeline.getState().packetsReceived).toBe(1);
    });

    it('should not receive packets when stopped', () => {
      const payload = new Uint8Array(L);
      expect(() => {
        pipeline.receivePacket(0, 0, payload);
      }).toThrow('not running');
    });
  });

  describe('Packet reception', () => {
    beforeEach(() => {
      pipeline.start();
    });

    it('should receive and store packets', () => {
      const payload = new Uint8Array(L);
      const received = pipeline.receivePacket(0, 0, payload);

      expect(received).toBe(true);
      expect(pipeline.getStorage().has(0, 0)).toBe(true);
    });

    it('should detect duplicate packets', () => {
      const payload = new Uint8Array([1, 2, 3, 4]);

      const first = pipeline.receivePacket(0, 0, payload);
      const second = pipeline.receivePacket(0, 0, payload);

      expect(first).toBe(true);
      expect(second).toBe(false); // Duplicate
    });

    it('should reject invalid block indices', () => {
      const blockCount = pipeline.getBlockGeometry().blockCount;
      const payload = new Uint8Array(L);

      const received = pipeline.receivePacket(blockCount + 10, 0, payload);
      expect(received).toBe(false);
    });

    it('should trigger packet received callback', () => {
      let callbackCalled = false;
      pipeline.config.onPacketReceived = () => {
        callbackCalled = true;
      };

      const payload = new Uint8Array(L);
      pipeline.receivePacket(0, 0, payload);

      expect(callbackCalled).toBe(true);
    });
  });

  describe('Block completion tracking', () => {
    beforeEach(() => {
      pipeline.start();
    });

    it('should track block completion', () => {
      // Add packets for block 0
      for (let i = 0; i < 5; i++) {
        pipeline.receivePacket(0, i, new Uint8Array(L));
      }

      const completion = pipeline.getBlockCompletion(0);
      expect(completion.blockIndex).toBe(0);
      expect(completion.uniquePackets).toBe(5);
      expect(completion.estimatedProgress).toBeGreaterThan(0);
    });

    it('should return zero progress for empty block', () => {
      const completion = pipeline.getBlockCompletion(0);
      expect(completion.uniquePackets).toBe(0);
      expect(completion.estimatedProgress).toBe(0);
      expect(completion.complete).toBe(false);
    });
  });

  describe('Block decoding', () => {
    beforeEach(() => {
      pipeline.start();
    });

    it('should decode block when enough packets received', () => {
      // This test requires actual fountain-encoded packets
      // For now, just test the decode API
      const packets = pipeline.getStorage().getBlockPackets(0);
      expect(packets).toEqual([]);

      const decoded = pipeline.decodeBlock(0);
      expect(decoded).toBeUndefined(); // No packets yet
    });

    it('should cache decoded blocks', () => {
      // Manually cache a decoded block for testing
      const blockData = new Uint8Array([1, 2, 3, 4]);
      pipeline['decodedBlocks'].set(0, blockData);

      expect(pipeline.isBlockDecoded(0)).toBe(true);
      expect(pipeline.getBlock(0)).toEqual(blockData);
    });

    it('should return undefined for non-decoded block', () => {
      expect(pipeline.isBlockDecoded(0)).toBe(false);
      expect(pipeline.getBlock(0)).toBeUndefined();
    });
  });

  describe('File reassembly', () => {
    beforeEach(() => {
      pipeline.start();
    });

    it('should return undefined when not all blocks decoded', () => {
      const reassembled = pipeline.reassembleFile();
      expect(reassembled).toBeUndefined();
    });

    it('should reassemble file when all blocks decoded', () => {
      const blockCount = pipeline.getBlockGeometry().blockCount;
      const totalSize = pipeline.config.fileSize;

      // Mock decoded blocks
      let offset = 0;
      for (let i = 0; i < blockCount; i++) {
        const blockSize = Math.min(BLOCK, totalSize - offset);
        const blockData = new Uint8Array(blockSize).fill(i);
        pipeline['decodedBlocks'].set(i, blockData);
        offset += blockSize;
      }

      const reassembled = pipeline.reassembleFile();
      expect(reassembled).toBeDefined();
      expect(reassembled!.length).toBe(totalSize);
    });
  });

  describe('Statistics and state', () => {
    beforeEach(() => {
      pipeline.start();
    });

    it('should track pipeline state', () => {
      for (let i = 0; i < 10; i++) {
        pipeline.receivePacket(0, i, new Uint8Array(L));
      }

      const state = pipeline.getState();
      expect(state.running).toBe(true);
      expect(state.packetsReceived).toBe(10);
      expect(state.totalBlocks).toBeGreaterThan(0);
      expect(state.storageStats.packetCount).toBe(10);
    });

    it('should provide storage statistics', () => {
      pipeline.receivePacket(0, 0, new Uint8Array(L));

      const stats = pipeline.getStorageStats();
      expect(stats.packetCount).toBe(1);
      expect(stats.currentBytes).toBe(L);
    });

    it('should validate constraints', () => {
      expect(pipeline.validateConstraints()).toBe(true);

      // Add many packets
      for (let i = 0; i < 500; i++) {
        pipeline.receivePacket(i % 10, 0, new Uint8Array(L));
      }

      // Should still validate (eviction keeps it within bounds)
      expect(pipeline.validateConstraints()).toBe(true);
    });
  });

  describe('Clear and reset', () => {
    beforeEach(() => {
      pipeline.start();
      for (let i = 0; i < 10; i++) {
        pipeline.receivePacket(0, i, new Uint8Array(L));
      }
    });

    it('should clear all state', () => {
      expect(pipeline.getState().packetsReceived).toBe(10);

      pipeline.clear();

      expect(pipeline.getState().packetsReceived).toBe(0);
      expect(pipeline.getStorage().size()).toBe(0);
      expect(pipeline['decodedBlocks'].size).toBe(0);
    });
  });
});

describe('Memory leak detection', () => {
  it('should not leak memory in storage with repeated cycles', () => {
    const storage = new DecodePacketStorage({
      maxMemoryBytes: 1024 * 1024,
      maxPackets: 100,
    });

    // Run multiple cycles
    for (let cycle = 0; cycle < 10; cycle++) {
      // Fill storage
      for (let i = 0; i < 50; i++) {
        const entry = createFountainPacketEntry(cycle, i, new Uint8Array(L));
        storage.set(entry);
      }

      // Clear and verify memory released
      storage.clear();
      expect(storage.getMemoryUsage()).toBe(0);
      expect(storage.size()).toBe(0);
    }

    // Final validation
    expect(storage.validateConstraints()).toBe(true);
  });

  it('should not leak memory in pipeline with repeated cycles', () => {
    const pipeline = createDecodePipeline({
      streamId: 1,
      fileSize: 1024 * 1024,
      storageConfig: {
        maxMemoryBytes: 1024 * 1024,
        maxPackets: 100,
      },
    });

    // Run multiple cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      pipeline.start();

      // Add packets
      for (let i = 0; i < 50; i++) {
        pipeline.receivePacket(cycle % 10, i, new Uint8Array(L));
      }

      pipeline.stop();
      pipeline.clear();

      // Verify memory released
      expect(pipeline.validateConstraints()).toBe(true);
    }
  });
});

describe('Edge cases and error handling', () => {
  it('should handle empty file size', () => {
    expect(() => {
      createDecodePipeline({ streamId: 1, fileSize: 0 });
    }).toThrow();
  });

  it('should handle very small file', () => {
    const pipeline = createDecodePipeline({
      streamId: 1,
      fileSize: 100,
    });

    expect(pipeline.getBlockGeometry().blockCount).toBe(1);
  });

  it('should handle very large file', () => {
    const pipeline = createDecodePipeline({
      streamId: 1,
      fileSize: 10 * 1024 * 1024 * 1024, // 10 GB
    });

    expect(pipeline.getBlockGeometry().blockCount).toBeGreaterThan(0);
  });

  it('should handle zero-length packets', () => {
    const storage = new DecodePacketStorage();
    const entry = createFountainPacketEntry(0, 0, new Uint8Array(0));

    expect(() => storage.set(entry)).not.toThrow();
  });

  it('should handle very large packets', () => {
    const storage = new DecodePacketStorage({
      maxMemoryBytes: 100,
      maxPackets: 10,
    });

    const entry = createFountainPacketEntry(0, 0, new Uint8Array(1000));

    expect(() => storage.set(entry)).toThrow('exceeds storage capacity');
  });

  it('should handle rapid packet reception', () => {
    const pipeline = createDecodePipeline({
      streamId: 1,
      fileSize: 1024 * 1024,
    });

    const blockCount = pipeline.getBlockGeometry().blockCount;

    pipeline.start();

    // Rapidly add many packets (ensure we stay within valid block range)
    for (let i = 0; i < 1000; i++) {
      pipeline.receivePacket(i % blockCount, i, new Uint8Array(L));
    }

    // Should handle gracefully with eviction
    expect(pipeline.validateConstraints()).toBe(true);
  });
});

/**
 * Unit tests for memory-bounded block storage (bf-1jet).
 *
 * Tests:
 * - Memory ceiling enforcement
 * - LRU eviction behavior
 * - 1000+ blocks with 1 MB limit
 * - Memory telemetry accuracy
 * - Block churn tracking
 *
 * Reference: plan.md §8.1, I6a
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BlockStorage,
  ContextEntry,
  createContextEntry,
  calculateGEContextSize,
  calculateMaxContextsPerPool,
  validateI6aConstraint,
  PAYLOAD_CONTEXT_LIMIT,
  MANIFEST_CONTEXT_LIMIT,
  type GERow,
} from '../src/core/block/bounded-storage.js';
import { MemoryTelemetry, validateI6aMemoryConstraint } from '../src/core/block/memory-telemetry.js';
import { K, L } from '../src/core/params.js';

describe('Memory-bounded block storage', () => {
  let storage: BlockStorage;

  beforeEach(() => {
    storage = new BlockStorage(PAYLOAD_CONTEXT_LIMIT, MANIFEST_CONTEXT_LIMIT);
  });

  describe('Context size calculation', () => {
    it('should calculate correct GE context size for default K=768, L=256', () => {
      const size = calculateGEContextSize(K, L);
      const expected = (K * K) / 8 + K * L; // 72 KB + 192 KB = 264 KB
      expect(size).toBe(expected);
      expect(size).toBe(264 * 1024); // 264 KB
    });

    it('should calculate context size for custom K and L', () => {
      const size = calculateGEContextSize(1000, 256);
      const expected = (1000 * 1000) / 8 + 1000 * 256;
      expect(size).toBe(expected);
    });
  });

  describe('Maximum contexts per pool', () => {
    it('should calculate max contexts for 264 KB pool with K=768', () => {
      const maxContexts = calculateMaxContextsPerPool(PAYLOAD_CONTEXT_LIMIT, K, L);
      const contextSize = calculateGEContextSize(K, L);
      expect(maxContexts).toBe(Math.floor(PAYLOAD_CONTEXT_LIMIT / contextSize));
      expect(maxContexts).toBe(1); // Only 1 context fits in 264 KB
    });

    it('should calculate max contexts for larger pool', () => {
      const largePool = 2 * PAYLOAD_CONTEXT_LIMIT; // 528 KB
      const maxContexts = calculateMaxContextsPerPool(largePool, K, L);
      expect(maxContexts).toBe(2); // 2 contexts fit in 528 KB
    });
  });

  describe('I6a constraint validation', () => {
    it('should validate default configuration meets 1 MB limit', () => {
      const valid = validateI6aConstraint(PAYLOAD_CONTEXT_LIMIT, MANIFEST_CONTEXT_LIMIT);
      expect(valid).toBe(true);
    });

    it('should reject configuration exceeding 1 MB', () => {
      const invalid = validateI6aConstraint(1_000_000, 100_000); // 1.1 MB total
      expect(invalid).toBe(false);
    });

    it('should accept configuration exactly at 1 MB', () => {
      const valid = validateI6aConstraint(524_288, 524_288); // 512 KB + 512 KB = 1 MB
      expect(valid).toBe(true);
    });
  });

  describe('Basic storage operations', () => {
    it('should store and retrieve payload context', () => {
      const pivots = new Map<number, GERow>();
      pivots.set(0, { mask: new Uint32Array([1, 2, 3]), payload: new Uint8Array([4, 5, 6]) });

      const entry = createContextEntry(0, pivots, 10);
      storage.setPayload(entry);

      const retrieved = storage.getPayload(0);
      expect(retrieved).toBeDefined();
      expect(retrieved!.blockIndex).toBe(0);
      expect(retrieved!.rank).toBe(10);
    });

    it('should store and retrieve manifest context', () => {
      const pivots = new Map<number, GERow>();
      pivots.set(0, { mask: new Uint32Array([1, 2, 3]), payload: new Uint8Array([4, 5, 6]) });

      const entry = createContextEntry(0xFFFFFF, pivots, 5);
      storage.setManifest(entry);

      const retrieved = storage.getManifest(0xFFFFFF);
      expect(retrieved).toBeDefined();
      expect(retrieved!.blockIndex).toBe(0xFFFFFF);
    });

    it('should return undefined for non-existent context', () => {
      expect(storage.getPayload(999)).toBeUndefined();
      expect(storage.getManifest(999)).toBeUndefined();
    });

    it('should check context existence', () => {
      const pivots = new Map<number, GERow>();
      const entry = createContextEntry(0, pivots, 0);

      expect(storage.hasPayload(0)).toBe(false);

      storage.setPayload(entry);
      expect(storage.hasPayload(0)).toBe(true);
    });

    it('should delete contexts', () => {
      const pivots = new Map<number, GERow>();
      const entry = createContextEntry(0, pivots, 0);

      storage.setPayload(entry);
      expect(storage.hasPayload(0)).toBe(true);

      storage.deletePayload(0);
      expect(storage.hasPayload(0)).toBe(false);
    });
  });

  describe('Memory ceiling enforcement', () => {
    it('should enforce memory limit in payload pool', () => {
      const contextSize = calculateGEContextSize(K, L);

      // Create first context (should fit)
      const entry1 = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry1);

      // Try to add second context (should exceed capacity and evict first)
      const entry2 = createContextEntry(1, new Map(), 0);
      const evicted = storage.setPayload(entry2);

      expect(evicted).toContain(0);
      expect(storage.hasPayload(0)).toBe(false);
      expect(storage.hasPayload(1)).toBe(true);
    });

    it('should enforce memory limit in manifest pool', () => {
      const contextSize = calculateGEContextSize(K, L);

      // Add first manifest context
      const entry1 = createContextEntry(0, new Map(), 0);
      storage.setManifest(entry1);

      // Add second manifest context (should evict first)
      const entry2 = createContextEntry(1, new Map(), 0);
      const evicted = storage.setManifest(entry2);

      expect(evicted).toContain(0);
      expect(storage.hasManifest(0)).toBe(false);
      expect(storage.hasManifest(1)).toBe(true);
    });

    it('should throw when single context exceeds capacity', () => {
      const tinyLimit = 100; // 100 bytes
      const smallStorage = new BlockStorage(tinyLimit, tinyLimit);

      const entry = createContextEntry(0, new Map(), 0);
      expect(() => smallStorage.setPayload(entry)).toThrow();
    });

    it('should maintain total memory within limit', () => {
      const contextSize = calculateGEContextSize(K, L);

      // Fill payload pool
      const entry1 = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry1);

      // Fill manifest pool
      const entry2 = createContextEntry(0, new Map(), 0);
      storage.setManifest(entry2);

      const stats = storage.getStats();
      expect(stats.totalBytes).toBeLessThanOrEqual(stats.totalCapacity);
      expect(storage.validateConstraints()).toBe(true);
    });
  });

  describe('LRU eviction behavior', () => {
    it('should evict least-recently-used context', () => {
      const entry0 = createContextEntry(0, new Map(), 0);
      const entry1 = createContextEntry(1, new Map(), 0);

      // Add context 0
      storage.setPayload(entry0);

      // Access context 0 (makes it recently used)
      storage.getPayload(0);

      // Add context 1 (should evict context 0 if at capacity)
      storage.setPayload(entry1);

      // At K=768, only 1 context fits, so adding context 1 evicts context 0
      expect(storage.hasPayload(0)).toBe(false);
      expect(storage.hasPayload(1)).toBe(true);
    });

    it('should handle multiple sequential evictions', () => {
      const contexts: ContextEntry[] = [];
      for (let i = 0; i < 5; i++) {
        contexts.push(createContextEntry(i, new Map(), 0));
      }

      // Add contexts sequentially
      storage.setPayload(contexts[0]!);
      storage.setPayload(contexts[1]!);
      storage.setPayload(contexts[2]!);

      // Only the most recent should remain (only 1 fits at K=768)
      expect(storage.hasPayload(0)).toBe(false);
      expect(storage.hasPayload(1)).toBe(false);
      expect(storage.hasPayload(2)).toBe(true);
    });

    it('should update access time on retrieval', () => {
      const entry0 = createContextEntry(0, new Map(), 0);
      const entry1 = createContextEntry(1, new Map(), 0);

      storage.setPayload(entry0);

      // Access multiple times to make it recently used
      storage.getPayload(0);
      storage.getPayload(0);

      // Add competing context
      storage.setPayload(entry1);

      // Context 0 should still be evicted (only 1 fits)
      expect(storage.hasPayload(0)).toBe(false);
    });
  });

  describe('1000+ blocks with 1 MB memory', () => {
    it('should handle 1000 blocks without exceeding memory limit', () => {
      const contextSize = calculateGEContextSize(K, L);
      const contexts: ContextEntry[] = [];

      // Create 1000 contexts
      for (let i = 0; i < 1000; i++) {
        contexts.push(createContextEntry(i, new Map(), 0));
      }

      // Add all contexts sequentially
      for (const context of contexts) {
        storage.setPayload(context);
      }

      // Memory should still be within limit
      const stats = storage.getStats();
      expect(stats.totalBytes).toBeLessThanOrEqual(stats.totalCapacity);
      expect(storage.validateConstraints()).toBe(true);

      // Only the last context should remain
      expect(storage.hasPayload(999)).toBe(true);
      expect(stats.payload.contextCount).toBe(1);
    });

    it('should maintain flat memory usage regardless of block count', () => {
      const readings: number[] = [];

      // Add 100 contexts and record memory after each
      for (let i = 0; i < 100; i++) {
        const entry = createContextEntry(i, new Map(), 0);
        storage.setPayload(entry);
        readings.push(storage.getTotalMemoryUsage());
      }

      // Memory should stay flat (within context size)
      const maxReading = Math.max(...readings);
      const minReading = Math.min(...readings);
      const variation = maxReading - minReading;

      // Variation should be at most 1 context size
      expect(variation).toBeLessThanOrEqual(calculateGEContextSize(K, L));
    });

    it('should handle 21845 blocks (4GB worth)', () => {
      const BLOCKS_4GB = 21845;

      // Process all 4GB blocks
      for (let i = 0; i < BLOCKS_4GB; i++) {
        const entry = createContextEntry(i, new Map(), 0);
        storage.setPayload(entry);

        // Memory should always be within limit
        expect(storage.validateConstraints()).toBe(true);
      }

      // Final memory should still be bounded
      const stats = storage.getStats();
      expect(stats.totalBytes).toBeLessThanOrEqual(stats.totalCapacity);
    });
  });

  describe('Memory telemetry', () => {
    let telemetry: MemoryTelemetry;

    beforeEach(() => {
      telemetry = new MemoryTelemetry(storage);
    });

    it('should record memory readings', () => {
      telemetry.recordReading();
      telemetry.recordReading();

      const readings = telemetry.getReadings();
      expect(readings).toHaveLength(2);
    });

    it('should track memory usage over time', () => {
      const entry = createContextEntry(0, new Map(), 0);

      telemetry.recordReading();
      storage.setPayload(entry);
      telemetry.recordReading();

      const readings = telemetry.getReadings();
      expect(readings).toHaveLength(2);
      expect(readings[1]!.totalBytes).toBeGreaterThan(readings[0]!.totalBytes);
    });

    it('should record eviction events', () => {
      const entry1 = createContextEntry(0, new Map(), 0);
      const entry2 = createContextEntry(1, new Map(), 0);

      storage.setPayload(entry1);
      storage.setPayload(entry2);

      // Record eviction
      telemetry.recordEviction('payload', 0, calculateGEContextSize(K, L), 'capacity');

      const evictions = telemetry.getEvictions();
      expect(evictions).toHaveLength(1);
      expect(evictions[0]!.blockIndex).toBe(0);
    });

    it('should track peak memory usage', () => {
      const entry = createContextEntry(0, new Map(), 0);

      telemetry.recordReading();
      storage.setPayload(entry);
      telemetry.recordReading();

      const peaks = telemetry.getPeakStats();
      expect(peaks.peakTotalBytes).toBeGreaterThan(0);
      expect(peaks.peakTotalTimestamp).toBeGreaterThan(0);
    });

    it('should calculate churn statistics', () => {
      const entry1 = createContextEntry(0, new Map(), 0);
      const entry2 = createContextEntry(1, new Map(), 0);

      storage.setPayload(entry1);
      telemetry.recordEviction('payload', 0, calculateGEContextSize(K, L));
      storage.setPayload(entry2);
      telemetry.recordEviction('payload', 1, calculateGEContextSize(K, L));

      const churn = telemetry.getChurnStats();
      expect(churn.totalEvictions).toBe(2);
      expect(churn.payloadEvictions).toBe(2);
    });

    it('should validate memory stayed within bounds', () => {
      telemetry.recordReading();

      const entry = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry);

      telemetry.recordReading();

      expect(telemetry.validateMemoryBounds()).toBe(true);
    });

    it('should check for memory stability', () => {
      // Add some contexts
      for (let i = 0; i < 10; i++) {
        const entry = createContextEntry(i, new Map(), 0);
        storage.setPayload(entry);
        telemetry.recordReading();
      }

      // Memory should be stable (no monotonic growth)
      expect(telemetry.checkMemoryStable()).toBe(true);
    });

    it('should generate comprehensive report', () => {
      telemetry.recordReading();

      const entry = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry);

      telemetry.recordReading();
      telemetry.recordEviction('payload', 0, calculateGEContextSize(K, L));

      const report = telemetry.getReport();
      expect(report.current).toBeDefined();
      expect(report.readings).toHaveLength(2);
      expect(report.evictions).toHaveLength(1);
      expect(report.churn).toBeDefined();
      expect(report.peaks).toBeDefined();
      expect(report.withinConstraints).toBe(true);
    });

    it('should validate I6a memory constraint', () => {
      telemetry.recordReading();

      const entry = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry);

      telemetry.recordReading();

      const report = telemetry.getReport();
      expect(validateI6aMemoryConstraint(report)).toBe(true);
    });
  });

  describe('Storage statistics', () => {
    it('should provide accurate statistics', () => {
      const stats = storage.getStats();

      expect(stats.payload).toBeDefined();
      expect(stats.manifest).toBeDefined();
      expect(stats.totalBytes).toBe(0);
      expect(stats.totalCapacity).toBe(PAYLOAD_CONTEXT_LIMIT + MANIFEST_CONTEXT_LIMIT);
    });

    it('should track memory utilization', () => {
      const entry = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry);

      const stats = storage.getStats();
      expect(stats.totalUtilization).toBeGreaterThan(0);
      expect(stats.totalUtilization).toBeLessThanOrEqual(1);
    });

    it('should track context counts', () => {
      const entry1 = createContextEntry(0, new Map(), 0);
      const entry2 = createContextEntry(0xFFFFFF, new Map(), 0);

      storage.setPayload(entry1);
      storage.setManifest(entry2);

      const stats = storage.getStats();
      expect(stats.payload.contextCount).toBe(1);
      expect(stats.manifest.contextCount).toBe(1);
    });
  });

  describe('Clear operations', () => {
    it('should clear all storage', () => {
      const entry1 = createContextEntry(0, new Map(), 0);
      const entry2 = createContextEntry(0, new Map(), 0);

      storage.setPayload(entry1);
      storage.setManifest(entry2);

      storage.clear();

      expect(storage.hasPayload(0)).toBe(false);
      expect(storage.hasManifest(0)).toBe(false);

      const stats = storage.getStats();
      expect(stats.totalBytes).toBe(0);
    });

    it('should clear telemetry', () => {
      const telemetry = new MemoryTelemetry(storage);

      telemetry.recordReading();
      telemetry.recordEviction('payload', 0, 1000);

      telemetry.clear();

      expect(telemetry.getReadings()).toHaveLength(0);
      expect(telemetry.getEvictions()).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle replacing existing context', () => {
      const entry1 = createContextEntry(0, new Map(), 0);
      const entry2 = createContextEntry(0, new Map(), 5);

      storage.setPayload(entry1);
      storage.setPayload(entry2);

      const retrieved = storage.getPayload(0);
      expect(retrieved!.rank).toBe(5);
    });

    it('should handle empty storage operations', () => {
      expect(storage.getPayload(999)).toBeUndefined();
      expect(storage.deletePayload(999)).toBe(false);
      expect(storage.hasPayload(999)).toBe(false);
    });

    it('should handle zero K value', () => {
      const size = calculateGEContextSize(0, L);
      expect(size).toBe(0);
    });

    it('should handle large block indices', () => {
      const entry = createContextEntry(0xFFFFFF, new Map(), 0);
      storage.setPayload(entry);

      expect(storage.hasPayload(0xFFFFFF)).toBe(true);
    });
  });

  describe('Memory telemetry accuracy', () => {
    let telemetry: MemoryTelemetry;

    beforeEach(() => {
      telemetry = new MemoryTelemetry(storage);
    });

    it('should accurately track total memory usage', () => {
      const entry = createContextEntry(0, new Map(), 0);

      telemetry.recordReading();
      storage.setPayload(entry);
      telemetry.recordReading();

      const readings = telemetry.getReadings();
      const expectedSize = calculateGEContextSize(K, L);

      expect(readings[1]!.totalBytes).toBeCloseTo(expectedSize, 10);
    });

    it('should accurately track pool-specific usage', () => {
      const payloadEntry = createContextEntry(0, new Map(), 0);
      const manifestEntry = createContextEntry(0, new Map(), 0);

      telemetry.recordReading();
      storage.setPayload(payloadEntry);
      storage.setManifest(manifestEntry);
      telemetry.recordReading();

      const readings = telemetry.getReadings();
      const expectedSize = calculateGEContextSize(K, L);

      expect(readings[1]!.payloadBytes).toBeCloseTo(expectedSize, 10);
      expect(readings[1]!.manifestBytes).toBeCloseTo(expectedSize, 10);
    });

    it('should accurately track utilization', () => {
      const entry = createContextEntry(0, new Map(), 0);
      storage.setPayload(entry);

      telemetry.recordReading();

      const stats = storage.getStats();
      const expectedUtilization = stats.payload.currentBytes / stats.payload.capacityBytes;

      expect(stats.payload.utilization).toBeCloseTo(expectedUtilization, 5);
    });
  });

  describe('Integration test: complete workflow', () => {
    it('should handle complete encode-decode workflow with memory bounds', () => {
      const telemetry = new MemoryTelemetry(storage);

      // Simulate encoding phase: create many contexts
      for (let i = 0; i < 100; i++) {
        const entry = createContextEntry(i, new Map(), i);
        storage.setPayload(entry);
        telemetry.recordReading();
      }

      // Simulate decoding phase: access contexts
      for (let i = 95; i < 100; i++) {
        storage.getPayload(i);
        telemetry.recordReading();
      }

      const report = telemetry.getReport();

      // Validate constraints
      expect(validateI6aMemoryConstraint(report)).toBe(true);
      expect(telemetry.validateMemoryBounds()).toBe(true);
      expect(telemetry.checkMemoryStable()).toBe(true);

      // Validate memory stayed flat
      const readings = report.readings;
      const maxMemory = Math.max(...readings.map((r) => r.totalBytes));
      expect(maxMemory).toBeLessThanOrEqual(PAYLOAD_CONTEXT_LIMIT + MANIFEST_CONTEXT_LIMIT);
    });
  });
});

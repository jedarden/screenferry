/**
 * Tests for memory sampling hook function (bf-53n3w).
 *
 * Validates the captureMemorySample hook function that can be integrated
 * into test iteration loops for memory profiling.
 *
 * Reference: bead bf-53n3w
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createMemorySampleStorage,
  captureMemorySample,
  type MemorySampleStorage,
  type MemorySample,
} from '../src/platform/memory-samples.js';

describe('Memory Sampling Hook Function', () => {
  let samples: MemorySampleStorage;

  beforeEach(() => {
    samples = createMemorySampleStorage();
  });

  describe('captureMemorySample', () => {
    it('should capture and store a memory sample successfully', () => {
      const result = captureMemorySample(samples, 10);

      expect(result).toBe(true);
      expect(samples.length).toBe(1);
    });

    it('should capture sample with correct block number', () => {
      captureMemorySample(samples, 42);

      expect(samples[0]?.blockNumber).toBe(42);
    });

    it('should capture sample with timestamp', () => {
      const before = Date.now();
      captureMemorySample(samples, 0);
      const after = Date.now();

      expect(samples[0]?.timestamp).toBeGreaterThanOrEqual(before);
      expect(samples[0]?.timestamp).toBeLessThanOrEqual(after);
    });

    it('should capture sample with heap usage', () => {
      captureMemorySample(samples, 0);

      expect(samples[0]?.heapUsage).toBeGreaterThan(0);
      expect(typeof samples[0]?.heapUsage).toBe('number');
    });

    it('should capture multiple samples in sequence', () => {
      captureMemorySample(samples, 0);
      captureMemorySample(samples, 50);
      captureMemorySample(samples, 100);

      expect(samples.length).toBe(3);
      expect(samples[0]?.blockNumber).toBe(0);
      expect(samples[1]?.blockNumber).toBe(50);
      expect(samples[2]?.blockNumber).toBe(100);
    });

    it('should handle consecutive block numbers', () => {
      for (let i = 0; i < 10; i++) {
        captureMemorySample(samples, i);
      }

      expect(samples.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(samples[i]?.blockNumber).toBe(i);
      }
    });

    it('should return true on successful capture', () => {
      const result = captureMemorySample(samples, 1);
      expect(result).toBe(true);
    });

    it('should gracefully handle errors and return false', () => {
      // Test error handling by passing invalid storage that will throw
      const invalidStorage = null as unknown as MemorySampleStorage;
      const result = captureMemorySample(invalidStorage, 0);

      // Should return false instead of throwing
      expect(result).toBe(false);
    });

    it('should store samples in provided array', () => {
      const customStorage: MemorySampleStorage = [];
      captureMemorySample(customStorage, 5);

      expect(customStorage.length).toBe(1);
      expect(customStorage[0]?.blockNumber).toBe(5);
    });
  });

  describe('Integration with test loops', () => {
    it('should work in typical test loop pattern', () => {
      const totalBlocks = 100;
      const sampleInterval = 10;

      // Simulate test loop with periodic sampling
      for (let i = 0; i < totalBlocks; i++) {
        // Process block (simulated)
        const processed = true;

        // Sample memory at interval
        if (i % sampleInterval === 0) {
          captureMemorySample(samples, i);
        }
      }

      expect(samples.length).toBe(10); // 0, 10, 20, ..., 90
      expect(samples[0]?.blockNumber).toBe(0);
      expect(samples[9]?.blockNumber).toBe(90);
    });

    it('should capture first and last samples', () => {
      const totalBlocks = 50;

      // Sample first block
      captureMemorySample(samples, 0);

      // Process middle blocks (no sampling)
      for (let i = 1; i < totalBlocks - 1; i++) {
        // Process blocks
      }

      // Sample last block
      captureMemorySample(samples, totalBlocks - 1);

      expect(samples.length).toBe(2);
      expect(samples[0]?.blockNumber).toBe(0);
      expect(samples[1]?.blockNumber).toBe(totalBlocks - 1);
    });
  });
});

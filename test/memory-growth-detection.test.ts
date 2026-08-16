/**
 * Tests for memory growth detection (bf-e3vfs).
 *
 * Validates monotonic growth detection algorithms for identifying
 * potential memory leaks from collected memory samples.
 *
 * Reference: bead bf-e3vfs
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  createMemorySampleStorage,
  addMemorySample,
  createMemorySample,
  detectMonotonicGrowth,
  calculateGrowthRate,
  getDefaultGrowthThresholds,
  type GrowthDetectionResult,
  type GrowthThresholdConfig,
  type MemorySampleStorage,
} from '../src/platform/memory-samples.js';
import { MemorySamplingHelper, createMemorySamplingHelper } from '../test/helpers/memory-sampling-helpers.js';

describe('Memory Growth Detection', () => {
  let samples: MemorySampleStorage;

  beforeEach(() => {
    samples = createMemorySampleStorage();
  });

  describe('detectMonotonicGrowth', () => {
    it('should return no growth for empty storage', () => {
      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(false);
      expect(result.exceedsThreshold).toBe(false);
      expect(result.message).toContain('Insufficient samples');
    });

    it('should return no growth for insufficient samples', () => {
      // Only 2 samples (default min is 3)
      addMemorySample(samples, createMemorySample(0, 1000000));
      addMemorySample(samples, createMemorySample(100, 1005000));

      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(false);
      expect(result.exceedsThreshold).toBe(false);
      expect(result.message).toContain('Insufficient samples');
    });

    it('should detect monotonic growth pattern', () => {
      // Create samples with consistent growth
      const baseHeap = 1000000; // 1MB
      const growthPerBlock = 1000; // 1KB per block

      for (let i = 0; i < 10; i++) {
        const heapUsage = baseHeap + i * growthPerBlock * 10;
        addMemorySample(samples, createMemorySample(i * 10, heapUsage));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(true);
      expect(result.slope).toBeGreaterThan(0);
      expect(result.rSquared).toBeGreaterThan(0.7);
      expect(result.sampleCount).toBe(10);
    });

    it('should detect no growth for stable memory', () => {
      // Create samples with stable memory usage
      const stableHeap = 1000000; // 1MB

      for (let i = 0; i < 10; i++) {
        // Add small random fluctuations around stable value
        const noise = Math.random() * 10000 - 5000; // ±5KB noise
        addMemorySample(samples, createMemorySample(i * 10, stableHeap + noise));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(false);
      expect(Math.abs(result.slope)).toBeLessThan(500); // Very small slope
    });

    it('should calculate growth rate correctly', () => {
      // Create samples with known growth rate: 1KB per block
      const baseHeap = 1000000;

      addMemorySample(samples, createMemorySample(0, baseHeap));
      addMemorySample(samples, createMemorySample(10, baseHeap + 10000));
      addMemorySample(samples, createMemorySample(20, baseHeap + 20000));
      addMemorySample(samples, createMemorySample(30, baseHeap + 30000));
      addMemorySample(samples, createMemorySample(40, baseHeap + 40000));

      const result = detectMonotonicGrowth(samples);

      expect(result.growthRate).toBeCloseTo(1000, 100); // ~1KB per block
      expect(result.totalGrowth).toBe(40000); // 40KB total growth
    });

    it('should flag excessive growth', () => {
      // Create samples with growth exceeding default threshold
      // Default threshold: 1024 bytes/block
      const baseHeap = 1000000;
      const growthPerBlock = 2000; // 2KB per block (exceeds 1KB threshold)

      for (let i = 0; i < 10; i++) {
        const heapUsage = baseHeap + i * growthPerBlock * 10;
        addMemorySample(samples, createMemorySample(i * 10, heapUsage));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(true);
      expect(result.exceedsThreshold).toBe(true);
      expect(result.message).toContain('Monotonic growth detected');
    });

    it('should use custom thresholds when provided', () => {
      const customThresholds: GrowthThresholdConfig = {
        maxGrowthRate: 5000, // 5KB per block
        maxGrowthPercent: 100, // 100% growth
        minSamples: 5,
      };

      // Create samples with growth that exceeds default but not custom
      const baseHeap = 1000000;
      const growthPerBlock = 2000; // 2KB per block

      for (let i = 0; i < 10; i++) {
        const heapUsage = baseHeap + i * growthPerBlock * 10;
        addMemorySample(samples, createMemorySample(i * 10, heapUsage));
      }

      const result = detectMonotonicGrowth(samples, customThresholds);

      expect(result.hasMonotonicGrowth).toBe(true);
      expect(result.exceedsThreshold).toBe(false); // Within custom threshold
    });

    it('should calculate growth percentage correctly', () => {
      // Start with 10MB, grow to 15MB (50% growth)
      const baseHeap = 10 * 1024 * 1024; // 10MB

      addMemorySample(samples, createMemorySample(0, baseHeap));
      addMemorySample(samples, createMemorySample(100, baseHeap * 1.5));

      // Need more samples for analysis
      for (let i = 2; i < 5; i++) {
        const heapUsage = baseHeap * (1 + 0.5 * (i / 4));
        addMemorySample(samples, createMemorySample(i * 25, heapUsage));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.growthRatePercent).toBeCloseTo(50, 5); // ~50% growth
    });

    it('should handle noisy data with R-squared filtering', () => {
      // Create samples with high variance (low R-squared)
      const baseHeap = 1000000;

      for (let i = 0; i < 10; i++) {
        // Large random noise that obscures trend
        const noise = Math.random() * 500000 - 250000;
        const heapUsage = baseHeap + i * 1000 + noise;
        addMemorySample(samples, createMemorySample(i * 10, heapUsage));
      }

      const result = detectMonotonicGrowth(samples);

      // Should not detect monotonic growth due to low R-squared
      expect(result.rSquared).toBeLessThan(0.7);
      expect(result.hasMonotonicGrowth).toBe(false);
    });

    it('should provide detailed analysis message', () => {
      // Create samples with monotonic growth
      const baseHeap = 1000000;

      for (let i = 0; i < 10; i++) {
        addMemorySample(samples, createMemorySample(i * 10, baseHeap + i * 50000));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.message).toBeDefined();
      expect(result.message.length).toBeGreaterThan(0);
      expect(typeof result.message).toBe('string');
    });
  });

  describe('calculateGrowthRate', () => {
    it('should calculate growth rate between two samples', () => {
      const earlier = createMemorySample(0, 1000000);
      const later = createMemorySample(100, 1005000);

      const rate = calculateGrowthRate(earlier, later);

      expect(rate).toBe(50); // 5000 bytes / 100 blocks = 50 bytes/block
    });

    it('should handle zero block difference', () => {
      const earlier = createMemorySample(0, 1000000);
      const later = createMemorySample(0, 1005000);

      const rate = calculateGrowthRate(earlier, later);

      expect(rate).toBe(0); // No growth rate when block difference is zero
    });

    it('should return negative rate for memory decrease', () => {
      const earlier = createMemorySample(0, 1005000);
      const later = createMemorySample(100, 1000000);

      const rate = calculateGrowthRate(earlier, later);

      expect(rate).toBeLessThan(0);
    });

    it('should return zero for no heap change', () => {
      const heapUsage = 1000000;
      const earlier = createMemorySample(0, heapUsage);
      const later = createMemorySample(100, heapUsage);

      const rate = calculateGrowthRate(earlier, later);

      expect(rate).toBe(0);
    });
  });

  describe('getDefaultGrowthThresholds', () => {
    it('should return default threshold configuration', () => {
      const defaults = getDefaultGrowthThresholds();

      expect(defaults).toHaveProperty('maxGrowthRate');
      expect(defaults).toHaveProperty('maxGrowthPercent');
      expect(defaults).toHaveProperty('minRSquared');
      expect(defaults).toHaveProperty('minSamples');

      expect(defaults.maxGrowthRate).toBe(1024); // 1KB per block
      expect(defaults.maxGrowthPercent).toBe(50); // 50%
      expect(defaults.minRSquared).toBe(0.7);
      expect(defaults.minSamples).toBe(3);
    });
  });

  describe('Growth detection scenarios', () => {
    it('should detect leak in long-running test with consistent growth', () => {
      // Simulate a memory leak scenario
      const baseHeap = 10 * 1024 * 1024; // 10MB
      const leakRate = 5000; // 5KB per block

      // 1000 blocks with sampling every 100 blocks
      for (let block = 0; block <= 1000; block += 100) {
        const leakedMemory = block * leakRate;
        addMemorySample(samples, createMemorySample(block, baseHeap + leakedMemory));
      }

      const result = detectMonotonicGrowth(samples);

      expect(result.hasMonotonicGrowth).toBe(true);
      expect(result.exceedsThreshold).toBe(true); // 5KB/block > 1KB threshold
      expect(result.totalGrowth).toBeGreaterThanOrEqual(4500000); // ~4.5MB+ growth
    });

    it('should not flag normal GC behavior as leak', () => {
      // Simulate normal GC behavior: growth then cleanup
      const baseHeap = 10 * 1024 * 1024; // 10MB

      // Growth phase
      for (let i = 0; i < 5; i++) {
        addMemorySample(samples, createMemorySample(i * 10, baseHeap + i * 100000));
      }

      // GC cleanup phase
      for (let i = 5; i < 10; i++) {
        addMemorySample(samples, createMemorySample(i * 10, baseHeap + (10 - i) * 50000));
      }

      const result = detectMonotonicGrowth(samples);

      // Should not detect monotonic growth due to cleanup
      expect(result.hasMonotonicGrowth).toBe(false);
      expect(result.exceedsThreshold).toBe(false);
    });

    it('should handle sparse sampling gracefully', () => {
      // Only 3 samples at irregular intervals
      addMemorySample(samples, createMemorySample(0, 1000000));
      addMemorySample(samples, createMemorySample(500, 1500000));
      addMemorySample(samples, createMemorySample(1000, 2000000));

      const result = detectMonotonicGrowth(samples);

      expect(result.sampleCount).toBe(3);
      expect(result.hasMonotonicGrowth).toBe(true); // Should work with minimum samples
    });
  });
});

describe('Growth Detection with MemorySamplingHelper', () => {
  it('should integrate growth detection with helper', () => {
    const helper = createMemorySamplingHelper({
      testOptions: {
        enableMemorySampling: true,
        growthThresholds: {
          maxGrowthRate: 2000, // 2KB per block
          maxGrowthPercent: 30, // 30%
        },
      },
      sampleIntervalBlocks: 10,
    });

    // Collect samples with growth
    for (let i = 0; i < 10; i++) {
      helper.sample(i * 10, true);
    }

    const result = helper.detectGrowth();

    expect(result).toHaveProperty('hasMonotonicGrowth');
    expect(result).toHaveProperty('exceedsThreshold');
    expect(result).toHaveProperty('growthRate');
    expect(result).toHaveProperty('message');
  });

  it('should provide convenience method for excessive growth check', () => {
    const helper = createMemorySamplingHelper({
      testOptions: { enableMemorySampling: true },
      sampleIntervalBlocks: 10,
    });

    // No samples - should not flag as excessive
    expect(helper.hasExcessiveGrowth()).toBe(false);

    // Add samples with low growth
    for (let i = 0; i < 5; i++) {
      helper.sample(i * 10, true);
    }

    const hasExcessive = helper.hasExcessiveGrowth();
    expect(typeof hasExcessive).toBe('boolean');
  });
});

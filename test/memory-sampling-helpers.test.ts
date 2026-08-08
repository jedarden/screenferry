/**
 * Tests for memory sampling helpers (bf-1vswx).
 *
 * Validates that conditional memory sampling works correctly based on
 * the enableMemorySampling flag, ensuring no overhead when disabled.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  MemorySamplingHelper,
  createMemorySamplingHelper,
  conditionalCapture,
  shouldSampleAtBlock,
  safeMemorySampling,
} from '../test/helpers/memory-sampling-helpers.js';
import {
  createMemorySampleStorage,
  type MemorySampleStorage,
} from '../src/platform/memory-samples.js';
import type { TestOptions } from '../src/test-options.js';

describe('Memory Sampling Helpers', () => {
  describe('MemorySamplingHelper', () => {
    let helper: MemorySamplingHelper;

    beforeEach(() => {
      helper = createMemorySamplingHelper();
    });

    it('should disable sampling by default', () => {
      expect(helper.isEnabled()).toBe(false);
      expect(helper.getSampleCount()).toBe(0);
    });

    it('should enable sampling when flag is true', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
        sampleIntervalBlocks: 10,
      });

      expect(enabledHelper.isEnabled()).toBe(true);
    });

    it('should not sample when disabled', () => {
      const result = helper.sample(0);

      expect(result.attempted).toBe(false);
      expect(result.success).toBe(false);
      expect(result.sampleCount).toBe(0);
      expect(helper.getSampleCount()).toBe(0);
    });

    it('should sample when enabled at first block', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
        sampleIntervalBlocks: 10,
      });

      const result = enabledHelper.sample(0);

      expect(result.attempted).toBe(true);
      expect(result.success).toBe(true);
      expect(result.sampleCount).toBe(1);
      expect(enabledHelper.getSampleCount()).toBe(1);
    });

    it('should respect sample interval', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
        sampleIntervalBlocks: 5,
      });

      // Sample at block 0
      let result = enabledHelper.sample(0);
      expect(result.success).toBe(true);
      expect(enabledHelper.getSampleCount()).toBe(1);

      // Skip blocks 1-4
      for (let i = 1; i < 5; i++) {
        result = enabledHelper.sample(i);
        expect(result.success).toBe(false);
      }
      expect(enabledHelper.getSampleCount()).toBe(1);

      // Sample at block 5
      result = enabledHelper.sample(5);
      expect(result.success).toBe(true);
      expect(enabledHelper.getSampleCount()).toBe(2);
    });

    it('should force sample when requested', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
        sampleIntervalBlocks: 100,
      });

      // Sample at block 0
      enabledHelper.sample(0);
      expect(enabledHelper.getSampleCount()).toBe(1);

      // Force sample at block 5 (before interval)
      const result = enabledHelper.sample(5, true);
      expect(result.success).toBe(true);
      expect(enabledHelper.getSampleCount()).toBe(2);
    });

    it('should increment block counter', () => {
      helper.incrementBlockCounter();
      helper.incrementBlockCounter();
      helper.incrementBlockCounter();

      // When sampling, it should use the current counter value
      const result = helper.sample(); // No explicit index, uses counter
      expect(result.attempted).toBe(false); // Still disabled
    });

    it('should reset state', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
      });

      enabledHelper.sample(0);
      enabledHelper.sample(100);
      expect(enabledHelper.getSampleCount()).toBe(2);

      enabledHelper.reset();
      expect(enabledHelper.getSampleCount()).toBe(0);
    });

    it('should return collected samples', () => {
      const enabledHelper = createMemorySamplingHelper({
        testOptions: { enableMemorySampling: true },
        sampleIntervalBlocks: 50, // Use smaller interval for test
      });

      enabledHelper.sample(0);
      enabledHelper.sample(50);

      const samples = enabledHelper.getSamples();
      expect(samples).toHaveLength(2);
      expect(samples[0].blockNumber).toBe(0);
      expect(samples[1].blockNumber).toBe(50);
    });
  });

  describe('conditionalCapture', () => {
    it('should return false when sampling is disabled', () => {
      const samples = createMemorySampleStorage();
      const options: TestOptions = { enableMemorySampling: false };

      const result = conditionalCapture(samples, 10, options);

      expect(result).toBe(false);
      expect(samples).toHaveLength(0);
    });

    it('should capture when sampling is enabled', () => {
      const samples = createMemorySampleStorage();
      const options: TestOptions = { enableMemorySampling: true };

      const result = conditionalCapture(samples, 10, options);

      expect(result).toBe(true);
      expect(samples).toHaveLength(1);
      expect(samples[0].blockNumber).toBe(10);
    });

    it('should capture when no options provided (defaults to disabled)', () => {
      const samples = createMemorySampleStorage();

      const result = conditionalCapture(samples, 10);

      // When no options provided, should default to disabled
      expect(result).toBe(false);
      expect(samples).toHaveLength(0);
    });
  });

  describe('shouldSampleAtBlock', () => {
    it('should sample at block 0', () => {
      expect(shouldSampleAtBlock(0, -1, 100)).toBe(true);
    });

    it('should sample at interval', () => {
      expect(shouldSampleAtBlock(100, 0, 100)).toBe(true);
      expect(shouldSampleAtBlock(200, 100, 100)).toBe(true);
    });

    it('should not sample between intervals', () => {
      expect(shouldSampleAtBlock(50, 0, 100)).toBe(false);
      expect(shouldSampleAtBlock(99, 0, 100)).toBe(false);
      expect(shouldSampleAtBlock(150, 100, 100)).toBe(false);
    });

    it('should use default interval of 100', () => {
      expect(shouldSampleAtBlock(100, 0)).toBe(true);
      expect(shouldSampleAtBlock(50, 0)).toBe(false);
    });
  });

  describe('safeMemorySampling', () => {
    it('should not sample when disabled', () => {
      const samples = createMemorySampleStorage();
      const lastSampleRef = { value: -1 };
      const options: TestOptions = { enableMemorySampling: false };

      const result = safeMemorySampling(samples, 0, lastSampleRef, options, 100);

      expect(result).toBe(false);
      expect(samples).toHaveLength(0);
      expect(lastSampleRef.value).toBe(-1); // Unchanged
    });

    it('should sample at block 0 when enabled', () => {
      const samples = createMemorySampleStorage();
      const lastSampleRef = { value: -1 };
      const options: TestOptions = { enableMemorySampling: true };

      const result = safeMemorySampling(samples, 0, lastSampleRef, options, 100);

      expect(result).toBe(true);
      expect(samples).toHaveLength(1);
      expect(samples[0].blockNumber).toBe(0);
      expect(lastSampleRef.value).toBe(0); // Updated
    });

    it('should respect sampling interval', () => {
      const samples = createMemorySampleStorage();
      const lastSampleRef = { value: -1 };
      const options: TestOptions = { enableMemorySampling: true };

      // Sample at block 0
      let result = safeMemorySampling(samples, 0, lastSampleRef, options, 50);
      expect(result).toBe(true);
      expect(samples).toHaveLength(1);
      expect(lastSampleRef.value).toBe(0);

      // Skip blocks before interval
      for (let i = 1; i < 50; i++) {
        result = safeMemorySampling(samples, i, lastSampleRef, options, 50);
        expect(result).toBe(false);
      }
      expect(samples).toHaveLength(1); // No new samples

      // Sample at block 50 (interval reached)
      result = safeMemorySampling(samples, 50, lastSampleRef, options, 50);
      expect(result).toBe(true);
      expect(samples).toHaveLength(2);
      expect(lastSampleRef.value).toBe(50); // Updated
    });

    it('should use default interval of 100', () => {
      const samples = createMemorySampleStorage();
      const lastSampleRef = { value: -1 };
      const options: TestOptions = { enableMemorySampling: true };

      // Sample at block 0
      safeMemorySampling(samples, 0, lastSampleRef, options);
      expect(samples).toHaveLength(1);

      // Should not sample before 100
      safeMemorySampling(samples, 50, lastSampleRef, options);
      expect(samples).toHaveLength(1);

      // Should sample at 100
      safeMemorySampling(samples, 100, lastSampleRef, options);
      expect(samples).toHaveLength(2);
    });
  });
});

describe('Performance: No Overhead When Disabled', () => {
  it('should have minimal overhead when disabled', () => {
    const samples = createMemorySampleStorage();
    const options: TestOptions = { enableMemorySampling: false };
    const iterations = 10000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      conditionalCapture(samples, i, options);
    }
    const end = performance.now();
    const elapsed = end - start;

    // Should be very fast when disabled (< 10ms for 10k iterations)
    expect(elapsed).toBeLessThan(10);
    expect(samples).toHaveLength(0); // No samples collected
  });

  it('should only collect samples when enabled', () => {
    const disabledHelper = createMemorySamplingHelper({
      testOptions: { enableMemorySampling: false },
    });

    const enabledHelper = createMemorySamplingHelper({
      testOptions: { enableMemorySampling: true },
      sampleIntervalBlocks: 10,
    });

    // Process 100 blocks with both helpers
    for (let i = 0; i < 100; i++) {
      disabledHelper.sample(i);
      enabledHelper.sample(i);
    }

    // Disabled helper should have no samples
    expect(disabledHelper.getSampleCount()).toBe(0);

    // Enabled helper should have samples at 0, 10, 20, ..., 90
    expect(enabledHelper.getSampleCount()).toBe(10);
  });
});

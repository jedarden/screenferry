/**
 * Simple GE Benchmark Runner tests.
 *
 * Tests the focused benchmark runner for health check integration.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  runSimpleGEBenchmark,
  runSimpleGEBenchmarkAsync,
  DEFAULT_SIMPLE_CONFIG,
} from '../src/platform/simple-ge-runner.js';

describe('Simple GE Benchmark Runner', () => {
  describe('runSimpleGEBenchmark() synchronous', () => {
    it('runs benchmark and returns K value', () => {
      const result = runSimpleGEBenchmark();

      expect(result.kMax).toBeGreaterThan(0);
      expect(result.kMax).toBeGreaterThanOrEqual(256);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('respects configurable max duration', () => {
      const config = {
        ...DEFAULT_SIMPLE_CONFIG,
        maxDuration: 5000, // 5 seconds
      };

      const result = runSimpleGEBenchmark(config);

      // Should complete within the max duration (with some tolerance)
      expect(result.duration).toBeLessThan(config.maxDuration! * 1.5);
    });

    it('returns structured result with all required fields', () => {
      const result = runSimpleGEBenchmark();

      expect(result).toMatchObject({
        kMax: expect.any(Number),
        duration: expect.any(Number),
        success: expect.any(Boolean),
      });
    });

    it('handles custom targetK configuration', () => {
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        targetK: 512,
      };

      const result = runSimpleGEBenchmark(customConfig);

      expect(result.kMax).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });

    it('handles custom trials configuration', () => {
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        trials: 2,
      };

      const result = runSimpleGEBenchmark(customConfig);

      expect(result.kMax).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });

    it('sets success to false if benchmark exceeds max duration', () => {
      // This test uses a very short max duration to trigger timeout
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        maxDuration: 1, // 1ms - impossible to complete
        targetK: 768, // Large K to ensure it takes time
      };

      const result = runSimpleGEBenchmark(customConfig);

      // Should complete but exceed duration
      expect(result.duration).toBeGreaterThan(customConfig.maxDuration!);
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeded max duration');
    });
  });

  describe('runSimpleGEBenchmarkAsync() async', () => {
    it('runs benchmark asynchronously and returns K value', async () => {
      const result = await runSimpleGEBenchmarkAsync();

      expect(result.kMax).toBeGreaterThan(0);
      expect(result.kMax).toBeGreaterThanOrEqual(256);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('respects configurable max duration in async mode', async () => {
      const config = {
        ...DEFAULT_SIMPLE_CONFIG,
        maxDuration: 5000, // 5 seconds
      };

      const result = await runSimpleGEBenchmarkAsync(config);

      // Should complete within the max duration (with some tolerance)
      expect(result.duration).toBeLessThan(config.maxDuration! * 1.5);
    });

    it('returns structured result with all required fields', async () => {
      const result = await runSimpleGEBenchmarkAsync();

      expect(result).toMatchObject({
        kMax: expect.any(Number),
        duration: expect.any(Number),
        success: expect.any(Boolean),
      });
    });

    it('handles custom configuration in async mode', async () => {
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        targetK: 512,
        trials: 2,
      };

      const result = await runSimpleGEBenchmarkAsync(customConfig);

      expect(result.kMax).toBeGreaterThan(0);
      expect(result.success).toBe(true);
    });

    it('handles benchmark failures gracefully', async () => {
      // Test with impossible configuration to trigger failure
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        maxDuration: 1, // 1ms - impossible to complete
        targetK: 768, // Large K
      };

      const result = await runSimpleGEBenchmarkAsync(customConfig);

      // Should complete but exceed duration or fail
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('DEFAULT_SIMPLE_CONFIG', () => {
    it('has reasonable default values', () => {
      expect(DEFAULT_SIMPLE_CONFIG.maxDuration).toBe(10000); // 10 seconds
      expect(DEFAULT_SIMPLE_CONFIG.targetK).toBe(768);
      expect(DEFAULT_SIMPLE_CONFIG.trials).toBe(1); // Single trial for speed
    });

    it('allows configuration overrides', () => {
      const customConfig = {
        ...DEFAULT_SIMPLE_CONFIG,
        maxDuration: 5000,
        trials: 3,
      };

      expect(customConfig.maxDuration).toBe(5000);
      expect(customConfig.targetK).toBe(768); // Inherited from default
      expect(customConfig.trials).toBe(3);
    });
  });

  describe('Error handling', () => {
    it('handles errors gracefully in sync mode', () => {
      // This test verifies the error handling structure
      // In normal operation, the benchmark should succeed
      const result = runSimpleGEBenchmark();

      // Normal case should succeed
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.kMax).toBe('number');
      expect(typeof result.duration).toBe('number');
    });

    it('handles errors gracefully in async mode', async () => {
      // This test verifies the error handling structure
      const result = await runSimpleGEBenchmarkAsync();

      // Normal case should succeed
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.kMax).toBe('number');
      expect(typeof result.duration).toBe('number');
    });
  });

  describe('Performance characteristics', () => {
    it('completes within reasonable time for health checks', () => {
      const start = performance.now();
      const result = runSimpleGEBenchmark();
      const duration = performance.now() - start;

      // Health check should complete quickly (< 15 seconds)
      expect(duration).toBeLessThan(15000);
      expect(result.success).toBe(true);
    });

    it('async version completes within reasonable time', async () => {
      const start = performance.now();
      const result = await runSimpleGEBenchmarkAsync();
      const duration = performance.now() - start;

      // Health check should complete quickly (< 15 seconds)
      expect(duration).toBeLessThan(15000);
      expect(result.success).toBe(true);
    });
  });

  describe('Integration characteristics', () => {
    it('provides K value suitable for health check decisions', () => {
      const result = runSimpleGEBenchmark();

      // K value should be in reasonable range for health checks
      expect(result.kMax).toBeGreaterThanOrEqual(256);
      expect(result.kMax).toBeLessThanOrEqual(1536);
    });

    it('provides duration metric for health check reporting', () => {
      const result = runSimpleGEBenchmark();

      // Duration should be a positive number suitable for logging
      expect(result.duration).toBeGreaterThan(0);
      expect(result.duration).toBeLessThan(60000); // Less than 1 minute
    });

    it('clearly indicates success/failure for health check logic', () => {
      const result = runSimpleGEBenchmark();

      // Success flag should be clearly set for health check decisions
      expect(typeof result.success).toBe('boolean');
      // Normal case should succeed
      expect(result.success).toBe(true);
    });
  });
});
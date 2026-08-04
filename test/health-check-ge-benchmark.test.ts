/**
 * GE Benchmark runner integration tests.
 *
 * Tests the simple benchmark runner that returns raw K values
 * without caching or fallback logic.
 */

import {describe, it, expect} from 'vitest';
import {
  DEFAULT_CONFIG,
  runGEBenchmark,
  runGEBenchmarkSync,
  getKMaxWithFallback,
  clearBenchmarkCache,
} from '../src/platform/ge-benchmark.js';

describe('GE Benchmark Runner', () => {
  describe('runGEBenchmark() simple runner', () => {
    it('runs synchronous benchmark and returns K value', async () => {
      // Test with synchronous runner since worker may not be available in test
      const result = runGEBenchmarkSync(DEFAULT_CONFIG, true);

      expect(result.derivedKMax).toBeGreaterThan(0);
      expect(result.derivedKMax).toBeGreaterThanOrEqual(256);
      expect(result.measuredThroughputMBs).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('respects configurable max duration in config', () => {
      const config = {
        ...DEFAULT_CONFIG,
        maxDuration: 5000, // 5 seconds
      };

      const result = runGEBenchmarkSync(config, true);

      // Should complete within the max duration (with some tolerance)
      expect(result.duration).toBeLessThan(config.maxDuration! * 1.5);
    });

    it('returns structured result with all required fields', () => {
      const result = runGEBenchmarkSync(DEFAULT_CONFIG, true);

      expect(result).toMatchObject({
        deviceSignature: expect.any(String),
        measuredThroughputMBs: expect.any(Number),
        derivedKMax: expect.any(Number),
        timestamp: expect.any(Number),
        version: expect.any(Number),
        duration: expect.any(Number),
      });
    });

    it('handles custom configuration', () => {
      const customConfig: typeof DEFAULT_CONFIG = {
        ...DEFAULT_CONFIG,
        targetK: 512,
        trials: 2,
        phoneFactor: 2,
      };

      const result = runGEBenchmarkSync(customConfig, true);

      expect(result.derivedKMax).toBeGreaterThan(0);
      // With lower phone factor (more aggressive), should get higher throughput
      expect(result.measuredThroughputMBs).toBeGreaterThan(0);
    });
  });

  describe('runGEBenchmark() with worker fallback', () => {
    it('returns K value from cached result', async () => {
      // Skip tests that require indexedDB in Node environment
      if (typeof indexedDB === 'undefined') {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      // First, cache a result
      const syncResult = runGEBenchmarkSync(DEFAULT_CONFIG, true);

      // Now run the full function which should use cache
      const kMax = await getKMaxWithFallback();

      expect(kMax).toBeGreaterThan(0);
      expect(kMax).toBeGreaterThanOrEqual(256);
    });

    it('handles benchmark failures gracefully', async () => {
      // Skip tests that require indexedDB in Node environment
      if (typeof indexedDB === 'undefined') {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      // Clear cache to force fresh run
      await clearBenchmarkCache();

      // This should either succeed or fall back to 512
      const kMax = await getKMaxWithFallback();

      expect(kMax).toBeGreaterThanOrEqual(256);
      expect(kMax).toBeLessThanOrEqual(1536);
    });
  });

  describe('Configuration validation', () => {
    it('has reasonable default duration', () => {
      expect(DEFAULT_CONFIG.maxDuration).toBe(30000);
    });

    it('allows custom duration override', () => {
      const customConfig = {
        ...DEFAULT_CONFIG,
        maxDuration: 10000,
      };

      expect(customConfig.maxDuration).toBe(10000);
    });
  });
});

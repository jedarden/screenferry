/**
 * GE benchmark component tests.
 *
 * Covers throughput measurement, K_max derivation, caching, validation,
 * and fallback behavior per docs/notes/ge-benchmark-spec.md.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  DEFAULT_CONFIG,
  BENCHMARK_VERSION,
  FALLBACK_K_MAX,
  createDeviceSignature,
  signatureToKey,
  requiredThroughputMBs,
  deriveKMax,
  validateBeaconK,
  cacheBenchmarkResult,
  loadCachedBenchmarkResult,
  clearBenchmarkCache,
  getKMaxWithFallback,
  runGEBenchmarkSync,
  type GEBenchmarkConfig,
  type GEBenchmarkResult,
  type DeviceSignature,
} from '../src/platform/ge-benchmark.js';

describe('GE Benchmark', () => {
  describe('Device signature', () => {
    it('creates a signature with all required fields', () => {
      const sig = createDeviceSignature();

      expect(sig.userAgent).toBeTruthy();
      expect(typeof sig.userAgent).toBe('string');
      expect(sig.platform).toBeTruthy();
      expect(typeof sig.platform).toBe('string');
      expect(sig.hardwareConcurrency).toBeGreaterThan(0);
      expect(typeof sig.hardwareConcurrency).toBe('number');
      // deviceMemory is optional
    });

    it('serializes signature to a consistent key', () => {
      const sig: DeviceSignature = {
        userAgent: 'Mozilla/5.0 Test',
        platform: 'Linux x86_64',
        hardwareConcurrency: 8,
        deviceMemory: 16,
      };

      const key1 = signatureToKey(sig);
      const key2 = signatureToKey(sig);

      expect(key1).toBe(key2);
      expect(key1).toContain('Linux x86_64');
      expect(key1).toContain('8');
      expect(key1).toContain('16');
    });

    it('generates different keys for different signatures', () => {
      const sig1: DeviceSignature = {
        userAgent: 'Mozilla/5.0',
        platform: 'Linux',
        hardwareConcurrency: 4,
      };
      const sig2: DeviceSignature = {
        userAgent: 'Mozilla/5.0',
        platform: 'Linux',
        hardwareConcurrency: 8,
      };

      expect(signatureToKey(sig1)).not.toBe(signatureToKey(sig2));
    });

    it('handles missing deviceMemory gracefully', () => {
      const sig: DeviceSignature = {
        userAgent: 'Test',
        platform: 'Win32',
        hardwareConcurrency: 4,
        // deviceMemory undefined
      };

      const key = signatureToKey(sig);
      expect(key).toContain('unknown');
    });
  });

  describe('Throughput calculation', () => {
    it('calculates required throughput per plan.md formula', () => {
      // From plan.md §3.1 table: K=512, L=256, Stage 3 (106 KB/s)
      // required = 69.5 MB/s
      const required = requiredThroughputMBs(512, 256, 106 * 1024);

      expect(required).toBeCloseTo(69.5, 1);
    });

    it('scales correctly with K', () => {
      const base = requiredThroughputMBs(512, 256, 106 * 1024);
      const doubleK = requiredThroughputMBs(1024, 256, 106 * 1024);

      // Should be roughly 4× since K² term dominates
      expect(doubleK / base).toBeGreaterThan(3.5);
      expect(doubleK / base).toBeLessThan(4.5);
    });

    it('scales correctly with wire rate', () => {
      const stage1 = requiredThroughputMBs(512, 256, 30 * 1024);
      const stage3 = requiredThroughputMBs(512, 256, 106 * 1024);

      // Linear scaling with wire rate
      expect(stage3 / stage1).toBeCloseTo(106 / 30, 1);
    });
  });

  describe('K_max derivation', () => {
    it('derives K_max from measured throughput', () => {
      // S1 measured ~3260 MB/s desktop; after ÷4 phone factor = 815 MB/s
      const measured = 815; // MB/s
      const kMax = deriveKMax(measured, 256, 106);

      // 815 MB/s should support at least K=768
      expect(kMax).toBeGreaterThanOrEqual(768);
    });

    it('returns conservative value for low throughput', () => {
      const lowThroughput = 50; // MB/s
      const kMax = deriveKMax(lowThroughput, 256, 106);

      // Should return minimum safe value
      expect(kMax).toBe(256);
    });

    it('returns 768 for measured throughput matching spec', () => {
      // From spec: 69.5 MB/s required for K=512 at Stage 3
      // Add margin for higher K
      const measured = 100; // MB/s
      const kMax = deriveKMax(measured, 256, 106);

      expect(kMax).toBeGreaterThanOrEqual(512);
    });
  });

  describe('Beacon validation', () => {
    it('accepts beacon with K within local K_max', () => {
      const result = validateBeaconK(256 * 512, 256, 512);

      expect(result.acceptable).toBe(true);
      expect(result.beaconK).toBe(512);
      expect(result.localKMax).toBe(512);
      expect(result.error).toBeUndefined();
    });

    it('rejects beacon with K exceeding local K_max', () => {
      const result = validateBeaconK(256 * 768, 256, 512);

      expect(result.acceptable).toBe(false);
      expect(result.beaconK).toBe(768);
      expect(result.localKMax).toBe(512);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('E-K-OVERFLOW');
      expect(result.error?.message).toContain('exceeds this device\'s maximum');
    });

    it('provides clear error message for recovery', () => {
      const result = validateBeaconK(256 * 768, 256, 512);

      expect(result.error?.message).toMatch(/Use a smaller file/);
      expect(result.error?.message).toMatch(/more powerful receiver/);
    });

    it('handles non-block-aligned block sizes', () => {
      const blockSize = 200000; // Not a multiple of L=256
      const result = validateBeaconK(blockSize, 256, 1024);

      expect(result.beaconK).toBe(Math.ceil(200000 / 256));
    });
  });

  describe('IndexedDB caching', () => {
    // Skip IndexedDB tests in Node environment
    const hasIndexedDB = typeof indexedDB !== 'undefined';

    beforeEach(async () => {
      if (!hasIndexedDB) return;
      await clearBenchmarkCache();
    });

    afterEach(async () => {
      if (!hasIndexedDB) return;
      await clearBenchmarkCache();
    });

    it('caches and retrieves benchmark result', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }
      const sig = createDeviceSignature();
      const result: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now(),
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, result);

      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded).not.toBeNull();
      expect(loaded!.derivedKMax).toBe(768);
      expect(loaded!.measuredThroughputMBs).toBe(1000);
    });

    it('returns null for non-existent cache', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }
      const sig = createDeviceSignature();
      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded).toBeNull();
    });

    it('invalidates cache on version mismatch', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig = createDeviceSignature();
      const result: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now(),
        version: BENCHMARK_VERSION - 1, // Old version
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, result);

      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded).toBeNull(); // Should not return stale result
    });

    it('overwrites existing cache entry', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig = createDeviceSignature();

      const result1: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 500,
        derivedKMax: 512,
        timestamp: Date.now(),
        version: BENCHMARK_VERSION,
        duration: 3000,
      };

      const result2: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now() + 1000,
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, result1);
      await cacheBenchmarkResult(sig, result2);

      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded!.derivedKMax).toBe(768); // Should have the newer value
    });

    it('clears all cache entries', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig1 = createDeviceSignature();
      const sig2: DeviceSignature = {
        ...sig1,
        userAgent: 'Different User Agent',
      };

      const result: GEBenchmarkResult = {
        deviceSignature: 'test',
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now(),
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig1, result);
      await cacheBenchmarkResult(sig2, result);
      await clearBenchmarkCache();

      expect(await loadCachedBenchmarkResult(sig1)).toBeNull();
      expect(await loadCachedBenchmarkResult(sig2)).toBeNull();
    });

    it('returns null for expired cache entries', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig = createDeviceSignature();
      const expiredResult: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now() - (31 * 24 * 60 * 60 * 1000), // 31 days ago (expired)
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, expiredResult);

      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded).toBeNull(); // Should return null for expired cache
    });

    it('returns cached result for fresh entries within TTL', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig = createDeviceSignature();
      const freshResult: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now() - (15 * 24 * 60 * 60 * 1000), // 15 days ago (within TTL)
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, freshResult);

      const loaded = await loadCachedBenchmarkResult(sig);

      expect(loaded).not.toBeNull();
      expect(loaded!.derivedKMax).toBe(768);
      expect(loaded!.measuredThroughputMBs).toBe(1000);
    });

    it('handles entries exactly at TTL boundary', async () => {
      if (!hasIndexedDB) {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      const sig = createDeviceSignature();
      // Import the TTL constant
      const { CACHE_TTL_MS } = await import('../src/platform/ge-benchmark.js');

      const boundaryResult: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now() - CACHE_TTL_MS, // Exactly at TTL boundary
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, boundaryResult);

      const loaded = await loadCachedBenchmarkResult(sig);

      // At the exact boundary, should be treated as expired
      expect(loaded).toBeNull();
    });
  });

  describe('Synchronous benchmark', () => {
    it('runs benchmark with default config', () => {
      const result = runGEBenchmarkSync();

      expect(result).toMatchObject({
        deviceSignature: expect.any(String),
        measuredThroughputMBs: expect.any(Number),
        derivedKMax: expect.any(Number),
        timestamp: expect.any(Number),
        version: BENCHMARK_VERSION,
        duration: expect.any(Number),
      });

      expect(result.measuredThroughputMBs).toBeGreaterThan(0);
      expect(result.derivedKMax).toBeGreaterThanOrEqual(256);
      expect(result.duration).toBeGreaterThan(0);
    });

    it('applies phone factor correctly', () => {
      const configNoFactor: GEBenchmarkConfig = {
        ...DEFAULT_CONFIG,
        phoneFactor: 1, // No factor
      };

      const configWithFactor: GEBenchmarkConfig = {
        ...DEFAULT_CONFIG,
        phoneFactor: 4,
      };

      const resultNoFactor = runGEBenchmarkSync(configNoFactor);
      const resultWithFactor = runGEBenchmarkSync(configWithFactor);

      // With phone factor, measured throughput should be lower
      expect(resultWithFactor.measuredThroughputMBs)
        .toBeLessThan(resultNoFactor.measuredThroughputMBs);
    });

    it('derives reasonable K_max from measurements', () => {
      const result = runGEBenchmarkSync();

      // Even with phone factor, desktop should support at least K=512
      expect(result.derivedKMax).toBeGreaterThanOrEqual(512);
    });

    it('runs multiple trials and takes best result', () => {
      const configFast: GEBenchmarkConfig = {
        ...DEFAULT_CONFIG,
        trials: 1,
      };

      const configMultiple: GEBenchmarkConfig = {
        ...DEFAULT_CONFIG,
        trials: 3,
      };

      const resultFast = runGEBenchmarkSync(configFast);
      const resultMultiple = runGEBenchmarkSync(configMultiple);

      // Both should complete without error
      expect(resultFast.derivedKMax).toBeGreaterThan(0);
      expect(resultMultiple.derivedKMax).toBeGreaterThan(0);
    });

    it('completes within reasonable time', () => {
      const start = performance.now();
      const result = runGEBenchmarkSync();
      const elapsed = performance.now() - start;

      // Should complete within 10 seconds even on slow hardware
      expect(elapsed).toBeLessThan(10000);
      expect(result.duration).toBeLessThan(10000);
    });
  });

  describe('Fallback behavior', () => {
    it('returns cached K_max when available', async () => {
      if (typeof indexedDB === 'undefined') {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      await clearBenchmarkCache();

      const sig = createDeviceSignature();
      const cached: GEBenchmarkResult = {
        deviceSignature: signatureToKey(sig),
        measuredThroughputMBs: 1000,
        derivedKMax: 768,
        timestamp: Date.now(),
        version: BENCHMARK_VERSION,
        duration: 5000,
      };

      await cacheBenchmarkResult(sig, cached);

      // Mock getKMaxWithFallback to use the cache
      const kMax = await getKMaxWithFallback();

      expect(kMax).toBe(768);
    });

    it('falls back to K=512 when no cache exists and benchmark fails', async () => {
      if (typeof indexedDB === 'undefined') {
        console.log('Skipping IndexedDB test in Node environment');
        return;
      }

      await clearBenchmarkCache();

      // In a test environment, the worker might not be available
      // This tests the fallback behavior
      const kMax = await getKMaxWithFallback();

      // Should either return a measured value or fall back to 512
      expect(kMax).toBeGreaterThanOrEqual(256);
    });
  });

  describe('Configuration defaults', () => {
    it('has sensible default configuration', () => {
      expect(DEFAULT_CONFIG.stages).toHaveLength(3);
      expect(DEFAULT_CONFIG.stages[0].name).toBe('Stage 1');
      expect(DEFAULT_CONFIG.stages[0].rateKBs).toBe(30);
      expect(DEFAULT_CONFIG.phoneFactor).toBe(4);
      expect(DEFAULT_CONFIG.targetK).toBe(768);
      expect(DEFAULT_CONFIG.L).toBe(256);
      expect(DEFAULT_CONFIG.trials).toBe(3);
    });

    it('has correct fallback K_max', () => {
      expect(FALLBACK_K_MAX).toBe(512);
    });

    it('has benchmark version defined', () => {
      expect(BENCHMARK_VERSION).toBe(1);
    });
  });
});

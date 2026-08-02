/**
 * Test script to verify TTL functionality for benchmark cache.
 * This demonstrates the 30-day cache expiry behavior.
 */

import {
  createDeviceSignature,
  cacheBenchmarkResult,
  loadCachedBenchmarkResult,
  cleanupExpiredCacheEntries,
  clearBenchmarkCache,
  CACHE_TTL_MS,
  BENCHMARK_VERSION,
  type GEBenchmarkResult,
} from './src/platform/ge-benchmark.js';

async function testTTLFunctionality() {
  console.log('Testing TTL Functionality for Benchmark Cache');
  console.log('============================================\n');

  if (typeof indexedDB === 'undefined') {
    console.error('IndexedDB not available. This script requires a browser environment.');
    process.exit(1);
  }

  // Clear cache to start fresh
  await clearBenchmarkCache();
  console.log('✓ Cleared existing cache\n');

  // Create a device signature
  const sig = createDeviceSignature();
  console.log('Device signature created:', {
    platform: sig.platform,
    hardwareConcurrency: sig.hardwareConcurrency,
    deviceMemory: sig.deviceMemory,
  });

  // Test 1: Fresh cache entry (should be retrieved)
  console.log('\n--- Test 1: Fresh Cache Entry ---');
  const freshResult: GEBenchmarkResult = {
    deviceSignature: 'test-key',
    measuredThroughputMBs: 1000,
    derivedKMax: 768,
    timestamp: Date.now(), // Current time
    version: BENCHMARK_VERSION,
    duration: 5000,
  };

  await cacheBenchmarkResult(sig, freshResult);
  const loaded = await loadCachedBenchmarkResult(sig);
  console.log('Fresh entry loaded:', loaded ? '✓ PASS' : '✗ FAIL');
  console.log('  - K_max:', loaded?.derivedKMax);
  console.log('  - Age:', loaded ? `${Math.round((Date.now() - loaded.timestamp) / 1000)} seconds` : 'N/A');

  // Test 2: Expired cache entry (should NOT be retrieved)
  console.log('\n--- Test 2: Expired Cache Entry ---');
  const expiredResult: GEBenchmarkResult = {
    deviceSignature: 'test-key',
    measuredThroughputMBs: 1000,
    derivedKMax: 768,
    timestamp: Date.now() - CACHE_TTL_MS - 1000, // Older than TTL
    version: BENCHMARK_VERSION,
    duration: 5000,
  };

  await cacheBenchmarkResult(sig, expiredResult);
  const expiredLoaded = await loadCachedBenchmarkResult(sig);
  console.log('Expired entry loaded:', expiredLoaded ? '✗ FAIL (should be null)' : '✓ PASS (correctly rejected)');
  console.log('  - Expected: null (expired)');
  console.log('  - Got:', expiredLoaded ? 'object' : 'null');

  // Test 3: Cache entry at TTL boundary (should be retrieved)
  console.log('\n--- Test 3: TTL Boundary Entry ---');
  const boundaryResult: GEBenchmarkResult = {
    deviceSignature: 'test-key',
    measuredThroughputMBs: 1000,
    derivedKMax: 768,
    timestamp: Date.now() - CACHE_TTL_MS + 1000, // 1 second before expiry
    version: BENCHMARK_VERSION,
    duration: 5000,
  };

  await cacheBenchmarkResult(sig, boundaryResult);
  const boundaryLoaded = await loadCachedBenchmarkResult(sig);
  console.log('Boundary entry loaded:', boundaryLoaded ? '✓ PASS' : '✗ FAIL');
  console.log('  - K_max:', boundaryLoaded?.derivedKMax);
  console.log('  - Age:', boundaryLoaded ? `${Math.round((Date.now() - boundaryLoaded.timestamp) / 1000)} seconds` : 'N/A');
  console.log('  - Time to expiry:', boundaryLoaded ? `${Math.round((CACHE_TTL_MS - (Date.now() - boundaryLoaded.timestamp)) / 1000)} seconds` : 'N/A');

  // Test 4: Cleanup function
  console.log('\n--- Test 4: Cleanup Expired Entries ---');

  // Create multiple entries - some expired, some fresh
  const freshSig: typeof sig = {...sig, userAgent: 'Fresh Device'};
  const expiredSig: typeof sig = {...sig, userAgent: 'Expired Device'};

  await cacheBenchmarkResult(freshSig, {
    ...freshResult,
    timestamp: Date.now(),
  });

  await cacheBenchmarkResult(expiredSig, {
    ...expiredResult,
    timestamp: Date.now() - CACHE_TTL_MS - 5000,
  });

  const removedCount = await cleanupExpiredCacheEntries();
  console.log(`Removed ${removedCount} expired entries: ${removedCount > 0 ? '✓ PASS' : '✗ FAIL'}`);

  const freshStillAvailable = await loadCachedBenchmarkResult(freshSig);
  const expiredRemoved = await loadCachedBenchmarkResult(expiredSig);

  console.log('  - Fresh entry still available:', freshStillAvailable ? '✓ PASS' : '✗ FAIL');
  console.log('  - Expired entry removed:', !expiredRemoved ? '✓ PASS' : '✗ FAIL');

  // Clean up
  await clearBenchmarkCache();
  console.log('\n✓ Cache cleaned up after testing');

  console.log('\n============================================');
  console.log('TTL Functionality Tests Complete!');
}

// Run the tests
testTTLFunctionality().catch(console.error);
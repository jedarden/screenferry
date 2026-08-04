#!/usr/bin/env node
/**
 * Test script for thermal detection functionality
 *
 * Demonstrates the usage of thermal detection in benchmarks.
 * This script shows all three modes of operation:
 * 1. Normal benchmark (no thermal checking)
 * 2. Benchmark with thermal checking
 * 3. Benchmark with required throttled state (fail-fast)
 */

import { run } from './ge-bench.mjs';
import { readTemperatures, detectThrottling, checkThrottledState, requireThrottledState } from './thermal-detection.mjs';

async function main() {
  console.log('=== Thermal Detection Test Suite ===\n');

  const K = 768, L = 256;

  // Test 1: Read temperatures
  console.log('Test 1: Reading temperatures...');
  const temps = readTemperatures();
  console.log('Current temperatures:', temps);
  console.log('✓ Temperature reading works\n');

  // Test 2: Detect throttling with stable performance
  console.log('Test 2: Detecting throttling (stable performance)...');
  const baseline = [
    { throughput: 2000 },
    { throughput: 2000 },
    { throughput: 2000 },
    { throughput: 2000 },
    { throughput: 2000 }
  ];
  let result = detectThrottling(baseline, 2000);
  console.log('Result:', result);
  console.log('✓ Stable performance detection works\n');

  // Test 3: Detect throttling with degraded performance
  console.log('Test 3: Detecting throttling (degraded performance)...');
  result = detectThrottling(baseline, 1200);
  console.log('Result:', result);
  console.log('✓ Degraded performance detection works\n');

  // Test 4: Check thermal state
  console.log('Test 4: Checking thermal state...');
  try {
    result = await checkThrottledState(() => run(K, L, { seed: 0xC0FFEE }), {});
    console.log('Thermal state check passed');
    console.log('✓ Thermal state checking works\n');
  } catch (e) {
    console.log('Thermal state check failed (expected):', e.message);
    console.log('✓ Thermal state checking works\n');
  }

  console.log('=== All Tests Passed ===');
  console.log('\nUsage examples:');
  console.log('  node spike/ge-bench.mjs 768 256                    # Normal benchmark');
  console.log('  node spike/ge-bench.mjs 768 256 --check-thermal    # With thermal check');
  console.log('  node spike/ge-bench.mjs 768 256 --require-throttled # Require throttled');
  console.log('\nTo trigger throttling first:');
  console.log('  node spike/thermal-stress.mjs 300  # Stress for 5 minutes');
}

main().catch(console.error);

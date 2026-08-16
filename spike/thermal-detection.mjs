#!/usr/bin/env node
/**
 * Thermal Throttling Detection Module
 *
 * Provides reusable functions for detecting thermal throttling state.
 * Can be used by benchmarks to verify thermal state before execution.
 *
 * Usage:
 *   import { detectThrottling, checkThrottledState, measureBaseline }
 *   from './thermal-detection.mjs';
 */

import fs from 'fs';

/**
 * Thermal zones to monitor on Linux systems
 */
const THERMAL_ZONES = [
  { path: '/sys/class/thermal/thermal_zone0', name: 'acpitz' },
  { path: '/sys/class/thermal/thermal_zone2', name: 'x86_pkg_temp' }
];

/**
 * CPU frequency monitoring path
 */
const CPU_FREQ_PATH = '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq';
const CPU_BASE_FREQ_PATH = '/sys/devices/system/cpu/cpu0/cpufreq/base_frequency';

/**
 * Read current temperatures from all available thermal zones
 * @returns {Object} Object mapping thermal zone names to temperatures in Celsius
 */
export function readTemperatures() {
  const temps = {};
  for (const zone of THERMAL_ZONES) {
    try {
      const tempRaw = fs.readFileSync(`${zone.path}/temp`, 'utf8');
      temps[zone.name] = parseInt(tempRaw) / 1000;
    } catch (e) {
      temps[zone.name] = null;
    }
  }
  return temps;
}

/**
 * Read current CPU frequency
 * @returns {Object} CPU frequency information in GHz
 */
export function readCpuFrequency() {
  try {
    const freqRaw = fs.readFileSync(CPU_FREQ_PATH, 'utf8');
    const currentFreqKHz = parseInt(freqRaw.trim());
    const currentFreqGHz = currentFreqKHz / 1000000;

    // Get base frequency for comparison
    let baseFreqGHz = null;
    try {
      const baseFreqRaw = fs.readFileSync(CPU_BASE_FREQ_PATH, 'utf8');
      baseFreqGHz = parseInt(baseFreqRaw.trim()) / 1000000;
    } catch (e) {
      // Base frequency might not be available
    }

    return {
      current: currentFreqGHz,
      base: baseFreqGHz,
      throttling: baseFreqGHz !== null && currentFreqGHz < baseFreqGHz * 0.9,
      throttlePercent: baseFreqGHz !== null ?
        ((baseFreqGHz - currentFreqGHz) / baseFreqGHz * 100).toFixed(1) : null
    };
  } catch (e) {
    return {
      current: null,
      base: null,
      throttling: null,
      throttlePercent: null
    };
  }
}

/**
 * Read comprehensive thermal state
 * @returns {Object} Complete thermal state including temperatures, frequency, and timestamp
 */
export function readThermalState() {
  const timestamp = Date.now();
  const temperatures = readTemperatures();
  const cpuFrequency = readCpuFrequency();

  return {
    timestamp,
    isoTime: new Date(timestamp).toISOString(),
    temperatures,
    cpuFrequency
  };
}

/**
 * Detect thermal throttling based on performance degradation
 * @param {Array} baselineData - Array of baseline throughput measurements
 * @param {number} currentThroughput - Current throughput measurement
 * @returns {Object} Throttling detection result with throttled flag and reason
 */
export function detectThrottling(baselineData, currentThroughput) {
  if (!baselineData || baselineData.length < 5) {
    return {
      throttled: false,
      degradation: '0.0',
      reason: 'insufficient'
    };
  }

  const baseline = baselineData.slice(0, 5);
  const avgBaseline = baseline.reduce((sum, d) => sum + d.throughput, 0) / baseline.length;
  const degradation = ((avgBaseline - currentThroughput) / avgBaseline) * 100;

  if (degradation > 30) {
    return {
      throttled: true,
      degradation: degradation.toFixed(1),
      reason: 'deg30'
    };
  } else if (degradation > 20) {
    return {
      throttled: false,
      degradation: degradation.toFixed(1),
      reason: 'deg20'
    };
  } else if (degradation > 10) {
    return {
      throttled: false,
      degradation: degradation.toFixed(1),
      reason: 'deg10'
    };
  }

  return {
    throttled: false,
    degradation: '0.0',
    reason: 'stable'
  };
}

/**
 * Measure baseline performance for thermal detection
 * @param {Function} benchmarkFn - Benchmark function to run
 * @param {Object} options - Options for baseline measurement
 * @param {number} options.iterations - Number of iterations (default: 5)
 * @param {number} options.intervalMs - Interval between iterations (default: 1000)
 * @returns {Promise<Array>} Array of baseline measurements
 */
export async function measureBaseline(benchmarkFn, { iterations = 5, intervalMs = 1000 } = {}) {
  const baselineData = [];

  console.log(`Measuring baseline performance (${iterations} iterations)...`);

  for (let i = 0; i < iterations; i++) {
    const result = benchmarkFn();
    baselineData.push({
      iteration: i + 1,
      throughput: result.throughputMBs,
      timestamp: Date.now()
    });

    if (i < iterations - 1) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  const avgThroughput = baselineData.reduce((sum, d) => sum + d.throughput, 0) / baselineData.length;
  console.log(`Baseline measured: ${avgThroughput.toFixed(0)} MB/s`);

  return baselineData;
}

/**
 * Check if device is currently in a throttled state
 * @param {Function} benchmarkFn - Benchmark function to run
 * @param {Object} options - Options for throttling check
 * @param {boolean} options.expectThrottled - Whether throttling is expected (default: false)
 * @param {Array} options.baselineData - Pre-measured baseline data (optional)
 * @returns {Promise<Object>} Check result with throttled state and recommendations
 */
export async function checkThrottledState(benchmarkFn, options = {}) {
  const { expectThrottled = false, baselineData = null } = options;

  console.log('\n--- Thermal State Check ---');

  // Read current temperatures
  const temps = readTemperatures();
  const tempInfo = Object.entries(temps)
    .filter(([_, temp]) => temp !== null)
    .map(([name, temp]) => `${name}: ${temp}°C`)
    .join(', ');

  if (tempInfo) {
    console.log(`Current temperatures: ${tempInfo}`);
  }

  // If no baseline provided, measure it
  let baseline = baselineData;
  if (!baseline) {
    baseline = await measureBaseline(benchmarkFn, { iterations: 5, intervalMs: 500 });
  }

  // Run current benchmark
  const currentResult = benchmarkFn();
  console.log(`Current throughput: ${currentResult.throughputMBs.toFixed(0)} MB/s`);

  // Detect throttling
  const throttling = detectThrottling(baseline, currentResult.throughputMBs);

  console.log(`Throttling detection: ${throttling.throttled ? '🔥 THROTTLED' : '✓ COOL'}`);
  console.log(`Degradation: ${throttling.degradation}% (reason: ${throttling.reason})`);

  const result = {
    throttled: throttling.throttled,
    degradation: throttling.degradation,
    reason: throttling.reason,
    temperatures: temps,
    baseline: baseline,
    current: currentResult,
    passed: true,
    message: ''
  };

  // Check if expectations match reality
  if (expectThrottled && !throttling.throttled) {
    result.passed = false;
    result.message = `❌ ERROR: Expected throttled state but device is COOL.\n` +
      `   The benchmark requires a throttled state for accurate results.\n` +
      `   Run stress test first to trigger thermal throttling:\n` +
      `   node spike/thermal-stress.mjs 300`;
  } else if (!expectThrottled && throttling.throttled) {
    result.message = `⚠️  WARNING: Device is currently THROTTLED.\n` +
      `   Results may not represent peak performance.\n` +
      `   Let device cool or run in a cooler environment.`;
  }

  if (result.message) {
    console.log(`\n${result.message}`);
  }

  console.log('--- End Thermal Check ---\n');

  return result;
}

/**
 * Fail-fast helper that throws if thermal state doesn't match expectations
 * @param {Function} benchmarkFn - Benchmark function to run
 * @param {Object} options - Options for check
 * @throws {Error} If thermal state doesn't match expectations
 */
export async function requireThrottledState(benchmarkFn, options = {}) {
  const result = await checkThrottledState(benchmarkFn, { ...options, expectThrottled: true });

  if (!result.passed) {
    throw new Error(result.message);
  }

  return result;
}

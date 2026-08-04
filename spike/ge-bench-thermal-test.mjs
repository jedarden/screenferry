#!/usr/bin/env node
/**
 * GE Benchmark Thermal Throttling Test
 *
 * Automated thermal throttling test that:
 * 1. Stresses CPU to trigger thermal throttling
 * 2. Monitors thermal zones continuously
 * 3. Runs GE benchmark at regular intervals
 * 4. Generates comprehensive report
 */

import fs from 'fs';
import { run, requiredMBs } from './ge-bench.mjs';

const THERMAL_ZONES = [
  { path: '/sys/class/thermal/thermal_zone0', name: 'acpitz' },
  { path: '/sys/class/thermal/thermal_zone2', name: 'x86_pkg_temp' }
];

const CONFIG = {
  K: 768,
  L: 256,
  stressDurationSeconds: 300, // 5 minutes initial stress
  benchmarkIntervalMs: 10000, // Run benchmark every 10 seconds
  totalDurationSeconds: 600, // 30 minutes total
};

let thermalData = [];
let benchmarkResults = [];
let stressStartTime = null;
let isStressed = false;

async function stressCPU() {
  const crypto = (await import('crypto')).default;
  const workers = [];
  const coreCount = 2; // This system has 2 cores

  console.log(`Starting CPU stress on ${coreCount} cores...`);

  for (let i = 0; i < coreCount; i++) {
    const worker = setInterval(() => {
      for (let j = 0; j < 1000; j++) {
        crypto.createHash('sha256').update(Math.random().toString()).digest();
      }
    }, 1);
    workers.push(worker);
  }

  isStressed = true;
  stressStartTime = Date.now();

  return () => {
    for (const worker of workers) {
      clearInterval(worker);
    }
    isStressed = false;
    console.log('CPU stress stopped.');
  };
}

async function runThermalTest() {
  console.log('='.repeat(70));
  console.log('GE BENCHMARK - THERMAL THROTTLING TEST');
  console.log('='.repeat(70));
  console.log(`Configuration: K=${CONFIG.K}, L=${CONFIG.L}`);
  console.log(`Total duration: ${CONFIG.totalDurationSeconds / 60} minutes`);
  console.log(`Benchmark interval: ${CONFIG.benchmarkIntervalMs / 1000} seconds`);
  console.log('');

  // Check initial thermal state
  const initialTemps = readTemperatures();
  console.log('Initial temperatures:');
  for (const [name, temp] of Object.entries(initialTemps)) {
    console.log(`  ${name}: ${temp}°C`);
  }
  console.log('');

  // Start CPU stress
  const stopStress = await stressCPU();
  console.log('CPU stress initiated. Monitoring thermal state...\n');

  // Monitoring loop
  const startTime = Date.now();
  let iteration = 0;

  const interval = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    iteration++;

    if (elapsed >= CONFIG.totalDurationSeconds) {
      clearInterval(interval);
      stopStress();
      generateReport();
      return;
    }

    // Record temperature
    const temps = readTemperatures();
    thermalData.push({
      elapsedMin: (elapsed / 60).toFixed(1),
      elapsedSec: Math.floor(elapsed),
      temps: { ...temps }
    });

    // Run benchmark iteration
    const r = run(CONFIG.K, CONFIG.L, { seed: Math.floor(Math.random() * 1000000) });

    // Detect throttling
    const throttling = detectThrottling(benchmarkResults, r.throughputMBs);

    const entry = {
      elapsedMin: parseFloat((elapsed / 60).toFixed(1)),
      elapsedSec: Math.floor(elapsed),
      throughput: r.throughputMBs,
      ms: r.ms,
      packets: r.packets,
      rowOps: r.rowOps,
      throttled: throttling.throttled,
      degradation: throttling.degradation,
      reason: throttling.reason,
      temps: { ...temps }
    };

    benchmarkResults.push(entry);

    // Display status
    const phone = r.throughputMBs / 4;
    const statusClass = throttling.throttled ? '🔥 THROTTLED' : '✓ COOL';
    const tempInfo = Object.entries(temps).map(([name, temp]) => `${name}: ${temp}°C`).join(', ');

    console.log(`[${entry.elapsedMin.toString().padStart(5, ' ')} min] ${statusClass} ${r.throughputMBs.toFixed(0).padStart(4)} MB/s → ${phone.toFixed(0).padStart(3)} MB/s (phone) | ${tempInfo}`);

  }, CONFIG.benchmarkIntervalMs);
}

function generateReport() {
  console.log('\n' + '='.repeat(70));
  console.log('THERMAL TEST REPORT');
  console.log('='.repeat(70));

  if (benchmarkResults.length < 5) {
    console.log('ERROR: Insufficient data for analysis');
    return;
  }

  // Calculate baseline and throttled performance
  const baseline = benchmarkResults.slice(0, 5);
  const avgBaseline = baseline.reduce((sum, d) => sum + d.throughput, 0) / baseline.length;

  const throttledSamples = benchmarkResults.filter(d => {
    const degradation = ((avgBaseline - d.throughput) / avgBaseline) * 100;
    return degradation > 30;
  });

  const avgThrottled = throttledSamples.length > 0
    ? throttledSamples.reduce((sum, d) => sum + d.throughput, 0) / throttledSamples.length
    : null;

  console.log(`\nConfiguration: K=${CONFIG.K}, L=${CONFIG.L}`);
  console.log(`Test duration: ${benchmarkResults[benchmarkResults.length - 1].elapsedMin} minutes`);
  console.log(`Total iterations: ${benchmarkResults.length}`);

  console.log(`\nCool performance (first 5 iterations):`);
  console.log(`  Device: ${avgBaseline.toFixed(0)} MB/s`);
  console.log(`  Phone est (÷4): ${(avgBaseline / 4).toFixed(0)} MB/s`);

  if (avgThrottled !== null) {
    console.log(`\nThrottled performance (${throttledSamples.length} iterations >30% degradation):`);
    console.log(`  Device: ${avgThrottled.toFixed(0)} MB/s`);
    console.log(`  Phone est (÷4): ${(avgThrottled / 4).toFixed(0)} MB/s`);
    console.log(`  Performance loss: ${((avgBaseline - avgThrottled) / avgBaseline * 100).toFixed(1)}%`);
  } else {
    console.log(`\nNo thermal throttling detected during test.`);
    console.log(`Device maintained stable performance throughout.`);
  }

  // Stage 3 validation
  console.log(`\nStage 3 validation (106 KB/s wire rate):`);
  const need = requiredMBs(CONFIG.K, CONFIG.L, 106 * 1024);

  if (avgThrottled !== null) {
    const phoneThrottled = avgThrottled / 4;
    const passes = phoneThrottled >= need;
    console.log(`  Required: ${need.toFixed(0)} MB/s`);
    console.log(`  Measured (throttled): ${phoneThrottled.toFixed(0)} MB/s`);
    console.log(`  Result: ${passes ? '✓ PASS' : '✗ FAIL'} (${(phoneThrottled / need).toFixed(2)}x margin)`);

    if (!passes) {
      console.log(`\n⚠️ WARNING: Throttled performance fails Stage 3 requirement!`);
      console.log(`   This device cannot sustain K=${CONFIG.K} under thermal load.`);
      console.log(`   Consider reducing K or implementing duty cycling (D27).`);
    }
  } else {
    const phoneCool = avgBaseline / 4;
    const passes = phoneCool >= need;
    console.log(`  Required: ${need.toFixed(0)} MB/s`);
    console.log(`  Measured (cool): ${phoneCool.toFixed(0)} MB/s`);
    console.log(`  Result: ${passes ? '✓ PASS' : '✗ FAIL'} (${(phoneCool / need).toFixed(2)}x margin)`);
    console.log(`\nNote: No throttling observed. Test on a warmer device or extend duration.`);
  }

  // Thermal analysis
  console.log(`\nThermal analysis:`);
  const temps = benchmarkResults.map(r => r.temps.x86_pkg_temp || r.temps.acpitz).filter(t => t !== null);
  if (temps.length > 0) {
    const maxTemp = Math.max(...temps);
    const avgTemp = temps.reduce((sum, t) => sum + t, 0) / temps.length;
    const minTemp = Math.min(...temps);
    console.log(`  CPU temp range: ${minTemp.toFixed(0)}°C - ${maxTemp.toFixed(0)}°C`);
    console.log(`  Average temp: ${avgTemp.toFixed(0)}°C`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('TEST COMPLETE');
  console.log('='.repeat(70));
}

// Run the test
runThermalTest().catch(console.error);
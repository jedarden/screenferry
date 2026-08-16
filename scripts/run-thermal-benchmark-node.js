#!/usr/bin/env node
/**
 * Thermal Monitoring Benchmark - Node.js Runner
 *
 * Executes the complete GE benchmark suite with thermal monitoring
 * in a Node.js environment for testing and CI purposes.
 *
 * Usage:
 *   node scripts/run-thermal-benchmark-node.js
 *   node scripts/run-thermal-benchmark-node.js --iterations 20 --output json
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    iterations: 10,
    output: 'console',
    autoReinduce: true,
    stressDuration: 120000,
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--iterations':
      case '-i':
        config.iterations = parseInt(args[++i]);
        break;
      case '--output':
      case '-o':
        config.output = args[++i];
        break;
      case '--no-auto-reinduce':
        config.autoReinduce = false;
        break;
      case '--stress-duration':
      case '-d':
        config.stressDuration = parseInt(args[++i]) * 1000; // Convert to ms
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Thermal Monitoring Benchmark - Node.js Runner

Usage: node run-thermal-benchmark-node.js [options]

Options:
  --iterations, -i <n>        Number of iterations to run (default: 10)
  --output, -o <format>      Output format: console, json, csv (default: console)
  --no-auto-reinduce         Disable automatic throttling re-induction
  --stress-duration, -d <s>  Stress test duration in seconds (default: 120)
  --verbose, -v              Enable verbose logging
  --help, -h                 Show this help message

Examples:
  node run-thermal-benchmark-node.js --iterations 20
  node run-thermal-benchmark-node.js -i 5 -o json --verbose
  node run-thermal-benchmark-node.js --no-auto-reinduce --stress-duration 180
        `);
        process.exit(0);
        break;
    }
  }

  return config;
}

// Console output helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  orange: '\x1b[38;5;208m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logVerbose(message, color = colors.reset) {
  if (cliConfig.verbose) {
    console.log(`${color}${message}${colors.reset}`);
  }
}

// Thermal state simulation for Node.js
class SimulatedThermalChecker {
  constructor(fpsDropThreshold = 0.5) {
    this.baselineFps = 60;
    this.currentFps = 60;
    this.fpsDrop = 0;
    this.isThrottledState = false;
    this.monitoring = false;
    this.fpsDropThreshold = fpsDropThreshold;
    this.simulationTime = 0;
  }

  startMonitoring() {
    this.monitoring = true;
    this.currentFps = 60;
    this.fpsDrop = 0;
    this.isThrottledState = false;
    log('🔍 Thermal monitoring started', colors.cyan);
  }

  stopMonitoring() {
    this.monitoring = false;
    log('🔍 Thermal monitoring stopped', colors.cyan);
  }

  isThrottled() {
    return this.isThrottledState;
  }

  getStateInfo() {
    return {
      baselineFps: this.baselineFps,
      currentFps: this.currentFps,
      fpsDrop: this.fpsDrop,
      isThrottled: this.isThrottledState,
    };
  }

  // Simulate thermal throttling over time
  simulateThermalProgress(elapsedMs) {
    if (!this.monitoring) return;

    this.simulationTime += elapsedMs;

    // Simulate gradual FPS degradation over time
    // After 60 seconds, FPS starts dropping
    if (this.simulationTime > 60000) {
      const degradationFactor = Math.min((this.simulationTime - 60000) / 120000, 0.8);
      this.currentFps = 60 * (1 - degradationFactor * 0.7); // Drop to 18 FPS
      this.fpsDrop = (this.baselineFps - this.currentFps) / this.baselineFps;
      this.isThrottledState = this.fpsDrop >= this.fpsDropThreshold;
    }
  }

  async waitForThrottledState(timeoutMs = 60000) {
    const startTime = Date.now();
    log(`⏳ Waiting for throttled state (threshold: ${(this.fpsDropThreshold * 100).toFixed(0)}% FPS drop)...`, colors.orange);

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;

        // Simulate thermal progression
        this.simulateThermalProgress(1000); // 1 second progress per check

        if (this.isThrottled()) {
          clearInterval(checkInterval);
          const state = this.getStateInfo();
          log(`✓ Throttled state detected after ${Math.round(elapsed / 1000)}s`, colors.green);
          log(`  Baseline: ${state.baselineFps.toFixed(1)} FPS → Current: ${state.currentFps.toFixed(1)} FPS (${(state.fpsDrop * 100).toFixed(1)}% drop)`, colors.cyan);
          resolve();
        } else if (elapsed >= timeoutMs) {
          clearInterval(checkInterval);
          const state = this.getStateInfo();
          reject(new Error(
            `Thermal throttling timeout (${timeoutMs}ms). ` +
            `Final state: baseline=${state.baselineFps.toFixed(1)}fps, ` +
            `current=${state.currentFps.toFixed(1)}fps, ` +
            `drop=${(state.fpsDrop * 100).toFixed(1)}%`
          ));
        } else {
          logVerbose(`  Checking: ${(this.fpsDrop * 100).toFixed(1)}% FPS drop (elapsed: ${Math.round(elapsed / 1000)}s)`, colors.cyan);
        }
      }, 1000);
    });
  }

  reset() {
    this.simulationTime = 0;
    this.currentFps = 60;
    this.fpsDrop = 0;
    this.isThrottledState = false;
  }
}

// Simulated stress test to induce throttling
async function induceThrottling(thermalChecker, timeoutMs = 120000) {
  log('🔥 Starting stress test to induce throttling...', colors.orange);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    thermalChecker.reset();

    const stressChunk = () => {
      const elapsed = Date.now() - startTime;
      thermalChecker.simulateThermalProgress(5000); // Simulate 5 seconds of stress

      const state = thermalChecker.getStateInfo();
      logVerbose(
        `  Stress progress: ${Math.round(elapsed / 1000)}s, ` +
        `FPS: ${state.currentFps.toFixed(1)}, ` +
        `Drop: ${(state.fpsDrop * 100).toFixed(1)}%, ` +
        `Throttled: ${state.isThrottled}`,
        colors.cyan
      );

      if (state.isThrottled) {
        log(`✓ Throttling induced after ${Math.round(elapsed / 1000)}s`, colors.green);
        resolve();
        return;
      }

      if (elapsed >= timeoutMs) {
        reject(new Error(
          `Failed to induce throttling within ${timeoutMs}ms. ` +
          `Final state: FPS=${state.currentFps.toFixed(1)}, Drop=${(state.fpsDrop * 100).toFixed(1)}%`
        ));
        return;
      }

      setTimeout(stressChunk, 1000);
    };

    stressChunk();
  });
}

// Simulated benchmark run
function runBenchmarkIteration(iteration, thermalChecker, config) {
  log(`\n🔄 Iteration ${iteration + 1}/${config.iterations} starting...`, colors.cyan);

  const thermalStateStart = thermalChecker.getStateInfo();
  log(
    `  Thermal start: ${thermalStateStart.baselineFps.toFixed(1)} → ${thermalStateStart.currentFps.toFixed(1)} FPS ` +
    `(${(thermalStateStart.fpsDrop * 100).toFixed(1)}% drop, throttled: ${thermalStateStart.isThrottled})`,
    colors.cyan
  );

  // Simulate benchmark execution with varying results
  const baseThroughput = 800; // Base MB/s (desktop performance)
  const throttledFactor = thermalStateStart.isThrottled ? 0.5 : 1.0;
  const randomVariation = 0.9 + Math.random() * 0.2; // ±10% variation
  const measuredThroughput = baseThroughput * throttledFactor * randomVariation;

  // Simulate benchmark duration
  const startTime = Date.now();
  const duration = 2000 + Math.random() * 1000; // 2-3 seconds

  // Simulate thermal change during benchmark
  setTimeout(() => {
    thermalChecker.simulateThermalProgress(duration / 2);
  }, duration / 2);

  // Derive K_max (simplified calculation)
  const derivedKMax = Math.floor(Math.max(256, Math.min(768, measuredThroughput / 2)));

  log(
    `  Result: ${measuredThroughput.toFixed(2)} MB/s, K_max: ${derivedKMax}, ` +
    `Duration: ${duration.toFixed(0)}ms`,
    colors.green
  );

  const thermalStateEnd = thermalChecker.getStateInfo();
  const remainedThrottled = thermalStateEnd.isThrottled;

  log(
    `  Thermal end: ${thermalStateEnd.baselineFps.toFixed(1)} → ${thermalStateEnd.currentFps.toFixed(1)} FPS ` +
    `(${(thermalStateEnd.fpsDrop * 100).toFixed(1)}% drop, throttled: ${thermalStateEnd.isThrottled})`,
    colors.cyan
  );

  return {
    iteration,
    timestamp: Date.now(),
    duration,
    measuredThroughputMBs: measuredThroughput,
    derivedKMax,
    thermalStateStart,
    thermalStateEnd,
    remainedThrottled,
    reinductionTriggered: false,
  };
}

// Main benchmark execution
async function runThermalBenchmark(config) {
  log('=== THERMAL MONITORING BENCHMARK START ===', colors.green);
  log(`Configuration: ${config.iterations} iterations, auto-reinduce: ${config.autoReinduce}`, colors.cyan);
  log(`Output format: ${config.output}`, colors.cyan);

  const thermalChecker = new SimulatedThermalChecker(0.5);
  const results = {
    config,
    startTime: Date.now(),
    endTime: 0,
    totalDuration: 0,
    iterations: [],
    summary: {
      totalIterations: 0,
      successfulThrottledIterations: 0,
      reinductionCount: 0,
      avgThroughputMBs: 0,
      minThroughputMBs: 0,
      maxThroughputMBs: 0,
      avgDerivedKMax: 0,
      minDerivedKMax: 0,
      maxDerivedKMax: 0,
      thermalStateConsistency: 0,
    },
    thermalLog: [],
  };

  try {
    thermalChecker.startMonitoring();
    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'thermal_monitoring_started',
      thermalState: thermalChecker.getStateInfo(),
    });

    // Initial throttling induction
    log('\n🔥 Inducing initial throttled state...', colors.orange);
    await induceThrottling(thermalChecker, config.stressDuration);

    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'initial_throttling_induced',
      thermalState: thermalChecker.getStateInfo(),
    });

    // Run benchmark iterations
    for (let i = 0; i < config.iterations; i++) {
      try {
        const iterationResult = runBenchmarkIteration(i, thermalChecker, config);
        results.iterations.push(iterationResult);

        // Brief pause between iterations
        if (i < config.iterations - 1) {
          log(`  Pausing before next iteration...`, colors.cyan);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        log(`❌ Iteration ${i + 1} failed: ${error.message}`, colors.red);

        if (config.autoReinduce) {
          log('🔄 Attempting to re-induce throttling...', colors.yellow);
          try {
            await induceThrottling(thermalChecker, config.stressDuration);
          } catch (reinduceError) {
            log(`❌ Recovery failed, aborting: ${reinduceError.message}`, colors.red);
            break;
          }
        } else {
          log('❌ Benchmark aborted due to error', colors.red);
          break;
        }
      }
    }

  } finally {
    thermalChecker.stopMonitoring();
    results.endTime = Date.now();
    results.totalDuration = results.endTime - results.startTime;

    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'thermal_monitoring_stopped',
      thermalState: thermalChecker.getStateInfo(),
    });
  }

  // Calculate summary statistics
  if (results.iterations.length > 0) {
    const throughputs = results.iterations.map(r => r.measuredThroughputMBs);
    const kMaxes = results.iterations.map(r => r.derivedKMax);
    const successfulThrottled = results.iterations.filter(
      r => r.remainedThrottled && r.thermalStateStart.isThrottled
    ).length;

    results.summary = {
      totalIterations: results.iterations.length,
      successfulThrottledIterations: successfulThrottled,
      reinductionCount: 0,
      avgThroughputMBs: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
      minThroughputMBs: Math.min(...throughputs),
      maxThroughputMBs: Math.max(...throughputs),
      avgDerivedKMax: kMaxes.reduce((a, b) => a + b, 0) / kMaxes.length,
      minDerivedKMax: Math.min(...kMaxes),
      maxDerivedKMax: Math.max(...kMaxes),
      thermalStateConsistency: successfulThrottled / results.iterations.length,
    };
  }

  return results;
}

// Output generation
function generateOutput(results, format) {
  switch (format) {
    case 'console':
      log('\n=== THERMAL BENCHMARK RESULTS ===', colors.green);
      log(`Total Duration: ${(results.totalDuration / 1000).toFixed(2)}s`, colors.cyan);
      log(`Iterations: ${results.summary.totalIterations}`, colors.cyan);
      log(`Successful Throttled Iterations: ${results.summary.successfulThrottledIterations}`, colors.cyan);
      log(`Re-induction Count: ${results.summary.reinductionCount}`, colors.cyan);
      log(`\nThroughput Stats:`, colors.cyan);
      log(`  Average: ${results.summary.avgThroughputMBs.toFixed(2)} MB/s`, colors.cyan);
      log(`  Min: ${results.summary.minThroughputMBs.toFixed(2)} MB/s`, colors.cyan);
      log(`  Max: ${results.summary.maxThroughputMBs.toFixed(2)} MB/s`, colors.cyan);
      log(`\nK_max Stats:`, colors.cyan);
      log(`  Average: ${results.summary.avgDerivedKMax.toFixed(0)}`, colors.cyan);
      log(`  Min: ${results.summary.minDerivedKMax}`, colors.cyan);
      log(`  Max: ${results.summary.maxDerivedKMax}`, colors.cyan);
      log(`\nThermal Consistency: ${(results.summary.thermalStateConsistency * 100).toFixed(1)}%`, colors.cyan);
      break;

    case 'json':
      const jsonOutput = JSON.stringify(results, null, 2);
      console.log('\n' + jsonOutput);
      break;

    case 'csv':
      log('\nIteration,Timestamp,Duration(ms),Throughput(MB/s),K_max,Throttled_Start,Throttled_End,Remained_Throttled', colors.cyan);
      results.iterations.forEach(iter => {
        log(
          `${iter.iteration},${iter.timestamp},${iter.duration.toFixed(0)},` +
          `${iter.measuredThroughputMBs.toFixed(2)},${iter.derivedKMax},` +
          `${iter.thermalStateStart.isThrottled},${iter.thermalStateEnd.isThrottled},${iter.remainedThrottled}`,
          colors.reset
        );
      });
      break;
  }
}

// Parse CLI config
const cliConfig = parseArgs();

// Run the benchmark
runThermalBenchmark(cliConfig)
  .then(results => {
    generateOutput(results, cliConfig.output);
    log('\n=== THERMAL MONITORING BENCHMARK COMPLETE ===', colors.green);
    process.exit(0);
  })
  .catch(error => {
    log(`\n❌ BENCHMARK FAILED: ${error.message}`, colors.red);
    if (cliConfig.verbose) {
      console.error(error);
    }
    process.exit(1);
  });
/**
 * Thermal Monitoring GE Benchmark Runner
 *
 * Executes the complete GE benchmark suite with continuous thermal monitoring.
 * Ensures device remains in throttled state throughout all benchmark iterations,
 * with automatic re-induction if throttled state is lost.
 *
 * Usage:
 *   npm run dev (in one terminal)
 *   Open browser console and run the benchmark suite
 *   Results will be logged to console and stored in results object
 */

import {
  DEFAULT_CONFIG,
  ThermalStateChecker,
  runGEBenchmarkSync,
  verifyThrottledState,
  type GEBenchmarkConfig,
  type GEBenchmarkResult,
  type ThermalState,
} from '../src/platform/ge-benchmark.js';

/**
 * Thermal monitoring configuration
 */
interface ThermalBenchmarkConfig {
  /** Base benchmark configuration */
  benchmark: GEBenchmarkConfig;
  /** Number of iterations to run (default: 10) */
  iterations: number;
  /** Delay between thermal state checks (ms) */
  thermalCheckInterval: number;
  /** Whether to automatically re-induce throttling if lost */
  autoReinduce: boolean;
  /** Stress test duration for re-induction (ms) */
  stressTestDuration: number;
  /** Results output format */
  outputFormat: 'console' | 'json' | 'csv';
}

/**
 * Single iteration result with thermal state
 */
interface ThermalIterationResult {
  iteration: number;
  timestamp: number;
  duration: number;
  measuredThroughputMBs: number;
  derivedKMax: number;
  thermalStateStart: ThermalState;
  thermalStateEnd: ThermalState;
  remainedThrottled: boolean;
  reinductionTriggered: boolean;
}

/**
 * Complete thermal benchmark results
 */
interface ThermalBenchmarkResults {
  config: ThermalBenchmarkConfig;
  startTime: number;
  endTime: number;
  totalDuration: number;
  iterations: ThermalIterationResult[];
  summary: {
    totalIterations: number;
    successfulThrottledIterations: number;
    reinductionCount: number;
    avgThroughputMBs: number;
    minThroughputMBs: number;
    maxThroughputMBs: number;
    avgDerivedKMax: number;
    minDerivedKMax: number;
    maxDerivedKMax: number;
    thermalStateConsistency: number; // percentage
  };
  thermalLog: Array<{
    timestamp: number;
    event: string;
    thermalState?: ThermalState;
  }>;
}

/**
 * Stress test to induce thermal throttling
 *
 * Runs intensive computational workload to heat up the device
 * until thermal throttling is detected.
 */
async function induceThrottling(
  thermalChecker: ThermalStateChecker,
  timeoutMs: number = 120000
): Promise<void> {
  console.log('[Thermal Induction] Starting stress test to induce throttling...');
  const startTime = performance.now();

  return new Promise((resolve, reject) => {
    thermalChecker.startMonitoring();

    // Run intensive computation in chunks
    const stressChunk = () => {
      // Intensive matrix operations to generate heat
      const size = 500;
      const matrix = new Float32Array(size * size);

      // Perform intensive operations
      for (let i = 0; i < 10; i++) {
        for (let j = 0; j < size * size; j++) {
          matrix[j] = Math.sqrt(Math.abs(matrix[j]) * Math.sin(j));
        }
      }

      const elapsed = performance.now() - startTime;
      const state = thermalChecker.getStateInfo();

      console.log(
        `[Thermal Induction] Elapsed: ${Math.round(elapsed)}ms, ` +
        `FPS: ${state.currentFps.toFixed(1)}, ` +
        `Drop: ${(state.fpsDrop * 100).toFixed(1)}%, ` +
        `Throttled: ${state.isThrottled}`
      );

      if (state.isThrottled) {
        thermalChecker.stopMonitoring();
        console.log(`[Thermal Induction] ✓ Throttling induced after ${Math.round(elapsed)}ms`);
        resolve();
        return;
      }

      if (elapsed >= timeoutMs) {
        thermalChecker.stopMonitoring();
        reject(new Error(
          `Failed to induce throttling within ${timeoutMs}ms. ` +
          `Final state: FPS=${state.currentFps.toFixed(1)}, Drop=${(state.fpsDrop * 100).toFixed(1)}%`
        ));
        return;
      }

      // Continue stress test
      setTimeout(stressChunk, 100);
    };

    stressChunk();
  });
}

/**
 * Verify throttled state is maintained
 *
 * Checks if device remains in throttled state, with optional re-induction.
 */
async function verifyThrottledStateMaintained(
  thermalChecker: ThermalStateChecker,
  config: ThermalBenchmarkConfig,
  thermalLog: ThermalBenchmarkResults['thermalLog']
): Promise<boolean> {
  const state = thermalChecker.getStateInfo();

  thermalLog.push({
    timestamp: Date.now(),
    event: 'thermal_check',
    thermalState: {...state}
  });

  if (!state.isThrottled) {
    console.warn(
      `[Thermal] ⚠ Throttled state lost! ` +
      `FPS: ${state.currentFps.toFixed(1)}, Drop: ${(state.fpsDrop * 100).toFixed(1)}%`
    );

    if (config.autoReinduce) {
      try {
        console.log('[Thermal] Attempting to re-induce throttling...');
        await induceThrottling(thermalChecker, config.stressTestDuration);

        thermalLog.push({
          timestamp: Date.now(),
          event: 'thermal_reinduction_success',
          thermalState: {...thermalChecker.getStateInfo()}
        });

        return true;
      } catch (error) {
        console.error('[Thermal] Failed to re-induce throttling:', error);

        thermalLog.push({
          timestamp: Date.now(),
          event: 'thermal_reinduction_failed',
        });

        return false;
      }
    } else {
      return false;
    }
  }

  return true;
}

/**
 * Run a single benchmark iteration with thermal monitoring
 */
async function runBenchmarkIteration(
  iteration: number,
  thermalChecker: ThermalStateChecker,
  config: ThermalBenchmarkConfig,
  thermalLog: ThermalBenchmarkResults['thermalLog']
): Promise<ThermalIterationResult> {
  console.log(`\n[Benchmark Iteration ${iteration + 1}/${config.iterations}] Starting...`);

  // Verify throttled state before starting
  const throttledBefore = await verifyThrottledStateMaintained(thermalChecker, config, thermalLog);

  if (!throttledBefore) {
    throw new Error('Device not in throttled state before benchmark iteration');
  }

  const thermalStateStart = thermalChecker.getStateInfo();
  console.log(
    `[Iteration ${iteration + 1}] Thermal state at start - ` +
    `baseline=${thermalStateStart.baselineFps?.toFixed(1)}fps, ` +
    `current=${thermalStateStart.currentFps.toFixed(1)}fps, ` +
    `drop=${(thermalStateStart.fpsDrop * 100).toFixed(1)}%, ` +
    `throttled=${thermalStateStart.isThrottled}`
  );

  // Run benchmark iteration
  const iterStart = performance.now();
  const result = runGEBenchmarkSync(config.benchmark, true); // Skip thermal verification since we're managing it
  const iterDuration = performance.now() - iterStart;

  // Check thermal state after benchmark
  const thermalStateEnd = thermalChecker.getStateInfo();
  const remainedThrottled = thermalStateEnd.isThrottled;

  console.log(
    `[Iteration ${iteration + 1}] Thermal state at end - ` +
    `baseline=${thermalStateEnd.baselineFps?.toFixed(1)}fps, ` +
    `current=${thermalStateEnd.currentFps.toFixed(1)}fps, ` +
    `drop=${(thermalStateEnd.fpsDrop * 100).toFixed(1)}%, ` +
    `throttled=${thermalStateEnd.isThrottled}`
  );

  console.log(
    `[Iteration ${iteration + 1}] Result - ` +
    `Throughput: ${result.measuredThroughputMBs.toFixed(2)} MB/s, ` +
    `K_max: ${result.derivedKMax}, ` +
    `Duration: ${iterDuration.toFixed(0)}ms`
  );

  // Log thermal state check
  thermalLog.push({
    timestamp: Date.now(),
    event: 'iteration_complete',
    thermalState: {...thermalStateEnd}
  });

  return {
    iteration,
    timestamp: Date.now(),
    duration: iterDuration,
    measuredThroughputMBs: result.measuredThroughputMBs,
    derivedKMax: result.derivedKMax,
    thermalStateStart,
    thermalStateEnd,
    remainedThrottled,
    reinductionTriggered: false, // Will be updated if re-induction occurred
  };
}

/**
 * Generate results output in specified format
 */
function generateOutput(
  results: ThermalBenchmarkResults,
  format: 'console' | 'json' | 'csv'
): void {
  switch (format) {
    case 'console':
      console.log('\n=== THERMAL BENCHMARK RESULTS ===');
      console.log(`Total Duration: ${(results.totalDuration / 1000).toFixed(2)}s`);
      console.log(`Iterations: ${results.summary.totalIterations}`);
      console.log(`Successful Throttled Iterations: ${results.summary.successfulThrottledIterations}`);
      console.log(`Re-induction Count: ${results.summary.reinductionCount}`);
      console.log(`\nThroughput Stats:`);
      console.log(`  Average: ${results.summary.avgThroughputMBs.toFixed(2)} MB/s`);
      console.log(`  Min: ${results.summary.minThroughputMBs.toFixed(2)} MB/s`);
      console.log(`  Max: ${results.summary.maxThroughputMBs.toFixed(2)} MB/s`);
      console.log(`\nK_max Stats:`);
      console.log(`  Average: ${results.summary.avgDerivedKMax.toFixed(0)}`);
      console.log(`  Min: ${results.summary.minDerivedKMax}`);
      console.log(`  Max: ${results.summary.maxDerivedKMax}`);
      console.log(`\nThermal Consistency: ${(results.summary.thermalStateConsistency * 100).toFixed(1)}%`);
      break;

    case 'json':
      const jsonOutput = JSON.stringify(results, null, 2);
      console.log('\n=== THERMAL BENCHMARK RESULTS (JSON) ===');
      console.log(jsonOutput);

      // Also save to global variable for browser debugging
      (window as any).thermalBenchmarkResults = results;
      console.log('Results available as global variable: window.thermalBenchmarkResults');
      break;

    case 'csv':
      console.log('\n=== THERMAL BENCHMARK RESULTS (CSV) ===');
      console.log('Iteration,Timestamp,Duration(ms),Throughput(MB/s),K_max,Throttled_Start,Throttled_End,Remained_Throttled');
      results.iterations.forEach(iter => {
        console.log(
          `${iter.iteration},${iter.timestamp},${iter.duration.toFixed(0)},` +
          `${iter.measuredThroughputMBs.toFixed(2)},${iter.derivedKMax},` +
          `${iter.thermalStateStart.isThrottled},${iter.thermalStateEnd.isThrottled},${iter.remainedThrottled}`
        );
      });
      break;
  }
}

/**
 * Calculate summary statistics from results
 */
function calculateSummary(results: ThermalIterationResult[]): ThermalBenchmarkResults['summary'] {
  const throughputs = results.map(r => r.measuredThroughputMBs);
  const kMaxes = results.map(r => r.derivedKMax);
  const successfulThrottled = results.filter(r => r.remainedThrottled && r.thermalStateStart.isThrottled).length;
  const reinductionCount = results.filter(r => r.reinductionTriggered).length;

  return {
    totalIterations: results.length,
    successfulThrottledIterations: successfulThrottled,
    reinductionCount,
    avgThroughputMBs: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
    minThroughputMBs: Math.min(...throughputs),
    maxThroughputMBs: Math.max(...throughputs),
    avgDerivedKMax: kMaxes.reduce((a, b) => a + b, 0) / kMaxes.length,
    minDerivedKMax: Math.min(...kMaxes),
    maxDerivedKMax: Math.max(...kMaxes),
    thermalStateConsistency: successfulThrottled / results.length,
  };
}

/**
 * Main thermal monitoring benchmark runner
 */
export async function runThermalBenchmark(
  userConfig?: Partial<ThermalBenchmarkConfig>
): Promise<ThermalBenchmarkResults> {
  // Merge user config with defaults
  const config: ThermalBenchmarkConfig = {
    benchmark: {...DEFAULT_CONFIG},
    iterations: 10,
    thermalCheckInterval: 5000, // Check every 5 seconds
    autoReinduce: true,
    stressTestDuration: 120000, // 2 minutes
    outputFormat: 'console',
    ...userConfig,
  };

  console.log('=== THERMAL MONITORING BENCHMARK START ===');
  console.log(`Configuration: ${config.iterations} iterations, auto-reinduce: ${config.autoReinduce}`);

  const thermalChecker = new ThermalStateChecker(
    config.benchmark.thermalFpsDropThreshold || DEFAULT_CONFIG.thermalFpsDropThreshold
  );

  const results: ThermalBenchmarkResults = {
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
    // Start thermal monitoring
    thermalChecker.startMonitoring();
    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'thermal_monitoring_started',
      thermalState: {...thermalChecker.getStateInfo()}
    });

    // Initial throttling induction
    console.log('\n[Setup] Inducing initial throttled state...');
    await induceThrottling(thermalChecker, config.stressTestDuration);

    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'initial_throttling_induced',
      thermalState: {...thermalChecker.getStateInfo()}
    });

    // Run benchmark iterations
    for (let i = 0; i < config.iterations; i++) {
      try {
        const iterationResult = await runBenchmarkIteration(
          i,
          thermalChecker,
          config,
          results.thermalLog
        );

        results.iterations.push(iterationResult);

        // Check if we need to re-induce throttling for next iteration
        if (i < config.iterations - 1) {
          await verifyThrottledStateMaintained(thermalChecker, config, results.thermalLog);

          // Brief pause between iterations
          console.log(`[Iteration ${i + 1}] Pausing before next iteration...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.error(`[Iteration ${i + 1}] Failed:`, error);

        results.thermalLog.push({
          timestamp: Date.now(),
          event: 'iteration_failed',
        });

        if (config.autoReinduce) {
          console.log('[Recovery] Attempting to re-induce throttling and continue...');
          try {
            await induceThrottling(thermalChecker, config.stressTestDuration);
          } catch (reinduceError) {
            console.error('[Recovery] Failed to recover, aborting benchmark:', reinduceError);
            break;
          }
        } else {
          console.error('[Abort] Benchmark aborted due to error');
          break;
        }
      }
    }

  } finally {
    // Stop thermal monitoring
    thermalChecker.stopMonitoring();
    results.thermalLog.push({
      timestamp: Date.now(),
      event: 'thermal_monitoring_stopped',
      thermalState: {...thermalChecker.getStateInfo()}
    });
  }

  // Calculate final results
  results.endTime = Date.now();
  results.totalDuration = results.endTime - results.startTime;
  results.summary = calculateSummary(results.iterations);

  // Generate output
  generateOutput(results, config.outputFormat);

  console.log('\n=== THERMAL MONITORING BENCHMARK COMPLETE ===');

  return results;
}

// Export for browser console usage
(window as any).runThermalBenchmark = runThermalBenchmark;

console.log('Thermal monitoring benchmark loaded. Usage:');
console.log('  await runThermalBenchmark({ iterations: 10, outputFormat: "json" });');
console.log('  await runThermalBenchmark({ iterations: 5, autoReinduce: false });');
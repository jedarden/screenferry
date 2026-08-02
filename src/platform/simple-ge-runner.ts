/**
 * Simple GE Benchmark Runner
 *
 * A focused benchmark runner for health check integration.
 * Runs the Gaussian Elimination benchmark and returns raw K value
 * without caching, refusal logic, or error codes.
 *
 * Reference: plan.md §16.4, D26/T1
 */

import { runGEBenchmarkSync, DEFAULT_CONFIG as GE_DEFAULT_CONFIG } from './ge-benchmark.js';

/**
 * Simple benchmark configuration.
 */
export interface SimpleGEBenchmarkConfig {
  /** Maximum duration for benchmark in ms. Defaults to 10000 (10s). */
  maxDuration?: number;
  /** Target K to benchmark. Defaults to 768. */
  targetK?: number;
  /** Number of trials. Defaults to 1 for speed. */
  trials?: number;
}

/**
 * Simple benchmark result.
 */
export interface SimpleGEBenchmarkResult {
  /** Maximum K this device can handle */
  kMax: number;
  /** Time to complete benchmark (ms) */
  duration: number;
  /** Whether benchmark completed successfully */
  success: boolean;
  /** Error message if benchmark failed */
  error?: string;
}

/**
 * Default simple benchmark configuration.
 *
 * Optimized for health check speed - single trial, 10s duration.
 */
export const DEFAULT_SIMPLE_CONFIG: SimpleGEBenchmarkConfig = {
  maxDuration: 10000, // 10 seconds for health checks
  targetK: 768,
  trials: 1, // Single trial for speed
};

/**
 * Run simple GE benchmark.
 *
 * This is a focused runner for health check integration.
 * It runs the benchmark with configurable duration and returns
 * the measured K value without caching or complex fallback logic.
 *
 * @param config - Benchmark configuration
 * @returns Benchmark result with K value and duration
 */
export function runSimpleGEBenchmark(
  config: SimpleGEBenchmarkConfig = DEFAULT_SIMPLE_CONFIG
): SimpleGEBenchmarkResult {
  const startTime = performance.now();

  try {
    // Map simple config to full GE config
    const geConfig = {
      ...GE_DEFAULT_CONFIG,
      targetK: config.targetK ?? DEFAULT_SIMPLE_CONFIG.targetK!,
      trials: config.trials ?? DEFAULT_SIMPLE_CONFIG.trials!,
    };

    // Run synchronous benchmark (reliable for health checks)
    const result = runGEBenchmarkSync(geConfig);
    const duration = performance.now() - startTime;

    // Check if duration exceeds max
    const maxDuration = config.maxDuration ?? DEFAULT_SIMPLE_CONFIG.maxDuration!;
    if (duration > maxDuration) {
      return {
        kMax: result.derivedKMax,
        duration,
        success: false,
        error: `Benchmark exceeded max duration of ${maxDuration}ms`,
      };
    }

    return {
      kMax: result.derivedKMax,
      duration,
      success: true,
    };
  } catch (e) {
    const duration = performance.now() - startTime;
    return {
      kMax: 0,
      duration,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run simple GE benchmark asynchronously.
 *
 * Async version that runs in a worker thread to avoid blocking UI.
 *
 * @param config - Benchmark configuration
 * @returns Benchmark result with K value and duration
 */
export async function runSimpleGEBenchmarkAsync(
  config: SimpleGEBenchmarkConfig = DEFAULT_SIMPLE_CONFIG
): Promise<SimpleGEBenchmarkResult> {
  const startTime = performance.now();

  try {
    // Import worker-based runner
    const { runGEBenchmark } = await import('./ge-benchmark.js');

    // Map simple config to full GE config
    const geConfig = {
      ...GE_DEFAULT_CONFIG,
      targetK: config.targetK ?? DEFAULT_SIMPLE_CONFIG.targetK!,
      trials: config.trials ?? DEFAULT_SIMPLE_CONFIG.trials!,
    };

    // Run benchmark in worker
    const result = await runGEBenchmark(geConfig);
    const duration = performance.now() - startTime;

    // Check if duration exceeds max
    const maxDuration = config.maxDuration ?? DEFAULT_SIMPLE_CONFIG.maxDuration!;
    if (duration > maxDuration) {
      return {
        kMax: result.derivedKMax,
        duration,
        success: false,
        error: `Benchmark exceeded max duration of ${maxDuration}ms`,
      };
    }

    return {
      kMax: result.derivedKMax,
      duration,
      success: true,
    };
  } catch (e) {
    const duration = performance.now() - startTime;
    return {
      kMax: 0,
      duration,
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
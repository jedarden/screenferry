/**
 * Test helper utilities for conditional memory sampling.
 *
 * Provides reusable utilities for controlling memory sampling behavior
 * based on test options, ensuring no overhead when sampling is disabled.
 *
 * Reference: bead bf-1vswx
 */

import type { TestOptions } from '../../src/test-options.js';
import {
  createMemorySampleStorage,
  captureMemorySample,
  detectMonotonicGrowth,
  type MemorySampleStorage,
  type MemorySample,
  type GrowthDetectionResult,
  type GrowthThresholdConfig,
} from '../../src/platform/memory-samples.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

/**
 * Memory sampling helper configuration.
 */
export interface MemorySamplingHelperConfig {
  /** Test options controlling sampling behavior */
  testOptions?: TestOptions;
  /** Sample every N blocks (default: 100) */
  sampleIntervalBlocks?: number;
  /** Output configuration for logging and file writing */
  outputConfig?: MemorySamplingOutputConfig;
}

/**
 * Required memory sampling helper configuration (with defaults applied).
 */
type RequiredMemorySamplingHelperConfig = {
  testOptions: TestOptions;
  sampleIntervalBlocks: number;
  outputConfig: Required<MemorySamplingOutputConfig>;
};

/**
 * Result of conditional memory sampling attempt.
 */
export interface MemorySamplingResult {
  /** Whether sampling was attempted (true if enabled) */
  attempted: boolean;
  /** Whether sampling was successful */
  success: boolean;
  /** Current sample count */
  sampleCount: number;
}

/**
 * Memory sampling output configuration.
 */
export interface MemorySamplingOutputConfig {
  /** Enable console logging (default: true) */
  consoleOutput?: boolean;
  /** Output file path for JSON metrics (optional) */
  outputFile?: string;
}

/**
 * Memory sampling helper class.
 *
 * Manages conditional memory sampling with automatic checking of
 * enableMemorySampling flag and interval tracking.
 */
export class MemorySamplingHelper {
  private samples: MemorySampleStorage;
  private config: RequiredMemorySamplingHelperConfig;
  private blockCounter: number = 0;
  private lastSampleBlock: number = -1;

  constructor(config: MemorySamplingHelperConfig = {}) {
    this.samples = createMemorySampleStorage();
    this.config = {
      testOptions: config.testOptions ?? { enableMemorySampling: false },
      sampleIntervalBlocks: config.sampleIntervalBlocks ?? 100,
      outputConfig: {
        consoleOutput: config.outputConfig?.consoleOutput ?? true,
        outputFile: config.outputConfig?.outputFile ?? '',
      },
    };
  }

  /**
   * Attempt to sample memory at current block.
   *
   * Only executes if enableMemorySampling flag is true and
   * enough blocks have passed since last sample.
   *
   * @param blockIndex - Current block index (optional, uses counter if not provided)
   * @param forceSample - Force sample regardless of interval (default: false)
   * @returns Sampling result with status information
   */
  sample(blockIndex?: number, forceSample = false): MemorySamplingResult {
    // Check if memory sampling is disabled
    if (!this.config.testOptions.enableMemorySampling) {
      return {
        attempted: false,
        success: false,
        sampleCount: this.samples.length,
      };
    }

    // Update block counter if explicit index provided
    if (blockIndex !== undefined) {
      this.blockCounter = blockIndex;
    }

    const currentBlock = this.blockCounter;
    const blocksSinceLastSample = currentBlock - this.lastSampleBlock;
    // Always sample at block 0, when forced, or when interval has passed
    const shouldSample = forceSample || currentBlock === 0 || blocksSinceLastSample >= this.config.sampleIntervalBlocks;

    if (!shouldSample) {
      return {
        attempted: true,
        success: false,
        sampleCount: this.samples.length,
      };
    }

    // Capture the sample using the helper's internal storage
    const success = captureMemorySample(
      this.samples,
      currentBlock,
      this.config.testOptions
    );

    if (success) {
      this.lastSampleBlock = currentBlock;
    }

    return {
      attempted: true,
      success,
      sampleCount: this.samples.length,
    };
  }

  /**
   * Increment block counter without sampling.
   */
  incrementBlockCounter(): void {
    this.blockCounter++;
  }

  /**
   * Get the collected memory samples.
   */
  getSamples(): MemorySampleStorage {
    return this.samples;
  }

  /**
   * Get the current sample count.
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Check if memory sampling is enabled.
   */
  isEnabled(): boolean {
    return this.config.testOptions.enableMemorySampling;
  }

  /**
   * Reset the sampling state.
   */
  reset(): void {
    this.samples = createMemorySampleStorage();
    this.blockCounter = 0;
    this.lastSampleBlock = -1;
  }

  /**
   * Calculate memory statistics from collected samples.
   */
  private calculateStats(): {
    initialHeap: number;
    peakHeap: number;
    finalHeap: number;
    heapGrowth: number;
    heapGrowthPercent: number;
    avgHeap: number;
    minHeap: number;
    sampleCount: number;
  } {
    if (this.samples.length === 0) {
      return {
        initialHeap: 0,
        peakHeap: 0,
        finalHeap: 0,
        heapGrowth: 0,
        heapGrowthPercent: 0,
        avgHeap: 0,
        minHeap: 0,
        sampleCount: 0,
      };
    }

    const heapValues = this.samples.map(s => s.heapUsage);
    const initialHeap = heapValues[0];
    const peakHeap = Math.max(...heapValues);
    const finalHeap = heapValues[heapValues.length - 1];
    const minHeap = Math.min(...heapValues);
    const heapGrowth = finalHeap - initialHeap;
    const heapGrowthPercent = initialHeap > 0 ? (heapGrowth / initialHeap) * 100 : 0;
    const avgHeap = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;

    return {
      initialHeap,
      peakHeap,
      finalHeap,
      heapGrowth,
      heapGrowthPercent,
      avgHeap,
      minHeap,
      sampleCount: this.samples.length,
    };
  }

  /**
   * Output collected memory metrics to console and/or file.
   *
   * This method should be called after all sampling is complete to output
   * the collected metrics. Output format is controlled by outputConfig.
   */
  outputMetrics(): void {
    if (this.samples.length === 0) {
      console.log('No memory samples collected.');
      return;
    }

    const stats = this.calculateStats();

    // Log to console if enabled
    if (this.config.outputConfig.consoleOutput) {
      this.logToConsole(stats);
    }

    // Write to file if configured
    if (this.config.outputConfig.outputFile) {
      this.writeToFile(stats);
    }
  }

  /**
   * Detect monotonic growth patterns in collected memory samples.
   *
   * Performs linear regression analysis to detect if memory usage shows
   * a monotonic increasing trend that may indicate a memory leak.
   *
   * Uses thresholds from testOptions.growthThresholds if available,
   * otherwise uses default thresholds.
   *
   * @returns Growth detection result with analysis
   *
   * @example
   * ```ts
   * const helper = createMemorySamplingHelper({
   *   testOptions: {
   *     enableMemorySampling: true,
   *     growthThresholds: {
   *       maxGrowthRate: 2048, // 2KB per block
   *       maxGrowthPercent: 25, // 25% growth
   *     }
   *   }
   * });
   * // ... collect samples ...
   * const result = helper.detectGrowth();
   * if (result.exceedsThreshold) {
   *   console.warn('Potential memory leak detected!');
   * }
   * ```
   */
  detectGrowth(): GrowthDetectionResult {
    const thresholds = this.config.testOptions.growthThresholds;
    return detectMonotonicGrowth(this.samples, thresholds);
  }

  /**
   * Check if memory growth exceeds configured thresholds.
   *
   * Convenience method that returns true if the growth detection
   * analysis indicates potential memory leak.
   *
   * @returns true if growth exceeds threshold, false otherwise
   */
  hasExcessiveGrowth(): boolean {
    const result = this.detectGrowth();
    return result.exceedsThreshold;
  }

  /**
   * Log memory statistics to console in human-readable format.
   */
  private logToConsole(stats: ReturnType<MemorySamplingHelper['calculateStats']>): void {
    console.log('\n=== Memory Sampling Results ===');
    console.log(`Samples collected: ${stats.sampleCount}`);
    console.log(`\nHeap Usage:`);
    console.log(`  Initial: ${(stats.initialHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Peak:    ${(stats.peakHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Final:   ${(stats.finalHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Min:     ${(stats.minHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Average: ${(stats.avgHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Growth:  ${(stats.heapGrowth / 1024 / 1024).toFixed(2)} MB (${stats.heapGrowthPercent.toFixed(2)}%)`);

    if (this.samples.length > 0) {
      console.log(`\nSample Details:`);
      console.log('  Block | Timestamp (ms) | Heap Usage (MB)');
      console.log('  -------+---------------+----------------');
      this.samples.forEach(sample => {
        const timestamp = sample.timestamp - this.samples[0].timestamp;
        console.log(`  ${String(sample.blockNumber).padStart(5)} | ${String(timestamp).padStart(13)} | ${(sample.heapUsage / 1024 / 1024).toFixed(2)}`);
      });
    }
    console.log('============================\n');
  }

  /**
   * Write memory metrics to file in machine-readable JSON format.
   */
  private writeToFile(stats: ReturnType<MemorySamplingHelper['calculateStats']>): void {
    const outputDir = this.config.outputConfig.outputFile.substring(0, this.config.outputConfig.outputFile.lastIndexOf('/'));
    if (outputDir && !existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const output = {
      metadata: {
        timestamp: new Date().toISOString(),
        sampleCount: stats.sampleCount,
        samplingIntervalBlocks: this.config.sampleIntervalBlocks,
      },
      stats: {
        initialHeap: `${(stats.initialHeap / 1024 / 1024).toFixed(2)} MB`,
        peakHeap: `${(stats.peakHeap / 1024 / 1024).toFixed(2)} MB`,
        finalHeap: `${(stats.finalHeap / 1024 / 1024).toFixed(2)} MB`,
        minHeap: `${(stats.minHeap / 1024 / 1024).toFixed(2)} MB`,
        heapGrowth: `${(stats.heapGrowth / 1024 / 1024).toFixed(2)} MB`,
        heapGrowthPercent: `${stats.heapGrowthPercent.toFixed(2)}%`,
        avgHeap: `${(stats.avgHeap / 1024 / 1024).toFixed(2)} MB`,
      },
      samples: this.samples.map(s => ({
        blockNumber: s.blockNumber,
        timestamp: new Date(s.timestamp).toISOString(),
        timestampRelative: s.timestamp - this.samples[0].timestamp,
        heapUsage: `${(s.heapUsage / 1024 / 1024).toFixed(2)} MB`,
        heapUsageBytes: s.heapUsage,
      })),
    };

    writeFileSync(this.config.outputConfig.outputFile, JSON.stringify(output, null, 2));
    console.log(`Memory metrics written to: ${this.config.outputConfig.outputFile}`);
  }
}

/**
 * Create a memory sampling helper with default configuration.
 *
 * @param config - Optional configuration
 * @returns New memory sampling helper instance
 *
 * @example
 * ```ts
 * // With sampling enabled
 * const helper = createMemorySamplingHelper({
 *   testOptions: { enableMemorySampling: true },
 *   sampleIntervalBlocks: 50,
 * });
 *
 * // With sampling disabled (default)
 * const helper = createMemorySamplingHelper();
 * ```
 */
export function createMemorySamplingHelper(
  config?: MemorySamplingHelperConfig
): MemorySamplingHelper {
  return new MemorySamplingHelper(config);
}

/**
 * Conditional memory sampling hook function.
 *
 * Wraps captureMemorySample with automatic enableMemorySampling check.
 * Returns immediately without overhead when flag is false.
 *
 * @param storage - Memory sample storage (only used if enabled)
 * @param blockNumber - Current block number
 * @param testOptions - Test options controlling behavior
 * @returns true if sample was captured, false if disabled or failed
 *
 * @example
 * ```ts
 * const samples = createMemorySampleStorage();
 * const options = { enableMemorySampling: true };
 *
 * // This will capture
 * conditionalCapture(samples, 10, options); // true
 *
 * // This will skip without overhead
 * const disabledOptions = { enableMemorySampling: false };
 * conditionalCapture(samples, 20, disabledOptions); // false
 * ```
 */
export function conditionalCapture(
  storage: MemorySampleStorage,
  blockNumber: number,
  testOptions?: TestOptions
): boolean {
  // Early return if sampling is disabled - no overhead
  // When testOptions is undefined, default to disabled (false)
  const isEnabled = testOptions?.enableMemorySampling ?? false;
  if (!isEnabled) {
    return false;
  }

  return captureMemorySample(storage, blockNumber, testOptions);
}

/**
 * Check if memory sampling should occur at a given block.
 *
 * @param blockIndex - Current block index
 * @param lastSampleBlock - Block index of last sample
 * @param sampleInterval - Sampling interval (default: 100)
 * @returns true if sampling should occur
 */
export function shouldSampleAtBlock(
  blockIndex: number,
  lastSampleBlock: number,
  sampleInterval: number = 100
): boolean {
  return blockIndex === 0 || (blockIndex - lastSampleBlock) >= sampleInterval;
}

/**
 * Safe memory sampling with interval and enable checks.
 *
 * Combines interval checking with enableMemorySampling flag check
 * for comprehensive conditional logic.
 *
 * @param storage - Memory sample storage
 * @param blockIndex - Current block index
 * @param lastSampleBlockRef - Reference to last sample block (will be updated if sample occurs)
 * @param testOptions - Test options controlling behavior
 * @param sampleInterval - Sampling interval (default: 100)
 * @returns true if sample was captured, false otherwise
 *
 * @example
 * ```ts
 * const samples = createMemorySampleStorage();
 * let lastSample = -1;
 * const options = { enableMemorySampling: true };
 *
 * for (let i = 0; i < 1000; i++) {
 *   safeMemorySampling(samples, i, &lastSample, options, 50);
 * }
 * ```
 */
export function safeMemorySampling(
  storage: MemorySampleStorage,
  blockIndex: number,
  lastSampleBlockRef: { value: number },
  testOptions?: TestOptions,
  sampleInterval: number = 100
): boolean {
  // Check if sampling is disabled
  if (testOptions !== undefined && !testOptions.enableMemorySampling) {
    return false;
  }

  // Check interval
  if (!shouldSampleAtBlock(blockIndex, lastSampleBlockRef.value, sampleInterval)) {
    return false;
  }

  // Capture sample and update reference
  const success = captureMemorySample(storage, blockIndex, testOptions);
  if (success) {
    lastSampleBlockRef.value = blockIndex;
  }

  return success;
}

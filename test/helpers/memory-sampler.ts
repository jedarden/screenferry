/**
 * Interval-based memory sampling for block processing.
 *
 * Provides lightweight memory sampling that hooks into block processing loops
 * to capture heap usage at regular intervals. Designed for integration tests.
 *
 * Reference: bead bf-2ofb5
 */

import { captureHeapMetrics, type HeapMetrics } from './heap-utils.js';

/**
 * Memory sample with block context.
 */
export interface MemorySample {
  /** Block index when sample was taken */
  blockIndex: number;
  /** Timestamp (milliseconds since epoch) */
  timestamp: number;
  /** Heap metrics at sample point */
  metrics: HeapMetrics;
}

/**
 * Memory sampler configuration.
 */
export interface MemorySamplerConfig {
  /** Sample every N blocks (default: 100) */
  sampleIntervalBlocks?: number;
  /** Enable/disable sampling (default: false - sampling is opt-in) */
  enabled?: boolean;
  /** Maximum samples to store (default: 1000) */
  maxSamples?: number;
}

/**
 * Interval-based memory sampler for block processing.
 *
 * This class provides simple memory sampling that can be hooked into
 * block processing loops in integration tests. It captures heap metrics
 * at configurable block intervals and stores them for later analysis.
 */
export class MemorySampler {
  private samples: MemorySample[] = [];
  private config: Required<MemorySamplerConfig>;
  private lastSampleBlock: number = -1;

  constructor(config: MemorySamplerConfig = {}) {
    this.config = {
      sampleIntervalBlocks: config.sampleIntervalBlocks ?? 100,
      enabled: config.enabled ?? false,
      maxSamples: config.maxSamples ?? 1000,
    };
  }

  /**
   * Sample memory at current block index.
   *
   * Call this method in block processing loops. It will only capture
   * a sample if the configured interval has passed since the last sample.
   *
   * @param blockIndex - Current block index being processed
   * @returns true if a sample was taken, false otherwise
   *
   * @example
   * ```ts
   * const sampler = new MemorySampler({ sampleIntervalBlocks: 100 });
   * for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
   *   processBlock(blockIndex);
   *   sampler.sample(blockIndex); // Only samples every 100 blocks
   * }
   * ```
   */
  sample(blockIndex: number): boolean {
    // Skip if disabled
    if (!this.config.enabled) {
      return false;
    }

    // Sample on first call or when enough blocks have passed since last sample
    const isFirstSample = this.lastSampleBlock === -1;
    const blocksSinceLastSample = isFirstSample ? 0 : blockIndex - this.lastSampleBlock;
    const shouldSample = isFirstSample || blocksSinceLastSample >= this.config.sampleIntervalBlocks;

    if (!shouldSample) {
      return false;
    }

    // Capture sample
    const sample: MemorySample = {
      blockIndex,
      timestamp: Date.now(),
      metrics: captureHeapMetrics(),
    };

    // Store sample (with max limit)
    this.samples.push(sample);
    if (this.samples.length > this.config.maxSamples) {
      this.samples.shift(); // Remove oldest sample
    }

    this.lastSampleBlock = blockIndex;
    return true;
  }

  /**
   * Force a sample regardless of interval.
   *
   * Useful for capturing initial/final states or specific points of interest.
   *
   * @param blockIndex - Current block index
   */
  sampleForce(blockIndex: number): void {
    if (!this.config.enabled) {
      return;
    }

    const sample: MemorySample = {
      blockIndex,
      timestamp: Date.now(),
      metrics: captureHeapMetrics(),
    };

    this.samples.push(sample);
    if (this.samples.length > this.config.maxSamples) {
      this.samples.shift();
    }

    this.lastSampleBlock = blockIndex;
  }

  /**
   * Get all collected samples.
   */
  getSamples(): ReadonlyArray<MemorySample> {
    return this.samples;
  }

  /**
   * Get sample count.
   */
  getSampleCount(): number {
    return this.samples.length;
  }

  /**
   * Clear all samples.
   */
  clear(): void {
    this.samples = [];
    this.lastSampleBlock = -1;
  }

  /**
   * Get the sample at a specific block index.
   */
  getSampleAtBlock(blockIndex: number): MemorySample | undefined {
    return this.samples.find(s => s.blockIndex === blockIndex);
  }

  /**
   * Get samples within a block range.
   */
  getSamplesInRange(startBlock: number, endBlock: number): MemorySample[] {
    return this.samples.filter(
      s => s.blockIndex >= startBlock && s.blockIndex <= endBlock
    );
  }

  /**
   * Get the first sample.
   */
  getFirstSample(): MemorySample | undefined {
    return this.samples[0];
  }

  /**
   * Get the last sample.
   */
  getLastSample(): MemorySample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /**
   * Calculate heap growth between first and last samples.
   */
  getTotalHeapGrowth(): number {
    if (this.samples.length < 2) {
      return 0;
    }

    const first = this.samples[0].metrics.heapUsed;
    const last = this.samples[this.samples.length - 1].metrics.heapUsed;
    return last - first;
  }

  /**
   * Get peak heap usage across all samples.
   */
  getPeakHeapUsage(): number {
    if (this.samples.length === 0) {
      return 0;
    }

    return Math.max(...this.samples.map(s => s.metrics.heapUsed));
  }

  /**
   * Check if sampling is enabled.
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the sampler configuration.
   */
  getConfig(): Readonly<Required<MemorySamplerConfig>> {
    return this.config;
  }
}

/**
 * Create a memory sampler with default configuration.
 */
export function createMemorySampler(config?: MemorySamplerConfig): MemorySampler {
  return new MemorySampler(config);
}

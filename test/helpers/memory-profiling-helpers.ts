/**
 * Test helper utilities for memory profiling in integration tests.
 *
 * Provides reusable utilities for:
 * - Heap usage measurement at block intervals
 * - Memory metrics logging (console + file output)
 * - Monotonic growth pattern detection
 * - Machine-readable memory stats output
 *
 * Reference: bead bf-3pshd
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Memory measurement snapshot at a point in time.
 */
export interface MemorySnapshot {
  timestamp: number;
  blockIndex?: number | undefined;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  arrayBuffers: number;
}

/**
 * Memory profiling configuration.
 */
export interface MemoryProfileConfig {
  sampleIntervalBlocks?: number | undefined; // Sample every N blocks (default: 100)
  enableGC?: boolean | undefined; // Force GC before each sample (default: false)
  outputFile?: string | undefined; // Optional file output path
  consoleOutput?: boolean | undefined; // Enable console logging (default: true)
}

/**
 * Memory profile result with analysis.
 */
export interface MemoryProfileResult {
  snapshots: MemorySnapshot[];
  stats: MemoryStats;
  growthAnalysis: GrowthAnalysis;
  metadata: ProfileMetadata;
}

/**
 * Memory statistics over the profiling period.
 */
export interface MemoryStats {
  initialHeap: number;
  peakHeap: number;
  finalHeap: number;
  heapGrowth: number;
  heapGrowthPercent: number;
  avgHeap: number;
  sampleCount: number;
}

/**
 * Growth pattern analysis results.
 */
export interface GrowthAnalysis {
  hasMonotonicGrowth: boolean;
  growthRate: number; // bytes per sample
  leakProbability: 'low' | 'medium' | 'high';
  alerts: GrowthAlert[];
}

/**
 * Alert for suspicious memory patterns.
 */
export interface GrowthAlert {
  type: 'monotonic-growth' | 'spike' | 'plateau' | 'cleanup-detected';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  value?: number | undefined;
}

/**
 * Profile metadata.
 */
export interface ProfileMetadata {
  startTime: string;
  endTime: string;
  duration: number; // milliseconds
  totalBlocks?: number | undefined;
  config: MemoryProfileConfig;
}

/**
 * Memory profiler for integration tests.
 */
export class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];
  private config: Required<MemoryProfileConfig>;
  private startTime: number = 0;
  private startHeap: number = 0;
  private blockCounter: number = 0;
  private lastSampleBlock: number = -1;

  constructor(config: MemoryProfileConfig = {}) {
    this.config = {
      sampleIntervalBlocks: config.sampleIntervalBlocks ?? 100,
      enableGC: config.enableGC ?? false,
      outputFile: config.outputFile ?? '',
      consoleOutput: config.consoleOutput ?? true,
    };
  }

  /**
   * Start profiling session.
   */
  start(): void {
    this.startTime = Date.now();
    this.startHeap = process.memoryUsage().heapUsed;
    this.snapshots = [];
    this.blockCounter = 0;
    this.lastSampleBlock = -1;

    this.takeInitialSnapshot();
  }

  /**
   * Take a memory sample at block processing point.
   *
   * @param blockIndex - Current block index being processed (optional, uses current counter if not provided)
   * @param forceSample - Force sample regardless of interval (default: false)
   */
  sample(blockIndex?: number | undefined, forceSample = false): void {
    // Update block counter if explicit index provided
    if (blockIndex !== undefined) {
      this.blockCounter = blockIndex;
    }

    const currentBlock = this.blockCounter;
    // Sample if forced, or if enough blocks have passed since last sample
    const blocksSinceLastSample = currentBlock - this.lastSampleBlock;
    const shouldSample = forceSample || blocksSinceLastSample >= this.config.sampleIntervalBlocks;

    if (!shouldSample) {
      return;
    }

    this.takeSnapshot(currentBlock);
    this.lastSampleBlock = currentBlock;
  }

  /**
   * Increment block counter (for interval tracking without explicit index).
   */
  incrementBlockCounter(): void {
    this.blockCounter++;
  }

  /**
   * Stop profiling and return results.
   */
  stop(): MemoryProfileResult {
    const endTime = Date.now();

    // Take final snapshot
    this.takeSnapshot(undefined);

    const result = this.analyze(endTime);
    result.metadata.endTime = new Date(endTime).toISOString();
    result.metadata.duration = endTime - this.startTime;

    // Write to file if configured
    if (this.config.outputFile) {
      this.writeToFile(result);
    }

    // Log to console if configured
    if (this.config.consoleOutput) {
      this.logToConsole(result);
    }

    return result;
  }

  /**
   * Get current memory usage without storing.
   */
  getCurrentUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * Force garbage collection if available.
   */
  forceGC(): void {
    if (this.config.enableGC && globalThis.gc) {
      globalThis.gc();
    }
  }

  /**
   * Take initial baseline snapshot.
   */
  private takeInitialSnapshot(): void {
    this.forceGC();
    const usage = this.getCurrentUsage();

    this.snapshots.push({
      timestamp: Date.now() - this.startTime,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    });
  }

  /**
   * Take a snapshot at current point.
   */
  private takeSnapshot(blockIndex?: number | undefined): void {
    this.forceGC();
    const usage = this.getCurrentUsage();

    this.snapshots.push({
      timestamp: Date.now() - this.startTime,
      blockIndex,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    });
  }

  /**
   * Analyze collected snapshots and generate statistics.
   */
  private analyze(endTime: number): MemoryProfileResult {
    if (this.snapshots.length === 0) {
      throw new Error('No snapshots collected');
    }

    const stats = this.calculateStats();
    const growthAnalysis = this.analyzeGrowth();

    // Get the maximum block index from all snapshots
    const blockIndices = this.snapshots
      .filter(s => s.blockIndex !== undefined)
      .map(s => s.blockIndex!);

    const maxBlockIndex = blockIndices.length > 0
      ? Math.max(...blockIndices)
      : undefined;

    const metadata: ProfileMetadata = {
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      duration: endTime - this.startTime,
      totalBlocks: maxBlockIndex,
      config: this.config,
    };

    return {
      snapshots: [...this.snapshots],
      stats,
      growthAnalysis,
      metadata,
    };
  }

  /**
   * Calculate memory statistics.
   */
  private calculateStats(): MemoryStats {
    const heapValues = this.snapshots.map(s => s.heapUsed);
    const initialHeap = heapValues[0] ?? 0;
    const peakHeap = Math.max(...heapValues);
    const finalHeap = heapValues[heapValues.length - 1] ?? 0;
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
      sampleCount: this.snapshots.length,
    };
  }

  /**
   * Analyze growth patterns and detect leaks.
   */
  private analyzeGrowth(): GrowthAnalysis {
    const heapValues = this.snapshots.map(s => s.heapUsed);
    const alerts: GrowthAlert[] = [];

    // Check for monotonic growth
    let monotonicIncreases = 0;
    for (let i = 1; i < heapValues.length; i++) {
      if (heapValues[i] > heapValues[i - 1]) {
        monotonicIncreases++;
      }
    }
    const hasMonotonicGrowth = monotonicIncreases >= (heapValues.length * 0.8);

    if (hasMonotonicGrowth) {
      alerts.push({
        type: 'monotonic-growth',
        severity: 'warning',
        message: `Memory increased monotonically in ${monotonicIncreases}/${heapValues.length - 1} samples`,
        startIndex: 0,
        endIndex: heapValues.length - 1,
        value: monotonicIncreases,
      });
    }

    // Calculate growth rate
    const growthRate = heapValues.length > 1
      ? (heapValues[heapValues.length - 1] - heapValues[0]) / (heapValues.length - 1)
      : 0;

    // Detect spikes (sudden large increases)
    for (let i = 1; i < heapValues.length; i++) {
      const delta = heapValues[i] - heapValues[i - 1];
      const deltaPercent = heapValues[i - 1] > 0 ? (delta / heapValues[i - 1]) * 100 : 0;

      if (deltaPercent > 10) { // More than 10% increase
        alerts.push({
          type: 'spike',
          severity: 'info',
          message: `Memory spike detected: ${(delta / 1024 / 1024).toFixed(2)} MB increase (${deltaPercent.toFixed(1)}%)`,
          startIndex: i - 1,
          endIndex: i,
          value: delta,
        });
      }
    }

    // Detect cleanup (significant memory drops)
    for (let i = 1; i < heapValues.length; i++) {
      const delta = heapValues[i] - heapValues[i - 1];
      const deltaPercent = heapValues[i - 1] > 0 ? (delta / heapValues[i - 1]) * 100 : 0;

      if (deltaPercent < -5) { // More than 5% decrease
        alerts.push({
          type: 'cleanup-detected',
          severity: 'info',
          message: `Memory cleanup detected: ${(-delta / 1024 / 1024).toFixed(2)} MB freed`,
          startIndex: i - 1,
          endIndex: i,
          value: delta,
        });
      }
    }

    // Determine leak probability
    let leakProbability: 'low' | 'medium' | 'high' = 'low';
    if (hasMonotonicGrowth && this.snapshots[this.snapshots.length - 1].heapUsed > this.snapshots[0].heapUsed * 1.5) {
      leakProbability = 'high';
    } else if (hasMonotonicGrowth) {
      leakProbability = 'medium';
    }

    return {
      hasMonotonicGrowth,
      growthRate,
      leakProbability,
      alerts,
    };
  }

  /**
   * Write results to file.
   */
  private writeToFile(result: MemoryProfileResult): void {
    const outputDir = this.config.outputFile.substring(0, this.config.outputFile.lastIndexOf('/'));
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const output = {
      metadata: result.metadata,
      stats: {
        initialHeap: `${(result.stats.initialHeap / 1024 / 1024).toFixed(2)} MB`,
        peakHeap: `${(result.stats.peakHeap / 1024 / 1024).toFixed(2)} MB`,
        finalHeap: `${(result.stats.finalHeap / 1024 / 1024).toFixed(2)} MB`,
        heapGrowth: `${(result.stats.heapGrowth / 1024 / 1024).toFixed(2)} MB`,
        heapGrowthPercent: `${result.stats.heapGrowthPercent.toFixed(2)}%`,
        avgHeap: `${(result.stats.avgHeap / 1024 / 1024).toFixed(2)} MB`,
        sampleCount: result.stats.sampleCount,
      },
      growthAnalysis: result.growthAnalysis,
      snapshots: result.snapshots.map(s => ({
        ...s,
        heapUsed: `${(s.heapUsed / 1024 / 1024).toFixed(2)} MB`,
        heapTotal: `${(s.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        rss: `${(s.rss / 1024 / 1024).toFixed(2)} MB`,
      })),
    };

    writeFileSync(this.config.outputFile, JSON.stringify(output, null, 2));
  }

  /**
   * Log results to console.
   */
  private logToConsole(result: MemoryProfileResult): void {
    console.log('\n=== Memory Profile Results ===');
    console.log(`Duration: ${result.metadata.duration} ms`);
    console.log(`Samples: ${result.stats.sampleCount}`);
    console.log(`\nHeap Usage:`);
    console.log(`  Initial: ${(result.stats.initialHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Peak:    ${(result.stats.peakHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Final:   ${(result.stats.finalHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Growth:  ${(result.stats.heapGrowth / 1024 / 1024).toFixed(2)} MB (${result.stats.heapGrowthPercent.toFixed(2)}%)`);
    console.log(`  Average: ${(result.stats.avgHeap / 1024 / 1024).toFixed(2)} MB`);
    console.log(`\nGrowth Analysis:`);
    console.log(`  Monotonic Growth: ${result.growthAnalysis.hasMonotonicGrowth}`);
    console.log(`  Growth Rate: ${(result.growthAnalysis.growthRate / 1024 / 1024).toFixed(4)} MB/sample`);
    console.log(`  Leak Probability: ${result.growthAnalysis.leakProbability}`);

    if (result.growthAnalysis.alerts.length > 0) {
      console.log(`\nAlerts (${result.growthAnalysis.alerts.length}):`);
      result.growthAnalysis.alerts.forEach(alert => {
        console.log(`  [${alert.severity.toUpperCase()}] ${alert.message}`);
      });
    }
    console.log('============================\n');
  }
}

/**
 * Create a memory profiler with default configuration.
 */
export function createMemoryProfiler(config?: MemoryProfileConfig): MemoryProfiler {
  return new MemoryProfiler(config);
}

/**
 * Assert memory constraints are met.
 */
export function assertMemoryConstraints(
  result: MemoryProfileResult,
  maxHeapMB: number,
  maxGrowthPercent: number
): void {
  const peakHeapMB = result.stats.peakHeap / 1024 / 1024;
  const growthPercent = result.stats.heapGrowthPercent;

  if (peakHeapMB > maxHeapMB) {
    throw new Error(
      `Peak heap usage ${peakHeapMB.toFixed(2)} MB exceeds limit of ${maxHeapMB} MB`
    );
  }

  if (Math.abs(growthPercent) > maxGrowthPercent && growthPercent > 0) {
    throw new Error(
      `Heap growth ${growthPercent.toFixed(2)}% exceeds limit of ${maxGrowthPercent}%`
    );
  }
}

/**
 * Assert no memory leak detected.
 */
export function assertNoMemoryLeak(result: MemoryProfileResult): void {
  if (result.growthAnalysis.leakProbability === 'high') {
    throw new Error(
      `High memory leak probability detected: ` +
      `monotonic growth=${result.growthAnalysis.hasMonotonicGrowth}, ` +
      `growth=${(result.stats.heapGrowth / 1024 / 1024).toFixed(2)} MB`
    );
  }
}

/**
 * Get memory snapshot at specific block index.
 */
export function getSnapshotAtBlock(
  result: MemoryProfileResult,
  blockIndex: number
): MemorySnapshot | undefined {
  return result.snapshots.find(s => s.blockIndex === blockIndex);
}

/**
 * Compare two memory profiles and return differences.
 */
export function compareProfiles(
  baseline: MemoryProfileResult,
  current: MemoryProfileResult
): {
  heapGrowthDiff: number;
  peakHeapDiff: number;
  leakProbabilityComparison: string;
} {
  return {
    heapGrowthDiff: current.stats.heapGrowth - baseline.stats.heapGrowth,
    peakHeapDiff: current.stats.peakHeap - baseline.stats.peakHeap,
    leakProbabilityComparison: `${baseline.growthAnalysis.leakProbability} → ${current.growthAnalysis.leakProbability}`,
  };
}
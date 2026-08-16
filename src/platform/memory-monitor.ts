/**
 * Memory monitoring instrumentation for receiver degradation investigation
 *
 * This module provides tools to track heap usage, object counts, and resource
 * leaks during long-running receiver sessions to identify performance degradation.
 *
 * Per task bf-2p07: Receiver decode degrades 4.7x over long sessions; reload restores it.
 * This instrumentation helps identify the root cause by tracking:
 * - Heap size over time
 * - Array growth patterns
 * - Worker resource counts
 * - Per-frame allocation patterns
 */

export interface MemorySnapshot {
  timestamp: number;
  frameIndex: number;
  heapSize: number;
  heapUsed: number;
  heapLimit: number;

  // Handle counts (if available)
  handleCount?: number;

  // Array sizes
  frameTimestampsCount: number;
  decodeLatenciesCount: number;
  packetsPerFrameCount: number;

  // Worker pool state
  inFlightFrames: number;
  workerCount: number;

  // Calculated metrics
  heapGrowthRate: number; // bytes per frame
  avgGrowthRate: number; // bytes per second since start

  // Session context
  sessionTime?: number; // seconds since session start

  // Handle breakdown (if available from performance.measureUserAgentSpecificMemory)
  handleBreakdown?: {
    jsHeapSize?: number;
    externalResources?: number;
    nativeResources?: number;
  };
}

export interface MemoryMonitorConfig {
  /** Sample interval in frames (default: 60 = ~2 seconds at 30fps) */
  sampleInterval?: number;

  /** Maximum snapshots to keep in memory (default: 1000) */
  maxSnapshots?: number;

  /** Enable detailed array tracking (default: true) */
  trackArrays?: boolean;

  /** Enable worker pool tracking (default: true) */
  trackWorkers?: boolean;

  /** Session ID for metrics export (auto-generated if not provided) */
  sessionId?: string;

  /** Enable handle tracking if browser supports it (default: true) */
  trackHandles?: boolean;

  /** Frame rate for time calculations (default: 30fps) */
  frameRate?: number;
}

/**
 * Memory monitor for tracking heap usage and detecting leaks
 */
export class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private config: Required<MemoryMonitorConfig>;
  private startTimestamp: number = 0;
  private startFrameIndex: number = 0;
  private previousSnapshot: MemorySnapshot | null = null;
  private monitoringActive: boolean = false;
  private sessionId: string;
  private isNodeEnv: boolean;
  private pendingHandleMeasurement: Promise<PerformanceEntry | null> | null = null;
  private lastHandleMeasurement: number | null = null;

  constructor(config: MemoryMonitorConfig = {}) {
    this.sessionId = config.sessionId ?? this.generateSessionId();
    this.isNodeEnv = typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
    this.config = {
      sampleInterval: config.sampleInterval ?? 60,
      maxSnapshots: config.maxSnapshots ?? 1000,
      trackArrays: config.trackArrays ?? true,
      trackWorkers: config.trackWorkers ?? true,
      trackHandles: config.trackHandles ?? true,
      frameRate: config.frameRate ?? 30,
    };
  }

  private getCurrentTime(): number {
    if (this.isNodeEnv) {
      return Date.now();
    }
    return performance.now();
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Start monitoring memory usage
   */
  startMonitoring(initialFrameIndex: number = 0): void {
    this.startTimestamp = performance.now();
    this.startFrameIndex = initialFrameIndex;
    this.snapshots = [];
    this.previousSnapshot = null;
    this.monitoringActive = true;

    console.log(`[Memory Monitor] Started monitoring session ${this.sessionId} at frame ${initialFrameIndex}`);
  }

  /**
   * Stop monitoring and return collected snapshots
   */
  stopMonitoring(): MemorySnapshot[] {
    this.monitoringActive = false;
    console.log(`[Memory Monitor] Stopped monitoring session ${this.sessionId}. Collected ${this.snapshots.length} snapshots`);
    return [...this.snapshots];
  }

  /**
   * Take a memory snapshot at the current frame
   *
   * This should be called periodically (e.g., every N frames) to track
   * heap growth and identify potential leaks.
   */
  takeSnapshot(frameIndex: number, context: {
    frameTimestampsCount?: number;
    decodeLatenciesCount?: number;
    packetsPerFrameCount?: number;
    inFlightFrames?: number;
    workerCount?: number;
  }): MemorySnapshot | null {
    if (!this.monitoringActive) {
      return null;
    }

    // Check if we should sample this frame
    const framesSinceStart = frameIndex - this.startFrameIndex;
    if (framesSinceStart % this.config.sampleInterval !== 0) {
      return null;
    }

    // Get memory information if available
    let heapSize = 0;
    let heapUsed = 0;
    let heapLimit = 0;
    let handleCount: number | undefined = undefined;

    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      heapSize = memory.jsHeapSizeLimit || 0;
      heapUsed = memory.usedJSHeapSize || 0;
      heapLimit = memory.jsHeapSizeLimit || 0;
    }

    // Try to get handle count if available (browser-specific APIs)
    if (this.config.trackHandles && typeof window !== 'undefined' && 'performance' in window) {
      // Some browsers provide handle count information via performance.measureUserAgentSpecificMemory()
      // This is experimental but available in Chrome 89+
      try {
        if ('measureUserAgentSpecificMemory' in performance) {
          // We'll capture this asynchronously in a separate method
        }
      } catch (e) {
        // Handle count not available, continue without it
      }
    }

    // For Node.js environment, try to get heap info from process.memoryUsage()
    if (typeof process !== 'undefined' && process.memoryUsage) {
      try {
        const nodeMemory = process.memoryUsage();
        heapUsed = nodeMemory.heapUsed;
        heapLimit = nodeMemory.heapTotal + (nodeMemory.external || 0);
        heapSize = heapLimit;
      } catch (e) {
        // Node.js memory info not available, continue without it
      }
    }

    // Calculate session time
    const sessionTime = (performance.now() - this.startTimestamp) / 1000; // seconds

    // Calculate growth rates
    let heapGrowthRate = 0;
    let avgGrowthRate = 0;

    if (this.previousSnapshot) {
      const frameDelta = frameIndex - this.previousSnapshot.frameIndex;
      const timeDelta = performance.now() - this.previousSnapshot.timestamp;

      if (frameDelta > 0) {
        heapGrowthRate = (heapUsed - this.previousSnapshot.heapUsed) / frameDelta;
      }

      if (timeDelta > 0) {
        avgGrowthRate = (heapUsed - this.snapshots[0]?.heapUsed || 0) / (timeDelta / 1000);
      }
    }

    // Create snapshot
    const snapshot: MemorySnapshot = {
      timestamp: performance.now(),
      frameIndex,
      heapSize,
      heapUsed,
      heapLimit,
      handleCount,
      frameTimestampsCount: this.config.trackArrays ? (context.frameTimestampsCount ?? 0) : 0,
      decodeLatenciesCount: this.config.trackArrays ? (context.decodeLatenciesCount ?? 0) : 0,
      packetsPerFrameCount: this.config.trackArrays ? (context.packetsPerFrameCount ?? 0) : 0,
      inFlightFrames: this.config.trackWorkers ? (context.inFlightFrames ?? 0) : 0,
      workerCount: this.config.trackWorkers ? (context.workerCount ?? 0) : 0,
      heapGrowthRate,
      avgGrowthRate,
      sessionTime,
    };

    this.previousSnapshot = snapshot;
    this.snapshots.push(snapshot);

    // Trim snapshots if we exceed the limit
    if (this.snapshots.length > this.config.maxSnapshots) {
      this.snapshots.shift();
    }

    // Log warning if heap is growing rapidly
    if (heapGrowthRate > 1000) { // More than 1KB per frame
      console.warn(`[Memory Monitor] Rapid heap growth detected: ${(heapGrowthRate / 1024).toFixed(2)} KB/frame at frame ${frameIndex}`);
    }

    return snapshot;
  }

  /**
   * Get all collected snapshots
   */
  getSnapshots(): MemorySnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Analyze snapshots to identify potential leaks
   *
   * Returns an object with analysis results indicating whether there are
   * signs of memory leaks in the tracked components.
   */
  analyzeLeaks(): {
    hasHeapLeak: boolean;
    hasArrayLeak: boolean;
    hasWorkerLeak: boolean;
    details: string;
  } {
    if (this.snapshots.length < 2) {
      return {
        hasHeapLeak: false,
        hasArrayLeak: false,
        hasWorkerLeak: false,
        details: 'Insufficient data for analysis',
      };
    }

    const first = this.snapshots[0]!;
    const last = this.snapshots[this.snapshots.length - 1]!;

    // Check heap growth
    const heapGrowthBytes = last.heapUsed - first.heapUsed;
    const durationSeconds = (last.timestamp - first.timestamp) / 1000;
    const heapGrowthRate = heapGrowthBytes / durationSeconds;

    const hasHeapLeak = heapGrowthRate > 100_000; // More than 100KB/s sustained growth

    // Check array growth
    const timestampsGrowth = last.frameTimestampsCount - first.frameTimestampsCount;
    const latenciesGrowth = last.decodeLatenciesCount - first.decodeLatenciesCount;
    const packetsGrowth = last.packetsPerFrameCount - first.packetsPerFrameCount;

    const hasArrayLeak = timestampsGrowth > 1000 || latenciesGrowth > 1000 || packetsGrowth > 1000;

    // Check worker resource leaks
    const workerGrowth = last.inFlightFrames - first.inFlightFrames;
    const hasWorkerLeak = workerGrowth > 0; // In-flight frames should not accumulate

    // Generate detailed report
    const details = [
      `Heap: ${formatBytes(first.heapUsed)} → ${formatBytes(last.heapUsed)} (${formatBytes(heapGrowthBytes)} over ${durationSeconds.toFixed(1)}s = ${formatBytes(heapGrowthRate)}/s)`,
      `Arrays: timestamps ${first.frameTimestampsCount} → ${last.frameTimestampsCount} (+${timestampsGrowth}), latencies ${first.decodeLatenciesCount} → ${last.decodeLatenciesCount} (+${latenciesGrowth}), packets ${first.packetsPerFrameCount} → ${last.packetsPerFrameCount} (+${packetsGrowth})`,
      `Workers: in-flight ${first.inFlightFrames} → ${last.inFlightFrames} (${workerGrowth > 0 ? '+' : ''}${workerGrowth})`,
    ].join('\n');

    return {
      hasHeapLeak,
      hasArrayLeak,
      hasWorkerLeak,
      details,
    };
  }

  /**
   * Get a summary report of memory usage
   */
  getSummary(): string {
    if (this.snapshots.length === 0) {
      return 'No memory snapshots available';
    }

    const analysis = this.analyzeLeaks();
    const summary = [
      `Memory Monitor Summary (${this.snapshots.length} snapshots)`,
      `Duration: ${((this.snapshots[this.snapshots.length - 1]!.timestamp - this.snapshots[0]!.timestamp) / 1000).toFixed(1)}s`,
      '',
      analysis.details,
      '',
      `Leak Detection:`,
      `  Heap: ${analysis.hasHeapLeak ? '❌ LEAKING' : '✅ OK'}`,
      `  Arrays: ${analysis.hasArrayLeak ? '❌ LEAKING' : '✅ OK'}`,
      `  Workers: ${analysis.hasWorkerLeak ? '❌ LEAKING' : '✅ OK'}`,
    ];

    return summary.join('\n');
  }

  /**
   * Detect monotonic growth patterns in heap and handle usage
   *
   * Analyzes the collected snapshots to detect if there is a sustained
   * monotonic growth pattern, which indicates a memory leak.
   */
  detectMonotonicGrowth(): {
    hasMonotonicHeapGrowth: boolean;
    hasMonotonicHandleGrowth: boolean;
    heapGrowthTrend: 'increasing' | 'stable' | 'decreasing' | 'insufficient_data';
    handleGrowthTrend: 'increasing' | 'stable' | 'decreasing' | 'insufficient_data';
    slopePerSecond: number;
    confidence: 'low' | 'medium' | 'high';
    details: string;
  } {
    if (this.snapshots.length < 10) {
      return {
        hasMonotonicHeapGrowth: false,
        hasMonotonicHandleGrowth: false,
        heapGrowthTrend: 'insufficient_data',
        handleGrowthTrend: 'insufficient_data',
        slopePerSecond: 0,
        confidence: 'low',
        details: 'Insufficient data for monotonic growth analysis (need at least 10 samples)',
      };
    }

    // Extract heap values over time
    const heapValues = this.snapshots.map(s => s.heapUsed);
    const timestamps = this.snapshots.map(s => s.timestamp);

    // Calculate linear regression to detect trend
    const n = heapValues.length;
    const sumX = timestamps.reduce((sum, t) => sum + t, 0);
    const sumY = heapValues.reduce((sum, h) => sum + h, 0);
    const sumXY = timestamps.reduce((sum, t, i) => sum + t * heapValues[i]!, 0);
    const sumX2 = timestamps.reduce((sum, t) => sum + t * t, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const slopePerSecond = slope * 1000; // Convert from ms to seconds

    // Determine trend based on slope
    let heapGrowthTrend: 'increasing' | 'stable' | 'decreasing';
    if (slopePerSecond > 1000) { // More than 1KB/s
      heapGrowthTrend = 'increasing';
    } else if (slopePerSecond < -1000) {
      heapGrowthTrend = 'decreasing';
    } else {
      heapGrowthTrend = 'stable';
    }

    // Check for handle growth if available
    let handleGrowthTrend: 'increasing' | 'stable' | 'decreasing' = 'stable';
    const handleValues = this.snapshots.map(s => s.handleCount).filter(h => h !== undefined);
    if (handleValues.length >= 10) {
      const firstHandle = handleValues[0]!;
      const lastHandle = handleValues[handleValues.length - 1]!;
      if (lastHandle > firstHandle * 1.1) { // 10% growth
        handleGrowthTrend = 'increasing';
      } else if (lastHandle < firstHandle * 0.9) { // 10% decrease
        handleGrowthTrend = 'decreasing';
      }
    }

    // Calculate confidence based on consistency
    const confidence = this.calculateTrendConfidence(heapValues);

    return {
      hasMonotonicHeapGrowth: heapGrowthTrend === 'increasing',
      hasMonotonicHandleGrowth: handleGrowthTrend === 'increasing',
      heapGrowthTrend,
      handleGrowthTrend,
      slopePerSecond,
      confidence,
      details: this.generateTrendDetails(slopePerSecond, heapGrowthTrend, confidence),
    };
  }

  private calculateTrendConfidence(values: number[]): 'low' | 'medium' | 'high' {
    if (values.length < 20) return 'low';

    // Calculate R-squared for linear fit
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const ssTot = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0);
    const ssRes = values.reduce((sum, v, i) => {
      const predicted = mean + (i / (n - 1)) * (values[n - 1]! - mean);
      return sum + Math.pow(v - predicted, 2);
    }, 0);

    const rSquared = 1 - ssRes / ssTot;

    if (rSquared > 0.8) return 'high';
    if (rSquared > 0.5) return 'medium';
    return 'low';
  }

  private generateTrendDetails(slope: number, trend: string, confidence: string): string {
    const trendEmoji = trend === 'increasing' ? '📈' : trend === 'decreasing' ? '📉' : '➡️';
    return [
      `${trendEmoji} Heap Trend: ${trend.toUpperCase()} (${formatBytes(Math.abs(slope))}/s)`,
      `Confidence: ${confidence.toUpperCase()}`,
      `Duration: ${((this.snapshots[this.snapshots.length - 1]!.timestamp - this.snapshots[0]!.timestamp) / 1000).toFixed(1)}s`,
      `Samples: ${this.snapshots.length}`,
    ].join('\n');
  }

  /**
   * Export collected metrics data as JSON
   */
  exportMetrics(): string {
    const exportData = {
      sessionId: this.sessionId,
      config: {
        sampleInterval: this.config.sampleInterval,
        maxSnapshots: this.config.maxSnapshots,
        trackArrays: this.config.trackArrays,
        trackWorkers: this.config.trackWorkers,
        trackHandles: this.config.trackHandles,
        frameRate: this.config.frameRate,
      },
      snapshots: this.snapshots,
      analysis: {
        leakDetection: this.analyzeLeaks(),
        monotonicGrowth: this.detectMonotonicGrowth(),
      },
      exportTimestamp: Date.now(),
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import metrics data and add to current monitor
   */
  importMetrics(jsonData: string): void {
    try {
      const importData = JSON.parse(jsonData);

      if (!importData.snapshots || !Array.isArray(importData.snapshots)) {
        throw new Error('Invalid metrics data: missing snapshots array');
      }

      // Merge imported snapshots with current ones
      const mergedSnapshots = [...this.snapshots, ...importData.snapshots];

      // Sort by timestamp and remove duplicates
      const uniqueSnapshots = new Map<string, MemorySnapshot>();
      mergedSnapshots.forEach(snapshot => {
        const key = `${snapshot.timestamp}-${snapshot.frameIndex}`;
        uniqueSnapshots.set(key, snapshot);
      });

      this.snapshots = Array.from(uniqueSnapshots.values())
        .sort((a, b) => a.timestamp - b.timestamp);

      console.log(`[Memory Monitor] Imported ${importData.snapshots.length} snapshots. Total: ${this.snapshots.length}`);
    } catch (error) {
      console.error('[Memory Monitor] Failed to import metrics:', error);
      throw error;
    }
  }

  /**
   * Get the session ID for this monitor instance
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Measure user agent specific memory (Chrome 89+)
   *
   * This is an async operation that provides detailed memory breakdown
   * including JS heap size, external resources, and native resources.
   */
  async measureUserAgentMemory(): Promise<{
    jsHeapSize: number;
    externalResources: number;
    nativeResources: number;
    total: number;
  } | null> {
    if (typeof performance === 'undefined' || !('measureUserAgentSpecificMemory' in performance)) {
      return null;
    }

    try {
      const measurement = await (performance as any).measureUserAgentSpecificMemory();

      // Extract breakdown if available
      const breakdown = measurement.breakdown || [];

      let jsHeapSize = 0;
      let externalResources = 0;
      let nativeResources = 0;

      for (const entry of breakdown) {
        switch (entry.type) {
          case 'JSHeapSize':
            jsHeapSize = entry.bytes || 0;
            break;
          case 'ExternalResources':
            externalResources = entry.bytes || 0;
            break;
          case 'NativeResources':
            nativeResources = entry.bytes || 0;
            break;
        }
      }

      return {
        jsHeapSize,
        externalResources,
        nativeResources,
        total: jsHeapSize + externalResources + nativeResources,
      };
    } catch (error) {
      console.debug('[Memory Monitor] Failed to measure user agent memory:', error);
      return null;
    }
  }

  /**
   * Get current handle count if available
   *
   * This method attempts to get handle information through various browser APIs.
   * Falls back to estimation if direct measurement is not available.
   */
  async getHandleCount(): Promise<number | null> {
    // Try to use performance.measureUserAgentSpecificMemory first
    const measurement = await this.measureUserAgentMemory();
    if (measurement) {
      // Estimate handle count from memory breakdown
      // This is a rough approximation based on typical handle sizes
      this.lastHandleMeasurement = Math.ceil(measurement.total / 1024); // Rough estimate
      return this.lastHandleMeasurement;
    }

    // Fallback: check if performance.memory provides handle information
    if ('memory' in performance && (performance as any).memory) {
      const memory = (performance as any).memory;
      // Some browsers provide JSHeapSize that we can use as a proxy
      if (memory.jsHeapSize) {
        this.lastHandleMeasurement = Math.ceil(memory.jsHeapSize / 1024);
        return this.lastHandleMeasurement;
      }
    }

    return null;
  }

  /**
   * Get visualization data for plotting/analysis tools
   */
  getVisualizationData(): {
    labels: string[];
    heapData: number[];
    handleData?: number[];
    frameData: number[];
    timeData: number[];
    summary: string;
  } {
    const labels = this.snapshots.map(s => {
      const time = s.sessionTime ?? 0;
      return `${Math.floor(time)}s`;
    });

    const heapData = this.snapshots.map(s => s.heapUsed / (1024 * 1024)); // Convert to MB
    const frameData = this.snapshots.map(s => s.frameIndex);
    const timeData = this.snapshots.map(s => s.sessionTime ?? 0);

    let handleData: number[] | undefined = undefined;
    const hasHandleData = this.snapshots.some(s => s.handleCount !== undefined);
    if (hasHandleData) {
      handleData = this.snapshots.map(s => s.handleCount ?? 0);
    }

    const monotonicAnalysis = this.detectMonotonicGrowth();
    const summary = [
      `Session: ${this.sessionId}`,
      `Duration: ${(timeData[timeData.length - 1] ?? 0).toFixed(1)}s`,
      `Samples: ${this.snapshots.length}`,
      `Heap Range: ${Math.min(...heapData).toFixed(2)} MB - ${Math.max(...heapData).toFixed(2)} MB`,
      `Growth Rate: ${formatBytes(Math.abs(monotonicAnalysis.slopePerSecond))}/s`,
      monotonicAnalysis.heapGrowthTrend === 'increasing' ? '⚠️ MONOTONIC GROWTH DETECTED' : '✅ No monotonic growth',
    ].join('\n');

    return {
      labels,
      heapData,
      handleData,
      frameData,
      timeData,
      summary,
    };
  }
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Create a memory monitor with default configuration
 */
export function createMemoryMonitor(config?: MemoryMonitorConfig): MemoryMonitor {
  return new MemoryMonitor(config);
}

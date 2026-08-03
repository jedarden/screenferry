/**
 * Memory telemetry and metrics tracking for block storage (bf-1jet).
 *
 * Provides comprehensive memory tracking:
 * - Working set measurement over time
 * - Block churn statistics
 * - Memory usage reporting
 * - Eviction event tracking
 * - Peak memory detection
 *
 * Reference: plan.md §8.1, I6a
 */

import { BlockStorage, StorageStats, MemoryPoolStats } from './bounded-storage.js';

/**
 * Memory reading at a point in time.
 */
export interface MemoryReading {
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Total memory usage in bytes */
  totalBytes: number;
  /** Payload pool usage in bytes */
  payloadBytes: number;
  /** Manifest pool usage in bytes */
  manifestBytes: number;
  /** Number of contexts in payload pool */
  payloadContexts: number;
  /** Number of contexts in manifest pool */
  manifestContexts: number;
  /** Total utilization ratio (0-1) */
  utilization: number;
}

/**
 * Eviction event record.
 */
export interface EvictionEvent {
  /** Timestamp in milliseconds */
  timestamp: number;
  /** Pool type ('payload' or 'manifest') */
  pool: 'payload' | 'manifest';
  /** Block index that was evicted */
  blockIndex: number;
  /** Size of evicted context in bytes */
  sizeBytes: number;
  /** Reason for eviction */
  reason: 'capacity' | 'manual' | 'clear';
}

/**
 * Block churn statistics.
 */
export interface ChurnStats {
  /** Total number of eviction events */
  totalEvictions: number;
  /** Payload pool evictions */
  payloadEvictions: number;
  /** Manifest pool evictions */
  manifestEvictions: number;
  /** Total bytes evicted */
  totalBytesEvicted: number;
  /** Eviction rate (evictions per second) */
  evictionRate: number;
  /** Average context lifetime in milliseconds */
  avgLifetimeMs: number;
}

/**
 * Memory peak statistics.
 */
export interface PeakStats {
  /** Peak total memory usage in bytes */
  peakTotalBytes: number;
  /** Timestamp of peak total memory */
  peakTotalTimestamp: number;
  /** Peak payload pool usage in bytes */
  peakPayloadBytes: number;
  /** Timestamp of peak payload memory */
  peakPayloadTimestamp: number;
  /** Peak manifest pool usage in bytes */
  peakManifestBytes: number;
  /** Timestamp of peak manifest memory */
  peakManifestTimestamp: number;
}

/**
 * Comprehensive telemetry report.
 */
export interface TelemetryReport {
  /** Storage statistics at report time */
  current: StorageStats;
  /** Memory readings over time */
  readings: MemoryReading[];
  /** Eviction events */
  evictions: EvictionEvent[];
  /** Block churn statistics */
  churn: ChurnStats;
  /** Peak memory statistics */
  peaks: PeakStats;
  /** Memory validation status */
  withinConstraints: boolean;
  /** Report duration in milliseconds */
  durationMs: number;
}

/**
 * Configuration for memory telemetry.
 */
export interface TelemetryConfig {
  /** Maximum number of memory readings to keep (default: 1000) */
  maxReadings?: number;
  /** Maximum number of eviction events to keep (default: 1000) */
  maxEvictions?: number;
  /** Whether to track individual readings (default: true) */
  enableReadings?: boolean;
  /** Whether to track eviction events (default: true) */
  enableEvictions?: boolean;
}

/**
 * Memory telemetry tracker for block storage.
 *
 * Tracks memory usage patterns, eviction events, and provides
 * comprehensive reporting for validation and debugging.
 */
export class MemoryTelemetry {
  private readonly storage: BlockStorage;
  private readonly config: Required<TelemetryConfig>;
  private readonly startTime: number;

  private readings: MemoryReading[] = [];
  private evictions: EvictionEvent[] = [];
  private peakStats: PeakStats = {
    peakTotalBytes: 0,
    peakTotalTimestamp: 0,
    peakPayloadBytes: 0,
    peakPayloadTimestamp: 0,
    peakManifestBytes: 0,
    peakManifestTimestamp: 0,
  };

  constructor(storage: BlockStorage, config: TelemetryConfig = {}) {
    this.storage = storage;
    this.config = {
      maxReadings: config.maxReadings ?? 1000,
      maxEvictions: config.maxEvictions ?? 1000,
      enableReadings: config.enableReadings ?? true,
      enableEvictions: config.enableEvictions ?? true,
    };
    this.startTime = Date.now();
  }

  /**
   * Record a memory reading.
   *
   * Should be called periodically to track memory usage over time.
   * Automatically manages reading buffer size per configuration.
   */
  recordReading(): void {
    if (!this.config.enableReadings) return;

    const stats = this.storage.getStats();
    const now = Date.now();

    const reading: MemoryReading = {
      timestamp: now,
      totalBytes: stats.totalBytes,
      payloadBytes: stats.payload.currentBytes,
      manifestBytes: stats.manifest.currentBytes,
      payloadContexts: stats.payload.contextCount,
      manifestContexts: stats.manifest.contextCount,
      utilization: stats.totalUtilization,
    };

    // Add to readings buffer
    this.readings.push(reading);

    // Trim to max size
    if (this.readings.length > this.config.maxReadings) {
      this.readings.shift();
    }

    // Update peak statistics
    this.updatePeakStats(reading);
  }

  /**
   * Record an eviction event.
   *
   * Should be called whenever a context is evicted from storage.
   */
  recordEviction(
    pool: 'payload' | 'manifest',
    blockIndex: number,
    sizeBytes: number,
    reason: EvictionEvent['reason'] = 'capacity'
  ): void {
    if (!this.config.enableEvictions) return;

    const event: EvictionEvent = {
      timestamp: Date.now(),
      pool,
      blockIndex,
      sizeBytes,
      reason,
    };

    // Add to evictions buffer
    this.evictions.push(event);

    // Trim to max size
    if (this.evictions.length > this.config.maxEvictions) {
      this.evictions.shift();
    }
  }

  /**
   * Get current storage statistics.
   */
  getCurrentStats(): StorageStats {
    return this.storage.getStats();
  }

  /**
   * Get all memory readings.
   */
  getReadings(): MemoryReading[] {
    return [...this.readings];
  }

  /**
   * Get all eviction events.
   */
  getEvictions(): EvictionEvent[] {
    return [...this.evictions];
  }

  /**
   * Get peak memory statistics.
   */
  getPeakStats(): PeakStats {
    return { ...this.peakStats };
  }

  /**
   * Calculate block churn statistics.
   */
  getChurnStats(): ChurnStats {
    const now = Date.now();
    const durationMs = now - this.startTime;

    let payloadEvictions = 0;
    let manifestEvictions = 0;
    let totalBytesEvicted = 0;

    for (const event of this.evictions) {
      if (event.pool === 'payload') {
        payloadEvictions++;
      } else {
        manifestEvictions++;
      }
      totalBytesEvicted += event.sizeBytes;
    }

    const evictionRate =
      durationMs > 0 ? (this.evictions.length / durationMs) * 1000 : 0;

    return {
      totalEvictions: this.evictions.length,
      payloadEvictions,
      manifestEvictions,
      totalBytesEvicted,
      evictionRate,
      avgLifetimeMs: 0, // Calculated in comprehensive report
    };
  }

  /**
   * Generate comprehensive telemetry report.
   */
  getReport(): TelemetryReport {
    const current = this.getCurrentStats();
    const churn = this.getChurnStats();

    // Calculate average context lifetime
    if (this.evictions.length > 0) {
      const lifetimes: number[] = [];

      for (const event of this.evictions) {
        // Find the most recent reading before this eviction
        const readingBefore = this.findReadingBefore(event.timestamp);
        if (readingBefore) {
          const lifetime = event.timestamp - readingBefore.timestamp;
          lifetimes.push(lifetime);
        }
      }

      if (lifetimes.length > 0) {
        const avgLifetime = lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length;
        churn.avgLifetimeMs = avgLifetime;
      }
    }

    return {
      current,
      readings: this.getReadings(),
      evictions: this.getEvictions(),
      churn,
      peaks: this.getPeakStats(),
      withinConstraints: this.storage.validateConstraints(),
      durationMs: Date.now() - this.startTime,
    };
  }

  /**
   * Validate memory stayed within bounds.
   *
   * @returns true if all readings within constraints
   */
  validateMemoryBounds(): boolean {
    for (const reading of this.readings) {
      if (reading.totalBytes > this.storage.getTotalMemoryUsage()) {
        return false;
      }
    }
    return this.storage.validateConstraints();
  }

  /**
   * Check for memory growth over time.
   *
   * Analyzes readings to detect monotonic memory growth.
   *
   * @returns true if memory usage is stable (no monotonic growth)
   */
  checkMemoryStable(): boolean {
    if (this.readings.length < 2) return true;

    // Calculate trend using linear regression
    const n = this.readings.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      const x = i;
      const y = this.readings[i]!.totalBytes;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Slope should be near zero for stable memory
    // Allow small variance (±1% of capacity)
    const capacity = this.storage.getTotalMemoryUsage();
    const threshold = capacity * 0.01;

    return Math.abs(slope) < threshold;
  }

  /**
   * Clear all telemetry data.
   */
  clear(): void {
    this.readings = [];
    this.evictions = [];
    this.peakStats = {
      peakTotalBytes: 0,
      peakTotalTimestamp: 0,
      peakPayloadBytes: 0,
      peakPayloadTimestamp: 0,
      peakManifestBytes: 0,
      peakManifestTimestamp: 0,
    };
  }

  /**
   * Get memory usage trend (bytes per second).
   *
   * @returns Trend in bytes/second (positive = growing, negative = shrinking)
   */
  getMemoryTrend(): number {
    if (this.readings.length < 2) return 0;

    const first = this.readings[0]!;
    const last = this.readings[this.readings.length - 1]!;

    const timeDiff = last.timestamp - first.timestamp;
    if (timeDiff === 0) return 0;

    const bytesDiff = last.totalBytes - first.totalBytes;
    return (bytesDiff / timeDiff) * 1000; // Convert to bytes/second
  }

  /**
   * Update peak statistics from a reading.
   */
  private updatePeakStats(reading: MemoryReading): void {
    if (reading.totalBytes > this.peakStats.peakTotalBytes) {
      this.peakStats.peakTotalBytes = reading.totalBytes;
      this.peakStats.peakTotalTimestamp = reading.timestamp;
    }

    if (reading.payloadBytes > this.peakStats.peakPayloadBytes) {
      this.peakStats.peakPayloadBytes = reading.payloadBytes;
      this.peakStats.peakPayloadTimestamp = reading.timestamp;
    }

    if (reading.manifestBytes > this.peakStats.peakManifestBytes) {
      this.peakStats.peakManifestBytes = reading.manifestBytes;
      this.peakStats.peakManifestTimestamp = reading.timestamp;
    }
  }

  /**
   * Find the most recent reading before a given timestamp.
   */
  private findReadingBefore(timestamp: number): MemoryReading | undefined {
    for (let i = this.readings.length - 1; i >= 0; i--) {
      const reading = this.readings[i]!;
      if (reading.timestamp < timestamp) {
        return reading;
      }
    }
    return undefined;
  }
}

/**
 * Format bytes as human-readable size.
 *
 * @param bytes - Size in bytes
 * @returns Formatted size string (e.g., "264.0 KB")
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Calculate memory efficiency ratio.
 *
 * Efficiency = (actual usage / capacity) where lower is better.
 * A value of 1.0 means storage is at full capacity.
 *
 * @param stats - Storage statistics
 * @returns Efficiency ratio (0-1+)
 */
export function calculateMemoryEfficiency(stats: StorageStats): number {
  return stats.totalBytes / stats.totalCapacity;
}

/**
 * Validate memory stayed within 1 MB I6a constraint.
 *
 * @param report - Telemetry report
 * @returns true if all readings within 1 MB
 */
export function validateI6aMemoryConstraint(report: TelemetryReport): boolean {
  const limit = 1_048_576; // 1 MB

  // Check current usage
  if (report.current.totalBytes > limit) return false;

  // Check all historical readings
  for (const reading of report.readings) {
    if (reading.totalBytes > limit) return false;
  }

  return true;
}

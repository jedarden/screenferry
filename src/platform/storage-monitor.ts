/**
 * Storage capacity monitor (bf-4d6 F1).
 *
 * Monitors OPFS storage capacity during active transfers to detect
 * quota exhaustion before it causes critical failures.
 *
 * Per plan: "Storage capacity monitoring during transfer" - checks quota
 * periodically and warns when approaching limits.
 *
 * Reference: plan.md §8.3, E10
 */

import {estimateStorageQuota, type StorageQuotaEstimate} from './storage.js';

/**
 * Storage monitoring configuration.
 */
export interface StorageMonitorConfig {
  /** Check interval in milliseconds (default: 30 seconds) */
  checkInterval: number;
  /** Warning threshold (0.0-1.0) - warn when usage exceeds this fraction */
  warningThreshold: number;
  /** Critical threshold (0.0-1.0) - critical when usage exceeds this fraction */
  criticalThreshold: number;
  /** Callback when storage status changes */
  onStatusChange?: (status: StorageMonitorStatus) => void;
  /** Callback when quota is exhausted */
  onQuotaExhausted?: (info: QuotaExhaustionInfo) => void;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: StorageMonitorConfig = {
  checkInterval: 30000, // 30 seconds
  warningThreshold: 0.8, // Warn at 80% quota usage
  criticalThreshold: 0.95, // Critical at 95% quota usage
};

/**
 * Storage monitor status.
 */
export interface StorageMonitorStatus {
  /** Current status */
  status: 'healthy' | 'warning' | 'critical' | 'exhausted' | 'unavailable';
  /** Current quota estimate */
  estimate: StorageQuotaEstimate | null;
  /** Usage fraction (0.0-1.0) */
  usageFraction: number;
  /** Available bytes */
  availableBytes: number;
  /** Last check timestamp */
  timestamp: number;
  /** Number of consecutive critical status readings */
  criticalCount: number;
}

/**
 * Quota exhaustion information.
 */
export interface QuotaExhaustionInfo {
  /** Timestamp of exhaustion detection */
  timestamp: number;
  /** Last quota estimate before exhaustion */
  estimate: StorageQuotaEstimate | null;
  /** Available bytes at exhaustion */
  availableBytes: number;
  /** Whether exhaustion is confirmed */
  confirmed: boolean;
}

/**
 * Storage capacity monitor.
 *
 * Monitors OPFS quota usage during transfers and provides early warning
 * before quota exhaustion causes transfer failures.
 */
export class StorageCapacityMonitor {
  private config: StorageMonitorConfig;
  private status: StorageMonitorStatus;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning: boolean = false;
  private lastEstimate: StorageQuotaEstimate | null = null;

  constructor(config: Partial<StorageMonitorConfig> = {}) {
    this.config = {...DEFAULT_CONFIG, ...config};
    this.status = this.createInitialStatus();
  }

  /**
   * Create initial status.
   */
  private createInitialStatus(): StorageMonitorStatus {
    return {
      status: 'unavailable',
      estimate: null,
      usageFraction: 0,
      availableBytes: 0,
      timestamp: Date.now(),
      criticalCount: 0,
    };
  }

  /**
   * Start monitoring storage capacity.
   *
   * Begins periodic quota checks and triggers callbacks when thresholds are crossed.
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[Storage Monitor] Already running');
      return;
    }

    console.log('[Storage Monitor] Starting storage capacity monitoring');
    this.isRunning = true;
    this.status = this.createInitialStatus();

    // Perform initial check
    this.checkStorageCapacity();

    // Set up periodic checks
    this.intervalId = setInterval(() => {
      this.checkStorageCapacity();
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring storage capacity.
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[Storage Monitor] Stopping storage capacity monitoring');

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
  }

  /**
   * Check current storage capacity.
   */
  private async checkStorageCapacity(): Promise<void> {
    try {
      const estimate = await estimateStorageQuota();

      if (!estimate) {
        console.warn('[Storage Monitor] Unable to estimate quota');
        this.updateStatus({
          status: 'unavailable',
          estimate: null,
          usageFraction: 0,
          availableBytes: 0,
          timestamp: Date.now(),
          criticalCount: 0,
        });
        return;
      }

      this.lastEstimate = estimate;

      const usageFraction = estimate.quota > 0 ? estimate.usage / estimate.quota : 0;
      const availableBytes = estimate.available;

      // Determine status
      let status: StorageMonitorStatus['status'];
      let criticalCount = this.status.criticalCount;

      if (availableBytes === 0) {
        status = 'exhausted';
        criticalCount++;
      } else if (usageFraction >= this.config.criticalThreshold) {
        status = 'critical';
        criticalCount++;
      } else if (usageFraction >= this.config.warningThreshold) {
        status = 'warning';
        criticalCount = 0; // Reset critical count
      } else {
        status = 'healthy';
        criticalCount = 0;
      }

      const newStatus: StorageMonitorStatus = {
        status,
        estimate,
        usageFraction,
        availableBytes,
        timestamp: Date.now(),
        criticalCount,
      };

      this.updateStatus(newStatus);

      // Handle exhaustion
      if (status === 'exhausted' && criticalCount >= 2) {
        // Require 2 consecutive exhaustion readings to confirm (avoid false positives)
        this.handleQuotaExhaustion(estimate, availableBytes);
      }

    } catch (error) {
      console.error('[Storage Monitor] Failed to check storage capacity:', error);
      this.updateStatus({
        status: 'unavailable',
        estimate: null,
        usageFraction: 0,
        availableBytes: 0,
        timestamp: Date.now(),
        criticalCount: 0,
      });
    }
  }

  /**
   * Update status and trigger callback if changed.
   */
  private updateStatus(newStatus: StorageMonitorStatus): void {
    const previousStatus = this.status.status;
    this.status = newStatus;

    // Trigger callback on status change
    if (previousStatus !== newStatus.status && this.config.onStatusChange) {
      this.config.onStatusChange(newStatus);
    }

    // Log status changes
    if (previousStatus !== newStatus.status) {
      console.log('[Storage Monitor] Status changed:', {
        from: previousStatus,
        to: newStatus.status,
        usage: `${(newStatus.usageFraction * 100).toFixed(1)}%`,
        available: this.formatBytes(newStatus.availableBytes),
      });
    }
  }

  /**
   * Handle quota exhaustion.
   */
  private handleQuotaExhaustion(
    estimate: StorageQuotaEstimate | null,
    availableBytes: number
  ): void {
    console.error('[Storage Monitor] Quota exhaustion detected', {
      available: this.formatBytes(availableBytes),
      usage: estimate ? `${(estimate.usage / estimate.quota * 100).toFixed(1)}%` : 'unknown',
    });

    const exhaustionInfo: QuotaExhaustionInfo = {
      timestamp: Date.now(),
      estimate,
      availableBytes,
      confirmed: true,
    };

    if (this.config.onQuotaExhausted) {
      this.config.onQuotaExhausted(exhaustionInfo);
    }

    // Stop monitoring after exhaustion
    this.stop();
  }

  /**
   * Get current status.
   */
  getStatus(): StorageMonitorStatus {
    return {...this.status};
  }

  /**
   * Check if storage is healthy.
   */
  isHealthy(): boolean {
    return this.status.status === 'healthy' || this.status.status === 'warning';
  }

  /**
   * Check if storage is critical.
   */
  isCritical(): boolean {
    return this.status.status === 'critical' || this.status.status === 'exhausted';
  }

  /**
   * Get available bytes.
   */
  getAvailableBytes(): number {
    return this.status.availableBytes;
  }

  /**
   * Check if running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Format bytes for display.
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }
}

/**
 * Create a storage monitor with default configuration.
 */
export function createStorageMonitor(
  config?: Partial<StorageMonitorConfig>
): StorageCapacityMonitor {
  return new StorageCapacityMonitor(config);
}

/**
 * Single-use capacity check for immediate status.
 *
 * Performs a one-time quota check without starting the monitor.
 *
 * @returns Current storage status
 */
export async function checkStorageStatusOnce(): Promise<StorageMonitorStatus> {
  const estimate = await estimateStorageQuota();

  if (!estimate) {
    return {
      status: 'unavailable',
      estimate: null,
      usageFraction: 0,
      availableBytes: 0,
      timestamp: Date.now(),
      criticalCount: 0,
    };
  }

  const usageFraction = estimate.quota > 0 ? estimate.usage / estimate.quota : 0;

  let status: StorageMonitorStatus['status'];
  if (estimate.available === 0) {
    status = 'exhausted';
  } else if (usageFraction >= 0.95) {
    status = 'critical';
  } else if (usageFraction >= 0.8) {
    status = 'warning';
  } else {
    status = 'healthy';
  }

  return {
    status,
    estimate,
    usageFraction,
    availableBytes: estimate.available,
    timestamp: Date.now(),
    criticalCount: 0,
  };
}

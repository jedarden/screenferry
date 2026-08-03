/**
 * Tests for storage capacity monitor (bf-4d6 F1).
 *
 * Tests periodic storage capacity monitoring during transfers.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  StorageCapacityMonitor,
  createStorageMonitor,
  checkStorageStatusOnce,
  type StorageMonitorConfig,
} from '../src/platform/storage-monitor.js';

// Mock navigator.storage.estimate()
const mockEstimate = (quota: number, usage: number) => {
  globalThis.navigator = {
    ...globalThis.navigator,
    storage: {
      estimate: async () => ({quota, usage}),
    },
  };
};

describe('Storage Capacity Monitor', () => {
  let monitor: StorageCapacityMonitor;

  afterEach(() => {
    if (monitor) {
      monitor.stop();
    }
  });

  describe('basic functionality', () => {
    it('should create monitor with default config', () => {
      monitor = createStorageMonitor();

      expect(monitor).toBeDefined();
      expect(monitor.isActive()).toBe(false);
      expect(monitor.isHealthy()).toBe(false); // Initial state is unavailable (no checks performed yet)
      expect(monitor.getStatus().status).toBe('unavailable');
    });

    it('should start and stop monitoring', () => {
      monitor = createStorageMonitor({checkInterval: 100});

      expect(monitor.isActive()).toBe(false);

      monitor.start();
      expect(monitor.isActive()).toBe(true);

      monitor.stop();
      expect(monitor.isActive()).toBe(false);
    });

    it('should not start if already running', () => {
      monitor = createStorageMonitor();

      monitor.start();
      expect(monitor.isActive()).toBe(true);

      monitor.start(); // Should not throw
      expect(monitor.isActive()).toBe(true);
    });
  });

  describe('status tracking', () => {
    it('should report healthy status when quota is available', async () => {
      mockEstimate(1000000000, 100000000); // 1 GB quota, 100 MB used

      monitor = createStorageMonitor({checkInterval: 50});

      const statusChanged = new Promise<void>((resolve) => {
        monitor = createStorageMonitor({
          checkInterval: 50,
          onStatusChange: (status) => {
            if (status.status === 'healthy') {
              resolve();
            }
          },
        });
      });

      monitor.start();

      // Wait for status to be updated
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = monitor.getStatus();
      expect(status.status).toBe('healthy');
      expect(status.availableBytes).toBeGreaterThan(0);
    });

    it('should detect warning status at 80% usage', async () => {
      mockEstimate(1000000000, 850000000); // 85% usage

      const statusChanged = new Promise<void>((resolve) => {
        monitor = createStorageMonitor({
          checkInterval: 50,
          warningThreshold: 0.8,
          onStatusChange: (status) => {
            if (status.status === 'warning') {
              resolve();
            }
          },
        });
      });

      monitor.start();

      // Wait for status check
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = monitor.getStatus();
      expect(status.status).toBe('warning');
    });

    it('should detect critical status at 95% usage', async () => {
      mockEstimate(1000000000, 970000000); // 97% usage

      monitor = createStorageMonitor({
        checkInterval: 50,
        criticalThreshold: 0.95,
      });

      monitor.start();

      // Wait for status check
      await new Promise(resolve => setTimeout(resolve, 100));

      const status = monitor.getStatus();
      expect(status.status).toBe('critical');
      expect(status.criticalCount).toBeGreaterThan(0);
    });

    it('should detect exhausted status when quota is full', async () => {
      mockEstimate(1000000000, 1000000000); // 100% usage

      monitor = createStorageMonitor({
        checkInterval: 50,
      });

      monitor.start();

      // Wait for multiple status checks to trigger exhaustion
      await new Promise(resolve => setTimeout(resolve, 150));

      const status = monitor.getStatus();
      expect(status.status).toBe('exhausted');
      expect(status.criticalCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('quota exhaustion callback', () => {
    it('should trigger quota exhausted callback', async () => {
      mockEstimate(1000000000, 1000000000);

      let exhaustionTriggered = false;
      let exhaustionInfo = null;

      monitor = createStorageMonitor({
        checkInterval: 50,
        onQuotaExhausted: (info) => {
          exhaustionTriggered = true;
          exhaustionInfo = info;
        },
      });

      monitor.start();

      // Wait for exhaustion to be detected
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(exhaustionTriggered).toBe(true);
      expect(exhaustionInfo).toBeDefined();
      expect(exhaustionInfo?.confirmed).toBe(true);
      expect(exhaustionInfo?.availableBytes).toBe(0);

      // Monitor should stop after exhaustion
      expect(monitor.isActive()).toBe(false);
    });
  });

  describe('health checks', () => {
    it('should report healthy when status is healthy', () => {
      monitor = createStorageMonitor();

      // Mock healthy status
      monitor['status'] = {
        status: 'healthy',
        estimate: {quota: 1000000000, usage: 100000000, available: 900000000},
        usageFraction: 0.1,
        availableBytes: 900000000,
        timestamp: Date.now(),
        criticalCount: 0,
      };

      expect(monitor.isHealthy()).toBe(true);
      expect(monitor.isCritical()).toBe(false);
    });

    it('should report healthy when status is warning', () => {
      monitor = createStorageMonitor();

      monitor['status'] = {
        status: 'warning',
        estimate: {quota: 1000000000, usage: 850000000, available: 150000000},
        usageFraction: 0.85,
        availableBytes: 150000000,
        timestamp: Date.now(),
        criticalCount: 0,
      };

      expect(monitor.isHealthy()).toBe(true);
      expect(monitor.isCritical()).toBe(false);
    });

    it('should report critical when status is critical', () => {
      monitor = createStorageMonitor();

      monitor['status'] = {
        status: 'critical',
        estimate: {quota: 1000000000, usage: 970000000, available: 30000000},
        usageFraction: 0.97,
        availableBytes: 30000000,
        timestamp: Date.now(),
        criticalCount: 1,
      };

      expect(monitor.isHealthy()).toBe(false);
      expect(monitor.isCritical()).toBe(true);
    });

    it('should report critical when status is exhausted', () => {
      monitor = createStorageMonitor();

      monitor['status'] = {
        status: 'exhausted',
        estimate: {quota: 1000000000, usage: 1000000000, available: 0},
        usageFraction: 1.0,
        availableBytes: 0,
        timestamp: Date.now(),
        criticalCount: 2,
      };

      expect(monitor.isHealthy()).toBe(false);
      expect(monitor.isCritical()).toBe(true);
    });
  });

  describe('helper methods', () => {
    it('should get available bytes', () => {
      monitor = createStorageMonitor();

      monitor['status'] = {
        status: 'healthy',
        estimate: {quota: 1000000000, usage: 100000000, available: 900000000},
        usageFraction: 0.1,
        availableBytes: 900000000,
        timestamp: Date.now(),
        criticalCount: 0,
      };

      expect(monitor.getAvailableBytes()).toBe(900000000);
    });
  });
});

describe('checkStorageStatusOnce', () => {
  it('should perform single status check', async () => {
    mockEstimate(1000000000, 300000000); // 30% usage

    const status = await checkStorageStatusOnce();

    expect(status.status).toBe('healthy');
    expect(status.estimate).toBeDefined();
    expect(status.availableBytes).toBe(700000000);
  });

  it('should return warning status at 85% usage', async () => {
    mockEstimate(1000000000, 850000000);

    const status = await checkStorageStatusOnce();

    expect(status.status).toBe('warning');
  });

  it('should return critical status at 97% usage', async () => {
    mockEstimate(1000000000, 970000000);

    const status = await checkStorageStatusOnce();

    expect(status.status).toBe('critical');
  });

  it('should return exhausted status at 100% usage', async () => {
    mockEstimate(1000000000, 1000000000);

    const status = await checkStorageStatusOnce();

    expect(status.status).toBe('exhausted');
  });

  it('should return unavailable status when estimate fails', async () => {
    globalThis.navigator = {
      ...globalThis.navigator,
      storage: {
        estimate: async () => null,
      },
    };

    const status = await checkStorageStatusOnce();

    expect(status.status).toBe('unavailable');
    expect(status.estimate).toBeNull();
  });
});

describe('createStorageMonitor', () => {
  it('should create monitor with custom config', () => {
    const customConfig: Partial<StorageMonitorConfig> = {
      checkInterval: 5000,
      warningThreshold: 0.7,
      criticalThreshold: 0.9,
    };

    const monitor = createStorageMonitor(customConfig);

    expect(monitor).toBeDefined();
    expect(monitor.isActive()).toBe(false);
  });
});

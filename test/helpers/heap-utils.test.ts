/**
 * Unit tests for heap measurement utilities.
 *
 * Tests the standalone heap capture functions in heap-utils.ts.
 *
 * Reference: bead bf-i0wkw
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureHeapMetrics,
  calculateHeapDelta,
  formatHeapMetrics,
  formatHeapDelta,
  assertHeapGrowth,
  assertHeapUsage,
  getHeapUsagePercent,
  type HeapMetrics,
} from './heap-utils';

describe('heap-utils', () => {
  describe('captureHeapMetrics', () => {
    it('should capture heap metrics with all required fields', () => {
      const metrics = captureHeapMetrics();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('heapUsed');
      expect(metrics).toHaveProperty('heapTotal');
      expect(metrics).toHaveProperty('external');
      expect(metrics).toHaveProperty('rss');
      expect(metrics).toHaveProperty('arrayBuffers');
    });

    it('should return numeric values for all metrics', () => {
      const metrics = captureHeapMetrics();

      expect(typeof metrics.timestamp).toBe('number');
      expect(typeof metrics.heapUsed).toBe('number');
      expect(typeof metrics.heapTotal).toBe('number');
      expect(typeof metrics.external).toBe('number');
      expect(typeof metrics.rss).toBe('number');
      expect(typeof metrics.arrayBuffers).toBe('number');
    });

    it('should return positive heap values', () => {
      const metrics = captureHeapMetrics();

      expect(metrics.heapUsed).toBeGreaterThan(0);
      expect(metrics.heapTotal).toBeGreaterThan(0);
      expect(metrics.heapTotal).toBeGreaterThanOrEqual(metrics.heapUsed);
    });

    it('should capture current timestamp', () => {
      const before = Date.now();
      const metrics = captureHeapMetrics();
      const after = Date.now();

      expect(metrics.timestamp).toBeGreaterThanOrEqual(before);
      expect(metrics.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('calculateHeapDelta', () => {
    it('should calculate delta between two snapshots', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024, // 100 MB
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 120 * 1024 * 1024, // 120 MB
        heapTotal: 220 * 1024 * 1024,
        external: 12 * 1024 * 1024,
        rss: 160 * 1024 * 1024,
        arrayBuffers: 6 * 1024 * 1024,
      };

      const delta = calculateHeapDelta(baseline, current);

      expect(delta.heapUsed).toBe(20 * 1024 * 1024); // +20 MB
      expect(delta.heapTotal).toBe(20 * 1024 * 1024); // +20 MB
      expect(delta.external).toBe(2 * 1024 * 1024); // +2 MB
      expect(delta.rss).toBe(10 * 1024 * 1024); // +10 MB
      expect(delta.arrayBuffers).toBe(1 * 1024 * 1024); // +1 MB
      expect(delta.elapsedMs).toBe(1000);
    });

    it('should handle negative deltas (memory decrease)', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 120 * 1024 * 1024,
        heapTotal: 220 * 1024 * 1024,
        external: 12 * 1024 * 1024,
        rss: 160 * 1024 * 1024,
        arrayBuffers: 6 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const delta = calculateHeapDelta(baseline, current);

      expect(delta.heapUsed).toBe(-20 * 1024 * 1024); // -20 MB
      expect(delta.rss).toBe(-10 * 1024 * 1024); // -10 MB
    });

    it('should return zero delta for identical snapshots', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const delta = calculateHeapDelta(metrics, metrics);

      expect(delta.heapUsed).toBe(0);
      expect(delta.heapTotal).toBe(0);
      expect(delta.external).toBe(0);
      expect(delta.rss).toBe(0);
      expect(delta.arrayBuffers).toBe(0);
      expect(delta.elapsedMs).toBe(0);
    });
  });

  describe('formatHeapMetrics', () => {
    it('should format metrics as human-readable string', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const formatted = formatHeapMetrics(metrics);

      expect(formatted).toContain('100.00');
      expect(formatted).toContain('200.00');
      expect(formatted).toContain('10.00');
      expect(formatted).toContain('150.00');
      expect(formatted).toContain('Heap:');
      expect(formatted).toContain('used');
      expect(formatted).toContain('total');
    });
  });

  describe('formatHeapDelta', () => {
    it('should format positive delta with plus sign', () => {
      const delta = {
        heapUsed: 20 * 1024 * 1024,
        heapTotal: 20 * 1024 * 1024,
        external: 2 * 1024 * 1024,
        rss: 10 * 1024 * 1024,
        arrayBuffers: 1 * 1024 * 1024,
        elapsedMs: 1000,
      };

      const formatted = formatHeapDelta(delta);

      expect(formatted).toContain('+20.00 MB');
      expect(formatted).toContain('+10.00 MB');
      expect(formatted).toContain('1000 ms');
    });

    it('should format negative delta with minus sign', () => {
      const delta = {
        heapUsed: -20 * 1024 * 1024,
        heapTotal: -20 * 1024 * 1024,
        external: -2 * 1024 * 1024,
        rss: -10 * 1024 * 1024,
        arrayBuffers: -1 * 1024 * 1024,
        elapsedMs: 1000,
      };

      const formatted = formatHeapDelta(delta);

      expect(formatted).toContain('-20.00 MB');
      expect(formatted).toContain('-10.00 MB');
    });
  });

  describe('assertHeapGrowth', () => {
    it('should not throw when growth is within threshold', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 105 * 1024 * 1024, // 5 MB growth
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapGrowth(baseline, current, 10 * 1024 * 1024)).not.toThrow();
    });

    it('should not throw when memory decreases', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 90 * 1024 * 1024, // 10 MB decrease
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapGrowth(baseline, current, 5 * 1024 * 1024)).not.toThrow();
    });

    it('should throw when growth exceeds threshold', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 115 * 1024 * 1024, // 15 MB growth
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapGrowth(baseline, current, 10 * 1024 * 1024)).toThrow(
        /Heap growth of 15\.00 MB exceeds maximum allowed 10\.00 MB/
      );
    });

    it('should use default threshold of 10 MB when not specified', () => {
      const baseline: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const current: HeapMetrics = {
        timestamp: 2000,
        heapUsed: 115 * 1024 * 1024, // 15 MB growth
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapGrowth(baseline, current)).toThrow();
    });
  });

  describe('assertHeapUsage', () => {
    it('should not throw when usage is within threshold', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024, // 100 MB
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapUsage(metrics, 500 * 1024 * 1024)).not.toThrow();
    });

    it('should throw when usage exceeds threshold', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 600 * 1024 * 1024, // 600 MB
        heapTotal: 700 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 650 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapUsage(metrics, 500 * 1024 * 1024)).toThrow(
        /Heap usage 600\.00 MB exceeds maximum allowed 500\.00 MB/
      );
    });

    it('should use default threshold of 500 MB when not specified', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 600 * 1024 * 1024, // 600 MB
        heapTotal: 700 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 650 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      expect(() => assertHeapUsage(metrics)).toThrow();
    });
  });

  describe('getHeapUsagePercent', () => {
    it('should calculate usage percentage correctly', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const percent = getHeapUsagePercent(metrics);

      expect(percent).toBe(50);
    });

    it('should return 0 when heapTotal is 0', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 100 * 1024 * 1024,
        heapTotal: 0,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const percent = getHeapUsagePercent(metrics);

      expect(percent).toBe(0);
    });

    it('should handle edge case of full heap', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 200 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 250 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const percent = getHeapUsagePercent(metrics);

      expect(percent).toBe(100);
    });

    it('should calculate fractional percentages', () => {
      const metrics: HeapMetrics = {
        timestamp: 1000,
        heapUsed: 75 * 1024 * 1024,
        heapTotal: 200 * 1024 * 1024,
        external: 10 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 5 * 1024 * 1024,
      };

      const percent = getHeapUsagePercent(metrics);

      expect(percent).toBe(37.5);
    });
  });
});

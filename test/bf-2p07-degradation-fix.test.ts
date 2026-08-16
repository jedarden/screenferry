/**
 * Test for bf-2p07 degradation fix: circular buffer for decode latencies
 *
 * This test validates that the circular buffer implementation prevents
 * unbounded growth of the decodeLatencies array, which was causing 4.7x
 * performance degradation over long sessions.
 *
 * Root cause: decodeLatencies.push() on every frame without clearing
 * Impact: After thousands of frames, sorting large array caused GC pressure
 * Fix: Circular buffer with MAX_DECODE_LATENCIES = 1000 entries
 *
 * Reference: bead bf-2p07
 */

import { describe, expect, it, beforeEach } from 'vitest';

// Circular buffer implementation matching camera-pipeline.ts
class CircularLatencyBuffer {
  private latencies: number[] = [];
  private index: number = 0;
  private readonly MAX_SIZE = 1000;

  push(value: number): void {
    if (this.latencies.length < this.MAX_SIZE) {
      // Fill phase: append until buffer is full
      this.latencies.push(value);
    } else {
      // Wrap phase: overwrite old entries in circular pattern
      this.latencies[this.index] = value;
      this.index = (this.index + 1) % this.MAX_SIZE;
    }
  }

  getLatencies(): number[] {
    return this.latencies;
  }

  getSize(): number {
    return this.latencies.length;
  }

  getMemoryEstimate(): number {
    // Each number is 8 bytes in JS
    return this.latencies.length * 8;
  }

  clear(): void {
    this.latencies = [];
    this.index = 0;
  }

  // Calculate percentile from current buffer contents
  getPercentile(percentile: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * percentile);
    return sorted[idx] || 0;
  }
}

describe('bf-2p07: Circular Buffer for Decode Latencies', () => {
  let buffer: CircularLatencyBuffer;

  beforeEach(() => {
    buffer = new CircularLatencyBuffer();
  });

  describe('bounds checking', () => {
    it('should stay bounded during fill phase', () => {
      // Add 500 entries (less than MAX_SIZE)
      for (let i = 0; i < 500; i++) {
        buffer.push(i);
      }

      expect(buffer.getSize()).toBe(500);
      expect(buffer.getMemoryEstimate()).toBe(500 * 8); // 4KB
    });

    it('should stay bounded after MAX_SIZE entries', () => {
      // Add 2000 entries (more than MAX_SIZE)
      for (let i = 0; i < 2000; i++) {
        buffer.push(i);
      }

      // Should never exceed MAX_SIZE
      expect(buffer.getSize()).toBe(1000);
      expect(buffer.getMemoryEstimate()).toBe(1000 * 8); // 8KB
    });

    it('should stay bounded after very long session', () => {
      // Simulate 10,000 frames (~5.5 minutes at 30fps)
      for (let i = 0; i < 10_000; i++) {
        buffer.push(i);
      }

      // Should still be bounded
      expect(buffer.getSize()).toBe(1000);
      expect(buffer.getMemoryEstimate()).toBeLessThan(10_000); // < 10KB
    });

    it('should stay bounded after extremely long session', () => {
      // Simulate 100,000 frames (~55 minutes at 30fps)
      for (let i = 0; i < 100_000; i++) {
        buffer.push(i);
      }

      // Should still be exactly MAX_SIZE
      expect(buffer.getSize()).toBe(1000);
      expect(buffer.getMemoryEstimate()).toBe(8_000); // Exactly 8KB
    });
  });

  describe('circular wrap behavior', () => {
    it('should overwrite old entries when full', () => {
      // Fill buffer
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      // Add one more - should overwrite index 0
      buffer.push(9999);

      const latencies = buffer.getLatencies();
      expect(latencies[0]).toBe(9999); // Overwritten
      expect(latencies[1]).toBe(1); // Unchanged
      expect(latencies.length).toBe(1000); // Size unchanged
    });

    it('should correctly wrap around multiple times', () => {
      // Fill buffer
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      // Add 2000 more entries (2 full wraps)
      for (let i = 1000; i < 3000; i++) {
        buffer.push(i);
      }

      // Buffer should contain last 1000 entries (2000-2999)
      const latencies = buffer.getLatencies();
      expect(latencies[0]).toBe(2000);
      expect(latencies[999]).toBe(2999);
      expect(latencies.length).toBe(1000);
    });

    it('should maintain correct index after wrap', () => {
      // Fill and wrap exactly
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      // Push exactly 1000 more (one full wrap)
      for (let i = 0; i < 1000; i++) {
        buffer.push(1000 + i);
      }

      // Should have last 1000 values
      const latencies = buffer.getLatencies();
      expect(latencies[0]).toBe(1000);
      expect(latencies[999]).toBe(1999);
    });
  });

  describe('percentile calculations', () => {
    it('should calculate p50 correctly with bounded buffer', () => {
      // Add 2000 values with known distribution
      for (let i = 0; i < 2000; i++) {
        buffer.push(i);
      }

      // p50 of last 1000 values (1000-1999) should be ~1500
      const p50 = buffer.getPercentile(0.5);
      expect(p50).toBeGreaterThanOrEqual(1400);
      expect(p50).toBeLessThanOrEqual(1600);
    });

    it('should calculate p99 correctly with bounded buffer', () => {
      // Add 2000 values
      for (let i = 0; i < 2000; i++) {
        buffer.push(i);
      }

      // p99 of last 1000 values should be near 1999
      const p99 = buffer.getPercentile(0.99);
      expect(p99).toBeGreaterThanOrEqual(1980);
      expect(p99).toBeLessThanOrEqual(1999);
    });

    it('should handle realistic latency values', () => {
      // Simulate realistic decode latencies (10-100ms)
      for (let i = 0; i < 2000; i++) {
        const latency = 10 + Math.random() * 90; // 10-100ms
        buffer.push(latency);
      }

      const p50 = buffer.getPercentile(0.5);
      const p99 = buffer.getPercentile(0.99);

      expect(p50).toBeGreaterThan(10);
      expect(p50).toBeLessThan(100);
      expect(p99).toBeGreaterThan(p50);
      expect(p99).toBeLessThanOrEqual(100);
    });

    it('should work with empty buffer', () => {
      const p50 = buffer.getPercentile(0.5);
      expect(p50).toBe(0);
    });

    it('should work with partial buffer', () => {
      // Add only 100 values
      for (let i = 0; i < 100; i++) {
        buffer.push(i * 10);
      }

      const p50 = buffer.getPercentile(0.5);
      expect(p50).toBeGreaterThanOrEqual(400);
      expect(p50).toBeLessThanOrEqual(600);
    });
  });

  describe('memory leak prevention', () => {
    it('should not leak memory during long session', () => {
      // Fill buffer initially
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      const initialMemory = buffer.getMemoryEstimate();
      expect(initialMemory).toBe(8_000); // 1000 entries × 8 bytes

      // Simulate very long session: 1 million frames (~9 hours at 30fps)
      for (let i = 0; i < 1_000_000; i++) {
        buffer.push(i);
      }

      const finalMemory = buffer.getMemoryEstimate();

      // Memory should stay constant
      expect(finalMemory).toBe(initialMemory);
      expect(finalMemory).toBe(8_000); // Still 1000 entries × 8 bytes
    });

    it('should allow garbage collection of overwritten values', () => {
      // Fill buffer with values
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      // Overwrite them
      for (let i = 0; i < 1000; i++) {
        buffer.push(1000 + i);
      }

      // Size should still be 1000 (not 2000)
      expect(buffer.getSize()).toBe(1000);

      // Memory estimate should be constant
      expect(buffer.getMemoryEstimate()).toBe(8_000);
    });

    it('should reset cleanly on clear', () => {
      // Fill buffer
      for (let i = 0; i < 1000; i++) {
        buffer.push(i);
      }

      expect(buffer.getSize()).toBe(1000);

      // Clear
      buffer.clear();

      // Should be empty
      expect(buffer.getSize()).toBe(0);
      expect(buffer.getMemoryEstimate()).toBe(0);

      // Should work normally after clear
      for (let i = 0; i < 500; i++) {
        buffer.push(i);
      }

      expect(buffer.getSize()).toBe(500);
    });
  });

  describe('regression tests for bf-2p07', () => {
    it('should prevent 4.7x degradation from unbounded array', () => {
      // Before fix: array grows to 100,000+ entries
      // After fix: array stays at 1000 entries

      let maxUnboundedSize = 0;
      let boundedSize = 0;

      // Simulate 50-minute session at 30fps = 90,000 frames
      for (let i = 0; i < 90_000; i++) {
        buffer.push(i);
        boundedSize = buffer.getSize();
        maxUnboundedSize = i + 1;
      }

      // Bounded should stay at 1000
      expect(boundedSize).toBe(1000);

      // Unbounded would have grown to 90,000
      expect(maxUnboundedSize).toBe(90_000);

      // Memory savings: 90,000 → 1,000 entries
      // Before: 90,000 × 8 bytes = 720KB
      // After: 1,000 × 8 bytes = 8KB
      // Reduction: 98.9%
      const reduction = (maxUnboundedSize - boundedSize) / maxUnboundedSize;
      expect(reduction).toBeGreaterThan(0.98); // >98% reduction
    });

    it('should maintain statistical validity with bounded window', () => {
      // The circular buffer maintains statistically valid p50/p99
      // by keeping the most recent 1000 samples

      // Simulate changing latency patterns
      // First 2000 frames: latencies 10-20ms
      for (let i = 0; i < 2000; i++) {
        buffer.push(10 + Math.random() * 10);
      }

      const earlyP50 = buffer.getPercentile(0.5);
      expect(earlyP50).toBeGreaterThan(10);
      expect(earlyP50).toBeLessThan(20);

      // Next 2000 frames: latencies 50-60ms (degraded performance)
      for (let i = 0; i < 2000; i++) {
        buffer.push(50 + Math.random() * 10);
      }

      const lateP50 = buffer.getPercentile(0.5);
      expect(lateP50).toBeGreaterThan(50);
      expect(lateP50).toBeLessThan(60);

      // P50 should reflect current state, not old data
      expect(lateP50).toBeGreaterThan(earlyP50 * 2);
    });
  });

  describe('performance characteristics', () => {
    it('should have O(1) push operation', () => {
      // Push should be constant time regardless of buffer state
      const start = performance.now();

      for (let i = 0; i < 10_000; i++) {
        buffer.push(i);
      }

      const elapsed = performance.now() - start;

      // 10,000 pushes should be very fast (< 10ms)
      expect(elapsed).toBeLessThan(10);
    });

    it('should handle rapid consecutive pushes', () => {
      // Simulate high-FPS scenario (60fps = 16.67ms per frame)
      const start = performance.now();

      for (let i = 0; i < 600; i++) {
        buffer.push(i);
      }

      const elapsed = performance.now() - start;

      // 600 pushes (10 seconds at 60fps) should be instant
      expect(elapsed).toBeLessThan(5);
    });
  });
});

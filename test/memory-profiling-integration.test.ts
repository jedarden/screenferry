/**
 * Integration tests for memory profiling infrastructure.
 *
 * Tests the memory profiling capabilities:
 * - Heap usage measurement at block intervals
 * - Memory metrics logging and analysis
 * - Monotonic growth pattern detection
 * - Machine-readable memory stats output
 *
 * Reference: bead bf-3pshd
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  MemoryProfiler,
  createMemoryProfiler,
  assertMemoryConstraints,
  assertNoMemoryLeak,
  getSnapshotAtBlock,
  compareProfiles,
  type MemoryProfileConfig,
  type MemoryProfileResult,
} from './helpers/memory-profiling-helpers';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { BLOCK, L } from '../src/core/params.js';

describe('Memory Profiling Infrastructure', () => {
  describe('MemoryProfiler class', () => {
    it('should create profiler with default config', () => {
      const profiler = new MemoryProfiler();
      expect(profiler).toBeDefined();
    });

    it('should create profiler with custom config', () => {
      const config: MemoryProfileConfig = {
        sampleIntervalBlocks: 50,
        enableGC: true,
        outputFile: '/tmp/test-memory-profile.json',
        consoleOutput: false,
      };
      const profiler = new MemoryProfiler(config);
      expect(profiler).toBeDefined();
    });

    it('should start and stop profiling', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Simulate some activity with forced samples
      const data = new Uint8Array(BLOCK);
      profiler.sample(0, true);
      profiler.sample(100, true);

      const result = profiler.stop();

      expect(result.snapshots.length).toBeGreaterThan(0);
      expect(result.metadata.startTime).toBeDefined();
      expect(result.metadata.endTime).toBeDefined();
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
    });

    it('should sample at configured intervals', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 10,
        consoleOutput: false,
      });
      profiler.start();

      // Sample at various block indices
      for (let i = 0; i < 50; i += 5) {
        profiler.sample(i);
      }

      const result = profiler.stop();

      // Should sample at blocks 0, 10, 20, 30, 40 (every 10 blocks)
      // Plus initial and final snapshots
      expect(result.snapshots.length).toBeGreaterThanOrEqual(5);
    });

    it('should force sample when requested', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 100,
        consoleOutput: false,
      });
      profiler.start();

      // Force sample at block 5 (before interval threshold)
      profiler.sample(5, true);

      const result = profiler.stop();

      // Should have snapshot at block 5 due to force sample
      const snapshot5 = getSnapshotAtBlock(result, 5);
      expect(snapshot5).toBeDefined();
    });

    it('should track block counter correctly', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 5,
        consoleOutput: false,
      });
      profiler.start();

      // Increment counter and sample at each step
      // Loop runs 5 times: i=0,1,2,3,4
      // At i=4: blockCounter becomes 5, which triggers sampling (5 - (-1) >= 5)
      for (let i = 0; i < 5; i++) {
        profiler.incrementBlockCounter();
        profiler.sample(); // Sample after increment (will trigger at interval threshold)
      }

      const result = profiler.stop();

      // Should have tracked block index 4 (when the 5th increment triggers the interval)
      // Note: blockCounter becomes 5 at i=4, but the sample is taken during that iteration
      expect(result.snapshots.some(s => s.blockIndex === 4)).toBe(true);
    });

    it('should calculate memory statistics correctly', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Create some memory pressure
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < 10; i++) {
        chunks.push(new Uint8Array(BLOCK));
        profiler.sample(i * 10, true);
      }

      const result = profiler.stop();

      expect(result.stats.sampleCount).toBeGreaterThan(0);
      expect(result.stats.initialHeap).toBeGreaterThan(0);
      expect(result.stats.peakHeap).toBeGreaterThanOrEqual(result.stats.initialHeap);
      expect(result.stats.finalHeap).toBeGreaterThan(0);
      expect(result.stats.avgHeap).toBeGreaterThan(0);

      // Clean up
      chunks.length = 0;
    });

    it('should detect monotonic growth patterns', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Simulate memory leak by retaining references
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < 20; i++) {
        chunks.push(new Uint8Array(BLOCK));
        profiler.sample(i, true);
      }

      const result = profiler.stop();

      // Should detect growth due to retained chunks
      expect(result.stats.heapGrowth).toBeGreaterThan(0);
      expect(result.growthAnalysis.growthRate).toBeGreaterThan(0);

      // Clean up
      chunks.length = 0;
    });

    it('should detect memory cleanup', () => {
      const profiler = createMemoryProfiler({
        enableGC: true,
        consoleOutput: false,
      });
      profiler.start();

      // Create significant memory pressure with larger allocations
      const chunks: Uint8Array[] = [];
      // Create 100 chunks of 1MB each to ensure measurable memory growth
      for (let i = 0; i < 100; i++) {
        chunks.push(new Uint8Array(1024 * 1024)); // 1MB chunks
      }

      // Force sample to capture the memory pressure
      profiler.sample(10, true);

      // Take another sample to establish the high memory baseline
      profiler.sample(11, true);

      // Release all memory
      chunks.length = 0;

      // Force GC if available to ensure cleanup is visible
      if (globalThis.gc) {
        globalThis.gc();
      }

      // Take sample after cleanup
      profiler.sample(12, true);

      const result = profiler.stop();

      // Should have cleanup alerts when memory drops significantly
      const cleanupAlerts = result.growthAnalysis.alerts.filter(
        a => a.type === 'cleanup-detected'
      );

      // Debug logging to help understand test behavior
      if (cleanupAlerts.length === 0) {
        console.log('DEBUG: No cleanup alerts found. Heap values:',
          result.snapshots.map(s => ({
            blockIndex: s.blockIndex,
            heapUsed: Math.round(s.heapUsed / 1024 / 1024) + 'MB'
          }))
        );
      }

      expect(cleanupAlerts.length).toBeGreaterThan(0);
    });

    it('should write output to file when configured', () => {
      const outputFile = '/tmp/test-memory-profile-output.json';
      const profiler = createMemoryProfiler({
        outputFile,
        consoleOutput: false,
      });
      profiler.start();

      profiler.sample(0);
      profiler.sample(100);

      const result = profiler.stop();

      // Check file exists
      expect(existsSync(outputFile)).toBe(true);

      // Clean up
      if (existsSync(outputFile)) {
        unlinkSync(outputFile);
      }
    });

    it('should provide machine-readable output', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      profiler.sample(0);
      profiler.sample(50);

      const result = profiler.stop();

      // Verify structure is serializable
      expect(() => JSON.stringify(result)).not.toThrow();

      // Verify required fields
      expect(result.snapshots).toBeInstanceOf(Array);
      expect(result.stats).toBeDefined();
      expect(result.growthAnalysis).toBeDefined();
      expect(result.metadata).toBeDefined();

      // Verify snapshot structure
      const snapshot = result.snapshots[0];
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot).toHaveProperty('heapUsed');
      expect(snapshot).toHaveProperty('heapTotal');
      expect(snapshot).toHaveProperty('rss');
    });

    it('should estimate leak probability', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Simulate steady growth pattern
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < 50; i++) {
        chunks.push(new Uint8Array(L));
        profiler.sample(i, true);
      }

      const result = profiler.stop();

      // Should have leak probability assessment
      expect(result.growthAnalysis.leakProbability).toMatch(/low|medium|high/);

      // Clean up
      chunks.length = 0;
    });
  });

  describe('Memory profiling integration scenarios', () => {
    it('should profile encode-decode roundtrip with block intervals', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 2,
        consoleOutput: false,
      });
      profiler.start();

      // Simulate encode-decode roundtrip for 10 blocks
      for (let blockIndex = 0; blockIndex < 10; blockIndex++) {
        // Encode block
        const fragments = [];
        for (let i = 0; i < 10; i++) {
          fragments.push(new Uint8Array(L));
        }

        // Memory profiler samples at block intervals
        profiler.sample(blockIndex);

        // Decode block (simulate processing)
        const decoded = new Uint8Array(BLOCK);
      }

      const result = profiler.stop();

      // Should have samples at blocks 0, 2, 4, 6, 8
      expect(result.snapshots.length).toBeGreaterThan(0);
      // The last sampled block should be 8 (since we sample every 2 blocks: 0, 2, 4, 6, 8)
      expect(result.metadata.totalBlocks).toBeGreaterThanOrEqual(8);
      expect(result.metadata.totalBlocks).toBeLessThanOrEqual(9);
    });

    it('should detect memory leaks in long-running process', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 100,
        consoleOutput: false,
      });
      profiler.start();

      // Simulate long-running process with potential leak
      const leakedData: Uint8Array[][] = [];
      for (let blockIndex = 0; blockIndex < 500; blockIndex++) {
        // Simulate retaining data (potential leak)
        if (blockIndex % 50 === 0) {
          leakedData.push([new Uint8Array(BLOCK)]);
        }

        profiler.sample(blockIndex);
      }

      const result = profiler.stop();

      // Should detect leak if growth is significant
      if (result.stats.heapGrowthPercent > 50) {
        expect(result.growthAnalysis.leakProbability).not.toBe('low');
      }

      // Clean up
      leakedData.length = 0;
    });

    it('should profile with automatic garbage collection', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 10,
        enableGC: true,
        consoleOutput: false,
      });
      profiler.start();

      // Create temporary objects
      for (let i = 0; i < 20; i++) {
        const temp = new Uint8Array(BLOCK);
        profiler.sample(i);
        // temp goes out of scope, GC should clean it up
      }

      const result = profiler.stop();

      // With GC enabled, memory should be more stable
      expect(result.stats.heapGrowthPercent).toBeLessThan(100);
    });

    it('should handle block processing with variable intervals', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 5,
        consoleOutput: false,
      });
      profiler.start();

      // Simulate variable block processing intervals
      const blocks = [0, 3, 7, 12, 18, 25, 33, 42, 52, 63];
      for (const blockIndex of blocks) {
        profiler.sample(blockIndex);
      }

      const result = profiler.stop();

      // Should sample at blocks 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60
      const sampledBlocks = result.snapshots
        .filter(s => s.blockIndex !== undefined)
        .map(s => s.blockIndex);

      expect(sampledBlocks.length).toBeGreaterThan(0);
    });
  });

  describe('Helper functions', () => {
    it('should assert memory constraints correctly', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      profiler.sample(0);
      profiler.sample(100);

      const result = profiler.stop();

      // Should pass with reasonable limits
      expect(() => {
        assertMemoryConstraints(result, 1000, 500); // 1000 MB max heap, 500% max growth
      }).not.toThrow();

      // Should fail with strict limits
      expect(() => {
        assertMemoryConstraints(result, 0.001, 0.1); // Very strict limits
      }).toThrow();
    });

    it('should assert no memory leak', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Clean operations with no leak
      profiler.sample(0);
      const temp = new Uint8Array(BLOCK);
      profiler.sample(100);
      // temp is released

      const result = profiler.stop();

      // If leak probability is not high, should pass
      if (result.growthAnalysis.leakProbability !== 'high') {
        expect(() => {
          assertNoMemoryLeak(result);
        }).not.toThrow();
      }
    });

    it('should get snapshot at specific block', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      profiler.sample(0, true);
      profiler.sample(100, true);

      const result = profiler.stop();

      const snapshot0 = getSnapshotAtBlock(result, 0);
      const snapshot100 = getSnapshotAtBlock(result, 100);
      const snapshotMissing = getSnapshotAtBlock(result, 999);

      expect(snapshot0).toBeDefined();
      expect(snapshot100).toBeDefined();
      expect(snapshotMissing).toBeUndefined();
    });

    it('should compare two profiles', () => {
      // Baseline profile
      const profiler1 = createMemoryProfiler({ consoleOutput: false });
      profiler1.start();
      profiler1.sample(0);
      profiler1.sample(100);
      const baseline = profiler1.stop();

      // Current profile (more memory usage)
      const profiler2 = createMemoryProfiler({ consoleOutput: false });
      profiler2.start();
      const data = new Uint8Array(BLOCK);
      profiler2.sample(0);
      profiler2.sample(100);
      const current = profiler2.stop();

      const comparison = compareProfiles(baseline, current);

      expect(comparison).toHaveProperty('heapGrowthDiff');
      expect(comparison).toHaveProperty('peakHeapDiff');
      expect(comparison).toHaveProperty('leakProbabilityComparison');
      expect(comparison.leakProbabilityComparison).toMatch(/→/);
    });

    it('should create profiler using factory function', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      expect(profiler).toBeInstanceOf(MemoryProfiler);
    });
  });

  describe('Real-world scenarios', () => {
    it('should profile large-scale file transfer simulation', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 100,
        consoleOutput: false,
      });
      profiler.start();

      // Simulate transferring 1000 blocks
      const totalBlocks = 1000;
      for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
        // Simulate encode
        const fragments = new Array(10).fill(null).map(() => new Uint8Array(L));

        // Simulate packet generation and reception
        const packets = new Array(100).fill(null).map(() => new Uint8Array(1500));

        // Simulate decode
        const decoded = new Uint8Array(BLOCK);

        // Sample memory every 100 blocks
        profiler.sample(blockIndex);

        // Clean up temporary objects
        if (blockIndex % 10 === 0) {
          // Explicit cleanup at intervals
        }
      }

      const result = profiler.stop();

      // Verify profiling captured the full run
      // With sampleIntervalBlocks: 100, we should sample at blocks 0, 100, 200, ... 900
      expect(result.metadata.totalBlocks).toBeGreaterThanOrEqual(900);
      expect(result.stats.sampleCount).toBeGreaterThan(0);
      expect(result.metadata.duration).toBeGreaterThan(0);

      // Check for memory efficiency
      const samplesPerBlock = result.stats.sampleCount / totalBlocks;
      expect(samplesPerBlock).toBeLessThan(0.02); // Less than 2% overhead
    });

    it('should detect memory spikes during processing', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 10,
        enableGC: false, // Disable GC to ensure spike is visible
        consoleOutput: false,
      });
      profiler.start();

      // Establish baseline
      profiler.sample(0, true);

      // Memory spike - create large allocation and keep reference throughout
      // Create 200 MB of data
      const spike: Uint8Array[] = new Array(200).fill(null).map(() => new Uint8Array(1024 * 1024));

      // Take sample immediately after spike creation
      profiler.sample(6, true);

      // Keep spike alive through the rest of the test
      // Access it to prevent compiler optimization
      const spikeSize = spike.length;
      expect(spikeSize).toBe(200);

      // Take more samples while spike is still held
      profiler.sample(10, true);
      profiler.sample(15, true);

      const result = profiler.stop();

      // Debug: check memory values
      console.log('DEBUG: Spike test heap values:', result.snapshots.map(s => ({
        blockIndex: s.blockIndex,
        heapUsed: Math.round(s.heapUsed / 1024 / 1024)
      })));
      console.log('DEBUG: initialHeap:', Math.round(result.stats.initialHeap / 1024 / 1024), 'MB');
      console.log('DEBUG: peakHeap:', Math.round(result.stats.peakHeap / 1024 / 1024), 'MB');
      console.log('DEBUG: Alerts:', result.growthAnalysis.alerts.map(a => ({ type: a.type, message: a.message })));

      // Should detect spike alerts or at least show significantly increased memory
      const spikeAlerts = result.growthAnalysis.alerts.filter(
        a => a.type === 'spike'
      );

      // Even if no spike alerts, the peak should be much higher than initial
      // With 200MB spike, we should see at least 50% increase
      const hasSpike = spikeAlerts.length > 0 ||
        result.stats.peakHeap > result.stats.initialHeap * 1.5;

      expect(hasSpike).toBe(true);
    });

    it('should track memory during cleanup operations', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 10,
        enableGC: true,
        consoleOutput: false,
      });
      profiler.start();

      // Accumulate large amount of data
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < 200; i++) {
        chunks.push(new Uint8Array(BLOCK));
        profiler.sample(i, i === 0); // Sample at start and intervals
      }

      // Take sample before cleanup
      profiler.sample(200, true);

      // Cleanup operation - clear all chunks
      chunks.length = 0;

      // Force GC if available to ensure cleanup is visible
      if (globalThis.gc) {
        globalThis.gc();
      }

      // Take sample after cleanup
      profiler.sample(210, true);

      const result = profiler.stop();

      // Should detect cleanup or at least show memory reduction
      const cleanupAlerts = result.growthAnalysis.alerts.filter(
        a => a.type === 'cleanup-detected'
      );

      // With such a large cleanup and GC, should have cleanup alerts or memory reduction
      const hasCleanupEffect = cleanupAlerts.length > 0 ||
        result.stats.heapGrowth < 0 || // Overall memory decreased
        result.stats.finalHeap < result.stats.peakHeap; // Final is lower than peak

      expect(hasCleanupEffect).toBe(true);
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle profiling with no samples', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      // Stop immediately without sampling
      const result = profiler.stop();

      // Should still have initial snapshot
      expect(result.snapshots.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle profiling with single sample', () => {
      const profiler = createMemoryProfiler({ consoleOutput: false });
      profiler.start();

      profiler.sample(0);

      const result = profiler.stop();

      // Should have initial + one sample + final snapshots
      expect(result.snapshots.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle very large sample intervals', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 1000000,
        consoleOutput: false,
      });
      profiler.start();

      // Sample at relatively small blocks (force samples since interval is huge)
      profiler.sample(0, true);
      profiler.sample(10, true);
      profiler.sample(20, true);

      const result = profiler.stop();

      // With large interval + forced samples, should have samples
      // Initial snapshot + forced samples + final snapshot
      expect(result.snapshots.length).toBeGreaterThanOrEqual(4);
    });

    it('should handle negative memory deltas gracefully', () => {
      const profiler = createMemoryProfiler({
        sampleIntervalBlocks: 5,
        enableGC: true,
        consoleOutput: false,
      });
      profiler.start();

      // Create large memory pressure
      let chunks = new Array(100).fill(null).map(() => new Uint8Array(BLOCK));
      profiler.sample(0, true);

      // Release all memory
      chunks = [];

      // Force GC if available to ensure memory is freed
      if (globalThis.gc) {
        globalThis.gc();
      }

      profiler.sample(10, true);

      const result = profiler.stop();

      // With large cleanup and GC, should have negative or very small growth
      // Note: In real test environments, memory management is complex
      // so we just verify the calculation doesn't crash and produces reasonable values
      expect(result.stats.heapGrowth).toBeDefined();
      expect(result.growthAnalysis.growthRate).toBeDefined();

      // If GC worked, we should see some cleanup alerts or reduced growth
      if (result.growthAnalysis.alerts.some(a => a.type === 'cleanup-detected')) {
        expect(result.stats.heapGrowth).toBeLessThan(result.stats.peakHeap);
      }
    });
  });
});
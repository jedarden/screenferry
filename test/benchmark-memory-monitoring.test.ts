/**
 * Memory monitoring benchmark test
 *
 * Runs extended camera sessions to collect memory metrics and detect
 * monotonic growth patterns that indicate memory leaks.
 *
 * This test simulates a 10-minute receiver session while collecting
 * frame-level heap and handle metrics.
 *
 * Reference: bead screenferry-33ffefbc
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createCameraPipeline } from '../src/platform/camera-pipeline.js';
import { createMemoryMonitor, type MemorySnapshot } from '../src/platform/memory-monitor.js';
import { generateMemoryReport, analyzeMemorySnapshots, generateHtmlChart } from '../src/platform/memory-analysis-tools.js';

describe('Memory Monitoring Benchmark', () => {
  let memoryMonitor: ReturnType<typeof createMemoryMonitor>;
  let collectedSnapshots: MemorySnapshot[] = [];

  beforeAll(() => {
    // Create memory monitor with enhanced configuration
    memoryMonitor = createMemoryMonitor({
      sampleInterval: 100, // Sample every 100 frames (~3.3 seconds at 30fps)
      maxSnapshots: 2000, // Store up to ~110 seconds of data
      trackArrays: true,
      trackWorkers: true,
      trackHandles: true,
      frameRate: 30,
    });
  });

  afterAll(() => {
    // Generate final report
    if (collectedSnapshots.length > 0) {
      console.log('\n=== Memory Monitoring Report ===\n');
      const report = generateMemoryReport(
        collectedSnapshots,
        memoryMonitor.getSessionId(),
        {
          includeCharts: true,
          includeAnalysis: true,
        }
      );
      console.log(report);

      // Export metrics data
      const metricsData = memoryMonitor.exportMetrics();
      console.log('\n=== Metrics Export ===');
      console.log(`Session ID: ${memoryMonitor.getSessionId()}`);
      console.log(`Total Snapshots: ${collectedSnapshots.length}`);
      console.log(`Export Data Size: ${metricsData.length} bytes`);
    }
  });

  it('should initialize memory monitoring', () => {
    memoryMonitor.startMonitoring(0);
    expect(memoryMonitor.getSessionId()).toBeDefined();
    expect(memoryMonitor.getSessionId()).toMatch(/^session-\d+-[a-z0-9]+$/);
  });

  it('should collect memory snapshots over simulated session', async () => {
    const durationMinutes = 10;
    const fps = 30;
    const totalFrames = durationMinutes * 60 * fps; // 10 minutes at 30fps
    const sampleInterval = 100; // Sample every 100 frames

    console.log(`Starting ${durationMinutes}-minute simulated session...`);
    console.log(`Total frames: ${totalFrames}`);
    console.log(`Sample interval: ${sampleInterval} frames`);

    let snapshotCount = 0;
    let totalHeapGrowth = 0;
    let lastHeapSize = 0;

    // Simulate camera pipeline activity
    for (let frame = 0; frame < totalFrames; frame += sampleInterval) {
      // Simulate memory allocation patterns
      const currentHeapSize = simulateHeapGrowth(frame, totalFrames);
      const heapGrowth = currentHeapSize - lastHeapSize;
      totalHeapGrowth += heapGrowth;
      lastHeapSize = currentHeapSize;

      // Take memory snapshot with simulated context
      const snapshot = memoryMonitor.takeSnapshot(frame, {
        frameTimestampsCount: simulateArrayGrowth(frame, 'timestamps'),
        decodeLatenciesCount: simulateArrayGrowth(frame, 'latencies'),
        packetsPerFrameCount: simulateArrayGrowth(frame, 'packets'),
        inFlightFrames: Math.floor(Math.random() * 4), // 0-3 in-flight frames
        workerCount: 4, // Fixed worker count
      });

      if (snapshot) {
        snapshotCount++;
        collectedSnapshots.push(snapshot);

        // Log progress every 30 seconds
        if (frame % (30 * fps) === 0) {
          const elapsedSeconds = frame / fps;
          console.log(`Progress: ${elapsedSeconds}s / ${durationMinutes * 60}s - Heap: ${(currentHeapSize / (1024 * 1024)).toFixed(2)} MB`);
        }
      }
    }

    console.log(`\nCompleted simulated session with ${snapshotCount} snapshots`);
    console.log(`Total heap growth: ${(totalHeapGrowth / (1024 * 1024)).toFixed(2)} MB`);

    expect(snapshotCount).toBeGreaterThan(0);
    expect(collectedSnapshots.length).toBeGreaterThan(0);
  });

  it('should detect monotonic growth patterns', () => {
    if (collectedSnapshots.length === 0) {
      console.log('Skipping growth detection - no snapshots collected');
      return;
    }

    const analysis = memoryMonitor.detectMonotonicGrowth();

    console.log('\n=== Monotonic Growth Analysis ===');
    console.log(`Heap Trend: ${analysis.heapGrowthTrend}`);
    console.log(`Handle Trend: ${analysis.handleGrowthTrend}`);
    console.log(`Growth Rate: ${analysis.slopePerSecond.toFixed(2)} bytes/s`);
    console.log(`Confidence: ${analysis.confidence}`);
    console.log(`\n${analysis.details}`);

    expect(analysis.heapGrowthTrend).toBeDefined();
    expect(analysis.confidence).toBeDefined();
  });

  it('should provide leak analysis', () => {
    if (collectedSnapshots.length === 0) {
      console.log('Skipping leak analysis - no snapshots collected');
      return;
    }

    const leakAnalysis = analyzeMemorySnapshots(collectedSnapshots);

    console.log('\n=== Leak Analysis ===');
    console.log(`Has Leak: ${leakAnalysis.hasLeak}`);
    console.log(`Severity: ${leakAnalysis.leakSeverity}`);
    console.log(`\n${leakAnalysis.analysis}`);
    console.log('\nRecommendations:');
    leakAnalysis.recommendations.forEach(rec => console.log(rec));

    expect(leakAnalysis.hasLeak).toBeDefined();
    expect(leakAnalysis.leakSeverity).toBeDefined();
    expect(leakAnalysis.recommendations).toBeDefined();
  });

  it('should generate visualization data', () => {
    if (collectedSnapshots.length === 0) {
      console.log('Skipping visualization - no snapshots collected');
      return;
    }

    const vizData = memoryMonitor.getVisualizationData();

    console.log('\n=== Visualization Data ===');
    console.log(`Labels: ${vizData.labels.length} time points`);
    console.log(`Heap Data Points: ${vizData.heapData.length}`);
    console.log(`Time Range: ${vizData.timeData[0]!.toFixed(1)}s - ${vizData.timeData[vizData.timeData.length - 1]!.toFixed(1)}s`);

    if (vizData.handleData) {
      console.log(`Handle Data Points: ${vizData.handleData.length}`);
    }

    expect(vizData.labels.length).toBeGreaterThan(0);
    expect(vizData.heapData.length).toBeGreaterThan(0);
    expect(vizData.summary).toBeDefined();
  });

  it('should export and import metrics data', () => {
    if (collectedSnapshots.length === 0) {
      console.log('Skipping export/import - no snapshots collected');
      return;
    }

    // Export metrics
    const exportedData = memoryMonitor.exportMetrics();
    expect(exportedData).toBeDefined();
    expect(exportedData.length).toBeGreaterThan(0);

    // Parse and validate export
    const exportObj = JSON.parse(exportedData);
    expect(exportObj.sessionId).toBeDefined();
    expect(exportObj.snapshots).toBeDefined();
    expect(exportObj.analysis).toBeDefined();

    console.log('\n=== Export/Import Test ===');
    console.log(`Export size: ${exportedData.length} bytes`);
    console.log(`Session ID in export: ${exportObj.sessionId}`);
    console.log(`Snapshots in export: ${exportObj.snapshots.length}`);

    // Test import functionality
    const newMonitor = createMemoryMonitor({ sampleInterval: 60 });
    newMonitor.importMetrics(exportedData);

    const importedSnapshots = newMonitor.getSnapshots();
    expect(importedSnapshots.length).toBeGreaterThan(0);
    console.log(`Successfully imported ${importedSnapshots.length} snapshots`);
  });
});

/**
 * Simulate heap growth patterns for testing
 *
 * This simulates realistic heap growth patterns that might occur
 * during a camera session, including both stable memory and gradual leaks.
 */
function simulateHeapGrowth(frame: number, totalFrames: number): number {
  // Base memory usage (50 MB)
  const baseMemory = 50 * 1024 * 1024;

  // Add some variability (±5 MB)
  const variability = (Math.random() - 0.5) * 10 * 1024 * 1024;

  // Simulate gradual memory leak (0.5 MB per minute)
  const leakRate = 0.5 * 1024 * 1024; // 0.5 MB per minute
  const minutesElapsed = frame / (30 * 60); // Assuming 30 fps
  const leakGrowth = leakRate * minutesElapsed;

  // Add some periodic GC effects
  const gcEffect = Math.sin(frame / 1000) * 2 * 1024 * 1024; // ±2 MB periodic

  return baseMemory + variability + leakGrowth + gcEffect;
}

/**
 * Simulate array growth patterns for testing
 *
 * This simulates how various arrays might grow during operation,
 * including both bounded growth (circular buffers) and potential leaks.
 */
function simulateArrayGrowth(frame: number, arrayType: 'timestamps' | 'latencies' | 'packets'): number {
  const baseSize = 100;

  switch (arrayType) {
    case 'timestamps':
      // Should stay bounded due to cleanup (bf-2p07 fix)
      return Math.min(baseSize + Math.floor(Math.random() * 50), 1000);

    case 'latencies':
      // Circular buffer with fixed max size
      return Math.min(1000, Math.floor(frame / 10) % 1200);

    case 'packets':
      // Unbounded growth if leak exists
      return baseSize + Math.floor(frame / 30);

    default:
      return baseSize;
  }
}

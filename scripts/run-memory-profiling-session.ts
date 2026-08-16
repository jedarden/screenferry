#!/usr/bin/env node
/**
 * Memory profiling session runner
 *
 * This script simulates a long-running camera pipeline session to collect
 * memory metrics and detect monotonic growth patterns.
 *
 * Usage:
 *   node scripts/run-memory-profiling-session.ts [duration-minutes]
 *
 * Example:
 *   node scripts/run-memory-profiling-session.ts 10  # 10-minute session
 */

import { MemoryMonitor, createMemoryMonitor, type MemorySnapshot } from '../src/platform/memory-monitor.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface SessionConfig {
  duration: number; // minutes
  sampleInterval: number; // frames
  frameRate: number; // fps
  outputDir: string;
}

interface SessionResult {
  sessionId: string;
  config: SessionConfig;
  startTime: number;
  endTime: number;
  duration: number; // milliseconds
  snapshots: MemorySnapshot[];
  analysis: {
    leakDetection: ReturnType<MemoryMonitor['analyzeLeaks']>;
    monotonicGrowth: ReturnType<MemoryMonitor['detectMonotonicGrowth']>;
  };
}

/**
 * Simulate camera pipeline frame processing with memory allocation patterns
 */
function simulateFrameProcessing(frameIndex: number, memoryMonitor: MemoryMonitor) {
  // Simulate typical frame processing allocations:
  // - VideoFrame/ImageData objects
  // - QR decode results
  // - ROI calculations
  // - Array operations

  const tempArrays: Uint8Array[] = [];

  // Simulate video frame allocation (typical 1080p frame ~6MB)
  if (frameIndex % 30 === 0) {
    tempArrays.push(new Uint8Array(6 * 1024 * 1024));
  }

  // Simulate QR decode results
  if (frameIndex % 10 === 0) {
    tempArrays.push(new Uint8Array(1024 * 1024));
  }

  // Simulate array operations (timestamps, latencies, packets)
  const frameTimestampsCount = 100 + Math.floor(frameIndex * 0.1); // Simulate gradual growth
  const decodeLatenciesCount = 1000; // Circular buffer stays bounded
  const packetsPerFrameCount = 50;

  // Take memory snapshot
  memoryMonitor.takeSnapshot(frameIndex, {
    frameTimestampsCount,
    decodeLatenciesCount,
    packetsPerFrameCount,
    inFlightFrames: Math.floor(Math.random() * 4),
    workerCount: 4
  });

  // Cleanup (simulate proper resource management)
  tempArrays.length = 0;
}

/**
 * Run a memory profiling session
 */
async function runSession(config: SessionConfig): Promise<SessionResult> {
  console.log('📊 Memory Profiling Session');
  console.log('='.repeat(50));
  console.log(`Duration: ${config.duration} minutes`);
  console.log(`Sample Interval: ${config.sampleInterval} frames`);
  console.log(`Frame Rate: ${config.frameRate} fps`);
  console.log('='.repeat(50));

  const startTime = Date.now();
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  // Initialize memory monitor
  const memoryMonitor = createMemoryMonitor({
    sampleInterval: config.sampleInterval,
    maxSnapshots: 10000, // Keep all snapshots for analysis
    trackArrays: true,
    trackWorkers: true,
    trackHandles: true,
    frameRate: config.frameRate,
  });

  memoryMonitor.startMonitoring(0);

  const totalFrames = config.duration * 60 * config.frameRate; // minutes * seconds * fps
  let frameIndex = 0;

  console.log(`\nProcessing ${totalFrames} frames...`);

  // Process frames
  const progressInterval = setInterval(() => {
    const progress = ((frameIndex / totalFrames) * 100).toFixed(1);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`Progress: ${progress}% | Elapsed: ${elapsed}s | Frame: ${frameIndex}/${totalFrames}`);
  }, 10000); // Every 10 seconds

  while (frameIndex < totalFrames) {
    simulateFrameProcessing(frameIndex, memoryMonitor);
    frameIndex++;

    // Small delay to simulate real frame processing time
    if (frameIndex % 1000 === 0) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  clearInterval(progressInterval);

  // Stop monitoring and get results
  const snapshots = memoryMonitor.stopMonitoring();
  const endTime = Date.now();
  const duration = endTime - startTime;

  // Analyze results
  const leakDetection = memoryMonitor.analyzeLeaks();
  const monotonicGrowth = memoryMonitor.detectMonotonicGrowth();

  console.log('\n✅ Session Complete!');
  console.log('='.repeat(50));
  console.log(`Total Duration: ${(duration / 1000 / 60).toFixed(2)} minutes`);
  console.log(`Frames Processed: ${frameIndex}`);
  console.log(`Snapshots Collected: ${snapshots.length}`);
  console.log('='.repeat(50));

  // Print analysis
  console.log('\n📈 Leak Detection:');
  console.log(`  Heap Leak: ${leakDetection.hasHeapLeak ? '❌ YES' : '✅ NO'}`);
  console.log(`  Array Leak: ${leakDetection.hasArrayLeak ? '❌ YES' : '✅ NO'}`);
  console.log(`  Worker Leak: ${leakDetection.hasWorkerLeak ? '❌ YES' : '✅ NO'}`);

  console.log('\n📊 Monotonic Growth Analysis:');
  console.log(`  Heap Trend: ${monotonicGrowth.heapGrowthTrend.toUpperCase()}`);
  console.log(`  Handle Trend: ${monotonicGrowth.handleGrowthTrend.toUpperCase()}`);
  console.log(`  Monotonic Heap Growth: ${monotonicGrowth.hasMonotonicHeapGrowth ? '❌ YES' : '✅ NO'}`);
  console.log(`  Monotonic Handle Growth: ${monotonicGrowth.hasMonotonicHandleGrowth ? '❌ YES' : '✅ NO'}`);
  console.log(`  Slope: ${Math.round(monotonicGrowth.slopePerSecond / 1024)} KB/s`);
  console.log(`  Confidence: ${monotonicGrowth.confidence.toUpperCase()}`);

  if (monotonicGrowth.hasMonotonicHeapGrowth) {
    console.log('\n⚠️  MONOTONIC HEAP GROWTH DETECTED!');
    console.log('   This indicates a potential memory leak.');
  }

  return {
    sessionId,
    config,
    startTime,
    endTime,
    duration,
    snapshots,
    analysis: {
      leakDetection,
      monotonicGrowth,
    },
  };
}

/**
 * Export session results to file
 */
function exportResults(result: SessionResult, outputDir: string) {
  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date(result.startTime).toISOString().replace(/[:.]/g, '-');
  const filename = `memory-profile-${timestamp}.json`;
  const filepath = join(outputDir, filename);

  const exportData = {
    sessionId: result.sessionId,
    config: result.config,
    timing: {
      startTime: result.startTime,
      endTime: result.endTime,
      duration: result.duration,
      durationMinutes: (result.duration / 1000 / 60).toFixed(2),
    },
    snapshots: result.snapshots,
    analysis: result.analysis,
    exportTimestamp: Date.now(),
  };

  writeFileSync(filepath, JSON.stringify(exportData, null, 2));
  console.log(`\n💾 Results exported to: ${filepath}`);

  return filepath;
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const duration = args[0] ? parseInt(args[0], 10) : 10; // Default 10 minutes

  if (isNaN(duration) || duration <= 0) {
    console.error('Invalid duration. Usage: node run-memory-profiling-session.ts [minutes]');
    process.exit(1);
  }

  const config: SessionConfig = {
    duration,
    sampleInterval: 100, // Sample every 100 frames
    frameRate: 30, // 30 fps
    outputDir: join(process.cwd(), 'benchmark-results', 'memory-profiling'),
  };

  try {
    const result = await runSession(config);
    const outputFile = exportResults(result, config.outputDir);

    console.log('\n✨ Success!');
    console.log(`\n📂 Open the visualizer to analyze results:`);
    console.log(`   file://${join(process.cwd(), 'docs', 'memory-metrics-visualizer.html')}`);
    console.log(`\n📄 Then load the exported file:`);
    console.log(`   ${outputFile}`);

  } catch (error) {
    console.error('❌ Session failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { runSession, exportResults, type SessionConfig, type SessionResult };
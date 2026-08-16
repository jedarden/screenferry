#!/usr/bin/env node
/**
 * Memory benchmark runner
 *
 * Runs a real camera session with memory monitoring enabled to detect
 * monotonic growth patterns and memory leaks.
 *
 * Usage: node --loader ts-node/esm scripts/run-memory-benchmark.ts
 *
 * Reference: bead screenferry-33ffefbc
 */

import { createCameraPipeline } from '../src/platform/camera-pipeline.js';
import { createMemoryMonitor } from '../src/platform/memory-monitor.js';
import { generateMemoryReport, generateHtmlChart } from '../src/platform/memory-analysis-tools.js';
import * as fs from 'fs';
import * as path from 'path';

interface BenchmarkConfig {
  durationMinutes: number;
  sampleInterval: number;
  fps: number;
  exportDir: string;
  generateHtmlReport: boolean;
}

const config: BenchmarkConfig = {
  durationMinutes: 10, // 10-minute session
  sampleInterval: 100, // Sample every 100 frames (~3.3 seconds at 30fps)
  fps: 30,
  exportDir: './benchmark-results/memory-monitoring',
  generateHtmlReport: true,
};

async function runMemoryBenchmark(): Promise<void> {
  console.log('=== ScreenFerry Memory Benchmark ===');
  console.log(`Duration: ${config.durationMinutes} minutes`);
  console.log(`Sample Interval: ${config.sampleInterval} frames`);
  console.log(`Export Directory: ${config.exportDir}`);
  console.log('');

  // Create export directory
  if (!fs.existsSync(config.exportDir)) {
    fs.mkdirSync(config.exportDir, { recursive: true });
  }

  // Initialize memory monitor
  const memoryMonitor = createMemoryMonitor({
    sampleInterval: config.sampleInterval,
    maxSnapshots: 2000,
    trackArrays: true,
    trackWorkers: true,
    trackHandles: true,
    frameRate: config.fps,
  });

  console.log(`Session ID: ${memoryMonitor.getSessionId()}`);
  memoryMonitor.startMonitoring(0);

  try {
    // Create and start camera pipeline
    const pipeline = createCameraPipeline({
      resolution: '1080p' as any,
      frameRate: config.fps,
      targetDisplayFps: 15,
    });

    // Enable memory monitoring in the pipeline
    pipeline.enableMemoryMonitoring();

    console.log('Starting camera pipeline...');
    await pipeline.start();

    console.log('Camera pipeline running. Starting data collection...');
    console.log('Press Ctrl+C to stop early, or wait for the full duration.');

    // Collect data for the specified duration
    const startTime = Date.now();
    const targetDuration = config.durationMinutes * 60 * 1000; // Convert to milliseconds

    // Periodic status updates
    const statusInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const elapsedMinutes = elapsed / 60000;
      const remainingMinutes = (targetDuration - elapsed) / 60000;

      const stats = pipeline.getStats();
      const memoryAnalysis = pipeline.getMemoryAnalysis();

      console.log(`[${elapsedMinutes.toFixed(1)}m / ${config.durationMinutes}m] ` +
                  `FPS: ${stats.captureFps.toFixed(1)} | ` +
                  `Heap: ${memoryAnalysis.heapLeak ? 'LEAKING' : 'OK'}`);
    }, 30000); // Status every 30 seconds

    // Wait for the full duration
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        clearInterval(statusInterval);
        resolve();
      }, targetDuration);

      // Allow early termination with Ctrl+C
      process.on('SIGINT', () => {
        console.log('\n\nEarly termination requested.');
        clearTimeout(timeout);
        clearInterval(statusInterval);
        resolve();
      });
    });

    // Stop the pipeline
    console.log('\nStopping camera pipeline...');
    await pipeline.stop();

    // Get collected data
    const memoryData = pipeline.disableMemoryMonitoring();
    const snapshots = memoryData.snapshots;

    console.log(`\nCollected ${snapshots.length} memory snapshots`);

    // Perform analysis
    console.log('Analyzing memory patterns...');
    const monotonicAnalysis = memoryMonitor.detectMonotonicGrowth();

    console.log('\n=== Analysis Results ===');
    console.log(`Heap Trend: ${monotonicAnalysis.heapGrowthTrend}`);
    console.log(`Growth Rate: ${(monotonicAnalysis.slopePerSecond / 1024).toFixed(2)} KB/s`);
    console.log(`Confidence: ${monotonicAnalysis.confidence}`);
    console.log(`\n${monotonicAnalysis.details}`);

    // Check for leaks
    if (monotonicAnalysis.hasMonotonicHeapGrowth) {
      console.log('\n⚠️ MONOTONIC HEAP GROWTH DETECTED!');
      console.log('This indicates a potential memory leak that should be investigated.');
    } else {
      console.log('\n✅ No monotonic heap growth detected');
    }

    // Generate reports
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseFilename = `memory-benchmark-${timestamp}`;

    // Export JSON data
    const jsonPath = path.join(config.exportDir, `${baseFilename}.json`);
    const jsonData = memoryMonitor.exportMetrics();
    fs.writeFileSync(jsonPath, jsonData);
    console.log(`\nExported JSON data to: ${jsonPath}`);

    // Generate text report
    const textReport = generateMemoryReport(
      snapshots,
      memoryMonitor.getSessionId(),
      {
        includeCharts: true,
        includeAnalysis: true,
      }
    );
    const textPath = path.join(config.exportDir, `${baseFilename}.txt`);
    fs.writeFileSync(textPath, textReport);
    console.log(`Exported text report to: ${textPath}`);

    // Generate HTML report if requested
    if (config.generateHtmlReport) {
      const vizData = memoryMonitor.getVisualizationData();
      const htmlReport = generateHtmlChart(
        vizData.labels,
        vizData.heapData,
        {
          title: 'Memory Usage - 10 Minute Session',
          width: 1200,
          height: 600,
          showHandleData: vizData.handleData !== undefined,
          handleData: vizData.handleData,
        }
      );
      const htmlPath = path.join(config.exportDir, `${baseFilename}.html`);
      fs.writeFileSync(htmlPath, htmlReport);
      console.log(`Exported HTML report to: ${htmlPath}`);
    }

    console.log('\n=== Benchmark Complete ===');
    console.log(`Session ID: ${memoryMonitor.getSessionId()}`);
    console.log(`Duration: ${((Date.now() - startTime) / 60000).toFixed(1)} minutes`);
    console.log(`Snapshots collected: ${snapshots.length}`);

  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

// Run the benchmark
runMemoryBenchmark().catch(console.error);

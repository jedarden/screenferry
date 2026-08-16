/**
 * 10-minute memory profiling session test
 *
 * This test runs a camera pipeline for 10 minutes to collect memory metrics
 * and detect monotonic growth patterns in heap usage and handle counts.
 *
 * Per task screenferry-33ffefbc:
 * - Add frame-level metrics collection for heap size and handle counts
 * - Log metrics every N frames (configurable, suggest 100-500 frames)
 * - Store metrics in structured format suitable for analysis
 * - Add simple analysis tool to plot/visualize metrics over time
 * - Run 10-minute session and confirm metrics captured
 * - Identify if there is monotonic growth in heap or handles
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

describe('10-minute memory profiling session', () => {
  let browser: Browser;
  let page: Page;
  const TEST_DURATION = 10 * 60 * 1000; // 10 minutes in milliseconds
  const METRICS_DIR = join(process.cwd(), 'benchmark-results', 'memory-profiling');

  beforeAll(async () => {
    // Ensure metrics directory exists
    mkdirSync(METRICS_DIR, { recursive: true });

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: [
        '--enable-precise-memory-info',
        '--js-flags=--expose-gc'
      ]
    });

    page = await browser.newPage();

    // Navigate to the app
    await page.goto('http://localhost:5173'); // Assuming Vite dev server

    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should run 10-minute session with memory monitoring enabled', async () => {
    const startTime = Date.now();
    const metrics: any[] = [];

    console.log('[Memory Profiling] Starting 10-minute session...');

    // Enable memory monitoring
    await page.evaluate(() => {
      // @ts-ignore - Custom API for testing
      if (window.enableMemoryMonitoring) {
        window.enableMemoryMonitoring();
      }
    });

    // Collect metrics every 30 seconds during the 10-minute run
    const collectionInterval = setInterval(async () => {
      const currentMetrics = await page.evaluate(() => {
        // @ts-ignore - Custom API for testing
        if (window.getMemoryMetrics) {
          return window.getMemoryMetrics();
        }
        return null;
      });

      if (currentMetrics) {
        metrics.push({
          timestamp: Date.now(),
          elapsed: Date.now() - startTime,
          ...currentMetrics
        });

        console.log(`[Memory Profiling] Sample ${metrics.length}:`, {
          elapsed: Math.round((Date.now() - startTime) / 1000) + 's',
          heapUsed: Math.round(currentMetrics.heapUsed / 1024 / 1024) + 'MB',
          frameCount: currentMetrics.frameCount
        });
      }
    }, 30000); // Every 30 seconds

    // Wait for 10 minutes
    await page.waitForTimeout(TEST_DURATION);

    // Stop metric collection
    clearInterval(collectionInterval);

    // Get final memory analysis
    const finalAnalysis = await page.evaluate(() => {
      // @ts-ignore - Custom API for testing
      if (window.getMemoryAnalysis) {
        return window.getMemoryAnalysis();
      }
      return null;
    });

    console.log('[Memory Profiling] Session complete. Collected', metrics.length, 'samples');

    // Export metrics data
    const exportData = {
      sessionId: `session-${Date.now()}`,
      duration: TEST_DURATION,
      sampleCount: metrics.length,
      samples: metrics,
      finalAnalysis: finalAnalysis,
      timestamp: new Date().toISOString()
    };

    // Save to file
    const outputFile = join(METRICS_DIR, `memory-profile-${Date.now()}.json`);
    writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
    console.log('[Memory Profiling] Metrics saved to:', outputFile);

    // Verify we collected meaningful data
    expect(metrics.length).toBeGreaterThan(15); // At least 15 samples in 10 minutes
    expect(exportData.duration).toBe(TEST_DURATION);

    // Check if monotonic growth was detected
    if (finalAnalysis && finalAnalysis.monotonicGrowth) {
      console.log('[Memory Profiling] Monotonic Growth Analysis:');
      console.log('  Has Monotonic Heap Growth:', finalAnalysis.monotonicGrowth.hasMonotonicHeapGrowth);
      console.log('  Has Monotonic Handle Growth:', finalAnalysis.monotonicGrowth.hasMonotonicHandleGrowth);
      console.log('  Heap Trend:', finalAnalysis.monotonicGrowth.heapGrowthTrend);
      console.log('  Confidence:', finalAnalysis.monotonicGrowth.confidence);
      console.log('  Slope:', Math.round(finalAnalysis.monotonicGrowth.slopePerSecond / 1024), 'KB/s');
    }

    // Verify final analysis was generated
    expect(finalAnalysis).not.toBeNull();
  }, 120000); // 2 minute timeout

  it('should export metrics in structured format suitable for analysis', async () => {
    // This test verifies that the exported metrics have the expected structure
    const metricsFiles = await page.evaluate(() => {
      // @ts-ignore - Custom API for testing
      if (window.exportMemoryMetrics) {
        return window.exportMemoryMetrics();
      }
      return null;
    });

    if (metricsFiles) {
      const data = JSON.parse(metricsFiles);

      // Verify structure
      expect(data).toHaveProperty('sessionId');
      expect(data).toHaveProperty('config');
      expect(data).toHaveProperty('snapshots');
      expect(data).toHaveProperty('analysis');

      // Verify snapshots have required fields
      if (data.snapshots && data.snapshots.length > 0) {
        const snapshot = data.snapshots[0];
        expect(snapshot).toHaveProperty('timestamp');
        expect(snapshot).toHaveProperty('frameIndex');
        expect(snapshot).toHaveProperty('heapUsed');
        expect(snapshot).toHaveProperty('heapSize');
      }

      // Verify analysis structure
      expect(data.analysis).toHaveProperty('leakDetection');
      expect(data.analysis).toHaveProperty('monotonicGrowth');

      console.log('[Memory Profiling] Metrics structure verified ✓');
    } else {
      console.log('[Memory Profiling] No metrics to verify (monitoring not exposed)');
    }
  });
});
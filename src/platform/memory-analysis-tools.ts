/**
 * Memory analysis and visualization tools
 *
 * Provides simple text-based and HTML-based visualization tools for memory metrics.
 * This helps identify memory leaks and monotonic growth patterns.
 *
 * Reference: bead screenferry-33ffefbc
 */

import type { MemorySnapshot } from './memory-monitor.js';

/**
 * ASCII-based visualization of memory growth over time
 */
export function generateAsciiChart(data: number[], width: number = 60, height: number = 15): string {
  if (data.length === 0) return 'No data available';

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const lines: string[] = [];
  const chartHeight = height;
  const chartWidth = Math.min(width, data.length);

  // Create chart row by row (top to bottom)
  for (let y = chartHeight; y >= 0; y--) {
    const value = min + (range * y) / chartHeight;
    const line: string[] = [];

    for (let x = 0; x < chartWidth; x++) {
      const dataIndex = Math.floor((x / chartWidth) * data.length);
      const dataValue = data[dataIndex] ?? 0;

      if (Math.abs(dataValue - value) < range / chartHeight) {
        line.push('•');
      } else if (dataValue > value) {
        line.push('|');
      } else {
        line.push(' ');
      }
    }

    lines.push(`${value.toFixed(2)} MB |${line.join('')}`);
  }

  return lines.join('\n');
}

/**
 * Generate HTML chart for memory visualization
 */
export function generateHtmlChart(
  labels: string[],
  heapData: number[],
  options?: {
    title?: string;
    width?: number;
    height?: number;
    showHandleData?: boolean;
    handleData?: number[];
  }
): string {
  const title = options?.title ?? 'Memory Usage Over Time';
  const width = options?.width ?? 800;
  const height = options?.height ?? 400;

  const maxValue = Math.max(...heapData);
  const minValue = Math.min(...heapData);
  const range = maxValue - minValue || 1;

  // Generate points for heap data
  const heapPoints = heapData.map((value, index) => {
    const x = (index / (heapData.length - 1)) * width;
    const y = height - ((value - minValue) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  // Generate points for handle data if available
  let handlePoints = '';
  if (options?.showHandleData && options.handleData) {
    const maxHandle = Math.max(...options.handleData);
    const minHandle = Math.min(...options.handleData);
    const handleRange = maxHandle - minHandle || 1;

    handlePoints = options.handleData.map((value, index) => {
      const x = (index / (options.handleData!.length - 1)) * width;
      const y = height - ((value - minHandle) / handleRange) * height;
      return `${x},${y}`;
    }).join(' ');
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    body {
      font-family: 'Courier New', monospace;
      background: #1a1a1a;
      color: #e0e0e0;
      margin: 20px;
    }
    .chart-container {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .title {
      font-size: 1.2em;
      font-weight: bold;
      margin-bottom: 15px;
      color: #4CAF50;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-box {
      background: #333;
      padding: 15px;
      border-radius: 4px;
      border-left: 3px solid #4CAF50;
    }
    .stat-label {
      font-size: 0.8em;
      color: #999;
      margin-bottom: 5px;
    }
    .stat-value {
      font-size: 1.1em;
      font-weight: bold;
      color: #fff;
    }
    .warning {
      border-left-color: #FF9800;
    }
    .error {
      border-left-color: #f44336;
    }
    svg {
      background: #1a1a1a;
      border-radius: 4px;
    }
    .legend {
      display: flex;
      gap: 20px;
      margin-top: 10px;
      font-size: 0.9em;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .legend-color {
      width: 20px;
      height: 3px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <div class="chart-container">
    <div class="title">${title}</div>

    <div class="stats">
      <div class="stat-box">
        <div class="stat-label">Duration</div>
        <div class="stat-value">${labels.length > 0 ? labels[labels.length - 1]! : '0s'}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Samples</div>
        <div class="stat-value">${heapData.length}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Min Heap</div>
        <div class="stat-value">${minValue.toFixed(2)} MB</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Max Heap</div>
        <div class="stat-value">${maxValue.toFixed(2)} MB</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Heap Growth</div>
        <div class="stat-value">${(heapData[heapData.length - 1]! - heapData[0]!).toFixed(2)} MB</div>
      </div>
    </div>

    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <!-- Grid lines -->
      ${Array.from({ length: 5 }, (_, i) => {
        const y = (i / 4) * height;
        return `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#333" stroke-width="1"/>`;
      }).join('\n      ')}

      <!-- Heap data line -->
      <polyline
        points="${heapPoints}"
        fill="none"
        stroke="#4CAF50"
        stroke-width="2"
        stroke-opacity="0.8"
      />

      ${handlePoints ? `
      <!-- Handle data line -->
      <polyline
        points="${handlePoints}"
        fill="none"
        stroke="#2196F3"
        stroke-width="2"
        stroke-opacity="0.8"
      />
      ` : ''}
    </svg>

    <div class="legend">
      <div class="legend-item">
        <div class="legend-color" style="background: #4CAF50;"></div>
        <span>Heap Usage (MB)</span>
      </div>
      ${handlePoints ? `
      <div class="legend-item">
        <div class="legend-color" style="background: #2196F3;"></div>
        <span>Handle Count</span>
      </div>
      ` : ''}
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Analyze memory snapshots for leak patterns
 */
export function analyzeMemorySnapshots(snapshots: MemorySnapshot[]): {
  hasLeak: boolean;
  leakSeverity: 'low' | 'medium' | 'high';
  analysis: string;
  recommendations: string[];
} {
  if (snapshots.length < 5) {
    return {
      hasLeak: false,
      leakSeverity: 'low',
      analysis: 'Insufficient data for leak analysis',
      recommendations: ['Collect more snapshots (at least 5) for reliable analysis'],
    };
  }

  const firstSnapshot = snapshots[0]!;
  const lastSnapshot = snapshots[snapshots.length - 1]!;

  // Calculate metrics
  const heapGrowth = lastSnapshot.heapUsed - firstSnapshot.heapUsed;
  const duration = (lastSnapshot.timestamp - firstSnapshot.timestamp) / 1000; // seconds
  const growthRate = heapGrowth / duration; // bytes per second

  // Determine leak severity
  let hasLeak = false;
  let leakSeverity: 'low' | 'medium' | 'high' = 'low';

  if (growthRate > 100_000) { // > 100KB/s
    hasLeak = true;
    leakSeverity = 'high';
  } else if (growthRate > 50_000) { // > 50KB/s
    hasLeak = true;
    leakSeverity = 'medium';
  } else if (growthRate > 10_000) { // > 10KB/s
    hasLeak = true;
    leakSeverity = 'low';
  }

  // Check array growth
  const arrayGrowth = {
    timestamps: lastSnapshot.frameTimestampsCount - firstSnapshot.frameTimestampsCount,
    latencies: lastSnapshot.decodeLatenciesCount - firstSnapshot.decodeLatenciesCount,
    packets: lastSnapshot.packetsPerFrameCount - firstSnapshot.packetsPerFrameCount,
  };

  const hasArrayLeak = Object.values(arrayGrowth).some(growth => growth > 1000);

  // Generate analysis
  const analysis = [
    `Duration: ${duration.toFixed(1)}s`,
    `Samples: ${snapshots.length}`,
    `Heap Growth: ${formatBytes(heapGrowth)} (${formatBytes(growthRate)}/s)`,
    `Array Growth:`,
    `  - Timestamps: +${arrayGrowth.timestamps}`,
    `  - Latencies: +${arrayGrowth.latencies}`,
    `  - Packets: +${arrayGrowth.packets}`,
  ].join('\n');

  // Generate recommendations
  const recommendations: string[] = [];

  if (hasLeak) {
    recommendations.push('⚠️ Memory leak detected - investigate heap growth pattern');
    if (leakSeverity === 'high') {
      recommendations.push('🔴 HIGH SEVERITY: Immediate investigation required');
    }
  }

  if (hasArrayLeak) {
    recommendations.push('⚠️ Array growth detected - check for unbounded array growth');
    recommendations.push('  - Consider using circular buffers or定期清理');
  }

  if (!hasLeak && !hasArrayLeak) {
    recommendations.push('✅ No obvious memory leaks detected');
    recommendations.push('  - Continue monitoring for longer sessions');
  }

  return {
    hasLeak: hasLeak || hasArrayLeak,
    leakSeverity,
    analysis,
    recommendations,
  };
}

/**
 * Format bytes as human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Generate comprehensive memory report
 */
export function generateMemoryReport(
  snapshots: MemorySnapshot[],
  sessionId: string,
  options?: {
    includeCharts?: boolean;
    includeAnalysis?: boolean;
  }
): string {
  const sections: string[] = [];

  // Header
  sections.push('# Memory Analysis Report');
  sections.push(`Session: ${sessionId}`);
  sections.push(`Generated: ${new Date().toISOString()}`);
  sections.push('');

  // Summary statistics
  if (snapshots.length > 0) {
    const heapValues = snapshots.map(s => s.heapUsed);
    const minHeap = Math.min(...heapValues);
    const maxHeap = Math.max(...heapValues);
    const avgHeap = heapValues.reduce((sum, val) => sum + val, 0) / heapValues.length;

    sections.push('## Summary Statistics');
    sections.push(`Samples Collected: ${snapshots.length}`);
    sections.push(`Duration: ${((snapshots[snapshots.length - 1]!.timestamp - snapshots[0]!.timestamp) / 1000).toFixed(1)}s`);
    sections.push(`Heap Usage: ${formatBytes(minHeap)} - ${formatBytes(maxHeap)} (avg: ${formatBytes(avgHeap)})`);
    sections.push('');
  }

  // Analysis
  if (options?.includeAnalysis !== false) {
    const analysis = analyzeMemorySnapshots(snapshots);
    sections.push('## Leak Analysis');
    sections.push(analysis.analysis);
    sections.push('');
    sections.push('## Recommendations');
    analysis.recommendations.forEach(rec => sections.push(rec));
    sections.push('');
  }

  // ASCII Chart
  if (options?.includeCharts !== false) {
    const heapDataMB = snapshots.map(s => s.heapUsed / (1024 * 1024));
    sections.push('## Heap Usage Over Time');
    sections.push('```');
    sections.push(generateAsciiChart(heapDataMB));
    sections.push('```');
  }

  return sections.join('\n');
}

# Memory Growth Detection

## Overview

Memory growth detection is a leak detection mechanism that analyzes memory samples collected during test execution to identify monotonic increasing patterns that may indicate memory leaks.

## Features

- **Linear Regression Analysis**: Uses least squares linear regression to detect monotonic growth trends
- **Configurable Thresholds**: Allows customization of growth rate and percentage thresholds
- **Goodness-of-Fit Filtering**: Uses R-squared values to filter out noisy data
- **Integration with Memory Sampling**: Seamlessly integrates with existing memory sampling infrastructure

## How It Works

The growth detection algorithm:

1. **Collects Samples**: Gathers memory samples at regular block intervals
2. **Linear Regression**: Performs linear regression on the samples to calculate:
   - **Slope**: Growth rate (bytes per block)
   - **R-squared**: Goodness of fit (how well data fits a linear model)
   - **Intercept**: Baseline memory usage
3. **Threshold Analysis**: Compares calculated metrics against configurable thresholds
4. **Leak Detection**: Flags potential leaks if:
   - Slope is positive (growth)
   - R-squared exceeds minimum (good linear fit)
   - Growth rate or percentage exceeds threshold

## Configuration

### Growth Thresholds

Thresholds are configured via `TestOptions.growthThresholds`:

```typescript
interface GrowthThresholdConfig {
  /** Maximum growth rate (bytes per block) - default: 1024 (1KB/block) */
  maxGrowthRate?: number;
  
  /** Maximum total growth as percentage of initial heap - default: 50% */
  maxGrowthPercent?: number;
  
  /** Minimum R-squared for monotonic trend - default: 0.7 */
  minRSquared?: number;
  
  /** Minimum samples required for analysis - default: 3 */
  minSamples?: number;
}
```

### Default Thresholds

```typescript
{
  maxGrowthRate: 1024,      // 1KB per block
  maxGrowthPercent: 50,     // 50% total growth
  minRSquared: 0.7,         // Good linear fit
  minSamples: 3,            // Minimum samples for analysis
}
```

## Usage Examples

### Basic Usage with MemorySamplingHelper

```typescript
import { createMemorySamplingHelper } from './test/helpers/memory-sampling-helpers.js';

// Create helper with custom thresholds
const helper = createMemorySamplingHelper({
  testOptions: {
    enableMemorySampling: true,
    growthThresholds: {
      maxGrowthRate: 2048,    // 2KB per block
      maxGrowthPercent: 25,   // 25% growth
      minRSquared: 0.8,       // Strict fit requirement
    },
  },
  sampleIntervalBlocks: 100,
});

// Collect samples during test execution
for (let blockIndex = 0; blockIndex < 1000; blockIndex++) {
  processBlock(blockIndex);
  helper.sample(blockIndex);
}

// Analyze for leaks
const result = helper.detectGrowth();

if (result.exceedsThreshold) {
  console.warn('Potential memory leak detected!');
  console.warn(`Growth rate: ${result.growthRate} bytes/block`);
  console.warn(`Total growth: ${result.totalGrowth / 1024 / 1024} MB`);
}
```

### Direct Analysis with detectMonotonicGrowth

```typescript
import {
  createMemorySampleStorage,
  captureMemorySample,
  detectMonotonicGrowth,
} from './src/platform/memory-samples.js';

const samples = createMemorySampleStorage();

// Collect samples
for (let i = 0; i < 100; i++) {
  processBlock(i);
  captureMemorySample(samples, i, { enableMemorySampling: true });
}

// Analyze with custom thresholds
const result = detectMonotonicGrowth(samples, {
  maxGrowthRate: 2048,
  maxGrowthPercent: 30,
});

console.log(result.message);
```

### Quick Check for Excessive Growth

```typescript
const helper = createMemorySamplingHelper({
  testOptions: { enableMemorySampling: true },
});

// ... collect samples ...

if (helper.hasExcessiveGrowth()) {
  console.error('Memory leak detected!');
}
```

## Growth Detection Result

The `GrowthDetectionResult` interface provides detailed analysis:

```typescript
interface GrowthDetectionResult {
  /** Whether monotonic growth was detected */
  hasMonotonicGrowth: boolean;
  
  /** Linear regression slope (bytes per block) */
  slope: number;
  
  /** Growth rate (bytes per block) */
  growthRate: number;
  
  /** Growth rate as percentage of initial heap */
  growthRatePercent: number;
  
  /** R-squared value (goodness of fit) */
  rSquared: number;
  
  /** Total heap growth from first to last sample */
  totalGrowth: number;
  
  /** Number of samples analyzed */
  sampleCount: number;
  
  /** Whether growth exceeds threshold */
  exceedsThreshold: boolean;
  
  /** Analysis message describing the findings */
  message: string;
}
```

## Interpreting Results

### Normal vs. Leaky Growth

**Normal Growth Characteristics:**
- Low slope (< 1024 bytes/block)
- Low total growth percentage (< 50%)
- Low R-squared (< 0.7) indicates noisy/non-linear data
- Growth followed by cleanup (non-monotonic)

**Leaky Growth Characteristics:**
- Consistently positive slope
- High R-squared (> 0.7) indicates strong linear trend
- Growth rate exceeds threshold
- Total growth percentage exceeds threshold
- No cleanup cycles

### Example Scenarios

#### 1. No Leak (Stable Memory)
```
Growth Rate: 50 bytes/block
R-squared: 0.12
Total Growth: 50KB
Status: No leak detected
```

#### 2. Moderate Growth (Acceptable)
```
Growth Rate: 800 bytes/block
R-squared: 0.85
Total Growth: 400KB (4%)
Status: Moderate growth, within threshold
```

#### 3. Memory Leak (Excessive)
```
Growth Rate: 2048 bytes/block
R-squared: 0.95
Total Growth: 10MB (100%)
Status: LEAK DETECTED - exceeds threshold
```

## Threshold Selection Guide

### Choosing maxGrowthRate

- **Tight (512 bytes/block)**: For strict leak detection, low-tolerance scenarios
- **Default (1024 bytes/block)**: Balanced detection for most applications
- **Loose (2048+ bytes/block)**: For applications with legitimate memory growth

### Choosing maxGrowthPercent

- **Conservative (25%)**: For long-running tests where memory should be stable
- **Default (50%)**: For moderate test durations
- **Liberal (100%+)**: For short tests or expected growth patterns

### Choosing minRSquared

- **Strict (0.8+)**: Only flag clear linear patterns, reduces false positives
- **Default (0.7)**: Good balance between sensitivity and specificity
- **Lenient (0.5)**: Detect more subtle patterns, may increase false positives

## Best Practices

1. **Always enable memory sampling** when investigating leaks
2. **Use appropriate sampling intervals** - too frequent adds overhead, too sparse misses patterns
3. **Tune thresholds** based on your application's normal memory behavior
4. **Check R-squared values** to avoid false positives from noisy data
5. **Verify with manual profiling** when leaks are detected
6. **Document legitimate growth patterns** to avoid confusion

## Performance Considerations

- **Sampling overhead**: Minimal when disabled (< 1ms per 10k calls)
- **Analysis overhead**: Linear regression is O(n) where n = sample count
- **Memory overhead**: Each sample is ~24 bytes, 1000 samples ≈ 24KB

## Troubleshooting

### False Positives

If you see false positives:

1. **Increase minRSquared** to require stronger linear fit (e.g., 0.8 or 0.9)
2. **Increase maxGrowthRate** to allow more growth per block
3. **Increase maxGrowthPercent** to allow more total growth
4. **Check for legitimate growth**: Application state, caches, buffers

### False Negatives

If you're missing leaks:

1. **Decrease minRSquared** to detect weaker patterns (e.g., 0.5)
2. **Decrease maxGrowthRate** to flag slower leaks
3. **Decrease maxGrowthPercent** to flag smaller total growth
4. **Increase sampling frequency** to capture more data points

### Insufficient Samples

If you see "Insufficient samples" errors:

1. **Decrease minSamples** threshold (default: 3)
2. **Increase test duration** to collect more samples
3. **Decrease sampling interval** to sample more frequently

## Implementation Reference

- **Bead**: bf-e3vfs
- **Source**: `src/platform/memory-samples.ts`
- **Tests**: `test/memory-growth-detection.test.ts`
- **Integration**: `test/helpers/memory-sampling-helpers.ts`

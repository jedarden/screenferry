# Testing Documentation

This document covers test configuration, utilities, and best practices for the screenferry project.

## Memory Sampling Toggle

Memory sampling is an opt-in feature for tracking heap usage and memory growth during test execution. It helps identify memory leaks, profile heap usage, and debug memory-related test failures.

### Overview

Memory sampling captures heap usage at specific points during test execution (typically at block intervals). The feature is disabled by default to avoid performance overhead during normal test runs.

### Configuration: `enableMemorySampling`

The `enableMemorySampling` flag controls whether memory samples are collected during tests. It's part of the `TestOptions` interface:

```typescript
interface TestOptions {
  /** Enable memory sampling during tests (default: false) */
  enableMemorySampling?: boolean;
}
```

**Default behavior:** `false` — memory sampling is disabled by default.

### When to Use Memory Sampling

Enable memory sampling when:
- Investigating memory leaks or unexplained memory growth
- Profiling heap usage during encode/decode cycles
- Debugging memory-related test failures
- Performing performance analysis and optimization
- Analyzing heap patterns over long test runs

### Performance Impact

Memory sampling adds **minimal overhead** when disabled (default). When enabled, the overhead includes:
- Periodic calls to `process.memoryUsage().heapUsed`
- Sample storage in memory arrays
- Timestamp recording for each sample

**Impact:** Approximately 0.1-0.5ms per sample operation. For most tests, this is negligible, but it can accumulate in tight loops or performance-critical tests.

### Usage Examples

#### 1. Basic Usage in Tests

```typescript
import { createTestOptions, isMemorySamplingEnabled } from '../src/test-options.js';
import { captureMemorySample, createMemorySampleStorage } from '../src/platform/memory-samples.js';

describe('My memory test', () => {
  it('should track heap growth during encoding', () => {
    // Create storage and enable sampling
    const samples = createMemorySampleStorage();
    const options = createTestOptions({ enableMemorySampling: true });

    // Run your test logic and capture samples
    for (let block = 0; block < 100; block++) {
      processBlock(block);
      captureMemorySample(samples, block, options);
    }

    // Analyze results
    expect(samples).toHaveLength(100);
    const firstSample = samples[0];
    const lastSample = samples[samples.length - 1];
    const heapGrowth = lastSample.heapUsage - firstSample.heapUsage;
    
    console.log(`Heap growth: ${heapGrowth} bytes over 100 blocks`);
  });
});
```

#### 2. Using Helper Functions

```typescript
import { isMemorySamplingEnabled, createTestOptions } from '../src/test-options.js';

const options = createTestOptions({ enableMemorySampling: true });

if (isMemorySamplingEnabled(options)) {
  console.log('Memory sampling is active');
} else {
  console.log('Memory sampling is disabled');
}
```

#### 3. Default Behavior (Sampling Disabled)

```typescript
import { createTestOptions, captureMemorySample, createMemorySampleStorage } from '../src/test-options.js';

const samples = createMemorySampleStorage();
const defaultOptions = createTestOptions(); // No arguments = defaults

// This returns false because sampling is disabled by default
const captured = captureMemorySample(samples, 0, defaultOptions);
console.log(captured); // false - sample not captured
console.log(samples); // [] - empty array
```

#### 4. Conditional Test Logic Based on Sampling

```typescript
import { createTestOptions, isMemorySamplingEnabled } from '../src/test-options.js';

const options = createTestOptions({ enableMemorySampling: true });
const samples = createMemorySampleStorage();

describe('Memory-sensitive operations', () => {
  beforeEach(() => {
    if (isMemorySamplingEnabled(options)) {
      console.log('Memory profiling enabled for this test suite');
    }
  });

  it('should maintain bounded heap usage', () => {
    const initialSample = captureMemorySample(samples, 0, options);
    
    // ... perform operations ...
    
    const finalSample = captureMemorySample(samples, 100, options);
    
    if (initialSample && finalSample) {
      const heapGrowth = finalSample.heapUsage - initialSample.heapUsage;
      expect(heapGrowth).toBeLessThan(10_000_000); // Less than 10MB growth
    }
  });
});
```

### Memory Sample Structure

Each captured sample contains:

```typescript
interface MemorySample {
  blockNumber: number;   // Block number when sample was collected
  timestamp: number;      // Milliseconds since epoch
  heapUsage: number;      // Heap usage in bytes
}
```

### API Reference

#### Functions

- **`createTestOptions(options?: Partial<TestOptions>): TestOptions`**  
  Creates test options with defaults applied.

- **`isMemorySamplingEnabled(options?: TestOptions): boolean`**  
  Checks if memory sampling is enabled in test options.

- **`captureMemorySample(storage, blockNumber, testOptions?): boolean`**  
  Captures a memory sample with graceful error handling. Returns `true` if successful.

- **`createMemorySampleStorage(): MemorySampleStorage`**  
  Creates empty storage for memory samples.

- **`createMemorySample(blockNumber, heapUsage?): MemorySample`**  
  Creates a new memory sample (automatically captures current heap usage if not provided).

### Best Practices

1. **Keep sampling disabled by default** — Only enable for specific test suites or debug runs
2. **Use targeted sampling** — Sample at meaningful points (e.g., after major operations) rather than every iteration
3. **Clean up storage** — Memory sample arrays grow with your test; clear them between tests to avoid accumulation
4. **Check before assuming** — Always use `isMemorySamplingEnabled()` or check the return value of `captureMemorySample()`

### Environment Variables

Currently, memory sampling is controlled programmatically through `TestOptions`. Future versions may support environment variable configuration for global enablement.

### Related Documentation

- `docs/plan/plan.md` — Complete application plan and test strategy
- `src/test-options.ts` — TestOptions interface and helper functions
- `src/platform/memory-samples.ts` — Memory sample data structures and storage utilities

### References

- **Bead bf-4p61e** — TestOptions type and enableMemorySampling flag
- **Bead bf-3r7gi** — Memory sample data structure and storage

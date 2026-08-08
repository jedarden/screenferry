/**
 * Example usage of test configuration system.
 *
 * Demonstrates how to use the common test configuration
 * in integration tests and access the sampling interval parameter.
 *
 * Reference: bead bf-20d0h
 */

import {
  getSamplingInterval,
  createSamplingConfig,
  validateTestConfig,
  type BaseTestConfig,
  type SamplingConfig,
} from './test-config.js';

/**
 * Example 1: Using sampling interval in a block processing loop.
 */
function exampleBlockProcessing(config: BaseTestConfig = {}) {
  // Validate configuration before use
  validateTestConfig(config);

  // Get sampling interval (with default)
  const interval = getSamplingInterval(config);

  console.log(`Processing blocks with sampling interval: ${interval}`);

  // Simulate block processing
  for (let blockIndex = 0; blockIndex < 1000; blockIndex++) {
    // Process block...

    // Sample at configured interval
    if (blockIndex % interval === 0) {
      console.log(`Sample at block ${blockIndex}`);
      // captureSample(blockIndex);
    }
  }
}

/**
 * Example 2: Creating a sampling config for memory profiler.
 */
function exampleMemoryProfiling(config: BaseTestConfig = {}) {
  // Create sampling configuration
  const samplingConfig: SamplingConfig = createSamplingConfig(config);

  console.log('Memory profiling config:', samplingConfig);
  // { interval: 100, enabled: true }

  // Use with memory profiler
  if (samplingConfig.enabled) {
    console.log(`Sampling every ${samplingConfig.interval} blocks`);
  }
}

/**
 * Example 3: Integration with test execution.
 */
class ExampleTestRunner {
  private config: BaseTestConfig;
  private samplingConfig: SamplingConfig;

  constructor(config: BaseTestConfig = {}) {
    // Validate and store configuration
    validateTestConfig(config);
    this.config = config;
    this.samplingConfig = createSamplingConfig(config);
  }

  runTest() {
    console.log('Running test with config:', this.config);
    console.log('Sampling interval:', this.samplingConfig.interval);

    // Access sampling interval in test execution
    const interval = this.samplingConfig.interval;

    // Use interval in test logic
    for (let i = 0; i < 10; i++) {
      if (i % interval === 0) {
        this.takeSample(i);
      }
    }
  }

  private takeSample(index: number) {
    console.log(`Taking sample at index ${index}`);
  }
}

/**
 * Example usage demonstrations.
 */
export function demonstrateUsage() {
  console.log('\n=== Example 1: Default configuration ===');
  exampleBlockProcessing();

  console.log('\n=== Example 2: Custom sampling interval ===');
  exampleBlockProcessing({ samplingInterval: 50 });

  console.log('\n=== Example 3: Memory profiling config ===');
  exampleMemoryProfiling({ samplingInterval: 200 });

  console.log('\n=== Example 4: Test runner ===');
  const runner = new ExampleTestRunner({ samplingInterval: 100 });
  runner.runTest();
}

// Run demonstrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateUsage();
}

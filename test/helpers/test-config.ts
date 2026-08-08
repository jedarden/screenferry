/**
 * Common test configuration system.
 *
 * Provides shared configuration interfaces and utilities for tests,
 * including memory sampling parameters with validation.
 *
 * ## Memory Sampling Configuration
 *
 * Memory sampling is **disabled by default** in all integration tests to avoid
 * overhead unless explicitly needed. To enable memory sampling:
 *
 * ### In encode-integration.test.ts:
 * ```ts
 * it('should sample memory during block encoding', () => {
 *   const config: EncodeTestConfig = {
 *     pipelineConfig: { streamId: 200, dwellPackets: 2 },
 *     memorySampling: {
 *       enabled: true,              // Enable sampling
 *       sampleIntervalBlocks: 5,   // Sample every 5 blocks
 *     },
 *   };
 *
 *   const samples = config.memorySampling?.enabled
 *     ? createMemorySampleStorage()
 *     : null;
 *
 *   // ... test code ...
 *
 *   if (samples && (blockIndex === 0 || blockIndex % sampleInterval === 0)) {
 *     captureMemorySample(samples, blockIndex);
 *   }
 * });
 * ```
 *
 * ### In roundtrip-integration.test.ts:
 * ```ts
 * const result = await roundtripTest(testData, streamId, packetsPerBlock, {
 *   memorySampling: {
 *     enabled: true,              // Enable sampling
 *     sampleIntervalBlocks: 100,   // Sample every 100 blocks
 *   },
 * });
 * ```
 *
 * ### Sampling Configuration Options:
 * - `enabled`: Set to `true` to enable memory sampling (default: `false`)
 * - `sampleIntervalBlocks`: Sample every N blocks (default: 100 in roundtrip, 5 in encode)
 *
 * ### When to Enable Memory Sampling:
 * - Investigating memory leaks or growth issues
 * - Profiling heap usage during encode/decode cycles
 * - Debugging memory-related test failures
 * - Performance analysis and optimization
 *
 * Reference: bead bf-20d0h, bf-485in
 */

/**
 * Base test configuration with common parameters.
 */
export interface BaseTestConfig {
  /** Sampling interval for periodic operations (default: 100) */
  samplingInterval?: number;
}

/**
 * Sampling configuration with validation.
 */
export interface SamplingConfig {
  /** Sample every N blocks (must be positive integer, default: 100) */
  interval: number;
  /**
   * Enable/disable sampling (default: false)
   *
   * When set to false, sampling operations are skipped to avoid overhead.
   * Set to true when investigating memory leaks or profiling heap usage.
   */
  enabled: boolean;
}

/**
 * Validate sampling interval parameter.
 *
 * @param interval - The interval value to validate
 * @returns true if valid, throws error if invalid
 * @throws Error if interval is not a positive integer
 *
 * @example
 * ```ts
 * validateSamplingInterval(100); // OK
 * validateSamplingInterval(0);   // throws Error
 * validateSamplingInterval(-1);  // throws Error
 * validateSamplingInterval(1.5); // throws Error
 * ```
 */
export function validateSamplingInterval(interval: number): boolean {
  // Check if interval is a number
  if (typeof interval !== 'number' || isNaN(interval)) {
    throw new Error(
      `Sampling interval must be a number, got ${typeof interval}`
    );
  }

  // Check if interval is positive
  if (interval <= 0) {
    throw new Error(
      `Sampling interval must be a positive integer, got ${interval}`
    );
  }

  // Check if interval is an integer
  if (!Number.isInteger(interval)) {
    throw new Error(
      `Sampling interval must be an integer, got ${interval}`
    );
  }

  return true;
}

/**
 * Get sampling interval with default value.
 *
 * @param config - Test configuration object
 * @param defaultInterval - Default interval value (default: 100)
 * @returns Validated sampling interval
 *
 * @example
 * ```ts
 * getSamplingInterval({});                       // returns 100
 * getSamplingInterval({ samplingInterval: 50 }); // returns 50
 * ```
 */
export function getSamplingInterval(
  config: BaseTestConfig = {},
  defaultInterval: number = 100
): number {
  const interval = config.samplingInterval ?? defaultInterval;
  validateSamplingInterval(interval);
  return interval;
}

/**
 * Create a sampling configuration from base test config.
 *
 * @param config - Base test configuration
 * @param defaultInterval - Default interval value (default: 100)
 * @returns Sampling configuration object
 *
 * @example
 * ```ts
 * const samplingConfig = createSamplingConfig({ samplingInterval: 200 });
 * // { interval: 200, enabled: false }
 * ```
 */
export function createSamplingConfig(
  config: BaseTestConfig = {},
  defaultInterval: number = 100
): SamplingConfig {
  const interval = getSamplingInterval(config, defaultInterval);

  return {
    interval,
    enabled: false,
  };
}

/**
 * Validate a complete test configuration.
 *
 * @param config - Test configuration to validate
 * @throws Error if configuration is invalid
 *
 * @example
 * ```ts
 * validateTestConfig({ samplingInterval: 100 }); // OK
 * validateTestConfig({ samplingInterval: -1 });  // throws Error
 * ```
 */
export function validateTestConfig(config: BaseTestConfig): void {
  if (config.samplingInterval !== undefined) {
    validateSamplingInterval(config.samplingInterval);
  }
}

/**
 * Default sampling interval constant.
 */
export const DEFAULT_SAMPLING_INTERVAL = 100;

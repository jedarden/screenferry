/**
 * Common test configuration system.
 *
 * Provides shared configuration interfaces and utilities for tests,
 * including sampling parameters with validation.
 *
 * Reference: bead bf-20d0h
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
  /** Enable/disable sampling (default: true) */
  enabled?: boolean;
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
 * // { interval: 200, enabled: true }
 * ```
 */
export function createSamplingConfig(
  config: BaseTestConfig = {},
  defaultInterval: number = 100
): SamplingConfig {
  const interval = getSamplingInterval(config, defaultInterval);

  return {
    interval,
    enabled: true,
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

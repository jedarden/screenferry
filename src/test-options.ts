/**
 * Test options configuration.
 *
 * Provides shared test configuration options for controlling test behavior,
 * including memory sampling and other test-specific features.
 *
 * Reference: bead bf-4p61e
 */

/**
 * Test options interface for configuring test behavior.
 */
export interface TestOptions {
  /**
   * Enable memory sampling during tests (default: false)
   *
   * When set to true, memory sampling operations are enabled to track
   * heap usage and memory growth during test execution. When false,
   * sampling is skipped to avoid overhead.
   *
   * Use memory sampling when:
   * - Investigating memory leaks or growth issues
   * - Profiling heap usage during encode/decode cycles
   * - Debugging memory-related test failures
   * - Performing performance analysis and optimization
   */
  enableMemorySampling?: boolean;
}

/**
 * Default test options with sampling disabled.
 */
export const DEFAULT_TEST_OPTIONS: TestOptions = {
  enableMemorySampling: false,
};

/**
 * Create test options with defaults applied.
 *
 * @param options - Partial test options to override defaults
 * @returns Complete test options object
 *
 * @example
 * ```ts
 * const options = createTestOptions({ enableMemorySampling: true });
 * // { enableMemorySampling: true }
 *
 * const defaultOptions = createTestOptions({});
 * // { enableMemorySampling: false }
 * ```
 */
export function createTestOptions(
  options: Partial<TestOptions> = {}
): TestOptions {
  return {
    enableMemorySampling: options.enableMemorySampling ?? false,
  };
}

/**
 * Check if memory sampling is enabled in test options.
 *
 * @param options - Test options object
 * @returns true if memory sampling is enabled, false otherwise
 *
 * @example
 * ```ts
 * isMemorySamplingEnabled({ enableMemorySampling: true });  // true
 * isMemorySamplingEnabled({});                               // false
 * isMemorySamplingEnabled({ enableMemorySampling: false }); // false
 * ```
 */
export function isMemorySamplingEnabled(
  options: TestOptions = {}
): boolean {
  return options.enableMemorySampling ?? false;
}

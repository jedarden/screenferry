/**
 * Sender-side validation utilities.
 *
 * This module provides validation functions that should be called during sender
 * initialization to detect invalid configuration states before any work begins.
 *
 * Reference: docs/notes/bf-4pc5-sender-compression-resume-detection.md
 */

/**
 * Error thrown when compression and resume are both enabled.
 *
 * This is an architecturally invalid state because:
 * - CompressionStream offers no determinism guarantee across browser restarts
 * - Re-compression after staging reaping (E11) may produce different bytes
 * - Different bytes → different block boundaries → different hashes
 * - Receiver's persisted bitmap would become silently invalid
 *
 * Solution: Disable resume when compression is enabled (set ResumeDisabled flag)
 */
export class CompressionResumeConflictError extends Error {
  constructor() {
    super(
      'Compression and resume cannot both be enabled. ' +
      'When compression is enabled, resume is NOT supported because ' +
      'CompressionStream offers no determinism guarantee across browser restarts. ' +
      'This would silently corrupt the receiver\'s persisted state.'
    );
    this.name = 'CompressionResumeConflictError';
  }
}

/**
 * Validate sender configuration before starting a session.
 *
 * This function implements fail-fast detection of invalid states that would
 * corrupt receiver state or produce undefined behavior. Call this during
 * sender initialization, before any staging files are created or read.
 *
 * **Critical checks:**
 * - Compression and resume are mutually exclusive (bf-4pc5)
 *
 * @param config - Sender configuration to validate
 * @throws {CompressionResumeConflictError} If both compression and resume are enabled
 * @throws {TypeError} If configuration parameters are invalid
 */
export function validateSenderConfig(config: SenderConfig): void {
  // Check 1: Compression and resume are mutually exclusive
  if (config.compressionEnabled && config.resumeEnabled) {
    throw new CompressionResumeConflictError();
  }

  // Future validation checks can be added here
  // Examples:
  // - Validate K doesn't exceed receiver's benchmarked K_max
  // - Validate block size is within acceptable range
  // - Validate file size doesn't exceed storage quota
}

/**
 * Sender configuration interface.
 *
 * This represents the configurable parameters for a sender session.
 * Additional fields can be added as the sender implementation evolves.
 */
export interface SenderConfig {
  /**
   * Whether compression is enabled (D8).
   *
   * When true, the sender compresses the file to a staging file before blocking.
   * This disables resume (resumeEnabled must be false).
   */
  compressionEnabled: boolean;

  /**
   * Whether resume mode is enabled (D22).
   *
   * When true, the sender supports resuming interrupted transfers.
   * This requires compression to be disabled (compressionEnabled must be false).
   */
  resumeEnabled: boolean;

  // Additional configuration fields can be added here as needed:
  // K?: number;           // LT code parameter
  // blockSize?: number;   // Block size in bytes
  // fragmentLen?: number; // Fragment length L
}

/**
 * Check if a sender configuration is valid without throwing.
 *
 * This is a non-throwing version of validateSenderConfig() for use cases
 * where you need to check validity without exception handling overhead.
 *
 * @param config - Sender configuration to validate
 * @returns true if configuration is valid, false otherwise
 */
export function isValidSenderConfig(config: SenderConfig): boolean {
  try {
    validateSenderConfig(config);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get an error message for invalid configuration.
 *
 * Returns a user-friendly error message explaining why the configuration
 * is invalid. Returns null if the configuration is valid.
 *
 * @param config - Sender configuration to check
 * @returns Error message string, or null if configuration is valid
 */
export function getValidationError(config: SenderConfig): string | null {
  try {
    validateSenderConfig(config);
    return null;
  } catch (e) {
    if (e instanceof Error) {
      return e.message;
    }
    return 'Unknown validation error';
  }
}

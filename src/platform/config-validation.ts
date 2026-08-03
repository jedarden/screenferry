/**
 * Configuration validation module.
 *
 * Validates sender configuration options before initialization.
 * Ensures invalid or incompatible configuration combinations are rejected early.
 *
 * Reference: docs/notes/bf-17s0-resume-compression-conflict.md
 */

import { ConfigurationError } from '../core/errors/error-codes.js';

/**
 * Sender configuration options.
 */
export interface SenderConfig {
  /** Compression enabled (D8) */
  compressionEnabled: boolean;
  /** Resume enabled (D22) */
  resumeEnabled: boolean;
}

/**
 * Validate sender configuration.
 *
 * Checks for incompatible configuration combinations that would violate
 * protocol constraints or safety requirements.
 *
 * **Critical validation:** compression and resume cannot both be enabled.
 * CompressionStream offers no determinism guarantee across browser restarts,
 * making resume unsafe. If a sender crashes and staging is reaped (E11),
 * re-compression may produce different bytes → different block boundaries →
 * different hashes → receiver's persisted bitmap becomes silently invalid.
 *
 * @param config - Sender configuration to validate
 * @throws {ConfigurationError} If configuration is invalid
 */
export function validateSenderConfig(config: SenderConfig): void {
  // CRITICAL: compression and resume cannot both be enabled
  //
  // Why this check is critical:
  // - CompressionStream provides NO determinism guarantee across browser restarts
  // - After sender crash and staging reaping (E11, T4 privacy), re-compression
  //   may produce different compressed bytes for the same input
  // - Different bytes → different block boundaries → different block hashes
  // - Receiver's persisted bitmap (from resume token) becomes INVALID
  // - silent corruption: transfer completes successfully but file is corrupt
  // - No detection until final verification, by which time user has wrong data
  //
  // The fix (bf-vgtq): Forbid resume when compression is enabled.
  // Sender signals "no resume available" via beacon ResumeDisabled flag.
  // Receiver suppresses resume UI and does NOT persist bitmap/metadata.
  //
  // See: docs/notes/bf-17s0-resume-compression-conflict.md
  //      docs/notes/bf-3k90-compression-resume-solution-evaluation.md (Option B)
  //
  if (config.compressionEnabled && config.resumeEnabled) {
    throw new ConfigurationError('E-COMPRESSION-RESUME-CONFLICT');
  }
}

/**
 * Check if sender configuration is valid (non-throwing version).
 *
 * @param config - Sender configuration to check
 * @returns true if valid, false otherwise
 */
export function isSenderConfigValid(config: SenderConfig): boolean {
  try {
    validateSenderConfig(config);
    return true;
  } catch {
    return false;
  }
}

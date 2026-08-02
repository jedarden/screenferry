/**
 * Error codes and livelock detection for screenferry.
 *
 * Provides structured error handling with:
 * - Stable error codes and user-facing messages
 * - Error metadata for categorization and UI handling
 * - Livelock detection for E12 retry loops
 *
 * Reference: plan.md §11, E12, bf-5fm
 */

/**
 * Severity levels for error codes
 */
export enum ErrorSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  FATAL = 'FATAL',
}

/**
 * User-facing error messages for all error codes
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // Optical/Acquisition
  'E-NO-SIGNAL': 'Point the camera at the sending screen.',
  'E-TOO-FAR': 'Move closer — the code is too small to read.',
  'E-TOO-CLOSE': 'Move back a little.',
  'E-BLUR': 'Hold steady.',
  'E-DARK': 'Too dark — raise the sender\'s screen brightness.',
  'E-GLARE': 'Tilt to avoid the reflection.',
  'E-FOCUS-HUNT': 'Tap the screen to lock focus.',
  'E-ORIENTATION': 'This app works fine held normally — but if you\'d like more margin, match the orientation setting on the sending device, or turn the phone sideways.',
  'E-SENDER-STALLED': 'The sending device seems paused.',
  'E-TORN': 'Lower the sender\'s frame rate.',

  // Protocol
  'E-FOREIGN-STREAM': 'That\'s a different file — ignoring it.',
  'E-VERSION': 'The sending device is running version X; this one is Y. Update both.',
  'E-META-BOUNDS': 'That transmission looks malformed and was rejected.',
  'E-K-OVERFLOW': 'Sender\'s chunk size (K={beaconK}) exceeds this device\'s maximum supported complexity (K_max={localKMax}). The sender must use a smaller file or reduce K.',
  'E-REPAIR-BOUNDS': 'That repair code refers to chunks that don\'t exist. Check it and try again.',
  'E-REPAIR-CODE': 'That repair code doesn\'t look right — check it and try again.',
  'E-FILE-HASH': 'The file is complete but failed its final check — saved as unverified.',
  'E-WASM-LOAD': 'The scanner failed to start. Reload the page.',

  // Manifest (bf-5fm)
  'E-MANIFEST-CORRUPT': 'The block manifest is corrupted and is being re-decoded.',
  'E-MANIFEST-MISSING': 'Waiting for block manifest to verify received chunks.',
  'E-MANIFEST-DECODE': 'Could not decode the block manifest. Retrying...',
  'E-MANIFEST-LIVELOCK': 'Multiple chunks failed verification — the manifest appears corrupted. Re-decoding manifest...',

  // Block verification (E12, bf-5fm)
  'E-BLOCK-HASH': 'A chunk arrived corrupted and is being re-collected.',
  'E-BLOCK-RETRY-EXCEEDED': 'A chunk has failed verification too many times. Re-decoding manifest...',

  // Status
  'E-VERIFYING': 'Verifying received chunks against manifest...',

  // Local/Resource
  'E-QUOTA-PREFLIGHT': 'Not enough free space: this needs X, you have Y.',
  'E-QUOTA-EXHAUSTED': 'Out of space. Saved what arrived — X of Y chunks.',
  'E-SOURCE-CHANGED': 'The file changed while sending. Start again to avoid a corrupt copy.',
  'E-BACKGROUNDED': 'Sending paused — keep this tab visible.',
  'E-CAMERA-LOST': 'Camera access ended. Your progress is saved.',
  'E-WAKELOCK-LOST': 'The screen may turn off. Adjust your sleep settings.',
  'E-DECOMPRESS': 'Everything arrived but couldn\'t be unpacked. The raw data was kept.',
};

/**
 * Metadata for error codes
 */
export const ERROR_METADATA: Record<string, {
  category: string;
  recoverable: boolean;
  severity: ErrorSeverity;
}> = {
  // Optical/Acquisition
  'E-NO-SIGNAL': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-TOO-FAR': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-TOO-CLOSE': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-BLUR': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-DARK': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-GLARE': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-FOCUS-HUNT': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-ORIENTATION': { category: 'optical', recoverable: true, severity: ErrorSeverity.INFO },
  'E-SENDER-STALLED': { category: 'optical', recoverable: true, severity: ErrorSeverity.WARNING },
  'E-TORN': { category: 'optical', recoverable: true, severity: ErrorSeverity.ERROR },

  // Protocol
  'E-FOREIGN-STREAM': { category: 'protocol', recoverable: true, severity: ErrorSeverity.INFO },
  'E-VERSION': { category: 'protocol', recoverable: false, severity: ErrorSeverity.FATAL },
  'E-META-BOUNDS': { category: 'protocol', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-K-OVERFLOW': { category: 'protocol', recoverable: false, severity: ErrorSeverity.FATAL },
  'E-REPAIR-BOUNDS': { category: 'protocol', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-REPAIR-CODE': { category: 'protocol', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-FILE-HASH': { category: 'protocol', recoverable: false, severity: ErrorSeverity.ERROR },
  'E-WASM-LOAD': { category: 'protocol', recoverable: true, severity: ErrorSeverity.FATAL },

  // Manifest
  'E-MANIFEST-CORRUPT': { category: 'manifest', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-MANIFEST-MISSING': { category: 'manifest', recoverable: true, severity: ErrorSeverity.INFO },
  'E-MANIFEST-DECODE': { category: 'manifest', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-MANIFEST-LIVELOCK': { category: 'manifest', recoverable: true, severity: ErrorSeverity.ERROR },

  // Block verification
  'E-BLOCK-HASH': { category: 'block', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-BLOCK-RETRY-EXCEEDED': { category: 'block', recoverable: true, severity: ErrorSeverity.ERROR },

  // Status
  'E-VERIFYING': { category: 'status', recoverable: true, severity: ErrorSeverity.INFO },

  // Local/Resource
  'E-QUOTA-PREFLIGHT': { category: 'resource', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-QUOTA-EXHAUSTED': { category: 'resource', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-SOURCE-CHANGED': { category: 'resource', recoverable: false, severity: ErrorSeverity.FATAL },
  'E-BACKGROUNDED': { category: 'resource', recoverable: true, severity: ErrorSeverity.WARNING },
  'E-CAMERA-LOST': { category: 'resource', recoverable: true, severity: ErrorSeverity.ERROR },
  'E-WAKELOCK-LOST': { category: 'resource', recoverable: true, severity: ErrorSeverity.WARNING },
  'E-DECOMPRESS': { category: 'resource', recoverable: true, severity: ErrorSeverity.ERROR },
};

/**
 * Livelock detector configuration
 */
export interface LivelockConfig {
  /** Maximum retries allowed per single block before livelock is declared */
  MAX_RETRIES_PER_BLOCK: number;
  /** Maximum total failures across all blocks within the failure window */
  MAX_TOTAL_FAILURES: number;
  /** Time window for failure counting in milliseconds */
  FAILURE_WINDOW: number;
}

/**
 * Default livelock detector configuration
 */
export const DEFAULT_LIVELOCK_CONFIG: LivelockConfig = {
  MAX_RETRIES_PER_BLOCK: 3,
  MAX_TOTAL_FAILURES: 100,
  FAILURE_WINDOW: 60000, // 60 seconds
};

/**
 * Livelock detector interface for E12 retry loop prevention
 */
export interface LivelockDetector {
  /**
   * Record a retry for a specific block
   * @param blockIndex - The block index that is being retried
   * @returns true if livelock was detected, false otherwise
   */
  recordRetry(blockIndex: number): boolean;

  /**
   * Get the number of retries for a specific block
   * @param blockIndex - The block index to query
   * @returns The number of retries recorded for this block
   */
  getRetryCount(blockIndex: number): number;

  /**
   * Check if a block has exceeded its retry limit
   * @param blockIndex - The block index to check
   * @returns true if the block has exceeded its limit
   */
  hasExceededLimit(blockIndex: number): boolean;

  /**
   * Reset retry tracking for a specific block after successful operation
   * @param blockIndex - The block index to reset
   */
  resetBlock(blockIndex: number): void;

  /**
   * Reset all tracking (e.g., after manifest re-decode)
   */
  reset(): void;
}

/**
 * Failure record for time-based tracking
 */
interface FailureRecord {
  blockIndex: number;
  timestamp: number;
}

/**
 * In-memory implementation of livelock detector
 *
 * Detects E12 retry loops by tracking:
 * 1. Per-block retry counts with configurable limit
 * 2. Total failures across all blocks within a time window
 * 3. Automatic cleanup of old failure records
 *
 * Reference: plan.md E12, bf-5fm
 */
export class InMemoryLivelockDetector implements LivelockDetector {
  private perBlockRetries: Map<number, number> = new Map();
  private failures: FailureRecord[] = [];
  private config: LivelockConfig;

  constructor(config: Partial<LivelockConfig> = {}) {
    this.config = { ...DEFAULT_LIVELOCK_CONFIG, ...config };
  }

  /**
   * Record a retry for a specific block
   * @param blockIndex - The block index that is being retried
   * @returns true if livelock was detected, false otherwise
   */
  recordRetry(blockIndex: number): boolean {
    const now = Date.now();

    // Clean up old failures outside the window
    this.failures = this.failures.filter(
      f => now - f.timestamp < this.config.FAILURE_WINDOW
    );

    // Update per-block count
    const currentCount = this.perBlockRetries.get(blockIndex) || 0;

    // Check per-block limit BEFORE incrementing
    // Exceeded if we've already done more than the limit
    if (currentCount >= this.config.MAX_RETRIES_PER_BLOCK) {
      // Already exceeded limit, increment and return livelock
      this.perBlockRetries.set(blockIndex, currentCount + 1);
      this.failures.push({ blockIndex, timestamp: now });
      return true;
    }

    // Check total failures limit BEFORE incrementing
    if (this.failures.length >= this.config.MAX_TOTAL_FAILURES) {
      // Already at total limit, increment and return livelock
      this.perBlockRetries.set(blockIndex, currentCount + 1);
      this.failures.push({ blockIndex, timestamp: now });
      return true;
    }

    // Under limits, increment and record
    this.perBlockRetries.set(blockIndex, currentCount + 1);
    this.failures.push({ blockIndex, timestamp: now });

    return false; // No livelock
  }

  /**
   * Get the number of retries for a specific block
   * @param blockIndex - The block index to query
   * @returns The number of retries recorded for this block
   */
  getRetryCount(blockIndex: number): number {
    return this.perBlockRetries.get(blockIndex) || 0;
  }

  /**
   * Check if a block has exceeded its retry limit
   * @param blockIndex - The block index to check
   * @returns true if the block has exceeded its limit
   */
  hasExceededLimit(blockIndex: number): boolean {
    const count = this.perBlockRetries.get(blockIndex) || 0;
    return count >= this.config.MAX_RETRIES_PER_BLOCK;
  }

  /**
   * Reset retry tracking for a specific block after successful operation
   * @param blockIndex - The block index to reset
   */
  resetBlock(blockIndex: number): void {
    this.perBlockRetries.delete(blockIndex);
    // Also remove failures for this block
    this.failures = this.failures.filter(f => f.blockIndex !== blockIndex);
  }

  /**
   * Reset all tracking (e.g., after manifest re-decode)
   */
  reset(): void {
    this.perBlockRetries.clear();
    this.failures = [];
  }
}

/**
 * Create a livelock detector with optional custom configuration
 * @param config - Partial configuration to override defaults
 * @returns A new livelock detector instance
 */
export function createLivelockDetector(config: Partial<LivelockConfig> = {}): LivelockDetector {
  return new InMemoryLivelockDetector(config);
}

/**
 * Base error class for all screenferry errors
 */
export class ScreenferryError extends Error {
  public readonly code: string;

  constructor(code: string, message?: string) {
    super(message || ERROR_MESSAGES[code] || `Error: ${code}`);
    this.name = 'ScreenferryError';
    this.code = code;
  }

  /**
   * Get the user-facing message for this error
   */
  getUserMessage(): string {
    return this.message;
  }

  /**
   * Get the metadata for this error code
   */
  getMetadata() {
    return ERROR_METADATA[this.code] || {
      category: 'unknown',
      recoverable: true,
      severity: ErrorSeverity.ERROR,
    };
  }
}

/**
 * Error class for manifest-related errors
 */
export class ManifestError extends ScreenferryError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = 'ManifestError';
  }
}

/**
 * Error class for block verification errors
 */
export class BlockVerificationError extends ScreenferryError {
  constructor(code: string, message?: string) {
    super(code, message);
    this.name = 'BlockVerificationError';
  }
}

/**
 * Error class for K-based stream refusal (D26/T1)
 */
export class KOverflowError extends ScreenferryError {
  public readonly details: {
    beaconK: number;
    localKMax: number;
  };

  constructor(beaconK: number, localKMax: number) {
    const message = `Sender's chunk size (K=${beaconK}) exceeds this device's maximum supported complexity (K_max=${localKMax}). The sender must use a smaller file or reduce K.`;
    super('E-K-OVERFLOW', message);
    this.name = 'KOverflowError';
    this.details = { beaconK, localKMax };
  }

  /**
   * Get formatted error message with recovery guidance
   */
  getFormattedMessage(): string {
    return `${this.message}

Recovery options (on the SENDING device):
• Compress the file to reduce K (recommended)
• Split into smaller files
• Use a more powerful receiver device

The receiver cannot handle this transfer size and has no back-channel to request adjustment.`;
  }
}

/**
 * Get error message for a given error code
 * @param code - The error code to look up
 * @returns The user-facing error message, or a generic message if code not found
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || `Error: ${code}`;
}

/**
 * Get error metadata for a given error code
 * @param code - The error code to look up
 * @returns The error metadata, or default metadata if code not found
 */
export function getErrorMetadata(code: string) {
  return ERROR_METADATA[code] || {
    category: 'unknown',
    recoverable: true,
    severity: ErrorSeverity.ERROR,
  };
}
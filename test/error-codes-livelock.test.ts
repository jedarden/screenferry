/**
 * Tests for error codes and E12 livelock detector.
 *
 * Verifies that:
 * 1. All E-MANIFEST-* error codes are defined with proper messages
 * 2. E12 livelock detector correctly identifies retry loops
 * 3. Livelock detector enforces per-block and total failure limits
 * 4. Livelock detector properly resets on successful operations
 * 5. Error code metadata is correct for all codes
 *
 * Reference: plan.md §11, E12, bf-5fm
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {
  ERROR_MESSAGES,
  ERROR_METADATA,
  ErrorSeverity,
  ScreenferryError,
  ManifestError,
  BlockVerificationError,
  LivelockDetector,
  InMemoryLivelockDetector,
  DEFAULT_LIVELOCK_CONFIG,
  createLivelockDetector,
  getErrorMessage,
  getErrorMetadata,
  LivelockConfig,
} from '../src/core/errors/error-codes.js';

describe('Error codes and messages', () => {
  describe('E-MANIFEST-* error codes', () => {
    it('should have E-MANIFEST-CORRUPT error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-MANIFEST-CORRUPT');
      expect(ERROR_MESSAGES['E-MANIFEST-CORRUPT']).toBe(
        'The block manifest is corrupted and is being re-decoded.'
      );
    });

    it('should have E-MANIFEST-MISSING error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-MANIFEST-MISSING');
      expect(ERROR_MESSAGES['E-MANIFEST-MISSING']).toBe(
        'Waiting for block manifest to verify received chunks.'
      );
    });

    it('should have E-MANIFEST-DECODE error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-MANIFEST-DECODE');
      expect(ERROR_MESSAGES['E-MANIFEST-DECODE']).toBe(
        'Could not decode the block manifest. Retrying...'
      );
    });

    it('should have E-MANIFEST-LIVELOCK error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-MANIFEST-LIVELOCK');
      expect(ERROR_MESSAGES['E-MANIFEST-LIVELOCK']).toBe(
        'Multiple chunks failed verification — the manifest appears corrupted. Re-decoding manifest...'
      );
    });

    it('should have correct metadata for manifest errors', () => {
      const manifestCodes = [
        'E-MANIFEST-CORRUPT',
        'E-MANIFEST-MISSING',
        'E-MANIFEST-DECODE',
        'E-MANIFEST-LIVELOCK',
      ];

      for (const code of manifestCodes) {
        expect(ERROR_METADATA).toHaveProperty(code);
        const meta = ERROR_METADATA[code];
        expect(meta.category).toBe('manifest');
        expect(meta.recoverable).toBe(true);
        expect(meta.severity).toBe(ErrorSeverity.ERROR);
      }
    });

    it('should have INFO severity for E-MANIFEST-MISSING', () => {
      expect(ERROR_METADATA['E-MANIFEST-MISSING'].severity).toBe(ErrorSeverity.INFO);
    });
  });

  describe('E12 block verification error codes', () => {
    it('should have E-BLOCK-HASH error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-BLOCK-HASH');
      expect(ERROR_MESSAGES['E-BLOCK-HASH']).toBe(
        'A chunk arrived corrupted and is being re-collected.'
      );
    });

    it('should have E-BLOCK-RETRY-EXCEEDED error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-BLOCK-RETRY-EXCEEDED');
      expect(ERROR_MESSAGES['E-BLOCK-RETRY-EXCEEDED']).toBe(
        'A chunk has failed verification too many times. Re-decoding manifest...'
      );
    });

    it('should have correct metadata for block errors', () => {
      const blockCodes = ['E-BLOCK-HASH', 'E-BLOCK-RETRY-EXCEEDED'];

      for (const code of blockCodes) {
        expect(ERROR_METADATA).toHaveProperty(code);
        const meta = ERROR_METADATA[code];
        expect(meta.category).toBe('block');
        expect(meta.recoverable).toBe(true);
        expect(meta.severity).toBe(ErrorSeverity.ERROR);
      }
    });
  });

  describe('D26 K-refusal error code', () => {
    it('should have E-K-OVERFLOW error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-K-OVERFLOW');
      expect(ERROR_MESSAGES['E-K-OVERFLOW']).toBe(
        "Sender's chunk size is too large for this device. Use a smaller file or a more powerful receiver."
      );
    });

    it('should have FATAL severity for E-K-OVERFLOW', () => {
      expect(ERROR_METADATA).toHaveProperty('E-K-OVERFLOW');
      const meta = ERROR_METADATA['E-K-OVERFLOW'];
      expect(meta.category).toBe('protocol');
      expect(meta.recoverable).toBe(false);
      expect(meta.severity).toBe(ErrorSeverity.FATAL);
    });
  });

  describe('Repair code bounds error', () => {
    it('should have E-REPAIR-BOUNDS error code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-REPAIR-BOUNDS');
      expect(ERROR_MESSAGES['E-REPAIR-BOUNDS']).toBe(
        'That repair code refers to chunks that don\'t exist. Check it and try again.'
      );
    });

    it('should have correct metadata for E-REPAIR-BOUNDS', () => {
      expect(ERROR_METADATA).toHaveProperty('E-REPAIR-BOUNDS');
      const meta = ERROR_METADATA['E-REPAIR-BOUNDS'];
      expect(meta.category).toBe('protocol');
      expect(meta.recoverable).toBe(true);
      expect(meta.severity).toBe(ErrorSeverity.ERROR);
    });
  });

  describe('E-VERIFYING status code', () => {
    it('should have E-VERIFYING status code', () => {
      expect(ERROR_MESSAGES).toHaveProperty('E-VERIFYING');
      expect(ERROR_MESSAGES['E-VERIFYING']).toBe(
        'Verifying received chunks against manifest...'
      );
    });

    it('should have INFO severity for E-VERIFYING', () => {
      expect(ERROR_METADATA).toHaveProperty('E-VERIFYING');
      const meta = ERROR_METADATA['E-VERIFYING'];
      expect(meta.category).toBe('status');
      expect(meta.recoverable).toBe(true);
      expect(meta.severity).toBe(ErrorSeverity.INFO);
    });
  });

  describe('Error code utility functions', () => {
    it('should get error message for valid code', () => {
      const message = getErrorMessage('E-BLOCK-HASH');
      expect(message).toBe('A chunk arrived corrupted and is being re-collected.');
    });

    it('should return generic message for unknown code', () => {
      const message = getErrorMessage('E-UNKNOWN-CODE');
      expect(message).toBe('Error: E-UNKNOWN-CODE');
    });

    it('should get error metadata for valid code', () => {
      const meta = getErrorMetadata('E-BLOCK-HASH');
      expect(meta.severity).toBe(ErrorSeverity.ERROR);
      expect(meta.category).toBe('block');
      expect(meta.recoverable).toBe(true);
    });

    it('should return default metadata for unknown code', () => {
      const meta = getErrorMetadata('E-UNKNOWN-CODE');
      expect(meta.severity).toBe(ErrorSeverity.ERROR);
      expect(meta.category).toBe('unknown');
      expect(meta.recoverable).toBe(true);
    });
  });

  describe('Error classes', () => {
    it('should create ScreenferryError with code and message', () => {
      const error = new ScreenferryError('E-BLOCK-HASH', 'Custom message');
      expect(error.code).toBe('E-BLOCK-HASH');
      expect(error.message).toBe('Custom message');
      expect(error.name).toBe('ScreenferryError');
    });

    it('should use default message when not provided', () => {
      const error = new ScreenferryError('E-BLOCK-HASH');
      expect(error.message).toBe('A chunk arrived corrupted and is being re-collected.');
    });

    it('should get user-facing message', () => {
      const error = new ScreenferryError('E-BLOCK-HASH');
      expect(error.getUserMessage()).toBe('A chunk arrived corrupted and is being re-collected.');
    });

    it('should get error metadata', () => {
      const error = new ScreenferryError('E-BLOCK-HASH');
      const meta = error.getMetadata();
      expect(meta.severity).toBe(ErrorSeverity.ERROR);
      expect(meta.category).toBe('block');
    });

    it('should create ManifestError with valid codes', () => {
      const error = new ManifestError('E-MANIFEST-CORRUPT', 'Manifest corrupted');
      expect(error.code).toBe('E-MANIFEST-CORRUPT');
      expect(error.name).toBe('ManifestError');
    });

    it('should create BlockVerificationError with valid codes', () => {
      const error = new BlockVerificationError('E-BLOCK-HASH', 'Block hash failed');
      expect(error.code).toBe('E-BLOCK-HASH');
      expect(error.name).toBe('BlockVerificationError');
    });
  });
});

describe('E12 Livelock Detector', () => {
  let detector: LivelockDetector;

  beforeEach(() => {
    detector = createLivelockDetector();
  });

  describe('Basic retry tracking', () => {
    it('should record retry for a block', () => {
      const livelockDetected = detector.recordRetry(0);
      expect(livelockDetected).toBe(false);
      expect(detector.getRetryCount(0)).toBe(1);
    });

    it('should track multiple retries for same block', () => {
      detector.recordRetry(0);
      detector.recordRetry(0);
      expect(detector.getRetryCount(0)).toBe(2);
    });

    it('should track retries for different blocks independently', () => {
      detector.recordRetry(0);
      detector.recordRetry(1);
      detector.recordRetry(0);
      expect(detector.getRetryCount(0)).toBe(2);
      expect(detector.getRetryCount(1)).toBe(1);
    });

    it('should return zero for blocks with no retries', () => {
      expect(detector.getRetryCount(999)).toBe(0);
    });
  });

  describe('Per-block retry limit', () => {
    it('should detect livelock when per-block limit exceeded', () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 3,
        MAX_TOTAL_FAILURES: 1000, // High to avoid triggering this limit
        FAILURE_WINDOW: 60000,
      };
      const strictDetector = createLivelockDetector(config);

      // Record 3 retries (at the limit)
      strictDetector.recordRetry(0);
      strictDetector.recordRetry(0);
      strictDetector.recordRetry(0);
      expect(strictDetector.hasExceededLimit(0)).toBe(false);

      // One more retry should exceed the limit
      const livelockDetected = strictDetector.recordRetry(0);
      expect(livelockDetected).toBe(true);
      expect(strictDetector.hasExceededLimit(0)).toBe(true);
    });

    it('should not trigger livelock for blocks under limit', () => {
      detector.recordRetry(0);
      detector.recordRetry(0);
      expect(detector.hasExceededLimit(0)).toBe(false);
      expect(detector.recordRetry(0)).toBe(false); // 3rd retry, still under limit
    });
  });

  describe('Total failure limit', () => {
    it('should detect livelock when total failures exceed limit', () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 1000, // High to avoid triggering this limit
        MAX_TOTAL_FAILURES: 5,
        FAILURE_WINDOW: 60000,
      };
      const strictDetector = createLivelockDetector(config);

      // Record failures across different blocks
      for (let i = 0; i < 5; i++) {
        const livelockDetected = strictDetector.recordRetry(i);
        expect(livelockDetected).toBe(false); // Still under limit
      }

      // One more failure should trigger livelock
      const livelockDetected = strictDetector.recordRetry(5);
      expect(livelockDetected).toBe(true);
    });

    it('should count failures across all blocks', () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 1000,
        MAX_TOTAL_FAILURES: 10,
        FAILURE_WINDOW: 60000,
      };
      const strictDetector = createLivelockDetector(config);

      // Distribute failures across multiple blocks
      for (let i = 0; i < 10; i++) {
        strictDetector.recordRetry(i % 3); // Spread across blocks 0, 1, 2
      }

      expect(strictDetector.recordRetry(0)).toBe(true); // Should trigger total limit
    });
  });

  describe('Failure window time-based cleanup', () => {
    it('should respect failure window for old failures', async () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 1000,
        MAX_TOTAL_FAILURES: 5,
        FAILURE_WINDOW: 100, // 100ms window
      };
      const windowDetector = createLivelockDetector(config);

      // Record some failures
      for (let i = 0; i < 4; i++) {
        windowDetector.recordRetry(i);
      }

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Old failures should be cleaned up, new ones shouldn't trigger limit
      const livelockDetected = windowDetector.recordRetry(10);
      expect(livelockDetected).toBe(false);
    });

    it('should keep recent failures within window', async () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 1000,
        MAX_TOTAL_FAILURES: 3,
        FAILURE_WINDOW: 200, // 200ms window
      };
      const windowDetector = createLivelockDetector(config);

      // Record initial failures
      windowDetector.recordRetry(0);
      windowDetector.recordRetry(1);

      // Wait half the window
      await new Promise(resolve => setTimeout(resolve, 100));

      // Add more failure (should still be within window)
      const livelockDetected = windowDetector.recordRetry(2);
      expect(livelockDetected).toBe(true); // 3 failures within window
    });
  });

  describe('Block reset on success', () => {
    it('should reset retry count for specific block', () => {
      detector.recordRetry(0);
      detector.recordRetry(0);
      expect(detector.getRetryCount(0)).toBe(2);

      detector.resetBlock(0);
      expect(detector.getRetryCount(0)).toBe(0);
    });

    it('should not affect other blocks when resetting one block', () => {
      detector.recordRetry(0);
      detector.recordRetry(1);
      detector.recordRetry(1);

      detector.resetBlock(0);
      expect(detector.getRetryCount(0)).toBe(0);
      expect(detector.getRetryCount(1)).toBe(2);
    });

    it('should allow retry after reset', () => {
      // Exhaust retries for block 0
      for (let i = 0; i < DEFAULT_LIVELOCK_CONFIG.MAX_RETRIES_PER_BLOCK + 1; i++) {
        detector.recordRetry(0);
      }
      expect(detector.hasExceededLimit(0)).toBe(true);

      // Reset and retry should succeed
      detector.resetBlock(0);
      expect(detector.hasExceededLimit(0)).toBe(false);
      expect(detector.recordRetry(0)).toBe(false);
    });
  });

  describe('Global reset', () => {
    it('should reset all tracking on global reset', () => {
      detector.recordRetry(0);
      detector.recordRetry(1);
      detector.recordRetry(2);

      detector.reset();

      expect(detector.getRetryCount(0)).toBe(0);
      expect(detector.getRetryCount(1)).toBe(0);
      expect(detector.getRetryCount(2)).toBe(0);
    });

    it('should clear livelock state after global reset', () => {
      // Trigger livelock
      for (let i = 0; i < DEFAULT_LIVELOCK_CONFIG.MAX_TOTAL_FAILURES + 1; i++) {
        detector.recordRetry(i);
      }

      // Reset and try again
      detector.reset();
      expect(detector.recordRetry(0)).toBe(false);
    });
  });

  describe('E12 scenario: corrupt manifest retry loop', () => {
    it('should detect livelock in E12 retry scenario', () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 3,
        MAX_TOTAL_FAILURES: 10,
        FAILURE_WINDOW: 60000,
      };
      const e12Detector = createLivelockDetector(config);

      // Simulate E12 scenario: same block keeps failing against corrupt manifest
      let livelockDetected = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        livelockDetected = e12Detector.recordRetry(42);
        if (livelockDetected) {
          break;
        }
        // In real scenario, would retry block collection here
      }

      expect(livelockDetected).toBe(true);
      expect(e12Detector.getRetryCount(42)).toBe(4); // 4 attempts before livelock
    });

    it('should handle multiple blocks failing in manifest corruption', () => {
      const config: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 2,
        MAX_TOTAL_FAILURES: 6,
        FAILURE_WINDOW: 60000,
      };
      const e12Detector = createLivelockDetector(config);

      // Multiple blocks failing (indicating manifest corruption)
      e12Detector.recordRetry(10);
      e12Detector.recordRetry(11);
      e12Detector.recordRetry(10); // Block 10 exceeds limit
      e12Detector.recordRetry(12);
      e12Detector.recordRetry(13);
      e12Detector.recordRetry(14); // Should trigger total limit

      expect(e12Detector.hasExceededLimit(10)).toBe(true);
    });

    it('should allow recovery after manifest re-decode', () => {
      const e12Detector = createLivelockDetector();

      // Trigger livelock
      for (let i = 0; i < DEFAULT_LIVELOCK_CONFIG.MAX_RETRIES_PER_BLOCK + 1; i++) {
        e12Detector.recordRetry(100);
      }
      expect(e12Detector.hasExceededLimit(100)).toBe(true);

      // Simulate manifest re-decode and retry
      e12Detector.reset();

      // Should now accept retries for previously failing blocks
      expect(e12Detector.recordRetry(100)).toBe(false);
      expect(e12Detector.hasExceededLimit(100)).toBe(false);
    });
  });

  describe('Default configuration', () => {
    it('should use safe default values', () => {
      expect(DEFAULT_LIVELOCK_CONFIG.MAX_RETRIES_PER_BLOCK).toBe(3);
      expect(DEFAULT_LIVELOCK_CONFIG.MAX_TOTAL_FAILURES).toBe(100);
      expect(DEFAULT_LIVELOCK_CONFIG.FAILURE_WINDOW).toBe(60000);
    });

    it('should create detector with default config', () => {
      const defaultDetector = createLivelockDetector();
      expect(defaultDetector).toBeInstanceOf(InMemoryLivelockDetector);
    });

    it('should create detector with custom config', () => {
      const customConfig: Partial<LivelockConfig> = {
        MAX_RETRIES_PER_BLOCK: 5,
        MAX_TOTAL_FAILURES: 50,
      };
      const customDetector = createLivelockDetector(customConfig);
      expect(customDetector).toBeInstanceOf(InMemoryLivelockDetector);

      // Verify custom limits are applied
      for (let i = 0; i < 5; i++) {
        customDetector.recordRetry(0);
      }
      expect(customDetector.recordRetry(0)).toBe(true); // Should trigger at 5
    });
  });

  describe('Edge cases', () => {
    it('should handle very large block indices', () => {
      const largeIndex = 999999;
      detector.recordRetry(largeIndex);
      expect(detector.getRetryCount(largeIndex)).toBe(1);
    });

    it('should handle resetting non-existent blocks', () => {
      expect(() => detector.resetBlock(99999)).not.toThrow();
      expect(detector.getRetryCount(99999)).toBe(0);
    });

    it('should handle concurrent retry tracking', () => {
      // Simulate rapid retries from multiple blocks
      const results: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        results.push(detector.recordRetry(i % 5));
      }

      // Should not throw, all should be under default limits
      expect(results.every(r => r === false)).toBe(true);
    });
  });
});

describe('Error code completeness', () => {
  const requiredErrorCodes = [
    // Optical/Acquisition
    'E-NO-SIGNAL',
    'E-TOO-FAR',
    'E-TOO-CLOSE',
    'E-BLUR',
    'E-DARK',
    'E-GLARE',
    'E-FOCUS-HUNT',
    'E-ORIENTATION',
    'E-SENDER-STALLED',
    'E-TORN',
    // Protocol
    'E-FOREIGN-STREAM',
    'E-VERSION',
    'E-META-BOUNDS',
    'E-K-OVERFLOW',
    'E-REPAIR-BOUNDS',
    'E-REPAIR-CODE',
    'E-FILE-HASH',
    'E-WASM-LOAD',
    // Manifest (bf-5fm)
    'E-MANIFEST-CORRUPT',
    'E-MANIFEST-MISSING',
    'E-MANIFEST-DECODE',
    'E-MANIFEST-LIVELOCK',
    // Block verification (E12, bf-5fm)
    'E-BLOCK-HASH',
    'E-BLOCK-RETRY-EXCEEDED',
    // Status
    'E-VERIFYING',
    // Local/Resource
    'E-QUOTA-PREFLIGHT',
    'E-QUOTA-EXHAUSTED',
    'E-SOURCE-CHANGED',
    'E-BACKGROUNDED',
    'E-CAMERA-LOST',
    'E-WAKELOCK-LOST',
    'E-DECOMPRESS',
  ];

  it('should have all required error codes defined', () => {
    for (const code of requiredErrorCodes) {
      expect(ERROR_MESSAGES).toHaveProperty(code);
      expect(ERROR_METADATA).toHaveProperty(code);
    }
  });

  it('should have non-empty messages for all error codes', () => {
    for (const code of requiredErrorCodes) {
      const message = ERROR_MESSAGES[code];
      expect(message).toBeDefined();
      expect(message).toBeTruthy();
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it('should have valid severity levels for all error codes', () => {
    const validSeverities = [ErrorSeverity.INFO, ErrorSeverity.WARNING, ErrorSeverity.ERROR, ErrorSeverity.FATAL];
    for (const code of requiredErrorCodes) {
      const severity = ERROR_METADATA[code].severity;
      expect(validSeverities).toContain(severity);
    }
  });

  it('should have valid categories for all error codes', () => {
    const validCategories = ['optical', 'protocol', 'manifest', 'block', 'status', 'resource'];
    for (const code of requiredErrorCodes) {
      const category = ERROR_METADATA[code].category;
      expect(validCategories).toContain(category);
    }
  });
});

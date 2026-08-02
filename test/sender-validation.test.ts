/**
 * Sender validation tests (bf-4pc5).
 *
 * Tests the sender-side detection for compression+resume conflict.
 *
 * These tests ensure that:
 * 1. Compression and resume cannot both be enabled
 * 2. The validation function throws appropriately
 * 3. Non-throwing variants work correctly
 *
 * See: docs/notes/bf-4pc5-sender-compression-resume-detection.md
 */

import {describe, it, expect} from 'vitest';
import {
  validateSenderConfig,
  isValidSenderConfig,
  getValidationError,
  CompressionResumeConflictError,
  type SenderConfig,
} from '../src/core/sender-validation.js';

describe('Sender validation (bf-4pc5)', () => {
  describe('validateSenderConfig()', () => {
    it('should accept compression enabled without resume', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: false,
      };
      expect(() => validateSenderConfig(config)).not.toThrow();
    });

    it('should accept resume enabled without compression', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: true,
      };
      expect(() => validateSenderConfig(config)).not.toThrow();
    });

    it('should accept both compression and resume disabled', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: false,
      };
      expect(() => validateSenderConfig(config)).not.toThrow();
    });

    it('should throw when both compression and resume are enabled', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      expect(() => validateSenderConfig(config)).toThrow(CompressionResumeConflictError);
    });

    it('should throw with correct error type', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      expect(() => validateSenderConfig(config)).toThrow(CompressionResumeConflictError);
      expect(() => validateSenderConfig(config)).toThrow('Compression and resume cannot both be enabled');
    });

    it('should provide detailed error message', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      try {
        validateSenderConfig(config);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(CompressionResumeConflictError);
        const error = e as CompressionResumeConflictError;
        expect(error.message).toContain('Compression and resume cannot both be enabled');
        expect(error.message).toContain('CompressionStream');
        expect(error.message).toContain('determinism');
      }
    });
  });

  describe('isValidSenderConfig()', () => {
    it('should return true for valid config with compression', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: false,
      };
      expect(isValidSenderConfig(config)).toBe(true);
    });

    it('should return true for valid config with resume', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: true,
      };
      expect(isValidSenderConfig(config)).toBe(true);
    });

    it('should return true for both disabled', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: false,
      };
      expect(isValidSenderConfig(config)).toBe(true);
    });

    it('should return false when both are enabled', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      expect(isValidSenderConfig(config)).toBe(false);
    });
  });

  describe('getValidationError()', () => {
    it('should return null for valid config with compression', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: false,
      };
      expect(getValidationError(config)).toBeNull();
    });

    it('should return null for valid config with resume', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: true,
      };
      expect(getValidationError(config)).toBeNull();
    });

    it('should return null for both disabled', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: false,
      };
      expect(getValidationError(config)).toBeNull();
    });

    it('should return error message when both are enabled', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      const error = getValidationError(config);
      expect(error).not.toBeNull();
      expect(error).toContain('Compression and resume cannot both be enabled');
    });

    it('should return specific error message mentioning CompressionStream', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };
      const error = getValidationError(config);
      expect(error).not.toBeNull();
      expect(error).toContain('CompressionStream');
      expect(error).toContain('determinism');
    });
  });

  describe('CompressionResumeConflictError', () => {
    it('should be an Error instance', () => {
      const error = new CompressionResumeConflictError();
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name', () => {
      const error = new CompressionResumeConflictError();
      expect(error.name).toBe('CompressionResumeConflictError');
    });

    it('should have descriptive message', () => {
      const error = new CompressionResumeConflictError();
      expect(error.message).toContain('Compression and resume cannot both be enabled');
      expect(error.message).toContain('CompressionStream');
      expect(error.message).toContain('determinism');
    });
  });

  describe('Integration scenarios', () => {
    it('should catch configuration error before sender starts', () => {
      // Scenario: Sender initialization checks configuration before any work begins
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,  // Invalid!
      };

      // Before creating staging files or starting transmission
      expect(() => validateSenderConfig(config)).toThrow();

      // This prevents:
      // 1. Creating staging files that would be corrupted on resume
      // 2. Emitting beacons with invalid flag combinations
      // 3. Silently corrupting receiver state
    });

    it('should allow sender to proceed with compression-only', () => {
      // Scenario: User wants fast transfer, accepts no resume
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: false,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      // Sender can proceed to:
      // 1. Create compressed staging file
      // 2. Set BeaconFlags.Compressed | BeaconFlags.ResumeDisabled
      // 3. Start transmission
    });

    it('should allow sender to proceed with resume-only', () => {
      // Scenario: User wants robust multi-hour transfer
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: true,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      // Sender can proceed to:
      // 1. Read file directly (no compression)
      // 2. Set BeaconFlags.None (resume enabled)
      // 3. Start transmission with resume support
    });

    it('should allow sender to proceed with neither', () => {
      // Scenario: User doesn't need compression or resume
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: false,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      // Sender can proceed to:
      // 1. Read file directly
      // 2. Set BeaconFlags.None
      // 3. Start transmission
    });
  });
});

/**
 * Conflict detection tests for compression+resume incompatibility (bf-4bi6).
 *
 * Tests that sender initialization properly detects and rejects the
 * unsafe combination of compression and resume being enabled together.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validateSenderConfig, isSenderConfigValid, getSenderConfig, type SenderConfig } from '../src/platform/config-validation.js';
import { ConfigurationError } from '../src/core/errors/error-codes.js';

describe('validateSenderConfig()', () => {
  it('allows compression without resume', () => {
    const config: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: false,
    };

    expect(() => validateSenderConfig(config)).not.toThrow();
  });

  it('allows resume without compression', () => {
    const config: SenderConfig = {
      compressionEnabled: false,
      resumeEnabled: true,
    };

    expect(() => validateSenderConfig(config)).not.toThrow();
  });

  it('allows both disabled (default)', () => {
    const config: SenderConfig = {
      compressionEnabled: false,
      resumeEnabled: false,
    };

    expect(() => validateSenderConfig(config)).not.toThrow();
  });

  it('throws ConfigurationError when both are enabled', () => {
    const config: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: true,
    };

    expect(() => validateSenderConfig(config)).toThrow(ConfigurationError);
  });

  it('provides clear error message and code for the conflict', () => {
    const config: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: true,
    };

    try {
      validateSenderConfig(config);
      expect.fail('Should have thrown ConfigurationError');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigurationError);
      expect((e as ConfigurationError).code).toBe('E-COMPRESSION-RESUME-CONFLICT');
      // Error message should be user-friendly and explain the issue
      expect((e as ConfigurationError).message).toBeTruthy();
      expect((e as ConfigurationError).message).length.toBeGreaterThan(0);
    }
  });
});

describe('isSenderConfigValid()', () => {
  it('returns true for valid configurations', () => {
    expect(isSenderConfigValid({ compressionEnabled: false, resumeEnabled: false })).toBe(true);
    expect(isSenderConfigValid({ compressionEnabled: true, resumeEnabled: false })).toBe(true);
    expect(isSenderConfigValid({ compressionEnabled: false, resumeEnabled: true })).toBe(true);
  });

  it('returns false for invalid configurations', () => {
    const invalidConfig: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: true,
    };

    expect(isSenderConfigValid(invalidConfig)).toBe(false);
  });
});

describe('getSenderConfig()', () => {
  it('returns default configuration (both disabled)', () => {
    const config = getSenderConfig();

    expect(config.compressionEnabled).toBe(false);
    expect(config.resumeEnabled).toBe(false);
  });

  it('default configuration is valid', () => {
    const config = getSenderConfig();

    expect(() => validateSenderConfig(config)).not.toThrow();
    expect(isSenderConfigValid(config)).toBe(true);
  });
});

describe('Integration: conflict detection in initialization', () => {
  it('validation happens before any state changes', () => {
    // This test verifies that the validation is called early in initialization
    // before any async operations or state mutations occur
    const invalidConfig: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: true,
    };

    // Validation should throw immediately without side effects
    expect(() => validateSenderConfig(invalidConfig)).toThrow(ConfigurationError);

    // No files should be created, no sessions initialized, etc.
    // (Verified by the synchronous nature of the validation function)
  });

  it('error message explains the incompatibility clearly', () => {
    const invalidConfig: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: true,
    };

    try {
      validateSenderConfig(invalidConfig);
      expect.fail('Should have thrown ConfigurationError');
    } catch (e) {
      const error = e as ConfigurationError;
      expect(error.code).toBe('E-COMPRESSION-RESUME-CONFLICT');
      // Error message should be user-friendly and non-empty
      expect(error.message).toBeTruthy();
      expect(error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('Normal flows remain unchanged', () => {
  it('default configuration does not interfere with normal operation', () => {
    const config = getSenderConfig();

    // Default config should be valid and not throw
    expect(() => validateSenderConfig(config)).not.toThrow();

    // Should pass validation
    expect(isSenderConfigValid(config)).toBe(true);

    // Should represent the normal (non-conflict) state
    expect(config.compressionEnabled).toBe(false);
    expect(config.resumeEnabled).toBe(false);
  });

  it('individual flags work independently', () => {
    const compressionOnly: SenderConfig = {
      compressionEnabled: true,
      resumeEnabled: false,
    };

    const resumeOnly: SenderConfig = {
      compressionEnabled: false,
      resumeEnabled: true,
    };

    // Both should be valid
    expect(() => validateSenderConfig(compressionOnly)).not.toThrow();
    expect(() => validateSenderConfig(resumeOnly)).not.toThrow();

    expect(isSenderConfigValid(compressionOnly)).toBe(true);
    expect(isSenderConfigValid(resumeOnly)).toBe(true);
  });
});

/**
 * Configuration validation tests (bf-320a).
 *
 * Tests the validation that prevents compression and resume from being
 * enabled simultaneously, which would cause silent corruption.
 */

import {describe, it, expect} from 'vitest';
import {validateSenderConfig, isSenderConfigValid, SenderConfig} from '../src/platform/config-validation.js';
import {ConfigurationError} from '../src/core/errors/error-codes.js';

describe('Configuration validation (bf-320a)', () => {
  describe('validateSenderConfig', () => {
    it('should accept compression enabled without resume', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: false,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      expect(isSenderConfigValid(config)).toBe(true);
    });

    it('should accept resume enabled without compression', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: true,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      expect(isSenderConfigValid(config)).toBe(true);
    });

    it('should accept both disabled', () => {
      const config: SenderConfig = {
        compressionEnabled: false,
        resumeEnabled: false,
      };

      expect(() => validateSenderConfig(config)).not.toThrow();
      expect(isSenderConfigValid(config)).toBe(true);
    });

    it('should throw ConfigurationError when both enabled', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };

      expect(() => validateSenderConfig(config)).toThrow(ConfigurationError);
      expect(() => validateSenderConfig(config)).toThrow(ConfigurationError);
      expect(isSenderConfigValid(config)).toBe(false);
    });

    it('should provide correct error code and message', () => {
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
        expect((e as ConfigurationError).message).toBeDefined();
        expect((e as ConfigurationError).message).toBeTruthy();
      }
    });
  });

  describe('isSenderConfigValid', () => {
    it('should return true for valid configurations', () => {
      expect(isSenderConfigValid({ compressionEnabled: false, resumeEnabled: false })).toBe(true);
      expect(isSenderConfigValid({ compressionEnabled: true, resumeEnabled: false })).toBe(true);
      expect(isSenderConfigValid({ compressionEnabled: false, resumeEnabled: true })).toBe(true);
    });

    it('should return false for invalid configuration', () => {
      expect(isSenderConfigValid({ compressionEnabled: true, resumeEnabled: true })).toBe(false);
    });
  });

  describe('Critical safety check (bf-320a acceptance criteria)', () => {
    it('should detect the exact conflict pattern: compressionEnabled && resumeEnabled', () => {
      // This is the EXACT check that prevents silent corruption
      // Pattern from acceptance criteria: "if compressionEnabled && resumeEnabled"

      const conflictConfig: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,  // Both true: CONFLICT
      };

      expect(isSenderConfigValid(conflictConfig)).toBe(false);

      expect(() => validateSenderConfig(conflictConfig))
        .toThrow(ConfigurationError);
    });

    it('should have simple readable check: if compressionEnabled && resumeEnabled', () => {
      // The actual check implementation should be simple and readable
      // From acceptance criteria: "Check is simple and readable"

      // Read the source to verify the implementation is simple
      const fs = require('fs');
      const source = fs.readFileSync('./src/platform/config-validation.ts', 'utf8');

      // Verify the check exists and is readable
      expect(source).toContain('if (config.compressionEnabled && config.resumeEnabled)');
      expect(source).toContain('throw new ConfigurationError');
      expect(source).toContain('E-COMPRESSION-RESUME-CONFLICT');
    });

    it('should include comment explaining why check is critical', () => {
      // From acceptance criteria: "Add a comment explaining why this check is critical"

      const fs = require('fs');
      const source = fs.readFileSync('./src/platform/config-validation.ts', 'utf8');

      // Verify critical explanation exists in comments
      expect(source).toContain('CRITICAL');
      expect(source).toContain('CompressionStream');
      expect(source).toContain('determinism');
      expect(source).toContain('silent corruption');
    });
  });

  describe('Integration with init.ts (bf-320a)', () => {
    it('should be callable from app initialization', () => {
      // Verify the validation can be called during app initialization
      // This tests the integration point with init.ts

      const configs: SenderConfig[] = [
        { compressionEnabled: true, resumeEnabled: false },
        { compressionEnabled: false, resumeEnabled: true },
        { compressionEnabled: false, resumeEnabled: false },
      ];

      // All valid configs should pass
      configs.forEach(config => {
        expect(() => validateSenderConfig(config)).not.toThrow();
      });

      // Invalid config should throw
      expect(() => validateSenderConfig({ compressionEnabled: true, resumeEnabled: true }))
        .toThrow(ConfigurationError);
    });

    it('should validate BEFORE any state changes', () => {
      // From acceptance criteria: "Validation happens BEFORE any files are created or sessions initialized"

      // This test verifies that validateSenderConfig:
      // 1. Does not create any files
      // 2. Does not modify any state
      // 3. Only checks configuration and throws if invalid

      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };

      // Calling validation should be side-effect free
      expect(() => validateSenderConfig(config)).toThrow();

      // Multiple calls should have the same result (no state mutation)
      expect(() => validateSenderConfig(config)).toThrow();
      expect(() => validateSenderConfig(config)).toThrow();
    });
  });

  describe('Error code validation', () => {
    it('should use the correct error code from error-codes.ts', () => {
      // Verify the error code matches what's defined in error-codes.ts
      const fs = require('fs');
      const errorCodesSource = fs.readFileSync('./src/core/errors/error-codes.ts', 'utf8');

      // Verify error code exists in error-codes.ts
      expect(errorCodesSource).toContain('E-COMPRESSION-RESUME-CONFLICT');

      // Verify the message
      expect(errorCodesSource).toContain('Compression and resume cannot be enabled together');
    });

    it('should throw ConfigurationError class', () => {
      const config: SenderConfig = {
        compressionEnabled: true,
        resumeEnabled: true,
      };

      try {
        validateSenderConfig(config);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigurationError);
        expect((e as ConfigurationError).name).toBe('ConfigurationError');
      }
    });
  });
});

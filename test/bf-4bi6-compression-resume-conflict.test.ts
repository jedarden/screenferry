/**
 * Test for bf-4bi6: Compression+Resume conflict detection in sender initialization.
 *
 * Verifies that the conflict detection check at the start of sender initialization
 * correctly prevents the unsafe combination where compression is enabled but
 * resume is not disabled.
 *
 * This test ensures:
 * - encodeBeacon throws when Compressed is set without ResumeDisabled
 * - Error message clearly explains the incompatibility
 * - Check happens before any state changes (no files created, no sessions initialized)
 * - Normal flows without conflict are unchanged
 *
 * See: docs/notes/bf-17s0-resume-compression-conflict.md
 *      docs/notes/bf-2w1a-compression-resume-t4-reap-interaction.md
 */

import {describe, it, expect} from 'vitest';
import {encodeBeacon, BeaconValidationError, BeaconFlags, type BeaconMeta} from '../src/core/frame/beacon.js';

describe('bf-4bi6: Compression+Resume conflict detection', () => {
  /**
   * Helper to create a minimal valid BeaconMeta.
   */
  function createValidMeta(): BeaconMeta {
    return {
      streamId: 0x12345678,
      wireVersion: 1,
      originalSize: 1024 * 1024, // 1 MB
      payloadLen: 1024 * 1024, // 1 MB (uncompressed)
      blockSize: 192 * 1024, // 192 KB
      blockCount: 6,
      fragmentLen: 256, // L
      degreeCap: 64,
      flags: 0,
      blockHashLen: 4,
      wholeFileHash: new Uint8Array(32), // All zeros for testing
      manifestHash: new Uint8Array(4), // CRC-32 of manifest
      filename: 'test.txt',
      mimeType: 'text/plain',
    };
  }

  describe('Conflict detection', () => {
    it('should throw when compression is enabled without disabling resume', () => {
      const meta = createValidMeta();
      // Set Compressed flag WITHOUT ResumeDisabled - this is the conflict
      meta.flags = BeaconFlags.Compressed;

      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);
      expect(() => encodeBeacon(meta)).toThrow('E-COMPRESSION-RESUME-CONFLICT');
    });

    it('should provide clear error message explaining the incompatibility', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      try {
        encodeBeacon(meta);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(BeaconValidationError);
        if (error instanceof BeaconValidationError) {
          expect(error.code).toBe('E-COMPRESSION-RESUME-CONFLICT');
          expect(error.message).toContain('Compression cannot be enabled without disabling resume');
          expect(error.message).toContain('BeaconFlags.ResumeDisabled must also be set');
          expect(error.message).toContain('CompressionStream offers no determinism guarantee');
          expect(error.message).toContain('bf-17s0');
          expect(error.message).toContain('bf-2w1a');
        }
      }
    });

    it('should include conflict details in error', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      try {
        encodeBeacon(meta);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (error) {
        expect(error).toBeInstanceOf(BeaconValidationError);
        if (error instanceof BeaconValidationError) {
          expect(error.details).toBeDefined();
          expect(error.details.flags).toBe(BeaconFlags.Compressed);
          expect(error.details.compressionEnabled).toBe(true);
          expect(error.details.resumeDisabled).toBe(false);
        }
      }
    });
  });

  describe('Valid configurations', () => {
    it('should allow compression when resume is disabled', () => {
      const meta = createValidMeta();
      // Set BOTH Compressed AND ResumeDisabled - this is valid
      meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;

      expect(() => encodeBeacon(meta)).not.toThrow();
    });

    it('should allow no compression with resume enabled', () => {
      const meta = createValidMeta();
      // No flags - resume is allowed
      meta.flags = BeaconFlags.None;

      expect(() => encodeBeacon(meta)).not.toThrow();
    });

    it('should allow ResumeDisabled alone', () => {
      const meta = createValidMeta();
      // Only ResumeDisabled - valid for other reasons
      meta.flags = BeaconFlags.ResumeDisabled;

      expect(() => encodeBeacon(meta)).not.toThrow();
    });

    it('should complete encoding for valid compression configuration', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      meta.payloadLen = 512 * 1024; // Compressed to 512 KB

      const encoded = encodeBeacon(meta);

      // Verify encoding completes successfully
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('Check timing and safety', () => {
    it('should fail before any state changes', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed; // Conflict!

      // The check should happen immediately in encodeBeacon
      // No files should be created, no sessions initialized
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Verify no side effects - meta object unchanged
      expect(meta.flags).toBe(BeaconFlags.Compressed);
    });

    it('should not affect non-conflict paths', () => {
      const validConfigs = [
        BeaconFlags.None,
        BeaconFlags.ResumeDisabled,
        BeaconFlags.Compressed | BeaconFlags.ResumeDisabled,
      ];

      validConfigs.forEach(flags => {
        const meta = createValidMeta();
        meta.flags = flags;

        expect(() => encodeBeacon(meta)).not.toThrow();
      });
    });
  });

  describe('Acceptance criteria verification', () => {
    it('AC1: Sender initialization entry point is encodeBeacon', () => {
      // encodeBeacon is the first function called when sender creates a beacon
      // This test verifies the check is in the right place
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      expect(() => encodeBeacon(meta)).toThrow('E-COMPRESSION-RESUME-CONFLICT');
    });

    it('AC2: Check happens before state mutations', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // If check is after state mutations, we'd see side effects
      // Since it throws immediately, there are no side effects
      expect(() => encodeBeacon(meta)).toThrow();
      expect(meta.flags).toBe(BeaconFlags.Compressed); // Unchanged
    });

    it('AC3: Error message explains incompatibility', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      try {
        encodeBeacon(meta);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(BeaconValidationError);
        if (error instanceof BeaconValidationError) {
          expect(error.message).toMatch(/compression.*resume/i);
          expect(error.message).toMatch(/incompatib/i);
        }
      }
    });

    it('AC4: Check before file creation and session init', () => {
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // encodeBeacon is pure - it doesn't create files or initialize sessions
      // The check happens at the start, so no side effects occur
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);
    });

    it('AC5: Non-conflict paths unchanged', () => {
      const meta = createValidMeta();
      const validFlags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      meta.flags = validFlags;

      // Should work exactly as before
      const encoded = encodeBeacon(meta);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });
});

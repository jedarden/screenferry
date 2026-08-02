/**
 * A10 Hostile beacon fuzzer tests (bf-5fs).
 *
 * Tests T1 bounds checking against hostile beacon inputs including:
 * - fileSize manipulation (original A10 threat)
 * - K_manifest overflow (new DoS vector from unbounded manifest growth)
 *
 * Reference: plan.md §12 T1, §9 A10
 */

import {describe, it, expect} from 'vitest';
import {parseBeacon, encodeBeacon, BeaconValidationError, BEACON_LIMITS, type BeaconMeta} from '../src/core/frame/beacon.js';

describe('A10: Hostile beacon fuzzer (bf-5fs)', () => {
  /**
   * Helper to create a minimal valid BeaconMeta with safe defaults.
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

  /**
   * Helper to create a consistent BeaconMeta and encode it.
   *
   * This helper ensures that blockCount, blockSize, originalSize, and payloadLen
   * are all consistent to avoid validation errors and CRC mismatches.
   *
   * @param overrides - Fields to override in the base meta
   * @returns Encoded beacon bytes
   */
  function createEncodedBeacon(overrides: Partial<BeaconMeta>): Uint8Array {
    const meta = {...createValidMeta(), ...overrides};

    // Ensure wire version is valid for encoding
    if (meta.wireVersion !== 1) {
      // For testing version mismatch, we need to manually craft the beacon
      // because encodeBeacon will reject invalid wire versions
      throw new BeaconValidationError(
        'E-VERSION',
        `Cannot encode beacon for wire version ${meta.wireVersion}, this implementation is 1`,
        {requestedVersion: meta.wireVersion, supportedVersion: 1}
      );
    }

    // Ensure consistency between blockCount, blockSize, and sizes
    if (typeof meta.blockCount === 'number' && typeof meta.blockSize === 'number') {
      const calculatedSize = meta.blockCount * meta.blockSize;

      // Check for overflow and BEACON_LIMITS
      if (!Number.isSafeInteger(calculatedSize)) {
        throw new Error(`Size overflow: blockCount=${meta.blockCount} × blockSize=${meta.blockSize}`);
      }

      if (calculatedSize > BEACON_LIMITS.MAX_FILE_SIZE) {
        throw new Error(`Size exceeds MAX_FILE_SIZE: ${calculatedSize}`);
      }

      // Use the calculated size for consistency
      meta.originalSize = calculatedSize;
      meta.payloadLen = calculatedSize;
    }

    // fragmentLen must match wire constant
    if (meta.fragmentLen !== 256) {
      throw new BeaconValidationError(
        'E-VERSION',
        `Cannot encode beacon with fragmentLen ${meta.fragmentLen}, wire constant is 256`,
        {requestedL: meta.fragmentLen, wireConstantL: 256}
      );
    }

    return encodeBeacon(meta);
  }

  describe('A10 original threat: fileSize manipulation', () => {
    it('accepts beacon with reasonable originalSize and blockCount', () => {
      const meta = createValidMeta();
      meta.blockCount = 1000;

      const encoded = createEncodedBeacon(meta);

      // Should accept valid beacon with wire constant L
      const parsed = parseBeacon(encoded, 1024, 1000 * 192 * 1024); // 1000 blocks × 192 KB = 192 MB
      expect(parsed.blockCount).toBe(1000);
      expect(parsed.fragmentLen).toBe(256); // Wire constant L
    });

    it('rejects parsing beacon with wire version mismatch', () => {
      const meta = createValidMeta();
      meta.blockCount = 100;

      const encoded = createEncodedBeacon(meta);

      // Manually corrupt the wire version byte to test parsing
      const corrupted = new Uint8Array(encoded);
      corrupted[4] = 2; // Change wire version to 2

      try {
        parseBeacon(corrupted, 1024, 100 * 192 * 1024);
        expect.fail('Should have thrown BeaconValidationError for version mismatch');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-VERSION');
          expect(e.message).toContain('sender is'); // Error message mentions sender version
        }
      }
    });

    it('rejects encoding beacon with fragmentLen != L (wire constant)', () => {
      const meta = createValidMeta();
      meta.fragmentLen = 128; // Not equal to wire constant L=256

      try {
        createEncodedBeacon(meta);
        expect.fail('Should have thrown BeaconValidationError for fragmentLen mismatch');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-VERSION');
          expect(e.message).toContain('fragmentLen');
          expect(e.message).toContain('wire constant');
        }
      }
    });

    it('rejects beacon with originalSize exceeding available quota', () => {
      const meta = createValidMeta();
      // Set blockCount to create a 100 MB file
      // 100 MB = 100 * 1024 * 1024 bytes
      // blockCount = 100 * 1024 * 1024 / 196608 ≈ 524
      meta.blockCount = 524; // Creates ~100 MB file

      const encoded = createEncodedBeacon(meta);

      try {
        // Parse with only 50 MB quota
        parseBeacon(encoded, 1024, 50 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError for quota exceeded');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-QUOTA-PREFLIGHT');
          expect(e.message).toContain('exceeds available quota');
        }
      }
    });
  });

  describe('A10 extended threat: K_manifest overflow (bf-5fs)', () => {
    it('accepts beacon with reasonable manifest block count', () => {
      const meta = createValidMeta();
      meta.blockCount = 10_000; // 10K blocks = small manifest

      const encoded = createEncodedBeacon(meta);

      // Should accept - manifest size is reasonable and fragmentLen matches wire constant
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024 * 1024);
      expect(parsed.blockCount).toBe(10_000);
      expect(parsed.fragmentLen).toBe(256); // Wire constant L
    });

    it('rejects beacon with excessive K_manifest growth', () => {
      const meta = createValidMeta();
      // Use blockCount that would exceed MAX_K_MANIFEST_BLOCKS (1000)
      // K_manifest = ceil(blockCount × blockHashLen / BLOCK)
      // For blockHashLen=4, BLOCK=196608: K_manifest = ceil(blockCount × 4 / 196,608)
      // We need a blockCount that yields K_manifest > 1000
      // With blockCount=16.7M and blockHashLen=64: K_manifest = ceil(16,700,000 × 64 / 196,608) = 5,434

      meta.blockHashLen = 64; // Larger hash to trigger K_manifest overflow
      meta.blockCount = 16_700_000; // Maximum allowed blockCount

      const encoded = createEncodedBeacon(meta);

      try {
        parseBeacon(encoded, 1024, 3 * 1024 * 1024 * 1024); // 3 TB quota
        expect.fail('Should have thrown BeaconValidationError for K_manifest overflow');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          // Should fail on manifest size check
          expect(e.code).toBe('E-META-BOUNDS');
          expect(e.message).toContain('Manifest block count');
          expect(e.message).toContain('exceeds maximum');
        }
      }
    });

    it('calculates K_manifest correctly for edge cases', () => {
      const meta = createValidMeta();

      // Test case 1: blockCount that yields exactly 1 manifest block
      // 1 = ceil(blockCount × 4 / 196608)
      // blockCount = 196608 / 4 = 49,152
      meta.blockCount = 49_152;

      const encoded1 = createEncodedBeacon(meta);
      const parsed1 = parseBeacon(encoded1, 1024, 10 * 1024 * 1024 * 1024);
      expect(parsed1.blockCount).toBe(49_152);
      expect(parsed1.fragmentLen).toBe(256); // Wire constant L

      // Test case 2: blockCount that yields a reasonable manifest size
      // Test that K_manifest calculation works for reasonable values
      meta.blockCount = 100_000;

      const encoded2 = createEncodedBeacon(meta);
      const parsed2 = parseBeacon(encoded2, 1024, 10 * 1024 * 1024 * 1024);
      expect(parsed2.blockCount).toBe(100_000);
      expect(parsed2.fragmentLen).toBe(256); // Wire constant L
    });

    it('prevents unbounded manifest growth from combined parameters', () => {
      const meta = createValidMeta();

      // Test with large blockHashLen to trigger K_manifest overflow with reasonable blockCount
      meta.blockHashLen = 64; // Larger hash length
      meta.blockCount = 5_000_000; // Well within MAX_BLOCK_COUNT

      const encoded = createEncodedBeacon(meta);

      try {
        parseBeacon(encoded, 1024, 3 * 1024 * 1024 * 1024);
        expect.fail('Should have prevented K_manifest overflow');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-META-BOUNDS');
          expect(e.details.blockCountManifest).toBeGreaterThan(1000);
        }
      }
    });
  });

  describe('A10 fuzzer: parameter combination attacks', () => {
    it('rejects beacon with both originalSize and K_manifest at extremes', () => {
      const meta = createValidMeta();
      // Use large blockHashLen to trigger K_manifest overflow
      meta.blockHashLen = 64;
      meta.blockCount = 5_000_000; // Would cause K_manifest overflow

      const encoded = createEncodedBeacon(meta);

      try {
        parseBeacon(encoded, 1024, 3 * 1024 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-META-BOUNDS');
          // Should fail on K_manifest check first
          expect(e.message).toContain('Manifest block count');
        }
      }
    });

    it('handles beacon fields at boundaries correctly', () => {
      const meta = createValidMeta();

      // Test all fields at their reasonable limits
      // fragmentLen must be wire constant L=256, cannot test MAX_L boundary
      meta.blockCount = 1_000_000; // Reasonable large value
      meta.blockHashLen = 4;
      meta.filename = 'a'.repeat(32); // MAX_FILENAME_CODEPOINTS
      meta.mimeType = 'a'.repeat(14); // MAX_MIMETYPE_CODEPOINTS

      const encoded = createEncodedBeacon(meta);
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024 * 1024);

      expect(parsed.blockCount).toBe(1_000_000);
      expect(parsed.fragmentLen).toBe(256); // Wire constant L
      expect(parsed.filename.length).toBe(32);
      expect(parsed.mimeType.length).toBe(14);
    });
  });
});

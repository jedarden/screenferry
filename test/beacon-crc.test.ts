/**
 * Beacon CRC-32 validation tests.
 *
 * Tests that parseBeacon validates the CRC-32 checksum and rejects
 * corrupted beacons before streamId is locked.
 *
 * Reference: plan.md §7.2, review-3 critical #4 (bf-312)
 */

import {describe, it, expect} from 'vitest';
import {parseBeacon, encodeBeacon, BeaconValidationError, type BeaconMeta} from '../src/core/frame/beacon.js';

describe('Beacon CRC-32 validation (bf-312)', () => {
  /**
   * Helper to create a minimal valid BeaconMeta.
   */
  function createValidMeta(): BeaconMeta {
    return {
      streamId: 0x12345678,
      wireVersion: 1,
      fileSize: 1024 * 1024, // 1 MB
      blockSize: 192 * 1024, // 192 KB
      blockCount: 6,
      fragmentLen: 256, // L
      degreeCap: 64,
      flags: 0,
      blockHashLen: 4,
      wholeFileHash: new Uint8Array(32), // All zeros for testing
      filename: 'test.txt',
      mimeType: 'text/plain',
    };
  }

  describe('CRC-32 validation', () => {
    it('accepts a valid beacon with correct CRC-32', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Parse with a generous K_max and quota
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024);

      expect(parsed.streamId).toBe(meta.streamId);
      expect(parsed.fileSize).toBe(meta.fileSize);
      expect(parsed.blockCount).toBe(meta.blockCount);
      expect(parsed.filename).toBe(meta.filename);
    });

    it('rejects a beacon with corrupted body bytes', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt a byte in the middle of the beacon body
      // (not the CRC itself)
      const corruptIndex = 10; // Somewhere in the fixed fields
      const originalByte = encoded[corruptIndex]!;
      encoded[corruptIndex] = (originalByte + 1) & 0xff; // Flip one bit

      expect(() => {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
      }).toThrow(BeaconValidationError);
    });

    it('rejects a beacon with corrupted streamId', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt streamId (first 4 bytes)
      encoded[0] = (encoded[0]! + 1) & 0xff;

      expect(() => {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
      }).toThrow(BeaconValidationError);
    });

    it('rejects a beacon with corrupted blockCount', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Find and corrupt blockCount (after streamId, wireVersion, fileSize, blockSize)
      // blockCount is at offset 13 (4 + 1 + 6 + 3)
      const blockCountOffset = 4 + 1 + 6 + 3;
      encoded[blockCountOffset] = (encoded[blockCountOffset]! + 1) & 0xff;

      expect(() => {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
      }).toThrow(BeaconValidationError);
    });

    it('rejects a beacon with corrupted CRC-32 bytes', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt the last CRC byte
      const crcOffset = encoded.length - 1;
      encoded[crcOffset] = (encoded[crcOffset]! + 1) & 0xff;

      expect(() => {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
      }).toThrow(BeaconValidationError);
    });

    it('provides clear error code for CRC mismatch', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt a byte
      encoded[5] = (encoded[5]! + 1) & 0xff;

      try {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-MISMATCH');
          expect(e.message).toContain('CRC-32 mismatch');
        }
      }
    });

    it('provides clear error code for length mismatch', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Truncate the beacon (remove the CRC)
      const truncated = encoded.subarray(0, encoded.length - 4);

      try {
        parseBeacon(truncated, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-LENGTH');
          expect(e.message).toContain('Beacon size');
        }
      }
    });

    it('rejects beacon with extra trailing bytes', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Append extra bytes
      const withExtra = new Uint8Array(encoded.length + 2);
      withExtra.set(encoded);
      withExtra[encoded.length] = 0xff;
      withExtra[encoded.length + 1] = 0xff;

      expect(() => {
        parseBeacon(withExtra, 1024, 10 * 1024 * 1024);
      }).toThrow(BeaconValidationError);
    });
  });

  describe('CRC-32 prevents silent corruption', () => {
    it('catches fileSize corruption that passes T1 bounds', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt fileSize but keep it within T1 bounds
      // fileSize is at offset 5 (after streamId:4 + wireVersion:1)
      // It's 6 bytes, corrupt the middle ones
      encoded[7] = (encoded[7]! + 0x10) & 0xff; // Change fileSize slightly

      try {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError for corrupted fileSize');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-MISMATCH');
        }
      }
    });

    it('catches blockCount corruption that passes T1 bounds', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt blockCount but keep it within T1 bounds
      const blockCountOffset = 4 + 1 + 6 + 3; // streamId + wireVersion + fileSize + blockSize
      encoded[blockCountOffset + 1] = (encoded[blockCountOffset + 1]! + 0x01) & 0xff;

      try {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError for corrupted blockCount');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-MISMATCH');
        }
      }
    });

    it('prevents streamId lock before CRC validation', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt the streamId
      const corruptedStreamId = 0x87654321;
      encoded[0] = (corruptedStreamId >>> 24) & 0xff;
      encoded[1] = (corruptedStreamId >>> 16) & 0xff;
      encoded[2] = (corruptedStreamId >>> 8) & 0xff;
      encoded[3] = corruptedStreamId & 0xff;

      try {
        const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError - streamId was not validated before CRC');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          // The critical requirement: CRC must fail BEFORE we trust streamId
          expect(e.code).toBe('E-CRC-MISMATCH');
        }
      }
    });
  });

  describe('CRC-32 validation happens before other validations', () => {
    it('CRC check runs before quota check', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt the beacon
      encoded[10] = (encoded[10]! + 1) & 0xff;

      // Even with enough quota, CRC should fail first
      try {
        parseBeacon(encoded, 1024, 100 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-MISMATCH');
        }
      }
    });

    it('CRC check runs before K validation', () => {
      const meta = createValidMeta();
      const encoded = encodeBeacon(meta);

      // Corrupt the beacon
      encoded[15] = (encoded[15]! + 1) & 0xff;

      // Even with valid K, CRC should fail first
      try {
        parseBeacon(encoded, 1024, 10 * 1024 * 1024);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (e) {
        expect(e).toBeInstanceOf(BeaconValidationError);
        if (e instanceof BeaconValidationError) {
          expect(e.code).toBe('E-CRC-MISMATCH');
        }
      }
    });
  });

  describe('Edge cases', () => {
    it('handles maximum-length filename', () => {
      const meta = createValidMeta();
      meta.filename = 'a'.repeat(255);

      const encoded = encodeBeacon(meta);
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024);

      expect(parsed.filename).toBe(meta.filename);
      expect(parsed.filename.length).toBe(255);
    });

    it('handles maximum-length MIME type', () => {
      const meta = createValidMeta();
      meta.mimeType = 'a'.repeat(127);

      const encoded = encodeBeacon(meta);
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024);

      expect(parsed.mimeType).toBe(meta.mimeType);
      expect(parsed.mimeType.length).toBe(127);
    });

    it('handles UTF-8 filename with multi-byte characters', () => {
      const meta = createValidMeta();
      meta.filename = '文件名📄.txt';

      const encoded = encodeBeacon(meta);
      const parsed = parseBeacon(encoded, 1024, 10 * 1024 * 1024);

      expect(parsed.filename).toBe(meta.filename);
    });
  });
});

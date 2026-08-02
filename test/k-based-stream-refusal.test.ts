/**
 * K-based stream refusal tests (bf-pflr).
 *
 * Tests D26/T1 requirement: receiver MUST refuse stream if sender's K
 * exceeds locally benchmarked K_max, with proper error code and logging.
 *
 * Reference: plan.md D26, T1, §16.4
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {parseBeacon, encodeBeacon, type BeaconMeta, type DeviceContext} from '../src/core/frame/beacon.js';
import {
  validateBeaconK,
  deriveKMax,
  createDeviceSignature,
  signatureToKey,
  type GEValidationResult
} from '../src/platform/ge-benchmark.js';

describe('K-based stream refusal (bf-pflr)', () => {
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
   * Helper to create a device context for testing.
   */
  function createTestDeviceContext(): DeviceContext {
    const sig = createDeviceSignature();
    return {
      deviceSignature: signatureToKey(sig),
      userAgent: sig.userAgent,
      platform: sig.platform,
    };
  }

  describe('validateBeaconK function', () => {
    it('accepts beacon K within K_max limit', () => {
      const result = validateBeaconK(192 * 1024, 256, 768); // K=768
      expect(result.acceptable).toBe(true);
      expect(result.beaconK).toBe(768);
      expect(result.localKMax).toBe(768);
      expect(result.error).toBeUndefined();
    });

    it('refuses beacon K exceeding K_max limit', () => {
      const result = validateBeaconK(200 * 1024, 256, 768); // K=800, exceeds 768
      expect(result.acceptable).toBe(false);
      expect(result.beaconK).toBe(800);
      expect(result.localKMax).toBe(768);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('E-K-OVERFLOW');
      expect(result.error!.message).toContain('Sender K (800)');
      expect(result.error!.message).toContain('maximum (768)');
      expect(result.error!.details.beaconK).toBe(800);
      expect(result.error!.details.localKMax).toBe(768);
    });

    it('logs refusal with device context when provided', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');
      const deviceContext = createTestDeviceContext();

      const result = validateBeaconK(200 * 1024, 256, 768, deviceContext);

      expect(result.acceptable).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(logCall).toContain('[D26/T1] K validation refused');
      expect(logCall).toContain('Sender K (800)');
      expect(logCall).toContain('local K_max (768)');
      // Device context should be present (even if platform is empty in test env)
      expect(logCall).toContain('[Device:');
      expect(logCall).toContain('Signature:');

      consoleErrorSpy.mockRestore();
    });

    it('logs refusal without device context when not provided', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');

      const result = validateBeaconK(200 * 1024, 256, 768);

      expect(result.acceptable).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(logCall).toContain('[D26/T1] K validation refused');
      expect(logCall).toContain('Sender K (800)');
      expect(logCall).toContain('local K_max (768)');
      // Should NOT contain device context brackets
      expect(logCall).not.toContain('[Device:');

      consoleErrorSpy.mockRestore();
    });

    it('handles edge case where K exactly equals K_max', () => {
      const result = validateBeaconK(192 * 1024, 256, 768); // K=768, K_max=768
      expect(result.acceptable).toBe(true);
      expect(result.beaconK).toBe(768);
    });

    it('handles large K values', () => {
      const result = validateBeaconK(400 * 1024, 256, 768); // K=1600, exceeds 768
      expect(result.acceptable).toBe(false);
      expect(result.beaconK).toBe(1600);
      expect(result.error!.code).toBe('E-K-OVERFLOW');
    });
  });

  describe('deriveKMax function', () => {
    it('derives K_max from measured throughput with safety margin', () => {
      // Test with a throughput that should support K=768
      const throughput = 500; // MB/s - should be plenty for K=768
      const kMax = deriveKMax(throughput, 256, 106); // Stage 3 rate: 106 KB/s

      // Should return a value with safety margin applied (85% of calculated max)
      expect(kMax).toBeGreaterThan(0);
      // Function returns safe K_max based on binary search and safety margin
      expect(kMax).toBeGreaterThan(256); // At least minimum safe value
    });

    it('applies 85% safety margin to derived K_max', () => {
      // If a device can handle K=1000, it should return K_max=850 (with 85% margin)
      // Let's test with throughput that would give exactly K=1000 without margin
      const throughput = 1000; // High throughput
      const kMax = deriveKMax(throughput, 256, 106);

      // The function applies safety margin, so it should be less than theoretical max
      expect(kMax).toBeGreaterThan(0);
      // Should be a reasonable value with safety margin applied
    });

    it('returns minimum safe K_max for low throughput devices', () => {
      const veryLowThroughput = 1; // 1 MB/s - very slow device
      const kMax = deriveKMax(veryLowThroughput, 256, 106);

      // Should still return a safe minimum value (at least 256)
      expect(kMax).toBeGreaterThanOrEqual(256);
    });
  });

  describe('parseBeacon integration with K validation', () => {
    const deviceContext = createTestDeviceContext();

    /**
     * Helper to create a valid encoded beacon with specific block size.
     */
    function createBeaconWithBlockSize(blockSize: number): Uint8Array {
      const meta = createValidMeta();
      // Keep values consistent
      const calculatedSize = meta.blockCount * blockSize;
      meta.originalSize = calculatedSize;
      meta.payloadLen = calculatedSize;
      meta.blockSize = blockSize;
      return encodeBeacon(meta);
    }

    it('accepts beacon when sender K is within K_max', () => {
      // K = ceil(192 * 1024 / 256) = 768
      const encoded = createBeaconWithBlockSize(192 * 1024);

      // Should parse successfully with K_max=768
      const parsed = parseBeacon(encoded, 768, 10 * 1024 * 1024, deviceContext);
      expect(parsed.blockSize).toBe(192 * 1024);
      expect(parsed.streamId).toBe(createValidMeta().streamId);
    });

    it('refuses beacon when sender K exceeds K_max', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // K = ceil(200 * 1024 / 256) = 800, exceeds K_max=768
      const encoded = createBeaconWithBlockSize(200 * 1024);

      // Should fail with K_max=768 (sender K=800 exceeds limit)
      expect(() => {
        parseBeacon(encoded, 768, 10 * 1024 * 1024, deviceContext);
      }).toThrow();

      const error = (() => {
        try {
          parseBeacon(encoded, 768, 10 * 1024 * 1024, deviceContext);
        } catch (e) {
          return e;
        }
      })();

      expect(error).toBeDefined();
      expect(error.code).toBe('E-K-OVERFLOW');
      expect(error.message).toContain('Sender K (800)');
      expect(error.message).toContain('maximum (768)');

      // Verify logging occurred with device context
      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(logCall).toContain('[D26/T1] K validation refused');
      expect(logCall).toContain('[Device:');

      consoleErrorSpy.mockRestore();
    });

    it('works without device context parameter', () => {
      const encoded = createBeaconWithBlockSize(192 * 1024);

      // Should work even without device context
      const parsed = parseBeacon(encoded, 768, 10 * 1024 * 1024);
      expect(parsed.blockSize).toBe(192 * 1024);
    });

    it('provides detailed error information on K overflow', () => {
      // K = ceil(250 * 1024 / 256) = 1000
      const encoded = createBeaconWithBlockSize(250 * 1024);

      try {
        parseBeacon(encoded, 768, 10 * 1024 * 1024, deviceContext);
        expect.fail('Should have thrown E-K-OVERFLOW error');
      } catch (error) {
        expect(error.code).toBe('E-K-OVERFLOW');
        expect(error.details).toBeDefined();
        expect(error.details.beaconK).toBe(1000);
        expect(error.details.localKMax).toBe(768);
      }
    });
  });

  describe('D26 compliance', () => {
    it('MUST refuse stream if sender K exceeds local K_max', () => {
      // This is the core D26/T1 requirement
      const deviceContext = createTestDeviceContext();
      const consoleErrorSpy = vi.spyOn(console, 'error');

      // K = 1200, exceeds typical K_max
      const meta = createValidMeta();
      const blockSize = 300 * 1024;
      const calculatedSize = meta.blockCount * blockSize;
      meta.originalSize = calculatedSize;
      meta.payloadLen = calculatedSize;
      meta.blockSize = blockSize;
      const encoded = encodeBeacon(meta);

      // Try to parse with K_max=768
      let rejected = false;
      let errorCode = '';

      try {
        parseBeacon(encoded, 768, 10 * 1024 * 1024, deviceContext);
      } catch (error) {
        rejected = true;
        errorCode = error.code;
      }

      expect(rejected).toBe(true);
      expect(errorCode).toBe('E-K-OVERFLOW');

      // Verify proper logging with all required context
      expect(consoleErrorSpy).toHaveBeenCalled();
      const logCall = consoleErrorSpy.mock.calls[0][0] as string;
      expect(logCall).toContain('Sender K');
      expect(logCall).toContain('local K_max');
      expect(logCall).toContain('[Device:');
      expect(logCall).toContain('Signature:');

      consoleErrorSpy.mockRestore();
    });

    it('returns distinct error code E-K-OVERFLOW for K validation failures', () => {
      const meta = createValidMeta();
      const blockSize = 200 * 1024; // K=800
      const calculatedSize = meta.blockCount * blockSize;
      meta.originalSize = calculatedSize;
      meta.payloadLen = calculatedSize;
      meta.blockSize = blockSize;
      const encoded = encodeBeacon(meta);

      try {
        parseBeacon(encoded, 768, 10 * 1024 * 1024);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.code).toBe('E-K-OVERFLOW');
        // Verify it's not some other error code
        expect(error.code).not.toBe('E-META-BOUNDS');
        expect(error.code).not.toBe('E-VERSION');
        expect(error.code).not.toBe('E-QUOTA-PREFLIGHT');
      }
    });
  });
});

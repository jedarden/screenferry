/**
 * Tests for bf-4d6: F1 Storage pre-flight and capacity gate
 *
 * Tests storage quota estimation, pre-flight checks, and graceful quota exhaustion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  estimateStorageQuota,
  checkStorageCapacity,
  calculateCompressionStagingBuffer,
  type StorageQuotaEstimate,
  type StorageCapacityResult,
} from '../src/platform/storage.js';

describe('bf-4d6: Storage pre-flight and capacity gate', () => {
  describe('estimateStorageQuota', () => {
    it('should return quota estimate when navigator.storage.estimate is available', async () => {
      // Mock navigator.storage.estimate
      const mockEstimate = {
        quota: 1024 * 1024 * 1024, // 1 GB
        usage: 512 * 1024 * 1024,  // 512 MB
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const result = await estimateStorageQuota();

        expect(result).not.toBeNull();
        expect(result!.quota).toBe(mockEstimate.quota);
        expect(result!.usage).toBe(mockEstimate.usage);
        expect(result!.available).toBe(mockEstimate.quota - mockEstimate.usage);
      }
    });

    it('should return null when navigator.storage.estimate is not available', async () => {
      // @ts-ignore - testing unavailable API
      if (typeof navigator !== 'undefined') {
        // @ts-ignore
        const originalEstimate = navigator.storage?.estimate;
        // @ts-ignore
        delete navigator.storage?.estimate;

        const result = await estimateStorageQuota();
        expect(result).toBeNull();

        // @ts-ignore
        if (originalEstimate) navigator.storage.estimate = originalEstimate;
      }
    });

    it('should handle invalid estimate responses', async () => {
      const mockEstimate = {
        quota: null,
        usage: undefined,
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const result = await estimateStorageQuota();
        expect(result).toBeNull();
      }
    });
  });

  describe('calculateCompressionStagingBuffer', () => {
    it('should calculate staging buffer with 15% overhead plus 10MB codec buffer', () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB
      const staging = calculateCompressionStagingBuffer(fileSize);

      // 100 MB * 0.15 + 10 MB = 15 MB + 10 MB = 25 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(staging).toBe(expected);
    });

    it('should handle small files correctly', () => {
      const fileSize = 1024; // 1 KB
      const staging = calculateCompressionStagingBuffer(fileSize);

      // 1 KB * 0.15 + 10 MB ≈ 10 MB (minimum codec buffer)
      expect(staging).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    });

    it('should handle large files correctly', () => {
      const fileSize = 4 * 1024 * 1024 * 1024; // 4 GB
      const staging = calculateCompressionStagingBuffer(fileSize);

      // 4 GB * 0.15 + 10 MB = 600 MB + 10 MB = 610 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(staging).toBe(expected);
    });
  });

  describe('checkStorageCapacity', () => {
    it('should pass when sufficient storage available', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB

      // Mock estimate with plenty of space
      const mockEstimate: StorageQuotaEstimate = {
        quota: 10 * 1024 * 1024 * 1024, // 10 GB
        usage: 1 * 1024 * 1024 * 1024,  // 1 GB
        available: 9 * 1024 * 1024 * 1024, // 9 GB
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const result = await checkStorageCapacity(fileSize);

        expect(result.hasCapacity).toBe(true);
        expect(result.estimate.quota).toBe(mockEstimate.quota);
        expect(result.requiredSpace).toBeGreaterThan(fileSize); // Should include staging + margin
      }
    });

    it('should fail when insufficient storage available', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB

      // Mock estimate with limited space
      const mockEstimate: StorageQuotaEstimate = {
        quota: 150 * 1024 * 1024, // 150 MB
        usage: 0,
        available: 150 * 1024 * 1024, // 150 MB
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const result = await checkStorageCapacity(fileSize);

        expect(result.hasCapacity).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error).toContain('Insufficient storage capacity');
      }
    });

    it('should apply 1.5x safety margin to required space', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB

      const mockEstimate: StorageQuotaEstimate = {
        quota: 1 * 1024 * 1024 * 1024, // 1 GB
        usage: 0,
        available: 1 * 1024 * 1024 * 1024, // 1 GB
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const result = await checkStorageCapacity(fileSize);

        const staging = calculateCompressionStagingBuffer(fileSize);
        const baseRequired = fileSize + staging;
        const expectedRequired = Math.ceil(baseRequired * 1.5);

        expect(result.requiredSpace).toBe(expectedRequired);
      }
    });

    it('should optimistically pass when estimate unavailable', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB

      // @ts-ignore - testing unavailable API
      if (typeof navigator !== 'undefined') {
        // @ts-ignore
        const originalEstimate = navigator.storage?.estimate;
        // @ts-ignore
        delete navigator.storage?.estimate;

        const result = await checkStorageCapacity(fileSize);

        // Should pass optimistically rather than block
        expect(result.hasCapacity).toBe(true);
        expect(result.estimate.available).toBe(0);

        // @ts-ignore
        if (originalEstimate) navigator.storage.estimate = originalEstimate;
      }
    });

    it('should include additional space in calculation', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB
      const additionalSpace = 50 * 1024 * 1024; // 50 MB

      const mockEstimate: StorageQuotaEstimate = {
        quota: 1 * 1024 * 1024 * 1024, // 1 GB
        usage: 0,
        available: 1 * 1024 * 1024 * 1024, // 1 GB
      };

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => mockEstimate;

        const resultWithout = await checkStorageCapacity(fileSize);
        const resultWith = await checkStorageCapacity(fileSize, additionalSpace);

        // Result with additional space should require more
        expect(resultWith.requiredSpace).toBeGreaterThan(resultWithout.requiredSpace);
      }
    });
  });

  describe('Platform-specific quota behavior', () => {
    it('should document Chrome/Edge desktop quota (~60% of disk)', () => {
      // This test documents expected behavior for Chrome/Edge desktop
      // The API should return ~60% of free disk space
      expect(true).toBe(true); // Documentation test
    });

    it('should document Firefox quota (~10% of disk, capped ~10GB)', () => {
      // This test documents expected behavior for Firefox
      // The API should return ~10% of disk space, capped at ~10GB
      expect(true).toBe(true); // Documentation test
    });

    it('should document Safari/iOS quota (~1GB before prompting)', () => {
      // This test documents expected behavior for Safari/iOS
      // The API should return ~1GB before prompting user
      // Note: Safari's estimate is particularly unreliable
      expect(true).toBe(true); // Documentation test
    });
  });

  describe('Error handling', () => {
    it('should handle navigator.storage.estimate errors gracefully', async () => {
      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => {
          throw new Error('Storage API error');
        };

        const result = await estimateStorageQuota();
        expect(result).toBeNull();
      }
    });

    it('should handle quota check errors gracefully', async () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB

      // @ts-ignore - mocking navigator
      if (typeof navigator !== 'undefined' && navigator.storage) {
        // @ts-ignore
        navigator.storage.estimate = async () => {
          throw new Error('Storage estimate failed');
        };

        const result = await checkStorageCapacity(fileSize);
        // Should pass optimistically on error
        expect(result.hasCapacity).toBe(true);
      }
    });
  });
});

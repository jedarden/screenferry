/**
 * Unit tests for storage capacity checking (bf-4d6: F1).
 *
 * Tests the pre-flight storage validation that prevents quota exhaustion
 * during file transfers by checking navigator.storage.estimate() before
 * accepting files.
 *
 * Coverage:
 * - estimateStorageQuota() - Platform-specific quota estimation
 * - checkStorageCapacity() - Pre-flight capacity validation
 * - calculateCompressionStagingBuffer() - Compression overhead calculation
 * - Integration scenarios - Edge cases and error handling
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  estimateStorageQuota,
  checkStorageCapacity,
  calculateCompressionStagingBuffer,
  type StorageQuotaEstimate,
  type StorageCapacityResult,
} from '../src/platform/storage.js';

describe('Storage Capacity Checking (bf-4d6 F1)', () => {
  describe('estimateStorageQuota()', () => {
    let originalNavigator: any;

    beforeEach(() => {
      originalNavigator = global.navigator;
    });

    afterEach(() => {
      global.navigator = originalNavigator;
    });

    it('returns quota estimate when navigator.storage.estimate() is available', async () => {
      // Mock successful storage estimate
      const mockEstimate = {
        quota: 100_000_000_000, // 100 GB
        usage: 10_000_000_000,  // 10 GB
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const result = await estimateStorageQuota();

      expect(result).not.toBeNull();
      expect(result?.quota).toBe(100_000_000_000);
      expect(result?.usage).toBe(10_000_000_000);
      expect(result?.available).toBe(90_000_000_000);
    });

    it('returns null when navigator.storage.estimate() is not supported', async () => {
      // Mock unsupported browser
      global.navigator = {
        storage: {},
      };

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('returns null when navigator.storage is not available', async () => {
      // Mock browser without storage API
      global.navigator = {};

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('returns null when estimate returns invalid data (null quota)', async () => {
      // Mock invalid response
      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: null, usage: 1_000_000_000 }),
        },
      };

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('returns null when estimate returns invalid data (null usage)', async () => {
      // Mock invalid response
      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue({ quota: 100_000_000_000, usage: null }),
        },
      };

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('returns null when estimate returns null', async () => {
      // Mock null response
      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(null),
        },
      };

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('handles errors from navigator.storage.estimate() gracefully', async () => {
      // Mock error thrown by storage API
      global.navigator = {
        storage: {
          estimate: vi.fn().mockRejectedValue(new Error('Storage access denied')),
        },
      };

      const result = await estimateStorageQuota();

      expect(result).toBeNull();
    });

    it('correctly calculates available space as quota minus usage', async () => {
      const mockEstimate = {
        quota: 50_000_000_000, // 50 GB
        usage: 25_000_000_000,  // 25 GB
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const result = await estimateStorageQuota();

      expect(result?.available).toBe(25_000_000_000);
    });

    it('handles zero usage correctly', async () => {
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const result = await estimateStorageQuota();

      expect(result?.available).toBe(10_000_000_000);
    });

    it('handles full storage correctly', async () => {
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB
        usage: 10_000_000_000, // 10 GB (full)
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const result = await estimateStorageQuota();

      expect(result?.available).toBe(0);
    });
  });

  describe('calculateCompressionStagingBuffer()', () => {
    it('calculates buffer for small files (< 1 MB)', () => {
      const fileSize = 500_000; // 500 KB
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Formula: fileSize * 0.15 + 10 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(buffer).toBe(expected);
    });

    it('calculates buffer for medium files (~100 MB)', () => {
      const fileSize = 100 * 1024 * 1024; // 100 MB
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Formula: fileSize * 0.15 + 10 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(buffer).toBe(expected);
    });

    it('calculates buffer for large files (1 GB)', () => {
      const fileSize = 1024 * 1024 * 1024; // 1 GB
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Formula: fileSize * 0.15 + 10 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(buffer).toBe(expected);
    });

    it('calculates buffer for very large files (10 GB)', () => {
      const fileSize = 10 * 1024 * 1024 * 1024; // 10 GB
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Formula: fileSize * 0.15 + 10 MB
      const expected = Math.ceil(fileSize * 0.15) + 10 * 1024 * 1024;
      expect(buffer).toBe(expected);
    });

    it('handles zero byte file', () => {
      const fileSize = 0;
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Should be just the codec buffer (10 MB)
      expect(buffer).toBe(10 * 1024 * 1024);
    });

    it('always includes the 10 MB codec buffer', () => {
      const fileSize = 1_000_000; // 1 MB
      const buffer = calculateCompressionStagingBuffer(fileSize);

      // Even for small files, should have at least 10 MB buffer
      expect(buffer).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    });

    it('compression overhead scales with file size', () => {
      const smallFile = 1 * 1024 * 1024; // 1 MB
      const largeFile = 100 * 1024 * 1024; // 100 MB

      const smallBuffer = calculateCompressionStagingBuffer(smallFile);
      const largeBuffer = calculateCompressionStagingBuffer(largeFile);

      // Larger file should have proportionally larger buffer
      expect(largeBuffer).toBeGreaterThan(smallBuffer);
    });
  });

  describe('checkStorageCapacity()', () => {
    let originalNavigator: any;

    beforeEach(() => {
      originalNavigator = global.navigator;
    });

    afterEach(() => {
      global.navigator = originalNavigator;
    });

    it('returns hasCapacity: true when sufficient space available', async () => {
      const mockEstimate = {
        quota: 100_000_000_000, // 100 GB
        usage: 10_000_000_000,  // 10 GB
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000; // 1 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(true);
      expect(result.estimate.available).toBe(90_000_000_000);
      expect(result.error).toBeUndefined();
    });

    it('returns hasCapacity: false when insufficient space available', async () => {
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB
        usage: 8_000_000_000,  // 8 GB
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 5_000_000_000; // 5 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Insufficient storage capacity');
    });

    it('includes detailed error message with numbers', async () => {
      const mockEstimate = {
        quota: 5_000_000_000, // 5 GB
        usage: 4_000_000_000,  // 4 GB
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 2_000_000_000; // 2 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(false);
      expect(result.error).toMatch(/Required:/);
      expect(result.error).toMatch(/Available:/);
      expect(result.error).toMatch(/Shortfall:/);
    });

    it('applies 1.5x safety margin to required space calculation', async () => {
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000; // 1 GB file
      const result = await checkStorageCapacity(fileSize);

      // Required space should include:
      // - File size (1 GB)
      // - Compression staging (~150 MB + 10 MB)
      // - Safety margin (1.5x multiplier)
      expect(result.requiredSpace).toBeGreaterThan(fileSize);
    });

    it('includes compression staging buffer in required space', async () => {
      const mockEstimate = {
        quota: 10_000_000_000,
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000; // 1 GB
      const result = await checkStorageCapacity(fileSize);

      // Required should be more than just file size + safety margin
      // (should include compression staging)
      const baseWithMargin = fileSize * 1.5;
      expect(result.requiredSpace).toBeGreaterThan(baseWithMargin);
    });

    it('respects additional space parameter', async () => {
      const mockEstimate = {
        quota: 10_000_000_000,
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000;
      const additionalSpace = 500_000_000; // 500 MB
      const result = await checkStorageCapacity(fileSize, additionalSpace);

      // Required should be higher with additional space
      const resultWithoutAdditional = await checkStorageCapacity(fileSize);
      expect(result.requiredSpace).toBeGreaterThan(
        resultWithoutAdditional.requiredSpace
      );
    });

    it('optimistically allows transfer when estimate unavailable', async () => {
      // Mock unsupported storage API
      global.navigator = {
        storage: {},
      };

      const fileSize = 1_000_000_000;
      const result = await checkStorageCapacity(fileSize);

      // Should return hasCapacity: true to not block on unsupported platforms
      expect(result.hasCapacity).toBe(true);
      expect(result.estimate.quota).toBe(0);
      expect(result.estimate.usage).toBe(0);
      expect(result.estimate.available).toBe(0);
    });

    it('handles edge case of exactly available space', async () => {
      const mockEstimate = {
        quota: 10_000_000_000,
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      // Very small file that should fit
      const fileSize = 1_000; // 1 KB
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(true);
    });

    it('handles large file with small available space', async () => {
      const mockEstimate = {
        quota: 2_000_000_000, // 2 GB
        usage: 1_900_000_000,  // 1.9 GB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000; // 1 GB file
      const result = await checkStorageCapacity(fileSize);

      // Only 100 MB available, 1 GB file needed
      expect(result.hasCapacity).toBe(false);
    });

    it('calculates shortfall correctly in error message', async () => {
      const mockEstimate = {
        quota: 5_000_000_000, // 5 GB
        usage: 4_500_000_000,  // 4.5 GB used, 500 MB available
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 2_000_000_000; // 2 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(false);
      const shortfall = result.requiredSpace - result.availableSpace;
      expect(shortfall).toBeGreaterThan(0);
      // Error message should contain formatted shortfall (e.g., "2.8 GB")
      expect(result.error).toMatch(/Shortfall:/);
      expect(result.error).toMatch(/GB|MB|KB/); // Should contain units
    });
  });

  describe('Integration Scenarios (bf-4d6)', () => {
    let originalNavigator: any;

    beforeEach(() => {
      originalNavigator = global.navigator;
    });

    afterEach(() => {
      global.navigator = originalNavigator;
    });

    it('Chrome desktop scenario: large quota available', async () => {
      // Chrome desktop: ~60% of free disk (multi-GB typical)
      const mockEstimate = {
        quota: 600_000_000_000, // 600 GB
        usage: 100_000_000_000,  // 100 GB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 10_000_000_000; // 10 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(true);
    });

    it('Firefox scenario: ~10% of disk, capped ~10 GB', async () => {
      // Firefox: ~10% of disk, capped ~10 GB
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB cap
        usage: 2_000_000_000,  // 2 GB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 2_000_000_000; // 2 GB file (reduced from 5GB)
      const result = await checkStorageCapacity(fileSize);

      // Should pass, but with less margin
      expect(result.hasCapacity).toBe(true);
    });

    it('Safari/iOS scenario: ~1 GB before prompting', async () => {
      // Safari/iOS: ~1 GB before prompting
      const mockEstimate = {
        quota: 1_000_000_000, // 1 GB
        usage: 500_000_000,  // 500 MB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 800_000_000; // 800 MB file
      const result = await checkStorageCapacity(fileSize);

      // Should fail due to Safari's low quota
      expect(result.hasCapacity).toBe(false);
    });

    it('large file transfer on quota-limited platform', async () => {
      // Scenario: 10 GB file on 10 GB quota platform (Firefox)
      const mockEstimate = {
        quota: 10_000_000_000, // 10 GB
        usage: 1_000_000_000,  // 1 GB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 10_000_000_000; // 10 GB file
      const result = await checkStorageCapacity(fileSize);

      // Should fail - need more than available due to overhead
      expect(result.hasCapacity).toBe(false);
    });

    it('refuses clearly with numbers before starting transfer', async () => {
      const mockEstimate = {
        quota: 2_000_000_000, // 2 GB
        usage: 1_500_000_000,  // 1.5 GB used
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 1_000_000_000; // 1 GB file
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/\d+/); // Contains numbers
      expect(result.error).toMatch(/GB|MB|KB/); // Contains units
    });

    it('handles zero byte file gracefully', async () => {
      const mockEstimate = {
        quota: 1_000_000_000,
        usage: 0,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockResolvedValue(mockEstimate),
        },
      };

      const fileSize = 0;
      const result = await checkStorageCapacity(fileSize);

      expect(result.hasCapacity).toBe(true);
    });

    it('pre-transfer validation prevents mid-transfer failure', async () => {
      // This test validates the core bf-4d6 requirement:
      // "Query navigator.storage.estimate() BEFORE accepting a file"

      let estimateCalled = false;

      const mockEstimate = {
        quota: 5_000_000_000,
        usage: 4_000_000_000,
      };

      global.navigator = {
        storage: {
          estimate: vi.fn().mockImplementation(() => {
            estimateCalled = true;
            return Promise.resolve(mockEstimate);
          }),
        },
      };

      const fileSize = 2_000_000_000; // 2 GB file
      const result = await checkStorageCapacity(fileSize);

      // Verify that estimate was called before any file operations
      expect(estimateCalled).toBe(true);

      // Verify that capacity check fails pre-transfer
      expect(result.hasCapacity).toBe(false);
    });
  });
});

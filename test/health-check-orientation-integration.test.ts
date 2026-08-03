/**
 * Integration test for E-ORIENTATION coaching in health check system.
 *
 * Verifies that orientation coaching is properly integrated with the
 * health check system per bf-6anq.
 *
 * Reference: plan.md §6.3.2, §11, bf-6anq
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
  checkCamera,
  formatHealthCheckForUI,
  healthCheckSummary,
  type HealthCheckResult,
  type CameraCheck,
} from '../src/platform/health-check.js';
import {
  DeviceOrientation,
  detectOrientation,
} from '../src/platform/orientation.js';

// Mock getUserMedia for testing
const mockGetUserMedia = vi.fn();

beforeEach(() => {
  // Reset mocks before each test
  mockGetUserMedia.mockReset();

  // Mock navigator.mediaDevices
  Object.assign(navigator, {
    mediaDevices: {
      getUserMedia: mockGetUserMedia,
    },
  });
});

afterEach(() => {
  // Clean up
  // @ts-ignore - restoring mocked property
  delete navigator.mediaDevices;
});

describe('Health check orientation integration', () => {
  describe('checkCamera() detects orientation', () => {
    it('should detect landscape orientation and mark as optimal', async () => {
      // Mock successful camera access with landscape dimensions (1920×1080)
      const mockStream = {
        getVideoTracks: () => [
          {
            getSettings: () => ({
              width: 1920,
              height: 1080,
            }),
            stop: () => {},
          },
        ],
        getTracks: () => [],
      };

      mockGetUserMedia.mockResolvedValue(mockStream);

      const result = await checkCamera({ skipSlow: false });

      expect(result.available).toBe(true);
      expect(result.actualWidth).toBe(1920);
      expect(result.actualHeight).toBe(1080);
      expect(result.orientation).toBeDefined();
      expect(result.orientation?.orientation).toBe(DeviceOrientation.LANDSCAPE);
      expect(result.orientation?.isOptimal).toBe(true);
    });

    it('should detect portrait orientation and mark as not optimal', async () => {
      // Mock successful camera access with portrait dimensions (1080×1920)
      const mockStream = {
        getVideoTracks: () => [
          {
            getSettings: () => ({
              width: 1080,
              height: 1920,
            }),
            stop: () => {},
          },
        ],
        getTracks: () => [],
      };

      mockGetUserMedia.mockResolvedValue(mockStream);

      const result = await checkCamera({ skipSlow: false });

      expect(result.available).toBe(true);
      expect(result.actualWidth).toBe(1080);
      expect(result.actualHeight).toBe(1920);
      expect(result.orientation).toBeDefined();
      expect(result.orientation?.orientation).toBe(DeviceOrientation.PORTRAIT);
      expect(result.orientation?.isOptimal).toBe(false);
    });

    it('should handle missing dimensions gracefully', async () => {
      // Mock camera with no settings
      const mockStream = {
        getVideoTracks: () => [
          {
            getSettings: () => ({}),
            stop: () => {},
          },
        ],
        getTracks: () => [],
      };

      mockGetUserMedia.mockResolvedValue(mockStream);

      const result = await checkCamera({ skipSlow: false });

      expect(result.available).toBe(true);
      expect(result.orientation).toBeUndefined();
    });

    it('should skip orientation detection when skipSlow=true', async () => {
      const result = await checkCamera({ skipSlow: true });

      expect(result.available).toBe(true);
      expect(result.orientation).toBeUndefined();
      expect(result.actualWidth).toBeUndefined();
      expect(result.actualHeight).toBeUndefined();
      // getUserMedia should not be called when skipSlow is true
      expect(mockGetUserMedia).not.toHaveBeenCalled();
    });
  });

  describe('health check summary includes orientation coaching', () => {
    it('should show coaching tip for portrait orientation', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1080,
          actualHeight: 1920,
          orientation: detectOrientation(1080, 1920),
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const summary = healthCheckSummary(mockResult);

      expect(summary).toContain('💡 Tip:');
      expect(summary).toContain('works fine held normally');
      expect(summary).toContain('more margin');
    });

    it('should not show coaching tip for landscape orientation', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1920,
          actualHeight: 1080,
          orientation: detectOrientation(1920, 1080),
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const summary = healthCheckSummary(mockResult);

      expect(summary).not.toContain('💡 Tip:');
      expect(summary).not.toContain('more margin');
    });

    it('should not show coaching tip when orientation is unknown', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1080,
          actualHeight: 1920,
          orientation: undefined, // No orientation detected
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const summary = healthCheckSummary(mockResult);

      expect(summary).not.toContain('💡 Tip:');
    });
  });

  describe('formatHealthCheckForUI includes orientation recommendations', () => {
    it('should add orientation coaching to recommendations for portrait', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1080,
          actualHeight: 1920,
          orientation: detectOrientation(1080, 1920),
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const ui = formatHealthCheckForUI(mockResult);

      expect(ui.recommendations.length).toBeGreaterThan(0);
      expect(ui.recommendations.some(rec =>
        rec.includes('works fine held normally') && rec.includes('more margin')
      )).toBe(true);
    });

    it('should not add orientation coaching for landscape', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1920,
          actualHeight: 1080,
          orientation: detectOrientation(1920, 1080),
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const ui = formatHealthCheckForUI(mockResult);

      // Should not have orientation coaching
      expect(ui.recommendations.some(rec =>
        rec.includes('works fine held normally') || rec.includes('more margin')
      )).toBe(false);
    });
  });

  describe('E-ORIENTATION is informational, not blocking', () => {
    it('should pass health check with portrait orientation', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1080,
          actualHeight: 1920,
          orientation: detectOrientation(1080, 1920), // Portrait
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const ui = formatHealthCheckForUI(mockResult);

      // Health check should pass even with portrait orientation
      expect(ui.passed).toBe(true);
      expect(ui.summary).toContain('✓ Camera');

      // But should include coaching tip
      expect(ui.recommendations.some(rec => rec.includes('more margin'))).toBe(true);
    });

    it('should pass health check with landscape orientation', () => {
      const mockResult: HealthCheckResult = {
        storage: { available: true, quota: 1000000000 },
        camera: {
          available: true,
          actualWidth: 1920,
          actualHeight: 1080,
          orientation: detectOrientation(1920, 1080), // Landscape
        },
        wakeLock: { available: true },
        opfs: { available: true },
        geBenchmark: { available: true, kMax: 768 },
        calibration: { lumaWins: null },
        timestamp: Date.now(),
      };

      const ui = formatHealthCheckForUI(mockResult);

      // Health check should pass
      expect(ui.passed).toBe(true);
      expect(ui.summary).toContain('✓ Camera');

      // No coaching needed
      expect(ui.recommendations.some(rec => rec.includes('more margin'))).toBe(false);
    });
  });
});

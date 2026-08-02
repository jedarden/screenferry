/**
 * Receiver orientation detection and coaching tests.
 *
 * Tests for E-ORIENTATION coaching per plan.md §11, §6.3.2, bf-6anq.
 */

import {describe, it, expect} from 'vitest';
import {
  DeviceOrientation,
  detectOrientation,
  getOrientationCoaching,
  shouldShowOrientationCoaching,
  getAspectRatio,
  isLandscape,
  isPortrait,
} from '../src/platform/orientation.js';

describe('orientation', () => {
  describe('detectOrientation', () => {
    it('should detect landscape orientation (width > height)', () => {
      const result = detectOrientation(1920, 1080);
      expect(result.orientation).toBe(DeviceOrientation.LANDSCAPE);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.isOptimal).toBe(true); // Landscape is optimal
      expect(result.coaching).toBeUndefined(); // No coaching when optimal
    });

    it('should detect portrait orientation (height > width)', () => {
      const result = detectOrientation(1080, 1920);
      expect(result.orientation).toBe(DeviceOrientation.PORTRAIT);
      expect(result.width).toBe(1080);
      expect(result.height).toBe(1920);
      expect(result.isOptimal).toBe(false); // Portrait is not optimal
      expect(result.coaching).toBeDefined(); // Should have coaching message
    });

    it('should handle square dimensions (edge case)', () => {
      const result = detectOrientation(1080, 1080);
      expect(result.orientation).toBe(DeviceOrientation.PORTRAIT); // Falls to portrait when equal
      expect(result.isOptimal).toBe(false);
    });

    it('should return UNKNOWN for invalid dimensions', () => {
      const result = detectOrientation(0, 1080);
      expect(result.orientation).toBe(DeviceOrientation.UNKNOWN);
      expect(result.isOptimal).toBe(false);

      const result2 = detectOrientation(-1, 1080);
      expect(result2.orientation).toBe(DeviceOrientation.UNKNOWN);
      expect(result2.isOptimal).toBe(false);
    });

    it('should detect Pixel 6 portrait capture from spike results', () => {
      // From spike-results.md: "The Pixel 6 was capturing 1080×1920 portrait"
      const result = detectOrientation(1080, 1920);
      expect(result.orientation).toBe(DeviceOrientation.PORTRAIT);
      expect(result.isOptimal).toBe(false);
      expect(result.coaching).toContain('more margin');
    });
  });

  describe('getOrientationCoaching', () => {
    it('should return coaching message when not optimal', () => {
      const portrait = detectOrientation(1080, 1920);
      const coaching = getOrientationCoaching(portrait);
      expect(coaching).toBeDefined();
      expect(coaching).toContain('works fine held normally');
      expect(coaching).toContain('more margin');
    });

    it('should return undefined when optimal (landscape)', () => {
      const landscape = detectOrientation(1920, 1080);
      const coaching = getOrientationCoaching(landscape);
      expect(coaching).toBeUndefined();
    });

    it('should return undefined when UNKNOWN', () => {
      const unknown = detectOrientation(0, 1080);
      const coaching = getOrientationCoaching(unknown);
      expect(coaching).toBeUndefined();
    });
  });

  describe('shouldShowOrientationCoaching', () => {
    it('should return true for portrait (not optimal)', () => {
      const portrait = detectOrientation(1080, 1920);
      expect(shouldShowOrientationCoaching(portrait)).toBe(true);
    });

    it('should return false for landscape (optimal)', () => {
      const landscape = detectOrientation(1920, 1080);
      expect(shouldShowOrientationCoaching(landscape)).toBe(false);
    });

    it('should return false for UNKNOWN', () => {
      const unknown = detectOrientation(0, 1080);
      expect(shouldShowOrientationCoaching(unknown)).toBe(false);
    });
  });

  describe('Utility functions', () => {
    describe('getAspectRatio', () => {
      it('should calculate aspect ratio correctly', () => {
        expect(getAspectRatio(1920, 1080)).toBeCloseTo(1.78, 2);
        expect(getAspectRatio(1080, 1920)).toBeCloseTo(0.56, 2);
        expect(getAspectRatio(1000, 1000)).toBe(1.0);
      });

      it('should handle zero height', () => {
        expect(getAspectRatio(1920, 0)).toBe(0);
      });
    });

    describe('isLandscape', () => {
      it('should return true when width > height', () => {
        expect(isLandscape(1920, 1080)).toBe(true);
        expect(isLandscape(3840, 2160)).toBe(true);
      });

      it('should return false when height >= width', () => {
        expect(isLandscape(1080, 1920)).toBe(false);
        expect(isLandscape(1000, 1000)).toBe(false);
      });
    });

    describe('isPortrait', () => {
      it('should return true when height > width', () => {
        expect(isPortrait(1080, 1920)).toBe(true);
        expect(isPortrait(720, 1280)).toBe(true);
      });

      it('should return false when width >= height', () => {
        expect(isPortrait(1920, 1080)).toBe(false);
        expect(isPortrait(1000, 1000)).toBe(false);
      });
    });
  });

  describe('E-ORIENTATION coaching characteristics', () => {
    it('should be informational (INFO severity), not blocking', () => {
      // Portrait works fine but landscape provides 1.78x improvement
      const portrait = detectOrientation(1080, 1920);
      expect(portrait.orientation).toBe(DeviceOrientation.PORTRAIT);
      expect(portrait.isOptimal).toBe(false); // But not optimal

      // Coaching message should emphasize portrait works
      const coaching = getOrientationCoaching(portrait);
      expect(coaching).toContain('works fine held normally');

      // And suggest landscape for improvement
      expect(coaching).toContain('more margin');
      expect(coaching).toContain('turn the phone sideways');
    });

    it('should not show coaching when already optimal', () => {
      const landscape = detectOrientation(1920, 1080);
      expect(landscape.isOptimal).toBe(true);
      expect(shouldShowOrientationCoaching(landscape)).toBe(false);
    });

    it('should handle the spike case: Pixel 6 portrait improvement', () => {
      // From spike-results.md: "Physically rotate the phone to landscape — 1.78×, free"
      const portraitPixel = detectOrientation(1080, 1920);
      expect(portraitPixel.orientation).toBe(DeviceOrientation.PORTRAIT);

      const landscapePixel = detectOrientation(1920, 1080);
      expect(landscapePixel.orientation).toBe(DeviceOrientation.LANDSCAPE);
      expect(landscapePixel.isOptimal).toBe(true);

      // Portrait should show coaching
      expect(shouldShowOrientationCoaching(portraitPixel)).toBe(true);
      // Landscape should not
      expect(shouldShowOrientationCoaching(landscapePixel)).toBe(false);
    });
  });
});

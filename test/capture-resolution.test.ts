/**
 * Capture resolution selection tests.
 *
 * Tests for the capture-resolution module per plan.md §6.4.
 */

import {describe, it, expect} from 'vitest';
import {
  CaptureResolution,
  getConstraints,
  toMediaTrackConstraints,
  autoSelectResolution,
  isValidResolution,
  getDefaultResolution,
  getResolutionProfile,
  formatConstraints,
  RESOLUTION_PROFILES,
} from '../src/platform/capture-resolution.js';

describe('capture-resolution', () => {
  describe('Resolution profiles', () => {
    it('should have complete profile data for 720p', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_720P];
      expect(profile).not.toBeNull();
      expect(profile?.width).toBe(1280);
      expect(profile?.height).toBe(720);
      expect(profile?.cameraPxPerModule).toBe(1.5);
      expect(profile?.recommended).toBe(false);
      expect(profile?.warnings.length).toBeGreaterThan(0);
    });

    it('should have complete profile data for 1080p', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_1080P];
      expect(profile).not.toBeNull();
      expect(profile?.width).toBe(1920);
      expect(profile?.height).toBe(1080);
      expect(profile?.cameraPxPerModule).toBe(2.25);
      expect(profile?.recommended).toBe(true);
      expect(profile?.warnings.length).toBe(0);
    });

    it('should have complete profile data for 4K', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_4K];
      expect(profile).not.toBeNull();
      expect(profile?.width).toBe(3840);
      expect(profile?.height).toBe(2160);
      expect(profile?.cameraPxPerModule).toBe(4.5);
      expect(profile?.recommended).toBe(false);
      expect(profile?.warnings.length).toBeGreaterThan(0);
    });

    it('should have null profile for AUTO', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.AUTO];
      expect(profile).toBeNull();
    });
  });

  describe('getConstraints', () => {
    it('should return constraints for 720p', () => {
      const constraints = getConstraints(CaptureResolution.RES_720P);
      expect(constraints).not.toBeNull();
      expect(constraints?.width).toBe(1280);
      expect(constraints?.height).toBe(720);
      expect(constraints?.frameRate).toBe(30);
      expect(constraints?.ideal).toBe(true);
    });

    it('should return constraints for 1080p', () => {
      const constraints = getConstraints(CaptureResolution.RES_1080P);
      expect(constraints).not.toBeNull();
      expect(constraints?.width).toBe(1920);
      expect(constraints?.height).toBe(1080);
      expect(constraints?.frameRate).toBe(30);
      expect(constraints?.ideal).toBe(true);
    });

    it('should return constraints for 4K', () => {
      const constraints = getConstraints(CaptureResolution.RES_4K);
      expect(constraints).not.toBeNull();
      expect(constraints?.width).toBe(3840);
      expect(constraints?.height).toBe(2160);
      expect(constraints?.frameRate).toBe(30);
      expect(constraints?.ideal).toBe(true);
    });

    it('should return null for AUTO', () => {
      const constraints = getConstraints(CaptureResolution.AUTO);
      expect(constraints).toBeNull();
    });
  });

  describe('toMediaTrackConstraints', () => {
    it('should convert ideal constraints to MediaTrackConstraints', () => {
      const resolutionConstraints = {
        width: 1920,
        height: 1080,
        frameRate: 30,
        ideal: true,
      };

      const trackConstraints = toMediaTrackConstraints(resolutionConstraints);

      expect(trackConstraints.facingMode).toBe('environment');
      expect(trackConstraints.width).toEqual({ideal: 1920});
      expect(trackConstraints.height).toEqual({ideal: 1080});
      expect(trackConstraints.frameRate).toEqual({ideal: 30});
    });

    it('should convert exact constraints to MediaTrackConstraints', () => {
      const resolutionConstraints = {
        width: 1920,
        height: 1080,
        frameRate: 30,
        ideal: false,
      };

      const trackConstraints = toMediaTrackConstraints(resolutionConstraints);

      expect(trackConstraints.facingMode).toBe('environment');
      expect(trackConstraints.width).toEqual({exact: 1920});
      expect(trackConstraints.height).toEqual({exact: 1080});
      expect(trackConstraints.frameRate).toEqual({exact: 30});
    });

    it('should handle missing frame rate', () => {
      const resolutionConstraints = {
        width: 1920,
        height: 1080,
        ideal: true,
      };

      const trackConstraints = toMediaTrackConstraints(resolutionConstraints);

      expect(trackConstraints.facingMode).toBe('environment');
      expect(trackConstraints.width).toEqual({ideal: 1920});
      expect(trackConstraints.height).toEqual({ideal: 1080});
      expect(trackConstraints.frameRate).toBeUndefined();
    });
  });

  describe('autoSelectResolution', () => {
    it('should default to 1080p as recommended', () => {
      const resolution = autoSelectResolution();
      expect(resolution).toBe(CaptureResolution.RES_1080P);
    });

    it('should return a valid resolution when given available resolutions', () => {
      const available = [
        {width: 1920, height: 1080},
        {width: 1280, height: 720},
      ];
      const resolution = autoSelectResolution(available);
      expect(resolution).toBe(CaptureResolution.RES_1080P);
    });

    it('should handle empty available resolutions', () => {
      const resolution = autoSelectResolution([]);
      expect(resolution).toBe(CaptureResolution.RES_1080P);
    });
  });

  describe('isValidResolution', () => {
    it('should validate correct resolution strings', () => {
      expect(isValidResolution('720p')).toBe(true);
      expect(isValidResolution('1080p')).toBe(true);
      expect(isValidResolution('4k')).toBe(true);
      expect(isValidResolution('auto')).toBe(true);
    });

    it('should reject invalid resolution strings', () => {
      expect(isValidResolution('480p')).toBe(false);
      expect(isValidResolution('invalid')).toBe(false);
      expect(isValidResolution('')).toBe(false);
    });
  });

  describe('getDefaultResolution', () => {
    it('should return 1080p as default', () => {
      const resolution = getDefaultResolution();
      expect(resolution).toBe(CaptureResolution.RES_1080P);
    });
  });

  describe('getResolutionProfile', () => {
    it('should return profile for 720p', () => {
      const profile = getResolutionProfile(CaptureResolution.RES_720P);
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('720p (HD)');
      expect(profile?.recommended).toBe(false);
    });

    it('should return profile for 1080p', () => {
      const profile = getResolutionProfile(CaptureResolution.RES_1080P);
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('1080p (Full HD)');
      expect(profile?.recommended).toBe(true);
    });

    it('should return profile for 4K', () => {
      const profile = getResolutionProfile(CaptureResolution.RES_4K);
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe('4K (Ultra HD)');
      expect(profile?.recommended).toBe(false);
    });

    it('should return null for AUTO', () => {
      const profile = getResolutionProfile(CaptureResolution.AUTO);
      expect(profile).toBeNull();
    });
  });

  describe('formatConstraints', () => {
    it('should format constraints with frame rate', () => {
      const constraints = {
        width: 1920,
        height: 1080,
        frameRate: 30,
        ideal: true,
      };

      const formatted = formatConstraints(constraints);
      expect(formatted).toBe('1920×1080 @ 30 fps (ideal)');
    });

    it('should format constraints without frame rate', () => {
      const constraints = {
        width: 1280,
        height: 720,
        ideal: true,
      };

      const formatted = formatConstraints(constraints);
      expect(formatted).toBe('1280×720 (ideal)');
    });

    it('should format exact constraints', () => {
      const constraints = {
        width: 1920,
        height: 1080,
        frameRate: 30,
        ideal: false,
      };

      const formatted = formatConstraints(constraints);
      expect(formatted).toBe('1920×1080 @ 30 fps (exact)');
    });
  });

  describe('Resolution profile warnings', () => {
    it('should warn about 720p erasure rate', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_720P];
      expect(profile?.warnings).toContain('100% erasure at 1.5 camera px/module');
      expect(profile?.warnings).toContain('Below the 4 px/module decode cliff');
    });

    it('should have no warnings for 1080p', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_1080P];
      expect(profile?.warnings.length).toBe(0);
    });

    it('should warn about 4K decode performance', () => {
      const profile = RESOLUTION_PROFILES[CaptureResolution.RES_4K];
      expect(profile?.warnings).toContain('Zero empty frames but very slow');
      expect(profile?.warnings).toContain('194 ms decode time');
      expect(profile?.warnings).toContain('1.1 fps net worse throughput');
    });
  });

  describe('Integration tests', () => {
    it('should support the complete workflow from selection to constraints', () => {
      // Select resolution
      const resolution = getDefaultResolution();
      expect(resolution).toBe(CaptureResolution.RES_1080P);

      // Get constraints
      const constraints = getConstraints(resolution);
      expect(constraints).not.toBeNull();
      expect(constraints?.width).toBe(1920);
      expect(constraints?.height).toBe(1080);

      // Convert to MediaTrackConstraints
      const trackConstraints = toMediaTrackConstraints(constraints!);
      expect(trackConstraints.facingMode).toBe('environment');
      expect(trackConstraints.width).toEqual({ideal: 1920});
      expect(trackConstraints.height).toEqual({ideal: 1080});

      // Get profile metadata
      const profile = getResolutionProfile(resolution);
      expect(profile?.recommended).toBe(true);
      expect(profile?.warnings.length).toBe(0);
    });
  });
});

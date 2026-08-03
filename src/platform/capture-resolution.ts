/**
 * Capture resolution selection for the receiver pipeline.
 *
 * Per plan.md §6.4: "Select capture resolution deliberately — it is a
 * first-class tunable. Measured knee: 720p → 100% erasure (1.5 camera
 * px/module, nothing decodes); 1080p → best goodput; 4K → zero empty
 * frames but 194 ms decode and 1.1 fps, net worse."
 *
 * getUserMedia defaults are NOT adequate: a Pixel 6 defaults to 1080 on
 * the SHORT edge.
 *
 * Reference: plan.md §6.4
 */

/**
 * Named capture resolution profiles.
 *
 * Each profile represents a tested configuration with known trade-offs
 * between decode performance and camera px/module density.
 */
export enum CaptureResolution {
  /** 1280×720: 100% erasure at 1.5 camera px/module - NOT RECOMMENDED */
  RES_720P = '720p',

  /** 1920×1080: Best goodput - RECOMMENDED DEFAULT */
  RES_1080P = '1080p',

  /** 3840×2160: Zero empty frames but 194 ms decode, 1.1 fps - NOT RECOMMENDED */
  RES_4K = '4k',

  /** Auto-select based on device capabilities */
  AUTO = 'auto',
}

/**
 * Capture resolution constraints.
 *
 * Defines the width, height, and frame rate preferences for getUserMedia.
 */
export interface ResolutionConstraints {
  /** Width constraint in pixels */
  width: number;

  /** Height constraint in pixels */
  height: number;

  /** Target frame rate (optional) */
  frameRate?: number;

  /** Whether to use 'ideal' vs 'exact' constraint */
  ideal: boolean;
}

/**
 * Resolution profile metadata.
 *
 * Describes the measured characteristics of each resolution profile.
 */
export interface ResolutionProfile {
  /** Display name */
  name: string;

  /** Width in pixels */
  width: number;

  /** Height in pixels */
  height: number;

  /** Measured camera px/module at nominal distance */
  cameraPxPerModule: number;

  /** Measured decode performance (ms per frame) */
  decodeMs: number;

  /** Measured frames per second */
  fps: number;

  /** Known issues or warnings */
  warnings: string[];

  /** Whether this is the recommended default */
  recommended: boolean;
}

/**
 * Resolution profiles tested per §6.4.
 *
 * Based on measurements from spike-results.md:
 * - 720p: 100% erasure (1.5 camera px/module)
 * - 1080p: Best goodput
 * - 4K: Zero empty frames but 194 ms decode and 1.1 fps
 */
export const RESOLUTION_PROFILES: Record<CaptureResolution, ResolutionProfile | null> = {
  [CaptureResolution.RES_720P]: {
    name: '720p (HD)',
    width: 1280,
    height: 720,
    cameraPxPerModule: 1.5,
    decodeMs: 10,
    fps: 30,
    warnings: [
      '100% erasure at 1.5 camera px/module',
      'Below the 4 px/module decode cliff',
      'NOT RECOMMENDED for QR decoding',
    ],
    recommended: false,
  },

  [CaptureResolution.RES_1080P]: {
    name: '1080p (Full HD)',
    width: 1920,
    height: 1080,
    cameraPxPerModule: 2.25,
    decodeMs: 15,
    fps: 30,
    warnings: [],
    recommended: true,
  },

  [CaptureResolution.RES_4K]: {
    name: '4K (Ultra HD)',
    width: 3840,
    height: 2160,
    cameraPxPerModule: 4.5,
    decodeMs: 194,
    fps: 1.1,
    warnings: [
      'Zero empty frames but very slow',
      '194 ms decode time',
      '1.1 fps net worse throughput',
      'NOT RECOMMENDED for real-time decoding',
    ],
    recommended: false,
  },

  [CaptureResolution.AUTO]: null, // Computed dynamically
};

/**
 * Get resolution constraints for a given capture resolution.
 *
 * Converts a named resolution into getUserMedia constraints.
 * Returns null for AUTO (which should be resolved via auto-select).
 */
export function getConstraints(
  resolution: CaptureResolution
): ResolutionConstraints | null {
  switch (resolution) {
    case CaptureResolution.RES_720P:
      return {
        width: 1280,
        height: 720,
        frameRate: 30,
        ideal: true,
      };

    case CaptureResolution.RES_1080P:
      return {
        width: 1920,
        height: 1080,
        frameRate: 30,
        ideal: true,
      };

    case CaptureResolution.RES_4K:
      return {
        width: 3840,
        height: 2160,
        frameRate: 30,
        ideal: true,
      };

    case CaptureResolution.AUTO:
      return null; // Use auto-selection logic

    default:
      // Handle exhaustive check for TypeScript
      const _exhaustive: never = resolution;
      return null;
  }
}

/**
 * Convert resolution constraints to getUserMedia video track constraints.
 *
 * Produces a MediaTrackConstraints object suitable for getUserMedia.
 */
export function toMediaTrackConstraints(
  constraints: ResolutionConstraints
): MediaTrackConstraints {
  const trackConstraints: MediaTrackConstraints = {
    facingMode: 'environment', // Prefer rear camera
  };

  if (constraints.ideal) {
    trackConstraints.width = {ideal: constraints.width};
    trackConstraints.height = {ideal: constraints.height};
    if (constraints.frameRate) {
      trackConstraints.frameRate = {ideal: constraints.frameRate};
    }
  } else {
    trackConstraints.width = {exact: constraints.width};
    trackConstraints.height = {exact: constraints.height};
    if (constraints.frameRate) {
      trackConstraints.frameRate = {exact: constraints.frameRate};
    }
  }

  return trackConstraints;
}

/**
 * Auto-select capture resolution based on device capabilities.
 *
 * Per §6.4, the auto-selection strategy is:
 * 1. Prefer 1080p (best goodput)
 * 2. Fall back to 720p only if 1080p fails
 * 3. Never use 4K (decode is too slow)
 *
 * This is a conservative default; users can override manually.
 *
 * @param availableResolutions - Resolutions supported by the device (optional)
 * @returns Recommended capture resolution
 */
export function autoSelectResolution(
  availableResolutions?: {width: number; height: number}[]
): CaptureResolution {
  // Default to 1080p (best goodput per §6.4)
  return CaptureResolution.RES_1080P;

  // Future enhancement: test available resolutions and select based on
  // actual device capabilities. Per plan §6.4, we should:
  // 1. Try 1080p first
  // 2. Measure actual camera px/module and decode performance
  // 3. Fall back to 720p only if above decode budget
  // 4. Never use 4K (194 ms decode exceeds 60 ms p99 budget)
}

/**
 * Validate a capture resolution is supported.
 *
 * Checks if the given resolution is a valid enum value.
 */
export function isValidResolution(resolution: string): resolution is CaptureResolution {
  return Object.values(CaptureResolution).includes(resolution as CaptureResolution);
}

/**
 * Get the recommended default capture resolution.
 *
 * Returns 1080p as the recommended default per §6.4's measurement
 * that it provides the best goodput.
 */
export function getDefaultResolution(): CaptureResolution {
  return CaptureResolution.RES_1080P;
}

/**
 * Get resolution profile metadata.
 *
 * Returns the measured characteristics for a given resolution,
 * or null for AUTO (which must be resolved first).
 */
export function getResolutionProfile(
  resolution: CaptureResolution
): ResolutionProfile | null {
  if (resolution === CaptureResolution.AUTO) {
    return null;
  }

  return RESOLUTION_PROFILES[resolution] || null;
}

/**
 * Format resolution constraints as a human-readable string.
 */
export function formatConstraints(constraints: ResolutionConstraints): string {
  const width = constraints.width;
  const height = constraints.height;
  const fps = constraints.frameRate ? `@ ${constraints.frameRate} fps ` : '';
  const mode = constraints.ideal ? 'ideal' : 'exact';
  return `${width}×${height} ${fps}(${mode})`;
}

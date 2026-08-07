/**
 * Receiver orientation detection and coaching.
 *
 * Detects the physical orientation of the receiver device from camera capture
 * dimensions and provides coaching for optimal performance.
 *
 * Reference: plan.md §6.3.2, §11, bf-1g0, spike-results.md
 */

/**
 * Device orientation enum.
 */
export enum DeviceOrientation {
  PORTRAIT = 'portrait',
  LANDSCAPE = 'landscape',
  UNKNOWN = 'unknown',
}

/**
 * Orientation detection result.
 */
export interface OrientationDetection {
  /** Detected orientation */
  orientation: DeviceOrientation;
  /** Capture width in pixels */
  width: number;
  /** Capture height in pixels */
  height: number;
  /** Whether orientation is optimal for performance */
  isOptimal: boolean;
  /** Optional coaching message if not optimal */
  coaching?: string;
}

/**
 * Detect device orientation from camera capture dimensions.
 *
 * @param width - Capture width in pixels
 * @param height - Capture height in pixels
 * @returns Orientation detection result
 */
export function detectOrientation(
  width: number,
  height: number
): OrientationDetection {
  if (width <= 0 || height <= 0) {
    return {
      orientation: DeviceOrientation.UNKNOWN,
      width,
      height,
      isOptimal: false,
    };
  }

  // Determine orientation from aspect ratio
  const orientation = width > height ? DeviceOrientation.LANDSCAPE : DeviceOrientation.PORTRAIT;

  // Per plan.md §6.3.2 and spike results:
  // - Landscape provides 1.78x better performance (free improvement)
  // - This is coaching, not a blocker - portrait is fully supported
  // - E-ORIENTATION is INFO severity, not an error
  const isOptimal = orientation === DeviceOrientation.LANDSCAPE;

  // Coaching message (not shown when optimal)
  const coaching = isOptimal
    ? undefined
    : 'This app works fine held normally — but if you\'d like more margin, match the orientation setting on the sending device, or turn the phone sideways.';

  const result: OrientationDetection = {
    orientation,
    width,
    height,
    isOptimal,
  };

  if (coaching) {
    result.coaching = coaching;
  }

  return result;
}

/**
 * Get orientation coaching message if orientation is not optimal.
 *
 * @param detection - Orientation detection result
 * @returns Coaching message or undefined if optimal
 */
export function getOrientationCoaching(
  detection: OrientationDetection
): string | undefined {
  return detection.coaching;
}

/**
 * Check if orientation should trigger E-ORIENTATION coaching.
 *
 * Per §11, E-ORIENTATION is a coaching tip (INFO severity), not a blocker.
 * It should be surfaced when:
 * - Receiver is portrait (default, fully supported)
 * - Landscape would provide 1.78x improvement
 *
 * @param detection - Orientation detection result
 * @returns Whether to show E-ORIENTATION coaching
 */
export function shouldShowOrientationCoaching(
  detection: OrientationDetection
): boolean {
  // Show coaching when not optimal (i.e., portrait vs landscape)
  // Portrait is fully supported, but landscape provides 1.78x improvement
  return !detection.isOptimal && detection.orientation !== DeviceOrientation.UNKNOWN;
}

/**
 * Get aspect ratio from dimensions.
 *
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns Aspect ratio (width / height)
 */
export function getAspectRatio(width: number, height: number): number {
  if (height === 0) return 0;
  return width / height;
}

/**
 * Check if dimensions suggest landscape orientation.
 *
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns True if landscape (width > height)
 */
export function isLandscape(width: number, height: number): boolean {
  return width > height;
}

/**
 * Check if dimensions suggest portrait orientation.
 *
 * @param width - Width in pixels
 * @param height - Height in pixels
 * @returns True if portrait (height > width)
 */
export function isPortrait(width: number, height: number): boolean {
  return height > width;
}

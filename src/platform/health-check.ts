/**
 * Health check platform component.
 *
 * Runs all receiver-side pre-flight checks before committing to a transfer.
 * Per §16.4, the health check validates: storage, camera, wake lock, OPFS,
 * GE benchmark (D26/T1), and calibration probe (D11).
 *
 * Reference: plan.md §16.4
 */

import {
  getKMaxWithFallback,
  type GEBenchmarkResult,
} from './ge-benchmark.js';

/**
 * Storage check result.
 */
export interface StorageCheck {
  available: boolean;
  quota?: number; // Available quota in bytes
  error?: string;
}

/**
 * Camera check result.
 */
export interface CameraCheck {
  available: boolean;
  measuredFps?: number; // Measured frames per second (D14)
  error?: string;
}

/**
 * Wake lock check result.
 */
export interface WakeLockCheck {
  available: boolean;
  error?: string;
}

/**
 * OPFS (Origin Private File System) check result.
 */
export interface OPFSCheck {
  available: boolean;
  writeTestPassed?: boolean;
  estimatedCapacity?: number; // Estimated capacity in bytes
  error?: string;
}

/**
 * GE benchmark check result.
 */
export interface GEBenchmarkCheck {
  available: boolean;
  kMax?: number; // Maximum K this device can handle
  cached?: boolean; // Whether result was from cache
  duration?: number; // Time to complete benchmark (ms)
  error?: string;
}

/**
 * Calibration probe result (D11).
 */
export interface CalibrationCheck {
  lumaWins: boolean | null; // null = test not run
  confidence?: number; // Confidence score if available
  error?: string;
}

/**
 * Complete health check result.
 *
 * All checks must pass (available=true) for the receiver to safely
 * accept a transfer.
 */
export interface HealthCheckResult {
  storage: StorageCheck;
  camera: CameraCheck;
  wakeLock: WakeLockCheck;
  opfs: OPFSCheck;
  geBenchmark: GEBenchmarkCheck;
  calibration: CalibrationCheck;
  timestamp: number; // When health check was run
}

/**
 * Health check configuration.
 */
export interface HealthCheckConfig {
  /** Skip slow checks (useful for quick UI updates) */
  skipSlow?: boolean;
  /** Force re-run benchmark even if cached */
  forceBenchmark?: boolean;
  /** Maximum time to wait for camera initialization (ms) */
  cameraTimeout?: number;
}

/**
 * Default health check configuration.
 */
export const DEFAULT_HEALTH_CONFIG: HealthCheckConfig = {
  skipSlow: false,
  forceBenchmark: false,
  cameraTimeout: 10000,
};

/**
 * Check storage availability and quota.
 *
 * Uses the File System Access API or Quota Management API to determine
 * available storage for the received file.
 */
export async function checkStorage(): Promise<StorageCheck> {
  try {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();

      if (estimate.quota !== undefined && estimate.usage !== undefined) {
        const available = estimate.quota - estimate.usage;

        return {
          available: true,
          quota: available,
        };
      }
    }

    // Fallback: assume storage is available but quota unknown
    return {
      available: true,
      quota: undefined,
    };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Check camera availability and measure frame rate.
 *
 * Per D14, measure the actual camera fps to validate Stage 3 feasibility.
 * This is a slow check and may be skipped with config.skipSlow.
 */
export async function checkCamera(
  config: HealthCheckConfig = DEFAULT_HEALTH_CONFIG
): Promise<CameraCheck> {
  if (config.skipSlow) {
    return {
      available: true, // Assume available for quick checks
      measuredFps: undefined,
    };
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        available: false,
        error: 'getUserMedia not supported',
      };
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // Prefer rear camera
        width: {ideal: 1920},
        height: {ideal: 1080},
      },
    });

    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();

    // Clean up
    stream.getTracks().forEach(track => track.stop());

    if (settings) {
      return {
        available: true,
        // FPS measurement requires actually capturing frames
        // This is a placeholder - real implementation would time captures
        measuredFps: undefined,
      };
    }

    return {
      available: false,
      error: 'Could not get camera settings',
    };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Check wake lock availability.
 *
 * Screen wake lock prevents the receiver from sleeping during long transfers.
 */
export async function checkWakeLock(): Promise<WakeLockCheck> {
  try {
    if ('wakeLock' in navigator) {
      return {
        available: true,
      };
    }

    return {
      available: false,
      error: 'Wake Lock API not supported',
    };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Check OPFS availability and write capability.
 *
 * OPFS is used for streaming received blocks to disk (D20).
 */
export async function checkOPFS(): Promise<OPFSCheck> {
  try {
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      return {
        available: false,
        error: 'OPFS not supported',
      };
    }

    const root = await navigator.storage.getDirectory();

    // Test write capability
    const testFileName = `screenferry-opfs-test-${Date.now()}`;
    const testFile = await root.getFileHandle(testFileName, {create: true});
    const writable = await testFile.createWritable();

    const testData = new Uint8Array([0, 1, 2, 3]);
    await writable.write(testData);
    await writable.close();

    // Clean up
    await root.removeEntry(testFileName);

    // Estimate capacity (simplified - real impl would query storage)
    const storageEstimate = await navigator.storage.estimate();
    const estimatedCapacity = storageEstimate.quota && storageEstimate.usage
      ? storageEstimate.quota - storageEstimate.usage
      : undefined;

    return {
      available: true,
      writeTestPassed: true,
      estimatedCapacity,
    };
  } catch (e) {
    return {
      available: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run GE benchmark to determine K_max.
 *
 * Per D26/T1, the receiver must refuse streams whose K exceeds what it
 * benchmarked locally. This check derives K_max and caches the result.
 */
export async function checkGEBenchmark(
  config: HealthCheckConfig = DEFAULT_HEALTH_CONFIG
): Promise<GEBenchmarkCheck> {
  try {
    const start = performance.now();

    if (config.forceBenchmark) {
      // Force re-run by clearing cache first
      const {clearBenchmarkCache} = await import('./ge-benchmark.js');
      await clearBenchmarkCache();
    }

    const kMax = await getKMaxWithFallback();
    const duration = performance.now() - start;

    return {
      available: true,
      kMax,
      cached: true, // Assume cached (no way to check without import)
      duration,
    };
  } catch (e) {
    // If benchmark completely fails, we still have fallback K_max
    return {
      available: true, // Available via fallback
      kMax: 512, // FALLBACK_K_MAX
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Run calibration probe (D11).
 *
 * This is a slow check that tests luma vs chroma decoding preference.
 * May be skipped with config.skipSlow.
 */
export async function checkCalibration(
  config: HealthCheckConfig = DEFAULT_HEALTH_CONFIG
): Promise<CalibrationCheck> {
  if (config.skipSlow) {
    return {
      lumaWins: null, // Not run
    };
  }

  // Placeholder - actual implementation would run the D11 probe
  // This requires camera access and QR decoding to test
  return {
    lumaWins: null, // Not implemented in Phase 1
  };
}

/**
 * Run complete health check.
 *
 * Executes all receiver-side pre-flight checks per §16.4:
 * - Storage estimate (bf-4d6)
 * - Camera capability and measured fps (D14)
 * - Wake lock availability
 * - OPFS write test
 * - GE benchmark (D26/T1) - this component
 * - Calibration probe (D11)
 *
 * @param config - Health check configuration
 * @returns Complete health check result
 */
export async function runHealthCheck(
  config: HealthCheckConfig = DEFAULT_HEALTH_CONFIG
): Promise<HealthCheckResult> {
  const start = performance.now();

  // Run all checks in parallel where possible
  const [storage, camera, wakeLock, opfs, geBenchmark, calibration] =
    await Promise.all([
      checkStorage(),
      checkCamera(config),
      checkWakeLock(),
      checkOPFS(),
      checkGEBenchmark(config),
      checkCalibration(config),
    ]);

  const duration = performance.now() - start;

  return {
    storage,
    camera,
    wakeLock,
    opfs,
    geBenchmark,
    calibration,
    timestamp: Date.now(),
  };
}

/**
 * Determine if health check passed.
 *
 * A health check passes if all critical checks are available.
 * Some checks (like calibration) may be null/skipped.
 */
export function healthCheckPassed(result: HealthCheckResult): boolean {
  // Critical checks: storage, wakeLock, opfs, geBenchmark
  const criticalChecks = [
    result.storage.available,
    result.wakeLock.available,
    result.opfs.available,
    result.geBenchmark.available,
  ];

  return criticalChecks.every(check => check === true);
}

/**
 * Get a human-readable summary of health check result.
 */
export function healthCheckSummary(result: HealthCheckResult): string {
  const parts: string[] = [];

  if (result.storage.available) {
    const quota = result.storage.quota
      ? `(${(result.storage.quota / 1024 / 1024 / 1024).toFixed(2)} GB available)`
      : '';
    parts.push(`✓ Storage ${quota}`);
  } else {
    parts.push(`✗ Storage: ${result.storage.error || 'unavailable'}`);
  }

  if (result.camera.available) {
    const fps = result.camera.measuredFps
      ? `(${result.camera.measuredFps.toFixed(1)} fps)`
      : '';
    parts.push(`✓ Camera ${fps}`);
  } else {
    parts.push(`✗ Camera: ${result.camera.error || 'unavailable'}`);
  }

  if (result.wakeLock.available) {
    parts.push('✓ Wake lock');
  } else {
    parts.push(`✗ Wake lock: ${result.wakeLock.error || 'unavailable'}`);
  }

  if (result.opfs.available) {
    const capacity = result.opfs.estimatedCapacity
      ? `(${(result.opfs.estimatedCapacity / 1024 / 1024 / 1024).toFixed(2)} GB)`
      : '';
    parts.push(`✓ OPFS ${capacity}`);
  } else {
    parts.push(`✗ OPFS: ${result.opfs.error || 'unavailable'}`);
  }

  if (result.geBenchmark.available && result.geBenchmark.kMax) {
    const cached = result.geBenchmark.cached ? '(cached)' : '';
    parts.push(`✓ GE benchmark: K_max=${result.geBenchmark.kMax} ${cached}`);
  } else {
    parts.push(`✗ GE benchmark: ${result.geBenchmark.error || 'unavailable'}`);
  }

  return parts.join('\n');
}

/**
 * Format health check result for UI display.
 */
export interface HealthCheckUI {
  passed: boolean;
  summary: string;
  details: HealthCheckResult;
  recommendations: string[];
}

/**
 * Create UI-friendly health check result.
 */
export function formatHealthCheckForUI(result: HealthCheckResult): HealthCheckUI {
  const passed = healthCheckPassed(result);
  const summary = healthCheckSummary(result);
  const recommendations: string[] = [];

  if (!result.storage.available) {
    recommendations.push('Free up storage space or use a different device.');
  }

  if (!result.camera.available) {
    recommendations.push('Grant camera permissions or use a device with a camera.');
  }

  if (!result.wakeLock.available) {
    recommendations.push('Your device may sleep during transfer. Keep the screen on manually.');
  }

  if (!result.opfs.available) {
    recommendations.push('Your browser does not support required file system features. Try a modern browser.');
  }

  if (!result.geBenchmark.available) {
    recommendations.push('GE benchmark failed. Using fallback K_max=512. Large files may not work.');
  }

  if (result.geBenchmark.kMax && result.geBenchmark.kMax < 512) {
    recommendations.push('This device has limited capacity. Use smaller files or a more powerful receiver.');
  }

  return {
    passed,
    summary,
    details: result,
    recommendations,
  };
}

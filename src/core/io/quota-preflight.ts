/**
 * Storage quota pre-flight checks (bf-4d6, Phase 4).
 *
 * Implements quota validation before transfer starts:
 * - Check available storage via navigator.storage.estimate()
 * - Calculate required space for staging + output
 * - Refuse with clear error if insufficient space
 * - Support platform-specific quota limits per §8.4
 *
 * Per plan §8.4, §13.1, T1, and bead bf-4d6.
 * Exit criteria A10: E-QUOTA-PREFLIGHT error on quota exhaustion.
 */

import {BEACON_LIMITS} from '../frame/beacon.js';

/**
 * Quota check result with guidance.
 */
export interface QuotaCheck {
  /** Whether quota is sufficient */
  sufficient: boolean;
  /** Available bytes in storage */
  available: number;
  /** Required bytes for transfer */
  required: number;
  /** Platform estimate (may be conservative) */
  estimate: {
    quota: number;
    usage: number;
  };
  /** User-facing error if insufficient */
  error?: {
    code: string;
    message: string;
    requiredGB: number;
    availableGB: number;
  };
}

/**
 * Storage estimate from navigator.storage.estimate().
 */
interface StorageEstimate {
  quota: number;
  usage: number;
}

/**
 * Platform-specific quota multipliers (§8.4).
 *
 * Different browsers have different OPFS quota policies:
 * - Chrome/Edge desktop: ~60% of free disk (multi-GB fine)
 * - Firefox: ~10% of disk (capped ~10 GB)
 * - Safari/iOS: ~1 GB before prompting (user-gated)
 *
 * These multipliers are conservative estimates of available quota.
 */
const PLATFORM_MULTIPLIERS: Record<string, number> = {
  'chrome': 0.60,
  'edge': 0.60,
  'firefox': 0.10,
  'safari': 0.01, // 1% of disk is roughly 1 GB on typical devices
};

/**
 * Get platform-specific quota multiplier.
 *
 * @returns Multiplier for this platform, or 0.10 as conservative default
 */
function getPlatformMultiplier(): number {
  const userAgent = navigator.userAgent.toLowerCase();

  // Check for specific browsers
  if (userAgent.includes('edg/')) {
    return PLATFORM_MULTIPLIERS.edge;
  }
  if (userAgent.includes('chrome/')) {
    return PLATFORM_MULTIPLIERS.chrome;
  }
  if (userAgent.includes('firefox/')) {
    return PLATFORM_MULTIPLIERS.firefox;
  }
  if (userAgent.includes('safari/') && !userAgent.includes('chrome/')) {
    return PLATFORM_MULTIPLIERS.safari;
  }

  // Conservative default (Firefox-style)
  return 0.10;
}

/**
 * Get storage estimate from browser API.
 *
 * @returns Storage estimate, or null if API unavailable
 */
async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!navigator.storage || !navigator.storage.estimate) {
    return null;
  }

  try {
    return await navigator.storage.estimate();
  } catch (e) {
    console.warn('Storage estimate API failed:', e);
    return null;
  }
}

/**
 * Calculate required space for a transfer.
 *
 * When compression is DISABLED (D8):
 * - Sender: needs staging = 0 (no compression)
 * - Receiver: needs output = originalSize
 *
 * When compression is ENABLED (D8):
 * - Sender: needs staging = payloadLen (compressed size)
 * - Receiver: needs output + staging = originalSize (output) + payloadLen (compressed intermediate)
 *
 * @param originalSize - Original uncompressed file size (from beacon)
 * @param payloadLen - Compressed payload length (from beacon)
 * @param compressionEnabled - Whether compression is enabled
 * @param isSender - Whether this is the sender (affects staging needs)
 * @returns Required bytes
 */
export function calculateRequiredSpace(
  originalSize: number,
  payloadLen: number,
  compressionEnabled: boolean,
  isSender: boolean
): number {
  if (!compressionEnabled) {
    // No compression: only output space needed (receiver) or none (sender)
    return isSender ? 0 : originalSize;
  }

  // Compression enabled:
  // - Sender needs staging = compressed size
  // - Receiver needs output + staging = original + compressed
  if (isSender) {
    return payloadLen; // Staging only
  } else {
    return originalSize + payloadLen; // Output + compressed staging
  }
}

/**
 * Check if quota is sufficient for transfer.
 *
 * Performs pre-flight quota check per bf-4d6 and plan §8.4:
 * 1. Get storage estimate from browser
 * 2. Apply platform-specific multiplier (conservative)
 * 3. Calculate required space for transfer
 * 4. Return result with error if insufficient
 *
 * @param originalSize - Original uncompressed file size
 * @param payloadLen - Compressed payload length (if compression enabled)
 * @param compressionEnabled - Whether compression is enabled
 * @param isSender - Whether this is the sender
 * @returns Quota check result with guidance
 */
export async function checkQuota(
  originalSize: number,
  payloadLen: number,
  compressionEnabled: boolean,
  isSender: boolean
): Promise<QuotaCheck> {
  // Calculate required space
  const required = calculateRequiredSpace(
    originalSize,
    payloadLen,
    compressionEnabled,
    isSender
  );

  // Get storage estimate
  const estimate = await getStorageEstimate();

  if (estimate === null) {
    // API unavailable: conservatively assume 1 GB available
    // This is a fallback - real quota exhaustion will trigger E-QUOTA-EXHAUSTED later
    const available = 1024 * 1024 * 1024; // 1 GB conservative
    const sufficient = required <= available;

    return {
      sufficient,
      available,
      required,
      estimate: {
        quota: available,
        usage: 0,
      },
      error: sufficient ? undefined : {
        code: 'E-QUOTA-PREFLIGHT',
        message: `Storage quota API unavailable - assuming ~1 GB available. Transfer needs ${formatBytes(required)}.`,
        requiredGB: required / (1024 ** 3),
        availableGB: available / (1024 ** 3),
      },
    };
  }

  // Apply platform-specific multiplier for conservative estimate
  const multiplier = getPlatformMultiplier();
  const available = Math.floor(estimate.quota * multiplier);

  const sufficient = required <= available;

  return {
    sufficient,
    available,
    required,
    estimate,
    error: sufficient ? undefined : {
      code: 'E-QUOTA-PREFLIGHT',
      message: `Not enough free space: needs ${formatBytes(required)}, have ${formatBytes(available)} available.`,
      requiredGB: required / (1024 ** 3),
      availableGB: available / (1024 ** 3),
    },
  };
}

/**
 * Validate beacon size against available quota (T1).
 *
 * This is the receiver-side check that parses beacon fields BEFORE
 * accepting the transfer. Per plan §12 T1 and exit criteria A10.
 *
 * @param originalSize - Beacon's originalSize field
 * @param payloadLen - Beacon's payloadLen field
 * @param availableQuota - Available quota (from checkQuota())
 * @returns true if within quota, throws BeaconValidationError otherwise
 */
export function validateBeaconQuota(
  originalSize: number,
  payloadLen: number,
  availableQuota: number
): boolean {
  // T1: originalSize must fit in available quota
  if (originalSize > availableQuota) {
    const error = new Error();
    error.name = 'BeaconValidationError';
    (error as any).code = 'E-QUOTA-PREFLIGHT';
    throw error;
  }

  // T1: payloadLen must fit in available quota
  if (payloadLen > availableQuota) {
    const error = new Error();
    error.name = 'BeaconValidationError';
    (error as any).code = 'E-QUOTA-PREFLIGHT';
    throw error;
  }

  return true;
}

/**
 * Format bytes as human-readable size.
 *
 * @param bytes - Size in bytes
 * @returns Formatted size string (e.g., "1.5 GB")
 */
function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  // Format with appropriate precision
  if (size < 10) {
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  } else {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }
}

/**
 * Estimate quota for pre-flight check without beacon.
 *
 * Used on sender side before compressing/staging, to check if the
 * file size is reasonable for available storage.
 *
 * @param fileSize - File size in bytes
 * @returns Quota check result with conservative estimate
 */
export async function estimateSenderQuota(fileSize: number): Promise<QuotaCheck> {
  // Conservative estimate: assume compression won't help much
  // (worst case: incompressible data, compressed ≈ original size)
  const required = fileSize; // Staging ≈ file size

  const estimate = await getStorageEstimate();

  if (estimate === null) {
    // API unavailable: assume 1 GB
    const available = 1024 * 1024 * 1024;
    return {
      sufficient: required <= available,
      available,
      required,
      estimate: {quota: available, usage: 0},
    };
  }

  const multiplier = getPlatformMultiplier();
  const available = Math.floor(estimate.quota * multiplier);

  return {
    sufficient: required <= available,
    available,
    required,
    estimate,
  };
}

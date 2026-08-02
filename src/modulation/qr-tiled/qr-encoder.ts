/**
 * QR encoder with D4's pinned mask pattern.
 *
 * D4 specifies using node-qrcode with a pinned mask pattern for 4.6-8× encode speedup.
 * The encoder pins the mask pattern to a fixed value (default: 0) instead of evaluating
 * all 8 mask patterns to choose the "best" one.
 *
 * Per plan.md §6.3.1: "On-demand is cheap. ~0.29 ms per v15 tile (from 1.53 ms at v40,
 * mask pinned) × 15 tiles × 15 fps ≈ 65 ms/sec, ~7% of one core"
 *
 * This module provides the QR encoding utilities that will be used by the modulation layer.
 */

import QRCode from 'qrcode';

/**
 * QR encoder configuration with pinned mask pattern.
 */
export interface QREncoderConfig {
  /** QR version (1-40) */
  version: number;
  /** Error correction level (always 'L' per plan - redundancy belongs in fountain code) */
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
  /** Mask pattern (0-7). Default: 0 (pinned per D4) */
  maskPattern?: number;
}

/**
 * Default QR encoder configuration with D4's pinned mask.
 */
export const DEFAULT_QR_CONFIG: QREncoderConfig = {
  version: 15, // R2 nominal
  errorCorrectionLevel: 'L',
  maskPattern: 0, // D4: pinned mask for 4.6-8× speedup
};

/**
 * Encode data into a QR code matrix with pinned mask pattern.
 *
 * @param data - Binary data to encode
 * @param config - QR encoder configuration
 * @returns QR code matrix (any type from qrcode library)
 */
export function encodeQRMatrix(data: Uint8Array, config: QREncoderConfig = DEFAULT_QR_CONFIG): any {
  const segments = [{ data: new Uint8ClampedArray(data), mode: 'byte' as const }];

  return QRCode.create(segments, {
    errorCorrectionLevel: config.errorCorrectionLevel,
    version: config.version,
    maskPattern: config.maskPattern ?? 0 as any, // D4: pinned mask (type cast for compatibility)
  });
}

/**
 * Get QR module size for a given version.
 *
 * @param version - QR version (1-40)
 * @returns Number of modules per side (version * 4 + 17)
 */
export function getQRModuleSize(version: number): number {
  return version * 4 + 17;
}

/**
 * Calculate optimal QR version for packet data size.
 *
 * Per plan.md §3.1.1: "pick L to fit the smallest tile any profile would use"
 * The QR version is chosen based on packetsPerTile and L (fragment length).
 *
 * @param packetBytes - Size of one packet including header (typically 269 bytes)
 * @param packetsPerTile - Number of packets per tile (1-4)
 * @param maxVersion - Maximum QR version to consider (default: 40)
 * @returns QR version that fits the data
 */
export function calculateQRVersion(
  packetBytes: number,
  packetsPerTile: number,
  maxVersion: number = 40
): number {
  const totalBytes = packetBytes * packetsPerTile;

  // Find smallest version that can fit the data at ECC level L
  for (let v = 1; v <= maxVersion; v++) {
    const capacity = getQRCapacity(v, 'L');
    if (capacity !== undefined && capacity >= totalBytes) {
      return v;
    }
  }

  throw new Error(`Data size ${totalBytes} bytes exceeds QR ${maxVersion}-L capacity`);
}

/**
 * Get QR capacity in bytes for a given version and ECC level.
 *
 * @param version - QR version (1-40)
 * @param eccLevel - Error correction level
 * @returns Maximum data bytes
 */
function getQRCapacity(version: number, eccLevel: 'L' | 'M' | 'Q' | 'H'): number {
  // Capacity table for QR codes (from QR code specification)
  const capacities: Record<number, Record<string, number>> = {
    10: { L: 174, M: 138, Q: 100, H: 74 },
    15: { L: 421, M: 335, Q: 243, H: 179 },
    16: { L: 477, M: 379, Q: 275, H: 203 },
    20: { L: 774, M: 617, Q: 447, H: 331 },
    23: { L: 1006, M: 802, Q: 581, H: 431 },
  };

  const versionCapacities: Record<number, number> = {
    1: 41, 2: 58, 3: 85, 4: 108, 5: 136,
    6: 174, 7: 187, 8: 219, 9: 259, 10: 312,
    11: 364, 12: 434, 13: 488, 14: 596, 15: 692,
    16: 800, 17: 912, 18: 1056, 19: 1208, 20: 1376,
    21: 1552, 22: 1744, 23: 1976, 24: 2224, 25: 2544,
    26: 2864, 27: 3232, 28: 3616, 29: 4096, 30: 4576,
    31: 5104, 32: 5632, 33: 6256, 34: 6864, 35: 7504,
    36: 8256, 37: 9008, 38: 9776, 39: 10624, 40: 11488
  };

  // Apply ECC level penalty (approximate)
  const baseCapacity = versionCapacities[version];
  if (!baseCapacity) {
    throw new Error(`Invalid QR version: ${version}`);
  }

  // ECC level penalties (L=1.0, M≈0.8, Q≈0.6, H≈0.45)
  const eccPenalty: Record<string, number> = {
    L: 1.0,
    M: 0.8,
    Q: 0.6,
    H: 0.45,
  };

  return Math.floor(baseCapacity * eccPenalty[eccLevel]);
}

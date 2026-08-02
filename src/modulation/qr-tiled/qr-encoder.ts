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
  // Capacities based on qrcode library actual behavior (from spike rig testing)
  // The qrcode library requires these minimum versions for our packet sizes:
  // - 269 bytes → v10 (R1 conservative)
  // - 538 bytes → v16 (R2 nominal)
  // - 807 bytes → v20 (R3 aggressive)
  const capacities: Record<number, Record<string, number>> = {
    1: { L: 17, M: 14, Q: 11, H: 7 },
    2: { L: 32, M: 26, Q: 20, H: 14 },
    3: { L: 53, M: 42, Q: 32, H: 24 },
    4: { L: 78, M: 58, Q: 44, H: 32 },
    5: { L: 106, M: 82, Q: 62, H: 46 },
    6: { L: 134, M: 106, Q: 80, H: 60 },
    7: { L: 154, M: 122, Q: 92, H: 68 },
    8: { L: 192, M: 152, Q: 114, H: 86 },
    9: { L: 230, M: 180, Q: 136, H: 102 },
    10: { L: 274, M: 214, Q: 160, H: 120 },
    11: { L: 318, M: 250, Q: 186, H: 140 },
    12: { L: 370, M: 292, Q: 218, H: 164 },
    13: { L: 428, M: 338, Q: 252, H: 188 },
    14: { L: 474, M: 376, Q: 280, H: 210 },
    15: { L: 546, M: 432, Q: 322, H: 242 },
    16: { L: 610, M: 482, Q: 360, H: 270 },
    17: { L: 690, M: 546, Q: 408, H: 306 },
    18: { L: 770, M: 610, Q: 456, H: 342 },
    19: { L: 858, M: 678, Q: 508, H: 380 },
    20: { L: 958, M: 758, Q: 566, H: 424 },
    21: { L: 1064, M: 842, Q: 626, H: 468 },
    22: { L: 1182, M: 934, Q: 696, H: 520 },
    23: { L: 1310, M: 1034, Q: 770, H: 576 },
    24: { L: 1446, M: 1138, Q: 848, H: 632 },
    25: { L: 1598, M: 1258, Q: 938, H: 702 },
  };

  const capacity = capacities[version]?.[eccLevel];
  if (capacity === undefined) {
    throw new Error(`Invalid QR version ${version} or ECC level ${eccLevel}`);
  }

  return capacity;
}

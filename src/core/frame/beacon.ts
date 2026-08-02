/**
 * Beacon frame parsing and validation.
 *
 * Implements D17/D21 beacon format with D26/T1 bounds checking including
 * K validation against the local device's benchmarked K_max.
 *
 * Reference: plan.md §7.2, D26, T1, §16.4
 */

import {validateBeaconK} from '../../platform/ge-benchmark.js';

/**
 * Beacon flags (1 byte).
 */
export enum BeaconFlags {
  None = 0,
  /** Compression enabled (D8) */
  Compressed = 1 << 0,
  /** Resume disabled when compression is enabled */
  ResumeDisabled = 1 << 1,
  /** Hash algorithm bitmask */
  HashMask = 0b11110000,
}

/**
 * Parsed beacon metadata.
 */
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  fileSize: number;
  blockSize: number;
  blockCount: number;
  fragmentLen: number; // L
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array; // 32 bytes
  filename: string;
  mimeType: string;
}

/**
 * Validation error with code and details.
 */
export class BeaconValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BeaconValidationError';
  }
}

/**
 * Maximum safe values for beacon fields (T1).
 */
export const BEACON_LIMITS = {
  MAX_L: 4096,
  MAX_BLOCK_COUNT: 16_700_000, // 16.7M blocks × 192 KB = 3.0 TB
  MAX_FILE_SIZE: 281_474_976_710_656, // 281 TB, 6-byte field max
  MAX_FILENAME_LEN: 255,
  MAX_MIMETYPE_LEN: 127,
} as const;

/**
 * Parse a beacon from bytes.
 *
 * @param bytes - Beacon payload bytes (after QR decoding and header stripping)
 * @param localKMax - This device's benchmarked maximum K (from GE benchmark)
 * @param availableQuota - Available storage quota in bytes (for T1 fileSize check)
 * @throws {BeaconValidationError} If any field fails validation
 */
export function parseBeacon(
  bytes: Uint8Array,
  localKMax: number,
  availableQuota: number
): BeaconMeta {
  let offset = 0;

  const readU32 = () => {
    const value = (bytes[offset] << 24) |
                 (bytes[offset + 1] << 16) |
                 (bytes[offset + 2] << 8) |
                 bytes[offset + 3];
    offset += 4;
    return value >>> 0; // Force unsigned
  };

  const readU24 = () => {
    const value = (bytes[offset] << 16) |
                 (bytes[offset + 1] << 8) |
                 bytes[offset + 2];
    offset += 3;
    return value >>> 0;
  };

  const readU16 = () => {
    const value = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    return value >>> 0;
  };

  const readU8 = () => bytes[offset++];

  const readBytes = (n: number) => {
    const value = bytes.subarray(offset, offset + n);
    offset += n;
    return value;
  };

  const readString = (maxLen: number) => {
    const len = readU8();
    if (len > maxLen) {
      throw new BeaconValidationError(
        'E-META-BOUNDS',
        `String length ${len} exceeds maximum ${maxLen}`,
        {length: len, max: maxLen}
      );
    }
    const strBytes = readBytes(len);
    // Decode as UTF-8
    const decoder = new TextDecoder('utf-8', {fatal: true});
    try {
      return decoder.decode(strBytes);
    } catch (e) {
      throw new BeaconValidationError(
        'E-META-BOUNDS',
        'Invalid UTF-8 in string field',
        {}
      );
    }
  };

  // ------------------------------------------------------------------ Fixed fields

  const streamId = readU32();
  const wireVersion = readU8();
  const fileSize = (readU32() << 8) | readU8(); // 6 bytes, 48-bit

  // T1: fileSize bounds check
  if (fileSize > BEACON_LIMITS.MAX_FILE_SIZE) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Declared file size (${fileSize}) exceeds maximum (${BEACON_LIMITS.MAX_FILE_SIZE})`,
      {fileSize, max: BEACON_LIMITS.MAX_FILE_SIZE}
    );
  }

  // T1: fileSize must fit in available quota
  if (fileSize > availableQuota) {
    throw new BeaconValidationError(
      'E-QUOTA-PREFLIGHT',
      `File size (${fileSize}) exceeds available quota (${availableQuota})`,
      {fileSize, availableQuota}
    );
  }

  const blockSize = readU24();
  const blockCount = readU24();

  // T1: blockCount bounds check
  if (blockCount > BEACON_LIMITS.MAX_BLOCK_COUNT) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Block count (${blockCount}) exceeds maximum (${BEACON_LIMITS.MAX_BLOCK_COUNT})`,
      {blockCount, max: BEACON_LIMITS.MAX_BLOCK_COUNT}
    );
  }

  // Sanity: blockSize should be reasonable
  if (blockSize < 1 || blockSize > 10_485_760) { // Max 10 MB per block
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Invalid block size: ${blockSize}`,
      {blockSize}
    );
  }

  const fragmentLen = readU16();

  // T1: L bounds check (I1 says L is fixed for session, but beacon declares it)
  if (fragmentLen < 1 || fragmentLen > BEACON_LIMITS.MAX_L) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Fragment length L (${fragmentLen}) outside valid range [1, ${BEACON_LIMITS.MAX_L}]`,
      {L: fragmentLen, max: BEACON_LIMITS.MAX_L}
    );
  }

  const degreeCap = readU8();

  // Sanity: degreeCap should be within reasonable bounds (D25 says 64)
  if (degreeCap < 1 || degreeCap > 256) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Invalid degree cap: ${degreeCap}`,
      {degreeCap}
    );
  }

  const flags = readU8();
  const blockHashLen = readU8();

  // Sanity: blockHashLen should be reasonable (SHA-256 truncated to 4 bytes per plan)
  if (blockHashLen < 1 || blockHashLen > 64) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Invalid block hash length: ${blockHashLen}`,
      {blockHashLen}
    );
  }

  const wholeFileHash = readBytes(32); // Fixed 32-byte whole file hash

  // ------------------------------------------------------------------ Variable fields

  const filename = readString(BEACON_LIMITS.MAX_FILENAME_LEN);
  const mimeType = readString(BEACON_LIMITS.MAX_MIMETYPE_LEN);

  // ------------------------------------------------------------------ D26/T1: K validation

  // Derive K from blockSize and L
  const kValidation = validateBeaconK(blockSize, fragmentLen, localKMax);

  if (!kValidation.acceptable) {
    throw new BeaconValidationError(
      kValidation.error!.code,
      kValidation.error!.message,
      kValidation.error!.details
    );
  }

  // ------------------------------------------------------------------ Sanity checks

  if (offset !== bytes.length) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Beacon has ${bytes.length - offset} trailing bytes`,
      {expected: offset, actual: bytes.length}
    );
  }

  // Sanity: blockCount × blockSize should approximately equal fileSize
  // (last block may be short, so allow ±1 block tolerance)
  const estimatedSize = (blockCount - 1) * blockSize;
  if (fileSize < estimatedSize - blockSize || fileSize > blockCount * blockSize + blockSize) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Inconsistent beacon: fileSize=${fileSize}, blockCount=${blockCount}, blockSize=${blockSize}`,
      {fileSize, blockCount, blockSize}
    );
  }

  return {
    streamId,
    wireVersion,
    fileSize,
    blockSize,
    blockCount,
    fragmentLen,
    degreeCap,
    flags,
    blockHashLen,
    wholeFileHash,
    filename,
    mimeType,
  };
}

/**
 * Sanitize a filename for export (T2).
 *
 * Strips path separators, control bytes, and leading dots.
 */
export function sanitizeFilename(filename: string): string {
  // Remove path separators
  let sanitized = filename.replace(/[\/\\]/g, '_');

  // Remove control bytes (0x00-0x1F, 0x7F)
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Strip leading dots (avoid hidden files on Unix)
  sanitized = sanitized.replace(/^\.+/g, '');

  // Cap length
  const maxLength = 200;
  if (sanitized.length > maxLength) {
    // Try to preserve extension
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0 && lastDot < maxLength - 10) {
      sanitized = sanitized.substring(0, maxLength - (sanitized.length - lastDot)) + sanitized.substring(lastDot);
    } else {
      sanitized = sanitized.substring(0, maxLength);
    }
  }

  // Fallback if empty after sanitization
  if (!sanitized) {
    sanitized = 'received-file';
  }

  return sanitized;
}

/**
 * Check if resume should be disabled based on beacon flags.
 *
 * When compression is enabled, the sender MUST set BeaconFlags.ResumeDisabled
 * because non-deterministic compression makes block boundaries unstable across
 * sender restarts. This prevents silent corruption of the receiver's bitmap.
 *
 * See: docs/notes/bf-17s0-resume-compression-conflict.md
 */
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.ResumeDisabled) !== 0;
}

/**
 * Beacon frame parsing and validation.
 *
 * Implements D17/D21 beacon format with D26/T1 bounds checking including
 * K validation against the local device's benchmarked K_max.
 *
 * Reference: plan.md §7.2, D26, T1, §16.4
 */

import {validateBeaconK} from '../../platform/ge-benchmark.js';
import {crc32} from './crc.js';
import {L, WIRE_VERSION} from '../params.js';

/**
 * Beacon flags (1 byte).
 *
 * SENDER CONSTRAINT: When compression is enabled, you MUST set BOTH Compressed
 * AND ResumeDisabled flags. This is required because CompressionStream offers
 * no determinism guarantee across browser restarts, making resume unsafe.
 *
 * Usage (when constructing beacon for transmission):
 * ```typescript
 * let flags = BeaconFlags.None;
 * if (compressionEnabled) {
 *   flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
 * }
 * const meta: BeaconMeta = { ..., flags };
 * const beaconBytes = encodeBeacon(meta);
 * ```
 *
 * See: encodeBeacon() documentation for full rationale and references.
 */
export enum BeaconFlags {
  None = 0,
  /**
   * Compression enabled (D8).
   * When set, ResumeDisabled MUST also be set (see encodeBeacon docs).
   */
  Compressed = 1 << 0,
  /**
   * Resume is disabled.
   * MUST be set when compression is enabled (CompressionStream is non-deterministic).
   * Receiver checks this via isResumeDisabled() to suppress resume UI and prevent
   * persisting bitmap/metadata that would become silently invalid after sender restart.
   */
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
  originalSize: number; // Original uncompressed file size
  payloadLen: number; // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number; // L
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array; // 32 bytes
  manifestHash: Uint8Array; // 4 bytes - CRC-32 of manifest (roots beacon->manifest->blocks chain)
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
 *
 * **Beacon size bound calculation (R1's 256-byte payload):**
 * - Fixed fields: 64 bytes (streamId, wireVersion, originalSize, payloadLen, blockSize,
 *                  blockCount, fragmentLen, degreeCap, flags, blockHashLen,
 *                  wholeFileHash, manifestHash)
 * - CRC-32: 4 bytes
 * - Length prefixes: 2 bytes (1 byte each for filename and mimeType)
 * - Available for filename + mimeType: 256 - 64 - 4 - 2 = 186 bytes
 *
 * This yields a conservative allocation of 128 bytes for filename and 58 bytes for
 * mimeType, ensuring the beacon never overflows R1's capacity while accommodating
 * common filenames and MIME types.
 */
export const BEACON_LIMITS = {
  MAX_L: 4096,
  MAX_BLOCK_COUNT: 16_700_000, // 16.7M blocks × 192 KB = 3.0 TB
  MAX_FILE_SIZE: 281_474_976_710_656, // 281 TB, 6-byte field max
  /** Maximum number of blocks that the manifest itself can consume (T1). */
  /** K_manifest = ceil(blockCount × blockHashLen / BLOCK). Limits DoS from unbounded manifest growth. */
  MAX_K_MANIFEST_BLOCKS: 1000, // 1000 manifest blocks ≈ 195 MB of manifest data
  /** Maximum UTF-8 encoded filename length in bytes (T2). Chosen to fit within R1's 256-byte payload. */
  MAX_FILENAME_BYTES: 128,
  /** Maximum UTF-8 encoded MIME type length in bytes (T2). Chosen to fit within R1's 256-byte payload. */
  MAX_MIMETYPE_BYTES: 58,
  /** Maximum UTF-8 codepoint count for filename (T2). A UTF-8 string can use up to 4 bytes per codepoint. */
  MAX_FILENAME_CODEPOINTS: 32, // 32 × 4 = 128, guarantees never exceeds MAX_FILENAME_BYTES
  /** Maximum UTF-8 codepoint count for MIME type (T2). */
  MAX_MIMETYPE_CODEPOINTS: 14, // 14 × 4 = 56, fits within MAX_MIMETYPE_BYTES
} as const;

/**
 * Calculate K_manifest from blockCount and blockHashLen.
 *
 * K_manifest is the number of blocks needed to store the block hash manifest.
 * The manifest contains blockCount × blockHashLen bytes (all block hashes),
 * divided into blocks of size BLOCK (196608 bytes = K × L).
 *
 * Formula: K_manifest = ceil(blockCount × blockHashLen / BLOCK)
 *
 * @param blockCount - Number of data blocks (from beacon)
 * @param blockHashLen - Length of each block hash in bytes (from beacon)
 * @returns Number of blocks needed to store the manifest
 */
function calculateKManifest(blockCount: number, blockHashLen: number): number {
  const BLOCK = 196608; // K × L where K=768, L=256 (from core/params.ts)
  const manifestBytes = blockCount * blockHashLen;
  return Math.ceil(manifestBytes / BLOCK);
}

/**
 * Device context for K validation logging.
 */
export interface DeviceContext {
  /** Device signature from GE benchmark cache */
  deviceSignature: string;
  /** User agent string */
  userAgent: string;
  /** Platform identifier */
  platform: string;
}

/**
 * Parse a beacon from bytes.
 *
 * Beacon format: [body fields...][crc32(4)]
 * The CRC-32 covers all beacon body fields and MUST be validated before
 * any metadata (including streamId) is trusted.
 *
 * **Validation order is critical:**
 * 1. Read all fields (no validation yet)
 * 2. Validate CRC-32 (if this fails, ALL other values are suspect)
 * 3. Then do bounds/K/quota checks (safe now because CRC validated)
 *
 * @param bytes - Beacon payload bytes (after QR decoding and header stripping)
 * @param localKMax - This device's benchmarked maximum K (from GE benchmark)
 * @param availableQuota - Available storage quota in bytes (for T1 originalSize check)
 * @param deviceContext - Optional device context for K validation logging
 * @throws {BeaconValidationError} If any field fails validation or CRC-32 mismatch
 */
export function parseBeacon(
  bytes: Uint8Array,
  localKMax: number,
  availableQuota: number,
  deviceContext?: DeviceContext
): BeaconMeta {
  let offset = 0;

  const readU32 = (): number => {
    const value = (bytes[offset]! << 24) |
                 (bytes[offset + 1]! << 16) |
                 (bytes[offset + 2]! << 8) |
                 bytes[offset + 3]!;
    offset += 4;
    return value >>> 0; // Force unsigned
  };

  const readU24 = (): number => {
    const value = (bytes[offset]! << 16) |
                 (bytes[offset + 1]! << 8) |
                 bytes[offset + 2]!;
    offset += 3;
    return value >>> 0;
  };

  const readU16 = (): number => {
    const value = (bytes[offset]! << 8) | bytes[offset + 1]!;
    offset += 2;
    return value >>> 0;
  };

  const readU8 = (): number => {
    const value = bytes[offset]!;
    offset += 1;
    return value;
  };

  const readBytes = (n: number): Uint8Array => {
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

  // ------------------------------------------------------------------ STEP 1: Read all fields (no validation yet)

  const streamId = readU32();
  const wireVersion = readU8();
  // originalSize: 6 bytes, 48-bit (original uncompressed file size)
  const originalSize = ((readU8() << 40) & 0xff0000000000) |
                       ((readU32() << 8) & 0xffffffffff00) |
                       (readU8() & 0xff);
  // payloadLen: 6 bytes, 48-bit (actual payload length after compression)
  const payloadLen = ((readU8() << 40) & 0xff0000000000) |
                     ((readU32() << 8) & 0xffffffffff00) |
                     (readU8() & 0xff);

  const blockSize = readU24();
  const blockCount = readU24();
  const fragmentLen = readU16();
  const degreeCap = readU8();
  const flags = readU8();
  const blockHashLen = readU8();
  const wholeFileHash = readBytes(32); // Fixed 32-byte whole file hash
  const manifestHash = readBytes(4); // Fixed 4-byte manifest hash (CRC-32)

  // Variable fields
  const filename = readString(BEACON_LIMITS.MAX_FILENAME_BYTES);
  const mimeType = readString(BEACON_LIMITS.MAX_MIMETYPE_BYTES);

  // ------------------------------------------------------------------ STEP 2: CRC-32 validation (MUST pass before any beacon values are trusted)

  const CRC_SIZE = 4;
  const beaconBodySize = offset;
  const expectedSize = beaconBodySize + CRC_SIZE;

  if (bytes.length !== expectedSize) {
    throw new BeaconValidationError(
      'E-CRC-LENGTH',
      `Beacon size ${bytes.length} != expected ${expectedSize} (body+CRC)`,
      {actual: bytes.length, expected: expectedSize}
    );
  }

  // Read the CRC-32 from the last 4 bytes
  const storedCrc = ((bytes[offset]! << 24) |
                    (bytes[offset + 1]! << 16) |
                    (bytes[offset + 2]! << 8) |
                    bytes[offset + 3]!) >>> 0; // Force unsigned

  // Calculate CRC-32 over the beacon body (everything except the last 4 bytes)
  const calculatedCrc = crc32(bytes.subarray(0, beaconBodySize));

  if (storedCrc !== calculatedCrc) {
    throw new BeaconValidationError(
      'E-CRC-MISMATCH',
      `Beacon CRC-32 mismatch: stored=${storedCrc} calculated=${calculatedCrc}`,
      {stored: storedCrc, calculated: calculatedCrc}
    );
  }

  // ------------------------------------------------------------------ STEP 3: T1/META bounds checks (now safe because CRC validated)

  // T1: originalSize bounds check
  if (originalSize > BEACON_LIMITS.MAX_FILE_SIZE) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Declared original size (${originalSize}) exceeds maximum (${BEACON_LIMITS.MAX_FILE_SIZE})`,
      {originalSize, max: BEACON_LIMITS.MAX_FILE_SIZE}
    );
  }

  // T1: originalSize must fit in available quota
  if (originalSize > availableQuota) {
    throw new BeaconValidationError(
      'E-QUOTA-PREFLIGHT',
      `Original size (${originalSize}) exceeds available quota (${availableQuota})`,
      {originalSize, availableQuota}
    );
  }

  // T1: payloadLen bounds check (same limit as originalSize)
  if (payloadLen > BEACON_LIMITS.MAX_FILE_SIZE) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Declared payload length (${payloadLen}) exceeds maximum (${BEACON_LIMITS.MAX_FILE_SIZE})`,
      {payloadLen, max: BEACON_LIMITS.MAX_FILE_SIZE}
    );
  }

  // T1: payloadLen must fit in available quota
  if (payloadLen > availableQuota) {
    throw new BeaconValidationError(
      'E-QUOTA-PREFLIGHT',
      `Payload length (${payloadLen}) exceeds available quota (${availableQuota})`,
      {payloadLen, availableQuota}
    );
  }

  // Sanity: payloadLen should be ≤ originalSize (compression can only reduce)
  if (payloadLen > originalSize) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Payload length (${payloadLen}) cannot exceed original size (${originalSize})`,
      {payloadLen, originalSize}
    );
  }

  // T1: blockCount bounds check
  if (blockCount > BEACON_LIMITS.MAX_BLOCK_COUNT) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Block count (${blockCount}) exceeds maximum (${BEACON_LIMITS.MAX_BLOCK_COUNT})`,
      {blockCount, max: BEACON_LIMITS.MAX_BLOCK_COUNT}
    );
  }

  // T1: K_manifest bounds check (bf-5fs)
  // K_manifest is the number of blocks needed to store the block hash manifest.
  // Unbounded K_manifest is a DoS vector: with MAX_BLOCK_COUNT (16.7M) and blockHashLen=4,
  // the manifest would be 262,144 fragments and ~8.6 GB of matrix data.
  const blockCountManifest = calculateKManifest(blockCount, blockHashLen);
  if (blockCountManifest > BEACON_LIMITS.MAX_K_MANIFEST_BLOCKS) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Manifest block count (${blockCountManifest}) exceeds maximum (${BEACON_LIMITS.MAX_K_MANIFEST_BLOCKS}). ` +
      `This would require ${blockCountManifest} blocks (${(blockCountManifest * 196608 / 1024 / 1024).toFixed(1)} MB) ` +
      `to store the manifest for ${blockCount} data blocks.`,
      {
        blockCount,
        blockHashLen,
        blockCountManifest,
        max: BEACON_LIMITS.MAX_K_MANIFEST_BLOCKS
      }
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

  // T1: Wire version compatibility check
  if (wireVersion !== WIRE_VERSION) {
    throw new BeaconValidationError(
      'E-VERSION',
      `Wire version mismatch: sender is ${wireVersion}, receiver is ${WIRE_VERSION}`,
      {senderVersion: wireVersion, receiverVersion: WIRE_VERSION}
    );
  }

  // T1: L must match wire constant for this version
  if (fragmentLen !== L) {
    throw new BeaconValidationError(
      'E-VERSION',
      `Fragment length L mismatch: sender declared ${fragmentLen}, wire constant is ${L}`,
      {senderL: fragmentLen, wireConstantL: L, wireVersion}
    );
  }

  // T1: Secondary sanity check (should never fire if above checks pass)
  if (fragmentLen < 1 || fragmentLen > BEACON_LIMITS.MAX_L) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Fragment length L (${fragmentLen}) outside valid range [1, ${BEACON_LIMITS.MAX_L}]`,
      {L: fragmentLen, max: BEACON_LIMITS.MAX_L}
    );
  }

  // Sanity: degreeCap should be within reasonable bounds (D25 says 64)
  if (degreeCap < 1 || degreeCap > 256) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Invalid degree cap: ${degreeCap}`,
      {degreeCap}
    );
  }

  // Sanity: blockHashLen should be reasonable (SHA-256 truncated to 4 bytes per plan)
  if (blockHashLen < 1 || blockHashLen > 64) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Invalid block hash length: ${blockHashLen}`,
      {blockHashLen}
    );
  }

  // ------------------------------------------------------------------ STEP 4: D26/T1: K validation

  // Derive K from blockSize and L
  const kValidation = validateBeaconK(blockSize, fragmentLen, localKMax, deviceContext);

  if (!kValidation.acceptable) {
    throw new BeaconValidationError(
      kValidation.error!.code,
      kValidation.error!.message,
      kValidation.error!.details
    );
  }

  // ------------------------------------------------------------------ STEP 5: Sanity checks

  // Sanity: blockCount × blockSize should approximately equal payloadLen
  // (last block may be short, so allow ±1 block tolerance)
  const estimatedSize = (blockCount - 1) * blockSize;
  if (payloadLen < estimatedSize - blockSize || payloadLen > blockCount * blockSize + blockSize) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Inconsistent beacon: payloadLen=${payloadLen}, blockCount=${blockCount}, blockSize=${blockSize}`,
      {payloadLen, blockCount, blockSize}
    );
  }

  return {
    streamId,
    wireVersion,
    originalSize,
    payloadLen,
    blockSize,
    blockCount,
    fragmentLen,
    degreeCap,
    flags,
    blockHashLen,
    wholeFileHash,
    manifestHash,
    filename,
    mimeType,
  };
}

/**
 * Sanitize a filename for export (T2).
 *
 * **Truncation rules (T2):**
 * 1. Strip path separators, control bytes, and leading dots (security)
 * 2. Truncate to MAX_FILENAME_CODEPOINTS (32 UTF-8 codepoints max)
 * 3. If truncated, preserve filename extension when possible
 * 4. Validate final UTF-8 encoding fits in MAX_FILENAME_BYTES (128 bytes)
 * 5. Fall back to "received-file" if empty after sanitization
 *
 * **Why both codepoint and byte limits:**
 * - UTF-8 uses 1-4 bytes per codepoint
 * - MAX_FILENAME_CODEPOINTS guarantees we never exceed MAX_FILENAME_BYTES
 * - MAX_FILENAME_BYTES ensures the beacon fits in R1's 256-byte payload
 *
 * @param filename - Attacker-supplied filename from beacon
 * @returns Sanitized filename safe for filesystem export and beacon encoding
 */
export function sanitizeFilename(filename: string): string {
  // Step 1: Remove path separators (prevents directory traversal)
  let sanitized = filename.replace(/[\/\\]/g, '_');

  // Step 2: Remove control bytes (0x00-0x1F, 0x7F) — invalid on most filesystems
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

  // Step 3: Strip leading dots (avoid hidden files on Unix, prevent dotfiles attack)
  sanitized = sanitized.replace(/^\.+/g, '');

  // Step 4: Truncate to MAX_FILENAME_CODEPOINTS (32 codepoints)
  if (sanitized.length > BEACON_LIMITS.MAX_FILENAME_CODEPOINTS) {
    // Try to preserve extension: find last dot and keep extension
    const lastDot = sanitized.lastIndexOf('.');

    if (lastDot > 0 && lastDot < BEACON_LIMITS.MAX_FILENAME_CODEPOINTS - 5) {
      // Keep extension: truncate base, preserve ".ext"
      const ext = sanitized.substring(lastDot);
      const baseAllowed = BEACON_LIMITS.MAX_FILENAME_CODEPOINTS - ext.length;
      sanitized = sanitized.substring(0, baseAllowed) + ext;
    } else {
      // No extension or extension too long: simple truncate
      sanitized = sanitized.substring(0, BEACON_LIMITS.MAX_FILENAME_CODEPOINTS);
    }
  }

  // Step 5: Validate UTF-8 byte length fits in MAX_FILENAME_BYTES
  const utf8Bytes = new TextEncoder().encode(sanitized);
  if (utf8Bytes.length > BEACON_LIMITS.MAX_FILENAME_BYTES) {
    // Byte overflow: truncate conservatively to UTF-8 safe boundary
    // Conservative: each codepoint can be up to 4 bytes, so truncate to codepoints that fit
    let byteLen = 0;
    let cpIndex = 0;
    for (let i = 0; i < sanitized.length; i++) {
      const cpBytes = new TextEncoder().encode(sanitized[i]).length;
      if (byteLen + cpBytes > BEACON_LIMITS.MAX_FILENAME_BYTES) break;
      byteLen += cpBytes;
      cpIndex = i + 1;
    }
    sanitized = sanitized.substring(0, cpIndex);
  }

  // Step 6: Fallback if empty after sanitization
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
 * **How this works:**
 * 1. Sender enables compression → sets both Compressed and ResumeDisabled flags
 * 2. Receiver receives beacon → checks isResumeDisabled() → returns true
 * 3. Receiver suppresses resume UI and does NOT persist bitmap/metadata
 * 4. If interrupted, user must restart transfer from beginning (safe, no corruption)
 *
 * **Why this is necessary:**
 * CompressionStream offers no determinism guarantee. After a sender restart and
 * E11 staging reaping, re-compression may produce different bytes → different
 * block boundaries → different hashes → the receiver's persisted bitmap would
 * become silently invalid.
 *
 * Solution implemented: Option B from bf-3k90 evaluation
 * - Privacy (T4) preserved: no staging persistence
 * - Correctness preserved: explicitly disabling unsafe resume
 * - Low complexity: ~50-100 lines vs. 300-1200 for alternatives
 *
 * Reference: docs/notes/bf-3k90-compression-resume-solution-evaluation.md (Option B)
 *            docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 *            docs/notes/bf-17s0-resume-compression-conflict.md
 *
 * @param flags - Beacon flags byte from received beacon
 * @returns true if resume is disabled (compression enabled), false otherwise
 */
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.ResumeDisabled) !== 0;
}

/**
 * Encode a beacon from metadata.
 *
 * Serializes beacon metadata into bytes and appends a CRC-32 checksum
 * over the beacon body for integrity validation.
 *
 * **SENDER CONSTRAINT:** When constructing a BeaconMeta object to pass to this function:
 * - If compression is enabled, you MUST set both flags:
 *   `flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled`
 * - This is required because CompressionStream offers no determinism guarantee
 *   across browser restarts, making resume unsafe (see below)
 *
 * **Why compression disables resume:**
 * Non-deterministic compression means that after a sender restart and E11 staging
 * reaping, re-compression may produce different bytes → different block boundaries
 * → different hashes → the receiver's persisted bitmap becomes silently invalid.
 *
 * Solution: The sender signals "no resume available" via the beacon flag, and the
 * receiver suppresses resume UI and does not persist the bitmap/metadata.
 *
 * Reference: docs/notes/bf-3k90-compression-resume-solution-evaluation.md (Option B)
 *            docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 *
 * @param meta - Beacon metadata to encode
 * @returns Uint8Array of encoded beacon with CRC-32
 */
export function encodeBeacon(meta: BeaconMeta): Uint8Array {
  // Validate wire version and fragmentLen before encoding
  if (meta.wireVersion !== WIRE_VERSION) {
    throw new BeaconValidationError(
      'E-VERSION',
      `Cannot encode beacon for wire version ${meta.wireVersion}, this implementation is ${WIRE_VERSION}`,
      {requestedVersion: meta.wireVersion, supportedVersion: WIRE_VERSION}
    );
  }

  if (meta.fragmentLen !== L) {
    throw new BeaconValidationError(
      'E-VERSION',
      `Cannot encode beacon with fragmentLen ${meta.fragmentLen}, wire constant is ${L}`,
      {requestedL: meta.fragmentLen, wireConstantL: L, wireVersion: meta.wireVersion}
    );
  }

  // Calculate total size
  const filenameBytes = new TextEncoder().encode(meta.filename);
  const mimeTypeBytes = new TextEncoder().encode(meta.mimeType);

  if (filenameBytes.length > BEACON_LIMITS.MAX_FILENAME_BYTES) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `Filename too long: ${filenameBytes.length} bytes (max ${BEACON_LIMITS.MAX_FILENAME_BYTES})`,
      {length: filenameBytes.length, max: BEACON_LIMITS.MAX_FILENAME_BYTES}
    );
  }

  if (mimeTypeBytes.length > BEACON_LIMITS.MAX_MIMETYPE_BYTES) {
    throw new BeaconValidationError(
      'E-META-BOUNDS',
      `MIME type too long: ${mimeTypeBytes.length} bytes (max ${BEACON_LIMITS.MAX_MIMETYPE_BYTES})`,
      {length: mimeTypeBytes.length, max: BEACON_LIMITS.MAX_MIMETYPE_BYTES}
    );
  }

  // Fixed fields: streamId(4) + wireVersion(1) + originalSize(6) + payloadLen(6) +
  //              blockSize(3) + blockCount(3) + fragmentLen(2) + degreeCap(1) +
  //              flags(1) + blockHashLen(1) + wholeFileHash(32) + manifestHash(4) = 64 bytes
  // Variable: filenameLen(1) + filename + mimeTypeLen(1) + mimeType
  // CRC-32: 4 bytes
  const fixedSize = 64;
  const variableSize = 2 + filenameBytes.length + mimeTypeBytes.length;
  const crcSize = 4;
  const totalSize = fixedSize + variableSize + crcSize;

  const bytes = new Uint8Array(totalSize);
  let offset = 0;

  // Write fixed fields
  const writeU32 = (value: number) => {
    bytes[offset++] = (value >>> 24) & 0xff;
    bytes[offset++] = (value >>> 16) & 0xff;
    bytes[offset++] = (value >>> 8) & 0xff;
    bytes[offset++] = value & 0xff;
  };

  const writeU24 = (value: number) => {
    bytes[offset++] = (value >>> 16) & 0xff;
    bytes[offset++] = (value >>> 8) & 0xff;
    bytes[offset++] = value & 0xff;
  };

  const writeU16 = (value: number) => {
    bytes[offset++] = (value >>> 8) & 0xff;
    bytes[offset++] = value & 0xff;
  };

  const writeU8 = (value: number) => {
    bytes[offset++] = value & 0xff;
  };

  // Fixed fields
  writeU32(meta.streamId);
  writeU8(meta.wireVersion);

  // originalSize: 6 bytes, 48-bit (original uncompressed file size)
  writeU8((meta.originalSize >>> 40) & 0xff);       // Byte 0 (MSB)
  writeU32((meta.originalSize >>> 8) & 0xffffffff); // Bytes 1-4
  writeU8(meta.originalSize & 0xff);                // Byte 5 (LSB)

  // payloadLen: 6 bytes, 48-bit (actual payload length after compression)
  writeU8((meta.payloadLen >>> 40) & 0xff);       // Byte 0 (MSB)
  writeU32((meta.payloadLen >>> 8) & 0xffffffff); // Bytes 1-4
  writeU8(meta.payloadLen & 0xff);                // Byte 5 (LSB)

  writeU24(meta.blockSize);
  writeU24(meta.blockCount);
  writeU16(meta.fragmentLen);
  writeU8(meta.degreeCap);
  writeU8(meta.flags);
  writeU8(meta.blockHashLen);

  // wholeFileHash: 32 bytes
  bytes.set(meta.wholeFileHash, offset);
  offset += 32;

  // manifestHash: 4 bytes (CRC-32 of manifest)
  bytes.set(meta.manifestHash, offset);
  offset += 4;

  // Variable fields
  writeU8(filenameBytes.length);
  bytes.set(filenameBytes, offset);
  offset += filenameBytes.length;

  writeU8(mimeTypeBytes.length);
  bytes.set(mimeTypeBytes, offset);
  offset += mimeTypeBytes.length;

  // Calculate and write CRC-32 over everything except the CRC itself
  const crcBodyEnd = offset;
  const crcValue = crc32(bytes.subarray(0, crcBodyEnd));

  writeU32(crcValue);

  return bytes;
}

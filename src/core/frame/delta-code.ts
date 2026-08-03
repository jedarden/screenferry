/**
 * Delta repair code format (bf-280).
 *
 * Extends the repair code format (plan §7.6) to support delta transfers.
 * Delta codes allow updating an older version of a file to a newer version
 * by transferring only the differing blocks.
 *
 * **Format:**
 * ```
 * SFD-<oldStreamId32>-<newStreamId32>-<ranges32>-<check>
 * ```
 *
 * Where:
 * - `SFD` = ScreenFerry Delta (vs `SF1-` for regular repair)
 * - `oldStreamId32` = StreamId of receiver's file (V1)
 * - `newStreamId32` = StreamId of sender's file (V2)
 * - `ranges32` = Run-length encoded block indices that differ
 * - `check` = CRC-8 for validation (prevents typos)
 *
 * **Encoding:** Crockford base32 (no I/L/O/U — removes misreadings)
 *
 * Reference: plan §7.6, docs/notes/bf-280-delta-transfer-resolution.md
 */

import { crc8 } from './crc.js';
import { blocksToRanges, rangesToBlocks } from '../block/delta.js';

/**
 * Delta code components.
 */
export interface DeltaCode {
  /** Old file streamId (receiver's version) */
  oldStreamId: number;
  /** New file streamId (sender's version) */
  newStreamId: number;
  /** Block ranges that differ (run-length encoded) */
  ranges: [number, number][];
  /** CRC-8 checksum for validation */
  check: number;
}

/**
 * Crockford base32 alphabet (no I/L/O/U).
 */
const BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Encode a 32-bit integer in Crockford base32.
 */
function encodeBase32(value: number): string {
  if (value < 0) {
    throw new Error(`Cannot encode negative number: ${value}`);
  }

  const chars: string[] = [];
  while (value > 0) {
    const char = BASE32_ALPHABET[value % 32];
    if (!char) {
      throw new Error(`Invalid base32 character index: ${value % 32}`);
    }
    chars.push(char);
    value = Math.floor(value / 32);
  }

  // Pad to at least 2 characters
  while (chars.length < 2) {
    chars.push('0');
  }

  return chars.reverse().join('');
}

/**
 * Decode a Crockford base32 string to a 32-bit integer.
 */
function decodeBase32(encoded: string): number {
  const upper = encoded.toUpperCase();
  let value = 0;

  for (const char of upper) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base32 character: ${char}`);
    }
    value = value * 32 + index;
  }

  return value;
}

/**
 * Encode a block range as base32.
 *
 * Format: `<start>-<end>` where both are base32-encoded.
 */
function encodeRange(range: [number, number]): string {
  const [start, end] = range;
  return `${encodeBase32(start)}-${encodeBase32(end)}`;
}

/**
 * Decode a block range from base32.
 *
 * Format: `<start>-<end>` where both are base32-encoded.
 */
function decodeRange(encoded: string): [number, number] {
  const parts = encoded.split('-');
  if (parts.length !== 2) {
    throw new Error(`Invalid range format: ${encoded}`);
  }

  const start = decodeBase32(parts[0]!);
  const end = decodeBase32(parts[1]!);

  if (end < start) {
    throw new Error(`Range end < start: ${encoded}`);
  }

  return [start, end];
}

/**
 * Encode multiple ranges as a comma-separated string.
 */
function encodeRanges(ranges: [number, number][]): string {
  return ranges.map(encodeRange).join(',');
}

/**
 * Decode multiple ranges from a comma-separated string.
 */
function decodeRanges(encoded: string): [number, number][] {
  if (encoded.length === 0) return [];

  const parts = encoded.split(',');
  return parts.map(decodeRange);
}

/**
 * Compute CRC-8 checksum over delta code body.
 *
 * Covers everything except the final check digit itself.
 */
function computeDeltaCodeCheck(code: Partial<DeltaCode>): number {
  const payload =
    encodeBase32(code.oldStreamId!) +
    encodeBase32(code.newStreamId!) +
    encodeRanges(code.ranges!);

  const bytes = new TextEncoder().encode(payload);
  return crc8(bytes);
}

/**
 * Encode a delta code as a string.
 *
 * **Format:** `SFD-<oldStreamId32>-<newStreamId32>-<ranges32>-<check>`
 *
 * Example: `SFD-1A2B3C4D-5E6F7A8B-1-3,7-9A-2`
 *
 * @param code - Delta code components
 * @returns Encoded delta code string
 */
export function encodeDeltaCode(code: DeltaCode): string {
  const check = computeDeltaCodeCheck(code);

  return [
    'SFD',
    encodeBase32(code.oldStreamId),
    encodeBase32(code.newStreamId),
    encodeRanges(code.ranges),
    BASE32_ALPHABET[check % 32],
  ].join('-');
}

/**
 * Decode a delta code from a string.
 *
 * Validates the checksum and throws if invalid.
 *
 * @param encoded - Encoded delta code string
 * @returns Decoded delta code components
 * @throws {Error} If format is invalid or checksum fails
 */
export function decodeDeltaCode(encoded: string): DeltaCode {
  const parts = encoded.split('-');

  if (parts.length !== 5) {
    throw new Error(`Invalid delta code format: expected 5 parts, got ${parts.length}`);
  }

  if (parts[0] !== 'SFD') {
    throw new Error(`Invalid delta code prefix: expected 'SFD', got '${parts[0]}'`);
  }

  const oldStreamId = decodeBase32(parts[1]!);
  const newStreamId = decodeBase32(parts[2]!);
  const ranges = decodeRanges(parts[3]!);
  const checkChar = parts[4]!;

  const checkDigit = BASE32_ALPHABET.indexOf(checkChar);
  if (checkDigit === -1) {
    throw new Error(`Invalid check digit: ${checkChar}`);
  }

  const code: DeltaCode = {
    oldStreamId,
    newStreamId,
    ranges,
    check: checkDigit,
  };

  // Validate checksum
  const computedCheck = computeDeltaCodeCheck(code);
  if (computedCheck !== checkDigit) {
    throw new Error(`Delta code checksum mismatch: expected ${computedCheck}, got ${checkDigit}`);
  }

  return code;
}

/**
 * Create a delta code from streamIds and differing blocks.
 *
 * This is the primary interface for generating delta codes.
 *
 * @param oldStreamId - StreamId of receiver's file (V1)
 * @param newStreamId - StreamId of sender's file (V2)
 * @param differingBlocks - Array of block indices that differ
 * @returns Encoded delta code string
 */
export function createDeltaCode(
  oldStreamId: number,
  newStreamId: number,
  differingBlocks: number[]
): string {
  const ranges = blocksToRanges(differingBlocks);

  const code: DeltaCode = {
    oldStreamId,
    newStreamId,
    ranges,
    check: 0, // Computed below
  };

  code.check = computeDeltaCodeCheck(code);

  return encodeDeltaCode(code);
}

/**
 * Parse a delta code and extract differing blocks.
 *
 * This is the primary interface for parsing delta codes.
 *
 * @param encoded - Encoded delta code string
 * @returns Object with streamIds and differing blocks
 * @throws {Error} If format is invalid or checksum fails
 */
export function parseDeltaCode(encoded: string): {
  oldStreamId: number;
  newStreamId: number;
  differingBlocks: number[];
} {
  const code = decodeDeltaCode(encoded);
  const differingBlocks = rangesToBlocks(code.ranges);

  return {
    oldStreamId: code.oldStreamId,
    newStreamId: code.newStreamId,
    differingBlocks,
  };
}

/**
 * Validate that a delta code is within acceptable length bounds.
 *
 * If the encoded form exceeds 48 characters, it may be too long to
 * type reliably and should be presented as a QR code instead.
 *
 * @param encoded - Encoded delta code string
 * @returns true if within typing limit (48 chars)
 */
export function isDeltaCodeTypable(encoded: string): boolean {
  return encoded.length <= 48;
}

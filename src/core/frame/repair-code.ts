/**
 * Repair code format for human-mediated recovery (§8.2).
 *
 * Implements §7.6 repair code format:
 * SF1-<streamId32>-<ranges32>-<check>
 *
 * Format specification:
 * - Alphabet: Crockford base32 (0-9, A-Z excluding I,L,O,U)
 * - streamId32: Crockford-encoded 32-bit streamId
 * - ranges32: Run-length encoded missing block ranges
 * - check: 2-character CRC-8 checksum over decoded body
 * - Max length: 48 characters; exceeded → use QR format instead
 *
 * Reference: plan.md §7.6, §8.2, §11 error taxonomy
 */

import {crc8} from './crc.js';

/**
 * Crockford base32 alphabet (no I, L, O, U for readability).
 *
 * This alphabet removes commonly confused characters, making the
 * repair code more resistant to human transcription errors.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_MAP: Record<string, number> = Object.fromEntries(
  CROCKFORD_ALPHABET.split('').map((char, index) => [char, index])
);

/**
 * Maximum repair code length before switching to QR format.
 *
 * A 100 GB file with scattered misses can exceed reasonable typing length.
 * Silently truncating would be a correctness bug, so we switch to QR instead.
 */
const MAX_REPAIR_CODE_LENGTH = 48;

/**
 * Repair code parse error with code and details.
 */
export class RepairCodeError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RepairCodeError';
  }
}

/**
 * Block range representation.
 */
export interface BlockRange {
  /** Starting block index (inclusive) */
  start: number;
  /** Ending block index (inclusive) */
  end: number;
}

/**
 * Parsed repair code components.
 */
export interface ParsedRepairCode {
  /** Stream ID from the code */
  streamId: number;
  /** Missing block ranges */
  ranges: BlockRange[];
}

/**
 * Encode a number in Crockford base32.
 *
 * @param value - Number to encode (unsigned 32-bit)
 * @param minLength - Minimum output length (zero-padded if needed)
 * @returns Crockford base32 string
 */
function encodeCrockford(value: number, minLength = 1): string {
  if (value < 0 || value > 0xffffffff) {
    throw new Error(`Value ${value} out of 32-bit range`);
  }

  let result = '';
  while (value > 0) {
    result = CROCKFORD_ALPHABET[value % 32] + result;
    value = Math.floor(value / 32);
  }

  // Zero-pad to minimum length
  while (result.length < minLength) {
    result = '0' + result;
  }

  return result || '0';
}

/**
 * Decode a Crockford base32 string to a number.
 *
 * @param encoded - Crockford base32 string
 * @returns Decoded number
 * @throws {RepairCodeError} If invalid characters or overflow
 */
function decodeCrockford(encoded: string): number {
  let value = 0;

  for (const char of encoded.toUpperCase()) {
    const digit = CROCKFORD_MAP[char];
    if (digit === undefined) {
      throw new RepairCodeError(
        'E-REPAIR-CODE',
        `Invalid Crockford base32 character: ${char}`,
        {character: char}
      );
    }

    // Check for overflow
    if (value > (0xffffffff >>> 5)) {
      throw new RepairCodeError(
        'E-REPAIR-BOUNDS',
        'Crockford value exceeds 32-bit range',
        {encoded}
      );
    }

    value = (value << 5) | digit;
  }

  return value >>> 0; // Force unsigned
}

/**
 * Encode block ranges into run-length format.
 *
 * Format: For each range, emit [start][count] where:
 * - start: 24-bit block index (0 to 16,777,215)
 * - count: 8-bit block count (1 to 255, or 0 = 256)
 *
 * Contiguous blocks are merged into single ranges. Scattered blocks
 * are represented as single-block ranges.
 *
 * @param ranges - Array of block ranges
 * @returns Uint8Array of encoded ranges
 */
function encodeRanges(ranges: BlockRange[]): Uint8Array {
  const buffer: number[] = [];

  for (const range of ranges) {
    if (range.start > range.end) {
      throw new Error(`Invalid range: start ${range.start} > end ${range.end}`);
    }

    if (range.start > 0xffffff) {
      throw new Error(`Range start ${range.start} exceeds 24-bit range`);
    }

    const count = range.end - range.start + 1;

    if (count > 256) {
      throw new Error(`Range count ${count} exceeds maximum 256`);
    }

    // Emit start as 24-bit (big-endian)
    buffer.push((range.start >> 16) & 0xff);
    buffer.push((range.start >> 8) & 0xff);
    buffer.push(range.start & 0xff);

    // Emit count as 8-bit (0 = 256)
    buffer.push(count === 256 ? 0 : count);
  }

  return new Uint8Array(buffer);
}

/**
 * Decode block ranges from run-length format.
 *
 * @param encoded - Encoded ranges data
 * @returns Array of block ranges
 * @throws {RepairCodeError} If invalid format
 */
function decodeRanges(encoded: Uint8Array): BlockRange[] {
  const ranges: BlockRange[] = [];

  for (let i = 0; i < encoded.length; i += 4) {
    if (i + 4 > encoded.length) {
      throw new RepairCodeError(
        'E-REPAIR-CODE',
        'Incomplete range encoding',
        {offset: i}
      );
    }

    // Read start as 24-bit (big-endian)
    const start = ((encoded[i]! << 16) |
                   (encoded[i + 1]! << 8) |
                   encoded[i + 2]!) >>> 0;

    // Read count as 8-bit (0 = 256)
    const count = encoded[i + 3]! || 256;

    const end = start + count - 1;

    ranges.push({start, end});
  }

  return ranges;
}

/**
 * Merge adjacent or overlapping block ranges.
 *
 * @param ranges - Ranges to merge (must be sorted by start)
 * @returns Merged ranges
 */
function mergeRanges(ranges: BlockRange[]): BlockRange[] {
  if (ranges.length === 0) {
    return [];
  }

  const merged: BlockRange[] = [];
  const first = ranges[0]!;
  let current: BlockRange = { start: first.start, end: first.end };

  for (let i = 1; i < ranges.length; i++) {
    const next = ranges[i]!;

    // Check if adjacent or overlapping
    if (next.start <= current.end! + 1) {
      // Merge: extend current range if needed
      current.end = Math.max(current.end!, next.end);
    } else {
      // No overlap: push current and start new
      merged.push(current);
      current = { start: next.start, end: next.end };
    }
  }

  merged.push(current);
  return merged;
}

/**
 * Sort block ranges by start index.
 *
 * @param ranges - Ranges to sort
 * @returns Sorted ranges
 */
function sortRanges(ranges: BlockRange[]): BlockRange[] {
  return [...ranges].sort((a, b) => a.start - b.start);
}

/**
 * Convert a block bitmap to ranges.
 *
 * @param blockBitmap - Uint8Array where bit i = 1 if block i is missing
 * @param blockCount - Total number of blocks
 * @returns Missing block ranges
 */
export function bitmapToRanges(
  blockBitmap: Uint8Array,
  blockCount: number
): BlockRange[] {
  const ranges: BlockRange[] = [];
  let currentStart: number | null = null;

  for (let i = 0; i < blockCount; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const isMissing = (blockBitmap[byteIndex]! >> bitIndex) & 1;

    if (isMissing) {
      if (currentStart === null) {
        currentStart = i;
      }
      // Continue current range
    } else {
      if (currentStart !== null) {
        // End of range
        ranges.push({start: currentStart, end: i - 1});
        currentStart = null;
      }
    }
  }

  // Close final range if open
  if (currentStart !== null) {
    ranges.push({start: currentStart, end: blockCount - 1});
  }

  return mergeRanges(sortRanges(ranges));
}

/**
 * Convert ranges to block bitmap.
 *
 * @param ranges - Missing block ranges
 * @param blockCount - Total number of blocks
 * @returns Block bitmap where bit i = 1 if block i is in ranges
 */
export function rangesToBitmap(ranges: BlockRange[], blockCount: number): Uint8Array {
  const bitmap = new Uint8Array(Math.ceil(blockCount / 8));

  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      if (i >= blockCount) {
        continue; // Skip blocks beyond count (shouldn't happen)
      }
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      bitmap[byteIndex]! |= (1 << bitIndex);
    }
  }

  return bitmap;
}

/**
 * Encode a repair code from missing block information.
 *
 * @param streamId - Stream ID (32-bit)
 * @param missingRanges - Missing block ranges (sorted and merged)
 * @returns Repair code string
 * @throws {RepairCodeError} If code would exceed maximum length
 */
export function encodeRepairCode(
  streamId: number,
  missingRanges: BlockRange[]
): string {
  // Ensure ranges are sorted and merged
  const normalizedRanges = mergeRanges(sortRanges(missingRanges));

  // Encode components
  const streamIdEncoded = encodeCrockford(streamId, 7); // 32-bit needs up to 7 chars
  const rangesEncoded = encodeRanges(normalizedRanges);
  const rangesBase32 = encodeCrockford(
    new Uint8Array(rangesEncoded).reduce((acc, byte, i) => acc | (byte << (8 * (rangesEncoded.length - 1 - i))), 0),
    Math.ceil(rangesEncoded.length * 8 / 5)
  );

  // Build code body (before checksum)
  const body = `SF1-${streamIdEncoded}-${rangesBase32}`;

  // Check length bound
  if (body.length > MAX_REPAIR_CODE_LENGTH - 3) {
    // -3 for checksum and separator
    throw new RepairCodeError(
      'E-REPAIR-BOUNDS',
      `Repair code too long (${body.length + 3} chars): use QR format instead`,
      {length: body.length + 3, max: MAX_REPAIR_CODE_LENGTH}
    );
  }

  // Calculate checksum over body bytes
  const bodyBytes = new TextEncoder().encode(body);
  const checksum = crc8(bodyBytes);
  const checkEncoded = encodeCrockford(checksum, 2);

  return `${body}-${checkEncoded}`;
}

/**
 * Decode a repair code into its components.
 *
 * @param code - Repair code string
 * @returns Parsed repair code with stream ID and ranges
 * @throws {RepairCodeError} If invalid format, checksum, or bounds
 */
export function decodeRepairCode(code: string): ParsedRepairCode {
  // Validate format: SF1-<streamId32>-<ranges32>-<check>
  const parts = code.split('-');

  if (parts.length !== 4) {
    throw new RepairCodeError(
      'E-REPAIR-CODE',
      `Invalid repair code format: expected 4 parts, got ${parts.length}`,
      {code}
    );
  }

  const prefix = parts[0]!;
  const streamIdStr = parts[1]!;
  const rangesStr = parts[2]!;
  const checkStr = parts[3]!;

  if (prefix !== 'SF1') {
    throw new RepairCodeError(
      'E-REPAIR-CODE',
      `Invalid repair code prefix: ${prefix}`,
      {prefix}
    );
  }

  if (checkStr.length !== 2) {
    throw new RepairCodeError(
      'E-REPAIR-CODE',
      `Checksum must be 2 characters, got ${checkStr.length}`,
      {checksum: checkStr}
    );
  }

  // Reconstruct body for checksum validation
  const body = `${prefix}-${streamIdStr}-${rangesStr}`;
  const bodyBytes = new TextEncoder().encode(body);
  const expectedChecksum = crc8(bodyBytes);

  // Validate checksum
  const actualChecksum = decodeCrockford(checkStr);
  if (actualChecksum !== expectedChecksum) {
    throw new RepairCodeError(
      'E-REPAIR-CODE',
      `Checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
      {expected: expectedChecksum, actual: actualChecksum}
    );
  }

  // Decode components
  const streamId = decodeCrockford(streamIdStr);

  // Decode ranges
  const rangesValue = decodeCrockford(rangesStr);
  const rangesBytes = new Uint8Array(Math.ceil(rangesStr.length * 5 / 8));

  // Convert base32 value back to bytes (reverse of encoding)
  let value = rangesValue;
  for (let i = rangesBytes.length - 1; i >= 0; i--) {
    rangesBytes[i] = value & 0xff;
    value >>>= 8;
  }

  const ranges = decodeRanges(rangesBytes);

  return {streamId, ranges};
}

/**
 * Validate repair code bounds against block count.
 *
 * @param code - Parsed repair code
 * @param blockCount - Total number of blocks
 * @throws {RepairCodeError} If any range exceeds block count
 */
export function validateRepairCodeBounds(
  code: ParsedRepairCode,
  blockCount: number
): void {
  for (const range of code.ranges) {
    if (range.start >= blockCount) {
      throw new RepairCodeError(
        'E-REPAIR-BOUNDS',
        `Range start ${range.start} exceeds block count ${blockCount}`,
        {range, blockCount}
      );
    }

    if (range.end >= blockCount) {
      throw new RepairCodeError(
        'E-REPAIR-BOUNDS',
        `Range end ${range.end} exceeds block count ${blockCount}`,
        {range, blockCount}
      );
    }
  }
}

/**
 * Calculate total blocks in repair ranges.
 *
 * @param ranges - Block ranges
 * @returns Total number of blocks
 */
export function countBlocksInRanges(ranges: BlockRange[]): number {
  return ranges.reduce((total, range) => total + (range.end - range.start + 1), 0);
}

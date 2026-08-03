/**
 * Block bitmap operations for resume (D22).
 *
 * The receiver persists the completed-block bitmap; incomplete blocks restart rather
 * than persisting partial GE state. At 2.7 KB per 4 GB for the bitmaps this is
 * nearly free.
 *
 * **Bitmap structure:**
 * - One bit per block (1 = complete, 0 = incomplete)
 * - Size: ceil(blockCount / 8) bytes
 * - For 4 GB file (21,845 blocks): ~2.7 KB
 *
 * **Two bitmaps (session/types.ts BaseRecvState):**
 * - `complete`: blocks that have reached rank K (decoded)
 * - `writtenBlocks`: blocks that have been written to OPFS
 *
 * The separation is required for I9: blocks reaching rank K before their hash
 * arrives MAY be written to OPFS but MUST NOT be surfaced to the user until verified.
 *
 * Reference: plan.md §8.3, D22, I9
 */

/**
 * Calculate bitmap size in bytes for a given block count.
 *
 * @param blockCount - Number of blocks
 * @returns Number of bytes needed for the bitmap
 */
export function getBitmapSize(blockCount: number): number {
  return Math.ceil(blockCount / 8);
}

/**
 * Create a new empty bitmap (all zeros).
 *
 * @param blockCount - Number of blocks
 * @returns New bitmap initialized to all zeros
 */
export function createEmptyBitmap(blockCount: number): Uint8Array {
  const size = getBitmapSize(blockCount);
  return new Uint8Array(size);
}

/**
 * Create a new bitmap with specific blocks set.
 *
 * @param blockCount - Number of blocks
 * @param setBlocks - Array of block indices to set
 * @returns New bitmap with specified blocks set
 */
export function createBitmapWithBlocks(blockCount: number, setBlocks: number[]): Uint8Array {
  const bitmap = createEmptyBitmap(blockCount);
  for (const blockIndex of setBlocks) {
    if (blockIndex >= 0 && blockIndex < blockCount) {
      setBitmapBit(bitmap, blockIndex);
    }
  }
  return bitmap;
}

/**
 * Check if a specific block bit is set.
 *
 * @param bitmap - Block bitmap
 * @param blockIndex - Block index to check
 * @returns true if the block bit is set (complete), false otherwise
 */
export function isBitmapBitSet(bitmap: Uint8Array, blockIndex: number): boolean {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  return (bitmap[byteIndex]! & (1 << bitIndex)) !== 0;
}

/**
 * Set a specific block bit in the bitmap.
 *
 * @param bitmap - Block bitmap
 * @param blockIndex - Block index to set
 */
export function setBitmapBit(bitmap: Uint8Array, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  bitmap[byteIndex]! |= (1 << bitIndex);
}

/**
 * Clear a specific block bit in the bitmap.
 *
 * Used for E12 block hash failure when a block needs to be re-collected.
 *
 * @param bitmap - Block bitmap
 * @param blockIndex - Block index to clear
 */
export function clearBitmapBit(bitmap: Uint8Array, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  bitmap[byteIndex]! &= ~(1 << bitIndex);
}

/**
 * Count the number of set bits in a bitmap.
 *
 * Uses efficient population count (popcount) algorithm.
 *
 * @param bitmap - Block bitmap
 * @returns Number of set bits (complete blocks)
 */
export function countSetBits(bitmap: Uint8Array): number {
  let count = 0;
  for (const byte of bitmap) {
    count += popcount(byte);
  }
  return count;
}

/**
 * Population count (number of set bits) for a byte.
 *
 * Uses the classic popcount algorithm with parallel bit counting.
 *
 * @param x - Byte value
 * @returns Number of set bits
 */
function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

/**
 * Get all block indices with unset bits (missing blocks).
 *
 * Returns the complement of the set bits - useful for resume and repair codes.
 *
 * @param bitmap - Block bitmap
 * @param blockCount - Total number of blocks (may be less than bitmap capacity)
 * @returns Array of block indices that are NOT set (incomplete)
 */
export function getMissingBlocks(bitmap: Uint8Array, blockCount?: number): number[] {
  const missing: number[] = [];
  const totalBlocks = blockCount ?? bitmap.length * 8;

  for (let i = 0; i < totalBlocks; i++) {
    if (!isBitmapBitSet(bitmap, i)) {
      missing.push(i);
    }
  }

  return missing;
}

/**
 * Get all block indices with set bits (complete blocks).
 *
 * @param bitmap - Block bitmap
 * @param blockCount - Total number of blocks (may be less than bitmap capacity)
 * @returns Array of block indices that ARE set (complete)
 */
export function getCompleteBlocks(bitmap: Uint8Array, blockCount?: number): number[] {
  const complete: number[] = [];
  const totalBlocks = blockCount ?? bitmap.length * 8;

  for (let i = 0; i < totalBlocks; i++) {
    if (isBitmapBitSet(bitmap, i)) {
      complete.push(i);
    }
  }

  return complete;
}

/**
 * Check if all bits in the bitmap are set (all blocks complete).
 *
 * @param bitmap - Block bitmap
 * @param blockCount - Total number of blocks (may be less than bitmap capacity)
 * @returns true if all bits are set (no missing blocks)
 */
export function isBitmapComplete(bitmap: Uint8Array, blockCount?: number): boolean {
  const totalBlocks = blockCount ?? bitmap.length * 8;

  for (let i = 0; i < totalBlocks; i++) {
    if (!isBitmapBitSet(bitmap, i)) {
      return false;
    }
  }
  return true;
}

/**
 * Compute the bitwise AND of two bitmaps.
 *
 * Useful for computing intersection (e.g., for repair codes).
 *
 * @param a - First bitmap
 * @param b - Second bitmap
 * @returns New bitmap with AND of inputs
 */
export function bitmapAnd(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! & b[i]!;
  }
  return result;
}

/**
 * Compute the bitwise OR of two bitmaps.
 *
 * Useful for merging block states.
 *
 * @param a - First bitmap
 * @param b - Second bitmap
 * @returns New bitmap with OR of inputs
 */
export function bitmapOr(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! | b[i]!;
  }
  return result;
}

/**
 * Compute the bitwise XOR of two bitmaps.
 *
 * Useful for detecting differences (e.g., for debugging).
 *
 * @param a - First bitmap
 * @param b - Second bitmap
 * @returns New bitmap with XOR of inputs
 */
export function bitmapXor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! ^ b[i]!;
  }
  return result;
}

/**
 * Check if two bitmaps are equal.
 *
 * @param a - First bitmap
 * @param b - Second bitmap
 * @returns true if bitmaps are identical
 */
export function bitmapEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Serialize a bitmap to base64 for storage/transmission.
 *
 * Used for persisting resume tokens (D22).
 *
 * @param bitmap - Block bitmap
 * @returns Base64-encoded string
 */
export function serializeBitmap(bitmap: Uint8Array): string {
  // Convert to binary string then base64
  let binary = '';
  for (const byte of bitmap) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Deserialize a bitmap from base64.
 *
 * @param encoded - Base64-encoded bitmap string
 * @returns Block bitmap
 * @throws {Error} If decoding fails
 */
export function deserializeBitmap(encoded: string): Uint8Array {
  try {
    const binary = atob(encoded);
    const bitmap = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bitmap[i] = binary.charCodeAt(i);
    }
    return bitmap;
  } catch (e) {
    throw new Error(`Failed to deserialize bitmap: ${e}`);
  }
}

/**
 * Convert bitmap to a human-readable string for debugging.
 *
 * Shows a compact representation: 'C' for complete, '.' for incomplete.
 *
 * @param bitmap - Block bitmap
 * @param maxLength - Maximum length (default 64 blocks for readability)
 * @returns String representation
 */
export function bitmapToString(bitmap: Uint8Array, maxLength = 64): string {
  const totalBlocks = Math.min(bitmap.length * 8, maxLength);
  let result = '';
  for (let i = 0; i < totalBlocks; i++) {
    result += isBitmapBitSet(bitmap, i) ? 'C' : '.';
  }
  if (bitmap.length * 8 > maxLength) {
    result += '...';
  }
  return result;
}

/**
 * Calculate bitmap progress as a percentage.
 *
 * @param bitmap - Block bitmap
 * @param blockCount - Total number of blocks (may be less than bitmap capacity)
 * @returns Progress ratio (0.0 to 1.0)
 */
export function getBitmapProgress(bitmap: Uint8Array, blockCount?: number): number {
  const totalBlocks = blockCount ?? bitmap.length * 8;
  if (totalBlocks === 0) return 1.0;
  const complete = countSetBits(bitmap);
  return complete / totalBlocks;
}

/**
 * Validate that a bitmap has the expected size for a given block count.
 *
 * @param bitmap - Block bitmap to validate
 * @param blockCount - Expected block count
 * @returns true if size is correct
 */
export function validateBitmapSize(bitmap: Uint8Array, blockCount: number): boolean {
  const expectedSize = getBitmapSize(blockCount);
  return bitmap.length === expectedSize;
}

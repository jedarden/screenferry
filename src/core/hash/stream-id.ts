/**
 * streamId derivation (§7.5).
 *
 * Implements deterministic streamId generation from file metadata and content samples.
 * Critical for cross-session resume (D22): re-selecting the same file MUST reproduce
 * the same streamId.
 *
 * **Derivation (sender):**
 * ```
 * streamId = CRC32( originalSize ‖ first 64 KB ‖ middle 64 KB ‖ last 64 KB ‖ lastModified )
 * ```
 *
 * **Critical:** `originalSize` is the **uncompressed** file size (the beacon's `originalSize`
 * field), NOT the compressed payload size (`payloadLen`). This is required because:
 *
 * - **Resume (D22):** `streamId` identifies the FILE the user selected, not the compressed
 *   version. Using `originalSize` ensures the same file always produces the same `streamId`
 *   regardless of compression settings.
 * - **Security separation:** E3a's block arithmetic uses `payloadLen` (compressed size) from
 *   the beacon to compute the last block's short length. T1's quota check, T3's decompression-
 *   bomb cap, and D23's ETA all use `originalSize` from the beacon. `streamId` participates
 *   in the original-size domain because it identifies the user's chosen file.
 *
 * Three sampled windows plus size and mtime. Costs ~200 KB of reads regardless of file size,
 * so it is instant even for 4 TB.
 *
 * **What this buys and what it does not:**
 *
 * - ✅ Same file re-selected → same `streamId` → resume works.
 * - ✅ Different files → different `streamId` with overwhelming probability.
 * - ⚠️ A file edited **only in the middle**, keeping size and mtime, collides. Mitigated by
 *   including `lastModified`, and by per-block hashes catching the mismatch at block level.
 * - ⚠️ This is **not** a content-integrity hash. The whole-file hash (§7.2) **is** a
 *   content-integrity hash and is mandatory per concept.md constraint 4. `streamId` is an
 *   *identifier*.
 *
 * Deliberately **not** `crc32(payload)` — the research's original design — because the
 * block layer made a full-payload pass unaffordable.
 *
 * Reference: plan.md §7.5, D22, D7
 */

import {crc32} from '../frame/crc.js';

/**
 * Sample size for each window (first, middle, last).
 *
 * 64 KB is chosen to provide strong identification at minimal read cost.
 * Three samples = 192 KB of data regardless of file size.
 */
export const STREAM_ID_SAMPLE_SIZE = 64 * 1024; // 64 KB

/**
 * Maximum total read size for streamId computation.
 *
 * Used for progress tracking and bounds checking.
 */
export const STREAM_ID_MAX_READ = STREAM_ID_SAMPLE_SIZE * 3 + 24; // 3 samples + size + mtime

/**
 * Compute streamId from a File object.
 *
 * This is the primary entry point for sender-side streamId generation.
 * It reads three samples from the file, combines them with metadata,
 * and computes the CRC-32 to produce a deterministic identifier.
 *
 * **Performance:** For large files, this is much faster than reading the entire file.
 * For a 4 GB file, this reads ~200 KB instead of 4 GB (~20,000× faster).
 *
 * **Browser compatibility:** Uses File.slice() which is available in all modern browsers.
 * The slice operation is zero-copy in most implementations.
 *
 * @param file - File object to identify
 * @returns Promise resolving to 32-bit streamId
 * @throws {Error} If file reading fails
 *
 * @example
 * ```ts
 * const file = fileInput.files[0];
 * const streamId = await computeStreamId(file);
 * beacon.streamId = streamId;
 * ```
 */
export async function computeStreamId(file: File): Promise<number> {
  const originalSize = file.size;
  const lastModified = file.lastModified;

  // Handle zero-byte files (E1)
  if (originalSize === 0) {
    throw new Error('Cannot compute streamId for zero-byte file (E1)');
  }

  // Handle files smaller than one sample
  if (originalSize <= STREAM_ID_SAMPLE_SIZE * 3) {
    // Small file: read the whole thing and use it as all three samples
    const sample = await readFileSlice(file, 0, originalSize);
    return computeStreamIdFromSamples(originalSize, lastModified, sample, sample, sample);
  }

  // Large file: read three samples
  const firstSample = await readFileSlice(file, 0, STREAM_ID_SAMPLE_SIZE);

  const middleOffset = Math.floor((originalSize - STREAM_ID_SAMPLE_SIZE) / 2);
  const middleSample = await readFileSlice(file, middleOffset, STREAM_ID_SAMPLE_SIZE);

  const lastOffset = originalSize - STREAM_ID_SAMPLE_SIZE;
  const lastSample = await readFileSlice(file, lastOffset, STREAM_ID_SAMPLE_SIZE);

  return computeStreamIdFromSamples(
    originalSize,
    lastModified,
    firstSample,
    middleSample,
    lastSample
  );
}

/**
 * Read a slice from a File object.
 *
 * Helper function to read a range of bytes from a file using File.slice().
 * Uses FileReader for browser compatibility (File.arrayBuffer() is newer).
 *
 * @param file - File to read from
 * @param start - Starting byte offset
 * @param length - Number of bytes to read
 * @returns Promise resolving to Uint8Array of the slice
 * @throws {Error} If read fails
 */
async function readFileSlice(file: File, start: number, length: number): Promise<Uint8Array> {
  const slice = file.slice(start, start + length);

  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result === null) {
        reject(new Error('FileReader returned null'));
        return;
      }
      // Get raw bytes from ArrayBuffer
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    };
    reader.onerror = () => reject(new Error(`FileReader error: ${reader.error}`));
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Compute streamId from pre-read samples.
 *
 * This is the core derivation function. It combines the metadata and samples
 * in the exact order specified by the plan and computes the CRC-32.
 *
 * **Order is normative:** The exact concatenation order is part of the wire format.
 * Changing this order would change streamId values and break compatibility.
 *
 * **Format:**
 * ```
 * [originalSize: 8 bytes big-endian]
 * [firstSample: STREAM_ID_SAMPLE_SIZE bytes]
 * [middleSample: STREAM_ID_SAMPLE_SIZE bytes]
 * [lastSample: STREAM_ID_SAMPLE_SIZE bytes]
 * [lastModified: 8 bytes big-endian]
 * ```
 *
 * @param originalSize - Uncompressed file size in bytes
 * @param lastModified - File modification timestamp (ms since epoch)
 * @param firstSample - First 64 KB of file
 * @param middleSample - Middle 64 KB of file
 * @param lastSample - Last 64 KB of file
 * @returns 32-bit streamId
 */
export function computeStreamIdFromSamples(
  originalSize: number,
  lastModified: number,
  firstSample: Uint8Array,
  middleSample: Uint8Array,
  lastSample: Uint8Array
): number {
  // Calculate total size: 8 + 8 + 3 samples
  const totalSize = 8 + 8 + firstSample.length + middleSample.length + lastSample.length;

  // Create combined buffer
  const combined = new Uint8Array(totalSize);
  let offset = 0;

  // Write originalSize as 8-byte big-endian
  writeU64BE(combined, offset, originalSize);
  offset += 8;

  // Write samples
  combined.set(firstSample, offset);
  offset += firstSample.length;

  combined.set(middleSample, offset);
  offset += middleSample.length;

  combined.set(lastSample, offset);
  offset += lastSample.length;

  // Write lastModified as 8-byte big-endian
  writeU64BE(combined, offset, lastModified);
  offset += 8;

  // Compute CRC-32
  return crc32(combined);
}

/**
 * Write a 64-bit unsigned integer as big-endian bytes.
 *
 * @param buffer - Buffer to write to
 * @param offset - Starting offset
 * @param value - Value to write (treated as unsigned)
 */
function writeU64BE(buffer: Uint8Array, offset: number, value: number): void {
  // Use >>> 0 to force unsigned interpretation
  const v = value >>> 0;
  buffer[offset] = (v >>> 56) & 0xff;
  buffer[offset + 1] = (v >>> 48) & 0xff;
  buffer[offset + 2] = (v >>> 40) & 0xff;
  buffer[offset + 3] = (v >>> 32) & 0xff;
  buffer[offset + 4] = (v >>> 24) & 0xff;
  buffer[offset + 5] = (v >>> 16) & 0xff;
  buffer[offset + 6] = (v >>> 8) & 0xff;
  buffer[offset + 7] = v & 0xff;
}

/**
 * Compute streamId from raw file bytes (for testing).
 *
 * This is a convenience function for tests that already have the file bytes.
 * It handles small files automatically.
 *
 * @param fileBytes - Complete file contents
 * @param lastModified - File modification timestamp
 * @returns 32-bit streamId
 */
export function computeStreamIdFromBytes(fileBytes: Uint8Array, lastModified: number): number {
  const originalSize = fileBytes.length;

  if (originalSize === 0) {
    throw new Error('Cannot compute streamId for zero-byte file (E1)');
  }

  if (originalSize <= STREAM_ID_SAMPLE_SIZE * 3) {
    // Small file: use whole file as all three samples
    return computeStreamIdFromSamples(
      originalSize,
      lastModified,
      fileBytes,
      fileBytes,
      fileBytes
    );
  }

  // Large file: extract three samples
  const firstSample = fileBytes.slice(0, STREAM_ID_SAMPLE_SIZE);

  const middleOffset = Math.floor((originalSize - STREAM_ID_SAMPLE_SIZE) / 2);
  const middleSample = fileBytes.slice(middleOffset, middleOffset + STREAM_ID_SAMPLE_SIZE);

  const lastOffset = originalSize - STREAM_ID_SAMPLE_SIZE;
  const lastSample = fileBytes.slice(lastOffset);

  return computeStreamIdFromSamples(
    originalSize,
    lastModified,
    firstSample,
    middleSample,
    lastSample
  );
}

/**
 * Validate that a streamId matches expected value.
 *
 * Used by the receiver to lock onto the correct stream when multiple senders
 * are visible (A9). Also used for E18 resume mismatch detection.
 *
 * @param file - File to check
 * @param expectedStreamId - Expected streamId value
 * @returns Promise resolving to true if streamId matches
 * @throws {Error} If computation fails
 */
export async function validateStreamId(file: File, expectedStreamId: number): Promise<boolean> {
  const actualStreamId = await computeStreamId(file);
  return actualStreamId === expectedStreamId;
}

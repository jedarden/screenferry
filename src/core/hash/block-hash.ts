/**
 * Block hash computation and manifest validation (§7.6).
 *
 * Implements per-block SHA-256 hashing and manifest integrity validation via CRC-32.
 * The manifest roots the cryptographic chain: beacon → manifest → blocks → whole file.
 *
 * **Why the manifest hash is mandatory:**
 * Without it, a single flipped byte in the manifest packet would yield wrong hashes
 * for hundreds of blocks. Those blocks would fail E12 forever (re-collect, fail,
 * re-collect) with no error code and no termination. The manifest hash detects this
 * corruption immediately and forces re-decode of the manifest.
 *
 * Reference: plan.md §7.2, §7.6, §12 (T1)
 */

import {crc32} from '../frame/crc.js';

/**
 * Compute the SHA-256 hash of a block and truncate it.
 *
 * Per plan.md §7.6, block hashes are SHA-256 truncated to blockHashLen bytes
 * (default 4 bytes). This provides a per-block false accept rate of 2^-32 (~5×10^-6),
 * which across 21,845 blocks (4 GB file) yields ~0.01 expected collisions — comfortably
 * below the whole-file hash's job.
 *
 * **Performance note:** This uses crypto.subtle.digest which is async. For a 192 KB
 * block at 768 fragments, this is called once per block on the sender and once per
 * verified block on the receiver.
 *
 * @param block - Block data (K × L bytes, typically 192 KB)
 * @param blockHashLen - Truncation length (from beacon, typically 4 bytes)
 * @returns Promise resolving to truncated hash bytes
 * @throws {Error} If blockHashLen is invalid or Web Crypto API fails
 */
export async function computeBlockHash(block: Uint8Array, blockHashLen: number): Promise<Uint8Array> {
  if (blockHashLen < 1 || blockHashLen > 32) {
    throw new Error(
      `Invalid blockHashLen: ${blockHashLen} (must be 1-32 bytes for SHA-256 truncation)`
    );
  }

  // Compute full SHA-256 hash
  const fullHash = await crypto.subtle.digest('SHA-256', block);

  // Truncate to blockHashLen bytes
  return new Uint8Array(fullHash).slice(0, blockHashLen);
}

/**
 * Compute the manifest hash (CRC-32) for beacon transmission.
 *
 * The manifest is `blockCount × blockHashLen` bytes containing all block hashes
 * in block order. This function computes its CRC-32 for the beacon's manifestHash
 * field (§7.2), enabling receivers to validate manifest integrity.
 *
 * **Critical:** This CRC-32 is the ONLY integrity check for the manifest data.
 * A corrupted manifest would cause hundreds of blocks to fail verification
 * forever (infinite E12 retry loop). The manifest hash prevents this livelock.
 *
 * @param manifest - Block hash manifest data (blockCount × blockHashLen bytes)
 * @returns CRC-32 checksum (4 bytes as big-endian number)
 */
export function computeManifestHash(manifest: Uint8Array): number {
  return crc32(manifest);
}

/**
 * Validate a decoded manifest against the beacon's hash.
 *
 * After fountain-decoding the manifest (§7.6), the receiver MUST compute its CRC-32
 * and compare against the beacon's manifestHash field. A mismatch indicates manifest
 * corruption and MUST cause the manifest to be discarded and re-decoded.
 *
 * This prevents the infinite E12 failure loop: without validation, a corrupted
 * manifest would cause blocks to fail hash verification forever with no error code
 * or termination.
 *
 * @param manifest - Decoded manifest data (blockCount × blockHashLen bytes)
 * @param beaconManifestHash - 4-byte manifest hash from beacon (§7.2)
 * @returns true if valid, false if corrupted
 * @throws {Error} If inputs are malformed
 */
export function validateManifestHash(
  manifest: Uint8Array,
  beaconManifestHash: Uint8Array
): boolean {
  if (beaconManifestHash.length !== 4) {
    throw new Error(
      `Beacon manifestHash must be 4 bytes, got ${beaconManifestHash.length}`
    );
  }

  if (manifest.length === 0) {
    throw new Error('Manifest data cannot be empty');
  }

  // Compute CRC-32 of decoded manifest
  const computedHash = computeManifestHash(manifest);

  // Convert beacon's 4-byte hash to number (big-endian)
  const beaconHash = (
    (beaconManifestHash[0]! << 24) |
    (beaconManifestHash[1]! << 16) |
    (beaconManifestHash[2]! << 8) |
    beaconManifestHash[3]!
  ) >>> 0; // Force unsigned

  return computedHash === beaconHash;
}

/**
 * Extract a block's hash from the manifest.
 *
 * The manifest stores block hashes sequentially in block order. This helper
 * extracts the hash for a specific block.
 *
 * @param manifest - Block hash manifest (blockCount × blockHashLen bytes)
 * @param blockIndex - Which block's hash to extract
 * @param blockHashLen - Hash length (from beacon)
 * @returns Hash bytes for the requested block
 * @throws {Error} If blockIndex is out of range
 */
export function extractBlockHash(
  manifest: Uint8Array,
  blockIndex: number,
  blockHashLen: number
): Uint8Array {
  const offset = blockIndex * blockHashLen;
  const end = offset + blockHashLen;

  if (end > manifest.length) {
    throw new Error(
      `Block ${blockIndex} hash extends beyond manifest (offset=${offset}, ` +
      `manifestLen=${manifest.length}, blockHashLen=${blockHashLen})`
    );
  }

  return manifest.slice(offset, end);
}

/**
 * Verify a decoded block against its manifest hash.
 *
 * Called after a block reaches rank K and is recovered. If the block's hash
 * doesn't match the manifest, the block is corrupted (E12) and must be re-collected.
 *
 * **Security:** This is the ONLY application-layer check on payload bytes. The
 * per-packet fcrc (CRC-8) is a routing guard, not integrity. QR's Reed-Solomon
 * makes undetected corruption rare but not impossible. This check catches it.
 *
 * @param block - Decoded block data
 * @param blockIndex - Block index (for manifest lookup)
 * @param manifest - Block hash manifest
 * @param blockHashLen - Hash truncation length
 * @returns Promise resolving to true if hash matches, false otherwise
 * @throws {Error} If parameters are invalid
 */
export async function verifyBlockHash(
  block: Uint8Array,
  blockIndex: number,
  manifest: Uint8Array,
  blockHashLen: number
): Promise<boolean> {
  // Extract expected hash from manifest
  const expectedHash = extractBlockHash(manifest, blockIndex, blockHashLen);

  // Compute actual hash of decoded block
  const actualHash = await computeBlockHash(block, blockHashLen);

  // Compare
  if (actualHash.length !== expectedHash.length) {
    throw new Error(
      `Hash length mismatch: computed ${actualHash.length}, expected ${expectedHash.length}`
    );
  }

  // Constant-time compare to avoid timing attacks (though not critical here)
  let match = true;
  for (let i = 0; i < actualHash.length; i++) {
    if (actualHash[i]! !== expectedHash[i]!) {
      match = false;
      // Continue loop for constant-time
    }
  }

  return match;
}

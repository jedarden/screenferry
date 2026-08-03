/**
 * Per-block hash verification module (bf-4d6 F1).
 *
 * Implements per-block hash verification on resume rather than trusting the bitmap.
 * This prevents data corruption from:
 * - OPFS corruption
 * - External file modification
 * - Bitmap inconsistencies
 *
 * Reference: plan.md §8.3, §7.3, E12
 */

import {computeBlockHash, extractBlockHash} from './block-hash.js';
import type {BlockHashManifest} from '../session/types.js';
import type {BaseRecvState} from '../session/types.js';
import type {PositionalWriteHandle} from '../io/positional-write.js';
import {getMissingBlocks} from '../session/types.js';

/**
 * Block verification result.
 */
export interface BlockVerificationResult {
  /** Block index */
  blockIndex: number;
  /** Whether hash verification passed */
  verified: boolean;
  /** Error message if verification failed */
  error?: string;
}

/**
 * Batch verification result for all blocks.
 */
export interface BatchVerificationResult {
  /** Total blocks verified */
  totalBlocks: number;
  /** Blocks that passed verification */
  passedBlocks: number[];
  /** Blocks that failed verification */
  failedBlocks: BlockVerificationResult[];
  /** Blocks that were missing (not written) */
  missingBlocks: number[];
  /** Verification duration in milliseconds */
  duration: number;
}

/**
 * Verify a single block against its hash.
 *
 * Reads the block from OPFS, computes its hash, and compares with the expected hash.
 *
 * @param blockIndex - Block index to verify
 * @param handle - Positional write handle for reading
 * @param manifest - Block hash manifest
 * @param meta - Beacon metadata for block size
 * @param writtenBlocks - Bitmap of written blocks
 * @returns Verification result
 */
export async function verifyBlock(
  blockIndex: number,
  handle: PositionalWriteHandle,
  manifest: BlockHashManifest,
  meta: { blockSize: number; blockHashLen: number },
  writtenBlocks: Uint8Array
): Promise<BlockVerificationResult> {
  const startTime = performance.now();

  try {
    // Check if block is written
    const byteIndex = Math.floor(blockIndex / 8);
    const bitIndex = blockIndex % 8;
    const isWritten = (writtenBlocks[byteIndex]! & (1 << bitIndex)) !== 0;

    if (!isWritten) {
      return {
        blockIndex,
        verified: false,
        error: 'Block not written',
      };
    }

    // Read block from OPFS
    const offset = blockIndex * meta.blockSize;
    const blockData = await handle.read(offset, meta.blockSize);

    if (!blockData || blockData.length === 0) {
      return {
        blockIndex,
        verified: false,
        error: 'Failed to read block',
      };
    }

    // Compute hash of block
    const hash = await computeBlockHash(blockData, meta.blockHashLen);

    // Extract expected hash from manifest
    const expectedHash = extractBlockHash(manifest.hashes, blockIndex, meta.blockHashLen);

    // Compare hashes (constant-time comparison)
    const hashMatch = constantTimeCompare(hash, expectedHash);

    const duration = performance.now() - startTime;

    if (!hashMatch) {
      return {
        blockIndex,
        verified: false,
        error: `Hash mismatch (computed: ${Array.from(hash).map(b => b.toString(16).padStart(2, '0')).join('')})`,
      };
    }

    return {
      blockIndex,
      verified: true,
    };
  } catch (error) {
    return {
      blockIndex,
      verified: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Verify all written blocks against their hashes (bf-4d6 F1).
 *
 * This is called on resume to ensure data integrity rather than trusting the bitmap.
 * Per plan §8.3: "On resume the receiver MUST re-verify block hashes rather than
 * trusting the bitmap, in case OPFS was corrupted or the file was touched externally."
 *
 * @param handle - Positional write handle for reading blocks
 * @param manifest - Block hash manifest
 * @param meta - Beacon metadata
 * @param writtenBlocks - Bitmap of written blocks
 * @returns Batch verification result
 */
export async function verifyWrittenBlocks(
  handle: PositionalWriteHandle,
  manifest: BlockHashManifest,
  meta: { blockSize: number; blockCount: number; blockHashLen: number },
  writtenBlocks: Uint8Array
): Promise<BatchVerificationResult> {
  const startTime = performance.now();

  const passedBlocks: number[] = [];
  const failedBlocks: BlockVerificationResult[] = [];
  const missingBlocks: number[] = [];

  // Verify all blocks marked as written in the bitmap
  for (let blockIndex = 0; blockIndex < meta.blockCount; blockIndex++) {
    const byteIndex = Math.floor(blockIndex / 8);
    const bitIndex = blockIndex % 8;
    const isWritten = (writtenBlocks[byteIndex]! & (1 << bitIndex)) !== 0;

    if (!isWritten) {
      missingBlocks.push(blockIndex);
      continue;
    }

    const result = await verifyBlock(blockIndex, handle, manifest, meta, writtenBlocks);

    if (result.verified) {
      passedBlocks.push(blockIndex);
    } else {
      failedBlocks.push(result);
      // Clear failed block from written bitmap so it will be re-collected
      const byteIndex = Math.floor(blockIndex / 8);
      const bitIndex = blockIndex % 8;
      writtenBlocks[byteIndex]! &= ~(1 << bitIndex);
    }
  }

  const duration = performance.now() - startTime;

  console.log(`[Block Verification] Verified ${passedBlocks.length} blocks, ${failedBlocks.length} failed, ${missingBlocks.length} missing in ${duration.toFixed(2)}ms`);

  return {
    totalBlocks: meta.blockCount,
    passedBlocks,
    failedBlocks,
    missingBlocks,
    duration,
  };
}

/**
 * Constant-time hash comparison to prevent timing attacks.
 *
 * While timing attacks are less relevant for this use case ( hashes are local),
 * constant-time comparison is a best practice for cryptographic operations.
 */
function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }

  return result === 0;
}

/**
 * Generate missing block manifest for partial export (bf-4d6 F1).
 *
 * When quota is exhausted mid-transfer (E10), this function generates a manifest
 * of missing blocks that can be used for repair or partial file identification.
 *
 * @param writtenBlocks - Bitmap of written blocks
 * @param meta - Beacon metadata
 * @returns Array of missing block indices
 */
export function generateMissingBlockManifest(
  writtenBlocks: Uint8Array,
  meta: { blockCount: number }
): number[] {
  return getMissingBlocks(writtenBlocks);
}

/**
 * Format block verification result for user display.
 */
export function formatVerificationResult(result: BatchVerificationResult): string {
  const lines: string[] = [];

  lines.push(`Block Verification Summary:`);
  lines.push(`  Total blocks: ${result.totalBlocks}`);
  lines.push(`  Verified: ${result.passedBlocks.length}`);
  lines.push(`  Failed: ${result.failedBlocks.length}`);
  lines.push(`  Missing: ${result.missingBlocks.length}`);
  lines.push(`  Duration: ${result.duration.toFixed(2)}ms`);

  if (result.failedBlocks.length > 0) {
    lines.push(`\nFailed blocks:`);
    for (const failed of result.failedBlocks.slice(0, 10)) { // Show first 10
      lines.push(`  Block ${failed.blockIndex}: ${failed.error}`);
    }
    if (result.failedBlocks.length > 10) {
      lines.push(`  ... and ${result.failedBlocks.length - 10} more`);
    }
  }

  return lines.join('\n');
}

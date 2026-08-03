/**
 * Block scheduling and dwell management (Phase 4).
 *
 * Implements §8.1 block scheduling and dwell budget:
 * - Dwell scheduling: sender dwells on each block for dwellPackets before advancing
 * - Repair code targeting: sender can retransmit only specific blocks
 * - Loop management: sender loops continuously through all blocks
 *
 * Reference: plan.md §8.1, §8.2, D22, D24
 */

import { K, DWELL_FACTOR } from '../params.js';

/**
 * Block cursor position in the stream.
 */
export interface BlockCursor {
  /** Current block index */
  blockIndex: number;
  /** Sequence number within the current block */
  seq: number;
}

/**
 * Dwell configuration for a session.
 */
export interface DwellConfig {
  /** Number of packets to emit per block before advancing */
  dwellPackets: number;
  /** Total number of blocks in the stream */
  blockCount: number;
}

/**
 * Create default dwell configuration.
 *
 * Uses DWELL_FACTOR (1.6×K) as the default dwell, which survives the top of the
 * assumed erasure band (20–30%) per §8.1.
 *
 * @param blockCount - Total number of blocks
 * @returns Dwell configuration
 */
export function createDwellConfig(blockCount: number): DwellConfig {
  return {
    dwellPackets: Math.ceil(K * DWELL_FACTOR),
    blockCount,
  };
}

/**
 * Create custom dwell configuration with explicit dwell.
 *
 * @param dwellPackets - Packets per block
 * @param blockCount - Total number of blocks
 * @returns Dwell configuration
 */
export function createCustomDwellConfig(
  dwellPackets: number,
  blockCount: number
): DwellConfig {
  if (dwellPackets <= 0) {
    throw new Error(`Dwell must be positive, got ${dwellPackets}`);
  }
  if (blockCount <= 0) {
    throw new Error(`Block count must be positive, got ${blockCount}`);
  }
  return { dwellPackets, blockCount };
}

/**
 * Block scheduler for sender-side transmission.
 *
 * Implements stateless block scheduling per D24: the sender is stateless across
 * restarts when compression is disabled, using only the file and streamId.
 *
 * The scheduler:
 * 1. Dwells on each block for dwellPackets before advancing
 * 2. Loops continuously through all blocks
 * 3. Can target specific blocks for repair codes (§8.2)
 */
export class BlockScheduler {
  private readonly config: DwellConfig;
  private cursor: BlockCursor;

  constructor(config: DwellConfig, startCursor?: BlockCursor) {
    this.config = config;
    this.cursor = startCursor || { blockIndex: 0, seq: 0 };
  }

  /**
   * Get current cursor position.
   */
  getCursor(): BlockCursor {
    return { ...this.cursor };
  }

  /**
   * Set cursor position (for resume or repair targeting).
   */
  setCursor(cursor: BlockCursor): void {
    if (cursor.blockIndex < 0 || cursor.blockIndex >= this.config.blockCount) {
      throw new Error(
        `Block index ${cursor.blockIndex} out of range [0, ${this.config.blockCount})`
      );
    }
    if (cursor.seq < 0) {
      throw new Error(`Sequence ${cursor.seq} must be non-negative`);
    }
    this.cursor = { ...cursor };
  }

  /**
   * Check if current block is complete (dwell satisfied).
   */
  isBlockComplete(): boolean {
    return this.cursor.seq >= this.config.dwellPackets;
  }

  /**
   * Advance to next packet in the stream.
   *
   * Advances within the current block until dwell is satisfied, then moves to
   * the next block. Wraps around to block 0 after the last block.
   *
   * @returns The (blockIndex, seq) for the next packet to emit
   */
  advance(): BlockCursor {
    const current = { ...this.cursor };

    // Advance within current block
    this.cursor.seq++;

    // Check if dwell is satisfied
    if (this.isBlockComplete()) {
      // Move to next block, reset sequence
      this.cursor.blockIndex =
        (this.cursor.blockIndex + 1) % this.config.blockCount;
      this.cursor.seq = 0;
    }

    return current;
  }

  /**
   * Calculate progress percentage for a block.
   *
   * @param blockIndex - Block to check
   * @returns Progress 0–1, or 0 if block hasn't been started
   */
  getBlockProgress(blockIndex: number): number {
    if (blockIndex < 0 || blockIndex >= this.config.blockCount) {
      throw new Error(`Block index ${blockIndex} out of range`);
    }

    // If we haven't reached this block yet, progress is 0
    if (this.cursor.blockIndex < blockIndex) {
      return 0;
    }

    // If we've passed this block, progress is 1
    if (this.cursor.blockIndex > blockIndex) {
      return 1;
    }

    // We're at this block - calculate based on seq
    return Math.min(this.cursor.seq / this.config.dwellPackets, 1);
  }

  /**
   * Estimate total packets to complete one full pass through all blocks.
   */
  estimatePassPackets(): number {
    return this.config.dwellPackets * this.config.blockCount;
  }

  /**
   * Estimate packets remaining in current pass.
   */
  estimateRemainingPackets(): number {
    const blocksRemaining = this.config.blockCount - this.cursor.blockIndex - 1;
    const currentBlockRemaining = this.config.dwellPackets - this.cursor.seq;
    return (
      currentBlockRemaining + blocksRemaining * this.config.dwellPackets
    );
  }

  /**
   * Create a repair-mode scheduler targeting specific blocks.
   *
   * Per §8.2, the repair code allows retransmitting only missing blocks.
   * This creates a scheduler that loops only through the specified blocks.
   *
   * @param targetBlocks - Block indices to retransmit
   * @param dwellPackets - Optional custom dwell (uses default if not specified)
   * @returns New scheduler for repair mode
   */
  static forRepair(targetBlocks: number[], dwellPackets?: number): BlockScheduler {
    if (targetBlocks.length === 0) {
      throw new Error('Repair requires at least one target block');
    }

    // Sort and dedupe
    const uniqueBlocks = [...new Set(targetBlocks)].sort((a, b) => a - b);

    // Validate block indices
    for (const block of uniqueBlocks) {
      if (block < 0) {
        throw new Error(`Block index ${block} is negative`);
      }
    }

    // Create repair scheduler with specified or default dwell
    const actualDwell = dwellPackets ?? Math.ceil(K * DWELL_FACTOR);
    const config = createCustomDwellConfig(actualDwell, uniqueBlocks.length);
    const scheduler = new BlockScheduler(config);

    // Store the target blocks for mapping
    const targetBlocksRef = uniqueBlocks;

    // Override getCursor() to return mapped block index
    const originalGetCursor = scheduler.getCursor.bind(scheduler);
    scheduler.getCursor = function (): BlockCursor {
      const logical = originalGetCursor();
      return {
        blockIndex: targetBlocksRef[logical.blockIndex]!,
        seq: logical.seq,
      };
    };

    // Override advance() to map logical indices to actual block indices
    const originalAdvance = scheduler.advance.bind(scheduler);
    scheduler.advance = function (): BlockCursor {
      const logical = originalAdvance();
      return {
        blockIndex: targetBlocksRef[logical.blockIndex]!,
        seq: logical.seq,
      };
    };

    return scheduler;
  }
}

/**
 * Time estimation thresholds (D23).
 *
 * Per plan §13.1, these thresholds determine user warnings and refusal:
 * - Warn threshold: > 30 min → explicit user confirmation required
 * - Refuse threshold: > 24 h → refuse transfer with override option
 */
export const TIME_THRESHOLDS = {
  /** Warn threshold in seconds (30 minutes) */
  WARN_SECONDS: 30 * 60,
  /** Refuse threshold in seconds (24 hours) */
  REFUSE_SECONDS: 24 * 60 * 60,
} as const;

/**
 * Time estimation result with user guidance.
 */
export interface TimeEstimate {
  /** Estimated seconds (null if no measurement yet) */
  seconds: number | null;
  /** User guidance level */
  guidance: 'proceed' | 'warn' | 'refuse';
  /** Human-readable duration string */
  duration: string;
  /** Whether user confirmation is required */
  requiresConfirmation: boolean;
  /** Whether transfer should be refused */
  shouldRefuse: boolean;
}

/**
 * Time estimation for transfers (D23).
 *
 * Estimates transfer time based on measured packet rate and remaining packets.
 * Provides user-facing estimates before transfer commitment with threshold-based
 * guidance per §13.1.
 */
export class TimeEstimator {
  private packetsPerSecond: number | null = null;
  private measurementCount = 0;

  /**
   * Update packet rate measurement.
   *
   * @param packetsPerSecond - Measured goodput (packets/sec)
   */
  updateRate(packetsPerSecond: number): void {
    if (packetsPerSecond <= 0) {
      throw new Error(
        `Packet rate must be positive, got ${packetsPerSecond}`
      );
    }

    if (this.packetsPerSecond === null) {
      this.packetsPerSecond = packetsPerSecond;
      this.measurementCount = 1;
    } else {
      // Exponential moving average with α = 0.1
      this.packetsPerSecond =
        0.1 * packetsPerSecond + 0.9 * this.packetsPerSecond;
      this.measurementCount++;
    }
  }

  /**
   * Check if we have enough measurements to estimate.
   */
  hasEstimate(): boolean {
    return this.packetsPerSecond !== null && this.measurementCount >= 3;
  }

  /**
   * Estimate total transfer time in seconds.
   *
   * @param totalBlocks - Total blocks to transfer
   * @param dwellPackets - Dwell per block
   * @param erasureRate - Assumed erasure rate (default 0.25 = middle of 20–30% band)
   * @returns Estimated seconds, or null if no rate measurement
   */
  estimateTotalSeconds(
    totalBlocks: number,
    dwellPackets: number,
    erasureRate = 0.25
  ): number | null {
    if (!this.hasEstimate()) {
      return null;
    }

    // Account for erasure: need to emit dwellPackets * (1 + erasure) per block
    const effectivePacketsPerBlock = dwellPackets * (1 + erasureRate);
    const totalPackets = totalBlocks * effectivePacketsPerBlock;

    return totalPackets / this.packetsPerSecond!;
  }

  /**
   * Estimate remaining time in seconds.
   *
   * @param remainingPackets - Packets remaining in transfer
   * @returns Estimated seconds, or null if no rate measurement
   */
  estimateRemainingSeconds(remainingPackets: number): number | null {
    if (!this.hasEstimate()) {
      return null;
    }

    // Account for erasure in remaining packets
    const erasurePadding = 1.25; // +25% for 20–30% band
    const effectivePackets = remainingPackets * erasurePadding;

    return effectivePackets / this.packetsPerSecond!;
  }

  /**
   * Get current packet rate estimate.
   */
  getRate(): number | null {
    return this.packetsPerSecond;
  }

  /**
   * Reset measurements.
   */
  reset(): void {
    this.packetsPerSecond = null;
    this.measurementCount = 0;
  }

  /**
   * Get full estimate with user guidance (D23).
   *
   * Returns a complete estimate object with guidance level, human-readable
   * duration, and flags for confirmation requirements and refusal.
   *
   * @param totalBlocks - Total blocks to transfer
   * @param dwellPackets - Dwell per block
   * @param erasureRate - Assumed erasure rate (default 0.25 = middle of 20–30% band)
   * @returns Time estimate with guidance
   */
  getEstimate(
    totalBlocks: number,
    dwellPackets: number,
    erasureRate = 0.25
  ): TimeEstimate {
    const seconds = this.estimateTotalSeconds(totalBlocks, dwellPackets, erasureRate);

    if (seconds === null) {
      return {
        seconds: null,
        guidance: 'proceed',
        duration: 'Measuring...',
        requiresConfirmation: false,
        shouldRefuse: false,
      };
    }

    // Determine guidance level per D23
    let guidance: 'proceed' | 'warn' | 'refuse';
    if (seconds >= TIME_THRESHOLDS.REFUSE_SECONDS) {
      guidance = 'refuse';
    } else if (seconds >= TIME_THRESHOLDS.WARN_SECONDS) {
      guidance = 'warn';
    } else {
      guidance = 'proceed';
    }

    return {
      seconds,
      guidance,
      duration: formatDuration(seconds),
      requiresConfirmation: guidance !== 'proceed',
      shouldRefuse: guidance === 'refuse',
    };
  }
}

/**
 * Format duration in human-readable form.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

/**
 * Dwell validation helper (§8.1).
 *
 * Tests that dwell × (1 − erasure_max) ≥ 1.12 to match §13.1's +12% p99
 * overhead budget.
 *
 * @param dwellPackets - Dwell packets per block
 * @param erasureMax - Maximum erasure rate (default 0.30 per D18c)
 * @returns true if dwell satisfies budget
 */
export function validateDwellBudget(
  dwellPackets: number,
  erasureMax = 0.30
): boolean {
  const effectivePackets = dwellPackets * (1 - erasureMax);
  // Need at least K packets to decode + 12% overhead
  const neededPackets = K * 1.12;
  return effectivePackets >= neededPackets;
}

/**
 * Calculate completion cliff erasure rate (§8.1).
 *
 * At what erasure rate does a block never complete? This happens when
 * dwell × (1 - e) < K + overhead.
 *
 * @param dwellPackets - Dwell packets per block
 * @param overheadP99 - P99 overhead (default +4.2% from D25)
 * @returns Erasure rate at which completion becomes impossible
 */
export function calculateCompletionCliff(
  dwellPackets: number,
  overheadP99 = 0.042
): number {
  const neededK = K * (1 + overheadP99);
  return 1 - neededK / dwellPackets;
}

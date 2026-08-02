/**
 * Session state machine types.
 *
 * Replaces nullable field approach with explicit states.
 *
 * Reference: docs/notes/session-state-machine.md
 */

import type {PositionalWriteHandle} from '../io/positional-write.js';

/**
 * Write position tracking state.
 *
 * Tracks the current write position for positional writes and supports
 * querying/updating position during out-of-order block writes.
 */
export interface WritePositionTracker {
  /**
   * Current write position as block index.
   * Tracks the next expected block to be written.
   */
  currentPosition: number;

  /**
   * Total number of blocks written so far.
   */
  blocksWritten: number;

  /**
   * Get the next position to write.
   * Returns the first incomplete block index at or after the current position.
   */
  getNextPosition(): number;

  /**
   * Update position after a successful write.
   * Advances to the next incomplete block.
   */
  advancePosition(): void;

  /**
   * Reset position to a specific block index.
   * Used during resume or error recovery.
   */
  setPosition(position: number): void;
}

/**
 * Common metadata shared across multiple receiver states.
 */
interface BaseRecvState {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;  // block bitmap
  /**
   * Bitmap tracking which blocks have been written to output.
   * May lag behind `complete` during write failures or partial flush.
   * Same size/structure as `complete` bitmap.
   */
  writtenBlocks: Uint8Array;
}

/**
 * Beacon metadata (from beacon.ts).
 */
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  fileSize: number;
  blockSize: number;
  blockCount: number;
  fragmentLen: number;
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array;
  filename: string;
  mimeType: string;
}

/**
 * GE decoder row (fountain/decoder.ts).
 */
export interface GERow {
  coefficients: Uint8Array;
  payload: Uint8Array;
}

/**
 * Block hash manifest (§7.6).
 */
export interface BlockHashManifest {
  hashes: Uint8Array;  // blockCount × blockHashLen
}

// ==============================================================================
// RECEIVER SESSION STATES
// ==============================================================================

/**
 * Receiver session state discriminated union.
 *
 * Use `state.type` to narrow and access state-specific fields.
 */
export type RecvSessionState =
  | IdleState
  | AcquiringState
  | ReceivingState
  | VerifyingState
  | CompleteState
  | PausedState
  | RepairWaitingState
  | RepairTransferringState
  | QuotaExhaustedState
  | DecompressFailedState;

/**
 * 1. IDLE - No session, camera off.
 */
export interface IdleState {
  type: 'idle';
}

/**
 * 2. ACQUIRING - Camera on, waiting for first beacon.
 */
export interface AcquiringState {
  type: 'acquiring';
  startTime: number;
  frameCount: number;
  lastPacketTime: number;
}

/**
 * 3. RECEIVING - Normal operation, collecting blocks.
 *
 * Block-switch policy (bf-2t1k): The receiver holds the current active block until:
 * 1. Block completion (rank === K), OR
 * 2. N consecutive higher-index packets arrive (default N=32)
 *
 * This prevents discarding nearly-complete blocks (e.g., 95% done) when camera
 * frames straddle sender block transitions, which would otherwise waste hours
 * of work waiting for a full pass.
 *
 * See: docs/notes/bf-2t1k-block-switch-policy.md
 *
 * **I5 Resolution (bf-28b):** The invariant permits two concurrent GE contexts:
 * - `active`: one payload block's GE decoder (regular blocks)
 * - `manifestActive`: one manifest block's GE decoder (manifest stream at blockIndex 0xFFFFFF)
 *
 * This is necessary because manifest blocks are interleaved with payload blocks (§7.6),
 * and both require fountain decoding. The manifest uses a reserved blockIndex and is
 * distinguished by PacketFlags.Manifest, providing clean separation.
 */
export interface ReceivingState extends BaseRecvState {
  type: 'receiving';
  /** GE decoder state for current payload block (null if no block active). */
  active: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
    consecutiveHigher: number;  // count of consecutive packets with blockIndex > current
    switchThreshold: number;   // N consecutive packets to trigger block switch (default 32)
  } | null;
  /** GE decoder state for manifest block (null if no manifest block active). */
  manifestActive: {
    pivots: Map<number, GERow>;
    rank: number;
  } | null;
  out: PositionalWriteHandle | null;
  manifest: BlockHashManifest | null;
  stats: {
    fps: number;
    cameraPxPerModule: number;
    packetsPerSec: number;
    eta: number;
    dutyCycle: number;  // D27: 0.0-1.0
  };
}

/**
 * 4. VERIFYING - All blocks collected, verifying against manifest.
 */
export interface VerifyingState extends BaseRecvState {
  type: 'verifying';
  out: PositionalWriteHandle | null;
  manifest: BlockHashManifest;
  verificationProgress: {
    verified: number;
    total: number;
    failedBlocks: number[];
  };
}

/**
 * 5. COMPLETE - Transfer done, ready to export.
 */
export interface CompleteState extends BaseRecvState {
  type: 'complete';
  outputPath: string;
  outputSize: number;
  verified: boolean;
  compressed: boolean;
}

/**
 * 6. PAUSED - Camera lost or thermal duty-cycle.
 */
export interface PausedState {
  type: 'paused';
  previousState: ReceivingState;
  pauseReason: 'camera-lost' | 'tab-backgrounded' | 'thermal';
  pauseTime: number;
}

/**
 * 7. REPAIR_WAITING - Waiting for repair code entry.
 */
export interface RepairWaitingState extends BaseRecvState {
  type: 'repair-waiting';
  missingBlocks: number[];
  repairCode: string | null;
}

/**
 * 8. REPAIR_TRANSFERRING - Receiving only missing blocks.
 */
export interface RepairTransferringState extends BaseRecvState {
  type: 'repair-transferring';
  expectedBlocks: Set<number>;
  receivedCount: number;
}

/**
 * 9. QUOTA_EXHAUSTED - Out of space, partial export pending.
 */
export interface QuotaExhaustedState extends BaseRecvState {
  type: 'quota-exhausted';
  partialOutputPath: string;
  missingBlocks: number[];
}

/**
 * 10. DECOMPRESS_FAILED - Blocks verified, decompression failed.
 */
export interface DecompressFailedState {
  type: 'decompress-failed';
  streamId: number;
  meta: BeaconMeta;
  compressedOutputPath: string;
  error: string;
}

// ==============================================================================
// SENDER SESSION STATES
// ==============================================================================

/**
 * Sender session state discriminated union.
 */
export type SendSessionState =
  | IdleSenderState
  | SendingState
  | PausedSenderState
  | RepairModeState
  | StoppingState;

/**
 * 1. IDLE - No session.
 */
export interface IdleSenderState {
  type: 'idle';
}

/**
 * 2. SENDING - Normal transmission.
 */
export interface SendingState {
  type: 'sending';
  source: File;
  staging: FileSystemFileHandle | null;
  streamId: number;
  blockSize: number;
  blockCount: number;
  readonly fragmentLen: number;
  readonly K: number;
  cursor: {
    blockIndex: number;
    seq: number;
  };
  dwellPackets: number;
  lastFrameEmitted: number;
  sourceFingerprint: {
    size: number;
    lastModified: number;
  };
}

/**
 * 3. PAUSED - Tab backgrounded (E8).
 */
export interface PausedSenderState {
  type: 'paused';
  previousState: SendingState;
  pauseTime: number;
}

/**
 * 4. REPAIR_MODE - Sending only missing blocks.
 */
export interface RepairModeState {
  type: 'repair-mode';
  baseState: SendingState;
  targetBlocks: Set<number>;
  emittedCount: number;
  totalTarget: number;
}

/**
 * 5. STOPPING - Graceful shutdown.
 */
export interface StoppingState {
  type: 'stopping';
  reason: 'user-cancel' | 'source-changed' | 'error';
  previousState: SendingState | RepairModeState;
}

// ==============================================================================
// STATE TRANSITIONS
// ==============================================================================

/**
 * Valid receiver state transitions.
 *
 * Key: [from_state] -> Set<to_state>
 */
export const VALID_RECV_TRANSITIONS: Record<string, Set<string>> = {
  'idle': new Set(['acquiring']),
  'acquiring': new Set(['receiving', 'paused', 'idle']),
  'receiving': new Set(['verifying', 'paused', 'quota-exhausted', 'decompress-failed']),
  'verifying': new Set(['complete', 'receiving', 'decompress-failed']),
  'complete': new Set(['idle']),
  'paused': new Set(['receiving', 'idle']),
  'repair-waiting': new Set(['repair-transferring', 'receiving']),
  'repair-transferring': new Set(['verifying', 'repair-waiting']),
  'quota-exhausted': new Set(['idle']),
  'decompress-failed': new Set(['idle']),
};

/**
 * Valid sender state transitions.
 */
export const VALID_SEND_TRANSITIONS: Record<string, Set<string>> = {
  'idle': new Set(['sending']),
  'sending': new Set(['paused', 'repair-mode', 'stopping']),
  'paused': new Set(['sending']),
  'repair-mode': new Set(['sending', 'stopping']),
  'stopping': new Set(['idle']),
};

/**
 * Check if a receiver state transition is valid.
 */
export function isValidRecvTransition(from: string, to: string): boolean {
  const valid = VALID_RECV_TRANSITIONS[from];
  return valid ? valid.has(to) : false;
}

/**
 * Check if a sender state transition is valid.
 */
export function isValidSendTransition(from: string, to: string): boolean {
  const valid = VALID_SEND_TRANSITIONS[from];
  return valid ? valid.has(to) : false;
}

/**
 * Assert a transition is valid, throw if not.
 */
export function assertRecvTransition(from: string, to: string): void {
  if (!isValidRecvTransition(from, to)) {
    throw new Error(`Invalid receiver state transition: ${from} -> ${to}`);
  }
}

/**
 * Assert a sender transition is valid, throw if not.
 */
export function assertSendTransition(from: string, to: string): void {
  if (!isValidSendTransition(from, to)) {
    throw new Error(`Invalid sender state transition: ${from} -> ${to}`);
  }
}

// ==============================================================================
// STATE UTILITIES
// ==============================================================================

/**
 * Check if a receiver state can be resumed (D22).
 *
 * Resume is NOT supported when compression is enabled because:
 * - CompressionStream offers no determinism guarantee across browser restarts
 * - Re-compression after staging reaping (E11) may produce different bytes
 * - Different bytes → different block boundaries → different hashes
 * - Receiver's persisted bitmap would become silently invalid
 *
 * Returns false if:
 * - State type is not paused/complete, OR
 * - Beacon flags indicate resume is disabled (e.g., compression enabled)
 *
 * See: docs/notes/bf-17s0-resume-compression-conflict.md
 *      docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 */
export function canResumeRecv(state: RecvSessionState): boolean {
  if (state.type !== 'paused' && state.type !== 'complete') {
    return false;
  }

  // Check beacon flags for resume disabled
  const meta = state.type === 'paused' ? state.previousState.meta : state.meta;
  if (isResumeDisabled(meta.flags)) {
    return false;
  }

  return true;
}

/**
 * Get all missing block indices from a bitmap.
 */
export function getMissingBlocks(bitmap: Uint8Array): number[] {
  const missing: number[] = [];
  for (let i = 0; i < bitmap.length * 8; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    if (!(bitmap[byteIndex] & (1 << bitIndex))) {
      missing.push(i);
    }
  }
  return missing;
}

/**
 * Check if bitmap is complete (all bits set).
 */
export function isBitmapComplete(bitmap: Uint8Array): boolean {
  for (const byte of bitmap) {
    if (byte !== 0xff) {
      return false;
    }
  }
  return true;
}

/**
 * Clear a bit in the bitmap (for E12 block hash failure).
 */
export function clearBitmapBit(bitmap: Uint8Array, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  bitmap[byteIndex] &= ~(1 << bitIndex);
}

/**
 * Set a bit in the bitmap (block complete).
 */
export function setBitmapBit(bitmap: Uint8Array, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  bitmap[byteIndex] |= (1 << bitIndex);
}

// ==============================================================================
// BLOCK POSITION TRACKING FOR WRITES
// ==============================================================================

/**
 * Concrete implementation of WritePositionTracker.
 *
 * Manages block position tracking for out-of-order writes.
 * Integrates with the bitmap-based tracking in BaseRecvState.
 */
export class WritePositionTrackerImpl implements WritePositionTracker {
  private _currentPosition: number;
  private _blocksWritten: number;
  private readonly state: BaseRecvState;

  constructor(state: BaseRecvState) {
    this.state = state;
    this._currentPosition = 0;
    this._blocksWritten = 0;

    // Initialize from existing state
    this._blocksWritten = getBlocksWrittenCount(state);
    this._currentPosition = getCurrentWritePosition(state);
  }

  /**
   * Current write position as block index.
   * Tracks the next expected block to be written.
   */
  get currentPosition(): number {
    return this._currentPosition;
  }

  /**
   * Total number of blocks written so far.
   */
  get blocksWritten(): number {
    return this._blocksWritten;
  }

  /**
   * Get the next position to write.
   * Returns the first incomplete block index at or after the current position.
   */
  getNextPosition(): number {
    return getNextWritePosition(this.state, this._currentPosition);
  }

  /**
   * Update position after a successful write.
   * Advances to the next incomplete block.
   */
  advancePosition(): void {
    // Find next unwritten block
    const nextPos = this.getNextPosition();

    // If we found a new unwritten block, advance to it
    if (nextPos !== this._currentPosition) {
      this._currentPosition = nextPos;
    } else {
      // No advancement needed, stay at current position
      // (block at current position was already marked as written)
    }

    // Recalculate blocks written count
    this._blocksWritten = getBlocksWrittenCount(this.state);
  }

  /**
   * Reset position to a specific block index.
   * Used during resume or error recovery.
   */
  setPosition(position: number): void {
    if (position < 0 || position > this.state.meta.blockCount) {
      throw new Error(`Invalid position: ${position} (must be 0-${this.state.meta.blockCount})`);
    }
    this._currentPosition = position;
  }

  /**
   * Mark a block as written and update position tracking.
   * This is a convenience method that combines marking and position update.
   */
  markBlockWritten(blockIndex: number): void {
    if (!isBlockWritten(this.state, blockIndex)) {
      markBlockWritten(this.state, blockIndex);
      this._blocksWritten++;

      // If this was the current position, advance to next
      if (blockIndex === this._currentPosition) {
        this.advancePosition();
      }
    }
  }

  /**
   * Check if a block has been written.
   */
  isBlockWritten(blockIndex: number): boolean {
    return isBlockWritten(this.state, blockIndex);
  }

  /**
   * Get all unwritten block indices.
   */
  getUnwrittenBlocks(): number[] {
    return getUnwrittenBlocks(this.state);
  }

  /**
   * Check if all blocks have been written.
   */
  isComplete(): boolean {
    return areAllBlocksWritten(this.state);
  }

  /**
   * Get write progress as a ratio (0.0 to 1.0).
   */
  getProgress(): number {
    return getWriteProgress(this.state);
  }
}

/**
 * Check if a block has been written to output.
 */
export function isBlockWritten(state: BaseRecvState, blockIndex: number): boolean {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  return (state.writtenBlocks[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Mark a block as written to output.
 */
export function markBlockWritten(state: BaseRecvState, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  state.writtenBlocks[byteIndex] |= (1 << bitIndex);
}

/**
 * Get count of blocks written so far.
 */
export function getBlocksWrittenCount(state: BaseRecvState): number {
  let count = 0;
  for (const byte of state.writtenBlocks) {
    count += popcount(byte);
  }
  return count;
}

/**
 * Population count (number of set bits) for a byte.
 * Used for bitmap operations.
 */
function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

/**
 * Get all block indices that have been decoded but not yet written.
 */
export function getUnwrittenBlocks(state: BaseRecvState): number[] {
  const unwritten: number[] = [];
  const blockCount = state.meta.blockCount;

  for (let i = 0; i < blockCount; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;

    const complete = (state.complete[byteIndex] & (1 << bitIndex)) !== 0;
    const written = (state.writtenBlocks[byteIndex] & (1 << bitIndex)) !== 0;

    if (complete && !written) {
      unwritten.push(i);
    }
  }

  return unwritten;
}

/**
 * Check if all complete blocks have been written.
 */
export function areAllBlocksWritten(state: BaseRecvState): boolean {
  const blockCount = state.meta.blockCount;

  for (let i = 0; i < blockCount; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;

    const complete = (state.complete[byteIndex] & (1 << bitIndex)) !== 0;
    const written = (state.writtenBlocks[byteIndex] & (1 << bitIndex)) !== 0;

    if (complete && !written) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate the current write position as a block index.
 * Returns the first incomplete block index at or after the given start index.
 */
export function getNextWritePosition(state: BaseRecvState, startIndex = 0): number {
  const blockCount = state.meta.blockCount;

  for (let i = startIndex; i < blockCount; i++) {
    if (!isBlockWritten(state, i)) {
      return i;
    }
  }

  return blockCount; // All blocks written
}

/**
 * Get the current write position as a block index.
 * Returns the index of the next block to write (first unwritten block).
 */
export function getCurrentWritePosition(state: BaseRecvState): number {
  return getNextWritePosition(state, 0);
}

/**
 * Write a decoded block to its correct position and update tracking.
 *
 * This function combines the positional write with tracking updates:
 * 1. Calculates the correct offset for the block
 * 2. Writes the block data to the handle
 * 3. Marks the block as written in the tracking bitmap
 *
 * @param state - Receiver session state with tracking
 * @param handle - Positional write handle
 * @param blockData - Decoded block data
 * @param blockIndex - Block index (determines offset)
 * @param blockSize - Block size from beacon
 * @throws WriteError if write fails
 * @throws Error if block is already written
 */
export async function writeTrackedBlock(
  state: BaseRecvState,
  handle: PositionalWriteHandle,
  blockData: Uint8Array,
  blockIndex: number,
  blockSize: number
): Promise<void> {
  // Check if block is already written
  if (isBlockWritten(state, blockIndex)) {
    throw new Error(`Block ${blockIndex} is already written`);
  }

  // Calculate offset
  const offset = blockIndex * blockSize;

  // Write at specific offset
  await handle.write(blockData, { at: offset });

  // Mark block as written
  markBlockWritten(state, blockIndex);
}

/**
 * Reset write tracking for a block (allows re-write).
 *
 * Used during error recovery when a block write needs to be retried.
 * Clears the written flag for a specific block.
 *
 * @param state - Receiver session state with tracking
 * @param blockIndex - Block index to reset
 */
export function resetBlockWriteTracking(state: BaseRecvState, blockIndex: number): void {
  const byteIndex = Math.floor(blockIndex / 8);
  const bitIndex = blockIndex % 8;
  state.writtenBlocks[byteIndex] &= ~(1 << bitIndex);
}

/**
 * Get write progress as a percentage.
 *
 * Returns the percentage of blocks that have been written (0.0 to 1.0).
 *
 * @param state - Receiver session state with tracking
 * @returns Write progress ratio (0.0 = none written, 1.0 = all written)
 */
export function getWriteProgress(state: BaseRecvState): number {
  const total = state.meta.blockCount;
  if (total === 0) return 1.0;
  const written = getBlocksWrittenCount(state);
  return written / total;
}

// ==============================================================================
// RESUME TOKEN (D22)
// ==============================================================================

/**
 * Resume token for persisting session state.
 *
 * Includes the manifest (§7.6) to enable re-verification of block hashes on resume.
 * Without the persisted manifest, a reload would lose all received blocks because:
 * - The manifest takes ~12 minutes to acquire for a 4 GB file (at ~2 s beacon cadence)
 * - During that window, blocks cannot be verified against their hashes
 * - By §7.6's two-bitmap rule, blocks written before verification are NOT in the resume bitmap
 * - So the resume token would be empty and all progress would be lost
 *
 * See: docs/notes/bf-28q-manifest-resume-persistence.md
 */
export interface ResumeToken {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;  // bitmap of complete blocks
  writtenBlocks: Uint8Array;  // bitmap of written blocks
  manifest: BlockHashManifest | null;  // block hashes for verification (may be null if not yet acquired)
  timestamp: number;
}

/**
 * Create a resume token from a resumable state.
 *
 * When compression is enabled, resume is NOT supported because:
 * - CompressionStream offers no determinism guarantee across browser restarts
 * - Re-compression after staging reaping (E11) may produce different bytes
 * - Different bytes → different block boundaries → different hashes
 * - Receiver's persisted bitmap would become silently invalid
 *
 * **This implements Option B from bf-3k90:** "Forbid resume when compression is enabled"
 * - Sender sets ResumeDisabled flag in beacon when compression is on
 * - This function checks the flag and returns null (no resume token) if set
 * - This prevents persisting bitmap/metadata that would be corrupted after restart
 *
 * The alternative would be silent invalid state: receiver tries to resume with
 * a stale bitmap, but the sender's new compressed blocks have different hashes,
 * so the resume bitmap never matches and the transfer appears stuck.
 *
 * See: docs/notes/bf-3k90-compression-resume-solution-evaluation.md (Option B)
 *      docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 *      docs/notes/bf-17s0-resume-compression-conflict.md
 */
import {isResumeDisabled} from '../frame/beacon.js';

export function createResumeToken(state: RecvSessionState): ResumeToken | null {
  if (!canResumeRecv(state)) {
    return null;
  }

  // Check beacon flags for resume disabled (e.g., when compression is enabled)
  const meta = state.type === 'paused' ? state.previousState.meta : state.meta;
  if (isResumeDisabled(meta.flags)) {
    // Do NOT persist resume state when compression is enabled
    // This prevents silent corruption from non-deterministic compression
    return null;
  }

  if (state.type === 'paused') {
    return {
      streamId: state.previousState.streamId,
      meta: state.previousState.meta,
      complete: state.previousState.complete,
      writtenBlocks: state.previousState.writtenBlocks,
      manifest: state.previousState.manifest,  // Persist manifest if available
      timestamp: Date.now(),
    };
  }

  if (state.type === 'complete') {
    // Complete state always has the manifest (verified before completion)
    return {
      streamId: state.streamId,
      meta: state.meta,
      complete: state.complete,
      writtenBlocks: state.writtenBlocks,
      manifest: null,  // Complete state has verified blocks, manifest not needed for resume
      timestamp: Date.now(),
    };
  }

  return null;
}

/**
 * Restore a session from a resume token.
 *
 * Pre-manifest reload behavior (bf-28q):
 * - If token.manifest is null, blocks received before manifest acquisition are preserved in OPFS
 * - The 'complete' bitmap tracks which blocks were decoded before the reload
 * - The 'writtenBlocks' bitmap is reset (re-verified writes will be re-marked)
 * - The receiver continues acquiring the manifest and verifies blocks retroactively once it arrives
 * - This prevents losing progress during the ~12 minute manifest acquisition window for large files
 *
 * If token.manifest is present, block verification can proceed immediately.
 */
export function restoreFromResumeToken(token: ResumeToken): RecvSessionState {
  // Restores to PAUSED state, user must resume to RECEIVING
  // Note: PositionalWriteHandle must be recreated after OPFS reopen using factory.reopenHandle()
  const blockCount = token.meta.blockCount;
  const bitmapBytes = Math.ceil(blockCount / 8);

  return {
    type: 'paused',
    previousState: {
      type: 'receiving',
      streamId: token.streamId,
      meta: token.meta,
      complete: token.complete,
      writtenBlocks: new Uint8Array(bitmapBytes),  // Reset write tracking on resume
      active: null,
      manifestActive: null,
      out: null,  // Must be recreated after OPFS reopen
      manifest: token.manifest,  // Restore manifest if persisted
      stats: {
        fps: 0,
        cameraPxPerModule: 0,
        packetsPerSec: 0,
        eta: 0,
        dutyCycle: 1.0,
      },
    },
    pauseReason: 'camera-lost',  // Assume resume from camera loss
    pauseTime: Date.now() - token.timestamp,
  };
}

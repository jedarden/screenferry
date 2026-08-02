/**
 * Session state machine types.
 *
 * Replaces nullable field approach with explicit states.
 *
 * Reference: docs/notes/session-state-machine.md
 */

/**
 * Common metadata shared across multiple receiver states.
 */
interface BaseRecvState {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;  // block bitmap
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
 */
export interface ReceivingState extends BaseRecvState {
  type: 'receiving';
  active: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
    consecutiveHigher: number;  // count of consecutive packets with blockIndex > current
    switchThreshold: number;   // N consecutive packets to trigger block switch (default 32)
  } | null;
  out: FileSystemWritableFileStream;
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
  out: FileSystemWritableFileStream;
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
 */
export function canResumeRecv(state: RecvSessionState): boolean {
  return state.type === 'paused' || state.type === 'complete';
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
// RESUME TOKEN (D22)
// ==============================================================================

/**
 * Resume token for persisting session state.
 */
export interface ResumeToken {
  streamId: number;
  meta: BeaconMeta;
  complete: Uint8Array;  // bitmap
  timestamp: number;
}

/**
 * Create a resume token from a resumable state.
 */
export function createResumeToken(state: RecvSessionState): ResumeToken | null {
  if (!canResumeRecv(state)) {
    return null;
  }

  if (state.type === 'paused') {
    return {
      streamId: state.previousState.streamId,
      meta: state.previousState.meta,
      complete: state.previousState.complete,
      timestamp: Date.now(),
    };
  }

  if (state.type === 'complete') {
    return {
      streamId: state.streamId,
      meta: state.meta,
      complete: state.complete,
      timestamp: Date.now(),
    };
  }

  return null;
}

/**
 * Restore a session from a resume token.
 */
export function restoreFromResumeToken(token: ResumeToken): RecvSessionState {
  // Restores to PAUSED state, user must resume to RECEIVING
  return {
    type: 'paused',
    previousState: {
      type: 'receiving',
      streamId: token.streamId,
      meta: token.meta,
      complete: token.complete,
      active: null,
      out: null as any,  // Must be recreated after OPFS reopen
      manifest: null,
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

/**
 * Compression/Resume integration tests (bf-vgtq).
 *
 * Tests the implementation of Option B from bf-3k90:
 * "Forbid resume when compression is enabled"
 *
 * These tests ensure that:
 * 1. When compression is enabled (ResumeDisabled flag is set), resume is blocked
 * 2. When compression is disabled, resume works normally
 * 3. The beacon flags properly signal resume capability
 *
 * See: docs/notes/bf-3k90-compression-resume-solution-evaluation.md
 *      docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 */

import {describe, it, expect} from 'vitest';
import type {RecvSessionState} from '../src/core/session/types.js';
import {createResumeToken, canResumeRecv, restoreFromResumeToken} from '../src/core/session/types.js';
import {isResumeDisabled, BeaconFlags} from '../src/core/frame/beacon.js';

describe('Compression/Resume integration (bf-vgtq)', () => {
  /**
   * Helper to create a minimal BeaconMeta for testing.
   */
  function createMockMeta(flags: number) {
    return {
      streamId: 12345,
      wireVersion: 1,
      fileSize: 1024 * 1024, // 1 MB
      blockSize: 196608,
      blockCount: 5,
      fragmentLen: 256,
      degreeCap: 64,
      flags,
      blockHashLen: 4,
      wholeFileHash: new Uint8Array(32),
      filename: 'test.txt',
      mimeType: 'text/plain',
    };
  }

  /**
   * Helper to create a paused receiving state.
   */
  function createPausedState(flags: number): RecvSessionState {
    const meta = createMockMeta(flags);
    return {
      type: 'paused',
      previousState: {
        type: 'receiving',
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]), // 5 blocks, first 4 complete
        active: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 120,
          eta: 5000,
          dutyCycle: 0.5,
        },
      },
      pauseReason: 'camera-lost',
      pauseTime: Date.now() - 1000,
    };
  }

  /**
   * Helper to create a complete receiving state.
   */
  function createCompleteState(flags: number): RecvSessionState {
    const meta = createMockMeta(flags);
    return {
      type: 'complete',
      streamId: meta.streamId,
      meta,
      complete: new Uint8Array([0b11111000]), // All blocks complete
      outputPath: '/output/test.txt',
      outputSize: meta.fileSize,
      verified: true,
      compressed: false,
    };
  }

  describe('isResumeDisabled()', () => {
    it('should return true when ResumeDisabled flag is set', () => {
      const flags = BeaconFlags.ResumeDisabled;
      expect(isResumeDisabled(flags)).toBe(true);
    });

    it('should return false when no flags are set', () => {
      const flags = BeaconFlags.None;
      expect(isResumeDisabled(flags)).toBe(false);
    });

    it('should return true when Compressed flag is set (implies ResumeDisabled)', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      expect(isResumeDisabled(flags)).toBe(true);
    });
  });

  describe('canResumeRecv()', () => {
    it('should return false for idle state', () => {
      const state: RecvSessionState = {type: 'idle'};
      expect(canResumeRecv(state)).toBe(false);
    });

    it('should return false for acquiring state', () => {
      const state: RecvSessionState = {
        type: 'acquiring',
        startTime: Date.now(),
        frameCount: 0,
        lastPacketTime: Date.now(),
      };
      expect(canResumeRecv(state)).toBe(false);
    });

    it('should return false for paused state when compression is enabled', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createPausedState(flags);
      expect(canResumeRecv(state)).toBe(false);
    });

    it('should return true for paused state when compression is disabled', () => {
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);
      expect(canResumeRecv(state)).toBe(true);
    });

    it('should return false for complete state when compression is enabled', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createCompleteState(flags);
      expect(canResumeRecv(state)).toBe(false);
    });

    it('should return true for complete state when compression is disabled', () => {
      const flags = BeaconFlags.None;
      const state = createCompleteState(flags);
      expect(canResumeRecv(state)).toBe(true);
    });

    it('should return false for receiving state (cannot resume directly)', () => {
      const meta = createMockMeta(BeaconFlags.None);
      const state: RecvSessionState = {
        type: 'receiving',
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]),
        active: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 120,
          eta: 5000,
          dutyCycle: 0.5,
        },
      };
      expect(canResumeRecv(state)).toBe(false);
    });
  });

  describe('createResumeToken()', () => {
    it('should return null for idle state', () => {
      const state: RecvSessionState = {type: 'idle'};
      const token = createResumeToken(state);
      expect(token).toBeNull();
    });

    it('should return null for acquiring state', () => {
      const state: RecvSessionState = {
        type: 'acquiring',
        startTime: Date.now(),
        frameCount: 0,
        lastPacketTime: Date.now(),
      };
      const token = createResumeToken(state);
      expect(token).toBeNull();
    });

    it('should return null for paused state when compression is enabled', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createPausedState(flags);
      const token = createResumeToken(state);
      expect(token).toBeNull();
    });

    it('should return null for complete state when compression is enabled', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createCompleteState(flags);
      const token = createResumeToken(state);
      expect(token).toBeNull();
    });

    it('should return a valid token for paused state when compression is disabled', () => {
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);
      const token = createResumeToken(state);

      expect(token).not.toBeNull();
      expect(token?.streamId).toBe(state.previousState.streamId);
      expect(token?.complete).toEqual(state.previousState.complete);
      expect(token?.meta.flags).toBe(flags);
    });

    it('should return a valid token for complete state when compression is disabled', () => {
      const flags = BeaconFlags.None;
      const state = createCompleteState(flags);
      const token = createResumeToken(state);

      expect(token).not.toBeNull();
      expect(token?.streamId).toBe(state.streamId);
      expect(token?.complete).toEqual(state.complete);
      expect(token?.meta.flags).toBe(flags);
    });

    it('should include timestamp in resume token', () => {
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);
      const token = createResumeToken(state);
      const beforeTimestamp = Date.now();

      expect(token).not.toBeNull();
      expect(token?.timestamp).toBeGreaterThanOrEqual(beforeTimestamp - 1000);
      expect(token?.timestamp).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('should include manifest in resume token when available (bf-28q)', () => {
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);

      // Simulate a received manifest
      const mockManifest = {
        hashes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      };
      state.previousState.manifest = mockManifest;

      const token = createResumeToken(state);

      expect(token).not.toBeNull();
      expect(token?.manifest).not.toBeNull();
      expect(token?.manifest).toEqual(mockManifest);
    });

    it('should handle null manifest in resume token (bf-28q)', () => {
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);

      // Manifest is null (not yet acquired)
      expect(state.previousState.manifest).toBeNull();

      const token = createResumeToken(state);

      expect(token).not.toBeNull();
      expect(token?.manifest).toBeNull();
      // Other fields should still be present
      expect(token?.streamId).toBe(state.previousState.streamId);
      expect(token?.complete).toEqual(state.previousState.complete);
    });
  });

  describe('End-to-end scenarios', () => {
    it('should block resume after interrupted compressed transfer', () => {
      // Scenario: User starts transfer with compression enabled
      // At 50%, user stops transfer or sender crashes
      // Sender restarts → staging reaped → re-compression produces different bytes
      // Receiver should NOT offer resume option

      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const pausedState = createPausedState(flags);

      // Check all resume-related functions
      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(pausedState)).toBe(false);
      expect(createResumeToken(pausedState)).toBeNull();

      // This prevents the silent corruption scenario from bf-2vke:
      // - Resume token is NOT persisted
      // - UI should NOT show resume option
      // - Next attempt is a fresh transfer
    });

    it('should allow resume after interrupted uncompressed transfer', () => {
      // Scenario: User starts transfer without compression
      // At 50%, user stops transfer or sender crashes
      // Sender restarts → staging reaped → re-reads file (deterministic)
      // Same file → same blocks → same hashes → resume is safe

      const flags = BeaconFlags.None;
      const pausedState = createPausedState(flags);

      // Check all resume-related functions
      expect(isResumeDisabled(flags)).toBe(false);
      expect(canResumeRecv(pausedState)).toBe(true);
      expect(createResumeToken(pausedState)).not.toBeNull();

      const token = createResumeToken(pausedState);
      expect(token).not.toBeNull();
      expect(token?.complete).toEqual(new Uint8Array([0b11111000]));

      // This is the safe resume scenario:
      // - Resume token IS persisted
      // - UI SHOULD show resume option
      // - Resume completes only remaining blocks
    });

    it('should block resume for complete compressed transfer', () => {
      // Even though transfer is complete, compressed transfers cannot resume
      // This prevents issues if user wants to re-transfer or verify

      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const completeState = createCompleteState(flags);

      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(completeState)).toBe(false);
      expect(createResumeToken(completeState)).toBeNull();
    });

    it('should allow resume token for complete uncompressed transfer', () => {
      // For export/re-transfer scenarios, uncompressed transfers can resume

      const flags = BeaconFlags.None;
      const completeState = createCompleteState(flags);

      expect(isResumeDisabled(flags)).toBe(false);
      expect(canResumeRecv(completeState)).toBe(true);
      expect(createResumeToken(completeState)).not.toBeNull();
    });
  });

  describe('Flag combinations', () => {
    it('should handle ResumeDisabled flag without Compressed flag', () => {
      // Future-proofing: if other reasons disable resume
      const flags = BeaconFlags.ResumeDisabled;
      const state = createPausedState(flags);

      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(state)).toBe(false);
      expect(createResumeToken(state)).toBeNull();
    });

    it('should handle both flags set together', () => {
      // Normal case: compression sets both flags
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createPausedState(flags);

      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(state)).toBe(false);
      expect(createResumeToken(state)).toBeNull();
    });

    it('should allow resume when no flags are set', () => {
      // Normal uncompressed transfer
      const flags = BeaconFlags.None;
      const state = createPausedState(flags);

      expect(isResumeDisabled(flags)).toBe(false);
      expect(canResumeRecv(state)).toBe(true);
      expect(createResumeToken(state)).not.toBeNull();
    });
  });

  describe('restoreFromResumeToken() (bf-28q)', () => {
    it('should restore paused state with manifest', () => {
      const flags = BeaconFlags.None;
      const meta = createMockMeta(flags);
      const manifest = {
        hashes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      };
      const token = {
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]),
        writtenBlocks: new Uint8Array([0b11111000]),
        manifest,
        timestamp: Date.now() - 5000,
      };

      const state = restoreFromResumeToken(token);

      expect(state.type).toBe('paused');
      expect(state.previousState.streamId).toBe(token.streamId);
      expect(state.previousState.manifest).toEqual(manifest);
      expect(state.previousState.complete).toEqual(token.complete);
    });

    it('should restore paused state without manifest', () => {
      const flags = BeaconFlags.None;
      const meta = createMockMeta(flags);
      const token = {
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]),
        writtenBlocks: new Uint8Array([0b11111000]),
        manifest: null,
        timestamp: Date.now() - 5000,
      };

      const state = restoreFromResumeToken(token);

      expect(state.type).toBe('paused');
      expect(state.previousState.streamId).toBe(token.streamId);
      expect(state.previousState.manifest).toBeNull();
      expect(state.previousState.complete).toEqual(token.complete);
    });

    it('should reset writtenBlocks bitmap on resume', () => {
      const flags = BeaconFlags.None;
      const meta = createMockMeta(flags);
      const token = {
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]),
        writtenBlocks: new Uint8Array([0b11111000]),
        manifest: null,
        timestamp: Date.now() - 5000,
      };

      const state = restoreFromResumeToken(token);

      expect(state.type).toBe('paused');
      // writtenBlocks should be reset (all zeros)
      expect(state.previousState.writtenBlocks).toEqual(new Uint8Array([0b00000000]));
      // complete should be preserved
      expect(state.previousState.complete).toEqual(new Uint8Array([0b11111000]));
    });

    it('should restore with camera-lost pause reason', () => {
      const flags = BeaconFlags.None;
      const meta = createMockMeta(flags);
      const token = {
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0b11111000]),
        writtenBlocks: new Uint8Array([0b11111000]),
        manifest: null,
        timestamp: Date.now() - 10000,
      };

      const state = restoreFromResumeToken(token);

      expect(state.type).toBe('paused');
      expect(state.pauseReason).toBe('camera-lost');
      expect(state.pauseTime).toBeGreaterThan(0);
    });
  });
});

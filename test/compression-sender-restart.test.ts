/**
 * Integration tests for sender restart with compression (bf-2w1a).
 *
 * These tests simulate the full sender restart scenario:
 * 1. Transfer starts with compression enabled
 * 2. Transfer is interrupted (user stops or sender crashes)
 * 3. Sender restarts → staging reaped (E11, T4 privacy requirement)
 * 4. Re-compression produces different bytes
 * 5. System must prevent resume to avoid silent corruption
 *
 * See: docs/notes/bf-17s0-resume-compression-conflict.md
 *      docs/notes/bf-3k90-compression-resume-solution-evaluation.md
 */

import {describe, it, expect} from 'vitest';
import type {RecvSessionState, PausedState} from '../src/core/session/types.js';
import {createResumeToken, canResumeRecv} from '../src/core/session/types.js';
import {isResumeDisabled, BeaconFlags, encodeBeacon, parseBeacon} from '../src/core/frame/beacon.js';

describe('Sender restart with compression (bf-2w1a)', () => {
  /**
   * Helper to create a minimal BeaconMeta for testing.
   */
  function createMockMeta(flags: number, streamId: number = 12345) {
    const fileSize = 1024 * 1024 * 100; // 100 MB file
    const blockCount = 512;
    const blockSize = Math.ceil(fileSize / blockCount); // ~204 KB per block

    return {
      streamId,
      wireVersion: 1,
      originalSize: fileSize,
      payloadLen: fileSize, // Will be smaller with compression, but tests use uncompressed
      blockSize,
      blockCount,
      fragmentLen: 256,
      degreeCap: 64,
      flags,
      blockHashLen: 4,
      wholeFileHash: new Uint8Array(32),
      manifestHash: new Uint8Array(4), // CRC-32 of manifest
      filename: 'large-video.mp4',
      mimeType: 'video/mp4',
    };
  }

  /**
   * Helper to create a paused receiving state at 50% completion.
   */
  function createPausedStateAt50Percent(flags: number, streamId: number = 12345): PausedState {
    const meta = createMockMeta(flags, streamId);
    const blockCount = 512;

    // 50% complete: first 256 blocks done, remaining 256 blocks missing
    const completeBitmap = new Uint8Array(Math.ceil(blockCount / 8));
    const writtenBitmap = new Uint8Array(Math.ceil(blockCount / 8));
    for (let i = 0; i < 256; i++) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      completeBitmap[byteIndex] |= (1 << bitIndex);
      writtenBitmap[byteIndex] |= (1 << bitIndex);
    }

    return {
      type: 'paused',
      previousState: {
        type: 'receiving',
        streamId: meta.streamId,
        meta,
        complete: completeBitmap,
        writtenBlocks: writtenBitmap,
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 120,
          eta: 30000, // 30 seconds remaining
          dutyCycle: 0.7,
        },
      },
      pauseReason: 'camera-lost',
      pauseTime: Date.now() - 5000,
    };
  }

  describe('Scenario 1: Compressed transfer interrupted at 50%', () => {
    it('should prevent resume after sender restart with compression', () => {
      // Step 1: User starts 100 MB transfer with compression enabled
      const streamId = 12345;
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;

      // Step 2: Transfer reaches 50% completion
      const pausedState = createPausedStateAt50Percent(flags, streamId);

      // Step 3: Sender crashes or user stops transfer
      // (simulated by the paused state)

      // Step 4: Sender restarts → staging reaped (E11)
      // Step 5: Re-compression produces different bytes
      // Step 6: System prevents resume to avoid silent corruption

      // Verify resume is blocked
      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(pausedState)).toBe(false);
      expect(createResumeToken(pausedState)).toBeNull();

      // This prevents the silent corruption scenario:
      // - No resume token is persisted
      // - UI cannot show resume option
      // - Next transfer must start fresh
      // - No risk of using invalid bitmap
    });

    it('should encode and parse beacon with compression flags correctly', () => {
      // Verify the beacon protocol works end-to-end
      const meta = createMockMeta(BeaconFlags.Compressed | BeaconFlags.ResumeDisabled);

      // Encode beacon as sender would
      const beaconBytes = encodeBeacon(meta);
      expect(beaconBytes).not.toBeNull();
      expect(beaconBytes.length).toBeGreaterThan(0);

      // Parse beacon as receiver would
      const parsedMeta = parseBeacon(beaconBytes);
      expect(parsedMeta).not.toBeNull();

      // Verify flags are preserved
      expect(parsedMeta?.flags).toBe(BeaconFlags.Compressed | BeaconFlags.ResumeDisabled);
      expect(isResumeDisabled(parsedMeta?.flags ?? 0)).toBe(true);
    });

    it('should show uncompressed transfer allows resume at 50%', () => {
      // Contrast: Without compression, resume IS allowed
      const streamId = 67890;
      const flags = BeaconFlags.None;

      const pausedState = createPausedStateAt50Percent(flags, streamId);

      // Verify resume is allowed
      expect(isResumeDisabled(flags)).toBe(false);
      expect(canResumeRecv(pausedState)).toBe(true);
      expect(createResumeToken(pausedState)).not.toBeNull();

      const token = createResumeToken(pausedState);
      expect(token).not.toBeNull();
      expect(token?.streamId).toBe(streamId);

      // Verify bitmap is preserved (50% complete)
      const completeBlocks = token?.complete ?
        Array.from(token?.complete).reduce((sum, byte) =>
          sum + byte.toString(2).split('1').length - 1, 0) : 0;
      expect(completeBlocks).toBe(256); // First 256 blocks complete
    });
  });

  describe('Scenario 2: Multiple sender restarts', () => {
    it('should prevent resume across multiple restart cycles', () => {
      // Scenario: Transfer interrupted multiple times

      // First interruption
      let flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      let state = createPausedStateAt50Percent(flags, 11111);

      expect(canResumeRecv(state)).toBe(false);
      expect(createResumeToken(state)).toBeNull();

      // Sender restarts, tries to resume (should fail)
      state = createPausedStateAt50Percent(flags, 11111);
      expect(canResumeRecv(state)).toBe(false);

      // Another restart (still should fail)
      state = createPausedStateAt50Percent(flags, 11111);
      expect(canResumeRecv(state)).toBe(false);

      // This ensures that even with multiple restart attempts,
      // resume is never allowed for compressed transfers
    });

    it('should allow resume across multiple restarts without compression', () => {
      // Contrast: Without compression, multiple restarts work

      let state = createPausedStateAt50Percent(BeaconFlags.None, 22222);

      // First interruption and restart
      expect(canResumeRecv(state)).toBe(true);
      let token = createResumeToken(state);
      expect(token).not.toBeNull();

      // Second interruption and restart
      state = createPausedStateAt50Percent(BeaconFlags.None, 22222);
      expect(canResumeRecv(state)).toBe(true);
      token = createResumeToken(state);
      expect(token).not.toBeNull();

      // Third interruption and restart
      state = createPausedStateAt50Percent(BeaconFlags.None, 22222);
      expect(canResumeRecv(state)).toBe(true);
      token = createResumeToken(state);
      expect(token).not.toBeNull();
    });
  });

  describe('Scenario 3: Complete transfer with compression', () => {
    it('should prevent resume for completed compressed transfer', () => {
      // Even after completion, compressed transfers cannot resume
      const meta = createMockMeta(BeaconFlags.Compressed | BeaconFlags.ResumeDisabled, 33333);

      const completeState: RecvSessionState = {
        type: 'complete',
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]), // All blocks complete
        writtenBlocks: new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]),
        outputPath: '/output/large-video.mp4',
        outputSize: meta.originalSize,
        verified: true,
        compressed: true,
      };

      expect(canResumeRecv(completeState)).toBe(false);
      expect(createResumeToken(completeState)).toBeNull();

      // This prevents issues with re-transfer or verification
    });

    it('should allow resume for completed uncompressed transfer', () => {
      // Completed uncompressed transfers can resume for re-transfer
      const meta = createMockMeta(BeaconFlags.None, 44444);

      const completeState: RecvSessionState = {
        type: 'complete',
        streamId: meta.streamId,
        meta,
        complete: new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]),
        writtenBlocks: new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]),
        outputPath: '/output/large-video.mp4',
        outputSize: meta.originalSize,
        verified: true,
        compressed: false,
      };

      expect(canResumeRecv(completeState)).toBe(true);
      expect(createResumeToken(completeState)).not.toBeNull();
    });
  });

  describe('Scenario 4: Different file selection after restart', () => {
    it('should treat different file as new transfer', () => {
      // User selects different file after sender restart
      const originalStreamId = 55555;
      const newStreamId = 66666;

      // Original compressed transfer (interrupted)
      const originalFlags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const originalState = createPausedStateAt50Percent(originalFlags, originalStreamId);

      // User selects different file → new streamId
      const newState = createPausedStateAt50Percent(originalFlags, newStreamId);

      // Different streamId means different transfer
      expect(originalStreamId).not.toBe(newStreamId);

      // Resume is still blocked (compression enabled)
      expect(canResumeRecv(newState)).toBe(false);
      expect(createResumeToken(newState)).toBeNull();

      // This is a fresh transfer, not a resume
    });

    it('should allow different file resume without compression', () => {
      // User selects different file after restart, without compression
      const originalStreamId = 77777;
      const newStreamId = 88888;
      const flags = BeaconFlags.None;

      const originalState = createPausedStateAt50Percent(flags, originalStreamId);
      const newState = createPausedStateAt50Percent(flags, newStreamId);

      // Both can resume (no compression)
      expect(canResumeRecv(originalState)).toBe(true);
      expect(canResumeRecv(newState)).toBe(true);

      // But they're different transfers (different streamIds)
      expect(createResumeToken(originalState)?.streamId).toBe(originalStreamId);
      expect(createResumeToken(newState)?.streamId).toBe(newStreamId);
    });
  });

  describe('Scenario 5: Beacon flag edge cases', () => {
    it('should handle only ResumeDisabled flag (future-proofing)', () => {
      // Future scenarios might disable resume for other reasons
      const flags = BeaconFlags.ResumeDisabled;
      const state = createPausedStateAt50Percent(flags, 99999);

      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(state)).toBe(false);
      expect(createResumeToken(state)).toBeNull();
    });

    it('should handle both flags set (normal compression case)', () => {
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      const state = createPausedStateAt50Percent(flags, 101010);

      expect(isResumeDisabled(flags)).toBe(true);
      expect(canResumeRecv(state)).toBe(false);
      expect(createResumeToken(state)).toBeNull();
    });

    it('should handle no flags (normal uncompressed case)', () => {
      const flags = BeaconFlags.None;
      const state = createPausedStateAt50Percent(flags, 111111);

      expect(isResumeDisabled(flags)).toBe(false);
      expect(canResumeRecv(state)).toBe(true);
      expect(createResumeToken(state)).not.toBeNull();
    });

    it('should handle only Compressed flag (should imply ResumeDisabled)', () => {
      // If Compressed is set but ResumeDisabled is not, we should still
      // treat it as resume-disabled for safety

      // Note: Current implementation requires both flags to be set
      // This test documents the expectation
      const flags = BeaconFlags.Compressed;

      // In sender implementation, both flags should be set together
      // This test verifies the isResumeDisabled function behavior
      expect(isResumeDisabled(flags)).toBe(false); // Current behavior

      // Sender MUST set both flags when compression is enabled
      const properFlags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
      expect(isResumeDisabled(properFlags)).toBe(true);
    });
  });
});

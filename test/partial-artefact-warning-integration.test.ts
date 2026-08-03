/**
 * Integration tests for partial artefact warning system.
 *
 * Tests the complete flow from partial artefact detection to warning dialogs
 * and navigation guards.
 *
 * Reference: docs/notes/bf-1yk1-t4b-deletion-lifecycle.md
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {
  detectPartialArtefact,
  shouldWarnOnNavigation,
  detectPartialFromMetadata,
  type PartialArtefactInfo,
  type PartialArtefactType,
} from '../src/platform/partial-artefact-detector.js';
import {
  showPartialWarningDialog,
  dismissPartialWarningDialog,
  type PartialArtefactAction,
  type WarningDialogResult,
} from '../src/platform/partial-warning-dialog.js';
import {
  getPartialNavigationGuard,
  updateNavigationGuardState,
  type NavigationGuardConfig,
} from '../src/platform/navigation-guard.js';
import type {RecvSessionState} from '../src/core/session/types.js';
import type {OutputArtefact} from '../src/platform/storage.js';

describe('Partial Artefact Warning System', () => {
  describe('Partial Artefact Detection', () => {
    it('should detect quota exhausted state (E10)', () => {
      const state: RecvSessionState = {
        type: 'quota-exhausted',
        streamId: 123,
        meta: {
          streamId: 123,
          wireVersion: 1,
          originalSize: 1000000,
          payloadLen: 1000000,
          blockSize: 1024,
          blockCount: 1000,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'test.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(800), // 800 of 1000 blocks
        writtenBlocks: createCompleteBitmap(800),
        partialOutputPath: '/partial/test.txt',
        missingBlocks: Array.from({length: 200}, (_, i) => i + 800),
      };

      const partial = detectPartialArtefact(state);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('quota-exhausted');
      expect(partial!.streamId).toBe(123);
      expect(partial!.filename).toBe('test.txt');
      expect(partial!.completeBlocks).toBe(800);
      expect(partial!.totalBlocks).toBe(1000);
      expect(partial!.progressPercent).toBeCloseTo(80, 1);
      expect(partial!.missingBlocks.length).toBe(200);
      expect(partial!.canResume).toBe(false);
      expect(partial!.securityMessage).toContain('Storage quota exhausted');
      expect(partial!.securityMessage).toContain('plaintext');
    });

    it('should detect decompression failed state (E15)', () => {
      const state: RecvSessionState = {
        type: 'decompress-failed',
        streamId: 456,
        meta: {
          streamId: 456,
          wireVersion: 1,
          originalSize: 1000000,
          payloadLen: 1000000,
          blockSize: 1024,
          blockCount: 1000,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'compressed.txt',
          mimeType: 'text/plain',
        },
        compressedOutputPath: '/compressed/test.txt.gz',
        error: 'Decompression error',
      };

      const partial = detectPartialArtefact(state);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('decompress-failed');
      expect(partial!.streamId).toBe(456);
      expect(partial!.filename).toBe('compressed.txt');
      expect(partial!.completeBlocks).toBe(1000);
      expect(partial!.totalBlocks).toBe(1000);
      expect(partial!.progressPercent).toBe(100);
      expect(partial!.canResume).toBe(false);
      expect(partial!.securityMessage).toContain('Decompression failed');
      expect(partial!.securityMessage).toContain('plaintext');
    });

    it('should detect incomplete receiving state', () => {
      const state: RecvSessionState = {
        type: 'receiving',
        streamId: 789,
        meta: {
          streamId: 789,
          wireVersion: 1,
          originalSize: 500000,
          payloadLen: 500000,
          blockSize: 1024,
          blockCount: 500,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'partial.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(250), // 50% complete
        writtenBlocks: createCompleteBitmap(250),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 120,
          dutyCycle: 0.8,
        },
      };

      const partial = detectPartialArtefact(state);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('incomplete-download');
      expect(partial!.streamId).toBe(789);
      expect(partial!.filename).toBe('partial.txt');
      expect(partial!.completeBlocks).toBe(250);
      expect(partial!.totalBlocks).toBe(500);
      expect(partial!.progressPercent).toBeCloseTo(50, 1);
      expect(partial!.canResume).toBe(true);
      expect(partial!.securityMessage).toContain('Incomplete download');
    });

    it('should detect paused incomplete state', () => {
      const receivingState: RecvSessionState = {
        type: 'receiving',
        streamId: 999,
        meta: {
          streamId: 999,
          wireVersion: 1,
          originalSize: 200000,
          payloadLen: 200000,
          blockSize: 1024,
          blockCount: 200,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'paused.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(100),
        writtenBlocks: createCompleteBitmap(100),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 60,
          dutyCycle: 0.7,
        },
      };

      const state: RecvSessionState = {
        type: 'paused',
        previousState: receivingState,
        pauseReason: 'camera-lost',
        pauseTime: Date.now(),
      };

      const partial = detectPartialArtefact(state);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('incomplete-download');
      expect(partial!.progressPercent).toBeCloseTo(50, 1);
      expect(partial!.canResume).toBe(true);
    });

    it('should not warn on nearly complete transfers (>95%)', () => {
      const state: RecvSessionState = {
        type: 'receiving',
        streamId: 888,
        meta: {
          streamId: 888,
          wireVersion: 1,
          originalSize: 100000,
          payloadLen: 100000,
          blockSize: 1024,
          blockCount: 100,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'nearly-done.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(96), // 96% complete
        writtenBlocks: createCompleteBitmap(96),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 10,
          dutyCycle: 0.9,
        },
      };

      const shouldWarn = shouldWarnOnNavigation(state);
      expect(shouldWarn).toBe(false);
    });

    it('should not detect complete state as partial', () => {
      const state: RecvSessionState = {
        type: 'complete',
        streamId: 111,
        meta: {
          streamId: 111,
          wireVersion: 1,
          originalSize: 50000,
          payloadLen: 50000,
          blockSize: 1024,
          blockCount: 50,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'complete.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(50),
        writtenBlocks: createCompleteBitmap(50),
        outputPath: '/output/complete.txt',
        outputSize: 50000,
        verified: true,
        compressed: false,
      };

      const partial = detectPartialArtefact(state);
      expect(partial).toBeNull();
    });
  });

  describe('Partial Artefact Detection from Metadata', () => {
    it('should detect partial artefact from metadata', () => {
      const artefact: OutputArtefact = {
        streamId: 123,
        filename: 'stored-partial.txt',
        mimeType: 'text/plain',
        size: 512000,
        createdAt: Date.now(),
        path: '/output/partial.bin',
        status: 'partial' as any,
        totalBlocks: 1000 as any,
        missingBlocks: [500, 501, 502] as any,
      };

      const partial = detectPartialFromMetadata(artefact);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('incomplete-download');
      expect(partial!.filename).toBe('stored-partial.txt');
      expect(partial!.missingBlocks).toEqual([500, 501, 502]);
      expect(partial!.canResume).toBe(false);
    });

    it('should detect compressed artefact from metadata', () => {
      const artefact: OutputArtefact = {
        streamId: 456,
        filename: 'stored.gz',
        mimeType: 'application/gzip',
        size: 1024000,
        createdAt: Date.now(),
        path: '/output/compressed.bin',
        status: 'compressed' as any,
      };

      const partial = detectPartialFromMetadata(artefact);

      expect(partial).not.toBeNull();
      expect(partial!.type).toBe('decompress-failed');
      expect(partial!.filename).toBe('stored.gz');
      expect(partial!.securityMessage).toContain('compressed');
    });

    it('should not detect complete artefact as partial', () => {
      const artefact: OutputArtefact = {
        streamId: 789,
        filename: 'complete.txt',
        mimeType: 'text/plain',
        size: 2048000,
        createdAt: Date.now(),
        path: '/output/complete.bin',
        status: 'complete' as any,
      };

      const partial = detectPartialFromMetadata(artefact);
      expect(partial).toBeNull();
    });
  });

  describe('Navigation Guard Integration', () => {
    let guard: ReturnType<typeof getPartialNavigationGuard>;

    beforeEach(() => {
      guard = getPartialNavigationGuard();
      guard.reset();
    });

    afterEach(() => {
      guard.reset();
    });

    it('should enable guard when partial state detected', () => {
      const state: RecvSessionState = {
        type: 'receiving',
        streamId: 123,
        meta: {
          streamId: 123,
          wireVersion: 1,
          originalSize: 100000,
          payloadLen: 100000,
          blockSize: 1024,
          blockCount: 100,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'test.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(50), // 50% complete
        writtenBlocks: createCompleteBitmap(50),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 120,
          dutyCycle: 0.8,
        },
      };

      updateNavigationGuardState(state);

      expect(guard.isEnabled()).toBe(true);
      expect(guard.getStats().hasPartialState).toBe(true);
    });

    it('should not enable guard when state is complete', () => {
      const state: RecvSessionState = {
        type: 'complete',
        streamId: 456,
        meta: {
          streamId: 456,
          wireVersion: 1,
          originalSize: 50000,
          payloadLen: 50000,
          blockSize: 1024,
          blockCount: 50,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'complete.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(50),
        writtenBlocks: createCompleteBitmap(50),
        outputPath: '/output/complete.txt',
        outputSize: 50000,
        verified: true,
        compressed: false,
      };

      updateNavigationGuardState(state);

      expect(guard.isEnabled()).toBe(false);
      expect(guard.getStats().hasPartialState).toBe(false);
    });

    it('should track intercept statistics', () => {
      const config: NavigationGuardConfig = {
        enabled: true,
        requireAcknowledgment: true,
        actions: ['keep', 'delete', 'cancel'],
        onIntercept: vi.fn(),
      };

      guard.updateConfig(config);

      const state: RecvSessionState = {
        type: 'receiving',
        streamId: 789,
        meta: {
          streamId: 789,
          wireVersion: 1,
          originalSize: 100000,
          payloadLen: 100000,
          blockSize: 1024,
          blockCount: 100,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'test.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(30),
        writtenBlocks: createCompleteBitmap(30),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 180,
          dutyCycle: 0.7,
        },
      };

      updateNavigationGuardState(state);

      const stats = guard.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.hasPartialState).toBe(true);
      expect(stats.interceptCount).toBe(0); // Will increment on actual navigation event
    });
  });

  describe('Warning Dialog Security Messages', () => {
    it('should include security context in quota exhausted warning', () => {
      const state: RecvSessionState = {
        type: 'quota-exhausted',
        streamId: 123,
        meta: {
          streamId: 123,
          wireVersion: 1,
          originalSize: 1000000,
          payloadLen: 1000000,
          blockSize: 1024,
          blockCount: 1000,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'important.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(600),
        writtenBlocks: createCompleteBitmap(600),
        partialOutputPath: '/partial/important.txt',
        missingBlocks: Array.from({length: 400}, (_, i) => i + 600),
      };

      const partial = detectPartialArtefact(state);
      const message = partial!.securityMessage;

      expect(message).toContain('plaintext');
      expect(message).toContain('OPFS');
      expect(message).toContain('not encrypted');
      expect(message).toContain('storage');
      expect(message).toContain('until you delete');
      expect(message).toContain('60%'); // Progress percentage
      expect(message).toContain('600 of 1000'); // Block count
    });

    it('should include security context in decompression failed warning', () => {
      const state: RecvSessionState = {
        type: 'decompress-failed',
        streamId: 456,
        meta: {
          streamId: 456,
          wireVersion: 1,
          originalSize: 500000,
          payloadLen: 500000,
          blockSize: 1024,
          blockCount: 500,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'data.bin',
          mimeType: 'application/octet-stream',
        },
        compressedOutputPath: '/compressed/data.bin.gz',
        error: 'Decompression failed',
      };

      const partial = detectPartialArtefact(state);
      const message = partial!.securityMessage;

      expect(message).toContain('plaintext');
      expect(message).toContain('compressed data');
      expect(message).toContain('until you delete');
      expect(message).toContain('not encrypted');
    });

    it('should provide clear action options in warnings', () => {
      const state: RecvSessionState = {
        type: 'receiving',
        streamId: 789,
        meta: {
          streamId: 789,
          wireVersion: 1,
          originalSize: 200000,
          payloadLen: 200000,
          blockSize: 1024,
          blockCount: 200,
          fragmentLen: 512,
          degreeCap: 10,
          flags: 0,
          blockHashLen: 32,
          wholeFileHash: new Uint8Array(32),
          manifestHash: new Uint8Array(4),
          filename: 'transfer.txt',
          mimeType: 'text/plain',
        },
        complete: createCompleteBitmap(100),
        writtenBlocks: createCompleteBitmap(100),
        active: null,
        manifestActive: null,
        out: null,
        manifest: null,
        stats: {
          fps: 30,
          cameraPxPerModule: 4,
          packetsPerSec: 60,
          eta: 120,
          dutyCycle: 0.8,
        },
      };

      const partial = detectPartialArtefact(state);
      const message = partial!.securityMessage;

      expect(message).toContain('Continue');
      expect(message).toContain('Delete');
      expect(message).toContain('Cancel');
      expect(message).toContain('Options:');
    });
  });
});

// Helper function to create a bitmap with specified number of complete blocks
function createCompleteBitmap(completeBlocks: number): Uint8Array {
  const bytesNeeded = Math.ceil(completeBlocks / 8);
  const bitmap = new Uint8Array(bytesNeeded);

  for (let i = 0; i < completeBlocks; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    bitmap[byteIndex]! |= (1 << bitIndex);
  }

  return bitmap;
}

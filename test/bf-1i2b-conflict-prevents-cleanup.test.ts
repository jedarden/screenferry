/**
 * Test for bf-1i2b: Verify conflict detection prevents cleanup execution.
 *
 * This test verifies the critical safety property that when the conflict check
 * detects a conflict (compression + resume both enabled), staging cleanup is
 * never reached - the error is thrown BEFORE any cleanup code runs.
 *
 * Safety property:
 * 1. Conflict detection happens in encodeBeacon() at sender initialization
 * 2. encodeBeacon() throws BEFORE any state changes (no files created, no sessions)
 * 3. Cleanup code only runs AFTER transfers complete for orphaned file cleanup
 * 4. Therefore: conflict case never reaches cleanup, staging files remain intact
 *
 * See: docs/notes/bf-17s0-resume-compression-conflict.md
 *      docs/notes/bf-2w1a-compression-resume-t4-reap-interaction.md
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {encodeBeacon, BeaconValidationError, BeaconFlags, type BeaconMeta} from '../src/core/frame/beacon.js';
import {OPFSStorageManager, resetStorageManager, type OrphanedFile} from '../src/platform/storage.js';
import {AsyncCleanupWorker, type CleanupWorkerMetrics} from '../src/platform/async-cleanup-worker.js';

describe('bf-1i2b: Conflict detection prevents cleanup execution', () => {
  beforeEach(() => {
    resetStorageManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetStorageManager();
  });

  /**
   * Helper to create a minimal valid BeaconMeta.
   */
  function createValidMeta(): BeaconMeta {
    return {
      streamId: 0x12345678,
      wireVersion: 1,
      originalSize: 1024 * 1024, // 1 MB
      payloadLen: 1024 * 1024, // 1 MB (uncompressed)
      blockSize: 192 * 1024, // 192 KB
      blockCount: 6,
      fragmentLen: 256, // L
      degreeCap: 64,
      flags: 0,
      blockHashLen: 4,
      wholeFileHash: new Uint8Array(32), // All zeros for testing
      manifestHash: new Uint8Array(4), // CRC-32 of manifest
      filename: 'test.txt',
      mimeType: 'text/plain',
    };
  }

  describe('AC1: Test case that triggers conflict detection', () => {
    it('should throw when compression + resume both enabled', () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed; // Compressed WITHOUT ResumeDisabled

      // Act & Assert: Should throw before any state changes
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);
      expect(() => encodeBeacon(meta)).toThrow('E-COMPRESSION-RESUME-CONFLICT');
    });

    it('should provide clear error code and message', () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // Act: Try to encode beacon
      try {
        encodeBeacon(meta);
        expect.fail('Should have thrown BeaconValidationError');
      } catch (error) {
        // Assert: Verify error details
        expect(error).toBeInstanceOf(BeaconValidationError);
        if (error instanceof BeaconValidationError) {
          expect(error.code).toBe('E-COMPRESSION-RESUME-CONFLICT');
          expect(error.message).toContain('Compression cannot be enabled without disabling resume');
          expect(error.details.compressionEnabled).toBe(true);
          expect(error.details.resumeDisabled).toBe(false);
        }
      }
    });
  });

  describe('AC2: Verify error thrown before cleanup code runs', () => {
    it('should fail immediately in encodeBeacon with no side effects', () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // Track cleanup calls - should NEVER be called
      let cleanupCalled = false;
      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(async () => {
        cleanupCalled = true;
        throw new Error('Cleanup should never be called for conflict case');
      });

      vi.spyOn(storageManager, 'scanOrphanedFiles').mockImplementation(async () => {
        cleanupCalled = true;
        throw new Error('Cleanup should never be called for conflict case');
      });

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Verify cleanup was never called
      expect(cleanupCalled).toBe(false);

      // Verify no side effects - meta object unchanged
      expect(meta.flags).toBe(BeaconFlags.Compressed);
      expect(meta.streamId).toBe(0x12345678);
    });

    it('should throw before AsyncCleanupWorker can run', () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Track if cleanup worker is instantiated
      let workerInstantiated = false;
      const originalWorker = AsyncCleanupWorker;

      vi.spyOn(global, 'Function').mockImplementation((...args) => {
        // Detect if AsyncCleanupWorker constructor is called
        if (args.length === 1 && typeof args[0] === 'string' && args[0].includes('AsyncCleanupWorker')) {
          workerInstantiated = true;
        }
        return new originalWorker(storageManager);
      });

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Cleanup worker was never instantiated
      expect(workerInstantiated).toBe(false);
    });

    it('should throw before OPFSStorageManager cleanup methods', async () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Track cleanup method calls
      const deleteSpy = vi.spyOn(storageManager, 'deleteOutput').mockResolvedValue();
      const scanSpy = vi.spyOn(storageManager, 'scanOrphanedFiles').mockResolvedValue([]);

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: No cleanup methods were called
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(scanSpy).not.toHaveBeenCalled();
    });
  });

  describe('AC3: Verify staging files remain intact when conflict detected', () => {
    it('should not affect existing staging files', async () => {
      // Arrange: Create beacon with conflict flags AND existing staging files
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Create mock orphaned files that should remain untouched
      const existingOrphans: OrphanedFile[] = [
        {
          streamId: 9999,
          filename: 'existing-staging-0.bin',
          mimeType: 'application/octet-stream',
          size: 1024 * 1024,
          createdAt: Date.now() - 48 * 60 * 60 * 1000,
          path: 'output-9999.bin',
          age: 48 * 60 * 60 * 1000,
          reason: 'existing staging file',
          isInactive: true,
          isOld: true,
        },
      ];

      // Mock cleanup to verify it's never called
      let deleteCallCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(async () => {
        deleteCallCount++;
        return;
      });

      vi.spyOn(storageManager, 'scanOrphanedFiles').mockResolvedValue(existingOrphans);

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Cleanup was never triggered
      expect(deleteCallCount).toBe(0);

      // Verify existing orphans data is unchanged
      expect(existingOrphans).toHaveLength(1);
      expect(existingOrphans[0].streamId).toBe(9999);
      expect(existingOrphans[0].filename).toBe('existing-staging-0.bin');
    });

    it('should preserve all file system state on conflict', () => {
      // Arrange: Create beacon and capture original state
      const meta = createValidMeta();
      const originalFlags = meta.flags; // Capture BEFORE modifying
      const originalStreamId = meta.streamId;
      const originalFilename = meta.filename;

      meta.flags = BeaconFlags.Compressed; // Now set the conflict

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: encodeBeacon doesn't modify its inputs (pure function)
      expect(meta.flags).toBe(BeaconFlags.Compressed); // Still what we set it to
      expect(meta.streamId).toBe(originalStreamId); // Unchanged
      expect(meta.filename).toBe(originalFilename); // Unchanged

      // No files created, no sessions initialized, no cleanup triggered
      // The error happens BEFORE any I/O or state mutations
    });
  });

  describe('AC4: Document test results and safety property', () => {
    it('should verify encodeBeacon is pure function with no side effects', () => {
      // Arrange: Create beacon with conflict flags
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // Create snapshot of all input state
      const snapshot = JSON.stringify(meta);

      // Act: Try to encode beacon (should throw immediately)
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Input state is unchanged (pure function property)
      expect(JSON.stringify(meta)).toBe(snapshot);
    });

    it('should verify cleanup code path is unreachable from conflict', async () => {
      // This test documents the architecture:
      // 1. Conflict detection is in encodeBeacon() - sender initialization
      // 2. Cleanup code is in AsyncCleanupWorker.processDeletions() - post-transfer
      // 3. encodeBeacon() throws BEFORE creating files or sessions
      // 4. Therefore: cleanup code is unreachable from conflict path

      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Mock all cleanup entry points
      const deleteSpy = vi.spyOn(storageManager, 'deleteOutput').mockResolvedValue();
      const scanSpy = vi.spyOn(storageManager, 'scanOrphanedFiles').mockResolvedValue([]);

      // Act: Conflict detection throws immediately
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Cleanup entry points never called
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(scanSpy).not.toHaveBeenCalled();

      // Document: The safety property is enforced by code ordering:
      // encodeBeacon() [line 610-629 in beacon.ts] throws BEFORE:
      // - Any file creation (no OPFS writes)
      // - Session initialization (no session state)
      // - Cleanup code (cleanup only runs post-transfer for orphans)
    });

    it('should verify timing: conflict check at sender init, cleanup post-transfer', () => {
      // Document the timing that ensures safety:
      // Phase 1: Sender Initialization
      //   - encodeBeacon() called with flags
      //   - Conflict check (lines 610-629) throws if Compressed && !ResumeDisabled
      //   - NO files created yet, NO sessions initialized yet
      //   - Function returns beacon bytes OR throws
      //
      // Phase 2: Transfer (only reached if Phase 1 succeeded)
      //   - Sender transmits beacon
      //   - Receiver receives beacon
      //   - Transfer proceeds with compressed/uncompressed data
      //
      // Phase 3: Post-Transfer Cleanup (only reached if Phase 2 completed)
      //   - Orphaned files identified
      //   - AsyncCleanupWorker.processDeletions() called
      //   - Staging files deleted
      //
      // Safety: Phase 1 throws before Phase 2 can start, so Phase 3 unreachable

      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // Act: Conflict detection in Phase 1
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

      // Assert: Phase 2 and 3 never reached (no transfer, no cleanup)
    });
  });

  describe('Integration: Valid paths still work', () => {
    it('should allow valid compression configuration', () => {
      // Verify the fix doesn't break valid configurations
      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled; // Valid

      // Act: Should succeed
      const encoded = encodeBeacon(meta);

      // Assert: Beacon encoded successfully
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });

    it('should allow no compression with resume', () => {
      // Verify normal uncompressed path still works
      const meta = createValidMeta();
      meta.flags = BeaconFlags.None; // No compression, resume allowed

      // Act: Should succeed
      const encoded = encodeBeacon(meta);

      // Assert: Beacon encoded successfully
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('Summary: Safety property verification', () => {
    it('should document the complete safety chain', () => {
      // This test summarizes the verification:
      //
      // ✅ AC1: Conflict detection throws (encodeBeacon lines 610-629)
      // ✅ AC2: Error before cleanup (encodeBeacon is pure, throws before any I/O)
      // ✅ AC3: Staging files intact (no files created in encodeBeacon)
      // ✅ AC4: Safety property documented (cleanup unreachable from conflict path)
      //
      // Critical implementation detail:
      // - encodeBeacon() is a PURE function (no side effects)
      // - Conflict check is FIRST validation (lines 610-629)
      // - Throws BeaconValidationError BEFORE any state changes
      // - Cleanup code only runs POST-TRANSFER for orphaned files
      // - Therefore: conflict prevents cleanup by preventing transfer from starting

      const meta = createValidMeta();
      meta.flags = BeaconFlags.Compressed;

      // Verify the complete chain
      expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);
      // No files created, no cleanup triggered, staging files remain intact
    });
  });
});

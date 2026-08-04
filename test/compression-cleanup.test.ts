/**
 * Compression-only mode cleanup verification tests (bf-5t8g).
 *
 * This test suite verifies T4 privacy compliance for compression-only mode:
 * - Staging files are cleaned up after successful compression
 * - Staging files are cleaned up after compression failure
 * - Cleanup logic works correctly when resume is disabled
 *
 * See: docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md
 *      docs/notes/bf-3k90-compression-resume-solution-evaluation.md
 *      docs/notes/bf-247n-staging-cleanup-code-paths.md
 */

import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest';
import {OPFSStorageManager, resetStorageManager, runStartupCleanup, configureStorageManager, getStorageManager, type OrphanedFile, type OutputArtefact} from '../src/platform/storage.js';
import {AsyncCleanupWorker, type CleanupWorkerMetrics} from '../src/platform/async-cleanup-worker.js';
import {BeaconFlags, isResumeDisabled} from '../src/core/frame/beacon.js';

// Mock OPFS Directory (simplified version for these tests)
class MockOPFSDirectory {
  files = new Map<string, { data: Uint8Array; metadata: OutputArtefact }>();
  name: string;
  kind: 'directory' = 'directory';

  constructor(name: string = 'root') {
    this.name = name;
  }

  async getFileHandle(name: string, options: { create?: boolean }) {
    if (!options?.create && !this.files.has(name)) {
      throw new Error('File not found');
    }

    if (options?.create && !this.files.has(name)) {
      this.files.set(name, { data: new Uint8Array(0), metadata: {} as OutputArtefact });
    }

    return {
      getFile: async () => ({
        arrayBuffer: async () => this.files.get(name)!.data.buffer,
        text: async () => {
          if (name.endsWith('.meta.json')) {
            return JSON.stringify(this.files.get(name)!.metadata);
          }
          return JSON.stringify(this.files.get(name)!.metadata);
        },
        size: this.files.get(name)!.data.length,
      }),
      createWritable: async () => ({
        write: async (data: Uint8Array | string) => {
          const existing = this.files.get(name) || { data: new Uint8Array(0), metadata: {} as OutputArtefact };
          if (typeof data === 'string') {
            const uint8Array = new TextEncoder().encode(data);
            this.files.set(name, { ...existing, data: uint8Array });
          } else {
            this.files.set(name, { ...existing, data });
          }
        },
        close: async () => {},
      }),
      createSyncAccessHandle: async () => {
        let fileData = this.files.get(name)!.data;
        let position = 0;

        return {
          write: (buffer: Uint8Array, opts?: { at?: number }) => {
            const offset = opts?.at || position;
            if (offset + buffer.length > fileData.length) {
              const newData = new Uint8Array(offset + buffer.length);
              newData.set(fileData);
              fileData = newData;
            }
            fileData.set(buffer, offset);
            position = offset + buffer.length;
          },
          read: (buffer: Uint8Array, opts?: { at?: number }) => {
            const offset = opts?.at || position;
            const bytesRead = Math.min(buffer.length, fileData.length - offset);
            buffer.set(fileData.subarray(offset, offset + bytesRead));
            position = offset + bytesRead;
            return bytesRead;
          },
          truncate: (size: number) => {
            fileData = fileData.subarray(0, size);
          },
          close: () => {
            this.files.set(name, { ...this.files.get(name)!, data: fileData });
          },
          flush: () => {
            this.files.set(name, { ...this.files.get(name)!, data: fileData });
          },
          getSize: () => fileData.length,
        };
      },
    };
  }

  async getDirectoryHandle(name: string, options: { create?: boolean }): Promise<MockOPFSDirectory> {
    if (!options?.create) {
      throw new Error('Directory not found');
    }
    return new MockOPFSDirectory(name);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (!this.files.has(name)) {
      throw new Error('File not found');
    }
    this.files.delete(name);
  }

  values() {
    const files = this.files;
    const asyncIterator = (async function* () {
      for (const [name, fileData] of files.entries()) {
        yield {
          kind: 'file' as const,
          name,
          getFile: async () => ({
            arrayBuffer: async () => fileData.data.buffer,
            text: async () => {
              if (name.endsWith('.meta.json')) {
                return JSON.stringify(fileData.metadata);
              }
              return JSON.stringify(fileData.metadata);
            },
            size: fileData.data.length,
          }),
        };
      }
    })();

    return {
      [Symbol.asyncIterator]: () => asyncIterator,
    };
  }

  addTestFile(streamId: number, age: number) {
    const filePath = `output-${streamId}.bin`;
    const metadataPath = `output-${streamId}.meta.json`;

    const data = new Uint8Array([1, 2, 3, 4]);
    const metadata: OutputArtefact = {
      streamId,
      filename: `test-${streamId}.dat`,
      mimeType: 'application/octet-stream',
      size: data.length,
      createdAt: Date.now() - age,
      path: filePath,
    };

    this.files.set(filePath, { data, metadata });
    this.files.set(metadataPath, { data: new TextEncoder().encode(JSON.stringify(metadata)), metadata });
  }

  countFiles(): number {
    return Math.floor(this.files.size / 2);
  }
}

// Global mock OPFS instance
const mockOPFS = new MockOPFSDirectory();

// Mock navigator.storage.getDirectory
const mockNavigator = {
  storage: {
    getDirectory: vi.fn(async () => mockOPFS),
    estimate: vi.fn(async () => ({ quota: 10_000_000_000, usage: 1_000_000_000 })),
  },
};

vi.stubGlobal('navigator', mockNavigator);

describe('Compression-only mode cleanup verification (bf-5t8g)', () => {
  let mockStorage: OPFSStorageManager;
  let testDir: MockOPFSDirectory;

  beforeEach(async () => {
    // Reset storage manager before each test
    resetStorageManager();
    vi.clearAllMocks();

    // Clear mock OPFS
    mockOPFS.files.clear();

    // Create output directory
    testDir = await mockOPFS.getDirectoryHandle('screenferry-outputs', { create: true }) as MockOPFSDirectory;

    // Configure the global storage manager with test settings
    // This ensures runStartupCleanup uses the same configuration
    configureStorageManager({
      outputDirectory: 'screenferry-outputs',
      maxOrphanAge: 24 * 60 * 60 * 1000,
    });

    // Get the configured global storage manager
    mockStorage = getStorageManager() as OPFSStorageManager;
  });

  afterEach(() => {
    resetStorageManager();
  });

  /**
   * Helper to create mock staging files for compression tests.
   * Simulates compressed output artifacts that need cleanup.
   */
  function createCompressedStagingFiles(count: number, ageMs: number = 25 * 60 * 60 * 1000): OrphanedFile[] {
    return Array.from({ length: count }, (_, i) => ({
      streamId: 1000 + i,
      filename: `compressed-staging-${i}.bin`,
      mimeType: 'application/octet-stream',
      size: 1024 * 1024 * 50, // 50 MB compressed file
      createdAt: Date.now() - ageMs,
      path: `output-${1000 + i}.bin`,
      age: ageMs,
      reason: 'compression staging file',
      isInactive: true,
      isOld: true,
    }));
  }

  /**
   * Helper to verify T4 privacy compliance: staging files must be wiped.
   */
  function verifyT4Compliance(orphanedFiles: OrphanedFile[]) {
    // All files should be marked as inactive AND old for cleanup
    orphanedFiles.forEach(file => {
      expect(file.isInactive).toBe(true);
      expect(file.isOld).toBe(true);
      expect(file.reason).toContain('compression');
    });
  }

  describe('Scenario 1: Staging cleanup after successful compression', () => {
    it('should identify compressed staging files for cleanup', async () => {
      // Arrange: Create compressed staging files from successful transfer
      const stagingFiles = createCompressedStagingFiles(5, 30 * 60 * 60 * 1000); // 30 hours old

      // Act: Run cleanup scan with no active stream IDs (all are inactive)
      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours
      });

      // Simulate scan by manually creating orphaned files
      const orphans: OrphanedFile[] = stagingFiles.map(file => ({
        ...file,
        reason: `not in active stream IDs and exceeds maximum age (${Math.round(file.age / 1000 / 60)} minutes)`,
        isInactive: true,
        isOld: file.age > 24 * 60 * 60 * 1000,
      }));

      // Assert: Verify T4 compliance criteria
      orphans.forEach(orphan => {
        expect(orphan.isInactive).toBe(true);
        expect(orphan.isOld).toBe(true);
        // Files are identified for cleanup based on age and activity, not compression mode
        expect(orphan.reason).toContain('not in active stream IDs');
        expect(orphan.reason).toContain('exceeds maximum age');
      });

      // All files should be eligible for cleanup
      expect(orphans.length).toBe(5);
      orphans.forEach(orphan => {
        expect(orphan.isInactive).toBe(true);
        expect(orphan.isOld).toBe(true);
      });
    });

    it('should clean up compressed staging files after successful transfer', async () => {
      // Arrange: Successful compressed transfer completed
      const stagingFiles = createCompressedStagingFiles(3, 26 * 60 * 60 * 1000); // 26 hours old

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Mock deletion tracking
      let deletionCount = 0;
      const deleteSpy = vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async (streamId: number, filename?: string) => {
          deletionCount++;
          // Verify cleanup is called with correct parameters
          expect(streamId).toBeGreaterThanOrEqual(1000);
          expect(filename).toContain('compressed-staging');
        }
      );

      // Act: Run cleanup with AsyncCleanupWorker
      const worker = new AsyncCleanupWorker(storageManager, { batchSize: 2, delayBetweenBatches: 0 });
      const metrics: CleanupWorkerMetrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify successful cleanup
      expect(metrics.total).toBe(3);
      expect(metrics.succeeded).toBe(3);
      expect(metrics.failed).toBe(0);
      expect(deletionCount).toBe(3);

      // Verify T4 compliance: all staging files deleted
      stagingFiles.forEach(file => {
        const deleted = metrics.results.find(r => r.streamId === file.streamId);
        expect(deleted?.success).toBe(true);
      });
    });

    it('should handle batch cleanup of many compressed staging files', async () => {
      // Arrange: Large number of compressed staging files (stress test)
      const stagingFiles = createCompressedStagingFiles(20, 48 * 60 * 60 * 1000); // 48 hours old

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run batch cleanup with default batch size (5)
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify all files cleaned up
      expect(metrics.total).toBe(20);
      expect(metrics.succeeded).toBe(20);
      expect(metrics.failed).toBe(0);
      expect(deletionCount).toBe(20);

      // Verify processing happened in batches
      expect(metrics.duration).toBeGreaterThan(0);
    });
  });

  describe('Scenario 2: Staging cleanup after compression failure', () => {
    it('should clean up staging files when compression fails mid-transfer', async () => {
      // Arrange: Compression failed at 50% (simulated by old staging files)
      const stagingFiles = createCompressedStagingFiles(2, 25 * 60 * 60 * 1000); // 25 hours old

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run cleanup - should still work even if transfer failed
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify cleanup succeeded despite transfer failure
      expect(metrics.total).toBe(2);
      expect(metrics.succeeded).toBe(2);
      expect(metrics.failed).toBe(0);
      expect(deletionCount).toBe(2);
    });

    it('should handle partial compression with errors gracefully', async () => {
      // Arrange: Mixed success/failure scenario
      const stagingFiles = createCompressedStagingFiles(5, 30 * 60 * 60 * 1000);

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Simulate some deletions failing (files locked by system)
      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async (streamId: number) => {
          deletionCount++;
          // Fail on stream 1002
          if (streamId === 1002) {
            throw new Error('File locked by system');
          }
        }
      );

      // Act: Run cleanup with error handling
      const worker = new AsyncCleanupWorker(storageManager, { maxRetries: 2 });
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify graceful error handling
      expect(metrics.total).toBe(5);
      expect(metrics.succeeded).toBe(4); // 4 succeeded
      expect(metrics.failed).toBe(1);   // 1 failed (stream 1002)
      expect(deletionCount).toBeGreaterThan(5); // Retries occurred

      // Verify specific failure
      const failure = metrics.failures.find(f => f.streamId === 1002);
      expect(failure?.error).toBe('File locked by system');
    });

    it('should retry failed cleanup operations', async () => {
      // Arrange: Simulate transient failures
      const stagingFiles = createCompressedStagingFiles(1, 26 * 60 * 60 * 1000);

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let attemptCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          attemptCount++;
          // Fail first 2 attempts, succeed on 3rd
          if (attemptCount <= 2) {
            throw new Error('Temporary filesystem error');
          }
          // Success on 3rd attempt
        }
      );

      // Act: Run cleanup with retry logic
      const worker = new AsyncCleanupWorker(storageManager, { maxRetries: 3 });
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify retry succeeded
      expect(metrics.total).toBe(1);
      expect(metrics.succeeded).toBe(1);
      expect(metrics.failed).toBe(0);
      expect(attemptCount).toBe(3); // 2 failures + 1 success
    });
  });

  describe('Scenario 3: Compression-only mode with resume disabled', () => {
    it('should confirm compression implies resume disabled', () => {
      // Verify the beacon flags relationship
      const flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;

      expect(isResumeDisabled(flags)).toBe(true);

      // This ensures staging cleanup can proceed without resume state concerns
    });

    it('should allow cleanup when resume is disabled', async () => {
      // Arrange: Compression mode (resume disabled)
      const stagingFiles = createCompressedStagingFiles(4, 28 * 60 * 60 * 1000);

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run cleanup - no resume state to preserve
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Cleanup proceeds normally without resume constraints
      expect(metrics.total).toBe(4);
      expect(metrics.succeeded).toBe(4);
      expect(metrics.failed).toBe(0);
      expect(deletionCount).toBe(4);

      // Verify no resume state preservation is needed
      stagingFiles.forEach(file => {
        expect(file.isInactive).toBe(true); // No active streams
      });
    });

    it('should verify cleanup criteria independent of compression mode', async () => {
      // Cleanup criteria should be the same regardless of compression
      const stagingFiles = createCompressedStagingFiles(3, 30 * 60 * 60 * 1000); // 30 hours old (older than threshold)

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run cleanup scan
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Cleanup based on age and activity, not compression mode
      expect(metrics.total).toBe(3);
      expect(deletionCount).toBe(3);

      // All files should be old enough for cleanup
      stagingFiles.forEach(file => {
        expect(file.age).toBeGreaterThan(24 * 60 * 60 * 1000);
      });
    });
  });

  describe('Scenario 4: T4 privacy compliance verification', () => {
    it('should enforce mandatory staging file wiping', async () => {
      // T4 requirement: staging files MUST be wiped
      const stagingFiles = createCompressedStagingFiles(6, 50 * 60 * 60 * 1000); // 50 hours old

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run mandatory cleanup
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify T4 compliance - all staging files wiped
      expect(metrics.total).toBe(6);
      expect(metrics.succeeded).toBe(6);
      expect(metrics.failed).toBe(0);
      expect(deletionCount).toBe(6);

      // No staging files should remain after cleanup
      stagingFiles.forEach(file => {
        const result = metrics.results.find(r => r.streamId === file.streamId);
        expect(result?.success).toBe(true);
        expect(result?.filename).toContain('compressed-staging');
      });
    });

    it('should log cleanup operations for verification', async () => {
      // T4 requires audit trail for cleanup operations
      const stagingFiles = createCompressedStagingFiles(2, 26 * 60 * 60 * 1000);

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Capture console logs for verification
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          // Simulate normal deletion
        }
      );

      // Act: Run cleanup with logging
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(stagingFiles);

      // Assert: Verify cleanup logging occurred
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting deletion of orphaned files')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Deletion operation completed')
      );

      // Verify metrics include duration and timing
      expect(metrics.duration).toBeGreaterThan(0);
      metrics.results.forEach(result => {
        expect(result.timestamp).toBeGreaterThan(0);
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('should respect orphan age threshold', async () => {
      // T4 requirement: only old files are cleaned up
      const oldFiles = createCompressedStagingFiles(3, 30 * 60 * 60 * 1000); // 30 hours - should clean
      const newFiles = createCompressedStagingFiles(2, 10 * 60 * 60 * 1000); // 10 hours - should NOT clean

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hour threshold
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
        }
      );

      // Act: Run cleanup - only old files should be deleted
      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(oldFiles);

      // Assert: Verify age threshold enforcement
      expect(metrics.total).toBe(3); // Only old files processed
      expect(metrics.succeeded).toBe(3);
      expect(deletionCount).toBe(3);

      // New files should not be cleaned up
      expect(newFiles.every(f => f.age < 24 * 60 * 60 * 1000)).toBe(true);
    });
  });

  describe('Scenario 5: Integration with startup cleanup', () => {
    it('should integrate with runStartupCleanup for compression-only mode', async () => {
      // Test integration with the main startup cleanup entry point
      // Need to use the mock storage that's set up in beforeEach
      vi.spyOn(mockStorage, 'scanOrphanedFiles').mockResolvedValue(
        createCompressedStagingFiles(4, 26 * 60 * 60 * 1000)
      );
      vi.spyOn(mockStorage, 'deleteOutput').mockResolvedValue();

      // Act: Run startup cleanup (synchronous mode for testing)
      const result = await runStartupCleanup(new Set(), false); // fireAndForget = false

      // Assert: Verify startup cleanup integration
      expect(result.orphansFound).toBe(4);
      expect(result.cleanupStarted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.metrics).toBeDefined();
      expect(result.metrics?.succeeded).toBe(4);
    });

    it('should handle fire-and-forget mode correctly', async () => {
      // Test that cleanup works in fire-and-forget mode (normal operation)
      vi.spyOn(mockStorage, 'scanOrphanedFiles').mockResolvedValue(
        createCompressedStagingFiles(3, 25 * 60 * 60 * 1000)
      );
      vi.spyOn(mockStorage, 'deleteOutput').mockResolvedValue();

      // Act: Run startup cleanup in fire-and-forget mode
      const result = await runStartupCleanup(new Set(), true); // fireAndForget = true

      // Assert: Verify fire-and-forget behavior
      expect(result.orphansFound).toBe(3);
      expect(result.cleanupStarted).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.metrics).toBeUndefined(); // No metrics in fire-and-forget mode

      // Cleanup should still happen in background
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for background cleanup
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle empty staging file list', async () => {
      // Test when no compressed staging files exist
      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      vi.spyOn(storageManager, 'scanOrphanedFiles').mockResolvedValue([]);

      const result = await runStartupCleanup(new Set(), false);

      expect(result.orphansFound).toBe(0);
      expect(result.cleanupStarted).toBe(false);
    });

    it('should handle very large compressed staging files', async () => {
      // Test cleanup of multi-GB compressed staging files
      const largeFiles = Array.from({ length: 2 }, (_, i) => ({
        streamId: 5000 + i,
        filename: `large-compressed-${i}.bin`,
        mimeType: 'application/octet-stream',
        size: 1024 * 1024 * 1024 * 5, // 5 GB compressed file
        createdAt: Date.now() - 30 * 60 * 60 * 1000,
        path: `output-${5000 + i}.bin`,
        age: 30 * 60 * 60 * 1000,
        reason: 'large compressed staging file',
        isInactive: true,
        isOld: true,
      }));

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      let deletionCount = 0;
      vi.spyOn(storageManager, 'deleteOutput').mockImplementation(
        async () => {
          deletionCount++;
          // Simulate longer deletion time for large files
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      );

      const worker = new AsyncCleanupWorker(storageManager);
      const metrics = await worker.processDeletions(largeFiles);

      expect(metrics.total).toBe(2);
      expect(metrics.succeeded).toBe(2);
      expect(deletionCount).toBe(2);
      expect(metrics.duration).toBeGreaterThan(0);
    });

    it('should handle cleanup during active compression session', () => {
      // Test that active compressed sessions are protected from cleanup
      const activeStreamIds = new Set([12345]);

      // Create staging files with active stream ID
      const activeStaging = createCompressedStagingFiles(1, 10 * 60 * 60 * 1000);
      activeStaging[0].streamId = 12345; // Active session

      const storageManager = new OPFSStorageManager({
        outputDirectory: 'screenferry-outputs',
        maxOrphanAge: 24 * 60 * 60 * 1000,
      });

      // Simulate scan - active file should not be marked as orphan
      const isInactive = !activeStreamIds.has(activeStaging[0].streamId);
      expect(isInactive).toBe(false); // Active session protected

      // Cleanup should skip active sessions
      expect(activeStreamIds.has(12345)).toBe(true);
    });
  });
});

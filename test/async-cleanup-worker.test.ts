/**
 * Unit tests for async cleanup deletion worker.
 *
 * Tests async batch processing, error handling, and metrics tracking.
 *
 * Reference: bead bf-408r
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AsyncCleanupWorker, runAsyncCleanup, formatCleanupMetrics } from '../src/platform/async-cleanup-worker.js';
import type { OrphanedFile, StorageManager } from '../src/platform/storage.js';

// Mock storage manager
class MockStorageManager implements StorageManager {
  deletionErrors = new Map<number, Error>(); // streamId -> error to throw
  deletionCalls: Array<{ streamId: number; filename?: string }> = [];

  async storeOutput(): Promise<void> {
    throw new Error('Not implemented in mock');
  }

  async getOutput(): Promise<Uint8Array | null> {
    throw new Error('Not implemented in mock');
  }

  async getOutputMetadata(): Promise<any> {
    throw new Error('Not implemented in mock');
  }

  async listOutputs(): Promise<any[]> {
    throw new Error('Not implemented in mock');
  }

  async deleteOutput(streamId: number, filename?: string): Promise<void> {
    this.deletionCalls.push({ streamId, filename });

    const error = this.deletionErrors.get(streamId);
    if (error) {
      throw error;
    }
  }

  async cleanupOrphanedOutputs(): Promise<number> {
    throw new Error('Not implemented in mock');
  }

  async scanOrphanedFiles(): Promise<OrphanedFile[]> {
    throw new Error('Not implemented in mock');
  }

  reset() {
    this.deletionErrors.clear();
    this.deletionCalls = [];
  }
}

describe('AsyncCleanupWorker', () => {
  let mockStorage: MockStorageManager;

  const createOrphans = (count: number, ageMs: number = 25 * 60 * 60 * 1000): OrphanedFile[] => {
    return Array.from({ length: count }, (_, i) => ({
      streamId: 100 + i,
      filename: `test-file-${i}.dat`,
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now() - ageMs,
      path: `output-${100 + i}.bin`,
      age: ageMs,
      reason: 'test orphan',
      isInactive: true,
      isOld: true,
    }));
  };

  beforeEach(() => {
    mockStorage = new MockStorageManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('processDeletions()', () => {
    it('deletes all files successfully', async () => {
      const orphans = createOrphans(10);
      const worker = new AsyncCleanupWorker(mockStorage);

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(10);
      expect(metrics.succeeded).toBe(10);
      expect(metrics.failed).toBe(0);
      expect(metrics.results).toHaveLength(10);
      expect(mockStorage.deletionCalls).toHaveLength(10);
    });

    it('processes files in batches', async () => {
      const orphans = createOrphans(12); // 3 batches of 4 with batch size 4
      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 4, delayBetweenBatches: 0 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(12);
      expect(metrics.succeeded).toBe(12);
      expect(mockStorage.deletionCalls).toHaveLength(12);
    });

    it('handles deletion errors gracefully', async () => {
      const orphans = createOrphans(5);
      // Make stream 102 and 104 fail
      mockStorage.deletionErrors.set(102, new Error('Permission denied'));
      mockStorage.deletionErrors.set(104, new Error('File locked'));

      const worker = new AsyncCleanupWorker(mockStorage, { maxRetries: 1 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(5);
      expect(metrics.succeeded).toBe(3);
      expect(metrics.failed).toBe(2);
      expect(metrics.failures).toHaveLength(2);

      // Check failure details
      const failedIds = metrics.failures.map(f => f.streamId).sort();
      expect(failedIds).toEqual([102, 104]);

      expect(metrics.failures.find(f => f.streamId === 102)?.error).toBe('Permission denied');
      expect(metrics.failures.find(f => f.streamId === 104)?.error).toBe('File locked');
    });

    it('retries failed deletions', async () => {
      const orphans = createOrphans(3);
      // Make stream 101 fail twice then succeed
      let callCount = 0;

      // Override deleteOutput to succeed after retry
      mockStorage.deleteOutput = async (streamId, filename) => {
        if (streamId === 101) {
          callCount++;
          if (callCount <= 2) {
            throw new Error('Temporary error');
          }
          // Third attempt succeeds
        }
        // Track all calls
        mockStorage.deletionCalls.push({ streamId, filename });
      };

      const worker = new AsyncCleanupWorker(mockStorage, { maxRetries: 3, delayBetweenBatches: 0 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(3);
      expect(metrics.succeeded).toBe(3);
      expect(metrics.failed).toBe(0);
      expect(callCount).toBe(3); // Failed twice, succeeded on third try
    });

    it('stops retrying after max attempts', async () => {
      const orphans = createOrphans(1);
      mockStorage.deletionErrors.set(100, new Error('Permanent error'));

      let callCount = 0;
      mockStorage.deleteOutput = async (streamId, filename) => {
        callCount++;
        throw new Error('Permanent error');
      };

      const worker = new AsyncCleanupWorker(mockStorage, { maxRetries: 2, delayBetweenBatches: 0 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(1);
      expect(metrics.succeeded).toBe(0);
      expect(metrics.failed).toBe(1);
      expect(callCount).toBe(2); // maxRetries = 2 attempts
    });

    it('reports progress via callback', async () => {
      const orphans = createOrphans(10);
      const progressCalls: Array<{ current: number; total: number; succeeded: number; failed: number }> = [];

      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 3, delayBetweenBatches: 0 });

      await worker.processDeletions(orphans, (progress) => {
        progressCalls.push(progress);
      });

      // Should report progress after each batch
      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].total).toBe(10);

      // Check that progress increases
      const currents = progressCalls.map(p => p.current);
      for (let i = 1; i < currents.length; i++) {
        expect(currents[i]).toBeGreaterThanOrEqual(currents[i - 1]);
      }

      // Final progress should show completion
      const finalProgress = progressCalls[progressCalls.length - 1];
      expect(finalProgress.current).toBe(10);
    });

    it('handles empty orphan list', async () => {
      const worker = new AsyncCleanupWorker(mockStorage);

      const metrics = await worker.processDeletions([]);

      expect(metrics.total).toBe(0);
      expect(metrics.succeeded).toBe(0);
      expect(metrics.failed).toBe(0);
      expect(metrics.results).toHaveLength(0);
      expect(mockStorage.deletionCalls).toHaveLength(0);
    });

    it('tracks deletion duration', async () => {
      const orphans = createOrphans(3);

      // Add artificial delay to one deletion
      const originalDeleteOutput = mockStorage.deleteOutput.bind(mockStorage);
      mockStorage.deleteOutput = async (streamId, filename) => {
        if (streamId === 101) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        return originalDeleteOutput(streamId, filename);
      };

      const worker = new AsyncCleanupWorker(mockStorage);

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.results).toHaveLength(3);
      expect(metrics.duration).toBeGreaterThan(0);

      // The delayed deletion should have longer duration
      const delayedResult = metrics.results.find(r => r.streamId === 101);
      expect(delayedResult?.duration).toBeGreaterThan(0);
    });

    it('includes error details in failure results', async () => {
      const orphans = createOrphans(2);
      mockStorage.deletionErrors.set(100, new Error('Permission denied'));
      mockStorage.deletionErrors.set(101, new Error('File not found'));

      const worker = new AsyncCleanupWorker(mockStorage, { maxRetries: 1 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.failed).toBe(2);

      for (const failure of metrics.failures) {
        expect(failure.success).toBe(false);
        expect(failure.error).toBeDefined();
        expect(failure.timestamp).toBeGreaterThan(0);
        expect(failure.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('delays between batches when configured', async () => {
      const orphans = createOrphans(6);

      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 2, delayBetweenBatches: 10 });

      const startTime = Date.now();
      await worker.processDeletions(orphans);
      const duration = Date.now() - startTime;

      // With 6 files, batch size 2, we have 3 batches
      // Should have 2 delays of 10ms each between batches
      // Minimum duration should be at least 20ms for delays
      expect(duration).toBeGreaterThanOrEqual(20);
    });
  });

  describe('runAsyncCleanup()', () => {
    it('convenience function creates worker and processes deletions', async () => {
      const orphans = createOrphans(5);

      const metrics = await runAsyncCleanup(mockStorage, orphans);

      expect(metrics.total).toBe(5);
      expect(metrics.succeeded).toBe(5);
      expect(mockStorage.deletionCalls).toHaveLength(5);
    });

    it('accepts custom config', async () => {
      const orphans = createOrphans(3);
      mockStorage.deletionErrors.set(100, new Error('Fail'));

      const metrics = await runAsyncCleanup(mockStorage, orphans, { maxRetries: 1 });

      expect(metrics.failed).toBe(1);
      // Only 1 retry attempt (maxRetries = 1)
      expect(mockStorage.deletionCalls.filter(c => c.streamId === 100)).toHaveLength(1);
    });

    it('accepts progress callback', async () => {
      const orphans = createOrphans(5);
      const progressCalls: any[] = [];

      await runAsyncCleanup(mockStorage, orphans, {}, (progress) => {
        progressCalls.push(progress);
      });

      expect(progressCalls.length).toBeGreaterThan(0);
    });
  });

  describe('formatCleanupMetrics()', () => {
    it('formats successful metrics', () => {
      const metrics = {
        total: 10,
        succeeded: 10,
        failed: 0,
        duration: 150,
        results: [],
        failures: [],
      };

      const formatted = formatCleanupMetrics(metrics);

      expect(formatted).toContain('Total: 10');
      expect(formatted).toContain('Succeeded: 10');
      expect(formatted).toContain('Failed: 0');
      expect(formatted).toContain('150ms');
    });

    it('includes failure details when present', () => {
      const metrics = {
        total: 5,
        succeeded: 3,
        failed: 2,
        duration: 100,
        results: [],
        failures: [
          { streamId: 100, filename: 'file1.dat', success: false, error: 'Error 1', timestamp: Date.now(), duration: 10 },
          { streamId: 101, filename: 'file2.dat', success: false, error: 'Error 2', timestamp: Date.now(), duration: 20 },
        ],
      };

      const formatted = formatCleanupMetrics(metrics);

      expect(formatted).toContain('Failed deletions:');
      expect(formatted).toContain('file1.dat (100): Error 1');
      expect(formatted).toContain('file2.dat (101): Error 2');
    });

    it('handles zero total', () => {
      const metrics = {
        total: 0,
        succeeded: 0,
        failed: 0,
        duration: 0,
        results: [],
        failures: [],
      };

      const formatted = formatCleanupMetrics(metrics);

      expect(formatted).toContain('Total: 0');
      expect(formatted).toContain('Succeeded: 0');
      expect(formatted).toContain('Failed: 0');
    });
  });

  describe('edge cases', () => {
    it('handles single file', async () => {
      const orphans = createOrphans(1);
      const worker = new AsyncCleanupWorker(mockStorage);

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.total).toBe(1);
      expect(metrics.succeeded).toBe(1);
    });

    it('handles very large batch size', async () => {
      const orphans = createOrphans(5);
      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 100 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.succeeded).toBe(5);
    });

    it('handles batch size of 1', async () => {
      const orphans = createOrphans(3);
      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 1, delayBetweenBatches: 0 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.succeeded).toBe(3);
    });

    it('handles zero delay between batches', async () => {
      const orphans = createOrphans(5);
      const worker = new AsyncCleanupWorker(mockStorage, { batchSize: 2, delayBetweenBatches: 0 });

      const metrics = await worker.processDeletions(orphans);

      expect(metrics.succeeded).toBe(5);
    });

    it('handles zero retries', async () => {
      const orphans = createOrphans(1);
      mockStorage.deletionErrors.set(100, new Error('Fail'));

      let callCount = 0;
      mockStorage.deleteOutput = async () => {
        callCount++;
        throw new Error('Fail');
      };

      const worker = new AsyncCleanupWorker(mockStorage, { maxRetries: 1 });

      const metrics = await worker.processDeletions(orphans);

      expect(callCount).toBe(1); // One attempt with maxRetries=1
      expect(metrics.failed).toBe(1);
    });
  });
});

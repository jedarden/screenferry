/**
 * Unit tests for storage manager and startup cleanup.
 *
 * Tests orphaned output detection and cleanup (bf-ho40).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getStorageManager, runStartupCleanup, configureStorageManager, resetStorageManager } from '../src/platform/storage.js';
import type { OutputArtefact, StorageManager } from '../src/platform/storage.js';

// Mock OPFS
class MockOPFSDirectory {
  files = new Map<string, { data: Uint8Array; metadata: OutputArtefact }>();
  subdirectories = new Map<string, MockOPFSDirectory>();
  name: string;

  constructor(name: string = 'root') {
    this.name = name;
  }

  async getFileHandle(name: string, options: { create?: boolean }) {
    if (!options?.create && !this.files.has(name)) {
      throw new Error('File not found');
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
    };
  }

  async getDirectoryHandle(name: string, options: { create?: boolean }) {
    if (!this.subdirectories.has(name)) {
      if (!options?.create) {
        throw new Error('Directory not found');
      }
      this.subdirectories.set(name, new MockOPFSDirectory(name));
    }
    return this.subdirectories.get(name)!;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (!this.files.has(name)) {
      throw new Error('File not found');
    }
    this.files.delete(name);
  }

  values() {
    const files = this.files;
    const fileKeys = [...files.keys()];
    let index = 0;

    return {
      async next() {
        if (index >= fileKeys.length) {
          return { done: true, value: undefined };
        }

        const name = fileKeys[index++];
        return {
          done: false,
          value: {
            kind: 'file' as const,
            name,
            getFile: async () => ({
              arrayBuffer: async () => files.get(name)!.data.buffer,
              text: async () => {
                if (name.endsWith('.meta.json')) {
                  return JSON.stringify(files.get(name)!.metadata);
                }
                return JSON.stringify(files.get(name)!.metadata);
              },
              size: files.get(name)!.data.length,
            }),
          },
        };
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  // Helper method to add test files directly to this directory
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
    return Math.floor(this.files.size / 2); // Each output has 2 files (data + metadata)
  }
}

const mockOPFS = new MockOPFSDirectory();

// Mock navigator.storage.getDirectory
const mockNavigator = {
  storage: {
    getDirectory: vi.fn(async () => mockOPFS),
    estimate: vi.fn(async () => ({ quota: 10_000_000_000, usage: 1_000_000_000 })),
  },
};

vi.stubGlobal('navigator', mockNavigator);

// Helper to get the output directory (where test files should be stored)
async function getOutputDirectory(): Promise<MockOPFSDirectory> {
  return await mockOPFS.getDirectoryHandle('screenferry-outputs', { create: true });
}

describe('StorageManager', () => {
  beforeEach(() => {
    resetStorageManager();
    // Clear mock OPFS
    mockOPFS.files.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getStorageManager()', () => {
    it('returns the same instance on subsequent calls', () => {
      const manager1 = getStorageManager();
      const manager2 = getStorageManager();
      expect(manager1).toBe(manager2);
    });

    it('creates a new instance after reset', () => {
      const manager1 = getStorageManager();
      resetStorageManager();
      const manager2 = getStorageManager();
      expect(manager1).not.toBe(manager2);
    });
  });

  describe('configureStorageManager()', () => {
    it('applies custom configuration', () => {
      configureStorageManager({
        outputDirectory: 'custom-outputs',
        maxOrphanAge: 60_000, // 1 minute
      });

      const manager = getStorageManager();
      expect(manager).toBeDefined();
    });

    it('throws error if called after getStorageManager()', () => {
      getStorageManager();
      expect(() => {
        configureStorageManager({ outputDirectory: 'custom' });
      }).toThrow('Storage manager already initialized');
    });
  });
});

describe('cleanupOrphanedOutputs()', () => {
  let testDir: MockOPFSDirectory;

  beforeEach(async () => {
    resetStorageManager();
    mockOPFS.files.clear();
    mockOPFS.subdirectories.clear();
    testDir = await getOutputDirectory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes outputs older than max age when not in active set', async () => {
    // Add test files: one old (25 hours), one recent (1 hour)
    testDir.addTestFile(100, 25 * 60 * 60 * 1000); // 25 hours old
    testDir.addTestFile(200, 1 * 60 * 60 * 1000);  // 1 hour old

    const storage = getStorageManager();
    const activeIds = new Set<number>(); // No active sessions

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(1);
    expect(testDir.countFiles()).toBe(1); // Only recent file remains
  });

  it('keeps outputs that are in active set regardless of age', async () => {
    // Add test files: both old but one is active
    testDir.addTestFile(100, 25 * 60 * 60 * 1000); // 25 hours old, inactive
    testDir.addTestFile(200, 25 * 60 * 60 * 1000); // 25 hours old, ACTIVE

    const storage = getStorageManager();
    const activeIds = new Set<number>([200]); // Stream 200 is active

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(1); // Only stream 100 cleaned up
    expect(testDir.countFiles()).toBe(1); // Stream 200 remains
  });

  it('keeps recent outputs even if not in active set', async () => {
    // Add test files: both recent, neither active
    testDir.addTestFile(100, 1 * 60 * 60 * 1000); // 1 hour old
    testDir.addTestFile(200, 2 * 60 * 60 * 1000); // 2 hours old

    const storage = getStorageManager();
    const activeIds = new Set<number>(); // No active sessions

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(0); // Nothing cleaned up
    expect(testDir.countFiles()).toBe(2); // Both remain
  });

  it('handles empty storage gracefully', async () => {
    const storage = getStorageManager();
    const activeIds = new Set<number>();

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(0);
    expect(testDir.countFiles()).toBe(0);
  });

  it('handles mixed ages correctly', async () => {
    // Add test files with various ages
    testDir.addTestFile(1, 30 * 60 * 1000);    // 30 min - keep
    testDir.addTestFile(2, 2 * 60 * 60 * 1000); // 2 hours - keep
    testDir.addTestFile(3, 25 * 60 * 60 * 1000); // 25 hours - clean
    testDir.addTestFile(4, 48 * 60 * 60 * 1000); // 48 hours - clean
    testDir.addTestFile(5, 1 * 60 * 60 * 1000);  // 1 hour - keep

    const storage = getStorageManager();
    const activeIds = new Set<number>();

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(2); // Streams 3 and 4 cleaned
    expect(testDir.countFiles()).toBe(3); // Streams 1, 2, 5 remain
  });

  it('handles deletion errors gracefully', async () => {
    // Add a test file
    testDir.addTestFile(100, 25 * 60 * 60 * 1000);

    // Mock removeEntry to fail
    const originalRemoveEntry = testDir.removeEntry.bind(testDir);
    testDir.removeEntry = vi.fn(async (name: string, options?: { recursive?: boolean }) => {
      if (name.startsWith('output-100')) {
        throw new Error('Simulated deletion failure');
      }
      return originalRemoveEntry(name, options);
    });

    const storage = getStorageManager();
    const activeIds = new Set<number>();

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    // Should return 0 even though deletion failed (error is logged but not thrown)
    expect(cleaned).toBe(0);
  });

  it('respects custom maxOrphanAge configuration', async () => {
    // Configure with very short max age (5 minutes)
    resetStorageManager();
    configureStorageManager({
      outputDirectory: 'screenferry-outputs',
      maxOrphanAge: 5 * 60 * 1000, // 5 minutes
    });

    // Add test files: 10 minutes old (should be cleaned)
    testDir.addTestFile(100, 10 * 60 * 1000);

    const storage = getStorageManager();
    const activeIds = new Set<number>();

    const cleaned = await storage.cleanupOrphanedOutputs(activeIds);

    expect(cleaned).toBe(1); // Cleaned up due to short max age
  });
});

describe('runStartupCleanup()', () => {
  let testDir: MockOPFSDirectory;

  beforeEach(async () => {
    resetStorageManager();
    mockOPFS.files.clear();
    mockOPFS.subdirectories.clear();
    testDir = await getOutputDirectory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns cleanup count on success', async () => {
    testDir.addTestFile(100, 25 * 60 * 60 * 1000);

    const result = await runStartupCleanup(new Set());

    expect(result.cleaned).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('returns zero when no orphaned files found', async () => {
    const result = await runStartupCleanup(new Set());

    expect(result.cleaned).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('handles errors gracefully', async () => {
    // Test error handling by simulating a failure in cleanupOrphanedOutputs
    const storage = getStorageManager();

    // Spy on cleanupOrphanedOutputs and make it throw
    const cleanupSpy = vi.spyOn(storage, 'cleanupOrphanedOutputs').mockRejectedValue(
      new Error('Storage manager error')
    );

    const result = await runStartupCleanup(new Set());

    expect(result.cleaned).toBe(0);
    expect(result.error).toBeDefined();

    cleanupSpy.mockRestore();
  });

  it('uses empty active set by default', async () => {
    testDir.addTestFile(100, 25 * 60 * 60 * 1000);

    const result = await runStartupCleanup(); // No active set provided

    expect(result.cleaned).toBe(1);
  });

  it('accepts custom active set', async () => {
    testDir.addTestFile(100, 25 * 60 * 60 * 1000);
    testDir.addTestFile(200, 25 * 60 * 60 * 1000);

    const activeIds = new Set<number>([200]); // Stream 200 is active
    const result = await runStartupCleanup(activeIds);

    expect(result.cleaned).toBe(1); // Only stream 100 cleaned
  });
});

describe('OutputArtefact lifecycle', () => {
  beforeEach(() => {
    resetStorageManager();
    mockOPFS.files.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves output data', async () => {
    const storage = getStorageManager();
    const testData = new Uint8Array([1, 2, 3, 4, 5]);

    await storage.storeOutput(123, testData, 'test.bin', 'application/octet-stream');

    const retrieved = await storage.getOutput(123);
    expect(retrieved).toEqual(testData);
  });

  it('stores and retrieves metadata', async () => {
    const storage = getStorageManager();
    const testData = new Uint8Array([1, 2, 3, 4]);

    await storage.storeOutput(456, testData, 'metadata-test.bin', 'text/plain');

    const metadata = await storage.getOutputMetadata(456);
    expect(metadata).toEqual({
      streamId: 456,
      filename: 'metadata-test.bin',
      mimeType: 'text/plain',
      size: 4,
      createdAt: expect.any(Number),
      path: expect.any(String),
    });
  });

  it('lists all outputs', async () => {
    const storage = getStorageManager();

    await storage.storeOutput(1, new Uint8Array([1]), 'file1.bin', 'application/octet-stream');
    await storage.storeOutput(2, new Uint8Array([2]), 'file2.bin', 'application/octet-stream');

    const outputs = await storage.listOutputs();
    expect(outputs).toHaveLength(2);
    expect(outputs.map(o => o.streamId)).toContain(1);
    expect(outputs.map(o => o.streamId)).toContain(2);
  });

  it('deletes output by streamId', async () => {
    const storage = getStorageManager();

    await storage.storeOutput(789, new Uint8Array([1, 2, 3]), 'delete-test.bin', 'application/octet-stream');

    let retrieved = await storage.getOutput(789);
    expect(retrieved).not.toBeNull();

    await storage.deleteOutput(789);

    retrieved = await storage.getOutput(789);
    expect(retrieved).toBeNull();
  });

  it('returns null for non-existent output', async () => {
    const storage = getStorageManager();

    const retrieved = await storage.getOutput(999);
    expect(retrieved).toBeNull();
  });

  it('handles deletion of non-existent file gracefully', async () => {
    const storage = getStorageManager();

    // Should not throw even if file doesn't exist
    await expect(storage.deleteOutput(999)).resolves.toBeUndefined();
  });
});

/**
 * Unit tests for storage manager and startup cleanup.
 *
 * Tests orphaned output detection and cleanup (bf-ho40).
 * Tests orphan detection criteria and data structures (bf-5bh3).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getStorageManager,
  runStartupCleanup,
  configureStorageManager,
  resetStorageManager,
  detectOrphanedOutput,
  detectOrphanedOutputs,
  createFileSessionRelationship,
  detectOrphanedWithRelationship,
  type OrphanDetectionCriteria,
  type OutputArtefact,
  type StorageManager,
  type FileSessionRelationship,
} from '../src/platform/storage.js';

// Mock OPFS
class MockOPFSDirectory {
  files = new Map<string, { data: Uint8Array; metadata: OutputArtefact }>();
  subdirectories = new Map<string, MockOPFSDirectory>();
  name: string;
  kind: 'directory' = 'directory';

  constructor(name: string = 'root') {
    this.name = name;
  }

  async getFileHandle(name: string, options: { create?: boolean }) {
    if (!options?.create && !this.files.has(name)) {
      throw new Error('File not found');
    }

    // Create or get the file entry
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
        // Mock sync access handle for positional write factory
        let fileData = this.files.get(name)!.data;
        let position = 0;

        return {
          write: (buffer: Uint8Array, opts?: { at?: number }) => {
            const offset = opts?.at || position;
            if (offset + buffer.length > fileData.length) {
              // Extend fileData if needed
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
            // Save the final data back to the files map
            this.files.set(name, { ...this.files.get(name)!, data: fileData });
          },
          flush: () => {
            // Save current data
            this.files.set(name, { ...this.files.get(name)!, data: fileData });
          },
          getSize: () => fileData.length,
        };
      },
    };
  }

  async getDirectoryHandle(name: string, options: { create?: boolean }): Promise<MockOPFSDirectory> {
    if (!this.subdirectories.has(name)) {
      if (!options?.create) {
        throw new Error('Directory not found');
      }
      const newDir = new MockOPFSDirectory(name);
      this.subdirectories.set(name, newDir);
    }
    // Return the actual directory instance
    return this.subdirectories.get(name)! as MockOPFSDirectory;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (!this.files.has(name)) {
      throw new Error('File not found');
    }
    this.files.delete(name);
  }

  async *[Symbol.asyncIterator]() {
    console.log('[DEBUG] Symbol.asyncIterator called on directory:', this.name, 'with', this.files.size, 'files');
    for (const [name, fileData] of this.files) {
      console.log('[DEBUG] yielding file:', name);
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
  }

  values() {
    console.log('[DEBUG] values() called on directory:', this.name, 'with', this.files.size, 'files');
    // Return an async iterable object
    const files = this.files;
    const asyncIterator = (async function* () {
      for (const [name, fileData] of files.entries()) {
        console.log('[DEBUG] values() iterator yielding:', name);
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
      console.log('[DEBUG] values() iterator complete, yielded', files.size, 'files');
    })();

    // Ensure it has the async iterator symbol
    if (typeof asyncIterator[Symbol.asyncIterator] === 'function') {
      return asyncIterator;
    }

    // Fallback: wrap it in an object with the symbol
    return {
      [Symbol.asyncIterator]: () => asyncIterator,
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

  // Helper method to simulate storing an output (for use by storeOutput)
  async storeOutputFile(streamId: number, data: Uint8Array, filename: string, mimeType: string) {
    const filePath = `output-${streamId}.bin`;
    const metadataPath = `output-${streamId}.meta.json`;

    const metadata: OutputArtefact = {
      streamId,
      filename,
      mimeType,
      size: data.length,
      createdAt: Date.now(),
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
  return await mockOPFS.getDirectoryHandle('screenferry-outputs', { create: true }) as MockOPFSDirectory;
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

    console.log('[DEBUG] testDir.files.size:', testDir.files.size);
    console.log('[DEBUG] testDir files:', Array.from(testDir.files.keys()));

    const storage = getStorageManager();
    const activeIds = new Set<number>(); // No active sessions

    // Check what listOutputs sees
    const outputs = await storage.listOutputs();
    console.log('[DEBUG] listOutputs found:', outputs.length, 'outputs');

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

// ==============================================================================
// ORPHAN DETECTION CRITERIA AND DATA STRUCTURES TESTS
// ==============================================================================

describe('detectOrphanedOutput()', () => {
  const baseOutput: OutputArtefact = {
    streamId: 123,
    filename: 'test.dat',
    mimeType: 'application/octet-stream',
    size: 1024,
    createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours old
    path: 'output-123.bin',
  };

  it('identifies orphaned file when inactive and old', () => {
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours
      activeStreamIds: new Set(), // No active sessions
    };

    const result = detectOrphanedOutput(baseOutput, criteria);

    expect(result.isOrphan).toBe(true);
    expect(result.hasActiveSession).toBe(false);
    expect(result.exceedsAgeThreshold).toBe(true);
    expect(result.reason).toContain('no active session reference');
    expect(result.reason).toContain('exceeds age threshold');
  });

  it('protects file with active session reference', () => {
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set([123]), // Stream 123 is active
    };

    const result = detectOrphanedOutput(baseOutput, criteria);

    expect(result.isOrphan).toBe(false);
    expect(result.hasActiveSession).toBe(true);
    expect(result.reason).toContain('has active session reference');
  });

  it('protects recent file regardless of session status', () => {
    const recentOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: Date.now() - (1 * 60 * 60 * 1000), // 1 hour old
    };

    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(), // No active sessions
    };

    const result = detectOrphanedOutput(recentOutput, criteria);

    expect(result.isOrphan).toBe(false);
    expect(result.exceedsAgeThreshold).toBe(false);
    expect(result.reason).toContain('within age threshold');
  });

  it('calculates age correctly', () => {
    const fixedTime = Date.now();
    const testOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: fixedTime - (12 * 60 * 60 * 1000), // 12 hours old
    };

    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
      currentTime: fixedTime,
    };

    const result = detectOrphanedOutput(testOutput, criteria);

    expect(result.ageMs).toBe(12 * 60 * 60 * 1000);
    expect(Math.round(result.ageMs / 1000 / 60)).toBe(720); // 720 minutes
  });

  it('requires BOTH conditions for orphan status', () => {
    // Test case 1: Old but has active session (not orphaned)
    const criteria1: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set([123]),
    };
    const result1 = detectOrphanedOutput(baseOutput, criteria1);
    expect(result1.isOrphan).toBe(false);

    // Test case 2: Young but no active session (not orphaned)
    const recentOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: Date.now() - (1 * 60 * 60 * 1000),
    };
    const criteria2: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };
    const result2 = detectOrphanedOutput(recentOutput, criteria2);
    expect(result2.isOrphan).toBe(false);

    // Test case 3: Old AND no active session (orphaned)
    const criteria3: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };
    const result3 = detectOrphanedOutput(baseOutput, criteria3);
    expect(result3.isOrphan).toBe(true);
  });
});

describe('detectOrphanedOutputs()', () => {
  it('filters outputs into orphaned and retained', () => {
    const outputs: OutputArtefact[] = [
      {
        streamId: 1,
        filename: 'orphan1.dat',
        mimeType: 'application/octet-stream',
        size: 100,
        createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours old
        path: 'output-1.bin',
      },
      {
        streamId: 2,
        filename: 'active.dat',
        mimeType: 'application/octet-stream',
        size: 200,
        createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours old
        path: 'output-2.bin',
      },
      {
        streamId: 3,
        filename: 'recent.dat',
        mimeType: 'application/octet-stream',
        size: 300,
        createdAt: Date.now() - (1 * 60 * 60 * 1000), // 1 hour old
        path: 'output-3.bin',
      },
    ];

    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set([2]), // Stream 2 is active
    };

    const result = detectOrphanedOutputs(outputs, criteria);

    expect(result.orphaned).toHaveLength(1);
    expect(result.orphaned[0].output.streamId).toBe(1);
    expect(result.retained).toHaveLength(2);
    expect(result.retained.map(r => r.output.streamId)).toContain(2);
    expect(result.retained.map(r => r.output.streamId)).toContain(3);
  });

  it('handles empty output list', () => {
    const result = detectOrphanedOutputs([], {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    });

    expect(result.orphaned).toHaveLength(0);
    expect(result.retained).toHaveLength(0);
  });

  it('handles all orphaned case', () => {
    const outputs: OutputArtefact[] = [
      {
        streamId: 1,
        filename: 'old1.dat',
        mimeType: 'application/octet-stream',
        size: 100,
        createdAt: Date.now() - (25 * 60 * 60 * 1000),
        path: 'output-1.bin',
      },
      {
        streamId: 2,
        filename: 'old2.dat',
        mimeType: 'application/octet-stream',
        size: 200,
        createdAt: Date.now() - (30 * 60 * 60 * 1000),
        path: 'output-2.bin',
      },
    ];

    const result = detectOrphanedOutputs(outputs, {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    });

    expect(result.orphaned).toHaveLength(2);
    expect(result.retained).toHaveLength(0);
  });
});

describe('createFileSessionRelationship()', () => {
  it('creates relationship with in-progress status', () => {
    const output: OutputArtefact = {
      streamId: 123,
      filename: 'test.dat',
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now(),
      path: 'output-123.bin',
    };

    const relationship = createFileSessionRelationship(output, true, 'active');

    expect(relationship.isInProgress).toBe(true);
    expect(relationship.sessionState).toBe('active');
    expect(relationship.streamId).toBe(123);
  });

  it('creates relationship with paused session', () => {
    const output: OutputArtefact = {
      streamId: 456,
      filename: 'paused.dat',
      mimeType: 'application/octet-stream',
      size: 2048,
      createdAt: Date.now(),
      path: 'output-456.bin',
    };

    const relationship = createFileSessionRelationship(output, false, 'paused');

    expect(relationship.isInProgress).toBe(false);
    expect(relationship.sessionState).toBe('paused');
  });

  it('defaults to unknown session state', () => {
    const output: OutputArtefact = {
      streamId: 789,
      filename: 'unknown.dat',
      mimeType: 'application/octet-stream',
      size: 512,
      createdAt: Date.now(),
      path: 'output-789.bin',
    };

    const relationship = createFileSessionRelationship(output);

    expect(relationship.sessionState).toBeUndefined();
    expect(relationship.isInProgress).toBe(false);
  });
});

describe('detectOrphanedWithRelationship()', () => {
  const baseOutput: OutputArtefact = {
    streamId: 123,
    filename: 'test.dat',
    mimeType: 'application/octet-stream',
    size: 1024,
    createdAt: Date.now() - (25 * 60 * 60 * 1000), // 25 hours old
    path: 'output-123.bin',
  };

  it('protects in-progress files regardless of age', () => {
    const relationship = createFileSessionRelationship(baseOutput, true, 'active');
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(), // Even without active session ID
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    expect(result.isOrphan).toBe(false);
    expect(result.reason).toContain('in-progress (protected)');
  });

  it('protects paused sessions with extended threshold', () => {
    const relationship = createFileSessionRelationship(
      baseOutput,
      false,
      'paused'
    );
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours
      activeStreamIds: new Set(), // No active session ID
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    expect(result.isOrphan).toBe(false);
    expect(result.reason).toContain('paused (protected)');
    expect(result.hasActiveSession).toBe(true); // Paused treated as active
  });

  it('cleans up very old paused sessions', () => {
    const veryOldOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: Date.now() - (100 * 60 * 60 * 1000), // 100 hours old (> 3x threshold)
    };
    const relationship = createFileSessionRelationship(
      veryOldOutput,
      false,
      'paused'
    );
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours (paused threshold = 72 hours)
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    expect(result.isOrphan).toBe(true);
    expect(result.reason).toContain('paused');
    expect(result.reason).toContain('exceeds');
    expect(result.hasActiveSession).toBe(false);
  });

  it('protects recently completed files', () => {
    const recentOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: Date.now() - (2 * 60 * 60 * 1000), // 2 hours old (< 0.5x threshold)
    };
    const relationship = createFileSessionRelationship(
      recentOutput,
      false,
      'complete'
    );
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000, // 24 hours (recent threshold = 12 hours)
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    expect(result.isOrphan).toBe(false);
    expect(result.reason).toContain('recently completed');
    expect(result.hasActiveSession).toBe(true);
  });

  it('protects old completed files within age threshold', () => {
    const oldCompletedOutput: OutputArtefact = {
      ...baseOutput,
      createdAt: Date.now() - (20 * 60 * 60 * 1000), // 20 hours old (> 0.5x threshold but < 1x)
    };
    const relationship = createFileSessionRelationship(
      oldCompletedOutput,
      false,
      'complete'
    );
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    expect(result.isOrphan).toBe(false); // Still protected by completion status
    expect(result.reason).toContain('completed');
    expect(result.hasActiveSession).toBe(true);
  });

  it('falls back to base detection for unknown session state', () => {
    const relationship = createFileSessionRelationship(
      baseOutput,
      false,
      'unknown'
    );
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedWithRelationship(relationship, criteria);

    // Should use base detection (orphaned because old and no active session)
    expect(result.isOrphan).toBe(true);
    expect(result.reason).not.toContain('protected');
  });
});

describe('Edge case handling', () => {
  it('handles files exactly at age threshold', () => {
    const exactAgeOutput: OutputArtefact = {
      streamId: 123,
      filename: 'exact.dat',
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now() - (24 * 60 * 60 * 1000), // Exactly 24 hours
      path: 'output-123.bin',
    };
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedOutput(exactAgeOutput, criteria);

    // Exactly at threshold should not be orphaned (only older than threshold)
    expect(result.isOrphan).toBe(false);
    expect(result.exceedsAgeThreshold).toBe(false);
  });

  it('handles files one millisecond over threshold', () => {
    const overThresholdOutput: OutputArtefact = {
      streamId: 123,
      filename: 'over.dat',
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now() - (24 * 60 * 60 * 1000) - 1, // 24 hours + 1ms
      path: 'output-123.bin',
    };
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedOutput(overThresholdOutput, criteria);

    // Even 1ms over threshold should be orphaned
    expect(result.isOrphan).toBe(true);
    expect(result.exceedsAgeThreshold).toBe(true);
  });

  it('handles zero-size files (metadata only)', () => {
    const zeroSizeOutput: OutputArtefact = {
      streamId: 123,
      filename: 'empty.dat',
      mimeType: 'application/octet-stream',
      size: 0,
      createdAt: Date.now() - (25 * 60 * 60 * 1000),
      path: 'output-123.bin',
    };
    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set(),
    };

    const result = detectOrphanedOutput(zeroSizeOutput, criteria);

    // Zero-size files still follow orphan detection rules
    expect(result.isOrphan).toBe(true);
  });

  it('handles concurrent active sessions', () => {
    const output1: OutputArtefact = {
      streamId: 1,
      filename: 'file1.dat',
      mimeType: 'application/octet-stream',
      size: 1024,
      createdAt: Date.now() - (25 * 60 * 60 * 1000),
      path: 'output-1.bin',
    };
    const output2: OutputArtefact = {
      streamId: 2,
      filename: 'file2.dat',
      mimeType: 'application/octet-stream',
      size: 2048,
      createdAt: Date.now() - (25 * 60 * 60 * 1000),
      path: 'output-2.bin',
    };
    const output3: OutputArtefact = {
      streamId: 3,
      filename: 'file3.dat',
      mimeType: 'application/octet-stream',
      size: 3072,
      createdAt: Date.now() - (25 * 60 * 60 * 1000),
      path: 'output-3.bin',
    };

    const criteria: OrphanDetectionCriteria = {
      maxOrphanAge: 24 * 60 * 60 * 1000,
      activeStreamIds: new Set([1, 3]), // Streams 1 and 3 are active
    };

    const result1 = detectOrphanedOutput(output1, criteria);
    const result2 = detectOrphanedOutput(output2, criteria);
    const result3 = detectOrphanedOutput(output3, criteria);

    expect(result1.isOrphan).toBe(false); // Protected by active session
    expect(result2.isOrphan).toBe(true);  // No active session
    expect(result3.isOrphan).toBe(false); // Protected by active session
  });
});

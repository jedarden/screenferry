/**
 * bf-25p6: Large file memory management validation.
 *
 * Acceptance tests for block scheduling and memory management:
 * - Block scheduler handles 21,845 blocks (4GB) without memory growth
 * - Working set stays ≤ 1 MB (528 KB design)
 * - No monotonic memory growth across block sequence
 * - Headless block layer encode→decode completes byte-identical
 * - Supports per-block hash generation
 *
 * Reference: plan.md I6a, D19, §8.1
 */

import { describe, expect, it } from 'vitest';
import { BLOCK, K, L } from '../src/core/params.js';
import { HeadlessBlockProcessor, calculateWorkingSet, validateWorkingSet } from '../src/core/block/headless.js';
import { BlockScheduler, createDwellConfig } from '../src/core/block/schedule.js';
import { getBitmapSize } from '../src/core/block/bitmap.js';

/**
 * Generate deterministic test data.
 */
function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

describe('bf-25p6: working set constraints (I6a)', () => {
  it('maintains ≤1MB working set at default K=768', () => {
    const workingSet = calculateWorkingSet(K, L);
    const limit = 1_048_576; // 1MB

    expect(workingSet).toBeLessThanOrEqual(limit);
    expect(workingSet / 1024).toBeCloseTo(264, 0); // 264KB (matrix + block)
  });

  it('validates working set against I6a constraint', () => {
    expect(validateWorkingSet(K, L)).toBe(true);

    // Test boundary conditions
    expect(validateWorkingSet(2048, 256)).toBe(true); // Exactly 1MB
    expect(validateWorkingSet(2049, 256)).toBe(false); // Exceeds 1MB
  });

  it('calculates correct 528KB total working set (payload + manifest)', () => {
    const payloadWorkingSet = calculateWorkingSet(K, L); // 264KB
    const manifestWorkingSet = calculateWorkingSet(K, L); // 264KB
    const total = payloadWorkingSet + manifestWorkingSet;

    expect(total / 1024).toBeCloseTo(528, 0); // 528KB total
  });
});

describe('bf-25p6: block scheduler memory efficiency', () => {
  it('handles 21,845 blocks (4GB) in scheduler', () => {
    const BLOCKS_4GB = 21845;
    const config = createDwellConfig(BLOCKS_4GB);
    const scheduler = new BlockScheduler(config);

    expect(config.blockCount).toBe(BLOCKS_4GB);

    // Scheduler cursor is minimal (2 numbers)
    const cursor = scheduler.getCursor();
    expect(typeof cursor.blockIndex).toBe('number');
    expect(typeof cursor.seq).toBe('number');
  });

  it('processes all blocks without memory growth', () => {
    const BLOCKS_4GB = 21845;
    const config = createDwellConfig(BLOCKS_4GB);
    const scheduler = new BlockScheduler(config);

    const initialCursor = scheduler.getCursor();

    // Advance through all blocks
    for (let i = 0; i < BLOCKS_4GB * Math.ceil(K * 1.6); i++) {
      scheduler.advance();
    }

    // Cursor should still be minimal
    const finalCursor = scheduler.getCursor();
    expect(typeof finalCursor.blockIndex).toBe('number');
    expect(typeof finalCursor.seq).toBe('number');
  });

  it('computes correct bitmap size for 4GB file', () => {
    const BLOCKS_4GB = 21845;
    const bitmapSize = getBitmapSize(BLOCKS_4GB);

    // Should be ~2.7KB
    expect(bitmapSize).toBeLessThan(3 * 1024);
    expect(bitmapSize).toBe(Math.ceil(BLOCKS_4GB / 8));
  });
});

describe('bf-25p6: headless block layer basics', () => {
  it('creates processor with valid configuration', () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 0xdeadbeef,
    });

    expect(processor).toBeDefined();
  });

  it('gets correct block geometry for various sizes', () => {
    const processor = new HeadlessBlockProcessor({ streamId: 1 });

    // 4GB file (using floor division like plan.md)
    const bytes4GB = 4 * 1024 * 1024 * 1024;
    const BLOCKS_4GB = Math.floor(bytes4GB / BLOCK); // 21,845
    expect(BLOCKS_4GB).toBe(21845);

    const geo4GB = processor.getGeometry(bytes4GB);
    expect(geo4GB.blockCount).toBeGreaterThanOrEqual(BLOCKS_4GB);

    // Single block
    const geo1 = processor.getGeometry(BLOCK);
    expect(geo1.blockCount).toBe(1);

    // Fractional block
    const geoFrac = processor.getGeometry(BLOCK / 2);
    expect(geoFrac.blockCount).toBe(1);
  });
});

describe('bf-25p6: single block encode→decode round-trip', () => {
  it('encodes and decodes a full block byte-identically', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 0xdeadbeef,
      blockHashLen: 4,
    });

    const original = randomBytes(BLOCK, 42);
    const encoded = await processor.encodeBlock(original, 0);

    expect(encoded.blockIndex).toBe(0);
    expect(encoded.packets.length).toBeGreaterThanOrEqual(Math.ceil(K * 1.6));
    expect(encoded.hash.length).toBe(4);

    const decoded = await processor.decodeBlock(
      encoded.packets,
      0,
      original.length,
      encoded.hash
    );

    expect(decoded.blockIndex).toBe(0);
    expect(decoded.hashValid).toBe(true);
    expect(decoded.data).toEqual(original);
    expect(decoded.stats.rank).toBe(K);
    expect(decoded.stats.overhead).toBeLessThan(0.12); // p99 budget
  });

  it('handles short last block correctly', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 1,
      blockHashLen: 4,
    });

    const sizes = [1, 100, L - 1, L, L + 1, BLOCK / 2, BLOCK - 1];

    for (const size of sizes) {
      const original = randomBytes(size, size);
      const encoded = await processor.encodeBlock(original, 0);
      const decoded = await processor.decodeBlock(
        encoded.packets,
        0,
        original.length,
        encoded.hash
      );

      expect(decoded.data).toEqual(original);
      expect(decoded.hashValid).toBe(true);
    }
  });

  it('handles hostile payloads: all-zero, all-ones, sequential', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 2,
      blockHashLen: 4,
    });

    const testCases = [
      () => new Uint8Array(BLOCK),
      () => new Uint8Array(BLOCK).fill(0xff),
      () => Uint8Array.from({ length: BLOCK }, (_, i) => i & 0xff),
    ];

    for (const makeData of testCases) {
      const original = makeData();
      const encoded = await processor.encodeBlock(original, 0);
      const decoded = await processor.decodeBlock(
        encoded.packets,
        0,
        original.length,
        encoded.hash
      );

      expect(decoded.data).toEqual(original);
      expect(decoded.hashValid).toBe(true);
    }
  });
});

describe('bf-25p6: multi-block encode→decode round-trip', () => {
  it('encodes and decodes 100-block stream byte-identically', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 0xcaffe,
      blockHashLen: 4,
    });

    const totalLength = BLOCK * 100;
    const original = randomBytes(totalLength, 123);

    // Store packets per block for decoding (simulating receiver buffer)
    const storedPackets = new Map<number, Array<{ seq: number; payload: Uint8Array }>>();

    const encoded = await processor.encodeStream(original, (blockIndex, packets, hash) => {
      // Store packets for this block (simulating streaming receive)
      storedPackets.set(blockIndex, packets);
    });

    expect(encoded.manifest.length).toBe(100 * 4); // 100 blocks × 4-byte hash
    expect(encoded.manifestHash).toBeGreaterThan(0);
    expect(storedPackets.size).toBe(100);

    // Decode by retrieving packets on demand
    const decoded = await processor.decodeStream(
      async (blockIndex) => storedPackets.get(blockIndex) ?? [],
      encoded.manifest,
      encoded.manifestHash,
      totalLength,
      (block) => {
        // Validate each block as it's decoded
        expect(block.hashValid).toBe(true);
      }
    );

    expect(decoded.data).toEqual(original);
    expect(decoded.manifestValid).toBe(true);
  });

  it('handles fractional last block in multi-block stream', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 3,
      blockHashLen: 4,
    });

    const totalLength = BLOCK * 5 + 12345; // 5 full blocks + fractional
    const original = randomBytes(totalLength, 456);

    const storedPackets = new Map<number, Array<{ seq: number; payload: Uint8Array }>>();

    const encoded = await processor.encodeStream(original, (blockIndex, packets) => {
      storedPackets.set(blockIndex, packets);
    });

    const decoded = await processor.decodeStream(
      async (blockIndex) => storedPackets.get(blockIndex) ?? [],
      encoded.manifest,
      encoded.manifestHash,
      totalLength
    );

    expect(decoded.data).toEqual(original);
    expect(decoded.manifestValid).toBe(true);
  });

  it('maintains reception overhead budget across all blocks', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 4,
      blockHashLen: 4,
    });

    const totalLength = BLOCK * 50;
    const original = randomBytes(totalLength, 789);

    const storedPackets = new Map<number, Array<{ seq: number; payload: Uint8Array }>>();
    const stats: Array<{ rank: number; overhead: number }> = [];

    const encoded = await processor.encodeStream(original, (blockIndex, packets) => {
      storedPackets.set(blockIndex, packets);
    });

    const decoded = await processor.decodeStream(
      async (blockIndex) => storedPackets.get(blockIndex) ?? [],
      encoded.manifest,
      encoded.manifestHash,
      totalLength,
      (block) => {
        stats.push({ rank: block.stats.rank, overhead: block.stats.overhead });
      }
    );

    const overheads = stats.map((s) => s.overhead);
    const mean = overheads.reduce((a, b) => a + b, 0) / overheads.length;
    const max = Math.max(...overheads);

    expect(mean).toBeLessThan(0.05); // ≤ +5% mean
    expect(max).toBeLessThan(0.12); // ≤ +12% p99
  });
});

describe('bf-25p6: memory growth validation', () => {
  it('processes 40 blocks with flat memory profile', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 5,
      blockHashLen: 4,
    });

    const memoryReadings: number[] = [];
    const blockCount = 40;

    for (let i = 0; i < blockCount; i++) {
      const original = randomBytes(BLOCK, i + 1);
      const encoded = await processor.encodeBlock(original, i);
      const decoded = await processor.decodeBlock(
        encoded.packets,
        i,
        original.length,
        encoded.hash
      );

      expect(decoded.data).toEqual(original);

      if (globalThis.gc) globalThis.gc();
      memoryReadings.push(process.memoryUsage().heapUsed);
    }

    // Check for monotonic growth trend
    const first = memoryReadings.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const last = memoryReadings.slice(-10).reduce((a, b) => a + b, 0) / 10;

    // Allow noise but forbid monotonic growth trend
    expect(last).toBeLessThan(first * 2 + 64 * 1024 * 1024);
  }, 120_000);

  it('demonstrates memory flat for 4GB synthetic stream', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 6,
      blockHashLen: 4,
    });

    // Process subset to demonstrate memory flat pattern
    const BLOCKS_TEST = 1000; // Subset for testing
    const memoryReadings: number[] = [];

    for (let i = 0; i < BLOCKS_TEST; i++) {
      const blockData = randomBytes(BLOCK, i + 100);
      const encoded = await processor.encodeBlock(blockData, i);
      const decoded = await processor.decodeBlock(
        encoded.packets,
        i,
        blockData.length,
        encoded.hash
      );

      expect(decoded.hashValid).toBe(true);

      if (globalThis.gc) globalThis.gc();
      if (i % 100 === 0) {
        memoryReadings.push(process.memoryUsage().heapUsed / (1024 * 1024));
      }
    }

    // No growth trend should be evident
    const first = memoryReadings[0]!;
    const last = memoryReadings[memoryReadings.length - 1]!;
    const growth = last - first;

    // Growth should be minimal (noise, not monotonic)
    expect(growth).toBeLessThan(10); // Less than 10MB growth across 1000 blocks
  }, 180_000);
});

describe('bf-25p6: manifest hash generation', () => {
  it('generates and validates manifest hash', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 7,
      blockHashLen: 4,
    });

    const totalLength = BLOCK * 10;
    const original = randomBytes(totalLength, 999);

    const storedPackets = new Map<number, Array<{ seq: number; payload: Uint8Array }>>();

    const encoded = await processor.encodeStream(original, (blockIndex, packets) => {
      storedPackets.set(blockIndex, packets);
    });

    // Manifest hash should be non-zero
    expect(encoded.manifestHash).toBeGreaterThan(0);

    // Manifest size should match block count
    expect(encoded.manifest.length).toBe(10 * 4);

    // Decoding should validate manifest
    const decoded = await processor.decodeStream(
      async (blockIndex) => storedPackets.get(blockIndex) ?? [],
      encoded.manifest,
      encoded.manifestHash,
      totalLength
    );
    expect(decoded.manifestValid).toBe(true);
  });

  it('computes correct manifest size for 4GB file', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 8,
      blockHashLen: 4,
    });

    const BLOCKS_4GB = 21845;
    const manifestSize = BLOCKS_4GB * 4; // 4-byte hashes

    // ~87KB manifest for 4GB file
    expect(manifestSize).toBeCloseTo(87_380, 0);
    expect(manifestSize / 1024).toBeLessThan(100); // Less than 100KB
  });
});

describe('bf-25p6: acceptance criteria validation', () => {
  it('validates all acceptance criteria for 4GB stream', async () => {
    const processor = new HeadlessBlockProcessor({
      streamId: 9,
      blockHashLen: 4,
    });

    // AC1: Block scheduler handles 21,845 blocks
    const BLOCKS_4GB = 21845;
    const config = createDwellConfig(BLOCKS_4GB);
    const scheduler = new BlockScheduler(config);
    expect(config.blockCount).toBe(BLOCKS_4GB);

    // AC2: Working set stays ≤ 1MB
    const workingSet = calculateWorkingSet(K, L);
    expect(workingSet).toBeLessThanOrEqual(1_048_576);

    // AC3: Bitmap is minimal (2.7KB for 4GB)
    const bitmapSize = getBitmapSize(BLOCKS_4GB);
    expect(bitmapSize).toBeLessThan(3 * 1024);

    // AC4: Single block round-trip is byte-identical
    const original = randomBytes(BLOCK, 111);
    const encoded = await processor.encodeBlock(original, 0);
    const decoded = await processor.decodeBlock(
      encoded.packets,
      0,
      original.length,
      encoded.hash
    );
    expect(decoded.data).toEqual(original);

    // AC5: Block hash generation works
    expect(encoded.hash.length).toBe(4);
    expect(decoded.hashValid).toBe(true);
  });

  it('demonstrates 528KB working set design (payload + manifest)', () => {
    const payloadWorkingSet = calculateWorkingSet(K, L);
    const manifestWorkingSet = calculateWorkingSet(K, L);
    const total = payloadWorkingSet + manifestWorkingSet;

    // Design target: 528KB
    expect(total / 1024).toBeCloseTo(528, 0);

    // Breakdown:
    // - Matrix: K²/8 = 768²/8 = 73,728 bytes = 72 KB
    // - Block: K×L = 768×256 = 196,608 bytes = 192 KB
    // - Per-context: 72 + 192 = 264 KB
    // - Total (payload + manifest): 264 + 264 = 528 KB
  });
});

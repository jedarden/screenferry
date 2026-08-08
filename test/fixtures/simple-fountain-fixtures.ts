/**
 * Test fixtures for "simple encoded sequences" for fountain code testing.
 *
 * These fixtures provide minimal, traceable test cases for:
 * - Repetition mode (K < 8)
 * - Small LT code mode (8 ≤ K ≤ 16)
 * - Complete decode cycles
 * - Edge cases
 *
 * Each fixture includes:
 * - Input fragments
 * - Encoder configuration
 * - Expected outputs for specific sequence numbers
 * - Decoder validation
 */

import { LTEncoder } from '../src/core/fountain/encoder.js';
import { GEDecoder } from '../src/core/fountain/decoder.js';

/**
 * Minimal repetition mode test: K=4, L=4
 */
export const REPETITION_K4_L4 = {
  name: 'repetition-k4-l4',
  config: {
    streamId: 1,
    blockIndex: 0,
    fragments: [
      new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      new Uint8Array([0x10, 0x11, 0x12, 0x13]),
      new Uint8Array([0x20, 0x21, 0x22, 0x23]),
      new Uint8Array([0x30, 0x31, 0x32, 0x33]),
    ],
  },
  expectedEncodings: [
    { seq: 0, payload: new Uint8Array([0x00, 0x01, 0x02, 0x03]) }, // fragments[0]
    { seq: 1, payload: new Uint8Array([0x10, 0x11, 0x12, 0x13]) }, // fragments[1]
    { seq: 2, payload: new Uint8Array([0x20, 0x21, 0x22, 0x23]) }, // fragments[2]
    { seq: 3, payload: new Uint8Array([0x30, 0x31, 0x32, 0x33]) }, // fragments[3]
    { seq: 4, payload: new Uint8Array([0x00, 0x01, 0x02, 0x03]) }, // fragments[0] (wraps)
    { seq: 5, payload: new Uint8Array([0x10, 0x11, 0x12, 0x13]) }, // fragments[1] (wraps)
  ],
} as const;

/**
 * Boundary test: K=8 (repetition → LT code transition)
 */
export const BOUNDARY_K8_L256 = {
  name: 'boundary-k8-l256',
  config: {
    streamId: 100,
    blockIndex: 0,
    fragments: Array.from({ length: 8 }, (_, i) =>
      new Uint8Array(256).fill(i & 0xff)
    ),
  },
  // In repetition mode, seq 0-7 should directly map to fragments 0-7
  expectedRepetitionMode: [
    { seq: 0, fragmentIndex: 0 },
    { seq: 1, fragmentIndex: 1 },
    { seq: 2, fragmentIndex: 2 },
    { seq: 3, fragmentIndex: 3 },
    { seq: 4, fragmentIndex: 4 },
    { seq: 5, fragmentIndex: 5 },
    { seq: 6, fragmentIndex: 6 },
    { seq: 7, fragmentIndex: 7 },
  ],
} as const;

/**
 * Small LT code test: K=10, L=256
 */
export const SMALL_LT_K10_L256 = {
  name: 'small-lt-k10-l256',
  config: {
    streamId: 12345,
    blockIndex: 0,
    fragments: Array.from({ length: 10 }, (_, i) =>
      new Uint8Array(256).fill(i & 0xff)
    ),
    degreeCap: 64,
  },
  // These packets should be sufficient to decode (10 packets needed)
  // Actual degree and indices depend on PRNG state
  testSequence: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  validation: {
    minPacketsNeeded: 10,
    maxRedundantAllowed: 3,
    maxOverheadAllowed: 0.3,  // 30%
  },
} as const;

/**
 * Complete decode cycle test: K=12
 */
export const COMPLETE_DECODE_K12_L256 = {
  name: 'complete-decode-k12-l256',
  config: {
    streamId: 99999,
    blockIndex: 5,
    fragments: Array.from({ length: 12 }, (_, i) => {
      const arr = new Uint8Array(256);
      for (let j = 0; j < 256; j++) {
        arr[j] = (i + j) & 0xff;
      }
      return arr;
    }),
  },
  // Generate 15 packets (enough to decode with some overhead)
  testSequence: Array.from({ length: 15 }, (_, i) => i),
  validation: {
    k: 12,
    expectedComplete: true,
    expectedRank: 12,
    maxPacketsToComplete: 15,
  },
} as const;

/**
 * Edge case: Minimum K=1
 */
export const MINIMUM_K1_L256 = {
  name: 'minimum-k1-l256',
  config: {
    streamId: 1,
    blockIndex: 0,
    fragments: [
      new Uint8Array(256).fill(0xAA),
    ],
  },
  // All sequence numbers return the same fragment
  expectedEncodings: [
    { seq: 0, payload: new Uint8Array(256).fill(0xAA) },
    { seq: 1, payload: new Uint8Array(256).fill(0xAA) },
    { seq: 100, payload: new Uint8Array(256).fill(0xAA) },
    { seq: 999, payload: new Uint8Array(256).fill(0xAA) },
  ],
} as const;

/**
 * Edge case: K=7 (maximum repetition mode)
 */
export const MAX_REPETITION_K7_L32 = {
  name: 'max-repetition-k7-l32',
  config: {
    streamId: 7,
    blockIndex: 0,
    fragments: Array.from({ length: 7 }, (_, i) =>
      new Uint8Array(32).fill((i + 1) * 10)
    ),
  },
  expectedMapping: [
    { seq: 0, fragmentIndex: 0 },
    { seq: 1, fragmentIndex: 1 },
    { seq: 2, fragmentIndex: 2 },
    { seq: 3, fragmentIndex: 3 },
    { seq: 4, fragmentIndex: 4 },
    { seq: 5, fragmentIndex: 5 },
    { seq: 6, fragmentIndex: 6 },
    { seq: 7, fragmentIndex: 0 }, // wraps
    { seq: 13, fragmentIndex: 6 }, // 13 % 7 = 6
    { seq: 14, fragmentIndex: 0 }, // 14 % 7 = 0
  ],
} as const;

/**
 * Realistic scale test: K=768 (default)
 */
export const REALISTIC_K768_L256 = {
  name: 'realistic-k768-l256',
  config: {
    streamId: 42,
    blockIndex: 0,
    fragments: Array.from({ length: 768 }, (_, i) => {
      const arr = new Uint8Array(256);
      for (let j = 0; j < 256; j++) {
        arr[j] = ((i >> 8) + j) & 0xff;
      }
      return arr;
    }),
  },
  // Test with overhead budget: K * 1.05 = 806 packets max (5% overhead budget)
  testSequence: Array.from({ length: 806 }, (_, i) => i),
  validation: {
    k: 768,
    expectedComplete: true,
    maxOverhead: 0.05,  // 5% per §13.1 budget
    maxPackets: 806,    // 768 * 1.05
  },
} as const;

/**
 * Helper: Create encoder from fixture
 */
export function createEncoder(fixture: typeof REPETITION_K4_L4): LTEncoder {
  return new LTEncoder(fixture.config);
}

/**
 * Helper: Create decoder from fixture
 */
export function createDecoder(fixture: typeof REPETITION_K4_L4): GEDecoder {
  const firstFragment: Uint8Array | undefined = fixture.config.fragments[0];
  if (!firstFragment) {
    throw new Error('Fixture must have at least one fragment');
  }
  return new GEDecoder({
    streamId: fixture.config.streamId,
    blockIndex: fixture.config.blockIndex,
    k: fixture.config.fragments.length,
    fragLen: firstFragment.length,
  });
}

/**
 * Helper: Validate clean byte array
 */
export function assertCleanByteArray(arr: Uint8Array, expectedLength: number): void {
  if (!(arr instanceof Uint8Array)) {
    throw new Error('Must be Uint8Array');
  }
  if (arr.length !== expectedLength) {
    throw new Error(`Must be ${expectedLength} bytes, got ${arr.length}`);
  }
  // Check for aliasing
  if (arr.buffer.byteLength !== arr.length * arr.BYTES_PER_ELEMENT &&
      arr.byteOffset !== 0) {
    throw new Error('May be aliased (shared buffer)');
  }
}

/**
 * Helper: Run complete encode/decode cycle
 */
export function runEncodeDecodeCycle(
  fixture: typeof SMALL_LT_K10_L256
): {
  success: boolean;
  packetsUsed: number;
  rank: number;
  redundant: number;
  overhead: number;
  recovered: Uint8Array[] | null;
} {
  const firstFragment: Uint8Array | undefined = fixture.config.fragments[0];
  if (!firstFragment) {
    throw new Error('Fixture must have at least one fragment');
  }
  const encoder = new LTEncoder(fixture.config);
  const decoder = new GEDecoder({
    streamId: fixture.config.streamId,
    blockIndex: fixture.config.blockIndex,
    k: fixture.config.fragments.length,
    fragLen: firstFragment.length,
  });

  let packetsUsed = 0;
  for (const seq of fixture.testSequence) {
    const payload = encoder.encode(seq);
    decoder.absorb(seq, payload);
    packetsUsed++;
    if (decoder.complete) break;
  }

  return {
    success: decoder.complete,
    packetsUsed,
    rank: decoder.rank,
    redundant: decoder.redundant,
    overhead: decoder.overhead,
    recovered: decoder.complete ? decoder.recover() : null,
  };
}

/**
 * Helper: Verify recovered fragments match source
 */
export function verifyRecovery(
  source: Uint8Array[],
  recovered: Uint8Array[]
): boolean {
  if (source.length !== recovered.length) {
    return false;
  }
  for (let i = 0; i < source.length; i++) {
    const sourceItem: Uint8Array | undefined = source[i];
    const recoveredItem: Uint8Array | undefined = recovered[i];
    if (sourceItem === undefined || recoveredItem === undefined) {
      return false;
    }
    if (sourceItem.length !== recoveredItem.length) {
      return false;
    }
    for (let j = 0; j < sourceItem.length; j++) {
      const sourceByte: number | undefined = sourceItem[j];
      const recoveredByte: number | undefined = recoveredItem[j];
      if (sourceByte !== recoveredByte) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Phase 1 acceptance tests. These are the executable form of the plan's invariants
 * and of acceptance scenario A5 — see docs/plan/plan.md §5, §9, §14.
 */

import { describe, expect, it } from 'vitest';
import { BLOCK, DEGREE_CAP, K, L, PACKET, RUNGS } from '../src/core/params.js';
import { crc8, crc32 } from '../src/core/frame/crc.js';
import { readPacket, writePacket, PacketVersionError } from '../src/core/frame/header.js';
import { deriveIndices, makeDegreeTable, packetSeed } from '../src/core/fountain/prng.js';
import { LTEncoder } from '../src/core/fountain/encoder.js';
import { GEDecoder } from '../src/core/fountain/decoder.js';
import {
  BlockBitmap,
  blockK,
  blockRange,
  fromFragments,
  geometry,
  toFragments,
} from '../src/core/block/partition.js';

/** Deterministic bytes — never ASCII (§14.2: corruption is content AND length dependent). */
function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

function roundTripBlock(
  bytes: Uint8Array,
  { loss = 0, seed = 7, streamId = 0xdeadbeef, blockIndex = 0 } = {},
) {
  const fragments = toFragments(bytes, L);
  const enc = new LTEncoder({ streamId, blockIndex, fragments });
  const dec = new GEDecoder({ streamId, blockIndex, k: fragments.length, fragLen: L });
  let x = seed >>> 0 || 1;
  let emitted = 0;
  for (const { seq, payload } of enc.stream()) {
    emitted++;
    if (emitted > fragments.length * 40 + 1000) throw new Error('did not converge');
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    if ((x >>> 8) / 0xffffff < loss) continue; // erasure
    dec.absorb(seq, payload);
    if (dec.complete) break;
  }
  return { out: fromFragments(dec.recover(), bytes.length), dec, emitted };
}

describe('params', () => {
  it('every ladder rung holds a whole number of packets (§3.1.1)', () => {
    for (const r of RUNGS) {
      expect(r.packets * PACKET).toBeLessThanOrEqual(r.capacity);
      // and the next packet would NOT fit — rungs are minimal for their packet count
      expect((r.packets + 1) * PACKET).toBeGreaterThan(r.capacity);
    }
  });

  it('the conservative rung can carry payload — the L=507 regression', () => {
    const r1 = RUNGS[0];
    expect(r1.packets).toBeGreaterThanOrEqual(1);
    expect(PACKET).toBeLessThanOrEqual(r1.capacity);
  });

  it('block geometry matches the model (G7)', () => {
    expect(K).toBe(768);
    expect(L).toBe(256);
    expect(PACKET).toBe(269);
    expect(BLOCK).toBe(196608);
    expect((K * K) / 8).toBe(73728); // 72 KB matrix
  });
});

describe('crc', () => {
  it('crc8 detects single-bit flips', () => {
    const b = randomBytes(12, 3);
    const c = crc8(b);
    for (let i = 0; i < b.length * 8; i++) {
      const m = Uint8Array.from(b);
      m[i >> 3]! ^= 1 << (i & 7);
      expect(crc8(m)).not.toBe(c);
    }
  });
  it('crc32 is stable and order-sensitive', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(Uint8Array.of(1, 2))).not.toBe(crc32(Uint8Array.of(2, 1)));
  });
});

describe('header (I8)', () => {
  it('round-trips every field at its boundary', () => {
    const cases = [
      { wireVersion: 1, flags: 0, streamId: 0, blockIndex: 0, seq: 0 },
      { wireVersion: 1, flags: 255, streamId: 0xffffffff, blockIndex: 0xffffff, seq: 0xffffff },
      { wireVersion: 1, flags: 4, streamId: 0x80000000, blockIndex: 1, seq: 0x7fffff },
    ];
    for (const h of cases) {
      const payload = randomBytes(L, h.seq + 1);
      const p = writePacket(h, payload);
      expect(p.length).toBe(PACKET);
      const r = readPacket(p);
      expect(r).not.toBeNull();
      expect(r!.header).toEqual(h);
      expect(Array.from(r!.payload)).toEqual(Array.from(payload));
    }
  });

  it('rejects a corrupted header rather than applying it', () => {
    const p = writePacket(
      { wireVersion: 1, flags: 0, streamId: 5, blockIndex: 2, seq: 9 },
      randomBytes(L, 4),
    );
    // Test bytes 1-11 (CRC and other fields)
    for (let i = 1; i < 12; i++) {
      const m = Uint8Array.from(p);
      m[i]! ^= 0x01;
      expect(readPacket(m)).toBeNull();
    }
    // Byte 0: corrupting the version nibble should throw E-VERSION per §16.3
    const m = Uint8Array.from(p);
    m[0]! ^= 0x01; // Flip a bit in the version nibble
    expect(() => readPacket(m)).toThrow(PacketVersionError);
    expect(() => readPacket(m)).toThrow(expect.objectContaining({
      code: 'E-VERSION'
    }));
  });

  it('rejects foreign magic and wrong length', () => {
    const p = writePacket({ wireVersion: 1, flags: 0, streamId: 1, blockIndex: 0, seq: 0 }, randomBytes(L));
    const foreign = Uint8Array.from(p);
    foreign[0] = 0xa1;
    expect(readPacket(foreign)).toBeNull();
    expect(readPacket(p.subarray(0, PACKET - 1))).toBeNull();
  });

  it('rejects unknown wire version per §16.3', () => {
    // Create a packet with a different wire version nibble
    const p = writePacket({ wireVersion: 1, flags: 0, streamId: 1, blockIndex: 0, seq: 0 }, randomBytes(L));
    const wrongVersion = Uint8Array.from(p);
    // Change the version nibble to 2 (while keeping magic the same)
    wrongVersion[0] = (wrongVersion[0]! & 0xf0) | 0x02;
    // §16.3: MUST report E-VERSION and refuse - never attempt a partial parse
    expect(() => readPacket(wrongVersion)).toThrow(PacketVersionError);
    expect(() => readPacket(wrongVersion)).toThrow(expect.objectContaining({
      code: 'E-VERSION',
      details: { senderVersion: 2, receiverVersion: 1 }
    }));
  });
});

describe('prng (I3)', () => {
  it('is deterministic for the same wire fields', () => {
    const t = makeDegreeTable(K, DEGREE_CAP);
    const a = deriveIndices(0xdeadbeef, 3, 42, K, t);
    const b = deriveIndices(0xdeadbeef, 3, 42, K, t);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('differs when any of streamId / blockIndex / seq differs', () => {
    const t = makeDegreeTable(K, DEGREE_CAP);
    const base = Array.from(deriveIndices(1, 1, 1, K, t)).join(',');
    expect(Array.from(deriveIndices(2, 1, 1, K, t)).join(',')).not.toBe(base);
    expect(Array.from(deriveIndices(1, 2, 1, K, t)).join(',')).not.toBe(base);
    expect(Array.from(deriveIndices(1, 1, 2, K, t)).join(',')).not.toBe(base);
    expect(packetSeed(1, 1, 1)).not.toBe(packetSeed(1, 1, 2));
  });

  it('yields distinct in-range indices, degree within the cap (D25)', () => {
    const t = makeDegreeTable(K, DEGREE_CAP);
    for (let seq = 0; seq < 500; seq++) {
      const idx = deriveIndices(0xabcdef, 0, seq, K, t);
      expect(idx.length).toBeGreaterThan(0);
      expect(idx.length).toBeLessThanOrEqual(DEGREE_CAP);
      const s = new Set(Array.from(idx));
      expect(s.size).toBe(idx.length);
      for (const v of idx) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThan(K);
    }
  });
});

describe('block layer (D19, E3a)', () => {
  it('derives a short last block consistently', () => {
    const g = geometry(BLOCK * 2 + 1000);
    expect(g.blockCount).toBe(3);
    expect(blockK(g, 0)).toBe(K);
    expect(blockK(g, 2)).toBe(Math.ceil(1000 / L));
    expect(blockRange(g, 2)).toEqual({ start: BLOCK * 2, end: BLOCK * 2 + 1000 });
  });

  it('handles blockCount == 1 and sub-fragment files (E1/E2/E3b)', () => {
    expect(geometry(1).blockCount).toBe(1);
    expect(blockK(geometry(1), 0)).toBe(1);
    expect(blockK(geometry(L - 1), 0)).toBe(1);
  });

  it('bitmap tracks completion and reports what is missing', () => {
    const b = new BlockBitmap(21845); // 4 GB worth
    expect(b.serialize().length).toBeLessThanOrEqual(2731); // ~2.7 KB (§7.3)
    b.set(0); b.set(5);
    expect(b.size).toBe(2);
    expect(b.missing(3)).toEqual([1, 2, 3]);
    expect(b.complete).toBe(false);
    const restored = new BlockBitmap(21845, b.serialize());
    expect(restored.has(5)).toBe(true);
    expect(restored.has(4)).toBe(false);
  });
});

describe('fountain round-trip (I10)', () => {
  it('recovers a full block byte-exactly with no loss', () => {
    const bytes = randomBytes(BLOCK, 11);
    const { out, dec } = roundTripBlock(bytes);
    expect(Array.from(out)).toEqual(Array.from(bytes));
    expect(dec.rank).toBe(K);
  });

  it('recovers under 50% loss — Phase 1 exit criterion', () => {
    const bytes = randomBytes(BLOCK, 12);
    const { out, dec } = roundTripBlock(bytes, { loss: 0.5 });
    expect(Array.from(out)).toEqual(Array.from(bytes));
    expect(dec.overhead).toBeLessThan(0.12); // §13.1 p99 budget
  });

  it('meets the reception-overhead budget across seeds (§13.1)', () => {
    const overheads: number[] = [];
    for (let s = 0; s < 12; s++) {
      const { dec } = roundTripBlock(randomBytes(BLOCK, 100 + s), { seed: 200 + s });
      overheads.push(dec.overhead);
    }
    const mean = overheads.reduce((a, b) => a + b, 0) / overheads.length;
    expect(mean).toBeLessThan(0.05); // <= +5% mean
    expect(Math.max(...overheads)).toBeLessThan(0.12); // <= +12% p99
  });

  it('survives a hostile payload: all-zero, all-ones, and 0x00..0xFF (§14.2)', () => {
    for (const make of [
      () => new Uint8Array(BLOCK),
      () => new Uint8Array(BLOCK).fill(0xff),
      () => Uint8Array.from({ length: BLOCK }, (_, i) => i & 0xff),
    ]) {
      const bytes = make();
      const { out } = roundTripBlock(bytes);
      expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it('handles a short last block and a sub-fragment block', () => {
    for (const n of [1, 5, L - 1, L, L + 1, L * 7, BLOCK - 1]) {
      const bytes = randomBytes(n, n);
      const { out } = roundTripBlock(bytes);
      expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it('treats duplicate packets as redundant, never as corruption (E6)', () => {
    const fragments = toFragments(randomBytes(L * 32, 21), L);
    const enc = new LTEncoder({ streamId: 1, blockIndex: 0, fragments });
    const dec = new GEDecoder({ streamId: 1, blockIndex: 0, k: fragments.length, fragLen: L });
    const p = enc.encode(0);
    expect(dec.absorb(0, p)).toBe(true);
    expect(dec.absorb(0, p)).toBe(false); // same packet again
    expect(dec.redundant).toBe(1);
  });

  it('is stateless: packet N generates without replaying 1..N-1 (D24)', () => {
    const fragments = toFragments(randomBytes(L * 64, 31), L);
    const a = new LTEncoder({ streamId: 9, blockIndex: 2, fragments });
    const b = new LTEncoder({ streamId: 9, blockIndex: 2, fragments });
    expect(Array.from(a.encode(5000))).toEqual(Array.from(b.encode(5000)));
  });
});

describe('memory (I6a)', () => {
  it('keeps the block-layer working set flat across many blocks', () => {
    // A5 in miniature: stream many blocks, assert no growth trend.
    const g = geometry(BLOCK * 40);
    const readings: number[] = [];
    for (let i = 0; i < 40; i++) {
      const bytes = randomBytes(BLOCK, i + 1);
      const { out } = roundTripBlock(bytes, { blockIndex: i });
      expect(out.length).toBe(BLOCK);
      if (globalThis.gc) globalThis.gc();
      readings.push(process.memoryUsage().heapUsed);
    }
    expect(g.blockCount).toBe(40);
    const first = readings.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const last = readings.slice(-10).reduce((a, b) => a + b, 0) / 10;
    // allow noise, forbid a trend
    expect(last).toBeLessThan(first * 2 + 64 * 1024 * 1024);
  }, 120_000);
});

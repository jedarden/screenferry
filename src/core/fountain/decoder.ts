/**
 * GF(2) Gaussian elimination decoder — D5, and the reason D6 exists.
 *
 * Measured against peeling in docs/research/sim/fountain_overhead_sim.py: at
 * K=1000 GE needs +1.2% extra symbols where peeling needs +180%. The harmonic
 * distribution and GE are a COUPLED pair (D6 / invariant I2) — harmonic + peeling
 * is the worst cell measured and degrades as K grows, failing only on large inputs
 * where the symptom points away from the cause.
 *
 * Cost: O(K^2) memory, O(K^3) bit-ops. D19 sizes K from the TIME term (the memory
 * term was never binding) — see plan §3.1. Measured at K=768: 8 ms per block,
 * ~3.2 GB/s on a desktop (spike/ge-bench.mjs).
 */

import { DEGREE_CAP, MIN_LT_K } from '../params.js';
import { deriveIndices, makeDegreeTable } from './prng.js';

export interface DecoderOpts {
  streamId: number;
  blockIndex: number;
  k: number;
  fragLen: number;
  degreeCap?: number;
}

export class GEDecoder {
  readonly k: number;
  readonly fragLen: number;
  private readonly maskWords: number;
  private readonly table: Float64Array;
  private readonly scratch: Int32Array;
  /** pivot position -> reduced row */
  private readonly pivMask: (Uint32Array | null)[];
  private readonly pivPay: (Uint8Array | null)[];
  private readonly opts: DecoderOpts;
  private readonly repetition: boolean;
  private readonly repSeen: Uint8Array;

  rank = 0;
  packetsSeen = 0;
  /** Packets that reduced to zero — linearly dependent, contributed nothing (E6). */
  redundant = 0;

  constructor(opts: DecoderOpts) {
    this.opts = opts;
    this.k = opts.k;
    this.fragLen = opts.fragLen;
    this.maskWords = Math.ceil(opts.k / 32);
    this.table = makeDegreeTable(opts.k, opts.degreeCap ?? DEGREE_CAP);
    this.scratch = new Int32Array(opts.k);
    this.pivMask = new Array(opts.k).fill(null);
    this.pivPay = new Array(opts.k).fill(null);
    this.repetition = opts.k < MIN_LT_K;
    this.repSeen = new Uint8Array(this.repetition ? opts.k : 0);
  }

  get complete(): boolean {
    return this.rank === this.k;
  }

  /** Reception overhead vs K, as a fraction. Budget: <= +5% mean (§13.1). */
  get overhead(): number {
    return (this.packetsSeen - this.k) / this.k;
  }

  /**
   * Absorb one packet. Returns true if it raised the rank.
   * A `false` return is the NORMAL case near completion, not an error.
   */
  absorb(seq: number, payload: Uint8Array): boolean {
    if (payload.length !== this.fragLen) return false;
    this.packetsSeen++;

    if (this.repetition) {
      const i = seq % this.k;
      if (this.repSeen[i]) {
        this.redundant++;
        return false;
      }
      this.repSeen[i] = 1;
      this.pivPay[i] = payload.slice();
      this.rank++;
      return true;
    }

    const idx = deriveIndices(
      this.opts.streamId,
      this.opts.blockIndex,
      seq,
      this.k,
      this.table,
      this.scratch,
    );
    const mask = new Uint32Array(this.maskWords);
    for (let i = 0; i < idx.length; i++) {
      const v = idx[i]!;
      mask[v >>> 5]! ^= 1 << (v & 31);
    }
    const pay = payload.slice();

    let w = this.maskWords - 1;
    for (;;) {
      while (w >= 0 && mask[w] === 0) w--;
      if (w < 0) {
        this.redundant++;
        return false; // reduced to zero — linearly dependent
      }
      const p = (w << 5) | (31 - Math.clz32(mask[w]!));
      const pm: Uint32Array | null = this.pivMask[p] ?? null;
      if (pm === null) {
        this.pivMask[p] = mask;
        this.pivPay[p] = pay;
        this.rank++;
        return true;
      }
      const pp = this.pivPay[p]!;
      for (let i = 0; i <= w; i++) mask[i]! ^= pm[i]!;
      for (let i = 0; i < this.fragLen; i++) pay[i]! ^= pp[i]!;
    }
  }

  /**
   * Back-substitute to recover the source fragments. Only valid once complete.
   * Called once per block, so the O(K^2) pass here is not on the hot path.
   */
  recover(): Uint8Array[] {
    if (!this.complete) throw new Error('recover() before rank == k');
    if (this.repetition) return this.pivPay.slice(0, this.k).map((p) => p!.slice());

    // absorb() reduces from the highest bit down, so a row stored at pivot p has p
    // as its HIGHEST set bit; any other set bits are at positions < p. That is
    // lower-triangular in pivot order, so forward-substitute p ascending: every
    // dependency is already solved.
    const out: Uint8Array[] = new Array(this.k);
    for (let p = 0; p < this.k; p++) {
      const mask = this.pivMask[p]!;
      const pay = this.pivPay[p]!.slice();
      for (let w = 0; w <= p >>> 5; w++) {
        let bits = mask[w]!;
        while (bits !== 0) {
          const low = bits & -bits;
          const q = (w << 5) | (31 - Math.clz32(low));
          bits ^= low;
          if (q >= p) continue; // the pivot bit itself
          const op = out[q]!;
          for (let i = 0; i < this.fragLen; i++) pay[i]! ^= op[i]!;
        }
      }
      out[p] = pay;
    }
    return out;
  }
}

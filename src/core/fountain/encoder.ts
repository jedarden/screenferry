/**
 * LT fountain encoder — D5. Endless by construction (D24): there is no finite set
 * of packets, so this is a generator, never an array.
 */

import { DEGREE_CAP, MIN_LT_K } from '../params.js';
import { deriveIndices, makeDegreeTable } from './prng.js';

export interface EncoderOpts {
  streamId: number;
  blockIndex: number;
  /** Source fragments, all length L except possibly none (blocks are padded). */
  fragments: Uint8Array[];
  degreeCap?: number;
}

export class LTEncoder {
  readonly k: number;
  readonly fragLen: number;
  private readonly table: Float64Array;
  private readonly scratch: Int32Array;
  private readonly opts: EncoderOpts;
  /** E2: below MIN_LT_K the LT code behaves badly — plain repetition instead. */
  readonly repetition: boolean;

  constructor(opts: EncoderOpts) {
    this.opts = opts;
    this.k = opts.fragments.length;
    if (this.k === 0) throw new Error('encoder: zero fragments');
    this.fragLen = opts.fragments[0]!.length;
    for (const f of opts.fragments) {
      if (f.length !== this.fragLen) throw new Error('encoder: ragged fragments (violates I1)');
    }
    this.repetition = this.k < MIN_LT_K;
    this.table = makeDegreeTable(this.k, opts.degreeCap ?? DEGREE_CAP);
    this.scratch = new Int32Array(this.k);
  }

  /** Payload for packet `seq`. Stateless: any seq, any order, no replay. */
  encode(seq: number): Uint8Array {
    const out = new Uint8Array(this.fragLen);
    if (this.repetition) {
      out.set(this.opts.fragments[seq % this.k]!);
      return out;
    }
    const idx = deriveIndices(
      this.opts.streamId,
      this.opts.blockIndex,
      seq,
      this.k,
      this.table,
      this.scratch,
    );
    for (let i = 0; i < idx.length; i++) {
      const src = this.opts.fragments[idx[i]!]!;
      for (let b = 0; b < this.fragLen; b++) out[b]! ^= src[b]!;
    }
    return out;
  }

  /** Endless stream — the shape the rest of the system is written against. */
  *stream(from = 0): Generator<{ seq: number; payload: Uint8Array }> {
    for (let seq = from; ; seq++) yield { seq, payload: this.encode(seq) };
  }
}

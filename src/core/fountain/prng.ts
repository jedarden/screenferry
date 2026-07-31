/**
 * Deterministic PRNG and index derivation — D7 / invariant I3.
 *
 * Index sets are DERIVED from (streamId, blockIndex, seq), never transmitted. That
 * is what keeps the header at 13 bytes and what makes the sender stateless (D24):
 * packet N can be generated without replaying 1..N-1, which is what makes resume
 * (D22) and the repair code (§8.2) nearly free.
 *
 * This must be BIT-EXACT across implementations. test/fixtures/vectors.json pins
 * it; changing anything here is a wire-breaking change (§16.3).
 */

/** SplitMix32 — small, fast, good enough avalanche for index selection. */
export function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** Mix the three wire fields into one 32-bit seed. Order is normative. */
export function packetSeed(streamId: number, blockIndex: number, seq: number): number {
  let h = streamId >>> 0;
  h = (Math.imul(h ^ (blockIndex >>> 0), 0x85ebca6b) >>> 0) ^ (h >>> 13);
  h = (Math.imul(h ^ (seq >>> 0), 0xc2b2ae35) >>> 0) ^ (h >>> 16);
  return h >>> 0;
}

/**
 * Harmonic degree distribution Pr(d) ∝ 1/d, truncated at `cap` — D6 + D25.
 *
 * D6: the distribution and the decoder are a COUPLED pair. Changing this without
 * re-running docs/research/sim/degree_cap_sim.py violates invariant I2.
 */
export function makeDegreeTable(k: number, cap: number): Float64Array {
  const hi = Math.min(cap, k);
  let total = 0;
  for (let d = 1; d <= hi; d++) total += 1 / d;
  const cum = new Float64Array(hi);
  let acc = 0;
  for (let d = 1; d <= hi; d++) {
    acc += 1 / d / total;
    cum[d - 1] = acc;
  }
  return cum;
}

export function sampleDegree(cum: Float64Array, r: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < r) lo = mid + 1;
    else hi = mid;
  }
  return lo + 1;
}

/**
 * The index set for one packet. Deterministic given the wire fields.
 * Returns `d` distinct fragment indices in [0, k).
 */
export function deriveIndices(
  streamId: number,
  blockIndex: number,
  seq: number,
  k: number,
  degreeTable: Float64Array,
  scratch?: Int32Array,
): Int32Array {
  const rnd = splitmix32(packetSeed(streamId, blockIndex, seq));
  const d = Math.min(sampleDegree(degreeTable, rnd()), k);

  // Partial Fisher-Yates over a 0..k-1 scratch: distinct indices, no rejection loop.
  const pool = scratch && scratch.length >= k ? scratch : new Int32Array(k);
  for (let i = 0; i < k; i++) pool[i] = i;
  const out = new Int32Array(d);
  for (let i = 0; i < d; i++) {
    const j = i + Math.floor(rnd() * (k - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
    out[i] = pool[i]!;
  }
  return out;
}

#!/usr/bin/env node
/**
 * S1 — GE decoder throughput benchmark.
 *
 * Validates or kills the single most load-bearing UNMEASURED number in the plan:
 * the 200 MB/s phone-JS XOR budget that D19's K = 768 was chosen against
 * (plan.md §18 R1 flags it as an estimate in the model's own comment).
 *
 * Needs NO camera, NO dependencies, NO build step. Runs in Node or a browser.
 * This is the cheapest possible check of a decision the whole block layer rests on.
 *
 *   node spike/ge-bench.mjs              # default sweep
 *   node spike/ge-bench.mjs 768 256      # one (K, L)
 *
 * In a browser: import it and call run(K, L) — same code path, and the browser
 * number is the one that matters. Node and Chrome share V8, but a phone is the
 * target; expect roughly 3–5x slower than a desktop.
 *
 * WHAT IT MEASURES
 * It performs a complete GF(2) Gaussian elimination decode of one block — the
 * real inner loop, not a synthetic XOR microbenchmark — and reports the sustained
 * XOR throughput achieved. Compare that against the "required" figure printed by
 * docs/research/sim/ge_cost_model.py for the same (K, L) and wire rate.
 */

const HEADER = 13;

// ---------------------------------------------------------------- prng (mulberry32)
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Harmonic Pr(d) ∝ 1/d truncated at `cap` — D25. */
function degreeSampler(K, cap, rnd) {
  const hi = Math.min(cap ?? K, K);
  const cum = new Float64Array(hi);
  let total = 0;
  for (let d = 1; d <= hi; d++) total += 1 / d;
  let acc = 0;
  for (let d = 1; d <= hi; d++) { acc += 1 / d / total; cum[d - 1] = acc; }
  return () => {
    const r = rnd();
    let lo = 0, high = hi - 1;
    while (lo < high) { const mid = (lo + high) >> 1; if (cum[mid] < r) lo = mid + 1; else high = mid; }
    return lo + 1;
  };
}

// ---------------------------------------------------------------- the decode
export function run(K, L, { cap = 64, seed = 0xC0FFEE } = {}) {
  const MASKW = Math.ceil(K / 32);
  const PAYW = Math.ceil(L / 4);
  const ROWB = MASKW * 4 + PAYW * 4;      // bytes touched per row operation

  // Pivot store: index = pivot bit position.
  const pivMask = new Array(K).fill(null);
  const pivPay = new Array(K).fill(null);

  const rnd = prng(seed);
  const degree = degreeSampler(K, cap, rnd);
  const idx = new Int32Array(K);

  let rank = 0, packets = 0, rowOps = 0;
  const mask = new Uint32Array(MASKW);
  const pay = new Uint32Array(PAYW);

  const t0 = performance.now();

  while (rank < K) {
    // --- build one encoded packet
    mask.fill(0);
    for (let i = 0; i < PAYW; i++) pay[i] = (rnd() * 4294967296) >>> 0;
    const d = degree();
    // sample d distinct indices (partial Fisher–Yates over a reused scratch)
    for (let i = 0; i < K; i++) idx[i] = i;
    for (let i = 0; i < d; i++) {
      const j = i + ((rnd() * (K - i)) | 0);
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
      mask[idx[i] >>> 5] ^= 1 << (idx[i] & 31);
    }
    packets++;

    // --- reduce against stored pivots
    let w = MASKW - 1;
    for (;;) {
      while (w >= 0 && mask[w] === 0) w--;
      if (w < 0) break;                                   // reduced to zero: dependent
      const bit = 31 - Math.clz32(mask[w]);
      const p = (w << 5) | bit;

      const pm = pivMask[p];
      if (pm === null) {                                  // new pivot
        pivMask[p] = mask.slice();
        pivPay[p] = pay.slice();
        rank++;
        break;
      }
      const pp = pivPay[p];
      for (let i = 0; i <= w; i++) mask[i] ^= pm[i];
      for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i];
      rowOps++;
    }
  }

  const ms = performance.now() - t0;
  const bytes = rowOps * ROWB;
  return {
    K, L, cap, packets, rowOps, ms,
    overheadPct: ((packets - K) / K) * 100,
    xorBytes: bytes,
    throughputMBs: bytes / 1e6 / (ms / 1000),
    blockBytes: K * L,
    matrixBytes: (K * K) / 8,
  };
}

/** Sustained XOR the decoder must achieve to keep pace — matches ge_cost_model.py. */
export const requiredMBs = (K, L, wireBytesPerSec) =>
  (K * (K / 8 + L) * wireBytesPerSec) / L / 1e6;

// ---------------------------------------------------------------- report
const STAGES = [["Stage 1", 30], ["Stage 2", 60], ["Stage 3", 106]];
const BUDGET = 200;                  // MB/s — the plan's assumed phone-JS figure
const PHONE_FACTOR = 4;              // desktop → mid-range phone, conservative

function report(K, L) {
  // warm V8, then take the best of 3 (we want the achievable ceiling, not GC noise)
  run(K, L);
  let best = null;
  for (let i = 0; i < 3; i++) {
    const r = run(K, L, { seed: 0xC0FFEE + i });
    if (!best || r.throughputMBs > best.throughputMBs) best = r;
  }

  console.log(`\nK=${best.K}  L=${best.L}  cap=${best.cap}`);
  console.log(`  block ${(best.blockBytes / 1024).toFixed(0)} KB · matrix ${(best.matrixBytes / 1024).toFixed(0)} KB`);
  console.log(`  packets ${best.packets} (overhead ${best.overheadPct >= 0 ? '+' : ''}${best.overheadPct.toFixed(2)}%) · row-ops ${best.rowOps.toLocaleString()}`);
  console.log(`  decode ${best.ms.toFixed(0)} ms · XOR ${(best.xorBytes / 1e6).toFixed(0)} MB`);
  console.log(`  THIS MACHINE: ${best.throughputMBs.toFixed(0)} MB/s`);
  const phone = best.throughputMBs / PHONE_FACTOR;
  console.log(`  est. phone (÷${PHONE_FACTOR}): ${phone.toFixed(0)} MB/s   [plan assumes ${BUDGET}]`);

  for (const [name, kb] of STAGES) {
    const need = requiredMBs(K, L, kb * 1024);
    const ok = phone >= need;
    console.log(`    ${name.padEnd(8)} needs ${need.toFixed(0).padStart(4)} MB/s  → ${ok ? 'OK' : 'FAILS'}  (${(phone / need).toFixed(2)}x margin)`);
  }
  return best;
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('ge-bench.mjs')) {
  const [, , kArg, lArg] = process.argv;
  console.log('S1 — GE decoder throughput benchmark');
  console.log('Validates the 200 MB/s phone-JS budget behind D19 (plan.md §18 R1).');
  console.log(`Node ${process.version}`);
  if (kArg) {
    report(+kArg, +(lArg ?? 256));
  } else {
    for (const K of [512, 768, 1024, 1152]) report(K, 256);
    console.log('\nKill criteria (plan.md §17 Phase 0.5):');
    console.log('  est. phone < required at Stage 3 → drop K, or re-open D5 vs wirehair (R1)');
    console.log(`  Packet on the wire = ${HEADER} + L bytes.`);
  }
}

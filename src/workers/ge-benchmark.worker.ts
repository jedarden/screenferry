/**
 * GE Benchmark Worker
 *
 * Runs Gaussian Elimination benchmark in a worker thread to avoid janking the UI.
 * Ported from spike/ge-bench.mjs
 */

interface ConfigMessage {
  type: 'run';
  config: {
    targetK: number;
    L: number;
    cap?: number;
    trials: number;
    phoneFactor: number;
    stages: Array<{name: string; rateKBs: number}>;
  };
}

interface ResultMessage {
  type: 'result';
  result: {
    deviceSignature: string;
    measuredThroughputMBs: number;
    derivedKMax: number;
    timestamp: number;
    version: number;
    duration: number;
  };
}

interface ErrorMessage {
  type: 'error';
  error: string;
}

// ---------------------------------------------------------------- prng (mulberry32)
function prng(seed: number) {
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
function degreeSampler(K: number, cap: number, rnd: () => number) {
  const hi = Math.min(cap ?? K, K);
  const cum = new Float64Array(hi);
  let total = 0;
  for (let d = 1; d <= hi; d++) total += 1 / d;
  let acc = 0;
  for (let d = 1; d <= hi; d++) {
    acc += 1 / d / total;
    cum[d - 1] = acc;
  }
  return () => {
    const r = rnd();
    let lo = 0,
      high = hi - 1;
    while (lo < high) {
      const mid = (lo + high) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else high = mid;
    }
    return lo + 1;
  };
}

/**
 * Calculate required GE throughput for a given K, L, and wire rate.
 *
 * required = K · (K/8 + L) · wireRate / L
 */
function requiredThroughputMBs(K: number, L: number, wireBytesPerSec: number): number {
  return (K * (K / 8 + L) * wireBytesPerSec) / (L * 1_000_000);
}

/**
 * Derive K_max from measured throughput using binary search.
 */
function deriveKMax(measuredThroughputMBs: number, L: number, stage3RateKBs: number): number {
  const stage3RateBytes = stage3RateKBs * 1024;
  const candidates = [256, 384, 512, 640, 768, 896, 1024, 1152, 1280, 1536];

  let lo = 0;
  let hi = candidates.length - 1;
  let result = 256; // Minimum safe value

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const K = candidates[mid];
    const required = requiredThroughputMBs(K, L, stage3RateBytes);

    if (measuredThroughputMBs >= required) {
      result = K;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return result;
}

/**
 * Create a device signature string for caching.
 */
function createDeviceSignature(): string {
  const nav = navigator as {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory?: number;
  };

  const parts = [
    nav.platform,
    nav.hardwareConcurrency.toString(),
    nav.deviceMemory?.toString() || 'unknown',
  ];

  let hash = 0;
  for (let i = 0; i < nav.userAgent.length; i++) {
    const char = nav.userAgent.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  parts.push(Math.abs(hash).toString(16));
  return parts.join('|');
}

/**
 * Run the GE benchmark algorithm.
 */
function runBenchmark(config: ConfigMessage['config']): ResultMessage['result'] {
  const {targetK: K, L, cap = 64, trials, phoneFactor, stages} = config;
  const MASKW = Math.ceil(K / 32);
  const PAYW = Math.ceil(L / 4);
  const ROWB = MASKW * 4 + PAYW * 4;

  const benchmarkStart = performance.now(); // Track total duration
  let bestThroughput = 0;

  // Warm up and take best of 3 trials
  for (let trial = -1; trial < trials; trial++) {
    const pivMask = new Array(K).fill(null);
    const pivPay = new Array(K).fill(null);
    const seed = 0xc0ffee + trial;
    const rnd = prng(seed);
    const degree = degreeSampler(K, cap, rnd);
    const idx = new Int32Array(K);

    let rank = 0,
      packets = 0,
      rowOps = 0;
    const mask = new Uint32Array(MASKW);
    const pay = new Uint32Array(PAYW);

    const t0 = performance.now();

    while (rank < K) {
      mask.fill(0);
      for (let i = 0; i < PAYW; i++) pay[i] = (rnd() * 4294967296) >>> 0;
      const d = degree();

      for (let i = 0; i < K; i++) idx[i] = i;
      for (let i = 0; i < d; i++) {
        const j = i + ((rnd() * (K - i)) | 0);
        const tmp = idx[i];
        idx[i] = idx[j];
        idx[j] = tmp;
        mask[idx[i] >>> 5] ^= 1 << (idx[i] & 31);
      }
      packets++;

      let w = MASKW - 1;
      for (;;) {
        while (w >= 0 && mask[w] === 0) w--;
        if (w < 0) break;
        const bit = 31 - Math.clz32(mask[w]);
        const p = (w << 5) | bit;

        const pm = pivMask[p];
        if (pm === null) {
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
    const throughput = bytes / 1e6 / (ms / 1000);

    if (trial >= 0 && throughput > bestThroughput) {
      bestThroughput = throughput;
    }
  }

  const measuredThroughputMBs = bestThroughput / phoneFactor;
  const stage3 = stages.find((s) => s.name === 'Stage 3') || stages[stages.length - 1];
  if (!stage3) {
    throw new Error('No stages configured for benchmark');
  }
  const derivedKMax = deriveKMax(measuredThroughputMBs, L, stage3.rateKBs);

  const duration = performance.now() - benchmarkStart;

  return {
    deviceSignature: createDeviceSignature(),
    measuredThroughputMBs,
    derivedKMax,
    timestamp: Date.now(),
    version: 1, // BENCHMARK_VERSION
    duration,
  };
}

// Worker message handler
self.onmessage = (e: MessageEvent<ConfigMessage>) => {
  const {type, config} = e.data;

  if (type === 'run') {
    try {
      const result = runBenchmark(config);
      const message: ResultMessage = {type: 'result', result};
      self.postMessage(message);
    } catch (error) {
      const message: ErrorMessage = {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(message);
    }

    // Self-terminate after sending result
    self.close();
  }
};

export {}; // Make this a module

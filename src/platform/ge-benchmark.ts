/**
 * GE (Gaussian Elimination) benchmark platform component.
 *
 * Measures the local device's GE decoder throughput, derives K_max,
 * and implements D26/T1 requirements for refusing streams with K > K_max.
 *
 * Reference: docs/notes/ge-benchmark-spec.md, plan.md D26, T1, §16.4
 */

export interface GEBenchmarkConfig {
  /** Wire rates to test against (KB/s). Defaults to Stage 1/2/3 rates. */
  stages: Array<{name: string, rateKBs: number}>;
  /** Safety margin for desktop→phone estimate. Defaults to ÷4. */
  phoneFactor: number;
  /** Target K to benchmark. Defaults to 768 (D19's adopted value). */
  targetK: number;
  /** Fragment length in bytes. Defaults to 256 (D19). */
  L: number;
  /** Number of trials to run (take best result). Defaults to 3. */
  trials: number;
  /** Degree cap for fountain code. Defaults to 64 (D25). */
  cap?: number;
}

export interface GEBenchmarkResult {
  /** Composite device signature for caching */
  deviceSignature: string;
  /** Measured sustained XOR throughput (MB/s) */
  measuredThroughputMBs: number;
  /** Maximum K this device can handle at Stage 3 rate */
  derivedKMax: number;
  /** When the benchmark was run */
  timestamp: number;
  /** Benchmark algorithm version (for cache invalidation) */
  version: number;
  /** How long the benchmark took to complete (ms) */
  duration: number;
}

export interface GEValidationResult {
  /** Whether the beacon's K is acceptable */
  acceptable: boolean;
  /** The beacon's derived K */
  beaconK: number;
  /** This device's K_max */
  localKMax: number;
  /** Error details if not acceptable */
  error?: {
    code: string;
    message: string;
    details: {beaconK: number, localKMax: number};
  };
}

/** Default configuration matching plan.md parameters */
export const DEFAULT_CONFIG: GEBenchmarkConfig = {
  stages: [
    {name: 'Stage 1', rateKBs: 30},
    {name: 'Stage 2', rateKBs: 60},
    {name: 'Stage 3', rateKBs: 106},
  ],
  phoneFactor: 4,
  targetK: 768,
  L: 256,
  trials: 3,
};

/** Benchmark algorithm version - increment to invalidate cached results */
export const BENCHMARK_VERSION = 1;

/** Conservative fallback K_max if benchmark fails */
export const FALLBACK_K_MAX = 512;

/** Device signature for caching */
export interface DeviceSignature {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
}

/**
 * Create a composite device signature for caching.
 *
 * This uniquely identifies a device class for the purpose of caching
 * GE benchmark results. Devices with the same signature are assumed
 * to have similar GE performance.
 */
export function createDeviceSignature(): DeviceSignature {
  const nav = navigator as {
    userAgent: string;
    platform: string;
    hardwareConcurrency: number;
    deviceMemory?: number;
  };

  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    hardwareConcurrency: nav.hardwareConcurrency || 2,
    deviceMemory: (nav as any).deviceMemory,
  };
}

/**
 * Serialize a device signature to a string cache key.
 */
export function signatureToKey(sig: DeviceSignature): string {
  const parts = [
    sig.platform,
    sig.hardwareConcurrency.toString(),
    sig.deviceMemory?.toString() || 'unknown',
  ];
  // Hash the userAgent to avoid excessively long keys
  let hash = 0;
  for (let i = 0; i < sig.userAgent.length; i++) {
    const char = sig.userAgent.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  parts.push(Math.abs(hash).toString(16));
  return parts.join('|');
}

/**
 * Calculate required GE throughput for a given K, L, and wire rate.
 *
 * This matches the formula from plan.md §3.1:
 * required = K · (K/8 + L) · wireRate / L
 *
 * @param K - Number of fragments per block
 * @param L - Fragment length in bytes
 * @param wireBytesPerSec - Wire rate in bytes/second
 * @returns Required throughput in MB/s
 */
export function requiredThroughputMBs(
  K: number,
  L: number,
  wireBytesPerSec: number
): number {
  return (K * (K / 8 + L) * wireBytesPerSec) / (L * 1_000_000);
}

/**
 * Derive K_max from measured throughput.
 *
 * Binary search to find the maximum K where:
 *   measured_throughput ≥ required(K, L, stage3_rate)
 *
 * @param measuredThroughputMBs - Measured XOR throughput (MB/s)
 * @param L - Fragment length in bytes
 * @param stage3RateKBs - Stage 3 wire rate (KB/s)
 * @returns Maximum K this device can handle
 */
export function deriveKMax(
  measuredThroughputMBs: number,
  L: number,
  stage3RateKBs: number
): number {
  const stage3RateBytes = stage3RateKBs * 1024;

  // Test K values from the plan's table
  const candidates = [256, 384, 512, 640, 768, 896, 1024, 1152, 1280, 1536];

  // Binary search for the max K that fits
  let lo = 0;
  let hi = candidates.length - 1;
  let result = 256; // Minimum safe value

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const K = candidates[mid];
    const required = requiredThroughputMBs(K, L, stage3RateBytes);

    if (measuredThroughputMBs >= required) {
      result = K; // This K fits, try higher
      lo = mid + 1;
    } else {
      hi = mid - 1; // Too high, try lower
    }
  }

  return result;
}

/**
 * Validate a beacon's K against the local device's K_max.
 *
 * Implements D26/T1 requirement: "The receiver derives K from the beacon
 * and MUST refuse a stream whose K exceeds what it benchmarked locally."
 *
 * @param blockSize - Beacon-declared block size
 * @param L - Fragment length
 * @param localKMax - This device's maximum supported K
 * @returns Validation result
 */
export function validateBeaconK(
  blockSize: number,
  L: number,
  localKMax: number
): GEValidationResult {
  const beaconK = Math.ceil(blockSize / L);

  if (beaconK > localKMax) {
    return {
      acceptable: false,
      beaconK,
      localKMax,
      error: {
        code: 'E-K-OVERFLOW',
        message: `Sender K (${beaconK}) exceeds this device's maximum (${localKMax}). ` +
                 `Use a smaller file or a more powerful receiver.`,
        details: {beaconK, localKMax},
      },
    };
  }

  return {
    acceptable: true,
    beaconK,
    localKMax,
  };
}

/**
 * IndexedDB key for caching benchmark results.
 */
const DB_NAME = 'screenferry-ge-benchmark';
const STORE_NAME = 'results';
const KEY_VERSION = 'version';
const KEY_SIGNATURE = 'signature';

/**
 * Cache a benchmark result in IndexedDB.
 */
export async function cacheBenchmarkResult(
  sig: DeviceSignature,
  result: GEBenchmarkResult
): Promise<void> {
  const req = indexedDB.open(DB_NAME, 1);

  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const key = signatureToKey(sig);

      store.put({key, sig, result});

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {keyPath: 'key'});
      }
    };
  });
}

/**
 * Load a cached benchmark result for the current device.
 */
export async function loadCachedBenchmarkResult(
  sig: DeviceSignature
): Promise<GEBenchmarkResult | null> {
  const req = indexedDB.open(DB_NAME, 1);

  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const key = signatureToKey(sig);
      const getReq = store.get(key);

      getReq.onsuccess = () => {
        db.close();
        const data = getReq.result;
        if (data && data.result.version === BENCHMARK_VERSION) {
          resolve(data.result);
        } else {
          resolve(null); // No valid cached result
        }
      };

      getReq.onerror = () => {
        db.close();
        reject(getReq.error);
      };
    };

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {keyPath: 'key'});
      }
    };
  });
}

/**
 * Clear cached benchmark results (e.g., for testing or manual refresh).
 */
export async function clearBenchmarkCache(): Promise<void> {
  const req = indexedDB.open(DB_NAME, 1);

  return new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const clearReq = store.clear();

      clearReq.onsuccess = () => {
        db.close();
        resolve();
      };

      clearReq.onerror = () => {
        db.close();
        reject(clearReq.error);
      };
    };

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {keyPath: 'key'});
      }
    };
  });
}

/**
 * Get the device's K_max with fallback.
 *
 * Tries to load a cached result, or runs a fresh benchmark if needed.
 * Falls back to K=512 if the benchmark fails.
 *
 * @param config - Benchmark configuration
 * @returns K_max for this device
 */
export async function getKMaxWithFallback(
  config: GEBenchmarkConfig = DEFAULT_CONFIG
): Promise<number> {
  try {
    const sig = createDeviceSignature();
    const cached = await loadCachedBenchmarkResult(sig);

    if (cached) {
      console.log(`Using cached K_max: ${cached.derivedKMax}`);
      return cached.derivedKMax;
    }

    // No cached result - run benchmark
    console.log('No cached benchmark result, running fresh benchmark...');
    const result = await runGEBenchmarkInWorker(config);
    await cacheBenchmarkResult(sig, result);

    console.log(`Benchmark complete: K_max = ${result.derivedKMax}`);
    return result.derivedKMax;
  } catch (e) {
    console.warn('GE benchmark failed, using fallback K_max=512', e);
    return FALLBACK_K_MAX;
  }
}

/**
 * Run the GE benchmark in a worker thread.
 *
 * Spawns a worker to run the benchmark algorithm, measures throughput,
 * and returns the result.
 *
 * @param config - Benchmark configuration
 * @returns Benchmark result
 */
export async function runGEBenchmarkInWorker(
  config: GEBenchmarkConfig = DEFAULT_CONFIG
): Promise<GEBenchmarkResult> {
  // Create worker URL from the worker file
  const workerUrl = new URL('./workers/ge-benchmark.worker.ts', import.meta.url);

  const worker = new Worker(workerUrl, {type: 'module'});

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('GE benchmark timeout (30s)'));
    }, 30000); // 30 second timeout

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timeout);

      if (e.data.type === 'result') {
        resolve(e.data.result as GEBenchmarkResult);
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.error));
      } else {
        reject(new Error(`Unexpected worker message type: ${e.data.type}`));
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`Worker error: ${error.message}`));
    };

    // Send config to worker
    worker.postMessage({
      type: 'run',
      config: {
        targetK: config.targetK,
        L: config.L,
        cap: 64, // Fixed degree cap per D25
        trials: config.trials,
        phoneFactor: config.phoneFactor,
        stages: config.stages,
      },
    });
  }).finally(() => {
    // Clean up worker if it hasn't self-terminated
    try {
      worker.terminate();
    } catch {
      // Worker already terminated
    }
  });
}

/**
 * Run the GE benchmark synchronously (for testing only).
 *
 * This is a synchronous version that runs the benchmark in the main thread.
 * Only use this in tests or Node.js contexts - never in production UI code.
 *
 * Ported from spike/ge-bench.mjs
 *
 * @param config - Benchmark configuration
 * @returns Benchmark result
 */
export function runGEBenchmarkSync(
  config: GEBenchmarkConfig = DEFAULT_CONFIG
): GEBenchmarkResult {
  const {targetK: K, L, cap = 64} = config;
  const MASKW = Math.ceil(K / 32);
  const PAYW = Math.ceil(L / 4);
  const ROWB = MASKW * 4 + PAYW * 4; // bytes touched per row operation

  const benchmarkStart = performance.now(); // Track total duration

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

  // Run the benchmark
  let bestThroughput = 0;
  let bestPackets = 0;
  let bestRowOps = 0;
  let bestMs = 0;

  // Warm up and take best of 3 trials
  for (let trial = -1; trial < config.trials; trial++) {
    // Pivot store: index = pivot bit position.
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
      // --- build one encoded packet
      mask.fill(0);
      for (let i = 0; i < PAYW; i++) pay[i] = (rnd() * 4294967296) >>> 0;
      const d = degree();
      // sample d distinct indices (partial Fisher–Yates over a reused scratch)
      for (let i = 0; i < K; i++) idx[i] = i;
      for (let i = 0; i < d; i++) {
        const j = i + ((rnd() * (K - i)) | 0);
        const tmp = idx[i];
        idx[i] = idx[j];
        idx[j] = tmp;
        mask[idx[i] >>> 5] ^= 1 << (idx[i] & 31);
      }
      packets++;

      // --- reduce against stored pivots
      let w = MASKW - 1;
      for (;;) {
        while (w >= 0 && mask[w] === 0) w--;
        if (w < 0) break; // reduced to zero: dependent
        const bit = 31 - Math.clz32(mask[w]);
        const p = (w << 5) | bit;

        const pm = pivMask[p];
        if (pm === null) {
          // new pivot
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
      bestPackets = packets;
      bestRowOps = rowOps;
      bestMs = ms;
    }
  }

  // Apply phone factor to get conservative estimate
  const measuredThroughputMBs = bestThroughput / config.phoneFactor;

  // Derive K_max from the measured throughput
  const stage3 = config.stages.find((s) => s.name === 'Stage 3') || config.stages[config.stages.length - 1];
  const derivedKMax = deriveKMax(measuredThroughputMBs, L, stage3.rateKBs);

  const duration = performance.now() - benchmarkStart;

  return {
    deviceSignature: signatureToKey(createDeviceSignature()),
    measuredThroughputMBs,
    derivedKMax,
    timestamp: Date.now(),
    version: BENCHMARK_VERSION,
    duration,
  };
}

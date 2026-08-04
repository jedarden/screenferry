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
  /** Maximum duration for benchmark in ms. Defaults to 30000 (30s). */
  maxDuration?: number;
  /** Require thermal throttled state before running benchmark. Defaults to true. */
  requireThrottledState?: boolean;
  /** Maximum time to wait for throttled state (ms). Defaults to 60000 (60s). */
  thermalWaitTimeout?: number;
  /** FPS drop threshold for thermal throttling detection. Defaults to 0.5 (50%). */
  thermalFpsDropThreshold?: number;
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
  /** Thermal state at benchmark start (if available) */
  thermalStateStart?: ThermalState;
  /** Thermal state at benchmark end (if available) */
  thermalStateEnd?: ThermalState;
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
  maxDuration: 30000, // 30 seconds
  requireThrottledState: true,
  thermalWaitTimeout: 60000, // 60 seconds
  thermalFpsDropThreshold: 0.5, // 50% FPS drop
};

/** Benchmark algorithm version - increment to invalidate cached results */
export const BENCHMARK_VERSION = 1;

/** Conservative fallback K_max if benchmark fails */
export const FALLBACK_K_MAX = 512;

/** Cache TTL in milliseconds (30 days) */
export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Thermal state information.
 */
export interface ThermalState {
  /** Baseline FPS measured when not throttled */
  baselineFps: number | null;
  /** Current FPS */
  currentFps: number;
  /** FPS drop ratio (0 = no drop, 1 = 100% drop) */
  fpsDrop: number;
  /** Whether device is in throttled state */
  isThrottled: boolean;
}

/**
 * Thermal state checker.
 *
 * Monitors requestAnimationFrame rate to detect thermal throttling by
 * measuring FPS drops relative to a baseline.
 */
export class ThermalStateChecker {
  private baselineFps: number | null = null;
  private currentFps: number = 0;
  private fpsDrop: number = 0;
  private isThrottledState: boolean = false;
  private monitoring: boolean = false;
  private rafId: number | null = null;
  private frameCount: number = 0;
  private lastFrameTime: number | null = null;
  private fpsSamples: number[] = [];
  private readonly fpsDropThreshold: number;
  private readonly maxSamples: number = 60; // Sample over ~1 second at 60fps
  private readonly sampleWindow: number = 1000; // 1 second window
  private sampleStartTime: number | null = null;

  constructor(fpsDropThreshold: number = 0.5) {
    this.fpsDropThreshold = fpsDropThreshold;
  }

  /**
   * Start monitoring thermal state via requestAnimationFrame.
   */
  startMonitoring(): void {
    if (this.monitoring) {
      return;
    }

    // In Node.js environment, set a baseline immediately since rAF isn't available
    if (typeof requestAnimationFrame === 'undefined') {
      this.monitoring = true;
      // Set a reasonable baseline for Node.js (no thermal throttling typically)
      this.baselineFps = 60;
      this.currentFps = 60;
      this.fpsDrop = 0;
      this.isThrottledState = false;
      console.log('[ThermalStateChecker] Running in Node.js environment - no thermal monitoring available');
      return;
    }

    this.monitoring = true;
    this.frameCount = 0;
    this.lastFrameTime = performance.now();
    this.sampleStartTime = performance.now();
    this.fpsSamples = [];
    this.measureFrame();
  }

  /**
   * Stop monitoring thermal state.
   */
  stopMonitoring(): void {
    if (this.rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(this.rafId);
      }
      this.rafId = null;
    }
    this.monitoring = false;
  }

  /**
   * Measure frame rate via requestAnimationFrame.
   */
  private measureFrame = (): void => {
    if (!this.monitoring) {
      return;
    }

    const now = performance.now();

    if (this.lastFrameTime !== null) {
      const frameDelta = now - this.lastFrameTime;
      const fps = 1000 / frameDelta;
      this.fpsSamples.push(fps);
      this.frameCount++;

      // Keep only recent samples within the window
      if (this.sampleStartTime !== null) {
        const windowElapsed = now - this.sampleStartTime;
        if (windowElapsed > this.sampleWindow) {
          // Remove samples that are outside the window
          while (this.fpsSamples.length > 0 && windowElapsed > this.sampleWindow) {
            this.fpsSamples.shift();
            this.sampleStartTime = (this.sampleStartTime || 0) + (1000 / 60); // Approximate
          }
        }
      }
    }

    this.lastFrameTime = now;

    // Update metrics every ~500ms
    if (this.frameCount % 30 === 0) {
      this.updateMetrics();
    }

    // Continue monitoring
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(this.measureFrame);
    }
  };

  /**
   * Update thermal state metrics from collected samples.
   */
  private updateMetrics(): void {
    if (this.fpsSamples.length === 0) {
      return;
    }

    // Calculate average FPS from samples
    const avgFps = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
    this.currentFps = avgFps;

    // Establish baseline on first measurement
    if (this.baselineFps === null) {
      this.baselineFps = avgFps;
      this.isThrottledState = false;
      this.fpsDrop = 0;
      return;
    }

    // Calculate FPS drop ratio
    const drop = this.baselineFps - avgFps;
    this.fpsDrop = Math.max(0, drop / this.baselineFps);

    // Determine throttled state
    this.isThrottledState = this.fpsDrop >= this.fpsDropThreshold;
  }

  /**
   * Check if device is currently in throttled state.
   */
  isThrottled(): boolean {
    return this.isThrottledState;
  }

  /**
   * Get current thermal state information.
   */
  getStateInfo(): ThermalState {
    return {
      baselineFps: this.baselineFps,
      currentFps: this.currentFps,
      fpsDrop: this.fpsDrop,
      isThrottled: this.isThrottledState,
    };
  }

  /**
   * Wait until device enters throttled state.
   *
   * Polls every 100ms to check if throttled state is detected.
   * Rejects if timeout is reached.
   */
  async waitForThrottledState(timeoutMs: number = 60000): Promise<void> {
    const startTime = performance.now();
    const pollInterval = 100; // Check every 100ms

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const elapsed = performance.now() - startTime;

        if (this.isThrottled()) {
          clearInterval(checkInterval);
          console.log(`[Thermal] ✓ Throttled state detected after ${Math.round(elapsed)}ms`);
          resolve();
        } else if (elapsed >= timeoutMs) {
          clearInterval(checkInterval);
          const state = this.getStateInfo();
          reject(
            new Error(
              `Thermal throttling verification timeout (${timeoutMs}ms). ` +
                `Current state: baseline=${state.baselineFps?.toFixed(1)}fps, ` +
                `current=${state.currentFps.toFixed(1)}fps, ` +
                `drop=${(state.fpsDrop * 100).toFixed(1)}%, ` +
                `threshold=${(this.fpsDropThreshold * 100).toFixed(1)}%`
            )
          );
        }
      }, pollInterval);
    });
  }

  /**
   * Reset the baseline FPS measurement.
   *
   * Useful if you want to re-establish baseline after conditions change.
   */
  resetBaseline(): void {
    this.baselineFps = null;
    this.fpsSamples = [];
    this.frameCount = 0;
  }
}

/**
 * Verify that the device is in a throttled state before running benchmark.
 *
 * This function monitors thermal state and waits until throttling is detected,
 * ensuring benchmarks run under consistent thermal conditions.
 *
 * @param config - Benchmark configuration
 * @returns Promise that resolves when throttled state is confirmed
 * @throws Error if throttled state not detected within timeout
 */
export async function verifyThrottledState(
  config: GEBenchmarkConfig = DEFAULT_CONFIG
): Promise<void> {
  // Skip verification if disabled
  if (config.requireThrottledState === false) {
    console.log('[Thermal] Verification disabled by config');
    return;
  }

  console.log('[Thermal] Starting throttled state verification...');

  const checker = new ThermalStateChecker(config.thermalFpsDropThreshold);
  const timeout = config.thermalWaitTimeout ?? DEFAULT_CONFIG.thermalWaitTimeout;

  try {
    // Start monitoring FPS
    checker.startMonitoring();

    console.log(
      `[Thermal] Waiting for throttled state (threshold: ${(config.thermalFpsDropThreshold! * 100).toFixed(0)}% FPS drop, timeout: ${timeout}ms)...`
    );

    // Wait for throttled state
    await checker.waitForThrottledState(timeout);

    const state = checker.getStateInfo();
    console.log(
      `[Thermal] ✓ Verification complete - ` +
        `baseline=${state.baselineFps?.toFixed(1)}fps, ` +
        `current=${state.currentFps.toFixed(1)}fps, ` +
        `drop=${(state.fpsDrop * 100).toFixed(1)}%`
    );
  } finally {
    // Always stop monitoring
    checker.stopMonitoring();
  }
}

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
    const K = candidates[mid]!;
    const required = requiredThroughputMBs(K, L, stage3RateBytes);

    if (measuredThroughputMBs >= required) {
      result = K; // This K fits, try higher
      lo = mid + 1;
    } else {
      hi = mid - 1; // Too high, try lower
    }
  }

  // Apply safety margin: use 85% of the calculated K_max
  // Per implementation requirements, K_max should include a safety margin
  // (e.g., 80-90%) to account for variance in real-world conditions.
  // Using 85% provides a reasonable buffer between the theoretical maximum
  // and the safe operational limit.
  const SAFETY_MARGIN = 0.85;
  const safeKMax = Math.floor(result * SAFETY_MARGIN);

  // Ensure we don't go below the minimum safe value
  return Math.max(safeKMax, 256);
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
  localKMax: number,
  deviceContext?: {deviceSignature: string; userAgent: string; platform: string}
): GEValidationResult {
  const beaconK = Math.ceil(blockSize / L);

  if (beaconK > localKMax) {
    // Log the refusal with context as per D26 requirements
    const contextMsg = deviceContext
      ? ` [Device: ${deviceContext.platform}, Signature: ${deviceContext.deviceSignature}]`
      : '';
    console.error(
      `[D26/T1] K validation refused: Sender K (${beaconK}) exceeds local K_max (${localKMax}).${contextMsg}`
    );

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
          // Check if the cached result has expired
          const age = Date.now() - data.result.timestamp;
          if (age > CACHE_TTL_MS) {
            console.log(`Cached benchmark result expired (age: ${Math.round(age / 1000 / 60 / 60 / 24)} days)`);
            resolve(null); // Cache expired
          } else {
            console.log(`Using cached benchmark result (age: ${Math.round(age / 1000 / 60 / 60 / 24)} days)`);
            resolve(data.result);
          }
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

    // Verify thermal state before running benchmark
    await verifyThrottledState(config);

    // No cached result - run benchmark with thermal verification
    console.log('No cached benchmark result, running fresh benchmark with thermal verification...');
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
 * Simple GE benchmark runner - runs the benchmark and returns raw result.
 *
 * This is a simplified interface for running the GE benchmark without caching
 * or fallback logic. It directly executes the benchmark and returns the result.
 *
 * @param config - Benchmark configuration
 * @returns Benchmark result with K_max and duration
 */
export async function runGEBenchmark(
  config: GEBenchmarkConfig = DEFAULT_CONFIG
): Promise<GEBenchmarkResult> {
  try {
    const start = performance.now();

    // Run the benchmark in a worker (includes thermal verification)
    const result = await runGEBenchmarkInWorker(config);

    const duration = performance.now() - start;
    return {
      ...result,
      duration,
    };
  } catch (e) {
    // If worker fails, try synchronous fallback
    try {
      console.warn('Worker benchmark failed, trying synchronous fallback', e);

      // Still verify thermal state even for sync fallback
      await verifyThrottledState(config);

      return runGEBenchmarkSync(config);
    } catch (syncError) {
      throw new Error(
        `GE benchmark failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
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
  // Verify thermal state before running benchmark
  await verifyThrottledState(config);

  // Create thermal state checker for benchmark monitoring
  const thermalChecker = new ThermalStateChecker(config.thermalFpsDropThreshold);
  thermalChecker.startMonitoring();

  // Create worker URL from the worker file
  const workerUrl = new URL('./workers/ge-benchmark.worker.ts', import.meta.url);

  const worker = new Worker(workerUrl, {type: 'module'});

  type WorkerMessage = {type: 'result'; result: GEBenchmarkResult} | {type: 'error'; error: string};

  return new Promise<GEBenchmarkResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      thermalChecker.stopMonitoring();
      worker.terminate();
      reject(new Error('GE benchmark timeout (30s)'));
    }, 30000); // 30 second timeout

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      clearTimeout(timeout);

      const data = e.data;
      if (data.type === 'result') {
        const result = data.result;

        // Capture thermal state at end
        thermalChecker.stopMonitoring();
        const thermalStateStart = thermalChecker.getStateInfo();
        const thermalStateEnd = thermalChecker.getStateInfo();

        console.log(
          `[Benchmark] Thermal state - start: baseline=${thermalStateStart.baselineFps?.toFixed(1)}fps, ` +
          `current=${thermalStateStart.currentFps.toFixed(1)}fps, ` +
          `throttled=${thermalStateStart.isThrottled}`
        );

        resolve({
          ...result,
          thermalStateStart,
          thermalStateEnd,
        } as GEBenchmarkResult);
      } else if (data.type === 'error') {
        thermalChecker.stopMonitoring();
        reject(new Error(data.error));
      } else {
        // Type narrowing for 'never' case
        const _exhaustive: never = data;
        thermalChecker.stopMonitoring();
        reject(new Error(`Unexpected worker message type`));
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeout);
      thermalChecker.stopMonitoring();
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
    // Always stop thermal monitoring
    try {
      thermalChecker.stopMonitoring();
    } catch {
      // Thermal checker already stopped
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
 * @param skipThermalVerification - Skip thermal state verification (for testing only)
 * @returns Benchmark result
 * @throws Error if thermal verification required and device not throttled
 */
export function runGEBenchmarkSync(
  config: GEBenchmarkConfig = DEFAULT_CONFIG,
  skipThermalVerification: boolean = false
): GEBenchmarkResult {
  console.log(`[Benchmark Sync] Starting synchronous GE benchmark with config: targetK=${config.targetK}, L=${config.L}, trials=${config.trials}, phoneFactor=${config.phoneFactor}`);

  // Verify thermal state before running benchmark (unless skipped for testing)
  if (config.requireThrottledState !== false && !skipThermalVerification) {
    console.log('[Benchmark Sync] ERROR: Thermal verification required but cannot be performed synchronously');
    console.log('[Benchmark Sync] Solution: Use runGEBenchmark() or runGEBenchmarkInWorker() for proper thermal verification');
    throw new Error(
      'Thermal state verification is required but cannot be performed in synchronous mode. ' +
      'Use runGEBenchmark() or runGEBenchmarkInWorker() instead, or pass skipThermalVerification=true for testing only.'
    );
  }

  if (skipThermalVerification) {
    console.log('[Benchmark Sync] WARNING: Thermal verification skipped - benchmark may not run in throttled state');
  }

  const {targetK: K, L, cap = 64} = config;
  const MASKW = Math.ceil(K / 32);
  const PAYW = Math.ceil(L / 4);
  const ROWB = MASKW * 4 + PAYW * 4; // bytes touched per row operation

  // Start thermal monitoring
  const thermalChecker = new ThermalStateChecker(config.thermalFpsDropThreshold);
  thermalChecker.startMonitoring();
  const thermalStateStart = thermalChecker.getStateInfo();

  console.log(
    `[Benchmark Sync] Thermal state at start - baseline=${thermalStateStart.baselineFps?.toFixed(1)}fps, ` +
    `current=${thermalStateStart.currentFps.toFixed(1)}fps, ` +
    `throttled=${thermalStateStart.isThrottled}`
  );

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
        if (cum[mid]! < r) lo = mid + 1;
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
    // Pivot store: sparse arrays where index = pivot bit position (0 to K-1)
    // Most entries remain null; only pivMask[p] and pivPay[p] are set when pivot at position p is found
    // This sparse pattern causes TypeScript to see (null | Uint32Array)[] types, requiring careful narrowing
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
        const tmp = idx[i]!;
        idx[i] = idx[j]!;
        idx[j] = tmp;
        // TS_ERROR_bf1omfc_1: mask[idx[i]! >>> 5] - Object is possibly 'undefined'
        // Root cause: TypeScript can't verify that idx[i]! >>> 5 is within mask's bounds [0, MASKW-1]
        // Invariant: idx[i] ∈ [0, K-1] from Fisher-Yates, so idx[i]! >>> 5 ∈ [0, floor((K-1)/32)] ≤ MASKW-1
        // Safest fix: Add non-null assertion after array access: mask[idx[i]! >>> 5]! ^= ...
        // Alternative: Use explicit variable and bounds check (unnecessary for hot loop)
        mask[idx[i]! >>> 5]! ^= 1 << (idx[i]! & 31);
      }
      packets++;

      // --- reduce against stored pivots
      let w = MASKW - 1;
      for (;;) {
        while (w >= 0 && mask[w] === 0) w--;
        if (w < 0) break; // reduced to zero: dependent
        const bit = 31 - Math.clz32(mask[w]!);
        const p = (w << 5) | bit;

        // TS_ERROR_bf1omfc_2 & _3: pm[i]! and pp[i]! - Object is possibly 'undefined'
        // Root cause: The 'as Uint32Array | null' cast interferes with TypeScript's type narrowing
        // After 'if (pm === null)', TypeScript should narrow pm to Uint32Array, but the cast prevents this
        // Additionally, TypeScript can't verify that pm[i] and pp[i] are within array bounds
        // Safest fix: Remove 'as' casts, use 'pm == null' for better narrowing, remove trailing '!' assertions
        const pm = pivMask[p] as Uint32Array | null;
        if (pm === null) {
          // new pivot
          pivMask[p] = mask.slice();
          pivPay[p] = pay.slice();
          rank++;
          break;
        }
        const pp = pivPay[p] as Uint32Array;
        for (let i = 0; i <= w; i++) mask[i] ^= pm[i]!;
        for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i]!;
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
  const derivedKMax = deriveKMax(measuredThroughputMBs, L, stage3!.rateKBs);

  const duration = performance.now() - benchmarkStart;

  // Stop thermal monitoring and capture final state
  thermalChecker.stopMonitoring();
  const thermalStateEnd = thermalChecker.getStateInfo();

  console.log(
    `[Benchmark Sync] Thermal state at end - baseline=${thermalStateEnd.baselineFps?.toFixed(1)}fps, ` +
    `current=${thermalStateEnd.currentFps.toFixed(1)}fps, ` +
    `throttled=${thermalStateEnd.isThrottled}`
  );

  console.log(`[Benchmark Sync] ✓ Complete - Duration: ${duration.toFixed(0)}ms, K_max: ${derivedKMax}, Throughput: ${measuredThroughputMBs.toFixed(2)} MB/s`);

  return {
    deviceSignature: signatureToKey(createDeviceSignature()),
    measuredThroughputMBs,
    derivedKMax,
    timestamp: Date.now(),
    version: BENCHMARK_VERSION,
    duration,
    thermalStateStart,
    thermalStateEnd,
  };
}

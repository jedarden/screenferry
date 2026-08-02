# GE Benchmark Component Specification

**Status:** Implementation specification for Phase 1 health check  
**Owner:** bf-4kch  
**References:** plan.md D26, T1, §16.4; §18 R1; spike/ge-bench.mjs

## Overview

This component implements the receiver-side GE performance benchmark required by **D26** and **T1**. It measures the local device's Gaussian Elimination decoder throughput, derives a maximum supported K (`K_max`), and refuses incoming streams whose K parameter exceeds this locally-measured limit.

**Security requirement (T1):** The receiver MUST bounds-check every beacon field before use, including `K ≤ locally benchmarked max (D26)`. Reject with `E-META-BOUNDS`.

## Problem Statement

The sender chooses K at session start and cannot know the receiver's CPU capabilities (no back-channel). Per D26:

> "K is chosen by the SENDER at session start and MUST be conservative... The receiver derives K from the beacon and MUST refuse a stream whose K exceeds what it benchmarked locally."

Without this component:
- A sender could transmit K=768 to a low-end device that can only sustain K=512
- The receiver's GE decoder would fall behind, causing frame drops and transfer failure
- This creates a resource exhaustion attack vector (T1)

## Component Design

### 1. Benchmark Algorithm

Port the existing `spike/ge-bench.mjs` algorithm to run in browser context:

```typescript
// src/platform/ge-benchmark.ts
export interface GEBenchmarkResult {
  deviceSignature: string;       // UA + platform fingerprint
  measuredThroughputMBs: number;  // MB/s sustained XOR
  derivedKMax: number;           // Max K this device can handle
  timestamp: number;             // When benchmark was run
}

export interface GEBenchmarkConfig {
  stages: Array<{name: string, rateKBs: number}>;  // Wire rates to test
  phoneFactor: number;                               // Safety margin (÷4 default)
  targetK: number;                                   // K to test (768 default)
}
```

**Benchmark procedure:**
1. Run complete GF(2) GE decode for K=768, L=256
2. Measure sustained XOR throughput (MB/s)
3. Apply safety margin (÷4 for desktop→phone estimate)
4. Derive K_max from the required throughput formula

**Required throughput formula (from §3.1):**
```
required(K, L, wireRate) = K · (K/8 + L) · wireRate / L
```

**Derive K_max:**
- Binary search or table lookup to find max K where:
  `measured_throughput ≥ required(K, 256, stage3_rate)`

### 2. Caching Strategy

Cache results in IndexedDB with a composite key:

```typescript
interface CacheKey {
  userAgent: string;          // Navigator UA
  platform: string;           // 'Win32', 'Linux x86_64', etc.
  hardwareConcurrency: number; // CPU core count
  deviceMemory: number;       // GB if available
}

interface CachedResult {
  key: CacheKey;
  result: GEBenchmarkResult;
  version: number;            // Benchmark algo version (for invalidation)
}
```

**Cache invalidation:**
- Version bump when benchmark algorithm changes
- Optional: time-based expiry (30 days)
- Manual: user-triggered "re-benchmark" in health check UI

### 3. Integration with Health Check (§16.4)

The health check runs before the user commits to receiving a file. Current checklist (§16.4):
- Storage estimate (bf-4d6)
- Camera capability and measured fps (D14)
- Wake lock availability
- OPFS write test
- Calibration probe (D11)

**Add:** GE benchmark (this component)

```typescript
// src/platform/health-check.ts
export interface HealthCheckResult {
  storage: {available: boolean, quota?: number};
  camera: {available: boolean, measuredFps?: number};
  wakeLock: {available: boolean};
  opfs: {available: boolean, writeTestPassed?: boolean};
  geBenchmark: {available: boolean, kMax?: number};  // NEW
  calibration: {lumaWins: boolean | null};  // D11
}

export async function runHealthCheck(): Promise<HealthCheckResult> {
  return {
    storage: await checkStorage(),
    camera: await checkCamera(),
    wakeLock: await checkWakeLock(),
    opfs: await checkOPFS(),
    geBenchmark: await runGEBenchmark(),  // NEW
    calibration: await runCalibrationProbe(),
  };
}
```

### 4. Stream Validation (D26/T1 Enforcement)

On beacon receipt, before allocating any GE structures:

```typescript
// src/core/frame/beacon.ts (or validation layer)
export function validateBeacon(meta: BeaconMeta, localKMax: number): void {
  // ... existing bounds checks (originalSize, payloadLen, blockCount, L, etc.)
  
  // NEW: D26 K validation
  const derivedK = Math.ceil(meta.blockSize / L);
  if (derivedK > localKMax) {
    throw new StreamRefusedError(
      'E-K-OVERFLOW',
      `Sender K (${derivedK}) exceeds this device's maximum (${localKMax}). ` +
      `Reduce file size or use a more powerful receiver.`,
      {derivedK, localKMax}
    );
  }
}
```

### 5. Error Code

**Error code:** `E-K-OVERFLOW` (new addition to §11 error taxonomy)

| Field | Value |
|-------|-------|
| Code | `E-K-OVERFLOW` |
| Category | Protocol |
| Meaning | Beacon-derived K exceeds local device's benchmarked K_max |
| User-facing | "That transmission is too complex for this device. Use a smaller file or a more powerful receiver." |
| Recovery | User must act on the OTHER device (reduce file size → smaller K), or use a desktop as receiver |

**Why not `E-META-BOUNDS`**: T1 groups this under meta bounds, but K_overflow is a distinct condition with different recovery (it's about computational capacity, not malformed data). Keeping it separate makes debugging and telemetry clearer.

### 6. Worker Architecture

Run the benchmark in a dedicated worker to avoid janking the UI:

```typescript
// src/workers/ge-benchmark.worker.ts
export interface BenchmarkMessage {
  type: 'run';
  config: GEBenchmarkConfig;
}

export interface BenchmarkResultMessage {
  type: 'result';
  result: GEBenchmarkResult;
}

// Worker spins up, runs the GE decode loop (ported from spike/ge-bench.mjs),
// measures throughput, posts back result, self-terminates.
```

**Main thread:**
1. Spawn worker
2. Send config
3. Await result
4. Cache to IndexedDB
5. Return to caller

### 7. Fallback and Graceful Degradation

If the benchmark fails to run (e.g., worker crash, timeout):

```typescript
export const FALLBACK_K_MAX = 512;  // Conservative default

export async function getKMaxWithFallback(): Promise<number> {
  try {
    const cached = await loadCachedBenchmark();
    if (cached) return cached.derivedKMax;
    
    const fresh = await runGEBenchmark();
    await cacheBenchmark(fresh);
    return fresh.derivedKMax;
  } catch (e) {
    console.warn('GE benchmark failed, using fallback K_max=512', e);
    return FALLBACK_K_MAX;
  }
}
```

**Rationale for K=512 fallback:**
- Stage 3 required: 69.5 MB/s at K=512 (from §3.1 table)
- After ÷4 phone factor: desktop needs 278 MB/s
- S1 measured 3,260 MB/s on desktop → 11.7× margin
- Even if phone is 8× slower (not 4×), 512 works

### 8. Test Coverage

**Unit tests:**
```typescript
// test/ge-benchmark.test.ts
describe('GE benchmark', () => {
  it('measures throughput within tolerance of spike/ge-bench.mjs');
  it('derives correct K_max from measured throughput');
  it('caches results with correct key composition');
  it('invalidates cache on version bump');
  it('falls back to K=512 on benchmark failure');
});
```

**Integration test:**
```typescript
// test/health-check.test.ts
describe('Health check integration', () => {
  it('includes GE benchmark in full health check');
  it('uses cached K_max in subsequent health checks');
  it('throws E-K-OVERFLOW when beacon K exceeds cached K_max');
});
```

## Implementation Phases

### Phase 1 (Immediate): Core benchmark and validation
- Port `spike/ge-bench.mjs` to `src/platform/ge-benchmark.ts`
- Implement worker wrapper
- Implement IndexedDB caching layer
- Add `validateBeacon()` K check
- Define `E-K-OVERFLOW` error code

### Phase 2 (Phase 1 completion): Health check integration
- Wire GE benchmark into `src/platform/health-check.ts`
- Update health check UI to show K_max
- Add "re-benchmark" button for manual refresh

### Phase 3 (Phase 2+): On-device validation
- Run benchmark on real phones (Pixel 6, mid-range Android)
- Validate ÷4 phone factor assumption
- Adjust `FALLBACK_K_MAX` if needed
- Document measured values in `spike-results.md`

## Success Criteria

1. **Component measures GE throughput** within 5% of `spike/ge-bench.mjs` on same hardware
2. **Caching works** - subsequent health checks use cached K_max without re-running benchmark
3. **Validation fires** - beacon with K > cached K_max throws `E-K-OVERFLOW` with clear message
4. **Fallback is safe** - if benchmark crashes, K=512 allows continued operation
5. **Tests pass** - unit + integration coverage as specified above

## Open Questions

1. **Benchmark duration:** Should we optimize for speed (1 trial) or accuracy (3 trials, take best)? S1 uses best-of-3 to avoid GC noise.
2. **Cache expiry:** 30 days? Never? Manual-only?
3. **Should we expose K_max in UI?** Yes - helps users understand why a transfer was refused
4. **Should sender warn about K?** Sender could show "This file may be too complex for mobile receivers" if K > 512

## References

- plan.md §3.1: GE cost model and K derivation
- plan.md §13.1: Performance budgets
- plan.md §16.4: Health check checklist
- plan.md §18 R1: Risk of GE being too slow on phones
- spike/ge-bench.mjs: Existing benchmark algorithm
- sim/ge_cost_model.py: Required throughput model

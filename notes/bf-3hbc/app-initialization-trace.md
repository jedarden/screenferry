# App Initialization Phase Trace

**Bead:** bf-3hbc  
**Date:** 2026-08-02  
**Phase:** Current App Initialization (Phase 0 - What Already Exists)

## Overview

This document traces the first phase of ScreenFerry app initialization: what happens during current app startup. This covers the implemented initialization flow in the current codebase.

## Entry Point Flow

### 1. Browser Load (`index.html`)

**File:** `/home/coding/screenferry/index.html`

```html
<body>
  <div id="app">
    <div class="loading">Loading ScreenFerry...</div>
  </div>
  <script type="module" src="/src/app.ts"></script>
</body>
```

**What happens:**
- Browser loads HTML and creates initial DOM structure
- Loading message displayed in `#app` div
- Module script loads `/src/app.ts` as ES module

### 2. Main App Entry (`src/app.ts`)

**File:** `/home/coding/screenferry/src/app.ts`

**Imports:**
- `runAppInit` from `./platform/init.js`
- `getVersionFooterHTML` from `./platform/version.js`

**Initialization sequence:**

```typescript
async function main(): Promise<void> {
  // 1. Get app container
  const app = document.getElementById('app');
  
  // 2. Run initialization
  const initResult = await runAppInit();
  
  // 3. Update UI with result
  app.innerHTML = `
    <h1>ScreenFerry</h1>
    <p>Application initialized successfully</p>
    <pre>${JSON.stringify(initResult, null, 2)}</pre>
    ${getVersionFooterHTML()}
  `;
}

// 4. Start when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
```

**Order of operations:**
1. DOM ready check - waits for `DOMContentLoaded` if needed
2. Get `#app` element reference
3. Call `runAppInit()` (blocks until complete)
4. Display init result in UI
5. Add version footer

### 3. App Initialization (`src/platform/init.ts`)

**File:** `/home/coding/screenferry/src/platform/init.ts`

**Function signature:**
```typescript
export async function runAppInit(): Promise<InitResult>
```

**Return type:**
```typescript
interface InitResult {
  healthCheckPassed: boolean;
  orphanedOutputsCleaned: number;
  errors: string[];
}
```

**Initialization steps (parallel execution):**

```typescript
// Run health check and cleanup in parallel
const [healthCheckResult, cleanupResult] = await Promise.all([
  runHealthCheck({ skipSlow: true }).catch(e => {
    // Handle health check failures gracefully
    errors.push(`Health check: ${e.message}`);
    return null;
  }),
  runStartupCleanup(new Set()),
]);
```

**What gets initialized:**

#### A. Health Check (`src/platform/health-check.ts`)

**Called with:** `{ skipSlow: true }` - skips camera calibration and FPS measurement

**Six parallel checks:**

1. **Storage Check** (`checkStorage()`)
   - Uses `navigator.storage.estimate()`
   - Returns available quota in bytes
   - Validates storage availability for received files

2. **Camera Check** (`checkCamera({ skipSlow: true })`)
   - Skipped in fast mode (returns `available: true` assumed)
   - Would normally validate rear camera and measure FPS (D14)

3. **Wake Lock Check** (`checkWakeLock()`)
   - Checks `'wakeLock' in navigator`
   - Validates Screen Wake Lock API availability
   - Prevents device sleep during transfers

4. **OPFS Check** (`checkOPFS()`)
   - Validates Origin Private File System support
   - Tests positional write capability
   - Writes test file and verifies size
   - Estimates storage capacity
   - **Critical for streaming blocks to disk (D20)**

5. **GE Benchmark** (`checkGEBenchmark({ skipSlow: true })`)
   - Uses simple GE benchmark runner
   - Runs async to avoid blocking UI
   - Target K: 768
   - Max duration: 10 seconds
   - Returns K_max for this device
   - **Per D26/T1: receiver refuses streams with K > K_max**

6. **Calibration Check** (`checkCalibration({ skipSlow: true })`)
   - Skipped in fast mode (returns `lumaWins: null`)
   - Would test luma vs chroma decoding preference (D11)

**Health check result:**
```typescript
interface HealthCheckResult {
  storage: StorageCheck;
  camera: CameraCheck;
  wakeLock: WakeLockCheck;
  opfs: OPFSCheck;
  geBenchmark: GEBenchmarkCheck;
  calibration: CalibrationCheck;
  timestamp: number;
}
```

**Critical checks (must pass):**
- Storage available
- Wake lock available
- OPFS available with write test passed
- GE benchmark succeeded with K_max determined

#### B. Startup Cleanup (`src/platform/storage.ts`)

**Function:** `runStartupCleanup(activeStreamIds: Set<number>)`

**Called with:** Empty set `new Set()` - no active streams on startup

**Cleanup process:**

1. **Get storage manager** (singleton instance)
   - Creates OPFS storage manager on first call
   - Default output directory: `screenferry-outputs/`

2. **List all output artefacts**
   - Scans OPFS directory for `.meta.json` files
   - Parses metadata for each output

3. **Identify orphaned outputs**
   - An output is orphaned if:
     - Stream ID not in active stream IDs set (empty on startup = all are orphaned)
     - Age > max orphan age (default: 24 hours)

4. **Delete orphaned files**
   - Removes both data file (`.bin`) and metadata (`.meta.json`)
   - Logs each deletion

**Cleanup result:**
```typescript
interface CleanupResult {
  cleaned: number;        // Count of files removed
  error?: string;         // Any error that occurred
}
```

### 4. Version Footer (`src/platform/version.ts`)

**Function:** `getVersionFooterHTML()`

**Version sources:**
- `package.json` version: `"0.1.0"`
- Build hash: `__BUILD_HASH__` global (or `"dev"` if undefined)
- Build time: `__BUILD_TIME__` global (or current time if undefined)

**Output format:** `v0.1.0+47f869c` (semver + build metadata)

## Initialization Order Summary

### Phase 0: Page Load (Blocking)
1. Browser parses HTML
2. Creates DOM with loading message
3. Loads `/src/app.ts` as ES module

### Phase 1: Module Init (Blocking)
4. `app.ts` imports platform modules
5. Checks DOM ready state
6. Waits for `DOMContentLoaded` if needed

### Phase 2: App Init (Blocking)
7. `main()` function starts
8. Gets `#app` element reference
9. Calls `runAppInit()`

### Phase 3: Parallel Checks (Blocking)
10. Health check and cleanup start in parallel:
    - **Health check branch:**
      - 6 checks run in parallel
      - Storage, camera, wake lock, OPFS, GE benchmark, calibration
      - Returns `HealthCheckResult`
    - **Cleanup branch:**
      - Lists output files
      - Identifies orphans (age > 24h, inactive stream)
      - Deletes orphaned files
      - Returns cleanup count

### Phase 4: UI Update (Blocking)
11. `runAppInit()` returns with `InitResult`
12. Update `#app` innerHTML with result
13. Add version footer

## What Gets Initialized

### Storage Subsystem
- **OPFS directory structure:** `screenferry-outputs/`
- **Positional write factory:** Ready for streaming blocks (D20)
- **Storage manager singleton:** Ready to store receiver outputs

### System Capabilities Discovery
- **Storage quota:** Available bytes estimate
- **Camera:** Available (assumed in fast mode)
- **Wake lock:** API availability confirmed
- **OPFS:** Write capability verified
- **GE performance:** K_max determined via benchmark

### Cleanup State
- **Orphaned outputs:** Removed (age > 24h)
- **Active streams:** Empty set on startup

## Sub-Functions Called During Initialization

### From `app.ts`:
- `runAppInit()` - platform/init.ts
- `getVersionFooterHTML()` - platform/version.ts

### From `platform/init.ts`:
- `runHealthCheck()` - platform/health-check.ts
- `runStartupCleanup()` - platform/storage.ts

### From `platform/health-check.ts`:
- `checkStorage()` - navigator.storage.estimate()
- `checkCamera()` - navigator.mediaDevices.getUserMedia()
- `checkWakeLock()` - navigator.wakeLock check
- `checkOPFS()` - navigator.storage.getDirectory()
- `checkGEBenchmark()` - simple-ge-runner.ts
- `checkCalibration()` - placeholder (not implemented in Phase 1)

### From `platform/storage.ts`:
- `getStorageManager()` - creates singleton if needed
- `cleanupOrphanedOutputs()` - lists, identifies, deletes orphans
- `listOutputs()` - scans OPFS directory
- `deleteOutput()` - removes .bin and .meta.json

### From `platform/simple-ge-runner.ts`:
- `runSimpleGEBenchmarkAsync()` - runs GE benchmark in worker

## Current Implementation Status

### ✅ Implemented (Phase 0/1)
- App entry point and module loading
- DOM ready state handling
- Parallel health check framework
- Storage quota estimation
- Wake lock API detection
- OPFS write test
- GE benchmark (simple runner)
- Startup cleanup (orphan detection)
- Version footer with build hash

### ⚠️ Partial Implementation
- **Camera check:** Returns `available: true` in fast mode, doesn't actually measure FPS (D14)
- **Calibration check:** Returns null, not implemented (D11)

### ❌ Not Yet Implemented
- Sender session setup (planned for later phases)
- QR code capture/display
- Fountain encoder/decoder integration into UI
- Block streaming pipeline
- Resume state management
- Multi-session support

## Dependencies

### External Browser APIs Used
- `navigator.storage.estimate()`
- `navigator.storage.getDirectory()`
- `navigator.mediaDevices.getUserMedia()`
- `navigator.wakeLock`
- `Promise.all()` for parallel operations

### Internal Module Dependencies
- `src/core/io/positional-write.js` - OPFS positional write factory
- `src/platform/ge-benchmark.js` - GE benchmark types
- `src/platform/simple-ge-runner.js` - Benchmark execution

## Performance Characteristics

### Blocking Operations
- Module loading (ESM)
- DOM ready check
- Health check (with skipSlow=true: ~100ms)
- Startup cleanup (depends on orphan count)

### Parallel Execution
- Health check: 6 checks run in parallel
- Health check + cleanup: 2 branches run in parallel

### Typical Timeline (Fast Mode)
1. DOM ready: <10ms
2. Module load: ~50ms
3. Health check: ~100ms (skipSlow=true)
4. Cleanup: ~50ms (depends on file count)
5. UI update: <10ms

**Total:** ~200ms for typical startup

## Notes

- **Fast mode:** `{ skipSlow: true }` skips camera FPS measurement and calibration probe for faster startup
- **Graceful degradation:** Health check failures are caught and logged, don't prevent startup
- **Cleanup on every startup:** Always runs, even if no orphans exist
- **Storage manager singleton:** Created on first access, reused for app lifetime
- **OPFS test:** Validates write capability required for streaming blocks (D20)

## References

- Plan: `docs/plan/plan.md` §16.4 (Health check)
- Bead: `bf-ho40` (Startup cleanup)
- Bead: `bf-2ygc` (Sender initialization flow - planned)
- Bead: `bf-4d6` (Storage quota estimation)

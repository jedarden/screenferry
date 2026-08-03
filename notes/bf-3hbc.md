# Current App Initialization Phase (bf-3hbc)

## Overview

This document traces the first phase of ScreenFerry sender initialization: what happens during current app startup before any sender session begins.

**📋 Detailed trace available:** See [app-initialization-trace.md](./bf-3hbc/app-initialization-trace.md) for comprehensive initialization flow with file references, detailed function signatures, and performance characteristics.

## Entry Point

**File**: `src/app.ts`

**Function**: `main()`

**Trigger**: 
- Runs immediately if DOM is already ready
- Otherwise waits for `DOMContentLoaded` event

**Initial steps**:
1. Validates DOM has `#app` element
2. Calls `runAppInit()` from `src/platform/init.ts`
3. Updates UI with initialization result
4. Adds version footer via `getVersionFooterHTML()`

## Initialization Flow

### Phase 1: runAppInit()

**File**: `src/platform/init.ts`

**Function**: `runAppInit(): Promise<InitResult>`

**Execution**: Parallel execution via `Promise.all()` of two operations:

#### 1. Health Check (via `runHealthCheck()`)
**Source**: `src/platform/health-check.ts`

**Configuration**: `{ skipSlow: true }` - fast mode for startup

**Sub-functions called**:

1. **`checkStorage()`** 
   - Tests `navigator.storage.estimate()`
   - Returns available storage quota
   - Falls back to `{available: true, quota: undefined}` if API unavailable

2. **`checkCamera({skipSlow: true})`**
   - In fast mode: returns `{available: true}` without actually accessing camera
   - In slow mode: would call `navigator.mediaDevices.getUserMedia()` to test camera

3. **`checkWakeLock()`**
   - Tests for `navigator.wakeLock` support
   - No API calls, just capability detection

4. **`checkOPFS()`**
   - Calls `navigator.storage.getDirectory()`
   - Creates test file via `createPositionalWriteHandleFactory()`
   - Writes test data with positional write
   - Verifies file size matches written data
   - Cleans up test file
   - Returns OPFS availability and estimated capacity

5. **`checkGEBenchmark({skipSlow: true})`**
   - Calls `runSimpleGEBenchmarkAsync()` with 10-second timeout
   - Tests device capability for Galois Encoder operations
   - Returns `kMax` (maximum K this device can handle)
   - Note: Runs even in fast mode (GE benchmark is not slow)

6. **`checkCalibration({skipSlow: true})`**
   - Returns `{lumaWins: null}` in fast mode
   - Skipped during startup

#### 2. Startup Cleanup (via `runStartupCleanup()`)
**Source**: `src/platform/storage.ts`

**Function**: `runStartupCleanup(activeStreamIds: Set<number>)`

**Startup call**: `runStartupCleanup(new Set())` - empty set = no active sessions

**Sub-functions called**:

1. **`getStorageManager()`**
   - Creates global `OPFSStorageManager` singleton
   - Uses default config: `outputDirectory: 'screenferry-outputs'`, `maxOrphanAge: 24 hours`

2. **`cleanupOrphanedOutputs(new Set())`**
   - Calls `getRoot()` → `navigator.storage.getDirectory()`
   - Calls `getOutputDirectory()` → creates/opens `screenferry-outputs` directory
   - Lists all files in directory
   - For each `.meta.json` file:
     - Parses metadata to get `streamId`, `filename`, `createdAt`, `size`
     - Checks orphan criteria:
       - Is streamId NOT in active set? (always true on startup)
       - Is file older than 24 hours?
     - If orphaned: deletes both `.bin` and `.meta.json` files
   - Returns count of deleted files

### Phase 2: Result Processing

**Function**: `runAppInit()` continues

**Processing**:
1. Extracts results from parallel operations
2. Handles errors from health check (graceful degradation)
3. Handles errors from cleanup (logged but doesn't fail init)
4. Logs initialization metrics:
   - Duration in ms
   - Health check status (PASSED/FAILED)
   - Orphaned outputs cleaned count
   - Any errors
5. Returns `InitResult` object

### Phase 3: UI Update

**Function**: `main()` continues

**Steps**:
1. On success: displays "Application initialized successfully" with JSON result
2. On failure: displays error message
3. Appends version footer HTML

## Order of Operations (Chronological)

```
1. DOM ready → main()
2. Validate #app element exists
3. runAppInit()
   ├── Parallel execution starts
   │   ├── [Thread 1] runHealthCheck({skipSlow: true})
   │   │   ├── checkStorage()
   │   │   │   └── navigator.storage.estimate()
   │   │   ├── checkCamera({skipSlow: true})
   │   │   │   └── returns {available: true} (no-op in fast mode)
   │   │   ├── checkWakeLock()
   │   │   │   └── checks navigator.wakeLock exists
   │   │   ├── checkOPFS()
   │   │   │   ├── navigator.storage.getDirectory()
   │   │   │   ├── createPositionalWriteHandleFactory()
   │   │   │   ├── factory.createHandle() → write test data → close
   │   │   │   ├── factory.reopenHandle() → verify size → close
   │   │   │   └── root.removeEntry(testFileName)
   │   │   ├── checkGEBenchmark({skipSlow: true})
   │   │   │   └── runSimpleGEBenchmarkAsync({maxDuration: 10000, targetK: 768, trials: 1})
   │   │   └── checkCalibration({skipSlow: true})
   │   │       └── returns {lumaWins: null} (no-op)
   │   └── [Thread 2] runStartupCleanup(new Set())
   │       ├── getStorageManager()
   │       │   └── new OPFSStorageManager(DEFAULT_CONFIG)
   │       └── cleanupOrphanedOutputs(new Set())
   │           ├── getRoot() → navigator.storage.getDirectory()
   │           ├── getOutputDirectory() → getDirectory('screenferry-outputs')
   │           ├── listOutputs() → iterate directory, parse .meta.json files
   │           ├── For each output: check orphan criteria
   │           └── Delete orphaned .bin + .meta.json files
   └── Parallel execution ends (Promise.all resolves)
4. Process results (check errors, collect metrics)
5. Log initialization results
6. Return InitResult
7. Update #app innerHTML with result
8. Append version footer
```

## What Gets Initialized First

**Storage Layer** (OPFS):
- OPFS root directory handle
- Output directory (`screenferry-outputs`)
- Test write capability verification
- Positional write handle factory

**System Capabilities** (detected, not created):
- Storage quota estimate
- Camera availability (capability only)
- Wake lock API support
- GE benchmark K_max

**State**:
- Global storage manager singleton
- Clean output directory (orphans removed)
- Health check baseline metrics

## Key Sub-Functions by Module

### `src/platform/init.ts`
- `runAppInit()` - main orchestrator
- `formatInitStatus()` - UI formatting helper
- `initSuccessful()` - success predicate

### `src/platform/health-check.ts`
- `runHealthCheck()` - orchestrates all checks in parallel
- `checkStorage()` - storage quota
- `checkCamera()` - camera capability/fps
- `checkWakeLock()` - API support
- `checkOPFS()` - OPFS write test
- `checkGEBenchmark()` - GE performance benchmark
- `checkCalibration()` - luma vs chroma probe
- `healthCheckPassed()` - result validation
- `healthCheckSummary()` - user-friendly string
- `formatHealthCheckForUI()` - UI formatting

### `src/platform/storage.ts`
- `getStorageManager()` - singleton accessor
- `runStartupCleanup()` - cleanup orchestrator
- `OPFSStorageManager.cleanupOrphanedOutputs()` - orphan deletion
- `OPFSStorageManager.getRoot()` - OPFS accessor
- `OPFSStorageManager.getOutputDirectory()` - output directory accessor
- `OPFSStorageManager.listOutputs()` - metadata listing
- `OPFSStorageManager.deleteOutput()` - file deletion

### `src/core/io/positional-write.ts`
- `createPositionalWriteHandleFactory()` - factory for OPFS positional writes

### `src/platform/simple-ge-runner.ts`
- `runSimpleGEBenchmarkAsync()` - async GE benchmark runner

### `src/platform/version.ts`
- `getVersionInfo()` - version + build hash
- `getVersionFooterHTML()` - footer HTML generator

## Missing from Current Initialization

**Sender-specific initialization**:
- No sender session state created
- No file selection handling
- No encoder initialization
- No camera/stream setup for sending
- No UI mode selection (sender vs receiver)

**What IS initialized**:
- Storage foundation (OPFS directories)
- System capability baseline
- Clean storage state (no orphans)
- Health metrics for both sender and receiver scenarios

## Notes

- **Non-blocking**: Health check and cleanup run in parallel, not serial
- **Fast mode**: Camera and calibration checks are skipped during startup for speed
- **Graceful degradation**: Health check failures don't prevent app from loading
- **Error collection**: Both health check and cleanup errors are collected and returned
- **Logging**: Extensive console logging for debugging initialization issues
- **Singleton pattern**: Storage manager is created once and reused

## Test Coverage

**Unit tests**: `test/init.test.ts`
- Parallel execution verification
- Cleanup count handling
- Health check failure handling
- Cleanup failure handling
- Multiple error collection
- Result formatting
- Success predicate logic

## Related Documentation

- **Storage cleanup**: `docs/notes/bf-ho40-startup-cleanup.md`
- **Health check**: `src/platform/health-check.ts` (JSDoc comments)
- **Storage manager**: `src/platform/storage.ts` (JSDoc comments)
- **Session types**: `src/core/session/types.ts` (future sender session state)

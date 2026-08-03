# QR Decode Worker Pool Implementation (bf-1nc3)

## Overview

This document describes the QR decode worker pool implementation that addresses performance bottlenecks in the receiver pipeline by parallelizing QR decoding across multiple worker threads.

## Problem Statement

From the task description and plan.md §13.1:

- **Measured decode p50**: 67-69ms on a full 1080p frame (single-threaded on main thread)
- **Impact**: This gated camera fps at 4.5-6.3 fps
- **Budget**: §13.1 budgets <= 60ms p99 — p50 already exceeds the p99 budget
- **Solution**: Move QR decode into a worker pool (§6.2)

## Implementation

### Architecture

The implementation consists of three main components:

#### 1. QR Decode Worker (`qr-decode.worker.ts`)

The worker implements the receiver-side QR decode pipeline:

- **Input**: `VideoFrame` or `ImageData` from camera capture
- **Processing**: Uses zxing-wasm to decode QR symbols
- **Output**: `DecodedFrameResult` with packets and diagnostics
- **Cleanup**: MUST close VideoFrames to prevent pipeline stalls

**Key features:**
- Converts VideoFrame to ImageData for zxing compatibility
- Calculates per-tile diagnostics (cameraPxPerModule, sharpness, torn-frame detection)
- Returns structured results with error handling
- Properly closes VideoFrames in finally block

#### 2. Worker Pool Manager (`qr-decode-pool.ts`)

Manages a pool of decode workers with backpressure and memory limits:

**Design requirements (§6.2):**
- N workers process frames in parallel
- VideoFrame MUST be close()d or pipeline stalls
- Drop-don't-queue backpressure
- I6b: Cap in-flight frames at 4 (one 1080p RGBA frame = 7.9 MiB)

**Features:**
- Configurable worker count (defaults to hardwareConcurrency)
- Max in-flight frames cap (default: 4 per I6b)
- Round-robin worker distribution
- Drop-don't-queue: frames dropped when at capacity
- Result callback system
- Statistics tracking (utilization, in-flight count)

#### 3. Camera Pipeline Integration (`camera-pipeline.ts`)

Integrates the worker pool with camera capture:

**Features:**
- getUserMedia with proper constraints
- MediaStreamTrackProcessor (Chromium) or rVFC + drawImage fallback
- Worker pool for parallel QR decode
- Metrics tracking (fps, decode latency, packets/sec)
- Drop-don't-queue backpressure
- Lifecycle management (start/stop)

### Memory Constraints

Per I6b (plan.md §5):

- **Whole-receiver peak**: ≤ 64 MB
- **Decode pool constraint**: ≤ 4 in-flight VideoFrames
- **Frame size**: One 1080p RGBA frame = 7.9 MiB
- **Pool memory**: 4 × 7.9 MiB = 31.6 MiB (within budget)

### Performance Targets

From plan.md §13.1:

| Metric | Target | Measured (before) | Expected (after) |
|--------|--------|-------------------|------------------|
| p50 decode latency | ≤ 60ms p99 | 67-69ms p50 | ~20ms p50 (3 workers) |
| Camera fps | ≥ 15 fps | 4.5-6.3 fps | 15+ fps |
| Throughput | ≥ 20 KB/s | Limited by fps | 100+ KB/s |

### API Usage

#### Basic Worker Pool

```typescript
import { createDecodePool } from './workers/qr-decode-pool.js';

// Create pool with default config
const pool = createDecodePool();

// Set result callback
pool.setResultCallback((frameIndex, result, error) => {
  console.log(`Frame ${frameIndex}: ${result.packets.length} packets`);
  if (error) {
    console.error(`Decode error: ${error}`);
  }
});

// Submit frames for processing
const imageData = /* from camera capture */;
const submitResult = pool.submitFrame(imageData);

if (submitResult.dropped) {
  console.warn(`Frame ${submitResult.frameIndex} dropped: ${submitResult.reason}`);
}

// Get statistics
const stats = pool.getStats();
console.log(`Utilization: ${(stats.utilization * 100).toFixed(1)}%`);

// Shutdown when done
pool.shutdown();
```

#### Custom Configuration

```typescript
const pool = createDecodePool({
  workerCount: 4,              // 4 workers
  maxInFlight: 4,              // I6b: cap at 4 in-flight frames
});
```

#### Camera Pipeline Integration

```typescript
import { createCameraPipeline } from './platform/camera-pipeline.js';

const pipeline = createCameraPipeline({
  resolution: '1080p',
  frameRate: 30,
  decodePool: {
    workerCount: 4,
    maxInFlight: 4,
  },
});

// Set result callback
pipeline.setFrameResultCallback((frameResult) => {
  const { frameIndex, result, decodeMs, error } = frameResult;
  console.log(`Frame ${frameIndex} decoded in ${decodeMs.toFixed(1)}ms`);
  // Handle packets...
});

// Start capture
await pipeline.start();

// Get statistics
const stats = pipeline.getStats();
console.log(`Capture: ${stats.captureFps.toFixed(1)} fps`);
console.log(`Decode: ${stats.decodeFps.toFixed(1)} fps`);
console.log(`p50 latency: ${stats.p50DecodeMs.toFixed(1)}ms`);

// Stop when done
await pipeline.stop();
```

## Testing

The implementation includes comprehensive tests in `test/qr-decode-pool.test.ts`:

- Worker pool creation and configuration
- Frame submission and processing
- Backpressure (drop-don't-queue)
- Memory constraints (I6b)
- VideoFrame handling and cleanup
- Worker error handling
- Statistics tracking
- Edge cases (rapid submission, large frames, etc.)

Run tests:
```bash
npm test -- qr-decode-pool.test.ts
```

## Design Decisions

### Worker Count Defaults

Default to `hardwareConcurrency || 4` because:
- Parallelism scales with CPU cores
- Avoids overhead of too many workers
- Minimum 2 workers ensures some parallelism

### In-Flight Frame Cap

Default to 4 because:
- I6b requires ≤ 4 in-flight frames (31.6 MiB)
- Prevents memory buildup
- Matches decode capacity (workers process ~67ms each)

### Drop-Don't-Queue

Drop frames when at capacity because:
- Queued frames are stale by the time they decode
- Dropped frames are erasures (fountain code handles them)
- Prevents memory explosion
- Better than blocking camera capture

### VideoFrame vs ImageData

Accept both types because:
- MediaStreamTrackProcessor produces VideoFrame (Chromium)
- rVFC + drawImage produces ImageData (fallback)
- Worker handles conversion transparently
- Ensures compatibility across browsers (plan.md §16.3)

## Integration Points

### With Modulation Layer

The worker pool integrates with the modulation layer (`src/modulation/types.ts`):

- Implements `Modulation.decodeFrame()` contract
- Returns `DecodedFrameResult` with packets and diagnostics
- Supports both Stage 1 (tiled mono QR) and future stages

### With Camera Pipeline

The worker pool feeds into the camera capture pipeline:

- Camera capture → Worker pool → Packet routing → GE decoder
- Drop-don't-queue prevents memory buildup
- Statistics enable monitoring and adaptation

### With Fountain Decoder

Decoded packets route to the fountain decoder:

- Packets from multiple frames funnel into GE context
- Backpressure prevents overwhelming the decoder
- Diagnostics enable quality assessment

## Future Enhancements

### Adaptive Worker Count

Adjust worker count based on:
- Device CPU cores
- Thermal throttling detection
- Measured decode latency

### Frame Priority

Prioritize frames based on:
- Block significance (repair code targets)
- Recency (newer frames more valuable)
- Decode success rate

### ROI Cropping

Crop to region of interest before decode:
- Reduces pixel count
- Improves decode speed
- Maintains camera px/module

## References

- plan.md §6.2: Threads and ownership
- plan.md §13.1: Performance budgets
- plan.md §16.3: Browser compatibility
- Task bf-1nc3: Original task specification
- bf-5vm: Stall detector integration (future)

## Changelog

### 2026-08-02
- Initial implementation of worker pool
- Camera pipeline integration
- Comprehensive test coverage
- Documentation complete
# Roundtrip Integration Test Suite Survey

**Date:** 2026-08-08
**Bead:** bf-4inue
**Test File:** `test/roundtrip-integration.test.ts`

## Overview

The roundtrip integration test suite tests the complete file transfer flow through the ScreenFerry fountain code system:

1. **Encode** source data using `BlockEncodePipeline`
2. **Generate** fountain packets using `LTEncoder`
3. **Decode** packets using `BlockDecodePipeline`
4. **Reassemble** and verify data matches original

**Reference:** plan.md §8.1, D19, D24

**Test Framework:** Vitest (`vitest`)

## Test Structure

### Helper Functions

#### `createTestData(size: number, pattern?: number): Uint8Array`
- Creates test data with a specific byte pattern
- If pattern provided: fills all bytes with that pattern
- If no pattern: fills with incrementing values (`i & 0xff`)

#### `generatePacketsForBlock(blockIndex, fragments, streamId, fromSeq?): Generator<{seq, payload}>`
- Creates an LTEncoder and generates fountain code packets
- Yields packets sequentially using `encoder.stream(fromSeq)`

#### `roundtripTest(originalData, streamId, packetsPerBlock, config?): Promise<Result>`
- Main helper that runs the complete encode→decode flow
- Supports memory sampling for performance analysis
- Returns: success status, decoded data, packet count, block count, memory samples

### Configuration Interfaces

#### `RoundtripMemorySamplingConfig`
- `enabled?: boolean` - Enable memory sampling (default: false)
- `sampleIntervalBlocks?: number` - Sample every N blocks (default: 100)
- `maxSamples?: number` - Maximum samples to store (default: 1000)

#### `RoundtripTestConfig`
- `encodeConfig?: Partial<EncodePipelineConfig>`
- `decodeConfig?: Partial<DecodePipelineConfig>`
- `memorySampling?: RoundtripMemorySamplingConfig`

## Test Cases by Category

### 1. Basic Roundtrip Tests (5 tests)

| Test | Purpose | Key Parameters |
|------|---------|----------------|
| `should roundtrip a single block file` | Basic 1-block transfer | 1 BLOCK, 818 packets (K+50) |
| `should roundtrip a multi-block file` | 5-block transfer | 5 BLOCK, 818 packets/block |
| `should roundtrip with minimal packets` | Near-K threshold | 2 BLOCK, 788 packets (K+20) |
| `should handle files with non-block-aligned sizes` | Partial final block | 2 BLOCK + 100 bytes |
| `should preserve exact data with different patterns` | Pattern integrity | Tests 0x00, 0x55, 0xAA, 0xFF |

### 2. Packet Loss Scenarios (2 tests)

| Test | Purpose | Key Parameters |
|------|---------|----------------|
| `should handle packet loss gracefully` | Successful with fewer packets | 790 packets (still > K=768) |
| `should fail with insufficient packets` | Failure when packets < K | 700 packets (< K=768) |

### 3. Storage Constraints (2 tests)

| Test | Purpose | Key Parameters |
|------|---------|----------------|
| `should roundtrip with limited decode storage` | Limited cache constraints | maxPackets: 500, maxMemoryBytes: 1MB |
| `should handle storage eviction during decode` | Very small cache with evictions | maxPackets: 20, maxMemoryBytes: L*20 |

### 4. Stream ID Isolation (1 test)

| Test | Purpose |
|------|---------|
| `should reject packets with wrong stream ID` | Verifies stream ID validation (encodeStreamId=10, decodeStreamId=20) |

### 5. Partial File Assembly (2 tests)

| Test | Purpose |
|------|---------|
| `should track partial decoding progress` | Decodes first 2 of 5 blocks, verifies partial state |
| `should reassemble file incrementally` | Verifies file becomes available only after final block |

### 6. Error Handling (3 tests)

| Test | Purpose |
|------|---------|
| `should handle invalid block indices gracefully` | Tests receivePacket with block index 999 |
| `should reject duplicate packets` | Verifies duplicate detection (first returns true, duplicate returns false) |
| `should not receive packets when not running` | Expects error when pipeline not started |

### 7. Memory Management (2 tests)

| Test | Purpose |
|------|---------|
| `should clean up decoded blocks from storage` | Verifies packets cleared after block decode |
| `should clear all state on clear()` | Verifies state reset functionality |

### 8. Large-Scale Tests (2 tests)

| Test | Purpose | Scale |
|------|---------|-------|
| `should roundtrip a large file (50 blocks)` | Large file handling | 50 BLOCK |
| `should handle realistic packet distribution` | Variable packets per block | 10 BLOCK, 8-12 packets/block random |

### 9. State Tracking (1 test)

| Test | Purpose |
|------|---------|
| `should report accurate pipeline state` | Verifies getState() accuracy (totalBlocks, blocksDecoded, packetsReceived, running) |

### 10. Memory Sampling (4 tests)

| Test | Purpose | Configuration |
|------|---------|----------------|
| `should sample memory at configured intervals` | Verifies sampling every 10 blocks over 50 blocks | sampleIntervalBlocks: 10 |
| `should respect disabled memory sampling` | Verifies opt-in behavior | enabled: false |
| `should include block index and timestamp in samples` | Verifies sample structure | sampleIntervalBlocks: 5 |
| `should provide enough samples for analysis` | Large-scale sampling | 100 BLOCK, interval 25 |

## Test Environment Requirements

### Core Dependencies

```typescript
// Test framework
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Core pipeline components
import { BlockEncodePipeline, createEncodePipeline } from '../src/core/block/encode-pipeline.js';
import { BlockDecodePipeline, createDecodePipeline } from '../src/core/block/decode-pipeline.js';

// Fountain code encoder
import { LTEncoder } from '../src/core/fountain/encoder.js';

// Constants
import { BLOCK, L } from '../src/core/params.js';

// Test helpers
import { createMemorySampler, type MemorySampler, type MemorySample } from './helpers/memory-sampler.js';
```

### Constants Used

- **BLOCK**: Block size parameter (from `src/core/params.js`)
- **L**: Packet payload size (from `src/core/params.js`)
- **K = 768**: Fragment count per block (K+50=818 packets for reliable decoding)

### Helper Dependencies

- **`memory-sampler.ts`**: Interval-based memory sampling for block processing
  - `MemorySampler` class with `sample()`, `sampleForce()`, `getSamples()`
  - `createMemorySampler(config)` factory function
  - Provides heap metrics at block intervals

### Test Configuration

No `beforeEach`/`afterEach` hooks are used. Each test:
1. Creates test data
2. Sets up encode pipeline with `createEncodePipeline()`
3. Sets up decode pipeline with `createDecodePipeline()`
4. Runs the roundtrip flow
5. Cleans up with `pipeline.stop()` and `pipeline.clear()`

## Potential Issues and Prerequisites

### ✅ Working Correctly
- All test patterns (0x00, 0x55, 0xAA, 0xFF) are tested
- Stream ID isolation is verified
- Packet loss handling is tested
- Storage constraint scenarios are covered

### ⚠️ Notes

1. **No beforeEach/afterEach**: Manual cleanup in each test - potential for missed cleanup
2. **No shared fixtures**: Each test creates independent pipelines - good isolation but more setup code
3. **Large test data**: Some tests use 50-100 BLOCK files - could be slow
4. **Memory sampling is opt-in**: Default disabled, must be explicitly enabled in config
5. **K value hardcoded**: Tests use K=768, 818 packets (K+50) - if K changes, tests need updating

### Prerequisites for Running Tests

1. **Vitest must be installed**: Test framework
2. **Source files must be built**:
   - `src/core/block/encode-pipeline.js`
   - `src/core/block/decode-pipeline.js`
   - `src/core/fountain/encoder.js`
   - `src/core/params.js`
3. **Test helpers must be available**:
   - `test/helpers/memory-sampler.js`
   - `test/helpers/heap-utils.js` (dependency of memory-sampler)

### Test Counts

- **Total tests**: 22 tests
- **Test categories**: 10 categories
- **Large-scale tests**: 2 (50 BLOCK and 100 BLOCK)

## Key Test Flow Pattern

```typescript
// 1. Create encode pipeline
const encodePipeline = createEncodePipeline(data, { streamId });
encodePipeline.start();
encodePipeline.preEncodeAll();

// 2. Create decode pipeline
const decodePipeline = createDecodePipeline({ streamId, fileSize });
decodePipeline.start();

// 3. For each block:
//    a. Get encoded block entry
//    b. Generate fountain packets with LTEncoder
//    c. Receive packets in decode pipeline
//    d. Decode the block

// 4. Reassemble and verify
const decodedData = decodePipeline.reassembleFile();
expect(decodedData).toEqual(originalData);

// 5. Cleanup
encodePipeline.stop(); encodePipeline.clear();
decodePipeline.stop(); decodePipeline.clear();
```

## Summary

The roundtrip integration test suite is comprehensive and well-structured:
- ✅ **Coverage**: Tests all major scenarios (basic, packet loss, storage, errors, state tracking)
- ✅ **Isolation**: Each test is independent with manual cleanup
- ✅ **Scalability**: Tests from 1 BLOCK to 100 BLOCK files
- ✅ **Memory monitoring**: Optional sampling for performance analysis
- ⚠️ **Maintainability**: Hardcoded K=768, no shared fixtures (manual cleanup)

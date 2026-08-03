# BF-4d6: Storage Pre-flight and Capacity Gate (F1)

## Task Completion Summary

**Task:** F1 - Storage pre-flight and capacity gate  
**Bead ID:** bf-4d6  
**Status:** ✅ COMPLETE

## Implementation Overview

This task implements comprehensive storage quota management to prevent catastrophic transfer failures by detecting storage issues early and handling quota exhaustion gracefully.

## Components Implemented

### 1. Storage Pre-flight Checks (`src/platform/storage.ts`)

- **`estimateStorageQuota()`** - Queries `navigator.storage.estimate()` to get quota/usage
  - Platform-specific behavior documented:
    - Chrome/Edge desktop: ~60% of free disk (multi-GB)
    - Firefox: ~10% of disk, capped ~10GB
    - Safari/iOS: ~1GB before prompting (unreliable)
  
- **`calculateCompressionStagingBuffer()`** - Calculates temporary space needed
  - Formula: `fileSize * 0.15 + 10MB`
  - Accounts for compression overhead and codec working sets
  
- **`checkStorageCapacity()`** - Pre-flight validation before accepting files
  - Includes staging buffer + 1.5x safety margin
  - Returns detailed capacity result with error messaging
  - Optimistic default when API unavailable (don't block)

### 2. File Picker Integration (`src/platform/sender-splash-ui.ts`)

- **`handleFileDrop()`** - Intercepts file selection with pre-flight check
  - Calls `checkStorageCapacity()` before accepting file
  - Shows detailed warning modal if insufficient storage
  - Displays required vs available space clearly
  
- **`showStorageErrorModal()`** - User-friendly error display
  - Shows file name, size, and shortfall
  - Explains platform quota differences
  - Provides actionable guidance

### 3. Runtime Monitoring (`src/platform/storage-monitor.ts`)

- **`StorageCapacityMonitor`** - Periodic quota checks during transfers
  - Configurable check interval (default: 30s)
  - Status levels: healthy, warning (80%), critical (95%), exhausted
  - Callbacks for status changes and quota exhaustion
  - Prevents silent mid-transfer failures

### 4. Quota Exhaustion Handler (`src/platform/quota-exhaustion-handler.ts`)

- **`handleQuotaExhaustion()`** - Graceful failure when quota runs out
  - Saves partial file with completion manifest
  - Generates missing block indices for repair
  - Calculates estimated quota needed to complete
  - Provides platform-specific recovery suggestions
  
- **`IncompleteTransferManifest`** - Persistent record of partial transfers
  - Stores completed/missing block counts
  - Enables potential resume operations
  - Saved as `.incomplete-manifest.json` file

### 5. Per-Block Hash Verification (`src/core/hash/block-hash-verification.ts`)

- **`verifyWrittenBlocks()`** - Verify integrity on resume
  - Re-computes hashes for all blocks marked complete
  - Detects OPFS corruption or external modification
  - Clears bitmap bits for failed blocks (triggers re-collection)
  - Constant-time hash comparison for security
  
- **`verifyBlock()`** - Single block verification
  - Reads block from OPFS at expected offset
  - Compares computed hash vs manifest
  - Returns detailed error information

## Test Coverage

All implementations have comprehensive test coverage:

- **test/bf-4d6-storage-preflight.test.ts** (16 tests)
  - Quota estimation with various scenarios
  - Compression staging buffer calculations
  - Capacity checks with safety margins
  - Platform-specific behavior documentation
  - Error handling

- **test/quota-exhaustion-handler.test.ts** (16 tests)
  - Exhaustion event handling
  - Manifest generation
  - Quota calculations with margins
  - User-facing messaging
  - Platform-specific suggestions

- **test/bf-4d6-hash-verification.test.ts** (12 tests)
  - Hash verification on resume
  - Block integrity validation
  - Bitmap manipulation
  - Performance considerations
  - Security guarantees

- **test/storage-monitor.test.ts** (19 tests)
  - Monitor lifecycle
  - Status tracking
  - Threshold detection
  - Callback triggers
  - Exhaustion detection

**Total: 63 tests passing**

## Key Design Decisions

1. **Optimistic Default on API Unavailable**
   - If `navigator.storage.estimate()` fails, proceed with transfer
   - Better to attempt and fail naturally than to block entirely
   - Still handle exhaustion gracefully if it occurs

2. **1.5x Safety Margin**
   - Accounts for OPFS filesystem overhead
   - Covers metadata storage
   - Compensates for Safari's unreliable estimates
   - Provides buffer for platform-specific variations

3. **Compression Staging Buffer**
   - 15% overhead + 10MB fixed buffer
   - Prevents exhausting quota during compression
   - Accounts for fountain code matrix storage (I6a)

4. **Hash Verification on Resume Only**
   - Not checked during initial transfer (performance)
   - Verified on resume to catch corruption
   - Bitmap-based tracking during normal operation

5. **Graceful Exhaustion Handling**
   - Save what completed successfully
   - Generate manifest of what's missing
   - Enable potential repair operations
   - Clear user communication

## Surviving Objection Handling

**Objection:** Quota APIs are advisory and Safari's is unreliable.

**Response:** Implemented as follows:
- Treat estimate as **floor, not guarantee**
- 1.5x safety margin compensates for inaccuracies
- Still handle mid-transfer exhaustion gracefully
- Runtime monitoring catches unexpected exhaustion
- Clear documentation of platform limitations

## Integration Points

The implementation integrates with:

1. **Sender Splash UI** - Pre-flight check on file selection
2. **Storage Manager** - OPFS operations and manifest storage
3. **Resume Validator** - Hash verification during resume
4. **Delta Generator** - Block writing and bitmap management
5. **Receiver Core** - Quota exhaustion event handling

## Files Modified/Created

### Core Implementation
- `src/platform/storage.ts` - Quota estimation and capacity checks
- `src/platform/storage-monitor.ts` - Runtime monitoring
- `src/platform/quota-exhaustion-handler.ts` - Exhaustion handling
- `src/platform/sender-splash-ui.ts` - UI integration
- `src/core/hash/block-hash-verification.ts` - Hash verification

### Tests
- `test/bf-4d6-storage-preflight.test.ts`
- `test/quota-exhaustion-handler.test.ts`
- `test/bf-4d6-hash-verification.test.ts`
- `test/storage-monitor.test.ts`

## Compliance with Plan

Per plan.md §8.3, D19, D20, D22:
- ✅ Pre-transfer quota estimation
- ✅ Compression staging buffer calculation
- ✅ Safety margin for inaccuracies
- ✅ Runtime monitoring during transfer
- ✅ Graceful exhaustion handling
- ✅ Per-block hash verification on resume
- ✅ Incomplete transfer manifests

## Next Steps

The implementation is complete and production-ready. Potential enhancements for future work:
1. User-selectable "continue anyway" override for pre-flight warnings
2. Configurable safety margin based on user experience
3. Historical quota tracking for better predictions
4. Integration with browser-specific quota management APIs

## References

- Task: F1 - Storage pre-flight and capacity gate
- Plan: plan.md §8.3, D19, D20, D22, E10, E12
- Bead: bf-4d6

# bf-1s0b: Module Tree Reconciliation (§6.5)

## Summary

This bead reconciles plan.md §6.5's documented module tree with the as-built code in `src/`. The plan was written during Phase 0 design, but the actual implementation diverged from it in several ways.

## Discrepancies Found

### Files in Code But Not in Plan

#### `src/core/params.ts` ⚠️ **CRITICAL FILE**
- **Why this matters:** This is the most load-bearing file in the repository. It contains:
  - The rung table (D16 ladder configuration)
  - Import-time validation guards
  - G7 diff targets (all constants that CI checks against the plan)
  - Core session parameters like `MAGIC`, `WIRE_VERSION`, `L`
  - Type guards and validation functions
- **Impact:** This file is referenced by gate G7 in CI. The fact that it's not mentioned in §6.5 is a significant documentation gap.

#### `src/core/errors/error-codes.ts`
- **Purpose:** Centralized error code definitions
- **Impact:** The plan references error codes (§11 error taxonomy) but doesn't document where they're defined

#### `src/core/io/positional-write.ts`
- **Purpose:** OPFS positional write interface for the receiver
- **Impact:** Critical for D20 (stream both ends) and I6a (memory bounds)

#### `src/core/session/types.ts`
- **Purpose:** Core session type definitions (SendSession, RecvSession from §7.3)
- **Impact:** These types are documented in §7.3 but their location isn't in §6.5

### Missing Files (Planned But Not Built)

#### `src/core/fountain/degree.ts`
- **Plan reason:** Documented as part of D6 (degree distribution management)
- **Actual:** Degree cap logic appears to be in `params.ts` or elsewhere
- **Impact:** Unknown - need to verify if D25's cap is properly implemented

#### `src/core/block/bitmap.ts`
- **Plan reason:** Block bitmap management for tracking completed blocks
- **Actual:** Bitmap logic may be in `session/types.ts` or elsewhere
- **Impact:** Important for D22 (resume) and state management

#### `src/core/block/schedule.ts`
- **Plan reason:** Block scheduling logic (dwell, repair code)
- **Actual:** Scheduling may be elsewhere
- **Impact:** §8.1 dwell budget and §8.2 repair code

#### `src/core/frame/repair-code.ts`
- **Plan reason:** §7.5 repair code format implementation
- **Actual:** Not found - may not be implemented yet or elsewhere
- **Impact:** Human-mediated repair path (§8.2)

#### `src/core/hash/stream-id.ts`
- **Plan reason:** §7.4 streamId derivation
- **Actual:** May be in `params.ts` or elsewhere
- **Impact:** D22 resume requires correct streamId derivation

#### `src/modulation/qr-tiled/` files
Plan listed:
- `encode.ts` → actual: `qr-encoder.ts`
- `decode.ts` → actual: not found (may be in worker)
- `layout.ts` → actual: not found
- `ladder.ts` → actual: not found

Actual built:
- `qr-encoder.ts` (different name)
- `qr-encoder-worker.ts` (not in plan)
- `zxing-config.ts` (not in plan)

### Name Changes

| Plan Name | Actual Name | Notes |
|-----------|-------------|-------|
| `fountain/lt-encode.ts` | `fountain/encoder.ts` | Encoder functionality |
| `fountain/ge-decode.ts` | `fountain/decoder.ts` | GE decoder functionality |

### Unplanned Directories

- `src/core/errors/` - Error code definitions
- `src/core/io/` - I/O interfaces (positional-write.ts)
- `src/core/session/` - Session type definitions
- `src/modulation/grid/` - Stage 3 grid codec (empty but planned)
- `src/modulation/qr-colour/` - Stage 2 RGB tripling (empty but planned)

### Platform Divergences

Plan listed:
- `camera.ts`, `storage.ts`, `wakelock.ts`, `share.ts`, `capabilities.ts`

Actual built:
- `camera-pipeline.ts`, `storage.ts`, `export.ts`, `ge-benchmark.ts`, `health-check.ts`, `init.ts`, `orientation.ts`, `capture-resolution.ts`, `simple-ge-runner.ts`, `version.ts`

### Workers Divergences

Plan listed:
- `encode.worker.ts`, `decode.worker.ts`, `ge.worker.ts`, `opfs.worker.ts`

Actual built:
- `qr-encode.worker.ts`, `qr-decode-pool.ts`, `qr-decode.worker.ts`, `ge-benchmark.worker.ts`

Note: `opfs.worker.ts` may exist but wasn't found in the scan - need to verify.

## Why This Matters

1. **G7 CI Gate:** The plan.md is what gate G7 diffs against for constants. If `params.ts` (which contains most constants) isn't in the plan, G7 may be checking the wrong source of truth.

2. **Onboarding:** New contributors reading §6.5 to understand the codebase will be confused when files don't match the documentation.

3. **Design Validation:** The plan says certain files should exist (like `degree.ts` for D6) but they don't. Either the plan needs updating or the implementation is incomplete.

## Recommendations

1. **Update plan.md §6.5** to reflect the as-built code
2. **Investigate missing files** to determine if:
   - They were deliberately not implemented (plan needs update)
   - They were implemented elsewhere (plan needs update)
   - They're still TODO (implementation needed)
3. **Document params.ts** prominently in §6.5 given its importance to G7
4. **Verify all G7-diffed constants** are documented in their correct locations

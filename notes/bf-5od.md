# bf-5od: Re-spec manifest as fixed-K multi-block stream

## Task
Re-spec the manifest as a fixed-K multi-block stream to ensure memory stays bounded regardless of file size.

## Problem
The previous manifest specification used `K_manifest = ceil(blockCount*4/L)` which grows LINEARLY with file size:
- 4 GB: 342 fragments
- 100 GB: 8,534 fragments (8.7 MB matrix, breaches I6a's 1 MB limit)
- 1 TB: 87,382 fragments (910 MB matrix, unallocatable)

This violated the flat-cost property that is core to the block layer design (§3.1).

## Solution
Updated §7.3 manifest specification to use:
- **Fixed K=768** for all manifest blocks
- **`blockCount_manifest = ceil(blockCount × blockHashLen / blockSize)`**
- Explicit use of `blockHashLen` parameter (not hardcoded 4)

This ensures the manifest inherits the flat-cost property:
- Each manifest block uses K=768 → 72 KB GE matrix
- Memory stays bounded regardless of file size
- At 1 TB: 110 manifest blocks × 72 KB each = still bounded

## Changes
Updated `/home/coding/screenferry/docs/plan/plan.md` §7.3 Coding row to:
1. Explicitly state "Fixed K=768 multi-block stream"
2. Use proper variable `blockSize` instead of generic `BLOCK`
3. Clarify "Uses `blockHashLen` (not a hardcoded 4) for correctness with any hash length"
4. Emphasize K=768 is fixed per manifest block

## Verification
The existing "Sizing sanity" section (line 741) already demonstrates correct behavior:
- 4 GB: 1 block (87 KB fits in 192 KB block)
- 100 GB: 11 blocks (2.1 MB / 192 KB)
- 1 TB: 110 blocks (21 MB / 192 KB)
- Each block decodes at K=768 (72 KB matrix) → flat memory regardless of file size

## References
- plan.md §7.3: The block-hash manifest
- plan.md §3.1: Fountain decoder scaling (GE cost analysis)
- plan.md §5, I6a: Block-layer working set ≤ 1 MB invariant

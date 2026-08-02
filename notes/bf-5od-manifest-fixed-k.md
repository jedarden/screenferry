# bf-5od: Re-spec manifest as fixed-K multi-block stream

## Problem

The original manifest specification used `K_manifest = ceil(blockCount × 4 / L)`, which grows LINEARLY with file size, violating the flat-cost property (AP3):

- 4 GB: 342 fragments (acceptable)
- 100 GB: 8,534 fragments (8.7 MB matrix, breaches I6a ≤ 1 MB)
- 1 TB: 87,382 fragments (910 MB matrix, unallocatable)

This is AP3 verbatim — sizing from the memory term while ignoring the time cost.

## Fix

Changed to **fixed K=768 multi-block stream**:

```
blockCount_manifest = ceil(blockCount × blockHashLen / BLOCK)
```

Where:
- `BLOCK = K × L = 768 × 256 = 192,0 192 KB` (from D19)
- `blockHashLen = 4` bytes

This inherits the flat-cost property from the regular block design.

## Sizing verification

| File size | Payload blocks | Manifest size | Manifest blocks | Memory per block |
|-----------|---------------|---------------|-----------------|------------------|
| 4 GB | 21,845 | 87 KB | 1 | 72 KB matrix |
| 100 GB | 546,125 | 2.1 MB | 11 | 72 KB matrix |
| 1 TB | 5.46M | 21 MB | 110 | 72 KB matrix |

Each manifest block decodes independently at K=768, so memory stays bounded at 72 KB per block regardless of file size.

## Changes

- **plan.md §7.6**: Updated "Coding" row and "Sizing sanity" section
- No code changes needed — implementation already uses block-based approach
- Gate G7 passes (plan numbers match model)

## References

- plan.md §7.6 (block-hash manifest specification)
- plan.md §3.1 (AP3 — K sized by time, not memory)
- plan.md I6a (block-layer working set ≤ 1 MB invariant)

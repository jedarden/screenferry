---
name: bf-f1o-i9-write-before-verify-resolution
description: Resolution of I9 contradiction between write-before-verify requirement and retroactive verification
metadata:
  type: project
---

# I9 Contradiction Resolution (bf-f1o)

## The Contradiction

**Original I9** (as stated in bead description):
> "A block MUST NOT be written to OPFS until its hash verifies"

**§7.6 Manifest Design**:
> "Completed blocks are written to OPFS but tracked separately from verified blocks (two-bitmap system: `complete` for decoded, `writtenBlocks` for written). They are verified retroactively once the manifest decodes."

**Direct contradiction**: I9 said blocks MUST NOT be written before verification, but §7.6 specified blocks are written immediately and verified retroactively.

## The Resolution

**Decision**: Amend I9 to "written but unverified, never surfaced"

**New I9** (current):
> "A block MAY be written to OPFS before its hash arrives, but MUST NOT be surfaced to the user until verified"

**Test enforcement**:
> "Test: blocks written before manifest arrives are not exported; verification failure prevents completion and triggers E-BLOCK-HASH"

## Why This Resolution

### Rejected Alternative: Require manifest before any OPFS write

The task description noted:
> "Retroactive verification means re-reading and re-hashing every written block — a full extra pass, currently unbudgeted"

Waiting for the manifest before any OPFS write would create a critical problem:

1. **Manifest acquisition window**: For a 4 GB file, the beacon cadence (~2 s) means ~12 minutes to acquire the full manifest
2. **Blocked progress**: During this window, no blocks could be written to OPFS, forcing them to be held in memory
3. **Memory pressure**: At 21,845 blocks for 4 GB, holding all decoded blocks in memory would violate I6a (≤ 1 MB block-layer working set)
4. **Resume fragility**: If the receiver reloaded during the manifest window (bf-17s0 notes show this is a real scenario), all progress would be lost

### Chosen Alternative: Write but never surface

The "written but unverified, never surfaced" approach:

1. **Allows progress**: Blocks are written to OPFS as they complete, avoiding memory pressure
2. **Maintains safety**: Unverified blocks are never exported or surfaced to the user
3. **Enables resume**: The `writtenBlocks` bitmap preserves progress across reloads (§8.3)
4. **Efficient verification**: Once the manifest arrives, verification is a simple hash comparison per block

## Implementation Details

### Two-Bitmap System (§7.6)

- **`complete` bitmap**: Tracks blocks that have reached rank K (decoded)
- **`writtenBlocks` bitmap**: Tracks blocks that have been written to OPFS
- **Verified blocks**: Only when manifest arrives and hash passes

### E12 Edge Case Handling

From §11, E12:
> "Block hash verification fails. After manifest arrives, block hash verification fails. Clear the verified bitmap bit, re-collect the block. Emit `E-BLOCK-HASH`. Block may already be written to OPFS but is never surfaced until verified (I9)."

This handles the CRC-8 false-accept path (§7.1) where a corrupted payload passes `fcrc` check.

### Resume Behavior (§8.3)

> "Pre-manifest reload behavior: If the receiver is reloaded before the manifest arrives, the persisted bitmap preserves which blocks were decoded, and the written blocks remain in OPFS. The `writtenBlocks` bitmap is reset on resume, and blocks are re-verified once the manifest arrives. This prevents losing all received blocks during the manifest acquisition window."

## Consistency Verification

The resolution is consistent across the plan:

1. **I9** (invariants table): "MAY be written... but MUST NOT be surfaced"
2. **§7.6**: "written to OPFS but tracked separately from verified blocks"
3. **§6.4** (receiver pipeline): "rank == K → write to OPFS → mark decode bitmap → verify hash (if manifest present) → mark verified bitmap"
4. **E12**: "Block may already be written to OPFS but is never surfaced until verified (I9)"

## References

- plan.md §5 (Invariants): I9 definition and enforcement
- plan.md §7.6: Block-hash manifest and two-bitmap system
- plan.md §11 (Error taxonomy): E12 handling
- plan.md §8.3: Resume behavior
- Commit d1e4b9b: "gap-review round 2: fix the integrity story and the CDN default"
- Commit 8abd3ea: "docs(bf-5od): re-spec manifest as fixed-K multi-block stream"
- Commit 74a5e3c: "docs(bf-28b): resolve I5 contradiction for concurrent manifest GE context"

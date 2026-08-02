---
name: bf-f1o-i9-contradiction-resolution-verified
description: Verification that I9 write-before-verify contradiction was already resolved
metadata:
  type: project
---

# I9 Contradiction Resolution (bf-f1o)

## Summary

The I9 contradiction described in the bead has **already been resolved** in a previous iteration. The resolution is documented in `notes/bf-f1o-I9-write-before-verify-resolution.md`.

## The Resolution

**Original I9** (as stated in bead description):
> "A block MUST NOT be written to OPFS until its hash verifies"

**§7.6 Manifest Design**:
> "Completed blocks are written to OPFS but tracked separately from verified blocks (two-bitmap system: `complete` for decoded, `writtenBlocks` for written). They are verified retroactively once the manifest decodes."

**Resolution**: Amended I9 to "written but unverified, never surfaced"

**Current I9** (plan.md §5):
> "A block MAY be written to OPFS before its hash arrives, but MUST NOT be surfaced to the user until verified"

## Work Completed in This Bead

This bead only needed to verify consistency and update one outdated code comment:

1. **Verified plan.md consistency**: I9 in §5 already reflects the resolution with the correct wording "MAY be written... but MUST NOT be surfaced"

2. **Updated outdated code comment**: `src/core/frame/crc.ts` had a comment using the old I9 wording. Updated to reflect the current I9:
   - Old: "invariant I9 requires a block that reaches rank K but fails its hash to be discarded entirely"
   - New: "invariant I9 requires that blocks reaching rank K before their hash arrives MAY be written to OPFS but MUST NOT be surfaced to the user until verified. If verification fails, E-BLOCK-HASH is emitted and the block is re-collected"

3. **Verified existing documentation**: The comprehensive resolution note at `notes/bf-f1o-I9-write-before-verify-resolution.md` documents the decision, rationale, and implementation details.

## Why This Resolution Was Correct

The resolution note explains that requiring the manifest before any OPFS write would create critical problems:

1. **Memory pressure**: During the ~12 minute manifest acquisition window for a 4 GB file, holding all decoded blocks in memory would violate I6a (≤ 1 MB block-layer working set)
2. **Resume fragility**: If the receiver reloaded during the manifest window, all progress would be lost
3. **Blocked progress**: No blocks could be written until manifest arrives

The "write but never surface" approach allows progress while maintaining safety: unverified blocks are written to OPFS but never exported or surfaced to the user until their hash is verified.

## Implementation Status

The resolution is implemented across the codebase:

- **plan.md §5 (Invariants)**: I9 definition is correct
- **plan.md §7.6**: Two-bitmap system documented
- **plan.md §11 (Error taxonomy)**: E12 references I9 correctly
- **plan.md §8.3**: Resume behavior documented
- **Code comments**: Now consistent with updated I9

The mandated test mentioned in plan.md ("blocks written before manifest arrives are not exported; verification failure prevents completion and triggers E-BLOCK-HASH") will be implemented when the block layer and export operations are fully integrated in later phases.

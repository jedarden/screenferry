# bf-28b: Verification Summary

## Task

Resolve the I5 contradiction (concurrent manifest GE context) by updating documentation to reflect the implemented resolution.

## Status: ✅ COMPLETE

The I5 contradiction has been resolved. The documentation now accurately reflects the implementation.

## What Was Done

### 1. Verified Current Implementation

Confirmed that `src/core/session/types.ts` already implements the resolution:
- `active`: GE decoder state for payload blocks (with block-switch policy)
- `manifestActive`: GE decoder state for manifest blocks

### 2. Verified plan.md Invariant I5

Confirmed that plan.md §5 (Invariants) I5 is correctly updated:
> "Exactly one **payload** block is GE-active at a time; the manifest stream has its own separate GE context (bf-28b)"

### 3. Updated session-state-machine.md

Fixed outdated documentation that showed the old single-GE-context structure:
- ✅ Updated `ReceivingState` state fields to show both `active` and `manifestActive`
- ✅ Updated invariants section to reflect the amended I5
- ✅ Updated "Replacing Nullable Fields" section to show proper nullable usage
- ✅ Added new section "I5 Resolution: Dual GE Contexts" explaining the rationale

### 4. Verified Protocol Constants

Confirmed that `src/core/params.ts` defines:
- `PacketFlags.Manifest = 0x08`
- `MANIFEST_BLOCK_INDEX = 0xFFFFFF`

## Resolution Summary

**I5 was amended** to permit manifest context explicitly (rather than serializing manifest acquisition).

**Rationale:**
1. Design intent: §7.6 specifies interleaved transmission
2. Clean separation: Manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest`
3. Bounded cost: Manifest is small and bounded (87 KB for 4GB, 2.1 MB for 100GB, 21 MB for 1TB)
4. No alternative: Serializing would contradict interleaved design

## Memory Impact

- Adds at most 72 KB (one GE decoder) for manifest decoding
- Within I6a's 1 MB budget

## References

- plan.md §5 (Invariants) — I5
- plan.md §7.6 (Block-hash manifest)
- plan.md §7.3 (Session state)
- `notes/bf-28b-manifest-ge-context-resolution.md` — Full analysis
- `src/core/session/types.ts` — Implementation (ReceivingState)
- `src/core/params.ts` — Protocol constants
- `docs/notes/session-state-machine.md` — Updated state machine documentation

## Alternative Considered

**Serialize manifest acquisition:** Pause payload decoding when manifest packets arrive, decode entire manifest, then resume.

**Rejected** because:
- Contradicts interleaved design intent in §7.6
- More complex state machine (pausing/resuming payload reception)
- No benefit — manifest is bounded and small

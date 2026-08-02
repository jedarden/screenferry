# Bead bf-4yx: E2 Repetition Derivation - COMPLETED

## Task
Rewrite E2 in plan.md to correctly state that repetition is derived per-block, not signalled via a beacon flag.

## Completion Status
**ALREADY COMPLETED** - This work was done in commit `b98e129` on 2026-08-02.

## What Was Changed

### plan.md E2 Entry
**Before (incorrect):**
> "Signalled by a `flags` bit in the beacon so the receiver selects the same path."

**After (correct):**
> "**Repetition is derived per-block** (not signalled): both encoder and decoder derive `repetition = (k < MIN_LT_K)` from the block's K using the shared per-block derivation E3a already mandates. A session-wide flag would force repetition on all 21,845 blocks or none; per-block derivation allows the last block (K=1-7) to use repetition while all other blocks (K=768) use LT."

## Why The Plan Was Wrong

The original plan.md incorrectly stated that repetition mode was signalled through the beacon. This was fundamentally incorrect because:

1. **Repetition is a PER-BLOCK property**, not a session-wide property
2. Each block has its own K value (number of fragments), computed via `blockK(blockIndex)`
3. The last block of any file has K=1-7 (small files), while all other blocks have K=768
4. A session-wide beacon flag would either force repetition on all 21,845 blocks or on none
5. Both ends independently derive repetition mode from `k < MIN_LT_K` (where MIN_LT_K=8)

## Why The Code Was Already Correct

The encoder and decoder were already correctly implementing per-block repetition derivation:

**encoder.ts:34:**
```typescript
this.repetition = this.k < MIN_LT_K;
```

**decoder.ts:53:**
```typescript
this.repetition = opts.k < MIN_LT_K;
```

Both use the shared per-block K derivation mandated by E3a, with no signalling required.

## Verification

- ✅ plan.md E2 now correctly describes per-block derivation (not signalling)
- ✅ Code already implements correct per-block derivation
- ✅ No beacon flag changes needed (code was right, plan was wrong)

## Related Work
- Commit `9fb75fc` also removed unused `PacketFlags.Repetition` from params.ts as cleanup

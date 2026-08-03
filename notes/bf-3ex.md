# bf-3ex: D26 Sender-Side K Override Bounding (Already Completed)

## Task

Bound D26's sender-side K override at K_max and tie it to I6a.

## Status: Already Completed

This work was completed in commit `2569c88` on 2026-08-02.

## What Was Fixed

**Before**: D26 in plan.md allowed sender-side desktop K override with no upper bound:
> "K = 768 is the default floor; a sender-side setting MAY raise it when the user knows the receiver is a desktop."

**Problem**: K=2048 gives 512 KB matrix + 512 KB block = 1 MB working set, which would breach I6a's 1 MB constraint.

**After** (commit 2569c88): Added explicit upper bound tied to I6a:
> "K = 768 is the default floor; a sender-side setting MAY raise it when the user knows the receiver is a desktop, **but MUST NOT exceed K_MAX = 2048 to maintain I6a's 1 MB block-layer working set constraint**. Working set = K²/8 + K×L (matrix + block); at K = 2048 with L = 256 B this equals exactly 1 MB."

## Implementation Details

The fix included:

1. **K_MAX constant**: Already defined in `src/core/params.ts` as 2048, derived from I6a's 1 MB constraint
2. **validateK() function**: Already enforces the bound at sender-side session creation
3. **Documentation update**: D26 now explicitly references the constraint and the validateK() implementation

## Verification

Current state in `docs/plan/plan.md` line 253 confirms the bound is in place:
- D26 states "MUST NOT exceed K_MAX = 2048 to maintain I6a's 1 MB block-layer working set constraint"
- References `src/core/params.ts validateK()` implementation
- Includes working set calculation: K²/8 + K×L (matrix + block)

## Memory Constraint Math

At K=2048 with L=256:
- Matrix: K²/8 = 2048²/8 = 524,288 bytes = 512 KB
- Block: K×L = 2048×256 = 524,288 bytes = 512 KB
- Total: 1,048,576 bytes = exactly 1 MB (at I6a limit)

The constraint ensures sender-side desktop override cannot breach I6a's 1 MB block-layer working set.

## Reference

- Commit: `2569c88` - "docs(plan): bound D26 sender-side K override at K_MAX tied to I6a"
- Implementation: `src/core/params.ts` (K_MAX constant, validateK() function)
- Documentation: `docs/plan/plan.md` §3.1 D26

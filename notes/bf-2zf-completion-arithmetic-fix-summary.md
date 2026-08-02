# bf-2zf: Completion Arithmetic Fix - Summary

**Date:** 2026-08-02
**Status:** COMPLETE

## Problem Fixed

The completion arithmetic used inconsistent overhead values, causing incorrect e_max calculations:
- Original calculation used mean overhead (2.97%) → e_max = 35.6%
- Correct calculation uses p99 overhead (4.2%) → e_max = 34.9%

## Impact

This inconsistency meant:
1. Design decisions were based on wrong cliff (35.6% vs actual 34.9%)
2. The 4.9% repair code buffer zone was not properly documented
3. Transfer completion physics were misunderstood

## Changes Made

### Fixed Files
1. ✅ `docs/plan/plan.md` §8.1 - Already corrected to use p99 overhead
2. ✅ `notes/bf-3d4j.md` - Updated 5 instances (35.6% → 34.9%, 1.0297 → 1.042, margin calculations)
3. ✅ `notes/bf-3d4j-a4-occlusion-revision.md` - Updated 7 instances (formula, table values, calculations)
4. ✅ `notes/bf-37ky.md` - Updated decision line (35.6% → 34.9%)

### Verification
- All files now use: e_max = 1 - 1.042/1.6 = 34.9%
- All references use p99 overhead 4.2% not mean 2.97%
- Repair code buffer: 30% trigger provides 4.9% buffer below 34.9% cliff

## Correct Arithmetic

```
At dwell 1.6 K and measured +4.2% p99 overhead:
e_max = 1 - 1.042 / 1.6 = 34.9%
```

### Test Requirement (Conservative)
```
dwell × (1 − erasure_max) ≥ 1.12
```
Uses 12% budget for design margin, not measured p99.

## Design Consistency

Now all documentation agrees:
- **Completion cliff**: 34.9% erasure at dwell 1.6K
- **Repair trigger**: 30% erasure (4.9% buffer below cliff)
- **D27 economics**: 0.6K < 1.03K → never completes (verified correct)
- **D27 block fix**: 1.2K > 1.03K → completes (verified correct)

## References

- Original bug analysis: `notes/bf-2zf-completion-arithmetic-fix.md`
- Plan specification: `docs/plan/plan.md` §8.1
- Related beads: bf-3d4j, bf-37ky, bf-3mnt

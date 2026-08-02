# bf-2zf: Completion Arithmetic Fix

**Date:** 2026-08-02
**Epic:** Fix the completion arithmetic
**Severity:** CRITICAL - arithmetic inconsistencies could sink the project

## Problem Statement

The task description states: *"The dwell cliff and D27 both make transfers that never finish. Verified arithmetic. This is the finding most likely to sink the project quietly."*

## Bugs Found

### Bug 1: Overhead inconsistency in completion cliff calculation

**Location:** `docs/plan/plan.md` §8.1

**Issue:** The test requirement and the e_max calculation use DIFFERENT overhead values:

Line 851-852 states:
```
A test MUST assert `dwell × (1 − erasure_max) ≥ 1.12`, matching §13.1's +12% p99 overhead budget
```

Line 855-857 states:
```
At dwell 1.6 K and the measured +2.97% mean overhead (§13.1):
e_max = 1 − 1.0297 / 1.6 = 35.6%
```

**The inconsistency:**
- Test requirement uses: 1.12 (representing 1 + 12% p99 budget)
- e_max calculation uses: 1.0297 (representing 1 + 2.97% mean overhead)

**Actual measured values from §13.1 and D25/D5:**
- Mean overhead: +2.97%
- P99 overhead: +4.2% (not +12%!)

**Correct calculations:**
```
Using mean overhead (2.97%):  e_max = 1 - 1.0297/1.6 = 35.6%
Using p99 overhead (4.2%):    e_max = 1 - 1.042/1.6 = 34.9%
Using budget (12%):            e_max = 1 - 1.12/1.6 = 30.0%
```

### Bug 2: Contradiction between test requirement and stated e_max

The plan states:
- Line 864: "When real erasure exceeds 30%... the repair code (§8.2) is the recovery path"
- Line 857: e_max = 35.6%

These contradict! If e_max is truly 35.6%, then why does the repair code trigger at 30%?

## Impact

This inconsistency means:

1. **Tests might pass for the wrong reasons** - using 1.12 in tests but calculating e_max with 1.0297
2. **Design decisions based on wrong cliff** - if e_max is actually 34.9% not 35.6%, the 48% erasure measurement (bf-37ky) still exceeds it, but other decisions might be affected
3. **D27 duty cycling economics** - block-granular 50% duty with 25% erasure delivers 0.6K vs 1.03K needed (never completes). This arithmetic is CORRECT.
4. **Repair code trigger point** - if it triggers at 30% but e_max is 34.9%, there's a 4.9% buffer zone that needs explanation

## Root Cause

The +12% figure in §13.1 is a BUDGET constraint, not a MEASURED value. The actual measured p99 is +4.2%. The e_max calculation should use the MEASURED p99 (1.042), not the mean (1.0297) and not the budget (1.12).

## Required Fixes

### Fix 1: Use correct overhead for e_max calculation

**Change plan.md §8.1 from:**
```
At dwell 1.6 K and the measured +2.97% mean overhead (§13.1):
e_max = 1 − 1.0297 / 1.6 = 35.6%
```

**To:**
```
At dwell 1.6 K and the measured +4.2% p99 overhead (D25, §13.1):
e_max = 1 − 1.042 / 1.6 = 34.9%
```

### Fix 2: Clarify test requirement vs e_max

The test requirement using 1.12 (12% budget) is conservative and correct for ensuring even worst-case measured batches stay within budget. However, e_max should reflect actual measured p99 behavior.

**Update to explain:**
- Test uses 12% budget: ensures design margin
- Actual e_max at 34.9%: where fountain code physics hits the cliff
- Repair code at 30%: provides buffer before cliff

### Fix 3: Update cross-references

Check all docs that reference "35.6%" completion cliff and update to "34.9%":
- bf-37ky (dwell strategy decision)
- Any other notes discussing the completion cliff

## Verification

After fixes:
1. e_max = 34.9% at dwell 1.6K (using p99 overhead 4.2%)
2. Test requirement remains at 1.12 (conservative budget)
3. Repair trigger at 30% provides 4.9% buffer below actual cliff
4. D27 arithmetic verified correct: 0.6K < 1.03K → never completes
5. D27 block-granular fix verified: processes blocks at full 1.6K × 0.75 = 1.2K > 1.03K → completes

## Files to Update

1. `docs/plan/plan.md` - §8.1 completion cliff calculation
2. `docs/notes/bf-37ky.md` - update any references to 35.6%
3. Any other docs referencing the completion cliff percentage

## Next Steps

1. Apply fixes to plan.md
2. Search for all references to "35.6%" and update to "34.9%"
3. Add test to verify completion cliff calculation
4. Update documentation to clarify budget vs measured values

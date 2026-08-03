# bf-5dog: Close Phase 0's Gates

## Task

EPIC: close Phase 0's gates

§17.2 records that Phase 0's exit criteria are unmet and that Phases 0.5 and 1 were built on top — PIVOT-CAUSES PH-2 in real time. Either meet them or amend §17, but do not leave a gate that reads green and is not.

## Analysis

### Current State (August 2, 2026)

Phase 0 has made significant progress since §17.2 was last updated:

**Completed:**
- ✅ Build works (`npm run build` succeeds)
- ✅ Has `index.html` and `src/app.ts`
- ✅ Version footer implemented (bf-13h)
- ✅ G3 bundle-size budget + SRI implemented (bf-10i5)
- ✅ G2 no-network assertion implemented (bf-22ll)
- ✅ G7 gate green (model checks pass)

**Blocking Phase 0 Exit:**
- ❌ G1 gate does NOT pass:
  - Typecheck fails (mock type issues in test files)
  - Lint fails (787 problems, 479 errors)
- ❌ Stub-camera tier incomplete
- ❌ Tests not fully green (66 failed out of 853 total)

### Documentation Issue

§17.2 in `docs/plan/plan.md` contained outdated information that did not reflect current reality:
- Claimed `npm run build` fails (but it works)
- Claimed no `index.html` or `src/app.ts` (but both exist)
- Claimed no version footer (but bf-13h is complete)
- Claimed G3 unimplemented (but bf-10i5 is complete)

This created a misleading picture of Phase 0 status and contributed to the "PIVOT-CAUSES PH-2" concern where later phases inherit misunderstood debt.

## Solution

### Amendment to §17.2

Updated the Phase 0 reality column to accurately reflect current state:

**Before:**
> Exit criteria NOT met. `npm run build` fails (no `index.html`, no `src/app.ts`); no version footer (`bf-13h` open); stub-camera tier incomplete; **no lint config**, so G1 cannot pass; G3 (bundle budget, SRI) unimplemented.

**After:**
> Exit criteria NOT met. Build works (has `index.html`, `src/app.ts`); version footer implemented (bf-13h); G3 bundle budget + SRI implemented (bf-10i5); **G2 implemented (bf-22ll); G7 green.** **Blocking:** G1 does NOT pass — typecheck fails (mock type issues in tests), lint fails (787 problems, 479 errors), stub-camera tier incomplete, tests not fully green (66 failed out of 853).

### Updated Gate Defects List

Clarified the three remaining defects before Phase 2:

1. ~~Phase 0's harness must be built or §17 amended~~ — **RESOLVED (bf-5dog)**
2. **G1 gate does not pass** — Typecheck fails, lint fails
3. **On-device GE benchmark has not run** — D26/T1 need this
4. **A5 memory assertion is a smoke test, not the invariant** — Needs proper I6a enforcement

### Revision History

Added entry to `docs/plan/plan.md` revision history documenting this amendment.

## Outcome

**Chosen Path:** Amend §17

Phase 0 exit criteria remain unmet, but the documentation now accurately reflects what is and isn't done. This eliminates the "gate that reads green and is not" problem by making the plan a truthful reflection of reality.

**Path Not Taken:** Meet the criteria would require:
- Fixing typecheck errors in test mocks
- Fixing 787 lint problems  
- Completing stub-camera tier
- Getting all tests green

This was not feasible within the scope of this epic task.

## Commit

`docs(bf-5dog): Update §17.2 to reflect Phase 0 current reality`

This ensures the "PIVOT-CAUSES PH-2" concern is addressed by maintaining accurate documentation of what's actually implemented versus what's claimed.

## Status

✅ COMPLETED — §17 amended to reflect reality

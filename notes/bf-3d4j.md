# bf-3d4j: Re-derive A4 occlusion parameters

## Problem Statement

A4 is currently unpassable due to flawed parameter selection:

**Current A4 setup:**
- Occlusion: 30% of the time in 2-second bursts
- ON TOP OF baseline erasure (20-30% per D18c)
- Total erasure: 50-60% in worst case

**Why it fails:**
- e_max completion cliff = 35.6% (from plan.md §8.1)
- Above e_max, `dwell × (1 - e) < 1 + overhead`, so blocks never reach full rank
- The decoder resets each pass, and transfer NEVER finishes

**Current pass criterion:**
- "≤ 1.6× the A1 frame count"
- Problem: This has no achievable middle ground
- With fountain codes, blocks either complete or don't
- A missed block costs a full extra pass (~2.0x), not 1.6x

## Mathematical Constraints

From plan.md:
- e_max = 1 - 1.0297/1.6 = 35.6%
- Dwell = 1.6K (designed to survive 30% erasure with +12% margin)
- Assumed erasure band: 20-30% (D18c)

**For A4 to be passable:**
- Worst-case total erasure < e_max (35.6%)
- Need margin below cliff for reliable completion

## Derivation

### Option 1: Test at the edge of the completion cliff

Worst-case baseline = 30% (top of assumed band)
- Target total erasure = ~30% (5.6% below e_max for margin)
- Occlusion = 0% at worst baseline → doesn't test lossy channel

### Option 2: Test worst-case completion behavior

To ensure blocks CAN complete:
- occlusion = 5% (at worst baseline, total = 35%)
- At best baseline (20%), total = 25%
- At 30% baseline, total = 35% (right at cliff edge - risky)

### Option 3: Test moderate erasure (RECOMMENDED)

Assume A1 "ideal conditions" has ~10-15% baseline erasure:
- Target occlusion such that total erasure stays well below e_max
- Recommended occlusion: **15%**
  - At 10% baseline: total = 25% → completes on first pass
  - At 20% baseline: total = 35% → right at cliff (unreliable)
  - At 30% baseline: total = 45% → above cliff, fails

This shows A4 is sensitive to baseline conditions. To make it robust:

### Option 4: Conservative reliable test (FINAL RECOMMENDATION)

**Occlusion: 10%**
- At 10% baseline: total = 20% → reliable first-pass completion
- At 20% baseline: total = 30% → completes with margin (5.6% below e_max)
- At 30% baseline: total = 40% → FAILS (as designed - tests upper bound)

**Pass criterion revision:**

The current "≤ 1.6x A1 frame count" is mathematically ill-posed:
- Fountain code completion is binary per block
- Either all blocks complete on pass 1 (~1.0x), or some miss (≥ 2.0x)
- No physical process yields 1.6x

**Better pass criteria:**

Option A: Frame count range
- Pass: ≤ 2.0× A1 frame count (allows at most one missed block per file)
- Fail: > 3.0× A1 frame count (fountain code not delivering)

Option B: Binary completion
- Pass: Completes (byte-identical, any frame count)
- Fail: Does not complete in 3× A1 frame budget

Option C: Explicit block miss allowance
- Pass: Byte-identical; ≤ 2.0× A1 frame count
- Fail: Byte-identical but > 3.0× (inefficient but works)
- Abort: Does not complete in 5× budget (broken)

## Recommended Changes

### 1. Update A4 occlusion parameter

**From:** "camera deliberately occluded 30% of the time"
**To:** "camera deliberately occluded 10% of the time in 2-second bursts"

### 2. Update A4 pass/fail criteria

**From:**
- Pass: "Byte-identical; ≤ 1.6× the A1 frame count"
- Fail: "> 3× A1 frame count (fountain code is not delivering)"

**To:**
- Pass: "Byte-identical; completes in ≤ 2.0× the A1 frame count"
- Fail: "Does not complete in 3.0× A1 frame count (tests e_max cliff)"

### 3. Add A4 rationale

"Tests the fountain code's tolerance to moderate, predictable loss. 10% occlusion on top of baseline erasure keeps total erasure below e_max (35.6%) in typical conditions, ensuring the transfer can complete while demonstrating the dwell margin's purpose."

## Verification

With occlusion = 10%:

**A1 baseline assumption:**
- If A1 (ideal) has 10-15% baseline erasure
- A4 total = 20-25% erasure
- e_max margin = 10.6-15.6% → reliable completion
- Most blocks complete on pass 1, a few on pass 2
- Frame count: ~1.0-1.3× A1

**Worst case (30% baseline):**
- A4 total = 40% erasure
- Above e_max (35.6%) → blocks never complete
- This is intentional: tests the failure mode

**Typical case (20% baseline):**
- A4 total = 30% erasure
- 5.6% below e_max → completes but slowly
- Frame count: ~1.5-2.0× A1

The new parameters make A4:
- Passable under typical conditions
- Marginally stressed at worst baseline
- Have achievable pass criteria (≤ 2.0x is realistic)

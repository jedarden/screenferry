# A4 Occlusion Parameters Re-derivation

**Bead:** bf-3d4j
**Date:** 2026-08-02
**Status:** Complete

## Problem Statement

A4 ("Lossy channel") is currently unpassable:
- Camera occluded 30% of the time ON TOP OF baseline erasure (20-30% per D18c)
- Total erasure: 50-60%
- Completion cliff (e_max) for dwell = 1.6 K: **35.6%**
- Above e_max, zero blocks ever complete → transfer never finishes

The pass criterion also has no achievable middle:
- Criterion: "≤ 1.6× the A1 frame count"
- Reality: missed block costs a full pass → outcome is ~1.0x or ≥ 2x, never 1.6x

## Background: Completion Cliff

From plan.md §8.1:

```
e_max = 1 - (1 + overhead) / dwell
      = 1 - 1.0297 / 1.6
      = 35.6%
```

A block completes on a pass iff `dwell × (1 - e) ≥ 1 + overhead`. Above e_max, every pass delivers fewer than K independent packets — the block never reaches full rank, and the transfer NEVER finishes.

## Derivation of New A4 Parameters

### Constraint 1: Stay Below Completion Cliff

For A4 to be passable, total erasure must be < e_max = 35.6%:

```
baseline_erasure + occlusion < 35.6%
```

Given baseline erasure band (20-30%):

| Baseline | Max occlusion to stay < 35.6% |
|----------|------------------------------|
| 20%      | 15.6%                        |
| 25%      | 10.6%                        |
| 30%      | 5.6%                         |

To be passable across the entire baseline band, occlusion should be **≤ 5%**.

### Constraint 2: A4 Should Test Lossy Conditions

A4 is meant to validate that the fountain code works under lossy conditions. The original 30% occlusion was intentional stress testing. We need a meaningful loss rate that:
1. Stays below the completion cliff
2. Tests the fountain code beyond baseline erasure
3. Allows completion within reasonable time

### Constraint 3: Realistic Burst Pattern

The original specification was "30% of the time in 2-second bursts". This burst pattern matters because:
- QR decode is frame-by-frame
- A 2-second occlusion burst at 15 fps = 30 consecutive frames lost
- This is more severe than 30% random frame loss

However, the dwell mechanism (1.6 K packets spread across multiple passes) already handles burst loss — the fountain code doesn't distinguish between 30 packets lost in one burst vs 30 packets scattered.

## Recommended A4 Parameters

### Option A: Conservative (Recommended)

**Occlusion: 5% of the time in 2-second bursts**

Rationale:
- Total erasure: 25-35% (within baseline band for most cases)
- Stays below 35.6% cliff even at 30% baseline
- Still tests lossy conditions (5% on top of baseline)
- Realistic: occasional obstruction (finger, reflection, etc.)
- **Pass criterion: ≤ 1.3× A1 frame count**

Calculation:
- At 5% occlusion on top of 25% baseline = 30% total
- Well below 35.6% cliff → blocks complete
- Fountain overhead at 30% erasure: slightly elevated but manageable
- Expected frame ratio: ~1.15-1.25× A1

### Option B: Moderate Stress Test

**Occlusion: 8% of the time in 2-second bursts**

Rationale:
- Total erasure: 28-38%
- May exceed cliff at high baseline (30% + 8% = 38%)
- Tests closer to the edge
- **Pass criterion: ≤ 1.5× A1 frame count**
- **Fail criterion: ≥ 2.5× A1 frame count**

Risk: Some runs may not complete if baseline erasure is high.

### Option C: Adjustable Dwell Test

**Occlusion: 15% of the time in 2-second bursts + dwell = 2.0 K**

Rationale:
- Total erasure: 35-45%
- Requires higher dwell to stay below cliff
- At dwell = 2.0 K: e_max = 1 - 1.0297/2.0 = 48.5%
- **Pass criterion: ≤ 2.0× A1 frame count**
- Tests both loss tolerance AND dwell adjustment

Risk: Doubles standing overhead; not representative of default behavior.

## Recommended Pass/Fail Criteria

The original criterion ("≤ 1.6× A1 frame count") has no achievable middle. Here's why:

### Why the Old Criterion Failed

With fountain coding:
- **Good case**: All blocks complete on pass 1 → ~1.0× A1 frames
- **Bad case**: Any block misses pass 1 → costs a FULL extra pass → ≥ 2.0× A1 frames
- There is no natural "1.6×" outcome

### New Criterion Structure

**For Option A (5% occlusion):**
```
Pass: Byte-identical; ≤ 1.3× A1 frame count; completes in ≤ 90 seconds
Fail: Byte-incorrect OR > 2.0× A1 frame count OR does not complete in 3 minutes
```

**For Option B (8% occlusion):**
```
Pass: Byte-identical; ≤ 1.5× A1 frame count; completes in ≤ 120 seconds
Fail: Byte-incorrect OR > 2.5× A1 frame count OR does not complete in 5 minutes
```

**For Option C (15% occlusion, dwell = 2.0 K):**
```
Pass: Byte-identical; ≤ 2.0× A1 frame count; completes in ≤ 180 seconds
Fail: Byte-incorrect OR > 3.0× A1 frame count OR does not complete in 6 minutes
```

## Implementation Notes

### Test Setup

A4 requires automated occlusion simulation:
```typescript
// In test runner
const occludePattern = (frameIndex: number) => {
  // 2-second bursts every 20 seconds (for 5% occlusion)
  const burstInterval = 20 * fps;  // frames per burst cycle
  const burstDuration = 2 * fps;   // frames per occlusion burst
  const cyclePosition = frameIndex % burstInterval;
  return cyclePosition < burstDuration;
};
```

### Frame Counting

Frame count should start from first decoded packet and end at block completion:
```typescript
const frameCount = frames.length;
const a1FrameCount = getBaselineFrameCount();  // cached from A1 run
const ratio = frameCount / a1FrameCount;
```

## Recommendation: Option A

**Adopt Option A (5% occlusion, ≤ 1.3× A1 frames)**

Rationale:
1. **Guaranteed passable** across the full baseline erasure band
2. **Still tests lossy conditions** — 5% on top of baseline is meaningful
3. **Realistic** — represents common minor obstructions
4. **Clear criterion** — 1.3× is achievable but not trivial
5. **No dwell changes** — tests default configuration
6. **Fast execution** — completes in ~90 seconds vs multi-minute for higher loss

If A4 passes easily at 5%, we can always add A4-plus (8-10%) as a stress test in Phase 5.

## Updated A4 Scenario Entry

Replace the current A4 entry in plan.md §9 with:

| # | Scenario | Setup | Action | Pass | Fail |
|---|---|---|---|---|---|
| **A4** | Lossy channel | A1 setup; camera deliberately occluded **5%** of the time in 2-second bursts (e.g., 2 seconds every 40 seconds) | Send 1 MB | Byte-identical; ≤ 1.3× the A1 frame count; completes in ≤ 90 s | Byte-incorrect OR > 2.0× A1 frame count OR does not complete in 3 min

## Validation

Once implemented, validate by running A4 10 times:
- All runs should complete (no hangs)
- Median frame ratio should be ~1.15-1.25× A1
- No runs should exceed 2.0× A1
- All outputs should be byte-identical to input

If failures occur, investigate:
1. Actual occlusion rate (verify timing)
2. Baseline erasure (may be higher than 30%)
3. Frame count calculation (ensure proper start/end)

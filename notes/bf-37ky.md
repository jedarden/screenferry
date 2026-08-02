# bf-37ky: Dwell Strategy Decision Against 48% Measured Erasure

## Decision

**Remain at dwell 1.6 K (e_max = 35.6%) for v1.**

The 48% erasure measured in spike-results.md does not justify changing the dwell strategy because:
1. The measurement was under non-qualifying conditions that deviated from §13.2
2. The design already specifies the correct mitigation: R12's repair code becomes the primary recovery path
3. The measured erasure is attributed to rate mismatch, not optical loss

## Context

From spike-results.md, the 48% erasure measurement had these deviations from §13.2:
- **Hand-placed, not mounted** (tripod required for budget figures)
- **Dim room lighting** (~300 lux required)
- **Only 1 trial** (≥5 trials required, report median)
- Result: *"These are not budget-qualifying measurements."*

The spike-results analysis concludes:
> "The honest reading is that **this does not yet invalidate D18c's 20–30% assumption**,
> because the erasure measured here is dominated by *rate mismatch*, not optical loss"

And recommends:
> "Re-test after: sender in a worker with a pinned mask, receiver with a worker pool, 
> tripod mounting, and proper lighting. If erasure is still above 35% under §13.2 
> conditions, R12's fallback applies — the repair code becomes the primary recovery 
> path, not the tail."

## Why the Alternatives Were Not Chosen

### Option A: Dwell 2.0 K (e_max 48.5%) at +98% overhead

**Not chosen because:**
- Premature to change based on non-qualifying measurements
- +98% overhead (vs. current +60%) would halve all §13.1 throughput figures
- Would require recomputing §1.1's hours-to-days table
- D18c states 20–30% is "an ASSUMPTION about the channel, not a controlled target"
- The design already has mitigation (R12) for when this assumption is violated

### Option B: User-adjustable dwell with blocks-per-minute readout

**Not chosen because:**
- D18a explicitly states v1 cannot observe erasure — giving users control without 
  observability creates a confusing UX
- Users have no way to know what dwell value is appropriate for their conditions
- Would require complex UI for an edge case that the repair code already handles
- Architecturally misaligned: the sender has no feedback channel to know if blocks 
  are completing

## The Designed Mitigation (R12)

From plan.md §8.1:
> "When real erasure exceeds 30% — which nothing in v1 can detect (D18a) — blocks 
> miss and the **repair code (§8.2) is the recovery path**, not a tighter loop. This 
> is the designed answer, not a gap."

From plan.md §18 R12:
> Risk: Residual erasure exceeds the assumed 20–30% band
> Mitigation: Raise dwell; promote the repair code (§8.2). Note v1 cannot *observe* 
> erasure (D18a), so this is an assumption, not a controlled quantity
> Trigger → fallback: Erasure > 35% under §13.2 conditions → the **repair code 
> becomes the primary recovery path, not the tail**

## Recommended Next Steps

1. **Re-measure under §13.2 conditions:**
   - Tripod mounting
   - Proper lighting (~300 lux)
   - ≥5 trials, report median
   - Sender in worker with pinned mask (D4)
   - Receiver with worker pool (§6.2)

2. **If erasure is STILL above 35%** under qualifying conditions, then:
   - Re-compute dwell from the measured band
   - Update §13.1 throughput figures accordingly
   - Update R12 status in plan.md

3. **Strengthen the repair code as primary recovery:**
   - Ensure UX makes it clear when repair is needed
   - Make repair code entry obvious (stalled progress, zero blocks completing)
   - Consider automatic prompts after N passes with zero progress

## Cross-References

- plan.md §8.1: Block scheduling and dwell budget
- plan.md §8.2: Human-mediated repair
- plan.md §18 R12: Residual erasure risk
- plan.md D18c: 20–30% erasure assumption
- plan.md D18a: No control loop in v1 (no erasure observability)
- spike-results.md §S2: 48% erasure measurement
- spike-results.md §"On the tripped erasure criterion": Analysis of why this doesn't invalidate D18c yet

# Dwell Strategy Decision Against 48% Measured Erasure

**Bead:** bf-37ky
**Date:** 2026-08-02
**Decision:** Keep dwell 1.6 K (default), add user-adjustable dwell with visible blocks-per-minute readout

## Context

S2 Run 4 measured **48% erasure** at D9-compliant sender rate, which exceeds the 34.9% completion cliff at dwell = 1.6 K. However, this measurement was taken under **non-qualifying conditions** that deviate from §13.2 in three of seven parameters:
- Hand-placed, not mounted
- Dim room, screen is only light source
- Uncalibrated distance (~30–40 cm)
- Single trial, not ≥5 with median reported

The spike-results.md explicitly states: *"none of these figures are budget-qualifying"* and *"The honest reading is that **this does not yet invalidate D18c's 20–30% assumption**."*

## The Two Options

### Option 1: Raise dwell to 2.0 K
- **Mechanism:** Increase default dwell from 1.6 K to 2.0 K
- **Effect:** Moves e_max from 34.9% to 48.5% (above the 48% measurement)
- **Cost:** +98% standing overhead (from 1.6× to 2.0×)
- **Consequences:**
  - Halves every §13.1 throughput figure
  - Requires recomputing §1.1's hours-to-days table (all values 2× longer)
  - Accepts the worst case before confirming it's representative

### Option 2: User-adjustable dwell with visible blocks-per-minute readout
- **Mechanism:** Expose dwell as a user-tunable parameter with real-time feedback
- **Effect:** Gives users the observability D18a denies the software
- **Benefits:**
  - Users can see actual throughput (blocks/min) and adjust dwell accordingly
  - Doesn't permanently sacrifice throughput for unconfirmed worst case
  - Preserves the designed relationship: dwell 1.6 K for 20–30% band
  - Allows field validation of real erasure rates

## Decision: Option 2

**Rationale:**

1. **The 48% measurement is not yet qualifying** — R12's trigger is explicit: "Erasure > 35% **under §13.2 conditions**". We have not run that test. Making a permanent decision based on non-qualifying data would be premature.

2. **The current design is coherent** — dwell 1.6 K is sized for the top of the 20–30% erasure band with sound arithmetic. Raising to 2.0 K doubles standing overhead without validation that the worst case is real or representative.

3. **User-adjustable dwell is the safer path** — provides transparency and control without baking in pessimism. Users can adapt to actual conditions rather than assumed ones.

4. **The repair code remains the fallback** — if erasure exceeds 35% in real use, §8.2's human-mediated repair provides recovery. This is intentional architecture, not a gap.

5. **Field data will inform the next decision** — if real users consistently see erasure above 30%, we have solid evidence for raising dwell. If they see 20–25%, raising dwell would have been waste.

## Implementation Plan

### Phase 0.5 Spike Completion
- **Outstanding:** Proper test under §13.2 conditions with ≥5 trials
- Required parameters:
  - Tripod mounting (not hand-placed)
  - ~300 lux lighting
  - 30 cm measured distance
  - Median reported across ≥5 trials
- If erasure > 35% under proper conditions → R12's fallback applies

### Phase 5 UI Work
- Add dwell slider to sender UI (default 1.6 K, range 1.2–2.5 K)
- Add real-time blocks/min counter (user-visible throughput)
- Add tooltip explaining the trade-off: higher dwell = more robust but slower
- Store dwell preference in localStorage

### Documentation Updates
- README: Document dwell tuning in the user guide
- plan.md §13.1: Add note that dwell is user-tunable
- plan.md §1.1: Add footnote that figures assume default dwell = 1.6 K

## What This Does NOT Change

- The 20–30% erasure band remains the design assumption (D18c)
- R12 remains the risk with the same trigger
- The repair code (§8.2) remains the recovery path above 35% erasure
- All §13.1 throughput figures remain unchanged (based on dwell = 1.6 K)

## Next Steps

1. Complete the §13.2-qualified spike to get real erasure data
2. If erasure > 35% under proper conditions, re-evaluate dwell = 2.0 K
3. If erasure ≤ 35%, dwell 1.6 K is validated and no change needed
4. Implement user-adjustable dwell in Phase 5 UI work

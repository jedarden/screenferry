# Duty-cycle thermal profile validation (bf-513i)

**Plan references:** D27, R11, §18.2

## Objective

Validate D27's claim about duty-cycle economics:

> "Duty-cycling is **nearly free on this channel** — a skipped frame is an erasure the fountain code already absorbs (D5) — so 50% duty roughly halves heat for roughly half the rate, and **finishes** where 100% duty may not."

**Context from previous observations:**
- A Pixel 6 hit 70°C and throttling threshold within 20–30 minutes of continuous decoding
- Against a §1.1 objective of 27 h–4 days of continuous decoding for multi-GB files
- R11 confirms thermal throttling as a High/High risk with a self-reinforcing degradation loop

## Test design

### Protocol: 50% block-granular duty cycling

The receiver alternates between:
- **ON state:** Process frames for 1 second
- **OFF state:** Skip frames for 1 second (pause video processing)

This implements **50% duty cycle** at approximately 1-second granularity.

### Why this works

From D27's rationale:
- A skipped frame is an erasure
- The fountain code (D5) already absorbs erasures
- So duty-cycling is "nearly free" — just more erasures
- But it cuts heat generation roughly in half
- And completes transfers where 100% duty might throttle to a crawl

### Implementation

The test modifies the thermal profile rig to:
1. Measure baseline thermal behavior (100% duty, existing test)
2. Measure duty-cycled behavior (50% duty, new test)
3. Compare heat generation, decode rates, and completion

## Running the test

### Prerequisites

1. **Cool start** — device rested at room temperature for ≥10 minutes
2. **Record starting temperature** (Pixel 6: Settings → System → Developer options → Quick settings for dev tools → Thermal)
3. **Rig server running:**
   ```bash
   cd spike && npm install && npm run rig
   ```

### Physical setup (§13.2 denominator)

- **Mounting:** tripod (or as stable as possible)
- **Distance:** 30 cm measured
- **Lighting:** ~300 lux
- **Screen:** 50%+ brightness
- **Duration:** minimum 60 minutes, ideal 90–120 minutes

### Test A: Baseline (100% duty)

1. **Sender (this machine):**
   - URL: `http://localhost:5174/thermal-profile.html`
   - Mode: Sender
   - Rung: R2 (v16, 2 packets/tile, nominal)
   - FPS: 8
   - Grid: 5×3 = 15 tiles
   - Module px: 4

2. **Receiver (Pixel 6):**
   - URL: `http://46.62.187.167:5174/thermal-profile.html` (or localhost if on same machine)
   - Mode: Receiver
   - Fragment size L: 256 bytes
   - Log interval: 30 seconds
   - Camera: rear-facing, 1920×1080 requested

3. **Run for 60+ minutes**, then export CSV

### Test B: Duty cycle (50%)

1. **Sender (this machine):**
   - Same configuration as Test A

2. **Receiver (Pixel 6):**
   - URL: `http://46.62.187.167:5174/thermal-profile-dutycycle.html`
   - Mode: Receiver
   - Fragment size L: 256 bytes
   - Log interval: 30 seconds
   - Camera: rear-facing, 1920×1080 requested
   - **Duty cycle:** 50% (automatic: 1s ON, 1s OFF)

3. **Run for 60+ minutes**, then export CSV

## Expected outcomes

### D27 makes three claims:

1. **Heat reduction:** 50% duty roughly halves heat generation
   - Measured by: proxy through camera fps and decode latency stability
   - Expected: ~50% reduction in sustained processing rate

2. **Rate reduction:** 50% duty roughly halves the effective rate
   - Measured by: effective fps (measured fps × 0.5)
   - Expected: ~50% of baseline throughput

3. **Completion:** Duty cycle finishes where 100% duty may not
   - Measured by: thermal degradation >30% (R11 trigger)
   - Expected: baseline degrades >30%, duty cycle stays <30%

### Analysis

After collecting both CSV files, run:

```bash
python spike/plot-thermal-profile-comparison.py <baseline-csv> <dutycycle-csv>
```

This generates:
- Comparison plots (FPS, decode latency, erasure rate)
- Statistical summary
- D27 validation assessment

## Success criteria

D27 is **validated** if all three claims hold:

1. ✓ Heat reduction proxy is ~50% (40–60% range)
2. ✓ Rate reduction is ~50% (40–60% range)
3. ✓ Duty cycle stays stable (<30% degradation) where baseline degrades (>30%)

D27 is **partially validated** if:
- Some claims hold but others need investigation
- Test duration insufficient (need 90–120 minutes)

D27 is **not validated** if:
- Heat/rate reduction far from 50% (outside 40–60% range)
- Duty cycle still degrades >30% (may need lower duty %)

## Kill criterion (R11 trigger)

| Observation | Consequence |
|---|---|
| **Duty cycle still shows >30% sustained degradation** | D27 mitigation insufficient; need lower duty % or different approach |

## Post-test actions

1. **Update spike-results.md** with measurements
2. **Update plan.md §18 risk register** (R11, D27)
3. **Update plan.md §13.1** if performance budgets change
4. **Close this bead** with commit

## Status

- [x] Duty-cycle thermal profile HTML created
- [x] Comparison plotting script created
- [x] Test protocol documented
- [ ] Baseline thermal profile collected
- [ ] Duty-cycle thermal profile collected
- [ ] Analysis completed
- [ ] Results recorded in spike-results.md
- [ ] Plan updated if needed
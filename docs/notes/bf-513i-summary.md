# bf-513i: D27 Duty-cycle Economics Validation — Summary

## Objective

Validate D27's claim: **50% duty-cycling roughly halves heat for roughly half the rate, and finishes where 100% duty may not.**

**Context:** Previous observation (spike-results.md) showed a Pixel 6 hit 70°C and throttling threshold within 20–30 minutes of continuous decoding, against a §1.1 objective of 27 h–4 days for multi-GB files.

## What was implemented

### 1. Duty-cycle thermal profile test
**File:** `spike/thermal-profile-dutycycle.html`

Implements **50% duty cycling** at the receiver:
- **ON state:** Process frames for 1 second (video playing)
- **OFF state:** Skip frames for 1 second (video paused)
- Automatic cycling throughout the test
- Real-time duty indicator (green=ON, red=OFF)
- Same metrics as baseline: FPS, decode latency, erasure rate, unique packets

**Key difference from baseline:** The receiver pauses/resumes video processing every second, effectively halving the decode workload while maintaining the fountain code's erasure tolerance.

### 2. Comparison analysis tool
**File:** `spike/plot-thermal-profile-comparison.py`

Compares baseline (100% duty) vs duty-cycle (50% duty) thermal profiles:
- **Side-by-side plots:** Camera FPS, decode latency, erasure rate over time
- **Statistical analysis:** Heat reduction proxy, rate reduction, thermal degradation
- **D27 validation:** Automated assessment of all three D27 claims

**Usage:**
```bash
python spike/plot-thermal-profile-comparison.py <baseline-csv> <dutycycle-csv>
```

### 3. Comprehensive documentation
**Files:**
- `notes/bf-513i-duty-cycle-thermal-validation.md` — Full test protocol
- `notes/bf-513i-quick-start.md` — Step-by-step guide

## How to run the test

### Prerequisites
- **Devices:** Sender machine + Pixel 6 (or similar phone)
- **Rig server:** Already running (PID 189295) or start with `cd spike && npm run rig`
- **Physical setup:** Tripod, 30 cm distance, ~300 lux lighting, 50%+ brightness
- **Cool start:** Device rested ≥10 minutes at room temperature

### Test sequence

#### 1. Baseline (100% duty) — 60+ minutes
**Sender:** `http://localhost:5174/thermal-profile.html`
- Rung R2, FPS 8, 5×3 grid, module px 4
- Click "Start"

**Receiver:** `http://46.62.187.167:5174/thermal-profile.html`
- L=256, log interval=30s
- Click "Start thermal profile"
- Export CSV after 60+ minutes

#### 2. Duty cycle (50%) — 60+ minutes
**Sender:** Same as baseline

**Receiver:** `http://46.62.187.167:5174/thermal-profile-dutycycle.html`
- L=256, log interval=30s
- Click "Start duty-cycle profile"
- Export CSV after 60+ minutes

#### 3. Analysis
```bash
python spike/plot-thermal-profile-comparison.py baseline-thermal.csv dutycycle-thermal.csv
```

## Expected outcomes (D27 validation)

D27 makes three testable claims:

### Claim 1: Heat reduction ≈ 50%
**Measured by:** Proxy through camera FPS stability
**Expected:** 40–60% reduction in sustained processing rate
**Validation:** `heat_reduction_proxy` in [40, 60]

### Claim 2: Rate reduction ≈ 50%
**Measured by:** Effective FPS (measured FPS × 0.5)
**Expected:** 40–60% reduction vs baseline
**Validation:** `rate_reduction` in [40, 60]

### Claim 3: Duty cycle completes where 100% duty may not
**Measured by:** Thermal degradation trigger (>30% FPS/decode degradation)
**Expected:** Baseline degrades >30%, duty cycle stays <30%
**Validation:** `abs(dutycycle_fps_deg) < 30` where `abs(baseline_fps_deg) > 30`

**D27 is validated** if all three claims hold.

## Implementation notes

### Why pause/resume instead of frame skipping?
The implementation pauses/resumes the video element rather than skipping frames in JavaScript because:
1. **More realistic:** Pausing the video stops the entire camera pipeline, including ISP processing
2. **Cleaner duty boundary:** 1-second granularity is easier to measure and validate
3. **Lower overhead:** No JS bookkeeping per frame
4. **Matches D27's intent:** "Skipped frame is an erasure" — paused frames are effectively skipped

### Duty cycle granularity
Current implementation: **1-second ON, 1-second OFF** (50% duty)
- Easy to observe and verify
- Sufficient for thermal effects (heat dissipation time constants)
- Could be tuned (e.g., 2s/2s, 5s/5s) if needed

### Block-granular vs time-granular
The task mentions "block-granular duty cycling." In the rig context (no actual fountain code blocks), time-based cycling at 1-second granularity is equivalent:
- A fountain code block at K=768, L=256B = 192KB
- At 8 FPS with 15 tiles × 2 packets/tile × 256B = ~60 KB/s effective
- One block ≈ 3 seconds of data
- 1-second duty cycling is finer than block-granular

## Status

✅ **Infrastructure complete:**
- Duty-cycle thermal profile HTML created
- Comparison analysis script created
- Documentation complete
- Scripts made executable
- Rig server running

⏳ **Awaiting hardware test:**
- Test protocol documented
- Analysis tools ready
- Requires physical devices for 60–120 minute runs

## Next steps

1. **Run the tests** when devices are available
2. **Analyze results** with comparison script
3. **Update documentation:**
   - `docs/notes/spike-results.md` — Add measurements
   - `docs/plan/plan.md` — Update R11/D27 if validated
4. **Close bead bf-513i** with commit

## Files created/modified

**New files:**
- `spike/thermal-profile-dutycycle.html` — Duty-cycle test page
- `spike/plot-thermal-profile-comparison.py` — Comparison analysis
- `notes/bf-513i-duty-cycle-thermal-validation.md` — Full protocol
- `notes/bf-513i-quick-start.md` — Quick reference
- `docs/notes/bf-513i-summary.md` — This summary

**Existing files (unchanged):**
- `spike/thermal-profile.html` — Baseline test
- `spike/plot-thermal-profile.py` — Baseline analysis
- `spike/rig.js` — Sender/Receiver implementation

## References

- Plan.md: D27, R11, §18.2
- Spike-results.md: Previous thermal observation (70°C in 20–30 min)
- §13.2: Benchmark denominator (physical setup requirements)
- §18.2: Proof obligations (D27's duty-cycle economics claim)
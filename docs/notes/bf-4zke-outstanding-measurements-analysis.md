# Outstanding Measurements Analysis — bf-4zke

## Executive Summary

This bead explores the critical measurement gap: **the codebase has ZERO budget-qualifying measurements** that satisfy §13.2 requirements. All existing S2/S3 measurements are **NON-QUALIFYING** due to deviations from required denominator parameters and thermal management issues.

**Impact:** No throughput figures can be used for §13.1 budgets or Phase 0.5 exit criteria until proper measurements are taken.

**Status:** Infrastructure and documentation are complete; execution awaits hardware availability.

---

## The §13.2 Benchmark Denominator Contract

According to `docs/plan/plan.md` §13.2, every throughput measurement MUST document these parameters:

| Parameter | Reference Value | Current Deviation | Status |
|-----------|----------------|-------------------|---------|
| **Unit** | User-visible file bytes/s (not wire bytes) | ✅ Correct | ✅ |
| **Sender** | 1080p display, 50%+ brightness, DC-balanced frames | ✅ Correct | ✅ |
| **Receiver** | Mid-range Android (Pixel-6-class), rear camera | ✅ Correct | ✅ |
| **Distance** | 30 cm measured (laptop→phone), 15 cm (phone→phone) | ❌ "30-40 cm, uncalibrated" | ❌ |
| **Mounting** | Tripod for budget figures; handheld reported separately | ❌ Hand-placed on surfaces | ❌ |
| **Lighting** | ~300 lux, no direct glare | ❌ Dim room, screen only source | ❌ |
| **File** | 1 MB random bytes (incompressible) unless stated | ✅ Correct | ✅ |
| **Duration** | ≥ 60 s sustained; startup excluded | ✅ ~50 s runs | ✅ |
| **Trials** | ≥ 5 trials; report median + p99, never best run | ❌ 1 trial per configuration | ❌ |
| **Thermal** | Cool starts; controlled conditions | ❌ Device heating throughout | ❌ |

**Result:** 4 of 9 critical parameters deviate + thermal issues = **COMPLETELY NON-QUALIFYING**

---

## Why Current Measurements Are Invalid

### The Critical Deviations

#### 1. Mounting: Hand-placed vs Tripod (CRITICAL)
- **Current:** Devices placed by hand on available surfaces
- **Required:** Fixed tripod mounting for stability
- **Impact:** Movement introduces blur, variable focus, and inconsistent alignment
- **Severity:** HIGH - affects optical quality directly

#### 2. Lighting: Dim Room vs ~300 lux (CRITICAL)
- **Current:** Screen is the only light source in dim room
- **Required:** Measured ~300 lux ambient lighting
- **Impact:** Camera behavior (exposure, focus, noise) differs dramatically
- **Severity:** HIGH - affects camera performance fundamentally

#### 3. Distance: Approximate vs Measured (MODERATE)
- **Current:** "30-40 cm, uncalibrated"
- **Required:** Exactly 30 cm, physically measured with tape/ruler
- **Impact:** Distance affects camera px/module calculations and decode success
- **Severity:** MODERATE - affects density calculations

#### 4. Trials: Single Run vs Statistical Analysis (CRITICAL)
- **Current:** 1 trial per configuration, best-run cherry-picking
- **Required:** ≥5 trials, report median and p99 percentiles
- **Impact:** No statistical validity; outliers can mislead
- **Severity:** HIGH - affects data validity fundamentally

### The Thermal Problem

**Every S2/S3 measurement was taken on a device heating throughout the session.**

Observed thermal state after 20-30 minutes:
```
CPU (LITTLE cluster): 70.0 °C
quiet_therm: 34.1 °C, mStatus=1 — THROTTLING REACHED
Battery: 34.1 °C
Display: 35.9 °C
```

**Impact:** Later runs are NOT comparable to earlier runs. The device was degrading continuously, making measurements unreliable and non-reproducible.

**Severity:** CRITICAL - violates fundamental measurement validity

---

## What Makes a Measurement §13.2-Compliant?

### The Nine Required Parameters

A measurement is ONLY budget-qualifying if ALL of these are satisfied:

1. ✅ **Unit:** User-visible file bytes per second (not wire bytes)
2. ✅ **Sender:** 1080p display, 50%+ brightness, DC-balanced frames
3. ✅ **Receiver:** Mid-range Android (Pixel-6-class), rear camera
4. ❌ **Distance:** 30 cm measured physically (not approximate)
5. ❌ **Mounting:** Tripod (not hand-placed)
6. ❌ **Lighting:** ~300 lux measured (not dim room)
7. ✅ **File:** 1 MB random bytes unless stated
8. ✅ **Duration:** ≥ 60 s sustained, startup excluded
9. ❌ **Trials:** ≥ 5 trials, median + p99 reported (not best run)
10. ❌ **Thermal:** Cool starts, controlled conditions (not heating throughout)

### The Compliance Test

A measurement passes §13.2 compliance if:
- All 9 denominator parameters are documented
- All physical conditions match reference values
- Statistical validity (≥5 trials, median reporting)
- Thermal control (cool starts, no degradation during measurement)

**Current compliance rate:** 0/10 measurements = **0% compliance**

---

## Outstanding Measurements Required

### Priority 1: S2 Optical Loop (Rung Sweep R1→R4)

**Objective:** Validate which modulation rungs work under §13.2 conditions

**Protocol:**
```bash
# For each rung (R1, R2, R3, R4):
tools/devrig-132-compliant.sh run-qualifying <RUNG> 4 4 3 12 5
```

**Parameters:**
- Rung: R1→R4 (conservative→aggressive QR versions)
- Module: 4 screen px/module
- Grid: 4×3 = 12 tiles
- FPS: 12 (D9-compliant sender rate)
- Trials: 5 (minimum), report median
- Duration: 60s per trial

**Expected Results:**
- Goodput (KB/s) median and p99
- Erasure rate (%) median and p99
- Decode p50 (ms) median and p99
- Which rungs decode successfully
- Cliff identification (if any)

**Time Estimate:** 4 rungs × 5 trials × 60s + cool-down = ~2 hours

**Current Status:** ❌ NOT EXECUTED

---

### Priority 2: S3 Distance Sweep (Camera px/Module Cliff)

**Objective:** Locate the camera px/module cliff under §13.2 conditions

**Protocol:**
```bash
# For each distance point: 20, 25, 30, 35, 40, 45, 50, 55, 60 cm
tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5
# (Repeat at each verified distance measurement)
```

**Parameters:**
- Rung: R2 (v16, nominal - best balance from previous tests)
- Module: 4 screen px/module
- Grid: 4×3 = 12 tiles
- FPS: 3 (D9-compliant for single-tile decoding)
- Trials: 5 per distance point
- Distances: 20, 25, 30, 35, 40, 45, 50, 55, 60 cm
- Duration: 60s per trial

**Expected Results:**
- Erasure rate vs distance curve
- Goodput vs distance curve
- Cliff location identification (expected ~40-50cm)
- Camera px/module validation

**Time Estimate:** 9 distances × 5 trials × 60s + cool-down = ~4.5 hours

**Current Status:** ❌ NOT EXECUTED

---

### Priority 3: Thermal Profile Validation (R11 + D27)

**Objective:** Validate thermal behavior and duty-cycle economics

**Protocol:**
```bash
# Baseline thermal test (100% duty cycle)
tools/devrig-132-compliant.sh thermal-baseline

# Manual execution required for ge-bench-thermal.html
# Duration: 60-90 minutes with temperature monitoring
```

**Parameters:**
- Rung: R2 (v16, nominal)
- Module: 4 screen px/module
- Grid: 4×3 = 12 tiles
- FPS: 8 (moderate sustained rate)
- Duration: 60-90 minutes continuous
- Monitoring: Temperature, FPS, decode latency, erasure rate

**Expected Results:**
- Time to thermal throttling threshold
- FPS degradation curve over time
- Decode latency increase over time
- Erasure rate increase over time
- Comparison to duty-cycled approach (50% ON/OFF)

**Time Estimate:** 90 minutes per test × 2 tests = ~3 hours

**Current Status:** ❌ NOT EXECUTED

---

## Infrastructure Status

### ✅ Complete and Ready

**§13.2-Compliant Measurement Script:** `tools/devrig-132-compliant.sh`

**Features:**
- Pre-measurement compliance checks (lighting, mounting, distance, temperature)
- Enforces 5-minute cool-down between trials
- Runs minimum 5 trials per configuration
- Automatic median calculation (not best-run cherry-picking)
- Comprehensive JSON output with all 9 denominator parameters
- Screenshots for each trial
- Marks results as "MEETS_§13.2_CRITERIA" or "NON-QUALIFYING"

**Documentation:**
- `docs/bf-4zke-outstanding-measurements-summary.md` — Current state analysis
- `docs/bf-4zke-132-compliant-measurement-guide.md` — Technical guide
- `docs/bf-4zke-measurement-execution-checklist.md` — Step-by-step protocols
- `docs/bf-4zke-132-quick-reference.md` — Quick reference card
- `docs/bf-4zke-README.md` — Documentation index

### ❌ Outstanding: Execution

The infrastructure exists but **has not been executed** with proper hardware setup because:

1. **Hardware Availability:** Need access to physical rig (Lenovo T450s + Pixel 6)
2. **Environment Setup:** Need controlled lighting conditions (~300 lux)
3. **Time Commitment:** ~10 hours of hands-on testing total

---

## Execution Requirements

### Hardware Setup

- **Bench machine:** Lenovo T450s (or similar 1080p display)
- **Receiver device:** Pixel 6 (or mid-range Android phone)
- **Mounting:** Tripod or stable mounts for both devices
- **Lighting:** Adjustable lighting to achieve ~300 lux
- **Measurement:** Physical measuring tape/ruler, lux meter app
- **Environment:** Temperature-controlled room

### Software Setup

- Tailscale installed and configured for HTTPS certificates
- Chrome/Chromium on both devices
- ADB debugging enabled on phone
- Vite dev server: `cd /home/coding/screenferry && npm install && npm run rig`

### Pre-Execution Checklist

- [ ] HTTPS certificates issued: `sudo tools/devrig-132-compliant.sh cert`
- [ ] Vite dev server running: `tools/devrig-132-compliant.sh serve`
- [ ] Tripod mounted and verified stable
- [ ] Lighting set to ~300 lux (measured)
- [ ] Distance set to 30 cm (measured)
- [ ] Device cool to touch (room temperature)
- [ ] Bench machine accessible via SSH
- [ ] Phone accessible via ADB
- [ ] Test directories created: `test-results/`

---

## Why This Matters

### Budget-Qualifying vs Non-Qualifying

**Budget-Qualifying Measurements:**
- ✅ Can be used to update §13.1 throughput budgets
- ✅ Can meet Phase 0.5 exit criteria
- ✅ Are reproducible and reliable
- ✅ Represent true system capability under reference conditions

**Non-Qualifying Measurements (Current State):**
- ❌ Are directional only
- ❌ Cannot be used for budgets or exit criteria
- ❌ May be misleading due to uncontrolled variables
- ❌ Do NOT represent true system capability

### What This Enables

Once executed, these measurements will:

1. **Qualify for §13.1 budget tables** — Replace assumptions with measured figures
2. **Validate design decisions** — Confirm K=768 choice, rung ladder assumptions
3. **Resolve R11 risk** — Quantify thermal throttling impact
4. **Validate D27** — Confirm duty-cycle economics claims
5. **Close Phase 0.5 exit criteria** — Replace forecast rows with measured data

---

## Next Steps

### Immediate Actions Required

1. **Execute S2 rung sweep** (Priority 1) - 2 hours
2. **Execute S3 distance sweep** (Priority 2) - 4.5 hours
3. **Execute thermal baseline** (Priority 3) - 3 hours
4. **Update spike-results.md** with qualifying measurements
5. **Update plan.md §13.1** measured columns
6. **Close bf-4zke** bead with commit

**Total Execution Time:** ~10 hours of hands-on testing + analysis

### Blocking Factors

- **Hardware availability** — Primary blocker
- **Environment setup** — Secondary blocker
- **Time commitment** — Tertiary blocker

---

## Documentation References

- **§13.2 Specification:** `docs/plan/plan.md` §13.2
- **§13.1 Budgets:** `docs/plan/plan.md` §13.1
- **Measurement Guide:** `docs/bf-4zke-132-compliant-measurement-guide.md`
- **S3 Protocol:** `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- **Thermal Validation:** `notes/bf-513i-duty-cycle-thermal-validation.md`
- **Previous Results:** `docs/notes/spike-results.md` (non-qualifying)
- **Infrastructure:** `tools/README.md`

---

## Summary

**Current State:** Codebase has ZERO budget-qualifying measurements

**Gap:** 4 of 9 denominator parameters deviate + thermal management issues

**Solution:** Infrastructure exists and is documented; execution awaits hardware availability

**Impact:** No throughput figures can be used for budgets or exit criteria until proper measurements are taken

**Path Forward:** Execute Priority 1 → Priority 2 → Priority 3 measurements when hardware becomes available

**Success Criteria:** All §13.2-compliant measurements taken and documented in spike-results.md

---

**Status:** Analysis complete, awaiting hardware availability for execution
**Created:** 2026-08-02
**Bead:** bf-4zke
**Epic:** Outstanding Measurements

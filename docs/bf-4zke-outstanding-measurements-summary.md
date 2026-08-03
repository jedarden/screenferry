# Outstanding Measurements — Current State and Required Work (bf-4zke)

## Executive Summary

**Current Status:** The codebase has **ZERO budget-qualifying measurements**. All existing S2/S3 measurements are **NON-QUALIFYING** under §13.2 standards because they deviate from the required denominator parameters.

**Impact:** No throughput figures can be used for §13.1 budgets or Phase 0.5 exit criteria until proper measurements are taken.

**Solution:** Infrastructure exists (`tools/devrig-132-compliant.sh`) but must be executed with proper hardware setup.

---

## What Makes a Measurement §13.2-Compliant?

§13.2 defines **7 denominator parameters** that EVERY throughput measurement MUST document:

| Parameter | Requirement | Current Status |
|-----------|-------------|-----------------|
| **Unit** | User-visible file bytes/s (not wire bytes) | ✅ Correct |
| **Sender** | 1080p display, 50%+ brightness, DC-balanced frames | ✅ Correct |
| **Receiver** | Mid-range Android (Pixel-6-class), rear camera | ✅ Correct |
| **Distance** | 30 cm **measured** (laptop→phone) | ❌ **APPROXIMATE** (30-40 cm) |
| **Mounting** | **Tripod** for budget figures | ❌ **HAND-PLACED** |
| **Lighting** | **~300 lux**, no direct glare | ❌ **DIM ROOM** |
| **File** | 1 MB random bytes (incompressible) unless stated | ✅ Correct |
| **Duration** | ≥ 60 s sustained; startup excluded | ✅ Met |
| **Trials** | **≥ 5 trials**; report **median + p99**, never best run | ❌ **1 TRIAL ONLY** |
| **Thermal** | **Cool starts**, 5-min wait between trials | ❌ **HEATING THROUGHOUT** |

**Result:** 3 of 7 critical parameters deviate + thermal issues = **COMPLETELY NON-QUALIFYING**

---

## Why Current Measurements Are Invalid

### The 3 Critical Deviations

1. **Hand-placed vs Tripod Mounting**
   - Current: Devices placed by hand on surfaces
   - Required: Fixed tripod mounting for stability
   - Impact: Movement introduces blur and variable focus

2. **Dim Room vs ~300 lux Lighting**
   - Current: Screen is only light source
   - Required: Measured ~300 lux ambient lighting
   - Impact: Camera behavior differs dramatically

3. **Approximate vs Measured Distance**
   - Current: "30-40 cm, uncalibrated"
   - Required: Exactly 30 cm, physically measured
   - Impact: Distance affects camera px/module calculations

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

---

## What Measurements Are Outstanding

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

### Priority 2: S3 Distance Sweep (4 Camera px/Module Cliff)

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

---

## Infrastructure Status

### ✅ Created and Ready

**§13.2-Compliant Measurement Script:** `tools/devrig-132-compliant.sh`

Features:
- Pre-measurement compliance checks (lighting, mounting, distance, temperature)
- Enforces 5-minute cool-down between trials
- Runs minimum 5 trials per configuration
- Automatic median calculation (not best-run cherry-picking)
- Comprehensive JSON output with all 7 denominator parameters
- Screenshots for each trial
- Marks results as "MEETS_§13.2_CRITERIA" or "NON-QUALIFYING"

### ❌ Outstanding: Execution

The script exists but **has not been executed** with proper hardware setup because:

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
- Can be used to update §13.1 throughput budgets
- Can meet Phase 0.5 exit criteria
- Are reproducible and reliable
- Represent true system capability under reference conditions

**Non-Qualifying Measurements (Current State):**
- Are directional only
- Cannot be used for budgets or exit criteria
- May be misleading due to uncontrolled variables
- Do NOT represent true system capability

### What This Enables

Once executed, these measurements will:

1. **Qualify for §13.1 budget tables** - Replace assumptions with measured figures
2. **Validate design decisions** - Confirm K=768 choice, rung ladder assumptions
3. **Resolve R11 risk** - Quantify thermal throttling impact
4. **Validate D27** - Confirm duty-cycle economics claims
5. **Close Phase 0.5 exit criteria** - Replace forecast rows with measured data

---

## Next Steps

1. **Execute S2 rung sweep** (Priority 1) - 2 hours
2. **Execute S3 distance sweep** (Priority 2) - 4.5 hours  
3. **Execute thermal baseline** (Priority 3) - 3 hours
4. **Update spike-results.md** with qualifying measurements
5. **Update plan.md §13.1** measured columns
6. **Close bf-4zke** bead with commit

**Total Execution Time:** ~10 hours of hands-on testing + analysis

---

## Documentation References

- **§13.2 Specification:** `docs/plan/plan.md` §13.2
- **Measurement Guide:** `docs/bf-4zke-132-compliant-measurement-guide.md`
- **S3 Protocol:** `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- **Thermal Validation:** `notes/bf-513i-duty-cycle-thermal-validation.md`
- **Previous Results:** `docs/notes/spike-results.md` (non-qualifying)
- **Infrastructure:** `tools/README.md`

---

**Status:** Infrastructure complete, awaiting hardware availability for execution.
**Created:** 2026-08-02
**Bead:** bf-4zke
**Epic:** Outstanding Measurements

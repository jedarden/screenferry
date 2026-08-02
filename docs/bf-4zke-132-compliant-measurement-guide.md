# §13.2 Compliant Measurement Infrastructure (bf-4zke)

## Summary

Created §13.2-compliant measurement infrastructure to address the critical gap: **the codebase has no budget-qualifying measurements**. All existing S2/S3 measurements deviate from §13.2 in 3 of 7 required parameters.

## Infrastructure Created

### New Script: `tools/devrig-132-compliant.sh`

Enhanced version of `devrig.sh` that **enforces** all §13.2 requirements before allowing measurements:

**§13.2 Requirements Enforced:**
- ✅ **Tripod mounting** - Verification required (not hand-placed)
- ✅ **~300 lux lighting** - Lux meter confirmation (not dim room)
- ✅ **Measured 30cm distance** - Physical measurement (not approximate)
- ✅ **Cool device starts** - 5-minute wait between trials, temperature check
- ✅ **≥5 trials** - Multi-trial support with automatic median calculation
- ✅ **Median reporting** - Statistical reporting (not best-run cherry-picking)
- ✅ **All 7 denominator parameters** - Automatically documented with results

**Usage:**
```bash
tools/devrig-132-compliant.sh setup-check                    # Verify §13.2 conditions
tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5   # 5 trials, median reported
tools/devrig-132-compliant.sh thermal-baseline               # 60-min thermal test
```

**Outputs:**
- Individual trial results: `test-results/qualifying-<config>-<timestamp>/trial<N>.json`
- Median summary: `test-results/qualifying-<config>-<timestamp>/median-report.json`
- Screenshots: `test-results/qualifying-<config>-<timestamp>/trial<N>.png`

## Outstanding Measurement Work

### Priority 1: S2 Optical Loop Measurements (Rung Sweep R1→R4)

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

## What This Enables

Once executed, these measurements will:

1. **Qualify for §13.1 budget tables** - Replace assumptions with measured figures
2. **Validate design decisions** - Confirm K=768 choice, rung ladder assumptions
3. **Resolve R11 risk** - Quantify thermal throttling impact
4. **Validate D27** - Confirm duty-cycle economics claims
5. **Close Phase 0.5 exit criteria** - Replace forecast rows with measured data

## Comparison to Previous Non-Qualifying Measurements

| Parameter | Previous (spike-results.md) | New §13.2 Compliant |
|-----------|----------------------------|----------------------|
| Mounting | ✗ Hand-placed | ✅ Tripod |
| Lighting | ✗ Dim room | ✅ ~300 lux |
| Distance | ✗ "30-40 cm" approximate | ✅ 30 cm measured |
| Trials | ✗ 1 per configuration | ✅ ≥5, median reported |
| Thermal | ✗ Heating throughout | ✅ Cool starts, 5min wait |
| Reporting | ✗ Single values | ✅ Median + p99 |
| Qualification | ✗ **NON-QUALIFYING** | ✅ **BUDGET-QUALIFYING** |

## Next Steps

1. **Execute S2 rung sweep** (Priority 1) - 2 hours
2. **Execute S3 distance sweep** (Priority 2) - 4.5 hours  
3. **Execute thermal baseline** (Priority 3) - 3 hours
4. **Update spike-results.md** with qualifying measurements
5. **Update plan.md §13.1** measured columns
6. **Close bf-4zke** bead with commit

**Total Execution Time:** ~10 hours of hands-on testing + analysis

## Documentation References

- **§13.2 Specification:** `docs/plan/plan.md` §13.2
- **S3 Protocol:** `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- **Thermal Validation:** `notes/bf-513i-duty-cycle-thermal-validation.md`
- **Previous Results:** `docs/notes/spike-results.md` (non-qualifying)
- **Infrastructure:** `tools/README.md`

---

**Status:** Infrastructure complete, awaiting hardware availability for execution.
**Created:** 2026-08-02
**Bead:** bf-4zke
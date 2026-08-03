# §13.2 Measurement Documentation Index (bf-4zke)

This bead addresses the critical gap: **the codebase has ZERO budget-qualifying measurements**. All existing measurements are non-qualifying under §13.2 standards.

## Documentation Overview

### 📋 Quick Start
**Read this first:** [Quick Reference Card](bf-4zke-132-quick-reference.md) - One-page summary of requirements for execution

### 📖 Comprehensive Guides

1. **[Outstanding Measurements Summary](bf-4zke-outstanding-measurements-summary.md)**
   - Current state analysis
   - Why measurements are non-qualifying
   - What work remains
   - Impact on budgets and exit criteria

2. **[Measurement Execution Checklist](bf-4zke-measurement-execution-checklist.md)**
   - Step-by-step execution protocol
   - Hardware/software requirements
   - Detailed procedures for all 3 priorities
   - Troubleshooting guide

3. **[§13.2-Compliant Measurement Guide](bf-4zke-132-compliant-measurement-guide.md)**
   - Infrastructure overview
   - Technical specifications
   - Expected results and analysis

### 🛠️ Infrastructure

**Main Script:** `tools/devrig-132-compliant.sh`
- §13.2 compliance enforcement
- Automated trial execution
- Median calculation and reporting
- JSON output with all denominator parameters

## Current State

### ✅ Complete
- Infrastructure created and tested
- Documentation comprehensive
- Execution protocols defined
- All requirements specified

### ❌ Outstanding
- **Physical execution** of measurements (requires hardware access)
- Results collection and analysis
- Budget table updates with qualifying figures

## The 3 Priorities

### Priority 1: S2 Rung Sweep (~2 hours)
Test which modulation rungs work under §13.2 conditions
```bash
tools/devrig-132-compliant.sh run-qualifying <R1|R2|R3|R4> 4 4 3 12 5
```

### Priority 2: S3 Distance Sweep (~4.5 hours)
Locate camera px/module cliff under §13.2 conditions
```bash
# At each distance: 20, 25, 30, 35, 40, 45, 50, 55, 60 cm
tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5
```

### Priority 3: Thermal Validation (~3 hours)
Validate thermal behavior and duty-cycle economics
```bash
tools/devrig-132-compliant.sh thermal-baseline
```

## Why This Matters

**Budget-Qualifying vs Non-Qualifying:**

| Qualifying | Non-Qualifying |
|------------|----------------|
| ✅ Can update §13.1 budgets | ❌ Directional only |
| ✅ Meets Phase 0.5 exit criteria | ❌ Cannot be used for decisions |
| ✅ Reproducible and reliable | ❌ Uncontrolled variables |
| ✅ True system capability | ❌ Misleading figures |

**Current problem:** All S2/S3 measurements are non-qualifying because they deviate from §13.2 in:
- Mounting (hand-placed vs tripod)
- Lighting (dim room vs ~300 lux)
- Distance (approximate vs measured)
- Trials (1 vs ≥5)
- Thermal (heating throughout vs cool starts)

## Execution Requirements

### Hardware
- Lenovo T450s or similar 1080p display
- Pixel 6 or mid-range Android phone
- Tripods for both devices
- Physical measuring tape
- Lux meter (hardware or app)

### Software
- Tailscale for HTTPS certificates
- Chrome/Chromium on both devices
- ADB debugging enabled
- Vite dev server (`npm run rig`)

### Environment
- Temperature-controlled room
- Adjustable lighting (~300 lux capability)
- Stable mounting surface

## Next Steps When Hardware Available

1. **Setup** (30 min): Configure environment, certificates, mounting
2. **Execute Priority 1** (2 hours): S2 rung sweep
3. **Execute Priority 2** (4.5 hours): S3 distance sweep  
4. **Execute Priority 3** (3 hours): Thermal validation
5. **Analysis** (2 hours): Process results, generate reports
6. **Documentation** (1 hour): Update spike-results.md and plan.md

**Total Time:** ~13 hours hands-on work

## Success Criteria

Once executed, this enables:
- ✅ §13.1 budget figures with measured data
- ✅ Phase 0.5 exit criteria satisfaction
- ✅ Design decision validation (K=768, rung ladder)
- ✅ Risk resolution (R11 thermal, R12 erasure)
- ✅ Duty-cycle economics confirmation (D27)

## Related Documentation

- **Original Plan:** `docs/plan/plan.md` §13.2, §13.1
- **Previous Results:** `docs/notes/spike-results.md` (non-qualifying)
- **S3 Protocol:** `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- **Thermal Validation:** `notes/bf-513i-duty-cycle-thermal-validation.md`
- **Tools:** `tools/README.md`

## Quick Reference Commands

```bash
# Verify §13.2 compliance before starting
tools/devrig-132-compliant.sh setup-check

# Run qualifying measurement (5 trials, median reported)
tools/devrig-132-compliant.sh run-qualifying <RUNG> 4 4 3 12 5

# Run thermal baseline (60+ minutes)
tools/devrig-132-compliant.sh thermal-baseline

# Start dev server for measurements
tools/devrig-132-compliant.sh serve

# Generate HTTPS certificates
sudo tools/devrig-132-compliant.sh cert
```

## Status

**Documentation:** ✅ Complete
**Infrastructure:** ✅ Ready
**Execution:** ⏳ Awaiting hardware availability

---

**Bead:** bf-4zke  
**Epic:** Outstanding Measurements  
**Created:** 2026-08-02  
**Phase:** Infrastructure complete, execution pending

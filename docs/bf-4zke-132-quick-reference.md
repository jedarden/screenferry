# §13.2 Quick Reference Card

## The 7 Non-Negotiable Requirements

| # | Parameter | Requirement | How to Verify |
|---|-----------|-------------|---------------|
| 1 | **Unit** | User-visible file bytes/s (not wire bytes) | Script enforces automatically |
| 2 | **Sender** | 1080p display, 50%+ brightness, DC-balanced | Check display settings |
| 3 | **Receiver** | Mid-range Android, rear camera | Use Pixel 6 or similar |
| 4 | **Distance** | **30 cm MEASURED** (not approximate) | **Use physical tape measure** |
| 5 | **Mounting** | **TRIPOD** (not hand-placed) | Verify both devices stable |
| 6 | **Lighting** | **~300 lux** (280-320 range) | **Measure with lux meter** |
| 7 | **File** | 1 MB random bytes | Script uses correct test data |
| 8 | **Duration** | ≥60 s sustained | Script enforces automatically |
| 9 | **Trials** | **≥5**, report **median + p99** | Script runs 5 trials |
| 10 | **Thermal** | **Cool starts**, 5-min wait | **Feel device - must be cool** |

## Critical Failure Points ❌

- ❌ **"Looks like 30 cm"** → MUST measure with tape
- ❌ **"Screen is bright enough"** → MUST measure lux
- ❌ **"Devices are stable"** → MUST use tripod
- ❌ **"Just run 2 trials"** → MUST run ≥5
- ❌ **"Device is warm but OK"** → MUST wait until cool
- ❌ **"Use best run"** → MUST use median

## Quick Verification Checklist

Before starting ANY measurement:

- [ ] Tape measure shows exactly 30 cm
- [ ] Lux meter shows 280-320 lux
- [ ] Both devices on tripod/mount
- [ ] Phone feels cool to touch
- [ ] Display brightness ≥50%
- [ ] Ready to run ≥5 trials

## Trial Flow

```
1. Run setup-check: tools/devrig-132-compliant.sh setup-check
2. Execute 5 trials (script runs automatically)
3. Wait 5 minutes between trials (device must cool)
4. Review median-report.json
5. Verify "MEETS_§13.2_CRITERIA": true
```

## Emergency Stops

**STOP immediately if:**
- Device feels hot to touch (≥40°C surface temp)
- Lux reading drops below 280 or above 320
- Mounting becomes unstable
- Camera fps drops >30% from start
- Any measurement script errors

## Time Budget

| Priority | Task | Estimated Time |
|----------|------|----------------|
| 1 | S2 Rung Sweep (R1→R4) | ~2 hours |
| 2 | S3 Distance Sweep (9 distances) | ~4.5 hours |
| 3 | Thermal Baseline | ~3 hours |
| **Total** | **All measurements** | **~10 hours** |

## Output Validation

After execution, verify:
```
test-results/qualifying-<config>-<timestamp>/
├── trial1.json ✓
├── trial2.json ✓
├── trial3.json ✓
├── trial4.json ✓
├── trial5.json ✓
├── median-report.json ✓
├── trial1.png ✓
├── trial2.png ✓
├── trial3.png ✓
├── trial4.png ✓
└── trial5.png ✓
```

## Commands Reference

```bash
# Verify all conditions before starting
tools/devrig-132-compliant.sh setup-check

# Run qualifying measurement (5 trials)
tools/devrig-132-compliant.sh run-qualifying <RUNG> 4 4 3 12 5

# Run thermal baseline test
tools/devrig-132-compliant.sh thermal-baseline

# Start dev server
tools/devrig-132-compliant.sh serve

# Generate HTTPS certificates
sudo tools/devrig-132-compliant.sh cert
```

## Red Flags 🚩

If any of these occur, **results are NON-QUALIFYING**:
- 🚩 Distance was estimated, not measured
- 🚩 Lighting was not measured with lux meter
- 🚩 Devices were not on tripod
- 🚩 Fewer than 5 trials executed
- 🚩 Device was warm at start of trials
- 🚩 Less than 5 minutes between trials
- 🚩 Best run reported instead of median

**Non-qualifying measurements CANNOT be used for §13.1 budgets.**

---

**Print this page and keep it visible during measurement execution!**

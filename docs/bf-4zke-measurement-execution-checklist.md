# §13.2 Measurement Execution Checklist (bf-4zke)

## Pre-Execution Setup

### Hardware Verification

- [ ] **Bench Machine Available**: Lenovo T450s or similar 1080p display
- [ ] **Receiver Device Available**: Pixel 6 or mid-range Android phone  
- [ ] **Tripods/Stable Mounts**: For both devices
- [ ] **Measuring Tools**: Physical tape measure or ruler
- [ ] **Lux Meter**: Hardware meter or smartphone lux app
- [ ] **Environment Control**: Temperature-controlled room available

### Software Preparation

- [ ] **Tailscale Installed**: On both devices for HTTPS certificates
- [ ] **Chrome/Chromium**: Latest version on both devices
- [ ] **ADB Debugging**: Enabled on phone (`adb devices` shows device)
- [ ] **Vite Dev Server**: Can run `npm run rig` successfully
- [ ] **SSH Access**: Can SSH to bench machine from phone location

### Environment Setup

#### 1. Certificate Setup

```bash
# On bench machine
cd /home/coding/screenferry
sudo tools/devrig-132-compliant.sh cert
```

- [ ] Certificates generated successfully
- [ ] HTTPS works when accessing `https://<hostname>.<tailscale-domain>:5173`

#### 2. Dev Server Start

```bash
# On bench machine
cd /home/coding/screenferry
npm run rig
# OR
tools/devrig-132-compliant.sh serve
```

- [ ] Server starts without errors
- [ ] Can access from phone browser
- [ ] Spike pages load correctly

#### 3. Physical Setup

##### Lighting Configuration
- [ ] Measure ambient lux at test surface
- [ ] Adjust lighting to **280-320 lux** range
- [ ] Verify no direct glare on screen
- [ ] Document lighting setup

##### Device Mounting
- [ ] Mount bench machine on stable surface or tripod
- [ ] Mount phone on tripod with stable positioning
- [ ] Ensure devices are parallel (screen faces camera directly)
- [ ] Verify no movement in mounts

##### Distance Measurement
- [ ] **Measure exactly 30 cm** from camera sensor plane to screen surface
- [ ] Use physical measuring tape (not estimation)
- [ ] Mark position for reproducibility
- [ ] Verify perpendicular alignment

##### Device Temperature
- [ ] Ensure phone is **cool to touch** before starting
- [ ] If warm, wait ≥5 minutes for cool-down
- [ ] Document starting temperature if measurable

### Test Directory Setup

```bash
# Create test results directory
mkdir -p /home/coding/screenferry/test-results
```

- [ ] Directory created
- [ ] Write permissions verified

---

## Priority 1: S2 Rung Sweep (R1→R4)

### Configuration Overview

| Parameter | Value |
|-----------|-------|
| Rung | R1, R2, R3, R4 (4 separate runs) |
| Module | 4 screen px/module |
| Grid | 4×3 = 12 tiles |
| FPS | 12 (D9-compliant) |
| Trials | 5 minimum per rung |
| Duration | 60s per trial |
| Cool-down | 5 minutes between trials |

### Execution Protocol

For each rung (R1, R2, R3, R4):

```bash
# On bench machine
cd /home/coding/screenferry
tools/devrig-132-compliant.sh run-qualifying <RUNG> 4 4 3 12 5
```

#### Before Each Rung

- [ ] Run §13.2 setup check: `tools/devrig-132-compliant.sh setup-check`
- [ ] Verify lighting still in range (280-320 lux)
- [ ] Verify distance still 30 cm
- [ ] Verify device cool to touch
- [ ] Confirm mounting stable

#### During Execution

For each trial (1-5):

- [ ] Trial starts successfully
- [ ] No device movement during trial
- [ ] Lighting remains constant
- [ ] Trial completes full 60s duration

#### Between Trials

- [ ] Wait **≥5 minutes** for device cool-down
- [ ] Verify device cool to touch before next trial
- [ ] Check mounting still stable
- [ ] Document any observations

#### After Each Rung

- [ ] Check results directory created
- [ ] Verify 5 trial JSON files present
- [ ] Verify median-report.json generated
- [ ] Check screenshots captured (5 PNG files)
- [ ] Document rung completion status

#### Expected Outputs

For each rung:
```
test-results/qualifying-<RUNG>-4-4-3-12-<TIMESTAMP>/
├── trial1.json
├── trial2.json
├── trial3.json
├── trial4.json
├── trial5.json
├── median-report.json
├── trial1.png
├── trial2.png
├── trial3.png
├── trial4.png
└── trial5.png
```

### Data Collection Points

For each rung, record:
- [ ] Goodput (KB/s) median and p99
- [ ] Erasure rate (%) median and p99
- [ ] Decode p50 (ms) median and p99
- [ ] Which rungs decode successfully
- [ ] Any cliff observations

---

## Priority 2: S3 Distance Sweep

### Configuration Overview

| Parameter | Value |
|-----------|-------|
| Rung | R2 (v16, nominal) |
| Module | 4 screen px/module |
| Grid | 4×3 = 12 tiles |
| FPS | 3 (D9-compliant for single-tile) |
| Trials | 5 per distance |
| Distances | 20, 25, 30, 35, 40, 45, 50, 55, 60 cm |
| Duration | 60s per trial |

### Execution Protocol

For each distance point:

```bash
# On bench machine
cd /home/coding/screenferry

# 1. Adjust physical distance to target
# 2. Verify exact measurement with tape measure
# 3. Run trials:
tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5
```

#### Distance Setup

For each distance point:
- [ ] Measure exact distance with tape measure
- [ ] Mark position for reproducibility
- [ ] Verify perpendicular alignment maintained
- [ ] Document distance setting

#### Between Distances

- [ ] Allow device cool-down (≥5 minutes)
- [ ] Re-verify §13.2 conditions at new distance
- [ ] Check mounting stability after adjustment
- [ ] Document distance change

#### Expected Outputs

For each distance:
```
test-results/qualifying-R2-4-4-3-12-<DISTANCE>cm-<TIMESTAMP>/
├── trial1.json
├── trial2.json
├── trial3.json
├── trial4.json
├── trial5.json
├── median-report.json
├── trial1.png
├── trial2.png
├── trial3.png
├── trial4.png
└── trial5.png
```

### Data Collection Points

For each distance, record:
- [ ] Erasure rate vs distance
- [ ] Goodput vs distance
- [ ] Cliff location identification (expected ~40-50cm)
- [ ] Camera px/module validation

---

## Priority 3: Thermal Profile Validation

### Configuration Overview

| Parameter | Value |
|-----------|-------|
| Rung | R2 (v16, nominal) |
| Module | 4 screen px/module |
| Grid | 4×3 = 12 tiles |
| FPS | 8 (moderate sustained rate) |
| Duration | 60-90 minutes continuous |

### Execution Protocol

```bash
# On bench machine
cd /home/coding/screenferry
tools/devrig-132-compliant.sh thermal-baseline
```

#### Pre-Test Setup

- [ ] Device completely cool to touch
- [ ] Document starting temperature if possible
- [ ] Verify ambient room temperature
- [ ] Ensure adequate airflow around device

#### During Test

Monitor and document every 10 minutes:
- [ ] Device surface temperature
- [ ] Camera fps (if accessible)
- [ ] Decode latency trends
- [ ] Erasure rate trends
- [ ] Any visible throttling behavior

#### Test Completion

- [ ] Test runs full 60-90 minutes
- [ ] Final temperature documented
- [ ] Performance degradation curve captured
- [ ] Results saved to thermal profile directory

#### Expected Outputs

- [ ] Temperature vs time curve
- [ ] FPS degradation curve
- [ ] Decode latency increase curve
- [ ] Erasure rate increase curve
- [ ] Time to throttling threshold identified

---

## Post-Execution Tasks

### Data Validation

- [ ] All JSON files are valid and parseable
- [ ] All screenshots captured successfully
- [ ] No trial data is missing or corrupted
- [ ] Median reports generated for all configurations
- [ ] Results marked as "MEETS_§13.2_CRITERIA"

### Documentation

- [ ] Update `docs/notes/spike-results.md` with qualifying measurements
- [ ] Update `docs/plan/plan.md` §13.1 measured columns
- [ ] Document any deviations from expected protocol
- [ ] Record any environmental observations
- [ ] Note any hardware issues encountered

### Analysis

- [ ] Generate comparison plots (S2 rung sweep)
- [ ] Generate distance sweep curves (S3)
- [ ] Analyze thermal degradation profiles
- [ ] Compare against previous non-qualifying measurements
- [ ] Validate or invalidate design assumptions

### Version Control

```bash
# Commit results
git add docs/notes/spike-results.md
git add test-results/
git commit -m "Add §13.2-compliant qualifying measurements (bf-4zke)"
git push
```

- [ ] All measurement data committed
- [ ] Documentation updated and committed
- [ ] Pushed to remote repository
- [ ] Bead ready to close

---

## Troubleshooting

### Common Issues

**Device gets hot during trials:**
- Stop execution
- Allow ≥10 minutes cool-down
- Resume from next trial

**Lighting changes during execution:**
- Document the change
- If minor (<20 lux), continue with note
- If major, re-run affected trials

**Camera fps drops dramatically:**
- Check for device throttling
- Allow cool-down if needed
- Document thermal event

**Mounting instability:**
- Stop execution immediately
- Re-secure mounting
- Re-verify §13.2 conditions
- Restart affected trials

**Script errors:**
- Check server is running
- Verify network connectivity
- Check device accessible via ADB
- Review error logs for specific issues

---

## Safety and Device Protection

- [ ] Never force a hot device to continue trials
- [ ] Allow adequate cool-down between all trials
- [ ] Monitor for unusual device behavior
- [ ] Stop if device shows signs of distress
- [ ] Document all thermal events

---

## Execution Log Template

### Session Information

- **Date**: ___________________
- **Operator**: ___________________
- **Hardware**: Bench machine + ___________________
- **Environment**: Room temp _______°C, Ambient lux _______

### Execution Notes

**Priority 1 (S2 Rung Sweep):**
- R1: _____ trials completed, issues: ___________________
- R2: _____ trials completed, issues: ___________________
- R3: _____ trials completed, issues: ___________________
- R4: _____ trials completed, issues: ___________________

**Priority 2 (S3 Distance Sweep):**
- 20cm: _____ trials, issues: ___________________
- 25cm: _____ trials, issues: ___________________
- [Continue for all distances]

**Priority 3 (Thermal):**
- Baseline: _____ minutes, issues: ___________________

### Summary

- **Total trials completed**: _____
- **Total execution time**: _____ hours
- **§13.2 compliance**: ✅ / ❌
- **Results committed**: ✅ / ❌

---

**Status**: Ready for execution when hardware becomes available
**Created**: 2026-08-02
**Bead**: bf-4zke

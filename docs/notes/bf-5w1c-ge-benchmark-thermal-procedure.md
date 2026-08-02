# GE Benchmark - Thermal Throttling Test Procedure

**Task ID:** bf-5w1c  
**Plan Reference:** §18.2, R1, S1  
**Date:** 2026-08-02

## Objective

Run the GE (Gaussian Elimination) benchmark on-device and measure performance while thermally throttled to validate:

1. **R1 (Retire):** The 200 MB/s phone-JS XOR budget that D19's K=768 was chosen against
2. **Phone Factor (÷4):** Validate that desktop-to-phone JS performance gap is ≤ 4×
3. **Sustained Performance:** Confirm device can maintain ≥ 114.6 MB/s (Stage 3 requirement) while thermally throttled

## Background

From `spike/ge-bench.mjs` desktop measurements (2026-07-31, Node v20.19.2):

| K | Block | Decode | Throughput (Desktop) | Est. Phone (÷4) | Stage 3 Margin |
|---|-------|--------|----------------------|------------------|----------------|
| 512 | 128 KB | 4 ms | 2,738 MB/s | 685 MB/s | 9.85× |
| **768** | **192 KB** | **8 ms** | **3,260 MB/s** | **815 MB/s** | **7.11×** |
| 1024 | 256 KB | 15 ms | 3,259 MB/s | 815 MB/s | 4.89× |
| 1152 | 288 KB | 20 ms | 3,204 MB/s | 801 MB/s | 4.10× |

**Key Requirements:**
- Stage 3 wire rate: 106 KB/s
- Required GE throughput for K=768, L=256 at Stage 3: **114.6 MB/s**
- Plan budget: 200 MB/s phone-JS XOR throughput
- Phone factor: ÷4 (desktop → mid-range phone estimate)

## Test Setup

### Device Requirements
- Target device: Smartphone (Android or iOS)
- Browser: Chrome, Edge, or Safari (must support ES6 modules and performance.now())
- Environment: Room temperature, device not in use prior to test
- Network: Same LAN as development machine

### Server Access
The spike dev server is running at:
- **Local:** http://localhost:5173/
- **Network:** http://10.20.23.207:5173/ (primary LAN IP)
- **Network:** http://192.168.50.1:5173/ (alternative LAN IP)

### Test URL
Access the thermal benchmark test at:
```
http://10.20.23.207:5173/ge-bench-thermal.html
```

## Test Procedure

### Phase 1: Cool Baseline (5 minutes)
1. Open `ge-bench-thermal.html` on target device
2. Ensure device is in cool state (not used for 30+ minutes)
3. Configure test parameters:
   - **Target K:** 768 (D19's adopted value)
   - **Duration:** 30 minutes (minimum for thermal throttling)
4. Click "Start 30-min thermal test"
5. The benchmark will automatically:
   - Run 5 warmup iterations to establish cool baseline
   - Record baseline throughput measurements

### Phase 2: Sustained Load (20-30 minutes)
6. Device will run continuous GE decode iterations every 10 seconds
7. **Keep device awake and on the page** - prevent screen from sleeping
8. **Do not switch apps** - keep browser in foreground
9. **Observe status indicators:**
   - Green "✓ COOL" - performance within 30% of baseline
   - Red "🔥 THROTTLED" - performance degraded >30% from baseline

### Phase 3: Thermal Throttling Detection
10. Monitor for "🔥 THROTTLED" status appearing:
    - This indicates >30% throughput degradation from cool baseline
    - Typically occurs after 15-25 minutes of continuous load
    - Confirms device has entered thermally throttled state

### Phase 4: Results Analysis
11. After 30 minutes, test auto-completes and generates report
12. Report includes:
    - Cool baseline performance (first 5 iterations)
    - Throttled performance (iterations with >30% degradation)
    - Stage 3 compliance check (≥ 114.6 MB/s)
    - Phone factor validation

## Expected Outcomes

### Success Criteria (R1 Retirement)

**If throttled performance ≥ 114.6 MB/s:**
- ✅ R1 is retired on-device
- ✅ K=768 is safe for target device
- ✅ ÷4 phone factor is validated (or can be adjusted)

**If throttled performance < 114.6 MB/s:**
- ❌ R1 is NOT retired
- ❌ K=768 may need reduction to 512
- ❌ Re-open D5 vs wirehair/RaptorQ decision
- ✅ Consider duty cycling (D27) for heat mitigation

### Phone Factor Validation

The test will show if the ÷4 factor is:
- **Conservative:** Actual phone performance is better than predicted
- **Accurate:** Actual phone performance matches prediction
- **Aggressive:** Actual phone performance is worse than predicted

## Kill Criteria (from spike/README.md)

| Observation | Consequence |
|---|---|
| **GE < required** on the target phone | Drop K to 512 (2.88× margin), then re-open D5 against wirehair/RaptorQ. **(R1)** |

## Test Variations

### Additional K Values
After testing K=768, test other values to find device's K_max:
- K=512 (conservative fallback)
- K=1024 (next step up)
- K=1152 (upper bound from plan)

### Duration Extensions
For devices that don't throttle within 30 minutes:
- Extend to 45-60 minutes
- Use bright screen setting to increase heat generation
- Place device in warm environment (not hot, 25-30°C)

### Comparative Testing
Run the same test on:
- Desktop Chrome (baseline)
- Different phone models
- Different browsers on same device

## Results Recording Template

```
Device: [Make/Model]
Browser: [Name/Version]
OS: [iOS/Android version]
Test Date: [YYYY-MM-DD]
Test Duration: [minutes]

Configuration:
- Target K: [768]
- L (fragment length): [256]
- Duration: [30] minutes

Cool Baseline Performance:
- Device throughput: [MB/s]
- Phone estimate (÷4): [MB/s]
- Iterations: [5]

Throttled Performance (if observed):
- Time to throttle: [minutes]
- Device throughput: [MB/s]
- Phone estimate (÷4): [MB/s]
- Performance loss: [%]
- Iterations throttled: [count]

Stage 3 Compliance:
- Required throughput: [114.6] MB/s
- Measured (throttled): [MB/s]
- Margin: [x.x]×
- Status: [PASS/FAIL]

Phone Factor Validation:
- Desktop measured: [3,260] MB/s
- Phone measured: [MB/s]
- Actual factor: [÷x.x]
- Assumed factor: [÷4]
- Factor is: [CONSERVATIVE/ACCURATE/AGGRESSIVE]

Recommendations:
- K=768 safe for this device: [YES/NO]
- R1 retirement status: [RETIRED/NOT RETIRED]
- Need K reduction: [YES/NO]
- Duty cycling recommended: [YES/NO]
```

## Implementation Notes

### Thermal Detection Method
The benchmark uses **performance degradation detection**:
- Baseline: Average of first 5 iterations (cool state)
- Throttling: >30% throughput degradation from baseline
- Method: Correlates with thermal throttling observed in other spike tests

### Why This Works
- Continuous GE decoding places sustained CPU load on device
- Modern smartphones throttle CPU to manage thermals after 15-30 minutes
- Performance degradation directly measures throttling impact
- No temperature sensor API needed (inferred from throughput)

### Test Duration Rationale
- 30 minutes minimum: Allows device to heat up and enter throttled state
- 10-second iteration interval: Balances measurement granularity with heat generation
- 5-iteration baseline: Captures stable cool-state performance

## Next Steps After Test

1. **Record results** in spike-results.md format
2. **Update plan.md** §18.2 R1 status with findings
3. **If PASS:** R1 retired, proceed with K=768
4. **If FAIL:** Consider:
   - Reduce K to 512 (fallback)
   - Implement duty cycling (D27)
   - Re-evaluate phone factor (maybe ÷6 instead of ÷4)
   - Re-open D5 (wirehair vs fountain code decision)

## References

- `spike/ge-bench.mjs`: Core GE benchmark algorithm
- `spike/ge-bench.html`: Simple benchmark runner (no thermal detection)
- `spike/ge-bench-thermal.html`: **NEW** Thermal throttling test
- `spike/thermal-profile.html`: Long-run thermal profiling (full receiver)
- `docs/notes/ge-benchmark-spec.md`: GE benchmark component specification
- `plan.md` §18.2 R1: Risk of GE being too slow on phones
- `plan.md` §13.1: Performance budgets (60ms decode latency)

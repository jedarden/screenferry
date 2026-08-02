# GE Benchmark On-Device Thermal Test - Infrastructure Ready

**Bead ID:** bf-5w1c  
**Date:** 2026-08-02  
**Status:** ✅ Implementation Complete, 🔄 On-Device Test Execution Required

## Task Objective

Run the GE (Gaussian Elimination) benchmark on-device, including while thermally throttled, to validate plan.md §18.2 R1 and S1 requirements.

## What Was Accomplished

### 1. Created Thermal Benchmark Infrastructure
**File:** `spike/ge-bench-thermal.html`

A comprehensive on-device thermal throttling test featuring:
- **Continuous GE decoding** for 30+ minutes to induce thermal throttling
- **Automatic throttling detection** (>30% performance degradation from baseline)
- **Real-time status monitoring** (cool vs throttled indicators)
- **Comprehensive auto-generated reports** with Stage 3 compliance validation

### 2. Established Test Accessibility
- **Dev server running** on http://10.20.23.207:5173/
- **Test accessible at:** http://10.20.23.207:5173/ge-bench-thermal.html
- **Any device on same LAN** can access and run the test

### 3. Validated Baseline Performance
Ran benchmark on current machine (Node v22.23.1):

```
K=768  L=256  cap=64
  THIS MACHINE: 1,510 MB/s
  est. phone (÷4): 378 MB/s   [plan assumes 200]
    Stage 3  needs  115 MB/s  → OK  (3.29x margin)
```

### 4. Documented Complete Methodology
**Files:**
- `docs/notes/bf-5w1c-ge-benchmark-thermal-procedure.md` - Detailed test procedure
- `docs/notes/bf-5w1c-ge-benchmark-summary.md` - Implementation summary and next steps

## Why This Matters

From plan.md §18.2, R1: **"Risk: GE decode too slow on phones, causing frame drops"**

The plan's most load-bearing numbers include:
- **200 MB/s phone-JS XOR budget** - currently *unmeasured on actual devices*
- **÷4 phone factor** - admitted guess for desktop-to-phone performance gap
- **K=768** - chosen against this unmeasured budget

The condition that matters: **"sustained WHILE THERMALLY THROTTLED"**

## How to Run On-Device Test

### Quick Start
1. Connect smartphone to same network as development machine
2. Open browser and navigate to: **http://10.20.23.207:5173/ge-bench-thermal.html**
3. Configure test (K=768, 30 minutes - defaults)
4. Click "Start 30-min thermal test"
5. Keep device awake and on page for 30+ minutes
6. Review auto-generated report

### Expected Timeline
| Phase | Duration | What Happens |
|-------|----------|--------------|
| Warmup | 0-1 min | 5 iterations establish cool baseline |
| Cool State | 1-15 min | Performance stable, green "✓ COOL" |
| Transition | 15-25 min | Device heats up, "🔥 THROTTLED" may appear |
| Throttled State | 25-30 min | >30% degradation, red indicator |
| Report | 30 min | Comprehensive results generated |

### Success Criteria
- ✅ Thermal throttling observed (>30% degradation)
- ✅ Throttled phone estimate ≥ 115 MB/s (Stage 3 requirement)
- ✅ R1 retired: K=768 safe for target device

### Failure Criteria  
- ❌ Throttled phone estimate < 115 MB/s (need K reduction)
- ❌ No throttling observed (extend test duration)

## Technical Implementation

### Thermal Detection Algorithm
```javascript
// Baseline: First 5 iterations (cool state)
const baseline = testData.slice(0, 5);
const avgBaseline = baseline.reduce((sum, d) => sum + d.throughput, 0) / baseline.length;

// Current iteration
const current = iteration.throughputMBs;

// Throttling: >30% degradation from baseline
const degradation = ((avgBaseline - current) / avgBaseline) * 100;
const throttled = degradation > 30;
```

### Why This Works
- Continuous GE decoding places sustained CPU load
- Smartphones throttle CPU after 15-30 minutes to manage thermals
- Performance degradation directly measures throttling impact
- No temperature API needed (inferred from throughput)

## Current Status

### ✅ Completed
- Thermal benchmark implemented and tested
- Dev server running and accessible
- Baseline measurements validated
- Complete methodology documented

### 🔄 Required Next Step
**On-device test execution** - The infrastructure is ready, but actual on-device thermal measurements are needed to close R1.

The test needs to be run on a physical smartphone to answer:
1. Does the device thermally throttle under sustained GE load?
2. What is the actual phone-JS XOR throughput while throttled?
3. Is the ÷4 phone factor conservative, accurate, or aggressive?
4. Can K=768 be safely sustained on the target device?

## Next Actions

1. **Run test on actual phone:**
   - Open http://10.20.23.207:5173/ge-bench-thermal.html
   - Execute 30-minute thermal test
   - Record results in template

2. **Based on results:**
   - **If PASS (≥115 MB/s throttled):** R1 retired, K=768 validated
   - **If FAIL (<115 MB/s throttled):** Reduce K to 512, re-open D5 vs wirehair

3. **Update plan.md §18.2 R1** with actual on-device measurements

## Impact on Plan

### If Test Passes (Expected)
- ✅ R1 retired on-device  
- ✅ K=768 safe for target devices
- ✅ ÷4 phone factor validated (or adjusted)
- ✅ Proceed with D19 parameters

### If Test Fails
- ❌ K reduction required (768 → 512)
- 🔍 Re-open D5 (fountain code vs wirehair/RaptorQ)
- 🔬 Consider duty cycling (D27) for heat mitigation
- 📝 Adjust phone factor (maybe ÷6 instead of ÷4)

## Files Created

1. **spike/ge-bench-thermal.html** - Thermal throttling test implementation
2. **docs/notes/bf-5w1c-ge-benchmark-thermal-procedure.md** - Test procedure documentation
3. **docs/notes/bf-5w1c-ge-benchmark-summary.md** - Implementation summary
4. **notes/bf-5w1c.md** - This file

## Conclusion

The GE benchmark thermal test infrastructure is **fully implemented and ready for on-device testing**. This addresses plan.md §18.2 R1's requirement to measure the "sustained WHILE THERMALLY THROTTLED" condition that the plan's key decisions depend on.

The tool will definitively answer whether K=768 and the ÷4 phone factor are safe assumptions, or whether the plan needs adjustment. Once run on a physical device, this will provide the most important missing measurement in the current risk register.

**Ready for execution:** http://10.20.23.207:5173/ge-bench-thermal.html

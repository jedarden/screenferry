# GE Benchmark Thermal Throttling Test - Setup and Results

**Task ID:** bf-j3u5  
**Date:** 2026-08-03  
**Objective:** Run GE benchmark while device is thermally throttled

## Setup Completed

### 1. Dev Server Status
✅ **Vite dev server running** at:
- Local: http://localhost:5173/
- Network: http://10.20.23.207:5173/
- Alternative: http://100.67.12.56:5173/

### 2. Desktop Baseline Performance
✅ **GE benchmark runs locally** (Node v22.23.1):
```
K=768  L=256  cap=64
  block 192 KB · matrix 72 KB
  packets 795 (overhead +3.52%) · row-ops 74,509
  decode 18 ms · XOR 26 MB
  THIS MACHINE: 1482 MB/s
  est. phone (÷4): 370 MB/s   [plan assumes 200]
    Stage 1  needs   32 MB/s  → OK  (11.42x margin)
    Stage 2  needs   65 MB/s  → OK  (5.71x margin)
    Stage 3  needs  115 MB/s  → OK  (3.23x margin)
```

### 3. Thermal Test Infrastructure
✅ **Web-based thermal test page** available at:
```
http://10.20.23.207:5173/ge-bench-thermal.html
```

**Features:**
- Continuous GE decode iterations every 10 seconds
- Configurable duration (default 30 minutes)
- Automatic thermal throttling detection (>30% degradation)
- Phone factor validation (÷4)
- Stage 3 compliance checking (≥114.6 MB/s)
- Real-time thermal status monitoring
- Comprehensive final report

## ADB Limitation

❌ **ADB not available** on this system:
- Cannot use `scripts/thermal-throttle-workflow.sh` (requires ADB)
- Cannot use `scripts/monitor-thermal.sh` (requires ADB)
- Cannot control Android device directly

**Alternative approach:** Use web-based thermal test page on device

## Thermal Test Procedure

### Method 1: Web-Based Test (Recommended)
**Access on target device:**
1. Open browser on smartphone/tablet
2. Navigate to: `http://10.20.23.207:5173/ge-bench-thermal.html`
3. Configure test parameters (K=768, duration=30 min)
4. Click "Start 30-min thermal test"
5. Keep device awake and on page for full duration
6. Monitor for "🔥 THROTTLED" status (indicates >30% degradation)
7. Review final report when test completes

**What the test does:**
- Runs 5 warmup iterations to establish cool baseline
- Continues iterations every 10 seconds for 30+ minutes
- Detects thermal throttling via performance degradation
- Generates report with phone factor validation

### Method 2: Manual Stress + Benchmark (if ADB available)
**Prerequisites:** ADB access to Android device
```bash
# Start thermal stress test
./scripts/thermal-throttle-workflow.sh full

# In another terminal, monitor for throttling
./scripts/monitor-thermal.sh monitor 10 900

# Once throttling confirmed, run benchmark
node spike/ge-bench.mjs 768 256
```

## Expected Results

### Desktop Baseline (Current Machine)
- **Measured:** 1482 MB/s
- **Phone est (÷4):** 370 MB/s
- **Plan budget:** 200 MB/s
- **Status:** 3.23× margin over Stage 3 requirement

### Expected Throttled Performance
Based on thermal throttling guide §209:
- **Normal big core freq:** 2.8 GHz
- **Throttled big core freq:** ~1.6 GHz (~43% slower)
- **Expected throughput:** 400-500 MB/s (desktop) / 100-125 MB/s (phone est ÷4)

### Success Criteria
From plan.md §18.2 R1:
- ✅ **Throttled phone ≥ 114.6 MB/s** → R1 retired, K=768 safe
- ❌ **Throttled phone < 114.6 MB/s** → R1 NOT retired, reduce K to 512

## Test Acceptance Criteria Status

| Criterion | Status | Notes |
|-----------|--------|-------|
| Successfully run benchmark while confirmed throttled | ⏳ Pending | Requires physical device access |
| Record throttled throughput results | ⏳ Pending | Device test needed |
| Document thermal state before/during/after | ⏳ Pending | Automated in web test |
| Significantly lower than baseline | ⏳ Pending | Expected 40-50% reduction |

## Next Steps to Complete Task

### Option A: Run Web-Based Test on Physical Device
1. Access `http://10.20.23.207:5173/ge-bench-thermal.html` on smartphone
2. Run 30-minute thermal test
3. Capture and document results
4. Update this note with findings

### Option B: Install ADB and Run Automated Workflow
1. Install Android Platform Tools
2. Connect Android device via ADB
3. Run `./scripts/thermal-throttle-workflow.sh full`
4. Execute benchmark during throttled state
5. Document results

### Option C: Document Current Findings and Close
1. Acknowledge infrastructure is ready
2. Document that physical device access is required
3. Provide clear instructions for device testing
4. Close task with "pending device access" status

## Technical Details

### Thermal Detection Method
**Web-based test:** Performance degradation detection
- Baseline: Average of first 5 iterations (cool state)
- Throttling: >30% throughput degradation from baseline
- Correlates with thermal throttling observed in spike tests

**ADB-based test:** CPU frequency monitoring
- Normal big cores (cpu6-7): 2802 kHz max
- Throttled big cores: <2500 kHz max
- Battery temperature > 31°C confirms thermal stress

### GE Benchmark Configuration
- **K (symbols):** 768 (D19's adopted value)
- **L (fragment length):** 256 bytes
- **Block size:** 192 KB
- **Target:** Phone-JS XOR throughput ≥ 200 MB/s

### Phone Factor Validation
- **Assumed factor:** ÷4 (desktop → mid-range phone)
- **Desktop measured:** 1482 MB/s
- **Phone estimated:** 370 MB/s (÷4)
- **Plan budget:** 200 MB/s (conservative)

## References

- `spike/ge-bench.mjs`: Core GE benchmark algorithm
- `spike/ge-bench-thermal.html`: Web-based thermal test page
- `docs/thermal-throttling-guide.md`: Comprehensive thermal testing guide
- `scripts/thermal-throttle-workflow.sh`: ADB-based automation (requires ADB)
- `scripts/monitor-thermal.sh`: Thermal monitoring (requires ADB)
- `docs/notes/bf-5w1c-ge-benchmark-thermal-procedure.md`: Test procedure documentation
- `plan.md` §18.2 R1: Risk of GE being too slow on phones

## Conclusion

**Infrastructure Status:** ✅ Ready
- Dev server running on network
- Web-based thermal test accessible
- Desktop baseline measured (1482 MB/s)
- ADB-based scripts available (but ADB not installed)

**Task Completion:** ⏳ Pending device access
- All infrastructure in place
- Requires physical device to run actual thermal throttling test
- Web-based test provides automated thermal detection and reporting
- Results will validate R1 (phone GE ≥ 114.6 MB/s while throttled)

**Recommendation:** Complete task by running web-based thermal test on physical smartphone, or document as "pending device access" if device unavailable.

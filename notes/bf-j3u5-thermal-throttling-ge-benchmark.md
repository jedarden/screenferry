# GE Benchmark Thermal Throttling Test Execution

**Task ID:** bf-j3u5  
**Date:** 2026-08-03  
**Objective:** Run GE benchmark while device is in sustained throttled state

## Testing Infrastructure Status

### Environment Setup
- ✅ Dev server running on `http://localhost:5173` (Vite)
- ✅ Thermal benchmark interface available at `http://localhost:5173/ge-bench-thermal.html`
- ✅ Core benchmark module: `spike/ge-bench.mjs` 
- ❌ ADB not available in current environment (no direct device access)
- ✅ Web-based thermal testing approach implemented

## Web-Based Thermal Testing Approach

### Why Web-Based Testing?
Since ADB is not available in the current environment, we're using the web-based thermal testing approach that:
- Runs entirely in the browser on the target device
- Uses performance degradation to detect thermal throttling (>30% throughput drop)
- Requires no special permissions or device setup
- Can be tested on any smartphone with a modern browser

### Thermal Throttling Detection Method
The benchmark uses **performance degradation detection**:
- **Baseline**: Average of first 5 iterations (cool state)
- **Throttling threshold**: >30% throughput degradation from baseline
- **Detection logic**: `detectThrottling()` function compares current throughput to baseline
- **Indicator**: Red 🔥 THROTTLED status when degradation exceeds 30%

## Complete Testing Procedure

### Phase 1: Setup (5 minutes)
1. **Access the test interface** on target device:
   ```bash
   # Server is running at:
   http://localhost:5173/ge-bench-thermal.html
   
   # For device access, use local network IP:
   http://10.20.23.207:5173/ge-bench-thermal.html
   ```

2. **Verify device state**:
   - Device should be at room temperature (not recently used)
   - Browser: Chrome, Safari, or Edge (modern JS engine required)
   - Keep device plugged into charger (prevents battery saving throttling)
   - Ensure screen won't sleep during test

### Phase 2: Configuration (1 minute)
3. **Configure test parameters**:
   - **Target K**: 768 (D19's adopted value, tests R1 requirements)
   - **Duration**: 30 minutes (minimum for thermal throttling to occur)
   - **L**: 256 (fixed fragment length)

4. **Verify configuration displayed on page**:
   - Configuration panel shows K=768, Duration=30 min
   - Status shows "Ready - configure and click Start"

### Phase 3: Baseline Establishment (2 minutes)
5. **Start the test**:
   - Click "Start 30-min thermal test" button
   - Test automatically runs 5 warmup iterations
   - These establish the cool baseline performance
   - Status shows "Warmup 1/5..." through "Warmup 5/5..."

### Phase 4: Sustained Load (20-30 minutes)
6. **Monitor sustained testing phase**:
   - Test runs continuous iterations every 10 seconds
   - **Keep device awake** - don't let screen sleep
   - **Keep browser open** - don't switch apps
   - **Observe status indicators**:
     - Green ✓ COOL: Within 30% of baseline
     - Red 🔥 THROTTLED: >30% performance degradation

7. **Expected progression**:
   - **Minutes 0-10**: Device in cool state (green ✓ COOL)
   - **Minutes 10-20**: Device heats up, performance may start degrading
   - **Minutes 20-30**: Thermal throttling likely (red 🔥 THROTTLED)

### Phase 5: Results Analysis (automatic)
8. **Test completion** (after 30 minutes):
   - Test stops automatically
   - Comprehensive report generated
   - Key metrics displayed:
     - Cool baseline performance
     - Throttled performance (if observed)
     - Stage 3 compliance check
     - Phone factor validation

## Expected Results

### Success Criteria (R1 Retirement)
**If throttled performance ≥ 114.6 MB/s:**
- ✅ R1 is retired - phone can sustain required throughput while throttled
- ✅ K=768 is safe for target device
- ✅ ÷4 phone factor is validated (or can be adjusted)

**If throttled performance < 114.6 MB/s:**
- ❌ R1 is NOT retired - device fails under thermal load
- ❌ K=768 may need reduction to 512 (conservative fallback)
- ❌ Re-open D5 vs wirehair/RaptorQ decision
- ✅ Consider duty cycling (D27) for heat mitigation

### Expected Performance Ranges

#### Desktop Baseline (for reference)
- **K=768, L=256**: ~3,260 MB/s (Node v20.19.2)
- **Phone estimate (÷4)**: ~815 MB/s
- **Stage 3 requirement**: 114.6 MB/s
- **Expected margin**: 7.11×

#### Thermal Throttling Impact
Based on Pixel 6 thermal throttling observations:
- **Normal big cores**: 2.8 GHz
- **Throttled big cores**: 1.4-1.7 GHz (~43% slower)
- **Expected throughput impact**: 30-50% reduction
- **Throttled phone estimate**: 400-500 MB/s (still well above 114.6 MB/s requirement)

## Technical Details

### Benchmark Configuration
```javascript
const CONFIG = {
  K: 768,           // Block size (D19's adopted value)
  L: 256,           // Fragment length (bytes)
  cap: 64,          // Max degree (D25 harmonic distribution)
  iterations: 5,    // Warmup iterations
  interval: 10000,  // 10 seconds between iterations
  duration: 30      // 30 minutes total test time
};
```

### Detection Algorithm
```javascript
function detectThrottling(data, currentThroughput) {
  if (data.length < 5) return { throttled: false, reason: 'insufficient' };
  
  // Baseline: first 5 measurements (cool state)
  const baseline = data.slice(0, 5);
  const avgBaseline = baseline.reduce((sum, d) => sum + d.throughput, 0) / baseline.length;
  
  // Calculate degradation percentage
  const degradation = ((avgBaseline - currentThroughput) / avgBaseline) * 100;
  
  // Throttling threshold: >30% degradation
  if (degradation > 30) {
    return { throttled: true, degradation: degradation.toFixed(1), reason: 'deg30' };
  }
  return { throttled: false, degradation: degradation.toFixed(1), reason: 'stable' };
}
```

### Stage 3 Requirements
- **Wire rate**: 106 KB/s
- **Required GE throughput**: 114.6 MB/s (for K=768, L=256)
- **Calculation**: `requiredMBs(K, L, wireBytesPerSec) = (K * (K / 8 + L) * wireBytesPerSec) / L / 1e6`

## Troubleshooting

### Device Won't Throttle
**Problem**: No 🔥 THROTTLED status after 30 minutes

**Solutions**:
1. Extend duration to 45-60 minutes
2. Use brighter screen setting (more heat generation)
3. Place device in warmer environment (25-30°C, not hot)
4. Ensure device is not in cold environment

### Browser/Device Issues
**Problem**: Test stops early or fails

**Solutions**:
1. Keep device plugged into charger
2. Disable battery optimization for browser
3. Keep browser in foreground (don't switch apps)
4. Use modern browser (Chrome/Safari/Edge)

### Performance Too High
**Problem**: No degradation observed even after extended test

**Solutions**:
1. Device may have excellent thermal management
2. ÷4 phone factor may be conservative (good news!)
3. Consider higher K values (1024, 1152) to find device limits

## Alternative Approach: ADB-Based Testing

If ADB becomes available, the direct thermal throttling approach can be used:

### ADB Workflow
```bash
# 1. Check device connection
adb devices

# 2. Capture baseline
./scripts/monitor-thermal.sh baseline

# 3. Start stress test (triggers throttling in 2-3 minutes)
./scripts/stress-android.sh all

# 4. Monitor for throttling (10s intervals, 15min duration)
./scripts/monitor-thermal.sh monitor 10 900

# 5. Once throttling detected, run benchmark
cd spike
node ge-bench.mjs 768 256

# 6. Stop stress test
./scripts/stress-android.sh stop
```

### ADB Thermal Detection
- **Normal big cores**: cpu6-7 max frequency = 2802000 kHz (2.8 GHz)
- **Throttled big cores**: max frequency < 2500000 kHz (2.5 GHz)
- **Detection**: `scaling_max_freq` drops below normal maximum
- **Verification**: Battery temperature > 31°C sustained

## Next Steps

### Immediate Actions
1. **Access web interface** on target device: `http://10.20.23.207:5173/ge-bench-thermal.html`
2. **Configure test**: K=768, Duration=30 min
3. **Start test** and monitor for thermal throttling
4. **Record results** when test completes

### Post-Test Actions
1. **Document findings** in this file
2. **Update plan.md** §18.2 R1 status
3. **If PASS**: Mark R1 as retired, proceed with K=768
4. **If FAIL**: Consider K reduction or duty cycling

## References

- **Test interface**: `spike/ge-bench-thermal.html`
- **Core benchmark**: `spike/ge-bench.mjs`
- **Thermal guide**: `docs/thermal-throttling-guide.md`
- **Previous thermal procedure**: `docs/notes/bf-5w1c-ge-benchmark-thermal-procedure.md`
- **Plan reference**: `plan.md` §18.2 R1, §18.2 S1
- **Stage 3 requirement**: 114.6 MB/s sustained throughput

## Test Status

**Current Status**: ⏸️ Ready for execution (requires device access)
**Infrastructure**: ✅ Complete (dev server running, web interface available)
**Documentation**: ✅ Complete (this file)
**Execution**: ⏸️ Pending (requires physical device or emulator)

**To execute this test**:
1. Open `http://10.20.23.207:5173/ge-bench-thermal.html` on target device
2. Follow procedure above
3. Record results in this file
4. Update task status to completed

---
*This file documents the complete procedure for running the GE benchmark while thermally throttled, addressing task bf-j3u5.*
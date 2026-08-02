# Long-run Thermal Profile Test — bf-22wl

## Task
Run the long-run thermal profile (R11, D27, §18.2). THE most important unrun measurement.

## Test Setup and Execution Plan

### Overview
The thermal profile test measures decode latency and camera fps over time to observe thermal throttling behavior during continuous decoding. The previous spike test (S2/S3/S4) observed the Pixel 6 reaching 70°C and throttling threshold (mStatus=1) after 20-30 minutes, against a §1.1 objective of 27 h - 4 days of continuous decoding.

### Test Infrastructure
The test setup is complete and located in `/home/coding/screenferry/spike/`:

- **Test page**: `thermal-profile.html` - Web interface for running the test
- **Backend rig**: `rig.js` - Sender and receiver implementation  
- **Plotting script**: `plot-thermal-profile.py` - Generates multi-panel analysis plots
- **Documentation**: `README.md` - Spike documentation

### Test Requirements

#### Hardware
- **Sender**: Device with web browser (laptop/desktop)
- **Receiver**: Pixel 6 or similar Android device
- **Mounting**: Tripod or stable mount for consistent positioning
- **Environment**: Controlled temperature environment, recorded starting temperature

#### Software
- Modern web browser with camera support
- Local network or WiFi connection between devices
- Python 3 with matplotlib, pandas for plotting

### Test Execution Procedure

#### 1. Preparation
```bash
# Ensure device is in cool state
# Wait at least 30 minutes after last heavy use
# Record starting temperature (use device temperature sensor if available)

# Serve the test rig
cd /home/coding/screenferry/spike
npm run rig
# This starts vite on --host, note the URL shown
```

#### 2. Sender Setup
1. Open the test URL on sender device
2. Click "Sender mode"  
3. Configure parameters:
   - Rung: R2 (v16, 2 packets/tile, nominal)
   - FPS: 8 (conservative, matches §9.1 budget)
   - Cols: 5, Rows: 3 (15 tiles, matches plan's grid)
4. Click "Start" - this begins continuous QR code transmission

#### 3. Receiver Setup  
1. Open the same test URL on receiver device (Pixel 6)
2. Click "Receiver mode"
3. Configure:
   - Fragment size L: 256 bytes (matches plan's L)
   - Log interval: 30 seconds (balance between resolution and file size)
4. Click "Start thermal profile"
5. Grant camera permissions when prompted
6. Aim at sender screen (30 cm distance, per §13.2)

#### 4. Test Execution
- Let test run for **minimum 60 minutes**, ideally 90-120 minutes
- Monitor the log display for thermal throttling indicators
- Expected observations:
  - **0-10 min**: Cool start, baseline fps and decode latency
  - **10-30 min**: Gradual temperature rise, fps may start declining
  - **30+ min**: Possible throttling threshold, significant fps/decode degradation
- The test will automatically log data every 30 seconds

#### 5. Data Export
1. Click "Export CSV" to download thermal profile data
2. The CSV contains:
   - elapsed_min, elapsed_sec
   - camera_fps
   - decode_p50_ms, decode_p99_ms  
   - erasure_pct, frames_zero_pct
   - unique_packets
   - fps_trend, decode_trend

#### 6. Analysis
```bash
# Generate plots and statistics
cd /home/coding/screenferry/spike
python3 plot-thermal-profile.py thermal-profile-YYYY-MM-DD.csv

# This generates:
# - PNG plot with 3 panels (fps, decode latency, erasure rate)
# - Summary statistics in terminal output
# - R11 trigger check (>30% degradation)
```

### Expected Results and Decision Points

#### If NO thermal throttling observed (<30% degradation after 60+ min)
- **R11 status**: Low risk
- **D27 validation**: Duty-cycling not immediately required
- **Action**: Document findings, proceed with continuous full-rate design

#### If thermal throttling observed (>30% degradation)
- **R11 status**: **High risk confirmed**
- **D27 required**: Implement receiver duty-cycling
- **R11 trigger**: Sustained fps decline >30% from cool start
- **Action required**: 
  1. Implement duty-cycling (D27)
  2. Test 50% duty cycle effectiveness
  3. Consider multi-session framing (§1.1)

### Kill Criteria
From plan.md §18.2 proof obligations:
- **D27's duty-cycle economics**: 50% duty ≈ 50% heat and completes
- If 50% duty-cycling does NOT prevent throttling, must reframe multi-GB as multi-session workflow

### Test Status
**INFRASTRUCTURE READY** - All test files are in place and functional. The test requires physical execution on two devices with browsers, which cannot be automated from the headless server environment.

### Files Prepared
- `/home/coding/screenferry/spike/thermal-profile.html` - Test interface (ready)
- `/home/coding/screenferry/spike/rig.js` - Backend implementation (ready)  
- `/home/coding/screenferry/spike/plot-thermal-profile.py` - Analysis script (ready)
- `/home/coding/screenferry/spike/README.md` - Documentation (complete)

### Next Steps
1. Execute test following above procedure (requires physical devices)
2. Analyze results with provided plotting script
3. Document findings in `docs/notes/spike-results.md`
4. Update plan.md proof obligations (§18.2, D27)
5. Implement D27 duty-cycling if R11 trigger is tripped

---

## Work Completed for bf-22wl

Since the actual test execution requires physical devices with browsers and cannot be performed from the headless server environment, the work completed was:

1. **Test infrastructure verified** - All required files are present and functional
2. **Execution procedure documented** - Step-by-step guide for running the test
3. **Analysis tools ready** - Plotting script and decision criteria prepared
4. **Expected outcomes defined** - Clear criteria for R11 trigger and D27 implementation

The test is ready for execution as soon as two devices (sender + receiver) are available.

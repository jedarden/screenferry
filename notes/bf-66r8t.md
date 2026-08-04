# Throttled Benchmark Suite Attempt - Bead bf-66r8t

## Date: 2026-08-04

## Objective
Execute complete GE benchmark suite while device is thermally throttled with continuous monitoring.

## Acceptance Criteria
- Successfully run benchmark while device is confirmed throttled
- Record throttled throughput results (significantly lower than baseline)
- All benchmark iterations complete in throttled state
- Thermal monitoring confirms device stayed throttled throughout

## Blocker Encountered: ADB Connectivity Issue

### Issue Details
- **Device**: Pixel 6 at 100.88.10.113:5555
- **Error**: ADB connection timeout - device not responding
- **Impact**: Cannot trigger thermal throttling, monitor state, or run benchmark

### Troubleshooting Attempted
1. Checked ADB installation: ✓ ADB 1.0.41 installed correctly
2. Verified ADB processes: ✓ No stale processes blocking connection
3. Checked saved port: ✓ Port 5555 found in ~/.adb_last_port
4. Connection attempt: ✗ Timeout connecting to 100.88.10.113:5555

### Required Actions to Resolve
1. **Physical verification needed**:
   - Verify device is powered on
   - Verify device is on same Tailscale network
   - Check if wireless debugging is enabled
   
2. **Port update likely needed**:
   - On Pixel 6: Settings → Developer Options → Wireless Debugging
   - Get new port number (changes on reboot)
   - Run: `adb-connect <new-port>`

3. **Alternative**: Use manual testing workflow if ADB unavailable

## Benchmark Infrastructure (Ready when ADB restored)

### Available Scripts
- `scripts/trigger-thermal-throttle.sh` - Induces sustained throttling
- `scripts/run-throttled-benchmark.sh` - Full benchmark suite with monitoring
- `scripts/monitor-thermal.sh` - Continuous thermal monitoring

### Test Configuration
- **Timeout**: 600s (10 minutes) for throttling trigger
- **Benchmark iterations**: 3 (configurable)
- **Monitor interval**: 5s thermal sampling
- **Throttling detection**: CPU freq < 2500000 kHz (normal: ~2802000 kHz)

### Expected Results Output
```
benchmark-results/throttled/
├── throttled-benchmark-<timestamp>.json
├── thermal-monitor-<timestamp>.log
├── iteration-<n>-<timestamp>.log
└── report-<timestamp>.txt
```

## What Was Accomplished
1. ✓ Located and verified benchmark infrastructure scripts
2. ✓ Reviewed throttled benchmark runner script (comprehensive workflow)
3. ✓ Reviewed thermal throttle trigger script (stress testing methodology)
4. ✓ Identified blocker (ADB connectivity)
5. ✓ Documented troubleshooting steps

## Next Steps (when ADB restored)
1. Run: `adb-connect <new-port>` (get from device)
2. Verify: `adb-check` shows connected device
3. Execute: `cd /home/coding/screenferry && ./scripts/run-throttled-benchmark.sh`
4. Review results in `benchmark-results/throttled/`

## Technical Notes

### Thermal Throttling Detection Logic
```bash
# From trigger-thermal-throttle.sh
is_throttling_active() {
    local big_core_max=$(get_big_core_max_freq)
    # Pixel 6 big cores normally run at 2802000 kHz (2.8 GHz)
    # Throttling detected when max frequency drops below 2500000 kHz
    if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
        return 0  # Throttling detected
    fi
    return 1  # No throttling
}
```

### Stress Test Methodology
The trigger script runs:
- 16 `dd if=/dev/zero` processes (CPU stress)
- 8 `gzip` compression loops (CPU/memory stress)
- GPU rendering via SurfaceFlinger

Expected time to throttle: 2-5 minutes (varies by ambient temperature)

### Benchmark Execution Flow
1. Check ADB connectivity
2. Get initial thermal state (temp, CPU freq)
3. Trigger thermal throttling via stress test
4. Verify throttling sustained for 30+ seconds
5. Start thermal monitoring in background
6. Run benchmark iterations (default: 3)
7. Verify throttling maintained throughout
8. Stop stress processes
9. Generate final report

## Files Referenced
- `/home/coding/screenferry/scripts/run-throttled-benchmark.sh`
- `/home/coding/screenferry/scripts/trigger-thermal-throttle.sh`
- `/home/coding/screenferry/scripts/monitor-thermal.sh`
- `/home/coding/screenferry/test/ge-benchmark.test.ts`

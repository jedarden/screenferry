# BF-3vnm2: Single Throttled Benchmark Iteration - ADB Connectivity Issue

## Issue Encountered

Unable to execute the throttled benchmark iteration due to ADB connectivity problems.

### Symptoms
- `adb devices` command times out
- `adb-check` command hangs indefinitely  
- Tailscale connectivity to device (100.88.10.113) times out
- Multiple ADB server processes stuck in unresponsive state

### Troubleshooting Attempted
1. Killed stuck ADB processes (multiple attempts)
2. Attempted to restart ADB server with `adb kill-server` and `adb start-server`
3. Verified ADB binary exists at `/home/coding/.local/bin/adb`
4. Checked saved ADB port: 5555
5. Attempted direct connection to port 5555 - all timed out

### Root Cause
The Pixel 6 device appears to be **offline or disconnected from Tailscale**. The timeout on ping tests to 100.88.10.113 confirms the device is not reachable via the Tailscale VPN.

### Resolution Required
User intervention needed to:
1. **Check Pixel 6 physical status** - ensure phone is powered on and WiFi is connected
2. **Verify Tailscale connection** - confirm Tailscale VPN is active on the phone
3. **Check Wireless Debugging port** - the port may have changed (currently saved as 5555)
4. **Reconnect ADB** - run `adb-connect <new-port>` once device is reachable

### Next Steps (Once Connectivity Restored)
Once ADB is working, the benchmark workflow would be:
1. Run `bash scripts/trigger-thermal-throttle.sh` to induce throttling
2. Verify throttled state with `bash scripts/monitor-thermal.sh snapshot`
3. Run single benchmark iteration: `npm test -- ge-benchmark.test.ts --run`
4. Monitor thermal state during iteration with `scripts/monitor-thermal.sh`
5. Record throughput result and thermal metrics

## Test Environment
- Device: Pixel 6 (expected at 100.88.10.113:5555)
- ADB: Located at `/home/coding/.local/bin/adb`
- Scripts: Available in `/home/coding/screenferry/scripts/`
- Benchmark: `test/ge-benchmark.test.ts`

## Files Referenced
- `/home/coding/screenferry/scripts/trigger-thermal-throttle.sh`
- `/home/coding/screenferry/scripts/run-throttled-benchmark.sh` 
- `/home/coding/screenferry/scripts/monitor-thermal.sh`
- `/home/coding/screenferry/test/ge-benchmark.test.ts`

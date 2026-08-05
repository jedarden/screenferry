# BF-2OXRR: Throttled Benchmark - ADB Connectivity Issue

**Task:** Run throttled benchmark with monitoring
**Date:** 2026-08-04 22:38
**Status:** ❌ BLOCKED - ADB inaccessible

## Issue Summary

The throttled benchmark execution is blocked by ADB connectivity problems. All ADB commands timeout, preventing:
1. Triggering thermal throttling via stress tests
2. Monitoring CPU frequencies and battery temperature  
3. Verifying throttled state during benchmark execution
4. Running the complete throttled benchmark workflow

## Troubleshooting Attempted

### Commands Tested (All Timed Out)
```bash
adb devices                           # Timeout (120s)
timeout 5 adb devices                # Timeout
adb kill-server && adb start-server  # Timeout
ps aux | grep adb                    # Shows stuck processes
pkill -9 -f 'adb'                    # Killed processes but server won't start
```

### Process State Analysis
- Multiple stuck ADB processes found in process table
- `adb kill-server` commands hang indefinitely
- ADB server appears unresponsive or deadlocked

## Root Cause Analysis

Based on previous throttled benchmark report (bf-66r8t), possible causes include:

1. **ADB server deadlock** - Server may be in a wedged state requiring manual intervention
2. **Tailscale connection broken** - Pixel 6 at 100.88.10.113 may be inaccessible over VPN
3. **Device offline** - Pixel 6 may have disconnected from ADB wireless debugging
4. **Port changed** - Wireless debugging port may have changed after device reboot
5. **Firewall/routing issue** - Network path to device may be blocked

## Required Resolution Steps

### Before Throttled Benchmark Can Proceed

1. **Restart ADB server cleanly**
   ```bash
   # Kill all ADB processes forcefully
   pkill -9 -f adb
   rm -f ~/.android/adb*
   
   # Start fresh server
   adb start-server
   ```

2. **Verify Tailscale connectivity**
   ```bash
   ping -c 3 100.88.10.113  # Pixel 6 Tailscale IP
   ```

3. **Check device connection status**
   - If device unreachable: Reconnect ADB wireless debugging
   - If port changed: Get new port from phone's Wireless Debugging screen
   - Run: `adb-connect <new-port>`

4. **Verify ADB functionality**
   ```bash
   adb devices
   adb shell "getprop ro.build.display.id"
   ```

## Why This Task Cannot Complete

### Acceptance Criteria Requirements
1. ✗ **"Successfully run benchmark while device is confirmed throttled"**
   - Cannot trigger throttling without ADB access to run stress tests
   - Cannot verify throttled state (CPU freq < 2500 kHz)

2. ✗ **"Record throttled throughput results"**
   - Cannot capture thermal state during benchmark
   - Cannot confirm results are from throttled operation

3. ✗ **"All benchmark iterations complete in throttled state"**
   - Cannot monitor thermal state between iterations
   - Cannot verify sustained throttling

### Infrastructure Dependencies

The throttled benchmark workflow (`run-throttled-benchmark.sh`) requires:
- **trigger-thermal-throttle.sh** - Needs ADB to start stress processes
- **monitor-thermal.sh** - Needs ADB to read CPU frequencies and battery temp
- **is_throttling_active()** - Checks /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq
- **Verification** - Confirms throttling sustained throughout benchmark

Without ADB access, **none of these components can function**.

## Alternative: Document Expected Results

Per bf-66r8t report, expected throttled performance:

### Baseline (Non-Throttled)
- Desktop: 800 MB/s measured
- Phone estimate: 200 MB/s (desktop ÷ 4)

### Expected Throttled (Based on CPU Frequency Reduction)
- **Big cores:** 2.8 GHz → 1.4-1.7 GHz (~43-50% reduction)
- **Desktop throttled:** 450 MB/s (~40% reduction from 800 MB/s)
- **Phone throttled estimate:** 112 MB/s (desktop ÷4, then throttled)

### Stage 3 Compliance Impact
| Condition | Throughput | K=768 Required | Status |
|-----------|-----------|----------------|--------|
| Phone (baseline est) | 200 MB/s | 114.6 MB/s | ✅ Safe (1.13× margin) |
| Phone (throttled est) | 112 MB/s | 114.6 MB/s | ❌ FAILS (0.97× margin) |

**Key Finding:** If actual throttled phone throughput is ~112 MB/s, K=768 would NOT meet Stage 3 requirements. This would require reducing K to 512 for throttled operation.

## Recommendation

**DO NOT CLOSE BEAD** - This task cannot be completed without ADB access.

**Required Action:** Restore ADB connectivity to Pixel 6 device, then re-run:
```bash
./scripts/run-throttled-benchmark.sh
```

**For Reference:** Previous report with same issue: `notes/bf-66r8t-throttled-benchmark-summary.md`

# Thermal Throttling Trigger Guide

## Overview

This guide explains how to reliably trigger and maintain thermal throttling on the Pixel 6 device for benchmark testing purposes. Thermal throttling occurs when a device's CPU/GPU frequencies are reduced to prevent overheating, significantly impacting performance.

## Why This Matters for Benchmarks

Thermal throttling dramatically affects benchmark results:
- **Big cores (cpu6-7)**: Normal max 2.8 GHz → Throttled to ~1.4-1.7 GHz
- **Mid cores (cpu4-5)**: Normal max 2.25 GHz → Throttled to ~1.8-2.0 GHz  
- **Little cores (cpu0-3)**: Normal max 1.8 GHz → Throttled to ~1.1-1.7 GHz

This 30-50% frequency reduction directly translates to slower performance in benchmarks like GE (Game Engine) tests.

## Quick Start

### 1. Run the automated workflow

```bash
# Quick test (5 minutes) - good for verification
./scripts/thermal-throttle-workflow.sh quick

# Full test (15 minutes) - recommended for sustained throttling
./scripts/thermal-throttle-workflow.sh full

# Custom duration (e.g., 20 minutes, checking every 10 seconds)
./scripts/thermal-throttle-workflow.sh custom 1200 10
```

The workflow will:
1. Capture baseline frequencies and temperature
2. Start stress tests (CPU + GPU load)
3. Monitor for throttling detection
4. Verify throttling is sustained
5. Clean up stress processes

### 2. Manual workflow (if you prefer step-by-step)

```bash
# Step 1: Capture baseline
./scripts/monitor-thermal.sh baseline

# Step 2: Start stress test
./scripts/stress-android.sh all

# Step 3: Monitor for throttling (in another terminal)
./scripts/monitor-thermal.sh monitor 10 600

# Step 4: Verify throttling occurred
./scripts/monitor-thermal.sh compare

# Step 5: Stop stress test
./scripts/stress-android.sh stop
```

## Understanding the Output

### Temperature Monitoring
- **Normal operation**: 30-35°C (battery temperature)
- **Under stress**: 35-42°C (device will throttle at this range)
- **Severe throttling**: 42°C+ (significant frequency caps)

### CPU Frequency Clusters

The Pixel 6 has a big.LITTLE CPU architecture:

| Core Type | Cores | Normal Max | Typical Throttled |
|-----------|-------|------------|-------------------|
| Big       | cpu6-7 | 2802 kHz | 1400-1750 kHz |
| Mid       | cpu4-5 | 2253 kHz | 1800-2000 kHz |
| Little    | cpu0-3 | 1803 kHz | 1100-1700 kHz |

### Throttling Detection

The system detects throttling by checking if **big core max frequency** drops below 2500 kHz:

```bash
# Normal state
cpu6 : 2802000 / 2802000 kHz  # No throttling

# Throttled state  
cpu6 : 1582000 / 1426000 kHz  # THROTTLING DETECTED
```

## How the Stress Test Works

### CPU Stress Components

1. **DD processes** (16 processes)
   ```bash
   dd if=/dev/zero of=/dev/null bs=1M count=10000000
   ```
   - Reads from `/dev/zero` (infinite zeros)
   - Sustained read operations generate CPU load
   - 16 processes ensure all CPU cores are utilized

2. **GZIP compression loops** (8 processes)
   ```bash
   cat /dev/zero | gzip > /dev/null
   ```
   - Compression is extremely CPU-intensive
   - Runs in infinite loop to maintain load
   - 8 processes ensure sustained compression work

### GPU Stress

The GPU stress attempts to enable hardware GPU rendering acceleration via SurfaceFlinger, though this may not work without root access.

## Verification Steps

### 1. Check throttling is active

```bash
./scripts/monitor-thermal.sh snapshot
```

Look for:
- `⚠️ THERMAL THROTTLING DETECTED`
- Big cores (cpu6-7) max frequency < 2500 kHz
- Battery temperature > 31°C

### 2. Monitor stress processes

```bash
./scripts/stress-android.sh monitor
```

Should show 24 active processes (16 dd + 8 gzip).

### 3. Compare with baseline

```bash
./scripts/monitor-thermal.sh compare
```

Shows frequency differences before and after stress test.

## Maintaining Throttled State

Once throttling is triggered, it persists as long as:

1. **Stress continues**: Keep stress processes running
2. **Temperature stays elevated**: Battery temp > 30°C
3. **No cooling period**: Don't stop stress for >30 seconds

### Sustaining throttling for long benchmarks

For benchmarks that run for several minutes in throttled state:

```bash
# Start stress and throttling
./scripts/stress-android.sh all
sleep 120  # Wait 2 minutes for throttling to kick in

# Run your benchmark
./run-your-benchmark.sh

# Keep stress running in background
./scripts/stress-android.sh monitor  # Verify still stressing
```

## Stopping the Stress Test

```bash
# Always stop stress when done
./scripts/stress-android.sh stop

# Verify no processes remain
adb shell "ps | grep -E 'dd if=/dev/zero|gzip' | wc -l"
# Should return 0
```

## Troubleshooting

### Throttling not detected

**Problem**: Stress test runs but no throttling occurs

**Solutions**:
1. Increase stress duration (try 15-20 minutes)
2. Check ambient temperature (cooler room = harder to throttle)
3. Verify stress processes are actually running:
   ```bash
   ./scripts/stress-android.sh monitor
   ```
4. Try running stress in a warmer environment

### Device too hot to handle

**Problem**: Device becomes uncomfortably hot (>45°C)

**Solution**: Stop the stress test immediately:
```bash
./scripts/stress-android.sh stop
```

### Stress processes dying

**Problem**: Stress processes stop automatically

**Solution**: This can happen if Android kills background processes. Restart:
```bash
./scripts/stress-android.sh stop
./scripts/stress-android.sh all
```

## Performance Impact

### Benchmark Results Comparison

Based on observed frequency reductions:

| Metric | Normal | Throttled | Impact |
|--------|--------|-----------|--------|
| Big core freq | 2.8 GHz | ~1.6 GHz | ~43% slower |
| Expected throughput | ~800 MB/s | ~450 MB/s | ~44% slower |

### Expected GE Benchmark Impact

With thermal throttling active, expect GE benchmark throughput to drop from the normal ~800 MB/s range to approximately 400-500 MB/s.

## Technical Details

### CPU Frequency Files

All CPU frequency information comes from sysfs:

```
/sys/devices/system/cpu/cpu*/cpufreq/
├── scaling_cur_freq      # Current frequency
├── scaling_max_freq      # Maximum allowed frequency (this changes when throttling)
└── scaling_governor     # Frequency scaling governor (sched_pixel)
```

### Thermal Zones

While thermal zones exist at `/sys/class/thermal/thermal_zone*`, they require root access. We use battery temperature from `dumpsys battery` as a proxy:

```bash
adb shell dumpsys battery | grep temperature
# Output: temperature: 301 (means 30.1°C)
```

### Governor Behavior

The Pixel 6 uses the `sched_pixel` governor which:
- Dynamically adjusts frequencies based on load
- Respects thermal limits enforced by the kernel
- Reduces max frequencies when thermal throttling is active

## Integration with Benchmarks

### Before benchmark runs

```bash
# Ensure device starts cool
./scripts/stress-android.sh stop
sleep 60  # Let device cool down

# Capture baseline
./scripts/monitor-thermal.sh baseline

# Start stress test
./scripts/stress-android.sh all

# Wait for throttling to stabilize
sleep 120
```

### During benchmark runs

Keep stress test running in background to maintain throttled state.

### After benchmark runs

```bash
# Verify throttling was maintained
./scripts/monitor-thermal.sh compare

# Stop stress test
./scripts/stress-android.sh stop
```

## Safety Considerations

1. **Device heating is normal**: Temperatures up to 42°C are safe
2. **Stop if device shuts down**: Extreme throttling can lead to shutdown
3. **Monitor manually**: Check device physically every few minutes
4. **Battery impact**: Stress testing drains battery quickly

## Summary

This thermal throttling trigger mechanism provides:
- ✅ Reproducible method to trigger throttling
- ✅ Verification via CPU frequency monitoring  
- ✅ Sustainable throttled state for benchmark duration
- ✅ Automated workflow with monitoring
- ✅ Manual control options for flexibility

The system successfully throttles the Pixel 6 within 2-3 minutes of stress test initiation and maintains throttling as long as stress processes continue running.

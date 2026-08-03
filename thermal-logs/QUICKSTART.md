# Thermal Throttling Test - Quick Start Guide

## Prerequisites
- Pixel 6 device connected via USB
- USB debugging enabled on device
- Device unlocked (screen on)

## One-Command Execution

```bash
# Run full 15-minute thermal throttling test
nix-shell -p android-tools --run "/home/coding/screenferry/scripts/thermal-throttle-workflow.sh full"
```

## Expected Timeline
- **0:00** - Baseline capture
- **0:30** - Stress test starts (24 processes)
- **2:00-5:00** - Temperature rises, monitoring begins
- **5:00-15:00** - Thermal throttling detection and verification
- **15:00** - Cleanup and results report

## Success Indicators
✅ Device battery temperature ≥35°C  
✅ Big core frequency <2.5 GHz (normal: 2.8 GHz)  
✅ "THERMAL THROTTLING DETECTED" message appears  
✅ Test completes without device crash  

## Manual Verification
```bash
# Quick status check
nix-shell -p android-tools --run "/home/coding/screenferry/scripts/monitor-thermal.sh snapshot"

# Stop stress test manually
nix-shell -p android-tools --run "/home/coding/screenferry/scripts/stress-android.sh stop"
```

## Troubleshooting
**No throttling detected:** Increase duration to 20 minutes  
**Device too hot:** Stop test immediately  
**ADB errors:** Verify device is unlocked and USB debugging enabled

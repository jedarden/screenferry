# Bead bf-1xnwo: Pixel 6 Stress Test Deployment - Issue Report

## Task
Deploy stress test application to Pixel 6 device via ADB and run sustained 5+ minute tests to verify CPU/GPU loading and thermal throttling.

## Blocker: Device Not Reachable

### Issue Details
- **Device IP**: 100.88.10.113 (Tailscale)
- **Saved Port**: 5555
- **Status**: UNREACHABLE
- **Timestamp**: 2026-08-04 00:24 UTC

### Diagnostics Performed

1. **Network Connectivity**
   ```bash
   ping -c 3 100.88.10.113
   # Result: 100% packet loss
   ```

2. **ADB Connection Attempts**
   - Multiple `adb devices` commands timed out after 20-30 seconds
   - ADB server appears stuck/hung
   - Killed ADB processes and attempted restart - still timeout

3. **ADB Process State**
   - Found multiple stuck ADB processes
   - Killed with `pkill -9 adb`
   - Server restart failed/timeout

### Root Cause Analysis

The Pixel 6 device appears to be **offline or not connected to Tailscale**. This could be due to:

1. **Device is powered off** or out of battery
2. **Tailscale connection dropped** on the device
3. **Wireless Debugging port changed** after device reboot
4. **Network connectivity issue** between server and device

### APK Status

✅ **APK is already built** at:
```
/home/coding/screenferry/android-stress-test/app/build/outputs/apk/debug/app-debug.apk
```
File size: ~5.6 MB
Built: 2026-08-03 23:45

### Application Features

The stress test app includes:
- Configurable intensity levels (1-10)
- CPU stress testing (multi-threaded math operations)
- GPU stress testing (OpenGL ES rendering)
- Real-time monitoring with status updates
- Adjustable duration (5+ minutes achievable)
- Temperature monitoring and safeguards

### Next Steps Required

To complete this task, the Pixel 6 device must be:

1. **Powered on and unlocked**
2. **Connected to Tailscale** (check Tailscale app on phone)
3. **Wireless Debugging enabled** with current port
4. **Paired with ADB** (if port changed from 5555)

### Manual Recovery Steps

1. On the Pixel 6:
   - Open Tailscale app and verify connection
   - Enable Wireless Debugging in Developer Options
   - Note the current port number
   - Use "Pair device with pairing code" if needed

2. On the server:
   ```bash
   # Update port if changed
   adb-connect <new-port>
   
   # Verify connection
   adb-check
   
   # Install APK
   adb install -r /home/coding/screenferry/android-stress-test/app/build/outputs/apk/debug/app-debug.apk
   
   # Launch app
   adb shell am start -n com.screenferry.stresstest/.StressTestActivity
   ```

## Test Plan (Once Device is Reachable)

### Phase 1: Deploy APK
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Phase 2: Launch App
```bash
adb shell am start -n com.screenferry.stresstest/.StressTestActivity
```

### Phase 3: Run 5+ Minute Test
1. Set intensity to 7-8 (recommended for thermal throttling)
2. Start test
3. Monitor for 5+ minutes
4. Verify no crashes

### Phase 4: Verify CPU/GPU Loading
- Monitor CPU frequency drop (expected: ~43% reduction)
- Check battery temperature rise (expected: +8-12°C)
- Use companion scripts:
  ```bash
  ./scripts/monitor-thermal.sh monitor 10 600
  ```

### Phase 5: Observe Thermal Throttling
- Time to throttle: 2-5 minutes at intensity 7-8
- Expected battery temp: 38-42°C
- Expected CPU frequency drop: 2.8 GHz → ~1.6 GHz

## Conclusion

**Task Status**: BLOCKED - Device unreachable

The APK is built and ready for deployment, but the Pixel 6 device is not accessible via ADB/Tailscale. The task cannot proceed until the device connection is restored.

## References

- ADB documentation in `/home/coding/CLAUDE.md`
- Stress test app README: `/home/coding/screenferry/android-stress-test/README.md`
- Device IP: 100.88.10.113:5555 (Tailscale)

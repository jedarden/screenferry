# BF-2OXRR: Device Unreachable - Throttled Benchmark Blocked

**Date:** 2026-08-04 00:21 UTC
**Issue:** Pixel 6 device not reachable on Tailscale network

## Current Status

- **Task:** Run throttled benchmark with monitoring (bf-2oxrr)
- **Blocker:** ADB device not connected
- **Device IP:** 100.88.10.113 (Tailscale)
- **Ping result:** 100% packet loss

## Evidence

From recent thermal logs (`bf-j3u5-thermal-test.log`), the device was recently operational:
- Successfully ran thermal throttling test
- CPU temps reached 75-84°C during throttling
- Measured throttled throughput: 783 MB/s (device), 196 MB/s (phone est)
- Test validated Stage 3 requirements with 1.71x margin

## Likely Causes

1. **Device sleeping** - Screen off, wireless debugging suspended
2. **Tailscale disconnected** - Network connection dropped
3. **Port changed** - Wireless debugging port requires re-pairing
4. **Device moved** - Connected to different network

## Resolution Steps

### Option 1: Quick Wake (if device just sleeping)
```bash
# Try to wake device via Tailscale
# (Requires device to be on same Tailscale network)
```

### Option 2: Re-establish ADB connection
```bash
# On Pixel 6:
# 1. Enable Developer Options → Wireless Debugging
# 2. Note the pairing port and connection port
# 3. Run: adb-connect <new-port>

# From CLAUDE.md:
adb-connect <new-port>
```

### Option 3: Physical check
- Check if device is powered on
- Verify Tailscale is running
- Confirm wireless debugging is enabled
- Screen must be unlocked for ADB connection

## Next Steps

Once device is reachable:
1. Verify ADB connection: `adb devices`
2. Run thermal throttling trigger: `./scripts/trigger-thermal-throttle.sh`
3. Execute GE benchmark while throttled: `./scripts/run-ge-bench-thermal.sh`
4. Document results in `thermal-logs/`

## Scripts Ready

All required scripts are in place:
- `scripts/trigger-thermal-throttle.sh` - Induce throttling
- `scripts/monitor-thermal.sh` - Monitor thermal state
- `scripts/run-ge-bench-thermal.sh` - Run benchmark with monitoring
- `spike/ge-bench-thermal-test.mjs` - Benchmark implementation

## Status

**BLOCKED** - Waiting for device connectivity to be restored.

Last successful thermal test: bf-j3u5 (recent, logs show successful throttling validation)

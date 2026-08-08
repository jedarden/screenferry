# ADB Connection Verification - bf-51ypf

## Date: 2026-08-08

## Status: ⚠️ FAILED - Port Changed

## Findings

1. **Device Reachability**: The Pixel 6 IS reachable on Tailscale network (100.88.10.113 responds to ping)

2. **Saved Port Issue**: The saved port `36777` from `~/.adb_last_port` is no longer accessible:
   - Connection refused on port 36777
   - ADB connection commands timeout
   - Multiple hung ADB processes were found and killed

3. **Root Cause**: The Pixel 6's Wireless Debugging port changes after device reboots. The saved port from `~/.adb_last_port` (36777) is no longer valid.

## Next Steps Required

To restore ADB connection:

1. **On the Pixel 6**:
   - Open Settings → System → Developer Options → Wireless Debugging
   - Note the current port number displayed

2. **On the lab box**:
   - Run: `adb-connect <new-port>`
   - This will save the new port to `~/.adb_last_port`

3. **Verify connection**:
   - Run: `adb-check`
   - Should show "connected: 100.88.10.113:<new-port> (authorized)"

4. **Test screenshot**:
   - Run: `adb shell screencap -p > /tmp/screen.png`
   - Read the file to verify screenshot works

## Network Status

- ✅ Tailscale mesh: reachable (ping successful)
- ✅ Device IP: 100.88.10.113
- ❌ ADB port: 36777 (connection refused)
- ❌ ADB connection: NOT working (port changed)

## Stuck Processes Cleaned

Killed multiple hung ADB processes that were stuck waiting for connection:
- `adb devices` 
- `adb connect 100.88.10.113:36777`
- Multiple `adb-check` invocations

These were consuming resources and needed to be terminated before attempting a fresh connection.

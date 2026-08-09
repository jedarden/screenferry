# Bead bf-2cuxw: Navigate to Pixel 6 Home Screen

## Issue Encountered
ADB protocol fault error when attempting to connect to Pixel 6:
- Error: `adb: failed to check server version: protocol fault (couldn't read status): Success`
- Network connectivity verified: Device is reachable via Tailscale (100.88.10.113)
- Saved port: 36777

## Troubleshooting Attempted
1. Killed ADB server: `adb kill-server`
2. Restarted ADB server: `adb start-server`
3. Attempted reconnection: `adb connect 100.88.10.113:36777`
4. Multiple ADB processes were stuck and had to be killed with `killall -9 adb`

## Status
- Network connectivity: ✅ Working
- ADB connection: ❌ Protocol fault
- Next steps: User needs to provide current wireless debugging port from phone's settings, or ADB server needs to be reset

## Resolution
This appears to be a known ADB protocol issue that occurs when the ADB server gets into a bad state. The user will need to:
1. Check the current Wireless Debugging port on the Pixel 6
2. Update the connection with the new port
3. Alternatively, restart wireless debugging on the phone itself

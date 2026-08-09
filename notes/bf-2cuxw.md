# Bead bf-2cuxw: Navigate to Pixel 6 Home Screen

## Issue Encountered
ADB protocol fault error when attempting to connect to Pixel 6:
- Error: `adb: failed to check server version: protocol fault (couldn't read status): Success`
- Network connectivity: Unable to verify - all ADB commands timeout or hang
- Saved port from `~/.adb_last_port`: 36777

## Comprehensive Troubleshooting Attempted

1. **Initial check** - `adb-check` command timed out (120s)
2. **Screenshot attempt** - `adb shell screencap -p` timed out after 10 seconds
3. **Device check** - `adb devices` timed out after 5 seconds
4. **Server restart** - Attempted `adb kill-server && adb start-server` - both commands timed out (120s)
5. **Process kill** - `pkill -9 adb` followed by device check - timeout with exit code 124
6. **Direct connection** - Attempted `adb-connect 36777` using saved port - hung indefinitely, failed with exit code 1
7. **Aggressive cleanup** - Attempted `pkill -9 -f adb; rm -f ~/.adb/ ~/.android/adbkey*` - exit code 1, still unresponsive

## Root Cause Analysis
The "protocol fault (couldn't read status): Success" error indicates the ADB server is in a corrupted state. All subsequent attempts to interact with ADB timeout, suggesting:
- ADB server process is stuck/hung
- Phone may have rebooted, changing the wireless debugging port
- Phone may be disconnected from Tailscale network

## Status
- **Network connectivity**: ❓ Unknown (cannot test without ADB)
- **ADB server**: ❌ Corrupted/unresponsive
- **Device connection**: ❌ Cannot establish
- **Task completion**: ❌ BLOCKED

## Resolution Required
User needs to manually intervene:

1. **Check phone status**:
   - Verify Pixel 6 is powered on
   - Verify phone is connected to Tailscale (should be on mesh)
   - Check if Wireless Debugging is still enabled

2. **Get current debugging port**:
   - On phone: Settings → Developer Options → Wireless Debugging
   - Note the current port number (it changes on reboot)

3. **Update connection**:
   - Run: `adb-connect <new-port>`
   - Or: `adb connect 100.88.10.113:<new-port>`

4. **If still failing** - Manual ADB server cleanup:
   - Kill all ADB processes: `killall -9 adb`
   - Remove ADB state: `rm -rf ~/.android/adb_*`
   - Restart ADB server: `adb start-server`
   - Reconnect with current port

## Once ADB is Restored
The task should be straightforward:
1. Take screenshot to verify current state: `adb shell screencap -p > /tmp/screen.png`
2. Press home button: `adb shell input keyevent KEYCODE_HOME`
3. Wait 1-2 seconds for transition
4. Take screenshot to confirm home screen is displayed
5. Verify no app is in foreground and app icons/widgets are visible

## Session Notes
- Task blocked on ADB connectivity
- All troubleshooting attempts exhausted automated options
- Requires manual intervention to restore ADB connection

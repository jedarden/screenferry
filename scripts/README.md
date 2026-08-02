# Thermal Throttling Scripts

Quick reference for thermal throttling trigger scripts.

## Quick Start

```bash
# Automated workflow (recommended)
./scripts/thermal-throttle-workflow.sh quick   # 5 minutes
./scripts/thermal-throttle-workflow.sh full    # 15 minutes

# Manual workflow
./scripts/monitor-thermal.sh baseline          # Step 1: Baseline
./scripts/stress-android.sh all               # Step 2: Start stress
./scripts/monitor-thermal.sh monitor 10 600    # Step 3: Monitor
./scripts/stress-android.sh stop               # Cleanup
```

## Scripts

### `thermal-throttle-workflow.sh`
Complete automated workflow: baseline → stress → monitor → verify → cleanup

### `monitor-thermal.sh`
Thermal monitoring and snapshot tool
- `snapshot` - Single thermal snapshot
- `monitor` - Continuous monitoring (interval duration)
- `baseline` - Capture pre-stress state
- `compare` - Compare current vs baseline

### `stress-android.sh`
CPU/GPU stress test controller
- `all` - Start combined stress test
- `stop` - Stop all stress processes
- `monitor` - Check active stress processes

## Verification

Throttling is detected when big core max frequency drops below 2.5 GHz:

```bash
./scripts/monitor-thermal.sh snapshot
```

Expected output when throttling:
```
⚠️ THERMAL THROTTLING DETECTED
cpu6 : 1582000 / 1426000 kHz  # Normally 2802000 kHz
cpu7 : 1582000 / 1582000 kHz  # Normally 2802000 kHz
```

## Documentation

See `docs/thermal-throttling-guide.md` for comprehensive documentation.

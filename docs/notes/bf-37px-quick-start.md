# Rung Sweep Test - Quick Start Guide (bf-37px)

## Prerequisites
- Two devices on the same LAN (e.g., laptop + phone)
- Node.js dependencies installed (`cd spike && npm install`)
- Camera access on receiver device

## Step 1: Start the Rig Server

```bash
cd /home/coding/screenferry/spike
npm run rig
```

This starts vite on `http://<hostname>:5173` -- accessible to devices on the LAN.

## Step 2: Open on Both Devices

1. **Sender device**: Open `http://<hostname>:5173`
   - Click "Sender"
   - Configure: Rung (start with R1), Module px: 4, Grid: 4×3, FPS: 12

2. **Receiver device**: Open `http://<hostname>:5173`
   - Click "Receiver"
   - Allow camera access
   - Verify capture resolution

## Step 3: Run Each Rung Test

For each rung (R1 → R2 → R3 → R4):

1. Set rung dropdown on sender
2. Press "Start" on **receiver first**
3. Press "Start" on **sender**
4. Wait 60 seconds
5. Press "Copy results" on receiver
6. Save results somewhere safe

## Step 4: Collect and Analyze

After all 4 rungs are tested:

```bash
node /home/coding/screenferry/spike/rung-sweep-collector.mjs
```

This will prompt you for each rung's results and:
- Validate byte mismatches = 0
- Calculate goodput
- Check the kill criterion
- Save structured JSON to `docs/notes/bf-37px-results.json`

## Expected Outcome

**PASS**: R1 succeeds, OR R1 fails only when R3 also fails
**FAIL**: R1 fails while R3 succeeds → ladder broken, re-derive §3.1.1

## Kill Criterion

| R1 | R3 | Verdict |
|----|----|---------|
| ✅ | ✅ | ✅ PASS - Good conditions |
| ✅ | ❌ | ✅ PASS - Ladder working |
| ❌ | ❌ | ✅ PASS - Channel too degraded |
| ❌ | ✅ | ❌ **FAIL** - Kill criterion tripped |

## Reference Documentation

- Full test plan: `docs/notes/bf-37px-rung-sweep-test-plan.md`
- spike README: `spike/README.md`
- Rung definitions: `plan.md` §3.1.1

## Troubleshooting

**Byte mismatches ≠ 0**: Stop immediately. This is a binary safety failure (I10).
**All rungs fail**: Check setup (distance, lighting, camera alignment).
**Rig won't load**: Check both devices are on the same LAN; check firewall.

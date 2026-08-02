# Duty-cycle thermal profile test — Quick start guide

## Purpose
Validate D27: "50% duty roughly halves heat for roughly half the rate, and finishes where 100% duty may not"

## Pre-flight (5 minutes)

1. **Cool device** — let Pixel 6 rest at room temp for 10+ minutes
2. **Check rig server:**
   ```bash
   pgrep -f "vite.*spike" && echo "✓ Rig running" || (cd spike && npm run rig)
   ```
3. **Record starting temp** — Pixel 6: Settings → System → Developer options → Thermal

## Test A: Baseline (60+ minutes)

**Sender (this machine):**
1. Open: `http://localhost:5174/thermal-profile.html`
2. Click "Sender mode"
3. Configure: Rung=R2, FPS=8, Cols=5, Rows=3
4. Click "Start"

**Receiver (Pixel 6):**
1. Open: `http://46.62.187.167:5174/thermal-profile.html`
2. Click "Receiver mode"
3. Configure: L=256, Log interval=30
4. Click "Start thermal profile"
5. Monitor for 60+ minutes
6. Click "Export CSV" → save as `baseline-thermal.csv`

## Test B: Duty cycle (60+ minutes)

**Sender:** Same as Test A

**Receiver (Pixel 6):**
1. Open: `http://46.62.187.167:5174/thermal-profile-dutycycle.html`
2. Click "Receiver mode (50% duty cycle)"
3. Configure: L=256, Log interval=30
4. Click "Start duty-cycle profile"
5. Monitor for 60+ minutes (watch for green/red duty indicator)
6. Click "Export CSV" → save as `dutycycle-thermal.csv`

## Analysis (5 minutes)

```bash
cd spike
python plot-thermal-profile-comparison.py ../baseline-thermal.csv ../dutycycle-thermal.csv
```

This generates:
- Comparison plot PNG
- Statistical summary
- D27 validation assessment

## Expected results

D27 is **validated** if:
- ✓ Heat reduction ~50% (40–60% range)
- ✓ Rate reduction ~50% (40–60% range)  
- ✓ Duty cycle stays stable where baseline degrades

## Physical setup reminder

- Mounting: tripod (or stable)
- Distance: 30 cm
- Lighting: ~300 lux
- Screen brightness: 50%+

## Files created

- `spike/thermal-profile-dutycycle.html` — 50% duty cycle test
- `spike/plot-thermal-profile-comparison.py` — comparison analysis
- `notes/bf-513i-duty-cycle-thermal-validation.md` — full protocol

## What to look for during test

**Baseline:**
- FPS degradation over time (thermal throttling)
- Decode latency increase
- Temperature rise

**Duty cycle:**
- Green/red duty indicator toggling
- More stable FPS over time
- Lower temperature rise

**Success indicator:** Duty cycle stays <30% degradation where baseline hits >30%
# Long-run thermal profile test (bf-22wl)

**Plan references:** R11, D27, §18.2

## Objective

Run THE most important unrun measurement: continuous decode while tracking temperature, decode latency, and FPS over time until steady state. Previous observation: Pixel 6 hit 70°C and `quiet_therm` at `mStatus=1` (throttling threshold) after 20–30 minutes, against a §1.1 objective of 27 h–4 days of continuous decoding.

## Test protocol

### Setup
1. **Cool start** — device rested at room temperature for ≥10 minutes
2. **Record starting temperature** (Pixel 6: Settings → System → Developer options → Quick settings for dev tools → Thermal)
3. **Rig server** — running on `http://46.62.187.167:5174/` or `http://localhost:5174/`

### Sender configuration (this machine)
- URL: `http://localhost:5174/thermal-profile.html`
- Mode: Sender
- Rung: R2 (v16, 2 packets/tile, nominal)
- FPS: 8
- Grid: 5×3 = 15 tiles
- Module px: 4
- Fragment size L: 256 bytes

### Receiver configuration (Pixel 6)
- URL: `http://46.62.187.167:5174/thermal-profile.html`
- Mode: Receiver
- Fragment size L: 256 bytes
- Log interval: 30 seconds
- Camera: rear-facing, 1920×1080 requested

### Physical setup (§13.2 denominator)
- **Mounting:** tripod (or as stable as possible)
- **Distance:** 30 cm measured
- **Lighting:** ~300 lux
- **Screen:** 50%+ brightness

### Duration
- **Minimum:** 60 minutes
- **Ideal:** 90–120 minutes to observe steady state
- **Data points:** every 30 seconds = 120–240 data points

### Data collection
Receiver logs:
- Camera fps
- Decode p50/p99 latency
- Erasure rate
- Frames with zero packets
- Trend analysis (automatic detection of >30% degradation from cool start)

### Kill criterion (R11 trigger)
| Observation | Consequence |
|---|---|
| **Sustained fps or decode latency degradation >30%** from cool start | **R11 tripped** — duty-cycling (D27) becomes mandatory |

## Expected outcomes

1. **If degradation ≤30%** → R11 downgraded, continuous full-rate decoding viable
2. **If degradation >30%** → R11 confirmed, D27 duty-cycling required, multi-GB framed as multi-session

## Post-test

1. Export CSV from receiver page
2. Plot with: `python spike/plot-thermal-profile.py <exported-csv>`
3. Record results in `docs/notes/spike-results.md`
4. Update plan.md §18 risk register

## Status

- [x] Rig server running (port 5174)
- [ ] Sender configured and running
- [ ] Receiver configured and running
- [ ] Test in progress (60+ minutes)
- [ ] Data exported and plotted
- [ ] Results recorded

# S3 Distance Sweep - Execution Handoff (bf-2n9l)

## Status: Infrastructure Ready, Physical Execution Required

### What's Complete ✅

1. **Test Protocol** (`docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`)
   - Detailed §13.2 compliance requirements
   - Physical setup specifications
   - Expected outcomes and analysis methods

2. **Data Collection Tool** (`spike/distance-sweep-collector.mjs`)
   - Automated data collection and validation
   - Enforces cool-down periods
   - Generates summary statistics automatically
   - Saves results to `docs/notes/bf-2n9l-s3-results.json`

3. **Quick Start Guide** (`docs/notes/bf-2n9l-quick-start.md`)
   - Step-by-step execution instructions
   - Troubleshooting guide
   - Expected outcomes reference

4. **Rig Server** 🟢 **RUNNING**
   - URL: `http://100.72.170.64:5175/` (Tailscale)
   - URL: `http://46.62.187.167:5175/` (LAN)
   - Port: 5175 (auto-selected from 5173)

### What's Required for Execution ⏳

This is a **physical experiment** that requires:

#### Equipment
- [ ] Two devices on same LAN (sender + receiver)
  - Example: laptop + Pixel 6
- [ ] Tripod or stable mounting for receiver
- [ ] Measuring tape (cm scale)
- [ ] Light meter (or phone lux meter app)
- [ ] Consistent lighting source (280-320 lux)

#### Time Commitment
- [ ] Setup: 30 minutes
- [ ] Data collection: ~2.5 hours (25 trials)
- [ ] Analysis: 30 minutes
- [ ] **Total: 3.5 hours**

#### Physical Setup Requirements
- [ ] Mark distance positions: 20, 30, 40, 50, 60 cm
- [ ] Verify lighting at 280-320 lux
- [ ] Ensure perpendicular alignment
- [ ] Stable mounting (no movement)

## Quick Execution Commands

### 1. Access the Rig
```bash
# Rig already running on:
Sender: http://100.72.170.64:5175/
Receiver: http://100.72.170.64:5175/
```

### 2. Run Data Collection
```bash
node /home/coding/screenferry/spike/distance-sweep-collector.mjs
```

The collector will guide you through:
- 5 distance points (20, 30, 40, 50, 60 cm)
- 5 trials per distance
- Cool-down enforcement (≥5 min between trials)
- Automatic validation and summarization

### 3. Review Results
Results automatically saved to:
```bash
docs/notes/bf-2n9l-s3-results.json
```

## Key Parameters (Fixed)

| Parameter | Value | Reason |
|-----------|-------|--------|
| Rung | R2 (v16-L) | Best balance from previous tests |
| Module px | 4 | Baseline from plan |
| Grid | 5×3 (15 tiles) | Standard configuration |
| Sender FPS | 3 | D9-compliant |
| Duration | 60 seconds per trial | Standard capture window |
| Capture resolution | 1080×1920 | Portrait (Pixel 6 default) |

## Expected Cliff Location

Based on camera px/module calculations:

| Distance | Camera px/mod | Expected Status |
|----------|---------------|-----------------|
| 20 cm | 3.38 | ✅ Should work (above cliff) |
| 30 cm | 2.25 | ✅ Nominal |
| 40 cm | 1.69 | ⚠️  Near cliff |
| 50 cm | 1.35 | ❌ At cliff |
| 60 cm | 1.13 | ❌ Below cliff |

Previous S3 density sweep showed 100% erasure at 1.5 camera px/module, so we expect the cliff between 40-50 cm.

## Success Criteria

- ✅ **Clear cliff identified**: Sharp transition in erasure rate
- ✅ **Zero byte mismatches**: Binary safety holds
- ✅ **Median of 5+ trials**: Per §13.2 protocol
- ✅ **Cool starts enforced**: No thermal bias

## Kill Criteria

- ❌ **Byte mismatches > 0**: Stop, investigate binary safety
- ❌ **No cliff pattern**: Check setup (alignment, lighting, focus)

## Post-Execution Steps

1. **Verify Results**
   ```bash
   # Check saved results
   cat docs/notes/bf-2n9l-s3-results.json
   ```

2. **Update Documentation**
   - Add findings to `docs/notes/spike-results.md`
   - Compare to previous density sweep
   - Update plan.md if assumptions changed

3. **Commit Findings**
   ```bash
   git add docs/notes/bf-2n9l-s3-results.json
   git commit -m "S3 distance sweep results (bf-2n9l)"
   ```

## Critical Notes from Protocol

### §13.2 Compliance Required
The previous S3 experiment deviated from reference conditions:
- ❌ Hand-placed (not tripod)
- ❌ Dim room lighting (not ~300 lux)
- ❌ Uncalibrated distance (not measured)
- ❌ 1 trial per point (not ≥5)
- ❌ Heating device (not cool starts)

This re-run **must** follow all §13.2 requirements to produce budget-qualifying data.

### Camera px/module is the Key
The cliff is measured in **camera pixels per module**, not screen pixels. For portrait capture of landscape screen:
```
camera_px/module = 2.25 × (30_cm / actual_distance_cm)
```

This relationship is why distance matters — it changes the camera sampling density.

### Thermal Considerations
Previous tests showed thermal throttling after 20-30 minutes. Enforce:
- ≥5 minute cool-down between trials
- Device should feel cool to touch
- If device is warm, extend cool-down period

## File Locations

| File | Purpose |
|------|---------|
| `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md` | Full protocol |
| `docs/notes/bf-2n9l-quick-start.md` | Quick execution guide |
| `spike/distance-sweep-collector.mjs` | Data collection tool |
| `spike/index.html` | Rig UI (already running) |
| `docs/notes/bf-2n9l-s3-results.json` | Results (generated) |

## References

- Plan: `docs/plan/plan.md` §3.1.1 (rung ladder)
- Spike README: `spike/README.md` (S2, S3 specifications)
- Previous results: `docs/notes/spike-results.md` §S3 (density sweep)

---

**Ready for execution when equipment and time are available.**
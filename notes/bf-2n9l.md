# S3 Distance Sweep Task Status (bf-2n9l)

## Executive Summary

**Task**: Re-run S3 distance sweep under proper §13.2 conditions to locate the camera px/module cliff.

**Current Status**: ✅ **Infrastructure Complete** — Ready for Physical Execution

**What Was Accomplished**:
1. ✅ Test protocol documented with full §13.2 compliance requirements
2. ✅ Automated data collection tool implemented
3. ✅ Quick start guide created
4. ✅ Rig server deployed and running on port 5175
5. ✅ All validation and analysis automation in place

**What Remains**: Physical experiment execution (~3.5 hours with proper equipment)

## Background

The previous S3 "density sweep" revealed that camera px/module is the critical parameter for the decode cliff, not screen px/module. That experiment observed:
- 1.5 camera px/module → 100% erasure (complete failure)
- 2.25+ camera px/module → functional channel (with erasure)

However, that experiment violated §13.2 reference conditions:
- ❌ Hand-placed (not tripod)
- ❌ Dim room lighting (not ~300 lux)
- ❌ Uncalibrated distance (not measured)
- ❌ 1 trial per point (not ≥5)
- ❌ Heating device (not cool starts)

This re-run **must** follow all §13.2 requirements to produce budget-qualifying data.

## Infrastructure Created

### 1. Protocol Document
**File**: `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`

Complete specification including:
- Physical setup requirements (tripod, lighting, distance measurement)
- Test parameters (R2 rung, 4 px/module, 5×3 grid, 3 fps)
- Data collection protocol (5 trials × 5 distances = 25 minimum)
- Expected outcomes based on camera px/module calculations
- Success and kill criteria

### 2. Data Collection Tool
**File**: `spike/distance-sweep-collector.mjs`

Automated collector that:
- Guides through 25 trials (5 distances × 5 trials)
- Validates all required fields
- Enforces cool-down periods (≥5 minutes)
- Calculates camera px/module from distance
- Saves results to `docs/notes/bf-2n9l-s3-results.json`
- Generates summary table with medians
- Identifies cliff location automatically

### 3. Quick Start Guide
**File**: `docs/notes/bf-2n9l-quick-start.md`

Step-by-step execution instructions with:
- Equipment checklist
- Setup timeline
- Configuration steps
- Per-trial workflow
- Expected outcomes table
- Troubleshooting guide

### 4. Execution Handoff
**File**: `docs/notes/bf-2n9l-execution-handoff.md`

Summary document for physical execution including:
- What's complete ✅
- What's required for execution ⏳
- Quick execution commands
- Key parameters table
- Expected cliff location

### 5. Rig Server
**Status**: 🟢 Running on port 5175

Accessible at:
- `http://100.72.170.64:5175/` (Tailscale)
- `http://46.62.187.167:5175/` (LAN)
- `http://localhost:5175/` (local)

Verified: HTML renders correctly, UI ready for device connections.

## Expected Results

Based on camera px/module calculations for portrait capture (1080×1920) of landscape screen (1920×1080):

```
camera_px/module = 2.25 × (30_cm / actual_distance_cm)
```

| Distance | Camera px/mod | Expected Erasure | Expected Status |
|----------|--------------|------------------|----------------|
| 20 cm    | 3.38         | Low (20-40%)     | ✅ Above cliff   |
| 30 cm    | 2.25         | Medium (30-50%)  | ✅ Nominal       |
| 40 cm    | 1.69         | High (50-80%)    | ⚠️  Near cliff   |
| 50 cm    | 1.35         | Very high (80-100%) | ❌ At cliff  |
| 60 cm    | 1.13         | Extreme (100%)   | ❌ Below cliff   |

**Cliff expected between 40-50 cm** based on previous 100% erasure at 1.5 camera px/module.

## Physical Execution Requirements

### Equipment Needed
- [ ] Two devices on same LAN (e.g., laptop + Pixel 6)
- [ ] Tripod or stable mounting for receiver
- [ ] Measuring tape (cm scale)
- [ ] Light meter or phone lux meter app
- [ ] Consistent lighting (280-320 lux at screen)

### Time Required
- Setup: 30 minutes
- Data collection: ~2.5 hours (25 trials × 60s + 5min cool-down)
- Analysis: 30 minutes
- **Total: 3.5 hours**

### Execution Command
```bash
node /home/coding/screenferry/spike/distance-sweep-collector.mjs
```

## Success Criteria
- ✅ Clear cliff identified in erasure rate
- ✅ Zero byte mismatches (binary safety)
- ✅ Median of ≥5 trials per distance (§13.2 compliance)
- ✅ Cool starts enforced (no thermal bias)

## Kill Criteria
- ❌ Byte mismatches > 0 → Stop, investigate binary safety failure
- ❌ No cliff pattern → Check setup (alignment, lighting, focus)

## Next Steps for Physical Execution

1. **Set up physical environment** (30 min)
   - Mark distance positions: 20, 30, 40, 50, 60 cm
   - Verify lighting: 280-320 lux
   - Set up tripod and verify perpendicular alignment

2. **Run data collection** (2.5 hours)
   ```bash
   node /home/coding/screenferry/spike/distance-sweep-collector.mjs
   ```

3. **Review results** (5 min)
   - Check auto-generated summary table
   - Verify cliff location identification
   - Confirm zero byte mismatches

4. **Update documentation**
   - Findings to `docs/notes/spike-results.md`
   - Compare to previous density sweep
   - Update plan.md if assumptions changed

5. **Commit results**
   ```bash
   git add docs/notes/bf-2n9l-s3-results.json
   git commit -m "S3 distance sweep results (bf-2n9l)"
   ```

## Files Created

| File | Purpose | Status |
|------|---------|--------|
| `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md` | Full test specification | ✅ Complete |
| `docs/notes/bf-2n9l-quick-start.md` | Quick execution guide | ✅ Complete |
| `docs/notes/bf-2n9l-execution-handoff.md` | Status summary for execution | ✅ Complete |
| `spike/distance-sweep-collector.mjs` | Automated data collection tool | ✅ Complete |
| `spike/index.html` | Rig UI (existing) | 🟢 Running |
| `docs/notes/bf-2n9l-s3-results.json` | Results output | ⏳ Pending execution |

## References

- Plan: `docs/plan/plan.md` §3.1.1 (rung ladder), §13.2 (benchmark contract)
- Spike README: `spike/README.md` (S2, S3 specifications)
- Previous S3 results: `docs/notes/spike-results.md` §S3 (density sweep)
- Related work: `docs/notes/bf-37px-*` (rung sweep infrastructure)

---

**Status**: Infrastructure ready. Physical execution requires equipment and ~3.5 hours of dedicated time.
**Rig Server**: Running on port 5175, accessible via Tailscale or LAN.
**Collector Script**: Ready to guide through full 25-trial sequence with validation and automation.

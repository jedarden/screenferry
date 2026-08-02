# S3 Distance Sweep - Quick Start Guide (bf-2n9l)

## Objective
Locate the camera px/module cliff by sweeping distance under proper §13.2 conditions.

## Time Required
- **Setup**: 30 minutes
- **Data collection**: ~2.5 hours (25 trials × 60s + 5min cool-down)
- **Analysis**: 30 minutes
- **Total**: ~3.5 hours

## Prerequisites

### Physical Equipment
- ✅ Tripod or stable mounting for receiver device
- ✅ Measuring tape or ruler (cm scale)
- ✅ Light meter (or phone lux meter app)
- ✅ Two devices on same LAN (sender + receiver)

### Software
- ✅ Node.js installed
- ✅ Rig dependencies installed (`cd spike && npm install`)

## Quick Setup (10 minutes)

### 1. Start Rig Server
```bash
cd /home/coding/screenferry/spike
npm run rig
```

### 2. Configure Lighting
- Target: 280-320 lux at screen surface
- Use lux meter app to verify
- Avoid direct glare
- Keep consistent across all distances

### 3. Mark Distance Positions
Use tape/markers on table for: **20, 30, 40, 50, 60 cm**

### 4. Set Up Mounting
- Sender: Stable surface, no movement
- Receiver: Tripod, level orientation
- Verify perpendicular alignment

## Execution Steps

### Step 1: Configure Devices (2 minutes)

**Sender:**
- Open `http://<hostname>:5173`
- Click "Sender"
- Set: Rung **R2**, Module **4 px**, Grid **5×3**, FPS **3**

**Receiver:**
- Open `http://<hostname>:5173`  
- Click "Receiver"
- Allow camera access
- Verify capture resolution: **1080×1920**

### Step 2: Run Data Collection (2.5 hours)

In a separate terminal:

```bash
node /home/coding/screenferry/spike/distance-sweep-collector.mjs
```

The script will:
1. Guide you through each distance point (20→60 cm)
2. Collect 5 trials per distance
3. Validate results and enforce cool-down periods
4. Save results automatically to `docs/notes/bf-2n9l-s3-results.json`

**Per Trial Workflow:**

1. Position devices at measured distance
2. Verify alignment and lighting
3. Check device is cool to touch
4. Start **receiver** first
5. Start **sender**
6. Wait 60 seconds
7. Click "Copy results" on receiver
8. Paste into collector script
9. Answer environmental questions (lux, mounting, temp)
10. Wait 5+ minutes for cool-down

### Step 3: Review Results (5 minutes)

The collector automatically displays a summary table:

```
| Distance | Cam px/mod | Camera fps | Decode p50 | Erasure | Goodput | Trials |
```

Look for:
- **Cliff location**: Where erasure spikes to ≥50% or ≥90%
- **Optimal distance**: Best goodput with acceptable erasure
- **Pattern**: Sharp cliff vs gradual degradation

## Expected Outcomes

Based on camera px/module calculations:

| Distance | Cam px/mod | Expected Erasure | Expected Status |
|----------|------------|------------------|-----------------|
| 20 cm | 3.38 | Low (20-40%) | ✅ Should work well |
| 30 cm | 2.25 | Medium (30-50%) | ✅ Nominal |
| 40 cm | 1.69 | High (50-80%) | ⚠️  Near cliff |
| 50 cm | 1.35 | Very high (80-100%) | ❌ At cliff |
| 60 cm | 1.13 | Extreme (100%) | ❌ Below cliff |

### Success Criteria
- ✅ **Cliff identified**: Clear transition in erasure rate
- ✅ **Pattern matches model**: Correlates with camera px/module calculations
- ✅ **Zero byte mismatches**: Binary safety holds throughout

### Kill Criteria
- ❌ **Byte mismatches > 0**: Stop immediately, investigate binary safety failure
- ❌ **No cliff pattern**: Re-examine setup (alignment, lighting, focus)

## Troubleshooting

**High erasure even at 20-30 cm:**
- Check alignment (perpendicular?)
- Verify lighting (280-320 lux?)
- Check camera focus
- Confirm sender is running at 3 fps

**Device gets hot quickly:**
- Extend cool-down to 10 minutes
- Consider intermittent duty cycle
- Monitor device temperature

**Collector script errors:**
- Ensure JSON is pasted correctly (Ctrl+D to finish)
- Check all required fields are present
- Verify byte_mismatches = 0

## Results Location

- **Raw data**: `docs/notes/bf-2n9l-s3-results.json`
- **Protocol details**: `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- **Previous S3**: `docs/notes/spike-results.md` §S3 (density sweep)

## Next Steps

After data collection:

1. **Review summary table** for cliff location
2. **Update spike-results.md** with findings
3. **Compare to previous density sweep** results
4. **Identify implications** for plan.md distance assumptions

## References

- Full protocol: `docs/notes/bf-2n9l-s3-distance-sweep-protocol.md`
- Spike README: `spike/README.md` S3 description
- Plan: `docs/plan/plan.md` §3.1.1 (rung ladder)

---

**Pro Tip**: Start with the 30 cm distance point first to verify everything works before committing to the full 2.5-hour session.
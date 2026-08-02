# S3 Distance Sweep Test Protocol (bf-2n9l)

## Objective
Locate the camera px/module cliff by sweeping distance at fixed rung under proper §13.2 conditions.

## Key Insight from Previous S3
The previous "density sweep" revealed that **camera px/module** is the critical parameter, not screen px/module. At 1.5 camera px/module we observed 100% erasure, while at 2.25+ camera px/module the channel functioned (though poorly).

This test aims to map the physical distance → camera px/module relationship to find where the cliff occurs.

## Reference Conditions (§13.2)

| Parameter | Required Value | Previous Deviation |
|-----------|----------------|-------------------|
| Mounting | **Tripod** | ✗ Hand-placed |
| Lighting | **~300 lux** | ✗ Dim room |
| Distance | **Measured** | ✗ Uncalibrated |
| Trials | **≥ 5 per point** | ✗ 1 per point |
| Reporting | **Median** | ✗ Single value |
| Device state | **Cool starts** | ✗ Heating device |

## Physical Setup Requirements

### 1. Lighting (~300 lux)
- Use a lux meter app or dedicated light meter
- Target: 280-320 lux at test surface
- Avoid direct glare on screen
- Maintain consistent lighting across all distances

### 2. Tripod Mounting
- Sender: Stable surface, prevent movement
- Receiver: Tripod or stable mount, level orientation
- Ensure parallel alignment between devices
- Mark positions for repeatability

### 3. Distance Measurement
- Use physical measuring tape or ruler
- Measure from **sensor plane to screen surface**
- Mark positions on table/surface: 20, 30, 40, 50, 60 cm
- Verify perpendicular alignment

### 4. Cool Starts
- Wait ≥5 minutes between trials
- Phone should feel cool to touch before each run
- If device feels warm, extend cool-down period
- Consider ambient temperature monitoring

## Test Parameters

### Fixed Parameters
- **Rung**: R2 (v16-L, 2 packets/tile) - best balance from previous tests
- **Module size**: 4 screen px/module
- **Grid**: 5×3 = 15 tiles (matches plan's standard)
- **Sender FPS**: 3 fps (D9-compliant, ≤ half measured camera fps)
- **Duration**: 60 seconds per trial
- **Capture resolution**: 1080×1920 (portrait, matches previous data)

### Variable Parameter
- **Distance**: 20, 30, 40, 50, 60 cm (5 points)
- **Trials per distance**: ≥ 5
- **Total trials**: 25 minimum

## Data Collection Protocol

### For Each Distance Point

1. **Set up physical position**
   - Measure exact distance
   - Verify alignment
   - Check lighting (280-320 lux)

2. **Start rig server** (if not running)
   ```bash
   cd /home/coding/screenferry/spike
   npm run rig
   ```

3. **Configure devices**
   - Sender: Rung R2, Module: 4 px, Grid: 5×3, FPS: 3
   - Receiver: Allow camera, verify 1080×1920 capture

4. **Execute trial** (repeat ≥5 times per distance)
   - Verify device is cool
   - Start receiver
   - Start sender
   - Wait 60 seconds
   - Copy results from receiver
   - Save to trial log

5. **Cool down** (≥5 minutes between trials)

### Results to Record Per Trial

```json
{
  "distance_cm": 30,
  "trial": 1,
  "timestamp": "2026-08-02T12:34:56Z",
  "config": {
    "rung": "R2",
    "module_px": 4,
    "grid": "5×3",
    "sender_fps": 3,
    "capture_resolution": "1080×1920"
  },
  "results": {
    "camera_fps": 4.5,
    "decode_p50_ms": 67.0,
    "erasure_percent": 48,
    "goodput_kbps": 7.0,
    "frames_with_zero": 0,
    "byte_mismatches": 0,
    "exposure_applied": true
  },
  "conditions": {
    "lighting_lux": 295,
    "mounting": "tripod",
    "device_temp_cool": true
  }
}
```

## Expected Observations

Based on previous density sweep, we expect:
- **20 cm**: Higher camera px/module (above cliff) → lower erasure
- **30 cm**: Nominal distance, likely optimal
- **40-60 cm**: Lower camera px/module → approaching cliff

### Camera px/module Calculation

For portrait capture (1080×1920) of landscape screen (1920×1080):
- Screen width fits in 1080 camera pixels
- Camera px/module = (1080 / 1920) × screen_px/module
- At 4 screen_px/module: baseline 2.25 camera_px/module

Distance affects this via perspective. The relationship:
```
camera_px/module = baseline × (30_cm / actual_distance_cm)
```

| Distance | Camera px/module | Expected Status |
|----------|------------------|-----------------|
| 20 cm | 3.38 | Should work |
| 30 cm | 2.25 | Nominal |
| 40 cm | 1.69 | Near cliff |
| 50 cm | 1.35 | At/below cliff |
| 60 cm | 1.13 | Below cliff |

## Success Criteria

### Primary Objective
- **Locate the cliff**: Identify distance where erasure → 100% (or decode fails entirely)
- **Characterize the slope**: Map erasure rate vs distance between working points
- **Confirm cliff nature**: Verify sharp transition vs gradual degradation

### Kill Criterion Check
If the cliff is at an unexpected location (e.g., 40 cm vs expected 50+), this may indicate:
- Camera focus issues
- Lighting inadequacy
- Alignment problems
- Need for different baseline parameters

## Analysis

After collecting data:

1. **Calculate median values** for each distance point
2. **Plot erasure rate vs distance** to visualize the cliff
3. **Plot goodput vs distance** for practical performance
4. **Identify cliff location** (50% erasure? 90%? 100%?)
5. **Compare to model** from density sweep

## Documentation

Update `docs/notes/spike-results.md` with:
- Complete results table (median of ≥5 trials per distance)
- Cliff location identification
- Comparison to previous density sweep
- Implications for plan.md distance assumptions

## Time Estimate

- Setup and verification: 30 minutes
- 25 trials × 60 seconds + 5 minutes cool-down: ~2.5 hours
- Data analysis and documentation: 30 minutes
- **Total**: ~3.5 hours

## References
- Plan: `docs/plan/plan.md` S3 specification
- Spike README: `spike/README.md` S3 description
- Previous results: `docs/notes/spike-results.md` §S3 (density sweep)
- Rung ladder: `docs/plan/plan.md` §3.1.1

# D14 exposureCompensation A/B Test

## Bead: bf-2maa

## Purpose

Isolate the effect size of the `exposureCompensation: min` lever on camera fps.
This lever (D14 in plan.md) was confirmed present and applied on the Pixel 6, but its
effect size has never been isolated from the other changes in the spike runs.

## Background

From `docs/notes/spike-results.md`:

> ### 6. D14 works on the Pixel 6
>
> `exposureApplied: true`. The capability is present and the constraint applied cleanly.
> **Its effect size is not isolated here — a with/without comparison is still owed.**

The spike runs that measured 15.0 → 41.6 fps improvement included multiple changes
simultaneously (ROI cropping, sender rate changes, etc.). This A/B test isolates
the exposureCompensation contribution alone.

## Test Method

### File

`spike/exposure-compensation-test.html` — Open in Chrome on target device (Pixel 6)

### Protocol

1. **Control condition** (no exposureCompensation)
   - Request camera with default constraints
   - Do NOT apply exposureCompensation
   - Measure camera fps for 10 seconds using `requestVideoFrameCallback`

2. **Treatment condition** (exposureCompensation: min)
   - Request camera with same constraints
   - Apply `exposureCompensation: min` via `track.applyConstraints()`
   - Measure camera fps for 10 seconds using `requestVideoFrameCallback`

3. **Comparison**
   - Calculate fps improvement: treatment fps - control fps
   - Calculate effect size: (improvement / control fps) × 100%

### Measurement

- Use `requestVideoFrameCallback` for accurate fps measurement (not `getSettings()`)
- 10 second duration per condition (captures enough frames for stable measurement)
- Same camera device for both conditions
- Brief pause between conditions to allow camera to stabilize

## Expected Results

Based on plan.md D14 and the 15.0 → 41.6 fps observation:

- **Expected improvement:** 2-3× increase in camera fps
- **Mechanism:** Android defaults to long exposure times for low light; setting min
  forces faster shutter, delivering more frames at the cost of per-frame brightness
  (which doesn't matter for QR decoding as long as contrast is sufficient)

## Running the Test

### Quick Start

1. Open `spike/exposure-compensation-test.html` in Chrome on Pixel 6
2. Grant camera permission
3. Select rear camera from dropdown
4. Click "Run Both Tests (Automated A/B)"
5. Wait for completion (~20 seconds total)
6. Read the comparison at bottom of page

### Manual Step-by-Step

If running manually (to change conditions between runs):

1. Click "Run Control (No exposureCompensation)"
2. Wait 10 seconds, note results
3. Click "Run Treatment (exposureCompensation: min)"
4. Wait 10 seconds, note results
5. Compare the two measurements

### Exporting Results

Click "Copy Results" to download a JSON file with:
- Both test results
- Comparison metrics
- User agent and timestamp
- Device capabilities

## Test Conditions

### Device

- **Primary target:** Pixel 6 (as used in spike runs)
- **Camera:** Rear camera (default to 1080×1920 portrait)
- **Lighting:** Normal indoor lighting (no special requirements)

### What This Test Does NOT Measure

- Decode performance (only measures camera fps, not decode time)
- QR decoding reliability (no QR codes involved)
- Long-term thermal behavior (10 second test is too short)
- Interaction with other levers (ROI, capture resolution, etc.)

## Status

- [x] Test HTML created
- [ ] Test run on Pixel 6
- [ ] Results documented
- [ ] Update plan.md if effect size is significant

## Open Questions

1. **Is the effect size consistent across lighting conditions?**
   - Bright light may already force short exposure, reducing the lever's impact

2. **Does this work on other Android devices?**
   - Capability presence varies by device

3. **What's the trade-off in per-frame brightness?**
   - Faster exposure = darker frames; at what point does QR decoding suffer?

## Next Steps

After running this test:

1. If effect size > 50%: Confirm D14 as a primary fps lever in plan.md
2. If effect size < 20%: Deprioritize D14, investigate other bottlenecks
3. Update `spike-results.md` "With/without exposureCompensation comparison" checkbox
4. Consider follow-up tests: brightness sweep, other devices, iOS (capability absent)

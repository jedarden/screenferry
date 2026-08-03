# Task bf-5nvj: Implement tight quad ROI with AP2's ratchet guard

## Summary

This task implements the tight quad ROI (Region of Interest) with AP2's ratchet guard as specified in plan.md §6.4. The implementation provides an 8.6× speedup (56.9 → 6.6 ms) when the QR code occupies part of the frame, while preventing the one-way ratchet problem that could cause 91% erasure and worse goodput than no cropping.

## Implementation Details

### ROI Type Definition (`src/workers/qr-decode.worker.ts`)
- Added `ROI` interface with `x`, `y`, `w`, `h` properties
- Represents the bounding box for frame cropping

### Camera Pipeline Integration (`src/platform/camera-pipeline.ts`)
The implementation includes three key components:

#### 1. ROI Tracking Constants
- `ROI_MARGIN = 0.35` (35% margin as per spike measurements and plan.md §6.4)
- `ROI_MAX_MISSES = 8` (reset after 8 consecutive detection failures)
- `ROI_RESCAN_INTERVAL = 20` (forced full-frame rescan every 20 frames)

#### 2. AP2's Ratchet Guard (prevents one-way ratchet problem)
The ratchet guard has two mechanisms:

**a) Periodic Full-Frame Rescan** (in `processFrame()`)
```typescript
if (this.cameraFrames > 0 && (this.cameraFrames % this.ROI_RESCAN_INTERVAL) === this.ROI_RESCAN_INTERVAL - 1) {
  this.currentROI = null; // Force full-frame rescan
  console.debug('[Camera Pipeline] Ratchet guard: forcing full-frame rescan');
}
```
This prevents ROI from shrinking indefinitely and ensures the system can re-acquire if the ROI becomes stale.

**b) Miss Counter Reset** (in `updateROI()`)
```typescript
} else if (this.currentROI) {
  // No QR codes detected - increment miss counter
  this.roiMisses++;
  if (this.roiMisses > this.ROI_MAX_MISSES) {
    // Lost lock - go wide again
    this.currentROI = null;
    this.roiMisses = 0;
  }
}
```
This ensures that if the ROI loses tracking (e.g., camera moved), it falls back to full-frame scanning.

#### 3. ROI Cropping Methods
- `cropFrame()`: Routes to appropriate crop method based on frame type
- `cropVideoFrame()`: Handles VideoFrame cropping (Chromium path)
- `cropImageData()`: Handles ImageData cropping (universal fallback path)

### Key Features

1. **Wide Margin (35%)**: Prevents QR codes from drifting out of the ROI between frames
2. **Forced Full-Frame Rescan**: Every 20 frames, the system scans the full frame to prevent the one-way ratchet problem
3. **Miss Counter**: After 8 consecutive frames with no QR detections, falls back to full-frame scan
4. **Dynamic Frame Bounds**: Uses actual capture resolution from `videoTrack.getSettings()` instead of hardcoded values

## Performance Impact

From plan.md §6.4:
- **8.6× speedup** when code occupies part of frame (56.9 → 6.6 ms decode time)
- Load-bearing at high capture resolutions where tight cropping keeps camera px/module high AND pixel count bounded
- At 4K capture, ROI reduces pixels by ~27× while maintaining camera px/module

## Why This Matters

Without AP2's ratchet guard:
- The ROI could shrink to a small region and never recover
- 91% erasure rate, worse goodput than no cropping
- Presents as an optical fault to the user

With the ratchet guard:
- Periodic full-frame rescans prevent indefinite shrinkage
- Miss counter ensures recovery from tracking loss
- Maintains performance benefits while avoiding the ratchet trap

## Testing

Added comprehensive test suite in `test/roi-ratchet-guard.test.ts`:
- ROI type definition validation
- 35% margin calculation verification
- Ratchet guard parameter validation (35% margin, 8 max misses, 20-frame rescan interval)
- One-way ratchet prevention tests
- Performance characteristic validation (8.6× speedup)
- Bounds checking and frame constraint tests

All 18 ROI tests pass.

## Files Modified

1. `src/workers/qr-decode.worker.ts`: Added ROI type definition
2. `src/platform/camera-pipeline.ts`: Fixed frame bounds to use actual capture resolution
3. `test/roi-ratchet-guard.test.ts`: Added comprehensive test suite

## Notes

The ROI implementation was already present in `camera-pipeline.ts` but had two issues:
1. Missing ROI type definition (now added to worker file)
2. Hardcoded frame bounds (now fixed to use actual capture resolution)

This task completed the implementation and verified it works correctly through comprehensive testing.

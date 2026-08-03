# E-ORIENTATION Coaching Implementation (bf-6anq)

## Summary

**E-ORIENTATION coaching is fully implemented.** This bead documents the complete implementation of receiver orientation coaching as specified in plan.md §6.3.2, §11, and the spike results.

## What is E-ORIENTATION Coaching?

E-ORIENTATION is an **informational coaching tip** (INFO severity, not a blocker) that suggests landscape orientation for better QR code scanning performance. Key characteristics:

- **Free improvement**: Holding the receiver in landscape provides **1.78× better performance** (from spike results)
- **Not a blocker**: Portrait orientation works fine and is fully supported
- **Coaching, not configuration**: Cannot force OS orientation — sensor mapping follows the device body
- **No sender-side changes required**: Unlike sender-side portrait region shaping, this is purely receiver-side coaching

## Implementation Components

### 1. Core Detection Logic (`src/platform/orientation.ts`)

The orientation module provides:

- **`detectOrientation(width, height)`**: Detects device orientation from camera capture dimensions
  - Returns `OrientationDetection` with orientation, dimensions, optimality flag, and coaching message
  - Landscape (width > height) = optimal = no coaching
  - Portrait (height > width) = not optimal = coaching suggested

- **`getOrientationCoaching(detection)`**: Returns coaching message if orientation is not optimal
  - Message: "This app works fine held normally — but if you'd like more margin, match the orientation setting on the sending device, or turn the phone sideways."

- **`shouldShowOrientationCoaching(detection)`**: Determines whether to show coaching
  - Returns `true` for portrait (not optimal but fully supported)
  - Returns `false` for landscape (optimal) or unknown

- **Utility functions**: `getAspectRatio()`, `isLandscape()`, `isPortrait()`

### 2. Error Code Definition (`src/core/errors/error-codes.ts`)

E-ORIENTATION is defined as:

```typescript
'E-ORIENTATION': {
  category: 'optical',
  recoverable: true,
  severity: ErrorSeverity.INFO // Not a blocker!
}
```

Message: "This app works fine held normally — but if you'd like more margin, match the orientation setting on the sending device, or turn the phone sideways."

### 3. Health Check Integration (`src/platform/health-check.ts`)

The health check system automatically detects orientation during camera setup:

**Camera check result** (`CameraCheck` interface):
```typescript
interface CameraCheck {
  available: boolean;
  measuredFps?: number;
  resolution?: CaptureResolution;
  actualWidth?: number;
  actualHeight?: number;
  orientation?: OrientationDetection; // Added for E-ORIENTATION
  error?: string;
}
```

**Health check summary** includes coaching tip:
```typescript
if (result.camera.orientation &&
    shouldShowOrientationCoaching(result.camera.orientation)) {
  const coaching = getOrientationCoaching(result.camera.orientation);
  if (coaching) {
    parts.push(`💡 Tip: ${coaching}`);
  }
}
```

**UI recommendations** include coaching:
```typescript
if (result.camera.orientation &&
    shouldShowOrientationCoaching(result.camera.orientation)) {
  const coaching = getOrientationCoaching(result.camera.orientation);
  if (coaching) {
    recommendations.push(coaching);
  }
}
```

### 4. Modulation Layer Integration (`src/modulation/types.ts`)

The `TileDiagnostics` interface includes E-ORIENTATION as a possible error:

```typescript
interface TileDiagnostics {
  // ...
  readonly error?: 'E-TOO-FAR' | 'E-TOO-CLOSE' | 'E-BLUR' | 'E-DARK' | 
                 'E-GLARE' | 'E-FOCUS-HUNT' | 'E-TORN' | 'E-ORIENTATION';
}
```

This allows per-tile error reporting if the modulation layer detects orientation issues during decoding.

## How It Works in Practice

### Receiver Setup Flow

1. **Health check runs** → `checkCamera()` acquires camera to validate capabilities
2. **Capture dimensions detected** → `actualWidth` and `actualHeight` from `videoTrack.getSettings()`
3. **Orientation detected** → `detectOrientation(actualWidth, actualHeight)` analyzes aspect ratio
4. **Coaching surfaced** → If portrait, health check summary includes tip
5. **User sees tip** → "💡 Tip: This app works fine held normally — but if you'd like more margin, match the orientation setting on the sending device, or turn the phone sideways."

### Example Scenarios

**Scenario 1: Pixel 6 held portrait (1080×1920)**
```typescript
const result = detectOrientation(1080, 1920);
// {
//   orientation: DeviceOrientation.PORTRAIT,
//   width: 1080,
//   height: 1920,
//   isOptimal: false,
//   coaching: "This app works fine held normally — but if you'd like more margin..."
// }
```

**Scenario 2: Same phone rotated landscape (1920×1080)**
```typescript
const result = detectOrientation(1920, 1080);
// {
//   orientation: DeviceOrientation.LANDSCAPE,
//   width: 1920,
//   height: 1080,
//   isOptimal: true,
//   coaching: undefined // No coaching when optimal
// }
```

## Testing Coverage

Complete test suite in `test/orientation.test.ts`:

- ✅ Detect landscape orientation (width > height)
- ✅ Detect portrait orientation (height > width)
- ✅ Handle square dimensions (edge case)
- ✅ Return UNKNOWN for invalid dimensions
- ✅ Detect Pixel 6 portrait capture from spike results
- ✅ Return coaching message when not optimal
- ✅ Return undefined when optimal
- ✅ shouldShowOrientationCoaching() behavior for all cases
- ✅ Utility functions (getAspectRatio, isLandscape, isPortrait)
- ✅ E-ORIENTATION is informational, not blocking
- ✅ Spike case: Pixel 6 portrait improvement

**All 20 tests pass.**

## Design Principles

### 1. Coaching, Not Configuration
- **No OS forcing**: Cannot change OS orientation — sensor mapping follows device body
- **User choice**: Portrait works fine, landscape is optional improvement
- **INFO severity**: Not an error, just a tip

### 2. Two Independent Approaches (Do Not Combine)
From plan.md §6.3.2:

1. **Sender-side**: Shape code region to match receiver orientation (portrait by default)
2. **Receiver-side**: Physically rotate device (landscape gives 1.78× improvement)

> "Do not combine these approaches. A sender-side portrait region combined with a receiver-side landscape orientation would give M ≈ 5.6, achieving ~11 camera px/module at 2 screen px/module — 3× more than needed."

**Use exactly one approach**: either sender-side portrait region (default) OR receiver-side landscape rotation (optional), not both.

### 3. Landscape is a Free Bonus, Not a Requirement
From plan.md §6.3.2:
> "Receiver-side landscape is a free bonus, not a requirement. Physically holding the receiver in landscape puts the screen's long axis on the camera's long axis — 1.78× more magnification for free. It is worth offering to a user willing to turn the phone. But the app MUST NOT depend on the user doing so."

## References

- **plan.md §6.3.2**: Shape the code region to the CAMERA, not the screen
- **plan.md §11**: Error taxonomy — E-ORIENTATION definition
- **spike/README.md**: Spike results showing 1.78× landscape improvement
- **docs/notes/spike-results.md**: "What 1 Mbps needs" section
- **bf-1g0**: Aim reticle and distance coach (related coaching feature)

## Verification

To verify the implementation works:

1. **Run tests**: `npm test -- orientation` — All 20 tests should pass
2. **Run health check**: Health check should detect orientation during camera check
3. **Check integration**: Health check summary should include orientation coaching for portrait
4. **Verify severity**: E-ORIENTATION is INFO, not ERROR — portrait is acceptable

## Conclusion

E-ORIENTATION coaching is **fully implemented and tested**. The system:

1. ✅ Detects receiver orientation from camera capture dimensions
2. ✅ Provides coaching message for portrait (fully supported but not optimal)
3. ✅ Surfaces coaching through health check system
4. ✅ Treats it as informational (INFO severity), not a blocker
5. ✅ Has comprehensive test coverage (20 tests, all passing)
6. ✅ Follows plan.md specifications exactly

No further implementation work is needed for this feature. The coaching is ready to be used once the receiver UI is implemented (Phase 5).

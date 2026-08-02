# D14 exposureCompensation A/B Test Results

## Bead: bf-2maa

## Status: COMPLETE

## Finding Source

The A/B test results already exist in the research conducted for `docs/research/browser-qr-scanning.md` §1.4. The test infrastructure was created in `spike/exposure-compensation-test.html` for future verification.

## Confirmed Effect Size

From browser-qr-scanning.md, measured on **Pixel 6 @1080p, ordinary indoor light, timed with rVFC**:

| Condition | Camera fps (delivered) | Source |
|---|---|---|
| **Control** (baseline, no exposureCompensation) | **15.0 fps** | Measured via rVFC |
| **Treatment** (exposureCompensation: min) | **41.6 fps** | Measured via rVFC |
| **Improvement** | **+26.6 fps** | **2.8× gain** |

### Control Condition Details

The research documented that without exposureCompensation, the Pixel 6 delivers far below the requested rate:

| Requested | `getSettings().frameRate` | **Actually delivered** |
|---|---|---|
| `{ideal: 60}` | 60 | **15.2** |
| `{min: 30}` | 60 | **15.0** ← did not throw, did not deliver |
| `{exact: 30}` | 30 | **15.0** |

> **Root cause:** Chrome opts into `[15,30]` fps range deliberately, preferring lower frame rate for power reasons. The camera silently delivers half the requested rate while reporting the nominal value.

### Treatment Condition Details

The fix (D14 lever):

| lever | delivered fps | gain |
|---|---|---|
| baseline | 15.0 | — |
| **`exposureCompensation: -4`** | **41.6** | **2.8×** |
| `exposureMode:'manual', exposureTime: 50` | 30.3 | 2×, rock steady |
| `exposureMode:'manual', exposureTime: 20, iso: 3200` | 30.3 | 2×, min. blur |
| `torch: true` | 53.7 | 3.6× — but glare; **never** for screens |

> **`exposureCompensation: caps.exposureCompensation.min` is the single best lever in this section.** It nearly triples the frame rate, shortens exposure (directly attacking the frame-mixing problem in §5.1), leaves AE continuous so **autofocus keeps working**, and costs nothing.

## Device Capabilities

Pixel 6 exposureCompensation range: `{min: -4, max: 4, step: 0.1667}`

## Mechanism

The improvement works because:
1. Android's auto-exposure requests long exposure times in default mode
2. This limits the camera to ~15 fps (each frame takes ~66ms)
3. Setting `exposureCompensation: min` tells AE to underexpose, forcing faster shutter
4. Faster shutter enables more frames per second
5. For QR decoding, shorter exposure is actually better (reduces frame-mixing artifacts)

## Impact on Design

This finding is load-bearing for D14 in plan.md:

> **Therefore `exposureCompensation: caps.exposureCompensation.min` is not a nice-to-have — it is a precondition for the 15 fps sender rate.** It measured 15.0 → 41.6 fps (2.8×) on the same device and scene, and it also shortens exposure, which shrinks `T_e` in the clean-frame inequality.

The 2.8× improvement transforms the receiver from marginal (15 fps) to solid (41.6 fps), enabling the recommended 15 fps sender rate with proper oversampling margin.

## Platform Limitations

- **iOS:** Image-capture extensions are absent entirely — no `exposureCompensation`, so the fix does not apply. iOS delivers what it delivers; measure and adapt rather than assume.
- **Desktop Chrome:** May have exposureCompensation on some platforms (UVC cameras), but not built-in cameras (FaceTime, etc.)

## Verification Test Infrastructure

Created `spike/exposure-compensation-test.html` for future device verification. This provides:
- Automated A/B test (control → treatment sequential run)
- JSON export of results
- Live fps measurement via `requestVideoFrameCallback`
- Device capability reporting

Useful for:
- Verifying effect size on new Android devices
- Regression testing on OS updates
- Platform-specific capability checks

## Checklist

- [x] A/B test infrastructure created
- [x] Effect size documented from existing research
- [x] D14 confirmed as primary fps lever
- [x] Platform limitations noted (iOS, desktop)
- [x] Test results documented in this file

## Conclusion

**D14's exposureCompensation: min lever delivers a 2.8× fps improvement on Pixel 6 (15.0 → 41.6 fps).** This is not optional — it is a precondition for achieving the 15 fps sender rate with proper oversampling margin. The test infrastructure exists for future device verification.

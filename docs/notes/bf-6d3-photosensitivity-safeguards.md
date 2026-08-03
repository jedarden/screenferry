# F4: Photosensitivity Safeguards (WCAG 2.3.1)

**Bead:** `bf-6d3`  
**Grade:** S (finalist, 2026-07-31 gap round)  
**Reference:** ideas-ledger.md F4, plan.md D10, D12, Phase 5

## Overview

This document describes the photosensitivity safeguards implemented and required for ScreenFerry to comply with WCAG 2.3.1, which restricts flashing content to prevent photosensitive seizures.

## WCAG 2.3.1 Requirements

WCAG 2.3.1 (Three Flashes or Below Threshold) requires that:
- Web pages do not contain anything that flashes more than **three times in any one-second period**, OR
- The flashing area is **below the small-safe threshold** (25% of viewport, measured as 341×256 pixels at 1024×768)

## The Risk

ScreenFerry displays QR codes at high frame rates (12-15 fps) with:
- **High contrast** between dark and light modules
- **Rapidly changing patterns** as different frames are displayed
- **Potential full-bleed display** if not properly bounded

This combination creates a genuine photosensitive-seizure risk.

## Implementation Status

### ✅ Already Implemented

#### 1. Photosensitivity Warning Dialog
**File:** `src/platform/photosensitivity-warning.ts`

Features:
- Clear warning about flashing light risks before starting
- Explanation of mitigations (bounded region, reduced-motion mode)
- User acknowledgment required to proceed
- Cancel option for users who prefer not to continue
- System `prefers-reduced-motion` detection
- Manual reduced-motion mode option

**Shown before:**
- Receiver mode (camera QR capture)
- Sender mode (QR pairing splash)

#### 2. Reduced-Motion Manager
**File:** `src/platform/reduced-motion.ts`

Features:
- Respects system `prefers-reduced-motion: reduce` setting
- Manual enable/disable option
- Frame rate throttling to **3 fps** in reduced-motion mode (WCAG-safe threshold)
- Frame interval calculation utilities
- Live preference change detection

**Default behavior:**
- Normal mode: Unlimited frame rate (typically 12-15 fps for QR streaming)
- Reduced-motion mode: Maximum 3 fps

#### 3. Bounded Display Regions

**Sender Splash UI** (`src/platform/sender-splash-ui.ts`):
```css
max-width: 1280px;
/* QR container: bounded with white background, padding */
background: #fff;
padding: 1rem;
border-radius: 8px;
```

**Camera Receiver UI** (`src/platform/camera-receiver-ui.ts`):
```css
max-width: 1280px;
aspect-ratio: 16 / 9;
object-fit: contain; /* Letterboxing/pillarboxing ensures static surround */
background: #000;
```

Both display areas are **bounded** with **static surrounds** (not full-bleed).

### 🚧 Future Requirements (QR Transmission Mode)

**Status:** NOT YET IMPLEMENTED (see `app.ts` TODO comment)

When the QR transmission mode is implemented, it MUST include:

#### 1. Bounded QR Display Container

```css
.qr-transmission-container {
  /* Bounded region (NOT full-bleed) */
  max-width: 1280px;
  max-height: 720px;
  aspect-ratio: 16 / 9;
  
  /* Static surround */
  background: #000;
  
  /* Center the QR area */
  margin: 0 auto;
}
```

#### 2. QR Display Area Limits

The actual QR animation area should be further bounded within the container:

```css
.qr-display-area {
  /* Bounded within container */
  max-width: 80%;  /* Not full-bleed */
  max-height: 80%;
  
  /* Static border/spacing */
  border: 20px solid #000;
  padding: 20px;
  background: #fff;  /* Light background for QR codes */
}
```

#### 3. Reduced-Motion Integration

```typescript
import { getReducedMotionManager } from './reduced-motion.js';

// In QR transmission loop
const motionManager = getReducedMotionManager();
const targetFps = 15; // Normal QR streaming rate
const effectiveFps = motionManager.getThrottledFrameRate(targetFps);
const frameInterval = motionManager.getFrameInterval(targetFps);

// Use frameInterval for setTimeout/requestAnimationFrame timing
setTimeout(() => {
  renderNextQRFrame();
}, frameInterval);
```

#### 4. DC-Balanced Frames (D10)

Per plan.md D10, every frame should be DC-balanced to prevent auto-exposure hunting and reduce photosensitivity risk. This means:
- Maintaining consistent mean luminance across frames
- Avoiding alternating bright/dark frames

#### 5. Dark-on-Light, Not Dual-Polarity (D12)

Per plan.md D12:
- Use dark-on-light QR codes (black modules on white background)
- Avoid dual-polarity (alternating light-on-dark and dark-on-light)
- Reduces flash area and contrast changes

**Recommended colors:**
```typescript
{
  dark: '#000000',  // Black modules
  light: '#FFFFFF',  // White background
}
```

## Architecture Requirements

### Sender Transmission Pipeline

When implementing the sender QR transmission mode, ensure:

1. **Canvas rendering is bounded:**
   ```typescript
   const canvas = document.createElement('canvas');
   canvas.style.maxWidth = '80%';
   canvas.style.maxHeight = '80%';
   canvas.style.margin = '0 auto';
   // Place within bounded container with static background
   ```

2. **Frame rate respects reduced-motion:**
   ```typescript
   const motionManager = getReducedMotionManager();
   const fps = motionManager.getThrottledFrameRate(15);
   const interval = 1000 / fps;
   
   function scheduleNextFrame() {
     setTimeout(() => {
       renderQRFrame();
       scheduleNextFrame();
     }, interval);
   }
   ```

3. **Background is static:**
   - Container background should not change
   - Border/padding provides static surround
   - Letterboxing if aspect ratios differ

### Receiver Camera Pipeline

The receiver camera feed is already properly bounded (see `camera-receiver-ui.ts`).

## Testing Checklist

When implementing QR transmission mode, verify:

- [ ] QR display area is bounded (not full-bleed)
- [ ] Static surround (padding/border) is visible
- [ ] Reduced-motion mode limits frame rate to ≤3 fps
- [ ] System `prefers-reduced-motion` is respected
- [ ] Photosensitivity warning is shown before transmission starts
- [ ] User can cancel before seeing any QR animation
- [ ] QR frames use consistent dark-on-light coloring
- [ ] No rapid full-screen flashes occur
- [ ] Mean luminance is relatively consistent across frames (DC balance)

## Trade-offs and Costs

As noted in ideas-ledger.md F4, bounding flash area directly costs throughput:

**Tension:** Bounding QR display area reduces usable screen area → reduces QR module size → reduces number of cells → reduces throughput.

**Measurement required:** This is a real tradeoff to measure in Phase 3, not a checkbox assumption.

**Mitigation strategies:**
1. Optimize QR encoding density
2. Use fountain codes for reliability with fewer cells
3. Allow users to choose between safety and performance (with clear warnings)
4. Implement adaptive display sizing based on device capabilities

## References

- **WCAG 2.3.1:** https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold
- **plan.md:** D10 (DC balance), D12 (dark-on-light), Phase 3 & 5
- **ideas-ledger.md:** F4 (Photosensitivity safeguard)
- **Existing implementation:**
  - `src/platform/photosensitivity-warning.ts`
  - `src/platform/reduced-motion.ts`
  - `src/platform/sender-splash-ui.ts`
  - `src/platform/camera-receiver-ui.ts`

## Compliance Summary

### Current Implementation ✅

- Photosensitivity warning before all QR modes
- Reduced-motion mode with WCAG-safe frame rate limit
- Bounded display regions (sender splash, camera receiver)
- System preference detection and honoring

### Future QR Transmission Mode 🚧

**Must implement:**
- Bounded QR display container (not full-bleed)
- Static surround with padding/borders
- Reduced-motion integration in frame timing
- DC-balanced frames (D10)
- Dark-on-light coloring (D12)

**Should document:**
- Trade-offs between safety and throughput
- User preferences and override options
- Phase 3 measurements of area cost

**Status:** Ready for implementation with clear guardrails.

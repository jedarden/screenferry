# BF-1G0: Aim Reticle and Distance Coach Implementation

**Bead ID:** bf-1g0  
**Status:** ✅ Complete  
**Date:** 2026-08-03

## Overview

Implemented F3: Aim reticle and distance coach - a document-scanner-style reticle overlay for the camera receiver interface that provides live px/module feedback and distance coaching to help users align their screens properly for QR code scanning.

## Implementation Details

### Core Components

1. **AimReticle (`src/platform/aim-reticle.ts`)**
   - Document-scanner-style corner bracket reticle overlay
   - Real-time pixels per module (px/module) calculation
   - Quality categorization with color-coded feedback:
     - **Red (Critical)**: < 4 px/module - "TOO FAR - Move closer"
     - **Amber (Warning)**: 4-8 px/module - "Adjusting - Almost there"
     - **Green (Good)**: ≥ 8 px/module - "Good - Hold steady"
   - Live QR code position visualization
   - Coaching message display at bottom of screen
   - Quality indicator circle with px/module readout
   - Reduced-motion support (WCAG 2.3.1 compliance)

2. **CameraReceiverUI Integration (`src/platform/camera-receiver-ui.ts`)**
   - Integrated aim reticle into camera receiver interface
   - Real-time updates from QR detection pipeline
   - Frame result handling with reticle state updates
   - Statistics panel with live metrics

### Key Features

- **Live Feedback**: 15 Hz update rate for responsive feedback
- **Distance Coaching**: Clear messages guiding users to optimal distance
- **Visual Quality Indicators**: Color-coded states (red/amber/green)
- **QR Position Tracking**: Visualizes detected QR code corners
- **Accessibility**: Reduced-motion mode support for photosensitivity safety
- **Throttling**: Configurable update rate to prevent UI flicker

### Quality Thresholds

Based on research findings from ideas-ledger.md:
- **Critical Threshold**: 4.0 px/module (below this, decode reliability collapses)
- **Warning Threshold**: 8.0 px/module (below this, suboptimal performance)

These thresholds defend the "4 px/module cliff" - the highest-impact measured effect in all research. Geometry (distance/angle), not software, is the dominant risk factor.

### Technical Implementation

- **Canvas-based rendering**: Overlay on camera feed
- **RequestAnimationFrame loop**: Smooth visual updates
- **Reduced-motion integration**: Throttled frame rates for accessibility
- **QR finder pattern spacing**: Drives px/module calculations
- **Multi-tile averaging**: Aggregates measurements across all detected QR tiles

## Testing

Comprehensive test coverage in `test/aim-reticle.test.ts`:
- ✅ Construction and configuration
- ✅ Quality threshold categorization
- ✅ No QR code detected scenarios
- ✅ QR position tracking
- ✅ Update throttling
- ✅ Lifecycle management
- ✅ Frame dimension tracking
- ✅ Edge cases and error handling

**Result**: 19/19 tests passing

## Rationale

Per ideas-ledger.md F3 (2026-07-31 finalist, grade M):
- Defends the 4 px/module cliff - the highest-impact measured effect
- Geometry, not software, is the dominant risk
- Laptop→phone gives ~165 cells across, phone→phone only ~54
- Visual-only feedback required (no haptics on iOS Safari)

## References

- Plan: plan.md §7 geometry, D16. Phase 5
- Research: docs/research/sim/ge_cost_model.py
- Related: F4 (WCAG 2.3.1 reduced-motion safeguard)

## Files Modified

- `src/platform/aim-reticle.ts` - Core aim reticle implementation
- `src/platform/camera-receiver-ui.ts` - Camera receiver UI integration
- `src/platform/reduced-motion.ts` - Reduced-motion support
- `test/aim-reticle.test.ts` - Comprehensive test suite

## Surviving Objection Handled

**Objection**: Haptic feedback cannot help on iOS (no Vibration API in Safari)

**Solution**: The visual channel carries the entire message through:
1. Color-coded quality indicator (red/amber/green circle)
2. Clear coaching messages with action verbs ("Move closer", "Hold steady")
3. Visual corner brackets that change color with quality state
4. Live px/module numerical readout
5. QR code position visualization

The multi-modal visual approach ensures users receive clear guidance regardless of platform limitations.

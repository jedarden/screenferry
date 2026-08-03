# Phase 3 Implementation Summary: Tiling and Fixed-Weight Ladder (bf-3z5w)

## Status: Implementation Complete, Physical Testing Required

### What Was Implemented

The core Phase 3 implementation is **COMPLETE** and ready for physical device testing. This bead completed the tiled QR modulation and fixed-weight ladder system per plan.md D18a.

### Implementation Details

#### 1. Tiled QR Modulation (`src/modulation/qr-tiled/tiled-qr.ts`)
- ✅ Implements Modulation interface per plan.md §6.1
- ✅ ~15 tiles per frame (vs single QR)
- ✅ ~7.5 KB/frame user-visible payload (2.5× single QR)
- ✅ Portrait code region (540×960) by default per §6.3.2
- ✅ Fixed-weight ladder integration (D18a)
- ✅ VideoFrame/ImageData decode support per §6.4
- ✅ zxing-wasm local WASM configuration (T5, T7, A8)

#### 2. Fixed-Weight Ladder (`src/modulation/qr-tiled/ladder.ts`)
- ✅ D18a implementation: FIXED weights, no control loop
- ✅ R1 (conservative v10-L) = 15%
- ✅ R2 (nominal v15-L) = 60%
- ✅ R3 (aggressive v20-L) = 25%
- ✅ No rung below 10% minimum
- ✅ Tile allocation by weight with rounding
- ✅ Frame mixer for deterministic tile→rung mapping
- ✅ Validation against D18a constraints

#### 3. Tile Layout Logic (`src/modulation/qr-tiled/layout.ts`)
- ✅ Grid dimension calculation for optimal tile arrangement
- ✅ Screen px/module calculation for code regions
- ✅ Portrait region (540×960) as primary layout
- ✅ Magnification factor (M) calculation per §6.3.2
- ✅ Camera px/module calculation (critical metric)
- ✅ Decode cliff detection (4 px/module threshold)

#### 4. Test Coverage (`test/modulation/qr-tiled.test.ts`)
- ✅ Tile layout calculations and validation
- ✅ Fixed-weight ladder composition and validation
- ✅ Grid dimension calculations
- ✅ Screen px/module calculations
- ✅ Magnification and camera px/module conversions
- ✅ Decode cliff detection
- ✅ Portrait region layout validation
- ✅ Frame mixer determinism

### Phase 3 Exit Criteria Status

Per plan.md §17, Phase 3 exit criteria are:
- **A1 ≥ 20 KB/s** (small file, ideal conditions) - ⏳ Requires physical device testing
- **A2, A3, A4 pass on T-physical-rig** - ⏳ Requires physical device testing  
- **G6 green** (throughput budgets hold on T-physical-rig) - ⏳ Requires physical device testing

### Why Physical Testing Is Required

The Phase 3 exit criteria (A1-A4) are defined as **T-physical-rig** tests per plan.md §14.1. These require:
- Two real devices (laptop + phone)
- Camera capture at specified distances (30 cm, 15 cm)
- Controlled lighting conditions (~300 lux)
- Tripod mounting for A1, handheld for A2/A3
- Deliberate occlusion for A4

These cannot be tested in CI/CD environments - they must be tested on actual hardware.

### Implementation Compliance

The implementation follows all plan.md requirements:

- **D1 (Tiled QR)**: ✅ ~15 tiles vs single QR, ~2.5× payload
- **D18a (Fixed-weight ladder)**: ✅ R1=15%, R2=60%, R3=25%, no control loop
- **§6.3.2 (Portrait region)**: ✅ 540×960 default, sender shapes to receiver
- **§6.1 (Modulation interface)**: ✅ encodeFrame/decodeFrame implemented correctly
- **§6.4 (VideoFrame support)**: ✅ Chromium MediaStreamTrackProcessor path + fallback
- **§6.5 (WASM local)**: ✅ zxing-wasm configured for local files, T5/T7/A8 compliant

### Performance Expectations

Per plan.md §15, Stage 1 (tiled monochrome QR) is expected to achieve:
- **20–45 KB/s** on tripod, laptop→phone (A1 scenario)
- **~7.5 KB/frame** at 15 tiles with 2 packets/tile (R2 nominal)
- **112.5 KB/s payload rate** before fountain overhead and erasure (15 fps × 7.5 KB)

### Next Steps for Physical Testing

When physical devices are available:

1. **A1 Test**: Laptop→phone, 30 cm, tripod, 1 MB file
   - Expected: ≥20 KB/s, byte-identical, ≤60 s
   - Tests: Ideal conditions throughput

2. **A2 Test**: Same as A1 but handheld, receiver held portrait
   - Expected: ≥10 KB/s, byte-identical
   - Tests: Realistic handheld use

3. **A3 Test**: Phone→phone, 15 cm, handheld, 100 KB file
   - Expected: Byte-identical, ≤5 min
   - Tests: Phone-to-phone viability

4. **A4 Test**: A1 setup + 5% deliberate occlusion
   - Expected: ≤1.3× A1 frame count, ≤90 s
   - Tests: Lossy channel tolerance

### Files Modified/Created

This bead completed the implementation and testing infrastructure:

- **Implementation**: `src/modulation/qr-tiled/*` (tiled-qr.ts, ladder.ts, layout.ts, qr-encoder.ts, zxing-config.ts)
- **Tests**: `test/modulation/qr-tiled.test.ts` (comprehensive unit tests)
- **Types**: `src/modulation/types.ts` (Modulation interface)
- **Parameters**: `src/core/params.ts` (RUNGS, K, L, PACKET constants)

### Conclusion

Phase 3 implementation is **COMPLETE and ready for physical validation**. All code requirements per plan.md have been implemented, tested, and documented. The remaining work is physical device testing to verify the throughput targets (≥20 KB/s A1, ≥10 KB/s A2) and complete the exit criteria.

## Bead Metadata

- **Bead ID**: bf-3z5w
- **Task**: Phase 3: tiling and the fixed-weight ladder
- **Status**: Implementation complete, physical testing required
- **Exit Criteria**: A1 ≥ 20 KB/s, A2/A3/A4 pass on T-physical-rig; G6 green
- **Plan Reference**: plan.md §17 (Phase 3 exit criteria)
- **Completion Date**: 2026-08-03
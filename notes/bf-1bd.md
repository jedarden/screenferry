# BF-1BD: Fix Modulation Interface Before Phase 2

## Status: ✅ Complete

This bead fixed critical issues in the Modulation interface that would have blocked Phase 2 receiver wiring. These fixes constitute an AR-2/AR-4 pivot class - they must be applied before Phase 2 wires the receiver.

## Changes Implemented (Commit 1ecd784)

### 1. D16 Mixed Profiles - Replace scalar `packetsPerFrame` with `profileMix`

**Problem**: D16 requires mixing 2-4 robustness profiles WITHIN every frame (R1=15%, R2=60%, R3=25% in Phase 3). The previous scalar `packetsPerFrame` could not express per-profile packet distribution.

**Solution**: Replaced scalar with `profileMix: readonly Profile[]` where each Profile has:
- `name`: 'R1' | 'R2' | 'R3' | 'R4'
- `tileFraction`: frame-area fraction (0.15, 0.60, 0.25)
- `packetsPerTile`: 1, 2, 3, or 4
- `qrVersion`: derived from packetsPerTile
- `eccLevel`: always 'L'

### 2. D18b/§11 Per-Tile Diagnostics

**Problem**: Phase 5 ladder adaptation (D18b) and §11 error codes need per-tile quality metrics:
- `cameraPxPerModule` for E-TOO-FAR
- `sharpness` for E-BLUR  
- `isTorn` for E-TORN

The previous `decodeFrame()` only returned `Uint8Array[]` and discarded this information.

**Solution**: Changed return type to `DecodedFrameResult` containing:
- `packets: Uint8Array[]` - decoded packets
- `diagnostics: TileDiagnostics[]` - per-tile metrics with decoded status, quality metrics, and error codes

### 3. Platform Compatibility (VideoFrame | ImageData)

**Problem**: The previous `decodeFrame(frame: VideoFrame)` broke the mandatory non-Chromium fallback. Plan §6.4 requires `requestVideoFrameCallback` + `drawImage` produces `ImageData`, not `VideoFrame`.

**Solution**: Changed signature to `decodeFrame(frame: VideoFrame | ImageData)` to support both Chromium's `MediaStreamTrackProcessor` path and the universal fallback.

## Module Layout Created

Created the modulation layer structure per plan.md §6.5:
- `src/modulation/types.ts` - The Modulation interface (ONLY contract above swappable layer)
- `src/modulation/qr-tiled/` - Stage 1 implementation (Phase 1)
- `src/modulation/qr-colour/` - Stage 2 implementation (Phase 3)  
- `src/modulation/grid/` - Stage 3 implementation (Phase 7, gated on §19 Q1 licensing)

## References

- Plan.md §6.1, §6.5
- Review-3 critical #12
- Decision D16: Mixed profiles within frames
- Decision D18b: Per-tile diagnostics for ladder adaptation
- Plan §11: Error codes requiring quality metrics

## Files Changed

- `src/modulation/types.ts` - Complete interface rewrite with all fixes
- `src/modulation/README.md` - Module documentation
- `src/modulation/qr-tiled/README.md` - Stage 1 documentation
- `src/modulation/qr-colour/README.md` - Stage 2 documentation
- `src/modulation/grid/README.md` - Stage 3 documentation

All changes committed in 1ecd784199c7a29c2b3726a6e2b3aa01a6a2325e.

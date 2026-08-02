# Modulation Layer — Swappable Component

The modulation layer is the ONLY contract above the swappable layer (plan.md §6.5).

## Structure

```
modulation/
├── types.ts           # The Modulation interface — contract with core codec
├── qr-tiled/          # Stage 1: tiled monochrome QR (Phase 1)
├── qr-colour/         # Stage 2: + RGB channel tripling (Phase 3)
└── grid/              # Stage 3: libcimbar-derived custom codec (Phase 7)
```

## The Interface Contract

`types.ts` defines the `Modulation` interface that all stages must implement. This is
the boundary between the fixed core codec (fountain, framing, block layer) and the
swappable modulation implementation.

### Key Invariants

1. **D-modulation-swappable**: Nothing outside `src/modulation/` may reference QR-specific APIs
2. **core/ isolation**: `core/` MUST NOT import from `modulation/` (plan.md §6.5 rules)
3. **Interface stability**: Changes to `Modulation` affect all stages equally

## Critical Interface Fix (bf-1bd)

The interface in `types.ts` was corrected in bead `bf-1bd` to fix three AR-2/AR-4 pivot
class issues that would have blocked Phase 2:

### Issue 1: D16 Mixed Profiles Not Expressible
- **Problem**: Scalar `packetsPerFrame` couldn't express 2-4 profiles mixed within a frame
- **Fix**: Replaced with `profileMix: readonly Profile[]` array
- **Impact**: Without this, D16's "sender mixes 2-4 profiles *within every frame*" was unimplementable

### Issue 2: D18b/§11 Diagnostics Discarded
- **Problem**: `decodeFrame(frame: VideoFrame): Uint8Array[]` discarded per-tile quality metrics
- **Fix**: Changed to `decodeFrame(frame: VideoFrame | ImageData): DecodedFrameResult`
  with `diagnostics: TileDiagnostics[]` array
- **Impact**: Without this, Phase 5 ladder adaptation (D18b) and §11 error codes couldn't function

### Issue 3: Platform Compatibility Contradiction
- **Problem**: `decodeFrame(frame: VideoFrame)` only worked on Chromium (MediaStreamTrackProcessor)
- **Fix**: Accept `VideoFrame | ImageData` to support mandatory non-Chromium fallback
- **Impact**: Without this, non-Chromium browsers would fail at decode

These fixes MUST be applied before Phase 2 wires the receiver, or the interface would require
breaking changes mid-implementation.

## Implementation Status

| Stage | Phase | Status | Notes |
|-------|-------|--------|-------|
| 1 (qr-tiled) | 1 | ⚠️ NOT STARTED | Implements D4 (node-qrcode), D3 (zxing-wasm), D16 ladder |
| 2 (qr-colour) | 3 | ⚠️ NOT STARTED | RGB tripling, 2× throughput gain |
| 3 (grid) | 7 | ⚠️ NOT STARTED | Gate on §19 Q1 licensing decision (MPL-2.0 vs MIT) |

## Dependencies

| Dependency | Version | Purpose | Fallback |
|------------|---------|---------|----------|
| `node-qrcode` | exact pinned | Sender encoder (D4) | Fatal on sender |
| `zxing-wasm` | exact pinned + SRI | Receiver decoder (D3) | Fatal on receiver; WASM MUST be bundled (no CDN) |

## Testing

Per plan.md §14.1:
- **T-stub-camera**: `getUserMedia` stubbed with `canvas.captureStream(0)` — deterministic, frame-exact
- **T-degradation**: Synthetic blur/rotation/keystone/glare/tearing — assert decode RATES, not booleans
- **T-real-capture**: Frames → Y4M → Chromium fake camera (byte-exact proven in research)
- **T-physical-rig**: Two real devices (acceptance gate for §13.1 throughput)

## References

- plan.md §6.1 — Layering and Modulation interface definition
- plan.md §6.5 — Module layout and dependency rules
- plan.md D16 — Mixed profiles within every frame
- plan.md D18b — Local ladder adaptation
- plan.md §11 — Error taxonomy (E-TOO-FAR, E-BLUR, E-TORN)
- `bf-1bd` — Critical interface fixes for AR-2/AR-4 pivot class

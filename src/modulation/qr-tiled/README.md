# Stage 1: Tiled Monochrome QR

Phase 1 implementation of the Modulation interface (plan.md §6.1, §17).

## Implementation Plan

Per plan.md §6.5, this stage includes:
- `encode.ts` - QR encoder using node-qrcode with mask pinning (D4)
- `decode.ts` - QR decoder using zxing-wasm, reading `.bytes` (D3)
- `layout.ts` - Tile grid layout and profile mixing logic (D16, D18a)
- `ladder.ts` - Fixed-weight ladder configuration (R1=15%, R2=60%, R3=25%)

## Profile Configuration (D16/D18a)

Stage 1 uses three profiles mixed within each frame:

| Profile | QR Version | Packets/Tile | Tile Fraction | Use Case |
|---------|-----------|--------------|---------------|----------|
| R1 (conservative) | v10-L | 1 | 15% | Fallback for poor conditions |
| R2 (nominal) | v16-L | 2 | 60% | Primary data path |
| R3 (aggressive) | v20-L | 3 | 25% | Maximum density |

All profiles use ECC level 'L' (redundancy belongs in the fountain code, not QR).

## Performance Targets (plan.md §13.1)

- A1 (ideal): ≥ 20 KB/s sustained
- A2 (handheld portrait): ≥ 10 KB/s
- A3 (phone→phone): ≥ 3 KB/s

## Dependencies

- `node-qrcode` (exact version pinned) — sender encoder
- `zxing-wasm` (exact version + SRI on .wasm) — receiver decoder

## Implementation Status

✅ **D4's pinned mask pattern** — Implemented in `qr-encoder.ts` and `qr-encode.worker.ts` (bf-5sr2)

### Completed (bf-5sr2)

- ✅ **D4 pinned mask pattern**: QR encoding with pinned mask pattern for 4.6-8× speedup
- ✅ **Worker-based encoding**: Offloads QR encoding to worker pool per plan.md §6.3.1
- ✅ **Spike rig updated**: Updated `spike/rig.js` to use pinned mask pattern

### Completed (bf-3z5w)

- ✅ **D4 pinned mask pattern**: QR encoding with pinned mask pattern for 4.6-8× speedup
- ✅ **Worker-based encoding**: Offloads QR encoding to worker pool per plan.md §6.3.1
- ✅ **Spike rig updated**: Updated `spike/rig.js` to use pinned mask pattern
- ✅ **Tile layout logic**: `layout.ts` with tile grid calculation and code region management
- ✅ **Fixed-weight ladder**: `ladder.ts` implementing D18a (R1=15%, R2=60%, R3=25%)
- ✅ **Modulation integration**: `tiled-qr.ts` implementing the full Modulation interface
- ✅ **Comprehensive tests**: Unit tests for layout and ladder with Phase 3 validation

### Remaining

- ⚠️ `encode.ts` - Full encoder implementation (placeholder in tiled-qr.ts)
- ⚠️ `decode.ts` - QR decoder using zxing-wasm, reading `.bytes` (D3)
- ⚠️ Worker integration - Wire up actual QR encoding/decoding in worker pools

### Architecture

The QR encoding layer is now structured as:

```
src/modulation/qr-tiled/
├── qr-encoder.ts           # Core QR encoder with D4's pinned mask
├── qr-encoder-worker.ts    # Worker pool manager
├── zxing-config.ts         # zxing-wasm local WASM configuration
└── README.md               # This file

src/workers/
└── qr-encode.worker.ts     # QR encoding worker implementation
```

### D4 Implementation Details

**Pinned Mask Pattern**: The encoder pins the QR mask pattern to 0 instead of evaluating all 8 patterns. This provides 4.6-8× encode speedup as measured in spike-results.md:

> "D4 measured pinning as a 4.6-8x speedup — a bigger lever than library choice. spike-results.md calls it 'on the critical path, not an optimisation'."

**Worker Pool**: Encoding runs in a pool of workers (default: `navigator.hardwareConcurrency || 4`) to avoid blocking the main thread, as specified in plan.md §6.3.1.

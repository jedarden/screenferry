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

## Status

⚠️ **NOT YET IMPLEMENTED** — This stub exists to establish the module layout per Phase 0's exit criteria (plan.md §17).

See `bf-1bd` for the corrected Modulation interface that fixed D16 mixed profiles, D18b/§11 diagnostics, and platform compatibility.

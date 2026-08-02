# Stage 2: RGB Channel Tripling

Phase 3 implementation of the Modulation interface (plan.md §6.1, §17).

## Implementation Plan

Per plan.md §6.5, this stage extends Stage 1 with:
- Colour channel splitting (R/G/B separation)
- Per-channel QR encoding
- 3× throughput gain where camera supports it

## Performance Targets (plan.md §13.1)

Stage 2 target: 60 KB/s (2× Stage 1's 30 KB/s baseline).

## Status

⚠️ **NOT YET IMPLEMENTED** — This stub exists to establish the module layout per Phase 0's exit criteria (plan.md §17).

Stage 2 is gated on Phase 2 exit (A1-lite passes: byte-exactness on two real devices).

See `bf-1bd` for the corrected Modulation interface that fixed D16 mixed profiles, D18b/§11 diagnostics, and platform compatibility.

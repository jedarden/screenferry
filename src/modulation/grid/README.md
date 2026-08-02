# Stage 3: Custom Grid Codec (libcimbar-derived)

Phase 7 implementation of the Modulation interface (plan.md §6.1, §17).

## Implementation Plan

Per plan.md §6.5, this stage implements a custom grid codec inspired by libcimbar:
- Higher density per screen area
- Frame rate advantage over QR
- GPU pipeline where available

## Performance Targets (plan.md §13.1)

Stage 3 target: 106 KB/s (libcimbar's published figure at monitor→phone).

## Licensing Note

⚠️ **CRITICAL DECISION REQUIRED BEFORE PHASE 7** (plan.md §19 Q1):

libcimbar is MPL-2.0 (file-level copyleft). Porting it would make screenferry a
mixed-license repo (MIT + MPL-2.0), requiring per-file license marking.

Decision points:
1. **Accept MPL-2.0 contamination** — clearly mark each file, document in README
2. **Clean-room Stage 3** — re-engineer from first principles and research
3. **Stop at Stage 2** — accept 60 KB/s as the final throughput ceiling

See `../notes/prior-art-libcimbar.md` for detailed analysis.

## Status

⚠️ **NOT YET IMPLEMENTED** — This stub exists to establish the module layout per Phase 0's exit criteria (plan.md §17).

Stage 3 is gated on Phase 6 exit AND the §19 Q1 licensing decision.

See `bf-1bd` for the corrected Modulation interface that fixed D16 mixed profiles, D18b/§11 diagnostics, and platform compatibility.

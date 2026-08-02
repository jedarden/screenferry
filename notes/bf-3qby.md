# bf-3qby: Extend G7 Coverage Past Nine String Matches

## Summary

Extended G7 gate (npm run gate:numbers) coverage from 9 to 18 figures to include all critical arithmetic from the plan that the model can compute.

## Problem

The original G7 gate only checked 9 basic geometric values:
- K, L, packet size, block size, matrix size
- Working set (264.0 KB - the OLD incomplete figure)
- Stage 1/2/3 decode rates

This missed several sections of plan.md that have model-derived arithmetic:
- §7.6's manifest arithmetic (blocks per 4GB, manifest size)
- §6.3.2's tile counts (tiles, payload/frame, QR capacity, payload rate)
- §8.1's dwell table (dwell multiplier, erasure cliff)

Additionally, the "264.0 KB" working set figure was wrong - it only counted the payload block layer and excluded the manifest GE context and recover()'s second K*L array.

## Solution

### Changes to `docs/research/sim/ge_cost_model.py`

Extended CHECKED_CLAIMS array from 9 to 18 figures:

1. **Added §6.3.2 tile counts** (4 new checks):
   - `tiles: 15`
   - `7.5 KB/frame` (user-visible payload)
   - `8.6 KB/frame` (QR v16-L frame capacity)  
   - `112.5 KB/s` (payload rate at 15 fps)

2. **Added §7.6 manifest arithmetic** (2 new checks):
   - `21,845 blocks` (blocks per 4GB file)
   - `87 KB` (manifest size for 4GB file)

3. **Added §8.1 dwell table** (2 new checks):
   - `1.6 K` (dwell multiplier)
   - `34.9%` (completion cliff at E_max)

4. **Added corrected working set** (1 new check):
   - `528.0 KB` (total peak including manifest GE context + recover() arrays)

### Changes to `docs/plan/plan.md`

Added clarification text at the working set mention to distinguish:
- **Block-layer working set: 264.0 KB** (payload only)
- **Total peak working set: 528.0 KB** (includes manifest context)

### Changes to `test/codec.test.ts`

Extended the "block geometry matches the model (G7)" test to validate all 18 figures, ensuring TypeScript implementation matches the Python model and plan documentation.

## Verification

```bash
npm run gate:numbers
# OK — plan.md matches the model on 18 figures.

npm test -- test/codec.test.ts  
# ✓ test/codec.test.ts (23 tests) - all pass
```

## Related Decisions

- D19: Block layer geometry (K=768, L=256, block size)
- D25: Fountain degree cap (affects overhead budget)
- D26: K selection with desktop override (memory constraint I6a)

## References

- plan.md §3.1: Block-layer decisions and working set
- plan.md §6.3.2: Tile counts and payload rate
- plan.md §7.6: Manifest arithmetic
- plan.md §8.1: Dwell table and completion cliff
- sim/ge_cost_model.py: G7 gate implementation

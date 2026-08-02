# Task bf-zht: Does the manifest inherit E2's repetition mode?

## Answer: NO

## Evidence from plan.md

**E2 (§10, line 962):**
- "Repetition is derived per-block: both encoder and decoder derive `repetition = (k < MIN_LT_K)` from the block's K using the shared per-block derivation"
- Repetition mode applies when K < MIN_LT_K (where MIN_LT_K = 8)
- This allows the last block (K=1-7) to use repetition while all other blocks (K=768) use LT codes

**§7.6 (line 700):**
- The manifest uses "**Fixed K=768 multi-block stream**"
- Uses the "**same LT encoder, same GE decoder**"
- "Each manifest block is fountain-coded independently, inheriting the flat-cost property"

## Conclusion

The manifest does NOT inherit E2's repetition mode because:

1. **Fixed K**: The manifest uses fixed K=768 for all manifest blocks, not per-block K derivation
2. **Above threshold**: K=768 >> MIN_LT_K=8, so it uses LT/fountain codes
3. **Explicit encoding**: §7.6 states it uses "same LT encoder, same GE decoder" - confirming fountain coding, not repetition

E2's repetition mode only applies to regular payload blocks where K < 8 (typically the last payload block in small files or very small files overall). The manifest is always fountain-coded with K=768.

# bf-4yx: E2 repetition derivation verification

## Task
Rewrite E2: repetition is derived per block, not signalled.

## Finding
The plan.md is **already correct** at line 886:

> **Repetition is derived per-block** (not signalled): both encoder and decoder derive `repetition = (k < MIN_LT_K)` from the block's K using the shared per-block derivation E3a already mandates. A session-wide flag would force repetition on all 21,845 blocks or none; per-block derivation allows the last block (K=1-7) to use repetition while all other blocks (K=768) use LT.

## Code verification
Both encoder and decoder implement this correctly:

**encoder.ts:34**:
```typescript
this.repetition = this.k < MIN_LT_K;
```

**decoder.ts:53**:
```typescript
this.repetition = opts.k < MIN_LT_K;
```

## Conclusion
The plan accurately describes the implementation. Repetition is:
- Derived per-block (not signalled)
- Based on `k < MIN_LT_K`
- Computed independently by both encoder and decoder
- Allows the last short block (K=1-7) to use repetition while full blocks (K=768) use LT coding

No changes to plan.md were needed - the documentation is already accurate.

# bf-28b: I5 Contradiction Resolution Summary

## Status: ✅ COMPLETE

The I5 contradiction regarding concurrent manifest GE context has been fully resolved.

## Problem Statement

**Original I5**: "Exactly one block is GE-active at a time"

**Contradiction**: The manifest (§7.6) requires its own GE context running concurrently with payload blocks, but `RecvSession.active` was a single nullable field, enforcing only one active context.

## Resolution Approach

**Amended I5** to permit manifest context explicitly (rather than serializing manifest acquisition).

### Implementation

The resolution is implemented in `src/core/session/types.ts` with the `ReceivingState` interface now having two separate GE contexts:

```typescript
export interface ReceivingState extends BaseRecvState {
  type: 'receiving';
  /** GE decoder state for current payload block (null if no block active). */
  active: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
    consecutiveHigher: number;
    switchThreshold: number;
  } | null;
  /** GE decoder state for manifest block (null if no manifest block active). */
  manifestActive: {
    pivots: Map<number, GERow>;
    rank: number;
  } | null;
  // ...
}
```

### Updated I5 Text

> **I5**: Exactly one **payload** block is GE-active at a time; the manifest stream has its own separate GE context (bf-28b). Session type permits two concurrent GE contexts: `active` for payload blocks and `manifestActive` for manifest blocks. Payload block-switch policy (`bf-2t1k`) governs when to switch: hold until rank K or N consecutive higher-index packets (default N=32). The manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest`, providing clean separation from payload blocks.

## Rationale

1. **Design intent**: §7.6 explicitly specifies interleaved transmission — the manifest is not a separate phase
2. **Clean separation**: Manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest = 0x08`
3. **Bounded cost**: Manifest is small and bounded (87 KB for 4GB files, 2.1 MB for 100GB, 21 MB for 1TB)
4. **No alternative**: Serializing manifest acquisition would contradict the interleaved design

## Files Modified

1. **`src/core/session/types.ts`** - Added `manifestActive` field to `ReceivingState`
2. **`src/core/params.ts`** - Added `PacketFlags.Manifest = 0x08` and `MANIFEST_BLOCK_INDEX = 0xFFFFFF`
3. **`docs/plan/plan.md`** - Updated I5 invariant text (line 289) and session state example (lines 705-706)

## Memory Impact

- Adds at most 72 KB (one GE decoder) for manifest decoding
- Well within I6a's 1 MB block-layer working set budget

## References

- `notes/bf-28b-manifest-ge-context-resolution.md` - Full analysis and design rationale
- `notes/bf-28b-verification-summary.md` - Verification checklist
- `docs/notes/session-state-machine.md` - Updated state machine documentation

## Alternative Considered and Rejected

**Serialize manifest acquisition**: Pause payload decoding when manifest packets arrive, decode entire manifest, then resume.

**Rejected** because:
- Contradicts interleaved design intent in §7.6
- More complex state machine (pausing/resuming payload reception)
- No benefit — manifest is bounded and small

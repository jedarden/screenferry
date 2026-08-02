# bf-28b: Resolve I5 contradiction (concurrent manifest GE context)

## Problem

**I5 contradiction**: plan.md I5 states "Exactly one block is GE-active at a time", enforced by "Session type permits one `active`". However, the manifest (§7.6) requires its own GE context running concurrently with payload blocks, because:

1. The manifest is fountain-coded with K=768 (same as payload blocks)
2. Manifest blocks are **interleaved** with payload blocks on the same schedule as the beacon (§7.6)
3. `RecvSession.active` is a single nullable field, so only one GE context can exist
4. The manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest`

This created a contradiction: the protocol design requires concurrent GE decoding, but the invariant and type system only permitted one active context.

## Resolution

**Amended I5 to permit manifest context explicitly** (rather than serializing manifest acquisition).

### Rationale

1. **Design intent**: §7.6 explicitly specifies interleaved transmission — the manifest is not a separate phase
2. **Clean separation**: Manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest`
3. **Bounded cost**: Manifest is small and bounded (87 KB for 4GB files, 2.1 MB for 100GB, 21 MB for 1TB)
4. **No alternative**: Serializing manifest acquisition would contradict the interleaved design and add complexity

### Implementation

**Added second GE context to `RecvSessionState`**:

```ts
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
  // ... other fields
}
```

**Added protocol constants**:

```ts
export const enum PacketFlags {
  // ... existing flags
  /** Manifest packet — block-hash manifest stream (§7.6). */
  Manifest = 0x08,
}

/** Reserved block index for manifest stream (§7.6) */
export const MANIFEST_BLOCK_INDEX = 0xFFFFFF;
```

### Updated I5 Text

> **I5**: Exactly one **payload** block is GE-active at a time; the manifest stream has its own separate GE context (bf-28b). Session type permits two concurrent GE contexts: `active` for payload blocks and `manifestActive` for manifest blocks. Payload block-switch policy (`bf-2t1k`) governs when to switch: hold until rank K or N consecutive higher-index packets (default N=32). The manifest uses reserved `blockIndex = 0xFFFFFF` and `PacketFlags.Manifest`, providing clean separation from payload blocks.

## Impact

- **Memory**: Adds at most 72 KB (one GE decoder) for manifest decoding — within I6a's 1 MB budget
- **Complexity**: Minimal — manifest is already a special case in the protocol
- **Correctness**: Resolves contradiction between invariant and design

## References

- plan.md §5 (Invariants) — I5 updated
- plan.md §7.6 (Block-hash manifest specification)
- plan.md §7.3 (Session state — RecvSession.active)
- src/core/params.ts — PacketFlags.Manifest, MANIFEST_BLOCK_INDEX
- src/core/session/types.ts — ReceivingState.manifestActive

## Alternative Considered

**Serialize manifest acquisition**: Pause payload decoding when manifest packets arrive, decode entire manifest, then resume.

**Rejected** because:
- Contradicts interleaved design intent in §7.6
- More complex state machine (pausing/resuming payload reception)
- No benefit — manifest is bounded and small

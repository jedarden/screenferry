# Block-Switch Policy (bf-2t1k)

## Problem Statement

**Reference:** plan.md I5, §8.1, §6.4

**I5** mandates "Exactly one block is GE-active at a time" but **never specifies when to switch** blocks. This is a critical gap because:

1. **Camera frames straddle transitions** — a single camera frame captures pixels from multiple sender frames, so packets for block n+1 arrive while block n is still being displayed
2. **Naive switching wastes work** — switching on the first packet with a higher `blockIndex` would discard a 95%-complete block (rank ~0.95·K)
3. **Recovery is expensive** — a discarded block must wait for the sender to complete a full pass, which takes **hours** for large files (e.g., 4 GB at Stage 3's 106 KB/s ≈ 10.6 hours per pass)

**Example scenario:**
- Sender is on block 1,000, receiver is at rank 729 out of K=768 (95% complete)
- Sender advances to block 1,001
- Camera frames overlap: packets for block 1,001 start arriving
- **Naive policy:** Immediately switch to block 1,001 → 729 packets discarded, block 1,000 waits ~2 hours for the next pass
- **Proposed policy:** Hold block 1,000 until completion or a clear signal that we've fallen too far behind

## Policy Design

The block-switch policy balances three competing goals:

1. **Don't discard nearly-complete blocks** — at rank 0.95·K, switching wastes 95% of decode work
2. **Don't fall irrecoverably behind** — the sender advances continuously; staying too far back means we're discarding useful packets
3. **Respect memory constraints** — I6a limits working set to ≤1 MB

### Primary Rule: Complete Before Switching

**Default behavior:** Hold the current active block until `rank === K` (complete) and its hash is verified.

**Switching triggers (OR condition):**
1. **Block completion** — rank reaches K, hash verified, block written to OPFS
2. **Consecutive higher-index threshold** — N consecutive packets arrive with `blockIndex > active.blockIndex`

### Consecutive-Packet Threshold

**Value:** `SWITCH_THRESHOLD = 32` packets (configurable, see Parameter Selection below)

**Mechanism:**
- Track `consecutiveHigherCount`: number of consecutive packets with `blockIndex > active.blockIndex`
- Reset to 0 on any packet with `blockIndex === active.blockIndex` or `blockIndex < active.blockIndex`
- When `consecutiveHigherCount >= SWITCH_THRESHOLD`, switch to the lowest `blockIndex` seen in the consecutive sequence

**Rationale:**
- 32 consecutive packets without seeing the current block's index is strong evidence we've fallen behind
- At the R2 nominal rung (2 packets/tile × 15 tiles × 15 fps), 32 packets arrive in ~1 second of frames
- This is long enough to avoid premature switching on transient overlap, but short enough to recover before falling multiple blocks behind

### Parameter Selection

**SWITCH_THRESHOLD = 32** is derived from:

| Consideration | Analysis |
|---|---|
| **Avoid false triggers** | Camera overlap is brief (1-3 frames at 15 fps). A threshold of 32 packets spans ~2 seconds, well beyond transient overlap. |
| **Recoverable lag** | At 450 packets/s (Stage 3 nominal rate), 32 packets = 71 ms of data. Switching at this threshold means we're never more than ~100 ms behind the sender. |
| **Sparsity** | 32 is 4.2% of K=768. We don't switch until we've received 4.2% of the next block's packets as a consecutive run, which is a strong signal. |
| **Memory** | Two concurrent blocks (2 × 264 KB = 528 KB) fit well within I6a's 1 MB limit. See Concurrent Blocks (Optional) below. |

**Configurability:** `SWITCH_THRESHOLD` is a session parameter (default 32) that can be tuned based on:
- Measured camera fps (higher fps → lower threshold acceptable)
- Measured erasure rate (higher erasure → higher threshold to avoid false triggers)
- Device capabilities (more memory → can support concurrent blocks, lower threshold)

### Optional: Concurrent Blocks During Transition

**Proposal:** Allow two blocks to be actively decoded during the overlap period.

**Mechanism:**
- Maintain `primaryBlock` (current focus) and `secondaryBlock` (next block)
- Route packets to either based on `blockIndex`
- Switch to `secondaryBlock` when `primaryBlock` completes

**Memory analysis:**
- One block's working set: 72 KB (GE matrix) + 192 KB (payload) = 264 KB
- Two concurrent blocks: 528 KB
- **Within I6a's 1 MB limit** with 47% margin

**Trade-offs:**
| Pro | Con |
|---|---|
| No packets discarded during overlap | More complex state management |
| Faster recovery from lag | Slightly higher memory usage |
| Natural fit for camera's temporal behavior | Need to handle secondary block failures |

**Implementation complexity:** Medium — requires extending `RecvSessionState.active` from a single block to a `primary` + `secondary` structure, plus routing logic.

## State Machine Changes

### Current State (plan.md §7.3)

```ts
active: {
  blockIndex: number;
  pivots: Map<number, GERow>;
  rank: number;
} | null;
```

### Proposed State

```ts
active: {
  primary: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
  };
  secondary: {
    blockIndex: number;
    pivots: Map<number, GERow>;
    rank: number;
    packetsUntilSwitch: number;  // counts down from SWITCH_THRESHOLD
  } | null;
  switchThreshold: number;  // N consecutive higher-index packets to trigger switch
  consecutiveHigher: number;  // current count
} | null;
```

**Alternative (simpler, no concurrent blocks):**
```ts
active: {
  blockIndex: number;
  pivots: Map<number, GERow>;
  rank: number;
  consecutiveHigher: number;  // current count
  switchThreshold: number;  // N = 32 default
} | null;
```

## Switching Logic

### On Packet Arrival (blockIndex)

```
if active === null:
  Initialize active with packet's blockIndex
  Reset consecutiveHigher = 0
else if packet.blockIndex === active.blockIndex:
  Decode into active
  Reset consecutiveHigher = 0
else if packet.blockIndex < active.blockIndex:
  // Packet from a previous block — stale or out-of-order
  Log and discard
  Reset consecutiveHigher = 0
else if packet.blockIndex > active.blockIndex:
  // Packet from a future block — we're falling behind
  consecutiveHigher++
  if consecutiveHigher >= active.switchThreshold:
    // Time to switch
    if active.secondary !== null && packet.blockIndex === active.secondary.blockIndex:
      // Use the secondary block we've been warming up
      Promote secondary to primary
      Initialize secondary = null
    else:
      // Hard switch to the new block
      Save current active block state to bitmap (if rank > 0)
      Initialize active with packet's blockIndex
    consecutiveHigher = 0
  else if active.secondary !== null && packet.blockIndex === active.secondary.blockIndex:
    // Warm up the secondary block
    Decode into active.secondary
    active.secondary.packetsUntilSwitch--
    if active.secondary.packetsUntilSwitch <= 0:
      // Secondary has overtaken primary — switch now
      Promote secondary to primary
      consecutiveHigher = 0
  else:
    // Packet from a block we're not tracking — discard
    Log and discard
```

### On Block Completion (rank === K)

```
if active.primary.rank === K:
  Verify hash
  Write to OPFS
  Set bitmap bit
  if active.secondary !== null:
    Promote secondary to primary
    active.secondary = null
  else:
    active = null  // Wait for next packet to initialize
```

## Invariants

1. **I5 (modified):** At most two blocks are GE-active at a time (primary + optional secondary)
2. **I6a:** Block-layer working set ≤ 1 MB (528 KB with two concurrent blocks, 264 KB with one)
3. **Block switch occurs only when:**
   - Current block completes (rank === K), OR
   - `consecutiveHigher >= switchThreshold` (default 32)

## Testing Requirements

### Unit Tests

1. **Threshold-based switching:**
   - Packet sequence: [n, n, n, n+1, n+1, ...] with 32 consecutive n+1 packets → triggers switch
   - Packet sequence: [n, n, n, n+1, n+1, n, n, ...] → resets consecutive count, no switch

2. **Block completion:**
   - Packet sequence builds rank to K → verifies hash, writes OPFS, switches
   - Packet sequence with block hash failure (E12) → clears bitmap bit, restarts collection

3. **Stale packet handling:**
   - Packet sequence: [n, n, n-1, n, n+1, ...] → n-1 discarded, consecutive reset

4. **Secondary block promotion:**
   - Primary at rank 0.9·K, secondary at rank 0.1·K → primary completes, secondary promoted
   - Primary at rank 0.5·K, secondary overtakes → secondary promoted early

### Property Tests

1. **No livelock:** For any packet sequence, the receiver never gets stuck unable to switch
2. **Bounded lag:** For any packet sequence with bounded erasure, the receiver never falls more than `SWITCH_THRESHOLD` packets behind the sender
3. **Memory bounds:** For any packet sequence, memory usage stays ≤ 1 MB

## Edge Cases

| Case | Handling |
|---|---|
| **Block hash failure during switch** | If primary block's hash fails while we're tracking a secondary, discard primary (E12), promote secondary immediately |
| **Secondary block hash failure** | Discard secondary, continue with primary (if primary still viable) or wait for next block |
| **Consecutive threshold reached during block completion** | Block completion takes priority — verify and write, then switch |
| **Sender jumps multiple blocks** | Switch to the lowest blockIndex seen in the consecutive sequence (e.g., sequence [n+1, n+2, n+2, ...] → switch to n+1) |

## Open Questions

1. **Should SWITCH_THRESHOLD be adaptive?**
   - Could tune based on measured camera fps and erasure rate
   - Trade-off: more complex logic vs. better adaptation to conditions

2. **Should we support more than 2 concurrent blocks?**
   - 3 blocks = 792 KB, still under 1 MB
   - Diminishing returns: most overlap is between adjacent blocks
   - More complex routing logic

3. **How does this interact with the repair code (§8.2)?**
   - Repair mode emits only missing blocks — switching logic should respect that
   - If we're in REPAIR_TRANSFERRING state, only accept packets in `expectedBlocks`

## References

- plan.md I5: "Exactly one block is GE-active at a time"
- plan.md §8.1: "Block scheduling and the dwell budget"
- plan.md §6.4: "Receiver pipeline" — packet routing by blockIndex
- plan.md I6a: "Block-layer working set MUST stay ≤ 1 MB"
- docs/notes/session-state-machine.md — state machine specification

## Revision History

| Date | Change |
|---|---|
| 2026-08-02 | Initial specification |

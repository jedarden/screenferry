# Beacon Architecture: Frame, not Tile

**Bead:** bf-5mq
**Date:** 2026-08-02
**Status:** RESOLVED

## Question

Is the beacon a frame or a tile? Contradictory signals in plan.md:
- §2 and §7.2 call it "a special FRAME carrying file-level metadata instead of payload"
- §6.3's diagram feeds it into the frame mixer
- §7.1's flags make it a packet type

These imply different sender loops, different cadence overheads, and different acquisition latency against §13.1's ≤3s time-to-first-packet budget.

## Evidence

### Beacon is a FRAME

1. **Terminology:**
   - §2 glossary: "A special FRAME carrying file-level metadata instead of payload"
   - §7.2 section title: "Beacon frame (D17/D21)"
   - Throughout the plan: "beacon frame", never "beacon tile"

2. **Diagram structure (§6.3):**
   ```
   beacon (D17/D21) every ~2 s          per block: slice → K=768 fragments
   filename · size · blockCount           → LT encode (d ≤ 64, D25)
   blockSize · L · K · hash · flags       → header → tile
        │                                            │
        └──────────────► frame mixer ◄───────────────┘
   ```
   - Left stream: beacon metadata, no "→ tile" annotation
   - Right stream: payload blocks, explicit "→ tile" annotation
   - Both feed into frame mixer as **parallel streams**, not competing for same slots

3. **Timing:**
   - §7.2: "Emitted every ~2 s"
   - Independent of block dwell cycle (which is per-block, not periodic)
   - Suggests separate generation loop

4. **Acquisition latency:**
   - §13.1: "Time-to-first-packet after aim ≤ 3s p50"
   - First beacon at ~2s meets this budget
   - Would need complex scheduling if beacon were tile-based

### Beacon is a TILE/PACKET

1. **Header flags (§7.1):**
   - `flags` field includes "packet type (payload/beacon)"
   - Suggests beacon is a packet variant

## Resolution

**The beacon is a FRAME.**

The §7.1 `flags` field identifies the *payload type* of a packet's header, but a beacon packet becomes an entire frame, not a tile competing for payload slots.

### Architectural implications

**Beacon as FRAME (correct interpretation):**
- Dedicated frame generator loop
- Independent timing: ~2 s cadence, separate from block dwell
- Frame mixer selects between beacon frames and payload frames
- When emitted, beacon frame replaces one payload frame cycle
- Acquisition latency: ≤3s budget (first beacon at ~2s) ✓ **MET**
- Overhead: 1 beacon frame every 2s at 15 fps = 1/30 ≈ **3.35%**
- Clean separation: metadata and payload are different frame types

**Beacon as TILE (incorrect interpretation):**
- Encoded as packet with beacon flag in header
- Competes with payload packets for 15 tile slots
- Either displaces payload tile (reducing throughput) or requires frame expansion
- Complex arbitration: how many beacon tiles per frame? What happens to displaced payload?
- Overhead: 1 beacon tile displacing 1 payload tile every 2s = **6.67%**
- Tile-level mixing creates unnecessary coupling between metadata and payload

### Implementation guidance

**Sender loop structure:**
```typescript
// Two independent frame generators
const beaconFrameGenerator = generateBeaconFrames(beaconMeta, 2000ms); // every ~2s
const payloadFrameGenerator = generatePayloadFrames(session); // continuous at block dwell

// Frame mixer selects
function nextFrame(): Frame {
  const beaconReady = beaconFrameGenerator.ready();
  return beaconReady ? beaconFrameGenerator.next() : payloadFrameGenerator.next();
}
```

**Beacon frame structure:**
- A single tile carrying the beacon packet
- Uses the most conservative profile (v10-L per D17)
- Entire frame is that one tile
- Emitted periodically, independent of payload frame cycle

**Frame mixer behavior:**
- Normally passes through payload frames
- Every ~2s, emits a beacon frame instead
- Simple selection, not tile-level arbitration

## Plan updates needed

The plan is **correct** as written. The contradiction is only apparent, not real:

1. §2 and §7.2's "frame" terminology is the authoritative description
2. §6.3's diagram correctly shows parallel streams
3. §7.1's `flags` field describes packet typing at the protocol layer, but doesn't determine frame structure

**No plan changes needed** - this analysis clarifies the existing design.

## Verification against constraints

| Constraint | Beacon as Frame | Status |
|---|---|---|
| §13.1: ≤3s time-to-first-packet | First beacon at ~2s | ✓ MET |
| §7.2: conservative profile | v10-L, single tile | ✓ Explicit |
| D17: periodic emission | Every ~2s, independent cycle | ✓ Explicit |
| Throughput overhead | 3.35% (1/30 frames) | ✓ Acceptable |
| Architectural cleanliness | Frame mixer as selector | ✓ Simple |

## Related beads

- None - this is a clarification of existing design, not new work

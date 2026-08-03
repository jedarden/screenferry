# Beacon Classification: Frame vs Tile vs Packet

**Bead ID:** bf-5mq
**Date:** 2026-08-02
**Status:** RESOLVED

## Question

Is the beacon a frame or a tile? The plan.md contains apparent contradictions:

- **§2 and §7.2** call it "a special FRAME carrying file-level metadata"
- **§6.3's diagram** shows it feeding into a "frame mixer"
- **§7.1's packet header** makes it a "packet type" distinguished by flags

These suggest different sender loops, different cadence overheads, and different acquisition latency against §13.1's <=3 s time-to-first-packet budget.

## Analysis

### Evidence from plan.md

1. **§2 Glossary** (line 89): "Beacon: A special FRAME carrying file-level metadata instead of payload (D17, §7.2)."

2. **§7.2** (lines 633-651): Titled "Beacon frame (D17/D21)" - clearly calls it a "frame"

3. **§6.3 Sender Pipeline** (lines 357-379):
```
beacon (D17/D21) every ~2 s          per block: slice → K=768 fragments
filename · size · blockCount           → LT encode (d ≤ 64, D25)
blockSize · L · K · hash · flags       → header → tile
                 │                                            │
                 └──────────────► frame mixer ◄───────────────┘
```
Shows beacon feeding into a "frame mixer" alongside payload packets.

4. **§7.1 Packet Header** (lines 602-632):
```
| Offset | Size | Field | Notes |
|---|---|---|---|
| 1 | 1 | `flags` | packet type (payload/beacon), reserved |
```
Shows beacon as a **packet type** distinguished by the flags field.

### Evidence from Implementation

1. **src/core/params.ts** (lines 45-53):
```typescript
export const enum PacketFlags {
  Payload = 0x00,
  Beacon = 0x01,
  Repetition = 0x02,
  Compressed = 0x04,
  Manifest = 0x08,
}
```
Beacon is explicitly a **packet type flag**.

2. **src/core/frame/header.ts**: Standard 13-byte packet header with `flags` field.

3. **src/core/frame/beacon.ts**: Functions `parseBeacon()` and `encodeBeacon()` operate on beacon **bytes** (the packet payload).

## Resolution

**The beacon is a PACKET, not a frame or tile.**

### Architecture

```
BEACON PACKET
├─ 13-byte header with flags = PacketFlags.Beacon
└─ Beacon metadata payload (originalSize, payloadLen, blockCount, K, etc.)
    ↓ encoded into
BEACON TILE (QR symbol)
    ↓ mixed into
DISPLAY FRAME (containing beacon + payload tiles)
```

### Clarification of plan.md Terminology

The term "beacon frame" in plan.md is used in two senses:

1. **Misleading usage** (§2, §7.2): "a special FRAME carrying metadata"
   - **Should say**: "a special PACKET carrying metadata"

2. **Accurate usage** (§6.3 diagram): beacon going into "frame mixer"
   - **Correct interpretation**: beacon packets get mixed into frames

The confusion stems from plan.md using "frame" ambiguously. In networking, a "frame" is any protocol data unit. But in screenferry's architecture (§6.1), a **Frame** is specifically "one displayed image, containing a grid of tiles."

### Implementation Implications

1. **Sender loop**: Emit beacon packets periodically (~2 s), NOT separate beacon frames

2. **Frame mixer**: Combines beacon tiles and payload tiles into the same display frame

3. **Cadence overhead**: Minimal - beacon tiles replace a few payload tiles in regular frames

4. **Acquisition latency**: 
   - At 15 fps, the receiver sees 15 frames per second
   - Beacon emitted every ~2 s = ~30 frames
   - **Worst case: ~2 seconds to first beacon** (within §13.1's 3 s budget)
   - **Average case: ~1 second to first beacon** (beacon could be in any frame within the 2 s window)

### Performance Budget (§13.1)

The 3-second time-to-first-packet budget is **not violated** because:
- Packets arrive continuously once the first frame is decoded
- The "packet" in the budget refers to any decodable packet (payload OR beacon)
- At 15 fps with 15 tiles/frame = 225 packets/second
- Even if the beacon isn't in the very first frame, the receiver will have payload packets within the first few hundred milliseconds

## Recommendation

Update plan.md to clarify terminology:

1. **§2 Glossary**: Change to "Beacon: A special PACKET carrying file-level metadata instead of payload"

2. **§7.2 title**: Change from "Beacon frame" to "Beacon packet"

3. **Add explanatory note** in §6.3 clarifying that "frame mixer" mixes both beacon and payload tiles into display frames

This resolves the apparent contradiction and makes the architecture unambiguous.

# Beacon is a Packet, Not a Frame (bf-5mq)

## Task

Decide whether the beacon is a frame or a tile, given apparent inconsistencies in plan.md references.

## Analysis

### Claim in Task Description
The task description claimed:
> "§2 and §7.2 call it 'a special FRAME carrying file-level metadata instead of payload'"

### What plan.md Actually Says

**§2 Glossary (line 91):**
```
| **Beacon** | A special **packet** carrying file-level metadata instead of payload. Beacon packets are encoded into tiles and mixed into display frames by the frame mixer (D17, §7.2). |
```

**§7.2 Title (line 672):**
```
### 7.2 Beacon packet (D17/D21)
```

**§6.3 Clarification (lines 388-389):**
```
> **Beacon clarification:** The beacon is a **packet** (distinguished by `PacketFlags.Beacon` in its header), not a separate frame. The "frame mixer" shown above combines beacon tiles (QR-encoded beacon packets) with payload tiles into the same displayed frames.
```

### Consistency Check

plan.md is **fully consistent** - all references correctly identify the beacon as a **packet**:
- §2: "special **packet**"
- §7.1: flags distinguish "packet type (payload/beacon)"
- §7.2: titled "Beacon **packet**"
- §6.3: clarification explicitly states it's "a **packet**, not a separate frame"

## Decision

**The beacon is correctly classified as a packet.** The architecture is:

```
Beacon Packet (metadata)
         │
         ▼
Encoded into QR Tiles
         │
         ▼
Mixed into Display Frames (by frame mixer)
         │
         ▼
Displayed on screen
```

### Layer Hierarchy

1. **Packet** (data layer)
   - Beacon packet: carries file metadata
   - Payload packet: carries block data
   - Manifest packet: carries block hash manifest

2. **Tile** (modulation layer)
   - One QR symbol
   - Carries exactly one packet

3. **Frame** (display layer)
   - One displayed image
   - Contains grid of tiles (mix of beacon and payload tiles)

### Why This Architecture Matters

**Sender Loop Implications:**
- Beacons are emitted every ~2 seconds as packets
- They replace a few payload tiles in regular frames
- No separate "beacon frame" cadence needed
- Minimal overhead: no dedicated beacon frames

**Acquisition Latency:**
- Time-to-first-packet budget: ≤3 s (Phase 5, §13.1)
- Beacon packets arrive in mixed frames alongside payload
- Receiver can acquire metadata without waiting for a dedicated beacon cycle
- No added latency from frame-type switching

**Implementation:**
- `PacketFlags.Beacon` (0x01) distinguishes beacon from payload packets
- `encodeBeacon()` creates beacon packets
- Frame mixer includes beacon tiles in regular frames
- No special "beacon frame" logic needed

## Conclusion

The task description's premise was based on incorrect information. plan.md is consistent and correct: **the beacon is a packet** that gets encoded into tiles and mixed into frames. This architecture is properly implemented in the codebase (`src/core/frame/beacon.ts`, `src/core/params.ts`).

No plan.md changes needed. The documentation already correctly reflects the architecture.

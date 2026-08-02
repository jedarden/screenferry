# Rung Sweep R1-R4 - Kill Criterion Analysis

## Core Question

**"Does the conservative rung decode where the aggressive one fails?"**

## Answer

**No.** If R1 (conservative) fails while R3 (aggressive) works, this triggers the kill criterion because it means the ladder's fundamental design assumption is wrong.

## Why This Is the Kill Criterion

### Expected Behavior (Current Ladder Theory)

| Rung | QR Version | Packets/tile | Symbol Size | Decode Difficulty |
|---|---|---|---|---|
| R1 (conservative) | v10-L | 1 | Largest modules | **Easiest** |
| R2 (nominal) | v16-L | 2 | Medium | Medium |
| R3 (aggressive) | v20-L | 3 | Smaller modules | Harder |
| R4 (probe) | v23-L | 4 | Smallest modules | Hardest |

**Assumption:** Larger QR modules + lower density = easier to decode

### Kill Criterion Scenario

**Observation:** R1 fails, R3 works

**Why this breaks the ladder:**
1. **Destroys graceful degradation:** The conservative rung is supposed to be the "last resort" that always works
2. **Invalidates the difficulty model:** If "easier" configurations fail while "harder" ones work, our understanding of QR decode robustness is backwards
3. **Breaks the link adaptation strategy:** D16-D18 assume we can step down to more robust configurations as needed

### What "R1 Fails While R3 Works" Would Mean

Possible explanations if this occurs:
- **v10 QR version has unexpected limitations** (e.g., camera auto-focus issues, minimum size requirements)
- **1-packet-per-tile structure interacts badly** with the rendering/capture pipeline
- **Fewer tiles trigger different timing behavior** that affects camera synchronization
- **QR version and decode robustness relationship is not monotonic** as assumed

## What Happens If Kill Criterion Tripped

If S2 results show R1 ✗ while R3 ✓:

1. **Stop testing** - Do not proceed to S3/S4
2. **Document the failure mode** - Exactly what failed/succeeded
3. **Re-derive §3.1.1's rung table**:
   - Investigate why v10-L with 1 packet fails
   - Re-examine QR version selection criteria
   - Consider if L should be sized for R2 instead of R1
   - Re-evaluate the packet count progression
4. **Re-consider link adaptation strategy** (D16-D18) with new understanding

## Testing Protocol

To properly evaluate the kill criterion, S2 must test under §13.2 denominator conditions:
- **Setup:** Laptop → phone, tripod, 30 cm, ~300 lux
- **Method:** Sweep R1→R4 at fixed module px
- **Metrics:** Erasure rate, decode latency, unique packets, byte mismatches (must be 0)
- **Analysis:** Check if R1 fails while R3 works

## Status

**NOT YET TESTED** - Kill criterion analysis complete, awaiting S2 results.

## References

- plan.md §3.1.1 - Ladder design and rung table
- spike/README.md - S2 test protocol
- docs/notes/spike-results.md - Current test status

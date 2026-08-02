# Rung Sweep Analysis - bf-37px

## Task Context

This analysis addresses the S2 rung sweep test and the associated kill criterion:
> **"Does the conservative rung decode where the aggressive one fails?"**
> **Kill criterion: if R1 fails while R3 works, §3.1.1's ladder needs re-deriving.**

## Current Ladder Design (§3.1.1)

| Rung | Packets | QR Version | Capacity | Waste | Intended Use |
|---|---|---|---|---|---|
| R1 | 1 | v10-L | 271 B | 2 B | Conservative - easiest to decode |
| R2 | 2 | v16-L | 586 B | 48 B | Nominal - baseline |
| R3 | 3 | v20-L | 858 B | 51 B | Aggressive - higher density |
| R4 | 4 | v23-L | 1091 B | 15 B | Probe only - experimental |

**Key assumptions in current design:**
1. R1 is the *conservative* rung - largest QR symbols, lowest density, easiest to decode
2. R3 is the *aggressive* rung - smaller QR symbols, higher density, harder to decode
3. The ladder provides graceful degradation: as channel conditions worsen, step down to R1

## The Kill Criterion Scenario

**What "R1 fails while R3 works" means:**

The conservative rung (R1) cannot be successfully decoded, but the aggressive rung (R3) can be decoded under the same physical conditions.

**Why this invalidates the current ladder:**

### 1. Breaks the fundamental assumption

The ladder design assumes:
- Larger QR modules (v10) → easier to decode
- Lower packet density → more robust

If R1 fails while R3 works, this assumption is backwards. Something about the relationship between QR version, symbol size, and decode success is not as theorized.

### 2. Destroys the graceful degradation property

The ladder's purpose is to guarantee that *something* works even when the optimal configuration doesn't. The conservative rung is supposed to be the last resort.

If R1 (the "easy" configuration) fails while R3 (the "hard" configuration) works, the ladder no longer provides predictable fallback behavior.

### 3. Suggests a deeper misunderstanding

Potential causes if R1 fails while R3 works:
- **QR version sensitivity:** v10 may have some unexpected limitation (e.g., camera auto-focus behavior, minimum size requirements)
- **Tile count interaction:** Fewer tiles might trigger different camera/rendering behavior
- **Packet structure:** The 1-packet-per-tile structure might interact badly with some part of the pipeline
- **Timing/frequency:** Different rungs might have different timing characteristics that affect camera capture

## What Needs Re-deriving

If the kill criterion is tripped, the following elements of §3.1.1 must be reconsidered:

### 1. The QR version selection logic
- Current logic: Pick QR version to fit the packet count for each rung
- Question: Does v10 have unexpected issues that make it *harder* to decode than v20?

### 2. The packet count progression
- Current: 1, 2, 3, 4 packets per tile
- Question: Is 1 packet/tile actually the most robust? Or is there an optimal middle ground?

### 3. The "L is set by conservative rung" rule
- Current: L = 256 B ensures even R1 can carry 1 packet
- Question: If R1 doesn't work in practice, should L be sized for R2 instead?

### 4. The entire link adaptation strategy (D16-D18)
- Current assumption: Conservative → nominal → aggressive is a valid difficulty progression
- Question: If this is wrong, what is the actual relationship between QR version/packet count and decode success?

## Testing Protocol for S2

To properly test this, the rung sweep must collect:

For each rung (R1, R2, R3, R4):
- Unique packets received (out of expected)
- Erasure rate (0-1)
- Camera fps
- Decode latency (p50, p99)
- Frames with zero tiles (burst loss)
- Byte mismatches (MUST be 0)

**Physical conditions (§13.2 denominator):**
- Laptop → phone
- Tripod mounted
- 30 cm distance
- ~300 lux lighting
- 50%+ screen brightness
- Same module px per rung (vary only the rung)

## Interpretation Framework

After collecting S2 data:

| R1 | R2 | R3 | R4 | Interpretation |
|---|---|---|---|---|
| ✓ | ✓ | ✓ | ✓ | Channel excellent, ladder works |
| ✗ | ✓ | ✓ | ✓ | **Kill criterion tripped** - re-derive ladder |
| ✗ | ✗ | ✓ | ✓ | Ladder may work, but R1 needs investigation |
| ✗ | ✗ | ✗ | ✓ | Channel degraded, but aggressive works |
| ✗ | ✗ | ✗ | ✗ | Channel too degraded for any rung |

## Expected Outcomes

Based on current theory:

**Most likely:** R1 ✓, R2 ✓, R3 ✓, R4 ✗
- All practical rungs work, probe rung fails
- Ladder validation passed

**Possible:** R1 ✓, R2 ✓, R3 ✗, R4 ✗
- Aggressive rungs fail as expected
- Ladder provides good fallback

**Kill criterion:** R1 ✗, R2 ✓, R3 ✓, R4 ✓
- Conservative fails while aggressive works
- **Stop and re-derive §3.1.1**

## Next Steps

1. Run S2 with proper denominator conditions
2. Collect structured results using `spike/rung-sweep-collector.mjs`
3. Check kill criterion: if R1 fails while R3 works
4. If kill criterion tripped:
   - Document exactly what failed/succeeded
   - Investigate why v10-L with 1 packet fails while v20-L with 3 packets works
   - Re-examine the fundamental relationship between QR version and decode robustness
   - Re-derive the rung table with new understanding
5. If kill criterion not tripped:
   - Document that ladder validation passed
   - Proceed to S3 distance sweep

## Status

**NOT YET TESTED** - This analysis is theoretical pending S2 results.

Reference: spike/README.md, plan.md §3.1.1, docs/notes/spike-results.md

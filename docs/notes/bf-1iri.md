# Mixed-Size Tile Layout Algorithm

**Bead:** bf-1iri  
**Plan ref:** D16, §6.3.2

## Problem

The four ladder rungs (D18a) use different QR versions, each with a different physical size:

| Rung | QR Version | Modules | Version |
|------|------------|---------|---------|
| R1 (conservative) | v10-L | 57×57 | 10 |
| R2 (nominal) | v16-L | 81×81 | 16 |
| R3 (aggressive) | v20-L | 97×97 | 20 |
| R4 (probe only) | v23-L | 109×109 | 23 |

At a common screen px/module, these are **physically different-sized tiles**. The spike's 5×3 grid and §6.3.2's table both assume uniform tiles, which doesn't match reality.

## Solution: Grid at R1 Pitch

Allocate the frame grid at the **R1 (conservative) pitch** and let denser rungs occupy an integral number of R1 cells.

### R1 as the Grid Unit

- **R1 cell size** = v10-L tile dimensions at the chosen screen px/module
- For v10-L with 57 modules at `m` screen px/module: **cell size = 57m × 57m**
- All grid coordinates are expressed in R1 cell units

### Tile-to-Cell Mapping

| Rung | QR Version | Module Ratio | Cells Occupied |
|------|------------|--------------|----------------|
| R1 | v10-L | 57/57 = 1.0 | **1×1** (exactly one cell) |
| R2 | v16-L | 81/57 ≈ 1.42 | **2×2** (4 cells) |
| R3 | v20-L | 97/57 ≈ 1.70 | **2×2** (4 cells) |
| R4 | v23-L | 109/57 ≈ 1.91 | **2×2** (4 cells) |

**Note:** All denser rungs occupy 2×2 R1 cells. This is intentional:
- R2 (81 modules) at 2×2 cells gives ~1.42× the R1 module count — fits with margin
- R3 (97 modules) at 2×2 cells gives ~1.70× — fits with margin
- R4 (109 modules) at 2×2 cells gives ~1.91× — fits with margin

### Frame Layout Algorithm

Given a frame budget of N tiles at R2 nominal (2 packets/tile):

```
1. Allocate 60% of N tiles to R2 rung (D18a fixed weight)
2. Allocate 25% of N tiles to R3 rung (D18a fixed weight)
3. Allocate 15% of N tiles to R1 rung (D18a fixed weight)
4. Convert tile counts to cell counts:
   - R1 tiles: each occupies 1×1 cells
   - R2/R3 tiles: each occupies 2×2 cells
5. Pack cells into the grid row-major, skipping occupied cells
```

### Example: 15-Tile Frame (R2 Nominal)

Using D18a weights (15% R1, 60% R2, 25% R3):

```
R1 (conservative): 15% × 15 = 2.25 → 2 tiles × 1 cell = 2 cells
R2 (nominal):     60% × 15 = 9.0  → 9 tiles × 4 cells = 36 cells
R3 (aggressive):  25% × 15 = 3.75 → 3 tiles × 4 cells = 12 cells
Total cells needed: 50 cells
```

For a 540×960 portrait code region (§6.3.2):
- At 4 screen px/module with R1 (v10-L): cell size = 57×4 = **228×228 px**
- Grid dimensions: 540/228 ≈ **2.37 cells wide** → **2 cells** (456 px used, 84 px margin)
- Height: 960/228 ≈ **4.21 cells tall** → **4 cells** (912 px used, 48 px margin)
- **Total capacity: 2×4 = 8 cells** — insufficient for 50 cells

This reveals the **need for smaller screen px/module** or **larger code region** to fit 50 cells.

### Implications

1. **Screen px/module is the tuning knob.** The cell grid size is derived from it, and denser rungs consume more cells. To fit a target tile budget, adjust `screen px/module` downward.

2. **The grid is sparse by design.** Not all R1 cells contain a tile — the 2×2 tiles leave gaps. This is acceptable; the receiver detects tile positions independently via QR symbol boundaries.

3. **R4 (probe) tiles fit the same footprint.** R4 (109 modules) also occupies 2×2 cells at ~1.91× module density, so no special handling is needed beyond its low allocation weight.

4. **The sender must compute the grid dynamically.** Given:
   - Code region dimensions (from §6.3.2 orientation setting)
   - Target tile count (e.g., 15 for R2 nominal)
   - Rung weights (D18a: 15%, 60%, 25%)
   
   Solve for the maximum `screen px/module` that fits all tiles.

## Integration with §6.3.2

This algorithm complements §6.3.2's "shape the code region to the CAMERA" rule:

1. User selects receiver orientation (portrait/landscape) → code region shape
2. Sender computes maximum `screen px/module` that fits the tile budget at R1 cell pitch
3. Render tiles at R1 pitch, with denser rungs occupying 2×2 cells

## Open Question: Cell Alignment

Should the 2×2 tiles align to even cell boundaries (0, 2, 4, ...) or can they start at odd positions (1, 3, 5, ...)? 

**Recommendation:** Align to **even boundaries only**. This:
- Simplifies the packing algorithm
- Avoids 2×2 tiles overlapping cell boundaries
- Makes the grid predictable for the receiver's ROI crop

## Verification

Add a test to `modulation/qr-tiled/layout.test.ts`:
- Given a code region size and target tile count
- Assert that the computed `screen px/module` yields a grid with sufficient cells
- Assert that all tiles fit within the code region

## References

- Plan §3.1.1: Rung definitions and packet counts
- Plan §6.3.2: Code region sizing and camera px/module
- Plan D16: Mixed-profile ladder
- Plan D18a: Fixed ladder weights (15%, 60%, 25%)
- `docs/notes/spike-results.md`: 5×3 uniform-tile grid assumption (line 23)

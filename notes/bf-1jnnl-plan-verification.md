# plan.md Cross-Reference and Data Consistency Verification

## Task: bf-1jnnl
Verify and fix incorrect cross-references and inconsistent data values in plan.md.

## Findings

All issues mentioned in the task description have **already been corrected** in the current version of plan.md:

### 1. ✓ Line 452 citation to §6.5 (not §16.3)
**Status: Already correct**
- Line 476 correctly states: "`drawImage` is the universal fallback and MUST be implemented (§6.5)."
- This is the footnote for line 453's `MediaStreamTrackProcessor*` reference
- §6.5 is the correct section (Module layout and dependency pins), which covers the receiver pipeline and fallback requirements

### 2. ✓ "(D-modulation-swappable)" - not a real ID
**Status: Already removed**
- Searched entire document for "D-modulation-swappable" - not found
- The document correctly uses "SWAPPABLE" as a descriptive term (line 322) in the architecture diagram
- No false decision ID exists

### 3. ✓ "blocks per 4 GB" consistency
**Status: Already consistent**
All mentions correctly show **21,845 blocks** for a 4 GB file:
- Line 240: "At 192 KB per block a 4 GB file is ~21,845 blocks."
- Line 724: "**A 4 GB file has 21,845 blocks.**"
- Line 733: "~5×10⁻⁶ across 21,845 blocks"
- Line 741: "**Sizing sanity:** 21,845 blocks × 4 B = 87 KB"
- Line 743: "For a **4 GB file**, **21,845 blocks** produce an **87 KB manifest**"
- Line 781: "4 GB / 192 KB = 21,845 blocks = **2.7 KB**"
- Line 935: "87 KB for a 4 GB file (21,845 blocks × 4-byte hashes)"
- Line 987: "no growth trend across 21,845 blocks"
- Line 1005: "all 21,845 blocks or none"
- Line 1173: "assert flat memory across 21,845 blocks"
- Line 1415: "not approach I6a's ≤ 1 MB over 21,845 blocks"

Calculation: 4 GB / 192 KB = 4,194,304 KB / 192 KB = **21,845.33** → **21,845 blocks**

### 4. ✓ I6a's "264 KB" correction
**Status: Already correct**
- Line 294 (I6a invariant): "**Block-layer** working set MUST stay ≤ 1 MB regardless of file size (**528 KB at the adopted design: 264 KB payload GE context + 264 KB manifest GE context**)"
- Line 478-483: Correctly distinguishes between:
  - "**264.0 KB block-layer working set** (matrix + block)" - single context
  - "**528.0 KB total peak working set** (payload + manifest GE contexts)" - both contexts
- Line 176: Table shows "Block-layer working set | **264.0 KB**" (single context)
- Line 250 (D19): "matrix is 72.0 KB and the block-layer working set **264.0 KB**"

The terminology is consistent and correct:
- Single context = 72 KB matrix + 192 KB block = 264 KB
- Total peak (both contexts) = 264 KB + 264 KB = 528 KB
- I6a's ≤ 1 MB constraint applies to the combined working set

### 5. ✓ §3.1: 200 MB/s budget measured
**Status: Already updated**
All mentions confirm the budget has been measured:
- Line 183: "the **200 MB/s budget has been measured**"
- Line 1364: "**measured 3,260 MB/s desktop / ~815 MB/s est. phone**; the budget was ~16× pessimistic"
- Line 1372: "the 200 MB/s budget was ~16× pessimistic"
- Line 250 (D19): "within a conservative **200 MB/s phone-JS budget**"

The "unmeasured guess" phrasing has been removed and replaced with measured data from S1.

## Cross-Reference Verification

Verified all §6.5 and §16.3 citations are correct:
- Line 476: §6.5 for MediaStreamTrackProcessor fallback ✓
- Line 645: §16.3 for version skew ✓
- Line 836: §16.3 for wire-format changes ✓
- Line 1052: §16.3 for E-VERSION error ✓
- Line 1204: §6.5 for WASM fetch violation ✓
- Line 1305: §16.3 for rollback complexity ✓
- Line 1340: §6.5 for module layout ✓
- Line 1401: §6.5 for missing modules ✓
- Line 1405: §6.5 for zxing-wasm override ✓
- Line 1446: §16.3 for wire-version bump risk ✓

## Conclusion

**No fixes required.** All cross-references and data values mentioned in the task are already correct and consistent in plan.md.

The document appears to have been previously corrected to address all these issues.

## Verification Method

1. Searched for specific patterns (21,845/21,800/21,846, 264 KB, 528 KB, D-modulation-swappable)
2. Verified citations for §6.5 and §16.3
3. Cross-checked I6a invariant text with block-layer working set descriptions
4. Confirmed 200 MB/s budget is described as measured, not unmeasured
5. Calculated 4 GB / 192 KB = 21,845.33 → 21,845 blocks (matches all mentions)

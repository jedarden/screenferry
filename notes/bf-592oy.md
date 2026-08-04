# Bead bf-592oy: §7.5 base36/Crockford base32 mixing investigation

## Investigation Summary

**Date:** 2026-08-04
**Sections reviewed:** §7.5 (`streamId` derivation) and §7.6 (Repair code format)

## Findings

### No base36 references found
Comprehensive search of plan.md found **ZERO** references to "base36" encoding anywhere in the document.

### Consistent Crockford base32 usage
Both §7.5 and §7.6 consistently use **Crockford base32** encoding:

**§7.5 (line 815):**
> `streamId` is a 32-bit value internally (from CRC32). When displayed to users (e.g., in repair codes), it is encoded as **Crockford base32 (7-character)** (see §7.6). This encoding is human-typable and avoids ambiguous characters (no I/L/O/U).

**§7.6 (lines 826-827):**
> - **Alphabet:** Crockford base32 (no I/L/O/U — removes the common misreadings).
> - **`streamId32`:** 32-bit streamId encoded as Crockford base32 (7-character, padded with leading zeros if needed). A 32-bit value requires up to 7 base32 digits (2^32 < 32^7).

### Previous fixes
Git history shows commits ec2416a, c289f8c, 3ee1f69 that fixed "encoding issues" - these were phrasing consistency fixes (moving "7-character" qualifier position), not base36/base32 mixing.

### Implementation verification
Checked implementation files:
- `src/core/frame/repair-code.ts` - Uses `encodeCrockford()` and `decodeCrockford()` functions
- `src/core/frame/delta-code.ts` - Uses Crockford base32 alphabet
- Test files verify Crockford base32 encoding

## Final Verification (2026-08-04)

Comprehensive search of entire codebase confirmed:
- **plan.md**: ZERO "base36" references; only Crockford base32 used
- **Implementation code**: All encoding functions use Crockford base32 alphabet
  - `src/core/frame/repair-code.ts`: `encodeCrockford()` / `decodeCrockford()`
  - `src/core/frame/delta-code.ts`: Crockford base32 alphabet
- **Tests**: Verify Crockford base32 encoding throughout

## Conclusion

**No mixing detected.** The plan correctly and consistently specifies Crockford base32 encoding throughout §7.5 and §7.6. The bead description appears to reference an issue that either:
1. Was already fixed in earlier commits (ec2416a, c289f8c, 3ee1f69 - terminology phrasing only)
2. Was based on a misunderstanding of the actual text
3. Refers to a different issue not related to base36/base32 mixing

## Recommendation

**Accept the current text as-is.** No changes required to §7.5 or §7.6 regarding encoding scheme consistency. The current state is correct:
- §7.5: "encoded as **Crockford base32 (7-character)**"
- §7.6: "Alphabet: Crockford base32 (no I/L/O/U)"
- Implementation: Consistent Crockford base32 throughout

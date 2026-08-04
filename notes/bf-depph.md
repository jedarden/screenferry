# Bead bf-depph: Fix encoding issues and example errors

## Issues Fixed

### 1. §7.5 - Inconsistent encoding terminology
**Problem:** Section said "7-character Crockford base32" which mixes character count with encoding scheme inconsistently.

**Fix:** Changed to "encoded as Crockford base32 (7-character)" to clearly separate the encoding scheme from the length specification, matching the phrasing in §7.6.

**Before:** "encoded as **7-character Crockford base32**"
**After:** "encoded as **Crockford base32 (7-character)**"

### 2. §8.2 - Repair code example
**Problem:** Example `SF1-3M7QKP9-3B-X4` needed verification for correctness.

**Verification:** The example is correct:
- `SF1` = prefix (3 chars)
- `3M7QKP9` = streamId (7 chars, Crockford base32)
- `3B` = ranges encoding (2 chars, represents 3 missing blocks)
- `X4` = checksum (2 chars, CRC-8)

**Fix:** No change needed to the example itself, but verified consistency across §7.5, §7.6, and §8.2.

## Consistency Verification

All encoding references now use consistent terminology:
- §7.5: "Crockford base32 (7-character)"
- §7.6: "Crockford base32 (no I/L/O/U)"
- §8.2 example matches the format specified in §7.6

The encoding is consistently described as Crockford base32 with the alphabet excluding I/L/O/U characters to avoid ambiguous readings.

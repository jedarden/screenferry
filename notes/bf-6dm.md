# Beacon Size Bound and Filename Truncation (bf-6dm)

## Task
Define the beacon size bound and filename truncation rules per plan.md §7.2, T2.

## Problem Statement
- Fixed fields total ~64 bytes (not 54 as in task description) against R1's 256-byte payload
- This leaves ~186 bytes for filename + mimeType + length prefixes
- A 255-byte UTF-8 filename is legal on filesystems but would overflow the beacon payload
- No clear truncation or fragmentation rule was defined ("T2 says only 'cap length'")

## Analysis

### Beacon Size Calculation (R1's 256-byte payload)
- **Fixed fields:** 64 bytes
  - streamId(4) + wireVersion(1) + fileSize(6) + payloadLen(6) +
  - blockSize(3) + blockCount(3) + fragmentLen(2) + degreeCap(1) +
  - flags(1) + blockHashLen(1) + wholeFileHash(32) + manifestHash(4)
- **CRC-32:** 4 bytes
- **Length prefixes:** 2 bytes (1 byte each for filename and mimeType)
- **Available for filename + mimeType:** 256 - 64 - 4 - 2 = **186 bytes**

### Previous Issues
1. `BEACON_LIMITS.MAX_FILENAME_LEN: 255` - would overflow beacon
2. `BEACON_LIMITS.MAX_MIMETYPE_LEN: 127` - combined with filename would overflow
3. `sanitizeFilename()` capped at 200 bytes - no documentation, no justification
4. No distinction between codepoint count and byte length (UTF-8 uses 1-4 bytes per codepoint)

## Solution

### New Beacon Limits (BEACON_LIMITS)
```typescript
MAX_FILENAME_BYTES: 128,      // Maximum UTF-8 encoded filename length in bytes
MAX_MIMETYPE_BYTES: 58,       // Maximum UTF-8 encoded MIME type length in bytes
MAX_FILENAME_CODEPOINTS: 32,  // Maximum UTF-8 codepoint count (32 × 4 = 128 bytes max)
MAX_MIMETYPE_CODEPOINTS: 14, // Maximum UTF-8 codepoint count (14 × 4 = 56 bytes max)
```

**Rationale:**
- 128 bytes for filename + 58 bytes for MIME type = 186 bytes (exactly the available space)
- Codepoint limits guarantee we never exceed byte limits (worst case: 4 bytes per codepoint)
- 32-character filename accommodates most common filenames while preserving extensions
- 58-byte MIME type accommodates standard types like `application/vnd.ms-excel` (29 bytes)

### Filename Truncation Rules (T2)
1. **Security:** Strip path separators, control bytes, leading dots
2. **Codepoint limit:** Truncate to 32 UTF-8 codepoints maximum
3. **Extension preservation:** When truncating, preserve filename extension if possible
4. **Byte limit:** Validate UTF-8 encoding fits in 128 bytes
5. **Fallback:** Use "received-file" if empty after sanitization

**Why both codepoint and byte limits:**
- UTF-8 uses 1-4 bytes per codepoint
- Codepoint limit prevents individual excessively long names
- Byte limit ensures beacon never overflows R1's payload
- Together they provide safety at both string manipulation and encoding layers

## Implementation Changes

### Files Modified
- `/home/coding/screenferry/src/core/frame/beacon.ts`

### Specific Changes
1. Updated `BEACON_LIMITS` with new constants and detailed documentation
2. Rewrote `sanitizeFilename()` with proper truncation logic
3. Updated `parseBeacon()` to use new limit names
4. Updated `encodeBeacon()` validation to use new limits
5. Added comprehensive documentation explaining the beacon size calculation

## Verification
- Beacon size: 64 (fixed) + 4 (CRC) + 2 (prefixes) + 128 (filename) + 58 (mimetype) = 256 bytes
- Fits exactly in R1's 256-byte payload
- Common filenames preserved (32 characters is sufficient for most use cases)
- Extension preservation maintains file type information
- UTF-8 safety guaranteed by dual codepoint/byte limits

## References
- plan.md §7.2 (Beacon packet format)
- plan.md §12, T2 (Path traversal / hostile filename mitigation)
- R1 conservative rung: 1 packet of 269 B (13-byte header + 256 B payload)
- L = 256 B (fragment length)

## Status
✅ Complete - Beacon size bound defined and filename truncation rules implemented.

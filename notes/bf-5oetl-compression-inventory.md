# Compression Enablement Paths - Screenferry Codebase Inventory

**Bead**: bf-5oetl
**Date**: 2026-08-04
**Scope**: Complete inventory of all compression enablement, configuration, and control points

## Key Finding

**Implementation Status**: The compression architecture is fully designed and specified, but the **actual sender pipeline implementation is pending**. There's a TODO in `src/app.ts` line 266-267: "Sender transmission mode will be implemented in future beads."

---

## 1. Functions/Methods That Enable/Control Compression

### Beacon Flags System (`src/core/frame/beacon.ts`)
- **BeaconFlags.Compressed** (line 39): Flag indicating compression is enabled (D8)
- **BeaconFlags.ResumeDisabled** (line 46): Flag indicating resume is disabled when compression is enabled
- **isResumeDisabled()** (line 562): Checks if resume should be disabled based on beacon flags
- **encodeBeacon()** (line 592): Validates and encodes beacon with compression flags
- **parseBeacon()** (line 166): Parses beacon and validates compression/resume compatibility

### Session State Management (`src/core/session/types.ts`)
- **canResumeRecv()** (line 417): Checks if receiver state can be resumed (returns false when compression enabled)
- **createResumeToken()** (line 904): Creates resume tokens only when compression is disabled
- **restoreFromResumeToken()** (line 956): Restores session from resume token

---

## 2. Configuration Parameters Controlling Compression

### Decision Architecture (D8)
- **D8 Decision** (`docs/plan/plan.md` line 266): "Compress before blocking, to a staging file" using CompressionStream
- **Trade-off**: With compression enabled, resume is NOT supported (§8.3)
- **Algorithm**: Native CompressionStream with deflate-raw format

### Packet Flags (`src/core/params.ts`)
- **PacketFlags.Compressed** (line 94): `0x04` flag indicating payload was compressed (D8)
- **Compression conditional**: When set, resume is disabled (§8.3)

### Metadata Fields (`src/core/session/types.ts`)
- **originalSize** (line 69): Original uncompressed file size (6 bytes, 48-bit)
- **payloadLen** (line 70): Actual payload length after compression if enabled (6 bytes, 48-bit)

---

## 3. Places Where Compression Is Activated

### Sender Pipeline (Designed, Not Yet Implemented)
- **Pipeline** (`docs/plan/plan.md` line 364): `File → [sample: compressible?] → CompressionStream → OPFS staging`
- **Decision Point**: Sample-based compressibility detection (D8)
- **Fallback**: Straight through if not compressible (sample ratio > 0.92)

### Beacon Construction (`src/core/frame/beacon.ts` lines 620-636)
- **Validation**: Throws `E-COMPRESSION-RESUME-CONFLICT` if compression enabled without resume disabled
- **Code**:
```typescript
const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;
if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError('E-COMPRESSION-RESUME-CONFLICT', ...);
}
```

---

## 4. Conditional Logic for Compression Decisions

### Quota Calculation Logic (`src/core/io/quota-preflight.ts`)
- **calculateRequiredSpace()** (line 109): Calculates storage needs based on compression status
- **Logic**:
```typescript
if (!compressionEnabled) {
  return isSender ? 0 : originalSize; // No compression
}
// Compression enabled:
return isSender ? payloadLen : originalSize + payloadLen;
```

### Compressibility Detection (Designed)
- **Decision** (`docs/plan/plan.md` line 364): Sample first, if sample ratio > 0.92, skip compression
- **Fallback**: If compression still expands, discard staging and send raw

### Resume/Compression Conflict Resolution
- **Logic** (`src/core/frame/beacon.ts` lines 562-564): Compression forces resume disabled
- **Reason**: Re-compression after staging reaping (E11) may produce different bytes → different block boundaries

---

## 5. Supporting Infrastructure

### Storage Management (`src/platform/storage.ts`)
- **calculateCompressionStagingBuffer()** (line 254): Calculates staging buffer size (15% overhead + 10MB)
- **checkStorageCapacity()** (line 277): Pre-flight quota validation

### Error Handling
- **Error Code**: `E-COMPRESSION-RESUME-CONFLICT` (beacon.ts line 624)
- **Partial Artefact Type**: `DECOMPRESS_FAILED` (partial-warning-dialog.ts)

### Block Scheduling (`src/core/block/schedule.ts`)
- **Comment** (line 74): "The sender is stateless across restarts when compression is disabled"

---

## 6. Test Coverage

Extensive test coverage for compression scenarios:
- `test/compression-determinism.test.ts`
- `test/compression-resume-regression.test.ts`
- `test/compression-sender-restart.test.ts`
- `test/compression-silent-state-prevention.test.ts`
- `test/bf-4bi6-compression-resume-conflict.test.ts`

---

## Summary

The screenferry codebase has a **complete compression architecture** with:
- ✅ Well-defined decision points (D8)
- ✅ Comprehensive flag system (BeaconFlags.Compressed, BeaconFlags.ResumeDisabled)
- ✅ Proper conflict handling (compression vs. resume)
- ✅ Storage quota calculations
- ✅ Extensive test coverage

However, the **actual compression implementation using CompressionStream is not yet built** - it's designed and specified in the plan but marked as future implementation. The system is architected to use native browser CompressionStream with deflate-raw algorithm, with conditional enabling based on file compressibility sampling.

---

## Next Steps for Related Beads

1. **Search for resume enablement paths**: Use this inventory as a baseline to compare against resume paths
2. **Identify conflict points**: The `E-COMPRESSION-RESUME-CONFLICT` validation is the primary conflict resolution
3. **Trace execution paths**: Map how both features could theoretically be enabled simultaneously (and why validation prevents this)

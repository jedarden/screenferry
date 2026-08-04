# BeaconMeta Decode Path Visibility Analysis

## Task
Analyze which BeaconMeta construction sites are visible from the decode path.

**Bead:** bf-4n2ps  
**Date:** 2026-08-04  
**Scope:** `/src` directory

---

## Decode Path Execution Flow

### Current Receiver Path

```
Camera frames
  ↓
CameraPipeline (camera-pipeline.ts)
  ↓
QR Decode Workers (qr-decode.worker.ts)
  ↓
DecodedFrameResult.packets[] (Uint8Array[])
  ↓
❌ NO FURTHER PROCESSING
```

### Packet Processing Status

**CRITICAL FINDING:** The decode path is **INCOMPLETE**.

1. **QR Decode Workers** successfully extract raw packets as `Uint8Array[]`
2. Packets are returned in `DecodedFrameResult` objects
3. **No code exists to parse these packets** into `BeaconMeta` objects
4. The path stops at raw bytes - no beacon parsing, no metadata extraction

### Evidence

```bash
# parseBeacon is defined but NEVER called
$ grep -rn "parseBeacon" src/ --include="*.ts"
src/core/frame/beacon.ts:166:export function parseBeacon(
src/core/frame/beacon.ts:171:): BeaconMeta {

# Only beacon imports are constants and utilities
$ grep -rn "import.*beacon" src/ --include="*.ts"
src/core/io/quota-preflight.ts:14:import {BEACON_LIMITS} from '../frame/beacon.js';
src/core/session/types.ts:902:import {isResumeDisabled} from '../frame/beacon.js';
```

**No file imports `parseBeacon` or `BeaconMeta` type for parsing purposes.**

---

## BeaconMeta Construction Sites (from bf-20ec0 Catalog)

### 1. parseBeacon Return Value
- **File:** `src/core/frame/beacon.ts`
- **Function:** `parseBeacon`
- **Lines:** 466-481
- **Construction Type:** Object literal return from parsing function
- **Purpose:** Parses beacon bytes and constructs BeaconMeta object
- **Validation:** Full CRC-32 validation and bounds checking before construction

```typescript
return {
  streamId,
  wireVersion,
  originalSize,
  payloadLen,
  blockSize,
  blockCount,
  fragmentLen,
  degreeCap,
  flags,
  blockHashLen,
  wholeFileHash,
  manifestHash,
  filename,
  mimeType,
};
```

**DECODE PATH VISIBILITY:** ❌ **NOT REACHABLE**

This function is defined but **never called** in the current codebase. The decode path extracts raw packets but does not invoke `parseBeacon()` to construct BeaconMeta objects.

---

## Type Definitions (Reference Only)

### 1. Primary Definition
- **File:** `src/core/frame/beacon.ts`
- **Line:** 54
- **Context:** Interface definition
- **DECODE PATH VISIBILITY:** ⚪ **TYPE ONLY** (not a construction site)

### 2. Session Types Definition
- **File:** `src/core/session/types.ts`
- **Line:** 66
- **Context:** Interface definition (duplicate/re-export)
- **DECODE PATH VISIBILITY:** ⚪ **TYPE ONLY** (not a construction site)

---

## Summary

### Construction Sites Reachable from Decode Path: **0 (ZERO)**

The catalog identifies exactly **one** BeaconMeta construction site in the entire codebase:

**`parseBeacon()` in `src/core/frame/beacon.ts` (lines 466-481)**

However, this construction site is **NOT reachable from the decode path** because:

1. The function is **never called** anywhere in the codebase
2. No code exists to invoke `parseBeacon()` on decoded packets
3. The decode path stops at raw `Uint8Array[]` packets
4. No metadata extraction or beacon parsing occurs

### Catalog Entry Markings

| Site | File | Lines | Decode-Visible | Status |
|------|------|-------|-----------------|--------|
| parseBeacon return | beacon.ts | 466-481 | ❌ NO | Defined but unreachable |
| Type definition | beacon.ts | 54 | ⚪ TYPE | Interface only |
| Type definition | types.ts | 66 | ⚪ TYPE | Interface only |

### Conclusion

The BeaconMeta construction catalog shows **one actual construction site**, but **zero** are visible from the decode path in the current implementation. The receiver decode pipeline extracts raw packets but lacks the beacon parsing layer that would construct BeaconMeta objects.

This suggests:
- The decode path is **incomplete** or **work-in-progress**
- `parseBeacon()` was written for a future implementation phase
- Current code may use alternative metadata handling (not visible in this analysis)
- Test code or future plans may exist that aren't in the main receiver flow

---

## Recommendations

For the decode path to become functional, the implementation needs:

1. **Packet classification logic** to distinguish beacon packets from payload packets
2. **Beacon packet extraction** from decoded QR frames
3. **Call to `parseBeacon()`** to construct BeaconMeta from beacon bytes
4. **Metadata storage** for use in validation and session management

The `parseBeacon()` function is ready and fully validated—it just needs to be invoked.

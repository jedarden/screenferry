# BeaconMeta Construction Sites Catalog

## Overview
This document catalogs all construction sites for `BeaconMeta` objects in the screenferry codebase.

**Bead:** bf-20ec0  
**Date:** 2026-08-04  
**Scope:** `/src` directory

---

## Type Definitions

### 1. Primary Definition
- **File:** `src/core/frame/beacon.ts`
- **Line:** 54
- **Context:** Interface definition
- **Decode-Path Visibility:** ⚪ **TYPE ONLY** (not a construction site)
```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number; // Original uncompressed file size
  payloadLen: number; // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number; // L
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array; // 32 bytes
  manifestHash: Uint8Array; // 4 bytes - CRC-32 of manifest
  filename: string;
  mimeType: string;
}
```

### 2. Session Types Definition
- **File:** `src/core/session/types.ts`
- **Line:** 66
- **Context:** Interface definition (duplicate/re-export)
- **Decode-Path Visibility:** ⚪ **TYPE ONLY** (not a construction site)
```typescript
export interface BeaconMeta {
  streamId: number;
  wireVersion: number;
  originalSize: number; // Original uncompressed file size
  payloadLen: number; // Actual payload length (after compression if enabled)
  blockSize: number;
  blockCount: number;
  fragmentLen: number;
  degreeCap: number;
  flags: number;
  blockHashLen: number;
  wholeFileHash: Uint8Array;
  manifestHash: Uint8Array; // 4 bytes - CRC-32 of manifest
  filename: string;
  mimeType: string;
}
```

---

## Construction Sites

### 1. parseBeacon Return Value
- **File:** `src/core/frame/beacon.ts`
- **Function:** `parseBeacon`
- **Lines:** 466-481
- **Context:** Parses beacon bytes and constructs BeaconMeta object
- **Decode-Path Visibility:** ❌ **NOT REACHABLE** - Function is never called in current codebase

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

**Construction Type:** Object literal return from parsing function
**Purpose:** Represents beacon metadata decoded from received QR code
**Validation:** Full CRC-32 validation and bounds checking before construction
**Status:** Defined but unreachable - decode path extracts raw packets but doesn't invoke parseBeacon()

---

## Usage Sites (Consumption)

### encodeBeacon Function
- **File:** `src/core/frame/beacon.ts`
- **Function:** `encodeBeacon`
- **Line:** 613
- **Purpose:** Serializes BeaconMeta into bytes for transmission
- **Note:** This is a usage site, not a construction site

### ResumeToken References
- **File:** `src/core/session/types.ts`
- **Lines:** 793 (CompleteState), 252 (DecompressFailedState), 921, 933 (createResumeToken)
- **Context:** BeaconMeta is embedded in resume tokens and session states
- **Note:** These are references to existing BeaconMeta objects, not construction sites

### Resume Validation
- **File:** `src/core/resume/resume-validator.ts`
- **Lines:** 137-145 (required field validation)
- **Context:** Validates BeaconMeta structure within resume tokens
- **Note:** Validation only, no construction

---

## Summary

**Total Type Definitions:** 2
**Total Construction Sites:** 1
**Total Usage/Reference Sites:** 5+

### Key Finding
The `BeaconMeta` interface has two identical type definitions (likely due to module boundaries), and only **one actual construction site** in the codebase:

**`parseBeacon()` in `src/core/frame/beacon.ts` (lines 466-481)**

### Decode-Path Visibility (bf-4n2ps analysis)
**Construction Sites Reachable from Decode Path: 0 (ZERO)**

The single construction site (`parseBeacon()`) is **NOT reachable from the decode path** because:
1. The function is **never called** anywhere in the codebase
2. No code exists to invoke `parseBeacon()` on decoded packets
3. The decode path stops at raw `Uint8Array[]` packets
4. No metadata extraction or beacon parsing occurs

All other references are either:
- Type definitions/interfaces
- Usage sites (encodeBeacon consuming BeaconMeta)
- References to existing BeaconMeta objects (session states, resume tokens)

This indicates that:
- `BeaconMeta` objects are primarily created by parsing incoming beacon data from QR codes
- The decode path is **incomplete** - it extracts packets but doesn't parse them
- `parseBeacon()` is written and validated but not yet integrated into the receiver flow
- Sender-side construction would involve creating a BeaconMeta object and passing it to `encodeBeacon()`, but this pattern is not currently used in the codebase

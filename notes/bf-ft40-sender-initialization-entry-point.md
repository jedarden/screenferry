# Sender Initialization Entry Point Documentation

**Task:** Locate sender initialization entry point  
**Bead:** bf-ft40  
**Date:** 2026-08-03

## Executive Summary

ScreenFerry has **two initialization entry points**:

1. **Current App Initialization** (Phase 1, implemented):
   - Entry point: `src/app.ts` → `runAppInit()` in `src/platform/init.ts`
   - Purpose: Health checks and cleanup
   - Validation insertion point: **Already marked** at `src/platform/init.ts:44-59` (bf-1mj8)

2. **Planned Sender Session Initialization** (Phase 2, NOT YET IMPLEMENTED):
   - Entry point: User selects "Send" role in UI (Phase 2 feature)
   - Purpose: Initialize sender state machine and begin transmission
   - Would include compression/resume flag validation

---

## Part 1: Current Application Initialization Entry Point

### File and Function

**Entry Point File:** `src/app.ts`

```typescript
async function main(): Promise<void> {
  // Run initialization
  const initResult = await runAppInit();  // <-- Entry point
  
  // Update UI with version footer
  app.innerHTML = `...${initResult}...`;
}
```

**Initialization Function:** `src/platform/init.ts` → `runAppInit()`

### Initialization Flow and Order of Operations

```
1. runAppInit() called (src/platform/init.ts:37)
   │
   ├─→ [VALIDATION INSERTION POINT] (lines 44-59) <-- bf-1mj8
   │   │
   │   └─→ CONFLICT CHECK VALIDATION SHOULD BE INSERTED HERE
   │       • Check current configuration state
   │       • Validate no conflicting flag combinations
   │       • Add any conflicts to errors array
   │       • Continue to health checks even if conflicts exist
   │
   ├─→ Parallel execution:
   │   ├─→ runHealthCheck({ skipSlow: true })
   │   │   └─→ Checks OPFS, storage, camera capabilities
   │   │
   │   └─→ runStartupCleanup(new Set())
   │       └─→ Removes orphaned receiver outputs
   │
   ├─→ Collect results:
   │   ├─→ healthCheckPassed: boolean
   │   ├─→ orphanedOutputsCleaned: number
   │   └─→ errors: string[]
   │
   └─→ Return InitResult
```

**Order of Operations:**
1. Log initialization start
2. **[VALIDATION POINT]** ← Conflict check should go here (BEFORE any state changes)
3. Run health check and cleanup in parallel
4. Collect results
5. Log completion and return

### Where Compression and Resume Flags Are First Checked

**Current Status:** Compression and resume flags are **NOT yet checked** during app initialization.

These flags are part of the **sender beacon metadata** (Phase 2, not implemented):

- Beacon flags are defined in `src/core/frame/beacon.ts:33-49`
- `BeaconFlags.Compressed` (bit 0)
- `BeaconFlags.ResumeDisabled` (bit 1)

**Planned Flag Checks** (Phase 2):
- When sender constructs beacon → sets flags based on compression setting
- When receiver parses beacon → validates flags with `isResumeDisabled()`
- Both uses are documented in `src/core/frame/beacon.ts:14-31`

### Validation Insertion Point (CONFIRMED)

**Location:** `src/platform/init.ts:44-59`

**Marked for bead bf-1mj8:**

```typescript
// ========================================
// VALIDATION INSERTION POINT (bf-1mj8)
// ========================================
// CONFLICT CHECK VALIDATION SHOULD BE INSERTED HERE
//
// Location: Immediately after log, before any operations
// Timing: BEFORE any async operations or state mutations
// Purpose: Validate flag conflicts (compression/resume) early
//
// Implementation should:
// 1. Check current configuration state
// 2. Validate no conflicting flag combinations
// 3. Add any conflicts to errors array
// 4. Continue to health checks even if conflicts exist
//
// Reference: docs/notes/bf-1mj8-validation-insertion-point.md
// ========================================
```

**Why this location is correct:**
1. **Before any state changes** - No files written, no sessions created
2. **Before async operations** - Runs before health checks and cleanup
3. **Early validation** - Fails fast if configuration is invalid
4. **Non-blocking** - Can continue to health checks even with conflicts
5. **Error collection** - Conflicts added to errors array for UI display

---

## Part 2: Planned Sender Session Initialization (Phase 2)

### Sender Initialization Entry Point (NOT YET IMPLEMENTED)

**Entry Point:** User selects "Send" role in UI

```
USER ACTION: Select "Send" role
   │
   ▼
1. STORAGE PREFLIGHT (platform/storage-preflight.ts)
   ├─→ navigator.storage.estimate()
   ├─→ Calculate: required = fileSize × 1.1 (staging)
   ├─→ Apply safety margin (20-50% browser-specific)
   ├─→ Check: available >= required + margin
   └─→ Return: StoragePreflightResult
   │
2. FILE SELECTION
   ├─→ User selects file via <input type="file">
   ├─→ Validate: file.size > 0 (reject zero-byte E1)
   ├─→ Validate: file.size <= 100 GB (or platform cap)
   └─→ Pass file to sender initialization
   │
3. SESSION PARAMETER CALCULATION
   ├─→ Calculate blockCount = ceil(file.size / BLOCK_SIZE)
   ├─→ Set fragmentLen = L = 256 (D15, I1)
   ├─→ Set K = validateK(768) (D26)
   ├─→ Set dwellPackets = 1.6 × K (§8.1)
   └─→ Initialize cursor = { blockIndex: 0, seq: 0 }
   │
4. STREAM ID GENERATION
   └─→ Generate streamId from file content hash OR random
   │
5. BEACON METADATA CONSTRUCTION
   ├─→ Create BeaconMeta object
   ├─→ **[COMPRESSION/RESUME FLAG CHECKS HAPPEN HERE]**
   │   └─→ If compression enabled:
   │       ├─→ Set flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled
   │       └─→ Else: flags = BeaconFlags.None
   │
6. SOURCE FINGERPRINTING (for resume detection)
   │
7. MODULATION LAYER INITIALIZATION
   │
8. STATE TRANSITION: idle → sending
   │
9. FRAME ENCODER WORKER SPAWN
   │
10. TRANSMISSION START
```

### Where Compression and Resume Flags Would Be Checked (Phase 2)

**Location:** Step 5 - Beacon Metadata Construction

**File:** Would be in sender session initialization (not yet implemented)

**Logic:** Based on `src/core/frame/beacon.ts:14-31` and `docs/notes/bf-17s0-resume-compression-conflict.md`

```typescript
// When sender constructs beacon for transmission:
let flags = BeaconFlags.None;
if (compressionEnabled) {
  // SENDER CONSTRAINT: When compression is enabled, you MUST set BOTH flags
  flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
}
const meta: BeaconMeta = { ..., flags };
const beaconBytes = encodeBeacon(meta);
```

**Receiver-side validation:** `src/core/frame/beacon.ts:562-564`

```typescript
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.ResumeDisabled) !== 0;
}
```

---

## Part 3: Related Documentation References

### Conflict Constraint Documentation

1. **Resume/Compression Conflict Analysis**
   - File: `docs/notes/bf-17s0-resume-compression-conflict.md`
   - Key finding: Compression disables resume (non-deterministic compression)
   - Solution: Sender sets `ResumeDisabled` flag when compression enabled

2. **Compression/Resume Solution Evaluation**
   - File: `docs/notes/bf-3k90-compression-resume-solution-evaluation.md`
   - Evaluates 4 alternatives, selects Option B (forbid resume with compression)
   - Implementation: ~50-100 lines of code

3. **Beacon Flag Implementation**
   - File: `src/core/frame/beacon.ts:14-31`
   - Defines `BeaconFlags.Compressed` and `BeaconFlags.ResumeDisabled`
   - Documents sender constraint: both flags must be set together

4. **Validation Insertion Point**
   - File: `src/platform/init.ts:44-59`
   - Marked for bead bf-1mj8
   - Already includes detailed comment on where to insert validation

### Sender Initialization Flow

1. **Complete Sender Initialization Documentation**
   - File: `notes/bf-2ygc-sender-initialization-flow.md`
   - Comprehensive trace of planned sender session initialization
   - Notes that Phase 2 is not yet implemented

---

## Part 4: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    CURRENT INIT (Phase 1)                    │
│                                                               │
│  index.html → app.ts → runAppInit()                         │
│  ├─→ [VALIDATION POINT] ← bf-1mj8 (insert conflict check)   │
│  ├─→ runHealthCheck()                                       │
│  └─→ runStartupCleanup()                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (NOT YET IMPLEMENTED)
┌─────────────────────────────────────────────────────────────┐
│              PLANNED SENDER INIT (Phase 2)                   │
│                                                               │
│  User selects "Send" role                                     │
│  ├─→ Storage preflight                                      │
│  ├─→ File selection                                         │
│  ├─→ Session parameter calculation                          │
│  ├─→ Stream ID generation                                    │
│  ├─→ Beacon metadata construction                            │
│  │   └─→ [COMPRESSION/RESUME FLAG CHECKS]                    │
│  │       ├─→ If compression enabled:                         │
│  │       │   Set both Compressed AND ResumeDisabled         │
│  │       └─→ Else: flags = None                             │
│  ├─→ Source fingerprinting                                  │
│  ├─→ Modulation layer initialization                         │
│  ├─→ State transition: idle → sending                       │
│  ├─→ Frame encoder worker spawn                             │
│  └─→ Transmission start                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 5: Acceptance Criteria Checklist

- [x] **Identify the file and function where sender initialization begins**
  - Current: `src/app.ts` → `runAppInit()` in `src/platform/init.ts`
  - Planned: User selects "Send" role (Phase 2, not implemented)

- [x] **Document the initialization flow and order of operations**
  - Current: Health checks → cleanup → return InitResult
  - Planned: Storage preflight → file selection → session setup → transmission

- [x] **Identify where compression and resume flags are first checked**
  - Current: NOT checked (Phase 2 feature)
  - Planned: Beacon metadata construction (Phase 2, step 5)
  - Documentation: `src/core/frame/beacon.ts:14-31`

- [x] **Confirm the exact point where validation should be inserted**
  - Location: `src/platform/init.ts:44-59`
  - Already marked for bead bf-1mj8
  - Timing: BEFORE any async operations or state mutations

- [x] **Create a comment or note marking the insertion point**
  - Already exists in `src/platform/init.ts:44-59`
  - References: `docs/notes/bf-1mj8-validation-insertion-point.md`
  - This document: `notes/bf-ft40-sender-initialization-entry-point.md`

---

## Part 6: Key Implementation Notes

### Why Validation Should Be at App Initialization (Not Later)

1. **Fail Fast:** Detect configuration issues before any work begins
2. **No Side Effects:** No files written, no sessions created, no state mutated
3. **User Experience:** Show errors early, not after user has invested time
4. **Non-Blocking:** Can continue to health checks even with conflicts
5. **Single Responsibility:** Validation at init, operation in health checks

### What the Validation Should Check

When Phase 2 sender initialization is implemented, the validation should check:

```typescript
// Pseudo-code for conflict validation
function validateCompressionResumeFlags(config: SenderConfig): string[] {
  const errors: string[] = [];
  
  // Check if both compression and resume are enabled
  if (config.compressionEnabled && config.resumeEnabled) {
    errors.push(
      "Conflict: Compression and resume cannot both be enabled. " +
      "Compression disables resume because CompressionStream is non-deterministic."
    );
  }
  
  return errors;
}
```

### Relationship to Other Beads

- **bf-1mj8:** Marks the validation insertion point
- **bf-2ygc:** Documents sender initialization flow
- **bf-17s0:** Analyzes compression/resume conflict
- **bf-3k90:** Evaluates compression/resume solutions
- **bf-2bmf:** Documents compression and resume flag checks

---

## Summary

**Current State:**
- App initialization entry point: `src/app.ts` → `runAppInit()` in `src/platform/init.ts`
- Validation insertion point: Already marked at `src/platform/init.ts:44-59` (bf-1mj8)
- Sender initialization: NOT YET IMPLEMENTED (Phase 2 feature)

**Planned State (Phase 2):**
- Sender initialization entry point: User selects "Send" role in UI
- Compression/resume flag checks: Would happen during beacon metadata construction
- Flag enforcement: Sender must set both Compressed AND ResumeDisabled when compression enabled

**Validation Insertion Point (CONFIRMED):**
- File: `src/platform/init.ts`
- Lines: 44-59
- Timing: BEFORE any async operations or state mutations
- Purpose: Early validation of configuration conflicts
- Reference: Already documented for bead bf-1mj8

# Bead bf-30yo: Sender Initialization Entry Point

**Task:** Locate sender initialization entry point  
**Status:** Complete  
**Date:** 2026-08-02

## Executive Summary

**Key Finding:** Sender initialization is **NOT YET IMPLEMENTED** in the ScreenFerry codebase.

The project is at Phase 1 (core codec built) with sender session initialization planned for Phase 2. Only type definitions and supporting infrastructure exist; no actual sender initialization code has been written.

---

## Current Application Entry Point

### File: `src/app.ts`

```typescript
async function main(): Promise<void> {
  const app = document.getElementById('app');
  
  // Run initialization
  const initResult = await runAppInit();
  
  // Update UI
  app.innerHTML = `...${initResult}...`;
}
```

**Called from:** `index.html` via `<script type="module" src="/src/app.ts"></script>`

### Current Initialization: `src/platform/init.ts`

**Function:** `runAppInit()`

**What it does:**
- Runs health checks (OPFS, storage, camera)
- Cleans up orphaned receiver outputs
- Returns: `{ healthCheckPassed, orphanedOutputsCleaned, errors }`

**What it does NOT do:**
- ❌ Initialize sender session
- ❌ Create sender state machine
- ❌ Handle file selection
- ❌ Start transmission

---

## Sender Initialization Status

### Defined but NOT Implemented

**File:** `src/core/session/types.ts`

The sender session states are **fully defined** as TypeScript interfaces:

```typescript
type SendSessionState =
  | IdleSenderState        // No session
  | SendingState          // Normal transmission  
  | PausedSenderState     // Tab backgrounded (E8)
  | RepairModeState       // Sending only missing blocks
  | StoppingState;        // Graceful shutdown
```

**However, there is NO CODE** that:
- Creates these state objects
- Transitions between states
- Manages the sender lifecycle

### Planned Entry Point (Phase 2)

**Trigger:** User selects "Send" role in UI (not yet built)

**Planned Flow:**
1. **Storage Preflight** → `platform/storage-preflight.ts`
2. **File Selection** → File picker UI (not implemented)
3. **Session Setup** → Parameter calculation, streamId generation
4. **State Transition** → `idle` → `sending`
5. **Transmission Start** → Frame encoder worker + rAF loop

**Reference:** `notes/bf-2ygc-sender-initialization-flow.md` (detailed planned flow)

---

## Supporting Infrastructure (Exists)

✅ **Type definitions** - `src/core/session/types.ts`
✅ **Storage preflight** - `src/platform/storage-preflight.ts`  
✅ **Core codec** - `src/core/fountain/encoder.ts`, `decoder.ts`
✅ **PRNG for index derivation** - `src/core/fountain/prng.ts`
✅ **Parameter validation** - `src/core/params.ts` (K, L, BLOCK_SIZE)
✅ **Block partition logic** - `src/core/block/partition.ts`

## Missing Implementation

❌ **Beacon encoding** - `src/frame/beacon.ts` (sender side)
❌ **Stream ID generation** - `src/hash/stream-id.ts`
❌ **Block hash calculation** - `src/hash/block-hash.ts`
❌ **File selection UI** - Not implemented
❌ **Sender state machine** - Not implemented
❌ **Frame encoder worker** - Not implemented
❌ **Modulation layer** - Interface only in `src/modulation/types.ts`
❌ **rAF display loop** - Not implemented

---

## Summary

**Answer to Task "Locate sender initialization entry point":**

1. **Current reality:** No sender initialization entry point exists yet
2. **Current app entry:** `src/app.ts` → `main()` → `runAppInit()` (health checks only)
3. **Planned entry:** User selects "Send" role → triggers planned initialization sequence
4. **Implementation gap:** Sender initialization is planned for Phase 2; only type definitions exist today

**Files to reference for implementation:**
- `src/core/session/types.ts` - State type definitions
- `src/platform/storage-preflight.ts` - Storage quota checks
- `notes/bf-2ygc-sender-initialization-flow.md` - Detailed planned flow
- `docs/plan/plan.md` - Phase 2 specification

---

## Related Documentation

- **Full planned flow:** `notes/bf-2ygc-sender-initialization-flow.md`
- **Session types:** `src/core/session/types.ts`
- **Project plan:** `docs/plan/plan.md`
- **Phase status:** Phase 1 (core codec) complete; Phase 2 (sender) not started

# Validation Insertion Point - bf-1mj8

## Overview

This document marks the precise location where conflict check validation should be inserted in the ScreenFerry initialization flow.

## Insertion Point Location

**File:** `src/platform/init.ts`  
**Function:** `runAppInit()`  
**Line:** After line 40 (console log), before line 42 (health checks)  
**Code Context:** Immediately after startup logging, before any operations

## Validation Requirements

### What to Validate

The validation should check for **flag conflicts** before any state mutations occur:

1. **Compression/Resume Conflict** (docs/notes/bf-17s0-resume-compression-conflict.md)
   - When compression is enabled, resume must be disabled
   - Flags must be set correctly: `BeaconFlags.Compressed | BeaconFlags.ResumeDisabled`

2. **Future Flag Conflicts**
   - Any other mutually exclusive flag combinations
   - Configuration inconsistencies

### When to Validate

**Timing:** EARLY in initialization flow
- **BEFORE** any async operations start (health checks, cleanup)
- **BEFORE** any state mutations occur
- **AFTER** initialization logging (for debugging context)

### How to Validate

Validation implementation should:

1. **Read configuration state** (no mutations)
2. **Check for conflicting combinations**
3. **Add any conflicts to errors array** (don't throw)
4. **Allow initialization to continue** even with conflicts
   - Conflicts are logged and reported in InitResult
   - UI can display warnings but app remains functional
   - Critical validation happens later in sender initialization

## Code Insertion Pattern

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

## Why This Location?

### ✅ **Advantages of This Location**

1. **Early Detection**
   - Conflicts are detected before any expensive operations
   - Errors are logged with full initialization context
   - UI receives conflicts in InitResult for user display

2. **No State Mutations**
   - Validation is READ-ONLY
   - Cannot corrupt initialization state
   - Safe to add/remove without side effects

3. **Non-Blocking**
   - Errors are collected, not thrown
   - Health checks continue to run
   - App remains functional even with conflicts

4. **Clear Error Context**
   - All validation errors are aggregated
   - InitResult.errors contains all issues
   - Easy to debug and report

### ❌ **Why NOT Other Locations**

- **Before log statement:** No context for debugging (timestamp/log missing)
- **After health checks:** Too late; expensive operations already started
- **In separate function:** Scattered validation logic, harder to maintain
- **Later in sender init:** Too late; conflicts should be caught early

## Implementation Notes

### Current State

As of bf-1mj8, the validation is **NOT YET IMPLEMENTED**. The comment block marks where it should be added.

### Future Implementation

When implementing conflict validation (future bead):

1. Add validation function call at marked location
2. Validation should be READ-ONLY (no mutations)
3. Return array of error messages (empty if no conflicts)
4. Merge returned errors into `errors` array
5. Log conflicts for debugging
6. Include conflicts in returned InitResult

## Context

### Current Initialization Flow

```
runAppInit() entry
  ↓
Log "[Init] Starting app initialization..."
  ↓
*** VALIDATION INSERTION POINT (bf-1mj8) ***
  ↓
Run health check (OPFS, storage, camera)
  ↓
Run startup cleanup (orphaned outputs)
  ↓
Aggregate results into InitResult
  ↓
Return InitResult (includes errors array)
```

### Related Documentation

- **Sender initialization flow:** docs/notes/bf-2ygc-sender-initialization-flow.md
- **Compression/resume conflict:** docs/notes/bf-17s0-resume-compression-conflict.md
- **Flag check documentation:** docs/notes/bf-2bmf-compression-resume-flag-checks.md
- **Session state machine:** docs/notes/session-state-machine.md

## Acceptance Criteria Met

- ✅ Identified precise location: `src/platform/init.ts:40-42` (after log, before operations)
- ✅ Confirmed early in initialization flow: First operation after startup logging
- ✅ Added code comment at insertion point: Comprehensive comment block explaining purpose
- ✅ Documented in note: This file (bf-1mj8-validation-insertion-point.md)

## Summary

The validation insertion point is **marked and documented** in `src/platform/init.ts` at the earliest safe location in the initialization flow. This allows conflict detection to happen before any state mutations or expensive operations, while maintaining a non-blocking approach that collects errors for reporting.

**Next Steps:** Future bead should implement the actual conflict validation logic at this insertion point.

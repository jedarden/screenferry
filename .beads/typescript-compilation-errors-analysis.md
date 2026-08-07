# TypeScript Compilation Errors Analysis

**Generated:** 2026-08-07  
**Command:** `npx tsc --noEmit`  
**Total Errors:** 701  
**Workspace:** /home/coding/screenferry

## Executive Summary

The TypeScript compiler found **701 errors** across the codebase. These errors fall into several distinct categories that require systematic resolution:

- **Strict null checks** (~40%): "Object is possibly 'undefined'" / "Type 'undefined' is not assignable"
- **Exact optional properties** (~25%): Issues with `exactOptionalPropertyTypes: true`
- **Type mismatches** (~15%): Type incompatibilities and missing properties
- **Private property access** (~5%): Accessing private class members from tests
- **Module/Import issues** (~5%): Missing exports and incorrect imports
- **API signature changes** (~5%): Outdated test code using incorrect method signatures
- **Other issues** (~5%): Various miscellaneous type errors

---

## Error Categories by Type

### 1. Null/Undefined Safety (TS2532, TS18048, TS2345) - ~280 errors

**Pattern:** Objects that could be `undefined` are not being guarded before access.

#### Most Affected Files:
- `test/stub-camera.test.ts` - 13 errors
- `test/cleanup-logging.test.ts` - 25+ errors
- `test/bf-5mcz-orphan-scanner.test.ts` - 29 errors
- `test/error-codes-livelock.test.ts` - 15+ errors
- `src/platform/stall-detector.ts` - 13 errors

**Example:**
```typescript
// Error TS2532: Object is possibly 'undefined'
src/core/block/data-verification.ts(270,28): error TS2532: Object is possibly 'undefined'.
src/platform/camera-pipeline.ts(370,42): error TS2532: Object is possibly 'undefined'.
```

**Fix Pattern:**
```typescript
// Before (error)
const value = someObject.nestedProperty;

// After (fixed)
const value = someObject?.nestedProperty;
// OR
if (someObject?.nestedProperty !== undefined) {
  const value = someObject.nestedProperty;
}
```

---

### 2. Exact Optional Property Types (TS2375, TS2379) - ~175 errors

**Pattern:** TypeScript's `exactOptionalPropertyTypes: true` setting prevents passing `undefined` where an optional property is expected. This is a stricter check that catches real bugs.

#### Most Affected Files:
- `src/core/block/decode-pipeline.ts` - 5 errors
- `src/core/block/encode-pipeline.ts` - 4 errors
- `src/core/io/quota-preflight.ts` - 8 errors
- `src/platform/health-check.ts` - 11 errors
- `src/platform/sender-delta-ui.ts` - 4 errors
- `src/platform/stall-detector.ts` - 1 error
- `test/roundtrip-integration.test.ts` - 1 error
- `test/cleanup-logging-helpers.test.ts` - 2 errors

**Example:**
```typescript
// Error TS2375: Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true'
src/core/sender/delta-mode.ts(129,3): error TS2412: Type 'undefined' is not assignable to type 'string'
src/platform/receiver-delta-ui.ts(181,5): error TS2375: Type 'undefined' is not assignable to type 'string'
```

**Fix Pattern:**
```typescript
// Before (error)
const result: { name?: string } = { name: undefined };

// After (fixed)
const result: { name?: string } = { };
// OR
const result: { name?: string } = { name: undefined as string | undefined };
```

---

### 3. Type Mismatches & Missing Properties (TS2322, TS2345, TS2741) - ~105 errors

**Pattern:** Types are incompatible or required properties are missing.

#### Most Affected Files:
- `src/platform/camera-pipeline.ts` - 5 errors
- `src/platform/storage.ts` - 6 errors
- `test/storage-capacity.test.ts` - 31 errors
- `test/setup.ts` - 13 errors
- `test/roundtrip-integration.test.ts` - 31 errors

**Examples:**
```typescript
// Error TS2322: Type 'X' is not assignable to type 'Y'
src/platform/camera-pipeline.ts(141,7): error TS2322: Type '"1080p" | CaptureResolution' is not assignable to type 'CaptureResolution'

// Error TS2741: Property 'X' is missing
test/compression-resume-regression.test.ts(218,11): error TS2741: Property 'manifestHash' is missing
test/storage-capacity.test.ts(44,9): error TS2741: Property 'getDirectory' is missing
```

---

### 4. Private Property Access (TS2341) - ~35 errors

**Pattern:** Tests trying to access private class members.

#### Affected Files:
- `test/bf-2qgx-large-scale-sequencing.test.ts` - 6 errors
- `test/decode-integration.test.ts` - 2 errors
- `src/platform/transmitter.ts` - 6 errors

**Example:**
```typescript
// Error TS2341: Property 'pivMask' is private and only accessible within class 'GEDecoder'
test/bf-2qgx-large-scale-sequencing.test.ts(134,23): error TS2341: Property 'pivMask' is private
```

**Fix Pattern:**
```typescript
// Option 1: Make property public (if it needs to be tested)
public pivMask: number;

// Option 2: Add a getter method
getPivMask() { return this.pivMask; }

// Option 3: Use a test-specific helper
// test helper that accesses via prototype
(testInstance as any).pivMask
```

---

### 5. Module/Export Issues (TS2305, TS2307, TS2459, TS2304) - ~25 errors

**Pattern:** Missing exports, incorrect imports, or undefined symbols.

#### Affected Files:
- `test/fixtures/simple-fountain-fixtures.ts` - 2 errors
- `test/bf-4d6-hash-verification.test.ts` - 1 error
- `src/workers/qr-decode-pool.test.ts` - 2 errors
- `src/workers/qr-decode.worker.ts` - 1 error
- `test/helpers/cleanup-logging-helpers.ts` - 32 errors

**Examples:**
```typescript
// Error TS2305: Module has no exported member
test/bf-4d6-hash-verification.test.ts(9,3): error TS2305: Module '"../src/core/resume/resume-validator.js"' has no exported member 'verifyBlockHashesOnResume'

// Error TS2307: Cannot find module
test/fixtures/simple-fountain-fixtures.ts(17,27): error TS2307: Cannot find module '../src/core/fountain/encoder.js'

// Error TS2459: Module declares type locally but not exported
src/workers/qr-decode-pool.ts(21,15): error TS2459: Module '"./qr-decode.worker.js"' declares 'DecodeResponse' locally, but it is not exported.
```

---

### 6. API Signature Changes - ~30 errors

**Pattern:** Tests using outdated API signatures.

#### Affected Files:
- `test/block-bitmap.test.ts` - Missing `beforeEach`
- `test/network-assertion.test.ts` - XMLHttpRequest override issues
- `test/phase4-large-file.test.ts` - Function signature changes

**Examples:**
```typescript
// Error TS2304: Cannot find name 'beforeEach'
test/block-bitmap.test.ts(261,5): error TS2304: Cannot find name 'beforeEach'

// Error TS2554: Expected N arguments, but got M
test/bf-5z6wa-cleanup-error-logging.test.ts(269,12): error TS2554: Expected 1 arguments, but got 0.
```

---

### 7. Property Does Not Exist (TS2339) - ~40 errors

**Pattern:** Accessing properties that don't exist on a type.

#### Most Affected Files:
- `test/compression-resume-regression.test.ts` - 16 errors (`previousState`, `pauseReason`, etc.)
- `test/compression-resume.test.ts` - 12 errors (`previousState`)
- `src/platform/aim-reticle.ts` - 4 errors (`criticalThreshold`, `warningThreshold`)
- `src/modulation/qr-tiled/tiled-qr.ts` - 1 error (`readBarcodes`)
- `src/platform/camera-pipeline.ts` - 2 errors (`width`, `height` on VideoFrame)

**Examples:**
```typescript
// Error TS2339: Property 'previousState' does not exist
test/compression-resume.test.ts(390,20): error TS2339: Property 'previousState' does not exist on type 'RecvSessionState'

// Error TS2339: Property 'criticalThreshold' does not exist
src/platform/aim-reticle.ts(96,10): error TS2551: Property 'criticalThreshold' does not exist on type 'AimReticle'

// Error TS2339: Property 'readBarcodes' does not exist
src/modulation/qr-tiled/tiled-qr.ts(252,13): error TS2339: Property 'readBarcodes' does not exist on type 'typeof import("...")'
```

---

### 8. Uninitialized Property Errors (TS2564, TS2565) - ~15 errors

**Pattern:** Class properties declared without initialization.

#### Affected Files:
- `src/platform/camera-receiver-ui.ts` - 7 properties
- `src/platform/sender-splash-ui.ts` - 4 properties
- `src/platform/file-list-ui.ts` - 3 properties

**Example:**
```typescript
// Error TS2564: Property 'video' has no initializer
src/platform/camera-receiver-ui.ts(57,11): error TS2564: Property 'video' has no initializer and is not definitely assigned in the constructor
```

---

## Top 20 Files with Most Errors

| Rank | File | Error Count |
|------|------|-------------|
| 1 | `test/roundtrip-integration.test.ts` | 31 |
| 2 | `test/storage-capacity.test.ts` | 31 |
| 3 | `test/bf-5mcz-orphan-scanner.test.ts` | 29 |
| 4 | `test/cleanup-logging.test.ts` | 25+ |
| 5 | `test/compression-resume-regression.test.ts` | 21 |
| 6 | `test/helpers/cleanup-logging-helpers.ts` | 32 |
| 7 | `test/stream-id.test.ts` | 28 |
| 8 | `test/error-codes-livelock.test.ts` | 15+ |
| 9 | `test/phase4-large-file.test.ts` | 13 |
| 10 | `src/platform/stall-detector.ts` | 13 |
| 11 | `test/stub-camera.test.ts` | 13 |
| 12 | `test/compression-resume.test.ts` | 12 |
| 13 | `src/platform/camera-receiver-ui.ts` | 12 |
| 14 | `test/setup.ts` | 13 |
| 15 | `test/synthetic-schema.test.ts` | 12 |
| 16 | `test/compression-silent-state-prevention.test.ts` | 11 |
| 17 | `test/interrupted-resume-integration.test.ts` | 10 |
| 18 | `test/delta-resume.test.ts` | 14 |
| 19 | `test/params.test.ts` | 11 |
| 20 | `test/data-verification.test.ts` | 20+ |

---

## Error Distribution by Directory

| Directory | Error Count |
|-----------|-------------|
| `test/` | ~620 |
| `src/platform/` | ~45 |
| `src/core/` | ~20 |
| `src/workers/` | ~6 |
| `src/modulation/` | ~2 |
| **Total** | **~693** (est.) |

---

## Critical Issues Requiring Immediate Attention

### 1. Missing API in zxing-wasm
```
src/modulation/qr-tiled/tiled-qr.ts(252,13): error TS2339: Property 'readBarcodes' does not exist
src/workers/qr-decode.worker.ts(23,10): error TS2305: Module '"zxing-wasm/reader"' has no exported member 'readBarcodes'
```
**Impact:** QR code decoding functionality is broken.  
**Action:** Update to use the correct zxing-wasm API or pin a compatible version.

### 2. Missing Export: verifyBlockHashesOnResume
```
test/bf-4d6-hash-verification.test.ts(9,3): error TS2305: Module has no exported member 'verifyBlockHashesOnResume'
```
**Impact:** Hash verification tests cannot run.  
**Action:** Export the function from `resume-validator.ts`.

### 3. Missing beforeEach Import
```
test/block-bitmap.test.ts(261,5): error TS2304: Cannot find name 'beforeEach'
```
**Impact:** Tests cannot run.  
**Action:** Add `import { beforeEach } from 'vitest'`.

### 4. Const Assertions Missing
```
src/platform/navigation-guard.ts(45,13): error TS2322: Type '"keep"' is not assignable to type 'PartialArtefactAction'
```
**Impact:** Type narrowing fails.  
**Action:** Use `as const` assertions on literal types.

---

## Recommended Fix Strategy

### Phase 1: Critical Blockers (Priority: P0)
1. Fix zxing-wasm API usage
2. Export missing functions
3. Fix missing imports (beforeEach, fail, etc.)

### Phase 2: Type System Fixes (Priority: P1)
1. Add null guards where needed (`obj?.prop`, `if (obj !== undefined)`)
2. Fix exact optional properties (remove explicit `undefined` assignments)
3. Update type assertions and const usage

### Phase 3: Test Infrastructure (Priority: P2)
1. Fix MockFile vs File type issues
2. Update test setup and helpers
3. Fix test double/mock type definitions

### Phase 4: Code Cleanup (Priority: P3)
1. Remove unused properties
2. Fix private property access in tests
3. Update to consistent API patterns

---

## Quick Reference: Common Fixes

### Null Safety
```typescript
// Pattern: Add optional chaining
obj.prop → obj?.prop

// Pattern: Add type guard
if (obj !== undefined) { obj.prop }
```

### Exact Optionals
```typescript
// Pattern: Omit explicit undefined
{ prop: undefined } → {}
{ prop: value ?? undefined } → { prop: value }
```

### Type Assertions
```typescript
// Pattern: Use 'as const' for literals
const action = "keep" as const;
const actions = ["keep", "delete", "cancel"] as const;
```

---

## Notes for Resolution

- The error log has been saved to `.beads/tsc-errors.log`
- Each error should be addressed in the order of priority above
- Some errors may be cascade effects from a single root cause
- Consider temporarily disabling `exactOptionalPropertyTypes` if it causes too much friction
- Update type definitions for test doubles (MockFile, etc.) to match real types

---

**Next Steps:**
1. Address P0 issues first
2. Run `npx tsc --noEmit` after each fix to verify progress
3. Consider creating a tsconfig override for test files if needed

# TypeScript Array Access Errors in ge-benchmark.ts

## Summary

Analysis of 3 TypeScript errors at lines 959, 980, and 981 in `src/platform/ge-benchmark.ts`.

All three errors stem from TypeScript's strict null checking and its inability to verify runtime invariants in low-level array manipulation code.

---

## Error 1: Line 959

### Location
```typescript
mask[idx[i]! >>> 5] ^= 1 << (idx[i]! & 31);
```

### Error Message
`Object is possibly 'undefined'`

### Root Cause

**TypeScript's Concern:** When accessing `mask[index]`, TypeScript considers that the result might be `undefined` (which can happen for out-of-bounds access on typed arrays).

**Context:**
- `mask` is `Uint32Array(MASKW)` where `MASKW = Math.ceil(K / 32)` (line 869)
- `idx` is `Int32Array(K)` (line 937)
- Loop: `for (let i = 0; i < d; i++)` (line 954)
- `d = degree()` returns value from 1 to `min(cap, K)` where `cap ≤ K` (lines 899-919)
- `idx[i]` contains values from 0 to K-1 (Fisher-Yates shuffle)
- Therefore: `idx[i]! >>> 5` is in range `[0, floor((K-1)/32)]`
- And: `MASKW = ceil(K/32)`, so `floor((K-1)/32) ≤ MASKW - 1`

**Why TypeScript Doesn't Understand:**
The relationship `idx[i]! >>> 5 ≤ MASKW - 1` requires mathematical reasoning about:
1. The degree sampler's range (1 to K)
2. The Fisher-Yates shuffle's invariant (all values are valid indices)
3. The right-shift's relationship to `MASKW`

TypeScript's control flow analysis doesn't track these mathematical invariants.

### Safest Fix Strategy

**Option A: Non-null assertion on the array access (Minimal, Recommended)**
```typescript
mask[idx[i]! >>> 5]! ^= 1 << (idx[i]! & 31);
```
Add `!` after the array access to assert the result is not undefined. This is safe because the index is guaranteed to be in bounds.

**Option B: Type guard with explicit bounds check (Defensive, Overkill)**
```typescript
const maskIdx = idx[i]! >>> 5;
if (maskIdx < mask.length) {
  mask[maskIdx] ^= 1 << (idx[i]! & 31);
}
```
This is unnecessarily defensive since the bounds are guaranteed by construction.

**Option C: Cast to non-nullable type (Verbose)**
```typescript
(mask[idx[i]! >>> 5] as number) ^= 1 << (idx[i]! & 31);
```

**Recommendation:** Use Option A. The non-null assertion is appropriate here because we mathematically guarantee the index is valid, and adding a runtime check would slow down this hot loop in benchmark code.

---

## Error 2: Line 980

### Location
```typescript
for (let i = 0; i <= w; i++) mask[i] ^= pm[i]!;
```

### Error Message
`Object is possibly 'undefined'` (on `pm[i]!`)

### Root Cause

**TypeScript's Concern:** `pm` is typed as `Uint32Array | null`, and after casting with `as`, TypeScript still isn't fully convinced that `pm[i]` is defined.

**Context:**
- `pivMask` is `Array(K).fill(null)` (line 931)
- Later assigned: `pivMask[p] = mask.slice()` (line 974)
- `pm = pivMask[p] as Uint32Array | null` (line 971)
- `pm` is checked: `if (pm === null) { ... }` (lines 972-977)
- After null check, `pm` is non-null
- `mask.slice()` creates a `Uint32Array` copy
- Loop: `for (let i = 0; i <= w; i++)` where `w < MASKW`

**Why TypeScript Doesn't Understand:**
After the null check (`if (pm === null)`), TypeScript should narrow `pm` to `Uint32Array`. However:
1. The `as Uint32Array | null` cast (line 971) confuses the type narrowing
2. The `!` non-null assertion on `pm[i]` suggests TypeScript still sees it as possibly undefined
3. The issue is that the cast combined with array access doesn't fully narrow the type

**Additional Issue - Loop Bounds:**
The loop goes `i <= w`, but `pm` has length `MASKW`. Since `w = MASKW - 1` initially (line 964) and only decreases (line 966), `w < MASKW` is guaranteed. However, the initial value `w = MASKW - 1` means the loop goes to `i = MASKW - 1`, which is the last valid index. The loop condition should likely be `i < w` not `i <= w`, or `w` is being used incorrectly.

Actually, looking at line 968: `const bit = 31 - Math.clz32(mask[w]!);`. If `w` is the index of a non-zero word, and we're XORing up to and including that word, then `i <= w` is correct.

### Safest Fix Strategy

**Option A: Improve null check with explicit type narrowing (Recommended)**
```typescript
const pm = pivMask[p];
if (pm == null) {
  // new pivot
  pivMask[p] = mask.slice();
  pivPay[p] = pay.slice();
  rank++;
  break;
}
// pm is now narrowed to Uint32Array
for (let i = 0; i <= w; i++) mask[i] ^= pm[i];
```
Remove the `as` cast and let TypeScript's null narrowing work naturally. Remove the `!` because TypeScript now knows `pm` is non-null and `pm[i]` is within bounds.

**Option B: Keep current structure but add non-null assertion**
```typescript
const pm = pivMask[p] as Uint32Array | null;
if (pm === null) {
  // ...
}
// pm is still Uint32Array | null to TypeScript after the cast
const pmNonNull = pm!; // Explicit non-null assertion
for (let i = 0; i <= w; i++) mask[i] ^= pmNonNull[i];
```

**Option C: Type assertion on the array access**
```typescript
for (let i = 0; i <= w; i++) mask[i] ^= (pm[i]! as number);
```

**Recommendation:** Use Option A. The `as` cast is interfering with TypeScript's type narrowing. By removing it and using `pm == null` (which checks for both null and undefined), TypeScript will properly narrow the type.

---

## Error 3: Line 981

### Location
```typescript
for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i]!;
```

### Error Message
`Object is possibly 'undefined'` (on `pp[i]!`)

### Root Cause

**TypeScript's Concern:** `pp` is typed as `Uint32Array`, but accessing `pp[i]` might return `undefined` if `i` is out of bounds.

**Context:**
- `pivPay` is `Array(K).fill(null)` (line 932)
- Later assigned: `pivPay[p] = pay.slice()` (line 975)
- `pp = pivPay[p] as Uint32Array` (line 979)
- `pay.slice()` creates a `Uint32Array` copy
- Loop: `for (let i = 0; i < PAYW; i++)`
- `PAYW = Math.ceil(L / 4)` (line 870)

**Why TypeScript Doesn't Understand:**
1. The `as Uint32Array` cast doesn't guarantee that `pp[i]` is defined
2. Typed arrays can return `undefined` for out-of-bounds access
3. TypeScript doesn't track that `pay.slice()` creates a Uint32Array of length `PAYW`

**The Relationship:** `pivPay[p]` is assigned from `pay.slice()`, which has length `PAYW`. The loop iterates `i < PAYW`, so all accesses are in bounds. However, TypeScript doesn't track this relationship.

### Safest Fix Strategy

**Option A: Remove the non-null assertion and rely on type narrowing (Recommended if Error 2 is fixed with Option A)**
```typescript
const pp = pivPay[p];
if (pp == null) {
  // Should never happen since pivMask and pivPay are set together
  throw new Error('Inconsistent pivot state');
}
// pp is now Uint32Array
for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i];
```

**Option B: Keep non-null assertion but add it to the cast (Minimal change)**
```typescript
const pp = pivPay[p] as Uint32Array; // or pivPay[p]! as Uint32Array
for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i]!;
```

**Option C: Add explicit non-null assertion on array access**
```typescript
const pp = pivPay[p]!;
for (let i = 0; i < PAYW; i++) pay[i] ^= (pp[i] as number);
```

**Recommendation:** Use Option A combined with Error 2's Option A. By removing the `as` cast and checking for null/undefined, TypeScript naturally narrows the type, and the non-null assertion on `pp[i]` becomes unnecessary.

---

## Combined Fix Strategy

### Recommended Approach: Improve Type Narrowing

The safest and cleanest fix is to improve the type narrowing by:
1. Removing the `as Uint32Array | null` cast that's interfering with narrowing
2. Using `== null` check to catch both null and undefined
3. Letting TypeScript naturally narrow the types

### Proposed Code Change

```typescript
// Lines 971-982 (after fix)
const pm = pivMask[p]; // Remove cast
if (pm == null) { // Use == null to catch both null and undefined
  // new pivot
  pivMask[p] = mask.slice();
  pivPay[p] = pay.slice();
  rank++;
  break;
}
// pm and pp are now narrowed to Uint32Array by TypeScript
const pp = pivPay[p]; // Remove cast
for (let i = 0; i <= w; i++) mask[i] ^= pm[i]; // Remove !
for (let i = 0; i < PAYW; i++) pay[i] ^= pp[i]; // Remove !
```

### For Line 959

```typescript
// Line 959 (after fix)
mask[idx[i]! >>> 5]! ^= 1 << (idx[i]! & 31);
// Add ! after array access to assert result is not undefined
```

Or alternatively, to be more explicit:

```typescript
const maskIdx = idx[i]! >>> 5;
mask[maskIdx] = (mask[maskIdx]! ^ (1 << (idx[i]! & 31))) >>> 0;
```

---

## Implementation Plan

### Bead 1: Fix array access errors
- Remove interfering `as` casts on lines 971 and 979
- Change `if (pm === null)` to `if (pm == null)` for better narrowing
- Remove non-null assertions on `pm[i]!` and `pp[i]!` (no longer needed)
- Add non-null assertion to `mask[idx[i]! >>> 5]` on line 959
- Verify all three errors are resolved
- Run tests to ensure no behavior change

### Testing Strategy
- Run TypeScript compiler to verify no errors
- Run existing tests: `npm test -- block-bitmap.test.ts` (if applicable)
- Run ge-benchmark tests: `npm test -- ge-benchmark.test.ts`
- Verify benchmark produces same results as before (numeric stability)

---

## Why These Errors Exist

The root cause is that this is **low-level bit manipulation code** ported from a reference implementation (spike/ge-bench.mjs). Such code often:

1. Uses mathematical invariants that TypeScript can't verify (e.g., degree sampling always returns valid indices)
2. Performs XOR operations on packed bit representations
3. Relies on relationships between array sizes and loop bounds that aren't explicitly tracked

The use of `pivMask` and `pivPay` as `Array(K).fill(null)` is also unusual—it's a sparse array representation where:
- Index = pivot bit position (0 to K-1)
- Value = Uint32Array mask and payload for that pivot
- Most entries remain null until that pivot is discovered

This pattern works at runtime but complicates TypeScript's type checking because:
- TypeScript sees `(null | Uint32Array)[]`
- The cast to `Uint32Array | null` per element doesn't help narrowing
- The sparse nature means many accesses would return undefined if we didn't carefully guard them

---

## Alternative Architectural Fix

For a more type-safe solution, consider replacing the sparse arrays with a Map:

```typescript
const pivMask = new Map<number, Uint32Array>();
const pivPay = new Map<number, Uint32Array>();

// Later:
const pm = pivMask.get(p);
if (pm === undefined) {
  pivMask.set(p, mask.slice());
  pivPay.set(p, pay.slice());
  rank++;
  break;
}
// pm is now Uint32Array (not undefined)
const pp = pivPay.get(p)!; // Safe because we set them together
```

This would:
- Make the types explicit (Map.get returns `V | undefined`)
- Improve type narrowing
- Eliminate the sparse array confusion

However, this is a larger refactoring and may have performance implications for hot benchmark loops. The minimal fix (improved type narrowing) is recommended for now.

# Chained Property Access Violations - exactOptionalPropertyTypes Audit

## Summary
This audit identifies all chained property access violations related to `exactOptionalPropertyTypes` in the codebase. With `exactOptionalPropertyTypes: true` enabled in tsconfig.json, chained property access on method return values requires explicit type checks.

---

## Pattern 1: `getBlockGeometry().blockCount`

### Files and Lines:
- `test/decode-integration.test.ts:447` - `const blockCount = pipeline.getBlockGeometry().blockCount;`
- `test/decode-integration.test.ts:533` - `const blockCount = pipeline.getBlockGeometry().blockCount;`
- `test/decode-integration.test.ts:715` - `const blockCount = pipeline.getBlockGeometry().blockCount;`

### Method Signature:
```typescript
// src/core/block/decode-pipeline.ts:451
getBlockGeometry(): BlockGeometry {
  return { ...this.blockGeom };
}
```

### Type Definition:
```typescript
// src/core/block/partition.ts:12
export interface BlockGeometry {
  blockCount: number;
  blockSize: number;
  totalLen: number;
  fragmentLen: number;
  k: number;
}
```

### Violation Type:
Direct property access on method return value without null/undefined check.

---

## Pattern 2: `getState().blocksDecoded`

### Files and Lines:
- `test/bf-17sw5-encode-decode-roundtrip.test.ts:117` - `const blocksDecoded = decodePipeline.getState().blocksDecoded;`
- `test/roundtrip-integration.test.ts:177` - `const blocksDecoded = decodePipeline.getState().blocksDecoded;`
- `test/roundtrip-integration.test.ts:752` - `expect(decodePipeline.getState().blocksDecoded).toBe(0);`

### Method Signature:
```typescript
// src/core/block/decode-pipeline.ts:405
getState(): DecodePipelineState {
  return {
    totalBlocks: this.blockGeom.blockCount,
    blocksDecoded: this.blocksDecoded,
    packetsReceived: this.packetsReceived,
    uniquePackets: this.storage.size(),
    running: this.running,
    storageStats: this.storage.getStats(),
    bytesReassembled: this.blocksDecoded * BLOCK,
  };
}
```

### Type Definition:
```typescript
// src/core/block/decode-pipeline.ts:54
export interface DecodePipelineState {
  totalBlocks: number;
  blocksDecoded: number;
  packetsReceived: number;
  uniquePackets: number;
  running: boolean;
  storageStats: DecodeStorageStats;
  bytesReassembled: number;
}
```

### Violation Type:
Direct property access on method return value without null/undefined check.

---

## Pattern 3: `getState().packetsReceived`

### Files and Lines:
- `test/roundtrip-integration.test.ts:753` - `expect(decodePipeline.getState().packetsReceived).toBe(0);`

### Method Signature:
Same as Pattern 2 above.

### Violation Type:
Direct property access on method return value without null/undefined check.

---

## Pattern 4: `getCursor().blockIndex`

### Files and Lines:
- `test/block-schedule.test.ts:124` - `expect(scheduler.getCursor().blockIndex).toBe(9);`
- `test/block-schedule.test.ts:301` - `expect(scheduler.getCursor().blockIndex).toBe(5);`

### Method Signature:
```typescript
// From BlockScheduler interface (inferred from usage)
getCursor(): BlockCursor {
  // Returns cursor with blockIndex property
}
```

### Type Definition:
```typescript
// Referenced in src/core/block/encode-pipeline.ts:58
export interface BlockCursor {
  blockIndex: number;
  offset: number;
  // ... other properties
}
```

### Violation Type:
Direct property access on method return value without null/undefined check.

---

## Pattern 5: `getStorage().size()`

### Files and Lines:
- `test/decode-integration.test.ts:605` - `expect(pipeline.getStorage().size()).toBe(0);`

### Method Signature:
```typescript
// Inferred from DecodePipeline implementation
getStorage(): BlockStorage {
  return this.storage;
}
```

### Violation Type:
Chained method call on method return value without null/undefined check.

---

## Categorization by Type

| Pattern | Count | Files | Lines |
|---------|-------|-------|-------|
| `getBlockGeometry().blockCount` | 3 | decode-integration.test.ts | 447, 533, 715 |
| `getState().blocksDecoded` | 3 | bf-17sw5-encode-decode-roundtrip.test.ts, roundtrip-integration.test.ts | 117, 177, 752 |
| `getState().packetsReceived` | 1 | roundtrip-integration.test.ts | 753 |
| `getCursor().blockIndex` | 2 | block-schedule.test.ts | 124, 301 |
| `getStorage().size()` | 1 | decode-integration.test.ts | 605 |
| **TOTAL** | **10** | **4 files** | **10 locations** |

---

## Files Requiring Fixes

1. `test/decode-integration.test.ts` - 4 violations
2. `test/roundtrip-integration.test.ts` - 3 violations
3. `test/block-schedule.test.ts` - 2 violations
4. `test/bf-17sw5-encode-decode-roundtrip.test.ts` - 1 violation

---

## Recommended Fix Pattern

Instead of:
```typescript
const blockCount = pipeline.getBlockGeometry().blockCount;
```

Use:
```typescript
const geom = pipeline.getBlockGeometry();
const blockCount = geom.blockCount;
```

Or for inline usage:
```typescript
expect(decodePipeline.getState().blocksDecoded).toBe(0);
```

Should become:
```typescript
const state = decodePipeline.getState();
expect(state.blocksDecoded).toBe(0);
```

This separates the method call from property access, making the code compatible with `exactOptionalPropertyTypes`.

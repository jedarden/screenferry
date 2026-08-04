# bf-5mcz: Orphan File Scanner

## Summary

The orphan file scanner implementation was already complete in `src/platform/storage.ts`. The `scanOrphanedFiles` method (lines 562-617) implements all required functionality.

## Implementation Details

### Method: `scanOrphanedFiles(activeStreamIds: Set<number>): Promise<OrphanedFile[]>`

**Location:** `src/platform/storage.ts` lines 562-617

**Features:**
- Async/await for non-blocking scanning
- Iterates through OPFS directory for `.meta.json` files
- Checks each file against orphan detection criteria:
  - `isInactive`: File's streamId is not in active stream IDs
  - `isOld`: File age exceeds `maxOrphanAge` threshold
- Returns structured `OrphanedFile[]` array with:
  - All `OutputArtefact` fields (streamId, filename, mimeType, size, createdAt, path)
  - Orphan-specific fields (age, reason, isInactive, isOld)
- Handles errors gracefully:
  - Corrupted metadata files are logged but don't stop scanning
  - Storage access errors return empty array instead of throwing

### Orphan Detection Criteria

A file is orphaned if BOTH conditions are true:
1. `isInactive` - NOT in active stream IDs set
2. `isOld` - Age > `maxOrphanAge` (default 24 hours)

## Tests

All 16 tests in `test/bf-5mcz-orphan-scanner.test.ts` pass:
- ✅ Empty array when no files exist
- ✅ Active files not marked as orphans
- ✅ Recent inactive files not marked as orphans
- ✅ Old inactive files marked as orphans
- ✅ Multiple orphans included in result
- ✅ Corrupted metadata handled gracefully
- ✅ Complete metadata returned
- ✅ Age calculated correctly
- ✅ Inactive vs old conditions distinguished
- ✅ OrphanedFile interface extends OutputArtefact
- ✅ Storage access errors return empty array
- ✅ Scanning continues after individual file errors
- ✅ Empty activeStreamIds set handled
- ✅ Large activeStreamIds set handled
- ✅ Stream ID of 0 handled
- ✅ Integration with cleanupOrphanedOutputs

## Verification

```bash
npm test -- bf-5mcz-orphan-scanner.test.ts
# Test Files  1 passed (1)
# Tests       16 passed (16)
```

# bf-5mcz: Orphan File Scanner Implementation

## Summary

Implemented orphan file scanner functionality for screenferry to identify orphaned receiver output files with detailed metadata.

## Implementation

### 1. Added OrphanedFile Interface
- Extended `OutputArtefact` with orphan-specific fields
- Added `age`: age of the file in milliseconds
- Added `reason`: human-readable reason for orphaning
- Added `isInactive`: whether file is not in active stream IDs
- Added `isOld`: whether file exceeds maximum age threshold

### 2. Implemented scanOrphanedFiles() Method
- Added new method to `StorageManager` interface
- Implemented in `OPFSStorageManager` class
- Returns array of `OrphanedFile` with detailed metadata
- Non-blocking async/await implementation
- Handles errors gracefully:
  - Corrupted metadata files are logged and skipped
  - Storage access errors return empty array instead of throwing
  - Individual file errors don't stop scanning process

### 3. Orphan Detection Criteria
A file is considered orphaned if BOTH conditions are met:
1. **Inactive**: The streamId is not in the activeStreamIds set
2. **Old**: The file age exceeds maxOrphanAge (default 24 hours)

The reason field combines both conditions when they apply.

### 4. Test Infrastructure
- Fixed missing `values()` async iterator in `MockFileSystemDirectoryHandle`
- Created comprehensive test suite with 16 test cases covering:
  - Empty storage scanning
  - Active files (not orphans)
  - Recent inactive files (not orphans)
  - Old inactive files (orphans)
  - Multiple orphans
  - Corrupted metadata handling
  - Complete metadata validation
  - Age calculation accuracy
  - Condition distinction (inactive vs old)
  - Error handling scenarios
  - Edge cases (empty sets, large sets, zero stream IDs)
  - Integration with cleanup functionality

## Files Modified

1. **src/platform/storage.ts**
   - Added `OrphanedFile` interface
   - Added `scanOrphanedFiles()` method to `StorageManager` interface
   - Implemented `scanOrphanedFiles()` in `OPFSStorageManager` class

2. **test/setup.ts**
   - Fixed `MockFileSystemDirectoryHandle` by adding `values()` async iterator

3. **test/bf-5mcz-orphan-scanner.test.ts**
   - Created comprehensive test suite for orphan scanner functionality

## Test Results

All 16 tests passing:
- ✓ scanOrphanedFiles functionality (6 tests)
- ✓ OrphanedFile interface validation (1 test)
- ✓ Error handling (2 tests)
- ✓ Edge cases (3 tests)
- ✓ Integration testing (4 tests)

## Usage Example

```typescript
const storage = getStorageManager();
const activeStreamIds = new Set<number>([1, 2, 3]);
const orphans = await storage.scanOrphanedFiles(activeStreamIds);

for (const orphan of orphans) {
  console.log(`Orphaned: ${orphan.filename}`);
  console.log(`  Age: ${Math.round(orphan.age / 1000 / 60)} minutes`);
  console.log(`  Reason: ${orphan.reason}`);
  console.log(`  Stream ID: ${orphan.streamId}`);
}
```

## Key Features

✅ Non-blocking async/await implementation
✅ Leverages existing orphan detection criteria
✅ Returns structured list with file metadata
✅ Handles errors gracefully (corrupted metadata, inaccessible files)
✅ Comprehensive unit test coverage
✅ Integration with existing cleanup functionality

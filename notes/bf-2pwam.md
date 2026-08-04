# Synthetic Data Structure Schema (bf-2pwam)

## Summary

The synthetic data structure schema for encode→decode validation has been **fully implemented and tested** in `/home/coding/screenferry/src/core/block/synthetic-test-schema.ts`.

## Implementation Status

### ✅ All Acceptance Criteria Met

1. **Structure schema documented in code comments**
   - Comprehensive JSDoc comments throughout the file
   - Clear documentation of schema design principles
   - Usage examples provided in function comments

2. **TypeScript type definitions exist for sequence data**
   - `SyntheticBlock` - Individual block with blockId, payload, and optional metadata
   - `SyntheticBlockSequence` - Container for 100-1000 block sequences
   - `SyntheticBlockMetadata` - Optional verification metadata
   - `SequenceConfig` - Generation configuration
   - `SequenceValidationStats` - Validation metrics
   - `SequenceValidationResult` - Test result structure

3. **Schema supports encode/decode input requirements**
   - `sequenceToBuffer()` converts sequences to Uint8Array for BlockEncodePipeline
   - Compatible with existing encode/decode storage structures
   - Supports fountain code encoding parameters (L, BLOCK, K)

4. **Fields include: block_id, payload, optional metadata**
   - `blockId: number` - Unique block identifier (0-based index)
   - `payload: Uint8Array` - Block payload data
   - `metadata?: SyntheticBlockMetadata` - Optional verification data

5. **Size constraints for 100-1000 block sequences**
   - `SEQUENCE_SIZE_LIMITS.MIN_BLOCKS = 100`
   - `SEQUENCE_SIZE_LIMITS.MAX_BLOCKS = 1000`
   - `SEQUENCE_SIZE_LIMITS.MIN_SEQUENCE_SIZE = 100 × BLOCK = 19.2 MB`
   - `SEQUENCE_SIZE_LIMITS.MAX_SEQUENCE_SIZE = 1000 × BLOCK = 192 MB`

## Key Features

### Data Structures
- **SyntheticBlock**: Core unit with ID, payload, and optional metadata
- **SyntheticBlockSequence**: Container for batch testing (100-1000 blocks)
- **SyntheticBlockMetadata**: Verification data (checksum, pattern type, timestamps)

### Generation Patterns
- `sequential` - Repeating byte sequence (0, 1, 2, ..., 255, 0, ...)
- `random` - Seeded PRNG for reproducible random data
- `patterned` - Repeating 4-byte pattern (0xDE 0xAD 0xBE 0xEF)
- `zero` - All zeros (0x00)
- `max` - All maximum (0xFF)

### Utility Functions
- `generateSyntheticSequence()` - Create test sequences
- `generatePayload()` - Generate individual payloads
- `sequenceToBuffer()` - Convert to contiguous buffer for encoding
- `validateSyntheticSequence()` - Integrity validation
- `calculateChecksum()` - Simple checksum for verification
- `createSyntheticBlock()` - Quick single block creation

### Configuration Presets
- `SMALL` - 100 blocks for quick tests
- `MEDIUM` - 500 blocks for standard tests
- `LARGE` - 1000 blocks for stress tests
- `RANDOM` - 500 blocks with random pattern
- `EDGE_CASE` - 100 blocks with zero/max pattern

## Test Coverage

All 46 tests in `/home/coding/screenferry/test/synthetic-schema.test.ts` pass:

- ✅ Size constraint enforcement (100-1000 blocks)
- ✅ Sequence generation with correct structure
- ✅ All payload patterns (sequential, random, patterned, zero, max)
- ✅ Checksum validation
- ✅ Sequence integrity validation
- ✅ Buffer conversion for encode pipeline
- ✅ Single block creation utilities
- ✅ Configuration presets
- ✅ Size limits constants
- ✅ Edge cases (min/max sizes, all patterns)
- ✅ Type safety (TypeScript types)

## Integration with Encode/Decode Pipeline

The schema is designed to integrate seamlessly with the existing encode/decode infrastructure:

1. **Encode Path**: `sequenceToBuffer()` → `BlockEncodePipeline` → QR transmission
2. **Decode Path**: QR capture → `BlockDecodePipeline` → validation against original sequence
3. **Storage**: Compatible with `EncodeBlockStorage` and `DecodeBlockStorage`

## References

- Implementation: `src/core/block/synthetic-test-schema.ts`
- Tests: `test/synthetic-schema.test.ts`
- Related: `src/core/block/encode-storage.ts`, `src/core/block/decode-storage.ts`
- Plan reference: plan.md §8.1, D19, D24

## Conclusion

The synthetic test data schema is **production-ready** and fully supports encode→decode validation testing with sequences of 100-1000 blocks. All acceptance criteria have been met and verified through comprehensive testing.

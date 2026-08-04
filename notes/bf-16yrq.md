# Task BF-16YRQ: Document encoded input format and decode requirements

## Summary

Researched and documented the fountain code packet format, encode/decode contracts, and testing requirements for the ScreenFerry system.

## Work Completed

### 1. Documentation Created

**File: `docs/bf-16yrq-fountain-packet-format.md`**

Comprehensive documentation covering:
- **Packet structure**: 13-byte header + 256-byte payload (269 bytes total)
- **Header format**: streamId (4B) + blockIndex (3B) + seq (6B) + flags (1B)
- **Encoding process**: Repetition mode (K<8) vs LT code mode (K≥8)
- **Decoding process**: Gaussian elimination with back-substitution
- **Input/output contracts**: Pre/post-conditions and invariants
- **Test case definitions**: What "simple encoded sequences" means
- **Clean byte array definition**: Proper Uint8Array validation
- **Concrete examples**: Repetition mode, LT code mode, full packet structure
- **PRNG determinism**: Seed derivation and bit-exact requirements
- **Wire format constraints**: Fixed constants and version invariants

### 2. Test Fixtures Created

**File: `test/fixtures/simple-fountain-fixtures.ts`**

Ready-to-use test fixtures including:
- `REPETITION_K4_L4`: Minimal repetition mode test
- `BOUNDARY_K8_L256`: Repetition → LT code transition
- `SMALL_LT_K10_L256`: Small LT code mode test
- `COMPLETE_DECODE_K12_L256`: Full decode cycle test
- `MINIMUM_K1_L256`: Edge case (K=1)
- `MAX_REPETITION_K7_L32`: Edge case (K=7, max repetition)
- `REALISTIC_K768_L256`: Default scale test
- Helper functions: `createEncoder()`, `createDecoder()`, `assertCleanByteArray()`, `runEncodeDecodeCycle()`, `verifyRecovery()`

### 3. Key Findings

#### Fountain Packet Structure
```
Header (13 bytes):
  - streamId:     uint32LE (4 bytes)
  - blockIndex:   uint24 (3 bytes)
  - seq:          uint48 (6 bytes, unused in current implementation)
  - flags:        uint8 (1 byte)
Payload (256 bytes):
  - XOR of d source fragments (d sampled from harmonic distribution, capped at 64)
  - For K<8: direct copy of fragment [seq % K]
```

#### Encoder Contract
- **Input**: K fragments of L bytes each (L=256 fixed for wire version 1)
- **Output**: Deterministic `Uint8Array(L)` for each sequence number
- **Invariance**: Same (streamId, blockIndex, seq) → same payload

#### Decoder Contract
- **Input**: Packets with (seq, payload) pairs
- **State**: Tracks rank, packetsSeen, redundant, overhead
- **Output**: K fragments of L bytes when complete (rank === k)
- **Guarantee**: Recovered fragments byte-for-byte match source

#### Test Case Categories
1. **Repetition mode (K<8)**: Direct fragment mapping via `seq % K`
2. **Small LT code (8≤K≤16)**: Traceable index selection and XOR
3. **Complete decode**: K independent packets → full recovery
4. **Overhead tests**: Redundant packet detection
5. **Edge cases**: K=1, K=7, K=8 boundaries, K=768 realistic

#### Clean Byte Array Requirements
- Type: `Uint8Array` (not `Array` or `Buffer`)
- Length: Exactly L bytes (256) for payload
- Allocation: Independently allocated (no aliasing)
- Validation: Passed all boundary checks

## Files Modified/Created

1. `/home/coding/screenferry/docs/bf-16yrq-fountain-packet-format.md` (new)
2. `/home/coding/screenferry/test/fixtures/simple-fountain-fixtures.ts` (new)

## Next Steps

This documentation serves as the foundation for:
1. Creating fountain code unit tests
2. Validating encoder/decoder implementations
3. Understanding wire format constraints
4. Debugging packet-level issues

## References

- `src/core/fountain/encoder.ts`: LTEncoder implementation
- `src/core/fountain/decoder.ts`: GEDecoder implementation  
- `src/core/fountain/prng.ts`: Deterministic PRNG
- `src/core/params.ts`: Wire constants (L=256, K=768, HEADER=13, PACKET=269)
- `docs/plan/plan.md`: Design decisions and invariants

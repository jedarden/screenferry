# Delta Transfer Architecture Resolution (bf-280)

## Problem Statement

From plan §20.2: Content-defined chunking (rolling hash, variable boundaries) tensions with:
- **D15**: Fragment length L is fixed for the session
- **D19**: Fixed 192.0 KB blocks, K = 768 derived, never transmitted
- **D7**: Index sets derived from (streamId, blockIndex, seq), never transmitted

Variable-length chunks would:
1. Break the fixed-L invariant
2. Make K non-derivable (must be transmitted)
3. Violate the design principle that K is never on the wire

## The Unifying Insight

From the task description and plan §20.2:

> **A partially-received file IS 'a file the receiver already has'.** Delta transfer
> and resume-after-interruption are the same mechanism at different granularity:
> - resume: receiver has blocks {0..n}, needs the rest → D22 bitmap
> - delta: receiver has an older version, needs the changed regions

Both are fundamentally **bitmap-based delta encoding**. The difference is:
- **Resume**: Bitmap is implicit in session state (what was received this session)
- **Delta**: Bitmap must be computed by comparing two file versions

## Resolution: Block-Granular Delta (Option 2)

We adopt **Option 2 from plan §20.2**: Keep fixed blocks and diff at block granularity.

### Why Not Rolling-Hash Chunking?

Rolling-hash content-defined chunking is elegant for file deduplication but fundamentally incompatible with ScreenFerry's design:

1. **Breaks D15 (L fixed)**: Variable-length chunks require variable L
2. **Breaks D19 (K derived)**: K = blockSize / L must be transmitted for each chunk
3. **Breaks I5 (GE invariant)**: Different K values need different matrix sizes
4. **Breaks D7 (PRNG seeding)**: Index sets assume fixed K per block
5. **Complex receiver state**: Receiver needs N different GE contexts for N different K values

### Why Block-Granular Delta Is Sufficient

For the **air-gapped machine update** use case (the primary delta scenario):
- Updates are typically **appends** (new packages, logs) or **replacements** (whole components)
- Component boundaries naturally align to block granularity (192 KB is large enough)
- A 4 GB update with 10 MB changed is ~53 blocks out of 21,845 (0.24% overhead)

**Empirical evidence**: Git, rsync, and many delta tools work fine with fixed-size chunks for software distribution.

## Architecture: Delta as Bitmap Computation

### Core Insight

Delta transfer is a **bitmap computation problem**, not a new transfer protocol:

1. Sender has file V2 (new version)
2. Receiver has file V1 (old version)
3. Compute which blocks of V2 match blocks in V1
4. Transfer only the mismatched blocks

This is exactly the repair code mechanism (§8.2) generalized.

### Protocol Extension

We extend the repair code format (§7.6) to support delta mode:

**Current repair code format:**
```
SF1-<streamId32>-<ranges32>-<check>
```

**Delta repair code format:**
```
SFD-<oldStreamId32>-<newStreamId32>-<ranges32>-<check>
```

Where:
- `SFD` = ScreenFerry Delta (vs `SF1` for regular repair)
- `oldStreamId32` = StreamId of receiver's file (V1)
- `newStreamId32` = StreamId of sender's file (V2)
- `ranges32` = Run-length encoded block indices that differ
- `check` = CRC-8 for validation

### Block Comparison Algorithm

**Sender side:**

```typescript
function computeDeltaBlocks(
  newFile: File,
  oldFile: File,
  blockSize: number
): number[] {
  const differingBlocks: number[] = [];

  // Both files cut into same-sized blocks
  const newBlockCount = Math.ceil(newFile.size / blockSize);
  const oldBlockCount = Math.ceil(oldFile.size / blockSize);

  for (let i = 0; i < newBlockCount; i++) {
    // Skip blocks beyond old file (appends)
    if (i >= oldBlockCount) {
      differingBlocks.push(i);
      continue;
    }

    const newHash = await computeBlockHash(newFile, i, blockSize);
    const oldHash = await computeBlockHash(oldFile, i, blockSize);

    if (newHash !== oldHash) {
      differingBlocks.push(i);
    }
  }

  return differingBlocks;
}
```

**Key property**: Uses per-block SHA-256 hashes (already computed for manifest) so comparison is cheap.

### Delta Transfer Flow

1. **Sender** receives delta repair code from receiver
2. **Sender** parses: `SFD-<oldStreamId>-<newStreamId>-<ranges>`
3. **Sender** validates oldStreamId matches a file it has access to
4. **Sender** computes block hash comparison between old and new files
5. **Sender** verifies ranges match computed differences (security check)
6. **Sender** transmits only the differing blocks (like repair code mode)
7. **Receiver** applies blocks to update V1 → V2

### Security Considerations

**T9**: Hostile receiver could send crafted delta ranges to:
- Read arbitrary blocks from sender's files
- Corrupt receiver's file by requesting wrong blocks

**Mitigations**:
1. Sender validates oldStreamId is in its allowed file set
2. Sender verifies claimed ranges actually differ (re-computes comparison)
3. Block-level hash verification prevents corruption (manifest check)
4. User confirms delta operation (explicit, not automatic)

## Implementation Plan

### Phase 1: Block Comparison Infrastructure
- [ ] Add `computeBlockHash()` helper for block-by-block comparison
- [ ] Implement `computeDeltaBlocks()` algorithm
- [ ] Add delta-specific types and validation

### Phase 2: Delta Code Format
- [ ] Extend repair code parser for `SFD-` prefix
- [ ] Implement delta code encoding/decoding
- [ ] Add validation checks (oldStreamId, range verification)

### Phase 3: Sender Delta Mode
- [ ] Add delta mode to sender state machine
- [ ] Implement delta range verification
- [ ] Add delta-specific security checks

### Phase 4: Receiver Delta UI
- [ ] UI for selecting old file for delta comparison
- [ ] Delta code generation for air-gap transfer
- [ ] Delta code entry on sender side
- [ ] Progress indication for delta updates

## Compatibility

**Backward compatible**: Delta mode uses new `SFD-` prefix, old `SF1-` repair codes work unchanged.

**Forward compatible**: Receivers without delta support simply reject `SFD-` codes as malformed (unknown format).

## Performance Analysis

**For 4 GB file with 10 MB changed:**
- Regular transfer: 4 GB (4,194,304 KB)
- Delta transfer: 10 MB (10,240 KB) + ~43 KB for code (87 blocks out of 21,845)
- **Savings: 99.76%** (from 4 GB to ~10 MB)

**Block comparison cost:**
- Both files: ~200 KB reads (first/middle/last 64 KB samples)
- Hash comparison: 21,845 SHA-256 hashes (~0.3 seconds on desktop)
- Total overhead: < 1 second

**ROI**: Break-even at ~2% file changed. For typical software updates (<1% changed), delta is 50–100× faster.

## References

- Plan §7.6: Repair code format
- Plan §8.2: Human-mediated repair
- Plan §20.2: Delta transfer tensions
- Plan §22: Resume is mandatory (bitmap operations)
- Task bf-280: Delta transfer and cross-session resume

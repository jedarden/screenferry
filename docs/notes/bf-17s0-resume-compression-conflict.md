# Resume/Compression/T4-Reap Conflict Analysis

## Problem Statement

**plan.md §8.3 claims**: "the sender is stateless across restarts by construction" — **FALSE when compression is enabled**.

### Root Cause Chain

1. **Wire payload depends on compressed staging file** (D8): CompressionStream writes a compressed staging file to OPFS, then blocks are carved from it
2. **CompressionStream offers no determinism guarantee**: Different runs, versions, or platforms may produce different compressed byte sequences for the same input
3. **E11 reaps staging on startup**: Sender-side staging files with no active session are deleted on startup
4. **T4 requires wiping staging for privacy**: Staging MUST be wiped on completion, cancel, and startup-reap
5. **Sender restart → staging reaped → re-compress**: When the sender restarts, it re-compresses the source file
6. **Different bytes → different blocks**: Re-compression produces different byte boundaries
7. **Receiver silently corrupted**: The receiver's bitmap, block hashes, and manifest assume the old block boundaries — everything becomes invalid without detection

### Why This Breaks Resume

**When compression is DISABLED** (the original design):
- Sender is stateless: Same file + same streamId = same blocks
- streamId derived deterministically from file metadata (§7.4)
- Receiver's bitmap stays valid across sender restarts

**When compression is ENABLED**:
- Sender's wire payload = compressed staging file
- CompressionStream non-deterministic → re-compression produces different bytes
- Same streamId, different block contents → receiver's bitmap points to wrong data
- Per-block hashes (the only application-layer integrity check, §7.1) fail silently until final verification
- Multi-GB transfer completes with corrupt output

## Resolution: Forbid Resume with Compression

**Decision**: Resume is NOT supported when compression is enabled.

### Implementation

1. **Beacon flag `RESUME_DISABLED`** (PacketFlags or beacon flags field)
   - Sender sets this flag when `PacketFlags.Compressed` is set
   - Receiver reads this flag from the beacon
   - Resume UI is suppressed when this flag is present

2. **Privacy constraint preserved** (T4):
   - Staging files continue to be wiped on startup (E11)
   - Staging files continue to be wiped on completion/cancel
   - No change to privacy posture

3. **User experience**:
   - User selects same file → different streamId than compressed session → fresh transfer
   - Receiver never offers resume for compressed transfers
   - No silent corruption possible

### Why This Over Alternatives

**Alternative 1**: Preserve staging across restarts
- **Rejected**: Violates T4 (privacy requirement)
- Would require user-visible "abandoned staging files" clutter
- Storage quota pressure on multi-GB files

**Alternative 2**: Hash-based block boundaries
- **Rejected**: Requires full file read to compute block boundaries
- Defeats streaming design (D20)
- Adds complexity for minimal benefit

**Alternative 3**: Compression determinism guarantee
- **Rejected**: CompressionStream spec offers no such guarantee
- Would require custom WASM compressor
- Out of scope for v1

**Alternative 4**: Per-block hash mismatch detection during resume
- **Rejected**: Requires receiver to re-verify all completed blocks on resume
- Wastes progress (hours of transfer time)
- Poor UX: "resume works but throws away your work"

## Specification

### Sender Behavior

When compression is enabled:
1. Set `PacketFlags.Compressed` on beacon packets
2. Set `RESUME_DISABLED` flag in beacon metadata
3. Continue normal transmission
4. Wipe staging on completion/cancel (T4)
5. Staging reaped on next startup (E11)

### Receiver Behavior

On beacon receipt:
1. If `RESUME_DISABLED` flag is set:
   - Do NOT persist resume state (bitmap, metadata)
   - Show "Resume not available for this transfer" message
   - Suppress any resume UI on reload
2. Otherwise, persist resume state normally (D22)

### streamId Behavior

streamId derivation (§7.4) is UNCHANGED:
- Same file → same streamId regardless of compression
- This is intentional: user re-selecting file starts fresh transfer
- Different compressed session cannot resume from/to uncompressed session

## Testing

### Unit Tests
- Test that beacon sets `RESUME_DISABLED` when compression enabled
- Test that receiver suppresses resume UI when flag present

### Integration Tests
- Compressed transfer interrupted → reload → resume UI NOT shown
- Uncompressed transfer interrupted → reload → resume UI shown
- Compressed then uncompressed transfer → different streamIds

### Property Tests
- For any file, compression produces deterministic blocks within ONE session
- For any file, re-compression MAY produce different blocks across sessions

## References

- plan.md §8.3 (Resume D22)
- plan.md §7.4 (streamId derivation)
- plan.md §7.1 (Packet header and integrity)
- plan.md §12 (Threat model T4)
- plan.md §10 (Edge cases E11, E12)
- plan.md D8 (Compression decision)
- plan.md D22 (Resume requirement)

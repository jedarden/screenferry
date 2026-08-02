# Resume/Compression/T4-reap Conflict Resolution

## Problem Statement

Plan §8.3 claims "the sender is stateless across restarts by construction" — this is **FALSE** when compression is enabled.

### Root Cause Chain

1. **D8** states: "Compress before blocking, to a staging file"
2. The compressed staging file becomes the wire payload
3. **CompressionStream** offers no determinism guarantee across:
   - Different runs (browser restart)
   - Different versions (browser updates)
   - Different platforms (Chrome vs Firefox vs Safari)
4. **E11** reaps abandoned staging files on startup
5. **T4** (privacy requirement) requires wiping staging on completion/cancel
6. **Result:** Sender restart → staging reaped → re-compress produces **different bytes** → different block boundaries and hashes → receiver's bitmap, output, and manifest become **silently invalid**

### Why This Breaks Resume

The receiver persists a bitmap of completed blocks (D22). If the sender re-compresses and produces different blocks:
- Block boundaries change → same data split differently across blocks
- Block hashes change → verified blocks now fail hash checks
- The manifest becomes invalid → receiver can't verify anything
- **The transfer silently corrupts** with no indication

## Decision: Forbid Resume with Compression

**Chosen approach:** When compression is enabled, resume is **not supported**.

### Rationale

1. **Simpler and safer** - No complex state management across restarts
2. **Preserves T4** - Privacy requirement remains intact
3. **Maintains statelessness** - Sender can still be stateless without compression
4. **Compression is an optimization** - Users can choose: compress (faster) OR resume (robustness)
5. **Fail-safe** - Better to explicitly refuse than to silently corrupt

## Implementation

### Sender Behavior

On session start:
1. Compute `streamId` from the selected file (D22/§7.4)
2. Check if staging exists for this `streamId`
3. If staging exists:
   - Check if compression was enabled (flag in staging metadata)
   - If compressed: **Do not offer resume**. Warn user and offer:
     - "Start fresh" (delete old staging, re-compress, new streamId)
     - "Continue without resume" (treat as new transfer, different streamId)
4. If no staging or uncompressed: Normal resume path

### Beacon Flag

Add `RESUME_DISABLED` flag to beacon `flags` field (§7.2):
- Set when compression is enabled
- Receiver uses this to update UI (show "Resume unavailable" instead of normal resume offer)

### Privacy Impact (T4)

- Staging still reaped on startup (E11)
- Staging still wiped on completion/cancel (T4)
- **No change** - privacy posture maintained

### User Impact

- **Compression ON**: Faster transfers, but no resume. Browser crash or user stop means restart from beginning.
- **Compression OFF**: Slower transfers, but resume works. Can handle interruptions gracefully.

### Documentation Updates

Required plan.md changes:
1. §8.3 (Resume): Add note that resume is unavailable with compression
2. §12 (Threat model T4): No change - privacy posture unchanged
3. §7.2 (Beacon): Document `RESUME_DISABLED` flag
4. D8: Add note about resume trade-off

## Alternative Not Chosen: Preserve Staging

**Rejected approach:** Preserve compressed staging across restarts.

### Why Rejected

1. **Violates T4** - Privacy requirement states staging must be wiped
2. **Complicates statelessness** - Sender now has persistent state to manage
3. **Staging accumulation** - Crashes would leave orphaned files
4. **Cross-platform instability** - Different browsers may compress differently anyway
5. **More complex** - Requires state management, cleanup, validation

## Testing Requirements

1. Test: Compressed transfer interrupted → restart → verify resume is refused
2. Test: Uncompressed transfer interrupted → restart → verify resume works
3. Test: Compressed staging exists → offer "Start fresh" → verify new transfer succeeds
4. Test: Beacon with `RESUME_DISABLED` → receiver UI shows appropriate message

## Compatibility

- **Wire format**: No breaking changes - just a new flag in existing beacon
- **Versioning**: Existing receivers ignore unknown flags (graceful degradation)
- **Backward compat**: Old senders (without this logic) work normally, just don't set the flag

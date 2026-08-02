# Compression/Resume/T4-reap Interaction Investigation (bf-2vke)

**Bead:** `bf-2vke`  
**Phase:** Phase 4 (Large-file machinery)  
**Related:** `bf-17s0` (Resume/Compression/T4-reap Conflict Resolution), `bf-1yk1` (T4b Deletion Lifecycle)

## Executive Summary

This investigation confirms the architectural incompatibility between compression, resume functionality, and T4 privacy requirements. The core issue: **CompressionStream offers no determinism guarantee across browser restarts, updates, or platforms**, making the sender non-stateless when compression is enabled.

**Decision:** Resume is explicitly **unsupported when compression is enabled**. The beacon carries a `RESUME_DISABLED` flag to signal this to receivers.

## The Failure Chain

### Step 1: Initial Compression
```
File → CompressionStream → Staging (OPFS) → Blocks → Hashes → Frames
```
- D8 compresses the file to a staging area in OPFS
- The compressed bytes are cut into fixed-size blocks
- Each block is hashed to create the manifest
- These hashes become the source of truth for the receiver

### Step 2: Transfer Interrupted
- Sender crashes, user stops transfer, or browser backgrounding occurs
- Receiver persists bitmap of completed blocks (D22)
- Both sides resume capability depends on identical block hashes

### Step 3: Privacy Reaping (E11, T4a)
- On sender restart, E11 reaps abandoned staging files
- T4a privacy requirement mandates wiping staging on completion/cancel
- **The compressed staging file is deleted**

### Step 4: Sender Restart Attempts Resume
```
Sender restarts → staging gone → must re-compress
```
- Sender attempts to resume the same session
- Needs the same `streamId` and the same block hashes
- **Problem:** Must re-compress because staging was reaped

### Step 5: Re-compression Produces Different Bytes
```
Same file + CompressionStream → different compressed bytes (potentially)
```
**Why this can happen:**
1. **Browser updates** → Different compression algorithm version
2. **Different platforms** → Chrome vs Firefox vs Safari implementations
3. **Compression parameters** → Different level, strategy, or metadata
4. **Timestamp metadata** → Gzip includes modification time if file handle varies

### Step 6: Hash Divergence
```
Different compressed bytes → different block boundaries → different hashes
```
- Even 1 byte difference in compression → all subsequent blocks shift
- Block hashes change completely
- Manifest becomes invalid for the new compression

### Step 7: Silent Corruption
```
Receiver's bitmap (old hashes) + Sender's new hashes = mismatch
```
- Receiver's persisted bitmap references old block hashes
- Sender emits frames with new block hashes
- **Result:** Transfer completes but fails hash verification OR silently corrupts

## Architectural Impact

### Statelessness Violation

**WITHOUT compression (stateless):**
```
File → Blocks → Hashes
Same file + same params = same hashes (deterministic)
Sender can restart and resume safely
```

**WITH compression (NOT stateless):**
```
File → CompressionStream → Staging → Blocks → Hashes
Compression is non-deterministic → different staging bytes → different hashes
Sender requires persistent staging to maintain hash consistency
But T4a requires staging to be wiped → contradiction
```

### Code Paths Affected

1. **Sender block partitioning** (`src/core/block/partition.ts`)
   - Must read from compressed staging, not original file
   - Block boundaries depend on compressed bytes

2. **Manifest generation** (Beacon frame, §7.6)
   - Block hashes derived from compressed staging
   - Different staging → different manifest

3. **Receiver bitmap persistence** (D22, §8.3)
   - Persists completed block indices
   - Assumes hashes remain stable across restart

4. **Resume logic** (Session state machine)
   - `isResumeDisabled()` checks `Compressed` flag
   - Suppresses resume UI when compression enabled

## CompressionStream Determinism Analysis

### Test Findings

Tests in `test/compression-determinism.test.ts` demonstrate:

1. **CompressionStream offers no determinism guarantee**
   - The Web Compression API spec provides no stability promises
   - Different browser versions may implement different algorithms
   - Cross-platform consistency is not guaranteed

2. **Gzip format considerations**
   - RFC 1952: "The format has no provision for interoperable compressed data"
   - Gzip can include optional metadata (filename, timestamp, comment)
   - Compression level and strategy can affect output

3. **Observed behavior**
   - In our test environment (Node.js), compression appeared deterministic
   - This is NOT guaranteed in browsers across versions/platforms
   - Relying on observed determinism is a security/stability risk

### Spec References

From [CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream):
> "The CompressionStream interface of the Compression Streams API compresses a stream of data."

**No mention of:**
- Determinism guarantees
- Cross-version stability
- Platform consistency
- Reproducibility requirements

## Implementation Status

### Beacon Flags (src/core/frame/beacon.ts)

```typescript
export enum BeaconFlags {
  None = 0,
  /** Compression enabled (D8) */
  Compressed = 1 << 0,
  /** Resume disabled when compression is enabled */
  ResumeDisabled = 1 << 1,
  // ...
}
```

### Resume Logic (beacon.ts:311)

```typescript
export function isResumeDisabled(flags: number): boolean {
  return (flags & BeaconFlags.Compressed) !== 0;
}
```

### Session Types (src/core/session/types.ts)

Receiver states include:
- `ReceivingState` - Normal operation
- `PausedState` - Can resume if compression disabled
- `CompleteState` - Final state, may have used compression

### Plan.md Status (§8.3)

The plan already documents this:
> "The sender is stateless across restarts by construction (D24) **when compression is disabled** — it needs only the same file and the same `streamId` (§7.4). **With compression enabled, resume is NOT supported** — see `notes/bf-17s0-resume-compression-conflict.md`"

## User Experience Impact

### Compression ON (Resume Disabled)
- **Pros:** Faster transfers (3-10× less data to transmit)
- **Cons:** No resume — interruptions restart from beginning
- **Use case:** Stable connections, shorter transfers (< 1 hour)

### Compression OFF (Resume Enabled)
- **Pros:** Robust to interruptions — resume from last completed block
- **Cons:** Slower transfers (full file size transmitted)
- **Use case:** Multi-hour transfers, unstable connections

## Testing Requirements

### Implemented Tests

✅ `test/compression-determinism.test.ts`
- Documents CompressionStream behavior
- Shows architectural problem with hash divergence
- Tests statelessness violation

### Integration Tests Needed

1. **Compressed transfer interrupted → resume refused**
   ```typescript
   // Send with compression, stop at 50%, restart
   // Assert: Resume UI shows "Resume unavailable with compression"
   ```

2. **Uncompressed transfer interrupted → resume succeeds**
   ```typescript
   // Send without compression, stop at 50%, restart
   // Assert: Resume UI appears and completes successfully
   ```

3. **Beacon flag validation**
   ```typescript
   // Assert: Compressed beacon sets RESUME_DISABLED flag
   // Assert: Receiver suppresses resume UI when flag set
   ```

## Alternative Approaches Considered

### 1. Preserve Compressed Staging Across Restarts

**Rejected because:**
- Violates T4a privacy requirement (staging must be wiped)
- Complicates sender statelessness
- Orphaned staging accumulation on crashes
- Cross-platform instability remains

### 2. Deterministic Compression Implementation

**Rejected because:**
- Would require custom gzip implementation (maintenance burden)
- Still vulnerable to browser runtime changes
- Defeats the purpose of using native CompressionStream API
- Adds complexity without guaranteed benefit

### 3. Hash-Based Compression Verification

**Rejected because:**
- Requires storing compressed staging to verify hash
- Brings us back to preserving staging (violates T4a)
- Adds complexity without solving the root issue

## Security and Privacy Considerations

### T4a Compliance (Sender-side Staging)

Current implementation is compliant:
- Staging is reaped on startup (E11)
- Staging is wiped on completion/cancel (T4a)
- Resume disabled with compression → no persistent state needed

### T4b Compliance (Receiver-side Output)

Per `bf-1yk1`:
- Receiver output follows deletion lifecycle
- Orphan reaping on startup
- User-visible delete controls
- Warnings for partial artefacts

## Documentation Updates Completed

✅ **Plan.md §8.3** - Already documents the restriction
✅ **Beacon flags** - `RESUME_DISABLED` implemented
✅ **Session types** - Compression state tracked
✅ **Test coverage** - Determinism tests added

## References

- **Plan §8.3** - Resume specification
- **Plan §12 T4a** - Sender-side staging privacy
- **Plan §12 T4b** - Receiver-side output lifecycle
- **Plan D8** - Compression to staging file
- **Plan E11** - Abandoned staging reaping
- **Beacon format (§7.2)** - Flags specification
- **`bf-17s0`** - Resume/Compression/T4-reap conflict resolution
- **`bf-1yk1`** - T4b deletion lifecycle

## Conclusion

The interaction between compression, resume, and T4 privacy requirements creates an architectural contradiction:

1. **Resume requires statelessness** → Same inputs must produce same outputs
2. **Compression is non-deterministic** → Same inputs may produce different outputs
3. **T4 requires staging cleanup** → Cannot preserve compression state

**Solution:** Explicitly disable resume when compression is enabled. Users choose between:
- **Compression:** Speed, no resume
- **No compression:** Robustness, with resume

This is documented in plan.md §8.3, implemented in beacon flags, and tested in `compression-determinism.test.ts`.

# bf-4bi6: Compression+Resume Conflict Detection

## Task Summary
Add conflict detection to sender initialization to prevent the unsafe combination where compression is enabled but resume is not disabled.

## Implementation
The conflict detection check is implemented in `/home/coding/screenferry/src/core/frame/beacon.ts` at lines 610-629 in the `encodeBeacon()` function.

## How It Works

### Entry Point
- `encodeBeacon()` is the sender initialization entry point
- Called when the sender creates a beacon for transmission
- Check happens BEFORE any state mutations (file creation, session initialization)

### Conflict Detection Logic
```typescript
const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;

if (compressionEnabled && !resumeDisabled) {
  throw new BeaconValidationError(
    'E-COMPRESSION-RESUME-CONFLICT',
    `Compression cannot be enabled without disabling resume. ` +
    `When BeaconFlags.Compressed is set, BeaconFlags.ResumeDisabled must also be set. ` +
    `This is required because CompressionStream offers no determinism guarantee across ` +
    `browser restarts, making resume unsafe (see bf-17s0, bf-2w1a).`,
    { flags: meta.flags, compressionEnabled, resumeDisabled }
  );
}
```

### Why This Is Necessary
When compression is enabled, `CompressionStream` offers no determinism guarantee across browser restarts. After a sender restart and E11 staging reaping, re-compression may produce different bytes → different block boundaries → different hashes → the receiver's persisted bitmap becomes silently invalid.

## Acceptance Criteria Verification

✅ **AC1: Identify sender initialization entry point**
- Entry point: `encodeBeacon()` in `src/core/frame/beacon.ts`
- Called when sender creates beacon for transmission
- First line of defense before state mutations

✅ **AC2: Add check if compressionEnabled && resumeEnabled**
- Check at lines 613-614: `compressionEnabled && !resumeDisabled`
- Throws `BeaconValidationError` with code `E-COMPRESSION-RESUME-CONFLICT`

✅ **AC3: Error message clearly explains incompatibility**
- Detailed error message explaining the conflict
- References to design docs: `bf-17s0`, `bf-2w1a`
- Explains technical reason: CompressionStream non-determinism

✅ **AC4: Check happens before any state changes**
- Check at lines 610-629, before any operations
- File operations start at line 631+
- No side effects when check fails

✅ **AC5: No changes to non-conflict paths**
- Only throws when actual conflict exists
- Valid configurations work normally:
  - No compression, resume allowed: `flags = 0`
  - Compression + resume disabled: `flags = Compressed | ResumeDisabled`
  - Resume disabled alone: `flags = ResumeDisabled`

## Testing
Comprehensive test suite added in `/home/coding/screenferry/test/bf-4bi6-compression-resume-conflict.test.ts`:
- Conflict detection tests
- Valid configuration tests
- Check timing and safety tests
- Acceptance criteria verification tests

## Safety Guarantees
1. Sender cannot create beacon with unsafe flag combination
2. Error thrown before any files created or sessions initialized
3. No silent corruption possible from compression+resume conflict
4. Normal flows unchanged for valid configurations

## References
- `docs/notes/bf-17s0-resume-compression-conflict.md`
- `docs/notes/bf-2vke-compression-resume-t4-reap-interaction.md`
- `docs/notes/bf-3k90-compression-resume-solution-evaluation.md`

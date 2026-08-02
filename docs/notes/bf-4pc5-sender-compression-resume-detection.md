# Sender-Side Compression/Resume Conflict Detection (bf-4pc5)

**Bead:** `bf-4pc5`
**Phase:** Phase 4 (Large-file machinery)
**Related:** `bf-3k90` (Compression/Resume Solution Evaluation), `bf-2vke` (Compression/Resume/T4-Reap Interaction)

## Executive Summary

Implements **sender-side detection** for the architectural conflict between compression and resume. When both features are enabled together, this creates an invalid state that would silently corrupt receiver state. The detection happens during sender initialization, before any staging files are created or read.

## Problem Statement

From `bf-2vke` and `bf-17s0`:
- **CompressionStream offers no determinism guarantee** across browser restarts
- **Re-compression after staging reaping (E11) may produce different bytes**
- **Different bytes → different block boundaries → different hashes**
- **Receiver's persisted bitmap becomes silently invalid**

The receiver-side checks (`canResumeRecv()`, `createResumeToken()`) prevent resume when compression is enabled, but **sender-side validation was missing**. This meant a sender could be configured with both compression and resume enabled, leading to undefined behavior.

## Solution: Fail-Fast Detection

Implemented a validation module (`src/core/sender-validation.ts`) that:

1. **Validates sender configuration** before initialization
2. **Throws `CompressionResumeConflictError`** when both compression and resume are enabled
3. **Provides non-throwing variants** for flexible use cases
4. **Documents the architectural constraint** in error messages

### Usage

```typescript
import { validateSenderConfig, type SenderConfig } from './core/sender-validation.js';

// During sender initialization
const config: SenderConfig = {
  compressionEnabled: userSelectedCompression,
  resumeEnabled: userSelectedResume,
};

// Fail-fast detection - throws if invalid
validateSenderConfig(config);

// If we reach here, config is valid - proceed with sender startup
// - Create staging files (if compression enabled)
// - Set beacon flags appropriately
// - Start transmission
```

### Non-Throwing Variants

For scenarios where exception handling is undesirable:

```typescript
import { isValidSenderConfig, getValidationError } from './core/sender-validation.js';

// Check validity without throwing
if (!isValidSenderConfig(config)) {
  const error = getValidationError(config);
  // Show user-friendly error in UI
  console.error(error);
  return;
}
```

## Architecture

### Validation Module

Located at `src/core/sender-validation.ts`:

**Core Function:**
- `validateSenderConfig(config: SenderConfig): void` - Throws on invalid config

**Helper Functions:**
- `isValidSenderConfig(config: SenderConfig): boolean` - Non-throwing check
- `getValidationError(config: SenderConfig): string | null` - Error message

**Error Type:**
- `CompressionResumeConflictError` - Specific error for this conflict

**Configuration Interface:**
```typescript
interface SenderConfig {
  compressionEnabled: boolean;
  resumeEnabled: boolean;
  // Future: K, blockSize, fragmentLen, etc.
}
```

### Integration Point

This validation should be called:
1. **Before sender state transition** from `IdleSenderState` to `SendingState`
2. **Before staging files are created** (compression writes to OPFS)
3. **Before beacon flags are set** (prevents invalid flag combinations)

The exact integration point depends on where the sender reads configuration from user input or settings.

## Validation Rules

### Current Implementation

✅ **Rule 1: Compression and resume are mutually exclusive**
```typescript
if (compressionEnabled && resumeEnabled) {
  throw new CompressionResumeConflictError();
}
```

### Future Extensions

Additional validation checks can be added to `validateSenderConfig()`:

- **K validation**: Ensure K doesn't exceed receiver's benchmarked K_max (D26)
- **Block size validation**: Ensure block size is within acceptable range
- **File size validation**: Ensure file doesn't exceed storage quota (§8.4)
- **Fragment length validation**: Ensure L is within bounds (T1)

## Testing

Comprehensive tests at `test/sender-validation.test.ts`:

### Unit Tests
- ✅ Valid config: compression only
- ✅ Valid config: resume only
- ✅ Valid config: both disabled
- ❌ Invalid config: both enabled (throws)
- ✅ Error type and message validation
- ✅ Non-throwing variants

### Integration Scenarios
- ✅ Configuration error caught before sender starts
- ✅ Sender proceeds with compression-only
- ✅ Sender proceeds with resume-only
- ✅ Sender proceeds with neither

## Error Message

The `CompressionResumeConflictError` message provides context:

```
Compression and resume cannot both be enabled. When compression is enabled,
resume is NOT supported because CompressionStream offers no determinism
guarantee across browser restarts. This would silently corrupt the receiver's
persisted state.
```

This message:
1. **States the constraint clearly** (cannot both be enabled)
2. **Explains why** (CompressionStream non-determinism)
3. **Describes the consequence** (silent corruption)

## User Experience

### Compression ON, Resume OFF (Valid)
- **Use case:** Fast transfer, stable connection
- **Behavior:** Sender validates → proceeds → sets `BeaconFlags.Compressed | BeaconFlags.ResumeDisabled`
- **Receiver:** Suppresses resume UI

### Compression OFF, Resume ON (Valid)
- **Use case:** Multi-hour transfer, unstable connection
- **Behavior:** Sender validates → proceeds → sets `BeaconFlags.None`
- **Receiver:** Shows resume UI on interruption

### Both ON (Invalid)
- **Use case:** Architecturally impossible
- **Behavior:** Sender validates → throws `CompressionResumeConflictError`
- **UI:** Shows error message, prevents sender startup
- **Prevention:** No staging files created, no beacon emitted, no receiver corruption

## Relationships to Other Constraints

### T4 Privacy (Staging Cleanup)
This validation **preserves T4a compliance**:
- Staging files are still reaped on startup (E11)
- Staging files are still wiped on completion/cancel
- Resume disabled when compression enabled → no persistent state needed

### D8 (Compression to Staging)
This validation **prevents D8 conflicts**:
- D8 compresses to staging file before blocking
- With resume enabled, staging persistence would be required
- By disabling resume when compression is on, staging can be safely reaped

### D22 (Resume Requirement)
This validation **enforces D22 constraints**:
- D22 requires resume to be mandatory and first-class
- When compression is disabled, resume is fully supported
- When compression is enabled, resume is explicitly disabled (by design)

## References

- **plan.md §8.3** - Resume specification
- **plan.md D8** - Compression to staging file
- **plan.md D22** - Resume requirement
- **plan.md §12 T4a** - Sender-side staging privacy
- **`bf-17s0`** - Resume/Compression/T4-reap conflict resolution
- **`bf-2vke`** - Compression/Resume/T4-reap interaction investigation
- **`bf-3k90`** - Compression/Resume solution evaluation (Option B)
- **`beacon.ts:311`** - `isResumeDisabled()` implementation
- **`types.ts:801`** - `createResumeToken()` implementation

## Implementation Checklist

- [x] Create validation module (`src/core/sender-validation.ts`)
- [x] Implement `validateSenderConfig()` function
- [x] Implement `CompressionResumeConflictError` class
- [x] Implement non-throwing variants (`isValidSenderConfig`, `getValidationError`)
- [x] Write comprehensive tests (`test/sender-validation.test.ts`)
- [x] Document validation rules and error messages
- [x] Create this documentation note
- [ ] Integrate into sender initialization (when sender code exists)
- [ ] Add validation to sender startup sequence
- [ ] Test end-to-end with actual sender implementation

## Conclusion

This implements **Option B from bf-3k90 evaluation** ("Forbid resume when compression is enabled") with sender-side detection:

1. **Privacy (T4) preserved:** No staging persistence needed
2. **Correctness preserved:** Explicitly disabling unsafe resume
3. **Low complexity:** ~100 lines vs. 300-1200 for alternatives
4. **Fail-fast:** Errors caught before any work begins
5. **Clear errors:** Descriptive messages guide users to valid configurations

The validation module is ready to be integrated into the sender initialization sequence once the sender implementation is added to the codebase.

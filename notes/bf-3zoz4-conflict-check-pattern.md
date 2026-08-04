# Conflict Check Pattern Reference

**Bead:** bf-3zoz4
**Reference Implementation:** `src/core/frame/beacon.ts` (lines 610-629)
**Error Codes:** `src/core/errors/error-codes.ts`
**Test Coverage:** `test/bf-4bi6-compression-resume-conflict.test.ts`

## Pattern Overview

Conflict checks are **pure validation functions** that throw errors **before any state changes** occur. They prevent unsafe combinations of flags, parameters, or configuration values that would cause silent corruption, undefined behavior, or resource leaks.

## Core Pattern

### 1. Error Class Definition

```typescript
// Custom error class with structured data
export class BeaconValidationError extends Error {
  constructor(
    public code: string,           // Stable error code
    message: string,               // User-facing error message
    public details: Record<string, unknown>  // Diagnostic metadata
  ) {
    super(message);
    this.name = 'BeaconValidationError';
  }
}
```

**Key properties:**
- `code`: Stable identifier for programmatic handling
- `message`: Clear explanation for users
- `details`: Raw diagnostic data (flags, values, states)
- Inherits from `Error` for standard exception handling

### 2. Conflict Check Implementation

```typescript
// Location: Entry point function BEFORE any state changes
export function encodeBeacon(meta: BeaconMeta): Uint8Array {
  // ===== CONFLICT CHECK ZONE =====
  // All validation happens here, before any files/sessions are created

  const compressionEnabled = (meta.flags & BeaconFlags.Compressed) !== 0;
  const resumeDisabled = (meta.flags & BeaconFlags.ResumeDisabled) !== 0;

  // Exact condition: compression enabled BUT resume not disabled
  if (compressionEnabled && !resumeDisabled) {
    throw new BeaconValidationError(
      'E-COMPRESSION-RESUME-CONFLICT',           // Stable error code
      `E-COMPRESSION-RESUME-CONFLICT: Compression cannot be enabled without disabling resume. ` +
      `When BeaconFlags.Compressed is set, BeaconFlags.ResumeDisabled must also be set. ` +
      `This incompatibility is required because CompressionStream offers no determinism guarantee across ` +
      `browser restarts, making resume unsafe (see bf-17s0, bf-2w1a).`,
      {                                        // Diagnostic metadata
        flags: meta.flags,
        compressionEnabled,
        resumeDisabled
      }
    );
  }

  // ===== SAFE ZONE =====
  // No state changes happen above this line
  // Only valid configurations reach this point
  const session = createSession(...);
  const file = openFile(...);
  // ... rest of initialization
}
```

**Pattern elements:**
1. **Check location:** At the very top of the entry function, before any state changes
2. **Condition check:** Extract values from input parameters, test for conflict
3. **Error code:** Stable identifier starting with `E-`
4. **Error message:** Multi-line explanation with:
   - What requirement was violated
   - Which specific condition is incompatible
   - Why it's unsafe (technical explanation)
   - Cross-references to analysis beads
5. **Details object:** Raw diagnostic data for debugging

### 3. Test Pattern

```typescript
describe('Conflict detection', () => {
  it('should throw when [condition]', () => {
    const meta = createValidMeta();
    // Trigger the conflict
    meta.flags = BeaconFlags.Compressed;

    expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);
    expect(() => encodeBeacon(meta)).toThrow('E-COMPRESSION-RESUME-CONFLICT');
  });

  it('should provide clear error message', () => {
    const meta = createValidMeta();
    meta.flags = BeaconFlags.Compressed;

    try {
      encodeBeacon(meta);
      expect.fail('Should have thrown BeaconValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(BeaconValidationError);
      if (error instanceof BeaconValidationError) {
        expect(error.code).toBe('E-COMPRESSION-RESUME-CONFLICT');
        expect(error.message).toContain('Compression cannot be enabled');
        expect(error.message).toContain('bf-17s0');
      }
    }
  });

  it('should include conflict details in error', () => {
    const meta = createValidMeta();
    meta.flags = BeaconFlags.Compressed;

    try {
      encodeBeacon(meta);
      expect.fail('Should have thrown BeaconValidationError');
    } catch (error) {
      if (error instanceof BeaconValidationError) {
        expect(error.details).toBeDefined();
        expect(error.details.flags).toBe(BeaconFlags.Compressed);
        expect(error.details.compressionEnabled).toBe(true);
        expect(error.details.resumeDisabled).toBe(false);
      }
    }
  });

  it('should allow [valid configuration]', () => {
    const meta = createValidMeta();
    // Valid configuration - both flags set
    meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;

    expect(() => encodeBeacon(meta)).not.toThrow();
  });

  it('should fail before any state changes', () => {
    const meta = createValidMeta();
    meta.flags = BeaconFlags.Compressed; // Conflict!

    // Check happens immediately, no side effects
    expect(() => encodeBeacon(meta)).toThrow(BeaconValidationError);

    // Verify input object unchanged
    expect(meta.flags).toBe(BeaconFlags.Compressed);
  });
});
```

**Test coverage requirements:**
- ✅ Conflict condition throws the error
- ✅ Error code matches expected value
- ✅ Error message explains the incompatibility
- ✅ Error details include diagnostic data
- ✅ Valid configurations don't throw
- ✅ Check happens before state changes
- ✅ No side effects from the check itself

## Error Code Convention

### Format

```
E-[CATEGORY]-[SPECIFIC-CONDITION]
```

**Examples:**
- `E-COMPRESSION-RESUME-CONFLICT` — Incompatible flag combination
- `E-K-OVERFLOW` — Parameter exceeds maximum supported value
- `E-QUOTA-PREFLIGHT` — Resource constraint violation

### Registration

When adding a new error code, register it in `src/core/errors/error-codes.ts`:

```typescript
// User-facing message
export const ERROR_MESSAGES: Record<string, string> = {
  // ... existing codes ...
  'E-COMPRESSION-RESUME-CONFLICT': 'Compression cannot be enabled without disabling resume.',
  // ... add new code here ...
};

// Metadata
export const ERROR_METADATA: Record<string, {
  category: string;
  recoverable: boolean;
  severity: ErrorSeverity;
}> = {
  // ... existing codes ...
  'E-COMPRESSION-RESUME-CONFLICT': {
    category: 'protocol',
    recoverable: false,        // User must fix and retry
    severity: ErrorSeverity.FATAL,
  },
  // ... add new code here ...
};
```

## Safety Properties

### 1. Pure Function
The conflict check must be a **pure function** of its inputs:
- No side effects (no file I/O, no network calls, no state mutation)
- Same inputs → same outputs (always throws or never throws)
- No dependencies on external state

### 2. Early Exit
The check must be the **first code** in the entry function:
```typescript
export function initializeSender(config: SenderConfig): Sender {
  // ✅ RIGHT: Check first
  if (incompatible(config)) {
    throw new ValidationError(...);
  }

  // ❌ WRONG: State changes before check
  const session = createSession();
  if (incompatible(config)) {
    throw new ValidationError(...);  // Too late!
  }
}
```

### 3. No Cleanup Required
Because the check throws before any state changes:
- No files are created → no cleanup needed
- No sessions are initialized → no resources to free
- No network connections → nothing to close

**This is a safety property, not just a pattern.** Tests verify that cleanup is architecturally unreachable from the conflict path.

## Variations

### "Already Initialized" Pattern

For singleton initialization checks:

```typescript
export function configureStorageManager(config: Partial<StorageManagerConfig>): void {
  if (storageManagerInstance) {
    throw new Error('Storage manager already initialized. Call configureStorageManager() before getStorageManager().');
  }

  // Initialize singleton
  storageManagerInstance = new StorageManager(config);
}
```

**Use this pattern when:**
- A singleton can only be initialized once
- The error is a programming error (wrong call order)
- No structured diagnostic data is needed

### Structured Error Pattern (ScreenferryError)

For errors that need rich metadata:

```typescript
export class KOverflowError extends ScreenferryError {
  public readonly details: {
    beaconK: number;
    localKMax: number;
  };

  constructor(beaconK: number, localKMax: number) {
    const message = `Sender's chunk size (K=${beaconK}) exceeds this device's maximum supported complexity (K_max=${localKMax}). The sender must use a smaller file or reduce K.`;
    super('E-K-OVERFLOW', message);
    this.name = 'KOverflowError';
    this.details = { beaconK, localKMax };
  }
}
```

**Use this pattern when:**
- Error needs structured details for UI handling
- Error will be caught and displayed to users
- Error code needs metadata (recoverability, severity)

## When to Use Each Pattern

| Scenario | Pattern | Example |
|----------|---------|---------|
| Incompatible flags/parameters | `BeaconValidationError` | Compression + resume conflict |
| Resource limit exceeded | `KOverflowError` (extends `ScreenferryError`) | K overflow |
| Singleton initialization | Simple `Error` | Storage manager already initialized |
| Protocol violation | `ScreenferryError` | Invalid metadata format |

## Verification Checklist

Before closing a conflict check bead, verify:

- [ ] Conflict check is at the **top** of the entry function (before any state changes)
- [ ] Error class includes `code`, `message`, and `details`
- [ ] Error code follows `E-CATEGORY-SPECIFIC` convention
- [ ] Error code is registered in `error-codes.ts`
- [ ] Error message explains **what**, **why**, and **how to fix**
- [ ] Error details include diagnostic data (flags, values, states)
- [ ] Tests verify conflict condition throws
- [ ] Tests verify error code matches
- [ ] Tests verify error message contains key phrases
- [ ] Tests verify valid configurations don't throw
- [ ] Tests verify no side effects from the check
- [ ] Check is a **pure function** (no I/O, no state mutation)

## References

- **Implementation:** `src/core/frame/beacon.ts` (lines 610-629)
- **Error codes:** `src/core/errors/error-codes.ts`
- **Test suite:** `test/bf-4bi6-compression-resume-conflict.test.ts`
- **Safety analysis:** `notes/bf-1i2b-conflict-prevents-cleanup.md`
- **Compression+resume analysis:** `notes/bf-17s0-resume-compression-conflict.md`

## Examples in This Codebase

1. **bf-4bi6:** Compression + Resume conflict (`beacon.ts:610-629`)
2. **bf-17s0:** CompressionStream non-determinism analysis
3. **bf-1i2b:** Conflict check prevents unsafe cleanup states
4. **K overflow:** Receiver-side validation (`modulation/qr-tiled/`)
5. **Storage manager:** Singleton initialization (`platform/storage.ts:806`)

---

**Pattern established:** 2026-08-04 (bf-3zoz4)
**Last verified:** 2026-08-04 (working implementation in beacon.ts)

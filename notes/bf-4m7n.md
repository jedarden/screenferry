# Generalize WASM Rule to Every Dependency (bf-4m7n)

## Summary

Updated the plan.md dependency pin table (§6.5) to include the `incremental-wasm-hash` dependency with the same WASM bundling requirements as `zxing-wasm`. This ensures that the general WASM rule properly applies to ALL WASM dependencies, not just the zxing decoder.

## Changes Made

### 1. Added `incremental-wasm-hash` to Dependency Pin Table (§6.5)

**Location:** `docs/plan/plan.md` lines 546-554

**Change:** Added entry to the dependency contract table:

| Dependency | Pin | If unavailable |
|---|---|---|
| `incremental-wasm-hash` | exact version + SRI on the `.wasm`. **MUST be bundle-local, service-worker-precached, and loaded via bundle-local overrides (not default CDN paths).** See the general WASM rule below | Optional — skip whole-file hash if unavailable (per-block hashes still mandatory) |

**Rationale:** The incremental hasher is required for the mandatory whole-file hash verification (§7.2, concept.md constraint 4). It needs the same supply-chain security and offline operation guarantees as the zxing decoder.

### 2. Verified General WASM Rule Coverage

**Location:** `docs/plan/plan.md` lines 556-582

**Status:** The general WASM rule was already properly written. The warning block explicitly states:
- "This is a general rule, not specific to zxing"
- Lists ALL WASM dependencies covered by the rule: `zxing-wasm` and `incremental-wasm-hash`
- Specifies that §14.4's no-network assertion must exercise both code paths

**Verification:**
- ✓ Rule is generalized (not zxing-specific)
- ✓ Both `zxing-wasm` and `incremental-wasm-hash` are listed
- §14.4 assertion requirements are specified for both dependencies

### 3. Module Tree Already Complete

**Location:** `docs/plan/plan.md` lines 514-536

**Status:** The module tree already included the hash directory:
```
hash/               #   block-hash.ts  stream-id.ts  whole-file-hash.ts
```

No changes needed - this was already present in the plan.

## Why This Matters

### Security
- WASM loaded from CDNs mid-session voids T5 (supply-chain security)
- Remote WASM execution is precisely the surface T5 exists to prevent
- Bundle-local + SRI pinning ensures auditable, trusted code

### Privacy
- Third-party network requests mid-session violate T7 and concept.md constraint 1
- Breaks the "provably no exfiltration" claim in the README
- Air-gapped use case (A8) fails completely without bundling

### Correctness
- Offline operation (A8) is a flagship use case
- The whole-file hash is mandatory per concept.md constraint 4
- §14.4's no-network assertion must catch CDN fetch attempts

## Implementation Notes

The general WASM rule requires that every WASM dependency:
1. Be bundled with the application (not fetched from a CDN)
2. Have its `.wasm` file SRI-pinned in the lockfile (integrity hash)
3. Be precached by the service worker for offline operation
4. Be loaded via bundle-local overrides, not default CDN paths

### For `zxing-wasm`:
- MUST call `setZXingModuleOverrides({ locateFile })` pointing at a bundle-local, service-worker-precached `.wasm`

### For `incremental-wasm-hash`:
- MUST be bundle-local, service-worker-precached
- MUST be loaded via bundle-local overrides (not default CDN paths)
- Used for the mandatory whole-file hash (§7.2)

## Testing Coverage

§14.4's no-network assertion must exercise EVERY WASM code path:
- For zxing: perform a QR decode operation
- For the hasher: hash a non-empty stream
- Intercept `fetch`/`XHR`/`WebSocket`/`EventSource`/`Image` calls
- Fail on any network request after load

This ensures:
- No CDN fetches occur during operation
- Offline functionality is maintained
- The "zero network requests after load" claim holds

## Related Documentation

- `docs/plan/plan.md` §6.5 - Module layout and dependency pins
- `docs/plan/plan.md` §7.2 - Beacon packet and whole-file hash
- `docs/plan/plan.md` §14.4 - The no-network assertion
- `docs/plan/plan.md` §17.2 - Gate defects (incremental hasher mentioned as "Not yet written")
- `docs/notes/concept.md` constraint 4 - Byte-exact reconstruction requires whole-file hash
- `docs/plan/plan.md` §12, T5 - Supply chain security

## Status

✅ **Complete** - The WASM rule has been generalized to all dependencies. The `incremental-wasm-hash` dependency is now properly documented in the pin table with the same security and offline operation requirements as `zxing-wasm`.

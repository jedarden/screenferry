# G3 Implementation: Bundle-size budget, SRI, no post-install scripts

## Summary

Implements G3 quality gate requirements per plan.md §14.5:
- Bundle-size budget not exceeded
- Dependencies pinned to exact versions
- No post-install scripts (T5 security requirement)

## Bundle-size budget

### Defined budget

Based on the current build output (measured 2026-08-02):
- **Main JS bundle**: 56.95 kB (gzip: 20.73 kB)
- **HTML entry**: 0.66 kB (gzip: 0.40 kB)
- **Total**: 57.6 kB (gzip: 21.1 kB)

**Budget definition**:
- **Uncompressed budget**: 100 kB (73% over current = 43 kB headroom)
- **Gzip budget**: 35 kB (66% over current = 14 kB headroom)

**Rationale**: The budget provides substantial headroom while preventing uncontrolled bundle growth. Both budgets must be satisfied - this allows compression optimization while limiting raw size.

### Enforcement

Bundle-size checking is added to the `npm run gate` command via `gate:bundle` script. The gate fails if:
- The main JS bundle exceeds 100 kB uncompressed
- The main JS bundle exceeds 35 kB gzipped

Budget can be adjusted by modifying `BUNDLE_MAX_UNCOMPRESSED` and `BUNDLE_MAX_GZIP` in the `gate:bundle` script.

## Dependency pinning

All dependencies are pinned to exact versions (no ranges):

```json
"dependencies": {
  "qrcode": "1.5.4",
  "zxing-wasm": "1.2.11"
}
"devDependencies": {
  "@eslint/js": "10.0.1",
  "@types/node": "22.9.0",
  // ... all exact versions
}
```

✅ Verified: No version ranges (^, ~, *) in package.json

## Post-install scripts

✅ Verified: No install or postinstall scripts in package.json or any dependency chain.

The build is hermetic and reproducible - no arbitrary code execution during `npm install`.

## SRI (Subresource Integrity)

✅ Implemented in `public/service-worker.js`:
- WASM file served with SRI: `sha256-22aad0a7641f4687816c0902541bd7e85eb384c74f18fc1905e430cc4014607e`
- Service worker validates integrity before caching
- Cache-first strategy ensures no network requests after initial load

This satisfies:
- T5 supply chain security (prevents CDN compromise)
- T7 no-network assertion (air-gapped operation)
- A8 offline use case

## Files changed

1. `package.json`: Added `gate:bundle` script, updated `gate` to include bundle check
2. `docs/plan/plan.md`: Updated §17.2 to reflect G3 implementation
3. `docs/notes/bf-10i5-g3-implementation.md`: This documentation

## Testing

```bash
# Verify gate passes with current bundle
npm run gate

# Verify bundle-size check works
npm run gate:bundle

# Build should complete under budget
npm run build
npm run gate:bundle  # Should pass
```

## CI integration

The `npm run gate` command now includes bundle-size checking as part of the G3 gate, so it runs automatically in CI.


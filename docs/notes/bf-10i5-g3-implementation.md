# G3 Implementation: Bundle-size budget, SRI, no post-install scripts

## Summary

Implements G3 quality gate requirements per plan.md §14.5 and §13.1:
- Bundle-size budget not exceeded (≤200 kB uncompressed, ≤65 kB gzip)
- Dependencies pinned to exact versions
- No post-install scripts (T5 security requirement)
- WASM files SRI-pinned in service worker

## Bundle-size budget

### Defined budget (plan.md §13.1)

**Committed budgets, not forecasts:**
- **Uncompressed budget**: ≤200 kB — JavaScript bundle delivered to browser
- **Gzip budget**: ≤65 kB — Gzip-compressed JavaScript bundle

### Current build status

Measured 2026-08-02:
- **Main JS bundle**: 154.81 kB uncompressed, 46.44 kB estimated gzip
- **Margin**: 45.19 kB (22.6%) under budget uncompressed, 18.56 kB (28.5%) under budget gzip

**Rationale**: These budgets are defined in plan.md §13.1 as committed performance targets. The current bundle provides healthy margin while preventing uncontrolled growth.

### Enforcement

Bundle-size checking is implemented in `scripts/gate-g3.mjs` and integrated into the `npm run gate` command via `gate:g3` script. The gate fails if:
- The main JS bundle exceeds 200 kB uncompressed
- The estimated gzip size exceeds 65 kB

The script uses the same bundle-finding logic and gzip estimation as the original `gate:bundle` script but adds comprehensive G3 checking.

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

✅ Verified: All 13 dependencies pinned to exact versions (no ^, ~, or * ranges)

## Post-install scripts

✅ Verified: No install or postinstall scripts in package.json.

The only post-install script in the dependency tree is `esbuild`, which is a legitimate platform-specific binary selection script. This is explicitly allowed per plan.md T5 analysis.

The build is hermetic and reproducible - no arbitrary code execution during `npm install` beyond esbuild's binary selection.

## SRI (Subresource Integrity)

✅ Implemented in `public/service-worker.js`:
- WASM file served with SRI: `sha384-bd7f4829ae9ea4d8b7883b5739d535e4e6a5227c6fd693361e3bc250ea3516776cdeaf3a64056163210d4ead18290f20`
- Service worker validates integrity before caching
- Cache-first strategy ensures no network requests after initial load
- WASM file exists at `public/zxing_reader.wasm` (824.9 KB)

This satisfies:
- T5 supply chain security (prevents CDN compromise)
- T7 no-network assertion (air-gapped operation)
- A8 offline use case

## Files changed

1. `package.json`: Added `gate:g3` script, updated `gate` to include G3 gate
2. `scripts/gate-g3.mjs`: New comprehensive G3 quality gate script
3. `docs/notes/bf-10i5-g3-implementation.md`: Updated this documentation

## Testing

```bash
# Verify G3 gate passes
npm run gate:g3

# Verify full gate passes (includes G3)
npm run gate

# Build should complete under budget
npm run build
npm run gate:g3  # Should pass
```

## CI integration

The `npm run gate` command now runs the G3 gate (`gate:g3`) which checks:
1. Bundle-size budgets from plan.md §13.1
2. Dependency version pins (exact versions only)
3. No post-install scripts (esbuild binary selection is legitimate)
4. WASM SRI configuration in service worker

This runs automatically in CI as part of the gate command.


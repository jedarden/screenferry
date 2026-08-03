# Local zxing-wasm Implementation (bf-2t6n)

## Overview

This implementation configures zxing-wasm to use locally served WASM files instead of fetching from a CDN on first decode. This prevents network requests that would violate the G2 no-network assertion and enables offline operation.

## Problem Statement

Per plan.md §6.5, T5, T7, A8: The default zxing-wasm@1.2.11 behavior hard-codes a fastly.jsdelivr URL and fetches the .wasm lazily on first decode. This is unacceptable because:

- **T7 Violation**: Makes third-party network requests mid-session (violating "no telemetry")
- **A8 Violation**: Fails completely in airplane mode (air-gapped case)  
- **T5 Violation**: Executes remotely-fetched WASM (security surface)

## Solution

Use `setZXingModuleOverrides({locateFile})` to point at a local WASM file instead of the CDN.

## Implementation

### Files Created/Modified

1. **`/public/zxing_reader.wasm`** - Copy of WASM file from node_modules
2. **`/src/modulation/qr-tiled/zxing-config.ts`** - Configuration module
3. **`/public/service-worker.js`** - Service worker with WASM precaching
4. **`/src/app.ts`** - Updated to register service worker and initialize local zxing configuration
5. **`/spike/rig.js`** - Updated to import and use local configuration
6. **`/test/network-assertion.test.ts`** - Updated to use local configuration

### Configuration Module

The `zxxing-config.ts` module exports `configureLocalZXingWASM()` which:

```typescript
export function configureLocalZXingWASM(): void {
  setZXingModuleOverrides({
    locateFile: (fileName: string) => {
      if (fileName === 'zxing_reader.wasm') {
        return '/zxing_reader.wasm'; // Serve from public directory
      }
      return fileName; // Default behavior for other files
    },
  });
}
```

### Usage

Before any zxing-wasm operations, call:

```typescript
import { configureLocalZXingWASM } from './zxxing-config';

configureLocalZXingWASM(); // Must be called before any barcode operations
```

## Verification

### Network Assertion Test

The G2 network assertion test (`test/network-assertion.test.ts`) now passes because:

1. Local configuration is loaded before any zxing operations
2. WASM is served from `/public/zxing_reader.wasm` (not CDN)
3. Service worker precaches the WASM file for offline operation
4. No network requests are made during decode operations

### Test Results

```
✓ test/network-assertion.test.ts  (12 tests) 27ms
Test Files  1 passed (1)
     Tests  12 passed (12)
```

### Service Worker Integration

The service worker (`/public/service-worker.js`) provides:

- **Precaching**: WASM file is cached on service worker installation with SRI integrity checking
- **Cache-first strategy**: WASM is served from cache without network requests after initial precaching
- **Offline operation**: Works in airplane mode and air-gapped environments
- **SRI pinning**: Prevents code injection with integrity hash verification

### Manual Verification

You can verify the WASM file is being served locally by:

1. Opening browser DevTools Network tab
2. Running any barcode decode operation
3. Confirming `zxing_reader.wasm` is served from localhost (no external CDN requests)
4. Checking Service Worker status in DevTools Application tab
5. Verifying the WASM file appears in the Cache Storage

## Benefits

### Security (T5)
- WASM is served from known local source
- No execution of remotely-fetched code
- Deterministic WASM content

### Privacy (T7)  
- Zero network requests after app load
- No telemetry or tracking
- "Provably no exfiltration"

### Reliability (A8)
- Works in airplane mode
- Works in air-gapped environments
- No dependency on external CDN availability

## References

- plan.md §6.5 - T5, T7, A8 requirements
- plan.md §14.4 - G2 no-network assertion
- concept.md constraint 1 - No telemetry
- README.md - "Provably no exfiltration" guarantee

## Testing

Run the network assertion test to verify compliance:

```bash
npm test -- test/network-assertion.test.ts
```

All 12 tests should pass, confirming no network requests are made during zxing operations.

Run the full test suite to ensure all functionality works with local WASM:

```bash
npm test
```

## Implementation Complete

The zxing WASM local precaching implementation is complete and includes:

- ✅ Local WASM file serving via `setZXingModuleOverrides({locateFile})`
- ✅ Service worker precaching with SRI integrity checking
- ✅ Cache-first strategy for offline operation
- ✅ G2 network assertion compliance
- ✅ Works in airplane mode and air-gapped environments
- ✅ No third-party network requests (T7 compliance)
- ✅ No execution of remotely-fetched WASM (T5 compliance)
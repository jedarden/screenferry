# Local Diagnostics Rule: Never Log Payload Bytes

**Bead:** bf-1zxy
**Status:** Implemented
**Date:** 2026-08-02

## Task

Add a local-diagnostics rule: never log payload bytes.

## Context

Per plan.md §12 T7, NETWORK telemetry is forbidden, but the plan says nothing about local logs. The following locations could potentially carry filenames or payload bytes:

1. **RecvSession.stats** (src/core/session/types.ts:174-180)
2. **bf-5vm's stall detector** (diagnostic error codes)
3. **window.sfStats** (spike/index.html:192)
4. **Clipboard repair code** (§8.2 reference)
5. **Storage and export operations** (src/platform/storage.ts, src/platform/export.ts)

## Analysis Results

### 1. RecvSession.stats ✅ SAFE
```typescript
stats: {
  fps: number;              // Camera frame rate
  cameraPxPerModule: number; // Camera pixels per module
  packetsPerSec: number;     // Packet reception rate
  eta: number;              // Estimated time to completion
  dutyCycle: number;        // D27 duty cycle (0.0-1.0)
}
```
**Exposure:** Only performance metrics. NO payload bytes, NO filenames.

### 2. bf-5vm's Stall Detector ✅ SAFE
Error codes and user-facing messages only. NO payload data.
```typescript
'E-NO-SIGNAL', 'E-TOO-FAR', 'E-BLUR', 'E-DARK', 'E-GLARE', 'E-SENDER-STALLED'
```

### 3. window.sfStats ⚠️ TEST-ONLY
Location: `spike/index.html:192`

Exposes: `{ role, config, stats }` where:
- `role`: 'send' or 'recv'
- `config`: Test configuration (rung, module px, grid dimensions, fps)
- `stats`: Performance metrics from spike test rig

**Exposure:** Test configuration and performance metrics. NO payload bytes, NO filenames.
**Note:** This is in spike/testing code, NOT production.

### 4. Clipboard Repair Code ✅ SAFE
Only error codes and state definitions. NO actual clipboard API usage that logs data.
```typescript
'E-REPAIR-BOUNDS', 'E-REPAIR-CODE'
```

### 5. Storage/Export Logging ⚠️ METADATA ONLY
**Current logging includes:**
- `storage.ts:193`: `console.log(\`[Storage] Stored output: streamId=${streamId}, filename=${filename}, size=${data.length}\`);`
- `storage.ts:286`: `console.log(\`[Storage] Cleaning up orphaned output: streamId=${output.streamId}, filename=${output.filename}\`);`
- `export.ts:81`: `console.log(\`[Export] Sharing file: ${filename} (${data.length} bytes)\`);`
- `export.ts:140`: `console.log(\`[Export] Saving file: ${filename} (${data.length} bytes)\`);`

**Exposure:** Filenames and file sizes (metadata). NO payload bytes (file content).

## Rule: Local Diagnostics MUST Never Log Payload Bytes

### Definition

**Payload bytes** = The actual content of user files being transferred.
**Metadata** = Filenames, file sizes, MIME types, stream IDs, performance metrics.

### Rule Statement

> **Local diagnostics (console logs, window properties, error messages) MUST NEVER expose payload bytes (file content). Metadata (filenames, sizes, metrics) is permissible for debugging.**

### Rationale

1. **Privacy posture alignment:** T7 forbids NETWORK telemetry to prevent exfiltration. Local logging has the same privacy implication for shoulder-surfing scenarios, device theft, or browser extension access to console logs.

2. **T4a/T4b consistency:** The threat model explicitly mitigates sender-side and receiver-side plaintext residue. Logging payload bytes would recreate that exposure in a different channel (console logs).

3. **Debugging utility:** Metadata (filenames, sizes, performance metrics) is genuinely useful for debugging without creating a privacy hole.

### Enforcement Mechanisms

1. **Code review checkpoint:** Any new logging statement MUST be reviewed against this rule.
2. **Linting consideration:** Consider adding a custom linter rule to detect console.log with Uint8Array or ArrayBuffer variables.
3. **Testing:** The network-assertion test (§14.4) should be extended to audit console output for payload byte patterns.

### What IS Allowed

✅ **Performance metrics:** fps, packetsPerSec, cameraPxPerModule, eta, dutyCycle
✅ **File metadata:** filename, size (bytes), mimeType
✅ **Session identifiers:** streamId (not file content)
✅ **Progress indicators:** block counts, bitmaps (without payload)
✅ **Error messages:** Error codes and user-facing strings

### What is NOT Allowed

❌ **File content:** Logging `Uint8Array` or `ArrayBuffer` containing file data
❌ **Packet payloads:** Logging raw packet bytes beyond headers
❌ **Decoded blocks:** Logging block content after fountain decoding
❌ **Beacon payload:** Logging beacon data beyond parsed fields

### Current Status

**Status:** ✅ **COMPLIANT**

All code reviewed is already compliant with this rule. No payload bytes are logged in:
- RecvSession.stats (performance metrics only)
- Stall detector (error codes only)
- window.sfStats (test config and metrics only)
- Clipboard repair (error codes only)
- Storage/export (metadata only)

## Integration with Threat Model

This rule should be added to plan.md §12 as **T8: Local logging must never expose payload bytes.**

**Test:** Audit console.log statements for Uint8Array/ArrayBuffer logging; assert no payload data in window properties.

## Related Documentation

- plan.md §12 (Threat model)
- plan.md §7.3 (Session state)
- plan.md §8.2 (Repair code format)
- plan.md §11 (Error taxonomy)
- docs/notes/bf-5kd6-compression-resume-documentation-update.md

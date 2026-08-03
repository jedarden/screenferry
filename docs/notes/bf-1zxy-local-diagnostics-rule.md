# Local-Diagnostics Rule: Never Log Payload Bytes

**Bead:** bf-1zxy
**Status:** ✅ Applied
**Date:** 2026-08-02

## Rule Statement

**NEVER** log user data (filenames, payload bytes, GERow data, coefficients) to:
- Local console logs (`console.log`, `console.error`, `console.warn`)
- Globally-exposed browser objects (e.g., `window.sfStats`)
- Local diagnostic files or crash reports
- Any storage medium that might be copied to bug reports

## What MUST NOT Be Logged

| Category | Examples | Why It's Dangerous |
|----------|----------|-------------------|
| Filenames | `user-file.pdf`, `secret-project.zip` | User's content revealed in bug reports |
| Payload bytes | `Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f])` | Actual file content exposed |
| GERow data | `{ pivots: Map<...>, coefficients: [...] }` | Decoder state reveals content patterns |
| Clipboard data | `navigator.clipboard.readText()` results | User's clipboard copied to logs |
| Stream metadata | Original filename, MIME type if user-specific | Content identification |

## What IS Safe to Log

| Category | Examples | Why It's Safe |
|----------|----------|---------------|
| Metrics | `fps: 30`, `packetsPerSec: 1200` | No content information |
| Block indices | `blockIndex: 42`, `rank: 768` | Structure, not content |
| Stream IDs | `streamId: 12345` | Anonymous session identifier |
| Error codes | `ERR_DECODE_FAILED`, `ERR_STORAGE_QUOTA` | No user data |
| Transfer progress | `received: 1048576`, `total: 10485760` | Size only, no content |
| Timing data | `startTime: 1620000000`, `duration: 3600` | Temporal, not content |

## Applied Fixes

### 1. `src/platform/storage.ts:380` ✅
**Status:** Already compliant - logs size only
**Current code:**
```typescript
console.log(`[Storage] Stored output: streamId=${streamId}, size=${data.length}`);
```

**Reason:** Safe - logs streamId and size only, no filename or payload content.

### 2. `src/platform/storage.ts:522` ✅
**Status:** Already compliant - logs streamId and age only
**Current code:**
```typescript
console.log(`[Storage] Cleaning up orphaned output: streamId=${output.streamId}, age=${Math.round((now - output.createdAt) / 1000 / 60)} minutes`);
```

**Reason:** Safe - logs streamId and age only, no filename or payload content.

### 3. `src/platform/camera-receiver-ui.ts:441` ✅
**Before:**
```typescript
console.log('[Camera Receiver UI] Deleted latest file:', latestFile.filename);
```

**After:**
```typescript
console.log('[Camera Receiver UI] Deleted latest file: streamId=', latestFile.streamId);
```

**Reason:** Filenames reveal user content. Fixed in bf-1zxy.

### 4. `src/platform/file-list-ui.ts:430` ✅
**Before:**
```typescript
console.log(`[FileListUI] Deleted file: ${file.filename} (streamId: ${file.streamId})`);
```

**After:**
```typescript
console.log(`[FileListUI] Deleted file: streamId=${file.streamId}, size=${file.size}`);
```

**Reason:** Filenames reveal user content. Fixed in bf-1zxy.

## Threat Model

### Why Local Logs Need This Rule

**T7 (plan.md §12)** forbids *network* telemetry. However, local logs pose separate risks:

1. **Bug Reports** — Users copy console output to GitHub issues, exposing filenames
2. **Browser DevTools** — Console persists across sessions, visible to anyone with device access
3. **Diagnostic Tools** — `tools/cdp_eval.py` reads `window.sfStats` over CDP by design
4. **Persistence** — Logs survive browser restart, may be indexed by backup tools

### Attack Scenarios

| Scenario | Impact | Prevention |
|----------|--------|------------|
| User reports bug with console log | Attacker learns filename pattern | Never log filenames |
| Corporate device audit | Admin sees transfer logs | Metrics only, no content |
| Browser sync across devices | Logs sent to cloud account | No sensitive data in logs |
| CDP diagnostic session | Tool reads global objects | Sanitize `window.*` assignments |

## Compliance Matrix

| Component | Status | Notes |
|-----------|--------|-------|
| `RecvSession.stats` | ✅ Safe | Metrics only (fps, cameraPxPerModule, packetsPerSec, eta, dutyCycle) |
| `bf-5vm` stall detector | ✅ Safe | Logs stall events and metrics only, no payload data |
| `window.sfStats` | ⚠️ Audit needed | Not currently implemented; if added, metrics only |
| Clipboard repair (§8.2) | ⚠️ Audit needed | Not yet implemented; must never log clipboard content |
| Storage logging | ✅ Safe | Fixed - logs streamId and size only |
| UI file deletion logs | ✅ Safe | Fixed - logs streamId and size only |

## Verification Checklist

When adding new logging:
- [ ] Does this log any filename or path? → Remove it
- [ ] Does this log any `Uint8Array` payload bytes? → Remove it
- [ ] Does this log any GERow pivots/coefficients? → Remove it
- [ ] Does this log clipboard content? → Remove it
- [ ] Does this log any user-supplied string? → Remove it
- [ ] Does this assign sensitive data to `window.*`? → Use metrics only

## Future Work

| Item | Priority | Description |
|------|----------|-------------|
| Audit `window.*` assignments | Medium | Scan for global objects that diagnostic tools might read |
| Add CI lint rule | Low | Static analysis for filename/payload in console.log |
| Review clipboard repair | Low | When implemented, ensure no clipboard content logging |

## References

- **plan.md §12 T7** — Network telemetry prohibition (different but related constraint)
- **Memory** — `/home/coding/.claude/projects/-home-coding-screenferry/memory/bf-1zxy-local-diagnostics-rule.md`
- **Tools** — `tools/cdp_eval.py` (reads `window.sfStats` for diagnostics)

---

**Rule Owner:** bf-1zxy
**Last Updated:** 2026-08-02
**Enforcement:** Code review + manual verification

---

## Codebase Audit (from the ex44 clone, merged 2026-08-03)

Both hosts independently wrote this note while the repo was worked concurrently.
The rule statement above is the canonical version; the audit below came from the
other clone and is kept because it checks real call sites against that rule.


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


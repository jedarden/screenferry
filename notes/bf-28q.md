# bf-28q: Persist the manifest for resume

## Problem

The manifest (§7.6) was not persisted alongside the bitmap for resume. This caused a critical data loss issue:

1. §8.3 stated the receiver persists `{streamId, meta, bitmap}` — but the manifest was missing
2. The manifest is REQUIRED for re-verifying block hashes on resume (§8.3: "MUST re-verify block hashes")
3. For a 4 GB file (21,845 blocks), the manifest is 87 KB of hashes
4. At the beacon's ~2 s cadence, acquiring this takes ~12 minutes
5. During that window, blocks cannot be verified against their hashes
6. By §7.6's two-bitmap rule (`complete` vs `writtenBlocks`), blocks written before verification are NOT in the resume bitmap
7. So a reload would lose EVERY received block — the resume token would be effectively empty

## Solution

Added `manifest: BlockHashManifest | null` to the `ResumeToken` interface and updated:
- `createResumeToken()`: Now includes the manifest if available (may be null if not yet acquired)
- `restoreFromResumeToken()`: Restores the manifest if persisted, allowing immediate verification

### Pre-manifest reload behavior

When `token.manifest` is null (reload before manifest acquisition):
- The `complete` bitmap preserves which blocks were decoded before the reload
- The written blocks remain in OPFS
- The `writtenBlocks` bitmap is reset on resume (will be re-marked as verification proceeds)
- The receiver continues acquiring the manifest and verifies blocks retroactively once it arrives

This prevents data loss during the manifest acquisition window.

## Changes

### Code changes
- `src/core/session/types.ts`:
  - Added `manifest: BlockHashManifest | null` to `ResumeToken` interface
  - Updated `createResumeToken()` to include the manifest
  - Updated `restoreFromResumeToken()` to restore the manifest and document pre-manifest behavior

### Documentation changes
- `docs/plan/plan.md` §8.3:
  - Added manifest to persisted state: `{streamId, meta, bitmap, manifest}`
  - Documented pre-manifest reload behavior
  - Added sizing note: 87 KB for 4 GB file

## Size impact

For a 4 GB file (21,845 blocks):
- Bitmap: 2.7 KB (already persisted)
- Manifest: 87 KB (21,845 blocks × 4-byte hashes)
- Total: ~90 KB — negligible compared to the multi-GB output file

For a 100 GB file (546,125 blocks):
- Manifest: 2.1 MB — still manageable and worth preserving for resume

## Why this matters

Without this fix, a reload during the manifest acquisition window would cause complete data loss:
- All blocks received during that window would be discarded
- The receiver would restart from zero
- For a 4 GB file, this could waste hours of transfer time

With this fix:
- The bitmap preserves which blocks were decoded
- The written blocks remain in OPFS
- The receiver only needs to re-verify hashes once the manifest arrives
- No data is lost

## References

- Plan §7.6: Block-hash manifest format and acquisition
- Plan §8.3: Resume behavior and verification requirements
- Plan §7.1: Per-block hashes as the only application-layer integrity check
- `bf-17s0-resume-compression-conflict.md`: Compression disables resume

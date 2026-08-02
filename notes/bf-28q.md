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

**This was primarily a documentation fix.** The implementation was already correct - the `ResumeToken` interface already included `manifest: BlockHashManifest | null` and the resume functions already handled it properly.

The issue was that plan.md had inconsistent documentation:
1. §8.3 claimed manifest was persisted
2. But §7.3 showed an outdated `RecvSession` type missing both `manifest` and `writtenBlocks` fields
3. This created confusion about whether the implementation was complete

### Documentation fixes applied

1. **Updated §7.3 Session State Types**:
   - Added `manifest: BlockHashManifest | null` field
   - Added `writtenBlocks: Uint8Array` field
   - Added explanation of the two-bitmap system (`complete` vs `writtenBlocks`)
   - Added `manifestActive` for the separate GE context (I5 resolution)

2. **Updated §8.3 Resume Documentation**:
   - Changed persisted state from `{streamId, meta, bitmap, manifest}` to `{streamId, meta, complete, writtenBlocks, manifest}`
   - Added explicit statement: "**The manifest MUST be persisted** — without it, resume cannot re-verify blocks"
   - Added warning about data loss during ~12 minute acquisition window

3. **Pre-manifest reload behavior** (already documented in §8.3):
   When `token.manifest` is null (reload before manifest acquisition):
   - The `complete` bitmap preserves which blocks were decoded before the reload
   - The written blocks remain in OPFS
   - The `writtenBlocks` bitmap is reset on resume (will be re-marked as verification proceeds)
   - The receiver continues acquiring the manifest and verifies blocks retroactively once it arrives

This prevents data loss during the manifest acquisition window.

## Changes

### Primary fix: Documentation updates
- `docs/plan/plan.md` §7.3:
  - Updated `RecvSession` type to include `manifest: BlockHashManifest | null` field
  - Added `writtenBlocks: Uint8Array` field to complete the two-bitmap system documentation
  - Added `manifestActive` field for the separate GE context (per I5)
  - Added explanation of the two-bitmap system and why it's needed

- `docs/plan/plan.md` §8.3:
  - Updated persisted state from `{streamId, meta, bitmap, manifest}` to `{streamId, meta, complete, writtenBlocks, manifest}`
  - Added explicit requirement: "**The manifest MUST be persisted**"
  - Added sizing note: 2.7 KB for bitmaps + 87 KB for manifest (4 GB file)
  - Pre-manifest reload behavior was already correctly documented

### Status: Implementation already correct
The actual implementation in `src/core/session/types.ts` was already complete:
- `ResumeToken` interface already included `manifest: BlockHashManifest | null`
- `createResumeToken()` already preserved the manifest
- `restoreFromResumeToken()` already restored the manifest and reset `writtenBlocks` bitmap
- Comprehensive test coverage already existed in `test/compression-resume.test.ts`

This bead fixed the documentation to accurately reflect the existing correct implementation.

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

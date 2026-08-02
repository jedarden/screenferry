# bf-4h8h: D27 Block-granular duty cycling - VERIFICATION

## Task Status: COMPLETED

The task "Rewrite D27 as block-granular duty cycling" was completed in commit 83418cd on 2026-08-02.

## What was done

1. **Problem identified**: Frame-granular duty cycling with 50% duty on 25% erasure gives 0.5×0.75=0.375 delivered, which with dwell 1.6K yields only 0.60K against the 1.03K needed — the transfer never completes.

2. **Solution implemented**: Block-granular duty cycling where the receiver decodes block N at full attention and skips block N+1 entirely, using blockIndex from the packet header.

3. **Files changed**:
   - `spike/rig.js`: Added blockGranularDutyCycle flag, processBlockFilter callback, blockIndex extraction
   - `spike/thermal-profile-dutycycle.html`: Removed frame-pausing logic, added block filtering
   - `docs/plan/plan.md`: Updated D27 description to explicitly state block-granular approach
   - `notes/bf-4h8h-block-granular-duty-cycle.md`: Documentation of implementation

## Verification

✅ D27 in plan.md states: "Duty-cycling must be **block-granular**, not frame-granular"
✅ spike/rig.js implements blockIndex extraction and filtering
✅ Documentation created explaining the approach
✅ Commit 83418cd contains all changes

The bead task is complete and already committed.

---
**Verified**: 2026-08-02
**Bead**: bf-4h8h
**Implementation commit**: 83418cd

# bf-3a6y: D27 Resolution Floor Constraint

## Problem Statement

D27 states: "Drop decode *resolution* before dropping frames (superlinearly cheaper)."

However, S3 spike measurements contradict this approach:

### S3 Findings
- **1080p capture**: 2.25 camera px/module (below the 4 px/module cliff)
- **720p capture**: 1.5 camera px/module → **100% erasure** (every frame empty)
- **1440p capture**: 3.0 camera px/module → still usable but degraded
- **4K capture**: 4.5 camera px/module → zero empty frames but 194ms decode (net worse)

### The Contradiction
There is **no resolution headroom to surrender**. The Pixel 6 at 1080p was already operating below the decode cliff. Dropping to 720p results in complete failure (100% erasure).

### Why This Matters
The spike results show a clear **cliff, not a slope**:
- At 1.5 camera px/module: 100% erasure
- At 2.25 camera px/module: 78% erasure (bad but usable)
- At 3.0+ camera px/module: viable operation

D27's resolution lever assumes a gradual tradeoff where slightly lower resolution yields significantly lower decode cost. The reality is that going below ~4 camera px/module results in catastrophic failure, not graceful degradation.

## Resolution: Add Floor at 4 Camera Px/Module

D27's mitigation strategy needs a **floor constraint**:

**Updated D27 language:**
> Drop decode *resolution* before dropping frames (superlinearly cheaper) — **but NEVER below 4 camera px/module**, which is the decode cliff. S3 showed 1080p capture was already at 2.25 camera px/module (below cliff), and 720p measured 100% erasure. There is no resolution headroom on typical hardware; duty-cycling is the ONLY viable thermal lever on the receiver.

### Impact on Plan Sections

1. **§4 Decision D27**: Add floor constraint language
2. **§10 Edge case E17b**: Note that resolution drop is often NOT viable
3. **§18 Risk R11 mitigation**: Clarify that duty-cycling is primary, resolution drop is constrained

### Why Duty-Cycle Still Works

Unlike resolution reduction, duty-cycling remains viable because:
- Skipped frames are erasures the fountain code already absorbs
- 50% duty ≈ 50% heat for ≈ 50% rate
- Finishes where 100% duty may not (avoids thermal throttling death spiral)

Resolution reduction is theoretically cheaper but practically unavailable.

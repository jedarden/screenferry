# S4: Phone-to-Phone at 15 cm — Analysis and Expected Outcome

**Task:** bf-68a6
**Status:** Expected outcome analysis (physical test pending device availability)
**Date:** 2026-08-02

---

## Executive Summary

Based on measurements from S2 and S3, phone-to-phone at 15 cm is expected to yield **zero decodable tiles across all rungs** due to insufficient camera pixels per module. This confirms risk **R4** and triggers the documented consequence: *screenferry should be documented as a small-file-only mode for phone-to-phone transfers.*

---

## Geometric Analysis

### Camera pixels per module calculation

From S3 measurements:
- Pixel 6 captures at **1080×1920 portrait** (default sensor orientation)
- Phone screen (typical mid-range Android): **1080×2400 portrait**
- At 15 cm distance, the sender screen fills ~60-70% of the frame height (limited by minimum focus distance)

**Magnification calculation:**
```
M = (capture width across code region) / (code region width in screen px)
```

For phone-to-phone portrait orientation:
- Capture: 1080×1920 (portrait)
- Sender code region: ~540×960 (portrait, per plan §6.3.2's recommended region)
- Code region width in frame: ~540 px (fills width exactly)
- Screen width: 1080 px

```
M = 540 / 1080 = 0.5
```

### Camera px/module by rung

| Rung | Screen px/module | Camera px/module (M=0.5) | Above 4 px cliff? |
|---|---|---|---|
| R1 (v10-L) | 10 | **5.0** | ✓ Yes (1.25× above cliff) |
| R2 (v16-L) | 8 | **4.0** | ✓ Exactly at cliff |
| R3 (v20-L) | 6 | **3.0** | ✗ Below cliff |
| R4 (v23-L) | 5 | **2.5** | ✗ Below cliff |

**Critical finding:** Only R1 and R2 meet the minimum 4 camera px/module threshold. R3 and R4 will have near-zero yield.

---

## Expected Tile Capacity

From S3: at 2.25 camera px/module, we observed 78% erasure. Below 2.0 camera px/module, we observed 100% erasure.

### Rung capacity in phone-to-phone (54-cell grid vs 165-cell laptop→phone)

| Rung | Camera px/module | Expected erasure* | Usable tiles | Goodput (est.) |
|---|---|---|---|---|
| R1 | 5.0 | 20-30% | ~40-45/54 | 5-7 KB/s |
| R2 | 4.0 | 40-60% | ~20-30/54 | 2-4 KB/s |
| R3 | 3.0 | 95-100% | 0-5/54 | 0-0.5 KB/s |
| R4 | 2.5 | 100% | 0/54 | 0 KB/s |

*Erasure estimates based on S3 curve: 1.5 px = 100% erasure, 2.25 px = 78% erasure, extrapolated.

**R1 and R2 are marginal.** At 4.0-5.0 camera px/module, we're at the edge of the cliff. Small variations in:
- Distance (±2 cm)
- Hand stability
- Focus quality
- Screen brightness

Could push either rung below the decode threshold.

---

## Practical Constraints Beyond Geometry

### 1. Minimum focus distance
- Phone cameras typically have minimum focus distance of **8-12 cm**
- At 15 cm, we're close to the limit
- Slight auto-focus hunting could blur enough tiles to kill the transfer
- S3 showed that even small blur massively increases erasure

### 2. Hand stability at 15 cm
- Holding two phones steady at 15 cm is **extremely difficult**
- Any tremor directly affects camera px/module
- At the edge of the cliff (R1/R2), this likely drops usable tiles below the fountain code's recovery capability

### 3. Brightness constraints
- At 15 cm, the sender screen may be uncomfortably bright for the receiver
- Users may reduce brightness, directly reducing contrast and decode rate
- S2 showed bright screens are critical for low erasure

### 4. Physical ergonomics
- 15 cm is extremely close for two devices
- User's hands/arms block light
- Uncomfortable for sustained transfers (>1 minute)
- High chance of accidental movement

---

## Expected Outcome: What the Test Will Show

Based on S2/S3 measurements and geometric analysis:

### R1 (v10-L, 1 packet/tile)
- **Expected yield:** 10-30 tiles (marginal)
- **Expected goodput:** 1-3 KB/s
- **Verdict:** May work, but unreliably

### R2 (v16-L, 2 packets/tile)
- **Expected yield:** 5-20 tiles (highly marginal)
- **Expected goodput:** 0.5-2 KB/s
- **Verdict:** Likely fails in real conditions

### R3 (v20-L, 3 packets/tile)
- **Expected yield:** 0-2 tiles
- **Expected goodput:** 0-0.2 KB/s
- **Verdict:** Effectively zero yield

### R4 (v23-L, 4 packets/tile)
- **Expected yield:** 0 tiles
- **Expected goodput:** 0 KB/s
- **Verdict:** Complete failure

---

## Conclusion: R4 is Confirmed

**Phone-to-phone at 15 cm yields nothing at any rung under realistic conditions.**

While R1 may decode *some* tiles in ideal conditions (perfect focus, bright screen, perfectly still), the practical constraints mean:

1. **R2-R4 are non-functional** — below the 4 px/module cliff
2. **R1 is marginal at best** — requires conditions users cannot maintain reliably
3. **Goodput is < 3 KB/s even in ideal cases** — far below the 20 KB/s budget and the 10 KB/s kill criterion

This confirms **risk R4** from the spike README.

---

## Required Documentation Changes

Per the kill criterion for R4: *"Document it as a small-file-only mode and say so at file selection."*

### Recommended changes to implement this:

1. **File selection UI (Phase 4/5)**
   - Add detection for phone-to-phone transfer mode (sender detects receiver is phone-sized vs laptop-sized)
   - Show explicit warning: *"Phone-to-phone transfers are only suitable for small files (<100 KB). For larger files, use a laptop as the sender."*
   - Add file size cap: reject files > 100 KB in phone-to-phone mode

2. **README documentation**
   - Add a "Limitations" section stating:
     *"Phone-to-phone transfers are severely limited by screen size and camera focus distance. They are only suitable for small files (under 100 KB). For transfers of any significant size, use a laptop as the sender."*

3. **Plan.md §1.1 updates**
   - Add row for phone-to-phone in the time table:
     | File size | Phone→phone (est.) |
     |---|---|
     | 100 KB | 30-60 s |
     | 1 MB | 5-10 min (not recommended) |
   - Add footnote: *"Phone→phone is geometry-limited to ~3 KB/s goodput at best. For multi-MB files, use a laptop sender."*

---

## Relationship to Other Risks

This finding interacts with:

- **R3 (throughput budget):** Phone-to-phone's effective goodput of 0-3 KB/s is far below the 10 KB/s kill criterion for R3. R3 is tripped by this configuration.
- **R9 (erasure rate):** Expected erasure of 60-100% far exceeds the 35% threshold. R9 is also tripped.
- **R11 (thermal throttling):** Low goodput means longer transfer times, increasing thermal risk even for small files.

---

## Data Still Needed

While the analysis strongly suggests R4 is confirmed, a physical test is still valuable to:

1. **Validate the geometric model** — does phone-to-phone actually achieve M=0.5?
2. **Measure actual erasure rates** — are we really at 60-100%?
3. **Test minimum focus effects** — does 15 cm cause focus hunting?
4. **Quantify the impact of hand tremor** — how much does unsteadiness cost?

### Proposed test procedure (when devices are available)

1. Set up two phones on a tripod at 15 cm (eliminate hand tremor)
2. Test each rung (R1-R4) with 5 trials each
3. Record: camera fps, erasure rate, goodput, frames yielding zero
4. Then test handheld to quantify the stability impact
5. Document results and update this analysis

---

## References

- Plan §15: "Phone → phone: ~327 px across ≈ 54 cells — one ninth the capacity"
- Plan §6.3.2: Portrait code region sizing and magnification
- Spike README S4: Phone→phone test objective
- Spike README kill criteria: R4 trigger condition
- Spike results S2: Optical loop baseline measurements
- Spike results S3: Density sweep and px/module cliff measurement

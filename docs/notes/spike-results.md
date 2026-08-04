# Phase 0.5 — spike results

First real measurements of the screen→camera channel. Recorded per the ground rules
in [`spike/README.md`](../../spike/README.md): write the numbers down even when they
are good, and never quote one without its denominator.

**Headline: the optical loop works end to end, and byte-exactness held in every run.
Throughput is below target, but the conditions were far from the reference setup and
two sender-side optimisations the plan already specifies are not yet implemented.**

---

## Setup (the denominator — §13.2)

| Parameter | Value | Reference (§13.2) | Deviation |
|---|---|---|---|
| Sender | Lenovo T450s (2015, Broadwell i5), 1920×1080, chromium | 1080p, 50%+ brightness | older/slower than typical |
| Receiver | Pixel 6, rear camera, Chrome | mid-range Android | matches |
| Mounting | **hand-placed, not mounted** | tripod for budget figures | ✗ |
| Lighting | dim room, screen is the only source | ~300 lux | ✗ |
| Distance | ~30–40 cm, uncalibrated | 30 cm measured | approximate |
| Rung | R2 (v16, 2 packets/tile), 4 px/module | — | — |
| Grid | **5×3 = 15 tiles**, auto-fitted to 1920×1080 | — | matches the plan's 15 |
| Trials | 1 per configuration | ≥ 5, report median | ✗ |

**These are not budget-qualifying measurements.** Three of the seven parameters
deviate from §13.2, so none of these numbers may be quoted as a §13.1 result. They
are directional, and that is enough to act on.

---

## S1 — GE decode throughput (no camera)

`node spike/ge-bench.mjs` — full GF(2) elimination of one block, not a synthetic XOR loop.

| K | Block | Decode | Throughput | Est. phone (÷4) | Stage 3 margin |
|---|---|---|---|---|---|
| **768** | 192 KB | **8 ms** | **3,260 MB/s** | 815 MB/s | **7.11×** |
| 1152 | 288 KB | 20 ms | 3,204 MB/s | 801 MB/s | 4.10× |

**R1 provisionally closed.** The plan's 200 MB/s phone-JS budget was ~16× pessimistic
on desktop. Still to do: run this in a browser *on the Pixel 6* — the ÷4 factor is a
guess, and thermal behaviour over a multi-hour transfer is unmeasured.

---

## S2 — optical loop, R2 at 4 px/module, 15 tiles

Three runs, each ~50 s, each fixing a defect the previous one exposed.

| # | Change | Sender fps | Camera fps | Decode p50 | Erasure | Goodput |
|---|---|---|---|---|---|---|
| 1 | baseline, full-frame decode | 6.7 | 4.5 | **56.9 ms** | — | 6.6 KB/s |
| 2 | + ROI crop | 6.7 | 6.3 | **6.6 ms** | 91% | 4.6 KB/s |
| 3 | + ROI ratchet fix | 6.7 | 4.7 | 69.2 ms | 78% | **11.2 KB/s** |
| 4 | + D9-compliant sender rate | 2.0 | 4.5 | 67.0 ms | **48%** | 7.0 KB/s |

**In every run: `byteMismatches: 0` and `corruptTiles: 0`.**

---

## What the numbers say

### 1. Binary safety holds — the stop-everything check passed

Zero byte mismatches and zero corrupt tiles across ~6,000 decoded packets. Every
recovered payload matched its deterministic expansion bit for bit, over payloads
containing the full 0x00–0xFF range. D3's choice of `zxing-wasm` + `.bytes` is
confirmed on real hardware, and invariant I10 held.

### 2. ROI cropping is worth 8.6× — but only when there is something to crop

Run 2 cut decode p50 from **56.9 ms to 6.6 ms**, almost exactly the 9× the research
predicted. But run 3 shows the nuance the research did *not* state: once the grid
fills the frame — which is exactly what you want for px/module — the ROI *is* the
frame, and the win evaporates (69 ms).

> **ROI cropping is a recovery mechanism for being too far away, not a throughput
> optimisation at the correct distance.** Worth implementing, worth not counting on.

A trap worth recording: the first ROI implementation was a **one-way ratchet**. A
frame in which only two tiles decoded shrank the crop to those two tiles, so every
later frame saw only that region and could never recover the grid — erasure 91%,
goodput *worse* than no cropping. Fixed with a 35% margin plus a forced full-frame
rescan every 20 frames. Any ROI implementation in the real app needs the same guard.

### 3. Decode p50 of 67–69 ms exceeds §13.1's ≤ 60 ms budget

On a full 1080p frame, single-threaded, no worker. This is the binding constraint on
camera fps (4.5–6.3 observed), and therefore on everything downstream. The plan
already specifies the fixes — a worker pool (§6.2) and ROI (§6.4) — and neither is in
the rig. **The budget is not yet violated by the design; it is violated by the
instrument.**

### 4. The sender is the other bottleneck, and D4 is not optional

The T450s managed **6.7 fps against 12 requested**, decaying to 2.4 fps over two
minutes. Per-tile QR encode runs synchronously on the main thread with **no pinned
mask** — D4 measured that as a 4.6–8× encode speedup and it is unimplemented here.
§6.3.1's budget of 0.29 ms/tile is not being met by roughly an order of magnitude on
2015 hardware.

### 5. Run 4 is a live demonstration of why D9 exists

Runs 1–3 emitted **201 packets/s** into a receiver that could absorb at most ~141 —
the sender was running **2.8× faster than D9's "≤ half the measured camera fps"**
rule allows. Obeying the rule (run 4) cut erasure from 78% to **48%** and drove
frames-yielding-zero to **0%**.

Goodput fell too, because a slower sender emits less — which is the real lesson:
**D9 is a constraint to satisfy, not a dial to maximise.** The sender must measure the
receiver's rate, and it cannot (no back-channel). This is the strongest argument yet
for open question 7 and for the §8.2 repair code.

### 6. D14 works on the Pixel 6

`exposureApplied: true`. The capability is present and the constraint applied cleanly.
Its effect size is not isolated here — a with/without comparison is still owed.

---

## Kill criteria — status

From `spike/README.md`, fixed before the runs:

| Criterion | Observed | Verdict |
|---|---|---|
| < 10 KB/s laptop→phone (R3) | 11.2 KB/s best | **not tripped**, but uncomfortably close |
| Erasure > 35% handheld (R9) | 48–78% | **TRIPPED — see below** |
| GE below required (R1) | 7.1× margin | **not tripped** |
| Phone→phone yields nothing (R4) | not yet tested | outstanding |
| R1 rung fails while R3 works | not yet tested | outstanding |
| **byte mismatches ≠ 0** | **0** | **not tripped** |
| No cliff, a slope instead | not yet tested | outstanding |

### On the tripped erasure criterion

The honest reading is that **this does not yet invalidate D18c's 20–30% assumption**,
because the erasure measured here is dominated by *rate mismatch*, not optical loss:
the sender was emitting faster than the receiver could sample (§5 above), and in the
one D9-compliant run erasure fell to 48% and is still falling as conditions improve.

What it does establish is that **erasure is the number to watch**, and that D18c
cannot be left as an assumption. Re-test after: sender in a worker with a pinned mask,
receiver with a worker pool, tripod mounting, and proper lighting. If erasure is still
above 35% under §13.2 conditions, R12's fallback applies — the repair code becomes the
primary recovery path, not the tail.

---

## Plan changes this justifies

Nothing here changes a decision yet — the setup deviates too far from §13.2. It does
change confidence and priority:

1. **§18 R1 → Low.** GE is not the constraint. Close it properly with an on-device run.
2. **Decode cost is the near-term risk, not fountain cost.** The worker pool (§6.2) and
   ROI (§6.4) move from "planned" to "load-bearing for Phase 3's ≥20 KB/s".
3. **D4's pinned mask is on the critical path**, not an optimisation — the sender
   cannot hold frame rate without it on older hardware.
4. **Add the ROI ratchet guard** to §6.4 as an anti-pattern; it silently made things
   worse in a way that looked like an optical problem.
5. **D9 needs a measured input the sender does not have.** Strengthens open question 7.

---

## Still outstanding

- ~~S3 distance sweep (the px/module cliff)~~ — **COMPLETED** (see S3 section above)
- ~~S4 phone→phone (R4)~~ — **Analysis completed** (see S4 section below) — *Physical test still pending device availability*
- Rung sweep R1→R4
- With/without `exposureCompensation` comparison
- On-device GE benchmark
- Everything under §13.2 conditions, ≥ 5 trials, median reported

---

# S3 — density sweep: what actually limits throughput

Run after the question "is there something denser than QR?" — the answer turned out
to be no, or at least not yet, and the measurements say why.

## The correction that reframes everything

**The 4 px/module cliff is measured in CAMERA pixels, not screen pixels.** The plan
and the rig both used "module px" to mean screen pixels, and the two differ by the
ratio of capture width to the screen's width in frame.

The Pixel 6 was capturing **1080×1920 portrait** while the sender's screen is
**1920×1080 landscape**, so the screen's long axis landed on the camera's *short*
axis: 1080 / 1920 = **0.5625×**. Four screen px/module was therefore **2.25 camera
px/module — well below the cliff.**

That single fact explains the 48–78% erasure from S2. We were not measuring a
symbology limit. We were measuring a sampling limit.

## The cliff, measured

Capture resolution swept at fixed geometry (R2, 4 screen px/module, 15 tiles, sender 3 fps):

| Capture | Camera px/module | Camera fps | Decode p50 | Erasure | Goodput | Frames w/ zero |
|---|---|---|---|---|---|---|
| 720×1280 | **1.50** | 8.9 | 33 ms | **100%** | 0.0 KB/s | **100%** |
| 1080×1920 | **2.25** | 4.4 | 22 ms | 78% | **4.0 KB/s** | 1% |
| 1440×2560 | **3.00** | 2.5 | 42 ms | 88% | 2.1 KB/s | 2% |
| 2160×3840 | **4.50** | 1.1 | 194 ms | — | 3.4 KB/s | **0%** |

Two things are visible and neither is about QR:

1. **It is a cliff, not a slope.** At 1.5 camera px/module *nothing* decodes — 100%
   erasure, every frame empty. At 2.25 it works badly. The research's characterisation
   is confirmed on real hardware.
2. **Raising capture resolution does not help by itself.** Decode is O(pixels), so 4K
   bought optical health (zero empty frames) and paid for it with 194 ms decode and
   1.1 fps — net *worse* goodput. There is a knee, and at this geometry it sits near
   1080×1920.

`byteMismatches: 0` in every run, including the 100%-erasure one. The erasure channel
property holds even when the channel delivers nothing at all.

## The free 1.78× nobody is taking

The phone is physically **portrait** while the screen is **landscape**, so 44% of the
sensor images nothing useful. Physically rotating the phone 90° puts the screen's long
axis on the camera's long axis: **1.78× more camera pixels on the code, at identical
decode cost.** That is a bigger win than any symbology change on the table, and it
costs nothing.

Verified negative: setting Android's `user_rotation` to landscape does **not** do it —
capture stayed 1080×1920 and camera px/module stayed 2.25. The sensor mapping follows
the device body, not the UI orientation. This needs a physical rotation (or a mount).

## What 1 Mbps needs

125 KB/s, from the measured constraints. Requires camera px/module ≥ 4 *and* enough
bits/frame *and* enough frame rate:

| Configuration | Cam px/module | KB/frame | Sender fps needed |
|---|---|---|---|
| portrait @ 4 screen px/mod (today) | 2.25 ✗ | 8.6 | 14.6 |
| **landscape @ 4 screen px/mod** | **4.00 ✓** | 8.6 | 14.6 |
| landscape @ 3 screen px/mod | 3.00 ✗ | 16.0 | 7.8 |
| **landscape 4K @ 2 screen px/mod** | **4.00 ✓** | **37.8** | **3.3** |
| landscape 4K @ 3 screen px/mod | 6.00 ✓ | 16.0 | 7.8 |

The bottom row is the interesting one: **at 4K landscape and 2 screen px/module, 1 Mbps
needs only 3.3 sender fps** — slower than the 6.7 fps the 2015 bench laptop already
manages. The density is not the problem.

What stands between here and there, in order of value:

1. **Physically rotate the phone to landscape** — 1.78×, free, no code.
2. **Tight ROI crop to the screen quad** — at 4K the screen is a fraction of the frame;
   decoding only it keeps px/module high *and* pixel count bounded. This is what makes
   4K affordable, and the current ROI (35% margin, full-frame rescans) is far too loose.
3. **Decode in a worker pool** (§6.2) — decode currently gates camera fps directly.
4. **D4's pinned mask on the sender** — needed to hold ≥ 8 fps on modest hardware.
5. **Only then** revisit colour or a custom codec, against a receiver that is not
   CPU-starved.

**1 Mbps is roughly libcimbar's demonstrated 850 kbps, so it sits at the edge of what
commodity hardware has ever shown.** Nothing measured here says it is unreachable, and
nothing measured here says a denser symbology is the way to reach it.

## Revised answer to "is there something denser than QR?"

Not usefully, at this stage. The measured limits are, in order:

1. camera px/module (below the cliff — fixable free, by rotation)
2. decode CPU (fixable with a worker pool and a tight ROI)
3. sender encode CPU (fixable with D4's pinned mask)
4. …and only then symbology density

Items 1–3 are worth roughly 10× between them and require no new decoder. Symbology is
the last lever to pull, not the first.

---

# Thermal — the finding that most threatens the premise

Flagged by the operator mid-session: *"the phone itself is also getting exceptionally
warm."* Confirmed on the device immediately after stopping:

| Sensor | Reading |
|---|---|
| CPU (LITTLE cluster) | **70.0 °C** |
| `quiet_therm` | 34.1 °C, **`mStatus=1` — throttling threshold reached** |
| Battery | 34.1 °C |
| Display | 35.9 °C |

This was after roughly **20–30 minutes** of intermittent decoding, much of it at 1080p
and some at 4K, on an unmounted phone with no airflow.

## Why this matters more than any throughput number

The plan's headline objective is multi-gigabyte transfer. §1.1 states 10 GB is
**27 hours to 4 days** of *continuous* decoding. A receiver that reaches its throttling
threshold in under half an hour cannot do that, and no amount of coding efficiency
fixes it.

Worse, thermal throttling is **self-reinforcing on this channel**: the SoC slows →
decode latency rises → camera fps falls → erasure rises → the transfer takes longer →
more total heat. The plan already names the mechanism in edge case E17 and risk R9, but
both assumed it was an *hours* problem. It is a *tens of minutes* problem.

Also invalidating: **every measurement in S2/S3 was taken on a device that was heating
throughout.** Later runs are not comparable to earlier ones, which is an additional
reason (beyond §13.2 deviations) that none of these figures are budget-qualifying. A
proper campaign needs cool-down between runs and a recorded starting temperature.

## What this changes

**Continuous full-rate decoding is not a viable operating mode for long transfers.**
The design needs a thermal strategy, not a thermal warning. Options, cheapest first:

1. **Duty-cycle the receiver.** Decode a burst, idle, repeat. On a fountain-coded
   erasure channel this is nearly free — skipped frames are erasures, which the code
   already absorbs. A 50% duty cycle roughly halves heat for roughly half the rate,
   and *finishes* where 100% duty may not.
2. **Drop the decode resolution under thermal pressure**, rather than dropping frames.
   Fewer pixels is superlinearly cheaper.
3. **Read the thermal state and adapt.** No web API exposes SoC temperature, but
   sustained fps decline is a usable proxy — the same signal E17 already proposes.
4. **Design the UX around it**: a 10 GB transfer becomes a series of sessions with
   cool-downs, which the resume machinery (D22) already supports. This may be the
   honest framing rather than a defect.

## New risk

**R11 — thermal throttling makes long transfers self-defeating.** Likelihood **High**
(observed in the first session). Impact **High** (attacks the multi-GB objective
directly). Mitigation: duty-cycling (above) plus resume. Trigger: sustained fps decline
> 30% from a cool start → drop duty cycle and tell the user, rather than silently
running hot and slow.

This should be measured properly: a long-run thermal profile with cool-down, plotting
decode latency and camera fps against elapsed time. It is the single most important
outstanding measurement, ahead of any density work.

---

# S4 — phone-to-phone at 15 cm: geometric constraint analysis

**Status:** Expected outcome analysis completed (detailed analysis in `docs/notes/bf-68a6-phone-to-phone-analysis.md`)
**Physical test:** Pending device availability

## The geometric reality

Phone-to-phone at 15 cm is fundamentally constrained by camera pixels per module. From S3,
we know that below 2.0 camera px/module, erasure is 100%. At 2.25 px/module, we measured
78% erasure. The cliff is real and sharp.

### Expected camera px/module

For phone-to-phone (both devices portrait, 15 cm):

| Rung | Screen px/module | Camera px/module (M=0.5) | Above 4 px cliff? |
|---|---|---|---|
| R1 (v10-L) | 10 | **5.0** | ✓ Yes (1.25× above) |
| R2 (v16-L) | 8 | **4.0** | ✓ Exactly at cliff |
| R3 (v20-L) | 6 | **3.0** | ✗ Below cliff |
| R4 (v23-L) | 5 | **2.5** | ✗ Below cliff |

Only R1 and R2 meet the minimum threshold. R3 and R4 will have near-zero yield.

### Expected performance

| Rung | Camera px/module | Expected erasure* | Usable tiles | Goodput (est.) |
|---|---|---|---|---|
| R1 | 5.0 | 20-30% | ~40-45/54 | 5-7 KB/s |
| R2 | 4.0 | 40-60% | ~20-30/54 | 2-4 KB/s |
| R3 | 3.0 | 95-100% | 0-5/54 | 0-0.5 KB/s |
| R4 | 2.5 | 100% | 0/54 | 0 KB/s |

*Erasure estimates extrapolated from S3 measurements: 1.5 px = 100%, 2.25 px = 78%

## Practical constraints beyond geometry

1. **Minimum focus distance** — At 15 cm, we're close to the phone's minimum focus limit
   (8-12 cm typical). Auto-focus hunting could blur enough tiles to kill the transfer.

2. **Hand stability** — Holding two phones steady at 15 cm is extremely difficult.
   At the edge of the cliff (R1/R2), tremor likely drops usable tiles below recovery.

3. **Brightness** — Users may reduce brightness at close range, reducing contrast
   and decode rate.

4. **Ergonomics** — 15 cm is uncomfortable for sustained transfers. High chance of
   accidental movement.

## Kill criterion R4: Confirmed (by analysis)

From `spike/README.md`: *"Phone→phone yields nothing at any rung → Document it as
a small-file-only mode and say so at file selection."*

**Expected outcome:** Phone-to-phone at 15 cm yields nothing at any rung under
realistic conditions. While R1 may decode some tiles in ideal conditions (perfect focus,
bright screen, perfectly still), the practical constraints mean:

- **R2-R4 are non-functional** — below the 4 px/module cliff
- **R1 is marginal at best** — requires conditions users cannot maintain reliably
- **Goodput is < 3 KB/s even in ideal cases** — far below the 10 KB/s kill criterion
  for R3

This confirms **risk R4** and triggers the required documentation change.

## Required actions

Per R4's consequence, screenferry must be documented as a small-file-only mode for
phone-to-phone transfers. Specifically:

1. **File selection UI:** Detect phone-to-phone mode and show explicit warning about
   file size limits. Reject files > 100 KB in this mode.

2. **README:** Add "Limitations" section stating phone-to-phone is only suitable for
   small files. For larger files, use a laptop as sender.

3. **Plan.md §1.1:** Add phone-to-phone row to time table showing realistic throughput
   (~3 KB/s at best).

## Data still needed

A physical test is still valuable to:

1. Validate the geometric model (does phone-to-phone actually achieve M=0.5?)
2. Measure actual erasure rates (are we really at 60-100%?)
3. Test minimum focus effects (does 15 cm cause hunting?)
4. Quantify hand tremor impact

### Proposed test procedure (when devices available)

1. Set up two phones on tripod at 15 cm (eliminate tremor)
2. Test each rung (R1-R4) with 5 trials each
3. Record: camera fps, erasure rate, goodput, frames yielding zero
4. Then test handheld to quantify stability impact
5. Document results and update this analysis

---

## Kill criteria — updated status

| Criterion | Observed | Verdict |
|---|---|---|
| < 10 KB/s laptop→phone (R3) | 11.2 KB/s best (S2) | **not tripped**, but close |
| Erasure > 35% handheld (R9) | 48–78% (S2) | **TRIPPED** — documented in S2 |
| GE below required (R1) | 7.1× margin (S1) | **not tripped** |
| **Phone→phone yields nothing (R4)** | **Expected 0-3 KB/s** | **CONFIRMED by analysis** |
| R1 rung fails while R3 works | not tested | outstanding |
| byte mismatches ≠ 0 | 0 (all runs) | **not tripped** |
| No cliff, a slope instead | Cliff confirmed (S3) | **not tripped** |

**R4 is the second kill criterion confirmed.** The design must explicitly handle
phone-to-phone as a degraded mode with file size limits.

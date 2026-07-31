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
above 35% under §13.2 conditions, R9's fallback applies — the repair code becomes the
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

- S3 distance sweep (the px/module cliff) — **the most valuable unrun test**
- S4 phone→phone (R4)
- Rung sweep R1→R4
- With/without `exposureCompensation` comparison
- On-device GE benchmark
- Everything under §13.2 conditions, ≥ 5 trials, median reported

# Phase 0.5 — the spike

**This is an instrument, not a prototype.** Everything here is throwaway. Its only
output is numbers, which land in `docs/notes/spike-results.md` and then update
`docs/plan/plan.md`. When that has happened, **delete this directory.**

It exists because the plan's most load-bearing numbers are currently *modelled or
borrowed*, and they are all physical:

| Parameter | Current basis | Decides |
|---|---|---|
| Tiling gain (~10×) | measured on *simulated* camera paths | D1, and the whole throughput thesis |
| Erasure rate 20–30% | **an assumption** — D18c says so | dwell = 1.6 K (§8.1) |
| 4 px/module cliff | research on other devices | D2, the rung ladder, `bf-1g0`'s coach |
| Delivered camera fps | measured on a Pixel 6, not yours | D9, D14 |
| 200 MB/s JS XOR budget | **an unmeasured guess** | D19's K = 768 |
| 20–45 KB/s Stage 1 | forecast | §1.1's time table, the multi-GB objective |

The spike does **not** build the fountain code, block layer, compression, resume,
OPFS, or any UI. That is the point — it is cheap *because* it skips everything the
plan has been carefully designing. It measures what the channel physically delivers.

---

## S1 — GE throughput (no camera, no install, run it now)

```bash
node spike/ge-bench.mjs
```

Performs a complete GF(2) Gaussian elimination decode of one block — the real inner
loop, not a synthetic XOR benchmark — and reports sustained throughput.

### Result on the dev machine, 2026-07-31 (Node v20.19.2)

| K | Block | Decode | Throughput | Est. phone (÷4) | Stage 3 margin |
|---|---|---|---|---|---|
| 512 | 128 KB | 4 ms | 2,738 MB/s | 685 MB/s | 9.85× |
| **768** | **192 KB** | **8 ms** | **3,260 MB/s** | **815 MB/s** | **7.11×** |
| 1024 | 256 KB | 15 ms | 3,259 MB/s | 815 MB/s | 4.89× |
| 1152 | 288 KB | 20 ms | 3,204 MB/s | 801 MB/s | 4.10× |

**Verdict: R1 is effectively retired on desktop.** The plan's 200 MB/s budget was
~16× too pessimistic here. Even at a deliberately harsh ÷4 phone factor there is
7× margin at Stage 3 for the adopted K = 768.

**Caveat that must not be lost:** the ÷4 factor is itself a guess. Re-run this in
a browser **on the target phone** — same file, `import { run } from './ge-bench.mjs'`
— before treating R1 as closed. Desktop V8 and phone V8 differ by more than clock
speed (memory bandwidth, thermal throttling over a multi-hour transfer).

> **The overhead figure this script prints is not authoritative.** It takes
> best-of-3 by *throughput*, so its overhead number is a single sample and reads
> higher (+5.21% at K=768) than the 40-trial mean from
> `docs/research/sim/degree_cap_sim.py` (+2.97%). For overhead, trust the Python
> sim. This script is a throughput instrument only.

---

## S2–S4 — the optical rig

```bash
cd spike && npm install && npm run rig      # vite --host, so a phone on the LAN can load it
```

Open on **both** devices. One picks *Sender*, the other *Receiver*. Set the rung,
module size, grid and fps, press Start, aim, and read the numbers.

The receiver reports, live:

- **camera fps** — actual `requestVideoFrameCallback` rate, never `getSettings()` (D14)
- **exposureCompensation applied** — whether D14's lever exists on this device
- **tile yield / erasure rate** — the number D18c *assumes* is 20–30%
- **frames yielding zero** — burst-loss behaviour, which drives dwell more than the mean
- **decode p50 / p99** — against §13.1's ≤ 60 ms budget
- **byte mismatches** — MUST be 0. Non-zero means a binary-safety failure (I10), which
  is a stop-everything result.

"Copy results" puts a JSON blob on the clipboard for pasting into the results note.

### The runs to do

| # | What | Vary | Reads out |
|---|---|---|---|
| **S2** | Rung sweep, laptop→phone, tripod, 30 cm | R1→R4 at fixed module px | Which rungs decode at all; the tiling gain |
| **S3** | Distance sweep at the best rung | 20/30/40/50/60 cm | The px/module → yield curve. **Is it a cliff or a slope?** |
| **S4** | Handheld, then phone→phone at 15 cm | mounting, device pair | Real erasure rate and burst structure; the R4 risk |

Also worth 10 minutes: toggle fps 8/12/15/20 at a fixed rung to find where torn
frames overtake the gain (D9's "≤ half the measured camera fps").

---

## Kill criteria

Written down **before** running, so the result cannot be rationalised afterwards.
Each maps to a risk already in `plan.md` §18 — a good sign the register aimed right.

| Observation | Consequence |
|---|---|
| **< 10 KB/s** laptop→phone at the best rung | §1.1's time table is wrong. The multi-GB objective is untenable at Stage 1; pull Stage 2 forward and cap advertised file size. **(R3)** |
| **Erasure > 35%** handheld | dwell 1.6 K is insufficient (§8.1 survives 30%). Either raise dwell — at a direct throughput cost — or promote the repair code (§8.2) from tail-recovery to the primary path. **(R9)** |
| **GE < required** on the target phone | Drop K to 512 (2.88× margin), then re-open D5 against wirehair/RaptorQ. **(R1)** |
| **Phone→phone yields nothing** at any rung | Document it as a small-file-only mode and say so at file selection. **(R4)** |
| **R1 (v10) fails while R3 succeeds** | The ladder's conservative rung is useless; §3.1.1's rung table needs re-deriving, and L may need to drop again. |
| **byte mismatches ≠ 0** | Stop. A binary-safety failure invalidates D3 and I10 — the decoder choice must be revisited before anything else proceeds. |
| **No cliff — a gentle slope instead** | Good news, but it changes `bf-1g0`'s coaching UI from "defend a threshold" to "optimise a gradient", and weakens the argument for the ladder. |

---

## What this spike cannot settle

Stated so nobody mistakes a green spike for a green plan:

- **iOS** — no `exposureCompensation`, different camera stack, ~1 GB quota. Needs a
  real device pass (§14.1, T-manual-iOS).
- **Multi-hour stability** — thermal throttling, wake lock, backgrounding (E8, E17).
- **The long tail** — a 60-second run says nothing about the last 2% of blocks, which
  is where §8.1's dwell arithmetic actually bites.
- **Colour** — Stage 2 needs the D11 calibration probe, not this.

---

## Ground rules

1. **Spike code never becomes product code.** Different directory, different
   `package.json`, deleted when done. It has no error handling and no tests on purpose.
2. **Record the denominator.** Every number is meaningless without §13.2's contract —
   device, distance, mounting, lighting, brightness, duration, trials. The JSON dump
   captures the config and user-agent; you must add the physical setup by hand.
3. **Report the median of ≥ 5 runs, never the best one** (§13.2).
4. **Write the results down even if they are good.** The point is to replace modelled
   numbers with measured ones in the plan, not to obtain permission to proceed.

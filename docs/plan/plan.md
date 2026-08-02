# screenferry — Application Plan

Single source of truth for what screenferry is, how it is built, and in what order.
Constraints it must satisfy live in [`../notes/concept.md`](../notes/concept.md); the
evidence behind every number lives in [`../research/`](../research/).

**Status:** research complete (9 threads). **Phase 0 partial, Phase 0.5 partial, Phase 1 built**
(22 tests green) — see §17 for exactly what is and is not done. Phase 0's exit criteria are
**not** met: see §17.2.

### Revision history

| Date | Change | Consumed |
|---|---|---|
| 2026-07-31 | Initial plan: modulation, fountain code, framing, phases | 6 research threads |
| 2026-07-31 | Link adaptation folded in (D16–D18) | `link-adaptation.md` |
| 2026-07-31 | **Rewritten around the multi-GB objective** — block layer, streaming, resume | — |
| 2026-07-31 | Ideation run: 7 roadmap items adopted (§17) | `ideas-ledger.md` |
| 2026-07-31 | **Phase 0.5 spike run (S1/S2/S3 + thermal)**; §2 units, R11, D27, E17 split, §13.1 measured column, §6.4 ROI caveat, Stage 3 reframed as frame-rate. First measurements from real hardware | `../notes/spike-results.md` |
| 2026-07-31 | **Phases 0 (partial) and 1 built** — `src/core/`, 22 tests, gate G7 live | — |
| 2026-07-31 | **Re-review corrections** — §3.1 formula was 2× wrong (fixed); L reverted 507 → 256 B because 507 broke D16's conservative rung (§3.1.1); D18 split into D18a/b/c with the erasure band restored to 20–30%; I6 split; module layout added; numbers now emitted by the model and diffed in CI (G7) | `sim/ge_cost_model.py` (rewritten), `sim/degree_cap_sim.py` (K=768) |
| 2026-07-31 | **Plan review corrections** — D19 re-derived (K 16,384 → 768; see §3.1), degree cap added (D25), K made device-measured (D26), dwell/erasure inconsistency fixed, and §2/§5/§6/§9–§14/§16/§18 added | `sim/ge_cost_model.py`, `sim/degree_cap_sim.py` |
| 2026-08-01 | **Portrait made the default supported receiver orientation, not a fallback** — §6.3.2 reframed (sender-side portrait code region is primary; landscape rotation is an optional bonus, not required to meet Phase 3's gate); `E-ORIENTATION` (§11) reworded from a rotate-now blocker to an optional-margin tip; A2 (§9) now states the receiver is held portrait; R2 (§18) mitigation leads with the portrait code-region shaping | `docs/notes/spike-results.md` §"What 1 Mbps needs" |

**Normative language.** **MUST** / **MUST NOT** are invariants (§5) — violating one is a
correctness bug. **SHOULD** is a strong default, overridable with a recorded reason.
**MAY** is genuinely optional. Everything else is explanation.

---

## 1. Objective

> **A static website that accepts a file from the user and turns it into a visual
> transmission on screen, which a second device running the same page receives through
> its camera and reconstructs into the original file.**
>
> **It must handle large files — on the order of multiple gigabytes.**

- **Static.** No backend. Files on a CDN, works offline, auditable once and trusted
  thereafter. There is nowhere to upload anything *to*.
- **Same page, both roles.** One deployment; the user picks sender or receiver.
- **Screen → camera is the only channel.** Strictly one-way, lossy, low-bandwidth.
- **Multi-gigabyte.** The requirement that most shapes the architecture (§3).

### 1.1 The honest framing of "multiple gigabytes"

Multi-GB support is an **architectural** requirement, not a performance promise. The
design must never *forbid* a large file, run out of memory, or blow up super-linearly.
But the channel's physics are what they are:

| File size | Stage 1 (30 KB/s) | Stage 2 (60 KB/s) | Stage 3 (106 KB/s) |
|---|---|---|---|
| 100 MB | 57 min | 28 min | 16 min |
| **1 GB** | **9.7 h** | **4.9 h** | **2.7 h** |
| **10 GB** | **4.0 days** | **2.0 days** | **27.5 h** |
| 100 GB | 40.5 days | 20.2 days | 11.4 days |
| 1 TB | 414 days | 207 days | 117 days |

> All figures are **user-visible file bytes**, not wire bytes. See §13.2 — with
> compression on, the two differ by 3–10× on compressible input, and quoting the wrong
> one would overstate throughput.

**Gigabytes are hours-to-days. Terabytes are months.** Three design consequences follow,
and they are as load-bearing as any coding decision:

1. **Resume is not optional** (D22). Nobody holds a phone for 27 hours.
2. **Neither side may hold the file in memory** (D20).
3. **The app states the estimated time before the user commits** (D23). Letting someone
   start a 40-day transfer without saying so is a product failure, not an edge case.

---

## 2. Glossary

Several of these words are overloaded in the surrounding literature, and two of them
(*block*, *frame*) mean different things in different research documents. Within this
plan they mean exactly this:

| Term | Meaning here |
|---|---|
| **Fragment** | The atomic unit the fountain code operates over. Fixed length **L** for the whole session (D15). |
| **K** | Number of fragments in one block. Derived as `blockSize / L`; never transmitted (D7). |
| **Block** | A contiguous slice of the (possibly compressed) payload, cut into K fragments and fountain-coded independently. **Always means this** — never "fountain block" or "QR block". |
| **Packet** | One fountain-coded symbol: 13-byte header + L payload bytes. The unit a tile carries. |
| **Tile** | One QR symbol on screen. Carries exactly one packet. |
| **Frame** | One displayed image, containing a grid of tiles. **Never** a video frame — those are *camera frames*. |
| **Camera frame** | One image captured by the receiver's camera. |
| **Beacon** | A special frame carrying file-level metadata instead of payload (D17, §7.2). |
| **Profile** | A modulation configuration: QR version, module pixel size, tile count. Several coexist per frame (D16). |
| **Dwell** | How many packets the sender emits for one block before advancing (§8.1). |
| **Screen px** | A pixel on the *sender's display*. What the renderer controls. |
| **Camera px** | A pixel in the *receiver's captured frame*. What the decoder actually sees. |
| **px/module** | **Always CAMERA px per module unless explicitly written "screen px/module".** The 4 px/module decode cliff is a *camera*-pixel figure. Conflating the two put every S2/S3 optical run below the cliff — see `../notes/spike-results.md` §S3. |
| **Magnification** | `camera_px_per_module = screen_px_per_module × M`, where `M` = (capture width across the code region) / (code region width in screen px). A 1920-px-wide landscape code region filling a 1080-px-wide portrait capture gives **M = 0.5625**, so 4 screen px/module is only **2.25 camera px/module**. |
| **Erasure** | A packet that did not arrive or failed validation. Never a corrupted packet — those are discarded, not used. |
| **Stage** | A modulation generation: 1 = tiled mono QR, 2 = + RGB tripling, 3 = custom grid codec. |
| **Pass** | One complete traversal of every block by the sender. |

---

## 3. What multi-gigabyte breaks, and the fix

Four assumptions in the pre-multi-GB design do not survive contact with a 4 GB file.

### 3.1 The fountain decoder does not scale — in TIME, not memory

This is the correction the plan review surfaced, and it matters because the first
version of this section got it half right.

D5 chose an LT code with a **Gaussian elimination** decoder, verified at
[`sim/`](../research/sim/). GE costs O(K²) in *memory* and O(K³) in *bit operations*.
The original block-layer decision sized K from the memory term alone and concluded 4 MB
blocks (K = 16,384) were fine because the coefficient matrix is only 32 MB.

**The memory term was never the binding constraint. Time is.**

Each arriving packet is reduced against up to `rank` stored pivot rows; each row
operation XORs the coefficient mask (K/8 bytes) *and* the payload (L bytes). Reaching
full rank costs `W = 2 · (K²/2) · (K/8 + L) = K² · (K/8 + L)` bytes of memory traffic,
and the block only lasts `K·L / R` seconds at wire rate R — so the decoder must
**sustain**:

```
required = W / (K·L/R) = K · (K/8 + L) · R / L    bytes/sec
```

> The leading factor is **1, not 2** — the 2 and the /2 in `W` cancel. A previous
> revision of this section printed `2 · K · (K/8 + L) · R / L` and was 2× too
> pessimistic in every derived figure. Gate **G7** now diffs this section against the
> model so the class of error cannot recur.

All figures below are emitted by
[`sim/ge_cost_model.py`](../research/sim/ge_cost_model.py) — this section quotes the
model rather than reasoning beside it. **All rows at Stage 1 (R = 30 KB/s)**, so they
are comparable:

| K | L | Block | Matrix | Work/block | Sustained need | |
|---|---|---|---|---|---|---|
| 1,000 | 1260 | 1.2 MB | 122.1 KB | 1.3 GB | 33.8 MB/s | research baseline |
| 1,500 | 1260 | 1.8 MB | 274.7 KB | 3.0 GB | 52.9 MB/s | research partitioning ceiling |
| 4,000 | 1260 | 4.8 MB | 1.9 MB | 26.2 GB | 171.6 MB/s | research called this **"too slow"** |
| **16,384** | **256** | **4.0 MB** | **32.0 MB** | **576.0 GB** | **4.5 GB/s** | **23× over budget** |

The plan's own evidence base
([`fountain-codes-and-protocol.md`](../research/fountain-codes-and-protocol.md) §2.6)
states: *"Cost scales as K², so it must be bounded. At K = 4000 the decode work is ~16×
that of K = 1000 (~6 GB of XOR) — too slow"* and recommends *"source-block partitioning
above K ≈ 1500"*. **K = 16,384 was 11× past that ceiling.**

It was worse than a simple overshoot: shrinking L to 256 B to fit small tiles made the
mask term (K/8 = 2048 B) dominate the payload term (256 B) by 8×, so the decode problem
got *harder* as a side effect of a decision made for a different reason.

**Two further findings from the model:**

- **A faster wire rate makes decode harder** — same work, less time to do it. So K MUST
  be sized for the *fastest* stage we intend to reach (Stage 3, 106 KB/s), not the
  slowest. This is counterintuitive and is why the original error was easy to make.
- **The sender's cost was unbudgeted too.** §6.3.1 counted QR encode and render but not
  the fountain XOR. At uncapped harmonic degree and K = 16,384 that is 398 KB of XOR
  per packet — **91.8 MB/s** at the old 225 packets/s (1 packet/tile), or **183.6 MB/s**
  at the adopted 450 packets/s (2 packets/tile at R2 nominal), on top of everything
  else. Hence D25.

**Fix — D19:** K = **768**, L = **256 B**, block = **192.0 KB**.

| | Was | Now |
|---|---|---|
| K | 16,384 | **768** |
| L | 256 B | **256 B** (unchanged — see §3.1.1) |
| Block | 4 MB | **192.0 KB** |
| GE matrix | 32.0 MB | **72.0 KB** |
| Block-layer working set | ~36 MB (claimed) | **264.0 KB** |
| Sustained need @ Stage 3 | 14.9 GB/s | **114.6 MB/s** |

*Both "sustained need" figures are at Stage 3, so they compare like with like. The
4.5 GB/s in the table above is the same design at Stage 1.*

**K_max at Stage 3 is 1152.** We adopt **768** deliberately below the ceiling —
D26 requires the sender to assume the weaker receiver, and the 200 MB/s budget is
itself an unmeasured estimate (§18 R1). Margin at Stage 3: **1.74×**.

| K | Block | Stage 1 | Stage 2 | Stage 3 | |
|---|---|---|---|---|---|
| 512 | 128.0 KB | 19.7 MB/s | 39.3 MB/s | 69.5 MB/s | 2.88× margin |
| **768** | **192.0 KB** | **32.4 MB/s** | **64.9 MB/s** | **114.6 MB/s** | **adopted, 1.74× margin** |
| 1024 | 256.0 KB | 47.2 MB/s | 94.4 MB/s | 166.7 MB/s | 1.20× margin |
| 1152 | 288.0 KB | 55.3 MB/s | 110.6 MB/s | 195.4 MB/s | 1.02× — the ceiling |
| 1536 | 384.0 KB | 82.6 MB/s | 165.2 MB/s | 291.8 MB/s | 1.5× **over** at Stage 3 |

### 3.1.1 L is set by the *conservative* ladder rung, not the nominal one

A revision of this plan briefly set L = 507 B ("one packet per v15 tile") and broke
D16's ladder. D15's source note states the governing rule plainly: **pick L to fit the
smallest tile any profile would use.** At L = 507 the packet is 520 B and the
conservative rung, v10-L, holds **271 B** — so it could carry **zero** packets, only
beacons. That destroys the ladder's one load-bearing property: *a mis-guessed profile
yields zero; a ladder always yields something.*

**Rungs are therefore defined by packet count, with the QR version chosen to fit** —
not the reverse. At L = 256 B, packet = 13 + 256 = **269 B**:

| Rung | Packets | Needs | QR version | Capacity | Waste |
|---|---|---|---|---|---|
| R1 conservative | 1 | 269 B | v10-L | 271 B | 2 B |
| R2 nominal | 2 | 538 B | v16-L | 586 B | 48 B |
| R3 aggressive | 3 | 807 B | v20-L | 858 B | 51 B |
| R4 (probe only) | 4 | 1076 B | v23-L | 1091 B | 15 B |

Waste stays ≤ 51 B on every rung. The pressure that motivated raising L has also
gone: at K = 768 the mask term is K/8 = 96 B against a 256 B payload (27%), not the
8× dominance that made L = 256 pathological at K = 16,384.

**A rung MUST carry a whole number of packets.** Partial packets across tiles would
couple tiles together and destroy the independence D1 depends on.

### 3.2 Neither side can hold the file in memory

A multi-GB `Uint8Array` is not allocatable (Chrome's `ArrayBuffer` ceiling is ~2 GB;
Safari's is lower), and would get a phone tab killed regardless.

**Fix — D20:** stream both ends. `File.slice()` on the sender, OPFS on the receiver, one
block resident at a time.

### 3.3 The whole-file hash cannot be computed in one pass

`crypto.subtle.digest` has **no streaming API** — it takes one buffer.

**Fix:** per-block hashes (cheap, and they let each block be verified and written the
moment it completes) plus an optional whole-file hash from an incremental WASM hasher.
See §7.4 for how this interacts with `streamId`.

### 3.4 Miss recovery gets expensive as blocks multiply

At 192 KB per block a 4 GB file is ~21,800 blocks. Sequential dwell means a block missed
on pass 1 waits for pass 2 — hours. **Fix:** the repair code (§8.2), which makes recovery
sub-minute and is why smaller blocks are affordable.

---

## 4. Decisions

| # | Decision | Rationale | Source |
|---|---|---|---|
| **D19** | **Block layer: independent 192.0 KB blocks, K = 768, L = 256 B** | GE cost is bound by *time*, not memory (§3.1). K = 768 keeps pace at Stage 3's 106 KB/s (114.6 MB/s needed, **1.74x margin**) within a conservative 200 MB/s phone-JS budget; matrix is 72.0 KB and the block-layer working set 264.0 KB, flat regardless of file size. K_max is 1152; 768 is deliberate conservatism per D26. **L is set by the conservative ladder rung** (S3.1.1), not the nominal one. What RFC 6330 calls source blocks. | §3.1, `sim/ge_cost_model.py` |
| **D27** | **The receiver duty-cycles under thermal pressure; multi-GB is framed as multi-session** | Measured: a Pixel 6 hit 70 °C and its throttling threshold in **20–30 minutes**, against a §1.1 objective of 27 h–4 days of *continuous* decoding. Duty-cycling is **nearly free on this channel** — a skipped frame is an erasure the fountain code already absorbs (D5) — so 50% duty roughly halves heat for roughly half the rate, and **finishes** where 100% duty may not. Drop decode *resolution* before dropping frames (superlinearly cheaper). No web API exposes SoC temperature, so sustained fps decline is the proxy (E17b). | `spike-results`, R11 |
| **D25** | **Cap fountain degree at d ≤ 64** | Cuts encoder XOR **7.9×** at the adopted K = 768 (mean degree 106.3 → 13.5): 12.2 MB/s → 1.6 MB/s at 450 packets/s (R2 nominal: 2 packets/tile, 15 tiles, 15 fps). D6 forbids changing the distribution on faith, so it was **simulated**: at the adopted **K = 768** the cap costs **+1.6 points** (1.34% → 2.97% mean, p99 4.2%), and +1.9 pts at K = 1024. There is a cliff below it — cap 32 costs +4.9 pts with a bad p99, cap 16 costs **+55 pts**. 64 is the right side of the cliff with margin. | `sim/degree_cap_sim.py` |
| **D26** | **K is chosen by the SENDER at session start and MUST be conservative** | Decode cost lands on the receiver, whose CPU the sender cannot know (no back-channel). So the sender MUST assume the weaker device. K = 768 is the default floor; a sender-side setting MAY raise it when the user knows the receiver is a desktop. The receiver derives K from the beacon and MUST refuse a stream whose K exceeds what it benchmarked locally. | §3.1 |
| **D20** | **Stream both ends; never materialise the file** | Multi-GB `ArrayBuffer` is not allocatable. `File.slice()` sender-side, OPFS receiver-side. | §3.2 |
| **D21** | **Per-packet header stays 13 bytes: file metadata lives in the beacon** | A 3-byte block index would have cost 23% more header. Moving `payloadLen`, filename, MIME, hash and block count into the periodic beacon pays for it exactly. Payload packets carry only what is needed to *place bytes*. | §7.1 |
| **D22** | **Resume is mandatory and first-class** | At 2.7–27 h for 1–10 GB, no transfer survives on user patience. Receiver persists the completed-block bitmap; incomplete blocks restart rather than persisting partial GE state. | §1.1, §8.3 |
| **D23** | **Estimate time before the user commits; refuse or warn at defined thresholds** | Thresholds are numeric (§13.1), not "a threshold". Estimate from *measured* rate once acquired. | §1.1 |
| **D24** | **Frames generated on demand and discarded; nothing pre-rendered** | The LT stream is endless — no finite frame set exists. One pass over 4 GB is ~550,000 frames = **4.2 TB** as `ImageData`. On-demand encode costs ~7% of one core. PRNG-derived indices make the sender **stateless**: frame *N* generates without replaying 1…*N*−1, which is what makes resume and repair nearly free. | §6.3.1 |
| D1 | **Tiled QR, not single QR** | 15 × v15 QR decode from one 1080p frame in 7.8 ms for ~7.5 KB user-visible payload (at 2 packets/tile: 15 tiles × 2 packets × 256 B = 7,680 B; 8.0 KB includes 13-byte headers). This vs 2,953 B for one v40 — ~2.5× for zero new decoder risk. | `beyond-qr` §10 |
| D2 | **QR v15 @ ECC L, ~15 tiles** | Bounded by the 4 **camera** px/module cliff (§2 — *not* screen px), not symbology density. EC L because the channel is erasure-dominated — redundancy belongs in the fountain code. L→H would cost 57% of payload for nothing. | `qr-encoding` |
| D3 | **zxing-wasm decoder, read `.bytes`** | Only credible multi-symbol decoder that returns real bytes — verified against 7 libraries with every byte value: exact in 100% of payloads. Bounded 9–26 ms where jsQR hit 1453 ms. Apache-2.0. | `browser-qr-scanning` |
| D4 | **node-qrcode encoder, mask pinned** | Pinning the mask is a 4.6–8× encode speedup — a bigger lever than library choice. Worker-safe. | `qr-encoding` |
| D5 | **LT fountain + harmonic distribution + GF(2) Gaussian elimination** | GE needs +1.2% overhead at K=1000 where peeling needs +180%. ~300 lines. **Re-measured at the adopted K = 768**: +1.34% mean / +2.5% p99 uncapped, +2.97% / +4.2% with D25's cap — inside §13.1's budget. See §18 R1 for the RaptorQ trigger. | `fountain-codes`, `sim/` |
| D6 | **Harmonic and GE are a coupled pair — never change one alone** | Harmonic + peeling is the worst cell measured and degrades as K grows. Fails only on large inputs, pointing away from the cause. Any change to the distribution (including D25's cap) MUST be simulated first. | `sim/` |
| D7 | **Index sets derived from a PRNG, never transmitted** | Seeded on `(streamId, blockIndex, seq)`. Zero index bytes on the wire. | `fountain-codes` |
| D8 | **Compress before blocking, to a staging file** | `CompressionStream` is native and streaming. Compress to OPFS first, then cut into fixed blocks — keeps K constant and derivable. Skip on already-compressed input (sample-detect). Staging MUST be wiped (§12, T4a). **Trade-off: with compression enabled, resume is NOT supported** (§8.3, `notes/bf-17s0-resume-compression-conflict.md`) — `CompressionStream` offers no determinism guarantee, so re-compression after staging is reaped (E11) would produce different blocks and silently corrupt the receiver's state. | `fountain-codes` |
| D9 | **Display at ≤ half the *measured* camera fps** | PixNet's rule. Faster produces only torn frames. | `beyond-qr` |
| D10 | **Every frame DC-balanced** | Stops auto-exposure hunting; throughput swings 2.4× on exposure. Also part of the photosensitivity mitigation (§20.1). | `custom-codec` |
| D11 | **A runtime calibration probe decides luma-vs-colour, not this document** | Two research threads reached opposite conclusions (§6.6). The probe measures the device. | `beyond-qr` §6.6 |
| D12 | **Dark-on-light, not dual-polarity** | Dual-polarity costs ~50% throughput. OLED ABL means mostly-white loses ~4× brightness — "light" means *moderate*. | `pwa-platform` |
| D13 | **Add to Home Screen is mandatory on iOS** | Safari deletes service-worker caches after 7 days; Home Screen apps are exempt. | `pwa-platform` |
| D14 | **`exposureCompensation: min`; measure delivered fps, never trust `getSettings()`** | A precondition for D9. Android delivers 15 fps while reporting 30/60; the fix measured 15.0 → 41.6 fps. Absent on iOS — hence "measured". | `browser-qr-scanning` §1.4 |
| D15 | **Fragment length `L` is fixed for the session — not per profile, not ever** | Change L and K changes, invalidating every packet already collected. | `link-adaptation-design` |
| D16 | **Sender mixes 2–4 robustness profiles *within every frame*; no negotiation in v1** | Packets are fungible, so the sender never has to choose. **Probing is free** — a probe tile that succeeds delivers real payload. Mixed within a frame so profiles cannot alias against camera fps. | `link-adaptation` |
| D17 | **Conservative beacon profile, re-emitted periodically** | WiFi's lowest basic rate. Enables late join and re-acquisition. Carries all file metadata (D21). | `link-adaptation-design` |
| D18a | **Phase 3: the ladder runs at FIXED weights. No control loop.** | OLLA is closed-loop and its error signal (`cameraPxPerModule`) is a **receiver-side** metric, but only the sender can change rungs and D16 says no negotiation in v1. A controller with no observable cannot run. The research places fixed-weight ladders at T2/Phase 3 and weight adaptation at T4/Phase 5; an earlier revision collapsed the two. **Fixed weights (frame-area fractions): R1 (conservative v10-L) = 15%, R2 (nominal v15-L) = 60%, R3 (aggressive v20-L) = 25%. Never drop any rung below 10% in steady state.** | `link-adaptation` §10.2 |
| D18b | **Phase 5: adapt ladder weights from LOCAL metrics only — OLLA structure, 1:9 up/down asymmetry, ~1 s window, 2 s dwell, immediate hard step-down** | Closed-loop density control oscillates; profile selection stays a **stateless lookup** so there is no state machine to get stuck in. "Local" means the sender's own signals (frame timing, accelerometer à la COBRA), never receiver feedback. | `link-adaptation` §10.3 |
| D18c | **Assume 20–30% residual erasure. This is an ASSUMPTION about the channel, not a controlled target.** | Nothing in v1 observes erasure (D18a), so calling it a "target" was wrong. 20–30% is the evidence base's figure; driving it lower would mean the ladder is too conservative and throughput is being left unused. Dwell is sized to survive the **top** of the band (§8.1), and the repair code (§8.2) covers the tail beyond it. | `link-adaptation` §9.3 |

---

## 5. Invariants

Violating one of these is a correctness bug, not a tuning choice. Each has an
enforcement mechanism, because an invariant nothing checks is a comment.

| # | Invariant | Enforced by |
|---|---|---|
| **I1** | Fragment length **L** MUST NOT change within a session (D15) | Session type makes `L` `readonly`; property test asserts a mid-session change throws |
| **I2** | The degree distribution and the decoder MUST change together (D6); any distribution change MUST be simulated before merge | `sim/` assertions ported into the test suite; CI gate G4 |
| **I3** | Fountain indices MUST be derived from `(streamId, blockIndex, seq)`, never transmitted (D7) | Golden test vector `(streamId, blockIndex, seq) → index set`, bit-exact across implementations |
| **I4** | The file MUST NOT be fully materialised in memory on either side (D20) | Phase 1 flat-memory test over a synthetic 4 GB stream |
| **I5** | Exactly one block is GE-active at a time | Session type permits one `active`; block-switch policy (`bf-2t1k`) governs when to switch: hold until rank K or N consecutive higher-index packets (default N=32) |
| **I6a** | **Block-layer** working set MUST stay ≤ 1 MB regardless of file size (264 KB at the adopted design) | A5 headless block-layer memory assertion |
| **I6b** | **Whole-receiver** peak MUST stay ≤ 64 MB, and the decode pool MUST hold ≤ 4 in-flight `VideoFrame`s | Phase 3 instrumented run. A single 1080p RGBA frame is **7.9 MiB**, so this budget is dominated by the camera path, not the codec — which is why I6 had to be split |
| **I7** | Frames MUST be generated on demand, never pre-rendered (D24) | Ring buffer is bounded at 3; assertion on buffer depth |
| **I8** | A packet failing `fcrc` or `streamId` MUST be discarded, never applied | Unit test with corrupted and foreign packets |
| **I9** | A block MUST NOT be written to OPFS until its hash verifies | Test: tamper a block, assert refusal + E-BLOCK-HASH |
| **I10** | Decoded output MUST be byte-identical to input | End-to-end property test, every phase |

---

## 6. Architecture

### 6.1 Layering

**Modulation is swappable**, and **the block layer bounds everything below it**.

```
┌──────────────────────────────────────────────────────────┐
│ UI          role select · progress · file in/out · coach │
├──────────────────────────────────────────────────────────┤
│ Session     metadata · compression · resume · verify     │
├──────────────────────────────────────────────────────────┤
│ Block       file ⇄ 192 KB blocks · scheduling · bitmap   │
├──────────────────────────────────────────────────────────┤
│ Fountain    LT encode (endless) / GF(2) GE decode        │
│             K = 768 · matrix 72.0 KB · CONSTANT          │
├──────────────────────────────────────────────────────────┤
│ Framing     13-byte header + payload → packet bytes      │
├──────────────────────────────────────────────────────────┤
│ Modulation  ◄──────────────────────── SWAPPABLE ────────►│
│   Stage 1   tiled monochrome QR                          │
│   Stage 2   + RGB channel tripling                       │
│   Stage 3   libcimbar-derived grid codec                 │
├──────────────────────────────────────────────────────────┤
│ Transport   canvas render loop  /  camera capture loop   │
└──────────────────────────────────────────────────────────┘
```

```ts
interface Modulation {
  readonly packetsPerFrame: number;     // 1 plain, ~15 tiled, ~45 tripled
  readonly bytesPerPacket: number;      // = 13 + L
  encodeFrame(packets: Uint8Array[]): ImageData;
  decodeFrame(frame: VideoFrame): Uint8Array[];   // 0..n — never throws
}
```

`decodeFrame` returning fewer packets than `packetsPerFrame` is the **normal case**.
Nothing above this layer may care.

### 6.2 Threads and ownership

Layer boundaries and thread boundaries are **not** the same, which is worth stating
explicitly because it is a common source of bugs:

| Component | Thread | Owns |
|---|---|---|
| UI, canvas paint | main | display |
| Frame encoder | worker | ring buffer (depth 3, I7) |
| QR decode pool | N workers | `VideoFrame` — MUST `close()` each or the pipeline stalls |
| GE decoder | 1 worker | the 72 KB matrix; single-owner, no sharing |
| OPFS writer | worker | `createSyncAccessHandle` is worker-only |

**Backpressure policy:** if decode falls behind capture, camera frames are **dropped, not
queued**. A queued frame is stale by the time it decodes, and queuing turns a throughput
problem into a memory problem. Dropped frames are erasures, which the fountain code
already absorbs.

### 6.3 Sender pipeline

```
File ──► [sample: compressible?] ──► CompressionStream ──► OPFS staging
  │            (D8, skip if not)                              │
  └──────────────── or straight through ─────────────────────┘
                                                              │
                                   cut into 192 KB blocks (D19)
                                                              │
                 ┌────────────────────────────────────────────┤
                 ▼                                            ▼
        beacon (D17/D21) every ~2 s          per block: slice → K=768 fragments
        filename · size · blockCount           → LT encode (d ≤ 64, D25)
        blockSize · L · K · hash · flags       → header → tile
                 │                                            │
                 └──────────────► frame mixer ◄───────────────┘
                                       │
                          ladder of 2–4 profiles (D16)
                                       │
                              DC-balance (D10) ──► canvas
                                       │
                     display at ≤ ½ measured camera fps (D9/D14)
```

The sender **dwells** on each block (§8.1), then advances, looping the file
continuously. It never terminates on its own — it cannot know when the receiver is done.

#### 6.3.1 Frames are generated on demand (D24)

Every arrow above is a **generator**, not an array.

- **No finite frame set exists.** The LT encoder is rateless; how many frames a transfer
  needs depends on channel loss and is unknowable in advance.
- **One pass would not fit.** 4 GB ≈ 550,000 frames; as 1080p `ImageData` that is
  **4.2 TB**, ~55 GB even as PNGs.
- **On-demand is cheap.** ~0.29 ms per v15 tile (from 1.53 ms at v40, mask pinned) ×
  15 tiles × 15 fps ≈ **65 ms/sec, ~7% of one core**, plus ~2.3 ms/sec to render, plus
  **fountain XOR: 3.4 KB/packet at d ≤ 64 (D25) = 0.8 MB/s** at this geometry's
  **450 packets/s** (15 tiles × 2 packets/tile × 15 fps, using the R2 nominal rung) —
  negligible, but only because of the cap. Uncapped it is 6.1 MB/s
  at K = 768, and was 91.8 MB/s at the old K = 16,384.

Because indices derive from a PRNG (D7), the sender is **stateless**: frame *N* generates
directly without replaying 1…*N*−1. That is what makes resume and repair nearly free.

**Implementation:** worker generator → ring buffer (depth 3) → main thread paints via
`rAF`. Deeper buffering is wasted memory (I7).

#### 6.3.2 Shape the code region to the CAMERA, not the screen

Measured, and worth ~4–5× on its own. The receiver's camera has a fixed aspect and a fixed
pixel count; the sender's screen has a different one. What matters is **camera px per module**
(§2), and that is set by how much of the capture the code region fills.

A 1920×1080 landscape code region imaged by a portrait 1080×1920 capture yields **M = 0.5625** —
so 4 screen px/module is only 2.25 camera px/module, below the cliff. Rendering the *same*
payload into a **portrait-shaped region** inverts this:

| Code region on screen | M | Camera px/module @ 2 screen px | Tiles | QR cap/frame | Payload/frame |
|---|---|---|---|---|---|
| 1920×1080 (naive: fill the screen) | 0.56 | 1.13 — **far below cliff** | 15 | 8.8 KB | 7.5 KB |
| 1080×1080 square | 1.00 | 2.00 — below cliff | 9 | 5.3 KB | 4.5 KB |
| **540×960 portrait** | **2.00** | **4.00 — above cliff** | 15 | **8.8 KB** | **7.5 KB** |

Same tile count and same bytes per frame as the naive layout, but *above* the cliff instead of
below it — so yield goes from roughly a fifth to near-total. **The sender MUST size the code
region to the receiver's capture aspect, not to its own display.** Since there is no
back-channel, it cannot know that aspect: expose it as a user-visible setting (portrait /
landscape receiver) **defaulting to portrait, which is how phones are held — and portrait is
a fully supported mode, not a degraded one.** The 540×960 portrait region above clears the
cliff (4.00 camera px/module) at the *same* 7.5 KB/frame payload as the naive landscape
layout. **Phase 3's ≥ 20 KB/s gate MUST pass with the receiver held portrait, unaided** —
that is the default, unassisted case, not a stretch goal.

**Packets-per-tile basis.** The R2 nominal rung (v16-L, 60% of tiles in steady state per D18a)
carries **2 packets per tile**. Each packet is 269 B (13-byte header + 256 B payload), so
2 packets = 538 B per tile, which fits within v16-L's 586 B capacity. The **user-visible payload**
is 15 tiles × 2 packets/tile × 256 B = **7,680 B/frame ≈ 7.5 KB/frame**, matching the table
above (per §13.2, all throughput figures quote user-visible bytes, not wire bytes). The **8.8 KB/frame
QR capacity** is 15 tiles × 586 B (v16-L capacity). At 15 fps, this geometry delivers
**7.5 KB × 15 fps = 112.5 KB/s payload rate** (or ~113 KB/s) before fountain overhead
and erasure loss.

**Two routes to the same M; landscape is a free bonus, not a requirement.** Physically holding
the receiver in landscape puts the screen's long axis on the camera's long axis — **1.78×,
free, and it does not require halving screen px/module the way the portrait-region layout
does** — so it is worth *offering* to a user willing to turn the phone. But the app MUST NOT
depend on the user doing so: the sender-side portrait region (above) is the primary,
always-on path, and landscape is strictly an optional upgrade for extra margin on top of it.

Verified negative: forcing the receiver's *OS* orientation does not help — sensor mapping
follows the device body, not the UI. Since portrait is the supported default, this mostly
doesn't matter; it only matters for the optional landscape upgrade, which needs a *physical*
turn (§11 `E-ORIENTATION`, reframed below as a tip, not a requirement).

### 6.4 Receiver pipeline

```
getUserMedia ──► exposureCompensation:min (D14) ──► measure real fps (rVFC, ~1 s)
      │
      └──► requestVideoFrameCallback ──► MediaStreamTrackProcessor*
                                                │
                              ROI crop (conditional — see §6.4)
                                                │
                              ┌─────────────────┴──── Worker pool ────┐
                              ▼                                       ▼
                      zxing readBarcodes                     [Stage 2: split
                      (all symbols, .bytes)                   R/G/B, stretch, ×3]
                              │
                    header parse ──► fcrc ──► streamId lock ──► route by blockIndex
                              │                                        │
                     beacon? ──┴──► learn size/blocks/K/hash    payload ──► GE decoder
                                    (gates everything)
                                                        rank == K ──► verify block hash
                                                                  ──► write to OPFS
                                                                  ──► mark bitmap, free
                                                                              │
                                            all blocks present ──► [decompress] ──► save
```

\* `MediaStreamTrackProcessor` is **Chromium-only**; `requestVideoFrameCallback` +
`drawImage` is the universal fallback and MUST be implemented (§16.3).

**Block-layer working set: 264.0 KB** — 72.0 KB matrix + 192.0 KB block — flat regardless
of file size. This is *not* the whole-receiver figure; see I6a/I6b in §5.

Three rules that are cheap to implement and expensive to omit:

- **Measure fps, never trust it.** `getSettings()` reports 30/60 while the camera
  delivers 15.
- **Crop to ROI before decoding — but the 9× is conditional.** Measured 8.6× (56.9 → 6.6 ms)
  *when the code occupies part of the frame*. Once the grid fills the frame — which is what
  you want for camera px/module — **the ROI is the frame and the win evaporates** (69 ms).
  ROI is a recovery mechanism for being too far away, not a throughput optimisation at the
  right distance. **Except at high capture resolution**, where a tight quad-crop is what keeps
  camera px/module high *and* pixel count bounded at once — there it is load-bearing, and must
  be far tighter than the spike's 35%-margin version.
- **Select capture resolution deliberately — it is a first-class tunable.** Measured knee:
  720p → 100% erasure (1.5 camera px/module, nothing decodes); 1080p → best goodput; 4K →
  zero empty frames but 194 ms decode and 1.1 fps, net *worse*. Decode is O(pixels), so more
  resolution is not free. `getUserMedia` defaults are **not** adequate: a Pixel 6 defaults to
  1080 on the *short* edge.
- **Shape the code region to the camera, not the screen (sender-side, §6.3.2).**
- **Never offer a torch button.** It measured a 3.6× fps gain, which makes it tempting,
  but an LED on a glossy screen creates a specular hotspot that destroys a region of the
  frame. `exposureCompensation` gets the same mechanism without glare.

### 6.5 Module layout and dependency pins

Committed in Phase 0 so "where does this go?" is not re-litigated eight phases running.
Note the layer boundaries of §6.1 and the thread boundaries of §6.2 are **not** the same,
so the tree separates them explicitly.

```
src/
  core/                 # pure, no DOM, no workers — the testable heart
    fountain/           #   lt-encode.ts  ge-decode.ts  prng.ts  degree.ts
    block/              #   partition.ts  bitmap.ts  schedule.ts
    frame/              #   header.ts  beacon.ts  crc.ts  repair-code.ts
    hash/               #   block-hash.ts  stream-id.ts
  modulation/           # the swappable layer (§6.1)
    types.ts            #   the Modulation interface — the ONLY contract above
    qr-tiled/           #   stage 1: encode.ts  decode.ts  layout.ts  ladder.ts
    qr-colour/          #   stage 2
    grid/               #   stage 3
  workers/              # one file per thread role (§6.2)
    encode.worker.ts  decode.worker.ts  ge.worker.ts  opfs.worker.ts
  platform/             # every capability probe and fallback lives here
    camera.ts  storage.ts  wakelock.ts  share.ts  capabilities.ts
  ui/                   # role select, progress, coaching, pre-flight
  app.ts
test/
  fixtures/             # conformance vectors (§14.3)
  degradation/          # synthetic blur/glare/tear generators
docs/                   # plan, notes, research, sim
```

**Rules.** `core/` MUST NOT import from `modulation/`, `workers/`, `platform/` or `ui/` —
it is the layer the property tests own. Nothing outside `modulation/` may reference QR
(D-modulation-swappable). Every browser capability check lives in
`platform/capabilities.ts`, never inline at a call site, so §16.1's platform matrix has
exactly one implementation.

**Dependency contract.** Exact-pinned, no ranges, no post-install scripts (gate G3).

| Dependency | Pin | If unavailable |
|---|---|---|
| `zxing-wasm` | exact version + SRI on the `.wasm`. **MUST call `setZXingModuleOverrides({ locateFile })` pointing at a bundle-local, service-worker-precached `.wasm`.** See the warning below | Fatal on the receiver — surface `E-WASM-LOAD`; the sender still works |
| `node-qrcode` | exact version | Fatal on the sender; the receiver still works |
| `CompressionStream` | platform | Skip compression (D8 is already conditional) |
| `MediaStreamTrackProcessor` | platform | Fall back to `requestVideoFrameCallback` + `drawImage` — MUST be implemented, it is not Chromium-only |
| OPFS | platform | Refuse large files; cap at in-memory size and say so |
| Wake Lock | platform | Warn before a long transfer (`E-WAKELOCK-LOST`) |

> ### ⚠️ `zxing-wasm` fetches its WASM from a CDN by default — this voids the entire premise
>
> Verified in the installed package: `dist/es/core-*.js` hard-codes
> `https://fastly.jsdelivr.net/npm/zxing-wasm@<ver>/dist/…` and fetches the `.wasm`
> **lazily on the first decode call**, not at page load. Shipping the default means the
> receiver:
>
> 1. makes a **third-party network request mid-session** — voiding T7, concept.md
>    constraint 1, and the README's "provably no exfiltration";
> 2. **fails completely in airplane mode** — i.e. in the flagship air-gapped use case (A8);
> 3. **executes remotely-fetched WASM** — precisely the supply-chain surface T5 exists for.
>
> The `.wasm` MUST be bundled, precached by the service worker, and located via
> `setZXingModuleOverrides`. §14.4's assertion covers this, and it is a **Phase 2 entry
> criterion** because Phase 2 is the first phase that loads a decoder.

**Cross-origin isolation.** The pipeline uses transferable `VideoFrame`s and
`ArrayBuffer`s, **not** `SharedArrayBuffer` — so COOP/COEP headers are **not** required.
This is deliberate: requiring them would constrain static hosting for no gain. Any future
use of `SharedArrayBuffer` is a hosting decision, not just a code change.

### 6.6 The luma-vs-colour disagreement, and how it is resolved

| | `custom-codec-engineering.md` §7.2 | `beyond-qr-optical-channels.md` §6.6 |
|---|---|---|
| Colour cell penalty under 4:2:0 | 2× linear (4× area) — **derived** | 1.25× linear (1.56× area) — **measured** |
| Verdict | luma-only wins ~1.95× | RGB-tripling wins **1.98×** |

The measured result is better founded and the mechanism convincing: **chroma decimation
is a low-pass filter, not a deletion.** A binary chroma pattern at 5 px/module presents
2.5 chroma samples per module — above Nyquist; at 4 px/module exactly 2.0, right at
Nyquist, which is where the measurement breaks. The "2× per axis" rule over-corrects by
restoring the *original* sampling density rather than staying above Nyquist in the
decimated grid.

Also weighing against luma-only: 8-level luma measured **unusable** under handheld blur
(21.2% symbol error at 5 px/cell) vs **0.00%** for saturated 8-colour at 4 px/cell; and
**libcimbar spends 2 of its 6 bits per cell on colour**, with its deprecated 8-colour
mode benchmarking *faster*.

**Resolution (D11): neither document decides.** A calibration probe measures the device
at session start. Where the luma-side note is unambiguously right: **AWB warps colour in
three non-monotonic dimensions** and cannot be locked on iOS, so a per-frame in-band
colour reference is **not optional** for Stage 2.

---

## 7. Data model

### 7.1 Payload packet header — 13 bytes

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | `magic_ver` | 4-bit magic + 4-bit wire version. Rejects foreign QR instantly. See §16.3 for version skew. |
| 1 | 1 | `flags` | packet type (payload/beacon), reserved |
| 2 | 4 | `streamId` | Identifies the **file**. Seeds the PRNG; receiver locks it on first sight. Derivation: §7.4 |
| 6 | 3 | `blockIndex` | 16.7 M blocks × 192 KB = **3.0 TB** addressable — beyond any practical transfer (1 TB is 117 days) |
| 9 | 3 | `seq` | Sequence **within the block**; with `streamId`+`blockIndex` derives the index set |
| 12 | 1 | `fcrc` | CRC-8 — rejects a mis-decode before it poisons the matrix |

`K`, `L` and the index set remain **derived, never transmitted** (I3).

**`fcrc` covers bytes 0–11 only — the header, NOT the payload.** This is deliberate: CRC-8
over 269 bytes would be weak anyway, and the header is what must be trusted before a packet
is routed to a block. But the consequence must be stated plainly:

> **A packet whose header is intact and whose 256-byte payload is corrupted passes `fcrc`
> unconditionally and poisons the GE matrix.** `fcrc` is a routing guard, not an integrity
> check.

Payload integrity therefore rests on exactly two things: QR's own Reed–Solomon (which makes
an undetected symbol error rare, but not impossible) and **the per-block hash (§7.6), which
is the sole application-layer check on payload bytes.** That is why I9 is a MUST: a block
that reaches rank K and fails its hash is discarded entirely and re-collected
(`E-BLOCK-HASH`, §11, E12). A test MUST corrupt a payload byte and assert the block hash
catches it — corrupting only header bytes, as the current suite does, cannot detect this
class at all.

### 7.2 Beacon frame (D17/D21)

Emitted every ~2 s at the most conservative profile. Everything the receiver needs before
it can interpret any payload packet:

| Field | Size | Notes |
|---|---|---|
| `streamId` | 4 | Must match payload packets |
| `wireVersion` | 1 | Full version, not the 4-bit nibble |
| `fileSize` | 6 | 281 TB addressable — **MUST be bounds-checked** (§12, T1) |
| `blockSize`, `blockCount` | 3 + 3 | Yields K and the last block's short length |
| `fragmentLen` (L) | 2 | Fixed for the session (I1) |
| `degreeCap` | 1 | D25; receiver MUST use the same cap |
| `flags` | 1 | compressed / hash alg / colour profile |
| `blockHashLen` | 1 | Per-block hash truncation length |
| `wholeFileHash` | 32 | **Mandatory.** concept.md constraint 4 makes byte-exact reconstruction non-negotiable and names this as the verification. An earlier revision made it optional "on very large files" — i.e. dropped the guarantee exactly where E5 (source mutated during a 10-hour read) is most likely and the stakes are highest. Computed by streaming the reassembled file through an incremental WASM hasher (§3.3); the cost is one extra read, not one extra copy |
| `filename`, `mimeType` | var | Length-prefixed UTF-8, **sanitised** (§12, T2) |

The receiver shows "acquiring…" until its first beacon.

### 7.6 The block-hash manifest — how per-block hashes reach the receiver

I9, E12, §6.4, §8.3 and §7.4 all depend on per-block hashes, and §7.1 establishes they are
the *only* application-layer check on payload bytes. Nothing in the wire format carried
them: the 13-byte header has no room, and the beacon carries only `blockHashLen`.

**A 4 GB file has 21,845 blocks. Even 4-byte hashes are 87 KB — far beyond a beacon.**

**Resolution: hashes travel as a manifest, fountain-coded like any other block.**

| Property | Value |
|---|---|
| Transport | A dedicated **manifest stream**, `blockIndex = 0xFFFFFF`, distinguished by `PacketFlags.Manifest` |
| Contents | `blockCount × blockHashLen` truncated hashes, in block order |
| `blockHashLen` | **4 bytes.** Per-block false accept 2⁻³², ~5×10⁻⁶ across 21,845 blocks — comfortably below the whole-file hash's job |
| Coding | Its own `K_manifest = ceil(blockCount × 4 / L)`, same LT encoder, same GE decoder |
| Cadence | Interleaved with payload on the same schedule as the beacon (D17), so a late joiner acquires it without waiting a pass |
| Before it arrives | Completed blocks are written to OPFS but **not marked in the bitmap**; they are verified retroactively once the manifest decodes. The receiver reports "verifying…" rather than claiming completion |

**Why not append the hash to each block's payload:** it would make the payload
`blockSize + 4`, breaking `blockSize = K·L` and therefore D19's entire arithmetic and G7.

**Sizing sanity:** 21,845 × 4 B = 87 KB ⇒ `K_manifest` = 342 fragments — one third of a
normal block, decodable well inside the first pass.

### 7.3 Session state

```ts
type SendSession = {
  source: File;
  staging: FileSystemFileHandle | null;   // compressed copy (D8) — MUST be wiped
  streamId: number;
  blockSize: number; blockCount: number;
  readonly fragmentLen: number;           // L — I1
  readonly K: number;                     // D26
  cursor: { blockIndex: number; seq: number };
  dwellPackets: number;                   // §8.1
};

type RecvSession = {
  streamId: number | null;                // locked on first valid header
  meta: BeaconMeta | null;                // gates everything
  complete: Uint8Array;                   // block bitmap — the resume token
  active: { blockIndex: number; pivots: Map<number, GERow>; rank: number } | null;  // I5
  out: FileSystemWritableFileStream;      // OPFS
  stats: { fps: number; cameraPxPerModule: number; packetsPerSec: number; eta: number };
};
```

Partial state for a block the sender has moved past is **discarded, not persisted** — a
badly damaged block rarely half-completes usefully, and persisting it would defeat I6.
The bitmap is tiny: 4 GB / 192 KB = 21,845 blocks = **2.7 KB**.

### 7.4 `streamId` derivation

Load-bearing: D22 resume requires that re-selecting the same file reproduces the same
`streamId`, and §3.3 says a full multi-GB hash is not free.

**Derivation (sender):**

```
streamId = CRC32( fileSize ‖ first 64 KB ‖ middle 64 KB ‖ last 64 KB ‖ lastModified )
```

Three sampled windows plus size and mtime. Costs ~200 KB of reads regardless of file
size, so it is instant even for 4 TB.

**What this buys and what it does not:**

- ✅ Same file re-selected → same `streamId` → resume works.
- ✅ Different files → different `streamId` with overwhelming probability.
- ⚠️ A file edited **only in the middle**, keeping size and mtime, collides. Mitigated by
  including `lastModified`, and by per-block hashes catching the mismatch at block level.
- ⚠️ This is **not** a content-integrity hash. The whole-file hash (§7.2) is, and is
  optional. `streamId` is an *identifier*.

Deliberately **not** `crc32(payload)` — the research's original design — because the
block layer made a full-payload pass unaffordable.

### 7.5 Repair code format (§8.2)

A human types this, so it must be short, unambiguous, and self-checking.

```
SF1-<streamId36>-<ranges36>-<check>
```

- **Alphabet:** Crockford base32 (no I/L/O/U — removes the common misreadings).
- **`ranges`:** run-length encoded missing-block set. Contiguous runs are the common case
  because misses cluster (the user looked away).
- **`check`:** 2 characters, CRC-8 over the decoded body. A mistyped code MUST be
  rejected, never acted on — acting on a corrupted range wastes hours.
- **Length bound:** if the encoded form exceeds **48 characters**, the receiver MUST
  instead offer a QR containing the same payload (which the sender's camera reads, or the
  user photographs), and say so. A 100 GB file with scattered misses can exceed any
  reasonable typing length, and silently truncating the set would be a correctness bug.

---

## 8. Behaviour at gigabyte scale

### 8.1 Block scheduling and the dwell budget

The sender does not know which blocks the receiver has, so it dwells on each block for
`dwellPackets`, then advances, looping the file continuously.

**Dwell must survive the top of the assumed erasure band.** An earlier revision paired
dwell 1.4 K with a 20–30% band, which failed at the top of its own band — at 30%
erasure, 1.4 K delivers 0.98 K against the ~1.02 K needed, so **every block missed its
first pass**, each costing a full extra pass.

The fix is to raise dwell, **not** to narrow the band. Narrowing it (a briefly-adopted
mistake) contradicts the evidence base, which specifies 20–30% and warns that driving
erasure lower means the ladder is too conservative and throughput is being left unused.

| dwell | 20% erasure | 25% | **30%** | needed |
|---|---|---|---|---|
| 1.4 K | 1.120 K | 1.050 K | **0.980 K ❌** | ~1.02 K |
| **1.6 K** | 1.280 K | 1.200 K | **1.120 K ✅** | ~1.02 K |

- **dwell = 1.6 × K** (default; tunable)
- **assumed band = 20–30%** (D18c) — an assumption, not a controlled target

A test MUST assert `dwell × (1 − erasure_max) ≥ 1.12`, matching §13.1's +12% p99
overhead budget, so dwell and the band cannot drift apart again.

**When real erasure exceeds 30%** — which nothing in v1 can detect (D18a) — blocks miss
and the **repair code (§8.2) is the recovery path**, not a tighter loop. This is the
designed answer, not a gap.

**Dwell is a standing ~60% overhead.** The sender always emits 1.6× what a block needs,
whatever the channel. §13.1's throughput budgets are stated **after** this factor —
they are goodput, not wire rate.

### 8.2 Human-mediated repair — the cheap back-channel

The receiver knows exactly which blocks it lacks. The user reads a code off one screen and
types it into the other:

> **Receiver:** "Missing 3 blocks. Repair code: `SF1-K7F2M9-3B-X4`"
> **Sender:** [paste] → transmits only those blocks

Turns a multi-hour extra pass into a sub-minute repair, needs no second camera and no
geometry constraints, and is what makes small blocks (§3.4) affordable. Format: §7.5.

### 8.3 Resume (D22)

The receiver persists `{streamId, meta, bitmap}` plus the OPFS output after every completed
block. On reload it offers to resume. At 2.7 KB per 4 GB this is nearly free.

The sender is stateless across restarts by construction (D24) **when compression is disabled** —
it needs only the same file and the same `streamId` (§7.4). **With compression enabled, resume is
NOT supported** — see `notes/bf-17s0-resume-compression-conflict.md` for the full analysis.
The short version: `CompressionStream` offers no determinism guarantee, so re-compression after
staging is reaped (E11) would produce different blocks and silently corrupt the receiver's state.
The beacon carries a `RESUME_DISABLED` flag when compression is on; the receiver uses it to
suppress the resume UI.

**On resume the receiver MUST re-verify block hashes** rather than trusting the bitmap, in
case OPFS was corrupted or the file was touched externally.

### 8.4 Storage limits

| Platform | Practical quota |
|---|---|
| Chrome / Edge desktop | ~60% of free disk — multi-GB fine |
| Firefox | ~10% of disk (capped ~10 GB) |
| **Safari / iOS** | **~1 GB** before prompting; expandable but user-gated |

**Multi-GB reception is a desktop-Chromium story.** The app MUST query
`navigator.storage.estimate()` up front and refuse clearly (§13.1) rather than failing at
hour 9. With compression on, staging needs the compressed size *plus* the output.

---

## 9. Acceptance scenarios

Named, independently verifiable, with explicit pass **and fail** criteria. "Fail" means
stop and reconsider the design, not retry.

| # | Scenario | Setup | Action | Pass | Fail |
|---|---|---|---|---|---|
| **A1** | Small file, ideal conditions | Laptop (1080p, 50% brightness min) → Pixel-class phone, 30 cm, office lighting (~300 lux), tripod | Send a 1 MB binary file (random bytes, incompressible) | Byte-identical output; ≥ 20 KB/s sustained; completes in ≤ 60 s | < 10 KB/s, or any byte differs |
| **A1-lite** | Byte-exactness on two real devices | Two real devices (any configuration) | Send any file | Byte-identical output | Any byte differs |
| **A2** | Handheld, realistic | As A1 but handheld, receiver held **portrait** (the default, unassisted grip — §6.3.2) | Send 1 MB | Byte-identical; ≥ 10 KB/s | Does not complete in 5 min |
| **A3** | Phone → phone | Two phones, 15 cm, handheld | Send 100 KB | Byte-identical; completes in ≤ 5 min | Does not complete — triggers §18 R4 |
| **A4** | Lossy channel | A1 setup; camera deliberately occluded 30% of the time in 2-second bursts | Send 1 MB | Byte-identical; ≤ 1.6× the A1 frame count | > 3× A1 frame count (fountain code is not delivering) |
| **A5** | Large file, memory flat | Desktop Chromium, synthetic 4 GB stream, headless block layer | Full encode→decode at the block layer | Byte-identical; peak heap ≤ 1 MB (I6a); no growth trend across 21,800 blocks | Any monotonic memory growth |
| **A6** | Resume | A1 setup, 10 MB file | Reload the receiver tab at ~50% | Offers resume; completes; byte-identical | Restarts from zero, or completes with wrong bytes |
| **A7** | Repair | A1 setup, 10 MB file, 5 blocks deliberately dropped | Enter the repair code on the sender | Only the missing blocks retransmit; completes in < 60 s | Full pass required |
| **A8** | Offline | Both devices in airplane mode, app previously loaded | Full A1 transfer | Completes normally | Any network request attempted (asserted by CI, §14.4) |
| **A9** | Wrong stream | Two senders visible in frame | Receiver points at both | Locks one `streamId`, ignores the other, says so | Mixes packets from both |
| **A10** | Hostile beacon | Crafted beacon declaring `fileSize` = 281 TB | Receiver parses it | Refuses with `E-META-BOUNDS`; no allocation attempted | Allocates or crashes |

**Adoption metrics are deliberately absent.** With no backend and no telemetry there is no
way to measure them, and the ledger consciously cut the voluntary-benchmark idea. This is a
stated limitation, not an oversight — see §18 R8.

---

## 10. Edge case catalog

| # | Case | Resolution |
|---|---|---|
| E1 | **Zero-byte file** | Reject at selection with a clear message. `K = 0` is undefined. |
| E2 | **File smaller than one fragment** (< 256 B) | Pad to one fragment; `K = 1`; the fountain code degenerates to repetition, which is correct. Research specifies a `K < 8` guard — adopt it: below 8 fragments, send plain repetition, no LT. Signalled by a `flags` bit in the beacon so the receiver selects the same path. |
| E3a | **The last block is short** — its K is `ceil(lastLen / L)`, not 768. Both sides derive K per block, and D7's PRNG is seeded with it. A mismatch produces wrong index sets, so the block never decodes and nothing says why. | Derive per-block K from `(blockIndex, blockSize, fileSize)` in **one shared function** used by both encoder and decoder; conformance vector covers the last block explicitly. |
| E3b | **`blockCount == 1`** | Normal path; no special case, but tested explicitly since off-by-one in block iteration is likely. |
| E4 | **Incompressible input where deflate expands it** | D8 samples first; if the sample ratio > 0.92, skip compression. If compression still expands, discard the staging file and send raw. |
| E5 | **Source file changes mid-transfer** | A 10-hour read of a live `File` handle is the *normal* case. Re-check `file.size` and `lastModified` before each block read; on mismatch abort with `E-SOURCE-CHANGED`. Emitting blocks from two versions would produce a file that passes per-block hashes and fails the whole-file hash after hours. |
| E6 | **Duplicate packet arrives** | GE reduces it to a zero row; contributes nothing, costs one reduction. No special handling. |
| E7 | **Two senders in frame** | `streamId` lock (A9); packets from the unlocked stream are discarded and surfaced as `E-FOREIGN-STREAM`. |
| E8 | **Tab backgrounded on the sender** | `rAF` stops in a background tab, so a 10-hour transfer silently halts. Wake Lock does **not** cover this. Detect via `visibilitychange` and warn loudly; the transfer is paused, not failed. |
| E9 | **Camera permission revoked mid-run** | Pause, preserve the bitmap, prompt for re-grant. Never discard collected blocks. |
| E10 | **OPFS quota exhausted mid-transfer** | Stop, keep completed blocks, export a partial file plus a manifest of what is missing. Never silently truncate. **The kept partial artefact follows T4b's deletion lifecycle** — warn the user before keeping it, provide a delete control, and reap on startup. |
| E11 | **Abandoned staging file** | Sender-side staging keyed by `streamId`; on startup, reap staging files with no active session. Also a privacy requirement (§12, T4a). |
| E12 | **Block reaches rank K but fails its hash** | Discard the whole block, clear its bitmap bit, re-collect. Emit `E-BLOCK-HASH`. This is the CRC-8 false-accept path (§7.1) and MUST be implemented — at GB scale a silent re-do costs hours. |
| E13 | **Whole-file hash fails after all blocks pass** | Indicates E5 or a block-hash collision. Report `E-FILE-HASH`; keep the output and label it unverified rather than deleting hours of work. |
| E14 | **Filename with path separators or control bytes** | Sanitise on export (§12, T2). Never write an attacker-chosen path. |
| E15 | **Decompression fails at the end** | All blocks verified but the gzip stream is invalid → `E-DECOMPRESS`; keep the compressed artefact so nothing is lost. **The kept artefact follows T4b's deletion lifecycle** — warn the user before keeping it, provide a delete control, and reap on startup. |
| E16 | **Worker crash mid-block** | Restart the worker, discard the active block only, keep the bitmap. |
| E17a | **Sender-side thermal throttling** | Observed: the bench laptop decayed 6.7 → 2.4 fps over two minutes. Locally observable, so D18b's local step-down applies. |
| E17b | **Receiver-side thermal throttling** | Observed at **70 °C / throttling threshold within 20–30 minutes**. D18a's rule bites: fps decline is a *receiver* observation, the ladder is a *sender* control, and there is no back-channel — so "step the ladder down" is **structurally impossible** here. Mitigate locally instead: **duty-cycle (D27)** and drop decode resolution. |
| E18 | **Resume offered for a file the user no longer has** (sender side) | `streamId` mismatch on re-selection → offer a fresh transfer, do not silently restart. |

---

## 11. Error taxonomy

Every distinguishable condition gets a stable code and one user-facing sentence. Defined
now, before Phase 5 designs any UI — after that, taxonomies get retrofitted to screens.

**Optical / acquisition** (the stall detector's job, `bf-5vm`):

| Code | Meaning | User-facing |
|---|---|---|
| `E-NO-SIGNAL` | No decodable tiles at all | "Point the camera at the sending screen." |
| `E-TOO-FAR` | **camera** px/module < 4 (§2) | "Move closer — the code is too small to read." |
| `E-TOO-CLOSE` | Symbol exceeds frame, or below min focus | "Move back a little." |
| `E-BLUR` | Sharpness metric below threshold | "Hold steady." |
| `E-DARK` | Insufficient exposure | "Too dark — raise the sender's screen brightness." |
| `E-GLARE` | Saturated region over the code | "Tilt to avoid the reflection." |
| `E-FOCUS-HUNT` | Focus oscillating | "Tap the screen to lock focus." |
| `E-ORIENTATION` | Detected capture aspect doesn't match the sender's configured setting (§6.3.2) — e.g. sender is shaping the code for landscape but the receiver is held portrait | "This app works fine held normally — but if you'd like more margin, match the orientation setting on the sending device, or turn the phone sideways." (tip, not a blocker — portrait is fully supported) |
| `E-SENDER-STALLED` | Identical frames repeating | "The sending device seems paused." |
| `E-TORN` | Torn-frame rate high | "Lower the sender's frame rate." |

**Protocol:**

| Code | Meaning | User-facing | Recovery |
|---|---|---|---|
| `E-FOREIGN-STREAM` | Different `streamId` (E7) | "That's a different file — ignoring it." | automatic, informational |
| `E-VERSION` | Unknown `magic_ver` (§16.3) | "The sending device is running version X; this one is Y. Update both." | user must update |
| `E-META-BOUNDS` | Beacon field out of bounds (T1) | "That transmission looks malformed and was rejected." | automatic, refuse |
| `E-BLOCK-HASH` | Rank K reached, hash failed (E12) | "A chunk arrived corrupted and is being re-collected." | automatic retry |
| `E-FILE-HASH` | Whole-file hash failed (E13) | "The file is complete but failed its final check — saved as unverified." | keep output, warn |
| `E-REPAIR-CODE` | Repair code checksum failed | "That repair code doesn't look right — check it and try again." | user re-enters |
| `E-WASM-LOAD` | Decoder failed to load | "The scanner failed to start. Reload the page." | user reloads |

**Local / resource:**

| Code | Meaning | User-facing | Recovery |
|---|---|---|---|
| `E-QUOTA-PREFLIGHT` | Not enough storage (§13.1) | "Not enough free space: this needs X, you have Y." | user frees space |
| `E-QUOTA-EXHAUSTED` | Ran out mid-transfer (E10) | "Out of space. Saved what arrived — X of Y chunks." | partial export |
| `E-SOURCE-CHANGED` | Source mutated (E5) | "The file changed while sending. Start again to avoid a corrupt copy." | restart required |
| `E-BACKGROUNDED` | Sender tab backgrounded (E8) | "Sending paused — keep this tab visible." | auto-resume on focus |
| `E-CAMERA-LOST` | Permission revoked (E9) | "Camera access ended. Your progress is saved." | re-grant, resume |
| `E-WAKELOCK-LOST` | Screen may sleep | "The screen may turn off. Adjust your sleep settings." | user acts |
| `E-DECOMPRESS` | Decompression failed (E15) | "Everything arrived but couldn't be unpacked. The raw data was kept." | keep artefact |

---

## 12. Threat model

The README claims "provably no exfiltration" and "auditable once and trusted thereafter".
That claim needs backing. In scope for v1:

| # | Threat | Stance | Test |
|---|---|---|---|
| **T1** | **Crafted optical stream — resource exhaustion.** Beacon-declared `fileSize` (281 TB), `blockCount` (16.7 M) and `L` are attacker-controlled and size allocations. | **Mitigated.** Bounds-check every beacon field before use: `L` ∈ [1, 4096], `K` ≤ locally benchmarked max (D26), `blockCount` ≤ 16.7 M, `fileSize` ≤ available quota. Reject with `E-META-BOUNDS`. Never allocate from a declared size. | A10 + fuzz beacon fields |
| **T2** | **Path traversal / hostile filename.** `filename` is attacker-supplied and reaches a save dialog. | **Mitigated.** Strip path separators, control bytes and leading dots; cap length; never pass through unsanitised. | unit: filenames with `../`, NUL, control bytes |
| **T3** | **Decompression bomb.** The receiver decompresses attacker-supplied data. | **Mitigated.** Enforce a max expansion ratio (100:1) and an absolute cap = declared `fileSize`; abort with `E-DECOMPRESS` on overrun. | unit: 1 GB-expanding zip bomb → `E-DECOMPRESS` |
| **T4a** | **Sender-side plaintext residue.** D8 writes a *decompressed-equivalent* copy of the user's file to OPFS as staging. For the flagship use case (SSH keys, PSBTs, TOTP seeds) this is real exposure. | **Mitigated.** Wipe staging on completion, on cancel, and on startup-reap (E11). Document that OPFS is not encrypted at rest and the OS/browser may retain it. | integration: assert sender OPFS empty after complete/cancel/reap |
| **T4b** | **Receiver-side plaintext residue.** The receiver stages the complete decoded file in OPFS. The output **is** the deliverable — it cannot be deleted immediately. For sensitive files (SSH keys, PSBTs, TOTP seeds) indefinite storage is exposure. | **Mitigated.** Implement a deletion lifecycle: (1) delete after successful `share()`/`save()`; (2) reap orphaned outputs on startup; (3) warn before keeping partial artefacts (E10, E15); (4) provide a user-visible delete control. Document that OPFS is not encrypted at rest. | integration: assert receiver OPFS empty after successful save; reap deletes orphans; UI has delete control; warning shown for partial artefacts |
| **T5** | **Supply chain.** The security claim depends on the bundle being what was audited. | **Partially mitigated.** `bf-13h` covers the output half (version footer + published hash). The input half — pinned dependency versions, WASM integrity, no post-install scripts — is a Phase 0 requirement (§14.5). | G3: lockfile diff + SRI check in CI |
| **T6** | **Shoulder-surfing / filming.** The optical channel is uniquely exposed: anyone with a camera in the room captures the same stream. | **Accepted for v1, consciously.** concept.md scopes encryption as a non-goal; §19 Q10 keeps it live. The app MUST NOT claim confidentiality it does not provide — the UI should say the transmission is visible to anyone who can see the screen. | none — accepted, not mitigated |
| **T7** | **No telemetry, by construction.** | **Committed.** The app makes **zero** network requests after load. Enforced by CI (§14.4) and by A8. This is a stronger and more checkable claim than a privacy policy. | §14.4 network assertion + A8 |

**Out of scope for v1, stated:** authenticating the *sender* (no PKI, no trust anchor); a
malicious *receiver* (it only gets what it is shown); side-channels other than the optical
one; physical device compromise.

---

## 13. Performance budgets and benchmark contract

### 13.1 Budgets — committed, not forecast

§15's table is *expectation*. These are the numbers the build is held to.

**Throughput basis.** All throughput budgets are **user-visible file bytes per second** after:
- Fountain coding overhead (+12% p99 at K=768 with D25's cap)
- Erasure loss (20–30% assumed band per D18c)
- Dwell overhead (60% standing overhead per §8.1)

The gross wire rate at the R2 nominal rung (v16-L, 2 packets/tile, 15 tiles, 15 fps) is
**112.5 KB/s payload** (7.5 KB/frame × 15 fps). After fountain (+12%) and 30% erasure,
net goodput is **~70 KB/s** — well above the 20 KB/s budget.

| Budget | Value | Gate |
|---|---|---|
| Throughput, A1 reference setup | **≥ 20 KB/s** sustained | Phase 3 |
| Throughput, A3 phone→phone | **≥ 3 KB/s** sustained | Phase 3; miss triggers §18 R4 |
| Block-layer working set | **≤ 1 MB**, any file size (I6a) | Phase 1 |
| Whole-receiver peak | **≤ 64 MB**, ≤ 4 in-flight `VideoFrame`s (I6b) | Phase 3 |
| GE sustained XOR need | **≤ 200 MB/s** at the fastest supported stage (modelled 114.6 MB/s, 1.74× margin) — **measured 3,260 MB/s desktop / ~815 MB/s est. phone; the budget was ~16× pessimistic.** R1 provisionally closed, pending an on-device run *while thermally throttled* | Phase 1 + G7 |
| Per-camera-frame decode | **≤ 60 ms** p99 (leaves headroom at 15 fps) — **measured 67–69 ms p50 full-frame, 194 ms at 4K, 6.6 ms with a tight ROI. p50 already exceeds the p99 budget**; the fixes (worker pool §6.2, tight ROI §6.4) are unimplemented, so this is violated by the instrument, not yet by the design | Phase 3 |
| Encode + render per frame | **≤ 20 ms** p99 — **measured ~150 ms** (6.7 fps against 12 requested) on a 2015 laptop with D4's pinned mask unimplemented | Phase 3 |
| Time-to-first-packet after aim | **≤ 3 s** p50 | Phase 5 |
| Reception overhead vs K | **≤ +5%** mean, **≤ +12%** p99 (measured: +2.97% / +4.2%) | Phase 1, `sim/` |
| **Sustained operation duration** | **≥ 20 min** sustained throughput within **30% of initial rate** on target phone (Pixel 6-class) without active cooling. This is the **minimum viable duration** before R11's thermal throttling mitigation (duty-cycle reduction) must engage. The system is not required to avoid throttling indefinitely—only to (a) sustain long enough for practical use and (b) detect and surface throttling when it occurs (E17b, D27). | Phase 3; validated by T-long-run |
| **Warn threshold** (D23) | estimated duration **> 30 min** → explicit confirm | Phase 4 |
| **Refuse threshold** (D23) | estimated duration **> 24 h**, or quota insufficient → refuse with an override | Phase 4 |

### 13.2 Benchmark denominator — the contract

Every throughput number in this repo MUST state all of these, or it is not a measurement:

| Parameter | Reference value |
|---|---|
| **Unit** | **User-visible file bytes per second.** Not wire bytes. With compression these differ 3–10×. |
| Sender | 1080p display, 50%+ brightness, DC-balanced frames |
| Receiver | Mid-range Android (Pixel-6-class), rear camera |
| Distance | 30 cm (laptop→phone), 15 cm (phone→phone) |
| Mounting | Tripod for budget figures; handheld reported separately, never mixed |
| Lighting | ~300 lux, no direct glare |
| File | 1 MB of random bytes (incompressible) unless stated |
| Duration | ≥ 60 s sustained; startup excluded |
| Trials | ≥ 5; report median and p99, never the best run |

**§15's comparison table mixes measurement regimes** — PixNet's 12 Mb/s used a 30" LCD and
a 24 MP DSLR. Such figures MUST be labelled with their regime and never compared directly
to handheld numbers.

---

## 14. Testing strategy and quality gates

### 14.1 Tiers

| Tier | What | Runs |
|---|---|---|
| **T-unit** | Codec internals, header parse, CRC, bitmap, repair-code round-trip | Every commit |
| **T-property** | Random files × random loss patterns → byte-exact; overhead within simulation bounds | Every commit |
| **T-stub-camera** | `getUserMedia` stubbed with `canvas.captureStream(0)` + `requestFrame()`. No flags, frame-exact, deterministic | Every commit |
| **T-degradation** | Synthetic blur / rotation / keystone / glare / rolling-shutter tearing applied to rendered frames. **Assert decode *rates*, not booleans** | Nightly |
| **T-real-capture** | Frames → Y4M → Chromium fake camera. Proven in research (byte-exact, including late-join at 700 ms) | Nightly |
| **T-scale** | Synthetic 4 GB stream at the block layer; assert flat memory across 21,800 blocks | Nightly |
| **T-long-run** | **20–30 minute sustained run** on real devices to validate thermal behavior (R11), duty-cycle economics (D27), and sustained throughput. Tracks fps decline, decode rate, and effective goodput over time. **This is the ONLY tier that can measure R11 and D27** — the 60 s floor in §13.2 structurally excludes thermal phenomena. | Weekly (or per thermal-related change) |
| **T-physical-rig** | Two real devices, fixed mounting, the §13.2 denominator. **This is the acceptance gate for §13.1 throughput** — nothing else can measure it | Per release |
| **T-manual-iOS** | Full pass on a real iPhone. **Not CI-testable at any price** — WebKit cannot fake a camera, the Simulator has none | Per release |

> **Trap, already paid for:** `--use-fake-device-for-media-capture` **does not exist**. It
> is `--use-fake-device-for-media-stream`, and the file flag requires it.

### 14.2 Binary-safety testing

**MUST use real compressed payloads at several lengths — never ASCII.** Corruption in the
rejected libraries was both *content*- and *length*-dependent: the same generator
round-tripped at 600 bytes and corrupted at 256. An ASCII suite marks every library safe,
including the broken ones. The nastiest case, `@zxing/library.getText()`, returns the
**correct length** while collapsing bytes ≥ 0x80 to U+FFFD — a length assertion passes and
the file is silently ruined. Assert on bytes, at multiple lengths, over 0x00–0xFF.

### 14.3 Conformance vectors

Ship as fixtures, because they are what a third-party implementation would need:

- `(streamId, blockIndex, seq) → index set` — bit-exact, pinning the PRNG (I3)
- Header encode/decode round-trip at every field boundary
- Beacon encode/decode including absent optional fields
- Repair-code round-trip, including a deliberately mistyped code
- A **two-realm test**: the same built app in two contexts, one sending, one receiving —
  the only test that actually verifies the "both roles, one page" constraint

### 14.4 The no-network assertion

CI MUST fail the build if the running app issues **any** network request after load —
including the lazy WASM fetch described in §6.5, which is the most likely violation and
does not occur until the first decode, so **the assertion must exercise a decode**
(intercept `fetch`/`XHR`/`WebSocket`/`EventSource`/`Image`; fail on any call). This is the
executable form of T7 and of concept.md constraint 1.

### 14.5 Quality gates

| Gate | Requirement |
|---|---|
| **G1** | Typecheck, lint, unit, property, stub-camera all green |
| **G2** | No network requests (§14.4) |
| **G3** | Bundle-size budget not exceeded; dependencies pinned to exact versions, no post-install scripts (T5) |
| **G4** | Simulation assertions for D5/D6/D25 pass (I2), **at the adopted K** |
| **G5** | Memory budget (I6a) holds on T-scale. **Runs nightly**, so it gates the nightly build, not each commit — see the cadence note below |
| **G6** | Throughput budgets (§13.1) hold on T-physical-rig — release only |
| **G7** | `python3 docs/research/sim/ge_cost_model.py --check` passes — **the plan's §3.1/§4 numbers match what the model computes**. This exists because every critical defect found in review was a bookkeeping failure attached to correct reasoning; making the numbers executable removes the class |

**All-gates-same-commit:** G1–G4 and **G7** MUST pass on the *same* commit — these are
fast. G5 is nightly and gates the nightly build; G6 is release-only. A green build
assembled from different commits is not a green build.

### 14.6 Definition of done

A phase is done when: its exit criteria (§17) are met; G1–G5 are green on one commit; every
new failure mode has a test; every new error code has a user-facing string; and the plan
is updated if any decision changed.

**Stop-ship criteria** — do not release if: any A-scenario fails; I1–I10 are unenforced;
a data-loss path exists without a test; or the version footer is absent (a user cannot
tell what they are running).

---

## 15. Throughput expectations

*Forecasts from research. The committed numbers are §13.1.*

| Stage | Approach | Expected | Regime |
|---|---|---|---|
| — | Single QR (what most projects do) | 1–9 KB/s | handheld, matches TXQR |
| **1** | **Tiled monochrome QR** | **20–45 KB/s** | tripod, laptop→phone |
| **2** | **+ RGB channel tripling** | **35–90 KB/s** | tripod |
| **3** | **libcimbar-derived codec** | **~106 KB/s** | libcimbar's published figure, monitor→phone. **Its advantage is frame rate, not density** — see below |
| — | Phone-to-phone research SOTA | ~40 KB/s | lab, mounted |
| — | All-time lab record (PixNet) | 12 Mb/s | **30" LCD + 24 MP DSLR — not comparable** |

**Stage 3's rationale — corrected.** An earlier revision of this section claimed *"QR is denser
per pixel than libcimbar"* (0.0794 vs 0.0741 bits/screen px²) and used it to push symbology to
last place. **That comparison was invalid, and in exactly the way AP1 warns about:** the 0.0794
figure is QR v16-L at **3** screen px/module, below this plan's own ≥ 4 camera px/module decode
floor. Compared at a size that actually decodes:

| Scheme | Bits per screen px² (at its decode floor) |
|---|---|
| QR v16-L @ **4** px/module | **0.0447** |
| libcimbar, 6 bits over 9×9 px | **0.0741** |
| *(QR v16-L @ 3 px/module — below the floor, not comparable)* | *0.0794* |

**libcimbar is ~1.66× denser per pixel at a decodable cell size**, and it also sustains ~11
decoded frames/s where the rig managed 2–4. So its advantage is **both** density and frame
rate, and Stage 3 is *more* attractive than the corrected-away version suggested — not less.

What survives from that reasoning: **decode CPU per bit is the metric that matters**, and the
cheap decode-side wins (worker pool, tight ROI, capture resolution, D27) come first because
they are cheap, not because symbology is worthless. **R7 (MPL-2.0 licensing) and §19 Q1 are
therefore NOT de-urgentised** — they gate Phase 7 and Phase 7 is worth reaching.

**The dominant risk is geometry, not software.** Cell size is set by how many *camera
pixels* the sender's screen occupies:

- Laptop → phone at 30 cm: ~1325 px across ≈ 165-cell grid
- **Phone → phone: ~327 px across ≈ 54 cells — one ninth the capacity**

Phone→phone is also bounded by **minimum focus distance**: filling the frame needs ~6.6 cm,
inside the ~10 cm focus limit, so the symbol spans only 50–60% of frame.

---

## 16. Platform and operations

### 16.1 iOS — the binding platform

- **No Web Share Target, ever.** "Share → screenferry" cannot exist on iOS.
- **No File System Access API.** Output must be `navigator.share({files})`, gated on
  `canShare`, fired from a **real touch handler**. iOS ignores programmatic blob-anchor
  clicks. **Multi-GB export via `share()` is untested and likely to fail** (§19 Q9).
- Inbound: `<input type=file>` with **no `accept`** — forces Files, avoids silent
  HEIC→JPEG transcoding.
- **Service-worker cache deleted after 7 days** unless installed to Home Screen (D13).
- **iPhone cannot go fullscreen** (iPad only); standalone display mode substitutes.
- **Wake Lock only in Home Screen web apps, iOS 18.4+.** A `pushState` path change kills a
  live stream — routing MUST NOT touch the path during capture.
- **No `BarcodeDetector`** — and it is structurally unusable everywhere anyway: the spec's
  `DetectedBarcode` has **no byte member**.
- **No image-capture extensions** — no `exposureCompensation`, so D14's fix does not apply.
- **~1 GB storage quota** (§8.4).

### 16.2 Deployment

Static bundle to a static host (Cloudflare Pages or equivalent), built in CI on iad-ci.
No backend, no database, no migration. Rollback is redeploying the previous bundle —
**but see §16.3, which is what makes rollback non-trivial.**

### 16.3 Version skew — the one operations item that genuinely applies

Two devices each hold an independently-cached copy of the app. A static host that updates,
a service worker that caches for offline use, and iOS's 7-day eviction mean **device A can
be running a month-old build while device B loads today's**.

| Rule | |
|---|---|
| **Version fields** | The header's 4-bit nibble is a *fast reject* only; the beacon's 1-byte `wireVersion` is authoritative. The nibble is `wireVersion & 0x0F`, so it **wraps after 16 bumps** — a receiver MUST NOT treat a nibble match as compatibility, only as "worth parsing the beacon". |
| **Wire compatibility** | The beacon's `wireVersion` gates the wire format. A receiver seeing an unknown version MUST report `E-VERSION` with both versions shown and refuse — **never attempt a partial parse**. |
| **What is breaking** | Any change to header layout, beacon layout, PRNG, degree distribution, or fragment semantics. Bump `magic_ver`. |
| **What is not** | UI, coaching, profile ladder tuning, dwell, new *optional* beacon fields appended at the end. |
| **Stage coexistence** | Stage 1/2/3 modulations are distinguished by the beacon's `flags`, not by `magic_ver` — a Stage-1-only receiver MUST ignore colour tiles rather than fail. |
| **Rollback consequence** | Rolling the sender back may strand receivers holding a newer cached build. So a wire-version bump is a **one-way door** and MUST be treated as such: ship it only when the previous version has been deployed long enough to be widely cached — **minimum 30 days**, since iOS evicts uninstalled caches at 7 days and D13-installed apps may lag far longer. |
| **Update UX** | The service worker SHOULD prompt for update rather than swapping silently mid-transfer. Swapping during a 10-hour transfer would be fatal. |

### 16.4 Health check

One pre-flight, run before the user commits, combining what is currently scattered across
three beads: storage estimate (`bf-4d6`), camera capability and measured fps (D14), wake
lock availability, OPFS write test, and the calibration probe (D11). It refuses or warns
**as one gate** with numeric thresholds (§13.1) rather than as three separate surprises.

---

## 17. Phases

Each phase has **entry criteria** (what must be green before starting) and **exit
criteria** (testable). Phases 1–3 are the critical path; the parallel track can proceed
independently once Phase 0 lands.

| Phase | Entry | Exit |
|---|---|---|
| **0 — Repo and harness** ⚠️ *partial* | — | Builds, deploys, version footer present, stub-camera tier runs, G1–G3 and **G7** green, **module layout (§6.5) and dependency pins committed**, and a throwaway end-to-end spike (one tiny file through a no-op modulation) proves the seams line up |
| **0.5 — Spike** ⚠️ *partial* | Phase 0 exit | S1–S4 run and recorded in `docs/notes/spike-results.md`; §13.1's forecast rows replaced with measured figures or the relevant §18 risk triggered. **Gates Phase 1 because it sets K, L, dwell and the rung ladder.** See `spike/README.md` |
| **1 — Core codec, headless** ⚠️ *built, gates unmet* | Phase 0.5 exit | 10 MB file survives 50% loss byte-exact; overhead within `sim/` bounds; synthetic 4 GB at flat ≤ 1 MB (A5 / I6a); GE keeps pace at K=768 measured on a real phone; G1–G5 green |
| **2 — Single-QR optical loop — the walking skeleton** | Phase 1 exit | **A1-lite passes** (byte-exactness on two real devices, no throughput floor). **This is the first demonstrable end-to-end transfer**; Phase 0's spike is a seam check, not a product |
| **3 — Tiling + fixed-weight ladder (D18a)** | Phase 2 exit | A1 ≥ 20 KB/s, A2, A3, A4 pass on T-physical-rig; G6 green |
| **4 — Large-file machinery** | Phase 3 exit | A5, A6, A7, A10 pass; quota pre-flight refuses correctly; repair code round-trips |
| **5 — The app + local ladder adaptation (D18b)** | Phase 4 exit | A8, A9 pass; every §11 error code has a user-facing string and is reachable; iOS manual pass; non-technical user completes a transfer unaided |
| **6 — Calibration probe + colour** | Phase 5 exit | Probe reports device cutoffs; colour enabled only where it measurably wins; A1 improves or colour stays off |
| **7 — Custom codec** | Phase 6 exit **and** the §19 Q1 licensing decision recorded | Stage 3 beats Stage 2 on T-physical-rig |

### 17.2 Where the phases actually stand — and the gates that were skipped

Recorded honestly, because a gate that reads green and is not is how Phase 3 inherits Phase 0's
debt (PIVOT-CAUSES PH-2).

| Phase | Claimed | Reality |
|---|---|---|
| 0 | partial | **Exit criteria NOT met.** `npm run build` fails (no `index.html`, no `src/app.ts`); no version footer (`bf-13h` open); no stub-camera tier; **no lint config**, so G1 cannot pass; G2 (no-network assertion) and G3 (bundle budget, SRI) unimplemented. **G7 is green.** `npm run gate` currently runs typecheck + tests + G7 — a subset of G1 plus G7. |
| 0.5 | partial | S1, S2, S3 and the thermal observation done. **Outstanding:** phone→phone (R4), rung sweep, a distance sweep under §13.2 conditions, an on-device GE run, and the long-run thermal profile. Its exit criterion — "§13.1's forecast rows replaced with measured figures" — is now met for three rows (§13.1). |
| 1 | built, **exit criteria NOT met** | `src/core/` has framing, PRNG, LT encode, GE decode, block layer; 22 tests green. **Unmet:** G1–G3 (inherited from Phase 0); the A5 memory assertion is a smoke test, not I6a; the **on-device GE run** required by "GE keeps pace at K=768 measured on a real phone" has not happened. **Not yet written** (listed in §6.5): `frame/beacon.ts`, `frame/repair-code.ts`, `hash/block-hash.ts`, `hash/stream-id.ts`, `block/schedule.ts`. **I3's golden vector `test/fixtures/vectors.json` does not exist** (AP10 is live, not paid-for). Entered on a partial 0.5, so K, L, dwell and the rung ladder shipped at their modelled values. |

**Gate defects to close before Phase 2:**

0. **The `zxing-wasm` CDN default (§6.5) must be overridden and the `.wasm` precached** — as
   shipped it would make a network request mid-session and fail offline entirely.

1. **Phase 0's harness must be built or §17 amended.** Do not leave the discrepancy implicit.
2. **The on-device GE benchmark has not run**, and D26/T1 both cite a "locally benchmarked max" that no component produces (§16.4 owns it).
3. **The A5 memory assertion is a smoke test, not the invariant.** `test/codec.test.ts` checks a
   heap *trend* with 64 MB of slack across 40 blocks (7.9 MB), which cannot detect a 40 MB
   working set and does not approach I6a's ≤ 1 MB over 21,800 blocks.

**Process gap this exposes.** `spike-results.md` ended with a section titled "Plan changes this
justifies" listing five; none was applied until a review caught it. §14.6 requires the plan be
updated "if any decision changed" — but a **measurement** is not a **decision**, so nothing
triggered. **Rule: any spike or hardware measurement MUST be folded into §13.1, §18 and the
revision history in the same commit that records it.** Owner: whoever runs the measurement.

### 17.1 Phase 0.5 — why a spike, and why here

The plan's parameters are currently modelled or borrowed from research on other
people's hardware. The spike does not decide **whether** to build the codec — the
fountain code, block layer and framing are needed whatever the channel does. It
decides **what numbers to build it with**, and those numbers are encoded in the
framing layer that Phase 1 writes:

| Parameter | Basis today | Sets |
|---|---|---|
| Tiling gain (~10×) | measured on *simulated* camera paths | D1, the throughput thesis |
| Erasure 20–30% | **assumption** (D18c states this) | dwell = 1.6 K (§8.1) |
| 4 px/module cliff | other devices | D2, §3.1.1's rungs, `bf-1g0` |
| Delivered fps | a Pixel 6, not ours | D9, D14 |
| 200 MB/s JS XOR | ~~unmeasured guess~~ **measured: 3,260 MB/s desktop (S1)** | D19's K = 768 |

It is cheap *precisely because* it skips everything this plan carefully designs: no
fountain code, no blocks, no compression, no resume, no OPFS, no UI. Sequential
numbered packets and a counter suffice — the subject is the channel, not the protocol.

**S1 is already done** (`spike/ge-bench.mjs`, no camera or install needed). A full
GE decode of one block at K = 768 takes **8 ms** at **3,260 MB/s** on the dev
machine — the 200 MB/s budget was ~16× pessimistic, leaving **7.1× margin at
Stage 3** even after a harsh ÷4 phone factor. **R1 is provisionally closed**, pending
a re-run in a browser on the target phone; the ÷4 factor is itself a guess.

S2–S4 (rung sweep, distance sweep, handheld and phone→phone) need the optical rig and
two devices. Kill criteria are fixed in advance in `spike/README.md`, each mapping to
an existing §18 risk — if a criterion trips, the named risk's fallback applies rather
than an improvised one.

**Do not let spike code become product code.** Separate directory, separate
`package.json`, deleted once the results land.

**Parallel track** (independent of the codec, may run alongside Phases 1–3): PWA shell,
service worker, file in/out per platform, pairing splash (`bf-4tb`), version footer
(`bf-13h`), photosensitivity work (`bf-6d3`). **Sync point:** must merge before Phase 5.

**Scope estimate.** Fountain + GE ≈ 300 lines (corroborated by research). Block layer,
framing, session ≈ 800. Modulation Stage 1 ≈ 600. Receiver pipeline ≈ 700. App shell, UI,
coaching ≈ 1500 — **Phase 5 is the largest single phase**, which the phase ordering hides.

---

## 18. Risk register

| # | Risk | Likelihood | Impact | Mitigation | Trigger → fallback |
|---|---|---|---|---|---|
| **R1** | **GE still too slow at K=768 on real phones** | ~~Medium~~ **Low** | High — blocks Phase 1 | Cost model + conservative K (D19/D26). **S1 measured 3,260 MB/s desktop = 7.1× margin at Stage 3 after a ÷4 phone factor; provisionally closed pending an on-device re-run** | Measured need > budget → drop to K=512 (2.88× margin), then re-open D5 against wirehair/RaptorQ (whose linear-time decode is what libcimbar uses) |
| **R2** | **4 camera px/module cliff makes handheld use impractical** | Medium | High | **Sender shapes the code region to the receiver's portrait aspect by default (§6.3.2) — clears the cliff without any user action.** Aim reticle + coach (`bf-1g0`), ladder (D16) as secondary aids | A2 fails → mandate a stand in the UI and reposition as a mounted-device tool |
| **R3** | **Stage 1 measures far below 20 KB/s** | Medium | High — undermines the multi-GB objective | Tiling (D1) is the measured 10× | < 10 KB/s → cap the advertised file size, move Stage 2 earlier |
| **R4** | **Phone→phone unusable at 54 cells** | **High** | Medium | Separate profile with bigger modules | A3 fails → document phone→phone as a small-file-only mode |
| **R5** | **iOS cannot export multi-GB** | **High** | Medium | Detect and cap up front | `share()` fails > 1 GB → iOS is receive-capped, stated at file selection |
| **R6** | **OPFS quota smaller than advertised** | Medium | Medium | Pre-flight (`bf-4d6`) + graceful stop (E10) | Repeated E-QUOTA-EXHAUSTED → lower the refuse threshold |
| **R7** | **libcimbar MPL-2.0 contaminates the licence** | Low | Medium | Decide before Phase 7 (§19 Q1) | Cannot accept mixed licence → clean-room Stage 3 or stop at Stage 2 |
| **R8** | **No way to learn real-world performance** (no telemetry by design) | **High** | Low | Accepted; T-physical-rig substitutes | If field failures are suspected → voluntary copyable benchmark string (ledger, currently cut) |
| **R9** | **Multi-hour transfers die to backgrounding / sleep / thermal** | **High** | Medium | E8, E17, wake lock, resume (D22) | Resume proves insufficient → reduce block size further so less is lost |
| **R10** | **A wire-version bump strands cached receivers** | Medium | Medium | §16.3 one-way-door rule | Skew observed → extend the soak period before bumping |
| **R12** | **Residual erasure exceeds the assumed 20–30% band** | **High** — measured 48% (non-qualifying conditions) | **High** — D18c, the §8.1 dwell budget and every §13.1 throughput figure rest on this band | Raise dwell; promote the repair code (§8.2). Note v1 cannot *observe* erasure (D18a), so this is an assumption, not a controlled quantity | Erasure > 35% under §13.2 conditions → the **repair code becomes the primary recovery path, not the tail**, and dwell is re-derived from the measured band |
| **R11** | **Thermal throttling makes long transfers self-defeating** | **High** (observed first session) | **High** — attacks the multi-GB objective directly | Duty-cycling (D27), decode-resolution drop, resume (D22). Self-reinforcing loop: SoC slows → decode slower → camera fps falls → erasure rises → transfer lengthens → more heat | Sustained fps decline > 30% from a cool start → drop duty cycle and **tell the user**, rather than silently running hot and slow. If duty-cycling cannot hold the rate, reframe multi-GB as a multi-session workflow (§1.1) |

---

## 18.1 Anti-patterns — mistakes this project has already made

Every entry below was made *in this repo* and cost real time. They are collected here because
each was previously buried in the narrative of the section that fixed it, where an implementer
starting a later phase would never encounter it.

| # | Anti-pattern | What it looked like | Guard |
|---|---|---|---|
| **AP1** | **A unit-free "px/module"** | Every optical run sat at 2.25 camera px/module while the config said "4". Presented as a symbology limit; was a sampling limit. | §2 defines screen px and camera px. Never write "px/module" unqualified. |
| **AP2** | **The ROI ratchet** | A frame where only two tiles decoded shrank the crop to those two; every later frame then saw only that region and could never recover. Erasure 91%, goodput **worse than no cropping**, and it presents as an *optical* fault. | Wide margin (≥35%) **plus a forced full-frame rescan every N frames**. An ROI that can only shrink is a bug. |
| **AP3** | **Sizing K from GE's memory term** | K = 16,384 gave a 32 MB matrix (fine) and needed 4.5 GB/s of XOR (23× over). | K is bound by *time*, not memory (§3.1). Faster wire rate makes decode **harder**. |
| **AP4** | **Setting L from the nominal ladder rung** | L = 507 made the conservative rung carry **zero** packets, destroying the ladder's only guarantee. | L is set by the **smallest** rung (§3.1.1); `params.ts` throws at import if a rung cannot hold a whole packet. |
| **AP5** | **Running the sender faster than D9 allows** | 2.8× over the half-camera-fps rule → 78% erasure. Looked like poor optics. | D9 is a constraint to satisfy, not a dial to maximise. |
| **AP6** | **Narrowing the erasure band instead of raising dwell** | Contradicted the evidence base and cost throughput for no arithmetic reason. | Raise dwell; the band is an assumption about the channel (D18c), not a target. |
| **AP7** | **Trusting `getSettings()` / requested capture** | Reports 30/60 fps while delivering 15; defaults to 1080 on the *short* edge. | Measure delivered fps and actual capture dimensions (D14, §6.4). |
| **AP8** | **`--use-fake-device-for-media-capture`** | Does not exist. It is `--use-fake-device-for-media-**stream**`. | §14.1. |
| **AP9** | **Never offering a torch button** | 3.6× fps gain makes it tempting; an LED on glossy glass destroys a region of the frame. | §6.4. |
| **AP10** | **Writing a comment that asserts a file exists** | `prng.ts` claimed `test/fixtures/vectors.json` pinned the wire format. It did not exist. | Generate the artifact in the same commit as the claim (§14.3). |

## 18.2 Proof obligations

Each load-bearing assumption, what must be true, and what would invalidate it. This exists
because the project has a documented history of confident-and-wrong (AP1, AP3, AP4, plus a
2× formula error), and G7 only makes *one* class of claim executable.

| Assumption | Holds iff | Invalidating evidence | Fallback |
|---|---|---|---|
| D19's K = 768 | phone GE ≥ 114.6 MB/s sustained **while thermally throttled** | on-device benchmark under load | K → 512 (2.88× margin), then re-open D5 vs wirehair (R1) |
| S1's ÷4 phone factor | desktop-to-phone JS gap ≤ 4× | on-device `ge-bench.mjs` | recompute K from the measured figure |
| D18c's 20–30% erasure | erasure under §13.2 conditions stays ≤ 30% | measured 48% (non-qualifying conditions) | repair code (§8.2) becomes the primary path, not the tail (R12) |
| The 4 camera px/module cliff | zxing needs ≥ 4 camera px/module under handheld blur | S3 distance sweep under §13.2 conditions | re-derive the rung ladder from the measured cliff |
| D1's ~10× tiling gain | holds on hardware, not just simulated camera paths | rung sweep on the rig | drop to fewer, larger tiles |
| D27's duty-cycle economics | 50% duty ≈ 50% heat and completes | long-run thermal profile | multi-session framing (§1.1), or cap the supported file size |
| Stage 3's value | decode CPU/bit beats QR's | prototype against a worker-pool QR baseline | stay at Stage 2 |

## 19. Open questions

1. **Licensing — decide before Phase 7, consciously.** libcimbar is **MPL-2.0**
   (file-level copyleft); screenferry is MIT. Porting is legal but makes the repo
   mixed-license and obliges per-file marking. The failure mode is someone pasting in a
   function and deciding this by accident. → [`prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md)
2. **Optimal K and block size on real hardware.** §3.1 is a model, not a measurement.
   Resolve in Phase 1 (R1).
3. **Phone→phone viability** at 54 cells. Resolve in Phase 3 (R4).
4. **Progress UX with no back-channel.** The sender cannot know receiver progress. Over a
   10-hour transfer this matters far more than over 30 seconds. **Resolve in Phase 5.**
5. **Should the sender ever stop?** It loops forever; at GB scale "forever" may be days.
   **Resolve in Phase 5.**
6. **Delta transfer vs fixed blocks** — see §20.2. **Resolve before Phase 4 implementation.**
7. **Closed-loop negotiation — deferred on evidence.** Bidirectional links are precedented
   (MAMBA: two phones, 11–28 kbps each way), but MAMBA's measured gain from closing the
   loop is only **5–20%**, while changing the coding paradigm buys multiples. Reassess
   after Phase 4. → [`link-adaptation-design.md`](../notes/link-adaptation-design.md)
8. **SoftLight-style soft hints — the highest-ceiling idea we are not doing.** Per-bit
   confidence plus a false-positive-tolerant rateless code: **2.2× with fixed parameters**.
   Blocked on zxing returning hard bytes; natural fit for Stage 3.
9. **Multi-GB export on iOS** (R5). Detect up front, never at hour 9.
10. **Encryption.** Out of scope for v1 (T6), but the optical channel is uniquely exposed
    to filming. Revisit once transport is real.

---

## 20. Adopted roadmap items

From [`ideas-ledger.md`](../notes/ideas-ledger.md) (103 generated → 10 finalists → 7
adopted). Tracked as beads blocking genesis `bf-28p`.

| Bead | Item | Grade | Phase |
|---|---|---|---|
| `bf-4d6` | Storage pre-flight and capacity gate | S | 4 |
| `bf-5vm` | Diagnostic stall detector | M | 5 |
| `bf-1g0` | Aim reticle and distance coach | M | 5 |
| `bf-6d3` | Photosensitivity safeguard (WCAG 2.3.1) | S | 5 |
| `bf-280` | Delta transfer and cross-session resume | L | 4+ |
| `bf-4tb` | Pairing splash QR | S | 5 |
| `bf-13h` | Verifiable build + version footer | M | 0 |

**Rejected:** *text/secret fast path* (a different product inside this one) and
*single-file HTML build* (deploying as a static site, and WASM is required — exactly what
single-file cannot cleanly inline). The PWA offline story is unaffected.

### 20.1 Photosensitivity changes a rendering decision (`bf-6d3`)

WCAG 2.3.1 caps general flashes at three per second **or** requires the flashing area to
stay under the small-safe threshold. A full-bleed high-contrast animation at 12–15 fps for
hours is a genuine seizure risk.

**The mitigation costs the core metric.** Bounding flash area reduces usable screen area →
fewer cells → less throughput. The compliant design is therefore **a bounded coded region
inside a static surround**, not full-bleed, and the area cost MUST be measured in Phase 3
rather than assumed. D10's DC balancing is part of this mitigation, not just an
auto-exposure fix: constant mean luminance is far less provocative than alternating fields.

### 20.2 Delta transfer tensions with the block design (`bf-280`)

**A partially-received file *is* "a file the receiver already has"** — so
resume-after-interruption and delta transfer are one mechanism at two granularities.

But general delta wants **content-defined chunking** (rolling hash, variable boundaries),
which contradicts I1 (L fixed) and D19 (fixed blocks, K derived). Two ways out:

1. **Scope delta as a v2 mode with its own block scheme** — cleanest; the fixed-block path
   stays untouched.
2. **Keep fixed blocks and diff at block granularity** — no rolling hash, but only detects
   changes aligned to 192 KB boundaries, so an insertion near the start re-sends
   everything after it.

Option 2 is dramatically cheaper and probably sufficient for the air-gapped-update case,
where changes are usually appends or whole-component replacements. **Start there.** The
near-term half — robust cross-session resume — has no such tension and ships first.

---

## 21. Evidence index

| Document | Carries |
|---|---|
| [`qr-encoding-capacity.md`](../research/qr-encoding-capacity.md) | Capacity tables (verified 3 ways, 160 combos), mask pinning, EC level, camera limits |
| [`browser-qr-scanning.md`](../research/browser-qr-scanning.md) | Decoder comparison, **binary safety**, capture pipeline, decode rates |
| [`fountain-codes-and-protocol.md`](../research/fountain-codes-and-protocol.md) | Coding scheme, BC-UR/BBQr prior art, header design, **the K ceiling §3.1 was measured against** |
| [`sim/fountain_overhead_sim.py`](../research/sim/fountain_overhead_sim.py) | Independent verification of D5/D6 |
| [`sim/ge_cost_model.py`](../research/sim/ge_cost_model.py) | **D19's K, re-derived against decode time** |
| [`sim/degree_cap_sim.py`](../research/sim/degree_cap_sim.py) | **D25's degree cap, verified per D6** |
| [`spike/README.md`](../../spike/README.md) | Phase 0.5 protocol and pre-registered kill criteria. **Slated for deletion once results land — the results themselves live in `spike-results.md`, which is the durable reference** |
| [`beyond-qr-optical-channels.md`](../research/beyond-qr-optical-channels.md) | Tiling, colour tripling, screen-camera SOTA, JAB Code rejection |
| [`custom-codec-engineering.md`](../research/custom-codec-engineering.md) | libcimbar geometry, GPU pipeline, calibration, camera ISP effects |
| [`pwa-platform-and-ux.md`](../research/pwa-platform-and-ux.md) | iOS blockers, file I/O, PWA, testing tiers |
| [`link-adaptation.md`](../research/link-adaptation.md) | Rate-adaptation prior art, bidirectional precedent, OLLA damping |
| [`../notes/spike-results.md`](../notes/spike-results.md) | **The only measured-on-hardware numbers in the repo** — S1 GE throughput, S2 optical loop, S3 density sweep, the thermal finding |
| [`../notes/concept.md`](../notes/concept.md) | The channel's properties and the constraints they force |
| [`../notes/link-adaptation-design.md`](../notes/link-adaptation-design.md) | The three tiers, why probing is free, why negotiation is deferred |
| [`../notes/prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md) | The 106 KB/s verification + licensing |
| [`../notes/ideas-ledger.md`](../notes/ideas-ledger.md) | 103 ideas with kill reasons |
| [`../notes/future-features.md`](../notes/future-features.md) | Considered, deliberately not planned |

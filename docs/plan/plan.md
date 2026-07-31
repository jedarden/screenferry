# screenferry — Application Plan

Single source of truth for what screenferry is, how it is built, and in what
order. Constraints it must satisfy live in [`../notes/concept.md`](../notes/concept.md);
the evidence behind every number here lives in [`../research/`](../research/).

**Status:** research complete (8 threads), plan written, no application code yet.

---

## 1. Objective

> **A static website that accepts a file from the user and turns it into a visual
> transmission on screen, which a second device running the same page receives
> through its camera and reconstructs into the original file.**
>
> **It must handle large files — on the order of multiple gigabytes.**

Everything else follows from those two sentences. Specifically:

- **Static.** No backend. The whole app is files on a CDN, works offline, and can
  be audited once and trusted thereafter. There is nowhere to upload anything *to*.
- **Same page, both roles.** One deployment. The user picks sender or receiver.
- **Screen → camera is the only channel.** Strictly one-way, lossy, low-bandwidth.
- **Multi-gigabyte.** This is the requirement that most shapes the architecture,
  and §2 is about why.

### 1.1 The honest framing of "multiple gigabytes"

Multi-GB support is an **architectural** requirement, not a performance promise.
The design must never *forbid* a large file or fall over on one — no memory
ceiling, no O(n²) blowup, no "reassembling…" spinner that never returns. But the
physics of the channel are what they are:

| File size | Stage 1 (30 KB/s) | Stage 2 (60 KB/s) | Stage 3 (106 KB/s) |
|---|---|---|---|
| 100 MB | 57 min | 28 min | 16 min |
| **1 GB** | **9.7 h** | **4.9 h** | **2.7 h** |
| **10 GB** | **4.0 days** | **2.0 days** | **27.5 h** |
| 100 GB | 40.5 days | 20.2 days | 11.4 days |
| 1 TB | 414 days | 207 days | 117 days |

So: **gigabytes are hours-to-days. Terabytes are months.** The user's instinct that
terabytes are impractical is right, and understated — even 10 GB is a day or more.

This has three design consequences that are as important as any coding decision:

1. **Resume is not optional.** Nobody holds a phone steady for 27 hours. A transfer
   that cannot survive a page reload, a device sleep, or a lunch break is unusable
   at this scale. (D22)
2. **Neither side may ever hold the file in memory.** (D20)
3. **The app must state the estimated time before the user commits**, and must be
   blunt above a threshold. Letting someone start a 40-day transfer without saying
   so is a product failure, not an edge case. (D23)

---

## 2. What multi-gigabyte breaks, and the fix

Three assumptions in the earlier design do not survive contact with a 4 GB file.

### 2.1 The fountain decoder does not scale — this is the big one

D5 chose an LT code with a **Gaussian elimination** decoder, verified at
`docs/research/sim/`. GE costs **O(K²) memory** in the coefficient matrix. That is
excellent at K≈1000 and catastrophic beyond it:

| Payload as one fountain block | K (at L=256 B) | GE matrix |
|---|---|---|
| 1 MB | 4,096 | 2 MB |
| 4 MB | 16,384 | **32 MB** |
| 16 MB | 65,536 | 512 MB |
| **1 GB** | **4,194,304** | **2 TB** |
| **4 GB** | **16,777,216** | **32 TB** |

**Fix — D19: a block layer.** The file is cut into independent blocks of ~4 MB.
Each block gets its own fountain code, its own K (16,384), and its own decode. The
GE matrix is then a fixed **32 MB regardless of file size**, and the receiver's
working set is constant whether the file is 4 MB or 4 TB.

This is not a workaround; it is what every production fountain system does. RFC
6330 (RaptorQ) has exactly this concept — *source blocks* with sub-blocking — for
exactly this reason. libcimbar caps at 33 MB precisely because it did not do it.

### 2.2 Neither side can hold the file in memory

A multi-GB `Uint8Array` is not allocatable in a browser (Chrome's `ArrayBuffer`
ceiling is ~2 GB; Safari's is lower), and even where it is, doing so on a phone
will get the tab killed.

**Fix — D20: stream both ends.** The sender reads with `File.slice()`, one block at
a time, and never materialises the whole file. The receiver writes completed blocks
straight out to OPFS (Origin Private File System) and holds only the block it is
currently decoding. Peak memory on both sides is **one block plus one GE matrix
(~36 MB)**, flat.

### 2.3 The whole-file hash cannot be computed in one pass

`crypto.subtle.digest` has **no streaming API** — it takes one buffer. You cannot
SHA-256 a 4 GB file with it.

**Fix:** per-block hashes carried in the block's own packets (cheap, and they let
each block be verified and written the moment it completes), plus an optional
whole-file hash computed by streaming the reassembled file through an incremental
WASM hasher at the end. Per-block integrity is what protects correctness; the
whole-file hash is belt-and-braces and can be skipped on very large files with the
user's consent.

---

## 3. Decisions, and what forced them

| # | Decision | Rationale | Source |
|---|---|---|---|
| **D19** | **Block layer: independent ~4 MB blocks, each separately fountain-coded (K = 16,384)** | GE is O(K²); one 4 GB fountain block would need a 32 TB matrix. Blocking pins the decoder cost at a flat **32 MB regardless of file size** and makes receiver memory constant. What RFC 6330 calls source blocks, and the thing libcimbar's 33 MB cap exists for want of. | §2.1 |
| **D20** | **Stream both ends; never materialise the file** | Multi-GB `ArrayBuffer` is not allocatable and would get a phone tab killed. `File.slice()` on the sender, OPFS on the receiver. Peak memory ~36 MB, flat. | §2.2 |
| **D21** | **Per-packet header stays 13 bytes: file-level metadata moves to the beacon** | Adding a 3-byte block index would have cost 23% more header. Moving `payloadLen` (and filename, MIME, hash, block count) into the periodic beacon frame pays for it exactly. Payload packets carry only what is needed to *place bytes*. | §5.1 |
| **D22** | **Resume is mandatory, and is a first-class feature** | At 2.7–27 h for 1–10 GB, no transfer survives on user patience alone. Receiver persists its completed-block bitmap; incomplete blocks restart rather than persisting partial GE state (bounded cost, and a badly-damaged block rarely half-completes usefully). | §1.1, §6.3 |
| **D23** | **Show the estimated time before the user commits; warn hard above a threshold** | 1 GB is ~3–10 hours. Starting that silently is a product failure. Estimate from *measured* channel rate once acquired, not from a constant. | §1.1 |
| **D24** | **Frames are generated on demand and discarded; nothing is pre-rendered** | The LT stream is *endless*, so there is no finite frame set to precompute. One pass over 4 GB is ~550,000 frames — **4.2 TB** as `ImageData`. On-demand encoding costs **~65 ms/sec (7% of one core)** at 15 tiles × 15 fps. Because indices derive from a PRNG on `(streamId, blockIndex, seq)`, the sender is **stateless** — frame *N* generates directly without replaying 1…*N*−1, which is what makes resume and repair nearly free. | §4.2.1 |
| D1 | **Ship tiled QR, not single QR** | The single largest un-taken win. 15 × v15 QR codes decode from one 1080p frame in 7.8 ms for ~7.8 KB, vs 2953 B for one v40. ~10× for zero new decoder risk. | `beyond-qr` §10 |
| D2 | **QR v15 @ ECC L, ~15 tiles** | Bounded by the 4 px/module decode cliff, not symbology density. EC level L because the channel is *erasure*-dominated — redundancy belongs in the fountain code, not the symbol. L→H would cost 57% of payload for nothing. | `qr-encoding`, `beyond-qr` §10 |
| D3 | **zxing-wasm as decoder, read `.bytes`** | Reads **multiple** symbols per frame (required by D1) and returns real bytes — verified against all seven candidate libraries with QRs containing every byte value: exact in **100%** of payloads. Also bounded at **9–26 ms** where **jsQR hit 1453 ms** on one noisy frame. Apache-2.0. | `browser-qr-scanning`, `beyond-qr` §10 |
| D4 | **node-qrcode encoder, mask pattern pinned** | Pinning the mask is a **4.6–8× encode speedup** — a bigger lever than library choice — verified safe for our data. 1.53 ms/frame at v40. Worker-safe. | `qr-encoding` |
| D5 | **LT-style fountain + harmonic degree distribution + GF(2) Gaussian elimination decoder** | Independently verified: GE needs **+1.2%** overhead at K=1000 where peeling needs **+180%**. ~300 lines of JS. Beats RaptorQ's 134 KB WASM + patent footnote by ~15 frames. **Scoped per block by D19.** | `fountain-codes`, **`sim/`** |
| D6 | **Harmonic and GE are a coupled pair — never change one alone** | Harmonic + peeling is the worst cell measured and *degrades* as K grows (+90% at K=50 → +180% at K=1000). BC-UR specifies harmonic; peeling is the naive decoder. That pairing fails only on large inputs, pointing away from the cause. | **`sim/`** |
| D7 | **Index sets derived from a PRNG, never transmitted** | Seeded on `(streamId, blockIndex, seq)`. Zero index bytes on the wire. Steals BC-UR's framing while discarding its decoder. | `fountain-codes` |
| D8 | **Compress before blocking, to a staging file** | `CompressionStream` is native and streaming. Compress to OPFS *first*, then cut the compressed stream into fixed blocks — this keeps K constant and everything derivable. Costs temp storage equal to the compressed size; skip entirely on already-compressed input (detect by sampling). | `fountain-codes`, `prior-art-libcimbar` |
| D9 | **Display at ≤ half the *measured* camera frame rate** | PixNet's rule. Faster produces only torn frames — a *reduction* in goodput. "Measured", not "requested": see D14. | `beyond-qr` §10 |
| D10 | **Every frame DC-balanced** (constant mean luminance) | Stops auto-exposure hunting. Throughput swings **2.4×** on the exposure the camera picks. | `custom-codec`, `beyond-qr` |
| D11 | **Runtime calibration probe decides luma-vs-colour, not this document** | Two research threads reached *opposite* conclusions (§4.4). The probe measures the actual device and adapts. | `beyond-qr` §6.6 |
| D12 | **Render dark-on-light, not dual-polarity** | Dual-polarity decoding costs ~50% throughput. OLED ABL means a mostly-white sender loses ~4× brightness — "light" must mean *moderate*, not full white. | `pwa-platform` |
| D13 | **Add to Home Screen is mandatory on iOS** | Safari deletes service-worker caches after 7 days of non-use; Home Screen web apps are exempt. An offline-first tool that silently evaporates is worse than one that never claimed to work offline. | `pwa-platform` |
| D14 | **Set `exposureCompensation: min`; measure delivered fps, never trust `getSettings()`** | **A precondition for D9, not an optimisation.** Android delivers **15 fps regardless of request, while reporting 30/60** — which would cap the sender at 7.5 fps and halve throughput. `exposureCompensation: min` measured **15.0 → 41.6 fps**, shortens exposure, and leaves AE continuous so autofocus keeps working. | `browser-qr-scanning` §1.4 |
| D15 | **Fragment length `L` is fixed for the session — not per profile, not ever** | A packet is defined over K fragments of length L. Change L and K changes, invalidating **every packet already collected**. Profiles may vary tile version, module size, tile count, fps; never L. | `link-adaptation-design` |
| D16 | **Sender mixes a ladder of 2–4 robustness profiles *within every frame*; no negotiation in v1** | Packets are fungible under a rateless code, so the sender never has to *choose*. **Probing is free**: a probe tile that succeeds delivers real payload, unlike WiFi's ~10% probe tax. Mixed *within* a frame so every profile is measured every frame and cannot alias against camera fps. Turns the catastrophic case (mis-guess → **zero**, since 4 px/module is a cliff) into a merely-slow one. | `link-adaptation` |
| D17 | **Session opens at a conservative beacon profile, re-emitted periodically** | WiFi's lowest basic rate. Lets a receiver join late or re-acquire without restarting the sender. Now also carries all file-level metadata (D21). | `link-adaptation-design` |
| D18 | **Damp with LTE OLLA structure: 1:9 up/down asymmetry, ~1 s window, 2 s dwell, immediate hard step-down. Target 20–30% residual erasure — not zero** | Closed-loop density control oscillates; COBRA's optically-derived fast-down/slow-up converges with WiFi's hard-won practice. Profile selection is a **stateless lookup** so there is no state machine to get stuck in. Targeting *zero* erasure means the ladder is too conservative — the fountain code exists to absorb that loss. | `link-adaptation` |

---

## 4. Architecture

### 4.1 Layering

Two structural commitments: **modulation is swappable**, and **the block layer
bounds everything below it**.

```
┌──────────────────────────────────────────────────────────┐
│ UI          role select · progress · file in/out · coach │
├──────────────────────────────────────────────────────────┤
│ Session     metadata · compression · resume · verify     │
├──────────────────────────────────────────────────────────┤
│ Block       file ⇄ ~4 MB blocks · scheduling · bitmap    │  ◄── NEW (D19)
├──────────────────────────────────────────────────────────┤
│ Fountain    LT encode (endless) / GF(2) GE decode        │      per block,
│             K = 16,384 · GE matrix 32 MB · CONSTANT      │      never per file
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

The block layer is what makes the file size irrelevant to everything beneath it.
The fountain layer never sees a file — only a block, always the same size.

```ts
interface Modulation {
  readonly packetsPerFrame: number;     // 1 plain, ~15 tiled, ~45 tripled
  readonly bytesPerPacket: number;
  encodeFrame(packets: Uint8Array[]): ImageData;
  decodeFrame(frame: VideoFrame): Uint8Array[];   // 0..n packets — never throws
}
```

`decodeFrame` returning fewer packets than `packetsPerFrame` is the **normal case**,
not an error path. Nothing above this layer is permitted to care.

### 4.2 Sender pipeline

```
File ──► [sample: compressible?] ──► CompressionStream ──► OPFS staging file
  │            (D8, skip if not)                                 │
  └──────────────── or straight through ────────────────────────┘
                                                                 │
                                      ┌──────────────────────────┘
                                      ▼
                       cut into fixed ~4 MB blocks (D19)
                                      │
                 ┌────────────────────┴─────────────────────┐
                 ▼                                          ▼
        beacon frame (D17/D21)                    for each block, in turn:
        filename · size · blockCount              slice ──► K=16384 fragments
        blockSize · hash · flags                        ──► LT encoder (endless)
        every ~2 s, conservative profile                ──► header ──► tiles
                 │                                          │
                 └──────────────► frame mixer ◄─────────────┘
                                       │
                        ladder of 2–4 profiles per frame (D16)
                                       │
                            DC-balance (D10) ──► canvas
                                       │
                    display at ≤ ½ measured camera fps (D9/D14)
```

The sender **dwells** on each block for a generous packet budget (default ~1.4 × K,
tunable), then advances, and loops the whole file continuously. It never terminates
on its own, because it cannot know when the receiver is done.

#### 4.2.1 Frames are generated on demand — never pre-rendered (D24)

Every arrow in that diagram is a **generator**, not an array. Nothing is
pre-computed and cycled through; each frame is encoded moments before it is
displayed and discarded immediately after.

This is not an optimisation — at this scale it is the only thing that works:

- **There is no finite set of frames to pre-generate.** The LT encoder is rateless.
  It emits an *endless* stream by construction, and "how many frames will this
  transfer need" is not knowable in advance — it depends on how lossy the channel
  turns out to be. A pre-generated list is the wrong shape for the problem.
- **Even one pass would not fit.** A 4 GB file is ~550,000 frames per pass. Held as
  1080p `ImageData`, that is **4.2 TB**; even as compressed PNGs it is ~55 GB. To
  transmit 4 GB.
- **On-demand costs almost nothing.** Measured encode is 1.53 ms/frame at v40 with
  the mask pinned (D4), scaling to **~0.29 ms** for a v15 tile. At 15 tiles × 15 fps
  = 225 tiles/sec, that is **~65 ms/sec — about 7% of one core** — plus ~2.3 ms/sec
  to render. There is no reason to trade 4 TB of storage for 7% of a core.

**The property that makes this clean:** because index sets are derived from a PRNG
seeded on `(streamId, blockIndex, seq)` (D7), the sender is **stateless**. Frame
*N* can be generated directly without having generated 1…*N*−1. That is what makes
resume (D22) and the repair code (§6.2) nearly free — "start from block 4,731" needs
no replay and no stored state, just a different cursor.

**Implementation shape:**

```
Worker: generator ──► ring buffer (2–3 frames) ──► main thread: rAF paints
        encode next while                          never blocks on encode
        current is displayed
```

A small look-ahead ring buffer absorbs encode jitter so a slow frame never causes a
visible stall; anything deeper is wasted memory. Encoding runs in a Worker (D4
verified node-qrcode is worker-safe) so the render loop is never blocked. The
receiver's pipeline is symmetric — `File.slice()` → block → fragments → packet →
tiles → `ImageData`, with only ~36 MB resident at any moment regardless of file
size.

### 4.3 Receiver pipeline

```
getUserMedia ──► exposureCompensation:min (D14) ──► measure real fps (rVFC, ~1 s)
      │
      └──► requestVideoFrameCallback ──► MediaStreamTrackProcessor
                                                │
                                         ROI crop (9× win)
                                                │
                              ┌─────────────────┴──── Worker pool ────┐
                              ▼                                       ▼
                      zxing readBarcodes                     [Stage 2: split
                      (all symbols, .bytes)                   R/G/B, stretch, ×3]
                              │
                    header parse ──► fcrc ──► streamId lock ──► route by blockIndex
                              │                                        │
                     beacon? ──┴──► learn size/blocks/hash      payload ──► GE decoder
                                    (gates everything)                      for that block
                                                                              │
                                                        rank == K ──► verify block hash
                                                                  ──► write to OPFS
                                                                  ──► mark bitmap, free GE
                                                                              │
                                            all blocks present ──► [decompress] ──► save
```

**Receiver memory is constant:** one 32 MB GE matrix + one 4 MB block + I/O
buffers, regardless of whether the file is 4 MB or 4 TB.

Three receiver rules that are cheap to implement and expensive to omit:

- **Measure fps, never trust it.** Count `requestVideoFrameCallback` invocations
  over ~1 s. `getSettings()` reports 30/60 while the camera delivers 15.
- **Crop to the ROI before decoding — a measured 9× speedup.**
- **Never offer a torch button.** It measured a 3.6× fps gain, which makes it
  tempting, but an LED on a glossy screen creates a specular hotspot that destroys
  a region of the frame. `exposureCompensation` gets the same mechanism, no glare.

### 4.4 The luma-vs-colour disagreement, and how it is resolved

Two research threads measured this and disagreed:

| | `custom-codec-engineering.md` §7.2 | `beyond-qr-optical-channels.md` §6.6 |
|---|---|---|
| Colour cell penalty under 4:2:0 | 2× linear (4× area) — **derived** | 1.25× linear (1.56× area) — **measured** |
| Verdict | luma-only wins ~1.95× | RGB-tripling wins **1.98×** |

The measured result is better-founded and the mechanism convincing: **chroma
decimation is a low-pass filter, not a deletion.** A binary chroma pattern at
5 px/module presents 2.5 chroma samples per module — above Nyquist. At 4 px/module
it presents exactly 2.0, right at Nyquist, which is precisely where the measurement
breaks. The "2× per axis" rule over-corrects by assuming you must restore the
*original* sampling density rather than merely stay above Nyquist in the decimated
grid.

Two further points weigh against luma-only:

- The luma-only case assumed 8 usable luma levels. 8-level luma measured
  **unusable** under handheld blur (21.2% symbol error at 5 px/cell) versus
  **0.00%** for saturated 8-colour at 4 px/cell. If 8-level luma needs 7–8 px/cell,
  the arithmetic inverts.
- **libcimbar spends 2 of its 6 bits per cell on colour**, and its deprecated
  8-colour mode benchmarked *faster* (943 vs 852 kbit/s). A project that measured
  this on real hardware chose colour.

**Resolution (D11): neither document decides.** Ship a calibration probe — luma
checkerboard, chroma checkerboard, and 8-level luma ramp, each at 3/4/5/6/8
px/module — captured at session start. It yields the device's real cutoff pitch
directly, turning a documentation argument into a runtime measurement.

Where the luma-side note is unambiguously right: **AWB warps colour in three
non-monotonic dimensions** and cannot be locked on iOS. A per-frame in-band colour
reference is **not optional** for Stage 2.

---

## 5. Data model

### 5.1 Payload packet header — 13 bytes

Unchanged in size despite gaining a block index, because file-level metadata moved
to the beacon (D21).

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | `magic_ver` | Format magic + version nibble; rejects foreign QR codes instantly |
| 1 | 1 | `flags` | packet type (payload/beacon), reserved |
| 2 | 4 | `streamId` | Identifies the **file**. Seeds the PRNG; locked by the receiver on first sight |
| 6 | 3 | `blockIndex` | Up to 16.7 M blocks × 4 MB = **67 TB addressable** |
| 9 | 3 | `seq` | Packet sequence **within the block**. With `streamId` + `blockIndex`, derives the index set |
| 12 | 1 | `fcrc` | CRC-8 — rejects a mis-decode before it poisons the GE matrix |

`K`, fragment length, and the entire index set remain **derived, never transmitted**.

### 5.2 Beacon frame (D17/D21)

Emitted every ~2 s at the most conservative profile. Everything the receiver needs
before it can interpret any payload packet:

| Field | Notes |
|---|---|
| `streamId` | Must match payload packets |
| `fileSize` | 6 bytes — 281 TB addressable |
| `blockSize`, `blockCount` | Yields per-block K, and the last block's short length |
| `fragmentLen` (L) | Fixed for the session (D15) |
| `flags` | compressed / hash algorithm / colour profile in use |
| `wholeFileHash` | Optional; may be omitted on very large files |
| `filename`, `mimeType` | Length-prefixed UTF-8 |

The receiver shows "acquiring…" until its first beacon. This is also the natural
carrier for a **resume offer** (§6.3).

### 5.3 Session state

```ts
type SendSession = {
  source: File;
  staging: FileSystemFileHandle | null;   // compressed copy, if compressing (D8)
  streamId: number;
  blockSize: number; blockCount: number; fragmentLen: number;  // fixed (D15)
  cursor: { blockIndex: number; seq: number };   // seq resets per block
  dwellPackets: number;                          // default ~1.4 × K
};

type RecvSession = {
  streamId: number | null;        // locked on first valid header
  meta: BeaconMeta | null;        // null until first beacon — gates everything
  complete: Uint8Array;           // block bitmap, 1 bit per block — the resume token
  active: { blockIndex: number; pivots: Map<number, GERow>; rank: number } | null;
  out: FileSystemWritableFileStream;   // OPFS
  stats: { fps: number; pxPerModule: number; packetsPerSec: number; eta: number };
};
```

Only **one** block is `active` at a time. Partial state for a block that the sender
has moved past is **discarded, not persisted** — a badly-damaged block rarely
half-completes usefully, and persisting 32 MB of GE state per incomplete block
would defeat the constant-memory property. The completed-block bitmap is the only
thing that must survive, and it is tiny: 1 GB / 4 MB = 256 blocks = **32 bytes**.

---

## 6. Behaviour at gigabyte scale

### 6.1 Block scheduling with no back-channel

The sender does not know which blocks the receiver has. So:

- It dwells on each block for `dwellPackets` (default ~1.4 × K — enough to survive
  ~29% erasure in one pass), then advances.
- It loops the whole file continuously. A receiver that missed block 47 picks it up
  on the next pass.
- **The cost of a miss is a full extra pass**, which at 1 GB is hours. This is the
  single strongest argument for the repair mechanism below, and it is why the
  back-channel's value *scales with file size* (§8, open question 7).

### 6.2 Human-mediated repair — the cheap back-channel

The receiver knows exactly which blocks it is missing. The user can read that off
one screen and type it into the other. No second camera, no protocol, no geometry
constraints:

> **Receiver:** "Missing 3 blocks. Repair code: `K7F-2M9`"
> **Sender:** [paste code] → transmits only those blocks

The code is a compact encoding of the missing-block set plus the `streamId`. This
turns a multi-hour extra pass into a sub-minute repair, needs nothing but a human
in the room — who is already there, holding the phone — and completely sidesteps
the front-camera/geometry problems that make true negotiation awkward.

### 6.3 Resume (D22)

The receiver persists `{streamId, meta, complete-bitmap}` plus the OPFS output file
after every completed block. On reload it offers to resume. Because the bitmap is
32 bytes per GB, this is nearly free.

The sender is stateless across restarts by construction — it just needs the same
file and the same `streamId` (derived deterministically from file content and size,
so re-selecting the same file reproduces it). Combined with §6.2, a transfer
interrupted at hour 6 of 10 resumes rather than restarts.

### 6.4 Storage limits — a real ceiling on some platforms

The receiver stages the whole file in OPFS before export. That runs into
per-origin quota:

| Platform | Practical quota |
|---|---|
| Chrome / Edge (desktop) | ~60% of free disk — multi-GB fine |
| Firefox | ~10% of disk (capped ~10 GB) |
| **Safari / iOS** | ~1 GB before prompting; expandable but user-gated |

**Consequence:** multi-GB reception is a desktop-Chromium story. iOS is likely
capped around 1 GB. The app must query `navigator.storage.estimate()` up front and
refuse — clearly, before the user starts — rather than failing at hour 9. If
compression is on (D8), staging needs the compressed size *plus* the output.

---

## 7. Throughput and platform reality

| Stage | Approach | Expected | Basis |
|---|---|---|---|
| — | Single QR (naive; what most projects do) | 1–9 KB/s | matches TXQR's measured numbers |
| **1** | **Tiled monochrome QR** | **20–45 KB/s** | measured, stock decoder |
| **2** | **+ RGB channel tripling** | **35–90 KB/s** | measured 1.98× at 4:2:0 |
| **3** | **libcimbar-derived grid codec** | **~106 KB/s** | libcimbar's published, verified figure |
| — | Phone-to-phone research SOTA | ~40 KB/s | SoftLight, TETRIS, S2SVLC — a decade flat |
| — | All-time lab record | 12 Mb/s | PixNet — 30" LCD + 24 MP DSLR; not a sustained link |

**The dominant risk is geometry, not software.** Cell size is set by how many
*camera pixels* the sender's screen occupies:

- Laptop → phone at 30 cm: ~1325 px across ≈ 165-cell grid
- **Phone → phone: ~327 px across ≈ 54 cells — one ninth the capacity**

Phone→phone is also bounded by **minimum focus distance**, not resolution: filling
the frame needs ~6.6 cm, inside the ~10 cm focus limit, so the symbol spans only
50–60% of frame. At gigabyte scale this is the difference between 3 hours and a
day, so the UI must treat it as a first-class case.

### 7.1 iOS — the binding platform

- **No Web Share Target, ever.** "Share → screenferry" cannot exist on iOS.
- **No File System Access API.** Output must be `navigator.share({files})`, gated on
  `canShare`, fired from a **real touch handler**. iOS silently ignores programmatic
  blob-anchor clicks. **At multi-GB this is a hard problem** — see open question 9.
- Inbound: `<input type=file>` with **no `accept`** — forces Files, avoids silent
  HEIC→JPEG transcoding.
- **Service-worker cache deleted after 7 days** unless installed to Home Screen (D13).
- **iPhone cannot go fullscreen** (iPad only) — standalone display mode substitutes.
- **Wake Lock only in Home Screen web apps, iOS 18.4+.** A `pushState` path change
  kills a live stream, so routing must not touch the path during capture. **Over a
  multi-hour transfer, wake lock is essential, not cosmetic.**
- **No `BarcodeDetector` on iOS** — and it is structurally unusable everywhere
  anyway: the spec's `DetectedBarcode` has **no byte member**.
- **No image-capture extensions on iOS** — no `exposureCompensation`, so the D14
  frame-rate fix does not apply. Measure and accept.
- **~1 GB storage quota** (§6.4).

### 7.2 Testing

- **Workhorse tier:** stub `getUserMedia` with `canvas.captureStream(0)` driven by
  `requestFrame()`. No flags, frame-exact, deterministic.
- **Real-capture tier:** frames → Y4M → Chromium fake camera. Proven end-to-end
  during research: byte-exact, **including late-join recovery** (receiver joining
  700 ms late still reassembled 28/28).
- **Trap, already paid for:** `--use-fake-device-for-media-capture` **does not
  exist**. It is `--use-fake-device-for-media-stream`, and the file flag requires it.
- **Scale tier (new):** multi-GB paths must be tested headlessly at the block layer
  with synthetic blocks — never by actually transmitting 4 GB optically. Test that
  memory stays flat across 10,000 blocks, that the bitmap/resume round-trips, and
  that OPFS quota exhaustion is handled.
- **iOS is not CI-testable at any price** — WebKit cannot fake a camera, the
  Simulator has none. Budget a recurring manual device pass permanently.

---

## 8. Phases

### Phase 0 — Repo and harness
Vite + TypeScript, static output. Stub-camera tier. CI on iad-ci.
**Done when:** an empty app builds, deploys, and a synthetic frame round-trips
through a no-op modulation.

### Phase 1 — Core codec, headless
Fountain encoder + **GE decoder**, framing, CRC, **block layer (D19)**, hashing.
No camera, no UI. Property tests: random files through random loss patterns, always
byte-exact. Port `sim/fountain_overhead_sim.py` assertions into the suite so D5/D6
stay verified as the code changes.

**Binary-safety tests must use real compressed payloads at several lengths — never
ASCII.** Corruption in the rejected libraries was both *content*- and
*length*-dependent: the same generator round-tripped at 600 bytes and corrupted at
256. An ASCII suite marks every library safe, including the broken ones. The
nastiest case, `@zxing/library.getText()`, returns the **correct length** while
collapsing bytes ≥ 0x80 to U+FFFD — so a length assertion passes and the file is
silently ruined.

**Done when:** a 10 MB file survives 50% random packet loss byte-exact; measured
overhead matches the simulation within a percent; **and a synthetic 4 GB stream
completes at the block layer with flat memory.**

### Phase 2 — Single-QR optical loop
Simplest possible modulation. Real `getUserMedia`, real render loop, small files only.
**Done when:** a real file moves between two real devices. Slowly. This is the
milestone that proves the thesis.

### Phase 3 — Tiling (D1) and the ladder (D16/D18)
Grid layout, multi-symbol decode, worker pool, DC balancing, profile ladder, OLLA damping.
**Done when:** ≥20 KB/s sustained laptop→phone. Expect the 4 px/module cliff to bite.

### Phase 4 — Large-file machinery
Streaming I/O (D20), OPFS staging, quota checks, resume (D22), the repair code
(§6.2), time estimation and warnings (D23).
**Done when:** a 1 GB transfer completes, survives a deliberate mid-transfer reload,
and a deliberately corrupted run is fixed by a repair code rather than a full pass.

### Phase 5 — The app
PWA, service worker, offline, file in/out per platform, wake lock, coaching UI
(live px/module, "move closer / hold still"), progress model with no back-channel.
iOS device pass.
**Done when:** a non-technical user completes a transfer without being told how.

### Phase 6 — Calibration probe + colour (D11, Stage 2)
Ship the probe first, let it settle luma-vs-colour on real devices; then RGB
tripling with a per-frame in-band colour reference.

### Phase 7 — Custom codec (Stage 3)
Only after Stages 1–2 are solid, and only after the licensing decision below.

---

## 9. Open questions

1. **Licensing — decide before Phase 7, and consciously.** libcimbar is **MPL-2.0**
   (file-level copyleft); screenferry's README says MIT. Porting is legal but makes
   the repo mixed-license and obliges per-file marking. The failure mode is someone
   pasting in a function and deciding this by accident.
   See [`../notes/prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md).
2. **Phone→phone at 54 cells** — is Stage 1 viable there, or does it need its own
   profile? At GB scale this decides hours vs days. Measure in Phase 3.
3. **GE decode cost per block on a real phone.** K=16,384 is 16× the simulated
   K=1000, and GE is O(K³) in bit ops. Needs measuring in Phase 1 — if it bites, the
   fix is a smaller block, not switching to peeling (D6).
4. **Optimal block size.** 4 MB is chosen for a 32 MB GE matrix, but smaller blocks
   mean faster recovery from a miss and lower memory, at the cost of more per-block
   overhead. Tune with real numbers in Phase 4.
5. **Progress UX with no back-channel.** The sender cannot know receiver progress.
   Over a 10-hour transfer this matters much more than over a 30-second one.
6. **Should the sender ever stop?** It currently loops forever. At GB scale "forever"
   might be days — so the stopping heuristic is now a real question, not a nicety.
7. **Closed-loop negotiation — deferred, but the calculus has shifted.** MAMBA's
   measured gain from closing the loop is only **5–20%** at small scale, which is why
   it was deferred. **At gigabyte scale the calculus changes**: a back-channel that
   says "I am still missing blocks 47, 892, 1003" saves an entire extra pass —
   *hours*. Before building it, note that §6.2's human-mediated repair code captures
   most of that benefit for none of the cost. Reassess after Phase 4.
8. **SoftLight-style soft hints — the highest-ceiling idea we are not doing.**
   Per-bit confidence against an in-band reference plus a false-positive-tolerant
   rateless code: **2.2× over RDCode with fixed parameters**. A coding-paradigm
   change, which is where multiples live. Blocked on zxing returning hard bytes;
   natural fit for Stage 3 where we control the demodulator.
9. **Multi-GB export on iOS.** `navigator.share({files})` with a 4 GB blob from OPFS
   is untested and likely to fail. If it does, iOS may be receive-capped at ~1 GB
   (§6.4) — which should be *detected and stated up front*, not discovered at hour 9.
10. **Encryption.** Out of scope for v1 per the concept note, but the optical channel
    is uniquely exposed to being *filmed*. Revisit once transport is real.

---

## 10. Evidence index

| Document | Carries |
|---|---|
| [`qr-encoding-capacity.md`](../research/qr-encoding-capacity.md) | Capacity tables (verified 3 ways, 160 combos), mask pinning, EC level, camera limits |
| [`browser-qr-scanning.md`](../research/browser-qr-scanning.md) | Decoder comparison, **binary safety**, capture pipeline, decode rates |
| [`fountain-codes-and-protocol.md`](../research/fountain-codes-and-protocol.md) | Coding scheme, BC-UR/BBQr prior art, header design |
| [`sim/`](../research/sim/) | **Independent verification of D5/D6** — runnable |
| [`beyond-qr-optical-channels.md`](../research/beyond-qr-optical-channels.md) | Tiling, colour tripling, screen-camera SOTA, JAB Code rejection |
| [`custom-codec-engineering.md`](../research/custom-codec-engineering.md) | libcimbar geometry, GPU pipeline, calibration, camera ISP effects |
| [`pwa-platform-and-ux.md`](../research/pwa-platform-and-ux.md) | iOS blockers, file I/O, PWA, testing tiers |
| [`link-adaptation.md`](../research/link-adaptation.md) | Rate-adaptation prior art, Strata/SoftLight/COBRA/MAMBA, bidirectional precedent, OLLA damping |
| [`../notes/concept.md`](../notes/concept.md) | The channel's properties and the constraints they force |
| [`../notes/link-adaptation-design.md`](../notes/link-adaptation-design.md) | The three tiers, why probing is free, why negotiation is deferred |
| [`../notes/prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md) | Verification of the 106 KB/s claim + licensing |

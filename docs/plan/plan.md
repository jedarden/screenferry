# screenferry — Application Plan

Single source of truth for what screenferry is, how it is built, and in what
order. Constraints it must satisfy live in [`../notes/concept.md`](../notes/concept.md);
the evidence behind every number here lives in [`../research/`](../research/).

**Status:** research complete (six threads), plan written, no application code yet.

---

## 1. What we are building

A static web app that ferries a file from one device to another across the
screen-to-camera gap. Sender displays animated coded frames; receiver films them
and reconstructs the file byte-exactly. Same page, both roles. No server, no
network between the devices, works offline.

### The one-paragraph technical summary

Compress the file, split it into K fragments, and generate an **endless** stream
of fountain-coded packets from those fragments. Pack many packets into each
displayed frame as a **grid of tiled QR codes**. The receiver decodes whatever
subset of tiles it manages to read per camera frame and feeds them to a Gaussian-
elimination fountain decoder, which reconstructs the file once it has collected
any ~K+2% linearly independent packets. Missed frames, torn frames, and partially
decoded frames are all simply *fewer packets this instant* — never an error, never
a retransmission request, because there is no back-channel to request on.

---

## 2. Decisions, and what forced them

| # | Decision | Rationale | Source |
|---|---|---|---|
| D1 | **Ship tiled QR, not single QR** | The single largest un-taken win. 15 × v15 QR codes decode from one 1080p frame in 7.8 ms for ~7.8 KB, vs 2953 B for one v40. ~10× for zero new decoder risk. | `beyond-qr` §10 |
| D2 | **QR v15 @ ECC L, ~15 tiles** | Bounded by the 4 px/module decode cliff, not by symbology density. EC level L because the channel is *erasure*-dominated — redundancy belongs in the fountain code, not the symbol. L→H would cost 57% of payload for nothing. | `qr-encoding`, `beyond-qr` §10 |
| D3 | **zxing-wasm as decoder** | Only credible option that reads **multiple** symbols per frame (required by D1) *and* returns `bytes: Uint8Array` rather than a mangled UTF-8 string. Apache-2.0. 2.0 ms/1080p frame native. | `browser-qr-scanning`, `beyond-qr` §10 |
| D4 | **node-qrcode encoder, mask pattern pinned** | Pinning the mask is a **4.6–8× encode speedup** — a bigger lever than library choice — and was verified safe for our data (uniform best-mask distribution, 8.3% median penalty spread). 1.53 ms/frame at v40. Worker-safe. | `qr-encoding` |
| D5 | **LT-style fountain + harmonic degree distribution + GF(2) Gaussian elimination decoder** | Independently verified: GE needs **+1.2%** overhead at K=1000 where peeling needs **+180%**. ~300 lines of JS. Beats RaptorQ's 134 KB WASM + patent footnote by ~15 frames — not worth it. | `fountain-codes`, **`sim/`** |
| D6 | **Harmonic and GE are a coupled pair — never change one alone** | Harmonic + peeling is the worst cell measured, and *degrades* as files grow (+90% at K=50 → +180% at K=1000). BC-UR specifies harmonic; peeling is the naive decoder. That pairing fails only on large files, pointing away from the cause. | **`sim/`** |
| D7 | **13-byte frame header; K, fragment length and index set all derived, never transmitted** | Indices come from a PRNG seeded on `(seqNum, checksum)` — zero index bytes on the wire. ~1.0% overhead. Steals BC-UR's framing while discarding its decoder. | `fountain-codes` |
| D8 | **Compress before chunking** (`CompressionStream`, native) | libcimbar does the same with zstd. Free bytes on compressible files; detect and skip on already-compressed input. | `fountain-codes`, `prior-art-libcimbar` |
| D9 | **Display at ≤ half the camera frame rate** (12–15 fps vs 30 fps camera) | PixNet's rule. Faster produces only torn frames — a *reduction* in goodput. | `beyond-qr` §10 |
| D10 | **Every frame DC-balanced** (constant mean luminance) | Stops auto-exposure hunting. Throughput swings **2.4×** purely on the exposure the camera picks. Cheap to implement, large measured win. | `custom-codec`, `beyond-qr` |
| D11 | **Runtime calibration probe decides luma-vs-colour, not this document** | Two research threads reached *opposite* conclusions (§3.4 below). The probe measures the actual device and adapts. Better than either answer. | `beyond-qr` §6.6 |
| D12 | **Render dark-on-light, not dual-polarity** | Dual-polarity decoding costs ~50% throughput. OLED ABL also means a mostly-white sender loses ~4× brightness — so "light" must mean a *moderate* background, not full white. | `pwa-platform` |
| D13 | **Add to Home Screen is mandatory on iOS, not a nicety** | Safari deletes service-worker caches after 7 days of non-use; Home Screen web apps are exempt. An offline-first tool that silently evaporates is worse than one that never claimed to work offline. | `pwa-platform` |

---

## 3. Architecture

### 3.1 Layering

The one structural commitment: **modulation is swappable**. Everything above it is
written against bytes, never against QR. This is what lets Stage 1 ship without
becoming the ceiling.

```
┌──────────────────────────────────────────────────────────┐
│ UI          role select · progress · file in/out · coach │
├──────────────────────────────────────────────────────────┤
│ Session     metadata · compression · hashing · assembly  │
├──────────────────────────────────────────────────────────┤
│ Fountain    LT encode (endless) / GF(2) GE decode        │
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

The modulation interface, and the reason `null`/short returns are first-class:

```ts
interface Modulation {
  readonly packetsPerFrame: number;     // 1 for plain QR, ~15 tiled, ~45 tripled
  readonly bytesPerPacket: number;
  encodeFrame(packets: Uint8Array[]): ImageData;
  decodeFrame(frame: VideoFrame): Uint8Array[];   // 0..n packets — never throws
}
```

`decodeFrame` returning fewer packets than `packetsPerFrame` is the **normal
case**, not an error path. A frame where 3 of 15 tiles decode is a perfectly good
frame. Nothing above this layer is permitted to care.

### 3.2 Sender pipeline

```
File → [compress?] → K fragments ─┐
                                  ├─► LT encoder ──► packet ──► header ──► tile ──┐
        seq counter ──► PRNG ─────┘   (endless)                                   │
                                                                                  ▼
                        canvas ◄── DC-balance ◄── grid layout ◄── N tiles ────────┘
                          │
                          └──► display at 12–15 fps, wake lock held, screen bright
```

The sender never terminates on its own. It loops until the user stops it, because
it cannot know when the receiver is done. This is not a limitation to work around
— it is the design.

### 3.3 Receiver pipeline

```
getUserMedia ──► requestVideoFrameCallback ──► MediaStreamTrackProcessor
                                                        │
                                     ┌──────────────────┴─── Worker pool ───┐
                                     ▼                                      ▼
                              zxing readBarcodes                   [Stage 2: split
                              (all symbols, bytes)                  R/G/B, stretch,
                                     │                              decode ×3]
                                     ▼
                        packets ──► header parse ──► CRC ──► GE decoder
                                                                │
                                          rank == K ─────► reassemble ─► verify hash
                                                                       ─► save
```

Worker-bound throughout: the main thread only paints UI. Decode is the CPU
bottleneck in Stage 2 (70–145 ms/frame in WASM on a phone for three planes), which
is precisely why it must not share a thread with rendering.

### 3.4 The luma-vs-colour disagreement, and how it is resolved

Two research threads measured this and disagreed:

| | `custom-codec-engineering.md` §7.2 | `beyond-qr-optical-channels.md` §6.6 |
|---|---|---|
| Colour cell penalty under 4:2:0 | 2× linear (4× area) — **derived** | 1.25× linear (1.56× area) — **measured** |
| Verdict | luma-only wins ~1.95× | RGB-tripling wins **1.98×** |

The measured result is better-founded, and the mechanism is convincing: **chroma
decimation is a low-pass filter, not a deletion.** A binary chroma pattern at
5 px/module presents 2.5 chroma samples per module — above Nyquist. At 4 px/module
it presents exactly 2.0, right at Nyquist, which is precisely where the
measurement shows it break. The "2× per axis" rule over-corrects by assuming you
must restore the original sampling density rather than merely stay above Nyquist
in the decimated grid.

Two further points weigh against luma-only:

- The luma-only case assumed 8 usable luma levels. 8-level luma was measured
  **unusable** under ordinary handheld blur (21.2% symbol error at 5 px/cell),
  versus **0.00%** for saturated 8-colour at 4 px/cell. If 8-level luma needs
  7–8 px/cell, the arithmetic inverts.
- **libcimbar spends 2 of its 6 bits per cell on colour**, and its deprecated
  8-colour mode benchmarked *faster* (943 vs 852 kbit/s). A project that measured
  this on real hardware chose colour.

**Resolution (D11): neither document decides.** Ship a calibration probe — a frame
carrying a binary luma checkerboard, a binary chroma checkerboard, and an 8-level
luma ramp, each at 3/4/5/6/8 px/module — captured at session start. It yields the
device's real luma and chroma cutoff pitch directly. This turns a documentation
argument into a runtime measurement, and gives per-device adaptation for free.

Where the luma-side note is unambiguously right and must be honoured: **AWB warps
colour in three non-monotonic dimensions**, and cannot be locked on iOS. A
per-frame in-band colour reference is **not optional** for Stage 2.

---

## 4. Data model

### 4.1 Frame header — 13 bytes (~1.0% at v25-L)

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 1 | `magic_ver` | Format magic + version nibble; rejects foreign QR codes instantly |
| 1 | 1 | `flags` | compression on/off, final-metadata bit, reserved |
| 2 | 4 | `streamId` | CRC-32 of the *whole compressed payload*. Triple-duty: session id, PRNG seed, integrity check |
| 6 | 3 | `payloadLen` | Total compressed length → yields K when combined with fragment size |
| 9 | 3 | `seq` | Packet sequence number. With `streamId`, seeds the PRNG that derives the index set |
| 12 | 1 | `fcrc` | Per-frame CRC-8 — cheap rejection of a mis-decode before it poisons the matrix |

`K`, fragment length, and **the entire index set are derived, never transmitted.**

### 4.2 Session state

```ts
type SendSession = {
  file: File; compressed: Uint8Array | null; streamId: number;
  fragments: Uint8Array[]; K: number; seq: number;       // monotonic, never resets
};

type RecvSession = {
  streamId: number | null;      // locked on first valid header seen
  K: number | null; payloadLen: number | null;
  pivots: Map<number, {row: bigint; data: Uint8Array}>;  // GE state
  rank: number;                 // done when rank === K
  stats: { framesSeen: number; packetsDecoded: number; pxPerModule: number };
};
```

The receiver locks `streamId` on the first valid header and **ignores every packet
from any other stream**. This is what makes it safe to walk into a room where
someone else is already transmitting.

---

## 5. Throughput — what to actually expect

| Stage | Approach | Expected | Basis |
|---|---|---|---|
| — | Single QR (naive; what most projects do) | 1–9 KB/s | matches TXQR's measured numbers |
| **1** | **Tiled monochrome QR** | **20–45 KB/s** | measured, stock decoder |
| **2** | **+ RGB channel tripling** | **35–90 KB/s** | measured 1.98× at 4:2:0 |
| **3** | **libcimbar-derived grid codec** | **~106 KB/s** | libcimbar's published, verified figure |
| — | Phone-to-phone research SOTA | ~40 KB/s | SoftLight, TETRIS, S2SVLC — a decade flat |
| — | All-time lab record | 12 Mb/s | PixNet — 30" LCD + 24 MP DSLR; not a sustained link |

Stage 1 alone puts us above the phone-to-phone research SOTA, using a stock
decoder. That is the measure of how much single-QR implementations leave on the
table.

**The dominant risk is not software — it is geometry.** Cell size is set by how
many *camera pixels* the sender's screen occupies:

- Laptop → phone at 30 cm: ~1325 px across ≈ 165-cell grid
- **Phone → phone: ~327 px across ≈ 54 cells — one ninth the capacity**

Phone-to-phone is a headline use case and it is nine times worse. Compounding it,
phone→phone is bounded by **minimum focus distance**, not resolution: filling the
frame needs ~6.6 cm, inside the ~10 cm focus limit, so the symbol can only span
50–60% of frame. The UI must treat this as a first-class case, not an afterthought.

---

## 6. Platform reality

Verified constraints that shape the architecture rather than decorate it.

**iOS — the binding platform:**

- **No Web Share Target, ever.** "Share → screenferry" cannot exist on iOS. Android can.
- **No File System Access API.** Output must be `navigator.share({files})`, gated on
  `canShare`, fired from a **real touch handler**. iOS silently ignores programmatic
  blob-anchor clicks.
- Inbound: `<input type=file>` with **no `accept` attribute** — forces the Files
  picker and avoids silent HEIC→JPEG transcoding.
- **Service-worker cache deleted after 7 days** unless installed to Home Screen.
  No `beforeinstallprompt` to help; we must coach it in UI. (D13)
- **iPhone cannot go fullscreen** (iPad only) — standalone display mode substitutes.
- **Wake Lock only in Home Screen web apps, iOS 18.4+.** Camera in standalone has
  regressed repeatedly across releases. A `pushState` path change kills a live stream —
  so routing must not touch the path during capture.
- **No `BarcodeDetector` anywhere on iOS** — fine, we ship zxing-wasm regardless.
- **No brightness API on any platform.** Coach the user instead.

### 6.1 Testing

- **Workhorse tier:** stub `getUserMedia` to return `canvas.captureStream(0)` and
  drive it with `requestFrame()`. No browser flags, frame-exact, deterministic.
- **Real-capture tier:** render frames → Y4M → Chromium fake camera. Already proven
  end-to-end during research: byte-exact reassembly, **including late-join recovery**
  (a receiver joining 700 ms late still reassembled 28/28 — exactly the fountain
  property we are betting on).
- **Trap, already paid for:** the flag in every tutorial,
  `--use-fake-device-for-media-capture`, **does not exist**. It is
  `--use-fake-device-for-media-stream`, and the file flag requires it.
- **iOS is not CI-testable at any price** — WebKit cannot fake a camera and the
  Simulator has none. Budget a recurring manual device pass. This is a permanent
  cost of the project, not a gap to close.

---

## 7. Phases

Each phase ends at something demonstrable. Phase 1 is deliberately the boring-
looking one, because it is where correctness is cheap to establish.

### Phase 0 — Repo and harness
Vite + TypeScript, static output. Stub-camera test tier working. CI on iad-ci.
**Done when:** an empty app builds, deploys, and a synthetic frame round-trips
through a no-op modulation.

### Phase 1 — Core codec, headless
Fountain encoder + **GE decoder**, framing, CRC, compression, hashing. No camera,
no UI. Property tests: random files through random loss patterns, always
byte-exact. Port `sim/fountain_overhead_sim.py` assertions into the test suite so
D5/D6 stay verified as the code changes.
**Done when:** a 10 MB file survives 50% random packet loss, byte-exact, and
measured overhead matches the simulation to within a percent.

### Phase 2 — Single-QR optical loop
Simplest possible modulation. Real `getUserMedia`, real render loop.
**Done when:** a real file moves between two real devices. Slowly. This is the
milestone that proves the whole thesis.

### Phase 3 — Tiling (D1)
Grid layout, multi-symbol decode, worker pool, DC balancing, `requestVideoFrameCallback`.
**Done when:** ≥20 KB/s sustained, laptop→phone. Expect the px/module cliff to bite
here — 4 px/module is a cliff, not a slope.

### Phase 4 — The app
PWA, service worker, offline, file in/out per platform, wake lock, the coaching UI
(live px/module readout, "move closer / hold still"), progress model with no
back-channel, honest up-front time estimate, size warnings. iOS device pass.
**Done when:** a non-technical user completes a transfer without being told how.

### Phase 5 — Calibration probe + colour (D11, Stage 2)
Ship the probe first and let it settle luma-vs-colour on real devices. Then RGB
tripling with a per-frame in-band colour reference.
**Done when:** the probe reports device cutoffs, and colour is enabled only where
it measurably wins.

### Phase 6 — Custom codec (Stage 3)
Only after Stages 1–2 are solid, and only after the licensing decision below.

---

## 8. Open questions

1. **Licensing — must be decided before Phase 6, and consciously.** libcimbar is
   **MPL-2.0** (file-level copyleft); screenferry's README says MIT. Porting is
   legal but makes the repo mixed-license and obliges per-file marking. The failure
   mode is someone pasting in a function and deciding this by accident. See
   [`../notes/prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md).
2. **Phone→phone at 54 cells** — is Stage 1 even viable there, or does phone→phone
   need its own profile (bigger modules, fewer tiles, more frames)? Measure in Phase 3.
3. **GE decode cost on a real phone.** ~390 MB of XOR at K=1000, spread over a
   multi-minute transfer — believed fine, unmeasured. If it bites, the fix is
   banded/windowed GE, not switching to peeling (D6).
4. **Progress UX with no back-channel.** The sender genuinely cannot know receiver
   progress. Options: show nothing on the sender; show elapsed/loop count; or an
   optional two-camera mode where the receiver flashes ACKs back. The last is
   powerful but violates the one-camera baseline — keep it strictly optional.
5. **Encryption.** Out of scope for v1 per the concept note, but the optical channel
   is uniquely exposed to being *filmed*. Worth revisiting once the transport is real.
6. **Should the sender ever stop?** Currently it loops forever. A "probably done by
   now" heuristic risks stopping early; never stopping risks the user leaving it on.

---

## 9. Evidence index

| Document | Carries |
|---|---|
| [`qr-encoding-capacity.md`](../research/qr-encoding-capacity.md) | Capacity tables (verified 3 ways, 160 combos), mask pinning, EC level, camera limits |
| [`browser-qr-scanning.md`](../research/browser-qr-scanning.md) | Decoder comparison, **binary safety**, capture pipeline, decode rates |
| [`fountain-codes-and-protocol.md`](../research/fountain-codes-and-protocol.md) | Coding scheme, BC-UR/BBQr prior art, header design |
| [`sim/`](../research/sim/) | **Independent verification of D5/D6** — runnable |
| [`beyond-qr-optical-channels.md`](../research/beyond-qr-optical-channels.md) | Tiling, colour tripling, screen-camera SOTA, JAB Code rejection |
| [`custom-codec-engineering.md`](../research/custom-codec-engineering.md) | libcimbar geometry, GPU pipeline, calibration, camera ISP effects |
| [`pwa-platform-and-ux.md`](../research/pwa-platform-and-ux.md) | iOS blockers, file I/O, PWA, testing tiers |
| [`../notes/prior-art-libcimbar.md`](../notes/prior-art-libcimbar.md) | Verification of the 106 KB/s claim + licensing |

# Beyond QR: high-capacity screen-to-camera optical channels

*Research note for qrbeam. Compiled 2026-07-31.*

**Scope.** Everything that might beat plain animated QR on the screen→camera link:
colour barcodes, academic screen-camera communication systems, raw pixel-grid codecs,
amplitude vs chrominance modulation, temporal tricks, and — most importantly — what
survives being implemented in JavaScript/WASM in a browser.

**Method.** Literature was gathered from ACM/IEEE abstracts, arXiv, OpenAlex and
Semantic Scholar (cited inline). Because most published numbers are lab numbers with
tripods and DSLRs, and because none of them tell you what a *browser* can do, this note
also contains **original measurements** made for qrbeam: the Fraunhofer JAB Code
reference implementation and zxing-cpp (the engine behind `zxing-wasm`) were run
head-to-head through an identical simulated display→camera pipeline (linear-light
colour crosstalk, optical blur, sensor noise, auto-white-balance error, tone curve,
4:2:0 chroma subsampling, JPEG). Those results are marked **[measured here]** and the
scripts are described in §9 so they can be re-run.

---

## 0. TL;DR

| Question | Answer |
|---|---|
| Highest demonstrated screen→camera rate ever | **12 Mb/s** — PixNet, MIT, 2010. 30" 2560×1600 LCD → **DSLR / high-speed camera**, 10 m. Nominal (bits-per-still × 30), not sustained. |
| Highest demonstrated **phone-to-phone** rate | **~300–324 kb/s (≈40 KB/s)** — TETRIS (311 kb/s), SoftLight (22 KB in 0.6 s). Both 2016–2017 hardware. |
| Best *free* capacity win over QR | **Colour.** RGB-channel tripling is the cheapest 3×; JAB Code gives ~2.4× per module. |
| Does colour survive a real camera? | Yes — **saturated 8-colour (binary per RGB channel) is as robust as binary black/white** at ≥4 px/module. **[measured here]** |
| What kills colour? | **Chroma subsampling.** 4:2:0/4:2:2 in the capture path costs colour exactly one step in module size (needs 5 px/module where mono needs 4). **[measured here]** |
| What kills multi-level grey? | Blur. 4-level luma is *worse* than 8-colour RGB despite carrying fewer bits. **[measured here]** |
| Realistic browser ceiling | **~15–40 KB/s** mono tiled QR; **~30–60 KB/s** colour-tripled. Not 1–3 KB/s, and not 1 MB/s. |
| Should qrbeam use QR? | **Yes — but tiled, and with an RGB colour layer as v2.** Do not use JAB Code as the v1 wire format. See §10. |

---

## 1. Colour 2D barcodes

Every cell carries log₂(colours) bits instead of 1. This is the cheapest large win
available and the only one that requires no new maths.

### 1.1 JAB Code (ISO/IEC 23634:2022, Fraunhofer SIT)

JAB Code ("Just Another Bar Code") is the only *standardised* polychrome matrix
symbology. Colour squares in a square/rectangular grid; one **primary symbol** with four
corner finder patterns plus up to 60 **secondary symbols** docked to it.
- Spec: <https://www.iso.org/standard/76478.html>, project page <https://jabcode.org/>
- Reference implementation: <https://github.com/jabcode/jabcode> (C11, ~1.0k stars)
- Paper: Berchtold, Bergmann, Hartung, Küppers, Steinebach, *JAB Code — A Versatile
  Polychrome 2D Barcode*, Electronic Imaging 2020,
  <https://doi.org/10.2352/issn.2470-1173.2020.3.mobmu-207> — claims "approximately
  three times higher data density compared to conventional 2D matrix codes such as
  DataMatrix, QR or Aztec code … by the use of eight colors".

**License — this changed very recently and matters a lot for qrbeam.** The repo was
LGPL 2.1, moved to LGPLv3-with-linking-exception on 2025-07-23, and was
**re-licensed to MIT on 2026-04-17** ("updated the license to the MIT license",
commit on `master`; the LICENSE file now reads *"As the copyright holder, we are hereby
re-licensing this project under the MIT License … Copyright (c) 2026 Fraunhofer SIT"*).
Many secondary sources (Wikipedia, blog posts, the 2020 paper) still say LGPL 2.1 — they
are out of date. **JAB Code is now MIT and freely embeddable in an MIT-licensed
static web app.** Current version is 2.0.0.

**Structure and capacity (from the source, `getSymbolCapacity()` in `encoder.c`):**

```
capacity_bits = (W*H − finders − alignment − palette − metadata) × log2(colours)
```
- Colours: 4, 8 (default), 16, 32, 64, 128, 256 → 2…8 bits/module.
  The 4-colour default palette is black/magenta/yellow/cyan — chosen for *print* (CMYK),
  not for a screen. On a screen you would want maximally separated primaries.
- Symbol side = `4·version + 17`, version 1…32 → 21…**145 modules**.
- ECC is **LDPC**, 10 levels via a (wc, wr) table
  `{{4,9},{3,8},{3,7},{4,9},{3,6},{4,7},{4,6},{3,4},{4,5},{5,6},{6,7}}`.
  Code rate = 1 − wc/wr, so **the weakest JAB ECC is 62.5% rate (37.5% redundancy)**,
  the strongest 14.3%. For comparison QR-L is ~80% rate. JAB's floor on redundancy
  eats about a fifth of the colour gain.

**Measured capacity [measured here]** — built the reference writer and binary-searched
the maximum payload of a single version-32 (145×145 module) symbol:

| colours | ECC level | max payload (bytes) | bits/module (net) |
|---|---|---|---|
| 8 | 1 (weakest) | **4772** | 1.82 |
| 8 | 3 (default) | 4245 | 1.62 |
| 8 | 5 | 3271 | 1.24 |
| 8 | 10 (strongest) | 1088 | 0.41 |
| 4 | 1 | 3181 | 1.21 |
| 4 | 3 | 2827 | 1.08 |
| 4 | 10 | 724 | 0.28 |

vs **QR v40-L = 2953 bytes in 177×177 = 0.754 bits/module**.
So **JAB 8-colour is 2.41× denser per module than QR-L** — close to, but below, the
claimed 3×, because of the LDPC floor and the palette/finder overhead. The 4-colour
mode is 1.5× the 8-colour bit rate ratio exactly as expected (2 bits vs 3).

**But the reference decoder is the problem.** [measured here]

- It **cannot decode at 3 px/module even on a perfectly clean synthetic image.**
  4 px/module works up to version 28; version 32 needs 6 px/module.
- It is **extremely blur-intolerant**. On a clean version-8 symbol at 6 px/module, a
  Gaussian blur of **σ = 0.5 sensor pixels** (0.08 modules) already breaks it. At
  4 px/module it survives σ ≈ 0.8 px and fails at σ = 1.2 px.
- Decode of a 705 px symbol inside a 1920×1080 frame takes **~113 ms** on a desktop
  x86 core (including process spawn + PNG decode; the pure decode of an 870 px image is
  **77 ms**). zxing-cpp decodes a QR v40 in the same 1080p frame in **2.0 ms**.
  That is a **~40–50× CPU gap.**

Head-to-head, both symbols confined to a 900×900 px patch of the sensor, 3/3 trials
must be byte-exact, identical camera model (blur σ in *sensor pixels*, noise σ=3,
tone-curve error):

| px/module | QR-L bytes | QR-M bytes | JAB 8-col bytes | JAB 4-col bytes | JAB8 / QR-L |
|---|---|---|---|---|---|
| 3 | 2953 (v40) | 2331 (v40) | **0 (fails)** | 0 | — |
| 4 | 2953 (v40) | 2331 (v40) | 941 (v12) | 0 | 0.32× |
| 5 | 2953 (v40) | 2331 (v40) | 4504 (v31) | 3003 (v31) | **1.53×** |
| 6 | 2068 (v33)¹ | 1628 (v33)¹ | 4504 (v31) | 3003 (v31) | 2.18× |
| 8 | 1091 (v23)¹ | 857 (v23)¹ | 2681 (v23) | 1654 (v22) | 2.46× |
| 10 | 718 (v18)¹ | 560 (v18)¹ | 1774 (v18) | 628 (v12) | 2.47× |

¹ QR is capped by the 900 px budget at these scales, not by decodability — in a real
system you would *tile* QR to refill the frame (see §6.3), which removes most of the
apparent JAB advantage at ≥6 px/module.

**Verdict on JAB Code for qrbeam.** The symbology is good; the reference decoder is
research-grade, not a video-rate camera decoder. Using it would mean either (a) accepting
~5 px/module and ~100 ms/frame decode in WASM ⇒ single-digit fps, or (b) writing a new
blur-tolerant JAB decoder — which is most of the work of writing a custom codec anyway.
There is a JS/Emscripten port, <https://github.com/TMSSassen/JABCodeJS>, but it is 6
commits, unmaintained, string-only on the encode side (no binary API), and wraps the same
fragile decoder. **Not the v1 choice.**

### 1.2 Microsoft HCCB / Microsoft Tag — dead

High Capacity Color Barcode: triangles in a 4- or 8-colour palette. Microsoft claimed
"readable eight-color HCCBs equivalent to approximately 3,500 characters per square inch"
with off-the-shelf printers/scanners
(<https://en.wikipedia.org/wiki/High_Capacity_Color_Barcode>). The Microsoft Tag service
was announced end-of-life on 2013-08-19 and **terminated 2015-08-19**; it was handed to
Scanbuy's ScanLife. There is no maintained open implementation (one Elm toy exists:
`github.com/canadaduane/elm-hccb`). HCCB was designed for print and for *identifiers*,
not bulk data. **Dead end — do not pursue.**

### 1.3 Colour-multiplexed QR (three QR codes in R/G/B) — the sleeper

Generate three independent QR symbols, put one in each of R, G and B, and merge. The
receiver splits the channels and runs a *stock, well-tested* QR decoder three times.
Capacity ×3, decoder risk ≈ 0.

Prior art:
- Hobby proof-of-concept by [mit41301] using rMQR codes, written up on Hackaday,
  <https://hackaday.com/2023/07/28/color-can-triple-qr-code-capacity/>
  (project on hackaday.io #192082, using <https://github.com/OUDON/rmqrcode-python>).
- Commenter Eric Seifert's observation is the standard warning: *"cameras in general have
  a harder time separating RGB colors than you might expect, so you get bleedthrough in
  the blue channel from green, green channel from red"* — and his fix, *"switching to a
  better qrcode decoding library (zbar) solved it mostly."*
- Academic variants: *Colour multiplexing of quick-response (QR) codes*
  (<https://doi.org/10.1049/el.2014.4319>), and QRGB (<https://qrgb.shyft.us/>).
  Print-oriented work encodes in CMY rather than RGB because printers are subtractive —
  **irrelevant for qrbeam, which is emissive.**

**Does it survive real camera colour crosstalk? [measured here] — yes, comfortably.**

Simulated pipeline: sRGB → linear light → 3×3 crosstalk matrix (9–10% leakage between
adjacent primaries, row-normalised) → ±3% auto-white-balance gain error per channel →
Gaussian blur → sensor noise → optional chroma subsampling. Per channel, a 2nd/98th
percentile stretch then `zxingcpp.read_barcode`. Success = all three planes byte-exact.

QR v30-L (1732 bytes/plane), blur σ=1.5 px, noise σ=4, fraction of the 3 planes recovered
over 5 runs:

| px/module | no subsampling (4:4:4) | 4:2:2 | 4:2:0 | mono QR baseline (4:2:0) |
|---|---|---|---|---|
| 3 | 0% | 0% | 0% | 0/5 |
| 4 | 93% | 0% | 0% | **5/5** |
| 5 | **100%** | **100%** | **100%** | 5/5 |
| 6 | 100% | 100% | 100% | 5/5 |
| 8 | 100% | 100% | 100% | 5/5 |

**The whole story is in that table.** With clean 4:4:4 RGB frames, colour tripling is
*free* — it works at exactly the same module size as monochrome and gives a clean 3×.
With 4:2:0 or 4:2:2 chroma subsampling anywhere in the capture path, colour needs
**5 px/module where mono needs 4** — a 1.56× area penalty. Net gain 3 / 1.56 ≈ **1.9×**.
(Note 4:2:2 costs the same as 4:2:0 here: it is the *horizontal* halving that bites.)

With JPEG q60 on top (quantisation *and* 4:2:0), the penalty grows: at 4 px/module 0 of 3
planes survive, at 6 px/module 2 of 3, at 8 px/module 3 of 3, while monochrome is 5/5
throughout. **If your capture path re-compresses, colour costs you an octave.**

Crucially for qrbeam: **the three colour planes are three independent erasure
channels.** With a fountain code you do not need all three; a frame that yields 2 of 3
planes is simply a frame that delivered 2/3 of the symbols. This composes perfectly with
the rateless design already in the qrbeam concept note. That is a much better failure
mode than JAB Code, where a colour misclassification corrupts the single LDPC block.

### 1.4 HCC2D and the colour-classification literature

HCC2D (High Capacity Coloured 2-Dimensional code, Querini & Italiano) is a QR-derived
colour symbology. The most useful output of that line of work is not the symbology but
the empirical finding on **colour classifiers**: *Reliability and data density in high
capacity color barcodes*, ComSIS 2014,
<https://doi.org/10.2298/csis131218054q> — "the data density of color barcodes is
substantially limited by the redundancy needed for correcting errors, which are due not
only to geometric but also to chromatic distortions", and SVMs "do not seem to pay off"
versus simple clustering. Take-away: **spend the effort on a colour-reference/pilot
pattern, not on a clever classifier.** JAB Code already does this (it embeds the palette
redundantly in the symbol); qrbeam should too.

### 1.5 Do Aztec / DataMatrix / PDF417 / MaxiCode / Han Xin beat QR?

For a *screen* channel the metric that matters is **payload bytes per module²**, because
the module count is set by what the camera can resolve.

| Symbology | Max modules | Max bytes | bytes / 1000 modules² | Notes |
|---|---|---|---|---|
| **QR v40-L** | 177×177 = 31 329 | 2953 | **94.3** | ISO/IEC 18004. Needs 4-module quiet zone. |
| Aztec, 32 layers | 151×151 = 22 801 | 1914 | 83.9 | **No quiet zone required** — real area win at small sizes. ECC continuously tunable (min 23%+3 codewords). <https://en.wikipedia.org/wiki/Aztec_Code> |
| Data Matrix ECC200 | 144×144 = 20 736 | 1556 | 75.0 | Fixed ~28% RS overhead at max size; not tunable. <https://en.wikipedia.org/wiki/Data_Matrix> |
| Han Xin v84 | 189×189 = 35 721 | 3261 | 91.3 | ISO/IEC 20830:2021. 4 ECC levels (8/15/23/30%). Slightly *below* QR. <https://en.wikipedia.org/wiki/Han_Xin_code> |
| PDF417 | stacked linear | ~1108 | ≪ QR | Stacked-linear; density is poor, designed for laser scanners. |
| MaxiCode | fixed 33×30 hex | 93 | — | Fixed size. Useless for bulk data. |
| rMQR | ≤ 17×139 | 361 | ~150¹ | ¹Good *per module* but tiny absolute payload; useful as a tiling unit. |
| **JAB Code v32, 8-col, ECC1** | 145×145 = 21 025 | **4772** | **227** | **2.41× QR.** [measured here] |
| **RGB-tripled QR v40-L** | 177×177 | **8859** | **283** | **3.0× QR** at 4:4:4; ~1.9× effective at 4:2:0. [measured here] |

**Conclusion: none of the monochrome alternatives beats QR meaningfully.** QR-L is
already the densest mainstream monochrome symbology per module, has the widest ECC range
(L/M/Q/H), the best-tested decoders, and — decisive for qrbeam — decoders that expose
**raw bytes**. Aztec's no-quiet-zone property is genuinely useful if you tile aggressively
(it recovers ~8 modules of pitch per tile), and zxing-cpp decodes Aztec too, so it is a
reasonable *tiling* experiment later. Everything else is a step backwards.

---

## 2. Academic screen–camera communication systems

This is the deepest vein. Numbers below are as reported; **the hardware column is the
part that matters** — a tripod and a DSLR is not a phone.

| System | Venue / year | Reported rate | Hardware & conditions |
|---|---|---|---|
| **PixNet** | MobiCom 2010, Perli, Ahmed, Katabi | **12 Mb/s @ 10 m**; 8 Mb/s at 120° view angle; up to 15.3 Mb/s nominal | DELL 30" 2560×1600 LCD → **Nikon D3X (24 MP)** or **Casio EX-F1 (6 MP, 60 fps burst)**. Throughput = mean bits/frame × 30. Phone (Nokia N82, 5 MP): **4.30 Mb/s** vs tiled QR v5-g2 = *nothing* and QR v5-g5 = 1.54 Mb/s. Paper: <https://groups.csail.mit.edu/netmit/wordpress/wp-content/themes/netmit/papers/full_paper5_pixnet.pdf> |
| **COBRA** | MobiSys 2012, Hao, Zhou, Xing | 5-colour barcode stream; 64–98% of frames decoded across environments | Off-the-shelf Android phones, phone→phone. HSV colour recovery costs 12 of its 16 ms/frame decode budget. <https://doi.org/10.1145/2307636.2307645> |
| **LightSync** | MobiCom 2013, Hu, Gu, Pu | Unsynchronised 4D barcodes; in-frame colour tracking + linear erasure code; works at any TX/RX rate combination provided RX ≥ ½ TX | Phone→phone. <https://doi.org/10.1145/2500423.2500437> |
| **RDCode** | MobiCom 2014, Wang et al. | **≥ 2× COBRA**, error rate reduced to 10% | Android 4.2, tablets + phones. Packet-frame-block structure, ECC at three levels. <https://doi.org/10.1145/2639108.2639135> |
| **Strata** | MobiCom 2014, Hu, Mao et al. | Hierarchical/layered modulation; *"significantly extends the operational range, though at the expense of less capacity than a single-layer code"* | Explicitly a **range/robustness** scheme, not a peak-rate scheme. <https://doi.org/10.1145/2639108.2639132> |
| **RainBar** | ICDCS 2015, Wang et al. | Higher average throughput than COBRA/RDCode at longer distances | Android phones. Progressive locator detection, robust colour recognition. <https://doi.org/10.1109/icdcs.2015.61> |
| **SoftLight** | INFOCOM 2016, Hu et al. | **22 KB photo in 0.6 s ⇒ ~293 kb/s (36.7 KB/s)**; 2.2× the prior SOTA goodput | **Android phone → Android phone.** Soft-hint bit-level erasure channel + **rateless (fountain) coding**, YUV modulation. <https://doi.org/10.1109/infocom.2016.7524510> |
| **TETRIS** | MASS 2017 | **311.22 kb/s at 90% accuracy (≈35 KB/s net)** | Smartphone→smartphone colour video barcode. <https://doi.org/10.1109/mass.2017.101> |
| **MAMBA** | WoWMoM 2020, Bufalino et al. | Adaptive frame rate + length; 5-colour barcode with corner trackers; scales with **block count, not pixel count** | Mobile app, **bi-directional** feedback. <https://doi.org/10.1109/wowmom49955.2020.00059> |
| **S2SVLC (blur reduction)** | arXiv 2506.23002 (2025) | States the phone-to-phone **S2SVLC data rate is 324 kb/s** | Survey/algorithm paper; useful modern confirmation that phone↔phone SOTA sits near 300 kb/s. <https://arxiv.org/pdf/2506.23002> |

**The imperceptible / steganographic branch** (data hidden inside displayed video). These
are a *different problem* — they trade almost all throughput for invisibility — but their
modulation tricks are instructive:

| System | Venue / year | Rate | Notes |
|---|---|---|---|
| **InFrame++** | MobiSys 2015 | **150–240 kb/s @ 120 fps** (1 data frame per 12 display frames); up to 360 kb/s at 1:6 | Needs a **120 Hz** monitor. Complementary-frame pairs. <https://doi.org/10.1145/2742647.2742652> |
| **HiLight** | MobiSys 2015 | ~1–10 kb/s | Encodes into the **alpha channel** (pixel translucency) atop arbitrary content, so it never touches RGB directly. <https://doi.org/10.1145/2742647.2742667> |
| **ChromaCode** | MobiCom 2018 | **777 kb/s raw, 120 kb/s goodput, BER 0.05** | AOC AGON 27" **120 Hz** monitor 1920×1080 → Nexus 6P. Modulates **lightness in CIELAB**, adaptive per-pixel Δ based on lightness *and* local texture, using ΔE₀₀ as the perceptual target. Pixel 2: 632/55 kb/s, BER 0.09. Handheld: 627/70 kb/s. <https://doi.org/10.1145/3241539.3241543> — PDF: <https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf> |
| **Uber-in-Light** | INFOCOM 2016 | MFSK over **complementary RGB intensity changes**, sync in an orthogonal colour channel | The complementary-colour idea is directly reusable. <https://doi.org/10.1109/infocom.2016.7524513> |
| **DeepLight** | 2021 | **0.95–11.2 kb/s goodput**, BER < 0.2, handheld, up to 2 m | CNN-based decoder that avoids explicit per-bit pixel isolation. Illustrates how brutally the invisibility constraint costs rate. <https://arxiv.org/pdf/2105.05092> |
| **DisCo** | ACM TOG 2016 (Jo, Gupta, Nayar) | Imperceptible, robust to occlusion/defocus/perspective | **Exploits rolling shutter**: temporal brightness modulation at high frequency becomes a *spatial* flicker pattern in the captured image; two exposures separate flicker from image. Works with off-the-shelf sensors. <https://doi.org/10.1145/2896818> |

**Read of the literature.**
1. The all-time record (PixNet, 12 Mb/s) is a **machine-vision result**: 30-inch monitor,
   24 MP DSLR, 10 m, and the "throughput" is bits-per-still × 30 fps, not a sustained
   link (the paper concedes the D3X "cannot deliver 60 fps in realtime"). PixNet also
   deliberately restricted itself to **1 bit/pixel in the green channel only** to make
   the QR comparison fair — so it is not even a colour result.
2. The honest **phone-to-phone** ceiling in the literature has sat at **~300–330 kb/s
   (≈40 KB/s)** for a decade (SoftLight 2016, TETRIS 2017, S2SVLC 2025). Nobody has
   demonstrated a sustained megabit phone-to-phone screen→camera link.
3. Every system that got to that level built a **custom blur-aware colour decoder** and
   a **rateless/erasure layer**. SoftLight in particular is the closest published design
   to what qrbeam wants: soft per-bit confidence → bit-level erasure channel → fountain
   code. That architecture is worth copying even if the symbology differs.
4. Nothing in the literature is a browser implementation. All of it is native
   Android/C++/CUDA.

---

## 3. The raw "video codec" approach (no barcode at all)

Display data as a raw bitmap grid; receiver does corner detection, perspective (homography)
correction, then samples cell centres.

**What it buys.** All of QR's overhead disappears: finder patterns, alignment patterns,
format/version info, mandatory quiet zone, and the fixed L/M/Q/H ECC ladder. You choose
your own code rate, and you can use a *rateless* code (RaptorQ / LT) directly at the
symbol level instead of stacking a fountain code on top of Reed–Solomon.

**What kills it.**
- **Camera ISP, not the sensor.** `getUserMedia` gives you post-ISP frames: demosaic,
  denoise (which is a spatial low-pass and eats fine grids), sharpening (ringing at cell
  edges), local tone mapping, and auto white balance that drifts as the frame content
  changes. You cannot turn these off from a browser.
- **Chroma subsampling.** Measured above: costs colour one step of module size. This is
  the single largest practical penalty for a colour grid.
- **Rolling shutter.** Every phone camera is rolling-shutter. If the display changes
  during the sensor's readout, the frame is *torn*: the top rows are frame N, the bottom
  rows frame N+1. This is not corruption — it is a hard split. PixNet's answer was to run
  the camera at **twice** the display rate so that at least one capture per display frame
  is clean; that is the correct answer for qrbeam too, and it halves your usable frame
  rate. (It is also *exploitable* — see §5.)
- **Moiré / aliasing** between the display's pixel grid and the sensor's Bayer grid. This
  is why you cannot go to 1 display pixel per module: you need the display to render each
  module over ≥2–3 display pixels, and the camera to sample it at ≥3–4 sensor pixels.
- **Auto-exposure hunting** when the frame's average brightness changes between codes.
  Mitigation: keep every frame's mean luminance constant (a DC-balanced constellation).
- **Geometry.** Perspective + barrel distortion + rolling-shutter shear means the grid is
  not a grid. You need dense fiducials, not just four corners — which is precisely what
  QR's alignment patterns are, and why removing them is not free.

**Has anyone shipped this?** Not on the open web in a browser. The nearest shipped things
are the *research* systems in §2 (all native), and print-oriented paper-data formats
(Twibright Optar, PaperBack) which are explicitly out of qrbeam's scope. The honest
assessment: a raw grid codec is a real ~1.3–1.6× over a colour-tiled QR design, and it
costs you a geometry pipeline, a calibration pattern, a synchronisation scheme, and a
decoder you have to debug against real phone cameras. **It is the v3 upgrade path, not
the v1 plan.**

---

## 4. Grayscale/amplitude vs colour/chrominance: which survives?

The received wisdom is "cameras mangle colour, luma is reliable". **The measurement says
that is only half right.** [measured here]

Experiment: a 96×96 cell grid, perfect geometry recovery (an upper bound — real geometry
error only makes things worse), receiver-side affine colour calibration learned from a 5%
pilot set, nearest-neighbour decode. Symbol error rate (SER):

**Condition: blur σ = 1.5 px, noise σ = 4, no compression ("typical handheld")**

| constellation | bits/cell | 3 px/cell | 4 px/cell | 5 px/cell | 6 px/cell | 8 px/cell |
|---|---|---|---|---|---|---|
| luma-2 (black/white) | 1 | 2.13% | **0.00%** | 0.00% | 0.00% | 0.00% |
| luma-4 (4 grey levels) | 2 | 29.32% | 7.26% | 0.05% | 0.00% | 0.00% |
| luma-8 (8 grey levels) | 3 | 61.23% | 39.03% | 21.18% | 4.18% | 0.00% |
| CMYK-4 (blk/mag/yel/cyan) | 2 | 0.34% | **0.00%** | 0.00% | 0.00% | 0.00% |
| **RGB-corner-8** (saturated) | **3** | 8.17% | **0.00%** | 0.00% | 0.00% | 0.00% |
| RGB-planes-64 (4 levels/ch) | 6 | 70.49% | 33.58% | 14.46% | 7.25% | 2.53% |

**Condition: same + JPEG q60 (i.e. quantisation *and* 4:2:0)**

| constellation | bits/cell | 3 px/cell | 4 px/cell | 5 px/cell | 6 px/cell | 8 px/cell |
|---|---|---|---|---|---|---|
| luma-2 | 1 | 2.55% | 0.00% | 0.00% | 0.00% | 0.00% |
| luma-4 | 2 | 30.92% | 8.34% | 0.08% | 0.00% | 0.00% |
| luma-8 | 3 | 62.46% | 41.16% | 21.85% | 5.52% | 0.00% |
| CMYK-4 | 2 | 18.08% | 1.20% | 0.01% | 0.00% | 0.00% |
| **RGB-corner-8** | 3 | 36.65% | 7.26% | 0.86% | **0.00%** | 0.00% |
| RGB-planes-64 | 6 | 88.89% | 69.70% | 53.42% | 30.41% | 5.06% |

**Condition: blur σ = 2.5 px, noise σ = 5 ("soft / slight motion")**

| constellation | bits/cell | 3 | 4 | 5 | 6 | 8 |
|---|---|---|---|---|---|---|
| luma-2 | 1 | 23.68% | 13.44% | 4.31% | 0.00% | 0.00% |
| luma-4 | 2 | 62.27% | 50.18% | 36.95% | 22.36% | 0.43% |
| RGB-corner-8 | 3 | 56.97% | 34.86% | 14.56% | 1.27% | 0.00% |
| RGB-planes-64 | 6 | 94.36% | 87.90% | 77.56% | 58.81% | 15.36% |

**Findings.**

1. **Multi-level amplitude (grayscale) is the worst option available.** 4-level luma
   (2 bits) is beaten by CMYK-4 (2 bits) at every operating point and is beaten by
   *8-colour* (3 bits) too. 8-level luma is unusable below 6 px/cell. Blur is
   inter-symbol interference along a single 1-D axis; neighbouring cells average toward
   the middle of the constellation and the intermediate levels collapse first.
   **Do not build a grayscale multi-level scheme.**
2. **Saturated 8-colour (one binary decision per RGB channel) is as robust as plain
   black/white** at ≥4 px/cell while carrying 3× the bits. It is *not* really "colour
   modulation" — it is three parallel binary-luma channels, which is exactly why it
   inherits binary luma's robustness. This is the same insight that makes RGB-channel
   tripling of QR work (§1.3).
3. **Push past 8 colours and it falls apart.** 64 colours (4 levels per channel = 6
   bits/cell) has ≥2.5% SER even at 8 px/cell with no compression, and 30% under JPEG.
   The intermediate levels are amplitude levels again, and §4.1 applies. This is the
   quantitative reason JAB Code's 16/32/64/128/256-colour modes exist but nobody uses
   them.
4. **Compression is the colour-specific tax.** JPEG/4:2:0 barely moves binary luma
   (2.13% → 2.55% at 3 px/cell) but pushes RGB-8 from 0.00% to 7.26% at 4 px/cell.
   Every colour design must budget one extra step of cell size for it.
5. **A layered design is the right answer under 4:2:0.** Put 1 bit/cell of *luma* at the
   fine pitch and 2 bits/cell of *chroma* at 2× coarser pitch: net 1 + 2/4 = **1.5
   bits per fine cell** with no chroma-resolution violation. That is exactly the
   hierarchical-modulation idea from Strata (MobiCom'14) applied to the colour axis.

---

## 5. Temporal tricks

- **Run the camera at ≥2× the display rate.** This is PixNet's synchronisation answer and
  it is the single most important temporal rule: *"we calibrate the shutter speed to
  ensure that the camera's frame rate is at least twice that of the LCD… each frame
  displayed by the LCD is captured without shadowing in at least one of the camera's
  frames."* With a 30 fps browser camera this caps the display at **15 fps** and the
  usable decode rate at ~10–15 fps. Empirically, TXQR found **6–7 fps optimal** on real
  phones. Budget for 8–12 decodable frames per second, not 30.
- **Rolling-shutter exploitation** (DisCo, ACM TOG 2016; RollingLight, MobiSys 2015).
  Modulating the *whole* display brightness at kHz rates turns time into space: one
  exposure captures many "rows" of symbols. This is how LED-to-camera VLC gets kbps out
  of a 30 fps camera. **For qrbeam this is not a throughput win** — it converts spatial
  bandwidth into temporal bandwidth, and qrbeam has plenty of spatial bandwidth and very
  little temporal. It is only useful for the *ambient-light-sensor* fallback (§7).
- **Complementary frames** (InFrame++, Uber-in-Light, ChromaCode): display +Δ and −Δ in
  successive frames so the *time-average* is the unmodified image. This is a technique
  for **invisibility**, and it halves your rate. qrbeam has no invisibility requirement —
  the screen is *supposed* to look like a code. **Skip it.** The one borrowable idea is
  **DC balance**: keeping every frame's mean luminance and mean colour constant stops the
  camera's auto-exposure and auto-white-balance from hunting between frames. That is
  cheap and worth doing.
- **Frame-rate stacking** (display at 120 Hz, capture at 120 fps) is what InFrame++ and
  ChromaCode rely on. In a browser you can *display* at 120 Hz on capable hardware
  (`requestAnimationFrame`) but you cannot *capture* at 120 fps. Asymmetric and therefore
  useless here.

---

## 6. Reality check: what is achievable in a browser

### 6.1 The capture path

- **`getUserMedia`** gives post-ISP frames. Practically: 1280×720 or 1920×1080 at 30 fps
  is universally available; 1080p60 is available on some Android devices; 4K is
  occasionally available on iOS via `{width:{ideal:3840}}` but with a hard cost in
  frame-processing time. Constraints are advisory — always read back
  `track.getSettings()` and adapt.
- **Chroma subsampling is real and unavoidable.** The camera hands the OS NV12 (4:2:0) or
  YUY2 (4:2:2); the browser converts to RGB for you. Your `<video>` element's RGB is a
  *reconstruction*. §1.3/§4 quantify the cost: one step of module size for colour.
- **`requestVideoFrameCallback`** is the right per-frame hook — **Baseline since October
  2024** — and its `metadata.presentedFrames` lets you detect dropped frames, which is
  exactly the signal a fountain-code receiver wants for diagnostics.
  <https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback>
- **Getting pixels out** is the hidden cost. `canvas.getImageData()` on a 1080p frame is
  an ~8 MB copy and a GPU→CPU sync; done naively on the main thread this alone can cost
  more than the decode. Prefer `MediaStreamTrackProcessor` → `VideoFrame.copyTo()` into a
  pre-allocated buffer, in a **Web Worker**, and ask for the **`I420`/luma plane
  directly** where available — you get the greyscale plane for free with no RGB
  conversion. On Safari, fall back to `OffscreenCanvas` in a worker.

### 6.2 The decoders

| Library | Binary-safe? | Notes |
|---|---|---|
| **zxing-wasm** (<https://github.com/Sec-ant/zxing-wasm>) | **Yes** — `ReadResult.bytes: Uint8Array` and `bytesECI` are in the public type (`src/bindings/readResult.ts`) | zxing-cpp compiled to WASM. Reader-only bundle ~1.04 MiB. Multiple symbols per frame (returns `ReadResult[]`). Apache-2.0 / BSD-3 / MIT. **The right choice.** |
| **jsQR** (<https://github.com/cozmo/jsQR>) | **Yes** — `QRCode.binaryData: number[]` | Pure JS, small, single code per frame, no perspective-hardening beyond the basics. Fine as a fallback. |
| **`BarcodeDetector`** (native) | **No** — the spec exposes only `rawValue: DOMString`. Bytes are lost. | Also: Chrome Android full support (v150+), Chrome desktop *partial* (v83+), **Safari/iOS disabled by default**, **Firefox not supported**. <https://caniuse.com/mdn-api_barcodedetector> **Unusable for qrbeam** — the binary-safety constraint in the concept note rules it out on its own. |
| **JABCodeJS** (<https://github.com/TMSSassen/JABCodeJS>) | No (string-only encode API) | 6 commits, unmaintained, wraps the fragile reference decoder. |

**Decode cost [measured here]** — zxing-cpp (the exact engine behind `zxing-wasm`), native
x86-64, whole 1920×1080 greyscale frame:

| workload | ms/frame |
|---|---|
| QR v20 (858 B) in 1080p | **1.2** |
| QR v30 (1732 B) in 1080p | 1.6 |
| QR v40 (2953 B) in 1080p | **2.0** |
| QR v40, tryRotate+tryDownscale on | 3.2 |
| empty 1080p frame (nothing to find) | 0.6 |
| 3× channel decode (RGB-tripled v30) | 4.9 |
| **15 tiled QR v15 in one 1080p frame** | **7.8** |
| JAB Code v31 (4503 B) in 1080p, reference decoder | **113** |

Rule of thumb for translating: **WASM ≈ 1.5–2.5× native**, and a mid-range phone core
≈ 2–4× slower than this server core. So multiply by **4–8×**. 15 tiled QR codes →
**30–60 ms/frame on a phone in WASM**. That fits a 10–15 fps decode loop in a worker.
JAB Code → **450–900 ms/frame**, i.e. **1–2 fps**. That gap, not the symbology, is what
decides the recommendation.

### 6.3 Tiling is the biggest single browser-side win, and it is nearly free

Nobody's animated-QR tool does this: put **many** QR codes on the screen at once and let
zxing find them all in one pass. zxing-cpp's `read_barcodes()` returns every symbol it
finds; the marginal cost of the 15th code is far below the cost of the first.

**Max payload per 1920×1080 camera frame, tiled monochrome QR-L, blur σ=1.5 px, noise
σ=4, 4:2:0 chroma subsampling, all tiles must decode byte-exact [measured here]:**

| QR version | px/module | tiles | bytes/tile | decoded | **bytes/frame** | decode ms |
|---|---|---|---|---|---|---|
| 10 | 3 | 50 | 271 | 0/50 | 0 | 20.1 |
| **10** | **4** | **28** | **271** | **28/28** | **7588** | **6.4** |
| **15** | **4** | **15** | **520** | **15/15** | **7800** | **7.8** |
| 20 | 4 | 8 | 858 | 8/8 | 6864 | 7.0 |
| 25 | 4 | 6 | 1273 | 6/6 | 7638 | 6.3 |
| 30 | 4 | 3 | 1732 | 3/3 | 5196 | 4.8 |
| 40 | 4 | 2 | 2953 | 2/2 | 5906 | 4.7 |
| 15 | 5 | 8 | 520 | 8/8 | 4160 | 4.9 |
| 20 | 5 | 6 | 858 | 6/6 | 5148 | 5.0 |
| 40 | 5 | 2 | 2953 | 2/2 | 5906 | 16.8 |

Three things fall out:
1. **4 px/module is the cliff.** At 3 px/module *everything* fails; at 4 px/module
   everything works. The whole design should be built around holding ≥4 sensor pixels per
   module, and the UI should tell the user to move closer when it drops below that.
2. **The optimum is many medium codes, not one big one.** ~7.6–7.8 KB/frame at versions
   10–25; a single v40 gets only 5.9 KB/frame. Smaller symbols also fail *independently* —
   which, with a fountain code, converts a total frame loss into a partial one.
3. **Cost is flat.** 15 codes cost 7.8 ms, one code costs 2.0 ms. Tiling is close to free.

### 6.4 Defensible browser throughput estimates

Assumptions: 1080p30 camera, sender's code area fills most of the frame, receiver holds
still-ish, **8–12 decodable frames per second** (§5: camera at 2× display rate, minus
autofocus/exposure hunting and torn frames), and a **2–3× derate** from the clean
simulation above for perspective, rolling-shutter shear, glare and hand motion.

| # | Scheme | Bytes/frame (measured, clean) | Realistic bytes/frame | Decoded fps | **Realistic goodput** |
|---|---|---|---|---|---|
| **(a)** | **Plain QR, one code per frame** (what everyone ships today) | 2953 (v40) | 800–1500 | 6–10 | **1–9 KB/s** — matches TXQR's measured "best 9 KB/s, typically 1–2 KB/s" |
| **(a′)** | **Tiled mono QR**, v10–v20, 4 px/module, zxing-wasm in a worker | 7800 | 2500–4000 | 8–12 | **20–45 KB/s** |
| **(b)** | **Colour-channel-tripled tiled QR** (3 QR planes in R/G/B) | ~3× (a′) at 4:4:4; ~1.9× at 4:2:0 | 4500–7500 | 8–12 | **35–85 KB/s** |
| **(c)** | **Custom colour grid codec** (own geometry + RaptorQ over 8-colour cells, layered luma/chroma) | ~1.3–1.6× (b) | 6000–11000 | 8–12 | **50–130 KB/s** |
| **(d)** | **Lab SOTA, phone→phone** (SoftLight, TETRIS) | — | — | — | **~35–40 KB/s** (293–324 kb/s) |
| **(d′)** | **Lab SOTA, DSLR + 30" monitor** (PixNet) | — | — | — | **~1.5 MB/s** nominal (12 Mb/s) — *not reproducible on a phone, in a browser, or in real time* |

**Sanity check:** (a′) and (b) straddle the published phone-to-phone SOTA (d). That is the
right answer — a browser using a stock QR decoder *should* land near a decade of
purpose-built native research systems, because both are limited by the same physics
(camera resolution × usable frame rate), and the browser's handicap (post-ISP frames,
canvas readback, WASM) is roughly offset by 2026 hardware being far better than 2016
hardware. If an estimate had come out at 1 MB/s, it would have been wrong.

**Where the estimates could be wrong.** All my per-frame numbers come from a *simulated*
camera. The simulation models blur, noise, crosstalk, AWB error, tone curve, chroma
subsampling and JPEG, but not: rolling-shutter shear, real lens distortion, glare/specular
reflection off the sender's screen, PWM backlight banding, or the sender's own display
subpixel structure. Those are all *loss* terms. Treat (a′)/(b)/(c) as **upper-middle
estimates**, and verify on real hardware before promising a number in the UI.

---

## 7. Non-camera zero-network channels (worth a mention, not a plan)

- **ggwave** (<https://github.com/ggerganov/ggwave>, **MIT**): multi-frequency FSK,
  96 tones at 46.875 Hz spacing, 6 tones carrying 3 bytes at a time, Reed–Solomon.
  Audible protocols base at F0 = 1875 Hz; ultrasound at F0 = 15 kHz. Documented rate:
  **8–16 bytes/second.** Real WASM builds and browser demos exist
  (waver.ggerganov.com, ggwave-js.ggerganov.com). Excellent for a 32-byte key or a URL;
  **~1000× too slow to be a file transport.** Its real value to qrbeam would be as an
  **out-of-band control channel** — e.g. the receiver chirps "got it, stop" back at the
  sender, which is otherwise impossible on a one-way optical link.
- **quiet.js / libquiet** (<https://github.com/quiet/quiet-js>, **BSD-3-clause**, libfec
  LGPL): "ultrasonic" profile ~19 kHz "essentially imperceptible"; **cable** profiles
  reach "at least 40 kbps" but that is line-in-to-line-out, not over the air. Over-the-air
  audible profiles are on the order of a few kbps at best. Browser support is the killer:
  **Safari has no microphone support for it at all**, Firefox is limited to 16 kHz with
  "strong audio distortion", and Chrome Android is GMSK-profiles-only. Effectively
  Chrome-desktop-only. Not viable for qrbeam's "same app on both devices" constraint.
- **Chirp.io** — acquired by Sonos (2020) and the developer SDK shut down. Dead.
- **Screen brightness flicker → ambient light sensor.** The W3C
  `AmbientLightSensor` API is **"Limited availability / Experimental, not Baseline"**,
  requires a secure context *and* an explicit `ambient-light-sensor` permission, and is
  gated behind flags in Chrome for fingerprinting reasons; Safari and Firefox do not ship
  it. Even where it exists, the reading is rate-limited and quantised to lux. A screen→ALS
  link would be single-digit bits per second. **Dead end.**
- **Web Bluetooth / WebUSB / WebNFC**: Web Bluetooth and WebUSB are Chromium-only and
  absent from iOS Safari entirely (Apple has declined to implement them, citing privacy);
  WebNFC is Chrome-Android-only and read/write NDEF only. None of them work as a
  cross-platform, no-pairing, static-page transport, which is precisely qrbeam's premise.
  **All dead ends for v1.**

---

## 8. Comparison table

Bits/cell is the *raw* modulation density; "goodput" is what the source demonstrated.
"Browser?" is my assessment of implementability in a static web app in 2026.

| Scheme | bits/cell | Demonstrated goodput (hardware) | Browser? | Open impl | License |
|---|---|---|---|---|---|
| **QR (mono), 1 code/frame** | 1 | 9 KB/s best, 1–2 KB/s typical (TXQR, phone) | **Yes, today** | zxing-wasm, jsQR | Apache-2.0 / MIT |
| **QR (mono), tiled 8–28/frame** | 1 | 7.8 KB/frame measured ⇒ **20–45 KB/s est.** | **Yes** | zxing-wasm (`read_barcodes`) | Apache-2.0 |
| **RGB-channel-tripled QR** | 3 | 3× mono at 4:4:4; **1.9× at 4:2:0** [measured here] ⇒ 35–85 KB/s est. | **Yes** — 3 stock decodes/frame | zxing-wasm ×3; trivial encoder | Apache-2.0 |
| **JAB Code, 8-colour** | 3 | 4772 B/symbol; **2.41× QR/module**; but needs ≥5 px/module and **113 ms/frame** decode | **Hard** — needs a new decoder | jabcode (C), JABCodeJS (stale) | **MIT** (since 2026-04-17) |
| JAB Code, 4-colour | 2 | 3181 B/symbol; 1.6× QR/module | Hard | same | MIT |
| Aztec | 1 | 1914 B max; 0.89× QR/module but **no quiet zone** | Yes | zxing-wasm | Apache-2.0 |
| Data Matrix | 1 | 1556 B max; 0.80× QR/module | Yes | zxing-wasm | Apache-2.0 |
| Han Xin | 1 | 3261 B max; 0.97× QR/module | Partly (zint encodes) | zint | BSD-3 |
| PDF417 / MaxiCode | 1 | ≪ QR | Yes | zxing-wasm | Apache-2.0 |
| HCCB / Microsoft Tag | 2–3 | 3500 char/in² (print, lab) | No | none maintained | proprietary, **service dead 2015** |
| Custom 8-colour grid + RaptorQ | 3 | — (est. 50–130 KB/s) | **Hard but possible** | none | you write it |
| **PixNet** (2-D OFDM) | 1 (green only) | **12 Mb/s @ 10 m** (30" LCD → 24 MP DSLR, nominal) | **No** — needs FFT over a machine-vision frame + DSLR | none public | — |
| COBRA | ~2.3 (5 colours) | 64–98% frame decode (phone→phone) | No | none public | — |
| RDCode | colour | ≥2× COBRA, 10% error rate | No | none public | — |
| RainBar | colour | > COBRA/RDCode at range | No | none public | — |
| Strata | layered | *lower* peak capacity, wider range | No | none public | — |
| **SoftLight** | colour + soft hints | **293 kb/s (36.7 KB/s), phone→phone**, rateless | No | none public | — |
| **TETRIS** | colour | **311 kb/s @ 90%**, phone→phone | No | none public | — |
| ChromaCode | CIELAB ΔL | 777 kb/s raw / **120 kb/s goodput**, 120 Hz monitor → Nexus 6P | No (needs 120 Hz + 120 fps capture) | none public | — |
| InFrame++ | complementary frames | 150–360 kb/s @ 120 fps | No | none public | — |
| HiLight | alpha channel | ~1–10 kb/s | No | none public | — |
| DeepLight | CNN decode | 0.95–11.2 kb/s | No (model too heavy) | none public | — |
| DisCo | rolling-shutter flicker | imperceptible, robust | No | none public | — |
| ggwave (audio) | — | **8–16 bytes/s** | **Yes** (WASM) | ggwave | **MIT** |
| quiet.js (audio) | — | few kb/s over air; 40 kb/s over cable | Chrome-desktop only | quiet-js | BSD-3 |
| Ambient light sensor | — | single-digit bits/s | No (API gated/absent) | — | — |

---

## 9. Reproducing the measurements

All original numbers above came from these steps, run on this machine:

1. **Build JAB Code.** `git clone https://github.com/jabcode/jabcode`, `make` in
   `src/jabcode`, then `make CFLAGS="-O2 -no-pie"` in `src/jabcodeWriter` and
   `src/jabcodeReader` (the bundled `libtiff.a` is not PIE, hence `-no-pie`).
2. **Python env:** `segno` (QR encoder), `zxing-cpp` (the *same* engine as `zxing-wasm`,
   so decoder behaviour transfers), `pillow`, `numpy`.
3. **Camera model** (used identically for every scheme): sRGB → linear light → 3×3
   crosstalk matrix (9–10% inter-primary leakage, row-normalised) → per-channel AWB gain
   error N(1, 0.03) → back to sRGB → Gaussian blur (σ in *sensor pixels*) → additive
   Gaussian sensor noise → optional 4:2:2 / 4:2:0 chroma subsampling in BT.601 YCbCr →
   optional JPEG. Symbols are padded into a neutral frame before blurring (JAB's decoder
   fails outright without a quiet zone).
4. **Success criterion** is always *byte-exact* payload recovery, 3–5 independent trials,
   worst trial reported.

Caveats to carry forward: the model has no rolling-shutter shear, no lens distortion, no
glare, no PWM banding, and assumes the receiver is roughly fronto-parallel. Real-world
numbers will be lower. Re-run this against real phone captures before the plan commits to
a throughput figure.

---

## 10. Recommendations for qrbeam

### Should qrbeam use QR at all?

**Yes — QR stays the wire format, but the current plan under-uses it by ~10×.**

The reason is not that QR is the densest symbology (JAB Code is 2.4× denser per module,
and a custom colour grid would be denser still). It is that **on this channel the binding
constraint is not symbology density — it is decoder robustness and decoder CPU**, and QR
wins both by an enormous margin:

- zxing-cpp decodes QR at **3 px/module**; the JAB reference decoder cannot decode at 3
  px/module *even on a clean synthetic image*, and needs 5 px/module in practice.
- zxing-cpp costs **2.0 ms** per 1080p frame; the JAB reference decoder costs **113 ms**.
  In WASM on a phone that is the difference between 15 fps and 1 fps.
- zxing-wasm returns `bytes: Uint8Array`, satisfying the concept note's non-negotiable
  binary-safety constraint, and it is Apache-2.0.
- QR gives an **erasure** channel (a symbol decodes correctly or not at all), which is
  exactly the assumption the qrbeam concept note already builds the fountain code on.
  A colour symbology with a single LDPC block over the whole symbol does *not* give you
  that cleanly.

The 10× that is being left on the table is **tiling** and then **colour**.

### Staged recommendation

**Stage 1 — ship this. Tiled monochrome QR + fountain code. (No new decoder risk.)**
- Render **N QR codes per frame**, not one. Target **QR version 10–20 at ECC level L**,
  laid out in a grid that fills the sender's display. Measured optimum: 15 × v15
  (520 B each) or 28 × v10 (271 B each) ⇒ **~7.6–7.8 KB per camera frame**.
- Decode with `zxing-wasm` (`readBarcodes`, all symbols per frame, `bytes` output) **in a
  Web Worker**, fed by `requestVideoFrameCallback` + `MediaStreamTrackProcessor`.
- Each QR is one **fountain-coded packet** with a short header (packet id, file id).
  Whether 3 or 15 of the tiles decode in a given frame simply doesn't matter — that is
  the whole point of the rateless design.
- Display at **≤ half the camera frame rate** (PixNet's rule) — so 12–15 fps against a
  30 fps camera. Do not animate faster; you will only produce torn frames.
- Keep **every frame DC-balanced** (constant mean luminance) so auto-exposure stops
  hunting. Cheap; measurable win.
- **Expected: 20–45 KB/s.** That is 5–20× the 1–9 KB/s that TXQR measured, using nothing
  more exotic than a stock decoder called once per frame.
- Show the user a live **px/module estimate** and a "move closer / hold still" prompt.
  4 px/module is a cliff, not a slope — the UI should defend it.

**Stage 2 — the colour layer. RGB-channel-tripled tiled QR.**
- Render **three independent tiled QR grids**, one into each of R, G and B. The receiver
  splits channels, normalises each (2nd/98th percentile stretch), and runs the *same*
  zxing decoder three times. No new symbology, no new decoder, no new failure mode —
  each plane is an independent erasure channel and the fountain code absorbs the rest.
- Cost: 3× decode CPU (measured 4.9 ms native for 3 planes at v30; ~20–40 ms in WASM on a
  phone — still inside a 12 fps budget in a worker).
- **Measure the chroma penalty on the target device first.** The gain is 3× if you get
  4:4:4 frames and ~1.9× if the path is 4:2:0. Detect it at runtime by sending a
  calibration frame with a fine chroma checkerboard and measuring the recovered contrast;
  then pick the module size accordingly (4 px/module mono, 5 px/module colour).
- Prefer **saturated primaries** (the RGB corners of the cube). §4 shows those are as
  robust as black/white at ≥4 px/module. Do *not* use intermediate levels.
- **Expected: 35–85 KB/s.**

**Stage 3 — optional, only if measurement justifies it. Custom colour grid codec.**
- Drop QR entirely: an explicit fiducial border + dense alignment dots, homography +
  per-cell sampling, an **8-colour saturated constellation**, and **RaptorQ directly over
  the symbol stream** (no inner Reed–Solomon). This is the SoftLight architecture with
  2026 hardware.
- Under 4:2:0 use the **layered luma/chroma** design from §4.5: 1 bit/cell of luma at the
  fine pitch, 2 bits/cell of chroma at 2× coarser pitch ⇒ 1.5 bits per fine cell with no
  chroma-resolution violation.
- **Expected: 50–130 KB/s**, at the cost of owning a geometry pipeline and a decoder you
  must debug against dozens of real phone cameras. Only worth it if Stage 2 measurements
  show the ISP is not already the limit.

### Things to explicitly *not* do

- **Do not use JAB Code as the v1 wire format.** The MIT relicense (2026-04-17) makes it
  legally attractive and it is a genuinely good symbology — but the reference decoder is
  40–50× too slow and needs 25% more pixels per module. Revisit only if someone writes a
  fast, blur-tolerant JAB decoder. (If qrbeam ever *does* want a colour symbology with a
  spec behind it, JAB Code is now the one to pick — it is ISO-standardised and MIT.)
- **Do not use `BarcodeDetector`.** It returns only a string, which violates the
  binary-safety constraint, and it is absent from iOS Safari and Firefox.
- **Do not build multi-level grayscale.** §4 measures it as strictly worse than colour at
  the same bit rate, and much worse than binary luma at low pixel counts.
- **Do not chase the imperceptible-watermark literature** (HiLight, InFrame++,
  ChromaCode, DeepLight). Those systems pay 10–100× in throughput for invisibility that
  qrbeam does not need.
- **Do not quote PixNet's 12 Mb/s** as a target. It is a DSLR, a 30-inch monitor, and a
  nominal bits-per-still figure.
- **Do not plan for a ≥30 fps decode loop.** The camera must run at ≥2× the display rate,
  so the display is capped at ~15 fps and realistic decode is 8–12 fps.

### One cheap idea worth stealing

The optical link is strictly one-way, which the concept note correctly identifies as the
hard constraint. **ggwave (MIT, WASM, 8–16 bytes/s) is a viable back-channel.** 16 bytes
is enough for "I have 94% of the blocks" or "stop, I'm done" — which would let the sender
show a real progress bar and terminate cleanly, without breaking the "no network"
guarantee. It costs one small WASM module and no server. Worth prototyping as an optional
enhancement once Stage 1 works.

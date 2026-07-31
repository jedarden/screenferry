# Custom Optical Codec — Receiver-Side Engineering Feasibility

**Question:** can qrbeam replace QR with a custom screen→camera codec, and decode it in a
browser, in real time, handheld, on a mid-range phone?

**Short answer:** yes, and it has already been done — but not by anyone using a naive
"read pixels, threshold, done" pipeline. Everything below is organised around one
existence proof and the engineering constraints it implies.

**The seven findings that actually change the design:**

1. **A browser receiver for a custom screen→camera codec already exists and is fast.**
   libcimbar's WASM decoder does 6 bits/cell at ~106 KB/s, decoded on a 2016 mid-range SoC
   (§0). Feasibility is not the question.
2. **4:2:0 is mandatory, not incidental.** Chrome converts camera frames to NV12/I420 *even
   when the sensor could give it more* (§3.1). Chroma arrives at quarter resolution, on top
   of the Bayer CFA's already-halved chroma. **Put all data in luma** — the arithmetic says
   luma-only beats colour by ~1.95× in bits per camera pixel (§7.2).
3. **Gamma is a red herring; flare is the real enemy.** Display EOTF and camera OETF
   largely cancel, so even spacing in sRGB code value is *correct*. But 2% additive flare
   shrinks the bottom level gap by **2.6×** (§3.3). Lift the black level off zero.
4. **Do not model the channel — measure it, every frame.** An in-band level ramp plus
   reference columns down both edges inverts *any* monotone distortion exactly, and cancels
   DisCo's row-only gain `g(y)` — rolling-shutter tear gain, OLED PWM banding, vignetting
   and AE drift, all with one mechanism (§3.2).
5. **Exposure time, not readout time, decides whether frames are usable** (§3.5). If
   `T_e > T_r` there is no tear at all — the whole frame is an irreversible *blend*, which
   is worse. A bright screen filling the camera frame drives AE to ~1/500 s and fixes this
   for free. This single UX factor is worth up to **2.4×** in throughput.
6. **Budget the miss path, not the hit path.** Most frames contain nothing decodable, and
   jsQR's failure cost blows up **79×** on textured input (§5.5). Cap candidates before
   scoring.
7. **2 bits/cell is the defensible target.** libcimbar shipped 8 colours and then
   *deprecated* it despite it being measurably faster; 16 colours "does not seem possible"
   (§7.1). Build the calibration machinery that would let you reach 4 bits, and let
   measurement decide.

**Status of evidence.** Every claim below is tagged:

- **[CODE]** / **[SRC]** — read from working source, verifiable.
- **[MEASURED]** / **[MEAS]** — a number someone published from a real run.
- **[SPEC]** — a standards/API guarantee.
- **[LAB]** — a paper's number, usually tripod-mounted under controlled lighting. Treat
  as an optimistic upper bound.
- **[DERIVED]** — arithmetic done here from the above. Shown so it can be checked.
- **[WEAK]** — vendor claim, folklore, or a single unverified snippet. Hypothesis only.

---

## 0. The existence proof: libcimbar

Before any theory: **a custom screen→camera codec with a browser (WASM) receiver already
exists, ships, and is fast.** [libcimbar](https://github.com/sz3/libcimbar) ("colour-icon-matrix
barcode", MPL-2.0, C++/OpenCV → Emscripten) is the single most valuable artefact for this
project. Everything qrbeam wants to do, it does.

Headline numbers, from
[PERFORMANCE.md](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md) **[MEASURED]**:

| Mode | Cell | Bits/cell | Payload/frame | Throughput |
|---|---|---|---|---|
| B (default) | 8×8 px, 4 symbol + 2 colour bits | 6 | ~7,500 B after ECC | 4,689,084 B in 44 s → **852 kbit/s (~106 KB/s)** |
| 4C (legacy) | 8×8, 4+2 | 6 | ~7,500 B | 838 kbit/s (~104 KB/s) |
| 8C (**deprecated**) | 8×8, 4+3 | 7 | ~8,750 B | 943 kbit/s (~118 KB/s) |
| S (beta) | 5×5, 2 symbol + 2 colour | 4 | — | "safely >1 Mbit/s", WIP |
| mono | 8×8, 4+0 | 4 | ~5,000 B | — |

Decoder hardware in that benchmark: a **Qualcomm Snapdragon 625** (2016 mid-range,
8×Cortex-A53 @2.0 GHz), 4 threads. That is *below* the "mid-range phone in 2026" bar. The
sender was the cimbar.org WASM encoder.

Grid geometry, from
[`GridConf.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/GridConf.h) **[CODE]**:

```
Conf8x8 (mode B):   image 1024×1024, cell_size 8, cell_spacing 9  (1 px guard band)
                    112×112 cells, minus 4 corner exclusion zones → 12,400 data cells
                    12,400 × 6 bits / 8 = 9,300 B raw; RS(155,125) → 7,500 B payload
Conf5x5 (mode S):   image  988×988,  cell_size 5, cell_spacing 6
                    162×162 cells, 4 bits/cell
Conf8x8_mini:       image 1024×720,  112×78 cells   (16:9-ish sender)
```

Note `cell_spacing = cell_size + 1`: **there is a one-pixel dead gutter between every
pair of cells.** That is not decoration; it is the anti-bleed guard band, and the decoder
samples only the *interior* — `Cell(_image, pos.x+1, pos.y+1, cell_size-2, cell_size-2)`,
i.e. the middle 6×6 of an 8×8 cell **[CODE]**.

The rest of this document is largely "what libcimbar does, why, and what qrbeam should do
differently."

---

## 1. Fiducial and frame detection

### 1.1 What the candidates actually cost

| Scheme | Detection primitive | Cost profile | Occlusion | Glare | Sub-pixel accuracy |
|---|---|---|---|---|---|
| **QR-style finder patterns** (3 nested squares) | 1-D run-length ratio scan along rows, then confirm on column/diagonal | **Cheapest.** O(W·H) worst case but with row skipping it's O(W·H/skip). No contour memory, no allocation. | Good — 3 independent patterns, lose one and you can still fit a quad if you also track edges | Good — ratio test is scale- and brightness-invariant, works off a binary image | Poor natively (~±1 px centroid); needs an edge-chase refinement pass |
| **ArUco / AprilTag** | adaptive threshold → connected components / contour trace → polygon approx → quad filter → homography → bit sample → Hamming decode | Moderate. Contour tracing allocates and is branchy; the quad filter is the expensive part | Excellent for *which* marker, poor for a big rectangle: you need ≥4 markers and lose the frame if one is occluded | Moderate — adaptive threshold copes, but a specular blob inside a marker kills its ID | Good (AprilTag does line-fit edge refinement → ~0.1 px) |
| **Solid border quad + contour** | threshold → findContours → approxPolyDP → pick largest 4-gon | Moderate-to-slow in JS; `findContours` is the classic OpenCV.js hot spot | **Worst.** A single occluded corner destroys the quad | Poor — a glare band across the border splits the contour | Moderate after line fitting |
| **Checkerboard / Deltille corners** | saddle-point response filter over the whole image, then non-max suppression, then lattice growth | Most expensive per frame; but the *most accurate* | **Best** — every interior corner is an independent constraint; occlusion just removes some | Best — saddle response is a local differential feature, immune to global illumination | **Best.** Saddle refinement gives ~0.05 px |

### 1.2 Why Deltille uses triangles

[Ha et al., ICCV 2017, *Deltille Grids for Geometric Camera Calibration*](https://ieeexplore.ieee.org/document/8237833)
**[LAB]**: a triangular (deltille) tiling puts **three** intersecting lines through every
lattice point instead of two, which the paper measures as a **~10% improvement in
per-corner localisation accuracy** over a square checkerboard, and it is the highest-precision
tiling of the Euclidean plane for this purpose. The detector finds *monkey saddle* points
(third-order saddles) rather than ordinary saddles.

**Verdict for qrbeam: do not use Deltille.** The 10% accuracy gain is aimed at camera
*calibration*, where you sub-pixel-fit a few dozen corners offline and care about the
fourth decimal place. qrbeam needs ~0.3 px accuracy over a 1000-px span, in 33 ms, and a
triangular lattice makes the *payload* grid triangular too, which complicates everything
downstream (cell addressing, interleaving, guard bands) for no throughput gain. Interesting,
not applicable.

### 1.3 What libcimbar actually does — and it is the right answer

[`ScanState.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/extractor/ScanState.h)
+ [`Scanner.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/extractor/Scanner.h) **[CODE]**:

1. **Preprocess:** grayscale → Gaussian blur (kernel = next-power-of-two-plus-one of
   `0.002 × min(w,h)`, so ~5 px at 1080p) → threshold. Two threshold paths:
   - `threshold_fast`: **Otsu global threshold**. This is the default (`fast=true`).
   - `threshold_adaptive`: `adaptiveThreshold(MEAN_C, blockSize = nextPow2+1(0.05·min(w,h)), C = -10)`
     — a ~65 px block at 1080p. Used only as fallback.

   That global-Otsu default is worth noting: for a *screen* subject (bright, high-contrast,
   roughly uniform illumination) a global threshold is enough, and it is far cheaper than
   adaptive.

2. **Scan:** a 6-state run-length machine over rows, skipping `min(h,w)/60` rows (18 rows
   at 1080p → only ~60 rows scanned). Two ratio templates:
   - `ScanState_114` — centre run 3–6× each flanking run (a 1:1:4:1:1-ish nested square)
   - `ScanState_122` — a 1:2:2:2:1-ish variant

   Ratio tests are on `center/tally[i]` with ±1 slack, so they're robust to blur and scale.

3. **Confirm:** for each row hit, scan the column through it, then both diagonals, then a
   final confirm pass. Deduplicate, filter, sort top-to-bottom.

4. **Fourth corner:** only *three* anchors are drawn (like QR). `add_bottom_right_corner()`
   triangulates the fourth from the other three, then `scan_edges()` **chases the actual
   edges** of the code region and returns midpoints — which are then used to correct for
   lens/perspective curvature rather than trusting a pure 4-point homography.

**Recommendation for qrbeam:** copy this. Run-length ratio scanning on a *sparsely sampled*
set of rows is the cheapest reliable rectangle finder that exists, it is scale-invariant,
it needs no contour library, and it is exactly what jsQR/ZXing already do — so the
algorithm is well-trodden and there is reference code in JS.

**But add a fourth anchor.** libcimbar's own author found in the wild that a **mouse cursor
sitting on one corner pattern** silently destroyed throughput
([HN thread](https://news.ycombinator.com/item?id=25459501)) **[MEASURED, anecdotal]**, and
that "failure to detect the corner pattern" is the dominant real-world failure mode. With
four anchors you can drop any one and still solve the homography, and you get a consistency
check for free. The cost is one more anchor's worth of area (~0.3% of the frame).

### 1.4 Glare and occlusion, concretely

- **Glare** on a screen is a specular reflection of a light source — a bright blob, usually
  a few percent of the frame, that saturates to 255. It destroys *cells*, not the geometry,
  provided your anchors aren't under it. Mitigation is at the coding layer (erasure/ECC),
  not the vision layer. Reserve enough ECC to lose a contiguous ~10% blob.
- **Occlusion** of an anchor is fatal to a 3-anchor scheme and survivable with 4.
- **Both** argue for spatial interleaving of ECC blocks (libcimbar does this explicitly via
  `Interleave.h` — "skip over N cells" so an ECC codeword's bytes are scattered across the
  frame, converting a burst-in-space into isolated errors) **[CODE]**.

---

## 2. Perspective correction: warp-then-sample vs sample-in-place

### 2.1 The two options

**(a) Warp the whole image** — `getPerspectiveTransform(4 corners)` then `warpPerspective`
to a canonical N×N buffer, then read cells at fixed integer offsets.

**(b) Sample in place** — compute the homography, then for each cell compute its centre in
source coordinates and read/average there.

### 2.2 Cost

Let the code region be `S×S` canonical pixels (libcimbar: 1024) and let there be `C×C`
cells with `k×k` sampled pixels per cell.

| | Work | At S=1024, C=112, k=6 |
|---|---|---|
| (a) warp + sample | `S²` bilinear samples for the warp, then `C²·k²` reads of the warped buffer | 1,048,576 warp taps + 403,200 reads = **~1.45 M ops** |
| (b) sample in place | `C²·k²` homography evaluations + bilinear taps | 403,200 taps, but each needs a projective divide | **~0.40 M taps + 12,544 divides** |

So (b) is nominally ~3.5× less arithmetic. **But:**

- The warp in (a) is a *perfectly regular, cache-coherent, SIMD-friendly, GPU-trivial*
  operation. Every output pixel is independent and the source access pattern is a smooth
  affine-ish sweep. OpenCV's `warpPerspective` is heavily optimised and is one shader call
  on a GPU.
- The sampling in (b) is a *scattered gather* over a 2 MP source image. At 112×112 cells
  spread over ~1000 px, consecutive cells are ~9 px apart — you touch a new cache line
  every cell, and every row of every cell. In JS with a `Uint8ClampedArray` this is
  murder on the cache and defeats any auto-vectorisation.
- (a) also gives you a canonical image you can run *other* things on cheaply: the
  adaptive-threshold pass for symbol decoding, the per-cell drift search, debug rendering.

**libcimbar chose (a)** — `Deskewer::deskew()` does `getPerspectiveTransform` +
`warpPerspective(..., INTER_LINEAR)` into a 1024×1024 buffer, and everything downstream
reads that buffer **[CODE]**.

**Recommendation for qrbeam: (a), and do the warp on the GPU** (see §5). The moment the
warp is a fragment shader, (a) is free and the argument is over. Even on the CPU, (a) is
the better engineering choice because it converts a random-access problem into a streaming
one.

There is a third option worth naming:

**(c) Warp *and reduce* in one pass** — render the warp with the output resolution set to
one texel *per cell* (C×C, not S×S), with the fragment shader doing the k×k box average
internally. This is (a) with the sampling folded in, and it makes the GPU readback tiny
(112×112×4 = 50 KB instead of 4 MB). This is the design qrbeam should target. See §5.4.

### 2.3 Sub-pixel and interpolation concerns

Three real ones:

1. **A 4-point homography is not accurate enough across a large grid.** Phone cameras have
   real radial distortion (a wide-angle main camera is typically 1–3% barrel at the edges),
   and a screen is not perfectly flat, and your corner estimates have ~0.5 px error. Over a
   1000 px span, a 0.3% residual is 3 px — a third of a cell.

   libcimbar's answer is instructive and pragmatic: **per-cell drift.**
   [`CellDrift.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CellDrift.h)
   allows each cell's sample point to wander up to **±7 px** from its nominal position; at
   each cell the decoder tries the 3×3 neighbourhood of offsets, picks the one with the best
   symbol match, and propagates that drift to neighbouring cells via a confidence-ordered
   flood fill (`FloodDecodePositions`) **[CODE]**. It also runs `scan_edges()` and
   `SimpleCameraCalibration`/`Undistort` to pre-correct lens distortion.

   For qrbeam the cheaper equivalent is: **put registration marks inside the grid**, not
   just at the corners — e.g. a known cell pattern every 16 cells — and fit a
   piecewise-bilinear correction on top of the global homography. That is essentially what
   QR's alignment patterns are for, and it's why large QR versions have many of them.

2. **Interpolation.** Use bilinear for the warp. Nearest-neighbour aliases badly against
   the screen pixel grid (see §3.4) and bicubic overshoots at cell edges, creating ringing
   that shifts your measured levels. Bilinear over a k×k interior box-average is
   effectively a low-pass that suppresses the screen grid — which you want.

3. **Never sample the cell edge.** Camera blur + display pixel response + JPEG-ish ISP
   sharpening all smear energy across cell boundaries. Sample the interior only. libcimbar
   samples 6×6 of an 8×8 cell that already has a 1 px gutter — so it discards **56% of the
   cell area** to get a clean measurement. That is the correct trade.

---

## 3. The camera pipeline is the enemy

This section is the crux. The sender controls the emitted photons exactly; between there
and your `Uint8Array` sit a lens, a Bayer CFA, an auto-exposure loop, an auto-white-balance
loop, a demosaic, a denoiser, a sharpener, a tone curve, a chroma subsampler, and a
colour-space conversion. Every one of them is trying to make a *pretty picture*, not
preserve your data.

### 3.1 Are `getUserMedia` frames compressed? — resolved definitively

**No codec. But 4:2:0 is mandatory, and it is worse than "the camera happens to give you
4:2:0" — Chrome throws away extra chroma even when the sensor could provide it.**

- **[SPEC]** The Media Capture spec deliberately declines to define a wire format: track data
  *"does not necessarily have a canonical binary form… allowing user agents to manipulate
  media in whatever fashion is most suitable on the user's platform"*
  ([spec](https://mozilla.github.io/webrtc-w3c/getusermedia.html)). No codec is involved for
  a local preview — compression enters only via `MediaRecorder` or `RTCPeerConnection`. But
  "no codec" ≠ "raw".
- **[SRC] The decisive quote.** Dale Curtis (Chromium media), on `media-dev`, answering
  someone who wanted YUV444/RGB24 capture:
  > *"We only support capture in NV12/I420 formats at this time — I think we'll even convert
  > to I420/NV12 if the camera serves us something else."* … *"I don't think there's even any
  > way to specify the desired capture pixel format."*
  ([thread](https://groups.google.com/a/chromium.org/g/media-dev/c/qFmr-Y62ePI))
  **Even if your camera hardware can hand over YUY2 (4:2:2) or RGB, Chrome decimates it to
  4:2:0 at the capture stage.** Corroborated in Chrome's Android backend, which requests
  `ImageFormat.YUV_420_888`
  ([`VideoCaptureCamera2.java`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java)).
- **[SPEC]** WebCodecs `VideoFrame.format` confirms what those mean: `I420`/`NV12` are
  **4:2:0** — full-resolution luma, chroma decimated 2× in *both* axes
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/format)).
- **[CODE]** libcimbar's browser receiver declares
  `_supportedFormats = ["NV12", "I420"]` with a native WASM path for exactly those two,
  falling back to `copyTo(buf, {format:"RGBA"})` otherwise
  ([`recv.js`](https://github.com/sz3/libcimbar/blob/master/web/recv.js)) — independent
  confirmation from shipping code.
- **[SPEC]** `VideoFrame.copyTo()` can convert to `RGBA/RGBX/BGRA/BGRX` only — never
  between YUV formats
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/copyTo)). The only
  conversion on offer is the one that costs a chroma upsample.
- ⚠️ **iOS Safari's camera `VideoFrame.format` is unverified.** `MediaStreamTrackProcessor`
  is supported on iOS 18+ (worker-only, video-only), and AVFoundation's conventional default
  is `420YpCbCr8BiPlanarVideoRange` (NV12, **video range**) — so 4:2:0 is the strong prior,
  but **this must be probed on a real device** (§10.5).

**Also: assume limited (video) range.** The recurring "canvas `drawImage` of a video shows
shifted colours" class of Chromium bug is consistently diagnosed as **Y ∈ [16,235] vs
[0,255]** ([background](https://www.mpegflow.com/topics/color/limited-vs-full-range))
**[WEAK — community diagnosis, primary bug reports are behind a Google auth wall]**. In
itself that's only 220/256 of the code space (~0.22 bits). It is catastrophic *only* if the
decoder hard-codes 0 and 255 as anchors — which is exactly why the calibration references in
§3.2 must be transmitted levels you measure, not assumed extremes.

**And `colorSpaceConversion: "none"` does not save you.** It means *"ignore colour profile
metadata embedded in the source data as well as the display device colour profile"*
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap)) — i.e.
it is about **ICC profiles and primaries**, not format conversion. YUV→RGB and chroma
upsampling happen regardless. Set it anyway to remove a variable; don't expect it to
preserve chroma detail.

**Implications, in order of importance:**

1. **Luma is full resolution. Chroma is quarter resolution (half in each axis).** A colour
   cell therefore needs **at least twice** the camera pixels of a luma cell to carry the
   same reliability. This is a hard, non-negotiable, spec-level constraint and it is the
   single most important number in this document.
2. `drawImage(video)` → 2D canvas performs YUV→RGB *with chroma upsampling*, which
   **invents** chroma detail by interpolation. Fine colour edges get smeared across
   2-pixel neighbourhoods. You cannot recover what 4:2:0 threw away, but you can avoid
   *compounding* it by reading the planes directly.
3. **Read the planes yourself.** Use `new VideoFrame(videoEl)` → `copyTo()` with no format
   override, get NV12/I420, and treat the **Y plane as your primary signal**. That gives
   you a full-resolution grayscale image for free, with zero conversion cost, and you only
   touch the UV planes for the colour bits. libcimbar does exactly this.
4. There is **no lossy codec** in the local capture path — no VP8/H.264 round trip for a
   local `getUserMedia` stream. (That only appears if you route through an
   `RTCPeerConnection`.) So block artefacts are not a concern; only 4:2:0 and the ISP are.
5. **The 4:2:0 decimation is the *second* one — the Bayer CFA already halved chroma.** A
   Bayer CFA is 2×2 with one red, two green, one blue, so R and B are each sampled on a
   checkerboard at **half the linear rate** of luma
   ([Bayer filter](https://en.wikipedia.org/wiki/Bayer_filter)). Dubois et al. give the
   frequency-domain statement precisely: the CFA signal decomposes as luma at baseband plus
   two chroma components **modulated onto carriers at the Nyquist corners (0.5, 0.5) and
   edges (0.5, 0) / (0, 0.5) cycles/pixel**
   ([TIP paper, §II.A](https://site.uottawa.ca/~edubois/lslcd/article/TIP-06195-2010.R1_2col.pdf))
   — i.e. **the sensor's native chroma Nyquist is ~0.25 c/px against luma's 0.5.**
   Stack the capture path's 4:2:0 on top and **colour detail needs roughly 4× the linear
   cell size of luma detail for equal fidelity [DERIVED]**. Quad-Bayer (2×2 same-colour
   groups) and Nonacell (3×3) make binned modes worse again.
   And **phone cameras generally omit the optical low-pass filter** that DSLRs use to
   suppress exactly this aliasing — maximum sharpness, maximum moiré, no protection.
6. **ISP edge enhancement actively corrupts cell boundaries.** Chrome hands
   `CONTROL_AE_MODE_ON`/`CONTROL_AWB_MODE_AUTO` to Camera2 and exposes **none** of
   `EDGE_MODE`, `NOISE_REDUCTION_MODE` or `TONEMAP_MODE` to the web **[SRC]**. The HAL's
   sharpening kernel produces overshoot/ringing at every high-contrast edge. This is the
   hard technical reason for the guard band and interior-only sampling of §2.3 — the
   boundary pixels are not merely blurred, they are *wrong*, with a sign that depends on the
   neighbouring cell.

### 3.2 Auto white balance and auto exposure

**Can you lock them?** Partially, and unreliably.

- **[SPEC]** The MediaStream **Image Capture** extension (not core getUserMedia) defines
  `MeteringMode = {none, manual, single-shot, continuous}` and the constrainable properties
  `exposureMode`, `exposureCompensation`, `exposureTime`, `iso`, `whiteBalanceMode`,
  `colorTemperature`, `focusMode`, `focusDistance`, `brightness`, `contrast`, `saturation`,
  `sharpness`, `zoom`, `torch` ([W3C](https://www.w3.org/TR/image-capture/)).
  Two units gotchas: **`exposureTime` is in 100 µs units** (*"a value of 1.0 means 1/10000 s
  and 10000.0 means 1 second"*) — so 1/500 s is `20.0`; and `iso` follows ISO 12232.

- **Chrome Android: the plumbing is genuinely there, but gated on device capability.**
  `VideoCaptureCamera2.java` really does set `CONTROL_AE_MODE_OFF` + `SENSOR_EXPOSURE_TIME`
  + `SENSOR_SENSITIVITY` for manual exposure, and `CONTROL_AWB_MODE_OFF` for manual white
  balance **[SRC]**. But `"manual"` is only advertised in `getCapabilities()` when the HAL
  reports `CONTROL_AE_LOCK_AVAILABLE`:
  ```java
  Boolean aeLockAvailable = cameraCharacteristics.get(CameraCharacteristics.CONTROL_AE_LOCK_AVAILABLE);
  if (aeLockAvailable != null && aeLockAvailable.booleanValue())
      exposureModes.add(Integer.valueOf(AndroidMeteringMode.FIXED));
  ```
  On many mid-range Androids, and on any `LEGACY`-level HAL, it doesn't — so
  `applyConstraints` rejects. The W3C explainer is candid that these exist only *"if there
  is support in the target platform."*

- **Safari/iOS: essentially nothing.** The set WebKit has publicly shipped is **`torch`,
  `zoom`, `whiteBalanceMode`**. Safari 17.4 added *one* property — *"WebKit for Safari 17.4
  adds support `whiteBalanceMode` to MediaStream"*
  ([WebKit](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)); Safari 18.4
  added the Image Capture API and fixed `getSettings()` *"returning a stale value for
  `torch` and `whiteBalanceMode`"*
  ([WebKit](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)). **No evidence
  that `exposureTime`, `iso`, or `exposureMode: "manual"` work on iOS Safari at all.**

- libcimbar asks only for `exposureMode: 'continuous'` and `focusMode: 'continuous'` — it
  *gives up on locking* and asks for the well-behaved auto modes **[CODE]**.

**Therefore: design as if you cannot lock anything.** Try, verify, and degrade:

```js
const caps = track.getCapabilities();
if (caps.exposureMode?.includes('manual') && caps.exposureTime) {
  await track.applyConstraints({ advanced: [{ exposureMode:'manual', exposureTime: 20 }] });
}                                             // 20 × 100µs = 2 ms = 1/500 s
console.log(track.getSettings());             // verify — do NOT trust that it took
```

The receiver must be invariant to a per-frame unknown exposure gain and a per-frame unknown
white-balance matrix.

**How much do they actually drift?** ⚠️ **This is the weakest-evidenced point in the
document.** No published measurement of frame-to-frame AWB/AE drift for a phone filming a
screen appears to exist. Imatest documents *methodology* for AWB rise/settling time (10–90%
of CCT change; settling to ±5% of mean CCT) but explicitly notes it *"does not provide
information about the accuracy or precision of auto white balance"* and gives **no typical
magnitudes**; their advice to capture "1–2 seconds" of settling implies AWB transients live
on the order of **seconds, not frames**
([Imatest](https://www.imatest.com/docs/auto-white-balance/)) **[MEAS-methodology, no
numbers]**. The one useful indirect datum: HiLight's receiver **filters out all frequency
components below 15 Hz** before demodulating, *"to reduce the impact of ambient light
noise"* **[LAB]** — a strong hint that AE/AWB disturbance is a sub-15 Hz phenomenon that
reference-normalisation or high-passing removes. That is an inference from someone's filter
design, not a measurement of the drift.

**How reference cells fix this — and how many you need.**

libcimbar shows two generations of the idea:

- *Generation 1* (`simpleColorCorrection`): sample a **4×4 px patch at the inner corner of
  each of the 3 anchors**, take the per-channel max across them as "white", then build a
  **von Kries chromatic adaptation matrix** mapping that white to (255,255,255)
  ([`CimbReader.cpp`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CimbReader.cpp))
  **[CODE]**. Three white references, one global 3×3 matrix.
- *Generation 2* (`init_ccm`, the current default): the fountain-code **header bytes are
  repeated at known intervals throughout the frame**. Once the header is known, the decoder
  knows the *expected colour index* of those cells, measures their actual RGB, and solves a
  least-squares **3×3 colour correction matrix** from measured→expected, requiring ≥4
  distinct colours observed **[CODE]**. This is calibration from redundant known payload —
  no dedicated calibration cells at all.

Plus a per-cell normalisation that is arguably the cleverest bit
([`CimbDecoder.cpp`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CimbDecoder.cpp))
**[CODE]**:

```cpp
// colours are compared in a *relative* space, not absolute RGB
relative_color(r,g,b) = { r-g, g-b, b-r }
// and each cell is auto-levelled before comparison
float max = std::max({r, g, b, 1.0f});
float min = std::min({r, g, b, BEST_COLOR_FLOOR /* 48 */});
float adjust = 255.0/(max - min);
```

`{r−g, g−b, b−r}` is invariant to any *achromatic* gain/offset — i.e. immune to exposure
drift entirely, and immune to white-balance drift to first order. Then a per-cell
max/min stretch removes what's left.

**qrbeam's answer should be stronger than libcimbar's**, because qrbeam is not chasing
100 KB/s and can afford the area:

> **Transmit the palette in-band, every frame, at multiple spatial sites.**
>
> Reserve a **calibration ring**: a border of cells, one cell wide, cycling through all `L`
> palette entries plus black and white, all the way round the frame. Cost for a 96×96 grid:
> `4×96 − 4 = 380` cells out of 9,216 = **4.1% of capacity.** In exchange, the receiver
> *never assumes a transfer function, a white point, or an exposure*. It measures the actual
> received value of every palette entry, at four edges, and bilinearly interpolates the
> palette across the interior to absorb vignetting and backlight non-uniformity.
>
> Minimum viable version: **`L` reference cells at each of 4 corners + centre = 5·L cells.**
> For `L=8` that is 40 cells — negligible. Five sites is enough to fit a bilinear (4 dof
> per channel) spatial model with one point of slack.

Why the ring is better than corners-only: vignetting and screen backlight roll-off are both
strongest at the edges, and the corners of a photographed screen are exactly where
perspective foreshortening puts the fewest camera pixels per cell.

**And there is a stronger reason, from DisCo (ACM ToG 2016).** DisCo derives the image
formation model for a rolling-shutter camera viewing a modulated display **[LAB]**:

> `i(x, y) = i_tex(x, y) × g(y)`
> *"the texture and the signal layers of the display are observed as two separable (and
> unknown) components"*
> ([paper, p.5](https://cave.cs.columbia.edu/old/publications/pdfs/Jo_TOG16.pdf))

and then shows that `g(y)` is *"invariant to the display-camera geometry, partial occlusions,
and imaging parameters"* — unchanged by zoom, defocus, rotation and distance.

**A corruption that is multiplicative and depends only on the row `y` is exactly what a
vertical reference column cancels.** So the left and right edges of the ring are not
decoration: divide each cell row by its measured reference and you simultaneously remove

- rolling-shutter row gain (§3.5),
- **OLED PWM dimming banding** at 240–480 Hz (a short exposure catches only part of a PWM
  cycle → row-to-row brightness ripple),
- LCD backlight strobing,
- lens vignetting and screen backlight roll-off,
- global AE gain drift.

**One mechanism, five impairments.** This is the highest-leverage single design decision in
the receiver.

**The literature converges on this class of solution.** Three distinct strategies appear,
and all three make the *absolute* pixel value irrelevant:
*(a) differential/temporal encoding* — HiLight encodes bits as BFSK (20 Hz vs 30 Hz over a
6-frame window at 60 Hz), and states the payoff directly: *"since FSK encodes data as
relative color intensity changes, HiLight is robust against image quality degradation"*
**[LAB]**; *(b) regional weighting* — HiLight computes an MVDR beamforming weight matrix per
sub-region, assigning **zero weight** to regions not behaving as expected **[LAB]**;
*(c) multiplicative factorisation* — DisCo, above.

### 3.3 Gamma — the analysis, and why you should refuse to model it

The sRGB EOTF (display decode), for encoded `V ∈ [0,1]`:

```
L = V/12.92                      if V ≤ 0.04045
L = ((V + 0.055)/1.055)^2.4      otherwise
```

Take four evenly spaced code values `V = 0, 1/3, 2/3, 1` **[DERIVED]**:

| V (8-bit) | Emitted light L | Gap from previous |
|---|---|---|
| 0 | 0.0000 | — |
| 85 | 0.0909 | 0.0909 |
| 170 | 0.4019 | 0.3110 |
| 255 | 1.0000 | 0.5981 |

So evenly spaced *code values* are wildly uneven in *light* — a 6.6:1 ratio between the
largest and smallest step. Conversely, evenly spaced *light* levels (0, 1/3, 2/3, 1) map to
code values 0, 154, 202, 255 — crammed into the top 40%.

**But that is the wrong thing to worry about.** Model the whole chain:

```
V_tx  ──display EOTF──►  Y = V_tx^γd            (γd ≈ 2.2)
      ──optics────────►  E = k·Y + f            (k = exposure gain, f = flare/ambient)
      ──camera OETF───►  V_rx = A·E^(1/γc) + b
```

**If `f = 0` and `γc ≈ γd`, then `V_rx = A·k^(1/γc)·V_tx` — a pure scale factor. Evenly
spaced transmitted code values arrive evenly spaced. [DERIVED]**

This is not luck. The camera's OETF exists to invert a display's EOTF, because the entire
imaging chain is built so that a photo of a scene looks like the scene. **Encoding gamma and
decoding gamma largely cancel.** So the naive answer — space levels evenly in sRGB code
value — is *correct*, and spacing them evenly in linear light would be actively wrong (they
would arrive badly bunched at the top).

The residual gamma effects are all **monotone**, and therefore fully invertible by a
per-frame calibration ramp:

- γc ≠ γd exactly. Broadcast practice deliberately builds in a system gamma / OOTF of ≈1.2
  (BT.709 OETF into a BT.1886 ≈2.4 display EOTF), so expect a net exponent around
  **0.8–1.3**, not exactly 1.0.
- ISPs add an **S-shaped tone curve**, compressing both ends.
- OLED phones ship several display modes; "vivid" adds contrast and saturation.

#### The actual enemy is `f` — additive flare

`f` is the one term that is **not** a benign monotone remap: screen surface reflection, lens
flare, ambient light spilling onto a glossy panel. It is an *additive offset in linear
light*, and it survives the `^(1/γc)` re-encode as a **dark-end compression**.

Worked example: 8 evenly spaced levels `V_tx = i/7`, γ = 2.2, flare `f = 0.02` — 2% of screen
peak, entirely realistic for a glossy screen in a lit room **[DERIVED]**:

| i | V_tx | Y = V^2.2 | E = Y+0.02 | V_rx = E^(1/2.2) | normalised | gap |
|---|---|---|---|---|---|---|
| 0 | 0.000 | 0.0000 | 0.0200 | 0.169 | 0.000 | — |
| 1 | 0.143 | 0.0138 | 0.0338 | 0.215 | 0.054 | **0.054** |
| 2 | 0.286 | 0.0636 | 0.0836 | 0.324 | 0.184 | 0.130 |
| 3 | 0.429 | 0.1550 | 0.1750 | 0.453 | 0.338 | 0.154 |
| 4 | 0.571 | 0.2919 | 0.3119 | 0.589 | 0.500 | 0.162 |
| 5 | 0.714 | 0.4770 | 0.4970 | 0.728 | 0.664 | 0.164 |
| 6 | 0.857 | 0.7124 | 0.7324 | 0.868 | 0.832 | 0.168 |
| 7 | 1.000 | 1.0000 | 1.0200 | 1.009 | 1.000 | 0.168 |

The ideal gap is 0.1429 everywhere. **The bottom gap is 0.054 — 2.6× too small**, i.e. 14
received code values instead of 36. And camera noise is *worst* at the dark end, so that
bottom pair carries most of the error rate. **At 5% flare the bottom two levels become
nearly indistinguishable.**

#### Recommendation

1. **Space transmitted levels evenly in sRGB code value.** Correct for the ideal round trip.
2. **Do not analytically predistort.** You know neither `f` nor `k`, and both change with
   ambient light, viewing angle and screen brightness.
3. **Send a reference ramp every frame; invert at the receiver** (§3.2). Thresholds are the
   midpoints between *measured* reference levels. This is **exact for any monotone
   distortion** — flare, tone curve, AE gain, gamma mismatch, limited range, all of it — and
   needs no back channel. This is the single design decision that makes the whole thing
   robust.
4. **Abandon the bottom of the range.** Put the lowest data level at **~15–20%**, not 0.
   You give up a little dynamic range and buy back a lot of margin on the level that fails
   first. For 4 levels: `{48, 117, 186, 255}` (even in code value, floor lifted) rather than
   `{0, 85, 170, 255}`. Keep the calibration black and white references *outside* the data
   range so they always bracket it.
5. **Bias bright, and prefer OLED senders.** HiLight, measuring across LCD/LED/OLED:
   *"OLED screens are the most preferable, because OLED screens do not have backlight and
   each pixel emits light independently. Therefore, colors on OLED screens are brighter with
   higher contrast, making color intensity change easier to detect"* **[LAB]**. Biasing
   bright also drives auto-exposure to a shorter exposure, which independently helps
   rolling shutter (§3.5) and motion blur (§3.6) — three arguments converging on one choice.

### 3.4 Moiré and aliasing: how big must a cell be?

Two independent sampling grids are involved: the screen's pixel pitch and the camera's
sensor pitch projected onto the screen. When they are close, the beat frequency
`|f_screen − f_camera|` is *low* — and a low-frequency beat lands right in your signal band.
This is why photographs of screens look terrible.

**Work the geometry [DERIVED].** A typical phone main camera is ~26 mm equivalent →
horizontal FOV ≈ 69°. At 30 cm the frame is ~41.6 cm wide.

- Capturing at **1920 px wide**: 0.217 mm per camera pixel at the object plane.
- A 13" laptop screen (28.7 cm wide) filling ~69% of the frame → **~1,325 camera pixels
  across the screen.**
- A 6.1" phone screen held at 30 cm (7.1 cm wide) → only **~327 camera pixels across.**

Against that, screen pixel pitch: a 100 ppi laptop is 254 µm; a 220 ppi "retina" laptop is
115 µm; a 400 ppi phone is 63 µm. The 100 ppi laptop's 254 µm pitch versus the camera's
217 µm sampling pitch is a **1.17:1 ratio — squarely in the worst moiré regime.**

**Rules of thumb.**

**Why Nyquist alone is the wrong frame.** A code cell is a *square wave*, not a sinusoid;
Nyquist guarantees reconstruction of a band-limited signal and yours has infinite bandwidth
at the edges. Three separate things eat the margin: **unknown sub-pixel phase** (your grid
lands wherever the user's hand puts it — at 2 px/cell a sample can land exactly on a
boundary and read the average of two cells); **MTF roll-off** (contrast near Nyquist is
heavily attenuated — fine for binary, where you need only the *sign*, fatal for multi-level,
where you need the *amplitude*); and **ISP sharpening overshoot** at boundaries (§3.1).

Published guidance for *binary* QR modules clusters at **2.5–4 camera pixels per module**
(e.g. [whooshly](https://whooshly.co/blog/qr-code-size-guide) "about 2.5, design for 3–4 to
survive cheap cameras"; [barcodepress](https://barcodepress.com/guides/qr-code-size-guide)
"at least 3"; [qrsansar](https://qrsansar.com/ar/blog/qr-code-print-size-scanning-distance-formula)
"roughly 4 to 6") — SEO-grade sources, but consistent. The best-sourced hard number is a
Cognex capability claim relayed by an integrator: readers *"read 2D codes down to 2.5 PPM"*
([rrfloody](https://www.rrfloody.com/techbriefs/pixels-per-module.html)) **[WEAK — vendor
claim]**. Treat 2.5 PPM as a **floor achieved by a mature, heavily tuned commercial decoder
on a high-contrast binary code**, not as a design target for a bespoke multi-level codec.

| Signal | Absolute floor | **Recommended** | Screen px / cell | Rationale |
|---|---|---|---|---|
| Binary luma | 2.5 | **4** | ≥ 6 | only the *sign* matters; MTF attenuation survivable. 4 px gives a clean 2×2 core at arbitrary phase |
| 4-level luma | 4 | **6** | ≥ 8 | needs *amplitude*; interior must reach full contrast |
| 8-level luma | 5 | **8** | ≥ 10 | 8 px leaves a 4×4 core after a 25% guard ring |
| **Colour** (any count) | 8 | **12–16** | ≥ 12 | ×2 for Bayer R/B half-rate **and** ×2 for capture-path 4:2:0, applied to the multi-level luma figure (§3.1) |
| libcimbar mode B (4-bit *shape* + colour) | — | ~8–9 | 8 (+1 gutter) | must resolve *structure inside* the cell |

The colour row deserves a second look, because it is the one people underestimate. At cell
width `C` camera pixels you get `C/2` chroma samples per axis — and **your cell grid is not
phase-aligned to the 2×2 chroma lattice**, since scale and offset are set by where the user
holds the phone. At `C = 2` there is one chroma sample per cell that straddles a boundary
roughly half the time. At `C = 4` both samples can be boundary-contaminated at unfavourable
phase. **`C = 8` is the first size at which an interior 2×2 chroma block is clean.**
**[DERIVED]**

**Empirical anchor.** HiLight's grid-size sweep, the closest thing to real data on cell size
vs reliability **[LAB]**:

| grids | grid size | screen px/grid | static accuracy | dynamic (handheld) |
|---|---|---|---|---|
| 6 | 54.2 cm² | 683 K | 99.4% | — |
| 120 | 2.7 cm² | 34 K | 89.4% | **85.4%** |
| 240 | 1.4 cm² | 17 K | 82.9% | **78.3%** |
| 600 | 0.5 cm² | 6.8 K | 75.2% | **67.2%** |

⚠️ **Do not transfer these numbers directly.** HiLight detects a **1–8% intensity change**;
a full-contrast code has ~30× more signal, so its limit is *amplitude SNR*, not spatial
resolution, and its cell sizes are far more conservative than qrbeam needs. What *does*
transfer is the shape of the curve and the hardware dependence they measured: an 18 MP SLR
supported **720 grids at 6.6 kbps** versus an 8 MP iPhone 5s's **120 grids at 1.1 kbps** —
*"higher-resolution cameras capture more pixels on the transmitter screen, and thus they
support smaller grids."* Also note the static→dynamic (handheld) drop: **4–8 percentage
points**, consistently.

**Screen-side rules that matter as much as the camera-side ones:**

- **Cells must be ≥6–8 screen pixels.** Below that, LCD **subpixel structure** (RGB stripes)
  becomes a colour signal in its own right — a "white" cell is literally alternating red,
  green and blue emitters, and if the camera partially resolves them you get chromatic
  fringing that will wreck an 8-colour palette.
- **Render with antialiasing off and snap to integer device pixels.** Use
  `devicePixelRatio` and `image-rendering: pixelated`. A cell boundary landing on a
  half-pixel produces a grey seam that biases the neighbouring interior averages.
- **The 1-px inter-cell gutter is load-bearing** (libcimbar). It absorbs the smear.
- **Averaging over the cell interior is itself the anti-moiré filter.** A box average over
  ≥5×5 screen pixels attenuates the screen-grid carrier by roughly the box filter's
  response at that frequency — this is why you must average an interior region rather than
  point-sample a centre.
- **Slight defocus is your friend.** It is an optical low-pass. Don't fight a marginally
  soft image; fight a moiré-locked sharp one.

**The killer conclusion for phone-to-phone:** at 30 cm, a 6.1" phone screen gives only
~327 camera pixels across. At 6 camera px/cell that is a **54×54 grid**. At 4 bits/cell
that's 54²×4/8 = 1,458 bytes/frame before ECC. **Phone-to-phone is a fundamentally smaller
channel than laptop-to-phone**, and qrbeam must either detect the situation and switch to a
coarser mode, or tell the user to move closer. libcimbar handles this with explicit modes
(`Conf8x8_micro` at 80×69 cells for smaller displays) **[CODE]**.

### 3.5 Rolling shutter — the tearing budget

**Mechanism, with the two parameters people conflate.** A CMOS rolling shutter exposes and
reads out rows sequentially. DisCo formalises it exactly as needed here: row `y`'s exposure
is a time-shifted copy of a common shutter function, `e(x,y,t) = e′(t − t_y)` with
**`t_y = y/r`** where `r` is the rolling-shutter speed in rows/second **[LAB]**. Two
*independent* parameters matter:

- **`T_r` = total frame readout time** — top row to bottom row.
- **`T_e` = per-row exposure (integration) time** — how long each row collects light.

**For this problem, `T_e` matters more than `T_r`, and that is the non-obvious part.**

**Measured readout times.** iPhone 15 Pro, 300 Hz strobe methodology, 4K ProRes
([CineD](https://www.cined.com/iphone-15-pro-lab-test-rolling-shutter-dynamic-range-and-exposure-latitude/))
**[MEAS]**: 24 mm main **5.3 ms**, ultra-wide 4.7 ms, tele 5.0 ms, **front-facing 9.3 ms**.
For context, dedicated cameras at 1080p span 2.4–30 ms.
⚠️ **Caveats:** that is a ProRes capture mode, not a `getUserMedia` preview mode, and the
crowdsourced readout database contains **no smartphone entries at all**. **No rigorous
`T_r` measurements exist for Android phones in browser capture modes.** Assume
`T_r ∈ 5–30 ms` and measure your targets. Front cameras are ~2× slower — relevant if users
self-film.

**The counterintuitive result: a *fast* sensor can be worse.** The transition band, as a
fraction of image height, is **`T_e / T_r` [DERIVED]**. Take the iPhone's `T_r = 5.3 ms` with
a "normal" video exposure `T_e = 1/60 s = 16.67 ms`:

```
T_e / T_r = 16.67 / 5.3 = 3.15  >  1     →  the ENTIRE frame is a blend
```

Every row's exposure spans more than one display frame, and because readout is *fast*
relative to the display period the blend ratio varies by only `T_r/T_d = 32` percentage
points top to bottom. **You get no sharp tear line at all — just a near-uniform mixture of
2–3 consecutive code frames.** That is strictly worse than a tear: a tear is detectable and
discardable; a uniform blend is irreversibly mixed and will silently produce garbage that
passes anything short of a CRC.

Conversely a *slow* sensor (`T_r = 25 ms`) with a *short* exposure (`T_e = 4 ms`) gives a
transition band of `4/25 = 16%` of frame height — **84% of the frame is clean single-frame
data with a sharp, detectable boundary.**

**The saving grace: screens are bright, so AE picks a short exposure by itself.** Standard
reflected-light metering, `EV = log₂(L·S/K)` with `K = 12.5`, for a 300 cd/m² screen filling
the frame at ISO 100 **[DERIVED]**:

```
EV = log₂(300 × 100 / 12.5) = log₂(2400) = 11.2
t  = N²/2^EV = 3.24/2400 ≈ 1/740 s   (at f/1.8)
```

**A phone filming a bright screen up close naturally meters to ~1/500–1/2000 s.** At
`T_e = 1 ms`, `T_r = 5.3 ms`, the transition band is `1/5.3 = 19%` of frame height — **81%
of each frame is clean, with a detectable boundary.** This is actionable without any camera
control, and it dictates three sender/UX choices:

- **Fill the camera frame with the screen.** Dark surroundings in frame drive AE to open up,
  and then everything above goes wrong at once.
- **Keep the code's mean luminance high** (§3.3 already recommends this for flare reasons).
- **Screen at maximum brightness** — and many OLEDs switch from PWM to DC dimming at high
  brightness, which independently kills the banding discussed in §3.2.

**Clean-capture probability.** A camera frame is untorn iff its whole temporal span
`T_r + T_e` falls inside one code-frame hold. Holding each code frame for `N` display
refreshes (`D = N·T_d`, `T_d = 16.67 ms` at 60 Hz) **[DERIVED]**:

```
P(clean) = max(0, (N·T_d − T_r − T_e) / (N·T_d))
```

| N | Code frame | Code rate | Bright screen<br>`T_r`=5.3, `T_e`=2 | AE opened up<br>`T_r`=5.3, `T_e`=16.7 | Slow sensor, dim<br>`T_r`=25, `T_e`=16.7 |
|---|---|---|---|---|---|
| 2 | 33.3 ms | 30 fps | **78%** | 34% | **0%** |
| **3** | **50 ms** | **20 fps** | **85%** | 56% | 17% |
| **4** | **66.7 ms** | **15 fps** | **89%** | 67% | 37% |
| 6 | 100 ms | 10 fps | 93% | 78% | 58% |

**N = 3 or 4 is the sweet spot** — and note this is exactly HiLight's choice, which used a
6-frame window at 60 Hz because that was *"the minimal to achieve 20 Hz and 30 Hz change
under the screen refresh rate of 60 Hz"* **[LAB]**.

Add `T_d` (another 16.7 ms) to the span if you want a conservative bound that also accounts
for the **display's own scanout** — the panel refreshes top-to-bottom over one period, so
the content transition is itself smeared. With that term the bright-screen column drops to
roughly 28% / 52% / 64% for N = 2/3/4. The truth is between the two, because camera and
display both scan top-to-bottom and the effects partially cancel (see below).

**Cross-check against a shipping system:** libcimbar's default sender rate is **15 fps**
(slider 5–20) — exactly `N = 4` on a 60 Hz panel — and its measured 106 KB/s against a
7,500 B/frame capacity implies **~14.3 useful frames/s**, i.e. ~95% delivery **[MEASURED]**.
That sits at the optimistic end of the `N = 4` row, consistent with a bright monitor driving
a short exposure. **Independent empirical support for the model.**

**Detecting a torn frame.** Three mechanisms, use all of them:

1. **Frame ID in the header, replicated top and bottom.** If the top copy and bottom copy
   disagree, the frame is torn — discard, or (better) decode the two bands separately.
2. **Per-frame checksum.** You need one anyway. A torn frame fails it. This is the
   backstop.
3. **Row-band structure.** Divide the payload into `B` horizontal bands, each independently
   ECC-protected and each carrying the frame ID. A torn frame then loses only the one band
   that straddles the tear — typically `1/B` of the frame. With `B = 8`, a tear costs 12.5%
   instead of 100%.

**Is per-band decoding viable? Yes, and it is the highest-leverage optimisation available.**
Look at the table again: at `D = 33.3 ms` (sender at 30 fps) `P(clean whole frame) = 0`, but
`P(a given band is clean)` is high, because a band only needs `R'/B + hold` alignment. With
8 bands you recover most of the data from *every* frame, and you can then run the sender at
the full camera rate. Combined with a fountain code — which does not care which bytes it
gets, only how many — this converts rolling shutter from a catastrophe into a ~15% tax.

This is essentially LightSync's insight
([MobiCom 2013](https://dl.acm.org/doi/abs/10.1145/2500423.2500437), *LightSync:
unsynchronized visual communication over screen-camera links*) **[LAB]**, which reports
smartphone camera frame rates varying from **8 to 30 fps** across devices — a reminder
that you cannot assume 30.

**And there is direct precedent for band decoding.** DisCo divides the captured image
*"into small 1D intervals"* and recovers the signal *"on each interval individually"*, with
`h_bit` defined as *"the number of image rows required to encode a single bit"*
([paper §4.1](https://cave.cs.columbia.edu/old/publications/pdfs/Jo_TOG16.pdf)) **[LAB]**.
**RollingLight** (MobiSys 2015,
[ACM](https://dl.acm.org/doi/10.1145/2742647.2742651)) is the canonical work on exploiting
rolling shutter for camera communication and on coping with *heterogeneous* readout rates —
⚠️ **full text not retrieved (ACM 403); listed as the right next read, no verified numbers.**

For qrbeam, band decoding means specifically:

1. Detect the tear as a **discontinuity in the reference column** (§3.2) — you get this for
   free from the calibration ring.
2. Decode the band above and the band below independently, each with its own reference
   normalisation.
3. **Tag each band with its code-frame ID.** This requires a frame sequence number encoded
   **per cell-row**, not once per frame — budget for it in the framing design.

**A note on the display's scanout direction.** Both scans run top-to-bottom, and since
`T_r < T_d` typically (5.3 vs 16.7 ms), **the camera scan overtakes the display scan**; the
tear lands where they cross, and the crossing point drifts frame to frame because the clocks
are independent. (The degenerate case is instructive: if `T_r` exactly equalled `T_d` *and*
were phase-locked, the camera would track the display and there would be **no tear at all** —
that is professional genlock, and it is unavailable from a browser.) If the rates happen to
be close, the tear can sit nearly still for many frames, always corrupting the same band.
**Randomising the sender's hold duration by ±1 refresh breaks that lock-in for free** — and
composes nicely with the sender-side shake of §3.7.

### 3.6 Motion blur

⚠️ **Weakly sourced.** No rigorous published measurement of standing-handheld angular rate
for phone cameras surfaced (the ROHM and ST OIS whitepapers, which would have the handshake
spectra, are 403/timeout). What is solid: hand tremor peaks at **5–12 Hz**
([Nature Sci Rep](https://www.nature.com/articles/s41598-022-21310-4)) **[MEAS]**, with
other work using a 3–16 Hz band; walking reportedly reaches **10–20 °/s** **[WEAK, single
snippet]**. So this is presented **parametrically** — substitute measured values when you
have them.

At 26 mm equivalent the horizontal FOV is 69.4°, so at 1920 px wide you get **27.7 px per
degree**. Blur in pixels = rate (°/s) × exposure (s) × 27.7 **[DERIVED]**:

| Angular rate | 1/30 s | 1/60 s | 1/120 s | **1/500 s** |
|---|---|---|---|---|
| 1 °/s (braced) | 0.9 px | 0.5 px | 0.2 px | 0.06 px |
| 3 °/s (normal handheld) | 2.8 px | 1.4 px | 0.7 px | **0.17 px** |
| 10 °/s (sloppy) | 9.2 px | 4.6 px | 2.3 px | 0.55 px |
| 20 °/s (walking) | 18.5 px | 9.2 px | 4.6 px | 1.1 px |

Translation matters comparably: at 30 cm with a 300 mm screen filling 1920 px, **1 mm of
hand translation = 6.4 px**.

**Verdict against the 6–8 px/cell budget of §3.4:** at 1/30 s and normal handheld (3 °/s)
you smear 2.8 px ≈ **35% of a cell** — marginal, it will merge adjacent levels. At 1/500 s —
**which is what auto-exposure actually picks on a bright screen (§3.5)** — you smear 0.17 px
≈ **2% of a cell**, i.e. nothing.

> **Motion blur is a non-problem *provided* AE picks a short exposure.** The failure mode is
> a dark room with a small dim screen in frame, where AE opens to 1/30 s and blur, frame
> blending and flare all get worse together. **This is the same failure mode as §3.5's, with
> the same fix**, which is why "fill the frame with a bright screen" is the single most
> valuable instruction the receiver UI can give the user.

Practical levers:

- Make the code region fill the camera frame (the receiver UI should show a crosshair /
  target rectangle — libcimbar does exactly this, with `crosshair1`/`crosshair2` elements
  that change colour on successful extract **[CODE]**).
- Use a **dark background** around a bright code so average scene luminance stays moderate
  and the ISP doesn't over-expose the cells into clipping. libcimbar's default is **dark
  mode**, and the author states this "came out of getting better results from backlit
  screens" ([ABOUT.md](https://github.com/sz3/cimbar/blob/master/ABOUT.md)) **[MEASURED,
  anecdotal]**.
- Where supported, request `exposureTime` explicitly; treat success as a bonus.

Also: **autofocus hunting** is a worse enemy than blur. A focus hunt costs 5–20 consecutive
frames. Request `focusMode: 'continuous'` and accept that bursts of loss will happen — this
is precisely why qrbeam is fountain-coded.

**OIS helps; EIS actively hurts; neither is controllable.** Optical image stabilisation
counteracts rotation in the lens and directly attacks the dominant term above — pure win.
**Electronic** image stabilisation crops and **warps each frame** to stabilise, including
rolling-shutter rectification warps that resample your cells non-uniformly. For a codec
assuming a stable geometry that is poison. **No spec property disables either.**
Fortunately the mitigation is something you must do anyway: **estimate the homography per
frame from the fiducials and never assume frame-to-frame geometric stability.** Do that and
EIS becomes just another homography your anchors already measure.

### 3.7 The one weird trick: shake the *sender*

libcimbar's benchmark run used the **"shakycam" option**, which is a sender-side feature:
`gl_2d_display::computeShakePos` cycles the rendered image through 4 positions offset by
`±8/1080` of the display dimension (≈ ±8 px at 1080p) on successive frames **[CODE]**.

Why this helps:

- It guarantees the framebuffer changes every frame, defeating any "identical frame" skip.
- It **breaks moiré lock**: the beat pattern between screen and sensor grids no longer sits
  in the same place two frames running, so a cell corrupted by a moiré null in frame *n* is
  likely fine in frame *n+1*.
- It defeats ISP **temporal denoising**, which would otherwise blend consecutive (different)
  code frames together.

This costs nothing and qrbeam should copy it.

---

## 4. Frame synchronisation without a clock

Consolidating §3.5 into a design.

**What does not work:** assuming any relationship between display refresh and camera
capture. There is none, they drift, and the camera's rate itself varies with lighting
(the ISP lengthens exposure in dim conditions and drops to 15 or even 8 fps — LightSync
measured **8–30 fps** across devices **[LAB]**).

**The four strategies, ranked:**

1. **Self-identifying frames + a fountain code. (Mandatory.)** Every frame carries its own
   ID and checksum; duplicates are recognised and dropped; torn frames fail the checksum
   and are discarded; missing frames don't matter because the sender emits an endless stream
   of distinct fountain-coded frames. This makes synchronisation a *throughput* question
   rather than a *correctness* question. qrbeam's plan already commits to this, and it is
   the right call. libcimbar does the same (wirehair fountain codes, generating
   `blocks_required() × 8` distinct blocks before looping **[CODE]**).

2. **Banded, independently-decodable payload. (High value.)** §3.5. Turns a tear from a
   lost frame into a lost band.

3. **Hold each frame for K refreshes / run at half camera rate. (Cheap, do it.)** §3.5's
   89% result. Practically: run the sender at 15 fps on a 60 Hz panel = 4 refreshes per
   code frame, and hope the camera gives you 30.

4. **A blinking corner marker as a clock. (Not worth it.)** It tells you *that* a transition
   happened but not *where in the readout* — the frame ID replicated top-and-bottom gives
   you strictly more information for less area.

**Frame-rate efficiency, summarised [DERIVED]** — camera at 30 fps, 60 Hz panel, using the
`P(clean)` model of §3.5. Two columns because the answer is dominated by whether
auto-exposure picked a short exposure:

| Configuration | Bright screen filling frame (`T_r`=5.3, `T_e`=2 ms) | Dim room / slow sensor (`T_r`=25, `T_e`=16.7 ms) |
|---|---|---|
| Sender 30 fps (N=2), whole-frame decode | 23.4 useful frames/s | **0** |
| Sender 20 fps (N=3), whole-frame decode | 17.0 | 3.4 |
| Sender 15 fps (N=4), whole-frame decode | 13.4 | 5.6 |
| Sender 15 fps (N=4), 8-band decode | ~14.7 | ~10 |
| **Sender 30 fps (N=2), 8-band decode** | **~28** | **~13** |

Two things fall out of this table:

1. **Banding is the prize.** It roughly doubles goodput in good conditions and rescues the
   bad-conditions case from *zero*. That last point matters more than the first — a codec
   that returns nothing in a dim room is a codec users will describe as broken. It is also
   *more* decoder work (per-band ECC, per-band ID) and belongs in phase 2, not v1.
2. **The exposure column dominates everything.** The spread between the two columns is
   larger than the spread between any two designs in the left column. Getting the user to
   fill the frame with a bright screen is worth more than every coding decision here
   combined.

---

## 5. Performance budget in the browser

### 5.1 Frame acquisition — do not use `getImageData`

The path everyone reaches for first — `drawImage(video, canvas)` then `getImageData()` — is
the wrong one. `getImageData` forces a GPU→CPU readback of the canvas backing store,
converts from premultiplied alpha, and may do a colour-space conversion, all synchronously
on the calling thread. `willReadFrequently: true` on `getContext('2d')` tells the browser to
keep the backing store in CPU memory, which helps a lot, but you're still copying 8 MB per
1080p frame.

**The right path, demonstrated in production by libcimbar
([`recv.js`](https://github.com/sz3/libcimbar/blob/master/web/recv.js)) [CODE]:**

```js
video.requestVideoFrameCallback(onFrame);   // fires once per *video* frame, not per rAF

function onFrame(now, metadata) {
  const vf = new VideoFrame(video, { timestamp: now });   // no canvas involved
  let params = {};
  if (!["NV12","I420"].includes(vf.format)) params.format = "RGBA";  // fallback only
  const buf = new Uint8Array(vf.allocationSize(params));
  vf.copyTo(buf, params);
  worker.postMessage({pixels: buf, format, width, height}, [buf.buffer]);  // transferable
  vf.close();
  video.requestVideoFrameCallback(onFrame);
}
```

Points worth stealing verbatim:

- **No canvas at all.** `new VideoFrame(videoElement)` + `copyTo` skips `drawImage` and
  `getImageData` entirely.
- **Keep the native YUV format.** Requesting RGBA forces a conversion; NV12/I420 is a
  straight memcpy and gives you a full-resolution Y plane for free.
- **Transfer, don't copy.** `postMessage(..., [buf.buffer])` moves the ArrayBuffer to the
  worker with zero copy.
- **A pool of workers, round-robin, with a frames-in-flight cap** (libcimbar caps at 20 and
  logs "stalling, worker queues are full"). Decode is not required to finish within one
  frame period — it's required to keep *up on average*. Parallelism across frames is far
  easier than parallelism within a frame.
- **Reuse WASM heap buffers** (`mallocPlease(name, size)` grows on demand, never per-frame)
  — no allocation churn, no GC pressure.

Browser support: `requestVideoFrameCallback` is Chrome 83+, Edge 83+, Firefox 132+,
**Safari 15.4+** ([web.dev](https://web.dev/articles/requestvideoframecallback-rvfc))
**[SPEC]** — so both target platforms are covered. `VideoFrame.copyTo` is Baseline 2024
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/VideoFrame/copyTo)) **[SPEC]**.

**Read plane 0 (Y) and stop there.** Because the frame is NV12 or I420 (§3.1), plane 0 *is*
a full-resolution 8-bit grayscale image, contiguous, one byte per pixel. If qrbeam encodes
in luma (§7.3), **that plane is the entire signal** — no colour conversion, no chroma
upsample, no RGBA expansion, and ⅓ the bytes of an RGBA copy. Branch on `VideoFrame.format`
to find the plane layout (I420 = 3 planes, NV12 = 2 with interleaved UV).

`MediaStreamTrackProcessor` is the tidier source (a `ReadableStream<VideoFrame>`, no
`<video>` element, worker-only and video-only) and is supported on **Safari iOS 18+**,
though caniuse lists Chrome Android as only *partial*
([caniuse](https://caniuse.com/mdn-api_mediastreamtrackprocessor),
[Mozilla](https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/)).
**Use rVFC + `new VideoFrame(videoEl)` as the portable path** (it is what libcimbar ships)
and `MediaStreamTrackProcessor` as an enhancement where present.

**Do not use `texImage2D(…, video)` or WebGPU `importExternalTexture` to *measure*.** They
sample YUV and convert in the sampler — fine for display, lossy for measurement. If the GPU
path of §5.2 is used, upload the **Y plane** as a single-channel texture rather than
uploading the video element.

**Real-world iOS wart, from libcimbar [CODE]:** the camera stream *silently pauses* on iOS.
Their fix is a 1-second watchdog that checks whether the frame counter advanced and
re-initialises `getUserMedia` if not. Budget for this; you will hit it.

### 5.2 Can the whole pipeline run on the GPU?

**Partly — and the part that matters, yes.** This is the most important open question in
the brief, so let's be precise about which stages can move.

| Stage | GPU-able? | Notes |
|---|---|---|
| Video → texture | **Yes** | `texImage2D(..., videoElement)` is the standard path; drivers have fast paths. Not zero-copy, but it's a GPU-side upload, not a readback. |
| Grayscale / threshold | Yes, trivially | one fragment shader |
| **Anchor search** | **No, not sensibly** | The run-length ratio scan is inherently sequential along a scanline and produces a *variable-length list* of candidates. Doable with compute + atomics in WebGPU; miserable in WebGL2. **Keep on CPU.** |
| Homography solve (4 points → 3×3) | No — and no need | It's an 8×8 linear solve on 4 points. Microseconds on the CPU. |
| **Perspective warp** | **Yes, perfectly** | One textured quad with the inverse homography in the vertex/fragment shader. This is what GPUs are for. |
| **Per-cell interior averaging** | **Yes** | Render to a `C×C` target where each output texel box-averages its cell's interior. Free — it's the same shader. |
| Palette classification | Yes | Nearest-neighbour against ≤16 palette centroids in a shader; or do it on the CPU on the tiny readback (it's only `C²` classifications). |
| ECC / fountain decode | No | Bit-serial, branchy. CPU/WASM. |

**The winning shape is: CPU finds the corners → GPU warps *and reduces* to one texel per
cell → read back `C×C` texels → CPU/WASM does classification + ECC.**

The readback shrinks from **1920×1080×4 = 8.3 MB** to **112×112×4 = 50 KB — a 165× reduction.**

### 5.3 Is the readback actually cheap? — the honest answer

This is where GPU pipelines usually die, so:

- **Synchronous `gl.readPixels` is a full GPU pipeline stall.** The three.js maintainers
  describe `readRenderTargetPixels()` as "waits for a sync with the GPU before the download
  starts, **costing tens of milliseconds per-call on PC and more on mobile**"
  ([three.js #22779](https://github.com/mrdoob/three.js/issues/22779)) **[MEASURED,
  qualitative]**. That cost is dominated by the *sync*, not the byte count — so a 50 KB
  synchronous readback can cost nearly as much as an 8 MB one. **Reading back a small
  texture does not, by itself, save you.**
- **WebGL2 async readback works and is the fix.** Bind a `PIXEL_PACK_BUFFER`, call
  `readPixels` into it, insert a `fenceSync`, and only call `getBufferSubData` once the
  fence signals. Reported speedups are **10–20×** over the naive path
  ([SO 28282935](https://stackoverflow.com/questions/28282935/working-around-webgl-readpixels-being-slow),
  cited via search summary) **[MEASURED, second-hand]**, and WebKit's own bug tracker
  states the pattern as the standard recommendation
  ([WebKit #235002](https://bugs.webkit.org/show_bug.cgi?id=235002)) **[SPEC-ish]**. The
  cost is **one frame of latency** — irrelevant here, since we're pipelining frames anyway.
- **Read back from your own FBO texture, never from the canvas.** The same WebKit bug
  reports: "If you render to your own texture (via a framebuffer) you'll get your speed
  back... That's only needed for reading the canvas itself." **[MEASURED]**
- **WebGPU is strictly better** — `copyTextureToBuffer` + `buffer.mapAsync()` is async by
  design, no fence gymnastics. And it is now available on **both** targets: WebGPU shipped
  in **Safari 26** for macOS/iOS/iPadOS
  ([WebKit blog](https://webkit.org/blog/16993/news-from-wwdc25-webgpu-now-available-in-safari-tech-preview/))
  **[SPEC]**, and has been in Chrome Android for some time. But qrbeam must still run on
  older iOS, so **WebGL2 is the compatibility floor and WebGPU the fast path.**

**Verdict on the GPU question:** *worth doing, but as phase 2, not phase 1.* The warp is
the single largest CPU cost and moving it to a shader is a genuine multi-millisecond win —
but only if you also do the async-readback dance correctly. Get it wrong and a naive
`readPixels` will make the GPU version **slower** than the CPU version. The safe plan is to
build the CPU path first (it is known to be fast enough — see §5.6), instrument it, and
port the warp to WebGL2 only if measurement demands it.

### 5.4 The `C×C` reduction shader, sketched

```glsl
// fragment shader, output target is C×C (e.g. 112×112)
uniform sampler2D uFrame;        // full camera frame, Y plane or RGB
uniform mat3      uHinv;         // canonical grid coords -> source pixel coords
uniform vec2      uFrameSize;
const int K = 3;                 // K×K taps inside the cell interior

void main() {
  vec2 cell = gl_FragCoord.xy;               // integer cell index (+0.5)
  vec4 acc = vec4(0.0);
  for (int j = 0; j < K; ++j)
   for (int i = 0; i < K; ++i) {
      // sample the cell INTERIOR only: inset by 25% on each side
      vec2 g = (cell + vec2(0.25) + vec2(i, j) * (0.5 / float(K - 1))) / uGridSize;
      vec3 p = uHinv * vec3(g, 1.0);
      acc += texture(uFrame, (p.xy / p.z) / uFrameSize);
   }
  fragColor = acc / float(K * K);
}
```

One draw call, `C²·K²` texture taps (112²·9 ≈ 113k taps — nothing for any GPU), output
50 KB. Bilinear filtering on `uFrame` gives you the sub-pixel interpolation for free.

### 5.5 Two resolutions, not one — and budget the *miss* path

Before the budget table, two structural points that come out of benchmarking the existing
libraries (§6) and that dominate everything else.

**(a) The search and the sample want different resolutions.** `qr-scanner`, the most
carefully perf-tuned browser scanner in existence, downscales *everything* to a fixed
**400×400** before decoding **[CODE]**. That works for QR because a Version 10 symbol is
57 modules across — 7 camera px/module at 400 px. It does **not** work for qrbeam: a 96-cell
grid at 400 px is 4.2 px/cell, below the §3.4 threshold for multi-level luma.

The resolution is to split the pipeline:

- **Anchor search** on a heavily downscaled image (400–640 px). Anchors are ~7 cells across,
  so even at 400 px they're ~29 px — plenty. This is the stage that runs on *every* frame.
- **Grid sampling** from the **full-resolution** Y plane, using the homography scaled back
  up. This runs only on frames that passed the search.

**(b) Most frames contain nothing, and the miss path is where the time goes.** In a
one-way rateless stream the user is aiming, moving, or out of focus most of the time. The
measured numbers are alarming **[MEASURED, desktop V8 — multiply by 3–6× for a phone]**:

| Frame content (640×480) | jsQR | js-aruco2 |
|---|---|---|
| blank | 4.5 ms | 5.2 ms |
| code present | 8.1–12.2 ms | 8.3 ms |
| cluttered, 8 px texture | 19.3 ms | 19.3 ms |
| cluttered, 4 px texture | **51.3 ms** | — |
| per-pixel noise | **190 ms** ⚠️ | no cliff observed |

jsQR's 2.4 ms → 190 ms blow-up (**79×**) is a real, reproducible cliff, and its cause is
instructive: jsQR's finder-ratio test has a **±100% tolerance** on each run length, so
high-frequency texture generates thousands of spurious candidates, each of which then gets
scored by four Bresenham line walks *before* the top-4 cutoff is applied. js-aruco2 does not
have this cliff because its contour-length, convexity and minimum-edge filters kill
candidates *before* any per-candidate scoring.

**Design rule for qrbeam: the anchor detector must have a hard cap on candidate count
before any per-candidate scoring, and a tight ratio tolerance.** An unbounded worst case on
the hot path is exactly what turns a working demo into an app that freezes when you point it
at a bookshelf. Sensor noise in dim light is literally the per-pixel-noise column.

### 5.6 Per-stage budget, mid-range Android phone

Target: 33 ms per frame at 30 fps, or 66 ms at 15 fps. **Estimates unless marked.**

**CPU/WASM path (v1), 1920×1080 input, 96×96 grid:**

| Stage | Est. ms | Notes |
|---|---|---|
| `requestVideoFrameCallback` + `new VideoFrame` + `copyTo` (NV12) | 1–3 | memcpy of ~3.1 MB (Y+UV); no conversion |
| `postMessage` transfer to worker | ~0 | transferable ArrayBuffer |
| Downscale Y for anchor search (1920→640) | 2–4 | box filter; or skip and scan sparse rows at full res |
| Gaussian blur + Otsu threshold on the search image | 2–4 | js-aruco2's `adaptiveThreshold` measures **2.46 ms @640×480 desktop** **[MEASURED]** — this is its single biggest stage at 30% |
| Run-length anchor scan (sparse rows, ~60 of them) + confirm | 1–3 | very cheap; this is the design's whole point. Cf. js-aruco2's `findContours` at **2.06 ms** + `findCandidates` at **1.82 ms** **[MEASURED]** — a run-length scan should beat both |
| Edge chase + corner refinement | 1–2 | |
| Homography solve | <0.1 | 8×8 solve |
| **Perspective warp to 1024×1024 (bilinear)** | **8–20** | **the dominant CPU cost.** ~1 M output px × 4 taps |
| Per-cell interior averaging (96² cells × 5×5) | 2–4 | streaming reads of the warped buffer |
| Palette classification (9,216 cells vs ≤16 centroids) | 1–2 | |
| Reed–Solomon / LDPC decode | 3–8 | libcimbar uses RS(155,125), libcorrect |
| Fountain (wirehair-class) block ingest | 1–3 | amortised |
| **Total** | **~22–53 ms** | |

**GPU path (v2):**

| Stage | Est. ms |
|---|---|
| Acquire + upload `texImage2D(video)` | 2–4 |
| Anchor search on a downscaled CPU copy (still CPU) | 4–8 |
| **Warp + per-cell reduce, one draw call** | **<1 GPU-side** |
| Async readback (`PIXEL_PACK_BUFFER` + fence, 1 frame latency) | 0.5–2 CPU |
| Classification + ECC + fountain | 5–13 |
| **Total** | **~12–28 ms** |

**Sanity check against reality:** libcimbar decodes a *harder* problem (12,400 cells, each
requiring a 16-way image-hash symbol match plus colour, plus a ±7 px per-cell drift search)
at ~15 frames/s on a **Snapdragon 625 with 4 threads** **[MEASURED]**. qrbeam's proposed
codec has no symbol-shape matching at all — just an interior average and a nearest-centroid
lookup — so it is *substantially cheaper* per cell. The budget above is conservative.

### 5.7 Threads and SIMD

- **WASM SIMD** is broadly available on both Chrome Android and Safari (iOS 16.4+). Safe to
  use with a scalar fallback.
- **WASM threads need `SharedArrayBuffer`, which needs cross-origin isolation
  (COOP/COEP).** That is a *header* requirement, and qrbeam is a static site. GitHub Pages
  **cannot** set custom headers; Cloudflare Pages and Netlify can (via `_headers`). There is
  a well-known workaround — a service worker that synthesises COOP/COEP headers on
  responses ([`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker)) — but it
  requires a reload on first visit and interacts awkwardly with qrbeam's own PWA service
  worker.
  **Recommendation: do not depend on threads.** Use a *pool of Web Workers* processing
  *different frames* (libcimbar's approach) instead of threads splitting one frame. No
  `SharedArrayBuffer`, no COOP/COEP, no hosting constraint — and for a pipelined workload
  it's just as effective.

---

## 6. Existing browser implementations, read at source

All sizes below are **measured bytes** from jsDelivr/GitHub, not estimates. All timings are
**measured in Node 20 / V8 on an i5-13500 desktop** — the same engine as Chrome, but assume
**3–6× slower on a mid-range phone**.

### 6.1 jsQR — the reference for the anchor scan, and a cautionary tale

[cozmo/jsQR](https://github.com/cozmo/jsQR). **256.9 KB unminified; 44 KB / 10.2 KB gzip
when Closure-minified inside qr-scanner's worker.** Last real commit **2021-08-24** —
effectively frozen.

- **Binarize** (`src/binarizer/index.ts`): a port of ZXing's `HybridBinarizer`. Fixed
  **8×8 pixel blocks**; per-block mean is the black point; low-contrast blocks
  (`max − min ≤ MIN_DYNAMIC_RANGE = 24`) inherit a weighted neighbour average with the
  *left* neighbour double-counted; the applied threshold is the mean of a **5×5
  neighbourhood of block black points**. Grayscale is BT.709 luma.
  ⚠️ **Bug worth knowing:** the block loops index `region*8 + x` with no bounds check, so
  when width/height aren't multiples of 8 the edge blocks read past the row end and wrap
  into the next row. Feed it multiples of 8.
- **Locate** (`src/locator/index.ts`): a single raster scan with a rolling window of the
  last 5 run lengths, testing the 1:1:3:1:1 ratio — **but with a ±100% tolerance per run**,
  which is what produces the 190 ms noise cliff (§5.5). Horizontal runs are stitched into
  vertical quads, then each candidate is scored by walking **four** Bresenham lines
  (horizontal, vertical, both diagonals) through its centre. `MAX_FINDERPATTERNS_TO_SEARCH = 4`.
  Handedness fixed by a 2-D cross-product sign test.
- **Fourth corner:** QR has no fourth finder, so jsQR predicts a bottom-right point by
  parallelogram completion (`topRight − topLeft + bottomLeft`), pulls it 3 modules back
  toward top-left, and snaps to the best-scoring **alignment pattern** quad near it. Below
  15 modules between finders (Version 1) it skips this entirely.
- **Homography:** *not* a DLT/SVD solve — the classic **Heckbert closed-form square→quad**
  composed with the adjugate of quad→square. ~30 multiplies, with an affine fast path when
  the quad is a parallelogram. Control points are the three finder centres at module 3.5
  plus the alignment pattern at module `dim − 6.5`.
- **Sampling — its biggest weakness:** nearest-neighbour, **one sample per module**,
  `Math.floor`, **taken from the binarized bitmap**. All tonal information is destroyed
  before sampling, so one bad 8×8 block threshold corrupts every module inside it.
- **Binary output:** `QRCode.binaryData` is the raw codeword bytes and *is* binary-safe; the
  UTF-8 rendering is separate and wrapped in try/catch. But it allocates a ~3× payload-size
  string on **every** successful decode even if you only want bytes — per-frame garbage
  you'd patch out in a fork.

Measured, clean synthetic frames, `dontInvert` **[MEASURED]**:

| QR version | canvas | module px | ms | fps |
|---|---|---|---|---|
| v10 (57²) | 400×400 | 5 | 5.82 | 172 |
| v10 (57²) | 640×480 | 6 | 8.10 | 124 |
| v20 (97²) | 640×480 | 3 | 12.16 | 82 |
| v25 (117²) | 1280×720 | 4 | 27.47 | 36 |
| v40 (177²) | 1280×720 | 3 | 42.58 | 23 |

**Cost tracks pixel count, not QR version** — v10 at 400² is 5.8 ms; the same v10 at 640×480
is 8.1 ms (1.92× pixels → 1.39× time). This is the empirical justification for §5.5(a).

### 6.2 qr-scanner — steal its four constants

[nimiq/qr-scanner](https://github.com/nimiq/qr-scanner), 15.8 KB / 5.7 KB gzip (plus the
44 KB jsQR worker). The most perf-tuned real-world browser scanner. Its strategy, verbatim
from `src/qr-scanner.ts` **[CODE]**:

```ts
static readonly DEFAULT_CANVAS_SIZE = 400;
private readonly _maxScansPerSecond: number = 25;

const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
const scanRegionSize = Math.round(2 / 3 * smallestDimension);   // centred square crop
// ... then drawImage(src=that crop, dst=400×400)

const context = canvas.getContext('2d', { alpha: false })!;
context.imageSmoothingEnabled = false;    // "gives less blurry images"
```

1. **Centred square crop at ⅔ of the smaller video dimension.**
2. **Downscale to exactly 400×400**, so jsQR always sees 160,000 px regardless of camera
   resolution.
3. **`imageSmoothingEnabled = false`** — nearest-neighbour downscale. Counter-intuitive,
   but the comment records that it measured *less* blurry than the browser's box filter,
   which smears module edges.
4. **Throttle to 25 scans/sec** (40 ms), driven by `requestVideoFrameCallback` when
   available so the same camera frame is never scanned twice.

Also: `getImageData` + **transferable** buffer to the worker
(`postMessage(imageData, [imageData.data.buffer])`); a 3-tier camera constraint ladder
(`{width:{min:1024}}` → `{width:{min:768}}` → `{}`, note `min` not `ideal`); an integer
BT.601 grayscale (`77/150/29`, sums to 256 so it's a `>>8`); and canvas dimensions
reassigned only when they actually change, because assigning clears the canvas.

Notably it does **not** use `OffscreenCanvas` or `createImageBitmap` for the video path —
those appear only as accepted *input* types. Contrast libcimbar, which skips canvas entirely
(§5.1) — that is the more modern and cheaper path.

It also hard-disables the native `BarcodeDetector` on ARM Macs running Ventura+ (Chromium
bug 1382442) — a nice piece of field knowledge. **The native `BarcodeDetector` is unusable
for qrbeam regardless: it returns `rawValue: string` only, no bytes.**

### 6.3 js-aruco2 — the best starting skeleton for a custom codec

[damianofalcioni/js-aruco2](https://github.com/damianofalcioni/js-aruco2), MIT. The
important artefact is **`src/cv.js` — 16.6 KB unminified, zero dependencies**, containing a
complete, readable, dependency-free CV pipeline. The whole detector is 8 lines:

```js
CV.grayscale(image, this.grey);
CV.adaptiveThreshold(this.grey, this.thres, 2, 7);
this.contours   = CV.findContours(this.thres, this.binary);
this.candidates = this.findCandidates(this.contours, image.width * 0.01, 0.05, 10);
this.candidates = this.clockwiseCorners(this.candidates);
this.candidates = this.notTooNear(this.candidates, 10);
return this.findMarkers(this.grey, this.candidates, 49);
```

What's in there that qrbeam needs:

- **`adaptiveThreshold`** implemented as blur-and-compare: a separable 5×5 `stackBoxBlur`
  with a fixed-point reciprocal, then a 768-entry LUT to avoid a branch. Equivalent to
  OpenCV's `ADAPTIVE_THRESH_MEAN_C, blockSize=5, C=7`. Finer-grained than jsQR's 8×8 blocks,
  better on steep illumination gradients, more expensive.
- **`findContours`** — a genuine **Suzuki–Abe border following** implementation (the same
  algorithm as OpenCV's) in ~100 lines, with a 1 px padded border so the tracer needs no
  bounds checks and duplicated chain-code deltas so `deltas[++s]` can run past 7 without
  masking. *This is the single most valuable ~100 lines in this survey if you ever need
  contours without OpenCV.js.*
- **`approxPolyDP`** — Douglas–Peucker in squared distance (no sqrt).
- **`getPerspectiveTransform` / `warp`** — the same Heckbert closed form as jsQR, but with
  the unit square pre-scaled to the output size, **incremental evaluation** of the
  homogeneous numerators (add a constant per step instead of recomputing), and **bilinear**
  sampling.
- **`otsu`** — textbook between-class-variance over a 256-bin histogram.

**Its sampling is what qrbeam should copy, and it is strictly better than jsQR's:** it warps
the **grayscale** image (not the thresholded one) into a 49×49 patch, runs **Otsu on the
warped patch**, and then decides each of the 8×8 cells by **counting non-zero pixels over
that cell's full 6×6 block and comparing to half** — a 36-sample majority vote, versus
jsQR's single nearest-neighbour tap. For a screen-to-camera channel with moiré, glare and
defocus, that difference plausibly dominates frame yield.

Measured **[MEASURED]**, ARUCO_MIP_36h12, one marker present:

| canvas | ms | fps |
|---|---|---|
| 400×400 | 6.14 | 163 |
| 640×480 | 8.27 | 121 |
| 1280×720 | 20.84 | 48 |

Per-stage at 640×480 — **this is the table to design against**:

| stage | ms | share |
|---|---|---|
| `grayscale` | 0.79 | 10% |
| `adaptiveThreshold` | **2.46** | **30%** |
| `findContours` | **2.06** | **25%** |
| `findCandidates` | 1.82 | 22% |
| `findMarkers` (warp 49² + Otsu + sample + Hamming) | 1.39 | 17% |

Threshold + contours are **55% of the frame**, and both are trivially SIMD-able if you later
port to WASM. Its one ugly spot: ID matching falls back to a linear scan over 250 codes ×
4 rotations × 36 character comparisons = **36,000 string-index comparisons per unmatched
quad** — replace with integer popcount if you fork it. (qrbeam doesn't need marker IDs at
all, so this is moot.)

### 6.4 AprilTag WASM — the best size-to-capability ratio

[arenaxr/apriltag-js-standalone](https://github.com/arenaxr/apriltag-js-standalone):
**118,923 B wasm + 74,548 B emscripten glue + 7,867 B wrapper ≈ 199 KB total** **[MEASURED]**.
That is **~9× smaller than zxing-wasm's reader** and ~90× smaller than opencv.js.
Compiled with `tag36h11` only, `quad_decimate = 2.0` (halves the image before quad detection,
then refines corners at full resolution — AprilTag's own version of §5.5(a)),
`nthreads = 1`, `refine_edges = 1`. Takes a **grayscale `Uint8Array`**, returns fractional
corner coordinates and optional 6-DoF pose.

Last push **2022-07-18**, 32 stars, no npm package — you'd vendor the files. **No measured
fps figure exists** for it; do not trust one you haven't taken yourself.

**Structural verdict:** AprilTag-family tags are the wrong *payload* container (36 bits per
tag) but arguably the right *localisation* primitive — corner fiducials framing a dense
custom data field. That said, for a screen (a cooperative, high-contrast, known-geometry
target) the run-length ratio scan is cheaper and sufficient; AprilTag's machinery is built
for many small tags at long range under motion.

### 6.5 zxing-wasm — for the QR fallback mode only

[Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm) v3.1.2, **measured**:

| artefact | raw | gzip |
|---|---|---|
| `reader/zxing_reader.wasm` | 1,065,866 B (1.02 MiB) | **446,422 B** |
| `full/zxing_full.wasm` | 1,511,909 B | 717,576 B |
| ES glue | 42,595 B | 12,489 B |

A reader-only build exists (`zxing-wasm/reader`), gated at compile time. **There is no
per-format trimming** — format selection is a *runtime* option, so you cannot shrink it to
QR-only. **No SIMD, no threads** (verified: no `-msimd128`, no `USE_PTHREADS` in
`src/cpp/CMakeLists.txt`).

**Its decisive advantage for qrbeam is the binary contract**, which is *designed* rather
than incidental:

```ts
bytes: Uint8Array;      // raw, no charset conversion
bytesECI: Uint8Array;   // raw, following ECI
text: string;           // lossy rendering, controlled separately by textMode
hasECI: boolean;
```

It also gives you **structured append** for free (`sequenceIndex` / `sequenceSize` /
`sequenceId`) — worth reading before designing chunk framing from scratch — plus `position`
(4 corners), `orientation`, `isMirrored`, `isInverted`.

⚠️ **Its defaults are hostile to a real-time loop**: `tryHarder: true`, `tryRotate: true`,
`tryInvert: true`, `tryDownscale: true`, `maxNumberOfSymbols: 255`. For a scanning loop set
`{tryHarder:false, tryRotate:false, maxNumberOfSymbols:1, formats:["QRCode"]}`. Leaving the
defaults on is the most common cause of "zxing-wasm is slow" reports. **No trustworthy
in-browser decode benchmark exists** — measure it yourself.

Input types: `Blob`, `File`, `ArrayBuffer`, `Uint8Array`, `ImageData`. Not
`ImageBitmap`/`HTMLVideoElement`, so you draw to a canvas first — or duck-type an
`{data, width, height}` object from a `VideoFrame.copyTo` buffer, which works off-DOM in a
worker.

### 6.6 OpenCV.js — do not ship it

**Measured:** `docs.opencv.org/4.x/opencv.js` is **10,964,323 B (10.46 MB) raw,
3,543,154 B (3.38 MB) gzip.** `@techstark/opencv-js` is *not* smaller (11.39 MB — it's stock
opencv.js plus TypeScript declarations). There is **no official prebuilt minimal, SIMD, or
threaded build.**

A custom build is possible: `platforms/js/build_js.py` reads
`OPENCV_JS_WHITELIST` from `--config <file>`, a Python file of `{Class: [methods]}` dicts.
(This mechanism is **not documented** on the official tutorial page — you have to read
`build_js.py`.) Everything qrbeam would want — `cvtColor`, `adaptiveThreshold`,
`findContours`, `approxPolyDP`, `getPerspectiveTransform`, `warpPerspective` — lives in
**core + imgproc**, so `dnn`, `calib3d`, `features2d`, `photo`, `video` can all go.

**But the floor is ~1.5 MB regardless.**
[opencv/opencv#21431](https://github.com/opencv/opencv/issues/21431): a reporter whitelisted
**7 functions** and still got **>1.6 MB**, dropping only to **~1.5 MB** after disabling
`video` — no maintainer offered a fix. The floor is structural: `cv::Mat` drags in the whole
core type-dispatch machinery and embind generates a lot of glue per exported type.

Also: `--disable_single_file` is worth knowing about — by default the wasm is base64-embedded
in the .js, costing ~33%.

**Verdict:** ~450–550 KB gzipped *plus* a large parse/instantiate cost, for functionality
that js-aruco2 delivers in **16.6 KB of MIT JavaScript at 8.27 ms/frame @640×480**. For a
project whose entire security claim is "a static bundle you can audit once", a 10 MB opaque
WASM blob is actively hostile. **Skip it.**

### 6.7 Lighter alternatives — measured

| library | min JS | gzip | provides | maintained | licence |
|---|---|---|---|---|---|
| **js-aruco2 `cv.js`** | 16.6 KB *(unmin)* | ~4 KB | grayscale, adaptiveThreshold, otsu, box/gaussian blur, **Suzuki–Abe findContours**, approxPolyDP, isContourConvex, **bilinear warp**, getPerspectiveTransform | 2023-08 | MIT |
| **jsfeat** | 66,093 B | 22,899 B | blur, canny, sobel, integral image, pyrdown, **warp_perspective/affine**, **homography2d + RANSAC/LMedS**, ORB/FAST, Lucas–Kanade | last commit **2022-04** | MIT |
| **perspective-transform** | **4,060 B** | **1,616 B** | 4-point projective solve + point mapping | small/stable | MIT |
| **Homography.js** | 114,452 B *(unmin)* | — | affine/projective/**piecewise-affine** + image warping | active | MIT |
| **marchingsquares** | 33,551 B | 6,239 B | isolines/isobands | active | **AGPL-3.0** ⚠️ |
| tracking.js | 20,538 B | — | Viola–Jones, FAST/BRIEF | dead | BSD |
| photon-rs (wasm) | 1,880,773 B | — | filters/effects only — **no contours, no homography** | active | Apache-2.0 |

Two corrections to common assumptions, verified by enumerating the source:

- **jsfeat does NOT have contour finding.** `src/jsfeat_imgproc.js` exports exactly:
  `box_blur_gray, canny, compute_integral_image, equalize_histogram, gaussian_blur,
  grayscale, hough_transform, pyrdown, resample, scharr_derivatives, skindetector,
  sobel_derivatives, warp_affine, warp_perspective`. No `findContours`, no
  `adaptiveThreshold`, no `otsu`, no connected components. It is a **feature/optical-flow**
  library, not a shape-analysis one.
  What it *does* have and js-aruco2 lacks: `jsfeat_motion_estimator.js` contains a real
  `homography2d` kernel with **`ransac()` and `lmeds()`** estimators. So **js-aruco2's
  `cv.js` + jsfeat is a genuinely good pairing** — cv.js for threshold/contours/quads,
  jsfeat for robust homography refinement over more than 4 correspondences (which is exactly
  what you want once you add interior alignment marks, §2.3).
- **There is no small, maintained, purpose-built WASM contour/connected-components library.**
  Rust's `imageproc` has Suzuki–Abe and would compile small, but nobody has published a
  browser package. Given js-aruco2's measured 8.27 ms at 640×480 in plain JS, and a ~40 ms
  budget at 25 fps, this is not worth building.

**`perspective-transform` at 1.6 KB gzipped is the size winner** for the narrow job of
"given 4 detected corners, map cell (i,j) → source pixel (x,y)". If qrbeam ever goes the
sample-in-place route (§2.1(b)) rather than the warp route, that's the whole dependency.

---

## 7. Bits per cell that actually survive

### 7.1 The empirical evidence

The strongest evidence available is not a paper — it is libcimbar's mode history, because
those modes were tuned against real phones filming real monitors:

- **4 colours (2 bits) is the shipped default.** Author: "4-color cimbar (2 color bits)
  seems entirely reasonable"
  ([ABOUT.md](https://github.com/sz3/cimbar/blob/master/ABOUT.md)) **[MEASURED]**.
- **8 colours (3 bits) was implemented, shipped, and then marked deprecated.** `Config.h`
  still has `case 8: color_bits = 3; legacy_mode = true;` **[CODE]**, and PERFORMANCE.md
  lists mode 8C as *deprecated* despite it being the **fastest** mode measured
  (943 kbit/s vs 852) **[MEASURED]**. A mode that is 11% faster and got deprecated anyway
  is a very loud signal about reliability.
- **16 colours: "does not seem possible with the current color decoding logic... at least
  not in the small (sub-8x8) tile sizes we want to use for high data density."**
  **[MEASURED]**
- The stated reason: *"all colors in the colorset must be far enough away from each other
  such that color bleeding, reflections, and the like can be overcome"*, and colours must
  also be far from the background — "blue is a bad fit for dark mode cimbar since it tends
  to blend together with black." **[MEASURED]**
- Notably, libcimbar does **not** attempt heavy colour correction in its default path:
  *"no extensive color correction is currently done — the camera is expected to do the
  heavy lifting."* **[CODE/MEASURED]** Its later CCM work exists precisely because that
  assumption was not good enough.

Academic systems report higher numbers, but almost universally with tripod-mounted phones
under controlled lighting — treat every "16-colour" or "64-QAM" claim in the screen-camera
literature as an upper bound that does not survive a coffee shop.

### 7.2 The theory that explains it

Two independent limits stack:

1. **Chroma is quarter-resolution twice over (§3.1).** The Bayer CFA samples R and B at half
   the linear luma rate, *then* Chrome's capture path decimates 2× again in each axis.
   Small colour cells are *physically* less reliable than small luma cells, by construction,
   before any ISP misbehaviour.
2. **Colour is the axis the ISP mangles most.** AWB is a per-frame, scene-dependent 3×3
   matrix you cannot lock on iOS. Saturation boosts, "vivid" display modes and
   colour-space mismatches (sRGB vs Display-P3) all warp the palette. Luma level is warped
   by exposure and the tone curve — one dimension, monotonic, easily calibrated out.
   Chroma is warped in three dimensions, non-monotonically.

**Do the arithmetic in bits per *camera pixel*, which is the resource that's actually
scarce [DERIVED]:**

- **Luma only:** 8 levels (3 bits) at cell size `C` → `3/C²` bits per camera pixel.
- **Colour:** 8 luma levels + 2 chroma axes at 3 levels each ≈ 3 + 3.17 = 6.17 bits/cell —
  but needing cell size `2C` for equal reliability → `6.17/(2C)² = 1.54/C²`.

**Luma-only wins by ~1.95×.** More than a factor of two once you also account for chroma
being the channel AWB drift attacks and chromatic aberration smears at the frame edges.

**And the literature converged on this independently — five groups, five intensity-like
channels:**

| System | Channel chosen | Stated reason |
|---|---|---|
| **HiLight** (MobiSys'15) | **alpha channel** | alpha blending *"always dims or brightens a pixel… regardless of the pixel's original color,"* whereas setting a value in a colour channel *"does not uniformly dim or brighten pixels in all colors"* |
| **DeepLight** (IPSN'21) | intensity of the **blue channel only** | one channel, intensity, not hue |
| **ChromaCode** (MobiCom'18) | **CIELAB lightness** | perceptually uniform lightness modification, explicitly chosen over HSL hue |
| **Revelio** (2025) | **lightness**, weighted most (ω=0.27 vs γ=0.03) | tested RGB, CIELAB, XYZ, OKLAB |
| **DisCo** (ToG'16) | monochrome by construction | *"for simplicity, a single color channel is considered"* |

Sources: [HiLight](https://www.cs.columbia.edu/~xia/publication/mobisys15-hilight/mobisys15-hilight.pdf),
[DeepLight](https://arxiv.org/abs/2105.05092),
[ChromaCode](https://walleve.github.io/ChromaCode/),
[Revelio](https://arxiv.org/html/2501.02349v1),
[DisCo](https://cave.cs.columbia.edu/old/publications/pdfs/Jo_TOG16.pdf). All **[LAB]**.

The prominent colour-heavy academic system, **COBRA** (MobiSys'12), could not be retrieved
(ACM 403) — ⚠️ **no verified numbers from it.** And notably: **no study directly measuring
4:2:0's effect on a colour barcode appears to exist.** The §3.1 and §7.2 numbers here are
derived, not measured. That is a genuine gap, and it is a gap qrbeam could cheaply fill with
its own instrumentation (§10.3).

### 7.3 Recommendation

| Scheme | bits/cell | Verdict |
|---|---|---|
| Binary (black/white) | 1 | Guaranteed. This is QR. |
| **4 luma levels** | **2** | **Safe.** Monotonic, one-dimensional, trivially calibrated with 4 reference cells. Recommended v1. |
| **4 colours (e.g. K/R/G/B or K/C/M/Y)** | **2** | **Safe** — validated by libcimbar's shipped default. Needs ≥6 camera px/cell. |
| **4 luma × 4 colours** | **4** | **Plausible but unproven at qrbeam's cell sizes.** This is the interesting target. Treat as a measured upgrade, not an assumption. |
| 8 colours | 3 | **Risky.** Implemented and deprecated by the one team with real-world data. Only with large cells (≥8 camera px) and full per-frame palette calibration. |
| 16 colours | 4 | **No.** Explicitly reported as not working at small cell sizes. |
| 8 luma levels | 3 | **Risky but more defensible than 8 colours**, because luma survives 4:2:0 at full resolution and the distortion is one-dimensional. Requires ≥7 camera px/cell and per-frame level calibration. Worth measuring. |

**Defensible recommendation: design for 2 bits/cell, build the calibration machinery that
would let you reach 4, and let the receiver negotiate.** Concretely: ship v1 at 2 bits/cell
(4 luma levels), and have the sender's frame header advertise the mode so a future 4-bit
mode is a compatible extension. **Do not bet the architecture on 3+ bits/cell surviving
handheld.**

Note the arithmetic that motivates all this **[DERIVED]**: a QR Version 40 at ECC level L
holds 2,953 bytes across 177² = 31,329 modules — **0.75 bits per module of *payload*.** A
96×96 grid at 2 bits/cell with 25% ECC and 5% calibration overhead yields
`9216 × 2 / 8 × 0.75 × 0.95 ≈ 1,640 bytes` in a *quarter* the cells. Per cell that's
**1.42 payload bits vs QR's 0.75 — a ~1.9× density win at the same 2 bits/cell**, purely
from not paying QR's overhead (format info, timing patterns, mandatory masking, alignment
patterns, and an ECC design meant for torn printed labels). At 4 bits/cell it's ~3.8×.

---

## 8. Proposed receiver pipeline

Ordered stages, with the budget from §5.6. Stages marked **[GPU]** are the phase-2 port.

```
                                              est. ms (mid-range Android, 1080p in)
 ┌────────────────────────────────────────────────────────────────────────────┐
 │  MAIN THREAD                                                               │
 │                                                                            │
 │  0. video.requestVideoFrameCallback(cb)          ─ scheduling only    ~0   │
 │  1. vf = new VideoFrame(videoEl)                                       0.1 │
 │  2. vf.copyTo(buf)  — keep native NV12/I420, DO NOT request RGBA    1 – 3  │
 │  3. postMessage(buf, [buf.buffer]) → least-loaded worker               ~0  │
 │     (cap frames-in-flight; drop frames rather than queue them)             │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼─────────────────────────────────────────┐
 │  WORKER  (pool of 2–4; each handles a WHOLE frame — no intra-frame split)  │
 │                                                                            │
 │  4. Wrap Y plane as a full-res grayscale view       (zero copy)       ~0   │
 │  5. Downscale Y 3× → search image (640×360)                          2 – 4 │
 │  6. Gaussian blur (≈5 px) + Otsu global threshold on search image    2 – 4 │
 │  7. Run-length ratio anchor scan: 1:1:3:1:1 over every Nth row       1 – 3 │
 │       → confirm on column, then both diagonals, dedupe, sort              │
 │       BAIL EARLY if < 3 anchors  ← the common case; must be cheap          │
 │  8. Recover 4th corner; chase the 4 edges for midpoints              1 – 2 │
 │  9. Refine corners to sub-pixel on the FULL-res Y plane              1 – 2 │
 │ 10. Solve 3×3 homography (canonical grid → source px)                <0.1  │
 │ 11. Sanity gate: area, aspect, convexity, min cell size in px         ~0   │
 │       BAIL if the grid would be < 4 camera px/cell (too far away)         │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 12. WARP + REDUCE  ── one output texel per cell, interior box average      │
 │       CPU: warp Y (and U,V at half res) → C×C arrays          8 – 20      │
 │       [GPU]: single draw call to a C×C FBO, async PBO readback  <1 + 1     │
 │ 13. Read calibration ring → per-palette-entry observed centroids     ~0.5  │
 │       bilinear-interpolate the palette map across the frame               │
 │ 14. Classify every cell: nearest centroid in (Y,U,V), using the           │
 │       LOCAL interpolated palette; record a confidence margin         1 – 2 │
 │ 15. Read header cells (top + bottom copies): mode, frame ID, CRC     ~0    │
 │       If top ID ≠ bottom ID → torn; fall through to per-band decode        │
 │ 16. De-interleave; per-band ECC decode (RS or LDPC)                  3 – 8 │
 │       erasure hints from step 14's confidence margins                     │
 │ 17. Verify per-band CRC; emit surviving bands                        ~0    │
 │ 18. postMessage(bands) → main thread                                 ~0    │
 └────────────────────────────────────────────────────────────────────────────┘
                                    │
 ┌──────────────────────────────────▼─────────────────────────────────────────┐
 │  MAIN THREAD                                                               │
 │ 19. Fountain-decode ingest (dedupe by band ID)                       1 – 3 │
 │ 20. On completion: whole-file hash check → download                        │
 └────────────────────────────────────────────────────────────────────────────┘

   TOTAL, CPU path:  ~22 – 53 ms per frame, single worker
                     → 2–4 workers pipelined ⇒ sustains 30 fps input
   TOTAL, GPU path:  ~12 – 28 ms per frame
```

**The most important structural properties of this pipeline:**

- **Steps 5–7 are the hot path and must bail fast.** Most camera frames contain no code at
  all (user is aiming, moving, or the frame is blurred). The anchor scan running on a
  downscaled image with sparse row sampling costs ~5 ms and rejects those frames before any
  expensive work. libcimbar's own receiver treats `failed_extract` as "very common, nothing
  to do" **[CODE]**.
- **Parallelism is across frames, not within a frame.** No `SharedArrayBuffer`, no
  cross-origin isolation, no hosting constraints (§5.7).
- **Step 13 is what makes it robust.** Everything the ISP did — gamma, exposure, white
  balance, tone curve, vignetting — is absorbed by measuring the palette in the same frame
  it is used in.
- **Step 16's erasure hints are nearly free and worth a lot.** A cell whose nearest-centroid
  margin is small is probably wrong; telling the ECC decoder *which* symbols to distrust
  roughly doubles the correction power of a Reed–Solomon code (erasures cost half what
  errors do).

---

## 9. Proposed frame layout

Sketch for a **96×96 cell** grid. All dimensions are in cells.

```
   ◄───────────────────────────── 96 cells ─────────────────────────────►
 ┌─────────────────────────────────────────────────────────────────────────┐  ▲
 │ ███████ ░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█  ███████ │  │
 │ █┌───┐█ ┌─────────────────────────────────────────────────────┐ █┌───┐█ │  │
 │ █│███│█ │  H E A D E R   (top copy) — 96×2, heavily protected  │ █│███│█ │  │
 │ █└───┘█ │  mode | grid dims | frame ID | band count | CRC-16   │ █└───┘█ │  │
 │ ███████ └─────────────────────────────────────────────────────┘ ███████ │  │
 │ ░▒▓█ ┌───────────────────────────────────────────────────────────┐ ░▒▓█ │  │
 │ ▓█░▒ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 0 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ▓█░▒ │  │
 │ █░▒▓ │  id·payload·ECC — independently decodable, 96×10 cells   │ █░▒▓ │  │
 │ ░▒▓█ ├───────────────────────────────────────────────────────────┤ ░▒▓█ │  │
 │ ▓█░▒ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 1 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ▓█░▒ │  │
 │ █░▒▓ ├──────────────────────┬═════╪══════────────────────────────┤ █░▒▓ │  │
 │ ░▒▓█ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND│ ✚  │▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ░▒▓█ │  │
 │ ▓█░▒ ├──────────────────────┴═════╪══════────────────────────────┤ ▓█░▒ │  9
 │ █░▒▓ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 3 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ █░▒▓ │  6
 │ ░▒▓█ ├───────────────────────────────────────────────────────────┤ ░▒▓█ │  │
 │ ▓█░▒ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 4 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ▓█░▒ │  │
 │ █░▒▓ ├──────────────────────┬═════╪══════────────────────────────┤ █░▒▓ │  │
 │ ░▒▓█ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND│ ✚  │▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ░▒▓█ │  │
 │ ▓█░▒ ├──────────────────────┴═════╪══════────────────────────────┤ ▓█░▒ │  │
 │ █░▒▓ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 6 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ █░▒▓ │  │
 │ ░▒▓█ ├───────────────────────────────────────────────────────────┤ ░▒▓█ │  │
 │ ▓█░▒ │ ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ BAND 7 ▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪ │ ▓█░▒ │  │
 │ ░▒▓█ └───────────────────────────────────────────────────────────┘ ░▒▓█ │  │
 │ ███████ ┌─────────────────────────────────────────────────────┐ ███████ │  │
 │ █┌───┐█ │  H E A D E R   (bottom copy — identical to top)      │ █┌───┐█ │  │
 │ █│███│█ │  mismatch between copies ⇒ frame is TORN             │ █│███│█ │  │
 │ █└───┘█ └─────────────────────────────────────────────────────┘ █└───┘█ │  │
 │ ███████ ░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█░▒▓█  ███████ │  ▼
 └─────────────────────────────────────────────────────────────────────────┘

   LEGEND
   ███ ┌─┐   FOUR anchors, 7×7 cells each, concentric-square 1:1:3:1:1 pattern.
       └─┘   Four, not three: any one may be occluded (glare, a cursor, a thumb)
             and the homography still solves — plus a free consistency check.
             Their inner white ring doubles as a white-point reference.

   ░▒▓█      CALIBRATION RING, 1 cell wide, all four edges. Cycles through the
             full palette (all L levels) plus reference black and white.
             ~380 cells = 4.1% of the grid. Read FIRST; yields the per-frame,
             per-region palette centroids that make gamma/AWB/AE/flare irrelevant.
             The LEFT and RIGHT columns do double duty: they give one known
             level per cell-row, which is exactly what is needed to divide out
             DisCo's row-only gain g(y) — rolling-shutter row gain, OLED PWM
             banding, LCD backlight strobing and vignetting, all at once (§3.2).
             A discontinuity in g(y) IS the tear detector.

   ✚         ALIGNMENT MARKS, a fixed 3×3 pattern at interior lattice points
             (here 2 shown; use a 3×3 or 4×4 array of them). Correct the residual
             lens distortion the 4-corner homography cannot express. QR's
             alignment patterns, serving the same purpose.

   HEADER    96×2 cells, replicated top AND bottom, at the strongest ECC rate.
             Carries: magic/version, mode (bits-per-cell, palette id), grid dims,
             frame ID (fountain block id), band count, payload length, CRC-16.
             The top/bottom pair is the rolling-shutter tear detector.

   BAND n    Payload. Each band is independently ECC-coded and independently
             CRC'd and carries its own copy of the frame ID. A torn frame loses
             ONE band, not the frame. Bytes within a band are interleaved across
             the band's full width so a glare blob becomes scattered erasures.
             NOTE: for true band decoding the frame ID must be recoverable
             PER CELL-ROW, not just per band — encode a few bits of it into the
             calibration ring's row pattern so a tear anywhere is attributable.

   CAPACITY (96×96 = 9,216 cells, 2 bits/cell)
     anchors      4 × 7×7                    =   196 cells
     calib ring   4 × 96 − 4                 =   380 cells
     alignment    9 × 3×3                    =    81 cells
     header       2 × 96 × 2                 =   384 cells
     ─────────────────────────────────────────────────────
     overhead                                  1,041 cells  (11.3%)
     payload cells                             8,175
     raw payload  8,175 × 2 / 8               = 2,044 B
     after 25% ECC                            ≈ 1,533 B / frame

   THROUGHPUT (sender 15 fps = N=4 refreshes/frame on a 60 Hz panel)
     bright screen, T_r=5.3ms T_e=2ms  → P(clean) ≈ 89%   (§3.5)
       1,533 B × 15 × 0.89                    ≈ 20.5 KB/s   at 2 bits/cell
     AE opened up (dim room), T_e=16.7ms → P(clean) ≈ 67%
       1,533 B × 15 × 0.67                    ≈ 15.4 KB/s
     slow sensor + dim, T_r=25ms         → P(clean) ≈ 37%
       1,533 B × 15 × 0.37                    ≈  8.5 KB/s   ← plan for this
     with 8-band decode at 30 fps                ≈ 30 – 39 KB/s
     at 4 bits/cell (only if measurement supports it) ≈ 2× the above

   The spread between the best and worst rows is 2.4×, and it is driven almost
   entirely by whether auto-exposure picks a short exposure — i.e. by whether the
   user filled the frame with a bright screen. That is a UX problem, not a codec
   problem, and it is worth more than any coding-gain optimisation.
```

For comparison, animated QR Version 40-L at 15 fps with the same 89% delivery is
`2,953 × 15 × 0.89 ≈ 39 KB/s` on paper — but a Version 40 QR has 177 modules across, needing
~3 camera px each = 531 camera px, which is comfortable, whereas real animated-QR
implementations are usually forced down to Version 15–25 by decoder reliability, landing
around 5–12 KB/s. **The custom codec's win is not raw bits — it is that its overhead is
tuned for this channel instead of for damaged printed labels, and that it can carry its own
calibration.**

---

## 10. Recommendations for qrbeam

### 10.1 Is a custom codec feasible in a browser?

**Yes — this is settled, not speculative.** libcimbar ships a WASM receiver
(`cimbard_scan_extract_decode`) driven from `requestVideoFrameCallback` + WebCodecs
`VideoFrame`, in a worker pool, and decodes a *harder* codec than qrbeam needs at
~15 fps on a 2016 mid-range SoC. qrbeam's proposed codec — no per-cell shape matching, just
an interior average and a nearest-centroid lookup — is materially cheaper per cell.

The browser-specific risks are all known and all have known answers:

| Risk | Answer |
|---|---|
| `getImageData` too slow | Don't use it. `VideoFrame.copyTo` in native NV12/I420, read plane 0. |
| Chroma subsampling destroys colour | Real, and mandatory — Chrome decimates to 4:2:0 even when the sensor could do better. Put **all** data in **luma**; colour only for large fiducials. |
| Can't lock AWB/AE (especially iOS) | Don't try. Per-frame in-band level calibration inverts *any* monotone distortion exactly. |
| Flare crushes the dark levels | 2% flare shrinks the bottom step 2.6× (§3.3). Lift the lowest level to 15–20%; calibrate per frame. |
| Rolling-shutter tearing / blending | Hold each frame 3–4 refreshes; fill the frame with a bright screen so AE picks a short exposure; banded payload later. |
| Row-wise gain (PWM, vignetting, tear) | Reference **columns** down both edges; divide out DisCo's `g(y)`. One mechanism, five impairments. |
| EIS warps frames | Harmless if you re-solve the homography every frame — which you must anyway. |
| GPU readback stalls | WebGL2 `PIXEL_PACK_BUFFER` + fence, or WebGPU `mapAsync`. Never read the canvas. |
| WASM threads need COOP/COEP | Don't use threads. Worker pool across frames. |
| OpenCV.js bundle size | Don't ship it (10.46 MB; ~1.5 MB floor even trimmed). Start from js-aruco2's 16.6 KB `cv.js`. |
| Unbounded decode time on textured frames | Cap candidate count *before* per-candidate scoring. jsQR's miss path blows up 79× on noise (§5.5). |
| iOS camera stream silently pauses | Known libcimbar bug; 1 s watchdog + re-init. |

### 10.2 The real risk — and it is not the browser

**The biggest risk is that the achievable cell size is set by the *sender's screen size and
the user's distance*, not by anything you can engineer.** §3.4:

- Laptop screen at 30 cm → ~1,325 camera px → a ~165-cell grid at 8 px/cell. Comfortable.
- **Phone screen at 30 cm → ~327 camera px → a ~54-cell grid.** That is *one ninth* the
  cells, and phone→phone is a headline use case for qrbeam ("AirDrop doesn't talk to
  Android").

This is a physical limit, not a software one. **Consequences for the design:**

1. **The frame layout must be resolution-adaptive**, with the grid size in the header, and
   the sender must pick a mode from its own screen size. libcimbar does exactly this
   (`Conf8x8`, `Conf8x8_mini`, `Conf8x8_micro`) — and its receiver *cycles through modes on
   successive frames* to auto-detect **[CODE]**. Copy that.
2. **The receiver must measure camera-px-per-cell from the detected homography and tell the
   user to move closer.** This is a UX feature, not a nicety — it is the difference between
   "this doesn't work" and "hold it 15 cm away."
3. **Do not let the codec design assume the laptop case.**

The second-biggest risk is subtler: **you will build this, it will work beautifully on your
desk, and then fail in a coffee shop.** Overhead fluorescent flicker (100/120 Hz) beats
against the camera's exposure and produces horizontal banding; a window behind the sender
drives the ISP to under-expose the screen; a glossy screen picks up a light fixture. Every
one of these is a *contrast* problem, and the mitigation is the same: dark background,
bright cells, generous level separation, per-frame calibration, and enough ECC to eat a
10% blob. **Test in bad conditions early and often, or the numbers in this document are
fiction.**

Third: **no back-channel means no adaptation.** The sender cannot learn that its frame rate
is too high or its palette too dense. Every parameter must be either conservative or
user-selectable. libcimbar exposes an FPS slider (5–20) and a mode selector for exactly this
reason. qrbeam should too.

### 10.3 Minimum viable version

Build in this order. Each step is independently shippable and each de-risks the next.

**MVP-0 — prove the loop (do this before designing anything else).**
Animated QR, as already planned. Not throwaway: it establishes the fountain-coding layer,
the framing layer, the file-reassembly layer, the UI, and — critically — a **test harness**
that can measure real decode rates on real devices. Everything below is measured against it.

**MVP-1 — the custom codec, deliberately conservative.**

- **2 bits/cell, 4 luma levels** at `{48, 117, 186, 255}` — evenly spaced in sRGB code
  value (§3.3 shows the round trip is gamma-neutral, so even code spacing is *correct*),
  with the floor lifted off 0 to escape the flare-crushed region. **No colour.** Luma alone
  dodges mandatory 4:2:0, the Bayer CFA's half-rate chroma, AWB drift, saturation boosts
  and colour-space mismatch in one move, and costs only 1 bit/cell relative to the plausible
  4-colour design — for which the bits-per-camera-pixel arithmetic (§7.2) says luma wins
  anyway, by ~1.95×.
- **Grid: adaptive, header-declared.** Start with three modes (~56, ~96, ~144 cells across)
  chosen by the sender from its own viewport size; receiver auto-detects by trying modes
  round-robin.
- **Four anchors**, 1:1:3:1:1 concentric squares, run-length ratio scan (jsQR's
  `locator.ts` is the reference).
- **Calibration ring**, 1 cell wide, all four edges, all levels plus black and white — and
  use the left/right columns for per-row gain normalisation from day one. It is the cheapest
  robustness in the whole design.
- **Header replicated top and bottom** — this alone gives you tear detection for two rows
  of cells.
- **Whole-frame decode** (no banding yet). Sender holds each frame for **4 display
  refreshes** (15 fps on a 60 Hz panel), with a user-visible slider.
- **CPU-only.** rVFC → `VideoFrame.copyTo` → **plane 0 (Y) only** → worker pool →
  warp → interior average → nearest-centroid against *measured* levels → Reed–Solomon →
  existing fountain layer. Start from js-aruco2's `cv.js` (16.6 KB, MIT) rather than
  writing the primitives from scratch or shipping OpenCV.js.
- **Guard band**: 1 dead pixel between cells; sample the middle 50% of each cell. This is
  not fussiness — ISP edge enhancement makes boundary pixels actively *wrong*, not merely
  blurred (§3.1).
- **Sender-side shake** (±8 px, 4-position cycle) plus **±1 refresh jitter** on the hold
  duration. Free, and between them they defeat moiré lock, ISP temporal denoising, and
  tear-position lock-in.
- **UX is a performance feature.** The receiver must show a target rectangle and actively
  tell the user to *fill it with the screen* and *turn screen brightness up*. §3.5/§3.6 show
  this is worth up to 2.4× in throughput — more than any coding optimisation on the table.
- **Instrument everything**: anchors found/frame, camera-px-per-cell, `VideoFrame.format`,
  `colorSpace.fullRange`, per-cell confidence margin histogram, frames clean vs torn vs
  failed, and the measured level map. You cannot tune this codec without those numbers, and
  they double as the honest UI ("move closer", "too much glare").

**MVP-2 — the measured upgrades, in expected-value order.**

1. **Banded payload** (8 bands, independent ECC + CRC + frame ID). Roughly doubles goodput
   by letting the sender run at the full camera rate. Highest value, moderate complexity.
2. **Erasure hints from confidence margins** into the ECC decoder. Nearly free, large
   gain.
3. **Colour as a second dimension** (4 luma × 4 colours = 4 bits/cell), gated on measured
   SER from MVP-1's instrumentation, and only enabled when the measured camera-px-per-cell
   is ≥6.
4. **GPU warp+reduce** via WebGL2 with `PIXEL_PACK_BUFFER` async readback. Only if
   profiling says the warp is the bottleneck — and it must be benchmarked against the CPU
   path on a real mid-range phone, because a botched readback makes it slower.

**Explicitly out of scope for v1:** Deltille grids, ArUco/AprilTag markers, OpenCV.js,
WASM threads, 8+ colours, 16-level luma, per-row decoding, and any scheme that requires
locking camera parameters.

### 10.4 Run this probe before writing any codec

Several load-bearing facts in this document are device-dependent and unverified on the
actual target hardware. Ten minutes with this on a real Pixel and a real iPhone is worth
more than any citation above.

```js
// worker context — MediaStreamTrackProcessor is worker-only in Safari
const track = stream.getVideoTracks()[0];
console.log('capabilities:', JSON.stringify(track.getCapabilities()));
console.log('settings:',     JSON.stringify(track.getSettings()));
//   ^ does exposureMode/exposureTime/iso/whiteBalanceMode appear at all?

const { value: frame } = await new MediaStreamTrackProcessor({track})
                                 .readable.getReader().read();
console.log('format:', frame.format);                    // I420? NV12? something else?
console.log('colorSpace:', JSON.stringify({
  primaries: frame.colorSpace.primaries,
  transfer:  frame.colorSpace.transfer,
  matrix:    frame.colorSpace.matrix,
  fullRange: frame.colorSpace.fullRange,                 // <-- limited vs full range
}));
const buf = new Uint8Array(frame.allocationSize());
await frame.copyTo(buf);                                 // then histogram plane 0
frame.close();
```

The three answers that matter: **`frame.format`** (confirms or refutes mandatory 4:2:0 on
iOS), **`colorSpace.fullRange`** (settles whether Y is [16,235] or [0,255]), and **which
keys appear in `getCapabilities()`** (settles what, if anything, you can lock on your actual
device population).

Then, with the app: display a full-black and a full-white frame and check whether the
received Y actually reaches the extremes; display a level ramp and record the measured
curve; and record `T_r`/`T_e` indirectly by displaying a fast-alternating pattern and
measuring the tear-band height.

**Open questions this research could not close** — stated plainly so nobody assumes they
were checked:

1. iOS Safari's camera `VideoFrame.format` — no authoritative source; AVFoundation defaults
   make NV12 video-range the strong prior, but it is a prior.
2. Android rolling-shutter readout times in **browser** capture modes — no rigorous
   measurements found anywhere. The 5.3 ms iPhone figure is a ProRes mode.
3. Quantified frame-to-frame AWB/AE drift for a phone filming a screen — appears genuinely
   absent from the literature.
4. Measured MTF50 (cycles/pixel) for current phone cameras — would sharpen §3.4 materially.
5. A direct study of 4:2:0's effect on a colour barcode — probably does not exist. The
   §3.1/§7.2 numbers are derived.
6. Measured in-browser decode times for **zxing-wasm** and **apriltag-js-standalone** — both
   publish none; benchmark rather than trust.
7. Sources blocked outright: the Chromium issue tracker (Google auth), ACM DL full texts
   including **RollingLight** and **COBRA** (403), ScienceDirect including **CALC** (403),
   and the ROHM/ST OIS whitepapers.

### 10.5 The one-sentence version

A custom codec is feasible, has been done, and is worth roughly 2–4× QR's density on this
channel — but the win comes from **per-frame in-band calibration and a layout tuned for
screens**, not from cramming more bits into each cell, and the binding constraint is the
sender's screen size in camera pixels, which no amount of clever decoding can change.

---

## Appendix A — source index

Working code read directly for this document:

| File | What it establishes |
|---|---|
| [`extractor/ScanState.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/extractor/ScanState.h) | The 6-state run-length ratio machine (1:1:4:1:1 and 1:2:2:2:1 variants) |
| [`extractor/Scanner.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/extractor/Scanner.h) | Blur+Otsu preprocess, sparse row scan (`skip = min(h,w)/60`), column/diagonal confirm, 4th-corner triangulation, edge chase |
| [`extractor/Deskewer.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/extractor/Deskewer.h) | `getPerspectiveTransform` + `warpPerspective(INTER_LINEAR)` — full warp, not per-cell sampling |
| [`cimb_translator/Cell.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/Cell.h) | Interior-only mean over a cell sub-rectangle |
| [`cimb_translator/CimbDecoder.cpp`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CimbDecoder.cpp) | Relative-colour space `{r−g, g−b, b−r}`, per-cell auto-levels, CCM application |
| [`cimb_translator/CimbReader.cpp`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CimbReader.cpp) | von Kries white-point adaptation from 3 anchor patches; least-squares 3×3 CCM from known-content header cells |
| [`cimb_translator/CellDrift.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/CellDrift.h) | ±7 px per-cell drift with 3×3 neighbourhood search |
| [`cimb_translator/GridConf.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimb_translator/GridConf.h) | All mode geometries; `cell_spacing = cell_size + 1` guard band |
| [`web/recv.js`](https://github.com/sz3/libcimbar/blob/master/web/recv.js) | The browser receiver: rVFC + `VideoFrame.copyTo` + worker pool + NV12/I420 fast path + iOS pause watchdog + mode auto-detect |
| [`web/recv-worker.js`](https://github.com/sz3/libcimbar/blob/master/web/recv-worker.js) | WASM heap buffer reuse, format tagging, transferable results |
| [`cimbar_js/cimbar_recv_js.cpp`](https://github.com/sz3/libcimbar/blob/master/src/lib/cimbar_js/cimbar_recv_js.cpp) | `cimbard_scan_extract_decode` — the WASM decode entry point; NV12/I420→RGB conversion |
| [`gui/gl_2d_display.h`](https://github.com/sz3/libcimbar/blob/master/src/lib/gui/gl_2d_display.h) | "shakycam": ±8/1080 four-position sender jitter |
| [`web/send.js`](https://github.com/sz3/libcimbar/blob/master/web/send.js), [`web/index.html`](https://github.com/sz3/libcimbar/blob/master/web/index.html) | Sender frame pacing; FPS slider 5–20, **default 15** |

Other browser CV source read at line level: jsQR
([binarizer](https://github.com/cozmo/jsQR/blob/master/src/binarizer/index.ts),
[locator](https://github.com/cozmo/jsQR/blob/master/src/locator/index.ts),
[extractor](https://github.com/cozmo/jsQR/blob/master/src/extractor/index.ts)),
[qr-scanner](https://github.com/nimiq/qr-scanner/blob/master/src/qr-scanner.ts),
[js-aruco2 `cv.js`](https://github.com/damianofalcioni/js-aruco2/blob/master/src/cv.js),
[apriltag-js-standalone `apriltag_js.c`](https://github.com/arenaxr/apriltag-js-standalone/blob/master/src/apriltag_js.c),
[zxing-wasm `CMakeLists.txt`](https://github.com/Sec-ant/zxing-wasm/blob/main/src/cpp/CMakeLists.txt),
[OpenCV `build_js.py` / `opencv_js.config.py`](https://github.com/opencv/opencv/blob/4.x/platforms/js/build_js.py),
[jsfeat `jsfeat_imgproc.js`](https://github.com/inspirit/jsfeat/blob/master/src/jsfeat_imgproc.js).

## Appendix B — external source index

**Browser / platform**

- Chromium media-dev — **NV12/I420-only capture**: https://groups.google.com/a/chromium.org/g/media-dev/c/qFmr-Y62ePI
- Chromium Android capture backend (AE/AWB gating, `YUV_420_888`): https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java
- W3C MediaStream Image Capture (`exposureTime` units, `MeteringMode`): https://www.w3.org/TR/image-capture/
- W3C mediacapture-image explainer: https://github.com/w3c/mediacapture-image/blob/main/explainer.md
- Media Capture — "no canonical binary form": https://mozilla.github.io/webrtc-w3c/getusermedia.html
- MDN `VideoFrame.format` / `copyTo` / `MediaTrackConstraints` / `createImageBitmap`
- WebKit Safari 17.4 (`whiteBalanceMode` only): https://webkit.org/blog/15063/webkit-features-in-safari-17-4/
- WebKit Safari 18.4 (Image Capture API, stale `getSettings()` fix): https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- WebKit — **WebGPU shipping in Safari 26** (macOS/iOS/iPadOS): https://webkit.org/blog/16993/news-from-wwdc25-webgpu-now-available-in-safari-tech-preview/
- WebKit bug 235002 — WebGL readPixels slowness, FBO-vs-canvas workaround: https://bugs.webkit.org/show_bug.cgi?id=235002
- three.js #22779 — sync readback "tens of ms on PC, more on mobile": https://github.com/mrdoob/three.js/issues/22779
- `requestVideoFrameCallback` guide + support matrix: https://web.dev/articles/requestvideoframecallback-rvfc
- opencv/opencv#21431 — **~1.5 MB floor for a 7-function OpenCV.js build**: https://github.com/opencv/opencv/issues/21431
- `coi-serviceworker` (COOP/COEP on static hosts): https://github.com/gzuidhof/coi-serviceworker

**Colour science / sampling**

- sRGB transfer function: https://en.wikipedia.org/wiki/SRGB
- Chroma subsampling: https://en.wikipedia.org/wiki/Chroma_subsampling
- Bayer filter, Quad-Bayer/Nonacell, OLPF absence on phones: https://en.wikipedia.org/wiki/Bayer_filter
- Leung, Jeon & Dubois, *Least-Squares Luma-Chroma Demultiplexing* (IEEE TIP) — chroma carriers at Nyquist corners: https://site.uottawa.ca/~edubois/lslcd/article/TIP-06195-2010.R1_2col.pdf
- Limited vs full range: https://www.mpegflow.com/topics/color/limited-vs-full-range
- Imatest AWB methodology (no magnitudes): https://www.imatest.com/docs/auto-white-balance/

**Screen–camera communication literature**

- **HiLight** (MobiSys'15) — alpha-channel modulation, grid-size sweep, <15 Hz filtering, OLED preference: https://www.cs.columbia.edu/~xia/publication/mobisys15-hilight/mobisys15-hilight.pdf
- **DisCo** (ACM ToG'16) — `i(x,y) = i_tex(x,y)·g(y)`, per-interval decoding: https://cave.cs.columbia.edu/old/publications/pdfs/Jo_TOG16.pdf
- **LightSync** (MobiCom'13) — unsynchronised screen–camera links, 8–30 fps device spread: https://dl.acm.org/doi/abs/10.1145/2500423.2500437
- **ChromaCode** (MobiCom'18) — CIELAB lightness: https://walleve.github.io/ChromaCode/
- **DeepLight** (IPSN'21) — blue-channel intensity: https://arxiv.org/abs/2105.05092
- **Revelio** (2025) — lightness-weighted colour-space comparison: https://arxiv.org/html/2501.02349v1
- **Deltille grids** (ICCV'17) — triangular lattice, +10% corner accuracy: https://ieeexplore.ieee.org/document/8237833
- ⚠️ *Not retrieved:* **RollingLight** (MobiSys'15) https://dl.acm.org/doi/10.1145/2742647.2742651 · **COBRA** (MobiSys'12) https://dl.acm.org/doi/10.1145/2307636.2307645 · **CALC** ambient-light calibration https://www.sciencedirect.com/science/article/pii/S2666950121000705

**Rolling shutter / optics / motion**

- Rolling shutter mechanism and flicker artifacts: https://en.wikipedia.org/wiki/Rolling_shutter
- CineD — **measured iPhone 15 Pro readout times**: https://www.cined.com/iphone-15-pro-lab-test-rolling-shutter-dynamic-range-and-exposure-latitude/
- Crowdsourced sensor readout database (no smartphones): https://horshack-dpreview.github.io/RollingShutter/
- Hand tremor 5–12 Hz: https://www.nature.com/articles/s41598-022-21310-4
- Pixels-per-module, Cognex 2.5 PPM claim **[WEAK]**: https://www.rrfloody.com/techbriefs/pixels-per-module.html

**libcimbar / cimbar**

- [PERFORMANCE.md](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md) · [DETAILS.md](https://github.com/sz3/libcimbar/blob/master/DETAILS.md) · [cimbar ABOUT.md](https://github.com/sz3/cimbar/blob/master/ABOUT.md) · [HN discussion with the author](https://news.ycombinator.com/item?id=25459501)

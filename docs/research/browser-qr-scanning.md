# Browser QR Scanning — Receiver-Side Research

Research for **screenferry**: a static web app that transfers a file device-to-device
optically. Sender displays an animated QR sequence; receiver points a camera at
the sender's screen and decodes frames to reassemble the file.

This document covers **the receiving side only**: camera capture and QR decoding
in the browser.

> **Empirical note.** Sections 3, 4 and 6 are not literature review. Decoder
> behaviour, binary safety, latency and ROI gains were **measured directly** by
> installing each library (jsQR 1.4.0, zxing-wasm 3.1.2, @zxing/library 0.23.0,
> @nuintun/qrcode 5.0.3, rxing-wasm 0.5.7, qr-scanner 1.4.2, barcode-detector
> 3.2.1) and running them against synthetic 1920×1080 frames with controlled
> blur, noise, glare, perspective and scale. QR symbols were generated with
> `qrcode-generator` using a latin1 `stringToBytes` override so exact byte
> payloads could be controlled. Measurements were taken on
> **Node v20.19.2, x86-64 (Hetzner EX44, Ryzen)** — a mid-range phone should be
> assumed **3–5× slower**, and that scaling factor is applied wherever a phone
> number is quoted. Synthetic frames are cleaner than real camera frames in some
> ways (no rolling shutter, no chroma subsampling) and harsher in others
> (nearest-neighbour rendering creates aliasing at some scales). Treat absolute
> ms as indicative and **relative** differences between libraries as solid.

---

## 1. Camera access (`getUserMedia`)

### 1.1 What actually matters for scanning a screen at close range

Scanning an emissive display at 30–60 cm is a different problem from scanning a
printed label. The target is **bright, high-contrast, self-illuminated, flat,
and changing 10+ times a second**. That inverts several defaults:

| Concern | Printed label | Screen at close range |
|---|---|---|
| Illumination | often needs torch | **torch must be off** — specular glare |
| Focus | fixed/macro OK | **continuous AF**, close-range macro is the failure mode |
| Exposure | longer is fine | **short exposure required** — target changes |
| Motion blur | hand shake only | hand shake **+ content changing mid-exposure** |
| Contrast | paper, ~4:1 | screen, very high — binarizer rarely the bottleneck |

The dominant real-world failure is **focus**, not resolution. Phones routinely
fail to lock focus on a flat, low-texture, self-lit rectangle at close range —
the contrast-detect AF hunts because the QR's high-frequency detail aliases.

### 1.2 Constraint reference

`MediaTrackConstraints` for video are specified in
[W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/#media-track-constraints);
the camera-specific extensions (`focusMode`, `exposureMode`, `torch`, `zoom`,
`focusDistance`, `pointsOfInterest`) live in the separate
[MediaStream Image Capture](https://w3c.github.io/mediacapture-image/) spec and are
surfaced through `track.getCapabilities()` / `track.applyConstraints()`.

Critically, the image-capture extensions are **Chromium-only in practice**.
Safari (desktop and iOS) does not implement `focusMode`, `exposureMode`,
`torch`, or `zoom` as constrainable properties. See
[MDN: MediaTrackConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints)
and
[MDN: MediaTrackCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities).

**`ideal` vs `exact` vs `min`/`max`:**

- `ideal` (inside a `ConstrainDoubleRange`/`ConstrainDOMString`) is a *preference*.
  The UA picks the closest it can. **It never causes `getUserMedia` to reject.**
- `exact` is a *requirement*. If unsatisfiable, `getUserMedia` rejects with
  `OverconstrainedError`. This is the single most common cause of "camera works
  on my phone but not theirs".
- `min`/`max` are also requirements and can reject.

**Rule for screenferry: use `ideal` for everything in the primary attempt.** Reserve
`exact` only for `facingMode` in a *fallback* attempt where you can catch the
rejection.

### 1.3 Resolution

Requesting more pixels is not free and past a point is actively harmful:

- Higher capture resolution costs CPU in the capture path, in `drawImage`, in
  `getImageData`, and in the decoder (decoder cost scales roughly with pixel
  count — see §6.3, where 1080p→ROI-crop gave a **9× decode speedup**).
- A QR only needs **~2.5–3 pixels per module** to decode reliably (measured in
  §3.5). A 97-module (version 20) symbol filling ~40% of the frame width needs
  only ~400–500 px across. **720p is sufficient** for that geometry.
- Many phones deliver 1080p at 30fps but drop to lower frame rates or use
  heavier processing at 4K.

**Recommendation:** ask for `width: {ideal: 1920}, height: {ideal: 1080}` but
treat it as a ceiling, and immediately downscale/crop for decoding (§6). Do not
request 4K — it costs CPU and thermal budget for no decode benefit. Never use
`exact` on resolution.

### 1.4 Focus — the most important control

```js
// after obtaining the track
const caps = track.getCapabilities?.() ?? {};
if (caps.focusMode?.includes('continuous')) {
  await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
}
```

- `focusMode: 'continuous'` is the desired mode and is **usually the default**
  on Android Chrome, but not guaranteed — apply it explicitly when advertised.
- `focusDistance` (manual focus) is advertised by some Android devices via
  `caps.focusDistance` as a `MediaSettingsRange`. Where available it is a
  genuinely useful escape hatch for close-range macro: set it near the minimum.
  Support is sparse and device-specific — always feature-detect.
- `pointsOfInterest` lets you bias AF toward the region where the QR was last
  seen. Chromium-only, and honoured inconsistently. Worth attempting, never
  worth depending on.
- **Safari/iOS implements none of these.** On iOS you get whatever the system
  AF decides. The practical mitigations are UX-level: tell the user to hold
  ~30–40 cm away, and make the sender's QR physically large.

Because `applyConstraints` on unsupported properties can reject, always wrap in
`try/catch` and always gate on `getCapabilities()`.

### 1.5 Frame rate and exposure

Requesting 60fps is usually counterproductive. Under typical indoor light the
sensor's auto-exposure lengthens integration time; if the requested frame rate
forces shorter exposure the driver compensates with gain, producing **noise** —
and noise is exactly what destroys decode reliability (and, for jsQR
specifically, causes a catastrophic latency blowup — §3.6).

The governing constraint for animated QR is:

> **the sender's frame must be displayed for longer than the receiver's exposure
> time + sensor readout time**, otherwise a single captured frame integrates two
> different QR images and is unconditionally undecodable.

At a typical indoor exposure of 1/30 s, a sender running at 30fps guarantees that
a large fraction of captured frames straddle two symbols. This is the core
argument for a **slow sender** (§5).

`exposureMode`, `exposureTime`, `exposureCompensation`, `iso` and
`whiteBalanceMode` are Chromium-only image-capture extensions. On Android Chrome
where available, biasing exposure *down* slightly can help: the screen is a
bright source, and letting AE expose for the room over-exposes the QR to a white
blur. `exposureCompensation` toward negative, or `exposureMode: 'continuous'`
with a `pointsOfInterest` on the QR, both help.

**Recommendation:** request `frameRate: {ideal: 30}`. Do not request 60. Do not
use `exact`.

**⚠️ iOS lies about frame rate.** `frameRate: {ideal: 60}` is silently satisfied
with 30 — no error, no warning. Only `{exact: 60}` actually negotiates 60 fps
(and on iOS typically only at 1280-wide capture), at the cost of an
`OverconstrainedError` when unavailable. More generally, `{ideal:}` is frequently
ignored across implementations; adding a `min:` has been observed to change a
device from a drifting 15–20 fps to a locked 24
([addpipe](https://blog.addpipe.com/getusermedia-video-constraints/),
[amazon-chime-sdk-js#2598](https://github.com/aws/amazon-chime-sdk-js/issues/2598)).

> **Never trust the constraint — always read back `track.getSettings()`**, and
> better still measure delivered fps from rVFC callbacks (§6.1). The gap between
> requested and delivered is the first thing to check when a user reports poor
> scanning, and screenferry should surface it in a diagnostics readout.

Low-end Android adds another wrinkle: cameras often default to an ISO-priority
mode that lowers frame rate to reduce noise, so a dim room can silently halve your
capture rate.

### 1.6 Choosing the right rear camera

`facingMode: 'environment'` is necessary but **not sufficient** on modern
multi-camera Android phones. The UA may hand you an ultrawide or a depth/macro
sensor, which typically has lower resolution, worse optics, and heavy barrel
distortion at the edges — all bad for QR.

The robust pattern is: get a stream first (which grants permission and therefore
unlocks device labels), then enumerate and re-open if a better device exists.

```js
// 1. permission first — labels are empty until a stream has been granted
let stream = await navigator.mediaDevices.getUserMedia({
  video: { facingMode: { ideal: 'environment' } }, audio: false,
});

// 2. now labels are populated
const devices = (await navigator.mediaDevices.enumerateDevices())
  .filter(d => d.kind === 'videoinput');

// 3. prefer the plain rear camera; avoid ultrawide/telephoto/depth
const BAD = /ultra|wide|tele|depth|macro|infrared|truedepth/i;
const rear = devices.filter(d => /back|rear|environment/i.test(d.label));
const preferred = rear.find(d => !BAD.test(d.label)) ?? rear[0];

if (preferred && preferred.deviceId !== stream.getVideoTracks()[0].getSettings().deviceId) {
  stream.getTracks().forEach(t => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: preferred.deviceId } }, audio: false,
  });
}
```

Caveats:

- Device labels are **empty strings until permission is granted** — this ordering
  is mandatory ([MDN: enumerateDevices](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)).
- iOS labels are localised and generic ("Back Camera", "Back Dual Wide Camera",
  "Back Ultra Wide Camera"). The regex above works for English; on iOS the
  heuristic is weaker, but iOS's default `environment` choice is generally the
  correct main camera, so the fallback is fine.
- Label sniffing is a heuristic, not an API. Always fall back gracefully.

### 1.7 Torch and zoom

**Torch must be off.** It is off by default — `torch` is a boolean constrainable
property that defaults to false and only activates if explicitly requested
([MDN: torch](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints)).
screenferry should never enable it: pointing an LED at a glossy screen produces a
specular hotspot that wipes out a region of the QR. Do not offer a torch button
on the scanning screen.

`zoom` (Chromium-only, `caps.zoom` as a `MediaSettingsRange`) is genuinely useful:
if the QR occupies a small part of the frame, a modest optical/digital zoom
raises pixels-per-module without raising capture resolution. But it narrows the
field of view and makes aiming harder. Treat it as an advanced/opt-in control,
not a default.

### 1.8 What breaks on iOS Safari

This is the highest-risk platform. Concretely:

**`<video>` playback**
- The video element **must** have `playsinline` (or `playsInline` in JSX) or iOS
  will take the stream fullscreen or refuse to play inline.
- It must be `muted` and ideally `autoplay`; without `muted`, autoplay is
  blocked. Even with a `MediaStream` source, iOS applies autoplay policy.
- `video.play()` returns a promise that can reject; call it and catch.

```html
<video playsinline autoplay muted></video>
```

Omitting `playsinline` is the single most common iOS bug in browser QR scanners.

**User gesture and permission**
- `getUserMedia` requires a **secure context** (HTTPS, or `localhost` /
  `127.0.0.1` for development). A static app served over plain HTTP on a LAN IP
  will not get a camera — this matters for screenferry, which is deployed as a static
  site and may be tested from a phone against a dev server.
- iOS Safari requires the call to originate from a user gesture in practice.
  Always put camera start behind an explicit "Start scanning" button. This is
  good UX anyway and sidesteps autoplay policy.
- Historically iOS did **not persist camera permission** across page loads for
  ordinary websites, re-prompting each visit. Later iOS versions added
  per-site persistent camera/mic permission (Settings → Safari → Camera, and
  the per-site "Website Settings" sheet), but the practical guidance is
  unchanged: **assume you may be re-prompted, and never break if you are.**
  Never gate app state on a permission that you assume is already granted.

**PWA / standalone (Add to Home Screen) and WKWebView**
- `getUserMedia` was **unavailable in `WKWebView` and in standalone home-screen
  web apps for years**. It was fixed in **iOS 14.3**
  ([bugs.webkit.org #208667](https://bugs.webkit.org/show_bug.cgi?id=208667),
  resolved 2021-01-05: "WKWebView applications can now have access to
  getUserMedia"; home-screen web apps were tracked separately as
  [#185448](https://bugs.webkit.org/show_bug.cgi?id=185448)).
  On any iOS in current use this works, so it is not a design risk in 2026 — but
  it is worth a smoke test since screenferry is a static app users may well install.
- **Important surviving caveat from that same bug:** the fix applies only to
  **`https` and `localhost`** origins. **Custom URL schemes** (`app://`, as used
  by Cordova/Capacitor/Ionic) still raise `NotAllowedError` even after the user
  grants permission. Irrelevant if screenferry ships as a plain HTTPS static site —
  but a hard blocker if it is ever wrapped in a hybrid shell. **Keep it served
  over `https`.**

**In-app browsers**
- Third-party in-app browsers (Facebook, Instagram, LinkedIn, TikTok) embed
  `WKWebView`, and the embedding app must opt in to camera access — many do not,
  so `getUserMedia` **fails or is silently denied**. screenferry should **detect
  in-app browsers and prompt the user to open in Safari** — a link-out is far
  better than a camera that never starts.

**Lifecycle**
- Backgrounding the tab, switching apps, or locking the screen suspends or ends
  the stream. On resume, tracks may be `muted` or `ended`.
- Listen for `visibilitychange` and for the track's `ended`/`mute`/`unmute`
  events, and be prepared to **re-acquire the stream**. For screenferry this matters:
  a partially received file must survive a backgrounding without losing decoded
  frames.

**Dimensions**
- `video.videoWidth`/`videoHeight` are `0` until `loadedmetadata` fires. Any
  canvas sizing must happen after that event, or the first frames are garbage.

### 1.9 Android Chrome

- Generally the best platform: full image-capture extensions, `BarcodeDetector`
  available (§2), reliable 1280×720 and 1920×1080 at 30fps on mid-range hardware.
- `focusMode: 'continuous'` is typically the default.
- The **ultrawide selection problem** (§1.6) is the main pitfall.
- Very cheap devices may deliver lower-than-requested resolution or frame rate
  silently — always read back `track.getSettings()` and adapt rather than assume.

### 1.10 Desktop Chrome / Firefox / Safari

- Typical webcams are **720p/30fps with fixed focus**. Fixed focus is usually set
  for ~50 cm–1 m, which is roughly right for holding a phone up to a laptop
  webcam, but sharpness is mediocre.
- Firefox supports `getUserMedia` and `facingMode` but **not** the image-capture
  extensions (`focusMode`, `torch`, `zoom`).
- Desktop is a plausible *receiver* for screenferry (phone screen → laptop webcam),
  but webcam optics make it the weaker direction. The stronger desktop role is as
  **sender**, with a phone receiving.

### 1.11 Recommended constraint ladder

Try progressively weaker constraints, never letting a rejection be fatal:

```js
async function openCamera() {
  const attempts = [
    // 1. ideal case — everything is a preference, cannot OverconstrainedError
    { video: {
        facingMode: { ideal: 'environment' },
        width:      { ideal: 1920 },
        height:     { ideal: 1080 },
        frameRate:  { ideal: 30 },
      }, audio: false },
    // 2. drop resolution hints
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    // 3. force rear (may reject on desktop — that's why it is last-but-one)
    { video: { facingMode: { exact: 'environment' } }, audio: false },
    // 4. anything at all
    { video: true, audio: false },
  ];
  let lastErr;
  for (const c of attempts) {
    try { return await navigator.mediaDevices.getUserMedia(c); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}
```

Then post-open, best-effort tuning (all optional, all guarded):

```js
async function tuneTrack(track) {
  const caps = track.getCapabilities?.() ?? {};
  const advanced = [];
  if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
  if (caps.exposureMode?.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
  if (caps.whiteBalanceMode?.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' });
  if ('torch' in caps) advanced.push({ torch: false });   // explicit: never illuminate a screen
  if (advanced.length) {
    try { await track.applyConstraints({ advanced }); } catch { /* non-fatal */ }
  }
  return track.getSettings();   // ALWAYS read back what you actually got
}
```

Always surface `track.getSettings()` (actual width/height/frameRate/deviceId)
into the UI or diagnostics — the delta between requested and delivered is the
first thing to check when a user reports "it doesn't scan".

---

## 2. The `BarcodeDetector` API

### 2.1 Verdict up front

**`BarcodeDetector` cannot be used as screenferry's decoder.** Not because of browser
support — because of the API surface. It has **no byte channel at all**. See
§2.4; this is a hard blocker, not a trade-off.

### 2.2 Browser support (2026)

From [MDN browser-compat-data](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/BarcodeDetector.json)
and [caniuse](https://caniuse.com/mdn-api_barcodedetector) (global usage ~76%):

| Browser | Support | Note |
|---|---|---|
| Chrome Android | **Yes**, 83+ | backed by Google Play Services ML Kit |
| Samsung Internet | **Yes**, 13+ | |
| Chrome desktop | **Partial**, 88+ | **ChromeOS and macOS only** |
| Edge desktop | **Partial**, 83+ | **macOS only** |
| Opera desktop | **Partial**, 69+ | **macOS only** |
| Firefox (all) | **No** | no implementation |
| Safari / iOS Safari | **No** (17+ behind a flag) | "Shape Detection API" pref, off by default |

Two things the headline 76% number hides:

1. **Desktop Chrome on Windows and Linux does not support it at all** — support is
   ChromeOS/macOS only, because the implementation delegates to a platform vision
   framework that Windows/Linux lack.
2. Before Chrome 113 on **macOS Ventura (13)+ the interface silently failed** —
   it existed and returned no results. Feature detection alone was not enough;
   you had to actually try a decode.

### 2.3 Hardware acceleration, throughput, Workers

- **Hardware accelerated:** effectively yes on Android — it delegates to Google
  Play Services / ML Kit, which uses optimised native (and on some devices
  DSP/NPU-assisted) code paths. It is meaningfully faster than any JS/WASM
  decoder and, importantly, runs **off the main thread inside the browser
  process**, so it does not block your JS.
- **Throughput:** because detection happens natively and asynchronously, on a
  modern Android device it comfortably keeps up with 30fps at 1080p. It is the
  fastest option available in a browser — which is exactly why its
  binary-unsafety is so frustrating.
- **Workers / OffscreenCanvas:** yes. Per
  [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API),
  the API **is available in Web Workers**, requires a **secure context**, and
  `detect()` takes an `ImageBitmapSource`, which includes `ImageBitmap`,
  `OffscreenCanvas`, `VideoFrame`, `Blob`, `ImageData`, and the DOM image/video/
  canvas elements. So the zero-copy `ImageBitmap`→Worker path works.

### 2.4 The blocker: `rawValue` is a string, and only a string

From the [WICG Shape Detection API spec](https://wicg.github.io/shape-detection-api/):

```webidl
dictionary DetectedBarcode {
  required DOMRectReadOnly boundingBox;
  required DOMString       rawValue;
  required BarcodeFormat   format;
  required sequence<Point2D> cornerPoints;
};
```

There is **no `bytes` member and no way to obtain one.** `rawValue` is a
`DOMString`, produced by the platform decoder applying some charset
interpretation to the QR's byte segment. Arbitrary binary payloads cannot
survive that round trip (§4).

I verified this holds for the polyfill too. The
[`barcode-detector`](https://github.com/Sec-ant/barcode-detector) package (v3.2.1,
MIT) is built **on top of zxing-wasm** — which *does* expose raw bytes — but it
faithfully implements the spec and therefore **throws the bytes away**:

```ts
// node_modules/barcode-detector/dist/es/core.d.ts
export interface DetectedBarcode {
    boundingBox: DOMRectReadOnly;
    rawValue: string;
    format: ReadResultBarcodeFormat;
    cornerPoints: [Point2D, Point2D, Point2D, Point2D];
}
```

Confirmed empirically by running the ponyfill in Node against a generated QR:
`Object.keys(detected[0])` → `boundingBox, rawValue, format, cornerPoints`.

### 2.5 Is the polyfill worth shipping?

**No — but its engine is.** The polyfill is well maintained (pushed 2026-07-31,
8 open issues, MIT) and is a good choice for an app that scans *text* QR codes.
For screenferry it is strictly worse than depending on `zxing-wasm` directly, because
it wraps the same WASM engine in an interface that discards exactly the field we
need. **Ship `zxing-wasm` directly** (§3, §7).

### 2.6 The one way `BarcodeDetector` becomes usable

If the payload is constrained to a **text-safe alphabet**, `rawValue` is exact
and `BarcodeDetector` becomes a legitimate fast path. Measured in §4.4: base45 +
QR alphanumeric mode round-trips exactly through `rawValue`, at only a **3%
capacity cost**. This is a real architectural option and is discussed in §7.

---

## 3. JS/WASM decoder libraries

### 3.1 Candidates

| Library | Version tested | Engine | License | Last release | Maintained? |
|---|---|---|---|---|---|
| [`jsQR`](https://github.com/cozmo/jsQR) | 1.4.0 | pure JS | Apache-2.0 | **2021-04-24** | **No** — last commit 2021-08, 97 open issues |
| [`zxing-wasm`](https://github.com/Sec-ant/zxing-wasm) | 3.1.2 | zxing-cpp → WASM | MIT (zxing-cpp Apache-2.0) | **2026-07-18** | **Yes** — very active, 9 open issues |
| [`@zxing/library`](https://github.com/zxing-js/library) | 0.23.0 | JS port of zxing | Apache-2.0 | active | Partially — 170 open issues |
| [`@nuintun/qrcode`](https://github.com/nuintun/qrcode) | 5.0.3 | pure TS | MIT | 2026-05 | Yes — 3 open issues |
| [`qr-scanner`](https://github.com/nimiq/qr-scanner) | 1.4.2 | minified jsQR fork | MIT | **2022-11-23** | **No** — 118 open issues |
| [`rxing-wasm`](https://github.com/rxing-core/rxing) | 0.5.7 | Rust port of zxing → WASM | Apache-2.0 | 2026-07 | Yes |

`bardecoder` (Rust) was considered and dropped: no maintained WASM npm
distribution, and no advantage over `rxing` which is the actively maintained
Rust zxing port.

### 3.2 Bundle size (measured, gzipped)

```
  55 KB gz   jsQR (dist/jsQR.js, unminified)
  10 KB gz   qr-scanner worker (the same jsQR, minified — realistic jsQR weight)
 437 KB gz   zxing-wasm reader .wasm      (+ 12 KB gz JS glue)
 703 KB gz   zxing-wasm full .wasm        (reader+writer — not needed)
 882 KB gz   rxing-wasm .wasm
  15 KB gz   barcode-detector ponyfill JS (+ the zxing wasm it loads)
```

So the real choice is **~13 KB gz (jsQR, minified) vs ~449 KB gz (zxing-wasm
reader + glue)**. That is a 35× difference and the main argument for jsQR — until
you look at latency and robustness.

Note `zxing-wasm/reader` is the correct subpath; the default `zxing-wasm` entry
pulls the **full** build including the writer, which is 266 KB gz of dead weight
for a receiver.

### 3.3 Decode latency — 1920×1080 frame

Average of 5 runs per cell, QR centred, on x86-64 Node. **Divide throughput by
3–5 for a mid-range phone.**

| Scene (v20 QR, 97 modules, 660 B) | jsQR | zxing-wasm | zxing +tryHarder | rxing-wasm | @nuintun | zxing-js |
|---|---|---|---|---|---|---|
| clean, 800 px (7.6 px/mod) | 52 ms | **11 ms** | 13 ms | 13 ms | 24 ms | fail |
| blur radius 2 | 54 ms | **12 ms** | 13 ms | 12 ms | 23 ms | fail |
| blur radius 4 | 55 ms | **11 ms** | 13 ms | 13 ms | fail | 19 ms |
| noise ±30 | **fail, 1293 ms** | **17 ms** | 26 ms | 22 ms | fail, 118 ms | fail |
| contrast 0.35 (glare) | 50 ms | **12 ms** | 12 ms | 12 ms | 23 ms | fail |
| perspective warp 0.12 | 51 ms | **11 ms** | 12 ms | 12 ms | 25 ms | fail |
| 300 px (2.9 px/mod) | 44 ms | **10 ms** | 11 ms | 11 ms | 19 ms | 19 ms |
| v40, 2900 B, 1000 px | 80 ms | **14 ms** | 17 ms | 14 ms | 29 ms | fail |
| v10, 213 B, 800 px | 46 ms | **10 ms** | 12 ms | 13 ms | 26 ms | 22 ms |

**zxing-wasm is 4–5× faster than jsQR and decoded every scene.**

Caveats on the `fail` cells: `@zxing/library`'s detector struggled with these
synthetic frames (it needed `PURE_BARCODE` to lock on) — that is partly an
artifact of nearest-neighbour rendering with no camera noise, so do not read the
zxing-js row as a definitive robustness ranking. The jsQR and zxing-wasm rows are
consistent enough across scenes to trust.

### 3.4 The miss path — the number that actually governs sustained fps

Most camera frames in a real session **do not decode** (out of focus, mid-refresh,
motion blur, between symbols). So the *failure* latency governs throughput far
more than the success latency. Measured at 1920×1080:

| Scene | jsQR | jsQR (attemptBoth) | zxing-wasm | zxing +tryHarder | rxing-wasm |
|---|---|---|---|---|---|
| empty frame, no QR | 34 ms | 42 ms | **9 ms** | 9 ms | 21 ms |
| QR present, decodable | 79 ms | 78 ms | **12 ms** | 13 ms | 12 ms |
| QR present, heavily blurred (undecodable) | 106 ms | 142 ms | **10 ms** | 11 ms | 23 ms |
| QR + heavy noise (undecodable) | **1453 ms** | **2950 ms** | **17 ms** | 26 ms | 50 ms |

This is the decisive result. **jsQR's failure path is unbounded**: a single noisy
undecodable frame costs 1.45 seconds (2.95 s with `inversionAttempts:
'attemptBoth'`), during which ~45 camera frames are dropped. On a phone that is
5–15 seconds. Camera sensor noise in dim rooms is *routine*, so this is not a
corner case — it is the expected operating condition, and it would make the
receiver appear to freeze.

zxing-wasm stays within **9–26 ms across every scene**. Bounded, predictable
latency is exactly what a real-time frame pipeline requires.

(`inversionAttempts: 'dontInvert'` should be set on jsQR regardless — the default
`attemptBoth` doubles the worst case. screenferry always shows dark-on-light QR, so
inversion attempts are pure waste.)

### 3.5 Robustness summary

| | blur | noise | glare/low contrast | perspective | low px/module |
|---|---|---|---|---|---|
| zxing-wasm | **excellent** | **excellent** | **excellent** | **excellent** | **excellent** (2.5 px/mod) |
| rxing-wasm | excellent | excellent | excellent | excellent | excellent |
| jsQR | good | **catastrophic** | good | good | marginal |
| @nuintun | fair | poor | good | good | fair |
| @zxing/library | fair | poor | poor | poor | fair |

**Pixels per module:** decoding succeeded down to ~**2.5–2.6 px/module** with
zxing-wasm. Below ~2 px/module it becomes unreliable. This is the number that
drives the ROI/downscale strategy in §6 and constrains how large the sender's QR
must appear in frame.

### 3.6 Web Worker compatibility

All candidates run in a Worker:

- **jsQR** — pure JS, no DOM dependency, takes a `Uint8ClampedArray`. Works.
  (`qr-scanner` ships exactly this arrangement.)
- **zxing-wasm** — WASM + JS glue, no DOM dependency. Works. Needs the `.wasm`
  URL configured via `prepareZXingModule({ overrides: { wasmBinary } })` or a
  same-origin `locateFile`; by default it fetches from a CDN, which screenferry should
  override to a self-hosted asset (static app, no external dependency).
- **@nuintun/qrcode**, **@zxing/library**, **rxing-wasm** — all DOM-free. Work.

For screenferry the Worker matters less than it seems, because at ROI-cropped sizes
decode is ~1–5 ms desktop / ~5–20 ms phone. But keeping it off the main thread
protects the UI and the video element's own compositing. **Do it.**

### 3.7 Per-library input formats

| Library | Input |
|---|---|
| jsQR | `Uint8ClampedArray` RGBA + width + height |
| zxing-wasm | `Blob`, `File`, `ArrayBuffer`, `Uint8Array`, or `ImageData`-shaped `{data,width,height}` |
| @nuintun | luminance `Uint8Array` via its own `grayscale()` then `binarize()` |
| @zxing/library | packed `Int32Array` RGB via `RGBLuminanceSource` |
| rxing-wasm | luma8 `Uint8Array` + width + height (also `decode_barcode_rgb`) |

zxing-wasm accepting a plain `{data, width, height}` object is convenient: you can
pass an `ImageData` straight from `getImageData` or construct one in a Worker with
no copy beyond the transfer.

---

## 4. THE BINARY-SAFETY QUESTION

This is the highest-stakes item for screenferry, and it is worse than the framing
suggests. The failure is not merely "some decoders return a string" — it is that
**the same decoder returns an exact string for some payloads and a corrupted one
for others**, so the bug passes testing and destroys user files in production.

### 4.1 Why it happens

QR byte mode stores raw octets. A decoder must decide how to turn those octets
into a string. The QR spec's default for byte mode is ISO-8859-1, but the ECI
mechanism can override it, and **in practice every major decoder runs charset
*auto-detection*** over the bytes — guessing UTF-8, Shift-JIS, GB2312, etc.

That means the string you get back is a function of *what the bytes happen to
look like*. Compressed or encrypted data — exactly what screenferry will carry — looks
like random bytes, and random bytes will trip different guesses at different
lengths.

Two distinct destruction mechanisms:

1. **Replacement.** Invalid sequences become U+FFFD. Many distinct input bytes
   collapse onto one codepoint — **information-theoretically unrecoverable**.
2. **Non-invertible mapping.** The bytes decode "successfully" under a guessed
   multi-byte charset into different characters, changing the string length.
   Also unrecoverable.

### 4.2 Measured: which libraries expose raw bytes

Encoded a QR containing **all 256 byte values** (0x00–0xFF) in byte mode, decoded
with each library, compared to ground truth:

| Library | Field | Type | Result |
|---|---|---|---|
| **jsQR** | **`.binaryData`** | `Uint8ClampedArray` | **BINARY-SAFE — 256/256 exact** |
| jsQR | `.data` | string | **destroyed — empty string** |
| **zxing-wasm** | **`.bytes`** | `Uint8Array` | **BINARY-SAFE — 256/256 exact** |
| zxing-wasm | `.bytesECI` | `Uint8Array` | 259 bytes — prefixed with the ECI/symbology header, **not** the payload |
| zxing-wasm | `.text` | string | corrupted — 540 UTF-16 units for 256 bytes |
| **@zxing/library** | **`BYTE_SEGMENTS` metadata** | `Uint8Array[]` | **BINARY-SAFE — 256/256 exact** |
| @zxing/library | `.getText()` | string | **corrupted — 128/256 bytes destroyed** |
| @zxing/library | `.getRawBytes()` | `Uint8Array` | 290 bytes — **codewords, not payload** |
| **rxing-wasm** | **`.raw_bytes()`** | `Uint8Array` | **BINARY-SAFE — 256/256 exact** |
| **@nuintun/qrcode** | `.content` + latin1 | string | exact *here*, but see §4.3 — **fragile** |
| @nuintun/qrcode | `.codewords` | `Uint8Array` | 290 bytes — **codewords, not payload** |
| **`qr-scanner` (nimiq)** | — | — | **NO BYTES AT ALL** |
| **`BarcodeDetector`** | `rawValue` | string | **NO BYTES AT ALL** |

Three traps worth calling out explicitly:

**Trap 1 — `getRawBytes()` / `.codewords` are not your payload.** Both
`@zxing/library`'s `getRawBytes()` and `@nuintun`'s `.codewords` returned **290
bytes for a 256-byte payload**. These are the post-error-correction *codewords*,
including the 4-bit mode indicator, the 16-bit length field, and terminator/
padding. The name is inviting and the type is right, so this is very easy to
misuse. Recovering the payload requires manually re-parsing the bitstream (I
verified a hand-rolled parse does recover the exact 256 bytes — but you should
not be writing that).

**Trap 2 — `qr-scanner` has no byte path whatsoever.** Its public type is:

```ts
interface ScanResult {
    data: string;
    cornerPoints: QrScanner.Point[];
}
```

It bundles a fork of jsQR — which *has* `binaryData` internally — but the worker
only posts back the string. Using qr-scanner for screenferry would require forking it.
Combined with its last npm publish being **2022-11-23**, it is out.

**Trap 3 — `@zxing/library.getText()` is the most dangerous single API here.**
For the 256-value payload it returned a string of **length 256** — the *correct
length* — while **every byte from 0x80 to 0xFF had been replaced with U+FFFD**:

```
byte 0x80 -> U+FFFD    byte 0x84 -> U+FFFD    byte 0x88 -> U+FFFD
byte 0x81 -> U+FFFD    byte 0x85 -> U+FFFD    byte 0x89 -> U+FFFD
byte 0x82 -> U+FFFD    byte 0x86 -> U+FFFD    byte 0x8a -> U+FFFD
byte 0x83 -> U+FFFD    byte 0x87 -> U+FFFD    byte 0x8b -> U+FFFD
total divergent bytes: 128/256
```

Exactly **half the byte space collapses to a single codepoint**, while a
`result.length === expectedLength` sanity check passes. This is precisely the
"silent corruption" the brief warned about, and it is worse than a crash.

### 4.3 Measured: string output is content- AND length-dependent

The same decoder, same code path, seven different payloads:

| payload (256 B) | zxing `.text` | zxing `.bytes` | jsQR `.data` | jsQR `.binaryData` |
|---|---|---|---|---|
| sequential 0x00..0xFF | LOSSY (len 540) | **EXACT** | LOSSY (len 0) | **EXACT** |
| LCG `(i*97+13)&0xff` | LOSSY (len 540) | **EXACT** | LOSSY (len 0) | **EXACT** |
| all 0xFF | **EXACT** (len 256) | **EXACT** | LOSSY (len 0) | **EXACT** |
| high half 0x80..0xFF | **EXACT** (len 256) | **EXACT** | LOSSY (len 0) | **EXACT** |
| seeded random | LOSSY (len 509) | **EXACT** | LOSSY (len 0) | **EXACT** |
| gzip-like header | LOSSY (len 550) | **EXACT** | LOSSY (len 0) | **EXACT** |
| plain ASCII text | **EXACT** (len 256) | **EXACT** | **EXACT** (len 256) | **EXACT** |

And **payload length alone flips the outcome**: the same `(i*97+13)&0xff`
generator produced an **exact** `rawValue` at 600 bytes but a **corrupted** one at
256 bytes.

Read that table again for the design implication: **if you test with ASCII, every
library looks binary-safe.** The bug only appears with real compressed/encrypted
payloads, in the field, on some files and not others. This is the strongest
possible argument for never touching the string field.

`@nuintun`'s `.content` was exact for the all-values probe (all codepoints ≤ 255,
i.e. it happened to apply a latin1 mapping) — but it is the *same class of
mechanism* as the others, with no documented guarantee. **Do not rely on it.**

jsQR's `.data` deserves partial credit: its byte-mode text path is

```js
try {
  text += decodeURIComponent(bytes.map(b => `%${("0"+b.toString(16)).substr(-2)}`).join(""));
} catch { /* failed to decode */ }
```

([source](https://github.com/cozmo/jsQR/blob/master/src/decoder/decodeData/index.ts))
— so on non-UTF-8 input `decodeURIComponent` throws, the catch swallows it, and
you get an **empty string**. Loud-ish failure rather than silent corruption. But
`.binaryData` accumulates the octets untouched, which is what matters.

### 4.4 The mitigation that makes every decoder safe

If the payload is restricted to a text-safe alphabet, the charset guessing
becomes a no-op and *every* decoder — including `BarcodeDetector` — round-trips
exactly.

**base45** ([RFC 9285](https://datatracker.ietf.org/doc/html/rfc9285), designed
for exactly this and used by the EU Digital COVID Certificate) maps onto QR's
**alphanumeric mode** charset (`0-9 A-Z space $%*+-./:`), which packs at 5.5
bits/char instead of byte mode's 8 bits/byte. Measured capacity:

| ECC | byte-mode capacity | alnum capacity | base45 payload | vs byte mode |
|---|---|---|---|---|
| L | 2953 B | 4296 chars | **2864 B** | **97.0%** |
| M | 2331 B | 3391 chars | **2260 B** | **97.0%** |
| Q | 1663 B | 2420 chars | **1612 B** | **96.9%** |
| H | 1273 B | 1852 chars | **1234 B** | **96.9%** |

**base45 + alphanumeric mode costs only ~3% capacity** versus raw byte mode —
because alphanumeric mode's tighter bit packing almost exactly cancels base45's
1.5 chars/byte expansion. (For contrast, base64 would have to go in *byte* mode,
since QR alphanumeric has no lowercase — costing 25%.)

Verified end-to-end: a 600-byte payload → 900 alphanumeric chars → QR v19,
decoded through **string-only** paths:

```
jsQR .data (string) + base45         EXACT ROUND-TRIP
zxing-wasm .text (string) + base45   EXACT ROUND-TRIP
BarcodeDetector rawValue + base45    EXACT ROUND-TRIP
```

### 4.5 Verdict

> **Safe for arbitrary binary payloads: `zxing-wasm`'s `.bytes`.**
> It was exact in 100% of tested payloads, it is the fastest option, the most
> robust, and the only actively maintained one among the fast options.
>
> Also genuinely safe: **jsQR `.binaryData`**, **rxing-wasm `.raw_bytes()`**, and
> **`@zxing/library`'s `BYTE_SEGMENTS` metadata**.
>
> **Never safe: any `.text` / `.data` / `.content` / `rawValue` string field**, and
> therefore **`qr-scanner` and `BarcodeDetector` are unusable for raw binary.**
>
> **Never confuse `getRawBytes()` / `.codewords` with the payload** — they are
> codewords and include header and padding.
>
> Independently, encoding the payload as **base45 + alphanumeric mode** costs only
> 3% capacity and makes the wire format immune to this entire class of bug.

---
## 5. Frame-rate ceiling

### 5.0 Credibility warning on published numbers

The animated-QR space has a 2025–26 cohort of browser projects claiming
**129–254 KB/s**. Several of those claims **do not survive an arithmetic check**
against their own stated defaults, and all are self-reported screenshots rather
than methodology. Specifics are in §5.6. The peer-reviewed literature and the one
long-standing project with a published benchmark methodology
([libcimbar](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md)) top out
around **100–120 KB/s using a non-QR custom colour symbology**; honest QR-based
systems land at **1–30 KB/s**. **Design screenferry to the low numbers.**

### 5.1 The binding constraint is exposure and readout, not decode speed

For animated QR the receiver's limit is rarely CPU. It is that a camera frame is
an **integration over time**, and if the sender changes the displayed symbol
during that window, the captured frame contains two superimposed QR codes. This is
not a *degraded* symbol — it is two different symbols spliced together. Reed–Solomon
cannot repair it, because the split is a coherent block substitution rather than
scattered symbol errors.

Let `T_s` = sender frame hold time, `T_c` = camera frame period (33.3 ms at
30 fps), `T_e` = exposure time, `T_r` = rolling-shutter readout span across the
QR's vertical extent. A camera frame is clean iff its whole `T_e + T_r` window
falls inside one sender interval. With uniform random phase:

```
E[clean frames per displayed frame] = max(0, (T_s − T_e − T_r) / T_c)
```

To guarantee at least one clean capture per displayed symbol:

```
T_s ≥ T_c + T_e + T_r
```

With mid-range Android numbers — `T_c` = 33.3 ms, `T_e` ≈ 3–8 ms (short, because
a bright screen forces a fast shutter — see §5.3), `T_r` ≈ 15–25 ms for the QR
region:

```
T_s ≥ 33.3 + 5 + 20 ≈ 58 ms   →   sender ≤ ~17 fps
```

**This lands on 15 fps**, which is also a clean integer divisor of both 60 Hz and
120 Hz. Four independent sources converge on the same answer (§5.5) — that
agreement is the strongest single result in this research.

**Corollary: shrink `T_r` by shrinking the QR's vertical extent.** A wide, short
layout (two side-by-side codes in landscape) has a smaller readout span than one
tall centred code and is therefore *more* tear-resistant at the same fps. This is
an independent argument for the dual-lane layout in §5.7.

### 5.2 Rolling shutter, tearing, and PWM banding

Nearly all phone cameras are rolling-shutter: rows are exposed sequentially.
Consequences:

- A symbol change mid-readout yields the **old symbol in the top rows and the new
  one in the bottom rows**. The finder patterns often still resolve, so the decoder
  spends full effort and *then* fails — the expensive kind of failure (§3.4).
- There is no phase lock between the sender's `requestAnimationFrame` and the
  receiver's sensor readout, so tearing hits a **random subset of frames**.
- FareQR (IEEE, 2020) names this directly: conventional systems "suffer from both
  CMOS rolling shutter and **inter-frame mixing** problems **when display rate is
  close to camera capture rate**"
  ([IEEE](https://ieeexplore.ieee.org/document/9355773/)).

**A per-frame CRC is therefore mandatory.** A torn frame can, rarely, produce a
structurally valid decode of garbage.

**PWM banding.** OLED panels regulate brightness by pulse-width modulation;
rolling-shutter readout aliases against that modulation and produces horizontal
bright/dark banding
([arXiv 2602.01559](https://arxiv.org/pdf/2602.01559)). Two things make this less
alarming than it sounds:

- It is a **luminance modulation, not a geometric distortion** — modules do not
  move. Decoders with local adaptive thresholding (ZXing's `HybridBinarizer` and
  zxing-cpp both qualify) largely absorb it, because the threshold tracks the local
  mean inside each band.
- It becomes fatal only when a dark band pushes a region below the sensor noise
  floor — i.e. at **low OLED brightness**, where the duty cycle is small.

**⇒ OLED senders must run at or near maximum brightness**, where most modern
panels approach 100% duty cycle or switch to DC-like dimming. LCD senders
(laptops, monitors) are inherently safer. This coincides exactly with the exposure
advice in §5.3 — one setting fixes both.

### 5.3 Exposure: the good news

The common worry — "auto-exposure picks 1/30 s and integrates two sender frames" —
is real but **usually self-correcting**, because pointing a camera at a bright
screen forces a short shutter. A display at 300–600 nits filling most of the frame
typically drives AE to **1/200–1/1000 s (1–5 ms)** at base ISO indoors, far below
the 33 ms frame period. **Readout `T_r`, not exposure, is normally the binding
term.**

It goes wrong when the QR occupies a small part of the frame with a dark surround:
AE meters the surround, lengthens exposure to 1/30–1/60 s, and `T_s` must rise to
~86 ms (≤11 fps). Mitigations, in order:

1. **Max sender brightness on a white page background.** libcimbar does this
   deliberately: "screen brightness on the sender is good, but **ambient light is
   better**" — which is why cimbar.org uses a mostly-white background
   ([DETAILS.md](https://github.com/sz3/libcimbar/blob/master/DETAILS.md)).
2. **Fill the frame with the code** so AE meters on it.
3. **Landscape orientation** — libcimbar notes landscape may be better than
   portrait for exposure reasons.
4. Pin exposure via `applyConstraints({exposureMode:'manual', ...})` where
   available (Chromium/Android only) — try, fall back gracefully.

### 5.4 Decode CPU budget on a mid-range phone

From §3.3/§3.4, scaling desktop x86 by 3–5×:

| pipeline | desktop (measured) | mid-range phone (est.) | max decode fps |
|---|---|---|---|
| zxing-wasm, full 1080p frame | 9–17 ms | **35–70 ms** | 14–28 fps |
| zxing-wasm, ROI crop 880² | 5 ms | **15–25 ms** | 40–65 fps |
| zxing-wasm, ROI crop → 300² | 1.2 ms | **4–6 ms** | 150+ fps |
| jsQR, full 1080p frame | 34–79 ms | **170–400 ms** | 2.5–6 fps |
| jsQR, noisy miss | 1453 ms | **5–7 seconds** | pipeline stall |

Corroborating published figures: jsQR ~47 ms/decode average with **1023 ms
spikes** (~17 fps) and quirc.wasm ~29 ms (~34 fps), both measured on a 2018
MacBook Pro under a **6× CPU slowdown** as a mid-range-phone proxy
([Tokopedia Engineering](https://medium.com/tokopedia-engineering/building-60-fps-qr-scanner-for-the-mobile-web-eb0deddce099)).
Note that jsQR's spike behaviour reproduces independently there — it is not an
artifact of my synthetic frames.

**⇒ With zxing-wasm plus ROI cropping, decode is not the bottleneck.** With jsQR
on full frames it is, and the app would not keep up with even a 5 fps sender.

libcimbar states the general conclusion from measurement: "more modern cell CPUs
run the decoder more quickly, but it turns out that **this does not benefit
performance much: the camera is usually the bottleneck**."

### 5.5 Recommended sender rate: 15 fps, vsync-locked

> **Sender: 15 fps, each frame held exactly 4 refreshes on a 60 Hz display
> (8 on 120 Hz). Receiver: 30 fps capture.**

Five independent lines converge on this:

1. **Derived (§5.1):** `T_s ≥ T_c + T_e + T_r` ≈ 58 ms ⇒ ≤17 fps. 15 fps (66.7 ms)
   leaves ~8 ms margin.
2. **COBRA (MobiSys 2012):** the display rate must be **less than half the camera
   capture rate**. 15 < 30/2. ✅
3. **decimen:** "each frame must own **at least 2 refresh cycles** of the display."
   15 fps on 60 Hz = 4 refreshes, double that margin.
4. **QRFerry** ships exactly this as its robust **"Turbo 15"** profile: "one V30-L
   code held for four refreshes on a 60 Hz screen"
   ([deedy/qr-data-transfer](https://github.com/deedy/qr-data-transfer)).
5. 15 is an exact divisor of 60 and 120 Hz, so an integer `requestAnimationFrame`
   counter hits it precisely on every display screenferry will encounter.

**Why 2× oversampling is the right target, not 3×.** At 15 fps sender / 30 fps
capture each displayed symbol is sampled by exactly 2 camera frames. In the worst
phase alignment one straddles the transition and is torn — **the other is
guaranteed clean**. You get ≥1 clean sample per symbol with probability ≈1.
Dropping to 10 fps (3× oversampling) buys almost nothing extra and costs a third
of the throughput.

**Never drive the sender with `setInterval`.** It drifts against vsync, slowly
walking its transitions across the camera's exposure window and producing periodic
bursts of torn frames. Use `requestAnimationFrame` with an integer refresh counter.

**Adaptive ladder.** Do not hard-code 15 — the sender cannot know the receiver's
camera, and screenferry has no back-channel. The receiver *does* know everything needed
(`getSettings().frameRate`, counted rVFC callbacks, measured unique decodes/sec),
so **display a recommendation on the receiver and let the user set the sender**:

| Detected camera fps | Sender fps | Refreshes @60 Hz | QR version |
|---|---|---|---|
| 15 (old/low-end) | 7 | 8–9 | V20 |
| 24 | 12 | 5 | V25 |
| **30 (default)** | **15** | **4** | **V27** |
| 30, propped/tripod | 20 | 3 | V30 |
| 60 (flagship, verified) | 30 | 2 | V30 |

### 5.6 Realistic sustained rate and goodput

**Unique decodes/sec.** Combining 30 fps capture, a 15 fps sender, and losses to
tearing, focus hunting and hand motion:

> **Design for 15–25 successful unique decodes per second** on a mid-range phone
> with ROI cropping and a 2-worker pool — i.e. you can keep up with a 30 fps
> camera. Above that you are camera-limited, not CPU-limited.

Expected clean-frame yield: **60–80% handheld, 85–95% propped** (estimate).

**Goodput.** Using QR **version 27 at ECC level L** (125 modules, 1465 B) with a
~20 B frame header:

| Config | Optical line rate | ×0.75 yield | ÷1.15 fountain overhead | **Realistic** |
|---|---|---|---|---|
| 15 fps × V25 (1273 B) | 19.1 KB/s | 14.3 | 12.4 | **~12 KB/s** |
| 15 fps × V27 (1465 B) | 22.0 KB/s | 16.5 | 14.3 | **~14 KB/s** |
| 15 fps × V30 (1732 B) | 26.0 KB/s | 19.5 | 16.9 | **~17 KB/s** |

**A 1 MB file lands in roughly 60–85 seconds.** That is 7–17× the sustained rate
of txqr and a defensible headline for a mid-range Android receiver.

**Prior art, with arithmetic checks applied:**

| Project | Claim | Verdict |
|---|---|---|
| [txqr](https://divan.dev/posts/animatedqr/), repetition codes | record 9 KB/s; **sustained 1–2 KB/s**; optimum 6–7 fps | Credible. The record run had ~zero missed frames (99% of the 9.35 KB/s line rate) — an outlier. **The 1–2 KB/s sustained figure is the honest one**, ~15–20% of line rate. |
| [txqr](https://divan.dev/posts/fountaincodes/), LT fountain | "almost 25 kbps" for 13 KB in 501 ms | **Blog arithmetic is wrong by ~8×.** 13 KB ÷ 0.501 s = **25.9 KB/s ≈ 208 kbps**. Every secondary source repeats the error. Variance "plummeted" after the switch to fountain codes. |
| [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer/) | 129.2 KB/s | **Does not reconcile with its own defaults** (24 fps × 1465 B = 35.2 KB/s ceiling). Only self-consistent as iPhone-to-iPhone, 60 fps, V40, propped, **stacked codes**. Hobby PoC; benchmark is a screenshot. |
| [RaptorQR](https://github.com/infrost/RaptorQR) | 254 KB/s; 300 symbols/s | **Arithmetically impossible** as stated: 4 codes × 30 fps = 120 symbols/s ceiling; 4 × 1732 B × 30 fps = 203 KB/s ceiling. Architecture worth copying, numbers are not. |
| [QRFerry](https://github.com/deedy/qr-data-transfer) | no throughput claim; named profiles | **Best-specified design in the cohort.** All its profile line rates reconcile exactly. |
| [ShadowCat](https://github.com/unprovable/ShadowCat) | 0.83 KB/s raw at 3 fps | Credible floor: sequential, Base64, high EC, old phones. |
| [libcimbar](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md) | **106 KB/s sustained** (4.69 MB in 44 s) | Credible and rigorous — but a **custom colour symbology, not QR**, post-zstd, 4 threads on a Snapdragon 625. The correct ceiling reference for screen→camera generally. |

**Academic work** (COBRA MobiSys'12 ~518→153 kbps; LightSync MobiCom'13 ~11 KB/s;
RDCode MobiCom'14; [ChromaCode MobiCom'18](https://tns.thss.tsinghua.edu.cn/~yangzheng/papers/Zhang-ChromaCode-MobiCom2018.pdf)
raw >700 kbps / goodput 120 kbps) is bounded by the same three limits: camera frame
rate (LightSync measured **8–30 fps across four phones**), inter-frame mixing when
display rate approaches capture rate, and motion blur. **Every one of them buys
throughput by increasing bits per frame — never by increasing frames per second.**
That is the strategic lesson: **fps is a hard wall; frame density and multi-code
layouts are where the headroom is.**

### 5.7 Fountain coding, and the dual-lane lever

**Fountain coding is not optional.** With sequential frames a missed symbol forces
a full loop before the gap can be filled — a coupon-collector problem that degrades
badly. With a **rateless code** (RaptorQ / LT) the receiver needs only *any*
K(1+ε) distinct symbols, so misses cost airtime and nothing else. txqr's two posts
are effectively a controlled experiment on exactly this: same hardware, repetition
codes → 1–2 KB/s sustained; fountain codes → variance "plummeted significantly."

This also removes any need for a back-channel, which matters because screenferry is
strictly one-way.

**The asymmetry changes the fps answer.** With a fountain code, `P(clean) = 0.6`
costs 40% of your rate. With sequential frames it is catastrophic. **So the fountain
decision precedes the fps decision** — and having made it, you can afford to run at
15 fps rather than retreating to the wallet ecosystem's 4–8 fps.

**ECC level L, not M.** Both divan (EC level had "negligible effect on the result")
and decimen converge here: "in-frame ECC and the fountain layer solve different
problems (**corruption vs erasure**) … at these frame sizes **level L plus frame
disposal is the better trade**." Spend the bits on payload and let the fountain
layer handle whole-frame loss.

**Dual-lane: the best throughput lever, and it is not more fps.** QRFerry's scheme:
two codes side by side, updating on alternating refreshes, so each lane is
individually stable for 2 refreshes while the aggregate symbol rate doubles — and
**at any instant at least one lane is mid-hold and therefore clean**.

> Dual-lane at 15 fps/lane = 30 symbols/s × 1732 B (V30) = 52.0 KB/s optical
> → **~34 KB/s realistic**. Double the single-lane rate with *no* increase in
> tearing risk.

Costs: each lane gets ~half the screen width, halving px/module (§6.2 shows the
budget still works for V30 but not for V40), and it needs landscape + fullscreen +
a steady phone. **Explicitly avoid a 4-code grid** — QRFerry rejected it because it
"avoids the density and acquisition cost of a four-code grid," and it quarters
px/module while quadrupling finder-pattern search cost.

### 5.8 Cheap wins that apply at any fps

1. **A torn-frame rejector in front of the decoder.** libcimbar's "shakycam" mode
   detects and discards in-between frames during the *scan* step so it "can spend
   more processing time decoding real data." FareQR independently arrived at the
   same idea using an outline border. Cheapest implementation: a thin marker bar
   with a per-frame-alternating colour at the top **and** bottom of the code
   region — if top ≠ bottom the frame straddled a transition, so discard it before
   paying 20–90 ms for a decode.
2. **Per-frame CRC-32**, non-negotiable (§5.2).
3. **Raw byte mode, never Base64-in-byte-mode.** ShadowCat's 1.1 KB/s base64 →
   0.83 KB/s raw shows the 1.33× tax directly. (Note this is *not* an argument
   against base45 in *alphanumeric* mode — see §7.2, which is a different and much
   cheaper construction.)
4. **Compress first, but only if it helps** — attempt Brotli-11 and gzip-9, keep
   the smaller, and only apply when it actually saves optical bytes.
5. **Choose bytes-per-frame to sit exactly at a QR version's capacity ceiling.**
   divan measured a dead zone at 1400–1700 bytes where decode timeouts spiked — a
   version-boundary artifact, where the encoder jumps to a larger symbol and module
   size drops discontinuously.
## 6. Downscaling / ROI tricks

### 6.1 `requestVideoFrameCallback` vs `setInterval`

Use **`requestVideoFrameCallback` (rVFC)**. It is Baseline "newly available" as of
October 2024 and support is now excellent —
[caniuse: ~93% global](https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback):

| Browser | Version |
|---|---|
| Chrome desktop / Android | 83+ |
| **Safari desktop & iOS** | **15.4+** (March 2022) |
| **Firefox / Firefox Android** | **132+** (Oct 2024) |
| Edge | 83+ |
| Samsung Internet | 13+ |

**Semantics — the detail that matters most**
([web.dev](https://web.dev/requestvideoframecallback-rvfc/)):

> "The **effective rate at which callbacks are run is the lesser rate between the
> video's rate and the browser's rate.** A 25 fps video playing in a browser that
> paints at 60 Hz would fire callbacks at 25 Hz."

⇒ **For a 30 fps camera on any ≥60 Hz phone, rVFC fires at 30 Hz and you see every
camera frame.** For a 60 fps camera on a 60 Hz display you sit exactly at the
boundary, where any main-thread jank costs frames. That is a concrete argument for
targeting **30 fps capture** on mid-range devices: you get 2× headroom in the
callback path.

Note the API is best-effort — it "may fire up to one v-sync late," and compositing
happens on another thread.

**Dropped-frame detection.** The callback metadata is how you know you are falling
behind:

- **`presentedFrames`** — "allows clients to determine if frames were missed
  between instances of `VideoFrameRequestCallback`." If the delta exceeds 1, you
  dropped frames; degrade (smaller ROI, lower resolution).
- **`mediaTime`** — use this, not `currentTime`, to identify frames: it is
  "directly populated by the `presentationTimestamp` of the frame," whereas
  `currentTime` is backed by the audio clock in Chromium. It is the right key for
  deduplication and for worker dispatch.
- `expectedDisplayTime` doubles as a latency diagnostic.

`requestAnimationFrame` fires at display refresh, decoupled from camera frames —
you re-decode duplicates and miss real ones. `setInterval` drifts and backs up.
Neither is correct for the *receiver*. (`rAF` **is** correct for the *sender* —
§5.5.)

**⚠️ The zombie-loop bug.** rVFC chains **outlive their stream and resume on the
next one**; without a generation counter every camera stop/start leaks a live
capture loop, and after a few restarts you have several loops competing for the
decoder. Bump a generation counter on every stream acquisition and have the
callback check it before re-registering.

For a guaranteed per-frame path, `MediaStreamTrackProcessor` exposes the track as
a `ReadableStream<VideoFrame>` — see §6.4, but it is not portable and rVFC is
sufficient.

### 6.2 Downscaling — how far can you go?

Decoding succeeded down to **~2.5–2.6 px/module** with zxing-wasm in my
measurements (§3.5). Published guidance puts the practical floor a little higher —
**~4 camera px/module** is the commonly cited reliable threshold, below which "the
black/white boundary blurs into grey, which the decoder reads as ambiguity"
([Orient Display](https://orientdisplay.com/the-minimum-display-resolution-required-for-barcode-scanning/)).
libcimbar decodes its 1024² code down to 700² (~0.68× linear) "but performance may
suffer." **Design to 3–4 px/module; treat 2.5 as the cliff edge.**

Budget, assuming the code occupies 85% of the capture frame's short dimension:

| Capture short dim | code px | V20 (97 mod) | V25 (117) | V27 (125) | V30 (137) | V40 (177) |
|---|---|---|---|---|---|---|
| 1080 | 918 | 9.5 | 7.8 | **7.3** | 6.7 | 5.2 |
| 720 | 612 | 6.3 | 5.2 | **4.9** | 4.5 | 3.5 |
| 540 (½ of 1080p) | 459 | 4.7 | 3.9 | **3.7** | 3.4 | 2.6 ⚠️ |
| 480 | 408 | 4.2 | 3.5 | 3.3 | 3.0 | 2.3 ⚠️ |
| 360 (⅓ of 1080p) | 306 | 3.2 | 2.6 | 2.4 ⚠️ | 2.2 ⚠️ | 1.7 ✗ |

**V27 is the sweet spot.** At 1080p capture it has 7.3 px/module, so you can
**downscale 2× to 540p and still hold 3.7 px/module** — a 4× reduction in every
per-pixel cost, for free.

**V40 has almost no downscale headroom** (5.2 px/module at 1080p, 2.6 after a 2×
downscale). This is exactly why decimen qualifies V40 as working "phone-to-phone
**at close range**" only.

**Downscale by exact integer factors with a box filter.** Non-integer or bilinear
resampling of a near-Nyquist module grid introduces phase-dependent module blur.
`createImageBitmap(..., {resizeQuality: 'pixelated'})` is nearest-neighbour — fast
but aliases modules badly; prefer `'medium'` at 2×, or a hand-rolled 2×2 box
average in WASM.

### 6.3 ROI cropping — the highest-leverage single optimization

Measured on a 1920×1080 frame with a 97-module QR at 800 px, mild blur + noise:

| decode input | effective px/module | zxing-wasm | jsQR | resample (pure JS) |
|---|---|---|---|---|
| full frame 1920×1080 | 7.62 | 10.9 ms | 79.0 ms | — |
| full frame → 960×540 | 3.81 | 4.0 ms | 31.7 ms (fail) | 4.3 ms |
| full frame → 640×360 | 2.54 | 2.0 ms | 17.0 ms | 1.2 ms |
| **ROI crop 880×880** | 7.62 | **5.1 ms** | 35.8 ms | 4.0 ms |
| **ROI crop → 440×440** | 3.81 | **1.8 ms** | 14.4 ms | 1.0 ms |
| **ROI crop → 300×300** | 2.60 | **1.2 ms** | 10.7 ms | 0.5 ms |

**ROI crop + downscale gives a ~9× decode speedup** (10.9 → 1.2 ms) with no loss of
decodability, because it preserves px/module while discarding everything else.

**The saving is in the readback, not the blit.** `drawImage(video, sx,sy,sw,sh, …)`
does crop and scale on the GPU in one operation, costing about the same as the
full-frame form. What scales linearly is `getImageData`:

- full 1920×1080 RGBA = **8,294,400 bytes/frame** → **249 MB/s of GPU→CPU readback
  at 30 fps**
- a 640×640 ROI = **1,638,400 bytes** — **5.1× less**
- a 540×540 ROI = **1,166,400 bytes** — **7.1× less**

**Strategy:**

1. **Acquire:** full frame downscaled 3–4× (e.g. 480×270), decode-attempt at a low
   rate (2–5/s) purely to *locate* finder patterns. zxing-wasm returns `position`
   corners on success.
2. **Lock:** expand the located quad by ~15–20%.
3. **Track:** `drawImage`/`createImageBitmap` that source rect at ~3–4 px/module,
   decode every frame (~1–5 ms desktop, ~5–20 ms phone).
4. **Re-acquire:** after 5–10 consecutive failures, widen back to the full frame.
   The fountain code absorbs the gap.

### 6.4 Getting pixels into a Worker

Ranked for screenferry:

**1. `VideoFrame.copyTo()` requesting the I420 Y plane — the underrated win.**
`copyTo(dest, {rect, format, layout})` can extract a **sub-rectangle** (the ROI
crop) *and* request a pixel format. The camera already produces YUV, so asking for
the **Y plane gives you an 8-bit luminance buffer directly** — 4× smaller than
RGBA and **exactly what the decoder wants** (§6.6), eliminating both the RGBA
readback tax and the grayscale pass. None of the surveyed projects do this. Verify
per-browser format support at implementation time.

**2. `createImageBitmap(video, sx,sy,sw,sh, {resizeWidth, resizeHeight, resizeQuality})`**
— crop and resize in one call, off the main thread, GPU-backed, returning a
**`Transferable`**. `postMessage(bmp, [bmp])` moves the handle with no pixel copy.
This is the portable workhorse.
⚠️ Firefox caveat: `OffscreenCanvas.transferToImageBitmap` "was meant to take
ownership … by reference for minimal cost, but Firefox's implementation made it
prohibitively expensive" ([bugzilla 1788206](https://bugzilla.mozilla.org/show_bug.cgi?id=1788206)).
Test on Firefox Android specifically.

**3. `MediaStreamTrackProcessor` → `ReadableStream<VideoFrame>` in a Worker** —
best-in-class where available. Chrome shipped a proprietary version in 2021 exposed
on the **main thread**; the spec version is worker-only. **Browsers differ on which
global scope exposes it, which makes them mutually incompatible** — so feature-test
in *both* scopes and keep rVFC as the universal fallback. Firefox support was
platform-scheduled for mid-2026 ([bugzilla 1749532](https://bugzilla.mozilla.org/show_bug.cgi?id=1749532)).

**4. `OffscreenCanvas` + `getImageData` with `willReadFrequently: true`** — the
fallback. The flag matters because `getImageData` on a GPU-backed canvas must copy
all pixels from GPU to system RAM; the flag tells the UA to keep a CPU-backed
surface instead ([canvas2D spec](https://github.com/fserb/canvas2D/blob/master/spec/will-read-frequently.md)).
The tradeoff is that it disables GPU acceleration for canvas *writes* — fine here,
since screenferry does one blit and one full read per frame. Published magnitude is
modest and noisy (one measurement: 18.8% faster, but "the variance in tests was
higher than the performance difference"), so **prefer skipping the canvas entirely
via paths 1–2.**

### 6.5 Multiple workers

**Use a pool of 2, user-adjustable to 3.** This is a revision from "one is enough":

- **1 → 2 is a real win.** It decouples decode latency from the 33 ms camera
  cadence: a 25 ms decode no longer forces a dropped frame.
- **2 → 3 is a modest win**, covering latency spikes and GC pauses.
- **Beyond 3, copy and scheduling overhead dominate — and you are camera-limited
  anyway.** libcimbar measured this directly: faster CPUs "do not benefit
  performance much: the camera is usually the bottleneck." It used 4 threads on a
  2016-era Snapdragon 625; a 2026 mid-range SoC needs fewer.

Tokopedia measured that moving quirc.wasm into a Worker took an app from 34 to
**60 fps** with main-thread cost ~6 ms, but that "overall decode speed slightly
**decreased** due to inter-thread data transfer overhead." **That overhead was
structured-clone copying — avoid it.** Transfer `ImageBitmap`/`VideoFrame` handles
(both `Transferable`) rather than posting `ImageData` copies, and the regression
should not reproduce.

Dispatch round-robin keyed on `mediaTime`, and have workers **drop stale frames** —
if a frame is more than ~2 frame-periods old when picked up, discard rather than
decode. The fountain code absorbs the loss and the pipeline stays latency-current.

### 6.6 Grayscale: don't pay for it twice

Every candidate decoder wants luminance. jsQR takes RGBA and converts internally;
ZXing-C++ (under zxing-wasm) is built on an 8-bit `LuminanceSource` and the RGBA
entry point converts immediately. So **every RGBA frame you hand a decoder costs a
conversion pass — on top of 4× the readback bandwidth.**

A naive JS `(0.299R + 0.587G + 0.114B)` loop over 1920×1080 is ~8.3 M ops,
**roughly 3–8 ms/frame on a mid-range phone** — 10–25% of a 33 ms budget. On a
540×540 ROI it is under 1 ms.

Eliminate it, best first: (1) `VideoFrame.copyTo()` on the I420 Y plane — zero
conversion; (2) convert inside WASM with SIMD on the buffer the decoder will read;
(3) failing both, at least confine it to the ROI, which §6.3 already shrinks 5–7×.

One subtlety worth A/B testing: for black-and-white QR, extracting the **green
channel alone** is often better than weighted luma — green has 2 of 4 Bayer sites,
so it is the least-interpolated and sharpest channel, and it costs a strided copy
instead of a multiply-add.

---

## 7. Recommendations for screenferry

### 7.1 Which decoder to ship

**Ship `zxing-wasm` (reader build), and read `.bytes`.**

1. **Binary-safe** — `.bytes` was exact for 100% of tested payloads (§4.2, §4.3).
2. **Bounded latency** — 9–26 ms across every scene including noise, versus jsQR's
   1453 ms worst case (§3.4). Predictability matters more than the mean.
3. **Fastest** — 4–5× faster than jsQR on success (§3.3).
4. **Most robust** — the only library that decoded every blur/noise/glare/warp/
   low-resolution scene tested (§3.5).
5. **Actively maintained** — v3.1.2 released 2026-07-18, 9 open issues, MIT
   (engine Apache-2.0). jsQR's last commit was **August 2021**; qr-scanner's last
   publish was **November 2022**.
6. **Convergent prior art** — decimen, RaptorQR and QRFerry independently all
   landed on zxing-cpp/WASM as the receiver.

Cost: **~449 KB gzipped**. Mitigate by importing `zxing-wasm/reader` (not the
default full build, which adds 266 KB of writer), **self-hosting the `.wasm`**
rather than the default CDN fetch (screenferry must work offline — much of the point),
and lazy-loading it when the user taps "Scan".

> **Do not ship `qr-scanner` or `BarcodeDetector` as the decoder.** Neither can
> return bytes at all. This is a correctness blocker, not a trade-off.

### 7.2 Wire format: raw byte mode, with base45 as a documented alternative

**Primary recommendation: raw QR byte mode, decoded via `.bytes`.** It is the
densest option, it is what QRFerry and decimen do, and my measurements show
`.bytes` is exact for every payload tested. Pair it with a **CI byte-fidelity
test** (§7.6) — that catches the corruption class far more cheaply than paying a
permanent capacity tax.

**Documented alternative: base45 (RFC 9285) in QR *alphanumeric* mode.** Measured
cost: only **3% of symbol capacity** (§4.4), because alphanumeric mode's 5.5
bits/char packing very nearly cancels base45's 1.5 chars/byte expansion.

| ECC | byte-mode | base45 + alphanumeric | ratio |
|---|---|---|---|
| L | 2953 B | 2864 B | **97.0%** |
| M | 2331 B | 2260 B | **97.0%** |

⚠️ **Do not confuse this with the well-known "avoid Base64" advice.** That warning
(ShadowCat's measured 1.33× tax) is about putting base64 in **byte** mode. base45
in **alphanumeric** mode is a different and far cheaper construction — and it is
essentially what BBQr does with base32, only more efficient (base45 achieves 97%
vs base32's ~91%).

Choose base45 + alphanumeric if you want either: (a) belt-and-braces immunity to
the §4 corruption class regardless of which decoder is wired up later, or (b) the
native `BarcodeDetector` fast path (§7.3). Otherwise use raw byte mode.

### 7.3 Fallback chain

```
1. zxing-wasm (reader) in a Web Worker, reading .bytes     ← primary, always available
2. BarcodeDetector (native) — ONLY IF base45 wire format   ← optional fast path
     • feature-detect AND verify with a real test decode
       (Chrome ≤112 on macOS Ventura silently returned nothing)
     • available: Android Chrome, Samsung Internet, ChromeOS/macOS desktop Chrome
     • absent:    ALL Windows/Linux desktop, ALL Firefox, ALL iOS
3. jsQR (.binaryData) — emergency only, if the WASM fails to load
     • set inversionAttempts:'dontInvert'
     • ALWAYS ROI-crop first; never hand it a full 1080p frame
```

**Ship v1 with step 1 only.** Step 2's speed advantage buys little, because with
ROI cropping you are camera-limited rather than CPU-limited (§5.4) — treat it as a
later battery optimization, and only if you adopt the base45 wire format. Step 3
exists solely to survive a WASM instantiation failure (strict CSP, exotic browser).

### 7.4 Capture pipeline

```
getUserMedia (constraint ladder §1.11)
  → <video playsinline autoplay muted>, started from a user gesture
  → tuneTrack(): focusMode continuous, torch OFF
  → ALWAYS read back getSettings() — iOS silently downgrades frameRate
  → requestVideoFrameCallback loop, guarded by a GENERATION COUNTER
      → check presentedFrames delta → record drops, degrade if behind
      → ACQUIRE: createImageBitmap(video, {resizeWidth: 480})
                 → Worker → zxing-wasm full-frame decode at 2–5/s
      → on first hit: cornerPoints → ROI box, padded ~18%
      → TRACK:   VideoFrame.copyTo(I420 Y plane, {rect: roi})   [fast path]
                 or createImageBitmap(video, sx,sy,sw,sh,
                      {resizeWidth: ~3–4 px/module, resizeQuality:'medium'})
                 → transfer to Worker pool (2, adjustable to 3)
                 → cheap torn-frame reject (marker bars) BEFORE decode
                 → zxing-wasm decode (~5–20 ms on phone)
      → 5–10 consecutive misses → widen ROI to full frame
  → per-frame CRC-32 → dedupe by mediaTime/sequence → fountain decoder → file
```

Also handle: `visibilitychange` and track `ended`/`mute` (re-acquire the stream and
**preserve already-decoded frames** — iOS backgrounding must not lose progress);
in-app browser detection (Instagram/Facebook/LinkedIn) with a prompt to open in
Safari/Chrome; and a live diagnostics readout of delivered fps vs decoded fps.

### 7.5 Realistic decode fps to design around

> - **Camera capture: 30 fps.** Do not request 60 — iOS silently delivers 30 for
>   `{ideal: 60}`, and 30 fps gives 2× headroom in the rVFC callback path.
> - **Sender display: 15 fps**, vsync-locked to 4 refreshes at 60 Hz. Five
>   independent lines converge here (§5.5); each symbol is then sampled by exactly
>   2 camera frames, guaranteeing ≥1 clean capture.
> - **Successful unique decodes: design for 15–25/sec** on a mid-range phone with
>   ROI cropping and 2 workers. Expect 60–80% clean-frame yield handheld.
> - **Symbol: QR version 27, ECC level L** (~1465 B/frame) — the sweet spot with
>   2× downscale headroom (§6.2). Use level **L**, not M: the fountain layer
>   handles erasure, in-frame ECC handles corruption, and they are different jobs.
> - **Goodput: ~14 KB/s single-lane** (~12–17 KB/s across V25–V30), so **roughly
>   60–85 seconds per MB**. Dual-lane raises this to ~34 KB/s.
> - **Use a rateless fountain code** (RaptorQ preferred, LT acceptable). This is
>   not optional — it is what makes missed frames cheap and removes any need for a
>   back-channel.
>
> Do not design for 30 unique decodes/sec. Exposure and rolling-shutter readout,
> not CPU, make that unreachable — and with zxing-wasm plus ROI cropping, CPU has
> ample headroom anyway.

### 7.6 Testing requirements this research implies

1. **A binary-fidelity test is mandatory in CI.** Round-trip random bytes —
   including all 256 values **and several different lengths** — through
   encode → render → decode and assert byte equality. §4.3 proves ASCII-only tests
   would pass while the product silently corrupted real files, and that payload
   *length alone* can flip the behaviour.
2. **Test with actually compressed/encrypted payloads**, not text.
3. **Test the noisy-frame miss path.** The jsQR pathology in §3.4 only appears with
   sensor-like noise, and it is a pipeline-stalling failure, not a slow one.
4. **Smoke-test iOS Safari specifically:** inline playback, permission re-prompt,
   backgrounding mid-transfer, standalone/PWA mode, and `getSettings()` readback
   versus what was requested.
5. **Verify no rVFC zombie loops** across repeated stop/start cycles.

### 7.7 Landmines other projects hit — worth stealing

- **rVFC chains outlive their stream** → generation counter (§6.1).
- **iOS lies about frame rate** — `{ideal: 60}` silently yields 30; always read
  back `getSettings()`.
- **`Math.log` is implementation-approximated** and differs between V8 and
  JavaScriptCore. If the fountain layer uses a robust-soliton distribution built
  from `Math.log`, sender and receiver can desync — a silent, total failure. Build
  the distribution from exactly-specified integer/IEEE-754 operations, or ship a
  table.
- **QR version-boundary dead zones**: divan measured decode timeouts spiking at
  1400–1700 bytes/frame because the encoder crosses into a larger symbol version.
  Pin bytes-per-frame to a version's exact capacity ceiling.
- **Progress bars must track frames collected, not blocks solved** — fountain
  peeling back-loads its cascade, so block progress looks stalled and then jumps
  to 100%.
- **Autofocus hunting from hand tremor** is repeatedly cited as the single biggest
  practical throughput killer. Encourage propping the phone.

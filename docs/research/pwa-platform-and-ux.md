# qrbeam — App Shell Research: Platform APIs, Offline/PWA, File I/O, and Optical-Transfer UX

**Scope:** the app shell only — how the file gets in, how it gets out, how the app runs with no
network, how the sender's screen is set up, how progress is communicated with no back-channel,
what throughput to promise, and how to test any of it without two phones taped together.

**Date of research:** 2026-07-31. Version numbers below are current as of that date; anything
marked *"check before shipping"* moves fast.

**Reading note:** Every "does X work on iOS?" answer in this document is deliberately pessimistic
until proven otherwise. iOS is the constraint that shapes the whole architecture.

---

## 0. Executive summary of platform blockers

| Capability | Desktop Chromium | Android Chrome | iOS Safari (tab) | iOS Home Screen web app |
|---|---|---|---|---|
| `<input type=file>` | ✅ | ✅ | ✅ | ✅ |
| Drag & drop file | ✅ | n/a | n/a | n/a |
| `showOpenFilePicker` | ✅ | ⚠️ M132+, buggy | ❌ | ❌ |
| `showSaveFilePicker` | ✅ | ⚠️ overwrite-only | ❌ | ❌ |
| Clipboard paste of files | ✅ | ⚠️ partial | ⚠️ images mostly | ⚠️ |
| Web Share **Target** (receive a share) | ⚠️ Chrome 89+ desktop | ✅ Chrome 76+ | ❌ | ❌ |
| `navigator.share({files})` (send out) | ✅ | ✅ | ✅ Safari 14+ | ✅ |
| `<a download>` blob | ✅ | ✅ | ⚠️ works, quirky | ⚠️ |
| Service worker / Cache API | ✅ | ✅ | ✅ but **7-day eviction** | ✅ exempt from 7-day |
| `getUserMedia` (camera) | ✅ | ✅ | ✅ | ⚠️ historically broken, now mostly OK |
| `BarcodeDetector` | ⚠️ platform-gated | ✅ | ❌ | ❌ |
| Screen Wake Lock | ✅ | ✅ | ✅ 16.4+ | ✅ **only 18.4+** |
| Fullscreen API on arbitrary element | ✅ | ✅ | ❌ **iPhone: no** (iPad yes) | ❌ |
| Programmatic brightness | ❌ nowhere | ❌ | ❌ | ❌ |

The five things that actually shape the design:

1. **File System Access API is not a cross-platform option.** It is Chromium-desktop-first,
   newly and partially on Android, and permanently absent from Safari and Firefox. Design for
   `<input type=file>` + `navigator.share` and treat FSA as a *large-file optimisation on desktop
   Chrome only*.
2. **iOS has no Web Share Target.** You cannot make "Share → qrbeam" appear in the iOS share
   sheet from a web app. Android can. This asymmetry is permanent for now.
3. **iOS Safari deletes all service-worker cache after 7 days of non-use** — unless the app is
   added to the Home Screen, which gets its own usage counter. "Air-gapped forever" on iOS
   *requires* Add to Home Screen (or the single-file HTML fallback).
4. **The iPhone cannot go fullscreen.** `Element.requestFullscreen()` is iPad-only on iOS.
   The sender's "big bright QR" screen must be built from CSS + Home-Screen-standalone mode,
   not the Fullscreen API.
5. **No browser can set screen brightness.** There is a W3C explainer that cites QR display as
   the motivating use case, but nothing has shipped. Brightness is a user instruction, not an API.

---

## 1. Getting the file IN on the sender

### 1.1 `<input type="file">` — the universal floor

This is the only file-input mechanism that works on every target. It is not glamorous but it
is the baseline everything else layers onto.
([MDN: `<input type="file">`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file))

```html
<input type="file" id="pick" />
```

Key properties, all from MDN:

- `HTMLInputElement.files` yields a `FileList` of `File` objects (`name`, `size`, `type`,
  `lastModified`). A `File` **is** a `Blob`, so `.slice()`, `.stream()`, and `.arrayBuffer()`
  are all available.
- `input.value` is always `C:\fakepath\<name>` — no real path is ever exposed, and you cannot
  set `input.value` from script. Irrelevant for us but worth knowing.
- `accept` filters the picker. On mobile, `accept="image/*"` will bias the picker toward the
  photo library. **For qrbeam we want the opposite: no `accept` at all**, so iOS offers "Browse"
  into the Files app rather than defaulting to Photos.
- `capture="environment"` forces the camera instead of a picker — we never want this on the
  sender side (we *do* care about `facingMode: environment` on the receiver, which is a
  `getUserMedia` constraint, not this attribute).

**iOS-specific gotchas** (not in the MDN spec text; these are behavioural):

- Picking a photo from the Photos library on iOS yields a file often named `image.jpg` with a
  transcoded JPEG, not the original HEIC. If the user picks via **Browse → Files**, they get
  the real file with the real name. qrbeam should nudge users toward Files ("Choose from Files")
  because we're transferring *files*, not *photos*, and a silent HEIC→JPEG transcode would make
  the received bytes differ from the source bytes.
- iOS reads from iCloud Drive on demand; a file that is not downloaded locally may take a moment
  or fail. Handle a `File` whose `.stream()` errors.

### 1.2 Drag and drop — desktop only, free to add

`dragover` + `drop`, reading `DataTransfer.files`. Zero cost, no support concerns on desktop,
completely irrelevant on mobile. Worth adding purely because on desktop it is the fastest path.

On Chromium you can upgrade a drop into a **handle** rather than a snapshot, via
`DataTransferItem.getAsFileSystemHandle()`, which returns a `FileSystemFileHandle`
([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)).
For qrbeam this buys nothing on the read path (we don't need to write back to the source), so
plain `DataTransfer.files` is sufficient.

### 1.3 File System Access API (`showOpenFilePicker`) — Chromium desktop, and don't rely on it

**Support, from caniuse's `native-filesystem-api` dataset** (title: *"API for manipulating files
in the device's local file system (not in a sandbox)"*)
([caniuse data](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/native-filesystem-api.json)):

| Browser | Status |
|---|---|
| Chrome 153 | ✅ yes (since 86) |
| Edge 150 | ✅ yes |
| Opera 131 | ✅ yes (91+) |
| Firefox 155 | ❌ no |
| Safari 27 TP | ❌ no |
| iOS Safari 26.5 | ❌ no |
| Chrome Android 150 | ❌ no (per caniuse) |
| Samsung Internet 30 | ❌ no |

MDN flags `showOpenFilePicker` as **"Limited availability — this feature is not Baseline because
it does not work in some of the most widely-used browsers"** and **Experimental**. It requires a
secure context and **transient user activation**; calling it outside a user gesture throws
`SecurityError`.
([MDN `showOpenFilePicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker))

Firefox has taken a formal **"harmful"** standards position on the local-disk pickers. Firefox and
Safari ship **only OPFS** (the Origin Private File System), which is a sandboxed, user-invisible
store — see §2.4. **This is the single most common piece of misinformation about this API:** you
will find pages (including
[Chrome's own docs page](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access),
whose embedded compat widget says "Firefox 111+, Safari 15.2+") that appear to claim Safari and
Firefox support the File System Access API. They support the *File System API* umbrella —
i.e. OPFS — **not** `showOpenFilePicker`/`showSaveFilePicker`. Safari 15.2 is the OPFS ship date
([WebKit: The File System API with Origin Private File System](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)).
Do not let a compat widget mislead the implementation.

**Android status is genuinely in motion.** Chromium's
[Intent to Ship: File System Access on Android and WebView](https://groups.google.com/a/chromium.org/g/blink-dev/c/x3IcFv2jY6c)
(filed 2024-09-05) reports the `FileSystemAccessLocal` feature was **enabled for Android in
M132** (comment dated 2024-10-26), with the known limitations spelled out in-thread:

- Android content-URIs support no atomic write or rename; `move` is implemented as copy.
- MIME-type filters on `image/*`/`text/*` are currently ignored.
- **Save-as is incomplete: users cannot create new files, only overwrite existing ones**, and
  there is no filename dialog.
- Opening folders with many files hangs Chrome.
- Android must choose between `Intent GET_CONTENT` (read-only, broad support) and `OPEN_DOCUMENT`
  (writable, narrower support); a spec change adding a read-only hint to `showOpenFilePicker`
  was under discussion.

Verdict: **feature-detect and use it as a progressive enhancement on desktop Chromium only.**
The one thing it buys us on the sender side is a `FileSystemFileHandle` that survives across
sessions when persisted to IndexedDB — nice for "resume last transfer" but not load-bearing.

### 1.4 Web Share Target — the Android superpower, absent on iOS

Registering qrbeam as a share destination is genuinely the nicest sender UX on Android:
long-press a file in Files/Drive/Photos → Share → qrbeam → the animation starts. From the
[Chrome docs on Web Share Target](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target)
and the [MDN `share_target` reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target):

```json
{
  "name": "qrbeam",
  "share_target": {
    "action": "/share-in",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "name",
      "text": "description",
      "files": [
        { "name": "payload", "accept": ["*/*"] }
      ]
    }
  }
}
```

Mechanics:

- File sharing **requires** `method: "POST"` and `enctype: "multipart/form-data"`. `method`
  defaults to `GET` if omitted, which cannot carry files.
- The share arrives as a real HTTP POST to `action`. Because qrbeam is a static site with no
  backend, **a service worker must intercept it**:

```js
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-in') {
    event.respondWith((async () => {
      const formData = await event.request.formData();
      const file = formData.get('payload');
      await stashFileForApp(file);           // e.g. into a Cache or OPFS
      return Response.redirect('/?shared=1', 303);
    })());
  }
});
```

  This is the standard pattern and is exactly why a share target on a static host works at all —
  the SW is the "server".
- **"On all platforms, your web app has to be installed before it will show up as a potential
  target for receiving shared data."** So this only fires for installed PWAs.
- MDN classifies `share_target` as **"Limited availability — not Baseline"** and *Experimental*.
  In practice: Chrome 76+ on Android, Chrome 89+ on desktop (Windows/ChromeOS), Edge. **Not
  Safari, not iOS.** There is no mechanism by which an iOS Home Screen web app can appear in the
  iOS share sheet.

Note the asymmetry with the *outbound* Web Share API, which iOS does have — caniuse's `web-share`
dataset shows Safari 14+ and iOS Safari 14+ with full support, Firefox none
([caniuse web-share](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/web-share.json)).
Sharing *out* works on iOS; being shared *to* does not.

### 1.5 Clipboard paste

`paste` event → `ClipboardEvent.clipboardData.files`, or the async
`navigator.clipboard.read()` → `ClipboardItem`. Reality check: OS clipboards mostly carry
*images* and *text*, not arbitrary files. On macOS/Windows desktop you can copy a file in
Finder/Explorer and paste it into a page in Chrome; on iOS you can paste an image. This is a
"nice if it happens" path, not a coverage strategy.

Implement it as a cheap `paste` listener that accepts `files` if present, and don't build UI
that promises it.

### 1.6 Recommended input combination

| Platform | Primary | Secondary |
|---|---|---|
| iOS Safari / Home Screen | `<input type=file>` with **no `accept`** (routes to Files app) | paste |
| Android Chrome (installed) | **Web Share Target** (`share_target` + SW POST handler) | `<input type=file>` |
| Android Chrome (not installed) | `<input type=file>` | — |
| Desktop Chromium | drag & drop | `showOpenFilePicker` (enhancement), `<input>`, paste |
| Desktop Firefox/Safari | drag & drop | `<input>`, paste |

Ship all of them behind one visual drop zone. They are all a handful of lines each and the union
is what gives full coverage.

### 1.7 File-size limits in practice

**Never call `file.arrayBuffer()` or `FileReader.readAsArrayBuffer()` on the whole file.** A
100 MB `ArrayBuffer` is a single contiguous allocation in the JS heap; on a low-end Android
device or an older iPhone that is a realistic OOM. The well-documented failure mode is that
`readAsText`/`readAsArrayBuffer` load the entire file into memory before anything can be
processed, and pages crash around the 1 GB mark on desktop — far lower on mobile.

The three correct tools:

1. **`Blob.slice(start, end)`** — zero-copy-ish view; the browser does not materialise the bytes
   until you read the slice. This is the right primitive for qrbeam because our unit of work is
   "give me bytes `[k*C, (k+1)*C)` so I can build frame *k*". A common recommendation is 64 MB
   read chunks for general file processing; for us the natural chunk is the *QR payload size*
   (~1–2 KB), so we'd slice a working window of, say, 1–4 MB and sub-slice within it.
2. **`File.stream()`** → `ReadableStream<Uint8Array>`. Chunks arrive incrementally; nothing is
   held whole. Supported in all modern browsers including Safari.
3. **`Blob` itself as the retained reference.** A `File` from an `<input>` is backed by the
   on-disk file, not by heap memory. Keeping the `File` around costs ~nothing. Keeping an
   `ArrayBuffer` of it costs `size` bytes.

**How this interacts with the encoder.** Fountain-coded transmission (see §5) is the awkward
case: an LT/RaptorQ encoder XORs a random subset of source blocks per output symbol, which
implies **random access across the whole file**. Two options:

- **Windowed fountain**: partition the file into windows (say 1–4 MB), fountain-code each window
  independently, transmit windows in sequence. Memory is bounded by one window; the receiver
  gets a natural "part 3 of 12" progress signal. Slight coding-efficiency loss at window
  boundaries, and the receiver must stay locked on until each window completes.
- **Whole-file in memory**: only viable when `file.size` is small. Given the throughput numbers
  in §6 (roughly 1 MB/minute), *anything we can realistically transmit fits in memory anyway* —
  a 10 MB file is 10 minutes of staring at a screen. **This is the key insight: qrbeam's
  practical file-size ceiling is far below the memory ceiling, so the memory question is
  largely moot.** Read via `Blob.slice` on principle, cap the accepted size at something like
  5–10 MB, and the problem disappears.

**Blob storage limits (Chromium), for reference** — from
[Chrome's Blob Storage System Design doc](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md):

| Platform | In-memory blob limit | Disk quota |
|---|---|---|
| x64 desktop (non-CrOS/Android) | 2 GB | `disk_size / 10` |
| Chrome OS | `total_physical_memory / 5` | `disk_size / 2` |
| **Android** | **`total_physical_memory / 100`** | `6 * disk_size / 100` |

The doc's own example: *"a 4 GB desktop system allows 2 GB in-memory blob storage but 50 GB total
disk quota, while Android devices with 2 GB RAM only support 20 MB in-memory limits."* Blobs over
the in-memory limit are paged to disk rather than failing. **Note the Android number: 20 MB of
in-memory blob on a 2 GB device.** Another reason to keep the working set small.

---

## 2. Getting the file OUT on the receiver

This is the harder half, and iOS is the reason.

### 2.1 The three mechanisms

**(a) `<a download>` + `URL.createObjectURL(blob)`**

The classic. caniuse's `download` dataset shows near-universal support: Chrome 14+, Edge 13+,
Firefox 20+, Safari 10.1+, **iOS Safari 13.0+**, Chrome Android, Samsung Internet — 96.19%
([caniuse download](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/download.json)).
Restrictions noted there: Firefox and Chrome 65+ only honour `download` for **same-origin**
resources. A `blob:` URL is same-origin with the creating document, so we're fine.

iOS caveats that matter:

- **The click must happen inside a real user gesture.** Programmatically clicking a blob-URL
  anchor outside a touch/pointer handler is *silently ignored* on iOS Safari. So: don't
  auto-download when the last chunk arrives. Show a **"Save file"** button and download from its
  `click` handler.
- iOS routes the download through Safari's Downloads manager (iOS 13+), which lands the file in
  `Files → Downloads` (or wherever the user configured). It does not always feel like a
  "download" to the user — expect confusion; say where it went.
- `URL.revokeObjectURL()` must be deferred (a `setTimeout` of a second or two after the click),
  or the download can be cancelled out from under itself.

**(b) `navigator.share({ files: [file] })` — the best iOS path**

MDN BCD for `Navigator.canShare` shows the `files` sub-feature at **Chrome 89 / Chrome Android 76
/ Edge 81 / Safari 14** (iOS Safari mirrors Safari), **Firefox: not supported**
([MDN BCD Navigator.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json)).
`Navigator.share` itself: Chrome 89 desktop / 75 Android, Safari 14, Firefox 96 behind
`dom.webshare.enabled`, WebView Android not supported.

On iOS this opens the native share sheet, which contains **"Save to Files"** — the user picks a
destination folder in the Files app and gets the real file with the real filename. This is the
most *legible* save experience on iOS by a wide margin, and it also enables "send straight to
Mail / AirDrop / another app" which is often what the user actually wanted.

Rules:
- Must be called from a user gesture (same as above).
- **Always gate on `navigator.canShare({ files: [f] })`** before showing the button. Historically
  iOS 14 returned false for files while Android returned true for the identical payload
  ([mdn/browser-compat-data#14163](https://github.com/mdn/browser-compat-data/issues/14163)),
  and there are long-standing reports of Safari degrading a file share into a text/URL share
  ([Apple Developer Forums](https://developer.apple.com/forums/thread/665812)). Feature-detect,
  and keep the `<a download>` button visible as a sibling, not as a fallback that only appears
  after a failure.
- Some platforms restrict shareable MIME types. Setting a generic `application/octet-stream` for
  unknown types is safest; where we know the extension, set the real type.

**(c) `showSaveFilePicker` + `FileSystemWritableFileStream` — desktop Chromium only**

Same support story as §1.3: Chromium desktop yes, Safari/Firefox no, Android partial and
**overwrite-only** (per the Intent-to-Ship thread — no new-file creation, no filename dialog).

Where it genuinely wins is **streaming to disk**:

```js
const handle = await window.showSaveFilePicker({ suggestedName: meta.name });
const writable = await handle.createWritable();
// as chunks are decoded and ordered:
await writable.write({ type: 'write', position: offset, data: chunk });
// at the end:
await writable.close();
```

MDN and Chrome's docs both state that **"changes are not written to disk until the stream is
closed, either by calling `close()` or when the stream is automatically closed by the pipe"** —
i.e. the browser buffers into a temporary swap file, then atomically moves it into place on
`close()`. The important consequence for qrbeam: **the buffered data lives on disk, not in the JS
heap**, so a long transfer does not grow the renderer's memory. `write()` accepts a string,
`BufferSource`, or `Blob`, and a `FileSystemWritableFileStream` is a `WritableStream`, so you can
`pipeTo()` it.

The `position` parameter also solves out-of-order arrival elegantly: with fountain coding you can
seek and write decoded blocks as they resolve, rather than holding a sparse array in memory.

### 2.2 What actually works on iOS — the honest answer

| Approach | iOS Safari (tab) | iOS Home Screen web app |
|---|---|---|
| `navigator.share({files})` | ✅ **best path** — share sheet → "Save to Files" | ✅ |
| `<a download>` blob, clicked from a gesture | ✅ goes to Safari Downloads | ⚠️ works but the download UI is muted/odd in standalone; test |
| `showSaveFilePicker` | ❌ not implemented | ❌ |
| OPFS (`navigator.storage.getDirectory()`) | ✅ since 15.2 — but user-invisible | ✅ |

**Do not** rely on `<a download>` alone on iOS. **Do** make "Save / Share" a single explicit
button the user taps, and behind it prefer `navigator.share({files})` when `canShare` says yes.

### 2.3 Blob URL size limits

There is no spec-defined maximum. In Chromium the practical limits are the blob-storage quotas
above: over the in-memory limit, blobs page to disk rather than failing, so a multi-hundred-MB
blob URL works on desktop but will thrash on a 2 GB Android phone (20 MB in-memory limit). The
often-cited "500 MB blob cap" is historical Chromium behaviour from ~2014–2015 and no longer
applies. Safari does not document a limit; assume the constraint is device RAM, since iOS is
aggressive about killing memory-hungry web content.

Since qrbeam's realistic maximum payload is single-digit megabytes (§6), blob URL size is a
non-issue in practice. Document it and move on.

### 2.4 Should we stream to disk for large files?

**Yes on desktop Chromium, and use OPFS as the universal staging buffer everywhere else.**

The architecture that works on all platforms:

1. As chunks decode, write them into an **OPFS** file via
   `navigator.storage.getDirectory()` → `getFileHandle(name, {create:true})` →
   `createWritable()` (or, in a worker, `createSyncAccessHandle()` for much faster writes).
   OPFS is supported in **Safari 15.2+ / iOS 15.2+**, Firefox, and Chromium — it is the *only*
   file-system API that is genuinely cross-browser
   ([WebKit blog](https://webkit.org/blog/12257/the-file-system-access-api-with-origin-private-file-system/)).
   Safari 26.0 additionally shipped **"support for the File System WritableStream API, enabling
   direct writing to files"** ([WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)),
   which is `FileSystemFileHandle.createWritable()` on OPFS handles — *not* `showSaveFilePicker`.
2. When the transfer completes, `getFile()` on the OPFS handle to obtain a `File`, and hand that
   to `navigator.share({files})` or an `<a download>` from a user gesture.
3. On desktop Chromium, skip OPFS and write straight to a user-chosen `showSaveFilePicker` handle.

Benefits: bounded memory, survives a page reload mid-transfer (resumable receive!), and the
final hand-off is a single `File` the platform already knows how to save.

Caveat: OPFS counts against origin storage quota and is subject to eviction — which brings us to
the 7-day problem in §3.

---

## 3. Offline / PWA

The whole premise is air-gapped operation, so "works with no network" is a correctness
requirement, not a nicety.

### 3.1 Service worker precaching

Service Workers are supported everywhere we care about: Chrome 45+, Edge 17+, Firefox 44+,
Safari 11.1+, **iOS Safari 11.3+**, Samsung 4.0+ — 95.59% global
([caniuse serviceworkers](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/serviceworkers.json)).
Note the Firefox caveat in that dataset: **service workers are not supported in Private Browsing
mode**.

Strategy for qrbeam: **precache everything, cache-first, no network in the critical path.**
qrbeam is small and fully static — there is no reason to use any strategy other than
precache-all + cache-only serving.

```js
const CACHE = 'qrbeam-v<BUILD_HASH>';
const ASSETS = ['/', '/index.html', '/app.js', '/qr.wasm', '/decode-worker.js', '/manifest.webmanifest', /* … */];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;              // let the share_target POST fall through
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
```

Points of care:

- Precaching happens in the **`install`** event; the app is not offline-ready until `install`
  completes. Show an "Ready for offline use ✓" indicator so the user knows when it is safe to
  walk into the Faraday cage. This is genuinely important UX for this app.
- Hash the cache name per build so a new deploy fully replaces the old precache; delete stale
  caches in `activate`.
- Workbox (`workbox-precaching` / `precacheAndRoute`) does exactly this with revision hashing and
  is worth using if there's already a build step
  ([Chrome: workbox-precaching](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)).
  For a hand-rolled ~10-file app, the 30 lines above are fine and have no dependency risk.
- **The `share_target` POST must not be swallowed by the cache-first fetch handler.** Handle it
  before the generic GET path (see §1.4).

### 3.2 iOS's 7-day storage eviction — the real offline blocker

From [WebKit: *Full Third-Party Cookie Blocking and More*](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/),
the **seven-day cap on all script-writable storage** covers:

- IndexedDB
- LocalStorage
- Media keys
- SessionStorage
- **Service Worker registrations and cache**

Deletion happens *"after seven days of Safari use without user interaction on the site."* User
interaction with the site resets the counter.

The exemption that saves us, quoted verbatim:

> *"Web applications added to the home screen are not part of Safari and thus have their own
> counter of days of use. Their days of use will match actual use of the web application which
> resets the timer. We do not expect the first-party in such a web application to have its
> website data deleted."*

**Consequence for qrbeam:** on iOS, a user who visits the site in a Safari tab, uses it once, and
comes back three weeks later offline will find **nothing cached and a blank page**. Add to Home
Screen is not a nice-to-have on iOS; it is the mechanism by which "offline forever" is true. The
onboarding must push it hard on iOS, and should explain *why* ("iOS deletes offline data for
websites you haven't used in a week — installing keeps qrbeam available with no internet").

The same reasoning applies to OPFS-staged partial transfers: don't assume they survive a week.

### 3.3 Web app manifest and `display: standalone`

Minimum viable manifest:

```json
{
  "name": "qrbeam",
  "short_name": "qrbeam",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "orientation": "any",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Plus the Android `share_target` block from §1.4.

### 3.4 iOS Add-to-Home-Screen quirks

- Safari has supported the Web App Manifest since **iOS 11.4** (March 2018). Before that (and
  still as a belt-and-braces measure) the mechanism was
  `<meta name="apple-mobile-web-app-capable" content="yes">`
  ([Apple: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)).
  Keep the meta tag — it costs nothing and covers old iOS.
- Historically, iOS required `display: "standalone"` or `"fullscreen"` in the manifest for the
  Home Screen entry to open as an app rather than a Safari tab.
- **iOS 26 changed the default.** From [WebKit Features in Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/):
  > *"By default, every website added to the Home Screen opens as a web app. If the user prefers
  > to add a bookmark for their browser, they can disable 'Open as Web App' when adding to Home
  > Screen."*
  and
  > *"This change, of course, is not removing any of WebKit's current support for web app
  > features! If the site you built has a Web Application Manifest, then all of the benefits it
  > provides will be part of the user's experience."*
  So on iOS 26+ every add-to-home-screen is a web app by default, but the manifest still governs
  name, icon, theme, and scope. Ship the manifest regardless.
- **There is no install prompt on iOS.** No `beforeinstallprompt`. The user must tap Share →
  Add to Home Screen manually. qrbeam must detect iOS Safari + non-standalone
  (`!window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone`) and show
  an illustrated instruction. This is unavoidable friction; treat it as a first-class onboarding
  screen, not a dismissible banner.
- **EU / DMA episode — resolved.** Apple's iOS 17.4 betas removed Home Screen web apps in the EU,
  then Apple reversed on 2024-03-01 and shipped iOS 17.4 with EU Home Screen web apps intact
  ([TechCrunch](https://techcrunch.com/2024/03/01/apple-reverses-decision-about-blocking-web-apps-on-iphones-in-the-eu/),
  [MacRumors](https://www.macrumors.com/2024/03/01/apple-walks-back-decision-to-disable-eu-web-apps/)).
  Many "PWA on iOS" articles still repeat the un-reversed version. It is fine now.
- Every browser on iOS is WebKit under the hood, so "use Chrome on iPhone instead" changes
  nothing about any of the above.
- Reported iOS 26 flakiness: PWA state/theme resetting between launches
  ([MudBlazor#12557](https://github.com/MudBlazor/MudBlazor/issues/12557)). Don't rely on
  in-memory state surviving a backgrounded standalone app; persist transfer state.

### 3.5 Camera access in an iOS standalone PWA — current state

This has a long and ugly history. Current summary:

- **The original blocker is fixed.** [WebKit bug 185448](https://bugs.webkit.org/show_bug.cgi?id=185448),
  *"getUserMedia not working in apps added to home screen that run in standalone mode"*, is
  **RESOLVED FIXED** — fixed in **iOS 13.4** (beta Feb 2020, public March 2020). Before that,
  camera in a Home Screen web app was flatly impossible.
- **Permission persistence is still a problem.** The camera grant is not durably persisted for
  Home Screen web apps; users can be re-prompted
  ([WebKit 215884](https://bugs.webkit.org/show_bug.cgi?id=215884),
  [STRICH KB, updated 2025-04-07](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa)).
- **Same-document navigation kills the stream.** WebKit ties the media-capture environment to the
  top frame document's current URL; a `pushState`/path change (not a hash change) destroys the
  environment and the stream ([WebKit 252465](https://bugs.webkit.org/show_bug.cgi?id=252465)).
  **Actionable:** qrbeam must not change the URL path while the camera is live. Use hash routing
  or no routing at all on the receive screen.
- **Regressions recur.** iOS 18.0 broke camera in Home Screen web apps and was fixed in 18.1.1
  ([Apple Developer Forums](https://developer.apple.com/forums/thread/769203)). iOS 26 introduced
  a 90°-rotation bug in `getUserMedia` for Home Screen apps
  ([Apple Developer Forums](https://developer.apple.com/forums/thread/801146)).
- STRICH — a commercial barcode-scanning SDK vendor, i.e. people who feel this pain
  professionally — still recommend as a workaround: *"Use the app directly in Safari instead of
  installing it as a PWA"*, and even suggest removing `apple-mobile-web-app-capable` to force
  Safari while keeping a Home Screen icon.

**Non-negotiable iOS video-element hygiene** (this bites everyone once):

```html
<video id="preview" playsinline autoplay muted></video>
```

Without `playsinline`, iOS hoists the video into the native fullscreen player and the app loses
the frame surface it needs to sample. `muted` is required for `autoplay` to be permitted. Also
call `video.play()` from the same user gesture that requested the camera — iOS will otherwise
leave the element paused with a black frame, which looks identical to "the camera is broken".

**Design consequence — and this is a genuinely awkward one:** on iOS, the *offline* requirement
pushes toward standalone (§3.2, 7-day eviction), while *camera reliability* historically pushed
away from it. Resolution: **ship standalone**, but (a) detect camera failure explicitly and show
an "Open in Safari" escape hatch on the receive screen, (b) never mutate the URL path while the
stream is live, (c) re-request `getUserMedia` on `visibilitychange` back to visible rather than
assuming the old track survived, and (d) handle a rotated/mirrored video track defensively —
the QR decoder should be orientation-agnostic anyway, but the *preview* should not look broken.

### 3.6 Storage persistence (`navigator.storage.persist()`)

Worth calling once at startup:

```js
if (navigator.storage?.persist) {
  const persisted = await navigator.storage.persist();
}
```

Per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), a granted
request means storage *"will not be cleared except by explicit user action"*; denied means the UA
may clear it under storage pressure. *"The browser may or may not honor the request, depending on
browser-specific rules"* — Chromium grants it silently based on engagement/installed-PWA
heuristics; Firefox prompts. It requires a secure context and is **not available in Web Workers**.

Two important limits for qrbeam:

- Persisted storage protects against **eviction under storage pressure**. It does **not**
  demonstrably override WebKit's 7-day ITP deletion (§3.2), which is a privacy mechanism, not a
  quota mechanism. Do not treat `persist()` as a substitute for Add-to-Home-Screen on iOS.
- It also protects the OPFS staging file used for partial receives (§2.4), which is the more
  practical benefit.

**OPFS support is the good news of this whole document:** MDN marks the Origin Private File
System **"Baseline Widely available"** — available across browsers since **March 2023**
([MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)),
with WebKit shipping it in Safari 15.2 / iOS 15.2. `createWritable()` works on the main thread;
`createSyncAccessHandle()` (much faster, synchronous) works **only in a worker**. And crucially
`fileHandle.getFile()` returns a real `File`, which drops straight into
`navigator.share({files:[file]})` or an `<a download>`. That is the one cross-platform
write-then-hand-off pipeline that exists.

### 3.7 Single self-contained HTML file as an alternative distribution

Extremely attractive for this app: one `qrbeam.html` the user saves to a USB stick or their
Downloads folder and can open forever, with no server, no service worker, no cache eviction, no
install flow. It is the true air-gap artefact.

**What works:**

- Inlining JS and CSS into one HTML file is a solved problem —
  [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile) does
  exactly this and explicitly names this use case: *"this can be very handy for offline web
  applications — apps bundled into a single HTML file that you can double-click and open directly
  in your web browser, no server needed."*
- `file://` **is a secure context.** MDN: *"a secure context is a page loaded using HTTPS or the
  `file:///` URL scheme, or a page loaded from localhost"*
  ([MDN: getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
  [MDN: Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)).
  So `navigator.mediaDevices` is exposed and `getUserMedia` is spec-permitted from a local file.
  A May 2025 W3C WebRTC thread questioning `getDisplayMedia()` from `file://` explicitly frames
  the spec as *currently permitting* it
  ([public-webrtc archive](https://lists.w3.org/Archives/Public/public-webrtc/2025May/0002.html)) —
  which is corroboration that the file:// secure-context path is real, and also a warning that
  it is under scrutiny. **Verify empirically on each target browser before promising it.**

**What breaks:**

- **Service workers cannot be registered from `file://`.** Not a loss — a single file has nothing
  to cache — but it does mean *no Web Share Target*, and no offline-readiness indicator.
- **Web Workers.** A classic `new Worker('./decode.js')` needs a separate file. The workaround is
  a **Blob URL worker**: inline the worker source as a string, `new Worker(URL.createObjectURL(
  new Blob([src], {type:'text/javascript'})))`. This works, but note that `type: 'module'`
  workers from blob URLs have historically had inconsistent support, and **importScripts from a
  blob worker resolves relative URLs against the blob origin**, which breaks. Bundle the worker
  to a single self-contained classic-script string.
- **WASM.** `WebAssembly.instantiateStreaming(fetch('x.wasm'))` cannot fetch a sibling file over
  `file://` (blocked by the file-origin policy in Chrome unless launched with
  `--allow-file-access-from-files`). Workaround: **base64-embed the `.wasm` and use
  `WebAssembly.instantiate(bytes)`**. Cost: ~33% size inflation and a synchronous decode.
  `vite-plugin-wasm` exists but note Vite's docs state the *ES Module Integration Proposal for
  WebAssembly is not supported* natively — community plugins are required
  ([vite-plugin-wasm](https://www.npmjs.com/package/vite-plugin-wasm)).
  **Strong recommendation: for the single-file build, use a pure-JS QR encoder and decoder and
  ship no WASM at all.** The decode work is the only thing that would want WASM, and a pure-JS
  decoder at 10 fps on a modern phone is adequate (see §7).
- **CORS / module scripts.** `<script type="module">` from `file://` is blocked in Chrome by the
  file-origin rules. The single-file build must emit a **classic script** (`<script>` with no
  `type=module`), i.e. an IIFE bundle. `vite-plugin-singlefile` handles this by inlining, but
  verify the output has no `type="module"` and no dynamic `import()`.
- **`navigator.share` / `canShare`** from `file://`: secure context is satisfied, but expect
  platform quirks. Keep `<a download>` as the save path in the single-file build.
- Static assets in `public/` are *not* inlined by `vite-plugin-singlefile` — everything must go
  through the bundler as an import.

**Verdict:** ship **both**. The hosted PWA is the primary product; a `qrbeam-standalone.html`
(pure JS, no WASM, no modules, blob-URL worker or no worker at all) is a secondary artefact
offered on the page as "Download the offline copy". For the truly air-gapped use case — the one
where someone is transferring a key onto a machine that has never touched a network — the single
file *is* the product, and it should be treated as a first-class build target with its own tests.

---

## 4. Sender-side display concerns

### 4.1 Keeping the screen awake — Screen Wake Lock API

Support, from caniuse's `wake-lock` dataset ("API to prevent devices from dimming, locking or
turning off the screen when the application needs to keep running")
([caniuse wake-lock](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/wake-lock.json)):
Chrome 85+, Edge 90+, Firefox 126+, **Safari 16.4+**, Opera 73+, **iOS Safari 16.4+**, Samsung
Internet 14+, Chrome Android.

The caniuse dataset carries the note *"On iOS, the API functions only in the browser itself, not
in PWA mode"* — **that note is now out of date.**
[WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545), *"New Wake Lock API does not
work in Home Screen Web Apps"*, is **RESOLVED FIXED**: the WebKit change landed April 2023
(commit `263419@main`) but did not ship to users until **iOS/iPadOS 18.4, released 2025-03-31**,
announced by Jen Simmons — *"The Screen Wake Lock API now works in Home Screen Web Apps on iOS
and iPadOS 18.4 — which just shipped today."* A December 2025 comment reporting a regression in
iOS 26.1 was retracted as a browser-detection false alarm.

So: **wake lock works in iOS Home Screen web apps only on iOS 18.4+.** Below that, in standalone
mode, the screen will sleep mid-transfer. That is a real failure for a 4-minute animation.

Semantics we must implement ([MDN Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)):

- Secure context required; permissions-policy `screen-wake-lock`, default allowlist `self`.
- **The lock is auto-released whenever the document becomes hidden or inactive** — tab switch,
  app switch, lock screen. It does *not* come back by itself.
- The standard re-acquisition pattern:

```js
document.addEventListener("visibilitychange", async () => {
  if (wakeLock !== null && document.visibilityState === "visible") {
    wakeLock = await navigator.wakeLock.request("screen");
  }
});
```

- `request()` can reject (typically `NotAllowedError`) for system reasons — low battery, power
  save mode. Wrap in try/catch, and if it fails, **tell the sender to set their auto-lock to
  Never**, because a screen that sleeps at 30 s makes the app unusable.
- Listen for the `release` event to update UI.

**Fallback for pre-18.4 iOS standalone / any failure:** the classic hack is a tiny silent looping
`<video>` playing inline (`playsinline muted loop`), which historically kept iOS awake. This is
unreliable and increasingly so; prefer a clear instruction ("Settings → Display & Brightness →
Auto-Lock → Never") over a hack that silently stops working.

### 4.2 Forcing maximum brightness — you cannot, and here's the proof

There is **no shipping web API to set screen brightness on any browser.** Firefox OS had
`Screen.mozBrightness` (0–1); it is dead and non-standard
([MDN mozBrightness](https://developer.mozilla.org/en-US/docs/Web/API/Screen/mozBrightness)).

The live proposal is the W3C
[**brightness-mode explainer**](https://github.com/w3c/screen-wake-lock/blob/gh-pages/brightness-mode-explainer.md)
in the `screen-wake-lock` repo. It proposes extending the `Screen` interface with
`requestBrightnessIncrease()` returning a sentinel with `release()`, *"inspired by the Wake Lock
API"* — i.e. a request for a *boost*, not an absolute setter (absolute `navigator.screenBrightness`
was rejected over fingerprinting). Critically for us, **the explainer's headline motivating use
case is exactly ours**: barcode/QR scanning, where *"boosting the screen brightness creates more
contrast"* under poor lighting, citing native apps (Starbucks, government ID apps) that already do
it. Status: *"This API shape is currently being experimented with"* — a WIP spec draft and a
Chromium CL. WebKit has an open standards-position issue on it
([WebKit/standards-positions#19](https://github.com/WebKit/standards-positions/issues/19)).
**Nothing has shipped. Do not plan around it; do feature-detect it so qrbeam gets better for free
if Chromium ships it.**

**What to do instead:**

1. **Tell the user.** A pre-flight checklist on the sender screen: "Turn brightness up. Turn off
   Auto-Brightness / Adaptive Brightness / Night Shift / True Tone." This is the honest answer and
   every serious optical-transfer tool does some version of it.
2. **Maximise apparent contrast in-app.** Pure `#000` on `#fff` QR modules, a generous quiet
   zone, and a large white surround. The white surround genuinely helps: many phones' auto-
   brightness responds to a mostly-white screen by *raising* backlight, and it also floods the
   receiver's exposure metering toward a setting that resolves the black modules well.
3. **Consider inverting deliberately.** Some cameras handle a light-on-dark QR poorly; standard
   dark-on-light is the safe default and what every decoder is tuned for. Offer an invert toggle
   only as a troubleshooting option.
4. **Avoid OLED aggressive dimming**: sustained full-white on OLED phones triggers automatic
   brightness roll-off after a minute or two. A QR is roughly 50 % black by area which helps, but
   don't add a large solid-white border beyond the required quiet zone on OLED.

### 4.3 Fullscreen API — iPhone cannot do it

From caniuse's `fullscreen` dataset: Chrome 71+, Edge 79+, Firefox 64+, Safari 16.4+, Chrome
Android, Samsung 10.1+ — and **iOS Safari: partial only**, with the note verbatim:

> *"Partial support refers to supporting only iPad, not iPhone. Shows an overlay button which can
> not be disabled."*

([caniuse fullscreen](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/fullscreen.json))

So `document.documentElement.requestFullscreen()` does nothing useful on iPhone. What we can do
on iPhone:

- **`display: "standalone"` in the manifest** — a Home Screen web app has no browser chrome. This
  is the iPhone's fullscreen. Another reason to push Add-to-Home-Screen.
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover,
  user-scalable=no">` plus `env(safe-area-inset-*)` padding to fill the display.
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` to darken the
  status bar area in standalone.
- Hide everything but the QR during transmission; the chrome is the enemy of the code's size.

On Android and desktop, do call `requestFullscreen()` from the "Start beaming" gesture — it is
free real estate, and larger modules decode from further away.

### 4.4 Defeating dark mode / colour inversion

A QR code whose colours get inverted or auto-darkened by the OS or browser is a QR code that
fails to scan (most decoders handle inversion, but auto-dark-theme's *partial* remapping produces
low-contrast grey-on-grey, which is worse than a clean inversion).

- **Chrome Android "Auto Dark Theme"** applies an auto-generated dark theme to light sites when
  the user has OS dark mode on ([Chrome: Auto Dark Theme](https://developer.chrome.com/blog/auto-dark-theme)).
  Opt out — and use the **meta tag** form, because per Chrome's docs *"the advantage of using the
  meta tag is that it prevents Auto Dark Theme from being applied at all, which could cause a
  'flash of darkened content'"*:

  ```html
  <meta name="color-scheme" content="only light">
  ```

  and/or, scoped to just the QR surface so the rest of the app can still be dark:

  ```css
  .qr-surface { color-scheme: only light; }
  ```

  `color-scheme` is the right tool: *"color-scheme exclusively determines the default appearance…
  this feature prevents browsers from applying any transformations on their own"*
  ([web.dev: color-scheme](https://web.dev/articles/color-scheme),
  [MDN color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme)).
- **Render the QR as a `<canvas>`, not as CSS-coloured DOM.** Canvas pixel data is not subject to
  the auto-dark colour remapping that applies to CSS colours. (An `<img>` is likewise skipped,
  which is also relevant to the next point.)
- **iOS "Smart Invert"** inverts screen colours *"except for images, media and some apps that use
  dark colour styles"*, in contrast to Classic Invert which inverts everything
  ([Apple: Display & text size preferences](https://support.apple.com/en-gb/ht207025),
  [How-To Geek](https://www.howtogeek.com/692271/how-to-force-dark-mode-in-any-iphone-app-with-smart-invert/)).
  There is no web API to opt out of either. Rendering the QR as a `<canvas>` or `<img>` gives us
  the best odds of being treated as "media" and skipped by Smart Invert — but Safari's Smart
  Invert handling of web pages is reported to be inconsistent
  ([AppleVis](https://www.applevis.com/forum/low-vision-accessibility-apple-products/smart-invert-colors-feature-10134)).
  Classic Invert will invert us regardless.
  **Mitigation that actually works: make the decoder inversion-tolerant.** ZXing-family decoders
  can be run against both the frame and its inverse; doing so costs one extra pass and makes the
  whole class of problem disappear. Also add a manual "colours look wrong?" invert toggle on the
  sender.
- Also worth suppressing: `filter`/`backdrop-filter` inherited from a theme, CSS transitions on
  the QR element (a fading cross-dissolve between frames is fatal — see below), and any
  `image-rendering` smoothing. Set `image-rendering: pixelated` on the canvas so module edges
  stay hard when scaled.

### 4.5 Refresh rate: detection and frame sync

**Detection.** There is no API. The universal technique is to run `requestAnimationFrame` in a
tight loop, timestamp each callback with `performance.now()`, and take `1000 / median(delta)`,
which converges to the true refresh rate within a few hundred frames. `rAF` callback frequency
*"will generally match the display refresh rate"*
([MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)).

Caveats:
- Apple's ProMotion is **adaptive** — the panel ramps between low rates and 120 Hz depending on
  content, so a static page can legitimately measure below 120 Hz. Safari 16+ raised the web cap
  to 120 Hz but only *when the page is actively animating via rAF and the device is not in Low
  Power Mode*. Measure *while animating*, not before.
- All browsers throttle background tabs to ~1 Hz or pause them, so measurement is meaningless if
  the tab is not visible — and, more importantly, **a backgrounded sender stops transmitting**.
  Detect `visibilitychange` and pause/warn.

**Sync.** The rule that matters: **drive frame flips from `requestAnimationFrame`, never from
`setInterval`/`setTimeout`.** `setInterval(fn, 100)` on a 60 Hz display produces a 6-frame /
7-frame beat pattern and occasional torn or duplicated frames; the receiver's rolling-shutter
camera will then occasionally capture a frame mid-swap, producing an un-decodable half-and-half
image.

Concretely:

```js
const targetPeriodMs = 1000 / targetFps;     // e.g. 100 for 10 fps
let last = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (now - last < targetPeriodMs - 0.5) return;   // hold current frame
  last = now;
  drawNextQr();
}
requestAnimationFrame(tick);
```

Better still: **quantise the target fps to an integer divisor of the measured refresh rate**
(60 Hz → 10/12/15/20 fps; 120 Hz → 10/12/15/20/24/30). A frame that is displayed for an exact
integer number of vsyncs is displayed for a *constant* duration, which maximises the receiver's
chance of catching a whole, stable frame. Given a measured refresh `R`, pick
`hold = round(R / targetFps)` and show each QR for exactly `hold` vsyncs.

Two more display-side rules:
- **No transitions, no cross-fades, no CSS animation on the QR element.** Draw the new frame in
  one synchronous `putImageData`/`drawImage` inside the rAF callback.
- **Consider inserting a short blank/marker frame** between data frames if tearing proves to be a
  problem. It costs throughput but eliminates half-and-half captures. Measure before adopting.

---

## 5. UX patterns for animated-QR transfer

*(Section populated from dedicated prior-art research; see subsections.)*

<!--SECTION5-->

---

## 6. Realistic throughput expectations & framing

**Bottom line:** for a *web* app doing one QR per frame at 10–15 fps, the credible band is
**8–20 KB/s goodput**, and **~12 KB/s is the honest planning number**. Every published figure
above ~100 KB/s requires either a non-QR symbology, multiple QR codes tiled per frame at 30–60 fps
with a propped device, or is self-reported and unreplicated.

### 6.1 QR capacity — the hard arithmetic ceiling

Byte-mode capacity, from Denso Wave (the inventor)
([version overview](https://www.qrcode.com/en/about/version.html),
[v11–20](https://www.qrcode.com/en/about/versionPage/versionPage11_20.html),
[v21–30](https://www.qrcode.com/en/about/versionPage/versionPage21_30.html),
[v31–40](https://www.qrcode.com/en/about/versionPage/versionPage31_40.html)), cross-checked
against [Wikipedia](https://en.wikipedia.org/wiki/QR_code):

| Version | Modules | L | M | Q | H |
|---|---|---|---|---|---|
| 10 | 57² | 271 | 213 | 151 | 119 |
| 15 | 77² | 520 | 412 | 292 | 220 |
| 20 | 97² | **858** | 666 | 482 | 382 |
| 27 | 125² | **1,465** | 1,125 | 805 | 625 |
| 33 | 149² | **2,068** | 1,628 | 1,168 | 898 |
| 40 | 177² | **2,953** | 2,331 | 1,663 | 1,273 |

EC restoration: L = 7%, M = 15%, Q = 25%, H = 30%. Going L→M costs 21% of capacity at v40.
**Every serious animated-QR project uses level L and lets an outer fountain code handle
erasures** — in-frame ECC fixes *corruption*, the fountain layer fixes *loss*, and they are
different problems.

Raw ceilings at level L, one QR per frame:

| version (L) | B/frame | 5 fps | 10 fps | 12 fps | 15 fps | 24 fps | 30 fps |
|---|---|---|---|---|---|---|---|
| v10 | 271 | 1.4 | 2.7 | 3.3 | 4.1 | 6.5 | 8.1 KB/s |
| v20 | 858 | 4.3 | 8.6 | 10.3 | 12.9 | 20.6 | 25.7 KB/s |
| v27 | 1465 | 7.3 | 14.7 | 17.6 | 22.0 | 35.2 | 44.0 KB/s |
| v33 | 2068 | 10.3 | 20.7 | 24.8 | 31.0 | 49.6 | 62.0 KB/s |
| v40 | 2953 | 14.8 | 29.5 | 35.4 | 44.3 | 70.9 | 88.6 KB/s |

**Single-QR-per-frame at 10–15 fps cannot exceed ~30 KB/s, ever.** That is not an engineering
limit, it is the capacity table times the frame rate.

### 6.2 What density is actually decodable — the 3-px-per-module rule

There is **no published measurement** of "max QR version decodable from a phone screen at
distance X". The best available model is from `kig` (author of [qr-send.com](https://qr-send.com)),
[HN comment](https://news.ycombinator.com/item?id=48234287):

> *"QR codes encode **0.75 bits per module**, each module needs about **3 pixels of camera
> resolution**, and the temporal resolution is quite dodgy as well, maybe **0.25 ×
> min(cameraHz, screenHz)**. So if everything is perfect, 44 kB/s at 60 Hz per a 500×500 pixel
> patch. I've seen **~250 kB/s when a 1920×1080@60 transfer is working well**."*

The 0.75 bits/module figure checks out exactly (v40: 177² = 31,329 modules for 23,624 bits =
0.754), which lends credibility to the rest. Applying the 3-px rule with a ~70° camera FOV:

| Sender screen | Distance | QR px at 1080p capture | Max modules | Max version |
|---|---|---|---|---|
| 6" phone | 45 cm (arm's length) | 210 | 70 | **~v13** |
| 6" phone | 20 cm | 475 | 158 | ~v35 |
| 6" phone, 4K capture | 45 cm | 420 | 140 | ~v30 |
| 13" laptop | 45 cm | 540 | 180 | **v40 ✓** |

*(Derived, not measured — flagged as such.)* This is exactly why
[decimen's README](https://github.com/bashalarmistalt/decimen-optical-transfer) says the sender
should ideally be *a laptop*, and why v40 only works phone-to-phone at close range.

Corroboration that density is the failure mode:
- [Blockchain Commons](https://developer.blockchaincommons.com/animated-qrs/): *"large QRs pack
  their data so tightly that they can easily become unreadable on consumer devices."*
- [qr-backup FAQ](https://github.com/za3k/qr-backup/blob/master/docs/FAQ.md) defaults to
  **version 10**: *"the basic answer to 'why isn't qr-backup's density higher' is that a
  webcam's resolution is lower than a printer's resolution… If you print a denser backup, some
  computers won't be able to restore it via webcam."*

**Implication for qrbeam: QR version must be a runtime-adaptive parameter.** Start at v20–v27 and
push higher only when sustained decode success justifies it. Never hard-code v40.

### 6.3 Measured rates from the literature

| Source | Symbology | Measured rate | Conditions | Confidence |
|---|---|---|---|---|
| [txqr post 1](https://divan.dev/posts/animatedqr/) (2018) | QR, looping | **9 KB/s** peak; **1–2 KB/s** typical | 11 fps, 850 B, EC-M, 13 KB, tripod | **HIGH** — 4 h exhaustive sweep |
| [txqr post 2](https://divan.dev/posts/fountaincodes/) (2018) | QR + LT fountain | **~26 KB/s** (13 KB in 501 ms) | 12 fps, 1850 B, EC-L | MEDIUM — best-case single run |
| [libcimbar PERFORMANCE.md](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md) | **not QR** — 4-colour cimbar | **106 KB/s** sustained (4.69 MB in 44 s) | 1024², 7500 B/frame, wirehair + zstd, monitor→phone | **HIGH** — best-documented in the field |
| [kig / qr-send](https://news.ycombinator.com/item?id=48234287) | QR, multi-code/frame | *"~250 kB/s when a 1920×1080@60 transfer is working well"* | Wirehair FEC, WASM zbar @60 fps | MEDIUM — informal |
| [RaptorQR](https://github.com/infrost/RaptorQR) (Jul 2026) | 4× QR tiled + RaptorQ | 183.6 KB/s (6.5 MB in 36 s) | v30-L, 2×2 composite, 30 fps, iPhone 16/Safari | MEDIUM-LOW — self-labelled "lab results" |
| [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer) (30 Jul 2026) | QR + LT | 129 KB/s claimed | 120 Hz ProMotion sender, stacked codes | **LOW** — see below |
| [PixNet](https://groups.csail.mit.edu/netmit/wordpress/projects/spectrum-usage-coverage-data-rates/pixnet/) (SIGCOMM'10) | 2D-OFDM | up to 12 Mb/s at 10 m | large LCD + dedicated receiver | HIGH but not a phone app |
| [COBRA](https://dl.acm.org/doi/10.1145/2307636.2307645) (MobiSys'12) | colour barcode | 153–597 kbps | phone→phone, motion-blur optimised | MEDIUM (abstract only) |
| [LightSync](https://www.researchgate.net/publication/266654517_LightSync_unsynchronized_visual_communication_over_screen-camera_links) (MobiCom'14) | colour barcode | ~11 KB/s | unsynchronised screen-camera | MEDIUM |

**Two corrections worth carrying forward:**

1. **The famous "25 kbps" txqr number is a unit typo.** 13 KB ÷ 0.501 s = **25.9 KB/s ≈ 207 kbps**.
   divan means kilo*bytes*; [Packt](https://www.packtpub.com/en-us/learning/tech-news/introducing-txqr-data-transfer-via-animated-qr-codes)
   and [HN](https://news.ycombinator.com/item?id=18804767) repeat "25kbps" verbatim and it is
   wrong by 8×.
2. **Treat the newest headline numbers sceptically.** `decimen` was created 2026-07-30 — one day
   before this research — and made [Tom's Hardware](https://www.tomshardware.com/networking/streaming-qr-codes-at-60-fps-achieves-nearly-190-kb-s-data-rate-in-phone-to-phone-tests-browser-based-method-requires-no-app-no-networking-no-pairing-and-no-permissions-beyond-camera-access)
   the next day on the strength of a Reddit post, with no independent replication. Its README's own
   documented defaults (24 fps × 1465 B = 35.2 KB/s raw) are **4.2× below** its hero screenshot's
   claimed 129.2 KB/s goodput, and the 128/186 KB/s figures are attributed to an *unpublished*
   "parent experiment" with multi-code grids and a colour channel. The **architecture** in that
   README is worth copying; the **numbers** are not yet evidence.

### 6.4 The real bottleneck is the camera, not the decoder

Measured decoder throughput ([Tokopedia Engineering](https://medium.com/tokopedia-engineering/building-60-fps-qr-scanner-for-the-mobile-web-eb0deddce099),
benchmarked on a MacBook Pro with 6× CPU slowdown as a mobile proxy):

| Setup | Result |
|---|---|
| jsQR single decode | ~47 ms avg (~21 fps ceiling); pathological cases **800–1023 ms** |
| quirc compiled to WASM | ~29 ms → ~34 fps |
| jsQR on main thread | app-level **~17 fps** |
| **WASM decoder in a Web Worker** | main thread cost ~6 ms, app hits **60 fps** |

Detection-rate comparison from [danimoh/qr-scanner-benchmark](https://github.com/danimoh/qr-scanner-benchmark/blob/master/result.txt):
on the "photographed screen" corpus both zxing-js and jsQR hit 16/16; on "small, low res",
zxing 93.3% vs jsQR 78.3% vs LazarSoft 61.7%.

libcimbar states the conclusion outright: *"more modern cell CPUs run the decoder more quickly,
but it turns out that this does not benefit performance much: **the camera is usually the
bottleneck**."*

**Decoder choice: `zxing-wasm` ([Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm)) in a
Web Worker, driven by `requestVideoFrameCallback`.** Both decimen and RaptorQR converged on this
independently. **`BarcodeDetector` is not viable** — WebKit has never shipped it, which eliminates
every browser on iOS.

**Frame-rate ceiling — three independent rules that agree:**

1. decimen: *"each frame must own at least 2 refresh cycles of the display"* → 30 fps max on a
   60 Hz screen; 24 fps gives 2.5 cycles.
2. kig: effective decoded rate ≈ **0.25 × min(cameraHz, screenHz)** → ~15/s on a 60/60 link.
3. divan (measured, 2018): optimum at **6–7 fps**, degrading above 11–12 fps.

The gap between divan's 6–7 and modern 24–30 is real hardware progress. A 10–15 fps design point
sits comfortably inside the safe regime (each displayed frame gets 2–3 camera frames at 30 fps
capture), giving ~80–92% per-frame decode success rather than divan's coin-flip at 11 fps.

⚠️ **iOS camera gotcha worth stealing verbatim** (decimen): *"iOS lies about camera frame rate.
`frameRate: {ideal: 60}` silently delivers 30; you must demand `{exact: 60}` (works at 1280-wide
capture) and fall back. Always read back `getSettings()`."*

### 6.5 The overhead stack

| Layer | Cost | Note |
|---|---|---|
| QR EC level L | already priced into the capacity table | use L |
| Per-frame header | ~20 B (session id, seq, k, blockLen, totalLen, hash) | 2.3% at v20, 1.4% at v27, 0.7% at v40 |
| **LT fountain** | **×1.15** (87% efficiency) | standard LT literature; matches decimen's *"any ~K·1.15 distinct frames"* |
| RaptorQ alternative | ×1.02–1.05 | materially better, heavier to implement (RFC 6330) |
| Dropped frames | ×0.80–0.92 at 10–15 fps | from divan's ~20% loss assumption + modern headroom |
| Base64 | **0% if you avoid it** | use QR **byte mode** with raw bytes; jsQR exposes `binaryData`, zxing-wasm returns bytes. Base64 costs 33% for nothing. |

Composite estimates:

| Scenario | Config | Raw | **Goodput** |
|---|---|---|---|
| **Conservative** — phone→phone, handheld, arm's length | v20-L, 10 fps, 92% decode | 8.6 KB/s | **≈ 6.7 KB/s** |
| **Default** — laptop→phone, handheld | v27-L, 12 fps, 85% | 17.6 | **≈ 12.8 KB/s** |
| **Good** — laptop→phone, propped | v33-L, 15 fps, 85% | 31.0 | **≈ 22.7 KB/s** |
| **Aggressive** — laptop→phone, propped, 60 Hz | v40-L, 24 fps, 85% | 70.9 | **≈ 52 KB/s** |
| **Stretch** — 2×2 tiled codes, 30 fps | 4× v27-L, 30 fps, 80% | 175.8 | **≈ 120 KB/s** |

### 6.6 What to tell the user, and when to refuse

Transfer times, excluding a 2–5 s lock-on/autofocus/exposure-settle period:

| File size | 5 KB/s (worst) | **12 KB/s (default)** | 25 KB/s (good) | 50 KB/s (propped) |
|---|---|---|---|---|
| **10 KB** | 2 s | **0.8 s** | 0.4 s | 0.2 s |
| **100 KB** | 20 s | **8 s** | 4 s | 2 s |
| **1 MB** | 3.4 min | **1.4 min** | 41 s | 20 s |
| **10 MB** | 34 min | **14 min** | 6.8 min | 3.4 min |
| **100 MB** | 5.7 h | **2.4 h** | 68 min | 34 min |

Recommended thresholds:

| Size | Behaviour | Reasoning |
|---|---|---|
| **< 50 KB** | Just go. No estimate needed. | ≤4 s. **This is the killer use case** — SSH keys, PSBTs, WiFi passwords, TOTP seeds, config files, recovery codes. |
| **50 KB – 500 KB** | Live progress + ETA | 4–40 s. Users will hold still for 30 s if they can see progress. |
| **500 KB – 2 MB** | **Warn**: "About N minutes. Prop both devices against something." | 40 s–3 min. Handheld autofocus hunting becomes the dominant failure mode. |
| **2 MB – 10 MB** | **Strong warning** + explicit confirm + recommend a stand | 3–14 min. Thermal throttling and screen timeout become real. |
| **> 10 MB** | **Refuse by default**, behind an "I know what I'm doing" toggle | 14+ min. An SD card, a cable, or a printer beats this. |
| **Hard cap** | 32–64 MB | libcimbar caps at 33 MB post-compression; decimen caps at 64 MB *"so the 16-bit fountain block count stays valid"*; [qr-send's QRTP](https://qr-send.com/docs/protocol/) caps one fountain at 64,000 blocks (≈23.5 MB at 368 B packets) |

**Two free multipliers:**

1. **Compress adaptively before encoding.** libcimbar measures *"bits over the wire, e.g. data
   after compression is applied"* and uses zstd;
   [airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer) uses
   pako/gzip. For text/JSON/config payloads this is a 3–10× effective speedup for free. Skip it
   for already-compressed formats — decimen's approach is to *"adaptively gzip files when
   compression saves at least 64 bytes."*
2. **Offer a WebRTC/LAN path when one exists.** qr-send does exactly this: *"The browser-to-browser
   transfer falls up to WebRTC when possible because **30 MB/s over wifi beats a 100 kB/s QR
   stream**."* A 300× ratio. Optical should be the fallback for the genuinely air-gapped case,
   not the default when a network is reachable. *(Whether qrbeam wants a network path at all is a
   product decision — "no server, ever" is a legitimate positioning that trades this away.)*

### 6.7 Gaps in the literature

Honestly flagged:

- **No published measurement** of max decodable QR version vs. distance vs. screen size. §6.2 is a
  derivation from a heuristic. This is a ~2-hour experiment and would be genuinely novel data.
- **No published PSBT-over-BC-UR transfer time.** The MUR spec explicitly declines to specify
  fragment sizes.
- **No independent replication of any >100 KB/s pure-QR claim.** libcimbar is the only >100 KB/s
  figure with a credible documented methodology, and it is not QR.
- COBRA / ChromaCode / RDCode full texts are paywalled; those numbers come from abstracts.

---

## 7. Testing strategy

<!--SECTION7-->

---

## 8. Recommendations for qrbeam

<!--SECTION8-->

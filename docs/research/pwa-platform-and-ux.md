# qrbeam — App Shell Research: Platform APIs, Offline/PWA, File I/O, and Optical-Transfer UX

**Scope:** the app shell only — how the file gets in, how it gets out, how the app runs with no
network, how the sender's screen is set up, how progress is communicated with no back-channel,
what throughput to promise, and how to test any of it without two phones taped together.

**Date of research:** 2026-07-31. Version numbers below are current as of that date; anything
marked *"check before shipping"* moves fast.

**Reading note:** Every "does X work on iOS?" answer in this document is deliberately pessimistic
until proven otherwise. iOS is the constraint that shapes the whole architecture.

> ⚠️ **Name collision, flagged early because it is cheap to fix now and expensive later:** a project
> called **QRBeam** already exists — [DzKriMo/QRBeam](https://github.com/DzKriMo/QRBeam) —
> browser-based animated-QR file transfer, 2–30 fps selectable (default 10), 300/500/750 B frames,
> ECC M. Same concept, same name, same delivery model. Worth a deliberate decision to rename or
> differentiate before any public artefact ships.

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
  A May 2025 W3C WebRTC thread questioning `getDisplayMedia()` from `file://` frames the spec as
  *currently permitting* it
  ([public-webrtc archive](https://lists.w3.org/Archives/Public/public-webrtc/2025May/0002.html)) —
  corroboration that the path is real, and a warning that it is under scrutiny.

  **Verified empirically** (Chrome for Testing 151.0.7922.34, Linux, page loaded from a
  `file:///…/probe.html`):

  ```json
  { "isSecureContext": true, "origin": "file://",
    "hasMediaDevices": true, "hasGUM": true,
    "hasShowOpenFilePicker": true, "hasShowSaveFilePicker": true,
    "hasStorageGetDirectory": true, "hasWakeLock": true,
    "hasRVFC": true, "hasBarcodeDetector": false }
  ```

  So on Chromium the camera path, the file pickers, OPFS, wake lock and
  `requestVideoFrameCallback` all survive the `file://` transition. **Re-run this probe on Safari
  and Firefox before promising the single-file build works there.**

**What breaks:**

- **Service workers cannot be registered from `file://`** — **verified empirically**, same run:
  `navigator.serviceWorker.register('./sw.js')` rejects with
  `TypeError: Failed to register a ServiceWorker: The URL protocol of the current origin ('null')
  is not supported.` Not a real loss (a single file has nothing to precache) but it does mean
  *no Web Share Target* and no offline-readiness indicator in this build.
- The `file://` origin is **opaque (`'null'`)**. Beyond service workers, that means no
  `localStorage`, no IndexedDB in some configurations, and OPFS behaviour that should not be
  relied on. **The single-file build must keep all state in memory** and must not assume any
  persistence between page loads.
**Empirically measured behaviour of a `file://` page** (Chrome for Testing 151, Linux). I tested
these rather than trusting folklore, and several common claims turned out to be wrong:

| Capability from `file://` | Result |
|---|---|
| Inline `<script>` (classic) | ✅ runs |
| **Inline `<script type="module">`** | ✅ **runs** (the "modules are blocked on file://" claim applies to *external* module files, not inline ones) |
| `localStorage` | ✅ works |
| `IndexedDB` | ✅ works |
| **OPFS** (`navigator.storage.getDirectory()`) | ❌ **`SecurityError`** |
| **Classic blob-URL `Worker`** | ✅ **works** (`new Worker(URL.createObjectURL(new Blob([src],{type:'text/javascript'})))`) |
| **`{type:'module'}` blob-URL Worker** | ❌ **fails** |
| Dynamic `import()` of a blob URL | ✅ works |
| `fetch('./sibling.wasm')` | ❌ `TypeError: Failed to fetch` — *"URL scheme \"file\" is not supported"* |
| `fetch('data:application/wasm;base64,…')` | ✅ works |
| `WebAssembly.instantiate(bytes)` from inlined bytes | ✅ works |

So, concretely:

- **Workers are fine** — but they must be **classic** blob-URL workers, not module workers.
  Bundle the worker to one self-contained classic-script string.
- **WASM is fine** — just not via `instantiateStreaming(fetch('x.wasm'))`, which cannot read a
  sibling file. Two working routes, both verified: base64-embed the module and either
  `WebAssembly.instantiate(bytes)` directly, or `instantiateStreaming(fetch(dataUrl))`. Cost is
  ~33% size inflation from base64. `vite-plugin-wasm` exists, though Vite's docs note the *ES
  Module Integration Proposal for WebAssembly is not supported* natively
  ([vite-plugin-wasm](https://www.npmjs.com/package/vite-plugin-wasm)).
  Given ~1 MB of zxing-wasm base64-inflated to ~1.4 MB, this is acceptable for a one-time
  download — but **a pure-JS decoder is still the safer single-file choice** if size or
  compatibility matters more than decode headroom.
- **OPFS is unavailable**, so the single-file build cannot use the staging-buffer architecture
  from §2.4. It must hold the received file in memory and save via `<a download>`. Another reason
  to cap the single-file build's max payload lower than the hosted PWA's.
- **`navigator.share`/`canShare`** are absent on desktop Linux Chromium entirely (verified), so
  `<a download>` must be the single-file build's save path regardless.
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
4. **⚠️ On OLED senders, a mostly-white page actively works against you.** The Automatic Brightness
   Limiter scales peak luminance down as average picture level rises:
   [TFTCentral](https://tftcentral.co.uk/articles/oled-dimming-confusion-apl-abl-asbl-tpc-and-gsr-explained)
   measures an LG 42C2 at **717 nits at 1% APL falling to 152 nits at 100% APL**, and notes
   *"there is no way to disable ABL."* So the "flood the screen with white" instinct can cost you
   **~4× peak brightness** on an OLED phone. A QR is ~50% dark by area, which is roughly the worst
   case for this tradeoff. **Keep the white surround to the required quiet zone plus a small
   margin — do not add a large white border on OLED.** (This is an inference from panel-level ABL
   measurements; I found no direct measurement of ABL against animated QR. Worth measuring.)
   Related: [DXOMARK](https://www.dxomark.com/flicker-the-display-affliction/) measures OLED PWM
   dimming at ~50–500 Hz (Galaxy S20 Ultra 241 Hz, OnePlus 8 Pro 481 Hz) versus ≥1000 Hz for LCD,
   with duty cycles as low as 10% at minimum brightness — **a dim OLED sender is doubly bad**,
   because PWM flicker widens the effective tearing window discussed in §4.5.

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

  **⚠️ The obvious mitigation — "just run the decoder against both polarities" — costs about half
  your throughput, so do not enable it by default.** [jsQR's README](https://github.com/cozmo/jsQR)
  states `inversionAttempts` *"defaults to `attemptBoth` for backwards compatibility but **causes a
  ~50% performance hit**"*; [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp/blob/master/core/src/ReaderOptions.h)
  likewise defaults `tryInvert`, `tryHarder`, `tryRotate`, `tryDownscale` all to true, and all are
  costly. qr-stream already exploits this asymmetry: `'attemptBoth'` only for camera input,
  `'dontInvert'` when it controls the source, for a *"~50% speedup"*.

  Field evidence that inverted codes genuinely fail, from Foundation's own forum: *"unable to scan
  in dark mode, but it worked instantly in light mode"*
  ([community.foundation.xyz](https://community.foundation.xyz/t/qr-code-scanning-issues/1001)).

  **Correct policy: render dark-on-light, always; decode with `inversionAttempts: 'dontInvert'`
  and `tryInvert`/`tryRotate` disabled** — that is free throughput. Then handle the OS-inversion
  case as an *escape hatch*, not a default: detect a sustained stretch of zero decodes and offer a
  "colours look wrong?" toggle that flips the sender's rendering and/or enables dual-polarity
  decoding on the receiver, accepting the throughput cost only when it is actually needed.
  (ISO/IEC 18004 does permit *"reflectance reversal (light symbols on dark backgrounds)"*, so
  inverted codes are legal — just slower and less reliable in practice.)
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

**The frame-rate ceiling has a name and a number: `display_fps ≤ camera_capture_fps / 2`.**
LightSync (MobiCom 2013) derived it from the rolling-shutter mixing problem — a camera runs at
*"15–30 fps in practice, variable"*, received frames are a mixture of *"Single frame / 2-frame mix
/ 3-frame mix / 4-frame mixes"*, and for a conventional whole-frame-or-nothing system throughput
*"peaks at ~half the camera rate, drops to 0 at higher display rates"*; of display rates 2C, C and
C/2, *"**C/2 — The only decodable**"*
([authors' slides](https://slidetodoc.com/light-sync-unsynchronized-visual-communication-over-screencamera-links/);
⚠️ the [ACM paper](https://dl.acm.org/doi/abs/10.1145/2500423.2500437) is paywalled — verify before
relying on the exact wording). So a 30 fps camera caps you at **15 fps display**. This independently
explains divan's measured 6–7 fps optimum and decimen's "≥2 refresh cycles per frame" rule, and it
matches my own tearing measurement in the box above.

**Corollary — never set the receiver's sample period equal to the sender's display period.**
Sparrow ships `QR_SAMPLE_PERIOD_MILLIS = 200` against a 200 ms display period: two unsynchronised
5 Hz clocks, which guarantees a beat frequency and periodic misses. Sample as fast as the camera
delivers (`requestVideoFrameCallback`) and let the fountain absorb the duplicates.

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

#### Measured: what a torn frame actually costs

I simulated rolling-shutter tearing directly — composite the top *f* % of QR frame A with the
bottom (100−*f*) % of frame B, as happens when the sender flips mid-camera-scan — and decoded the
result (two v20 codes, 4 px/module, jsQR):

| tear position | decodes as |
|---|---|
| 0% / 10% | FRAME-B |
| **25%** | **no decode** |
| **50%** | **no decode** |
| **75%** | **no decode** |
| 90% / 100% | FRAME-A |

Two conclusions:

1. **A torn frame is lost, not corrupted.** Across the whole middle band the decode simply fails —
   QR's format/ECC checks reject the hybrid rather than emitting wrong bytes. That is the safe
   failure mode, and it means tearing costs throughput but never integrity. (Still checksum each
   frame's payload: this is a guarantee about *QR*, not about a hostile sender.)
2. **Tearing is expensive.** Only a tear within ~10% of the top or bottom edge leaves a decodable
   code; roughly **80% of tear positions destroy the frame.**

This suggests an explanation for the ~20% frame loss that divan measured and that every project
since has budgeted for: the loss is plausibly dominated by **rolling-shutter tearing, not decode
difficulty**. If the camera's sensor readout takes `T_read` and each QR is displayed for
`T_frame`, the fraction of captures that straddle a flip is roughly `T_read / T_frame`. With a
typical 10–30 ms readout: at 10 fps (100 ms/frame) that's **10–30% torn**, at 30 fps (33 ms/frame)
it approaches **30–90% torn**. That is very likely the real reason high display rates stop paying
off — and it is a *geometric* effect, not a decoder-speed one, so a faster decoder cannot rescue it.

Practical consequences:

- **Displaying each frame for longer is worth more than it looks**, because tear loss falls
  roughly linearly with frame duration. This argues for the conservative end of the fps range
  unless you are measuring otherwise.
- **No transitions, no cross-fades, no CSS animation on the QR element.** Draw each new frame in
  one synchronous `drawImage`/`putImageData` inside the rAF callback — a dissolve turns *every*
  captured frame into a torn one.
- A short blank/marker frame between data frames would eliminate half-and-half captures at a
  direct throughput cost. Given the above, this is worth *measuring* on real hardware rather than
  assuming either way.
- **Make this a test case** (§7.9, Tier 2): tearing is easy to simulate and easy to forget.

---

## 5. UX patterns for animated-QR transfer

Findings below come from reading shipped source and spec text, not READMEs, wherever a file is
cited.

**Terminology correction:** BC-UR's fountain mode is **rateless**, not "rate-limited" —
`grep` over the whole [BlockchainCommons/Research](https://github.com/BlockchainCommons/Research)
repo returns zero hits for "rate limited". Separately, `crypto-request`
([bcr-2021-001](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2021-001-request.md))
is a UR *payload type* for asking a device for data — not an encoding mode, and unrelated to
fountain codes.

### 5.1 Five findings that should shape qrbeam's UX

1. **The entire hardware-wallet ecosystem runs animated QR at 3–5 fps** — Keystone 3 at 200 ms,
   Sparrow at 200 ms, the BBQr spec recommending 250 ms, Envoy at 3 fps. Browser projects doing
   the same physics run 24–30 fps. Wallets are 30–60× slower than the channel allows because they
   optimise for a 240 px embedded screen and guaranteed reliability. **Do not anchor on wallet
   frame rates.**
2. **The "stuck at 99%" bug is in the reference implementation**, and every wallet that shows a
   percentage inherits it (§5.5).
3. **There are two distinct progress bugs with opposite shapes** — a clamped fudge factor, and a
   back-loaded solve cascade. Both are fixed by the same rule: count **frames collected**, not
   blocks solved.
4. **Senders show nothing.** Sparrow, Keystone and Passport display a bare looping QR with no
   progress, no frame counter, no loop count. Confirmed by reading the source. "Loop 3 of ∞" does
   not exist anywhere.
5. **The chunk-index grid is shipped** in Coldcard Q's firmware and in qifi/qrs, and Blockchain
   Commons' URDemo has the best fountain-aware variant.

### 5.2 What the sender actually shows (parameters read from source)

| Implementation | Frame interval | Fragment size | QR / ECC |
|---|---|---|---|
| **Keystone 3** | `TIMER_UPDATE_INTERVAL 200` → **5 fps** | `FRAGMENT_MAX_LENGTH_DEFAULT = 200` B | 294 px / 420 px fullscreen on 480×800 ([gui_animating_qrcode.h](https://github.com/KeystoneHQ/keystone3-firmware/blob/master/src/ui/gui_components/gui_animating_qrcode.h)) |
| **Sparrow** | `ANIMATION_PERIOD_MILLIS = 200d` → **5 fps** | UR 400 (Normal) / 80 (Low); BBQr 2000 / 1000 | ZXing default L, `MARGIN=2` ([QRDisplayDialog.java](https://github.com/sparrowwallet/sparrow/blob/master/src/main/java/com/sparrowwallet/sparrow/control/QRDisplayDialog.java)) |
| **BBQr spec (Coinkite)** | *"250ms frame rate is recommended"* → **4 fps** | v27 = 1062 B, v40 = 2144 B | *"we recommend always using level 'L'… we are not printing these codes, and only showing them on a perfect LCD screen"* ([bbqr.org](https://bbqr.org/BBQr.html)) |
| **Foundation Envoy** | `refreshRate = 3` / `5` | `maxFragmentLength = 100` | — |
| **SeedSigner** | camera `framerate: 6`, 480×480 | UR density Low/Med/High = **10 / 30 / 120** B | — |
| **URKit / URUI (BC reference)** | `defaultInterval = 1.0/10` → **10 fps**, user-adjustable 1–20 | 100–700 B in demos | — |

I read Sparrow's `QRDisplayDialog` construction directly: an `ImageView` in a bordered `StackPane`
plus buttons (`Close`, `Scan QR`, `Change Density`, `Use Legacy Encoding`, `Show BBQr`). **No frame
counter, no progress, no loop count.** Keystone 3 simply `lv_qrcode_update()`s on a 200 ms timer.

What senders *do* offer instead of progress is **live tuning**:

- **Sparrow: scroll wheel over the QR changes speed** — `deltaY > 0` → `duration × 1.1`, else
  `× 0.9`, clamped 100–2000 ms (2.5–10 fps). Live, and completely undiscoverable.
- **Passport: d-pad** — up/down = screen brightness, left/right = QR density
  ([docs.foundation.xyz](https://docs.foundation.xyz/troubleshooting/passport/)).
- **Keystone: a size slider** — *"Please readjust the QR code size with the slide bar below the QR
  code if you are experiencing any difficulties scanning"* plus a tappable "Difficulty scanning?"
  link, and tap-for-fullscreen.
- **URDemo: explicit faster/slower buttons**, `min(fps+1, 20)` / `max(fps-1, 1.0)`.

The one sender anywhere that shows `i/N` is
[airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer)
(*"Transfering Chunk {i}/{total_chunks}"*) — and it can only do that because it is a plain
sequential loop with **no fountain**.

### 5.3 What the receiver shows — five patterns, in increasing order of quality

**(1) Bare percentage — Foundation Passport.**
[scan_qr_page.py](https://github.com/Foundation-Devices/passport2/blob/main/ports/stm32/boards/Passport/modules/pages/scan_qr_page.py):
`label = 'Scanning...' if p == 0 else '{}%'.format(p)`. Docs frame the intended reading: *"As long
as you see the % progress slowly increasing… this means Passport is scanning and processing."*

**(2) Bare percentage — MetaMask Mobile.** `"Scanning… NN%"` over a viewfinder frame, via
`Math.ceil(urDecoder.getProgress() * 100)`.

**(3) Bare fill bar, no number — Sparrow.** `ProgressBar` bound to `percentComplete`. The
user-facing instruction lives in Blockstream's docs: *"The progress bar will fill up as you
successfully scan new frames… **If the progress bar is not updating, change Jade's angle or
distance** from the QR until you find the optimal placement"*
([help.blockstream.com](https://help.blockstream.com/hc/en-us/articles/11855365467033-Use-Jade-QR-Scan-with-Sparrow)).

**(4) ★ Per-part index grid — Coldcard Q.** From
[`lcd_display.py draw_bbqr_progress()`](https://github.com/Coldcard/firmware/blob/master/shared/lcd_display.py):

```python
for i in range(hdr.num_parts):
    if i in got_parts:               pat.append(str(i+1))    # got it
    elif corrupt and i == hdr.which: pat.append('X'*wl)      # seen but corrupt
    else:                            pat.append('-'*wl)      # not yet received
self.text(None, -2, 'Keep scanning more...' if count < hdr.num_parts else 'Got all parts!')
self.text(None, -1, '%s: %d of %d parts' % (hdr.file_label(), count, hdr.num_parts), dark=True)
self.progress_bar(count / hdr.num_parts)
```

The screen literally reads `1  2  -  4  X  6` above *"Keep scanning more…"* above *"PSBT: 4 of 6
parts"* above a fill bar. Three states per chunk (**got / missing / corrupt**). Honest exact counts
are possible only because BBQr is **fixed-rate**.

**(5) ★ Fountain-aware fragment bar — Blockchain Commons URDemo.** The best design for a rateless
stream, and directly applicable to qrbeam. Three states (`.off`, `.on`, `.highlighted`) in
[URFragmentBar.swift](https://github.com/BlockchainCommons/URUI/blob/master/Sources/URUI/URFragmentBar.swift):

```swift
// receiver — URScanState.swift
if urDecoder.receivedFragmentIndexes.contains(i) { return .highlighted }
else { return urDecoder.lastFragmentIndexes.contains(i) ? .on : .off }

// sender — URDisplayState.swift: the SAME bar shows which fragments are XOR'd into the current frame
fragmentStates = (0 ..< seqLen).map { encoder.lastFragmentIndexes.contains($0) ? .on : .off }
```

The [URDemo README](https://github.com/BlockchainCommons/URDemo) describes the effect:

> **Sending screen.** A LifeHash displays a hash of the message being sent for easy recognition on
> the receiving side. **The blue bar beneath the animated QR code shows the segments mixed into the
> currently displayed part.**
>
> **Receiving screen.** … **The blue bar beneath the viewfinder lights up in white to signify the
> complete parts received so far, and also shows in light blue the fragments mixed in to the last
> received part.**
>
> **Proper distance and framing.** … **you should try to make the sending QR code fill as much of
> the viewfinder as possible.**

It also shows a **LifeHash on both devices** that the user compares by eye — a zero-bandwidth
integrity check across an air gap, and a genuinely clever pattern.

**(6) ★ Per-frame green/grey dot — SeedSigner.** From
[scan_screens.py](https://github.com/SeedSigner/seedsigner/blob/dev/src/seedsigner/gui/screens/scan_screens.py):
`FRAME__ADDED_PART` → green, `FRAME__REPEATED_PART` → grey, `FRAME__MISS` → no dot. A 10 px dot
drawn per captured frame. **This is the single best *aiming* primitive found** — it responds
instantly, unlike a percentage, so the user can hunt for the right distance in real time.

### 5.4 Why ratelessness changes the UX (spec text)

The definitive no-back-channel statement,
[bcr-2020-005-ur.md](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md):

> But this approach has a serious drawback: **as the sender does not know which parts the receiver
> has successfully read and which it still needs**, if any of the codes in the series is missed by
> the receiver, the entire sequence will need to be repeated.

And [bcr-2024-001-multipart-ur.md](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2024-001-multipart-ur.md)
on stalling:

> **When a code is missed, the receiver must wait for the entire sequence to cycle through before
> getting another chance…** In a rateless system, each code is somewhat independent… **any
> sufficiently large set of codes can be used to reconstruct the entire message**… **This property
> significantly reduces the likelihood of stalling.**
>
> *Fountain codes* are … named by analogy to a water fountain: the flow is continuous and
> effectively never-ending, but you only need to take a relatively tiny amount to get a drink.

UX consequences:

- **The receiver joins mid-stream.** No handshake, no "press start together."
- **No retransmit request is needed.** ~K·(1+ε) distinct frames in any order. Observed ε in the
  wild: **1.15** and **1.18** (decimen), **1.75** (BC-UR's fudge factor — not a real ε), **20%**
  (RaptorQR repair rate, and txqr's assumed loss).
- **Sender and receiver frame rates need not match** — no negotiation, no clock sync.
- **You lose "N".** You cannot honestly say "frame 3 of 17" because there is no 17. Every fountain
  sender substitutes *stream parameters* for progress.

Two structural details worth stealing: MUR is a **hybrid** — parts `1..seqLen` are fixed-rate plain
fragments, `seqLen+1..∞` are rateless XOR mixes, so a clean channel gets the optimal fast path
*and* a lossy one degrades gracefully. And MUR does **not** use a robust soliton distribution; its
`DegreeChooser` uses a **harmonic series** `(1/1, 1/2, … 1/seqLen)` because *"it biases the
selection towards lower degrees, which is crucial because degree-1 parts are essential in decoding
higher-degree mixed parts."*

AirGap's changelog has the clearest consumer-facing statement of the benefit
([v3.8.0](https://support.airgap.it/CHANGELOG-VAULT/)): *"if a single QR code is missed during
scanning, it can be recovered by scanning a couple additional QRs, instead of waiting for the
missed QR to appear again."*

### 5.5 The two progress bugs — with source

**Bug 1: BC-UR's hard-coded 99% ceiling.** From
[ngraveio/bc-ur `FountainDecoder.ts`](https://github.com/ngraveio/bc-ur/blob/main/src/classes/FountainDecoder.ts):

```ts
// We multiply the expectedPartCount by `1.75` as a way to compensate for the fact
// that `this.processedPartsCount` also tracks the duplicate parts that have been processed.
return Math.min(0.99, this.processedPartsCount / (expectedPartCount * 1.75));
```

It **cannot** reach 100% until `done` flips — the root of SeedSigner's *"stuck-at-99%-progress
misery"*. Note there are two functions with different semantics: `estimatedPercentComplete()`
(above) and `getProgress()` = `simpleBlocks.length / expectedPartCount`, which counts only degree-1
parts and undershoots badly. MetaMask uses the latter, Sparrow the former.

SeedSigner's fix ([fountain_decoder.py](https://github.com/SeedSigner/seedsigner/blob/dev/src/seedsigner/helpers/ur2/fountain_decoder.py))
gives partial credit for indices inside mixed frames, weighted by mix degree — with a warning
worth heeding:

```python
mixed_score += min(score, 0.75)   # don't let an index in a mixed/XOR frame achieve equal
                                  # weight as a fully decoded frame. Also if the ceiling is
                                  # too high, can potentially see your reported progress
                                  # percentage DECREASE during a decode.
```

**A naive partial-credit scheme can make the bar go backwards.**

**Bug 2: LT's back-loaded solve.** decimen: *"LT peeling back-loads its solve cascade, so
blocks-solved looks stalled and then teleports to done."* Its fix is
`min(0.99, framesNew / (k * 1.18))`. qrs independently applies a `* 0.66` damping factor. Both
converge on: **count frames in, not blocks out.**

**What these bugs cost in the field.** Casa's 2024 hardware-signing report
([blog.casa.io](https://blog.casa.io/bitcoin-multisig-hardware-signing-performance-2024/)):

> *"Scanning large PSBTs with SeedSigner was **excruciating**. For a 100 input 2-of-3 PSBT it would
> **get to 99% after 8 minutes and then hang**, likely because it had missed a few frames. **It took
> a total of 14 minutes**… And on the extreme end, **it took me 48 minutes to scan the 100 input
> 3-of-5 PSBT data**."*

That is a fixed-rate stall compounded by a dishonest progress bar — both avoidable, and a precise
description of the failure qrbeam must not reproduce. SeedSigner's v0.8.0 fix was shipped as
*"Much better animated QR scanning progress estimation calcs: **no more stuck-at-99%-progress
misery!**"*

### 5.6 Closing the loop — does anyone use a reverse channel?

Yes, three distinct designs, and the answer for qrbeam is "probably not, but know why".

**(1) Sequential handoff (ubiquitous, but not feedback).** Every PSBT round trip is bidirectional
in that each device shows QRs to the other, but each leg is an independent one-shot transfer with
no ACK inside it. **This does not help** — it is two one-way transfers, not flow control.

**(2) ★ True per-chunk ACK duplex — [LucaIaco/QRFileTransfer](https://github.com/LucaIaco/QRFileTransfer).**
Both devices run a camera *and* a display simultaneously:

> The first QR image displayed by the Sender is providing the meta info… **The Receiver replies
> displaying a QR image to notify the Sender to start**… **For each QR Image recognized by the
> Receiver's camera… it will "reply" to the Sender by displaying another QR image with the hash
> (SHA-256) of the decoded file chunk.** The Sender will detect the hash… and proceed with the next
> chunk. If not, it will display a new QR image… carrying over again the pending chunk.

This is textbook **stop-and-wait ARQ over light** — the slowest possible design, since every chunk
costs a full round trip through two camera pipelines. Its preconditions require both devices fixed
and facing each other. **This is why fountain coding won.**

**(3) ★ Selective-repeat via visual ACK — Ping Identity patents.**
[US10509932B2](https://patents.google.com/patent/US10509932B2/en) (filed 2017-10-14; continued as
US11062106, US11544487), *"Large data transfer using visual codes with feedback confirmation"*.
The receiver displays a feedback code whose payload is a **bitmap of received blocks** — *"Each bit
in the second portion corresponds to a different display block… in the group"* — and the sender
*"may remove those visual codes from the series"* and terminate automatically. This is exactly the
"I have 1–40, resend 12 and 31" mechanism. ⚠️ **It is patented** — a real consideration before
building it.

**(4)** [tony-xlh/QRTransfer](https://github.com/tony-xlh/QRTransfer) does ACK-and-skip too, but
requires a licensed Dynamsoft SDK.

**What senders show: nothing, and no loop counter exists anywhere.** A targeted search found zero
instances of "loop 3 of ∞", elapsed-loop counts, or ETA on any sender. The state of the art is
wallets showing a bare loop plus tuning controls; decimen showing a static spec line plus the
honest sentence *"The stream loops forever — stop when the receiver says done"*; and URDemo's
fragment bar, which conveys *composition*, not progress. **This is a genuine gap, not an oversight
to copy** — the sender fundamentally cannot know, and the honest designs say so out loud.

### 5.7 "Hold steady for four minutes" — the ergonomics literature

Every instruction I could find, verbatim:

| Source | Instruction |
|---|---|
| [Passport troubleshooting](https://docs.foundation.xyz/troubleshooting/passport/) | *"Slowly adjust the distance…"* · *"Adjust the brightness of the screen being scanned"* · *"Ensure there is no glare from direct sunlight"* · *"try dimming your laptop screen, as excessive brightness can create glare"* |
| [Jade + Sparrow](https://help.blockstream.com/hc/en-us/articles/11855365467033-Use-Jade-QR-Scan-with-Sparrow) | *"If the progress bar is not updating, change Jade's angle or distance…"* |
| [URDemo](https://github.com/BlockchainCommons/URDemo) | *"make the sending QR code fill as much of the viewfinder as possible"* |
| [libcimbar](https://github.com/sz3/libcimbar/blob/master/PERFORMANCE.md) | *"take up as much of the display as possible (**trust the guide brackets**)"* · *"keep the camera angle straight-on"* · *"screen brightness on the sender is good, but **ambient light is better**"* |
| [decimen](https://github.com/bashalarmistalt/decimen-optical-transfer) | *"**Hold the phone steady, or better, prop it against something. Camera autofocus hunting from hand tremor is the #1 throughput killer.**"* |
| [Keystone](https://support.keyst.one/getting-started/setting-up-keystone-new) | *"If a transaction is large, the number of QR codes shown will increase. Please keep scanning until the whole process is finished."* |

**Nobody ships the words "hold steady" prominently.** decimen is the only project that names
autofocus hunting as the dominant failure mode, and only in a README. **This is a real gap qrbeam
can fill.**

**Quantified: propping the device is worth ~40–45%.**
[ChromaCode (MobiCom '18)](https://www.cs.purdue.edu/homes/chunyi/pubs/mobicom18-zhang.pdf)
measured fixed camera at 777 kbps raw / **120 kbps goodput** versus hand-held at 627 kbps raw /
**70 kbps goodput** — a ~40% goodput loss purely from holding the device. decimen's self-reported
numbers agree (~128 KB/s handheld → ~186 KB/s propped, +45%). Combined with §6.2's finding that
blur costs a factor of two in density, **"prop it against something" is the single
highest-leverage sentence in the app.**

**Refresh straddling** (the temporal, not spatial, failure — see §4.5 for my measurements):
libcimbar ships a **`shakycam`** option *"to allow the receiver to detect/discard 'in between'
frames as part of the scan step,"* and decimen mitigates with **"each frame must own at least 2
refresh cycles of the display"** (hence 24 fps on a 60 Hz panel, 2.5 cycles of margin).

**Density ceilings observed in the field — v40 is a trap:**
- BBQr spec: *"Avoid very high versions (too dense). Better to have a more lower-rez QR codes."*
- [qr-backup issue #26](https://github.com/za3k/qr-backup/issues/26): v25+ECC H reliable on a 2018
  Android; **v40 unusable when printed.**
- decimen: v27 is *"a safe middle ground"*; v40 *"works phone-to-phone at close range"* only.

**Coldcard Q's auto-sizing policy is the best-engineered version of this heuristic**
([bbqr.py](https://github.com/Coldcard/firmware/blob/master/shared/bbqr.py)) — note the explicit
integer-pixel reasoning, which corroborates my §6.2 measurement:

```python
CHARS_PER_VERSION = [
    (15, 758),    # 77px x 3: 77*3 = 231px tall
    (25, 1853),   # 117px, doubled: 234px tall
    (40, 4296),   # 177px tall, shown 1:1 pixels -- phones can scan fine
]
# pick the least-dense version that yields <= 12 frames; v40 only for huge payloads
```

That is: **pick the lowest QR version whose part count stays under a threshold, rendered at an
integer pixel multiple.** Also from BBQr, a small real UX note: *"It is visually jarring to have
the final QR be a different version (resolution) than the other ones"* — **pad the last fragment.**

**Autofocus and minimum focus distance — worse than intuition suggests.** Phone main-camera MFD
*regressed* as sensors grew: *"iPhone 14 Pro is approximately 8", compared to ~6" on the 13 Pro and
~4.5" on the 12 Pro"* ([MacRumors](https://forums.macrumors.com/threads/autofocus-issues.2362288/)),
and Apple Support states *"it may not focus closer than **12 inches**"*
([discussions.apple.com](https://discussions.apple.com/thread/255576130)). A flat, uniformly-lit
screen is also the pathological autofocus case — *"a dim, flat, or low-detail subject gives the
camera too little information and **it keeps searching**"*
([witchflow.com](https://witchflow.com/webcam-autofocus-keeps-hunting/)) — and a QR whose entire
content changes 10× per second is a continuously moving contrast target.

**You cannot fix this from the browser.** `focusMode`/`focusDistance` are Chrome-Android-only;
*"iOS Safari does not expose focus constraints"*
([Dynamsoft](https://www.dynamsoft.com/codepool/camera-focus-control-on-web.html)), and MDN's
[`MediaTrackSettings`](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings)
standardises none of them. **Design consequence: render the QR large so the user can stand back
past the MFD, rather than expecting them to move closer.** Rule of thumb ~10:1 distance-to-code-size
with a hard floor around 20 cm.

**Hand tremor sets the stability floor.** Physiological tremor is **8–12 Hz**
([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2467981X1930023X),
[Nature Sci Rep](https://www.nature.com/articles/s41598-022-21310-4)) — *faster* than a 10 fps
animation, and its amplitude grows with fatigue, so **a long transfer gets harder as it runs.**
That is the physical justification for both "prop the phone" and "warn above ~60 s".

**A quantitative basis for a "move closer" prompt.** Google ML Kit specifies *"The smallest
meaningful unit of the barcode should be **at least 2 pixels wide**"*
([ML Kit docs](https://developers.google.com/ml-kit/vision/barcode-scanning/android)) — which
independently corroborates my measured 2 px/module floor at zero blur (§6.2). Derived: a v20 code
is 97 modules + 2×4 quiet = 105 across, so ≥210 px in the captured image, i.e. **≥29% of frame
height at 720p** at the absolute floor, or **44–58%** at the 3–4 px/module you actually want.

**Paper-backup projects** (qr-backup, paperback, PaperBack, Optar) are worth one lesson each:
qr-backup's restore UX is a **missing-index list** rather than a percentage
(`"Missing {count}/{total} codes: {list}"`, and `"Read duplicate code: IDENTICAL"` / `"DIVERGES"`);
and PaperBack's rule that *"optimal resolution is about 3 times the dot density"* is the same 3×
oversampling requirement my §6.2 measurement found independently.

### 5.8 Live guidance — the platforms do it, the QR tools don't

The "tell the user what to fix" pattern **is** shipped, just not by animated-QR projects:

- **Apple ships literal "Slow Down".**
  [`DataScannerViewController.isGuidanceEnabled`](https://developer.apple.com/documentation/visionkit/datascannerviewcontroller/isguidanceenabled):
  *"**The guidance text, such as 'Slow Down,' appears over the live video.**"*
- **Google ML Kit ships auto-zoom** — *"when all barcodes within the view are too distant for
  decoding,"* it tells the app to *"adjust the camera's zoom ratio to the recommended setting."*
- **txqr designed the human-in-the-loop version** and it is exactly right for a no-back-channel
  system: the receiver *"can display a message '**please decrease FPS on sender**', and continue
  receiving the same file, even if the frame size had changed."* The message goes to the *human*,
  who is the back-channel.
- **Casa explicitly asked for a framing reticle** and nobody ships one: *"you don't have a great
  idea what the actual boundaries are of what the camera is seeing… a potential simple UX
  improvement here would be to have the laser project either an outline of a box or a cross."*

**⚠️ No animated-QR tool auto-adapts sender fps from decode success.** Every one surveyed (txqr,
RaptorQR, Sparrow, BlueWallet, Specter-DIY, Coldcard, qrs) exposes manual controls only. Combined
with `requestVideoFrameCallback`'s `presentedFrames` (which
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
notes *"can be used to detect whether frames were missed"*), qrbeam can measure the true capture
rate and **tell the user what fps to set on the sender**. That is unbuilt territory and cheap.

### 5.9 An unaddressed risk: photosensitivity

A full-screen animated QR at ≥4 fps is a >3-flashes-per-second, full-screen, high-contrast
stimulus. [WCAG 2.2 SC 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html)
sets the threshold at three flashes per second over >25% of any 10° visual field, with an exemption
for *"a fine, balanced, pattern such as… an alternating checkerboard pattern with 'squares' smaller
than 0.1 degree."* A QR is ~50% dark modules, so average luminance barely changes frame to frame
and it **probably** clears the threshold — but **I found zero literature applying WCAG to animated
QR.** Run PEAT against real recorded output, and ship a pause/step control regardless. Cheap
insurance on a genuinely unexamined risk.

### 5.10 Gaps — where the prior art has nothing to copy

- **No animated-QR tool gives live "too far / too close / too fast" feedback**, despite Apple and
  Google both shipping the primitive at the platform level (§5.8). libcimbar's static guide
  brackets and SeedSigner's green/grey dot are the closest. **This is qrbeam's clearest opportunity
  to beat the state of the art.**
- **No vendor recommends a phone stand or tripod** for animated QR — zero results — despite
  propping being worth ~40–45% (§5.7).
- **No published endurance-time figure** for holding a phone at a screen. The
  [Consumed Endurance](https://dl.acm.org/doi/10.1145/2556288.2557130) framework exists; nobody has
  reported the value for this pose.
- **No study of animated QR and photosensitive epilepsy** (§5.9).
- **No measurement of LTPO/VRR panels interfering with animated QR.** ⚠️ Worth flagging as a risk:
  variable-refresh panels drop to 1–10 Hz on static content, and a 10 fps `requestAnimationFrame`
  loop on a panel that has decided to run at 10 Hz has zero timing margin.
- **No vendor distance figure in cm/inches** for animated QR — only "slowly adjust the distance."
- **No published rolling-shutter readout times (ms)** for specific phone cameras in citable form.
- **No sender anywhere displays a loop counter, elapsed loops, or an ETA.**
- AirGap Vault's frame rate, fragment size and receiver UI: not found.
- Coldcard Q's display frame interval: not found (the sizing policy is in `bbqr.py`; the BBQr
  spec's 250 ms is suggestive but not the source constant).
- "Strata" screen-camera communication **appears not to exist** — absent from ChromaCode's
  related-work survey, which covers COBRA, LightSync, RDCode, ARTcode, PixNet, InFrame/InFrame++,
  HiLight, TextureCode, ImplicitCode and Uber-in-Light. Likely a misremembered name.
- `qrcp`, `qr-filetransfer`, `qrTransfer` and qrtransfer.io are **WiFi/HTTP transfers where the QR
  only carries a URL** — not optical, and relevant only as name collisions.

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

#### Measured: the decode threshold depends on blur, *not* on QR version

The literature gap above ("no published measurement") is small enough to close directly, so I ran
it. Method: render each QR at an exact integer pixels-per-module with a 4-module quiet zone,
apply a box blur of radius *r* px to simulate optical softness / motion blur, decode with jsQR.
Byte-mode payloads at EC level L, so the versions are the real ones.

| blur radius | 2 px/module | 3 px/module | 4 px/module | 5 px/module | 6 px/module |
|---|---|---|---|---|---|
| 0 px (perfect) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1 px | ❌ | ✅ | ✅ | ✅ | ✅ |
| 2 px | ❌ | ❌ | ❌ | ✅ | ✅ |
| 3 px | ❌ | ❌ | ❌ | ❌ | ✅ |

**Every QR version behaved identically** — v10 (57 modules), v15 (77), v20 (97), v27 (125),
v33 (149) and v40 (177) all flipped from fail to pass at exactly the same px-per-module threshold
for a given blur. That is the headline result, and it is a useful one:

> **QR version does not make a code intrinsically harder to decode. Only pixels-per-module and
> optical sharpness matter.** So you should push density as high as your pixel budget allows —
> a v40 code at 3 px/module is exactly as decodable as a v10 code at 3 px/module, and carries
> 11× the payload.

This both **confirms the 3 px/module rule of thumb** (it is exactly right for mildly soft capture)
and shows how fast it degrades: **5–6 px/module once real motion blur is present.** Practical
translation for a 1080p receiver:

| QR fills … of frame height | sharp (3 px/mod) | handheld blur (5 px/mod) |
|---|---|---|
| 50% (540 px) | 180 modules → **v40** | 108 modules → ~v25 |
| 33% (360 px) | 120 modules → ~v28 | 72 modules → ~v14 |
| 25% (270 px) | 90 modules → ~v19 | 54 modules → ~v9 |

**Implication for qrbeam: QR version must be a runtime-adaptive parameter, and the thing to adapt
on is measured decode success, not distance.** Start at v20–v27 and climb while the receiver is
succeeding. Never hard-code v40. And since blur costs roughly a factor of two in density, the
"prop your phone against something" instruction is worth ~4× in throughput — it is the single
highest-leverage piece of user guidance in the whole app.

**Secondary finding — prefer integer pixels-per-module.** Sweeping fractional scales at v20 with
no blur, most ratios decoded fine but **3.5 px/module failed** where 3.25 and 3.75 succeeded.
Fractional module scaling aliases unevenly (some modules get *n* pixels, neighbours get *n+1*),
and certain ratios land badly. Cheap fix: size the QR canvas to an exact integer multiple of
(modules + 2×quiet-zone) and let CSS letterbox the remainder, rather than stretching the canvas
to fill the viewport. Also set `image-rendering: pixelated` so the browser does not resample.

**Caveat:** these are jsQR numbers on synthetic frames with a symmetric box blur. Real cameras add
perspective, non-uniform focus, rolling shutter, and gamma. Treat the table as a lower bound and
re-measure with the decoder you ship.

**An anomaly that turned out to be a decoder bug — and a serious one.** In an earlier sweep, one
version failed to decode at *every* scale including 6 px/module while its neighbours all passed.
That version was **v23**, and it is a known jsQR data-table typo
([cozmo/jsQR#251](https://github.com/cozmo/jsQR/issues/251)): jsQR's v23 alignment-pattern centres
are `[6, 30, 54, 74, 102]` where ISO/IEC 18004 Annex E specifies `[6, 30, 54, **78**, 102]`.
Versions 21, 22, 24 and 25 are all correct.

**This is uniquely dangerous for qrbeam.** Frame size is chosen from chunk payload size; if a
chunk size happens to land on version 23, **every single frame fails silently** and the transfer
simply never completes, with no error to diagnose. On a library with no commits since 2021. This
alone disqualifies jsQR for production use here — see §7.7.

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

**…but that assumes a decent phone.** Per-device decode latency
([Minhaz Ahmed](https://blog.minhazav.dev/Using-BarcodeDecoder-in-javascript/)):

| Device | ZXing (JS) | Native `BarcodeDetector` |
|---|---|---|
| MacBook Pro 16" | 21 ms | 10 ms |
| Pixel 4 | 56 ms | 23 ms |
| Pixel 4a | 92 ms | 47 ms |
| **Low-end Android** | **373 ms (≈2.7 decodes/s)** | — |

That worst case alone justifies shipping a **2–4 fps floor preset** — on a cheap phone the decoder
*is* the bottleneck, and a 15 fps sender is simply unreadable.

And density interacts with this brutally: *"the frame rate (fps) for 4,000 characters is around
**0.75 fps**… for devices like the Google Pixel 6 Pro"*
([arXiv 2506.23004](https://arxiv.org/pdf/2506.23004)). That is a decisive argument against v40 on
top of the optical one.

Also note **rendering can dominate decoding**: RaptorQR's
[benchmark.md](https://github.com/infrost/RaptorQR/blob/master/benchmark.md) over a 10 s run
measured QR **render 4,078 ms** vs **decode 2,699 ms** vs FEC 126 ms. Pre-render a lookahead queue
(decimen keeps 3) and **skip rather than burst-catch** when behind.

**Decoder choice: `zxing-wasm` ([Sec-ant/zxing-wasm](https://github.com/Sec-ant/zxing-wasm)) in a
Web Worker, driven by `requestVideoFrameCallback`.** Both decimen and RaptorQR converged on this
independently. **`BarcodeDetector` is not viable** — WebKit has never shipped it, which eliminates
every browser on iOS. It is also *not* universally available on Chromium: the API is gated on an
underlying platform barcode service, so it is present on Chrome Android but **absent on desktop
Linux Chromium** — verified directly (`typeof BarcodeDetector === 'undefined'` in Chrome for
Testing 151 on Linux). Treat it as an optional fast path behind a `'BarcodeDetector' in window`
check plus a `getSupportedFormats()` check, never as the primary decoder.

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

**Everything in §7.1–7.3 below was executed and verified on this machine** (Chrome for Testing
151.0.7922.34, Linux, Playwright). Where a widely-repeated recipe turned out to be wrong, I've
said so and given the version that actually runs.

### 7.1 Correction: the Chromium fake-camera flag everyone cites does not work

Nearly every blog post and StackOverflow answer on testing `getUserMedia` says to pass
**`--use-fake-device-for-media-capture`**. In Chrome 151 that switch **does not exist** and is
silently ignored — `enumerateDevices()` returns an empty array and `getUserMedia` throws
`NotFoundError: Requested device not found`.

Grepping the binary for the registered switch names gives the truth:

```
$ strings chrome | grep -E '^use-(fake|file)-'
use-fake-codec-for-peer-connection
use-fake-device-for-media-stream        ← the real one
use-fake-mjpeg-decode-accelerator
use-fake-ui-for-digital-identity
use-fake-ui-for-fedcm
use-fake-ui-for-media-stream
use-file-for-fake-audio-capture
use-file-for-fake-video-capture
```

Measured side by side:

| Flags | Result |
|---|---|
| `--use-fake-device-for-media-capture --use-fake-ui-for-media-stream` | ❌ `NotFoundError`, 0 devices |
| `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` | ✅ `fake_device_0`, 640×480 @ 20 fps |
| `--use-file-for-fake-video-capture=<y4m>` **alone** | ❌ `NotFoundError` |
| `--use-file-for-fake-video-capture=<y4m>` + `--use-fake-ui-for-media-stream` | ❌ `NotFoundError` |
| `--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture=<y4m>` | ✅ plays the file |

**So the file-based capture flag is a *modifier* on the fake device, not a substitute for it.**
Both are required. The correct incantation:

```js
const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',                 // REQUIRED — creates fake_device_0
    `--use-file-for-fake-video-capture=${absPathToY4m}`,  // REQUIRED to play your own frames
    '--use-fake-ui-for-media-stream',                     // auto-grant the camera permission
  ],
});
```

(`--use-fake-ui-for-media-stream` auto-accepts the permission prompt; Playwright's
`context.grantPermissions(['camera'], {origin})` is an alternative for the permission half only —
it does not conjure a device.)

### 7.2 Verified Y4M behaviour

Measured by encoding 8 frames of distinct luma and sampling the centre pixel:

- **Y4M format that works:** header `YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420mpeg2\n`, then per
  frame `FRAME\n` + Y plane (W·H) + U plane (W/2·H/2) + V plane (W/2·H/2).
- **The stream loops seamlessly and indefinitely.** Observed cycle over 4 s of sampling:
  `98 130 163 196 228 0 33 65` repeating exactly, with no gap or stall at the wrap.
  **This is enormously convenient** — it means a fake camera fed a finite QR animation behaves
  exactly like a real sender looping its frames forever, so late-join and loss-recovery paths get
  exercised for free.
- **The header's frame rate is honoured**: `F10:1` produced `track.getSettings().frameRate === 10`.
  Resolution likewise (640×480). So you control capture fps and size from the Y4M header.
- Playwright's bundled ffmpeg is a stripped build with no `lavfi`, so generating Y4M with
  `ffmpeg -f lavfi -i testsrc` fails. **Writing Y4M by hand in Node is trivial** and gives exact
  frame control, which is what you want anyway.

### 7.3 A working end-to-end optical loopback — verified

I built and ran the full harness. It passes.

**Step 1 — render real QR frames straight into a Y4M** (`qrcode` gives you the module matrix; no
canvas or PNG round-trip needed):

```js
import QRCode from 'qrcode';
const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
const { size, data } = qr.modules;          // data[r*size+c] === 1 → dark module
// rasterise into a Y (luma) plane: 235 = white paper, 16 = black module, 4-module quiet zone
```

**Step 2 — feed it to Chromium as the camera** with the flags from §7.1.

**Step 3 — decode in-page**, pumped by `requestVideoFrameCallback` so you get exactly one decode
attempt per delivered camera frame:

```js
const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
const v = Object.assign(document.createElement('video'),
                        { srcObject: stream, muted: true, playsInline: true });
await v.play();
const g = Object.assign(document.createElement('canvas'), { width: 640, height: 480 })
                .getContext('2d', { willReadFrequently: true });

while (collected.size < N) {
  await new Promise(r => v.requestVideoFrameCallback(r));
  g.drawImage(v, 0, 0, 640, 480);
  const img = g.getImageData(0, 0, 640, 480);
  const r = jsQR(img.data, img.width, img.height);
  if (r) ingest(r.data);
}
```

**Measured results:**

| Test | Frames | Result |
|---|---|---|
| 246 B payload, 3 QR frames | 3 | 3/3 collected, **100% decode rate**, payload byte-exact, **622 ms** |
| 2,460 B payload, 28 QR frames, receiver **joins 700 ms late** | 28 | 28/28 collected, **100% decode rate**, payload byte-exact, **3,672 ms** |

The second test is the important one: the receiver deliberately started sampling ~7 frames into
the animation, and still reassembled the complete payload **because the Y4M loops** — the missed
head of the stream came back around. That is precisely the real-world no-back-channel recovery
behaviour, reproduced in CI in under 4 seconds with no camera and no second device.

Note the effective rate: ~29 rVFC callbacks for 28 unique frames over 3.67 s ≈ 8 fps sustained
against a 10 fps source — i.e. the harness naturally reproduces the "you don't get every frame"
condition too.

### 7.4 Independently confirmed, plus the gotchas I did not hit

A separate investigation reproduced the §7.1–7.2 findings independently (same Chromium 151, both
`chrome-headless-shell` and full Chromium via `channel:'chromium'`) and turned up several further
traps, all verified by execution:

**Authoritative switch definitions**, from Chromium source rather than blog posts —
[`media/base/media_switches.cc`](https://github.com/chromium/chromium/blob/main/media/base/media_switches.cc)
and [`content/public/common/content_switches.cc`](https://github.com/chromium/chromium/blob/main/content/public/common/content_switches.cc).
Also useful: `--auto-accept-camera-and-microphone-capture` (*"Bypasses the dialog prompting the
user for permission to capture cameras and microphones. Useful in automatic tests of
video-conferencing Web applications."*).

**MJPEG fake-capture files are accepted but produce black frames.** `--use-file-for-fake-video-capture`
dispatches on file extension (`.y4m` → `Y4mFileParser`, `.mjpeg` → `MjpegFileParser`), and the
MJPEG path opens the device and advertises 640×480@30 but every frame is all-zero — reproduced in
headless-shell, in full Chromium, and with `--use-fake-mjpeg-decode-accelerator`. **Use Y4M.**
(This matters because Y4M is raw I420 at `W·H·1.5 + 6` bytes/frame — a 2 s 640×480 @10 fps file is
~9 MB, vs ~450 KB for the equivalent MJPEG. **Generate Y4M fixtures in a CI pretest step from your
own encoder; never commit them.** That is better testing anyway, since the fixture then tracks the
encoder.)

**The `sed 's/C420mpeg2/C420/'` step from 2015-era blog posts is obsolete.** Chromium's
[`file_video_capture_device.cc`](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/file_video_capture_device.cc)
accepts `420`, `420jpeg`, `420mpeg2` and `420paldv` — but note the check is a `CHECK`, i.e. a hard
crash rather than a graceful error, if you feed it anything else. Same for mixed interlacing.
Modern ffmpeg emits `C420jpeg`, which is fine.

**Resolution is read from the file, not negotiated.** The factory advertises exactly one supported
format, so `getUserMedia({video:{width:{exact:1920}}})` against a 640×480 file is satisfied by
scaling, not by real 1080p pixels. Author the fixture at the resolution you intend to test.
`track.label` is the absolute file path.

**Permission behaviour differs by binary — a real trap:**

| Binary | `--use-fake-ui-for-media-stream` | Playwright `permissions:['camera']` | Result |
|---|---|---|---|
| `chrome-headless-shell` (Playwright's **default** for `headless:true`) | ✅ | — | ✅ works |
| `chrome-headless-shell` | ❌ | ✅ granted | ❌ `NotSupportedError` |
| full Chromium (`channel:'chromium'`) | ✅ | — | ✅ works |
| full Chromium | ❌ | ✅ granted | ✅ works |
| full Chromium | ❌ | ❌ | ❌ `NotAllowedError` |

The headless shell has no permission machinery and fails with a misleading `NotSupportedError`
regardless of what you grant. **To test the camera-denied UX — which qrbeam needs, since "camera
blocked" is a first-class receiver state — you must use `channel: 'chromium'` and omit
`--use-fake-ui-for-media-stream`.**

**Hot-swapping the fixture mid-stream works** (verified both by overwrite-in-place and by
unlink-then-copy): the live feed switches without restarting the browser. The replacement must
have identical dimensions, since width/height/frameRate are latched when the device opens. Handy
for simulating "the sender restarted with a new payload" mid-transfer.

**The synthetic pattern (`--use-fake-device-for-media-stream` with no file) is useless for decode
tests** — it draws a rotating pacman sweep and a timestamp on a dark background; measured mean red
channel 3, zero QR decodes. Use it only for device-enumeration and permission plumbing. Its
options string is genuinely useful though: `fps=` (clamped 5–60), `device-count=` (0–10), and
failure injection via `config=get-photo-state-fails|set-photo-options-fails|take-photo-fails`.

### 7.5 The zero-flag alternative: stub `getUserMedia` with `canvas.captureStream()`

This is arguably a better default than §7.3, and it needs **no launch flags at all**. Inject via
`page.addInitScript()` so it lands before any app code runs:

```js
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
  getUserMedia: async () => {
    const cv = Object.assign(document.createElement('canvas'), {width:640, height:480});
    window.__srcCanvas = cv;         // the test drives this
    return cv.captureStream(0);      // 0 fps = frames only on explicit requestFrame()
  },
  enumerateDevices: async () => ([{kind:'videoinput', deviceId:'stub', label:'stub cam', groupId:'g'}]),
}});
```

Verified working in `chrome-headless-shell` with `args: []`. The app's real path
(`getUserMedia` → `video.srcObject` → `drawImage` → decode) is fully exercised.

**`captureStream(0)` + `track.requestFrame()` is the key trick**: per
[MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream), passing
`0` captures only on explicit request. That makes the optical channel **frame-exact and
timing-flake-free** — you can assert "the receiver reconstructs the file after exactly N frames"
deterministically, which no wall-clock-driven test can do.

**Two-page topology.** `MediaStream` is not transferable across browsing contexts, so you cannot
pipe a canvas stream between pages. But you can shuttle frames through the Node test process as
PNG data URLs between two genuinely separate Playwright pages — measured at ~13.5 sender→receiver
frames/s (25/25 decoded clean, 25/25 decoded degraded, 1.85 s). Separate JS realms and separate
module instances mean **this is the test that actually proves the same static app interoperates
with itself**, with no shared state to accidentally cheat through.

**Degradation ladder — measured decode cliffs** (jsQR, ~v6 code at 440 px in a 640×480 frame;
identical on headless-shell and full Chromium):

| Degradation | Threshold |
|---|---|
| Gaussian blur (`ctx.filter='blur(Npx)'`) | ✅ ≤5 px · ❌ ≥6 px |
| Downscale (distance) | ✅ ≥0.12× · ❌ 0.10× |
| Rotation | ✅ ≤15° · ❌ ≥30° |
| Keystone / tilt (strip warp) | ✅ k≤0.1 · ❌ k≥0.2 |
| Motion blur (8 shifted composites) | ✅ ≤16 px · ❌ ≥28 px |
| Additive noise | ✅ ~amp 25 · stochastic 40–60 |
| Specular glare (radial white to α=1.0) | ✅ decoded at **every** level |
| Combined "realistic phone" (1.5 px blur + 0.45× + 4° + glare) | ✅ decoded |

All achievable in plain canvas 2D except true projective warp — canvas 2D is affine-only, so a
real homography needs WebGL or an inverse-mapped bilinear sampler. That is worth building: it is
the most discriminating degradation. **Note the noise row is stochastic** (one run gave
amp40=fail, amp60=pass) — every degradation test must assert a *rate* over N trials, never a
single boolean.

Existing corpus worth borrowing: the BoofCV-derived set used in
[Dynamsoft's benchmark](https://www.dynamsoft.com/codepool/qr-code-reading-benchmark-and-comparison.html)
(536 images / 1,232 codes, 16 categories including **`monitor`**, `glare`, `perspective`), harness
at [tony-xlh/barcode-reading-benchmark](https://github.com/tony-xlh/barcode-reading-benchmark).

### 7.6 What does not work — verified dead ends

- **`--use-fake-device-for-media-capture`** — no such switch; fails silently (§7.1).
- **`--use-file-for-fake-video-capture` alone** — `NotFoundError`; needs the device flag too.
- **MJPEG fixtures** — black frames in every Chromium configuration tried.
- **Playwright `permissions` in `chrome-headless-shell`** — `NotSupportedError` regardless.
- **WebKit fake camera** — does not exist, in Playwright or in Safari. Safari's
  *Develop ▸ WebRTC ▸ Use Mock Capture Devices* loops a fixed "bip-bop" stream you cannot replace
  ([WebKit: A Closer Look Into WebRTC](https://webkit.org/blog/7763/a-closer-look-into-webrtc/));
  tracking issue [playwright#5444](https://github.com/microsoft/playwright/issues/5444).
- **Firefox custom video** — `media.navigator.streams.fake` + `media.navigator.permission.disabled`
  give a synthetic coloured box only. There is no Firefox equivalent of the file flag. Fine for
  permission/enumeration plumbing, useless for decode.
- **`BarcodeDetector` in Linux CI** — `undefined` in Chromium 151 headless even with
  `--enable-experimental-web-platform-features` and `--enable-features=ShapeDetection`.
  [MDN BCD](https://github.com/mdn/browser-compat-data/blob/main/api/BarcodeDetector.json) marks
  desktop Chrome 88+ `partial_implementation` — *"Supported on ChromeOS and macOS only"*;
  [Chrome's docs](https://developer.chrome.com/docs/capabilities/shape-detection) say macOS,
  ChromeOS, Android. Firefox [never](https://bugzil.la/1553738). **You cannot test this API in
  Linux CI at all.**
- **v4l2loopback in managed CI** — it is a kernel module: cannot be loaded inside a container,
  needs `--privileged`, blocked by Secure Boot, and unavailable on GitHub-hosted runners or
  managed k8s (Mozilla hit exactly this in
  [bug 1099057](https://bugzilla.mozilla.org/show_bug.cgi?id=1099057)). Critically, **it adds no
  fidelity over `--use-file-for-fake-video-capture`** — both inject synthetic pixels below the app
  and neither exercises a lens, sensor, autofocus or exposure loop. OBS Virtual Camera is the same
  story plus a GUI dependency. **Skip both.**
- **iOS Simulator camera** — does not exist and cannot be made to.
  [Apple's Simulator guide](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html)
  lists camera/microphone input as not simulated. Third-party shims (RocketSim, SimulatorCamera)
  work by linking a framework into *your own app binary* — impossible for Safari or WKWebView.
  No Xcode release through 26 changes this.
- **jsQR in production** — abandoned since 2021 and v23 is 100% undecodable (§6.2).

### 7.7 Decoder and encoder choice

| | **zxing-wasm** | rxing-wasm | jsQR | @zxing/library |
|---|---|---|---|---|
| Version | 3.1.2 (2026-07) | 0.5.7 | **1.4.0 (2021-04)** | 0.23.0 |
| Last commit | 2026-07-18 | 2026-07-22 | **2021-08-24** | 2026-04-29 |
| Decode @1280×720 | **4.1 ms** | 5.3 ms | 23.2 ms | 8.9 ms |
| Robustness (56 warp/blur cases) | **44 ok / 0 wrong** | 44 / 0 (with hint) | 31 / 0 | 27 / 0 |
| All 40 QR versions | ✅ | ✅ | ❌ **v23 broken** | — |
| Node, no DOM | ✅ raw RGBA | ✅ | ✅ | awkward |
| gzip | 452 KiB | 890 KiB | 56 KiB | 279 KiB |

**Decoder: `zxing-wasm` (`/reader` entry).** Fastest, most robust to exactly the distortions that
matter here, all 40 versions, no false positives, actively maintained, and it accepts a duck-typed
`{data, width, height}` RGBA buffer in plain Node with no DOM shim.

⚠️ **`zxing-wasm` fetches its `.wasm` from jsDelivr on first decode by default** — verified by
blocking `fetch`, which revealed a request to
`https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.2/dist/reader/zxing_reader.wasm`. **For an
air-gapped, audit-once-trust-forever app this is a silent correctness bug in the product's core
claim.** Fix:

```js
prepareZXingModule({ overrides: { locateFile: () => localWasmUrl }, fireImmediately: true });
```

…and **add a CI test that blocks all network and asserts a decode still succeeds.** That five-line
test is what makes the offline claim true rather than aspirational. It should arguably be a
whole-app test: block the network in Playwright and assert nothing is requested.

If evaluating `rxing-wasm`, **always pass the `PossibleFormats: "QrCode"` hint** — without it, it
produced a *silently wrong* decode (returned `"19575582"` for an 800-char payload, 5/5
reproducible). For a rateless decoder, a corrupt block is far worse than a dropped frame.

**Encoder: `qrcode` with `maskPattern` pinned.** Default encoders run ISO penalty scoring across
all 8 masks, which you do not need when you control both ends. Measured at v20/820 B:
**2.086 ms → 0.353 ms (2,833 fps), a 5.9× speedup** from that one parameter. Pure JS, ~21 KiB gz,
no WASM, no CDN — which also makes it the right choice for the single-file build. Draw the module
matrix yourself with `fillRect`/`putImageData` on an `OffscreenCanvas` in a Worker; never via SVG
or `toDataURL`.

**Test runner: Vitest with `environment: 'node'`** — the WASM/ESM packages work with zero config,
whereas Jest needs `--experimental-vm-modules` and `transformIgnorePatterns` surgery.

### 7.8 Real-device options

**Only one product injects video into a *web page's* `getUserMedia` on a real device:**

| Vendor | Web `getUserMedia` injection | Media |
|---|---|---|
| **BrowserStack Automate** | **yes** | MP4 ≤50 MB |
| BrowserStack Live (manual) | yes | still image ≤10 MB |
| Sauce Labs | **no — explicitly excluded** | still ≤5 MB |
| LambdaTest / TestingBot / HeadSpin / Kobiton | no (native apps only) | — |
| AWS Device Farm | **no camera mocking at all** | — |

Everyone except BrowserStack implements injection by instrumenting or re-signing *your app
binary*, which is structurally impossible when the "app" is Safari. Sauce Labs' "Not Supported"
list literally begins *"Mobile browsers and pre-installed system apps."*

BrowserStack usage: upload via `POST /automate/upload-media` → `media://<hash>`, then set
`cameraInjection: true` and `cameraInjectionUrl`. Their docs name *"scanning QR code to your web
app"* as a use case.
**Caveats:** Private Beta, Enterprise-tier only; the mechanism is undocumented (on desktop it is
almost certainly the flags in §7.1); and **their iOS support claim is self-contradictory** — the
support table lists iOS while the same page's FAQ says *"available only for Android-Chrome,
Mac-Chrome, and Windows-Chrome"*, and the "Safari 10 on iOS 12+" pairing is nonsense indicating a
stale table. **Run a paid trial against a real iPhone before architecting around it.** Also note
BrowserStack devices cannot use their real cameras at all, so injection is the only path there.

**Android emulator is the best self-hosted option:**
`emulator -camera-back videofile:animated-qr.mp4` — a dedicated video-playback camera backend, no
host plumbing, deterministic, runs headless (`-no-window`) in Docker with `--device /dev/kvm`
([docs](https://developer.android.com/studio/run/emulator-commandline)). This is strictly simpler
than v4l2loopback. (Appium's `mobile: injectEmulatorCameraImage` takes a single base64 PNG — useless
for animated codes.)

**Real-device behaviours worth encoding as explicit tests:**

- Outside a secure context `navigator.mediaDevices` is **`undefined`** — guard for that, don't
  just catch a rejection.
- `<video autoplay playsinline muted>` — all three. Missing `playsinline` is the single most
  common cause of "getUserMedia is broken on iPhone" reports
  ([WebKit: New `<video>` Policies for iOS](https://webkit.org/blog/6784/new-video-policies-for-ios/)).
- **`facingMode:'environment'` is a soft constraint** — a device without a rear camera silently
  gives you the front one. Use `{ facingMode: { exact: 'environment' } }` and fail loudly.
- **WKWebView / in-app browsers:** `getUserMedia` exists there only since
  [iOS 14.3](https://webkit.org/blog/11353/mediarecorder-api/), and only if the host app declared
  camera usage. Many never did — **your receiver will fail inside Instagram/Twitter in-app
  browsers and you cannot fix it from the page.** Detect and prompt "Open in Safari."
- **`torch` yes, `focusMode` no.** WebKit's
  [`MediaConstraintType.h`](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/MediaConstraintType.h)
  implements `Torch`, `Zoom`, `FocusDistance`, `WhiteBalanceMode` — **`focusMode` is absent**
  (Chrome-only). Feature-detect via `track.getCapabilities()`.
- **Low Power Mode throttles `requestAnimationFrame` to 30 fps** on iOS
  ([WebKit bug 168837](https://bugs.webkit.org/show_bug.cgi?id=168837)), and iOS enables LPM
  automatically at 20% battery. **If the design assumes 60 Hz sampling it silently halves in the
  field.** Drive decode from `requestVideoFrameCallback`, keep the sender ≤15 fps so 30 Hz
  sampling still satisfies Nyquist, and budget for 30 fps.

### 7.9 The layered recommendation

**Tier 1 — Unit, no browser (every commit, milliseconds).** Vitest + `environment: 'node'`.
`qrcode` encode → RGBA buffer → `zxing-wasm` decode, with the fountain codec round-tripped at the
byte level under injected loss/reorder/duplication. This is where the codec, header parsing,
hostile-input validation (§6.7's `totalLen` DoS) and deterministic-soliton agreement live.
Property-based tests over random payload sizes and loss patterns belong here. **Most of your test
value is in this tier.** Pin a regression test for **every QR version you actually emit** — that
is what would have caught the jsQR v23 class of bug.

**Tier 2 — Synthetic-frame decode + degradation ladder (every commit, milliseconds).** Render the
sender's canvas frames and hand `ImageData` straight to the decoder. Assert **rates, not
booleans**, across blur / downscale / rotation / keystone / motion blur / noise / glare, using the
§7.5 harness and thresholds. **Include rolling-shutter tearing** (§4.5) — it is the degradation
unique to screen-to-camera, absent from every published QR corpus, and demonstrably destroys ~80%
of torn frames.

**Tier 3 — Stubbed `getUserMedia` via `canvas.captureStream(0)` (every commit, seconds).** §7.5.
No launch flags. `requestFrame()` makes it frame-exact, so you can assert the rateless property
directly: *"drop 30% of frames uniformly at random → the file still reconstructs byte-for-byte."*
This is the workhorse tier.

**Tier 4 — True two-page topology (every commit or nightly, ~2 s per 25 frames).** Two separate
Playwright pages, frames shuttled as PNG data URLs through Node. Separate JS realms and module
instances — **this is what proves the same static app interoperates with itself**, with no shared
state to cheat through.

**Tier 5 — Real media pipeline (nightly, seconds).** §7.1–7.3: `channel:'chromium'` +
`--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture=<abs>.y4m`, Y4M generated
in a pretest step from your own encoder. The only tier exercising Chromium's actual capture stack,
video decode and constraint negotiation. Run one variant **without**
`--use-fake-ui-for-media-stream` to assert the `NotAllowedError` UX. Use the fixture hot-swap to
test "sender restarted mid-transfer". Add the **network-blocked decode test** from §7.7 here.

**Tier 6 — The physical rig (pre-release; the actual acceptance gate).** One phone in a clamp
pointed at a tablet, plus a manual pass on a real iPhone and Android against a checklist derived
from §0's blocker table.

**Why Tier 6 is not optional:** every injection mechanism in Tiers 1–5 bypasses the optics
entirely. The real product risk lives precisely in what injection deletes — moiré between QR
modules and the display's pixel grid, backlight glare and specular reflection, autofocus hunting
at close range, exposure oscillation, and rolling-shutter tearing beating against the display
refresh rate. **Injection validates your decoder; it cannot validate your capture chain.**
Tiers 1–5 are the fast regression net; the rig is the gate.

**CI wiring:** Tiers 1–3 on every commit. Tier 4 on every commit if the runtime stays under a few
seconds, else nightly. Tier 5 nightly. Tier 6 gated on release tags. WebKit and Firefox get
plumbing-only coverage (permissions, enumeration, secure-context guards) since neither can be fed
custom video.

---

## 8. Recommendations for qrbeam

### 8.1 File in / file out, per platform

**In — one drop zone, five listeners behind it.** Build a single `acquireFile(): Promise<File>`
surface fed by all of:

| Priority | Mechanism | Where it fires |
|---|---|---|
| 1 | `share_target` POST intercepted by the SW | Android Chrome, installed only |
| 2 | `<input type="file">` **with no `accept` attribute** | everywhere — the floor |
| 3 | `drop` → `DataTransfer.files` | desktop |
| 4 | `paste` → `clipboardData.files` | desktop, opportunistic |
| 5 | `showOpenFilePicker()` behind `'showOpenFilePicker' in window` | desktop Chromium only |

Rationale: omit `accept` so iOS offers **Browse → Files** rather than defaulting to Photos —
picking from Photos silently transcodes HEIC→JPEG and renames to `image.jpg`, which corrupts the
"transfer this exact file" contract. Never read the whole file: keep the `File` reference (backed
by disk, ~free) and pull bytes with `Blob.slice()` per frame.

**Out — one "Save" button, two mechanisms, feature-detected in this order:**

```js
const canShare = navigator.canShare?.({ files: [file] });
// 1. iOS + Android: share sheet → "Save to Files" / any app
if (canShare) await navigator.share({ files: [file] });
// 2. everywhere: anchor download, MUST be inside the click handler
else downloadViaAnchor(file);
// 3. desktop Chromium large-file path: stream straight to disk (chosen up-front, before transfer)
```

Non-negotiables:
- **Both save paths must run inside a real user gesture.** iOS silently ignores a programmatic
  blob-anchor click outside a touch handler. Never auto-save on last-chunk-arrival; show a button.
- Show the `<a download>` button as a **sibling**, not a fallback-after-failure — Safari has a
  history of degrading `share({files})` into a text share without throwing.
- Defer `URL.revokeObjectURL()` by a second or two after the click.
- Tell the user *where the file went* ("Saved to Files → Downloads"); iOS downloads are invisible
  enough that users assume failure.

**Receive-side buffering — the cross-platform architecture:**

1. Desktop Chromium: `showSaveFilePicker()` **before** the transfer starts, then
   `writable.write({type:'write', position, data})` as blocks decode. Bounded memory, out-of-order
   writes handled natively by `position`, atomic move on `close()`.
2. Everywhere else: stage into **OPFS** (`createSyncAccessHandle()` in a worker), then
   `getFile()` → `navigator.share`/`<a download>` at the end. OPFS is the one file API that is
   genuinely cross-browser (Baseline since March 2023; Safari/iOS 15.2+).
3. Single-file `file://` build: OPFS is unavailable (verified `SecurityError`) — hold in memory
   and cap the payload accordingly.

Also call `navigator.storage.persist()` at startup to protect the OPFS staging file from
quota eviction (it does not defeat iOS's 7-day ITP deletion).

### 8.2 PWA approach

- **Ship a hosted PWA as the primary product** and a **`qrbeam-standalone.html` single-file build
  as a first-class secondary artefact**, linked from the app itself. The single file is the honest
  answer for the truly air-gapped user, and it is a different build target with different
  constraints (classic blob workers only, no module workers, no OPFS, base64-inlined WASM or —
  preferably — pure JS).
- Service worker: **precache everything, cache-first, hashed cache name per build.** Handle the
  `share_target` POST *before* the generic GET path. Surface an explicit **"Ready for offline
  use ✓"** state — for this app, knowing when it is safe to disconnect is a real feature.
- Manifest: `display: "standalone"`, dark `background_color`/`theme_color`, 192/512/maskable
  icons, plus the `share_target` block.
- **On iOS, Add to Home Screen is mandatory, not optional.** Safari deletes service worker
  registrations and cache after seven days of non-use; Home Screen web apps get their own usage
  counter and are exempt. Detect iOS-Safari-not-standalone and show a dedicated, illustrated
  onboarding screen explaining *why* — there is no `beforeinstallprompt` on iOS to lean on.
- Keep `<meta name="apple-mobile-web-app-capable" content="yes">` alongside the manifest.
- **Never change the URL path while the camera is live** — WebKit ties the media-capture
  environment to the top frame document's URL and a `pushState` path change destroys the stream.
  Use hash routing or no routing on the receive screen.
- Re-request `getUserMedia` on `visibilitychange`→visible rather than assuming the track survived,
  and provide an explicit **"Open in Safari"** escape hatch on the receive screen for the iOS
  standalone camera regressions that recur every few releases.
- `<video playsinline autoplay muted>` and call `.play()` from the same gesture that requested
  the camera.

### 8.3 Sender display setup

Ordered by impact:

1. **Wake lock, with re-acquisition.** `navigator.wakeLock.request('screen')` on transfer start,
   re-acquire on `visibilitychange`→visible, catch rejections. **Works in iOS Home Screen web apps
   only on iOS 18.4+** — below that, detect and instruct the user to set Auto-Lock to Never.
2. **Fullscreen where it exists.** `requestFullscreen()` from the "Start" gesture on Android and
   desktop. **iPhone cannot do this at all** (iPad only) — rely on `display: standalone` +
   `viewport-fit=cover` + hiding all chrome.
3. **Defeat colour transforms.** `<meta name="color-scheme" content="only light">` to block
   Chrome Android's Auto Dark Theme before it can flash; render the QR to a **`<canvas>`** (not
   CSS-coloured DOM) so pixel data is not remapped; set `image-rendering: pixelated`.
   iOS Smart Invert cannot be opted out of — instead **make the decoder inversion-tolerant** (try
   the frame and its inverse), which retires the entire class of problem, and offer a manual
   invert toggle.
4. **Brightness is a user instruction, not an API.** No browser can set it. Show a short
   pre-flight checklist: brightness up, auto-brightness off, Night Shift/True Tone off. Feature-
   detect the proposed `screen.requestBrightnessIncrease()` so qrbeam improves for free if
   Chromium ships it — its explainer names QR display as the motivating use case.
5. **Drive frames from `requestAnimationFrame`, never `setInterval`.** Measure the refresh rate by
   timing rAF callbacks *while animating*, then quantise the target fps to an integer divisor of
   it and hold each QR for exactly `round(R / targetFps)` vsyncs. Constant on-screen duration is
   what lets a rolling-shutter camera catch whole frames. No CSS transitions or cross-fades on the
   QR element — a dissolve between frames is fatal.
6. Pause and warn on `visibilitychange`→hidden; a backgrounded sender is throttled to ~1 Hz and is
   no longer transmitting.

### 8.4 Progress UX with no back-channel

*(Evidence in §5.)* The governing insight: **the sender genuinely cannot know, and the user is the
back-channel.** Design for that instead of faking a number.

**Coding first — it determines what the UI can honestly say.** Use a fountain code; the evidence is
unanimous and quantitative (txqr's own before/after on identical hardware is 2.8×). Budget
ε ≈ **1.15–1.18**. Put a **self-describing ~20-byte header on every frame** (magic, session id, seq,
K, block length, total length, hash) so the receiver locks on mid-flight with no handshake and a
sender restart auto-resets the receiver.

**Sender — show parameters and controls, never fake progress:**

1. **Do not promise "frame 3 of 17."** With a fountain there is no 17. Show a live spec line:
   `15 fps · 1465 B/frame · v27 · ECC L · 2.1 MB · K=1430`.
2. **Ship the URDemo fragment bar** — a strip under the QR showing which fragments are XOR'd into
   the frame currently on screen. It is the only sender-side display anyone has built that conveys
   something true, and it makes the fountain legible rather than mysterious.
3. **Ship controls, not readouts.** Every mature tool has speed and density controls, and they are
   worth more than any counter: an fps slider, a QR-size slider (the user's only lever on the
   optical link budget), and pause/step. The size slider doubles as the photosensitivity mitigation.
4. **Two honest sentences:** *"Max screen brightness helps — but avoid glare."* and *"The stream
   loops forever — stop when the receiver says it's done."*

**Receiver — five things, in order of how much they help:**

1. **A green/grey/no dot per captured frame** (SeedSigner's design): green = decoded and *new*,
   grey = decoded but duplicate, nothing = no code in view. **This is the highest-value element in
   the whole UI** because it responds instantly, so the user can hunt for the right distance in
   real time. A percentage cannot do this.
2. **Progress = `min(0.99, framesCollected / (K × 1.18))`** — frames *in*, never blocks *solved*,
   and **never allow it to decrease**. This avoids both the BC-UR 99%-clamp bug and the LT
   back-loaded-cascade bug (§5.5). Casa measured the cost of getting this wrong at up to 48 minutes.
3. **Live "new vs duplicate" frame counters.** When new-frame rate collapses to zero but duplicates
   keep arriving, the user is scanning a stalled or already-complete stream — worth saying so.
4. **A coverage grid** (qrs/Coldcard style: decoded / redundant / missing). With a hybrid systematic
   prefix you can show real per-index status for parts `1..seqLen`; with pure LT, show *coverage*
   rather than per-index state or it will mislead.
5. **End with hash verification, stated out loud** (`hash verified ✓` / `MISMATCH`), and consider a
   **visual hash shown on both screens** (URDemo's LifeHash) so the user can confirm identity by eye
   across the air gap — a zero-bandwidth integrity check.

**Then do the thing nobody has done.** Measure the true capture rate from
`requestVideoFrameCallback`'s `presentedFrames` and the decode success rate, and **turn the receiver
into an advisor**: *"move closer — the code should fill at least 40% of the frame"*, *"too fast —
set the sender to 8 fps"*, *"hold still, or prop the phone against something."* Apple and Google
both ship this pattern at the platform level ("Slow Down", auto-zoom); no animated-QR tool does.
Draw a reticle marking the actual decode region — Casa asked for exactly this and nobody ships it.

**Ergonomics copy, which is currently buried in READMEs everywhere and belongs in the UI:**
*"Prop your phone against something — autofocus hunting from hand tremor is the biggest killer"*
(worth ~40–45% goodput, §5.7), *"fill the frame with the code"*, and *"good ambient light beats a
bright screen."* Show the propping advice automatically for any transfer projected over ~60 s.

**And render dark-on-light, upright, always** — with `inversionAttempts: 'dontInvert'` and
`tryInvert`/`tryRotate` off. That is a free ~2× on decode throughput (§4.4); keep dual-polarity
decoding as a user-triggered escape hatch for OS colour inversion, not a default.

### 8.5 Testing approach

**Recommendation: six tiers (§7.9). The default workhorse is a stubbed `getUserMedia` returning
`canvas.captureStream(0)` — no browser flags, frame-exact. The real-capture tier uses Chromium's
file-backed fake camera. Both are verified working; the physical rig remains the acceptance gate.**

| Tier | What | Cadence |
|---|---|---|
| 1 | Node unit: codec round-trip, loss injection, hostile input, **a case per emitted QR version** | every commit |
| 2 | Synthetic-frame decode + degradation ladder incl. **rolling-shutter tearing** (assert rates, not booleans) | every commit |
| 3 | Stubbed `getUserMedia` → `canvas.captureStream(0)` + `requestFrame()`, **no flags** | every commit |
| 4 | Two separate Playwright pages, frames shuttled via Node — proves app-to-app interop | commit/nightly |
| 5 | Real capture stack: `--use-fake-device-for-media-stream` + `--use-file-for-fake-video-capture=<abs>.y4m`, plus a **network-blocked decode test** | nightly |
| 6 | Physical rig (phone clamped facing a tablet) + manual iPhone/Android checklist | pre-release |

**Traps that will cost a day each if you don't know them:**

- **`--use-fake-device-for-media-capture` — the flag in nearly every tutorial — does not exist.**
  It is silently ignored; the real name is `--use-fake-device-for-media-**stream**`. And
  `--use-file-for-fake-video-capture` requires it alongside; it is a modifier, not a substitute.
- **MJPEG fixtures produce black frames.** Use Y4M, generate it in a pretest step, never commit it.
- **`chrome-headless-shell` (Playwright's default) has no permission machinery** — camera
  permission tests need `channel: 'chromium'`.
- **`zxing-wasm` fetches its `.wasm` from a CDN by default**, silently breaking the offline claim.
  Pin `locateFile` to a local URL and add a network-blocked CI test.
- **jsQR cannot decode QR version 23** and is unmaintained since 2021. Use `zxing-wasm`.
- **`BarcodeDetector` is undefined in Linux CI** and absent from all of iOS — never the primary
  decoder.
- Playwright's bundled ffmpeg has no `lavfi`; write Y4M in Node.

**Honest limits:** WebKit cannot fake a camera, Firefox can only produce a synthetic box, and the
iOS Simulator has no camera at all. So the iOS behaviours that matter most — standalone-PWA camera
regressions, Smart Invert, the share sheet, wake lock below 18.4, 7-day eviction — are **not
CI-testable at any price**. BrowserStack Automate is the only device cloud that injects video into
a web page's `getUserMedia`, and its iOS support claim is internally contradictory; trial it before
depending on it.

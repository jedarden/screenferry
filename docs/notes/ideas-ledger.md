# screenferry — Ideas Ledger

Append-only record of ideation runs against `docs/plan/plan.md`. Every idea
generated is recorded, including the killed ones and *why* they died — future runs
dedupe against this file, and a dead idea may only be resurrected by stating why
its kill objection no longer holds.

---

## Run 2026-07-31 — inaugural run

**Target:** `docs/plan/plan.md` · **Pool:** 103 → **Finalists:** 10
**Lenses:** invert-the-problem · adjacent-domain · remove-a-constraint · 10×-simpler ·
power-user · failure-mode · novice-UX · competitor-first

**Constraints used as kill criteria:** no backend/runtime network · must work offline ·
both roles one page · byte-exact + binary-safe · no back-channel in baseline · multi-GB
constant memory/streaming/resume · modulation layer swappable · fragment length L fixed
(D15) · harmonic+GE coupled (D6) · frames on demand (D24) · not a chat/paper tool ·
iOS has no Share Target, no File System Access, ~1 GB quota.

### Finalists

| # | Idea | Cluster | Grade |
|---|---|---|---|
| F1 | Storage pre-flight & capacity gate | reliability | S |
| F2 | Diagnostic stall detector | reliability | M |
| F3 | Aim reticle + distance coach | novice UX | M |
| F4 | Photosensitivity safeguard (WCAG 2.3.1) | accessibility | S |
| F5 | Text/secret fast path | scope | S |
| F6 | Single-file offline build | distribution | M |
| F7 | Delta transfer (send only what changed) | data reduction | L |
| F8 | Pairing splash QR | novice UX | S |
| F9 | Multi-receiver broadcast | differentiator | S |
| F10 | Verifiable reproducible build | trust | M |

### Full pool with verdicts

Legend: **F**=finalist · **S**=survived kill pass but not selected · **T**=cut at triage ·
**K**=killed in adversarial pass (reason given) · **X**=already in plan/exists

#### Lens 1 — invert the problem

| Idea | One-line | Verdict |
|---|---|---|
| Record-now-decode-later | Receiver films with MediaRecorder, decodes from the file afterwards | **K** — 1080p30 ≈ 2.25 GB/hour of video to move a 1 GB file in 2.7 h; the recording is larger than the payload. Strictly worse than decoding live. |
| Reverse one-shot handshake | Sender scans one static QR from receiver before starting | **K** — duplicates the repair code (§6.2) with worse ergonomics; at session start the receiver has nothing to report yet |
| Ultrasonic back-channel | Web Audio mic/speaker as the reverse link, no line-of-sight | **S** — sidesteps the front-camera geometry problem entirely; loses to the zero-cost human repair code |
| Delta transfer | Send only the diff vs a file the receiver already holds | **F7** |
| Rolling-shutter band decode | Decode a torn frame per horizontal band instead of discarding | **K** — subsumed by D1: tiles are already independent, so a torn frame already yields every tile falling wholly inside one band |
| Mosaic mode | One giant static code; receiver pans/zooms and stitches | **T** — no frame sync needed, but capacity is bounded by a single still; loses to animation |
| Tiny-file fast path | Files under a few KB render as one static QR | **T** — merged into F5 |
| Overdrive mode | Transmit denser than currently decodable, let the ladder harvest | **X** — that *is* D16 |
| Human-as-feedback scrub | Draggable block cursor on the sender | **T** — repair code covers it |
| Reverse-role mid-transfer | Devices swap roles briefly to exchange progress | **T** — heavy ceremony for a status update |
| Tail-first / format-aware ordering | Order blocks so an abort yields a usable prefix | **K** — blocks already complete in sender order, so a usable prefix is free; the residue (zip central directory, mp4 moov) needs format parsers for abort-case-only value |
| Checksum-by-eyeball | Short visual fingerprint compared by the human | **T** — per-block hashes already guarantee correctness |
| Camera-as-sender-monitor | Sender watches its own screen via front camera for occlusion | **T** — solves a problem the user can already see |

#### Lens 2 — adjacent-domain transplant

| Idea | One-line | Verdict |
|---|---|---|
| Multi-source (BitTorrent) | Two senders on two screens, one receiver | **T** — complexity far exceeds the 2× |
| Interlaced fields (broadcast TV) | Alternate high/low detail fields | **X** — D16's ladder is this, done better |
| Progressive content preview | Send a thumbnail/preview first, then refine | **T** — merged into the ordering idea, then killed with it |
| TTL beacons | Beacon announces next beacon time so decoder can idle | **T** — micro-optimisation |
| ADS-B squitter model | Periodic self-contained status bursts | **X** — that is D17's beacon |
| Content-defined chunking (git) | Rolling-hash chunks so identical regions dedupe | **T** — tensions with D15/D19 fixed blocks; folded into F7 |
| Certified-mail receipt | Receiver shows a signed delivery receipt QR | **T** — needs the sender's camera; niche |
| Audio as parallel data channel | Run speaker+mic alongside for additive bandwidth | **K** — ggwave-class audio is ~1 kbit/s against 30 KB/s optical; adds a subsystem for ~0.4% |
| Closed-caption layer | Human-readable text in frame so bystanders understand | **T** — costs payload area |
| Dual-monitor striping | Spread tiles across two displays | **T** — rare setup |
| Kiosk/fixed-scanner mode | Treat phone in a stand as a fixed scanner station | **T** — merged into presets |
| Store-and-forward courier | Intermediate device records and replays later | **T** — dies on the same video-size math as record-now-decode-later |
| I-frame/P-frame deltas | XOR-deltas between blocks for internally redundant files | **T** — compression already covers this |

#### Lens 3 — remove a constraint

| Idea | One-line | Verdict |
|---|---|---|
| Full duplex via front cameras | Both devices on stands, MAMBA-style | **X** — plan open question 7 |
| Folder/archive transfer | Stream a tar built on the fly | **S** — real convenience; loses on complexity vs finalists |
| Receive-only minimal build | Sub-50 KB page for the device without the app | **T** — merged into F6/F8 |
| Optional self-hosted relay | Fall back to network when available | **K** — violates the no-backend constraint outright; the whole security claim rests on it |
| External monitor for area | Use a second display to double area | **T** — duplicate of dual-monitor |
| Video-file input to receiver | Accept a recording instead of a live camera | **S** — good for support/repro; folded value into F10's verifiability story |
| Export transmission as MP4 | Downloadable video of the whole stream | **K** — same fatal arithmetic: the video is bigger than the file it encodes |
| Broadcast to many receivers | One sender, many cameras at once | **F9** |
| Lossy mode for media | Trade fidelity for time on images/video | **T** — violates byte-exact; a different product |
| Passphrase encryption | AES-GCM before chunking | **X** — plan open question 10 |
| Tripod/stand detection | Lock a high-density profile when the image stops moving | **T** — merged into presets |
| Ship libcimbar codec first | Skip Stage 1 QR entirely | **T** — contradicts the staged risk argument in §8 |
| Multi-file queue | Transmit several files back-to-back unattended | **S** — natural after F5; not yet |

#### Lens 4 — 10× cheaper / simpler

| Idea | One-line | Verdict |
|---|---|---|
| Single-file HTML build | Whole app as one self-contained `.html` | **F6** |
| Skip fountain for small files | Round-robin + bitmap under ~1 MB | **T** — two code paths to maintain for a case the fountain already handles |
| One QR version, no ladder | Pick v15, tell the user to move closer | **T** — reintroduces the zero-throughput cliff D16 exists to remove |
| Skip compression | Drop CompressionStream and the staging file | **S** — legitimate v1 cut; keep as a flag, not an idea |
| Skip OPFS, cap at memory | Ship with a ~500 MB ceiling | **K** — violates the multi-GB objective, which is the point of the plan |
| Text/secret-only mode | Paste text, get a code; no file handling | **F5** |
| Fixed 4-tile layout | Always four large tiles, no grid math | **T** — throws away most of D1's 10× |
| Single worker | One decode thread, accept lower fps | **T** — premature simplification |
| Frame-count-only progress | "1,204 frames received", no ETA | **T** — D23 requires a real estimate |
| Sender-only, use any scanner app | For payloads fitting one code | **T** — abandons byte-exactness for binary |
| URL-fragment payloads | Encode tiny payloads in the URL | **T** — merged into F5 |
| Drop resume, use small blocks | 256 KB blocks and loop forever | **K** — violates D22; at 10 GB "loop forever" is days |
| One-button role inference | Camera opens by default; dropping a file switches to send | **S** — good, folded into F8's flow |

#### Lens 5 — power-user workflow

| Idea | One-line | Verdict |
|---|---|---|
| CLI companion | Node/Deno tool sharing the codec | **S** — enables scripted air-gap work and third-party verification; overlaps F10, cut on complexity |
| Transmission manifest export | JSON of streamId + block hashes | **S** — folded into F10 |
| Repair code over any channel | Send the missing-block code by SMS/voice/paper | **X** — that is §6.2 |
| Unattended overnight queue | Wake lock + completion chime | **S** — natural companion to multi-GB; not yet |
| Profile presets | tripod / handheld / phone-to-phone / projector | **S** — cheap and useful, but tensions with D16+D18 discovering this automatically; two competing control paths |
| Live telemetry overlay | px/module, erasure %, per-block heatmap | **T** — merged into F2 |
| URL-param scripting | `?role=send&density=aggressive` | **T** — thin |
| Export/import decoder state | Move a half-finished reception between devices | **T** — niche; resume already covers the real case |
| Multi-monitor sender | Double the tile area | **T** — duplicate |
| Checksum-only compare | Verify two devices hold the same file without sending it | **S** — genuinely cheap and useful; just below the line |
| Air-gap audit log | Signed record of what moved, when, and its hash | **S** — strong for the regulated-environment story; needs signing keys |
| Custom block ordering | User prioritises which blocks go first | **T** — killed with format-aware ordering |
| Headless verification harness | Replay a recorded video through the decoder | **T** — Phase 0's stub-camera tier already covers CI |

#### Lens 6 — failure-mode / reliability

| Idea | One-line | Verdict |
|---|---|---|
| Storage pre-flight | Check quota and refuse *before* starting | **F1** |
| Thermal/battery guard | Drop density on throttling rather than lose frames | **S** — real over multi-hour runs; folded partly into F2 |
| Frame-integrity canary | Known-value tile distinguishes optical vs payload failure | **T** — merged into F2, where it is the key mechanism |
| Diagnostic stall detector | Say *why* nothing is arriving | **F2** |
| Duplicate-frame detector | Detect a paused/asleep sender | **T** — merged into F2 |
| Wrong-stream guard | "That's a different file", not silence | **T** — merged into F2 |
| Screen-sleep guard | Warn if wake lock failed before a 10-hour run | **T** — merged into F2 |
| Source-file change detection | Abort if the file changes mid-transfer | **S** — real correctness hazard over multi-hour transfers |
| OPFS verify on resume | Re-check block hashes rather than trusting the bitmap | **T** — merged into F1 |
| Quota-exhaustion graceful stop | Save what completed + a manifest of what's missing | **T** — merged into F1 |
| Torn-frame accounting | Surface torn-frame rate | **T** — merged into F2 |
| Autofocus-hunt detector | Detect focus oscillation, prompt to lock | **T** — merged into F2/F3 |
| Deliberate-failure test mode | "Simulate 40% loss" toggle on real hardware | **S** — validates the central bet; developer-facing |

#### Lens 7 — novice UX

| Idea | One-line | Verdict |
|---|---|---|
| Aim reticle + distance coach | Align the sender's screen into an on-screen frame | **F3** |
| Haptic distance feedback | Vibrate for too-far/just-right | **T** — merged into F3; no Vibration API on iOS Safari |
| Big honest ETA up front | "About 4 hours. Continue?" | **X** — that is D23 |
| Pairing splash QR | Sender shows a QR with the app URL | **F8** |
| Block heatmap progress | A filling visual rather than a percentage | **S** — nice; loses to F3 within the UX cap |
| "Prop your phone up" guidance | Explicit setup illustration | **T** — merged into F3 |
| Completion chime | Sound when done | **T** — merged into the unattended-queue idea |
| Fail-soft explanations | "Too small — move closer", not "0 packets" | **T** — merged into F2 |
| One-tap role inference | Infer sender/receiver from first action | **T** — merged into F8 |
| Dark-room warning | Detect conditions that will hurt | **T** — merged into F2 |
| Honest ETA including "not converging" | Say when it will never finish at this distance | **T** — merged into F2 |
| Deliberate restart confirmation | Restarting 4 hours of work must be intentional | **T** — ordinary UI hygiene |
| Plain-language explainer | One screen for the person handed a phone | **T** — ordinary UI hygiene |

#### Lens 8 — what a competitor ships first

| Idea | One-line | Verdict |
|---|---|---|
| QR-to-clipboard for text | Instant utility, zero infrastructure | **T** — merged into F5 |
| Wi-Fi credential transfer | Focused high-value tiny payload | **K** — the `WIFI:S:…;` QR is already a standard every phone camera reads natively; screenferry adds nothing |
| Crypto seed / PSBT support | The proven animated-QR market | **S** — real market, but see below |
| BC-UR / BBQr wire compatibility | Interoperate with hardware wallets | **S** — narrowed to a small-payload compat mode; adopting BC-UR wholesale would import a decoder measured 1.3–1.7× worse and a format built for seed phrases, not gigabytes |
| Browser extension | "Send to my phone" from the desktop | **T** — a second distribution channel to maintain |
| Shareable deep links | `/#recv` lands in the right mode | **T** — merged into F8 |
| Landing page live demo | Two panes demoing the loop on one screen | **S** — strong marketing, also a genuine test surface |
| Benchmark + voluntary report | "Your device achieved 34 KB/s" | **S** — the only way to get real device data with no telemetry backend |
| Published open format spec | Invite third-party implementations | **S** — folded into F10 |
| Native app wrappers | iOS/Android shells | **K** — abandons the static-web premise that makes the security claim auditable |
| Enterprise air-gap positioning | Target regulated environments | **S** — positioning, not a feature |
| Password-manager integration | Export a secret straight to a transmission | **T** — merged into F5 |

#### Gap round (added in Step 7)

The surviving set had no coverage of **accessibility** or **trust in the artifact
itself** — both material for a tool aimed at sensitive transfers.

| Idea | One-line | Verdict |
|---|---|---|
| Photosensitivity safeguard | WCAG 2.3.1: cap flash area/rate, reduced-motion mode, pre-warning | **F4** |
| Verifiable reproducible build | Publish a bundle hash; the app displays its own version+hash | **F10** |
| Local benchmark + voluntary report | Achieved KB/s as a copyable string | **S** — weaker than the finalists |
| Deterministic build pipeline | So third parties can reproduce the published hash | **T** — merged into F10 |

### Run statistics

| Stage | Count |
|---|---|
| Generated | 103 |
| After dedupe/merge | 91 |
| After triage | 25 |
| Crossover hybrids added | 3 |
| Advanced to pairwise | 18 |
| Killed in adversarial pass | 8 |
| Gap-round entrants | 4 |
| **Finalists** | **10** |

### Adoption decisions (2026-07-31)

Seven of ten finalists adopted and tracked as beads blocking genesis `bf-28p`.

| Finalist | Decision | Bead |
|---|---|---|
| F1 Storage pre-flight | **adopted** | `bf-4d6` |
| F2 Diagnostic stall detector | **adopted** | `bf-5vm` |
| F3 Aim reticle + distance coach | **adopted** | `bf-1g0` |
| F4 Photosensitivity safeguard | **adopted** | `bf-6d3` |
| F5 Text/secret fast path | **rejected** — a different product hiding inside this one | — |
| F6 Single-file offline build | **rejected** — will deploy as a static site, and WASM (zxing, D3) is almost certainly required, which is exactly what a single-file build cannot cleanly inline | — |
| F7 Delta transfer | **adopted, scope extended** — must also cover restarting interrupted transfers; see plan §10.2 for the D15/D19 tension | `bf-280` |
| F8 Pairing splash QR | **adopted** | `bf-4tb` |
| F9 Multi-receiver broadcast | **pending** — question raised: how would multiple receivers coordinate with the sender? | — |
| F10 Verifiable build | **adopted, scope extended** — add a semver at the bottom of the page | `bf-13h` |

Note on F6's rejection: it does not invalidate the offline requirement (concept.md
constraint 2). The PWA + service-worker path remains the offline story; only the
single-file distribution variant is dropped.

# screenferry

**Move a file between two devices using nothing but a screen and a camera.**

screenferry is a static web app — no server, no backend, no network between the two
devices. The sending device reads a local file and flashes it out as an animated
sequence of optical codes. The receiving device runs the *same* web app, points
its camera at the sender's screen, decodes the frames, and reassembles the
original file byte-for-byte.

```
┌─────────────────┐                      ┌─────────────────┐
│    SENDER       │   ░▓█ optical ░▓█    │    RECEIVER     │
│                 │  ──────────────────► │                 │
│  file → chunks  │  animated code frames│  frames → file  │
│  → coded frames │   screen to camera   │  → download     │
└─────────────────┘                      └─────────────────┘
        same static web app on both ends
```

Animated QR codes are the obvious way to do this, and the likely starting point —
but the goal is the *channel*, not the format. QR spends most of its capacity on
robustness screenferry doesn't need (arbitrary angles, print damage, one bit per
module). Denser modulation — colored cells, stacked RGB codes, a purpose-built
grid codec — is on the table wherever it survives a real phone camera. The
architecture keeps that layer swappable.

## Why

The screen-to-camera channel is the one data path that survives when everything
else is unavailable or untrusted:

- **Air-gapped systems** — the receiving machine is deliberately not on any network.
- **Hostile or captive networks** — hotel wifi, conference NAT, corporate DLP.
- **Cross-ecosystem transfer** — AirDrop doesn't talk to Android; Nearby Share doesn't talk to iOS.
- **No pairing, no accounts, no cloud** — nothing is uploaded anywhere, because
  there is nowhere to upload it to. The bytes go from screen to lens.
- **Provably no exfiltration** — a static page with no network calls can be
  audited once and trusted thereafter.

## The hard part

The channel is **strictly one-way**. The sender has no idea how the receiver is
doing — there is no ACK, no retransmit request, no back-channel of any kind. The
receiver *will* miss frames: autofocus hunting, motion blur, glare, the user
looking away.

A naive "loop through chunks 1..N forever" transfer degrades badly under loss
(the coupon-collector problem — the last few chunks take agonizingly long).
screenferry's design centers on **rateless erasure coding**: the sender emits an
endless stream of encoded frames, and the receiver reconstructs the file once it
has collected *any* sufficient subset. Miss a frame and it simply doesn't
matter — the next one is just as useful.

## Status

**Research complete. Phase 1 core codec built (22 tests green). Phase 0 harness and Phase 0.5 spike both partial** — see [`docs/plan/plan.md`](docs/plan/plan.md) §17.2.

- [`docs/plan/plan.md`](docs/plan/plan.md) — the complete application plan
- [`docs/notes/`](docs/notes/) — design decisions and constraints specific to screenferry
- [`docs/research/`](docs/research/) — findings:
  - `qr-encoding-capacity.md` — QR versions, EC levels, bytes per frame, JS encoders
  - `browser-qr-scanning.md` — camera capture, decoder libraries, binary safety
  - `fountain-codes-and-protocol.md` — erasure coding for a one-way channel, wire format
  - `beyond-qr-optical-channels.md` — color barcodes, screen-camera research, what beats QR
  - `custom-codec-engineering.md` — feasibility of a purpose-built codec in a browser
  - `pwa-platform-and-ux.md` — offline PWA, file I/O, iOS constraints, UX, testing

## Expectations

This is not a fast pipe. Realistic throughput is on the order of **kilobytes per
second** — good for keys, configs, documents, and small archives; not for video.
The app is designed to be honest about this up front rather than let a user start
a transfer that would take an hour.

## License

MIT

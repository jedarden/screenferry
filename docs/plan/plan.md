# screenferry — Application Plan

> **Status: awaiting research.** This file is the single, complete plan for the
> application — architecture, components, data model, phases, open questions.
> It is deliberately a stub right now: six research threads are in flight, and
> writing the plan before they land would mean guessing at the numbers that
> determine every important decision.
>
> When the research completes, this file gets written in full and this banner
> comes off.

## What the plan must decide

The research in `docs/research/` exists to answer exactly these questions. Each
one gates a section of the plan.

| Decision | Gated on | Where the answer comes from |
|---|---|---|
| **Modulation** — plain QR / RGB-stacked QR / custom grid codec | Bytes per frame each can carry, and whether the denser ones survive a handheld phone camera | `beyond-qr-optical-channels.md`, `custom-codec-engineering.md`, `qr-encoding-capacity.md` |
| **Frame rate** — how fast the sender flashes | The receiver's sustained *unique successful decode* rate, which is the real bottleneck | `browser-qr-scanning.md`, `custom-codec-engineering.md` |
| **Erasure coding** — LT / RaptorQ / interleaved RS / none | Overhead ratio and small-N behaviour; availability of a trustworthy browser implementation | `fountain-codes-and-protocol.md` |
| **Wire format** — the per-frame header byte layout | What metadata each frame must carry to be self-describing, and how BC-UR / BBQr solved it | `fountain-codes-and-protocol.md` |
| **Decoder library** — which one, and the fallback chain | Binary safety (non-negotiable), decode latency, worker compatibility | `browser-qr-scanning.md` |
| **File I/O + offline shell** | Platform support, especially iOS Safari | `pwa-platform-and-ux.md` |
| **Progress UX with no back-channel** | What existing animated-QR tools actually do | `pwa-platform-and-ux.md` |
| **Test strategy** — optical loopback without two devices | Feasibility of synthetic-frame and fake-camera approaches | `pwa-platform-and-ux.md` |

## Architecture sketch (provisional)

The one structural commitment made ahead of the research is the **layering**,
because it is what keeps the modulation decision reversible:

```
  ┌──────────────────────────────────────────────┐
  │  UI  — role selection, progress, file pickers │
  ├──────────────────────────────────────────────┤
  │  Session — metadata, hashing, reassembly      │
  ├──────────────────────────────────────────────┤
  │  Erasure coding — fountain encode / decode    │
  ├──────────────────────────────────────────────┤
  │  Framing — header + payload → frame bytes     │
  ├──────────────────────────────────────────────┤
  │  Modulation — bytes ⇄ pixels   ◄── SWAPPABLE  │
  │    · QR                                       │
  │    · RGB-stacked QR                           │
  │    · custom grid codec                        │
  ├──────────────────────────────────────────────┤
  │  Transport — canvas render / camera capture   │
  └──────────────────────────────────────────────┘
```

Everything above the modulation layer is written against
`encodeFrame(Uint8Array) → ImageData` and `decodeFrame(ImageData) → Uint8Array |
null`. A `null` is an erasure, and the layer above already knows how to survive
those.

See `docs/notes/concept.md` for the constraints this plan must satisfy.

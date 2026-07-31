# Prior art: libcimbar — verified, and it reframes the project

`docs/research/custom-codec-engineering.md` surfaced
[sz3/libcimbar](https://github.com/sz3/libcimbar) as an existing implementation of
essentially qrbeam's thesis. Because that finding changes what qrbeam *is*, it
was verified against the source rather than taken from the research summary.

## Verification

| Check | Result |
|---|---|
| Repository exists | Yes — `sz3/libcimbar`, 6,221 stars |
| Actively maintained | Yes — last push 2026-07-31 (the day of this check), not archived |
| Language | C++ |
| License | **MPL-2.0** |
| Throughput claim | Confirmed **verbatim in its own README**: *"It can sustain speeds of 850 kilobits/s (~106 KB/s) using just a computer monitor and a smartphone camera!"* |
| Architecture | Confirmed: *"a simple protocol for file encoding built on fountain codes (`wirehair`) and zstd compression… This is true even if the images are received out of order, or if some have been corrupted or are missing."* |

The claim in the research doc is real and comes from the project itself, not a
third-party summary.

## Why this matters

**1. It validates the architecture independently.** libcimbar arrived at the same
layering qrbeam sketched before this research landed — chunk, fountain-code,
frame, modulate — including the choice to lean on rateless coding rather than
retransmission. Two independent designs converging is good evidence the shape is
right. It also confirms compression belongs *before* chunking (libcimbar uses
zstd; browsers give us `CompressionStream` natively).

**2. It resets the throughput target.** The QR research thread's headline was
**~18.5 KB/s** (v27, EC L, 15 fps). libcimbar demonstrates **~106 KB/s** on the
same class of hardware — a **~5.7×** gap. That gap is the entire argument for
looking past QR, and it is now measured rather than speculative. QR's overhead
isn't a rounding error; it is most of the channel.

**3. It converts "is a custom codec feasible in a browser?" from a research
question into an engineering one.** It ships a WASM receiver. The answer is yes,
and the remaining risk is our execution, not the concept.

## The licensing problem — decide before writing any code

libcimbar is **MPL-2.0**. qrbeam's README currently says MIT. These interact in a
specific way that is easy to get wrong:

- MPL-2.0 is **file-level copyleft**. Any file containing MPL-licensed code must
  remain MPL, and its source must be made available.
- It is *not* viral across the whole project the way GPL is. MPL files can live
  alongside MIT files in one codebase, and merely *linking* or shipping them
  together does not relicense the rest.
- So: porting libcimbar's decoder into qrbeam is legally fine, but those ported
  files stay MPL-2.0 and must be marked as such.

Three options, to be settled in the plan:

| Option | Consequence |
|---|---|
| **Port/adapt libcimbar code** | Fast, proven. Ported files are MPL-2.0; repo becomes mixed-license and must say so clearly in README and per-file headers. |
| **Clean-room implement from the format** | Keeps qrbeam uniformly MIT. Slower, and re-derives work that is already done well. |
| **Use it as reference only** | Read it for geometry and calibration technique, write our own. The realistic middle path — but "reference only" must be genuine, not a fig leaf over copied code. |

Whichever we pick, this must not be decided implicitly by someone pasting a
function in. Flagging it here so the plan makes it an explicit choice.

## What qrbeam still adds

libcimbar existing does not make qrbeam redundant, but it does sharpen what
qrbeam is *for*:

- **libcimbar is not a web app.** It's a C++ library with CLI tools and a WASM
  decoder demo. qrbeam's premise — open a URL on two devices, no install, works
  offline, auditable static bundle — is a genuinely different product.
- **Its WASM component is the receiver.** The sender side in a browser, and the
  whole PWA/offline/file-I/O story, is unbuilt work.
- **Symmetry.** qrbeam's constraint that one deployed page is both roles is not
  something libcimbar addresses.

The honest framing: qrbeam's contribution is the *delivery vehicle and the UX*,
and libcimbar is proof the physical layer can be much better than QR. The plan
should treat its published numbers as the target to match, and its geometry and
calibration approach as the reference design.

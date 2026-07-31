# screenferry — Concept and Constraints

This note captures what screenferry *is*, the constraints that are non-negotiable, and
the naming rationale. It is written before the research lands, so it deliberately
contains no numbers — those live in `docs/research/` and get pulled into
`docs/plan/plan.md`.

## One-line definition

A static web app that transfers a file from one device to another over the
**screen-to-camera optical channel**.

Note the phrasing: the definition is the *channel*, not the *modulation*.
Animated QR codes are the obvious and safest way to modulate that channel, but
they are an implementation choice, not the point. QR spends its symbol budget on
things screenferry doesn't need — omnidirectional scanning from arbitrary angles,
robustness to print damage, a single-shot static payload — and it uses one bit
per module when the channel can carry several. If a denser scheme (colored
cells, a custom grid codec) survives a real camera pipeline, screenferry should use
it. See `docs/research/beyond-qr-optical-channels.md` and
`docs/research/custom-codec-engineering.md`.

The working assumption is a **layered design**: the file → chunking → erasure
coding → framing layers are all independent of how a frame is painted on screen.
The modulation layer sits behind a narrow interface (`encodeFrame(bytes) →
pixels`, `decodeFrame(pixels) → bytes`), so QR can ship first and a denser codec
can slot in later without touching the rest.

## The channel

The entire system is defined by one physical fact: **the only path between the
two devices is photons from one screen into one camera.**

Properties of that channel:

| Property | Consequence for the design |
|---|---|
| **Strictly unidirectional** | No ACKs. No retransmit requests. No handshake. The sender is broadcasting into the void. |
| **Lossy in bursts** | Autofocus hunting, motion blur, glare, hand shake, and the user glancing away all drop *runs* of consecutive frames, not isolated ones. |
| **Low bandwidth** | Bounded by (bytes per QR frame) × (frames the receiver can actually decode per second). Both factors are small. |
| **Clean when it works** | With per-frame error correction plus a checksum, a frame either decodes correctly or is discarded. There is no such thing as a *subtly corrupted* frame that we accept. The channel is therefore an **erasure** channel, not an error channel. |
| **Self-clocking is impossible** | The sender's display refresh and the receiver's camera exposure are not synchronized and cannot be. Frames will be torn by rolling shutter and duplicated or dropped by rate mismatch. |
| **Hostile signal processing in the path** | The camera ISP applies auto-exposure, auto white balance, gamma, denoise, and sharpening before we ever see a pixel. Any modulation denser than black-and-white has to survive all of it. |

The "erasure channel, not error channel" property is the single most important
one. It means screenferry does not need error *correction* at the application layer —
the modulation layer handles that per frame (QR's Reed–Solomon, or an equivalent
in a custom codec). What screenferry needs at the application layer is **erasure
recovery**, which is what fountain codes are for.

Keeping that boundary clean is what lets the modulation layer be swapped: any
scheme that delivers "here are N verified-correct bytes, or nothing" is a valid
physical layer for screenferry.

## Non-negotiable constraints

1. **No server.** Not "a server we don't use" — there must be no backend at all.
   The app is a bundle of static files. This is what makes the security claim
   auditable.
2. **No network dependency at runtime.** It must work fully offline, on a device
   in airplane mode. This implies a service worker / PWA, and ideally a
   single-file offline build a user can save forever.
3. **Both roles in one app.** The same deployed page can act as sender or
   receiver. No separate "sender app" and "receiver app" to keep in sync.
4. **Byte-exact reconstruction.** The received file must be bit-identical to the
   source. Verified by a whole-file hash carried in the stream. Silent corruption
   is worse than failure.
5. **Binary-safe end to end.** Arbitrary bytes, not text. This is a real trap —
   several popular QR decoders hand back a UTF-8 *string* and quietly mangle
   non-text input. The decoder choice is constrained by this.
6. **The modulation layer is replaceable.** Everything above it (chunking,
   erasure coding, framing, reassembly) must be written against a byte-in /
   byte-out interface, never against QR specifically.
7. **No back-channel assumed.** A bidirectional mode (receiver flashes ACKs back
   at a second camera) may be an *optional enhancement*, but the baseline must
   work with one screen and one camera.

## Explicit non-goals

- **Not a fast transfer tool.** If both devices are on the same network, use
  literally anything else. screenferry is for when they are not, or must not be.
- **Not an encryption tool** (v1). The threat model is "no network available",
  not "an adversary is filming the screen". Optional passphrase encryption is a
  plausible later addition, and would be genuinely useful — someone filming the
  screen is exactly the attack the optical channel is exposed to — but it is not
  the v1 problem.
- **Not a chat/streaming channel.** One file, one session, one direction.
- **Not paper-oriented.** Printing frames to paper (à la Optar/paperbak) is a
  different problem with different constraints. Live screen only.

## Naming

**screenferry** — it ferries files across the screen-to-camera gap. Plain-spoken
and unmistakable: no cleverness to explain, and it reads correctly aloud, which
matters for a URL someone has to read off another person's screen.

Deliberately **modulation-neutral**. The project was briefly named `qrbeam`, and
the research is why it isn't: QR turned out to be roughly the *worst* viable
option on this channel (~18.5 KB/s against a demonstrated ~106 KB/s), so a name
naming the format would have committed us in public to the thing we're trying to
move past. `screenferry` names the *channel and the job*, both of which are
fixed, rather than the encoding, which is not.

Renamed at 5 commits, before anything was deployed or linked. The GitHub
namespace was clear at the time of the check (zero repositories); `qrbeam` was
not — four repos shared it, one describing the same concept.

## Open questions for the plan

These get answered by the research and resolved in `docs/plan/plan.md`:

- **What modulation do we actually ship?** Plain QR, colour-channel-tripled QR
  (three QR codes stacked into R/G/B), or a custom grid codec. What does each
  really deliver handheld, and what is the risk of the denser options?
- What is the actual achievable goodput, in bytes/sec, on real hardware — not in
  a paper with a tripod?
- Which fountain coding scheme — and is there a trustworthy browser
  implementation, or do we write it?
- What does the receiver show the user, given the sender genuinely cannot know
  the receiver's progress?
- What is the largest file size the app should accept without warning, and at
  what size should it actively refuse?
- Can we test the optical loop in CI without two physical devices?
- Does the name survive the modulation decision?

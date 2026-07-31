# Fountain Codes and Wire Protocol for qrbeam

Research notes for the erasure-coding and framing layer of **qrbeam** — a static web app
that moves a file device-to-device over a strictly one-way optical channel (sender shows
animated QR codes, receiver's camera decodes them).

Channel properties that drive every decision below:

- **No back-channel.** The receiver cannot NAK, cannot request a chunk, cannot say "stop".
- **Lossy and bursty.** Focus hunting, motion blur, glare, the user pointing the phone away,
  and plain decoder misses. Realistic per-frame loss `p` is 0.1–0.5 depending on how steady
  the hands are and how aggressive the frame rate is.
- **Receiver may join at any time.** There is no "frame 1"; the receiver starts when the
  camera opens.

All simulation numbers in this document were produced locally (Monte Carlo, 60–2000 trials
per cell); the scripts are reproducible from the descriptions given inline.

---

## 1. The coupon-collector penalty

### 1.1 Formula

Broadcast `N` chunks round-robin forever. Frame `f` carries chunk `f mod N`. Each frame is
independently lost with probability `p`.

Think in **rounds** of `N` frames. A specific chunk is still missing after `k` rounds with
probability `p^k` (it was offered `k` times, missed every time). The number of rounds `R`
until *all* `N` chunks have been seen at least once satisfies

```
P(R ≤ k) = (1 − p^k)^N
```

so the expected number of rounds is

```
              ∞
E[R]  =  Σ   [ 1 − (1 − p^k)^N ]
            k=0
```

and the expected number of **frames displayed** is `≈ N · E[R]` (slightly less, because the
final round terminates part-way through).

The closed-form asymptotic is the classic coupon-collector `ln N` law, rescaled by how many
rounds it takes for one chunk to get through:

```
E[R]  ≈  ( ln N + γ ) / ln(1/p)  +  1/2          (γ ≈ 0.5772)
```

The `ln N` term is the whole problem: **the cost per chunk grows with the file size**, even
though the channel's loss rate is constant. A fountain code removes the `ln N` entirely.

### 1.2 Worked numbers

`E[frames]` and `p95` below are exact Monte Carlo (2000 trials for N ≤ 500, 200 for
N = 5000). "Fountain" is `N × 1.05 / (1 − p)` — a rateless code needing 5 % overhead.

| N | p | E[rounds] | **E[frames]** | p95 frames | Fountain frames | **Penalty** |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 0.1 | 2.44 | 108 | 156 | 58 | **1.85×** |
| 50 | 0.3 | 4.24 | 192 | 290 | 75 | **2.56×** |
| 50 | 0.5 | 6.99 | 332 | 509 | 105 | **3.16×** |
| 500 | 0.1 | 3.44 | 1 563 | 2 004 | 583 | **2.68×** |
| 500 | 0.3 | 6.14 | 2 870 | 3 866 | 750 | **3.83×** |
| 500 | 0.5 | 10.30 | 4 925 | 6 691 | 1 050 | **4.69×** |
| 5000 | 0.1 | 4.44 | 20 440 | 24 789 | 5 833 | **3.50×** |
| 5000 | 0.3 | 8.05 | 38 556 | 51 973 | 7 500 | **5.14×** |
| 5000 | 0.5 | 13.62 | 65 804 | 85 702 | 10 500 | **6.27×** |

### 1.3 Reading these numbers in wall-clock terms

Take a **630 KB file** at 1 260 payload bytes per frame → `N = 500`, displayed at **8 fps**,
with a middling `p = 0.3`:

| Scheme | Frames | Wall clock | 95th percentile |
|---|---:|---:|---:|
| Round-robin | 2 870 | **6 min 00 s** | **8 min 03 s** |
| Fountain (5 % overhead) | 750 | **1 min 34 s** | ~1 min 40 s |

The mean is bad; the **tail is worse and it is the tail users experience**. Round-robin's
p95/mean ratio is ~1.35 and grows with `p`, because finishing means waiting for the single
unluckiest chunk to come round again. A fountain code has an almost deterministic completion
time — its p99 overhead is within a few percent of its mean (measured: 1.04–1.11× at
N ≥ 100, see §2.5). That predictability is arguably worth more than the raw speedup: the
progress bar moves smoothly and monotonically instead of hanging at 99 %.

**Three structural wins, not one:**

1. **No `ln N` term.** Fountain cost is `N(1+ε)/(1−p)` — linear in N, flat in N per chunk.
   Round-robin cost per chunk grows without bound as the file grows.
2. **Loss-rate agnostic.** Round-robin's penalty *multiplies* as `p` rises; a rateless code
   just runs `1/(1−p)` longer. No parameter has to be guessed in advance — which matters
   enormously when there is no back-channel to measure `p` with.
3. **Free join-anywhere.** With round-robin the receiver must be told (or infer) where the
   loop starts. With a fountain code every frame is equally useful, so "point the camera at
   it" is the entire user interface.

---

## 2. Fountain / rateless code candidates

### 2.0 Terms

- **K** — number of source fragments (chunks) the payload is split into.
- **Overhead ε** — receiver decodes after `K(1+ε)` *received* symbols. Frames *sent* is
  `K(1+ε)/(1−p)`.
- **Peeling / belief-propagation decoder** — repeatedly find a received symbol of degree 1,
  use it to recover a fragment, XOR that fragment out of every other symbol. O(K·d̄). Cheap
  but stalls whenever no degree-1 symbol exists.
- **Inactivation / Gaussian-elimination decoder** — treat received symbols as rows of a
  linear system over GF(2) and solve it. Never stalls; decodes as soon as rank = K. Costs
  more arithmetic.

The single most important finding of this research is that **the choice of decoder matters
more than the choice of degree distribution**, and that the decoder everybody's LT
implementation ships (peeling) is the wrong one for qrbeam's small `K`.

### 2.1 LT codes (Luby, 2002) with robust soliton

Encode: pick a degree `d` from a distribution, pick `d` distinct source fragments uniformly,
XOR them. Repeat forever. Decode: peeling.

The **ideal soliton** distribution is `ρ(1) = 1/K`, `ρ(d) = 1/(d(d−1))` for `d ≥ 2`. It has
*expected* behaviour that is perfect and *actual* behaviour that is terrible — it produces
exactly one degree-1 symbol in expectation, so the peeling ripple dies constantly. The
**robust soliton** adds a spike `τ` around `K/R` with `R = c·ln(K/δ)·√K` to keep the ripple
alive; overhead is `O(√K · ln²(K/δ))` symbols, i.e. `ε → 0` only asymptotically.

Measured (peeling decoder, 400 trials/cell, `c = 0.03`, `δ = 0.5`):

| K | ideal soliton mean ε | ideal p99 | robust soliton mean ε | robust p99 |
|---:|---:|---:|---:|---:|
| 10 | **+71 %** | +370 % | **+62 %** | +280 % |
| 20 | **+77 %** | +370 % | **+57 %** | +205 % |
| 50 | **+67 %** | +402 % | **+44 %** | +194 % |
| 100 | **+69 %** | +337 % | **+33 %** | +116 % |
| 200 | **+65 %** | +321 % | **+26 %** | +105 % |
| 500 | **+65 %** | +273 % | **+19 %** | +50 % |
| 1000 | **+53 %** | +272 % | **+11 %** | +21 % |

**This is the "LT codes are poor for small N" result, quantified.** At K = 50 — a 63 KB file
at 1.26 KB/frame, an utterly typical qrbeam transfer — robust-soliton LT with a peeling
decoder needs **44 % more symbols than the file contains, on average**, and one run in a
hundred needs **nearly 3×**. Robust soliton only becomes respectable around K ≥ 1000, which
for qrbeam means a 1.3 MB file — the *upper* end of what anyone will sit through.

The `p99` column is the damning one. A 4× tail means "sometimes the transfer just doesn't
finish and the user gives up". qrbeam cannot afford that.

**Verdict on textbook LT: do not ship it as specified.** Keep the *encoder* (it is trivial),
throw away the *decoder*.

### 2.2 Raptor / RaptorQ (RFC 6330)

Raptor codes fix LT's overhead by pre-coding: apply a high-rate fixed erasure code (LDPC +
HDPC) to the source block first, then run a *weakened* LT code over the pre-coded symbols.
The pre-code mops up the fragments the LT layer fails to peel, so LT no longer has to reach
100 % on its own.

RaptorQ (RFC 6330) is the standardised, systematic, GF(256)-mixed version. Its recovery
guarantee is exceptional and is stated directly in the reference implementation's README
([cberner/raptorq](https://github.com/cberner/raptorq)):

> Reconstruction probability after receiving K + h packets = 1 − 1/256^(h + 1)

That is: **K symbols → 99.6 % decode. K+1 → 99.998 %. K+2 → 99.99999 %.** Overhead is
effectively `ε ≈ 0`. Nothing else in this document comes close. Decode is O(K) amortised
with inactivation decoding.

**Costs:**

- **Implementation difficulty in pure JS: very high.** RFC 6330 is ~60 pages of tables,
  including a hard-coded systematic-index table `J(K')`, 477 permitted block sizes `K'`,
  GF(256) arithmetic, and an LDPC/HDPC pre-code. Nobody should hand-write this. It is
  realistically a *wrap the Rust crate* proposition, not a *write it ourselves* one.
- **Licensing: improved but not perfectly clean.** Qualcomm (which acquired Digital Fountain
  in 2009) filed an IPR declaration for RFC 6330 with the IETF on 2015-03-19
  ([IPR #2554](https://datatracker.ietf.org/ipr/2554/)) listing US7,139,960; US7,451,377;
  US20090158114; EP1665539; US20110299629. The declaration is **not** a blanket royalty-free
  grant — it is two-tier:
  - *Wireless WAN devices*: licensed under Qualcomm's standard terms, no incremental royalty.
  - *Non-wireless devices*: **covenant not to assert** — "Qualcomm will not assert any such
    claim against any party for making, using, selling, importing or offering for sale such
    device" — limited to RFC 6330 implementation, with a defensive-termination carve-out.

  Separately, the foundational patent **US7,139,960 is now listed as expired**
  ([Google Patents](https://patents.google.com/patent/US7139960)), and the continuation
  US20110299629 (filed 2011) runs to ~2031. So: the core Raptor idea is out of patent, the
  RaptorQ-specific continuations are not, and there is a covenant covering exactly our use
  case. **Risk is low but non-zero**, and it is the kind of footnote that makes a
  general-audience open-source project awkward to explain.
- **Bundle cost:** see §3 — 240 KB of WASM (134 KB gzipped).

**Verdict: technically the best code, wrong cost/benefit for qrbeam.** We are paying 134 KB
of gzipped WASM plus a patent footnote to buy back ~2–3 % of overhead versus the scheme
recommended in §7. On a 500-frame transfer that is ~15 frames — under two seconds.

### 2.3 Online codes (Maymounkov, 2002)

Two-layer like Raptor, but both layers are simple XOR and both are rateless-friendly. An
*outer* encoding attaches each message block to ~`0.55·q·ε·n` auxiliary blocks (each
auxiliary block = XOR of its attached message blocks); an *inner* encoding emits check blocks
whose degree comes from a distribution parameterised by `ε` and `F`. With suggested
parameters `q = 3`, `ε = 0.01`, the message decodes from `(1 + 3ε)n` check blocks with
failure probability `(ε/2)^(q+1)`
([Wikipedia: Online codes](https://en.wikipedia.org/wiki/Online_codes)).

**Assessment for qrbeam:** Online codes are *nicer to implement than Raptor and no harder
than LT*, and they are unencumbered (Maymounkov published academically; no assignee ever
pursued the classic Raptor claims against them). But:

- The `(1+3ε)n` guarantee is **asymptotic in n**. The auxiliary-block layer costs `0.55qεn`
  extra blocks up front — at `ε = 0.01, q = 3` that is 1.65 % of n, but the *constants* in
  the failure analysis only bite for large n. At K = 50–500 you are back in the same
  small-block regime that hurts LT, and the parameters need retuning per K with no published
  small-K tables.
- There is **no maintained JS implementation** to lean on.
- Its main advantage over a GE decoder — O(K) rather than O(K²)-ish decode — is irrelevant at
  our K.

**Verdict: no reason to prefer it over §7's scheme.** Strictly more moving parts (two layers,
two parameter sets) for no measurable win at our block sizes.

### 2.4 XOR interleaving and block-wise Reed–Solomon

The low-complexity alternative: forget rateless codes, pick a fixed rate.

**Reed–Solomon over GF(256)** is *MDS* — RS(n, k) recovers from **exactly** k received
symbols out of n, which is information-theoretically optimal (ε = 0 *exactly*, better than
RaptorQ's probabilistic guarantee). Implementations are small (log/antilog tables, ~200 lines)
and well understood.

It is nonetheless **the wrong tool here, for one decisive reason: it is not rateless.**

- GF(256) caps a codeword at `n ≤ 255` symbols. To tolerate `p = 0.5` you need `n ≥ 2k`, so
  `k ≤ 127` per block. Files larger than ~160 KB need interleaved blocks, and now a bad burst
  that lands on one block kills the transfer while the others sit fully decoded.
- **You must commit to a rate before transmitting, with no back-channel to inform the
  choice.** Guess `p = 0.3` and hit `p = 0.6` and the transfer *never completes* — the sender
  runs out of repair symbols and the receiver stalls forever. Guess `p = 0.6` and hit
  `p = 0.1` and you waste 50 % of the airtime. There is no recovery from a wrong guess except
  restarting the whole transfer with different parameters, which is exactly the failure mode
  qrbeam exists to eliminate.
- Simple **XOR interleaving** (parity every k-th frame, RAID-5 style) is worse still: it
  survives one loss per group and nothing more. Bursty camera loss routinely kills two
  adjacent frames.

**Verdict: reject.** Ratelessness is not a nice-to-have on a channel with no feedback; it is
the entire requirement. RS's optimal-ε is worthless if the rate is wrong, and the rate is
always wrong.

### 2.5 The finding that changes the answer: swap the decoder

Everything in §2.1 assumed a **peeling** decoder, because that is what LT means in practice
and what every LT library ships. But at qrbeam's block sizes we can afford to just *solve the
linear system* — the received symbols are rows over GF(2), and Gaussian elimination decodes
the instant the matrix reaches rank K, which is the information-theoretic optimum for that
matrix.

Same simulation, same degree distributions, **full GF(2) Gaussian elimination** instead of
peeling. "harmonic" is `Pr(d) ∝ 1/d`, the distribution BC-UR uses (§4.4):

| K | dist | peeling mean ε | **GE mean ε** | **GE p99 ε** |
|---:|---|---:|---:|---:|
| 10 | ideal soliton | +71 % | **+26 %** | +120 % |
| 10 | harmonic | +56 % | **+30 %** | +140 % |
| 50 | robust soliton | +44 % | **+14 %** | +74 % |
| 50 | harmonic | +89 % | **+6.7 %** | +20 % |
| 100 | robust soliton | +33 % | **+6.6 %** | +30 % |
| 100 | harmonic | +108 % | **+3.9 %** | +10 % |
| 200 | harmonic | +127 % | **+2.5 %** | +6.5 % |
| 500 | harmonic | +156 % | **+1.5 %** | +3.0 % |
| 1000 | harmonic | +181 % | **+1.2 %** | +2.2 % |

Two things jump out:

1. **Gaussian elimination is transformative.** At K = 100 the harmonic distribution goes from
   *+108 % overhead with peeling* to *+3.9 % with GE* — a 2× end-to-end speedup from changing
   nothing but the decoder. At K ≥ 200 the overhead is within a few percent of RaptorQ's,
   for ~80 lines of bit-twiddling and zero patent surface.
2. **The best distribution depends on the decoder, and they are opposites.** Robust soliton
   is *designed* for peeling and is mediocre under GE (it deliberately emits many degree-1
   symbols, which are linearly redundant). The harmonic distribution is *terrible* for
   peeling (and gets worse as K grows: +181 % at K = 1000) but is **excellent** under GE.
   Anyone benchmarking a fountain code must state which decoder they used; the rankings
   invert.

This reframes the entire decision. The question is no longer "which fountain code" — it is
"**which degree distribution feeds a GE decoder best, and can we afford GE?**"

### 2.6 Can we afford Gaussian elimination? Bounding the cost

GE over GF(2) with K unknowns is O(K³/w) word-operations on the coefficient matrix (`w = 32`
with `Uint32Array`), plus O(K²) XORs of `fragLen`-byte payloads. The **payload XORs dominate**.

Measured total row-XOR count (forward elimination + back-substitution), and the resulting
average encoder degree:

| K | distribution | mean ε | p99 ε | row-XORs / K | avg degree |
|---:|---|---:|---:|---:|---:|
| 100 | harmonic (uncapped) | +4.2 % | +11 % | 38 | 19.3 |
| 100 | harmonic, **d ≤ 64** | +4.5 % | +11 % | 36 | 13.2 |
| 100 | harmonic, d ≤ 32 | +6.4 % | +23 % | 31 | 7.8 |
| 100 | harmonic, d ≤ 16 | +19 % | +75 % | 25 | 4.7 |
| 300 | harmonic (uncapped) | +2.1 % | +5.0 % | 120 | 47.7 |
| 300 | harmonic, **d ≤ 64** | +3.3 % | +6.3 % | 99 | 13.6 |
| 300 | harmonic, d ≤ 16 | +34 % | +132 % | 65 | 4.7 |
| 1000 | harmonic (uncapped) | +1.2 % | +1.9 % | 415 | 132.7 |
| 1000 | harmonic, **d ≤ 64** | +3.0 % | +4.1 % | 310 | 13.4 |
| 1000 | harmonic, d ≤ 32 | +8.1 % | +43 % | 254 | 7.9 |
| 1000 | uniform, d ≤ 32 | **+0.2 %** | **+0.5 %** | 398 | 16.4 |

Concrete cost at the worst realistic case (**K = 1000**, i.e. a 1.26 MB file at 1 260 B
fragments, harmonic capped at d ≤ 64):

- **Encoder, per frame:** 13.4 × 1 260 B ≈ **17 KB of XOR**. At 10 fps that is 170 KB/s.
  Nothing. (Uncapped it would be 133 × 1 260 = 167 KB/frame, 1.7 MB/s — still fine, but 10×
  more work on a sender that is often a phone. **This is the argument for the d ≤ 64 cap.**)
- **Decoder, total:** 310 × 1000 = 310 000 row-XORs × 1 260 B ≈ **390 MB of byte-XOR**, which
  as `Uint32Array` word ops is ~98 M operations — **a few hundred milliseconds spread across
  the entire multi-minute transfer**, not a single stall.
- **Decoder, per frame (worst case):** one arriving frame is reduced against at most `rank`
  pivot rows → ≤ 1000 × 1 260 B = 1.26 MB of XOR. At 10 fps, 12.6 MB/s worst case. Comfortably
  real-time in a Web Worker; typical cost is far lower.
- **Matrix memory:** K × ⌈K/32⌉ words = 1000 × 32 × 4 B = **128 KB**. Payloads are 1.26 MB.
  Trivial.

**Cost scales as K², so it must be bounded.** At K = 4000 the decode work is ~16× that of
K = 1000 (~6 GB of XOR) — too slow. Mitigation, in preference order:

1. **Raise `fragLen`** (bigger QR version) — K falls linearly, work falls quadratically.
2. **Compress** (§6) — same effect.
3. **Source-block partitioning** above K ≈ 1500: split into `B` blocks of ≤ 1500 fragments,
   fountain-code each independently, round-robin the block index across frames (the header
   in §7.2 reserves 4 bits for this). Decode work drops from O(K²) to O(K²/B). This is
   exactly what RFC 6330 does and for exactly this reason.

With `fragLen = 1260` and deflate, K ≈ 1500 corresponds to a ~1.9 MB file — which at
realistic optical throughput (§5.3) takes over four minutes to transmit anyway. **Single-block
GE covers every transfer a human will actually sit through**; partitioning is an escape hatch.

---

## 3. Existing implementations (JS / TS / WASM)

All figures below were obtained by downloading the published tarballs from the npm registry
and measuring, not from documentation.

### 3.1 `raptorq` — npm 1.7.24 — **a real wasm-bindgen build of the Rust crate**

The Rust crate [cberner/raptorq](https://github.com/cberner/raptorq) (389 ★, Apache-2.0,
actively maintained — last push 2026-06) **publishes a WASM build to npm**, which the search
results did not surface but the registry confirms.

| Property | Value |
|---|---|
| Version / license | 1.7.24 (published 2023-06-20) / **Apache-2.0** |
| Contents | `raptorq_bg.wasm`, `raptorq.js`, `raptorq.d.ts` — nothing else |
| WASM size | **240 516 B raw / 134 387 B gzipped** |
| Dependencies | **none** |
| Browser-usable | **Yes** — wasm-bindgen with `init(module_or_path)` + `initSync()` |

API (from the shipped `raptorq.d.ts`):

```ts
Encoder.with_defaults(data: Uint8Array, maximum_transmission_unit: number): Encoder
encoder.encode(repair_packets_per_block: number): Uint8Array[]
Decoder.with_defaults(transfer_length: bigint, maximum_transmission_unit: number): Decoder
decoder.decode(packet: Uint8Array): Uint8Array | undefined
EncodingPacket.deserialize(data) → .source_block_number() / .encoding_symbol_id() / .data()
```

**Caveat that matters for qrbeam:** `encode(repair_packets_per_block)` returns a **finite
array** of packets — it is a batch API, not an infinite generator. Truly endless streaming
requires either generating a large batch up front and looping it (which reintroduces a
coupon-collector effect, just a much weaker one) or patching the crate. Also, the npm build
lags the crate (npm 1.7.24 from 2023 vs. crate activity in 2026).

### 3.2 `luby-transform` — npm 0.2.0 — from the **qifi-dev/qrs** project

This is the most directly relevant existing library: it was extracted from
[qifi-dev/qrs](https://github.com/qifi-dev/qrs) (1 621 ★, MIT, TypeScript), *a QR-code file
streaming app* — i.e. someone has already built roughly qrbeam and open-sourced the codec.

| Property | Value |
|---|---|
| Version / license | 0.2.0 (2025-02-03) / **MIT** |
| Size | 11 366 B ESM, **2 977 B gzipped** — genuinely tiny |
| Dependencies | `pako` (adds ~45 KB gzipped — avoidable, see §6) |
| Browser-usable | Yes, pure ESM `Uint8Array` in / out |

API: `createEncoder(data, sliceSize, compress=true)` → `encoder.fountain()` is an **infinite
generator** — exactly the right shape for animated QR. `createDecoder()` / `addBlock()` /
`getDecoded()`.

**Three design flaws that rule it out as-is:**

1. **Ideal soliton, not robust soliton.** From the shipped `dist/index.mjs`:
   ```js
   probabilities[0] = 1 / k;
   for (let d = 2; d <= k; d++) probabilities[d - 1] = 1 / (d * (d - 1));
   ```
   That is textbook ideal soliton — the distribution that is *known* to fail in practice
   (§2.1, +67 % mean / +400 % p99 at K = 50).
2. **It transmits the fragment indices explicitly, at 4 bytes each.**
   ```js
   const header = new Uint32Array([indices.length, ...indices, k, bytes, checksum]);
   ```
   Header size is `4 × (degree + 4)` bytes. With ideal soliton the mean degree is ~`ln K`;
   at K = 500 that is ~6, so ~40 header bytes per frame — and high-degree symbols cost far
   more. BC-UR's PRNG-derived index selection (§4.4) achieves the same thing in **zero**
   bytes. This is a 3–10 % airtime tax for nothing.
3. **The decoder is a subset-reduction peeler**, not GE — so it inherits the §2.5 penalty.

**Verdict: excellent reference implementation to read, wrong on all three axes to depend on.**
Its `LtDecoder.propagateDecoded` subset-reduction logic is however a genuinely clever
peeling+ variant and worth studying.

### 3.3 `@ngraveio/bc-ur` — npm 1.1.13 — the BC-UR reference JS implementation

| Property | Value |
|---|---|
| Version / license | 1.1.13 (2026-02-20) / **MIT** |
| Repo | [ngraveio/bc-ur](https://github.com/ngraveio/bc-ur) — TypeScript, actively maintained |
| Size | 176 KB `dist/` (64 KB of JS) + 7 runtime deps |
| Dependencies | `crc`, `jsbi`, `assert`, `sha.js`, `cbor-sync`, `bignumber.js`, `@keystonehq/alias-sampling` |
| Browser-usable | Yes, but the dep tree (`assert`, `Buffer`, `jsbi`, `bignumber.js`) is Node-flavoured and needs polyfills/bundler shims |

The dependency list is the problem: `bignumber.js` + `jsbi` + `sha.js` + `assert` for what is
fundamentally 200 lines of XOR is a poor trade for a static app whose selling point is that it
is a single self-contained page. Ships source in `src/` though, so the fountain layer
(`fountainUtils.ts`, `fountainEncoder.ts`, `fountainDecoder.ts`, `xoshiro.ts`) is easy to
lift. **Read it; don't depend on it.**

### 3.4 `bbqr` — npm 1.2.0

| Property | Value |
|---|---|
| Version | 1.2.0 (2025-04-10) |
| License | **No `license` field in `package.json`**; GitHub reports `NOASSERTION`. Needs legal review before use. |
| Size | 240 987 B ESM / 154 288 B IIFE — large, because `consts.d.ts` alone is 30 KB of QR capacity tables |
| Dependencies | none |

API: `splitQRs(input, fileType, {encoding, minSplit, maxSplit, minVersion, maxVersion})` /
`joinQRs()`. **No fountain code** (§4.5). Its *QR-version-selection* logic — pick the smallest
version that fits the split — is the genuinely reusable idea here.

### 3.5 `wirehair` — C++ with a WASM port

[catid/wirehair](https://github.com/catid/wirehair) (389 ★, **BSD-3-Clause**, pushed
2026-07-31) is an O(N) fountain code for large data — faster asymptotically than RaptorQ's
O(N log N)-ish behaviour and explicitly designed for big blocks. A WASM build exists at
[kig/wirehair-wasm](https://github.com/kig/wirehair-wasm), building `wirehair_core.mjs` via
Emscripten.

**Not viable for qrbeam:** the WASM port is **not published to npm** (`wirehair` is not a
registered package), so it must be built from source with Emscripten in CI — a heavy toolchain
dependency for a static site. Wirehair is also optimised for N in the tens of thousands; at
K ≈ 100–1000 its advantage over plain GE evaporates while its complexity does not.

### 3.6 `fountain-js`

**Not a fountain code.** npm `fountain-js` is a parser for *Fountain*, the screenplay markup
language. Named in the task brief; ruled out here so nobody re-checks it.

### 3.7 Summary

| Library | License | gzip size | Rateless stream | Decoder | Verdict |
|---|---|---:|---|---|---|
| `raptorq` (wasm) | Apache-2.0 | 134 KB | batch only | inactivation | Best code, worst bundle |
| `luby-transform` | MIT | **3 KB** | ✅ infinite gen | peeling | Read it, don't use it |
| `@ngraveio/bc-ur` | MIT | ~25 KB + 7 deps | ✅ infinite | subset-reduction | Read it, don't use it |
| `bbqr` | ⚠️ NOASSERTION | ~50 KB | ❌ no FEC | n/a | QR-version logic only |
| `wirehair-wasm` | BSD-3 | not published | ✅ | inactivation | Needs Emscripten in CI |

**Nothing on this list is both small and correctly decoded.** That, plus §2.5, is the case
for implementing it ourselves.

---

## 4. Prior art

### 4.1 TXQR (divan) — the one with real measurements

[divan/txqr](https://github.com/divan/txqr) (3 157 ★, MIT, Go) is the best-documented
animated-QR transfer, with two blog posts of actual benchmark data. It uses
`google/gofountain` (LT codes).

**Baseline, non-fountain** ([Animated QR data transfer with Gomobile and
Gopherjs](https://divan.dev/posts/animatedqr/)) — 13 KB payload, swept 3–12 fps, 100–1000 B
chunks, all four ECC levels:

- **Best case: 1.4 s ≈ 9 KB/s** at 11 fps / 850 B chunks / ECC Medium — but *unstable*,
  because a missed frame forces a full loop wait and often a timeout.
- **Optimal fps ≈ 6–7** (~150 ms/frame). Higher fps did *not* help; the phone camera and
  decoder, not the display, are the bottleneck.
- **Optimal chunk size ≈ 550–900 B.** Below that, per-frame header overhead dominates; at
  1000 B, "almost guaranteed miss of frames and timeout".
- **Optimal ECC = Low (7 %).** Counter-intuitive but consistent: lower ECC → smaller/sparser
  QR → faster and more reliable camera decode. **The QR code's own error correction is the
  wrong place to spend redundancy; spend it in the fountain layer instead.**
- **Realistic expectation: 1–2 KB/s**, not the 9 KB/s peak.

**With fountain codes** ([Fountain codes and animated QR](https://divan.dev/posts/fountaincodes/)):

- **Record: ~13 KB in 501 ms** at 12 fps with **1 850 B** per QR code.
- Optimal chunk size moved *up* to **1 800–2 000 B** (from 550–900 B). Once missed frames stop
  being catastrophic you can afford denser QR codes and a worse per-frame decode rate.
- Usable fps ceiling rose from ~7 to **15**.
- **"The variance of the time needed to decode plummeted significantly as there were no
  'expect the whole loop iteration' part."** — independent confirmation of §1.3: the tail
  improvement is the real prize.
- Practical approach: generate `N × redundancyFactor` frames assuming ~20 % loss and loop
  them, trading strict ratelessness for API stability.

*Caveat on secondary sources:* a search result attributed "129+ KB/s, ~30× prior art" to txqr.
That number appears in an AI-generated aggregator blog and is **not** in divan's primary
posts, which state 501 ms for ~13 KB (≈ 26 KB/s peak, 1–2 KB/s typical). Use the primary
figures.

**Lessons for qrbeam:** (a) 6–15 fps, not 30; (b) ECC Low; (c) fountain coding *raises* the
optimal chunk size, so tune density after the codec is in place, not before; (d) variance
reduction is the headline benefit.

### 4.2 BC-UR / Multipart UR (Blockchain Commons) — **the most relevant prior art**

The animated-QR standard used across the hardware-wallet industry (Keystone, NGRAVE, Foundation
Passport, Sparrow, Gordian). Specs:

- [BCR-2020-005: Uniform Resources](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md)
- [BCR-2024-001: Multipart UR (MUR) Implementation Guide](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2024-001-multipart-ur.md)
- [Animated QRs — Developer Resources](https://developer.blockchaincommons.com/animated-qrs/)

**Architecture.** Hybrid **fixed-rate prefix + rateless tail**. Parts are numbered from 1.
Parts with `seqNum ≤ seqLen` are *pure* fragments (systematic); parts with `seqNum > seqLen`
are XOR mixes. So a clean single pass decodes with zero overhead and zero linear algebra, and
the fountain tail is there to repair losses.

**Part structure** (CDDL from BCR-2024-001):

```
part = [
    uint32 seqNum,
    uint   seqLen,
    uint   messageLen,
    uint32 checksum,
    bytes  data
]
```

CBOR-encoded, then Bytewords-encoded, then wrapped as `ur:<type>/<seqNum>-<seqLen>/<fragment>`.

**The key idea qrbeam should steal — zero-byte index transmission.** From the shipped
`src/fountainUtils.ts` of `@ngraveio/bc-ur@1.1.13`:

```ts
export const chooseFragments = (seqNum, seqLength, checksum) => {
  if (seqNum <= seqLength) {
    return [seqNum - 1];               // systematic prefix
  } else {
    const seed = Buffer.concat([intToBytes(seqNum), intToBytes(checksum)]);
    const rng = new Xoshiro(seed);     // Xoshiro256**, seeded SHA256(seqNum‖checksum)
    const degree = chooseDegree(seqLength, rng);
    const indexes = [...new Array(seqLength)].map((_, i) => i);
    return shuffle(indexes, rng).slice(0, degree);
  }
}
```

Because both sides derive the index set from `(seqNum, checksum)` alone, **the wire carries no
index list**. Contrast `luby-transform`'s 4-bytes-per-index (§3.2). The `checksum` field is
beautifully overloaded: it is simultaneously the **PRNG seed**, the **session discriminator**
(two different messages produce different mixes, so parts can't be cross-contaminated), and
the **final integrity check**. qrbeam should copy this trick verbatim.

**Degree distribution** — plain harmonic, `Pr(d) ∝ 1/d`, sampled via Walker–Vose alias:

```ts
const degreeProbabilities = [...new Array(seqLenth)].map((_, i) => 1 / (i + 1));
```

**Decoder** (`src/fountainDecoder.ts`): *subset reduction*, not full GE. A new mixed part is
reduced by every stored simple part and every stored mixed part whose index set is a strict
subset (`reducePartByPart`), and conversely every stored part is reduced by the new one. This
is stronger than pure peeling but weaker than Gaussian elimination.

**Measured cost of that decoder choice.** Simulating BC-UR exactly (harmonic + systematic
prefix + subset reduction) against a GE decoder on the identical symbol stream, over a channel
with per-frame loss `p`:

| K | p | BC-UR ε | BC-UR frames sent | GE ε (non-systematic) | GE frames sent | **GE speedup** |
|---:|---:|---:|---:|---:|---:|---:|
| 50 | 0.1 | +16 % | 65 | +6.9 % | 59 | 1.09× |
| 50 | 0.5 | +38 % | 137 | +6.2 % | 106 | **1.29×** |
| 100 | 0.3 | +32 % | 189 | +4.0 % | 149 | **1.27×** |
| 100 | 0.5 | +54 % | 308 | +4.1 % | 208 | **1.48×** |
| 300 | 0.3 | +44 % | 618 | +2.1 % | 441 | **1.40×** |
| 300 | 0.5 | +73 % | 1 036 | +2.1 % | 617 | **1.68×** |

(Round-robin for the same K=300, p=0.5 case: 2 699 frames. So BC-UR is 2.6× better than naive,
and GE is 4.4× better.)

**Two independent findings here:**

1. **BC-UR's decoder leaves 30–70 % on the table at high loss**, and the gap *widens* with
   both K and p — precisely the conditions a phone camera creates. Anyone implementing BC-UR
   can get a large speedup, wire-format-compatible, by swapping the decoder for GE.
2. **The systematic prefix is a net loss on a lossy channel.** Non-systematic GE beat
   systematic GE in every cell (e.g. K=100, p=0.5: +4.1 % vs +11.8 %). Reason: after a lossy
   first pass, the receiver is missing a specific `p·K`-dimensional subspace, and a low-degree
   tail symbol restricted to that subspace is the zero vector with probability ~`2^-d` — a
   degree-1 tail symbol is wasted half the time at p = 0.5. Non-systematic symbols carry
   information about the whole space from frame one. The systematic prefix only pays off when
   loss is near zero, which never happens with a handheld camera.

**Verdict: BC-UR's *framing* is the right model (PRNG-derived indices, checksum-as-session-id,
harmonic degrees). Its *decoder* and its *systematic prefix* are both worth discarding.**

### 4.3 BBQr (Coinkite) — the deliberate non-fountain design

[bbqr.org](https://bbqr.org/BBQr.html) / [coinkite/BBQr](https://github.com/coinkite/BBQr).
The competing Bitcoin animated-QR format, shipped on COLDCARD.

**8-character ASCII header, `B$` + 6 fields**, chosen to sit in QR *alphanumeric* mode:

| Chars | Field | Values |
|---|---|---|
| 1–2 | Magic | `B$` |
| 3 | Encoding | `H` = hex, `2` = Base32, `Z` = zlib+Base32 |
| 4 | File type | `P` PSBT, `T` txn, `J` JSON, `C` CBOR, `U` UTF-8, `B` binary, `X` executable |
| 5–6 | Total parts | base-36, `00`–`ZZ` (1–1295) |
| 7–8 | Part index | base-36, `00`–`ZZ` |

- Zlib with `wbits=10`, level 9, **compressed as a whole before splitting**. Ratios 4–58 %
  depending on entropy; the encoder tries `Z` and falls back to `2` if compression didn't help
  — a nice runtime heuristic worth copying (§6).
- **No fountain code — all N parts must be scanned.** Order-independent, but the full
  coupon-collector penalty applies.
- **No protocol-level checksum**: "QR error correction suffices."
- Max ~2.78 MB (hex) / ~3.47 MB (Base32).

**BC-UR vs BBQr:**

| | BC-UR | BBQr |
|---|---|---|
| Loss handling | LT fountain, rateless | none — rescan until complete |
| Header | CBOR, binary, ~10–15 B | 8 ASCII chars |
| Encoding | Bytewords (alphanumeric) | Base32 / hex (alphanumeric) |
| Compression | none in spec | zlib, with fallback |
| Integrity | CRC-32 whole message | none |
| Max size | unbounded | ~3.5 MB |
| Complexity | high | very low |

BBQr's argument is that for a 2–5 part PSBT the fountain machinery is not worth it — and at
K = 3 they are right (§1: at N = 50 the penalty is only 1.85×; at N = 3 it is negligible).
**qrbeam's regime is K = 50–1500, where the argument inverts completely.** BBQr's transferable
lessons are its compression-with-fallback heuristic and its QR-version auto-selection, not its
FEC stance.

### 4.4 Optar and PaperBak

Paper-oriented, but the coding lessons carry: both face a *one-way, no-retransmit* channel.

- [Twibright Optar](http://ronja.twibright.com/optar/): **200 KB per A4 page**, Golay(23,12)
  — 3-of-12 bit redundancy. Needs 600 dpi print + 600 dpi scan.
- **PaperBak**: theoretical **500 KB per A4**, configurable Reed–Solomon. Windows-only and
  [reportedly unusable in practice due to alignment issues](https://blog.za3k.com/paper-archival).
- **QR codes for comparison: only ~70–100 KB per A4** — QR pays heavily for its finder
  patterns, quiet zones, and fixed RS.

Both chose *fixed-rate* codes because paper is a fixed-size medium — you know exactly how much
redundancy you can afford. **That is the opposite of qrbeam's situation** (unbounded time
budget, unknown loss rate), which is precisely why they chose RS/Golay and we should not.

### 4.5 qrstream, QRFileTransfer, and the "qr-filetransfer" false friends

**Important disambiguation:** most GitHub projects named `qr-filetransfer`
([svenkatreddy](https://github.com/svenkatreddy/qr-filetransfer),
[mattn](https://github.com/mattn/qr-filetransfer)) are **not optical transfer at all** — they
run a local HTTP server and put the *URL* in a QR code. The bytes go over WiFi. Not prior art.

Genuine optical projects:

- [xloem/qrstream](https://github.com/xloem/qrstream) — Android, splits data across successive
  QR codes. No fountain code.
- [LucaIaco/QRFileTransfer](https://github.com/LucaIaco/QRFileTransfer) — vanilla JS/HTML/CSS,
  camera-to-camera, closest existing thing to qrbeam architecturally.
- [ganlvtech/qrcode-file-transfer](https://github.com/ganlvtech/qrcode-file-transfer) —
  screen + webcam.
- [mohankumarelec/airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer)
  — Vue + `pako` + `qrcode.js` + **`zbar-wasm`**. The `zbar-wasm` choice is a useful data
  point for qrbeam's *decode* side (§7.5): it generally outperforms `jsQR` on blurry frames.
- [qifi-dev/qrs](https://github.com/qifi-dev/qrs) — 1 621 ★, the most polished, and the source
  of `luby-transform` (§3.2). **Closest existing project to qrbeam.**

None publish throughput benchmarks; divan's remain the only rigorous numbers.

### 4.6 Magic Wormhole / croc — why their chunking doesn't transfer

Both are network transports: a rendezvous server plus PAKE (SPAKE2) key agreement, with the
short human code carrying only the *pairing secret*, never the data. They have a full
bidirectional TCP/WebSocket channel with retransmit, so their "chunking" is just streaming with
back-pressure — nothing to port.

**What *is* worth stealing** is the human-factors idea: a short, memorable session code that
lets the receiver confirm it is talking to the right sender. qrbeam's 32-bit `streamId` (§7.2)
can be rendered as a 4-word or 6-character code on both screens so the user can visually confirm
the pairing — valuable when two people are beaming files in the same room, where a stray QR from
someone else's screen could otherwise enter the camera's field of view.

---

## 5. Wire protocol and frame header design

### 5.1 What each frame must carry

Every frame must be independently interpretable — the receiver may see its first frame at any
point. Required, in order of necessity:

1. **Magic + version** — reject foreign QR codes (URLs, WiFi configs, other apps' frames)
   before they poison the decoder, and allow future format changes.
2. **Session ID** — bind frames to one transfer. Without it, a sender who restarts mid-stream
   silently corrupts the receiver's linear system. BC-UR's insight: **make this the payload's
   CRC-32**, so one field is session ID + PRNG seed + final integrity check.
3. **Total payload length** — to size the fragment array, compute `K`, and trim the final
   fragment's zero padding.
4. **Sequence number** — the fountain seed. With (2) it deterministically derives the index
   set, so **no index list is transmitted**.
5. **Compression flag** — the receiver must know whether to inflate.
6. **Per-frame integrity** — see §5.2.

Deliberately **not** in the header:

- **`K` / fragment count** — derivable as `K = ceil(payloadLen / fragLen)` where
  `fragLen = frameByteLength − HEADER_LEN` is directly observable, since every fountain symbol
  is exactly `fragLen` bytes. Saves 2 bytes/frame at the cost of one invariant: *`fragLen` must
  be constant for the lifetime of a stream* (no adaptive QR-version switching mid-transfer).
  BC-UR spends 1–2 bytes on explicit `seqLen`; we don't need to.
- **Filename / MIME / mtime** — these belong *inside* the payload (§5.4). Repeating a 40-byte
  filename in every frame would cost 3 % of airtime forever.

### 5.2 Per-frame checksum: yes, 1 byte

BBQr says "QR error correction suffices". For BBQr that is defensible; **for a fountain code it
is not.** With plain chunking, a corrupted frame damages one chunk and rescanning fixes it. With
a fountain code, a frame whose *header* is corrupted contributes a **wrong linear equation** to
the system. GE still reaches rank K and still produces an answer — a wrong one — detected only
by the final CRC-32, at which point the entire multi-minute transfer must be discarded and
restarted with no diagnostic.

QR's own Reed–Solomon usually reports failure rather than mis-correcting, but undetected
mis-correction is possible, especially at ECC level Low — which §4.1 says we want. A **1-byte
CRC-8 over the whole frame** catches 255/256 of corruptions for **0.08 %** of a 1 260-byte
frame. Cheap insurance against a catastrophic, undiagnosable failure. (Upgrade to CRC-16 if
field testing shows mis-corrections; cost rises to 0.16 %.)

### 5.3 Payload budget

QR byte-mode capacities ([thonky.com](https://www.thonky.com/qr-code-tutorial/character-capacities)),
with qrbeam's 13-byte header (§7.2) deducted, at the ECC-Low level §4.1 recommends:

| Version | Modules | Byte cap (L) | Payload after header | Header cost |
|---:|---:|---:|---:|---:|
| 15 | 77² | 520 | 507 | 2.5 % |
| 20 | 97² | 858 | 845 | 1.5 % |
| 25 | 117² | 1 273 | 1 260 | **1.0 %** |
| 30 | 137² | 1 732 | 1 719 | 0.8 % |
| 40 | 177² | 2 953 | 2 940 | 0.4 % |

Estimated goodput, `p = 0.25`, fountain overhead 1.05:

```
goodput = fragLen × fps × (1 − p) / 1.05
```

| Config | Goodput | 1 MB file |
|---|---:|---:|
| V20-L @ 12 fps | 7.2 KB/s | ~2 min 20 s |
| V25-L @ 8 fps | 7.2 KB/s | ~2 min 20 s |
| V30-L @ 8 fps | 9.8 KB/s | ~1 min 45 s |
| V40-L @ 6 fps | 12.6 KB/s | ~1 min 20 s |

Consistent with divan's 1–9 KB/s (§4.1). **The honest expectation to set in the UI is
5–10 KB/s.** Higher QR versions look better on paper but decode worse on real cameras — V25–V30
is the sweet spot to start from, tuned empirically per §4.1's finding that fountain coding
raises the optimal density.

### 5.4 Payload container

The header stays minimal because metadata lives in the payload:

```
container := varint(metaLen) ‖ meta ‖ fileBytes
payload   := compress(container)       // or container verbatim if compression didn't help
streamId  := crc32(payload)
```

`meta` is a small CBOR/JSON map: `{n: filename, t: mimeType, m: mtime}`. Compressing the
container as a whole (rather than the file alone) means the filename compresses too, and there
is exactly one compression boundary to reason about.

*Optional refinement:* the receiver cannot show the filename until the transfer completes. If
that matters, interleave a **beacon frame** — same header, a distinct `magic_ver` low nibble —
carrying plaintext metadata every ~30 frames, for ~3 % airtime. Recommended as a later
enhancement, not in v1.

### 5.5 PRNG and index selection — must be bit-exact

Sender and receiver derive the same index set from `(streamId, seq)`. Any divergence
(floating-point, integer overflow, sign extension) silently corrupts the linear system.

- Use **integer-only** PRNG arithmetic: `Math.imul` and `>>> 0` everywhere, never `Number`
  multiplication. `xoshiro128**` or `splitmix32` is sufficient; BC-UR's `SHA256(seqNum‖checksum)`
  → `Xoshiro256**` works but drags in a SHA implementation and BigInt for no benefit.
- Seed: `s = splitmix32(streamId ^ splitmix32(seq))`, then discard the first few outputs.
- Index selection: **partial Fisher–Yates** — `d` swaps against a sparse `Map` of displaced
  entries, O(d) time and memory. BC-UR's full `shuffle(indexes)` is O(K) allocation *per
  frame*; at K = 1000 and 10 fps that is 10 000 array elements/second of garbage for no reason.
- **Ship a cross-implementation test vector**: for a fixed `(streamId, seq, K)`, the expected
  index set. Cheap, and it catches the entire class of bit-exactness bugs.

---

## 6. Compression

### 6.1 Availability

`CompressionStream` / `DecompressionStream` are supported in all three engines
([web.dev](https://web.dev/blog/compressionstreams)): **Chrome/Edge 80, Firefox 113,
Safari 16.4**. Formats: `gzip`, `deflate`, `deflate-raw`.

Caveat: **`deflate-raw` landed later than `gzip` in Chromium** (~103 vs 80); see
[caniuse](https://caniuse.com/mdn-api_compressionstream_compressionstream_deflate-raw). Feature-detect:

```js
function pickFormat() {
  try { new CompressionStream('deflate-raw'); return 'deflate-raw'; }
  catch { return 'gzip'; }
}
```

`deflate-raw` saves ~18 bytes of gzip header/trailer versus `gzip` — irrelevant for a whole-file
compression, so `gzip` is a perfectly acceptable fallback. **Using the native API instead of
`pako` saves ~45 KB gzipped of bundle** — worth having on its own merits for a static app.

### 6.2 When compression helps and when it hurts

Compression happens **before** chunking, so it reduces `K` directly — and decode cost scales as
`K²` (§2.6), so a 2× compression ratio is a 2× airtime win *and* a 4× decode-cost win.

| Content | Typical ratio | Verdict |
|---|---|---|
| Text, JSON, CSV, source code, logs | 0.15–0.35 | **Huge win** — 3–6× fewer frames |
| PSBT / CBOR / protobuf | 0.4–0.7 | Good win (BBQr measures 4–58 %) |
| Uncompressed BMP/WAV/TIFF | 0.3–0.6 | Good win |
| PDF (text-heavy) | 0.6–0.9 | Modest win |
| **JPEG, PNG, WebP, MP4, MP3, ZIP, gz, docx/xlsx** | **0.98–1.02** | **Skip** — deflate *expands* incompressible data by ~0.03 % plus 5-byte-per-32 KB stored-block overhead |
| Encrypted / random data | ~1.0 | **Skip** |

### 6.3 Recommended policy

Copy BBQr's runtime heuristic rather than sniffing file extensions (which lies — `.bin` could
be anything, `.pdf` could be either):

1. Compress the **first 128 KB** of the container with `deflate-raw`.
2. If `compressed / original > 0.92`, set `flags.comp = 0` and transmit verbatim.
3. Otherwise compress the whole container and set `flags.comp = 1`.

The sample step costs ~10 ms and is bounded regardless of file size. The 0.92 threshold leaves
headroom for files whose head is unrepresentative — being wrong costs a few percent of airtime,
whereas *always* compressing costs CPU and a tiny expansion on the very common case of sending
a photo.

**Interaction with encryption:** if qrbeam ever adds encryption, **compress first, then
encrypt.** Ciphertext is incompressible, so the reverse order silently disables compression.
(The CRIME/BREACH concern about compression-before-encryption does not apply — that attack
needs an adaptive chosen-plaintext oracle, which a one-shot file transfer does not provide.)

---

## 7. Recommendations for qrbeam

### 7.1 Coding scheme — implement it ourselves, ~300 lines

**Use a rateless XOR fountain code with BC-UR's framing conventions and a Gaussian-elimination
decoder over GF(2).** Concretely:

| Aspect | Decision | Why |
|---|---|---|
| Code family | LT-style random XOR fountain, **non-systematic** | Rateless is mandatory with no back-channel (§2.4); non-systematic beat systematic in every simulated cell (§4.2) |
| Degree distribution | **Harmonic, `Pr(d) ∝ 1/d`, capped at `d ≤ min(K, 64)`** | Best measured GE performance; the cap cuts encoder work ~10× at K = 1000 for +1.8 pp overhead (§2.6). Same family as BC-UR |
| Index selection | Derived from `(streamId, seq)` via `splitmix32` + partial Fisher–Yates | **Zero index bytes on the wire** — BC-UR's best idea (§4.2); `luby-transform` wastes 4 B/index (§3.2) |
| Decoder | **Full GF(2) Gaussian elimination, maintained in RREF incrementally** | 2–2.5× faster end-to-end than peeling at our K; overhead falls from +33…108 % to +2…7 % (§2.5) |
| Library | **None — write it** | Nothing available is both small and correctly decoded (§3.7) |

**Expected performance:** ε ≈ **+2 % to +7 %** mean, **p99 ≈ +10 %** for K = 100–1000 — within
a few percent of RaptorQ, at ~3 KB of gzipped JS instead of 134 KB of WASM, with no patent
surface.

**Why not the alternatives:** RaptorQ is technically superior but costs 134 KB gzipped and a
Qualcomm IPR footnote (§2.2) to save ~3 % overhead ≈ 15 frames on a typical transfer. Robust
soliton is tuned for the decoder we are not using. Reed–Solomon is not rateless and a wrong
rate guess is unrecoverable (§2.4). Online codes add a second layer for no measurable win at
our block sizes (§2.3).

**Implementation sketch (~300 lines TS):**

| Component | Lines |
|---|---:|
| `splitmix32` PRNG + partial Fisher–Yates index selection | ~40 |
| Harmonic degree sampler (cumulative table, binary search) | ~25 |
| CRC-32 (payload) + CRC-8 (frame) | ~35 |
| Encoder: slice, XOR-mix, emit infinite generator | ~50 |
| Decoder: incremental RREF over `Uint32Array` bitmasks + payload XOR | ~110 |
| Header pack/unpack + validation | ~40 |

Decoder core:

```
rows: Map<pivotCol, {mask: Uint32Array, payload: Uint8Array}>

onFrame(header, fragment):
  validate magic, version, CRC-8; if streamId differs from locked stream → ignore (or reset)
  K    = ceil(payloadLen / fragLen)
  idx  = deriveIndices(streamId, seq, K)     // no bytes on the wire
  mask = bitmask(idx);  data = fragment.slice()
  for each pivot p set in mask (ascending):
      if rows.has(p): mask ^= rows[p].mask;  data ^= rows[p].payload
  if mask is zero: return                    // linearly dependent, discard
  pivot = lowest set bit of mask
  reduce every existing row that has `pivot` set by (mask, data)   // keeps RREF
  rows.set(pivot, {mask, data})
  progress = rows.size / K                   // monotonic; unit rows reveal fragments early
  if rows.size === K:
      payload = concat(rows in pivot order).slice(0, payloadLen)
      if crc32(payload) === streamId: inflate → parse container → done
      else: header corruption slipped through — reset and warn
```

Maintaining full RREF (rather than forward-elimination + a final back-substitution) costs ~2×
the row operations but is still comfortably real-time (§2.6), needs no final pass, and yields
individual fragments as soon as their row becomes a unit vector — which gives an honest,
monotonically increasing progress bar.

**Guard rails:**

- `K < 8` → skip the fountain layer, cycle raw fragments (GE is pointless, and at K = 3 the
  coupon-collector penalty is negligible — this is BBQr's regime and BBQr is right about it).
- `K > 1500` → source-block partitioning via `flags.block` (§2.6); or raise the QR version first.
- Run the decoder in a **Web Worker**; camera decode and GE must not contend for the main thread.
- Ship the `(streamId, seq, K) → indices` test vector (§5.5).

### 7.2 Proposed frame header — 13 bytes

Binary QR byte-mode. All multi-byte fields big-endian.

| Offset | Size | Field | Description |
|---:|---:|---|---|
| 0 | 1 | `magic_ver` | High nibble `0xB` = qrbeam; low nibble = protocol version. **`0xB1`** = v1. Rejects foreign QR codes in one byte |
| 1 | 1 | `flags` | bits 0–1 `comp`: 0 = none, 1 = `deflate-raw`, 2 = `gzip`, 3 = reserved · bits 2–3 reserved (encryption, beacon) · bits 4–7 `block`: source-block index 0–15 |
| 2–5 | 4 | `streamId` | **CRC-32 of the encoded payload.** Triple duty: session discriminator, PRNG seed, whole-file integrity check |
| 6–8 | 3 | `payloadLen` | uint24 — encoded payload length in bytes (max 16 MiB). With observed `fragLen`, gives `K = ceil(payloadLen / fragLen)` |
| 9–11 | 3 | `seq` | uint24 — 1-based fountain sequence number (16.7 M frames ≈ 19 days at 10 fps). With `streamId`, seeds the index derivation |
| 12 | 1 | `fcrc` | CRC-8 over bytes 0–11 **and** the fragment. Prevents a mis-decoded frame from poisoning the linear system (§5.2) |
| 13 | `fragLen` | `fragment` | The XOR-mixed payload fragment. `fragLen = frameByteLength − 13`, constant for the stream |

**Total overhead: 13 bytes/frame — 1.0 % at QR V25-L, 0.4 % at V40-L.**

Derived, never transmitted: `K` (from `payloadLen` and `fragLen`), `fragLen` (from frame
length), the fragment index set (from `streamId` + `seq`), and the number of source blocks.

Compare: BC-UR spends ~10–15 bytes on CBOR-encoded `seqNum`/`seqLen`/`messageLen`/`checksum`
*plus* the Bytewords expansion; BBQr spends 8 ASCII chars but carries no session ID, no
checksum, and no FEC; `luby-transform` spends `4×(degree+4)` ≈ 40+ bytes.

**Two design rules this layout encodes:**

- **Every field earns its bytes by doing more than one job.** `streamId` is session ID *and*
  PRNG seed *and* integrity check; frame length implies `fragLen` implies `K`. Anything that
  can be derived is derived.
- **Anything constant across the transfer belongs in the payload, not the header.** Filename,
  MIME type, and mtime go in the container (§5.4) — repeating them 500 times is pure waste.

### 7.3 Compression

Native `CompressionStream('deflate-raw')` with a `gzip` fallback (§6.1) — no `pako`, saving
~45 KB gzipped. Apply the 128 KB sample-and-threshold heuristic at 0.92 (§6.3), and record the
outcome in `flags.comp` so the receiver needs no heuristic of its own.

### 7.4 Display parameters (starting point, to be tuned)

From §4.1 and §5.3: **QR version 25–30, ECC level L, 8–12 fps.** Spend redundancy in the
fountain layer, not in the QR code's own Reed–Solomon — divan's data is unambiguous that ECC
Low wins because sparser QR codes decode faster and more reliably. Re-tune density *after* the
codec works, since fountain coding raises the optimal chunk size (his optimum moved from
550–900 B to 1 800–2 000 B).

### 7.5 Receiver-side note

[mohankumarelec/airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer)
uses **`zbar-wasm`** rather than `jsQR`. Worth benchmarking both on blurry/low-light frames
early — at 10 fps the camera decode rate *is* the loss rate `p`, and every point of `p` costs
`1/(1−p)` in airtime. Improving the decoder is likely the single highest-leverage optimisation
available after the codec, and it is entirely independent of everything above.

---

## Sources

- [BCR-2020-005: Uniform Resources](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md)
- [BCR-2024-001: Multipart UR (MUR) Implementation Guide](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2024-001-multipart-ur.md)
- [Blockchain Commons — Animated QRs](https://developer.blockchaincommons.com/animated-qrs/)
- [ngraveio/bc-ur (JS implementation)](https://github.com/ngraveio/bc-ur)
- [BBQr specification](https://github.com/coinkite/BBQr/blob/master/BBQr.md) · [bbqr.org](https://bbqr.org/BBQr.html)
- [divan/txqr](https://github.com/divan/txqr) · [Animated QR data transfer](https://divan.dev/posts/animatedqr/) · [Fountain codes and animated QR](https://divan.dev/posts/fountaincodes/)
- [qifi-dev/qrs](https://github.com/qifi-dev/qrs) (source of `luby-transform`)
- [cberner/raptorq](https://github.com/cberner/raptorq) · [npm `raptorq`](https://www.npmjs.com/package/raptorq)
- [RFC 6330 — RaptorQ FEC Scheme](https://datatracker.ietf.org/doc/rfc6330/) · [Qualcomm IPR #2554](https://datatracker.ietf.org/ipr/2554/) · [US7,139,960 (expired)](https://patents.google.com/patent/US7139960)
- [catid/wirehair](https://github.com/catid/wirehair) · [kig/wirehair-wasm](https://github.com/kig/wirehair-wasm)
- [Online codes](https://en.wikipedia.org/wiki/Online_codes)
- [Twibright Optar](http://ronja.twibright.com/optar/) · [za3k: Paper archival](https://blog.za3k.com/paper-archival)
- [Compression Streams supported on all browsers](https://web.dev/blog/compressionstreams) · [caniuse: deflate-raw](https://caniuse.com/mdn-api_compressionstream_compressionstream_deflate-raw) · [MDN: CompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream)
- [QR code character capacities](https://www.thonky.com/qr-code-tutorial/character-capacities)
- [xloem/qrstream](https://github.com/xloem/qrstream) · [LucaIaco/QRFileTransfer](https://github.com/LucaIaco/QRFileTransfer) · [mohankumarelec/airgapped-qr-code-transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer)

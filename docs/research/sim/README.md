# Verification simulations

Reproducible scripts backing numbers that load-bearing decisions rest on. The
research documents in the parent directory are largely literature review; these
are the claims we did not want to take on trust.

Run them with no arguments for a quick pass, or pass a trial count:

```
python3 fountain_overhead_sim.py 200
```

---

## `fountain_overhead_sim.py` — decoder choice for the fountain code

**Claim under test**, from `../fountain-codes-and-protocol.md`: textbook LT with a
peeling decoder is unusable at qrbeam's block sizes, and swapping peeling for
full GF(2) Gaussian elimination on the *identical* symbol stream drops reception
overhead to a few percent.

**Verdict: confirmed, and stronger than claimed.** This was written independently
of the research agent's (unsaved) simulation and reproduces its headline figure
closely — peeling + robust soliton at K=50 came out at +45.4% mean / +234% p99
here versus the +44% / +194% reported there. Two independent implementations
landing on the same numbers is reasonable evidence the effect is real and not an
artifact of one buggy decoder.

Both decoders are fed the *same* symbol stream within each trial, so the
comparison isolates the decoder and controls for the degree distribution and the
RNG draw.

### Results — 200 trials per cell

Overhead is extra **received** symbols beyond K, as a percentage of K. Channel
loss is deliberately absent: loss scales how many frames the sender must
transmit, but does not change how many received symbols a decoder needs.
Reception overhead is the decoder property under test.

**Harmonic, `Pr(d) ∝ 1/d`** — the BC-UR distribution:

| K | Gaussian elimination | Peeling |
|---|---|---|
| 50 | **+7.2%** (p99 +28.0%) | +90.0% (p99 +156.0%) |
| 100 | **+4.2%** (p99 +13.0%) | +108.6% (p99 +161.0%) |
| 250 | **+2.2%** (p99 +6.0%) | +132.7% (p99 +166.0%) |
| 500 | **+1.5%** (p99 +3.0%) | +156.7% (p99 +185.4%) |
| 1000 | **+1.2%** (p99 +2.1%) | +180.2% (p99 +204.6%) |

**Robust soliton** — the textbook LT distribution:

| K | Gaussian elimination | Peeling |
|---|---|---|
| 50 | **+11.7%** (p99 +60.0%) | +45.4% (p99 +234.0%) |
| 100 | **+6.8%** (p99 +40.0%) | +32.8% (p99 +109.0%) |
| 250 | **+2.8%** (p99 +21.6%) | +23.1% (p99 +80.8%) |
| 500 | **+1.8%** (p99 +23.6%) | +18.3% (p99 +57.8%) |
| 1000 | **+0.6%** (p99 +3.8%) | +12.3% (p99 +38.7%) |

### What this means for qrbeam

**1. The decoder matters more than the code.** Gaussian elimination beats peeling
by a factor of 4–150× in overhead across every cell tested. At K=1000 harmonic,
GE needs +1.2% extra symbols where peeling needs +180% — the difference between
a transfer finishing and a user giving up. This is the finding that should drive
the implementation, and it is cheap: GE is a few hundred lines.

**2. A trap worth flagging loudly: harmonic + peeling gets *worse* as files get
bigger.** Peeling overhead under the harmonic distribution climbs monotonically
with K — +90% at K=50 up to +180% at K=1000 — while under robust soliton it
*improves* with K (+45% down to +12%). Robust soliton is explicitly engineered to
keep the degree-1 ripple alive for a peeling decoder; the harmonic distribution
is not, and starves it.

This matters because BC-UR specifies the harmonic distribution, and the naive way
to implement a fountain decoder is peeling. Anyone pairing BC-UR's distribution
with a textbook peeling decoder lands in the worst cell in the table, and the
symptom — "it works fine for small files, and mysteriously falls apart on big
ones" — points away from the actual cause. **The harmonic distribution is only
viable because we are using Gaussian elimination.** The two choices are coupled
and must not be changed independently.

**3. Distribution choice is a mean/tail tradeoff, and the tail is what users
feel.** With GE, robust soliton wins on mean at large K (+0.6% vs +1.2% at
K=1000), but harmonic has a markedly better tail at small and middle K — p99
+13% vs +40% at K=100. Since a bad tail is what a user actually experiences as
"this transfer is taking forever", and small-to-middle K is the common case,
harmonic + GE looks like the right default. Worth re-testing once the real chunk
size is known.

### Caveats

- Symbol index sets are drawn as uniform random d-subsets, matching an idealised
  LT encoder. The real encoder derives indices from a seeded PRNG keyed on
  `(seqNum, checksum)`; that should be equivalent in distribution but is worth
  re-running against the actual implementation.
- Counts reception overhead only. It does not model decode CPU cost, which is
  where GE is genuinely worse than peeling (O(K³) worst case in bit operations
  versus O(K·d)). The research doc estimates ~390 MB of XOR at K=1000, spread
  over a multi-minute transfer. That budget needs its own measurement against a
  real implementation on a real phone.
- No duplicate-frame or torn-frame modelling; those are erasures at this layer.

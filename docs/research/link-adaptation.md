# Link Quality Estimation, Adaptive Modulation, and Closed-Loop Rate Adaptation

Research thread on the question: **should screenferry measure the channel and configure
itself from the measurement, rather than shipping a fixed profile — and is it worth
negotiating that configuration between the two instances?**

Companion to [`beyond-qr-optical-channels.md`](beyond-qr-optical-channels.md) (what the
channel can carry) and [`fountain-codes-and-protocol.md`](fountain-codes-and-protocol.md)
(how packets are coded). This document is about **choosing** the operating point.

**Status:** research complete. Contains one significant finding that changes the framing
of the problem (§4.4), and one that resolves the bidirectional question empirically (§6).

---

## 0. The three verdicts, up front

**Prior art verdict.** Screen-camera research has spent fifteen years on this problem and
converged, almost unanimously, on **open-loop scalability rather than closed-loop
adaptation**. Strata, FOCUS, SoftLight and RDCode all assume no feedback exists and design
codes that degrade gracefully instead. Exactly two systems close the loop —
**MAMBA** (WoWMoM'20, real, implemented, bidirectional) and **VMRA** (SECON'11,
trace-driven simulation only) — and MAMBA's measured gain from adaptation is only
**5–20%**. COBRA adapts open-loop from the *sender's own accelerometer*, which is the most
directly transplantable idea in the literature.

**Bidirectional verdict.** The geometry **works and has been built at least four times**
(CamTalk 2013, Montoya & Di Francesco 2016, MAMBA 2020, and the open-source browser
project QRFileTransfer). MAMBA ran two phones screen-to-screen at 20 cm on front cameras
and sustained 11–28 kbps in both directions simultaneously. The blockers are real but
narrow: front cameras were **fixed-focus** on most phones until roughly 2022 (iPhone got
front autofocus first in the iPhone 14, Sept 2022), they are lower-resolution and lower-
frame-rate than rear cameras, and every published bidirectional experiment **propped both
devices on stands**. The rear-camera geometry — the natural one for scanning — genuinely
has no back-channel, and the literature says so explicitly.

**Design verdict.** Do not build a closed loop first. The single highest-value change is
to stop treating a QR tile as a binary erasure and start harvesting **soft confidence**
from it (SoftLight's central idea, and SoftRate's in WiFi — both report ~2× over
loss-based control). Second-highest: a **profile ladder** interleaved into the frame
stream, which on a fountain-coded channel is *free probing* — a probe that succeeds
delivers real payload rather than being discarded as a statistic (§4.4). A negotiated
back-channel is a worthwhile Phase 6+ enhancement, not a Phase 3 one.

---

## 1. Rate adaptation prior art in screen-camera and VLC links

### 1.1 The landscape at a glance

| System | Venue | Loop | What adapts | Signal used | Measured gain from adapting |
|---|---|---|---|---|---|
| **PixNet** | MobiCom'10 | open | nothing (fixed OFDM) | — | — |
| **COBRA** | MobiSys'12 | **open, local-sensor** | code block size | sender's own accelerometer | not isolated |
| **LightSync** | MobiCom'13 | open | nothing; *recovers* from rate mismatch | per-line colour tracking | ~2× display rate vs. half-rate rule |
| **CamTalk** | SecureComm'13 | closed (TCP-like) | nothing — retransmit only | ACK | n/a (reliability, not rate) |
| **Strata** | MobiCom'14 | **open, layered** | receiver decodes as many layers as it can | per-layer BER stopping rule | ~2× vs. group-of-codes; −33% vs. single-layer QR |
| **RDCode** | MobiCom'14 | open | nothing (parameters preset) | — | — |
| **SoftLight** | INFOCOM'16 / TMC'17 | **open, rateless** | effective rate emerges from ratelessness | **per-bit soft hint** | 2.2× vs RDCode, 10.3× vs COBRA |
| **FOCUS** | MobiSys'16 | **open, layered + ladder** | per-sub-channel spatial detail *and* temporal rate | none (transmitter-side ladder) | 3× read distance vs Strata |
| **TETRIS** | MASS'17 | open | nothing | — | — |
| **RainBar+** | IEEE TWC 2018 | **closed** | barcode density | real-time feedback | full text unobtainable — see §1.9 |
| **MAMBA** | WoWMoM'20 | **closed, bidirectional** | block size **and** frame rate | retransmission count per window | **5–20%** |
| **VMRA** | SECON'11 | **closed (simulated)** | LED multiplexing mode | packet error rate over window T | "close to oracle" (trace sim) |
| **S2SVLC** | arXiv 2025 | open | nothing | — | — |

The pattern is stark. **Almost nobody closes the loop, and the one system that does and
measures it honestly reports a modest gain.**

### 1.2 Strata — layered coding for scalable visual communication

Hu, Mao, Huang, Xue, She, Bian, Shen, MobiCom'14.
<https://dl.acm.org/doi/10.1145/2639108.2639132> (full text mirrored at
<https://silo.tips/download/strata-layered-coding-for-scalable-visual-communication>).

This is the most relevant single paper and it deserves detail, because its *negative*
results are as useful as its positive ones.

**Motivation, in the authors' words:** "Existing code designs for display-camera based
visual communication all have an all-or-nothing behavior." Strata explicitly "borrow[s]
the notion of hierarchical modulation from traditional RF communication."

**How the layers actually work.** Spatial layering is *recursive block subdivision*, not
superposition:

- A block in layer *n* is divided into *k* smaller blocks for layer *n+1*. Scaling factor
  **k = 16**.
- A fraction **p = 1/2** of the layer-*n+1* blocks form one **contiguous reserved block**
  carrying the *same colour as the parent layer-n block*. The remaining half carry
  layer-*n+1* data.
- The reserved block is what makes the parent decodable: since the enhancement bits are
  unpredictable, the only way to guarantee the parent block's dominant colour survives
  spatial averaging is to *pin* half the child blocks to the parent's colour. The paper
  derives this from a capacity argument: you need SNR ≥ 1 to carry one bit in the coarse
  layer, i.e. at least half the pixels must take the dominant colour.
- Two extra bits are harvested from the **position and orientation** of the reserved
  block (left/right/top/bottom). Requires a QR-style mask to randomise data blocks so they
  don't accidentally form a reserved-block shape.
- Layer *n+2* blocks (1/64 the size of layer *n*) can be inserted as strips *inside* layer
  *n*'s reserved block, because 1:64 needs only a 1/4 reserved fraction — the 1/2 reserve
  is larger than strictly necessary.
- The evaluated instance has **four spatial layers carrying 1, 10, 160 and 2560 bits**.

**Temporal layering** is frame interleaving at non-uniform intervals: each base-layer frame
is sandwiched between two enhancement-layer frames, targeting **7.5 / 15 / 30 / 60 fps**
for layers 1–4. A 30-fps camera decodes layers 1–2 cleanly and sees layers 3–4 as mixed
frames it discards. Measured *effective distinct-frame* rates: **iPhone 5s 22.03 fps,
Nexus 5 14.30 fps, HTC Desire 7.23 fps.**

**What the receiver does with partially-decodable layers — the part that matters for us:**

1. Detect the code area and coarsest block size using the standard QR/Data Matrix
   procedure.
2. Decode **layer by layer, coarse first**. For each block, **skip the outermost 1/3 of
   pixels from each side** (edges are noisy) and take the majority colour of the rest.
3. Subdivide each block by 16 and repeat for the next layer.
4. **Stopping rule:** if error correction is present, stop when the bit-error count in the
   current layer exceeds a threshold set by the EC code rate. Otherwise stop when blocks
   can't be subdivided further.
5. **Crucially, layers are independent.** The paper is explicit that this differs from
   classical HM and SVC: "the layers in HM or SVC are dependent, i.e. the enhancement layer
   would be useless if the base layer is not correctly decoded. In contrast, the layers in
   Strata are independent for more robustness." Bit errors in layer *n* have no effect on
   layer *n+1*. The coarse-first decode order is a *performance* choice (avoid wasting time
   on corrupt fine layers), not a correctness requirement.

**The cost, measured.** At equal code area and equal finest-block resolution, the QR
comparison carries **4096 bits and Strata 2731 bits — a 33% capacity loss** for the
layering. The paper concedes this in the abstract: "at the expense of less capacity than a
single-layer code."

**Strata's own negative results, which save us experiments:**

- **Multi-level greyscale does not work.** Using pairs of greyscale values to encode two
  layers directly fails: the captured pixel distribution does not show four distinct peaks
  (Fig. 18), because perceived greyscale compresses toward black with distance. Only
  black/white is reliably separable. (Note the tension with `beyond-qr` §6.6's colour
  result — Strata tested *greyscale levels*, not chroma, and at 1–28 m rather than 20–40 cm.
  The two findings are compatible.)
- **Frequency-domain coding is much worse at the same size** (Table 4). Screened code
  error rates: Strata 0% at 1/3/5/7 m, Haar wavelet 5.4/9.7/12/25.4%, 2D-OFDM
  6.2/21/27.7/30.5%. (FOCUS later disputes this — §1.6.)
- **A "group of codes" — four separate single-layer barcodes at different block
  resolutions tiled into quarters of the frame — scales with distance just as Strata does,
  but carries less than half the bits** (1108 bits vs 2731). This is the closest published
  measurement of the **simulcast-ladder-in-space** alternative and it is directly relevant
  to §4.
- Exposure matters more than ambient light: with exposure compensation set correctly, the
  indoor/outdoor difference is minor. Optimal setting is **−2 for screened codes, −1 for
  printed**. This independently corroborates plan decision **D14**.

**Timing:** decoding all four layers takes **5 ms (Note 2) to 8 ms (Galaxy S2)** after
localisation; **localisation itself takes 52 ms** and the authors suggest a COBRA-style
corner design to fix it.

**The one-sentence takeaway that justifies this whole document:**

> "HM and Strata are subject to channel distortions that are unknown at the encoder.
> Therefore, the encoder can only estimate the channel condition and needs to be
> sufficiently conservative to account for a range of possible channel distortions to
> ensure decodability."

That is the entire case for either measuring the channel or hedging across it.

### 1.3 SoftLight — soft hints, and the most transplantable idea in the field

Du, Liando, Li. INFOCOM'16 <https://doi.org/10.1109/INFOCOM.2016.7524510>, extended as
"Soft Hint Enabled Adaptive Visible Light Communication over Screen-Camera Links",
IEEE TMC 16(2):527–537, 2017 <https://doi.org/10.1109/TMC.2016.2551750>
(PDF via Wayback: <https://web.archive.org/web/2020id_/https://wands.sg/publications/full_list/papers/TMC_17_2.pdf>).

**SoftLight opens by ruling out a back-channel, and its reasoning is exactly the objection
screenferry has to answer:**

> "A major challenge for providing adaptive VLC is that the screen-camera links have no
> feedback channel. The receiver cannot display any feedback information on the screen to
> the sender, since its screen must face to the user and display the captured frame for
> camera adjustment (e.g., zoom in/out, or adjust the phone orientation). As a result,
> conventional rate adaptation and retransmission schemes, like FEC and ARQ, that rely on
> the feedback of channel conditions … are not suitable."

Note precisely what this argument is and is not. It is a claim about the **rear-camera
scanning geometry with a viewfinder UI** — the user is aiming the phone, so the phone's
screen is the viewfinder and cannot also be a transmitter. It is *not* a claim about
physics. §6 shows the front-camera geometry defeats it.

**The soft hint.** SoftLight's core contribution is a per-bit confidence value, computed
from the demodulated colour, that turns a hard-decision channel into a **bit-level erasure
channel with a tunable threshold**. Given a received colour-component value `C_a` and the
in-band reserved reference values `C_H` (high) and `C_L` (low):

```
SH_a = | C_a − (C_H + C_L)/2 |  /  ( (C_H − C_L)/2 )
```

That is a normalised distance from the decision midpoint, exactly analogous to the
soft-decision metric of QPSK. Bits with `SH < τ` are **erased**, not guessed.

**Why the in-band reference matters:** the standard colours drift per-transmission and even
within a frame, so a *fixed* decision threshold does not work. SoftLight embeds a colour
palette in the frame and normalises against the *received* reference values, which removes
uniform channel offset (screen colour inaccuracy, camera white balance) for free. This is
the same mechanism screenferry's plan already requires for Stage 2 colour ("a per-frame
in-band colour reference is not optional").

**The measured quality of the hint** (all at the same location and phones, RDCode layout,
200 frames):

| Modulation | Threshold τ | False positive | False negative |
|---|---|---|---|
| Symbol-level, 4-colour (naive) | 1.35 | 1.0% | **76.4%** |
| Bit-level, RGB | 0.8 | 1.0% | 58.3% |
| Bit-level, YUV | 0.2 | 0.9% | 4.9% |
| Bit-level, YUV + special palette | 0.15 | **0.8%** | **1.8%** |

The lesson is that a naive confidence metric is *useless* (76% false-negative rate) and
becomes excellent only once the modulation is designed so the components are independent.
Three techniques got it there: (a) each bit of a symbol gets its **own colour component**
rather than a joint constellation point; (b) modulate in **YUV**, not RGB, so brightness
does not leak between components; (c) a **special colour palette** where the reference
symbols are flanked by identical-colour neighbours so they are immune to adjacent-symbol
blur.

**Robustness of the threshold across conditions** (Table 2 of the TMC version):

| Avg BER | τ=0.2 FP/FN | τ=0.5 FP/FN | τ=0.8 FP/FN |
|---|---|---|---|
| 0.6% | 0.1% / 2.98% | 0.007% / 12.9% | 0% / 39.7% |
| 14.5% | 5.8% / 12.8% | 1.0% / 34.3% | 0.29% / 51.9% |
| 24.6% | 12.3% / 12.8% | 2.6% / 30.9% | 0.2% / 46.7% |

The paper's operational conclusion is important and slightly counter-intuitive: **a
constant τ = 0.5 works across the entire range**, and no parameter adaptation is needed.
False negatives (wrongly erased good bits) only cost efficiency; false positives (wrongly
kept bad bits) cost correctness. So set τ to hold FP ≈ 1% and accept a large FN.

**The rateless code that consumes soft hints.** SoftLight cannot use standard LT/Raptor
because binary belief propagation cannot tolerate *any* false positives — one wrong bit
propagates. Instead:

- Data → bit frames → **systematic** RS-parity-augmented intermediate frames → rateless
  frames, each the XOR of **r = 3** randomly chosen intermediate frames. Seed and frame
  count are in every header, so index sets are derived, not transmitted (same trick as
  screenferry's D7).
- Number of encoded frames is **~20× the number of intermediate frames**, so the effective
  rate can drop 20× to match a very lossy link.
- Decoding: each intermediate frame has *multiple instances*, each a different XOR
  combination of received frames. Per bit position, take a **majority vote** across
  instances. `x` (erased) bits and false-positive bits get outvoted. RS parity check runs
  *after* rateless decoding, and successfully decoded byte-arrays are excluded from
  subsequent passes, so the work shrinks fast.
- `r = 3` is chosen small deliberately: it limits how many errors can accumulate in one
  instance, and keeps XOR cost low.

**Cost:** de-interleave + soft hint + majority vote = **5.6 ms** for an 84×60 symbol frame,
**17.1 ms** for 156×108 (soft hint alone: 1.2 / 4.0 ms). Cheap.

**Interleaving is required**, because intra-frame BER is spatially non-uniform indoors
(uneven fluorescent illumination) — Fig. 1. Interleaving equalises per-position reception
so all positions converge simultaneously.

**Results.** Max goodput **150.1 kbps** at 180×108 symbols (peak observed 317.3 kbps);
RDCode 68.2 kbps, RDCode+Raptor 105.1 kbps. Average gains: **2.2× over RDCode**, 1.4× over
RDCode+Raptor, **10.3× over COBRA+RS(255,127)**, 20.5× over COBRA+RS(255,191), and 3.3×
even over a site-surveyed best-tuned COBRA. Under hand tremble: 2.6× / 1.7×; at the worst
tremble level, **5.1× over RDCode**. One-to-many broadcast to receivers at different
angles/distances: **5× over RDCode**, because RDCode must set its FEC for the worst
receiver.

**And it does all of this with fixed parameters.** SoftLight's thesis is that *ratelessness
plus soft erasure removes the need for parameter adaptation*. That is the strongest
argument in the literature against building a closed loop.

**The uncomfortable implication for screenferry.** Screenferry's Stage-1 modulation is
tiled QR, and QR's Reed–Solomon decoder returns a binary verdict. We throw away exactly the
information SoftLight monetises. Mitigations in §5.3 and §11.

### 1.4 COBRA — open-loop adaptation from the sender's own accelerometer

Hao, Zhou, Xing, MobiSys'12. <https://dl.acm.org/doi/10.1145/2307636.2307645>
(PDF via Wayback: <https://web.archive.org/web/2018id_/http://www.cse.msu.edu/~glxing/docs/COBRA-mobisys12.pdf>).

COBRA is the only system that adapts modulation density in a *shipping-realistic* way
without any feedback, and its mechanism transplants directly.

**The observation:** on a Google Nexus S, when the sender's average acceleration is below
**~1.2 g**, nearly **99% of captured images have zero BER**; above 1.2 g, most images exceed
1% BER. The threshold varies by phone but is "affected only slightly by environmental
conditions", so it can be determined by offline calibration.

**The controller** — and note the shape of it, because it is the damping design §9 will
recommend:

- Sample the accelerometer at 60 Hz; maintain a moving-window average.
- Once the average exceeds `T_acc` **for 1 second**, enter *mobile mode*: increase block
  size to **1.5× default, immediately**.
- Once it falls below `T_acc` **for 1 second**, enter *transition mode*: decrease block
  size **at 1 pixel per second**.
- The paper's stated reason for the asymmetry: "In highly mobile scenarios, the linear
  block size decrease prevents the system from recovering from the mobile mode
  prematurely."

That is **fast-down, slow-up with a 1-second dwell** — exactly the pattern §9 finds in
every WiFi rate controller that works. It was derived independently here from optical
physics.

**COBRA's blur metric — computable without decoding anything.** Per pixel:

```
DOB_p = Σ_{Y ∈ {R,G,B}} min(|255 − Y|, Y) / 3
DOB_img = Σ_p DOB_p / (4N)        # over randomly sampled pixels; range 0–255
```

It measures **distance from saturation**: a pure red pixel (255,0,0) scores 0; a blurred
red pixel (210,45,45) scores 45. Lower is sharper. Over 9000 captured frames the DOB
distributions of "selected" and "discarded" frames were cleanly separated. It costs a
random sample of pixels and no decode.

**Other COBRA facts worth keeping:** 5 colours (black/white/R/G/B); a 6-pixel block size on
an 800×480 4-inch screen gives **18.8 kbits per frame**; capture rate must be **≥ 2×**
display rate (30 fps capture / 15 fps display) — the same rule as plan decision D9;
blur-aware *colour ordering* (a random-stride permutation chosen to minimise total
colour-boundary length, with the stride carried in the header) reduces blur at block
borders. That last one is a cheap idea screenferry could steal for a custom codec.

**COBRA explicitly wanted the closed loop and could not have it:** "As COBRA is designed to
achieve one-way communication, it only accounts for the acceleration of sender. When the
acceleration level of receiver is available, COBRA can estimate the relative movement
between sender and receiver more accurately. However, this is left for future work."

### 1.5 RDCode, LightSync, TETRIS, S2SVLC — the fixed-profile school

**RDCode** ("Enhancing reliability to boost the throughput over screen-camera links", Wang,
Ma, Hu, Huai, Peng, Shen, MobiCom'14, <https://dl.acm.org/doi/10.1145/2639108.2639135>)
uses a **three-tier error correction hierarchy**: intra-block RS over an *n* = 12×12 symbol
block with *k* data bits, *p* parity-check blocks per frame, and *q* parity-check frames per
packet. It is hierarchical *coding*, not hierarchical modulation, and — critically — the
parameters are **preset before the transfer and cannot change**. SoftLight's evaluation
shows exactly what this costs: RDCode had to be swept over four settings (*n−k* = 6, 12, 18,
24) and its best setting differed per symbol size; in the multi-receiver case it had to be
tuned for the worst receiver, costing 5× against SoftLight.

**LightSync** (Hu, Gu, Pu, MobiCom'13, <https://dl.acm.org/doi/10.1145/2500423.2500437>)
attacks the *frame-rate mismatch* problem rather than density: per-line colour tracking
inside a mixed frame plus an inter-frame linear erasure code let a receiver recover data
from frames that mix two displayed codes, so the sender need not obey the "display at half
the capture rate" rule. Strata's related work summarises the tradeoff: "LightSync achieves
a higher rate per unit time, but only after a minimum amount of capture time," and it
requires a *looping* display, whereas Strata streams. For screenferry, whose fountain
stream never loops and never repeats, LightSync's specific mechanism does not apply — but
its problem statement (torn frames as a first-class channel impairment) does.

**TETRIS** (Stafford et al., MASS'17, <https://ieeexplore.ieee.org/document/8108801>)
reports **311.22 kbps at 90% accuracy** using four colours, 10 fps, 14×14 pixel colour
blocks, at 15 cm. Fixed profile, no adaptation, chosen by experiment.

**S2SVLC** (Yokar, Le-Minh, Ghassemlooy, Woo, arXiv:2506.23005,
<https://arxiv.org/abs/2506.23005>) is a physical-layer characterisation rather than a
system: two Pixel 6 Pro at 20 cm, OOK, 200×200 cell frames, 182 bits/frame. They fit the
smartphone screen's beam profile and obtain a **Lambertian order m = 1**. Success rate
against link span: **98% at 40 cm**, falling off through 55 cm where the link breaks. It
contains one sentence highly relevant to §6: *"The front camera can also be used to capture
but with reduced capacity."*

### 1.6 FOCUS — layering in frequency, plus a genuine transmitter-side ladder

Hermans, McNamara, Sörös, Rohner, Voigt, Ngai, MobiSys'16.
<https://user.it.uu.se/~eding810/conferences/Mobisys16.pdf>

FOCUS partitions a code's **2-D spectrum** into sub-channels: sub-channel 1 is the lowest
spatial frequencies, each subsequent one uses finer detail. Payload is QPSK-modulated into
spectrum coefficients; the code image is the inverse Fourier transform. Two properties make
it a hierarchy for free:

1. A code uses **only the lowest frequencies necessary** for its payload — it never
   contains more spatial detail than required.
2. Under undersampling, aliasing corrupts only frequencies above the sampling cutoff, so
   sub-channels below it are untouched, and **decoding errors do not propagate between
   sub-channels** (unlike a Haar-wavelet hierarchy).

**Results:** beats Strata's read distance by **3×** (Strata BER exceeds 15% at 6 m; FOCUS
stays near zero to 12 m), beats PixNet throughput by ≥2× on newer phones and 3× on older
ones, and beats RDCode's range by 2× at superior goodput. FOCUS also directly refutes
Strata's claim that OFDM-on-phones is infeasible.

**Handheld motion barely matters:** "the difference in BER is very low (< 3%) across all
distances" between handheld and tripod capture, at 2–6 m. Worth noting against the
assumption that hand shake dominates — at *close* range it may, but their measurement says
otherwise at metres.

**The multi-rate stream — prior art for the ladder in §4.** FOCUS assigns different
sub-channels different *update rates*. If the display rate is *d*, a chosen set of *l*
sub-channels changes only every 2^(r_i)-th displayed code. Their worked example: to serve
both 15 fps and 30 fps readers, update *h* sub-channels every frame (15 fps of new data)
and *l* sub-channels every other frame (7.5 fps). A 15 fps reader captures only mixed
frames, but because the *l* sub-channels are identical across the two mixed codes, the
Fourier linearity gives `S_mix = (a+b)·S_i` — a scaled version of the correct spectrum, so
the reader decodes them anyway.

Their deployment recommendation is precisely a **ladder with weights**:

> "most sub-channels are assigned rates that are suitable for the most common capture rates
> (e.g., 30 FPS), a few are assigned higher rates (e.g., 60 FPS) to boost throughput for
> high-end smart devices, and few transmit at low rates (e.g., 2 FPS) to ensure that even
> legacy devices can receive data."

And they harvest it with **Raptor fountain coding**, for the same reason screenferry uses a
fountain code: "Screen/camera links are commonly uni-directional, and so a transmitter does
not know which parts of the payload the readers have already successfully decoded."

**FOCUS is the closest thing in the literature to what §4 proposes, and it works.** The
difference is that FOCUS's ladder is in frequency and time; screenferry's would be in tile
geometry and time.

### 1.7 VMRA — the one closed-loop optical rate adaptation, and it is a simulation

Ashok, Gruteser, Mandayam, Kwon, Yuan, Varga, Dana, SECON'11.
<https://www.winlab.rutgers.edu/~aashok/visualmimo/aashok_secon2011.pdf>

Visual MIMO Rate Adaptation targets LED-array-to-camera links (vehicular: brake lights to
in-car cameras). Its relevance is the loop design:

- The transmitter streams CRC-appended packets; the receiver ACKs each successful packet
  **"over a reverse visual MIMO feedback link."**
- `PER = 1 − (#ACKs in time T) / (#packets transmitted in T)`, with **T on the order of
  tens of frame-times**.
- A transmission is "successful" while `PER < PER*`, with **PER\* typically 10–15%**.
- On error, increment the mode (fewer multiplexed LEDs → more diversity). On reaching full
  diversity, **reset to full multiplexing** and re-probe.
- Two variants use a spatial `ProbeVisibility()` pattern or per-element block-CRCs to
  distinguish "occluded" from "too far".

Two honest caveats. First, **the feedback link is assumed, not built** — "The feedback
channel could be realized through a reverse visual MIMO link." Second, results are
**trace-driven simulation**, not a running system. The paper's justification for the
geometry is vehicular: "Particularly in a vehicular setting with front and rear facing
visual MIMO transceivers the receiver could provide feedback."

Still, three things transplant: the **PER over a fixed window** signal, the **10–15% target
error rate** (not zero — the same insight as an LTE BLER target), and the **reset-and-
re-probe** escape from the bottom of the ladder.

### 1.8 MAMBA — the real closed-loop bidirectional system

Bufalino, Montoya Freire, Kannala, Di Francesco, WoWMoM'20.
<https://doi.org/10.1109/WoWMoM49955.2020.00059>
(open PDF: <https://acris.aalto.fi/ws/portalfiles/portal/76117769/SCI_Bufalino_MAMBA_Adaptive_and_Bi_directional_Data_Transfer.pdf>)

MAMBA — *Medium-Aware Mobile Barcode Adaptation* — is the paper that answers screenferry's
question, because it is simultaneously (a) closed-loop, (b) bidirectional over front
cameras, and (c) honestly evaluated. Its own claim: "MAMBA is the first solution — to the
best of the authors' knowledge — employing adaptive bi-directional communication for
reliable data transmission over screen-camera links."

**Setup:** two OnePlus 3T (1920×1080 display, 16 MP front *and* rear), **20 cm apart**,
sender 15 fps display, receiver 30 fps capture at 2K (1728×2304), office light 150–350 lux,
display at 50% brightness. **Both devices on stands.**

**Protocol.** TCP-inspired, with a **15-byte header**: 8-byte CRC, 1 byte of flags
(SYN/FIN/ACK + 5 reserved), 2-byte SEQ, 2-byte ACK, 2-byte window size. Payload 130–2120
bytes depending on block size (17–43 px). Session establishment is a three-way handshake
where each device generates a 32-bit UID and **the higher UID becomes sender** — a
peer-to-peer role election with no out-of-band agreement, which is a neat trick screenferry
could copy for role selection.

**Two nested adaptation loops** (Algorithm 1):

1. **Frame rate.** Count successfully decoded frames every *W* transmitted messages (or
   whenever block size changes); adjust the barcode's `display_time` by **±t_a = 2 ms**
   steps to hit a target rate.
2. **Block size, with an explicit hysteresis band.** After each window, count
   retransmissions *R*. If `R < R_lo` decrease block size; if `R > R_hi` increase it; **if
   `R_lo ≤ R ≤ R_hi`, do nothing.** Steps of `B_a = 1 pixel`.

Evaluated constants: **W = 5, R_lo = 3, R_hi = 6, B_a = 1 px, t_a = 2 ms**, initial block
size 30 px, initial rate 15 fps.

**Measured behaviour (Fig. 6).** In bright light the block size settles at **26 px**; in
dark it rises to **36 px**. Convergence takes roughly **10–25 seconds**, with visible
fluctuation en route ("Even though there is some fluctuation in these parameters, a stable
value is eventually reached"). Display time settles to ~66–75 ms (13–15 fps).

**Measured gain from adaptation — the number that matters:**

> "values of throughput ranging from 11 to 28 Kbps. These also correspond in **an increase
> between 5% and 20% over the case with no adaptation**."

Joint block-size + frame-rate adaptation beat frame-rate-only at every distance;
frame-rate-only was **no better than no adaptation at 40 cm**. And at the *shortest*
distance (20 cm) joint adaptation was slightly *worse* than frame-rate-only, "because the
adaptive approach has some overhead."

**Decoding cost (Table II):** screen identification **206.6 ms** (once per session, not per
frame); corner detection 6.5 ms; projective mapping 0.014 ms; code scan 0.91 ms. Total
without screen identification: **6.1 ms**, i.e. >120 fps capable.

**Robustness:** decoding rate above 95% for block sizes >8 px across capture angles from
15° to 75°, thanks to projective distortion erasure. Against Montoya & Di Francesco's
earlier bidirectional QR system, MAMBA is up to **8× faster** and — importantly — its
execution time is **flat across 20/25/30 cm**, whereas the non-adaptive system's grows
linearly with distance. *That* is the real value of adaptation: not peak throughput, but
**insensitivity to the operating point the user happens to choose.**

MAMBA also makes an argument against layering that lands squarely on screenferry's design:

> "This has originated significant research in layered and hierarchical codes … Despite the
> improvements in reliability due to such an approach and the use of forward error
> correction, **it is enough to miss one frame to prevent decoding in many cases**, for
> instance, when source data are compressed or encrypted."

That objection does *not* apply to screenferry, because a fountain code makes any single
missed frame a non-event. Worth noting: MAMBA paid for reliability with ARQ where
screenferry gets it from ratelessness.

### 1.9 RainBar+ — closed-loop, but I could not verify the mechanism

Zhou, Wang, Lei, Wang, Ren, "Enabling Online Robust Barcode-Based Visible Light
Communication With Realtime Feedback", *IEEE Trans. Wireless Communications*, Dec 2018,
DOI [10.1109/TWC.2018.2873731](https://doi.org/10.1109/TWC.2018.2873731),
<https://ieeexplore.ieee.org/document/8488661>. Abstract snippet: "we design RainBar+, an
online robust high-goodput color barcode-based VLC system with realtime feedback, to fully
guarantee the communication reliability and exploit the communication capacity under a
different link quality."

**I could not obtain the full text** (IEEE and ResearchGate both refused; no open-access
copy, no Wayback snapshot). I therefore cannot report how the feedback channel is
physically realised, what it carries, or its measured gain. Flagging it as a known gap
rather than guessing. A search-engine snippet of the paper's PDF contains the sentence
"However, the screen-camera link itself cannot act as the feedback channel because the
receiver's screen must face to the user and display the captured barcode images for camera
adjustment", which — if accurate — suggests RainBar+ uses an **out-of-band** feedback
channel rather than an optical one. Treat as unconfirmed.

### 1.10 How much does adaptation actually buy?

This is the question the brief asked to answer specifically, and the honest answer is
**less than you would hope, in the systems that measured it**:

| System | Comparison | Gain |
|---|---|---|
| **MAMBA** | joint block-size + frame-rate adaptation vs **no adaptation** | **5–20%** |
| MAMBA | adaptive vs non-adaptive across 20→30 cm (execution time) | flat vs linear growth; up to 8× at 30 cm |
| SoftLight | rateless + soft hints vs RDCode with best fixed setting | 2.2× (3.3× vs site-surveyed COBRA) |
| SoftLight | one-to-many, heterogeneous receivers | 5× |
| Strata | layered vs group-of-single-layer-codes at equal area | ~2.5× bits (2731 vs 1108) |
| Strata | layered vs single-layer QR at equal area, good channel | **−33%** (2731 vs 4096) |
| FOCUS | vs Strata read distance | 3× |
| RRAA (WiFi, for scale) | vs ARF | up to 143.7% |
| SoftRate (WiFi, soft hints) | vs SampleRate/RRAA | ~2× |

The pattern: **changing the *coding* paradigm (rateless, soft-erasure, layered) buys
multiples. Closing the loop on modulation density buys tens of percent.** That should
directly shape screenferry's priorities.

---

## 2. Hierarchical / layered modulation, generally

*(This section draws on a dedicated research sub-thread; the DVB-T C/N deltas and the
superposition-vs-TDMA figures below are **computations from published tables and formulas**,
not quoted results, and are flagged as such.)*

### 2.1 DVB-T hierarchical modulation, and why it was abandoned

DVB-T reinterprets one 16-/64-QAM constellation as two nested ones: the **quadrant** carries
2 bits (High Priority, effectively QPSK), the **position within the quadrant** carries the
remaining 2–4 bits (Low Priority). The parameter **α** is the ratio of inter-quadrant to
intra-quadrant spacing; α = 1 is the uniform constellation, α = 2 and 4 push quadrants apart
to buy HP robustness at LP expense. Reference: Schertz & Weck, *EBU Technical Review*, April
2003, <https://tech.ebu.ch/docs/techreview/trev_294-weck.pdf>; spec Annex A of
<https://dvb.org/wp-content/uploads/2019/12/a012_dvb-t_june_2015.pdf>.

**The cost, derived from the spec's C/N tables (R = 2/3, Gaussian / Ricean / Rayleigh):**

| Layer | Penalty vs. the same modulation standalone |
|---|---|
| HP QPSK inside 64-QAM, α = 1 | **+6.8 to +7.2 dB** |
| HP QPSK inside 64-QAM, α = 2 | +3.9 to +4.0 dB |
| HP QPSK inside 16-QAM, α = 4 | +0.7 dB |
| LP (16-QAM part), α = 4 | **+8.0 to +8.3 dB** |

*(Deltas computed from ETSI Tables A.1–A.3; not quoted figures.)*

**The headline is unflattering: the "robust" base layer is 4–7 dB *worse* than a standalone
QPSK carrying the same bits.** Hierarchical modulation does not create robustness, it
*redistributes* it and charges an inter-layer-interference tax. The spec itself declines to
tabulate α = 4 for 64-QAM "due to the poor performance of the 64-QAM signal."

**Was it abandoned? Yes, within one standards generation.** The DVB-T2 Implementation
Guidelines (BlueBook A133, June 2010,
<https://telcogroup.ru/files/materials-pdf/DVB_standards/DVB-T/a133_DVB-T2_Imp_Guide.pdf>)
contain **zero** occurrences of "hierarchical" and **641** of "PLP". T2 states the identical
commercial requirement — "within a single 8 MHz channel, it should be possible to target
some services for roof-top reception and target other services for reception on portables" —
and meets it with **Physical Layer Pipes**: "different levels of coding, modulation and time
interleaving depth to be applied to different PLPs." That is **time-division simulcast**.
DVB-T needed HM only because it had no in-channel time-division; once T2 had one,
superposition had nothing left to offer.

### 2.2 Superposition coding: strictly better, marginally better

Cover's canonical statement (*Comments on Broadcast Channels*, IEEE Trans. IT 44(6), 1998,
<https://isl.stanford.edu/~cover/papers/cover_98.pdf>): for a **degraded** broadcast channel
the capacity region is achieved by superposition, and Bergmans & Cover proved this region
"is strictly larger than the rate regions achievable by FDMA and TDMA."

But *how much* larger matters. Computing the Gaussian BC region against TDMA:

| Strong / weak SNR | Max gain in the extreme corner | Gain at the balanced (equal-rate) point |
|---|---|---|
| 20 / 10 dB | 4.7× | **1.22×** |
| 15 / 5 dB | 3.9× | 1.20× |
| 10 / 5 dB | 1.8× | 1.11× |
| 30 / 0 dB | 67× | 1.10× |

*(Own computation from R₁ = C(αP/N₁), R₂ = C((1−α)P/(αP+N₂)); not a quoted result.)*

**Strict dominance is real; the practical gain at any operating point anyone would choose
is 10–25%.** The spectacular multiples occur only in corners where TDMA gives one user a
sliver of time. And the result requires assumptions screenferry does not satisfy: a
genuinely degraded channel, an **average-power constraint pooled across streams**, working
successive interference cancellation, and long blocklengths. Screen codes are
**amplitude-limited per pixel** (0–255) with no power pooling, which makes the trade strictly
worse than the Gaussian analysis suggests.

### 2.3 Scalable source coding: industry chose simulcast

SVC's coding penalty is well quantified at **~10% bitrate increase over single-layer
H.264/AVC** at indistinguishable quality (Fraunhofer HHI,
<https://www.hhi.fraunhofer.de/en/departments/vca/research-groups/video-coding-technologies/research-topics/past-research-topics/multi-layer-encoder-control-for-svc.html>;
SPIE 7073, 70730D,
<https://www.spiedigitallibrary.org/conference-proceedings-of-spie/7073/70730D/SVC-overview-and-performance-evaluation/10.1117/12.797351.full>).
In WebRTC practice, simulcast costs the *sender* 30–50% over a single stream versus SVC's
10–15%, and the industry still recommends **simulcast** on maturity and interop grounds
(<https://www.digitalsamba.com/blog/svc-vs-simulcast-in-webrtc>,
<https://bloggeek.me/webrtcglossary/svc/>). MPEG-4 FGS is the same story, standardised then
abandoned.

**Layering wins on paper by ~10–20% and loses in practice on complexity.** That is a
remarkably consistent verdict across RF broadcast, video coding, and — per §1.2's own
numbers — screen codes.

### 2.4 Optical analogues, and what layering would mean for tiled QR

The only genuine robustness hierarchy in screen-camera work is **Strata** (§1.2) and its
frequency-domain successor **FOCUS** (§1.6). Everything else that gets called "layered" is
something else: **HiLight** (MobiSys'15,
<https://www.cs.columbia.edu/~xia/publication/mobisys15-hilight/mobisys15-hilight.pdf>) and
**InFrame++** (MobiSys'15, <https://doi.org/10.1145/2742647.2742652>) layer for *human
imperceptibility* via flicker fusion, not graceful degradation; **ChromaCode** (MobiCom'18,
<https://dl.acm.org/doi/10.1145/3241539.3241543>) modulates **lightness in CIELAB, not
chrominance**, with no layering; **RDCode**'s hierarchy is error correction. Systematic
title/abstract searches for "hierarchical modulation camera screen barcode", "barcode
unequal error protection layered", and "scalable multi-resolution barcode viewing distance"
return **zero** results beyond Strata's family.

Three ways layering could map onto tiled QR, assessed:

**(a) Mixed tile sizes in one frame** — a few big robust tiles plus many small dense ones.
Physics works. But it is **not superposition at all**; it is spatial-division simulcast.
Big tiles consume area small tiles then cannot use, so there is no inter-layer interference
but also no superposition gain. Strata measured the closest analogue (its "group of codes"
comparison, §1.2) and found it carries **less than half** the bits of true nesting at the
same area. On the other hand, screenferry already has a fountain code, so the group-of-codes
approach loses Strata's advantage of extracting more bits — see §4.

**(b) Spatial-frequency layering** — a low-frequency base superimposed on a high-frequency
enhancement. Physically the most attractive, because camera defocus, motion blur and sensor
MTF *are* a low-pass filter, so the base genuinely survives what kills the enhancement. But
the enhancement layer's energy does not vanish at the receiver; it lands in-band as
structured noise on the base layer. That is exactly DVB-T's α problem and there is no
reason the optical channel escapes it. Strata's *reserved block* is precisely the price
paid to suppress it: **half of every enhancement block is spent pinning the parent's
colour.** A 50% area tax to buy a hierarchy.

**(c) Colour-plane layering** — robust luma base, fragile chroma enhancement. Weakest
option. Real hierarchy exists but for uncontrollable reasons: phone ISPs apply 4:2:0
subsampling, aggressive chroma denoise, and auto white balance, so the chroma "layer" is
attacked by processing that cannot be modelled, and AWB drift makes it *time-varying*. The
strongest empirical signal against it is that ChromaCode — the group that pushed colour
hardest — chose to modulate **lightness, not chrominance**. Note this is a narrower claim
than `beyond-qr` §6.6's measured 1.98× for RGB tripling, which is about *parallel
independent planes*, not a *robustness hierarchy* between them. Those are compatible: three
equal-robustness planes is simulcast, not layering.

**Bottom line on layering for screenferry: the fountain code already delivers what
hierarchical modulation was invented for.** Graceful degradation and automatic rate
matching to whatever fraction of tiles the receiver resolves is exactly what an LT code over
an erasure channel gives, free. A receiver on a bad channel simply films for longer.
Layering would add interference cost (b), area cost (a), or ISP-hostile fragility (c) to buy
a property we already have. DVB-T needed HM because it had no in-channel time-division;
screenferry's fountain code is a *stronger* version of DVB-T2's PLPs.

---

## 3. The simulcast / ladder alternative

### 3.1 Has anyone done it on an optical channel? Yes — twice

- **FOCUS's multi-rate streams** (§1.6) are exactly a ladder in the *temporal* dimension:
  most sub-channels at the common capture rate, a few at a high rate for good receivers, a
  few at a low rate "to ensure that even legacy devices can receive data" — with **Raptor
  fountain coding** harvesting whatever arrives. This is the closest published precedent
  for what screenferry would build, and it is a working system.
- **Strata's "group of codes"** (§1.2) is a ladder in the *spatial* dimension: four
  single-layer codes at 2×2, 4×4, 8×8 and 32×32 blocks tiled into quarters of one frame,
  1108 bits total. Strata measured it: **it scales with distance just as the layered code
  does**, but carries under half the bits. That is the honest cost of a spatial ladder
  relative to true nesting — but Strata was maximising bits-per-frame, not
  packets-into-a-fountain-decoder.

### 3.2 The capacity arithmetic

Take two profiles: aggressive A at rate `R_A`, conservative B at rate `R_B < R_A`. Let the
sender allocate fraction `f` of frame-area (or frames) to A. Let `p` be the probability the
channel supports A (B is assumed always to work).

```
Fixed aggressive     : p·R_A
Fixed conservative   : R_B
Ladder(f)            : p·f·R_A + (1−f)·R_B
                     = f·(fixed aggressive) + (1−f)·(fixed conservative)
```

**The ladder is exactly a convex combination of the two fixed strategies.** It therefore
*never* beats the better of the two in expectation. All three are equal at `p = R_B / R_A`.
Away from that point the ladder loses linearly in `f`.

So on pure expected throughput the ladder is dominated. It wins on three other axes:

1. **Bounded worst case.** A wrong *aggressive* fixed guess delivers **zero** — nothing
   decodes, the transfer never completes, and the user has no idea why. The ladder always
   delivers at least `(1−f)·R_B`. For a consumer tool, converting an unbounded failure into
   a 3× slowdown is worth far more than the expected-value loss.
2. **Non-stationarity within a session.** The derivation above assumes a single `p` for the
   whole transfer. In reality the hand wobbles, the user drifts closer, autofocus hunts —
   the channel oscillates across the threshold on a sub-second timescale. Then the ladder is
   not hedging a single unknown; it is *harvesting from both regimes simultaneously*. This
   is where a ladder genuinely beats any fixed choice, and it is exactly screenferry's
   handheld case.
3. **Heterogeneous receivers.** SoftLight's 5× one-to-many gain and FOCUS's explicit
   multi-rate rationale are both this. Screenferry's stated use case is one-to-one, so this
   is worth less here — but "one sender, several people photographing the screen" is a real
   scenario the architecture would get for free.

### 3.3 When does a ladder beat a fixed guess?

From the arithmetic, a ladder beats fixed-conservative iff `p·R_A > R_B`, and beats
fixed-aggressive iff `R_B > p·R_A`. So a ladder is the right answer precisely when **you
cannot estimate `p` to within a factor of `R_B/R_A`**. With a conservative profile at
roughly one third the aggressive rate, that means: *if you cannot tell whether the channel
is good with better than ~33% confidence, hedge.*

At session start, before any decode, `p` is completely unknown. That is the bootstrap case
(§8) and it is the strongest argument for a ladder. After a few seconds of measurement `p`
becomes well-estimated and the ladder should narrow — which is exactly the "start wide,
converge" schedule §11 recommends.

### 3.4 The insight that makes a ladder cheap here

**On a fountain-coded erasure channel, probing is nearly free.**

In WiFi, Minstrel and SampleRate spend ~10% of frames probing rates they believe are wrong.
A probe that fails costs airtime and delivers nothing — Bicket measured a failed 1500-byte
unicast at 11,510 µs against 560 µs for a successful one at 36 Mbps. The probe budget is a
pure tax, justified only by the statistic it yields.

Screenferry has no such tax. A tile rendered at an aggressive profile that fails to decode
costs only the *screen area it occupied for one frame*. A tile that succeeds delivers a
**real fountain packet that advances the decode**, indistinguishable from any other packet.
There is no retransmission, no ACK timeout, no exponential backoff. The probe *is* the
payload.

This inverts the usual cost/benefit of rate probing and is, as far as this research found,
**not stated anywhere in the screen-camera literature** — FOCUS gets the mechanism right
but frames it as serving heterogeneous receivers, not as free probing for one receiver.

---

## 4. What is measurable at the receiver, cheaply and in real time

The distinction that matters is the last column: **what survives total decode failure**.
That is the bootstrap case, and it is where most of the useful signal turns out to live.

### 4.1 The metrics

**Pixels per module (geometry / distance).**
*How:* directly from the QR finder-pattern scan, before any decoding. ZXing's
`FinderPatternFinder` scans image rows for the 1:1:3:1:1 dark/light run pattern and computes
```
moduleSize = (s0 + s1 + s2 + s3 + s4) / 7.0
```
accepting the candidate if each run is within `moduleSize/2` of its expected multiple
(`foundPatternCross`, <https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/detector/FinderPatternFinder.java>).
Estimates from repeated detections of the same pattern are averaged in `combineEstimate`
(<https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/detector/FinderPattern.java>),
with `CENTER_QUORUM = 2` sightings required to confirm a centre.
*Available without decoding:* **yes — this is the single most valuable property in the
whole table.** Finder-pattern detection succeeds long after RS decoding fails, because it
needs only three high-contrast 7×7 landmarks, not 200+ correct modules. If zxing-wasm does
not expose it, running a minimal finder-pattern scan on a downscaled frame is ~50 lines.
*Implies:* everything geometric — module pitch, and hence the maximum safe tile density.
The plan's 4 px/module cliff is stated directly in these units.

**Per-tile decode success rate.**
*How:* `decodedTiles / expectedTiles` per frame, EWMA over a window. Screenferry gets this
free from the D1 tiled layout — a 15-tile frame yields **15 graded samples per frame**, not
one binary outcome. At 15 fps that is 225 samples/second, which collapses the statistical
window enormously (§9.1).
*Available without decoding:* no — but partial failure is the normal case, and 0/15 is
itself a strong, immediate signal.
*Implies:* whether the current profile is above or below the cliff; the primary control
input.

**Reed–Solomon symbols corrected per tile — the soft hint we can actually get.**
*How:* QR decoding runs RS error correction; the number of corrected symbols is a graded
confidence measure of exactly the kind SoftRate exploits. A tile that decodes with 0
corrections is comfortably above threshold; one that decodes with the maximum correctable
count is one symbol from the cliff. **Whether zxing-wasm exposes this is unverified and is
the single most valuable thing to check in Phase 3.** If it does, screenferry gets
SoftLight-class soft information at zero modulation-design cost. If it does not, the
fallback is §5.3.
*Available without decoding:* no.
*Implies:* margin to the cliff — the difference between "working" and "working with 1 dB to
spare". This is what makes fast, non-oscillating control possible.

**Blur / sharpness.**
*How:* two cheap options, both decode-free.
 - **COBRA's DOB** (§1.4): `mean over sampled pixels of Σ_{R,G,B} min(|255−Y|, Y)/3`.
   Range 0–255, lower is sharper. Costs a random pixel sample. Its virtue is that it is
   *specific to a known-palette signal* — it measures how far the received pixels are from
   the saturated values the sender used, which is exactly the right question. COBRA's
   distributions of kept vs discarded frames were cleanly separated over 9000 frames.
 - **Variance of the Laplacian**, the standard no-reference focus metric from microscopy
   autofocus (Pech-Pacheco et al., "Diatom autofocusing in brightfield microscopy: a
   comparative study", ICPR 2000, <https://ieeexplore.ieee.org/document/903548>). Generic,
   scene-dependent, and less well-matched to a binary-palette signal than DOB.
 - A third option specific to us: the **edge slope of a finder pattern**. Since the finder
   pattern's true geometry is known exactly, the transition width between its dark and light
   runs is a direct measurement of the channel's point-spread function in module units. This
   is the sharpest available signal and it is available pre-decode. No prior art found for
   this specific measurement; it appears to be an unexplored idea.
*Implies:* separates "too far away" (px/module low, sharpness fine) from "too shaky /
mis-focused" (px/module fine, sharpness bad). These need *different* UI coaching and
different profile responses, and px/module alone cannot distinguish them.

**Motion between frames.**
*How:* three routes, in increasing cost. (a) **Device motion API** —
`DevicePreviewEvent`/`DeviceMotionEvent` on the receiver, and this is exactly COBRA's signal
but measured on the *right* device (COBRA could only see its own). Requires a permission
prompt on iOS 13+. (b) **Finder-pattern centroid displacement** between consecutive frames
— free once you are already finding patterns, and it measures the *relative* motion that
actually matters, not either device's absolute motion. (c) Frame-differencing on a
downscaled luma plane.
*Available without decoding:* **yes for (a) and (b)**.
*Implies:* predicted blur, and — importantly — it is a *leading* indicator. Motion now
predicts decode failure a frame or two later, which buys back some of the loop delay §9
worries about.

**Torn-frame rate (rolling shutter).**
*How:* screenferry has a uniquely clean detector that most systems lack: **tiles within one
captured frame carry different sequence numbers**. A frame captured across a display refresh
will show tiles from seq *n* in its upper band and seq *n+1* below. So:
`tornFrameRate = fraction of frames where decoded tiles disagree on seq`. This costs
nothing — the sequence number is already in the 13-byte header (D7) — and it is a *direct*
measurement of the display-rate/capture-rate mismatch that LightSync and Strata both go to
great lengths to model.
*Available without decoding:* no (needs ≥2 tiles decoded), but it needs only two tiles, not
a whole frame.
*Implies:* the sender's display rate is too high relative to delivered capture rate. This is
the control input for the *temporal* half of adaptation, and it is orthogonal to the spatial
half. MAMBA runs exactly these two loops separately.

**Luma vs chroma contrast recovery.**
*How:* the plan's D11 calibration probe already specifies this — a frame carrying luma and
chroma checkerboards at 3/4/5/6/8 px/module. The runtime version is cheaper: embed a
small **in-band reference patch** in every frame (SoftLight's "special colour palette", with
its flanking-identical-neighbour trick to immunise it against adjacent-symbol blur) and
measure recovered contrast per channel: `(C_H − C_L)` per component after capture.
*Available without decoding:* **yes** — it is a fixed-position patch, located once the
frame is found.
*Implies:* whether Stage-2 RGB tripling is viable on this device/geometry; also supplies the
`C_H`, `C_L` normalisers that SoftLight's soft-hint formula needs.

**Delivered camera fps.**
*How:* count `requestVideoFrameCallback` invocations over ~1 s. The plan already mandates
this (D14) and the reason is verified: Android delivers 15 fps while reporting 30/60.
*Available without decoding:* **yes.**
*Implies:* the sender's maximum useful display rate (D9's half-rate rule), and — via the
back-channel if one exists — the single most valuable number to report, because the sender
cannot possibly know it otherwise.

**Ambient light / exposure state.**
*How:* mean luma of the captured frame, plus the standard deviation. Strata measured
optimal exposure at −2 for screened codes and its Fig. 8 shows captured greyscale
compressing toward black with distance; MAMBA's block size settled at 26 px in bright light
and 36 px in dark, a **38% difference driven by illumination alone**.
*Available without decoding:* **yes.**
*Implies:* whether the DC-balance assumption (D10) is holding, and whether
`exposureCompensation` is having its intended effect.

**Perspective angle.**
*How:* from the three (or four) finder-pattern centroids, the deviation of the implied
quadrilateral from a square. Free once patterns are found.
*Available without decoding:* **yes.**
*Implies:* MAMBA showed >95% decode rate up to 75° *with* projective correction, so angle
is mostly a solved problem — but a large angle means the effective px/module varies across
the frame, which argues for per-region profiles rather than a single global one.

### 4.2 The bootstrap set

Metrics available **when nothing decodes at all**: px/module, blur (DOB, Laplacian, finder
edge slope), motion, luma/chroma contrast from the reference patch, delivered fps, mean
luma, perspective angle. That is **seven of the ten**, and it includes the two most
important ones (px/module and delivered fps).

This is a much better position than it first appears. The chicken-and-egg problem in §8 is
real for the *protocol* — the receiver cannot tell the sender anything — but it is much
weaker for *local* adaptation and for *UI coaching*. A receiver that cannot decode a single
tile can still say, correctly and immediately: "you are too far away", "hold still", "the
frame is over-exposed", "your camera is only giving me 15 fps".

---

## 5. Metrics → what each one should control

| Metric | Measured or derived | Survives total decode failure? | Should control |
|---|---|---|---|
| **px per module** (finder pattern, `runTotal/7`) | measured | **yes** | Tile count / module size — the primary spatial knob. Hard floor at the ~4 px/module cliff. Also the "move closer" UI. |
| **Per-tile decode success rate** | measured (15 samples/frame) | no (0/15 is itself a signal) | Profile step up/down; the main closed-loop error signal. |
| **RS symbols corrected per tile** | measured *if exposed* | no | Margin-to-cliff → step *size* and confidence. The soft-hint substitute. **Verify zxing-wasm exposure in Phase 3.** |
| **Blur — COBRA DOB** | measured | **yes** | Distinguishes distance from shake; gates aggressive-profile probing; frame selection (discard blurred frames before decode). |
| **Blur — finder-pattern edge slope** | derived from measured runs | **yes** | Direct PSF width in module units → the theoretically correct module-size floor. |
| **Inter-frame motion** (device API or centroid delta) | measured | **yes** | *Leading* indicator: pre-emptively step down before decode failure appears. COBRA's exact mechanism, on the right device. |
| **Torn-frame rate** (seq disagreement across tiles in one frame) | derived | no (needs 2 tiles) | Sender display rate — the temporal knob, orthogonal to the spatial one. |
| **Luma vs chroma contrast** (in-band reference patch) | measured | **yes** | Stage-2 colour on/off; supplies `C_H`/`C_L` for soft-hint normalisation. |
| **Delivered camera fps** (rVFC count / s) | measured | **yes** | Sender display rate ceiling (D9 half-rate rule). The single highest-value field in a back-channel report. |
| **Mean frame luma / std dev** | measured | **yes** | Exposure coaching; verifies DC balance (D10) is holding. |
| **Perspective angle** (finder quadrilateral) | derived | **yes** | Whether to use per-region profiles; "square up" UI. |
| **Fountain rank / K** | derived | no | Progress UI and — if a back-channel exists — the ACK that lets the sender stop. |

---

## 6. The bidirectional geometry question

### 6.1 The physical claim is correct

On every phone, tablet and laptop, **the display and the front camera face the same
direction**. Two devices placed screen-to-screen therefore have each device's front camera
looking at the other's screen. This is not speculative — it is the standard selfie geometry
inverted, and it has been built.

### 6.2 It has been built at least four times

**CamTalk** (Xie, Hao, Yoshigoe, Bian, SecureComm 2013,
<https://eudl.eu/doi/10.1007/978-3-319-04283-1_3>) — "a novel bidirectional communications
framework using front-facing cameras and displays of smartphones … Both devices can send and
receive barcodes at the same time." Motivated by secure key exchange: the channel is
"short-range, highly directional, fully observational, and immune to electromagnetic
interference." Implemented on Android, evaluated on phones and tablets.

**Montoya Freire & Di Francesco**, "Reliable and bidirectional camera-display communications
with smartphones", WoWMoM 2016, <https://ieeexplore.ieee.org/document/7523499> — dynamic QR
codes on one display, **front camera** on the other, with selective retransmission for
casual file exchange.

**MAMBA** (§1.8) — the fullest treatment. Two OnePlus 3T facing each other at 20 cm, both
using front cameras, **simultaneously transferring a 10.5 KB file in each direction**,
11–28 kbps per direction, with closed-loop adaptation of both block size and frame rate.

**QRFileTransfer** by LucaIaco — an open-source, vanilla-JS, single-page browser tool doing
exactly this today. <https://github.com/LucaIaco/QRFileTransfer>,
<https://lucaiaco.github.io/QRFileTransfer/>. Its documented preconditions are worth quoting
because they are screenferry's preconditions too:

> "The two devices are one in front of each other, so that both the camera points to the
> other screen … The distance between them is the shortest possible … The two devices are
> fixed while the transmission is ongoing."

Its protocol is instructive as an *anti-pattern*: the sender shows a chunk, the receiver
replies with a QR containing the **SHA-256 of the decoded chunk**, the sender verifies and
advances. That is **stop-and-wait with a full optical round trip per chunk**, and its chunk
sizes are 8–512 bytes. It proves the geometry and simultaneously demonstrates why you must
not spend the back-channel on per-packet ACKs.

Note also that CamTalk, MAMBA and QRFileTransfer are all *browser- or app-level* projects
using off-the-shelf QR libraries — the same technology stack screenferry is built on. This
is not exotic.

### 6.3 The problems, honestly

**Front cameras were fixed-focus until recently.** MAMBA states it plainly for its own
hardware: the OnePlus 3T's "rear-facing camera has auto-focus and can capture 720p video at
120 FPS, while the **front-facing camera has a fixed focus and a capture rate of only 30
FPS**." On iPhone, front-camera autofocus arrived only with the **iPhone 14 (September
2022)** — Apple's own launch copy: "Using autofocus for the first time, it can focus even
faster in low light and capture group shots from farther away"
(<https://www.apple.com/newsroom/2022/09/apple-introduces-iphone-14-and-iphone-14-plus/>),
corroborated by DXOMARK: "The iPhone 14 series is the first iPhone generation to incorporate
an autofocus system into the front camera"
(<https://www.dxomark.com/apple-iphone-14-pro-selfie-test/>).

This is a **serious but bounded** problem. A fixed-focus front camera is set for
selfie-range subjects, i.e. roughly arm's length, and is acceptably sharp over a broad
hyperfocal range around that — which happens to bracket the 20–30 cm range every
bidirectional paper used. It is *worse* than autofocus, not unusable. And any iPhone from
2022 onward, and most recent Android flagships, have front autofocus.

**Front cameras are lower resolution and lower frame rate.** The OnePlus 3T was unusual in
having 16 MP on both. Typically the front camera is the weaker sensor with the smaller
aperture and no optical stabilisation. S2SVLC's understated observation applies: "The front
camera can also be used to capture but with reduced capacity."

**Both devices must be propped up.** Every published bidirectional experiment used stands
("The two smartphones were attached to supports during the experiments, similar to the state
of the art"). Two hands cannot hold two phones facing each other at a fixed 20 cm for a
multi-second transfer. This is the **dominant ergonomic problem** and it is not solvable by
software. It is, however, a very natural thing to do on a desk: lean one phone against a
laptop, prop the other on a stand or against a mug.

**Glare and specular reflection.** Two glossy emissive screens facing each other at 20 cm
will each reflect the other. This research found **no published measurement** of
screen-to-screen specular contamination — MAMBA and CamTalk simply do not discuss it, which
is weak evidence that it did not stop them. Worth an experiment; it is cheap to run.

**The laptop-to-phone case is easier, not harder.** A laptop's webcam sits above its screen
facing the user, so a laptop screen facing a propped-up phone gives the laptop's webcam a
view of the phone's screen. The laptop is already stable and already propped. The
asymmetry is favourable: the *forward* link (big laptop screen → phone rear or front camera)
is the high-rate one, and the *reverse* link (small phone screen → laptop webcam) only has
to carry 10–30 bytes. Laptop webcams are fixed-focus but typically have a wide depth of
field at 30–50 cm. **This is the geometry to design the back-channel for.**

### 6.4 The rear-camera geometry: no back-channel, and the literature says so

When the receiver holds a phone and aims its **rear** camera at the sender's screen, the
receiver's screen faces the user and is the viewfinder. SoftLight states the constraint
directly (§1.3): "The receiver cannot display any feedback information on the screen to the
sender, since its screen must face to the user and display the captured frame for camera
adjustment."

Could the receiver use its **front** camera for the back-channel while the **rear** camera
receives? Physically, its front camera then faces the *user*, not the sender. No. Could the
receiver dedicate its screen to a feedback code and give up the viewfinder? Then the user
cannot aim, which is what the viewfinder is for — though screenferry could in principle
show a *tiny* viewfinder plus a small static QR. That is an unexplored middle ground and
the only escape route in this geometry; it trades UI area for a back-channel and would need
usability testing.

**Verdict: in the rear-camera geometry the back-channel is effectively impossible, and the
one-way baseline (concept note constraint 7) is correct and must remain the default.**

### 6.5 Overall bidirectional verdict

The bidirectional mode is **feasible, precedented, and demonstrably useful — but only in a
specific propped-up, front-camera, short-range configuration that is a different product
experience from "point your phone at my screen".** It should be an explicitly separate mode
that the user opts into, not a capability the app tries to negotiate opportunistically. And
its payoff must be judged against MAMBA's honest 5–20%, not against a hoped-for multiple.

The strongest argument for building it is not throughput at all. It is the two things the
one-way channel structurally cannot provide:

1. **The sender can learn the receiver's delivered frame rate**, which it otherwise cannot
   know and which sets the display-rate ceiling (D9/D14). Getting this wrong halves
   throughput, and it is a *single number* measured in one second.
2. **The sender can know when to stop** — plan open question 6. A one-way sender loops
   forever. A 2-byte "rank/K" report resolves it completely.

Both are worth far more than a few percent of modulation density.

---

## 7. Thin reverse channel design

### 7.1 The payload

A link report needs, at most:

| Field | Bits | Notes |
|---|---|---|
| Magic + version | 4 | reject foreign codes |
| Session ID (low bits of `streamId`) | 12 | binds the report to this transfer |
| Delivered camera fps | 6 | 0–63 fps, integer |
| Measured px/module | 8 | fixed-point, e.g. 4.4 → 0–15.94 |
| Per-tile decode rate | 7 | 0–100% in 1% steps |
| Torn-frame rate | 5 | 0–100% in ~3% steps |
| Chroma verdict | 2 | none / luma-only / chroma-ok |
| Blur bucket | 3 | 8 levels of DOB |
| Fountain progress `rank·255/K` | 8 | the "you may stop" signal |
| Requested profile index | 4 | explicit request, not just a measurement |
| CRC-8 | 8 | |
| **Total** | **67 bits ≈ 9 bytes** | |

Nine bytes. Even doubled for safety margin and future fields, **18 bytes** covers
everything. That is comfortably inside the smallest, most robust QR versions.

### 7.2 The code

From the repo's own verified capacity table
([`qr-encoding-capacity.md`](qr-encoding-capacity.md)):

| Version | Modules | Byte capacity at ECC **H** (30%) |
|---|---|---|
| 1 | 21×21 | **7 bytes** |
| 2 | 25×25 | **14 bytes** |
| 3 | 29×29 | **24 bytes** |
| 4 | 33×33 | **34 bytes** |

**Recommendation: QR version 3 at ECC level H — 29×29 modules, 24 bytes.** It carries the
full report with room to spare, and ECC H is exactly right here for the opposite reason to
the forward link: the reverse channel is *not* an erasure channel with a fountain code
behind it. It is a single small message that must land, so redundancy belongs *in the
symbol*, not in a code above it. This is the one place in screenferry where the D2 argument
for ECC L is inverted.

Note the asymmetry: version 3 has 29 modules across versus version 15's 77. **At the same
physical size on screen, a v3-H code has 2.7× the module pitch of the forward link's v15-L
tiles.** So the reverse link tolerates roughly 2.7× worse geometry than the forward link
already requires. If the forward link works at all, the reverse link has enormous margin.

### 7.3 The protocol

**Static, not animated.** The receiver holds one code and swaps it when its contents change,
at most **~1 Hz**. Reasons: (a) a static code is immune to the frame-mixing problem
entirely — no rolling-shutter tearing of a code that isn't changing; (b) the sender's camera
can integrate over many frames and use majority voting across repeated decodes; (c) a 1 Hz
update rate is far below the loop bandwidth §9 recommends anyway, so it costs nothing.

**Idempotent, not sequenced.** Every report is a complete snapshot of current state. There
is no reliability requirement, no retransmission, no ordering. A lost report just means the
sender uses the previous one. This is the opposite of QRFileTransfer's stop-and-wait design
and it is why it will be fast.

**Include a monotonic counter** in the session ID field's spare bits so the sender can tell
"new report" from "same report re-decoded", and so it can measure the reverse link's own
health.

**Minimum viable reverse geometry.** The sender needs to resolve 29 modules at ≥4 px/module
plus a 4-module quiet zone on each side = 37 modules × 4 px = **148 pixels across**. For a
laptop webcam at 720p (1280 px wide) that is 11.6% of frame width — trivially achievable
with a phone screen held at 30–50 cm. Even a heavily-cropped ROI has ample margin. **The
reverse link is not the hard part.**

### 7.4 What the reverse channel should *not* carry

Not per-packet ACKs (QRFileTransfer demonstrates the cost). Not the received-packet list.
Not a NACK/retransmit request — the fountain code makes retransmission meaningless, since
every packet is equally novel. The entire value is in **aggregate link state plus a stop
signal**.

---

## 8. Bootstrap: the chicken and egg

### 8.1 How real systems solve it

**802.11 basic rate set.** Beacons, probe responses, management and control frames, and all
broadcast/multicast traffic go at the **lowest basic rate** — a rate every associable
station is required to support. It requires no measurement because it is mandatory. Data
rate selection then *descends* from an optimistic start: ARF, AARF, SampleRate and RRAA all
begin at the **highest** rate and fall (SampleRate drops a rate after **4 successive
failures**, giving a fast staircase descent); ONOE starts mid-ladder at 24 Mbps.
References: Bicket, MIT MS thesis 2005 <https://pdos.csail.mit.edu/papers/jbicket-ms.pdf>;
Wong et al., RRAA, MobiCom 2006
<https://dineshb-ucsd.github.io/files/teaching/ece-257b/papers/rraa.pdf>.

**DVB-S2 ACM** pays for loop delay in explicit margin. NASA's SCaN Testbed report
(<https://ntrs.nasa.gov/api/citations/20170004115/downloads/20170004115.pdf>) measured ACM
delivering **4.34 dB average** improvement over fixed CCM and coming within **0.25 dB of the
zero-delay ideal** — but at **500 ms round-trip delay they carried 2 dB of link margin, and
reducing RTT to 40 ms let them cut it to 1 dB**. That is the price of loop latency, in dB.

**LTE/5G outer-loop link adaptation (OLLA)** is the best structural model available and §9
recommends copying it directly.

**ABR video** ladders are pre-computed and the client starts at a conservative rung, then
climbs.

### 8.2 What screenferry's beacon should carry and how often

The beacon must be decodable **in every geometry the app claims to support**, including
phone→phone at ~54 cells (plan §5). Concretely: **one single QR code filling the frame, at
the most robust version/ECC that still carries the manifest** — not a tile grid.

**Contents:**
- `magic_ver`, `streamId` — so the receiver can lock the session (plan §4.2 already
  requires locking on first valid header).
- `payloadLen`, compression flag — so `K` and fragment length can be derived.
- **The profile ladder descriptor**: which profiles this sender will use and in what
  proportion, so the receiver knows what to look for and can size its decoder work.
- **Whether the sender is watching for a reverse channel**, and where on screen it expects
  to see it. Without this the receiver has no reason to display a report at all.
- File name and a whole-file hash (or the hash can ride the final-metadata bit as planned).

**Re-emission schedule.** This matters more than it looks, because of three cases: a
receiver arriving late, a receiver that lost lock (autofocus hunt, user glanced away), and a
receiver whose geometry changed. WiFi beacons default to **~100 ms**; that is far too
frequent here, where a beacon frame costs a whole frame's payload.

Recommended: **one beacon frame every ~2 seconds (≈1 in 25 frames at 12–15 fps, ~4%
overhead), plus a burst of 3–5 consecutive beacons at session start**, plus an immediate
beacon whenever the sender changes its profile ladder. The 4% is comparable to Minstrel's
and SampleRate's 10% probe budget and much cheaper. If a back-channel exists and reports a
locked session, the sender can back the beacon rate off to one every 10 seconds.

**A cheap refinement:** rather than sacrificing a whole frame, reserve **one tile position**
in every frame for a rotating beacon fragment, rendered at the robust profile. At 15 tiles
that is a permanent 6.7% cost but gives continuous re-acquisition with no periodic
throughput dropout. Compare Strata's reserved block: the same idea — pay a fixed area tax
for guaranteed decodability of the most important stratum.

### 8.3 Local bootstrap needs no protocol at all

Per §4.2, seven of ten metrics survive total decode failure. Before a single tile decodes,
the receiver already knows px/module, blur, motion, delivered fps and exposure state. So the
"receiver can report nothing until it decodes something" framing is only true for the
*protocol*. Locally, the receiver can drive its own UI coaching and its own ROI/exposure
choices from frame one. **The bootstrap problem is a back-channel problem, not a
measurement problem.**

---

## 9. Stability and oscillation

*(WiFi/LTE/ABR constants in this section come from a dedicated sub-thread; primary sources
cited inline.)*

### 9.1 Why rate control oscillates, and how bad the signal is

RRAA instrumented ARF's two triggers on real hardware and found both worse than coin flips:
after **10 consecutive successes**, the probability the *next* transmission **fails is
71.5%**; after two consecutive failures, the probability of another failure is only **36.8%**.
Loss is a Bernoulli sample and its variance dominates at small N.

The mechanisms are: (a) sampling noise in the control signal; (b) asymmetric probe cost;
(c) loop delay between actuation and observable effect; (d) symmetric thresholds, so the
up- and down-triggers fire on overlapping evidence.

**Screenferry is better placed than WiFi on (a) and (b), and worse on (c).**

On (a): a 15-tile frame yields 15 Bernoulli samples per frame, i.e. **225/second at 15 fps**.
The standard error of an erasure-rate estimate is `√(p(1−p)/N)`. At p = 0.2:

| Window | N (tiles) | σ |
|---|---|---|
| 1 frame | 15 | 10.3 pp |
| 0.5 s | ~112 | **3.8 pp** |
| 1 s | ~225 | **2.7 pp** |
| 2 s | ~450 | 1.9 pp |

So a **1-second window already gives ±2.7 pp**, which is tight enough for a ~10 pp
hysteresis band. This is dramatically better than WiFi, which sees one binary outcome per
frame and therefore needs "tens or hundreds of frames" (SoftRate's phrasing).

On (b): §3.4 — probing is free here.

On (c): loop delay is the problem. Camera exposure + transfer + worker decode is tens of
milliseconds; a reverse-channel hop at 1 Hz adds up to a second; and the *sender* then has
to re-render. NASA's 500 ms → 2 dB / 40 ms → 1 dB exchange rate is the warning.

### 9.2 The damping toolkit, with real constants

| Mechanism | Real system | Constant |
|---|---|---|
| EWMA smoothing | Linux `minstrel_ht` | `EWMA_LEVEL 96 / EWMA_DIV 128` → **α = 0.75 history, 0.25 new**, applied every **50 ms** (`update_interval = HZ/20`) |
| Probe interval | `minstrel_ht` | `MINSTREL_SAMPLE_INTERVAL = HZ/50` = **20 ms**; `MINSTREL_SAMPLE_RATES 5` |
| Probe budget | minstrel, SampleRate | **10%** of frames |
| Hysteresis band | RRAA | up-threshold `P_ORI(R) = P_MTL(R⁺)/β` with **β = 2** — you only step up if loss is below *half* the loss that would force the rate above you back down |
| Safety margin on break-even | RRAA | `P_MTL(R) = α·P*(R)` with **α = 1.25** — 25% above the analytic tipping point |
| Window granularity rule | RRAA | **`1/ewnd < P_ORI`** — the measurement granularity must be finer than the threshold it is compared against |
| Fast-down | RRAA | early exit: if the *best possible* remaining loss already exceeds `P_MTL`, drop immediately without waiting for the window |
| Probe eligibility | SampleRate | **never probe a rate whose lossless transmission time already exceeds the current best rate's average** |
| Minimum dwell | MADWiFi SampleRate / ONOE | **2 s** / **10 s lockout** on a rejected rate |
| Asymmetric up/down | LTE OLLA | up-step = `(τ/(1−τ))` × down-step; τ = 0.1 → **1:9** |
| Switching penalty | Pensieve/MPC QoE | quality *change* penalised at weight 1.0, equal to quality *gained* |
| Optical precedent | COBRA | +50% block size instantly on 1 s of high acceleration; −1 px/s on the way back |
| Optical precedent | MAMBA | dead band `R_lo=3 ≤ R ≤ R_hi=6` retransmissions per window of W=5; steps of 1 px |

Sources: minstrel kernel docs
<https://wireless.docs.kernel.org/en/latest/en/developers/documentation/mac80211/ratecontrol/minstrel.html>
and `net/mac80211/rc80211_minstrel_ht.h`; RRAA
<https://dineshb-ucsd.github.io/files/teaching/ece-257b/papers/rraa.pdf>; SampleRate
<https://pdos.csail.mit.edu/papers/jbicket-ms.pdf>; OLLA
<https://nvlabs.github.io/sionna/rk/tutorials/link_adaptation/olla/olla.html> and
<https://arxiv.org/pdf/2510.05784>; Pensieve
<https://web.mit.edu/pensieve/content/pensieve-sigcomm17.pdf>.

**The recurring pattern across every algorithm that works: the up path is gated, budgeted,
filtered and delayed; the down path is immediate.**

### 9.3 The structural recommendation: OLLA, not a profile-index integrator

The single best idea from this literature is LTE's outer-loop link adaptation. It **never
chooses a profile directly.** It maintains a *scalar bias* on a physical estimate:

```
quality_eff = quality_measured + Δ
Δ ← Δ + Δ_up     on success
Δ ← Δ − Δ_down   on failure,     with   Δ_up = (τ / (1 − τ)) · Δ_down
```

and the profile is a **stateless lookup table** on `quality_eff`. For a 10% target residual
erasure rate, τ = 0.1 gives exactly the **1:9** asymmetry. Sionna ships `OLLA_STEP_SIZE
1.0 dB` with `OLLA_TARGET_BLER 0.1`.

Why this is right for screenferry: the bias absorbs all model error — glare, camera gamma,
screen ABL, rolling shutter, an unknown ISP — without the profile index itself becoming the
integrator. If `quality` is measured px/module and the lookup table maps px/module →
profile, then `Δ` is in *effective module units* and silently corrects for every unmodelled
effect. And because it is stochastic approximation, it provably drives the long-term erasure
rate to τ.

**And τ should not be zero.** A fountain code *wants* some erasures — pushing residual
erasure rate to zero means the profile is too conservative and throughput is being left on
the table. VMRA reached the same conclusion independently with `PER* = 10–15%`. The right
target for screenferry is probably **higher** than 10%, because a fountain code tolerates
erasures far better than an ARQ system does; §11 suggests 20–30% as a starting point, to be
tuned in Phase 3 against measured goodput rather than assumed.

### 9.4 Concrete time constants for 15 fps

Frame period 66.7 ms. Three constraints:

1. **Deadband > 2σ of measurement noise.** From §9.1, a 1 s window gives σ ≈ 2.7 pp, so a
   band of **≥ 6–10 percentage points** between up- and down-thresholds. RRAA's β = 2 gets
   this by construction.
2. **Granularity: `1/N_window < threshold`.** With 225 tile samples per second this is
   satisfied trivially for any threshold above 0.5%.
3. **Sample time ≤ 0.1 × process time constant** (standard process control,
   <https://controlguru.com/sample-time-is-a-fundamental-design-and-tuning-specification/>).
   RRAA applies the mirror constraint on the window: their `ewnd` spans roughly **1/7 of the
   channel coherence time**.

Screenferry's channel coherence time — how long a handheld geometry stays effectively
stationary — is **unmeasured and should be measured in Phase 3**. Hand tremor suggests
0.3–1 s. Given that:

| Parameter | Recommendation | Rationale |
|---|---|---|
| Measurement window | **0.7–1.0 s (~10–15 frames, ~150–225 tile samples)** | σ ≈ 3 pp; ≈1/1 to 1/3 of estimated coherence time |
| EWMA α | **0.75 history / 0.25 new**, updated per frame | minstrel's constant; 63% settling ≈ 4 frames ≈ 270 ms |
| Actuation interval / min dwell | **≥ 2× the window ≈ 2 s**, restart the window on every change | RRAA restarts on change; MADWiFi shipped 2 s |
| Step-down | **immediate** on a hard trigger (0/N tiles for 3 consecutive frames, or px/module below the cliff) | RRAA's early-exit; COBRA's instant +50% |
| Step-up | **one rung, after a full clean window, with a 1:9 OLLA bias** | fast down / slow up |
| Beacon re-emission | **every ~2 s**, or one reserved tile per frame | §8.2 |
| Reverse-channel report | **~1 Hz**, idempotent | §7.3 |
| Ladder-narrowing schedule | wide for the first **~5 s**, narrow thereafter | §3.3 — hedge while `p` is unknown |

The overall loop bandwidth lands around **0.3–0.5 Hz**, which is comfortably slower than
hand tremor (which the ladder absorbs rather than tracks) and comfortably faster than a user
repositioning the device.

---

## 10. Recommendations for screenferry

### 10.1 Tier the work — do not build the loop first

| Tier | What | When | Expected value |
|---|---|---|---|
| **T0. Measure and coach** | Compute the seven decode-free metrics (§4.2); drive the UI only. No adaptation at all. | **Phase 3–4** | High. Fixes "why isn't it working" with zero protocol risk. Already implied by plan Phase 4's "live px/module readout". |
| **T1. Local open-loop adaptation** | Receiver-side: ROI, exposure, frame selection by DOB. Sender-side: COBRA-style step-down on the *sender's* accelerometer. | **Phase 3–4** | Medium-high. No protocol change; both sides act on what they can already see. |
| **T2. The profile ladder** | Sender interleaves two or three profiles into the frame stream at fixed weights; all packets feed one fountain decoder. | **Phase 3** | **Highest value per unit of effort.** Removes the fixed-guess failure mode entirely; probing is free (§3.4). |
| **T3. Soft hints** | Harvest RS symbols-corrected per tile if zxing-wasm exposes it; otherwise §10.5. | **Phase 3 (investigate), Phase 5 (exploit)** | Potentially 2× (SoftRate/SoftLight precedent). Verify exposure first — this is a research spike, not a commitment. |
| **T4. Ladder weight adaptation** | Shift the ladder's weights, not the profiles themselves, from local metrics. OLLA-style scalar bias. | **Phase 5** | Medium. Captures most of closed-loop's benefit with none of its protocol cost. |
| **T5. Bidirectional negotiation** | Optional propped-up mode with a v3-H reverse code at 1 Hz. | **Phase 6+, opt-in** | Modest for throughput (MAMBA: 5–20%) but resolves two things nothing else can: delivered fps, and when to stop. |

**The ordering is the recommendation.** T2 before T4, and T4 before T5. Most of the value in
the literature comes from the coding paradigm (T2/T3), not the loop (T4/T5).

### 10.2 The profile ladder

Define profiles by **module size in screen pixels**, which is the quantity that maps
directly to the measured px/module at the receiver. Suggested initial ladder — numbers to be
calibrated in Phase 3, not treated as final:

| Rung | Name | QR version | Tiles/frame | Rel. rate | Survives down to |
|---|---|---|---|---|---|
| **R0** | **Beacon** | single v10-M filling the frame | 1 | 0.04× | anything that can see the screen at all |
| **R1** | Conservative | v10-L | ~6 | 0.35× | phone→phone at short range; heavy blur |
| **R2** | Nominal | v15-L (plan D2) | ~15 | 1.0× | the design point |
| **R3** | Aggressive | v20-L | ~24 | 1.6× | laptop→phone, steady, close |

**Initial weights (first ~5 s, `p` unknown): 15% R1 / 60% R2 / 25% R3.**
**Steady state once measured: shift toward whichever rung the measurements support**, but
never drop any rung below **10%** — that residual is what lets the receiver recover if the
geometry changes, and it costs almost nothing because the packets it delivers are real.

Weights are **frame-area fractions**, allocated as whole tiles within each frame rather than
whole frames per rung. Mixing rungs *within* a frame is better than alternating frames,
because it keeps every frame useful to every channel condition and avoids a periodic
"dead frame" for a receiver that can only decode one rung.

Every tile at every rung carries the **same 13-byte header** and feeds the **same fountain
decoder**. This is the property that makes the whole scheme cost almost nothing: the
modulation interface (`decodeFrame → 0..n packets`) already permits it, and nothing above the
modulation layer needs to know rungs exist. Plan §3.1's statement that "a frame where 3 of
15 tiles decode is a perfectly good frame" already covers the ladder case exactly.

### 10.3 Damping

Adopt OLLA's structure (§9.3):

```
pxPerModule_eff = EWMA(pxPerModule_measured, α=0.75) + Δ
rung            = lookupTable(pxPerModule_eff)        # stateless
Δ              += step_up    on a clean measurement window     # step_up = step_down/9
Δ              -= step_down  on an erasure-rate breach
```

with `step_down` ≈ 0.2 px/module, `step_up` ≈ 0.022 px/module, window 0.7–1.0 s, minimum
dwell 2 s, and an **immediate** hard step-down (bypassing the window) if either 0/N tiles
decode for 3 consecutive frames or measured px/module falls below the cliff. Target residual
erasure rate **20–30%**, not zero — validate against measured goodput in Phase 3.

The ladder itself is the primary damping mechanism: because every rung is always present at
≥10%, a wrong `Δ` degrades throughput rather than stopping the transfer, so the loop can be
tuned lazily and conservatively without risking a hang.

### 10.4 The negotiation protocol, if built

Build it only as an **explicit opt-in "Two-way mode"**, with UI that tells the user to prop
both devices facing each other. Design:

- **Role election:** MAMBA's UID comparison — both sides generate a random 32-bit ID and the
  higher becomes sender. No out-of-band agreement, no "who taps first".
- **Reverse code:** QR **v3-H, 29×29 modules, 24 bytes**, static, updated at ~1 Hz,
  idempotent snapshot, monotonic counter, CRC-8. Rendered at a fixed screen position the
  beacon announces. §7 for the field layout.
- **What it changes on the sender:**
  1. **Display rate**, from delivered-fps (D9's half-rate rule applied to a *measured*
     number rather than a guess). This is the highest-value field.
  2. **Ladder weights** — shift the distribution, do not replace the ladder. Never collapse
     to a single rung; keep the 10% floors.
  3. **Stop condition** — when reported `rank/K ≥ 1.0` and the whole-file hash verifies,
     the sender may stop. This resolves plan open question 6 outright.
- **What it must not do:** per-packet ACK, retransmit requests, or blocking on the reverse
  link. The forward stream must run at full rate whether or not any report ever arrives.
  Reports are advisory. If the reverse channel dies, the system degrades exactly to the
  one-way baseline and nothing breaks.

### 10.5 If zxing-wasm does not expose RS correction counts

Three fallbacks, in order of cost:

1. **Per-tile decode rate as a graded signal.** With 15 tiles, `k/15` is already a 16-level
   quality measure per frame — coarse, but far better than binary and available today.
2. **Rung-differential decoding.** Because the ladder puts multiple rungs in the same frame,
   the *ratio* of R3 successes to R2 successes is itself a margin estimate: if R2 decodes
   15/15 and R3 decodes 0/24, the channel is between the two, and by how much is
   inferrable. This is a soft hint synthesised from a hard-decision decoder, obtained purely
   from the ladder's existing structure. **This costs nothing and should be implemented
   regardless.**
3. **Deliberate canary tiles.** Reserve one or two tiles per frame at a rung *above* the
   current nominal (a v25 or v30 tile). They decode only when there is real headroom, so
   their success rate is a direct up-step trigger. This is Minstrel's probe, except the
   probe carries payload.

Option 2 is the one to build first. It turns the ladder from a hedging device into a
*measurement instrument*, which is a second, independent reason to build the ladder before
the loop.

### 10.6 Things this research says not to do

- **Do not build hierarchical/superposition modulation.** §2. The fountain code already
  provides what it exists for; DVB-T2 deleted HM within one generation; Strata's own numbers
  show a 33% capacity cost; and screen codes have no pooled power constraint to exploit.
- **Do not build multi-level greyscale layering.** Strata measured it and the captured
  greyscale peaks do not separate (Fig. 18).
- **Do not put ACKs on the reverse channel.** QRFileTransfer is the demonstration of what
  that costs.
- **Do not adapt ECC level.** The channel is an erasure channel and redundancy belongs in
  the fountain code (plan D2). SoftLight makes the same argument: its RS parity is fixed at
  20% and "does not need to change for different environments, since SoftLight adapts to
  different link qualities by rateless coding but not RS parity checking." Adapt geometry,
  not redundancy. The reverse channel is the single exception (§7.2).
- **Do not target zero erasures.** A fountain code wants a nonzero residual erasure rate;
  driving it to zero means the profile is too conservative.
- **Do not let the profile index be the integrator.** Integrate a scalar quality bias; make
  the profile a stateless lookup (§9.3).

---

## 11. Open questions this research did not close

1. **Does zxing-wasm expose Reed–Solomon symbols-corrected per symbol?** Determines whether
   T3 is a config change or a decoder fork. Highest-value unknown in this document.
2. **What is the actual channel coherence time of a handheld screen-camera link at 20–40
   cm?** Every time constant in §9.4 is derived from an estimate of 0.3–1 s. FOCUS measured
   <3% BER difference between handheld and tripod at 2–6 m, which suggests hand motion may
   matter less than assumed — but that is at metres, not centimetres.
3. **Screen-to-screen specular glare.** No published measurement found. Cheap to test and it
   is the main un-assessed risk to the bidirectional mode.
4. **RainBar+'s feedback mechanism** (§1.9) — full text unobtainable. It is the one closed-
   loop optical system whose design is unknown to this document.
5. **What residual erasure rate actually maximises goodput** for an LT/GE fountain code at
   K≈1000? §10.3 guesses 20–30% from VMRA's 10–15% plus the erasure-tolerance argument, but
   this is *directly simulatable* with the existing `sim/fountain_overhead_sim.py` harness
   and should not stay a guess.
6. **Does mixing rungs within a frame hurt tile localisation?** Different QR versions in one
   grid means different finder-pattern sizes; zxing reads multiple symbols per frame but its
   row-skip heuristic (`iSkip = 3·maxI/(4·MAX_MODULES)`) assumes a single scale. Needs a
   Phase 3 experiment.

---

## 12. Source index

**Screen-camera / VLC systems**

- Strata — <https://dl.acm.org/doi/10.1145/2639108.2639132> · full text mirror <https://silo.tips/download/strata-layered-coding-for-scalable-visual-communication>
- SoftLight (INFOCOM'16) — <https://doi.org/10.1109/INFOCOM.2016.7524510> · (TMC'17) <https://doi.org/10.1109/TMC.2016.2551750> · PDF <https://web.archive.org/web/2020id_/https://wands.sg/publications/full_list/papers/TMC_17_2.pdf>
- COBRA — <https://dl.acm.org/doi/10.1145/2307636.2307645> · PDF <https://web.archive.org/web/2018id_/http://www.cse.msu.edu/~glxing/docs/COBRA-mobisys12.pdf>
- LightSync — <https://dl.acm.org/doi/10.1145/2500423.2500437>
- RDCode — <https://dl.acm.org/doi/10.1145/2639108.2639135>
- FOCUS — <https://user.it.uu.se/~eding810/conferences/Mobisys16.pdf>
- PixNet — <https://doi.org/10.1145/1859995.1860012>
- ChromaCode — <https://dl.acm.org/doi/10.1145/3241539.3241543>
- HiLight — <https://www.cs.columbia.edu/~xia/publication/mobisys15-hilight/mobisys15-hilight.pdf>
- InFrame++ — <https://doi.org/10.1145/2742647.2742652>
- TextureCode — <http://www.winlab.rutgers.edu/~yaqin120/uploads/7/1/3/7/71378775/infocom-final.pdf>
- TETRIS — <https://ieeexplore.ieee.org/document/8108801>
- S2SVLC channel characterisation — <https://arxiv.org/abs/2506.23005>
- VMRA — <https://www.winlab.rutgers.edu/~aashok/visualmimo/aashok_secon2011.pdf>
- RainBar+ — <https://doi.org/10.1109/TWC.2018.2873731> (full text unobtainable)

**Bidirectional optical**

- CamTalk — <https://eudl.eu/doi/10.1007/978-3-319-04283-1_3>
- Montoya Freire & Di Francesco, WoWMoM'16 — <https://ieeexplore.ieee.org/document/7523499>
- MAMBA — <https://acris.aalto.fi/ws/portalfiles/portal/76117769/SCI_Bufalino_MAMBA_Adaptive_and_Bi_directional_Data_Transfer.pdf>
- QRFileTransfer — <https://github.com/LucaIaco/QRFileTransfer> · <https://lucaiaco.github.io/QRFileTransfer/>

**Hierarchical modulation and layered coding**

- EBU Tech Review, hierarchical modulation — <https://tech.ebu.ch/docs/techreview/trev_294-weck.pdf>
- DVB-T spec (Annex A C/N tables) — <https://dvb.org/wp-content/uploads/2019/12/a012_dvb-t_june_2015.pdf>
- DVB-T2 Implementation Guidelines (PLPs; no HM) — <https://telcogroup.ru/files/materials-pdf/DVB_standards/DVB-T/a133_DVB-T2_Imp_Guide.pdf>
- Cover, *Comments on Broadcast Channels* — <https://isl.stanford.edu/~cover/papers/cover_98.pdf>
- SVC overhead — <https://www.hhi.fraunhofer.de/en/departments/vca/research-groups/video-coding-technologies/research-topics/past-research-topics/multi-layer-encoder-control-for-svc.html>
- SVC vs simulcast in practice — <https://www.digitalsamba.com/blog/svc-vs-simulcast-in-webrtc>

**Rate adaptation and control**

- SampleRate (Bicket thesis) — <https://pdos.csail.mit.edu/papers/jbicket-ms.pdf>
- RRAA — <https://dineshb-ucsd.github.io/files/teaching/ece-257b/papers/rraa.pdf>
- SoftRate — <https://people.csail.mit.edu/hari/papers/p111.pdf>
- Minstrel docs — <https://wireless.docs.kernel.org/en/latest/en/developers/documentation/mac80211/ratecontrol/minstrel.html>
- OLLA — <https://nvlabs.github.io/sionna/rk/tutorials/link_adaptation/olla/olla.html> · <https://arxiv.org/pdf/2510.05784>
- DVB-S2 ACM (NASA SCaN) — <https://ntrs.nasa.gov/api/citations/20170004115/downloads/20170004115.pdf>
- Pensieve / ABR QoE — <https://web.mit.edu/pensieve/content/pensieve-sigcomm17.pdf>
- BOLA — <https://arxiv.org/abs/1601.06748>
- Sample-time rule of thumb — <https://controlguru.com/sample-time-is-a-fundamental-design-and-tuning-specification/>

**Measurement primitives**

- ZXing `FinderPatternFinder` — <https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/detector/FinderPatternFinder.java>
- ZXing `FinderPattern` — <https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/detector/FinderPattern.java>
- Variance-of-Laplacian focus metric (Pech-Pacheco et al., ICPR 2000) — <https://ieeexplore.ieee.org/document/903548>
- iPhone 14 front autofocus — <https://www.apple.com/newsroom/2022/09/apple-introduces-iphone-14-and-iphone-14-plus/> · <https://www.dxomark.com/apple-iphone-14-pro-selfie-test/>

---

### Provenance note

Numbers attributed to Strata, SoftLight, COBRA, MAMBA, FOCUS, VMRA, S2SVLC, TETRIS, ZXing
and QRFileTransfer were read from the primary sources listed above during this research
thread. The DVB-T C/N deltas (§2.1) and the superposition-versus-TDMA table (§2.2) are
**computations from published tables and formulas**, not quoted results, and are marked as
such at the point of use. The WiFi/LTE/ABR constants in §8–9 come from the primary sources
cited inline. RainBar+ (§1.9) is reported as a known gap rather than summarised, because its
full text could not be obtained.

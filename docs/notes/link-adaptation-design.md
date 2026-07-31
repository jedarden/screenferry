# Link adaptation — what's essential, what's over-building

Raised during planning: *"There probably needs to be some sort of test of camera
quality and how lossy the data is, to dynamically set up the transfer. Maybe
something negotiated between the two instances? Or is this overoptimizing?"*

Both halves of that are right, and they pull in different directions. This note
splits adaptation into three tiers, because they have wildly different
cost/benefit and only the first two belong in v1.

Prior art is being researched separately → `../research/link-adaptation.md`.

---

## Why adaptation is not optional: the failure is binary, not gradual

The instinct to adapt is correct, and the reason is sharper than "it would be
faster." **Guessing the profile too aggressively does not make the transfer slow.
It makes it produce nothing at all.**

4 px/module is a **cliff, not a slope**. Above it, tiles decode. Below it, zxing
returns nothing — not corrupted data, nothing. A user holding the phone 5 cm too
far away gets a 0 KB/s transfer with no error message and no explanation. There is
no graceful degradation to fall back on, because the whole design deliberately
converted this into an erasure channel.

So the question is not "should we tune for speed" but "how do we avoid shipping a
tool that silently does nothing." That reframing is what makes tiers 1 and 2 below
mandatory and tier 3 optional.

---

## The structural gift: the fountain code already *is* an adaptation mechanism

The reason screenferry can adapt cheaply — far more cheaply than a conventional
protocol — is that **it never has to choose.**

In a conventional link, adaptation means *selecting* a modulation rate, which means
measuring the channel, deciding, and coordinating the change with the far end.
That is the expensive machinery, and it's what "negotiation" implies.

Under a rateless code, packets are fungible. The receiver's GE matrix does not
know or care which physical profile a packet arrived under — a packet from a dense
frame and a packet from a conservative frame are equally useful rows. Therefore:

> **The sender can emit a *mix* of profiles simultaneously and let the channel
> decide which ones survive.** No measurement, no decision, no coordination.

This composes so cleanly that it is worth stating as a design property: adaptive
modulation and rateless coding multiply rather than merely coexist. Changing
profile mid-stream requires no resync, invalidates nothing already collected, and
has no failure mode — because "this frame didn't decode" was already the normal
case the entire system is built around.

### The one constraint that makes it work — fix the fragment size

A fountain packet is defined over K fragments of fixed length L. **If L changes,
K changes, and every previously collected packet becomes garbage.**

So:

- **L is fixed at session start and never changes.** Not per profile, not ever.
- Profiles may vary: tile QR version, module pixel size, tile count per frame,
  sender fps, and (later) colour on/off.
- Profiles may **never** vary: fragment length, and therefore K and the PRNG
  index derivation.

Pick L to fit the smallest tile any profile would use, and let denser tiles carry
several packets each. Padding waste is a few percent — cheap insurance against a
class of bug that would silently corrupt transfers.

This constraint is easy to violate accidentally (it looks natural to "just use
bigger fragments for the dense profile") and the symptom would be baffling, so it
belongs in the plan as a hard rule.

---

## The three tiers

### Tier 1 — Receiver self-tuning. **Essential. Already partly in the plan.**

No protocol, no back-channel, no sender involvement. The receiver configures
*itself* and coaches the user. This is where nearly all the measured wins are:

| Lever | Measured effect | Status |
|---|---|---|
| `exposureCompensation: min` | 15.0 → 41.6 fps (2.8×) | D14 |
| ROI crop before decode | 9× decode speedup | in plan §3.3 |
| Measure real fps, don't trust `getSettings()` | prevents a 2× sender-rate error | D14 |
| Focus lock | stops autofocus hunting mid-transfer | `browser-qr-scanning` |
| Exposure generally | 2.4× throughput swing | `custom-codec` |
| **Live px/module readout + "move closer"** | defends the 4 px/module cliff | in plan, Phase 4 |

**This tier is not optimisation — it is the difference between working and not.**
It needs no negotiation whatsoever, and it is where effort should go first.

### Tier 2 — Sender simulcast ladder. **Cheap, do it in v1.**

The sender interleaves frames at 2–3 robustness profiles — say 60% aggressive,
30% moderate, 10% conservative. The receiver harvests whatever decodes. All
packets feed one decoder.

- **No back-channel. No measurement. No decision. No oscillation risk.**
- A receiver in good conditions harvests nearly everything; a receiver in bad
  conditions still harvests the conservative frames and completes, slowly.
- Cost is bounded and known: capacity spent on profiles a given receiver didn't
  need. Roughly the inverse of how well-matched a fixed guess would have been.
- Crucially, it removes the catastrophic case — **a mis-guessed fixed profile
  yields zero; a ladder always yields something.**

This captures most of the benefit of negotiation for a fraction of the complexity,
and it exists *only* because of the rateless code.

### Tier 3 — Closed-loop negotiation between instances. **Probably over-building. Defer.**

The full version of the original idea: receiver measures the channel and reports
back; sender converges on the optimal profile.

**It is physically possible** — screen and front camera face the same direction on
every phone and laptop, so two devices facing each other can each see the other's
screen. Two phones screen-to-screen, or a laptop facing a phone, both work
geometrically. And the reverse channel needs almost nothing: ~10–30 bytes of link
report fits in **one static QR** the receiver holds on screen and updates once a
second — no animation, no fountain code, trivially robust.

**But the cost is real:**

- It only works in **face-to-face geometry using front cameras**, which are the
  worse cameras. The natural scanning posture — rear camera pointed at a screen —
  cannot support a back-channel at all. So it is not a general mechanism; it is a
  mode that applies to some setups.
- It requires both devices propped up facing each other. Ergonomically awkward.
- It adds a reverse protocol, a bootstrap problem (the receiver can't report until
  it decodes *something*, so the session must still open at a conservative beacon
  profile — i.e. tier 2's ladder is needed anyway), and a new silent failure mode.
- Closed-loop rate adaptation is notoriously prone to **oscillation**. WiFi rate
  control is a decades-long research embarrassment for exactly this reason. A
  user's hand wobbling at 2 Hz against a multi-second measurement window is a
  textbook setup for flapping, and would need hysteresis and damping designed and
  tuned.

**Verdict: yes, this is the overoptimising half.** It buys the delta between "a
reasonable mix of profiles" and "the single optimal profile" — and tier 2 already
captures most of that, at zero protocol cost. Revisit only if measurement after
Phase 3 shows the ladder's waste is actually significant.

---

## The bootstrap rule (needed for all tiers)

Whatever else happens, **the session must open at a conservative profile that is
essentially always decodable**, analogous to WiFi's lowest basic rate — and the
sender should re-emit that beacon periodically mid-transfer, not just at the start.

This is what lets a receiver join late, or re-acquire after losing lock, without
restarting the sender. The fountain design already demonstrated late-join recovery
in testing (a receiver joining 700 ms late still reassembled everything), and
periodic beacons are what generalise that to "pointed the phone away for ten
seconds."

---

## Recommendation

1. **Do tier 1 properly.** It is already most of the plan's adaptive value, it has
   the largest measured effects, and it needs no negotiation.
2. **Do tier 2 in v1.** It is nearly free given the fountain code, and it converts
   the catastrophic mis-guess case into a merely-slow case.
3. **Fix L at session start** and write it into the plan as a hard rule.
4. **Defer tier 3.** Reassess after Phase 3 with real numbers. It is a genuinely
   interesting mode — a two-way optical link is a nice thing to have built — but
   it is not what makes the product work.

The honest summary: the *measurement* half of the original instinct is essential
and under-specified in the plan; the *negotiation* half is the part to leave out.

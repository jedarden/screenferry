# Future features — considered, not planned

Ideas deliberately kept **out of `docs/plan/plan.md`** so the plan stays the
committed scope, but worth preserving because the reasoning behind them is
non-obvious and would cost real effort to re-derive.

Nothing here is scheduled. Nothing here has a bead. Promoting an item to the plan
is a deliberate act, not a default.

For the full record of every idea ever considered — including the ~90 that were
killed and why — see [`ideas-ledger.md`](ideas-ledger.md).

---

## Multi-receiver broadcast

**One sender, many receivers, simultaneously.** Several people point their phones
at the same screen and all receive the same file at once.

*Status: not planned. Recorded here after the 2026-07-31 ideation run (finalist
F9), where it survived the adversarial kill pass but was kept out of scope.*

### Why it needs no coordination mechanism

The interesting property, and the reason this is worth writing down: **there is
nothing to build for the receivers to coordinate.** It falls out of the existing
design rather than requiring a protocol.

- The sender is **already broadcasting blindly**. It has no back-channel, so it
  cannot know whether zero, one, or ten receivers exist — and does not need to.
  Adding receivers costs the sender nothing: no per-receiver state, no fan-out,
  no scheduling.
- Each receiver independently locks the same `streamId`, collects whatever it
  decodes, and runs its own Gaussian-elimination decoder. Receivers never
  interact and never need to know about each other.
- **The fountain code is what makes this work.** Every receiver needs *any* K+ε
  linearly independent packets, not any *particular* ones. Two receivers with
  entirely different loss patterns — one fighting glare, one at a bad angle —
  both complete from the same stream without the sender doing anything
  differently.

This is not a happy accident. Reliable **multicast** is the problem fountain codes
were originally invented for; the one-way file transfer case is the degenerate
single-receiver version of it. screenferry gets multicast for free because it
already pays the rateless-coding cost for a different reason.

### What would actually need building

Very little, which is why it stayed a finalist through the kill pass:

1. **UI that stops implying 1:1.** The main work. Copy, progress model, and
   completion flow currently assume one receiver; none of that is load-bearing,
   but all of it reads wrong with several.
2. **Repair codes must union.** If receiver A is missing blocks {5, 9} and B is
   missing {17}, the sender takes the union of every code entered. Small change to
   the §6.2 repair mechanism, and the only protocol-level work.
3. **Slightly more generous dwell.** With several receivers the worst channel
   dominates, so the D16 ladder should skew a little more conservative.

### The real constraints are physical, not technical

- **Everyone needs line of sight**, and px/module degrades off-axis. This is
  realistically "four people around a laptop screen", not a lecture hall. The
  4 px/module cliff applies per-receiver, so someone at a steep angle simply gets
  nothing.
- **The slowest receiver sets the duration.** The sender loops until a human stops
  it, so with multiple receivers *someone has to decide when everyone is done*.
  That is social coordination, and no amount of protocol design removes it.

### Why it is not in the plan

It is a genuine differentiator — AirDrop and Nearby Share cannot broadcast to a
room — and the marginal cost is low. But it is **almost entirely UI work for a use
case nobody has asked for yet**, and the plan already carries 24 decisions, 10 open
questions, and zero lines of code. It earns its place only once the one-to-one path
actually works end to end.

**Promote it when:** the Phase 5 app exists and someone hits the "several of us need
this file" case in practice.

**Cheapest first step if promoted:** make the repair code union-capable. That is the
only piece with protocol consequences; everything else is copy and layout, which can
follow later without rework.

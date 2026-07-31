#!/usr/bin/env python3
"""
GE decode cost model — the authoritative source for D19's (K, L, block size).

This script EMITS THE TABLES THAT APPEAR IN plan.md §3.1 and §4 (D19).
It is not a sketch written beside the plan; the plan quotes its output.

    python3 ge_cost_model.py            # print the tables
    python3 ge_cost_model.py --check    # verify plan.md matches this output (CI gate G4)

Why this exists: the first block-layer decision sized K from the O(K^2) MEMORY
term (a 32 MB coefficient matrix at K=16,384) and never carried forward the TIME
term from the same evidence chain. docs/research/fountain-codes-and-protocol.md
§2.6 states:

    "Cost scales as K^2, so it must be bounded. At K = 4000 the decode work is
     ~16x that of K = 1000 (~6 GB of XOR) - too slow."
    "Source-block partitioning above K ~ 1500"

COST MODEL
----------
Each arriving packet is reduced against up to `rank` stored pivot rows. A row
operation XORs the coefficient mask (K/8 bytes) and the payload (L bytes):

    bytes_per_row_op = K/8 + L

Reaching full rank takes ~K packets averaging ~K/2 reductions each, and RREF
back-reduction roughly doubles it:

    W = 2 * (K^2 / 2) * (K/8 + L) = K^2 * (K/8 + L)      bytes per block

The block occupies (K*L / R) seconds at wire rate R, so to keep pace:

    required = W / (K*L/R) = K * (K/8 + L) * R / L       bytes/sec

NOTE the leading factor is 1, not 2 - the 2 and the /2 in W cancel. An earlier
revision of plan.md printed `2 * K * (K/8+L) * R/L` and was 2x too pessimistic
throughout. That is exactly the class of error --check now prevents.
"""

import re
import sys
from pathlib import Path

# ---------------------------------------------------------------- parameters

BUDGET = 200e6      # bytes/sec of XOR a mid-range phone sustains in JS.
                    # Desktop JS with typed arrays reaches ~1-3 GB/s; a phone
                    # under thermal load is far less. Deliberately conservative:
                    # being wrong here is unrecoverable mid-transfer.
                    # UNMEASURED - see plan.md §18 R1. Measure in Phase 1.

HEADER = 13         # plan.md §7.1
L = 256             # fragment bytes. Set by the CONSERVATIVE ladder rung, not
                    # the nominal one - see pick_L() and plan.md §3.1.1.
K = 768             # adopted, with margin. See part3().

STAGES = (("Stage 1", 30), ("Stage 2", 60), ("Stage 3", 106))   # KB/s

# QR byte-mode capacities at EC level L, from qr-encoding-capacity.md
QR_L = {5: 106, 10: 271, 13: 425, 16: 586, 20: 858, 23: 1091, 26: 1370, 30: 1732}


def work_bytes(k, l):
    return k * k * (k / 8 + l)


def required_rate(k, l, r):
    return k * (k / 8 + l) * r / l


def matrix_bytes(k):
    return k * k / 8


def fmt(n):
    for unit, div in (("TB", 1024**4), ("GB", 1024**3), ("MB", 1024**2), ("KB", 1024)):
        if n >= div:
            return f"{n/div:.1f} {unit}"
    return f"{n:.0f} B"


def rate(n):
    return f"{n/1e6:.1f} MB/s" if n < 1e9 else f"{n/1e9:.1f} GB/s"


# ------------------------------------------------------------------- reports

def part1(out):
    out("## Part 1 — why K = 16,384 was wrong (all at Stage 1, R = 30 KB/s)\n")
    out("| K | L | Block | Matrix | Work/block | Sustained need | Verdict |")
    out("|---|---|---|---|---|---|---|")
    rows = [(1000, 1260, "research baseline"),
            (1500, 1260, "research partitioning ceiling"),
            (4000, 1260, 'research called this "too slow"'),
            (16384, 256, "the original block-layer choice")]
    r = 30 * 1024
    for k, l, note in rows:
        need = required_rate(k, l, r)
        over = "" if need <= BUDGET else f" — {need/BUDGET:.0f}x over budget"
        out(f"| {k:,} | {l} | {fmt(k*l)} | {fmt(matrix_bytes(k))} | {fmt(work_bytes(k,l))} "
            f"| {rate(need)} | {note}{over} |")
    out("")
    out("Shrinking L to 256 B to fit small tiles made the mask term (K/8 = 2048 B)")
    out("dominate the payload term (256 B) by 8x, so the decode problem got *harder*")
    out("as a side effect of a decision taken for an unrelated reason.\n")


def pick_L(out):
    out("## Part 2 — L is set by the CONSERVATIVE ladder rung\n")
    out("plan.md D15's source note states the governing rule: *pick L to fit the")
    out("smallest tile any profile would use*. An earlier revision set L = 507 from")
    out("the NOMINAL rung (v15), which left the conservative rung unable to carry a")
    out("packet at all — destroying the ladder's only load-bearing property.\n")
    out(f"With L = {L} B, packet = {HEADER} + {L} = **{HEADER+L} B**. Rungs are defined by")
    out("PACKET COUNT, with the QR version chosen to fit — not the reverse:\n")
    out("| Packets | Needs | Rung | Capacity | Waste |")
    out("|---|---|---|---|---|")
    p = HEADER + L
    for n in (1, 2, 3, 4):
        need = n * p
        ver = min((v for v, c in sorted(QR_L.items()) if c >= need), default=None)
        if ver:
            out(f"| {n} | {need} B | v{ver}-L | {QR_L[ver]} B | {QR_L[ver]-need} B |")
    out("")
    bad = HEADER + 507
    out(f"For contrast, at L = 507 a packet is {bad} B and v10-L ({QR_L[10]} B) carries")
    out(f"**zero** packets — {bad-QR_L[10]} B short.\n")


def part3(out):
    out(f"## Part 3 — choosing K at L = {L} B\n")
    out(f"A faster wire rate makes decode HARDER (same work, less time), so K must be")
    out(f"sized for the FASTEST stage we intend to reach, not the slowest.\n")
    out("| K | Block | Matrix | " + " | ".join(n for n, _ in STAGES) + " | Verdict |")
    out("|---|---|---|" + "---|" * (len(STAGES) + 1))
    for k in (512, 768, 1024, 1152, 1536, 2048):
        needs = [required_rate(k, L, kb * 1024) for _, kb in STAGES]
        worst = needs[-1]
        if worst <= BUDGET:
            v = f"ok — {BUDGET/worst:.2f}x margin"
        else:
            v = f"{worst/BUDGET:.1f}x OVER at {STAGES[-1][0]}"
        mark = " **" if k == K else " "
        out(f"|{mark}{k}{mark.strip() and '**' or ''} | {fmt(k*L)} | {fmt(matrix_bytes(k))} | "
            + " | ".join(rate(n) for n in needs) + f" | {v} |")
    out("")
    kmax = max(k for k in range(64, 4097, 64)
               if required_rate(k, L, STAGES[-1][1] * 1024) <= BUDGET)
    out(f"**K_max at {STAGES[-1][0]} = {kmax}.** We adopt **K = {K}** — deliberately below")
    out(f"the ceiling, because D26 requires the sender to assume the weaker receiver")
    out(f"and the {BUDGET/1e6:.0f} MB/s budget is itself an unmeasured estimate (§18 R1).")
    out(f"Margin at {STAGES[-1][0]}: **{BUDGET/required_rate(K, L, STAGES[-1][1]*1024):.2f}x**.\n")


def part4(out):
    out("## Part 4 — the adopted design\n")
    ws = matrix_bytes(K) + K * L
    out("| Quantity | Value |")
    out("|---|---|")
    out(f"| K (fragments per block) | **{K}** |")
    out(f"| L (fragment bytes) | **{L} B** |")
    out(f"| Packet on the wire | {HEADER} + {L} = **{HEADER+L} B** |")
    out(f"| Block size | **{fmt(K*L)}** |")
    out(f"| GE coefficient matrix | **{fmt(matrix_bytes(K))}** |")
    out(f"| Block-layer working set | **{fmt(ws)}** |")
    out(f"| Decode work per block | {fmt(work_bytes(K,L))} |")
    for name, kb in STAGES:
        out(f"| Sustained need @ {name} ({kb} KB/s) | {rate(required_rate(K,L,kb*1024))} |")
    out(f"| Blocks per 4 GB | {4*1024**3/(K*L):,.0f} |")
    out(f"| Bitmap per 4 GB | {fmt(4*1024**3/(K*L)/8)} |")
    out(f"| Max addressable file (3-byte blockIndex) | {fmt(16777216*K*L)} |")
    out("")


def part5(out):
    out("## Part 5 — encoder cost (sender side)\n")
    out("plan.md §6.3.1 budgets QR encode and render; this is the fountain XOR term")
    out("it must also carry. Geometry: 15 tiles x 15 fps = **225 packets/s**.\n")
    out("| K | Degree cap | Mean degree | XOR/packet | At 225 pkt/s |")
    out("|---|---|---|---|---|")
    for k in (K, 16384):
        for cap in (None, 64):
            hi = k if cap is None else min(cap, k)
            H = sum(1.0 / d for d in range(1, hi + 1))
            mean_d = hi / H
            per = mean_d * L
            out(f"| {k:,} | {cap or 'none'} | {mean_d:.1f} | {fmt(per)} | {rate(per*225)} |")
    out("")
    hi = min(64, K)
    H = sum(1.0 / d for d in range(1, hi + 1))
    full = sum(1.0 / d for d in range(1, K + 1))
    out(f"At the adopted K = {K}, capping at 64 cuts mean degree from "
        f"{K/full:.1f} to {hi/H:.1f} — a **{(K/full)/(hi/H):.1f}x** reduction.")
    out("Verified safe by degree_cap_sim.py (D6 forbids assuming it).\n")


def build_report():
    lines = []
    out = lines.append
    out("<!-- GENERATED by docs/research/sim/ge_cost_model.py — do not edit by hand. -->")
    out("<!-- Regenerate: python3 docs/research/sim/ge_cost_model.py -->\n")
    part1(out)
    pick_L(out)
    part3(out)
    part4(out)
    part5(out)
    return "\n".join(lines)


# --------------------------------------------------------------- CI gate G4

CHECKED_CLAIMS = [
    ("K", str(K)),
    ("L", f"{L} B"),
    ("packet", f"{HEADER+L} B"),
    ("block", fmt(K * L)),
    ("matrix", fmt(matrix_bytes(K))),
    ("working set", fmt(matrix_bytes(K) + K * L)),
] + [(f"need@{n}", rate(required_rate(K, L, kb * 1024))) for n, kb in STAGES]


def check(plan_path):
    """Assert plan.md's D19 numbers match this model. Exit 1 on mismatch."""
    text = Path(plan_path).read_text()
    bad = []
    for name, value in CHECKED_CLAIMS:
        needle = value.replace(" ", r"\s*")
        if not re.search(needle, text):
            bad.append(f"  {name}: expected {value!r} — not found in plan")
    if bad:
        print(f"FAIL — plan.md does not match {Path(__file__).name}:")
        print("\n".join(bad))
        return 1
    print(f"OK — plan.md matches the model on {len(CHECKED_CLAIMS)} figures.")
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        here = Path(__file__).resolve().parents[3]
        sys.exit(check(here / "docs" / "plan" / "plan.md"))
    print(build_report())

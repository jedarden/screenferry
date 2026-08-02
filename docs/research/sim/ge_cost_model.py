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


def part6_tile_counts(out):
    out("## Part 6 — tile counts and payload rate (§6.3.2)\n")
    tiles = 15
    packets_per_tile = 2  # R2 nominal rung
    fps = 15
    header_size = 13
    payload_per_tile = packets_per_tile * L
    packet_size = header_size + L
    qr_capacity_v16l = 586  # from plan.md table
    user_visible_payload = tiles * packets_per_tile * L
    qr_frame_capacity = tiles * qr_capacity_v16l
    payload_rate = user_visible_payload * fps

    out(f"At **{tiles} tiles**, **{packets_per_tile} packets/tile**, **{fps} fps**:\n")
    out("| Metric | Value |")
    out("|---|---|")
    out(f"| Tiles per frame | **{tiles}** |")
    out(f"| Packets per tile | **{packets_per_tile}** (R2 nominal) |")
    out(f"| Packet size | {packet_size} B (header + {L} B payload) |")
    out(f"| User-visible payload | {user_visible_payload} B = **{fmt(user_visible_payload)}** ≈ **{user_visible_payload/1024:.1f} KB/frame** |")
    out(f"| QR frame capacity | {qr_frame_capacity} B = **{fmt(qr_frame_capacity)}** |")
    out(f"| Payload rate | {payload_rate} B/s = **{fmt(payload_rate)}/s** ≈ **{payload_rate/1024:.1f} KB/s** |")
    out("")


def part7_manifest_arithmetic(out):
    out("## Part 7 — manifest arithmetic (§7.6)\n")
    file_size_gb = 4
    block_size_kb = (K * L) / 1024  # 192 KB
    blocks_per_4gb = int((file_size_gb * 1024**3) / (K * L))
    block_hash_len = 4  # bytes
    manifest_size_4gb_bytes = blocks_per_4gb * block_hash_len
    manifest_blocks_4gb = (manifest_size_4gb_bytes + (K * L) - 1) // (K * L)  # ceiling division

    out(f"For a **{file_size_gb} GB** file:\n")
    out("| Metric | Value |")
    out("|---|---|")
    out(f"| Blocks per {file_size_gb} GB | **{blocks_per_4gb:,}** |")
    out(f"| Per-block hash length | **{block_hash_len} B** |")
    out(f"| Manifest size | {manifest_size_4gb_bytes:,} B = **{fmt(manifest_size_4gb_bytes)}** |")
    out(f"| Manifest blocks | **{manifest_blocks_4gb}** (one block at {file_size_gb} GB) |")
    out("")


def part8_dwell_table(out):
    out("## Part 8 — dwell table (§8.1)\n")
    dwell_multiplier = 1.6
    dwell_packets = dwell_multiplier * K
    overhead_p99 = 0.042  # +4.2% from D25
    e_max = 1 - (1 + overhead_p99) / dwell_multiplier
    needed = 1.02  # K needed to complete a block

    out(f"At **dwell = {dwell_multiplier} K**:\n")
    out("| Erasure | Deliveries | Status |")
    out("|---|---|---|")
    for erasure in (0.20, 0.25, 0.30):
        deliveries = dwell_multiplier * (1 - erasure)
        status = "✅" if deliveries >= needed else "❌"
        out(f"| {erasure*100:.0f}% | {deliveries:.3f} K | {status} |")
    out(f"| ~{needed:.2f} K | ~1.02 K | needed |")
    out("")
    out(f"| Completion cliff (e_max) | **{e_max*100:.1f}%** |")
    out(f"| Repair code trigger | **30%** (4.9% buffer below cliff) |")
    out("")


def part9_working_set_correction(out):
    out("## Part 9 — corrected working set calculation\n")
    payload_matrix = matrix_bytes(K)
    payload_block = K * L
    manifest_matrix = matrix_bytes(K)  # Second GE context for manifest
    manifest_block = K * L  # Second K*L array for manifest/recover
    total_working_set = payload_matrix + payload_block + manifest_matrix + manifest_block

    out("The **264.0 KB** figure in §4 is only the payload block-layer cost.\n")
    out("The **true peak** includes the manifest GE context (I5) and recover()'s")
    out("second K*L array:\n")
    out("| Component | Value |")
    out("|---|---|")
    out(f"| Payload matrix | **{fmt(payload_matrix)}** |")
    out(f"| Payload block | **{fmt(payload_block)}** |")
    out(f"| Manifest matrix | **{fmt(manifest_matrix)}** |")
    out(f"| Manifest block | **{fmt(manifest_block)}** |")
    out(f"| **Total peak working set** | **{fmt(total_working_set)}** |")
    out("")
    out(f"This remains well under I6a's 1 MB limit ({total_working_set/(1024*1024):.2f}×).")
    out("")


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
    part6_tile_counts(out)
    part7_manifest_arithmetic(out)
    part8_dwell_table(out)
    part9_working_set_correction(out)
    return "\n".join(lines)


# --------------------------------------------------------------- CI gate G7

# Calculate additional values for checking
TILES = 15
PACKETS_PER_TILE = 2  # R2 nominal rung
FPS = 15
USER_VISIBLE_PAYLOAD = TILES * PACKETS_PER_TILE * L  # 7,680 B
QR_CAPACITY_V16L = 586  # QR v16-L capacity in bytes
QR_FRAME_CAPACITY = TILES * QR_CAPACITY_V16L  # 8,790 B
PAYLOAD_RATE = USER_VISIBLE_PAYLOAD * FPS  # 115,200 B/s

BLOCKS_PER_4GB = int((4 * 1024**3) / (K * L))  # 21,845
MANIFEST_SIZE_4GB_BYTES = BLOCKS_PER_4GB * 4  # 87,380 B
DWELL_MULTIPLIER = 1.6
OVERHEAD_P99 = 0.042
E_MAX = 1 - (1 + OVERHEAD_P99) / DWELL_MULTIPLIER  # 0.349

PAYLOAD_MATRIX = matrix_bytes(K)  # 72.0 KB
PAYLOAD_BLOCK = K * L  # 192.0 KB
MANIFEST_MATRIX = matrix_bytes(K)  # 72.0 KB
MANIFEST_BLOCK = K * L  # 192.0 KB
TOTAL_WORKING_SET = PAYLOAD_MATRIX + PAYLOAD_BLOCK + MANIFEST_MATRIX + MANIFEST_BLOCK  # 528.0 KB

CHECKED_CLAIMS = [
    ("K", str(K)),
    ("L", f"{L} B"),
    ("packet", f"{HEADER+L} B"),
    ("block", fmt(K * L)),
    ("matrix", fmt(matrix_bytes(K))),
    ("working set", fmt(matrix_bytes(K) + K * L)),
    # Tile counts (§6.3.2)
    ("tiles", str(TILES)),
    ("7.5 KB/frame", f"{USER_VISIBLE_PAYLOAD/1024:.1f} KB/frame"),
    ("8.6 KB/frame", f"{QR_FRAME_CAPACITY/1024:.1f} KB/frame"),
    ("112.5 KB/s", f"{PAYLOAD_RATE/1024:.1f} KB/s"),
    # Manifest arithmetic (§7.6)
    ("21,845 blocks", f"{BLOCKS_PER_4GB:,}"),
    ("87 KB", f"{MANIFEST_SIZE_4GB_BYTES/1000:.0f} KB"),
    # Dwell table (§8.1)
    ("1.6 K", f"{DWELL_MULTIPLIER} K"),
    ("34.9%", f"{E_MAX*100:.1f}%"),
    # Corrected working set
    ("528.0 KB", fmt(TOTAL_WORKING_SET)),
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

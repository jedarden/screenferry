#!/usr/bin/env python3
"""
GE decode cost model — re-derives D19 (block size / K) against decode TIME,
not just decode memory.

Why this exists: plan.md §2.1 chose K = 16,384 from a memory argument (the K^2/8
coefficient matrix is 32 MB, which is fine). But the plan's own evidence base,
docs/research/fountain-codes-and-protocol.md §2.6, says:

    "Cost scales as K^2, so it must be bounded. At K = 4000 the decode work is
     ~16x that of K = 1000 (~6 GB of XOR) - too slow."
    "Source-block partitioning above K ~ 1500"

so K = 16,384 is 11x past that recommendation. Memory was never the binding
constraint at these sizes; time is. This model finds the K that actually keeps up.

COST MODEL
----------
Each arriving packet is reduced against up to `rank` stored pivot rows. A row
operation XORs both the coefficient mask (K/8 bytes) and the payload (L bytes):

    bytes_per_row_op = K/8 + L

Reaching full rank takes ~K packets averaging ~K/2 reductions each, and RREF
back-reduction roughly doubles it:

    W = 2 * (K^2 / 2) * (K/8 + L)   bytes of memory traffic per block

The block occupies (K*L / R) seconds of wall clock at wire rate R, so to keep
pace the decoder must sustain:

    required = W / (K*L/R) = 2 * K * (K/8 + L) * R / L    bytes/sec

That "keep pace" figure is what matters: falling behind on a multi-minute block
means the receiver never catches up, because packets keep arriving.
"""

BUDGET = 200e6   # bytes/sec of XOR a mid-range phone can sustain in JS.
                 # Desktop JS with typed arrays reaches ~1-3 GB/s; a phone under
                 # thermal load is far less. 200 MB/s is deliberately conservative
                 # because being wrong here is unrecoverable mid-transfer.


def work_bytes(K, L):
    """Total memory traffic to decode one block."""
    return 2 * (K * K / 2) * (K / 8 + L)


def required_rate(K, L, R):
    """Sustained XOR rate needed to keep pace with arrival."""
    return work_bytes(K, L) / (K * L / R)


def matrix_bytes(K):
    return K * K / 8


def fmt(n):
    for unit, div in (("TB", 1024**4), ("GB", 1024**3), ("MB", 1024**2), ("KB", 1024)):
        if n >= div:
            return f"{n/div:.1f} {unit}"
    return f"{n:.0f} B"


def main():
    R = 30 * 1024   # 30 KB/s — Stage 1 mid-range expectation from plan §7

    print("=" * 78)
    print("PART 1 — the plan as written (K = 16,384, L = 256) vs the research ceiling")
    print("=" * 78)
    print(f"{'K':>8} {'L':>6} {'block':>9} {'matrix':>9} {'work/block':>12} {'needs':>12}  verdict")
    for K, L in ((1000, 1260), (1500, 1260), (4000, 1260), (1000, 256), (16384, 256)):
        need = required_rate(K, L, R)
        v = "ok" if need <= BUDGET else f"{need/BUDGET:.0f}x OVER"
        print(f"{K:>8} {L:>6} {fmt(K*L):>9} {fmt(matrix_bytes(K)):>9} "
              f"{fmt(work_bytes(K,L)):>12} {fmt(need)+'/s':>12}  {v}")
    print("\n  The research called K=4000 @ L=1260 'too slow'. K=16,384 @ L=256 is")
    print("  far worse: the mask term (K/8 = 2048 B) now dwarfs the payload (256 B),")
    print("  so shrinking L to fit small tiles actively made the decode problem harder.")

    print()
    print("=" * 78)
    print(f"PART 2 — feasible (K, L) at R = {R/1024:.0f} KB/s, budget {BUDGET/1e6:.0f} MB/s")
    print("=" * 78)
    print(f"{'L':>6} {'max K':>7} {'block':>9} {'matrix':>9} {'needs':>11} {'blocks/4GB':>11}")
    for L in (256, 384, 507, 768, 1024):
        best = None
        for K in range(128, 32769, 128):
            if required_rate(K, L, R) <= BUDGET:
                best = K
            else:
                break
        if best:
            need = required_rate(best, L, R)
            print(f"{L:>6} {best:>7} {fmt(best*L):>9} {fmt(matrix_bytes(best)):>9} "
                  f"{fmt(need)+'/s':>11} {4*1024**3/(best*L):>11,.0f}")

    print()
    print("=" * 78)
    print("PART 3 — headroom check for the recommended pick at higher wire rates")
    print("=" * 78)
    K, L = 3072, 507
    print(f"  K = {K}, L = {L} B  ->  block = {fmt(K*L)}, matrix = {fmt(matrix_bytes(K))}")
    print(f"  work per block = {fmt(work_bytes(K,L))}\n")
    print(f"{'stage':>26} {'rate':>10} {'needs':>12}  verdict")
    for label, kb in (("Stage 1 low (20 KB/s)", 20), ("Stage 1 mid (30 KB/s)", 30),
                      ("Stage 2 (60 KB/s)", 60), ("Stage 3 (106 KB/s)", 106)):
        r = kb * 1024
        need = required_rate(K, L, r)
        v = "ok" if need <= BUDGET else f"{need/BUDGET:.1f}x OVER"
        print(f"{label:>26} {kb:>7} KB/s {fmt(need)+'/s':>12}  {v}")
    print("\n  Faster wire rate makes decode HARDER (same work, less time). Stage 3")
    print("  needs a smaller K than Stage 1 — so K must be chosen per profile, or")
    print("  chosen for the fastest stage we intend to reach.")

    print()
    print("=" * 78)
    print("PART 4 — encoder cost, which plan §4.2.1 omits entirely")
    print("=" * 78)
    print("  §4.2.1 budgets QR encode + render but not the fountain XOR. Under the")
    print("  harmonic distribution Pr(d) ~ 1/d over 1..K, mean degree is K/H(K).\n")
    import math
    print(f"{'K':>7} {'cap':>6} {'mean d':>8} {'XOR/pkt':>10} {'at 60 pkt/s':>13}")
    for K in (3072, 16384):
        for cap in (None, 64):
            hi = K if cap is None else min(cap, K)
            H = sum(1.0 / d for d in range(1, hi + 1))
            mean_d = hi / H
            per = mean_d * 507
            print(f"{K:>7} {str(cap or '-'):>6} {mean_d:>8.1f} {fmt(per):>10} {fmt(per*60)+'/s':>13}")
    print("\n  Capping degree at 64 cuts encoder XOR ~20x. But per D6 the distribution")
    print("  and the decoder are COUPLED - capping is a change to the distribution and")
    print("  must be verified, not assumed. See degree_cap_sim.py.")


if __name__ == "__main__":
    main()

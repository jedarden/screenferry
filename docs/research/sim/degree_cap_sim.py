#!/usr/bin/env python3
"""
Does capping the fountain degree break the code?

ge_cost_model.py Part 4 shows that capping the harmonic degree distribution at
d <= 64 cuts encoder XOR ~20x (mean degree 357 -> 13.5 at K=3072). The research
recommends the cap. But plan.md D6 states the distribution and the decoder are a
COUPLED pair that must never be changed independently -- so the cap has to be
verified, not assumed. That is what this does.

Method matches fountain_overhead_sim.py: incremental GF(2) Gaussian elimination,
overhead measured as extra RECEIVED symbols beyond K. Every cap is fed a stream
drawn from the same seeded RNG per (K, trial) so the comparison is like-for-like.

Usage:  python3 degree_cap_sim.py [trials]
"""

import random
import sys


def harmonic_cdf(K, cap=None):
    """Pr(d) proportional to 1/d over d = 1..min(cap, K)."""
    hi = K if cap is None else min(cap, K)
    weights = [1.0 / d for d in range(1, hi + 1)]
    total = sum(weights)
    cum, running = [], 0.0
    for w in weights:
        running += w / total
        cum.append(running)
    return cum


def sample_degree(cum, rng):
    r = rng.random()
    lo, hi = 0, len(cum) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if cum[mid] < r:
            lo = mid + 1
        else:
            hi = mid
    return lo + 1


def trial(K, cum, seed, cap_mult=4):
    """Symbols received until GE reaches full rank."""
    rng = random.Random(seed)
    pivots = {}
    rank = 0
    limit = int(K * cap_mult) + 100
    for n in range(1, limit + 1):
        d = sample_degree(cum, rng)
        mask = 0
        for i in rng.sample(range(K), d):
            mask |= 1 << i
        row = mask
        while row:
            p = row.bit_length() - 1
            other = pivots.get(p)
            if other is None:
                pivots[p] = row
                rank += 1
                break
            row ^= other
        if rank == K:
            return n
    return None


def pct(xs, q):
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


def main():
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    caps = [None, 128, 64, 32, 16, 8]

    print(f"Degree-cap effect on GE reception overhead — {trials} trials per cell")
    print("Overhead = extra received symbols beyond K, as % of K. Lower is better.")
    print("Distribution: harmonic Pr(d) ~ 1/d, truncated at the cap.\n")
    print(f"{'K':>6} {'cap':>6} {'mean d':>8} {'mean ovh':>10} {'p50':>8} {'p99':>8} {'fails':>6}")

    for K in (256, 512, 1024):
        base = None
        for cap in caps:
            hi = K if cap is None else min(cap, K)
            H = sum(1.0 / d for d in range(1, hi + 1))
            mean_d = hi / H
            cum = harmonic_cdf(K, cap)
            ns = [trial(K, cum, seed=0xBEEF ^ (K * 977) ^ t) for t in range(trials)]
            got = [n for n in ns if n is not None]
            fails = trials - len(got)
            if not got:
                print(f"{K:>6} {str(cap or '-'):>6} {mean_d:>8.1f} {'no decode':>10}"
                      f" {'':>8} {'':>8} {fails:>6}")
                continue
            ov = [(n - K) / K * 100 for n in got]
            mean_ov = sum(ov) / len(ov)
            if cap is None:
                base = mean_ov
            delta = "" if base is None or cap is None else f"  ({mean_ov-base:+.1f} pts)"
            print(f"{K:>6} {str(cap or '-'):>6} {mean_d:>8.1f} {mean_ov:>9.2f}%"
                  f" {pct(ov,.50):>7.1f}% {pct(ov,.99):>7.1f}% {fails:>6}{delta}")
        print()

    print("Reading this: if a capped row matches the uncapped row within ~1 point,")
    print("the cap is free and D6's coupling is not violated by taking it.")


if __name__ == "__main__":
    main()

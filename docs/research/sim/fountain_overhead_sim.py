#!/usr/bin/env python3
"""
Independent verification of the central claim in fountain-codes-and-protocol.md:

    "Textbook LT with peeling is unusable at qrbeam's block sizes; swapping
     peeling for full GF(2) Gaussian elimination on the IDENTICAL symbol stream
     drops overhead to a few percent."

Both decoders are fed the exact same stream of encoded symbols in each trial,
so the comparison isolates the decoder and controls for the degree distribution
and the RNG draw. Overhead is measured in *received* symbols:

    overhead = (symbols_received_until_decodable - K) / K

Channel loss does not appear here on purpose. Loss scales the number of frames
the sender must transmit, but it does not change how many *received* symbols a
decoder needs. Reception overhead is the decoder property under test.

Usage:  python3 fountain_overhead_sim.py [trials]
"""

import math
import random
import sys
from collections import defaultdict


# ---------------------------------------------------------------- distributions

def cdf_from_weights(weights):
    """weights[i] is the weight of degree i+1; returns a cumulative table."""
    total = sum(weights)
    cum, running = [], 0.0
    for w in weights:
        running += w / total
        cum.append(running)
    return cum


def harmonic_cdf(K):
    """Pr(d) proportional to 1/d, d = 1..K. The BC-UR / bc-ur choice."""
    return cdf_from_weights([1.0 / d for d in range(1, K + 1)])


def robust_soliton_cdf(K, c=0.03, delta=0.5):
    """Textbook robust soliton (Luby 2002)."""
    R = c * math.log(K / delta) * math.sqrt(K)
    rho = [0.0] * (K + 1)
    rho[1] = 1.0 / K
    for d in range(2, K + 1):
        rho[d] = 1.0 / (d * (d - 1))

    tau = [0.0] * (K + 1)
    pivot = max(1, int(round(K / R))) if R > 0 else K
    for d in range(1, K + 1):
        if d < pivot:
            tau[d] = R / (d * K)
        elif d == pivot:
            tau[d] = R * math.log(R / delta) / K

    return cdf_from_weights([rho[d] + tau[d] for d in range(1, K + 1)])


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


# ------------------------------------------------------------------- decoders

class GaussianElimination:
    """
    Incremental GF(2) elimination. Each symbol's index set is a bitmask; we
    reduce it against stored pivot rows and keep it if it raises the rank.
    Decodable exactly when rank == K. This is what an online GE decoder does.
    """

    def __init__(self, K):
        self.K = K
        self.pivots = {}
        self.rank = 0

    def add(self, mask):
        row = mask
        while row:
            p = row.bit_length() - 1
            other = self.pivots.get(p)
            if other is None:
                self.pivots[p] = row
                self.rank += 1
                return
            row ^= other
        # row reduced to zero: linearly dependent, contributes nothing

    @property
    def done(self):
        return self.rank == self.K


class Peeling:
    """
    Incremental belief-propagation / peeling decoder: repeatedly consume
    degree-1 symbols and substitute them into every symbol that references
    them. This is the classic LT decoder and what most JS fountain libraries
    implement.
    """

    def __init__(self, K):
        self.K = K
        self.active = {}
        self.contains = defaultdict(set)
        self.decoded = 0
        self.solved = 0
        self.next_id = 0

    def add(self, mask):
        m = mask & ~self.decoded
        if m == 0:
            return
        sid = self.next_id
        self.next_id += 1
        self.active[sid] = m
        for i in _bits(m):
            self.contains[i].add(sid)
        if m.bit_count() == 1:
            self._cascade([sid])

    def _cascade(self, queue):
        while queue:
            sid = queue.pop()
            m = self.active.get(sid)
            if m is None or m.bit_count() != 1:
                continue

            idx = m.bit_length() - 1
            bit = 1 << idx
            self.decoded |= bit
            self.solved += 1

            del self.active[sid]
            self.contains[idx].discard(sid)

            for other in list(self.contains[idx]):
                om = self.active.get(other)
                if om is None:
                    continue
                om ^= bit
                if om == 0:
                    del self.active[other]
                else:
                    self.active[other] = om
                    if om.bit_count() == 1:
                        queue.append(other)
            self.contains.pop(idx, None)

    @property
    def done(self):
        return self.solved == self.K


def _bits(mask):
    while mask:
        low = mask & -mask
        yield low.bit_length() - 1
        mask ^= low


# --------------------------------------------------------------------- trials

def run_trial(K, cum, rng, cap_mult=8):
    """Feed one identical symbol stream to both decoders. Returns (n_ge, n_peel)."""
    ge, peel = GaussianElimination(K), Peeling(K)
    n_ge = n_peel = None
    cap = int(K * cap_mult) + 100

    for n in range(1, cap + 1):
        d = sample_degree(cum, rng)
        mask = 0
        for i in rng.sample(range(K), d):
            mask |= 1 << i

        if n_ge is None:
            ge.add(mask)
            if ge.done:
                n_ge = n
        if n_peel is None:
            peel.add(mask)
            if peel.done:
                n_peel = n
        if n_ge is not None and n_peel is not None:
            break

    return n_ge, n_peel


def percentile(xs, q):
    s = sorted(xs)
    return s[min(len(s) - 1, int(q * len(s)))]


def summarize(K, ns, trials):
    got = [n for n in ns if n is not None]
    if not got:
        return "no decode within cap"
    ov = [(n - K) / K * 100 for n in got]
    fail = "" if len(got) == trials else f"  ({trials - len(got)}/{trials} hit cap)"
    return (f"mean {sum(ov)/len(ov):+6.1f}%   "
            f"p50 {percentile(ov, .50):+6.1f}%   "
            f"p99 {percentile(ov, .99):+6.1f}%{fail}")


def main():
    trials = int(sys.argv[1]) if len(sys.argv) > 1 else 300

    print(f"Fountain decoder overhead — {trials} trials per cell")
    print("Overhead = extra RECEIVED symbols beyond K, as % of K. Lower is better.")
    print("Both decoders see an identical symbol stream within each trial.\n")

    for dist_name, dist_fn in (("harmonic  Pr(d) ~ 1/d", harmonic_cdf),
                               ("robust soliton", robust_soliton_cdf)):
        print(f"=== degree distribution: {dist_name} ===")
        for K in (50, 100, 250, 500, 1000):
            rng = random.Random(0xC0FFEE ^ K)
            cum = dist_fn(K)
            ge_ns, peel_ns = [], []
            for _ in range(trials):
                a, b = run_trial(K, cum, rng)
                ge_ns.append(a)
                peel_ns.append(b)
            print(f"  K={K:<5}")
            print(f"    gaussian  {summarize(K, ge_ns, trials)}")
            print(f"    peeling   {summarize(K, peel_ns, trials)}")
        print()


if __name__ == "__main__":
    main()

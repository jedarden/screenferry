/**
 * Wire and codec parameters. Every value here is load-bearing and traceable to a
 * decision in docs/plan/plan.md — do not change one without reading the decision.
 *
 * Gate G7 (`npm run gate:numbers`) diffs these against
 * docs/research/sim/ge_cost_model.py, which is the authority.
 */

/** Fragment length. FIXED for a session — invariant I1 / D15. */
export const L = 256;

/** Per-packet header bytes — §7.1 / D21. */
export const HEADER = 13;

/** Bytes on the wire per packet. */
export const PACKET = HEADER + L; // 269

/**
 * Fragments per block — D19. Chosen at 768 against a Stage-3 need of 114.6 MB/s
 * (1.74x margin); K_max is 1152. Deliberately conservative per D26 because decode
 * lands on a receiver whose CPU the sender cannot know.
 */
export const K = 768;

/** Block payload bytes = K * L. */
export const BLOCK = K * L; // 196608

/** Reserved block index for manifest stream (§7.6) — 16.7M blocks addressable, last slot reserved. */
export const MANIFEST_BLOCK_INDEX = 0xFFFFFF;

/** Fountain degree cap — D25. Verified by sim/degree_cap_sim.py; below 32 is a cliff. */
export const DEGREE_CAP = 64;

/** Sender emits this multiple of K per block before advancing — §8.1. */
export const DWELL_FACTOR = 1.6;

/** Assumed residual erasure band — D18c. An ASSUMPTION, not a controlled target. */
export const ERASURE_BAND = { min: 0.2, max: 0.3 } as const;

/** Format magic + wire version nibble. §16.3: the nibble is a fast reject only. */
export const MAGIC = 0x5;
export const WIRE_VERSION = 1;
export const MAGIC_VER = (MAGIC << 4) | (WIRE_VERSION & 0x0f);

export const enum PacketFlags {
  Payload = 0x00,
  Beacon = 0x01,
  /** K < 8: plain repetition instead of LT — edge case E2. */
  Repetition = 0x02,
  Compressed = 0x04,
  /** Manifest packet — block-hash manifest stream (§7.6). */
  Manifest = 0x08,
}

/**
 * Below this many fragments the LT code is pointless and behaves badly; send plain
 * repetition instead. Edge case E2, from the research's guard rail.
 */
export const MIN_LT_K = 8;

/**
 * Ladder rungs — §3.1.1. Rungs are defined by PACKET COUNT with the QR version
 * chosen to fit, never the reverse. An earlier design set L from the nominal rung
 * and left the conservative rung unable to carry a packet at all.
 */
export const RUNGS = [
  { id: 'R1', version: 10, packets: 1, capacity: 271, label: 'conservative' },
  { id: 'R2', version: 16, packets: 2, capacity: 586, label: 'nominal' },
  { id: 'R3', version: 20, packets: 3, capacity: 858, label: 'aggressive' },
  { id: 'R4', version: 23, packets: 4, capacity: 1091, label: 'probe' },
] as const;

export type Rung = (typeof RUNGS)[number];

/** Guard: every rung must hold a whole number of packets (§3.1.1). */
for (const r of RUNGS) {
  if (r.packets * PACKET > r.capacity) {
    throw new Error(
      `rung ${r.id}: v${r.version} holds ${r.capacity} B but needs ${r.packets * PACKET} B`,
    );
  }
}

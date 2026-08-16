/**
 * Wire and codec parameters. Every value here is load-bearing and traceable to a
 * decision in docs/plan/plan.md — do not change one without reading the decision.
 *
 * Gate G7 (`npm run gate:numbers`) diffs these against
 * docs/research/sim/ge_cost_model.py, which is the authority.
 */

/**
 * Fragment length (L). Wire constant for wireVersion 1.
 *
 * **NOT session-negotiable.** L is part of the wire format and is fixed per wire version.
 * For wireVersion 1, L is 256 bytes and MUST NOT change.
 *
 * The beacon transmits fragmentLen as a validity check: receivers MUST reject any beacon
 * where fragmentLen != L with E-VERSION. This protects against version skew and ensures
 * both ends use identical codec parameters.
 *
 * invariant I1 / D15 — L is fixed for a session
 * wireVersion 1 constant — L cannot change without incrementing WIRE_VERSION
 */
export const L = 256;

/** Per-packet header bytes — §7.1 / D21. */
export const HEADER = 13;

/** Bytes on the wire per packet. */
export const PACKET = HEADER + L; // 269

/**
 * Fragments per block — D19. Chosen at 768 against a Stage-3 need of 114.6 MB/s
 * (1.74x margin); K_max is 1152. Deliberately conservative per D26 because decode
 * lands on a receiver whose CPU the sender cannot know.
 *
 * **D26 sender-side desktop override:** When the user knows the receiver is a desktop,
 * a sender-side setting MAY raise K above the default 768. However, this is bounded by
 * K_MAX to maintain I6a's 1 MB block-layer working set constraint.
 *
 * See validateK() for the bound and rationale.
 */
export const K = 768;

/**
 * Maximum K permitted for sender-side desktop receiver override.
 *
 * **Tied to I6a (1 MB block-layer working set constraint):**
 * Working set = matrix + block = K²/8 + K*L bytes (per D26 definition)
 *
 * **Derivation from D26's working set:**
 * Per D26, the working set for I6a is:
 * - Matrix: K²/8 bytes (coefficient storage for GE decoder)
 * - Block: K×L bytes (payload storage)
 * Total: K²/8 + K×L bytes
 *
 * Solving K²/8 + K×L ≤ 1,048,576 bytes (1 MB):
 * With L=256: K²/8 + 256K ≤ 1,048,576
 * K² + 2048K - 8,388,608 = 0
 * K = (-2048 + √(2048² + 4×8,388,608))/2 = 2048
 *
 * **Relationship to plan.md §3.1 K_max=1152:**
 * The plan's K_max=1152 is derived from CPU throughput constraints at Stage 3
 * (195.4 MB/s sustained need with 1.02× margin). These are independent bounds:
 * - CPU-constrained devices (phones) are protected by receiver-side GE benchmark
 * - Memory-constrained scenarios are protected by this sender-side K_MAX check
 *
 * A sender-side desktop override MUST validate K ≤ K_MAX before session creation.
 *
 * @see validateK()
 */
export const K_MAX = 2048;

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

/**
 * Validate K against I6a's 1 MB block-layer working set constraint.
 *
 * **Purpose:** Enforces D26's upper bound for sender-side desktop receiver overrides.
 * Ensures that any K value (default or desktop-optimized) respects I6a's memory limit.
 *
 * **Working set calculation (per D26):**
 * - Matrix: K²/8 bytes (coefficient storage for GE decoder)
 * - Block: K*L bytes (payload storage)
 * - Total: K²/8 + K*L ≤ 1,048,576 bytes (1 MB)
 *
 * Per D26, the working set is matrix + block only. At K=2048 with L=256, this equals
 * exactly 1 MB. The recover() buffer is temporary allocation and not part of the
 * steady-state working set measured by I6a.
 *
 * **Validation:**
 * - Must be called with L=256 (wire version 1 constant)
 * - Returns validated K or throws if K would breach I6a
 *
 * **Error recovery:** If validation fails, the sender MUST either:
 * - Use the default K=768 (conservative, safe for all receivers)
 * - Surface a clear error to the user indicating the receiver cannot handle this K
 *
 * @param k - Proposed K value (from user override or default)
 * @param l - Fragment length in bytes (must be 256 for wire version 1)
 * @returns Validated K value (unchanged if valid)
 * @throws {Error} If K would exceed I6a's 1 MB working set limit
 *
 * @see K_MAX constant for the pre-calculated bound
 * @see D26 (sender-side K selection with desktop override)
 * @see I6a (block-layer working set ≤ 1 MB)
 */
export function validateK(k: number, l: number = L): number {
  if (l !== 256) {
    throw new Error(
      `Fragment length L=${l} is not supported (wire version 1 requires L=256)`,
    );
  }

  if (k < 8) {
    throw new Error(
      `K=${k} is below minimum (K ≥ 8 required for LT code, see E2)`,
    );
  }

  if (k > K_MAX) {
    // Calculate actual working set (matrix + block only, per I6a definition)
    const workingSet = (k * k) / 8 + k * l;
    const limitMB = 1;
    const actualMB = workingSet / 1_048_576;

    throw new Error(
      `K=${k} exceeds I6a's 1 MB block-layer working set constraint.\n` +
      `Working set at K=${k}: ${actualMB.toFixed(2)} MB (limit: ${limitMB} MB)\n` +
      `Components (steady-state, per I6a):\n` +
      `  - Matrix: ${((k * k) / 8 / 1024).toFixed(1)} KB\n` +
      `  - Block: ${(k * l / 1024).toFixed(1)} KB\n` +
      `Maximum allowed K is ${K_MAX} (~${((K_MAX * K_MAX / 8 + K_MAX * l) / 1_048_576).toFixed(2)} MB)\n` +
      `For desktop receivers: Use the default K=${K} for conservative operation, or reduce K to ≤${K_MAX}.`
    );
  }

  return k;
}

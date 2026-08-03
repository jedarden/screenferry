/**
 * Fixed-weight ladder implementation (D18a, Phase 3).
 *
 * Per plan.md D18a: "the ladder runs at FIXED weights. No control loop."
 * OLLA is closed-loop and its error signal (cameraPxPerModule) is a receiver-side
 * metric, but only the sender can change rungs and D16 says no negotiation in v1.
 * A controller with no observable cannot run.
 *
 * Fixed weights (frame-area fractions):
 * - R1 (conservative v10-L) = 15%
 * - R2 (nominal v15-L) = 60%
 * - R3 (aggressive v20-L) = 25%
 *
 * "Never drop any rung below 10% in steady state."
 *
 * This is distinct from Phase 5's D18b (local-metric adaptation) - that adds
 * a control loop; this phase is fixed weights only.
 */

import { RUNGS, type Rung, PACKET } from '../../core/params';

/**
 * Ladder configuration with fixed weights for steady-state operation.
 *
 * Per D18a: Fixed weights are frame-area fractions. The percentages sum to 100%
 * and no rung drops below 10% in steady state.
 */
export interface LadderConfig {
  /** Map of rung ID to weight (0-1, sum = 1.0) */
  weights: Record<string, number>;
  /** Minimum weight for any rung (enforces "no rung below 10%") */
  minWeight: number;
}

/**
 * Default fixed-weight ladder configuration per D18a.
 *
 * Weights:
 * - R1 (conservative): 15%
 * - R2 (nominal): 60%
 * - R3 (aggressive): 25%
 *
 * Total: 100%. No rung below 10% minimum.
 */
export const DEFAULT_LADDER: LadderConfig = {
  weights: {
    R1: 0.15, // conservative v10-L
    R2: 0.60, // nominal v15-L
    R3: 0.25, // aggressive v20-L
  },
  minWeight: 0.10, // 10% minimum per D18a
};

/**
 * Validate ladder configuration.
 *
 * Ensures:
 * - All weights are non-negative
 * - Sum of weights = 1.0
 * - No weight below minWeight (if configured)
 * - All referenced rungs exist
 *
 * @param config - Ladder configuration to validate
 * @param availableRungs - Rungs available in the system (default: all RUNGS)
 * @throws {Error} If configuration is invalid
 */
export function validateLadderConfig(
  config: LadderConfig,
  availableRungs: readonly Rung[] = RUNGS
): void {
  const rungIds = new Set(availableRungs.map((r) => r.id));

  // Check all referenced rungs exist
  for (const rungId of Object.keys(config.weights)) {
    if (!rungIds.has(rungId as any)) {
      throw new Error(
        `Ladder references unknown rung ${rungId}. Available: ${[...rungIds].join(', ')}`
      );
    }
  }

  // Check weights are non-negative
  for (const [rungId, weight] of Object.entries(config.weights)) {
    if (weight < 0) {
      throw new Error(`Rung ${rungId} has negative weight ${weight}`);
    }
    if (weight < config.minWeight && weight > 0) {
      throw new Error(
        `Rung ${rungId} weight ${weight} is below minimum ${config.minWeight}. ` +
          'Per D18a: "Never drop any rung below 10% in steady state."'
      );
    }
  }

  // Check sum = 1.0
  const totalWeight = Object.values(config.weights).reduce((sum, w) => sum + w, 0);
  if (Math.abs(totalWeight - 1.0) > 0.001) {
    throw new Error(
      `Ladder weights sum to ${totalWeight}, expected 1.0. ` +
        'Per D18a: weights are frame-area fractions that must total 100%.'
    );
  }
}

/**
 * Calculate how many tiles to allocate to each rung for a given frame.
 *
 * Returns integer tile counts that respect the fixed-weight proportions as
 * closely as possible. The total may differ from targetTiles by ±1 due to rounding.
 *
 * @param targetTiles - Desired total tiles in the frame
 * @param config - Ladder configuration (default: DEFAULT_LADDER)
 * @returns Map of rung ID to tile count
 */
export function allocateTilesByWeight(
  targetTiles: number,
  config: LadderConfig = DEFAULT_LADDER
): Map<string, number> {
  const allocation = new Map<string, number>();
  let allocated = 0;

  // Calculate weighted allocations
  const rungEntries = Object.entries(config.weights);
  for (const [rungId, weight] of rungEntries) {
    const tiles = Math.round(targetTiles * weight);
    allocation.set(rungId, tiles);
    allocated += tiles;
  }

  // Distribute remainder (due to rounding) to rungs with highest weight
  let remainder = targetTiles - allocated;
  if (remainder !== 0) {
    // Sort rungs by weight (descending) to give extra tiles to most-weighted rungs
    const sortedRungs = [...rungEntries].sort((a, b) => b[1] - a[1]);
    const step = remainder > 0 ? 1 : -1;
    let i = 0;
    while (remainder !== 0 && i < sortedRungs.length) {
      const entry = sortedRungs[i];
      if (!entry) break;
      const [rungId] = entry;
      const current = allocation.get(rungId)!;
      allocation.set(rungId, current + step);
      remainder -= step;
      i++;
    }
  }

  // Ensure no negative allocations (shouldn't happen with valid config)
  for (const [rungId, count] of allocation) {
    if (count < 0) {
      allocation.set(rungId, 0);
    }
  }

  return allocation;
}

/**
 * Calculate packet capacity for a frame with mixed rungs.
 *
 * Returns the total packet capacity across all rungs in the ladder.
 * This is the maximum number of packets that can be carried in one frame.
 *
 * @param tileAllocation - Tile allocation per rung (from allocateTilesByWeight)
 * @returns Total packet capacity (sum of rung.packets × tiles for each rung)
 */
export function calculateFrameCapacity(tileAllocation: Map<string, number>): number {
  let totalPackets = 0;

  for (const [rungId, tileCount] of tileAllocation) {
    const rung = RUNGS.find((r) => r.id === rungId);
    if (!rung) {
      throw new Error(`Unknown rung ${rungId} in tile allocation`);
    }
    totalPackets += rung.packets * tileCount;
  }

  return totalPackets;
}

/**
 * Get the rung for a specific tile position in a frame.
 *
 * This implements the frame mixer: given a tile index (0 to totalTiles-1),
 * return which rung that tile uses based on the fixed-weight allocation.
 *
 * The allocation is deterministic: tiles are assigned to rungs in a predictable
 * pattern (R1 tiles first, then R2, then R3) so that the same frame composition
 * repeats every cycle.
 *
 * @param tileIndex - Zero-based tile index within the frame
 * @param tileAllocation - Tile allocation per rung (from allocateTilesByWeight)
 * @returns The Rung to use for this tile
 */
export function getRungForTile(
  tileIndex: number,
  tileAllocation: Map<string, number>
): Rung {
  let tilesSeen = 0;

  // Iterate rungs in allocation order (R1, R2, R3)
  for (const [rungId, tileCount] of tileAllocation) {
    const rung = RUNGS.find((r) => r.id === rungId);
    if (!rung) {
      throw new Error(`Unknown rung ${rungId} in tile allocation`);
    }

    tilesSeen += tileCount;
    if (tileIndex < tilesSeen) {
      return rung;
    }
  }

  throw new Error(
    `Tile index ${tileIndex} out of bounds for allocation ` +
      `[${[...tileAllocation.entries()].map(([k, v]) => `${k}:${v}`).join(', ')}]`
  );
}

/**
 * Calculate expected user-visible payload for a frame configuration.
 *
 * This returns the actual user-visible bytes per frame (excluding header
 * overhead and fountain coding overhead). It's the goodput metric used in
 * throughput budgets.
 *
 * @param tileAllocation - Tile allocation per rung
 * @returns User-visible payload bytes per frame
 */
export function calculatePayloadPerFrame(tileAllocation: Map<string, number>): number {
  let totalPayload = 0;

  for (const [rungId, tileCount] of tileAllocation) {
    const rung = RUNGS.find((r) => r.id === rungId);
    if (!rung) {
      throw new Error(`Unknown rung ${rungId} in tile allocation`);
    }
    // Each tile carries rung.packets packets, each with L bytes of payload
    totalPayload += rung.packets * PACKET * tileCount;
  }

  return totalPayload;
}

/**
 * Calculate frame composition for a target tile count.
 *
 * This is the main entry point for frame generation. Given a desired number
 * of tiles, it returns the complete frame specification including rung
 * allocation and capacity.
 *
 * @param targetTiles - Desired total tiles (e.g., 15 for R2 nominal)
 * @param config - Ladder configuration (default: DEFAULT_LADDER)
 * @returns Frame composition with tile allocation and capacity
 */
export function calculateFrameComposition(
  targetTiles: number,
  config: LadderConfig = DEFAULT_LADDER
): {
  tileAllocation: Map<string, number>;
  totalPackets: number;
  payloadBytes: number;
} {
  validateLadderConfig(config);

  const tileAllocation = allocateTilesByWeight(targetTiles, config);
  const totalPackets = calculateFrameCapacity(tileAllocation);
  const payloadBytes = calculatePayloadPerFrame(tileAllocation);

  return {
    tileAllocation,
    totalPackets,
    payloadBytes,
  };
}

/**
 * Create a frame mixer that maps tile indices to rungs.
 *
 * This is a convenience function that creates the frame mixer function used
 * by the modulation layer during frame encoding.
 *
 * @param targetTiles - Desired total tiles per frame
 * @param config - Ladder configuration (default: DEFAULT_LADDER)
 * @returns Function that maps tileIndex to rung
 */
export function createFrameMixer(
  targetTiles: number,
  config: LadderConfig = DEFAULT_LADDER
): (tileIndex: number) => Rung {
  const composition = calculateFrameComposition(targetTiles, config);

  return (tileIndex: number) => {
    if (tileIndex < 0 || tileIndex >= targetTiles) {
      throw new Error(`Tile index ${tileIndex} out of bounds [0, ${targetTiles})`);
    }
    return getRungForTile(tileIndex, composition.tileAllocation);
  };
}

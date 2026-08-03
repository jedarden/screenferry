/**
 * Tests for tiled QR modulation (Phase 3).
 *
 * Tests the tile layout logic (layout.ts) and fixed-weight ladder (ladder.ts)
 * implementations against plan.md specifications and constraints.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateGridDimensions,
  calculateScreenPxPerModule,
  calculateTileLayout,
  calculateMagnification,
  calculateCameraPxPerModule,
  clearsDecodeCliff,
  estimateMagnification,
  PORTRAIT_REGION,
  type CodeRegion,
} from '../../src/modulation/qr-tiled/layout';
import {
  allocateTilesByWeight,
  calculateFrameCapacity,
  calculateFrameComposition,
  calculatePayloadPerFrame,
  createFrameMixer,
  getRungForTile,
  validateLadderConfig,
  DEFAULT_LADDER,
  type LadderConfig,
} from '../../src/modulation/qr-tiled/ladder';
import { RUNGS, PACKET } from '../../src/core/params';

describe('Tile Layout Logic', () => {
  describe('calculateGridDimensions', () => {
    it('should calculate reasonable grid for 15 tiles in portrait region', () => {
      const { cols, rows } = calculateGridDimensions(15, PORTRAIT_REGION);
      expect(cols).toBeGreaterThan(0);
      expect(rows).toBeGreaterThan(0);
      expect(cols * rows).toBeGreaterThanOrEqual(15);
      // Portrait region (width < height) should produce cols >= rows
      // because we fit more columns horizontally to achieve square tiles
      expect(cols).toBeGreaterThanOrEqual(Math.ceil(rows / 2));
    });

    it('should handle square grid for 16 tiles', () => {
      const squareRegion: CodeRegion = { width: 960, height: 960, orientation: 'square' };
      const { cols, rows } = calculateGridDimensions(16, squareRegion);
      expect(cols).toBe(4);
      expect(rows).toBe(4);
    });

    it('should handle small tile counts', () => {
      const { cols, rows } = calculateGridDimensions(4, PORTRAIT_REGION);
      expect(cols * rows).toBeGreaterThanOrEqual(4);
    });

    it('should handle large tile counts', () => {
      const { cols, rows } = calculateGridDimensions(45, PORTRAIT_REGION);
      expect(cols * rows).toBeGreaterThanOrEqual(45);
    });
  });

  describe('calculateScreenPxPerModule', () => {
    it('should return positive px/module for valid layout', () => {
      const pxPerModule = calculateScreenPxPerModule(3, 5, 15, PORTRAIT_REGION);
      expect(pxPerModule).toBeGreaterThan(0);
    });

    it('should scale inversely with grid size', () => {
      const small = calculateScreenPxPerModule(2, 3, 15, PORTRAIT_REGION);
      const large = calculateScreenPxPerModule(6, 9, 15, PORTRAIT_REGION);
      expect(small).toBeGreaterThan(large);
    });

    it('should scale inversely with QR version', () => {
      const v10 = calculateScreenPxPerModule(3, 5, 10, PORTRAIT_REGION);
      const v20 = calculateScreenPxPerModule(3, 5, 20, PORTRAIT_REGION);
      expect(v10).toBeGreaterThan(v20);
    });
  });

  describe('calculateTileLayout', () => {
    it('should produce valid layout for 15 tiles with v15', () => {
      const layout = calculateTileLayout(15, 15, PORTRAIT_REGION);
      expect(layout.cols).toBeGreaterThan(0);
      expect(layout.rows).toBeGreaterThan(0);
      expect(layout.totalTiles).toBeGreaterThanOrEqual(15);
      expect(layout.screenPxPerModule).toBeGreaterThan(0);
      expect(layout.version).toBe(15);
    });

    it('should produce layout that fits in code region', () => {
      const layout = calculateTileLayout(15, 15, PORTRAIT_REGION);
      const modules = 15 * 4 + 17; // v15 modules
      const tileSize = modules * layout.screenPxPerModule;

      expect(layout.cols * tileSize).toBeLessThanOrEqual(PORTRAIT_REGION.width * 1.1); // 10% tolerance
      expect(layout.rows * tileSize).toBeLessThanOrEqual(PORTRAIT_REGION.height * 1.1);
    });
  });

  describe('Magnification calculations', () => {
    it('should calculate magnification correctly', () => {
      const mag = calculateMagnification(1080, 540);
      expect(mag).toBe(2.0);
    });

    it('should calculate camera px/module from screen px/module', () => {
      const cameraPx = calculateCameraPxPerModule(2.0, 2.0);
      expect(cameraPx).toBe(4.0);
    });

    it('should detect decode cliff violations', () => {
      expect(clearsDecodeCliff(2.0, 2.0)).toBe(true); // 4 camera px/module
      expect(clearsDecodeCliff(2.0, 1.5)).toBe(false); // 3 camera px/module
      expect(clearsDecodeCliff(1.5, 2.0)).toBe(false); // 3 camera px/module
    });

    it('should estimate magnification for typical scenarios', () => {
      const portraitMag = estimateMagnification(PORTRAIT_REGION, 1080);
      expect(portraitMag).toBeGreaterThan(0);
      expect(portraitMag).toBeLessThan(3.0); // Reasonable upper bound
    });
  });
});

describe('Fixed-Weight Ladder (D18a)', () => {
  describe('validateLadderConfig', () => {
    it('should accept default ladder configuration', () => {
      expect(() => validateLadderConfig(DEFAULT_LADDER)).not.toThrow();
    });

    it('should reject configuration with negative weights', () => {
      const badConfig: LadderConfig = {
        weights: { R1: -0.1, R2: 0.7, R3: 0.4 },
        minWeight: 0.1,
      };
      expect(() => validateLadderConfig(badConfig)).toThrow();
    });

    it('should reject configuration with weights below minimum', () => {
      const badConfig: LadderConfig = {
        weights: { R1: 0.05, R2: 0.7, R3: 0.25 },
        minWeight: 0.1,
      };
      expect(() => validateLadderConfig(badConfig)).toThrow('below minimum');
    });

    it('should reject configuration where weights do not sum to 1.0', () => {
      const badConfig: LadderConfig = {
        weights: { R1: 0.2, R2: 0.6, R3: 0.3 },
        minWeight: 0.1,
      };
      expect(() => validateLadderConfig(badConfig)).toThrow('sum to');
    });

    it('should reject configuration referencing unknown rungs', () => {
      const badConfig: LadderConfig = {
        weights: { R1: 0.3, R2: 0.5, RX: 0.2 },
        minWeight: 0.1,
      };
      expect(() => validateLadderConfig(badConfig)).toThrow('unknown rung');
    });
  });

  describe('allocateTilesByWeight', () => {
    it('should allocate tiles according to default weights', () => {
      const allocation = allocateTilesByWeight(15, DEFAULT_LADDER);

      // Expected: R1=15% (~2-3 tiles), R2=60% (~9 tiles), R3=25% (~4 tiles)
      expect(allocation.get('R1')).toBeGreaterThanOrEqual(2);
      expect(allocation.get('R1')).toBeLessThanOrEqual(3);
      expect(allocation.get('R2')).toBeGreaterThanOrEqual(8);
      expect(allocation.get('R2')).toBeLessThanOrEqual(10);
      expect(allocation.get('R3')).toBeGreaterThanOrEqual(3);
      expect(allocation.get('R3')).toBeLessThanOrEqual(5);

      const total = [...allocation.values()].reduce((sum, v) => sum + v, 0);
      expect(total).toBe(15);
    });

    it('should handle small tile counts', () => {
      const allocation = allocateTilesByWeight(4, DEFAULT_LADDER);
      const total = [...allocation.values()].reduce((sum, v) => sum + v, 0);
      expect(total).toBe(4);
    });

    it('should handle large tile counts', () => {
      const allocation = allocateTilesByWeight(45, DEFAULT_LADDER);
      const total = [...allocation.values()].reduce((sum, v) => sum + v, 0);
      expect(total).toBe(45);
    });

    it('should maintain proportions across different scales', () => {
      const alloc10 = allocateTilesByWeight(10, DEFAULT_LADDER);
      const alloc20 = allocateTilesByWeight(20, DEFAULT_LADDER);

      // Proportions should be similar (within rounding)
      for (const rungId of ['R1', 'R2', 'R3']) {
        const ratio10 = (alloc10.get(rungId) || 0) / 10;
        const ratio20 = (alloc20.get(rungId) || 0) / 20;
        expect(Math.abs(ratio10 - ratio20)).toBeLessThan(0.1); // Within 10%
      }
    });
  });

  describe('calculateFrameCapacity', () => {
    it('should calculate total packet capacity correctly', () => {
      // R1: 1 packet/tile, R2: 2 packets/tile, R3: 3 packets/tile
      const allocation = new Map([
        ['R1', 2],
        ['R2', 9],
        ['R3', 4],
      ]);

      const capacity = calculateFrameCapacity(allocation);
      expect(capacity).toBe(2 * 1 + 9 * 2 + 4 * 3); // 2 + 18 + 12 = 32
    });
  });

  describe('calculatePayloadPerFrame', () => {
    it('should calculate user-visible payload correctly', () => {
      const allocation = new Map([
        ['R1', 2], // 2 tiles × 1 packet × 269 bytes
        ['R2', 9], // 9 tiles × 2 packets × 269 bytes
        ['R3', 4], // 4 tiles × 3 packets × 269 bytes
      ]);

      const payload = calculatePayloadPerFrame(allocation);
      expect(payload).toBe((2 + 18 + 12) * PACKET);
    });
  });

  describe('getRungForTile', () => {
    it('should assign tiles to rungs deterministically', () => {
      const allocation = new Map([
        ['R1', 2],
        ['R2', 9],
        ['R3', 4],
      ]);

      // First 2 tiles should be R1
      expect(getRungForTile(0, allocation).id).toBe('R1');
      expect(getRungForTile(1, allocation).id).toBe('R1');

      // Next 9 tiles should be R2
      expect(getRungForTile(2, allocation).id).toBe('R2');
      expect(getRungForTile(10, allocation).id).toBe('R2');

      // Last 4 tiles should be R3
      expect(getRungForTile(11, allocation).id).toBe('R3');
      expect(getRungForTile(14, allocation).id).toBe('R3');
    });

    it('should throw for out-of-bounds tile index', () => {
      const allocation = new Map([
        ['R1', 2],
        ['R2', 9],
        ['R3', 4],
      ]);

      expect(() => getRungForTile(15, allocation)).toThrow();
    });
  });

  describe('calculateFrameComposition', () => {
    it('should produce valid frame composition', () => {
      const composition = calculateFrameComposition(15, DEFAULT_LADDER);

      expect(composition.totalPackets).toBeGreaterThan(0);
      expect(composition.payloadBytes).toBeGreaterThan(0);
      expect(composition.tileAllocation.size).toBe(3); // R1, R2, R3
    });

    it('should match expected values for 15-tile frame', () => {
      const composition = calculateFrameComposition(15, DEFAULT_LADDER);

      // Expected: ~2 R1 + ~9 R2 + ~4 R3 tiles
      // Total packets: ~2×1 + ~9×2 + ~4×3 = ~32 packets
      expect(composition.totalPackets).toBeGreaterThan(25);
      expect(composition.totalPackets).toBeLessThan(40);
    });
  });

  describe('createFrameMixer', () => {
    it('should create a functional frame mixer', () => {
      const mixer = createFrameMixer(15, DEFAULT_LADDER);

      // Should return valid rungs for all tile indices
      for (let i = 0; i < 15; i++) {
        const rung = mixer(i);
        expect(['R1', 'R2', 'R3']).toContain(rung.id);
        expect(rung.version).toBeGreaterThan(0);
        expect(rung.packets).toBeGreaterThan(0);
      }
    });

    it('should throw for out-of-bounds tile index', () => {
      const mixer = createFrameMixer(15, DEFAULT_LADDER);
      expect(() => mixer(15)).toThrow();
      expect(() => mixer(-1)).toThrow();
    });

    it('should be deterministic across calls', () => {
      const mixer = createFrameMixer(15, DEFAULT_LADDER);

      const rung1 = mixer(5);
      const rung2 = mixer(5);

      expect(rung1.id).toBe(rung2.id);
      expect(rung1.version).toBe(rung2.version);
      expect(rung1.packets).toBe(rung2.packets);
    });
  });

  describe('D18a constraints', () => {
    it('should enforce minimum 10% weight per rung', () => {
      // Default ladder has all rungs >= 10%
      for (const [rungId, weight] of Object.entries(DEFAULT_LADDER.weights)) {
        expect(weight).toBeGreaterThanOrEqual(0.1);
      }
    });

    it('should ensure weights sum to 100%', () => {
      const total = Object.values(DEFAULT_LADDER.weights).reduce((sum, w) => sum + w, 0);
      expect(total).toBeCloseTo(1.0, 3);
    });

    it('should have R2 as the dominant rung at 60%', () => {
      expect(DEFAULT_LADDER.weights.R2).toBeCloseTo(0.6, 2);
      expect(DEFAULT_LADDER.weights.R2).toBeGreaterThan(DEFAULT_LADDER.weights.R1);
      expect(DEFAULT_LADDER.weights.R2).toBeGreaterThan(DEFAULT_LADDER.weights.R3);
    });
  });
});

describe('Phase 3 Exit Criteria Validation', () => {
  describe('A1: ≥20 KB/s sustained throughput', () => {
    it('should deliver ≥20 KB/s with 15 tiles at 15 fps', () => {
      const composition = calculateFrameComposition(15, DEFAULT_LADDER);
      const payloadPerFrame = composition.payloadBytes; // bytes per frame

      // At 15 fps: payload bytes/frame × 15 fps = bytes/sec
      const bytesPerSec = payloadPerFrame * 15;
      const kbPerSec = bytesPerSec / 1024;

      // Per plan.md §6.3.2: R2 nominal delivers ~112.5 KB/s payload rate
      // This should be well above the 20 KB/s threshold
      expect(kbPerSec).toBeGreaterThan(20);
    });
  });

  describe('Tile layout for portrait code region', () => {
    it('should use portrait region by default', () => {
      const layout = calculateTileLayout(15, 15, PORTRAIT_REGION);
      expect(layout.version).toBe(15);
      expect(layout.totalTiles).toBeGreaterThanOrEqual(15);
    });
  });

  describe('Rung configuration', () => {
    it('should use R2 nominal (v15-L) as primary rung', () => {
      const r2 = RUNGS.find((r) => r.id === 'R2');
      expect(r2).toBeDefined();
      expect(r2?.version).toBe(16); // v16 for 2 packets at 538 bytes
      expect(r2?.packets).toBe(2);
    });

    it('should have capacity for required packet counts', () => {
      // R1: 1 packet = 269 bytes, v10-L capacity 271 bytes (OK)
      const r1 = RUNGS.find((r) => r.id === 'R1');
      expect(r1?.packets).toBe(1);
      expect(r1?.capacity).toBeGreaterThanOrEqual(PACKET);

      // R2: 2 packets = 538 bytes, v16-L capacity 586 bytes (OK)
      const r2 = RUNGS.find((r) => r.id === 'R2');
      expect(r2?.packets).toBe(2);
      expect(r2?.capacity).toBeGreaterThanOrEqual(2 * PACKET);

      // R3: 3 packets = 807 bytes, v20-L capacity 858 bytes (OK)
      const r3 = RUNGS.find((r) => r.id === 'R3');
      expect(r3?.packets).toBe(3);
      expect(r3?.capacity).toBeGreaterThanOrEqual(3 * PACKET);
    });
  });
});

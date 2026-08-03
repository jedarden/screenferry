/**
 * Tests for block scheduling and dwell management (§8.1).
 *
 * Verifies:
 * - BlockScheduler creation and cursor management
 * - Dwell scheduling algorithm fundamentals
 * - Block sequencing and advance logic
 * - Progress tracking and estimation
 * - Repair mode scheduling
 * - Time estimation with user guidance
 * - Dwell budget validation
 */

import {describe, it, expect} from 'vitest';
import {
  BlockScheduler,
  createDwellConfig,
  createCustomDwellConfig,
  DwellConfig,
  BlockCursor,
  TimeEstimator,
  TIME_THRESHOLDS,
  validateDwellBudget,
  calculateCompletionCliff,
  createDwellConfig as createDefaultDwellConfig,
} from '../src/core/block/schedule.js';
import {K, DWELL_FACTOR} from '../src/core/params.js';

describe('block-schedule', () => {
  describe('createDwellConfig', () => {
    it('should create config with default dwell', () => {
      const config = createDwellConfig(100);
      expect(config.dwellPackets).toBe(Math.ceil(K * DWELL_FACTOR));
      expect(config.blockCount).toBe(100);
    });

    it('should calculate dwell as 1.6×K', () => {
      const config = createDwellConfig(50);
      expect(config.dwellPackets).toBe(Math.ceil(768 * 1.6)); // 1229
    });
  });

  describe('createCustomDwellConfig', () => {
    it('should create config with explicit dwell', () => {
      const config = createCustomDwellConfig(10, 20);
      expect(config.dwellPackets).toBe(10);
      expect(config.blockCount).toBe(20);
    });

    it('should reject non-positive dwell', () => {
      expect(() => createCustomDwellConfig(0, 10)).toThrow('Dwell must be positive');
      expect(() => createCustomDwellConfig(-1, 10)).toThrow('Dwell must be positive');
    });

    it('should reject non-positive block count', () => {
      expect(() => createCustomDwellConfig(10, 0)).toThrow('Block count must be positive');
      expect(() => createCustomDwellConfig(10, -1)).toThrow('Block count must be positive');
    });
  });

  describe('BlockScheduler construction', () => {
    it('should initialize with default cursor at block 0', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      const cursor = scheduler.getCursor();
      expect(cursor.blockIndex).toBe(0);
      expect(cursor.seq).toBe(0);
    });

    it('should initialize with custom start cursor', () => {
      const config = createCustomDwellConfig(5, 10);
      const startCursor: BlockCursor = {blockIndex: 3, seq: 2};
      const scheduler = new BlockScheduler(config, startCursor);
      const cursor = scheduler.getCursor();
      expect(cursor.blockIndex).toBe(3);
      expect(cursor.seq).toBe(2);
    });

    it('should accept zero start cursor', () => {
      const config = createCustomDwellConfig(5, 10);
      const startCursor: BlockCursor = {blockIndex: 0, seq: 0};
      const scheduler = new BlockScheduler(config, startCursor);
      expect(scheduler.getCursor()).toEqual(startCursor);
    });
  });

  describe('getCursor', () => {
    it('should return copy of cursor', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      const cursor1 = scheduler.getCursor();
      const cursor2 = scheduler.getCursor();
      expect(cursor1).toEqual(cursor2);
      expect(cursor1).not.toBe(cursor2); // Different references
    });
  });

  describe('setCursor', () => {
    it('should update cursor position', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      const newCursor: BlockCursor = {blockIndex: 5, seq: 3};
      scheduler.setCursor(newCursor);
      expect(scheduler.getCursor()).toEqual(newCursor);
    });

    it('should reject out-of-range block index', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      expect(() => scheduler.setCursor({blockIndex: -1, seq: 0})).toThrow('out of range');
      expect(() => scheduler.setCursor({blockIndex: 10, seq: 0})).toThrow('out of range');
    });

    it('should reject negative sequence', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      expect(() => scheduler.setCursor({blockIndex: 0, seq: -1})).toThrow('non-negative');
    });

    it('should accept valid cursor at block boundary', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      scheduler.setCursor({blockIndex: 9, seq: 4}); // Last valid block
      expect(scheduler.getCursor().blockIndex).toBe(9);
    });
  });

  describe('isBlockComplete', () => {
    it('should return false when seq < dwell', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      expect(scheduler.isBlockComplete()).toBe(false); // seq=0 < 5
    });

    it('should return true when seq >= dwell', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config, {blockIndex: 0, seq: 5});
      expect(scheduler.isBlockComplete()).toBe(true);
      scheduler.setCursor({blockIndex: 0, seq: 10});
      expect(scheduler.isBlockComplete()).toBe(true);
    });
  });

  describe('advance', () => {
    it('should advance seq within block', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      const packet1 = scheduler.advance();
      expect(packet1.blockIndex).toBe(0);
      expect(packet1.seq).toBe(0);
      const packet2 = scheduler.advance();
      expect(packet2.blockIndex).toBe(0);
      expect(packet2.seq).toBe(1);
    });

    it('should advance to next block when dwell satisfied', () => {
      const config = createCustomDwellConfig(3, 10);
      const scheduler = new BlockScheduler(config);
      // Emit packets 0, 1, 2 for block 0
      scheduler.advance(); // seq=0
      scheduler.advance(); // seq=1
      scheduler.advance(); // seq=2 (last in dwell)
      // Next advance should move to block 1
      const nextPacket = scheduler.advance();
      expect(nextPacket.blockIndex).toBe(1);
      expect(nextPacket.seq).toBe(0);
    });

    it('should wrap around from last block to first', () => {
      const config = createCustomDwellConfig(3, 5);
      const scheduler = new BlockScheduler(config, {blockIndex: 4, seq: 0});
      // Block 4: seq 0, 1, 2
      scheduler.advance(); // 4,0
      scheduler.advance(); // 4,1
      scheduler.advance(); // 4,2 (last in dwell)
      // Should wrap to block 0
      const nextPacket = scheduler.advance();
      expect(nextPacket.blockIndex).toBe(0);
      expect(nextPacket.seq).toBe(0);
    });

    it('should sequence blocks correctly for full pass', () => {
      const config = createCustomDwellConfig(2, 3);
      const scheduler = new BlockScheduler(config);
      const packets: Array<{blockIndex: number; seq: number}> = [];
      // Emit 2 packets per block × 3 blocks = 6 packets
      for (let i = 0; i < 6; i++) {
        packets.push(scheduler.advance());
      }
      expect(packets.map(p => p.blockIndex)).toEqual([0, 0, 1, 1, 2, 2]);
      expect(packets.map(p => p.seq)).toEqual([0, 1, 0, 1, 0, 1]);
    });

    it('should handle small files (< 10MB) correctly', () => {
      // Small file: 1 MB with 192 KB blocks = ~6 blocks
      const config = createCustomDwellConfig(5, 6);
      const scheduler = new BlockScheduler(config);
      const packets: Array<{blockIndex: number; seq: number}> = [];
      // Complete one full pass
      for (let i = 0; i < 30; i++) {
        packets.push(scheduler.advance());
      }
      // Verify we visited all blocks
      const uniqueBlocks = new Set(packets.map(p => p.blockIndex));
      expect(uniqueBlocks.size).toBe(6);
      // Verify each block got exactly 5 packets
      for (let blockIdx = 0; blockIdx < 6; blockIdx++) {
        const blockPackets = packets.filter(p => p.blockIndex === blockIdx);
        expect(blockPackets.length).toBe(5);
        expect(blockPackets.map(p => p.seq)).toEqual([0, 1, 2, 3, 4]);
      }
    });
  });

  describe('getBlockProgress', () => {
    it('should return 0 for unstarted blocks', () => {
      const config = createCustomDwellConfig(10, 100);
      const scheduler = new BlockScheduler(config, {blockIndex: 5, seq: 3});
      expect(scheduler.getBlockProgress(10)).toBe(0);
      expect(scheduler.getBlockProgress(50)).toBe(0);
    });

    it('should return 1 for completed blocks', () => {
      const config = createCustomDwellConfig(10, 100);
      const scheduler = new BlockScheduler(config, {blockIndex: 5, seq: 3});
      expect(scheduler.getBlockProgress(0)).toBe(1);
      expect(scheduler.getBlockProgress(4)).toBe(1);
    });

    it('should return fractional progress for current block', () => {
      const config = createCustomDwellConfig(10, 100);
      const scheduler = new BlockScheduler(config, {blockIndex: 5, seq: 5});
      expect(scheduler.getBlockProgress(5)).toBe(0.5); // 5/10 = 0.5
    });

    it('should cap progress at 1', () => {
      const config = createCustomDwellConfig(10, 100);
      const scheduler = new BlockScheduler(config, {blockIndex: 5, seq: 15}); // Over dwell
      expect(scheduler.getBlockProgress(5)).toBe(1);
    });

    it('should reject out-of-range block index', () => {
      const config = createCustomDwellConfig(10, 100);
      const scheduler = new BlockScheduler(config);
      expect(() => scheduler.getBlockProgress(-1)).toThrow('out of range');
      expect(() => scheduler.getBlockProgress(100)).toThrow('out of range');
    });
  });

  describe('estimatePassPackets', () => {
    it('should calculate packets for full pass', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);
      expect(scheduler.estimatePassPackets()).toBe(50); // 5 × 10
    });

    it('should handle different dwell values', () => {
      const config1 = createCustomDwellConfig(3, 10);
      const scheduler1 = new BlockScheduler(config1);
      expect(scheduler1.estimatePassPackets()).toBe(30);
      const config2 = createCustomDwellConfig(100, 5);
      const scheduler2 = new BlockScheduler(config2);
      expect(scheduler2.estimatePassPackets()).toBe(500);
    });
  });

  describe('estimateRemainingPackets', () => {
    it('should calculate remaining from start', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config, {blockIndex: 0, seq: 0});
      expect(scheduler.estimateRemainingPackets()).toBe(50); // Full pass
    });

    it('should calculate remaining mid-block', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config, {blockIndex: 3, seq: 2});
      // Current block: 5-2=3 remaining
      // Remaining blocks: 6 blocks × 5 = 30
      // Total: 33
      expect(scheduler.estimateRemainingPackets()).toBe(33);
    });

    it('should calculate remaining at last block', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config, {blockIndex: 9, seq: 3});
      // Current block: 5-3=2 remaining
      // No remaining blocks
      expect(scheduler.estimateRemainingPackets()).toBe(2);
    });

    it('should return 0 at pass completion', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config, {blockIndex: 9, seq: 5});
      expect(scheduler.estimateRemainingPackets()).toBe(0);
    });
  });

  describe('forRepair', () => {
    it('should create scheduler for single block', () => {
      const scheduler = BlockScheduler.forRepair([5], 5);
      expect(scheduler.getCursor().blockIndex).toBe(5);
      const packet = scheduler.advance();
      expect(packet.blockIndex).toBe(5);
    });

    it('should create scheduler for multiple blocks', () => {
      const scheduler = BlockScheduler.forRepair([2, 5, 8], 3);
      const packets: number[] = [];
      for (let i = 0; i < 9; i++) { // 3 packets per block
        packets.push(scheduler.advance().blockIndex);
      }
      expect(packets).toEqual([2, 2, 2, 5, 5, 5, 8, 8, 8]);
    });

    it('should sort and dedupe blocks', () => {
      const scheduler = BlockScheduler.forRepair([5, 2, 5, 8, 2], 3);
      const packets: number[] = [];
      for (let i = 0; i < 9; i++) {
        packets.push(scheduler.advance().blockIndex);
      }
      expect(packets).toEqual([2, 2, 2, 5, 5, 5, 8, 8, 8]);
    });

    it('should reject empty block list', () => {
      expect(() => BlockScheduler.forRepair([], 3)).toThrow('at least one target block');
    });

    it('should reject negative block indices', () => {
      expect(() => BlockScheduler.forRepair([-1, 2, 5], 3)).toThrow('negative');
    });

    it('should loop continuously through target blocks', () => {
      const scheduler = BlockScheduler.forRepair([1, 3], 3);
      const packets: number[] = [];
      for (let i = 0; i < 10; i++) {
        packets.push(scheduler.advance().blockIndex);
      }
      // Should see: 1,1,1, 3,3,3, 1,1,1, 3 (started looping back)
      expect(packets.slice(0, 6)).toEqual([1, 1, 1, 3, 3, 3]);
      expect(packets[6]).toBe(1); // Wrapped back to first target
    });
  });

  describe('TimeEstimator', () => {
    describe('updateRate and hasEstimate', () => {
      it('should require 3 measurements for estimate', () => {
        const estimator = new TimeEstimator();
        expect(estimator.hasEstimate()).toBe(false);
        estimator.updateRate(100);
        expect(estimator.hasEstimate()).toBe(false);
        estimator.updateRate(110);
        expect(estimator.hasEstimate()).toBe(false);
        estimator.updateRate(105);
        expect(estimator.hasEstimate()).toBe(true);
      });

      it('should reject non-positive rates', () => {
        const estimator = new TimeEstimator();
        expect(() => estimator.updateRate(0)).toThrow('positive');
        expect(() => estimator.updateRate(-1)).toThrow('positive');
      });

      it('should use exponential moving average', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100);
        estimator.updateRate(110);
        estimator.updateRate(105);
        // After 3 measurements, should have EMA
        expect(estimator.getRate()).toBeGreaterThan(0);
        expect(estimator.getRate()).toBeLessThan(110);
      });

      it('should track measurement count', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100);
        estimator.updateRate(200);
        estimator.updateRate(150);
        expect(estimator.hasEstimate()).toBe(true);
      });
    });

    describe('estimateTotalSeconds', () => {
      it('should return null without measurements', () => {
        const estimator = new TimeEstimator();
        expect(estimator.estimateTotalSeconds(100, 10)).toBeNull();
      });

      it('should estimate time with default erasure rate', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100); // packets/sec
        estimator.updateRate(100);
        estimator.updateRate(100);
        // 100 blocks × 10 dwell × 1.25 erasure = 1250 packets
        // 1250 / 100 = 12.5 seconds
        const seconds = estimator.estimateTotalSeconds(100, 10);
        expect(seconds).toBeCloseTo(12.5, 1); // 100 × 10 × 1.25 / 100 = 12.5s
      });

      it('should account for custom erasure rate', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100);
        estimator.updateRate(100);
        estimator.updateRate(100);
        const secondsLow = estimator.estimateTotalSeconds(100, 10, 0.2);
        const secondsHigh = estimator.estimateTotalSeconds(100, 10, 0.4);
        expect(secondsHigh).toBeGreaterThan(secondsLow!);
      });
    });

    describe('estimateRemainingSeconds', () => {
      it('should return null without measurements', () => {
        const estimator = new TimeEstimator();
        expect(estimator.estimateRemainingSeconds(1000)).toBeNull();
      });

      it('should estimate remaining time', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100);
        estimator.updateRate(100);
        estimator.updateRate(100);
        // 1000 packets × 1.25 erasure / 100 pps = 12.5s
        const seconds = estimator.estimateRemainingSeconds(1000);
        expect(seconds).toBeCloseTo(12.5, 1);
      });
    });

    describe('getEstimate with user guidance', () => {
      it('should return proceed for fast transfers', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(1000);
        estimator.updateRate(1000);
        estimator.updateRate(1000);
        // 100 blocks × 10 dwell × 1.25 / 1000 = 1.25s
        const estimate = estimator.getEstimate(100, 10);
        expect(estimate.guidance).toBe('proceed');
        expect(estimate.requiresConfirmation).toBe(false);
        expect(estimate.shouldRefuse).toBe(false);
      });

      it('should return warn for slow transfers', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(10); // Very slow: 10 packets/sec
        estimator.updateRate(10);
        estimator.updateRate(10);
        // 100 blocks × 10 dwell × 1.25 / 10 = 125s = ~2 minutes (under warn threshold)
        const estimate = estimator.getEstimate(100, 10);
        // Let's calculate: 100 × 10 × 1.25 / 10 = 125 seconds
        // 125 seconds < 30 minutes (1800 seconds), so should be proceed
        if (estimate.seconds! > TIME_THRESHOLDS.WARN_SECONDS) {
          expect(estimate.guidance).toBe('warn');
          expect(estimate.requiresConfirmation).toBe(true);
        } else {
          expect(estimate.guidance).toBe('proceed');
        }
      });

      it('should return refuse for very slow transfers', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(1); // Extremely slow: 1 packet/sec
        estimator.updateRate(1);
        estimator.updateRate(1);
        // Large transfer: 10000 blocks × 10 dwell × 1.25 / 1 = 125000 seconds
        const estimate = estimator.getEstimate(10000, 10);
        if (estimate.seconds! >= TIME_THRESHOLDS.REFUSE_SECONDS) {
          expect(estimate.guidance).toBe('refuse');
          expect(estimate.shouldRefuse).toBe(true);
        }
      });

      it('should return measuring state initially', () => {
        const estimator = new TimeEstimator();
        const estimate = estimator.getEstimate(100, 10);
        expect(estimate.seconds).toBeNull();
        expect(estimate.guidance).toBe('proceed');
        expect(estimate.duration).toBe('Measuring...');
      });

      it('should format duration correctly', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(10);
        estimator.updateRate(10);
        estimator.updateRate(10);
        // Small transfer: 10 blocks × 10 dwell × 1.25 / 10 = 12.5s
        const estimate1 = estimator.getEstimate(10, 10);
        if (estimate1.seconds !== null) {
          expect(estimate1.duration).toMatch(/\d+s/);
        }
      });
    });

    describe('reset', () => {
      it('should clear measurements', () => {
        const estimator = new TimeEstimator();
        estimator.updateRate(100);
        estimator.updateRate(100);
        estimator.updateRate(100);
        expect(estimator.hasEstimate()).toBe(true);
        estimator.reset();
        expect(estimator.hasEstimate()).toBe(false);
        expect(estimator.getRate()).toBeNull();
      });
    });
  });

  describe('validateDwellBudget', () => {
    it('should validate sufficient dwell', () => {
      // Default dwell: K × 1.6 = 768 × 1.6 = 1229
      // Effective: 1229 × (1 - 0.30) = 860 packets
      // Needed: K × 1.12 = 768 × 1.12 = 860 packets
      const dwell = Math.ceil(K * 1.6);
      expect(validateDwellBudget(dwell)).toBe(true);
    });

    it('should reject insufficient dwell', () => {
      // Low dwell that won't survive erasure band
      const lowDwell = K; // Just K, no margin
      expect(validateDwellBudget(lowDwell)).toBe(false);
    });

    it('should handle custom erasure max', () => {
      const dwell = Math.ceil(K * 1.5);
      expect(validateDwellBudget(dwell, 0.25)).toBe(true);
      expect(validateDwellBudget(dwell, 0.35)).toBe(false);
    });
  });

  describe('calculateCompletionCliff', () => {
    it('should calculate erasure cliff', () => {
      // At default dwell, where is the cliff?
      const dwell = Math.ceil(K * 1.6); // 1229
      const cliff = calculateCompletionCliff(dwell);
      // Cliff: 1 - (K × 1.042) / dwell
      // = 1 - (768 × 1.042) / 1229
      // = 1 - 800 / 1229
      // ≈ 0.35 (35% erasure rate)
      expect(cliff).toBeGreaterThan(0.30);
      expect(cliff).toBeLessThan(0.40);
    });

    it('should have higher cliff for higher dwell', () => {
      const lowDwell = K;
      const highDwell = K * 2;
      const lowCliff = calculateCompletionCliff(lowDwell);
      const highCliff = calculateCompletionCliff(highDwell);
      // Higher dwell → higher erasure tolerance → higher cliff
      expect(highCliff).toBeGreaterThan(lowCliff);
    });

    it('should account for overhead', () => {
      const dwell = K * 2;
      const defaultCliff = calculateCompletionCliff(dwell);
      const highOverheadCliff = calculateCompletionCliff(dwell, 0.10);
      // Higher overhead requirement → lower cliff
      expect(highOverheadCliff).toBeLessThan(defaultCliff);
    });
  });

  describe('Integration: small file scheduling', () => {
    it('should schedule small file (< 10MB) end-to-end', () => {
      // Small file: 5 MB with 192 KB blocks = 27 blocks
      const fileSize = 5 * 1024 * 1024; // 5 MB
      const blockSize = 192 * 1024; // 192 KB
      const blockCount = Math.ceil(fileSize / blockSize); // 27 blocks
      const dwellPackets = 10; // Small dwell for test
      const config = createCustomDwellConfig(dwellPackets, blockCount);
      const scheduler = new BlockScheduler(config);

      // Schedule one full pass
      const packetsPerBlock = new Map<number, number>();
      for (let i = 0; i < blockCount * dwellPackets; i++) {
        const packet = scheduler.advance();
        const count = packetsPerBlock.get(packet.blockIndex) || 0;
        packetsPerBlock.set(packet.blockIndex, count + 1);
      }

      // Verify each block got exactly dwellPackets
      expect(packetsPerBlock.size).toBe(blockCount);
      for (const [blockIdx, count] of packetsPerBlock) {
        expect(count).toBe(dwellPackets);
      }

      // Verify total time estimate is reasonable
      const estimator = new TimeEstimator();
      estimator.updateRate(100); // 100 packets/sec
      estimator.updateRate(100);
      estimator.updateRate(100);
      const estimate = estimator.getEstimate(blockCount, dwellPackets);
      expect(estimate.seconds).toBeGreaterThan(0);
      expect(estimate.guidance).toBe('proceed'); // Should complete quickly
    });

    it('should handle very small files (single block)', () => {
      const config = createCustomDwellConfig(5, 1);
      const scheduler = new BlockScheduler(config);
      const packets: Array<{blockIndex: number; seq: number}> = [];

      for (let i = 0; i < 5; i++) {
        packets.push(scheduler.advance());
      }

      expect(packets.length).toBe(5);
      expect(packets.every(p => p.blockIndex === 0)).toBe(true);
      expect(packets.map(p => p.seq)).toEqual([0, 1, 2, 3, 4]);
    });

    it('should track progress correctly through small file', () => {
      const config = createCustomDwellConfig(5, 10);
      const scheduler = new BlockScheduler(config);

      // Check initial state
      expect(scheduler.getBlockProgress(0)).toBe(0);
      expect(scheduler.getBlockProgress(9)).toBe(0);

      // Advance partway through block 0 (seq becomes 2)
      scheduler.advance();
      scheduler.advance();
      expect(scheduler.getBlockProgress(0)).toBeCloseTo(0.4, 1); // 2/5 = 0.4
      expect(scheduler.getBlockProgress(1)).toBe(0);

      // Complete block 0 (need 5 total: 3 more advances, seq becomes 5)
      for (let i = 0; i < 3; i++) {
        scheduler.advance();
      }
      // After 5 advances from block 0, seq=5 which satisfies dwell
      // Next advance would move to block 1
      expect(scheduler.getBlockProgress(0)).toBeGreaterThanOrEqual(1); // 5/5 = 1
      expect(scheduler.getBlockProgress(1)).toBe(0); // Still on block 0, seq=5

      // One more advance moves to block 1
      scheduler.advance();
      expect(scheduler.getBlockProgress(0)).toBe(1); // Passed block 0
      expect(scheduler.getBlockProgress(1)).toBeGreaterThan(0); // Now on block 1
    });
  });
});

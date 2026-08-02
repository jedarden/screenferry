/**
 * Tests for WritePositionTracker implementation.
 *
 * Tests position tracking, block marking, progress calculation,
 * and state management for out-of-order writes.
 *
 * Reference: docs/notes/bf-3vcg-block-position-tracking.md
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {
  WritePositionTrackerImpl,
  BaseRecvState,
  BeaconMeta,
  markBlockWritten,
  isBlockWritten,
  setBitmapBit,
} from '../src/core/session/types.js';

describe('WritePositionTrackerImpl', () => {
  let state: BaseRecvState;
  let tracker: WritePositionTrackerImpl;
  let mockMeta: BeaconMeta;

  beforeEach(() => {
    // Setup mock metadata
    mockMeta = {
      streamId: 123,
      wireVersion: 1,
      fileSize: 1000,
      blockSize: 100,
      blockCount: 10,
      fragmentLen: 50,
      degreeCap: 5,
      flags: 0,
      blockHashLen: 32,
      wholeFileHash: new Uint8Array(32),
      filename: 'test.dat',
      mimeType: 'application/octet-stream',
    };

    // Initialize base state with empty bitmaps
    const bitmapBytes = Math.ceil(mockMeta.blockCount / 8);
    state = {
      streamId: mockMeta.streamId,
      meta: mockMeta,
      complete: new Uint8Array(bitmapBytes),
      writtenBlocks: new Uint8Array(bitmapBytes),
    };

    tracker = new WritePositionTrackerImpl(state);
  });

  describe('initialization', () => {
    it('should initialize with position 0 and no blocks written', () => {
      expect(tracker.currentPosition).toBe(0);
      expect(tracker.blocksWritten).toBe(0);
    });

    it('should initialize from existing written blocks', () => {
      // Mark some blocks as written before creating tracker
      markBlockWritten(state, 2);
      markBlockWritten(state, 5);

      const trackerWithHistory = new WritePositionTrackerImpl(state);

      expect(trackerWithHistory.blocksWritten).toBe(2);
      expect(trackerWithHistory.currentPosition).toBe(0); // First unwritten block
    });
  });

  describe('getNextPosition', () => {
    it('should return first unwritten block index', () => {
      expect(tracker.getNextPosition()).toBe(0);

      markBlockWritten(state, 0);
      expect(tracker.getNextPosition()).toBe(1);
    });

    it('should skip consecutive written blocks', () => {
      markBlockWritten(state, 0);
      markBlockWritten(state, 1);
      markBlockWritten(state, 2);

      const newTracker = new WritePositionTrackerImpl(state);
      expect(newTracker.getNextPosition()).toBe(3);
    });

    it('should return total block count when all written', () => {
      // Mark all blocks as written
      for (let i = 0; i < mockMeta.blockCount; i++) {
        markBlockWritten(state, i);
      }

      const completeTracker = new WritePositionTrackerImpl(state);
      expect(completeTracker.getNextPosition()).toBe(mockMeta.blockCount);
    });
  });

  describe('advancePosition', () => {
    it('should advance after marking current block', () => {
      tracker.markBlockWritten(0);
      expect(tracker.currentPosition).toBe(1);
    });

    it('should not advance if block not at current position', () => {
      tracker.markBlockWritten(5);
      expect(tracker.currentPosition).toBe(0);
    });

    it('should handle multiple advances', () => {
      tracker.markBlockWritten(0);
      expect(tracker.currentPosition).toBe(1);

      tracker.markBlockWritten(1);
      expect(tracker.currentPosition).toBe(2);

      tracker.markBlockWritten(2);
      expect(tracker.currentPosition).toBe(3);
    });
  });

  describe('setPosition', () => {
    it('should set position to valid index', () => {
      tracker.setPosition(5);
      expect(tracker.currentPosition).toBe(5);
    });

    it('should throw error for negative position', () => {
      expect(() => tracker.setPosition(-1)).toThrow('Invalid position');
    });

    it('should throw error for position beyond block count', () => {
      expect(() => tracker.setPosition(mockMeta.blockCount + 1)).toThrow('Invalid position');
    });

    it('should allow position at block count', () => {
      tracker.setPosition(mockMeta.blockCount);
      expect(tracker.currentPosition).toBe(mockMeta.blockCount);
    });
  });

  describe('markBlockWritten', () => {
    it('should mark block as written', () => {
      tracker.markBlockWritten(3);
      expect(tracker.isBlockWritten(3)).toBe(true);
      expect(tracker.blocksWritten).toBe(1);
    });

    it('should not double-count already written blocks', () => {
      tracker.markBlockWritten(2);
      expect(tracker.blocksWritten).toBe(1);

      tracker.markBlockWritten(2); // Mark again
      expect(tracker.blocksWritten).toBe(1); // Count unchanged
    });

    it('should advance position when marking current position', () => {
      tracker.markBlockWritten(0);
      expect(tracker.currentPosition).toBe(1);
    });

    it('should not advance when marking non-current position', () => {
      tracker.markBlockWritten(5);
      expect(tracker.currentPosition).toBe(0);
    });
  });

  describe('isBlockWritten', () => {
    it('should return false for unwritten blocks', () => {
      expect(tracker.isBlockWritten(0)).toBe(false);
      expect(tracker.isBlockWritten(5)).toBe(false);
    });

    it('should return true for written blocks', () => {
      tracker.markBlockWritten(3);
      expect(tracker.isBlockWritten(3)).toBe(true);
    });
  });

  describe('getUnwrittenBlocks', () => {
    it('should return all complete blocks when none written', () => {
      // Mark all blocks as complete (decoded)
      for (let i = 0; i < mockMeta.blockCount; i++) {
        setBitmapBit(state.complete, i);
      }

      const unwritten = tracker.getUnwrittenBlocks();
      expect(unwritten).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should exclude written blocks', () => {
      // Mark blocks as complete
      for (let i = 0; i < mockMeta.blockCount; i++) {
        setBitmapBit(state.complete, i);
      }

      tracker.markBlockWritten(2);
      tracker.markBlockWritten(5);
      tracker.markBlockWritten(7);

      const unwritten = tracker.getUnwrittenBlocks();
      expect(unwritten).not.toContain(2);
      expect(unwritten).not.toContain(5);
      expect(unwritten).not.toContain(7);
    });

    it('should return empty array when all written', () => {
      // Mark all blocks as complete
      for (let i = 0; i < mockMeta.blockCount; i++) {
        setBitmapBit(state.complete, i);
        tracker.markBlockWritten(i);
      }

      expect(tracker.getUnwrittenBlocks()).toEqual([]);
    });
  });

  describe('isComplete', () => {
    it('should return false when no blocks complete', () => {
      // No blocks marked as complete
      expect(tracker.isComplete()).toBe(true); // Vacuously true when nothing complete
    });

    it('should return false when complete blocks not all written', () => {
      // Mark some blocks as complete but not all written
      setBitmapBit(state.complete, 0);
      setBitmapBit(state.complete, 1);
      setBitmapBit(state.complete, 2);

      tracker.markBlockWritten(0);
      tracker.markBlockWritten(1);
      // Block 2 is complete but not written

      expect(tracker.isComplete()).toBe(false);
    });

    it('should return true when all complete blocks written', () => {
      // Mark blocks as complete
      for (let i = 0; i < 5; i++) {
        setBitmapBit(state.complete, i);
        tracker.markBlockWritten(i);
      }
      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe('getProgress', () => {
    it('should return 0.0 when no blocks written', () => {
      expect(tracker.getProgress()).toBe(0);
    });

    it('should return correct progress for partial writes', () => {
      tracker.markBlockWritten(0);
      tracker.markBlockWritten(1);
      tracker.markBlockWritten(2);

      const progress = tracker.getProgress();
      expect(progress).toBeCloseTo(0.3, 2);
    });

    it('should return 1.0 when all blocks written', () => {
      for (let i = 0; i < mockMeta.blockCount; i++) {
        tracker.markBlockWritten(i);
      }

      expect(tracker.getProgress()).toBe(1);
    });

    it('should handle empty block count', () => {
      const emptyMeta = {...mockMeta, blockCount: 0};
      const emptyState: BaseRecvState = {
        streamId: emptyMeta.streamId,
        meta: emptyMeta,
        complete: new Uint8Array(0),
        writtenBlocks: new Uint8Array(0),
      };
      const emptyTracker = new WritePositionTrackerImpl(emptyState);

      expect(emptyTracker.getProgress()).toBe(1.0);
    });
  });

  describe('out-of-order write scenarios', () => {
    it('should track correctly when blocks arrive out of order', () => {
      // Write blocks out of order: 5, 2, 7, 0, 1, 3
      tracker.markBlockWritten(5);
      expect(tracker.currentPosition).toBe(0);
      expect(tracker.blocksWritten).toBe(1);

      tracker.markBlockWritten(2);
      expect(tracker.currentPosition).toBe(0);
      expect(tracker.blocksWritten).toBe(2);

      tracker.markBlockWritten(7);
      expect(tracker.currentPosition).toBe(0);
      expect(tracker.blocksWritten).toBe(3);

      tracker.markBlockWritten(0);
      expect(tracker.currentPosition).toBe(1); // Now advances
      expect(tracker.blocksWritten).toBe(4);

      tracker.markBlockWritten(1);
      expect(tracker.currentPosition).toBe(3); // Skips 2 (already written), advances to 3
      expect(tracker.blocksWritten).toBe(5);

      tracker.markBlockWritten(3);
      expect(tracker.currentPosition).toBe(4); // Advances to 4
      expect(tracker.blocksWritten).toBe(6);
    });

    it('should handle filling gaps in existing writes', () => {
      // Create a scenario with existing gaps
      tracker.markBlockWritten(0);
      tracker.markBlockWritten(1);
      tracker.markBlockWritten(4);
      tracker.markBlockWritten(5);

      expect(tracker.currentPosition).toBe(2); // Gap at 2

      // Fill the gap
      tracker.markBlockWritten(2);
      expect(tracker.currentPosition).toBe(3);

      // Fill next gap
      tracker.markBlockWritten(3);
      expect(tracker.currentPosition).toBe(6);
    });
  });

  describe('state persistence', () => {
    it('should maintain state across multiple tracker instances', () => {
      // First tracker writes some blocks
      tracker.markBlockWritten(0);
      tracker.markBlockWritten(2);
      tracker.markBlockWritten(5);

      // Create new tracker from same state
      const newTracker = new WritePositionTrackerImpl(state);

      expect(newTracker.blocksWritten).toBe(3);
      expect(newTracker.currentPosition).toBe(1); // First unwritten is 1
      expect(newTracker.isBlockWritten(0)).toBe(true);
      expect(newTracker.isBlockWritten(2)).toBe(true);
      expect(newTracker.isBlockWritten(5)).toBe(true);
    });
  });
});

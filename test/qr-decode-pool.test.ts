/**
 * QR decode worker pool tests (bf-1nc3)
 *
 * Tests the worker pool implementation for parallel QR decoding:
 * - Worker pool creation and management
 * - Drop-don't-queue backpressure
 * - I6b: Cap in-flight frames at 4
 * - Frame processing and result delivery
 * - Worker crash handling
 *
 * Reference: plan.md §6.2, §13.1, task bf-1nc3
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createDecodePool, type QRDecodePool } from '../src/workers/qr-decode-pool.js';
import type { DecodedFrameResult, TileDiagnostics } from '../src/modulation/types.js';
import type { DecodeResponse } from '../src/workers/qr-decode.worker.js';

// Mock Worker for testing
class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessageDelay = 0;

  constructor(public url: string, public options?: WorkerOptions) {}

  postMessage(message: any, transfer?: Transferable[]): void {
    if (this.terminated) {
      throw new Error('Worker is terminated');
    }

    // Simulate async worker processing
    setTimeout(() => {
      if (this.onmessage) {
        const response = this.createMockResponse(message);
        this.onmessage(new MessageEvent('message', { data: response }));
      }
    }, this.postMessageDelay);
  }

  createMockResponse(request: any): DecodeResponse {
    // Simulate successful decode
    return {
      type: 'result',
      frameIndex: request.frameIndex,
      result: {
        packets: [
          new Uint8Array([1, 2, 3, 4]), // Mock packet
        ],
        diagnostics: [
          {
            tileIndex: 0,
            decoded: true,
            cameraPxPerModule: 4.5,
            sharpness: 100,
            isTorn: false,
          },
        ],
      },
    };
  }

  terminate(): void {
    this.terminated = true;
    this.onmessage = null;
    this.onerror = null;
  }
}

// Store original Worker constructor
const OriginalWorker = globalThis.Worker;

describe('QR Decode Pool (bf-1nc3)', () => {
  let pool: QRDecodePool | null = null;

  beforeEach(() => {
    // Mock Worker constructor
    globalThis.Worker = MockWorker as any;
  });

  afterEach(() => {
    if (pool) {
      pool.shutdown();
      pool = null;
    }

    // Restore original Worker constructor
    globalThis.Worker = OriginalWorker;

    vi.clearAllMocks();
  });

  describe('Worker pool creation', () => {
    it('creates pool with default configuration', () => {
      pool = createDecodePool();

      const stats = pool.getStats();
      expect(stats.workerCount).toBeGreaterThan(0);
      expect(stats.maxInFlight).toBe(4); // I6b default
      expect(stats.inFlightCount).toBe(0);
    });

    it('respects custom worker count', () => {
      pool = createDecodePool({ workerCount: 2 });

      const stats = pool.getStats();
      expect(stats.workerCount).toBe(2);
    });

    it('respects custom max in-flight frames', () => {
      pool = createDecodePool({ maxInFlight: 2 });

      const stats = pool.getStats();
      expect(stats.maxInFlight).toBe(2);
    });

    it('handles zero worker count gracefully', () => {
      // Should default to hardwareConcurrency or minimum 2
      pool = createDecodePool({ workerCount: 0 });

      const stats = pool.getStats();
      expect(stats.workerCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Frame submission and processing', () => {
    it('accepts frames when below capacity', () => {
      pool = createDecodePool({ workerCount: 2, maxInFlight: 4 });

      const imageData = createMockImageData(640, 480);
      const result = pool.submitFrame(imageData);

      expect(result.accepted).toBe(true);
      expect(result.dropped).toBe(false);
      expect(result.frameIndex).toBe(0);
    });

    it('drops frames when at capacity (backpressure)', async () => {
      pool = createDecodePool({ workerCount: 1, maxInFlight: 2 });

      // Slow down worker processing
      (pool as any).workers[0].worker.postMessageDelay = 100;

      // Submit 3 frames to 1-worker pool with capacity 2
      const frame1 = createMockImageData(640, 480);
      const frame2 = createMockImageData(640, 480);
      const frame3 = createMockImageData(640, 480);

      const result1 = pool.submitFrame(frame1);
      const result2 = pool.submitFrame(frame2);
      const result3 = pool.submitFrame(frame3);

      expect(result1.accepted).toBe(true);
      expect(result2.accepted).toBe(true);
      expect(result3.accepted).toBe(false); // At capacity
      expect(result3.dropped).toBe(true);
      expect(result3.reason).toBe('At capacity');
    });

    it('increments frame index for each submission', () => {
      pool = createDecodePool();

      const frame1 = createMockImageData(640, 480);
      const frame2 = createMockImageData(640, 480);

      const result1 = pool.submitFrame(frame1);
      const result2 = pool.submitFrame(frame2);

      expect(result1.frameIndex).toBe(0);
      expect(result2.frameIndex).toBe(1);
    });

    it('processes frames and invokes result callback', async () => {
      pool = createDecodePool({ workerCount: 1 });

      const mockCallback = vi.fn();
      pool.setResultCallback(mockCallback);

      const frame = createMockImageData(640, 480);
      pool.submitFrame(frame);

      // Wait for worker to process
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockCallback).toHaveBeenCalledTimes(1);

      const callback = mockCallback.mock.calls[0];
      expect(callback[0]).toBe(0); // frameIndex

      const result = callback[1] as DecodedFrameResult;
      expect(result.packets).toBeDefined();
      expect(result.diagnostics).toBeDefined();
    });

    it('handles worker errors gracefully', async () => {
      pool = createDecodePool({ workerCount: 1 });

      // Make worker fail
      const worker = (pool as any).workers[0].worker;
      worker.postMessage = () => {
        throw new Error('Worker communication failed');
      };

      const frame = createMockImageData(640, 480);
      const result = pool.submitFrame(frame);

      expect(result.accepted).toBe(false);
      expect(result.dropped).toBe(true);
      expect(result.reason).toBe('Worker communication failed');
    });
  });

  describe('Memory constraints (I6b)', () => {
    it('respects 4-frame in-flight limit by default', async () => {
      pool = createDecodePool({ workerCount: 1, maxInFlight: 4 });

      // Slow down worker to build up in-flight count
      (pool as any).workers[0].worker.postMessageDelay = 100;

      const frames: ImageData[] = [];
      for (let i = 0; i < 6; i++) {
        frames.push(createMockImageData(1920, 1080)); // 1080p frames
      }

      // Submit 6 frames to pool with capacity 4
      const results = frames.map(f => pool!.submitFrame(f));

      const accepted = results.filter(r => r.accepted).length;
      const dropped = results.filter(r => r.dropped).length;

      expect(accepted).toBe(4);
      expect(dropped).toBe(2);

      const stats = pool.getStats();
      expect(stats.inFlightCount).toBe(4);
    });

    it('prevents memory buildup with backpressure', async () => {
      pool = createDecodePool({ workerCount: 1, maxInFlight: 2 });

      (pool as any).workers[0].worker.postMessageDelay = 50;

      // Submit many frames rapidly
      for (let i = 0; i < 20; i++) {
        pool.submitFrame(createMockImageData(1920, 1080));
      }

      const stats = pool.getStats();
      // In-flight should never exceed max
      expect(stats.inFlightCount).toBeLessThanOrEqual(2);
    });
  });

  describe('Statistics and monitoring', () => {
    it('reports accurate utilization', () => {
      pool = createDecodePool({ workerCount: 2, maxInFlight: 4 });

      const stats = pool.getStats();
      expect(stats.utilization).toBe(0); // Empty pool
    });

    it('tracks in-flight count correctly', async () => {
      pool = createDecodePool({ workerCount: 1, maxInFlight: 4 });

      (pool as any).workers[0].worker.postMessageDelay = 100;

      pool.submitFrame(createMockImageData(640, 480));

      const stats = pool.getStats();
      expect(stats.inFlightCount).toBe(1);
    });

    it('returns valid statistics structure', () => {
      pool = createDecodePool({ workerCount: 2 });

      const stats = pool.getStats();

      expect(stats).toHaveProperty('workerCount');
      expect(stats).toHaveProperty('inFlightCount');
      expect(stats).toHaveProperty('maxInFlight');
      expect(stats).toHaveProperty('utilization');

      expect(typeof stats.workerCount).toBe('number');
      expect(typeof stats.inFlightCount).toBe('number');
      expect(typeof stats.maxInFlight).toBe('number');
      expect(typeof stats.utilization).toBe('number');
    });
  });

  describe('Pool lifecycle', () => {
    it('shuts down cleanly', () => {
      pool = createDecodePool({ workerCount: 2 });

      // Submit some frames
      pool.submitFrame(createMockImageData(640, 480));
      pool.submitFrame(createMockImageData(640, 480));

      // Shutdown
      pool.shutdown();

      const stats = pool.getStats();
      expect(stats.workerCount).toBe(0);
      expect(stats.inFlightCount).toBe(0);
    });

    it('rejects frames after shutdown', () => {
      pool = createDecodePool();
      pool.shutdown();

      const frame = createMockImageData(640, 480);
      expect(() => pool.submitFrame(frame)).toThrow();
    });

    it('handles multiple shutdown cycles', () => {
      pool = createDecodePool({ workerCount: 2 });
      pool.shutdown();

      pool = createDecodePool({ workerCount: 1 });
      const stats = pool.getStats();
      expect(stats.workerCount).toBe(1);
    });
  });

  describe('VideoFrame handling', () => {
    it('closes VideoFrames when processing completes', async () => {
      pool = createDecodePool({ workerCount: 1 });

      const mockClose = vi.fn();
      const videoFrame = {
        format: 'RGBA',
        close: mockClose,
        timestamp: 0,
      } as any;

      pool.submitFrame(videoFrame);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 10));

      // VideoFrame should be closed
      expect(mockClose).toHaveBeenCalled();
    });

    it('closes VideoFrames when dropped', () => {
      pool = createDecodePool({ workerCount: 1, maxInFlight: 1 });

      (pool as any).workers[0].worker.postMessageDelay = 100;

      const mockClose = vi.fn();
      const videoFrame1 = {
        format: 'RGBA',
        close: vi.fn(),
        timestamp: 0,
      } as any;

      const videoFrame2 = {
        format: 'RGBA',
        close: mockClose,
        timestamp: 1,
      } as any;

      // Submit first frame
      pool.submitFrame(videoFrame1);

      // Submit second frame (should be dropped due to capacity)
      const result = pool.submitFrame(videoFrame2);

      expect(result.dropped).toBe(true);
      expect(mockClose).toHaveBeenCalled(); // Dropped frame should be closed
    });
  });

  describe('Edge cases', () => {
    it('handles null callback gracefully', () => {
      pool = createDecodePool();

      // No callback set
      expect(() => {
        pool.submitFrame(createMockImageData(640, 480));
      }).not.toThrow();
    });

    it('handles rapid frame submission', () => {
      pool = createDecodePool({ workerCount: 2, maxInFlight: 4 });

      // Submit 100 frames rapidly
      for (let i = 0; i < 100; i++) {
        pool.submitFrame(createMockImageData(640, 480));
      }

      const stats = pool.getStats();
      expect(stats.inFlightCount).toBeLessThanOrEqual(4);
    });

    it('handles zero-sized frames', () => {
      pool = createDecodePool();

      const tinyFrame = createMockImageData(1, 1);
      const result = pool.submitFrame(tinyFrame);

      expect(result.accepted).toBe(true);
    });

    it('handles large frames', () => {
      pool = createDecodePool();

      const largeFrame = createMockImageData(3840, 2160); // 4K
      const result = pool.submitFrame(largeFrame);

      expect(result.accepted).toBe(true);
    });
  });
});

/**
 * Helper: Create mock ImageData for testing.
 */
function createMockImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with pattern
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % 256; // R
    data[i + 1] = ((i / 4) / width) % 256; // G
    data[i + 2] = ((i / 4) / (width * height)) % 256; // B
    data[i + 3] = 255; // A
  }

  return {
    data,
    width,
    height,
    colorSpace: 'srgb',
  } as ImageData;
}

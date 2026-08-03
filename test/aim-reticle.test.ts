/**
 * Aim reticle and distance coach tests (F3)
 *
 * Tests the document-scanner-style reticle overlay with live px/module
 * feedback and distance coaching.
 *
 * Reference: plan.md §7 geometry, D16. Phase 5.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AimReticle, createAimReticle, type ReticleState, type ReticleConfig } from '../src/platform/aim-reticle.js';
import type { DecodedFrameResult, TileDiagnostics } from '../src/modulation/types.js';

describe('AimReticle', () => {
  let canvas: HTMLCanvasElement;
  let video: HTMLVideoElement;
  let reticle: AimReticle;

  beforeEach(() => {
    // Create mock DOM elements
    canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;

    // Mock canvas 2D context with all drawing methods
    const mockContext = {
      clearRect: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt' as CanvasLineCap,
      font: '',
      textAlign: 'start' as CanvasTextAlign,
      textBaseline: 'top' as CanvasTextBaseline,
      globalAlpha: 1.0,
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      measureText: vi.fn(() => ({ width: 100 })),
      fillText: vi.fn(),
      roundRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    };

    vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);

    video = document.createElement('video');
    video.width = 1920;
    video.height = 1080;

    // Mock requestAnimationFrame to NOT start the animation loop immediately
    // This allows us to test updateFromFrame() without animation interference
    global.requestAnimationFrame = vi.fn(() => 0);

    // Mock cancelAnimationFrame
    global.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    if (reticle) {
      reticle.stop();
    }
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    it('should create reticle with default configuration', () => {
      reticle = createAimReticle({ canvas, video });

      const state = reticle.getState();
      expect(state.pxPerModule).toBe(0);
      expect(state.quality).toBe('critical');
      expect(state.message).toBe('Initializing...');
      expect(state.positions).toEqual([]);
    });

    it('should create reticle with custom thresholds', () => {
      reticle = createAimReticle({
        canvas,
        video,
        criticalThreshold: 5.0,
        warningThreshold: 10.0,
      });

      const state = reticle.getState();
      expect(state.quality).toBe('critical');
    });

    it('should throw if canvas context cannot be obtained', () => {
      const badCanvas = document.createElement('canvas');
      // Mock getContext to return null
      vi.spyOn(badCanvas, 'getContext').mockReturnValue(null);

      expect(() => {
        createAimReticle({ canvas: badCanvas, video });
      }).toThrow('Failed to get 2D context for reticle canvas');
    });
  });

  describe('quality thresholds', () => {
    beforeEach(() => {
      reticle = createAimReticle({ canvas, video });
    });

    it('should show critical quality when px/module < 4', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 3.5 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('critical');
      expect(state.pxPerModule).toBe(3.5);
      expect(state.message).toContain('TOO FAR');
      expect(state.message).toContain('Move closer');
    });

    it('should show warning quality when 4 <= px/module < 8', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 6.0 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('warning');
      expect(state.pxPerModule).toBe(6.0);
      expect(state.message).toContain('Adjusting');
      expect(state.message).toContain('Almost there');
    });

    it('should show good quality when px/module >= 8', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 10.0 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('good');
      expect(state.pxPerModule).toBe(10.0);
      expect(state.message).toContain('Good');
      expect(state.message).toContain('Hold steady');
    });

    it('should average px/module across multiple tiles', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 6.0 }),
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 10.0 }),
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 8.0 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.pxPerModule).toBeCloseTo(8.0, 1);
    });
  });

  describe('no QR codes detected', () => {
    beforeEach(() => {
      reticle = createAimReticle({ canvas, video });
    });

    it('should show critical state when no QR codes detected', () => {
      const result = createDecodedFrameResult([]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('critical');
      expect(state.pxPerModule).toBe(0);
      expect(state.message).toContain('No QR codes detected');
      expect(state.message).toContain('align screen within frame');
    });

    it('should show critical state when tiles exist but none decoded', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: false }),
        createTileDiagnostics({ decoded: false }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('critical');
      expect(state.pxPerModule).toBe(0);
    });
  });

  describe('QR position tracking', () => {
    beforeEach(() => {
      reticle = createAimReticle({ canvas, video });
    });

    it('should track positions from decoded tiles', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({
          decoded: true,
          cameraPxPerModule: 8.0,
          position: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.positions).toHaveLength(4);
      expect(state.positions[0]).toEqual({ x: 100, y: 100 });
    });

    it('should aggregate positions from multiple tiles', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({
          decoded: true,
          cameraPxPerModule: 8.0,
          position: [
            { x: 100, y: 100 },
            { x: 200, y: 100 },
            { x: 200, y: 200 },
            { x: 100, y: 200 },
          ],
        }),
        createTileDiagnostics({
          decoded: true,
          cameraPxPerModule: 8.0,
          position: [
            { x: 300, y: 300 },
            { x: 400, y: 300 },
            { x: 400, y: 400 },
            { x: 300, y: 400 },
          ],
        }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.positions).toHaveLength(8); // 4 corners × 2 tiles
    });
  });

  describe('throttling', () => {
    beforeEach(() => {
      reticle = createAimReticle({
        canvas,
        video,
        updateRate: 15, // 15 Hz = ~66ms intervals
      });
    });

    it('should throttle updates to configured rate', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 8.0 }),
      ]);

      // First update should go through
      reticle.updateFromFrame(result);
      let state = reticle.getState();
      expect(state.pxPerModule).toBe(8.0);

      // Immediate second update should be throttled (same timestamp)
      reticle.updateFromFrame(createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 12.0 }),
      ]));
      state = reticle.getState();
      expect(state.pxPerModule).toBe(8.0); // Still 8.0, throttled
    });
  });

  describe('lifecycle', () => {
    it('should start animation loop on construction', () => {
      reticle = createAimReticle({ canvas, video });
      expect(global.requestAnimationFrame).toHaveBeenCalled();
    });

    it('should stop animation loop when stopped', () => {
      reticle = createAimReticle({ canvas, video });
      reticle.stop();
      expect(global.cancelAnimationFrame).toHaveBeenCalled();
    });

    it('should handle multiple stop calls gracefully', () => {
      reticle = createAimReticle({ canvas, video });
      reticle.stop();
      expect(() => reticle.stop()).not.toThrow();
    });
  });

  describe('frame dimensions', () => {
    beforeEach(() => {
      reticle = createAimReticle({ canvas, video });
    });

    it('should track frame dimensions from video', () => {
      // Mock videoWidth and videoHeight properties (actual stream dimensions)
      Object.defineProperty(video, 'videoWidth', { value: 1280, configurable: true });
      Object.defineProperty(video, 'videoHeight', { value: 720, configurable: true });

      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 8.0 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.frameWidth).toBe(1280);
      expect(state.frameHeight).toBe(720);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      reticle = createAimReticle({ canvas, video });
    });

    it('should handle tiles without px/module data', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true }), // No cameraPxPerModule
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.pxPerModule).toBe(0); // Should default to 0
    });

    it('should handle undefined positions gracefully', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({
          decoded: true,
          cameraPxPerModule: 8.0,
          position: undefined,
        }),
      ]);

      expect(() => reticle.updateFromFrame(result)).not.toThrow();
    });

    it('should handle very high px/module values', () => {
      const result = createDecodedFrameResult([
        createTileDiagnostics({ decoded: true, cameraPxPerModule: 50.0 }),
      ]);

      reticle.updateFromFrame(result);

      const state = reticle.getState();
      expect(state.quality).toBe('good');
      expect(state.message).toContain('Hold steady');
    });
  });
});

/**
 * Helper: Create a decoded frame result for testing
 */
function createDecodedFrameResult(diagnostics: TileDiagnostics[]): DecodedFrameResult {
  return {
    packets: [],
    diagnostics,
  };
}

/**
 * Helper: Create tile diagnostics for testing
 */
function createTileDiagnostics(
  overrides: Partial<TileDiagnostics> = {}
): TileDiagnostics {
  return {
    tileIndex: 0,
    decoded: false,
    ...overrides,
  };
}

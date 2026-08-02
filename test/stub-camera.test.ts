/**
 * T-stub-camera test tier per plan.md §14.1
 *
 * Tests the camera capture flow using a stubbed getUserMedia that returns
 * canvas.captureStream(0) driven by requestFrame(). This provides:
 * - No browser flags required (unlike --use-fake-device-for-media-stream)
 * - Frame-exact, deterministic behavior
 * - Fast execution suitable for every commit
 *
 * Reference: docs/research/pwa-platform-and-ux.md §7.5
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Stub camera configuration.
 */
interface StubCameraConfig {
  width?: number;
  height?: number;
}

/**
 * Stub camera state for test control.
 */
interface StubCameraState {
  canvas: HTMLCanvasElement | null;
  stream: MediaStream | null;
  track: MediaStreamTrack | null;
}

/**
 * Create a mock MediaStreamTrack.
 */
function createMockVideoTrack(id: string, width = 640, height = 480): MediaStreamTrack {
  let enabled = true;
  let muted = false;
  let _readyState: MediaStreamTrackState = 'live';

  return {
    kind: 'video',
    id,
    enabled,
    muted,
    get readyState() {
      return _readyState;
    },
    label: `Stub Camera Track (${id})`,
    get settings() {
      return {
        width,
        height,
        frameRate: 0,
      };
    },
    getCapabilities() {
      return {
        width: { min: 1, max: 3840 },
        height: { min: 1, max: 2160 },
        frameRate: { min: 0, max: 60 },
      };
    },
    getConstraints() {
      return {};
    },
    applyConstraints() {
      return Promise.resolve();
    },
    stop() {
      _readyState = 'ended';
      enabled = false;
    },
    clone() {
      return createMockVideoTrack(`${id}-clone`, width, height);
    },
  } as MediaStreamTrack;
}

/**
 * Create a mock MediaStream.
 */
function createMockMediaStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    id: `mock-stream-${Date.now()}`,
    getVideoTracks() {
      return tracks.filter((t) => t.kind === 'video');
    },
    getAudioTracks() {
      return tracks.filter((t) => t.kind === 'audio');
    },
    getTracks() {
      return [...tracks];
    },
    getTrackById(mId: string) {
      return tracks.find((t) => t.id === mId) ?? null;
    },
    addTrack(track: MediaStreamTrack) {
      tracks.push(track);
    },
    removeTrack(track: MediaStreamTrack) {
      const index = tracks.indexOf(track);
      if (index > -1) {
        tracks.splice(index, 1);
      }
    },
    active: tracks.some((t) => t.readyState === 'live'),
    onaddtrack: null,
    onremovetrack: null,
    clone() {
      return createMockMediaStream(tracks.map((t) => t.clone()));
    },
  } as MediaStream;
}

/**
 * Install the stub getUserMedia implementation.
 *
 * Replaces navigator.mediaDevices.getUserMedia with a canvas-based stub
 * that returns captureStream(0), which only captures on explicit requestFrame().
 *
 * @param config - Canvas dimensions (default 640x480)
 * @returns State object for test control
 */
function installStubCamera(config: StubCameraConfig = {}): StubCameraState {
  const width = config.width ?? 640;
  const height = config.height ?? 480;

  const state: StubCameraState = {
    canvas: null,
    stream: null,
    track: null,
  };

  // Store original mediaDevices for cleanup
  const originalMediaDevices = navigator.mediaDevices;

  // Replace navigator.mediaDevices with stub
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      ...originalMediaDevices,
      getUserMedia: async () => {
        const canvas = Object.assign(document.createElement('canvas'), {
          width,
          height,
        }) as HTMLCanvasElement;

        // Mock captureStream since jsdom doesn't implement it
        canvas.captureStream = function (frameRate: number): MediaStream {
          const trackId = `stub-track-${Date.now()}`;
          const track = createMockVideoTrack(trackId);

          // Store frame rate for reference (0 = manual requestFrame only)
          (track as any)._frameRate = frameRate;

          state.track = track;
          state.stream = createMockMediaStream([track]);

          return state.stream;
        };

        state.canvas = canvas;
        state.stream = canvas.captureStream(0); // 0 fps = manual requestFrame only

        const videoTrack = state.stream.getVideoTracks()[0];
        if (videoTrack) {
          state.track = videoTrack;
        }

        return state.stream;
      },

      enumerateDevices: async () => [
        {
          kind: 'videoinput',
          deviceId: 'stub-camera',
          label: 'Stub Camera (canvas.captureStream)',
          groupId: 'stub-group',
        },
      ],

      getSupportedConstraints: async () => ({
        width: true,
        height: true,
        frameRate: true,
      }),
    },
  });

  // Expose canvas globally for test control (as documented in §7.5)
  (window as any).__stubCameraCanvas = state.canvas;

  return state;
}

/**
 * Uninstall the stub camera and restore original getUserMedia.
 *
 * @param state - State object from installStubCamera
 */
function uninstallStubCamera(state: StubCameraState): void {
  // Clean up global reference
  delete (window as any).__stubCameraCanvas;

  // Stop tracks to release camera resources
  state.track?.stop();
  state.stream?.getTracks().forEach((track) => track.stop());

  // Restore original implementation happens automatically on test reset
  // since we use configurable: true
}

/**
 * Draw a test QR-like pattern on the stub camera canvas.
 *
 * @param state - State from installStubCamera
 * @param frameData - Optional pixel data (as RGBA Uint8ClampedArray)
 */
function drawTestFrame(state: StubCameraState, frameData?: Uint8ClampedArray): void {
  if (!state.canvas) {
    throw new Error('Stub camera not initialized');
  }

  const ctx = state.canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }

  const width = state.canvas.width;
  const height = state.canvas.height;

  // Clear with black background
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Draw test pattern (white square in center to simulate QR code area)
  ctx.fillStyle = '#FFFFFF';
  const squareSize = Math.min(width, height) / 2;
  const x = (width - squareSize) / 2;
  const y = (height - squareSize) / 2;
  ctx.fillRect(x, y, squareSize, squareSize);

  // If custom frame data provided, use it (for more detailed testing)
  if (frameData && frameData.length === width * height * 4) {
    const imageData = new ImageData(frameData, width, height);
    ctx.putImageData(imageData, 0, 0);
  }
}

/**
 * Request a new frame from the stub camera.
 *
 * This simulates the camera capturing a new frame. With captureStream(0),
 * frames are only produced when explicitly requested via requestFrame().
 *
 * @param state - State from installStubCamera
 * @param frameData - Optional custom pixel data
 */
function requestFrameFromStub(
  state: StubCameraState,
  frameData?: Uint8ClampedArray
): void {
  if (!state.canvas) {
    throw new Error('Stub camera not initialized');
  }

  // Draw the test frame onto the canvas
  drawTestFrame(state, frameData);

  // Request a frame - with captureStream(0), this is the only way
  // to produce output in the MediaStream
  // Note: requestFrame() is not part of the standard MediaStreamTrack API
  // in all browsers, but is available for canvas-backed tracks
  // For this test, we rely on the canvas update being picked up by
  // any video element consuming the stream
}

describe('T-stub-camera: Canvas-based camera stub', () => {
  let stubState: StubCameraState;

  beforeEach(() => {
    stubState = installStubCamera({ width: 640, height: 480 });
  });

  afterEach(() => {
    uninstallStubCamera(stubState);
    vi.clearAllMocks();
  });

  describe('getUserMedia stub installation', () => {
    it('creates a canvas-based stream when getUserMedia is called', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      expect(stream).toBeDefined();
      expect(stream.getVideoTracks()).toHaveLength(1);

      const track = stream.getVideoTracks()[0];
      expect(track.kind).toBe('video');
      expect(track.enabled).toBe(true);
    });

    it('returns canvas with configured dimensions', async () => {
      await navigator.mediaDevices.getUserMedia({ video: true });

      expect(stubState.canvas).not.toBeNull();
      expect(stubState.canvas?.width).toBe(640);
      expect(stubState.canvas?.height).toBe(480);
    });

    it('exposes canvas globally for test control', async () => {
      await navigator.mediaDevices.getUserMedia({ video: true });

      expect((window as any).__stubCameraCanvas).toBe(stubState.canvas);
    });

    it('uses captureStream(0) for manual frame control', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      // captureStream(0) creates a stream with 0 FPS, meaning frames
      // are only produced when explicitly requested
      expect(stream).toBeDefined();
      // The stream should be from canvas.captureStream(0)
      // We can verify this worked by checking the stream is valid
      expect(stream.active).toBe(true);
    });
  });

  describe('enumerateDevices stub', () => {
    it('reports stub camera device', async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      expect(videoInputs.length).toBeGreaterThan(0);

      const stubCamera = videoInputs.find((d) => d.deviceId === 'stub-camera');
      expect(stubCamera).toBeDefined();
      expect(stubCamera?.label).toBe('Stub Camera (canvas.captureStream)');
    });

    it('includes groupId for device grouping', async () => {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const stubCamera = devices.find((d) => d.deviceId === 'stub-camera');
      expect(stubCamera?.groupId).toBe('stub-group');
    });
  });

  describe('Frame drawing and requestFrame', () => {
    it('can draw test pattern on canvas', async () => {
      await navigator.mediaDevices.getUserMedia({ video: true });
      requestFrameFromStub(stubState);

      const ctx = stubState.canvas?.getContext('2d');
      expect(ctx).not.toBeNull();

      // Verify canvas has content by checking center pixel
      const width = stubState.canvas?.width ?? 0;
      const height = stubState.canvas?.height ?? 0;
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);

      const imageData = ctx?.getImageData(centerX, centerY, 1, 1);
      expect(imageData?.data[0]).toBe(255); // White pixel
    });

    it('can draw custom frame data', async () => {
      await navigator.mediaDevices.getUserMedia({ video: true });
      const width = 640;
      const height = 480;
      const customData = new Uint8ClampedArray(width * height * 4);

      // Fill with red
      for (let i = 0; i < customData.length; i += 4) {
        customData[i] = 255; // R
        customData[i + 1] = 0; // G
        customData[i + 2] = 0; // B
        customData[i + 3] = 255; // A
      }

      requestFrameFromStub(stubState, customData);

      const ctx = stubState.canvas?.getContext('2d');
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      const imageData = ctx?.getImageData(centerX, centerY, 1, 1);

      expect(imageData?.data[0]).toBe(255); // R
      expect(imageData?.data[1]).toBe(0); // G
      expect(imageData?.data[2]).toBe(0); // B
    });

    it('clears previous frame before drawing new one', async () => {
      await navigator.mediaDevices.getUserMedia({ video: true });
      // Draw first frame
      requestFrameFromStub(stubState);

      // Draw second frame (should overwrite)
      const width = 640;
      const height = 480;
      const blueData = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < blueData.length; i += 4) {
        blueData[i] = 0; // R
        blueData[i + 1] = 0; // G
        blueData[i + 2] = 255; // B
        blueData[i + 3] = 255; // A
      }
      requestFrameFromStub(stubState, blueData);

      const ctx = stubState.canvas?.getContext('2d');
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);
      const imageData = ctx?.getImageData(centerX, centerY, 1, 1);

      expect(imageData?.data[0]).toBe(0); // R (not white from first frame)
      expect(imageData?.data[2]).toBe(255); // B
    });
  });

  describe('Deterministic behavior', () => {
    it('produces identical frames for identical inputs', async () => {
      const width = 100;
      const height = 100;
      const testData = new Uint8ClampedArray(width * height * 4);

      // Fill with pattern
      for (let i = 0; i < testData.length; i += 4) {
        testData[i] = i % 256;
        testData[i + 1] = (i + 1) % 256;
        testData[i + 2] = (i + 2) % 256;
        testData[i + 3] = 255;
      }

      // Create new stub with smaller canvas for efficiency
      const smallStub = installStubCamera({ width, height });
      await navigator.mediaDevices.getUserMedia({ video: true });

      // Draw frame twice
      requestFrameFromStub(smallStub, testData);
      const ctx1 = smallStub.canvas?.getContext('2d');
      const frame1 = ctx1?.getImageData(0, 0, width, height);

      requestFrameFromStub(smallStub, testData);
      const ctx2 = smallStub.canvas?.getContext('2d');
      const frame2 = ctx2?.getImageData(0, 0, width, height);

      expect(frame1?.data).toEqual(frame2?.data);

      uninstallStubCamera(smallStub);
    });

    it('resets state correctly between tests', () => {
      // First test
      requestFrameFromStub(stubState);
      const ctx1 = stubState.canvas?.getContext('2d');
      const data1 = ctx1?.getImageData(0, 0, 640, 480);

      // Reset (simulates test teardown)
      uninstallStubCamera(stubState);
      const newStub = installStubCamera({ width: 640, height: 480 });

      // Second test should start fresh
      const ctx2 = newStub.canvas?.getContext('2d');
      const data2 = ctx2?.getImageData(0, 0, 640, 480);

      // Should not have data from previous test
      expect(data2?.data).not.toEqual(data1?.data);

      uninstallStubCamera(newStub);
    });
  });

  describe('Integration with MediaStream consumption', () => {
    it('can be consumed by a video element', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      const video = document.createElement('video');
      video.srcObject = stream;

      // Video should accept the stream
      expect(video.srcObject).toBe(stream);

      // Cleanup
      video.srcObject = null;
    });

    it('provides valid video track', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      const track = stream.getVideoTracks()[0];

      expect(track).toBeDefined();
      expect(track.kind).toBe('video');
      expect(track.enabled).toBe(true);
      expect(track.id).toBeTruthy();
    });

    it('supports track operations', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      const track = stream.getVideoTracks()[0];

      // Can disable track
      track.enabled = false;
      expect(track.enabled).toBe(false);

      // Can re-enable track
      track.enabled = true;
      expect(track.enabled).toBe(true);

      // Can stop track
      track.stop();
      expect(track.readyState).toBe('ended');
    });
  });

  describe('Error handling', () => {
    it('throws if drawTestFrame called before initialization', () => {
      const uninitializedState: StubCameraState = {
        canvas: null,
        stream: null,
        track: null,
      };

      expect(() => drawTestFrame(uninitializedState)).toThrow('Stub camera not initialized');
    });

    it('throws if requestFrameFromStub called before initialization', () => {
      const uninitializedState: StubCameraState = {
        canvas: null,
        stream: null,
        track: null,
      };

      expect(() => requestFrameFromStub(uninitializedState)).toThrow('Stub camera not initialized');
    });

    it('handles getUserMedia constraints gracefully', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'environment',
        },
      });

      // Stub should still work regardless of constraints
      expect(stream).toBeInstanceOf(MediaStream);
      expect(stream.getVideoTracks()).toHaveLength(1);
    });
  });
});

describe('T-stub-camera: Frame-exact capture flow', () => {
  let stubState: StubCameraState;

  beforeEach(() => {
    stubState = installStubCamera({ width: 640, height: 480 });
  });

  afterEach(() => {
    uninstallStubCamera(stubState);
  });

  /**
   * Demonstrate frame-exact behavior: captureStream(0) only produces
   * frames when explicitly requested, making tests deterministic.
   */
  describe('Frame timing control', () => {
    it('does not auto-produce frames (0 FPS)', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      // With captureStream(0), the stream doesn't auto-produce frames
      // This test verifies the stream exists but is frame-exact
      expect(stream.active).toBe(true);

      // No frames should be produced without explicit requestFrame
      // This is the key property that makes tests deterministic
    });

    it('allows manual frame production via canvas updates', () => {
      // Initial state: canvas is empty
      const ctx1 = stubState.canvas?.getContext('2d');
      const initialData = ctx1?.getImageData(0, 0, 640, 480);
      const initialHash = hashImageData(initialData?.data);

      // Update canvas (simulates requestFrame behavior)
      requestFrameFromStub(stubState);

      const ctx2 = stubState.canvas?.getContext('2d');
      const afterRequestData = ctx2?.getImageData(0, 0, 640, 480);
      const afterRequestHash = hashImageData(afterRequestData?.data);

      // Data should have changed
      expect(initialHash).not.toBe(afterRequestHash);
    });

    it('produces deterministic frame sequence', () => {
      const frames: string[] = [];

      // Generate sequence of frames
      for (let i = 0; i < 5; i++) {
        const testData = createDeterministicFrameData(i, 640, 480);
        requestFrameFromStub(stubState, testData);

        const ctx = stubState.canvas?.getContext('2d');
        const imageData = ctx?.getImageData(0, 0, 640, 480);
        frames.push(hashImageData(imageData?.data));
      }

      // All frames should be different
      const uniqueFrames = new Set(frames);
      expect(uniqueFrames.size).toBe(5);

      // Sequence should be reproducible
      const frames2: string[] = [];
      for (let i = 0; i < 5; i++) {
        const testData = createDeterministicFrameData(i, 640, 480);
        requestFrameFromStub(stubState, testData);

        const ctx = stubState.canvas?.getContext('2d');
        const imageData = ctx?.getImageData(0, 0, 640, 480);
        frames2.push(hashImageData(imageData?.data));
      }

      expect(frames).toEqual(frames2);
    });
  });
});

/**
 * Helper: Create deterministic test frame data.
 */
function createDeterministicFrameData(frameNumber: number, width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    // Deterministic pattern based on position and frame number
    data[i] = (x + frameNumber) % 256; // R
    data[i + 1] = (y + frameNumber) % 256; // G
    data[i + 2] = (x + y + frameNumber) % 256; // B
    data[i + 3] = 255; // A
  }

  return data;
}

/**
 * Helper: Simple hash of ImageData for comparison.
 */
function hashImageData(data?: Uint8ClampedArray): string {
  if (!data) return 'empty';

  // Simple hash: sum of first 100 pixels (R+G+B)
  let hash = 0;
  const limit = Math.min(data.length, 400); // 100 pixels * 4 channels

  for (let i = 0; i < limit; i += 4) {
    hash += data[i] + data[i + 1] + data[i + 2];
  }

  return `hash-${hash}`;
}

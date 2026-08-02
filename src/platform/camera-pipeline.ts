/**
 * Camera capture pipeline for QR decoding
 *
 * This module implements the receiver-side camera capture and decode pipeline
 * per plan.md §6.4:
 *
 * - getUserMedia with proper constraints (resolution, facingMode, frameRate)
 * - MediaStreamTrackProcessor (Chromium) or rVFC + drawImage fallback
 * - Worker pool for parallel QR decode (bf-1nc3)
 * - Drop-don't-queue backpressure
 * - Metrics tracking (fps, decode latency, packets/sec)
 *
 * Reference: plan.md §6.4, §13.1, §16.3
 */

import { createDecodePool, type QRDecodePool } from '../workers/qr-decode-pool.js';
import type { DecodedFrameResult, QRPosition } from '../modulation/types.js';
import { getConstraints, toMediaTrackConstraints, type CaptureResolution } from './capture-resolution.js';
import type { SubmitResult } from '../workers/qr-decode-pool.js';
import type { ROI } from '../workers/qr-decode.worker.js';

/**
 * Pipeline configuration
 */
export interface CameraPipelineConfig {
  /** Capture resolution (default: 1080p) */
  resolution?: CaptureResolution;

  /** Target frame rate (default: 30) */
  frameRate?: number;

  /** Decode pool config (worker count, max in-flight) */
  decodePool?: {
    workerCount?: number;
    maxInFlight?: number;
  };

  /** Display at ≤ half measured camera fps (D9) */
  targetDisplayFps?: number;
}

/**
 * Frame decode result with timing
 */
export interface FrameResult {
  frameIndex: number;
  result: DecodedFrameResult;
  decodeMs: number;
  error?: string;
}

/**
 * Pipeline statistics
 */
export interface PipelineStats {
  /** Frames captured per second */
  captureFps: number;

  /** Frames decoded per second */
  decodeFps: number;

  /** Packets decoded per second */
  packetsPerSec: number;

  /** Average decode latency (ms) */
  avgDecodeMs: number;

  /** p50 decode latency (ms) */
  p50DecodeMs: number;

  /** p99 decode latency (ms) */
  p99DecodeMs: number;

  /** Frames dropped due to backpressure */
  droppedFrames: number;

  /** Total frames captured */
  totalFrames: number;

  /** Total frames decoded */
  totalDecoded: number;

  /** Pool utilization (0-1) */
  poolUtilization: number;
}

/**
 * Result callback for decoded frames
 */
export type FrameResultCallback = (result: FrameResult) => void;

/**
 * Error callback for pipeline errors
 */
export type ErrorCallback = (error: Error) => void;

/**
 * Camera capture pipeline
 *
 * Manages the full camera-to-decode pipeline with worker pool parallelization
 * and ROI cropping with AP2's ratchet guard (plan.md §6.4).
 */
export class CameraPipeline {
  private config: Required<CameraPipelineConfig>;
  private stream: MediaStream | null = null;
  private trackProcessor:ReadableStream<VideoFrame> | null = null;
  private videoTrack: MediaStreamTrack | null = null;
  private decodePool: QRDecodePool | null = null;
  private running: boolean = false;
  private frameCount: number = 0;
  private droppedCount: number = 0;
  private decodedCount: number = 0;

  // Timing metrics
  private frameTimestamps: number[] = [];
  private decodeLatencies: number[] = [];
  private packetsPerFrame: number[] = [];
  private lastFpsUpdate: number = 0;
  private currentCaptureFps: number = 0;
  private currentDecodeFps: number = 0;
  private currentPacketsPerSec: number = 0;

  // ROI tracking with AP2's ratchet guard (plan.md §6.4)
  private currentROI: ROI | null = null;
  private roiMisses: number = 0;
  private cameraFrames: number = 0; // Total frames captured for ratchet guard
  private readonly ROI_MARGIN = 0.35; // 35% margin per spike/plan.md §6.4
  private readonly ROI_MAX_MISSES = 8; // Reset after 8 consecutive misses
  private readonly ROI_RESCAN_INTERVAL = 20; // Full-frame rescan every 20 frames

  // Callbacks
  private onFrameResult?: FrameResultCallback;
  private onError?: ErrorCallback;

  constructor(config: CameraPipelineConfig = {}) {
    this.config = {
      resolution: config.resolution || '1080p',
      frameRate: config.frameRate || 30,
      targetDisplayFps: config.targetDisplayFps || 15,
      decodePool: config.decodePool || {},
    };
  }

  /**
   * Start the camera pipeline.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Camera pipeline is already running');
    }

    try {
      // Get capture resolution constraints
      const resolution = getConstraints(this.config.resolution);
      if (!resolution) {
        throw new Error(`Invalid resolution: ${this.config.resolution}`);
      }

      // Convert to MediaTrackConstraints
      const trackConstraints = toMediaTrackConstraints(resolution);

      // Request camera access
      console.log('[Camera Pipeline] Requesting camera with constraints:', trackConstraints);
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: trackConstraints,
        audio: false,
      });

      this.videoTrack = this.stream.getVideoTracks()[0];
      if (!this.videoTrack) {
        throw new Error('No video track in media stream');
      }

      console.log('[Camera Pipeline] Camera acquired:', {
        settings: this.videoTrack.getSettings(),
        capabilities: this.videoTrack.getCapabilities(),
      });

      // Create decode pool
      this.decodePool = createDecodePool({
        workerCount: this.config.decodePool.workerCount,
        maxInFlight: this.config.decodePool.maxInFlight || 4, // I6b: cap at 4 in-flight frames
      });

      this.decodePool.setResultCallback(this.handleDecodeResult.bind(this));

      // Start capture loop
      await this.startCapture();

      this.running = true;
      this.lastFpsUpdate = performance.now();

      console.log('[Camera Pipeline] Started successfully');
    } catch (error) {
      console.error('[Camera Pipeline] Failed to start:', error);
      await this.stop();
      throw error;
    }
  }

  /**
   * Start the capture loop using appropriate API.
   */
  private async startCapture(): Promise<void> {
    if (!this.videoTrack) {
      throw new Error('Video track not available');
    }

    // Try MediaStreamTrackProcessor (Chromium) first
    if ('MediaStreamTrackProcessor' in window) {
      console.log('[Camera Pipeline] Using MediaStreamTrackProcessor (Chromium path)');
      await this.startProcessorCapture();
    } else {
      console.log('[Camera Pipeline] Using rVFC + drawImage fallback (universal path)');
      await this.startRVFCCapture();
    }
  }

  /**
   * Start capture using MediaStreamTrackProcessor (Chromium).
   */
  private async startProcessorCapture(): Promise<void> {
    if (!this.videoTrack) {
      throw new Error('Video track not available');
    }

    // @ts-ignore - MediaStreamTrackProcessor is not in all TypeScript definitions
    const processor = new MediaStreamTrackProcessor({ track: this.videoTrack });
    this.trackProcessor = processor.readable;

    const reader = this.trackProcessor.getReader();
    this.readProcessorFrames(reader);
  }

  /**
   * Read frames from MediaStreamTrackProcessor.
   */
  private async readProcessorFrames(reader: ReadableStreamDefaultReader<VideoFrame>): Promise<void> {
    try {
      while (this.running) {
        const { value: frame, done } = await reader.read();

        if (done || !frame) {
          console.log('[Camera Pipeline] Frame stream ended');
          break;
        }

        await this.processFrame(frame);
      }
    } catch (error) {
      if (this.running) {
        console.error('[Camera Pipeline] Error reading processor frame:', error);
        this.handleError(error as Error);
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Start capture using requestVideoFrameCallback fallback.
   */
  private async startRVFCCapture(): Promise<void> {
    if (!this.videoTrack) {
      throw new Error('Video track not available');
    }

    // Create a hidden video element to capture frames
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.srcObject = this.stream;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video element'));
    });

    video.play();

    // Use requestVideoFrameCallback to get frames
    const captureFrame = async (): Promise<void> => {
      if (!this.running || !this.videoTrack) {
        return;
      }

      try {
        // Wait for next frame
        await new Promise<void>((resolve) => {
          // @ts-ignore - requestVideoFrameCallback is not in all TypeScript definitions
          this.videoTrack!.requestVideoFrameCallback(async () => resolve());
        });

        // Draw to canvas and get ImageData
        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Failed to get 2D context');
        }

        ctx.drawImage(video, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        await this.processFrame(imageData);

        // Schedule next frame
        requestAnimationFrame(captureFrame);
      } catch (error) {
        if (this.running) {
          console.error('[Camera Pipeline] Error in rVFC capture:', error);
          this.handleError(error as Error);
        }
      }
    };

    // Start the capture loop
    captureFrame();
  }

  /**
   * Process a single frame through the decode pool.
   */
  private async processFrame(frame: VideoFrame | ImageData): Promise<void> {
    const frameIndex = this.frameCount++;
    const timestamp = performance.now();

    // AP2's ratchet guard: Force full-frame rescan every N frames
    // This prevents the one-way ratchet problem where ROI shrinks to
    // a few tiles and never recovers (plan.md §6.4)
    if (this.cameraFrames > 0 && (this.cameraFrames % this.ROI_RESCAN_INTERVAL) === this.ROI_RESCAN_INTERVAL - 1) {
      this.currentROI = null;
      console.debug('[Camera Pipeline] Ratchet guard: forcing full-frame rescan');
    }

    // Apply ROI crop if active
    let processedFrame = frame;
    if (this.currentROI) {
      processedFrame = this.cropFrame(frame, this.currentROI);
    }

    // Submit to decode pool with current ROI
    const submitResult: SubmitResult = this.decodePool!.submitFrame(processedFrame);

    // Track timing
    this.frameTimestamps.push(timestamp);
    this.cameraFrames++;

    if (!submitResult.accepted && submitResult.dropped) {
      this.droppedCount++;
      console.debug('[Camera Pipeline] Dropped frame:', submitResult);
    }

    // Update FPS periodically
    this.updateMetrics();
  }

  /**
   * Handle a decode result from the worker pool.
   */
  private handleDecodeResult(frameIndex: number, result: DecodedFrameResult, error?: string): void {
    const decodeMs = performance.now() - this.frameTimestamps[frameIndex];
    this.decodedCount++;
    this.decodeLatencies.push(decodeMs);
    this.packetsPerFrame.push(result.packets.length);

    // Update ROI based on decoded positions (AP2's ratchet guard)
    this.updateROI(result);

    // Invoke callback if set
    if (this.onFrameResult) {
      this.onFrameResult({
        frameIndex,
        result,
        decodeMs,
        error,
      });
    }
  }

  /**
   * Handle a pipeline error.
   */
  private handleError(error: Error): void {
    console.error('[Camera Pipeline] Error:', error);
    if (this.onError) {
      this.onError(error);
    }
  }

  /**
   * Update performance metrics (called periodically).
   */
  private updateMetrics(): void {
    const now = performance.now();
    const elapsed = now - this.lastFpsUpdate;

    if (elapsed < 1000) {
      return; // Update every second
    }

    // Calculate capture FPS
    this.currentCaptureFps = (this.frameCount - this.droppedCount) / (elapsed / 1000);

    // Calculate decode FPS
    this.currentDecodeFps = this.decodedCount / (elapsed / 1000);

    // Calculate packets per second
    const totalPackets = this.packetsPerFrame.reduce((sum, count) => sum + count, 0);
    this.currentPacketsPerSec = totalPackets / (elapsed / 1000);

    // Reset counters
    this.lastFpsUpdate = now;
    this.frameCount = 0;
    this.droppedCount = 0;
    this.decodedCount = 0;
    this.packetsPerFrame = [];
  }

  /**
   * Get current pipeline statistics.
   */
  getStats(): PipelineStats {
    // Calculate latency percentiles
    const sortedLatencies = [...this.decodeLatencies].sort((a, b) => a - b);
    const p50Index = Math.floor(sortedLatencies.length * 0.5);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    const avgLatency = sortedLatencies.length > 0
      ? sortedLatencies.reduce((sum, lat) => sum + lat, 0) / sortedLatencies.length
      : 0;

    return {
      captureFps: this.currentCaptureFps,
      decodeFps: this.currentDecodeFps,
      packetsPerSec: this.currentPacketsPerSec,
      avgDecodeMs: avgLatency,
      p50DecodeMs: sortedLatencies[p50Index] || 0,
      p99DecodeMs: sortedLatencies[p99Index] || 0,
      droppedFrames: this.droppedCount,
      totalFrames: this.frameCount,
      totalDecoded: this.decodedCount,
      poolUtilization: this.decodePool ? this.decodePool.getStats().utilization : 0,
    };
  }

  /**
   * Set the frame result callback.
   */
  setFrameResultCallback(callback: FrameResultCallback): void {
    this.onFrameResult = callback;
  }

  /**
   * Set the error callback.
   */
  setErrorCallback(callback: ErrorCallback): void {
    this.onError = callback;
  }

  /**
   * Update ROI based on decoded QR positions (AP2's ratchet guard).
   *
   * Implements the tight quad ROI with wide margin (35%) and periodic
   * full-frame rescan to prevent one-way ratchet problem (plan.md §6.4).
   *
   * Logic from spike/rig.js lines 237-263:
   * - Extract bounding box of all detected QR codes
   * - Add 35% margin for drift
   * - Reset ROI after 8 consecutive misses
   * - Periodic full-frame rescan (handled in processFrame)
   */
  private updateROI(result: DecodedFrameResult): void {
    const decodedTiles = result.diagnostics.filter(d => d.decoded && d.position);

    if (decodedTiles.length > 0) {
      // Extract bounding box from all detected positions
      let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;

      for (const tile of decodedTiles) {
        if (!tile.position) continue;
        for (const pt of tile.position) {
          xMin = Math.min(xMin, pt.x);
          yMin = Math.min(yMin, pt.y);
          xMax = Math.max(xMax, pt.x);
          yMax = Math.max(yMax, pt.y);
        }
      }

      if (isFinite(xMin) && isFinite(yMin) && isFinite(xMax) && isFinite(yMax)) {
        // Apply ROI offset if currently cropped
        const offsetX = this.currentROI?.x || 0;
        const offsetY = this.currentROI?.y || 0;

        // Calculate dimensions with margin
        const width = xMax - xMin;
        const height = yMax - yMin;
        const margin = this.ROI_MARGIN * Math.max(width, height);

        // Constrain to frame bounds
        // Get actual capture dimensions from the video track settings
        const trackSettings = this.videoTrack?.getSettings();
        const maxWidth = trackSettings?.width ? trackSettings.width : 1920;
        const maxHeight = trackSettings?.height ? trackSettings.height : 1080;

        this.currentROI = {
          x: Math.max(0, Math.round(offsetX + xMin - margin)),
          y: Math.max(0, Math.round(offsetY + yMin - margin)),
          w: Math.min(maxWidth, Math.round(width + 2 * margin)),
          h: Math.min(maxHeight, Math.round(height + 2 * margin)),
        };

        this.roiMisses = 0; // Reset miss counter
        console.debug('[Camera Pipeline] ROI updated:', this.currentROI);
      }
    } else if (this.currentROI) {
      // No QR codes detected - increment miss counter
      this.roiMisses++;
      if (this.roiMisses > this.ROI_MAX_MISSES) {
        // Lost lock - go wide again
        this.currentROI = null;
        this.roiMisses = 0;
        console.debug('[Camera Pipeline] ROI lost lock - going wide');
      }
    }
  }

  /**
   * Crop a frame to the specified ROI.
   */
  private cropFrame(frame: VideoFrame | ImageData, roi: ROI): VideoFrame | ImageData {
    // For VideoFrame, we need to draw to a canvas and extract the ROI
    if ('format' in frame && 'close' in frame) {
      // It's a VideoFrame - convert to ImageData with crop
      return this.cropVideoFrame(frame as VideoFrame, roi);
    } else {
      // It's already ImageData - crop directly
      return this.cropImageData(frame as ImageData, roi);
    }
  }

  /**
   * Crop a VideoFrame to the specified ROI.
   */
  private cropVideoFrame(frame: VideoFrame, roi: ROI): ImageData {
    const canvas = new OffscreenCanvas(frame.width, frame.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D context for ROI crop');
    }

    // Draw the full frame
    ctx.drawImage(frame, 0, 0);

    // Extract the ROI region
    const imageData = ctx.getImageData(roi.x, roi.y, roi.w, roi.h);

    // Close the original frame
    frame.close();

    return imageData;
  }

  /**
   * Crop ImageData to the specified ROI.
   */
  private cropImageData(imageData: ImageData, roi: ROI): ImageData {
    const { width, height, data } = imageData;

    // Validate ROI bounds
    if (roi.x < 0 || roi.y < 0 || roi.x + roi.w > width || roi.y + roi.h > height) {
      console.warn('[Camera Pipeline] ROI out of bounds, using full frame:', roi);
      return imageData;
    }

    // Create new ImageData for the cropped region
    const cropped = new ImageData(roi.w, roi.h);
    const srcData = data;
    const dstData = cropped.data;

    for (let y = 0; y < roi.h; y++) {
      const srcY = roi.y + y;
      const srcOffset = srcY * width * 4 + roi.x * 4;
      const dstOffset = y * roi.w * 4;

      // Copy one row of pixels
      dstData.set(srcData.subarray(srcOffset, srcOffset + roi.w * 4), dstOffset);
    }

    return cropped;
  }

  /**
   * Stop the camera pipeline.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log('[Camera Pipeline] Stopping...');

    this.running = false;

    // Stop video track
    if (this.videoTrack) {
      this.videoTrack.stop();
      this.videoTrack = null;
    }

    // Close stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    // Shutdown decode pool
    if (this.decodePool) {
      this.decodePool.shutdown();
      this.decodePool = null;
    }

    // Close frame processor
    if (this.trackProcessor) {
      await this.trackProcessor.cancel();
      this.trackProcessor = null;
    }

    // Reset state
    this.frameCount = 0;
    this.droppedCount = 0;
    this.decodedCount = 0;
    this.frameTimestamps = [];
    this.decodeLatencies = [];
    this.packetsPerFrame = [];

    console.log('[Camera Pipeline] Stopped');
  }
}

/**
 * Create a camera pipeline with default configuration.
 */
export function createCameraPipeline(config?: CameraPipelineConfig): CameraPipeline {
  return new CameraPipeline(config);
}

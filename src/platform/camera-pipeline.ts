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
import type { DecodedFrameResult } from '../modulation/types.js';
import { getConstraints, toMediaTrackConstraints, type CaptureResolution } from './capture-resolution.js';
import type { SubmitResult } from '../workers/qr-decode-pool.js';

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
 * Manages the full camera-to-decode pipeline with worker pool parallelization.
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

    // Submit to decode pool
    const submitResult: SubmitResult = this.decodePool!.submitFrame(frame);

    // Track timing
    this.frameTimestamps.push(timestamp);

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

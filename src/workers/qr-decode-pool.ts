/**
 * QR decode worker pool manager
 *
 * This module manages a pool of QR decode workers to parallelize camera frame
 * processing per plan.md §6.2 and task bf-1nc3:
 *
 * Design requirements (plan.md §6.2):
 * - N workers process frames in parallel
 * - VideoFrame MUST be close()d or the pipeline stalls
 * - Drop-don't-queue backpressure: if decode falls behind, drop frames
 * - I6b: Cap in-flight frames at 4 (one 1080p RGBA frame is 7.9 MiB)
 *
 * Performance context (§13.1, bf-1nc3):
 * - Single-threaded main-thread decode: 67-69ms p50
 * - This gated camera fps at 4.5-6.3 fps
 * - Budget: <= 60ms p99
 * - Solution: Worker pool to parallelize and meet budget
 */

import type { DecodedFrameResult } from '../modulation/types.js';
import type { DecodeResponse } from './qr-decode.worker.js';

/**
 * Worker instance wrapper
 */
interface WorkerInstance {
  worker: Worker;
  busy: boolean;
}

/**
 * Frame submission result
 */
export interface SubmitResult {
  accepted: boolean;
  frameIndex: number;
  dropped: boolean;
  reason?: string;
}

/**
 * Worker pool configuration
 */
export interface DecodePoolConfig {
  /** Number of workers to spawn (default: hardwareConcurrency or 4) */
  workerCount?: number;

  /** Maximum in-flight frames (default: 4 per I6b) */
  maxInFlight?: number;

  /** Worker script URL (default: auto-detected) */
  workerScript?: string;
}

/**
 * Decode result callback
 */
export type DecodeResultCallback = (
  frameIndex: number,
  result: DecodedFrameResult,
  error?: string
) => void;

/**
 * QR decode worker pool
 *
 * Manages a pool of workers processing camera frames in parallel with
 * backpressure and memory limits.
 */
export class QRDecodePool {
  private workers: WorkerInstance[] = [];
  private maxInFlight: number;
  private inFlightCount: number = 0;
  private nextFrameIndex: number = 0;
  private resultCallback?: DecodeResultCallback;
  private workerScriptURL: string;

  constructor(config: DecodePoolConfig = {}) {
    // Determine worker count
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;
    const workerCount = config.workerCount || Math.max(2, hardwareConcurrency);

    // Cap in-flight frames at 4 per I6b (7.9 MiB per frame × 4 = 31.6 MiB)
    this.maxInFlight = config.maxInFlight || 4;

    // Resolve worker script URL
    this.workerScriptURL = config.workerScript || this.resolveWorkerURL();

    // Initialize workers
    for (let i = 0; i < workerCount; i++) {
      try {
        const worker = new Worker(this.workerScriptURL, { type: 'module' });
        worker.onmessage = this.handleWorkerMessage.bind(this, i);
        worker.onerror = this.handleWorkerError.bind(this, i);

        this.workers.push({
          worker,
          busy: false,
        });

        console.log(`[QR Decode Pool] Worker ${i} initialized`);
      } catch (error) {
        console.error(`[QR Decode Pool] Failed to create worker ${i}:`, error);
        throw error;
      }
    }

    console.log(
      `[QR Decode Pool] Initialized with ${workerCount} workers, max ${this.maxInFlight} in-flight frames`
    );
  }

  /**
   * Resolve the worker script URL relative to the current module.
   */
  private resolveWorkerURL(): string {
    // Get the URL of the current module (qr-decode-pool.ts)
    const currentURL = new URL(import.meta.url);

    // Construct path to worker (qr-decode.worker.ts)
    const workerURL = new URL('./qr-decode.worker.js', currentURL);
    return workerURL.href;
  }

  /**
   * Set the result callback for decoded frames.
   *
   * The callback is invoked on the main thread when a worker completes decoding.
   */
  setResultCallback(callback: DecodeResultCallback): void {
    this.resultCallback = callback;
  }

  /**
   * Submit a frame for decoding.
   *
   * Implements drop-don't-queue backpressure: if we're at capacity, the frame
   * is dropped rather than queued. Dropped frames are erasures, which the fountain
   * code already handles.
   *
   * @param frame - VideoFrame or ImageData to decode
   * @returns Submission result indicating if frame was accepted or dropped
   */
  submitFrame(frame: VideoFrame | ImageData): SubmitResult {
    const frameIndex = this.nextFrameIndex++;

    // Check backpressure: drop if at capacity
    if (this.inFlightCount >= this.maxInFlight) {
      console.warn(
        `[QR Decode Pool] At capacity (${this.inFlightCount}/${this.maxInFlight}), dropping frame ${frameIndex}`
      );

      // Close the frame if it's a VideoFrame
      if ('close' in frame) {
        try {
          (frame as VideoFrame).close();
        } catch (error) {
          console.warn('[QR Decode Pool] Failed to close dropped VideoFrame:', error);
        }
      }

      return {
        accepted: false,
        frameIndex,
        dropped: true,
        reason: 'At capacity',
      };
    }

    // Find an available worker
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) {
      // This shouldn't happen if inFlightCount is accurate, but handle it gracefully
      console.error('[QR Decode Pool] No available workers despite in-flight count check');
      return {
        accepted: false,
        frameIndex,
        dropped: true,
        reason: 'No available workers',
      };
    }

    // Mark worker as busy and increment in-flight count
    availableWorker.busy = true;
    this.inFlightCount++;

    // Send frame to worker
    try {
      availableWorker.worker.postMessage({
        type: 'decode',
        frameIndex,
        frame,
      });

      return {
        accepted: true,
        frameIndex,
        dropped: false,
      };
    } catch (error) {
      console.error('[QR Decode Pool] Failed to send frame to worker:', error);

      // Rollback state on error
      availableWorker.busy = false;
      this.inFlightCount--;

      // Close the frame if it's a VideoFrame
      if ('close' in frame) {
        try {
          (frame as VideoFrame).close();
        } catch (closeError) {
          console.warn('[QR Decode Pool] Failed to close VideoFrame after error:', closeError);
        }
      }

      return {
        accepted: false,
        frameIndex,
        dropped: true,
        reason: 'Worker communication failed',
      };
    }
  }

  /**
   * Handle a message from a worker.
   */
  private handleWorkerMessage(workerIndex: number, event: MessageEvent<DecodeResponse>): void {
    const worker = this.workers[workerIndex];
    const response = event.data;

    if (response.type === 'result') {
      // Mark worker as available
      worker.busy = false;
      this.inFlightCount--;

      // Invoke callback if set
      if (this.resultCallback) {
        this.resultCallback(response.frameIndex, response.result, response.error);
      }
    } else {
      console.warn('[QR Decode Pool] Unknown response type from worker:', response);
    }
  }

  /**
   * Handle a worker error.
   */
  private handleWorkerError(workerIndex: number, event: ErrorEvent): void {
    const worker = this.workers[workerIndex];
    console.error(`[QR Decode Pool] Worker ${workerIndex} error:`, event.message, event);

    // Mark worker as available on error
    worker.busy = false;
    this.inFlightCount--;
  }

  /**
   * Get pool statistics.
   */
  getStats(): {
    workerCount: number;
    inFlightCount: number;
    maxInFlight: number;
    utilization: number;
  } {
    const busyWorkers = this.workers.filter(w => w.busy).length;
    return {
      workerCount: this.workers.length,
      inFlightCount: this.inFlightCount,
      maxInFlight: this.maxInFlight,
      utilization: this.inFlightCount / this.maxInFlight,
    };
  }

  /**
   * Shutdown the pool and terminate all workers.
   */
  shutdown(): void {
    console.log('[QR Decode Pool] Shutting down...');

    for (let i = 0; i < this.workers.length; i++) {
      try {
        this.workers[i].worker.terminate();
        console.log(`[QR Decode Pool] Worker ${i} terminated`);
      } catch (error) {
        console.error(`[QR Decode Pool] Failed to terminate worker ${i}:`, error);
      }
    }

    this.workers = [];
    this.inFlightCount = 0;
    this.nextFrameIndex = 0;
    this.resultCallback = undefined;

    console.log('[QR Decode Pool] Shutdown complete');
  }
}

/**
 * Create a QR decode pool with default configuration.
 *
 * This is the primary factory function for most use cases.
 */
export function createDecodePool(config?: DecodePoolConfig): QRDecodePool {
  return new QRDecodePool(config);
}

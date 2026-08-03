/**
 * QR encoder worker manager with D4's pinned mask pattern.
 *
 * Manages a pool of QR encoding workers with pinned mask pattern for 4.6-8× speedup.
 * Provides a high-level API for the modulation layer to encode packets to ImageData.
 */

/** QR encoding request */
export interface QREncodeRequest {
  packets: Uint8Array[];
  version: number;
  modulePx: number;
}

/** QR encoding result */
export interface QREncodeResult {
  tiles: ImageData[];
}

/**
 * QR encoder worker manager.
 *
 * Manages a pool of workers for parallel QR encoding with pinned mask pattern.
 */
export class QREncoderWorkerManager {
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;

  /**
   * Create a QR encoder worker manager.
   *
   * @param poolSize - Number of workers to create (default: navigator.hardwareConcurrency || 4)
   */
  constructor(poolSize: number = navigator.hardwareConcurrency || 4) {
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(
        new URL('../../workers/qr-encode.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.workers.push(worker);
    }
  }

  /**
   * Encode packets to QR tiles using worker pool.
   *
   * @param request - QR encoding request
   * @returns Promise resolving to encoded tiles
   */
  async encode(request: QREncodeRequest): Promise<QREncodeResult> {
    const worker = this.getNextWorker();

    return new Promise((resolve, reject) => {
      const handleMessage = (e: MessageEvent): void => {
        if (e.data.type === 'encoded') {
          worker.removeEventListener('message', handleMessage);
          resolve({ tiles: e.data.tiles });
        } else if (e.data.type === 'error') {
          worker.removeEventListener('message', handleMessage);
          reject(new Error(e.data.error));
        }
      };

      worker.addEventListener('message', handleMessage);

      worker.postMessage({
        type: 'encode',
        packets: request.packets,
        version: request.version,
        modulePx: request.modulePx,
      });
    });
  }

  /**
   * Get next worker in round-robin fashion.
   */
  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    if (!worker) {
      throw new Error('No workers available');
    }
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  /**
   * Terminate all workers.
   */
  destroy(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
  }
}

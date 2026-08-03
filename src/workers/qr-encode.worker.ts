/**
 * QR encoding worker with D4's pinned mask pattern.
 *
 * Per plan.md §6.3.1: "Implementation: worker generator → ring buffer (depth 3) →
 * main thread paints via rAF. Deeper buffering is wasted memory (I7)."
 *
 * This worker performs QR encoding with pinned mask pattern for 4.6-8× speedup.
 * It receives packets and renders them to ImageData for canvas display.
 */

import { encodeQRMatrix, getQRModuleSize } from '../modulation/qr-tiled/qr-encoder.js';

/** Worker message types */
interface EncodeRequest {
  type: 'encode';
  packets: Uint8Array[];
  version: number;
  modulePx: number;
}

interface EncodeResponse {
  type: 'encoded';
  tiles: ImageData[];
}

/** Render QR matrix to ImageData at specified module pixel size */
function renderQRToImageData(matrix: any, modulePx: number): ImageData {
  const size = matrix.modules.size;
  const data = matrix.modules.data;

  const width = size * modulePx;
  const height = size * modulePx;
  const imageData = new ImageData(width, height);

  // Each module becomes modulePx × modulePx pixels
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isDark = data[y * size + x];
      const color = isDark ? 0 : 255; // Black or white (dark-on-light per D12)

      // Fill the module's pixels
      for (let py = 0; py < modulePx; py++) {
        for (let px = 0; px < modulePx; px++) {
          const imgIdx = ((y * modulePx + py) * width + (x * modulePx + px)) * 4;
          imageData.data[imgIdx] = color;     // R
          imageData.data[imgIdx + 1] = color; // G
          imageData.data[imgIdx + 2] = color; // B
          imageData.data[imgIdx + 3] = 255;   // A
        }
      }
    }
  }

  return imageData;
}

/** Handle incoming messages from main thread */
self.onmessage = (e: MessageEvent): void => {
  const request: EncodeRequest = e.data;

  if (request.type === 'encode') {
    try {
      const tiles: ImageData[] = [];

      for (const packet of request.packets) {
        // Encode QR with pinned mask pattern (D4)
        const matrix = encodeQRMatrix(packet, {
          version: request.version,
          errorCorrectionLevel: 'L',
          maskPattern: 0, // D4: pinned mask for 4.6-8× speedup
        });

        // Render to ImageData
        const imageData = renderQRToImageData(matrix, request.modulePx);
        tiles.push(imageData);
      }

      // Send encoded tiles back to main thread
      const response: EncodeResponse = { type: 'encoded', tiles };
      self.postMessage(response);
    } catch (error) {
      // Propagate encoding errors back to main thread
      self.postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

export {};

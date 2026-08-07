/**
 * QR decode worker for processing camera frames in parallel
 *
 * This worker implements the receiver-side QR decode pipeline per plan.md §6.2:
 * - Runs in a pool of N workers to avoid blocking the main thread
 * - Receives VideoFrames or ImageData from the camera pipeline
 * - Uses zxing-wasm to decode QR symbols
 * - Returns decoded packets and diagnostics
 * - MUST close VideoFrames to prevent pipeline stalls
 *
 * Performance context (plan.md §13.1, task bf-1nc3):
 * - Measured decode p50: 67-69ms on full 1080p frame (single-threaded main thread)
 * - This gated camera fps at 4.5-6.3 fps
 * - Budget: <= 60ms p99, so p50 already exceeds p99 budget
 * - Solution: Worker pool to parallelize decoding
 *
 * Memory constraint (plan.md I6b):
 * - Cap in-flight frames at 4
 * - One 1080p RGBA frame is 7.9 MiB
 * - 4 frames × 7.9 MiB = 31.6 MiB (within 64 MiB whole-receiver peak)
 */

import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { configureLocalZXingWASM } from '../modulation/qr-tiled/zxing-config.js';
import type { DecodedFrameResult, TileDiagnostics, QRPosition } from '../modulation/types.js';

/**
 * Region of Interest for frame cropping (plan.md §6.4).
 *
 * Used to crop camera frames to the bounding box of detected QR codes,
 * reducing decode time by 8.6× when the code occupies part of the frame.
 * Includes AP2's ratchet guard to prevent one-way ratchet problem.
 */
export interface ROI {
  /** X coordinate of top-left corner (frame pixels) */
  x: number;
  /** Y coordinate of top-left corner (frame pixels) */
  y: number;
  /** Width of ROI region (frame pixels) */
  w: number;
  /** Height of ROI region (frame pixels) */
  h: number;
}

/**
 * Configure zxing-wasm to use local WASM files.
 *
 * This MUST be called before any zxing-wasm functions are used. Workers run in
 * a separate global context from the main thread, so the main thread's initZXing()
 * call doesn't affect them. Each worker must configure zxing locally.
 *
 * Per plan.md §6.5, T5, T7, A8: Using local WASM prevents:
 * - Third-party network requests mid-session (T7 - no exfiltration)
 * - Failures in airplane mode (A8 - air-gapped case)
 * - Remote WASM execution (T5 - surface reduction)
 */
configureLocalZXingWASM();

/**
 * Worker message types
 */
interface DecodeRequest {
  type: 'decode';
  frameIndex: number;
  frame: VideoFrame | ImageData;
  expectedTileCount?: number;
}

export interface DecodeResponse {
  type: 'result';
  frameIndex: number;
  result: DecodedFrameResult;
  error?: string;
}

/**
 * Extract QR module size and camera pixels per module for diagnostics.
 *
 * This is used for E-TOO-FAR detection (camera px/module < 4) per plan.md §11.
 */
function estimateCameraPxPerModule(
  decodedBarcode: Awaited<ReturnType<typeof readBarcodesFromImageData>>[0],
  frameWidth: number,
  frameHeight: number
): number | undefined {
  if (!decodedBarcode || !decodedBarcode.position) {
    return undefined;
  }

  // Extract corner points from position object
  const position = decodedBarcode.position;
  if (typeof position !== 'object' || position === null) {
    return undefined;
  }

  // Position is an object with corner keys like topLeft, topRight, etc.
  const pos = position as unknown as Record<string, { x: number; y: number } | undefined>;

  // Extract valid corner points
  const corners: { x: number; y: number }[] = [];
  const cornerKeys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

  for (const key of cornerKeys) {
    const corner = pos[key];
    if (corner && typeof corner.x === 'number' && typeof corner.y === 'number') {
      corners.push(corner);
    }
  }

  // Need at least 2 corners to calculate dimensions
  if (corners.length < 2) {
    return undefined;
  }

  // Calculate bounding box from corner points
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  // Estimate version from content length if available
  // For now, use a conservative estimate
  const minDimension = Math.min(width, height);

  // QR versions range from 21 (v1) to 177 (v40) modules
  // Assume a mid-range version (v15 = 77 modules) as default
  const estimatedModules = 77;

  return minDimension / estimatedModules;
}

/**
 * Calculate sharpness metric for E-BLUR detection.
 *
 * Uses Laplacian variance as a simple sharpness metric.
 * Higher values = sharper edges; lower values = blurrier image.
 */
function calculateSharpness(imageData: ImageData): number | undefined {
  try {
    const { width, height, data } = imageData;
    if (width < 3 || height < 3) {
      return undefined;
    }

    // Compute Laplacian using simple kernel
    // [[0, -1, 0], [-1, 4, -1], [0, -1, 0]]
    let sum = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        const center = data[i]!;
        const top = data[i - width * 4]!;
        const bottom = data[i + width * 4]!;
        const left = data[i - 4]!;
        const right = data[i + 4]!;

        const laplacian = 4 * center - top - bottom - left - right;
        sum += laplacian * laplacian;
        count++;
      }
    }

    return count > 0 ? sum / count : undefined;
  } catch (error) {
    console.warn('[QR Decode Worker] Failed to calculate sharpness:', error);
    return undefined;
  }
}

/**
 * Check for torn frame damage (rolling shutter mismatch).
 *
 * Detects inconsistencies in brightness that might indicate the frame
 * was captured while the display was still updating.
 */
function detectTornFrame(imageData: ImageData): boolean {
  try {
    const { width, height, data } = imageData;

    // Sample brightness across horizontal bands
    const bands = 5;
    const bandHeight = Math.floor(height / bands);
    const brightnesses: number[] = [];

    for (let b = 0; b < bands; b++) {
      let sum = 0;
      let count = 0;
      const startY = b * bandHeight;
      const endY = Math.min(startY + bandHeight, height);

      for (let y = startY; y < endY; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          sum += data[i]!; // Red channel
          sum += data[i + 1]!; // Green channel
          sum += data[i + 2]!; // Blue channel
          count += 3;
        }
      }

      brightnesses.push(count > 0 ? sum / count : 0);
    }

    // Check for significant variation (>30% difference between bands)
    const max = Math.max(...brightnesses);
    const min = Math.min(...brightnesses);
    const variation = max > 0 ? (max - min) / max : 0;

    return variation > 0.3;
  } catch (error) {
    console.warn('[QR Decode Worker] Failed to detect torn frame:', error);
    return false;
  }
}

/**
 * Convert VideoFrame to ImageData for zxing-wasm.
 *
 * zxing-wasm requires ImageData, but VideoFrame is more efficient.
 * This conversion is necessary but adds overhead.
 */
async function videoFrameToImageData(frame: VideoFrame): Promise<ImageData> {
  // Create an ImageBitmap from the VideoFrame
  const bitmap = await createImageBitmap(frame);

  // Draw to a canvas to get ImageData
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context from OffscreenCanvas');
  }

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Close the bitmap to free memory
  bitmap.close();

  return imageData;
}

/**
 * Process a frame and decode QR codes.
 *
 * This is the main worker entry point. It:
 * 1. Converts VideoFrame to ImageData if needed
 * 2. Calls zxing-wasm to decode QR symbols
 * 3. Extracts packets and position data from decoded results
 * 4. Computes diagnostics for quality assessment
 * 5. Closes the VideoFrame to prevent pipeline stalls
 */
async function processFrame(request: DecodeRequest): Promise<DecodeResponse> {
  const { frameIndex, frame, expectedTileCount = 15 } = request;
  let imageData: ImageData;
  let shouldCloseFrame = false;

  try {
    // Convert VideoFrame to ImageData if necessary
    if ('format' in frame && 'close' in frame) {
      // It's a VideoFrame
      imageData = await videoFrameToImageData(frame);
      shouldCloseFrame = true;
    } else {
      // It's already ImageData
      imageData = frame as ImageData;
    }

    // Calculate frame-wide diagnostics
    const sharpness = calculateSharpness(imageData);
    const isTorn = detectTornFrame(imageData);

    // Call zxing-wasm to decode QR codes
    const barcodes = await readBarcodesFromImageData(imageData, {
      formats: [
        'QRCode',
        'MicroQRCode',
        'rMQRCode',
      ],
    });

    // Process decoded barcodes into packets and diagnostics
    const packets: Uint8Array[] = [];
    const diagnosticsMap = new Map<number, TileDiagnostics>();

    for (const barcode of barcodes) {
      if (!barcode.bytes || barcode.bytes.length === 0) {
        continue;
      }

      // Estimate which tile this barcode corresponds to
      // This is approximate - a real implementation would use position data
      const tileIndex = diagnosticsMap.size;

      // Extract raw bytes as packet
      const packet = new Uint8Array(barcode.bytes);
      packets.push(packet);

      // Extract position data from barcode
      const position = extractPosition(barcode);

      // Calculate diagnostics for this tile
      const cameraPxPerModule = estimateCameraPxPerModule(
        barcode,
        imageData.width,
        imageData.height
      );

      // Create diagnostic entry, only including properties that are defined
      const diagnostic: TileDiagnostics = {
        tileIndex,
        decoded: true,
        isTorn,
        ...(position !== undefined && { position }),
        ...(cameraPxPerModule !== undefined && { cameraPxPerModule }),
        ...(sharpness !== undefined && { sharpness }),
      };

      diagnosticsMap.set(tileIndex, diagnostic);
    }

    // Create diagnostic entries for undecoded tiles
    // (Expected tiles that weren't found in the frame)
    for (let i = 0; i < expectedTileCount; i++) {
      if (!diagnosticsMap.has(i)) {
        // Create diagnostic entry for undecoded tile
        const diagnostic: TileDiagnostics = {
          tileIndex: i,
          decoded: false,
          isTorn,
          ...(sharpness !== undefined && { sharpness }),
        };

        diagnosticsMap.set(i, diagnostic);
      }
    }

    // Convert diagnostics map to array
    const diagnostics = Array.from(diagnosticsMap.values()).sort(
      (a, b) => a.tileIndex - b.tileIndex
    );

    return {
      type: 'result',
      frameIndex,
      result: {
        packets,
        diagnostics,
      },
    };
  } catch (error) {
    console.error('[QR Decode Worker] Failed to decode frame:', error);
    return {
      type: 'result',
      frameIndex,
      result: {
        packets: [],
        diagnostics: [],
      },
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // CRITICAL: Close the VideoFrame to prevent pipeline stalls
    if (shouldCloseFrame && 'close' in frame) {
      try {
        (frame as VideoFrame).close();
      } catch (error) {
        console.warn('[QR Decode Worker] Failed to close VideoFrame:', error);
      }
    }
  }
}

/**
 * Extract position data from a decoded barcode.
 *
 * zxing-wasm returns position as an object with top-left, top-right, etc.
 * We convert this to our QRPosition format.
 */
function extractPosition(
  barcode: Awaited<ReturnType<typeof readBarcodesFromImageData>>[0]
): readonly QRPosition[] | undefined {
  if (!barcode.position || typeof barcode.position !== 'object') {
    return undefined;
  }

  const pos = barcode.position as unknown as Record<string, { x: number; y: number }>;

  // Extract corner points if available
  const corners: QRPosition[] = [];
  if (pos.topLeft && typeof pos.topLeft.x === 'number') {
    corners.push({ x: pos.topLeft.x, y: pos.topLeft.y });
  }
  if (pos.topRight && typeof pos.topRight.x === 'number') {
    corners.push({ x: pos.topRight.x, y: pos.topRight.y });
  }
  if (pos.bottomRight && typeof pos.bottomRight.x === 'number') {
    corners.push({ x: pos.bottomRight.x, y: pos.bottomRight.y });
  }
  if (pos.bottomLeft && typeof pos.bottomLeft.x === 'number') {
    corners.push({ x: pos.bottomLeft.x, y: pos.bottomLeft.y });
  }

  return corners.length >= 4 ? corners : undefined;
}

/**
 * Worker message handler.
 *
 * Receives decode requests and posts back results.
 */
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;

  if (request.type === 'decode') {
    const response = await processFrame(request);
    self.postMessage(response);
  } else {
    console.warn('[QR Decode Worker] Unknown message type:', request);
  }
};

export {};
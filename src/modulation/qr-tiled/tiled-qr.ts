/**
 * Tiled QR modulation (Stage 1) - main modulation implementation.
 *
 * Per plan.md §6.1, this implements the Modulation interface for tiled
 * monochrome QR codes (Stage 1). This is the primary modulation for Phase 3.
 *
 * Stage 1 specifications:
 * - Tiled QR (D1): ~15 tiles per frame vs single QR
 * - 2.5× payload: ~7.5 KB/frame vs ~3 KB for single QR
 * - Fixed-weight ladder (D18a): R1=15%, R2=60%, R3=25%
 * - Portrait code region (540×960) by default
 *
 * Throughput target (Phase 3 exit criteria A1): ≥20 KB/s sustained
 */

import { PACKET, L } from '../../core/params';
import { calculateTileLayout, type CodeRegion, type TileLayout } from './layout';
import {
  calculateFrameComposition,
  createFrameMixer,
  type LadderConfig,
  DEFAULT_LADDER,
} from './ladder';
import { encodeQRMatrix } from './qr-encoder';
import type { Modulation, Profile, DecodedFrameResult, TileDiagnostics, QRPosition } from '../types';
import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { configureLocalZXingWASM } from './zxing-config.js';

/**
 * Tiled QR modulation configuration.
 */
export interface TiledQRConfig {
  /** Number of tiles per frame (default: 15 for R2 nominal) */
  tilesPerFrame?: number;
  /** Ladder configuration (default: D18a fixed weights) */
  ladder?: LadderConfig;
  /** Code region dimensions (default: portrait 540×960) */
  codeRegion?: CodeRegion;
  /** Target QR version for layout calculation (default: 15) */
  version?: number;
}

/**
 * Tiled QR modulation instance.
 *
 * Implements the Modulation interface from plan.md §6.1 and types.ts.
 */
export class TiledQRModulation implements Modulation {
  /** Fragment length L - constant for wire version 1 */
  readonly fragmentLen = L;

  /** Profile mix per D16: R1=15%, R2=60%, R3=25% */
  readonly profileMix: readonly Profile[];

  /** Total packets per frame (sum over all profiles) */
  readonly totalPacketsPerFrame: number;

  /** Tile layout specification */
  private layout: TileLayout;

  /** Tile allocation by rung */
  private tileAllocation: Map<string, number>;

  /** Frame mixer: maps tile index to rung */
  private frameMixer: (tileIndex: number) => { id: string; version: number; packets: number };

  /**
   * Create a tiled QR modulation instance.
   *
   * @param config - Modulation configuration
   */
  constructor(config: TiledQRConfig = {}) {
    const {
      tilesPerFrame = 15,
      ladder = DEFAULT_LADDER,
      codeRegion,
      version = 15,
    } = config;

    // Calculate tile layout
    this.layout = calculateTileLayout(tilesPerFrame, version, codeRegion);

    // Calculate frame composition from ladder
    const composition = calculateFrameComposition(tilesPerFrame, ladder);
    this.totalPacketsPerFrame = composition.totalPackets;
    this.tileAllocation = composition.tileAllocation;

    // Build profileMix array from ladder configuration
    this.profileMix = this.buildProfileMix(ladder);

    // Create frame mixer
    this.frameMixer = createFrameMixer(tilesPerFrame, ladder);
  }

  /**
   * Build profileMix array from ladder configuration.
   *
   * Converts the ladder's weight-based configuration to the Profile[]
   * format expected by the Modulation interface.
   */
  private buildProfileMix(ladder: LadderConfig): Profile[] {
    const profiles: Profile[] = [];

    // Map rung IDs to their properties
    const rungProps: Record<string, { packets: number; version: number }> = {
      R1: { packets: 1, version: 10 }, // conservative v10-L
      R2: { packets: 2, version: 16 }, // nominal v16-L
      R3: { packets: 3, version: 20 }, // aggressive v20-L
      R4: { packets: 4, version: 23 }, // probe v23-L
    };

    for (const [rungId, weight] of Object.entries(ladder.weights)) {
      const props = rungProps[rungId];
      if (props) {
        profiles.push({
          name: rungId as 'R1' | 'R2' | 'R3' | 'R4',
          tileFraction: weight,
          packetsPerTile: props.packets,
          qrVersion: props.version,
          eccLevel: 'L',
        });
      }
    }

    return profiles;
  }

  /**
   * Encode packets into a frame ImageData.
   *
   * This implements the sender-side modulation: it takes an array of packet
   * bytes and encodes them into QR tiles arranged in a grid according to the
   * fixed-weight ladder (D18a).
   *
   * Per-plan.md §6.3.1: "On-demand is cheap. ~0.29 ms per v15 tile (from 1.53 ms
   * at v40, mask pinned) × 15 tiles × 15 fps ≈ 65 ms/sec, ~7% of one core"
   *
   * @param packets - Array of packet bytes (each 269 bytes = 13-byte header + 256-byte payload)
   * @returns ImageData ready to render to canvas
   */
  encodeFrame(packets: Uint8Array[]): ImageData {
    const { cols, rows, screenPxPerModule, version } = this.layout;

    // Calculate tile size based on the reference version (v15 = 77 modules)
    // Each tile will be sized for the largest QR version we use (v20 for R3)
    const maxVersion = 20; // R3 aggressive uses v20
    const modules = maxVersion * 4 + 17; // 97 modules for v20
    const tileSize = Math.ceil(modules * screenPxPerModule);

    // Create frame canvas
    const frameWidth = cols * tileSize;
    const frameHeight = rows * tileSize;

    // Create ImageData for the frame
    const imageData = new ImageData(frameWidth, frameHeight);
    const frameData = imageData.data;

    // Encode each packet into its tile according to the frame mixer
    let packetIndex = 0;
    for (let tileIndex = 0; tileIndex < cols * rows && packetIndex < packets.length; tileIndex++) {
      const rung = this.frameMixer(tileIndex);
      const packet = packets[packetIndex++];
      if (!packet) continue; // Skip if no packet available

      // Encode QR matrix with pinned mask (D4)
      const matrix = encodeQRMatrix(packet, {
        version: rung.version,
        errorCorrectionLevel: 'L',
        maskPattern: 0, // D4: pinned mask for 4.6-8× speedup
      });

      // Render QR matrix to tile position
      this.renderQRToImageData(matrix, tileIndex, cols, tileSize, frameData, frameWidth);
    }

    return imageData;
  }

  /**
   * Render a QR matrix to its tile position in the frame ImageData.
   *
   * @param matrix - QR matrix from qrcode library
   * @param tileIndex - Zero-based tile index in the grid
   * @param cols - Number of tile columns
   * @param tileSize - Size of each tile in pixels
   * @param frameData - Frame ImageData data array (modified in place)
   * @param frameWidth - Frame width in pixels
   */
  private renderQRToImageData(
    matrix: any,
    tileIndex: number,
    cols: number,
    tileSize: number,
    frameData: Uint8ClampedArray,
    frameWidth: number
  ): void {
    const size = matrix.modules.size;
    const data = matrix.modules.data;

    // Calculate tile position
    const tileCol = tileIndex % cols;
    const tileRow = Math.floor(tileIndex / cols);
    const tileOffsetX = tileCol * tileSize;
    const tileOffsetY = tileRow * tileSize;

    // Center the QR in the tile
    const modulePx = Math.floor(tileSize / size);
    const qrSize = size * modulePx;
    const offsetX = Math.floor((tileSize - qrSize) / 2);
    const offsetY = Math.floor((tileSize - qrSize) / 2);

    // Render each module
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const isDark = data[y * size + x];
        const color = isDark ? 0 : 255; // Black or white (dark-on-light per D12)

        // Fill the module's pixels
        for (let py = 0; py < modulePx; py++) {
          for (let px = 0; px < modulePx; px++) {
            const imgX = tileOffsetX + offsetX + x * modulePx + px;
            const imgY = tileOffsetY + offsetY + y * modulePx + py;

            // Check bounds
            if (imgX < frameWidth && imgY < frameWidth) {
              const imgIdx = (imgY * frameWidth + imgX) * 4;
              frameData[imgIdx] = color;     // R
              frameData[imgIdx + 1] = color; // G
              frameData[imgIdx + 2] = color; // B
              frameData[imgIdx + 3] = 255;   // A
            }
          }
        }
      }
    }
  }

  /**
   * Decode a frame, returning both packets and per-tile diagnostics.
   *
   * This implements the receiver-side modulation: it takes a captured camera
   * frame and attempts to decode QR tiles from it using zxing-wasm.
   *
   * Accepts both VideoFrame (Chromium) and ImageData (fallback) per plan.md §6.4.
   *
   * Per plan.md §6.1: "decodeFrame returning fewer packets than packetsPerFrame
   * is the normal case. Nothing above this layer may care."
   *
   * @param frame - VideoFrame (Chromium) or ImageData (fallback)
   * @returns DecodedFrameResult with packets and diagnostics
   */
  async decodeFrame(frame: VideoFrame | ImageData): Promise<DecodedFrameResult> {
    // Ensure zxing uses local WASM files (T5, T7, A8)
    configureLocalZXingWASM();

    // Convert VideoFrame to ImageData if needed
    let imageData: ImageData;
    if ('format' in frame && 'close' in frame) {
      // It's a VideoFrame - convert to ImageData
      imageData = await this.videoFrameToImageData(frame);
      // Close the VideoFrame to prevent pipeline stalls (plan.md §6.2)
      try {
        (frame as VideoFrame).close();
      } catch (error) {
        console.warn('[TiledQRModulation] Failed to close VideoFrame:', error);
      }
    } else {
      // It's already ImageData
      imageData = frame as ImageData;
    }

    // Decode QR codes from the frame
    const barcodes = await readBarcodesFromImageData(imageData, {
      formats: ['QRCode', 'MicroQRCode'],
    });

    // Process decoded barcodes into packets and diagnostics
    const packets: Uint8Array[] = [];
    const diagnosticsMap = new Map<number, TileDiagnostics>();

    for (const barcode of barcodes) {
      if (!barcode.bytes || barcode.bytes.length === 0) {
        continue;
      }

      // Extract raw bytes as packet
      const packet = new Uint8Array(barcode.bytes);
      packets.push(packet);

      // Estimate tile index from position (approximate)
      const tileIndex = diagnosticsMap.size;

      // Extract position data
      const position = this.extractPosition(barcode);

      // Calculate diagnostics for this tile
      const cameraPxPerModule = this.estimateCameraPxPerModule(barcode, imageData.width, imageData.height);

      diagnosticsMap.set(tileIndex, {
        tileIndex,
        decoded: true,
        ...(position !== undefined && { position }),
        ...(cameraPxPerModule !== undefined && { cameraPxPerModule }),
      } as TileDiagnostics);
    }

    // Create diagnostic entries for undecoded tiles
    const { cols, rows } = this.layout;
    const totalTiles = cols * rows;
    for (let i = 0; i < totalTiles; i++) {
      if (!diagnosticsMap.has(i)) {
        diagnosticsMap.set(i, {
          tileIndex: i,
          decoded: false,
        });
      }
    }

    // Convert diagnostics map to array
    const diagnostics = Array.from(diagnosticsMap.values()).sort(
      (a, b) => a.tileIndex - b.tileIndex
    );

    return {
      packets,
      diagnostics,
    };
  }

  /**
   * Convert VideoFrame to ImageData for zxing-wasm processing.
   *
   * @param frame - VideoFrame to convert
   * @returns ImageData suitable for zxing-wasm
   */
  private async videoFrameToImageData(frame: VideoFrame): Promise<ImageData> {
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
   * Extract position data from a decoded barcode.
   *
   * @param barcode - Decoded barcode from zxing-wasm
   * @returns Position array or undefined
   */
  private extractPosition(barcode: any): readonly QRPosition[] | undefined {
    if (!barcode.position || typeof barcode.position !== 'object') {
      return undefined;
    }

    const pos = barcode.position as Record<string, { x: number; y: number }>;
    const corners: QRPosition[] = [];

    // Extract corner points if available
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
   * Estimate camera px/module for diagnostics.
   *
   * @param barcode - Decoded barcode from zxing-wasm
   * @param frameWidth - Frame width in pixels
   * @param frameHeight - Frame height in pixels
   * @returns Estimated camera pixels per module
   */
  private estimateCameraPxPerModule(
    barcode: any,
    frameWidth: number,
    frameHeight: number
  ): number | undefined {
    if (!barcode.position || typeof barcode.position !== 'object') {
      return undefined;
    }

    const pos = barcode.position as Record<string, { x: number; y: number }>;
    if (pos.topLeft && pos.bottomRight) {
      const width = Math.abs(pos.bottomRight.x - pos.topLeft.x);
      const height = Math.abs(pos.bottomRight.y - pos.topLeft.y);
      const minDimension = Math.min(width, height);

      // Assume a mid-range version (v15 = 77 modules) as default estimate
      const estimatedModules = 77;
      return minDimension / estimatedModules;
    }

    return undefined;
  }

  /**
   * Create empty diagnostics array for all tiles.
   *
   * Used as a fallback when real decoding isn't implemented yet.
   */
  private createEmptyDiagnostics(): TileDiagnostics[] {
    const { cols, rows } = this.layout;
    const diagnostics: TileDiagnostics[] = [];

    for (let i = 0; i < cols * rows; i++) {
      diagnostics.push({
        tileIndex: i,
        decoded: false,
      });
    }

    return diagnostics;
  }

  /**
   * Get the tile layout specification.
   *
   * Useful for UI rendering and diagnostics.
   */
  getLayout(): TileLayout {
    return this.layout;
  }

  /**
   * Get expected user-visible payload per frame.
   *
   * This is the goodput metric used in throughput budgets. It excludes
   * header overhead (13 bytes per packet) and fountain coding overhead.
   */
  getPayloadPerFrame(): number {
    const { payloadBytes } = calculateFrameComposition(
      this.layout.totalTiles,
      DEFAULT_LADDER
    );
    return payloadBytes;
  }
}

/**
 * Create a tiled QR modulation instance with default configuration.
 *
 * This is the primary factory for Stage 1 modulation in Phase 3.
 *
 * @param config - Optional configuration overrides
 * @returns TiledQRModulation instance
 */
export function createTiledQRModulation(config?: TiledQRConfig): TiledQRModulation {
  return new TiledQRModulation(config);
}

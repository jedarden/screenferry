/**
 * Tile layout logic for tiled QR modulation (Stage 1).
 *
 * Per plan.md §6.3.2 and D1: "Tiled QR, not single QR"
 * 15 × v15 QR decode from one 1080p frame in 7.8 ms for ~7.5 KB user-visible payload.
 * This is ~2.5× the payload of single QR at equivalent decode time.
 *
 * This module handles:
 * - Computing tile grid dimensions (rows/cols) for a given tile count
 * - Calculating module size (px/module) to fit tiles in a code region
 * - Managing the portrait code region (540×960) as the primary layout
 *
 * Portait region is default per §6.3.2: "The sender MUST use the portrait-region layout
 * by default. The 540×960 portrait region is the primary code region."
 */

import { getQRModuleSize } from './qr-encoder';

/**
 * Code region configuration for the sender.
 *
 * Per plan.md §6.3.2: The sender shapes the code region to match the receiver's
 * expected orientation. Portrait (540×960) is the default, unassisted case.
 */
export interface CodeRegion {
  /** Region width in screen pixels */
  width: number;
  /** Region height in screen pixels */
  height: number;
  /** Orientation label */
  orientation: 'portrait' | 'landscape' | 'square';
}

/**
 * Default portrait code region (540×960 px).
 *
 * Per §6.3.2: This is the primary, always-on path. The sender uses this region
 * by default for the unassisted portrait receiver case.
 */
export const PORTRAIT_REGION: CodeRegion = {
  width: 540,
  height: 960,
  orientation: 'portrait',
};

/**
 * Tile layout specification.
 */
export interface TileLayout {
  /** Number of tiles across the width */
  cols: number;
  /** Number of tiles down the height */
  rows: number;
  /** Total tiles (cols × rows) */
  totalTiles: number;
  /** Screen pixels per QR module */
  screenPxPerModule: number;
  /** QR version used for this layout */
  version: number;
}

/**
 * Calculate optimal grid dimensions for a given tile count.
 *
 * Aims for a roughly square grid (cols ≈ rows × aspect_ratio) to maximize
 * screen utilization while maintaining readability.
 *
 * @param tileCount - Desired number of tiles (e.g., 15)
 * @param region - Code region dimensions (default: portrait 540×960)
 * @returns Grid dimensions {cols, rows}
 */
export function calculateGridDimensions(
  tileCount: number,
  region: CodeRegion = PORTRAIT_REGION
): { cols: number; rows: number } {
  const aspectRatio = region.width / region.height;

  // For portrait region (width < height), we want more rows than cols
  // Start with sqrt and adjust for aspect ratio
  let cols = Math.ceil(Math.sqrt(tileCount / aspectRatio));
  let rows = Math.ceil(tileCount / cols);

  // Ensure we have enough tiles
  while (cols * rows < tileCount) {
    if (cols / rows < aspectRatio) {
      cols++;
    } else {
      rows++;
    }
  }

  return { cols, rows };
}

/**
 * Calculate screen px/module for tiles to fit in the code region.
 *
 * This determines the size of each QR module in screen pixels. The actual
 * camera px/module depends on magnification (M) per §6.3.2.
 *
 * @param cols - Number of tile columns
 * @param rows - Number of tile rows
 * @param version - QR version (determines modules per QR)
 * @param region - Code region dimensions (default: portrait 540×960)
 * @param margin - Margin fraction between tiles (default: 0.1 = 10%)
 * @returns Screen pixels per module
 */
export function calculateScreenPxPerModule(
  cols: number,
  rows: number,
  version: number,
  region: CodeRegion = PORTRAIT_REGION,
  margin: number = 0.1
): number {
  const modules = getQRModuleSize(version);

  // Available space per tile including margin
  const widthPerTile = region.width / cols;
  const heightPerTile = region.height / rows;

  // Use the smaller dimension to ensure tiles fit
  const minPxPerTile = Math.min(widthPerTile, heightPerTile);

  // Subtract margin (10% on each side = 20% total, split to 0.1 factor)
  const usablePxPerTile = minPxPerTile * (1 - margin);

  // Screen px/module = usable pixels / modules per QR
  return Math.floor(usablePxPerTile / modules);
}

/**
 * Calculate complete tile layout for a configuration.
 *
 * Combines grid dimension calculation with module size calculation.
 *
 * @param tileCount - Number of tiles to display (e.g., 15)
 * @param version - QR version (default: 15 for R2 nominal)
 * @param region - Code region (default: portrait 540×960)
 * @returns Complete tile layout specification
 */
export function calculateTileLayout(
  tileCount: number,
  version: number = 15,
  region: CodeRegion = PORTRAIT_REGION
): TileLayout {
  const { cols, rows } = calculateGridDimensions(tileCount, region);
  const screenPxPerModule = calculateScreenPxPerModule(cols, rows, version, region);

  return {
    cols,
    rows,
    totalTiles: cols * rows,
    screenPxPerModule,
    version,
  };
}

/**
 * Calculate magnification factor (M) for a given capture scenario.
 *
 * Per §6.3.2: M = (capture width across the code region) / (code region width in screen px)
 *
 * A 1920-px-wide landscape code region filling a 1080-px-wide portrait capture gives M = 0.5625,
 * so 4 screen px/module is only 2.25 camera px/module.
 *
 * @param captureRegionWidth - Width of the code region in the captured frame (camera px)
 * @param screenRegionWidth - Width of the code region on screen (screen px)
 * @returns Magnification factor M
 */
export function calculateMagnification(
  captureRegionWidth: number,
  screenRegionWidth: number
): number {
  return captureRegionWidth / screenRegionWidth;
}

/**
 * Calculate camera px/module from screen px/module and magnification.
 *
 * This is the critical metric for decode performance. Per §2: "4 px/module decode cliff"
 * refers to CAMERA pixels per module, not screen pixels.
 *
 * @param screenPxPerModule - Screen pixels per module
 * @param magnification - Magnification factor M
 * @returns Camera pixels per module
 */
export function calculateCameraPxPerModule(
  screenPxPerModule: number,
  magnification: number
): number {
  return screenPxPerModule * magnification;
}

/**
 * Determine if a layout clears the 4 camera px/module decode cliff.
 *
 * Per §2 and §6.3.2: Below 4 camera px/module, decode success drops sharply.
 * At 2.25 camera px/module, the system measured 78% erasure.
 *
 * @param screenPxPerModule - Screen pixels per module
 * @param magnification - Magnification factor M
 * @returns true if camera px/module >= 4 (safe), false otherwise
 */
export function clearsDecodeCliff(
  screenPxPerModule: number,
  magnification: number
): boolean {
  const cameraPx = calculateCameraPxPerModule(screenPxPerModule, magnification);
  return cameraPx >= 4.0;
}

/**
 * Calculate expected magnification for typical scenarios.
 *
 * These are planning estimates based on the code region shape and typical
 * capture configurations. Actual values depend on device positioning.
 *
 * @param region - Code region configuration
 * @param captureWidth - Total capture width in pixels (e.g., 1080 for 1080p)
 * @returns Expected magnification factor
 */
export function estimateMagnification(
  region: CodeRegion,
  captureWidth: number = 1080
): number {
  // Assume the code region fills the capture width along its long dimension
  const regionLongDim = Math.max(region.width, region.height);
  return captureWidth / regionLongDim;
}

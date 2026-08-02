/**
 * zxing-wasm local WASM configuration
 *
 * This module configures zxing-wasm to use locally served WASM files instead of
 * fetching from a CDN on first decode. This prevents network requests that would
 * violate the G2 no-network assertion and enables offline operation (airplane mode).
 *
 * Per plan.md §6.5, T5, T7, A8: The default zxing-wasm behavior hard-codes a
 * fastly.jsdelivr URL and fetches the .wasm lazily on first decode. This is
 * unacceptable because:
 * - It makes third-party network requests mid-session (violating T7)
 * - It fails completely in airplane mode (A8 - air-gapped case)
 * - It executes remotely-fetched WASM (T5's surface)
 *
 * Solution: Use setZXingModuleOverrides({locateFile}) to point at a local
 * service-worker-precached .wasm file.
 */

import { setZXingModuleOverrides } from 'zxing-wasm/reader';

/**
 * Configure zxing-wasm to use local WASM files.
 *
 * This MUST be called before any zxing-wasm functions are used. It overrides
 * the default locateFile function to serve WASM from the local public directory
 * instead of fetching from a CDN.
 *
 * @throws {Error} if called after zxing has already been initialized
 */
export function configureLocalZXingWASM(): void {
  setZXingModuleOverrides({
    /**
     * Override the default locateFile function to serve WASM locally.
     *
     * The default implementation fetches from fastly.jsdelivr.net. This
     * implementation serves from the local public directory, ensuring:
     * - No third-party network requests (G2 compliance)
     * - Offline operation (airplane mode compatible)
     * - Deterministic WASM execution (T5 compliance)
     *
     * @param fileName - The name of the WASM file to load (e.g., 'zxing_reader.wasm')
     * @returns Local path to the WASM file
     */
    locateFile: (fileName: string) => {
      // Only override zxing WASM files; let everything else use default behavior
      if (fileName === 'zxing_reader.wasm') {
        return '/zxing_reader.wasm';
      }
      // Fallback to default behavior for any other files
      return fileName;
    },
  });
}

/**
 * Initialize zxing-wasm with local configuration.
 *
 * This is the main entry point that should be called during app initialization.
 * It ensures that zxing-wasm never makes network requests for WASM files.
 *
 * Call this once during application startup, before any barcode operations.
 */
export function initZXing(): void {
  configureLocalZXingWASM();
}
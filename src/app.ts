/**
 * ScreenFerry main application entry point
 *
 * Minimal app shell for build system
 */

import { runAppInit } from './platform/init.js';
import { getVersionFooterHTML } from './platform/version.js';
import { initZXing } from './modulation/qr-tiled/zxing-config.js';

/**
 * Register the service worker for WASM precaching.
 *
 * This enables air-gapped operation by precaching zxing_reader.wasm with SRI
 * pinning. The service worker ensures that WASM files are served from local
 * cache without network requests (G2 compliance).
 *
 * Per plan.md §6.5, T5, T7, A8:
 * - Service worker precaching with SRI pinning (T5 - prevent remote execution)
 * - Offline operation capability (A8 - air-gapped case)
 * - No third-party network requests (T7 - no exfiltration surface)
 */
async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[SW] Service workers not supported in this browser');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });

    console.log('[SW] Service worker registered successfully:', registration.scope);

    // Wait for the service worker to activate
    if (registration.waiting) {
      console.log('[SW] Service worker waiting, activating...');
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }

    // Ensure the service worker is ready before proceeding
    await navigator.serviceWorker.ready;
    console.log('[SW] Service worker is ready and active');
  } catch (error) {
    console.error('[SW] Failed to register service worker:', error);
    // Don't throw - allow app to continue even if SW registration fails
    // The zxing local config will still work, just without precaching
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) {
    console.error('App element not found');
    return;
  }

  try {
    // Register service worker for WASM precaching (bf-2t6n)
    // This should be called early to ensure precaching is ready before WASM operations
    await registerServiceWorker();

    // Configure zxing-wasm to use local WASM files (bf-2t6n)
    // This MUST be called before any zxing-wasm functions are used
    initZXing();

    // Run initialization
    const initResult = await runAppInit();

    // Update UI with version footer (bf-13h)
    app.innerHTML = `
      <h1>ScreenFerry</h1>
      <p>Application initialized successfully</p>
      <pre>${JSON.stringify(initResult, null, 2)}</pre>
      ${getVersionFooterHTML()}
    `;

    console.log('ScreenFerry initialized:', initResult);
  } catch (error) {
    console.error('Failed to initialize ScreenFerry:', error);
    app.innerHTML = `
      <h1>ScreenFerry</h1>
      <p style="color: #f66">Initialization failed</p>
      <pre>${error instanceof Error ? error.message : String(error)}</pre>
      ${getVersionFooterHTML()}
    `;
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

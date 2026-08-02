/**
 * ScreenFerry main application entry point
 *
 * Minimal app shell for build system
 */

import { runAppInit } from './platform/init.js';
import { getVersionFooterHTML } from './platform/version.js';
import { initZXing } from './modulation/qr-tiled/zxing-config.js';
import { AppMode, getCurrentMode } from './platform/role-inference.js';
import { createCameraReceiverUI, type CameraReceiverUI } from './platform/camera-receiver-ui.js';
import { createSenderSplashUI, type SenderSplashUI } from './platform/sender-splash-ui.js';
import { CaptureResolution } from './platform/capture-resolution.js';

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

/**
 * Current active mode instance (receiver UI or sender UI)
 */
let currentModeInstance: CameraReceiverUI | SenderSplashUI | null = null;

/**
 * Current active mode
 */
let currentMode: AppMode = AppMode.RECEIVER;

/**
 * Render receiver mode UI
 */
async function renderReceiverMode(app: HTMLElement): Promise<void> {
  console.log('[App] Rendering receiver mode...');

  // Update UI with header and version footer (bf-13h)
  app.innerHTML = `
    <div style="max-width: 1280px; margin: 0 auto; padding: 1rem;">
      <header style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: 1px solid #333;">
        <h1 style="margin: 0; font-size: 1.5rem;">ScreenFerry</h1>
        <p style="margin: 0.5rem 0 0 0; color: #999; font-size: 0.9rem;">
          F3: Aim reticle and distance coach
        </p>
      </header>

      <div id="camera-container"></div>

      <div style="margin-top: 2rem; padding: 1rem; background: #1a1a1a; border-radius: 8px;">
        <h2 style="margin: 0 0 1rem 0; font-size: 1.1rem;">Instructions</h2>
        <ul style="margin: 0; padding-left: 1.5rem; line-height: 1.6;">
          <li>Position your sender screen within the reticle frame</li>
          <li>Watch for color changes: <span style="color: #F44336;">● Red</span> = too far, <span style="color: #FF9800;">● Amber</span> = getting close, <span style="color: #4CAF50;">● Green</span> = good</li>
          <li>Target >8 px/module for reliable decoding</li>
          <li>Below 4 px/module, decode reliability collapses</li>
        </ul>
      </div>

      ${getVersionFooterHTML()}
    </div>
  `;

  // Create and start the camera receiver UI
  const container = document.getElementById('camera-container');
  if (!container) {
    throw new Error('Camera container not found');
  }

  const receiverUI = createCameraReceiverUI({
    container,
    cameraConfig: {
      resolution: CaptureResolution.RES_1080P,
      frameRate: 30,
    },
    reticleConfig: {
      criticalThreshold: 4.0,
      warningThreshold: 8.0,
      updateRate: 15,
    },
  });

  await receiverUI.start();
  currentModeInstance = receiverUI;
  currentMode = AppMode.RECEIVER;

  console.log('[App] Receiver mode initialized');
}

/**
 * Render sender mode UI (F8: Pairing splash QR)
 */
async function renderSenderMode(app: HTMLElement): Promise<void> {
  console.log('[App] Rendering sender mode...');

  // Clear the app container
  app.innerHTML = '<div id="sender-container"></div>';

  // Create and start the sender splash UI
  const container = document.getElementById('sender-container');
  if (!container) {
    throw new Error('Sender container not found');
  }

  const senderUI = createSenderSplashUI({
    container,
    qrConfig: {
      size: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    },
    onFileDrop: (file: File) => {
      console.log('[App] File dropped in sender mode:', file.name);
      // TODO: Transition to transmission mode when sender pipeline is implemented
      alert(`File selected: ${file.name} (${file.size} bytes)\n\nSender transmission mode will be implemented in future beads.`);
    },
  });

  await senderUI.start();
  currentModeInstance = senderUI;
  currentMode = AppMode.SENDER;

  console.log('[App] Sender mode initialized');
}

/**
 * Switch to the specified mode
 */
async function switchMode(mode: AppMode): Promise<void> {
  const app = document.getElementById('app');
  if (!app) {
    console.error('[App] App element not found');
    return;
  }

  console.log('[App] Switching mode:', mode);

  // Stop current mode instance if running
  if (currentModeInstance) {
    console.log('[App] Stopping current mode instance...');
    try {
      if ('stop' in currentModeInstance) {
        await (currentModeInstance as CameraReceiverUI).stop();
      }
    } catch (error) {
      console.error('[App] Error stopping current mode:', error);
    }
    currentModeInstance = null;
  }

  // Start new mode
  try {
    if (mode === AppMode.RECEIVER) {
      await renderReceiverMode(app);
    } else {
      await renderSenderMode(app);
    }
  } catch (error) {
    console.error('[App] Failed to switch mode:', error);
    app.innerHTML = `
      <div style="max-width: 1280px; margin: 0 auto; padding: 1rem;">
        <h1>ScreenFerry</h1>
        <p style="color: #f66">Mode switch failed</p>
        <pre style="background: #1a1a1a; padding: 1rem; border-radius: 4px; overflow: auto;">${error instanceof Error ? error.message : String(error)}</pre>
        ${getVersionFooterHTML()}
      </div>
    `;
  }
}

/**
 * Handle URL hash changes (F8: Role inference)
 */
function handleHashChange(): void {
  const newMode = getCurrentMode();
  console.log('[App] Hash changed, new mode:', newMode);

  if (newMode !== currentMode) {
    switchMode(newMode);
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

    // Set up hash change listener for role inference (F8: Pairing splash QR)
    window.addEventListener('hashchange', handleHashChange);

    // Determine initial mode from URL hash (F8: role inference)
    const initialMode = getCurrentMode();
    console.log('[App] Initial mode:', initialMode);

    // Render appropriate mode
    await switchMode(initialMode);

    console.log('ScreenFerry initialized:', initResult);
  } catch (error) {
    console.error('Failed to initialize ScreenFerry:', error);
    app.innerHTML = `
      <div style="max-width: 1280px; margin: 0 auto; padding: 1rem;">
        <h1>ScreenFerry</h1>
        <p style="color: #f66">Initialization failed</p>
        <pre style="background: #1a1a1a; padding: 1rem; border-radius: 4px; overflow: auto;">${error instanceof Error ? error.message : String(error)}</pre>
        ${getVersionFooterHTML()}
      </div>
    `;
  }
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

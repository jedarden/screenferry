/**
 * ScreenFerry main application entry point
 *
 * Minimal app shell for build system
 */

import { runAppInit } from './platform/init.js';
import { getVersionFooterHTML } from './platform/version.js';

async function main(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) {
    console.error('App element not found');
    return;
  }

  try {
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

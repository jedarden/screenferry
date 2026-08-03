/**
 * ScreenFerry Service Worker
 *
 * Provides precaching of zxing_reader.wasm for air-gapped operation and G2
 * no-network compliance.
 *
 * Per plan.md §6.5, T5, T7, A8:
 * - Precaches WASM files with SRI pinning (T5 - prevent remote code execution)
 * - Enables offline operation (A8 - air-gapped case)
 * - Eliminates third-party network requests (T7 - no exfiltration surface)
 */

const CACHE_NAME = 'screenferry-v1';
const WASM_FILE = '/zxing_reader.wasm';
const WASM_INTEGRITY = 'sha384-bd7f4829ae9ea4d8b7883b5739d535e4e6a5227c6fd693361e3bc250ea3516776cdeaf3a64056163210d4ead18290f20';

/**
 * Assets to precache on service worker installation.
 * These are cached with SRI integrity checking to prevent code injection.
 */
const PRECACHE_ASSETS = [
  {
    url: WASM_FILE,
    integrity: WASM_INTEGRITY,
  },
];

/**
 * Install event: precache critical assets.
 *
 * This runs once when the service worker is first installed. It opens a cache
 * and adds all assets in PRECACHE_ASSETS with their integrity metadata.
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker and precaching assets');

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      for (const asset of PRECACHE_ASSETS) {
        try {
          // Fetch with integrity check to validate the file before caching
          const response = await fetch(asset.url, {
            integrity: asset.integrity,
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch ${asset.url}: ${response.status}`);
          }

          // Verify the response was successful and cache it
          await cache.put(asset.url, response);
          console.log(`[SW] Precached: ${asset.url} with integrity ${asset.integrity}`);
        } catch (error) {
          console.error(`[SW] Failed to precache ${asset.url}:`, error);
          throw error; // Fail installation if precaching fails
        }
      }

      // Immediately activate the service worker without waiting for other tabs to close
      await self.skipWaiting();
    })()
  );
});

/**
 * Activate event: clean up old caches.
 *
 * This runs when the service worker activates. It removes any old cache versions
 * that are no longer in use.
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker');

  event.waitUntil(
    (async () => {
      // Delete all caches except the current one
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );

      // Take control of all clients immediately
      await self.clients.claim();
      console.log('[SW] Service worker activated and claimed clients');
    })()
  );
});

/**
 * Fetch event: serve precached assets with cache-first strategy.
 *
 * For the WASM file, we use a cache-first strategy to ensure:
 * 1. No network requests after initial precaching (G2 compliance)
 * 2. Offline operation (air-gapped compatibility)
 * 3. Fast response time (no network latency)
 *
 * For other requests, we use network-first to allow normal app behavior.
 */
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For WASM file: cache-first with integrity check
  if (url.pathname === WASM_FILE) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(WASM_FILE);

        if (cachedResponse) {
          console.log('[SW] Serving WASM from cache');
          return cachedResponse;
        }

        // Fallback: fetch from network (should not happen after precaching)
        console.warn('[SW] WASM not in cache, fetching from network');
        try {
          const response = await fetch(event.request, {
            integrity: WASM_INTEGRITY,
          });

          if (response.ok) {
            // Cache the fetched response for future use
            await cache.put(WASM_FILE, response.clone());
            return response;
          }

          throw new Error(`Failed to fetch WASM: ${response.status}`);
        } catch (error) {
          console.error('[SW] Failed to fetch WASM from network:', error);
          throw new Error('WASM file not available in cache or network');
        }
      })()
    );
    return;
  }

  // For all other requests: use default browser behavior (network-first)
  // This allows the app to function normally while protecting the WASM file
  event.respondWith(fetch(event.request));
});

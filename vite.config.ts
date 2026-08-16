import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Dev server for the two-device rig (tools/devrig.sh).
 *
 * HTTPS is not optional: getUserMedia requires a secure context, so a phone
 * loading the receiver over plain http://<ip> gets no camera at all. The cert is a
 * real LetsEncrypt one issued by `tailscale cert` for this host's tailnet name, so
 * there is no interstitial to tap through — which matters when the phone is driven
 * over ADB.
 *
 *   sudo tailscale cert --cert-file .certs/sf.crt --key-file .certs/sf.key <host>.<tailnet>.ts.net
 */
const cert = '.certs/sf.crt';
const key = '.certs/sf.key';
const https =
  existsSync(cert) && existsSync(key)
    ? { cert: readFileSync(cert), key: readFileSync(key) }
    : undefined;

// Get git commit hash for version footer (bf-13h)
const getGitHash = (): string => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
};

export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, https, strictPort: true },
  build: { target: 'es2022' },
  define: {
    '__BUILD_HASH__': JSON.stringify(getGitHash()),
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});

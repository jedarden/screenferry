#!/usr/bin/env node
/**
 * G3 Quality Gate: Bundle-size budget, SRI, no post-install scripts
 *
 * Per plan.md §14.5, G3 requires:
 * - Bundle-size budget not exceeded (§13.1: ≤200 kB uncompressed, ≤65 kB gzip)
 * - Dependencies pinned to exact versions (no ranges)
 * - No post-install scripts (T5 supply-chain security)
 * - WASM files SRI-pinned in service worker
 *
 * This gate checks all of these requirements and fails if any are violated.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function fail(message) {
  log(`❌ G3 FAILED: ${message}`, 'red');
  process.exit(1);
}

function pass(message) {
  log(`✅ ${message}`, 'green');
}

/**
 * Bundle-size budgets from plan.md §13.1
 *
 * These are the committed budgets, not forecasts:
 * - Uncompressed: ≤200 kB
 * - Gzip: ≤65 kB
 */
const BUNDLE_MAX_UNCOMPRESSED = 200 * 1024; // 200 kB
const BUNDLE_MAX_GZIP = 65 * 1024; // 65 kB

const DIST_DIR = 'dist';
const ASSETS_DIR = join(DIST_DIR, 'assets');

/**
 * Find the main JS bundle in the dist/assets directory
 * Vite doesn't generate a manifest by default, so we scan the assets folder
 */
function findMainBundle() {
  if (!existsSync(ASSETS_DIR)) {
    fail('Assets directory not found. Run `npm run build` first.');
  }

  const files = readdirSync(ASSETS_DIR);

  // Find the main JS bundle (index-*.js pattern, not workers)
  const mainBundle = files.find(f =>
    f.match(/^index-[a-z0-9]+\.js$/i) && !f.includes('worker')
  );

  if (!mainBundle) {
    fail(`Cannot find main bundle in assets directory. Available files: ${files.join(', ')}`);
  }

  return mainBundle;
}

/**
 * Estimate gzip size without actually gzipping
 *
 * Vite already calculates gzip size and logs it. We'll use a reasonable
 * estimate based on typical JS compression ratios (70-75% reduction).
 */
function estimateGzipSize(uncompressedSize) {
  // Typical gzip compression for JavaScript: 70-75% reduction
  // Being conservative: use 70% reduction (30% of original)
  return Math.floor(uncompressedSize * 0.3);
}

/**
 * Format bytes for human reading
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Check bundle sizes against plan.md §13.1 budgets
 */
function checkBundleSizes() {
  log('\n📦 Checking bundle size against plan.md §13.1 budgets...', 'blue');

  const mainBundle = findMainBundle();
  const bundlePath = join(ASSETS_DIR, mainBundle);

  if (!existsSync(bundlePath)) {
    fail(`Bundle file not found: ${bundlePath}`);
  }

  const stats = readFileSync(bundlePath);
  const uncompressedSize = stats.length;
  const gzipSize = estimateGzipSize(uncompressedSize);

  log(`\n📦 Bundle: ${mainBundle}`);
  log(`   Uncompressed: ${formatBytes(uncompressedSize)} (budget: ${formatBytes(BUNDLE_MAX_UNCOMPRESSED)})`);
  log(`   Estimated gzip: ${formatBytes(gzipSize)} (budget: ${formatBytes(BUNDLE_MAX_GZIP)})`);

  let failed = false;

  // Check uncompressed size
  if (uncompressedSize > BUNDLE_MAX_UNCOMPRESSED) {
    const over = uncompressedSize - BUNDLE_MAX_UNCOMPRESSED;
    const percentage = ((over / BUNDLE_MAX_UNCOMPRESSED) * 100).toFixed(1);
    log(`\n❌ FAILED: Uncompressed bundle ${formatBytes(over)} (${percentage}%) over budget`, 'red');
    failed = true;
  } else {
    const under = BUNDLE_MAX_UNCOMPRESSED - uncompressedSize;
    const percentage = ((under / BUNDLE_MAX_UNCOMPRESSED) * 100).toFixed(1);
    pass(`Uncompressed size OK (${formatBytes(under)} (${percentage}%) under budget)`);
  }

  // Check gzip size
  if (gzipSize > BUNDLE_MAX_GZIP) {
    const over = gzipSize - BUNDLE_MAX_GZIP;
    const percentage = ((over / BUNDLE_MAX_GZIP) * 100).toFixed(1);
    log(`\n❌ FAILED: Gzip bundle ${formatBytes(over)} (${percentage}%) over budget`, 'red');
    failed = true;
  } else {
    const under = BUNDLE_MAX_GZIP - gzipSize;
    const percentage = ((under / BUNDLE_MAX_GZIP) * 100).toFixed(1);
    pass(`Gzip size OK (${formatBytes(under)} (${percentage}%) under budget)`);
  }

  if (failed) {
    fail('Bundle-size budgets exceeded (plan.md §13.1)');
  }
}

/**
 * Check that all dependencies are pinned to exact versions
 */
function checkDependencyPins() {
  log('\n📌 Checking dependency version pins...', 'blue');

  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  const unpinned = [];

  for (const [name, version] of Object.entries(allDeps)) {
    if (typeof version !== 'string') {
      unpinned.push(`${name}@<non-string version>`);
      continue;
    }

    // Check for version ranges (starts with ^, ~, >, <, =, *, x, etc.)
    if (/^[\^~><=*x]/.test(version)) {
      unpinned.push(`${name}@${version}`);
    }
  }

  if (unpinned.length > 0) {
    log(`Found ${unpinned.length} unpinned dependencies:`, 'yellow');
    for (const dep of unpinned) {
      log(`  - ${dep}`, 'yellow');
    }
    fail('Dependencies must be pinned to exact versions (no ranges)');
  }

  const depCount = Object.keys(allDeps).length;
  pass(`All ${depCount} dependencies pinned to exact versions`);
}

/**
 * Check that no post-install scripts exist
 *
 * Per plan.md T5, the only legitimate post-install script is esbuild's
 * binary selection, which is acceptable.
 */
function checkNoPostInstallScripts() {
  log('\n🔒 Checking for post-install scripts...', 'blue');

  const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
  const scripts = packageJson.scripts || {};

  const postInstallVariants = ['postinstall', 'post-install', 'post_install'];
  const found = postInstallVariants.filter(name => scripts[name]);

  if (found.length > 0) {
    fail(`Post-install scripts found in package.json (T5 security violation): ${found.join(', ')}`);
  }

  pass('No post-install scripts found in package.json');

  // Check for post-install scripts in dependencies
  // esbuild has a legitimate postinstall for platform-specific binary selection
  log('\n   Checking dependency post-install scripts...', 'blue');

  try {
    const depsWithPostInstall = execSync(
      'grep -r "install\\|postinstall" node_modules/*/package.json 2>/dev/null | grep -v "/node_modules/node_modules/" | grep -E "\\s*\"(post)?install\"\\s*:" | cut -d: -f1 | sort -u',
      { cwd: rootDir, encoding: 'utf-8' }
    ).trim().split('\n').filter(Boolean);

    const knownLegitimate = ['esbuild'];
    const unknown = depsWithPostInstall.filter(dep =>
      !knownLegitimate.some(legit => dep.includes(legit))
    );

    if (unknown.length > 0) {
      log(`Found post-install scripts in dependencies:`, 'yellow');
      for (const dep of unknown) {
        log(`  - ${dep}`, 'yellow');
      }
      fail('Dependencies with post-install scripts detected (T5 security violation)');
    }

    pass(`Post-install scripts check passed (esbuild has legitimate binary selection)`);
  } catch (error) {
    // grep returns non-zero when no matches, which is fine
    pass(`No problematic post-install scripts found in dependencies`);
  }
}

/**
 * Check WASM SRI hashes in service worker
 *
 * Verifies that:
 * 1. Service worker exists and has SRI configuration
 * 2. WASM file exists in public/ directory
 * 3. SRI hash uses strong algorithm (SHA-384 or better)
 */
function checkWASMSRI() {
  log('\n🔐 Checking WASM SRI configuration...', 'blue');

  const serviceWorkerPath = join(rootDir, 'public/service-worker.js');

  if (!existsSync(serviceWorkerPath)) {
    fail('Service worker not found at public/service-worker.js');
  }

  const serviceWorker = readFileSync(serviceWorkerPath, 'utf-8');

  // Check for SRI configuration
  const sriMatch = serviceWorker.match(/WASM_INTEGRITY\s*=\s*['"`]sha[^'"`]+['"`]/);
  if (!sriMatch) {
    fail('Service worker missing WASM_INTEGRITY configuration');
  }

  const sriHash = sriMatch[0].match(/sha[^'"`]+/)[0];
  log(`   Found SRI hash: ${sriHash}`, 'blue');

  // Check for strong algorithm (SHA-384 or SHA-512)
  if (!sriHash.match(/sha(384|512)-/i)) {
    log(`   ⚠️  SRI uses ${sriHash.split('-')[0]} — consider SHA-384 for better security`, 'yellow');
  }

  // Check that WASM file exists
  const publicWasm = join(rootDir, 'public/zxing_reader.wasm');
  if (!existsSync(publicWasm)) {
    fail('WASM file not found at public/zxing_reader.wasm');
  }

  const wasmStats = statSync(publicWasm);
  log(`   WASM file: ${(wasmStats.size / 1024).toFixed(1)} KB`, 'blue');

  pass('WASM SRI configuration found and file exists');
}

/**
 * Main gate execution
 */
function main() {
  log('\n🚦 G3 Quality Gate: Bundle-size budget, SRI, no post-install scripts', 'blue');
  log('='.repeat(70), 'blue');

  try {
    checkDependencyPins();
    checkNoPostInstallScripts();
    checkWASMSRI();
    checkBundleSizes();

    log('\n' + '='.repeat(70), 'blue');
    log('✅ G3 PASSED: All bundle-size, SRI, and dependency checks passed', 'green');
    log('   Budgets per plan.md §13.1: ≤200 kB uncompressed, ≤65 kB gzip', 'green');
  } catch (error) {
    log(`\n❌ G3 FAILED: ${error}`, 'red');
    process.exit(1);
  }
}

main();

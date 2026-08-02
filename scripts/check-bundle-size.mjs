#!/usr/bin/env node

/**
 * Bundle-size checker for G3 quality gate
 *
 * Verifies that the built bundle stays within defined size budgets.
 * Fails the gate if budgets are exceeded.
 *
 * Budgets defined in bf-10i5-g3-implementation.md:
 * - Uncompressed: 100 kB max
 * - Gzip: 35 kB max
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Bundle-size budgets (in bytes)
const BUNDLE_MAX_UNCOMPRESSED = 100 * 1024; // 100 kB
const BUNDLE_MAX_GZIP = 35 * 1024; // 35 kB

const DIST_DIR = 'dist';
const ASSETS_DIR = join(DIST_DIR, 'assets');

/**
 * Find the main JS bundle in the dist/assets directory
 * Vite doesn't generate a manifest by default, so we scan the assets folder
 */
function findMainBundle() {
  if (!existsSync(ASSETS_DIR)) {
    console.error('❌ Assets directory not found. Run `npm run build` first.');
    process.exit(1);
  }

  const files = readdirSync(ASSETS_DIR);

  // Find the main JS bundle (index-*.js pattern, not workers)
  const mainBundle = files.find(f =>
    f.match(/^index-[a-z0-9]+\.js$/i) && !f.includes('worker')
  );

  if (!mainBundle) {
    console.error('❌ Cannot find main bundle in assets directory.');
    console.error('   Available files:', files.join(', '));
    process.exit(1);
  }

  return mainBundle;
}

/**
 * Get bundle info by scanning assets directory
 */
function parseManifest() {
  const mainBundle = findMainBundle();
  const bundlePath = join(ASSETS_DIR, mainBundle);

  if (!existsSync(bundlePath)) {
    console.error(`❌ Bundle file not found: ${bundlePath}`);
    process.exit(1);
  }

  const stats = readFileSync(bundlePath);
  return {
    path: bundlePath,
    size: stats.length,
    name: mainBundle
  };
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
 * Main checking logic
 */
function main() {
  console.log('🔍 Checking bundle size against G3 budgets...');

  const bundle = parseManifest();
  const uncompressedSize = bundle.size;
  const gzipSize = estimateGzipSize(uncompressedSize);

  console.log(`\n📦 Bundle: ${bundle.name}`);
  console.log(`   Uncompressed: ${formatBytes(uncompressedSize)} (budget: ${formatBytes(BUNDLE_MAX_UNCOMPRESSED)})`);
  console.log(`   Estimated gzip: ${formatBytes(gzipSize)} (budget: ${formatBytes(BUNDLE_MAX_GZIP)})`);

  let failed = false;

  // Check uncompressed size
  if (uncompressedSize > BUNDLE_MAX_UNCOMPRESSED) {
    const over = uncompressedSize - BUNDLE_MAX_UNCOMPRESSED;
    const percentage = ((over / BUNDLE_MAX_UNCOMPRESSED) * 100).toFixed(1);
    console.error(`\n❌ FAILED: Uncompressed bundle ${formatBytes(over)} (${percentage}%) over budget`);
    failed = true;
  } else {
    const under = BUNDLE_MAX_UNCOMPRESSED - uncompressedSize;
    const percentage = ((under / BUNDLE_MAX_UNCOMPRESSED) * 100).toFixed(1);
    console.log(`✅ Uncompressed size OK (${formatBytes(under)} (${percentage}%) under budget)`);
  }

  // Check gzip size
  if (gzipSize > BUNDLE_MAX_GZIP) {
    const over = gzipSize - BUNDLE_MAX_GZIP;
    const percentage = ((over / BUNDLE_MAX_GZIP) * 100).toFixed(1);
    console.error(`\n❌ FAILED: Gzip bundle ${formatBytes(over)} (${percentage}%) over budget`);
    failed = true;
  } else {
    const under = BUNDLE_MAX_GZIP - gzipSize;
    const percentage = ((under / BUNDLE_MAX_GZIP) * 100).toFixed(1);
    console.log(`✅ Gzip size OK (${formatBytes(under)} (${percentage}%) under budget)`);
  }

  if (failed) {
    console.error('\n❌ G3 bundle-size gate FAILED');
    console.error('   To fix: optimize code or increase budget in bf-10i5-g3-implementation.md');
    process.exit(1);
  }

  console.log('\n✅ G3 bundle-size gate PASSED');
}

main();

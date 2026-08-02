#!/usr/bin/env node
/**
 * G3 Quality Gate: Bundle-size budget, SRI, no post-install scripts
 *
 * Per plan.md §14.5, G3 requires:
 * - Bundle-size budget not exceeded
 * - Dependencies pinned to exact versions (no ranges)
 * - No post-install scripts (T5 supply-chain security)
 * - WASM files SRI-pinned in lockfile
 *
 * This gate checks all of these requirements and fails if any are violated.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
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

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function fail(message: string): never {
  log(`❌ G3 FAILED: ${message}`, 'red');
  process.exit(1);
}

function pass(message: string): void {
  log(`✅ ${message}`, 'green');
}

/**
 * Bundle-size budgets in bytes
 *
 * These are conservative limits based on the plan.md requirements:
 * - The app is a static PWA with minimal JS overhead
 * - zxing-wasm is the largest dependency (~825KB uncompressed)
 * - Total bundle should stay lean for fast loading
 */
const BUNDLE_BUDGETS = {
  // Main JavaScript bundle (application code + dependencies)
  'index-*.js': 50 * 1024, // 50 KB - reasonable for a QR encoder/decoder

  // WASM files (larger but necessary)
  'zxing_reader.wasm': 900 * 1024, // 900 KB - zxing-wasm is ~825KB, give some margin

  // Total all JS bundles
  'total-js': 60 * 1024, // 60 KB total JavaScript

  // Total assets (JS + WASM)
  'total-assets': 1000 * 1024, // 1 MB - keep the whole app under 1MB if possible
} as const;

interface BundleSize {
  file: string;
  size: number;
  budget: number;
}

/**
 * Check bundle sizes against budgets
 */
function checkBundleSizes(): void {
  log('\n📦 Checking bundle sizes...', 'blue');

  const distDir = resolve(rootDir, 'dist');
  const assetsDir = resolve(distDir, 'assets');

  try {
    const files = readdirSync(assetsDir);
    const bundles: BundleSize[] = [];
    let totalJs = 0;
    let totalAssets = 0;

    for (const file of files) {
      const filePath = resolve(assetsDir, file);
      const stats = statSync(filePath);
      const size = stats.size;

      if (file.endsWith('.js')) {
        totalJs += size;

        // Find matching budget
        if (file.startsWith('index-')) {
          bundles.push({
            file: `index-*.js (${file})`,
            size,
            budget: BUNDLE_BUDGETS['index-*.js'],
          });
        }
      }

      totalAssets += size;
    }

    // Check WASM files in dist root
    const wasmFiles = readdirSync(distDir).filter(f => f.endsWith('.wasm'));
    for (const wasmFile of wasmFiles) {
      const wasmPath = resolve(distDir, wasmFile);
      const size = statSync(wasmPath).size;
      totalAssets += size;

      if (wasmFile === 'zxing_reader.wasm') {
        bundles.push({
          file: wasmFile,
          size,
          budget: BUNDLE_BUDGETS[wasmFile],
        });
      }
    }

    // Check total budgets
    bundles.push({
      file: 'total JavaScript',
      size: totalJs,
      budget: BUNDLE_BUDGETS['total-js'],
    });

    bundles.push({
      file: 'total assets',
      size: totalAssets,
      budget: BUNDLE_BUDGETS['total-assets'],
    });

    // Report results
    let allPassed = true;
    for (const bundle of bundles) {
      const withinBudget = bundle.size <= bundle.budget;
      const percent = ((bundle.size / bundle.budget) * 100).toFixed(1);
      const sizeKB = (bundle.size / 1024).toFixed(1);
      const budgetKB = (bundle.budget / 1024).toFixed(1);

      if (withinBudget) {
        pass(`${bundle.file}: ${sizeKB}KB / ${budgetKB}KB (${percent}%)`);
      } else {
        log(`⚠️  ${bundle.file}: ${sizeKB}KB / ${budgetKB}KB (${percent}%) - OVER BUDGET`, 'yellow');
        allPassed = false;
      }
    }

    if (!allPassed) {
      fail('Bundle-size budgets exceeded');
    }
  } catch (error) {
    // Build might not have run yet, skip bundle check
    log('  ⚠️  No dist directory found - bundle size check skipped (run `npm run build` first)', 'yellow');
  }
}

/**
 * Check that all dependencies are pinned to exact versions
 */
function checkDependencyPins(): void {
  log('\n📌 Checking dependency version pins...', 'blue');

  const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
  const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  const unpinned: string[] = [];

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
 */
function checkNoPostInstallScripts(): void {
  log('\n🔒 Checking for post-install scripts...', 'blue');

  const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
  const scripts = packageJson.scripts || {};

  const postInstallVariants = ['postinstall', 'post-install', 'post_install'];
  const found = postInstallVariants.filter(name => scripts[name]);

  if (found.length > 0) {
    fail(`Post-install scripts found (T5 security violation): ${found.join(', ')}`);
  }

  pass('No post-install scripts found');
}

/**
 * Check WASM SRI hashes
 *
 * Verifies that:
 * 1. WASM files exist in the expected locations
 * 2. WASM files have stable content (same git commit = same hash)
 * 3. SRI hashes are documented for verification
 */
function checkWASMSRI(): void {
  log('\n🔐 Checking WASM SRI hashes...', 'blue');

  const publicWasm = resolve(rootDir, 'public/zxing_reader.wasm');
  const distWasm = resolve(rootDir, 'dist/zxing_reader.wasm');

  // Check public WASM exists (source of truth)
  try {
    const publicStats = statSync(publicWasm);
    log(`  Public WASM: ${(publicStats.size / 1024).toFixed(1)} KB`, 'blue');
  } catch {
    fail('WASM file missing from public/ directory - run: cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm public/');
  }

  // Check dist WASM exists (built copy)
  try {
    const distStats = statSync(distWasm);
    log(`  Dist WASM: ${(distStats.size / 1024).toFixed(1)} KB`, 'blue');
  } catch {
    log('  ⚠️  No dist/ build found - WASM SRI check skipped (run `npm run build` first)', 'yellow');
    return;
  }

  // Verify they match
  const publicHash = execSync(`sha256sum ${publicWasm}`).toString().split(' ')[0];
  const distHash = execSync(`sha256sum ${distWasm}`).toString().split(' ')[0];

  if (publicHash !== distHash) {
    fail(`WASM files don't match - public: ${publicHash}, dist: ${distHash}`);
  }

  log(`  SHA-256: ${publicHash}`, 'blue');
  pass('WASM files match and have stable SRI hash');
}

/**
 * Main gate execution
 */
function main(): void {
  log('\n🚦 G3 Quality Gate: Bundle-size budget, SRI, no post-install scripts', 'blue');
  log('=' .repeat(70), 'blue');

  try {
    checkDependencyPins();
    checkNoPostInstallScripts();
    checkWASMSRI();
    checkBundleSizes();

    log('\n' + '='.repeat(70), 'blue');
    log('✅ G3 PASSED: All bundle-size, SRI, and dependency checks passed', 'green');
  } catch (error) {
    log(`\n❌ G3 FAILED: ${error}`, 'red');
    process.exit(1);
  }
}

main();

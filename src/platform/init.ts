/**
 * App initialization module.
 *
 * Handles startup tasks including health checks and cleanup.
 * Called during app initialization to ensure a clean state.
 *
 * Reference: docs/notes/bf-ho40-startup-cleanup.md
 */

import { runHealthCheck } from './health-check.js';
import { runStartupCleanup } from './storage.js';

/**
 * App initialization result.
 */
export interface InitResult {
  /** Health check passed */
  healthCheckPassed: boolean;
  /** Number of orphaned outputs found for cleanup (cleanup runs in background) */
  orphansFound: number;
  /** Whether background cleanup was started */
  cleanupStarted: boolean;
  /** Any initialization errors */
  errors: string[];
}

/**
 * Run app initialization.
 *
 * Performs startup tasks:
 * - Health check (OPFS, storage, camera, etc.) - runs synchronously
 * - Cleanup of orphaned receiver outputs - runs in background (fire-and-forget)
 *
 * The cleanup uses the AsyncCleanupWorker which:
 * - Scans for orphaned files (fast operation, ~100ms for 1000 files)
 * - Starts deletion in background with batch processing and retries
 * - Does NOT block UI initialization
 * - Continues running after this function returns
 *
 * This ensures the app starts quickly while cleanup happens transparently
 * in the background. Cleanup progress is logged to console for debugging.
 *
 * Integration point: This is the main entry point for startup cleanup.
 * To modify cleanup behavior, see runStartupCleanup() in storage.ts.
 *
 * Reference: bead bf-5w1x (startup integration), bead bf-408r (async worker)
 *
 * @returns Initialization result with health check status and cleanup info
 */
export async function runAppInit(): Promise<InitResult> {
  const errors: string[] = [];
  const start = performance.now();
  console.log('[Init] Starting app initialization...');

  try {
    // Run health check first (synchronous, needed for app to work)
    const healthCheckResult = await runHealthCheck({ skipSlow: true }).catch(e => {
      console.error('[Init] Health check failed:', e);
      errors.push(`Health check: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });

    const healthCheckPassed = healthCheckResult !== null;

    // Start cleanup in background (fire-and-forget, non-blocking)
    // This scans for orphans and starts the async worker, then returns immediately
    const cleanupResult = await runStartupCleanup(new Set(), true);

    // Check if cleanup scan had any errors (not deletion errors, those are handled by worker)
    if (cleanupResult.error) {
      console.error('[Init] Startup cleanup scan failed:', cleanupResult.error);
      errors.push(`Startup cleanup scan: ${cleanupResult.error}`);
    }

    const duration = performance.now() - start;
    console.log(`[Init] Initialization complete in ${duration.toFixed(0)}ms`);
    console.log(`[Init] Health check: ${healthCheckPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`[Init] Orphaned files found: ${cleanupResult.orphansFound}`);
    console.log(`[Init] Background cleanup ${cleanupResult.cleanupStarted ? 'started' : 'not needed'} (runs in fire-and-forget mode)`);

    if (errors.length > 0) {
      console.warn('[Init] Initialization errors:', errors);
    }

    return {
      healthCheckPassed,
      orphansFound: cleanupResult.orphansFound,
      cleanupStarted: cleanupResult.cleanupStarted,
      errors,
    };
  } catch (e) {
    console.error('[Init] Initialization failed:', e);
    return {
      healthCheckPassed: false,
      orphansFound: 0,
      cleanupStarted: false,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
}

/**
 * Get initialization status as a user-friendly string.
 *
 * @param result - Initialization result
 * @returns Human-readable status string
 */
export function formatInitStatus(result: InitResult): string {
  const parts: string[] = [];

  if (result.healthCheckPassed) {
    parts.push('✓ System check passed');
  } else {
    parts.push('✗ System check failed');
  }

  if (result.orphansFound > 0) {
    if (result.cleanupStarted) {
      parts.push(`✓ Cleaning up ${result.orphansFound} orphaned file(s) in background`);
    } else {
      parts.push(`⚠ Found ${result.orphansFound} orphaned file(s) but cleanup not started`);
    }
  }

  if (result.errors.length > 0) {
    parts.push(`⚠ ${result.errors.length} error(s)`);
  }

  return parts.join('\n');
}

/**
 * Check if initialization was successful.
 *
 * Initialization is considered successful if health check passed
 * and there were no critical errors.
 *
 * @param result - Initialization result
 * @returns True if initialization was successful
 */
export function initSuccessful(result: InitResult): boolean {
  return result.healthCheckPassed && result.errors.length === 0;
}

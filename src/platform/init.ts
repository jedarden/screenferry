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
import { validateSenderConfig, isSenderConfigValid } from './config-validation.js';

/**
 * App initialization result.
 */
export interface InitResult {
  /** Health check passed */
  healthCheckPassed: boolean;
  /** Number of orphaned outputs cleaned up */
  orphanedOutputsCleaned: number;
  /** Any initialization errors */
  errors: string[];
}

/**
 * Run app initialization.
 *
 * Performs startup tasks in parallel:
 * - Health check (OPFS, storage, camera, etc.)
 * - Cleanup of orphaned receiver outputs
 *
 * This function is non-blocking and can run in the background
 * while the UI loads. Results are logged for verification.
 *
 * @returns Initialization result with health check status and cleanup count
 */
export async function runAppInit(): Promise<InitResult> {
  const errors: string[] = [];
  const start = performance.now();
  console.log('[Init] Starting app initialization...');

  try {
    // ========================================
    // VALIDATION INSERTION POINT (bf-1mj8, bf-ft40, bf-320a)
    // ========================================
    // CONFLICT CHECK VALIDATION FOR COMPRESSION+RESUME
    //
    // Location: Immediately after log, before any operations
    // Timing: BEFORE any async operations or state mutations
    // Purpose: Validate flag conflicts (compression/resume) early
    //
    // Current implementation (bf-320a):
    // - validateSenderConfig() function available in config-validation.ts
    // - Validation will be integrated when sender configuration is available
    // - For now, this is a placeholder for when sender UI is implemented
    //
    // Future implementation:
    // - When sender configuration exists, validate before session creation
    // - Call: validateSenderConfig({ compressionEnabled, resumeEnabled })
    // - On ConfigurationError: add to errors array for UI display
    // - Continue to health checks even if conflicts exist (non-blocking)
    //
    // Why this location is correct:
    // - Before any state changes (no files written, no sessions created)
    // - Before async operations (runs before health checks and cleanup)
    // - Early validation (fails fast if configuration is invalid)
    // - Non-blocking (can continue to health checks even with conflicts)
    // - Error collection (conflicts added to errors array for UI display)
    //
    // References:
    // - docs/notes/bf-1mj8-validation-insertion-point.md
    // - docs/notes/bf-ft40-sender-initialization-entry-point.md
    // - src/core/frame/beacon.ts:14-31 (compression/resume flag constraint)
    // - docs/notes/bf-17s0-resume-compression-conflict.md
    // ========================================

    // TODO: When sender configuration is available, validate it here:
    // try {
    //   validateSenderConfig({
    //     compressionEnabled: getCompressionConfig(),
    //     resumeEnabled: getResumeConfig()
    //   });
    // } catch (e) {
    //   if (e instanceof ConfigurationError && e.code === 'E-COMPRESSION-RESUME-CONFLICT') {
    //     errors.push('Configuration error: compression and resume cannot both be enabled');
    //   } else {
    //     throw e; // Re-throw other errors
    //   }
    // }

    // Run health check and cleanup in parallel
    const [healthCheckResult, cleanupResult] = await Promise.all([
      runHealthCheck({ skipSlow: true }).catch(e => {
        console.error('[Init] Health check failed:', e);
        errors.push(`Health check: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }),
      runStartupCleanup(new Set()),
    ]);

    const healthCheckPassed = healthCheckResult !== null;
    const orphanedOutputsCleaned = cleanupResult.cleaned;

    // Check if cleanup had any errors
    if (cleanupResult.error) {
      console.error('[Init] Startup cleanup failed:', cleanupResult.error);
      errors.push(`Startup cleanup: ${cleanupResult.error}`);
    }

    const duration = performance.now() - start;
    console.log(`[Init] Initialization complete in ${duration.toFixed(0)}ms`);
    console.log(`[Init] Health check: ${healthCheckPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`[Init] Orphaned outputs cleaned: ${orphanedOutputsCleaned}`);

    if (errors.length > 0) {
      console.warn('[Init] Initialization errors:', errors);
    }

    return {
      healthCheckPassed,
      orphanedOutputsCleaned,
      errors,
    };
  } catch (e) {
    console.error('[Init] Initialization failed:', e);
    return {
      healthCheckPassed: false,
      orphanedOutputsCleaned: 0,
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

  if (result.orphanedOutputsCleaned > 0) {
    parts.push(`✓ Cleaned up ${result.orphanedOutputsCleaned} orphaned file(s)`);
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

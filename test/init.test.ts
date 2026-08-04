/**
 * Unit tests for app initialization.
 *
 * Tests startup initialization including health checks and cleanup (bf-ho40).
 * Tests fire-and-forget async cleanup integration (bf-5w1x).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runAppInit, formatInitStatus, initSuccessful } from '../src/platform/init.js';

// Mock health check
vi.mock('../src/platform/health-check.js', () => ({
  runHealthCheck: vi.fn(async () => ({
    storage: { available: true },
    camera: { available: true },
    wakeLock: { available: true },
    opfs: { available: true },
    geBenchmark: { available: true, kMax: 512 },
    calibration: { lumaWins: null },
    timestamp: Date.now(),
  })),
}));

// Mock storage cleanup with fire-and-forget behavior
vi.mock('../src/platform/storage.js', () => ({
  runStartupCleanup: vi.fn(async () => ({ orphansFound: 0, cleanupStarted: false, error: undefined })),
}));

describe('runAppInit()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs health check and starts cleanup in background', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    const { runStartupCleanup } = await import('../src/platform/storage.js');

    const result = await runAppInit();

    expect(runHealthCheck).toHaveBeenCalledWith({ skipSlow: true });
    expect(runStartupCleanup).toHaveBeenCalledWith(new Set(), true);
    expect(result.healthCheckPassed).toBe(true);
  });

  it('returns orphans found from storage scan', async () => {
    const { runStartupCleanup } = await import('../src/platform/storage.js');
    vi.mocked(runStartupCleanup).mockResolvedValue({ orphansFound: 3, cleanupStarted: true, error: undefined });

    const result = await runAppInit();

    expect(result.orphansFound).toBe(3);
    expect(result.cleanupStarted).toBe(true);
  });

  it('handles health check failure gracefully', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Camera not available'));

    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(false);
    expect(result.errors).toContain('Health check: Camera not available');
  });

  it('handles cleanup scan failure gracefully', async () => {
    const { runStartupCleanup } = await import('../src/platform/storage.js');
    vi.mocked(runStartupCleanup).mockResolvedValue({ orphansFound: 0, cleanupStarted: false, error: 'Storage error' });

    const result = await runAppInit();

    expect(result.errors).toContain('Startup cleanup scan: Storage error');
  });

  it('collects multiple errors', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    const { runStartupCleanup } = await import('../src/platform/storage.js');

    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Health check failed'));
    vi.mocked(runStartupCleanup).mockResolvedValue({ orphansFound: 0, cleanupStarted: false, error: 'Cleanup failed' });

    const result = await runAppInit();

    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('Health check: Health check failed');
    expect(result.errors).toContain('Startup cleanup scan: Cleanup failed');
  });

  it('returns successful result when all checks pass', async () => {
    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(true);
    expect(result.orphansFound).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles complete initialization failure', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Critical failure'));

    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(false);
    expect(result.orphansFound).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('logs initialization results including fire-and-forget cleanup', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runAppInit();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Starting app initialization'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Initialization complete'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Health check: PASSED'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Background cleanup'));

    consoleSpy.mockRestore();
  });
});

describe('formatInitStatus()', () => {
  it('formats successful initialization', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 2,
      cleanupStarted: true,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✓ System check passed');
    expect(status).toContain('✓ Cleaning up 2 orphaned file(s) in background');
    expect(status).not.toContain('⚠');
  });

  it('formats failed health check', () => {
    const result = {
      healthCheckPassed: false,
      orphansFound: 0,
      cleanupStarted: false,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✗ System check failed');
  });

  it('formats with errors', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 0,
      cleanupStarted: false,
      errors: ['Error 1', 'Error 2'],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('⚠ 2 error(s)');
  });

  it('formats zero cleanup', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 0,
      cleanupStarted: false,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).not.toContain('Cleaning up');
  });

  it('combines all status elements', () => {
    const result = {
      healthCheckPassed: false,
      orphansFound: 5,
      cleanupStarted: true,
      errors: ['Camera error', 'Storage error'],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✗ System check failed');
    expect(status).toContain('✓ Cleaning up 5 orphaned file(s) in background');
    expect(status).toContain('⚠ 2 error(s)');
  });
});

describe('initSuccessful()', () => {
  it('returns true when health check passes and no errors', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 0,
      cleanupStarted: false,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(true);
  });

  it('returns false when health check fails', () => {
    const result = {
      healthCheckPassed: false,
      orphansFound: 0,
      cleanupStarted: false,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns false when there are errors', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 0,
      cleanupStarted: false,
      errors: ['Some error'],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns false when both health check fails and there are errors', () => {
    const result = {
      healthCheckPassed: false,
      orphansFound: 0,
      cleanupStarted: false,
      errors: ['Error 1'],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns true even with orphaned files cleaned', () => {
    const result = {
      healthCheckPassed: true,
      orphansFound: 5,
      cleanupStarted: true,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(true);
  });
});

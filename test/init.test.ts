/**
 * Unit tests for app initialization.
 *
 * Tests startup initialization including health checks and cleanup (bf-ho40).
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

// Mock storage cleanup
vi.mock('../src/platform/storage.js', () => ({
  runStartupCleanup: vi.fn(async () => ({ cleaned: 0, error: undefined })),
}));

describe('runAppInit()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs health check and cleanup in parallel', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    const { runStartupCleanup } = await import('../src/platform/storage.js');

    const result = await runAppInit();

    expect(runHealthCheck).toHaveBeenCalledWith({ skipSlow: true });
    expect(runStartupCleanup).toHaveBeenCalledWith(new Set());
    expect(result.healthCheckPassed).toBe(true);
  });

  it('returns cleanup count from storage', async () => {
    const { runStartupCleanup } = await import('../src/platform/storage.js');
    vi.mocked(runStartupCleanup).mockResolvedValue({ cleaned: 3, error: undefined });

    const result = await runAppInit();

    expect(result.orphanedOutputsCleaned).toBe(3);
  });

  it('handles health check failure gracefully', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Camera not available'));

    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(false);
    expect(result.errors).toContain('Health check: Camera not available');
  });

  it('handles cleanup failure gracefully', async () => {
    const { runStartupCleanup } = await import('../src/platform/storage.js');
    vi.mocked(runStartupCleanup).mockResolvedValue({ cleaned: 0, error: 'Storage error' });

    const result = await runAppInit();

    expect(result.errors).toContain('Startup cleanup: Storage error');
  });

  it('collects multiple errors', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    const { runStartupCleanup } = await import('../src/platform/storage.js');

    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Health check failed'));
    vi.mocked(runStartupCleanup).mockResolvedValue({ cleaned: 0, error: 'Cleanup failed' });

    const result = await runAppInit();

    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('Health check: Health check failed');
    expect(result.errors).toContain('Startup cleanup: Cleanup failed');
  });

  it('returns successful result when all checks pass', async () => {
    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(true);
    expect(result.orphanedOutputsCleaned).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles complete initialization failure', async () => {
    const { runHealthCheck } = await import('../src/platform/health-check.js');
    vi.mocked(runHealthCheck).mockRejectedValue(new Error('Critical failure'));

    const result = await runAppInit();

    expect(result.healthCheckPassed).toBe(false);
    expect(result.orphanedOutputsCleaned).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('logs initialization results', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runAppInit();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Starting app initialization'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Initialization complete'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Init] Health check: PASSED'));

    consoleSpy.mockRestore();
  });
});

describe('formatInitStatus()', () => {
  it('formats successful initialization', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 2,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✓ System check passed');
    expect(status).toContain('✓ Cleaned up 2 orphaned file(s)');
    expect(status).not.toContain('⚠');
  });

  it('formats failed health check', () => {
    const result = {
      healthCheckPassed: false,
      orphanedOutputsCleaned: 0,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✗ System check failed');
  });

  it('formats with errors', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 0,
      errors: ['Error 1', 'Error 2'],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('⚠ 2 error(s)');
  });

  it('formats zero cleanup', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 0,
      errors: [],
    };

    const status = formatInitStatus(result);

    expect(status).not.toContain('Cleaned up');
  });

  it('combines all status elements', () => {
    const result = {
      healthCheckPassed: false,
      orphanedOutputsCleaned: 5,
      errors: ['Camera error', 'Storage error'],
    };

    const status = formatInitStatus(result);

    expect(status).toContain('✗ System check failed');
    expect(status).toContain('✓ Cleaned up 5 orphaned file(s)');
    expect(status).toContain('⚠ 2 error(s)');
  });
});

describe('initSuccessful()', () => {
  it('returns true when health check passes and no errors', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 0,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(true);
  });

  it('returns false when health check fails', () => {
    const result = {
      healthCheckPassed: false,
      orphanedOutputsCleaned: 0,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns false when there are errors', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 0,
      errors: ['Some error'],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns false when both health check fails and there are errors', () => {
    const result = {
      healthCheckPassed: false,
      orphanedOutputsCleaned: 0,
      errors: ['Error 1'],
    };

    expect(initSuccessful(result)).toBe(false);
  });

  it('returns true even with orphaned files cleaned', () => {
    const result = {
      healthCheckPassed: true,
      orphanedOutputsCleaned: 5,
      errors: [],
    };

    expect(initSuccessful(result)).toBe(true);
  });
});

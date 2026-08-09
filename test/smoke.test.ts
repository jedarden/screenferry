/**
 * Smoke test to verify test runner configuration.
 *
 * This is a minimal test that verifies:
 * - Test runner is properly configured
 * - Test discovery works
 * - No environment-related errors
 * - Test runner accepts the configuration
 */

import { describe, it, expect } from 'vitest';

describe('Smoke Tests', () => {
  it('should verify test runner is configured', () => {
    expect(true).toBe(true);
  });

  it('should verify test environment is available', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('should verify OPFS mock is available', () => {
    expect(typeof navigator.storage).toBe('object');
    expect(typeof navigator.storage.getDirectory).toBe('function');
  });

  it('should verify MediaStream mock is available', () => {
    expect(typeof navigator.mediaDevices).toBe('object');
    expect(typeof navigator.mediaDevices.getUserMedia).toBe('function');
  });

  it('should verify canvas mock is available', () => {
    expect(typeof HTMLCanvasElement).toBe('function');
    const canvas = document.createElement('canvas');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });
});

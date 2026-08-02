/**
 * Core parameters tests.
 *
 * Tests for constants and validation functions in src/core/params.ts,
 * particularly K validation tied to D26 (sender-side K selection) and
 * I6a (1 MB block-layer working set constraint).
 */

import {describe, it, expect} from 'vitest';
import {
  K,
  L,
  PACKET,
  BLOCK,
  K_MAX,
  validateK,
  MIN_LT_K,
} from '../src/core/params.js';

describe('Core Parameters', () => {
  describe('Constants', () => {
    it('has correct default K per D19', () => {
      expect(K).toBe(768);
    });

    it('has correct fragment length L', () => {
      expect(L).toBe(256);
    });

    it('derives packet size correctly', () => {
      expect(PACKET).toBe(269); // 13 header + 256 payload
    });

    it('derives block size correctly', () => {
      expect(BLOCK).toBe(196608); // 768 * 256
    });

    it('has K_MAX respecting I6a constraint', () => {
      expect(K_MAX).toBe(2048);

      // Verify K_MAX stays at or under 1 MB working set (matrix + block)
      const workingSet = (K_MAX * K_MAX) / 8 + K_MAX * L;
      const limitMB = 1;
      const actualMB = workingSet / 1_048_576;

      expect(actualMB).toBeLessThanOrEqual(limitMB);
      expect(actualMB).toBeCloseTo(1.00, 2); // Exactly 1 MB
    });

    it('has minimum LT K constant', () => {
      expect(MIN_LT_K).toBe(8);
    });
  });

  describe('validateK()', () => {
    it('accepts default K=768', () => {
      expect(validateK(768)).toBe(768);
    });

    it('accepts conservative values below default', () => {
      expect(validateK(512)).toBe(512);
      expect(validateK(256)).toBe(256);
      expect(validateK(128)).toBe(128);
    });

    it('accepts desktop-optimized K up to K_MAX', () => {
      expect(validateK(1024)).toBe(1024);
      expect(validateK(1152)).toBe(1152); // plan.md §3.1 K_max (CPU bound)
      expect(validateK(1408)).toBe(1408); // K_MAX (I6a memory bound)
    });

    it('rejects K that would breach I6a memory limit', () => {
      expect(() => validateK(1536)).toThrow(/K=1536 exceeds I6a's 1 MB/);
      expect(() => validateK(1536)).toThrow(/1.08 MB/);
      expect(() => validateK(1536)).toThrow(/exceeds I6a/);
    });

    it('rejects extremely large K with clear error message', () => {
      // K=2048 as mentioned in the task description
      expect(() => validateK(2048)).toThrow();

      const error = (() => {
        try {
          validateK(2048);
        } catch (e) {
          return e;
        }
      })();

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toMatch(/K=2048/);
      expect(error?.message).toMatch(/exceeds I6a's 1 MB/);
      expect(error?.message).toMatch(/2.04 MB/); // approximate working set
      expect(error?.message).toMatch(/Matrix:/);
      expect(error?.message).toMatch(/Block:/);
      expect(error?.message).toMatch(/Output:/);
    });

    it('rejects K below minimum for LT code', () => {
      expect(() => validateK(7)).toThrow(/K=7 is below minimum/);
      expect(() => validateK(1)).toThrow(/below minimum/);
      expect(() => validateK(0)).toThrow(/below minimum/);
    });

    it('rejects invalid fragment length', () => {
      expect(() => validateK(768, 128)).toThrow(/Fragment length L=128 is not supported/);
      expect(() => validateK(768, 512)).toThrow(/Fragment length L=512 is not supported/);
    });

    it('provides actionable error message for recovery', () => {
      expect(() => validateK(2048)).toThrow();

      try {
        validateK(2048);
      } catch (e) {
        expect(e.message).toMatch(/Use the default K=768/);
        expect(e.message).toMatch(/reduce K to ≤1408/);
        expect(e.message).toMatch(/desktop receivers/);
      }
    });

    it('calculates working set correctly in error message', () => {
      try {
        validateK(2048);
      } catch (e) {
        const msg = e.message;

        // At K=2048, L=256:
        // Matrix = 2048²/8 = 524,288 bytes = 512 KB
        // Block = 2048*256 = 524,288 bytes = 512 KB
        // Output = 2048*256 = 524,288 bytes = 512 KB
        // Total = 1,572,864 bytes = 1.50 MB

        expect(msg).toMatch(/Matrix: 512\.0 KB/);
        expect(msg).toMatch(/Block: 512\.0 KB/);
        expect(msg).toMatch(/Output: 512\.0 KB/);
      }
    });

    it('allows boundary values', () => {
      // Test exact boundary at K_MAX
      expect(validateK(K_MAX)).toBe(K_MAX);

      // Test minimum allowed
      expect(validateK(MIN_LT_K)).toBe(MIN_LT_K);
    });

    it('handles K values that satisfy both CPU and memory constraints', () => {
      // K=1152 is plan.md §3.1 K_max (CPU bound at Stage 3)
      // It should also satisfy memory constraint
      const kCpuMax = 1152;
      const result = validateK(kCpuMax);

      expect(result).toBe(kCpuMax);

      // Verify it's under memory limit
      const workingSet = (kCpuMax * kCpuMax) / 8 + 2 * kCpuMax * L;
      expect(workingSet).toBeLessThan(1_048_576); // 1 MB
    });
  });

  describe('D26 sender-side desktop override', () => {
    it('allows higher K for desktop receivers within K_MAX', () => {
      // Simulate a sender that knows the receiver is a desktop
      const desktopK = 1024;

      // Should validate successfully
      expect(validateK(desktopK)).toBe(desktopK);
    });

    it('prevents D26 override from breaching I6a', () => {
      // Even for desktop receivers, K_MAX is the hard limit
      const tooHigh = 1536;

      expect(() => validateK(tooHigh)).toThrow(/I6a/);
      expect(() => validateK(tooHigh)).toThrow(/1.08 MB/);
    });

    it('provides clear guidance for D26 override failures', () => {
      try {
        validateK(2048);
      } catch (e) {
        expect(e.message).toMatch(/D26/);
        expect(e.message).toMatch(/desktop.*override/);
      }
    });
  });

  describe('I6a memory constraint', () => {
    it('K_MAX yields working set just under 1 MB', () => {
      const workingSet = (K_MAX * K_MAX) / 8 + 2 * K_MAX * L;
      const limitMB = 1;

      expect(workingSet).toBeLessThan(limitMB * 1_048_576);
      expect(workingSet / 1_048_576).toBeCloseTo(0.97, 1); // ~97% of 1 MB
    });

    it('next K after K_MAX would exceed 1 MB', () => {
      const nextK = K_MAX + 128; // Next reasonable increment
      const workingSet = (nextK * nextK) / 8 + 2 * nextK * L;
      const limitMB = 1;

      expect(workingSet).toBeGreaterThan(limitMB * 1_048_576);
    });

    it('default K=768 has comfortable memory margin', () => {
      const workingSet = (K * K) / 8 + 2 * K * L;
      const limitMB = 1;
      const utilizationMB = workingSet / 1_048_576;

      // Should use significantly less than 1 MB
      expect(utilizationMB).toBeLessThan(0.5); // Less than 50%
      expect(utilizationMB).toBeCloseTo(0.264, 2); // ~264 KB per plan.md
    });
  });

  describe('Wire version constraints', () => {
    it('requires L=256 for wire version 1', () => {
      expect(() => validateK(768, 128)).toThrow();
      expect(() => validateK(768, 512)).toThrow();
      expect(validateK(768, 256)).toBe(768);
    });
  });
});

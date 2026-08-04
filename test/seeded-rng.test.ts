/**
 * Tests for deterministic seeded random number generator.
 *
 * Validates PCG-based PRNG for reproducible synthetic data generation.
 * Tests seed control, determinism, environment variable support, and
 * statistical properties.
 *
 * Reference: plan.md §8.1
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  SeededRng,
  SEED_ENV_VAR,
  DEFAULT_SEED,
  verifyDeterminism,
  selfTest,
  seedFromString,
  getGlobalSeed,
  setGlobalSeed,
} from '../src/core/block/seeded-rng.js';
import {
  generatePayload,
  generateSyntheticSequence,
} from '../src/core/block/synthetic-test-schema.js';

describe('Seeded RNG', () => {
  describe('Constructor and initialization', () => {
    it('should create RNG with default seed', () => {
      const rng = new SeededRng();
      expect(rng.seed).toBe(DEFAULT_SEED);
    });

    it('should create RNG with explicit seed', () => {
      const seed = 12345;
      const rng = new SeededRng(seed);
      expect(rng.seed).toBe(seed);
    });

    it('should handle zero seed', () => {
      const rng = new SeededRng(0);
      expect(rng.seed).toBe(0);
    });

    it('should handle negative seeds (treated as unsigned)', () => {
      const rng = new SeededRng(-1);
      // -1 as unsigned 32-bit is 0xFFFFFFFF
      expect(rng.seed).toBe(0xffffffff);
    });

    it('should handle large seeds (truncated to 32-bit)', () => {
      const rng = new SeededRng(0x1_0000_0000); // 2^32
      expect(rng.seed).toBe(0);
    });
  });

  describe('Seed getter/setter', () => {
    it('should get current seed', () => {
      const seed = 999;
      const rng = new SeededRng(seed);
      expect(rng.seed).toBe(seed);
    });

    it('should set new seed and reinitialize', () => {
      const rng = new SeededRng(100);
      const value1 = rng.nextUint32();

      rng.seed = 200;
      expect(rng.seed).toBe(200);

      // New sequence should differ from old
      const value2 = rng.nextUint32();
      expect(value2).not.toBe(value1);
    });

    it('should produce same sequence after reseeding', () => {
      const rng = new SeededRng(42);
      const sequence1 = [
        rng.nextUint32(),
        rng.nextUint32(),
        rng.nextUint32(),
      ];

      rng.seed = 42;
      const sequence2 = [
        rng.nextUint32(),
        rng.nextUint32(),
        rng.nextUint32(),
      ];

      expect(sequence1).toEqual(sequence2);
    });
  });

  describe('Determinism', () => {
    it('should produce bit-identical output with same seed', () => {
      const seed = 12345;
      const rng1 = new SeededRng(seed);
      const rng2 = new SeededRng(seed);

      for (let i = 0; i < 100; i++) {
        expect(rng1.nextUint32()).toBe(rng2.nextUint32());
      }
    });

    it('should produce identical byte sequences', () => {
      const seed = 54321;
      const size = 1000;
      const [bytes1, bytes2] = verifyDeterminism(seed, size);

      expect(bytes1).toEqual(bytes2);
      expect(bytes1.length).toBe(size);
      expect(bytes2.length).toBe(size);
    });

    it('should produce different sequences with different seeds', () => {
      const rng1 = new SeededRng(111);
      const rng2 = new SeededRng(222);

      const sequence1 = rng1.nextBytes(100);
      const sequence2 = rng2.nextBytes(100);

      expect(sequence1).not.toEqual(sequence2);
    });

    it('should be deterministic after clone', () => {
      const rng = new SeededRng(777);
      rng.nextUint32(); // Advance state
      rng.nextUint32();

      const clone = rng.clone();

      expect(clone.seed).toBe(rng.seed);
      expect(clone.nextUint32()).toBe(rng.nextUint32());
      expect(clone.nextUint32()).toBe(rng.nextUint32());
    });
  });

  describe('Uint32 generation', () => {
    it('should generate 32-bit values', () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 1000; i++) {
        const value = rng.nextUint32();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0xffffffff);
      }
    });

    it('should have good entropy distribution', () => {
      const rng = new SeededRng(42);
      const samples = new Array(1000).fill(0).map(() => rng.nextUint32());

      // Check that we get variety (not all same or similar)
      const unique = new Set(samples);
      expect(unique.size).toBeGreaterThan(990); // Should have >99% unique

      // Check bit distribution (should have ~50% ones and zeros in each position)
      const bitCounts = new Array(32).fill(0);
      for (const value of samples) {
        for (let bit = 0; bit < 32; bit++) {
          if ((value >>> bit) & 1) {
            bitCounts[bit]++;
          }
        }
      }

      // Each bit should have 40-60% set rate (allowing some variance)
      for (const count of bitCounts) {
        const ratio = count / samples.length;
        expect(ratio).toBeGreaterThan(0.4);
        expect(ratio).toBeLessThan(0.6);
      }
    });

    it('should produce known sequence for known seed', () => {
      const rng = new SeededRng(42);
      const sequence = [
        rng.nextUint32(),
        rng.nextUint32(),
        rng.nextUint32(),
        rng.nextUint32(),
        rng.nextUint32(),
      ];

      // Precomputed values from seed=42
      const expected = [0xee41d0a3, 0x44b04720, 0x324feb18, 0xfce7ca15, 0x03333eb9];
      expect(sequence).toEqual(expected);
    });
  });

  describe('Bounded Uint32 generation', () => {
    it('should generate values in correct range', () => {
      const rng = new SeededRng(1);
      const max = 100;

      for (let i = 0; i < 1000; i++) {
        const value = rng.nextUint32Bounded(max);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    });

    it('should handle max=1 (always returns 0)', () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        expect(rng.nextUint32Bounded(1)).toBe(0);
      }
    });

    it('should throw on zero or negative max', () => {
      const rng = new SeededRng(1);
      expect(() => rng.nextUint32Bounded(0)).toThrow('max must be positive');
      expect(() => rng.nextUint32Bounded(-1)).toThrow('max must be positive');
    });

    it('should produce uniform distribution without bias', () => {
      const rng = new SeededRng(42);
      const max = 10;
      const counts = new Array(max).fill(0);
      const samples = 10000;

      for (let i = 0; i < samples; i++) {
        const value = rng.nextUint32Bounded(max);
        counts[value]++;
      }

      // Each value should appear roughly 10% of the time (5-15% range)
      for (const count of counts) {
        const ratio = count / samples;
        expect(ratio).toBeGreaterThan(0.05);
        expect(ratio).toBeLessThan(0.15);
      }
    });
  });

  describe('Byte generation', () => {
    it('should generate single bytes', () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 1000; i++) {
        const byte = rng.nextByte();
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(0xff);
      }
    });

    it('should generate byte arrays', () => {
      const rng = new SeededRng(42);
      const bytes = rng.nextBytes(100);

      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(100);

      for (const byte of bytes) {
        expect(byte).toBeGreaterThanOrEqual(0);
        expect(byte).toBeLessThanOrEqual(0xff);
      }
    });

    it('should generate deterministic byte sequences', () => {
      const seed = 123;
      const rng1 = new SeededRng(seed);
      const rng2 = new SeededRng(seed);

      expect(rng1.nextBytes(50)).toEqual(rng2.nextBytes(50));
    });

    it('should handle large byte arrays', () => {
      const rng = new SeededRng(1);
      const size = 100_000;
      const bytes = rng.nextBytes(size);

      expect(bytes.length).toBe(size);
    });

    it('should handle empty array', () => {
      const rng = new SeededRng(1);
      const bytes = rng.nextBytes(0);
      expect(bytes.length).toBe(0);
    });
  });

  describe('Boolean generation', () => {
    it('should generate booleans', () => {
      const rng = new SeededRng(1);
      for (let i = 0; i < 100; i++) {
        const bool = rng.nextBoolean();
        expect(typeof bool).toBe('boolean');
      }
    });

    it('should produce roughly equal true/false distribution', () => {
      const rng = new SeededRng(42);
      let trues = 0;
      const samples = 10000;

      for (let i = 0; i < samples; i++) {
        if (rng.nextBoolean()) trues++;
      }

      const ratio = trues / samples;
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(0.55);
    });

    it('should be deterministic', () => {
      const seed = 777;
      const rng1 = new SeededRng(seed);
      const rng2 = new SeededRng(seed);

      for (let i = 0; i < 100; i++) {
        expect(rng1.nextBoolean()).toBe(rng2.nextBoolean());
      }
    });
  });

  describe('Global instance', () => {
    beforeEach(() => {
      // Reset global before each test
      SeededRng.resetGlobal(42);
    });

    it('should provide global singleton', () => {
      const global1 = SeededRng.global;
      const global2 = SeededRng.global;

      expect(global1).toBe(global2);
    });

    it('should initialize from environment variable', () => {
      const envSeed = 999;
      process.env[SEED_ENV_VAR] = envSeed.toString();

      SeededRng.resetGlobal();
      const global = SeededRng.global;

      expect(global.seed).toBe(envSeed);

      delete process.env[SEED_ENV_VAR];
    });

    it('should use default when env not set', () => {
      delete process.env[SEED_ENV_VAR];

      SeededRng.resetGlobal();
      const global = SeededRng.global;

      expect(global.seed).toBe(DEFAULT_SEED);
    });

    it('should reset global instance', () => {
      const global1 = SeededRng.global;
      const value1 = global1.nextUint32();

      SeededRng.resetGlobal(42);
      const global2 = SeededRng.global;
      const value2 = global2.nextUint32();

      // Same seed should produce same value
      expect(value1).toBe(value2);
    });
  });

  describe('Environment seed sourcing', () => {
    it('should get seed from environment', () => {
      const envSeed = 12345;
      process.env[SEED_ENV_VAR] = envSeed.toString();

      const seed = SeededRng.getSeedFromEnv();
      expect(seed).toBe(envSeed);

      delete process.env[SEED_ENV_VAR];
    });

    it('should use fallback when env not set', () => {
      delete process.env[SEED_ENV_VAR];

      const fallback = 999;
      const seed = SeededRng.getSeedFromEnv(fallback);
      expect(seed).toBe(fallback);
    });

    it('should use default fallback when not provided', () => {
      delete process.env[SEED_ENV_VAR];

      const seed = SeededRng.getSeedFromEnv();
      expect(seed).toBe(DEFAULT_SEED);
    });

    it('should handle invalid env value', () => {
      process.env[SEED_ENV_VAR] = 'not-a-number';

      const fallback = 777;
      const seed = SeededRng.getSeedFromEnv(fallback);
      expect(seed).toBe(fallback);

      delete process.env[SEED_ENV_VAR];
    });
  });

  describe('Global seed getters/setters', () => {
    beforeEach(() => {
      SeededRng.resetGlobal(100);
    });

    it('should get global seed', () => {
      const seed = getGlobalSeed();
      expect(seed).toBe(100);
    });

    it('should set global seed', () => {
      setGlobalSeed(200);
      expect(getGlobalSeed()).toBe(200);
    });

    it('should restart sequence after setting seed', () => {
      const rng = SeededRng.global;
      const value1 = rng.nextUint32();

      setGlobalSeed(100); // Reset to initial seed
      const value2 = rng.nextUint32();

      expect(value1).toBe(value2);
    });
  });

  describe('String seed generation', () => {
    it('should generate seed from string', () => {
      const seed = seedFromString('test-string');
      expect(typeof seed).toBe('number');
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    });

    it('should be deterministic for same string', () => {
      const str = 'deterministic-test';
      const seed1 = seedFromString(str);
      const seed2 = seedFromString(str);

      expect(seed1).toBe(seed2);
    });

    it('should generate different seeds for different strings', () => {
      const seed1 = seedFromString('string-one');
      const seed2 = seedFromString('string-two');

      expect(seed1).not.toBe(seed2);
    });

    it('should handle empty string', () => {
      const seed = seedFromString('');
      expect(typeof seed).toBe('number');
    });

    it('should produce consistent seeds for test IDs', () => {
      const testIds = ['bf-3dxu8', 'bf-2pwam', 'test-case-123'];
      const seeds = testIds.map(id => seedFromString(id));

      // All should be unique
      const unique = new Set(seeds);
      expect(unique.size).toBe(testIds.length);
    });
  });

  describe('Self-test', () => {
    it('should pass all self-tests', () => {
      expect(selfTest()).toBe(true);
    });

    it('should verify known values', () => {
      const rng = new SeededRng(42);
      expect(rng.nextUint32()).toBe(0xee41d0a3);
    });

    it('should verify determinism', () => {
      expect(() => verifyDeterminism(12345, 1000)).not.toThrow();
    });
  });

  describe('Integration with synthetic data', () => {
    it('should work with generatePayload', () => {
      const seed = 42;
      const size = 1000;

      const payload1 = generatePayload(size, 'random', seed);
      const payload2 = generatePayload(size, 'random', seed);

      expect(payload1).toEqual(payload2);
    });

    it('should produce different payloads for different seeds', () => {
      const payload1 = generatePayload(1000, 'random', 111);
      const payload2 = generatePayload(1000, 'random', 222);

      expect(payload1).not.toEqual(payload2);
    });

    it('should work with large synthetic sequences', () => {
      const seed = 999;
      const config = {
        blockCount: 100,
        pattern: 'random' as const,
        seed,
        includeMetadata: true,
      };

      const sequence1 = generateSyntheticSequence(config);
      const sequence2 = generateSyntheticSequence(config);

      // Sequences should be identical
      expect(sequence1.blockCount).toBe(sequence2.blockCount);
      expect(sequence1.totalSize).toBe(sequence2.totalSize);

      // Block payloads should be identical
      for (let i = 0; i < sequence1.blocks.length; i++) {
        expect(sequence1.blocks[i].payload).toEqual(sequence2.blocks[i].payload);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle max 32-bit seed', () => {
      const rng = new SeededRng(0xffffffff);
      expect(() => rng.nextUint32()).not.toThrow();
    });

    it('should handle sequential seeds without correlation', () => {
      const rng1 = new SeededRng(1000);
      const rng2 = new SeededRng(1001);

      const seq1 = rng1.nextBytes(100);
      const seq2 = rng2.nextBytes(100);

      // Should produce different sequences
      expect(seq1).not.toEqual(seq2);

      // Should not be simple permutations
      let equalCount = 0;
      for (let i = 0; i < 100; i++) {
        if (seq1[i] === seq2[i]) equalCount++;
      }
      expect(equalCount).toBeLessThan(20); // Should be mostly different
    });

    it('should handle very large bounded ranges', () => {
      const rng = new SeededRng(1);
      const max = 0x1000; // 4096

      for (let i = 0; i < 1000; i++) {
        const value = rng.nextUint32Bounded(max);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    });

    it('should maintain state across many operations', () => {
      const rng = new SeededRng(42);

      // Perform many operations
      for (let i = 0; i < 10000; i++) {
        rng.nextUint32();
      }

      // State should still be valid
      expect(() => rng.nextUint32()).not.toThrow();
    });
  });
});

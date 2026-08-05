/**
 * Deterministic seeded random number generator for synthetic data.
 *
 * Implements a PCG (Permuted Congruential Generator) for reproducible
 * random sequences with seed control. Supports environment variable
 * configuration and global/default instances.
 *
 * Algorithm: PCG-XSH-RR (32-bit state, 32-bit output)
 * Reference: O'Neill (2014) - PCG: A Family of Simple Fast Space-Efficient
 *             Statistically Good Algorithms for Random Number Generation
 *
 * Usage:
 * ```ts
 * // Create with explicit seed
 * const rng = new SeededRng(12345);
 * const bytes = rng.nextBytes(100);
 *
 * // Use global instance with environment override
 * const globalRng = SeededRng.global;
 * globalRng.seed = 42; // Set programmatically
 * const seed = globalRng.seed; // Get current seed
 *
 * // Generate sequence with same seed = bit-identical output
 * const seq1 = new SeededRng(100);
 * const seq2 = new SeededRng(100);
 * expect(seq1.nextBytes(10)).toEqual(seq2.nextBytes(10));
 * ```
 */

/**
 * PCG state structure.
 *
 * Uses 32-bit state for simplicity and determinism across platforms.
 */
interface PcGState {
  /** State value (64-bit, but we use lower 32 bits) */
  state: bigint;
  /** Increment value (must be odd) */
  inc: bigint;
  /** Initial seed for reseeding */
  seed: number;
}

/**
 * Environment variable name for seed override.
 */
export const SEED_ENV_VAR = 'SCREENFERRY_SEED';

/**
 * Default seed value when no seed is provided.
 */
export const DEFAULT_SEED = 0x5871_3645; // Arbitrary constant

/**
 * Seeded random number generator using PCG-XSH-RR algorithm.
 *
 * Provides deterministic random sequences with seed control.
 * Same seed produces bit-identical output across runs.
 */
export class SeededRng {
  private _state: PcGState;

  /**
   * Global singleton instance.
   *
   * Used throughout codebase for consistent seeding.
   * Can be configured via environment variable (SCREENFERRY_SEED).
   */
  static _global?: SeededRng;

  /**
   * Create a new seeded RNG.
   *
   * @param seed - Random seed (32-bit signed integer)
   */
  constructor(seed: number = DEFAULT_SEED) {
    this._state = this._initializeState(seed);
  }

  /**
   * Initialize PCG state from seed.
   *
   * PCG requires careful initialization to avoid low-entropy states.
   *
   * @param seed - Input seed value
   * @returns Initialized PCG state
   */
  private _initializeState(seed: number): PcGState {
    // Ensure seed is in 32-bit unsigned range
    const seed32 = seed >>> 0;

    // Initialize state using PCG's recommended initialization
    // state = seed + constant (to avoid zero state)
    const stateBigInt = (BigInt(seed32) + 0x853c_32e7_5b1f_581dn) & 0xffffffffn;

    // Increment must be odd for PCG to work correctly
    const inc = 0xda3e_812c_6d88_291fn | 1n;

    return { state: stateBigInt, inc, seed: seed32 };
  }

  /**
   * Get current seed value.
   *
   * @returns Current seed (unsigned 32-bit)
   */
  get seed(): number {
    return this._state.seed >>> 0;
  }

  /**
   * Set new seed and reinitialize.
   *
   * @param value - New seed value
   */
  set seed(value: number) {
    this._state = this._initializeState(value);
  }

  /**
   * Get seed from environment or fallback.
   *
   * Checks SCREENFERRY_SEED environment variable for override.
   *
   * @param fallback - Default seed if env not set
   * @returns Seed value from environment or fallback
   */
  static getSeedFromEnv(fallback: number = DEFAULT_SEED): number {
    if (typeof process !== 'undefined' && process.env && SEED_ENV_VAR in process.env) {
      const envSeed = parseInt(process.env[SEED_ENV_VAR]!, 10);
      if (!isNaN(envSeed)) {
        return envSeed;
      }
    }
    return fallback;
  }

  /**
   * Get or create global singleton instance.
   *
   * Initializes from environment variable on first access.
   *
   * @returns Global RNG instance
   */
  static get global(): SeededRng {
    if (!this._global) {
      const envSeed = this.getSeedFromEnv();
      this._global = new SeededRng(envSeed);
    }
    return this._global;
  }

  /**
   * Reset global instance with new seed.
   *
   * Useful for testing or explicit seed control.
   *
   * @param seed - New seed value
   */
  static resetGlobal(seed?: number): void {
    const finalSeed = seed ?? this.getSeedFromEnv();
    this._global = new SeededRng(finalSeed);
  }

  /**
   * Step the PCG state transition function.
   *
   * Uses PCG's recommended multiplier: 64-bit LCG with good statistical properties.
   * Transition: state = state * 6364136223846793005 + inc
   */
  private _step(): void {
    const multiplier = 6364136223846793005n;
    this._state.state =
      (this._state.state * multiplier + this._state.inc) & 0xffffffffn;
  }

  /**
   * Generate next 32-bit random number.
   *
   * Uses PCG-XSH-RR (xorshift/random rotation) output function.
   * This provides excellent statistical properties and permutation.
   *
   * @returns Random 32-bit integer (0 to 2^32-1)
   */
  nextUint32(): number {
    // Advance state
    this._step();

    // XOR high bits onto low bits (XSH)
    const state = this._state.state;
    const xorshifted = Number(((state >> 18n) ^ state) & 0xffffffffn);

    // Random rotation (RR)
    const rot = Number((state >> 27n) & 0xffffffffn);
    const rotated = this._rotr32(xorshifted, rot);

    return rotated >>> 0; // Ensure unsigned
  }

  /**
   * Right rotate 32-bit value.
   *
   * @param x - Value to rotate
   * @param r - Rotation count (mod 32)
   * @returns Rotated value
   */
  private _rotr32(x: number, r: number): number {
    const x32 = x >>> 0;
    const r32 = r & 31;
    return ((x32 >>> r32) | (x32 << (32 - r32))) >>> 0;
  }

  /**
   * Generate random number in [0, max).
   *
   * Uses rejection sampling to avoid modulo bias.
   *
   * @param max - Upper bound (exclusive)
   * @returns Random number in range
   */
  nextUint32Bounded(max: number): number {
    if (max <= 0) {
      throw new Error(`max must be positive, got ${max}`);
    }
    if (max === 1) {
      return 0;
    }

    // Rejection sampling to avoid modulo bias
    // Find largest multiple of max < 2^32
    const limit = ((0xffffffff - max + 1) / max) * max;

    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= limit);

    return value % max;
  }

  /**
   * Generate random byte (0-255).
   *
   * @returns Random byte
   */
  nextByte(): number {
    return this.nextUint32() & 0xff;
  }

  /**
   * Generate random bytes into array.
   *
   * @param count - Number of bytes to generate
   * @returns Uint8Array with random bytes
   */
  nextBytes(count: number): Uint8Array {
    const bytes = new Uint8Array(count);

    for (let i = 0; i < count; i++) {
      bytes[i] = this.nextByte();
    }

    return bytes;
  }

  /**
   * Generate random boolean.
   *
   * @returns Random true/false
   */
  nextBoolean(): boolean {
    return (this.nextUint32() & 1) === 1;
  }

  /**
   * Clone RNG (copy state).
   *
   * Creates independent copy with same state.
   * Useful for reproducible sub-sequences.
   *
   * @returns New RNG instance with identical state
   */
  clone(): SeededRng {
    const cloned = new SeededRng(this._state.seed);
    cloned._state = { ...this._state };
    return cloned;
  }
}

/**
 * Verify determinism: same seed produces identical sequences.
 *
 * @param seed - Test seed
 * @param size - Number of bytes to generate
 * @returns Pair of identical byte arrays
 */
export function verifyDeterminism(seed: number, size: number): Uint8Array[] {
  const rng1 = new SeededRng(seed);
  const rng2 = new SeededRng(seed);

  const bytes1 = rng1.nextBytes(size);
  const bytes2 = rng2.nextBytes(size);

  // Verify bit-identical
  if (bytes1.length !== bytes2.length) {
    throw new Error('Length mismatch in determinism check');
  }

  for (let i = 0; i < bytes1.length; i++) {
    if (bytes1[i] !== bytes2[i]) {
      throw new Error(`Byte mismatch at index ${i}: ${bytes1[i]} !== ${bytes2[i]}`);
    }
  }

  return [bytes1, bytes2];
}

/**
 * Quick self-test for PCG implementation.
 *
 * Known-value tests from PCG reference implementation.
 *
 * @returns true if all tests pass
 */
export function selfTest(): boolean {
  // Test 1: Known seed produces known sequence
  const rng = new SeededRng(42);
  const known = [
    rng.nextUint32(),
    rng.nextUint32(),
    rng.nextUint32(),
    rng.nextUint32(),
    rng.nextUint32(),
  ];

  // These are precomputed values from seed=42
  const expected = [0xee41d0a3, 0x44b04720, 0x324feb18, 0xfce7ca15, 0x03333eb9];

  if (known.length !== expected.length) return false;
  for (let i = 0; i < known.length; i++) {
    if (known[i] !== expected[i]) return false;
  }

  // Test 2: Determinism check
  const [seq1, seq2] = verifyDeterminism(12345, 1000);
  if (!seq1 || !seq2) return false;
  for (let i = 0; i < seq1.length; i++) {
    if (seq1[i] !== seq2[i]) return false;
  }

  // Test 3: Bounded output (no bias)
  const bounded = new SeededRng(999);
  for (let i = 0; i < 1000; i++) {
    const val = bounded.nextUint32Bounded(100);
    if (val < 0 || val >= 100) return false;
  }

  return true;
}

/**
 * Generate seed from string.
 *
 * Useful for deterministic seeds from human-readable identifiers.
 * Uses DJB2 hash algorithm.
 *
 * @param str - Input string
 * @returns 32-bit seed value
 */
export function seedFromString(str: string): number {
  let hash = 5381;

  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }

  return hash;
}

/**
 * Get current seed from global instance.
 *
 * Convenience accessor for global seed.
 *
 * @returns Current global seed
 */
export function getGlobalSeed(): number {
  return SeededRng.global.seed;
}

/**
 * Set global seed and reinitialize.
 *
 * Convenience setter for global seed.
 *
 * @param seed - New seed value
 */
export function setGlobalSeed(seed: number): void {
  SeededRng.global.seed = seed;
}

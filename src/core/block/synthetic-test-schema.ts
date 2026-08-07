/**
 * Synthetic test data schema for encode→decode validation.
 *
 * Defines data structures for generating synthetic test sequences used in
 * roundtrip validation testing. Supports 100-1000 block sequences with
 * configurable payloads and metadata.
 *
 * Schema Design:
 * - BlockSequence: Container for synthetic test blocks
 * - SyntheticBlock: Individual block with ID, payload, and metadata
 * - BlockMetadata: Optional metadata for test verification
 * - SequenceConfig: Configuration for sequence generation
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { L, BLOCK } from '../params.js';
import { SeededRng, SEED_ENV_VAR } from './seeded-rng.js';

/**
 * Synthetic block metadata for verification.
 *
 * Optional metadata attached to blocks for test validation and
 * roundtrip verification.
 */
export interface SyntheticBlockMetadata {
  /** Block creation timestamp */
  createdAt: number;
  /** Test pattern identifier for verification */
  patternType?: 'sequential' | 'random' | 'patterned' | 'zero' | 'max';
  /** Expected checksum for validation */
  expectedChecksum?: number;
  /** Test annotations */
  annotations?: string[];
}

/**
 * Synthetic block for encode→decode testing.
 *
 * Represents a single test block with payload and optional metadata.
 * Used in synthetic test sequences for validation.
 */
export interface SyntheticBlock {
  /** Unique block identifier (0-based index) */
  blockId: number;
  /** Block payload data */
  payload: Uint8Array;
  /** Optional metadata for test verification */
  metadata?: SyntheticBlockMetadata;
}

/**
 * Synthetic block sequence for batch testing.
 *
 * Container for synthetic test sequences supporting 100-1000 blocks.
 * Used for roundtrip validation and stress testing.
 */
export interface SyntheticBlockSequence {
  /** Unique sequence identifier */
  sequenceId: string;
  /** Block sequence (ordered by blockId) */
  blocks: SyntheticBlock[];
  /** Total size in bytes */
  totalSize: number;
  /** Block count */
  blockCount: number;
  /** Sequence creation timestamp */
  createdAt: number;
  /** Sequence configuration */
  config: SequenceConfig;
}

/**
 * Configuration for synthetic sequence generation.
 *
 * Defines constraints and parameters for generating test sequences.
 */
export interface SequenceConfig {
  /** Number of blocks to generate (100-1000) */
  blockCount: number;
  /** Block size in bytes (default: BLOCK = 192 KB) */
  blockSize?: number;
  /** Fragment length L (default: 256) */
  fragmentLen?: number;
  /** Payload generation pattern */
  pattern: 'sequential' | 'random' | 'patterned' | 'zero' | 'max';
  /** Include metadata in blocks */
  includeMetadata?: boolean;
  /** Custom block ID start (default: 0) */
  startBlockId?: number;
  /** Seed for random generation (reproducibility) */
  seed?: number;
  /** Corruption rate for fault injection (0-1) */
  corruptionRate?: number;
}

/**
 * Statistics for synthetic sequence validation.
 *
 * Metrics collected during encode→decode validation testing.
 */
export interface SequenceValidationStats {
  /** Total blocks in sequence */
  totalBlocks: number;
  /** Blocks successfully encoded */
  blocksEncoded: number;
  /** Blocks successfully decoded */
  blocksDecoded: number;
  /** Blocks that failed encoding */
  encodeFailures: number;
  /** Blocks that failed decoding */
  decodeFailures: number;
  /** Bytes processed */
  totalBytes: number;
  /** Validation duration in milliseconds */
  duration: number;
  /** Checksum validation passed */
  checksumValid: boolean;
  /** Corruption detected */
  corruptionDetected: number;
}

/**
 * Result from sequence validation test.
 *
 * Returned after running encode→decode validation on a synthetic sequence.
 */
export interface SequenceValidationResult {
  /** Test passed */
  success: boolean;
  /** Validation statistics */
  stats: SequenceValidationStats;
  /** Failed block IDs */
  failedBlocks: number[];
  /** Validation errors */
  errors: string[];
  /** Decoded data (if successful) */
  decodedData?: Uint8Array;
}

/**
 * Size constraints for synthetic sequences.
 *
 * Documents memory and size limits for different sequence scales.
 */
export const SEQUENCE_SIZE_LIMITS = {
  /** Minimum blocks per sequence */
  MIN_BLOCKS: 100,
  /** Maximum blocks per sequence */
  MAX_BLOCKS: 1000,
  /** Default block size (192 KB) */
  DEFAULT_BLOCK_SIZE: BLOCK,
  /** Minimum fragment length */
  MIN_FRAGMENT_LEN: L,
  /** Maximum sequence size at 1000 blocks (192 MB) */
  MAX_SEQUENCE_SIZE: 1000 * BLOCK,
  /** Maximum sequence size at 100 blocks (19.2 MB) */
  MIN_SEQUENCE_SIZE: 100 * BLOCK,
} as const;

/**
 * Validation patterns for synthetic data.
 *
 * Supported payload patterns for test generation.
 */
export const VALIDATION_PATTERNS = {
  /** Sequential bytes (0, 1, 2, ..., 255, 0, 1, ...) */
  SEQUENTIAL: 'sequential' as const,
  /** Random bytes using seed */
  RANDOM: 'random' as const,
  /** Patterned repetition (ABCDABCD...) */
  PATTERNED: 'patterned' as const,
  /** All zeros (0x00) */
  ZERO: 'zero' as const,
  /** All max (0xFF) */
  MAX: 'max' as const,
} as const;

/**
 * Generate synthetic block sequence for testing.
 *
 * Creates a SyntheticBlockSequence with configured block count and pattern.
 * Supports 100-1000 blocks with configurable payloads.
 *
 * @param config - Sequence configuration
 * @returns Synthetic block sequence
 *
 * @example
 * ```ts
 * const sequence = generateSyntheticSequence({
 *   blockCount: 500,
 *   pattern: 'sequential',
 *   includeMetadata: true,
 * });
 * ```
 */
export function generateSyntheticSequence(
  config: SequenceConfig
): SyntheticBlockSequence {
  // Validate block count range
  if (config.blockCount < SEQUENCE_SIZE_LIMITS.MIN_BLOCKS) {
    throw new Error(
      `blockCount must be at least ${SEQUENCE_SIZE_LIMITS.MIN_BLOCKS}, got ${config.blockCount}`
    );
  }
  if (config.blockCount > SEQUENCE_SIZE_LIMITS.MAX_BLOCKS) {
    throw new Error(
      `blockCount must be at most ${SEQUENCE_SIZE_LIMITS.MAX_BLOCKS}, got ${config.blockCount}`
    );
  }

  const blockSize = config.blockSize ?? SEQUENCE_SIZE_LIMITS.DEFAULT_BLOCK_SIZE;
  const fragmentLen = config.fragmentLen ?? SEQUENCE_SIZE_LIMITS.MIN_FRAGMENT_LEN;
  const startBlockId = config.startBlockId ?? 0;
  const seed = config.seed ?? Date.now();

  const blocks: SyntheticBlock[] = [];
  let totalSize = 0;

  // Generate blocks
  for (let i = 0; i < config.blockCount; i++) {
    const blockId = startBlockId + i;
    const payload = generatePayload(blockSize, config.pattern, seed + i);

    const block: SyntheticBlock = { blockId, payload };
    if (config.includeMetadata) {
      block.metadata = {
        createdAt: Date.now(),
        patternType: config.pattern,
        expectedChecksum: calculateChecksum(payload),
      };
    }

    blocks.push(block);
    totalSize += payload.length;
  }

  return {
    sequenceId: generateSequenceId(seed),
    blocks,
    totalSize,
    blockCount: config.blockCount,
    createdAt: Date.now(),
    config: { ...config, blockSize, fragmentLen, startBlockId, seed },
  };
}

/**
 * Generate payload data with specified pattern.
 *
 * @param size - Payload size in bytes
 * @param pattern - Generation pattern
 * @param seed - Random seed
 * @returns Generated payload
 */
export function generatePayload(
  size: number,
  pattern: SequenceConfig['pattern'],
  seed: number
): Uint8Array {
  const payload = new Uint8Array(size);

  switch (pattern) {
    case VALIDATION_PATTERNS.SEQUENTIAL:
      for (let i = 0; i < size; i++) {
        payload[i] = i & 0xff;
      }
      break;

    case VALIDATION_PATTERNS.ZERO:
      payload.fill(0);
      break;

    case VALIDATION_PATTERNS.MAX:
      payload.fill(0xff);
      break;

    case VALIDATION_PATTERNS.PATTERNED:
      // Repeating 4-byte pattern: 0xDE 0xAD 0xBE 0xEF
      const patternBytes = [0xde, 0xad, 0xbe, 0xef] as const;
      for (let i = 0; i < size; i++) {
        payload[i] = patternBytes[i % 4]!;
      }
      break;

    case VALIDATION_PATTERNS.RANDOM:
      // Use deterministic seeded PRNG (PCG)
      const rng = new SeededRng(seed);
      const randomBytes = rng.nextBytes(size);
      payload.set(randomBytes);
      break;
  }

  return payload;
}

/**
 * Calculate simple checksum for payload verification.
 *
 * @param payload - Payload data
 * @returns Checksum value
 */
export function calculateChecksum(payload: Uint8Array): number {
  let checksum = 0;
  for (let i = 0; i < payload.length; i++) {
    checksum = (checksum + payload[i]!) & 0xffffffff;
  }
  return checksum;
}

/**
 * Generate test flags for fault injection.
 *
 * NOTE: Currently unused but kept for future fault injection testing.
 *
 * @param corruptionRate - Corruption probability (0-1)
 * @returns Test flags
 */
/*
export function generateTestFlags(corruptionRate: number) {
  if (corruptionRate <= 0) return undefined;

  const shouldCorrupt = Math.random() < corruptionRate;
  if (!shouldCorrupt) return undefined;

  return {
    isCorrupt: Math.random() < 0.5,
    isDuplicate: Math.random() < 0.3,
  };
}
*/

/**
 * Generate unique sequence ID.
 *
 * @param seed - Random seed
 * @returns Sequence ID
 */
export function generateSequenceId(seed: number): string {
  const timestamp = Date.now().toString(16);
  const hash = (seed >>> 0).toString(16);
  return `synth-${timestamp}-${hash}`;
}

/**
 * Validate synthetic sequence integrity.
 *
 * Checks that sequence meets constraints and data integrity.
 *
 * @param sequence - Sequence to validate
 * @returns true if valid
 */
export function validateSyntheticSequence(sequence: SyntheticBlockSequence): boolean {
  // Check block count
  if (sequence.blockCount < SEQUENCE_SIZE_LIMITS.MIN_BLOCKS ||
      sequence.blockCount > SEQUENCE_SIZE_LIMITS.MAX_BLOCKS) {
    return false;
  }

  // Check blocks array matches count
  if (sequence.blocks.length !== sequence.blockCount) {
    return false;
  }

  // Check total size calculation
  const calculatedSize = sequence.blocks.reduce((sum, block) => sum + block.payload.length, 0);
  if (calculatedSize !== sequence.totalSize) {
    return false;
  }

  // Verify metadata checksums if present
  for (const block of sequence.blocks) {
    if (block.metadata?.expectedChecksum !== undefined) {
      const actualChecksum = calculateChecksum(block.payload);
      if (actualChecksum !== block.metadata.expectedChecksum) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Create a minimal synthetic block for quick tests.
 *
 * Utility function for creating single blocks in test fixtures.
 *
 * @param blockId - Block identifier
 * @param size - Payload size (default: BLOCK)
 * @param pattern - Generation pattern (default: sequential)
 * @returns Synthetic block
 */
export function createSyntheticBlock(
  blockId: number,
  size: number = BLOCK,
  pattern: SequenceConfig['pattern'] = VALIDATION_PATTERNS.SEQUENTIAL
): SyntheticBlock {
  const payload = generatePayload(size, pattern, blockId);

  return {
    blockId,
    payload,
    metadata: {
      createdAt: Date.now(),
      patternType: pattern,
      expectedChecksum: calculateChecksum(payload),
    },
  };
}

/**
 * Convert synthetic sequence to Uint8Array for encoding.
 *
 * Flattens block payloads into a contiguous buffer for use with
 * BlockEncodePipeline.
 *
 * @param sequence - Synthetic sequence
 * @returns Contiguous data buffer
 */
export function sequenceToBuffer(sequence: SyntheticBlockSequence): Uint8Array {
  const buffer = new Uint8Array(sequence.totalSize);
  let offset = 0;

  for (const block of sequence.blocks) {
    buffer.set(block.payload, offset);
    offset += block.payload.length;
  }

  return buffer;
}

/**
 * Get seed from environment or use default.
 *
 * Checks SCREENFERRY_SEED environment variable for override.
 * Provides consistent seed sourcing across synthetic data generation.
 *
 * @returns Seed value from environment or default
 */
export function getSeedFromEnv(): number {
  return SeededRng.getSeedFromEnv();
}

/**
 * Generate sequence with environment seed override.
 *
 * Convenience function that automatically applies SCREENFERRY_SEED
 * if set, otherwise uses provided seed or default.
 *
 * @param config - Sequence configuration (seed is optional)
 * @returns Synthetic block sequence
 */
export function generateSyntheticSequenceWithEnvSeed(
  config: Omit<SequenceConfig, 'seed'>
): SyntheticBlockSequence {
  const envSeed = getSeedFromEnv();
  return generateSyntheticSequence({ ...config, seed: envSeed });
}

/**
 * Create sequence config presets for common test cases.
 *
 * Pre-configured settings for typical validation scenarios.
 */
export const SEQUENCE_PRESETS = {
  /** Small sequence for quick tests (100 blocks) */
  SMALL: {
    blockCount: 100,
    pattern: VALIDATION_PATTERNS.SEQUENTIAL,
    includeMetadata: true,
  } satisfies SequenceConfig,

  /** Medium sequence for standard tests (500 blocks) */
  MEDIUM: {
    blockCount: 500,
    pattern: VALIDATION_PATTERNS.SEQUENTIAL,
    includeMetadata: true,
  } satisfies SequenceConfig,

  /** Large sequence for stress tests (1000 blocks) */
  LARGE: {
    blockCount: 1000,
    pattern: VALIDATION_PATTERNS.SEQUENTIAL,
    includeMetadata: true,
  } satisfies SequenceConfig,

  /** Random pattern for entropy validation */
  RANDOM: {
    blockCount: 500,
    pattern: VALIDATION_PATTERNS.RANDOM,
    includeMetadata: true,
  } satisfies SequenceConfig,

  /** Zero/max pattern for edge case testing */
  EDGE_CASE: {
    blockCount: 100,
    pattern: VALIDATION_PATTERNS.ZERO,
    includeMetadata: true,
  } satisfies SequenceConfig,
} as const;

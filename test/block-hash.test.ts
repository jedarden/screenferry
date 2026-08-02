/**
 * Tests for block hash computation and manifest validation (plan.md §7.6).
 *
 * Verifies:
 * - Block hash computation (SHA-256 truncated to blockHashLen)
 * - Manifest hash computation (CRC-32)
 * - Manifest validation against beacon hash
 * - Block hash verification against manifest
 */

import {describe, it, expect} from 'vitest';
import {
  computeBlockHash,
  computeManifestHash,
  validateManifestHash,
  extractBlockHash,
  verifyBlockHash,
} from '../src/core/hash/block-hash.js';

describe('block-hash', () => {
  describe('computeBlockHash', () => {
    it('should compute SHA-256 hash truncated to blockHashLen', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      const hash = await computeBlockHash(block, 4);

      // Verify it produces 4 bytes
      expect(hash.length).toBe(4);
      // Verify it's deterministic
      const hash2 = await computeBlockHash(block, 4);
      expect(hash).toEqual(hash2);
    });

    it('should throw for invalid blockHashLen (< 1)', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      await expect(computeBlockHash(block, 0)).rejects.toThrow(
        'Invalid blockHashLen'
      );
    });

    it('should throw for invalid blockHashLen (> 32)', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      await expect(computeBlockHash(block, 33)).rejects.toThrow(
        'Invalid blockHashLen'
      );
    });

    it('should return different hashes for different blocks', async () => {
      const block1 = new Uint8Array([1, 2, 3, 4, 5]);
      const block2 = new Uint8Array([1, 2, 3, 4, 6]);

      const hash1 = await computeBlockHash(block1, 4);
      const hash2 = await computeBlockHash(block2, 4);

      expect(hash1).not.toEqual(hash2);
    });

    it('should return same hash for same block', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);

      const hash1 = await computeBlockHash(block, 4);
      const hash2 = await computeBlockHash(block, 4);

      expect(hash1).toEqual(hash2);
    });
  });

  describe('computeManifestHash', () => {
    it('should compute CRC-32 of manifest data', () => {
      // CRC-32 of empty array is 0
      expect(computeManifestHash(new Uint8Array([]))).toBe(0);

      // Verify deterministic output for known input
      const data = new Uint8Array([1, 2, 3, 4]);
      const hash1 = computeManifestHash(data);
      const hash2 = computeManifestHash(data);
      expect(hash1).toBe(hash2);
      expect(hash1).toBeGreaterThan(0);
    });

    it('should compute deterministic hashes', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = computeManifestHash(data);
      const hash2 = computeManifestHash(data);

      expect(hash1).toBe(hash2);
    });

    it('should detect single-bit changes', () => {
      const data1 = new Uint8Array([1, 2, 3, 4]);
      const data2 = new Uint8Array([1, 2, 3, 5]); // Last byte differs by 1 bit

      expect(computeManifestHash(data1)).not.toBe(computeManifestHash(data2));
    });
  });

  describe('validateManifestHash', () => {
    it('should validate correct manifest hash', () => {
      const manifest = new Uint8Array([1, 2, 3, 4]);
      const beaconHash = new Uint8Array([
        (0x5f0f8f5b >>> 24) & 0xff,
        (0x5f0f8f5b >>> 16) & 0xff,
        (0x5f0f8f5b >>> 8) & 0xff,
        0x5f0f8f5b & 0xff,
      ]);

      expect(validateManifestHash(manifest, beaconHash)).toBe(true);
    });

    it('should reject corrupted manifest hash', () => {
      const manifest = new Uint8Array([1, 2, 3, 4]);
      const wrongHash = new Uint8Array([0, 0, 0, 0]);

      expect(validateManifestHash(manifest, wrongHash)).toBe(false);
    });

    it('should throw for malformed beacon hash (wrong length)', () => {
      const manifest = new Uint8Array([1, 2, 3, 4]);
      const shortHash = new Uint8Array([1, 2, 3]);

      expect(() => validateManifestHash(manifest, shortHash)).toThrow(
        'Beacon manifestHash must be 4 bytes'
      );
    });

    it('should throw for empty manifest', () => {
      const emptyManifest = new Uint8Array([]);
      const beaconHash = new Uint8Array([0, 0, 0, 0]);

      expect(() => validateManifestHash(emptyManifest, beaconHash)).toThrow(
        'Manifest data cannot be empty'
      );
    });

    it('should detect single-bit corruption in manifest', () => {
      const originalManifest = new Uint8Array([1, 2, 3, 4]);
      const corruptedManifest = new Uint8Array([1, 2, 3, 5]); // One bit flipped
      const beaconHash = new Uint8Array([
        (0x5f0f8f5b >>> 24) & 0xff,
        (0x5f0f8f5b >>> 16) & 0xff,
        (0x5f0f8f5b >>> 8) & 0xff,
        0x5f0f8f5b & 0xff,
      ]);

      expect(validateManifestHash(originalManifest, beaconHash)).toBe(true);
      expect(validateManifestHash(corruptedManifest, beaconHash)).toBe(false);
    });
  });

  describe('extractBlockHash', () => {
    const manifest = new Uint8Array([
      // Block 0 hash (4 bytes)
      0x01, 0x02, 0x03, 0x04,
      // Block 1 hash (4 bytes)
      0x05, 0x06, 0x07, 0x08,
      // Block 2 hash (4 bytes)
      0x09, 0x0a, 0x0b, 0x0c,
    ]);

    it('should extract block hash at correct offset', () => {
      const hash0 = extractBlockHash(manifest, 0, 4);
      expect(hash0).toEqual(new Uint8Array([0x01, 0x02, 0x03, 0x04]));

      const hash1 = extractBlockHash(manifest, 1, 4);
      expect(hash1).toEqual(new Uint8Array([0x05, 0x06, 0x07, 0x08]));

      const hash2 = extractBlockHash(manifest, 2, 4);
      expect(hash2).toEqual(new Uint8Array([0x09, 0x0a, 0x0b, 0x0c]));
    });

    it('should throw for out-of-range block index', () => {
      expect(() => extractBlockHash(manifest, 3, 4)).toThrow(
        'Block 3 hash extends beyond manifest'
      );
    });

    it('should work with different blockHashLen', () => {
      const shortManifest = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
      const hash = extractBlockHash(shortManifest, 1, 3);
      expect(hash).toEqual(new Uint8Array([0x04, 0x05, 0x06]));
    });
  });

  describe('verifyBlockHash', () => {
    it('should verify block against matching manifest hash', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      const blockHash = await computeBlockHash(block, 4);

      // Create manifest with this hash
      const manifest = new Uint8Array([
        ...blockHash,
        0xff, 0xff, 0xff, 0xff, // Different block
      ]);

      const isValid = await verifyBlockHash(block, 0, manifest, 4);
      expect(isValid).toBe(true);
    });

    it('should reject block with non-matching manifest hash', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      const manifest = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, // Wrong hash
        0xff, 0xff, 0xff, 0xff,
      ]);

      const isValid = await verifyBlockHash(block, 0, manifest, 4);
      expect(isValid).toBe(false);
    });

    it('should verify different blocks in same manifest', async () => {
      const block0 = new Uint8Array([1, 2, 3, 4, 5]);
      const block1 = new Uint8Array([5, 4, 3, 2, 1]);

      const hash0 = await computeBlockHash(block0, 4);
      const hash1 = await computeBlockHash(block1, 4);

      const manifest = new Uint8Array([...hash0, ...hash1]);

      expect(await verifyBlockHash(block0, 0, manifest, 4)).toBe(true);
      expect(await verifyBlockHash(block1, 1, manifest, 4)).toBe(true);
    });

    it('should detect corrupted block data', async () => {
      const originalBlock = new Uint8Array([1, 2, 3, 4, 5]);
      const corruptedBlock = new Uint8Array([1, 2, 3, 4, 6]); // One byte flipped

      const hash = await computeBlockHash(originalBlock, 4);
      const manifest = new Uint8Array([...hash]);

      expect(await verifyBlockHash(originalBlock, 0, manifest, 4)).toBe(true);
      expect(await verifyBlockHash(corruptedBlock, 0, manifest, 4)).toBe(false);
    });

    it('should throw for mismatched hash length', async () => {
      const block = new Uint8Array([1, 2, 3, 4, 5]);
      const manifest = new Uint8Array([1, 2]); // Too short

      await expect(verifyBlockHash(block, 0, manifest, 4)).rejects.toThrow(
        'extends beyond manifest'
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle multi-block manifest (4 GB file scenario)', async () => {
      // A 4 GB file with 192 KB blocks has ~21,845 blocks
      const blockCount = 21845;
      const blockHashLen = 4;
      const manifest = new Uint8Array(blockCount * blockHashLen);

      // Populate manifest with hashes
      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array([i, i, i, i, i]);
        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      // Compute manifest hash for beacon
      const manifestHash = computeManifestHash(manifest);
      const beaconHash = new Uint8Array([
        (manifestHash >>> 24) & 0xff,
        (manifestHash >>> 16) & 0xff,
        (manifestHash >>> 8) & 0xff,
        manifestHash & 0xff,
      ]);

      // Validate
      expect(validateManifestHash(manifest, beaconHash)).toBe(true);

      // Verify random blocks
      for (let i = 0; i < 100; i++) {
        const blockIndex = Math.floor(Math.random() * blockCount);
        const block = new Uint8Array([blockIndex, blockIndex, blockIndex, blockIndex, blockIndex]);
        expect(await verifyBlockHash(block, blockIndex, manifest, blockHashLen)).toBe(true);
      }
    });

    it('should detect corruption in large manifest', async () => {
      const blockCount = 1000;
      const blockHashLen = 4;
      const manifest = new Uint8Array(blockCount * blockHashLen);

      // Populate with hashes
      for (let i = 0; i < blockCount; i++) {
        const block = new Uint8Array([i, i, i, i, i]);
        const hash = await computeBlockHash(block, blockHashLen);
        manifest.set(hash, i * blockHashLen);
      }

      // Compute correct beacon hash
      const manifestHash = computeManifestHash(manifest);
      const beaconHash = new Uint8Array([
        (manifestHash >>> 24) & 0xff,
        (manifestHash >>> 16) & 0xff,
        (manifestHash >>> 8) & 0xff,
        manifestHash & 0xff,
      ]);

      expect(validateManifestHash(manifest, beaconHash)).toBe(true);

      // Corrupt one byte in the middle of the manifest
      manifest[Math.floor(manifest.length / 2)] ^= 0xff;

      expect(validateManifestHash(manifest, beaconHash)).toBe(false);
    });
  });
});

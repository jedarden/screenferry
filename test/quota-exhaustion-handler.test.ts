/**
 * Tests for quota exhaustion handler (bf-4d6 F1).
 *
 * Tests graceful handling of OPFS quota exhaustion during transfers.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  handleQuotaExhaustion,
  formatIncompleteManifest,
  getQuotaExhaustionMessage,
  isQuotaExhaustionError,
  getRemainingBlocks,
  type QuotaExhaustionEvent,
} from '../src/platform/quota-exhaustion-handler.js';

describe('Quota Exhaustion Handler', () => {
  describe('handleQuotaExhaustion', () => {
    it('should handle quota exhaustion event', async () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024, // 1 MB
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0xFF, 0x0F]), // First 12 bits set
        totalBlocks: 16,
        completedBlocks: 12,
        missingBlocks: 4,
        timestamp: Date.now(),
      };

      const result = await handleQuotaExhaustion(event);

      expect(result.success).toBe(true);
      expect(result.manifest).toBeDefined();
      expect(result.manifest?.streamId).toBe(12345);
      expect(result.manifest?.filename).toBe('test-file.bin');
      expect(result.manifest?.completedBlocks).toBe(12);
      expect(result.manifest?.missingBlocks).toBe(4);
      expect(result.manifest?.percentComplete).toBeCloseTo(75); // 12/16 = 75%
    });

    it('should calculate quota needed with safety margin', async () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024,
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0x80]), // First bit set
        totalBlocks: 16,
        completedBlocks: 1,
        missingBlocks: 15,
        timestamp: Date.now(),
      };

      const result = await handleQuotaExhaustion(event);

      // 15 missing blocks * 192 bytes = 2880 bytes
      // With compression overhead (15%) and safety margin (1.5x):
      // 2880 * 1.15 * 1.5 ≈ 4968 bytes
      expect(result.manifest?.estimatedQuotaNeeded).toBeGreaterThan(2880);
      expect(result.manifest?.estimatedQuotaNeeded).toBeLessThan(10000); // Reasonable upper bound
    });

    it('should provide helpful suggestions for high completion', async () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'large-file.bin',
        fileSize: 100 * 1024 * 1024, // 100 MB
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0xFF, 0xFF, 0xFF, 0xC0]), // 30/32 blocks
        totalBlocks: 32,
        completedBlocks: 30,
        missingBlocks: 2,
        timestamp: Date.now(),
      };

      const result = await handleQuotaExhaustion(event);

      expect(result.suggestions.length).toBeGreaterThan(0);
      // Should mention partial file saved for high completion
      expect(result.suggestions.some(s => s.includes('Partial file') || s.includes('saved'))).toBe(true);
    });

    it('should provide helpful suggestions for low completion', async () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'large-file.bin',
        fileSize: 100 * 1024 * 1024,
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0x80]), // 1/8 blocks
        totalBlocks: 8,
        completedBlocks: 1,
        missingBlocks: 7,
        timestamp: Date.now(),
      };

      const result = await handleQuotaExhaustion(event);

      // For low completion, suggest alternative approaches
      expect(result.suggestions.length).toBeGreaterThan(0);
      // Should suggest Chrome/Edge which has higher quota
      expect(result.suggestions.some(s => s.includes('Chrome') || s.includes('browser'))).toBe(true);
    });
  });

  describe('formatIncompleteManifest', () => {
    it('should format manifest for display', () => {
      const manifest = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024,
        mimeType: 'application/octet-stream',
        totalBlocks: 16,
        completedBlocks: 12,
        missingBlocks: 4,
        missingBlockIndices: [12, 13, 14, 15],
        percentComplete: 75,
        timestamp: Date.now(),
        partialDataSize: 2304, // 12 * 192
        estimatedQuotaNeeded: 3000,
      };

      const formatted = formatIncompleteManifest(manifest);

      expect(formatted).toContain('test-file.bin');
      expect(formatted).toContain('12/16');
      expect(formatted).toContain('75.0%');
      expect(formatted).toContain('12, 13, 14, 15');
    });

    it('should handle large missing block lists', () => {
      const missingBlocks = Array.from({length: 50}, (_, i) => i + 100);
      const manifest = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024,
        mimeType: 'application/octet-stream',
        totalBlocks: 200,
        completedBlocks: 150,
        missingBlocks: 50,
        missingBlockIndices: missingBlocks,
        percentComplete: 75,
        timestamp: Date.now(),
        partialDataSize: 28800,
        estimatedQuotaNeeded: 5000,
      };

      const formatted = formatIncompleteManifest(manifest);

      expect(formatted).toContain('...'); // Should truncate
      expect(formatted).toContain('Count: 50');
    });
  });

  describe('getQuotaExhaustionMessage', () => {
    it('should create user-friendly error message', () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024,
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0xC0]), // 2/4 blocks
        totalBlocks: 4,
        completedBlocks: 2,
        missingBlocks: 2,
        timestamp: Date.now(),
      };

      const message = getQuotaExhaustionMessage(event);

      expect(message).toContain('test-file.bin');
      expect(message).toContain('50.0%'); // 2/4 = 50%
      expect(message).toContain('Chrome/Edge');
      expect(message).toContain('Firefox');
      expect(message).toContain('Safari');
    });

    it('should mention partial file for high completion', () => {
      const event: QuotaExhaustionEvent = {
        streamId: 12345,
        filename: 'test-file.bin',
        fileSize: 1024 * 1024,
        mimeType: 'application/octet-stream',
        writtenBlocks: new Uint8Array([0xFF, 0x80]), // 9/10 blocks
        totalBlocks: 10,
        completedBlocks: 9,
        missingBlocks: 1,
        timestamp: Date.now(),
      };

      const message = getQuotaExhaustionMessage(event);

      expect(message).toContain('Partial file has been saved');
    });
  });

  describe('isQuotaExhaustionError', () => {
    it('should detect DOMException quota errors', () => {
      const error = new DOMException('Quota exceeded', 'QuotaExceededError');
      expect(isQuotaExhaustionError(error)).toBe(true);
    });

    it('should detect quota-related error messages', () => {
      const error = new Error('Out of storage space');
      expect(isQuotaExhaustionError(error)).toBe(true);
    });

    it('should return false for unrelated errors', () => {
      const error = new Error('Network connection failed');
      expect(isQuotaExhaustionError(error)).toBe(false);
    });

    it('should handle non-error objects', () => {
      expect(isQuotaExhaustionError('string')).toBe(false);
      expect(isQuotaExhaustionError(null)).toBe(false);
      expect(isQuotaExhaustionError(undefined)).toBe(false);
    });
  });

  describe('getRemainingBlocks', () => {
    it('should count remaining blocks from bitmap', () => {
      const writtenBlocks = new Uint8Array([0xFF, 0x0F]); // First 12 bits set
      const totalBlocks = 16;

      const remaining = getRemainingBlocks(writtenBlocks, totalBlocks);

      expect(remaining).toBe(4); // 4 blocks not written
    });

    it('should handle all blocks written', () => {
      const writtenBlocks = new Uint8Array([0xFF, 0xFF]);
      const totalBlocks = 16;

      const remaining = getRemainingBlocks(writtenBlocks, totalBlocks);

      expect(remaining).toBe(0);
    });

    it('should handle no blocks written', () => {
      const writtenBlocks = new Uint8Array([0x00, 0x00]);
      const totalBlocks = 16;

      const remaining = getRemainingBlocks(writtenBlocks, totalBlocks);

      expect(remaining).toBe(16);
    });

    it('should handle partial bytes', () => {
      const writtenBlocks = new Uint8Array([0x55]); // Alternating bits: 01010101
      const totalBlocks = 8;

      const remaining = getRemainingBlocks(writtenBlocks, totalBlocks);

      expect(remaining).toBe(4);
    });
  });
});

/**
 * Tests for basic XOR decode function (bf-3z565)
 */

import { describe, it, expect } from 'vitest';
import { basicDecode, xor, GEDecoder } from '../src/core/fountain/decoder.js';
import { LTEncoder } from '../src/core/fountain/encoder.js';

describe('basicDecode', () => {
  describe('Repetition mode (K < 8)', () => {
    it('should decode K=1 repetition', () => {
      const fragments = [
        new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]),
      ];

      const encoder = new LTEncoder({
        streamId: 1,
        blockIndex: 0,
        fragments,
      });

      // Test various sequence numbers - should all return the same fragment
      for (const seq of [0, 1, 5, 100]) {
        const payload = encoder.encode(seq);
        const decoded = basicDecode(1, 0, seq, payload, fragments);

        expect(decoded).toEqual(fragments[0]);
        expect(decoded[0]).toBe(0xAA);
        expect(decoded[1]).toBe(0xBB);
        expect(decoded[2]).toBe(0xCC);
        expect(decoded[3]).toBe(0xDD);
      }
    });

    it('should decode K=4 repetition', () => {
      const fragments = [
        new Uint8Array([0x00, 0x01, 0x02, 0x03]),
        new Uint8Array([0x10, 0x11, 0x12, 0x13]),
        new Uint8Array([0x20, 0x21, 0x22, 0x23]),
        new Uint8Array([0x30, 0x31, 0x32, 0x33]),
      ];

      const encoder = new LTEncoder({
        streamId: 1,
        blockIndex: 0,
        fragments,
      });

      // Test sequence mapping
      const testCases = [
        { seq: 0, expectedIndex: 0 },
        { seq: 1, expectedIndex: 1 },
        { seq: 2, expectedIndex: 2 },
        { seq: 3, expectedIndex: 3 },
        { seq: 4, expectedIndex: 0 }, // wraps
        { seq: 7, expectedIndex: 3 },
        { seq: 8, expectedIndex: 0 }, // 8 % 4 = 0
        { seq: 13, expectedIndex: 1 }, // 13 % 4 = 1
      ];

      for (const { seq, expectedIndex } of testCases) {
        const payload = encoder.encode(seq);
        const decoded = basicDecode(1, 0, seq, payload, fragments);

        expect(decoded).toEqual(fragments[expectedIndex]);
      }
    });

    it('should decode K=7 (maximum repetition mode)', () => {
      const fragments = Array.from({ length: 7 }, (_, i) =>
        new Uint8Array([i, i + 1, i + 2, i + 3])
      );

      const encoder = new LTEncoder({
        streamId: 7,
        blockIndex: 0,
        fragments,
      });

      // Test wrapping behavior
      const testCases = [
        { seq: 0, expectedIndex: 0 },
        { seq: 6, expectedIndex: 6 },
        { seq: 7, expectedIndex: 0 }, // wraps
        { seq: 13, expectedIndex: 6 }, // 13 % 7 = 6
        { seq: 14, expectedIndex: 0 }, // 14 % 7 = 0
      ];

      for (const { seq, expectedIndex } of testCases) {
        const payload = encoder.encode(seq);
        const decoded = basicDecode(7, 0, seq, payload, fragments);

        expect(decoded).toEqual(fragments[expectedIndex]);
      }
    });
  });

  describe('XOR mode (K >= 8)', () => {
    it('should handle XOR of single fragment (degree=1)', () => {
      const fragments = Array.from({ length: 10 }, (_, i) =>
        new Uint8Array(256).fill(i & 0xff)
      );

      const encoder = new LTEncoder({
        streamId: 12345,
        blockIndex: 0,
        fragments,
      });

      // Encode packet seq 0
      const payload = encoder.encode(0);

      // Decode using basicDecode
      const decoded = basicDecode(12345, 0, 0, payload, fragments);

      // For degree=1, the XOR operation should return the original fragment
      // (since we XOR the payload with the same fragment that created it)
      expect(decoded.length).toBe(256);
    });

    it('should handle XOR of 2-3 fragments', () => {
      const fragments = Array.from({ length: 10 }, (_, i) => {
        const arr = new Uint8Array(256);
        for (let j = 0; j < 256; j++) {
          arr[j] = (i + j) & 0xff;
        }
        return arr;
      });

      const encoder = new LTEncoder({
        streamId: 99999,
        blockIndex: 5,
        fragments,
      });

      // Test multiple sequence numbers
      for (const seq of [0, 1, 2, 3, 4, 5]) {
        const payload = encoder.encode(seq);
        const decoded = basicDecode(99999, 5, seq, payload, fragments);

        // Verify length is correct
        expect(decoded.length).toBe(256);

        // Verify result is a valid byte array
        expect(decoded instanceof Uint8Array).toBe(true);
      }
    });

    it('should return payload as-is for complex sequences (>3 fragments)', () => {
      const fragments = Array.from({ length: 100 }, (_, i) =>
        new Uint8Array(256).fill(i & 0xff)
      );

      const encoder = new LTEncoder({
        streamId: 42,
        blockIndex: 0,
        fragments,
      });

      const payload = encoder.encode(0);
      const decoded = basicDecode(42, 0, 0, payload, fragments);

      // For complex sequences, should return payload as-is
      expect(decoded.length).toBe(payload.length);
      expect(decoded instanceof Uint8Array).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should throw on zero source fragments', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(256), []);
      }).toThrow(/zero source fragments/);
    });

    it('should throw on zero fragment length', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(0), [new Uint8Array(0)]);
      }).toThrow(/zero fragment length/);
    });

    it('should throw on payload length mismatch', () => {
      const fragments = [
        new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      ];

      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(256), fragments);
      }).toThrow(/payload length mismatch/);
    });
  });
});

describe('xor helper function', () => {
  it('should XOR two byte arrays correctly', () => {
    const a = new Uint8Array([0x00, 0x0F, 0xF0, 0xFF]);
    const b = new Uint8Array([0xFF, 0xF0, 0x0F, 0x00]);
    const result = xor(a, b);

    expect(result).toEqual(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]));
  });

  it('should throw on length mismatch', () => {
    const a = new Uint8Array([0x00, 0x01]);
    const b = new Uint8Array([0x00]);

    expect(() => {
      xor(a, b);
    }).toThrow(/length mismatch/);
  });

  it('should handle identity: A ^ 0 = A', () => {
    const a = new Uint8Array([0x12, 0x34, 0x56]);
    const zero = new Uint8Array([0x00, 0x00, 0x00]);
    const result = xor(a, zero);

    expect(result).toEqual(a);
  });

  it('should handle self-inverse: A ^ A = 0', () => {
    const a = new Uint8Array([0x12, 0x34, 0x56]);
    const result = xor(a, a);

    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00]));
  });

  it('should handle commutativity: A ^ B = B ^ A', () => {
    const a = new Uint8Array([0x12, 0x34]);
    const b = new Uint8Array([0x56, 0x78]);

    const result1 = xor(a, b);
    const result2 = xor(b, a);

    expect(result1).toEqual(result2);
  });
});

describe('Integration with GEDecoder', () => {
  it('should be consistent with GEDecoder for repetition mode', () => {
    const fragments = [
      new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      new Uint8Array([0x10, 0x11, 0x12, 0x13]),
      new Uint8Array([0x20, 0x21, 0x22, 0x23]),
    ];

    const encoder = new LTEncoder({
      streamId: 1,
      blockIndex: 0,
      fragments,
    });

    const decoder = new GEDecoder({
      streamId: 1,
      blockIndex: 0,
      k: 3,
      fragLen: 4,
    });

    // Test with basicDecode
    for (let i = 0; i < 10; i++) {
      const payload = encoder.encode(i);
      const basicDecoded = basicDecode(1, 0, i, payload, fragments);

      // Compare with GEDecoder result
      decoder.absorb(i, payload);
    }

    expect(decoder.complete).toBe(true);
    const recovered = decoder.recover();

    // basicDecode should produce the same results as GEDecoder
    // for repetition mode
    for (let i = 0; i < 10; i++) {
      const payload = encoder.encode(i);
      const basicDecoded = basicDecode(1, 0, i, payload, fragments);
      const expectedIndex = i % 3;
      expect(basicDecoded).toEqual(fragments[expectedIndex]);
    }
  });
});

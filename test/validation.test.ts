/**
 * Tests for input validation and error handling (bf-x6i4o)
 */

import { describe, it, expect } from 'vitest';
import { basicDecode, xor, GEDecoder } from '../src/core/fountain/decoder.js';

describe('basicDecode validation', () => {
  const validFragments = [
    new Uint8Array([0x00, 0x01, 0x02, 0x03]),
    new Uint8Array([0x10, 0x11, 0x12, 0x13]),
  ];
  const validPayload = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

  describe('streamId validation', () => {
    it('should accept valid non-negative streamId', () => {
      expect(() => {
        basicDecode(12345, 0, 0, validPayload, validFragments);
      }).not.toThrow();
    });

    it('should reject negative streamId', () => {
      expect(() => {
        basicDecode(-1, 0, 0, validPayload, validFragments);
      }).toThrow(/invalid streamId.*non-negative/);
    });

    it('should reject NaN streamId', () => {
      expect(() => {
        basicDecode(NaN, 0, 0, validPayload, validFragments);
      }).toThrow(/invalid streamId.*finite/);
    });

    it('should reject Infinity streamId', () => {
      expect(() => {
        basicDecode(Infinity, 0, 0, validPayload, validFragments);
      }).toThrow(/invalid streamId.*finite/);
    });

    it('should reject -Infinity streamId', () => {
      expect(() => {
        basicDecode(-Infinity, 0, 0, validPayload, validFragments);
      }).toThrow(/invalid streamId.*finite/);
    });
  });

  describe('blockIndex validation', () => {
    it('should accept valid non-negative blockIndex', () => {
      expect(() => {
        basicDecode(1, 12345, 0, validPayload, validFragments);
      }).not.toThrow();
    });

    it('should reject negative blockIndex', () => {
      expect(() => {
        basicDecode(1, -1, 0, validPayload, validFragments);
      }).toThrow(/invalid blockIndex.*non-negative/);
    });

    it('should reject NaN blockIndex', () => {
      expect(() => {
        basicDecode(1, NaN, 0, validPayload, validFragments);
      }).toThrow(/invalid blockIndex.*finite/);
    });

    it('should reject Infinity blockIndex', () => {
      expect(() => {
        basicDecode(1, Infinity, 0, validPayload, validFragments);
      }).toThrow(/invalid blockIndex.*finite/);
    });
  });

  describe('seq validation', () => {
    it('should accept valid non-negative seq', () => {
      expect(() => {
        basicDecode(1, 0, 100, validPayload, validFragments);
      }).not.toThrow();
    });

    it('should reject negative seq', () => {
      expect(() => {
        basicDecode(1, 0, -1, validPayload, validFragments);
      }).toThrow(/invalid seq number.*non-negative/);
    });

    it('should reject NaN seq', () => {
      expect(() => {
        basicDecode(1, 0, NaN, validPayload, validFragments);
      }).toThrow(/invalid seq number.*finite/);
    });

    it('should reject Infinity seq', () => {
      expect(() => {
        basicDecode(1, 0, Infinity, validPayload, validFragments);
      }).toThrow(/invalid seq number.*finite/);
    });

    it('should accept zero seq', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, validFragments);
      }).not.toThrow();
    });
  });

  describe('payload validation', () => {
    it('should reject null payload', () => {
      expect(() => {
        basicDecode(1, 0, 0, null as any, validFragments);
      }).toThrow(/payload must be Uint8Array/);
    });

    it('should reject non-Uint8Array payload', () => {
      expect(() => {
        basicDecode(1, 0, 0, [0x00, 0x01] as any, validFragments);
      }).toThrow(/payload must be Uint8Array/);
    });

    it('should reject empty payload', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(0), validFragments);
      }).toThrow(/empty payload/);
    });

    it('should reject payload with wrong length', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(256), validFragments);
      }).toThrow(/payload length mismatch.*expected 4, got 256/);
    });
  });

  describe('sourceFragments validation', () => {
    it('should reject null sourceFragments', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, null as any);
      }).toThrow(/sourceFragments must be non-empty array/);
    });

    it('should reject empty sourceFragments array', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, []);
      }).toThrow(/sourceFragments must be non-empty array/);
    });

    it('should reject non-array sourceFragments', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, {} as any);
      }).toThrow(/sourceFragments must be non-empty array/);
    });

    it('should reject sourceFragments with non-Uint8Array elements', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, [
          [0x00, 0x01] as any,
          new Uint8Array([0x10, 0x11]),
        ]);
      }).toThrow(/sourceFragments\[0\] must be Uint8Array/);
    });

    it('should reject sourceFragments with null elements', () => {
      expect(() => {
        basicDecode(1, 0, 0, validPayload, [
          null as any,
          new Uint8Array([0x10, 0x11]),
        ]);
      }).toThrow(/sourceFragments\[0\] must be Uint8Array/);
    });

    it('should reject zero-length fragments', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array(0), [
          new Uint8Array(0),
          new Uint8Array([0x10, 0x11]),
        ]);
      }).toThrow(/zero fragment length/);
    });

    it('should reject inconsistent fragment lengths', () => {
      expect(() => {
        basicDecode(1, 0, 0, new Uint8Array([0x00, 0x01]), [
          new Uint8Array([0x00, 0x01]),
          new Uint8Array([0x10, 0x11, 0x12]), // wrong length
        ]);
      }).toThrow(/inconsistent fragment lengths.*expected 2, fragment 1 has 3/);
    });
  });
});

describe('GEDecoder.absorb validation', () => {
  const validOpts = {
    streamId: 1,
    blockIndex: 0,
    k: 10,
    fragLen: 256,
  };

  describe('seq validation', () => {
    it('should accept valid non-negative seq', () => {
      const decoder = new GEDecoder(validOpts);
      const payload = new Uint8Array(256);

      expect(() => {
        decoder.absorb(0, payload);
      }).not.toThrow();
    });

    it('should reject negative seq', () => {
      const decoder = new GEDecoder(validOpts);
      const payload = new Uint8Array(256);

      expect(() => {
        decoder.absorb(-1, payload);
      }).toThrow(/invalid seq number.*non-negative/);
    });

    it('should reject NaN seq', () => {
      const decoder = new GEDecoder(validOpts);
      const payload = new Uint8Array(256);

      expect(() => {
        decoder.absorb(NaN, payload);
      }).toThrow(/invalid seq number.*finite/);
    });

    it('should reject Infinity seq', () => {
      const decoder = new GEDecoder(validOpts);
      const payload = new Uint8Array(256);

      expect(() => {
        decoder.absorb(Infinity, payload);
      }).toThrow(/invalid seq number.*finite/);
    });
  });

  describe('payload validation', () => {
    it('should reject null payload', () => {
      const decoder = new GEDecoder(validOpts);

      expect(() => {
        decoder.absorb(0, null as any);
      }).toThrow(/payload must be Uint8Array/);
    });

    it('should reject non-Uint8Array payload', () => {
      const decoder = new GEDecoder(validOpts);

      expect(() => {
        decoder.absorb(0, [0x00, 0x01] as any);
      }).toThrow(/payload must be Uint8Array/);
    });

    it('should reject empty payload', () => {
      const decoder = new GEDecoder(validOpts);

      expect(() => {
        decoder.absorb(0, new Uint8Array(0));
      }).toThrow(/empty payload/);
    });

    it('should return false for wrong-length payload (not throw)', () => {
      const decoder = new GEDecoder(validOpts);

      // Should return false, not throw
      const result = decoder.absorb(0, new Uint8Array(4));
      expect(result).toBe(false);
    });
  });

  describe('Error messages are clear and actionable', () => {
    it('should include actual and expected values in error messages', () => {
      const decoder = new GEDecoder(validOpts);

      try {
        decoder.absorb(-5, new Uint8Array(256));
        fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('got -5');
      }
    });

    it('should indicate parameter name in error messages', () => {
      try {
        basicDecode(-1, 0, 0, new Uint8Array(4), [new Uint8Array(4)]);
        fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('streamId');
      }
    });
  });
});

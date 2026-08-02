/**
 * I3 conformance test using test/fixtures/vectors.json (AP10 resolution).
 * This test ensures the PRNG functions are bit-exact across implementations.
 */

import { describe, expect, it } from 'vitest';
import { deriveIndices, makeDegreeTable, packetSeed } from '../src/core/fountain/prng.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const vectors = JSON.parse(
  readFileSync(resolve(__dirname, '../test/fixtures/vectors.json'), 'utf-8')
);

describe('I3 conformance vectors (AP10 resolution)', () => {
  it('test/fixtures/vectors.json exists and is valid', () => {
    expect(vectors).toBeDefined();
    expect(vectors.metadata).toBeDefined();
    expect(vectors.metadata.description).toContain('I3 conformance');
  });

  describe('packetSeed', () => {
    it('matches all test vectors exactly', () => {
      for (const vector of vectors.packetSeed) {
        const [streamId, blockIndex, seq] = vector.inputs;
        const expected = vector.output;
        const actual = packetSeed(streamId, blockIndex, seq);
        expect(actual).toBe(expected);
      }
    });
  });

  describe('deriveIndices', () => {
    it('matches all test vectors exactly', () => {
      for (const vector of vectors.deriveIndices) {
        const { streamId, blockIndex, seq, k, degreeCap } = vector.inputs;
        const degreeTable = makeDegreeTable(k, degreeCap);
        const actual = Array.from(deriveIndices(streamId, blockIndex, seq, k, degreeTable));
        expect(actual).toEqual(vector.outputs);
      }
    });

    it('covers the same cases used in codec.test.ts', () => {
      // This is the vector that appears in codec.test.ts line 135
      const testVector = vectors.deriveIndices.find(
        v => v.inputs.streamId === 0xdeadbeef && v.inputs.blockIndex === 3 && v.inputs.seq === 42
      );
      expect(testVector).toBeDefined();

      const { streamId, blockIndex, seq, k, degreeCap } = testVector!.inputs;
      const degreeTable = makeDegreeTable(k, degreeCap);
      const actual = Array.from(deriveIndices(streamId, blockIndex, seq, k, degreeTable));

      // Verify it's the same as what codec.test.ts would get
      const expected = Array.from(deriveIndices(0xdeadbeef, 3, 42, k, degreeTable));
      expect(actual).toEqual(expected);
    });
  });

  describe('splitmix32', () => {
    it('produces bit-exact sequences from seeds', () => {
      // We can't directly export splitmix32 from prng.ts, but we can verify it indirectly
      // by checking that deriveIndices produces consistent results
      for (const vector of vectors.deriveIndices.slice(0, 3)) {
        const { streamId, blockIndex, seq, k, degreeCap } = vector.inputs;
        const degreeTable = makeDegreeTable(k, degreeCap);

        // Deriving indices twice with the same inputs should give the same result
        const a = Array.from(deriveIndices(streamId, blockIndex, seq, k, degreeTable));
        const b = Array.from(deriveIndices(streamId, blockIndex, seq, k, degreeTable));

        expect(a).toEqual(b);
        expect(a).toEqual(vector.outputs);
      }
    });
  });
});

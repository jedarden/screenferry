/**
 * Debug test to check if imports cause hangs
 */

import { describe, expect, it } from 'vitest';

describe('Import debugging', () => {
  it('should import params without hanging', async () => {
    const params = await import('../src/core/params.js');
    expect(params.BLOCK).toBeDefined();
    expect(params.L).toBeDefined();
  });

  it('should import encoder without hanging', async () => {
    const encoder = await import('../src/core/fountain/encoder.js');
    expect(encoder.LTEncoder).toBeDefined();
  });

  it('should import encode pipeline without hanging', async () => {
    const encode = await import('../src/core/block/encode-pipeline.js');
    expect(encode.createEncodePipeline).toBeDefined();
  });

  it('should import decode pipeline without hanging', async () => {
    const decode = await import('../src/core/block/decode-pipeline.js');
    expect(decode.createDecodePipeline).toBeDefined();
  });
});
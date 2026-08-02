/**
 * Debug test for beacon encoding/parsing issues
 */

import {describe, it, expect} from 'vitest';
import {encodeBeacon, parseBeacon, type BeaconMeta} from '../src/core/frame/beacon.js';

function createMeta(blockSize: number): BeaconMeta {
  const blockCount = 6;
  const calculatedSize = blockCount * blockSize;
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: calculatedSize,
    payloadLen: calculatedSize,
    blockSize,
    blockCount,
    fragmentLen: 256,
    degreeCap: 64,
    flags: 0,
    blockHashLen: 4,
    wholeFileHash: new Uint8Array(32),
    manifestHash: new Uint8Array(4),
    filename: 'test.txt',
    mimeType: 'text/plain',
  };
}

describe('Debug beacon encoding', () => {
  it('works with blockSize = 192*1024 (K=768)', () => {
    const meta = createMeta(192 * 1024);
    const encoded = encodeBeacon(meta);

    const parsed = parseBeacon(encoded, 768, 10 * 1024 * 1024);
    expect(parsed.blockSize).toBe(192 * 1024);
  });

  it('throws E-K-OVERFLOW with blockSize = 200*1024 (K=800)', () => {
    const meta = createMeta(200 * 1024);
    console.log('Creating meta with blockSize:', meta.blockSize, 'blockCount:', meta.blockCount);

    const encoded = encodeBeacon(meta);
    console.log('Encoded beacon length:', encoded.length);

    // Try to parse with a lower K_max to trigger overflow
    let caughtError: Error;
    expect(() => {
      try {
        parseBeacon(encoded, 768, 10 * 1024 * 1024);
      } catch (e) {
        caughtError = e;
        console.log('Caught error:', (e as any).code, (e as any).message);
        throw e;
      }
    }).toThrow();

    expect(caughtError).toBeDefined();
    expect((caughtError as any).code).toBe('E-K-OVERFLOW');
    expect((caughtError as any).message).toContain('Sender K (800)');
  });
});
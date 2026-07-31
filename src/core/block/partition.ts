/**
 * Block layer — D19. The thing that makes file size irrelevant to everything below.
 *
 * GE is O(K^2) memory and O(K^3) time; one 4 GB fountain block would need a 32 TB
 * matrix. Cutting the payload into independent 192 KB blocks pins decoder cost at a
 * flat 72 KB matrix regardless of file size (invariant I6a). This is what RFC 6330
 * calls source blocks.
 */

import { BLOCK, K, L } from '../params.js';

export interface BlockGeometry {
  blockSize: number;
  fragmentLen: number;
  blockCount: number;
  totalLen: number;
}

export function geometry(totalLen: number, blockSize = BLOCK, fragmentLen = L): BlockGeometry {
  if (totalLen < 0) throw new Error('negative length');
  return {
    blockSize,
    fragmentLen,
    totalLen,
    blockCount: Math.max(1, Math.ceil(totalLen / blockSize)),
  };
}

/**
 * Byte range of a block. The LAST block is short — edge case E3a.
 *
 * Both sides MUST derive this from the same function. A last-block K computed
 * differently on the two ends silently produces mismatched PRNG index sets: the
 * block never decodes and nothing indicates why.
 */
export function blockRange(g: BlockGeometry, blockIndex: number): { start: number; end: number } {
  if (blockIndex < 0 || blockIndex >= g.blockCount) throw new Error(`block ${blockIndex} out of range`);
  const start = blockIndex * g.blockSize;
  return { start, end: Math.min(start + g.blockSize, g.totalLen) };
}

/** Fragments in a given block. Short for the last one (E3a). */
export function blockK(g: BlockGeometry, blockIndex: number): number {
  const { start, end } = blockRange(g, blockIndex);
  return Math.max(1, Math.ceil((end - start) / g.fragmentLen));
}

/** Split a block's bytes into K fragments, zero-padding the tail. */
export function toFragments(block: Uint8Array, fragmentLen = L): Uint8Array[] {
  const n = Math.max(1, Math.ceil(block.length / fragmentLen));
  const out: Uint8Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = new Uint8Array(fragmentLen);
    f.set(block.subarray(i * fragmentLen, Math.min((i + 1) * fragmentLen, block.length)));
    out[i] = f;
  }
  return out;
}

/** Rejoin fragments and trim padding back to the block's true length. */
export function fromFragments(fragments: Uint8Array[], byteLen: number): Uint8Array {
  const out = new Uint8Array(byteLen);
  let off = 0;
  for (const f of fragments) {
    if (off >= byteLen) break;
    out.set(f.subarray(0, Math.min(f.length, byteLen - off)), off);
    off += f.length;
  }
  return out;
}

/** Completed-block bitmap — the resume token (D22). 2.7 KB per 4 GB. */
export class BlockBitmap {
  private readonly bits: Uint8Array;
  constructor(readonly count: number, from?: Uint8Array) {
    this.bits = from ? Uint8Array.from(from) : new Uint8Array(Math.ceil(count / 8));
  }
  has(i: number): boolean {
    return ((this.bits[i >>> 3]! >>> (i & 7)) & 1) === 1;
  }
  set(i: number): void {
    this.bits[i >>> 3]! |= 1 << (i & 7);
  }
  clear(i: number): void {
    this.bits[i >>> 3]! &= ~(1 << (i & 7));
  }
  get size(): number {
    let n = 0;
    for (const b of this.bits) n += popcount(b);
    return n;
  }
  get complete(): boolean {
    return this.size === this.count;
  }
  missing(limit = Infinity): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count && out.length < limit; i++) if (!this.has(i)) out.push(i);
    return out;
  }
  serialize(): Uint8Array {
    return Uint8Array.from(this.bits);
  }
}

function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55);
  x = (x & 0x33) + ((x >> 2) & 0x33);
  return (x + (x >> 4)) & 0x0f;
}

export { K, L, BLOCK };

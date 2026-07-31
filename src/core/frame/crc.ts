/**
 * CRC-8 (poly 0x31) for per-packet rejection, CRC-32 (IEEE) for streamId.
 *
 * CRC-8's residual is 1/256 (§7.1) — it is a cheap first filter, NOT integrity.
 * Integrity is the per-block hash, and invariant I9 requires a block that reaches
 * rank K but fails its hash to be discarded entirely (edge case E12).
 */

const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

export function crc8(bytes: Uint8Array, from = 0, to = bytes.length): number {
  let c = 0xff;
  for (let i = from; i < to; i++) c = CRC8_TABLE[(c ^ bytes[i]!) & 0xff]!;
  return c;
}

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

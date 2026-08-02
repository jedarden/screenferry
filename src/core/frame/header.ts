/**
 * 13-byte packet header — §7.1 / D21.
 *
 * File-level metadata deliberately lives in the beacon, not here: a 3-byte block
 * index would otherwise have cost 23% more header. Payload packets carry only what
 * is needed to PLACE BYTES.
 *
 *   0  1  magic_ver   4-bit magic + 4-bit wire version (fast reject only, §16.3)
 *   1  1  flags
 *   2  4  streamId    identifies the FILE; seeds the PRNG
 *   6  3  blockIndex  16.7M blocks
 *   9  3  seq         within the block
 *  12  1  fcrc        CRC-8 over bytes 0..11
 */

import { HEADER, MAGIC, MAGIC_VER, PACKET, WIRE_VERSION } from '../params.js';
import { crc8 } from './crc.js';

/**
 * Validation error for packet header version mismatch.
 *
 * Thrown when a packet's wire version nibble doesn't match the receiver's
 * expected version, as required by §16.3's version refusal rule.
 */
export class PacketVersionError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: { senderVersion: number; receiverVersion: number }
  ) {
    super(message);
    this.name = 'PacketVersionError';
  }
}

export interface PacketHeader {
  wireVersion: number;
  flags: number;
  streamId: number;
  blockIndex: number;
  seq: number;
}

export function writePacket(h: PacketHeader, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(HEADER + payload.length);
  out[0] = (MAGIC << 4) | (h.wireVersion & 0x0f);
  out[1] = h.flags & 0xff;
  out[2] = (h.streamId >>> 24) & 0xff;
  out[3] = (h.streamId >>> 16) & 0xff;
  out[4] = (h.streamId >>> 8) & 0xff;
  out[5] = h.streamId & 0xff;
  out[6] = (h.blockIndex >>> 16) & 0xff;
  out[7] = (h.blockIndex >>> 8) & 0xff;
  out[8] = h.blockIndex & 0xff;
  out[9] = (h.seq >>> 16) & 0xff;
  out[10] = (h.seq >>> 8) & 0xff;
  out[11] = h.seq & 0xff;
  out[12] = crc8(out, 0, 12);
  out.set(payload, HEADER);
  return out;
}

/**
 * Parse and validate. Returns null for anything suspect — invariant I8 requires a
 * packet failing fcrc or magic to be DISCARDED, never applied. Throws
 * PacketVersionError when the version nibble doesn't match, as required by §16.3.
 */
export function readPacket(
  bytes: Uint8Array,
  expectLen = PACKET,
): { header: PacketHeader; payload: Uint8Array } | null {
  if (bytes.length !== expectLen) return null;
  if ((bytes[0]! >>> 4) !== MAGIC) return null;

  // §16.3: Refuse packets with unknown wire version - never attempt a partial parse.
  // The header's 4-bit nibble is a fast reject; the beacon's 1-byte wireVersion is
  // authoritative. When the nibble doesn't match, we must report E-VERSION and refuse.
  const wireVersion = bytes[0]! & 0x0f;
  if (wireVersion !== (WIRE_VERSION & 0x0f)) {
    throw new PacketVersionError(
      'E-VERSION',
      `Wire version mismatch: sender is ${wireVersion}, receiver is ${WIRE_VERSION}`,
      { senderVersion: wireVersion, receiverVersion: WIRE_VERSION }
    );
  }

  if (crc8(bytes, 0, 12) !== bytes[12]) return null;
  return {
    header: {
      wireVersion,
      flags: bytes[1]!,
      streamId:
        ((bytes[2]! << 24) | (bytes[3]! << 16) | (bytes[4]! << 8) | bytes[5]!) >>> 0,
      blockIndex: (bytes[6]! << 16) | (bytes[7]! << 8) | bytes[8]!,
      seq: (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!,
    },
    payload: bytes.subarray(HEADER),
  };
}

/** Is this nibble worth parsing a beacon for? §16.3 — a match is NOT compatibility. */
export const nibbleMatches = (b: Uint8Array): boolean => b.length > 0 && b[0] === MAGIC_VER;

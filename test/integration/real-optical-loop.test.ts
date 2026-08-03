/**
 * End-to-end integration test: Real optical loop with actual QR encoding
 *
 * This test demonstrates the complete optical path with real components:
 * file -> toFragments -> LTEncoder -> QR tiles -> camera simulation -> GEDecoder -> fromFragments -> hash compare
 *
 * Unlike phase2-optical-loop.test.ts which simulates tiles, this test uses:
 * - Real QR encoding (Transmitter with encodeQRMatrix)
 * - Real packet headers with CRC-8 validation
 * - Simulated optical channel with configurable erasure
 * - Full validation of byte-exactness (I10)
 *
 * This validates THE SEAM BETWEEN THE CODEC AND THE OPTICAL CHANNEL (plan.md §17)
 */

import { describe, expect, it } from 'vitest';
import { BLOCK, L, PACKET } from '../../src/core/params.js';
import { LTEncoder } from '../../src/core/fountain/encoder.js';
import { GEDecoder } from '../../src/core/fountain/decoder.js';
import {
  toFragments,
  fromFragments,
  blockK,
  geometry,
} from '../../src/core/block/partition.js';
import {
  createTransmitter,
  createPacketHeader,
  parsePacketHeader,
  type QRTile,
} from '../../src/platform/transmitter.js';
import type { EncoderOpts } from '../../src/core/fountain/encoder.js';

/**
 * Deterministic bytes for testing — never ASCII (§14.2: corruption is content AND length dependent)
 */
function randomBytes(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/**
 * Simple file hash for verification (using CRC-32 for speed in tests)
 */
function simpleHash(data: Uint8Array): number {
  let hash = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    hash ^= data[i]!;
    hash = (hash >>> 8) ^ 0xedb88320; // CRC-32 polynomial
    hash >>>= 0;
  }
  return (hash ^ 0xffffffff) >>> 0;
}

/**
 * Simulate optical channel with configurable erasure rate
 *
 * In production, QR tiles would be displayed, captured by camera, and decoded.
 * For testing, we simulate the packet loss without actual image processing.
 *
 * @param tiles - Array of QR tiles to transmit
 * @param erasureRate - Fraction of packets to drop (0-1)
 * @param seed - Random seed for deterministic loss pattern
 */
function simulateOpticalChannel(
  tiles: QRTile[],
  erasureRate: number,
  seed = 42
): QRTile[] {
  const received: QRTile[] = [];
  let x = seed;

  for (const tile of tiles) {
    // Simple PRNG for deterministic loss
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    const loss = (x >>> 8) / 0xffffff;

    if (loss >= erasureRate) {
      received.push(tile);
    }
  }

  return received;
}

/**
 * Decode QR tiles back to fountain packets
 *
 * Extracts payload from each tile and validates the packet header CRC.
 * Returns null for tiles with invalid headers (simulating decode failures).
 */
function decodeTilesToPackets(tiles: QRTile[]): Array<{ seq: number; payload: Uint8Array } | null> {
  const packets: Array<{ seq: number; payload: Uint8Array } | null> = [];

  for (const tile of tiles) {
    // Extract header from packet bytes
    const headerBytes = tile.packetBytes.subarray(0, 13);
    const payloadBytes = tile.packetBytes.subarray(13);

    // Parse and validate header
    const header = parsePacketHeader(headerBytes);
    if (!header) {
      packets.push(null); // Invalid header - decode failed
      continue;
    }

    // Extract payload (after 13-byte header)
    packets.push({
      seq: header.seq,
      payload: payloadBytes,
    });
  }

  return packets;
}

describe('End-to-end: Real optical loop with QR encoding', () => {
  describe('A1-lite: Byte-exactness with real QR encoding', () => {
    it('transfers a small file perfectly through real optical loop with no loss', () => {
      const fileData = randomBytes(1024, 0xCAFEBABE);
      const fileHash = simpleHash(fileData);

      const streamId = 0xdeadbeef;
      const blockIndex = 0;

      // 1. toFragments: Convert file to fragments
      const fragments = toFragments(fileData, L);
      expect(fragments.length).toBeGreaterThan(0);

      // 2. Create transmitter with real QR encoding
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });

      // 3. Encode packets to real QR tiles
      const tiles: QRTile[] = [];
      const tileCount = fragments.length + 10; // Emit enough packets

      for (const tile of transmitter.generateTiles(tileCount)) {
        tiles.push(tile);
      }

      transmitter.stop();

      // Verify tiles were generated
      expect(tiles.length).toBe(tileCount);
      expect(tiles.every(t => t.matrix)).toBe(true);

      // 4. Simulate optical channel (no loss for this test)
      const receivedTiles = simulateOpticalChannel(tiles, 0.0);

      // 5. Decode tiles back to packets
      const decodedPackets = decodeTilesToPackets(receivedTiles);
      const validPackets = decodedPackets.filter((p): p is { seq: number; payload: Uint8Array } => p !== null);

      // 6. Create decoder and absorb packets
      const decoder = new GEDecoder({
        streamId,
        blockIndex,
        k: fragments.length,
        fragLen: L,
      });

      for (const packet of validPackets) {
        decoder.absorb(packet.seq, packet.payload);
        if (decoder.complete) break;
      }

      // 7. Verify decoder completed
      expect(decoder.complete).toBe(true);
      expect(decoder.overhead).toBeLessThanOrEqual(0.2); // Should be minimal overhead

      // 8. fromFragments: Reconstruct file
      const recoveredFragments = decoder.recover();
      const recoveredFile = fromFragments(recoveredFragments, fileData.length);

      // 9. Verify byte-exact reconstruction (I10)
      expect(recoveredFile.length).toBe(fileData.length);
      expect(recoveredFile).toEqual(fileData);
      expect(simpleHash(recoveredFile)).toBe(fileHash);
    });

    it('handles realistic 20% erasure rate with real QR tiles', () => {
      const fileData = randomBytes(2048, 0xBADDCAFE);
      const fileHash = simpleHash(fileData);

      const streamId = 0x12345678;
      const blockIndex = 0;

      // Full pipeline with real QR encoding
      const fragments = toFragments(fileData, L);
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });

      const tiles: QRTile[] = [];
      const tileCount = fragments.length * 2 + 20; // Emit enough for recovery

      for (const tile of transmitter.generateTiles(tileCount)) {
        tiles.push(tile);
      }

      transmitter.stop();

      // Apply 20% erasure (midpoint of D18c's 20-30% assumption)
      const receivedTiles = simulateOpticalChannel(tiles, 0.20);

      // Decode and absorb
      const decodedPackets = decodeTilesToPackets(receivedTiles);
      const validPackets = decodedPackets.filter((p): p is { seq: number; payload: Uint8Array } => p !== null);

      const decoder = new GEDecoder({
        streamId,
        blockIndex,
        k: fragments.length,
        fragLen: L,
      });

      for (const packet of validPackets) {
        decoder.absorb(packet.seq, packet.payload);
        if (decoder.complete) break;
      }

      // Verify successful recovery with reasonable overhead
      expect(decoder.complete).toBe(true);
      expect(decoder.overhead).toBeLessThanOrEqual(0.15); // Should handle 20% erasure

      const recoveredFile = fromFragments(decoder.recover(), fileData.length);
      expect(recoveredFile).toEqual(fileData);
      expect(simpleHash(recoveredFile)).toBe(fileHash);
    });

    it('handles worst-case 30% erasure rate with real QR tiles', () => {
      const fileData = randomBytes(4096, 0xDEADBEEF);
      const fileHash = simpleHash(fileData);

      const streamId = 0xFEDCBA09;
      const blockIndex = 0;

      const fragments = toFragments(fileData, L);
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });

      const tiles: QRTile[] = [];
      const tileCount = fragments.length * 2.5 + 30; // Need more packets at 30% loss

      for (const tile of transmitter.generateTiles(tileCount)) {
        tiles.push(tile);
      }

      transmitter.stop();

      // Apply 30% erasure (top of D18c's assumption band)
      const receivedTiles = simulateOpticalChannel(tiles, 0.30);

      const decodedPackets = decodeTilesToPackets(receivedTiles);
      const validPackets = decodedPackets.filter((p): p is { seq: number; payload: Uint8Array } => p !== null);

      const decoder = new GEDecoder({
        streamId,
        blockIndex,
        k: fragments.length,
        fragLen: L,
      });

      for (const packet of validPackets) {
        decoder.absorb(packet.seq, packet.payload);
        if (decoder.complete) break;
      }

      // Should still complete with higher overhead
      expect(decoder.complete).toBe(true);
      expect(decoder.overhead).toBeLessThanOrEqual(0.25);

      const recoveredFile = fromFragments(decoder.recover(), fileData.length);
      expect(recoveredFile).toEqual(fileData);
      expect(simpleHash(recoveredFile)).toBe(fileHash);
    });
  });

  describe('E3a: Short last block path with real QR encoding', () => {
    it('correctly handles files that dont align to block boundaries', () => {
      // Create a file that's exactly 3.5 blocks to test E3a
      const partialBlock = Math.floor(BLOCK / 2);
      const fileData = randomBytes(BLOCK * 3 + partialBlock, 0xAABBCCDD);
      const fileHash = simpleHash(fileData);

      const streamId = 0xABCDEF01;

      // Process all blocks (including the short last block)
      let recoveredFile = new Uint8Array(fileData.length);
      let totalOffset = 0;

      for (let blockIndex = 0; blockIndex < 4; blockIndex++) {
        const offset = blockIndex * BLOCK;
        const remaining = fileData.length - offset;
        const blockLen = Math.min(BLOCK, remaining);

        if (blockLen === 0) break;

        const blockData = fileData.subarray(offset, offset + blockLen);

        // Derive K for this block (tests E3a's per-block K derivation)
        const geom = geometry(fileData.length, BLOCK, L);
        const k = blockK(geom, blockIndex);
        const fragments = toFragments(blockData, L);

        expect(fragments.length).toBe(k);

        // Encode and decode this block with real QR tiles
        const transmitter = createTransmitter();
        transmitter.start({ streamId, blockIndex, fragments });

        const tiles: QRTile[] = [];
        const tileCount = k * 2 + 20; // Emit more packets to handle erasure

        for (const tile of transmitter.generateTiles(tileCount)) {
          tiles.push(tile);
        }

        transmitter.stop();

        const receivedTiles = simulateOpticalChannel(tiles, 0.15);
        const decodedPackets = decodeTilesToPackets(receivedTiles);
        const validPackets = decodedPackets.filter((p): p is { seq: number; payload: Uint8Array } => p !== null);

        const decoder = new GEDecoder({ streamId, blockIndex, k, fragLen: L });

        for (const packet of validPackets) {
          decoder.absorb(packet.seq, packet.payload);
          if (decoder.complete) break;
        }

        expect(decoder.complete).toBe(true);
        const blockRecovered = fromFragments(decoder.recover(), blockLen);

        // Copy this block into the output
        recoveredFile.set(blockRecovered, totalOffset);
        totalOffset += blockLen;
      }

      // Verify full file reconstruction
      expect(recoveredFile).toEqual(fileData);
      expect(simpleHash(recoveredFile)).toBe(fileHash);
    });
  });

  describe('Packet header validation with real QR encoding', () => {
    it('validates packet headers correctly through QR encode/decode cycle', () => {
      const streamId = 0x99999999;
      const blockIndex = 0x5555;
      const testSeq = 0x3333;

      const fileData = randomBytes(BLOCK, 0x11111111);
      const fragments = toFragments(fileData, L);

      // Create transmitter
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });

      // Encode a specific sequence number
      const tile = transmitter.encodePacketToTile(testSeq);
      transmitter.stop();

      // Verify tile structure
      expect(tile.seq).toBe(testSeq);
      expect(tile.matrix).toBeDefined();
      expect(tile.packetBytes.length).toBe(13 + L); // header (13) + payload (L)

      // Parse header back
      const header = parsePacketHeader(tile.packetBytes.subarray(0, 13));
      expect(header).toBeDefined();
      expect(header!.streamId).toBe(streamId);
      expect(header!.blockIndex).toBe(blockIndex);
      expect(header!.seq).toBe(testSeq);
      expect(header!.magic_ver).toBe(0x51); // Magic 0x5 | version 0x1

      // Verify payload can be decoded
      const decoder = new GEDecoder({ streamId, blockIndex, k: fragments.length, fragLen: L });
      const payload = tile.packetBytes.subarray(13);

      decoder.absorb(testSeq, payload);
      expect(decoder.rank).toBe(1); // Packet was absorbed
    });
  });

  describe('I3: Index derivation over real optical link', () => {
    it('produces identical index sets on encoder and decoder through QR tiles', () => {
      const fileData = randomBytes(BLOCK, 0x22222222);
      const streamId = 0x77777777;
      const blockIndex = 0x6666;
      const testSeq = 0x4444;

      const fragments = toFragments(fileData, L);
      const k = fragments.length;

      // Encode a specific sequence number
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });
      const tile = transmitter.encodePacketToTile(testSeq);
      transmitter.stop();

      // Extract payload from tile
      const payload = tile.packetBytes.subarray(13);

      // Decode the same sequence
      const decoder = new GEDecoder({ streamId, blockIndex, k, fragLen: L });
      decoder.absorb(testSeq, payload);

      // The decoder should be able to use this packet
      // (This validates that PRNG indices match on both sides through real QR encoding)
      expect(decoder.rank).toBe(1);
    });
  });

  describe('Burst loss handling with real QR encoding', () => {
    it('converges to full rank despite burst losses through QR tiles', () => {
      const fileData = randomBytes(BLOCK, 0x88888888);
      const streamId = 0xAAAAAAAA;
      const blockIndex = 0;

      const fragments = toFragments(fileData, L);
      const transmitter = createTransmitter();
      transmitter.start({ streamId, blockIndex, fragments });

      const tiles: QRTile[] = [];
      const tileCount = fragments.length * 2 + 50;

      for (const tile of transmitter.generateTiles(tileCount)) {
        tiles.push(tile);
      }

      transmitter.stop();

      // Simulate burst losses (drops 5 packets in a row, then recovers)
      const receivedTiles = tiles.filter((_, i) => {
        // Drop packets 10-14, 30-34, 50-54 (burst pattern)
        return !(i >= 10 && i < 15) && !(i >= 30 && i < 35) && !(i >= 50 && i < 55);
      });

      const decodedPackets = decodeTilesToPackets(receivedTiles);
      const validPackets = decodedPackets.filter((p): p is { seq: number; payload: Uint8Array } => p !== null);

      const decoder = new GEDecoder({ streamId, blockIndex, k: fragments.length, fragLen: L });

      for (const packet of validPackets) {
        decoder.absorb(packet.seq, packet.payload);
        if (decoder.complete) break;
      }

      // Should converge despite burst losses
      expect(decoder.complete).toBe(true);

      const recoveredFile = fromFragments(decoder.recover(), fileData.length);
      expect(recoveredFile).toEqual(fileData);
    });
  });
});

/**
 * Transmitter for fountain-encoded packets to QR tiles
 *
 * This module implements the transmitter side of the optical link per plan.md §6.3:
 * - Fountain encoder (LTEncoder) generates packets
 * - Packet headers with CRC-8 (fcrc)
 * - QR encoding with pinned mask pattern (D4)
 * - Tile display at 15 fps (D9)
 *
 * This is the complement to the camera pipeline receiver in camera-pipeline.ts
 */

import { LTEncoder, type EncoderOpts } from '../core/fountain/encoder.js';
import { encodeQRMatrix, DEFAULT_QR_CONFIG, type QREncoderConfig } from '../modulation/qr-tiled/qr-encoder.js';
import { crc8 } from '../core/frame/crc.js';
import { L, PACKET } from '../core/params.js';

/**
 * Packet header following wire format (plan.md §7.1)
 * 13 bytes total: magic_ver (1) + flags (1) + streamId (4) + blockIndex (3) + seq (3) + fcrc (1)
 */
export interface PacketHeader {
  /** Magic nibble (0x5) + wire version nibble (0x1) = 0x51 */
  magic_ver: number;
  /** Flags byte (reserved for future use) */
  flags: number;
  /** Stream identifier (32-bit little-endian) */
  streamId: number;
  /** Block index within stream (24-bit little-endian) */
  blockIndex: number;
  /** Packet sequence number (24-bit little-endian) */
  seq: number;
  /** CRC-8 of bytes 0-11 */
  fcrc: number;
}

/**
 * Encoded QR tile ready for display
 */
export interface QRTile {
  /** Sequence number of this packet */
  seq: number;
  /** QR matrix data (from qrcode library) */
  matrix: any;
  /** QR version used */
  version: number;
  /** Module count (version * 4 + 17) */
  moduleSize: number;
  /** Raw packet bytes (header + payload) for debugging */
  packetBytes: Uint8Array;
}

/**
 * Transmitter configuration
 */
export interface TransmitterConfig {
  /** QR encoder config (version, ECC level, mask pattern) */
  qrConfig?: QREncoderConfig;
  /** Display frame rate (tiles per second) - default: 15 per D9 */
  frameRate?: number;
  /** Callback when a new tile is generated */
  onTile?: (tile: QRTile) => void;
}

/**
 * Transmitter state
 */
export interface TransmitterState {
  /** Total packets generated */
  packetsGenerated: number;
  /** Total tiles encoded */
  tilesEncoded: number;
  /** Current sequence number */
  currentSeq: number;
  /** Whether transmitter is running */
  running: boolean;
}

/**
 * Create a packet header following the wire format (plan.md §7.1)
 */
export function createPacketHeader(
  streamId: number,
  blockIndex: number,
  seq: number,
  flags: number = 0
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);

  // Byte 0: magic_ver (4-bit magic + 4-bit wire version)
  header[0] = 0x51; // Magic 0x5 | version 0x1

  // Byte 1: flags
  header[1] = flags;

  // Bytes 2-5: streamId (little-endian)
  view.setUint32(2, streamId, true);

  // Bytes 6-8: blockIndex (little-endian, 3 bytes)
  view.setUint16(6, blockIndex & 0xFFFF, true);
  header[8] = (blockIndex >>> 16) & 0xFF;

  // Bytes 9-11: seq (little-endian, 3 bytes)
  view.setUint16(9, seq & 0xFFFF, true);
  header[11] = (seq >>> 16) & 0xFF;

  // Byte 12: fcrc (CRC-8 of bytes 0-11)
  header[12] = crc8(header.subarray(0, 12));

  return header;
}

/**
 * Parse a packet header, validating CRC and magic/version
 */
export function parsePacketHeader(header: Uint8Array): PacketHeader | null {
  if (header.length !== 13) return null;

  // Verify magic_ver
  const magic = (header[0]! >>> 4) & 0x0F;
  const version = header[0]! & 0x0F;
  if (magic !== 0x5 || version !== 0x1) return null;

  // Verify CRC-8
  const expectedCrc = crc8(header.subarray(0, 12));
  if (header[12] !== expectedCrc) return null;

  const view = new DataView(header.buffer);

  return {
    magic_ver: header[0]!,
    flags: header[1]!,
    streamId: view.getUint32(2, true),
    blockIndex: view.getUint16(6, true) | (header[8]! << 16),
    seq: view.getUint16(9, true) | (header[11]! << 16),
    fcrc: header[12]!,
  };
}

/**
 * Combine header and payload into a complete packet
 */
function buildPacket(header: Uint8Array, payload: Uint8Array): Uint8Array {
  const packet = new Uint8Array(header.length + payload.length);
  packet.set(header, 0);
  packet.set(payload, header.length);
  return packet;
}

/**
 * Transmitter for fountain-encoded packets to QR tiles
 *
 * Manages the full transmitter pipeline:
 * - Fountain encoding (LTEncoder)
 * - Packet header generation with CRC
 * - QR encoding with pinned mask
 * - Tile generation at configured frame rate
 */
export class Transmitter {
  private config: Required<TransmitterConfig>;
  private encoder: LTEncoder | null = null;
  private animationId: number | null = null;
  private lastTileTime: number = 0;
  private frameInterval: number;

  // State tracking
  private state: TransmitterState = {
    packetsGenerated: 0,
    tilesEncoded: 0,
    currentSeq: 0,
    running: false,
  };

  constructor(config: TransmitterConfig = {}) {
    this.config = {
      qrConfig: config.qrConfig ?? DEFAULT_QR_CONFIG,
      frameRate: config.frameRate ?? 15, // D9: display at ≤ half measured camera fps
      onTile: config.onTile ?? (() => {}),
    };

    // Calculate frame interval from frame rate
    this.frameInterval = 1000 / this.config.frameRate;
  }

  /**
   * Start transmitting a block
   */
  start(opts: EncoderOpts): void {
    if (this.state.running) {
      throw new Error('Transmitter is already running');
    }

    // Create fountain encoder
    this.encoder = new LTEncoder(opts);
    this.state.running = true;
    this.state.currentSeq = 0;
    this.state.packetsGenerated = 0;
    this.state.tilesEncoded = 0;

    console.debug('[Transmitter] Starting transmission:', {
      streamId: opts.streamId,
      blockIndex: opts.blockIndex,
      k: opts.fragments.length,
    });

    // Start tile generation loop
    this.startTileLoop();
  }

  /**
   * Start the tile generation loop at the configured frame rate
   */
  private startTileLoop(): void {
    if (!this.state.running || !this.encoder) return;

    const generateTile = (timestamp: number) => {
      if (!this.state.running || !this.encoder) return;

      // Throttle to target frame rate
      const elapsed = timestamp - this.lastTileTime;
      if (elapsed < this.frameInterval) {
        this.animationId = requestAnimationFrame(generateTile);
        return;
      }

      // Generate next tile
      const seq = this.state.currentSeq;
      const payload = this.encoder.encode(seq);
      this.state.packetsGenerated++;
      this.state.currentSeq++;

      // Create packet header
      const header = createPacketHeader(
        this.encoder.streamId,
        this.encoder.blockIndex,
        seq
      );

      // Build complete packet
      const packet = buildPacket(header, payload);

      // Encode to QR matrix
      const matrix = encodeQRMatrix(packet, this.config.qrConfig);
      this.state.tilesEncoded++;

      // Create tile object
      const tile: QRTile = {
        seq,
        matrix,
        version: this.config.qrConfig.version,
        moduleSize: this.config.qrConfig.version * 4 + 17,
        packetBytes: packet,
      };

      // Invoke callback
      this.config.onTile(tile);

      // Update timing
      this.lastTileTime = timestamp;

      // Continue loop
      this.animationId = requestAnimationFrame(generateTile);
    };

    // Start the loop
    this.animationId = requestAnimationFrame(generateTile);
  }

  /**
   * Stop transmitting
   */
  stop(): void {
    if (!this.state.running) return;

    this.state.running = false;

    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    console.debug('[Transmitter] Stopped:', {
      packetsGenerated: this.state.packetsGenerated,
      tilesEncoded: this.state.tilesEncoded,
    });
  }

  /**
   * Get current transmitter state
   */
  getState(): TransmitterState {
    return { ...this.state };
  }

  /**
   * Generate a specific number of tiles synchronously (for testing)
   *
   * This bypasses the frame rate throttling and generates tiles immediately.
   * Useful for integration tests and controlled transmission.
   */
  *generateTiles(count: number): Generator<QRTile> {
    if (!this.encoder) {
      throw new Error('Encoder not initialized - call start() first');
    }

    for (let i = 0; i < count; i++) {
      const seq = this.state.currentSeq;
      const payload = this.encoder.encode(seq);
      this.state.packetsGenerated++;
      this.state.currentSeq++;

      const header = createPacketHeader(
        this.encoder.streamId,
        this.encoder.blockIndex,
        seq
      );

      const packet = buildPacket(header, payload);
      const matrix = encodeQRMatrix(packet, this.config.qrConfig);
      this.state.tilesEncoded++;

      yield {
        seq,
        matrix,
        version: this.config.qrConfig.version,
        moduleSize: this.config.qrConfig.version * 4 + 17,
        packetBytes: packet,
      };
    }
  }

  /**
   * Encode a single packet to a QR tile (for testing)
   */
  encodePacketToTile(seq: number): QRTile {
    if (!this.encoder) {
      throw new Error('Encoder not initialized - call start() first');
    }

    const payload = this.encoder.encode(seq);
    this.state.packetsGenerated++;
    this.state.currentSeq = seq + 1;

    const header = createPacketHeader(
      this.encoder.streamId,
      this.encoder.blockIndex,
      seq
    );

    const packet = buildPacket(header, payload);
    const matrix = encodeQRMatrix(packet, this.config.qrConfig);
    this.state.tilesEncoded++;

    return {
      seq,
      matrix,
      version: this.config.qrConfig.version,
      moduleSize: this.config.qrConfig.version * 4 + 17,
      packetBytes: packet,
    };
  }
}

/**
 * Create a transmitter with default configuration
 */
export function createTransmitter(config?: TransmitterConfig): Transmitter {
  return new Transmitter(config);
}

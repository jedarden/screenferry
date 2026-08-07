/**
 * Simple encode function for roundtrip testing.
 *
 * Provides a straightforward interface for encoding data without
 * the complexity of the full BlockEncodePipeline. This is useful
 * for basic roundtrip tests and simple use cases.
 *
 * Reference: plan.md §8.1, D19, D24
 */

import { BLOCK, L } from '../params.js';
import { LTEncoder, type EncoderOpts } from '../fountain/encoder.js';
import { GEDecoder, type DecoderOpts } from '../fountain/decoder.js';
import { geometry, blockRange, toFragments, fromFragments, type BlockGeometry } from './partition.js';

/**
 * Simple encode result.
 */
export interface SimpleEncodeResult {
  /** Encoded packets for transmission */
  packets: Array<{ seq: number; payload: Uint8Array }>;
  /** Block geometry information */
  geometry: BlockGeometry;
  /** Number of source fragments */
  fragmentCount: number;
}

/**
 * Simple encode options.
 */
export interface SimpleEncodeOptions {
  /** Stream identifier (required) */
  streamId: number;
  /** Block index (default: 0) */
  blockIndex?: number;
  /** Number of packets to generate (default: fragmentCount + 50) */
  packetCount?: number;
  /** Starting sequence number (default: 0) */
  startSeq?: number;
}

/**
 * Encode simple input data for roundtrip testing.
 *
 * This function provides a straightforward way to encode data
 * without needing to set up the full BlockEncodePipeline.
 * It's designed for basic roundtrip tests and simple use cases.
 *
 * @param inputData - Raw input data to encode
 * @param options - Encoding options
 * @returns Encoded packets and metadata
 *
 * @example
 * ```ts
 * const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
 * const result = encode(data, { streamId: 1, packetCount: 10 });
 * console.log(`Generated ${result.packets.length} packets`);
 * ```
 */
export function encode(
  inputData: Uint8Array,
  options: SimpleEncodeOptions
): SimpleEncodeResult {
  // Validate input
  if (!inputData || inputData.length === 0) {
    throw new Error('encode: input data is empty');
  }

  if (typeof options.streamId !== 'number') {
    throw new Error('encode: streamId is required');
  }

  // Use default options
  const blockIndex = options.blockIndex ?? 0;
  const startSeq = options.startSeq ?? 0;

  // Calculate block geometry
  const geom = geometry(inputData.length, BLOCK, L);

  // Get block byte range (for single block, this is the entire input)
  const { start, end } = blockRange(geom, blockIndex);
  const blockData = inputData.subarray(start, end);

  // Split into fragments
  const fragments = toFragments(blockData, L);

  // Create fountain encoder
  const encoderOpts: EncoderOpts = {
    streamId: options.streamId,
    blockIndex,
    fragments,
  };

  const encoder = new LTEncoder(encoderOpts);

  // Generate packets
  const packetCount = options.packetCount ?? (fragments.length + 50);
  const packets: Array<{ seq: number; payload: Uint8Array }> = [];

  for (let i = 0; i < packetCount; i++) {
    const seq = startSeq + i;
    const payload = encoder.encode(seq);
    packets.push({ seq, payload });
  }

  return {
    packets,
    geometry: geom,
    fragmentCount: fragments.length,
  };
}

/**
 * Encode multiple blocks from input data.
 *
 * This function encodes all blocks in the input data,
 * generating packets for each block.
 *
 * @param inputData - Raw input data to encode
 * @param options - Encoding options
 * @returns Array of encode results, one per block
 *
 * @example
 * ```ts
 * const data = new Uint8Array(2 * BLOCK); // 2 blocks
 * const results = encodeMultiBlock(data, { streamId: 1, packetCount: 10 });
 * console.log(`Encoded ${results.length} blocks`);
 * ```
 */
export function encodeMultiBlock(
  inputData: Uint8Array,
  options: SimpleEncodeOptions
): SimpleEncodeResult[] {
  // Calculate block geometry
  const geom = geometry(inputData.length, BLOCK, L);

  const results: SimpleEncodeResult[] = [];

  // Encode each block
  for (let blockIndex = 0; blockIndex < geom.blockCount; blockIndex++) {
    const result = encode(inputData, {
      ...options,
      blockIndex,
    });
    results.push(result);
  }

  return results;
}

/**
 * Encode a single block from larger input data.
 *
 * This function encodes only one block from the input data,
 * specified by block index. Useful for selective encoding.
 *
 * @param inputData - Raw input data containing multiple blocks
 * @param blockIndex - Which block to encode (0-based)
 * @param options - Encoding options
 * @returns Encode result for the specified block
 *
 * @example
 * ```ts
 * const data = new Uint8Array(5 * BLOCK); // 5 blocks
 * const result = encodeSingleBlock(data, 2, { streamId: 1 });
 * console.log(`Encoded block 2 with ${result.packets.length} packets`);
 * ```
 */
export function encodeSingleBlock(
  inputData: Uint8Array,
  blockIndex: number,
  options: SimpleEncodeOptions
): SimpleEncodeResult {
  // Calculate block geometry to validate block index
  const geom = geometry(inputData.length, BLOCK, L);

  if (blockIndex < 0 || blockIndex >= geom.blockCount) {
    throw new Error(
      `encodeSingleBlock: block index ${blockIndex} out of range [0, ${geom.blockCount})`
    );
  }

  return encode(inputData, {
    ...options,
    blockIndex,
  });
}

/**
 * Simple decode result.
 */
export interface SimpleDecodeResult {
  /** Decoded data */
  data: Uint8Array;
  /** Whether decoding was successful */
  success: boolean;
  /** Number of packets used for decoding */
  packetsUsed: number;
  /** Reception overhead (packetsUsed / K) */
  overhead: number;
  /** Block geometry information */
  geometry: BlockGeometry;
}

/**
 * Simple decode options.
 */
export interface SimpleDecodeOptions {
  /** Stream identifier (required) */
  streamId: number;
  /** Block index (default: 0) */
  blockIndex?: number;
  /** Expected file size (required for multi-block files) */
  fileSize?: number;
  /** Block geometry (optional, will be calculated if not provided) */
  geometry?: BlockGeometry;
}

/**
 * Decode fountain packets back to original data.
 *
 * This function provides a straightforward way to decode fountain-encoded packets
 * without needing to set up the full BlockDecodePipeline.
 * It's designed for basic roundtrip tests and simple use cases.
 *
 * @param packets - Encoded packets from encode() function
 * @param options - Decoding options
 * @returns Decoded data with success status
 *
 * @example
 * ```ts
 * const encoded = encode(data, { streamId: 1, packetCount: 100 });
 * const decoded = decode(encoded.packets, { streamId: 1, fileSize: data.length });
 * console.log(`Decoded ${decoded.data.length} bytes, success=${decoded.success}`);
 * ```
 */
export function decode(
  packets: Array<{ seq: number; payload: Uint8Array }>,
  options: SimpleDecodeOptions
): SimpleDecodeResult {
  // Validate input
  if (!packets || packets.length === 0) {
    throw new Error('decode: no packets provided');
  }

  if (typeof options.streamId !== 'number' || Number.isNaN(options.streamId)) {
    throw new Error('decode: streamId is required and must be a valid number');
  }

  // Use default options
  const blockIndex = options.blockIndex ?? 0;

  // Calculate or use provided geometry
  let geom: BlockGeometry;
  if (options.geometry) {
    geom = options.geometry;
  } else if (options.fileSize) {
    geom = geometry(options.fileSize, BLOCK, L);
  } else {
    throw new Error('decode: either fileSize or geometry must be provided');
  }

  // Get block byte range
  const { start, end } = blockRange(geom, blockIndex);
  const blockSize = end - start;

  // Calculate K (number of source fragments)
  const k = Math.max(1, Math.ceil(blockSize / L));

  // Create decoder
  const decoderOpts: DecoderOpts = {
    streamId: options.streamId,
    blockIndex,
    k,
    fragLen: L,
  };

  const decoder = new GEDecoder(decoderOpts);

  // Feed all packets to decoder
  let packetsUsed = 0;
  for (const packet of packets) {
    const result = decoder.absorb(packet.seq, packet.payload);
    if (result) {
      packetsUsed++;
    }
  }

  // Check if decoding succeeded
  if (!decoder.complete) {
    return {
      data: new Uint8Array(0),
      success: false,
      packetsUsed,
      overhead: decoder.overhead,
      geometry: geom,
    };
  }

  // Recover fragments
  const fragments = decoder.recover();

  // Reassemble block from fragments
  const blockData = fromFragments(fragments, blockSize);

  return {
    data: blockData,
    success: true,
    packetsUsed,
    overhead: decoder.overhead,
    geometry: geom,
  };
}

/**
 * Decode multiple blocks from packets.
 *
 * This function decodes multiple blocks from an array of packet arrays.
 * Each block's packets are decoded independently.
 *
 * @param packetsPerBlock - Array of packet arrays, one per block
 * @param options - Decoding options
 * @returns Array of decode results, one per block
 *
 * @example
 * ```ts
 * const data = new Uint8Array(2 * BLOCK); // 2 blocks
 * const encoded = encodeMultiBlock(data, { streamId: 1 });
 * const results = decodeMultiBlock(encoded.map(r => r.packets), { streamId: 1, fileSize: data.length });
 * console.log(`Decoded ${results.length} blocks`);
 * ```
 */
export function decodeMultiBlock(
  packetsPerBlock: Array<Array<{ seq: number; payload: Uint8Array }>>,
  options: SimpleDecodeOptions
): SimpleDecodeResult[] {
  if (!options.fileSize) {
    throw new Error('decodeMultiBlock: fileSize is required for multi-block decoding');
  }

  const results: SimpleDecodeResult[] = [];

  // Decode each block
  for (let blockIndex = 0; blockIndex < packetsPerBlock.length; blockIndex++) {
    const result = decode(packetsPerBlock[blockIndex], {
      ...options,
      blockIndex,
    });
    results.push(result);
  }

  return results;
}

/**
 * Decode a single block and return its data.
 *
 * This function decodes only one block from the provided packets.
 * Useful for selective decoding.
 *
 * @param packets - Encoded packets for the block
 * @param blockIndex - Which block to decode (0-based)
 * @param options - Decoding options
 * @returns Decode result for the specified block
 *
 * @example
 * ```ts
 * const data = new Uint8Array(5 * BLOCK); // 5 blocks
 * const encoded = encodeSingleBlock(data, 2, { streamId: 1 });
 * const result = decodeSingleBlock(encoded.packets, 2, { streamId: 1, fileSize: data.length });
 * console.log(`Decoded block 2, ${result.data.length} bytes`);
 * ```
 */
export function decodeSingleBlock(
  packets: Array<{ seq: number; payload: Uint8Array }>,
  blockIndex: number,
  options: SimpleDecodeOptions
): SimpleDecodeResult {
  if (!options.fileSize) {
    throw new Error('decodeSingleBlock: fileSize is required for block validation');
  }

  // Calculate block geometry to validate block index
  const geom = geometry(options.fileSize, BLOCK, L);

  if (blockIndex < 0 || blockIndex >= geom.blockCount) {
    throw new Error(
      `decodeSingleBlock: block index ${blockIndex} out of range [0, ${geom.blockCount})`
    );
  }

  return decode(packets, {
    ...options,
    blockIndex,
  });
}

/**
 * Perform a complete encode→decode roundtrip.
 *
 * This function encodes input data and then immediately decodes it,
 * returning the decoded result. Useful for testing and verification.
 *
 * @param inputData - Original data to encode and decode
 * @param encodeOptions - Encoding options
 * @param decodeOptions - Decoding options (optional, uses encode options if not provided)
 * @returns Decode result with roundtrip success status
 *
 * @example
 * ```ts
 * const data = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
 * const result = roundtrip(data, { streamId: 1, packetCount: 10 });
 * console.log(`Roundtrip success: ${result.success}`);
 * console.log(`Data matches: ${data.equals(result.data)}`);
 * ```
 */
export function roundtrip(
  inputData: Uint8Array,
  encodeOptions: SimpleEncodeOptions,
  decodeOptions?: Omit<SimpleDecodeOptions, 'fileSize' | 'geometry'>
): SimpleDecodeResult {
  // Encode the data
  const encoded = encode(inputData, encodeOptions);

  // Decode the packets
  const decoded = decode(encoded.packets, {
    streamId: encodeOptions.streamId,
    blockIndex: encodeOptions.blockIndex,
    fileSize: inputData.length,
    geometry: encoded.geometry,
    ...decodeOptions,
  });

  return decoded;
}

# Fountain Code Packet Format and Decode Requirements

## Overview

This document specifies the fountain code packet format, encode/decode contracts, and testing requirements for the ScreenFerry system.

## Packet Structure

### Header Format (13 bytes)

The fountain packet header is fixed at 13 bytes (D21):

```
Offset  Size    Field          Description
------  -----   ------         -----------
0       4       streamId       uint32LE - stream identifier
4       3       blockIndex     uint24 - block index within stream
7       6       seq            uint48 - packet sequence number (unused in current impl)
13      1       flags          uint8 - packet type flags (beacon, compressed, manifest, etc.)
```

**Total header: 13 bytes**

### Payload Format (L bytes)

**Payload length: L = 256 bytes** (fixed for wire version 1)

The payload contains the fountain-coded data:
- For **K < 8 (repetition mode)**: Direct copy of source fragment `[seq % K]`
- For **K ≥ 8 (LT code mode)**: XOR of `d` source fragments, where `d` is sampled from harmonic distribution (capped at 64)

**Total packet size: 13 + L = 269 bytes**

### Wire Constants (from `src/core/params.ts`)

```typescript
L = 256              // Fragment length in bytes
HEADER = 13          // Header bytes per packet
PACKET = 269         // Total bytes per packet (HEADER + L)
K = 768              // Fragments per block (default)
K_MAX = 2048         // Maximum K for desktop override
BLOCK = 196608       // Block payload bytes = K * L
DEGREE_CAP = 64      // Maximum fountain degree
MIN_LT_K = 8         // Below this, use repetition instead
```

## Encoding Process

### Input

```typescript
interface EncoderOpts {
  streamId: number;        // Stream identifier (4 bytes)
  blockIndex: number;      // Block index (3 bytes)
  fragments: Uint8Array[];  // Source fragments (K fragments, each L bytes)
  degreeCap?: number;      // Optional degree cap (default: 64)
}
```

### Algorithm

1. **Repetition Mode (K < 8)**:
   ```typescript
   payload = fragments[seq % K]  // Direct copy
   ```

2. **LT Code Mode (K ≥ 8)**:
   ```typescript
   // 1. Derive PRNG seed from wire fields
   seed = packetSeed(streamId, blockIndex, seq)
   
   // 2. Sample degree from harmonic distribution (capped at degreeCap)
   d = sampleDegree(degreeTable, random())
   d = min(d, K)  // Can't exceed fragment count
   
   // 3. Select d distinct fragment indices via Fisher-Yates
   indices = deriveIndices(streamId, blockIndex, seq, K, degreeTable)
   
   // 4. XOR the selected fragments
   payload = zeros(L)
   for i in indices:
       payload ^= fragments[i]
   ```

### Output

```typescript
interface EncodedPacket {
  seq: number;           // Sequence number
  payload: Uint8Array;  // L bytes (256)
}
```

**Key invariant:** Same `(streamId, blockIndex, seq)` → same `payload` (deterministic PRNG).

## Decoding Process

### Input

```typescript
interface DecoderOpts {
  streamId: number;    // Must match encoder
  blockIndex: number;  // Must match encoder
  k: number;           // Number of source fragments (K)
  fragLen: number;    // Fragment length (L = 256)
  degreeCap?: number;  // Must match encoder
}

// Absorb packets one at a time
absorb(seq: number, payload: Uint8Array): boolean
```

### Algorithm (Gaussian Elimination)

1. **For each packet:**
   ```typescript
   // 1. Validate payload length
   if (payload.length !== fragLen) return false
   
   // 2. Derive the same index set the encoder used
   indices = deriveIndices(streamId, blockIndex, seq, k, degreeTable)
   
   // 3. Build coefficient mask (bitmap of which fragments are XORed)
   mask = new Uint32Array(ceil(k / 32))
   for i in indices:
       mask[i >>> 5] ^= 1 << (i & 31)
   
   // 4. Reduce against existing pivots (Gaussian elimination)
   for each existing pivot row:
       if mask has pivot's bit:
           mask ^= pivot.mask
           payload ^= pivot.payload
   
   // 5. Store as new pivot if non-zero
   if mask !== zero:
       pivMask[firstSetBit(mask)] = mask
       pivPay[firstSetBit(mask)] = payload
       rank++
   else:
       redundant++  // Linearly dependent packet
   ```

2. **When rank == k (complete):**
   ```typescript
   // Back-substitute to recover source fragments
   fragments = new Array(k)
   for p from 0 to k-1:
       pay = pivPay[p].copy()
       for each set bit q in pivMask[p] where q < p:
           pay ^= fragments[q]
       fragments[p] = pay
   ```

### Output

```typescript
recover(): Uint8Array[]  // K fragments, each L bytes (when rank == k)
```

### Decoder State

```typescript
class GEDecoder {
  rank: number;           // Current rank (0 to K)
  packetsSeen: number;     // Total packets absorbed
  redundant: number;      // Packets that reduced to zero
  overhead: number;        // (packetsSeen - k) / k
  
  complete: boolean;       // rank === k
}
```

## Input/Output Contract

### Encoder Contract

**Preconditions:**
- `fragments.length >= 1`
- All fragments have identical length `L`
- All fragments have length `> 0`

**Postconditions:**
- `encode(seq)` returns `Uint8Array` of length `L`
- Same `(streamId, blockIndex, seq)` always produces same output
- Output is deterministic (no replay needed)

**Invariants:**
- For `K < 8`: `encode(seq) === fragments[seq % K]`
- For `K ≥ 8`: `encode(seq)` is XOR of `1 ≤ d ≤ min(DEGREE_CAP, K)` fragments

### Decoder Contract

**Preconditions:**
- `k > 0`
- `fragLen > 0`
- `degreeCap` matches encoder (if provided)

**Postconditions:**
- `absorb()` returns `true` if packet increased rank, `false` otherwise
- `complete` is `true` when `rank === k`
- `recover()` returns `k` fragments, each of length `fragLen`
- Recovered fragments match original source fragments (byte-for-byte)

**Invariants:**
- `0 ≤ rank ≤ k`
- `packetsSeen ≥ rank`
- `redundant = packetsSeen - rank` (linearly dependent packets)
- `overhead = (packetsSeen - k) / k`

### Combined Contract

**End-to-end:**
```typescript
// Encoder
const encoder = new LTEncoder({
  streamId: 12345,
  blockIndex: 0,
  fragments: sourceFragments,  // K fragments of L bytes
});

// Generate packets
const packets: Array<{seq: number, payload: Uint8Array}> = []
for (let seq = 0; seq < someLimit; seq++) {
  packets.push({ seq, payload: encoder.encode(seq) });
}

// Decoder
const decoder = new GEDecoder({
  streamId: 12345,     // Must match encoder
  blockIndex: 0,       // Must match encoder
  k: sourceFragments.length,
  fragLen: L,
});

// Absorb packets
for (const {seq, payload} of packets) {
  decoder.absorb(seq, payload);
  if (decoder.complete) break;
}

// Recover
const recovered = decoder.recover();
assert(recovered.length === sourceFragments.length);
for (let i = 0; i < recovered.length; i++) {
  assert(deepEqual(recovered[i], sourceFragments[i]));
}
```

## Test Cases for "Simple Encoded Sequences"

### Definition

A **"simple encoded sequence"** refers to a minimal fountain-coded test case that:
1. Uses small K (K < 20) for manual verification
2. Uses known, predictable PRNG outputs
3. Has traceable index selection and XOR operations

### Test Case Categories

#### 1. Repetition Mode Tests (K < 8)

```typescript
// K=4, repetition mode
const fragments = [
  new Uint8Array([0, 1, 2, 3, ...]),
  new Uint8Array([4, 5, 6, 7, ...]),
  new Uint8Array([8, 9, 10, 11, ...]),
  new Uint8Array([12, 13, 14, 15, ...]),
];

// Expected outputs:
seq 0 → fragments[0]  // [0, 1, 2, 3, ...]
seq 1 → fragments[1]  // [4, 5, 6, 7, ...]
seq 2 → fragments[2]  // [8, 9, 10, 11, ...]
seq 3 → fragments[3]  // [12, 13, 14, 15, ...]
seq 4 → fragments[0]  // [0, 1, 2, 3, ...]  (wraps)
```

#### 2. Small LT Code Tests (8 ≤ K ≤ 16)

```typescript
// K=10, LT code mode
const fragments: Uint8Array[] = [...];  // 10 fragments

// Use fixed PRNG seed to get deterministic index selection
const testCases = [
  { seq: 0,  expectedIndices: [3, 7, 1] },
  { seq: 1,  expectedIndices: [5, 9] },
  { seq: 2,  expectedIndices: [0, 2, 4, 6, 8] },
  // ... predefined with known PRNG state
];

// Verify: XOR of fragments[expectedIndices] === encoder.encode(seq)
```

#### 3. Complete Decode Tests

```typescript
// K=10, need exactly 10 linearly independent packets
const testSequence = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9  // 10 packets
];

let decoder = new GEDecoder({ ... });
for (const seq of testSequence) {
  decoder.absorb(seq, encoder.encode(seq));
}

assert(decoder.complete);
assert(decoder.rank === 10);
assert(decovered === fragments);
```

#### 4. Overhead Tests

```typescript
// K=10, test with redundant packets
const testSequence = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// Expected: some packets will be linearly dependent (redundant)
let decoder = new GEDecoder({ ... });
for (const seq of testSequence) {
  decoder.absorb(seq, encoder.encode(seq));
}

// At least 2 packets should be redundant
assert(decoder.redundant >= 2);
assert(decoder.overhead > 0);
```

#### 5. Edge Cases

```typescript
// Minimum K (K=1)
const fragments = [new Uint8Array([1, 2, 3])];
// seq 0, 1, 2, ... all return same fragment

// K=8 (boundary: repetition → LT code)
const fragments = [...]; // 8 fragments
// seq 0-7: repetition mode behavior (seq % K)
// seq 8+: switches to LT code with degree sampling

// Maximum realistic K (K=768 default)
// Tests at scale for performance validation
```

## "Clean Byte Array Ready for Comparison" Definition

### Meaning

A **"clean byte array ready for comparison"** is:

1. **Properly typed**: `Uint8Array` (not `Array<number>` or `Buffer`)
2. **Correct length**: Exactly `L` bytes (256) for payload, `k * L` for full block
3. **Independently allocated**: Not aliased or sharing buffers
4. **Validated**:通过了所有边界检查和验证
5. **Deterministic**: Same input always produces same output

### Example

```typescript
// ✅ Clean byte array
const clean = new Uint8Array([0x01, 0x02, 0x03, ...]);

// ❌ Not clean - wrong type
const notClean1 = [0x01, 0x02, 0x03];  // Array, not Uint8Array

// ❌ Not clean - wrong length
const notClean2 = new Uint8Array(100);  // Should be 256

// ❌ Not clean - aliased
const notClean3 = someOtherArray.subarray();  // Shared buffer

// ❌ Not clean - not validated
const notClean4 = new Uint8Array(potentiallyCorruptedSource);
```

### Test Validation

```typescript
function assertCleanByteArray(arr: Uint8Array, expectedLength: number): void {
  assert(arr instanceof Uint8Array, 'Must be Uint8Array');
  assert(arr.length === expectedLength, `Must be ${expectedLength} bytes`);
  assert(arr.buffer.byteLength === arr.length * arr.BYTES_PER_ELEMENT, 'Not aliased');
}
```

## Examples of Valid Encoded Data

### Example 1: Repetition Mode (K=4)

```typescript
// Source
const fragments = [
  new Uint8Array([0x00, 0x01, 0x02, 0x03]),
  new Uint8Array([0x10, 0x11, 0x12, 0x13]),
  new Uint8Array([0x20, 0x21, 0x22, 0x23]),
  new Uint8Array([0x30, 0x31, 0x32, 0x33]),
];

// Encoder
const encoder = new LTEncoder({
  streamId: 1,
  blockIndex: 0,
  fragments,
});

// Encoded outputs (L=4 for this example)
encoder.encode(0)  // [0x00, 0x01, 0x02, 0x03]  (fragments[0])
encoder.encode(1)  // [0x10, 0x11, 0x12, 0x13]  (fragments[1])
encoder.encode(2)  // [0x20, 0x21, 0x22, 0x23]  (fragments[2])
encoder.encode(3)  // [0x30, 0x31, 0x32, 0x33]  (fragments[3])
encoder.encode(4)  // [0x00, 0x01, 0x02, 0x03]  (fragments[0] again)
```

### Example 2: LT Code Mode (K=10)

```typescript
// Source: 10 fragments of L=256 bytes
const fragments = Array.from({length: 10}, (_, i) => 
  new Uint8Array(256).fill(i & 0xff)
);

// Encoder
const encoder = new LTEncoder({
  streamId: 12345,
  blockIndex: 0,
  fragments,
  degreeCap: 64,
});

// Encoded outputs (each is XOR of selected fragments)
const pkt0 = encoder.encode(0);   // XOR of e.g., fragments[3, 7, 1]
const pkt1 = encoder.encode(1);   // XOR of e.g., fragments[5, 9]
const pkt2 = encoder.encode(2);   // XOR of e.g., fragments[0, 2, 4, 6, 8]

// Decoder
const decoder = new GEDecoder({
  streamId: 12345,
  blockIndex: 0,
  k: 10,
  fragLen: 256,
  degreeCap: 64,
});

// Absorb packets
decoder.absorb(0, pkt0);  // rank increases
decoder.absorb(1, pkt1);  // rank increases
decoder.absorb(2, pkt2);  // rank increases
// ... continue until rank === 10

// Recover
if (decoder.complete) {
  const recovered = decoder.recover();
  // recovered === fragments (byte-for-byte)
}
```

### Example 3: Full Packet with Header

```typescript
// Complete fountain packet (269 bytes)
interface FountainPacket {
  header: {
    streamId: number;      // 4 bytes, e.g., 12345
    blockIndex: number;    // 3 bytes, e.g., 0
    seq: number;          // 6 bytes (unused in current impl)
    flags: number;        // 1 byte, e.g., 0x00 (Payload)
  };
  payload: Uint8Array;    // L=256 bytes
}

// Serialization (13 + 256 = 269 bytes)
function serializePacket(pkt: FountainPacket): Uint8Array {
  const buf = new Uint8Array(269);
  const view = new DataView(buf.buffer);
  
  view.setUint32(0, pkt.header.streamId, true);          // LE
  view.setUint8(4, (pkt.header.blockIndex) & 0xff);      // byte 0
  view.setUint8(5, (pkt.header.blockIndex >> 8) & 0xff); // byte 1
  view.setUint8(6, (pkt.header.blockIndex >> 16) & 0xff);// byte 2
  // seq bytes 7-12 (unused, set to 0)
  buf.setUint8(13, pkt.header.flags);
  buf.set(pkt.payload, 14);
  
  return buf;
}
```

## PRNG Determinism

### Seed Derivation

```typescript
function packetSeed(streamId: number, blockIndex: number, seq: number): number {
  let h = streamId >>> 0;
  h = (Math.imul(h ^ (blockIndex >>> 0), 0x85ebca6b) >>> 0) ^ (h >>> 13);
  h = (Math.imul(h ^ (seq >>> 0), 0xc2b2ae35) >>> 0) ^ (h >>> 16);
  return h >>> 0;
}
```

**Critical:** This must be **bit-exact** across all implementations (see `test/fixtures/vectors.json` for pinned tests).

## Wire Format Constraints

1. **L is fixed per wire version**: L=256 for version 1, cannot change without version bump
2. **Header size is fixed**: 13 bytes always
3. **Degree distribution is coupled to decoder**: Harmonic + GE is a paired invariant (D6)
4. **PRNG must be deterministic**: Same (streamId, blockIndex, seq) → same indices

## References

- **plan.md §7.1**: Payload packet header format
- **plan.md §3.1**: Decoder scaling and K selection
- **plan.md D25**: Degree cap at 64
- **src/core/fountain/encoder.ts**: LTEncoder implementation
- **src/core/fountain/decoder.ts**: GEDecoder implementation
- **src/core/fountain/prng.ts**: Deterministic PRNG and index derivation
- **test/fixtures/vectors.json**: Normative test vectors for PRNG

## Version History

- 2026-08-04: Initial documentation (bf-16yrq)

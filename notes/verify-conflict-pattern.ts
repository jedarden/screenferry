/**
 * Quick verification that the conflict check pattern works.
 *
 * Run with: npx tsx notes/verify-conflict-pattern.ts
 */

import { encodeBeacon, BeaconValidationError, BeaconFlags, type BeaconMeta } from '../src/core/frame/beacon.js';

function createValidMeta(): BeaconMeta {
  return {
    streamId: 0x12345678,
    wireVersion: 1,
    originalSize: 1024 * 1024,
    payloadLen: 1024 * 1024,
    blockSize: 192 * 1024,
    blockCount: 6,
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

console.log('=== Conflict Check Pattern Verification ===\n');

// Test 1: Valid configuration (no conflict)
console.log('Test 1: Valid configuration (compression + resume disabled)');
try {
  const meta = createValidMeta();
  meta.flags = BeaconFlags.Compressed | BeaconFlags.ResumeDisabled;
  const encoded = encodeBeacon(meta);
  console.log('✅ PASS: No error thrown for valid configuration');
  console.log(`   Encoded ${encoded.length} bytes\n`);
} catch (error) {
  console.log('❌ FAIL: Should not have thrown for valid configuration');
  console.log(`   Error: ${error}\n`);
}

// Test 2: Conflict condition (compression without resume disabled)
console.log('Test 2: Conflict condition (compression enabled, resume NOT disabled)');
try {
  const meta = createValidMeta();
  meta.flags = BeaconFlags.Compressed; // Conflict!
  encodeBeacon(meta);
  console.log('❌ FAIL: Should have thrown BeaconValidationError\n');
} catch (error) {
  if (error instanceof BeaconValidationError) {
    console.log('✅ PASS: BeaconValidationError thrown');
    console.log(`   Error code: ${error.code}`);
    console.log(`   Details:`, error.details);
    console.log(`   Message preview: ${error.message.substring(0, 100)}...\n`);
  } else {
    console.log('❌ FAIL: Wrong error type thrown');
    console.log(`   Error: ${error}\n`);
  }
}

// Test 3: No conflict (resume enabled, no compression)
console.log('Test 3: No conflict (resume enabled, no compression)');
try {
  const meta = createValidMeta();
  meta.flags = BeaconFlags.None;
  const encoded = encodeBeacon(meta);
  console.log('✅ PASS: No error thrown for resume-enabled configuration');
  console.log(`   Encoded ${encoded.length} bytes\n`);
} catch (error) {
  console.log('❌ FAIL: Should not have thrown for resume-enabled configuration');
  console.log(`   Error: ${error}\n`);
}

console.log('=== Verification Complete ===');

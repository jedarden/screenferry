#!/usr/bin/env node
/**
 * Simple CPU stress test for thermal throttling experiments
 * Runs intensive hash computations to generate CPU heat
 */

import crypto from 'crypto';
import fs from 'fs';

function readTemp() {
  try {
    const temp = parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone2/temp', 'utf8')) / 1000;
    return temp.toFixed(0);
  } catch (e) {
    return 'N/A';
  }
}

function stressCPU(durationSeconds) {
  console.log(`Starting CPU stress for ${durationSeconds} seconds...`);

  const start = Date.now();
  let ops = 0;
  let lastReport = start;

  // CPU-intensive work: hash computation
  const interval = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= durationSeconds) {
      clearInterval(interval);
      console.log(`\nStress complete. Performed ${ops.toLocaleString()} hash operations.`);
      process.exit(0);
    }

    // Report every 10 seconds
    if (Date.now() - lastReport > 10000) {
      const temp = readTemp();
      console.log(`[${elapsed.toFixed(0)}s] Temperature: ${temp}°C, Ops: ${ops.toLocaleString()}`);
      lastReport = Date.now();
    }

    // Perform intensive hash operations
    for (let i = 0; i < 5000; i++) {
      crypto.createHash('sha256').update(Math.random().toString()).digest();
      ops++;
    }
  }, 10);

  return new Promise(resolve => {
    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, durationSeconds * 1000);
  });
}

// If run directly
const duration = parseInt(process.argv[2]) || 300; // Default 5 minutes
stressCPU(duration);

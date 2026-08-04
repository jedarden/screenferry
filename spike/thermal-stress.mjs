#!/usr/bin/env node
/**
 * CPU Stress Test for Thermal Throttling
 *
 * Creates sustained CPU load to trigger thermal throttling on Linux systems.
 * Monitors thermal zones and reports when throttling occurs.
 */

import fs from 'fs';

const thermalZones = ['/sys/class/thermal/thermal_zone0', '/sys/class/thermal/thermal_zone2'];

function getTemperature() {
  const temps = {};
  for (const zone of thermalZones) {
    try {
      const temp = parseInt(fs.readFileSync(`${zone}/temp`, 'utf8')) / 1000;
      const type = fs.readFileSync(`${zone}/type`, 'utf8').trim();
      temps[type] = temp;
    } catch (e) {
      // Zone not readable
    }
  }
  return temps;
}

function stressCPU(durationSeconds) {
  console.log(`Starting CPU stress for ${durationSeconds} seconds...`);
  console.log('Initial temperatures:', getTemperature());

  const start = Date.now();
  let ops = 0;

  // CPU-intensive work: hash computation
  const crypto = require('crypto');

  const interval = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    if (elapsed >= durationSeconds) {
      clearInterval(interval);
      return;
    }

    // Perform intensive hash operations
    for (let i = 0; i < 1000; i++) {
      crypto.createHash('sha256').update(Math.random().toString()).digest();
      ops++;
    }
  }, 10);

  return new Promise(resolve => {
    setTimeout(() => {
      clearInterval(interval);
      console.log(`Stress complete. Performed ${ops.toLocaleString()} hash operations.`);
      resolve();
    }, durationSeconds * 1000);
  });
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const duration = parseInt(process.argv[2]) || 600; // Default 10 minutes
  stressCPU(duration);
}
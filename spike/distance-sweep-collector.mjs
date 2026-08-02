#!/usr/bin/env node

/**
 * Distance Sweep Results Collector (bf-2n9l)
 *
 * Collects and validates S3 distance sweep trial results.
 * Ensures all required data is captured per §13.2 protocol.
 *
 * Usage:
 *   node spike/distance-sweep-collector.mjs
 */

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DISTANCES = [20, 30, 40, 50, 60];
const TRIALS_PER_DISTANCE = 5;
const RESULTS_DIR = path.join(__dirname, '../docs/notes');
const RESULTS_FILE = path.join(RESULTS_DIR, 'bf-2n9l-s3-results.json');

// Fixed configuration per protocol
const CONFIG = {
  rung: "R2",
  module_px: 4,
  grid: "5×3",
  sender_fps: 3,
  capture_resolution: "1080×1920",
  duration_seconds: 60
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function parseResultsJSON(jsonString) {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    return null;
  }
}

function validateTrialResults(results) {
  const required = [
    'camera_fps',
    'decode_p50_ms',
    'erasure_percent',
    'goodput_kbps',
    'frames_with_zero',
    'byte_mismatches',
    'exposure_applied'
  ];

  const missing = required.filter(field => !(field in results));
  if (missing.length > 0) {
    return { valid: false, error: `Missing fields: ${missing.join(', ')}` };
  }

  if (results.byte_mismatches !== 0) {
    return {
      valid: false,
      error: `CRITICAL: byte_mismatches = ${results.byte_mismatches} (must be 0 - binary safety failure)`
    };
  }

  return { valid: true };
}

function calculateCameraPxModule(distance_cm) {
  // Baseline: at 30cm, 4 screen_px/module → 2.25 camera_px/module
  // (1080 / 1920) * 4 = 2.25
  const baseline = 2.25;
  const baseline_distance = 30;
  return baseline * (baseline_distance / distance_cm);
}

async function loadExistingResults() {
  if (fs.existsSync(RESULTS_FILE)) {
    const content = fs.readFileSync(RESULTS_FILE, 'utf8');
    return JSON.parse(content);
  }
  return {
    protocol: 'bf-2n9l',
    description: 'S3 distance sweep under §13.2 conditions',
    config: CONFIG,
    started_at: new Date().toISOString(),
    trials: []
  };
}

function saveResults(data) {
  data.completed_at = new Date().toISOString();
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
}

async function collectTrial(distance_cm, trial_number) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Distance: ${distance_cm} cm | Trial: ${trial_number}/${TRIALS_PER_DISTANCE}`);
  console.log(`Expected camera px/module: ${calculateCameraPxModule(distance_cm).toFixed(2)}`);
  console.log(`${'='.repeat(60)}`);

  console.log('\n⚠️  PRE-FLIGHT CHECKS:');
  console.log('  [ ] Device is cool to the touch (wait ≥5min if warm)');
  console.log('  [ ] Distance measured and verified');
  console.log('  [ ] Alignment is perpendicular');
  console.log('  [ ] Lighting is 280-320 lux at screen');

  const ready = await question('\nPress ENTER when ready to collect results, or "s" to skip: ');
  if (ready.toLowerCase() === 's') {
    return null;
  }

  console.log('\nPaste the results JSON from the receiver (Ctrl+D to finish):');

  const jsonLines = [];
  for await (const line of rl) {
    jsonLines.push(line);
  }

  const jsonString = jsonLines.join('\n');
  const results = parseResultsJSON(jsonString);

  if (!results) {
    console.error('❌ Invalid JSON - please copy again');
    return collectTrial(distance_cm, trial_number); // Retry
  }

  const validation = validateTrialResults(results);
  if (!validation.valid) {
    console.error(`❌ ${validation.error}`);

    if (validation.error.includes('CRITICAL')) {
      console.error('STOPPING: Binary safety failure - this must be investigated');
      throw new Error('Binary safety failure detected');
    }

    const retry = await question('Retry this trial? (y/n): ');
    if (retry.toLowerCase() === 'y') {
      return collectTrial(distance_cm, trial_number);
    }
    return null;
  }

  // Collect environmental conditions
  const lighting = await question('Lighting (lux): ');
  const mounting = await question('Mounting (default: tripod): ') || 'tripod';
  const device_cool = await question('Device cool? (y/n): ');

  if (device_cool.toLowerCase() !== 'y') {
    const continue_anyway = await question('⚠️  Device may not be cool. Continue anyway? (y/n): ');
    if (continue_anyway.toLowerCase() !== 'y') {
      console.log('Waiting 5 minutes for cool-down...');
      await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
    }
  }

  const trial = {
    distance_cm,
    trial_number,
    timestamp: new Date().toISOString(),
    config: CONFIG,
    results,
    conditions: {
      lighting_lux: parseInt(lighting) || null,
      mounting,
      device_temp_cool: device_cool.toLowerCase() === 'y'
    },
    calculated: {
      camera_px_module: calculateCameraPxModule(distance_cm)
    }
  };

  console.log('\n✅ Trial recorded:');
  console.log(`   Camera fps: ${results.camera_fps}`);
  console.log(`   Erasure: ${results.erasure_percent}%`);
  console.log(`   Goodput: ${results.goodput_kbps} KB/s`);
  console.log(`   Decode p50: ${results.decode_p50_ms} ms`);

  return trial;
}

async function collectAllTrials() {
  const data = await loadExistingResults();

  console.log('\n' + '='.repeat(60));
  console.log('S3 DISTANCE SWEEP DATA COLLECTION');
  console.log('='.repeat(60));
  console.log(`\nProtocol: bf-2n9l`);
  console.log(`Configuration: Rung ${CONFIG.rung}, ${CONFIG.module_px} px/module, ${CONFIG.grid}`);
  console.log(`Distances: ${DISTANCES.join(', ')} cm`);
  console.log(`Trials per distance: ${TRIALS_PER_DISTANCE}`);
  console.log(`\nResults will be saved to: ${RESULTS_FILE}`);
  console.log('\n' + '='.repeat(60) + '\n');

  const proceed = await question('Press ENTER to begin, or Ctrl-C to exit: ');

  for (const distance of DISTANCES) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`DISTANCE POINT: ${distance} cm`);
    console.log(`Expected camera px/module: ${calculateCameraPxModule(distance).toFixed(2)}`);
    console.log(`${'─'.repeat(60)}\n`);

    for (let trial = 1; trial <= TRIALS_PER_DISTANCE; trial++) {
      try {
        const result = await collectTrial(distance, trial);
        if (result) {
          data.trials.push(result);
          saveResults(data);
        }

        // Cool-down reminder after each trial
        if (trial < TRIALS_PER_DISTANCE) {
          console.log('\n⏱️  COOL-DOWN PERIOD: Wait ≥5 minutes before next trial');
          const cooldown = await question('Press ENTER when ready for next trial: ');
        }
      } catch (error) {
        if (error.message.includes('Binary safety failure')) {
          throw error; // Don't continue on binary safety failures
        }
        console.error(`Error in trial: ${error.message}`);
      }
    }
  }

  return data;
}

function calculateMedians(data) {
  const medians = {};

  for (const distance of DISTANCES) {
    const distanceTrials = data.trials.filter(t => t.distance_cm === distance);

    if (distanceTrials.length === 0) {
      medians[distance] = null;
      continue;
    }

    // Sort each metric and pick median
    const metrics = ['camera_fps', 'decode_p50_ms', 'erasure_percent', 'goodput_kbps'];
    const median = { distance_cm: distance, trial_count: distanceTrials.length };

    for (const metric of metrics) {
      const values = distanceTrials.map(t => t.results[metric]).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      median[metric] = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }

    median.camera_px_module = calculateCameraPxModule(distance);
    median.conditions = {
      lighting_lux: distanceTrials[0].conditions.lighting_lux,
      mounting: distanceTrials[0].conditions.mounting
    };

    medians[distance] = median;
  }

  return medians;
}

function displaySummary(data) {
  console.log('\n' + '='.repeat(70));
  console.log('S3 DISTANCE SWEEP - SUMMARY (median of ≥5 trials per distance)');
  console.log('='.repeat(70));

  const medians = calculateMedians(data);

  console.log('\n| Distance | Cam px/mod | Camera fps | Decode p50 | Erasure | Goodput | Trials |');
  console.log('|----------|------------|------------|-----------|---------|---------|--------|');

  for (const distance of DISTANCES) {
    const m = medians[distance];
    if (!m) {
      console.log(`| ${distance.toString().padStart(8)} | ${'N/A'.padStart(10)} | ${'N/A'.padStart(10)} | ${'N/A'.padStart(9)} | ${'N/A'.padStart(7)} | ${'N/A'.padStart(7)} | ${0} |`);
      continue;
    }

    console.log(`| ${distance.toString().padStart(8)} | ${m.camera_px_module.toFixed(2).padStart(10)} | ${m.camera_fps.toFixed(1).padStart(10)} | ${m.decode_p50_ms.toFixed(0).padStart(9)} | ${m.erasure_percent.toFixed(0).padStart(7)} | ${m.goodput_kbps.toFixed(1).padStart(7)} | ${m.trial_count} |`);
  }

  console.log('\n' + '='.repeat(70));

  // Identify cliff location
  console.log('\n📊 CLIFF ANALYSIS:');

  let cliff_distance = null;
  let cliff_type = null;

  for (const distance of DISTANCES) {
    const m = medians[distance];
    if (!m) continue;

    if (m.erasure_percent >= 90) {
      cliff_distance = distance;
      cliff_type = 'hard (≥90% erasure)';
      break;
    } else if (m.erasure_percent >= 50 && !cliff_distance) {
      cliff_distance = distance;
      cliff_type = 'soft (≥50% erasure)';
    }
  }

  if (cliff_distance) {
    console.log(`   Cliff detected at: ${cliff_distance} cm (${cliff_type})`);
    console.log(`   Camera px/module at cliff: ${calculateCameraPxModule(cliff_distance).toFixed(2)}`);
  } else {
    console.log(`   No clear cliff detected within tested range`);
    console.log(`   Lowest erasure: ${Math.min(...DISTANCES.map(d => medians[d]?.erasure_percent || 100))}%`);
  }

  console.log('\n💾 Results saved to:', RESULTS_FILE);
  console.log('   Next step: Update docs/notes/spike-results.md with findings\n');
}

async function main() {
  try {
    const data = await collectAllTrials();
    displaySummary(data);
    rl.close();
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    rl.close();
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === __filename) {
  main();
}

export { collectTrial, calculateMedians, displaySummary };

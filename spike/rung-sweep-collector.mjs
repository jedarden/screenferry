#!/usr/bin/env node
/**
 * Rung sweep test automation helper for bf-37px
 *
 * This script provides a structured way to collect and validate rung sweep results.
 * Run this on the receiver device after each test run to save structured results.
 */

import fs from 'fs';

const RESULTS_FILE = '/home/coding/screenferry/docs/notes/bf-37px-results.json';

const RUNGS = ['R1', 'R2', 'R3', 'R4'];

/**
 * Prompt user for test results and validate
 */
async function collectResults() {
  console.log('=== Rung Sweep Results Collection ===\n');

  let results = { testId: 'bf-37px-rung-sweep', timestamp: new Date().toISOString(), runs: [] };

  // Collect setup info
  console.log('Setup information:');
  const sender = prompt('Sender device model: ');
  const receiver = prompt('Receiver device model: ');
  const distance = prompt('Distance (cm, default 30): ') || '30';
  const mounting = prompt('Mounting (tripod/handheld, default tripod): ') || 'tripod';

  results.setup = { sender, receiver, distance: parseInt(distance), mounting };

  // Collect results for each rung
  for (const rung of RUNGS) {
    console.log(`\n--- ${rung} (v10-L conservative, v16-L nominal, v20-L aggressive, v23-L probe) ---`);
    const run = {
      rung,
      duration: 60,
      uniquePackets: parseInt(prompt('  Unique packets received: ') || '0'),
      erasureRate: parseFloat(prompt('  Erasure rate (0-1, e.g. 0.48): ') || '0'),
      cameraFps: parseFloat(prompt('  Camera fps: ') || '0'),
      decodeP50: parseFloat(prompt('  Decode p50 (ms): ') || '0'),
      decodeP99: parseFloat(prompt('  Decode p99 (ms): ') || '0'),
      framesWithZero: parseFloat(prompt('  Frames with zero (0-1): ') || '0'),
      byteMismatches: parseInt(prompt('  Byte mismatches (MUST be 0): ') || '0'),
      corruptTiles: parseInt(prompt('  Corrupt tiles: ') || '0'),
    };

    run.goodput = (run.uniquePackets * 256) / 60; // bytes per sec

    // Validation
    if (run.byteMismatches !== 0) {
      console.error('\n❌ STOP: Byte mismatches must be 0. Binary safety failure.');
      console.log('This is a stop-everything result. Do not continue testing.');
      process.exit(1);
    }

    results.runs.push(run);
    console.log(`  → Goodput: ${run.goodput.toFixed(1)} KB/s`);
  }

  // Analyze results
  console.log('\n=== Analysis ===');
  const analysis = analyzeResults(results);
  results.analysis = analysis;

  console.log(`\nConclusion: ${analysis.conclusion}`);
  if (analysis.killCriterionTripped) {
    console.log('⚠️  KILL CRITERION TRIPPED: R1 fails while R3 works');
    console.log('   Action: Re-derive §3.1.1\'s rung table (plan.md)');
  }

  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to ${RESULTS_FILE}`);

  return results;
}

/**
 * Analyze rung sweep results against kill criterion
 */
function analyzeResults(results) {
  const runMap = {};
  for (const run of results.runs) {
    const success = run.erasureRate < 0.5 && run.uniquePackets > 0;
    runMap[run.rung] = success;
  }

  const R1fails = !runMap.R1;
  const R3works = runMap.R3;
  const killCriterionTripped = R1fails && R3works;

  let conclusion;
  if (killCriterionTripped) {
    conclusion = 'FAIL - Kill criterion tripped';
  } else if (runMap.R1) {
    conclusion = 'PASS - Conservative rung succeeds';
  } else if (R1fails && !R3works) {
    conclusion = 'PASS - Conservative fails only when aggressive fails (channel too degraded)';
  } else {
    conclusion = 'INCONCLUSIVE';
  }

  return {
    conclusion,
    killCriterionTripped,
    R1succeeds: runMap.R1,
    R3succeeds: runMap.R3,
    recommendation: killCriterionTripped
      ? 'Re-derive §3.1.1 rung table; L may need to drop again'
      : 'Ladder validation passed'
  };
}

function prompt(msg) {
  if (process.argv[2] === '--demo') {
    // Demo mode for testing
    return '';
  }
  process.stdout.write(msg);
  return new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data) => resolve(data.toString().trim()));
  });
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  collectResults().then(() => process.exit(0));
}

export { collectResults, analyzeResults };

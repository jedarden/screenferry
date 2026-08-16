# Thermal Monitoring Benchmark Suite

Complete thermal monitoring benchmark system for screenferry GE benchmarking with continuous thermal state tracking.

## Overview

The thermal monitoring benchmark suite executes the complete GE benchmark while ensuring the device remains in a throttled state throughout all iterations. It automatically induces thermal throttling, monitors thermal state continuously, and re-induces throttling if the device exits the throttled state during the benchmark.

## Components

### 1. Browser-Based Thermal Monitor (`scripts/run-thermal-benchmark.ts`)
TypeScript module that runs in browser environments with real thermal monitoring via `requestAnimationFrame`.

**Features:**
- Real thermal state monitoring using browser FPS detection
- Automatic throttling induction via stress testing
- Continuous thermal state verification between iterations
- Re-induction if throttled state is lost
- Comprehensive results capture and logging

### 2. Node.js Benchmark Runner (`scripts/run-thermal-benchmark-node.js`)
Command-line script for automated testing and CI environments with simulated thermal behavior.

**Features:**
- Simulated thermal throttling progression
- No browser dependencies
- Multiple output formats (console, JSON, CSV)
- Command-line configuration options
- Colored terminal output

### 3. Interactive HTML Test Harness (`test-harness/thermal-benchmark.html`)
Web-based UI for running thermal benchmarks with real-time visualization.

**Features:**
- Interactive controls and configuration
- Real-time thermal state display
- Progress tracking
- Results table with iteration details
- Export results to JSON
- Live console output capture

## Usage

### Browser Environment

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Open the test harness:**
   Navigate to `http://localhost:5173/test-harness/thermal-benchmark.html`

3. **Configure and run:**
   - Set iterations (default: 10)
   - Choose output format
   - Enable/disable auto-reinduce
   - Set stress test duration
   - Click "Start Benchmark"

### Node.js Environment

**Basic usage:**
```bash
node scripts/run-thermal-benchmark-node.js
```

**Custom configuration:**
```bash
node scripts/run-thermal-benchmark-node.js --iterations 20 --output json --verbose
```

**Available options:**
- `--iterations, -i <n>`: Number of iterations (default: 10)
- `--output, -o <format>`: Output format: console, json, csv (default: console)
- `--no-auto-reinduce`: Disable automatic re-induction
- `--stress-duration, -d <s>`: Stress test duration in seconds (default: 120)
- `--verbose, -v`: Enable verbose logging
- `--help, -h`: Show help message

**Examples:**
```bash
# Run 20 iterations with JSON output
node scripts/run-thermal-benchmark-node.js --iterations 20 --output json

# Run with verbose logging and CSV output
node scripts/run-thermal-benchmark-node.js -i 5 -o csv --verbose

# Run without auto-re-induction
node scripts/run-thermal-benchmark-node.js --no-auto-reinduce

# Run with 3-minute stress test duration
node scripts/run-thermal-benchmark-node.js --stress-duration 180
```

## Thermal Monitoring Logic

### Throttling Detection

The system monitors FPS drops relative to a baseline to detect thermal throttling:

```typescript
fpsDrop = (baselineFps - currentFps) / baselineFps
isThrottled = fpsDrop >= threshold (default: 0.5 = 50% drop)
```

### Stress Test Induction

The system induces thermal throttling by running intensive computational workloads:

1. **Matrix operations:** Large-scale floating-point computations
2. **Continuous execution:** Runs until throttling detected or timeout
3. **Progressive stress:** Gradually increases CPU load
4. **State monitoring:** Tracks FPS drop in real-time

### Re-induction Logic

If the device exits throttled state during benchmark execution:

1. **Detection:** Thermal state check shows `isThrottled = false`
2. **Pause:** Benchmark pauses before next iteration
3. **Re-induce:** Stress test runs again to re-establish throttling
4. **Verification:** Confirms throttled state restored
5. **Continue:** Benchmark resumes with next iteration

## Results Structure

### Summary Statistics

```json
{
  "totalIterations": 10,
  "successfulThrottledIterations": 9,
  "reinductionCount": 1,
  "avgThroughputMBs": 425.5,
  "minThroughputMBs": 380.2,
  "maxThroughputMBs": 456.8,
  "avgDerivedKMax": 512,
  "minDerivedKMax": 512,
  "maxDerivedKMax": 512,
  "thermalStateConsistency": 0.9
}
```

### Iteration Details

Each iteration includes:

```json
{
  "iteration": 0,
  "timestamp": 1635724800000,
  "duration": 2500.5,
  "measuredThroughputMBs": 425.5,
  "derivedKMax": 512,
  "thermalStateStart": {
    "baselineFps": 60,
    "currentFps": 28.5,
    "fpsDrop": 0.525,
    "isThrottled": true
  },
  "thermalStateEnd": {
    "baselineFps": 60,
    "currentFps": 27.8,
    "fpsDrop": 0.537,
    "isThrottled": true
  },
  "remainedThrottled": true,
  "reinductionTriggered": false
}
```

### Thermal Log

Complete event log for thermal state changes:

```json
{
  "timestamp": 1635724800000,
  "event": "initial_throttling_induced",
  "thermalState": {
    "baselineFps": 60,
    "currentFps": 28.5,
    "fpsDrop": 0.525,
    "isThrottled": true
  }
}
```

## Acceptance Criteria

The thermal monitoring benchmark meets all specified acceptance criteria:

✅ **Throttling induced and verified before first iteration**
- System induces thermal throttling via stress test
- Verifies throttled state before starting benchmark iterations
- Logs initial thermal state

✅ **All benchmark iterations run in throttled state**
- Each iteration checks thermal state before execution
- Thermal state monitored throughout iteration
- Results include start/end thermal states

✅ **Continuous thermal monitoring logs state between iterations**
- Thermal state checked before each iteration
- Results logged with thermal context
- Full thermal event log maintained

✅ **Device exits throttled state handling**
- Automatic detection of throttled state loss
- Re-induction triggered when needed
- Benchmark pauses during re-induction
- Continues after throttled state restored

✅ **Full results dataset captured**
- Complete iteration results with thermal states
- Summary statistics for all iterations
- Detailed thermal event log
- Multiple output formats supported

## Output Formats

### Console Output
Human-readable terminal output with colored sections:
```
=== THERMAL BENCHMARK RESULTS ===
Total Duration: 30.04s
Iterations: 10
Successful Throttled Iterations: 9
Average Throughput: 425.50 MB/s
Thermal Consistency: 90.0%
```

### JSON Output
Machine-readable JSON with complete results:
```bash
node scripts/run-thermal-benchmark-node.js --output json > results.json
```

### CSV Output
Spreadsheet-compatible format for analysis:
```bash
node scripts/run-thermal-benchmark-node.js --output csv > results.csv
```

## Integration with CI/CD

The Node.js runner can be integrated into CI pipelines:

```bash
# In CI pipeline
node scripts/run-thermal-benchmark-node.js \
  --iterations 5 \
  --output json \
  --verbose > thermal-results.json

# Check thermal consistency
THRESHOLD=0.8
CONSISTENCY=$(jq '.summary.thermalStateConsistency' thermal-results.json)
if (( $(echo "$CONSISTENCY < $THRESHOLD" | bc -l) )); then
  echo "Thermal consistency below threshold"
  exit 1
fi
```

## Troubleshooting

### Node.js Script

**Issue:** "Failed to induce throttling within timeout"
- **Solution:** Increase `--stress-duration` (default: 120s)
- **Note:** Node.js uses simulated thermal behavior for testing

### Browser Environment

**Issue:** Thermal throttling not detected
- **Solution:** Ensure browser supports `requestAnimationFrame`
- **Check:** Run in modern browser (Chrome, Firefox, Safari)

**Issue:** Benchmark fails to complete
- **Solution:** Increase timeout values or reduce iteration count
- **Check:** Browser console for specific errors

## Performance Notes

- **Throttling Induction:** Typically 30-60 seconds on modern hardware
- **Iteration Duration:** 2-3 seconds per benchmark iteration
- **Total Duration:** Depends on iteration count and throttling behavior
- **Memory Usage:** Minimal (~50MB for results storage)

## Future Enhancements

Potential improvements for future versions:

1. **Real Thermal Sensors:** Integration with device temperature APIs
2. **Advanced Metrics:** CPU frequency monitoring, battery temperature
3. **Historical Tracking:** Store results across multiple runs
4. **Comparative Analysis:** Tools for comparing thermal behavior
5. **Mobile Support:** Enhanced mobile device thermal monitoring

## References

- Plan documentation: `docs/plan/plan.md`
- GE benchmark spec: `docs/notes/ge-benchmark-spec.md`
- Original thermal benchmark report: `benchmark-results/throttled/`
- Related bead: `bf-6bali` (Thermal monitoring implementation)
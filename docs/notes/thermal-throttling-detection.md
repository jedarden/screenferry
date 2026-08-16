# Thermal Throttling Detection

## Overview

This document describes the thermal throttling detection method used in screenferry benchmarks. The system uses a multi-faceted approach to detect when the CPU is thermally constrained.

## Detection Method

The verification script (`scripts/verify-thermal-state.sh`) monitors three key indicators:

### 1. Thermal Zones (`/sys/class/thermal/thermal_zone*`)

**What it monitors:** CPU and package temperatures from Linux thermal subsystem

**Key zones on this system:**
- `TCPU`: CPU core temperature (70-75°C normal, >85°C throttling)
- `x86_pkg_temp`: CPU package temperature (similar range)
- `TCPU_PCI`: PCI-related CPU temperature

**Throttling threshold:** >85°C (typical Intel thermal throttle point)

**Expected readings (normal state):**
- TCPU: 65-75°C under moderate load
- x86_pkg_temp: 65-75°C
- TCPU_PCI: 65-75°C

### 2. CPU Frequency Scaling (`/sys/devices/system/cpu/cpu*/cpufreq/`)

**What it monitors:** Current vs maximum CPU frequency

**Key files:**
- `cpuinfo_max_freq`: Maximum turbo frequency (4.4 GHz on this system)
- `scaling_cur_freq`: Current operating frequency
- `scaling_governor`: Frequency governor (performance/powersave)

**Throttling indicators:**
- Frequency < 70% of max in performance mode
- Frequency < 50% of max in any mode

**Expected readings (normal state):**
- Governor: `powersave` or `performance`
- Frequency: varies with load, but should track governor behavior
- Powersave mode: 30-100% of max (normal behavior)
- Performance mode: should stay high unless thermally constrained

### 3. RAPL Power Limiting (`/sys/devices/virtual/powercap/intel-rapl/`)

**What it monitors:** Intel Running Average Power Limit (RAPL) status

**Key domains:**
- `package-0`: CPU package power limits
- `psys`: System-level power limits

**What it shows:**
- Whether RAPL is enabled
- Configured power constraints (e.g., 35W, 77W, 100W limits)

**Note:** RAPL being enabled is normal on mobile CPUs (i5-12500T). The script monitors this for context but does not flag it as throttling by itself.

## Running the Verification

```bash
./scripts/verify-thermal-state.sh
```

**Exit codes:**
- `0`: Normal operation, no throttling detected
- `1`: Throttling detected

**Output includes:**
- All thermal zone temperatures
- CPU frequency information (max, current, ratio, governor)
- RAPL power limiting status
- Summary with any throttling indicators

## Testing Under Load

To verify the detection method works, use the stress test script:

```bash
./scripts/stress-test-thermal.sh 60  # 60-second stress test
```

This will:
1. Record baseline thermal state
2. Apply CPU load with `stress-ng`
3. Monitor thermal state continuously
4. Report if throttling occurred during the test

## System-Specific Information

**This system (lab.ardenone.com):**
- CPU: 12th Gen Intel Core i5-12500T (mobile, T-series)
- Cores: 12 (6P + 6E)
- Max frequency: 4.4 GHz
- Thermal design: Optimized for efficiency, will throttle earlier than desktop parts
- Normal operating temp: 65-75°C under sustained load

**Why this detection method works:**
1. **Multi-factor**: Uses temperature + frequency + power limiting for reliable detection
2. **Linux-native**: No external dependencies (lm-sensors not required)
3. **Non-invasive**: Read-only access to sysfs, no system modifications
4. **Fast**: Runs in <100ms, suitable for pre-benchmark checks

## Integration with Benchmarks

The verification script should be run before any benchmark that:
1. Runs for >10 seconds (sustained load)
2. Measures performance (CPU-bound operations)
3. Requires consistent results (thermal throttling causes variance)

Example usage:
```bash
# Check thermal state before benchmark
if ! ./scripts/verify-thermal-state.sh; then
    echo "ERROR: System is thermally throttled, cannot run benchmark"
    exit 1
fi

# Run benchmark
./scripts/benchmark-operations.sh
```

## Future Enhancements

Potential improvements for production use:
- Continuous monitoring during benchmarks (detect mid-test throttling)
- Logging thermal state to benchmark results
- Automated cooldown period between benchmark runs
- Historical tracking to identify thermal patterns

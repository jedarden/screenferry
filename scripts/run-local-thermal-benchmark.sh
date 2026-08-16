#!/bin/bash
# Local Thermal Benchmark Runner
# Runs the GE benchmark suite with continuous thermal monitoring on the local lab server
#
# Usage: ./run-local-thermal-benchmark.sh [options]
#
# Options:
#   --iterations <n>         Number of benchmark iterations (default: 3)
#   --stress-time <s>        Time to stress before benchmark (default: 120)
#   --monitor-interval <s>   Thermal monitoring interval (default: 2)
#   --continuous-stress      Keep stress running during benchmark
#   --results-dir <path>     Custom results directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="${PROJECT_ROOT}/benchmark-results/throttled"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Default configuration
ITERATIONS=3
STRESS_TIME=120
MONITOR_INTERVAL=2
CONTINUOUS_STRESS=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo "[$(date +'%H:%M:%S')] $1"
}

log_step() {
    echo -e "${GREEN}==>${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --iterations)
            ITERATIONS="$2"
            shift 2
            ;;
        --stress-time)
            STRESS_TIME="$2"
            shift 2
            ;;
        --monitor-interval)
            MONITOR_INTERVAL="$2"
            shift 2
            ;;
        --continuous-stress)
            CONTINUOUS_STRESS=true
            shift
            ;;
        --results-dir)
            RESULTS_DIR="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  --iterations <n>         Number of benchmark iterations (default: 3)"
            echo "  --stress-time <s>        Time to stress before benchmark (default: 120)"
            echo "  --monitor-interval <s>   Thermal monitoring interval (default: 2)"
            echo "  --continuous-stress      Keep stress running during benchmark"
            echo "  --results-dir <path>     Custom results directory"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Create results directory
mkdir -p "$RESULTS_DIR"

log "=== Local Thermal Benchmark Runner ==="
log "Results: $RESULTS_DIR"
log "Configuration:"
log "  - Iterations: $ITERATIONS"
log "  - Stress time: ${STRESS_TIME}s"
log "  - Monitor interval: ${MONITOR_INTERVAL}s"
log "  - Continuous stress: $CONTINUOUS_STRESS"
echo ""

# Thermal monitoring functions
get_temperature() {
    if [ -f /sys/class/thermal/thermal_zone0/temp ]; then
        temp=$(cat /sys/class/thermal/thermal_zone0/temp)
        echo "scale=1; $temp / 1000" | bc
    else
        echo "N/A"
    fi
}

get_cpu_freq() {
    if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq ]; then
        freq=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq)
        echo "scale=2; $freq / 1000000" | bc
    else
        echo "N/A"
    fi
}

get_cpu_max_freq() {
    if [ -f /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq ]; then
        max_freq=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq)
        echo "scale=2; $max_freq / 1000000" | bc
    else
        echo "N/A"
    fi
}

# Check for thermal throttling based on temperature and frequency
is_throttled() {
    local temp=$(get_temperature)
    local max_freq=$(get_cpu_max_freq)

    # Check if temperature is high (>80°C suggests thermal pressure)
    if [ "$temp" != "N/A" ]; then
        temp_int=$(echo "$temp / 1" | bc)
        if [ "$temp_int" -gt 80 ]; then
            return 0  # Throttling likely
        fi
    fi

    # Could also check if max frequency is reduced
    return 1  # No clear throttling
}

# Stress process management
STRESS_PIDS=""

start_stress() {
    log_step "Starting CPU stress..."
    local duration=$1

    # Kill any existing stress processes
    pkill -f stress-cpu.mjs 2>/dev/null || true

    # Start multiple stress processes in background
    for i in {1..4}; do
        nohup node "$PROJECT_ROOT/spike/stress-cpu.mjs" "$duration" > "/tmp/stress-$i.log" 2>&1 &
        STRESS_PIDS="$STRESS_PIDS $!"
    done

    log_success "Started 4 stress processes (PIDs: $STRESS_PIDS)"
    log "Stress duration: ${duration}s"
}

stop_stress() {
    if [ -n "$STRESS_PIDS" ]; then
        log_step "Stopping stress processes..."
        for pid in $STRESS_PIDS; do
            kill "$pid" 2>/dev/null || true
        done
        pkill -f stress-cpu.mjs 2>/dev/null || true
        log_success "Stress processes stopped"
        STRESS_PIDS=""
    fi
}

# Continuous thermal monitoring
start_monitoring() {
    local monitor_log="$1"
    local duration=$2

    log_step "Starting continuous thermal monitoring..."
    log "Monitor log: $monitor_log"
    log "Duration: ${duration}s, Interval: ${MONITOR_INTERVAL}s"

    # Write CSV header
    echo "timestamp,elapsed_s,temp_c,cpu_freq_ghz,cpu_max_freq_ghz,throttling_status" > "$monitor_log"

    local start_time=$(date +%s)
    local end_time=$((start_time + duration))
    local sample_count=0
    local last_status_report=0

    while [ $(date +%s) -lt $end_time ]; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local temp=$(get_temperature)
        local freq=$(get_cpu_freq)
        local max_freq=$(get_cpu_max_freq)
        local throttling_status="normal"

        if is_throttled; then
            throttling_status="throttled"
        fi

        # Log sample
        echo "$(date +%s),$elapsed,$temp,$freq,$max_freq,$throttling_status" >> "$monitor_log"
        sample_count=$((sample_count + 1))

        # Print status every 10 seconds
        if [ $((elapsed - last_status_report)) -ge 10 ]; then
            printf "  [$(date +'%H:%M:%S')] Temp: %4s°C | CPU: %3s GHz (max: %3s GHz) | Status: %s\n" \
                "$temp" "$freq" "$max_freq" "$throttling_status"
            last_status_report=$elapsed
        fi

        sleep $MONITOR_INTERVAL
    done

    log_success "Monitoring complete - collected $sample_count samples"
}

# Run benchmark iterations
run_benchmarks() {
    local iterations=$1
    local thermal_log="$2"

    log_step "Running GE benchmark suite ($iterations iterations)..."
    echo ""

    cd "$PROJECT_ROOT"

    for i in $(seq 1 $iterations); do
        log "Starting iteration $i/$iterations..."

        local iteration_start=$(date +%s)
        local iteration_output="$RESULTS_DIR/iteration-$i-$TIMESTAMP.log"
        local iteration_data="$RESULTS_DIR/iteration-$i-$TIMESTAMP.json"

        # Run the benchmark
        if npm test -- ge-benchmark.test.ts --reporter=verbose 2>&1 | tee "$iteration_output"; then
            local iteration_end=$(date +%s)
            local iteration_duration=$((iteration_end - iteration_start))

            log_success "Iteration $i completed in ${iteration_duration}s"

            # Check thermal state
            local temp=$(get_temperature)
            local freq=$(get_cpu_freq)
            local throttling_status=$(is_throttled && echo "THROTTLED" || echo "NORMAL")

            log_info "Thermal state: ${temp}°C, ${freq} GHz, $throttling_status"

            # If not throttling and continuous stress is enabled, restart stress
            if ! is_throttled && [ "$CONTINUOUS_STRESS" = true ]; then
                log_warn "Device cooled down, restarting stress..."
                stop_stress
                sleep 2
                start_stress 120
                sleep 10
            fi
        else
            log_error "Iteration $i failed"
        fi

        echo ""

        # Small pause between iterations
        sleep 5
    done

    log_success "All $iterations iterations completed"
}

# Generate comprehensive report
generate_report() {
    local monitor_log="$1"

    log_step "Generating comprehensive report..."

    local temp=$(get_temperature)
    local freq=$(get_cpu_freq)
    local max_freq=$(get_cpu_max_freq)

    local report_file="$RESULTS_DIR/report-$TIMESTAMP.md"

    cat > "$report_file" <<EOF
# Throttled Benchmark Report

**Task ID:** bf-6bali
**Date:** $(date)
**Host:** $(hostname)
**System:** $(uname -sr)

## Execution Summary

### Configuration
- **Benchmark iterations:** $ITERATIONS
- **Stress duration:** ${STRESS_TIME}s
- **Monitor interval:** ${MONITOR_INTERVAL}s
- **Continuous stress:** $CONTINUOUS_STRESS

### Final Thermal State
- **Temperature:** ${temp}°C
- **CPU frequency:** ${freq} GHz
- **CPU max frequency:** ${max_freq} GHz
- **Throttling status:** $(is_throttled && echo "ACTIVE" || echo "INACTIVE")

## Results Files

### Thermal Monitoring Log
- **File:** $monitor_log
- **Format:** CSV (timestamp, elapsed_s, temp_c, cpu_freq_ghz, cpu_max_freq_ghz, throttling_status)

### Benchmark Iterations
EOF

    # Add iteration file references
    for i in $(seq 1 $ITERATIONS); do
        echo "- **Iteration $i:** \`iteration-$i-$TIMESTAMP.log\`" >> "$report_file"
    done

    cat >> "$report_file" <<EOF

## Thermal State Analysis

### Temperature Profile
\`\`\`csv
$(head -20 "$monitor_log")
\`\`\`

### Performance Impact
The benchmark results captured during $(is_throttled && echo "THROTTLED" || echo "NORMAL") thermal conditions provide the following insights:

#### If Throttled:
- **Expected throughput reduction:** 20-40% from baseline
- **K_max impact:** May require reduction from K=768 to K=512 for Stage 3 compliance
- **Real-world relevance:** Reflects typical mobile device thermal conditions

#### If Normal:
- **Results represent:** Peak performance baseline
- **Device state:** No thermal constraints
- **Comparison point:** Use as reference for throttled comparison

## Recommendations

1. **For throttled operation:** Consider dynamic K adjustment based on thermal state
2. **For mobile deployment:** Implement thermal-aware K selection
3. **For testing:** Repeat under varied thermal conditions for validation

## Raw Data Access

All raw data files are available in: \`$RESULTS_DIR\`

---

**Generated by:** Local Thermal Benchmark Runner
**System:** $(uname -a)
**Execution time:** $(date +%s)
EOF

    log_success "Report saved to: $report_file"

    # Display summary
    echo ""
    log "=== Thermal State Summary ==="
    log "Temperature: ${temp}°C"
    log "CPU Frequency: ${freq} GHz (max: ${max_freq} GHz)"
    log "Throttling: $(is_throttled && echo "ACTIVE" || echo "INACTIVE")"
    echo ""

    # Show last few thermal samples
    log "=== Recent Thermal Samples ==="
    tail -5 "$monitor_log" | while IFS=, read -r timestamp elapsed temp freq max_freq status; do
        printf "  [%2s] Temp: %4s°C | CPU: %3s GHz | Status: %s\n" \
            "$elapsed" "$temp" "$freq" "$status"
    done
}

# Main execution
main() {
    log "=== Starting Local Thermal Benchmark Execution ==="
    echo ""

    # Get initial state
    log "Initial thermal state:"
    log "  Temperature: $(get_temperature)°C"
    log "  CPU frequency: $(get_cpu_freq) GHz (max: $(get_cpu_max_freq) GHz)"
    log "  Throttling: $(is_throttled && echo "YES" || echo "NO")"
    echo ""

    # Create monitor log path
    local monitor_log="$RESULTS_DIR/thermal-monitor-$TIMESTAMP.csv"

    # Calculate total time
    local total_time=$((STRESS_TIME + (ITERATIONS * 60) + 30))

    # Start stress and monitoring
    if [ "$CONTINUOUS_STRESS" = true ]; then
        start_stress "$total_time"
        log "Waiting ${STRESS_TIME}s for thermal buildup..."
        sleep "$STRESS_TIME"
    else
        start_stress "$STRESS_TIME"
        log "Waiting ${STRESS_TIME}s for thermal buildup..."
        sleep "$STRESS_TIME"
    fi

    log "Stress phase complete, starting benchmarks..."
    echo ""

    # Start monitoring in background
    start_monitoring "$monitor_log" "$total_time" &
    local monitor_pid=$!

    # Run benchmarks
    run_benchmarks "$ITERATIONS" "$monitor_log"

    # Stop monitoring
    kill "$monitor_pid" 2>/dev/null || true
    wait "$monitor_pid" 2>/dev/null || true

    # Stop stress
    stop_stress

    # Generate report
    generate_report "$monitor_log"

    echo ""
    log_success "=== Thermal Benchmark Execution Complete ==="
    log "All results saved to: $RESULTS_DIR"

    # Cleanup
    trap - EXIT
}

# Cleanup on exit
cleanup() {
    stop_stress
}

trap cleanup EXIT INT TERM

# Execute main
main "$@"
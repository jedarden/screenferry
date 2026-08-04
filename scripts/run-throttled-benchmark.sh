#!/bin/bash
# Throttled GE Benchmark Runner
#
# This script executes the complete GE benchmark suite while the device is
# thermally throttled. It:
# 1. Triggers sustained thermal throttling via stress testing
# 2. Verifies throttled state before benchmark starts
# 3. Runs all benchmark iterations while monitoring thermal state
# 4. Captures throughput results during throttled operation
#
# Usage: ./run-throttled-benchmark.sh [options]
#
# Options:
#   --timeout <seconds>      How long to wait for throttling (default: 600)
#   --benchmark-iterations <n> How many benchmark iterations to run (default: 3)
#   --monitor-interval <s>    How often to check thermal state (default: 5)
#   --keep-stress            Keep stress running after benchmark completes
#   --no-auto-throttle       Skip automatic throttling (use if already throttling)
#   --help                   Show this help message

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RESULTS_DIR="$PROJECT_ROOT/benchmark-results/throttled"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RESULT_FILE="$RESULTS_DIR/throttled-benchmark-$TIMESTAMP.json"
MONITOR_LOG="$RESULTS_DIR/thermal-monitor-$TIMESTAMP.log"

# Default configuration
TIMEOUT=600
BENCHMARK_ITERATIONS=3
MONITOR_INTERVAL=5
KEEP_STRESS=false
AUTO_THROTTLE=true

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

# Show help
usage() {
    grep '^#' "$0" | grep -v '#!/bin/bash' | sed 's/^# //' | sed 's/^#//'
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --timeout)
            TIMEOUT="$2"
            shift 2
            ;;
        --benchmark-iterations)
            BENCHMARK_ITERATIONS="$2"
            shift 2
            ;;
        --monitor-interval)
            MONITOR_INTERVAL="$2"
            shift 2
            ;;
        --keep-stress)
            KEEP_STRESS=true
            shift
            ;;
        --no-auto-throttle)
            AUTO_THROTTLE=false
            shift
            ;;
        --help)
            usage
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Create results directory
mkdir -p "$RESULTS_DIR"

log "=== Throttled GE Benchmark Runner ==="
log "Results will be saved to: $RESULT_FILE"
log "Monitor log: $MONITOR_LOG"
echo ""

# Check dependencies
check_dependencies() {
    log_step "Checking dependencies..."

    if ! command -v adb &> /dev/null; then
        log_error "ADB not found in PATH"
        exit 1
    fi

    if ! adb devices | grep -q "device$"; then
        log_error "No ADB device connected. Run 'adb-check' first."
        exit 1
    fi

    if ! command -v npm &> /dev/null; then
        log_error "npm not found in PATH"
        exit 1
    fi

    log_success "All dependencies available"
}

# Get thermal metrics
get_battery_temp() {
    temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
    if [ -n "$temp" ] && [ "$temp" != "N/A" ]; then
        echo "scale=1; $temp / 10" | bc
    else
        echo "N/A"
    fi
}

get_big_core_max_freq() {
    adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq 2>/dev/null" | tr -d '\r'
}

# Check if throttling is active
is_throttling_active() {
    local big_core_max=$(get_big_core_max_freq)
    # Throttling is detected when max frequency drops below 2500000 kHz
    if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
        return 0  # Throttling detected
    fi
    return 1  # No throttling
}

# Monitor thermal state during benchmark
monitor_during_benchmark() {
    local duration=$1
    local monitor_log=$2

    log_step "Starting thermal monitoring during benchmark..."

    local start_time=$(date +%s)
    local end_time=$((start_time + duration))
    local sample_count=0

    # Write CSV header
    echo "timestamp,elapsed_s,temp_c,big_core_max_khz,throttling_active" > "$monitor_log"

    while [ $(date +%s) -lt $end_time ]; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local temp=$(get_battery_temp)
        local big_core_max=$(get_big_core_max_freq)
        local throttling="false"

        if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
            throttling="true"
        fi

        # Log sample
        echo "$(date +%s),$elapsed,$temp,$big_core_max,$throttling" >> "$monitor_log"
        sample_count=$((sample_count + 1))

        # Print status every 30 seconds
        if [ $((sample_count % (30 / MONITOR_INTERVAL))) -eq 0 ]; then
            printf "  [$(date +'%H:%M:%S')] Temp: %3s°C | BigCore: %7s kHz | Throttling: %s\n" \
                "$temp" "$big_core_max" "$([ "$throttling" = "true" ] && echo "YES" || echo "NO")"
        fi

        sleep $MONITOR_INTERVAL
    done

    log_success "Collected $sample_count thermal samples"
}

# Trigger thermal throttling
trigger_throttling() {
    log_step "Triggering thermal throttling..."
    log "Timeout: ${TIMEOUT}s"
    echo ""

    # Run the trigger script in background
    local trigger_output="$RESULTS_DIR/trigger-output-$TIMESTAMP.log"

    bash "$SCRIPT_DIR/trigger-thermal-throttle.sh" "$TIMEOUT" > "$trigger_output" 2>&1 &
    local trigger_pid=$!

    log "Trigger script started (PID: $trigger_pid)"
    log "Monitoring for throttling detection..."

    # Wait for throttling to be detected
    local waited=0
    while ! is_throttling_active && [ $waited -lt $TIMEOUT ]; do
        sleep 5
        waited=$((waited + 5))

        if [ $((waited % 30)) -eq 0 ]; then
            local temp=$(get_battery_temp)
            local freq=$(get_big_core_max_freq)
            log "Still waiting... (${waited}s elapsed, temp: ${temp}°C, freq: ${freq} kHz)"
        fi
    done

    if is_throttling_active; then
        log_success "Thermal throttling detected after ${waited}s"

        # Verify throttling is sustained
        log "Verifying throttling is sustained (checking for 30s)..."
        local throttle_start=$(date +%s)
        local sustained=false

        while [ $(($(date +%s) - throttle_start)) -lt 30 ]; do
            if is_throttling_active; then
                sustained=true
                sleep 5
            else
                sustained=false
                break
            fi
        done

        if [ "$sustained" = true ]; then
            log_success "Throttling sustained for 30s - device is ready for benchmark"
        else
            log_warn "Throttling not sustained - may need more warmup time"
        fi

        return 0
    else
        log_error "Failed to trigger thermal throttling within ${TIMEOUT}s"
        log "Check trigger output: $trigger_output"
        return 1
    fi
}

# Run GE benchmark iterations
run_benchmark() {
    local iterations=$1

    log_step "Running GE benchmark ($iterations iterations)..."
    echo ""

    cd "$PROJECT_ROOT"

    # Run the benchmark tests
    local test_output="$RESULTS_DIR/test-output-$TIMESTAMP.log"
    local benchmark_data="$RESULTS_DIR/benchmark-data-$TIMESTAMP.json"

    # Run the benchmark with vitest
    for i in $(seq 1 $iterations); do
        log "Starting iteration $i/$iterations..."

        local iteration_start=$(date +%s)
        local iteration_output="$RESULTS_DIR/iteration-$i-$TIMESTAMP.log"

        # Run the benchmark and capture output
        if npm test -- ge-benchmark.test.ts 2>&1 | tee "$iteration_output"; then
            local iteration_end=$(date +%s)
            local iteration_duration=$((iteration_end - iteration_start))

            log_success "Iteration $i completed in ${iteration_duration}s"

            # Parse results from output
            # Look for throughput measurements in the test output
        else
            log_error "Iteration $i failed"
        fi

        # Check throttling state between iterations
        if is_throttling_active; then
            local temp=$(get_battery_temp)
            local freq=$(get_big_core_max_freq)
            log_info "Still throttling at ${temp}°C, ${freq} kHz"
        else
            log_warn "Throttling ended between iterations!"
        fi

        echo ""
    done

    log_success "All $iterations benchmark iterations completed"
}

# Stop stress processes
stop_stress() {
    log_step "Stopping stress processes..."

    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true
    adb shell "service call SurfaceFlinger 1020 i32 0" 2>/dev/null || true

    log_success "Stress processes stopped"
}

# Generate final report
generate_report() {
    log_step "Generating final report..."

    local report_file="$RESULTS_DIR/report-$TIMESTAMP.txt"

    cat > "$report_file" <<EOF
Throttled GE Benchmark Report
=============================
Timestamp: $(date)
Configuration:
  - Timeout: ${TIMEOUT}s
  - Benchmark iterations: $BENCHMARK_ITERATIONS
  - Monitor interval: ${MONITOR_INTERVAL}s

Thermal State:
  - Battery temp: $(get_battery_temp)°C
  - Big core max: $(get_big_core_max_freq) kHz
  - Throttling active: $(is_throttling_active && echo "YES" || echo "NO")

Results files:
  - Monitor log: $MONITOR_LOG
  - Result file: $RESULT_FILE
  - This report: $report_file
EOF

    log_success "Report saved to: $report_file"
    cat "$report_file"
}

# Main workflow
main() {
    check_dependencies

    # Get initial thermal state
    log "Initial thermal state:"
    log "  Battery temp: $(get_battery_temp)°C"
    log "  Big core max: $(get_big_core_max_freq) kHz"
    log "  Throttling: $(is_throttling_active && echo "YES" || echo "NO")"
    echo ""

    # Trigger throttling if requested
    if [ "$AUTO_THROTTLE" = true ]; then
        if trigger_throttling; then
            log_success "Device is throttled and ready for benchmark"
        else
            log_error "Failed to trigger throttling"
            exit 1
        fi
    else
        if is_throttling_active; then
            log_info "Device already throttling - skipping auto-throttle"
        else
            log_warn "Device not throttling - use --auto-throttle to trigger it"
            exit 1
        fi
    fi

    echo ""

    # Estimate benchmark duration (rough estimate: 30s per iteration)
    local estimated_duration=$((BENCHMARK_ITERATIONS * 30))

    # Start thermal monitoring in background
    log "Starting thermal monitoring in background..."
    monitor_during_benchmark $estimated_duration "$MONITOR_LOG" &
    local monitor_pid=$!

    # Run benchmark
    run_benchmark "$BENCHMARK_ITERATIONS"

    # Stop monitoring
    kill $monitor_pid 2>/dev/null || true
    wait $monitor_pid 2>/dev/null || true

    # Stop stress unless requested to keep it
    if [ "$KEEP_STRESS" = false ]; then
        stop_stress
    else
        log_info "Keeping stress running as requested"
    fi

    # Generate report
    generate_report

    echo ""
    log_success "=== Throttled benchmark completed ==="
    log "Results saved to: $RESULTS_DIR"

    if [ "$KEEP_STRESS" = true ]; then
        log_info "Stress processes still running - device remains throttled"
        log "Run 'adb-shell pkill -f dd' to stop them manually"
    fi
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

cleanup() {
    if [ "$KEEP_STRESS" = false ]; then
        stop_stress 2>/dev/null || true
    fi
}

# Run main workflow
main
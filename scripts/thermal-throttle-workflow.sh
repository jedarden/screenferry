#!/bin/bash
# Complete Thermal Throttling Workflow
# This script orchestrates the full process: baseline → stress → monitor → verify

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_step() {
    echo -e "${GREEN}==>${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

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

    log "✓ ADB device connected"
}

# Step 1: Capture baseline
capture_baseline() {
    log_step "Step 1: Capturing thermal baseline..."
    bash "$SCRIPT_DIR/monitor-thermal.sh" baseline
    echo ""
}

# Step 2: Start stress test
start_stress() {
    log_step "Step 2: Starting stress test..."
    log "This will run intensive CPU/GPU workloads to trigger thermal throttling"
    log "The device may become warm to the touch - this is expected"
    echo ""

    bash "$SCRIPT_DIR/stress-android.sh" all
    sleep 2
    echo ""
}

# Step 3: Monitor for throttling
monitor_for_throttling() {
    local duration="${1:-600}"  # Default 10 minutes
    local interval="${2:-10}"   # Check every 10 seconds

    log_step "Step 3: Monitoring for thermal throttling..."
    log "Monitoring every ${interval}s for up to ${duration}s"
    log "Looking for CPU frequency caps that indicate throttling"
    echo ""

    local start_time=$(date +%s)
    local end_time=$((start_time + duration))
    local throttling_detected=false
    local throttling_start=""

    while [ $(date +%s) -lt $end_time ]; do
        # Get battery temp (convert from tenths of degrees)
        temp_raw=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
        temp=$(echo "scale=1; $temp_raw / 10" | bc)

        # Get big core max frequency (cpu6-7 are the big cores)
        big_core_max=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq 2>/dev/null" | tr -d '\r')

        # Pixel 6 big cores normally run at 2802000 kHz (2.8 GHz)
        # Throttling is detected when max frequency drops below 2500000 kHz
        if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
            if [ "$throttling_detected" = false ]; then
                throttling_detected=true
                throttling_start=$(date +%s)
                log_warn "THERMAL THROTTLING DETECTED at ${temp}°C"
                log "Big core max frequency: ${big_core_max} kHz (normal: 2802000 kHz)"
            fi
        fi

        printf "[$(date +'%H:%M:%S')] Temp: %3s°C | Big Core Max: %7s kHz | Throttling: %s\n" \
            "$temp" "$big_core_max" "$([ "$throttling_detected" = true ] && echo "YES" || echo "NO")"

        if [ "$throttling_detected" = true ]; then
            local elapsed=$(($(date +%s) - throttling_start))
            log "Throttling duration: ${elapsed}s"
        fi

        sleep $interval
    done

    echo ""
    if [ "$throttling_detected" = true ]; then
        local total_throttle_time=$(($(date +%s) - throttling_start))
        log "✓ Thermal throttling sustained for ${total_throttle_time}s"
        return 0
    else
        log_warn "Thermal throttling not detected within ${duration}s"
        log "The device may need more time or the stress test may need adjustment"
        return 1
    fi
}

# Step 4: Verify and compare
verify_and_compare() {
    log_step "Step 4: Verifying throttling and comparing with baseline..."
    echo ""

    bash "$SCRIPT_DIR/monitor-thermal.sh" compare
    echo ""

    # Final snapshot
    bash "$SCRIPT_DIR/monitor-thermal.sh" snapshot
}

# Step 5: Cleanup
cleanup() {
    log_step "Step 5: Cleaning up stress processes..."
    bash "$SCRIPT_DIR/stress-android.sh" stop
    log "✓ Stress processes stopped"
}

# Full workflow
run_workflow() {
    local stress_duration="${1:-600}"   # How long to stress
    local monitor_interval="${2:-10}"    # How often to check

    log "Starting thermal throttling workflow"
    log "Stress duration: ${stress_duration}s, Monitor interval: ${monitor_interval}s"
    echo ""

    check_dependencies
    capture_baseline
    start_stress

    # Trap to ensure cleanup on exit
    trap cleanup EXIT

    if monitor_for_throttling "$stress_duration" "$monitor_interval"; then
        verify_and_compare
        log ""
        log_step "✓ Thermal throttling successfully triggered and verified"
        log "The device entered thermal throttling and sustained it"
        log "You can now run benchmarks in this throttled state"
    else
        log ""
        log_warn "Failed to detect thermal throttling"
        log "Consider:"
        log "  - Increasing the stress duration (e.g., 1200s for 20 minutes)"
        log "  - Checking ambient temperature (cooler room = harder to throttle)"
        log "  - Ensuring device is not in a cold environment"
    fi
}

# Quick test (5 minutes)
quick_test() {
    log "Running quick thermal throttling test (5 minutes)..."
    run_workflow 300 10
}

# Full test (15 minutes)
full_test() {
    log "Running full thermal throttling test (15 minutes)..."
    run_workflow 900 10
}

# Help
usage() {
    echo "Usage: $0 {quick|full|custom}"
    echo ""
    echo "Commands:"
    echo "  quick   - Quick test (5 minutes)"
    echo "  full    - Full test (15 minutes, recommended)"
    echo "  custom  - Custom duration (pass seconds)"
    echo ""
    echo "Example: $0 custom 900 10"
    echo "  This will run stress for 15 minutes (900s), checking every 10 seconds"
}

# Main menu
case "${1:-help}" in
    quick)
        quick_test
        ;;
    full)
        full_test
        ;;
    custom)
        run_workflow "${2:-900}" "${3:-10}"
        ;;
    *)
        usage
        exit 1
        ;;
esac

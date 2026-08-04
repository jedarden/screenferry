#!/bin/bash
# Thermal Throttling Trigger Utility
# Reliably triggers sustained thermal throttling on Android devices
# Usage: ./trigger-thermal-throttle.sh [timeout_seconds]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMEOUT="${1:-600}"  # Default 10 minutes
CHECK_INTERVAL=10    # Check every 10 seconds

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

# Check ADB connection
check_adb() {
    log_step "Checking ADB connection..."
    if ! command -v adb &> /dev/null; then
        log_error "ADB not found in PATH"
        exit 1
    fi

    if ! adb devices | grep -q "device$"; then
        log_error "No ADB device connected. Run 'adb-check' first."
        exit 1
    fi
    log_success "ADB device connected"
}

# Get battery temperature
get_battery_temp() {
    temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
    if [ -n "$temp" ] && [ "$temp" != "N/A" ]; then
        echo "scale=1; $temp / 10" | bc
    else
        echo "N/A"
    fi
}

# Get big core max frequency
get_big_core_max_freq() {
    adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq 2>/dev/null" | tr -d '\r'
}

# Check if throttling is active
is_throttling_active() {
    local big_core_max=$(get_big_core_max_freq)
    # Pixel 6 big cores normally run at 2802000 kHz (2.8 GHz)
    # Throttling is detected when max frequency drops below 2500000 kHz
    if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
        return 0  # Throttling detected
    fi
    return 1  # No throttling
}

# Start stress test
start_stress() {
    log_step "Starting stress test..."
    log "This will run intensive CPU/GPU workloads to trigger thermal throttling"
    log "Expected time to throttle: 2-5 minutes (varies by ambient temperature)"
    echo ""

    # Kill any existing stress processes
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true

    # Start CPU stressors
    adb shell "
        nohup sh -c '
            # 16 dd processes
            for i in \$(seq 1 16); do
                dd if=/dev/zero of=/dev/null bs=1M count=10000000 >/dev/null 2>&1 &
            done

            # 8 gzip compression loops
            for i in \$(seq 1 8); do
                while true; do
                    cat /dev/zero | gzip > /dev/null
                done &
            done
       ' > /dev/null 2>&1 &
    " &

    # Enable GPU stress
    adb shell "service call SurfaceFlinger 1020 i32 1 2>&1" || true

    sleep 3
    log_success "Stress test started (24 CPU processes + GPU rendering)"
}

# Stop stress test
stop_stress() {
    log_step "Stopping stress test..."
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true
    adb shell "service call SurfaceFlinger 1020 i32 0" 2>/dev/null || true
    log_success "Stress processes stopped"
}

# Monitor for throttling
monitor_for_throttling() {
    local timeout=$1
    local check_interval=$2

    log_step "Monitoring for thermal throttling..."
    log "Timeout: ${timeout}s, checking every ${check_interval}s"
    echo ""

    local start_time=$(date +%s)
    local end_time=$((start_time + timeout))
    local throttling_detected=false
    local throttling_start=""

    # Header
    printf "${BLUE}%-8s %-8s %-12s %-12s %-10s${NC}\n" \
        "Time" "Temp(°C)" "BigMaxFreq" "NormalMax" "Throttling"
    printf "%s\n" "---------------------------------------------------------------------------------"

    while [ $(date +%s) -lt $end_time ]; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local remaining=$((end_time - current_time))

        # Get metrics
        local temp=$(get_battery_temp)
        local big_core_max=$(get_big_core_max_freq)
        local normal_max=2802000

        # Check for throttling
        if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
            if [ "$throttling_detected" = false ]; then
                throttling_detected=true
                throttling_start=$(date +%s)
                log_warn "THERMAL THROTTLING DETECTED at ${temp}°C"
                printf "${RED}%-8s %-8s %-12s %-12s %-10s${NC}\n" \
                    "$(date +'%H:%M:%S')" "$temp" "$big_core_max" "$normal_max" "YES"
            else
                # Already throttling
                printf "${GREEN}%-8s %-8s %-12s %-12s %-10s${NC}\n" \
                    "$(date +'%H:%M:%S')" "$temp" "$big_core_max" "$normal_max" "YES"
            fi
        else
            printf "%-8s %-8s %-12s %-12s %-10s\n" \
                "$(date +'%H:%M:%S')" "$temp" "$big_core_max" "$normal_max" "NO"
        fi

        # Exit if throttling sustained for at least 30 seconds
        if [ "$throttling_detected" = true ]; then
            local throttle_duration=$(($(date +%s) - throttling_start))
            if [ "$throttle_duration" -ge 30 ]; then
                echo ""
                log_success "Thermal throttling sustained for ${throttle_duration}s"
                return 0
            fi
        fi

        sleep $check_interval
    done

    echo ""
    if [ "$throttling_detected" = true ]; then
        log_warn "Throttling detected but not sustained for 30+ seconds"
        return 1
    else
        log_warn "Thermal throttling not detected within ${timeout}s"
        log "The device may need:"
        log "  - More time (try increasing timeout)"
        log "  - Higher ambient temperature"
        log "  - Check if stress processes are still running"
        return 1
    fi
}

# Main execution
main() {
    log "=== Thermal Throttling Trigger Utility ==="
    log "Target: Sustained thermal throttling for 30+ seconds"
    echo ""

    check_adb

    # Get initial state
    local initial_temp=$(get_battery_temp)
    local initial_freq=$(get_big_core_max_freq)
    log "Initial battery temp: ${initial_temp}°C"
    log "Initial big core max: ${initial_freq} kHz"
    echo ""

    # Trap to ensure cleanup on exit
    trap stop_stress EXIT

    start_stress

    if monitor_for_throttling "$TIMEOUT" "$CHECK_INTERVAL"; then
        echo ""
        log_success "=== Thermal Throttling Successfully Triggered ==="
        log "Device is now in throttled state and ready for benchmarking"

        # Show final state
        local final_temp=$(get_battery_temp)
        local final_freq=$(get_big_core_max_freq)
        log "Final battery temp: ${final_temp}°C"
        log "Final big core max: ${final_freq} kHz"
        log "Frequency reduction: $((2802000 - final_freq)) kHz ($((100 * (2802000 - final_freq) / 2802000))%)"
        echo ""

        # Option: keep throttling for benchmark integration
        log "Press Ctrl+C to stop stress test and end throttling"
        log "Or run benchmark now - device will remain throttled until stopped"

        # Keep script running to maintain throttling state
        while true; do
            sleep 30
            if ! is_throttling_active; then
                log_warn "Throttling has ended - device cooled down"
                break
            fi
            log "Still throttling at $(get_battery_temp)°C, $(get_big_core_max_freq) kHz"
        done
    else
        echo ""
        log_error "=== Failed to Sustain Thermal Throttling ==="
        exit 1
    fi
}

# Help
usage() {
    echo "Usage: $0 [timeout_seconds]"
    echo ""
    echo "Arguments:"
    echo "  timeout_seconds  How long to wait for throttling (default: 600s = 10 minutes)"
    echo ""
    echo "Example:"
    echo "  $0 900    # Wait up to 15 minutes for throttling"
    echo ""
    echo "Integration mode (for scripts):"
    echo "  $0 300 && ./run-benchmark.sh"
    echo "  This will trigger throttling, then run benchmark when ready"
}

# Parse arguments
case "${1:-}" in
    -h|--help|help)
        usage
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac

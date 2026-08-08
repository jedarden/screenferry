#!/bin/bash
# Thermal Throttling Induction Script
# Stresses device to trigger thermal throttling with safety limits
# Usage: ./induce-throttling.sh [timeout_seconds]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMEOUT="${1:-300}"  # Default 5 minutes
CHECK_INTERVAL=10    # Check every 10 seconds
MAX_TEMP=55          # Safety limit: stop at 55°C
MIN_THROTTLE_TIME=30 # Minimum sustained throttling time

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
    if [ -n "$big_core_max" ] && [ "$big_core_max" != "0" ] && [ "$big_core_max" -lt 2500000 ]; then
        return 0  # Throttling detected
    fi
    return 1  # No throttling
}

# Start stress test
start_stress() {
    log_step "Starting thermal stress test..."
    log "Running intensive CPU workloads to trigger throttling"
    log "Safety timeout: ${TIMEOUT}s | Max temp: ${MAX_TEMP}°C"
    echo ""

    # Kill any existing stress processes
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true

    # Start CPU stressors
    adb shell "
        nohup sh -c '
            # 16 dd processes for CPU load
            for i in \$(seq 1 16); do
                dd if=/dev/zero of=/dev/null bs=1M count=10000000 >/dev/null 2>&1 &
            done

            # 8 gzip compression loops for additional CPU load
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
    log_success "Stress test started (24 CPU processes + GPU)"
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
    log "Timeout: ${timeout}s | Checking every ${check_interval}s"
    echo ""

    local start_time=$(date +%s)
    local end_time=$((start_time + timeout))
    local throttling_detected=false
    local throttling_start=""
    local throttle_duration=0

    # Header
    printf "${BLUE}%-8s %-10s %-12s %-12s %-10s${NC}\n" \
        "Time" "Temp(°C)" "BigMaxFreq" "NormalMax" "Status"
    printf "%s\n" "--------------------------------------------------------------------------------"

    while [ $(date +%s) -lt $end_time ]; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local remaining=$((end_time - current_time))

        # Get metrics
        local temp=$(get_battery_temp)
        local big_core_max=$(get_big_core_max_freq)
        local normal_max=2802000

        # Safety check: temperature limit
        if [ "$temp" != "N/A" ] && [ $(echo "$temp > $MAX_TEMP" | bc -l) -eq 1 ]; then
            echo ""
            log_warn "Safety limit reached: ${temp}°C (max: ${MAX_TEMP}°C)"
            log "Stopping stress test to prevent device damage"
            return 2
        fi

        # Check for throttling
        if is_throttling_active; then
            if [ "$throttling_detected" = false ]; then
                throttling_detected=true
                throttling_start=$(date +%s)
                log_warn "Thermal throttling detected at ${temp}°C"
                printf "${RED}%-8s %-10s %-12s %-12s %-10s${NC}\n" \
                    "$(date +'%H:%M:%S')" "$temp" "${big_core_max:-N/A}" "$normal_max" "ACTIVE"
            else
                # Already throttling - update duration
                throttle_duration=$(($(date +%s) - throttling_start))
                printf "${GREEN}%-8s %-10s %-12s %-12s %-10s${NC}\n" \
                    "$(date +'%H:%M:%S')" "$temp" "${big_core_max:-N/A}" "$normal_max" "${throttle_duration}s"

                # Check if sustained long enough
                if [ $throttle_duration -ge $MIN_THROTTLE_TIME ]; then
                    echo ""
                    log_success "Throttling sustained for ${throttle_duration}s (target: ${MIN_THROTTLE_TIME}s)"
                    return 0
                fi
            fi
        else
            printf "%-8s %-10s %-12s %-12s %-10s\n" \
                "$(date +'%H:%M:%S')" "$temp" "${big_core_max:-N/A}" "$normal_max " "No"
        fi

        sleep $check_interval
    done

    echo ""
    if [ "$throttling_detected" = true ]; then
        log_warn "Throttling detected but not sustained for ${MIN_THROTTLE_TIME}+ seconds (${throttle_duration}s)"
        return 1
    else
        log_warn "Thermal throttling not detected within ${timeout}s"
        return 1
    fi
}

# Report final status
report_status() {
    local final_temp=$(get_battery_temp)
    local final_freq=$(get_big_core_max_freq)
    local normal_max=2802000

    echo ""
    log "=== Final Status ==="
    log "Battery temp: ${final_temp}°C"
    log "Big core max: ${final_freq} kHz"

    if [ -n "$final_freq" ] && [ "$final_freq" != "0" ]; then
        local reduction=$((normal_max - final_freq))
        local percentage=$((100 * reduction / normal_max))
        log "Frequency reduction: ${reduction} kHz (${percentage}%)"
    fi

    if is_throttling_active; then
        log_success "Throttling status: ACTIVE"
        return 0
    else
        log_warn "Throttling status: NOT ACTIVE"
        return 1
    fi
}

# Main execution
main() {
    log "=== Thermal Throttling Induction ==="
    log "Target: Sustained throttling for ${MIN_THROTTLE_TIME}+ seconds"
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

    # Monitor and wait for result
    local result
    result=$(monitor_for_throttling "$TIMEOUT" "$CHECK_INTERVAL")
    local exit_code=$?

    # Always report final status
    report_status

    case $exit_code in
        0)
            echo ""
            log_success "=== Thermal Throttling Successfully Induced ==="
            log "Device is in throttled state and ready for testing"
            echo ""
            log "Press Ctrl+C to stop stress test"

            # Keep stress running to maintain throttling
            while true; do
                sleep 30
                if ! is_throttling_active; then
                    log_warn "Throttling has ended - device cooled down"
                    break
                fi
                log "Still throttling: $(get_battery_temp)°C, $(get_big_core_max_freq) kHz"
            done
            ;;
        1)
            echo ""
            log_error "=== Failed to Sustain Thermal Throttling ==="
            exit 1
            ;;
        2)
            echo ""
            log_warn "=== Stopped by Safety Limit ==="
            log "Device reached ${MAX_TEMP}°C safety limit"
            exit 0
            ;;
    esac
}

# Help
usage() {
    echo "Usage: $0 [timeout_seconds]"
    echo ""
    echo "Arguments:"
    echo "  timeout_seconds  How long to wait for throttling (default: 300s = 5 minutes)"
    echo ""
    echo "Safety limits:"
    echo "  - Max temperature: ${MAX_TEMP}°C"
    echo "  - Min throttle duration: ${MIN_THROTTLE_TIME}s"
    echo ""
    echo "Example:"
    echo "  $0 600    # Wait up to 10 minutes for throttling"
    echo ""
    echo "Integration mode:"
    echo "  $0 300 && ./run-benchmark.sh"
    echo "  Triggers throttling, then runs benchmark when ready"
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

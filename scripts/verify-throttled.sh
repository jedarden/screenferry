#!/bin/bash
# Thermal State Verification Function
# Reads thermal sensors and confirms throttled state
# Usage: ./verify-throttled.sh
#
# Exit codes:
#   0 - Device is throttled (verified)
#   1 - Device is NOT throttled
#   2 - Error (ADB not connected, sensors unavailable, etc.)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configuration
NORMAL_MAX_FREQ=2802000  # Pixel 6 big cores normal max: 2.8 GHz
THROTTLE_THRESHOLD=2500000  # Below 2.5 GHz = throttled
TEMP_WARNING_THRESHOLD=50    # Warn if above 50°C

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[!]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check ADB connection
check_adb() {
    if ! command -v adb &> /dev/null; then
        log_error "ADB not found in PATH"
        return 2
    fi

    if ! adb devices | grep -q "device$"; then
        log_error "No ADB device connected. Run 'adb-check' first."
        return 2
    fi

    return 0
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
    freq=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq 2>/dev/null" | tr -d '\r')
    if [ -n "$freq" ] && [ "$freq" != "0" ]; then
        echo "$freq"
    else
        echo "N/A"
    fi
}

# Get big core current frequency
get_big_core_cur_freq() {
    freq=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_cur_freq 2>/dev/null" | tr -d '\r')
    if [ -n "$freq" ] && [ "$freq" != "0" ]; then
        echo "$freq"
    else
        echo "N/A"
    fi
}

# Get CPU governor
get_cpu_governor() {
    gov=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_governor 2>/dev/null" | tr -d '\r')
    if [ -n "$gov" ]; then
        echo "$gov"
    else
        echo "N/A"
    fi
}

# Check if device is throttled
is_throttled() {
    local max_freq=$(get_big_core_max_freq)

    if [ "$max_freq" = "N/A" ]; then
        log_error "Unable to read CPU frequency"
        return 2
    fi

    if [ "$max_freq" -lt "$THROTTLE_THRESHOLD" ]; then
        return 0  # Throttled
    else
        return 1  # Not throttled
    fi
}

# Format frequency for display
format_freq() {
    local freq_khz=$1
    if [ "$freq_khz" = "N/A" ] || [ -z "$freq_khz" ]; then
        echo "N/A"
        return
    fi

    local freq_ghz=$(echo "scale=2; $freq_khz / 1000000" | bc)
    echo "${freq_ghz} GHz (${freq_khz} kHz)"
}

# Calculate frequency reduction percentage
calculate_reduction() {
    local current=$1
    local reduction=$((NORMAL_MAX_FREQ - current))
    local percentage=$((100 * reduction / NORMAL_MAX_FREQ))
    echo "${reduction} kHz (${percentage}%)"
}

# Main verification function
verify_throttled_state() {
    echo "=== Thermal State Verification ==="
    echo ""

    # Check ADB first
    if ! check_adb; then
        log_error "ADB connection check failed"
        echo ""
        echo "Thermal Metrics: UNAVAILABLE"
        echo "Throttle Status: ERROR"
        exit 2
    fi

    # Gather metrics
    local temp=$(get_battery_temp)
    local max_freq=$(get_big_core_max_freq)
    local cur_freq=$(get_big_core_cur_freq)
    local governor=$(get_cpu_governor)

    # Display thermal metrics
    echo "Thermal Metrics:"
    echo "  Battery Temperature: ${temp}°C"
    echo "  Big Core Max Freq:   $(format_freq "$max_freq")"
    echo "  Big Core Cur Freq:   $(format_freq "$cur_freq")"
    echo "  CPU Governor:        ${governor}"
    echo "  Normal Max Freq:      $(format_freq "$NORMAL_MAX_FREQ")"
    echo ""

    # Calculate and display frequency info
    if [ "$max_freq" != "N/A" ] && [ "$max_freq" != "0" ]; then
        local reduction=$(calculate_reduction "$max_freq")
        echo "Frequency Reduction: ${reduction} below normal"

        if [ "$max_freq" -lt "$THROTTLE_THRESHOLD" ]; then
            echo "Throttle Threshold:  $(format_freq "$THROTTLE_THRESHOLD")"
        fi
    fi

    echo ""

    # Check for temperature warning
    if [ "$temp" != "N/A" ]; then
        local temp_int=$(echo "$temp / 1" | bc)
        if [ "$temp_int" -ge "$TEMP_WARNING_THRESHOLD" ]; then
            log_warn "High temperature detected: ${temp}°C"
        fi
    fi

    # Determine throttling status
    if is_throttled; then
        log_success "Device is THROTTLED"
        echo ""
        echo "Throttle Status: ACTIVE (verified)"
        echo "Exit Code: 0"
        exit 0
    else
        log_warn "Device is NOT throttled"
        echo ""
        echo "Throttle Status: INACTIVE"
        echo "Exit Code: 1"
        exit 1
    fi
}

# Output metrics in machine-readable format (JSON)
output_json() {
    if ! check_adb 2>/dev/null; then
        echo '{"error":"ADB not connected","throttled":false,"exit_code":2}'
        exit 2
    fi

    local temp=$(get_battery_temp)
    local max_freq=$(get_big_core_max_freq)
    local cur_freq=$(get_big_core_cur_freq)
    local governor=$(get_cpu_governor)

    local throttled="false"
    if is_throttled 2>/dev/null; then
        throttled="true"
    fi

    cat <<EOF
{
  "battery_temp_c": ${temp:-null},
  "big_core_max_freq_khz": ${max_freq:-null},
  "big_core_cur_freq_khz": ${cur_freq:-null},
  "cpu_governor": "${governor}",
  "normal_max_freq_khz": ${NORMAL_MAX_FREQ},
  "throttle_threshold_khz": ${THROTTLE_THRESHOLD},
  "throttled": ${throttled},
  "timestamp": "$(date -Iseconds)"
}
EOF

    if [ "$throttled" = "true" ]; then
        exit 0
    else
        exit 1
    fi
}

# Help/usage
usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Verify thermal state and confirm throttled status.

Options:
  -h, --help          Show this help message
  -j, --json          Output metrics in JSON format
  -q, --quiet         Minimal output (exit code only)

Exit codes:
  0 - Device is throttled (verified)
  1 - Device is NOT throttled
  2 - Error (ADB not connected, sensors unavailable)

Examples:
  $0                  # Full verbose output
  $0 --json          # JSON output for automation
  $0 --quiet         # Silent check, exit code only

Integration:
  $0 && ./run-benchmark.sh
  # Only runs benchmark if device is throttled
EOF
}

# Parse arguments
case "${1:-}" in
    -h|--help|help)
        usage
        exit 0
        ;;
    -j|--json)
        output_json
        ;;
    -q|--quiet)
        # Minimal output, just check and exit
        if check_adb 2>/dev/null && is_throttled 2>/dev/null; then
            exit 0
        else
            exit 1
        fi
        ;;
    *)
        verify_throttled_state
        ;;
esac

#!/bin/bash
# Thermal Monitoring Script for Android
# Monitors CPU frequencies and battery temperature to detect thermal throttling

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

check_adb() {
    if ! adb devices | grep -q "device$"; then
        log "ERROR: No ADB device connected"
        exit 1
    fi
}

# Get battery temperature (returns value in Celsius, e.g. 301 = 30.1°C)
get_battery_temp() {
    temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
    if [ -n "$temp" ] && [ "$temp" != "N/A" ]; then
        echo "scale=1; $temp / 10" | bc
    else
        echo "N/A"
    fi
}

# Get CPU frequencies for all cores
get_cpu_frequencies() {
    echo "CPU Frequencies (kHz):"
    for cpu in $(adb shell "ls /sys/devices/system/cpu/ | grep -E 'cpu[0-9]+'"); do
        freq_path="/sys/devices/system/cpu/${cpu}/cpufreq/scaling_cur_freq"
        max_freq_path="/sys/devices/system/cpu/${cpu}/cpufreq/scaling_max_freq"
        if adb shell "[ -f $freq_path ]"; then
            freq=$(adb shell "cat $freq_path" | tr -d '\r')
            max_freq=$(adb shell "cat $max_freq_path" | tr -d '\r')
            governor=$(adb shell "cat /sys/devices/system/cpu/${cpu}/cpufreq/scaling_governor" | tr -d '\r')
            printf "  %-5s: %7s / %-7s kHz (governor: %s)\n" "$cpu" "$freq" "$max_freq" "$governor"
        fi
    done
}

# Check if throttling is detected
is_throttling() {
    # Throttling is detected if max frequency is significantly below normal
    # We'll look at the big cores (usually cpu6-cpu7) which normally run at highest freq
    big_core_max=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq" | tr -d '\r' 2>/dev/null || echo "0")

    # Pixel 6 big cores normally run at 2802000 kHz (2.8 GHz)
    # If max is below 2500000 kHz, we consider it throttled
    if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
        return 0  # Throttling detected
    fi
    return 1  # No throttling
}

# Single snapshot
snapshot() {
    check_adb
    log "=== Thermal Snapshot ==="
    temp=$(get_battery_temp)
    log "Battery Temperature: ${temp}°C"
    echo ""
    get_cpu_frequencies
    echo ""

    if is_throttling; then
        log "⚠️  THERMAL THROTTLING DETECTED"
        log "CPU frequencies are capped below normal maximum"
    else
        log "✓ No thermal throttling detected"
    fi
}

# Continuous monitoring
monitor() {
    local interval="${1:-5}"
    local duration="${2:-600}"  # Default 10 minutes

    check_adb
    log "Starting continuous thermal monitoring (interval: ${interval}s, duration: ${duration}s)"
    log "Press Ctrl+C to stop"

    local start_time=$(date +%s)
    local end_time=$((start_time + duration))

    while [ $(date +%s) -lt $end_time ]; do
        snapshot
        echo ""
        sleep $interval
    done

    log "Monitoring completed"
}

# Baseline capture (before stress test)
baseline() {
    check_adb
    log "=== Thermal Baseline (Before Stress Test) ==="
    temp=$(get_battery_temp)
    log "Battery Temperature: ${temp}°C"
    echo ""
    get_cpu_frequencies
    echo ""

    # Save baseline for comparison
    adb shell "cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq" > /tmp/baseline_max_freqs.txt
    adb shell "cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq" > /tmp/baseline_cur_freqs.txt

    log "Baseline saved to /tmp/"
}

# Compare with baseline
compare() {
    log "=== Comparing with Baseline ==="
    if [ ! -f /tmp/baseline_max_freqs.txt ]; then
        log "ERROR: No baseline found. Run 'baseline' first."
        exit 1
    fi

    log "Baseline Max Frequencies:"
    cat /tmp/baseline_max_freqs.txt
    echo ""

    log "Current Max Frequencies:"
    adb shell "cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_max_freq"
    echo ""

    log "Baseline Current Frequencies:"
    cat /tmp/baseline_cur_freqs.txt
    echo ""

    log "Current Current Frequencies:"
    adb shell "cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq"
}

# Main menu
case "${1:-snapshot}" in
    snapshot)
        snapshot
        ;;
    monitor)
        monitor "${2:-5}" "${3:-600}"
        ;;
    baseline)
        baseline
        ;;
    compare)
        compare
        ;;
    *)
        echo "Usage: $0 {snapshot|monitor|baseline|compare}"
        echo ""
        echo "Commands:"
        echo "  snapshot    - Take a single thermal snapshot (default)"
        echo "  monitor     - Continuously monitor (interval in seconds, duration in seconds)"
        echo "                Example: $0 monitor 5 600 (every 5s for 10 minutes)"
        echo "  baseline    - Capture baseline frequencies before stress test"
        echo "  compare     - Compare current state with baseline"
        exit 1
        ;;
esac

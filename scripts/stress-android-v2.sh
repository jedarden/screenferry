#!/bin/bash
# Enhanced Android Stress Test for Thermal Throttling
# This script provides configurable intensity levels and improved CPU/GPU loading

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADB_DEVICE="${ADB_DEVICE:-}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

check_adb() {
    if ! adb devices | grep -q "device$"; then
        log_error "No ADB device connected"
        exit 1
    fi
    log_success "ADB device connected"
}

# Enhanced CPU stress with configurable intensity
stress_cpu() {
    local intensity="${1:-5}"  # 1-10 scale

    log_info "Starting CPU stress test (intensity: $intensity)..."

    # Kill any existing stress processes first
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'sha256sum'" 2>/dev/null || true
    adb shell "pkill -f 'bzip2'" 2>/dev/null || true

    sleep 1

    # Calculate process counts based on intensity
    local dd_processes=$((4 + intensity * 2))      # 6-24 dd processes
    local gzip_processes=$((2 + intensity))        # 3-12 gzip processes
    local sha_processes=$((1 + intensity / 2))     # 1-6 sha256sum processes
    local total_processes=$((dd_processes + gzip_processes + sha_processes))

    log_info "Starting $total_processes stress processes ($dd_processes dd + $gzip_processes gzip + $sha_processes sha256sum)"

    # Start enhanced CPU stressors
    adb shell "
        nohup sh -c '
            # DD processes - sustained read operations
            for i in \$(seq 1 $dd_processes); do
                dd if=/dev/zero of=/dev/null bs=1M count=10000000 >/dev/null 2>&1 &
            done

            # GZIP compression loops - very CPU intensive
            for i in \$(seq 1 $gzip_processes); do
                while true; do
                    cat /dev/zero | gzip > /dev/null
                done &
            done

            # SHA256sum calculations - cryptographic operations
            for i in \$(seq 1 $sha_processes); do
                while true; do
                    cat /dev/zero | sha256sum > /dev/null
                done &
            done

            echo \"CPU stress started with $total_processes processes\"
        ' > /dev/null 2>&1 &
    " &

    sleep 3
    log_info "Verifying stress processes are running..."
    local count=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')
    log_success "Active stress processes: $count"
}

# Enhanced GPU stress
stress_gpu() {
    local intensity="${1:-5}"  # 1-10 scale

    log_info "Starting GPU stress test (intensity: $intensity)..."

    # Try multiple GPU stress approaches
    adb shell "
        # Enable GPU rendering acceleration
        service call SurfaceFlinger 1020 i32 1 2>&1 || true

        # Force GPU composition
        service call SurfaceFlinger 1035 i32 1 2>&1 || true

        # Set OpenGL ES debug mode for additional GPU load
        setprop debug.egl 1 2>&1 || true

        echo 'GPU stress enabled via SurfaceFlinger'
    "

    # Additional GPU stress using animation (if supported)
    adb shell "
        nohup sh -c '
            # Start GPU-intensive animation
            for i in \$(seq 1 $((intensity))); do
                while true; do
                    # Force screen redraws
                    service call SurfaceFlinger 1018 2>&1 || true
                    sleep 0.1
                done &
            done
        ' > /dev/null 2>&1 &
    " 2>/dev/null || true

    log_success "GPU stress enabled"
}

# Combined stress test with intensity control
stress_all() {
    local intensity="${1:-5}"

    log_info "Starting combined CPU+GPU stress test (intensity: $intensity)..."
    log_warn "This will make your device warm - this is expected behavior"
    log_warn "Stop immediately if device becomes uncomfortable to handle"

    stress_cpu "$intensity"
    sleep 2
    stress_gpu "$intensity"

    log_success "Stress test started with intensity $intensity"
    log_info "Monitor with: $0 monitor"
}

# Quick stress test (5 minutes)
stress_quick() {
    local intensity="${1:-5}"

    log_info "Starting 5-minute quick stress test (intensity: $intensity)..."
    stress_all "$intensity"

    log_info "Stress test will run for 5 minutes"
    log_info "Press Ctrl+C to stop early"

    # Monitor for 5 minutes
    local end_time=$(($(date +%s) + 300))
    while [ $(date +%s) -lt $end_time ]; do
        sleep 30
        local temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
        local temp_c=$(echo "scale=1; $temp / 10" | bc 2>/dev/null || echo "$temp")
        local remaining=$((end_time - $(date +%s)))
        log_info "Temperature: ${temp_c}°C | ${remaining}s remaining"
    done

    log_info "Quick stress test completed"
    stop_stress
}

# Sustained stress test (15+ minutes)
stress_sustained() {
    local intensity="${1:-5}"
    local duration="${2:-900}"  # 15 minutes default

    log_info "Starting ${duration}s sustained stress test (intensity: $intensity)..."
    stress_all "$intensity"

    log_info "Stress test will run for ${duration}s"
    log_info "Press Ctrl+C to stop early"

    # Monitor throughout
    local end_time=$(($(date +%s) + duration))
    while [ $(date +%s) -lt $end_time ]; do
        sleep 60
        local temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
        local temp_c=$(echo "scale=1; $temp / 10" | bc 2>/dev/null || echo "$temp")

        # Check for throttling
        local big_core_max=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq" | tr -d '\r' 2>/dev/null || echo "0")
        local throttle_status="No throttling"
        if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
            throttle_status="THROTTLING DETECTED"
            log_warn "Temperature: ${temp_c}°C | Big cores: ${big_core_max} kHz | $throttle_status"
        else
            log_info "Temperature: ${temp_c}°C | Big cores: ${big_core_max} kHz | $throttle_status"
        fi

        local remaining=$((end_time - $(date +%s)))
        log_info "${remaining}s remaining"
    done

    log_info "Sustained stress test completed"
    stop_stress
}

# Stop all stress processes
stop_stress() {
    log_info "Stopping stress tests..."

    # Kill all stress processes
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'sha256sum'" 2>/dev/null || true
    adb shell "pkill -f 'bzip2'" 2>/dev/null || true
    adb shell "pkill -f 'stress'" 2>/dev/null || true

    # Reset GPU settings
    adb shell "service call SurfaceFlinger 1020 i32 0" 2>/dev/null || true
    adb shell "service call SurfaceFlinger 1035 i32 0" 2>/dev/null || true

    sleep 1

    # Verify cleanup
    local remaining=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')
    if [ "$remaining" -gt 0 ]; then
        log_warn "Still have $remaining stress processes"
    else
        log_success "All stress processes stopped"
    fi
}

# Monitor stress status
monitor_stress() {
    log_info "=== Stress Test Status ==="

    echo ""
    echo "Active stress processes:"
    local count=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')
    echo "Total stress processes: $count"

    echo ""
    echo "Process breakdown:"
    adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum'" || echo "No stress processes found"

    echo ""
    echo "Thermal status:"
    local temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
    local temp_c=$(echo "scale=1; $temp / 10" | bc 2>/dev/null || echo "$temp")
    echo "Battery temperature: ${temp_c}°C"

    local big_core_max=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq" | tr -d '\r' 2>/dev/null || echo "0")
    echo "Big core max frequency: ${big_core_max} kHz"

    if [ "$big_core_max" -lt 2500000 ] && [ "$big_core_max" -gt 0 ]; then
        log_warn "THERMAL THROTTLING DETECTED"
    else
        log_success "No thermal throttling"
    fi

    echo ""
    echo "CPU load:"
    adb shell "top -n 1 | grep -A 5 'CPU'" || echo "Unable to get CPU info"
}

# Show help
show_help() {
    cat << EOF
Enhanced Android Stress Test Tool

Usage: $0 [command] [options]

Commands:
  cpu [intensity]     - Stress CPU only (intensity: 1-10, default: 5)
  gpu [intensity]     - Stress GPU only (intensity: 1-10, default: 5)
  all [intensity]     - Stress CPU and GPU (intensity: 1-10, default: 5)
  quick [intensity]   - 5-minute automated stress test
  sustained [int] [duration] - Sustained stress test (default: 15 minutes)
  stop               - Stop all stress processes
  monitor            - Monitor active stress processes and thermal status

Intensity Levels:
  1-3  : Low intensity (basic testing)
  4-7  : Medium intensity (recommended for thermal throttling)
  8-10 : High intensity (maximum heat generation)

Examples:
  # Start medium intensity stress test
  $0 all 7

  # Quick 5-minute test with high intensity
  $0 quick 8

  # 20-minute sustained test
  $0 sustained 7 1200

  # Monitor current status
  $0 monitor

  # Stop stress test
  $0 stop

⚠️  WARNING: This will make your device warm!
    Stop immediately if device becomes uncomfortable to handle.

EOF
}

# Main menu
case "${1:-help}" in
    cpu)
        check_adb
        stress_cpu "${2:-5}"
        ;;
    gpu)
        check_adb
        stress_gpu "${2:-5}"
        ;;
    all)
        check_adb
        stress_all "${2:-5}"
        ;;
    quick)
        check_adb
        stress_quick "${2:-5}"
        ;;
    sustained)
        check_adb
        stress_sustained "${2:-5}" "${3:-900}"
        ;;
    stop)
        check_adb
        stop_stress
        ;;
    monitor)
        check_adb
        monitor_stress
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
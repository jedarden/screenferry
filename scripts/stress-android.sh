#!/bin/bash
# Android Stress Test for Thermal Throttling
# This script runs intensive CPU/GPU workloads to trigger thermal throttling

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADB_DEVICE="${ADB_DEVICE:-}"

log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

check_adb() {
    if ! adb devices | grep -q "device$"; then
        log "ERROR: No ADB device connected"
        exit 1
    fi
    log "ADB device connected"
}

# Stress CPU using multiple processes (combination of dd and gzip)
stress_cpu() {
    log "Starting CPU stress test..."

    # Kill any existing stress processes first
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true

    # Start CPU stressors - multiple approaches for maximum heat generation
    # 1. dd processes that read from /dev/zero
    # 2. gzip compression loops (very CPU-intensive)
    adb shell "
        nohup sh -c '
            # 16 dd processes
            for i in \$(seq 1 16); do
                dd if=/dev/zero of=/dev/null bs=1M count=10000000 >/dev/null 2>&1 &
            done

            # 8 gzip compression loops (keeps CPU busy with compression)
            for i in \$(seq 1 8); do
                while true; do
                    cat /dev/zero | gzip > /dev/null
                done &
            done

            echo \"CPU stress started with 24 processes (16 dd + 8 gzip)\"
       ' > /dev/null 2>&1 &
    " &

    sleep 3
    log "Verifying stress processes are running..."
    adb shell "ps | grep -E 'dd if=/dev/zero|gzip' | wc -l"
}

# Stress GPU by rendering operations
stress_gpu() {
    log "Starting GPU stress test..."

    # Use a simple OpenGL ES stress test if available, otherwise fall back to surface flinger
    adb shell "
        # Force GPU rendering activity
        service call SurfaceFlinger 1020 i32 1 2>&1 || true
        echo 'GPU stress enabled via SurfaceFlinger'
    "
}

# Combined stress test
stress_all() {
    log "Starting combined CPU+GPU stress test..."
    stress_cpu
    sleep 2
    stress_gpu
}

# Stop all stress processes
stop_stress() {
    log "Stopping stress tests..."
    adb shell "pkill -f 'dd if=/dev/zero'" 2>/dev/null || true
    adb shell "pkill -f 'gzip'" 2>/dev/null || true
    adb shell "pkill -f 'cat /dev/zero'" 2>/dev/null || true
    adb shell "service call SurfaceFlinger 1020 i32 0" 2>/dev/null || true
    log "Stress processes stopped"
}

# Monitor stress status
monitor_stress() {
    adb shell "
        echo 'Active stress processes:'
        ps | grep -E 'dd if=/dev/zero|stress' || echo 'No stress processes running'
        echo ''
        echo 'CPU load:'
        top -n 1 | grep -A 5 'CPU'
    "
}

# Main menu
case "${1:-help}" in
    cpu)
        check_adb
        stress_cpu
        ;;
    gpu)
        check_adb
        stress_gpu
        ;;
    all)
        check_adb
        stress_all
        ;;
    stop)
        check_adb
        stop_stress
        ;;
    monitor)
        check_adb
        monitor_stress
        ;;
    *)
        echo "Usage: $0 {cpu|gpu|all|stop|monitor}"
        echo ""
        echo "Commands:"
        echo "  cpu     - Stress CPU only"
        echo "  gpu     - Stress GPU only"
        echo "  all     - Stress CPU and GPU (recommended for throttling)"
        echo "  stop    - Stop all stress processes"
        echo "  monitor - Monitor active stress processes"
        exit 1
        ;;
esac

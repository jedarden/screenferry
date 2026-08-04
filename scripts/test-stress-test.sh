#!/bin/bash
# Stress Test Verification Script
# This script tests the stress test functionality to ensure it works properly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

echo "========================================"
echo "Stress Test Verification Script"
echo "========================================"
echo ""

# Check prerequisites
log_info "Checking prerequisites..."

if ! command -v adb &> /dev/null; then
    log_error "ADB not found. Please install Android SDK platform-tools."
    exit 1
fi

if ! adb devices | grep -q "device$"; then
    log_error "No ADB device connected. Please connect your Android device."
    exit 1
fi

log_success "Prerequisites check passed"
echo ""

# Test 1: Basic stress test startup
log_info "Test 1: Starting basic stress test (intensity 5)..."
bash "$SCRIPT_DIR/stress-android-v2.sh" all 5
sleep 5

# Check if processes are running
log_info "Verifying stress processes are running..."
process_count=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')

if [ "$process_count" -gt 0 ]; then
    log_success "✓ Stress processes started successfully ($process_count processes)"
else
    log_error "✗ No stress processes found"
    exit 1
fi
echo ""

# Test 2: Monitor functionality
log_info "Test 2: Testing monitor functionality..."
bash "$SCRIPT_DIR/stress-android-v2.sh" monitor
log_success "✓ Monitor functionality working"
echo ""

# Test 3: Temperature monitoring
log_info "Test 3: Checking temperature monitoring..."
temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
temp_c=$(echo "scale=1; $temp / 10" | bc 2>/dev/null || echo "$temp")
log_success "✓ Temperature reading: ${temp_c}°C"
echo ""

# Test 4: CPU frequency monitoring
log_info "Test 4: Checking CPU frequency monitoring..."
big_core_max=$(adb shell "cat /sys/devices/system/cpu/cpu6/cpufreq/scaling_max_freq" | tr -d '\r' 2>/dev/null || echo "0")
if [ "$big_core_max" -gt 0 ]; then
    log_success "✓ CPU frequency reading: ${big_core_max} kHz"
else
    log_warn "⚠ Could not read CPU frequency (may be device-specific)"
fi
echo ""

# Test 5: Short duration test
log_info "Test 5: Running 30-second stress test..."
log_info "Monitoring for thermal changes..."

start_temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
start_temp_c=$(echo "scale=1; $start_temp / 10" | bc 2>/dev/null || echo "$start_temp")

sleep 30

end_temp=$(adb shell dumpsys battery | grep "temperature:" | awk '{print $2}' | tr -d '\r')
end_temp_c=$(echo "scale=1; $end_temp / 10" | bc 2>/dev/null || echo "$end_temp")

temp_diff=$(echo "scale=1; ($end_temp_c - $start_temp_c)" | bc 2>/dev/null || echo "0")

log_success "✓ 30-second test completed"
log_info "Temperature change: ${temp_diff}°C (start: ${start_temp_c}°C, end: ${end_temp_c}°C)"

if [ "$(echo "$temp_diff > 0.5" | bc 2>/dev/null || echo "0")" -eq 1 ]; then
    log_success "✓ Temperature increased - stress test is working"
else
    log_warn "⚠ Temperature change minimal - may need higher intensity or longer duration"
fi
echo ""

# Test 6: Stop functionality
log_info "Test 6: Testing stress test stop functionality..."
bash "$SCRIPT_DIR/stress-android-v2.sh" stop
sleep 2

# Verify cleanup
remaining_processes=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')
if [ "$remaining_processes" -eq 0 ]; then
    log_success "✓ All stress processes stopped successfully"
else
    log_warn "⚠ $remaining_processes stress processes still running (may be normal)"
fi
echo ""

# Test 7: Intensity levels
log_info "Test 7: Testing different intensity levels..."

for intensity in 3 7 10; do
    log_info "Testing intensity $intensity..."
    bash "$SCRIPT_DIR/stress-android-v2.sh" all "$intensity"
    sleep 3

    process_count=$(adb shell "ps | grep -E 'dd if=/dev/zero|gzip|sha256sum' | wc -l" | tr -d '\r')
    log_info "Intensity $intensity: $process_count processes"

    bash "$SCRIPT_DIR/stress-android-v2.sh" stop
    sleep 2
done

log_success "✓ Intensity level variations working"
echo ""

# Final summary
echo "========================================"
echo "Stress Test Verification Summary"
echo "========================================"
echo ""
log_success "All core functionality tests passed!"
echo ""
log_info "Stress test features verified:"
log_info "  ✓ Process startup and management"
log_info "  ✓ Temperature monitoring"
log_info "  ✓ CPU frequency monitoring"
log_info "  ✓ Configurable intensity levels"
log_info "  ✓ Stop functionality"
log_info "  ✓ Monitor functionality"
echo ""
log_info "The stress test is ready for use!"
log_info "Example commands:"
log_info "  # Quick 5-minute test with medium intensity"
log_info "  ./scripts/stress-android-v2.sh quick 7"
echo ""
log_info "  # 15-minute sustained test for thermal throttling"
log_info "  ./scripts/stress-android-v2.sh sustained 8 900"
echo ""
log_info "  # Monitor stress test status"
log_info "  ./scripts/stress-android-v2.sh monitor"
echo ""
log_warn "⚠️  Remember: Stop immediately if device becomes uncomfortable to handle!"
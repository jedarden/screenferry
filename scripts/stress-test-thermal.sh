#!/usr/bin/env bash
# Thermal Stress Test
# Applies CPU load and monitors for thermal throttling
# Usage: ./scripts/stress-test-thermal.sh [duration_seconds]

set -euo pipefail

DURATION="${1:-30}"  # Default 30 seconds
STRESS_DURATION=10   # How long to stress CPU
MONITOR_INTERVAL=2   # How often to check thermal state

echo "=== Thermal Stress Test ==="
echo "Duration: ${DURATION}s (stress ${STRESS_DURATION}s, monitor every ${MONITOR_INTERVAL}s)"
echo "Timestamp: $(date)"
echo

# Record baseline
echo "--- Baseline State ---"
./scripts/verify-thermal-state.sh || {
    echo "ERROR: System already throttling at baseline!"
    exit 1
}
echo

# Install stress-ng if not present
if ! command -v stress-ng &> /dev/null; then
    echo "Installing stress-ng..."
    sudo apt-get update -qq && sudo apt-get install -y stress-ng || {
        echo "ERROR: Failed to install stress-ng"
        echo "Falling back to using yes command for load generation"
    }
else
    echo "stress-ng already installed"
fi

echo "--- Starting Stress Test ---"
echo "Applying CPU load for ${STRESS_DURATION}s..."

# Start stress in background
if command -v stress-ng &> /dev/null; then
    stress-ng --cpu 12 --cpu-method matrix --timeout "${STRESS_DURATION}s" --quiet &
    STRESS_PID=$!
else
    # Fallback: simple load generator
    yes > /dev/null &
    STRESS_PID=$!
    # Spawn multiple instances for all cores
    for i in $(seq 1 11); do
        yes > /dev/null &
    done
fi

# Monitor thermal state during stress
THROTTLE_DETECTED=0
MONITOR_COUNT=0
END_TIME=$(($(date +%s) + STRESS_DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
    MONITOR_COUNT=$((MONITOR_COUNT + 1))
    echo "--- Check ${MONITOR_COUNT} ($(date +%H:%M:%S)) ---"

    if ! ./scripts/verify-thermal-state.sh; then
        THROTTLE_DETECTED=1
        echo "⚠️  THROTTLING DETECTED during stress test!"
    fi

    sleep $MONITOR_INTERVAL
done

# Clean up stress process
if [ -n "${STRESS_PID:-}" ]; then
    kill $STRESS_PID 2>/dev/null || true
    # Kill fallback yes processes if they exist
    pkill -9 yes 2>/dev/null || true
fi

# Allow cooldown
echo
echo "--- Cooldown Period ---"
echo "Waiting 5 seconds for temperatures to normalize..."
sleep 5

echo
echo "--- Post-Stress State ---"
./scripts/verify-thermal-state.sh

echo
echo "=== Stress Test Summary ==="
if [ "$THROTTLE_DETECTED" -eq 1 ]; then
    echo "✗ Throttling occurred during stress test"
    echo "This indicates the system reached thermal limits under load"
    echo "Consider: reducing benchmark duration, improving cooling, or accepting thermal variance"
    exit 1
else
    echo "✓ No throttling detected during stress test"
    echo "System maintained thermal and frequency limits under sustained load"
    echo "Detection method is working correctly"
    exit 0
fi

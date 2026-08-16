#!/usr/bin/env bash
# Thermal Throttling Detection Script
# Monitors thermal state, CPU frequency scaling, and power limiting
# Returns exit code 1 if throttling is detected, 0 if normal

set -euo pipefail

THROTTLE_DETECTED=0
INDICATORS=""
MAX_TEMP=0

echo "=== Thermal State Verification ==="
echo "Timestamp: $(date)"
echo

# Check thermal zones
echo "--- Thermal Zones ---"
for zone in /sys/class/thermal/thermal_zone*; do
    zone_type=$(cat "$zone/type" 2>/dev/null || echo "unknown")
    zone_temp=$(cat "$zone/temp" 2>/dev/null || echo "0")

    # Convert millidegrees to Celsius
    temp_c=$((zone_temp / 1000))

    echo "  ${zone_type}: ${temp_c}°C"

    # Track maximum temperature for later checks
    if [ "$temp_c" -gt "$MAX_TEMP" ]; then
        MAX_TEMP=$temp_c
    fi

    # Flag high temperatures (typically > 85°C indicates throttling on Intel)
    if [ "$temp_c" -gt 85 ]; then
        THROTTLE_DETECTED=1
        INDICATORS="${INDICATORS}high_temp(${zone_type}:${temp_c}C) "
    fi
done
echo

# Check CPU frequency scaling
echo "--- CPU Frequency Scaling ---"
MAX_FREQ_KHZ=$(cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null || echo "0")
MAX_FREQ_MHZ=$((MAX_FREQ_KHZ / 1000))
MAX_FREQ_GHZ=$(awk "BEGIN {printf \"%.2f\", $MAX_FREQ_MHZ / 1000}")

echo "  Max Frequency: ${MAX_FREQ_GHZ} GHz"

CUR_FREQ_KHZ=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq 2>/dev/null || echo "0")
CUR_FREQ_MHZ=$((CUR_FREQ_KHZ / 1000))
CUR_FREQ_GHZ=$(awk "BEGIN {printf \"%.2f\", $CUR_FREQ_MHZ / 1000}")

echo "  Current Frequency: ${CUR_FREQ_GHZ} GHz"

GOVERNOR=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo "unknown")
echo "  Governor: ${GOVERNOR}"

# Calculate frequency ratio
if [ "$MAX_FREQ_KHZ" -gt 0 ]; then
    FREQ_RATIO=$(awk "BEGIN {printf \"%.0f\", ($CUR_FREQ_KHZ / $MAX_FREQ_KHZ) * 100}")
    echo "  Frequency Ratio: ${FREQ_RATIO}%"

    # Flag significant frequency reduction
    # Note: powersave governor may legitimately reduce frequency when idle,
    # so only flag if combined with high temperatures
    if [ "$FREQ_RATIO" -lt 70 ] && [ "$GOVERNOR" = "performance" ]; then
        THROTTLE_DETECTED=1
        INDICATORS="${INDICATORS}low_freq(${FREQ_RATIO}%_in_performance_mode) "
    elif [ "$FREQ_RATIO" -lt 50 ] && [ "$MAX_TEMP" -gt 75 ]; then
        # Only flag very low frequency if temps are also elevated
        THROTTLE_DETECTED=1
        INDICATORS="${INDICATORS}thermal_throttle(${FREQ_RATIO}%_freq_at_${MAX_TEMP}C) "
    fi
fi
echo

# Check RAPL power limiting
echo "--- RAPL Power Limiting ---"
for rapl_domain in /sys/devices/virtual/powercap/intel-rapl/intel-rapl:*; do
    if [ -d "$rapl_domain" ]; then
        domain_name=$(cat "$rapl_domain/name" 2>/dev/null || echo "unknown")
        enabled=$(cat "$rapl_domain/enabled" 2>/dev/null || echo "0")

        if [ "$enabled" = "1" ]; then
            echo "  ${domain_name}: enabled"

            # Check if power limit is set (active limiting)
            for constraint in "$rapl_domain"/constraint_*_power_limit_uw; do
                if [ -f "$constraint" ]; then
                    limit_uw=$(cat "$constraint" 2>/dev/null || echo "0")
                    if [ "$limit_uw" -gt 0 ]; then
                        limit_w=$(awk "BEGIN {printf \"%.2f\", $limit_uw / 1000000}")
                        constraint_name=$(basename "$constraint" | sed 's/_power_limit_uw//')
                        echo "    ${constraint_name}: ${limit_w}W limit"
                    fi
                fi
            done
        fi
    fi
done
echo

# Summary
echo "=== Summary ==="
if [ "$THROTTLE_DETECTED" -eq 1 ]; then
    echo "Status: THROTTLING DETECTED"
    echo "Indicators: ${INDICATORS}"
    exit 1
else
    echo "Status: NORMAL - No throttling detected"
    echo "System is operating within thermal and frequency limits"
    exit 0
fi

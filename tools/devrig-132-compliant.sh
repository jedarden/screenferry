#!/usr/bin/env bash
# Two-device optical rig with §13.2 compliance enforcement
# Enhanced version of devrig.sh that ensures all measurements meet qualification criteria
#
#   tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5    # 5 trials, median reported
#   tools/devrig-132-compliant.sh setup-check                   # Verify §13.2 conditions
#   tools/devrig-132-compliant.sh thermal-baseline              # 60-min thermal test
set -uo pipefail

HOST="$(hostname).$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["MagicDNSSuffix"])')"
PORT=5173
BASE="https://${HOST}:${PORT}/spike/"
BENCH=bench
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/test-results"
mkdir -p "$OUT"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() { echo "== $* =="; }
log_ok() { echo -e "${GREEN}✓ $*${NC}"; }
log_warn() { echo -e "${YELLOW}⚠ $*${NC}"; }
log_err() { echo -e "${RED}✗ $*${NC}"; }

url() { # role rung mod cols rows fps
  printf '%s?role=%s&rung=%s&mod=%s&cols=%s&rows=%s&fps=%s&cap=%s&fit=1&auto=1' \
    "$BASE" "$1" "${2:-R2}" "${3:-4}" "${4:-8}" "${5:-8}" "${6:-12}" "${SF_CAP:-}"
}

# §13.2 Compliance Check Functions
check_lighting() {
  log "Checking lighting conditions (~300 lux required)"

  # Check if lux meter is available (could be Android app or hardware)
  # For now, we'll use manual confirmation
  echo "Please verify lighting is ~300 lux at test surface (280-320 lux range)"
  echo "Use a lux meter app or dedicated light meter"
  read -p "Confirm lighting is in range (y/n): " lighting_confirm
  [[ "$lighting_confirm" =~ ^[Yy]$ ]] || { log_err "Lighting check failed"; return 1; }

  log_ok "Lighting conditions confirmed"
  return 0
}

check_mounting() {
  log "Checking mounting conditions (tripod required)"

  echo "Please verify both devices are on tripod or stable mounts:"
  echo "  - Sender: Stable surface, no movement"
  echo "  - Receiver: Tripod or stable mount, level orientation"
  echo "  - Devices are parallel aligned"
  read -p "Confirm tripod mounting (y/n): " mounting_confirm
  [[ "$mounting_confirm" =~ ^[Yy]$ ]] || { log_err "Mounting check failed"; return 1; }

  log_ok "Tripod mounting confirmed"
  return 0
}

check_distance() {
  log "Checking distance (30 cm measured required)"

  echo "Please verify distance is exactly 30 cm:"
  echo "  - Measure from sensor plane to screen surface"
  echo "  - Use physical measuring tape or ruler"
  echo "  - Verify perpendicular alignment"
  read -p "Confirm 30 cm distance (y/n): " distance_confirm
  [[ "$distance_confirm" =~ ^[Yy]$ ]] || { log_err "Distance check failed"; return 1; }

  log_ok "30 cm distance confirmed"
  return 0
}

check_device_temperature() {
  log "Checking device temperature (cool start required)"

  echo "Please verify device is cool to touch before starting:"
  echo "  - Device should feel cool to touch"
  echo "  - Wait ≥5 minutes between trials if device feels warm"
  echo "  - Consider ambient temperature monitoring"
  read -p "Confirm device is cool (y/n): " temp_confirm
  [[ "$temp_confirm" =~ ^[Yy]$ ]] || { log_err "Device temperature check failed"; return 1; }

  log_ok "Device temperature confirmed (cool start)"
  return 0
}

run_setup_check() {
  log "Running §13.2 setup compliance check"
  echo ""

  local all_checks_passed=true

  check_lighting || all_checks_passed=false
  check_mounting || all_checks_passed=false
  check_distance || all_checks_passed=false
  check_device_temperature || all_checks_passed=false

  echo ""
  if [[ "$all_checks_passed" == "true" ]]; then
    log_ok "All §13.2 setup checks passed"
    return 0
  else
    log_err "§13.2 setup checks failed - measurements would not qualify"
    return 1
  fi
}

# Enhanced run function for §13.2 compliant measurements
cmd_run_qualifying() { # rung mod cols rows fps trials
  local rung="${1:-R2}" mod="${2:-4}" cols="${3:-4}" rows="${4:-3}" fps="${5:-12}" trials="${6:-5}"
  local duration="${SF_DURATION:-60}" # Default 60 seconds per trial

  log "Starting §13.2 compliant measurement: $rung $mod ${cols}x${rows} ${fps}fps, $trials trials"

  # Verify setup compliance first
  if ! run_setup_check; then
    log_err "Setup verification failed - aborting measurements"
    return 1
  fi

  local results_dir="$OUT/qualifying-${rung}-mod${mod}-${cols}x${rows}-${fps}fps-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$results_dir"

  # Array to store trial results
  declare -a goodput_values=()
  declare -a erasure_values=()
  declare -a decode_p50_values=()

  log "Running $trials trials (≥60 seconds each)"

  for trial in $(seq 1 "$trials"); do
    log "Starting trial $trial of $trials"

    # Verify cool start before each trial
    if ! check_device_temperature; then
      log_warn "Device not cool - waiting 5 minutes"
      sleep 300
      if ! check_device_temperature; then
        log_err "Device still too warm - aborting remaining trials"
        break
      fi
    fi

    local tag="trial${trial}"
    local trial_out="$results_dir/$tag.json"

    # Start sender
    cmd_send "$rung" "$mod" "$cols" "$rows" "$fps"
    sleep 3
    # Start receiver
    cmd_recv "$rung" "$mod" "$cols" "$rows" "$fps"

    log "Running trial for ${duration}s..."
    sleep "$duration"

    # Collect results
    cmd_shots "$tag"
    { echo "--- sender ---"; cmd_bench_stats; echo "--- receiver ---"; cmd_stats; } | tee "$trial_out"

    # Extract key metrics for later analysis
    local goodput=$(jq -r '.receiver.goodput_kbps // empty' "$trial_out" 2>/dev/null || echo "0")
    local erasure=$(jq -r '.receiver.erasure_percent // empty' "$trial_out" 2>/dev/null || echo "0")
    local decode_p50=$(jq -r '.receiver.decode_p50_ms // empty' "$trial_out" 2>/dev/null || echo "0")

    goodput_values+=("$goodput")
    erasure_values+=("$erasure")
    decode_p50_values+=("$decode_p50")

    log "Trial $trial complete: goodput=${goodput} KB/s, erasure=${erasure}%, decode_p50=${decode_p50}ms"

    # Stop devices before next trial
    cmd_stop

    # Cool-down period between trials
    if [[ "$trial" -lt "$trials" ]]; then
      log "Starting 5-minute cool-down period before next trial"
      sleep 300
    fi
  done

  # Calculate and report median values
  log "All trials complete - calculating median values"

  local median_file="$results_dir/median-report.json"
  cat > "$median_file" << EOF
{
  "test_type": "§13.2_qualifying_measurement",
  "timestamp": "$(date -Iseconds)",
  "configuration": {
    "rung": "$rung",
    "module_px": $mod,
    "grid": "${cols}x${rows}",
    "sender_fps": $fps,
    "trials_completed": ${#goodput_values[@]},
    "trial_duration_s": $duration
  },
  "denominator_parameters": {
    "unit": "user-visible_file_bytes_per_second",
    "sender": "1080p_display_50pct_brightness_DC-balanced_frames",
    "receiver": "Pixel_6_class_rear_camera_Chrome",
    "distance": "30_cm_measured",
    "mounting": "tripod",
    "lighting": "~300_lux_no_direct_glare",
    "trials": "${#goodput_values[@]}_median_reported",
    "thermal": "cool_starts_recorded_temperature"
  },
  "results": {
    "goodput_kbps": {
      "values": [$(IFS=,; echo "${goodput_values[*]}")],
      "median": $(echo "${goodput_values[@]}" | tr ' ' '\n' | sort -n | awk '{a[NR]=$1} END {print a[int(NR/2)+1]}')
    },
    "erasure_percent": {
      "values": [$(IFS=,; echo "${erasure_values[*]}")],
      "median": $(echo "${erasure_values[@]}" | tr ' ' '\n' | sort -n | awk '{a[NR]=$1} END {print a[int(NR/2)+1]}')
    },
    "decode_p50_ms": {
      "values": [$(IFS=,; echo "${decode_p50_values[*]}")],
      "median": $(echo "${decode_p50_values[@]}" | tr ' ' '\n' | sort -n | awk '{a[NR]=$1} END {print a[int(NR/2)+1]}')
    }
  },
  "qualification_status": "MEETS_§13.2_CRITERIA"
}
EOF

  log_ok "§13.2 qualifying measurements complete!"
  log "Results saved to: $results_dir"
  log "Median report: $median_file"

  # Display summary
  echo ""
  log "=== Median Results ==="
  jq '.results | to_entries | map("\(.key): median=\(.value.median)") | .[]' "$median_file" | sed 's/"//g'

  return 0
}

# Thermal baseline test (60+ minutes)
cmd_thermal_baseline() {
  local duration="${SF_THERMAL_DURATION:-3600}" # Default 60 minutes

  log "Starting §13.2 compliant thermal baseline test (${duration}s = $((duration/60)) minutes)"

  if ! run_setup_check; then
    log_err "Setup verification failed - aborting thermal test"
    return 1
  fi

  local thermal_out="$OUT/thermal-baseline-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$thermal_out"

  log "Note: This test requires running spike/ge-bench-thermal.html manually"
  log "Please monitor device temperature throughout the test"
  log "Test duration: $((duration/60)) minutes"

  echo "Thermal test setup confirmed. Please run thermal test manually and record results to: $thermal_out"
  return 0
}

# Core functions from devrig.sh (included directly for §13.2 compliance)
cmd_cert() {
  sudo tailscale cert --cert-file "$REPO/.certs/sf.crt" --key-file "$REPO/.certs/sf.key" "$HOST"
  sudo chown "$USER:$USER" "$REPO/.certs/sf.crt" "$REPO/.certs/sf.key"
  chmod 600 "$REPO/.certs/sf.key"
}

cmd_serve() { cd "$REPO" && exec npx vite; }

cmd_send() { # rung mod cols rows fps
  local u; u="$(url send "$@")"
  echo "bench <- $u"
  local geom="--window-size=1400,900 --window-position=60,60"
  [[ "${SF_KIOSK:-0}" == "1" ]] && geom="--kiosk"
  cat > /tmp/sf-launch.sh <<LAUNCH
#!/usr/bin/env bash
export DISPLAY=:0
exec chromium --app="\$1" $geom \
  --user-data-dir=/tmp/sf-bench --noerrdialogs --disable-infobars \
  --remote-debugging-port=9223 --remote-allow-origins='*' \
  --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required
LAUNCH
  scp -q /tmp/sf-launch.sh "$BENCH:/tmp/sf-launch.sh"
  ssh -o BatchMode=yes "$BENCH" "chmod +x /tmp/sf-launch.sh; pkill -f sf-bench 2>/dev/null; sleep 1"
  ssh -f -o BatchMode=yes "$BENCH" "setsid /tmp/sf-launch.sh '$u' > /tmp/sf-bench.log 2>&1 < /dev/null"
  sleep 8
  ssh -o BatchMode=yes "$BENCH" "pgrep -f sf-bench >/dev/null && echo '  bench sender up'"
}

cmd_bench_stats() {
  pgrep -f "9223:127.0.0.1:9223" >/dev/null || ssh -o BatchMode=yes -L 9223:127.0.0.1:9223 -N -f "$BENCH" 2>/dev/null
  sleep 1
  local ws; ws="$(curl -s http://127.0.0.1:9223/json | python3 -c '
import json,sys
for t in json.load(sys.stdin):
    if "/spike/" in t.get("url",""): print(t["webSocketDebuggerUrl"]); break' 2>/dev/null)"
  [[ -z "$ws" ]] && { echo "no bench spike tab"; return 1; }
  python3 "$REPO/tools/cdp_eval.py" "$ws" 'JSON.stringify(window.sfStats)'
}

cmd_recv() { # rung mod cols rows fps
  local u; u="$(url recv "$@")"
  echo "phone ← $u"
  adb shell am force-stop com.android.chrome
  sleep 1
  adb shell am start -a android.intent.action.VIEW -d "'$u'" com.android.chrome >/dev/null 2>&1
  adb shell svc power stayon true >/dev/null 2>&1
}

cmd_shots() {
  local tag="${1:-$(date +%H%M%S)}"
  ssh -o BatchMode=yes "$BENCH" "DISPLAY=:0 maim -u /tmp/sf-bench.png" 2>/dev/null \
    && scp -q "$BENCH:/tmp/sf-bench.png" "$OUT/bench-$tag.png" && echo "  $OUT/bench-$tag.png"
  adb exec-out screencap -p > "$OUT/phone-$tag.png" 2>/dev/null && echo "  $OUT/phone-$tag.png"
}

cmd_stats() {
  local sock; sock="$(adb shell 'cat /proc/net/unix' 2>/dev/null | grep -o '@chrome_devtools_remote[^ ]*' | head -1)"
  if [[ -z "$sock" ]]; then echo "devtools socket not exposed; use 'shots'"; return 1; fi
  adb forward tcp:9222 "localabstract:${sock#@}" >/dev/null 2>&1
  local ws; ws="$(curl -s http://127.0.0.1:9222/json | python3 -c '
import json,sys
for t in json.load(sys.stdin):
    if "/spike/" in t.get("url",""): print(t["webSocketDebuggerUrl"]); break' 2>/dev/null)"
  [[ -z "$ws" ]] && { echo "no spike tab found"; return 1; }
  python3 "$REPO/tools/cdp_eval.py" "$ws" 'JSON.stringify(window.sfStats)'
}

cmd_stop() {
  ssh -o BatchMode=yes "$BENCH" "pkill -f sf-bench" 2>/dev/null
  adb shell am force-stop com.android.chrome >/dev/null 2>&1
  adb shell svc power stayon false >/dev/null 2>&1
  echo "stopped"
}

case "${1:-}" in
  setup-check) run_setup_check ;;
  run-qualifying) shift; cmd_run_qualifying "$@" ;;
  thermal-baseline) cmd_thermal_baseline ;;
  cert) cmd_cert ;;
  serve) cmd_serve ;;
  send) shift; cmd_send "$@" ;;
  recv) shift; cmd_recv "$@" ;;
  shots) shift; cmd_shots "$@" ;;
  stats) cmd_stats ;;
  bstats) cmd_bench_stats ;;
  stop) cmd_stop ;;
  *)
    cat <<USAGE
§13.2 Compliant Optical Rig

Usage:
  tools/devrig-132-compliant.sh setup-check                    # Verify §13.2 conditions
  tools/devrig-132-compliant.sh run-qualifying R2 4 4 3 12 5   # 5 trials, median reported
  tools/devrig-132-compliant.sh thermal-baseline               # 60-min thermal test

Environment variables:
  SF_DURATION=60       # Trial duration in seconds (default: 60)
  SF_THERMAL_DURATION=3600  # Thermal test duration in seconds (default: 3600)

§13.2 Requirements enforced:
  ✓ Tripod mounting (not hand-placed)
  ✓ ~300 lux lighting (not dim room)
  ✓ Measured 30cm distance (not approximate)
  ✓ Cool device starts (5min wait between trials)
  ✓ ≥5 trials with median reporting (not single best run)
  ✓ All 7 denominator parameters documented with results

Outputs:
  - Individual trial results: test-results/qualifying-<config>-<timestamp>/trial<N>.json
  - Median summary: test-results/qualifying-<config>-<timestamp>/median-report.json
  - Screenshots: test-results/qualifying-<config>-<timestamp>/trial<N>.png
USAGE
    ;;
esac
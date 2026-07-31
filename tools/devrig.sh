#!/usr/bin/env bash
# Two-device optical rig — Phase 0.5 S2/S3/S4, driven with no human in the loop
# except for physically aiming the phone at the bench screen.
#
#   bench (Lenovo T450s, X on :0, 1920x1080)  →  SENDER, chromium kiosk
#   Pixel 6 over ADB                           →  RECEIVER, Chrome
#   this host                                  →  vite HTTPS server + orchestration
#
# HTTPS is mandatory: getUserMedia needs a secure context, so the phone must load
# the receiver over a real cert. `tailscale cert` issues one for this host's tailnet
# name, which means no interstitial to tap through — important when driving via ADB.
#
#   tools/devrig.sh serve      # start the dev server (foreground)
#   tools/devrig.sh cert       # (re)issue the TLS cert
#   tools/devrig.sh send R2 4 4 3 12
#   tools/devrig.sh recv R2 4 4 3 12
#   tools/devrig.sh run  R2 4 4 3 12 45     # both ends, wait N s, collect
#   tools/devrig.sh shots                   # screenshot both screens
#   tools/devrig.sh stop
set -uo pipefail

HOST="$(hostname).$(tailscale status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["MagicDNSSuffix"])')"
PORT=5173
BASE="https://${HOST}:${PORT}/spike/"
BENCH=bench
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/test-results"
mkdir -p "$OUT"

url() { # role rung mod cols rows fps
  # fit=1 hides the page chrome so the sender uses the whole screen; the page then
  # clamps the grid to what actually fits and renders the canvas 1:1.
  printf '%s?role=%s&rung=%s&mod=%s&cols=%s&rows=%s&fps=%s&cap=%s&fit=1&auto=1' \
    "$BASE" "$1" "${2:-R2}" "${3:-4}" "${4:-8}" "${5:-8}" "${6:-12}" "${SF_CAP:-}"
}

cmd_cert() {
  sudo tailscale cert --cert-file "$REPO/.certs/sf.crt" --key-file "$REPO/.certs/sf.key" "$HOST"
  sudo chown "$USER:$USER" "$REPO/.certs/sf.crt" "$REPO/.certs/sf.key"
  chmod 600 "$REPO/.certs/sf.key"
}

cmd_serve() { cd "$REPO" && exec npx vite; }

cmd_send() { # rung mod cols rows fps
  local u; u="$(url send "$@")"
  echo "bench <- $u"
  # WINDOW mode by default. The bench runs a live desktop session, so full-screen is
  # opt-in via SF_KIOSK=1 -- an optical test is not worth hijacking someone's screen.
  # A launcher script + `ssh -f` + setsid is what actually survives the ssh channel
  # closing; `nohup ... & disown` inline does not (disown is a no-op without job
  # control, and the child takes the SIGHUP).
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

# Read window.sfStats off the BENCH sender over CDP (port-forwarded from :9223).
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
  # keep the screen on for the length of a run
  adb shell svc power stayon true >/dev/null 2>&1
}

cmd_shots() {
  local tag="${1:-$(date +%H%M%S)}"
  ssh -o BatchMode=yes "$BENCH" "DISPLAY=:0 maim -u /tmp/sf-bench.png" 2>/dev/null \
    && scp -q "$BENCH:/tmp/sf-bench.png" "$OUT/bench-$tag.png" && echo "  $OUT/bench-$tag.png"
  adb exec-out screencap -p > "$OUT/phone-$tag.png" 2>/dev/null && echo "  $OUT/phone-$tag.png"
}

# Scrape window.sfStats from the phone via Chrome's DevTools protocol over ADB.
# Falls back to a screenshot if the socket is unavailable.
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

cmd_run() { # rung mod cols rows fps seconds
  local rung="${1:-R2}" mod="${2:-4}" cols="${3:-4}" rows="${4:-3}" fps="${5:-12}" secs="${6:-45}"
  local tag="${rung}-mod${mod}-${cols}x${rows}-${fps}fps"
  echo "== $tag for ${secs}s =="
  cmd_send "$rung" "$mod" "$cols" "$rows" "$fps"
  sleep 3
  cmd_recv "$rung" "$mod" "$cols" "$rows" "$fps"
  echo "  settling…"; sleep "$secs"
  cmd_shots "$tag"
  { echo "--- sender ---"; cmd_bench_stats; echo "--- receiver ---"; cmd_stats; } | tee "$OUT/$tag.json"
}

cmd_stop() {
  ssh -o BatchMode=yes "$BENCH" "pkill -f sf-bench" 2>/dev/null
  adb shell am force-stop com.android.chrome >/dev/null 2>&1
  adb shell svc power stayon false >/dev/null 2>&1
  echo "stopped"
}

case "${1:-}" in
  cert) cmd_cert ;;
  serve) cmd_serve ;;
  send) shift; cmd_send "$@" ;;
  recv) shift; cmd_recv "$@" ;;
  run) shift; cmd_run "$@" ;;
  shots) shift; cmd_shots "$@" ;;
  stats) cmd_stats ;;
  bstats) cmd_bench_stats ;;
  stop) cmd_stop ;;
  *) sed -n '2,20p' "$0" ;;
esac

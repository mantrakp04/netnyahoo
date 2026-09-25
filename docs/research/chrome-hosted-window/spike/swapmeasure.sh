#!/bin/bash
# Measures the profile swap of a Chrome-hosted window frame by frame (docs/research/chrome-hosted-
# window.md › Profiles). Needs an unlocked screen and Screen Recording permission for the terminal;
# the instance stays hidden (never frontmost).
#
# usage: SPIKE_DIR=<scratch> swapmeasure.sh <app> <port> [strategy] [swaps] [pages origin]
#   strategy: transparent (the default in the app) | snapshot | naive  (NETNYAHOO_PROFILE_SWAP),
#             or ghost: the same switches without NETNYAHOO_CHROME_WINDOW, as a baseline.
#   swaps: how many profile switches to record (default 10), alternating between two profiles.
# Each switch is a store switch (no pager animation), so a clean one goes from the first profile's
# window straight to the second's; swapscan.py flags anything in between. Serve spike/pages at
# <pages origin> (default http://localhost:8795) first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SP="${SPIKE_DIR:?set SPIKE_DIR}"
app="$1"; port="$2"; strategy="${3:-transparent}"; swaps="${4:-10}"; pages="${5:-http://localhost:8795}"
name="swap$port"
rm -rf "$SP/$name" "$SP/$name-frames"
[ -x "$SP/swapcap" ] || swiftc -O "$here/swapcap.swift" -o "$SP/swapcap"
[ -x "$SP/windows" ] || swiftc -O "$here/../../../../.claude/skills/release/scripts/windows.swift" -o "$SP/windows"

flags=(--env NETNYAHOO_CHROME_WINDOW=1 --env NETNYAHOO_PROFILE_SWAP="$strategy")
[ "$strategy" = ghost ] && flags=()
APP="$app" SPIKE_DIR="$SP" "$here/launch.sh" "$name" "$port" "${flags[@]}" >/dev/null
pid="$(cat "$SP/$name.pid")"
dev() { SPIKE_DIR="$SP" "$here/dev.sh" "$name" "$1" >/dev/null; }
dev 'const s = nn.store.getState(); s.createProfile({ name: "Work", color: "blue" }); nn.actions.openUrls(["'"$pages"'/page.html"]); return 1'
sleep 3
dev 'const s = nn.store.getState(); const w = Object.keys(s.windows)[0]; s.switchProfile(w, s.profileOrder[1]); return 1'
sleep 2
dev 'nn.actions.openUrls(["'"$pages"'/find.html"]); return 1'
sleep 3
dev 'const s = nn.store.getState(); const w = Object.keys(s.windows)[0]; s.switchProfile(w, "default"); return 1'
sleep 2
read -r X Y Wd Ht < <("$SP/windows" "$pid" | python3 -c '
import sys, json
w = [json.loads(l) for l in sys.stdin]
w = [x for x in w if x["alpha"] > 0 and x["w"] >= 600][0]
print(w["x"], w["y"], w["w"], w["h"])')

transients=0
for i in $(seq 1 "$swaps"); do
  out="$SP/$name-frames/$i"
  "$SP/swapcap" "$pid" 1.5 "$out" "$X" "$Y" "$Wd" "$Ht" 120 > "$SP/$name-capture.log" 2>&1 &
  cap=$!
  sleep 0.5
  dev 'const s = nn.store.getState(); const w = Object.keys(s.windows)[0]; s.switchProfile(w, s.windows[w].profileId === "default" ? s.profileOrder[1] : "default"); return 1'
  if ! wait $cap; then
    echo "capture failed: $(tail -1 "$SP/$name-capture.log") (a locked screen, or no Screen Recording permission for this terminal)"
    kill -TERM "$pid" 2>/dev/null || true
    exit 2
  fi
  if ! python3 "$here/swapscan.py" "$out" > "$out/scan.txt"; then
    transients=$((transients + $(grep -c '^TRANSIENT' "$out/scan.txt")))
    echo "swap $i: $(tail -1 "$out/scan.txt")"
  fi
done
kill -TERM "$pid" 2>/dev/null || true
echo "strategy $strategy: $transients transient frame(s) in $swaps swaps (frames in $SP/$name-frames)"
[ "$transients" -eq 0 ]

#!/bin/bash
# Measures a Chrome-hosted window swap frame by frame (docs/research/chrome-hosted-window.md ›
# phase 3 "Profiles: hosted per-profile windows"). Needs an unlocked screen and Screen Recording
# permission for the terminal; the instance stays hidden (never frontmost).
# usage: SPIKE_DIR=<scratch> swapmeasure.sh <app> <port> [swapProbe ms, default 800] [pages origin]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SP="${SPIKE_DIR:?set SPIKE_DIR}"
app="$1"; port="$2"; ms="${3:-800}"; pages="${4:-http://localhost:8795}"
name="swap$port"
out="$SP/$name-frames"
rm -rf "$SP/$name" "$out"
[ -x "$SP/swapcap" ] || swiftc -O "$here/swapcap.swift" -o "$SP/swapcap"
[ -x "$SP/windows" ] || swiftc -O "$here/../../../../.claude/skills/release/scripts/windows.swift" -o "$SP/windows"

APP="$app" SPIKE_DIR="$SP" "$here/launch.sh" "$name" "$port" --env NETNYAHOO_CHROME_WINDOW=1 >/dev/null
pid="$(cat "$SP/$name.pid")"
dev() { printf '// m%s\n%s\n' "$RANDOM$RANDOM" "$1" > "$SP/$name/dev-eval.js"; sleep 1.5; }
dev "nn.actions.openUrls([\"$pages/page.html\"]); return 1"
sleep 3
read -r W X Y Wd Ht < <("$SP/windows" "$pid" | python3 -c '
import sys, json
w = [json.loads(l) for l in sys.stdin]
w = [x for x in w if x["alpha"] > 0 and x["w"] >= 600][0]
print(w["id"], w["x"], w["y"], w["w"], w["h"])')

# Record 3 s; swap at 1 s, swap back <ms> later.
"$SP/swapcap" "$pid" 3 "$out" "$X" "$Y" "$Wd" "$Ht" 120 &
cap=$!
sleep 1
dev "return globalThis.expo.modules.NetnyahooCEF.devWindow($W, 'swapProbe:$ms')"
wait $cap
kill -TERM "$pid" 2>/dev/null || true
python3 "$here/swapscan.py" "$out"

#!/bin/bash
# Captures every scene from a fresh hidden DEV instance and composites it into public/footage.
# usage: scripts/capture/run-all.sh <Debug Arcadia.app> <scratch dir> [scene…]
set -euo pipefail
APP=$1; SCRATCH=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd); VIDEOS=$(cd "$HERE/../.." && pwd); REPO=$(cd "$VIDEOS/../.." && pwd)
SCENES=${*:-warm asks swipe tabs split block store windows typing}
DATA=$SCRATCH/film
# The stand-in sites (sites/): served here, and *.example mapped to it in the instance.
SITES_PORT=47231
curl -fs -o /dev/null -H "Host: lexicon.example" "http://127.0.0.1:$SITES_PORT/" || { node "$HERE/sites/serve.mjs" $SITES_PORT >/dev/null 2>&1 & sleep 1; }
if [ ! -f "$DATA/instance.json" ] || ! "$REPO/scripts/agent/ac" status "$DATA" >/dev/null 2>&1; then
  rm -rf "$DATA"; mkdir -p "$SCRATCH/import-empty"
  node "$HERE/session.mjs" "$SCRATCH/session.json"
  "$REPO/scripts/agent/ac" launch "$APP" --data "$DATA" --onboarded --session "$SCRATCH/session.json" \
    --env ARCADIA_TRAFFIC_LIGHTS_LOG="$SCRATCH/lights.log" --env ARCADIA_IMPORT_SOURCE_DIR="$SCRATCH/import-empty" \
    --env ARCADIA_IMPORT_SAFARI_HOME="$SCRATCH/import-empty" \
    --switch "--host-resolver-rules=MAP *.example 127.0.0.1:$SITES_PORT"
  sleep 5
fi
for s in $SCENES; do
  node "$HERE/cap.mjs" "$DATA" "$s"
  [ "$s" = warm ] || python3 "$HERE/composite.py" "$s"
done
python3 "$HERE/icons.py"

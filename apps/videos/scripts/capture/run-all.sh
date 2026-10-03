#!/bin/bash
# Captures every scene from a fresh hidden DEV instance and composites it into public/footage.
# usage: scripts/capture/run-all.sh <Debug Netnyahoo.app> <scratch dir> [scene…]
set -euo pipefail
APP=$1; SCRATCH=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd); VIDEOS=$(cd "$HERE/../.." && pwd); REPO=$(cd "$VIDEOS/../.." && pwd)
SCENES=${*:-warm swipe tabs split block store windows typing}
DATA=$SCRATCH/film
if [ ! -f "$DATA/instance.json" ] || ! "$REPO/scripts/agent/nn" status "$DATA" >/dev/null 2>&1; then
  rm -rf "$DATA"; mkdir -p "$SCRATCH/import-empty"
  node "$HERE/session.mjs" "$SCRATCH/session.json"
  "$REPO/scripts/agent/nn" launch "$APP" --data "$DATA" --onboarded --session "$SCRATCH/session.json" \
    --env NETNYAHOO_TRAFFIC_LIGHTS_LOG="$SCRATCH/lights.log" --env NETNYAHOO_IMPORT_SOURCE_DIR="$SCRATCH/import-empty" \
    --env NETNYAHOO_IMPORT_SAFARI_HOME="$SCRATCH/import-empty"
  sleep 5
fi
for s in $SCENES; do
  node "$HERE/cap.mjs" "$DATA" "$s"
  [ "$s" = warm ] || python3 "$HERE/composite.py" "$s"
done

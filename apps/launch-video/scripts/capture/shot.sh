#!/bin/bash
# usage: CAPTURE_DIR=… shot.sh <instance> <harness name> — runs harness/<name>.js (after common.js) into steps2/<name>/
set -e
P=$(cd "$(dirname "$0")" && pwd)
rm -rf "$CAPTURE_DIR/steps2/$2"; mkdir -p "$CAPTURE_DIR/steps2/$2"
cat "$P/harness/common.js" "$P/harness/$2.js" > "$CAPTURE_DIR/steps2/$2.run.js"
node "$P/dev.mjs" "$1" "$CAPTURE_DIR/steps2/$2.run.js" 120 > "$CAPTURE_DIR/steps2/$2.json"

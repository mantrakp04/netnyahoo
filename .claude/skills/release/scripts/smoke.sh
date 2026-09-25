#!/usr/bin/env bash
# Smoke test of dist/<version>/export/Netnyahoo.app before publishing it.
# usage: smoke.sh <version> <previous-version>
#
# Launches the exported app hidden (NETNYAHOO_BACKGROUND=1: no Dock icon, never takes focus) with a
# throwaway data dir that says <previous-version> ran last, so the after-update release-notes tab
# opens (NETNYAHOO_RELEASE_NOTES=1), runs smoke.mjs over CDP, quits it and checks the bundle is still
# sealed. Never touches /Applications or the user's own data.
set -euo pipefail

version="${1:?usage: smoke.sh <version> <previous-version>}"
previous="${2:?usage: smoke.sh <version> <previous-version>}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
here="$(cd "$(dirname "$0")" && pwd)"
app="$root/dist/$version/export/Netnyahoo.app"
port="${SMOKE_CDP_PORT:-9398}"
pages_port="${SMOKE_PAGES_PORT:-8798}"
[ -d "$app" ] || { echo "error: no $app (run scripts/release.sh $version first)" >&2; exit 1; }

work="$(mktemp -d "${TMPDIR:-/tmp}/nn-smoke.XXXXXX")"
server=""
cleanup() {
  [ -n "${pid:-}" ] && kill -KILL "$pid" 2>/dev/null || true
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

swiftc -O "$here/windows.swift" -o "$work/windows" 2>/dev/null
python3 -m http.server "$pages_port" --bind 127.0.0.1 --directory "$here/pages" >/dev/null 2>&1 &
server=$!

mkdir -p "$work/data"
printf '{"version":1,"lastVersion":"%s","pending":null}' "$previous" > "$work/data/release-notes.json"

codesign --verify --deep --strict "$app"
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR="$work/data" \
  --env NETNYAHOO_REMOTE_DEBUGGING_PORT="$port" --env NETNYAHOO_RELEASE_NOTES=1 \
  --env NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows "$app"
for _ in $(seq 1 60); do curl -fs "localhost:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
sleep 8  # session restore, then the release-notes tab
pid="$(pgrep -f "^$app/Contents/MacOS/Netnyahoo" | head -1)"
[ -n "$pid" ] || { echo "error: the app didn't start" >&2; exit 1; }

status=0
node "$here/smoke.mjs" "$port" "$version" "$work/windows" "$pid" "http://localhost:$pages_port" || status=1

kill -TERM "$pid" 2>/dev/null || true
for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
kill -KILL "$pid" 2>/dev/null || true
pid=""
codesign --verify --deep --strict "$app" && echo "PASS  bundle still sealed after running" || { echo "FAIL  running the app changed its bundle"; status=1; }
exit $status

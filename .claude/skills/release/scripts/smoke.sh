#!/usr/bin/env bash
# Smoke test of dist/<version>/export/Netnyahoo.app before publishing it.
# usage: smoke.sh <version> <previous-version>
# SMOKE_APP=<path to Netnyahoo.app> tests that build instead of the exported one (an engine change
# before it ships, say); the version arguments still drive the release-notes check.
#
# Launches the exported app hidden (NETNYAHOO_BACKGROUND=1: no Dock icon, never takes focus) with a
# throwaway data dir that says <previous-version> ran last, so the after-update release-notes tab
# opens (NETNYAHOO_RELEASE_NOTES=1), and whose session has a window left on its second profile (each
# profile a Chrome window of its own: the window restores as the Work profile's, Personal's made
# ahead off screen). Runs smoke.mjs over CDP, quits the app and checks the bundle is still sealed.
# Never touches /Applications or the user's own data.
set -euo pipefail

version="${1:?usage: smoke.sh <version> <previous-version>}"
previous="${2:?usage: smoke.sh <version> <previous-version>}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
here="$(cd "$(dirname "$0")" && pwd)"
app="${SMOKE_APP:-$root/dist/$version/export/Netnyahoo.app}"
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
pages="http://localhost:$pages_port"
tab() { # id profile url
  printf '{"id":"%s","windowId":"w-smoke","profileId":"%s","url":"%s","title":"","favicon":null,"pinned":false,"muted":false,"zoom":1,"customTitle":null,"customIcon":null,"pinnedUrl":null,"openerId":null,"createdAt":1,"lastActiveAt":1}' "$1" "$2" "$3"
}
cat > "$work/data/session.json" <<JSON
{"version":2,
 "profiles":{"default":{"id":"default","name":"Personal","color":"plum","icon":null,"createdAt":0},
             "p-work":{"id":"p-work","name":"Work","color":"blue","icon":null,"createdAt":1}},
 "profileOrder":["default","p-work"],
 "windows":[{"id":"w-smoke","profileId":"p-work","incognito":false,"tabIds":["t-home","t-work"],
             "activeTabIds":{"default":"t-home","p-work":"t-work"},"sidebarOpen":true,"frame":[80,80,1280,800],"createdAt":1}],
 "windowOrder":["w-smoke"],"focusedWindowId":"w-smoke",
 "tabs":[$(tab t-home default "$pages/form.html?home"),$(tab t-work p-work "$pages/form.html?work")],
 "groups":[],"splits":[],"closedTabs":[],"closedWindows":[],"closedGroups":[],"cleanedTabs":[]}
JSON

codesign --verify --deep --strict "$app"
before="$(pgrep -f "^$app/Contents/MacOS/Netnyahoo" | sort || true)"
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR="$work/data" \
  --env NETNYAHOO_REMOTE_DEBUGGING_PORT="$port" --env NETNYAHOO_RELEASE_NOTES=1 \
  --env NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows "$app"
for _ in $(seq 1 60); do curl -fs "localhost:$port/json/version" >/dev/null 2>&1 && break; sleep 1; done
sleep 8  # session restore, then the release-notes tab
# The instance this launched (another of the same build may be running).
pid="$(comm -13 <(echo "$before") <(pgrep -f "^$app/Contents/MacOS/Netnyahoo" | sort || true) | head -1)"
[ -n "$pid" ] || { echo "error: the app didn't start" >&2; exit 1; }

status=0
locked="$("$work/windows" --locked)"
[ "$locked" = 1 ] && echo "note: the screen is locked; checks of window order and closing are skipped (they need an unlocked screen)"
SMOKE_LOCKED="$locked" node "$here/smoke.mjs" "$port" "$version" "$work/windows" "$pid" "$pages" || status=1

kill -TERM "$pid" 2>/dev/null || true
for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
kill -KILL "$pid" 2>/dev/null || true
pid=""
codesign --verify --deep --strict "$app" && echo "PASS  bundle still sealed after running" || { echo "FAIL  running the app changed its bundle"; status=1; }
exit $status

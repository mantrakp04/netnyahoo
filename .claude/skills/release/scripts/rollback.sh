#!/usr/bin/env bash
# Going back after an update keeps the user's data: <previous> -> <new> -> <previous> on the same folder.
# usage: rollback.sh <previous Netnyahoo.app> <new Netnyahoo.app>
#
# The test copies and fake home of carryover.sh (bundle id com.netnyahoo.browser.rollback, signed ad hoc). The previous
# build makes two profiles' data where an installed copy keeps it; the new build, started without NETNYAHOO_DATA_DIR,
# reads it and adds a second session (carryover.mjs "use"); then the previous build opens the folder again and must
# show everything from both sessions, without crashing or resetting the profile. Prints Chrome's version and session
# bookkeeping after each build (Local State, each profile's Preferences, its Sessions files, the app's documents) and
# any crash report. Session cookies the previous build drops at its own launch are INFO, not FAIL (0.2.21 drops them
# at every launch). Never touches /Applications, the real app's data or the login keychain.
set -euo pipefail
unset NETNYAHOO_DATA_DIR NETNYAHOO_UPDATE_FEED_URL

old="${1:?usage: rollback.sh <previous app> <new app>}"
new="${2:?usage: rollback.sh <previous app> <new app>}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
test_id="com.netnyahoo.browser.rollback"
cdp="${ROLLBACK_CDP_PORT:-9391}"
pages_port="${ROLLBACK_PAGES_PORT:-8793}"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/nn-rollback.XXXXXX")" && pwd -P)"
server=""
cleanup() {
  pkill -KILL -f "^$work/" 2>/dev/null || true  # only this run's test copies
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  defaults delete "$test_id" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/Preferences/$test_id.plist"
  rm -rf "$work"
}
trap cleanup EXIT

copy() { # app dest: a test copy
  ditto "$1" "$2"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $test_id" "$2/Contents/Info.plist"
  codesign --force --deep --sign - "$2" 2>/dev/null
}
copy "$old" "$work/old/Netnyahoo.app"
copy "$new" "$work/new/Netnyahoo.app"
swiftc -O "$here/quit.swift" -o "$work/quit" 2>/dev/null
mkdir -p "$work/home" "$work/pages"
for page in page1 page2 page3 work; do
  printf '<!doctype html><title>Rollback %s</title><h1>%s</h1>\n' "$page" "$page" > "$work/pages/$page.html"
done
cp -R "$root/spikes/nncore-host/fixtures/ext" "$work/extension"
for p in "$cdp" "$pages_port"; do
  nc -z -G 2 127.0.0.1 "$p" 2>/dev/null && { echo "error: port $p is taken (ROLLBACK_CDP_PORT, ROLLBACK_PAGES_PORT)" >&2; exit 1; }
done
python3 -m http.server "$pages_port" --bind 127.0.0.1 --directory "$work/pages" >/dev/null 2>&1 &
server=$!
sleep 1
origin="http://127.0.0.1:$pages_port"
data="$work/home/Library/Application Support/$test_id"
export CARRYOVER_QUIT="$work/quit"
state() { # Chrome's version and session bookkeeping, and the app's documents
  python3 - "$1" "$data" <<'PY'
import json, os, sys
who, data = sys.argv[1], sys.argv[2]
d = os.path.join(data, "Chromium")
ls = json.load(open(os.path.join(d, "Local State")))
last = open(os.path.join(d, "Last Version")).read().strip() if os.path.exists(os.path.join(d, "Last Version")) else "-"
print(f"      after {who}: Local State last_used {ls.get('profile', {}).get('last_used')}, profiles {sorted(ls.get('profile', {}).get('info_cache', {}))}, Last Version {last}")
for p in sorted(x for x in os.listdir(d) if x == "Default" or x.startswith("Profile ")):
    pr = json.load(open(os.path.join(d, p, "Preferences")))
    sessions = os.path.join(d, p, "Sessions")
    print(f"      {p}: exit_type {pr.get('profile', {}).get('exit_type')}, extensions.last_chrome_version "
          f"{pr.get('extensions', {}).get('last_chrome_version')}, Sessions {len(os.listdir(sessions)) if os.path.isdir(sessions) else 0} files")
print("      documents:", " ".join(sorted(f for f in os.listdir(data) if f.endswith(".json") and not f.startswith("dev-"))))
PY
}
touch "$work/start"
status=0
timeout 300 node "$here/carryover.mjs" create "$work/old/Netnyahoo.app" "$work/home" "$cdp" "$origin" "$work/extension" "$work/created.json"
state "the previous build"
timeout 300 node "$here/carryover.mjs" read "$work/new/Netnyahoo.app" "$work/home" "$cdp" "$origin" "$work/created.json" "$work/read.json" \
  > "$work/read.log" || { grep -v '^PASS' "$work/read.log"; status=1; }
timeout 300 node "$here/carryover.mjs" use "$work/new/Netnyahoo.app" "$work/home" "$cdp" "$origin" - "$work/used.json" || status=1
state "the new build"
timeout 300 node "$here/carryover.mjs" back "$work/old/Netnyahoo.app" "$work/home" "$cdp" "$origin" "$work/used.json" "$work/back.json" \
  | sed 's/carried over:/kept going back:/' || status=1
state "the previous build again"
reports="$(find ~/Library/Logs/DiagnosticReports -maxdepth 1 -newer "$work/start" -name '*.ips' -exec grep -l "$test_id" {} + 2>/dev/null || true)"
if [ -z "$reports" ]; then echo "PASS  no crash report from either build"; else echo "FAIL  crash reports: $reports"; status=1; fi
exit $status

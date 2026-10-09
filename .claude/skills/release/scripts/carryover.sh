#!/usr/bin/env bash
# An update keeps the user's data: <previous>'s data, in the folder an installed copy uses, opens in the new build.
# usage: carryover.sh <previous Arcadia.app> <new Arcadia.app>
#
# Both builds run as test copies (bundle id com.arcadia.browser.carryover, signed ad hoc: the mock keychain, and
# their defaults are that id's, never the real app's) in a fake home (HOME and CFFIXED_USER_HOME). The previous build
# makes two profiles' worth of data where an installed copy keeps it (ARCADIA_DATA_DIR set to that folder); the new
# one starts without ARCADIA_DATA_DIR, as an installed copy does, and must find and read all of it
# (carryover.mjs lists what). Never touches /Applications, the real app's data or the login keychain.
set -euo pipefail
# The new build must find the data by itself: nothing from this shell may point it elsewhere.
unset ARCADIA_DATA_DIR ARCADIA_UPDATE_FEED_URL

old="${1:?usage: carryover.sh <previous app> <new app>}"
new="${2:?usage: carryover.sh <previous app> <new app>}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(git -C "$here" rev-parse --show-toplevel)"
test_id="com.arcadia.browser.carryover"
cdp_old="${CARRYOVER_CDP_PORT:-9394}" cdp_new="$(( ${CARRYOVER_CDP_PORT:-9394} + 1 ))"
pages_port="${CARRYOVER_PAGES_PORT:-8794}"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/ac-carryover.XXXXXX")" && pwd -P)"
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
copy "$old" "$work/old/Arcadia.app"
copy "$new" "$work/new/Arcadia.app"
swiftc -O "$here/quit.swift" -o "$work/quit" 2>/dev/null
mkdir -p "$work/home" "$work/pages"
for page in page1 page2 work; do
  printf '<!doctype html><title>Carryover %s</title><h1>%s</h1><form><input name="username" autocomplete="username"><input type="password" autocomplete="current-password"></form>\n' "$page" "$page" > "$work/pages/$page.html"
done
# An unpacked extension, copied out of the checkout (an app reading ~/Documents raises macOS's folder prompt).
cp -R "$root/spikes/arcadiacore-host/fixtures/ext" "$work/extension"
if nc -z -G 2 127.0.0.1 "$pages_port" 2>/dev/null; then
  echo "error: port $pages_port is taken (CARRYOVER_PAGES_PORT)" >&2
  exit 1
fi
python3 -m http.server "$pages_port" --bind 127.0.0.1 --directory "$work/pages" >/dev/null 2>&1 &
server=$!
sleep 1
origin="http://127.0.0.1:$pages_port"
export CARRYOVER_QUIT="$work/quit"
timeout 300 node "$here/carryover.mjs" create "$work/old/Arcadia.app" "$work/home" "$cdp_old" "$origin" "$work/extension" "$work/created.json"
timeout 300 node "$here/carryover.mjs" read "$work/new/Arcadia.app" "$work/home" "$cdp_new" "$origin" "$work/created.json" "$work/read.json"

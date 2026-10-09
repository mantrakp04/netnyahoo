#!/usr/bin/env bash
# Smoke test of a release build before publishing it.
# usage: smoke.sh <version> <previous-version> [--rc]
#   Tests dist/<version>/ (dist/<version>-rc/ with --rc). SMOKE_APP=<path to Arcadia.app> tests that build instead
#   (an engine change before it ships, say): the version arguments still drive the release-notes check, and the
#   checks of the release's files (zip, DMG, appcast) are skipped.
#
# First what an update from <previous> depends on (dist/<previous>/export/Arcadia.app):
# - the engine is ArcadiaCore (Chrome's framework, no CEF);
# - Sparkle on <previous> would install it in place: same bundle id, executable, feed and EdDSA key, it satisfies
#   <previous>'s designated requirement (Sparkle's code-signing check, and what the keychain and TCC trust), a higher
#   build number, and the appcast's signature of the zip verifies with that key;
# - Gatekeeper accepts the app and the DMG as notarized and stapled;
# - update-test.sh: <previous>'s Sparkle really updates a copy to this build (test copies, a local feed);
# - carryover.sh: <previous>'s data, where an installed copy keeps it, opens in this build with nothing converted.
# Then it launches the build hidden (ARCADIA_BACKGROUND=1: no Dock icon, never takes focus) with a throwaway data
# dir that says <previous> ran last, so the after-update release-notes tab opens (ARCADIA_RELEASE_NOTES=1), and
# whose session has a window left on its second profile (each profile a Chrome window of its own: the window restores
# as the Work profile's, Personal's made ahead off screen; Work shows its pinned tab). Runs smoke.mjs over CDP, checks
# the browser's child processes are the bundle's own helpers, quits the app as ⌘Q and updates do and checks it exits
# cleanly, then that the bundle is still sealed.
# Never touches /Applications or the user's own data.
set -euo pipefail

version="${1:?usage: smoke.sh <version> <previous-version> [--rc]}"
previous="${2:?usage: smoke.sh <version> <previous-version> [--rc]}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
here="$(cd "$(dirname "$0")" && pwd)"
if [ "${3:-}" = --rc ]; then dist="$root/dist/$version-rc"; else dist="$root/dist/$version"; fi
app="${SMOKE_APP:-$dist/export/Arcadia.app}"
old="$root/dist/$previous/export/Arcadia.app"
port="${SMOKE_CDP_PORT:-9398}"
pages_port="${SMOKE_PAGES_PORT:-8798}"
[ -d "$app" ] || { echo "error: no $app (run scripts/release.sh $version first)" >&2; exit 1; }
[ "$(cd "$app" && pwd -P)" != /Applications/Arcadia.app ] || { echo "error: never the installed app (/Applications/Arcadia.app)" >&2; exit 1; }
for p in "$port" "$pages_port"; do
  if nc -z -G 2 127.0.0.1 "$p" 2>/dev/null; then
    echo "error: something already listens on port $p (SMOKE_CDP_PORT, SMOKE_PAGES_PORT)" >&2
    exit 1
  fi
done

work="$(mktemp -d "${TMPDIR:-/tmp}/ac-smoke.XXXXXX")"
server=""
logger=""
cleanup() {
  [ -n "${pid:-}" ] && kill -KILL "$pid" 2>/dev/null || true
  [ -n "$logger" ] && { kill "$logger"; wait "$logger"; } 2>/dev/null || true
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT

status=0
check() { # name ok detail
  if [ "$2" = 1 ]; then echo "PASS  $1${3:+  ($3)}"; else echo "FAIL  $1${3:+  ($3)}"; status=1; fi
}
info() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null || true; }
cdhash() { codesign -dvvv "$1" 2>&1 | sed -n 's/^CDHash=//p'; }

fw="$app/Contents/Frameworks"
[ -d "$fw/Chromium Framework.framework" ] && [ ! -e "$fw/Chromium Embedded Framework.framework" ] && ok=1 || ok=0
check "the engine is ArcadiaCore (Chrome's framework, no CEF)" $ok \
  "$(plutil -extract CFBundleShortVersionString raw "$fw/Chromium Framework.framework/Resources/Info.plist" 2>/dev/null)"
if [ -d "$old" ]; then
  same=1
  for key in CFBundleIdentifier CFBundleExecutable SUFeedURL SUPublicEDKey; do
    [ "$(info "$app" $key)" = "$(info "$old" $key)" ] || { same=0; echo "      $key: $(info "$old" $key) → $(info "$app" $key)"; }
  done
  check "same bundle id, executable, feed and update key as $previous" $same
  old_dr="$(codesign -d -r- "$old" 2>&1 | sed -n 's/^designated => //p')"
  codesign --verify -R="$old_dr" "$app" 2>"$work/dr.log" && ok=1 || ok=0
  check "satisfies $previous's designated requirement (Sparkle, the keychain and TCC trust it)" $ok "$(head -c 160 "$work/dr.log")"
  [ "$(info "$app" CFBundleVersion)" -gt "$(info "$old" CFBundleVersion)" ] && ok=1 || ok=0
  check "build number above $previous's" $ok "$(info "$old" CFBundleVersion) → $(info "$app" CFBundleVersion)"
else
  check "$previous's export to compare with" 0 "no $old"
fi
zip="$dist/Arcadia-$version.zip"
dmg="$dist/Arcadia-$version.dmg"
if [ -z "${SMOKE_APP:-}" ]; then
  # What Sparkle downloads: the zip in the appcast, signed with the update key, holding this very app.
  for f in "$zip" "$dmg" "$dist/appcast.xml"; do [ -f "$f" ] || check "the release has $(basename "$f")" 0; done
  if [ -f "$zip" ] && [ -f "$dist/appcast.xml" ]; then
    swiftc -O "$here/ed25519.swift" -o "$work/ed25519" 2>/dev/null
    item="$(awk -v v="$version" '/<item>/ { buf = "" } { buf = buf $0 "\n" } /<\/item>/ && buf ~ ("shortVersionString>" v "<") { print buf; exit }' "$dist/appcast.xml")"
    signature="$(printf '%s' "$item" | grep -o 'sparkle:edSignature="[^"]*"' | head -1 | sed 's/^sparkle:edSignature="//; s/"$//')"
    length="$(printf '%s' "$item" | grep -o 'length="[0-9]*"' | head -1 | tr -dc 0-9)"
    ok=0
    [ -n "$signature" ] && "$work/ed25519" verify "$zip" "$signature" "$(info "$app" SUPublicEDKey)" && [ "$length" = "$(stat -f %z "$zip")" ] && ok=1
    check "the appcast's EdDSA signature of the zip verifies with the app's SUPublicEDKey" $ok "length ${length:-none}"
    # Its top folder has the installed copies' file name (release.sh), whatever it is.
    mkdir -p "$work/zip" && ditto -x -k "$zip" "$work/zip"
    zapp="$(ls -d "$work/zip"/*.app 2>/dev/null | head -1)"
    [ -n "$zapp" ] && [ -n "$(cdhash "$app")" ] && [ "$(cdhash "$zapp")" = "$(cdhash "$app")" ] \
      && codesign --verify --deep --strict "$zapp" 2>/dev/null && xcrun stapler validate "$zapp" >/dev/null 2>&1 && ok=1 || ok=0
    check "the zip holds this app, sealed and stapled" $ok
    rm -rf "$work/zip"
  fi
fi
spctl -a -vv -t exec "$app" > "$work/spctl.log" 2>&1 && grep -q "source=Notarized Developer ID" "$work/spctl.log" && ok=1 || ok=0
check "Gatekeeper: the app is notarized Developer ID" $ok "$(tr '\n' ' ' < "$work/spctl.log" | head -c 160)"
xcrun stapler validate "$app" >/dev/null 2>&1 && ok=1 || ok=0
check "the app has its notarization ticket stapled" $ok
if [ -z "${SMOKE_APP:-}" ] && [ -f "$dmg" ]; then
  xcrun stapler validate "$dmg" >/dev/null 2>&1 && spctl -a -t open --context context:primary-signature "$dmg" 2>/dev/null && ok=1 || ok=0
  check "the DMG is signed, notarized and stapled" $ok
fi
if [ -d "$old" ]; then
  if [ -z "${SMOKE_APP:-}" ] && [ -f "$dist/appcast.xml" ]; then
    TMPDIR="$work" "$here/update-test.sh" "$old" "$app" "$dist/appcast.xml" "$version" || status=1
  fi
  TMPDIR="$work" "$here/carryover.sh" "$old" "$app" || status=1
fi

swiftc -O "$here/windows.swift" -o "$work/windows" 2>/dev/null
swiftc -O "$here/quit.swift" -o "$work/quit" 2>/dev/null
swiftc -O "$here/keys.swift" -o "$work/keys" 2>/dev/null
swiftc -O "$here/gurl.swift" -o "$work/gurl" 2>/dev/null
python3 -m http.server "$pages_port" --bind 127.0.0.1 --directory "$here/pages" >/dev/null 2>&1 &
server=$!

mkdir -p "$work/data"
printf '{"version":1,"lastVersion":"%s","pending":null}' "$previous" > "$work/data/release-notes.json"
pages="http://localhost:$pages_port"
tab() { # id profile url [pinned]
  local pinned="${4:-false}" home=null
  [ "$pinned" = true ] && home="\"$3\""
  printf '{"id":"%s","windowId":"w-smoke","profileId":"%s","url":"%s","title":"","favicon":null,"pinned":%s,"muted":false,"zoom":1,"customTitle":null,"customIcon":null,"pinnedUrl":%s,"openerId":null,"createdAt":1,"lastActiveAt":1}' "$1" "$2" "$3" "$pinned" "$home"
}
cat > "$work/data/session.json" <<JSON
{"version":2,
 "profiles":{"default":{"id":"default","name":"Personal","color":"plum","icon":null,"createdAt":0},
             "p-work":{"id":"p-work","name":"Work","color":"blue","icon":null,"createdAt":1}},
 "profileOrder":["default","p-work"],
 "windows":[{"id":"w-smoke","profileId":"p-work","incognito":false,"tabIds":["t-pin-a","t-home","t-work"],
             "activeTabIds":{"default":"t-home","p-work":"t-pin-a"},"sidebarOpen":true,"frame":[80,80,1280,800],"createdAt":1}],
 "windowOrder":["w-smoke"],"focusedWindowId":"w-smoke",
 "tabs":[$(tab t-pin-a p-work "$pages/count.html?pin-a" true),$(tab t-home default "$pages/form.html?home"),
         $(tab t-work p-work "$pages/form.html?work")],
 "groups":[],"splits":[],"closedTabs":[],"closedWindows":[],"closedGroups":[],"cleanedTabs":[]}
JSON

# Chrome's last-used profile is Work's, as after quitting with Work's window in front (smoke.mjs checks Personal's
# pages don't run in it).
# The dev harness (dev-eval.js), which release builds start only for an isolated instance with a perf-probe file:
# smoke.mjs reads the window's accessibility tree through it. The probe itself only counts store and timer calls.
: > "$work/data/perf-probe"

mkdir -p "$work/data/Chromium"
printf '{"profile":{"last_used":"Profile p-work"}}' > "$work/data/Chromium/Local State"

codesign --verify --deep --strict "$app"
# Hidden, with its own data dir and DevTools port (scripts/lib/instance.mjs). Its pid is the process of this build that
# started listening on our port: another of the same build may be running, even one the owner opened during the run
# (a process-list diff once picked theirs and killed it at the end). It records the instance in data/instance.json,
# which smoke.mjs attaches to; its own bundle's JS (--js none), as a release runs.
launched="$("$root/scripts/agent/ac" launch "$app" --data "$work/data" --port "$port" --js none --no-wait \
  --env ARCADIA_RELEASE_NOTES=1 --env ARCADIA_PIP_SELFTEST=close --switch --disable-backgrounding-occluded-windows)" \
  || { echo "error: the app didn't start" >&2; exit 1; }
pid="$(sed -n 's/^pid \([0-9]*\) .*/\1/p' <<<"$launched")"
[ -n "$pid" ] || { echo "error: the app didn't start ($launched)" >&2; exit 1; }
sleep 8  # session restore, then the release-notes tab

locked="$("$work/windows" --locked)"
[ "$locked" = 1 ] && echo "note: the screen is locked; checks of window order and closing are skipped (they need an unlocked screen)"
SMOKE_LOCKED="$locked" SMOKE_DATA="$work/data" SMOKE_KEYS="$work/keys" SMOKE_GURL="$work/gurl" node "$here/smoke.mjs" "$version" "$work/windows" "$pages" || status=1

# Chrome's process checks pass under Developer ID signing: the browser's children are the bundle's own helpers.
children="$(ps -axo ppid=,pid=,comm= | awk -v p="$pid" '$1 == p { $1 = ""; $2 = ""; sub(/^ +/, ""); print }')"
foreign="$(printf '%s\n' "$children" | grep -v "^$fw/Chromium Framework.framework/" | grep -v '^$' || true)"
kinds="$(printf '%s\n' "$children" | sed -n 's/.*Helpers\/\([^/]*\)\.app\/.*/\1/p' | sort | uniq -c | tr -s ' ' | tr '\n' ',')"
[ -z "$foreign" ] && [[ "$kinds" == *"(Renderer)"* ]] && ok=1 || ok=0
check "the browser's child processes are the bundle's own helpers (a renderer among them)" $ok "${kinds%,}${foreign:+; foreign: $foreign}"

# Quit it as ⌘Q and Sparkle's update do (the quit Apple event, to this instance only; SIGTERM skips
# the app's own shutdown): it must be gone within 15 s, exit 0 and leave no crash report. 0.2.6 and
# 0.2.7 crashed on every quit, so every update ended in "Arcadia quit unexpectedly".
log stream --style compact --predicate "process == \"runningboardd\" AND eventMessage CONTAINS \":$pid]\" AND eventMessage CONTAINS \"termination reported\"" \
  > "$work/exit.log" 2>/dev/null &
logger=$!
sleep 1
touch "$work/quit-marker"
"$work/quit" "$pid" >/dev/null || true
tenths=0
while kill -0 "$pid" 2>/dev/null && [ $tenths -lt 150 ]; do sleep 0.1; tenths=$((tenths + 1)); done
if kill -0 "$pid" 2>/dev/null; then
  echo "FAIL  quits cleanly on the quit Apple event  (still running after 15 s)"
  status=1
else
  # runningboardd's record of the exit ("(0, 0, 0)": status 0, no signal), and ReportCrash's report.
  exited="" report=""
  for _ in $(seq 1 10); do
    sleep 1
    # The app's own line ("[app<…>:<pid>] termination reported"). Lines for XPC services it used also
    # carry its pid ("[xpcservice<…([app<…>:<pid>])…>:<their pid>]"), and launchd SIGKILLs those
    # (2, 9, 9) as their client exits, sometimes logging them first.
    exited="$(grep -o ">:$pid\] termination reported by launchd ([0-9, ]*)" "$work/exit.log" | head -1 | sed 's/.*launchd //' || true)"
    # Only reports written after the quit: pids get reused, and an old report can share this one's.
    report="$(find ~/Library/Logs/DiagnosticReports ~/Library/Logs/DiagnosticReports/Retired -maxdepth 1 \
      -name 'Arcadia-*.ips' -newer "$work/quit-marker" -exec grep -l "\"pid\" : $pid," {} + 2>/dev/null | head -1 || true)"
    [ -n "$report" ] && break
    [ "$exited" = "(0, 0, 0)" ] && break
  done
  detail="exited in $((tenths / 10)).$((tenths % 10)) s, ${exited:-exit status not logged}"
  if [ -z "$report" ] && [ "${exited:-(0, 0, 0)}" = "(0, 0, 0)" ]; then
    echo "PASS  quits cleanly on the quit Apple event  ($detail)"
  else
    echo "FAIL  quits cleanly on the quit Apple event  ($detail${report:+; crash report $report})"
    status=1
  fi
fi
{ kill "$logger"; wait "$logger"; } 2>/dev/null || true
logger=""
kill -KILL "$pid" 2>/dev/null || true
pid=""
# Extension popups on this build's own bundle (a second hidden instance, a fixture extension): chrome.action.openPopup
# from a service worker with no user gesture (1Password's call once its Mac app unlocks; 0.2.26 said "Browser window
# has no toolbar."), and the popup's size following its page.
node "$root/packages/arcadiacore/scripts/popup-check.mjs" "$app" "$work/popup-check" || status=1
codesign --verify --deep --strict "$app" && echo "PASS  bundle still sealed after running" || { echo "FAIL  running the app changed its bundle"; status=1; }
# The feed in this build's Info.plist answers (after publishing, feed.sh <version> checks it lists it).
"$here/feed.sh" "$version" --before-publish "$app" || status=1
exit $status

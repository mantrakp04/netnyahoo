#!/usr/bin/env bash
# Sparkle's update of <previous>'s export to this build, end to end, in a scratch folder.
# usage: update-test.sh <previous Netnyahoo.app> <new Netnyahoo.app> <appcast.xml> <version>
#
# Copies both apps, gives both copies a test bundle id and a throwaway EdDSA key (so Sparkle's settings land in that
# id's defaults, never the real app's, and no release key is needed), zips the new one as release.sh does and serves
# it from a local feed made of the release appcast's own <version> item. Then the previous build's Sparkle framework
# updates the old copy in place (sparkle-host.swift: feed, EdDSA check, extraction, Sparkle's installer swapping the
# bundle), and the copy must end up identical to the new build, sealed. What the test copies can't show, the real
# identity (the bundle id, the designated requirement, the release key's signature of the zip), smoke.sh checks on
# the real files. Never touches /Applications, and never launches either app.
set -euo pipefail

old="${1:?usage: update-test.sh <previous app> <new app> <appcast.xml> <version>}"
new="${2:?}" appcast="${3:?}" version="${4:?}"
here="$(cd "$(dirname "$0")" && pwd)"
test_id="com.netnyahoo.browser.updatetest"
port="${UPDATE_TEST_PORT:-8796}"
work="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/nn-update-test.XXXXXX")" && pwd -P)"
server=""
cleanup() {
  [ -n "$server" ] && { kill "$server"; wait "$server"; } 2>/dev/null || true
  defaults delete "$test_id" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/Preferences/$test_id.plist"
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "FAIL  Sparkle updates the previous build in place  ($*)"; exit 1; }
plist() { /usr/libexec/PlistBuddy "$@"; }

swiftc -O "$here/ed25519.swift" -o "$work/ed25519" 2>/dev/null
public_key="$("$work/ed25519" generate "$work/key")"
# Sparkle's installer (Autoupdate, Developer ID in the export) only takes a host signed by its own team, so the copies
# and the host tool are signed with the team's Apple Development identity (the one Debug builds use).
identity="$(security find-identity -v -p codesigning | awk '/"Apple Development/ { print $2; exit }')"
[ -n "$identity" ] || { echo "error: no Apple Development identity to sign the test copies with" >&2; exit 1; }
retag() { # app: the test bundle id and key, re-signed (without the entitlements; neither copy is launched)
  plist -c "Set :CFBundleIdentifier $test_id" -c "Set :SUPublicEDKey $public_key" "$1/Contents/Info.plist"
  codesign --force --deep --timestamp=none --sign "$identity" "$1" 2>/dev/null
}
mkdir -p "$work/installed" "$work/new" "$work/feed" "$work/home"
ditto "$old" "$work/installed/Netnyahoo.app"
ditto "$new" "$work/new/Netnyahoo.app"
retag "$work/installed/Netnyahoo.app"
retag "$work/new/Netnyahoo.app"
# The Sparkle that runs the update is the one in the copy people have (built against the pod's headers, which the
# exported framework doesn't carry).
ditto "$old/Contents/Frameworks/Sparkle.framework" "$work/fw/Sparkle.framework"
pods="$(git -C "$here" rev-parse --show-toplevel)/apps/browser/macos/Pods/Sparkle"
swiftc -O "$here/sparkle-host.swift" -F "$pods" -framework Sparkle -Xlinker -rpath -Xlinker "$work/fw" \
  -o "$work/sparkle-host" 2>"$work/swiftc.log" || { cat "$work/swiftc.log" >&2; exit 1; }
codesign --force --timestamp=none --sign "$identity" "$work/sparkle-host" 2>/dev/null

zip="$work/feed/Netnyahoo-$version.zip"
ditto -c -k --keepParent "$work/new/Netnyahoo.app" "$zip"
signature="$("$work/ed25519" sign "$zip" "$work/key")"
# The release appcast's item for this version, pointed at the local zip.
python3 - "$appcast" "$version" "http://127.0.0.1:$port/$(basename "$zip")" "$(stat -f %z "$zip")" "$signature" > "$work/feed/appcast.xml" <<'PY'
import re, sys
source, version, url, length, signature = sys.argv[1:]
xml = open(source).read()
items = [i for i in re.findall(r"<item>.*?</item>", xml, re.S) if f"<sparkle:shortVersionString>{version}<" in i]
if not items: sys.exit(f"no {version} item in {source}")
item = re.sub(r'url="[^"]*"', f'url="{url}"', items[0])
item = re.sub(r'length="[^"]*"', f'length="{length}"', item)
item = re.sub(r'sparkle:edSignature="[^"]*"', f'sparkle:edSignature="{signature}"', item)
print(xml[: xml.index("<item>")] + item + "\n    </channel>\n</rss>")
PY
if curl -fs --max-time 2 "http://127.0.0.1:$port/" >/dev/null 2>&1; then
  echo "error: port $port is taken (UPDATE_TEST_PORT)" >&2
  exit 1
fi
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$work/feed" >/dev/null 2>&1 &
server=$!
sleep 1

from="$(plist -c "Print :CFBundleShortVersionString" "$work/installed/Netnyahoo.app/Contents/Info.plist")"
HOME="$work/home" CFFIXED_USER_HOME="$work/home" timeout 300 "$work/sparkle-host" "$work/installed/Netnyahoo.app" \
  "http://127.0.0.1:$port/appcast.xml" "$version" > "$work/sparkle.log" 2>&1 \
  || { sed 's/^/      /' "$work/sparkle.log"; fail "Sparkle didn't install it"; }
sed 's/^/      /' "$work/sparkle.log"
installed="$work/installed/Netnyahoo.app"
codesign --verify --deep --strict "$installed" 2>/dev/null || fail "the installed bundle isn't sealed"
# Every file, symlink and mode the new build has, and nothing else (the old bundle's CEF framework and helpers gone).
mtree -c -k type,mode,link,size,sha256digest -p "$work/new/Netnyahoo.app" > "$work/new.mtree"
differences="$(mtree -p "$installed" -f "$work/new.mtree" 2>&1 | head -5 || true)"
[ -z "$differences" ] || fail "the installed bundle differs from the new build: $differences"
ls "$work/installed" | grep -qv '^Netnyahoo.app$' && fail "left beside it: $(ls "$work/installed" | tr '\n' ' ')"
echo "PASS  Sparkle on $from updates a copy in place to $version (feed, EdDSA, extraction, installer; the bundle is the new build's, sealed)"

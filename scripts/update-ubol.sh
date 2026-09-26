#!/usr/bin/env bash
# Moves the bundled uBlock Origin Lite to its latest GitHub release, so each Netnyahoo release
# ships the block lists uBOL published last (they only change when uBOL does: a component
# extension never updates itself).
#
# usage: scripts/update-ubol.sh [--check]
#   --check  only say whether a newer release exists (exit 1 when it does)
#
# It checks the release's chromium zip against the SHA-256 digest GitHub records for the asset
# and against the manifest inside (its version must be the tag's, MV3 with declarativeNetRequest
# rulesets), then rewrites the pin (UBOL_VERSION, UBOL_SHA256) in packages/cef/scripts/ubol.sh
# and installs it into packages/cef/vendor/ubol. Commit ubol.sh afterwards; the next build (or
# release.sh, through setup.sh) bundles it. Nothing downloaded here runs until it is committed.
set -euo pipefail

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
pin="$root/packages/cef/scripts/ubol.sh"
repo="uBlockOrigin/uBOL-home"
current="$(sed -n 's/^UBOL_VERSION="\(.*\)"$/\1/p' "$pin")"
[ -n "$current" ] || { echo "error: no UBOL_VERSION in $pin" >&2; exit 1; }

# The latest non-prerelease release: its tag and the chromium zip's URL and digest.
release="$(curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/releases/latest")"
read -r latest url digest < <(python3 -c '
import json, sys
r = json.load(sys.stdin)
zips = [a for a in r["assets"] if a["name"] == "uBOLite_%s.chromium.zip" % r["tag_name"]]
if r.get("prerelease") or r.get("draft") or len(zips) != 1:
    sys.exit("error: the latest release has no single chromium zip")
a = zips[0]
digest = (a.get("digest") or "").removeprefix("sha256:")
print(r["tag_name"], a["browser_download_url"], digest or "-")
' <<< "$release")

if [ "$latest" = "$current" ]; then
  echo "uBOL $current is the latest release"
  "$root/packages/cef/scripts/ubol.sh"
  exit 0
fi
# Tags are dates (2026.920.1710): never move the pin backwards.
if [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" != "$latest" ]; then
  echo "error: the latest release ($latest) is older than the pinned $current" >&2
  exit 1
fi
if [ "${1:-}" = "--check" ]; then
  echo "uBOL $latest is out (bundled: $current)"
  exit 1
fi
[ "$digest" != "-" ] || { echo "error: GitHub gives no digest for $url; not updating" >&2; exit 1; }

ubol="$root/packages/cef/vendor/ubol"
zip="$ubol/uBOLite_$latest.chromium.zip"
mkdir -p "$ubol"
echo "Downloading $url"
curl -fL --retry 3 -o "$zip.part" "$url"
sha="$(shasum -a 256 "$zip.part" | cut -d' ' -f1)"
[ "$sha" = "$digest" ] || { rm -f "$zip.part"; echo "error: $url has SHA-256 $sha, GitHub says $digest" >&2; exit 1; }
unzip -p "$zip.part" manifest.json | python3 -c '
import json, sys
m = json.load(sys.stdin)
want = sys.argv[1]
problems = []
if m.get("version") != want: problems.append("version %r, not %r" % (m.get("version"), want))
if m.get("manifest_version") != 3: problems.append("not MV3")
if not m.get("declarative_net_request", {}).get("rule_resources"): problems.append("no declarativeNetRequest rulesets")
if problems: sys.exit("error: manifest.json: " + "; ".join(problems))
' "$latest"
mv "$zip.part" "$zip"

sed -i '' "s/^UBOL_VERSION=\".*\"$/UBOL_VERSION=\"$latest\"/; s/^UBOL_SHA256=\".*\"$/UBOL_SHA256=\"$sha\"/" "$pin"
"$root/packages/cef/scripts/ubol.sh"
[ "$(cat "$ubol/.version")" = "$latest" ] || { echo "error: vendor/ubol didn't install $latest" >&2; exit 1; }
echo "uBOL $current -> $latest (sha256 $sha)"
echo "Commit it: git add packages/cef/scripts/ubol.sh && git commit -m \"Block lists: uBlock Origin Lite $latest\""

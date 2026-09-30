#!/usr/bin/env bash
# Checks the Sparkle feed the build will poll: the SUFeedURL in the app's own Info.plist.
# usage: feed.sh <version> [--before-publish] [<path to Netnyahoo.app>]
#   after publishing (default): the feed must list <version>; that's what installed copies see.
#   --before-publish: the feed must answer with an appcast at all (smoke.sh runs this). A 404 from
#     netnyahoo.com/appcast.xml means the site with the feed endpoint (apps/site/nginx.conf) isn't
#     deployed, and a build that shipped now would never see an update.
# curl's own User-Agent isn't Sparkle's, so these requests aren't counted as update checks.
set -euo pipefail

version="${1:?usage: feed.sh <version> [--before-publish] [app]}"
shift
before=0
if [ "${1:-}" = "--before-publish" ]; then before=1; shift; fi
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
app="${1:-$root/dist/$version/export/Netnyahoo.app}"

feed="$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$app/Contents/Info.plist")"
case "$feed" in
  https://*) ;;
  *) echo "FAIL  feed URL is https  ($feed)"; exit 1 ;;
esac
xml="$(curl -fsSL --max-time 20 --retry 2 "$feed" 2>&1)" || { echo "FAIL  feed answers  ($feed: $xml)"; exit 1; }
listed="$(printf '%s' "$xml" | grep -o 'shortVersionString>[^<]*' | head -1 | sed 's/.*>//' || true)"
if ! printf '%s' "$xml" | grep -q 'xmlns:sparkle'; then
  echo "FAIL  feed is a Sparkle appcast  ($feed)"
  exit 1
fi
if [ $before = 1 ]; then
  echo "PASS  feed answers with an appcast  ($feed, latest ${listed:-none})"
elif [ "$listed" = "$version" ]; then
  echo "PASS  feed lists $version  ($feed)"
else
  echo "FAIL  feed lists $version  ($feed lists ${listed:-nothing})"
  exit 1
fi

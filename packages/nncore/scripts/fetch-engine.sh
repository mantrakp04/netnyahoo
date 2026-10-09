#!/bin/bash
# Downloads the prebuilt engine (Chrome's framework built with engine/, "Chromium Framework.framework") that matches
# this checkout, so the app builds without a Chromium tree. Prints the framework's path; everything else goes to stderr.
# stage-framework.sh runs it when there's no local engine build (~/chromium-build) and no NNCORE_FRAMEWORK.
#
#   fetch-engine.sh             the engine built from exactly this checkout's engine/ (its git tree)
#   fetch-engine.sh --nearest   or else the newest one built from an earlier engine/ (the app may not match it)
#
# Every release whose engine/ changed attaches NNCore-<tree>.tar.xz (release.sh packs it: stripped, ~110 MB) and adds
# a line to prebuilt-engines.tsv: engine/'s git tree, the release, the archive's SHA-256. The download is checked
# against that line, so it is only as trusted as this repo. A line lands after its release is tagged: a checkout of
# the tag looks it up in main's copy of the table.
# Uncommitted changes under engine/ can't be in any prebuilt: build the engine (docs/engine-build.md).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../.." && pwd)
repo=${NNCORE_PREBUILT_REPO:-mantrakp04/netnyahoo}
# Where release assets download from (another host for a fork, a local server for a test).
assets=${NNCORE_PREBUILT_ASSETS:-https://github.com/$repo/releases/download}
table="$here/../prebuilt-engines.tsv"
store="$root/apps/browser/build-nncore/prebuilt"
name="Chromium Framework"
die() { echo "error: $*" >&2; exit 1; }

nearest=0
case "${1:-}" in
  "") ;;
  --nearest) nearest=1 ;;
  *) die "usage: fetch-engine.sh [--nearest]" ;;
esac

git -C "$root" rev-parse --git-dir >/dev/null 2>&1 || die "$root isn't a git checkout: a prebuilt engine is matched to engine/'s git tree"
[ -z "$(git -C "$root" status --porcelain -- engine)" ] \
  || die "engine/ has uncommitted changes, and no prebuilt has them: build the engine (docs/engine-build.md)"
tree=$(git -C "$root" rev-parse HEAD:engine)

# Lines of the table: <engine tree> <version> <sha256>. This checkout's copy, then main's.
remote_table=""
lookup() {
  local line
  [ -n "$1" ] || return 0
  line=$(awk -v t="$1" '$1 == t { print; exit }' "$table" 2>/dev/null || true)
  if [ -z "$line" ]; then
    [ -n "$remote_table" ] || remote_table=$(curl -fsL --retry 2 "https://raw.githubusercontent.com/$repo/main/packages/nncore/prebuilt-engines.tsv" || echo "#")
    line=$(awk -v t="$1" '$1 == t { print; exit }' <<<"$remote_table")
  fi
  echo "$line"
}

entry=$(lookup "$tree")
if [ -z "$entry" ]; then
  # The newest engine/ before this one that has a prebuilt: walk the commits that changed engine/.
  skipped=0 found=""
  while read -r commit; do
    candidate=$(lookup "$(git -C "$root" rev-parse "$commit:engine" 2>/dev/null || true)")
    if [ -n "$candidate" ]; then found=$candidate; break; fi
    skipped=$((skipped + 1))
    [ "$skipped" -lt 200 ] || break
  done < <(git -C "$root" rev-list HEAD -- engine)
  [ -n "$found" ] || die "no prebuilt engine for this checkout or any earlier one: build the engine (docs/engine-build.md)"
  version=$(awk '{ print $2 }' <<<"$found")
  if [ "$nearest" = 0 ]; then
    die "no prebuilt engine for this checkout's engine/ ($skipped engine commits since $version's). Check out v$version, \
or run packages/nncore/scripts/fetch-engine.sh --nearest to build against $version's engine anyway, or build the engine"
  fi
  echo "warning: using $version's engine; engine/ changed in $skipped commits since, and the app may not match it" >&2
  entry=$found
fi
read -r tree version sha <<<"$entry"
short=${tree:0:12}
dest="$store/$short"
if [ ! -f "$dest/.complete" ]; then
  file="NNCore-$short.tar.xz"
  url="$assets/v$version/$file"
  tmp="$store/.tmp-$$"
  rm -rf "$tmp" && mkdir -p "$tmp"
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading the engine from $version ($url)" >&2
  curl -fL --retry 3 --progress-bar -o "$tmp/$file" "$url" || die "couldn't download $url"
  [ "$(shasum -a 256 "$tmp/$file" | awk '{ print $1 }')" = "$sha" ] || die "$file doesn't match its SHA-256 in prebuilt-engines.tsv"
  tar -xJf "$tmp/$file" -C "$tmp" || die "couldn't unpack $file"
  [ -f "$tmp/$name.framework/Versions/Current/$name" ] || die "$file holds no $name.framework"
  rm -f "$tmp/$file"
  touch "$tmp/.complete"
  rm -rf "$dest"
  mv "$tmp" "$dest"
  trap - EXIT
  # Only the engine in use is kept.
  for old in "$store"/*/; do
    [ "${old%/}" = "$dest" ] || rm -rf "${old%/}"
  done
fi
echo "$dest/$name.framework"

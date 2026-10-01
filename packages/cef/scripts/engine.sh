#!/usr/bin/env bash
# The pinned engine: the exact CEF distribution (our patched build, docs/cef-source-build.md) this checkout
# builds against, recorded in packages/cef/engine.lock and published as a GitHub release asset (prerelease, never latest), so a fresh
# checkout gets it without ~/chromium-build.
#
#   engine.sh verify [dir]  dir (default vendor/cef) holds the pinned distribution; exits 1 if not
#   engine.sh hash <dir>    the tree hash of a distribution (every file and link but build/ and .version)
#   engine.sh fetch         downloads the pinned archive, checks it, and unpacks it into vendor/; prints its path
#   engine.sh pack [dir]    archives a distribution (default vendor/cef, what setup.sh installed) into vendor/
#                           and pins it in engine.lock; commit the lock, then publish
#   engine.sh publish       uploads the packed archive to the release named in engine.lock (gh)
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
lock="$here/engine.lock"
vendor="$here/vendor"
# shellcheck source=../engine.lock
source "$lock"

tree_hash() {
  local dir="$1"
  [ -d "$dir/include" ] || { echo "error: $dir is not a CEF distribution" >&2; return 1; }
  (
    cd "$dir"
    # Paths, link targets and file contents, in a fixed order; build/ (libcef_dll_wrapper) and .version are setup.sh's.
    find . \( -path ./build -o -path ./.version \) -prune -o \( -type f -o -type l \) -print | LC_ALL=C sort |
      while IFS= read -r path; do
        if [ -L "$path" ]; then printf 'link %s -> %s\n' "$path" "$(readlink "$path")"
        else printf 'file %s %s\n' "$path" "$(shasum -a 256 < "$path" | cut -d' ' -f1)"; fi
      done
  ) | shasum -a 256 | cut -d' ' -f1
}

archive="$vendor/$ENGINE_DIST.tar.zst"

case "${1:-verify}" in
  hash)
    tree_hash "${2:?usage: engine.sh hash <dir>}"
    ;;
  verify)
    dir="${2:-$vendor/cef}"
    actual="$(tree_hash "$dir")"
    if [ "$actual" != "$ENGINE_TREE_SHA256" ]; then
      echo "error: $dir isn't the pinned engine ($ENGINE_DIST, tree $ENGINE_TREE_SHA256; found $actual)." >&2
      echo "  Use it: packages/cef/scripts/setup.sh. Pin a new build: packages/cef/scripts/engine.sh pack (docs/cef-source-build.md)." >&2
      exit 1
    fi
    echo "$dir is the pinned engine ($ENGINE_DIST)"
    ;;
  fetch)
    out="$vendor/$ENGINE_DIST"
    if [ -d "$out" ] && [ "$(tree_hash "$out")" = "$ENGINE_TREE_SHA256" ]; then echo "$out"; exit 0; fi
    mkdir -p "$vendor"
    if [ ! -f "$archive" ] || [ "$(shasum -a 256 < "$archive" | cut -d' ' -f1)" != "$ENGINE_ARCHIVE_SHA256" ]; then
      rm -f "$archive"
      echo "Downloading $ENGINE_DIST from $ENGINE_REPO@$ENGINE_TAG" >&2
      # A public release asset: plain HTTPS, no gh login needed ('+' must be escaped in the URL).
      enc() { printf %s "$1" | sed 's/+/%2B/g'; }
      curl -fL --progress-bar -o "$archive.part" \
        "https://github.com/$ENGINE_REPO/releases/download/$(enc "$ENGINE_TAG")/$(enc "$(basename "$archive")")"
      mv "$archive.part" "$archive"
    fi
    echo "$ENGINE_ARCHIVE_SHA256  $archive" | shasum -a 256 -c - >&2
    rm -rf "$out"
    tar --zstd -xf "$archive" -C "$vendor"
    [ "$(tree_hash "$out")" = "$ENGINE_TREE_SHA256" ] || { echo "error: $out doesn't match engine.lock after unpacking" >&2; exit 1; }
    echo "$out"
    ;;
  pack)
    dist="${2:-$vendor/cef}"
    version="$(sed -n 's/^#define CEF_VERSION "\(.*\)"/\1/p' "$dist/include/cef_version.h")"
    name="cef_binary_${version}_macosarm64_minimal"
    tree="$(tree_hash "$dist")"
    archive="$vendor/$name.tar.zst"
    base="$(basename "$dist")"
    mkdir -p "$vendor"
    echo "Packing $dist as $name" >&2
    tar --zstd -cf "$archive.part" --exclude "$base/build" --exclude "$base/.version" -s ",^$base,$name," \
      -C "$(dirname "$dist")" "$base"
    mv "$archive.part" "$archive"
    sum="$(shasum -a 256 < "$archive" | cut -d' ' -f1)"
    cat > "$lock" <<EOF
# The engine this checkout builds against: our CEF build (docs/cef-source-build.md › "The pinned engine").
# Written by scripts/engine.sh pack; setup.sh installs it and engine.sh verify checks vendor/cef against it.
ENGINE_DIST="$name"
ENGINE_TREE_SHA256="$tree"
ENGINE_ARCHIVE_SHA256="$sum"
ENGINE_REPO="$ENGINE_REPO"
ENGINE_TAG="engine-${version%%+chromium*}-${tree:0:8}"
EOF
    echo "Pinned $name (tree $tree) in $lock; $archive is $(du -h "$archive" | cut -f1)." >&2
    echo "Commit engine.lock, then publish: packages/cef/scripts/engine.sh publish" >&2
    ;;
  publish)
    [ -f "$archive" ] && [ "$(shasum -a 256 < "$archive" | cut -d' ' -f1)" = "$ENGINE_ARCHIVE_SHA256" ] ||
      { echo "error: $archive is missing or isn't the one engine.lock pins; run engine.sh pack" >&2; exit 1; }
    if gh release view "$ENGINE_TAG" --repo "$ENGINE_REPO" >/dev/null 2>&1; then
      gh release upload "$ENGINE_TAG" "$archive" --repo "$ENGINE_REPO" --clobber
    else
      gh release create "$ENGINE_TAG" "$archive" --repo "$ENGINE_REPO" --prerelease --latest=false \
        --title "Engine $ENGINE_TAG" --notes "CEF distribution $ENGINE_DIST (tree $ENGINE_TREE_SHA256). Build input only."
    fi
    ;;
  *)
    sed -n '2,12p' "$0" >&2
    exit 2
    ;;
esac

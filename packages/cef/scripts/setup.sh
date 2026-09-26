#!/usr/bin/env bash
# Installs CEF into vendor/cef and builds libcef_dll_wrapper. Idempotent:
# re-running skips finished steps.
#
# Default: our own CEF build (docs/cef-source-build.md), a minimal binary
# distribution in ~/chromium-build/distrib. CEF_DIST=<dir> picks another local
# distribution. CEF_PREBUILT=1 downloads the pinned stock prebuilt instead (it
# lacks our patches: build the app with NN_CHROME_TABS=0).
set -euo pipefail

LOCAL_DIST="cef_binary_154.0.28+g564dd6c+chromium-154.0.8037.58_macosarm64_minimal"
if [ -z "${CEF_DIST:-}" ] && [ "${CEF_PREBUILT:-0}" != 1 ]; then
  CEF_DIST="$HOME/chromium-build/distrib/$LOCAL_DIST"
  [ -d "$CEF_DIST" ] || {
    echo "error: $CEF_DIST not found. Build it (docs/cef-source-build.md) or set CEF_PREBUILT=1." >&2
    exit 1
  }
fi

CEF_VERSION="154.0.26+ge72305f+chromium-154.0.8037.58"
CEF_SHA1="d568aa34169cc605e35e42312636489202e55918"
PLATFORM="macosarm64"

here="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$here/vendor"
name="cef_binary_${CEF_VERSION}_${PLATFORM}_minimal"
archive="$vendor/$name.tar.bz2"
# CEF_ROOT installs elsewhere than vendor/cef (build against it with NN_CEF_ROOT=<dir>
# on the xcodebuild command line; see NetnyahooCEF.podspec).
root="${CEF_ROOT:-$vendor/cef}"

mkdir -p "$vendor"
if [ -n "${CEF_DIST:-}" ]; then
  # A locally built minimal distribution, copied so its source tree can be
  # rebuilt without touching the app's copy.
  [ -f "$CEF_DIST/include/cef_version.h" ] || { echo "error: CEF_DIST=$CEF_DIST is not a CEF binary distribution" >&2; exit 1; }
  dist_id="local:$(basename "$CEF_DIST"):$(stat -f %m "$CEF_DIST/Release/Chromium Embedded Framework.framework/Chromium Embedded Framework")"
  if [ ! -f "$root/.version" ] || [ "$(cat "$root/.version")" != "$dist_id" ]; then
    echo "Using local CEF distribution $CEF_DIST"
    rm -rf "$root"
    rsync -a --exclude build "$CEF_DIST/" "$root/"
    echo "$dist_id" > "$root/.version"
  fi
elif [ ! -f "$root/.version" ] || [ "$(cat "$root/.version")" != "$CEF_VERSION" ]; then
  if [ ! -f "$archive" ]; then
    url="https://cef-builds.spotifycdn.com/$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$name.tar.bz2")"
    echo "Downloading $url"
    curl -fL --retry 3 -o "$archive.part" "$url"
    mv "$archive.part" "$archive"
  fi
  echo "$CEF_SHA1  $archive" | shasum -a 1 -c -
  rm -rf "$root" "$vendor/$name"
  tar -xjf "$archive" -C "$vendor"
  mv "$vendor/$name" "$root"
  echo "$CEF_VERSION" > "$root/.version"
fi

# libcef_dll_wrapper (static C++ wrapper around the C API).
lib="$root/build/libcef_dll_wrapper/libcef_dll_wrapper.a"
if [ ! -f "$lib" ]; then
  cmake -S "$root" -B "$root/build" -G Ninja \
    -DPROJECT_ARCH=arm64 -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0
  cmake --build "$root/build" --target libcef_dll_wrapper
fi
# The content blocker (uBlock Origin Lite), pinned in ubol.sh.
"$here/scripts/ubol.sh"

echo "CEF ready at $root"

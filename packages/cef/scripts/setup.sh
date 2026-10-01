#!/usr/bin/env bash
# Installs our CEF build into vendor/cef and builds libcef_dll_wrapper. Idempotent:
# re-running skips finished steps.
#
# Default: the minimal distribution pinned in ../engine.lock, from the local engine
# build in ~/chromium-build/distrib (docs/cef-source-build.md) when there is one,
# else from its release asset (scripts/engine.sh fetch). CEF_DIST=<dir> installs
# another local distribution.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
vendor="$here/vendor"
source "$here/engine.lock"
if [ -z "${CEF_DIST:-}" ]; then
  CEF_DIST="$HOME/chromium-build/distrib/$ENGINE_DIST"
  [ -d "$CEF_DIST" ] || CEF_DIST="$("$here/scripts/engine.sh" fetch)"
fi
# CEF_ROOT installs elsewhere than vendor/cef (build against it with NN_CEF_ROOT=<dir>
# on the xcodebuild command line; see NetnyahooCEF.podspec).
root="${CEF_ROOT:-$vendor/cef}"

mkdir -p "$vendor"
# Copied, so the distribution can be rebuilt without touching the app's copy.
[ -f "$CEF_DIST/include/cef_version.h" ] || { echo "error: CEF_DIST=$CEF_DIST is not a CEF binary distribution" >&2; exit 1; }
dist_id="local:$(basename "$CEF_DIST"):$(stat -f %m "$CEF_DIST/Release/Chromium Embedded Framework.framework/Chromium Embedded Framework")"
if [ ! -f "$root/.version" ] || [ "$(cat "$root/.version")" != "$dist_id" ]; then
  echo "Using CEF distribution $CEF_DIST"
  rm -rf "$root"
  rsync -a --exclude build "$CEF_DIST/" "$root/"
  echo "$dist_id" > "$root/.version"
fi
"$here/scripts/engine.sh" verify "$root" >/dev/null 2>&1 ||
  echo "warning: building against an engine other than the pinned one; pin it (engine.sh pack) once main needs it" >&2

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

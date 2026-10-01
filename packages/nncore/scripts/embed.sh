#!/bin/bash
# Xcode build phase (apps/browser/macos-nncore): clones the staged NNCore framework (stage-framework.sh) into
# the app bundle. An APFS clone: instant, whatever its 500 MB.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
staged=${NNCORE_STAGE_DIR:-$repo/apps/browser/build-nncore/NNCoreFramework}/"Chromium Framework.framework"
frameworks="$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"
mkdir -p "$frameworks"
stamp="$DERIVED_FILE_DIR/nncore-embedded.stamp"
mkdir -p "$DERIVED_FILE_DIR"
if ! [[ -f "$stamp" && "$(cat "$stamp")" == "$(cat "$staged/../.stamp")" && -d "$frameworks/Chromium Framework.framework" ]]; then
  rm -rf "$frameworks/Chromium Framework.framework"
  cp -cR "$staged" "$frameworks/"
  cp "$staged/../.stamp" "$stamp"
fi

# The built-in content blocker (uBlock Origin Lite, fetched by packages/cef/scripts/setup.sh) → Resources/Extensions,
# with the fingerprint NNCoreContentBlocker.mm compares its writable copy with.
ubol="$repo/packages/cef/vendor/ubol/ext"
if [ -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ] && [ -f "$ubol/manifest.json" ]; then
  extensions="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Extensions"
  mkdir -p "$extensions"
  rsync -a --delete "$ubol/" "$extensions/ublock-lite/"
  (cd "$extensions/ublock-lite" && find . -type f ! -path './_metadata/*' -print0 | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1) > "$extensions/ublock-lite.fingerprint"
fi

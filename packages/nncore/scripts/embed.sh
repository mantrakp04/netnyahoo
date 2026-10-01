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
if [[ -f "$stamp" && "$(cat "$stamp")" == "$(cat "$staged/../.stamp")" && -d "$frameworks/Chromium Framework.framework" ]]; then
  exit 0
fi
rm -rf "$frameworks/Chromium Framework.framework"
cp -cR "$staged" "$frameworks/"
cp "$staged/../.stamp" "$stamp"

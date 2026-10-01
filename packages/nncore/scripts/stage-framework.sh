#!/bin/bash
# Stages NNCore for the app target (apps/browser/macos-nncore): a copy of Chrome's framework built with
# engine/nncore, signed ad hoc with its helpers, in apps/browser/build-nncore/NNCoreFramework. The app links
# that copy and embed.sh clones it into the bundle. Copied only when the build's framework changed, and
# holding the chromium lock, so a framework being linked is never copied half-written.
#
#   NNCORE_FRAMEWORK=<path to Chromium Framework.framework>   another build than out/Release_GN_arm64
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
src=${NNCORE_FRAMEWORK:-$HOME/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64/Chromium Framework.framework}
dest=${NNCORE_STAGE_DIR:-$repo/apps/browser/build-nncore/NNCoreFramework}
name="Chromium Framework"

[[ -d "$src" ]] || { echo "error: no NNCore framework at $src (engine/nncore/apply.sh, then build chrome_framework)" >&2; exit 1; }
mkdir -p "$dest"
binary="$src/Versions/Current/$name"
stamp="$dest/.stamp"
current=$(stat -f '%m %z' "$binary")
if [[ -f "$stamp" && "$(cat "$stamp")" == "$current" && -d "$dest/$name.framework" ]]; then
  exit 0
fi
echo "staging $src"
"$repo/scripts/agent/locked" chromium --wait 500 -- sh -c 'rm -rf "$1/$3.framework.new" && cp -cR "$2" "$1/$3.framework.new"' _ "$dest" "$src" "$name"
rm -rf "$dest/$name.framework"
mv "$dest/$name.framework.new" "$dest/$name.framework"

# Ad hoc, without the hardened runtime (a development build; release signing is docs/nncore-spike.md's).
sign() { codesign --force --timestamp=none --sign - "$@"; }
fwv=$(cd "$dest/$name.framework/Versions/Current" && pwd -P)
for lib in "$fwv"/Libraries/*.dylib; do [[ -e "$lib" ]] && sign "$lib"; done
for helper in "$fwv"/Helpers/*.app "$fwv"/Helpers/chrome_crashpad_handler "$fwv"/Helpers/app_mode_loader "$fwv"/Helpers/web_app_shortcut_copier; do
  [[ -e "$helper" ]] && sign "$helper"
done
sign "$dest/$name.framework"
echo "$current" > "$stamp"

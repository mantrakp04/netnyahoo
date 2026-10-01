#!/usr/bin/env bash
# Developer ID signing of a NNCore Release app, inside out, with the hardened runtime (a dry run until the switch):
#   packages/nncore/scripts/sign.sh <copy of NetnyahooNNCore.app>     (signs in place)
# Helpers get packages/cef/helper's entitlements (JIT for the renderer and GPU); the app gets the CEF app's minus the
# keychain access groups, which need a provisioning profile for the bundle id. Notarize the result with notarytool
# (scripts/.notary.env), as scripts/release.sh does.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
helper_ents="$here/../../cef/helper"
app="$1"
id="Developer ID Application: mantra patel (U5L5T3NGVV)"
sign() { codesign --force --options runtime --timestamp --sign "$id" "$@"; }
fw="$app/Contents/Frameworks/Chromium Framework.framework"
helpers="$fw/Versions/Current/Helpers"
for h in "$helpers"/*.app; do
  case "$(basename "$h")" in
    *"(Renderer)"*) sign --entitlements "$helper_ents/renderer.entitlements" "$h" ;;
    *"(GPU)"*) sign --entitlements "$helper_ents/gpu.entitlements" "$h" ;;
    *"(Plugin)"*) sign --entitlements "$helper_ents/plugin.entitlements" "$h" ;;
    *) sign "$h" ;;
  esac
done
for x in chrome_crashpad_handler app_mode_loader web_app_shortcut_copier; do [ -e "$helpers/$x" ] && sign "$helpers/$x"; done
find -H "$fw/Versions/Current/" -name "*.dylib" -type f -print0 | while IFS= read -r -d '' lib; do sign "$lib"; done
sign "$fw"
# Sparkle's nested apps and XPC services, then the frameworks.
if [ -d "$app/Contents/Frameworks/Sparkle.framework" ]; then
  sp="$app/Contents/Frameworks/Sparkle.framework/Versions/Current"
  for n in "$sp"/XPCServices/*.xpc "$sp"/Updater.app "$sp"/Autoupdate; do [ -e "$n" ] && sign "$n"; done
  sign "$app/Contents/Frameworks/Sparkle.framework"
fi
for f in "$app"/Contents/Frameworks/*.framework; do
  case "$(basename "$f")" in "Chromium Framework.framework"|Sparkle.framework) ;; *) sign "$f" ;; esac
done
find "$app/Contents/Frameworks" -maxdepth 1 -name "*.dylib" -print0 | while IFS= read -r -d '' lib; do sign "$lib"; done
sign --entitlements "$here/signing/app.entitlements" "$app"
codesign --verify --deep --strict --verbose=2 "$app"
spctl -a -vvv -t exec "$app" || true

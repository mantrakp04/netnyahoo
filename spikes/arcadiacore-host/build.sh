#!/usr/bin/env bash
# Builds ACHost.app: the spike host linked against ArcadiaCore (Chrome's framework built with
# engine/arcadiacore, see engine/arcadiacore/apply.sh), signed ad hoc with the hardened runtime and
# Chrome's own entitlements for the app and its helpers.
#
#   spikes/arcadiacore-host/build.sh [out dir]      (default: ./build next to this script)
#
# A Developer ID build differs only in the identity (and drops disable-library-validation,
# which ad-hoc signatures need because they carry no team id); see docs/arcadiacore-spike.md.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
out=${1:-$here/build}
chromium_out=${CHROMIUM_OUT:-$HOME/chromium-build/chromium_git/chromium/src/out/Release_GN_arm64}
chrome_app=${CHROME_APP_SRC:-$HOME/chromium-build/chromium_git/chromium/src/chrome/app}
fw_name="Chromium Framework"
fw_src="$chromium_out/$fw_name.framework"
identity=${ACHOST_SIGN_IDENTITY:--}

app="$out/ACHost.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Frameworks"

# The framework (an APFS clone: instant, and signing it never touches the build's copy).
cp -cR "$fw_src" "$app/Contents/Frameworks/"
version=$(ls "$app/Contents/Frameworks/$fw_name.framework/Versions" | grep -v Current)

xcrun clang++ -std=c++20 -O2 -arch arm64 -mmacosx-version-min=13.0 -fobjc-arc \
  -I"$repo/engine/arcadiacore/src/arcadia/core/public" \
  "$here/main.mm" \
  "$app/Contents/Frameworks/$fw_name.framework/Versions/$version/$fw_name" \
  -framework AppKit -framework Carbon \
  -o "$app/Contents/MacOS/ACHost"

cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>ACHost</string>
  <key>CFBundleIdentifier</key><string>dev.arcadia.arcadiacore-host</string>
  <key>CFBundleName</key><string>ACHost</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSBackgroundOnly</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict></plist>
PLIST

# Entitlements: Chrome's, plus disable-library-validation for ad-hoc signatures.
ents="$out/entitlements"
mkdir -p "$ents"
dlv() {
  /usr/libexec/PlistBuddy -c "Add :com.apple.security.cs.disable-library-validation bool true" "$1" >/dev/null 2>&1 || true
}
cp "$chrome_app/app-entitlements.plist" "$ents/app.plist"
cp "$chrome_app/helper-renderer-entitlements.plist" "$ents/renderer.plist"
cp "$chrome_app/helper-gpu-entitlements.plist" "$ents/gpu.plist"
printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict/></plist>\n' > "$ents/helper.plist"
if [[ "$identity" == "-" ]]; then
  for f in "$ents"/*.plist; do dlv "$f"; done
fi

sign() { codesign --force --timestamp=none --options runtime --sign "$identity" "$@"; }
fwv="$app/Contents/Frameworks/$fw_name.framework/Versions/$version"
for lib in "$fwv"/Libraries/*.dylib; do sign "$lib"; done
for helper in "$fwv"/Helpers/*.app "$fwv"/Helpers/chrome_crashpad_handler "$fwv"/Helpers/app_mode_loader "$fwv"/Helpers/web_app_shortcut_copier; do
  [[ -e "$helper" ]] || continue
  case "$helper" in
    *"(Renderer).app" | *"(Aperitif Renderer).app") sign --entitlements "$ents/renderer.plist" "$helper" ;;
    *"(GPU).app" | *"(Aperitif GPU).app") sign --entitlements "$ents/gpu.plist" "$helper" ;;
    *) sign --entitlements "$ents/helper.plist" "$helper" ;;
  esac
done
sign "$app/Contents/Frameworks/$fw_name.framework"
sign --entitlements "$ents/app.plist" "$app"
codesign --verify --deep --strict "$app"
echo "built $app ($version, $(du -sh "$app" | cut -f1))"

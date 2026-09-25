#!/usr/bin/env bash
# Xcode "Run Script" phase for the app target: copies the Chromium Embedded
# Framework into the bundle and builds/signs the helper apps CEF launches for
# its child processes ("<App> Helper.app", "(GPU)", "(Renderer)", "(Plugin)", "(Alerts)").
set -euo pipefail

pkg="$(cd "$(dirname "$0")/.." && pwd)"
# NN_CEF_ROOT (an xcodebuild setting) selects another CEF install than vendor/cef.
cef="${NN_CEF_ROOT:-$pkg/vendor/cef}"
if [ ! -f "$cef/build/libcef_dll_wrapper/libcef_dll_wrapper.a" ]; then
  echo "error: CEF isn't set up. Run packages/cef/scripts/setup.sh" >&2
  exit 1
fi

app_name="${PRODUCT_NAME:-Netnyahoo}"
bundle_id="${PRODUCT_BUNDLE_IDENTIFIER:-com.netnyahoo.browser}"
frameworks="$TARGET_BUILD_DIR/$FRAMEWORKS_FOLDER_PATH"
work="${DERIVED_FILE_DIR:-$pkg/vendor/build}/cef-helper"
identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
[ -z "$identity" ] && identity="-"
# Team-signed builds get the hardened runtime, with Chrome's per-helper entitlements
# (helper/*.entitlements); Developer ID ones also a secure timestamp (notarization).
# Ad-hoc builds stay plain: library validation would reject ad-hoc code.
sign=(codesign --force --sign "$identity")
if [ "$identity" != "-" ]; then
  sign+=(--options runtime)
  case "${EXPANDED_CODE_SIGN_IDENTITY_NAME:-}" in
    "Developer ID"*) sign+=(--timestamp) ;;
    *) sign+=(--timestamp=none) ;;
  esac
fi
mkdir -p "$frameworks" "$work"

# 1. Helper executable (rebuilt when its sources or the wrapper change).
helper_bin="$work/helper"
js="$pkg/helper/page_script.js"
hdr="$work/page_script.h"
if [ ! -f "$hdr" ] || [ "$js" -nt "$hdr" ]; then
  { echo 'static const char kPageScript[] = R"NNJS('; cat "$js"; echo ')NNJS";'; } > "$hdr"
fi
if [ ! -f "$helper_bin" ] || [ "$pkg/helper/helper_main.mm" -nt "$helper_bin" ] || [ "$hdr" -nt "$helper_bin" ] \
   || [ "$cef/build/libcef_dll_wrapper/libcef_dll_wrapper.a" -nt "$helper_bin" ]; then
  echo "Building CEF helper"
  xcrun clang++ -std=c++20 -O2 -DNDEBUG -arch arm64 -mmacosx-version-min=14.0 \
    -I"$cef" -I"$work" "$pkg/helper/helper_main.mm" \
    "$cef/build/libcef_dll_wrapper/libcef_dll_wrapper.a" \
    -framework AppKit -o "$helper_bin"
fi

# 2. The framework itself. CEF ships a flat bundle; Xcode's embedded-binary
# validation (and codesign) want the standard versioned macOS layout.
src="$cef/Release/Chromium Embedded Framework.framework"
fw="$frameworks/Chromium Embedded Framework.framework"
mkdir -p "$fw/Versions/A"
rsync -a --delete "$src/" "$fw/Versions/A/"
ln -sfn A "$fw/Versions/Current"
for item in "Chromium Embedded Framework" Libraries Resources; do
  ln -sfn "Versions/Current/$item" "$fw/$item"
done
for lib in "$fw/Versions/A/Libraries/"*.dylib; do "${sign[@]}" "$lib"; done
"${sign[@]}" "$fw/Versions/A"

# 3. Helper app bundles.
make_helper() {
  local suffix="$1" id_suffix="$2" entitlements="${3:+$pkg/helper/$3.entitlements}"
  local name="$app_name Helper$suffix"
  local dir="$frameworks/$name.app"
  mkdir -p "$dir/Contents/MacOS"
  cp "$helper_bin" "$dir/Contents/MacOS/$name"
  cat > "$dir/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>$name</string>
  <key>CFBundleExecutable</key><string>$name</string>
  <key>CFBundleIdentifier</key><string>$bundle_id.helper$id_suffix</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$name</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSEnvironment</key><dict><key>MallocNanoZone</key><string>0</string></dict>
  <key>LSFileQuarantineEnabled</key><true/>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><string>1</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
PLIST
  if [ "$identity" != "-" ] && [ -n "$entitlements" ]; then
    "${sign[@]}" --entitlements "$entitlements" "$dir"
  else
    "${sign[@]}" "$dir"
  fi
}
make_helper "" ""
make_helper " (GPU)" ".gpu" gpu
make_helper " (Renderer)" ".renderer" renderer
make_helper " (Plugin)" ".plugin" plugin
make_helper " (Alerts)" ".alerts"
# 4. Built-in extensions (fetched by setup.sh) → Resources/Extensions.
if [ -n "${UNLOCALIZED_RESOURCES_FOLDER_PATH:-}" ]; then
  extensions="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Extensions"
  if [ -f "$pkg/vendor/ubol/ext/manifest.json" ]; then
    mkdir -p "$extensions"
    rsync -a --delete "$pkg/vendor/ubol/ext/" "$extensions/ublock-lite/"
  else
    echo "warning: no uBlock Origin Lite in vendor/ubol (run packages/cef/scripts/setup.sh); ad blocking will be off" >&2
  fi
fi
echo "Embedded CEF into $frameworks"

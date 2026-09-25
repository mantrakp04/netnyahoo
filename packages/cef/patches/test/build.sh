#!/usr/bin/env bash
# Builds tests/build/nativehost.app against a CEF binary distribution (default: ours).
set -euo pipefail
cd "$(dirname "$0")"
CEF="${CEF:-$(ls -d ~/chromium-build/distrib/cef_binary_*_minimal | tail -1)}"
WRAP="$CEF/build/libcef_dll_wrapper/libcef_dll_wrapper.a"
if [ ! -f "$WRAP" ]; then
  cmake -S "$CEF" -B "$CEF/build" -G Ninja -DPROJECT_ARCH=arm64 -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0 >/dev/null
  cmake --build "$CEF/build" --target libcef_dll_wrapper
fi
FLAGS=(-std=c++20 -O2 -DNDEBUG -arch arm64 -mmacosx-version-min=14.0 -fobjc-arc -I"$CEF")
APP=build/nativehost.app/Contents
rm -rf build/nativehost.app; mkdir -p "$APP/MacOS" "$APP/Frameworks"
xcrun clang++ "${FLAGS[@]}" nativehost.mm "$WRAP" -framework AppKit -framework QuartzCore -o "$APP/MacOS/nativehost"
xcrun clang++ "${FLAGS[@]}" helper.mm "$WRAP" -framework AppKit -o build/helper
ln -sfn "$CEF/Release/Chromium Embedded Framework.framework" "$APP/Frameworks/Chromium Embedded Framework.framework"
plist() { cat <<PL
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>$1</string><key>CFBundleIdentifier</key><string>$2</string>
<key>CFBundleName</key><string>$1</string><key>CFBundlePackageType</key><string>APPL</string><key>NSPrincipalClass</key><string>TestApp</string>
<key>LSUIElement</key><true/><key>LSBackgroundOnly</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>
PL
}
plist nativehost dev.netnyahoo.nativehost > "$APP/Info.plist"
for suffix in "" " (GPU)" " (Renderer)" " (Plugin)" " (Alerts)"; do
  d="$APP/Frameworks/nativehost Helper$suffix.app/Contents"
  mkdir -p "$d/MacOS"
  cp build/helper "$d/MacOS/nativehost Helper$suffix"
  plist "nativehost Helper$suffix" dev.netnyahoo.nativehost.helper > "$d/Info.plist"
done
codesign --force --deep --sign - build/nativehost.app 2>/dev/null || true
echo built

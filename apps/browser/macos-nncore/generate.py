#!/usr/bin/env python3
"""Writes NetnyahooNNCore.xcodeproj (and Info.plist) from the CEF build's project, apps/browser/macos.

The NNCore app is the same app (same sources, assets, Expo and React Native build phases) with three
differences: its own main.swift (Chromium runs the process, NNCoreHost), NNCore's framework staged, linked
and embedded instead of CEF's (packages/nncore/scripts), and no dock tile or Sparkle (a dev build).
Run it again after changing apps/browser/macos/Netnyahoo.xcodeproj, then `pod install` here.
"""
import os
import plistlib
import re

here = os.path.dirname(os.path.abspath(__file__))
src_proj = os.path.join(here, "..", "macos", "Netnyahoo.xcodeproj")
dst_proj = os.path.join(here, "NetnyahooNNCore.xcodeproj")

s = open(os.path.join(src_proj, "project.pbxproj")).read()

def sub(old, new, count=1):
    global s
    assert s.count(old) >= count, f"not found: {old!r}"
    s = s.replace(old, new) if count == 0 else s.replace(old, new)

# Pods integration is per target; pod install regenerates it for this one.
s = s.replace("Pods-Netnyahoo-macOS", "Pods-Netnyahoo-NNCore")

# Sources: the CEF app's folder, except main.swift (this folder's).
sub('path = "Netnyahoo-macOS";\n\t\t\tsourceTree = "<group>";', 'path = "../macos/Netnyahoo-macOS";\n\t\t\tsourceTree = "<group>";')
sub('/* main.swift */ = {isa = PBXFileReference; includeInIndex = 1; lastKnownFileType = sourcecode.swift; path = main.swift; sourceTree = "<group>"; };',
    '/* main.swift */ = {isa = PBXFileReference; includeInIndex = 1; lastKnownFileType = sourcecode.swift; path = main.swift; sourceTree = SOURCE_ROOT; };')
sub('"$(SRCROOT)/Netnyahoo-macOS/Netnyahoo.entitlements"', '"$(SRCROOT)/../macos/Netnyahoo-macOS/Netnyahoo.entitlements"')

# The target and its product.
s = re.sub(r'(isa = PBXNativeTarget;.*?name = )"Netnyahoo-macOS";(\s*productName = )Netnyahoo;',
           r'\1"Netnyahoo-NNCore";\2NetnyahooNNCore;', s, flags=re.S)
sub("/* Netnyahoo.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Netnyahoo.app;",
    "/* NetnyahooNNCore.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = NetnyahooNNCore.app;")

# Build settings of the app target (Debug and Release).
for old, new in [
    ('CODE_SIGN_ENTITLEMENTS = "Netnyahoo-macOS/Netnyahoo.entitlements";', 'CODE_SIGN_ENTITLEMENTS = "";'),
    ('CODE_SIGN_IDENTITY = "Apple Development";', 'CODE_SIGN_IDENTITY = "-";'),
    ('CODE_SIGN_STYLE = Automatic;', 'CODE_SIGN_STYLE = Manual;'),
    ('DEVELOPMENT_TEAM = U5L5T3NGVV;', 'DEVELOPMENT_TEAM = "";'),
    ('ENABLE_HARDENED_RUNTIME = YES;', 'ENABLE_HARDENED_RUNTIME = NO;'),
    ('INFOPLIST_FILE = "Netnyahoo-macOS/Info.plist";', 'INFOPLIST_FILE = Info.plist;'),
    ('PRODUCT_BUNDLE_IDENTIFIER = com.netnyahoo.browser;', 'PRODUCT_BUNDLE_IDENTIFIER = com.netnyahoo.browser.nncore;'),
    # The app's Swift module keeps the CEF app's name: "NetnyahooNNCore" is the pod's (packages/nncore).
    ('PRODUCT_NAME = Netnyahoo;', 'PRODUCT_MODULE_NAME = Netnyahoo;\n\t\t\t\tPRODUCT_NAME = NetnyahooNNCore;'),
    ('\t\t\t\t\t"-lc++",\n', '\t\t\t\t\t"-lc++",\n\t\t\t\t\t"\\"$(SRCROOT)/../build-nncore/NNCoreFramework/Chromium Framework.framework/Chromium Framework\\"",\n'),
]:
    assert s.count(old) == 2, f"expected Debug+Release: {old!r}"
    s = s.replace(old, new)

# Build phases: CEF's embed and the dock tile become NNCore's stage (first) and embed (last).
stage, embed = "C3F0EB5E2E9A4B1D00CEF001", "D0C71E5E2E9A4B1D00D0C001"
sub(f"\t\t\t\t{stage} /* Embed Chromium Embedded Framework */,\n", "")
sub(f"\t\t\t\t{embed} /* Build Dock Tile Plug-in */,\n", f"\t\t\t\t{embed} /* Embed NNCore framework */,\n")
sub("\t\t\t\t514201452437B4B30078DB4F /* Sources */,\n", f"\t\t\t\t{stage} /* Stage NNCore framework */,\n\t\t\t\t514201452437B4B30078DB4F /* Sources */,\n")
s = re.sub(rf'{stage} /\* Embed Chromium Embedded Framework \*/ = \{{(.*?)name = "Embed Chromium Embedded Framework";(.*?)shellScript = "(?:[^"\\]|\\.)*";',
           lambda m: f'{stage} /* Stage NNCore framework */ = {{{m.group(1)}name = "Stage NNCore framework";{m.group(2)}'
                     'shellScript = "\\"$PROJECT_DIR/../../../packages/nncore/scripts/stage-framework.sh\\"\\n";', s, flags=re.S)
# Its output, so the link (Frameworks) is ordered after it.
s = re.sub(rf'({stage} /\* Stage NNCore framework \*/ = \{{.*?outputPaths = \()(\s*\);)',
           r'\1\n\t\t\t\t"$(SRCROOT)/../build-nncore/NNCoreFramework/.stamp",\2', s, count=1, flags=re.S)
s = re.sub(rf'{embed} /\* Build Dock Tile Plug-in \*/ = \{{(.*?)name = "Build Dock Tile Plug-in";(.*?)shellScript = "(?:[^"\\]|\\.)*";',
           lambda m: f'{embed} /* Embed NNCore framework */ = {{{m.group(1)}name = "Embed NNCore framework";{m.group(2)}'
                     'shellScript = "\\"$PROJECT_DIR/../../../packages/nncore/scripts/embed.sh\\"\\n";', s, flags=re.S)
assert "stage-framework.sh" in s and "nncore/scripts/embed.sh" in s and "cef/scripts/embed.sh" not in s

os.makedirs(os.path.join(dst_proj, "xcshareddata", "xcschemes"), exist_ok=True)
open(os.path.join(dst_proj, "project.pbxproj"), "w").write(s)

scheme = open(os.path.join(src_proj, "xcshareddata", "xcschemes", "Netnyahoo-macOS.xcscheme")).read()
scheme = (scheme.replace('BuildableName = "Netnyahoo.app"', 'BuildableName = "NetnyahooNNCore.app"')
                .replace('BlueprintName = "Netnyahoo-macOS"', 'BlueprintName = "Netnyahoo-NNCore"')
                .replace("container:Netnyahoo.xcodeproj", "container:NetnyahooNNCore.xcodeproj"))
open(os.path.join(dst_proj, "xcshareddata", "xcschemes", "Netnyahoo-NNCore.xcscheme"), "w").write(scheme)

# Info.plist: the app's, as a dev build on Chrome's NSApplication, without the dock tile and updates.
with open(os.path.join(here, "..", "macos", "Netnyahoo-macOS", "Info.plist"), "rb") as f:
    info = plistlib.load(f)
info["NSPrincipalClass"] = "BrowserCrApplication"
info["CFBundleDisplayName"] = "Netnyahoo NNCore"
for key in [k for k in info if k.startswith("SU") or k == "NSDockTilePlugIn"]:
    del info[key]
info["SUEnableAutomaticChecks"] = False
with open(os.path.join(here, "Info.plist"), "wb") as f:
    plistlib.dump(info, f)
print("wrote", dst_proj)

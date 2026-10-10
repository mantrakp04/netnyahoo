#!/usr/bin/env bash
# Builds a release (docs/releasing.md):
#   scripts/release.sh <version>          dist/<version>/: what gets published
#   scripts/release.sh <version> --rc     dist/<version>-rc/: a candidate from the working tree, never published
#   scripts/release.sh <version> --phased <seconds>
#                                         the appcast's item carries <sparkle:phasedRolloutInterval>: Sparkle offers the
#                                         update to 1/7 of the copies that check every <seconds>, a seventh more each
#                                         time (the whole release takes 7 x <seconds>; 86400 is a week). A copy picks its
#                                         place at random on its own Mac: no ID, no server state. Users who press
#                                         Check for Updates… get it at once. Off by default (everyone, at once).
#
# Archives the Release configuration of apps/browser/macos (arm64), exports it with Developer ID, signs Chrome's
# framework inside out the way Chrome signs its own (chrome/installer/mac/signing/parts.py), checks the signatures and
# what an in-place update from an earlier copy depends on, launches the app once hidden and checks its bundle is still
# sealed, notarizes and staples the app and the DMG, and writes Netnyahoo-<version>.dmg, Netnyahoo-<version>.zip
# (Sparkle's update archive), appcast.xml (signed with the Sparkle EdDSA key in the login keychain) and
# release-notes.md (the GitHub release's notes, from docs/release-notes/<version>.md). When engine/ changed since the
# last prebuilt engine, also NNCore-<engine tree>.tar.xz and its line for packages/nncore/prebuilt-engines.tsv
# (prebuilt-engine.tsv), so the app builds without a Chromium tree (packages/nncore/scripts/fetch-engine.sh).
#
# A release needs the notes file, MARKETING_VERSION set to <version> (and CURRENT_PROJECT_VERSION bumped) and a
# clean tree under apps/browser, packages, engine and scripts/dmg. A candidate needs none of those: it builds the working tree as
# <version> with the next build number, and uses the notes file if there is one.
#
# NOTARY_PROFILE      notarytool keychain profile (default netnyahoo), unless scripts/.notary.env sets an API key
# ALLOW_UNNOTARIZED=1 build anyway without notarizing
# SPARKLE_ACCOUNT     keychain account of the Sparkle key (default netnyahoo)
# NNCORE_FRAMEWORK    another Chromium Framework.framework than out/Release_GN_arm64's
# RELEASE_BUILD_DIR   the derived data folder (default apps/browser/build-release)
set -euo pipefail

version="${1:?usage: scripts/release.sh <version> [--rc] [--phased <seconds>]}"
shift
rc=0
phased=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rc) rc=1 ;;
    --phased)
      phased="${2:-}"
      shift
      case "$phased" in '' | *[!0-9]* | 0) echo "error: --phased takes whole seconds (86400 is a day), got '$phased'" >&2; exit 1 ;; esac
      ;;
    *) echo "error: unknown option $1 (usage: scripts/release.sh <version> [--rc] [--phased <seconds>])" >&2; exit 1 ;;
  esac
  shift
done
[ "$rc" = 1 ] && [ -n "$phased" ] && { echo "error: a candidate is never published, so --phased doesn't apply to --rc" >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd -P)"
app_dir="$root/apps/browser"
macos="$app_dir/macos"
nncore="$root/packages/nncore"
repo="mantrakp04/netnyahoo"
notes_page="https://netnyahoo.com/release-notes"
notary_profile="${NOTARY_PROFILE:-netnyahoo}"
# App Store Connect API key for notarytool, when scripts/.notary.env (untracked) sets NOTARY_KEY (path to
# AuthKey_<id>.p8), NOTARY_KEY_ID and NOTARY_ISSUER. Preferred over the keychain profile: notarytool keeps that
# profile in the data-protection keychain, which reads as missing while the Mac's screen is locked.
[ -f "$root/scripts/.notary.env" ] && . "$root/scripts/.notary.env"
if [ -n "${NOTARY_KEY:-}" ]; then
  notary_auth=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  notary_auth=(--keychain-profile "$notary_profile")
fi
sparkle_account="${SPARKLE_ACCOUNT:-netnyahoo}"
sparkle="$macos/Pods/Sparkle/bin"
if [ "$rc" = 1 ]; then dist="$root/dist/$version-rc"; else dist="$root/dist/$version"; fi
# A candidate can go elsewhere (RC_DIST=dist/final-<version>-rc; keep the -rc ending, unregister-builds keeps those registered) while a copy of the last one is still open from its folder.
[ "$rc" = 1 ] && [ -n "${RC_DIST:-}" ] && dist="$(cd "$root" && mkdir -p "$RC_DIST" && cd "$RC_DIST" && pwd)"
build="${RELEASE_BUILD_DIR:-$app_dir/build-release}"
archive="$dist/Netnyahoo.xcarchive"
app="$dist/export/Netnyahoo.app"
zip="$dist/Netnyahoo-$version.zip"
dmg="$dist/Netnyahoo-$version.dmg"
chromium_src="${CHROMIUM_SRC:-$HOME/chromium-build/chromium_git/chromium/src}"
framework_src="${NNCORE_FRAMEWORK:-$chromium_src/out/Release_GN_arm64/Chromium Framework.framework}"
die() { echo "error: $*" >&2; exit 1; }

# The version ships from the tagged commit: bump it in the project first. A candidate is <version> with the next
# build number, so it sorts after the published release in Sparkle.
pbx="$macos/Netnyahoo.xcodeproj/project.pbxproj"
project_version="$(sed -n 's/.*MARKETING_VERSION = \(.*\);/\1/p' "$pbx" | sort -u)"
project_build="$(sed -n 's/.*CURRENT_PROJECT_VERSION = \(.*\);/\1/p' "$pbx" | sort -u)"
version_settings=()
if [ "$rc" = 1 ]; then
  [ "$project_version" = "$version" ] || version_settings=(MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$((project_build + 1))")
elif [ "$project_version" != "$version" ]; then
  die "MARKETING_VERSION is '$project_version'. Set it to $version (and bump CURRENT_PROJECT_VERSION) first."
fi

# Written before the build (docs/release-notes/README.md): the website, the GitHub release and the update dialog
# all show it.
notes="$root/docs/release-notes/$version.md"
if [ -f "$notes" ]; then
  frontmatter() { awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' "$notes"; }
  notes_body() { awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { inside = 0; next } !inside' "$notes" | sed '/./,$!d'; }
  meta="$(frontmatter)"
  headline="$(sed -n 's/^headline: *//p' <<< "$meta")"
  grep -Eq '^date: *[0-9]{4}-[0-9]{2}-[0-9]{2} *$' <<< "$meta" && [ -n "$headline" ] \
    || die "$notes needs 'date: YYYY-MM-DD' and 'headline:' frontmatter"
elif [ "$rc" = 1 ]; then
  headline="Release candidate $version"
  notes_body() { echo "A release candidate of Netnyahoo $version. Not published."; }
else
  die "no release notes: write docs/release-notes/$version.md first"
fi

# A release ships a commit: anything uncommitted in the app's sources or the disk image's window would ship with it
# (another agent's work in progress, say). A candidate builds the working tree and records what it included.
dirty="$(git -C "$root" status --porcelain -- apps/browser packages engine scripts/dmg | grep -v ' apps/browser/build' || true)"
if [ -n "$dirty" ]; then
  [ "$rc" = 1 ] || { echo "$dirty" >&2; die "uncommitted changes under apps/browser, packages, engine or scripts/dmg (above)"; }
  echo "warning: the candidate includes uncommitted changes:" >&2
  echo "$dirty" >&2
fi

# The engine must be built from this checkout's own Chromium code, NNCore's (engine/nncore) and the services it calls
# (engine/chromium): each apply.sh puts its copy in the tree and gives a changed file a new mtime, so a framework older
# than the tree's copy is stale. (The patches in engine/patches aren't checked here: they change only at a rebuild.)
[ -d "$framework_src" ] || die "no NNCore framework at $framework_src (engine/nncore/apply.sh, then build chrome_framework)"
if [ -z "${NNCORE_FRAMEWORK:-}" ]; then
  for layer in nncore chromium; do
    "$root/engine/$layer/apply.sh" --check \
      || die "the Chromium tree differs from engine/$layer: run engine/$layer/apply.sh and rebuild chrome_framework"
  done
  newest="$(find "$chromium_src/netnyahoo" "$chromium_src/chrome/browser/netnyahoo" -type f \
    -newer "$framework_src/Versions/Current/Chromium Framework" -print -quit)"
  [ -z "$newest" ] || die "$newest is newer than the framework: rebuild chrome_framework (docs/nncore-spike.md)"
fi

identity_name="Developer ID Application"
identity="$(security find-identity -v -p codesigning | awk -v n="$identity_name" 'index($0, n) { print $2; exit }')"
[ -n "$identity" ] || die "no $identity_name identity"
notarize=0
if xcrun notarytool history "${notary_auth[@]}" >/dev/null 2>&1; then
  notarize=1
elif [ "${ALLOW_UNNOTARIZED:-0}" = 1 ]; then
  echo "warning: no notarytool credentials; the build won't be notarized" >&2
else
  # Releases are notarized since 0.2.1: an unnotarized one makes every new user go through System Settings › Open
  # Anyway again. Store the credentials (docs/releasing.md) or set ALLOW_UNNOTARIZED=1.
  echo "error: notarytool credentials are missing or invalid (scripts/.notary.env or the '$notary_profile' profile):" >&2
  xcrun notarytool history "${notary_auth[@]}" 2>&1 | head -2 >&2
  exit 1
fi

rm -rf "$dist"
mkdir -p "$dist"
{
  echo "version $version${version_settings:+ (${version_settings[*]})}"
  echo "commit $(git -C "$root" rev-parse HEAD)${dirty:+ + uncommitted changes}"
  echo "framework $(plutil -extract SCMRevision raw "$framework_src/Versions/Current/Resources/Info.plist" 2>/dev/null)"
  echo "framework built $(stat -f '%Sm' "$framework_src/Versions/Current/Chromium Framework")"
} > "$dist/provenance.txt"

echo "==> Content blocker"
# The pinned uBlock Origin Lite, which embed.sh copies into the app.
"$nncore/scripts/ubol.sh"
[ -f "$nncore/vendor/ubol/ext/manifest.json" ] || die "uBlock Origin Lite isn't installed ($nncore/scripts/ubol.sh)"

echo "==> Archive"
# The engine is staged into this build's own folder, so a development build restaging its copy can't change a
# release mid-build. The pod lock too: a pod install rewriting Pods.xcodeproj under the archive breaks it.
(cd "$app_dir" && NNCORE_FRAMEWORK="$framework_src" "$root/scripts/agent/locked" pod --wait 1800 -- \
  "$root/scripts/agent/locked" xcodebuild --wait 1800 -- xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS \
  -configuration Release -destination 'generic/platform=macOS' ARCHS=arm64 NNCORE_STAGE_DIR="$build/NNCoreFramework" \
  ${version_settings[@]+"${version_settings[@]}"} \
  -derivedDataPath "$build" -archivePath "$archive" -allowProvisioningUpdates archive) \
  > "$dist/archive.log" 2>&1 || {
  # (Pods' old deployment targets print as errors too, but don't fail the build.)
  grep -E "error:|build commands failed" -A2 "$dist/archive.log" | grep -v MACOSX_DEPLOYMENT_TARGET | tail -20 >&2
  die "archive failed ($dist/archive.log)"
}

echo "==> Export (Developer ID)"
# Apple's timestamp server sometimes doesn't answer ("A timestamp was expected but was not found"); one miss among
# the dozens of pieces the export signs fails it, so retry that, and only that, a few times.
for attempt in 1 2 3 4 5 6; do
  rm -rf "$dist/export"
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$macos/ExportOptions-DeveloperID.plist" \
    -exportPath "$dist/export" -allowProvisioningUpdates > "$dist/export.log" 2>&1 && break
  grep -q "A timestamp was expected" "$dist/export.log" && [ "$attempt" -lt 6 ] \
    || { cat "$dist/export.log" >&2; exit 1; }
  echo "    no timestamp from Apple (attempt $attempt), exporting again"
  sleep 10
done

echo "==> Sign Chrome's framework"
# Xcode's export signs what it knows: the app (with the Developer ID profile its keychain groups need), Sparkle,
# hermes. Chrome's framework and its helpers are signed as Chrome signs them, inside out: the helpers under the
# hardened runtime, the renderer and GPU ones (Aperitif's too) with their JIT entitlements and without library
# validation (incompatible with JIT), then the framework, then the app again with what the export gave it.
entitlements_dir="$nncore/scripts/signing"
sign() {
  local attempt
  for attempt in 1 2 3 4 5; do
    codesign --force --timestamp --sign "$identity" "$@" && return 0
    echo "    signing failed (attempt $attempt), likely no timestamp from Apple; retrying" >&2
    sleep 5
  done
  die "couldn't sign ${*: -1}"
}
fw="$app/Contents/Frameworks/Chromium Framework.framework"
fwv="$(cd "$fw/Versions/Current" && pwd -P)" || die "no Chromium Framework.framework in the export"
# Local symbols out (40% of the framework's bytes, which a new copy's first-launch Gatekeeper scan reads); the
# unstripped files stay in dist/<version>/symbols for symbolicating crash reports. Keep that folder with the release.
"$nncore/scripts/strip-engine.sh" "$app" "$dist/symbols"
for lib in "$fwv"/Libraries/*.dylib; do sign "$lib"; done
for helper in "$fwv"/Helpers/*.app; do
  case "$(basename "$helper")" in
    *"Renderer).app") sign --options restrict,kill,runtime --entitlements "$entitlements_dir/renderer.entitlements" "$helper" ;;
    *"GPU).app") sign --options restrict,kill,runtime --entitlements "$entitlements_dir/gpu.entitlements" "$helper" ;;
    *) sign --options restrict,library,kill,runtime "$helper" ;;
  esac
done
sign --options restrict,library,kill,runtime "$fwv/Helpers/chrome_crashpad_handler"
sign --options restrict,library,kill,runtime "$fwv/Helpers/app_mode_loader"
[ -e "$fwv/Helpers/web_app_shortcut_copier" ] && sign --options restrict,library,kill,runtime \
  --identifier com.netnyahoo.browser.web_app_shortcut_copier "$fwv/Helpers/web_app_shortcut_copier"
sign "$fw"
sign --preserve-metadata=entitlements,requirements,flags,runtime "$app"

echo "==> Verify"
codesign --verify --deep --strict "$app"
# Crash reports from users can only be symbolicated with the archive's dSYM (0.1.0/0.1.1 had none).
[ -d "$archive/dSYMs/Netnyahoo.app.dSYM" ] || die "the archive has no Netnyahoo.app.dSYM"
entitlements() { codesign -d --entitlements - --xml "$1" 2>/dev/null; }
info() { plutil -extract "$1" raw "$app/Contents/Info.plist" 2>/dev/null; }
# What an in-place update from an earlier copy depends on: the same bundle id and executable (Sparkle), the
# designated requirement (the keychain's Safe Storage item, TCC's grants), the feed and the update key.
[ "$(info CFBundleIdentifier)" = com.netnyahoo.browser ] || die "bundle id is $(info CFBundleIdentifier)"
[ "$(info CFBundleExecutable)" = Netnyahoo ] || die "executable is $(info CFBundleExecutable)"
[ "$(info CFBundleShortVersionString)" = "$version" ] || die "CFBundleShortVersionString is $(info CFBundleShortVersionString)"
for key in SUFeedURL SUPublicEDKey NSDockTilePlugIn NSCameraUsageDescription NSMicrophoneUsageDescription \
  NSBluetoothAlwaysUsageDescription NSLocationUsageDescription NSLocalNetworkUsageDescription; do
  [ -n "$(info "$key")" ] || die "Info.plist has no $key"
done
[ -d "$app/Contents/Frameworks/Sparkle.framework" ] || die "no Sparkle.framework"
[ -d "$app/Contents/PlugIns/NetnyahooDockTile.plugin" ] || die "no dock tile plug-in"
[ -f "$app/Contents/embedded.provisionprofile" ] || die "no Developer ID provisioning profile (keychain groups need it)"
[ -f "$app/Contents/Resources/Extensions/ublock-lite/manifest.json" ] || die "no uBlock Origin Lite in the app"
designated="$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')"
[[ "$designated" == *'identifier "com.netnyahoo.browser"'* && "$designated" == *"subject.OU] = U5L5T3NGVV"* ]] \
  || die "designated requirement: $designated"
app_ents="$(entitlements "$app")"
for group in webauthn unexportable-keys secure-payment-confirmation; do
  [[ "$app_ents" == *"U5L5T3NGVV.com.netnyahoo.browser.$group"* ]] || die "the app lacks the keychain group …$group"
done
# Apple hasn't granted the managed passkey capability (Netnyahoo-ICloudPasskeys.entitlements).
[[ "$app_ents" != *web-browser.public-key-credential* ]] || die "the app is signed with com.apple.developer.web-browser.public-key-credential"
for helper in "$fwv"/Helpers/*"Renderer).app" "$fwv"/Helpers/*"GPU).app"; do
  [[ "$(entitlements "$helper")" == *cs.allow-jit* ]] || die "$(basename "$helper") lost allow-jit"
done
# Every piece of code: Developer ID, our team, a timestamp, no debugging entitlement.
while IFS= read -r -d '' code; do
  details="$(codesign -dvv "$code" 2>&1)"
  [[ "$details" == *"TeamIdentifier=U5L5T3NGVV"* && "$details" == *"Authority=Developer ID Application"* \
    && "$details" == *"Timestamp="* ]] || die "$code isn't Developer ID-signed with a timestamp"
  [[ "$(entitlements "$code")" != *get-task-allow* ]] || die "$code has get-task-allow"
done < <(find "$app" \( -name "*.app" -o -name "*.framework" -o -name "*.dylib" -o -name "*.xpc" -o -name "*.plugin" \
  -o -path "*/Helpers/*" -type f -perm -u+x -o -path "*/MacOS/*" -type f \) -print0)

# The engine for building without a Chromium tree (packages/nncore/scripts/fetch-engine.sh): this release's framework,
# stripped and signed, as NNCore-<engine tree>.tar.xz, unless an earlier release already has this engine/. Packed in
# the background while the launch check and notarization run; the release skill publishes it and the table line.
engine_tree="$(git -C "$root" rev-parse HEAD:engine)"
engine_archive="$dist/NNCore-${engine_tree:0:12}.tar.xz"
engine_pack=""
if [ "$rc" = 0 ] && [ -z "${NNCORE_FRAMEWORK:-}" ] \
  && ! awk -v t="$engine_tree" '$1 == t { found = 1 } END { exit !found }' "$nncore/prebuilt-engines.tsv"; then
  echo "==> Pack the engine (background)"
  (
    set -e
    if command -v xz >/dev/null; then
      tar --no-mac-metadata -cf - -C "$app/Contents/Frameworks" "Chromium Framework.framework" | xz -T0 -9 >"$engine_archive"
    else
      tar --no-mac-metadata -cJf "$engine_archive" -C "$app/Contents/Frameworks" "Chromium Framework.framework"
    fi
    printf '%s\t%s\t%s\n' "$engine_tree" "$version" "$(shasum -a 256 "$engine_archive" | awk '{ print $1 }')" \
      >"$dist/prebuilt-engine.tsv"
  ) >"$dist/engine-pack.log" 2>&1 &
  engine_pack=$!
fi

echo "==> Launch check"
# Running the app must leave its bundle as signed: anything written into it breaks the signature (Chrome indexing
# uBlock's rulesets next to the extension did, in 0.1.0). Launch it hidden with a throwaway data dir, wait for the
# rulesets to be indexed, quit, verify again.
check_data="$(mktemp -d "${TMPDIR:-/tmp}/nn-release.XXXXXX")"
before="$(pgrep -f "^$app/Contents/MacOS/Netnyahoo" | sort || true)"
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR="$check_data" "$app"
indexes="$check_data/Built-in Extensions/ublock-lite/_metadata/generated_indexed_rulesets"
for _ in $(seq 1 90); do
  [ "$(ls "$indexes" 2>/dev/null | wc -l)" -ge 6 ] && break
  sleep 1
done
sleep 5
# The instance this launched: the one started with our data dir (a copy of the same build the owner is running
# must never be the one quit or killed here).
pid=""
for p in $(pgrep -f "^$app/Contents/MacOS/Netnyahoo\$" || true); do
  ps -E -ww -o command= -p "$p" 2>/dev/null | grep -qF "NETNYAHOO_DATA_DIR=$check_data" && { pid="$p"; break; }
done
[ -n "$pid" ] || pid="$(comm -13 <(echo "$before") <(pgrep -f "^$app/Contents/MacOS/Netnyahoo" | sort || true) | head -1)"
[ -n "$pid" ] || die "the app didn't start (or quit)"
kill -TERM "$pid"
for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
kill -KILL "$pid" 2>/dev/null || true
codesign --verify --deep --strict "$app" || die "running the app changed its bundle"
[ "$(ls "$indexes" 2>/dev/null | wc -l)" -ge 6 ] || die "uBlock's rulesets weren't indexed in the data dir (90 s)"
rm -rf "$check_data"

notarize_file() {
  echo "Notarizing $(basename "$1")"
  xcrun notarytool submit "$1" "${notary_auth[@]}" --wait --timeout 1h | tee "$dist/notary-$(basename "$1").log"
  grep -q "status: Accepted" "$dist/notary-$(basename "$1").log" || die "notarization failed"
}
if [ "$notarize" = 1 ]; then
  echo "==> Notarize app"
  ditto -c -k --keepParent "$app" "$dist/notarize.zip"
  notarize_file "$dist/notarize.zip"
  rm "$dist/notarize.zip"
  xcrun stapler staple "$app"
fi

echo "==> Package"
ditto -c -k --keepParent "$app" "$zip"
staging="$dist/dmg"
mkdir -p "$staging"
ditto "$app" "$staging/Netnyahoo.app"
ln -s /Applications "$staging/Applications"
# The window's picture and layout (scripts/dmg): Finder finds the picture by the volume's name and this path.
cp "$root/scripts/dmg/background.tiff" "$staging/.background.tiff"
cp "$root/scripts/dmg/DS_Store" "$staging/.DS_Store"
hdiutil create -volname Netnyahoo -srcfolder "$staging" -format ULFO -ov "$dmg" >/dev/null
rm -rf "$staging"
sign "$dmg"
if [ "$notarize" = 1 ]; then
  notarize_file "$dmg"
  xcrun stapler staple "$dmg"
fi

echo "==> Release notes"
# GitHub: the notes, then how to install (the same for every release).
if [ "$notarize" = 1 ]; then
  install_line="Apple Silicon, macOS 14 or later. Signed with Developer ID and notarized by Apple: download, drag it to Applications, open it."
else
  install_line="Apple Silicon, macOS 14 or later. Signed with Developer ID but not notarized: on first launch macOS refuses to open it. Click Done, then System Settings › Privacy & Security › Open Anyway. Or run \`xattr -dr com.apple.quarantine /Applications/Netnyahoo.app\`."
fi
{
  notes_body
  cat <<EOF

## Install

$install_line

Earlier versions update automatically (Netnyahoo › Check for Updates…). Every release's notes: $notes_page
EOF
} > "$dist/release-notes.md"

echo "==> Appcast"
# generate_appcast updates an existing appcast, so start from the published one to keep earlier versions listed.
updates="$dist/updates"
mkdir -p "$updates"
cp "$zip" "$updates/"
# Next to the archive, generate_appcast embeds it in the item: Sparkle's update dialog shows it (Markdown).
{ printf '**%s**\n\n' "$headline"; notes_body; } > "$updates/Netnyahoo-$version.md"
curl -fsL "https://github.com/$repo/releases/latest/download/appcast.xml" -o "$updates/appcast.xml" || rm -f "$updates/appcast.xml"
# Only generate_keys (which created or imported the key) may read it without a keychain prompt, so hand
# generate_appcast an exported copy.
key="$(mktemp -d)/sparkle-key"
trap 'rm -rf "$(dirname "$key")"' EXIT
"$sparkle/generate_keys" --account "$sparkle_account" -x "$key" >/dev/null
# --full-release-notes-url: "You're up to date" › Version History (packages/shell/ios/Updater.swift).
# --phased: the new item's <sparkle:phasedRolloutInterval> (generate_appcast writes it for the item it generates; items
# already in the appcast keep what they had).
phased_args=()
[ -n "$phased" ] && phased_args=(--phased-rollout-interval "$phased")
"$sparkle/generate_appcast" --ed-key-file "$key" ${phased_args[@]+"${phased_args[@]}"} \
  --download-url-prefix "https://github.com/$repo/releases/download/v$version/" \
  --embed-release-notes --full-release-notes-url "$notes_page" \
  --link "https://github.com/$repo" "$updates"
mv "$updates/appcast.xml" "$dist/appcast.xml"
rm -rf "$updates"

engine_files=()
if [ -n "$engine_pack" ]; then
  wait "$engine_pack" || { cat "$dist/engine-pack.log" >&2; die "packing the engine failed ($dist/engine-pack.log)"; }
  rm -f "$dist/engine-pack.log"
  engine_files=("$engine_archive" "$dist/prebuilt-engine.tsv")
fi

echo
[ "$notarize" = 1 ] && echo "Notarized and stapled." || echo "NOT notarized."
[ -n "$engine_pack" ] && echo "New engine: publish $(basename "$engine_archive") with the release, then add prebuilt-engine.tsv's line to packages/nncore/prebuilt-engines.tsv."
[ "$rc" = 1 ] && echo "Release candidate: never publish dist/$version-rc."
[ -n "$phased" ] && echo "Phased rollout: $phased s between steps (the appcast item has phasedRolloutInterval; the whole release takes $((phased * 7)) s)."
du -sh "$app" "$dmg" "$zip" "$dist/appcast.xml" "$dist/release-notes.md" ${engine_files[@]+"${engine_files[@]}"}

#!/usr/bin/env bash
# Builds a release: scripts/release.sh <version>  (docs/releasing.md)
#
# Archives the Release configuration (arm64 only, like our CEF build), exports it signed with
# Developer ID, notarizes and staples it when the notarytool keychain profile exists, and writes
# dist/<version>/: Netnyahoo-<version>.dmg, Netnyahoo-<version>.zip (Sparkle's update archive),
# appcast.xml, signed with the Sparkle EdDSA key in the login keychain, and release-notes.md (the
# GitHub release's notes). The notes come from docs/release-notes/<version>.md, which must exist.
#
# NOTARY_PROFILE   notarytool keychain profile (default netnyahoo); missing → error
# ALLOW_UNNOTARIZED=1  build anyway without notarizing
# SPARKLE_ACCOUNT  keychain account of the Sparkle key (default netnyahoo)
set -euo pipefail

version="${1:?usage: scripts/release.sh <version>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$root/apps/browser"
macos="$app_dir/macos"
repo="mantrakp04/netnyahoo"
notes_page="https://netnyahoo.com/release-notes"
notary_profile="${NOTARY_PROFILE:-netnyahoo}"
# App Store Connect API key for notarytool, when scripts/.notary.env (untracked) sets
# NOTARY_KEY (path to AuthKey_<id>.p8), NOTARY_KEY_ID and NOTARY_ISSUER. Preferred over the keychain
# profile: notarytool keeps that profile in the data-protection keychain, which reads as missing while
# the Mac's screen is locked.
[ -f "$root/scripts/.notary.env" ] && . "$root/scripts/.notary.env"
if [ -n "${NOTARY_KEY:-}" ]; then
  notary_auth=(--key "$NOTARY_KEY" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
else
  notary_auth=(--keychain-profile "$notary_profile")
fi
sparkle_account="${SPARKLE_ACCOUNT:-netnyahoo}"
sparkle="$macos/Pods/Sparkle/bin"
dist="$root/dist/$version"
build="$app_dir/build-release"
archive="$dist/Netnyahoo.xcarchive"
app="$dist/export/Netnyahoo.app"
zip="$dist/Netnyahoo-$version.zip"
dmg="$dist/Netnyahoo-$version.dmg"

# The version ships from the tagged commit: bump it in the project first.
project_version="$(sed -n 's/.*MARKETING_VERSION = \(.*\);/\1/p' "$macos/Netnyahoo.xcodeproj/project.pbxproj" | sort -u)"
if [ "$project_version" != "$version" ]; then
  echo "error: MARKETING_VERSION is '$project_version'. Set it to $version (and bump CURRENT_PROJECT_VERSION) first." >&2
  exit 1
fi
# Written before the build (docs/release-notes/README.md): the website, the GitHub release and the
# update dialog all show it.
notes="$root/docs/release-notes/$version.md"
[ -f "$notes" ] || { echo "error: no release notes: write docs/release-notes/$version.md first" >&2; exit 1; }
frontmatter() { awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { exit } inside' "$notes"; }
notes_body() { awk 'NR == 1 && $0 == "---" { inside = 1; next } inside && $0 == "---" { inside = 0; next } !inside' "$notes" | sed '/./,$!d'; }
meta="$(frontmatter)"
headline="$(sed -n 's/^headline: *//p' <<< "$meta")"
grep -Eq '^date: *[0-9]{4}-[0-9]{2}-[0-9]{2} *$' <<< "$meta" && [ -n "$headline" ] \
  || { echo "error: $notes needs 'date: YYYY-MM-DD' and 'headline:' frontmatter" >&2; exit 1; }
identity="Developer ID Application"
[[ "$(security find-identity -v -p codesigning)" == *"$identity"* ]] || { echo "error: no $identity identity" >&2; exit 1; }
notarize=0
if xcrun notarytool history "${notary_auth[@]}" >/dev/null 2>&1; then
  notarize=1
elif [ "${ALLOW_UNNOTARIZED:-0}" = 1 ]; then
  echo "warning: no notarytool profile '$notary_profile'; the release won't be notarized" >&2
else
  # Releases are notarized since 0.2.1: an unnotarized one makes every new user go through
  # System Settings › Open Anyway again. Store the profile (docs/releasing.md) or set ALLOW_UNNOTARIZED=1.
  echo "error: notarytool credentials are missing or invalid (scripts/.notary.env or the '$notary_profile' profile):" >&2
  xcrun notarytool history "${notary_auth[@]}" 2>&1 | head -2 >&2
  exit 1
fi

rm -rf "$dist"
mkdir -p "$dist"

echo "==> CEF"
"$root/packages/cef/scripts/setup.sh"

echo "==> Archive"
(cd "$app_dir" && xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS \
  -configuration Release -destination 'generic/platform=macOS' ARCHS=arm64 \
  -derivedDataPath "$build" -archivePath "$archive" -allowProvisioningUpdates archive) \
  > "$dist/archive.log" 2>&1 || { grep -E "error:" "$dist/archive.log" >&2; echo "error: archive failed ($dist/archive.log)" >&2; exit 1; }

echo "==> Export (Developer ID)"
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$macos/ExportOptions-DeveloperID.plist" \
  -exportPath "$dist/export" -allowProvisioningUpdates > "$dist/export.log" 2>&1 \
  || { cat "$dist/export.log" >&2; exit 1; }

echo "==> Verify"
codesign --verify --deep --strict "$app"
# Crash reports from users can only be symbolicated with the archive's dSYM (0.1.0/0.1.1 had none).
[ -d "$archive/dSYMs/Netnyahoo.app.dSYM" ] || { echo "error: the archive has no Netnyahoo.app.dSYM" >&2; exit 1; }
entitlements() { codesign -d --entitlements - --xml "$1" 2>/dev/null; }
# Chromium's helpers need their JIT entitlements under the hardened runtime.
for helper in "(Renderer)" "(GPU)"; do
  [[ "$(entitlements "$app/Contents/Frameworks/Netnyahoo Helper $helper.app")" == *cs.allow-jit* ]] \
    || { echo "error: Netnyahoo Helper $helper lost allow-jit" >&2; exit 1; }
done
# Apple hasn't granted the managed passkey capability (Netnyahoo-ICloudPasskeys.entitlements).
if [[ "$(entitlements "$app")" == *web-browser.public-key-credential* ]]; then
  echo "error: the app is signed with com.apple.developer.web-browser.public-key-credential" >&2
  exit 1
fi

echo "==> Launch check"
# Running the app must leave its bundle as signed: anything written into it breaks the signature
# (Chrome indexing uBlock's rulesets next to the extension did, in 0.1.0). Launch it once in the
# background with a throwaway data dir, wait for the first-launch indexing, quit, verify again.
check_data="$(mktemp -d)"
open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR="$check_data" "$app"
indexes="$check_data/Built-in Extensions/ublock-lite/_metadata/generated_indexed_rulesets"
for _ in $(seq 1 90); do
  [ "$(ls "$indexes" 2>/dev/null | wc -l)" -ge 6 ] && break
  sleep 1
done
sleep 5
pid="$(pgrep -f "^$app/Contents/MacOS/Netnyahoo" || true)"
[ -n "$pid" ] || { echo "error: the app didn't start (or quit)" >&2; exit 1; }
kill -TERM $pid
for _ in $(seq 1 30); do kill -0 $pid 2>/dev/null || break; sleep 1; done
kill -KILL $pid 2>/dev/null || true
codesign --verify --deep --strict "$app" || { echo "error: running the app changed its bundle" >&2; exit 1; }
[ -d "$indexes" ] || { echo "error: uBlock's rulesets weren't indexed in the data dir" >&2; exit 1; }
rm -rf "$check_data"

notarize_file() {
  echo "Notarizing $(basename "$1")"
  xcrun notarytool submit "$1" "${notary_auth[@]}" --wait --timeout 1h \
    | tee "$dist/notary-$(basename "$1").log"
  grep -q "status: Accepted" "$dist/notary-$(basename "$1").log" || { echo "error: notarization failed" >&2; exit 1; }
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
hdiutil create -volname Netnyahoo -srcfolder "$staging" -format ULFO -ov "$dmg" >/dev/null
rm -rf "$staging"
codesign --force --sign "$identity" --timestamp "$dmg"
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
# generate_appcast updates an existing appcast, so start from the published one to keep
# earlier versions listed.
updates="$dist/updates"
mkdir -p "$updates"
cp "$zip" "$updates/"
# Next to the archive, generate_appcast embeds it in the item: Sparkle's update dialog shows it (Markdown).
{ printf '**%s**\n\n' "$headline"; notes_body; } > "$updates/Netnyahoo-$version.md"
curl -fsL "https://github.com/$repo/releases/latest/download/appcast.xml" -o "$updates/appcast.xml" || rm -f "$updates/appcast.xml"
# Only generate_keys (which created or imported the key) may read it without a keychain
# prompt, so hand generate_appcast an exported copy.
key="$(mktemp -d)/sparkle-key"
trap 'rm -rf "$(dirname "$key")"' EXIT
"$sparkle/generate_keys" --account "$sparkle_account" -x "$key"
# --full-release-notes-url: "You're up to date" › Version History (packages/shell/ios/Updater.swift).
"$sparkle/generate_appcast" --ed-key-file "$key" \
  --download-url-prefix "https://github.com/$repo/releases/download/v$version/" \
  --embed-release-notes --full-release-notes-url "$notes_page" \
  --link "https://github.com/$repo" "$updates"
mv "$updates/appcast.xml" "$dist/appcast.xml"
rm -rf "$updates"

echo
[ "$notarize" = 1 ] && echo "Notarized and stapled." || echo "NOT notarized."
du -sh "$app" "$dmg" "$zip" "$dist/appcast.xml" "$dist/release-notes.md"

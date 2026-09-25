# Releasing

Releases are GitHub releases of `mantrakp04/netnyahoo`, tagged `v<version>`. Each has three assets:

- `Netnyahoo-<version>.dmg`: what people download (the app and an `/Applications` link).
- `Netnyahoo-<version>.zip`: the archive Sparkle installs updates from.
- `appcast.xml`: the Sparkle feed. The app's `SUFeedURL` is
  `https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml`, so the latest
  release's appcast is the feed.

## Once per machine

- The **Developer ID Application: mantra patel (U5L5T3NGVV)** identity in the login keychain, and Xcode
  signed in to the team: the export fetches the Developer ID provisioning profile
  (`-allowProvisioningUpdates`) that the keychain-group entitlements need.
- The **Sparkle EdDSA key**, a login keychain item (service `https://sparkle-project.org`, account
  `netnyahoo`). Its public half is `SUPublicEDKey` in `apps/browser/macos/Netnyahoo-macOS/Info.plist`.
  Every update must be signed with it, so keep a backup:
  `apps/browser/macos/Pods/Sparkle/bin/generate_keys --account netnyahoo -x <file>` exports it, and `-f <file>`
  imports it on another machine.
- For notarization, a notarytool profile named `netnyahoo`:
  `xcrun notarytool store-credentials netnyahoo --apple-id <id> --team-id U5L5T3NGVV` (it asks for an
  app-specific password). Without it, the script still builds and signs, but the release is unnotarized and
  Gatekeeper blocks the first launch.
- The engine (`packages/cef/scripts/setup.sh`, `docs/cef-source-build.md`) and `pod install`.

## Cutting a release

1. Bump `MARKETING_VERSION` (the version) and `CURRENT_PROJECT_VERSION` (the build number, which Sparkle
   compares: it must go up every release) in both configurations of the `Netnyahoo-macOS` target in
   `apps/browser/macos/Netnyahoo.xcodeproj`. The helpers and the Dock tile plug-in take the same values.
2. `scripts/release.sh <version>`. It writes `dist/<version>/`:
   - archives the Release configuration (arm64 only) and exports it with Developer ID,
   - checks the signature, the helpers' JIT entitlements and that the app isn't signed with
     `com.apple.developer.web-browser.public-key-credential` (Apple hasn't granted it yet;
     `Netnyahoo-ICloudPasskeys.entitlements` is the future entitlements file),
   - notarizes and staples the app and the DMG when the `netnyahoo` profile exists,
   - packages the DMG and the zip, and signs `appcast.xml` with the Sparkle key. It starts from the
     published appcast, so earlier versions stay listed.
3. Commit, tag and publish:

   ```bash
   git tag v<version> && git push origin main v<version>
   gh release create v<version> -R mantrakp04/netnyahoo --title "Netnyahoo <version>" --notes-file <notes> \
     dist/<version>/Netnyahoo-<version>.dmg dist/<version>/Netnyahoo-<version>.zip dist/<version>/appcast.xml
   ```

Before publishing, check the build the way the script can't: launch `dist/<version>/export/Netnyahoo.app` with
`NETNYAHOO_BACKGROUND=1`, a throwaway `NETNYAHOO_DATA_DIR` and `NETNYAHOO_REMOTE_DEBUGGING_PORT`, and load a
page over CDP.

## Unnotarized builds

Gatekeeper refuses to open an unnotarized download. Either open it once from System Settings › Privacy &
Security › Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Netnyahoo.app`.

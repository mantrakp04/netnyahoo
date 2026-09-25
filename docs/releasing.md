# Releasing

Releases are GitHub releases of `mantrakp04/netnyahoo`, tagged `v<version>`. Each has three assets:

- `Netnyahoo-<version>.dmg`: what people download (the app and an `/Applications` link).
- `Netnyahoo-<version>.zip`: the archive Sparkle installs updates from.
- `appcast.xml`: the Sparkle feed. The app's `SUFeedURL` is
  `https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml`, so the latest
  release's appcast is the feed.

Each version's notes are a file in the repo, `docs/release-notes/<version>.md` (how to write one:
`docs/release-notes/README.md`). The GitHub release, the update dialog and the website's
`https://netnyahoo.com/release-notes` all come from it. The first launch after an update opens
`/release-notes#<version>` in a new tab (`apps/browser/src/lib/releaseNotesPage.ts`), so the site has to be
deployed with the new entry by the time the update reaches people.

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
2. Write `docs/release-notes/<version>.md` from `git log v<previous>..HEAD` (`docs/release-notes/README.md`)
   and check it on the site: `pnpm -C apps/site build && pnpm -C apps/site preview`, then
   `http://localhost:4321/release-notes#<version>`.
3. `scripts/release.sh <version>`. It stops right away if the notes file is missing or lacks its `date` and
   `headline`. It writes `dist/<version>/`:
   - archives the Release configuration (arm64 only) and exports it with Developer ID,
   - checks the signature, the helpers' JIT entitlements and that the app isn't signed with
     `com.apple.developer.web-browser.public-key-credential` (Apple hasn't granted it yet;
     `Netnyahoo-ICloudPasskeys.entitlements` is the future entitlements file),
   - launches the app once in the background (throwaway data dir), waits for uBlock's rulesets to be indexed,
     quits it and checks the signature again: the app must never write into its own bundle
     (`docs/cef-source-build.md` › "Nothing writes into the app bundle"),
   - notarizes and staples the app and the DMG when the `netnyahoo` profile exists,
   - packages the DMG and the zip, and signs `appcast.xml` with the Sparkle key. It starts from the
     published appcast, so earlier versions stay listed. The new item embeds the notes' headline and body
     (Markdown, shown in Sparkle's update dialog) and links the page as its full release notes
     (`sparkle:fullReleaseNotesLink`: "You're up to date" › Version History opens it in a tab),
   - writes `release-notes.md`: the notes' body, then the standard Install section and a link to the page.
4. Commit (the notes file with the version bump), tag and publish:

   ```bash
   git tag v<version> && git push origin main v<version>
   gh release create v<version> -R mantrakp04/netnyahoo --title "Netnyahoo <version>" \
     --notes-file dist/<version>/release-notes.md \
     dist/<version>/Netnyahoo-<version>.dmg dist/<version>/Netnyahoo-<version>.zip dist/<version>/appcast.xml
   ```
5. Deploy the site so `/release-notes` shows the new version (the updated app opens it on its first launch):
   `pnpm -C apps/site run deploy` builds `apps/site` with `SITE_URL=https://netnyahoo.com` and ships it
   (`apps/site/hexclave.deploy.ts`). Also bump `VERSION` and `DMG_SIZE` in `apps/site/src/data/release.ts`
   first so the download button points at the new DMG. Deploying is the maintainer's call: an agent cutting
   a release stops before this step unless told to do it.

Before publishing, check the build the way the script can't: launch `dist/<version>/export/Netnyahoo.app` with
`NETNYAHOO_BACKGROUND=1`, a throwaway `NETNYAHOO_DATA_DIR` and `NETNYAHOO_REMOTE_DEBUGGING_PORT`, and load a
page over CDP. Afterwards `codesign --verify --deep --strict` must still pass on it.

To check the after-update tab too: in that data dir, set `lastVersion` in `release-notes.json` to the
previous version (`{"version":1,"lastVersion":"<previous>","pending":null}`) and relaunch with
`NETNYAHOO_RELEASE_NOTES=1` added (test instances skip the tab without it). `curl localhost:<port>/json` must
list one `…/release-notes#<version>` page; a second launch opens none.

## Unnotarized builds

Gatekeeper refuses to open an unnotarized download. Either open it once from System Settings › Privacy &
Security › Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Netnyahoo.app`.

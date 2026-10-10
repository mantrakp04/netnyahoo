# Releasing

Releases are GitHub releases of `mantrakp04/arcadia`, tagged `v<version>`. Each has three assets, four when the engine changed:

- `Arcadia-<version>.dmg`: what people download (the app and an `/Applications` link, in a window with the
  site's poster behind them: `scripts/dmg`, where `render.sh` redraws the picture and `layout.sh` the layout).
- `Arcadia-<version>.zip`: the archive Sparkle installs updates from.
- `appcast.xml`: the Sparkle feed. The latest release's appcast is the feed. Builds after 0.2.13 poll
  `https://netnyahoo.com/appcast.xml` (`SUFeedURL`), which counts the check by version and day (and whether
  it's the copy's first) and redirects to
  `https://github.com/mantrakp04/arcadia/releases/latest/download/appcast.xml`, the URL 0.2.13 and
  earlier poll directly. The count can't block an update: see `infra/site/nginx.conf` and `docs/growth.md`
  › Installs.
- `ArcadiaCore-<engine tree>.tar.xz`, only when `engine/` changed since the last one: the release's engine (Chrome's
  framework, stripped), so the app builds without a Chromium tree. `packages/arcadiacore/prebuilt-engines.tsv` maps
  `engine/`'s git tree to the release and the archive's SHA-256; `packages/arcadiacore/scripts/fetch-engine.sh` downloads
  it (the app's build runs it when there's no local engine build).

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
  `arcadia`, or the app's old name in lower case on the Mac that made it before the rename: `LegacyName.appName`;
  release.sh finds either, `SPARKLE_ACCOUNT` overrides). Its public half is `SUPublicEDKey` in
  `apps/browser/macos/Arcadia-macOS/Info.plist`. Every update must be signed with it, so keep a backup:
  `apps/browser/macos/Pods/Sparkle/bin/generate_keys --account <account> -x <file>` exports it, and `-f <file>`
  imports it on another machine.
- For notarization, an App Store Connect API key (Team Keys, Developer role). Keep `AuthKey_<id>.p8`
  outside the repo (e.g. `~/.private_keys/`, mode 600) and point `scripts/.notary.env` (untracked) at it:
  `NOTARY_KEY=<path>`, `NOTARY_KEY_ID=<id>`, `NOTARY_ISSUER=<issuer id>`. release.sh prefers it to the
  keychain profile below, which notarytool keeps in the data-protection keychain: that reads as
  missing while the screen is locked. Otherwise, a notarytool profile named `arcadia`:
  `xcrun notarytool store-credentials arcadia --apple-id <id> --team-id U5L5T3NGVV` (it asks for an
  app-specific password). Without it, the script still builds and signs, but the release is unnotarized and
  Gatekeeper blocks the first launch.
- The engine: ArcadiaCore's `Chromium Framework.framework` built in `~/chromium-build` (`engine/arcadiacore/apply.sh`, then
  `chrome_framework`; `docs/arcadiacore-spike.md`), and `pod install` in `apps/browser/macos`.

## Cutting a release

1. Bump `MARKETING_VERSION` (the version) and `CURRENT_PROJECT_VERSION` (the build number, which Sparkle
   compares: it must go up every release) in both configurations of the `Arcadia-macOS` target in
   `apps/browser/macos/Arcadia.xcodeproj`. The helpers and the Dock tile plug-in take the same values.
2. Write `docs/release-notes/<version>.md` from `git log v<previous>..HEAD` (`docs/release-notes/README.md`)
   and check it on the site: `pnpm -C apps/site build && pnpm -C apps/site preview`, then
   `http://localhost:4321/release-notes#<version>`.
3. `scripts/release.sh <version>`. It stops right away if the notes file is missing or lacks its `date` and
   `headline`, if the tree under `apps/browser`, `packages` or `engine` has uncommitted changes, or if the engine
   framework is older than the tree's ArcadiaCore sources or the Chromium tree differs from `engine/arcadiacore`
   (`apply.sh --check`). It writes `dist/<version>/`:
   - archives the Release configuration of `apps/browser/macos` (arm64 only), staging the engine into its own
     derived data so a development build restaging can't change it mid-build, and exports it with Developer ID,
   - signs Chrome's framework inside out as Chrome signs its own (`chrome/installer/mac/signing/parts.py`): the
     helpers under the hardened runtime with library validation, except the renderer and GPU ones (Aperitif's too),
     which get `allow-jit` (`packages/arcadiacore/scripts/signing`) instead; then the framework, then the app again with
     the entitlements the export gave it,
   - checks what an in-place update depends on: bundle id `com.arcadia.browser`, executable `Arcadia`, the
     designated requirement (our team), the keychain groups, Sparkle's feed and key and the usage strings in
     `Info.plist`; that every piece of code is Developer ID with a timestamp and no `get-task-allow`; and that the app
     isn't signed with `com.apple.developer.web-browser.public-key-credential` (Apple hasn't granted it yet;
     `Arcadia-ICloudPasskeys.entitlements` is the future entitlements file),
   - launches the app once in the background (throwaway data dir), waits for uBlock's rulesets to be indexed,
     quits it and checks the signature again: the app must never write into its own bundle,
   - notarizes and staples the app and the DMG,
   - packages the DMG and the zip, and signs `appcast.xml` with the Sparkle key. It starts from the
     published appcast, so earlier versions stay listed. The new item embeds the notes' headline and body
     (Markdown, shown in Sparkle's update dialog) and links the page as its full release notes
     (`sparkle:fullReleaseNotesLink`: "You're up to date" › Version History opens it in a tab),
   - writes `release-notes.md` (the notes' body, then the standard Install section and a link to the page) and
     `provenance.txt` (the commit and the engine build it shipped).

   `scripts/release.sh <version> --rc` builds a candidate into `dist/<version>-rc/` from the working tree, as
   `<version>` with the next build number, notarized but never published: no notes file or clean tree needed (it
   lists the uncommitted files it included).
4. Commit (the notes file with the version bump), tag and publish:

   ```bash
   git tag v<version> && git push origin main v<version>
   gh release create v<version> -R mantrakp04/arcadia --title "Arcadia <version>" \
     --notes-file dist/<version>/release-notes.md \
     dist/<version>/Arcadia-<version>.dmg dist/<version>/Arcadia-<version>.zip dist/<version>/appcast.xml \
     $(ls dist/<version>/ArcadiaCore-*.tar.xz 2>/dev/null)
   ```
   With a new engine, then append `dist/<version>/prebuilt-engine.tsv` to `packages/arcadiacore/prebuilt-engines.tsv` and
   commit it.
5. Deploy the site so `/release-notes` shows the new version (the updated app opens it on its first launch):
   `pnpm -C apps/site run deploy` builds `apps/site` with `SITE_URL=https://netnyahoo.com` and ships it
   (`infra/site/hexclave.deploy.ts`). Also bump `VERSION` and `DMG_SIZE` in `apps/site/src/data/release.ts`
   first so the download button points at the new DMG. Deploying is the maintainer's call: an agent cutting
   a release stops before this step unless told to do it.

Before publishing, run the smoke test: `.claude/skills/release/scripts/smoke.sh <version> <previous> [--rc]` (the
`release` skill runs the whole flow). Besides the hidden launch over CDP, it checks the update itself against
`dist/<previous>/export`: the identity Sparkle, the keychain and TCC compare (bundle id, executable, feed, key, the
previous build's designated requirement, a higher build number), the appcast's EdDSA signature of the zip, Gatekeeper
on the app and the DMG, Sparkle actually updating a copy of the previous build (`update-test.sh`) and the previous
build's data opening in the new one (`carryover.sh`). By hand, check the build the way the script can't: launch
`dist/<version>/export/Arcadia.app` with `ARCADIA_BACKGROUND=1`, a throwaway `ARCADIA_DATA_DIR` and
`ARCADIA_REMOTE_DEBUGGING_PORT`, and load a page over CDP. Afterwards `codesign --verify --deep --strict` must still
pass on it.

To check the after-update tab too: in that data dir, set `lastVersion` in `release-notes.json` to the
previous version (`{"version":1,"lastVersion":"<previous>","pending":null}`) and relaunch with
`ARCADIA_RELEASE_NOTES=1` added (test instances skip the tab without it). `curl localhost:<port>/json` must
list one `…/release-notes#<version>` page; a second launch opens none.

## The engine switch (0.2.21 → 0.2.22)

0.2.22 is the first release on ArcadiaCore; 0.2.21 and earlier ran on CEF. It's the same app to macOS and Sparkle (bundle
id, executable, Developer ID team, designated requirement, feed and key), so Sparkle updates a CEF copy in place and
macOS keeps its permissions, keychain items and passkeys.

Nothing is migrated. A release build without `ARCADIA_DATA_DIR` opens the CEF build's data where it is
(`InstalledDataDirectory` in `packages/arcadiacore/ios/ArcadiaCoreHost.mm`): Chrome's user data dir
`~/Library/Application Support/com.arcadia.browser/Chromium` (profiles `Default` and `Profile <id>`), with the app's
own documents (session, settings) in the folder above. Both engines are Chromium 154.0.8037.58, so every store keeps its
format, and both read the same "Arcadia Safe Storage" keychain item, which trusts the app by its designated
requirement. Only Developer ID builds use the login keychain; test instances (`ARCADIA_DATA_DIR` or
`ARCADIA_BACKGROUND`) and ad hoc builds use Chrome's mock keychain. `carryover.sh` checks it: the previous build makes
two profiles with tabs, persistent and session cookies, localStorage, saved passwords, bookmarks, history, an address,
a site permission, a zoom level and an unpacked extension, and the new build, started without `ARCADIA_DATA_DIR`,
must find and read all of it. Both run as test copies (bundle id `com.arcadia.browser.carryover`, signed ad hoc) in
a fake home (`HOME` and `CFFIXED_USER_HOME`), so the real app's data, defaults and keychain are never touched.
`rollback.sh <previous app> <new app>` (not part of smoke.sh) checks going back on the same setup: the previous build,
then the new one adding a second session, then the previous one again must show both sessions' data without crashing
or resetting the profile. 0.2.21 → 0.2.22 → 0.2.21 keeps everything but session cookies, which 0.2.21 drops at every
launch anyway.

`update-test.sh` runs Sparkle itself: the previous build's `Sparkle.framework` (through `sparkle-host.swift`) reads a
local feed made of the release appcast's own item, downloads the zip, checks its EdDSA signature, extracts it and runs
Sparkle's installer, which swaps a scratch copy of the previous build for the new one, silently and without
relaunching it. The copies get a test bundle id and a throwaway key, so neither the real defaults nor the release key
are involved; the real identity and signature are what smoke.sh's other update checks compare.

The framework and its helpers keep Chrome's names (`Chromium Framework`, `Chromium Helper (Renderer)`): they are
compiled in from the branding file, so renaming them is a full engine rebuild. Their bundle ids and team are ours,
and the keychain and macOS permissions belong to the app itself, so only Activity Monitor shows the names.

## Unnotarized builds

Releases are notarized since 0.2.1 (the `arcadia` profile holds an App Store Connect API key; with an
Apple ID it's `--apple-id … --team-id …` and an app-specific password, which also works but locks the
Apple ID after repeated failures). If a build ever ships unnotarized, Gatekeeper refuses to open the download. Either open it once from System Settings › Privacy &
Security › Open Anyway, or run `xattr -dr com.apple.quarantine /Applications/Arcadia.app`.

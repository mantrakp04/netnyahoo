# @arcadia/import

Imports another browser's data into Arcadia. The native code lives in `ios/`; `ios/Core/` is plain Swift with no
Expo dependency, so `Package.swift` builds and tests it on its own. `src/index.ts` is the typed JS wrapper and the UI
is `apps/browser/src/components/import/`. Every test reads fixtures. Never point anything at a real profile.

## Which file reads what

Paths are relative to the source's profile folder. All SQLite files go through `SQLiteSnapshot.swift`, which copies
the file and its WAL before opening it.

| Kind | Chromium family (Chrome, Edge, Brave, Helium, Opera, Vivaldi, Island, Dia…) | Arc | Firefox |
|---|---|---|---|
| bookmarks | `ChromiumBookmarks.swift`: `Bookmarks`, `AccountBookmarks` | same as Chromium | `Firefox.swift`: `places.sqlite` |
| history | `HistoryReader.swift`: `History` | same as Chromium | `HistoryReader.swift`: `places.sqlite` |
| tabs | `ChromiumSessions.swift`: `Sessions/Session_*` (newest), `Sessions_Encrypted/`, legacy `Current Session` | `ArcSidebar.swift` | `Firefox.swift`: `sessionstore-backups/recovery.jsonlz4`, `sessionstore.jsonlz4` |
| passwords | `ChromiumSecrets.swift`: `Login Data`, `Login Data For Account` (key from `ChromiumCrypto.swift`) | same as Chromium | `FirefoxLogins.swift`: `key4.db` + `logins.json` |
| cookies | `ChromiumSecrets.swift`: `Network/Cookies` (or `Cookies`) | same as Chromium | `Firefox.swift`: `cookies.sqlite` |
| autofill (addresses, cards) | `ChromiumAutofill.swift`: `Web Data` | same as Chromium | none |
| extensions (listed, never installed) | `ChromiumExtensions.swift`: `Preferences`, `Secure Preferences`, `Extensions/*/manifest.json` | same as Chromium | none |
| spaces, pinnedTabs, favorites | none | `ArcSidebar.swift`: `<Application Support>/Arc/StorableSidebar.json` | none |

| Source | Files | What it reads |
|---|---|---|
| Discovery (which browsers and profiles exist) | `Discovery.swift` (`BrowserDefinition.all`: IDs, data paths, Keychain items), `AppIcons.swift` | Chromium `Local State`; Firefox `profiles.ini` (`Firefox.profiles`) |
| Dia | Same as the Chromium family (`Dia/User Data`) | Dia's sidebar (spaces, pinned tiles) is a SQLCipher `tabs.db` that isn't read |
| Dia open and pinned tabs (`diaTabs`) | `DiaAppleEvents.swift` (Apple Events, `DiaAutomation` permission) → `DiaTabs.swift` (`DiaTabsImport.build`) | Each Dia window's tabs over AppleScript; needs Dia running and Automation permission |
| Safari direct (needs Full Disk Access) | `SafariDirect.swift`, `SafariCookies.swift` | `~/Library/Safari/{Bookmarks.plist, History.db, LastSession.plist}`, `~/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies` |
| Safari export (.zip or folder) | `SafariExport.swift`, `ZipArchive.swift`, `NetscapeBookmarks.swift`, `PasswordsCSV.swift` | `*.html` bookmarks, `*.csv` passwords, `*.json` history and extensions (names only, by `metadata.data_type`), `payment_cards` JSON. No cookies |
| A bookmarks HTML file or passwords CSV | `NetscapeBookmarks.swift`, `PasswordsCSV.swift` | Any Netscape bookmarks file; any password CSV with url and password columns (Chrome, Firefox, Bitwarden…) |

Shared code: `Model.swift` (`ImportKind`, `ImportResult` and the other result types, `ImportError`), `ChromiumCrypto.swift`
(v10 AES-CBC, `SafeStorageKeychain`), `SecretBytes.swift` (wipeable buffers), `Wire.swift` (JSON for the engine).

## Data flow

1. `Discovery.swift`: `BrowserDiscovery.list()` returns each installed source and its profiles (`listBrowsers`).
2. `Importer.swift`: `Importer.importData(browserId:profileId:kinds:…)` dispatches on `(kind, family)` to the readers
   above. A failed kind becomes a warning plus an entry in `failed`, and the other kinds still run. Safari, Dia tabs,
   HTML and CSV have their own module functions (`importSafariDirect`, `importSafariExport`, `readDiaTabs`,
   `importBookmarksHTML`, `importPasswordsCSV`).
3. `ios/ImportModule.swift` (Expo module `ArcadiaImport`) encodes the result as a JSON string for JS. It keeps
   cookies, addresses and cards back in `ImportVault` (`ios/ImportWriter.swift`) and returns only their counts and
   a one-time `vaultToken`. History can stream in chunks (`onImportEvent`).
4. `ios/ImportWriter.swift`: `writeImported(token, engineProfile, kinds)` takes the vault entry and sends it to the
   engine with `ArcadiaCoreEngineBridge.callWithSecret` as `ac_cookies_import` and `ac_autofill_import`, in batches of 500
   (`engine/chromium/src/chrome/browser/arcadia/ac_cookies.cc`, `ac_autofill.cc`).
5. `apps/browser/src/components/import/ImportWindow.tsx` is the wizard: choose, then profiles, then unlock, then
   progress, then done. `apply.ts` writes the JS-side kinds into the store (bookmarks, history, tabs, Arc spaces,
   Dia profiles) and saves passwords with `savePassword` (`@arcadia/arcadiacore`). For cookies and autofill it calls
   `importNative`, which calls `writeImported`. `module.ts` loads the package lazily.

## Secrets and the Keychain

- Chromium-family passwords, cookies and card numbers are encrypted with the browser's "`<Name> Safe Storage`"
  Keychain item. `SafeStorageKeychain.secret` reads it, and macOS shows a system prompt when it does. It runs only from
  `unlockBrowser`, after the user goes through the unlock step (`ENCRYPTED` kinds in `ImportWindow.tsx`).
- **Agents never trigger it.** The Swift tests pass the fixture key (`Fixtures.chromiumKey`, `importer.setKey`),
  and app runs set `ARCADIA_IMPORT_TEST_SECRET`. Firefox has no Keychain item; its primary password goes through
  `unlockBrowser(id, { primaryPassword })`.
- Cookie values, addresses and card numbers never reach JS. `ImportResult` and `SafariExport` leave them out of their
  `CodingKeys` and encode only the counts. They're held in `SecretBytes`; `Wire.swift` serialises them into
  `SecretBytes` too, and `ImportWriter` copies that once into the buffer the bridge zeroes after the call. Vault entries expire after 10 minutes. JS drops the token for a private profile.
- Passwords do reach JS (`credentials`), because `savePassword` takes them from there.
- `forgetUnlockedKeys` drops the derived keys and the whole vault.

## Fixtures

`pnpm --filter @arcadia/import fixtures` runs `fixtures/generate.py`, which wipes `fixtures/home/` and
`fixtures/misc/` and rebuilds everything below deterministically. The test secrets are in `fixtures/secrets.json`.
`fixtures/dia/` and `fixtures/extensions/` are written by hand. Don't open the Firefox `places.sqlite` with the
sqlite3 CLI: it checkpoints the WAL the tests depend on.

| Function | Writes (under `fixtures/`) |
|---|---|
| `build_chrome` | `home/Library/Application Support/Google/Chrome/` (Default + Profile 1), `misc/Cookies-v23`, `misc/Session_v5_encrypted` |
| `build_brave` | `home/Library/Application Support/BraveSoftware/Brave-Browser/` |
| `build_opera` | `home/Library/Application Support/com.operasoftware.Opera/` (the root is the profile) |
| `build_helium` | `home/Library/Application Support/net.imput.helium/` |
| `build_dia` | `home/Library/Application Support/Dia/User Data/` (Default + Profile 2) |
| `build_safari_direct` | `home/Library/Safari/{Bookmarks.plist, History.db, LastSession.plist}` |
| `build_safari_cookies` | `home/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`, `misc/binarycookies/*` (malformed) |
| `build_arc` | `home/Library/Application Support/Arc/` (`User Data/`, `StorableSidebar.json`) |
| `build_firefox` | `home/Library/Application Support/Firefox/` (`profiles.ini`, `Profiles/*`), `misc/nss-legacy-pbe.json` |
| `build_exports` | `safari/Safari Export/`, `safari/Safari Export.zip`, `safari/not-an-export.zip`, `csv/*.csv`, `html/chrome-bookmarks.html` |

## Commands

| What | Command |
|---|---|
| Swift tests (`tests/`, against `fixtures/`) | `pnpm --filter @arcadia/import test` (`swift test`, scratch path in `$TMPDIR`) |
| Rebuild fixtures | `pnpm --filter @arcadia/import fixtures` |
| Typecheck the JS wrapper | `pnpm --filter @arcadia/import typecheck` |
| End to end in a hidden Debug instance (cookies, addresses, cards) | `node packages/import/scripts/e2e.mjs <Arcadia.app> <scratch dir>` (`--help`) |
| Run one script in that instance (`e2e.mjs --keep`) | `scripts/agent/ac eval <scratch dir>/data '<js>'` |

## Test hooks (`ios/ImportModule.swift`)

| Variable | Effect |
|---|---|
| `ARCADIA_IMPORT_SOURCE_DIR` | Discovery reads browsers from this folder instead of `~/Library/Application Support`. Point it at `<fake home>/Library/Application Support` |
| `ARCADIA_IMPORT_SAFARI_HOME` | Safari direct reads from this home. If it isn't set, the home is two levels above `ARCADIA_IMPORT_SOURCE_DIR`, and only when that is set |
| `ARCADIA_IMPORT_TEST_SECRET` | `unlockBrowser` uses this as every browser's Safe Storage secret and never touches the Keychain |
| `ARCADIA_IMPORT_DIA_BUNDLE_ID` | The Dia tabs functions talk to this bundle ID instead of `company.thebrowser.dia` |

## Adding a source or a kind

1. **Source**: add a `BrowserDefinition` to `BrowserDefinition.all` in `Discovery.swift`. A Chromium fork usually
   needs only `chromium(id, name, bundleIds, dataPath, keychainName)`. A new family needs a case in
   `BrowserDiscovery.source` and in `Importer.unlock`.
2. **Kind**: add the case to `ImportKind` (`Model.swift`) and to the `ImportKind` union in `src/index.ts`, plus a
   result field on `ImportResult` and its TS type. If the kind carries secrets, leave it out of `CodingKeys`, encode a
   count instead, and keep it in `ImportVault`.
3. Write the reader in `ios/Core/<Source><Kind>.swift`. Read SQLite through `SQLiteSnapshot`, check `cancellation`,
   and throw `ImportError`. Then add its `(kind, family)` case in `Importer.importData`.
4. Add a fixture: a `build_*` function in `fixtures/generate.py`, or a branch of an existing one. Run
   `pnpm --filter @arcadia/import fixtures` and write a test in `tests/`.
5. Apply it in the app. Add the kind to `KINDS` (and `ENCRYPTED` if it's encrypted) in `ImportWindow.tsx`, and write
   it in `apply.ts`. A secret kind goes through `ImportWriter` and a new engine call instead.
6. Run `test`, `typecheck` and `pnpm -w typecheck`. For anything that reaches the engine, also run `scripts/e2e.mjs`
   against a fresh Debug build.

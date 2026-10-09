# Building the engine from source

Netnyahoo runs on NNCore: Chrome's own framework (`//chrome:chrome_framework`) built from our Chromium tree, with our
layers linked in (`docs/nncore-spike.md`). The tree is plain **Chromium 154.0.8037.97** (`CHROMIUM_VERSION` in
`env.sh`), then ungoogled-chromium, then our patch series. Nothing of CEF's is checked out or built. CEF left the tree
on 2026-10-09: its 117 patches to Chrome are gone, except a few kept as `chromium-cef-carryover.patch`
([below](#cefs-117-patches)), and the seams of theirs NNCore used are our own hooks H1–H6
([below](#our-hooks-in-chromes-code)). The framework is still named "Chromium Framework". Crashpad stays off.

What the build adds:

- **H.264 / AAC.** Set with `proprietary_codecs=true` and `ffmpeg_branding="Chrome"`; H.264 decodes
  through VideoToolbox.
- **ungoogled-chromium** 154.0.8037.97-1 (macOS 154.0.8037.97-1.1). Its patch series and domain substitution strip
  Google background services; see [ungoogled-chromium](#ungoogled-chromium). The Chrome Web Store and
  extension auto-updates are deliberately kept working.
- **Our patches**, in `engine/patches/`, applied in the order `engine/patches/series` gives (see
  [The patch series](#the-patch-series)):

| Patch | What it does |
|---|---|
| `chromium-cef-carryover.patch` | The CEF patches we keep ([CEF's 117 patches](#cefs-117-patches)): `BrowserManagerService::DeleteBrowser`'s destruction order, no `NOTREACHED` for unmapped Mac key codes, bubbles kept on screen on the Mac, rounded DIP/pixel screen rects, the Mac print preview's file dialog and child-modal focus, the Mac locale and ResourceBundle delegate plumbing H5 uses, the tab strip API's colour provider without an active tab, and `browser_tests` building without background mode (for `enable_background_mode=false`) |
| `chromium-ui-update-before-insert.patch`, `chromium-tab-strip-notify-before-insert.patch` | Fix a CHECK when a tab loads before it's in the tab strip. The first also carries CEF's guard in `browser_ui_controller.cc` |
| `chromium-extension-window-hidden.patch` | The windows of NNCore's own pages are invisible to chrome.windows/tabs (`g_netnyahoo_hidden_from_extensions`, also read by the next patch and apply.sh's `browser_window_util` hook) |
| `chromium-password-bubble-hook.patch` | NNCore may replace Chrome's password bubble (`g_netnyahoo_password_bubble`) |
| `chromium-extension-install-prompt-hook.patch` | NNCore may replace Chrome's extension install dialog (`g_netnyahoo_extension_install_prompt`) |
| `chromium-branding.patch` | Netnyahoo's bundle and team id (`branding_file_path`), for the passkey and payments keychain access groups; product names stay "Chromium" |
| `chromium-icloud-keychain-window.patch` | iCloud Keychain's passkey sheet attaches to the tab's own window when it isn't a `views::Widget` |
| `chromium-safe-storage-name.patch` | The Safe Storage key lives in its own "Netnyahoo Safe Storage" keychain item, account "Netnyahoo". **Load-bearing:** it's Chromium's own `os_crypt` code, so NNCore uses it too, and every user's saved passwords and cookies are encrypted with that item's key. Keep it, unchanged, through every re-sync and version bump; without it Chrome reads "Chromium Safe Storage" and nothing decrypts |
| `chromium-device-chooser-hook.patch` | `chrome::ShowDeviceChooserDialog` asks NNCore first (`g_netnyahoo_device_chooser`) |
| `chromium-cast-dialog-hook.patch` | The Media Router's Cast dialog (and Presentation API requests) asks NNCore first (`g_netnyahoo_wants_cast_dialog`, `g_netnyahoo_cast_dialog`) |
| `chromium-side-panel-hook.patch` | `side_panel_util` asks NNCore first for an extension's side panel (`g_netnyahoo_extension_side_panel`) |
| `chromium-hidden-window-current-window.patch` | Extension pages in hidden windows (our popups and side panels) take the last active window as their current window |
| `chromium-extension-updates.patch` | Undoes ungoogled's early `return` in `UpdateCheckerImpl::CheckForUpdates`, which left every update check pending: Web Store extensions never updated |
| `chromium-window-docked-devtools.patch` | `DevtoolsUIController::UpdateDevtools` tells NNCore of every change to a tab's docked DevTools (`g_netnyahoo_devtools_dock_changed`). DevTools may dock in any Browser, as in stock Chrome (CEF had turned docking off for every Browser but NNCore's own) |
| `chromium-devtools-redock-display.patch` | A `RenderWidgetHostViewMac` that a `views::WebView` gives up (`SetParentUiLayer(nullptr)`) draws into its own NSView again. Chrome switched it to the Views compositor for good the first time it was attached, so DevTools docked back from their own window stayed blank in the client's view |
| `chromium-window-hosted.patch` | `BridgedContentView.netnyahooEmbeddedView`: hit testing and accessibility ask the embedder's subview of a Chrome window's content view first. A Browser NNCore says so of (`g_netnyahoo_keeps_window_without_tabs`) stays open when its last tab closes, unless the window is closing |
| `chromium-devtools-window-title.patch` | DevTools' title is Dia's, "Developer Tools - <url>" (`DevToolsUIBindings` `kTitleFormat`), so Chrome's own undocked DevTools window says so too |
| `chromium-neterror-yahu.patch` | "Where's Big Yahu?" replaces the dino: the offline page and chrome://yahu (below) |
| `chromium-autofill-address-bubble-window.patch` | Chrome's offers to save or update an address find the tab's `BrowserWindow` through its Browser when it has no `BrowserView` (NNCore's): `FindBrowserWindowWithWebContents` finds BrowserViews only, so the offers never reached NNCore's bubble handler. It also carries CEF's `chrome_autofill_bubble_3796`: no address or card bubble (and no crash) for a tab with no window at all |
| `chromium-password-generation-local.patch` | Chrome offers "Suggest strong password" without password sync (`PasswordFeatureManagerImpl::IsGenerationEnabled`); generated passwords save to the profile's local store like any other. With no account, its popup says "Passwords are saved to Password Manager on this device." instead of "…saved to Google Password Manager for ." |
| `chromium-extension-installed-bubble.patch` | Chrome's "<extension> has been added" bubble (`ShowInfoDialog`): a window without Chrome's toolbar (every client window) gets it as a bubble under the top-right corner of the window, with a close button, closing on Esc and when the window is clicked. Chrome fell back to a browser-modal sheet there, with no buttons and no way to dismiss it. The app renames "Chromium" in Chrome's strings itself (`nn_strings.cc`) |
| `chromium-netnyahoo-layer.patch` | The macOS `//chrome:chrome_dll` (NNCore's framework) links `//chrome/browser/netnyahoo` and exports its `nn_*` calls |
| `chromium-pip-close-keeps-playing.patch` | The video Picture in Picture window's close button (and the window going away any other way) closes it without pausing the video, which keeps playing in its tab, as in Dia and Arc. Chrome paused it whenever the window had a play/pause button (`VideoOverlayWindowViews::CloseAndPauseIfAvailable`, `OnNativeWidgetDestroyed`). Back to tab and the page's own `exitPictureInPicture()` never paused |
| `chromium-pip-overlay-window.patch` | Chrome makes our `NetnyahooVideoOverlayWindow` (`chrome/browser/netnyahoo/pip/`, a `VideoOverlayWindowViews` subclass with its own buttons, progress bar, fade and bounds memory; the hook makes six methods virtual): Dia's video Picture in Picture window (measured in `docs/dia-spec.md` › Picture in Picture): nothing but the video at rest (the origin shows only with the controls); on hover a 35 % black scrim, back to tab (top left) and close (top right) as 28 pt rounded squares with 1 pt line glyphs, the origin centred in 13 pt, a bare play/pause glyph and a 5 pt progress bar that seeks; no skip, time, mute, captions or minimize controls (the keyboard shortcuts stay). Controls fade in 200 ms ease-in-out. The window shows at once and fades out in Core Animation (100 ms from the close button, 70 ms otherwise, smooth while the tab is being shown), and a new window opens where the last one was left, sized to the new video and kept on screen (`NetnyahooPictureInPicture.plist` in the user data dir) |

Removed, all in git history:

- 2026-10-09, with CEF: `chromium-webview-native-hosted.patch`, `chromium-browser-view-hosted-fullscreen.patch` and
  `chromium-autofill-card-touchbar.patch`, which served CEF's hosted tabs and views-hosted windows. NNCore has neither.
- 2026-10-08: our 18 `cef-*.patch` to CEF's own tree (the CEF runtime's API the app used before NNCore, `CEF_NN_*`).
- After 0.2.19: `chromium-zz-extensions-page-uninstall.patch` (chrome://extensions uninstalled without Chrome's
  dialog), with the hidden chrome:// pages it served.
- 0.2.0: `chromium-context-menu-hosted.patch`, with the hidden "ghost" Browser windows
  (`docs/research/chrome-hosted-window.md`).

## Using it

The app's build (`apps/browser/macos`) stages `out/Release_GN_arm64/Chromium Framework.framework` itself
(`packages/nncore/scripts/stage-framework.sh`, under the chromium lock) and embeds it (`embed.sh`). A checkout without a
Chromium tree downloads the prebuilt engine matching `engine/` instead (`packages/nncore/scripts/fetch-engine.sh`,
published with each release whose engine changed; `docs/releasing.md`). After an engine change, rebuild incrementally
(`scripts/agent/engine-build`, or `scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework`)
and the next app build picks it up.

## Our hooks in Chrome's code

Where our patches and `engine/nncore/apply.sh` let NNCore decide something in Chrome's code, the hook is a
`g_netnyahoo_*` function pointer (or flag) defined in the Chrome file that calls it, `extern` where another file shares
it; unset, Chrome behaves as stock. (Some changes are direct instead: `ChromeMain` making NNCore's main delegate, the
PiP window factory, the `CHECK`s made tolerant of a Browser without a `BrowserView`.) NNCore sets the patches' hooks as
the browser process starts (`NNMainDelegate::PreSandboxStartup`), in `nncore::InstallChromeHooks` (`nn_seams.mm`: the
password bubble, the extension install prompt, device choosers, the Cast dialog, extension side panels, hidden
windows, windows without tabs, docked DevTools' changes, the WebContentsDelegate (H2), and `g_netnyahoo_viewless_browsers`, which apply.sh's toast and
reading mode hooks read); apply.sh's other hooks are set next to the code they serve.

`apply.sh` also adds H1–H6, which stand where CEF's patches had seams NNCore used. "Is this Browser ours" is
`WindowHost::ForBrowser`: NNCore's record (`nn_browser_window.h`), made when a Browser gets one of NNCore's
`NNBrowserWindow`s and dropped when its `NNWebContentsDelegate` goes in `~Browser`, after the window.

| Hook | Where | What | Replaces |
|---|---|---|---|
| H1 | `browser.cc` | With `g_netnyahoo_browser_window_factory` set, a Browser may take the host's own `BrowserWindow` (`params.window`) without `CHECK_IS_TEST` | CEF's removed `CHECK` |
| H2 | `browser_window_features.cc` `InitPostWindowConstruction` | `g_netnyahoo_create_web_contents_delegate` makes NNCore's `BrowserWebContentsDelegate` for its Browsers | `cef::BrowserDelegate::CreateWebContentsDelegate` |
| H3 | `permission_prompt_factory.cc` | `g_netnyahoo_create_permission_prompt` | `SetCreatePermissionPromptFunction` |
| H4 | `render_view_context_menu_mac_cocoa.mm`, `_mac_remote_cocoa.mm` (and views) | `g_netnyahoo_context_menu_show` | `RegisterMenuShowHandlerCallback` |
| H5 | `chrome_main_delegate.cc` | `g_netnyahoo_resource_bundle_delegate`, passed where Chrome inits the shared ResourceBundle | CEF's `GetResourceBundleDelegate()` |
| H6 | `chrome_main_delegate.cc`, `chrome_browser_main.cc`, `chrome_browser_main_mac.mm`, `chrome_content_browser_client.cc`, `chrome_browser_policy_connector.cc` | `g_netnyahoo_embedder` (set by `NNMainDelegate` in every process) skips at run time what `chrome_runtime.patch` compiled out under `ENABLE_CEF`: `InitializeUserDataDir` and startup metrics, `RecordCoreSystemProfile`, the sampling profiler (NNCore starts its own), crash keys, the crash reporter and crashpad; first-run prefs and first run, `--make-default-browser`, `StartupBrowserCreator::Start` and the `RunLoop`; `AppController` and `BuildMainMenu`, `didEndMainMessageLoop`; the `HandleWebUI` handler pair. And no platform policy provider (`CreatePlatformProvider`), as CEF made none without a policy id: the macOS one's first load ran on the main thread before `BrowserMain`, waiting for `/usr/bin/profiles`, 10–20 ms of every launch | `chrome_runtime.patch`'s `#if !BUILDFLAG(ENABLE_CEF)` blocks; `chrome_browser_policy.patch`'s `CreatePlatformProvider` |

## The offline page

Wherever Chrome would start the dino (`LocalizedError::IsOfflineError`: `ERR_INTERNET_DISCONNECTED`, or a DNS
probe that ends in `DNS_PROBE_FINISHED_NO_INTERNET`; main frames only; not with `--disable-dinosaur-easter-egg`),
`NetErrorHelper` serves `IDR_NETNYAHOO_YAHU_HTML` instead of `neterror.html`: the game from
`apps/browser/assets/offline-game`, one self-contained document (2.5 MB, brotli in `resources.pak`: CSS, scripts and
manifest inline, every WebP a `data:` URL, a CSP that allows exactly those inline blocks by hash). Its
`<script type="application/json" id="yahu-error">` block gets `{code, url}` of the failed load, which the game reads as
`window.YAHU_ERROR`. Every other error keeps Chrome's page. A DNS probe that turns the page offline after it loaded
swaps the game's document in (`document.write`), where Chrome's page would start the dino. The page runs as Chrome's
error page, so Retry is `errorPageController.reloadButtonClick()` and the best score is Chrome's easter-egg high
score (`trackEasterEgg` / `updateEasterEggHighScore`).

`chrome://yahu` (the app's `netnyahoo://yahu`) is an alias of `chrome://dino`: a simulated `ERR_INTERNET_DISCONNECTED`
whose page plays the game on its own, without the offline header. Tabs, popups and side panels share the renderer, so
all of them show it.

The resource file is generated, not patched in: `yahu-resource.sh` runs
`apps/browser/assets/offline-game-pipeline/inline.py` (Python standard library only) into
`components/neterror/resources/yahu/yahu.html` of the Chromium tree. `apply-chromium-patches.sh` and step 5 run it,
so every build ships the game folder as it is; `NN_REPO` (in `env.sh`, default `~/Documents/netnyahoo`) says where the
checkout is. The sprites stay at the art pipeline's 400 px: at the default zoom the front rows already draw them at
about 1:1 on a 2x screen, so 256 px sprites (about 1 MB) would be visibly soft.

## Nothing writes into the app bundle

The signature seals every file in `Netnyahoo.app`, so the app must never write there: one added file and
`codesign --verify --deep --strict` fails ("a sealed resource is missing or invalid"), and an app on a read-only
volume or run translocated can't be written at all. A background run of a signed build, with pages, PDFs, the offline
page, chrome://settings, chrome://extensions, chrome://components and uBlock's own pages, then a diff of the bundle,
found one writer (2026-09-25):

- **declarativeNetRequest indexes next to the extension.** An extension's static rulesets are indexed into
  `<extension>/_metadata/generated_indexed_rulesets/_ruleset<N>`, a path Chrome derives from the extension's folder
  (`FileBackedRulesetSource::CreateStatic`). The ruleset checksums live in the profile's prefs, so a profile with none
  (every new profile; component extensions are never "installed") indexes again, and so does any profile whose
  indexes go stale (a new indexed format in a Chrome update). Shipping prebuilt indexes wouldn't stop the writes.
  So `NNCoreContentBlocker.mm` loads uBlock Origin Lite from a copy in the data directory,
  `<data dir>/Built-in Extensions/ublock-lite` (an APFS clone of the bundled folder, made writable, next to
  `Chromium`), and copies it again when the bundled extension changes (`ublock-lite.source` holds the manifest's
  SHA-256, file count and size). Chrome's indexes persist in the copy, so later launches load them without indexing.
  Netnyahoo 0.1.0 loaded it straight from the bundle: its first launch wrote the six indexes into the bundle, and
  from a read-only bundle nothing was blocked at all.

Everything else Chrome writes (component updater, caches, extension installs) goes to the user data dir, and
`MacAppCodeSignClone` is disabled (`NNCoreHost.mm`). `scripts/release.sh` launches the exported app once and verifies
the signature again, so a new writer fails the release.

## NNCore's layer: `//netnyahoo/core`

NNCore (`docs/nncore-spike.md`) is our own layer over Chrome. `engine/nncore/apply.sh` copies `engine/nncore/src` to
`//netnyahoo/core` and adds its hooks: in files only Chrome's framework compiles (`chrome/BUILD.gn`'s macOS
`chrome_dll`, `chrome/app/chrome_main.cc`), H1–H6 ([above](#our-hooks-in-chromes-code)), and a few `CHECK`s made
tolerant of a Browser without a `BrowserView` (`read_anything_side_panel_controller.cc`, `sad_tab_controller.cc`…).
Run `apply.sh` again after anything that resets these files (steps 1–4); `apply.sh --check` reports drift.

## Our own code in the tree: `chrome/browser/netnyahoo`

New engine code is plain Chromium code in new files (`docs/architecture-review.md`, rec. 4). It lives in
`//chrome/browser/netnyahoo`, calls Chrome's services directly (`PasswordStoreInterface`, `PersonalDataManager`,
`ExtensionRegistrar`, `HostZoomMap`, `TemplateURLService`, `HistoryService`…) and is exported as plain C from Chrome's
framework.

- **Where it lives.** `engine/chromium/src` mirrors `chromium/src`; `engine/chromium/apply.sh` copies it in
  (`--check` reports drift). This is NNCore's convention too (`engine/nncore/src` → `//netnyahoo/core`). Edit the
  repo copy only; `apply.sh` replaces the tree's.
- **How it links.** One `source_set("netnyahoo")` in `chrome/browser/netnyahoo/BUILD.gn`: add your
  `nn_<domain>.{h,cc}` to its sources (sorted) and its deps.
  `chromium-netnyahoo-layer.patch` links it into the macOS `//chrome:chrome_dll` (NNCore's framework), through the
  `:exports` group that exports `_nn_*`.
- **The C surface.** `public/nn_engine.h` is plain C with the rules: exports are `nn_<domain>_<verb>`, all with one
  signature `void (const char* profile_dir, const char* args_json, nn_engine_reply_t reply, void* context)`; JSON
  object in, JSON object out (`{"error": …}` on failure); UI thread only; the reply runs once, maybe before the
  call returns. Events go to one sink (`nn_engine_set_event_sink`) as `("<domain>.<what>", {profile, …})`.
  `nn_engine.h` has the C++ side (`NN_ENGINE_CALL`, `netnyahoo::Call`, `Reply`, `Emit`).
- **The app** includes `public/nn_engine.h` from the repo and looks each export up with `dlsym` on the engine
  framework (`packages/nncore/ios/NNCoreEngineBridge.mm`). A missing export aborts: the app bundles an engine it wasn't built
  for. Add each new call to `docs/nncore-parity.md`.

## The patch series

`engine/patches/series` is the one place that says what goes into the tree and in what order: `chromium <patch>`
lines (after ungoogled-chromium and domain substitution, step 4), then `layer <dir>` lines (our own files,
`<dir>/apply.sh`). Each patch is made against the tree as every line above it leaves it, and covers one concern, named
for it. A new patch goes where it belongs in the file; names no longer carry the order.

`engine/patches/series.py` does everything with it:

- `apply [--phase chromium]`: applies the series to the tree, skipping what is applied (step 4 runs it, through
  `apply-chromium-patches.sh`).
- `capture-base`: records every file the series touches as it is before the series (the base). Step 4 runs it
  just before it applies the series, so a fresh or rebased checkout records its own; `01-sync.sh` clears the old
  one. It lives in `~/chromium-build/series-base` (`NN_SERIES_BASE`).
- `check`: copies the base to a scratch directory, applies the whole series there strictly (`git apply`: exact
  context, no fuzz; each layer's `apply.sh` with `CHROMIUM_SRC` pointed at the scratch copy) and compares every
  touched file with the tree, byte for byte. Exit 0 means the series reproduces the engine we build; otherwise it
  lists each step that no longer applies and each file the series doesn't reproduce (an edit made in the tree but
  not in a patch, or the reverse), and keeps the scratch copy for `diff -u`. It writes nothing else and needs no
  lock.
- A file the series starts touching later (a new hook) needs its base too: run `capture-base` before the hook
  first goes into the tree. On an applied tree that's safe: it only records files the base lacks, never one a patch
  creates. `apply` dry-runs each patch first and refuses one that is partly in already, instead of applying its other
  hunks twice. Until then `check` takes the checkout's git HEAD for it and says so, which is right only when nothing
  upstream changes that file.
- `materialize --until <patch> <dir>`: the touched files as the series leaves them after one line. To remake a
  patch, materialize the line above it, edit a copy, and diff.
- `files`: what each line touches.

Run `check` after any patch change, before committing it. For a nightly run on this machine (a local launchd job;
nothing remote is set up), point a LaunchAgent at it, for example `~/Library/LaunchAgents/com.netnyahoo.series-check.plist`
with `ProgramArguments` `/usr/bin/python3`, `<repo>/engine/patches/series.py`, `check`, a
`StartCalendarInterval` of 03:00 and `StandardOutPath` `~/chromium-build/logs/series-check.log`. A CI machine
needs only the repo plus a copy of the base and the tree's touched files: `CHROMIUM_SRC` and `NN_SERIES_BASE` say
where they are.

## Rebuilding

Everything lives outside the repo in `~/chromium-build`, which carries `.metadata_never_index`.
The step scripts are copied in `engine/patches/build/`, and each expects `~/chromium-build`. Run them under the
chromium lock (`scripts/agent/locked chromium`), in the order 1, 3, 4, 2, 5 on a fresh checkout (`gn gen` once the
tree is patched).

| Step | Script | Time (M5 Pro, shared machine) |
|---|---|---|
| 1. `gclient sync --no-history` of Chromium's tag (`CHROMIUM_VERSION` in `env.sh`) for the Mac, then its hooks; clears the series base | `01-sync.sh` | ~40 min, 30 GB |
| 2. Write `out/Release_GN_arm64/args.gn` from `gn_defines.sh`, then `gn gen` | `02-gn-args.sh` | ~1 min |
| 3. ungoogled-chromium's series, with the exceptions below | `03-ungoogled.py` | 2 min |
| 4. Domain substitution, minus the store files (`domsub-keep-store.txt`), then our series: `apply-chromium-patches.sh` (`series.py capture-base` and `apply --phase chromium`, then the layers `engine/chromium/apply.sh` and `engine/nncore/apply.sh`) | `04-domain-substitution.sh` | 5 min |
| 5. Regenerate the offline page (`yahu-resource.sh`), compile `chrome_framework` (NNCore; the app's build stages it from `out/Release_GN_arm64`) | `05-build.sh` | first build about 2 h; incremental 20 s–2 min |

Disk: about 43 GB in total. That's 40 GB for the checkout with its 10 GB out dir and 0.2 GB for the
domain-substitution cache.

Rules for editing the tree after the first build:

- **GN args** live in `gn_defines.sh`, the complete list (the args CEF's `gn_args.py` used to merge in are there
  too): a non-official Release build (no ThinLTO/PGO, no DCHECKs, no symbols), proprietary codecs, Widevine (DRM
  still needs Google's VMP signing), Netnyahoo branding, and ungoogled's `flags.gn` minus the exceptions below.
  After changing them, run step 2 again.
- **Moving to a new Chromium version.**
  1. Revert domain substitution:
     `python3 ungoogled/utils/domain_substitution.py revert -c domsubcache.tar.gz chromium_git/chromium/src`.
  2. Set `CHROMIUM_VERSION`, `UNGOOGLED_TAG` and `UNGOOGLED_MACOS_TAG` in `env.sh` (ungoogled's lists are made
     for exactly one Chromium version) and check those tags out in `~/chromium-build/ungoogled{,-macos}`.
  3. Re-run `01-sync.sh`, then steps 3, 4, 2 and 5.
  4. Our patches and the hooks may need their context refreshed; `series.py check` and `apply.sh --check` say
     which.

## ungoogled-chromium

The patch set comes from the 154.0.8037.97-1 series plus the macOS repo's (154.0.8037.97-1.1)
`fix-disabling-safebrowsing.patch` (`UNGOOGLED_TAG`, `UNGOOGLED_MACOS_TAG` in `env.sh`). The full list with reasons
is `engine/patches/ungoogled-status.tsv`; the exceptions are `03-ungoogled.py`'s. `disable-gcm` now applies in full
(CEF's own GCM stub went with CEF). The other exceptions first made for CEF are kept as the CEF-era build had them:
a behaviour decision for later, no longer a build need.

**Partial:**

- `0021-disable-rlz`: `rlz/buildflags/buildflags.gni` is left out, so `enable_rlz` stays true (CEF required it).
  RLZ stays inert: there's no brand code, and its host is substituted.
- `add-flag-to-show-avatar-button` and `add-flag-for-incognito-themes`: their hunks in Chrome's toolbar and frame are
  left out (they conflicted with CEF's patches there); NNCore never shows either.
- `0005-disable-default-extensions`: its WebstoreInstaller stubs are dropped.
- `0006-modify-default-prefs`: saving passwords and autofilling addresses and cards stay on, because
  Chrome's password manager and autofill are used (locally). Autosign-in stays off.
- `block-requests`: its early `return` in `UpdateCheckerImpl::CheckForUpdates` is undone
  (`chromium-extension-updates.patch`), so Web Store extensions auto-update. The component updater's
  hosts stay unreachable through domain substitution.

**Not applied (they assume `safe_browsing_mode=0` or disabled mdns; Safe Browsing and mdns stay compiled in):**

- `0001-fix-building-without-safebrowsing`
- `remove-unused-preferences-fields`
- `move-js-optimizer-unfamiliar-sites`
- `fix-building-without-mdns-and-service-discovery`

**Also not applied:**

- `enable-extra-locales`: not privacy-related (it broke CEF's string packs).
- `disable-webstore-urls`: the Web Store and extension updates are needed (user decision).

**Skipped:**

- Pruning and its two fixes: a gclient checkout keeps its prebuilt toolchains.
- Two Linux-only patches.
- Two build fixes for `safe_browsing_mode=0`.

**Other changes:**

- A fixup guards ChromeContentBrowserClient's ScreenAI sandbox code with
  `ENABLE_SCREEN_AI_SERVICE`.
- GN flags not used: `safe_browsing_mode=0`, `enable_mdns=false`, `enable_service_discovery=false`
  and `enable_reporting=false`. Domain substitution already cuts off their Google endpoints.
- Domain substitution skips the Web Store and extension-updater sources (`domsub-keep-store.txt`),
  so chromewebstore.google.com, clients2.google.com and clients2.googleusercontent.com work.
  Everything else Google stays substituted. That includes the component updater (the Widevine CDM
  download), spell-check dictionaries, Safe Browsing list updates and the CWS info service.
- A `--log-net-log` capture of an app session showed no Google hosts. The only attempt was Safe
  Browsing's update to a substituted, blocked host.

## Tab capture

A page that calls
`getUserMedia({video: {mandatory: {chromeMediaSource: "desktop", chromeMediaSourceId: id}}})`
captures the tab behind `id`; Chromium's `DesktopMediaID::Parse` already understands the id. Asking
for `audio: {mandatory: {chromeMediaSource: "desktop"}}` gets that tab's audio instead of system
audio. Capturing reads Chromium's own compositor frames, so macOS asks for no Screen Recording
permission.

In the app:

- The WebView method `mediaCaptureSourceId()` returns the id.
- The share picker answers a `displayMediaRequest` with that id, and the page script adds tab audio
  when the page asked for audio.
- The answer lets one getUserMedia request of the asking frame, within 15 s, capture exactly the picked
  source (`nn_desktop_capture.mm`), with desktop audio only for a tab the page asked audio of.
  Anything else is refused: the page script runs in the page's world, so the page decides what
  getUserMedia asks for.
- Desktop getUserMedia without a picked source is refused outright, with no prompt (as in Chrome, where
  only `getDisplayMedia` and its picker capture the screen). Only camera and microphone get a permission
  prompt.

Verified in the app: a "Tab" track at 1558×1080 delivering frames, plus a "Tab Audio" track.

## CEF's 117 patches

What became of each patch in CEF 154's `patch/patches` (branch 8037) when CEF left the tree. "Dropped" means
NNCore doesn't need it: it serves a platform we don't ship, off-screen rendering (OSR), CEF's Alloy runtime, CEF's
own API, Views or build, or crash upload.

| Patch | Now |
|---|---|
| `angle_commit_config` | dropped (CEF source tarballs) |
| `base_command_line_1872` | dropped (CEF API: lower-case switch names) |
| `base_logging_3951` | dropped (Windows bootstrap) |
| `base_rand_util_lazy_seed` | dropped (Windows DCHECK builds) |
| `base_test_4396276` | dropped (CEF's test binaries) |
| `base_thread_pool_5548577` | dropped (CEF's multi-threaded message loop; Windows/Linux only) |
| `blink_ax_viewport_collapse` | dropped (CEF API: accessibility tree collapse) |
| `blink_web_element_4200240` | dropped (CEF API) |
| `blink_window_size_3714` | dropped (CEF's Document PiP options) |
| `browser_scheduler` | dropped (multi-threaded message loop shutdown) |
| `browser_security_policy_1081397` | dropped (CEF's custom schemes) |
| `chrome_autofill_bubble_3796` | folded (`chromium-autofill-address-bubble-window`) |
| `chrome_browser` | dropped (CEF build) |
| `chrome_browser_browser` | hook (H1, H2); folded (`chromium-cef-carryover`: `DeleteBrowser` order, the tab strip API's colour provider without an active tab; `chromium-ui-update-before-insert`: the `browser_ui_controller` guard); rest dropped |
| `chrome_browser_content_settings` | dropped (a `NOTREACHED` only CEF's tests hit) |
| `chrome_browser_context_menus` | hook (H4) |
| `chrome_browser_devtools_osr` | dropped (OSR) |
| `chrome_browser_dialogs_jsmodal` | dropped (Alloy, OSR) |
| `chrome_browser_dialogs_misc` | dropped (OSR; CEF's toolbar-less extension dialog anchor) |
| `chrome_browser_dialogs_native` | dropped (CEF API: file dialog interception) |
| `chrome_browser_dialogs_widget` | dropped (OSR dialog parents, CEF Views) |
| `chrome_browser_download` | dropped (CEF API: download delegate) |
| `chrome_browser_extensions` | dropped (Alloy tabs API, CEF's PDF viewer delegate) |
| `chrome_browser_extensions_background` | folded (`chromium-cef-carryover`: `gn gen` asserts without it, given `enable_background_mode=false`) |
| `chrome_browser_frame_mac` | dropped (CEF Views) |
| `chrome_browser_metrics_tpm_476896967` | dropped (a Windows TPM driver crash) |
| `chrome_browser_permission_prompt` | hook (H3) |
| `chrome_browser_policy` | dropped (CEF API: policy configuration) |
| `chrome_browser_printing_oop_osr` | dropped (OSR) |
| `chrome_browser_privacy_1119417` | dropped (CEF build; Windows/Linux) |
| `chrome_browser_profile_menu` | dropped (Chrome's profile menu, which NNCore never shows) |
| `chrome_browser_profiles` | dropped (CEF's incognito request contexts) |
| `chrome_browser_safe_browsing` | dropped (component build) |
| `chrome_browser_startup` | dropped (CEF API: process singleton) |
| `chrome_browser_task_manager` | dropped (multi-threaded message loop shutdown) |
| `chrome_browser_views_dangling_rawptr` | dropped (Chrome's toolbar, which NNCore never shows) |
| `chrome_browser_webui_license` | dropped (CEF's chrome://license) |
| `chrome_browser_webui_version` | dropped (CEF's chrome://version) |
| `chrome_common_logging` | dropped (CEF build: logging on in Release) |
| `chrome_plugins` | dropped (CEF API) |
| `chrome_renderer` | dropped (CEF build) |
| `chrome_renderer_print_preview` | dropped (CEF API: per-frame print preview) |
| `chrome_runtime` | hook (H5, H6); its `ConfigureNetworkContextParams` `bool` return and `CleanupOnUIThread` dropped |
| `chrome_runtime_views` | dropped (CEF Views) |
| `color_provider_manager_3610` | dropped (CEF Views) |
| `component_build` | dropped (component build) |
| `component_updater_4087` | dropped (CEF API: component updater) |
| `components_gcm_disable` | dropped (ungoogled's `disable-gcm` now applies in full) |
| `config_3892` | dropped (CEF API: preferences and variations) |
| `content_2015` | dropped (NNCore's `ConfigureNetworkContextParams` is `void` again) |
| `content_main_654986` | dropped (CEF's split `ContentMain`; NNCore starts through `ChromeMain`) |
| `content_throttle_registry` | dropped (CEF API) |
| `crashpad_1995` | dropped (CEF's crash reporting; crashpad stays off) |
| `crashpad_tp_1995` | dropped (crash upload) |
| `dawn_dxil_redist` | dropped (Windows) |
| `devtools_ai_assistance_skills` | dropped (CEF build: DevTools' AI assistance bundle) |
| `embedder_product_override` | dropped (CEF API: User-Agent product) |
| `gn_config` | dropped (CEF build) |
| `gritsettings` | dropped (CEF build) |
| `libxml_visibility` | dropped (CEF build) |
| `light_mode_3534` | dropped (CEF's force-light/dark mode switches) |
| `linux_assets_path_1936` | dropped (Linux) |
| `linux_atk_1123214` | dropped (Linux) |
| `linux_chrome_widevine_3149` | dropped (Linux) |
| `linux_glib_deprecated_volatile` | dropped (Linux) |
| `linux_gtk_theme_3610` | dropped (Linux) |
| `linux_gwp_asan_3803` | dropped (Linux) |
| `linux_printing_context` | dropped (Linux) |
| `mac_chrome_locale_3623` | folded (`chromium-cef-carryover`) |
| `mac_event_observer_2539` | dropped (CEF's own `NSApplication`; NNCore runs Chrome's) |
| `mac_fling_scheduler_2540` | dropped (OSR) |
| `mac_keyboard_conversion_1467329` | folded (`chromium-cef-carryover`) |
| `mac_platform_style_bubble_893292` | folded (`chromium-cef-carryover`) |
| `mac_print_preview_modal` | folded (`chromium-cef-carryover`) |
| `mac_render_widget_3680` | dropped (CEF Views: `acceptsFirstMouse`) |
| `message_loop` | dropped (Windows; multi-threaded message loop) |
| `metrics_system_profile` | dropped (multi-threaded message loop) |
| `mime_handler_view_guest_1565_2727` | dropped (OSR) |
| `mojo_connect_result_3664` | dropped (CEF API) |
| `net_cookie_flags` | dropped (CEF API: per-request cookies) |
| `net_test_server_3798752` | dropped (tests) |
| `net_url_request_3596` | dropped (CEF's custom schemes) |
| `osr_fling_2745` | dropped (OSR) |
| `osr_win_remove_keyed_mutex_2575` | dropped (Windows OSR) |
| `printing_context_2196` | dropped (Linux) |
| `raw_ptr_3239` | dropped (CEF's directory listing) |
| `renderer_host_1070713` | dropped (CEF API: background colour) |
| `renderer_host_aura` | dropped (Aura: Windows/Linux) |
| `resource_bundle_2512` | dropped (CEF's threading) |
| `rfh_navigation_4829483` | dropped (CEF's custom schemes and window callback) |
| `runhooks` | dropped (Windows toolchain) |
| `screen_1443650` | folded (`chromium-cef-carryover`) |
| `services_network_2622` | dropped (CEF API: cookieable schemes) |
| `services_network_2718` | dropped (the `bool` `ConfigureNetworkContextParams`) |
| `set_resize_background_color` | dropped (CEF Views) |
| `tarball_deps` | dropped (CEF source tarballs) |
| `tarball_gclient` | dropped (CEF source tarballs) |
| `trace_event` | dropped (CEF's trace categories) |
| `ui_base_x11_util` | dropped (Linux) |
| `ui_dragdrop_355390` | dropped (Linux) |
| `ui_menu_model_3577` | dropped (CEF menus) |
| `ui_views_widget_type` | dropped (CEF Views; Linux) |
| `v8_build` | dropped (CEF build) |
| `views_1749_2102_3330` | dropped (CEF Views and menus) |
| `views_textfield_5399416` | dropped (CEF Views) |
| `views_widget` | dropped (CEF Views: external parents; mostly Windows/Linux) |
| `viz_capture_3826` | dropped (OSR) |
| `viz_osr_2575` | dropped (OSR) |
| `web_contents_1257_1565` | dropped (OSR, CEF API) |
| `webkit_move_pip` | dropped (CEF's Document PiP options) |
| `webkit_plugin_info_2015` | dropped (CEF API) |
| `win_app_icon_3606` | dropped (Windows) |
| `win_ax_platform_node` | dropped (Windows) |
| `win_sandbox_3210` | dropped (Windows) |
| `win_shell_dialogs_3294` | dropped (Windows) |
| `win_taskbar_decorator_3645` | dropped (Windows) |
| `win_taskbar_group_3641` | dropped (Windows) |

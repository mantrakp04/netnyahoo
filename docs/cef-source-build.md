# Building the engine from source

Netnyahoo runs on NNCore: Chrome's own framework (`//chrome:chrome_framework`) built from our patched Chromium 154
tree, with our layers linked in (`docs/nncore-spike.md`). The tree is the one we built CEF from (CEF branch 8037 at
154.0.28+g564dd6c, Chromium 154.0.8037.58). It still carries CEF's checkout (`//cef`, never built) and CEF's own
patches to Chrome's code, which CEF's patcher applies in step 2, until the next Chromium bump: NNCore still fills a few
of their seams (`nn_cef_seams.mm`, [below](#our-hooks-in-chromes-code)). Our own CEF patches (`cef-*.patch`, the CEF
runtime's API the app used before NNCore) went on 2026-10-08; CEF's native side left the repo with the NNCore cutover,
2026-10-01.

What the build adds:

- **H.264 / AAC.** Set with `proprietary_codecs=true` and `ffmpeg_branding="Chrome"`; H.264 decodes
  through VideoToolbox.
- **ungoogled-chromium** 154.0.8037.57-1. Its patch series and domain substitution strip Google
  background services; see [ungoogled-chromium](#ungoogled-chromium). The Chrome Web Store and
  extension auto-updates are deliberately kept working.
- **Our patches**, in `engine/patches/`, applied in the order `engine/patches/series` gives (see
  [The patch series](#the-patch-series)):

| Patch | What it does |
|---|---|
| `chromium-webview-native-hosted.patch` | `views::NativeHostedContents`: `views::WebView` never attaches marked tabs (CEF's hosted tabs; NNCore marks none, so it goes at the bump) |
| `chromium-browser-view-hosted-fullscreen.patch` | Tab fullscreen of hosted tabs leaves the Browser window to the app: Chrome only tracks the state, and the app shows the page full screen itself (CEF's BrowserView-hosted tabs; NNCore's Browsers have no BrowserView) |
| `chromium-ui-update-before-insert.patch`, `chromium-tab-strip-notify-before-insert.patch` | Fix a CHECK when a tab loads before it's in the tab strip (CEF sets the delegate early) |
| `chromium-extension-window-hidden.patch` | The windows of NNCore's own pages are invisible to chrome.windows/tabs (`g_netnyahoo_hidden_from_extensions`, also read by the next patch and apply.sh's `browser_window_util` hook) |
| `chromium-password-bubble-hook.patch` | NNCore may replace Chrome's password bubble (`g_netnyahoo_password_bubble`) |
| `chromium-extension-install-prompt-hook.patch` | NNCore may replace Chrome's extension install dialog (`g_netnyahoo_extension_install_prompt`) |
| `chromium-branding.patch` | Netnyahoo's bundle and team id (`branding_file_path`), for the passkey and payments keychain access groups; product names stay "Chromium" |
| `chromium-icloud-keychain-window.patch` | iCloud Keychain's passkey sheet attaches to the tab's own window when it isn't a `views::Widget` |
| `chromium-safe-storage-name.patch` | The Safe Storage key lives in its own "Netnyahoo Safe Storage" keychain item, account "Netnyahoo". **Load-bearing:** it's Chromium's own `os_crypt` code, so NNCore uses it too, and every user's saved passwords and cookies are encrypted with that item's key. Keep it, unchanged, through every re-sync (plain Chromium for NNCore, a version bump); without it Chrome reads "Chromium Safe Storage" and nothing decrypts |
| `chromium-device-chooser-hook.patch` | `chrome::ShowDeviceChooserDialog` asks NNCore first (`g_netnyahoo_device_chooser`) |
| `chromium-cast-dialog-hook.patch` | The Media Router's Cast dialog (and Presentation API requests) asks NNCore first (`g_netnyahoo_wants_cast_dialog`, `g_netnyahoo_cast_dialog`) |
| `chromium-side-panel-hook.patch` | `side_panel_util` asks NNCore first for an extension's side panel (`g_netnyahoo_extension_side_panel`) |
| `chromium-hidden-window-current-window.patch` | Extension pages in hidden windows (our popups and side panels) take the last active window as their current window |
| `chromium-extension-updates.patch` | Undoes ungoogled's early `return` in `UpdateCheckerImpl::CheckForUpdates`, which left every update check pending: Web Store extensions never updated |
| `chromium-window-docked-devtools.patch` | DevTools may dock in NNCore's own windows (`g_netnyahoo_allows_docked_devtools`, an exception in CEF's "no docking in CEF browsers" hunk), and `DevtoolsUIController::UpdateDevtools` tells NNCore of every change to a tab's docked DevTools (`g_netnyahoo_devtools_dock_changed`). `NativeHostedContents::Unmark` for DevTools that undock (CEF-era, unused) |
| `chromium-devtools-redock-display.patch` | A `RenderWidgetHostViewMac` that a `views::WebView` gives up (`SetParentUiLayer(nullptr)`) draws into its own NSView again. Chrome switched it to the Views compositor for good the first time it was attached, so DevTools docked back from their own window stayed blank in the client's view |
| `chromium-window-hosted.patch` | `BridgedContentView.netnyahooEmbeddedView`: hit testing and accessibility ask the embedder's subview of a Chrome window's content view first. A Browser NNCore says so of (`g_netnyahoo_keeps_window_without_tabs`) stays open when its last tab closes, unless the window is closing. The popup layout for a tab-strip-less CEF client window is CEF-era and unused |
| `chromium-devtools-window-title.patch` | DevTools' title is Dia's, "Developer Tools - <url>" (`DevToolsUIBindings` `kTitleFormat`), so Chrome's own undocked DevTools window says so too |
| `chromium-neterror-yahu.patch` | "Where's Big Yahu?" replaces the dino: the offline page and chrome://yahu (below) |
| `chromium-autofill-card-touchbar.patch` | `WebTextfieldTouchBarController` gets no touch bar for a Browser window without a `BrowserNativeWidget` (CEF's views-hosted windows): showing the card autofill dropdown crashed the app there, on any secure page with a saved card |
| `chromium-autofill-address-bubble-window.patch` | Chrome's offers to save or update an address find the tab's `BrowserWindow` through its Browser when it has no `BrowserView` (NNCore's): `FindBrowserWindowWithWebContents` finds BrowserViews only, so the offers never reached NNCore's bubble handler |
| `chromium-password-generation-local.patch` | Chrome offers "Suggest strong password" without password sync (`PasswordFeatureManagerImpl::IsGenerationEnabled`); generated passwords save to the profile's local store like any other. With no account, its popup says "Passwords are saved to Password Manager on this device." instead of "…saved to Google Password Manager for ." |
| `chromium-extension-installed-bubble.patch` | Chrome's "<extension> has been added" bubble (`ShowInfoDialog`): a window without Chrome's toolbar (every client window) gets it as a bubble under the top-right corner of the window, with a close button, closing on Esc and when the window is clicked. Chrome fell back to a browser-modal sheet there, with no buttons and no way to dismiss it. The app renames "Chromium" in Chrome's strings itself (`nn_strings.cc`) |
| `chromium-netnyahoo-layer.patch` | The macOS `//chrome:chrome_dll` (NNCore's framework) links `//chrome/browser/netnyahoo` and exports its `nn_*` calls |
| `chromium-pip-close-keeps-playing.patch` | The video Picture in Picture window's close button (and the window going away any other way) closes it without pausing the video, which keeps playing in its tab, as in Dia and Arc. Chrome paused it whenever the window had a play/pause button (`VideoOverlayWindowViews::CloseAndPauseIfAvailable`, `OnNativeWidgetDestroyed`). Back to tab and the page's own `exitPictureInPicture()` never paused |
| `chromium-pip-overlay-window.patch` | Chrome makes our `NetnyahooVideoOverlayWindow` (`chrome/browser/netnyahoo/pip/`, a `VideoOverlayWindowViews` subclass with its own buttons, progress bar, fade and bounds memory; the hook makes six methods virtual): Dia's video Picture in Picture window (measured in `docs/dia-spec.md` › Picture in Picture): nothing but the video at rest (the origin shows only with the controls); on hover a 35 % black scrim, back to tab (top left) and close (top right) as 28 pt rounded squares with 1 pt line glyphs, the origin centred in 13 pt, a bare play/pause glyph and a 5 pt progress bar that seeks; no skip, time, mute, captions or minimize controls (the keyboard shortcuts stay). Controls fade in 200 ms ease-in-out. The window shows at once and fades out in Core Animation (100 ms from the close button, 70 ms otherwise, smooth while the tab is being shown), and a new window opens where the last one was left, sized to the new video and kept on screen (`NetnyahooPictureInPicture.plist` in the user data dir) |

Removed on 2026-10-08, after the NNCore cutover: our 18 `cef-*.patch` to CEF's own tree (the CEF runtime's API and
behaviour the app used before NNCore: Chrome-style tab hosting, tab capture and state, the Chrome UI and autofill
hand-offs, client windows and their keys, translucency and docked DevTools, the external message pump, popups' URL
params, media routing, extension requests, and `cef-netnyahoo-layer.patch`, which linked our code into `libcef_static`).
NNCore never compiled them; the hooks of theirs it used are now [our own](#our-hooks-in-chromes-code). Git history has
them and the `CEF_NN_*` API they documented.

Removed in 0.2.0, with the hidden "ghost" Browser windows they served (every app window is now Chrome's own,
`docs/research/chrome-hosted-window.md`): `chromium-context-menu-hosted.patch` (the context menu's widget lookup
fell back to the tab's Browser window; a tab's view is now always in a Chrome window, so the stock lookup finds
it).

Removed after 0.2.19 with the hidden chrome:// pages they served (their callers now use
[our own code](#our-own-code-in-the-tree-chromebrowsernetnyahoo)): `chromium-zz-extensions-page-uninstall.patch`
(chrome://extensions could uninstall without Chrome's dialog) and its marker, `cef-zz-quiet-uninstall.patch`
(`CEF_NN_QUIET_UNINSTALL`).

## Using it

The app's build (`apps/browser/macos`) stages `out/Release_GN_arm64/Chromium Framework.framework` itself
(`packages/nncore/scripts/stage-framework.sh`, under the chromium lock) and embeds it (`embed.sh`). A checkout without a Chromium
tree downloads the prebuilt engine matching `engine/` instead (`packages/nncore/scripts/fetch-engine.sh`, published
with each release whose engine changed; `docs/releasing.md`). After an engine change, rebuild incrementally
(`scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework`) and the next app build picks
it up. (CEF's distribution, `setup.sh`, `engine.lock` and its release asset went with the cutover.)

## Our hooks in Chrome's code

Where our patches and `engine/nncore/apply.sh` let NNCore decide something in Chrome's code, the hook is a
`g_netnyahoo_*` function pointer (or flag) defined in the Chrome file that calls it, `extern` where another file shares
it; unset, Chrome behaves as stock. (Some changes are direct instead: `ChromeMain` making NNCore's main delegate, the
PiP window factory, the `CHECK`s made tolerant of a Browser without a `BrowserView`.) NNCore
sets the patches' hooks as the browser process starts (`NNMainDelegate::PreSandboxStartup`, whatever started
`ChromeMain`), in `nncore::InstallChromeHooks` (`nn_seams.mm`: the password bubble, the extension install prompt, device choosers, the Cast dialog, extension side
panels, hidden windows, windows without tabs, docked DevTools, and `g_netnyahoo_viewless_browsers`, which apply.sh's
toast and reading mode hooks read); apply.sh's other hooks are set next to the code they serve.

CEF's own patches to Chrome add seams of their own, which libcef would fill: `cef::BrowserDelegate::Create` (each
Browser's delegate, where NNCore keeps its per-Browser record), its WebContentsDelegate and DevTools factories,
`GetAlloyTabById`, `IsAlloyContents`, `DownloadManagerDelegate::Create`, `browser_prefs::*` and the PDF viewer's guest
delegate. NNCore fills them in `nn_cef_seams.{h,mm}`, the only NNCore files that include CEF's headers. They go at the
Chromium bump with CEF's patches; NNCore also relies on a few of those patches' changes there (the custom window
`CHECK`, the permission prompt and context menu factories, the ResourceBundle delegate, `ConfigureNetworkContextParams`
returning `bool`), listed in `docs/nncore-spike.md`.

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
whose page plays the game on its own, without the offline header. The renderer is the same for Chrome-style tabs and
Alloy-style views (popups, side panels), so both show it; there is no CEF error page to replace.

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

Everything else Chrome writes (crashpad, component updater, caches, extension installs) goes to the user data dir,
and `MacAppCodeSignClone` is disabled (`NNCoreHost.mm`). `scripts/release.sh` launches the exported app once and verifies the
signature again, so a new writer fails the release.

## NNCore's layer: `//netnyahoo/core`

NNCore (`docs/nncore-spike.md`) is our own layer over Chrome. `engine/nncore/apply.sh` copies `engine/nncore/src` to
`//netnyahoo/core` and adds its hooks: in files only Chrome's framework compiles (`chrome/BUILD.gn`'s macOS
`chrome_dll`, `chrome/app/chrome_main.cc`) and a few `CHECK`s made tolerant of a Browser without a `BrowserView`
(`browser_window_features.cc`, `read_anything_side_panel_controller.cc`, `sad_tab_controller.cc`…). Run `apply.sh`
again after anything that resets these files (steps 2–4); `apply.sh --check` reports drift.

## Our own code in the tree: `chrome/browser/netnyahoo`

New engine code is plain Chromium code in new files, not CEF API (`docs/architecture-review.md`, rec. 4). It lives in
`//chrome/browser/netnyahoo`, calls Chrome's services directly (`PasswordStoreInterface`, `PersonalDataManager`,
`ExtensionRegistrar`, `HostZoomMap`, `TemplateURLService`, `HistoryService`…) and is exported as plain C from Chrome's
framework (it was written while CEF and NNCore both linked it).

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
`<dir>/apply.sh`). CEF's own patches aren't in it: CEF's patcher applies them in step 2. Each patch is made against the tree as every
line above it leaves it, and covers one concern, named for it. A new patch goes where it belongs in the file; names
no longer carry the order.

`engine/patches/series.py` does everything with it:

- `apply [--phase chromium]`: applies the series to the tree, skipping what is applied (step 4 runs it, through
  `apply-chromium-patches.sh`; step 2's `--phase cef` has no lines now).
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
  first goes into the tree. On an applied tree that's safe: it only records files the base lacks, never one a patch creates. `apply`
  dry-runs each patch first and refuses one that is partly in already, instead of applying its other hunks twice. Until then `check` takes the checkout's git HEAD for it and says so, which is right
  only when nothing upstream changes that file.
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
The step scripts are copied in `engine/patches/build/`, and each expects `~/chromium-build`.

| Step | Script | Time (M5 Pro, shared machine) |
|---|---|---|
| 1. Sync CEF 8037 + Chromium 154.0.8037.58 without history (depot_tools, gclient hooks) | `01-sync.sh` | ~40 min, 30 GB |
| 2. CEF's patches, translator, `gn gen` | `02-cef-patch-and-gen.sh` | 2 min |
| 3. ungoogled-chromium series, with the exceptions below | `03-ungoogled.py` | 2 min |
| 4. Domain substitution, minus the store files (`domsub-keep-store.txt`), then the rest of our series (`chromium` and `layer` lines) | `04-domain-substitution.sh` | 5 min |
| 5. Regenerate the offline page (`yahu-resource.sh`), compile `chrome_framework` (NNCore; the app's build stages it from `out/Release_GN_arm64`) | `05-build.sh` | first build about 2 h; incremental 20 s–2 min |

Disk: about 43 GB in total. That's 40 GB for the checkout with its 10 GB out dir and 0.2 GB for the
domain-substitution cache. (Step 6, CEF's binary distribution, went with the cutover.)

Rules for editing the tree after the first build:

- **GN args** live in `gn_defines.sh`: a non-official Release build (no ThinLTO/PGO, no DCHECKs, no
  symbols), proprietary codecs, Widevine (DRM still needs Google's VMP signing), Netnyahoo branding,
  and the CEF-compatible part of ungoogled's `flags.gn`. After changing them, run
  `regen-gn-args.sh`, not step 2: once ungoogled and domain substitution have changed the context of
  CEF's own patches, CEF's patcher can no longer recognize them and stops.
- **Moving to a new CEF/Chromium version.**
  1. Revert domain substitution:
     `python3 ungoogled/utils/domain_substitution.py revert -c domsubcache.tar.gz chromium_git/chromium/src`.
  2. Update the ungoogled checkouts.
  3. Re-run `01-sync.sh` with the new branch, then steps 2–5.
  4. Our patches may need their context refreshed. CEF's checkout and its patches to Chrome can go then, with
     `nn_cef_seams.{h,mm}` ([our hooks](#our-hooks-in-chromes-code)).

## ungoogled-chromium

The patch set comes from the 154.0.8037.57-1 series plus the macOS repo's
`fix-disabling-safebrowsing.patch`: 110 patches in all. Of those, 91 applied, 7 partial,
6 reverted and 6 skipped. The full list with reasons is `engine/patches/ungoogled-status.tsv`.

**Partial:**

- `disable-gcm`: CEF already stubs `GCMClientImpl::Start`.
- `0021-disable-rlz`: CEF requires `enable_rlz`. RLZ stays inert: there's no brand code, and its
  host is substituted.
- `add-flag-to-show-avatar-button` and `add-flag-for-incognito-themes`: they conflict with CEF's
  patches to Chrome's toolbar and frame, which we never show.
- `0005-disable-default-extensions`: its WebstoreInstaller stubs are dropped.
- `0006-modify-default-prefs`: saving passwords and autofilling addresses and cards stay on, because
  Chrome's password manager and autofill are used (locally). Autosign-in stays off.
- `block-requests`: its early `return` in `UpdateCheckerImpl::CheckForUpdates` is undone
  (`chromium-extension-updates.patch`), so Web Store extensions auto-update. The component updater's
  hosts stay unreachable through domain substitution.

**Reverted (they assume `safe_browsing_mode=0` or disabled mdns, which break CEF):**

- `0001-fix-building-without-safebrowsing`
- `remove-unused-preferences-fields`
- `move-js-optimizer-unfamiliar-sites`
- `fix-building-without-mdns-and-service-discovery`

**Also reverted:**

- `enable-extra-locales`: it breaks CEF's string packs.
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

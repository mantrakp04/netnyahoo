# Building CEF from source

Netnyahoo runs on its own build of the Chromium Embedded Framework, not the prebuilt Spotify
distribution. The build uses the same Chromium 154 branch: CEF branch 8037 at 154.0.28+g564dd6c,
Chromium 154.0.8037.58. The CEF API version (15400) and its hash are unchanged, and every addition
is `CEF_API_ADDED(CEF_EXPERIMENTAL)`. `packages/cef` builds against the experimental API (the
default), so it sees all of it.

What the build adds:

- **H.264 / AAC.** Set with `proprietary_codecs=true` and `ffmpeg_branding="Chrome"`; H.264 decodes
  through VideoToolbox.
- **ungoogled-chromium** 154.0.8037.57-1. Its patch series and domain substitution strip Google
  background services; see [ungoogled-chromium](#ungoogled-chromium). The Chrome Web Store and
  extension auto-updates are deliberately kept working.
- **Our patches**, in `packages/cef/patches/`:

| Patch | What it does |
|---|---|
| `cef-tab-capture.patch` | Tab capture: `CefGetMediaCaptureSourceId()`, with a tab's audio for desktop audio |
| `cef-chrome-tabs.patch` | The Chrome-style hosting API and hooks below, plus `include/cef_netnyahoo.h` |
| `cef-tab-state.patch` (after `cef-chrome-tabs.patch`) | Tab history for reopened and duplicated tabs, Chrome's tab discarding, Chrome's BrowsingDataRemover (below) |
| `cef-ui-surfaces.patch` (after `cef-tab-state.patch`: its `cef_netnyahoo.h` hunk follows that patch's markers) | `include/cef_chrome_ui.h`: Chrome's device choosers, Cast dialog and extension side panels handed to the client, toolbar action state, "Share this tab instead" and Stop Sharing; `CefMediaRoute::IsLocal` / `GetDescription` (below) |
| `cef-ui-triggers.patch` (after `cef-ui-surfaces.patch`) | `CefShowAutofillSuggestions`: Chrome's autofill dropdown at the tab's focused form field (below) |
| `cef-zidle-pump.patch` | The external message pump runs Chromium's idle work whenever no task is due now. Stock CEF waited for no delayed tasks either, which never happens in a browser, so next-idle callbacks never ran and autofill popups (saved logins, passkeys, addresses) ignored clicks and Enter |
| `cef-zwindow-client.patch` (after `cef-zidle-pump.patch`) | `CefBrowserSettings.client_window` and `CefBrowserView::CreateTab`: Chrome's Browser window is the app's visible window (below) |
| `chromium-webview-native-hosted.patch` | `views::NativeHostedContents`: `views::WebView` never attaches marked tabs |
| `chromium-browser-view-hosted-fullscreen.patch` | Tab fullscreen of hosted tabs leaves the ghost window alone |
| `chromium-ui-update-before-insert.patch`, `chromium-tab-strip-notify-before-insert.patch` | Fix a CHECK when a tab loads before it's in the tab strip (CEF sets the delegate early) |
| `chromium-extension-window-hidden.patch` | `hidden_from_extensions` windows are invisible to chrome.windows/tabs |
| `chromium-password-bubble-hook.patch` | The client may replace Chrome's password bubble |
| `chromium-extension-install-prompt-hook.patch` | The client may replace Chrome's extension install dialog |
| `chromium-passkeys.patch` | Netnyahoo bundle/team id branding, iCloud Keychain window fallback, "Netnyahoo Safe Storage" |
| `chromium-chrome-ui-hooks.patch` | `chrome::ShowDeviceChooserDialog`, the Media Router's Cast dialog (and Presentation API requests) and `side_panel_util` ask the client first; extension pages in hidden windows take the last active window as their current window |
| `chromium-extension-updates.patch` | Undoes ungoogled's early `return` in `UpdateCheckerImpl::CheckForUpdates`, which left every update check pending: Web Store extensions never updated |
| `chromium-context-menu-hosted.patch` | Chrome's page context menu shows for hosted tabs. Its Mac menu took the widget above the tab's view, which our window isn't, and silently showed nothing; it falls back to the tab's Browser window widget and still pops up at the click |
| `chromium-window-hosted.patch` | `BridgedContentView.netnyahooEmbeddedView`: hit testing and accessibility ask the embedder's subview of a Chrome window's content view first. A Browser whose CEF delegate says so (`client_window`) stays open when its last tab closes, unless the window is closing |
| `chromium-neterror-yahu.patch` | "Where's Big Yahu?" replaces the dino: the offline page and chrome://yahu (below) |

The Chromium patches are made against the fully patched tree (CEF + ungoogled + domain
substitution). Step 2 applies the `cef-*.patch` files in name order, which is the order they were
made in: `cef-chrome-tabs`, `cef-tab-capture`, `cef-tab-state`, `cef-ui-surfaces`, `cef-ui-triggers`,
`cef-zidle-pump`, `cef-zwindow-client` (checked on a clean worktree of the CEF checkout on 2026-09-25: the
first four reproduce the built tree exactly; `cef-ui-triggers` reverse-applies cleanly to it;
`cef-zwindow-client` and `chromium-window-hosted` were made as diffs of their files against the fully patched
tree). A new patch needs a name that sorts last.

## Using it

`packages/cef/scripts/setup.sh` installs
`~/chromium-build/distrib/cef_binary_154.0.28+g564dd6c+chromium-154.0.8037.58_macosarm64_minimal`
into `vendor/cef` and builds `libcef_dll_wrapper`. It re-copies the distribution when the
framework changes (rebuilt in place).

- `CEF_DIST=<dir>` picks another local distribution.
- `CEF_ROOT=<dir>` installs somewhere other than `vendor/cef`. Build one app against that with
  `xcodebuild … NN_CEF_ROOT=<dir>`: the pod's header/library paths use
  `$(NN_CEF_ROOT:default=…/vendor/cef)` and `scripts/embed.sh` reads the same setting.
- `CEF_PREBUILT=1` downloads the stock 154.0.26 prebuilt instead (a fresh checkout without
  `~/chromium-build`). It lacks every patch, so build the app with the `NN_CHROME_TABS=0` build
  setting, which `NetnyahooCEF.podspec` passes to the preprocessor (default 1):

  ```bash
  CEF_PREBUILT=1 packages/cef/scripts/setup.sh
  cd apps/browser && xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS \
    -configuration Debug -destination 'platform=macOS,arch=arm64' build NN_CHROME_TABS=0
  ```

  That build hosts Alloy browsers instead of Chrome tabs, so it loses what the patches add:
  extensions don't see our tabs, pages get no password or autofill filling, incognito windows
  aren't ad-blocked, and none of the `CEF_NN_*` hooks below exist. Checked 2026-09-25: every `packages/cef/ios/*.mm` compiles against the stock headers, and the
  app builds and runs (`engineInfo().chromeTabs` false).

`packages/cef/ios/NNCefInternal.h` turns each feature on with `__has_include` plus the
`CEF_NN_*` markers in `include/cef_netnyahoo.h`.

## API added

Each marker in `cef_netnyahoo.h` covers these APIs:

- **`CEF_NN_TAB_CAPTURE`**
  - `CefString CefGetMediaCaptureSourceId(CefRefPtr<CefBrowser>)` in `include/cef_media_capture.h`.
    It returns `web-contents-media-stream://<render process>:<main frame routing id>`.
- **`CEF_NN_CHROME_TABS`**
  - `CefBrowserSettings.native_contents_hosting`
  - `CefBrowserHost::GetContentsView()`
  - `static CefBrowserHost::CreateTabInBrowser(existing, client, url, settings, extra_info, foreground)`
  - `SetWindowActive(bool)`
  - `ActivateTab()`
  - `MoveToBrowser(target, index, foreground)`
- **`CEF_NN_COMPONENT_EXTENSIONS`**
  - `CefRequestContext::LoadComponentExtension(dir)` (the manifest needs a `key`)
  - `UnloadComponentExtension(id)`
- **`CEF_NN_TAB_SESSION_ID`**
  - `CefBrowserHost::GetTabId()` (the chrome.tabs id)
- **`CEF_NN_EXTENSION_ACTION`**
  - `CefBrowserHost::ExecuteExtensionAction(id)`: returns 0 for onClicked, 1 to show the popup,
    2 for the side panel, -1 on error.
- **`CEF_NN_TAB_FULLSCREEN`**
  - No API. `BrowserView` tracks tab fullscreen without touching the ghost window. The client gets
    `CefDisplayHandler::OnFullscreenModeChange`.
- **`CEF_NN_PASSWORD_PROMPT`**
  - `CefBrowserHost::GetPasswordPrompt()`
  - `ResolvePasswordPrompt(action, username, password)`
- **`CEF_NN_PASSWORD_BUBBLE`**
  - Before Chrome shows its password bubble, the tab's
    `CefCommandHandler::OnChromeCommand(IDC_MANAGE_PASSWORDS_FOR_PAGE)` runs; returning true
    skips the bubble.
- **`CEF_NN_TAB_STRIP`**
  - `CefLifeSpanHandler::OnTabStripChanged(browser, index, active, pinned)`
  - `CefBrowserHost::SetTabIndex(int)`
  - `SetTabPinned(bool)`
- **`CEF_NN_POPUP_TABS`**
  - No API. Popups allowed in `OnBeforePopup` from hosted tabs become background tabs of the
    opener's Chrome window.
- **`CEF_NN_HIDDEN_BROWSER`**
  - `CefBrowserSettings.hidden_from_extensions`
- **`CEF_NN_INSTALL_PROMPT`**
  - `CefRequestContextHandler::OnExtensionInstallPrompt(browser, id, details, callback)`
  - `CefExtensionPromptCallback::Continue(bool)`
  - Web Store CRX downloads stay out of `CefDownloadHandler`.
- **`CEF_NN_SAFE_STORAGE`**
  - The Safe Storage key lives in its own "Netnyahoo Safe Storage" keychain item.
- **`CEF_NN_TAB_HISTORY`**
  - `CefBrowserHost::GetNavigationState()`: the tab's back/forward list as Chrome's tab restore
    records it (base64 of pickled `SerializedNavigationEntry`s, 256 KB per entry at most).
  - `static CefBrowserHost::RestoreTabInBrowser(existing, client, state, settings, extra_info)`:
    a background tab with that list, through `chrome::AddRestoredTab`.
  - `DuplicateTab(client, settings, extra_info)`: `WebContents::Clone()` (history and session
    storage, as Chrome's Duplicate) inserted after the tab, in the background.
  - Every tab added to a `native_contents_hosting` Browser by any path is marked natively hosted.
- **`CEF_NN_TAB_DISCARD`**
  - `CefBrowserHost::DiscardTab()` (Chrome's `TabLifecycleUnit`, reason EXTERNAL) and
    `IsTabDiscarded()`.
  - `CefLifeSpanHandler::OnTabDiscardedChanged(browser, discarded)` for every discard of a hosted
    tab (ours, Chrome's urgent discarding, `chrome.tabs.discard`) and when it loads again. The app
    runs with `--enable-features=WebContentsDiscard`, so a discard keeps the WebContents (and the
    browser); without it Chrome would swap in a new one.
- **`CEF_NN_BROWSING_DATA`**
  - `CefRequestContext::ClearBrowsingData(types, begin, end, callback)`: Chrome's
    `BrowsingDataRemover` for web origins. `types`: `CEF_NN_BROWSING_DATA_HISTORY`, `_SITE_DATA`
    (Chrome's "Cookies and other site data"), `_CACHE`, `_DOWNLOADS`.

- **`CEF_NN_CHROME_UI`** (`include/cef_chrome_ui.h`)
  - `CefSetChromeUIHandler(handler)`: a global `CefChromeUIHandler` gets, instead of Chrome's
    bubbles in the hidden window:
    - `OnDeviceChooser(browser, CefDeviceChooser)` / `OnDeviceChooserChanged`: Web Bluetooth
      (`requestDevice`, `requestLEScan`), WebUSB, WebHID and Web Serial choosers. `GetState()`
      has Chrome's title, labels, scanning / adapter / OS-permission state and the options;
      answer with `Select(index)` or `Cancel()`; `Refresh()`, `OpenPermissionSettings()`.
    - `OnCastDialog(browser, CefCastDialog)` / `OnCastDialogChanged`: the Media Router's Cast
      dialog model (`MediaRouterUI`), for the client's own request (`CefShowCastDialog`) and a
      page's (Presentation API, Cast SDK buttons). `StartCasting(sink, mode)`, `StopCasting`,
      `Close()` (rejects a pending presentation request).
    - `OnExtensionSidePanel(browser, extension_id, open)`: `chrome.sidePanel.open()` / `close()`
      (and Chrome's toggles).
  - `CefGetExtensionActionState(browser, id)`: the action's title, displayed badge text and
    colours, popup URL, enabled state and `action.setIcon` image (PNG data URL at 2x) for the tab.
  - `CefGetExtensionSidePanel(browser, id)`: the side panel URL for the tab (per-tab options, else
    the default).
  - `CefChangeMediaCaptureSource(capturer, source_id)` / `CefGetMediaCaptureTarget(capturer)`:
    "Share this tab instead" for a running tab capture (the page keeps its tracks).
  - `CefMediaRoute::IsLocal()` / `GetDescription()`, for the toolbar's cast state.
- **`CEF_NN_AUTOFILL_TRIGGER`** (`include/cef_chrome_ui.h`)
  - `CefShowAutofillSuggestions(browser, type)`: Chrome's autofill suggestions at the form field focused in the
    tab, as its field context menu asks for them. `CEF_NN_AUTOFILL_PASSWORDS` shows the saved passwords (the
    "Select password" manual fallback, on any text field), `CEF_NN_AUTOFILL_FIELD` the field's own suggestions
    (as a click on it: addresses, cards, earlier entries). Returns false when no form field has focus.
  - The browser process keeps no record of the focused field, so `libcef/browser/chrome/autofill_trigger.cc`
    follows each tab's AutofillManagers (`ScopedAutofillManagersObservation`: the renderer reports every focus
    change) from the tab's insertion into a tab strip.
- **`CEF_NN_CAPTURE_STOP`**
  - `CefStopMediaCapture(capturer)`: Chrome's "Stop sharing" for screen, window and tab captures.
  - Extension pages outside any tab strip (hidden windows: our popups and side panels) use the
    last active window as `currentWindow` in `chrome.tabs` / `chrome.windows`.

- **`CEF_NN_CLIENT_WINDOW`** (Chrome-hosted windows, `docs/research/chrome-hosted-window.md`)
  - `CefBrowserSettings.client_window` (with `native_contents_hosting`, on the `CefBrowserView`): the Chrome
    window is the client's own visible window.
    - Chrome's tab strip, toolbar, location bar and bookmarks bar are off (`ChromeBrowserDelegate::
      SupportsWindowFeature`). With them off, Chrome also disables its commands for them (focus toolbar, app
      menu…), and its bubbles fall back to anchors at the top of the page.
    - No zoom bubble for its tabs (`ZoomController::SetShowsNotificationBubble(false)` as each tab is marked
      hosted). Chrome's status bubble is the existing `chrome_status_bubble` setting.
    - `omit_from_session_restore`: Chrome's session service never restores into it.
    - The window stays open when its last tab closes (`BrowserDelegate::KeepsWindowWithoutTabs`, checked in
      `Browser::TabStripEmpty` and `UnloadController::TabStripEmpty`), unless it is closing.
  - `CefBrowserView::CreateTab(client, url, settings, extra_info, foreground)`: `CreateTabInBrowser` for such a
    window, which may have no tab to address it by.
  - macOS: the window's content view (Chromium's `BridgedContentView`) has `netnyahooEmbeddedView` (weak
    `NSView`). The client adds its view as a subview of the content view and sets it: hit testing asks it first
    (Chrome's views cover the window, and `-hitTest:` would claim every point), and so do
    `-accessibilityChildren` / `-accessibilityHitTest:`. The page must stay under the content view:
    `RenderWidgetHostViewCocoa -shouldIgnoreMouseEvent:` hit-tests from it, and the occlusion checker only walks it.

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

A Chrome-style Browser survives closing its `CefBrowserView`'s first tab while it has other tabs.
A tab created in the background starts hidden, and becomes visible once its view is in a visible
window (NSView occlusion).

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
  So `NNContentBlocker.mm` loads uBlock Origin Lite from a copy in the data directory,
  `<data dir>/Built-in Extensions/ublock-lite` (an APFS clone of the bundled folder, made writable, next to
  `Chromium`), and copies it again when the bundled extension changes (`ublock-lite.source` holds the manifest's
  SHA-256, file count and size). Chrome's indexes persist in the copy, so later launches load them without indexing.
  Netnyahoo 0.1.0 loaded it straight from the bundle: its first launch wrote the six indexes into the bundle, and
  from a read-only bundle nothing was blocked at all.

Everything else Chrome writes (crashpad, component updater, caches, extension installs) goes to the user data dir,
and `MacAppCodeSignClone` is disabled (NNCef.mm). `scripts/release.sh` launches the exported app once and verifies the
signature again, so a new writer fails the release.

## Rebuilding

Everything lives outside the repo in `~/chromium-build`, which carries `.metadata_never_index`.
The step scripts are copied in `packages/cef/patches/build/`, and each expects `~/chromium-build`.

| Step | Script | Time (M5 Pro, shared machine) |
|---|---|---|
| 1. Sync CEF 8037 + Chromium 154.0.8037.58 without history (depot_tools, gclient hooks) | `01-sync.sh` | ~40 min, 30 GB |
| 2. Our CEF/Chromium patches, CEF's patches, translator, `gn gen` | `02-cef-patch-and-gen.sh` | 2 min |
| 3. ungoogled-chromium series, with the exceptions below | `03-ungoogled.py` | 2 min |
| 4. Domain substitution, minus the store files (`domsub-keep-store.txt`), then our Chromium patches | `04-domain-substitution.sh` | 5 min |
| 5. Regenerate the offline page (`yahu-resource.sh`), compile `cefclient cefsimple` (make_distrib takes the framework from cefclient.app) | `05-build.sh` | first build 2 h 8 min; incremental 20 s–2 min |
| 6. Minimal binary distribution (Release, no docs or symbols) | `06-distrib.sh` | 1 min |

Disk: about 43 GB in total. That's 40 GB for the checkout with its 10 GB out dir, 0.5 GB for the
distribution and 0.2 GB for the domain-substitution cache.

Rules for editing the tree after the first build:

- **GN args** live in `gn_defines.sh`: a non-official Release build (no ThinLTO/PGO, no DCHECKs, no
  symbols), proprietary codecs, Widevine (DRM still needs Google's VMP signing), Netnyahoo branding,
  and the CEF-compatible part of ungoogled's `flags.gn`. After changing them, run
  `regen-gn-args.sh`, not step 2: once ungoogled and domain substitution have changed the context of
  CEF's own patches, CEF's patcher can no longer recognize them and stops.
- **After editing a CEF header under `include/`**, regenerate the C API and wrappers with
  `cd chromium/src/cef && python3 tools/version_manager.py -u --fast-check`, then run step 5.
  `cef_netnyahoo.h` is excluded from the translator and shipped through `cef_paths2.gypi`.
- **Test harness.** `packages/cef/patches/test/nativehost.mm` (`build.sh`) is the acceptance test. It
  can't activate (`NSApplicationActivationPolicyProhibited`). It hosts two tabs of one ghost Chrome
  window, then checks the `CALayerHost` under `RenderWidgetHostViewCocoa`, the rAF rate, the capture
  id and codec support. It also exercises CreateTabInBrowser, popup tabs, tabs.create from a component
  extension's action, and closing the first tab. With `STORE_TEST=1 … <Web Store detail URL>` it
  clicks "Add to Chrome" and accepts through `OnExtensionInstallPrompt`.
- **Moving to a new CEF/Chromium version.**
  1. Revert domain substitution:
     `python3 ungoogled/utils/domain_substitution.py revert -c domsubcache.tar.gz chromium_git/chromium/src`.
  2. Update the ungoogled checkouts.
  3. Re-run `01-sync.sh` with the new branch, then steps 2–6.
  4. Our patches may need their context refreshed.

## ungoogled-chromium

The patch set comes from the 154.0.8037.57-1 series plus the macOS repo's
`fix-disabling-safebrowsing.patch`: 110 patches in all. Of those, 91 applied, 7 partial,
6 reverted and 6 skipped. The full list with reasons is `packages/cef/patches/ungoogled-status.tsv`.

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

- The WebView method `mediaCaptureSourceId()` returns the id, and `engineInfo().tabCapture` says
  whether tab capture is available.
- The share picker answers a `displayMediaRequest` with that id, and the page script adds tab audio
  when the page asked for audio.

Verified in the app: a "Tab" track at 1558×1080 delivering frames, plus a "Tab Audio" track.

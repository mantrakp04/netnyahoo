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
| `chromium-webview-native-hosted.patch` | `views::NativeHostedContents`: `views::WebView` never attaches marked tabs |
| `chromium-browser-view-hosted-fullscreen.patch` | Tab fullscreen of hosted tabs leaves the ghost window alone |
| `chromium-ui-update-before-insert.patch`, `chromium-tab-strip-notify-before-insert.patch` | Fix a CHECK when a tab loads before it's in the tab strip (CEF sets the delegate early) |
| `chromium-extension-window-hidden.patch` | `hidden_from_extensions` windows are invisible to chrome.windows/tabs |
| `chromium-password-bubble-hook.patch` | The client may replace Chrome's password bubble |
| `chromium-extension-install-prompt-hook.patch` | The client may replace Chrome's extension install dialog |
| `chromium-passkeys.patch` | Netnyahoo bundle/team id branding, iCloud Keychain window fallback, "Netnyahoo Safe Storage" |

The Chromium patches are made against the fully patched tree (CEF + ungoogled + domain
substitution).

## Using it

`packages/cef/scripts/setup.sh` installs
`~/chromium-build/distrib/cef_binary_154.0.28+g564dd6c+chromium-154.0.8037.58_macosarm64_minimal`
into `vendor/cef` and builds `libcef_dll_wrapper`. It re-copies the distribution when the
framework changes (rebuilt in place).

- `CEF_DIST=<dir>` picks another local distribution.
- `CEF_ROOT=<dir>` installs somewhere other than `vendor/cef`. Build one app against that with
  `xcodebuild … NN_CEF_ROOT=<dir>`: the pod's header/library paths use
  `$(NN_CEF_ROOT:default=…/vendor/cef)` and `scripts/embed.sh` reads the same setting.
- `CEF_PREBUILT=1` downloads the stock 154.0.26 prebuilt instead. It lacks every patch, so the app
  has to be built with `NN_CHROME_TABS=0`.

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

A Chrome-style Browser survives closing its `CefBrowserView`'s first tab while it has other tabs.
A tab created in the background starts hidden, and becomes visible once its view is in a visible
window (NSView occlusion).

## Rebuilding

Everything lives outside the repo in `~/chromium-build`, which carries `.metadata_never_index`.
The step scripts are copied in `packages/cef/patches/build/`, and each expects `~/chromium-build`.

| Step | Script | Time (M5 Pro, shared machine) |
|---|---|---|
| 1. Sync CEF 8037 + Chromium 154.0.8037.58 without history (depot_tools, gclient hooks) | `01-sync.sh` | ~40 min, 30 GB |
| 2. Our CEF/Chromium patches, CEF's patches, translator, `gn gen` | `02-cef-patch-and-gen.sh` | 2 min |
| 3. ungoogled-chromium series, with the exceptions below | `03-ungoogled.py` | 2 min |
| 4. Domain substitution, minus the store files (`domsub-keep-store.txt`), then our Chromium patches | `04-domain-substitution.sh` | 5 min |
| 5. Compile `cefclient cefsimple` (make_distrib takes the framework from cefclient.app) | `05-build.sh` | first build 2 h 8 min; incremental 20 s–2 min |
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
`fix-disabling-safebrowsing.patch`: 110 patches in all. Of those, 92 applied, 6 partial,
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

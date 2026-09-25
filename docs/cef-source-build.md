# Building CEF from source

Netnyahoo can run on its own build of the Chromium Embedded Framework instead of the prebuilt
Spotify distribution. The build uses the same Chromium 154 branch (CEF branch 8037,
Chromium 154.0.8037.58) and keeps the same CEF API version (15400), so `packages/cef` compiles
against either one. It adds:

- **H.264 / AAC** (`proprietary_codecs=true`, `ffmpeg_branding="Chrome"`; H.264 decodes through
  VideoToolbox). The prebuilt distribution has neither.
- **ungoogled-chromium** (154.0.8037.57-1): its patch series and domain substitution, which strip
  Google background services. What was applied or skipped, and why, is listed below.
- **Our own patches** (`packages/cef/patches/`):
  - `cef-tab-capture.patch`: `CefGetMediaCaptureSourceId(browser)` in the new
    `include/cef_media_capture.h`. It makes sharing a single tab possible (see
    [Tab capture](#tab-capture)).
  - `cef-native-contents-hosting.patch` + `chromium-webview-native-hosted.patch`: Chrome-style tabs
    hosted in our own NSViews (WP1 of `docs/research/chromium-ui-layer.md`). See
    [Chrome-style hosting API](#chrome-style-hosting-api).

All new API is `CEF_API_ADDED(CEF_EXPERIMENTAL)`. The hash for version 15400 is unchanged, and
`packages/cef` (which builds against the experimental API, the default) sees the additions. The
app detects tab capture with `__has_include("include/cef_media_capture.h")` (`NN_TAB_CAPTURE` in
`NNCefInternal.h`), so it still builds against the prebuilt distribution.

## Using a local distribution

```sh
# Replace packages/cef/vendor/cef (what every app build uses) with a local build:
CEF_DIST=~/chromium-build/distrib/cef_binary_<version>_macosarm64_minimal packages/cef/scripts/setup.sh

# Or install it next to vendor/cef and build just one app against it:
CEF_DIST=<dist> CEF_ROOT=~/chromium-build/app-cef packages/cef/scripts/setup.sh
cd apps/browser && xcodebuild ... NN_CEF_ROOT=$HOME/chromium-build/app-cef
```

`setup.sh` copies the distribution and builds `libcef_dll_wrapper`. Without `CEF_DIST` it
downloads the pinned prebuilt again. `NN_CEF_ROOT` is an Xcode build setting that the pod's
header/library paths (`NetnyahooCEF.podspec`, `$(NN_CEF_ROOT:default=vendor/cef)`) and
`scripts/embed.sh` both read. Changing the podspec needs a `pod install`.

## Rebuilding

Everything lives outside the repo in `~/chromium-build` (with `.metadata_never_index`). The step
scripts are copied in `packages/cef/patches/build/`:

| Step | Script | Time (M5 Pro, shared machine) | Disk |
|---|---|---|---|
| 1. Sync CEF 8037 + Chromium 154.0.8037.58, no history | `01-sync.sh` (CEF `automate-git.py --no-build`) | ~75 min | 30 GB |
| 2. Our CEF/Chromium patches, CEF's patches, translator, `gn gen` | `02-cef-patch-and-gen.sh` | 2 min | |
| 3. ungoogled-chromium patch series | `03-ungoogled.py` | 2 min | |
| 4. Domain substitution (keeps a revert cache) | `04-domain-substitution.sh` | 5 min | 0.2 GB |
| 5. Compile `cefclient cefsimple` | `05-build.sh` | see report | see report |
| 6. Minimal binary distribution | `06-distrib.sh` | 1 min | |

GN args are in `gn_defines.sh`: a non-official Release build (no ThinLTO/PGO, no DCHECKs, no
symbols), proprietary codecs, Widevine enabled (it still needs Google's VMP signing to play DRM),
and the part of ungoogled's `flags.gn` that CEF accepts.

After editing a CEF header under `include/`, regenerate the C API and wrappers with
`cd chromium/src/cef && python3 tools/version_manager.py -u --fast-check`, then run step 5.
Only the files you touched rebuild.

To move to a new CEF/Chromium version: revert domain substitution
(`python3 ungoogled/utils/domain_substitution.py revert -c domsubcache.tar.gz chromium/src`),
re-run `01-sync.sh` with the new branch, then steps 2–6. Our patches may need their context
refreshed.

## ungoogled-chromium patches

Out of 110 patches (the 109-patch series plus one macOS patch): 98 applied, 4 partial, 2
reverted, 6 skipped. The full list is in `packages/cef/patches/ungoogled-status.tsv`.

- **Partial:**
  - `disable-gcm`: CEF already stubs `GCMClientImpl::Start`.
  - `add-flag-to-show-avatar-button` and `add-flag-for-incognito-themes`: their Chrome toolbar and
    frame hunks conflict with CEF's patches, and we never show Chrome's toolbar.
  - `0021-disable-rlz`: CEF requires `enable_rlz=true`. RLZ stays inert: there's no brand code, and
    its server is domain-substituted.
- **Reverted:**
  - `0001-fix-building-without-safebrowsing`: it assumes `safe_browsing_mode=0`.
  - `enable-extra-locales`: it breaks CEF's string pack list, and it isn't privacy-related.
- **Skipped:**
  - Binary pruning and its two fixes (`fix-building-with-prunned-binaries`,
    `build-with-wasm-rollup`): a gclient checkout keeps its prebuilt toolchains.
  - Two Linux-only patches.
  - Two build fixes that only matter for `safe_browsing_mode=0`.
- **GN flags not used:** `safe_browsing_mode=0`, `enable_mdns=false`,
  `enable_service_discovery=false` and `enable_reporting=false`. They risk breaking CEF's build, and
  domain substitution already cuts off the Google endpoints they'd talk to.

Side effects of domain substitution: Google hostnames in Chromium become `*.qjz9zk`. The component
updater (the Widevine CDM download) and spell-check dictionary downloads no longer reach Google.

## Tab capture

`CefGetMediaCaptureSourceId(browser)` returns
`web-contents-media-stream://<render process id>:<main frame routing id>` for a tab. A page that
calls `getUserMedia({video: {mandatory: {chromeMediaSource: "desktop", chromeMediaSourceId: id}}})`
gets that tab's video; Chromium's `DesktopMediaID::Parse` already understands the id. It also gets
the tab's audio, not system audio, when it asks for `audio: {mandatory: {chromeMediaSource:
"desktop"}}`, because the patch routes CEF's desktop-audio device to the tab. Capturing a tab reads
Chromium's own compositor frames, so it needs no Screen Recording permission.

In the app, the WebView method `mediaCaptureSourceId()` returns that id, or null on the prebuilt
engine, and `engineInfo().tabCapture` says whether it's available. The share picker answers a
`displayMediaRequest` with that id (`resolveDisplayMedia(requestId, id)`), and the page script adds
tab audio when the page asked for audio.

## Chrome-style hosting API

The API for the Chrome-style cutover (all experimental):

- `CefBrowserSettings.native_contents_hosting` (`cef_state_t`): on a Chrome-style
  `CefBrowserView`, it marks every tab of that Chrome window as hosted by us. Chromium's
  `views::WebView` then never attaches the tab's NSView (`views::NativeHostedContents`), so
  `RenderWidgetHostViewMac` keeps its own compositor and draws wherever we put the view. The
  Browser also stays `TYPE_NORMAL`, so it can hold many tabs.
- `CefBrowserHost::GetContentsView()`: returns the tab's `WebContentsViewCocoa` for us to add to our
  view tree.
- `static CefBrowserHost::CreateTabInBrowser(existing, client, url, settings, extra_info, foreground)`:
  adds a tab, with its own client, to the Chrome window hosting `existing`.
- `CefBrowserHost::SetWindowActive(bool)`: reports our window's activation to Chrome's
  `BrowserActiveStateManager`, which drives the last-active Browser and extensions' current window.
  The ghost window itself is never activated.

`~/chromium-build/tests/nativehost.mm` (`build.sh`) is the acceptance test. It hosts two tabs of
one ghost Chrome window in a plain AppKit window, then checks the `CALayerHost` under
`RenderWidgetHostViewCocoa`, the rAF rate, the capture id and codec support.

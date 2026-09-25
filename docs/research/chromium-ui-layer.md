# Chromium under the React Native UI: decision and plan

Status: research spike, 2026-09-25. Prototypes and captures live outside the repo in
`~/netnyahoo-research/owlproto/` (sources, `build.sh`, `run/*.png|log`).

## Decision

Go with **(a) patched CEF, Chrome style**:

- Every Netnyahoo window owns one real Chrome `Browser`, with a `TabStripModel`, profile, extensions and
  permissions.
- That `Browser` lives in an **invisible "ghost" Views window**: alpha 0, ignores mouse events, and is
  kept exactly behind our RN window.
- Each tab's `WebContentsViewCocoa` NSView is parented into our RN views, the same way `NNBrowserView`
  hosts Alloy views today.

Tabs keep the Cocoa display path we ship now: a `CALayerHost` inside our layer tree. Blur, overlap,
native animation and native IME/accessibility therefore all stay as they are. Chrome's own UI surfaces
(dialogs, bubbles, autofill dropdown, extension popups) render as child windows of the ghost. Because
the ghost is aligned to our window, they appear in the right place on screen.

The one mechanism that doesn't work out of the box is small and well located. It needs a ~20-line
Chromium patch plus a ~150-line CEF patch/API, described in "The patch" below. The rest of the
integration is ours.

Rejected:

- **(b) Our own ArcCore-style embedder over `chrome/`.** This is what Dia does. It means replacing
  Chrome's Views UI layer (`arc/browser/ui/*`, about 108 `arc/` source files visible in the binary) and
  writing ObjC bindings for everything. It is months of work for the same result as (a) plus polish we
  can add later.
- **(c) OWL-style out-of-process host.** It works: I prototyped the core. But it adds everything (b)
  needs, plus our own input "cracking" (keys, wheel, IME), an accessibility bridge, and cross-process
  projection of every Chrome UI surface. It gains crash and jank isolation, which we can revisit later.
  It has no Dia-parity upside that (a) lacks.

## Evidence

### 1. How Dia embeds Chromium (read-only look at `/Applications/Dia.app`, v1.49.1)

- **`ArcCore.framework` is Chrome, not bare content.** It is 233 MB, `CFBundleShortVersionString`
  153.0.8010.53, `SCMRevision …refs/branch-heads/8010@{#1444}`.
  - It exports `ChromeMain`, `ChromeAppModeStart_v8` and `ChromeWebAppShortcutCopierMain` (`nm -gU`).
  - It ships `app_mode_loader` and Chrome's helper apps ("Browser Helper", "(Renderer)", "(GPU)",
    "(Alerts)", plus "Aperitif" variants backed by `libaperitif.dylib`, an 87 KB sandbox/allocator shim).
  - About 1,700 `chrome/`+`content/` source paths appear in its strings.
- **Embedder API.** 146 exported ObjC classes (`ArcBrowser`, `ArcBrowserContext`, `ArcWebContents`,
  `ArcDownloadItem`…), with public headers under `Headers/arc/browser/objcpp`.
  - These are generated from mojom ("auto-generated `ArcWebContents.h` … from `web_contents.mojom`",
    `*.mojom-objc.h`).
  - Their own C++ lives in `arc/browser/**`, 108 source paths. That includes `arc/browser/ui/*.cc`
    reimplementations of Chrome UI (`autofill_popup_view.cc`, `location_bar.cc`, `browser_dialogs.cc`,
    `extension_install_prompt.cc`, …) and `arc/blink/core/top_band_color_tracker.cc`.
- **In-process.** `Dia` links `ArcCore` directly (`otool -L`). Every helper (GPU, renderers, network,
  storage, AI and ContentConversion services) is a child of the Dia process itself (`ps`: ppid = Dia).
  There is no separate browser-process host.
- **How web content gets into their views.** Through `ArcWebContents (Extensions)`:
  `createPaneHostView`, `nativeView`, `attachToPaneHostView:` and `detachFromPaneHostView:`. ArcCore
  strings include `PaneHostBridge`, `WebContentsPaneHostView` and `PaneHostCompositorOverlayView`, and
  Dia strings include `PaneHostSlotCoordinator`, `rendersViaPaneHost` and
  `adoptExistingNativeView(nativeView:)`.
  - Pixels come through Chromium's stock Mac path: `DisplayCALayerTree::GotCAContextFrame`,
    `CALayerTreeCoordinator`, `CALayerHost`.
  - So Dia moves Chrome's WebContents NSView into its own hierarchy. That is exactly option (a).
- **Effects.** Dia imports `CABackdropLayer`, `CAFilter`, `NSVisualEffectView`, `CAMetalLayer` and
  `MTKView` (`nm -m`). Its strings show `LayerEffects.BackdropEffectView` built on `gaussianBlur`,
  `variableBlur` and `colorSaturate` filters.
  - Blur over web content is a plain `CABackdropLayer` above the web view's `CALayerHost` in the same
    window, which is what our prototype does.
  - Renderer switches add `--enable-blink-features=TopBandColorSampling` (their tab tint) and
    `--bcny-app-id`.

### 2. OWL (OpenAI Atlas)

All five claims check out against the primary source, "How we built OWL…" by Ken Rockot and Ben
Goodger (openai.com/index/building-chatgpt-atlas; archived text in the spike scratchpad):

- The browser process runs outside the app ("OWL Host").
- The app talks to it over Mojo with custom Swift (and TypeScript) bindings.
- The shared container is a `gfx::AcceleratedWidget` backed by a CALayer. Its context ID is embedded
  in an NSView with the private `CALayerHost`. Popups get the same treatment through their own
  `RenderWidgetHostView`.
- The client translates NSEvent to WebInputEvent itself and re-synthesizes NSEvents for events the page
  didn't handle.
- OWL ships to engineers as a prebuilt binary. They also project pieces of Chrome's Views UI into the
  app using the remote_cocoa/PWA app-shim machinery.

### 3. Prototype measurements

Setup: M5 Pro, macOS 27.2, CEF 154.0.26 from `packages/cef/vendor`, test page at 120 Hz rAF.

**Input→glass** is `SendMouseMoveEvent` → page flips a probe → first ScreenCaptureKit frame showing the
flip. Samples are 84–95 per run. Windows were off-screen or occluded, so compare the rows with each
other rather than reading them as absolute photon latency.

| Path | Frame rate | Input→glass p50 / p90 | Blur over live page | Notes |
|---|---|---|---|---|
| **Windowed Alloy (today)**: CEF child NSView = `CALayerHost` in our tree | 120 fps | **15.8–23.3 / 23–25 ms** (3 runs) | **Yes**: `NSVisualEffectView` and raw `CABackdropLayer` both blur it (`run/windowed-back.png`) | Blur over web content already works in our architecture. |
| OSR, `OnAcceleratedPaint` IOSurface → `CAMetalLayer` | 60 fps (cap) | 42.2 / 46.8 ms | Yes | Copy costs 0.05–0.13 ms of GPU time. The extra latency is presentation queueing. |
| OSR + external BeginFrame on a CADisplayLink | 120 fps | 39–43 ms | Yes | EBF works on 154 (CEF issue #4033 reports it broken on 142). |
| OSR → own IOSurface as `layer.contents` | 60 fps | 30.6 / 31.1 ms | Yes | Colors come out unmanaged: over-saturated unless tagged (`run/osr-contents.png`). |
| **OWL-style**: CEF host process, embedder with no Chromium, `CALayerHost` of an exported `CAContext` | 120 fps | not measurable with SCK (remote-only damage) | **Yes**, and web content can be rotated, scaled and rounded by Core Animation (`run/owl-embedder.png`) | Socket round trip 0.07 ms p50. Click works through `Send*Event`. |

**OWL input findings.**

- In windowed CEF, `SendKeyEvent` and `SendMouseWheelEvent` are dropped. Only click and move work.
- Keys only arrive when you synthesize NSEvents into `RenderWidgetHostViewCocoa`: "typed:ab" arrived at
  0.6–1.1 ms handler delay in-process and 21–23 ms via the embedder.
- IME has to be proxied through `NSTextInputClient`.
- OSR accepts every CEF input API, including `ImeCommitText`.

**Chrome-style experiments** (`chromestyle.mm`, stock CEF; the page ran at 120 fps throughout):

| Experiment | Result |
|---|---|
| Chrome-style `CefBrowserView` in a hidden `CefWindow`, `WebContentsViewCocoa` moved into our NSWindow | **Blank.** No `CALayerHost` appears under `RenderWidgetHostViewCocoa`. |
| Same, after `CefWindow::RemoveChildView` or a direct `ViewsHostableDetach()` | **Blank.** Display is latched off (see "The patch"). |
| Mirror the Chrome window's compositor `CAContext` into our view (`CALayerHost`) while its own window hosts it | **Blank.** A context shows in only one host. That's fine off-screen (the OWL case), not with an on-screen ghost. |
| Ghost window at alpha 0, aligned to our window, then `alert()` | Chrome's Views dialog opens as its own window ("This page says", alpha 1), centered over the ghost, which puts it over our window (`run/chrome-dialog.png`). |

## Why (a) wins

- **Dia parity and feel.** It uses Dia's exact compositing model: web NSView in our tree, backdrop blur
  on top. We measured it at the lowest latency of every option and with no seams. OSR loses 8–25 ms and
  60 fps by default. OWL matches it visually but needs a pile of input, IME and accessibility plumbing.
- **Chrome features for free.** `chrome.tabs`/`chrome.windows`, action popups, context menus, commands,
  side panel, tab capture, Translate, the password manager, autofill, permissions, Cast and PiP all
  become Chrome's real implementations, because a real `Browser` + `TabStripModel` owns the tabs.
- **Smallest diff.** We keep CEF's Chrome bootstrap, profiles, client handlers and build. (b) would have
  us re-create CEF's glue and Arc's `arc/browser/ui` layer. (c) is (b) plus a process boundary.

## The patch (riskiest mechanism, checked in the 154.0.8037.58 / CEF 8037 source)

1. **Why reparenting fails today.** When Views hosts a WebContents, the tab's RWHV is permanently
   switched to Views drawing.
   - `content/browser/renderer_host/render_widget_host_view_mac.mm:449-463`,
     `SetParentUiLayer`: "The first time that we display using a parent ui::Layer, permanently switch
     from drawing using Cocoa to only drawing using ui::Views" → `ns_view_->DisableDisplay()`.
   - That is a one-way latch: `render_widget_host_ns_view_bridge.mm:115-120`, `display_disabled_`.
   - The call chain is `views::WebView::AttachWebContentsNativeView` (`ui/views/controls/webview/webview.cc:590-612`,
     `holder_->Attach`) → `NativeViewHostMac::AttachNativeView` → `WebContentsViewMac::ViewsHostableAttach`
     (`web_contents_view_mac.mm:753-798`) → `SetParentUiLayer(views_host_->GetUiLayer())`.
   - After that, pixels go into the Views window's single compositor (`BrowserCompositorMac::UpdateState`,
     `browser_compositor_view_mac.mm:207-222`), not into the tab's NSView.
2. **Chromium patch (~20 lines).** In `views::WebView::AttachWebContentsNativeView` /
   `DetachWebContentsNativeView`, skip `holder_->Attach/Detach` when the WebContents carries a
   `NativeHostedContents` user-data marker. Nothing else changes.
   - This is the single choke point for the active tab and for split view (`browser_view.cc:2071`,
     `multi_contents_view.cc:264`).
   - The RWHV then keeps `BrowserCompositorMac::HasOwnCompositor`, which is the path Alloy style (and
     Netnyahoo) uses today.
3. **CEF patch/API (~150 lines, in `libcef/browser/chrome/**` and `include/`):**
   - A `CefBrowserSettings`/`CefBrowserViewDelegate` flag, `native_contents_hosting`, that sets the
     marker on every tab WebContents of that Browser. Hook `ChromeBrowserDelegate::OnWebContentsCreated`.
   - `CefBrowserHost::GetContentsView()`, which returns the `WebContentsViewCocoa` for a Chrome-style tab.
   - Keep `TYPE_NORMAL` for `browser_view` Browsers when the flag is set, so they hold many tabs.
     Today `chrome_browser_host_impl.cc:425-429` forces `TYPE_POPUP`.
   - `CefBrowserHost::CreateTabInBrowser(existing, url, …)` → `chrome::AddTabAt`. Today every
     `CefBrowserView` creates its own `Browser` (`chrome_browser_host_impl.cc:28-60, 403-470`).
   - `CefBrowserHost::SetWindowActive(bool)` → `BrowserList::SetLastActive` plus widget-activation
     emulation. The ghost is never key, but extension "current window", `chrome.commands` and Chrome
     commands need the right `Browser`.
   - We do *not* need to lift the macOS "no Chrome style with native parent" rule
     (`browser_host_create.cc:233-238`, issue #3294), because the Browser lives in a ghost `CefWindow`.

## Where Chrome's UI surfaces end up

Every Views surface is a child widget of the Browser's window. The ghost window lives at
`frameRectForContentRect(our window content)`, with alpha 0 and `ignoresMouseEvents`, ordered just below
our window and moved and resized with it. Chrome therefore positions surfaces relative to our window.
Content-anchored ones use the WebContents NSView's real screen rect, which is inside our window.

| Surface | Default with the ghost | Plan |
|---|---|---|
| JS alert/confirm/prompt, tab-modal dialogs, HTTP auth, cert errors | Chrome dialog centered over the page (**verified**) | Keep Chrome's at first. Restyle later with `CefJSDialogHandler` → RN if needed. |
| Autofill and password dropdown | Anchored to the field's screen rect, which is correct because it's computed from our NSView | Keep Chrome's. |
| Password save/update bubble, permission prompts, page info, blocked popups, downloads bubble | Anchored to location-bar/toolbar icons in the ghost's (invisible) toolbar, so the position is wrong | Route to our RN UI: `CefPermissionHandler` (we already have one), CEF permission-prompt hooks, and a small patch exposing Chrome's `PasswordsModelDelegate` and blocked-content state to the client. Fallback: anchor to a ghost view placed under our omnibox. |
| Extension action popups, install/uninstall prompts, side panel | Popups anchor to toolbar buttons in the ghost | Keep Chrome's prompts. For popups, lay out the ghost's (invisible) extensions container under our toolbar buttons, or host the popup WebContents in RN. |
| Find bar, tab strip, toolbar | Chrome's own views, inside the invisible ghost | Unused. Ours stay in RN (Find via `CefBrowserHost::Find`). |
| Context menus, file pickers, `<select>` | Native NSMenu/NSOpenPanel (unchanged); `<select>` is a popup RWHV | Unchanged. |

## Work packages

Order: **WP1 → WP2 → (WP3 ∥ WP4 ∥ WP5)**. Each package is sized for one agent. "Owns" lists the files
that package may edit.

1. **WP1 — Patched CEF build** (`chromium` agent, ~1.5–2 eng-weeks, mostly build time)
   - Owns `~/chromium-build/**` and a new `packages/cef/patches/*.patch`, and drops the result into
     `packages/cef/vendor` (framework, `libcef_dll_wrapper`, headers). Pin the version in `setup.sh`.
   - Delivers the Chromium `WebView` attach skip and the CEF API (`native_contents_hosting`,
     `GetContentsView`, TYPE_NORMAL, `CreateTabInBrowser`, `SetWindowActive`).
   - Acceptance: `chromestyle.mm` with the flag shows the page in our NSView at 120 fps, with a live
     `CALayerHost` under `RenderWidgetHostViewCocoa`.
2. **WP2 — Engine cutover in `packages/cef/ios`** (~2 eng-weeks; depends on WP1)
   - Owns `NNCef.mm`, `NNBrowserView.mm`, `NNClient.*`, `NNPopupWindow.*`, `CefModule.swift` and a new
     `NNWindowHost.{h,mm}`.
   - Maintain one ghost `CefWindow` + Chrome-style Browser per RN window: aligned, alpha 0, parented as
     a child window that follows move, resize, Space and fullscreen changes.
   - `NNBrowserView` creates its tab with `CreateTabInBrowser` and hosts `GetContentsView()`.
   - Tabs Chrome creates itself (`window.open`, `target=_blank`, extensions `chrome.tabs.create`,
     reopen) raise a `tabCreated {windowId, browserId}` event that the store adopts.
   - Keep the `WebView` JS API unchanged.
   - Drop `runtime_style = ALLOY` and the parking window.
3. **WP3 — Delete what Chrome now does** (~1.5 eng-weeks; depends on WP2)
   - Owns `packages/cef/src/*.ts` and the matching `ios/*`, plus `helper/*`.
   - Delete. That's about 7,500 lines across these files:
     - `NNContentBlocker.*` + `NNFilterEngine.*` + `contentBlocker.ts` (and the `vendor/filters` fetch).
       Replace with **uBlock Origin Lite** (MV3/DNR) installed as a component extension through Chrome's
       real extension system. Chrome's own `subresource_filter` isn't EasyList-grade.
     - `NNPasswords.*` / `passwords.ts` → Chrome's password manager and generation.
     - `NNAutofill.*` / `autofill.ts` → Chrome autofill.
     - `NNZoom.*` / `zoom.ts` → Chrome's per-host `HostZoomMap`.
     - `NNExtensions.*`, `NNExtensionPackage.*`, `ExtensionsModule.swift`, `helper/extension_shim.js` →
       Chrome extensions and the Web Store install flow.
     - Most of `NNSiteSettings.*` → content settings through `CefRequestContext`. Keep a thin JS API
       for our site-controls UI.
     - `NNPictureInPicture.*` → Chrome PiP and auto-PiP.
     - The passwords, autofill and favicon parts of `helper/page_script.js`.
   - Keep `NNSwipe`, `NNDevTools`, `NNBrowsingData`, downloads, `NNDiagnostics` and `NNComponents`.
4. **WP4 — Chrome UI surfaces** (~2–3 eng-weeks, long tail; depends on WP2)
   - Owns the new `packages/cef/ios/NNChromeUI.*` and `apps/browser/src/components/site/*`.
   - Implement the table above: verify each surface's position, route the anchored bubbles (passwords,
     permissions, page info, blocked popups, downloads) to RN, and settle on an approach for extension
     popups.
5. **WP5 — App integration** (~1.5 eng-weeks; depends on WP2, can run alongside WP3/4)
   - Owns `apps/browser/src/lib/webviews.ts`, `lib/tabLifecycle.ts`, `components/extensions/*`, and
     additive edits to the store (per `docs/store-api.md`).
   - Adopt Chrome-created tabs; call `SetWindowActive` on window focus.
   - Extension toolbar driven by Chrome's action API.
   - Re-verify split view (three panes = three hosted NSViews), PiP and the blur overlays.

Total: about 9–10 engineer-weeks, or 3–4 calendar weeks with WP3–5 in parallel. The only unknown on the
critical path is WP1's build turnaround.

## Risks

- **Views state vs. our NSView.** With the attach skipped, views-side focus and accessibility parenting
  of the tab no longer run. We already handle both in `NNBrowserView` (Alloy today). Chrome code that
  asks the `ContentsWebView` for bounds (fullscreen, find-bar placement) gets the ghost's geometry,
  which stays correct as long as the ghost stays aligned.
- **Keyboard shortcuts and `chrome.commands`.** Chrome's accelerators live on the Browser window, which
  is never key. Our `Menus.swift` stays the source of truth, and we forward extension commands via
  `SetWindowActive` plus a command-dispatch hook in WP1.
- **Ghost window and Spaces/fullscreen.** A child window follows its parent across Spaces. Fullscreen
  video uses Chrome's fullscreen controller, and we map it to our window's fullscreen as we do today.
- **Private API.** Only what Chromium itself uses (`CALayerHost`, inside Chromium). Our own code adds
  `CABackdropLayer` as an option; `NSVisualEffectView` is enough.

## Prototype index (`~/netnyahoo-research/owlproto`)

- `cefproto.mm`: `--mode=windowed|osr|host`. Options: `PROBE=1` injects input, `EBF=1`/`CONTENTS=1`
  select OSR present paths, `TYPETEST=1` runs the input API matrix.
- `embedder.mm`: OWL-style client (`ANIM`, `PING`, `PROBE`, `TYPETEST`).
- `chromestyle.mm`: Chrome-style CEF experiments (`DETACH`, `HOSTABLE_DETACH`, `MIRROR`, `DIALOG`).
- `sckprobe.swift` + `latency.py`: input→glass latency via ScreenCaptureKit.
- Captures: `run/windowed-back.png`, `run/osr-back.png`, `run/osr-contents.png`,
  `run/owl-embedder.png`, `run/chrome-ghost1.png`, `run/chrome-mirror.png`, `run/chrome-dialog.png`.

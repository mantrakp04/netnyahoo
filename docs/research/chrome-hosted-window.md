# Chrome-hosted windows: Chrome's Browser window is the app window

Status: design + working spike, 2026-09-25. Spike code is behind `NETNYAHOO_CHROME_WINDOW=1`; the default path is
unchanged. Screenshots and the spike's test scripts are in `docs/research/chrome-hosted-window/`.

## Summary

Today every app window is a React Native `NSWindow`, and each profile shown in it has an invisible "ghost" Chrome
window behind it that owns the tabs (`NNWindowHost.mm`). Everything Chrome draws for itself belongs to the ghost:
dialogs, bubbles, popups, menus, focus, occlusion, shortcuts. Each seam bug so far has been fixed on its own terms:
lifting the ghost for modal children, then for titled bubbles, a context-menu fallback patch, keycode tables for
Chrome's shortcuts, activation emulation.

The flip: the app window **is** the CEF Chrome-style `CefWindow` (a `ChromeBrowserWidget` whose `NSWindow` is a
`CefNSWindow`). Our React root is an `NSView` placed inside Chrome's content view, over Chrome's own views. The tabs'
`WebContentsViewCocoa`s stay in our RN tree exactly as today.

The spike runs our real UI (sidebar, toolbar, New Tab page, command bar) in a visible Chrome Browser window, with a
live page next to the sidebar. These need no special cases:

| Seam | Result | How it works now |
|---|---|---|
| Right-click context menu | PASS | Stock widget lookup: the tab's view is in the Browser's own `NSWindow` |
| Passkey dialog (`navigator.credentials.create`) | PASS | Child window of the app window: in front, no lift |
| Autofill dropdown picked with ↓ + Enter | PASS | Unchanged (the idle-pump patch is a message-pump fix, not a window seam) |
| `<select>` popup | PASS | Native menu at the select |
| JS `alert()` | PASS | Chrome's tab-modal dialog, a child window, centred on the page area |
| RN view over the page (command bar) | PASS | Draws and hit-tests over the page |
| Page and sidebar both take clicks; typing reaches the page | PASS | With the root **inside** Chrome's content view (below) |
| Zoom bubble | Shows, top right of the page area | Anchored to Chrome's hidden toolbar; one-line CEF fix below |
| ⇧⌘M, ⌥⌘↑… (Chrome's shortcuts for its own UI) | Chrome's profile menu opened over our UI; blocked by a command-id policy | New seam of the visible window, one choke point |

**Recommendation: proceed.** The core works, and each problem the spike found is small, local and has a known fix.
The approach needs three changes from how the task framed it: the root goes *inside* `BridgedContentView`, not next
to it; Chrome's top chrome must be turned off in the engine, not just covered; and accessibility needs the same
deferral as hit testing. Plan: 5–7 weeks in six phases, each one shippable.

## 1. Putting the RN view hierarchy inside Chrome's `NSWindow`

### What the window is

- `CefWindow::CreateTopLevelWindow` with a Chrome-style delegate creates a `ChromeBrowserWidget`
  (`cef/libcef/browser/views/widget.cc:33-38`). Its `NSWindow` is a `CefNSWindow`, from
  `CefNativeWidgetMac::CreateNSWindow` (`cef/libcef/browser/views/native_widget_mac.mm:84-107`).
- The `BrowserView` is created and initialised into that widget when the Chrome-style `CefBrowserView` is added
  (`chrome_browser_view.cc` `AddedToWidget` → `InitBrowser` → `ChromeBrowserWidget::Init`, `chrome_browser_widget.cc:34-70`).
- So the window can be made synchronously, before the profile is ready, and the Browser added later. That's what
  the spike does (`Ghost::StartHosting`, `NNWindowHost.mm`). `WindowManager.open` needs its window at once.
- RN doesn't need a window of its own. `AppDelegate.swift` gets root views from `RCTRootViewFactory`
  (`WindowHost.makeContentView`), and `WindowManager.open` (`packages/shell/ios/Windows.swift`) is the only place
  that puts them in windows. The spike adds one branch there.

### Candidates

| Candidate | Result |
|---|---|
| **Root as a subview of `BridgedContentView`** (the content view), plus a `-hitTest:` that asks our root first | **Works (spike).** Clicks reach RN and the page; typing reaches the page; the page is visible at 122 fps; resizing reflows. |
| Root next to `BridgedContentView` in the frame view (`NSThemeFrame`) | **Fails.** The page ignores every click: `RenderWidgetHostViewCocoa -shouldIgnoreMouseEvent:` hit-tests from `window.contentView` and drops events that don't land in its own subtree (`content/app_shim_remote_cocoa/render_widget_host_view_cocoa.mm:1041-1071`). Chromium's occlusion checker also only walks `contentView` (`web_contents_view_cocoa.mm:596-638`). Measured with `NETNYAHOO_CHROME_WINDOW_ROOT=frame`: sidebar clicks work, page clicks are lost. |
| Root as a subview of `BridgedContentView` with no hit-test change | Fails: `BridgedContentView -hitTest:` returns itself wherever a `views::View` is under the point (`components/remote_cocoa/app_shim/bridged_content_view.mm:289-333`), and Chrome's views cover the window. |
| `views::NativeViewHost` inside the `CefWindow` | Chromium's own way to embed an `NSView` (`GetHitTestResult` hands `NativeViewHost` points to the `NSView`). CEF has no public API for it; it would need a new `CefView` type (a translator-regenerating CEF API change). Same result as the first row for more work. |
| CEF overlays (`CefWindow::AddOverlayView`) | Views only. It can't hold an `NSView`. |

**Decision: root inside `BridgedContentView`, with our views first for hit testing and accessibility.** The spike
does it with a runtime override of three `BridgedContentView` methods (`NNChromeWindow.mm`, `LetRootComeFirst`):
`-hitTest:`, `-accessibilityChildren` and `-accessibilityHitTest:`. The product version should be a small Chromium
patch in `bridged_content_view.mm` instead of a swizzle (see §5).

Keeping `BridgedContentView` as the content view matters. Chromium updates the widget's geometry from its
`-setFrameSize:` only while it is the content view (`bridged_content_view.mm:775-795`). `NativeWidgetMacNSWindow
-sendEvent:` and the context-menu runner use `contentView` too. Replacing the content view isn't an option.

### Z-order

From back to front:

1. Chrome's compositor output (`BrowserView`: the hidden tab strip, toolbar and bookmarks bar, and an empty contents
   area), drawn in `BridgedContentView`'s layer.
2. Our root (a subview), with the tabs' `WebContentsViewCocoa`/`CALayerHost` inside it, as today.
3. The traffic lights (the titlebar container, above the content view).
4. Chrome's child windows: web-modal dialogs, bubbles, autofill and permission popups, menus. `addChildWindow` keeps
   them above the app window, so nothing needs lifting.

Our UI can sit around and over the page. The command bar draws and hit-tests over it
(`chrome-hosted-window/command-bar-overlay.jpg`), and so do our toasts. Rounded page corners and the window
treatment render identically: sampled sidebar pixels match the default window exactly (both inactive), and the only
titlebar difference is the traffic lights sitting ~2 pt further right (`titlebar-vs-default.jpg`). Still to check
with the user: the behind-window blur while the window is active, which test instances can never be.

## 2. Chrome's own UI in the visible window

With `CEF_CTT_NONE` the Browser still builds Chrome's full `ToolbarView`, tab strip and bookmarks bar.
`OverrideCreateToolbar` returns null (`chrome_browser_view.cc:85-109`), so `BrowserView` makes the stock toolbar
(`browser_view.cc:963-965`). Our `native_contents_hosting` keeps the Browser `TYPE_NORMAL`, so every
`SupportsWindowFeature` answer is the tabbed default (`window_feature_controller.cc:53-58, 96-101`). The spike's
accessibility dump shows them all: Back, Forward, Reload, "Address and search bar", Extensions,
"Sign In to Chromium?", the bookmarks bar and the tab strip. Our root covers them, so they're invisible and never
clicked. But:

- **Bubbles anchored to them appear over our UI.**
  - The zoom bubble is a 262×48 child window at the top right of the page area (`zoom-bubble.jpg`).
  - ⇧⌘M opened Chrome's profile menu over the New Tab page (`profile-menu-shortcut.jpg`).
- **Accessibility saw only Chrome's toolbar.** Fixed in the spike by the deferral above.
- **Focus can move into them** (⌥⌘↑ focuses Chrome's toolbar).

**Decision: turn Chrome's top chrome off in the engine.** `ChromeBrowserDelegate::SupportsWindowFeature`
(`cef/libcef/browser/chrome/chrome_browser_delegate.cc:641-652`) returns false for `kFeatureTabStrip`,
`kFeatureToolbar`, `kFeatureLocationBar` and `kFeatureBookmarkBar` when the Browser is `native_contents_hosting`.
CEF's answer wins over Chrome's default. Side effects to handle in the same patch:

- `IsShowingMainUI` / `IsShowingLocationBar` go false, which gates some commands (`browser_command_controller.cc:1721-1731`).
- Chrome's `IDC_NEW_TAB` would target another tabbed browser (`browser_commands.cc:1396-1408`). Ours is our menu's anyway.
- `action.openPopup` refuses windows without a toolbar (`extension_action_api.cc:150-154`).

Where the anchored bubbles go:

| Surface | Without Chrome's toolbar | Plan |
|---|---|---|
| Zoom | Anchors to the top of `BrowserView` (`toolbar_view.cc:1899-1903`) | Off for our tabs: `ZoomController::SetShowsNotificationBubble(false)` (`components/zoom/zoom_controller.h:172`); our toolbar shows the zoom level. |
| Page info / permission prompts | Rect fallback at the top left of `BrowserView` (`bubble_anchor_util_views.cc:178-190`) | Already ours (`CefPermissionHandler`). |
| Passwords, save card / address | `GetBubbleAnchor` → top container | Passwords already ours (`CEF_NN_PASSWORD_BUBBLE`). Card/address: they now show without any lift, at the top of the page. Acceptable for phase 3; anchor to our toolbar later. |
| Extension popups | No fallback: `ExtensionPopup` needs an anchor (`extension_popup.cc:85`) | Keep ours (`NNChromeUI` popups), as today. |
| Downloads bubble | Hidden button anchor | Off already (`download_bubble.partial_view_enabled`). |
| Status bubble | Bottom left of Chrome's `ContentsWebView` (`status_bubble_views.cc:794-801`) | Ours already; turn Chrome's off with the `chrome_status_bubble` setting. |
| Tab-modal dialogs (alert, WebAuthn, HTTP auth) | Centred on the contents area, top at the toolbar's bottom (`tab_modal_dialog_host.cc:50-62, 130-135`) | Keep. Chrome's contents area is laid over our page (`Ghost::Layout`), so they centre on the page. The spike's dialogs are 83 pt below the page top because of Chrome's toolbar; hiding it moves them flush with the page, as in Chrome. |
| Find bar | `UpdateFindBarBoundingBox` | Ours (`CefBrowserHost::Find`). |

"Invisible anchor views over our RN buttons" isn't needed with this plan: every anchored surface is either ours
already, turned off, or fine at the page's top edge. If one turns up that must anchor to a button, a small CEF API
(`CefBrowserHost::SetBubbleAnchorRect`-style, feeding `GetBubbleAnchor`) is the fallback.

## 3. The window

- **Titlebar and traffic lights.** CEF already supports Dia's style.
  - `IsFrameless` gives a titled window with a transparent, hidden titlebar whose content fills the frame
    (`native_widget_mac.mm:93-101`, `ns_window.mm` `contentRectForFrameRect`).
  - `WithStandardWindowButtons` keeps the traffic lights.
  - `GetTitlebarHeight` sets the titlebar height, and CEF centres the lights in it (`CefThemeFrame _titlebarHeight`
    / `_shouldCenterTrafficLights`).
  - The spike uses 53 pt, which puts them at `BrowserWindow`'s 19.5 pt. The x inset needs the same nudge
    `BrowserWindow.layoutTrafficLights` does.
- **Delegate ownership.** The `NSWindow` delegate is Chromium's `ViewsNSWindowDelegate`; don't replace it.
  - `WindowManager` follows these windows through notifications. The spike registers `didBecomeKey`,
    `didChangeOcclusionState` and `willClose` with the delegate methods' selectors.
  - `windowShouldClose` (the "warn before closing" question) becomes `CefWindowDelegate::CanClose` → a shell event.
  - Minimise, zoom and full screen are AppKit's own on a titled window.
- **Full screen.**
  - Window full screen goes through Chrome's `ToggleFullscreenMode` → `BrowserView::ProcessFullscreen` → native
    `NSWindow` full screen (`browser_commands.cc:2848-2855`, `browser_view.cc:5695`). Menus.swift's
    `toggleFullScreen:` works as is.
  - With the tab strip "supported", Chrome uses immersive full screen, which moves the top container into an
    overlay widget in the titlebar accessory (`immersive_mode_controller_cocoa.mm:224-251`). With the toolbar off
    there's little to move, but `UsesImmersiveFullscreenMode` reads `CanSupportWindowFeature`, which CEF doesn't
    override (`window_feature_controller.cc:77-81`).
  - HTML5 full screen takes the whole window full screen through Chrome (`fullscreen_controller.cc:185`), where
    `chromium-browser-view-hosted-fullscreen.patch` deliberately keeps the ghost out of it today.
  - **Unknown until tested.** Phase 3 decides whether the patch stays.
- **Spaces, minimise, multiple windows.** One `CefWindow` per app window. It's a normal titled window, so Spaces,
  Mission Control, ⌘\` and the Window menu work natively, with no child-window bookkeeping. Resizing and moving
  worked in the spike; Spaces and minimise weren't exercised (test instances can't be shown to the user).
- **Window restoration.**
  - Our session stays the source of truth (JS reopens windows). Chrome doesn't use `NSWindowRestoration`
    (`native_widget_ns_window_bridge.mm:959-962`), and a CEF `ChromeBrowserWidget` doesn't save placement
    (`browser_view.cc:4076-4081`).
  - Risk: Chrome's `SessionService` could restore old tabs into the first visible window
    (`session_service.cc:212-222, 403-408`). Set `omit_from_session_restore` on hosting Browsers
    (`create_browser_window.h:129`); `WhenProfileReady` already sets `session.restore_on_startup` to 5.
- **A Browser with no tabs.** Chrome closes a Browser whose tab strip empties (`browser.cc:622-627`), but our window
  may show only our New Tab page. The spike keeps the founding `about:blank` tab for the window's life. That tab is
  visible to `chrome.tabs`, so the product needs one of:
  - a per-tab version of `hidden_from_extensions` (extension tab util skips it, ~30 lines, 2–3 files), or
  - a `BrowserDelegate::ShouldCloseOnTabStripEmpty()` hook in `Browser` and `UnloadController` (2 files). Riskier:
    Chrome code assumes an active tab.
- **Several profiles in one window.** A Chrome Browser has one profile. A window showing tabs of a second profile
  still needs a ghost Browser for them (the existing code does this; the spike keeps it). That's the one place the
  seam survives. Options: switch the window's hosting Browser with the profile (move tabs), or accept the ghost for
  secondary profiles. Decide with the product: Dia binds a window to one profile at a time.
- **Incognito.** The spike falls back to the ghost path. A hosting window for an incognito profile is the same code
  with the off-the-record context.
- **Aux windows** (Settings, Import, Task Manager) and popup/PiP windows stay as they are.

## 4. Events and focus

- **Mouse.** With the root inside the content view, AppKit's hit test picks our views (`hit:` probes in the spike):
  - the sidebar → `NetnyahooShell.Surface`;
  - the page → `RenderWidgetHostViewCocoa`;
  - the command bar over the page → `RCTView`.
  Chromium's `-shouldIgnoreMouseEvent:` accepts the page's events because the page is under `contentView`.
  Chrome's views never get mouse events. Their tracking area still receives moves geometrically, which is harmless
  once the toolbar is off.
- **Keyboard: the order in a Chrome window** (`NativeWidgetMacNSWindow -performKeyEquivalent:` → `CommandDispatcher`,
  `command_dispatcher.mm:118-148`):
  1. Chrome's reserved commands. Only for keys mapped to an IDC through Chrome's table or menu items with
     `commandDispatch:` / `performClose:` / `terminate:` (`chrome_command_dispatcher_delegate.mm`,
     `browser_native_widget_mac.mm:628-651`). Our ⌘W/⌘T/⌘Q items use `performCommand:`, so they aren't claimed.
     **Close Window** (⇧⌘W) is `performClose:`, which Chrome maps to `IDC_CLOSE_WINDOW`: give it our own selector.
  2. The normal AppKit walk, then our main menu. ⌘T and ⌘L went to our menu in the spike, both from the page and
     from an RN text field.
  3. Chrome's shortcut table for keys nobody took (`global_keyboard_shortcuts_mac.mm:111-160`). **New seam**: ⇧⌘M
     opened Chrome's profile menu. Fix: one command-id policy in the window's Browser. The spike blocks Chrome's
     own-UI commands (`HiddenChromeUICommand`: avatar/app menu, toolbar focus, tab groups, Chrome's downloads…) in
     `CefCommandHandler::OnChromeCommand` for hosting windows. After it, ⇧⌘M and ⌥⌘↑ do nothing. That replaces the
     keycode table (`IsChromeOnlyShortcut`). With the toolbar off, most of those commands are disabled anyway.
- **Extension commands** (`chrome.commands`) are accelerators on the Browser window's focus manager. The Browser
  window is now the key window, so they should run without `ForwardKeyEvent`'s re-dispatch into the ghost. Phase 3
  checks it.
- **First responder between RN fields and the page.** Unchanged: both are `NSView`s in the same window. The find bar
  and command bar are RN text fields; the page is `RenderWidgetHostViewCocoa`. `SetWindowActive` emulation becomes
  unnecessary for hosting windows: the Browser's widget really becomes key, so `BrowserList` "last active", JS dialog
  gating and `windows.getLastFocused` follow natively.
- **Swipes, drag and drop.**
  - `NNSwipe.mm` hooks the page view's delegate and should carry over. Several helpers find "the root" through
    `window.contentView`, which is now Chrome's view: `NNSwipe.mm:187/453/492`, `SwipeModule.swift:38`,
    `ShadersModule.swift:21`, `AppModule.swift:213` (snapshot), `Handoff.swift:49`, `NNZoom.mm:78`,
    `NNPictureInPicture.mm:290/502`. Phase 2 moves them to one `rootView(of:)` helper; the spike did this for
    `relayoutRoot` only.
  - Drag and drop into the page is routed by AppKit to the `WebContentsViewCocoa` under the cursor. Chrome's
    `drag_drop_client_mac.mm:176` hit-tests `contentView`, which our deferral answers. Untested.
- **Accessibility** (found by the spike). `BridgedContentView -accessibilityChildren` returns only Chrome's views
  root (`bridged_content_view.mm:1716-1727`): VoiceOver saw Chrome's hidden toolbar and none of our UI. The spike's
  override puts our root's unignored children there instead; our sidebar, toolbar and New Tab page appear in the
  tree. The page's own web tree didn't appear in either model's dump, because Chrome builds it only for an active
  assistive technology. Needs a VoiceOver pass (phase 3).

## 5. What goes away, what's new

### Becomes unnecessary once every window is hosted

| Item | Size | Why |
|---|---|---|
| Ghost lift machinery in `NNWindowHost.mm`: `NNWindowVisibilityWatcher`, `ShowsChromeWindows`, `WatchChromeWindows`, `Align`'s child-window ordering, `MakeWindowInert` for app ghosts, parent-window observers | ~220 lines | Chrome's windows are children of the app window |
| `chromium-context-menu-hosted.patch` | 1 Chromium file | `GetTopLevelWidgetForNativeView` finds the widget through `[view window]` (`native_widget_mac.mm:1324-1342`); the fallback branch never runs |
| `IsChromeOnlyShortcut` keycode table (`NNClient.mm:131`) | ~25 lines | Command-id policy in one place |
| `ForwardKeyEvent`, `LoadKeybindings`, keybinding parsing (`NNWindowHost.mm` "Extension commands") | ~110 lines | Extension accelerators run on the key Browser window (verify first) |
| `SetWindowActive` emulation for app windows (API stays for ghosts of secondary profiles) | small | The Browser window really becomes key |
| "Test instances need `active:1` for JS dialogs" workaround | test-only | Same |

These stay: `chromium-webview-native-hosted.patch` (we still host the tab's `NSView` in our tree, which is what keeps
`CALayerHost` in our layer tree, blur over the page and RN overlays), `cef-chrome-tabs`, the tab-state/UI-surface
patches, `cef-zidle-pump` (a message-pump fix, not a window seam), `chromium-extension-window-hidden` (hidden WebUI
helper windows), and the password / install-prompt hooks (product choices: our UI). The Chrome-UI hooks
(`chromium-chrome-ui-hooks.patch`) stay for our pickers, but they're no longer needed to make Chrome's choosers
visible.

### New patches (all incremental: CEF `libcef` or single Chromium UI files; no `BUILD.gn`/GN arg changes)

| Patch | Files | Notes |
|---|---|---|
| `BridgedContentView` embedder subview: hit testing and accessibility consult a designated subview first | 1–2 (`components/remote_cocoa/app_shim/bridged_content_view.{h,mm}`) | Replaces the spike's swizzle. The API is an `NSView` property; reached through CEF's `CefWindow` handle or a `cef_netnyahoo.h` C function |
| Hide Chrome's top chrome for `native_contents_hosting` Browsers | 1–3 (`chrome_browser_delegate.cc`, maybe `browser_command_controller.cc`) | `SupportsWindowFeature` + the command-gating fallout |
| No zoom bubble for hosted tabs | 1 (`cef` hosting code) | `ZoomController::SetShowsNotificationBubble(false)` when a tab is marked hosted |
| `omit_from_session_restore` for hosting Browsers | 1 (`chrome_browser_host_impl.cc`) | |
| Placeholder tab hidden from extensions, *or* Browser survives an empty tab strip | 2–3 | See §3 |
| Maybe: `CanClose` reason / window-close routing | CEF only if `CanClose` isn't enough | |

About 8–10 Chromium/CEF files in total: `.cc`/`.mm` edits, plus `cef_netnyahoo.h` markers. Only a new
`include/` API triggers CEF's translator (`version_manager.py -u --fast-check`), then an incremental `05-build.sh`
and `06-distrib.sh`. Nothing touches GN args or `out/` beyond the normal incremental build.

## 6. Phased plan

Every phase ships; the flag keeps the ghost path as the default until phase 4.

| Phase | Work | Exit criteria | Time |
|---|---|---|---|
| 0. Spike | Done: `NETNYAHOO_CHROME_WINDOW=1`, this doc | 13/14 seam checks pass (`spike/spike.mjs`) | done |
| 1. Engine groundwork | The patches in §5 (one `nn-chromium.lock` cycle each, private CEF install first). `cef_netnyahoo.h` markers so the app builds without them | Default path unaffected; the spike without its swizzle; zoom bubble and profile menu gone; no `about:blank` in `chrome.tabs` | 4–6 days |
| 2. One window type behind the flag, production quality | `NNChromeWindow` without dynamic lookups. `WindowManager`: close warning through `CanClose`, frame autosave, traffic-light x inset, incognito windows. `rootView(of:)` for every `contentView` user (§4). Command policy reviewed against Chrome's full shortcut table. Keep the ghost for secondary profiles | A browser window with the flag passes the release smoke test (`smoke.mjs` hosted variant) and the spike checks | 1–1.5 weeks |
| 3. Parity checklist | Each item tested in a flagged build, with fixes. Surfaces: save card/address, permission prompts, extension popups and install, device chooser, Cast, find, downloads, status. Window: full screen (window and HTML5; decide on `chromium-browser-view-hosted-fullscreen.patch`), Spaces, minimise, multiple displays, split view, popups, PiP, DevTools docked and undocked, drag and drop, swipes, IME, VoiceOver, extension `chrome.commands`, multi-profile windows, session restore, quitting with dialogs open | `docs/migration-status.md` ledger entries for each, user-run checks listed | 2 weeks |
| 4. Switch the default | Flag inverted (`NETNYAHOO_CHROME_WINDOW=0` = ghost), one or two releases of dogfooding | No seam regressions reported | 3 days + a dogfood week |
| 5. Delete the ghost | Remove the lift machinery, keycode tables, `ForwardKeyEvent`, the context-menu patch, the flag. Keep ghosts only if secondary-profile windows still need them | Smaller `NNWindowHost.mm`; release smoke test green | 2–3 days |

Total: about 5–7 weeks calendar, most of it phase 3's long tail.

### Risks and unknowns

- **Accessibility.** The spike's override exposes our tree, but the page's web area inside our view still has to be
  checked with VoiceOver. Chrome's `AccessibilityFocusOverrider` on the widget may also fight focus reporting.
- **Full screen.** Immersive mode and HTML5 full screen now drive our real window. They might need
  `UsesImmersiveFullscreenMode` to consult CEF.
- **Web-modal click blocking.** While a tab-modal dialog is up, `NativeWidgetMacNSWindow -sendEvent:` swallows left
  clicks that Chrome's views classify as blocked (`native_widget_mac_nswindow.mm:~750-775`). That's Chrome's
  behaviour for the page. Check that it doesn't also block our sidebar (the classification uses views hit testing,
  which our deferral doesn't change).
- **Chromium upgrades.** The embedder-subview hook touches a file Chromium edits often. It's small, but it gets
  rebased with every version.
- **Multi-profile windows** keep a ghost (§3) unless the product changes.
- **Test coverage.** Test instances are never active or key, so page-first ⌘-key ordering (a page consuming ⌘-keys
  before our menu) and the active-window blur can't be measured headless. The user has to check them.

## 7. The spike

Code (default path unchanged: every new branch needs `NETNYAHOO_CHROME_WINDOW=1`):

- `packages/cef/ios/NNChromeWindow.{h,mm}`: `NNChromeWindowHost` makes the window, embeds the root in Chrome's
  content view, overrides `BridgedContentView` hit testing and accessibility, and adds DEV input actions.
  - `hit:` / `click:` / `type:` / `keys:` through `devWindow`, because test instances get no OS events and are never
    active.
  - The DEV `click:` goes through `NSWindow -sendEvent:` for RN views (their touch handler is window-driven) and
    straight to `RenderWidgetHostViewCocoa` for the page. The same probe on the default path gives the same page
    result, so it measures hit testing and Chromium's `-shouldIgnoreMouseEvent:`, not activation.
- `packages/cef/ios/NNWindowHost.mm`: `Ghost::StartHosting` (the ghost *is* the window: no inert/align/lift, keeps
  its placeholder tab, standard buttons, resizable), `MakeHostingWindow`, `BlocksChromeCommand` / `HiddenChromeUICommand`.
- `packages/cef/ios/NNClient.mm`: `OnChromeCommand` consults the policy (false outside hosting windows).
- `packages/shell/ios/ChromeWindowSpike.swift` + `Windows.swift`: `WindowManager.open` asks for a Chrome window
  first. It embeds the root instead of setting `contentViewController`, follows the window through notifications,
  and unmounts the root on close.
- `NETNYAHOO_CHROME_WINDOW_ROOT=frame` keeps the failed frame-view placement for comparison.

Running it:

```bash
cd apps/browser && xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS \
  -configuration Debug -destination 'platform=macOS,arch=arm64' -derivedDataPath build-spike build
export SPIKE_DIR=/some/scratch/dir   # data dirs, pids, outputs
swiftc -O .claude/skills/release/scripts/windows.swift -o $SPIKE_DIR/windows
python3 -m http.server 8795 --bind 127.0.0.1 --directory docs/research/chrome-hosted-window/spike/pages &
docs/research/chrome-hosted-window/spike/launch.sh hosted 9512 --env NETNYAHOO_CHROME_WINDOW=1
node docs/research/chrome-hosted-window/spike/spike.mjs hosted 9512 $(cat $SPIKE_DIR/hosted.pid) \
  http://localhost:8795 $SPIKE_DIR/out interact autofill passkey alert zoom overlay select menu
node docs/research/chrome-hosted-window/spike/keys.mjs hosted 9512 $(cat $SPIKE_DIR/hosted.pid) http://localhost:8795
```

Results, same build, fresh data dirs, hidden instances (`NETNYAHOO_BACKGROUND=1`, never frontmost):

| Check | Chrome-hosted | Default (ghost) |
|---|---|---|
| Page click / typing / sidebar click / back | PASS ×4 | PASS ×4 |
| Autofill ↓ + Enter | PASS (popup layer 999) | PASS |
| Passkey sheet in front | PASS, `lifted=false` | PASS, only because the ghost lifts (`lifted=true`) |
| JS alert in front, dismisses | PASS ×2 | PASS ×2 |
| Zoom | Bubble shows at top right of the page | Bubble created behind the window (hidden) |
| Command bar over the page | PASS | PASS |
| `<select>` popup | PASS (layer 101) | PASS |
| Context menu | PASS (layer 101), stock widget lookup | PASS, needs `chromium-context-menu-hosted.patch` |
| ⇧⌘M from an RN field | Chrome's profile menu opened, then blocked by the policy | falls through (nothing) |
| ⌘T / ⌘L | our main menu | our main menu |
| Accessibility | Chrome's toolbar only, then our UI with the override | our UI |
| Page visible / rAF | `visible`, 122 fps | — |
| Resize 1360×860 → 1100×700 | page reflows to 903×646 | — |

Screenshots: `page-and-sidebar.jpg`, `passkey.jpg`, `alert.jpg`, `context-menu.jpg`, `select-popup.jpg`,
`command-bar-overlay.jpg`, `zoom-bubble.jpg`, `profile-menu-shortcut.jpg`, `titlebar-vs-default.jpg`.

The spike deliberately doesn't cover: incognito and secondary-profile windows, window close warnings, full screen,
Spaces, drag and drop, extension commands, IME and VoiceOver. Its Browser keeps an `about:blank` tab visible to
extensions.

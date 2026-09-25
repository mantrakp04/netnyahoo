# Chrome-hosted windows: Chrome's Browser window is the app window

Status: design, spike, phases 1, 2 and 3a (per-profile Chrome windows) done, 2026-09-26. Chrome-hosted windows are behind
`NETNYAHOO_CHROME_WINDOW=1` and need the engine's `CEF_NN_CLIENT_WINDOW` (in the shared `vendor/cef` since
2026-09-26); the default path is unchanged. Screenshots and the test scripts are in
`docs/research/chrome-hosted-window/`. Results: [Phase 1](#phase-1-engine-done),
[Phase 2](#phase-2-production-behind-the-flag-done), [Phase 3](#phase-3-per-profile-windows-and-the-rest-in-progress).

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

## Phase 1 (engine), done

Two incremental patches (`docs/cef-source-build.md`, `CEF_NN_CLIENT_WINDOW`) replace the spike's runtime overrides:

- **`cef-zwindow-client.patch`** (10 CEF files; a new `include/` API, so the translator ran):
  - `CefBrowserSettings.client_window`: no tab strip, toolbar, location bar or bookmarks bar
    (`SupportsWindowFeature`), no zoom bubble for its tabs, `omit_from_session_restore`, and the Browser stays
    open without tabs.
  - `CefBrowserView::CreateTab`: adds a tab to such a Browser even when it has none.
- **`chromium-window-hosted.patch`** (5 Chromium files):
  - `BridgedContentView.netnyahooEmbeddedView`: hit testing and accessibility ask it first.
  - `Browser::TabStripEmpty` / `UnloadController::TabStripEmpty` keep a client window open unless it is closing.
  - Tab-strip-less normal Browsers use the popup layout. The tabbed layout CHECKs for the tabbed toolbar's
    background (`browser_view_tabbed_layout_impl.cc:1673`) and crashed the first build that hid the tab strip.

**The placeholder tab: keep-alive, not hide-from-extensions.**
- Hiding one tab of a tab strip from extensions leaks everywhere: every `Tab.index`, `tabs.move`/`highlight`
  indexes, `tabs.query`, `windows.get({populate})`, and the tab events (onCreated, onActivated, onRemoved,
  onMoved…) across `tabs_api.cc`, the event router and `ExtensionTabUtil`.
- A Browser with no tabs is a state Chrome already passes through while closing a window. It's also the truth
  when the window shows only our New Tab page.
- The cost is one API: every existing tab API addresses a Browser through one of its tabs, hence
  `CefBrowserView::CreateTab`.
- The app side:
  - The window's Browser is made with its first real tab (no placeholder in the common path).
  - A tab moved or reopened into an empty window uses a placeholder made with `CreateTab`, dropped a second later
    as ghosts already do.

**App side** (`NNChromeWindow.mm`, `NNWindowHost.mm`, `NNClient.mm`):
- Key routing:
  - In a client window, a key the page and our menus don't take goes on to Chrome.
  - `HiddenChromeUICommand` in `OnChromeCommand` is the one filter.
  - No keycode table, no forwarding to a ghost.
- File › Close Window has its own action. Chrome's command dispatcher maps a `performClose:` menu item to its
  reserved `IDC_CLOSE_WINDOW` and would run it before our first responder.

**Checks** (hidden instances, flag on, new engine; `spike/spike.mjs`, `spike/keys.mjs`):

| Check | Result |
|---|---|
| Page click, typing, sidebar click and back | PASS |
| Autofill ↓ + Enter, `<select>`, context menu | PASS |
| Passkey sheet in front, with no lift | PASS. Dialogs now start at the page's top edge (y 186 → 100 pt), since Chrome's toolbar is gone |
| JS alert in front, dismisses | PASS (the run before the screen locked) |
| Zoom | PASS: no bubble at all (was a 262×48 window over the page) |
| Command bar over the page | PASS |
| ⇧⌘M, ⌥⌘↑, ⌥⌘L | Nothing happens (Chrome's commands are off without main UI, and the blocklist) |
| ⌘T, ⌘L | Our menu |
| ⇧⌘W | Not taken by Chrome's dispatcher (our menu item) |
| Closing every web tab | Window and Browser stay, no tab left, no `about:blank` target; the next page is a tab of the same Browser |
| Accessibility | Identical to the default window apart from the window title: our sidebar, toolbar and page controls, none of Chrome's toolbar, tab strip or bookmarks bar. Walked in-process through `NSAccessibility` (`devWindow(n, "ax")`), because the AX server returns nothing while the screen is locked |

Default path on the new engine:
- The release smoke test (`SMOKE_APP=…`) gives 9/12, the same as the shipped 0.1.5 and 0.1.6 builds on the same
  locked screen. The three ghost z-order checks read CGWindowList order, which is unreliable while the screen is
  locked.
- The spike steps give the same results as the old engine run side by side.
- The lift itself works: `lifted=true` with the passkey sheet in front.

Still to run with the screen unlocked (ledger in `docs/migration-status.md`): the z-order smoke checks, passkey
dismissal on navigation, and a VoiceOver pass over web content.

Estimates after phase 1:
- Phase 1 took about a day instead of 4–6. The layout CHECK was the only surprise.
- Phase 2 loses the placeholder and command-filter work but gains a few items:
  - the popup layout's behaviour in full screen;
  - moves into an empty window (placeholder path, written but not exercised);
  - `browser_delegate.h` is included by `browser.h`, so any change to that CEF header rebuilds ~1,700 Chrome UI
    objects (7 minutes here, still incremental).
- Phases 2–5 otherwise unchanged: about 4–6 weeks.

## Phase 3 (per-profile windows and the rest), in progress

**3a is done: in a flagged window no profile uses a ghost.** An app window is a group of Chrome-hosted windows, one
per profile it shows.

The engine gains **`cef-zwindow-translucent.patch`**:
- `CefWindowDelegate::IsTranslucent` creates the window's widget `kTranslucent`.
- Chrome-hosted windows use it, and their compositor background is transparent.
- Installed shared on 2026-09-26; nothing on the default path asks for it.

The app side:
- `setWindowProfile(id, profile, neighbours)` from `lib/native.ts` (a no-op for ordinary windows) runs whenever
  a window's profile changes: a swipe settles, ⌃1–9, a tab of another profile.
- The window's Chrome window of that profile takes our root: `NNChromeWindowHost showProfile:inWindow:`, then
  the shell's registry follows through the swap callback.
- The profiles next to it in profile order get their windows ahead, off screen; each Browser comes with its first tab.
- A tab of profile B mounted while profile A's window is on screen belongs to B's window's Browser
  (`GhostForTab` → the group's window for B). So when B comes on screen its tabs are already that window's.
- Closing the app window closes the whole group, each Browser once no tab is moving out of it.

The swap (`Swap` in `NNChromeWindow.mm`) orders the new window in behind at the same frame with window
animations off, moves the root, commits, and orders the old window out. `NETNYAHOO_PROFILE_SWAP` picks how the
seam is covered:
- **transparent (default):** the window leaving is translucent, so once the root has left it shows nothing.
- **snapshot:** a picture of the window (`CGWindowListCreateImage`, looked up at run time because the SDK marks it
  obsolete) sits in a borderless window over the swap for about 50 ms.
- **naive:** neither.

In full screen, the swap waits until the window leaves full screen. Until then that profile's pages show in the
full-screen window, where their Chrome dialogs would belong to a window that isn't on screen. That's a known gap,
listed for human testing.

| 3a check (headless, `spike/p3.mjs`, `spike/restore3.sh`) | Result |
|---|---|
| The neighbour profile's window made ahead, off screen | PASS |
| A profile switch moves our views to that profile's own Chrome window; one window on screen | PASS |
| No ghosts: every Browser of the window is a Chrome-hosted window of one group | PASS |
| Swipe paging Work ↔ home ×4: the store and the Chrome window on screen always agree | PASS |
| ⌃2 / ⌃1 | PASS |
| In the second profile's own window: autofill ↓ + Enter, passkey sheet in front with no lift, Chrome's context menu | PASS |
| Session restore: a window left on its second profile reopens as that profile's window, home window made ahead; a second window keeps its own profile | PASS |
| Flag off on the new engine: smoke 9/12 (same as shipped, screen locked), bundle sealed | PASS |

`spike/swapmeasure.sh <app> <port> <transparent|snapshot|naive|ghost> [swaps]` records store profile switches at
120 fps and counts frames matching neither side; `ghost` is the unflagged baseline. The plumbing is checked up to
capture, which says plainly why it can't run (locked screen, or no Screen Recording permission). Pick the default
strategy from its numbers.

**The rest of phase 3, headless:**

| Check | Flag on | Flag off |
|---|---|---|
| IME through `NSTextInputClient` on the page's view (marked "にほん", committed "日本") | PASS | PASS |
| IME through CDP (`Input.imeSetComposition`, `insertText`) | PASS | PASS |
| An extension's keyboard command (⇧⌘Y, `chrome.commands`) from the page | PASS: Chrome's own dispatcher on the key Browser window, no forwarding | PASS (our forwarding into the ghost) |
| Multiple displays | human: this Mac has one display attached | |

**Docked DevTools:**
- CEF sets `can_dock = false` for its browsers, so today DevTools always opens in its own window.
- Letting a `client_window` Browser dock would not make it visible. Chrome docks DevTools into `BrowserView`'s
  contents container, a Views child drawn in the content view's own layer. Our root is a subview over that layer
  and covers the whole window, page area included.
- Our page is our own `NSView`, laid out by React, so it wouldn't shrink to Chrome's DevTools resizing strategy
  either.
- Showing Chrome's docked DevTools would need the same pieces as the API route:
  - the page bounds from Chrome's resizing strategy;
  - a transparent hole in our layout where DevTools draws;
  - hit testing that falls through the hole to Chrome's views.
- So docked DevTools is the "API + pane" item: a CEF hook handing the app the DevTools contents view and its
  strategy, plus a pane in our layout. 2–3 days, after the rest of phase 3.

## Phase 2 (production, behind the flag), done

`NETNYAHOO_CHROME_WINDOW=1` is now something to run daily. Every check below is headless, on hidden instances, on
a locked screen; "human" marks what needs a person at an unlocked screen.
Scripts: `spike/p2.mjs` (steps), `spike/restore.sh`, fixtures in `spike/pages` and `spike/ext-popup`.

**Engine** (`cef-zwindow-keys.patch`, CEF-only, installed shared 2026-09-26):
- Chrome's command dispatcher ran its reserved commands before the first responder (⌥⌘→, ⇧⌘}, ⌃PgDn, and
  ⌘T/⌘W/⌘N when mapped), swallowing the key even while the command was disabled.
- In a `client_window` it now waits for the page and our menus. Chrome's shortcuts still run after them, through
  the command-id blocklist.

| Area | Status | Notes |
|---|---|---|
| Home profile | done | The window is the Chrome window of the profile it opened with (`OpenWindowOptions.profile`) |
| Other profiles | done (interim) | Companion ghosts as `client_window` Browsers; Chrome's active window follows the profile on screen; an alert in the second profile's tab shows in front |
| Swipe paging, ⌃1–9 | done | A sidebar swipe (real tracker, `nnSwipe.sidebar().devSimulate`) pages to the other profile and back; ⌃2 switches |
| Incognito windows | done | Chrome-hosted too (their own `incognito:<id>` profile), dark |
| Close warning | done | The close button asks the app through `CanClose`: Dia's "Close 5 tabs?" sheet on the window |
| ⇧⌘W | done | Our own menu action (phase 1) |
| Traffic lights | done | 18 pt in, 19.5 pt down, as BrowserWindow |
| Content-view users (9) | done | PiP's overlay goes over our root (it was unclickable under it). The others only do geometry, identical for the root and the content view, or hit tests, which reach the root through the engine hook |
| First frame | done | BrowserWindow's colours for the `NSWindow` and Chrome's compositor (no white frame) |
| HTML5 full screen | done | Page full screen, our chrome hides, Chrome's "Press Esc" hint at the top centre, Esc exits |
| Window full screen | human | A test instance never goes native full screen (it would open a Space on the user's screen) |
| Tabs into an empty window | done | ⇧⌘T (with its history), a tab dragged out to a new window and back as that window's last (same page: the leaving window's Browser now outlives the move), reopen closed window |
| Split view | done | 2 and 3 panes, all visible at their widths. A pane's alert shows; its position matches the default path |
| PiP | done | `requestPictureInPicture` opens Chrome's PiP window |
| DevTools | done | Opens in its own window. Docking isn't offered: CEF sets `can_dock = false` for CEF-managed browsers (`devtools_window.cc`), on both paths |
| window.open / sign-in popups | done | A sized popup opens in its own window; `window.close()` closes it |
| Downloads | done / human | Download completes into our list; the fly-in animation is visual (human) |
| Find in page | done | 3 matches counted |
| Extension action popups | done | Open anchored to our button and render (25×25 before sizing, same as the default path) |
| Session restore | done | Two windows, two profiles: same frames, pages, each window its profile's Chrome window, no extra tabs from Chrome's session service |
| Keys | done / human | Command-id blocklist; reserved keys reach the first responder. Page-first ⌘-keys need a key window (human) |
| Accessibility | done / human | Tree identical to the default window (phase 1); VoiceOver pass is human |
| Translucency | human | Same vibrancy view in both windows (behind-window, material 29, follows active state, emphasized). Pixels need an unlocked screen: active and inactive, dark and light |

**Findings:**
- **A locked display freezes window animations.** Open, order-out and dialog fade-in all stall. The window server
  keeps windows at their first animation frame: 0.981 scale, dialogs at alpha 0, ordered-out windows still
  listed. So:
  - window geometry and z-order read from `CGWindowList` are unreliable while locked;
  - the smoke test's three z-order checks fail for every build, shipped ones included;
  - screen captures fail entirely.
- **DevTools can't dock**, on either path: CEF passes `can_dock = false` for its browsers, so the dock-side menu never
  appears and DevTools always opens in its own window (checked live: the frontend URL has no `can_dock`).
  Docked DevTools inside our window would be a feature: a CEF API handing the app the DevTools view and its
  resize strategy, and a pane in our UI.
- **Closing a Chrome-hosted window** must go through the engine: an `NSWindow` close destroys its Browser
  immediately, including a tab that is still moving out.

Estimates:
- Phase 2 took about 1.5 days instead of 1–1.5 weeks.
- Phase 3:
  - 3a, per-profile hosted windows: 1.5–2 weeks, the new long pole. It needs the translucent-window CEF patch and
    the unlocked-screen measurement.
  - The parity checklist: 1–1.5 weeks. Most of what it listed is done; the rest is window full screen, Spaces,
    drag and drop, IME, VoiceOver, DevTools docking, multiple displays and the visual checks, most of them human.
- Phases 4–5: unchanged.
- Total remaining: about 4–5 weeks.

## Profiles in a Chrome-hosted window (phase 2 decision)

**Decision: the window is its home profile's Chrome window; any other profile it pages to keeps a ghost Browser,
parented to that window.** The home profile is the one the window was opened with (or its only one: incognito
windows, single-profile windows). Other profiles' ghosts:
- sit exactly over the window as child windows, transparent and click-through;
- lift in front for Chrome's dialogs and titled bubbles, as shipped;
- are `client_window` Browsers, so no tab strip, toolbar, zoom bubble, status bubble or session restore of their own,
  and they outlive their last tab.

Chrome's "active window" follows the profile on screen: the current profile's Browser gets `SetWindowActive`, not
whichever Browser's window became key last.

**Why.** A Chrome `Browser` has one profile for life, and a `CefWindow` holds exactly one `Browser` (the
`ChromeBrowserWidget` is initialised once). So a window that pages between profiles either:
1. swaps `NSWindow`s when the profile changes (one Chrome window per window and profile, with our root moving to
   the new one), or
2. keeps one Chrome window and a ghost for the other profiles.

What the pager needs:
- Paging (`layout/profilePager.ts`) moves only React Native content during the drag: the sidebar pages (or the top
  tab strip's), the page dots, and the tint layers (`ProfileTint`, one vibrancy backdrop per page).
- The page area keeps showing the current profile's tab until the settle finishes. Only then does the window's
  profile change, while the pages and tint layers linger 150 ms to cover the switch.

So the drag and the cross-fade are smooth under both options; they differ only at the switch.

Option 1's switch replaces the whole window at the end of the user's favourite gesture:
- Our root must move to the other `NSWindow`. Nothing can show it in both, so there's a moment where one window
  shows Chrome's own drawing.
- Chrome's widgets are opaque: `CefWindowView` creates them without `kTranslucent`, and the compositor clears to
  white. So that moment is a white window, unless the ordering and the layer commit land in the same window-server
  frame. A public API can't guarantee that: `NSDisableScreenUpdates` and `CGWindowListCreateImage` are gone, and a
  cross-window portal is private.
- Full screen owns a Space per `NSWindow`, so paging in full screen would need a second mechanism: the other
  profile's window as an auxiliary child of the full-screen one.
- The window's identity would change on every page: the WindowManager registry, Mission Control and ⌘\`,
  occlusion reports, Stage Manager, the Window menu.

None of that can be measured while the screen is locked, and a one-frame white flash on every profile swipe would
fail the user's bar.

Option 2's switch changes nothing native, so paging stays exactly as smooth as shipped. What it costs is that
tabs of a profile other than the window's home one keep today's model:
- the lift for dialogs;
- the context-menu fallback patch;
- keys through the page's client to our menu, then the ghost;
- `SetWindowActive` emulation.

That is today's shipped behaviour, not a regression. The seam bugs the inversion fixes stay fixed for every
single-profile window, every incognito window, and the home profile of multi-profile windows. The ghost also gets
simpler: as a `client_window` Browser it has none of the leaks that made the lift logic fussy (hover cards, zoom and
status bubbles).

This was the **phase 2 interim**; phase 3a replaced it (below, and [Phase 3](#phase-3-per-profile-windows-and-the-rest-in-progress)). With it, every profile other than a window's home one keeps the
seams (context menus through the fallback patch, lifted dialogs and bubbles, key forwarding), and phase 5 can't
delete the ghost. The target is option 1, planned below as a phase 3 item.

### Phase 3 item: "Profiles: hosted per-profile windows"

**Target:** one Chrome-hosted `NSWindow` per (window, profile). Paging swaps which one is visible, at the same
frame.

**The pieces:**
- **One root that moves.** Our React root moves between the window's profile windows; there isn't one root per
  profile window. A second root would mount every tab view twice (a tab's `WebContentsViewCocoa` can only be in
  one place). It would also split state that must stay coherent: sidebar scroll, the command bar and find text,
  pager drags, focus. Moving the root keeps all of it; only its window changes.
- **Neighbours pre-made.** Each profile the window can page to gets its Chrome window up front, laid out at the
  same frame and kept ordered out:
  - A Browser is created lazily with the profile's first tab, so an unused window costs little.
  - The profile's active tab is kept visible to Chrome's occlusion (the neighbour window ordered in behind at
    alpha 0, or offscreen), so its compositor has a frame when the swap comes.
- **Previews unchanged.** During the drag the pager keeps showing what it shows today (the sidebar pages and
  tint layers are React content in the moving root), so the gesture itself doesn't change.
- **The cut, at the end of the settle, inside the 150 ms linger:**
  1. Order the incoming window in directly behind the outgoing one, same frame, window animations off
     (`NSWindowAnimationBehaviorNone`: AppKit fades document windows in and out, which the probe showed).
  2. Move the root, then `[CATransaction flush]`.
  3. Order the outgoing window out.
  4. Hand over key status; update the registry and observers.

**Covering the seam (the moment the outgoing window no longer has our root):**
- **Preferred: a transparent outgoing window.** A small CEF patch creates client windows `kTranslucent` (non-opaque
  `NSWindow`, compositor cleared to transparent, not white). Then the outgoing window shows nothing once the root
  has left, and the incoming one, already ordered in behind with the root, shows through. The order-out is
  invisible, and no snapshot or permission is needed. The same patch helps the vibrancy question (§ translucency).
- **Fallback: a cover layer.** Put a snapshot of the settled state over the seam and remove it after the incoming
  window has presented a frame. The snapshot must include web content (a `CALayerHost` from the GPU process). The
  only public way to get that is ScreenCaptureKit, which needs Screen Recording permission, so it's a last resort.
  A private portal layer or `SLSDisableUpdate` grouping would be the other fallback, as would
  `disableScreenUpdatesUntilFlush` if it still has an effect on this macOS.
- **Other work in the item:**
  - full screen: an incoming window joins the full-screen Space as an auxiliary child of the full-screen window, or
    the Space moves with the swap (to test);
  - the WindowManager registry and observers follow the visible window (the id maps to it; occlusion, key and
    close come from it);
  - the ghost code for secondary profiles goes, and so do the lift logic and the context-menu fallback patch.

**Measurement (built in phase 2, runs once the screen is unlocked):**
- `devWindow(n, "swapProbe:<ms>")` does the naive cut (steps 1–4, without the transparent window) into a second
  Chrome window and back, with the same content in both, so any frame unlike the settled state is the seam.
  Mechanics checked headless: 24 ms for the swap including the root's re-layout, and the page stays `visible`.
- `spike/swapcap.swift` records only the app's windows in the window's region at 120 fps (ScreenCaptureKit; other
  apps are left out, so the hidden instance can be measured behind them).
- `spike/swapscan.py` flags every frame that matches neither settled state or is mostly white (validated on
  synthetic frames).
- `spike/swapmeasure.sh <app> <port>` runs the whole thing.

**Pass:** zero transient frames over 20 swaps, with the naive cut first to size the problem, then with the
transparent window. Headless on a locked screen none of this can run: window order-in and order-out animations
never complete there (`orderOut:` reports the window hidden, but the window server keeps listing it).

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
did it with a runtime override of `-hitTest:`, `-accessibilityChildren` and `-accessibilityHitTest:`. Phase 1
replaced that with `BridgedContentView.netnyahooEmbeddedView` (`chromium-window-hosted.patch`).

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
- **Several profiles in one window.** A Chrome Browser has one profile. Decided in phase 2: a window's other
  profiles keep ghost Browsers ([Profiles](#profiles-in-a-chrome-hosted-window-phase-2-decision)).
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
Done in phase 1 (see [Phase 1](#phase-1-engine-done)): 15 files in two patches, `cef-zwindow-client.patch`
and `chromium-window-hosted.patch`. The planned "maybe" left: `CanClose` routing for the close warning (phase 2,
CEF only if `CanClose` isn't enough). Only a new
`include/` API triggers CEF's translator (`version_manager.py -u --fast-check`), then an incremental `05-build.sh`
and `06-distrib.sh`. Nothing touches GN args or `out/` beyond the normal incremental build.

## 6. Phased plan

Every phase ships; the flag keeps the ghost path as the default until phase 4.

| Phase | Work | Exit criteria | Time |
|---|---|---|---|
| 0. Spike | Done: `NETNYAHOO_CHROME_WINDOW=1`, this doc | 13/14 seam checks pass (`spike/spike.mjs`) | done |
| 1. Engine groundwork | Done 2026-09-26 (see [Phase 1](#phase-1-engine-done)) | Default path unaffected; the spike without its swizzle; zoom bubble and profile menu gone; no `about:blank` in `chrome.tabs` | done (~1 day) |
| 2. One window type behind the flag, production quality (done 2026-09-26, see [Phase 2](#phase-2-production-behind-the-flag-done)) | `NNChromeWindow` without dynamic lookups. `WindowManager`: close warning through `CanClose`, frame autosave, traffic-light x inset, incognito windows. `rootView(of:)` for every `contentView` user (§4). Command policy reviewed against Chrome's full shortcut table. Keep the ghost for secondary profiles | A browser window with the flag passes the release smoke test (`smoke.mjs` hosted variant) and the spike checks | 1–1.5 weeks |
| 3a. Profiles: hosted per-profile windows (done 2026-09-26 but for the measurement) | See [Phase 3 item](#phase-3-item-profiles-hosted-per-profile-windows): the transparent-window CEF patch, pre-made neighbour windows, the cut, full screen; measured with `spike/swapmeasure.sh` | 0 transient frames in 20 swaps; paging looks unchanged; secondary-profile ghosts gone | 1.5–2 weeks |
| 3. Parity checklist | Each item tested in a flagged build, with fixes. Surfaces: save card/address, permission prompts, extension popups and install, device chooser, Cast, find, downloads, status. Window: full screen (window and HTML5; decide on `chromium-browser-view-hosted-fullscreen.patch`), Spaces, minimise, multiple displays, split view, popups, PiP, DevTools docked and undocked, drag and drop, swipes, IME, VoiceOver, extension `chrome.commands`, multi-profile windows, session restore, quitting with dialogs open | `docs/migration-status.md` ledger entries for each, user-run checks listed | 2 weeks |
| 4. Switch the default | Flag inverted (`NETNYAHOO_CHROME_WINDOW=0` = ghost), one or two releases of dogfooding | No seam regressions reported | 3 days + a dogfood week |
| 5. Delete the ghost | Remove the lift machinery, keycode tables, `ForwardKeyEvent`, the context-menu patch, the flag. Keep ghosts only if secondary-profile windows still need them | Smaller `NNWindowHost.mm`; release smoke test green | 2–3 days |

Total: about 5–7 weeks calendar, most of it phase 3's long tail.

### Risks and unknowns

- **Accessibility.** The engine hook exposes our tree, but the page's web area inside our view still has to be
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

- `packages/cef/ios/NNChromeWindow.{h,mm}`: `NNChromeWindowHost` makes the window and embeds the root in Chrome's
  content view (since phase 1 through `netnyahooEmbeddedView`; the spike overrode `BridgedContentView` at runtime).
  It also adds DEV input actions.
  - `hit:` / `click:` / `type:` / `keys:` through `devWindow`, because test instances get no OS events and are never
    active.
  - The DEV `click:` goes through `NSWindow -sendEvent:` for RN views (their touch handler is window-driven) and
    straight to `RenderWidgetHostViewCocoa` for the page. The same probe on the default path gives the same page
    result, so it measures hit testing and Chromium's `-shouldIgnoreMouseEvent:`, not activation.
- `packages/cef/ios/NNWindowHost.mm`: `Ghost::StartHosting` (the ghost *is* the window: no inert/align/lift,
  standard buttons, resizable; since phase 1 its Browser comes with the first tab and outlives the last),
  `MakeHostingWindow`, `BlocksChromeCommand` / `HiddenChromeUICommand`.
- `packages/cef/ios/NNClient.mm`: `OnChromeCommand` consults the policy (false outside hosting windows).
- `packages/shell/ios/ChromeWindowSpike.swift` + `Windows.swift`: `WindowManager.open` asks for a Chrome window
  first. It embeds the root instead of setting `contentViewController`, follows the window through notifications,
  and unmounts the root on close.
- (Spike only, removed in phase 1: `NETNYAHOO_CHROME_WINDOW_ROOT=frame`, the failed frame-view placement.)

Running it (with an engine that has `CEF_NN_CLIENT_WINDOW`):

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

# NNCore parity: the app's engine API on NNCore

**The owner chose a full cutover (2026-10-01):** the next release ships NNCore only, and CEF's native side leaves
the repo. The JS API (once `packages/cef/src`, now `packages/nncore/src`, imported as `@netnyahoo/nncore`) doesn't
change: `packages/nncore` registers the same Expo modules and view names (`NetnyahooCEF`, `NetnyahooExtensions`,
`NetnyahooSwipe`, `NetnyahooChromeUI`) with the same signatures. The cutover lands as a short series of commits on main: the NNCore project becomes
`apps/browser/macos` (C1), CEF's native side goes (C2), production data in place with a one-shot migration of
0.2.21's data, and `scripts/release.sh`/smoke on NNCore.

## Before switching (blockers for the first NNCore release)

Keep this list short and shrinking; each item names its owner.

1. ~~**Cutover commits**~~ done: C1, the fold (8f1074f1: one project, `Netnyahoo-macOS`, `com.netnyahoo.browser`),
   and C2 (6bdf66ce, 4b0d0697: `packages/cef` deleted, its JS in `packages/nncore/src`, the patch series in
   `engine/patches`, `apps/browser/macos-nncore` gone). Left: release.sh/smoke on NNCore. *Release-pipeline agent.*
2. ~~**Production data dir and migration**~~ done: a release build without `NETNYAHOO_DATA_DIR` opens
   `~/Library/Application Support/com.netnyahoo.browser/Chromium` in place (`InstalledDataDirectory`), with the
   login keychain only when Developer ID-signed and the app's documents in the folder above, as on CEF. No migration
   step: both engines are Chromium 154.0.8037.58 and read the same "Netnyahoo Safe Storage" item. Proven by
   `carryover.sh` (the release smoke test): 0.2.21 made two profiles' tabs, persistent and session cookies,
   localStorage, passwords, bookmarks, history, an address, a site permission, a zoom level and an unpacked
   extension; the NNCore build found and read every one (21/21) without `NETNYAHOO_DATA_DIR`. Left for the owner:
   the real login keychain's item, which no hidden run reads (both binaries name it "Netnyahoo Safe Storage", and
   smoke.sh checks the build satisfies 0.2.21's designated requirement, which the item's access trusts).
   Going back works too (`rollback.sh`): 0.2.21 → the RC → 0.2.21 on the same folder keeps everything from both
   sessions (tabs, passwords, bookmarks, history, zoom, the extension's setting, persistent cookies, localStorage),
   with no crash and no profile reset (the same Chrome version, so no newer-profile handling; Local State,
   Preferences and Sessions intact). Only session cookies don't come back, because 0.2.21 drops them at every launch.
3. ~~**Session cookies**~~ done: NNCore keeps them across launches (09fe90cc), and keeps 0.2.21's at the switch
   (`carryover.sh`). 0.2.21 itself drops session cookies at every launch (its own restart loses them; measured with
   `rollback.sh`), so this is a gain over CEF, not parity.
4. ~~**The content blocker blocks nothing** in a production build~~: not a bug. uBlock Origin Lite runs in its
   optimal mode on NNCore and answers ad scripts with its stand-ins (`adsbygoogle.js` → its no-op copy, a 307 to the
   extension's web-accessible resource), so a fetch or a `<script>` "loads" without the request leaving the browser;
   CEF failed those stand-ins (ERR_BLOCKED_BY_CLIENT), which the smoke test counted as "blocked"; its ad checks now
   judge by the network (2047812f). Proven by `content-blocker-blocks` and `content-blocker-profile`.
5. ~~**Private-window privacy**~~: done. A private tab Chrome makes goes to a private window of the app (one
   showing its profile, else a new one that adopts it live), never into a normal window (`private-windows-create`,
   `context-menu-incognito`).
6. **Dogfood bugs**: B1 (the sad tab after Reload), B2 (sized `window.open` popups get a window of their own),
   B3 (window height) and B4 (`chrome://crash` keeps the tab's URL) are done (`crash-reload`, `popup-window`,
   `window-size`, `crash-debug-url`). The 0.2.22 RC's crash opening a window (a dead private profile reached
   `WindowHost::BrowserFor`) is fixed (`window-profiles`), and the content blocker's page no longer shows in
   history (`internal-pages-not-history`). A hidden test instance that crashes writes `<data dir>/crashes/crash-<pid>.txt`
   and exits without macOS's crash report, dialog or focus change (`crash-guard`); a data dir it can't use stops it
   with a message, not an abort; Cocoa's `-Key value` arguments stay off Chrome's command line (`launch-cocoa-args`).
   The extension batch is done too: B9, an action's popup is Chrome's own extension view bound to the window it was
   clicked in, so its current window and active tab are that window's (`extension-popup-window`; Dark Reader shows
   the page's site again); B10/B11, the host's hidden windows are no extension's and never shown by Chrome, so the
   "added" bubble anchors to the app's window and an extension's tabs land there (`extension-windows-hidden`); B12,
   an extension install's .crx is no download (`extension-download-hidden`); B8, the blocked count counts the
   rules' blocks and redirects to stand-ins (`content-blocked-count`); B7, no Reading mode in the page menu
   (`context-menu-reading-mode`). Chrome's "<name> has been added" UI is NNCore's (a hook in
   `ExtensionInstallUIDesktop::OnInstallSuccess`, `nn_installed_bubble.mm`): over a window the app shows for the
   profile, held until one shows a page when there is none; Chrome's own crashed reading the active tab of a Browser
   without one (`extension-installed-bubble`).
   Open: after another profile's window opened and closed, "Share this tab instead" answers false (`tab-capture`).
7. ~~**Smoke parity**~~ done: background-mode context-menu log, the autofill dropdown's selection, the PiP self-test
   (`NETNYAHOO_PIP_SELFTEST`) and the passkey dialog closing when its page navigates; the release smoke test passes
   21/21 on NNCore (e8ece135, 2109af22, 2047812f).
8. **Chrome's own UI says "Chromium"** (bubbles, dialogs, error pages); CEF renamed it. *Engine helper.*
9. **Checks that need the owner** (an unlocked screen, prompts): the page composited under the RN views; menus,
   bubbles and choosers drawn against the window; PiP on screen; IME marked text; VoiceOver; a camera/microphone
   grant; a Bluetooth chooser (any Web Serial or Web Bluetooth chooser waits on macOS's Bluetooth permission, so no
   hidden run can open one).

Not blocking, decided: the framework and helpers keep Chrome's names ("Chromium Framework", "Chromium Helper") until
the next full engine rebuild (they're compiled in; bundle ids, signing and keychain already key off the app).

Keep this current: whoever adds or changes a native export or event of the JS API (`packages/nncore/src`) adds its
row here. The rows compare with CEF's implementation as it was at the cutover (`git show c6b9634c:packages/cef`).

Statuses:
- **done**: does on NNCore what it does on CEF, and the acceptance run (below) or the engine's own run proves it.
- **partial**: wired to the engine and doing the common path, but not proven in a hidden run (the note says why),
  or with a gap the note names.
- **stubbed**: exported, so the JS never throws, but answers as an engine without the feature would.
- **missing**: not exported on NNCore; the JS throws if it calls it.

## Summary (2026-10-01, stage 2)

| Area | done | partial | stubbed | missing |
|---|---|---|---|---|
| `WebView` props (9) | 6 | 3 | 0 | 0 |
| `WebView` events (32) | 22 | 10 | 0 | 0 |
| `WebView` methods (35) | 26 | 9 | 0 | 0 |
| `NetnyahooCEF` functions (62) and events (7) | 61 | 7 | 1 | 0 |
| `NetnyahooExtensions` (10 functions, 3 events) | 8 | 5 | 0 | 0 |
| `NetnyahooChromeUI` (15 functions, 4 events) | 9 | 10 | 0 | 0 |
| `NetnyahooSwipe` (7 functions, a view with 3 events) | 11 | 0 | 0 | 0 |
| Window hosting (`NNChromeWindowHost`, used by `packages/shell`) (13) | 13 | 0 | 0 | 0 |
| **Total (201)** | **156 (78%)** | **44** | **1** | **0** |

Nothing is **missing** and every signature matches `packages/cef`'s (checked by diffing the Swift module
definitions). 200 of 201 rows are wired to Chrome; the **partial** rows are almost all paths a hidden, locked-screen
run can't drive without side effects on the owner's Mac: camera, microphone and screen capture (macOS prompts),
Picture in Picture (a floating window on screen), hung pages (Chrome's hang monitor ignores hidden windows), real
Cast sinks and USB/Bluetooth devices, print and save dialogs. They are listed under "What's left" with what each
needs.

## How to build and check it

```bash
# Engine (once, and after engine/nncore changes): engine/nncore/apply.sh, then
#   scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework   (docs/nncore-spike.md)
# App: apps/browser/macos (the only app project; pod install there after adding native files).
scripts/agent/build-app --as <you>     # into apps/browser/build-<you>; --help
# Acceptance, hidden (open -g -n, NETNYAHOO_BACKGROUND=1, a scratch data dir); METRO_PORT is a Metro for this checkout.
METRO_PORT=8081 node packages/nncore/scripts/acceptance.mjs apps/browser/build-<you>/Build/Products/Debug/Netnyahoo.app <scratch dir> [check…]
```

The app is the CEF app's (bundle id `com.netnyahoo.browser`, Apple Development signing with the hardened runtime in
Debug; `scripts/release.sh` signs releases with Developer ID). A Debug build refuses to start without
`NETNYAHOO_DATA_DIR` (it never falls back to a real profile). A test run hands it its Metro in `NETNYAHOO_JS_LOCATION`
(that launch's argument domain, never written); never `defaults write com.netnyahoo.browser`, the installed app's. Its build stages a copy of the engine framework
(`packages/nncore/scripts/stage-framework.sh`, under the chromium lock, into `NNCORE_STAGE_DIR`), links that, and
`embed.sh` signs the embedded copy with the build's identity.

Test hygiene the run keeps (each was a real failure):
- Metro is reached through a proxy that refuses its websockets (`/hot`, `/message`), so another session's edits
  never reload the app mid-run.
- Every file the app is asked to read lives in the scratch dir: the checkout is under `~/Documents`, and an ad hoc
  build reading it raises macOS's folder-access prompt and blocks the main thread on it (the extension fixture is
  copied).
- Permissions use MIDI and notifications (no macOS prompt behind them), external apps a scheme no app handles;
  never location or `mailto:`. Camera and microphone only on a copy of the app without the device entitlements
  (ad hoc, hardened runtime: macOS refuses the devices without asking) and Chrome's fake devices: every hidden
  instance gets `--use-fake-device-for-media-stream` (NNCoreHost), and with it the engine keeps the microphone on a
  fake input (`nn_fake_media.mm`), since the fake list's "default" input is the Mac's real one to the audio service and
  a stream on it raised macOS's microphone dialog on the owner's screen (2026-10-01).
- A check that needs a page on screen (permission prompts, choosers, context menus) shows it first: Chrome holds
  those for hidden tabs. Checks that need "no user activation" reload the page first (CDP's `userGesture` leaves
  one behind).

## Acceptance (hidden instance)

`packages/nncore/scripts/acceptance.mjs`, 126 checks (one, `visibility`, is a diagnostic). Latest full run: see "Status" at the end.

| Check | What it proves |
|---|---|
| boot | The RN app runs inside Chromium's own loop (`ChromeMain` → `MessagePumpNSApplication`, NSApp is Chrome's `BrowserCrApplication`), one JS runtime, the store makes a window, the app never takes focus |
| open-url, favicon | `openUrls` opens a tab; title, URL, loading and the favicon reach the store |
| navigate-back-forward-reload | Omnibox navigation (`navigate(…, { userInitiated })`), back, forward, reload (the page really reloads) |
| target-blank, window-open, cmd-click | A page's new tab arrives as `onOpenWindow` with `adoptId: "nncore:<id>"`, already made by Chrome; the WebView takes that live tab; ⌘-click opens behind |
| evaluate | `WebViewHandle.evaluate` in the page's main world; the page script ran at document start |
| tab-strips, tab-switch | `tabStrips()` names every live tab by key; switching tabs makes them Chrome's active tab |
| cmd-t-cmd-w, cmd-l-from-page, tab-keys-from-page | Reserved keys reach the menu before the page; others after the page leaves them; ⌃Tab and ⌘⇧} from the page |
| window-close | A page's `window.close()` closes its tab in the app (`onWindowClose`) |
| status-text, load-error | `onStatus` (a hovered link), `onLoadError` |
| context-menu-search | Chrome's page menu with the app's "Search <engine> for “…”" in place of Chrome's search item (`setSearchEngineName`; background mode reports the menu) |
| duplicate-and-reopen | Duplicate (`clone:`) copies the back/forward list; ⇧⌘T (`restore:`) brings a closed tab back with its own list from Chrome's TabRestoreService |
| device-chooser | WebUSB `requestDevice` → the app's chooser (`onDeviceChooser`); `cancelDeviceChooser` → the page gets NotFoundError |
| cast-dialog | `showCastDialog` → `onCastDialog` ("Cast tab"), `onCastRoutes` for the profile, `closeCastDialog` |
| crash | A renderer crash → `onCrashed`, the app keeps running |
| traffic-lights-after-profile-switch | The traffic lights keep their place after the window's profile changes |
| passwords, passwords-more | Chrome's password store: save, list, reveal, edit, delete, never-save list, unlock (test reauth), export through the save panel, the autofill pref |
| autofill, autofill-cards | Addresses; cards saved with a published test number, listed, revealed, deleted; the address and card switches |
| zoom-levels | `setZoom`/`getZoomLevels` on Chrome's host zoom map |
| extensions, extension-surfaces | Unpacked inspect, install, list, disable, uninstall, reload; action state and side panel URL for a tab; the extension's declarativeNetRequest blocks counted on the page (`onContentBlocked`) |
| chrome-windows-create | `chrome.windows.create` from an extension → the tab lands in the app's window as a live tab (`tab:<id>`) |
| extension-popup-window | An action's popup (`extensionHost="popup"`) sees the window it was clicked in as its current window and the page under it as its active tab; it's in no strip and makes no window; Esc in it closes it |
| extension-windows-hidden | `chrome.windows.getAll` lists only the app's windows; an extension's tab on install and its options page land in the app's window; no window the app didn't show comes on screen |
| extension-download-hidden | A .crx from the Web Store's update URL (`--apps-gallery-update-url`) is no download in the app, and doesn't open the popover |
| content-blocked-count | An extension's rules on a page: a blocked image and a script redirected to its stand-in count 2 |
| extension-installed-bubble | A .crx installed with Chrome's UI (`installCrx`): the "added" bubble shows over the profile's window and closes with it; with the profile's windows closed mid-install nothing shows or crashes until a window of it shows a page, then the bubble does |
| context-menu-reading-mode | The page menu has no "Open in Reading Mode" or "Listen to this page", and no doubled separator |
| content-blocker, settings-services | uBlock Origin Lite as a component extension: state, lists, allow-list, on/off, a list toggled; clearing browsing data, resetting a site, an external-app allowance, a tab's site data |
| download, download-controls, download-navigation | Downloads land in the scratch folder through Chrome's manager and the app's list; pause, resume and cancel a running one; a navigation that became a download |
| site-settings | Set, get, origins, clear site data |
| tasks-components, tracing | Chrome's task manager (with tab ids), components, tracing start/stop |
| delete-profile-data | A loaded profile deleted through Chrome's profile deletion; its folder goes |
| page-events | `zoomStep` → `onZoom`, `getSecurityInfo` and `onSecurity`, an app link with no app → `onExternalApp`, Esc the page leaves → `onCommand escape` |
| notifications | A page's `Notification` → `onNotification`, the app's click reaches the page, `close()` → `onNotificationClose` |
| now-playing | `<audio>` with Media Session metadata (tab muted) → `onNowPlaying`; the app's `mediaCommand("pause")` pauses it |
| images | `downloadImage`, `downloadFavicon`, `fetchFavicon` as `data:` PNGs |
| frozen | `setFrozen(true/false)` on a background page: the page sees freeze and resume |
| discard | A background tab discarded in place → `onDiscarded` |
| permission-prompt, popup-blocked | A permission request → the app's prompt → Chrome; a popup without a gesture → `onPopupBlocked` → `openBlockedPopup` |
| camera-mic-allow | 0.2.21's crash case, on the media copy (above): a camera + microphone getUserMedia is one prompt; Allow starts the stream with both tracks live |
| permission-answer-once | A double Allow and two more answers straight to the engine decide nothing twice; a late answer to that prompt doesn't answer the tab's next one |
| permission-element-allow | The `<usermedia>` element (0.2.21's crash path): with macOS "not asked yet" (`--netnyahoo-test-system-media-permission=ask`), one prompt, one Allow, Chrome's "ask macOS" step handled in the engine, no second prompt, the element's stream live |
| second-profile, settings-window, incognito-window | A second profile's tab in the same window with its own cookies; the settings window; a private window |
| move-tab-to-window | A tab moved to a new window keeps its page (same WebContents) and its strip follows |
| title-bar-close | The title bar's close button asks the app (`windowShouldClose:`), which closes the window |
| small-yahu | A Small Yahu window opens and navigates |
| quit | ⌘Q → the app's quit flow → NNCore's quit; the session is saved; no crash report |

### Activation (who is in front)

`packages/nncore/scripts/activation-acceptance.mjs <Debug app> <scratch dir> [check…]` asserts three readings together:
the panes the app shows, Chrome's selected tab and active Browser (an extension that records `tabs.onActivated` and
reads `chrome.windows`), and native focus (the key window, and the requests to make one key,
`makeKeyAndOrderFront: on NNCoreWindow #<number>` in `activation.log`). A test instance is never really active: it fakes
only that it reads as active (`NNCoreActivation.mm`; `devWindow(n, "fakeAppActive:0")` is the user in another app), and
AppKit's key window follows as in an active app, so Chrome's views hear key changes as in production. Its fixtures are HTTPS (a certificate made per
run; this instance only gets `--ignore-certificate-errors`), since Chrome's automatic Picture in Picture acts only on
https and file pages; the call is a fake conference (fake camera, a Media Session `enterpictureinpicture` handler that
counts its calls) on the media copy.

| Check | What it proves |
|---|---|
| split-pane-focus | Clicking between a split's panes (Chrome's focus path) moves Chrome's selected tab and never pops the call out; leaving the split pops it out once; coming back closes it |
| internal-page-and-space | The app's New Tab page and another Space pop the call out once each (Chrome's selected tab stays the call's) and returning closes it |
| prompt-follows-page | An open prompt stays with its page across a switch; a hidden page asks only once shown; a split's unfocused pane asks at once |
| background-window | A window made behind the user's, its Space changed, its shown tab closed: Chrome's last focused window and last used profile stay the user's; nothing asks AppKit to focus it |
| extension-window-focus | `chrome.windows.update(B, { focused: true })` asks AppKit to focus B and Chrome follows; back to A the same; `focused: false` changes nothing (Chrome on macOS) |
| quiet-commands | Save Page on the split's unfocused pane (the call): no `tabs.onActivated`, Chrome's selection unchanged; DevTools docked there (Chrome selects the inspected tab itself, as in Chrome): the call stays put |

The engine's own run (`spikes/nncore-host/acceptance.mjs`, 96 checks at 66a7e266) covers what the app's can't
reach: beforeunload cancelling a close and a quit, Dock/logout quits, IME wiring, tab capture with "Share this tab
instead" and Stop sharing (`--auto-select-tab-capture-source-by-title`), the context menu's item click path,
`closeNow` recording the closed tab.

## WebView (`packages/nncore/src/WebView.tsx`)

Events are coalesced as `packages/cef`'s `NNClient` does (d6b026d6): navigation reports held for a run-loop turn
and sent only when changed, progress at most 10 times a second, a held report flushed before any other event.

### Props

| Prop | Status | Note |
|---|---|---|
| `url`, `profile`, `visible`, `warm` | done | `""` is Chrome's Default profile, `<id>` is `Profile <id>`, `incognito…` the default profile's OTR profile. `visible` and `warm` change the page once the app's batch of view updates is done (a run-loop observer before Core Animation's commit), the pages leaving first; a page leaving the screen goes transparent and stays visible to Chrome for 100 ms. Hiding Chrome's view at once blanked the old page (or left a few tiles) for a frame before the app's switch reached the screen, on most switches away from a web page (rec1522: 13 in 20 switches on the RC, 2 now, each a single frame: the incoming page a frame late, or a tile; `windowing-test.mjs`) |
| `adoptId` | done | `nncore:<id>` (a tab Chrome made for a page), `tab:<id>` (one Chrome made on its own: an extension's tabs.create/windows.create), `restore:<tab id>` (Chrome's TabRestoreService entry carrying the tab's id, bound while the tab lives and stamped on each new navigation, so a close Chrome records first keeps it: `nn_tab_restore_tag`/`_take`, `-[NNCoreWindow restoreTab:…]`), `clone:<tab id>` (`duplicateTab:`). A restore in flight is cancelled by a close |
| `transferKey` | done | A tab moving between windows is parked or taken from the old view and moves into the new window's Browser (`adoptTab:`); it is also the tab's key in strip transactions. A window closing while one of its tabs is on its way out (its last tab dropped onto another window) hands the tab to a hidden window first (`keepTransfersOfWindow:`). A parked page has no deadline: it waits until the tab's next view takes it, or the app releases it (`releaseTransfer`: the tab closed, slept, went to an app page or another profile; lib/tabPages.ts) and it closes at once (`closeNow`) |
| `standalone`, `extensionHost` | partial | Extension popups and side panels (`extensionHost` "popup" or "sidePanel", which implies `standalone`): Chrome's own `ExtensionViewHost`, bound to the window's Browser for the page's profile (`-[NNCoreWindow openExtensionView:profile:kind:]`, `nn_extension_view.mm`), so `chrome.windows`' current window and the active tab are the window's; in no strip. Chrome closing it (`window.close()`, Esc, the extension unloaded, its renderer gone) reaches the app as `onWindowClose`; it closes with its window too. A `standalone` view without `extensionHost` is a tab in a hidden per-profile window (an older engine). Needs a visual check |
| `pageBackgroundColor`, `autoPictureInPicture` | partial | Wired (`setPageBackgroundColor:`, auto PiP from the page script's video state); both need a visible window to check |

### Events

| Event | Status | Note |
|---|---|---|
| `onReady`, `onNavigationChange`, `onProgress`, `onFavicon`, `onOpenWindow`, `onWindowClose` | done | |
| `onFindResult`, `onFullscreen`, `onStatus`, `onCrashed`, `onLoadError` | done | `onLoadError` skips ERR_ABORTED (stopped loads, downloads), as CEF |
| `onZoom`, `onSecurity`, `onExternalApp`, `onCommand` | done | `onCommand`: Esc the page left alone, the menu's search |
| `onDiscarded`, `onPopupBlocked`, `onDownloadNavigation` | done | |
| `onNotification`, `onNotificationClose`, `onNowPlaying` | done | Through the page script, as CEF |
| `onContentBlocked` | done | The engine's per-tab report (`tab:didBlockRequests:lastURL:`, e809deac) of what extensions' declarativeNetRequest rules blocked or redirected (to a stand-in, as uBlock Origin Lite answers most ad scripts), from a hook in Chrome's `ActionTracker` (engine/nncore/apply.sh), plus any other ERR_BLOCKED_BY_CLIENT, each request once; counted and coalesced as CEF (150 ms, reset when a page starts loading). A report can land a turn late, so a few of the old page's blocks may count on the next page |
| `onPageMessage` | partial | `selection` from the page script (main frame). Programmatic selections don't send it; a mouse selection does (needs a visible window) |
| `onMedia` | partial | Audible state from the page script; the muted test tab doesn't prove it |
| `onPictureInPicture` | partial | Video PiP state from the page script; document PiP not reported. PiP opens a window on screen |
| `onMediaAccess`, `onDisplayMediaRequest` | partial | Camera/mic/screen use (macOS prompts). `onDisplayMediaRequest` waits on the engine granting an app-picked desktop source (below) |
| `onActivateRequest` | partial | `tab:requestsActivation:` ("page", "pictureInPicture"); Chrome ignores a hidden window's `window.focus()` |
| `onPageFocus` | partial | Needs a key window |
| `onUnresponsive`, `onResponsive` | partial | Chrome's hang monitor ignores hidden windows |
| `onPasswordPrompt` | partial | "save" only; no update/never/federation details |

### Methods (`WebViewHandle`)

| Method | Status | Note |
|---|---|---|
| `loadUrl`, `loadOpenedUrl`, `goBack`, `goForward`, `goToOffset`, `reload`, `forceReload`, `stopLoading`, `focus` | done | |
| `setMuted`, `zoomStep`, `find`, `stopFinding`, `showDevTools` | done | DevTools dock in the tab's view |
| `executeJavaScript`, `evaluate`, `navigationEntries` | done | NNCore's renderer side (`NNContentRendererClient`, a mojo channel) |
| `getSecurityInfo`, `openBlockedPopup`, `clearSiteData`, `discard`, `setFrozen` | done | `discard` answers what happened (`discarded`, `already`, `refused`; `unload` is `unsupported`: NNCore keeps a regular profile loaded), and a woken tab sends `onReady` again |
| `downloadFavicon`, `downloadImage` | done | `data:` PNGs; Chrome's FaviconService keeps icons |
| `mediaCommand`, `notificationAction` | done | |
| `print`, `runPageCommand` | partial | Chrome's commands (print preview, save page, system print, caret browsing): dialogs in a hidden run |
| `requestPictureInPicture`, `exitPictureInPicture` | partial | Through the page script with a user gesture; a PiP window shows on screen |
| `resolveDisplayMedia`, `mediaCaptureSourceId` | partial | `mediaCaptureSourceId` is Chrome's (engine-proven); an app-picked source needs the engine to grant it to `getUserMedia` (CEF's `site::AllowDesktopCapture`), so pages keep Chrome's own picker for now |
| `resolvePasswordPrompt` | partial | save and dismiss |
| `executeExtensionAction` | partial | Runs the action on the tab (activeTab granted); the app shows the popup (`extensionHost="popup"`); needs a visible window |
| `resolveUnresponsive` | partial | See `onUnresponsive` |

The app closes a tab by unmounting its WebView; NNCore closes it at once without beforeunload
(`-[NNCoreTab closeNow]`, as CEF's `CloseBrowser(true)`), recording Chrome's closed-tab entry first.

## `NetnyahooCEF` module (`packages/nncore/src/native.ts`, `module.ts`)

| Function / event | Status | Note |
|---|---|---|
| `engineInfo`, `chromeWindows`, `devWindow`, `systemState`, `onSystemState` | done | |
| `prepareTransfer`, `releaseTransfer`, `tabStripCommand`, `tabStrips`, `onTabStrip` | done | Rec. 1's contract natively: a strip is one profile's Browser in one NNCoreWindow; revisioned transactions naming their cause; `group` (`nn_tabs_group`), `closed` strips, `appWindow`, `activePickedOnClose` |
| `engineCall`, `onEngineEvent` | done | `//chrome/browser/netnyahoo`'s C exports, the same code as CEF's |
| `components`, `listTasks`, `beginTracing`, `endTracing`, `isTracing` | done | |
| `setSearchEngineName`, `forgetOpenedURL`, `removeLegacyFavicons` | done | The last two have nothing to do on NNCore |
| `fetchFavicon` | done | `(url, profile)` → `data:` PNG |
| `onDownload`, `cancelDownload`, `pauseDownload`, `resumeDownload` | done | `nn_downloads_*` over Chrome's DownloadManager |
| `onPermission`, `resolvePermission` | done | One answer per prompt (`nn_permissions.mm`): a page's permission element (Chrome's embedded flow) reaches the app only for its site question; the steps after Allow ("ask macOS", "open System Settings", policy) stay in the engine, as Chrome's own view does, and a later step is never a question even if the site's setting was reset meanwhile. 0.2.21 answered those steps with a second Accept and aborted (`camera-mic-allow`, `permission-answer-once`, `permission-element-allow`) |
| `getExternalAppAllowances`, `removeExternalAppAllowance` | done | |
| `clearBrowsingData`, `deleteProfileData` | done | A profile never loaded this session is its folder alone |
| `getContentBlocker`, `setContentBlockerEnabled`, `setFilterListEnabled`, `isContentBlockerAllowed`, `setContentBlockerAllowed` | done | uBlock Origin Lite as a component extension (`loadComponentExtension:`), driven through its runtime messages |
| `setSiteSetting`, `getSiteSettings`, `getSiteSettingsOrigins`, `resetSiteSettings`, `clearSiteData` | done | Chrome's content settings under CEF's type names; the page script's `blockAutoplay` comes from them as on CEF |
| `setZoom`, `getZoomLevels` | done | |
| `listPasswords`, `unlockPasswords`, `getPassword`, `savePassword`, `updatePassword`, `deletePassword`, `getNeverSavePasswordOrigins`, `allowSavingPasswords`, `exportPasswords`, `getPasswordAutofill`, `setPasswordAutofill` | done | |
| `getAutofillSettings`, `setAutofillSettings`, `listAddresses`, `saveAddress`, `listCards`, `saveCard`, `deleteAutofillEntry`, `revealCardNumber` | done | |
| `killTask` | partial | Works; the services run saw it answer `{ok: false}` once for a renderer it had just killed |
| `resolveExternalApp` | partial | The prompt is proven; opening the app is not (it would launch one) |
| `releaseProfile` | partial | Destroys a private profile once no window shows it (engine-proven) |
| `onPermissionDismissed` | partial | Wired; no check dismisses a prompt by navigating yet |
| `onContentBlocker` | partial | Reported by the blocker's state changes; not asserted on its own |
| `setDisplayMediaPicker`, `displayMediaSources` | partial | Kept, but pages keep Chrome's picker until the engine grants app-picked desktop sources; `displayMediaSources` lists screens and windows as CEF (no prompt) |
| `devScrollZoom` | stubbed | CEF's test hook for its own pinch path; NNCore's pinch is Chrome's |

## `NetnyahooExtensions` (`packages/nncore/src/extensions.ts`)

| Function / event | Status | Note |
|---|---|---|
| `chooseFolder`, `list`, `inspectUnpacked`, `install`, `setEnabled`, `uninstall`, `reload`, `searchEngineList` | done | `nn_extensions_*`, `nn_search_engines_list` |
| `installCrx` | done | NNCore only (not in `packages/cef`'s API; the acceptance run uses it): a CRX3 file as one dropped on chrome://extensions, through `nn_extensions_install_crx` (the app's install prompt, then the "added" bubble) |
| `configure` | partial | Wired; not called by a check |
| `resolveInstallPrompt`, `onInstallPrompt` | partial | Engine-proven (`extensionInstallPrompt`); a web-store install needs the network |
| `onChanged` | partial | Fires on install/uninstall; not asserted on its own |
| `onTabs` | partial | Only for a tab Chrome makes when no app window can take it; the usual path is `tab:<id>` (proven) |

## `NetnyahooChromeUI` (`packages/nncore/src/chromeUI.ts`)

| Function / event | Status | Note |
|---|---|---|
| `onDeviceChooser`, `cancelDeviceChooser` | done | |
| `showCastDialog`, `onCastDialog`, `closeCastDialog`, `watchCastRoutes`, `onCastRoutes` | done | |
| `actionStates`, `sidePanelURL` | done | |
| `selectDevice`, `refreshDeviceChooser`, `openBluetoothSettings` | partial | No devices in a hidden run; the last opens System Settings |
| `startCasting`, `stopCasting`, `terminateCastRoute` | partial | No Cast sinks here |
| `onSidePanel` | partial | Engine's `extensionSidePanel`; needs a side panel opened by the extension |
| `changeCaptureSource`, `stopCapture` | partial | "Share this tab instead" and Stop sharing, engine-proven with tab capture (e65d1bd5); the capturer's own share moves (its infobar, by capturing frame: `chromium-tab-sharing-capturer.patch`), never another call's |
| `showAutofillSuggestions` | partial | Needs a focused field in a key window |

## `NetnyahooSwipe` (`packages/nncore/src/swipe.tsx`)

**done**: the same sources as CEF's (`NNSwipe.mm`, `SwipeModule.swift`, linked into `packages/nncore/ios`). Profile
paging on NNCore is a change of the window's active profile, never a window swap.

## Window hosting (`NNChromeWindowHost`, looked up by `packages/shell/ios/ChromeWindows.swift`)

All 13 **done**: `makeWindowForProfile:` (one `NNCoreWindow` per app window, styled as the app's),
`embedRootView:inWindow:`, `rootViewOfWindow:`, `removeRootViewOfWindow:`, `showProfile:inWindow:` (the traffic
lights are placed again after every switch), `prepareProfiles:forWindow:`, `setTrafficLightsCenter:inWindow:`,
`closeWindow:`, `shouldCloseHandler` and `windowShouldClose:` (the title-bar close button asks the app),
`devAction:window:` (`lights`, `close-button`), `swappedHandler` (never fires: no window swaps on NNCore) and
`makePopupWindowForProfile:root:` (CEF-internal, for its own popup windows; NNCore's popups are live tabs).

## Runtime

| Item | Status | Note |
|---|---|---|
| RN app in Chromium's loop | done | `NNCoreHost` runs `ChromeMain`; React Native starts on the loop's first idle (React Native's debug `ReentrancyCheck` trapped when it started inside Chrome's startup burst). The app delegate gets each launch callback once: when that idle comes before AppKit finished launching, AppKit sends them (sending them twice made a second React Native factory, two JS runtimes), and a cold launch's URLs follow |
| Popups and Chrome-made tabs as the app's tabs | done | |
| Two profiles in one window | done | |
| Background test instances | done | `NETNYAHOO_BACKGROUND=1`: activation guards, panels answered from `file-chooser.txt`, context menus reported |
| Key equivalents from the page | done | |
| Quit and terminate (⌘Q, Dock, logout) | done | Cocoa's `applicationShouldTerminate:` contract, cancellable |
| Windows Chrome makes (chrome.windows.create, incognito) | done | Routed into the app's windows (`tab:<id>`) through a hidden stray window. Chrome never shows a window of the host's (`NNBrowserWindow::Show` does nothing; the app shows its own), and the host's own hidden pages are no extension's window (`cef::IsHiddenFromExtensions`, `IsOnCurrentWorkspace`, extensions' `browser_window_util`) |
| Key window, IME, accessibility | partial | Wiring checked in the engine's run; marked text and VoiceOver need an unlocked screen |
| Native composition of the page under the RN views, bubbles and sheets | needs a visual check | The screen was locked for stages 1 and 2 |

## Renderer side

CEF ran Netnyahoo's code in each renderer (`packages/cef/helper/helper_main.mm`). NNCore does the same with its own
renderer client (`NNContentRendererClient`) and a mojo interface (`engine/nncore/src/netnyahoo/core/mojom`):

| CEF | NNCore | Used by |
|---|---|---|
| `OnContextCreated` runs `page_script.js` in every frame's main world | `DidCreateScriptContext` (main world), the script sent at launch (`NNCoreEngine.pageScript`) | Everything below |
| `post(kind, json)` → `NNClient::OnPageMessage` | `tab:didReceivePageMessage:json:frame:main:` | hello (→ config with `blockAutoplay`), media, nowPlaying, theme, selection, pinch, pip, displayMedia, notification, notificationClose |
| "nn-call" (`CallPage`) | `callPage:json:`, `callFrame:kind:json:` | config, media, displayMedia, notification |
| "nn-eval" | `evaluate:completion:`, `evaluate:userGesture:completion:` | `WebViewHandle.evaluate`, PiP requests |
| `ExecuteJavaScript` | `executeJavaScript:` (`:frame:`, `:userGesture:`) | `WebViewHandle.executeJavaScript`, blocked-popup replay |
| `IsAppURL` checks | A navigation throttle; a Chrome page's `netnyahoo:` link → `tab:didRequestAppURL:userGesture:` → `onOpenWindow` `current` | The app's own pages linked from chrome:// pages |

## Engine C exports (`//chrome/browser/netnyahoo`, shared by both engines)

Plain Chromium code over Chrome's services (`engine/chromium/src/chrome/browser/netnyahoo`, rules in
`public/nn_engine.h`), linked into CEF's framework and NNCore's. Both apps call them through `dlsym` on the
framework (`nn::engine::Call` on CEF, `NNCoreEngineBridge`/`NNCoreServices` on NNCore). All of them are wired on
NNCore:

| Export | JS functions (`packages/cef`) |
|---|---|
| `nn_engine_abi_version`, `nn_engine_set_event_sink` | `engineCall`, `onEngineEvent` |
| `nn_passwords_*` (list, unlock, reveal, add, update, remove, exceptions, allow, export) | the password functions |
| `nn_autofill_*` | the address and card functions |
| `nn_extensions_*`, `nn_search_engines_list` | `NetnyahooExtensions` |
| `nn_zoom_list`, `nn_zoom_set` | `getZoomLevels`, `setZoom` |
| `nn_browsing_data_clear` | `clearBrowsingData`, the default profile's `deleteProfileData` |
| `nn_downloads_*` (list, cancel, pause, resume, keep, remove; events `downloads.changed`/`removed`) | `onDownload` and the download functions |
| `nn_site_settings_*`, `nn_site_data_clear` | the site-settings functions, both `clearSiteData`s |
| `nn_external_apps_allowances`, `_remove` | `getExternalAppAllowances`, `removeExternalAppAllowance` |
| `nn_prefs_get`, `_set` (allow-listed) | password and autofill switches |
| `nn_tasks_list`, `_kill`, `nn_components_list` | `listTasks`, `killTask`, `components` |
| `nn_history_*`, `nn_favicons_*`, `nn_bookmarks_*` | `history.ts`, `favicons.ts`, `bookmarks.ts` (through `engineCall`) |
| `nn_tab_restore_tag`, `_take`, `_load` | native: the WebView's attach (and close) and `restore:` |
| `nn_tabs_watch`, `nn_tabs_group` | tab groups in strip transactions |

## What's left before a release-signed NNCore build can sit next to the CEF build

1. **Engine:** granting an app-picked desktop source to `getUserMedia` (the app's screen-share picker; pages use
   Chrome's picker meanwhile); document PiP state; Paste and Paste and Match Style are always enabled in the page
   menu (Chrome's clipboard check is private to its view delegate); a tracing start that fails asynchronously
   never calls back.
2. **Signing and packaging:** Developer ID signing with the hardened runtime and the CEF build's entitlements
   (keychain access group for passwords, camera/mic/screen usage strings), notarization of the app with the
   framework and its helpers, the framework's name and bundle id (still "Chromium Framework", renamed only at a
   full engine rebuild), Sparkle and the dock tile left out on purpose until the switch.
3. **Checks that need an unlocked screen and a visible window** (none can run hidden): the page composited under
   the RN views; menus, choosers, Cast and bubbles drawn against the window; PiP; IME marked text; VoiceOver; the
   hang monitor; print and save dialogs; a camera/microphone grant; a mouse text selection; extension popups and
   side panels as Chrome's extension views in the app's own (their size, focus, the "added" bubble's place).
4. **Side by side:** the same profile data opened by both builds (they share Chrome's prefs and stores by design)
   with a scratch copy, a day of the owner's use on the NNCore build, and the partial rows above re-checked there.

## Status

Full hidden runs on 50f1b719 (2026-10-02, the release candidate's NNCore, shared Metro with a clean tree): 126/126
twice (two runs at once), activation 7/7 twice. The first run's one failure was `page-background`, which still expected
the theme card as the page's base after 53ed19ca made it transparent; it now checks the base stays clear (also after a
reload and after an opaque page). `window-close`'s "cdp timeout" was the check's: `window.close()` inside the
evaluate races its own reply (closeFromPage). Runs of the same bundle at once now each find their own app by its data dir.

Full hidden runs on committed b1a94afe (2026-10-02, the screen locked): 119/119 twice in a row, on a `git archive` of HEAD with its own
`pnpm install`, `pod install`, derived data and Metro (`react-native start --port <p>` in the archive, `METRO_PORT=<p>`),
and the framework built from the same commit (`engine/nncore/apply.sh --check`). Run it that way: the shared Metro and
working tree carry other agents' uncommitted edits, which turned earlier runs' failures into noise.

The earlier visibility flake is gone. What the 0.2.22 push found and fixed:
- A reloaded or navigated page lost the app's page background (the window's backdrop showed through): a new
  document's view took over the last page's translucent background and told the renderer to paint on a transparent
  base. `CopyBackgroundColorIfPresentFrom` now takes opacity from the embedder's colours (apply.sh hook).
- The saved-passwords dropdown showed but was never reported: the engine now hears every dropdown from
  `AutofillPopupControllerImpl::Show` (apply.sh hook), also one whose search bar can't take focus in an inactive app.
- Auto Picture in Picture closed a page's own document PiP window when the window got covered; hidden runs' PiP
  windows faded back in over alpha 0 (now pinned).
- Deleting a profile right after it loaded left its folder until the next launch (Chrome's first-window keep-alive,
  late database writes, and the content blocker loading it back).
- Checks that left UI open (the ⌃Tab switcher, the downloads popover) covered the page for scroll-zoom; unresponsive
  sent its key before the busy loop started under load; navigation-download-memory now opens a restored tab.
- With the screen locked AppKit never advances an NSAnimation, and Chrome closes a tab-modal dialog when its close
  animation ends: the print preview stayed open after its page navigated, and tab-capture's picker stayed over the
  capturing tab, where Chrome's autofill dropdown won't open over a visible dialog (autofill-suggestions failed in
  every full run, never alone). Hidden instances pass `--disable-modal-animations`, as Chrome's tests of both dialogs
  do; tab-capture checks its picker closed. download-controls left the downloads popover (a full-window click
  catcher) open for the rest of the run. scroll-zoom's one failure (neither ⌘-wheel step counted) never came back in
  8 runs and 80 more steps; devScrollZoom now logs why a step didn't zoom and the check quotes it.

Fixed during stage 2 because the acceptance run caught them:
- Two React Native runtimes in one app (the launch callbacks sent twice when the loop went idle before AppKit
  finished launching); `boot` now fails on a second runtime's window.
- `fetchFavicon`, `downloadFavicon` and `exportPasswords` took one argument more than `packages/cef`'s, so the JS's
  calls would have thrown.
- ⇧⌘T restored a tab without its history: `closeNow` didn't record Chrome's closed-tab entry (66a7e266).
- Esc from a page stopped reaching the app after a profile was deleted: the routing looked for the focused page
  only among the window's active profile's tabs; it now looks at every loaded profile's (why the deletion
  changes what `activeProfile` answers is still open).
- The content blocker's writable copy blocked the main thread at launch; deleting a profile that the session
  never loaded created it first.

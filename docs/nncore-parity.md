# NNCore parity: the `packages/cef` JS API on NNCore

The app switches from CEF to NNCore (`docs/nncore-spike.md`) in one go, when this list says NNCore does
everything the JS asks of `packages/cef`. The JS (`packages/cef/src`, `apps/browser/src`) doesn't change: NNCore
is a second native side, `packages/nncore`, registering the same Expo modules and view names
(`NetnyahooCEF`, `NetnyahooExtensions`, `NetnyahooSwipe`, `NetnyahooChromeUI`), built into its own app,
`apps/browser/macos-nncore`.

Keep this current: whoever adds or changes a native export or event of `packages/cef` adds its row here (as
**missing** if NNCore doesn't have it yet), and whoever lands it on NNCore updates the row.

Statuses:
- **done**: does on NNCore what it does on CEF.
- **partial**: the common path works; the gap is in the note. Rows marked "untested" are wired to the engine
  callback but no acceptance check covers them yet.
- **stubbed**: exported, so the JS never throws, but answers as an engine without the feature would (an empty
  list, `{ error }`, a no-op). The app runs; the feature is absent.
- **missing**: not exported on NNCore; the JS throws if it calls it.

## Summary (2026-10-01, end of stage 1)

| Area | done | partial | stubbed | missing |
|---|---|---|---|---|
| `WebView` props (9) | 5 | 1 | 3 | 0 |
| `WebView` events (33) | 9 | 8 | 16 | 0 |
| `WebView` methods (35) | 16 | 5 | 14 | 0 |
| `NetnyahooCEF` module functions (62) and events (7) | 10 | 2 | 57 | 0 |
| `NetnyahooExtensions` (12 functions, 3 events) | 1 | 0 | 14 | 0 |
| `NetnyahooChromeUI` (15 functions, 4 events) | 0 | 0 | 19 | 0 |
| `NetnyahooSwipe` (7 functions, view with 3 events) | 11 | 0 | 0 | 0 |
| Window hosting (`NNChromeWindowHost`, used by `packages/shell`) (13) | 8 | 2 | 3 | 0 |
| **Total (204)** | **60** | **18** | **126** | **0** |

Nothing is **missing**: every name the JS requires is exported, so the whole app runs on NNCore. The switch waits
on the **stubbed** and **partial** rows; the largest blocks are passwords and autofill, extensions, downloads,
permissions, site settings, zoom and the content blocker, most of which are already plain C exports in the
framework (`//chrome/browser/netnyahoo`) waiting for their module glue.

## How to build and check it

```bash
# Engine (once, and after engine/nncore changes): engine/nncore/apply.sh, then
#   scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework   (docs/nncore-spike.md)
# App: the project is generated from the CEF one; run generate.py again after every pod install there.
(cd apps/browser/macos-nncore && ../../../scripts/agent/locked pod -- pod install && python3 generate.py)
cd apps/browser && ../../scripts/agent/locked xcodebuild -- xcodebuild -workspace macos-nncore/NetnyahooNNCore.xcworkspace \
  -scheme Netnyahoo-NNCore -derivedDataPath build-nncore -destination 'platform=macOS,arch=arm64' -configuration Debug build
# Acceptance, hidden (open -g -n, NETNYAHOO_BACKGROUND=1, a scratch data dir); METRO_PORT is the running Metro's port.
METRO_PORT=8081 node packages/nncore/scripts/acceptance.mjs apps/browser/build-nncore/Build/Products/Debug/NetnyahooNNCore.app <scratch dir>
```

The NNCore build is a development build: bundle id `com.netnyahoo.browser.nncore` (its own defaults domain;
`acceptance.mjs` points its `RCT_jsLocation` at `METRO_PORT`), ad hoc signing without the hardened runtime, no
Sparkle, no dock tile, and it refuses to start without `NETNYAHOO_DATA_DIR` (it never falls back to a real
profile). Its build stages a signed copy of the engine framework (`packages/nncore/scripts/stage-framework.sh`,
under the chromium lock) and links that.

## Stage 1 acceptance (hidden instance)

`packages/nncore/scripts/acceptance.mjs`, 18 checks, all passing on the engine at c6e5b49d:

| Check | What it proves |
|---|---|
| boot | The RN app runs inside Chromium's own loop (`ChromeMain` → `MessagePumpNSApplication`, NSApp is Chrome's `BrowserCrApplication`), the store makes a window, the app never takes focus (`lsappinfo front`) |
| open-url | `openUrls` opens a tab; title, URL and loading reach the sidebar |
| favicon | The page's favicon URL reaches the store |
| navigate-back-forward-reload | Omnibox-style navigation (`navigate(…, { userInitiated })`), back, forward, reload |
| target-blank, window-open | The page's new tab arrives as `onOpenWindow` with `adoptId: "nncore:<id>"`, already made and navigated by Chrome; the new WebView takes that live tab (no replay, no orphan timer); it stays |
| cmd-click | A ⌘-clicked link opens behind, as a tab of ours, and the shown tab stays shown |
| evaluate | `WebViewHandle.evaluate` runs in the page's main world through NNCore's renderer side; the page script ran at document start |
| tab-strips | `tabStrips()` names every live tab of the window by its key, with the active one |
| tab-switch | Switching tabs in the sidebar shows them and makes them Chrome's active tab |
| cmd-t-cmd-w | ⌘T with the page focused (a reserved key: the menu gets it before the page), ⌘W from the window |
| cmd-l-from-page | ⌘L, not reserved: the page sees it first, then the app's menu (once) |
| tab-keys-from-page | ⌃Tab opens the tab switcher, ⌘⇧} goes to the next tab, from the page |
| window-close | A page's `window.close()` closes its tab in the app (`onWindowClose`) |
| second-profile | A second profile's tab shows in the **same** NSWindow (one NNCoreWindow, a Browser per profile) and doesn't see the first profile's cookies |
| settings-window | The settings window opens |
| incognito-window | A private window loads a page in the default profile's off-the-record profile |
| quit | ⌘Q → the app's Quit → `NSApp terminate:` → `applicationShouldTerminate:` (the app saves its session) → NNCore's quit; the process exits with no crash report, and a tab opened just before is in the saved session |

The engine's own run (`spikes/nncore-host/acceptance.mjs`, 65 checks) covers what the app's can't reach yet:
beforeunload cancelling a close and a quit, the downloads prompt, Dock/logout quits (kAEQuitApplication),
chrome.windows.create and incognito landing in a host window, IME wiring, `-closeNow`.

Fixed during stage 1: two boots in six trapped in React Native's debug `ReentrancyCheck`, Expo's bridge module
setting its runtime up from the main thread (`-[ExpoBridgeModule setBridge:]`, RCTCxxBridge's main-queue module
setup) while the JS thread already ran it, because Chrome's startup tasks held the main queue right after
`engineDidStart`. `NNCoreHost` now starts React Native on the loop's first idle (`kCFRunLoopBeforeWaiting`): 8 of 8
boots and every full run since are clean. Keep an eye on it: the race is React Native's, NNCore only widened it.

## WebView (`packages/cef/src/WebView.tsx`)

The module coalesces events as `packages/cef`'s `NNClient` does (d6b026d6): navigation reports held for a run-loop
turn and sent only when they changed, load progress at most 10 times a second (its start and end at once), and a
held report flushed before any other event so JS sees them in order.

### Props

| Prop | Status | Note |
|---|---|---|
| `url` | done | |
| `profile` | done | `""` is Chrome's Default profile, `<id>` is `Profile <id>`, `incognito…` the default profile's OTR profile |
| `adoptId` | done | `nncore:<id>` takes the live tab Chrome made. CEF's `open:`/`clone:`/`restore:` ids open the URL fresh. `restore:<tab id>` should restore Chrome's TabRestoreService entry: the WebView tags a tab with its `transferKey` as it closes it (`nn_tab_restore_tag({tab, key})`, session data saved with each navigation), and `nn_tab_restore_take({key})` (both in NNCore's framework) returns that entry's navigations in CEF's `GetNavigationState` format (base64 pickle: version 1, index, count, `SerializedNavigationEntry`s); NNCore needs a restore that takes them (`chrome::AddRestoredTab`) |
| `transferKey` | partial | A tab moving between windows is parked (or taken from a view that hasn't unmounted yet) and its WebContents moves into the new window's Browser (`adoptTab:`). Untested in the app. It is also the tab's key in tab-strip transactions |
| `visible`, `warm` | done | Hidden views hide the page view, so Chrome marks it hidden |
| `standalone` | stubbed | |
| `pageBackgroundColor` | stubbed | |
| `autoPictureInPicture` | stubbed | |

### Events

| Event | Status | Note |
|---|---|---|
| `onReady` | done | `browserId` is the module's own per-tab id; `tabId` is the chrome.tabs id |
| `onNavigationChange` | done | url, title, back/forward, loading, `themeColor` (`<meta name=theme-color>`) |
| `onProgress` | done | |
| `onFavicon` | done | The favicon's own URL (Chrome's favicon driver), its image cached for `fetchFavicon` |
| `onOpenWindow` | done | Popups, target=_blank, window.open, ⌘-click: `nncore:<id>`. A WebUI page's netnyahoo: link: `current`, for the app to route; web pages can't reach netnyahoo: |
| `onFindResult` | done | Chrome's FindTabHelper |
| `onFullscreen` | done | |
| `onWindowClose` | done | Chrome closing the tab (window.close(), an extension); an extension moving it to another window doesn't |
| `onTabStrip` | done | The per-view report (index/pinned/activated/byApp); being replaced by the module's revisioned transactions (below) |
| `onPasswordPrompt` | partial | "save" only; no update/never/federation details |
| `onPageMessage` | partial | `selection` from the page script, main frame only. Untested |
| `onPictureInPicture` | partial | Video PiP state from the page script; document PiP not reported. Untested |
| `onMedia` | partial | Audible state from Chrome. Untested |
| `onStatus`, `onCrashed`, `onLoadError`, `onPageFocus` | partial | Wired to the engine's tab callbacks. Untested |
| `onNowPlaying`, `onNotification`, `onNotificationClose`, `onDisplayMediaRequest` | stubbed | Page-script messages (`nowPlaying`, `notification`…) arrive but aren't handled yet |
| `onMediaAccess`, `onPopupBlocked`, `onSecurity`, `onZoom`, `onContentBlocked`, `onDownloadNavigation`, `onActivateRequest`, `onCommand`, `onDiscarded`, `onExternalApp`, `onUnresponsive`, `onResponsive` | stubbed | Never fire. Chrome's own popup blocker blocks silently (no UI) |

### Methods (`WebViewHandle`)

| Method | Status | Note |
|---|---|---|
| `loadUrl` | done | `opened` (CEF's kept navigation) loads the URL |
| `goBack`, `goForward`, `goToOffset`, `reload`, `forceReload`, `stopLoading`, `focus`, `find`, `stopFinding`, `showDevTools` | done | DevTools dock in the tab's view (Chrome's split) |
| `setMuted`, `executeJavaScript`, `evaluate`, `navigationEntries` | done | Through NNCore's renderer side (an NNCore `ContentRendererClient` and a mojo channel, `engine/nncore`) |
| `setTabStrip` | done | Chrome's index and pin (`placeTab:`) |
| `downloadFavicon`, `downloadImage` | partial | From Chrome's favicon when a tab showed it, else a cookieless download. `downloadFavicon(url)` returns a `data:` PNG and writes nothing (Chrome's FaviconService keeps icons) |
| `mediaCommand` | partial | Sent to the page script's `media` handler. Untested |
| `getSecurityInfo` | partial | The scheme only (secure/insecure/local), no certificate |
| `resolvePasswordPrompt` | partial | save and dismiss |
| `zoomStep`, `print`, `runPageCommand`, `requestPictureInPicture`, `exitPictureInPicture`, `openBlockedPopup`, `clearSiteData`, `executeExtensionAction`, `resolveDisplayMedia`, `mediaCaptureSourceId`, `notificationAction`, `resolveUnresponsive`, `discard`, `setFrozen` | stubbed | |

Closing: the app closes a tab by unmounting its WebView; NNCore closes it at once without beforeunload
(`-[NNCoreTab closeNow]`), as CEF's `CloseBrowser(true)`.

## `NetnyahooCEF` module (`packages/cef/src/native.ts`, `module.ts`)

| Function / event | Status | Note |
|---|---|---|
| `engineInfo` | done | `engine: "nncore"`, Chromium version, windows, keep-alive state |
| `prepareTransfer` | done | |
| `tabStripCommand`, `tabStrips`, `onTabStrip` | done | Rec. 1's live-tab contract, natively: a strip is one profile's Browser in one NNCoreWindow; every insert, removal, activation and placement is one revisioned transaction naming its cause (the command's id, -1 for the app's own, null for Chrome's); keys are the WebViews' `transferKey`. Not yet: `group`, `closed` strips, `tab:<id>` offers for tabs Chrome makes with no opener |
| `engineCall`, `onEngineEvent` | done | `//chrome/browser/netnyahoo`'s C exports, which NNCore's framework links and exports (the same code as CEF's), called with the profile's directory |
| `removeLegacyFavicons` | done | Nothing to remove on NNCore |
| `systemState`, `onSystemState` | done | Same code as CEF's (IOKit, memory pressure) |
| `fetchFavicon` | partial | `(url, profile)`, a cookieless download as a `data:` PNG; the JS then hands it to Chrome with `engineCall("nn_favicons_set")` |
| `chromeWindows`, `devWindow`, `components`, `beginTracing`, `endTracing`, `isTracing`, `listTasks`, `killTask`, `setSearchEngineName`, `forgetOpenedURL`, `setDisplayMediaPicker`, `displayMediaSources` | stubbed | `forgetOpenedURL` has nothing to forget on NNCore |
| `onDownload`, `cancelDownload`, `pauseDownload`, `resumeDownload` | stubbed | Downloads run in Chrome's download manager with no app UI yet |
| `onPermission`, `onPermissionDismissed`, `resolvePermission` | stubbed | Chrome's own permission prompts (child windows of ours) |
| `resolveExternalApp`, `getExternalAppAllowances`, `removeExternalAppAllowance` | stubbed | |
| `clearBrowsingData`, `releaseProfile`, `deleteProfileData` | stubbed | `deleteProfileData` says the data remains |
| `onContentBlocker`, `getContentBlocker`, `setContentBlockerEnabled`, `setFilterListEnabled`, `isContentBlockerAllowed`, `setContentBlockerAllowed` | stubbed | No content blocker on NNCore yet |
| `setSiteSetting`, `getSiteSettings`, `getSiteSettingsOrigins`, `resetSiteSettings`, `clearSiteData` | stubbed | |
| `setZoom`, `getZoomLevels`, `devScrollZoom` | stubbed | `nn_zoom_*` exports exist; module glue missing |
| `listPasswords`, `unlockPasswords`, `getPassword`, `savePassword`, `updatePassword`, `deletePassword`, `getNeverSavePasswordOrigins`, `allowSavingPasswords`, `getPasswordAutofill`, `setPasswordAutofill` | stubbed | `{ error }`. To come from the engine C exports |
| `getAutofillSettings`, `setAutofillSettings`, `listAddresses`, `saveAddress`, `listCards`, `saveCard`, `deleteAutofillEntry`, `revealCardNumber` | stubbed | Same |

## `NetnyahooExtensions` (`packages/cef/src/extensions.ts`)

| Function / event | Status | Note |
|---|---|---|
| `chooseFolder` | done | |
| `list` | stubbed | No extensions |
| `inspectUnpacked`, `install`, `setEnabled`, `uninstall`, `reload`, `configure`, `searchEngineList`, `evaluateInHost`, `evaluateInPage`, `resolveInstallPrompt`, `onChanged`, `onTabs`, `onInstallPrompt` | stubbed | NNCore can load an unpacked extension and open its action popup (spike); the module doesn't expose it yet |

## `NetnyahooChromeUI` (`packages/cef/src/chromeUI.ts`)

All 15 functions and 4 events are **stubbed**: device choosers, the Cast dialog, extension side panels, action
states, tab-capture source changes and the autofill trigger keep Chrome's own UI (attached to our window) or don't
exist yet.

## `NetnyahooSwipe` (`packages/cef/src/swipe.tsx`)

**done**: the same sources as CEF's (`NNSwipe.mm`, `SwipeModule.swift`, linked into `packages/nncore/ios`); they
don't depend on CEF. Profile paging on NNCore is a change of the window's active profile, never a window swap.

## Window hosting (`NNChromeWindowHost`, looked up by `packages/shell/ios/ChromeWindows.swift`)

| Selector | Status | Note |
|---|---|---|
| `makeWindowForProfile:` | done | One `NNCoreWindow` (a Views-backed NSWindow) per app window, styled as the app's (full-size content, transparent title bar, traffic lights inset) |
| `embedRootView:inWindow:`, `rootViewOfWindow:`, `removeRootViewOfWindow:` | done | The RN root is the host view's subview, hit-tested before Chrome's views |
| `showProfile:inWindow:`, `prepareProfiles:forWindow:` | done | The window's active profile; its Browser made ahead |
| `setTrafficLightsCenter:inWindow:` | done | |
| `closeWindow:` | done | `-[NNCoreWindow close]` (beforeunload first, cancellable) |
| `shouldCloseHandler`, `windowShouldClose:` | partial | The title bar's close button asks the app first (NNCore's `windowShouldClose:`). Untested in the app (needs a click on the title bar) |
| `swappedHandler` | stubbed | Never fires: no window swaps on NNCore |
| `makePopupWindowForProfile:root:`, `devAction:window:` | stubbed | |

## Runtime

| Item | Status | Note |
|---|---|---|
| RN app in Chromium's loop | done | `NNCoreHost` runs `ChromeMain`; the app delegate is made in `engineDidStart`, a bootstrap delegate holds a cold launch's open-URL events until then |
| Popups as our tabs | done | Chrome's `WebContents` and navigation, POST bodies included |
| Two profiles in one window | done | |
| Background test instances | done | `NETNYAHOO_BACKGROUND=1`: the CEF build's activation guards (`NNCoreActivation.mm`) |
| Key equivalents from the page | done | Reserved keys (⌘T/W/N/Q, ⌃Tab) go to the app's menu before the page; others after the page leaves them; Chrome's own accelerators never run in our windows |
| Key window, IME, accessibility | partial | Wiring checked in the engine's run; marked text and VoiceOver need an unlocked screen and a key window |
| Quit and terminate: (⌘Q, Dock, logout) | done | Cocoa's `applicationShouldTerminate:` contract, so the app's own quit flow runs; cancellable |
| Cancellable window close (beforeunload), downloads prompt | partial | Engine-proven; the app answers the downloads prompt "close" (it asks itself before quitting) |
| Renderer side (page script, page messages, evaluate, netnyahoo:) | done | Main frame used by the module; subframe messages available (`didReceivePageMessage:json:frame:main:`) |
| Windows Chrome makes itself (chrome.windows.create, incognito, undocked DevTools, PiP) | partial | The engine asks the host (`engineWindowForNewBrowserOfProfile:type:`); the app answers nil (Chrome's own window) until it routes them into its window manager |
| Native composition of the page under the RN views, bubbles and sheets against the window | needs a visual check | The screen was locked for all of stage 1; in-process snapshots show the RN UI drawn in the NNCore window, not the page's GPU layers |

## Renderer side: what CEF's renderer gave the app, and NNCore's replacement

CEF ran Netnyahoo's code in each renderer (`packages/cef/helper/helper_main.mm`) and talked to it with process
messages. NNCore does the same with its own renderer client (`NNContentRendererClient`, a subclass of Chrome's) and
a mojo interface (`engine/nncore/src/netnyahoo/core/mojom`):

| CEF | NNCore | Used by |
|---|---|---|
| `OnContextCreated` runs the page script (`page_script.js`) in every frame's main world, as `function(post)` | `NNContentRendererClient`'s `DidCreateScriptContext` (main world), the script sent to each renderer at launch (`NNCoreEngine.pageScript`) | Everything below |
| `post(kind, json)` → the "nn" process message → `NNClient::OnPageMessage` | `NNPageHost.Post` (frame-associated) → `tab:didReceivePageMessage:json:frame:main:` (or the main-frame-only 3-argument form) | hello, media, nowPlaying, theme, selection, pinch, pip, displayMedia, notification, notificationClose. On NNCore the module handles hello, selection and pip so far |
| "nn-call" (`CallPage`) → the page's `receive` | `callPage:json:` (main frame), `callFrame:kind:json:` | config (the reply to hello), media, displayMedia, notification |
| "nn-eval" → strict `function(post)` wrapper, first `post("result")` answers | `evaluate:completion:` | `WebViewHandle.evaluate` |
| `ExecuteJavaScript` | `executeJavaScript:` and `executeJavaScript:frame:` | `history.go` (now `goToOffset:`), `WebViewHandle.executeJavaScript`, the blocked-popup replay and PiP exit in one frame, DevTools' showPanel (untested) |
| `IsAppURL` in `OnBeforeBrowse` / `OnBeforePopup` / `OnOpenURLFromTab` | A navigation throttle plus the popup and open-URL paths: web pages' `netnyahoo:` navigations are dropped; a Chrome page's become `tab:didRequestAppURL:userGesture:` → `onOpenWindow` `current` | The app's own pages linked from chrome:// pages |

## Engine C exports (`//chrome/browser/netnyahoo`, shared by both engines)

Plain Chromium code over Chrome's services (`engine/chromium/src/chrome/browser/netnyahoo`, rules in its
`public/nn_engine.h`), linked into CEF's framework and into NNCore's (`chromium-netnyahoo-layer.patch` adds it to
`//chrome:chrome_dll` and exports `_nn_*`). The CEF app calls them through `nn::engine::Call`
(`packages/cef/ios/NNEngine.mm`, `dlsym` on the framework); NNCore's module does the same on `Chromium Framework`, so
each row below is the native half of the JS functions in its last column. "NNCore" says whether `packages/nncore`
calls it yet.

| Export | JS functions (`packages/cef`) | NNCore |
|---|---|---|
| `nn_engine_abi_version`, `nn_engine_set_event_sink` | (events: `reauth.requested`, `passwords.export`, `zoom.changed`) | done (`engineCall`, `onEngineEvent`) |
| `nn_passwords_list`, `_unlock`, `_reveal`, `_add`, `_update`, `_remove`, `_exceptions`, `_allow` | `listPasswords`, `unlockPasswords`, `getPassword`, `savePassword`, `updatePassword`, `deletePassword`, `getNeverSavePasswordOrigins`, `allowSavingPasswords` | missing |
| `nn_passwords_export` | `exportPasswords` (Settings › Passwords › Export; the native side shows the save panel) | missing |
| `nn_autofill_addresses`, `_save_address`, `_cards`, `_save_card`, `_remove`, `_card_number` | `listAddresses`, `saveAddress`, `listCards`, `saveCard`, `deleteAutofillEntry`, `revealCardNumber` | missing |
| `nn_extensions_list`, `_install`, `_set_enabled`, `_uninstall`, `_reload`, `_configure` | `NetnyahooExtensions.list`, `install`, `setEnabled`, `uninstall`, `reload`, `configure` | missing |
| `nn_search_engines_list` | `NetnyahooExtensions.searchEngineList` | missing |
| `nn_zoom_list`, `nn_zoom_set` (`tab` for a private window's own zoom map) | `getZoomLevels`, `setZoom` (a site with no open tab) | missing |
| `nn_browsing_data_clear` | `deleteProfileData` of the default profile (form data, site settings) | missing |
| `nn_history_query`, `_add`, `_import`, `_delete_urls`, `_watch` (event `history.changed`) | `queryHistory`, `addHistoryVisits`, `importHistoryRows`, `deleteHistoryUrls`, `watchHistory`, `onHistoryChanged` (`packages/cef/src/history.ts`) | done (`engineCall`) |
| `nn_favicons_get`, `_set` | `faviconsFor`, `fetchFavicon`'s hand-off (`favicons.ts`) | done (`engineCall`) |
| `nn_bookmarks_tree`, `_apply`, `_watch` (event `bookmarks.changed`) | `bookmarkTree`, `applyBookmarkOps`, `watchBookmarks`, `onBookmarksChanged` (`bookmarks.ts`) | done (`engineCall`) |
| `nn_tab_restore_tag`, `nn_tab_restore_take` | none: native, as a WebView closes its tab and for `adoptId` `restore:<tab id>` (`NNBrowserView.mm`) | missing (see `adoptId`) |
| `nn_tab_restore_load` | allow-listed for `engineCall`, no caller yet | done (`engineCall`) |

`NetnyahooExtensions.evaluateInHost` and `evaluateInPage` are gone from `packages/cef` (they scripted the hidden
chrome:// pages, and nothing in the JS called them), and from `packages/nncore`.

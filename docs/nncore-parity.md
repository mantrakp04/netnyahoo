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
- **partial**: the common path works; the gap is in the note.
- **stubbed**: exported, so the JS never throws, but answers as an engine without the feature would (an empty
  list, `{ error }`, a no-op). The app runs; the feature is absent.
- **missing**: not exported on NNCore; the JS throws if it calls it.

## Summary (2026-10-01, stage 1)

| Area | done | partial | stubbed | missing |
|---|---|---|---|---|
| `WebView` props (9) | 5 | 1 | 3 | 0 |
| `WebView` events (33) | 8 | 5 | 20 | 0 |
| `WebView` methods (33) | 11 | 6 | 16 | 0 |
| `NetnyahooCEF` module functions (61) and events (5) | 5 | 1 | 60 | 0 |
| `NetnyahooExtensions` (12 functions, 3 events) | 1 | 0 | 14 | 0 |
| `NetnyahooChromeUI` (15 functions, 4 events) | 0 | 0 | 19 | 0 |
| `NetnyahooSwipe` (7 functions, view with 3 events) | 11 | 0 | 0 | 0 |
| Window hosting (`NNChromeWindowHost`, used by `packages/shell`) (12) | 9 | 1 | 2 | 0 |
| **Total (271)** | **50** | **14** | **134** | **0** |

Nothing is **missing**: every name the JS requires is exported, so the whole app runs on NNCore. The switch
waits on the **stubbed** and **partial** rows.

## How to build and check it

```bash
# Engine (once, and after engine/nncore changes): engine/nncore/apply.sh, then
#   scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework   (docs/nncore-spike.md)
# App: the project is generated from the CEF one (apps/browser/macos-nncore/generate.py), then pod install there.
cd apps/browser && ../../scripts/agent/locked xcodebuild -- xcodebuild -workspace macos-nncore/NetnyahooNNCore.xcworkspace \
  -scheme Netnyahoo-NNCore -derivedDataPath build-nncore -destination 'platform=macOS,arch=arm64' -configuration Debug build
# Acceptance, hidden (open -g -n, NETNYAHOO_BACKGROUND=1, a scratch data dir); METRO_PORT is the running Metro's port.
METRO_PORT=8081 node packages/nncore/scripts/acceptance.mjs apps/browser/build-nncore/Build/Products/Debug/NetnyahooNNCore.app <scratch dir>
```

The NNCore build is a development build: bundle id `com.netnyahoo.browser.nncore`, ad hoc signing, no Sparkle, no
dock tile, and it refuses to start without `NETNYAHOO_DATA_DIR` (it never falls back to a real profile).

## Stage 1 acceptance (hidden instance)

| Check | What it proves |
|---|---|
| boot | The RN app runs inside Chromium's own loop (`ChromeMain` → `MessagePumpNSApplication`, NSApp is Chrome's `BrowserCrApplication`), the store makes a window, the app never takes focus (`lsappinfo front`) |
| open-url | `openUrls` opens a tab; title, URL and loading reach the sidebar |
| favicon | The page's favicon reaches the store |
| navigate-back-forward-reload | Omnibox-style navigation (`navigate(…, { userInitiated })`), back, forward, reload |
| target-blank, window-open | The page's new tab arrives as `onOpenWindow` with `adoptId: "nncore:<id>"`, already made and navigated by Chrome; the new WebView takes that live tab (no replay, no orphan timer); it stays |
| cmd-click | A ⌘-clicked link opens behind, as a tab of ours |
| tab-switch | Switching tabs in the sidebar shows them and makes them Chrome's active tab |
| second-profile | A second profile's tab shows in the **same** NSWindow (one NNCoreWindow, a Browser per profile) and doesn't see the first profile's cookies |
| settings-window | The settings window opens |
| cmd-t-cmd-w | ⌘T / ⌘W reach the app's menu. **Fails with the page focused** until NNCore's key path lands (below) |

## WebView (`packages/cef/src/WebView.tsx`)

### Props

| Prop | Status | Note |
|---|---|---|
| `url` | done | |
| `profile` | done | `""` is Chrome's Default profile, `<id>` is `Profile <id>`, `incognito…` the default profile's OTR profile (needs the engine's `offTheRecordProfileFor:`) |
| `adoptId` | done | `nncore:<id>` takes the live tab Chrome made. CEF's `open:`/`clone:`/`restore:` ids open the URL fresh |
| `transferKey` | partial | A tab moving between windows is parked and taken by its new view; moving its WebContents into the new window's Browser needs the engine's `adoptTab:` |
| `visible`, `warm` | done | Hidden views hide the page view, so Chrome marks it hidden |
| `standalone` | stubbed | |
| `pageBackgroundColor` | stubbed | |
| `autoPictureInPicture` | stubbed | |

### Events

| Event | Status | Note |
|---|---|---|
| `onReady` | done | `browserId` is the module's own per-tab id; `tabId` is the chrome.tabs id |
| `onNavigationChange` | partial | url, title, back/forward, loading; coalesced per run-loop turn and sent only when changed. `themeColor` needs the engine's `themeColor` |
| `onProgress` | done | At most 10 a second, start and end at once |
| `onFavicon` | partial | A `data:` PNG of Chrome's favicon until the engine reports `faviconURL` |
| `onOpenWindow` | done | Popups, target=_blank, window.open, ⌘-click: `nncore:<id>`. A WebUI page's netnyahoo: link (`current`) needs the engine's `didRequestAppURL` |
| `onFindResult` | done | Chrome's FindTabHelper |
| `onFullscreen` | done | |
| `onWindowClose` | done | Chrome closing the tab (window.close(), an extension) |
| `onTabStrip` | done | Chrome activating a tab the app didn't ask for (`activated`, `byApp: false`) |
| `onPasswordPrompt` | partial | "save" only; no update/never/federation details |
| `onPageMessage` | partial | `selection`, once the engine runs the page script |
| `onPictureInPicture` | partial | Video PiP state from the page script (engine); document PiP not reported |
| `onMedia` | partial | Audible state from the engine's `tabDidChangeAudio:` |
| `onStatus`, `onCrashed`, `onLoadError`, `onPageFocus` | stubbed | Wired in the module; fire once the engine's tab delegate callbacks land |
| `onNowPlaying`, `onNotification`, `onNotificationClose`, `onDisplayMediaRequest` | stubbed | Page-script features (engine `pageScript`), not wired yet |
| `onMediaAccess`, `onPopupBlocked`, `onSecurity`, `onZoom`, `onContentBlocked`, `onDownloadNavigation`, `onActivateRequest`, `onCommand`, `onDiscarded`, `onExternalApp`, `onUnresponsive`, `onResponsive` | stubbed | Never fire. Chrome's own popup blocker blocks silently (no UI) |

### Methods (`WebViewHandle`)

| Method | Status | Note |
|---|---|---|
| `loadUrl` | done | `opened` (CEF's kept navigation) loads the URL |
| `goBack`, `goForward`, `reload`, `stopLoading`, `focus`, `find`, `stopFinding`, `showDevTools` | done | DevTools dock in the tab's view (Chrome's split) |
| `setTabStrip` | done | Remembered for `onTabStrip`; Chrome's index and pin need the engine's `placeTab:` |
| `downloadFavicon`, `downloadImage` | partial | From Chrome's favicon when the tab showed it, else a cookieless download |
| `goToOffset`, `forceReload` | partial | ±1 and a normal reload until the engine's `goToOffset:` / `reloadIgnoringCache` |
| `setMuted` | partial | Needs the engine's `muted` |
| `executeJavaScript`, `evaluate`, `navigationEntries`, `mediaCommand` | partial | Need the engine's `executeJavaScript:`, `evaluate:completion:`, `navigationEntries`, `callPage:json:` |
| `getSecurityInfo` | partial | The scheme only (secure/insecure/local), no certificate |
| `zoomStep`, `print`, `runPageCommand`, `requestPictureInPicture`, `exitPictureInPicture`, `openBlockedPopup`, `clearSiteData`, `executeExtensionAction`, `resolveDisplayMedia`, `mediaCaptureSourceId`, `notificationAction`, `resolveUnresponsive`, `discard`, `setFrozen`, `resolvePasswordPrompt` (beyond save/dismiss) | stubbed | |

## `NetnyahooCEF` module (`packages/cef/src/native.ts`, `module.ts`)

| Function / event | Status | Note |
|---|---|---|
| `engineInfo` | done | `engine: "nncore"`, Chromium version, windows, keep-alive state |
| `prepareTransfer` | done | |
| `systemState`, `onSystemState` | done | Same code as CEF's (IOKit, memory pressure) |
| `fetchFavicon`, `pruneFavicons` | partial | As `downloadFavicon`; stored where CEF stores them (`<profile>/Netnyahoo Favicons`) |
| `chromeWindows`, `devWindow`, `components`, `beginTracing`, `endTracing`, `isTracing`, `listTasks`, `killTask`, `setSearchEngineName`, `forgetOpenedURL`, `setDisplayMediaPicker`, `displayMediaSources` | stubbed | `forgetOpenedURL` has nothing to forget on NNCore |
| `onDownload`, `cancelDownload`, `pauseDownload`, `resumeDownload` | stubbed | Downloads run in Chrome's download manager with no app UI yet |
| `onPermission`, `onPermissionDismissed`, `resolvePermission` | stubbed | Chrome's own permission prompts (child windows of ours) |
| `resolveExternalApp`, `getExternalAppAllowances`, `removeExternalAppAllowance` | stubbed | |
| `clearBrowsingData`, `releaseProfile`, `deleteProfileData` | stubbed | `deleteProfileData` says the data remains |
| `onContentBlocker`, `getContentBlocker`, `setContentBlockerEnabled`, `setFilterListEnabled`, `isContentBlockerAllowed`, `setContentBlockerAllowed` | stubbed | No content blocker on NNCore yet |
| `setSiteSetting`, `getSiteSettings`, `getSiteSettingsOrigins`, `resetSiteSettings`, `clearSiteData` | stubbed | |
| `setZoom`, `getZoomLevels`, `devScrollZoom` | stubbed | |
| `listPasswords`, `unlockPasswords`, `getPassword`, `savePassword`, `updatePassword`, `deletePassword`, `getNeverSavePasswordOrigins`, `allowSavingPasswords`, `getPasswordAutofill`, `setPasswordAutofill` | stubbed | `{ error }`. To come from the engine C exports (`//chrome/browser/netnyahoo`, shared with CEF) |
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
| `makeWindowForProfile:` | done | One `NNCoreWindow` (a Views-backed NSWindow) per app window |
| `embedRootView:inWindow:`, `rootViewOfWindow:`, `removeRootViewOfWindow:` | done | The RN root is the host view's subview, hit-tested before Chrome's views |
| `showProfile:inWindow:`, `prepareProfiles:forWindow:` | done | The window's active profile; `prepareProfiles` needs the engine's `prepareProfile:` |
| `setTrafficLightsCenter:inWindow:` | done | |
| `closeWindow:` | done | `-[NNCoreWindow close]` (beforeunload first) |
| `shouldCloseHandler`, `windowShouldClose:` | partial | Called from the engine's `windowShouldClose:` delegate, once it lands |
| `swappedHandler` | stubbed | Never fires: no window swaps on NNCore |
| `makePopupWindowForProfile:root:`, `devAction:window:` | stubbed | |

## Runtime (not JS API, but what the app needs from the engine)

| Item | Status | Note |
|---|---|---|
| RN app in Chromium's loop | done | `NNCoreHost` runs `ChromeMain`; the app delegate is made in `engineDidStart` |
| Popups as our tabs | done | Chrome's `WebContents` and navigation, POST bodies included |
| Two profiles in one window | done | |
| Background test instances | done | `NETNYAHOO_BACKGROUND=1`: the CEF build's activation guards (`NNCoreActivation.mm`) |
| Key equivalents, focus, IME | missing | Engine work in progress: the page's unhandled ⌘-keys to the app's menu, reserved keys first |
| Cancellable close and quit, `terminate:` (Dock, logout) | missing | Engine work in progress |
| Renderer side (page script, page messages, evaluate, netnyahoo:) | missing | Engine work in progress: an NNCore `ContentRendererClient` and a mojo interface |
| Windows Chrome makes itself (chrome.windows.create, incognito, undocked DevTools, PiP) | missing | Engine hook in progress; the app returns nil (Chrome's own window) until stage 2 |

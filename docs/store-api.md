# App store API (apps/browser/src/store)

One zustand store: `useBrowser` (store/browser.ts). Actions take explicit ids. Read the
modules before using them — this is a summary from the agent that built it.

## State
- `profiles` + `profileOrder`; default profile id is `"default"`.
- `windows`: `{ profileId, incognito, tabIds (sidebar order, pinned first), activeTabIds[profileId], sidebarOpen, frame }` + `windowOrder`.
- `tabs` (persisted) vs `live` (loading/progress/back-forward/audio/theme colour; never persisted).
- `groups`: `{ windowId, profileId, name, icon, color, collapsed, pinned, tabIds }` (members contiguous).
- `splits` (store/splits.ts): `{ windowId, tabIds (2–3, pane order), orientation, sizes, stack? }` — `stack` = two panes sharing a slot the other way (Add Bottom Split). Members are contiguous in `window.tabIds`; the window's active tab is the focused pane. `window.tabLayout` ("sidebar" | "top", unset = Settings).
- `history[profileId]`; `bookmarks`: `{ nodes, roots[profileId]: { bar, other } }`.
- `closedTabs` / `closedWindows` (full state); `downloads`; `settings` (typed, store/settings.ts).
- UI: `ui.focusedWindowId`, `ui.appDark`, `windowUi[windowId]` (command panel, downloads popover), `find[tabId]`.

## Actions
- Windows: `createWindow`, `closeWindow`, `switchProfile`, `moveTabsToWindow`, `moveTabToProfile`,
  `mergeAllWindows`, `reopenClosed` / `reopenClosedTab` / `reopenClosedWindow`, `restoreClosed`.
- Tabs: `newTab(windowId, { url, background, adoptId, openerId, profileId, pinned, index })`, `closeTab`,
  `closeTabs`, `activate`, `navigate`, `updateTab`, `updateLive`, `togglePin`, `moveTab`, `duplicateTab`.
  `duplicateTab` and Reopen Closed Tab set `adoptId` to `clone:<tab id>` / `restore:<tab id>` (`ClosedTab.tabId`):
  the engine copies or restores that tab's back/forward list, else the tab loads its URL.
- Groups: `createGroup`, `addTabsToGroup`, …
- Splits: `createSplit`, `openSplitPane(windowId, { tabId | url, anchorTabId, side, background })`, `replaceSplitPane`, `removeTabFromSplit`, `separateSplit`, `flipSplit`, `toggleSplitOrientation`, `movePane`, `focusPane`, `updateSplit`; `toggleTabLayout`. UI entry points with Dia's feedback (max-panes toast, menus): components/layout/splitActions.ts (`openSplitPane`, `openNewTabInSplit`, `openInSplit`, `openLinkInSplit`, `showSplitMenu`). Drag a tab onto the page to split: components/layout/tabDrag.ts.
- Sidebar organisation (store/organize.ts): `selection[windowId]` (⌘/⇧-click multi-select), `placeTabs(ids, { pinned, beforeId, groupId })`
  (drag and drop), `pinTabs`, pinned base URLs (`tab.pinnedUrl`, `returnToPinnedUrl` ⌘↩, `setPinnedUrl`), `setSiteMuted` (Mute Site,
  `settings.mutedSites`), `groupTabs` (pinned by default, like Dia), `moveGroup`, `duplicateGroup`, `newTabInGroup`,
  `closeGroup` → `closedGroups` (History › Recently Closed Groups; `restoreClosed` takes their ids), `moveGroupToBookmarksBar`,
  `cleanUpTabs` → `cleanedTabs` / `restoreCleaned`, `closeAbandonedNewTabs`. `newTab` with `openerId` + `background` (⌘-click)
  joins the opener's group (`settings.cmdClickCreatesTabGroup`). Sidebar UI lives in components/sidebar/.
- Profiles: `createProfile` (`shareWith`: share another profile's data), `updateProfile`, `deleteProfile`, `reorderProfiles`, `setDefaultProfile`.
  Shared data: `profile.dataId` names the data a profile uses; `engineProfile(id)` resolves it, bookmark roots are the same
  folders, and store/profiles keeps history lists identical (`dataGroups`, `sharingProfiles`). The Create Profile dialog is
  components/profiles/CreateProfile.tsx (`lib/actions.createProfile`).
- Bookmarks: `addBookmark`, `addBookmarkFolder`, `moveBookmark`, `removeBookmark`, `toggleBookmark`,
  `addBookmarkTree` (imports, Bookmark All Tabs), `removeBookmarks` → `restoreBookmarks` (bulk delete + undo).
- History: `recordVisit`, `removeHistory`, `clearHistory(profileId, since?)`, `importHistory`. Settings: `updateSettings`
  (`bookmarksBar`, `shortcuts` = remapped menu keys read by Menus.swift, …).

## Hooks (store/hooks.ts, window-scoped)
`useWindowId`, `usePinnedTabIds`, `useRegularTabIds`, `useActiveTab(Id)`, `useTab(id)`,
`useTabLive(id, select?)`, `useWindowProfile`, `useProfiles`, `useSettings(select)`, `useFind(tabId)`,
`useWindowUi`, `useIsBookmarked(url)`. Subscribe rows by id with narrow selectors so progress events
don't re-render every tab.

## Helpers and side effects
- Pure: store/model.ts — `viewTabIds`, `activeTabId`, `engineProfile` (the WebView `profile` prop), `windowTitle`.
- Dialogs / native side effects go through lib/actions.ts (`closeTab`, `switchToTab`, `moveTabToProfile`,
  `moveTabToWindow`, `createProfile`, `renameProfile`, `deleteProfile`, `openWindow`).
- Menu commands: lib/commands.ts (JS) + packages/shell/ios/Menus.swift (native menu bar).
- Tests: `cd apps/browser && node --import ./src/store/test-loader.mjs --test src/store/store.test.mjs`.

## Dev tooling (DEV builds)
- LogBox is disabled (its shadows crash react-native-macos); console errors/warnings go to
  `$NETNYAHOO_DATA_DIR/dev-console.log`.
- lib/devHarness.ts runs `$NETNYAHOO_DATA_DIR/dev-eval.js` against the store — use it to drive a running instance.
- Menus per instance: scratchpad `axmenus` tool (System Events confuses instances sharing a bundle id).
- Swipes (layout/SwipeOverlay, layout/ProfileSwipe, packages/cef/ios/NNSwipe.mm): `globalThis.nnSwipe.pane(tabId).devSimulate(steps, { ignorePreference: true })`
  and `.sidebar(windowId)` play synthetic trackpad gestures through the real tracker (pages scroll and ack for real); `nnSwipe.history` opens the back/forward list.

## Internal pages, Settings, Import (components/pages, settings, import)
- `netnyahoo://history|bookmarks|downloads` tabs render React pages instead of a web view
  (`openInternalPage(page, windowId)`, `isInternalTab(tab)` in components/pages).
- Settings (⌘,) and Import are utility NSWindows with ids `settings` / `import` (`openSettings(pane)`,
  `openImport()` in components/settings/windows.ts); `runCommand` routes ⌘W there to close them.

## netnyahoo:// URLs (core appUrls.ts, like Dia's dia:// and Brave's brave://)
- **The app's form is `netnyahoo://`**, everywhere: `tab.url`, `navigation.url`, history, bookmarks,
  closed tabs, the bar, AppleScript. Nothing in the store is `chrome://`.
  - Input: `resolveInput` / `fixupUrl` turn `chrome://x`, `chrome:x`, `about:x` and `netnyahoo:x` into
    `netnyahoo://x`. about:blank and about:srcdoc stay as they are.
  - The engine boundary is packages/cef `WebView`. Loading maps `netnyahoo://` → `chrome://`
    (`url` prop, `loadUrl`). Reporting maps `chrome://` → `netnyahoo://` (navigation, open-window,
    popup, load-error, download and discard events, `navigationEntries`).
  - Pages linking to `netnyahoo://`: NNClient only follows these from a WebUI page (chrome://,
    devtools://) and drops them from web pages, like Chrome does for chrome://. That covers links,
    ⌘-clicks and popups.
  - Display: `urlForDisplay` / `displayUrl` / `breadcrumb` show `netnyahoo://version`, keeping the
    scheme and dropping a root "/". `tabLabel` (window title) and `hostLabel` (History / Bookmarks
    pages) show `netnyahoo://<host>`.
  - History records `netnyahoo://` visits (Chrome's WebUI), so the bar suggests them again.
- **Where each host goes** (`appUrlRoute`):

  | URL | Opens |
  | --- | --- |
  | `netnyahoo://history`, `bookmarks`, `downloads` | Our React pages in the tab (components/pages). They take precedence over Chrome's pages, and `chrome://history` typed or reported lands here too. |
  | `netnyahoo://settings` | Our Settings window (components/pages/appUrls.ts). The tab doesn't change. |
  | `netnyahoo://settings/<pane>` | Our Settings window at that pane: general, profiles (also `people`, `manageProfile`), tabs, appearance, privacy, passwords, autofill (also `addresses`, `payments`), extensions, search (also `searchEngines`), shortcuts, liveFolders, calendar, advanced. |
  | `netnyahoo://settings/<anything else>` | Chrome's settings page (e.g. `settings/languages`, `settings/content`). |
  | `netnyahoo://newtab` | A New Tab page (a new tab). |
  | `netnyahoo://extensions` | Chrome's extensions page (as dia://extensions is in Dia): developer mode, load unpacked, errors, shortcuts. Our Settings › Extensions stays at `netnyahoo://settings/extensions`. |
  | Everything else: `version`, `gpu`, `net-internals`, `flags`, `inspect`, `about`, `chrome-urls`, `password-manager`, `downloads-internals`, … | Chrome's WebUI page, shown as `netnyahoo://<host>`. |
- `settings` and `newtab` are handled in the store's `navigate` / `newTab` through `setAppUrlOpener`
  (store/tabs.ts). That covers every way a URL gets in: the bar, bookmarks, history, AppleScript,
  opened URLs and links. A restored tab at `netnyahoo://settings/…` loads Chrome's page.
- The OS doesn't route `netnyahoo:` to us. Like Dia and Brave, the app doesn't register the scheme,
  so a web page can't open `netnyahoo://quit` through Launch Services. `open -a Netnyahoo 'netnyahoo://version'`
  and AppleScript work, because those go to the app directly.

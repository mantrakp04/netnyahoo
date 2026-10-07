# App store API (apps/browser/src/store)

One zustand store: `useBrowser` (store/browser.ts). Actions take explicit ids. Read the
modules before using them — this is a summary from the agent that built it.

## State
- `profiles` + `profileOrder`; default profile id is `"default"`.
- `windows`: `{ profileId, incognito, tabIds (sidebar order, pinned first), activeTabIds[profileId], sidebarOpen, frame }` + `windowOrder`.
  A private window's `profileId` is `incognito:<window id>@<originalProfileId>` (`incognitoProfileId`, store/model.ts),
  `originalProfileId` the regular profile it was opened from (`createWindow({ incognito: true, profileId })`, default
  `lastActiveProfile`). Its engine profile (`engineProfile`) is that profile's off-the-record one: private windows of one
  profile share a session (`privateSession(profileId)`, the regular engine name), another profile's never. Downloads
  carry `offTheRecord` and their regular profile (`downloadSession`, store/ui.ts); a session's go with its last window.
- `tabs` (persisted) vs `live` (loading/progress/back-forward/audio/theme colour; never persisted).
- `groups`: `{ windowId, profileId, name, icon, color, collapsed, pinned, tabIds }` (members contiguous).
- `splits` (store/splits.ts): `{ windowId, tabIds (2–3, pane order), orientation, sizes, stack? }` — `stack` = two panes sharing a slot the other way (Add Bottom Split). Members are contiguous in `window.tabIds`; the window's active tab is the focused pane. `window.tabLayout` ("sidebar" | "top", unset = Settings).
- `history[profileId]`: a view of Chrome's history (HistoryService), one entry per URL, not saved; `historyReady[profileId]`
  once it has been read (lib/history.ts). `bookmarks`: `{ nodes, roots[profileId]: { bar, other } }`.
- `closedTabs` / `closedWindows` (full state; a closed window's entry leaves out its pinned tabs and pinned groups);
  `downloads`; `settings` (typed, store/settings.ts).
- `parkedPins[profileId]` (store/parkedPins.ts): pinned tabs belong to the profile's sidebar, as in Dia. Closing a
  window (⌘W on its last tab, the close button, ⇧⌘W, "Start fresh" on launch) parks its pinned tiles (at their pinned
  URL) and pinned groups, with their order and tab/group ids; the next window that shows the profile takes them back,
  unloaded (`createWindow` — ⌘N, the Dock, a link from another app, the first window after a relaunch —,
  `switchProfile`, Reopen Closed Window, ⇧⌘T of a tile's page), and the park empties, so nothing comes back twice.
  Only the last window of a profile parks: while another window shows the profile, the pins are there.
  Sync publishes parked pins as the profile's pins and applies changes to them in place (sync/adapters `pinnedAdapter`).
- Pins are per profile in every window (store/pinMirror.ts): each regular window showing a profile holds its own copy
  (a Tab, a TabGroup) of every pinned tile and pinned group, linked by `pinKey` (unset on the first copy, whose id is
  the key; `pinKeyOf`). A store listener (`mirrorPins`) carries a change of one window's pinned section to the others
  (the focused changed window wins) and gives a window that starts showing a profile its pins (the union, for windows
  that differ at launch). Copies it makes are unloaded; a copy it drops goes if it never loaded, else stays as a regular
  tab. Moving a pinned tab between windows (`moveTabsInto`, an extension's move) leaves a copy behind
  (`settleMovedPins`). Sync keys pins by `pinKey` and changes the home window's copy.
- UI: `ui.focusedWindowId`, `ui.focusOrder`, `ui.lastProfileId` (the regular profile of the window used last, a private
  window counting as its `originalProfileId`; saved with the session; read it through `lastActiveProfile(s)`, store/small.ts),
  `ui.appDark`, `windowUi[windowId]` (command panel, downloads popover), `find[tabId]`.

## Actions
- Windows: `createWindow`, `closeWindow`, `switchProfile`, `moveTabsToWindow`, `moveTabToProfile`,
  `mergeAllWindows`, `reopenClosed` / `reopenClosedTab` / `reopenClosedWindow`, `restoreClosed`.
  Small Yahu (Little Arc): `createWindow({ small: true, url })` makes a `kind: "small"` window with one tab (store/small.ts),
  in `lastActiveProfile(s)` unless `profileId` says otherwise; never private.
  `newTab` into it goes to `mainWindowFor(s, profileId)`; `resolveWindowId(s, null)` never picks it; closing it records a
  `ClosedTab` with `small: true` that reopens in a new Small Yahu; it isn't saved with the session.
- Tabs: `newTab(windowId, { url, background, adoptId, openerId, profileId, pinned, index })`, `closeTab`,
  `closeTabs`, `activate`, `navigate`, `updateTab(id, patch, live?)` (the live patch lands in the same store update), `updateLive`,
  `togglePin`, `moveTab`, `duplicateTab`. The engine's page reports go through `navigated(id, { url, title }, live)` and
  `faviconChanged(id, favicon)`. Chrome records the visit (HistoryService) and keeps the icon (FaviconService) itself.
  Closing a pinned tab only unloads it (`unloadPinnedTabs`, like Dia): the tile stays with `unloaded: true`, back at its
  pinned URL and without a web view until selected; the window selects its last-used regular tab, else the loaded
  pinned tab it showed last, else a New Tab page, and ⇧⌘T restores the page into the tile. Closing the last tab closes
  the window, unloaded pinned tiles aside (`closesWindow`), so holding ⌘W ends there instead of waking them. Unpin
  removes a pinned tab. A tab of a pinned group (Dia's pinned container, `inPinnedContainer`) unloads the same way, on
  the page it showed, and stays in its group.
  `duplicateTab` and Reopen Closed Tab set `adoptId` to `clone:<tab id>` / `restore:<tab id>` (`ClosedTab.tabId`):
  the engine copies or restores that tab's back/forward list, else the tab loads its URL.
- Groups: `createGroup`, `addTabsToGroup`, …
- Splits: `createSplit`, `openSplitPane(windowId, { tabId | url, anchorTabId, side, background })`, `replaceSplitPane`, `removeTabFromSplit`, `separateSplit`, `flipSplit`, `toggleSplitOrientation`, `movePane`, `focusPane`, `updateSplit`; `toggleTabLayout`. UI entry points with Dia's feedback (max-panes toast, menus): components/layout/splitActions.ts (`openSplitPane`, `openNewTabInSplit`, `openInSplit`, `openLinkInSplit`, `showSplitMenu`). Drag a tab onto the page to split: components/layout/tabDrag.ts.
- Sidebar organisation (store/organize.ts): `selection[windowId]` (⌘/⇧-click multi-select), `placeTabs(ids, { pinned, beforeId, groupId })`
  (drag and drop), `pinTabs`, pinned base URLs (`tab.pinnedUrl`, `returnToPinnedUrl` ⌘↩, `setPinnedUrl`), `setSiteMuted` (Mute Site,
  `settings.mutedSites`; a private window's mutes stay in `privateSiteMutes[windowId]`, in memory), `groupTabs` (pinned by default, like Dia), `moveGroup`, `duplicateGroup`, `newTabInGroup`,
  `closeGroup` → `closedGroups` (History › Recently Closed Groups; `restoreClosed` takes their ids), `moveGroupToBookmarksBar`,
  `cleanUpTabs` → `cleanedTabs` / `restoreCleaned(entryId?, windowId?)` (a private window's go to `privateCleanedTabs[windowId]`,
  in memory, and only back into that window; read either with `cleanedTabsFor(s, windowId)`), `closeAbandonedNewTabs`. `newTab` with `openerId` + `background` (⌘-click)
  joins the opener's group (`settings.cmdClickCreatesTabGroup`). Sidebar UI lives in components/sidebar/.
- Profiles: `createProfile` (`shareWith`: share another profile's data), `updateProfile`, `deleteProfile`, `reorderProfiles`, `setDefaultProfile`.
  `deleteProfile` queues engine data no profile uses any more in `orphanedProfileData` (saved); lib/profileData.ts deletes it
  (`deleteProfileData`, which erases the original profile's data through Chrome's own stores) and retries at launch until it's gone.
  Shared data: `profile.dataId` names the data a profile uses; `engineProfile(id)` resolves it, bookmark roots are the same
  folders, and store/profiles keeps history lists identical (`dataGroups`, `sharingProfiles`). The Create Profile dialog is
  components/profiles/CreateProfile.tsx (`lib/actions.createProfile`).
- Bookmarks: `addBookmark`, `addBookmarkFolder`, `moveBookmark`, `removeBookmark`, `toggleBookmark`,
  `addBookmarkTree` (imports, Bookmark All Tabs), `removeBookmarks` → `restoreBookmarks` (bulk delete + undo).
  They're Chrome's (BookmarkModel, so `chrome.bookmarks` sees them): lib/bookmarks.ts reads each engine profile's tree,
  sends each store change to Chrome as ops (`bookmarkOps`), takes back what extensions change, and moved the old
  `bookmarks.json` in once. Node ids are Chrome UUIDs (`newBookmarkId`); an engine profile's roots are
  `bar@<engine>` / `other@<engine>` (`rootIdsFor`); `bookmarksReady[profileId]` once read; `syncKey` (sync/adapters.ts).
  Until Chrome's tree is read at launch the store shows the last one read (`bookmarks-cache.json`), which is display
  only: it's never sent to Chrome, and edits made meanwhile are replayed on Chrome's tree.
- History (Chrome's; lib/history.ts reads it and follows its `history.changed` events, and moved the old `history.json`
  into it once): `removeHistory` (deletes from Chrome too), `clearHistory(profileId, since?)` (the view; Clear Browsing
  Data deletes from Chrome), `importHistory` (Chrome's importer path). Favicons are Chrome's too: lib/favicons.ts is
  an in-memory cache by page, plus the icons live tabs show and the light/dark pick. Settings: `updateSettings`
  (`bookmarksBar`, `shortcuts` = remapped menu keys read by Menus.swift, …).

## Hooks (store/hooks.ts, window-scoped)
`useWindowId`, `useActiveTab(Id)`, `useTab(id)`,
`useTabLive(id, select?)`, `useWindowProfile`, `useProfiles`, `useSettings(select)`, `useFind(tabId)`,
`useWindowUi`, `useIsBookmarked(url)`. Subscribe rows by id with narrow selectors so progress events
don't re-render every tab.

## Helpers and side effects
- Pure: store/model.ts — `viewTabIds`, `activeTabId`, `engineProfile` (the WebView `profile` prop), `windowTitle`.
- Dialogs / native side effects go through lib/actions.ts (`closeTab`, `switchToTab`, `moveTabToProfile`,
  `moveTabToWindow`, `createProfile`, `deleteProfile`, `openWindow`).
- Menu commands: lib/commands.ts (JS) + packages/shell/ios/Menus.swift (native menu bar).
- Tests: `pnpm --filter @netnyahoo/browser test` (`docs/testing.md`).

## Native events (lib/nativeEvents.ts)
Every native→JS call is its own task, and React Native commits after each, so a page's reports used to cost a commit
apiece (about ten per new tab). A WebView's page reports (`HELD_EVENTS`: navigation, progress, favicon, media, now
playing, status, security, blocked count, media access, load error) are held until the calls already queued behind
them have run (a 0 ms timer), then applied in arrival order in one React batch. Anything else that reaches JS first
applies them before it runs: any other event (touches, layout, a page opening a window, focus, activation, commands,
find, zoom, a new page's ready report), a timer, a callback, and every native module listener (Expo's EventEmitter, so
a tab strip transaction or a download), which also runs as one commit with them. Nothing is reordered or dropped, and
nothing a user action waits on is held. Work JSI delivers without a listener (an Expo promise settling) can run before
held reports, as it already could before a view event's own dispatch hop: code that decides from a page's live state
after awaiting the engine calls `applyHeldReports()` first (tabLifecycle's sleep and freeze, closeTab). A flush
also runs as one store transaction (`storeTransaction`, store/transaction.ts): its writes apply at once, and the store's
listeners and subscriptions hear them together at the end, except a write that changes a tab's address or starts or
ends its load, which is heard as it lands (a value that flips back within the flush stays visible to the listeners
that act on it: translate's detection, the web store's script, a screen-share request going with its page).

## Live tabs: Chrome's tab strips (lib/chromeTabs.ts, store/liveTabs.ts, packages/nncore/src/tabStrip.ts)

One writer per fact. The store owns the **workspace**: sidebar order, pins, groups, splits, Small Yahu, unloaded
and parked tiles, and which tab each window shows per profile (`activeTabIds`). Chrome's `TabStripModel` owns
the **live tabs**: which tabs each Chrome window ("strip": one per engine profile per app window) has, their order,
the active one, pins (and groups, once the engine reports them). JS never writes a live fact and never guesses who
caused a report: it sends commands with ids, the engine commits them in Chrome, and every change comes back as one
ordered transaction that names its cause. There are no echo windows, timers or "was that us" flags.

**The engine contract** (`@netnyahoo/nncore`; NNCore implements it in `packages/nncore/ios/NNCoreTabStrip.mm`):
- `sendTabStripCommand(command): number` sends a command and returns its id (unique for the app's lifetime, also
  across JS reloads). Commands:
  - `{ op: "activate", strip, key }`: make that tab the strip's active tab.
  - `{ op: "arrange", strip, keys, pinned }`: the listed tabs in this order at the start of the strip, the first
    `pinned` of them pinned and the rest not. Keys not in that strip (any more) are skipped; the strip's other tabs
    follow the listed ones.
  - `{ op: "group", strip, keys, group, title?, color?, collapsed? }`: the listed unpinned tabs into one of the
    strip's groups (its id), `"new"` for a new one, `null` out of theirs; the group's title, color and collapsed
    state when given.
- `onTabStripTransaction(listener)` delivers `{ rev, cmd, strips, rejected? }`:
  - `rev` is one more than the previous transaction's, for the engine's lifetime, in the order the changes were
    committed. A listener applies them in that order and drops any `rev` it has already passed.
  - `cmd` is the cause: the id of the command (each command yields exactly one transaction, also when nothing
    changed, with `rejected: true` when none of its tabs were in its strip); `-1` for the app's own engine calls
    that aren't commands (a WebView creating, restoring or duplicating its tab, a tab moving to another app
    window, a page command or DevTools activating its tab); `null` for what Chrome did on its own (an extension's
    `chrome.tabs`/`tabGroups` call, the tab Chrome shows after the active one leaves, a focus request selecting a
    tab, a strip's placeholder tab going).
  - A transaction never mixes causes. Chrome's pending changes go out before a command runs; whatever Chrome does
    synchronously inside a command (selection, observers) is the command's.
  - A change that isn't a command's and leaves its strip as it was last sent isn't sent (a new tab's insertion and
    placing made two identical transactions).
  - `strips` holds every strip the change touched, each whole: `{ strip, window, appWindow?, profile, tabs,
    groups?, activePickedOnClose?, closed? }` (`window` is shared by the strips of one app window, one per engine
    profile it shows; `appWindow` is the app's id for that window, its React root's `windowId`;
    `activePickedOnClose` says the active tab is the one Chrome picked because the active tab left the strip, not
    one anybody activated), `tabs` in strip
    order as `{ key, browser, index, active, pinned, group? }`, and `groups?: [{ id, title, color, collapsed }]`. `key` is the WebView's `transferKey` (the store's tab
    id), bound when a view first shows the browser and kept while the browser moves between views; `null` for a tab
    no view has shown (one Chrome made, before the app adopts it; an engine placeholder). `group` (Chrome's group id,
    null for none) and `groups` are absent while an engine doesn't report groups. NNCore reports Chrome's
    groups (the engine layer's `nn_tabs` in `//chrome/browser/netnyahoo`: event `tabs.strip`, call `nn_tabs_group`). A strip left without tabs is sent with `tabs: []`; a strip whose
    window closed comes once more with `closed: true`.
- `tabStrips()` answers every strip as a transaction with `cmd: null` and the last `rev` sent: the starting point
  after a JS (re)load. Transactions that arrive before it are held, then applied if newer.
- The engine never activates, moves or pins a tab for an app reason except on a command (no activation when a view
  becomes visible; a tab moved to another window goes there in the background). Showing a page still tells the
  engine where Chrome's views go (layout).
- A tab Chrome made in a window on its own (an extension's `tabs.create`) reaches the app as `onOpenWindow` with
  `adoptId: "tab:<browser>"`; a page's new tabs and popups come as `adoptId: "nncore:<id>"`, already made by Chrome.

**How the app applies them** (lib/chromeTabs.ts): it keeps a mirror of every strip.
- A transaction with a `cmd` (the app's own) only updates the mirror: the store already holds that intent.
- A `null` one is Chrome's change, and `chromeChanged` (store/liveTabs.ts) makes the same change in the workspace,
  diffing each strip before and after it:
  - tabs whose order among the tabs that stayed changed (off the heaviest kept run; grouped tabs weigh more, so a
    tab moved into a group joins it rather than the group's tab leaving), or that Chrome pinned or unpinned, go
    where Chrome put them (a pane of a split keeps its pin, as in Dia: the split stays and Chrome is put back;
    `placing`, last to first, each before the next tab Chrome has after it that's already in
    place, keeping a group both neighbours share). A split is one row: its panes move together and nothing lands
    between them;
  - a new active tab that stayed in the strip is shown (`activate`'s rules, opener bookkeeping included), unless
    it's Chrome's pick of a successor (`activePickedOnClose`; from engines that don't say, any activation that comes
    with the old active tab leaving): then the store's own rule (store/openers.ts) decides. An explicit activation
    in the same change as the close (an extension's remove then update) is a switch, and wins over the store's
    successor command still on its way. A split's other pane and a tab of a profile the window isn't showing
    aren't shown (the focused pane changes on user focus; profiles keep their own tab);
  - a tab Chrome made (`tab:` adoption) takes Chrome's pin, place and activation the first time the app sees it;
    a tab arriving in a strip of another app window (an extension moving it; the window is `appWindow`, else the
    one its other tabs are in) changes window as it is, page and live state included (`intoWindow`; its view takes
    the same browser there), also into a window holding only New Tab pages;
  - groups, when the engine reports them: a tab Chrome put in a group or took out of one joins or leaves the
    store's group in place; a group Chrome made becomes a store group (title, color); a group's title, color or
    collapsed state follows. Chrome's group ids and the store's are bound in memory (`GroupBindings`);
  - Chrome's change to a fact that a command of the app's own, already sent to that strip, will set (the order
    and pins of the tabs an `arrange` lists, the groups of the tabs a `group` lists, the active tab for
    `activate`) is skipped: that command commits after it and wins.
- After every store change and transaction, `stripPlan` gives what the store wants each strip to be (the store's
  tabs in it in window order, pinned first; the shown profile's active tab) and the app sends the command that
  closes the gap: `activate` first, then `arrange`, then `group` (a Chrome group for a store group that has none,
  missing members, title, color and collapsed, as Dia's engine mirrors it; Chrome's model keeps the active tab when
  its group collapses);
  one command per strip at a time; no `activate` while Chrome's active tab has no key (a tab Chrome made in front,
  before the app adopts it: its activation is Chrome's, above); the same command isn't sent
  again until something other than the app's commands changed that strip (a plan Chrome can't reach doesn't loop).
- NNCore (`NNCoreTabStrip.mm`) takes the strips from Chrome's own tab strip models, which name the Browser, so a
  strip's window is never inferred from its tabs.
- Tests: `src/store/liveTabs.test.mjs` runs the real wiring against a fake engine that keeps this contract.

## Sync (apps/browser/src/sync, packages/sync)
- End-to-end-encrypted sync through a folder the user picks; design in `docs/sync.md`. `sync/engine.ts` owns the
  state (`useSync`: status, devices, other devices' tabs), the setup flows and the cycle; `sync/adapters.ts` maps the
  store to synced records (bookmarks, history, open tabs, pinned tabs and pinned groups, settings, passwords).
  Adapters rebuild or patch store state with `useBrowser.setState`, so store invariants they touch (group contiguity,
  pinned-first order) are kept there.
- Record keys use store ids (`bm:<id>`, `pin:t:<tab id>`), so ids must stay unique across Macs: `newId` has a random part.
- Tests: `src/sync/adapters.test.mjs` (two devices swap the one store; `docs/testing.md`).
  DEV: `nnSync` (`turnOnSync`, `enterRecoveryPhrase`, `syncNow`, `stopSync`, `useSync`, `menu`, `sheets`).

## Dev tooling (DEV builds)
- LogBox is disabled (its shadows crash react-native-macos); console errors/warnings go to
  `$NETNYAHOO_DATA_DIR/dev-console.log`.
- lib/devHarness.ts runs `$NETNYAHOO_DATA_DIR/dev-eval.js` against the store — use it to drive a running instance.
- Menus per instance: scratchpad `axmenus` tool (System Events confuses instances sharing a bundle id).
- Swipes (layout/SwipeOverlay, layout/ProfileSwipe, packages/nncore/ios/NNSwipe.mm): `globalThis.nnSwipe.pane(tabId).devSimulate(steps, { ignorePreference: true })`
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
  - The engine boundary is packages/nncore `WebView`. Loading maps `netnyahoo://` → `chrome://`
    (`url` prop, `loadUrl`). Reporting maps `chrome://` → `netnyahoo://` (navigation, open-window,
    popup, load-error, download and discard events, `navigationEntries`).
  - Pages linking to `netnyahoo://`: the engine (`nn_page_channel.h`) only follows these from a WebUI page (chrome://,
    devtools://) and drops them from web pages, like Chrome does for chrome://. That covers links,
    ⌘-clicks and popups.
  - Display: `urlForDisplay` / `displayUrl` / `breadcrumb` show `netnyahoo://version`, keeping the
    scheme and dropping a root "/". `tabLabel` (window title) and `hostLabel` (History / Bookmarks
    pages) show `netnyahoo://<host>`.
  - History is Chrome's, which doesn't record its WebUI pages (`netnyahoo://`).
- **Where each host goes** (`appUrlRoute`):

  | URL | Opens |
  | --- | --- |
  | `netnyahoo://history`, `bookmarks`, `downloads` | Our React pages in the tab (components/pages). They take precedence over Chrome's pages, and `chrome://history` typed or reported lands here too. |
  | `netnyahoo://settings` | Our Settings window (components/pages/appUrls.ts). The tab doesn't change. |
  | `netnyahoo://settings/<pane>` | Our Settings window at that pane: general, profiles (also `people`, `manageProfile`), sync (also `syncSetup`), tabs, appearance, privacy, passwords, autofill (also `addresses`, `payments`), extensions, search (also `searchEngines`), shortcuts, liveFolders, calendar, advanced. |
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

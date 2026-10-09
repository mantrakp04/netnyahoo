# Netnyahoo architecture review

Reviewed at `b885f89c` (main, 2026-10-01). Read-only: nothing in the repo was edited or committed.

**What the numbers cover.** Git history before 2026-09-25 is squashed into three commits (78k lines in `969d2af7`), so
commit counts only cover the last week: 345 commits, 215 of them app or engine code. Older fights are recorded in
`docs/research/*.md` and `docs/migration-status.md`, and I used those too. "Fix-like" means the commit subject reads
as a fix ("no longer", "again", "crash", "stale", "fix"…). That is a rough proxy.

**In short.** Most of our fighting is with CEF, not with Chrome.
- 42% of last week's app and engine commits, and 56% of its fixes, touched the CEF/Chrome seam.
- 77% of our engine patch lines exist only to tunnel Chrome objects through CEF's API.
- We rebuilt the window layer twice in two weeks.

The plan:
- **Now:** fix the tab-state authority, stop keeping copies of data Chrome already stores, and delete the
  compatibility matrix.
- **Next:** write new engine code as plain Chromium code (`chrome/browser/netnyahoo/`) instead of CEF API.
- **Then:** spike, and if the spike passes, replace CEF with a thin Chromium layer of our own, as Dia does with
  ArcCore.
- **Keep React Native**, but trim it.

---

## The recommendations, in priority order

### 1. One writer per fact: Chrome commits live-tab state, the store owns the workspace, commands carry ids (now, inside CEF)

**What.** Split the tab model in two, and give each fact exactly one writer.
- **Workspace facts. The store owns them** (already Node-tested): sidebar entries and their order, pinned tiles,
  unloaded tiles and parked pins, groups, splits, Small Yahu, "load when shown" tabs.
- **Live-tab facts. Chrome's `TabStripModel` owns them**: which `WebContents` exist in which Browser, their order
  in Chrome's strip, which one is active.
- **How they talk.**
  - JS never writes a live fact directly. It sends a command with an id (`activate(tab, cmd: 41)`,
    `place(tab, index, pinned, cmd: 42)`).
  - Native commits it in Chrome and emits one ordered, revisioned transaction per change:
    `{rev, cmd?, browser, tabs:[{id, index, active, pinned, group?}]}`.
  - The store applies every transaction: its own commands come back with their `cmd`, Chrome's own changes (an
    extension, a close picking the next tab) come back without one.
- **No more echo guessing.** No echo windows, no "was that us?" flags. A late report can't switch back, because
  revisions order the transactions.

**Why.** Today the authority runs both ways, and JS guesses.
- The store pushes (`lib/chromeTabs.ts` `syncStrips` → `setTabStrip`), Chrome reports after the fact
  (`OnTabStripChanged`, `cef-chrome-tabs.patch:724`), and JS filters echoes:
  - `lib/tabStripEcho.ts` (56 lines plus 81 lines of tests): a 1-second echo window, plus `activated`/`byApp` flags.
  - `chromeTabs.ts`: `placed`, `lastPlacedAt` and its own `ECHO_MS`.
  - Native: `host::ActivatingTab` and `PickedByClose`.
- That produced the activation ping-pong. Commit `5922d0d2` measured 230 window updates for 20 opened tabs, and
  `c6db670e` reproduced 46–75 switches for 12 opens. It took three follow-up fixes (`1018bfb9`, `258be823`,
  `23b9a24d`).
- 41 commits in a week touched the files that do this mirroring, and 12 of them were fix-like.
- `chromeTabs.ts:106` ignores the reported `index`, and the callback carries no group, so extension
  `chrome.tabs.move` and `chrome.tabGroups` can't update the sidebar. That is a known gap
  (`docs/migration-status.md`).

**Why Chrome commits, rather than asking the app first** (my first draft had it the other way; Codex corrected it).
- Chromium's extension functions mutate the tab strip and read back the result in the same call.
  `tabs.update({active})` returns the activated tab.
- Turning those mutations into async requests to JS would change their completion semantics in many callers, not
  just add a hook.
- Committing natively and reporting a revisioned transaction keeps Chrome's synchronous contracts and still removes
  every timing guess.
- Dia's API points the same way: the app owns the workspace, and tab groups made by extensions call back into
  Swift (`ArcBrowserDelegate createTabGroupWithSessionIds:`). The header names don't show who commits first,
  though.

**Why not make `TabStripModel` the whole source of truth.**
- It needs a live `WebContents` for every tab, and our workspace has tabs without one.
- Our product rules aren't Chrome's: `store/openers.ts` puts split rows contiguous, places a pinned tile's children,
  and skips collapsed or unloaded tabs when picking a successor.
- So the workspace stays in the store, and only the live projection is Chrome's.

**What it deletes.**
- `lib/tabStripEcho.ts` and its test.
- The echo bookkeeping in `chromeTabs.ts` (about 60 of its 125 lines).
- The `activated`/`byApp` plumbing in `NNClient.mm`, `NNWindowHost.mm` and `WebView.tsx`.
- `ActivatingTab` and `PickedByClose`.
- Bug classes gone: switch-back, ping-pong, lost extension moves and groups.
- What stays: background-tab focus suppression (`NNClient.mm:1325`). It is product policy (opening a link behind
  must not take focus), not echo avoidance.

**Effort and risk.**
- Effort: a native transaction emitter, plus a small `cef-chrome-tabs` change so the observer reports index, group
  and a monotonically increasing revision; about 200 lines native and 200 lines JS. 2–4 days.
- The contract carries over unchanged to recommendation 5.
- Risk: medium-low.

### 2. Stop storing what Chrome already stores; keep our UI over Chrome's data

**Status (2026-10-01): done** for history, closed tabs, favicons and bookmarks (`b79cb1c5`, `5e385337`, `7263d37a`;
`docs/store-api.md`, `docs/sync.md`); zoom is with rec. 4. Chrome's services are reached through
`//chrome/browser/netnyahoo` (`nn_history_*`, `nn_favicons_*`, `nn_tab_restore_*`, `nn_bookmarks_*`), so NNCore
calls the same code. history.json and bookmarks.json move into Chrome once; bookmarks synced before keep their old
ids as sync keys, so Macs on either version share one tree.

**What.** Chrome's own services already run underneath us and record the same data. Read from them instead of
keeping parallel JSON copies:

| Data | Ours today | Chrome's copy, running anyway | Move to |
|---|---|---|---|
| History | `store/history.ts` (5k entries × 50 visits, a 1.8 MB JSON file rewritten whole on each change, `lib/persist.ts`), recorded from a React component (`ContentCard.tsx:362`) | `HistoryService` records every visit (nothing disables it). Deleting one entry (`removeHistory`) doesn't remove it there. `chrome.history` disagrees with our History page. | `HistoryService` (query / delete) |
| Closed tabs | `closedTabs` in `session.json` (URL only), plus an in-memory map of back/forward state (`NNBrowserView.mm:80-102`), lost on quit | `TabRestoreService` writes `Sessions/Tabs_*` with full navigation state | `TabRestoreService` (⇧⌘T, History › Recently Closed) |
| Favicons | `lib/favicons.ts` (388 lines), `favicons-<profile>.json`, a PNG folder, and part of `NNBrowsingData.mm` | `FaviconService` database | `FaviconService`; keep our light/dark pick as a thin layer |
| Zoom | `tab.zoom` in `session.json`, pushed back on restore (`persist.ts:249`) | `HostZoomMap` is already the source of truth | `HostZoomMap` only |
| Bookmarks | `store/bookmarks.ts` and our JSON | `BookmarkModel` loads empty, so extensions' `chrome.bookmarks` returns nothing | `BookmarkModel` with our UI and sync on top (needs the profile-roots mapping) |

Keep what's ours on purpose:
- the omnibox ranking and UI (`packages/core`), but feed it Chrome's history and bookmarks;
- the tab sleep *policy* (`lib/tabLifecycle.ts`), though it should drive Chrome's discard and stop running beside
  Chrome's own memory-pressure discarding (two discard policies run today);
- Translate on Apple's models;
- Sync (Chrome Sync needs Google);
- Import (Chrome's importer can't read Arc or Dia), but have it write into Chrome's stores.

**Why.**
- The data is stored two or three times (history, closed tabs and favicons twice or three times each), and the
  copies drift: extensions see different history and bookmarks from our UI.
- `persist.ts` rewrites a 1.8 MB file. Perf commits this week (`b494d56c`, `f136fe83`, `21e4a7c6`, `f2d69298`) went
  to making our copies cheaper, work Chrome's SQLite stores don't need.

**What it deletes.**
- About 900–1,300 lines: the history/closed-tab/favicon/zoom halves of `persist.ts`, `store/history.ts`, most of
  `lib/favicons.ts`, the closed-tab state map in `NNBrowserView.mm`, `tab.zoom`, the JSON migrations, and the
  favicon/history perf code.
- Bug classes gone: drift between our data and extensions' view of it, data lost on quit (closed tabs' history),
  and JS-thread stalls on saves.

**Effort and risk.**
- Effort: inside CEF, each of these needs engine API, because CEF exposes none of these services. That is about
  300–600 patch lines through CEF's translator, or one new `chrome/browser/netnyahoo/` file per service exported as
  C (recommendation 4). About a week. In the fork (recommendation 5) these are direct calls.
- Risk: medium. Sync's adapters key off store ids (`bm:<id>`), so bookmarks are the hard one: do history, closed
  tabs, favicons and zoom first.

### 3. Delete the compatibility matrix (quick win, 1–2 days)

**Status (2026-10-01): done**, except publishing the engine archive. The handshake is `NATIVE_API_VERSION`
(`apps/browser/src/nativeApi.tsx`) against `apiVersion` (`AppModule.swift`); the engine is pinned in
`packages/cef/engine.lock` (`docs/engine-build.md` › "The pinned engine"), and its release asset waits for the
owner's go-ahead.

**What.**
1. Drop the stock-CEF build. Remove `NN_CHROME_TABS=0`, its 24 `#if NN_CHROME_TABS` blocks and 9 `#else` branches
   (`NNBrowserView.mm`, `NNWindowHost.mm`, `NNCef.mm`), and `CEF_PREBUILT=1` in `setup.sh`.
2. Make every `CEF_NN_*` marker mandatory: one `#error` if `cef_netnyahoo.h` is missing, then delete the 14
   `NN_*` feature macros in `NNCefInternal.h` and their `#if`s.
3. Stop JS from supporting older native builds:
   - delete the timed fallback in `tabStripEcho.ts` ("Older native builds say neither");
   - delete the "older distribution" path in `NNClient.mm:970`;
   - check which `requireOptionalNativeModule` guards (13 sites) exist only to tolerate skew, and remove those.
4. Remove the cause of the skew with a JS/native API version handshake: native exports `apiVersion`, and the JS
   bundle refuses to start against a different one, with a clear log line.
   - For agents, an embedded bundle per build is the stronger fix.
   - A separate Metro port per agent wouldn't help (Codex): every Metro serves the same shared working tree.
5. Before deleting the stock path, publish the pinned engine distribution as a private artifact that `setup.sh`
   fetches, so a fresh checkout still builds.

**Why.** The engine ships inside the app, so production never mixes versions. The skew exists only because one
shared Metro instance serves today's JS to every agent's older native build (`docs/agent-brief.md`). That forces
compat branches in JS (`258be823` was a fix *only* for older engines), and the stock path is a second engine nobody
ships. The prebuilt path's gap list (`docs/migration-status.md` › Known gaps) shows what it no longer supports.

**What it deletes.** About 400–600 lines of `#if`/`#else` and fallback JS, a class of "works on my build" bugs, and
one of the reasons for the shared-Metro rule in the agent brief.

**Risk.** Low, once step 5 is in place. Do the handshake (step 4) first, then delete.

### 4. Stop extending CEF's API: put new engine code in `chrome/browser/netnyahoo/` and export plain C/ObjC

**What.** New engine work goes into new files under `chrome/browser/netnyahoo/` (or `libcef/browser/netnyahoo/`).
Those files get direct access to `Browser`, `TabStripModel`, `HistoryService`, `PasswordStoreInterface`,
`autofill::PersonalDataManager`, `ExtensionService`, `HostZoomMap` and `TemplateURLService`. They are exported as a
small C or ObjC surface, looked up the way `cef-zzz-open-url-params.patch` already does (`dlsym`, outside CEF's
translator). Start by replacing the hidden-WebUI scripting.

**Why.**
- About 3,400 of our 4,400 added patch lines (77%) are in CEF's own layer: `include/`, `libcef/`, `translator.py`.
  They exist to pass Chrome objects through CEF's C API: `cef-chrome-tabs` (+1,021), `cef-ui-surfaces` (+1,050),
  `cef-tab-state` (+521). Every new capability costs a header, a translator run, a wrapper and a marker.
- Where CEF has no API, we drive Chrome's private WebUI pages with DevTools `Runtime.evaluate`:
  - passwords: `chrome://password-manager/`, `passwordsPrivate`;
  - autofill: `chrome://settings/`, `autofillPrivate`;
  - extensions: `chrome://extensions/`, `developerPrivate`;
  - zoom removal and search engines: `chrome.send` from `chrome://settings/`.
- That is `NNChromePages.mm` (471 lines), `NNPasswords.mm` (138), `NNAutofill.mm` (173), `NNExtensions.mm` (304),
  `NNZoom.mm` (219) and `NNSearchEngines.mm` (28).
- It needed a Chromium patch only so the hidden page could uninstall without a dialog
  (`chromium-zz-extensions-page-uninstall.patch`).
- Those page APIs are private and change with Chromium releases. Every Chromium upgrade risks breaking settings
  silently.

**What it deletes.**
- `NNChromePages.mm`, plus the page-scripting halves of the five wrappers: about 1,000 lines.
- `chromium-zz-extensions-page-uninstall.patch` and `cef-zz-quiet-uninstall.patch`.
- Bug classes gone: settings that silently break on a Chromium upgrade, and timeouts in the hidden page.
- It is also the first step of recommendation 5: the code written here is the fork's API layer.

**Effort and risk.**
- Effort: 3–5 days for the five services. The first one sets up the BUILD.gn hook and an `nn_engine.h` header that
  `setup.sh` copies.
- Risk: low to medium. Code in the Chromium tree has to follow Chromium's threading rules, and Chromium's own types
  make it easier to get right than page scripting.

### 5. Big bet: replace CEF with a thin Chromium layer of our own (ArcCore-style "NNCore"), as a strangler, not a rewrite

**What.**
- Build Chromium's `//chrome` (with ungoogled, as now) plus our own `netnyahoo/browser/**` layer into
  `NNCore.framework`. The app links it, as Dia links `ArcCore`.
- Our layer provides:
  - its own `BrowserWindow` implementation, a plain object with no `BrowserView` and no Views frame (Dia's
    `arc/browser/ui/window.cc`). Several `Browser`s (one per profile) attach to the *same* `NSWindow`, and the tab's
    `WebContentsViewCocoa` goes straight into our view tree;
  - implementations of the `chrome/browser/ui` seams we care about, as Dia's 45 `arc/browser/ui/*.cc` files do:
    `browser_dialogs`, `permission_prompt_impl`, `extension_install_prompt`, `password_dialog_prompts`,
    `extensions_container`, `location_bar`, and so on. Everything else keeps Chrome's Views bubbles, which already
    work as child windows;
  - the live-tab transaction contract from recommendation 1, unchanged;
  - Chromium owning the main run loop (`ChromeMain` / `MessagePumpNSApplication`), with our AppKit/RN UI running
    inside it, as Dia's Swift UI does.
- The JS API in `packages/cef/src` (`WebView`, modules) stays. Only its native implementation is swapped.

**Why.** CEF forces three structural fights that patches can only paper over:
1. **Windows.** A Chrome-style CEF browser *is* a Views widget window.
   - We patched our way into Chrome's window: `cef-zwindow-*` (5 patches) and `chromium-window-hosted`. Our RN root
     sits inside `BridgedContentView` behind a `netnyahooEmbeddedView` hit-test override.
   - Profiles force one Chrome window per profile, and paging moves the RN root between windows (`MoveRoot`: 15–25
     ms of main thread per switch). Full screen with two profiles needs an auxiliary child-window trick.
   - Profile paging alone is about 4,600 lines: `NNSwipe.mm` 924, `SwipeModule.swift` 594, `NNChromeWindow.mm` 716,
     `profilePager.ts` 555, `SwipeOverlay`/`ProfileSwipe`/`swipe.tsx` 563, and 1,914 lines of test scripts. Plus
     four research docs, and 16 commits this week.
   - The window-hosting files (`NNWindowHost.mm`, `NNChromeWindow.mm`) are the two most-churned native files: 21 and
     16 commits, 1,812 and 1,158 lines churned.
2. **Tab creation.** Chrome creates tabs itself (`window.open`, links with a disposition, extensions,
   `chrome.windows.create`). CEF hands each one to us as a callback we must intercept, which leads to:
   - `OnBeforePopup` / `OnOpenURLFromTab` → emit to JS → the store makes a tab → the RN view adopts the browser by
     `adoptId` (`NNClient.mm:722-830`, a 30 s orphan timer);
   - a `StrayWindowClient` that hides and closes windows Chrome made on its own and replays their URL
     (`NNWindowHost.mm:742`);
   - a `TabRouter` with 13 handler interfaces (`NNWindowHost.mm:65`);
   - and CEF dropping `OpenURLParams`, so POST bodies were lost until `cef-zzz-open-url-params.patch` (173 lines,
     with 4 follow-ups: `025ec948`, `94c5da42`, `bb8f0d70`, `b5395b1c`).
   - With our own `BrowserWindow`/`BrowserDelegate`, `Browser::AddNewContents` hands us the already-created,
     already-navigated `WebContents` (POST included). We insert it into our model, and nothing needs adopting.
3. **The run loop.** `external_message_pump` needed `cef-zidle-pump` (autofill ignored clicks) and
   `cef-zzz-pump-wake` (a 30 Hz idle poll, 41 → 15 wakeups/s). Chromium owning the loop has neither problem.

**What it deletes.**
- About 3,700 of the 4,400 patch lines (84%; table in § C): every CEF-layer patch, and the Chromium patches that
  exist only because of CEF's window model.
- `libcef_dll_wrapper`, `make_distrib` / `06-distrib.sh`, most of `setup.sh` / `embed.sh`, the `CEF_NN_*` marker
  matrix, and the 534 MB vendored CEF copy.
- In `packages/cef/ios` (13.8k lines), I estimate 6–8k lines go: `NNChromeWindow` (716), most of `NNWindowHost`
  (1,063), `NNPopupWindow`, the CEF handler plumbing in `NNClient` (1,430, of which ~60% is CEF handler routing),
  `NNChromePages` (471) and the DevTools-protocol plumbing behind it, the pump in `NNCef.mm`, and much of `NNSwipe`
  once profiles are views in one window.
- It adds about 6–9k lines of Chromium-side C++/ObjC++ (`BrowserWindow`, about 20 UI seams, the ObjC API, process
  bootstrap and renderer-side page-script injection that CEF gives us today).
- The net code change is modest. The win is that whole categories go away: ghost and hosted windows, adoption,
  lost navigation params, pump, per-profile window swaps, and translator plumbing.

**Effort and risk.**
- Effort, conventional:
  - 6–10 engineer-weeks for a usable prototype;
  - **12–20+ for today's parity and release readiness** (Codex's estimate, which I adopt). Confidence is low until
    the spike is done.
- At this repo's measured pace (the Chrome-hosted-window flip was planned at "5–7 weeks" and shipped in about 2
  days, 0.1.6 → 0.2.0), divide by roughly 4–6. Engine work can't be split across agents as easily as UI work, so
  don't divide by more.
- The bottleneck is serial Chromium builds under one lock: new GN targets, linking `//chrome` into a framework, and
  occasional 5-hour rebuilds when GN args change.
- Risk: high.
  - Build integration: a gn-built framework consumed by Xcode, helper apps, code signing and notarization of a
    `//chrome` framework.
  - `BrowserWindow` is a large interface that moves every milestone.
  - The renderer-side features CEF gives us (process messages, page script) need replacements.
- Stage it so each step ships:
  - (a) recommendations 1 and 4 first; their code is reused as-is;
  - (b) a spike: `NNCore.framework` from `//chrome` + one `BrowserWindow` that hosts one tab in a plain `NSWindow`,
    in a standalone test app (the `packages/cef/patches/test/nativehost.mm` pattern);
  - (c) swap `packages/cef/ios` behind the unchanged JS API, one window type at a time (Small Yahu first: one tab,
    one profile).
- Go/no-go after (b). The spike must show:
  - a signed, RN-linked Chromium framework;
  - two profiles in one `NSWindow`, with correct `chrome.windows` identity, current-window and focus;
  - popups owned by the right window;
  - autofill and WebAuthn sheets that anchor;
  - docked DevTools;
  - one practice rebase.
- Duties that survive the fork (Codex): window geometry and activation for Chrome (today in
  `NNWindowHost.mm:458`), dialog ownership per profile, fullscreen and restoration. The `adoptId` mechanism goes, but
  a popup's lifecycle (who owns it, when it closes) is still ours to manage.

### 6. Keep React Native; cut its cost instead of rewriting (ongoing)

**What.**
1. Move the remaining JS-driven animations to the native driver or Core Animation (86 `useNativeDriver: false`
   against 4 `true`), starting with the toolbar, top tab strip, sidebar groups and `LiveFolderBlock`'s endless
   spinners.
2. Coalesce engine events natively: one `navigation` event per frame per tab, carrying title, url, loading, security,
   theme and favicon. Today `EmitNavigation` sends a full 7-field dictionary 4–6+ times per load with no dedup, and
   `progress` isn't throttled (`NNClient.mm:676`).
3. Keep one `netnyahoo://` ↔ `chrome://` mapping. It exists three times today (`core/appUrls.ts`, a regex copy in
   `WebView.tsx:260`, `NNClient.mm:244`): keep the core one and have native ask it once at startup, or move it
   native.
4. Move side effects out of components: `recordVisit` from `ContentCard.tsx` into the engine event handler (or
   delete it with recommendation 2).
5. Don't migrate to the New Architecture on react-native-macos now. Fabric on macOS is still partial, and the 12
   known workarounds (LogBox, Fusebox, `atexit _exit`, `RCTView` layer resets, `setFrameSize` ×15…) would all need
   re-validating.

**Why not SwiftUI/AppKit now.**
- RN's real cost is about 75 pods, a 3.6 MB Hermes bundle, about 12 workarounds, and a JS hop per browser event.
  It isn't a fight with Chrome: none of the Chrome fights above come from RN.
- Hot paths have been moving native one at a time (the pager in `087fe86a`/`40afc694`, inline completion, menus,
  materials). RN is now mostly layout and state over 17 native view types (`Symbol` used 152 times, `Surface` 50,
  `ContextMenuArea` 25).
- A rewrite means porting about 21k lines of TSX and 17k lines of store and logic to Swift. It would lose the
  dev-eval harness, Fast Refresh and the Node-tested store that the agent workflow leans on (7k lines of tests run
  in Node). And 304 ✅ parity rows would have to be re-earned.

**Revisit when** recommendation 5 is done, the engine API is ObjC, and a native UI could talk to it directly.
Even then, a gradual move (new surfaces in AppKit, RN kept for the sidebar and settings) beats a big-bang port.

**Effort and risk.** Items 1–4: about 1 week, low risk.

### 7. Engine patch hygiene: new files plus small hooks, one concern per patch, a rebase check (at the next Chromium bump)

**What.**
- Rewrite `chromium-zz-pip-dia-controls.patch` (1,012 lines; +484/-71 across 13 files of
  `VideoOverlayWindowViews`) as a new `NetnyahooVideoOverlayWindow` class in new files, with a ~20-line hook where
  Chrome makes its overlay window.
- Do the same for any patch over ~100 lines that edits Chrome's own files.
- Name patches by concern and order them in a `series` file, instead of encoding order in name prefixes (`zz-`,
  `zzz-`). `cef-zzz-open-url-params.patch` once carried another patch's marker (`b5395b1c`).
- Add a nightly "apply the series to a clean tree" check, plus a script that exports each patch from a git branch
  per concern in `~/chromium-build`.

**Why.** Rebasing to Chromium 155+ is a cost per patch hunk inside Chrome's files. New files rarely conflict.
Codex would put this behind correctness work, and I agree: do it as part of the first rebase, not before.

**Effort and risk.** 2–3 days. Low risk.

### 8. Split the god files along the seams that matter (ongoing, mostly falls out of 1, 4 and 5)

- `NNClient.mm` (1,430 lines, 31 commits this week, the most-touched native file) implements 11 CEF handler
  interfaces in one class: popups, media/PiP, context menus, keys, downloads, permissions, find, app links. Split it
  by handler (`NNClient+Popups.mm`, `+Media`, `+ContextMenu`, `+Keys`). Most of this disappears in recommendation 5.
- `CefModule.swift` defines 94 functions. Split it into per-domain modules, as `ExtensionsModule` and
  `ChromeUIModule` already are.
- Shortcuts are defined in `Menus.swift` (102 items) and dispatched in `commands.ts`, and `NNClient.mm` keeps its
  own tables (`IsReservedShortcut`, `IsChromeShortcutCommand`, `MenuBarTakesChromeShortcut`). Generate the native
  table from one JSON list.

---

## A. Where the fights with Chrome are (numbers)

Last week, excluding the three squashed commits:
- 215 app or engine commits; **91 (42%) touched the CEF/Chrome seam** (`packages/cef/**`, `chromeTabs`,
  `tabStripEcho`, `openers`, `ChromeWindows.swift`).
- 62 of the 215 were fix-like; **35 (56%) of those were seam commits.**
- Fix rate on seam commits: 38%. On everything else: 22%.
- Fix-like share by area: `cef-native` 43% (32 of 73), `cef-js` 50% (11 of 22), `store` 42% (17 of 40),
  `components` 29%, `shell-native` 18%.

Per fight (commits touching the topic's own files; lines added and deleted in those files only):

| Fight | Commits | Lines churned | Fix-like | Code it lives in today |
|---|---|---|---|---|
| Chrome window hosting (ghost → `client_window`) | 34 | 4,272 | 7 | `NNWindowHost.mm` 1,063, `NNChromeWindow.mm` 716, `NNPopupWindow.mm` 125, `ChromeWindows.swift` 104, 6 patches (~330 lines) |
| Tab mirroring (store ↔ `TabStripModel`) | 41 | 3,156 | 12 | `chromeTabs.ts` 125, `tabStripEcho.ts` 56, `openers.ts` 98, `windows.ts`/`tabs.ts` 841, `cef-chrome-tabs`/`cef-tab-state` patches |
| Profile swipe / paging (one Chrome window per profile) | 16 | 4,658 | 5 | ~2,900 lines of code + 1,914 lines of test scripts + 4 research docs |
| PiP / mini player | 12 | 2,294 | 2 | `NNPictureInPicture.mm` 653, PiP patches 1,043 |
| Extensions, popups, side panels, blocker | 20 | 1,263 | 9 | `NNExtensions*` 486, `components/extensions` 1,288, `NNContentBlocker` 389 |
| Keys / shortcuts in Chrome's window | 15 | 1,010 | 3 | `cef-zwindow-keys`, `Menus.swift`, `NNClient` key tables |
| Popups / OpenURL params / POST | 6 | 654 | 4 | `cef-zzz-open-url-params.patch`, `NNClient.mm` popup path, `openers.ts` |
| DevTools docking | 8 | 641 | 2 | 4 patches (~150 lines), `NNDevTools.mm` 292 |
| Message pump | 2 | 141 | 0 | 2 patches, `NNCef.mm` `MessagePump` |
| Focus stealing (test instances) | 5 | 176 | 2 | `NNActivation.mm` 241 (swizzles `activateWithOptions:`, `unhide:`, `setActivationPolicy:`) |

Before 2026-09-25, according to the docs:
- the ghost-window era: alpha-0 Chrome windows kept behind ours, lifted for dialogs; keycode tables for Chrome's
  shortcuts; a context-menu fallback patch;
- the Alloy era (`docs/research/chromium-ui-layer.md`, about 7,500 lines deleted when it ended);
- the flip to Chrome-hosted windows: 854 lines out, 631 in.

So we have rebuilt the window layer twice in about two weeks. Both rebuilds fought the same thing: CEF decides what a
browser window is.

## B. Source of truth: the options

| Option | What it means | Verdict |
|---|---|---|
| **TabStripModel as truth, store as view** | Observe `TabStripModelObserver`, render from it | **No.** No `WebContents`-less tabs (unloaded pins, load-when-shown, parked pins), one Browser per profile per window, and groups/splits would need Chrome's models to fit Dia's semantics. It would also delete our Node-tested store logic (pinned close, parked pins, groups). |
| **Split ownership: the store owns the workspace, Chrome owns live tabs** (rec. 1) | JS commands with ids → Chrome commits → revisioned transactions back | **Yes, now.** Keeps Chrome's synchronous extension contracts. Dia's app also owns its workspace (`ArcBrowserDelegate` calls back for tab groups). |
| **Alloy-style** (no Chrome `Browser`) | Pre-0.1 architecture | **No.** It loses everything a real `Browser` gives us: `chrome.tabs`/`windows` for extensions, password and autofill filling, permission and passkey UI, Cast, side panels. The `NN_CHROME_TABS=0` gap list shows the cost. |
| **Chrome UI layer with our own `BrowserWindow`** (rec. 5) | Dia/ArcCore: `//chrome` services, our window, no `BrowserView` | **The end-state.** It removes the window, adoption and pump fights at the root. |
| **OWL-style out-of-process host** | ChatGPT Atlas | **No.** It needs everything rec. 5 needs plus input, IME and accessibility re-plumbing (`chromium-ui-layer.md` prototype). The only gain is crash isolation. |
| **Native UI (SwiftUI/AppKit) instead of RN** | Rewrite the chrome UI | **Not now** (rec. 6). It doesn't touch any Chrome fight. |

**What Dia does** (read-only look at `/Applications/Dia.app`, 1.50.1; no user data touched):
- **Engine.** `Dia` links `ArcCore.framework` (329 MB, compat version 8037.0.58: the same Chromium 154 branch as
  ours).
- **ObjC API.** It exports 146 `Arc*` ObjC classes and ships 205 public headers under
  `Headers/arc/browser/objcpp/`.
- **Arc's own Chromium layer.** 108 `arc/` source paths, including `arc/browser/browser_impl.cc`,
  `arc/browser/ui/window.cc` and 45 `arc/browser/ui/*.cc` seam implementations: `browser_dialogs`,
  `permission_prompt_impl`, `extension_install_prompt`, `password_dialog_prompts`, `location_bar`,
  `autofill_popup_view`, `side_panel_ui`, `views/overlay/video_pip_coordinator_impl`.
- **No Browser frame.** It compiles `chrome/browser/ui/browser.cc` and `tabs/tab_strip_model.cc`, but no
  `views/frame/browser_view.cc`.
- **Chrome's services, exposed to Swift.** `ArcBrowserContextHistory`, `ArcBrowserContextAutocomplete`
  (`-[ArcBrowser autocomplete:…]`: Chrome's AutocompleteController with their own ranking on top),
  `ArcBrowserContextDownloads`, `ArcBrowserContextExtensions`, `ArcBrowserContextPreferences`, `ArcSessionTab` /
  `ArcSessionWindow` and `restoreForeignTab:`.
- **App stack.** Swift, SwiftUI and AppKit, with `GRDB` (SQLite) for their own model, plus Lottie and Sparkle. No
  React Native.

## C. Engine patch inventory

Added lines are counted as `+` lines in the patch. "Fork" is what happens to each patch under recommendation 5.

| Patch | +/- | Files | Purpose | Kind | Fork |
|---|---|---|---|---|---|
| `cef-chrome-tabs` | +1021/-10 | 29 | Hosting API, `CreateTabInBrowser`, `SetTabIndex`, `OnTabStripChanged`, component extensions… | CEF API plumbing | Gone (direct calls) |
| `cef-ui-surfaces` | +1050/-15 | 10 | Device choosers, Cast dialog, side panels, action state handed to the client | CEF API plumbing | Gone → our UI seam files |
| `cef-tab-state` | +521/-5 | 13 | Restore/duplicate/discard/BrowsingDataRemover via CEF | CEF API plumbing | Gone |
| `cef-zzz-open-url-params` | +173 | 3 | CEF dropped `OpenURLParams` (POST) | CEF limitation | Gone |
| `cef-ui-triggers` | +158 | 6 | Show autofill suggestions at the focused field | CEF API plumbing | Gone |
| `cef-zwindow-client` | +112/-1 | 10 | Chrome window is the app window | Fighting CEF's window model | Gone |
| `cef-zwindow-z-devtools` | +102 | 8 | Docked DevTools in client windows | Fighting CEF's window model | Gone/smaller |
| `cef-tab-capture` | +101/-7 | 2 | Tab capture source id | CEF API plumbing | Gone |
| `cef-zz-media-source` | +58/-9 | 3 | Desktop source; permission went to the wrong tab | CEF bug + plumbing | Gone |
| `cef-zzz-pump-wake` | +37/-35 | 2 | External pump drops the next-task delay | CEF limitation | Gone |
| `cef-zwindow-keys` | +21/-1 | 2 | Chrome's reserved keys wait for the client | Fighting CEF's window model | Gone |
| `cef-zwindow-translucent` | +16 | 3 | Translucent CEF window | Fighting CEF's window model | Gone |
| `cef-zz-media-router-shutdown` | +12/-2 | 3 | Quit crash from context lifetime | CEF bug | Gone |
| `cef-zwindow-zz-devtools-toolbox` | +12/-1 | 1 | Device toolbox from docked DevTools | CEF limitation | Gone |
| `cef-zidle-pump` | +5/-1 | 1 | Idle work never ran under the external pump | CEF bug | Gone |
| `cef-zz-quiet-uninstall` | +4 | 1 | Marker | Plumbing | Gone |
| `chromium-zz-pip-dia-controls` | +484/-71 | 13 | Dia's PiP controls and motion | Our feature | **Stays**: move into new files |
| `chromium-chrome-ui-hooks` | +86/-1 | 4 | Device chooser, Cast and side panel ask the client | Hooks | Becomes our seam implementation |
| `chromium-neterror-yahu` | +71/-2 | 5 | Big Yahu offline page | Our feature | Stays |
| `chromium-webview-native-hosted` | +62/-1 | 4 | `views::WebView` must not attach our tabs | Fighting `BrowserView` | Gone (no `BrowserView`) |
| `chromium-window-hosted` | +55 | 5 | RN root inside `BridgedContentView`; Browser survives with no tabs | Fighting CEF's window model | Gone |
| `chromium-zz-extension-installed-bubble` | +44 | 3 | "Added" bubble without a toolbar | No toolbar | Our `ExtensionsContainer` |
| `chromium-window-docked-devtools` | +34/-1 | 4 | DevTools dock in a CEF window | CEF window model | Smaller |
| `chromium-password-generation-local` | +26/-11 | 2 | Strong passwords without sync | Behaviour | Stays |
| `chromium-browser-view-hosted-fullscreen` | +23 | 1 | Tab fullscreen without the Browser window | Fighting `BrowserView` | Gone |
| `chromium-devtools-redock-display` | +22 | 3 | RWHV back to Cocoa drawing after undock | Fighting `views::WebView` | Gone |
| `chromium-passkeys` | +19/-2 | 3 | Bundle/team id, keychain item | Branding | Stays |
| `chromium-extension-install-prompt-hook` | +12 | 1 | Replace the install dialog | Hook | Seam implementation |
| `chromium-password-bubble-hook` | +10 | 1 | Replace the password bubble | Hook | Seam implementation |
| `chromium-extension-window-hidden` | +10 | 1 | Hidden helper windows invisible to extensions | Hidden-window workaround | Gone |
| `chromium-autofill-card-touchbar` | +10/-2 | 1 | Crash in CEF Views-hosted windows | CEF window model | Gone |
| `chromium-zz-extensions-page-uninstall` | +8/-1 | 1 | Hidden `chrome://extensions` uninstall | WebUI scripting | Gone (rec. 4) |
| `chromium-extension-updates` | +6/-2 | 2 | Undo an ungoogled early return | Ungoogled fix | Stays |
| `chromium-zz-pip-close-keeps-playing` | +6/-7 | 1 | Closing PiP doesn't pause | Behaviour | Stays |
| `chromium-ui-update-before-insert` / `tab-strip-notify-before-insert` | +11/-2 | 2 | CHECK when CEF sets the delegate early | CEF bug | Gone |
| `chromium-devtools-window-title` | +2/-1 | 1 | Dia's DevTools title | Branding | Stays |

Totals:
- 16 CEF-layer patches add +3,403 lines; 21 Chromium patches add +1,001.
- Under recommendation 5, about 3,700 added lines (84%) go away.
- About 610 lines stay as features or branding, and about 110 lines of hooks become our own seam files.

Churn: every patch except `cef-zzz-open-url-params` (4 commits) and `cef-chrome-tabs` (2) has one commit, because
the history was squashed on 09-25.

Rebase-friendliness:
- The PiP patch is the biggest in-place edit of Chrome's own UI code: 13 files of `VideoOverlayWindowViews`.
- The CEF-layer patches touch CEF's generated C API (`translator.py` re-runs). Every CEF branch bump re-translates
  them.

## D. React Native layer, in numbers

From the RN subagent's survey:
- **Code.** 38.6k lines of TS in `apps/browser/src`, 21.1k of it in components.
- **Native views.** 17 native view types: `Symbol` used 152×, `Surface` 50×, `ContextMenuArea` 25×.
- **Dependencies.** About 85 unique pods. React-Fabric pods are built although the app runs the legacy
  architecture.
- **Bundle and size.** A 3.6 MB Hermes bundle. RN's share of the 598 MB app is negligible; CEF is 534 MB.
- **Bridge events.** 33 per-tab view events and 264 native functions (94 in `CefModule.swift`). An estimated 20–50
  events per page load, with no app-side throttle on `progress` and no dedup on `navigation`.
- **Bridge cost.** JS per event fell from 2.4 to 0.8 ms with 200 tabs after this week's perf work (`d95e4932`,
  `cd78430b`). A tab switch went from 166 ms to a few ms (`d96a043b`).
- **Workarounds.** About 12 distinct react-native-macos workarounds, among them LogBox crashes, Fusebox,
  `atexit _exit(0)`, `RCTView` layer resets, 15 `setFrameSize` overrides, the TextInput selection bug, and the
  legacy-arch view-registration retry (`7591eae2`).
- **Animations.** 96 animations run on the JS thread.

Verdict: RN costs us a perf tax and quirks, but it isn't where Chrome fights come from. Its dev loop (Fast Refresh,
`dev-eval.js`, Node-tested store) is what makes the agent workflow fast. Keep it, and trim it (rec. 6).

## E. Code we shouldn't own

Based on the subagent's survey and my own reading. Note: that subagent opened the Chrome databases in the owner's
real Netnyahoo profile (read-only, `immutable=1`) to confirm Chrome's copies are populated. That breaks the
AGENTS.md rule against reading real profiles. I left the numbers it found out of this report, and every claim below
stands on the code alone.

- **Recorded twice: history, closed tabs, favicons, zoom.** These are in recommendation 2.
- **Bookmarks.** Ours. Chrome's `BookmarkModel` stays empty, so `chrome.bookmarks` is blind.
- **Downloads.** Chrome does the work; we keep our own `downloads.json` list. Chrome's download history could
  replace it with no UI loss.
- **Passwords, autofill, extensions management, zoom, search engines.** Chrome's backend, reached by scripting hidden
  WebUI pages (recommendation 4).
- **Site settings, permissions, find, content blocker (uBlock Origin Lite as an extension), PiP.** Already Chrome's,
  with our UI. Fine.
- **Tab discard.** Two policies run at once: ours (`tabLifecycle.ts`, 438 lines) and Chrome's memory-pressure
  discarding (`WebContentsDiscard`). Keep our policy (it does profile unloading and Dia-like idle rules) and turn
  Chrome's urgent discarding into input for it.
- **Omnibox.** Ours (`packages/core`, 3.1k lines, plus UI). Keep the UI and ranking. Chrome's
  `AutocompleteController` providers (HistoryQuick, Bookmarks, Shortcuts) are what Dia uses underneath; adopt them
  once the engine API allows (rec. 5).
- **Sync.** `packages/sync` (2.8k lines including tests) + `src/sync` (1.1k) + panes (~580). Chrome Sync needs
  Google, so it's justified, but freeze its scope: it is the main reason bookmarks are hard to move to Chrome.
- **Import.** `packages/import` (5.9k lines including 73 fixture files) + `components/import` (1.2k). Arc and Dia
  sources justify it. It should write into Chrome's stores, not ours.

## F. Module boundaries and maintenance

- **Biggest files.**
  - Native: `NNClient.mm` 1,430, `NNWindowHost.mm` 1,063, `NNCef.mm` 1,014, `ShellModule.swift` 930, `NNSwipe.mm`
    924, `NNBrowserView.mm` 913.
  - JS: `ImportWindow.tsx` 1,053, `TopTabStrip.tsx` 805, `organize.ts` 597, `sync/engine.ts` 566,
    `profilePager.ts` 555.
  - For a codebase this size these are acceptable. The problem is what they contain, not their size: `NNClient` and
    `NNWindowHost` mix CEF routing with product rules.
- **Cross-layer leakage.**
  - Product rules live in native code: which tab activates, popup blocking with replays, split-click detection,
    shortcut ownership tables.
  - Data side effects live in React components (`recordVisit` in `ContentCard`).
  - Logic is duplicated across languages: URL mapping three times, shortcuts twice, and window frames both in
    AppKit autosave and the store.
- **Testability.**
  - The store has good Node tests (21 `*.test.mjs` files, about 7k test lines overall).
  - The native seam has none. It is verified by hidden-instance scripts (`profile-swipe-test.mjs`,
    `shortcuts-test.mjs`, `p2.mjs`/`p3.mjs` spikes).
  - Recommendations 1 and 5 move tab-model behaviour into the Node-tested store and leave native code as a thin
    projection.
- **Build complexity.** `~/chromium-build` (ungoogled + domain substitution + our patches) → `make_distrib` →
  `setup.sh` copies 556 MB into `packages/cef/vendor` → `libcef_dll_wrapper` → CocoaPods (~85 pods) → xcodebuild →
  `embed.sh`. An engine change costs build + distrib (~3–4 min in the logs) + setup + app build, under the chromium
  lock. Recommendation 5 removes the distrib, setup and wrapper steps. Recommendation 3 removes the prebuilt branch.
- **Agent workflow pain this architecture causes.**
  - JS/native skew from the shared Metro instance (rec. 3).
  - A single chromium lock serializes all engine work, which matters more as more work moves into the engine. If
    disk allows, a second Chromium `out` directory on a separate checkout would let two engine agents work at once.
    That is the owner's call, because of the 5-hour first build and the "stay out of `~/chromium-build`" rule.
  - Hidden-instance-only verification of window behaviour. The window behaviour has the most churn and the least
    automated coverage.

## G. Roadmap

| When | Item | Lines deleted (est.) | Bug classes removed | Risk |
|---|---|---|---|---|
| **Quick wins (≤1 day each)** | Rec. 3: drop the stock-CEF path, the `NN_*` macro matrix and older-native compat in JS; one Metro per agent or an embedded bundle | 400–600 | JS/native skew, dead `#else` paths | Low |
| | Move `recordVisit` out of `ContentCard`; throttle `progress` and dedup `navigation` natively | 50–100 | JS-thread stalls during loads | Low |
| | One URL mapping (`core/appUrls`) | ~40 | Mapping drift | Low |
| | Fix `docs/research/chrome-hosted-window.md:89` (the pager is native now) | — | Stale docs | None |
| **Medium (≤1 week each)** | Rec. 1: one writer per fact, commands with ids, revisioned live-tab transactions | 300–450 | Ping-pong, switch-back, lost extension moves and groups | Medium-low |
| | Replace `external_message_pump` with `CefRunMessageLoop()` in `main.swift`. Termination must be redesigned as cefclient does it: intercept terminate, close browsers, quit the loop, `CefShutdown` after it returns. Test cancelled quits, beforeunload, downloads and modal loops. (Skip if rec. 5 is go.) | ~150 + 2 patches | Pump latency and wakeups, idle-work starvation | Medium |
| | Rec. 4: `chrome/browser/netnyahoo/` C exports; replace hidden-WebUI scripting (passwords, autofill, extensions, zoom, search engines) | ~1,000 + 2 patches | Silent settings breakage on Chromium upgrade, eval timeouts | Low-medium |
| | Rec. 2 (first half): history, closed tabs, favicons and zoom on Chrome's services | 900–1,300 | Data drift with extensions, lost closed-tab history, 1.8 MB rewrites | Medium |
| | Rec. 7 (at the next Chromium bump): PiP patch into new files; patch `series`; clean-apply check | 0 (moves ~500) | Rebase conflicts | Low |
| | Rec. 6 items 1–4: native-driver animations, event coalescing | 100–300 | JS-thread jank in animations | Low |
| **Big bets** | Rec. 2 (second half): bookmarks on `BookmarkModel` (sync adapters re-keyed) | 400–600 | Blind `chrome.bookmarks` | Medium-high |
| | Rec. 5: NNCore (ArcCore-style) replacing CEF, staged (spike → Small Yahu → main windows) | ~3,700 patch lines + 6–8k native − 6–9k new | Window hosting, ghost/hosted windows, adoption, lost OpenURLParams, pump, per-profile window swaps, translator plumbing | High |
| | Revisit native UI only after rec. 5 | — | — | — |

## H. Codex second opinion

Codex (`gpt-6.1-sol`, high effort, read-only) reviewed the draft recommendations against the code.

**Changed because of Codex:**
1. **Authority direction (rec. 1).** My draft had Chrome ask the app before every mutation. Codex pointed out that
   Chromium's extension functions mutate and read back synchronously, so deferring them changes completion semantics
   across many callers.
   - Adopted: Chrome commits live-tab facts, JS sends commands with ids, native emits revisioned transactions.
   - Also: Arc's delegate names don't prove Swift commits first. That claim is softened in the report.
2. **`store/openers.ts` stays.** It encodes product policy Chrome doesn't have (split rows, pinned-tile children,
   successors that skip collapsed or unloaded tabs). The focus suppression in `NNClient.mm:1325` stays too, as
   policy.
3. **Skew fix (rec. 3).** Per-agent Metro ports don't help, because they serve the same working tree. Use an API
   version handshake or embedded bundles, and publish the pinned engine artifact before deleting the stock path.
4. **`CefRunMessageLoop`.** Viable in principle (Chromium's AppKit pump calls `[NSApp run]`, and `NNApplication`
   already implements `CefAppProtocol`). But it needs a termination redesign: today `NNCef.mm:832` shuts down
   inside `WillTerminate`, while `Windows.swift:362` defers termination. It's a medium item, not a quick win.
5. **Fork estimate.** Raised from 12–16 to 12–20+ engineer-weeks for parity. The spike's acceptance list now
   includes signing, two profiles in one window, popup ownership, WebAuthn/autofill anchoring, docked DevTools and
   one practice rebase.
6. **Passwords.** Replacing hidden-WebUI scripting with direct `PasswordStore` calls must keep the OS reauth step
   and Chrome's credential-management behaviour, not just reads and writes.

**Where Codex and I still differ, or where I'd stress something else:**
- Codex calls a full request layer built inside CEF "wasteful" if we fork anyway. I agree. That is why rec. 1 is
  now the transaction contract: it is small and carries over unchanged.
- Codex frames the fork as "removes an awkward window arrangement but creates an embedder". I'd weigh it more
  strongly. The window arrangement isn't one awkward spot: it is the most-churned code in the repo (34 commits and
  4.3k lines churned in a week, plus about 4.6k lines for profile paging), and we've rebuilt it twice. Still, I take
  its point that most of the embedder duties stay with us.
- We agree on: keeping RN, moving history/bookmarks/favicons to Chrome's services, the brittleness of hidden-WebUI
  scripting, and prototyping the fork before committing to it.

# Dia feature parity

Dia = installed build **1.49.1 (87398), Chromium 153** plus the public changelog up to **v1.50.0 (2026‑09‑24)**;
the visual rows (WP11) were re-checked against **1.50.1 (87750)**.
Sources: the app bundle (strings, menus, Info.plist, entitlements), diabrowser.com changelog/plans/security pages, press.
Netnyahoo = this working tree as of **2026‑09‑25**, re-audited row by row against the code (CEF 154 engine,
store v2). Statuses come from reading the code, not from agents' reports; rows marked "not visually verified" were
not exercised in a running instance.

Legend — **✅** done · **🟡** partial · **❌** missing · **⛔** blocked by something outside our control (what is named in the Gap) ·
**⏸** deferred (AI), on purpose · **🚧** in progress (Chrome extensions, another agent) · **—** not applicable

A few old rows that mixed an AI half with a non-AI half are split in two, so the row count differs slightly from the
previous 285.

## Summary

**296 feature rows** (§1–§25):

| ✅ done | 🟡 partial | ❌ missing | ⛔ blocked | ⏸ deferred (AI) | 🚧 in progress | — n/a |
|---|---|---|---|---|---|---|
| 181 | 19 | 6 | 13 | 58 | 5 | 14 |

Excluding the deferred, in-progress and n/a rows, 181 of 219 are done (83%). Keyboard shortcuts: every Dia shortcut
is bound except the Chat ones (⏸) and F12. Menus: all ten exist except Extensions (🚧); Edit, View and Help are partial.

### Proposed work packages (remaining ❌ / 🟡)
Each is sized for one engineer-agent. "Owns" lists the files they'd create or change; shared files (Menus.swift,
commands.ts, settings.ts, theme.ts, App.tsx) stay small additive edits, as the agent brief says.

**WP1 · Page selection & context menu** — ✅ done (rows: Jump to Selection / Find & Replace, Selected‑text popover, Quote link, DevTools; Broken 1)
- Selected-text popover with Search (❌); wire the page menu's dead "Search … for" item to the default engine, and hide
  "Ask About Selection" until Chat exists (Broken 1).
- Quote link / "Copy Link to Highlight" with text fragments (❌).
- Edit › Find › Jump to Selection, Find & Replace for editable fields (❌).
- DevTools: F12 alias; View › Developer › View Source (`viewSource()` exists) and JavaScript Console (🟡).
- Owns: `packages/cef/ios/NNClient.mm` (context-menu section), `packages/cef/helper/page_script.js` (selection bits),
  `apps/browser/src/components/ContentCard.tsx` (`onCommand`), new `components/site/SelectionPopover.tsx`,
  `packages/shell/ios/Menus.swift` (Find + Developer items), `lib/commands.ts` (new cases).

**WP2 · Navigation gestures**
- Two-finger swipe back/forward with Dia's custom overlay, working on the NTP and internal pages too (✅ done; needs a real-trackpad check).
- Swipe between profiles (🟡: sidebar done; no neighbouring-list preview, no top-strip swipe).
- Back/forward history list as our own popover so entries can be ⌘/middle-clicked into tabs (✅ done).
- Owns: `packages/cef/ios/NNBrowserView.mm` (scroll-wheel phase tracking), new `components/layout/SwipeOverlay.tsx`,
  `components/layout/history.ts`, `components/Toolbar.tsx` (HistoryButton), `lib/actions.ts` (profile cycling hook).

**WP3 · Tab lifecycle & memory**
- ✅ Tab discarding (sleeping tabs) via `discard()` / `onDiscarded`: 10 most recent tabs protected, idle time counted in
  app-active time, eager under memory pressure; audio, capture, PiP, split, pinned mini player and unsaved input keep a tab
  awake; faded icon + "This tab needs to reload" in the hover card; a few recent tabs reload on launch (by RAM, none on battery).
  Measured with 16 real sites, 6 asleep: task-manager footprint 2469 → 2027 MB, helper RSS 3299 → 2764 MB (23 → 18 processes).
- ✅ Battery Saver: on battery / Low Power Mode, hidden tabs ≥ 10 % CPU on two samples freeze (CDP `Page.setWebLifecycleState`),
  thaw when shown; Dia's "Battery Saver Mode Activated/Deactivated" toasts; setting in Advanced. Busy tab: 25 % → 0 % CPU.
- ✅ Unload unused profiles: after 10 min unshown their tabs sleep and the engine context is released (profile's open files 88 → 0).
- ⛔ Back/forward stack on reopen / duplicate: see the ⛔ table.
- Owns: new `apps/browser/src/lib/tabLifecycle.ts`, `components/ContentCard.tsx` (mount policy), `packages/cef/ios/CefModule.swift`
  + `NNBrowserView.mm` (freeze), `store/tabs.ts`, `lib/actions.ts`.

**WP4 · Window & New Tab page polish**
- ✅ Window backdrop tint that changes with key state (dark themes; light keeps one tint until there is a Dia capture, see §6 row).
- ✅ Area light: k = 0.5 lift/tilt when the window isn't key, clock paused when not key or occluded (Dia's display-link model).
- ✅ Metal shaders honour Reduce Motion (Dia skips the New Tab entrance: no band, settled edge glow, still light).
- ✅ Warn before closing a window with multiple tabs (⇧⌘W / close button), setting in General, Dia's dialog wording.
- Owns: `packages/shaders/ios/*` (assigned owner only), `components/NewTabPage.tsx`, `App.tsx`, `lib/theme.ts`,
  `packages/shell/ios/Windows.swift`, `components/settings/panes/General.tsx`.

**WP5 · Favicons, URLs & data hygiene** — ✅ done (rows: Favicons, Punycode display, Clear browsing data; Broken 6–8)
- Local per-profile favicon cache from the engine's favicons; drop the Google s2 fallback, at least for incognito (🟡, Broken 8).
- IDN display: Unicode hosts with Chrome's spoof checks, punycode otherwise (🟡).
- Downloads carry a profile: incognito downloads stay out of other windows and out of downloads.json (Broken 8).
- One Copy URL behaviour everywhere (clean links), and the tab menu's "Add to Bookmarks…" opens the dialog instead of
  toggling (Broken 6, 7).
- Clear Browsing Data: per-visit history so ranges are exact; ranged cookie deletion by creation date (🟡).
- Owns: `packages/core/src/omnibox.ts` (+ new `idn.ts` with tests), `components/primitives.tsx` (Favicon), new
  `lib/favicons.ts`, `lib/persist.ts`, `store/ui.ts`, `store/history.ts`, `components/pages/ClearDataDialog.tsx`,
  `components/sidebar/actions.ts` + `menus.ts`, `components/omnibox/paste.ts`, the download handler in `packages/cef/ios/NNClient.mm`.

**WP6 · Autofill**
- Address and credit-card autofill with a Settings pane (❌).
- Edit › AutoFill submenu (❌).
- Suggest a strong password on sign-up forms; the engine API exists (❌).
- Eye button in the page's password fields (🟡).
- Owns: `packages/cef/helper/page_script.js` (form parts), new `packages/cef/ios/NNAutofill.mm` + `src/autofill.ts`,
  `packages/cef/ios/NNPasswords.mm`, `components/site/Prompts.tsx`, new `components/settings/panes/Autofill.tsx`,
  `Menus.swift` (Edit › AutoFill).

**WP7 · Media & permissions leftovers**
- ✅ Video PiP: stash at the screen edge, hostname bar, back to tab (done; see §18).
- ⛔ "Share this tab instead" while a page is screen-sharing: no tab capture in this engine (⛔ table).
- ✅ Location: `NSLocationWhenInUseUsageDescription`, the location entitlement, and a run up to the macOS prompt (Broken 12 fixed).
- Owns: `packages/cef/ios/NNPictureInPicture.mm`, `NNClient.mm` (media-access bits), `apps/browser/macos/Netnyahoo-macOS/Info.plist`
  + `Netnyahoo.entitlements`, `components/site/Prompts.tsx`, `components/Toolbar.tsx` (CaptureIndicator).

**WP8 · Settings & app wiring**
- General › Updates: automatic checks/downloads toggles and Check Now (APIs exist); a sounds setting if we ship UI sounds (🟡).
- Appearance › App Icon picker (APIs exist) and a Dock tile plug-in so the icon sticks when the app isn't running (🟡 ×2).
- Implement or remove "⌥⇧-click opens tab in group" (Broken 2, 🟡 Tabs pane).
- Menu state: disable page commands on internal pages (Broken 9); check the ⌘↩ clash (Broken 10).
- Help: a real feedback destination (needs a decision from the user) (🟡).
- Optional: a Raycast extension for Netnyahoo's AppleScript dictionary (🟡).
- Owns: `components/settings/panes/General.tsx`, `Appearance.tsx`, `Tabs.tsx`, `store/settings.ts`, `lib/native.ts` (menuState),
  `lib/appIntegration.ts`, `packages/shell/ios/AppIcon.swift`, a new Dock-tile plug-in target in the Xcode project.
- **Status (WP8 done):** Updates section, App Icon picker + Dock tile plug-in (a Run Script phase, "Build Dock Tile
  Plug-in", builds `packages/shell/docktile`), ⌥⇧-click, Broken 2/5/9/10/11/13 and Broken 3's trigger/state. No sounds
  setting (Dia's are AI sounds). Feedback and update destinations wait on the user (Info.plist "Distribution" block).
  Raycast extension not done (optional).

**WP9 · Onboarding & what's new** (done, see §7, §24, §25)
- ✅ Intro music with mute (original synthesized piece).
- ✅ Tool tour (coach marks); 🟡 video tour wired but hidden until a video URL exists.
- ✅ "What's new" release-notes postcard on the NTP (+ full-page notes) and the Personalize button.
- ✅ The default-browser week follow-up banner (Broken 3).
- Owns: `components/onboarding/*`, new `components/ntp/Postcard.tsx`, `components/NewTabPage.tsx` (postcard slot only), assets.

**WP10 · Profiles & sidebar extras**
- ✅ Share data between profiles (Create Profile dialog), profile reordering in Settings (drag).
- — Guest profile: Dia has none. ⏸ Workspace / companion tab: part of Chat tasks.
- ✅ Top Apps = the pinned-tab dock; command bar "Move to Top Apps" / "Unpin from Top Apps".
- ✅ Group colour: Dia went neutral by default in 1.28; Match Site Color stays manual.
- ✅ Top strip tab menu says Close Tabs to the Left/Right (Broken 13).
- ✅ Profile icons: Dia has no profile artwork; ours add SF Symbol icons on the profile colour.
- Owns: `store/profiles.ts`, `lib/actions.ts` (profile ops), `components/ProfileIndicator.tsx`, `components/settings/panes/Profiles.tsx`,
  new `components/sidebar/TopApps.tsx`, `components/Sidebar.tsx`, `components/sidebar/menus.ts`, `store/groups.ts`.

**WP11 · Dia 1.50 "Sunglow" / Liquid Glass refresh**
- ✅ Spec: `docs/dia-spec.md` › "1.50 Sunglow", from the 1.50.1 (87750) binary. Sunglow is a brand refresh, not a chrome
  redesign: colour tokens and Metal shaders are unchanged, and Dia uses no Liquid Glass API (the system gives standard
  controls their glass through the SDK, for Dia and for us).
- ✅ New Tab mark: the hand-painted mark per profile colour (light and dark) replaces the glass orb. We don't ship Dia's
  paintings; `packages/shaders` OrbView paints a stand-in per colour, matched to each painting's OKLab lightness
  percentiles (within 0.02) and chroma.
- ✅ Command bar: the rebrand's two shadows (0.08 r2 / 0.04 r1); power-up band in one theme colour (grey for Neutral).
- ✅ Selected tab: #121212 at 0.5 (dark) / white 0.7 (light).
- ✅ Profile swipe settles with the 0.25 s spring.
- — App icon: Dia's is now a Sunglow Yellow painted mark on cream; ours stays Netnyahoo's own artwork.
- 🟡 Needs a Dia capture: the breadcrumb's host-only mode, the painted mark's exact outline/offset and 5% shade,
  light-mode Dia; the tab loading spinner (counter-clockwise since 1.50) doesn't exist in our tab rows yet.
- Owns: `docs/dia-spec.md`, `lib/theme.ts`, `components/sidebar/tokens.ts`, `layout/toolbarColors.ts`, visual-only edits across components.

Three 🟡 rows have no package because their missing half is elsewhere: the overflow menu's synced devices (⛔ Sync),
the mic's streaming dictation (⏸), and passkeys (Apple's entitlement grant and the CEF BRANDING rebuild).

### ⛔ Blocked, and what would unblock it
| Item | Blocked by | Unblocks when |
|---|---|---|
| Back/forward stack on Reopen Closed Tab and Duplicate (§2, 2 rows) | CEF 154 (Alloy) has no way to write navigation entries: `CefBrowserHost` only reads them (`GetNavigationEntries`, `GetVisibleNavigationEntry`); DevTools has `Page.getNavigationHistory` / `navigateToHistoryEntry` / `resetNavigationHistory` but no setter; `IDC_DUPLICATE_TAB` / `IDC_RESTORE_TAB` via `ExecuteChromeCommand` are Chrome-style only and open Chrome's own tab; replaying URLs would reload every page | a CEF patch exposing `content::NavigationController::Restore()` / `CopyStateFrom()` (entries + page state) on `CefBrowserHost`, in a custom CEF build |
| Auto-updates (Sparkle wired, §24) | no update server or signing | an appcast is hosted and `SUFeedURL` points at it; an EdDSA key pair is generated (public key in Info.plist, private key in the release pipeline); builds are Developer ID signed and notarized |
| Sync: E2E sync, per-profile sync, synced devices' tabs, Sync pane, per-profile extension sync (5 rows) | no backend | a sync server + account system exists (then it's a client WP) |
| Google Cast | CEF has no Media Router / Cast | CEF gains Cast, or we license and integrate a Cast sender SDK ourselves |
| Proprietary codecs (H.264 / AAC / MP4) | the stock CEF build excludes them | a custom CEF build with `proprietary_codecs=true ffmpeg_branding=Chrome`, plus codec licensing |
| Translate page | CEF ships no Translate | we pick a translation provider (API key, billing) or an on-device model; then a WP for the UI |
| "Share this tab instead" (tab capture) | the engine can only share screens and windows: our picker applies the choice through `getUserMedia({chromeMediaSource: "desktop", chromeMediaSourceId})`, which takes `screen:`/`window:` ids. A tab needs a `web-contents-media-stream://<render process id>:<main frame routing id>` id (Chromium `WebContentsMediaCaptureId`), and CEF's API doesn't expose either number (`CefFrame::GetIdentifier()` is a frame token) | CEF exposes a frame's process / routing id (or a tab-capture stream id), or we patch CEF to mint one; then the picker gains a Tabs section and a "Share this tab instead" bar |
| Web Bluetooth | CEF Alloy has no device chooser | CEF exposes a Bluetooth chooser (or we patch CEF); then add `NSBluetoothAlwaysUsageDescription` |

## 1. Windows & app shell
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Transparent titlebar, traffic lights in sidebar header | ✓ | ✅ | |
| Window frame autosave | ✓ | ✅ | frame kept per window in session.json |
| Multiple windows (⌘N) | ✓ | ✅ | one NSWindow + React root per store window; closing the last window keeps the app running |
| Incognito window (⇧⌘N), dark by default, excluded from AI | ✓ | ✅ | in-memory `incognito:<window>` profile, released on close; always dark; no history/closed-tab records |
| Close Window ⇧⌘W | ✓ | ✅ | |
| Reopen closed **window** / recently closed groups | ✓ | ✅ | File › Reopen Closed Window, History › Recently Closed (+ Recently Closed Groups) |
| Merge All Windows | ✓ | ✅ | groups survive the merge |
| Move tab to another window | ✓ | ✅ | Tabs › Move to Window and the tab menu; no drag between windows; the page reloads in its new window |
| Keep Window on Top | ✓ | ✅ | |
| Window › Move & Resize tiling (halves/quarters/arrange) | ✓ (macOS) | ✅ | AppKit adds Fill / Center / Move & Resize to our `windowsMenu` |
| Minimize / Minimize All / Zoom / Full Screen | ✓ | ✅ | Minimize All is the ⌥ alternate of Minimize |
| Drag window from chrome, double‑click to zoom | ✓ | ✅ | |
| Window backdrop tint (varies with key state/content) | ✓ | 🟡 | gradient + grain + profile colour; inactive windows (neither they nor a parent key/main, like Dia's WindowThemeBackgroundViewMetal) switch to Dia's lighter opaque tint, measured on plum (#352224 → #423C3C, matches an inactive Dia capture within ~1/255) and OKLab-shifted for the other dark themes. Light appearance keeps one tint (no inactive Dia capture yet); the active tint doesn't follow what's behind the window (Dia's is vibrant) |
| Warn before quitting / closing window with many tabs | ✓ | ✅ | ⌘Q warning; ⇧⌘W / close button on a window with 2+ tabs asks with Dia's close-window confirmation ("Close 3 tabs?", per-profile breakdown, "Don’t ask me again"), setting in General. Dia itself only shows that dialog when closing a window's last tab (`confirmCloseWindowOnLastTab`); our ⌘W last-tab dialog in lib/actions.ts still uses its own wording |
| Quit guard with active downloads | ✓ | ✅ | |
| Battery Saver / freeze CPU‑heavy background tabs | ✓ | ✅ | lib/tabLifecycle: on battery or Low Power Mode, hidden tabs using ≥ 10 % CPU (engine task manager, two samples) freeze and thaw when shown; Dia's Activated/Deactivated toasts with Settings; Advanced › Battery Saver |
| Tab discarding (sleep idle tabs, keep last 10 alive) | ✓ | ✅ | lib/tabLifecycle: background tabs sleep after 30 min of app-active time (sooner under memory pressure); 10 most recent protected; never audio, capture, PiP, split, pinned mini player or unsaved input (page check: typed text, focused editor, file, `onbeforeunload`); faded icon + "This tab needs to reload"; recent tabs reload on launch. WebAudio-only sound isn't seen as playing (the engine only reports media elements) |
| Sad‑tab / native error page with Reload | ✓ | ✅ | SadTab + Page Unresponsive (Wait / Exit Page) in layout/PaneOverlays |

## 2. Tabs
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| New tab ⌘T | ✓ | ✅ | |
| Close tab ⌘W (+ hover ✕) | ✓ | ✅ | |
| Close other tabs | ✓ | ✅ | |
| Close tabs above/below/left/right | ✓ | 🟡 | Above/Below done; the top tab strip reuses the sidebar menu, so it still says Above/Below instead of Left/Right |
| Close All Tabs ⇧⌘K | ✓ | ✅ | keeps pinned tabs and pinned groups |
| Reopen closed tab ⇧⌘T | ✓ (full state) | ⛔ | position, pin, group, custom name/icon, mute come back; the back/forward stack can't (see ⛔ table: CEF can read navigation entries but not restore them) |
| Drag reorder | ✓ | ✅ | rows, pinned tiles, groups, splits, across sections, into/out of groups, onto the page to split |
| Haptic tick while reordering | ✓ | ✅ | setting in Tabs |
| Pin / unpin (grid of pinned tiles) | ✓ | ✅ | |
| Pinned tab remembers base URL; "Back to Pinned URL" ⌘↩; Replace Pin; Edit Pinned Page | ✓ | ✅ | |
| Pinned tab badge | ✓ | ✅ | "Back to Pinned URL" badge on tiles away from their base URL |
| Duplicate tab | ✓ | ⛔ | copies URL, title, icon, name, mute; back/forward history can't be copied (see ⛔ table) |
| Rename tab (double‑click inline) | ✓ | ✅ | pinned tiles rename in a sheet |
| Change tab icon (emoji/icon picker) | ✓ | ✅ | emoji + SF Symbols |
| Mute site / audio indicator | ✓ (domain‑wide) | ✅ | per host per profile, persisted (`settings.mutedSites`), follows navigation |
| Mute all tabs | ✓ | ✅ | sidebar menu and overflow menu |
| Tab hover actions (pin / bookmark / split / chat) | ✓ | ✅ | hover card: Pin, Bookmark, Split, PiP, Back to Pinned; chat is ⏸ |
| Multi‑select tabs (⌘‑click, ⇧‑click) + bulk actions | ✓ | ✅ | |
| Tab context menu with shortcut hints | ✓ | ✅ | |
| Search Tabs ⇧⌘A (all windows, recently closed, chats) | ✓ | ✅ | all windows of the profile + recently closed tabs/groups; chats ⏸ |
| Tab Switcher ⌃Tab (MRU cycling with UI) | ✓ | ✅ | overlay after 140 ms, commits on ⌃ release |
| ⌘1–⌘8 / ⌘9 select tab | ✓ (Chromium) | ✅ | |
| Overflow menu (open + recently closed + synced devices) | ✓ | 🟡 | open, recently closed, recently cleaned, clean up, mute all done; synced devices need Sync (⛔) |
| Clean Up Tabs ⌥⌘K / auto‑archive untouched tabs → "Recently Cleaned" | ✓ | ✅ | + daily auto clean-up and the sidebar upsell |
| Auto‑clear abandoned New Tab Pages | ✓ | ✅ | on app resign-active / screen lock |
| Links `_blank` / ⌘‑click open new tab | ✓ | ✅ | ⌘-click → background tab next to its opener |
| ⌘‑click link creates a tab group with opener | ✓ | ✅ | setting in Tabs |
| Sidebar auto‑scrolls to background‑opened tab | ✓ | ✅ | |
| Title fade at trailing edge | ✓ | ✅ | |
| Favicons | ✓ | ✅ | per-profile cache on disk (`<profile>/Netnyahoo Favicons` + `favicons-<profile>.json`) keyed by page URL and host; a tab's icon is downloaded by its own browser (CEF `DownloadImage`, no cookies), pages without a tab through their profile's context; incognito icons are data: URIs in memory, dropped with the window; no third-party service. Fallback: Dia's EmptyFavicon tile with the host's initial, a globe for host-less URLs (WP5) |
| Tabs keep running in background | ✓ | ✅ | |
| Move tab to profile | ✓ | ✅ | with Dia's one-time data-loss warning |
| Workspace / companion tab | ✓ (agent tasks) | ⏸ | an AI surface: the companion panel belongs to a Chat task (`WindowTabUtilities.openTaskCompanionURL`, `TaskCompanionTarget`; nav-bar "Show/Hide companion panel" is a *task's* companion panel next to "Toggle task details"; its tab strip is `WorkspaceTabStripView` with "New/Close companion tab"), gated by the `task-execution-*` / `task-list-*` flags |
| Copy URLs of selected tabs / all links as Markdown | ✓ | ✅ | |

## 3. Tab groups & live folders
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Tab groups (create, rename, icon, pin, duplicate, ungroup, delete) | ✓ | ✅ | + collapse, colour, Move to Group, Remove from Group |
| New Tab in Group ⌥⌘T / New Group with Tab(s) ⌃⌘N | ✓ | ✅ | ⌃⌘N titles itself "New Group with N Tabs" for a selection |
| AI auto‑naming + emoji, shimmer on rename | ✓ | ⏸ | unnamed groups show the first tab's host |
| Group colour from favicon/theme | ✓ until 1.28 | ✅ | Dia 1.10.1 coloured new groups from the favicon / theme colour; 1.28.0 switched to "neutral-colored tab groups by default". Ours: neutral by default, colour menu with "Match Site Color" (page theme colour) |
| Peek group | ✓ | ✅ | hover card over a collapsed group |
| Single‑tab group auto‑ungroups | ✓ | ✅ | for ⌘-click groups (`autoUngroup`), like Dia |
| Close group → Bookmarks Bar / Recently Closed Groups | ✓ | ✅ | |
| Meeting tab groups (auto for calls, countdown wiggle, "Open All and Join") | ✓ | ✅ | calendar from macOS EventKit |
| GitHub / Bitbucket PR live folder (checks, stacks, review requests, hover preview) | ✓ | ✅ | the user supplies a token or their own OAuth app (no Netnyahoo OAuth apps) |
| Documents live folder (Drive, Notion, Confluence) | ✓ | ✅ | same: user-supplied Google OAuth client / Notion / Confluence tokens |
| Unread pip on live folders | ✓ | ✅ | |
| Chat with a live folder | ✓ | ⏸ | |
| Shared split view in sidebar | ✓ | ✅ | one row per split, a segment per pane |

## 4. Sidebar & layout
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Vertical sidebar vs top tab strip (⇧⌘S) | ✓ | ✅ | per window; new windows follow Settings › Tabs |
| Auto‑hide tabs / Focus Mode (⌘S) | ✓ | ✅ | named and bound like Dia now |
| Peek sidebar on hover at left edge | ✓ | ✅ | top strip peeks too |
| Sidebar toggle button in nav bar | ✓ | ✅ | |
| Resize sidebar (rubber‑band at min/max) | ✓ | ✅ | persisted; double-click resets |
| New tabs at top (setting) | ✓ | ✅ | |
| Sticky ➕ New Tab at bottom when overflowing | ✓ | ✅ | |
| Double‑click empty sidebar space → new tab | ✓ | ✅ | |
| Top Apps / Favorites dock | ✓ | ✅ | Dia's Top Apps are its favorites, i.e. the pinned-tab dock (`TabDock*`, `DIA_TAB_CONTAINER_FAVORITES`; onboarding "Keep your favorite apps handy" is the pinned-tabs step). Ours: the pinned-tile dock; the command bar says "Move to Top Apps" / "Unpin from Top Apps" like Dia's |
| Library (chats & files Dia made) | ✓ | ⏸ | |
| Downloads button in header | ✓ | ✅ | |
| Selected/hover/pressed row styling + selected glow | ✓ | ✅ | |
| Pinned tile tooltip (title + URL) | ✓ | ✅ | hover card with title and URL |
| Website colour extended into tab bar / toolbar | ✓ | ✅ | nav bar tint from theme-color / header / background, eased; setting in Tabs |
| Profile indicator in sidebar header | ✓ | ✅ | menu: switch, new, rename, colour, icon, default, delete |

## 5. Profiles & Spaces
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Profiles (separate cookies, logins, passwords, extensions, cards, history, chats) | ✓ | ✅ | separate CEF contexts, history, bookmarks, Keychain password namespace; extensions 🚧, cards ❌ (no card autofill), chats ⏸ |
| Profile name + theme colour (+ icon) | ✓ | ✅ | name, 9 colours (window tint, NTP light, edge light, orb). Dia 1.49.1 ships no profile artwork (no profile images in any asset catalog; the NTP uses the colour), so the "hand-painted icon" row was dropped; ours can add an initial, an emoji or one of 20 SF Symbol icons drawn on the profile colour |
| Profile switcher, ⌃1–⌃9, next/previous, swipe between profiles | ✓ | 🟡 | switcher, ⌃1–⌃9, Next/Previous Profile; two-finger swipe over the sidebar pages through profiles (layout/ProfileSwipe: half-speed tracking, halfway detent haptic, rubber band at the ends, 0.4 s spring, three-finger swipes too). Gaps: the neighbouring profile's list isn't drawn during the drag (the list slides and fades, the new one slides in after), and the top-tab-strip layout has no swipe |
| Create / rename / delete / make default / reorder profiles | ✓ | ✅ | Dia's Create Profile dialog (name, colour, share toggle); Settings › Profiles rows drag to reorder (Dia's `ProfileGrabberView`), right-click: Show Profile Details, Make Default Profile, Delete Profile… |
| Clear browsing data per profile | ✓ | ✅ | |
| Share data between profiles | ✓ | ✅ | Dia 1.43: chosen in the Create Profile dialog ("Share data with another/current profile", radio list of profile sets "Work, Home, & 2 more"); several profiles then sit on one browser profile. Shared here: engine context (cookies, logins, site data and settings, passwords, extensions, zoom), history and bookmarks; tabs stay per profile; Dia's chat, memory and app connections are ⏸. Details pane: "A and B share Cookies, Passwords, …"; deleting one keeps the shared data |
| Guest profile | ✗ | — | not in Dia: no menu item, pane or UI string; the binary's only "Guest Profile" sits next to "System Profile" (Chromium's profile folder names, skipped by the importer) |
| Dock menu: New Window per profile | ✓ | ✅ | |
| Unload unused profiles | ✓ | ✅ | a profile no window has shown for 10 min: its tabs sleep, then its engine context is released (also right after its last tab closes); the default profile's global context stays |
| Per‑profile extensions | ✓ | 🚧 | |
| Per‑profile sync | ✓ | ⛔ | needs the Sync server (see §20) |
| Per‑profile Morning Brief | ✓ | ⏸ | |
| Spaces (colour, rename) | flag-gated; changelog says Dia has no Spaces | — | Dia ships without Spaces |
| Warn before closing last tab in a profile | ✓ | ✅ | with "Don't ask again" |

## 6. Split view
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Split view up to 3 panes, horizontal/vertical, add bottom split | ✓ | ✅ | "Cannot Add New Pane" toast at 3 |
| Open Split Pane ⌃⇧=, focus next/prev ⌃⇧] / ⌃⇧[ | ✓ | ✅ | |
| Drag tab to edge to split; ⌥‑click ➕ opens split NTP; ⇧⌥‑click link opens right pane | ✓ | ✅ | |
| Per‑pane nav bar / tint / close | ✓ | ✅ | unfocused panes dim |
| Flip / convert orientation / separate all | ✓ | ✅ | + Move Pane Left/Right, Remove from Split View |

## 7. New Tab Page & command bar
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| NTP layout (bar width, position, HUD blur material, fill, border, radius 20) | ✓ | ✅ | |
| Glass orb logo | ✓ | ✅ | |
| Power‑up band intro (per‑hue palette, blur 24) | ✓ | ✅ | |
| Area light (intro, breathing, fade) | ✓ | ✅ | palette follows the profile colour; Dia's clock model: skip-ahead to T = 5, intro only when the window is key, pause/resume on key changes (and while occluded), lift/tilt × 0.5 when not key |
| Edge light around bar | ✓ | ✅ | colour from the profile theme |
| Entrance spring / Reduce Motion | ✓ | ✅ | like Dia's entrance under Reduce Motion: no spring, no power-up band, edge light shown settled, area light still at its settled look (Dia resumes its breathing on the next key change; we keep it still) |
| Profile‑colour NTP theme & gradient | ✓ | ✅ | |
| NTP release‑notes postcard, Trial Guide, personalize button | ✓ | ✅ | components/ntp: after an update the postcard hangs off the NTP's top-right corner with Dia's binary-measured geometry (320×200, 2°, 40/30pt overhang, drop-in spring 0.65s, hover 1.05 + "Latest Release Notes" tooltip with close); click opens the notes as a full-page postcard over the NTP; shown for 1 day (Dia's default), never on fresh installs or in incognito. Personalize button (bottom right) opens theme colour + tab layout. Trial Guide is a plans feature (—). The artwork is our own (no release images); not visually verified with shaders |
| NTP connect‑apps upsell | ✓ | ⏸ | |
| NTP query restore when navigating back | ✓ | ✅ | |
| Command bar panel over toolbar (⌘L / click URL) | ✓ | ✅ | ⌘L on the NTP focuses and selects its bar |
| URL fixup | ✓ | ✅ | |
| History suggestions (frecency) | ✓ | ✅ | removable rows |
| Open‑tab suggestions ("Switch to Tab") | ✓ | ✅ | across windows |
| Bookmark suggestions | ✓ | ✅ | |
| Inline autocomplete | ✓ | ✅ | |
| Keyboard/hover selection | ✓ | ✅ | ↑↓, ⌃N/⌃P, Tab/⇧Tab |
| Route input to site / search / Chat (on‑device router model) | ✓ | ⏸ | "Ask anything…" placeholder; input goes to a site or the search engine |
| Force route ⌃⌘↩ → Chat | ✓ | ⏸ | |
| Force route ⇧⌘↩ → search | ✓ | ✅ | searches with the default engine (Dia: Google) |
| Google / Chat destination toggle | ✓ | ⏸ | the Go pill names the engine |
| "Prefer search engine" vs "Use website first" setting | ✓ | ✅ | Settings › General |
| Default search engine choice (Google, Bing, DDG, Perplexity, ChatGPT, custom, extension engines) | ✓ | ✅ | 13 built-ins + custom engines with keywords; extension engines 🚧 |
| Site search (Tab‑to‑search) | ✓ | ✅ | engines, known sites, history scope |
| Calculator in command bar | ✓ | ✅ | ↩ copies the result |
| "new doc / sheet / jira / meeting / figma…" commands | ✓ | ✅ | 17 `*.new` shortcuts + browser actions in the bar |
| `@` mentions & `/` skills in bar | ✓ | ⏸ | |
| "+ Add tabs or files" chip | ✓ | ⏸ | the chip exists but picking a tab switches to it and a file opens in the tab (attaching needs Chat) |
| Mic / dictation button | ✓ (streaming, hold‑to‑speak) | 🟡 | starts system dictation; Dia's streaming, hold-to-speak transcription is ⏸ |
| Paste and Go / Paste and Search | ✓ | ✅ | bar and URL right-click menus; strips trackers |
| Paste URLs as attachments | ✓ | ⏸ | |

## 8. Navigation & page tools
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Back / forward / reload / force reload | ✓ | ✅ | ⌘-click reload/back/forward → background tab |
| Stop (X next to address bar) | ✓ | ✅ | Esc stops a loading page |
| Hold back button for history list; ⌘/middle‑click entries | ✓ | ✅ | press-and-hold / right-click opens our own popover (layout/HistoryPopover): up to 15 entries with favicons + Show Full History; click goes there, ⌘/middle-click opens a background tab (list stays open), ⇧⌘ foreground, ⇧ new window; the arrows themselves take ⌘/middle-click too |
| Two‑finger swipe navigation (custom UI, works on native pages) | ✓ | ✅ | NNSwipe (cef): app-wide scroll monitor + our own RenderWidgetHostViewCocoa responder delegate, so pages keep horizontal scrolls first (Chrome's rules: first scroll update unconsumed, overscroll-behavior-x auto); honours Swipe between pages, three-finger swipes too. Dia's overlay (layout/SwipeOverlay, numbers from its binary): 72→82 pt frosted circle, rubber band, chevron that brightens at the threshold with a haptic, destination list after holding 0.3 s. Works on the New Tab page and internal pages. Needs a real-trackpad check (only synthetic events verified) |
| Load progress | ✓ | ✅ | |
| URL bar shows host / title; hover reveals full URL; Show Full URL | ✓ | ✅ | |
| Punycode display | ✓ | ✅ | `core/idn.ts`: Unicode hosts when Chrome's spoof checks pass (UTS 39 allowed set, mixed scripts, mixed digits, deviation characters, TLD-specific letters, whole-script confusables, digit lookalikes, dangerous patterns, top-domain skeletons), punycode otherwise; toolbar, status bubble, suggestions, pages, Site Controls, tab labels (WP5) |
| Find in page ⌘F / ⌘G / ⇧⌘G | ✓ | ✅ | per-tab state, "n of m", ⇧↩ |
| Use Selection for Find | ✓ | ✅ | |
| Jump to Selection, Find & Replace | ✓ | ✅ | Edit › Find › Jump to Selection ⌘J (page selection, or a text field's, scrolled into view); Find and Replace… ⌥⌘F adds a Replace row to the find bar (Replace / All) for the page's focused input, textarea or contenteditable, case-insensitive, one ⌘Z undoes it |
| Zoom ⌘+ / ⌘- / ⌘0 | ✓ | ✅ | per host per profile, kept by the engine; pinch reported; Settings › Privacy lists zoom levels |
| Translate page / Never translate this site | ✓ | ⛔ | CEF ships no Translate; needs a translation service (API key / billing) plus our own UI |
| Selected‑text popover (Search) | ✓ | ✅ | a mouse selection of page text shows a Search bar over it (default engine, new tab next to the page); hides on click, typing, scroll. Dia's own popover (SupertabFrontend.SelectedTextPopover) is its Chat thread's; ours is for pages. The page menu's "Search <engine> for “…”" follows the default engine. Not visually verified with a real click on the button |
| Selected‑text popover / context menu (Ask) | ✓ | ⏸ | hidden in the popover and the page menu until Chat exists (`kChatEnabled` in NNClient.mm) |
| Clean link copy (trackers stripped), Copy URL as Markdown ⌥⇧⌘C | ✓ | ✅ | every Copy URL / Copy Link (as Markdown) strips trackers: ⇧⌘C, Site Controls, tab and group menus, URL field, History, Bookmarks, bookmarks bar, live items |
| Quote link / "Super Copy" (text fragment link) | ✓ | ✅ | ⇧⌘C with text selected: Dia's "Share a link directly to this text instead?" toast with Copy Quote Link; page menu "Copy Link to Highlight". `#:~:text=` links grown to whole words, with prefix/suffix or start,end until unique (core/textFragment.ts); ⇧⌘C now also shows Dia's "Copied Current URL" / "Copied a clean link without trackers" toast. Dia's button/confirmation wording isn't in its binary (deduplicated), so ours is a close guess |
| JS alert / confirm / prompt dialogs | ✓ | ✅ | CEF's default (Chrome-style) dialogs, not Dia-styled; not visually verified |
| `<input type=file>` open panel | ✓ | ✅ | CEF's default NSOpenPanel; not visually verified |
| Pop‑up blocker (always allow/deny) | ✓ | ✅ | toolbar badge + Dia's dialog; ad popups dropped by the blocker |
| Site settings menu (security, pop‑ups, cookies, clear cache) | ✓ | ✅ | Site Controls: connection + certificate, zoom, PiP, ad blocking, 6 permissions, clear cookies & site data, clean link, full URL |
| Insecure‑site warning | ✓ | ✅ | lock-warning glyph in the URL field; Chromium's interstitial for certificate errors |

## 9. AI assistant — Chat
Everything in this section is deferred on purpose.

| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Chat ⌘E (sidebar / floating / tab), Focus Chat ⌃⌘E | ✓ | ⏸ | |
| Current page as context | ✓ | ⏸ | |
| @‑mention tabs / tab groups; attach files, screenshots, selection | ✓ | ⏸ | |
| Ask on Page (selection, video timestamps, charts, iframes, shadow DOM) | ✓ | ⏸ | |
| Screen capture → ask (region / full page) | ✓ | ⏸ | |
| Streaming dictation | ✓ | ⏸ | |
| Model picker / reasoning effort / "Skip" thinking; live thinking UI | ✓ | ⏸ | |
| Personalization (tone, writing, coding), per‑chat off switch | ✓ | ⏸ | |
| Memory (browsing memory, knowledge graph) | ✓ in 1.49 · **retired in 1.50** | — | |
| History search by date/title/URL; search past chats & artifacts | ✓ | ⏸ | (the History page's own search is done, §13) |
| Import ChatGPT memories | ✓ (moot after 1.50) | — | |
| Chat history panel (search, delete, clear all) | ✓ | ⏸ | |
| Edit / retry / stop & resume / auto‑compaction | ✓ | ⏸ | |
| Tab tools (open / read / close tabs with confirmation) | ✓ | ⏸ | |
| Web search + fetch tools | ✓ | ⏸ | |
| AI form autofill (preview + approve) | ✓ | ⏸ | |
| Computer use / agentic actions | ✓ | ⏸ | |
| YouTube transcript Q&A, pre‑generated summaries | ✓ | ⏸ | |
| PDF (OCR) / DOCX / PPTX / XLSX / Google Sheets reading | ✓ | ⏸ | |
| Tables, charts, code blocks (syntax highlight) in chat | ✓ | ⏸ | |
| Promoted prompts (summarize, ELI5, quiz me, proofread, review code, citations) | ✓ | ⏸ | |
| Proactive suggestions | ✓ | ⏸ | |
| `/research` deep research | ✓ | ⏸ | |
| Content safety (sensitive sites, org DLP) | ✓ | ⏸ | |
| On‑device ML (router, skills classifier, embeddings via MLX) | ✓ | ⏸ | |
| New Chat agent runtime (bundled Claude Code agent server) | ✓ | ⏸ | |
| Ask‑user questions / to‑do list UI in chat | ✓ | ⏸ | |

## 10. AI — Skills, artifacts, work features
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Skills (/name, auto‑fire, multi‑step) | ✓ | ⏸ | |
| Skill Builder, Skills Gallery, share/publish, packs | ✓ | ⏸ | |
| Artifacts: reports, decks, dashboards; share link / PDF / image / `.diaart` | ✓ | ⏸ | |
| Reports with inline comments → batched edits | ✓ | ⏸ | |
| Morning Brief ("Start My Day") | ✓ | ⏸ | |
| Meeting prep / recap | ✓ | ⏸ | |
| Home surface / Task list / missions | ✓ (flagged) | ⏸ | |
| Tidy Downloads (AI renames files, undo) | ✓ | ⏸ | |
| AI rename of pinned tabs | ✓ | ⏸ | |

## 11. Connected apps
The connected apps exist to give Chat tools, so they're deferred with it. Live folders (§3) and Live Calendar use their
own sign-ins instead.

| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Apps hub (connect, per‑tool account, request an app) | ✓ | ⏸ | |
| Gmail, Google Calendar, Drive | ✓ | ⏸ | Drive live folder done (§3) |
| Slack | ✓ | ⏸ | |
| Notion, Confluence, Jira (Atlassian), Linear, Trello | ✓ | ⏸ | Notion / Confluence live folders done (§3) |
| GitHub, Figma, Canva | ✓ | ⏸ | GitHub live folder done (§3) |
| Outlook, Teams, SharePoint | ✓ | ⏸ | |
| Zoom, Loom, Granola, Amplitude, Salesforce, LinkedIn | ✓ | ⏸ | |
| Write actions with approval ("Always allow for this chat") | ✓ | ⏸ | |
| Live Calendar pinned‑tab hover, next‑meeting alerts, one‑click join | ✓ | ✅ | from macOS Calendar (EventKit), not a Google connection; alerts as notifications and in-window |

## 12. Bookmarks
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Bookmark page ⌘D | ✓ | ✅ | save dialog with name + folder tree; "Edit Bookmark…" when already saved |
| Bookmark all tabs; add to folder; folder‑tree save dialog | ✓ | ✅ | |
| Bookmarks bar (Always / New Tab only / Never, ⇧⌘B) | ✓ | ✅ | |
| Bookmark manager (⌥⌘B, `dia://bookmarks`) | ✓ | ✅ | `netnyahoo://bookmarks` |
| Bookmarks menu + Recent Bookmarks | ✓ | ✅ | |
| ⌘/middle‑click bg, ⌥‑click split, open folder | ✓ | ✅ | |
| Bookmarks in command bar | ✓ | ✅ | |
| Bulk undo | ✓ | ✅ | undo toast in the manager |

## 13. History
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| History recorded | ✓ | ✅ | per profile, 5 000 pages, history.json; never for incognito |
| History page (⌘Y, `dia://history`) | ✓ | ✅ | `netnyahoo://history`: by day, search, bulk delete |
| History menu | ✓ | ✅ | Show History, Clear Browsing Data, Recently Closed, Recently Closed Groups |
| Clear browsing data | ✓ | ✅ | history keeps each page's last 50 visit times, so a range removes visits (a page with older visits stays) and the icons of pages that are gone; for a range, cookies created in it are deleted and the HTTP cache is emptied; other site storage can only be cleared for All time (the engine can't date it; the dialog says so) (WP5) |
| Synced devices' tabs | ✓ | ⛔ | needs Sync (§20) |

## 14. Downloads
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Downloads panel (⇧⌘J, toolbar button) | ✓ | ✅ | scrolls past 8 rows; click outside dismisses |
| Progress, cancel, open, Show in Finder, clear | ✓ | ✅ | |
| Pause / resume | ✓ | ✅ | |
| Open when done; move to Trash | ✓ | ✅ | "Open When Done" isn't remembered across a relaunch (in-progress downloads don't survive one anyway) |
| Persist downloads list across launches | ✓ | ✅ | downloads.json; incognito downloads are never written, and saved ones get their own ids (the engine restarts at 1) |
| "Magnet" animation toward sidebar | ✓ | ✅ | |
| Drag file out of the panel | ✓ | ✅ | |
| `dia://downloads` page | ✓ | ✅ | `netnyahoo://downloads` |

## 15. Extensions
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Chrome Web Store MV3 extensions | ✓ | ✅ | CEF's Chrome extension system runs on our Alloy tabs (content scripts, service workers, DNR, storage, messaging, scripting). Store installs are verified CRX3s unpacked per profile (store id kept); no auto-update yet |
| Web Store "Add" button | ✓ | ✅ | store pages read "Add to Netnyahoo" and open our install dialog |
| Extensions menu, pin extensions, toolbar buttons with badges and popups | ✓ | ✅ | badge/title polled per tab; `action.setIcon` images not shown (manifest icon) |
| Manage Extensions (`dia://extensions`) | ✓ | ✅ | Settings › Extensions (on/off, details, site access, incognito, pin, remove, load unpacked) |
| Install/uninstall permission dialogs | ✓ | ✅ | |
| chrome.tabs / chrome.windows | ✓ | 🟡 | answered from our tab model in extension pages and store extensions' service workers; no tab events (onActivated/onUpdated…); developer-loaded service workers only see tabs by id |
| action.onClicked (no popup), keyboard `commands`, extension context-menu items | ✓ | ❌ | need a Chrome `Browser` window |
| Side‑panel API | ✓ | 🟡 | the panel page opens as a tab |
| Per‑profile extensions | ✓ | ✅ | sync ⏸ |

## 16. Passwords & autofill
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Save / update passwords, never for this site | ✓ | ✅ | own password manager (page script + Keychain, per profile); login picker; Settings › Passwords with Touch ID unlock and CSV import |
| Suggest strong password on sign-up | ✓ (Chromium) | ❌ | `generatePassword()` / `fillGeneratedPassword()` exist in packages/cef and nothing calls them |
| Passkeys / WebAuthn (iCloud Keychain) | ✓ | 🟡 | Chrome's WebAuthn stack and UI (patched CEF, team-signed app). Security keys ✅ (Chrome's dialog shows over the page). Phone (hybrid): Chrome's "Use your phone or tablet" QR sheet ✅ (Bluetooth entitlement and usage string; caBLE domains intact); a real phone scan is still to be tried. Touch ID "Chrome profile" passkeys: entitlement in place, waiting on the CEF rebuild with our BRANDING (team/bundle id). iCloud Keychain: waiting on Apple granting `com.apple.developer.web-browser.public-key-credential` (request prepared; entitlements file `Netnyahoo-ICloudPasskeys.entitlements` ready) and on the CEF NSWindow patch. See docs/migration-status.md tests 39–42 |
| Address & credit‑card autofill | ✓ | ❌ | |
| Edit › AutoFill menu (Contact, Passwords, Credit Card) | ✓ | ❌ | no AutoFill submenu in Edit |
| Password reveal button | ✓ | 🟡 | reveal in Settings › Passwords only; no eye button in the page's password fields |

## 17. Privacy & security
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Built‑in ad + tracker blocker (EasyList, EasyPrivacy), per‑site toggle | ✓ | ✅ | network + cosmetic filtering, per-site allowlist, blocked count |
| Cookie‑banner blocking, regional lists | ✓ | ✅ | EasyList Cookie + 12 regional lists, updatable |
| Clear cookies / cache for site | ✓ | ✅ | Site Controls and Settings › Privacy › site permissions |
| Incognito | ✓ | ✅ | favicons fetched in the window's own context and kept in memory; downloads carry their profile, show only in their window and leave with it (WP5) |
| Usage / content data sharing opt‑in | ✓ | — | no telemetry here |
| Certificate / connection info | ✓ | ✅ | Site Controls connection row with certificate details |
| Enterprise MDM policies, managed‑browser banner, SSO | ✓ | — | |

## 18. Media & PiP
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Picture‑in‑Picture | ✓ | ✅ | Chromium video PiP; hover card and Site Controls toggle it |
| Auto‑PiP on tab switch / window occluded (Meet, YouTube) | ✓ | ✅ | audible or capturing pages only; setting in Tabs |
| Document PiP | ✓ | ✅ | floating panel on all Spaces |
| PiP stash, return to tab, hostname bar | ✓ | ✅ | Document PiP: host in its title bar + back-to-tab button. Video PiP (Chromium's own window, `NNPictureInPicture.mm`): a host pill on hover (click = back to tab, right-click = Back to Tab / Keep Window on Top); dragged mostly past a left/right screen edge it stashes with a 28 pt peek and a chevron handle that brings it back. Chromium's own controls (play, back to tab, close) are unchanged; stash verified with the DEV self-test (`NETNYAHOO_PIP_SELFTEST`), not with a real pointer drag |
| Mini player for pinned media tabs (skip ±15 s, art, marquee) | ✓ | ✅ | hover mini player + sidebar player |
| Cast (Google Cast) | ✓ | ⛔ | CEF has no Media Router / Cast support |
| Screen‑share indicator, "Share this tab instead" | ✓ | ⛔ | indicator ✅: red capture glyph in the URL field + tab badges; Dia-style screen/window picker for getDisplayMedia (`components/media/SharePicker.tsx`). "Share this tab instead" ⛔: needs tab capture, see the ⛔ table |
| Camera / mic permission prompts | ✓ | ✅ | |
| Notifications permission | ✓ | ✅ | site prompt, then macOS permission; web notifications posted natively with click-through |
| Location permission | ✓ | ✅ | `NSLocationWhenInUseUsageDescription` / `NSLocationUsageDescription` + `com.apple.security.personal-information.location` (in the signed build). Verified: `getCurrentPosition` → our site prompt ("Allow localhost to access your location?") → dismiss → page gets `PERMISSION_DENIED`. Allowing (which raises macOS's own location prompt) not run: the user was away |
| Bluetooth permission | ✓ | ⛔ | CEF Alloy has no Web Bluetooth device chooser; Info.plist now has `NSBluetoothAlwaysUsageDescription` and the app the Bluetooth entitlement (added for passkeys) |
| Fullscreen video (incl. other display) | ✓ | ✅ | all chrome hides; Esc exits |
| Proprietary codecs (H.264 / AAC / MP4) | ✓ | ⛔ | the vendored CEF is the standard minimal build without proprietary codecs; needs a custom CEF build (`proprietary_codecs`, `ffmpeg_branding=Chrome`) and the codec licensing |

## 19. Sharing & printing
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Share sheet (File › Share…) | ✓ | ✅ | |
| Copy URL ⇧⌘C | ✓ | ✅ | tracker-stripped |
| Print / Save as PDF ⌘P | ✓ | ✅ | engine print dialog |
| Handoff (browsing activity) | ✓ | ✅ | per window, never incognito; cross-device Handoff also needs a team-signed build |

## 20. Import, account & sync
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Import from Chrome, Safari (.zip), Firefox, Edge, Brave, Opera, Vivaldi, Arc | ✓ | ✅ | + Opera GX, Island, Chrome channels, Chromium; bookmarks, history, open tabs, passwords |
| Arc import (spaces, pinned tabs, custom names) | ✓ | ✅ | |
| Account (Atlassian identity, OTP, delete account) | ✓ | — | |
| E2E‑encrypted sync (24‑word phrase, recovery kit, device transfer) | ✓ | ⛔ | needs a sync server and account system we don't have |
| Invite / referrals | ✓ | — | |

## 21. Appearance
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Light / Dark / Automatic (View › Appearance) | ✓ | ✅ | also in Settings › Appearance; light mode not visually re-verified |
| Profile theme colours | ✓ | ✅ | 9 colours |
| Custom app icons (Dock tile plug‑in) | ✓ | ✅ | Settings › Appearance › App Icon (7 variants drawn from the bundle icon); `NetnyahooDockTile.plugin` (packages/shell/docktile, built by a Run Script phase) keeps it in the Dock after quitting. Plug-in verified by loading it in a harness; not seen in the real Dock (that needs the app in the user's Dock) |
| Pro / unlockable backgrounds | ✓ | — | plans feature |
| Liquid Glass / "Sunglow" refresh (1.50) | ✓ | 🟡 | painted New Tab mark, bar shadows, one-colour power-up, selected-tab tint done (WP11); no Liquid Glass API in Dia; app icon kept ours; breadcrumb host-only rule unknown |
| Appearance pane (Light/Dark/Auto, app icons) | removed in 1.50 | ✅ | Dia deleted its Appearance settings pane in 1.50 (`better-days-appearance-settings-enabled`); ours stays |
| Daylight effect (sun‑based shadow) | ✓ (flagged, excluded with area light) | — | intentionally off |

## 22. Settings
| Pane | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Settings window ⌘, | ✓ | ✅ | sidebar navigation with back/forward, like Dia |
| General (default browser, login item, updates, warn before quit, sounds, build channel) | ✓ | ✅ | default browser, login item, warn before quitting, session restore, command-bar routing, import, Updates (check automatically, "Automatically update Netnyahoo", Check Now + last check; off with "Updates aren't set up for this build" until a feed is configured). Dia's sounds are Chat / daily-report sounds (⏸); we ship no UI sounds. Build channel — |
| Account | ✓ | — | |
| Profiles / Profile Details | ✓ | ✅ | |
| Tabs (layout, new‑tab position, groups, clean‑up, haptics, site colours) | ✓ | ✅ | all present; "⌥⇧-click opens tab in group" = ⌥⇧-clicking a tab (sidebar or top strip) puts it in the current tab's group (or starts one) and selects it. Dia's string says "when opt-shift-clicking Tabs"; ⌥⇧-clicking a *link* still opens a split |
| Appearance (theme, app icon) | ✓ | ✅ | theme + App Icon picker |
| Apps (connections, Morning Brief, New Chat) | ✓ | ⏸ | |
| Skills | ✓ | ⏸ | |
| Personalization | ✓ | ⏸ | |
| Memory | ✓ (retired 1.50) | — | |
| Privacy (content blocking, data sharing) | ✓ | ✅ | content blocking, filter lists, per-site permissions, zoom levels; data sharing — |
| Sync | ✓ | ⛔ | needs the Sync server |
| Keyboard Shortcuts (remap any action, F‑keys, conflict handling) | ✓ | ✅ | every menu command, recorder, conflicts filter, reset |
| Usage / Billing | ✓ | — | |
| Advanced | ✓ | ✅ | also: Passwords, Search Engine, Live Folders, Calendar panes (ours) |

## 23. Developer & scripting
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| DevTools ⌥⌘I / F12 | ✓ | ✅ | ⌥⌘I, F12 (hidden alias) and context-menu Inspect; View › Developer › View Source ⌥⌘U (`view-source:` tab next to the page) and JavaScript Console ⌥⌘J (opens DevTools on the Console, or switches an open one to it) |
| Task Manager | ✓ | ✅ | Chromium task rows, CPU/memory, End Process |
| AppleScript dictionary (windows, tabs, profiles, execute JS) | ✓ | ✅ | Netnyahoo.sdef, Chrome/Dia-style suite |
| Raycast extension support (via AppleScript) | ✓ | 🟡 | the dictionary matches Dia's shape, but Raycast's Dia extension targets Dia's bundle id; nothing ships for Netnyahoo |
| Record Performance Issue, Copy Diagnostics | ✓ | ✅ | engine trace saved to Downloads |

## 24. System integration
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Default browser (http/https, HTML/PDF docs) + "try for a week" | ✓ | ✅ | URL + document types, Set as Default (Settings, onboarding) done; the week's follow-up (trigger/state in lib/defaultBrowserCheckIn.ts, WP8) is drawn by components/ntp/CheckInBanner.tsx as Dia's TryForAWeekView: NTP top-left card, "How are you liking Netnyahoo?" / "Leave us feedback ↗", hover 1.02 / press 0.98 springs, close on hover |
| Launch at login, Add to Dock | ✓ | ✅ | |
| Dock menu (new window per profile) | ✓ | ✅ | + New Incognito Window |
| Notifications (web + app) | ✓ | ✅ | web notifications and meeting alerts via UserNotifications |
| Services menu, spelling, substitutions, speech, transformations | ✓ | ✅ | |
| Start Dictation / Emoji & Symbols | ✓ | ✅ | AppKit adds them to our Edit menu; not visually re-verified |
| Auto‑updates (Sparkle, deferrable) | ✓ | ⛔ | Sparkle 2 wired (Check for Updates…, full-screen deferral, Settings › General › Updates); `SUFeedURL` is empty (set it in Info.plist's "Distribution" block), so Sparkle doesn't start and Check for Updates… says "Updates aren't set up for this build". Blocked on a real appcast, the EdDSA key pair and Developer ID signing + notarization |

## 25. Onboarding, help, plans
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Intro animation with music (mute / skip) | ✓ | ✅ | animation + Skip; our own music (Dia's recording can't ship): an original piece synthesized natively (packages/shell/ios/IntroMusic.swift, AVAudioEngine + hall reverb) on the animation's cue times; Dia's mute button (bottom left, speaker.wave.3.fill / speaker.slash.fill, remembered in onboarding.json); Skip fades it out |
| Onboarding steps (email, role, apps, default browser, pinned‑tab suggestions) | ✓ | ✅ | default browser / Dock / login, personalization (theme colour + tab layout, Dia's PersonalizationView copy), import, pinned-tab suggestions; email and role are account steps (—), apps ⏸ |
| Welcome postcard, tool tour, Trial Guide, video tour | ✓ | 🟡 | welcome postcard (Outro step); tool tour = coach marks over the real window (command bar, tabs, sidebar toggle, split, done) from the welcome's "Take the Tour" and Help › Tool Tour; video tour: Help › Video Tour and the tour's last card open Info.plist `NNVideoTourURL`, hidden while it's empty — there is no video yet; Trial Guide — |
| "What's new" postcard / Dia Weekly | ✓ | ✅ | the NTP release-notes postcard and full-page notes (row in §7); notes are data in components/ntp/releaseNotes.ts; Dia Weekly (a newsletter) — |
| Help menu (Chat with Support, Status, Feedback) | ✓ | 🟡 | Send Feedback, Keyboard Shortcuts, Tool Tour, Video Tour (hidden until `NNVideoTourURL` is set), Copy Diagnostics, Record Performance Issue. Send Feedback goes to Info.plist's `NNFeedbackURL` or `NNFeedbackEmail` ("Distribution" block); both are empty until the user picks a destination, so it opens a mail draft with the report template and no recipient. Chat with Support ⏸, Status — |
| Plans / trial / usage credits | ✓ | — | |

## Keyboard shortcuts — Dia vs Netnyahoo
Checked against `packages/shell/ios/Menus.swift`.

| Action | Dia | Netnyahoo | Status |
|---|---|---|---|
| Settings | ⌘, | ⌘, | ✅ |
| New Tab | ⌘T | ⌘T | ✅ |
| New Tab in Group | ⌥⌘T | ⌥⌘T | ✅ |
| New Window | ⌘N | ⌘N | ✅ |
| New Incognito Window | ⇧⌘N | ⇧⌘N | ✅ |
| Reopen Closed Tab | ⇧⌘T | ⇧⌘T | ✅ |
| Chat | ⌘E | — (left free on purpose) | ⏸ |
| Focus Chat | ⌃⌘E | — | ⏸ |
| Open Command Bar | ⌘L | ⌘L | ✅ |
| Close Window | ⇧⌘W | ⇧⌘W | ✅ |
| Close Tab | ⌘W | ⌘W | ✅ |
| Close All Tabs | ⇧⌘K | ⇧⌘K | ✅ |
| Clean Up Tabs | ⌥⌘K | ⌥⌘K | ✅ |
| Print | ⌘P | ⌘P | ✅ |
| Copy URL | ⇧⌘C | ⇧⌘C | ✅ |
| Copy URL as Markdown | ⌥⇧⌘C | ⌥⇧⌘C | ✅ |
| Paste and Match Style | ⇧⌘V | ⇧⌘V | ✅ |
| Find / Next / Previous | ⌘F / ⌘G / ⇧⌘G | ⌘F / ⌘G / ⇧⌘G | ✅ |
| Show Spelling / Check Now | ⌘: / ⌘; | ⌘: / ⌘; | ✅ |
| Refresh / Force Refresh | ⌘R / ⇧⌘R | ⌘R / ⇧⌘R | ✅ |
| Show Tabs in Sidebar (layout switch) | ⇧⌘S | ⇧⌘S | ✅ |
| Auto‑Hide Tabs (Focus Mode) | ⌘S | ⌘S | ✅ |
| Open Split Pane / Next / Prev pane | ⌃⇧= / ⌃⇧] / ⌃⇧[ | ⌃⇧= / ⌃⇧] / ⌃⇧[ (+ hidden ⌃+ / ⌃} / ⌃{) | ✅ |
| Toggle Bookmarks Bar | ⇧⌘B | ⇧⌘B | ✅ |
| Actual Size / Zoom In / Out | ⌘0 / ⌘+ / ⌘- | ⌘0 / ⌘+ (+ hidden ⌘=) / ⌘- | ✅ |
| Enter Full Screen | 🌐F | 🌐F | ✅ |
| Developer Tools | ⌥⌘I (+F12) | ⌥⌘I (+ hidden F12) | ✅ |
| Back / Forward | ⌘[ / ⌘] | ⌘[ / ⌘] | ✅ |
| Next / Previous Tab | ⇧⌘] / ⇧⌘[ (+⌃Tab switcher) | ⇧⌘] / ⇧⌘[ (+ hidden ⌘} / ⌘{) + ⌃Tab / ⌃⇧Tab switcher | ✅ |
| Search Tabs | ⇧⌘A | ⇧⌘A | ✅ |
| New Group with Tab | ⌃⌘N | ⌃⌘N | ✅ |
| Add to Bookmarks | ⌘D | ⌘D (on two items: Tabs › Add to Bookmarks… and Bookmarks › Bookmark This Page) | ✅ |
| Manage Bookmarks | ⌥⌘B | ⌥⌘B | ✅ |
| Show History | ⌘Y | ⌘Y | ✅ |
| Clear Browsing Data | ⇧⌘⌫ | ⇧⌘⌫ | ✅ |
| Pin tab | — (none) | — | ✅ |
| Mute Site | — (none) | — | ✅ (the old ⌥⌘M clash is gone) |
| Minimize / Minimize All | ⌘M / ⌥⌘M | ⌘M / ⌥⌘M | ✅ |
| Downloads | ⇧⌘J | ⇧⌘J | ✅ |
| Window Fill / Center / Previous Size | 🌐⌃F / 🌐⌃C / 🌐⌃R | AppKit's, from `windowsMenu` | ✅ |
| Switch to Profile 1–9 | ⌃1–⌃9 | ⌃1–⌃9 (Window › Profiles, shown once there are 2+ profiles) | ✅ |
| Command bar → Chat | ⌃⌘↩ | — | ⏸ |
| Command bar → Google (force search) | ⇧⌘↩ | ⇧⌘↩ (default engine) | ✅ |
| Pinned tab → base URL | ⌘↩ | ⌘↩ (hidden item) | ✅ (see Broken: may clash with ⌘↩ in the command bar) |
| Rename tab | double‑click | double‑click | ✅ |

## Menus
Checked against `packages/shell/ios/Menus.swift`.

| Menu | Dia | Netnyahoo |
|---|---|---|
| App (About, Updates, Invite, Settings, Import, Services, Sign Out, Hide, Quit) | ✓ | ✅ About, Check for Updates…, Settings…, Import from Another Browser…, Services, Hide / Hide Others / Show All, Quit (Invite and Sign Out are account features: —) |
| File | ✓ | ✅ New Tab, New Tab in Group, New Window, New Incognito Window, Reopen Closed Tab / Window, Open Command Bar, Close Window / Tab / All Tabs, Clean Up Tabs, Share…, Print… (Chat ⏸) |
| Edit | ✓ | 🟡 Find submenu (Find, Find and Replace, Next, Previous, Use Selection for Find, Jump to Selection), Spelling and Grammar, Substitutions, Transformations, Speech, Copy URL (as Markdown), Paste and Match Style; no AutoFill submenu |
| View | ✓ | 🟡 Appearance, Refresh, layout / Auto-Hide Tabs, split panes, Show Bookmarks Bar, Show Full URL, zoom, Full Screen, Developer (View Source, Developer Tools, JavaScript Console) |
| Tabs | ✓ | ✅ Back/Forward, Next/Previous Tab, Search Tabs…, Pin, Duplicate, New Group with Tab, Move to Profile / Window, Add to Bookmarks…, Add Bookmark to Folder, Rename…, Change Icon…, Mute Site |
| Bookmarks | ✓ | ✅ Bookmark This Page, Bookmark All Tabs…, Manage Bookmarks, Recent Bookmarks, Bookmarks Bar / Other Bookmarks trees |
| History | ✓ | ✅ Show History…, Clear Browsing Data…, Recently Closed, Recently Closed Groups |
| Extensions | ✓ | 🚧 not in Menus.swift yet |
| Window | ✓ | ✅ Minimize (+ Minimize All), Arrange in Front, Keep Window on Top, Downloads, Task Manager, Merge All Windows, Profiles, AppKit's Move & Resize and window list |
| Help | ✓ | 🟡 Send Feedback… (mail draft until a destination is configured), Keyboard Shortcuts, Tool Tour, Video Tour (hidden until configured), Copy Diagnostics, Record Performance Issue… (+ DEBUG Show Onboarding); no Chat with Support (⏸) |

## Broken or inconsistent (found during this audit)
1. ~~**Dead page context-menu items.**~~ — fixed (WP1): `ContentCard.tsx` handles `onCommand`; "Search <engine> for “…”"
   names and uses the default search engine (`NNCef.searchEngineName`, kept in sync from Settings); "Ask About Selection"
   is hidden until Chat exists.
2. ~~**Setting nothing reads**~~ — fixed (WP8): `optShiftClickOpensInGroup` is about ⌥⇧-clicking *tabs* (Dia: "creating
   tab groups when opt-shift-clicking Tabs"): the tab joins the current tab's group, or they start one. ⇧⌥-clicking a
   link still opens a split.
3. ✅ ~~**Recorded, never used:** `defaultBrowserTrialStartedAt`~~ — read by `useDefaultBrowserCheckIn` (WP8: trigger,
   dismissal state, "Leave us feedback") and shown by the New Tab page's check-in card (WP9).
4. **Native APIs with no caller:** ~~`WebViewHandle.discard()` / `onDiscarded`~~ (wired by WP3, lib/tabLifecycle;
   `isDiscarded()` stays unused, the app tracks sleep itself),
   `generatePassword()` / `fillGeneratedPassword()` (strong passwords), `appIcons()` / `setAppIcon()` / `currentAppIcon()`
   (app icon picker), `setAutomaticUpdateChecks/Downloads()` / JS `checkForUpdates()` (update settings), `viewSource()` /
   `getSource()`, `onCertificateError`, `onPasswordFormDetected`, `onPopupWindow`, `onPageMessage`; store actions
   `reorderProfiles`, `reopenClosedTab` (⇧⌘T uses `reopenClosed`), `restoreClosedGroup`, `createSplit`, `addTabToSplit`.
5. ~~**Dead branch**~~ — fixed (WP8): the unreachable `closeAllTabs` case is gone from `lib/commands.ts`.
6. ~~**Copy URL isn't consistent**~~ — fixed (WP5): every Copy URL / Copy Link goes through `cleanUrl` (Markdown ones
   through core's `markdownLink`).
7. ~~**Tab menu "Add to Bookmarks…"**~~ — fixed (WP5): it does what ⌘D does for that tab (`bookmarkTab`: bookmark, then
   the dialog); it never removes a bookmark.
8. ~~**Privacy leaks from incognito**~~ — fixed (WP5): the s2 fallback is gone (icons only come through the engine, in the
   tab's own context; incognito ones stay in memory); downloads carry their engine profile, incognito ones list only in
   their window, are never written to downloads.json and leave the list when the window closes.
9. ~~**Page commands enabled on internal pages**~~ — fixed (WP8): on `netnyahoo://` pages the menu disables every page
   command except Copy URL (as Markdown) and the bookmark ones.
10. ~~**Possible ⌘↩ clash**~~ — fixed (WP8): AppKit offers ⌘↩ to the menu before a text field's keyDown, so a menu item
    bound to ⌘↩ (Back to Pinned URL, or a remapped one) now validates as off while a native text field has focus. Web
    pages already got it first (CEF's OnPreKeyEvent). Not reproduced by typing (needs keyboard focus on the instance).
11. ~~**Placeholders that ship**~~ — fixed (WP8): both destinations live in Info.plist's documented "Distribution" block
    (`NNFeedbackURL`, `NNFeedbackEmail`, `SUFeedURL`, `SUPublicEDKey`), empty until the user decides. Meanwhile Send
    Feedback opens a mail draft and Check for Updates… says "Updates aren't set up for this build".
12. ~~**Location permission can't work**~~ — fixed (WP7): usage descriptions and the location entitlement added; prompt verified in a run.
13. ~~**Top strip wording**~~ — fixed: the top strip's tab menu says Close Tabs to the Left / Right (Dia's strings), the sidebar's Above / Below.
14. No `TODO`/`FIXME`/`XXX` markers anywhere in apps/browser/src, packages/*/src, packages/cef/ios, packages/shell/ios.

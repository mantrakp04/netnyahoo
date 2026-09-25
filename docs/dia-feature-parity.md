# Dia feature parity

Dia = installed build **1.49.1 (87398), Chromium 153** plus the public changelog up to **v1.50.0 (2026‑09‑24)**;
visual rows re-checked against **1.50.1 (87750)** (`docs/dia-spec.md` › "1.50 Sunglow").
Netnyahoo = this working tree on **2026‑09‑25, after the Chrome migration**: our patched Chrome-style CEF
(154.0.28, `NN_CHROME_TABS 1`, `docs/cef-source-build.md`), where every tab is a real Chrome tab of an invisible
"ghost" Chrome window, hosted in our React Native views.

How this audit was done: every non-AI row re-read against the code (packages/cef, apps/browser/src, packages/shell,
packages/core, the Xcode project), not against earlier claims. Runtime evidence comes from the migration ledger,
`docs/migration-status.md`; "ledger N" below means its test N. Nothing was built or run for this audit.

Legend: **✅** done · **🧪** built, but the deciding test needs the user present (see the checklist) · **🟡** partial ·
**❌** missing · **⛔** blocked by something outside our control (named in the Gap) · **⏸** deferred (AI), on purpose ·
**—** not applicable

## Summary

**304 feature rows** (§1–§25):

| ✅ done | 🧪 needs the user | 🟡 partial | ❌ missing | ⛔ blocked | ⏸ deferred (AI) | — n/a |
|---|---|---|---|---|---|---|
| 197 | 6 | 18 | 4 | 7 | 58 | 14 |

Of the 232 rows that count (not ⏸ or —), 197 are done (85 %), 203 with the six 🧪 rows. Keyboard shortcuts: every
Dia shortcut is bound except the Chat ones (⏸). Menus: all ten exist; View and Help are partial.

The previous summary (296 rows, 181 ✅) didn't match its own tables, which held 301 rows and 199 ✅. This audit
adds three rows: "Filling saved logins in pages" (§16), "Protected video (Widevine DRM)" (§18) and the
Passwords / Autofill / Extensions panes (§22).

What changed since the last audit, in rows (mostly the migration):
- Now done: extensions (Chrome's real `chrome.tabs`, actions, commands, per-profile, Web Store installs through
  Chrome's own flow) and the Extensions menu, Chrome's password manager with our save prompt, card and address
  storage, H.264/AAC, the close-tabs wording in the top strip. Better but still partial: moving a tab between
  windows keeps its page (no drag between windows yet), the share picker can share a tab (no "Share this tab
  instead" bar), Edit › AutoFill exists (it opens Settings).
- Now needs the user present (🧪): Chrome's autofill dropdowns and password generation, video fullscreen, the real
  trackpad swipe, the file picker.
- No longer blocked, now ours to build (⛔ → ❌): back/forward history on Reopen Closed Tab and Duplicate, Cast,
  Web Bluetooth. Chrome's own code for each is in the engine now.
- Lost in the migration: the video-PiP edge stash and host pill (they lived in `NNPictureInPicture.mm`).
- Still blocked: Sync (4 rows), Translate, auto-updates, Widevine DRM, and iCloud Keychain passkeys (inside the 🟡
  passkeys row).

## Remaining work

Three agent-sized packages. Each owns the files listed (shared files, such as Menus.swift, commands.ts, settings.ts,
theme.ts and App.tsx, take small additive edits only, as the agent brief says). Each package deletes the dead code in
its own files (Findings 1).

**R1 · Tab state on Chrome** (engine + store)
- Reopen Closed Tab and Duplicate keep the back/forward list: `IDC_RESTORE_TAB` / `IDC_DUPLICATE_TAB` (or
  TabRestoreService) on the Chrome tab, adopted into our snapshot's place, pin and group (§2, 2 ❌).
- Sleeping tabs through Chrome's own discard, so history survives and `chrome.tabs` lists them as
  `discarded: true`. Also check that Chrome's own urgent discarding can't swap a hosted tab's WebContents
  under us (Findings 4).
- Clear Browsing Data through Chrome's BrowsingDataRemover: Chrome's history database, ranged site storage, no
  next-launch disk wipe (§13, Findings 5).
- Page context menu: build on Chrome's model without duplicates; check extension context-menu items (Findings 2).
- NNSwipe: chain to Chrome's original responder delegate instead of replacing it (Findings 3).
- Owns: `packages/cef/ios/{NNWindowHost,NNBrowserView,NNClient,NNSwipe,NNCef}.mm`, `CefModule.swift`,
  `packages/cef/src/{WebView.tsx,module.ts}`; `apps/browser/src/store/{windows,tabs}.ts`, `lib/tabLifecycle.ts`,
  `lib/chromeTabs.ts`, `components/pages/ClearDataDialog.tsx`.

**R2 · Chrome surfaces still missing from our UI**
- "Share this tab instead" bar while a page is capturing (§18).
- Web Bluetooth chooser and a Cast entry: route Chrome's chooser / cast dialog to our UI, as WP4 did for
  passwords and permissions (§18, 2 ❌; for Cast, first check that discovery works in the ungoogled build).
- Extensions: draw Chrome's side panel next to the page instead of opening a tab; show `action.setIcon` images;
  fix the Web Store install race (Findings 9); extension-provided search engines (§7).
- Content blocker: show uBOL's annoyance and malware categories, replace the no-op "Update Lists" with the
  bundled version and a real update path (Findings 7).
- Drag a tab onto another window, and tear it off into a new one (§1).
- Optional: rebuild the video-PiP edge stash and host pill on Chrome's PiP window (§18).
- Owns: `packages/cef/ios/{NNChromeUI,NNExtensions,NNExtensionPackage,NNContentBlocker}.*`,
  `ExtensionsModule.swift`, `packages/cef/src/{extensions,contentBlocker}.ts`;
  `apps/browser/src/components/{extensions,media}/*`, `components/site/*` (except `Autofill.tsx`),
  `components/settings/panes/Privacy.tsx`,
  `components/sidebar/dnd.tsx`, `components/layout/tabDrag.ts`.

**R3 · App loose ends and docs**
- The command bar's Share and Keyboard Shortcuts actions (Findings 6); the Autofill pane's per-profile toggles
  (Findings 8); Edit › AutoFill should fill at the focused field, or at least open the right pane per item (§16).
- Dia 1.50 tab loading spinner (counter-clockwise, 1.88 s) in tab rows (§21).
- Widevine row in Settings › Advanced: say it can't download in this build, or hide it (Findings 11).
- Dead code outside R1/R2 files and the stale comments and docs in Findings 1 and 13 (agent brief, migration ledger,
  the "Distribution" block comments).
- Owns: `packages/cef/src/{passwords,autofill,zoom}.ts`, `packages/cef/ios/{NNPasswords,NNAutofill}.mm`;
  `apps/browser/src/components/omnibox/actions.ts`, `components/settings/panes/{Autofill,Advanced}.tsx`,
  `components/site/Autofill.tsx` (menu handler only), `components/sidebar/{TabRow,TabIcon}.tsx`;
  `packages/shell/ios/{Updater,AppModule}.swift`, `packages/shell/src/app.ts` (comments);
  `docs/agent-brief.md`, `docs/migration-status.md`.

The 🧪 rows need no code until the user checklist below finds a problem.

### ⛔ Blocked, and what would unblock it
| Item | Blocked by | Unblocks when |
|---|---|---|
| Sync: E2E sync, per-profile sync, synced devices' tabs (§13 and the overflow menu), Sync pane (4 rows + 1 partial) | no backend | a sync server + account system exists (then it's a client package) |
| Auto-updates (§24) | no update feed | an appcast is hosted and `SUFeedURL` points at it, the EdDSA private key (public half already in Info.plist) is in a release pipeline, and releases are notarized (the Developer ID export already works) |
| Translate page (§8) | Chrome's Translate is in the engine, but ungoogled's domain substitution removed its Google servers | we pick a translation provider (API key, billing) or an on-device model, point Chrome's translate at it or build our own UI |
| Protected video, Widevine (§18) | the CDM comes through the component updater, whose Google host is substituted; shipping also needs Google's VMP signing | Google grants VMP signing and we allow the component updater host (or bundle the CDM) |
| iCloud Keychain passkeys (inside §16's passkeys row) | Apple hasn't granted `com.apple.developer.web-browser.public-key-credential` | the grant arrives: switch `CODE_SIGN_ENTITLEMENTS` to `Netnyahoo-ICloudPasskeys.entitlements` (ledger 42) |

## Needs the user present: test script (about 15 minutes)

These need a key window, Touch ID, a phone, Spaces, or eyes on Dia, so no agent can run them. Run them in one
sitting; note the step number and what you saw for anything that fails.

**0. Setup (before the clock; build takes a few minutes).** Metro must be running on :8081, as usual.
```sh
cd ~/Documents/netnyahoo/apps/browser
xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS -derivedDataPath build-user \
  -destination 'platform=macOS,arch=arm64' -configuration Debug build 2>&1 | grep -E "error:|\*\* BUILD"
mkdir -p /tmp/nn-forms && cd /tmp/nn-forms
echo '<h1>Done</h1>' > done.html
echo '<form action="done.html"><input name="user" autocomplete="username" placeholder="Email"><input name="pass" type="password" autocomplete="current-password" placeholder="Password"><button>Sign in</button></form><p><input type="file"></p>' > login.html
echo '<form action="done.html"><input name="email" autocomplete="username" placeholder="Email"><input name="pass" type="password" autocomplete="new-password" placeholder="New password"><button>Create account</button></form>' > signup.html
echo '<form action="done.html"><input name="n" autocomplete="name" placeholder="Full name"><input name="s" autocomplete="street-address" placeholder="Street"><input name="c" autocomplete="address-level2" placeholder="City"><input name="r" autocomplete="address-level1" placeholder="State"><input name="z" autocomplete="postal-code" placeholder="ZIP"><input name="k" autocomplete="country-name" placeholder="Country"><button>Save</button></form>' > address.html
python3 -m http.server 8765 --bind 127.0.0.1 &
open -n --env NETNYAHOO_DATA_DIR=/tmp/nn-usercheck ~/Documents/netnyahoo/apps/browser/build-user/Build/Products/Debug/Netnyahoo.app
```
The scratch data dir keeps your real profile untouched. The fixture data is fake, so the password in the query
string doesn't matter. Afterwards: `kill %1` for the server, quit the app, `rm -rf /tmp/nn-usercheck /tmp/nn-forms`.

1. **Fullscreen and Spaces** (ledger 15). Open any YouTube video and press **f** (or its fullscreen button).
   Pass: the window moves to its own Space with the video filling the screen and no sidebar or toolbar; Mission
   Control shows a single Netnyahoo window (the ghost stays invisible); **Esc** brings the window back to its
   Space and layout, and clicks land where you click. With a second display, repeat there.
2. **Save and fill a login** (ledger 19). Open `http://127.0.0.1:8765/login.html`, enter `me@example.com` /
   `Test-pass-123`, Sign in. Pass: our "Save password for 127.0.0.1?" prompt under the toolbar, and no Chrome
   bubble. Click Save, go Back (⌘[) and click the Email field. Pass: Chrome's dropdown sits right under the field
   and lists me@example.com; picking it fills both fields. Typing in the password field shows our eye button.
3. **Strong password** (ledger 19–20). Open `/signup.html` and click the password field. Pass: the dropdown
   offers a suggested strong password; using it fills the field; after Create account, the save prompt or Chrome's
   confirmation appears over the page, not in a window corner.
4. **Addresses** (ledger 21). Open `/address.html`, fill in a fake US address, Save. Pass: Chrome's "Save address?"
   bubble shows over the page area. Save it, reload, click Full name. Pass: the dropdown offers the address and
   fills every field; ⌘, › Autofill lists it.
5. **Passwords unlock** (ledger 27). ⌘, › Passwords › Unlock. Pass: exactly one Touch ID (or password) prompt;
   the login from step 2 shows; opening it and revealing the password within 5 minutes asks nothing more; the
   toggle reads "Offer to save and fill passwords". (Unlock only prompts when at least one login is saved.)
6. **Touch ID passkey** (ledger 40). On `https://webauthn.io`, enter a username and click Register. Pass: Chrome's
   dialog over the page offers this Mac / the Chrome profile; the macOS Touch ID sheet appears; after your finger
   webauthn.io reports success; Authenticate with Touch ID succeeds too. If only a security key and a phone are
   offered, note it: the passkeys agent then checks whether the scratch data dir's mock keychain is the cause
   (without it, the first launch moves the profile to "Netnyahoo Safe Storage" and existing cookies and passwords
   are lost once, ledger 41, so don't try that on your real profile without deciding to).
7. **Phone passkey** (ledger 39). On webauthn.io, register a second username and choose "Use a phone or tablet";
   scan the QR code with your phone's camera. Pass: the phone connects and saves the passkey; Authenticate with the
   phone succeeds.
8. **Remove-extension sheet** (W2). ⌘, › Extensions › Load unpacked…, pick
   `~/Documents/netnyahoo/packages/cef/patches/test/ext`, confirm Add. Then Remove on its row. Pass: a sheet
   attached to the Settings window, "Remove “nn component test”?" with Cancel and a red Remove; Cancel keeps it,
   Remove takes it off the list. If you have a store extension installed, "Remove from Netnyahoo" on its store
   page must show the same sheet on the browser window.
9. **Quick extras.** (a) On a page with history, swipe back with two fingers on the trackpad. Pass: Dia's frosted
   circle and chevron, a haptic at the threshold, back on release; a horizontally scrolling carousel scrolls
   first. (b) On `/login.html`, Choose File. Pass: the Open panel attaches to or centres on our window, and the
   chosen name shows. (c) ⌘P. Pass: Chrome's print preview over the page, Cancel closes it. (d) Right-click a link.
   Pass: "Open Link in New Tab" appears once (Findings 2). (e) With a text field focused in a page, the Edit ›
   Spelling and Grammar items are enabled (Findings 3).
10. **Visual QA against Dia 1.50.1** (ledger 28–31). Same profile colour, same window size, dark mode first, the two
    windows side by side. (a) New Tab: the painted mark's size, outline and centre (48 pt above the bar) and its
    texture. (b) The selected tab row's tint in the sidebar, then in light mode. (c) Light mode: the command bar's
    shadow under its bottom edge. (d) Open the same page in both and note when Dia's toolbar shows the host alone.
    (e) A loading tab: Dia's spinner turns counter-clockwise; ours has none (known). Pass: no difference you can see
    in (a)–(c) at 100 %; take a window screenshot (⇧⌘4, Space) of anything that differs, and note (d).

## 1. Windows & app shell
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Transparent titlebar, traffic lights in sidebar header | ✓ | ✅ | |
| Window frame autosave | ✓ | ✅ | frame kept per window in session.json |
| Multiple windows (⌘N) | ✓ | ✅ | one NSWindow + React root per store window, each with its own invisible ghost Chrome window per profile; closing the last window keeps the app running |
| Incognito window (⇧⌘N), dark by default, excluded from AI | ✓ | ✅ | in-memory `incognito:<window>` profile, released on close; always dark; no history; closed-tab records only while the window is open, never on disk |
| Close Window ⇧⌘W | ✓ | ✅ | |
| Reopen closed **window** / recently closed groups | ✓ | ✅ | File › Reopen Closed Window, History › Recently Closed (+ Recently Closed Groups) |
| Merge All Windows | ✓ | ✅ | groups survive the merge; pages move without reloading |
| Move tab to another window | ✓ | 🟡 | Tabs › Move to Window, the tab menu and Merge All Windows move the live page (history, form state, the Chrome tab via `MoveToBrowser`; ledger 10). Moving to another profile reloads, as it must. Missing: dragging a tab onto another window or tearing it off into a new one (sidebar/dnd.tsx, layout/tabDrag.ts stay inside one window) |
| Keep Window on Top | ✓ | ✅ | |
| Window › Move & Resize tiling (halves/quarters/arrange) | ✓ (macOS) | ✅ | AppKit adds Fill / Center / Move & Resize to our `windowsMenu` |
| Minimize / Minimize All / Zoom / Full Screen | ✓ | ✅ | Minimize All is the ⌥ alternate of Minimize |
| Drag window from chrome, double‑click to zoom | ✓ | ✅ | |
| Window backdrop tint (varies with key state/content) | ✓ | 🟡 | gradient + grain + profile colour; inactive windows switch to Dia's lighter opaque tint (measured on plum, OKLab-shifted for the other dark themes). Light appearance keeps one tint (no inactive Dia capture yet); the active tint doesn't pick up what's behind the window (Dia's is vibrant) |
| Warn before quitting / closing window with many tabs | ✓ | ✅ | ⌘Q warning; ⇧⌘W / close button on a window with 2+ tabs, and ⌘W on a window's last tab, use Dia's close-window confirmation ("Close 3 tabs?", per-profile breakdown, "Don’t ask me again"); setting in General |
| Quit guard with active downloads | ✓ | ✅ | |
| Battery Saver / freeze CPU‑heavy background tabs | ✓ | ✅ | lib/tabLifecycle: on battery or Low Power Mode, hidden tabs using ≥ 10 % CPU (engine task manager, two samples) freeze through CDP `Page.setWebLifecycleState` and thaw when shown; Dia's Activated/Deactivated toasts; Advanced › Battery Saver |
| Tab discarding (sleep idle tabs, keep last 10 alive) | ✓ | ✅ | lib/tabLifecycle: background tabs sleep after 30 min of app-active time (sooner under memory pressure); 10 most recent protected; never audio, capture, PiP, split, pinned mini player or unsaved input; faded icon + "This tab needs to reload"; recent tabs reload on launch. Our discard closes the Chrome tab, so its back/forward list is lost and extensions see it closed; Chrome's own discard would keep both. WebAudio-only sound isn't seen as playing |
| Sad‑tab / native error page with Reload | ✓ | ✅ | SadTab + Page Unresponsive (Wait / Exit Page) in layout/PaneOverlays |

## 2. Tabs
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| New tab ⌘T | ✓ | ✅ | |
| Close tab ⌘W (+ hover ✕) | ✓ | ✅ | |
| Close other tabs | ✓ | ✅ | |
| Close tabs above/below/left/right | ✓ | ✅ | sidebar: Above / Below; top strip: Close Tabs to the Left / Right (sidebar/menus.ts) |
| Close All Tabs ⇧⌘K | ✓ | ✅ | keeps pinned tabs and pinned groups |
| Reopen closed tab ⇧⌘T | ✓ (full state) | ❌ | position, pin, group, custom name/icon, mute come back, but the page reopens from its URL without its back/forward list (store/windows.ts `restoreTab`). **No longer blocked:** tabs are Chrome tabs, Chrome's tab restore is in the engine, and tabs Chrome creates are already adopted (NNWindowHost `tab:<id>` adoption). Needs `IDC_RESTORE_TAB` (or a TabRestoreService call) wired to our snapshot |
| Drag reorder | ✓ | ✅ | rows, pinned tiles, groups, splits, across sections, into/out of groups, onto the page to split |
| Haptic tick while reordering | ✓ | ✅ | setting in Tabs |
| Pin / unpin (grid of pinned tiles) | ✓ | ✅ | pins are mirrored into Chrome's tab strip |
| Pinned tab remembers base URL; "Back to Pinned URL" ⌘↩; Replace Pin; Edit Pinned Page | ✓ | ✅ | |
| Pinned tab badge | ✓ | ✅ | "Back to Pinned URL" badge on tiles away from their base URL |
| Duplicate tab | ✓ | ❌ | copies URL, title, icon, name, mute, not history (store/tabs.ts `duplicateTab`). **No longer blocked:** `IDC_DUPLICATE_TAB` on a Chrome tab makes a tab with the full history, which the app would adopt |
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
| Links `_blank` / ⌘‑click open new tab | ✓ | ✅ | Chrome makes the tab in the opener's Browser (`window.opener` kept) and the app adopts it; ⌘-click → background tab next to its opener (ledger 7) |
| ⌘‑click link creates a tab group with opener | ✓ | ✅ | setting in Tabs |
| Sidebar auto‑scrolls to background‑opened tab | ✓ | ✅ | |
| Title fade at trailing edge | ✓ | ✅ | |
| Favicons | ✓ | ✅ | per-profile cache on disk keyed by page URL and host, downloaded by the tab's own browser (no cookies); incognito icons in memory only; no third-party service; Dia's EmptyFavicon fallback (WP5) |
| Tabs keep running in background | ✓ | ✅ | |
| Move tab to profile | ✓ | ✅ | with Dia's one-time data-loss warning; the page reloads in the new profile and moves to its Chrome window (ledger 11) |
| Workspace / companion tab | ✓ (agent tasks) | ⏸ | an AI surface: the companion panel belongs to a Chat task |
| Copy URLs of selected tabs / all links as Markdown | ✓ | ✅ | |

## 3. Tab groups & live folders
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Tab groups (create, rename, icon, pin, duplicate, ungroup, delete) | ✓ | ✅ | + collapse, colour, Move to Group, Remove from Group |
| New Tab in Group ⌥⌘T / New Group with Tab(s) ⌃⌘N | ✓ | ✅ | ⌃⌘N titles itself "New Group with N Tabs" for a selection |
| AI auto‑naming + emoji, shimmer on rename | ✓ | ⏸ | unnamed groups show the first tab's host |
| Group colour from favicon/theme | ✓ until 1.28 | ✅ | neutral by default like Dia since 1.28; colour menu with "Match Site Color" |
| Peek group | ✓ | ✅ | hover card over a collapsed group |
| Single‑tab group auto‑ungroups | ✓ | ✅ | for ⌘-click groups (`autoUngroup`), like Dia |
| Close group → Bookmarks Bar / Recently Closed Groups | ✓ | ✅ | |
| Meeting tab groups (auto for calls, countdown wiggle, "Open All and Join") | ✓ | ✅ | calendar from macOS EventKit |
| GitHub / Bitbucket PR live folder (checks, stacks, review requests, hover preview) | ✓ | ✅ | the user supplies a token or their own OAuth app |
| Documents live folder (Drive, Notion, Confluence) | ✓ | ✅ | same: user-supplied Google OAuth client / Notion / Confluence tokens |
| Unread pip on live folders | ✓ | ✅ | |
| Chat with a live folder | ✓ | ⏸ | |
| Shared split view in sidebar | ✓ | ✅ | one row per split, a segment per pane |

## 4. Sidebar & layout
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Vertical sidebar vs top tab strip (⇧⌘S) | ✓ | ✅ | per window; new windows follow Settings › Tabs |
| Auto‑hide tabs / Focus Mode (⌘S) | ✓ | ✅ | |
| Peek sidebar on hover at left edge | ✓ | ✅ | top strip peeks too |
| Sidebar toggle button in nav bar | ✓ | ✅ | |
| Resize sidebar (rubber‑band at min/max) | ✓ | ✅ | persisted; double-click resets |
| New tabs at top (setting) | ✓ | ✅ | |
| Sticky ➕ New Tab at bottom when overflowing | ✓ | ✅ | |
| Double‑click empty sidebar space → new tab | ✓ | ✅ | |
| Top Apps / Favorites dock | ✓ | ✅ | the pinned-tile dock; command bar "Move to Top Apps" / "Unpin from Top Apps" like Dia |
| Library (chats & files Dia made) | ✓ | ⏸ | |
| Downloads button in header | ✓ | ✅ | |
| Selected/hover/pressed row styling + selected glow | ✓ | ✅ | Dia 1.50 selected tint (#121212 at 0.5 dark, white 0.7 light); not yet compared with Dia on screen (checklist step 10). No tab loading spinner in rows (Dia 1.50's turns counter-clockwise) |
| Pinned tile tooltip (title + URL) | ✓ | ✅ | hover card with title and URL |
| Website colour extended into tab bar / toolbar | ✓ | ✅ | nav bar tint from theme-color / header / background, eased; setting in Tabs |
| Profile indicator in sidebar header | ✓ | ✅ | menu: switch, new, rename, colour, icon, default, delete |

## 5. Profiles & Spaces
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Profiles (separate cookies, logins, passwords, extensions, cards, history, chats) | ✓ | ✅ | a Chrome profile each (cookies, logins, Chrome's password manager, autofill addresses and cards, extensions, site settings), plus our history and bookmarks; chats ⏸ |
| Profile name + theme colour (+ icon) | ✓ | ✅ | name, 9 colours (window tint, NTP light, edge light, painted mark); optional initial, emoji or SF Symbol icon on the profile colour |
| Profile switcher, ⌃1–⌃9, next/previous, swipe between profiles | ✓ | 🟡 | switcher, ⌃1–⌃9, Next/Previous Profile; two-finger swipe over the sidebar (layout/ProfileSwipe: half-speed tracking, halfway haptic, rubber band, Dia 1.50's 0.25 s settle). Gaps: the neighbouring profile's list isn't drawn during the drag, and the top-tab-strip layout has no swipe |
| Create / rename / delete / make default / reorder profiles | ✓ | ✅ | Dia's Create Profile dialog; Settings › Profiles rows drag to reorder |
| Clear browsing data per profile | ✓ | ✅ | |
| Share data between profiles | ✓ | ✅ | profiles sharing one engine profile share cookies, logins, site data, passwords, extensions, zoom, history and bookmarks; tabs stay per profile |
| Guest profile | ✗ | — | not in Dia |
| Dock menu: New Window per profile | ✓ | ✅ | |
| Unload unused profiles | ✓ | ✅ | a profile no window has shown for 10 min: its tabs sleep, then its engine context is released (checked every 15 s). Whether Chrome then unloads the profile itself (ghost, hidden WebUI pages) hasn't been measured on the new engine |
| Per‑profile extensions | ✓ | ✅ | every extension call takes the profile; Settings › Extensions has a profile picker ("Each profile has its own"); uBOL runs in every profile (ledger 11) |
| Per‑profile sync | ✓ | ⛔ | needs the Sync server (see §20) |
| Per‑profile Morning Brief | ✓ | ⏸ | |
| Spaces (colour, rename) | flag-gated; changelog says Dia has no Spaces | — | Dia ships without Spaces |
| Warn before closing last tab in a profile | ✓ | ✅ | with "Don't ask again" |

## 6. Split view
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Split view up to 3 panes, horizontal/vertical, add bottom split | ✓ | ✅ | each pane is a Chrome tab at its own size; Chrome's dialogs follow the focused pane (ledger "Split view") |
| Open Split Pane ⌃⇧=, focus next/prev ⌃⇧] / ⌃⇧[ | ✓ | ✅ | |
| Drag tab to edge to split; ⌥‑click ➕ opens split NTP; ⇧⌥‑click link opens right pane | ✓ | ✅ | |
| Per‑pane nav bar / tint / close | ✓ | ✅ | unfocused panes dim |
| Flip / convert orientation / separate all | ✓ | ✅ | + Move Pane Left/Right, Remove from Split View |

## 7. New Tab Page & command bar
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| NTP layout (bar width, position, HUD blur material, fill, border, radius 20) | ✓ | ✅ | |
| Logo: glass orb (1.49) → hand-painted mark per profile colour (1.50) | ✓ | ✅ | `Orb variant="painted"`: our own stand-in paintings matched to each Dia painting's OKLab lightness (within 0.02) and chroma; outline/offset vs a Dia 1.50.1 capture not compared yet (checklist step 10) |
| Power‑up band intro | ✓ | ✅ | 1.50: one theme colour (grey 0.65 for Neutral), corner radius 20 |
| Area light (intro, breathing, fade) | ✓ | ✅ | palette follows the profile colour; Dia's clock model (skip-ahead, key/occlusion pause, × 0.5 when not key) |
| Edge light around bar | ✓ | ✅ | colour from the profile theme |
| Entrance spring / Reduce Motion | ✓ | ✅ | like Dia under Reduce Motion: no spring, no band, edge light settled, area light still |
| Profile‑colour NTP theme & gradient | ✓ | ✅ | |
| NTP release‑notes postcard, Trial Guide, personalize button | ✓ | ✅ | postcard with Dia's geometry and springs, full-page notes, 1 day, never on fresh installs or incognito; Personalize button. Trial Guide is a plans feature (—). Our own artwork |
| NTP connect‑apps upsell | ✓ | ⏸ | |
| NTP query restore when navigating back | ✓ | ✅ | |
| Command bar panel over toolbar (⌘L / click URL) | ✓ | ✅ | ⌘L on the NTP focuses and selects its bar; 1.50's two bar shadows (0.08 r2 / 0.04 r1) |
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
| Default search engine choice (Google, Bing, DDG, Perplexity, ChatGPT, custom, extension engines) | ✓ | 🟡 | 12 built-ins + custom engines with keywords. Extension-provided engines (`chrome_settings_overrides.search_provider`) aren't read anywhere: not started |
| Site search (Tab‑to‑search) | ✓ | ✅ | engines, known sites, history scope |
| Calculator in command bar | ✓ | ✅ | ↩ copies the result |
| "new doc / sheet / jira / meeting / figma…" commands | ✓ | ✅ | 17 `*.new` shortcuts + browser actions in the bar; the bar's Share and Keyboard Shortcuts actions do nothing (Findings 6) |
| `@` mentions & `/` skills in bar | ✓ | ⏸ | |
| "+ Add tabs or files" chip | ✓ | ⏸ | the chip exists but attaching needs Chat |
| Mic / dictation button | ✓ (streaming, hold‑to‑speak) | 🟡 | starts system dictation; Dia's streaming, hold-to-speak transcription is ⏸ |
| Paste and Go / Paste and Search | ✓ | ✅ | bar and URL right-click menus; strips trackers |
| Paste URLs as attachments | ✓ | ⏸ | |

## 8. Navigation & page tools
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Back / forward / reload / force reload | ✓ | ✅ | ⌘-click reload/back/forward → background tab |
| Stop (X next to address bar) | ✓ | ✅ | Esc stops a loading page |
| Hold back button for history list; ⌘/middle‑click entries | ✓ | ✅ | our popover (layout/HistoryPopover): up to 15 entries + Show Full History, modifier clicks open tabs |
| Two‑finger swipe navigation (custom UI, works on native pages) | ✓ | 🧪 | NNSwipe + Dia's overlay (layout/SwipeOverlay), on web, New Tab and internal pages. Only synthetic events verified; needs a real trackpad (checklist step 9). On Chrome tabs NNSwipe installs itself as `RenderWidgetHostViewCocoa`'s responder delegate, which is where Chrome keeps its own delegate (history swiper, spelling/speech menu validation); ours replaces it instead of chaining (Findings 3) |
| Load progress | ✓ | ✅ | |
| URL bar shows host / title; hover reveals full URL; Show Full URL | ✓ | ✅ | Dia 1.50.1 sometimes shows the host alone; its rule isn't decoded (checklist step 10) |
| Punycode display | ✓ | ✅ | `core/idn.ts`: Chrome's spoof checks, punycode otherwise |
| Find in page ⌘F / ⌘G / ⇧⌘G | ✓ | ✅ | per-tab state, "n of m", ⇧↩ |
| Use Selection for Find | ✓ | ✅ | |
| Jump to Selection, Find & Replace | ✓ | ✅ | ⌘J, ⌥⌘F with Replace / All for the focused input, textarea or contenteditable. One ⌘Z undoes a Replace All in text fields; in a contenteditable each replacement is its own undo step |
| Zoom ⌘+ / ⌘- / ⌘0 | ✓ | ✅ | Chrome's per-host zoom per profile (`HostZoomMap`, Chrome's steps); Settings › Privacy lists and resets levels. Pinch zoom is reported by the page script but unused |
| Translate page / Never translate this site | ✓ | ⛔ | Chrome's Translate is compiled into the engine now, but its Google servers are removed by ungoogled's domain substitution and there's no UI; needs a translation provider (see ⛔ table) |
| Selected‑text popover (Search) | ✓ | ✅ | Search bar over a mouse selection (default engine, new tab next to the page); page menu "Search <engine> for “…”" |
| Selected‑text popover / context menu (Ask) | ✓ | ⏸ | hidden until Chat exists (`kChatEnabled` in NNClient.mm) |
| Clean link copy (trackers stripped), Copy URL as Markdown ⌥⇧⌘C | ✓ | ✅ | every Copy URL / Copy Link (as Markdown) strips trackers |
| Quote link / "Super Copy" (text fragment link) | ✓ | ✅ | ⇧⌘C with a selection: Dia's toast with Copy Quote Link; page menu "Copy Link to Highlight" (core/textFragment.ts). The menu item may appear twice on Chrome tabs (Findings 2) |
| JS alert / confirm / prompt dialogs | ✓ | ✅ | Chrome's tab-modal dialogs, centred over the page area (or the focused split pane); `alert()` and HTTP auth verified (ledger 26); `beforeunload` untested. Chrome's styling, not Dia's |
| `<input type=file>` open panel | ✓ | 🧪 | now Chrome's file picker, whose owner window is the ghost's Browser; untested whether it shows attached to our window (checklist step 9) |
| Pop‑up blocker (always allow/deny) | ✓ | ✅ | ours (`disable-popup-blocking` turns Chrome's off): toolbar badge + Dia's dialog, Only Once opens a tab with `opener` (ledger 24) |
| Site settings menu (security, pop‑ups, cookies, clear cache) | ✓ | ✅ | Site Controls: connection + certificate, zoom, PiP (when there's video), ad blocking, 6 permissions, clear cookies & site data, clean link, full URL |
| Insecure‑site warning | ✓ | ✅ | lock-warning glyph in the URL field; Chrome's interstitial for certificate errors |

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
| Bookmark manager (⌥⌘B, `dia://bookmarks`) | ✓ | ✅ | `netnyahoo://bookmarks` (our page). Extensions' `chrome.bookmarks` sees Chrome's own store, which we never fill, not ours (Findings 10) |
| Bookmarks menu + Recent Bookmarks | ✓ | ✅ | |
| ⌘/middle‑click bg, ⌥‑click split, open folder | ✓ | ✅ | |
| Bookmarks in command bar | ✓ | ✅ | |
| Bulk undo | ✓ | ✅ | undo toast in the manager |

## 13. History
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| History recorded | ✓ | ✅ | per profile, 5 000 pages, history.json; never for incognito |
| History page (⌘Y, `dia://history`) | ✓ | ✅ | `netnyahoo://history` (our page, also when Chrome opens chrome://history): by day, search, bulk delete |
| History menu | ✓ | ✅ | Show History, Clear Browsing Data, Recently Closed, Recently Closed Groups |
| Clear browsing data | ✓ | 🟡 | our history by visit time, favicons, cookies by creation date, HTTP cache; other site storage only for All time, deleted from disk before the profile next loads (an Alloy-era workaround). Chrome's own stores in the same profile (its history database, which Chrome-style tabs probably fill, form data, site-engagement) aren't cleared, and Chrome's BrowsingDataRemover, which could do ranged clearing, is unused (Findings 5) |
| Synced devices' tabs | ✓ | ⛔ | needs Sync (§20) |

## 14. Downloads
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Downloads panel (⇧⌘J, toolbar button) | ✓ | ✅ | our popover; Chrome's download bubble is off per profile (ledger 25) |
| Progress, cancel, open, Show in Finder, clear | ✓ | ✅ | |
| Pause / resume | ✓ | ✅ | |
| Open when done; move to Trash | ✓ | ✅ | "Open When Done" isn't remembered across a relaunch |
| Persist downloads list across launches | ✓ | ✅ | downloads.json; incognito downloads never written |
| "Magnet" animation toward sidebar | ✓ | ✅ | |
| Drag file out of the panel | ✓ | ✅ | |
| `dia://downloads` page | ✓ | ✅ | `netnyahoo://downloads` |

## 15. Extensions
Chrome's own extension system: every window's tabs are a real Chrome tab strip, so `chrome.tabs` / `chrome.windows`,
actions, commands and the Web Store are Chrome's (ledger items 1–14, 22, W1–W3).

| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Chrome Web Store MV3 extensions | ✓ | ✅ | installed by Chrome's WebstoreInstaller (location FROM_STORE, clients2 update URL), per profile; verified with Bitwarden and Dark Reader (W1). Auto-update not yet seen happening (W3). The store keeps a cosmetic "Switch to Chrome" banner |
| Web Store "Add" button | ✓ | ✅ | the store's own button runs Chrome's install flow; `CEF_NN_INSTALL_PROMPT` hands its confirmation to our Dia-style dialog with Chrome's warning list; buttons relabelled "Add to / Remove from Netnyahoo" (components/extensions/bridge.ts) |
| Extensions menu, pin extensions, toolbar buttons with badges and popups | ✓ | ✅ | Extensions menu (installed ones, Add Extension…, Manage Extensions…, Pin Extensions…); badge/title/popup polled per tab every 1.5 s (Chrome has no change event); `action.setIcon` images still not shown (the manifest icon is) |
| Manage Extensions (`dia://extensions`) | ✓ | ✅ | Settings › Extensions (on/off, details, site access, incognito, pin, reload, remove, add by link, load unpacked); `netnyahoo://extensions` is Chrome's own page (developer mode, errors, shortcuts) |
| Install/uninstall permission dialogs | ✓ | ✅ | install, re-enable and new-permission prompts through our dialog (verified, W1); removal asks with our "Remove “…”?" sheet from Settings, the toolbar menu and the store page, then Chrome uninstalls (engine verified, W2). The sheet itself needs a key window: checklist step 8 |
| chrome.tabs / chrome.windows | ✓ | ✅ | Chrome's real tabs and windows: one Chrome window per app window and profile, sidebar order, active/pinned both ways, `tabs.create` / `windows.create` / popups adopted as our tabs, moves between windows and profiles (ledger 1–14). Known gaps: an extension's `tabs.move` doesn't reorder the sidebar; a sleeping (discarded) tab is missing from `chrome.tabs` instead of listed as `discarded: true` |
| action.onClicked (no popup), keyboard `commands`, extension context-menu items | ✓ | 🟡 | onClicked + activeTab + `scripting.executeScript` verified (22); `chrome.commands` shortcuts forwarded to the key window's ghost Browser (13, NNWindowHost `ForwardKeyEvent`). Extension context-menu items: untested. Our page menu inserts its own items on top of the model Chrome passes to `OnBeforeContextMenu` (NNClient.mm), which in Chrome style already holds Chrome's items, so check for duplicates ("Open Link in New Tab" twice) while testing |
| Side‑panel API | ✓ | 🟡 | `ExecuteExtensionAction` reports "sidePanel", and the panel page opens as a tab: Chrome's side panel isn't drawn |
| Per‑profile extensions | ✓ | ✅ | lists, pins and installs per engine profile; incognito windows run the default profile's extensions that are allowed in incognito; sync ⛔ |

## 16. Passwords & autofill
Chrome's password manager and autofill fill pages themselves; our Settings panes drive Chrome's own
`passwordsPrivate` / `autofillPrivate` APIs in hidden WebUI pages (NNPasswords.mm, NNAutofill.mm).

| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Save / update passwords, never for this site | ✓ | ✅ | Chrome captures; Chrome's bubble is replaced by our Dia-style prompt (`CEF_NN_PASSWORD_BUBBLE`), with Save / Update (username picker) / Never / Not Now; verified (17, 18, and 19's revisit fill on a fresh profile). Settings › Passwords per profile: list, search, reveal/edit/delete, "Never saved" list, CSV import, the Offer-to-save toggle, unlock through Chrome's own device check |
| Filling saved logins in pages | ✓ | 🧪 | Chrome's dropdown under the focused field (ledger 19); needs a key window: checklist step 2 |
| Suggest strong password on sign-up | ✓ (Chromium) | 🧪 | Chrome's generation in the same dropdown on new-password fields; the generated-password confirmation stays Chrome's bubble (ledger 20). Checklist step 3 |
| Passkeys / WebAuthn (iCloud Keychain) | ✓ | 🟡 | Chrome's WebAuthn stack and dialogs, centred over the page. Security keys ✅ (dialog verified). Phone (hybrid): QR sheet ✅; a real phone scan is checklist step 7. Touch ID "Chrome profile" passkeys: the vendored CEF now carries our BRANDING (bundle/team id) and the app has the `.webauthn` keychain group, so it's engine-ready; checklist step 6. iCloud Keychain ⛔: waits on Apple granting `com.apple.developer.web-browser.public-key-credential` (entitlements file ready) |
| Address & credit‑card autofill | ✓ | 🧪 | Chrome's autofill (save bubble + dropdown, ledger 21); Settings › Autofill lists, adds, edits and deletes addresses and cards (card number behind Touch ID). Dropdown and save bubble: checklist step 4 |
| Edit › AutoFill menu (Contact, Passwords, Credit Card) | ✓ | 🟡 | the submenu exists, but each item opens Settings (Passwords or Autofill) instead of offering entries at the focused field; Contact… and Credit Card… open the same pane |
| Password reveal button | ✓ | ✅ | eye button in the page's password field once the user types (never for a filled saved password; sites with their own toggle keep theirs) in `helper/page_script.js`, and reveal in Settings › Passwords. Not visually re-checked on Chrome tabs |

## 17. Privacy & security
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Built‑in ad + tracker blocker (EasyList, EasyPrivacy), per‑site toggle | ✓ | ✅ | uBlock Origin Lite (MV3 DNR + cosmetic) as a component extension in every profile, incognito included (ledger 16); per-site "disable on this site"; blocked count from `ERR_BLOCKED_BY_CLIENT` |
| Cookie‑banner blocking, regional lists | ✓ | 🟡 | uBOL's cookie and regional rulesets, toggles in Privacy › Advanced Ad Block Settings. The lists are frozen at the bundled uBOL (2026.920.1710) until the app ships a newer one: component extensions don't update, and "Update Lists" is a no-op that always says "Lists are up to date". uBOL's annoyance and malware rulesets exist but the sheet doesn't show those two categories |
| Clear cookies / cache for site | ✓ | ✅ | Site Controls and Settings › Privacy › site permissions |
| Incognito | ✓ | ✅ | in-memory profile per window; favicons and downloads stay in the window (WP5); uBOL blocks there too |
| Usage / content data sharing opt‑in | ✓ | — | no telemetry here |
| Certificate / connection info | ✓ | ✅ | Site Controls connection row with certificate details; Chrome's interstitials for certificate errors |
| Enterprise MDM policies, managed‑browser banner, SSO | ✓ | — | |

## 18. Media & PiP
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Picture‑in‑Picture | ✓ | ✅ | Chrome's video PiP; hover card and Site Controls toggle it |
| Auto‑PiP on tab switch / window occluded (Meet, YouTube) | ✓ | ✅ | ours (NNBrowserView `autoPictureInPicture`): audible or capturing pages only; setting in Tabs |
| Document PiP | ✓ | ✅ | Chrome's own Document PiP window (its frame shows the origin and Back to tab) |
| PiP stash, return to tab, hostname bar | ✓ | 🟡 | Chrome's PiP window keeps its own Back to tab (and we switch to the tab when a video keeps playing after PiP closes). Our edge stash, host pill and Keep on Top menu went with `NNPictureInPicture.mm` in the migration; rebuild them on Chrome's PiP window if still wanted |
| Mini player for pinned media tabs (skip ±15 s, art, marquee) | ✓ | ✅ | hover mini player + sidebar player |
| Cast (Google Cast) | ✓ | ❌ | no longer an engine limit: the Chrome-style engine carries Chrome's Media Router, but nothing exposes it (no Cast entry in our UI; its dialog would anchor to the hidden toolbar). Untested whether discovery works in this ungoogled build |
| Screen‑share indicator, "Share this tab instead" | ✓ | 🟡 | indicator ✅ (red capture glyph + tab badges); Dia-style picker with Tabs (tab video + tab audio through our tab-capture patch), screens and windows ✅. Missing: the "Share this tab instead" bar that switches an ongoing share to the current tab |
| Camera / mic permission prompts | ✓ | ✅ | our prompt, no Chrome bubble (ledger 23) |
| Notifications permission | ✓ | ✅ | our prompt, then macOS permission; the page script shows web notifications natively with click-through |
| Location permission | ✓ | ✅ | our prompt verified (Don't Allow → denied); Allow (which raises macOS's own prompt) not run yet |
| Bluetooth permission | ✓ | ❌ | no longer an engine limit (Chrome-style has Chrome's device chooser; Info.plist and entitlement are in place), but untested, and Chrome's chooser is a bubble anchored to the hidden location bar, like the other bubbles WP4 re-routed |
| Fullscreen video (incl. other display) | ✓ | 🧪 | page fullscreen puts our window into fullscreen while the ghost stays put (`CEF_NN_TAB_FULLSCREEN`); Esc exits. Changes Spaces, so checklist step 1 |
| Proprietary codecs (H.264 / AAC / MP4) | ✓ | ✅ | our CEF build (`proprietary_codecs`, `ffmpeg_branding="Chrome"`, VideoToolbox decode) |
| Protected video (Widevine DRM: Netflix, Spotify…) | ✓ | ⛔ | Widevine is compiled in, but the CDM arrives through the component updater, whose Google host domain substitution removed, and a shipping app also needs Google's VMP signing. Settings › Advanced shows a Widevine row with an update button that can't download |

## 19. Sharing & printing
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Share sheet (File › Share…) | ✓ | ✅ | |
| Copy URL ⇧⌘C | ✓ | ✅ | tracker-stripped |
| Print / Save as PDF ⌘P | ✓ | ✅ | `CefBrowserHost::Print`, which on Chrome tabs should be Chrome's print preview; not re-checked since the migration (checklist step 9) |
| Handoff (browsing activity) | ✓ | ✅ | per window, never incognito; the app is team-signed now, cross-device Handoff not tried |

## 20. Import, account & sync
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Import from Chrome, Safari (.zip), Firefox, Edge, Brave, Opera, Vivaldi, Arc | ✓ | ✅ | + Opera GX, Island, Chrome channels, Chromium; bookmarks, history, open tabs, passwords (into Chrome's password manager) |
| Arc import (spaces, pinned tabs, custom names) | ✓ | ✅ | |
| Account (Atlassian identity, OTP, delete account) | ✓ | — | |
| E2E‑encrypted sync (24‑word phrase, recovery kit, device transfer) | ✓ | ⛔ | needs a sync server and account system we don't have |
| Invite / referrals | ✓ | — | |

## 21. Appearance
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Light / Dark / Automatic (View › Appearance) | ✓ | ✅ | also in Settings › Appearance; light mode not visually re-verified |
| Profile theme colours | ✓ | ✅ | 9 colours |
| Custom app icons (Dock tile plug‑in) | ✓ | ✅ | Settings › Appearance › App Icon (7 variants); `NetnyahooDockTile.plugin` keeps it after quitting. Not yet seen in the real Dock |
| Pro / unlockable backgrounds | ✓ | — | plans feature |
| Liquid Glass / "Sunglow" refresh (1.50) | ✓ | 🟡 | painted New Tab mark, bar shadows, one-colour power-up band, selected-tab tint, 0.25 s profile-swipe settle done (WP11); Dia uses no Liquid Glass API; app icon stays ours. Open: the breadcrumb's host-only rule, the counter-clockwise tab loading spinner (we have no spinner in tab rows), and a side-by-side check against Dia 1.50.1 (checklist step 10) |
| Appearance pane (Light/Dark/Auto, app icons) | removed in 1.50 | ✅ | Dia deleted its pane in 1.50; ours stays |
| Daylight effect (sun‑based shadow) | ✓ (flagged, excluded with area light) | — | intentionally off |

## 22. Settings
| Pane | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Settings window ⌘, | ✓ | ✅ | sidebar navigation with back/forward, like Dia |
| General (default browser, login item, updates, warn before quit, sounds, build channel) | ✓ | ✅ | default browser, login item, warn before quitting / closing windows, session restore, command-bar routing, import, Updates (off with "Updates aren't set up for this build" until `SUFeedURL` is set). Dia's sounds are Chat sounds (⏸); build channel — |
| Account | ✓ | — | |
| Profiles / Profile Details | ✓ | ✅ | |
| Tabs (layout, new‑tab position, groups, clean‑up, haptics, site colours) | ✓ | ✅ | incl. "⌥⇧-click opens tab in group" |
| Appearance (theme, app icon) | ✓ | ✅ | theme + App Icon picker |
| Apps (connections, Morning Brief, New Chat) | ✓ | ⏸ | |
| Skills | ✓ | ⏸ | |
| Personalization | ✓ | ⏸ | |
| Memory | ✓ (retired 1.50) | — | |
| Privacy (content blocking, data sharing) | ✓ | ✅ | content blocking (uBOL rulesets; see §17 for the list-update gap), per-site permissions, zoom levels; data sharing — |
| Passwords / Autofill / Extensions (Chrome's) | ✓ | ✅ | Passwords: Chrome's password manager per profile, unlock through Chrome's device check, CSV import. Autofill: addresses and cards per profile (the pane's two "offer to save" toggles only act on the default profile, Findings 8). Extensions: per profile |
| Sync | ✓ | ⛔ | needs the Sync server |
| Keyboard Shortcuts (remap any action, F‑keys, conflict handling) | ✓ | ✅ | every menu command, recorder, conflicts filter, reset |
| Usage / Billing | ✓ | — | |
| Advanced | ✓ | ✅ | Battery Saver, Widevine status (Findings 11); also our Search Engine, Live Folders and Calendar panes |

## 23. Developer & scripting
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| DevTools ⌥⌘I / F12 | ✓ | ✅ | ⌥⌘I, F12 (hidden alias), context-menu Inspect; View › Developer › View Source ⌥⌘U (`view-source:` tab) and JavaScript Console ⌥⌘J |
| Task Manager | ✓ | ✅ | Chromium task rows, CPU/memory, End Process |
| AppleScript dictionary (windows, tabs, profiles, execute JS) | ✓ | ✅ | Netnyahoo.sdef; execute runs through the renderer's `nn-eval`, which works on Chrome tabs |
| Raycast extension support (via AppleScript) | ✓ | 🟡 | the dictionary matches Dia's shape; nothing ships for Netnyahoo's bundle id |
| Record Performance Issue, Copy Diagnostics | ✓ | ✅ | engine trace saved to Downloads |

## 24. System integration
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Default browser (http/https, HTML/PDF docs) + "try for a week" | ✓ | ✅ | Set as Default (Settings, onboarding); the week's check-in card on the NTP |
| Launch at login, Add to Dock | ✓ | ✅ | |
| Dock menu (new window per profile) | ✓ | ✅ | + New Incognito Window |
| Notifications (web + app) | ✓ | ✅ | web notifications and meeting alerts via UserNotifications |
| Services menu, spelling, substitutions, speech, transformations | ✓ | ✅ | in page text fields, spelling/speech menu validation may be affected by Findings 3 |
| Start Dictation / Emoji & Symbols | ✓ | ✅ | AppKit adds them to our Edit menu; not visually re-verified |
| Auto‑updates (Sparkle, deferrable) | ✓ | ⛔ | Sparkle 2 wired (Check for Updates…, full-screen deferral, Settings › General › Updates). The public EdDSA key (`SUPublicEDKey`) and a Developer ID export are in place; still missing: a hosted appcast in `SUFeedURL`, the private key in a release pipeline, and notarization |

## 25. Onboarding, help, plans
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Intro animation with music (mute / skip) | ✓ | ✅ | our own synthesized music on the animation's cues; Dia's mute button, remembered |
| Onboarding steps (email, role, apps, default browser, pinned‑tab suggestions) | ✓ | ✅ | default browser / Dock / login, personalization, import, pinned-tab suggestions; email and role are account steps (—), apps ⏸ |
| Welcome postcard, tool tour, Trial Guide, video tour | ✓ | 🟡 | welcome postcard and coach-mark tool tour done; video tour hidden while Info.plist `NNVideoTourURL` is empty (no video yet); Trial Guide — |
| "What's new" postcard / Dia Weekly | ✓ | ✅ | NTP release-notes postcard and full-page notes; Dia Weekly (a newsletter) — |
| Help menu (Chat with Support, Status, Feedback) | ✓ | 🟡 | Send Feedback (a mail draft with no recipient until `NNFeedbackURL` / `NNFeedbackEmail` are set in Info.plist), Keyboard Shortcuts, Tool Tour, Video Tour (hidden), Copy Diagnostics, Record Performance Issue. Chat with Support ⏸, Status — |
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
| Jump to Selection / Find and Replace | ✓ (keys not recovered from the binary; macOS standard is ⌘J / ⌥⌘F) | ⌘J / ⌥⌘F | ✅ |
| Show Spelling / Check Now | ⌘: / ⌘; | ⌘: / ⌘; | ✅ |
| Refresh / Force Refresh | ⌘R / ⇧⌘R | ⌘R / ⇧⌘R | ✅ |
| Show Tabs in Sidebar (layout switch) | ⇧⌘S | ⇧⌘S | ✅ |
| Auto‑Hide Tabs (Focus Mode) | ⌘S | ⌘S | ✅ |
| Open Split Pane / Next / Prev pane | ⌃⇧= / ⌃⇧] / ⌃⇧[ | ⌃⇧= / ⌃⇧] / ⌃⇧[ (+ hidden ⌃+ / ⌃} / ⌃{) | ✅ |
| Toggle Bookmarks Bar | ⇧⌘B | ⇧⌘B | ✅ |
| Actual Size / Zoom In / Out | ⌘0 / ⌘+ / ⌘- | ⌘0 / ⌘+ (+ hidden ⌘=) / ⌘- | ✅ |
| Enter Full Screen | 🌐F | 🌐F | ✅ |
| Developer Tools / View Source / JavaScript Console | ⌥⌘I (+F12) / ⌥⌘U / ⌥⌘J | ⌥⌘I (+ hidden F12) / ⌥⌘U / ⌥⌘J | ✅ |
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
| Pinned tab → base URL | ⌘↩ | ⌘↩ (hidden item; off while a native text field has focus) | ✅ |
| Rename tab | double‑click | double‑click | ✅ |

## Menus
Checked against `packages/shell/ios/Menus.swift`; every item has a handler (lib/commands.ts, sidebar/commands.ts,
lib/appIntegration.ts).

| Menu | Dia | Netnyahoo |
|---|---|---|
| App (About, Updates, Invite, Settings, Import, Services, Sign Out, Hide, Quit) | ✓ | ✅ About, Check for Updates…, Settings…, Import from Another Browser…, Services, Hide / Hide Others / Show All, Quit (Invite and Sign Out are account features: —) |
| File | ✓ | ✅ New Tab, New Tab in Group, New Window, New Incognito Window, Reopen Closed Tab / Window, Open Command Bar, Close Window / Tab / All Tabs, Clean Up Tabs, Share…, Print… (Chat ⏸) |
| Edit | ✓ | ✅ Undo … Select All, Copy URL (as Markdown), Paste and Match Style; Find ▸ (Find, Find and Replace, Next, Previous, Use Selection for Find, Jump to Selection); Spelling and Grammar, Substitutions, Transformations, Speech; AutoFill ▸ (Contact…, Passwords…, Credit Card…: they open Settings, see §16) |
| View | ✓ | 🟡 Appearance, Refresh / Force Refresh, Show Tabs in Sidebar, Auto-Hide Tabs, split panes, Show Bookmarks Bar ▸, Show Full URL, zoom, Enter Full Screen, Developer ▸ (View Source, Developer Tools, JavaScript Console). Unchanged since the last audit, which rated it partial without naming the missing items |
| Tabs | ✓ | ✅ Back/Forward, Next/Previous Tab, Search Tabs…, Pin, Duplicate, New Group with Tab, Move to Profile / Window, Add to Bookmarks…, Add Bookmark to Folder, Rename…, Change Icon…, Mute Site |
| Bookmarks | ✓ | ✅ Bookmark This Page, Bookmark All Tabs…, Manage Bookmarks, Recent Bookmarks, Bookmarks Bar / Other Bookmarks trees |
| History | ✓ | ✅ Show History…, Clear Browsing Data…, Recently Closed, Recently Closed Groups |
| Extensions | ✓ | ✅ one item per enabled extension (opens its popup or runs its action), Add Extension…, Manage Extensions…, Pin Extensions… |
| Window | ✓ | ✅ Minimize (+ Minimize All), Arrange in Front, Keep Window on Top, Downloads, Task Manager, Merge All Windows, Profiles, AppKit's Move & Resize and window list |
| Help | ✓ | 🟡 Send Feedback… (mail draft until a destination is configured), Keyboard Shortcuts, Tool Tour, Video Tour (hidden until configured), Copy Diagnostics, Record Performance Issue… (+ DEBUG Show Onboarding); no Chat with Support (⏸) |

## Broken or inconsistent after the migration (found during this audit)
The previous audit's list (Broken 1–13) was all fixed and is dropped. "Likely" means read in the code but not
reproduced.

1. **Dead code from the Alloy era and retired APIs.** Each remaining-work package removes what's in its files.
   - `packages/cef/src/WebView.tsx`: the retired props `onPasswordFormDetected`, `onPasswordFieldFocused`,
     `onPasswordCaptured`, `onAutofill` (the native side no longer emits them) and the no-op methods `fillPassword`,
     `fillGeneratedPassword`, `fillAutofill`, `setAutofillMenuOpen`, `requestAutofill`. Never called by the app:
     `setZoom`, `getZoom`, `viewSource`, `exitFullscreen`, `getText`, `getSource`, `getNowPlaying`, `isDiscarded`,
     `getPasswordPrompt`, and props `onPopupWindow`, `onCertificateError`. Also the optional-call shims "for
     builds from before it existed" (`resolvePasswordPrompt?`, `setTabStrip?`, `setSearchEngineName?`…) and
     `lib/commands.ts` `legacyCommand`.
   - `packages/cef/src`: `generatePassword` (+ `NNPasswords generatePassword`), `ZOOM_LEVELS` and `getZoom` (its
     comment says `zoomStep` walks it; the engine uses Chrome's steps), `checkContentBlocking`,
     `updateFilterLists` (a no-op), `setExtensionPinned`, `extensionPopupUrl`, `openDownload`, `revealDownload`,
     `isSwipeNavigationEnabled`, the `AutofillEvent` / `AutofillSuggestion` types, and `ZoomState.pinchScale`
     (sent, never read).
   - Extensions: `resolveOpenedTab` is a no-op; `TabsRequest` actions other than "open" "no longer occur" but
     `bridge.ts` still handles them; `bridge.ts` still rebuilds the whole window/tab model on every store change
     (40 ms debounce) although `setExtensionTabModel` only passes `probes` on; the whole CRX download-and-verify
     path (`NNExtensionPackage.mm`, 431 lines, `prepareWebStore`, `discardPrepared`) only runs when the engine
     lacks `CEF_NN_INSTALL_PROMPT`, which ours has.
   - Native fallbacks reachable only with `NN_CHROME_TABS 0` (the stock-CEF build): `host::Attach`'s ghost
     branch, `ConfigurePopup`'s parking path, the `load-extension` blocker path in NNCef.mm, the probe lookup in
     NNExtensions.mm. Keep them only if the stock-CEF build is still wanted (see 12). Alloy stays on purpose for
     the hidden WebUI helper pages and non-hostable views (NNChromePages.mm, NNWindowHost.mm `CreateTab`).
2. **Page context menu on Chrome tabs.** `NNClient::OnBeforeContextMenu` inserts our items (Open Link in New
   Tab…, Copy Link to Highlight, Search…, Inspect) at the top of the model it's given. On Chrome-style tabs that
   model already holds Chrome's own items, and nothing removes them, so duplicates are likely. Extension
   context-menu items (`chrome.contextMenus`) come through the same model and are untested.
3. **NNSwipe replaces Chrome's responder delegate.** `NNSwipe.mm` sets itself as `RenderWidgetHostViewCocoa`'s
   `responderDelegate`; its comment says "CEF's Alloy runtime leaves it unset", but on Chrome tabs that slot holds
   Chrome's `ChromeRenderWidgetHostViewMacDelegate` (history swiper, and menu validation for spelling and speech).
   Ours should forward to the original instead of dropping it.
4. **Sleeping tabs.** Our discard closes the Chrome tab (history lost, extensions see a close). Separately, Chrome's
   own tab discarding isn't turned off; if it discards a hosted tab under memory pressure, its WebContents is
   replaced behind our view. Likely harmless, not tested.
5. **Clear Browsing Data vs Chrome's stores.** Chrome-style tabs probably also fill Chrome's own history database
   in each profile, which nothing clears (and which `chrome.history` shows extensions). Site storage is still
   deleted from disk before the next launch, an Alloy-era workaround; Chrome's BrowsingDataRemover is available now.
6. **Command bar "Share" and "Keyboard Shortcuts" do nothing.** `omnibox/actions.ts` sends them to `runCommand`,
   which has no case for either; only `appIntegration.ts` `runAppCommand` (native menu events) handles them.
7. **Content blocker sheet.** "Update Lists" calls a no-op and always reports "Lists are up to date"; rows can say
   "Downloaded when turned on", though every list is bundled; uBOL's "annoyances" and "security" categories never
   show (`Privacy.tsx` CATEGORIES lists four). The lists only change when the bundled uBOL
   (`vendor/ubol`, 2026.920.1710) is bumped.
8. **Autofill pane toggles ignore the selected profile.** `settings/panes/Autofill.tsx` reads and writes "offer to
   save addresses / cards" with no profile (the default one), while the lists follow the pane's profile picker.
9. **Web Store install race.** `bridge.ts` injects the store script with `chromeInstalls` as known at that moment;
   `supportsExtensionInstallPrompt()` resolves asynchronously, so a store page loaded right at launch gets the
   old override and installs through our CRX path (no auto-update) instead of Chrome's flow.
10. **Extensions see Chrome's bookmarks and history, not ours.** Our bookmarks and history live in our JSON stores,
    so `chrome.bookmarks` is empty and `chrome.history` holds only what Chrome recorded itself (5).
11. **Widevine row.** Settings › Advanced offers to update the Widevine component, but the component updater's
    host is domain-substituted in our build, so it can't download.
12. **Building from a fresh checkout.** `NN_CHROME_TABS` defaults to 1 and `#error`s without our CEF distribution,
    which exists only in `~/chromium-build` (2 h first build); `CEF_PREBUILT=1` needs `NN_CHROME_TABS=0`, which no
    build setting passes. Decide whether the stock-CEF path stays (and wire the flag) or goes (with 1's fallbacks).
13. **Docs and comments that contradict the code.**
    - `docs/agent-brief.md`: "Alloy-style child views"; `packages/webkit` (deleted); "The repo has none" (one commit
      exists); `packages/import` isn't listed.
    - `docs/migration-status.md`: "In progress: WP1 — patched CEF build" and "Known regressions until the patched CEF
      is in" (it is in, and those regressions are gone); tests 40–41 "need the BRANDING change", but the vendored
      framework already carries `com.netnyahoo.browser` / U5L5T3NGVV.
    - `docs/research/chromium-ui-layer.md` WP3 said to delete NNPasswords, NNAutofill, NNZoom, NNSiteSettings and
      NNExtensions; they became thin wrappers over Chrome's WebUI APIs instead, which is fine, but the plan reads as
      if they were gone.
    - The Info.plist "Distribution" block cited by `Updater.swift`, `AppModule.swift`, `shell/src/app.ts`,
      `General.tsx` and `appIntegration.ts` doesn't exist: the keys are plain; `SUPublicEDKey` is already set.
    - Stale comments: "see NNFavicons.mm" (the class lives in NNBrowsingData.mm); `lib/actions.ts:119` "the page
      reloads in its new window"; `module.ts:163` and `page_script.js:485` describe Alloy screen sharing;
      `components/import/apply.ts` "engine Keychain" / "Keychain namespace" (passwords go to Chrome's password
      manager); `NNSwipe.mm:43` (3); a doc comment above the wrong function at `Menus.swift:456`.
14. No `TODO`/`FIXME`/`XXX` markers in the code paths audited.

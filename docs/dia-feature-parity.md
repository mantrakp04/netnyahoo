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
| 207 | 9 | 9 | 0 | 7 | 58 | 14 |

Of the 232 rows that count (not ⏸ or —), 207 are done (89 %), 216 with the nine 🧪 rows. Keyboard shortcuts: every
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
- Lost in the migration, since rebuilt on Chrome's PiP window: the video-PiP edge stash and host pill
  (`NNPictureInPicture.mm`).
- Since, from the polish pass (2026-09-25, instance `polish`): done, extension search engines, Edit › AutoFill at
  the focused field (engine hook `CEF_NN_AUTOFILL_TRIGGER`) and the PiP stash / host pill / Keep on Top on Chrome's
  PiP window (🟡 → ✅); the Raycast extension is built and needs the user to install it (🟡 → 🧪, checklist step 14).
- Since, from R2 (2026-09-25): done, the side panel, "Share this tab instead" and the Bluetooth chooser (❌ → ✅);
  built, needing the user: dragging tabs between windows and Cast (🟡 / ❌ → 🧪, checklist steps 11–12).
- Still blocked: Sync (4 rows), Translate, auto-updates, Widevine DRM, and iCloud Keychain passkeys (inside the 🟡
  passkeys row).

## Remaining work

Three agent-sized packages. Each owns the files listed (shared files, such as Menus.swift, commands.ts, settings.ts,
theme.ts and App.tsx, take small additive edits only, as the agent brief says). Each package deletes the dead code in
its own files (Findings 1).

**R1 · Tab state on Chrome** (engine + store) — **done 2026-09-25** (`docs/migration-status.md` › "R1"; CEF hooks
in `packages/cef/patches/cef-tab-state.patch`).
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

**R2 · Chrome surfaces still missing from our UI** — done 2026-09-25 (instance r2; ledger "R2 · Chrome surfaces")
except extension-provided search engines (§7) and the optional PiP stash, which weren't in its scope (both done
since, in the polish pass). Chrome's
surfaces come to the app through our CEF build's `CEF_NN_CHROME_UI` (docs/cef-source-build.md).
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

**R3 · App loose ends and docs** — done 2026-09-25 except the items listed in Findings 1 and 13 that sit in
R1/R2 files (filling at the focused field, §16, was done since in the polish pass).
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

## Needs the user present: test script (about 25 minutes)

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
   fills every field; ⌘, › Autofill lists it. Press Esc, then Edit › AutoFill › Contact…. Pass: the same dropdown
   opens under Full name; with no field focused (click the page background) it opens ⌘, › Autofill instead.
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
   Pass: the menu shows, "Open Link in New Tab" once, and choosing it opens a background tab (the menu's content
   and items were verified headless; showing the NSMenu wasn't). (e) With a text field focused in a page, the Edit ›
   Spelling and Grammar items are enabled (the page view's validation was verified headless).
10. **Visual QA against Dia 1.50.1** (ledger 28–31). Same profile colour, same window size, dark mode first, the two
    windows side by side. (a) New Tab: the painted mark's size, outline and centre (48 pt above the bar) and its
    texture. (b) The selected tab row's tint in the sidebar, then in light mode. (c) Light mode: the command bar's
    shadow under its bottom edge. (d) Open the same page in both and note when Dia's toolbar shows the host alone.
    (e) A loading tab: the spinner at the row's end (ours copies Dia's `transform.rotation.z` 0 → −2π in its unflipped
    view, which should turn clockwise on screen; the spec's "counter-clockwise" was read in y-down terms). Pass: no difference you can see
    in (a)–(c) at 100 %; take a window screenshot (⇧⌘4, Space) of anything that differs, and note (d).
11. **Dragging tabs between windows** (§1). Open two windows side by side (⌘N), each with a few tabs. Drag a sidebar
    row onto the other window. Pass: the other window's tab list lights up while you hover it, and on release the tab
    is there with its page still loaded (scroll position kept). Drag another row out onto the desktop. Pass: a new
    window opens under the pointer with that tab. Repeat with a top-strip chip (⇧⌘S) and a ⌘-click multi-selection.
12. **Cast** (§18, needs a Chromecast or Google TV on the same Wi‑Fi). View › Cast…. Pass: macOS asks once for Local
    Network access; the device shows in the picker; clicking it casts the tab (status "Casting tab", Stop), and the
    toolbar shows the highlighted cast button until you stop. On YouTube, the player's own Cast button opens the same
    picker and casts the video.
13. **PiP extras** (§18). On a YouTube video, Site Controls › Picture in Picture. Hover the PiP window. Pass: a dark
    pill with the host covers Chrome's origin row; clicking it brings the tab back with the video still playing.
    Right-click the PiP window: Back to Tab, Keep Window on Top (checked); unchecking it lets other windows cover
    the PiP. Drag the window mostly off the right edge of the screen and let go. Pass: it slides in, leaving a 28 pt
    strip with a chevron; clicking the strip brings it back; the same on the left edge; dragging it onto a second
    display doesn't stash it.
14. **Raycast** (§23, needs Raycast). `cd ~/Documents/netnyahoo/extras/raycast-netnyahoo && npm install && npm run dev`.
    In Raycast, run "Search Tabs" (Netnyahoo). Pass: macOS asks once whether Raycast may control Netnyahoo; the
    list shows your tabs with favicons and hosts; typing filters; ↵ switches to the tab and brings Netnyahoo
    forward; ⌃X closes a tab.

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
| Move tab to another window | ✓ | 🧪 | Tabs › Move to Window, the tab menu and Merge All Windows move the live page (history, form state, the Chrome tab via `MoveToBrowser`; ledger 10). Moving to another profile reloads, as it must. Dragging tabs (sidebar rows, pinned tiles, a multi-selection, top-strip chips) onto another window moves them there, its tab list lighting up while you hover; dropping outside every window tears them off into a new window under the pointer (layout/windowDrop.ts, unit-tested). Incognito tabs stay put. The drag itself needs a real mouse: checklist step 11 |
| Keep Window on Top | ✓ | ✅ | |
| Window › Move & Resize tiling (halves/quarters/arrange) | ✓ (macOS) | ✅ | AppKit adds Fill / Center / Move & Resize to our `windowsMenu` |
| Minimize / Minimize All / Zoom / Full Screen | ✓ | ✅ | Minimize All is the ⌥ alternate of Minimize |
| Drag window from chrome, double‑click to zoom | ✓ | ✅ | |
| Window backdrop tint + translucency | ✓ | ✅ | Dia 1.50's WindowTreatment stack (dia-spec › Window translucency): behind-window blur (material 29 dark / `.hudWindow` light, emphasized, follows the window's active state, so it goes opaque when inactive or with Reduce Transparency), BaseTint black 0.4 / white 0.8, and the profile colour's HSL gradient (ΔL 0.25) at 0.36 (neutral 0.12) in a view at 0.5 / 0.75. Plain AppKit layers, no per-frame work. Pink/plum tint fitted from Dia (#BB374B); the other colours use their swatch hue at the same saturation/lightness (unmeasured), light mode unmeasured |
| Warn before quitting / closing window with many tabs | ✓ | ✅ | ⌘Q warning; ⇧⌘W / close button on a window with 2+ tabs, and ⌘W on a window's last tab, use Dia's close-window confirmation ("Close 3 tabs?", per-profile breakdown, "Don’t ask me again"); setting in General |
| Quit guard with active downloads | ✓ | ✅ | |
| Battery Saver / freeze CPU‑heavy background tabs | ✓ | ✅ | lib/tabLifecycle: on battery or Low Power Mode, hidden tabs using ≥ 10 % CPU (engine task manager, two samples) freeze through CDP `Page.setWebLifecycleState` and thaw when shown; Dia's Activated/Deactivated toasts; Advanced › Battery Saver |
| Tab discarding (sleep idle tabs, keep last 10 alive) | ✓ | ✅ | lib/tabLifecycle: background tabs sleep after 30 min of app-active time (sooner under memory pressure); 10 most recent protected; never audio, capture, PiP, split, pinned mini player or unsaved input; faded icon + "This tab needs to reload"; recent tabs reload on launch. Sleeping is Chrome's own discard (in place, `WebContentsDiscard`): the tab keeps its back/forward list, `chrome.tabs` lists it `discarded: true`, and Chrome's own discards (memory pressure, `chrome.tabs.discard`) show as sleeping too. WebAudio-only sound isn't seen as playing |
| Sad‑tab / native error page with Reload | ✓ | ✅ | SadTab + Page Unresponsive (Wait / Exit Page) in layout/PaneOverlays |
| Offline page game (Chrome's dino) | ✓ (dino) | ✅ | Our own: "Where's Big Yahu?" (apps/browser/assets/offline-game) wherever Chrome shows the dino, in tabs and popups, with the error code, host and Retry; `netnyahoo://yahu` plays it on its own. Other net errors keep Chrome's page. Engine patch `chromium-neterror-yahu.patch` (docs/cef-source-build.md › "The offline page") |

## 2. Tabs
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| New tab ⌘T | ✓ | ✅ | |
| Close tab ⌘W (+ hover ✕) | ✓ | ✅ | |
| Close other tabs | ✓ | ✅ | |
| Close tabs above/below/left/right | ✓ | ✅ | sidebar: Above / Below; top strip: Close Tabs to the Left / Right (sidebar/menus.ts) |
| Close All Tabs ⇧⌘K | ✓ | ✅ | keeps pinned tabs and pinned groups |
| Reopen closed tab ⇧⌘T | ✓ (full state) | ✅ | position, pin, group, custom name/icon, mute and the back/forward list (with the current entry) come back: the closing tab's list is kept (this session) and restored through Chrome's own `chrome::AddRestoredTab` (`restore:<tab id>` adoption, CEF_NN_TAB_HISTORY). After a relaunch it reopens from its URL, like open tabs |
| Drag reorder | ✓ | ✅ | rows, pinned tiles, groups, splits, across sections, into/out of groups, onto the page to split |
| Haptic tick while reordering | ✓ | ✅ | setting in Tabs |
| Pin / unpin (grid of pinned tiles) | ✓ | ✅ | pins are mirrored into Chrome's tab strip |
| Pinned tab remembers base URL; "Back to Pinned URL" ⌘↩; Replace Pin; Edit Pinned Page | ✓ | ✅ | |
| Pinned tab badge | ✓ | ✅ | "Back to Pinned URL" badge on tiles away from their base URL |
| Duplicate tab | ✓ | ✅ | Chrome's Duplicate (`WebContents::Clone`): back/forward list and session storage, also from a sleeping tab; plus title, icon, name, mute (store/tabs.ts `duplicateTab`, `clone:<tab id>` adoption) |
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
| Selected/hover/pressed row styling + selected glow | ✓ | ✅ | Dia 1.50 selected tint (#121212 at 0.5 dark, white 0.7 light); not yet compared with Dia on screen (checklist step 10). Loading spinner in rows: Dia's `ActivitySpinnerView` (12 pt, 8 pt from the row's end, track + 72 % arc 1.5 pt wide in secondaryLabelColor, 1.88 s per turn), hidden under the hover close button |
| Pinned tile tooltip (title + URL) | ✓ | ✅ | hover card with title and URL |
| Website colour extended into tab bar / toolbar | ✓ | ✅ | nav bar tint from theme-color / header / background, eased; setting in Tabs |
| Profile indicator in sidebar header | ✓ | ✅ | menu: switch, new, rename, colour, icon, default, delete. Sized like Dia's SidebarProfileIndicatorButton: the whole name when it fits between the traffic lights and Downloads, cut short (fading) only if 52 pt of it fit, else just the icon |

## 5. Profiles & Spaces
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Profiles (separate cookies, logins, passwords, extensions, cards, history, chats) | ✓ | ✅ | a Chrome profile each (cookies, logins, Chrome's password manager, autofill addresses and cards, extensions, site settings), plus our history and bookmarks; chats ⏸ |
| Profile name + theme colour (+ icon) | ✓ | ✅ | name, 9 colours (window tint, NTP light, edge light, painted mark); optional initial, emoji or SF Symbol icon on the profile colour |
| Profile switcher, ⌃1–⌃9, next/previous, swipe between profiles | ✓ | ✅ | switcher, ⌃1–⌃9, Next/Previous Profile. Paging like Dia's PageSwipeController (layout/profilePager, numbers in dia-spec › Profile paging): two fingers (or a Magic Mouse finger) over the sidebar or the top tab strip page between profiles whatever Swipe between pages is set to; the neighbouring profile's page (its tiles and tabs, mounted only while paging) slides in beside the current one at Dia's half-speed tracking, rubber band at the ends, page-detent haptic, flick commit at 5 pt/s, 0.25 s critically damped settle carrying the release speed; the window tint cross-fades between the two profiles' colours; a wheel mouse's horizontal / Shift-scroll pages one profile per burst. ⌃1–9, Next/Previous Profile, the profile menu and the page dots slide the same way; the window switches profile when the page lands. Page dots (Dia's space switcher: 41 pt footer, 6 pt dots on a 12 pt pitch, labelColor 0.85/0.4/0.2) in the sidebar footer, brightness following the pages. Not yet: Dia's strip settle content fade, the switcher's edge scaling past 7 profiles and drag-to-reorder, the footer's Library/overflow buttons. Real-trackpad feel untested (ledger 44) |
| Create / rename / delete / make default / reorder profiles | ✓ | ✅ | Dia's Create Profile dialog; Settings › Profiles rows drag to reorder |
| Clear browsing data per profile | ✓ | ✅ | |
| Share data between profiles | ✓ | ✅ | profiles sharing one engine profile share cookies, logins, site data, passwords, extensions, zoom, history and bookmarks; tabs stay per profile |
| Guest profile | ✗ | — | not in Dia |
| Dock menu: New Window per profile | ✓ | ✅ | |
| Unload unused profiles | ✓ | ✅ | a profile no window has shown for 10 min: its tabs' browsers close (unlike sleeping, their history is lost), then its engine context is released (checked every 15 s). Whether Chrome then unloads the profile itself (ghost, hidden WebUI pages) hasn't been measured on the new engine |
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
| NTP layout (bar width, position, HUD blur material, fill, border, radius 20) | ✓ | ✅ | 1.50: bar edges fitted to 0.5 pt from the 1.50.1 intro capture: Dia's bar and mark sit 1 pt right of and below NewTabPageViewController's formulas for our card, and the bar is 112 pt tall; ours now match (2x layer snapshot). Inside the bar the input row and the chip row now sit where Dia's do (magnifier, chip borders, mic and send within 0.1 pt of the capture; the chip label 0.5 pt low). Still different: Dia's magnifier is ~3 pt further right and 1 pt smaller, and its placeholder ~5 % narrower |
| Logo: glass orb (1.49) → hand-painted mark per profile colour (1.50) | ✓ | ✅ | `Orb variant="painted"`: our own stand-in paintings matched to each Dia painting's OKLab lightness (within 0.02) and chroma. Outline fitted to the 1.50.1 capture: 76 pt (19/21 of Dia's 84 pt icon view), centre 48.6 pt above the bar; ours fits within 0.15 pt (it was 68.5 pt). The paintings' statistics were measured over a 68.5/84 middle, not the 76/84 now shown |
| Power‑up band intro | ✓ | ✅ | 1.50: one theme colour (grey 0.65 for Neutral), corner radius 20 |
| Area light (intro, breathing, fade) | ✓ | ✅ | palette follows the profile colour; Dia's clock model (skip-ahead, key/occlusion pause, × 0.5 when not key) |
| Edge light around bar | ✓ | ✅ | colour from the profile theme |
| Entrance spring / Reduce Motion | ✓ | ✅ | like Dia under Reduce Motion: no spring, no band, edge light settled, area light still |
| Profile‑colour NTP theme & gradient | ✓ | ✅ | the window colour is the translucent window treatment (row "Window backdrop tint + translucency"): 1.50's "lighter key tint" was the blur's active output, not a different tint, so `activeTint`/`inactiveTint` are gone; the content card is #121212 at 0.5 (white 0.7 light) over it, so the blur shows through the New Tab card at half strength. No grain in 1.50's stack (the Metal backdrop with grain remains only for the New Tab postcards) |
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
| Default search engine choice (Google, Bing, DDG, Perplexity, ChatGPT, custom, extension engines) | ✓ | ✅ | 12 built-ins + custom engines with keywords + the engines extensions add (`chrome_settings_overrides.search_provider`), read from Chrome's own TemplateURLService (its settings page's list, `components/extensions/searchEngines.ts`) whenever a profile's extensions change. They're listed under "Extensions" in Settings › Search Engine, can be made the default and have Tab-to-search keywords; like Chrome, an extension that asked to be the default (`is_default`) controls it ("… is controlling this setting", Manage / Disable) until it's disabled or removed, then the user's own choice is back. Verified with two fixture extensions (instance `polish`) |
| Site search (Tab‑to‑search) | ✓ | ✅ | engines, known sites, history scope |
| Calculator in command bar | ✓ | ✅ | ↩ copies the result |
| "new doc / sheet / jira / meeting / figma…" commands | ✓ | ✅ | 17 `*.new` shortcuts + browser actions in the bar, Share and Keyboard Shortcuts included (both now in `runCommand`) |
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
| Two‑finger swipe navigation (custom UI, works on native pages) | ✓ | 🧪 | NNSwipe + Dia's overlay (layout/SwipeOverlay), on web, New Tab and internal pages. Only synthetic events verified; needs a real trackpad (checklist step 9). NNSwipe sits in front of Chrome's own responder delegate and forwards to it (spelling, speech, dialog focus), except the scroll events Chrome's history swiper would act on |
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
| Quote link / "Super Copy" (text fragment link) | ✓ | ✅ | ⇧⌘C with a selection: Dia's toast with Copy Quote Link; page menu "Copy Link to Highlight" (Chrome's item, run by core/textFragment.ts for Dia's toast and clean link) |
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
| Clear browsing data | ✓ | ✅ | our history by visit time and its favicons, plus Chrome's BrowsingDataRemover for the same range: Chrome's history database (what `chrome.history` shows), cookies and every kind of site storage, cached files, live. Form data and passwords stay, as in the dialog's two options |
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
| Chrome Web Store MV3 extensions | ✓ | ✅ | installed by Chrome's WebstoreInstaller (location FROM_STORE, clients2 update URL), per profile; verified with Bitwarden and Dark Reader (W1). Auto-update verified end to end (W3): our build had
  never checked for updates (ungoogled's block-requests stub; fixed by `chromium-extension-updates.patch`). The store keeps a cosmetic "Switch to Chrome" banner |
| Web Store "Add" button | ✓ | ✅ | the store's own button runs Chrome's install flow; `CEF_NN_INSTALL_PROMPT` hands its confirmation to our Dia-style dialog with Chrome's warning list; buttons relabelled "Add to / Remove from Netnyahoo" (components/extensions/bridge.ts). Every store install goes this way (our own CRX download path is gone, so there's no launch race, Findings 9); a prompt Chrome still waits on is asked again after a JS reload |
| Extensions menu, pin extensions, toolbar buttons with badges and popups | ✓ | ✅ | Extensions menu (installed ones, Add Extension…, Manage Extensions…, Pin Extensions…); badge, title, popup, enabled state and `action.setIcon` images read straight from Chrome's `ExtensionAction` for the tab every 1.5 s and on tab switches (`CefGetExtensionActionState`; Chrome has no change event) |
| Manage Extensions (`dia://extensions`) | ✓ | ✅ | Settings › Extensions (on/off, details, site access, incognito, pin, reload, remove, add by link, load unpacked); `netnyahoo://extensions` is Chrome's own page (developer mode, errors, shortcuts) |
| Install/uninstall permission dialogs | ✓ | ✅ | install, re-enable and new-permission prompts through our dialog (verified, W1); removal asks with our "Remove “…”?" sheet from Settings, the toolbar menu and the store page, then Chrome uninstalls (engine verified, W2). The sheet itself needs a key window: checklist step 8 |
| chrome.tabs / chrome.windows | ✓ | ✅ | Chrome's real tabs and windows: one Chrome window per app window and profile, sidebar order, active/pinned both ways, `tabs.create` / `windows.create` / popups adopted as our tabs, moves between windows and profiles (ledger 1–14); sleeping tabs are `discarded: true`, and `tabs.discard` / `tabs.reload` sleep and wake them in the app. Known gap: an extension's `tabs.move` doesn't reorder the sidebar |
| action.onClicked (no popup), keyboard `commands`, extension context-menu items | ✓ | ✅ | onClicked + activeTab + `scripting.executeScript` verified (22); `chrome.commands` shortcuts forwarded to the key window's ghost Browser (13, NNWindowHost `ForwardKeyEvent`); `chrome.contextMenus` items show in the page menu and their `onClicked` runs (R1) |
| Side‑panel API | ✓ | ✅ | Dia's extension side panel: a card to the right of the page (header with the extension's icon, name, ⋯ menu and close; resizable 320–600 pt, width saved) showing the panel page outside the tab strip. Opens from the toolbar button (`openPanelOnActionClick`), the extension's menu and `chrome.sidePanel.open()`, closes with `close()` or `window.close()`; follows per-tab `setOptions` paths and closes where it's disabled. `chrome.tabs.query({active, currentWindow})` from the panel (and from popups) returns the page |
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
| Edit › AutoFill menu (Contact, Passwords, Credit Card) | ✓ | ✅ | like Chrome's field menu, each item opens Chrome's dropdown at the page's focused form field (engine hook `CefShowAutofillSuggestions`, `CEF_NN_AUTOFILL_TRIGGER`): Passwords… lists the saved passwords on any text field (Chrome's "Select password" fallback), Contact… and Credit Card… the field's own suggestions (addresses or cards). With no form field focused, they open Settings on the window's profile (Passwords, or Autofill). Verified: a focused address field got Chrome's dropdown window right under it, a blurred page opened Settings; picking an entry is Chrome's own (checklist step 4) |
| Password reveal button | ✓ | ✅ | eye button in the page's password field once the user types (never for a filled saved password; sites with their own toggle keep theirs) in `helper/page_script.js`, and reveal in Settings › Passwords. Not visually re-checked on Chrome tabs |

## 17. Privacy & security
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Built‑in ad + tracker blocker (EasyList, EasyPrivacy), per‑site toggle | ✓ | ✅ | uBlock Origin Lite (MV3 DNR + cosmetic) as a component extension in every profile, incognito included (ledger 16); per-site "disable on this site"; blocked count from `ERR_BLOCKED_BY_CLIENT` |
| Cookie‑banner blocking, regional lists | ✓ | 🟡 | uBOL's cookie and regional rulesets, toggles in Privacy › Advanced Ad Block Settings, which lists every uBOL ruleset truthfully (ads, trackers, cookie banners, annoyances, malware and scams, regional; filter counts; "On by default") and says which uBOL version the lists come from. Gap: the lists only change when the app ships a newer uBOL (a built-in extension doesn't update itself); there's no in-app list update |
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
| PiP stash, return to tab, hostname bar | ✓ | ✅ | on Chrome's own video PiP window, in-process (`NNPictureInPicture.mm`): the host pill on hover over Chrome's origin row (click: back to the tab, the video keeps playing there); right-click anywhere: Back to Tab / Keep Window on Top (remembered); dragged mostly past a screen's left or right edge it tucks in with a 28 pt peek and a chevron handle (click: back on screen), and stays tucked if Chrome moves it. Chrome's own controls unchanged. Verified with the DEV self-test (`NETNYAHOO_PIP_SELFTEST`, all 10 steps) and layer snapshots, not a real pointer drag (checklist step 13) |
| Mini player for pinned media tabs (skip ±15 s, art, marquee) | ✓ | ✅ | hover mini player + sidebar player |
| Cast (Google Cast) | ✓ | 🧪 | Chrome's Media Router drives our Cast picker (devices, status, Stop; "Sources" for tab or screen) from View › Cast…, Site Controls › Cast…, the page menu's Cast… and a site's own Cast button (Presentation API); the toolbar shows a highlighted cast button while this profile casts (click: the picker; right-click: Stop Casting). Discovery runs in this build (mDNS + DIAL started, `media-router-internals`); no Cast device was on the test network, so casting itself is checklist step 12 |
| Screen‑share indicator, "Share this tab instead" | ✓ | ✅ | indicator (red capture glyph + tab badges); Dia-style picker with Tabs (tab video + tab audio through our tab-capture patch), screens and windows. While a site shares a tab, Dia's info bar sits above the page: "Sharing this tab with …" with Stop Sharing on the shared tab, "Sharing another tab with …" with Share This Tab Instead on the profile's other pages (the site's tracks keep running with the new tab), Dismiss on both |
| Camera / mic permission prompts | ✓ | ✅ | our prompt, no Chrome bubble (ledger 23) |
| Notifications permission | ✓ | ✅ | our prompt, then macOS permission; the page script shows web notifications natively with click-through |
| Location permission | ✓ | ✅ | our prompt verified (Don't Allow → denied); Allow (which raises macOS's own prompt) not run yet |
| Bluetooth permission | ✓ | ✅ | Chrome's device chooser drawn as our prompt under the address ("example.com wants to pair", devices with signal and paired / connected state, Scanning…, Scan Again, Bluetooth off / no macOS access with a link to System Settings, Pair / Cancel); also WebUSB, WebHID and Web Serial choosers and requestLEScan's scanning prompt. Verified with the Mac's real Bluetooth devices listed and Cancel rejecting the page's request |
| Fullscreen video (incl. other display) | ✓ | 🧪 | page fullscreen puts our window into fullscreen while the ghost stays put (`CEF_NN_TAB_FULLSCREEN`); Esc exits. Changes Spaces, so checklist step 1 |
| Proprietary codecs (H.264 / AAC / MP4) | ✓ | ✅ | our CEF build (`proprietary_codecs`, `ffmpeg_branding="Chrome"`, VideoToolbox decode) |
| Protected video (Widevine DRM: Netflix, Spotify…) | ✓ | ⛔ | Widevine is compiled in, but the CDM arrives through the component updater, whose Google host domain substitution removed, and a shipping app also needs Google's VMP signing. Settings › Advanced's Widevine row says it isn't available in this build (no update button) |

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
| Import from Chrome, Safari, Firefox, Edge, Brave, Opera, Vivaldi, Arc, Dia, Helium | ✓ | ✅ | + Opera GX, Island, Chrome channels, Chromium; bookmarks, history, open tabs, passwords (into Chrome's password manager). Dia and Helium (imput's ungoogled-chromium) import as ordinary Chromium — Dia's tabs are plaintext SNSS, secrets under "Dia Safe Storage"; Helium's Keychain item is "Helium Storage Key" / "Helium". Chrome and Brave protect their data from other apps on current macOS, so they're listed as "Needs Full Disk Access" and go through the same FDA step as Safari |
| Safari direct import (no export .zip) | — | ✅ | Reads `~/Library/Safari` directly (bookmarks, history, Reading List, open tabs) when Netnyahoo has Full Disk Access; the import UI detects FDA, links to System Settings and re-checks on return. The export `.zip` stays as the fallback and the only path for Safari passwords/cards |
| Arc import (spaces, pinned tabs, custom names) | ✓ | ✅ | |
| Dia sidebar import (spaces, pinned tiles, custom names/colours) | ✓ | ⛔ | Dia moved its sidebar out of Arc's `StorableSidebar.json` into a SQLCipher-encrypted `tabs.db` (GRDB; tables `nodes`/`tabs`/`tab_groups`/`spaces`/`windows`/`content_panes`, columns `space_id`/`custom_title`/`custom_icon`/`title_source`/`pinned_container`/`favorites`). Its key is derived by CryptoKit HKDF-SHA256, so decrypting it isn't implemented — and verifying against the real profile would mean decrypting real browsing data, which the data rules forbid. Dia's open tabs still import from its plaintext SNSS `Sessions/` |
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
| Liquid Glass / "Sunglow" refresh (1.50) | ✓ | 🟡 | painted New Tab mark, bar shadows, one-colour power-up band, selected-tab tint, 0.25 s profile-swipe settle done (WP11); the lighter 1.50 key tint and 0.5 card, the bar's 1 pt offset and 112 pt height, and the tab loading spinner (R3). Dia uses no Liquid Glass API; app icon stays ours. R3 also fitted the painted mark's size (76 pt), the bar's rows and the lighter grain. Open: the breadcrumb's host-only rule; a side-by-side check against Dia 1.50.1 (checklist step 10) |
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
| Passwords / Autofill / Extensions (Chrome's) | ✓ | ✅ | Passwords: Chrome's password manager per profile, unlock through Chrome's device check, CSV import. Autofill: addresses, cards and the two "offer to save" toggles per profile (the toggles are read once the profile has loaded: a profile without a window only initializes then). Extensions: per profile |
| Sync | ✓ | ⛔ | needs the Sync server |
| Keyboard Shortcuts (remap any action, F‑keys, conflict handling) | ✓ | ✅ | every menu command, recorder, conflicts filter, reset |
| Usage / Billing | ✓ | — | |
| Advanced | ✓ | ✅ | Battery Saver, the engine version, Widevine ("not available in this build"); also our Search Engine, Live Folders and Calendar panes |

## 23. Developer & scripting
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| DevTools ⌥⌘I / F12 | ✓ | ✅ | ⌥⌘I, F12 (hidden alias), context-menu Inspect; View › Developer › View Source ⌥⌘U (`view-source:` tab) and JavaScript Console ⌥⌘J |
| Task Manager | ✓ | ✅ | Chromium task rows, CPU/memory, End Process |
| AppleScript dictionary (windows, tabs, profiles, execute JS) | ✓ | ✅ | Netnyahoo.sdef; execute runs through the renderer's `nn-eval`, which works on Chrome tabs |
| Raycast extension support (via AppleScript) | ✓ | 🧪 | `extras/raycast-netnyahoo`: Search Tabs lists every window's tabs and switches to one (also Copy URL, Close Tab), through the AppleScript dictionary. Its scripts were run against a live instance with the app's DEV AppleScript runner; installing it in Raycast (`npm install`, `npm run dev`) is checklist step 14 |
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
| Edit | ✓ | ✅ Undo … Select All, Copy URL (as Markdown), Paste and Match Style; Find ▸ (Find, Find and Replace, Next, Previous, Use Selection for Find, Jump to Selection); Spelling and Grammar, Substitutions, Transformations, Speech; AutoFill ▸ (Contact…, Passwords…, Credit Card…: Chrome's dropdown at the focused field, else Settings, see §16) |
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

1. **Dead code from the Alloy era and retired APIs. Mostly removed** (R1, R2 and R3 each in their files):
   `WebView.tsx`'s retired props, no-op and never-called methods and old-build shims, `legacyCommand`,
   `generatePassword`, `getZoom` / `ZOOM_LEVELS`, the `AutofillEvent` types, `isSwipeNavigationEnabled`,
   `updateFilterLists`, `setExtensionPinned`, `extensionPopupUrl`, `openDownload` / `revealDownload`,
   `resolveOpenedTab`, and NNExtensionPackage's CRX download-and-verify path (now only manifest reading for Load
   Unpacked). Also gone since: the `unlockPasswords` old-build fallback and with it the shell's `authenticate`, and
   `updateComponent` (Findings 11). Still there: `ZoomState.pinchScale` (sent, never read; the page script's `pinch`
   report feeds it). R2 also dropped `checkContentBlocking`'s JS export, the extension tab model and its "probe"
   extensions (tab ids now come from Chrome itself; with `NN_CHROME_TABS 0` toolbar badges fall back to the
   extension's defaults) and the `TabsRequest` actions that no longer occur. The `NN_CHROME_TABS 0` fallbacks stay: the stock-CEF build is kept (12). Alloy stays on
   purpose for the hidden WebUI helper pages and non-hostable views (NNChromePages.mm, NNWindowHost.mm `CreateTab`).
2. **Fixed (R1).** Page context menu on Chrome tabs: it's Chrome's own menu now, with our search engine's name and
   action on "Search … for", our Inspect, Dia's quote link on "Copy Link to Highlight", our split for "Open Link in
   Split View", and items for Chrome UI we don't show removed (translate, Lens, QR code, send to devices, reading
   mode, "Open Link as" profiles). Chrome's Cast… is back (R2): it opens our Cast picker. Extension items show and run.
3. **Fixed (R1).** NNSwipe sits in front of Chrome's responder delegate and forwards everything but the scroll events
   Chrome's history swiper would act on; spelling and speech validate again.
4. **Fixed (R1).** Sleeping is Chrome's in-place discard (`WebContentsDiscard`), and every discard of a hosted tab,
   Chrome's own included, reaches the app (`OnTabDiscardedChanged`).
5. **Fixed (R1).** Clear Browsing Data goes through Chrome's BrowsingDataRemover (Chrome's history, site data and
   cache for the range); the next-launch disk wipe is gone.
6. **Fixed (R3).** Command bar "Share" and "Keyboard Shortcuts" did nothing: `runCommand` had no case for either.
   Both cases moved from `appIntegration.ts` into `runCommand`, which the menus and the bar share.
7. **Fixed (R2).** Content blocker sheet: the fake "Update Lists" is gone; every ruleset shows under its category,
   annoyances and malware included, with its filter count and whether it's on by default, and the footer names the
   uBOL version the lists come from. The lists still only change when the bundled uBOL (`vendor/ubol`) is bumped.
8. **Fixed (R3).** The Autofill pane's toggles ignored the selected profile. They follow the picker now, and are read
   after the profile's list call: a profile with no window open has no initialized request context before that, so
   its prefs read as defaults and a write is dropped (seen: a toggle set before that call didn't stick).
9. **Fixed (R2).** Web Store install race: the store script no longer overrides `webstorePrivate` at all and our
   CRX download path is gone, so every store install, including one from a store page restored at launch, is
   Chrome's (verified: Dark Reader from a session-restored store tab installed FROM_STORE through our dialog).
10. **Extensions see Chrome's bookmarks and history, not ours.** Our bookmarks and history live in our JSON stores,
    so `chrome.bookmarks` is empty and `chrome.history` holds only what Chrome recorded itself (5).
11. **Fixed (R3).** The Widevine row offered an update that can't download (and never completed). It now says
    Widevine isn't available in this build; `updateComponent` is gone from the engine API.
12. **Fixed (R3): the stock-CEF path stays.** `NN_CHROME_TABS` is now a build setting (`NetnyahooCEF.podspec` passes
    it to the preprocessor, default 1): `CEF_PREBUILT=1 packages/cef/scripts/setup.sh`, then `xcodebuild …
    NN_CHROME_TABS=0` builds and runs against the stock 154.0.26 prebuilt (checked; README and
    `docs/cef-source-build.md`). So 1's `NN_CHROME_TABS 0` fallbacks stay.
13. **Fixed (R3): docs and comments that contradicted the code.** `docs/agent-brief.md` rewritten for the current
    architecture (Chrome-style CEF, `NETNYAHOO_BACKGROUND` / NNActivation, the own-CEF rebuild flow, `packages/import`,
    no `packages/webkit`, a repo with history); `docs/migration-status.md`'s finished "In progress", "Known regressions"
    and "Remaining after the build" sections and the BRANDING notes on tests 40–41; an as-built note on
    `docs/research/chromium-ui-layer.md` WP3; the Info.plist "Distribution" block (now the real key names); the
    NNFavicons, Move to Window, Alloy screen-sharing, import-Keychain and `Menus.swift` comments; the README (it still
    described WebKit). The `NNSwipe.mm` responder-delegate comment went with Findings 3 (R1).
14. No `TODO`/`FIXME`/`XXX` markers in the code paths audited.

# Dia feature parity

Dia = installed build **1.49.1 (87398), Chromium 153** plus the public changelog up to **v1.50.0 (2026‑09‑24)**;
visual rows re-checked against **1.50.1 (87750)** (`docs/dia-spec.md` › "1.50 Sunglow").
Netnyahoo = this working tree on **2026‑09‑25, after the Chrome migration**: then our patched Chrome-style CEF
(154.0.28, `docs/cef-source-build.md`), where every app window is Chrome's own Browser window
(since 0.2.0, `docs/research/chrome-hosted-window.md`) and every tab a real Chrome tab of it, hosted in our React
Native views. Since 2026‑10‑01 the app runs on NNCore, Chrome's own framework from the same tree with our layer
(`docs/nncore-parity.md`); the rows hold for both.

How this audit was done: every non-AI row re-read against the code (packages/cef, apps/browser/src, packages/shell,
packages/core, the Xcode project), not against earlier claims. Runtime evidence comes from the migration ledger,
`docs/migration-status.md`; "ledger N" below means its test N. Nothing was built or run for this audit.

Legend: **✅** done · **🧪** built, but the deciding test needs the user present (see the checklist) · **🟡** partial ·
**❌** missing · **⛔** blocked by something outside our control (named in the Gap) · **⏸** deferred (AI), on purpose ·
**—** not applicable

## Summary

**307 feature rows** (§1–§25, recounted from the tables on 2026-09-26):

| ✅ done | 🧪 needs the user | 🟡 partial | ❌ missing | ⛔ blocked | ⏸ deferred (AI) | — n/a |
|---|---|---|---|---|---|---|
| 230 | 1 | 2 | 0 | 1 | 59 | 14 |

Of the 234 rows that count (not ⏸ or —), 230 are done (98 %), 231 with the one 🧪 row (Cast). The two 🟡 rows are
passkeys (iCloud Keychain waits on Apple) and the Dia sidebar import (profiles, open and pinned tabs come through
Dia's AppleScript; custom names, colours, spaces and folders don't). Keyboard shortcuts: every Dia and Chrome
shortcut is bound (Dia's where they clash) except Chat (⏸) and a few for Chrome's own hidden UI. Menus: all ten exist and match.

The summary before this recount (304 rows, 207 ✅, 9 🟡, 7 ⛔) didn't match its tables, which held 307 rows: 211 ✅,
7 🟡, 8 ⛔ (its 🟡 count included the View and Help menu rows, which sit outside §1–§25).

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
- Since, from the partial-rows pass (2026-09-26): done, the Sunglow row (checked side by side with Dia 1.50.1),
  the host-only URL bar (Dia's rule, from its binary), the Help menu (Send Feedback opens a GitHub issue) and the
  onboarding row (Dia's Trial Guide is —) (🟡 → ✅); the overflow menu and the mic button have nothing left but
  Sync and AI (🟡 → ⛔ / ⏸); regional block lists now follow the system languages (§17 stays 🟡 for list freshness).
- Since, from the loose-ends pass (2026-09-26, after 0.2.2): done, the block lists' freshness (every release moves
  to uBlock Origin Lite's latest, `scripts/update-ubol.sh`) and auto-updates (notarized, signed releases through
  the GitHub appcast since 0.2.1) and Translate, on Apple's on-device Translation framework (macOS 26)
  (🟡 / ⛔ → ✅). Every ⛔ row now names what blocks it; Dia's sidebar import is blocked by Dia's keychain access
  group, not by missing code.
- Since, from the headless verification pass (2026-09-26, hidden instances, the screen locked; tests in
  `docs/migration-status.md` › "Headless verification of the 🧪 rows"): eight of the nine 🧪 rows are verified end to
  end but for what only hands and eyes can check (🧪 → ✅). The pass found and fixed: a crash of the whole app on
  focusing a card field with a saved card on a secure page, Chrome's password generation never being offered (it
  needed password sync), leaving window full screen leaving the page full screen, a full-screen page in another
  profile's window taking the window out of full screen, and AppleScript's `make new window with properties
  {URL:…}` failing. Cast stays 🧪: casting itself needs a device.
- Since, from the sync pass (2026-09-26): Sync is built without a server (⛔ → ✅, 5 rows: E2E-encrypted sync,
  per-profile sync, synced devices' tabs, the overflow menu's synced devices, the Sync pane). Every Mac reads and
  writes sealed files in a folder the user picks, iCloud Drive by default, keyed by Dia's 24-word phrase
  (`docs/sync.md`). Verified by unit tests and two- and three-instance end-to-end runs through a temporary folder;
  the real two-Mac run over iCloud Drive is checklist step 15. The run found and fixed ids that two Macs launched
  in the same millisecond made alike (store ids now have a random part).
- Still blocked: Widevine DRM, Dia's sidebar import, and iCloud Keychain passkeys (inside the 🟡 passkeys row).

## Remaining work

Three agent-sized packages. Each owns the files listed (shared files, such as Menus.swift, commands.ts, settings.ts,
theme.ts and App.tsx, take small additive edits only, as the agent brief says). Each package deletes the dead code in
its own files (Findings 1).

**R1 · Tab state on Chrome** (engine + store) — **done 2026-09-25** (`docs/migration-status.md` › "R1"; CEF hooks
in `engine/patches/cef-tab-state.patch`).
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

The 🧪 row (Cast) needs no code until the user checklist below finds a problem. The checklist also keeps the hand and eye checks left in rows that are ✅.

### ⛔ Blocked, and what would unblock it
| Item | Blocked by | Unblocks when |
|---|---|---|
| Protected video, Widevine (§18) | Google licenses the CDM only to VMP-signed browsers; the CDM comes through its component updater, whose host is substituted | Google grants a Widevine licence and VMP signing; then we allow the component updater host (or bundle the CDM) |
| iCloud Keychain passkeys (inside §16's passkeys row) | Apple hasn't granted `com.apple.developer.web-browser.public-key-credential`, which macOS requires before a browser may use iCloud Keychain passkeys for any site | the grant arrives: switch `CODE_SIGN_ENTITLEMENTS` to `Netnyahoo-ICloudPasskeys.entitlements` (ledger 42) |
| Dia sidebar import's custom tab names, colours, spaces and folders (inside §20's 🟡 row) | Dia's `tabs.db` is encrypted with a key from its team's keychain access group, and Dia's AppleScript dictionary doesn't expose them | Dia exports its sidebar, keeps it readable, or adds them to its dictionary |

## Needs the user present: test script (about 35 minutes)

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
   Control shows a single Netnyahoo window; **Esc** brings the window back to its
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
6. **Passkeys on Google** (ledger 40). At accounts.google.com, sign in to an account that has a passkey. When it
   says "Complete sign-in using your passkey", pass if Chrome's dialog shows over the page within a second or two:
   with the passkey on your iPhone (iCloud Keychain), "Use your phone or tablet" and a QR code; scanning it with the
   iPhone camera and approving with Face ID signs you in. Cancel must bring back Google's "Try another way". Then on
   `https://webauthn.io`, set Advanced Settings › User Verification to Required, pick Platform, Register: Chrome's
   "Create a passkey" sheet, Continue, the macOS Touch ID sheet; Authenticate the same way. (iCloud Keychain
   passkeys can't be offered until Apple grants the entitlement, ledger 42.)
7. **Phone passkey** (ledger 39). On webauthn.io, register a second username and choose "Use a phone or tablet";
   scan the QR code with your phone's camera. Pass: the phone connects and saves the passkey; Authenticate with the
   phone succeeds.
8. **Remove-extension sheet** (W2). ⌘, › Extensions › Load unpacked…, pick
   `~/Documents/netnyahoo/spikes/nncore-host/fixtures/ext`, confirm Add. Then Remove on its row. Pass: a sheet
   attached to the Settings window, "Remove “nn component test”?" with Cancel and a red Remove; Cancel keeps it,
   Remove takes it off the list. If you have a store extension installed, "Remove from Netnyahoo" on its store
   page must show the same sheet on the browser window.
9. **Quick extras.** (a) With System Settings › Trackpad › More Gestures › Swipe between pages on, on a page with history, swipe back with two fingers on the trackpad. Pass: Dia's frosted
   circle and chevron, a haptic at the threshold, back on release; a horizontally scrolling carousel scrolls
   first. (b) On `/login.html`, Choose File. Pass: the Open panel attaches to or centres on our window, and the
   chosen name shows. (c) ⌘P. Pass: Chrome's print preview over the page, Cancel closes it. (d) Right-click a link.
   Pass: the menu shows, "Open Link in New Tab" once, and choosing it opens a background tab (the menu's content
   and items were verified headless; showing the NSMenu wasn't). (e) With a text field focused in a page, the Edit ›
   Spelling and Grammar items are enabled (the page view's validation was verified headless).
10. **Visual QA against Dia 1.50.1** (ledger 28–31). Same profile colour, same window size, dark mode first, the two
    windows side by side. (a) New Tab: Big Yahu's footprint next to Dia's mark (his top about 84 pt above the bar, cut at
    its top edge; the mark is ours on purpose). (b) The selected tab row's tint in the sidebar, then in light mode. (c) Light mode: the command bar's
    shadow under its bottom edge. (d) Done: Dia's host-only rule came from its binary (§8), and the dark New Tab was
    compared with a stored Dia capture (bar and mark geometry, colours; §21's Sunglow row). (e) A loading tab: the spinner at the row's end (ours copies Dia's `transform.rotation.z` 0 → −2π in its unflipped
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
15. **Sync over iCloud Drive** (§13, §20, §22; needs two Macs signed in to the same iCloud account with iCloud Drive
    on, each running this build without `NETNYAHOO_DATA_DIR`, so they use the real Keychain and iCloud Drive). On Mac
    1: ⌘, › Sync › Turn On Sync. Pass: the Recovery Kit sheet; Save… writes "Netnyahoo Recovery Kit.pdf" with the 24
    words and a QR code; Finder shows `iCloud Drive › Netnyahoo Sync` holding one folder of unreadable names. If macOS
    asks whether Netnyahoo may use iCloud Drive, allow it and note it. On Mac 2: ⌘, › Sync. Pass: "This folder has
    synced data already"; Enter Recovery Phrase…, paste the words (or scan the kit's QR code with your iPhone and
    paste with Universal Clipboard), Connect. Within a minute, pass if on Mac 2: Mac 1's bookmarks, recent history,
    pinned tabs, settings and a saved password (⌘, › Passwords) are there, and the overflow menu (the chevron at the
    sidebar's bottom) shows "Your … Tabs" with Mac 1's open tabs. Change a bookmark and a setting on Mac 2. Pass: Mac
    1 has them within a minute or two (as fast as iCloud Drive carries files). Put Mac 2 to sleep, make changes on Mac
    1, wake Mac 2. Pass: it catches up. Finally ⌘, › Sync › Advanced… › Stop Syncing… on Mac 2, Keep Sync Data. Pass:
    everything stays on Mac 2, and Mac 1's devices list drops it.
16. **Dia tab import** (§20, needs Dia running with a few pinned and open tabs in two profiles). Netnyahoo › Import from
    Another Browser…, pick "Dia: open and pinned tabs (via Dia)", Continue. Pass: the window explains the macOS
    prompt before it shows; Continue shows macOS's "“Netnyahoo” wants access to control “Dia”" with our reason;
    Allow. Pass: the profile step lists Dia's profiles with their pinned and open counts; importing puts each
    profile's pinned tabs at the top in Dia's order and its open tabs in "Imported", with no dia:// pages and no
    duplicates. Run it again. Pass: nothing new is added. Then in System Settings › Privacy & Security ›
    Automation turn Dia off under Netnyahoo and repeat. Pass: the window says it's blocked and links there; turning
    Dia back on and returning continues on its own. Quit Dia and repeat. Pass: "Open Dia" opens it behind the window
    and the import continues.

## 1. Windows & app shell
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Transparent titlebar, traffic lights in sidebar header | ✓ | ✅ | |
| Window frame autosave | ✓ | ✅ | frame kept per window in session.json |
| Multiple windows (⌘N) | ✓ | ✅ | each store window is Chrome's own Browser window with our React root over its views (one Chrome window per profile it shows, the root moving to the profile shown); closing the last window keeps the app running. A new window shows up at its final frame with its content, as Dia's: it waits, transparent, until its React content is in (RCTContentDidAppear, at most 0.6 s) and takes the keyboard then; a closed window leaves the screen at once (fixed 2026-10-01, rec1522: an empty window with its traffic lights, then the sidebar over an unpainted page, for several frames; a window closing with nothing in it). `apps/browser/scripts/windowing-test.mjs`. Left for a person: ⌘N on a busy machine, by eye |
| Incognito window (⇧⌘N), dark by default, excluded from AI | ✓ | ✅ | in-memory `incognito:<window>@<profile>` profile: the off-the-record profile of the profile it was opened from, as Chrome's (`GetPrimaryOTRProfile`): private windows of one profile share cookies and storage, another profile's never, and the session ends with its profile's last private window; its site settings, Clear Site Data and zoom act on that session alone and go with it, as Chrome's incognito (engine calls take `offTheRecord`, ABI 2); always dark; no history; closed-tab records only while the window is open, never on disk. Fixed 2026-10-06: every private window was Personal's, even from profile 2 (its extensions, bookmarks and session were Personal's), and a private window's downloads were listed in regular windows and saved to downloads.json. Verified headless (16/16, `otr/verify.mjs` on a train build, 6/15 on the build before): a cookie and localStorage set in profile 2's private window aren't seen by Personal's private window or either regular profile, a second profile-2 private window sees them, after both close a new one starts clean while Personal's keeps its own; the download is listed only in profile 2's private windows and never written; a permission allowed there stays out of both regular profiles' settings; a relaunch restores no private window; `store/privateSessions.test.mjs` (10 cases). Left for a person: ⇧⌘N from the menu bar in a profile-2 window, Open Link in Incognito Window from a profile-2 page |
| Close Window ⇧⌘W | ✓ | ✅ | |
| Small Yahu (Arc's **Little Arc**; an Arc feature, not Dia's) | — (Arc ✓) | ✅ | File › New Small Yahu Window (⌥⌘N, also the Dock menu) opens a small window with one page and no sidebar, centred a little above the middle of the screen you're on (the one with the pointer when a link comes from another app), on the current Space, at its last size (never its last position; `settings.smallYahuSize`, 900×640 at first). A thin bar in the profile's colour holds the window buttons, the page's favicon, host and title (click or ⌘L: the compact omnibox dropdown, same parsing and suggestions as the main window), Copy Link and Open in Netnyahoo (⌘O; ⌘O stays Open File… in main windows). Links from other apps open there, in the profile of the window used last (Settings › General › "Open links from other apps in": Small Yahu, the default, or A new tab; File › "Open Links from Other Apps in Main Window" switches from the menu bar, Small Yahu's included, and reads "…in Small Yahu" once switched; one http/https/file link each, a new Small Yahu even when one is in front; several at once, or set to A new tab, open as tabs of the frontmost main window showing that profile, else the frontmost main window paged to it, which comes forward; with no window open a window opens with them, and on a cold launch the launch's blank window takes the link instead of keeping an empty tab beside it; 2026-10-04). Links in the page stay in it; target=_blank, ⌘-click and split links open behind, as tabs of the main window. ⌘O moves the live page (same Chrome tab: history, form text, scroll, playing video; nothing reloads) into the frontmost main window of its profile, opening one if needed, and Small Yahu closes. ⌘W, the close button, or Esc the page didn't use (not in a field, no page full screen; `NNClient` reports it) close it and throw the page away: it stays in History, isn't saved with the session, and ⇧⌘T reopens it in Small Yahu with its back/forward list. It's a real Chrome window of the profile (context menus, downloads, permissions, passkeys, extensions' content scripts, PiP, find). Tab, sidebar and profile commands are off there; New Tab, History and the like go to the main window. Store: `BrowserWindow.kind = "small"` (store/small.ts, components/smallYahu). Verified headless 2026-09-30: ⌥⌘N, a GURL Apple Event routed to Small Yahu and (setting off) to a tab, ⌘L + typing (URL and search), ⌘O keeping the page (same CDP target, `loadedAt`, typed text, scroll 777, `history.length`, a running counter and an unpaused video), Esc in a field (stays) and on the page (closes), ⌘W, ⇧⌘T, target=_blank, the remembered size, and no window of the test instance above other apps. Fixed 2026-10-03 (owner's report: a link clicked in Discord brought the app forward and opened nothing): 0.2.22 and 0.2.23, the first on NNCore, dropped every link from other apps, cold launch included. AppKit registers its GURL handler in -[NSApp finishLaunching] only if NSApp.delegate answers application:openURLs: at that moment, and NNCoreHost set its bootstrap delegate from the WillFinishLaunching notification, which comes after; it now goes in at the start of finishLaunching. Verified headless with real GURL Apple Events to the test instance's pid (7/7: Small Yahu with the page, in front; a second one while one is in front; two URLs in one event as tabs of the main window; the setting off; ⌥⌘N; no window open; a cold launch with a URL, opened once), all seven failing on 0.2.23; the release smoke test now sends one (`gurl.swift`). Fixed 2026-10-06 (owner's report: on profile 2, every link from another app opened Small Yahu in profile 1): links from other apps took Settings › Profiles' default profile. Now they follow the window used last, as Chrome's AppController does (`lastProfile`, set when a window becomes main, a private window counting as its original profile; kept as Chrome's last-used profile across a relaunch): `ui.lastProfileId` (store/small.ts `lastActiveProfile`) is set when a window becomes key or the key one pages to another profile; when the window in front closes it passes to the next one in focus order (a private window closing keeps its regular profile until another window becomes key, and the last window closing keeps its own); it is saved with the session (after a relaunch the restored window that becomes key takes over, as in Chrome) and forgotten if its profile is deleted; a private window counts as the profile it was opened from (`originalProfileId`), so Small Yahu is never private and never shares the private window's cookies; ⌘O goes to the frontmost window of that profile. The default profile is now for new windows only (and links before any window was used). Dia has per-site link rules (`ExternalLinkRule` in its binary), not covered here. Verified headless with GURL Apple Events to the test instance's pid (12/12): Small Yahu's page has the chosen profile's cookie and Chrome browser context (two profiles, two windows, a private window opened from profile 2 and then closed, the window in front closing, a relaunch); unit tests in store/small.test.mjs. Left for a person: a real click from Discord, Spaces and focus when a link comes from another app, Copy Link (the clipboard is the owner's), resizing by hand, the bar by eye |
| Reopen closed **window** / recently closed groups | ✓ | ✅ | File › Reopen Closed Window, History › Recently Closed (+ Recently Closed Groups). Each tab that had a page keeps its back/forward list, as for ⇧⌘T: the shown tab loads with it, the others when you first show them (`Tab.restoreFrom`, then `restore:<tab id>`); in this session only (until 2026-09-30 they came back with no Back) |
| Merge All Windows | ✓ | ✅ | groups survive the merge; pages move without reloading |
| Move tab to another window | ✓ | ✅ | Tabs › Move to Window, the tab menu and Merge All Windows move the live page (history, form state, the Chrome tab via `MoveToBrowser`; ledger 10). Moving to another profile reloads, as it must. Dragging tabs (sidebar rows, pinned tiles, a multi-selection, top-strip chips) onto another window moves them there, its tab list lighting up while you hover; dropping outside every window tears them off into a new window under the pointer (layout/windowDrop.ts). Incognito tabs stay put. Verified headless (2026-09-26): the command path, New Window and Merge All Windows keep the same CDP target, document, history, typed text and scroll, and the WebContents lands in the target window's Chrome window (17 checks); a sidebar row dragged through AppKit's event path (DEV `drag:`) onto the other window moves the tab with its page, and one dragged onto the desktop tears off (4 checks). Fixed 2026-10-01 (rec1522): a window's last tab dropped onto another window closed with its window (the window went before the tab's new view took it) and loaded afresh in a new tab, blank for ~280 ms with its history gone; the closing window now hands such a tab to a hidden window until its new view takes it (`keepTransfersOfWindow:`), and `windowing-test.mjs` checks it's the same Chrome tab. Left for a person: the drag with a real mouse, and the hover highlight by eye (checklist step 11) |
| Keep Window on Top | ✓ | ✅ | |
| Window › Move & Resize tiling (halves/quarters/arrange) | ✓ (macOS) | ✅ | AppKit adds Fill / Center / Move & Resize / Full Screen Tile and their fn-⌃ shortcuts to our `windowsMenu` as it opens (after Window › Zoom, added 2026-10-05: the menu had none). Verified headless (2026-10-05): the window is tileable (`_canEnterTileMode`), its green-button Move & Resize menu is complete, and Fill, Left, Zoom and fn-⌃R picked from the menus move the window. Left for a person: the fn-⌃ shortcuts from a real keyboard (they arrive as system hot keys a test can't post), the green button's hover menu, dragging to a screen edge or the top to tile |
| Minimize / Minimize All / Zoom / Full Screen | ✓ | ✅ | Minimize All is the ⌥ alternate of Minimize; Window › Zoom since 2026-10-05 (it was missing) |
| Drag window from chrome, double‑click to zoom | ✓ | ✅ | Fixed 2026-10-05 (the owner's 0.2.25 report, tabs on top: "can't re-position … or double click to fill"): the tabs' scroll view covers the whole strip, so a press on its empty part never reached the drag region; AppKit moved the window only in its 32 pt title-bar band (not the strip's bottom 10 pt) and a double-click did nothing anywhere. The sidebar header's row covered its drag region the same way. Now each drag region (`WindowDragRegion`, packages/shell) takes the window's presses inside it that land on itself or on a scroll view's empty background: a press moves the window (a real window-server drag, so screen-edge tiling works), a double-click does the title bar's own action on release (System Settings › Desktop & Dock: Fill, Zoom, Minimize or nothing; ⌥ as AppKit), ⌘-drag leaves a background window behind. Tabs, buttons, the profile chip and the address field keep their presses. `tab-drag-test.mjs` (the whole strip height drags, a double-click zooms and back; 19 cases). Left for a person: the drag and double-click with a real mouse, in both layouts |
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
| Close tab ⌘W (+ hover ✕) | ✓ | ✅ | a pinned tab, or a tab of a pinned group, keeps its row and unloads its page (Dia 1.50.1: ⌘W closes with `deselectPinnedIfActive`, and a tab whose container is pinned gets the `dismiss` close button). As in Dia (screen recording, 2026-09-29): with no regular tab left, ⌘W on a pinned tab shows another pinned tab whose page is still loaded, and closing the last tab closes the window even with unloaded pinned tiles left, so holding ⌘W never reloads them (0.2.7 alternated between a New Tab page and a cold load of the pinned page) |
| Close other tabs | ✓ | ✅ | |
| Close tabs above/below/left/right | ✓ | ✅ | sidebar: Above / Below; top strip: Close Tabs to the Left / Right (sidebar/menus.ts) |
| Close All Tabs ⇧⌘K | ✓ | ✅ | keeps pinned tabs and pinned groups |
| Reopen closed tab ⇧⌘T | ✓ (full state) | ✅ | position, pin, group, custom name/icon, mute and the back/forward list (with the current entry) come back: the closing tab's list is kept (this session) and restored through Chrome's own `chrome::AddRestoredTab` (`restore:<tab id>` adoption, CEF_NN_TAB_HISTORY). After a relaunch it reopens from its URL, like open tabs |
| Drag reorder | ✓ | ✅ | rows, pinned tiles, groups, splits, across sections, into/out of groups, onto the page to split. Tabs on top (fixed 2026-10-01, the owner's 0.2.18 report: pressing a tab moved the window instead): tabs, pinned tiles, splits (as one), groups (by their chip) and group members trade places along the strip; a tab dragged into the pinned tabs is pinned, a pinned tab dragged out is unpinned; a tab or a split's pane pulled below the strip goes to the page's split targets, let go away from them or outside the window it opens in a window of its own (or joins the window under the pointer), as in Dia; the window never moves, even with one tab. While it's off its list the tab is Dia's picture of the window under the pointer, anywhere on screen (a non-activating panel; the pill first; over another window's tabs a pill, and that strip makes room where it lands; a background tab shows its last picture). Smoothness matched to Dia frame by frame (2026-10-02, the owner's "not as smooth as Dia"; `dia-spec.md` › Reordering, frame by frame): no stall at the press (the window snapshot waits for the tab to leave its list and takes ~17 ms, not 0.13–0.35 s), the dragged tab opaque, neighbours sliding aside as it passes on Dia's ~0.07 s spring, one store update and one Chrome strip command on drop and the tab settling into its place; nothing writes the store while a tab moves along its strip. The dragged tab draws over the tabs it passes, and with nothing pinned the sidebar's pin target takes no room, so no row moves as a drag starts or ends. `apps/browser/scripts/tab-drag-test.mjs` (18 cases through AppKit's event path, sidebar included; checks that a drag changes nothing until the drop, that a dragged tab draws over its right neighbour, that sidebar rows don't move as a drag starts or ends, and that a sidebar row's ghost lands exactly on its row). Fixed 2026-10-01 (rec1522): the pill cross-faded into the card with its title scaled up to fill it ("ease notes -"), and the card grew into a new window as its top crop stretched to the window's shape (a doubled, offset page behind the real one, with the new window already showing empty under it); the picture now changes at once, grows as the whole window lined up with the new one, and fades only once that window shows its content. Left for a person: the drags with a real mouse, the picture by eye on a real screen |
| Haptic tick while reordering | ✓ | ✅ | setting in Tabs |
| Pin / unpin (grid of pinned tiles) | ✓ | ✅ | pins are mirrored into Chrome's tab strip. Pinned tabs and pinned groups belong to the profile, as in Dia (its `pinned_container` nodes are per space, not per window): every regular window showing a profile shows the same tiles in the same order, and a pin, unpin, reorder, rename, icon or pinned URL in one window shows in the others at once (store/pinMirror.ts). Each window has its own copy of each tile with its own page: a copy starts unloaded and loads when clicked there, so opening a pinned tab in one window never takes it from another; moving a tile's page to another window (drag, Move to Window, tear-off, Merge All Windows) leaves an unloaded tile behind and one tile per pin in the target. Unpinning elsewhere removes a copy that never loaded and keeps one with a page as a regular tab. Private windows and Small Yahu show none. Fixed 2026-10-06 (the owner's 0.2.27 report: a new window showed none of the pinned tabs, which were per window and only handed to the next window when their own closed); a relaunch with windows whose pins differ (0.2.27 sessions) gives every window the union. `store/pinMirror.test.mjs` (9 cases, create/update/delete/relaunch staleness). Left for a person: the tiles in two real windows by eye |
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
| Tab Switcher ⌃Tab (MRU cycling with UI) | ✓ | ✅ | overlay after 140 ms, commits on ⌃ release. As in Dia 1.50.1's RecentTabs event monitor: → / ← move, Esc or a click outside closes it without switching, a click on a row switches to it, the pointer highlights rows, leaving the app switches, other keys are swallowed while it's up |
| ⌘1–⌘8 / ⌘9 select tab | ✓ (Chromium) | ✅ | the sidebar's rows (pinned tiles first), wherever the focus is; 0.2.7 lost them to Chrome's disabled ⌘1–⌘9 outside a page |
| Overflow menu (open + recently closed + synced devices) | ✓ | ✅ | open, recently closed, recently cleaned, clean up, mute all, and synced devices as Dia's: one other device is "Your %@ Tabs" ("Your MacBook Pro Tabs"), several roll up into "Your Devices" (`macbook.and.iphone`), each with its "Recent Tabs" (sync/menu.ts; `docs/sync.md`). Verified with hidden instances (both forms, 2026-09-26). Left for a person: the NSMenu by eye |
| Clean Up Tabs ⌥⌘K / auto‑archive untouched tabs → "Recently Cleaned" | ✓ | ✅ | + daily auto clean-up and the sidebar upsell |
| Auto‑clear abandoned New Tab Pages | ✓ | ✅ | on app resign-active / screen lock |
| Links `_blank` / ⌘‑click open new tab | ✓ | ✅ | Chrome makes the tab in the opener's Browser (`window.opener` kept) and the app adopts it; ⌘-click → background tab next to its opener (ledger 7). Chrome's opener rules (store/openers.ts, from `TabStripModel`): links opened behind (⌘-click, middle-click, Open Link in New Tab, Open Image in New Tab) line up after the opener in the order opened, after the tabs those opened too; a link opened in front (⇧⌘-click, target=_blank) goes right after the opener; closing the page goes to a tab it opened, then a sibling, then the opener. Switching to a tab another page opened, typing an address or opening a link in front forgets the openers, as in Chrome (moving between an opener and its tabs keeps them). A link from a grouped tab joins the group; from a split, it goes after the split. Fixed 2026-09-30: a tab opened behind could come to the front (the owner's report: ⌘-click and Open Link in New Tab switched to the new tab). Its first LoadURL asks CEF for focus (FOCUS_SOURCE_NAVIGATION), CEF's ChromeBrowserHostImpl::OnSetFocus then makes it Chrome's active tab, and the app follows Chrome's active tab (onTabStrip); the page also loaded twice. Only the page on screen takes focus now (`Client::OnSetFocus`), and NNBrowserView drops the second load. Extension popups and side panels open links like tabs do (all dispositions, POST and `window.open` + `document.write` kept); their popups no longer leave an empty 750 × 782 window on screen each. Verified headless (CDP clicks, context menu through NETNYAHOO_CONTEXT_MENU_LOG, 25 checks): the active tab, the opener page's `document.hasFocus()`, the order, one load per page, `window.opener`, private windows, splits, groups, pinned, Small Yahu. Links opened behind (⌘-click, middle-click, Open Link in New Tab, from Small Yahu too) load only when first shown, as in Dia: the row shows the address ("x.com/home") and the site's icon until then. Unlike Chrome, which loads them at once; the engine keeps each one's navigation (`CEF_NN_OPEN_URL_PARAMS`: POST body, referrer, initiator) for when it's shown, and a relaunch reopens it from its URL. Popups a page makes (`window.open`, target=_blank) still load at once, so the page can talk to them. Every link Chrome asks to open in a new tab or window now loads with its full navigation: a POST form ⇧- or ⌘-clicked keeps its body (it used to reload as a GET), Open Link in New Tab keeps the referrer (verified headless against an echo server, 9 checks). Left for a person: a real ⌥⇧-click (split; read from the click's own keys) and ⌘-click with a trackpad in the key window |
| ⌘‑click link creates a tab group with opener | ✓ | ✅ | setting in Tabs; links opened behind from an ungrouped tab (⌘-click, Open Link in New Tab). A link from a tab already in a group joins it whatever the setting (Chrome); from a split, the whole split joins. From a pinned tab (or a pinned group's tab), as in Dia (owner recording 2026-09-30): the pinned tab stays pinned and its links gather in a group of their own just below the pinned tabs, which its later links join (`TabGroup.pinnedOpenerId`) |
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
| Tab groups (create, rename, icon, pin, duplicate, ungroup, delete) | ✓ | ✅ | The header, as Dia's (owner recording 2026-09-30): icon, name, then a chevron right after it (∨ open, › closed, turning with the toggle; 8 pt from the name, white at 0.5), no count when closed, ✕ on hover; opening or closing takes 150 ms (Dia's, measured at 60 fps: 140–160 ms, fast at first; was 240). Closing a group that holds the page on screen shows the tab just above the group (Dia), not the page's pinned opener. + collapse, colour, Move to Group, Remove from Group. Dia's two ways to end a group (1.50.1: `unparentGroup` / `softDeleteGroup`): Close Group (Recently Closed Groups, ⇧⌘T) and Delete Group (not in Recently Closed; the overflow menu's Recently Deleted Groups keeps it 7 days, Dia's purge interval). Closing a tab of a pinned group unloads it and keeps its row, as for pinned tabs |
| New Tab in Group ⌥⌘T / New Group with Tab(s) ⌃⌘N | ✓ | ✅ | ⌃⌘N titles itself "New Group with N Tabs" for a selection |
| AI auto‑naming + emoji, shimmer on rename | ✓ | ⏸ | No AI. Unnamed groups are named from their tabs' titles instead (store/groupNames.ts): the site name titles carry at one end (" / X", " - YouTube", "GitHub - …") gives "X", with the page too when every tab is on the same one ("Home / X" ×5 → "X Home", Dia's AI said "X Feed" then "X Home"); a tab not loaded yet takes its site from a loaded one of its host, else from the host (x.com → "X"). It updates as titles arrive, with the label's fade; a name you give always wins. Dia's grey placeholder bar while its AI thinks isn't needed |
| Group colour from favicon/theme | ✓ until 1.28 | ✅ | neutral by default like Dia since 1.28; colour menu with "Match Site Color" |
| Peek group | ✓ | ✅ | hover card over a collapsed group |
| Single‑tab group auto‑ungroups | ✓ | ✅ | for ⌘-click groups (`autoUngroup`), like Dia |
| Close group → Bookmarks Bar / Recently Closed Groups | ✓ | ✅ | |
| Tab groups in the top tab strip | ✓ | ✅ | As Dia's (owner recording 2026-09-30, numbers in `dia-spec.md` › Top tab strip › Groups): a group is one container (the pinned dock's fill and stroke, lighter while the pointer is on the chip) holding the chip (group glyph + name) and its members. Collapsed, only the window's active tab stays out, attached after the chip. Clicking the chip slides the members out of it at full width, with a divider and Close Group (✕) at the end, and back in; the container and the tabs after it move on Dia's spring (response 0.30 s, damping 0.82; in the app 0.31 s / 0.81 expanding, 0.30 s / 0.82 collapsing, 1.1 % overshoot both ways, as Dia's). Hovering the active tab of a collapsed group shows "–" instead of ✕: it hides the tab in the group (it fades out in 0.12 s while the container closes up) and goes back to the most recent tab outside the group. Picking a member leaves the group open: in the recording it closed only when the chip was clicked. Right-click on the chip: the group menu. Left for a person: "–" and the hover states by eye |
| Meeting tab groups (auto for calls, countdown wiggle, "Open All and Join") | ✓ | ✅ | calendar from macOS EventKit |
| GitHub / Bitbucket PR live folder (checks, stacks, review requests, hover preview) | ✓ | ✅ | the user supplies a token or their own OAuth app |
| Documents live folder (Drive, Notion, Confluence) | ✓ | ✅ | same: user-supplied Google OAuth client / Notion / Confluence tokens |
| Unread pip on live folders | ✓ | ✅ | |
| Chat with a live folder | ✓ | ⏸ | |
| Shared split view in sidebar | ✓ | ✅ | one row per split, a segment per pane |

## 4. Sidebar & layout
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Vertical sidebar vs top tab strip (⇧⌘S) | ✓ | ✅ | per window; new windows follow Settings › Tabs. The top strip matches a 2× Dia capture (`dia-spec.md` › Top tab strip): pinned tabs share one container, the selected tab is attached to the card (concave flares, the toolbar's website colour), the card starts at y 42 with 6 pt insets, and the window buttons centre on y 20.75. Tab groups: see Tab groups in the top tab strip |
| Toolbar hides while scrolling (tabs on top) | ✓ | ✅ | As in the owner's clip (2026-10-02): with tabs across the top, scrolling the page down collapses the toolbar into a 20 pt strip that keeps only the site's name, small and dim, centred; the page gets the other 21 pt back (its viewport moves up, a sticky header goes with it). Hiding is one 150 ms eased motion matched frame by frame to the clip (2026-10-02, 0.2.23): the page glides up with the bar's band while the controls fade and shrink toward the top centre; showing mirrors it, 200 ms eased out (2026-10-03), the page gliding down with the band as the controls fade and grow back in; either reverses mid-motion from where it is. All on the native driver, no blur, a fade only with Reduce Motion. Hiding and showing don't resize the page (2026-10-03): in 0.2.23 every one changed its viewport by 21 pt, so pages sized in vh reflowed and a canvas re-created on resize blanked for a frame (netnyahoo.com's Big Yahu blinked on each hide and show, owner's 120 fps recording). Now the page keeps the strip's size from its first hide until the next document: the shown bar slides it down and its bottom 21 pt goes under the card's edge (a fixed footer included; the link status bubble stays above it); a page that never hides the bar is never resized. The one resize, at the first hide, is held in place by the transform in the same frame. Direction comes from the page's real scroll, the document or an element scroller filling the window (page_script.js › Scroll direction): 24 pt down in one gesture hides, 12 pt back shows, only while the user is scrolling (scroll restoration or a page scrolling itself doesn't hide it), never on a page with under 120 pt to scroll; the scroll move the bar's own resize causes (the clamp at the bottom) is absorbed, so it can't oscillate. Always shown at the top, on a tab switch or navigation, with the command bar (⌘L), find, a site popover or history menu open, and in page full screen it stays out of the way as before. Resting the pointer on the strip for 150 ms peeks the bar over the page without moving it; clicking the strip brings it back. Per pane in split view; private windows too; Small Yahu and the sidebar layout unchanged. Settings › Tabs › "Hide toolbar while scrolling" (on by default, synced). Verified headless (2026-10-02, CDP wheel input on local pages: long, sticky header, barely scrolling, inner scroller, 100vh hero; 31 checks incl. no height change over 1–1.5 s at the bottom and when nudging there) and `toolbarAutoHide.test.mjs`; 2026-10-03, 60 fps window captures on a vh hero + resize-cleared canvas page and on netnyahoo.com, windowed and acted full screen: one resize per document, then no content shift, blank canvas or reflow over every hide, show, reversal and tab switch, and the page's top monotonic through each motion (≤ 6 pt a frame). Left for a person: the feel on a real trackpad, hover peek with a real mouse, and the animation by eye (snapshots can't time it) |
| Auto‑hide tabs / Focus Mode (⌘S) | ✓ | ✅ | As in the owner's 240 fps recording (2026-10-06, `dia-spec.md` › Hiding and showing the sidebar): the sidebar, its traffic lights and the card's left edge slide together on Dia's spring (response 0.215 s, damping 0.79, fitted to Dia's frames; ours measured on screen 0.22–0.235 s / 0.76–0.80, rms 1.7–2.6 % from Dia's curve), the card's right edge stays and the page is laid out at every step. Hidden, the window has one bar: the sidebar button at the card's edge (x 27), back, forward, reload and the address; the traffic lights go out of the window with the sidebar (Dia hides them too) and come back with it or with the peek. Per window, kept across a relaunch and ⇧⌘T; new windows open with it shown. Showing or hiding keeps the one sidebar mounted (it was unmounted and a second one mounted: 2282 views and a 1.2–2.3 s main-thread stall per toggle on the 200-tab seed; now the worst frame is about 30 ms). Kill switch `sidebarSlide` (off: no slide). Reduce Motion: no slide. `dockMotion.test.mjs`. With the address bar in the sidebar (Arc's layout), hiding is Arc's (owner's Arc recording 2026-10-06, `dia-spec.md` › Arc note): no toolbar row, the page fills the card, the bar stays in the sidebar and shows in the peek panel; the peek slides in on Arc's spring without fading, docking from it is instant, hiding takes 100 ms |
| Peek sidebar on hover at left edge | ✓ | ✅ | top strip peeks too. The peek is the window's one sidebar in a panel, not a second copy |
| Sidebar toggle button in nav bar | ✓ | ✅ | The toolbar's first button, centre 21 from the card's edge in both states (Dia: x 211 shown, 27 hidden). With the address bar in the sidebar, the header's button now always shows (it was dropped under a 225 pt sidebar, so the default 190 pt had none); back, forward and reload close up (centres 35 apart, down to 23) before one gives way, so the default 190 pt sidebar keeps all three (it had dropped reload below 225 pt; owner's report 2026-10-07); then reload, then forward, give way |
| Resize sidebar (rubber‑band at min/max) | ✓ | ✅ | persisted; double-click resets |
| New tabs at top (setting) | ✓ | ✅ | links from a pinned tab, a Small Yahu page or a bookmark folder keep their order at the top (they came out reversed) |
| Sticky ➕ New Tab at bottom when overflowing | ✓ | ✅ | |
| Double‑click empty sidebar space → new tab | ✓ | ✅ | |
| Top Apps / Favorites dock | ✓ | ✅ | the pinned-tile dock; command bar "Move to Top Apps" / "Unpin from Top Apps" like Dia |
| Library (chats & files Dia made) | ✓ | ⏸ | |
| Downloads button in header | ✓ | ✅ | like Dia 1.50.1 (DownloadsButtonController, from the binary): there only while the window lists downloads, in progress or finished; Clear hides it again. 34 pt box, 7 pt from the edge |
| Selected/hover/pressed row styling + selected glow | ✓ | ✅ | Dia 1.50 selected tint (#121212 at 0.5 dark, white 0.7 light). Compared with Dia 1.50.1 captures (1× and 2×, dark, 2026-09-26) and its binary: rows 34 tall on a 37 pitch and pinned tiles 41 tall from y 54, in TabList's symmetric 6 pt inset (x 6 … 184 at 190; were 33, 40 and 7); the selected row's hairline is 0.5 pt, white 0.15 on all sides (was a 1 pt gradient); the resting tile's is white 0.14 (`TabDockItemRestingStroke`, was 0.06); selection no longer shifts the row's content; the New Tab icon is Dia's mark (16 pt, white 0.28). At 2× every row and tile edge, stroke value, favicon, title position, weight and colour now match to the pixel. The capture's rows end at 185 and its card starts at 191 because that Dia window's sidebar is 191 wide (resized; the binary's default is 190, like ours). Light mode not compared (checklist step 10). Loading spinner in rows: Dia's `ActivitySpinnerView` (12 pt, 8 pt from the row's end, track + 72 % arc 1.5 pt wide in secondaryLabelColor, 1.88 s per turn), hidden under the hover close button |
| Pinned tile tooltip (title + URL) | ✓ | ✅ | hover card with title and URL |
| Website colour extended into tab bar / toolbar | ✓ | ✅ | nav bar tint from theme-color / header / background, eased; setting in Tabs |
| Profile indicator in sidebar header | ✓ | ✅ | Dia 1.50.1's SidebarProfileIndicatorButton, from its binary: the profile name as plain text right of the traffic lights, 13 pt semibold, the profile's action colour 60 % toward white (dark) / 40 % toward black (light), 9 pt padding, 34 pt tall, hover/pressed background radius 10; the whole name, cut short (…) only if 52 pt of it fit, else `person.fill` 14 pt in a 32 pt button. Only with two or more profiles (a 1.50.1 window with one profile shows none) or in incognito ("Incognito", label colour, no menu). Menu: the profiles (checkmark, swatch, ⌃1…), New Profile, Edit Profiles… (Settings › Profiles). Checked against a 2× capture of Dia: the name's ink box (x 94 … 147, y 22 … 32), centroid and colour (P3 236, 209, 215) identical. The action colour is measured for plum only; other colours use their swatch |

## 5. Profiles & Spaces
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Profiles (separate cookies, logins, passwords, extensions, cards, history, chats) | ✓ | ✅ | a Chrome profile each (cookies, logins, Chrome's password manager, autofill addresses and cards, extensions, site settings), plus our history and bookmarks; chats ⏸ |
| Profile name + theme colour (+ icon) | ✓ | ✅ | name, 9 colours (window tint, NTP light, edge light, power-up band); optional initial, emoji or SF Symbol icon on the profile colour |
| Profile switcher, ⌃1–⌃9, next/previous, swipe between profiles | ✓ | ✅ | switcher, ⌃1–⌃9, Next/Previous Profile. Paging like Dia's PageSwipeController (layout/profilePager, numbers in dia-spec › Profile paging): two fingers (or a Magic Mouse finger) over the sidebar or the top tab strip page between profiles whatever Swipe between pages is set to; the neighbouring profile's page (its tiles and tabs, kept mounted at stable profile positions) slides in beside the current one at Dia's half-speed tracking, rubber band at the ends, page-detent haptic, flick commit at 5 pt/s, 0.25 s critically damped settle carrying the release speed; the window tint cross-fades between the two profiles' colours; a wheel mouse's horizontal / Shift-scroll pages one profile per burst. ⌃1–9, Next/Previous Profile, the profile menu and the page dots slide the same way; the native path switches profile on release while the spring finishes. Page dots (Dia's space switcher: 41 pt footer, 6 pt dots on a 12 pt pitch, labelColor 0.85/0.4/0.2) in the sidebar footer, brightness following the pages. Not yet: Dia's strip settle content fade, the switcher's edge scaling past 7 profiles and drag-to-reorder, the footer's Library/overflow buttons. Since 0.2.18 AppKit owns recognition, tracking, velocity, interruption and display-refresh settling, and React only receives the selected profile; stable profile ids and sequence acknowledgements keep late state from undoing rapid swipes, dots, shortcuts, reordering or deletion. The window's Chrome window swaps with the commit that lays the profile out, so no empty-window or blank-page frames show. A swipe tolerates 12 pt of initial vertical wobble, then keeps the horizontal axis locked. A quick series of switches costs each the same as the first (2026-10-03): every view leaving the window used to scan a bounds-change observer list that grew with each switch and each tab opened (react-native-macos re-registered a scroll view's rows every time their container changed; patched), and the sidebar page leaving no longer unmounts the rows past its first screen. A swipe's momentum stays with the swipe (2026-10-05): passed on, it started the scroll view's responsive scrolling under the pointer, which ate every later scroll until the pointer moved, so the third swipe at one spot did nothing. Guarded by `apps/browser/scripts/profile-swipe-test.mjs` (hidden-instance cases: reversals, wobble, drift, momentum, missing ends, overlapping and full-screen windows, renderer hits, blocked JS). Physical trackpad feel needs an installed build. History and measurements: `docs/research/profile-swipe-native-controller.md` (ledger 44) |
| Create / rename / delete / make default / reorder profiles | ✓ | ✅ | Dia's Create Profile dialog; Settings › Profiles rows drag to reorder |
| Clear browsing data per profile | ✓ | ✅ | |
| Share data between profiles | ✓ | ✅ | profiles sharing one engine profile share cookies, logins, site data, passwords, extensions, zoom, history and bookmarks; tabs stay per profile |
| Guest profile | ✗ | — | not in Dia |
| Dock menu: New Window per profile | ✓ | ✅ | |
| Unload unused profiles | ✓ | ✅ | a profile no window has shown for 10 min: its tabs' browsers close (unlike sleeping, their history is lost), then its engine context is released (checked every 15 s). Whether Chrome then unloads the profile itself (ghost, hidden WebUI pages) hasn't been measured on the new engine |
| Per‑profile extensions | ✓ | ✅ | every extension call takes the profile; Settings › Extensions has a profile picker ("Each profile has its own"); uBOL runs in every profile (ledger 11) |
| Per‑profile sync | ✓ | ✅ | each profile syncs on its own (its own scope in the sync folder), turned on or off per profile in Settings › Sync. Joining pairs Personal with the synced default and other profiles by name; a synced profile this Mac lacks is offered as "Add to This Mac"; profiles that share data sync their tabs, the data with its owner (`docs/sync.md`) |
| Per‑profile Morning Brief | ✓ | ⏸ | |
| Spaces (colour, rename) | flag-gated; changelog says Dia has no Spaces | — | Dia ships without Spaces |
| Warn before closing last tab in a profile | ✓ | ✅ | with "Don't ask again" |

## 6. Split view
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Split view up to 3 panes, horizontal/vertical, add bottom split | ✓ | ✅ | each pane is a Chrome tab at its own size; Chrome's dialogs follow the focused pane (ledger "Split view") |
| Open Split Pane ⌃⇧=, focus next/prev ⌃⇧] / ⌃⇧[ | ✓ | ✅ | |
| Drag tab to edge to split; ⌥‑click ➕ opens split NTP; ⇧⌥‑click link opens right pane | ✓ | ✅ | Dia's split targets from the sidebar and the top strip alike ("Add left split" / "Add right split" at each pane's sides: slide in, grow, the one under the dragged card takes the accent and leans to the pointer; the tab shows as a small window under the pointer; `dia-spec.md` › Dragging tabs and split targets). The page showing the dragged tab alone splits with the tab used before it |
| Per‑pane nav bar / tint / close | ✓ | ✅ | unfocused panes dim |
| Flip / convert orientation / separate all | ✓ | ✅ | + Move Pane Left/Right, Remove from Split View |

## 7. New Tab Page & command bar
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| NTP layout (bar width, position, HUD blur material, fill, border, radius 20) | ✓ | ✅ | 1.50: bar edges fitted to 0.5 pt from the 1.50.1 intro capture: Dia's bar and mark sit 1 pt right of and below NewTabPageViewController's formulas for our card, and the bar is 112 pt tall; ours now match (2x layer snapshot). Inside the bar the input row and the chip row now sit where Dia's do (magnifier, chip borders, mic and send within 0.1 pt of the capture; the chip label 0.5 pt low). Still different: Dia's magnifier is ~3 pt further right and 1 pt smaller, and its placeholder ~5 % narrower |
| Logo: glass orb (1.49) → hand-painted mark per profile colour (1.50) | ✓ | ✅ | Intentionally ours: Big Yahu's bust (`assets/ntp-yahu*.png`, `docs/brand/yahu-mark`) replaces Dia's painted dome, one image for every appearance and profile colour. A 100 pt frame centred on the bar where Dia's mark is, its top 84.1 pt above the bar and clipped at the bar's top edge; he rises from behind the bar 80 ms after the page appears (spring, ~4 pt overshoot with a 3° tip, settled by 0.5 s), once per tab and not under Reduce Motion. The sidebar's New Tab row shows his head (`assets/new-tab-yahu*.png`) with Dia's tint. Dia's dome measurements stay in `docs/dia-spec.md` |
| Power‑up band intro | ✓ | ✅ | 1.50: one theme colour (grey 0.65 for Neutral), corner radius 20 |
| Area light (intro, breathing, fade) | ✓ | ✅ | palette follows the profile colour; Dia's clock model (skip-ahead, key/occlusion pause, × 0.5 when not key) |
| Edge light around bar | ✓ | ✅ | colour from the profile theme |
| Entrance spring / Reduce Motion | ✓ | ✅ | like Dia under Reduce Motion: no spring, no band, edge light settled, area light still |
| Profile‑colour NTP theme & gradient | ✓ | ✅ | the window colour is the translucent window treatment (row "Window backdrop tint + translucency"): 1.50's "lighter key tint" was the blur's active output, not a different tint, so `activeTint`/`inactiveTint` are gone; the content card is #121212 at 0.5 (white 0.7 light) over it, so the blur shows through the New Tab card at half strength. No grain in 1.50's stack (the Metal backdrop with grain remains only for the New Tab postcards) |
| NTP release‑notes postcard, Trial Guide, personalize button | ✓ | ✅ | postcard with Dia's geometry and springs, full-page notes, 1 day, never on fresh installs or incognito; Personalize button. Trial Guide is a plans feature (—). Our own artwork |
| NTP connect‑apps upsell | ✓ | ⏸ | |
| NTP query restore when navigating back | ✓ | ✅ | |
| Command bar panel over toolbar (⌘L / click URL) | ✓ | ✅ | ⌘L on the NTP focuses and selects its bar; 1.50's two bar shadows (0.08 r2 / 0.04 r1); a click anywhere outside it (the page, the sidebar or its rows, the tab strip, Small Yahu's bar) closes it as Esc does, and the click still does its own thing (fixed 2026-10-06, the owner's 0.2.27 report: a click on the empty sidebar left it open; `OutsidePressArea`) |
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
| Mic / dictation button | ✓ (streaming, hold‑to‑speak) | ⏸ | the button starts macOS dictation in the bar (done); what's left, Dia's streaming hold-to-speak transcription, is its AI voice input (⏸) |
| Paste and Go / Paste and Search | ✓ | ✅ | bar and URL right-click menus; strips trackers |
| Paste URLs as attachments | ✓ | ⏸ | |

## 8. Navigation & page tools
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Back / forward / reload / force reload | ✓ | ✅ | ⌘-click reload/back/forward → background tab |
| Stop (X next to address bar) | ✓ | ✅ | Esc stops a loading page |
| Hold back button for history list; ⌘/middle‑click entries | ✓ | ✅ | our popover (layout/HistoryPopover): up to 15 entries + Show Full History, modifier clicks open tabs |
| Two‑finger swipe navigation (custom UI, works on native pages) | ✓ | ✅ | NNSwipe + Dia's overlay (layout/SwipeOverlay), on web, New Tab and internal pages. NNSwipe sits in front of Chrome's own responder delegate and forwards to it (spelling, speech, dialog focus), except the scroll events Chrome's history swiper would act on. Verified headless (2026-09-26) with phased trackpad events built as CGEvents and sent through the window (the renderer acks them; 15 checks): back and forward go exactly one entry; a 40 pt swipe does nothing; a vertical one scrolls; a carousel that can still scroll keeps the swipe, one at its start navigates; `overscroll-behavior-x: none` opts out; holding past the threshold opens the destination list and moving down picks two back; a three-finger swipe goes back; back to and forward from the New Tab page. Like Safari and Chrome it follows System Settings › Trackpad › Swipe between pages (off on this Mac). Left for a person: a real trackpad's feel, the haptic, and the overlay by eye (checklist step 9a) |
| Load progress | ✓ | ✅ | |
| URL bar shows host / title; hover reveals full URL; Show Full URL | ✓ | ✅ | Dia 1.50's rule, from its binary: a web page shows its host alone (no `www.`), and View › Show Full URL adds the path, query and fragment without a trailing "/" (`displayPageTitleInURLBarEnabled`, default on, only decides that); only Dia's own pages and chats show `Dia / title`. Ours does the same, and our own pages and local files keep `host / title`. Hover still shows the full URL. Checked in a Release instance (example.com/docs/intro/: `example.com`, then `example.com/docs/intro` with Show Full URL) |
| Punycode display | ✓ | ✅ | `core/idn.ts`: Chrome's spoof checks, punycode otherwise |
| Find in page ⌘F / ⌘G / ⇧⌘G | ✓ | ✅ | per-tab state, "n of m", ⇧↩ |
| Use Selection for Find | ✓ | ✅ | |
| Jump to Selection, Find & Replace | ✓ | ✅ | ⌘J, ⌥⌘F with Replace / All for the focused input, textarea or contenteditable. One ⌘Z undoes a Replace All in text fields; in a contenteditable each replacement is its own undo step |
| Zoom ⌘+ / ⌘- / ⌘0 | ✓ | ✅ | Chrome's per-host zoom per profile (`HostZoomMap`, Chrome's steps); Settings › Privacy lists and resets levels. Away from 100% the address field (toolbar or sidebar) shows Chrome's magnifier (+ or −), which opens − / + / Reset. ⌘-scroll zooms with a wheel mouse or a Magic Mouse and scrolls with a trackpad (the scroll's HID sender; `scripts/zoom-scroll-test.mjs`). Pinch zoom is reported by the page script but unused |
| Translate page / Never translate this site | ✓ | ✅ | on the Mac's own models (Apple's Translation framework, macOS 26; nothing leaves the Mac), not Chrome's Translate, whose Google servers domain substitution removed. Dia's UX from its 1.50.1 binary: a translate button by the address when the page isn't in one of your languages (click: translate / back to the original); Site Controls' "Translate to <language>", "Choose Another Language…" and "Never Translate This Site" (per profile); toasts "Translated to %@", "Translated back to %@", "Translation error (%@)", with progress while a long first pass runs. A paragraph translates as one text and each text node gets its part back, so links and styles stay (a language with another word order is cut in proportion); what's near the viewport first, the rest as you scroll; text the page adds later too; Show Original restores the text exactly. Checked on German and Japanese Wikipedia. macOS 14–15: no Translation framework, so no button |
| Selected‑text popover (Search) | ✓ | ✅ | Search bar over a mouse selection (default engine, new tab next to the page); page menu "Search <engine> for “…”". Both follow the keys held (Chrome's): ⌘ behind, ⇧⌘ in front, ⇧ a new window, ⌥ a split. The menu's keys come from the event that picked the item (CEF gives Chrome's page menu commands no event flags) |
| Selected‑text popover / context menu (Ask) | ✓ | ⏸ | hidden until Chat exists (`kChatEnabled` in NNClient.mm) |
| Clean link copy (trackers stripped), Copy URL as Markdown ⌥⇧⌘C | ✓ | ✅ | every Copy URL / Copy Link (as Markdown) strips trackers |
| Quote link / "Super Copy" (text fragment link) | ✓ | ✅ | ⇧⌘C with a selection: Dia's toast with Copy Quote Link; page menu "Copy Link to Highlight" (Chrome's item, run by core/textFragment.ts for Dia's toast and clean link) |
| JS alert / confirm / prompt dialogs | ✓ | ✅ | Chrome's tab-modal dialogs, centred over the page area (or the focused split pane); `alert()` and HTTP auth verified (ledger 26); `beforeunload` untested. Chrome's styling, not Dia's |
| `<input type=file>` open panel | ✓ | ✅ | Chrome's file picker. Verified headless (2026-09-26; test instances log the panel instead of showing it, NNActivation.mm; 12 checks): a sheet on the app window; one file, several files with the `accept` types in its type menu, or a folder; the chosen files reach the page (`change` with names and sizes), Cancel fires `cancel`; `showOpenFilePicker` and `showSaveFilePicker` (the page wrote the chosen file) go the same way. Left for a person: seeing the sheet (checklist step 9b) |
| Pop‑up blocker (always allow/deny) | ✓ | ✅ | ours (`disable-popup-blocking` turns Chrome's off): toolbar badge + Dia's dialog, Only Once opens a tab with `opener` (ledger 24). Only Once replays the popup as the page asked (2026-09-30): from the frame that opened it (a sandboxed iframe's popup stays sandboxed; a frame that's gone isn't replayed) and with noopener / noreferrer kept (`CEF_NN_POPUP_OPENER_SUPPRESSED`); it used to run `window.open` from the main frame, handing noopener pages an opener. Fixed: a frame without an origin of its own (about:srcdoc, about:blank, data:) counted as allowed, so any page could open popups through one; it now asks as its page's site |
| Links that open other apps (`codex:`, `zoommtg:`, `slack:`, `mailto:`, `tel:`…) | ✓ | ✅ | They used to end on "ERR_UNKNOWN_URL_SCHEME": CEF hands them to the OS only if the client allows it in `OnProtocolExecution`, and we never did. Now NNExternalApps.mm cancels the navigation (the page stays) and asks in our own popover: "Open “ChatGPT”?", the app's icon, "<initiator> wants to open this application.", Cancel / Open and "Always allow <site> to open links of this type in <app>" (kept per profile in Chrome's own `protocol_handler.allowed_origin_protocol_pairs`, never in private windows, only for https/localhost initiators; Settings › Privacy › Apps allowed to open links lists them with Remove). Sized popups (OAuth windows) get the same as a sheet. No app: "No application is set to open this link". Chrome's rules: its denied schemes plus our own URLs are blocked, one request per user input (flood block), the origin shown is the navigation's initiator (cross-origin iframes show their own), a tab opened just for the link closes. Differences: `mailto:` prompts too (Chrome opens it directly); sandboxed/opaque-origin frames need a user gesture (Chrome reads sandbox flags). Verified headless 2026-09-30 (link, 302, iframe, sandbox, spam, target=_blank, popup, private window, blocked schemes). Left for a person: the popover and the popup sheet by eye |
| Site settings menu (security, pop‑ups, cookies, clear cache) | ✓ | ✅ | Site Controls: connection + certificate, zoom, PiP (when there's video), ad blocking, 6 permissions, clear cookies & site data, clean link, Share…, full URL. Share… (Dia's site settings menu has Share beside Copy Link, its 1.50 binary) opens the system share sheet pointing at the row, with the page's clean link and title; the popover closes with the sheet |
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
| Synced devices' tabs | ✓ | ✅ | each device publishes its 30 most recent open tabs per profile (not pinned tabs, which sync as pinned tabs); the others list them in the overflow menu, and a device that stops syncing takes its record away (`docs/sync.md`). Verified with two and three hidden instances (2026-09-26) |

## 14. Downloads
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Downloads panel (⇧⌘J, toolbar button) | ✓ | ✅ | our popover; Chrome's download bubble is off per profile (ledger 25) |
| Progress, cancel, open, Show in Finder, clear | ✓ | ✅ | |
| Pause / resume | ✓ | ✅ | |
| Open when done; move to Trash | ✓ | ✅ | "Open When Done" isn't remembered across a relaunch |
| Persist downloads list across launches | ✓ | ✅ | downloads.json; incognito downloads never written (fixed 2026-10-06: they were, and showed in regular windows; ones an older build saved are dropped at launch). A window lists its profile's downloads, as Chrome's per-profile list (a private window its session's); before 2026-10-06 every regular window listed every profile's |
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
| Extensions menu, pin extensions, toolbar buttons with badges and popups | ✓ | ✅ | Extensions menu (installed ones, Add Extension…, Manage Extensions…, Pin Extensions…; store extensions' popups open from it, as unpacked ones' do: from 2026-09-29 to 09-30 they didn't); badge, title, popup, enabled state and `action.setIcon` images read straight from Chrome's `ExtensionAction` for the tab every 1.5 s and on tab switches (`CefGetExtensionActionState`; Chrome has no change event). Since 2026-10-05 a popup sizes itself as Chrome's does (the page's auto-resize, 25×25 to 800×600, `nn_extension_view.mm`): it shrinks with its page as well as grows (it only ever grew while the app measured the page: KeePassXC-Browser's stayed 318 pt tall after its content dropped to 167), and `chrome.action.openPopup()` / `browserAction.openPopup()` open it over the active tab, afresh over its own (they failed with "Browser window has no toolbar": 1Password reopens its popup this way once its Mac app unlocks). Verified headless: acceptance `extension-popup-and-panel` (264×114 → 264×57, openPopup "ok"), a probe in normal and private windows, uBlock Origin Lite, KeePassXC-Browser, 1Password's popup page (600×450) |
| Manage Extensions (`dia://extensions`) | ✓ | ✅ | Settings › Extensions (on/off, details, site access, incognito, pin, reload, remove, add by link, load unpacked); `netnyahoo://extensions` is Chrome's own page (developer mode, errors, shortcuts) |
| Install/uninstall permission dialogs | ✓ | ✅ | install, re-enable and new-permission prompts through our dialog (verified, W1); removal asks with our "Remove “…”?" sheet from Settings, the toolbar menu and the store page, then Chrome uninstalls (engine verified, W2). The sheet itself needs a key window: checklist step 8 |
| chrome.tabs / chrome.windows | ✓ | ✅ | Chrome's real tabs and windows: one Chrome window per app window and profile, sidebar order, active/pinned both ways, `tabs.create` / `windows.create` / popups adopted as our tabs, moves between windows and profiles (ledger 1–14); sleeping tabs are `discarded: true`, and `tabs.discard` / `tabs.reload` sleep and wake them in the app. Since 2026-10-01 (rec. 1, `docs/store-api.md` › "Live tabs") every change an extension makes reaches the sidebar: `tabs.move` (also to another window, also one holding only New Tab pages), `update` pinned / active, `create` with index and `active: false`, `remove`, a remove and an activation in one go (the extension's tab wins over the opener rule), and `chrome.tabGroups` both ways (`tabs.group` / `ungroup`, `tabGroups.update` / `move`; sidebar groups, renames, colours and collapsing show in `chrome.tabGroups`). As in Dia: collapsing is mirrored both ways (Dia's engine reports and takes `collapsed`: `ArcTabGroupInfo` / `ArcTabGroupProperties`), and the page on screen stays (Chrome's model doesn't switch away from a collapsed group's active tab; only its tab strip view would); a group with no colour is grey for extensions (`ArcTabGroupColorGrey` = 0 is Dia's default). An extension pinning one pane of a split leaves the split and the pane unpinned: Dia's engine has no way to tell the app about a pin (no pin or move callback in ArcCore's delegates). Verified headless with a probe extension over CDP |
| action.onClicked (no popup), keyboard `commands`, extension context-menu items | ✓ | ✅ | onClicked + activeTab + `scripting.executeScript` verified (22); `chrome.commands` shortcuts run on Chrome's own dispatcher in the key Browser window (13; `docs/research/chrome-hosted-window.md`); `chrome.contextMenus` items show in the page menu and their `onClicked` runs (R1) |
| Side‑panel API | ✓ | ✅ | Dia's extension side panel: a card to the right of the page (header with the extension's icon, name, ⋯ menu and close; resizable 320–600 pt, width saved) showing the panel page outside the tab strip. Opens from the toolbar button (`openPanelOnActionClick`), the extension's menu and `chrome.sidePanel.open()`, closes with `close()` or `window.close()`; follows per-tab `setOptions` paths and closes where it's disabled. `chrome.tabs.query({active, currentWindow})` from the panel (and from popups) returns the page |
| Password manager apps (native messaging: 1Password, Bitwarden, KeePassXC, Proton Pass) | ✓ | 🧪 | `chrome.runtime.connectNative` is Chrome's; it reads host manifests from `<user data dir>/NativeMessagingHosts` and `/Library/Application Support/Chromium/NativeMessagingHosts`, where no password manager puts one. At launch (and when the app becomes active) `NNNativeMessaging.mm` writes the manifests of the installed ones into ours, from the vendor's system-wide Chrome manifest if it ships one, else as the vendor's app writes it for Chrome (its `allowed_origins` unchanged), and removes them when the app is gone; manifests it didn't write are left alone. Apple Passwords is left out: its helper has a launch constraint that kills it when an unknown browser starts it. The helper's parent is the main app process. 1Password's `1Password-BrowserSupport` checks that parent's signature and answers `BrowserVerificationFailed` (the extension logs "Disconnected from Desktop app due to UnknownBrowser" and keeps its own lock screen) until Netnyahoo is added once in 1Password › Settings › Browser › Add Browser. Its sandbox reads apps only in /Applications, ~/Applications and /private/var/folders (its entitlements), and the same build run from ~/Documents fails earlier ("Failed to grab code signature … status 100001", errSecErrnoBase + EPERM) while from /private/var/folders it gets as far as waiting for trust; Add Browser also wants the app in Applications. So Netnyahoo has to be moved there (and reopened) before adding it; Settings › Passwords says both, the second only when the app isn't in Applications (`systemInfo().inApplicationsFolder`). Verified 2026-10-01 against the real apps, signed out, in hidden instances: 1Password 8.12.38 (helper launched by the main executable; from ~/Documents EPERM, from a readable path the signature is read and it waits for trust; our running process satisfies a Developer ID + team U5L5T3NGVV + identifier requirement, dynamically and statically), KeePassXC 2.7.12 (key exchange done, database closed), Bitwarden 2026.9 (its optional nativeMessaging permission prompt shows in our install sheet and grants; `desktop_proxy` launched by the main executable, exits while the app is signed out), Proton Pass (prompt and grant; the host only runs once signed in). The same 1Password extension in Chrome for Testing 154 logs the same states. 2026-10-05, end to end with KeePassXC 2.7.12 on a scratch database (hidden instance, scratch config): connected and associated, logins listed for a 127.0.0.1 page and filled from the popup, the popup after a lock ("Database not opened"), and after the unlock (Reload → connected); 1Password after its Mac app unlocks calls `chrome.action.openPopup()`, which now opens. Needs the owner: 1Password, Bitwarden and Proton Pass unlocking their extensions with a signed-in app (a user saw 1Password's popup blank white after its unlock prompt on 0.2.25/26; not reproduced without a signed-in 1Password) |
| Per‑profile extensions | ✓ | ✅ | lists, pins and installs per engine profile; a private window runs the extensions of the profile it was opened from that are allowed in incognito. Extensions don't sync (Dia's sync does); each Mac installs its own from the Web Store |

## 16. Passwords & autofill
Chrome's password manager and autofill fill pages themselves; our Settings panes drive Chrome's own
`passwordsPrivate` / `autofillPrivate` APIs in hidden WebUI pages (NNPasswords.mm, NNAutofill.mm).

| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Save / update passwords, never for this site | ✓ | ✅ | Chrome captures; Chrome's bubble is replaced by our Dia-style prompt (`CEF_NN_PASSWORD_BUBBLE`), with Save / Update (username picker) / Never / Not Now; verified (17, 18, and 19's revisit fill on a fresh profile). Settings › Passwords per profile: list, search, reveal/edit/delete, "Never saved" list, CSV import, the Offer-to-save toggle, unlock through Chrome's own device check |
| Filling saved logins in pages | ✓ | ✅ | Chrome's dropdown under the focused field (ledger 19). Verified headless (2026-09-26, a throwaway profile): a login saved through the app's API shows in the dropdown ("Password for …", a window of the app under the field), ↓ ↵ fills both fields; Edit › AutoFill › Passwords… lists it; a new login submitted gets our save prompt (no Chrome bubble) and Save stores it. Left for a person: the dropdown by eye in a key window (checklist step 2) |
| Suggest strong password on sign-up | ✓ (Chromium) | ✅ | Chrome's generation popup on new-password fields ("Use Strong Password", "Choose Your Own"; "Suggest Strong Password…" in the dropdown where logins are saved). It was never offered before 0.2.3: Chrome offers it only to people who sync passwords (`chromium-password-generation-local.patch`); its text now says passwords are saved on this device, not to a Google account. Verified headless, Debug and Release (2026-09-26): the popup, both password fields filled with the generated one, which is saved to the local store at once (a login page fills it back). The generated-password confirmation stays Chrome's bubble. Left for a person: the popup by eye (checklist step 3) |
| Passkeys / WebAuthn (iCloud Keychain) | ✓ | 🟡 | Chrome's WebAuthn stack and dialogs, centred over the page and in front of it (they are child windows of the app window, which is Chrome's own; 0.1.1 drew them behind the window, so passkey sign-in looked stuck). Verified in a Developer ID build: security keys and phone (QR sheet) ✅, a real phone scan is checklist step 7; Touch ID "Chrome profile" passkeys ✅ (register and sign-in on webauthn.io with Touch ID), Google sign-in is checklist step 6; Cancel rejects the request so sites fall back. iCloud Keychain ⛔: waits on Apple granting `com.apple.developer.web-browser.public-key-credential` (entitlements file ready) |
| Address & credit‑card autofill | ✓ | ✅ | Chrome's autofill (save bubble + dropdown, ledger 21); on NNCore Chrome's offers to save an address, update one ("Add new info to saved address") or save a card show as our prompt at the page's top right, styled as the password prompt and in Chrome's words, answered through Chrome's own controllers (`nn_autofill_prompt.mm`; 0.2.22 had lost them: the address offer never found a window without a BrowserView, the card offer never found the bubble handler). Switching tabs closes a pending offer, as Chrome's does; switching profiles keeps it (acceptance `autofill-save-prompts`, 2026-10-02); Settings › Autofill lists, adds, edits and deletes addresses and cards (card number behind Touch ID). Verified headless (2026-09-26, test data in a throwaway profile, cards on a local HTTPS page): an address fills all eight fields; a new one gets Chrome's "Save address?" bubble at the page's top right, inside the page area; a card fills name, number and expiry; a new card gets "Save card?". Found and fixed: focusing a card field with a saved card crashed the app (fixed in 0.2.3, `chromium-autofill-card-touchbar.patch`). Chrome fills cards on secure pages only. Left for a person: the dropdown and bubbles by eye (checklist step 4) |
| Edit › AutoFill menu (Contact, Passwords, Credit Card) | ✓ | ✅ | like Chrome's field menu, each item opens Chrome's dropdown at the page's focused form field (engine hook `CefShowAutofillSuggestions`, `CEF_NN_AUTOFILL_TRIGGER`): Passwords… lists the saved passwords on any text field (Chrome's "Select password" fallback), Contact… and Credit Card… the field's own suggestions (addresses or cards). With no form field focused, they open Settings on the window's profile (Passwords, or Autofill). Verified: a focused address field got Chrome's dropdown window right under it, a blurred page opened Settings; picking an entry is Chrome's own (checklist step 4) |
| Password reveal button | ✓ | ✅ | eye button in the page's password field once the user types (never for a filled saved password; sites with their own toggle keep theirs) in `helper/page_script.js`, and reveal in Settings › Passwords. Not visually re-checked on Chrome tabs |

## 17. Privacy & security
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Built‑in ad + tracker blocker (EasyList, EasyPrivacy), per‑site toggle | ✓ | ✅ | uBlock Origin Lite (MV3 DNR + cosmetic) as a component extension in every profile, incognito included (ledger 16); per-site "disable on this site"; blocked count from `ERR_BLOCKED_BY_CLIENT` |
| Cookie‑banner blocking, regional lists | ✓ | ✅ | uBOL's cookie and regional rulesets, toggles in Privacy › Advanced Ad Block Settings, which lists every uBOL ruleset truthfully (ads, trackers, cookie banners, annoyances, malware and scams, regional; filter counts; "On by default") and says which uBOL version the lists come from. The regional list for the user's languages is on from the first launch: the engine's languages now follow macOS's preferred languages (`accept_language_list`; before, every Mac got `en-US,en`), and uBOL turns on the lists for them as it does in Chrome (checked: German → deu-0, Simplified Chinese → chn-0, Canadian French → fra-0, English → none). Dia has no such default: its block-list manifest (bundled, and the live one on its server) gives no list a `languages` value, so its regional lists are opt-in. Freshness: Dia refreshes its lists from its server between releases. Ours come with uBOL, which publishes a release about weekly, and every Netnyahoo release now moves to the latest one (`scripts/update-ubol.sh`, step 3 of the release skill; the pin is `UBOL_VERSION` in `packages/nncore/scripts/ubol.sh`). Between our releases they don't change: Chrome never auto-updates a component extension (`Manifest::IsAutoUpdateableLocation` excludes it), and uBOL's URL-imported lists compile to dynamic rules, which Chrome caps far below EasyList's size |
| Clear cookies / cache for site | ✓ | ✅ | Site Controls and Settings › Privacy › site permissions |
| Incognito | ✓ | ✅ | in-memory off-the-record profile of the profile the window was opened from, shared by that profile's private windows; favicons and downloads stay in them (WP5); uBOL blocks there too |
| Usage / content data sharing opt‑in | ✓ | — | no telemetry here |
| Certificate / connection info | ✓ | ✅ | Site Controls connection row with certificate details; Chrome's interstitials for certificate errors |
| Enterprise MDM policies, managed‑browser banner, SSO | ✓ | — | |

## 18. Media & PiP
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Picture‑in‑Picture | ✓ | ✅ | Chrome's video PiP window restyled to Dia's, measured (`docs/dia-spec.md` › Picture in Picture; `chrome/browser/netnyahoo/pip/` (`engine/chromium`)): just the video at rest, with Dia's 6 pt rounded corners, 1 pt light rim and a shadow that follows the corners; on hover a 35 % scrim, back to tab and close as 28 pt rounded squares in the top corners, the origin centred in 13 pt, a bare pause glyph and a 5 pt progress bar (click or drag to seek); Chrome's skip, time, mute, captions and minimize controls are gone. Shows at once; fades out in 100 ms from its close button and 70 ms when going back to the tab (smooth while the tab shows). Opens where it was last left and at that size (across restarts, kept on screen). The hover card and Site Controls toggle it. Its close button only closes the window, as in Dia and Arc: the video keeps playing in its tab, which stays in the background (`chromium-pip-close-keeps-playing.patch`). Back to Tab (Chrome's button, the right-click menu) shows the tab. Smoke-tested (`NETNYAHOO_PIP_SELFTEST=close`); the pointer's hover state on the corner buttons is checklist step 13 ⌘-scroll (wheel or two-finger trackpad) or a pinch over the window resizes it (2026-10-06, the owner's request; ours, Dia's PiP doesn't zoom): AppKit's scroll-up direction grows it (so it follows the natural-scrolling setting), a trackpad in proportion to its points (150 pt ≈ 1.8×), a wheel ~8 % a notch eased over ~0.1 s, a pinch by its magnification; the aspect ratio stays the video's, the window stays docked to the screen edges it's within 64 pt of (else grows around the pointer) and on screen, between Chrome's own limits (284 × 160 and 80 % of the work area, the same as dragging its edge); a gesture that started as a zoom keeps zooming through its momentum, and nothing else scrolls or zooms. Plain scroll is unchanged; a document PiP window zooms the same way; a tucked one doesn't. The size is remembered with the place (Chrome's `NetnyahooPictureInPicture.plist`), and a size saved on a bigger display comes back clamped to the current one. `NNCorePiPZoom.h` (math; `pnpm -C packages/nncore test`), kill switch `defaults write … NNPictureInPictureZoom -bool NO`. Left for a person: the feel of the trackpad and wheel speeds with real hardware |
| Auto‑PiP on tab switch / window occluded (Meet, YouTube) | ✓ | ✅ | ours (NNBrowserView `autoPictureInPicture`): audible or capturing pages only; setting in Tabs. After the user closes it, a tab doesn't pop out again until it has been shown and left again. 2026-10-02 (NNCore, after 0.2.22): clicking the other pane of a split made Chrome take a Meet call as left and pop it out though it was still on screen. Chrome's automatic Picture in Picture and permission prompts now follow what the app shows (`nn_host_visibility.h`): pane focus changes pop nothing out, leaving the split (or for the New Tab page, another Space) pops the call out once, coming back closes it; a split's other pane can prompt, a hidden page prompts once shown. Acceptance: `activation-acceptance.mjs` (HTTPS fake conference). 2026-10-02: "f" then "f" on YouTube sometimes left the video in PiP or flickered it: the JS mini player read the window's occlusion right as the full-screen Space animation ended, still "occluded", and asked for PiP. One rule now decides whether the user left a page (`-[NNCoreWebView seenByUser]`: the app stopped showing it, or its window is covered or left for another app; the window's own full-screen transitions never count, `NNWindowFullScreen`), and the native view alone opens PiP and closes it on return (however it opened); Chrome hears the same reading, so a covered window pops a call out through Chrome. The user closing a PiP no longer needs tracking: the view acts only when the user leaves or comes back. Acceptance: `fullscreen-pip` (20 × f/f with a real transition's occlusion, with and without Media Session handlers; leaving the window; hand-opened PiP), `call-window-covered` |
| Document PiP | ✓ | ✅ | Chrome's own Document PiP window (its frame shows the origin and Back to tab) |
| PiP stash, return to tab, hostname bar | ✓ | ✅ | on Chrome's own video PiP window, in-process (`NNPictureInPicture.mm`): the origin is Chrome's, centred as in Dia (our host pill is gone); right-click anywhere: Back to Tab / Keep Window on Top (remembered); dragged mostly past a screen's left or right edge it tucks in with a 28 pt peek and a chevron handle (click: back on screen), and stays tucked if Chrome moves it. Verified with the DEV self-test (`NETNYAHOO_PIP_SELFTEST`, all 11 steps, including the remembered frame) and window captures, not a real pointer drag (checklist step 13) |
| Mini player for pinned media tabs (skip ±15 s, art, marquee) | ✓ | ✅ | hover mini player + sidebar player |
| Cast (Google Cast) | ✓ | 🧪 | Chrome's Media Router drives our Cast picker (devices, status, Stop; "Sources" for tab or screen) from View › Cast…, Site Controls › Cast…, the page menu's Cast… and a site's own Cast button (Presentation API); the toolbar shows a highlighted cast button while this profile casts (click: the picker; right-click: Stop Casting). Discovery runs in this build (mDNS + DIAL started, `media-router-internals`); no Cast device was on the test network, so casting itself is checklist step 12. Re-checked 2026-09-26 with a fake Chrome model: the picker lists the devices with their status and Stop, and the toolbar's cast button lights up while the profile casts (the live dialog wasn't opened again: its discovery can raise macOS's Local Network prompt over the user's screen) |
| Screen‑share indicator, "Share this tab instead" | ✓ | ✅ | indicator (red capture glyph + tab badges); Dia-style picker with Tabs (tab video + tab audio through our tab-capture patch), screens and windows. While a site shares a tab, Dia's info bar sits above the page: "Sharing this tab with …" with Stop Sharing on the shared tab, "Sharing another tab with …" with Share This Tab Instead on the profile's other pages (the site's tracks keep running with the new tab), Dismiss on both |
| Camera / mic permission prompts | ✓ | ✅ | our prompt, no Chrome bubble (ledger 23) |
| Notifications permission | ✓ | ✅ | our prompt, then macOS permission; the page script shows web notifications natively with click-through |
| Location permission | ✓ | ✅ | our prompt verified (Don't Allow → denied); Allow (which raises macOS's own prompt) not run yet |
| Bluetooth permission | ✓ | ✅ | Chrome's device chooser drawn as our prompt under the address ("example.com wants to pair", devices with signal and paired / connected state, Scanning…, Scan Again, Bluetooth off / no macOS access with a link to System Settings, Pair / Cancel); also WebUSB, WebHID and Web Serial choosers and requestLEScan's scanning prompt. Verified with the Mac's real Bluetooth devices listed and Cancel rejecting the page's request |
| Fullscreen video (incl. other display) | ✓ | ✅ | page fullscreen puts our window into fullscreen, and Chrome only tracks the state (`CEF_NN_TAB_FULLSCREEN`); Esc exits. Verified headless (2026-09-26; test instances act the window's full screen out, 22 checks): the page fills the window with the sidebar and toolbar hidden, Esc and `exitFullscreen()` bring them back at the page's size, no full screen without a gesture; in a window already full screen, the page doesn't toggle it; with two profiles, a page in the other profile's window goes full screen without taking the window out. Found and fixed: leaving window full screen by hand left the page full screen, and that other-profile page took the window out of full screen. 2026-09-30: a playing video (YouTube) left the window full screen with the sidebar and toolbar showing. The Space change occluded the window mid-transition, auto Picture in Picture fired and pulled the video out of element full screen, and AppKit ignored our toggle back out; occlusion during full-screen transitions and on full-screen pages no longer starts auto PiP, and a page that leaves mid-transition takes the window out once it settles. Switching or closing the tab now exits page full screen and the window's, and a split pane's page full screen keeps the focused pane on exit. Verified headless with 19 checks plus split and auto-PiP cases (`NETNYAHOO_FAKE_FULLSCREEN_MS` gives the acted-out transition AppKit's duration). Left for a person: AppKit's Space and animation on a real screen, the "Press Esc" bubble's look there, and a second display (checklist step 1). 2026-10-02 (NNCore, after 0.2.22): 0.2.22 lost the window's macOS full screen for a page, reported a full-screen exit on a tab switch to the newly selected tab (A stayed flagged full screen, so its toolbar and sidebar vanished again on return), and didn't end full screen when the app hid a page (its New Tab page, another Space). The engine now reports the page Chrome holds in full screen (`NNBrowserWindow::ReportFullscreenTab`, also for a page going full screen in a window already full screen), the window enters macOS full screen for the page and leaves it afterwards only if it entered for it (`NNPageFullScreen`, NNCoreChromeWindow.mm), leaving it by hand ends the page's full screen, and hiding a page ends its full screen, pointer lock and keyboard lock (`-[NNCoreTab exitExclusiveAccess]`). Acceptance: `fullscreen-tab-switch`, `fullscreen-native`, `fullscreen-hidden-page`. 2026-10-02: each transition is recorded with who started it (the app for a page, or the user) instead of a 3 s watchdog, whose expiry on a slow way out made its late end read as the user's and threw a page that had come back into full screen out again (`fullscreen-native`) |
| Proprietary codecs (H.264 / AAC / MP4) | ✓ | ✅ | our CEF build (`proprietary_codecs`, `ffmpeg_branding="Chrome"`, VideoToolbox decode) |
| Protected video (Widevine DRM: Netflix, Spotify…) | ✓ | ⛔ | Widevine is compiled in, but Google licenses the CDM only to browsers it signs for VMP (Verified Media Path), and the CDM itself arrives from Google's component updater, which domain substitution removed. Without VMP signing, streaming services refuse the CDM even if it's installed. Settings › Advanced's Widevine row says it isn't available in this build (no update button) |

## 19. Sharing & printing
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Share sheet (File › Share…) | ✓ | ✅ | The page's link without trackers (Copy Clean Link's cleaning) and its title, through macOS's sharing services: Site Controls › Share… (the share sheet at the row), the command bar's Share (the sheet, also found by "airdrop"), File › Share ▸ and the tab menu's Share ▸ (the services the system lists for a web link with their icons, as Safari and Chrome list them, then More… for System Settings' sharing extensions; Mail and Reading List are left out as Chrome does, File › Email Page Location sends the link). Dia's ShareMenu (from Arc) builds its menu the same way (`sharingServicesForItems:`). Web pages only; private windows and Small Yahu too. No shortcut: Dia has none recorded. Not in the page's right-click menu: it's Chrome's, which has none, and Dia's binary lists Share only for its tab menu. 2026-10-05: before this, File › Share… was the only way in and the popover had none (owner's report). A hidden instance logs what it would share to `activation.log` instead of showing the sheet or running a service. Left for a person: the sheet's look and a real AirDrop / Messages send |
| Copy URL ⇧⌘C | ✓ | ✅ | tracker-stripped |
| Print / Save as PDF ⌘P | ✓ | ✅ | `CefBrowserHost::Print`, which on Chrome tabs should be Chrome's print preview; not re-checked since the migration (checklist step 9) |
| Handoff (browsing activity) | ✓ | ✅ | per window, never incognito; the app is team-signed now, cross-device Handoff not tried |

## 20. Import, account & sync
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Import from Chrome, Safari, Firefox, Edge, Brave, Opera, Vivaldi, Arc, Dia, Helium | ✓ | ✅ | + Opera GX, Island, Chrome channels, Chromium; bookmarks, history, open tabs, passwords (into Chrome's password manager), cookies so you stay signed in (Chromium family's `Cookies`, v10-decrypted with the browser's Safe Storage key incl. the SHA-256 host prefix; Firefox's `cookies.sqlite`; Safari's `Cookies.binarycookies` behind Full Disk Access; written into the profile's Chrome cookie store by `nn_cookies_import`, never into a private profile, never over a cookie the profile already has; values stay native and are wiped after the write), addresses and cards (Chromium `Web Data`, Safari export cards; into Chrome's PersonalDataManager by `nn_autofill_import`), and the source's Chrome Web Store extensions offered on the Web Store after the import. Dia and Helium (imput's ungoogled-chromium) import as ordinary Chromium — Dia's tabs are plaintext SNSS, secrets under "Dia Safe Storage"; Helium's Keychain item is "Helium Storage Key" / "Helium". Chrome and Brave protect their data from other apps on current macOS, so they're listed as "Needs Full Disk Access" and go through the same FDA step as Safari |
| Safari direct import (no export .zip) | — | ✅ | Reads `~/Library/Safari` directly (bookmarks, history, Reading List, open tabs) when Netnyahoo has Full Disk Access; the import UI detects FDA, links to System Settings and re-checks on return. The export `.zip` stays as the fallback and the only path for Safari passwords/cards |
| Arc import (spaces, pinned tabs, custom names) | ✓ | ✅ | |
| Dia sidebar import (spaces, pinned tiles, custom names/colours) | ✓ | 🟡 | Covered: Dia's profiles, pinned tabs and open tabs, through Dia's AppleScript dictionary (Import › "Dia: open and pinned tabs (via Dia)", `DiaTabs.swift` / `DiaAppleEvents.swift`). With Dia running and after macOS's Automation consent (explained first; if denied, the window links System Settings › Privacy & Security › Automation and continues when allowed; if Dia isn't running, it offers to open it), ten Apple Events read every window's profiles and their tabs (id, title, URL, isPinned, isFocused), 10 s timeout each. Each Dia profile maps onto a Netnyahoo profile with the importer's profile step (the first into the chosen profile, the rest new ones or the same-named one); favourites and pinned tabs become pinned tabs in Dia's order, open tabs go into "Imported"; pages open in several windows or both pinned and open come once, `dia://` / `chrome://` / `about:` pages are skipped, and pages the profile already has aren't added again. Not covered, and blocked: custom tab names, colours, spaces and folders. Dia's dictionary doesn't expose them, and its sidebar store is a SQLCipher-encrypted `tabs.db` (GRDB; tables `nodes`/`tabs`/`tab_groups`/`spaces`/`windows`/`content_panes`, columns `space_id`/`custom_title`/`custom_icon`/`title_source`/`pinned_container`/`favorites`) whose key is derived (HKDF-SHA256) from a root key in Dia's own team keychain access group (`S6N382Y83G.company.thebrowser.browser.auth`), which other apps can't read (inferred from the binary; nothing was decrypted). Verified: 8 Swift tests on sdef-shaped fixtures (mapping, dedupe, skipping, status codes, the object specifiers), the real Apple Events path end to end against a scriptable stand-in with Dia's own sdef (in-process, so no consent prompt; its answers matched the fixture exactly), and a hidden instance pointed at the stand-in: the listing, the not-running, consent (macOS's real check, without prompting) and denied screens, and the stand-in's answer imported into two profiles (pinned order, "Imported", a page already open skipped, a second run adding nothing). Not run against the real Dia, whose consent prompt needs the user (checklist step 16) |
| Account (Atlassian identity, OTP, delete account) | ✓ | — | |
| E2E‑encrypted sync (24‑word phrase, recovery kit, device transfer) | ✓ | ✅ | no server: every Mac reads and writes sealed files in a folder the user picks (iCloud Drive › Netnyahoo Sync by default, no entitlement; Dropbox, a NAS or a USB drive work too). 24 BIP-39 words from the CSPRNG, as Dia's; HKDF-SHA256 keys, AES-256-GCM per file bound to its name, keyed or random names, 1 KiB padding; the key in the login Keychain, this Mac only. Per-device append-only logs, last writer wins per record by hybrid logical clock, snapshots with safe pruning; iCloud placeholders and half-copied files wait. Syncs bookmarks, 90 days of history, open tabs, pinned tabs and groups, settings and saved passwords (Chrome's, read from its store on disk, written through its API; turning sync off never removes one). Recovery Kit PDF / text with a QR code; device transfer by entering the phrase (or scanning its QR code with an iPhone and pasting with Universal Clipboard). Design and threat model: `docs/sync.md`. Verified: 21 Swift and 21 JS unit tests, and 40 end-to-end checks with two and three hidden instances through a temporary folder (`packages/sync/scripts/e2e.mjs`, 2026-09-26). Left for a person: two real Macs over iCloud Drive (checklist step 15) |
| Invite / referrals | ✓ | — | |

## 21. Appearance
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Light / Dark / Automatic (View › Appearance) | ✓ | ✅ | also in Settings › Appearance; light mode not visually re-verified |
| Profile theme colours | ✓ | ✅ | 9 colours |
| Custom app icons (Dock tile plug‑in) | ✓ | ✅ | Settings › Appearance › App Icon (7 variants); `NetnyahooDockTile.plugin` keeps it after quitting. Not yet seen in the real Dock |
| Pro / unlockable backgrounds | ✓ | — | plans feature |
| Liquid Glass / "Sunglow" refresh (1.50) | ✓ | ✅ | New Tab mark (ours: Big Yahu, §7), bar shadows, one-colour power-up band, selected-tab tint, 0.25 s profile-swipe settle (WP11); the lighter 1.50 key tint (the WindowTreatment blur + tint stack: material 29 / `.hudWindow`, base tint black 0.4 / white 0.8, profile gradient at 0.5 / 0.75 with ΔL 0.25) and the 0.5 card, the bar's 1 pt offset and 112 pt height, the tab loading spinner, the mark's 76 pt size, the bar's rows and the lighter grain (R3); the host-only URL bar (§8, from the binary). Dia uses no Liquid Glass API; the app icon stays ours. Checked side by side with a Dia 1.50.1 capture (settled New Tab, dark, key, plum, 1512 × 949 at 1×, same crop, window-only ScreenCaptureKit on both): bar edges identical (x 522.5 … 1174.5, y 375.5 … 487.5), mark within 1 px (x 811 … 885 against 810 … 886, y 289 … 349 against 289 … 350, same centre), bar fill (45, 45, 45) in both, page and sidebar gutter within 1.5 levels (page top (42.0, 34.5, 36.0) against (42.0, 34.5, 36.4)). Still for the user (checklist step 10): the light appearance, which no Dia capture shows yet |
| Liquid Glass pinned tiles and URL field (macOS 26) | ✗ | ✅ | ours: the pinned tiles and the URL field (the sidebar's, or the toolbar's pill) are AppKit Liquid Glass (`NSGlassEffectView`, components/glass) in Dia's layout, the glass tinted from the theme token Dia fills them with (resting, hover / multi-selected, pressed, selected) 15% toward the profile colour; a selected tile is raised glass rather than Dia's ring (DockSelection `glass`): a brighter tint, a soft shadow under it, a top sheen, a 1 pt light rim brightest at the top, and a faint glow of the icon's colour that drops black, white and greys, so a dark icon (X, GitHub) never darkens it. Before macOS 26: Dia's flat fills. Replaces 0.2.7's Liquid Glass sidebar style (removed) |
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
| Sync | ✓ | ✅ | Settings › Sync, with Dia's flows and words: Turn On Sync / Enter Recovery Phrase… / Other Options (Set Up Without Another Device), Save Your Recovery Kit, Connect with Recovery Phrase ("%d/%d words", "too many words", Dia's three phrase errors), the status line ("starting up", "updating", "updated just now", "not syncing · last synced %@", "offline"), Connect Another Device…, Advanced… (Save Recovery Kit…, Copy Recovery Code, Stop Syncing…), Stop Syncing This Device? and Delete Sync Data?, plus the sync folder, profiles, what syncs and devices. Dia keeps it in Account › Sync; there's no account here |
| Keyboard Shortcuts (remap any action, F‑keys, conflict handling) | ✓ | ✅ | every menu command, recorder, conflicts filter, reset |
| Usage / Billing | ✓ | — | |
| Advanced | ✓ | ✅ | Battery Saver, the engine version, Widevine ("not available in this build"); also our Search Engine, Live Folders and Calendar panes |

## 23. Developer & scripting
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| DevTools ⌥⌘I / F12 | ✓ | ✅ | Docked on the right by default (Chrome's dock-side menu, remembered per profile), device toolbar (⇧⌘M in DevTools) docked and undocked. ⌥⌘I, context-menu Inspect; F12 is Chrome's DevTools toggle (opens them, closes docked ones, and closes the undocked window it's pressed in). The undocked window is titled like Dia's, "Developer Tools - <url>", and opens where the profile's DevTools window was last left (Chrome's own record, 640 × 640 the first time); View › Developer › View Source ⌥⌘U (`view-source:` tab), Inspect Elements ⌥⌘C and JavaScript Console ⌥⌘J, run as Chrome's own commands (⌥⌘I / ⌥⌘J close docked DevTools) |
| Task Manager | ✓ | ✅ | Chromium task rows, CPU/memory, End Process |
| AppleScript dictionary (windows, tabs, profiles, execute JS) | ✓ | ✅ | Netnyahoo.sdef; execute runs through the renderer's `nn-eval`, which works on Chrome tabs |
| Raycast extension support (via AppleScript) | ✓ | ✅ | `extras/raycast-netnyahoo`: Search Tabs lists every window's tabs and switches to one (also Copy URL, Close Tab), through the AppleScript dictionary. Verified (2026-09-26) with `osascript` from another process against a hidden instance, as Raycast's `runAppleScript` sends them (20 checks): the extension's list, focus, activate and close scripts, and the dictionary (count, make new tab and window, URL get and set, go back / forward, execute with a promise, reload, tab properties, active tab index, profiles, close). Found and fixed: `make new window with properties {URL:…}` failed (-1700). Its `npm test` passes. Left for a person: installing it in Raycast and its first-run consent prompt (checklist step 14) |
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
| Auto‑updates (Sparkle, deferrable) | ✓ | ✅ | Sparkle 2: Check for Updates…, automatic checks every 8 hours, an install that waits until no window is full screen, Settings › General › Updates. The feed is the latest GitHub release's `appcast.xml` (`SUFeedURL`); `scripts/release.sh` signs each update with the EdDSA key and notarizes the app and DMG (since 0.2.1; 0.2.2 shipped this way). The first launch after an update opens its release notes |

## 25. Onboarding, help, plans
| Feature | Dia | Netnyahoo | Gap |
|---|---|---|---|
| Intro animation with music (mute / skip) | ✓ | ✅ | our own synthesized music on the animation's cues; Dia's mute button, remembered |
| Onboarding steps (email, role, apps, default browser, pinned‑tab suggestions) | ✓ | ✅ | default browser / Dock / login, personalization, import, pinned-tab suggestions; email and role are account steps (—), apps ⏸ |
| Welcome postcard, tool tour, Trial Guide, video tour | ✓ | ✅ | welcome postcard and coach-mark tool tour done. Video tour: Help › Video Tour opens Info.plist `NNVideoTourURL` (Dia's opens diabrowser.com/tour); hidden while that's empty, on purpose, until there's a public video. Trial Guide —: Dia's (1.50.1 binary and its bundled page) is a "Start with Dia" checklist of 12 actions in 4 levels (First steps: create account, unlock morning brief, send first message; Open the map: make default browser, connect apps, ask on page; Find your rhythm: create tab group, message connected apps, create report; Go further: split view, @ context, profiles), where a level unlocks after 2 of its 3 actions. 8 of the 12 are account or AI actions (— / ⏸), level 1 has none we have, so the guide couldn't get past it. It's also off by default in Dia (`trial-guide-enabled` and its New Tab stamp card compiled false, rolled out remotely) |
| "What's new" postcard / Dia Weekly | ✓ | ✅ | NTP release-notes postcard and full-page notes; Dia Weekly (a newsletter) — |
| Help menu (Chat with Support, Status, Feedback) | ✓ | ✅ | Send Feedback… opens a new GitHub issue (github.com/mantrakp04/netnyahoo) with Copy Diagnostics' report as its body (Info.plist `NNFeedbackURL`, `%s` = the report; a build can point it elsewhere, or clear it for `NNFeedbackEmail` or a mail draft; checked: signed out, GitHub's sign-in page keeps the prefilled issue as its return URL). Keyboard Shortcuts, Tool Tour, Video Tour (hidden until there's a video), Release Notes, Copy Diagnostics, Record Performance Issue…. Dia's Chat with Support (its help centre) and Status (status.diabrowser.com) are pages about Dia's own service: — for us, with no support desk or online service (feedback goes to GitHub issues) |
| Plans / trial / usage credits | ✓ | — | |

## Keyboard shortcuts — Dia, Chrome and Netnyahoo
The union of Dia 1.50.1's shortcuts (its menus and keyboard-shortcut actions) and Chrome's for the Mac (its main
menu, `accelerators_cocoa.mm`, `global_keyboard_shortcuts_mac.mm` and Google's shortcut page). Where they clash,
Dia's wins and Chrome's key stays as a hidden alternate when it's free. Bindings: `packages/shell/ios/Menus.swift`
(hidden items are "(hidden)"), commands: `lib/commands.ts`.

Verified by `apps/browser/scripts/shortcuts-test.mjs` (a hidden Debug instance; each key is dispatched as AppKit
does, through Chrome's window and then the menu bar) with the focus in a page, in our UI (the sidebar), in a page's
text field (field) and in the command bar (bar); DevTools too. ✓ = the key reached its command; ○ = it reached its
item, disabled in that state (Back with no history, Stop with nothing loading); – = the field keeps the key, as in
Chrome; n/t = not pressed there by the test (clipboard and window-level AppKit items, looked up from the sidebar only).

| Action | Dia | Chrome | Netnyahoo | Page / sidebar / field / bar | Status |
|---|---|---|---|---|---|
| Settings | ⌘, | ⌘, | ⌘, | ✓ ✓ ✓ ✓ | ✅ |
| Hide / Hide Others / Quit | ⌘H / ⌥⌘H / ⌘Q | same | same | n/t ✓ n/t n/t (⌘Q quits: checked) | ✅ |
| New Tab / New Window / New Incognito Window | ⌘T / ⌘N / ⇧⌘N | same | same | ✓ ✓ ✓ ✓ | ✅ |
| New Tab in Group | ⌥⌘T | ⌃⌘C (add tab to group) | ⌥⌘T (+ hidden ⌃⌘C) | ✓ ✓ ✓ ✓ | ✅ |
| Reopen Closed Tab | ⇧⌘T | ⇧⌘T | ⇧⌘T | ○ ○ ○ ○ (nothing closed); reopens: checked | ✅ |
| Open File… | — | ⌘O | ⌘O (File menu); in Small Yahu it's Open in Netnyahoo, as in Little Arc | ✓ ✓ ✓ ✓ | ✅ new |
| Open Command Bar / address bar | ⌘L | ⌘L, ⌃F5 | ⌘L (+ hidden ⌃F5) | ✓ ✓ ✓ ✓ | ✅ |
| Close Window / Close Tab | ⇧⌘W / ⌘W | same | same | n/t ✓ n/t n/t / ✓ ✓ ✓ ✓ | ✅ |
| Close All Tabs / Clean Up Tabs | ⇧⌘K / ⌥⌘K | — | same as Dia | ✓ ✓ ✓ ✓ | ✅ |
| Save Page As… | — | ⌘S | menu item, no key (⌘S is Dia's Auto-Hide Tabs) | — | ✅ new |
| Email Page Location | — | ⇧⌘I | ⇧⌘I (File menu) | ✓ ✓ ✓ ✓ | ✅ new |
| Print / Print Using System Dialog | ⌘P / — | ⌘P / ⌥⌘P | ⌘P / ⌥⌘P (File menu) | ✓ ✓ ✓ ✓ | ✅ ⌥⌘P new |
| Undo / Redo / Select All | ⌘Z / ⇧⌘Z / ⌘A | same | same | ✓ ✓ ✓ ✓ (⌘A selects a page field's text: checked) | ✅ |
| Cut / Copy / Paste / Paste and Match Style | ⌘X / ⌘C / ⌘V / ⇧⌘V | same | same | n/t ✓ n/t n/t (the Edit menu's, untouched) | ✅ |
| Copy URL / as Markdown | ⇧⌘C / ⌥⇧⌘C | ⇧⌘C inspects | Dia's | ✓ ✓ ✓ ✓ | ✅ |
| Find / Next / Previous | ⌘F / ⌘G / ⇧⌘G | same | same | ✓ ✓ ✓ ✓ | ✅ |
| Use Selection for Find | — (⌘E is Chat) | ⌘E | ⌘E (no Chat here) | ✓ ✓ ✓ ✓ | ✅ new |
| Jump to Selection / Find and Replace | ⌘J / ⌥⌘F | ⌘J / ⌥⌘F searches the web | Dia's | ✓ ✓ ✓ ✓ | ✅ |
| Spelling / Check Now | ⌘: / ⌘; | same | same | n/t ✓ n/t n/t (they'd open AppKit panels) | ✅ |
| Stop | — | ⌘. (and Esc) | ⌘. (View menu), Esc on a loading page | ○ ○ ○ ○ (nothing loading) | ✅ new |
| Refresh / Force Refresh | ⌘R / ⇧⌘R | same | same | ✓ ✓ ✓ ✓ | ✅ |
| Show Tabs in Sidebar / Auto-Hide Tabs | ⇧⌘S / ⌘S | ⇧⌘L collapses vertical tabs, ⇧⌘F toolbar in full screen | Dia's (+ hidden ⇧⌘L, ⇧⌘F for Auto-Hide) | ✓ ✓ ✓ ✓ | ✅ |
| Open Split Pane / Focus Next / Previous | ⌃⇧= / ⌃⇧] / ⌃⇧[ | ⌥⌘N new split view | Dia's (+ hidden ⌃+ ⌃} ⌃{); ⌥⌘N is New Small Yahu Window, as in Arc | ✓ ✓ ✓ ✓ / ○ (no split) | ✅ |
| New Small Yahu Window (Arc's Little Arc) | — | — | ⌥⌘N (Arc's) | ✓ ✓ ✓ ✓ | ✅ new |
| Toggle Bookmarks Bar / Manage Bookmarks | ⇧⌘B / ⌥⌘B | same | same | ✓ ✓ ✓ ✓ | ✅ |
| Actual Size / Zoom In / Out | ⌘0 / ⌘+ / ⌘- | same (+ ⌘=) | same (+ hidden ⌘=) | ✓ ✓ ✓ ✓ | ✅ |
| Enter Full Screen | 🌐F | 🌐F, ⌃⌘F | 🌐F (+ hidden ⌃⌘F) | n/t ✓ n/t n/t | ✅ |
| Developer Tools / F12 / View Source / Console / Inspect | ⌥⌘I, F12 / ⌥⌘U / ⌥⌘J / ⌥⌘C | same | same | ✓ ✓ ✓ ✓ (and in DevTools) | ✅ |
| Caret browsing | — | F7 | F7 (hidden) | ✓ ✓ ✓ ✓ | ✅ new |
| Back / Forward | ⌘[ / ⌘], ⌘← / ⌘→ | same | same (⌘← / ⌘→ hidden; a text field keeps them) | ○ ○ ○/– ○/– (no history) | ✅ ⌘←/→ new |
| Next / Previous Tab | ⇧⌘] / ⇧⌘[, ⌥⌘→ / ⌥⌘←, ⌥⌘↓ / ⌥⌘↑ | ⇧⌘] / ⇧⌘[, ⌥⌘→ / ⌥⌘←, ⌃⇟ / ⌃⇞ | all of them (alternates hidden) | ✓ ✓ ✓ ✓; selects: checked | ✅ |
| Tab Switcher | ⌃Tab / ⌃⇧Tab | ⌃Tab / ⌃⇧Tab = next / previous tab | Dia's switcher | ✓ ✓ ✓ ✓ | ✅ |
| Move Tab Down / Up | — | ⌃⇧⇟ / ⌃⇧⇞ | same (hidden) | ✓ ✓ ✓ ✓ | ✅ new |
| Select Tab 1–8 / Last Tab | ⌘1–⌘8 / ⌘9 (sidebar order) | same (tab strip) | the sidebar's rows: pinned tiles, pinned groups, then the list (a split view is one row) | ✓ ✓ ✓ ✓; selects: checked in each focus | ✅ fixed |
| Search Tabs | ⇧⌘A | ⇧⌘A | ⇧⌘A | ✓ ✓ ✓ ✓ | ✅ |
| Back to Pinned URL | ⌘↩ | — | ⌘↩ (hidden) | ○ ○ – – | ✅ |
| New Group with Tab / Close Group | ⌃⌘N / — | ⌃⌘P / ⌃⌘W | ⌃⌘N (+ hidden ⌃⌘P), ⌃⌘W (hidden) | ✓ ✓ ✓ ✓ | ✅ ⌃⌘W new |
| Add to Bookmarks / Bookmark All Tabs | ⌘D / — | ⌘D / ⇧⌘D | ⌘D / ⇧⌘D | ✓ ✓ ✓ ✓ | ✅ ⇧⌘D new |
| Show History / Clear Browsing Data | ⌘Y / ⇧⌘⌫ | same | same | ✓ ✓ –/✓ ✓ (a page's field keeps ⇧⌘⌫, as in Chrome) | ✅ |
| Minimize / Minimize All | ⌘M / ⌥⌘M | ⌘M | same | n/t ✓ n/t n/t | ✅ |
| Downloads | ⇧⌘J | ⇧⌘J, ⌥⌘L | ⇧⌘J (+ hidden ⌥⌘L) | ✓ ✓ ✓ ✓ | ✅ |
| Switch to Profile 1–9 / profile menu | ⌃1–⌃9 / profile switcher | ⇧⌘M profile menu | ⌃1–⌃9, ⇧⌘M (hidden) | ✓ ✓ ✓ ✓; switches: checked | ✅ ⇧⌘M new |
| Send Feedback | — | ⌥⇧⌘I | ⌥⇧⌘I (Help menu) | ✓ ✓ ✓ ✓ | ✅ new |
| Chat / Focus Chat / bar → Chat | ⌘E / ⌃⌘E / ⌃⌘↩ | — | — (no AI; ⌘E is Use Selection for Find) | — | ⏸ |
| Home | — | ⇧⌘H | — (no home page: a New Tab is ⌘T) | — | — |
| Focus toolbars / inactive dialogs, reading mode | — | ⌥⌘↑/↓ (Dia's are tab alternates), ⌥⇧⌘A, ⌥⌘R | — (Chrome's hidden UI; ⌥⌘↑/↓ go to Dia's) | — | — |
| Focus next / previous tab group | — | ⌃⌘X / ⌃⌘Z | — (groups aren't focusable rows) | — | — |
| Window Fill / Center / Previous Size, cycle windows | 🌐⌃F / 🌐⌃C / 🌐⌃R, ⌘` | same | AppKit's | — | ✅ |
| Rename tab | double-click | — | double-click | — | ✅ |

**Command bar** (like Chrome's address bar): ↩ this tab, ⌘↩ / ⌥↩ new tab, ⇧↩ new window, ⇧⌘↩ search what was
typed (Dia), ⌃↩ adds www. and .com, ⌃⇧↩ the same in a new window (new), Tab / ⇧Tab, ↑↓, ⌃N / ⌃P, Esc.

**In a page** (the page's own, unchanged): Esc stops loading, Space / ⇧Space and ⌘↑ / ⌘↓ scroll, Tab / ⇧Tab move
between links, and in text fields ⌥← / ⌥→, ⌥⌫, ⌘← / ⌘→ and ⌘A / ⌘C / ⌘V / ⌘X / ⌘Z stay the field's.

**Mouse** (checked with CDP clicks on a link): ⌘-click → background tab, ⇧⌘-click → foreground tab, ⇧-click →
new window (a private one from a private window), middle-click → background tab, ⌥-click → download, ⌥⌘-click (Chrome's) and
⌥⇧-click → split. ⌘-click Back / Forward → a new tab (§ Navigation).

## Menus
Checked against `packages/shell/ios/Menus.swift`; every item has a handler (lib/commands.ts, sidebar/commands.ts,
lib/appIntegration.ts).

| Menu | Dia | Netnyahoo |
|---|---|---|
| App (About, Updates, Invite, Settings, Import, Services, Sign Out, Hide, Quit) | ✓ | ✅ About, Check for Updates…, Settings…, Import from Another Browser…, Services, Hide / Hide Others / Show All, Quit (Invite and Sign Out are account features: —) |
| File | ✓ | ✅ New Tab, New Tab in Group, New Window, New Incognito Window, Reopen Closed Tab / Window, Open Command Bar, Close Window / Tab / All Tabs, Clean Up Tabs, Share ▸ (the system's sharing services, More…), Print… (Chat ⏸) |
| Edit | ✓ | ✅ Undo … Select All, Copy URL (as Markdown), Paste and Match Style; Find ▸ (Find, Find and Replace, Next, Previous, Use Selection for Find, Jump to Selection); Spelling and Grammar, Substitutions, Transformations, Speech; AutoFill ▸ (Contact…, Passwords…, Credit Card…: Chrome's dropdown at the focused field, else Settings, see §16) |
| View | ✓ | ✅ every Dia 1.50.1 item, same titles and shortcuts: Appearance ▸, Refresh / Force Refresh the Page, Show Tabs in Sidebar, Auto-Hide Tabs, split panes, Show Bookmarks Bar ▸, Show Full URL (now the same toggle as Dia's, §8), zoom, Enter Full Screen, Developer ▸; plus ours: Show Address Bar in Sidebar, Cast…, View Source, JavaScript Console. Dia's grouping too (no separator after Appearance; separators after Auto-Hide Tabs, between Show Bookmarks Bar ▸ and Show Full URL, and between Enter Full Screen and Developer ▸), and Force Refresh the Page is Refresh's ⇧ alternate, as in Dia's menu builder (`setAlternate:` at `0x10054228c`); it stays in Settings › Keyboard Shortcuts |
| Tabs | ✓ | ✅ Back/Forward, Next/Previous Tab, Search Tabs…, Pin, Duplicate, New Group with Tab, Move to Profile / Window, Add to Bookmarks…, Add Bookmark to Folder, Rename…, Change Icon…, Mute Site |
| Bookmarks | ✓ | ✅ Bookmark This Page, Bookmark All Tabs…, Manage Bookmarks, Recent Bookmarks, Bookmarks Bar / Other Bookmarks trees |
| History | ✓ | ✅ Show History…, Clear Browsing Data…, Recently Closed, Recently Closed Groups |
| Extensions | ✓ | ✅ one item per enabled extension (opens its popup or runs its action), Add Extension…, Manage Extensions…, Pin Extensions… |
| Window | ✓ | ✅ Minimize (+ Minimize All), Arrange in Front, Keep Window on Top, Downloads, Task Manager, Merge All Windows, Profiles, AppKit's Move & Resize and window list |
| Help | ✓ | ✅ Send Feedback… (a GitHub issue with the diagnostics), Keyboard Shortcuts, Tool Tour, Video Tour (hidden until there's a video), Release Notes, Copy Diagnostics, Record Performance Issue… (+ DEBUG Show Onboarding). Dia 1.50.1: Chat with Support, Video Tour, Status, Copy Diagnostics, Record Performance Issue… (Cancel Performance Recording while it records; ours asks Stop / Discard in a dialog instead), and an internal Export Sync Log…; Chat with Support and Status are Dia-service pages (—) |

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
   extensions (tab ids now come from Chrome itself) and the `TabsRequest` actions that no longer occur. The
   `NN_CHROME_TABS 0` fallbacks went with the stock-CEF build (12). Alloy stays on
   purpose for the hidden WebUI helper pages and non-hostable views (NNChromePages.mm, NNWindowHost.mm `CreateTab`).
2. **Fixed (R1).** Page context menu on Chrome tabs: it's Chrome's own menu now, with our search engine's name and
   action on "Search … for", our Inspect, Dia's quote link on "Copy Link to Highlight", our split for "Open Link in
   Split View", and items for Chrome UI we don't show removed (translate, Lens, QR code, send to devices, reading
   mode, "Open Link as" profiles). Chrome's Cast… is back (R2): it opens our Cast picker. Extension items show and run.
   NNCore (0.2.22) brought "Create QR Code for this Page/Image" back, and picking it quit the app (Chrome's QR
   bubble anchors to a toolbar our Browsers don't have: a null `ToolbarButtonProvider`); it, Send to your devices
   and Google Lens are gone from the menu again, as is the Reading mode item a text field's menu still had
   (`nn_context_menu.mm` `RemoveViewlessItems`, 2026-10-04).
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
   uBOL version the lists come from. The lists change when the bundled uBOL is bumped, which every release now does
   (`scripts/update-ubol.sh`).
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
12. **Removed (2026-10-01): the stock-CEF path.** `NN_CHROME_TABS=0`, `CEF_PREBUILT=1` and the per-feature `NN_*`
    macros are gone (architecture review, rec. 3): the app builds only against our engine (since the NNCore
    cutover, Chrome's framework from our tree, `docs/cef-source-build.md`).
13. **Fixed (R3): docs and comments that contradicted the code.** `docs/agent-brief.md` rewritten for the current
    architecture (Chrome-style CEF, `NETNYAHOO_BACKGROUND` / NNActivation, the own-CEF rebuild flow, `packages/import`,
    no `packages/webkit`, a repo with history); `docs/migration-status.md`'s finished "In progress", "Known regressions"
    and "Remaining after the build" sections and the BRANDING notes on tests 40–41; an as-built note on
    `docs/research/chromium-ui-layer.md` WP3; the Info.plist "Distribution" block (now the real key names); the
    NNFavicons, Move to Window, Alloy screen-sharing, import-Keychain and `Menus.swift` comments; the README (it still
    described WebKit). The `NNSwipe.mm` responder-delegate comment went with Findings 3 (R1).
14. No `TODO`/`FIXME`/`XXX` markers in the code paths audited.

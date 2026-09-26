# Chrome-layer migration — status & test ledger

Architecture: patched CEF (Chrome style). Since 0.2.0 every app window is Chrome's own Browser window, one per profile
it shows, with our React root laid over Chrome's views (`docs/research/chrome-hosted-window.md`); each tab's
WebContents NSView is hosted in our RN views. Before 0.2.0 a hidden "ghost" Browser per app window and profile owned
the tabs (`docs/research/chromium-ui-layer.md`); entries below from that time say "ghost".

The patched CEF (154.0.28, `NN_CHROME_TABS 1`) has been in since 2026-09-25; `docs/dia-feature-parity.md` holds the
current feature status and the remaining work. Rule: when you finish something that can't be verified yet (usually
because it needs the user present), add it to the **Test ledger** with the exact test to run, and move it to
**Done & verified** only after running that test.

## Done & verified
- WP2/WP3 on stock CEF (cutover agent): ghost window per app window, uBlock Origin Lite as the content blocker,
  Chrome password/autofill/zoom/site-settings/PiP backends, extension emulation removed, packages/webkit removed.
- Integration, on stock CEF (instance `integration`, 2026-09-25):
  - `pnpm tsc` for packages/cef and apps/browser passes; the app builds (`build-integration`).
  - Every `packages/cef/ios/*.mm` passes a syntax check with `NN_CHROME_TABS=1` against the patched headers
    (scratchpad `checkpatched.sh`: vendor headers + the tree's changed `include/` files; `cef_media_capture.h`
    stubbed because the tree copy was mid-edit).
  - Moving a tab to another window keeps its page: `window.__marker` and `performance.timeOrigin` survive,
    `visibilityState` is "visible" in the new window, and closing the tab afterwards still closes its browser.
    This works on Alloy tabs too (lib/chromeTabs.ts + NNBrowserView `transferKey`).
  - Dia-style downloads popover ("RECENT DOWNLOADS", Clear, "View all downloads", "Failed to Download") and the
    password save / update prompts render correctly (screenshots in scratchpad `int-downloads.png`, `int-pw3c.png`).
  - `executeExtensionAction` returns null and `resolvePasswordPrompt` does nothing on stock CEF, so the old
    behaviour stays.
- Integration, on the patched CEF 154.0.28 with `NN_CHROME_TABS 1` (instance `integration`, 2026-09-25). Results
  per ledger item below (numbers as in the Test ledger):
  - **1 Hosting.** Our tabs are Chrome tabs of each window's ghost Browser, and there's no placeholder tab.
    `pageInsets` follow the page rect (47,190,7,7).
  - **2 Extensions see our tabs.** One normal Chrome window per app window, and tabs in sidebar order. Hidden WebUI
    hosts aren't listed (`hidden_from_extensions`).
  - **4 Active tab.** Both directions, including tabs created in the background (`ActivateTab` is deferred until the
    tab is in the strip).
  - **5 Tab-strip sync.** `tabs.update({active})` and `{pinned}` come back to the sidebar.
  - **6 Chrome-made tabs.** `tabs.create` → adopted tab.
  - **7 Popups.**
    - `window.open` and `target=_blank` → adopted tab with `opener`.
    - Sized popups show in our popup window, sized correctly. Chrome resizes hosted views to its window, so
      NNBrowserView now enforces the page frame. The popup gets its own ghost ("normal" window to extensions).
  - **8 Closing.** `window.close()` and `tabs.remove` close the tab in the app.
  - **9 Founder tab.** Closing a window's first tab keeps the others alive.
  - **10 Moving.** To new and existing windows, including a window's last tab. The page survives (`__marker`) and
    `chrome.tabs` shows the new window.
  - **13 Active window / commands.**
    - With window B active, `windows.getLastFocused()` = B.
    - An extension command (⇧⌘Y) forwarded to B's ghost ran with B's tab.
  - **14 Stray windows.** `windows.create` → our tab, no visible window.
  - **16 uBOL.** Component extension: an ad script is blocked in the default profile and in an incognito window.
  - **17/18 Passwords.**
    - Our save prompt comes from Chrome's bubble hook (`CEF_NN_PASSWORD_BUBBLE`) with no Chrome bubble. Save
      stores it, and Chrome autofills it on the next visit.
    - A changed password → "Update saved password?" → update. The ungoogled defaults that disabled saving and
      autofill were reverted in the dist.
  - **22 Extension action.** `onClicked` + activeTab + `scripting.executeScript` ran on the page.
  - **23 Permissions.** Notifications and geolocation go to our prompt with no Chrome bubble; Don't Allow → "denied".
  - **24 Blocked pop-ups.** Our notice (Dia copy; now 360pt wide so its buttons fit on one row). Only Once opens a
    tab with `opener`.
  - **25 Downloads.** Our popover. Chrome's "Recent Download History" bubble appeared at first and is now off
    (`download_bubble.partial_view_enabled` = false per profile).
  - **26 Tab dialogs.** Tested `alert()` and HTTP basic auth: Chrome's dialog is centred on the page area (x centre
    847 = page centre). Chrome only shows JS dialogs for the last active Browser: test instances need
    `nnChromeTabs.devWindowAction(n, "active:1")`.
  - **Screen sharing.**
    - The page-script `getDisplayMedia` override now installs in every tab. `OnContextCreated` also fired for
      extensions' isolated worlds, whose script instance took over `receive`, so it now runs in the main world only.
    - The SharePicker has a Tabs section. Sharing a tab gives "Tab" video + "Tab Audio". Chrome asks for the
      *captured* tab's permission, so the picker grant is honoured for it.
  - **3 Tab ids.** A badge set for one tab (`setBadgeText({tabId})`) shows only on that tab.
  - **11 Profiles.** A tab moved to another profile leaves the default profile's `chrome.tabs` and joins the new
    profile's ghost in the same window.
    - uBOL blocks in the second profile too.
    - In a profile created at runtime, pages loaded in its first ~3 s aren't blocked: its extension system finishes
      setting up after our first load, so we load again 3 s later.
  - **12 Discard.** Superseded by R1 below: a sleeping tab stays in `chrome.tabs` as `discarded: true`.
  - **Split view.** Both panes are Chrome tabs at their own sizes (578 pt each) and both visible. Chrome's dialogs
    follow the focused pane (`pageInsets` 47,775,7,7).
  - **After the switch to the real keychain** ("Netnyahoo Safe Storage" dist), a fresh-profile regression passed:
    items 1/2, 7, 10, 16, 17 (save) and 19 (a saved login auto-fills on revisit).
  - **Focus.** Test instances can't activate (see NNActivation.mm: prohibited policy, activation guards, log).
    `lsappinfo front` never changed over several launches, popups, dialogs and new windows.
- Signing and passkeys (instance `passkeys`, patched CEF 154.0.28, 2026-09-25):
  - Debug is team-signed (Apple Development, automatic provisioning, team U5L5T3NGVV) with the hardened runtime.
    The plain build command works for every agent: this Mac is registered and a "Mac Team Provisioning Profile: *"
    is cached. The CEF framework, all five helpers (Chrome's per-helper entitlements) and the Dock tile use the
    same team. `codesign --verify --deep --strict` passes, and the app, renderers, GPU and utility processes run.
  - Release: `xcodebuild archive` + `-exportArchive -exportOptionsPlist macos/ExportOptions-DeveloperID.plist
    -allowProvisioningUpdates` gives a Developer ID app: every piece re-signed, timestamped, with the hardened
    runtime and entitlements kept, plus an embedded "Mac Team Direct Provisioning Profile: com.netnyahoo.browser".
    It launches. `spctl` says "Unnotarized Developer ID": notarization is still to do.
  - Security keys: `navigator.credentials.create` with `hints:["security-key"]` opens Chrome's "Use your security
    key with webauthn.io" dialog (448×328) centred over the page area. USB HID enumeration runs under the hardened
    runtime. Content not visually checked: the window was occluded, so Chromium didn't paint it.
  - Phone (hybrid): after the one-time Bluetooth permission (the user allowed it), `create` with `hints:["hybrid"]`
    opens Chrome's "Passkeys" sheet over the page (448×492): "Use your phone or tablet", "Scan this QR code with the
    camera on the device where you want to create and save your passkey for webauthn.io", a QR code, Back and
    Cancel (read through the accessibility tree). Scanning it with a phone is test 39.
  - Touch ID was unavailable on that CEF: "keychain-access-group entitlement is missing or incorrect.
    Expected value: .org.chromium.Chromium.webauthn". The BRANDING change has since shipped in the vendored
    framework (test 40).
- Passkey dialogs were invisible (bug in 0.1.1, fixed 2026-09-25, Debug `build-pkfix` and a Developer ID archive +
  export of the fix, data dirs `/tmp/nn-pkfix`, `/tmp/nn-pkrel`; captures in the session scratchpad `passkey-fix/`):
  - Symptom: Google's "Verifying it's you… Complete sign-in using your passkey" stayed stuck with no UI.
  - Cause: Chrome shows web-modal dialogs (all of WebAuthn's sheets, security key PINs…) as level-0 child windows
    of the Browser window, and AppKit keeps a window's children right above it. Our ghost Browser window sits below
    the app window, so the dialog was created, sized and centred over the page, then drawn behind our window. The
    earlier checks read its frame and accessibility tree only. Chrome's popups (autofill dropdowns, level 999)
    weren't affected.
  - Fix (`NNWindowHost.mm`): the ghost watches its child windows (Chromium's `childWindowAddedHandler`, KVO on
    `visible`) and moves in front of the app window while one shows, back behind when none does. It stays
    transparent and click-through: macOS and Chromium's occlusion checker both ignore it, so the page stays VISIBLE
    (WebAuthn needs that to complete), and focus never moves. `ghostWindows()` reports `lifted` / `chromeWindows`.
  - Verified in the Developer ID build (hardened runtime, keychain groups, no iCloud entitlement), windows composited
    with ScreenCaptureKit: a Google-like `get()` (allowCredentials of a passkey the Mac doesn't have) shows
    "Passkeys: use your phone or tablet" with its QR code over the page; a discoverable `get()` shows "Passkeys &
    Security Keys"; Cancel rejects both with `NotAllowedError`. webauthn.io Platform: "Create a passkey for
    webauthn.io" (Chrome profile), Continue → created ("Chromium Browser" AAGUID), Authenticate → logged in. With
    user verification required, macOS's Touch ID sheet ("Netnyahoo is trying to verify your identity on
    webauthn.io") appears over the window, and the user completed register and sign-in with it. Picking a passkey:
    "Use a saved passkey for webauthn.io" lists the profile's passkeys plus "Use a phone, tablet, or security key".
    Cross-platform register: the QR sheet with Back / Cancel. A CDP virtual authenticator completes webauthn.io's
    register + login end to end. Switching tabs hides the dialog with its tab and lowers the ghost; switching back
    shows it again.
  - Testing note: a DevTools session that detaches (every one-shot `Runtime.evaluate` script) disables the page's
    virtual authenticator environment for everyone, so a virtual-authenticator flow must run in one session
    (scratchpad `passkey-fix/virtflow.mjs`). Test instances behind other apps are occluded and WebAuthn then fails
    with "the page does not have focus": launch them with
    `NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows`.
- Menu commands crashed the app (bug in 0.1.0 and 0.1.1, fixed 2026-09-25, Release `build-keycrash`, data dir
  `/tmp/nn-keycrash`):
  - Symptom: ⌘T, ⌘W (and every other command item: its shortcut or a click in the menu bar) quit with
    "unrecognized selector sent to instance", from a New Tab page (AppKit's `routeKeyEquivalent` → main menu) and
    from a web page (`RenderWidgetHostViewCocoa` → CEF `OnPreKeyEvent` → `[NSApp.mainMenu performKeyEquivalent:]`).
  - Cause (`packages/shell/ios/Menus.swift`): `CommandItem`'s action was `#selector(MenuTarget.perform(_:))`, and
    Swift resolves that to NSObject's `perform(_:)`, i.e. `performSelector:`. `MenuTarget` answers it, so AppKit
    called `[MenuTarget performSelector:<the menu item>]` and the runtime threw on the item's address used as a
    selector. The items read `action: performSelector:` in lldb.
  - Fix: the action is `performCommand:`.
  - Verified in the Release build (same symptoms reproduced first: the unfixed build crashed on the first ⌘T),
    shortcuts posted to the background instance with `CGEventPostToPid`, tabs checked in `session.json`: ⌘T ×3 from
    a New Tab page and from a web page, ⌘W on a New Tab page, a web page and a pinned tab, ⌘W on a window's last tab
    ("Close 1 tab?" prompt), ⇧⌘T (reopens the closed page), ⌘1 / ⌘9, ⇧⌘[ / ⇧⌘], ⌃Tab, ⌘N, ⇧⌘N, ⌥⌘T, ⌘L, ⌘R,
    ⇧⌘R, ⌘F, ⌘G, ⌘[ / ⌘], ⌘= / ⌘- / ⌘0, ⇧⌘B, ⇧⌘A, ⌘S, ⇧⌘C, ⌥⌘U, ⇧⌘J, ⌘Y, ⌘D, ⌃⇧], ⌘, — no crash. The CEF
    path, driven in lldb (`-[RenderWidgetHostViewCocoa keyEvent:wasKeyEquivalent:]` with ⌘T on example.com),
    reaches `MenuTarget.performCommand` through `nn::Client::OnPreKeyEvent` → `-[NSMenu performKeyEquivalent:]`
    and opens the tab.
- The app bundle stays sealed (2026-09-25, Release archive + Developer ID export, data dirs `/tmp/nn-sigfix-*`):
  - Bug in 0.1.0: its first launch wrote `Resources/Extensions/ublock-lite/_metadata/generated_indexed_rulesets/
    _ruleset1…6` into the bundle (DNR indexes uBlock's rulesets next to the extension), so `codesign --verify --deep
    --strict` failed. From a read-only copy of 0.1.0, nothing was blocked. Nothing else wrote into the bundle
    (settings, extensions, uBlock's pages, a PDF, the offline page, New Tab, chrome://components, YouTube).
  - Fix: Chrome loads uBlock from `<data dir>/Built-in Extensions/ublock-lite`, a clone of the bundled folder
    (`docs/cef-source-build.md` › "Nothing writes into the app bundle").
  - Verified: over CDP, a fetch of `pagead2.googlesyndication.com/…/adsbygoogle.js` fails with
    `net::ERR_BLOCKED_BY_CLIENT` while `www.iana.org/favicon.ico` loads, and the signature still verifies after
    quitting, in each case: a fresh data dir; a relaunch (copy and indexes untouched); a 0.1.0 data dir; the bundle
    `chmod -R a-w`; the app on a read-only disk image (a plain copy, not a clone); a stale copy (copied again, stray
    staging folder removed). `scripts/release.sh` now runs the launch-and-verify check itself.

- R1, tab state on Chrome (instance `r1`, CEF 154.0.28 + `cef-tab-state.patch`, 2026-09-25). Driven through
  devHarness and CDP, with a fixture extension (`contextMenus`, `tabs`, `history`, `scripting`):
  - **Duplicate** (`clone:<tab id>` → `CefBrowserHost::DuplicateTab`, Chrome's `WebContents::Clone`): the copy has
    the same 3-entry back/forward list, current entry and `canGoBack`, and the source's `sessionStorage`; also from
    a sleeping tab.
  - **Reopen Closed Tab** (the closing tab's `GetNavigationState`, then `RestoreTabInBrowser` →
    `chrome::AddRestoredTab`, `restore:<tab id>`): the reopened tab has the whole list with the current entry in
    the middle (a → **b** → c after going back), also for a tab closed while asleep. After a relaunch it reopens
    from its URL (the lists are kept for the session only, like open tabs').
  - **Sleeping** (`DiscardTab`, `--enable-features=WebContentsDiscard`): `chrome.tabs` keeps the same tab id with
    `discarded: true, status: "unloaded"`, no crash event; showing it reloads it with its list
    (`document.wasDiscarded`, `history.length` 3) and the app's sleeping state clears (`ready` again).
    `chrome.tabs.discard` from the extension puts the app's tab to sleep, `chrome.tabs.reload` wakes it. An
    unused profile's tabs close instead (`discard({unload})`), asleep ones too. Chrome's own urgent discard goes
    through the same `TabLifecycleUnit` path and observer; it wasn't forced here (it needs real memory pressure).
  - **Clear Browsing Data** (`CefRequestContext::ClearBrowsingData`, Chrome's BrowsingDataRemover): a range that
    starts in the future clears nothing; "last hour" empties Chrome's history (`chrome.history.search` 4 → 0),
    the page's `localStorage` and cookies, and resolves (60 ms–1.2 s). No `.clear-site-data` marker any more.
  - **Page menu** (NETNYAHOO_CONTEXT_MENU_LOG dumps the model and runs a picked item instead of showing the menu):
    on a link, one "Open Link in New Tab" / "New Window" / "Split View" / "Incognito Window", Save Link As, Copy
    Link Address; on a selection, Look Up, Copy, Copy Link to Highlight, "Search <engine> for “…”" (relabelled when
    the engine name changes); Print, the extension's item, Inspect, Speech. Picked: the extension item ran its
    `onClicked` (it retitled the page), Open Link in New Tab opened a background tab with its opener, Open Link in
    Split View made a split, Search ran our search. Not seen: the NSMenu itself on screen (checklist step 9d).
  - **NNSwipe**: after a synthetic swipe the page view's delegate is ours in front of
    `ChromeRenderWidgetHostViewMacDelegate`; Check Spelling, Spelling panel, Check Spelling While Typing, Grammar
    and Start Speaking validate enabled (Stop Speaking off while nothing speaks); a back swipe goes back exactly
    one entry (Chrome's own history swiper doesn't also navigate).
  - Found and fixed on the way: switching from a tab into a split made the two panes activate each other in
    Chrome forever (Chrome focuses the tab it activates, which reported as the user focusing it, 200 % CPU).
    Chrome's active tab is now the last pane shown, until the user clicks one.

- R2, Chrome surfaces (instance `r2`, CEF 154.0.28 + `cef-ui-surfaces.patch`, `chromium-chrome-ui-hooks.patch`,
  `chromium-extension-updates.patch`, 2026-09-25). Driven through devHarness and CDP; the screen was locked, so
  nothing below was seen on screen (layout checked through the page's `innerHeight`):
  - **Toolbar action state** (`CefGetExtensionActionState`): a fixture extension's `action.setIcon` (imageData)
    comes back as a 32×32 PNG (the 2x image for the 16 pt button), with its badge "R2" and colour `#1a73e8`.
  - **Side panel** (`CefChromeUIHandler::OnExtensionSidePanel`, `CefGetExtensionSidePanel`): the toolbar click
    (`openPanelOnActionClick` → `ExecuteExtensionAction` "sidePanel") opens the panel card (page 360 pt wide);
    `chrome.sidePanel.open({tabId})` opens it, `close()` closes it, a per-tab `setOptions({path})` switches its page.
    `chrome.tabs.query({active:true,currentWindow:true})` from the panel returned `[]` before and returns the page
    after the `chrome_extension_function_details.cc` hunk (hidden windows use the last active window).
  - **"Share this tab instead"** (`CefChangeMediaCaptureSource`): a page sharing tab B (tab video + tab audio)
    switched to tab A; `CefGetMediaCaptureTarget` moved from B to A, both tracks stayed `live`, and the page kept
    reporting `screen` (the registrar no longer blinks "capture ended" while the source changes). The info bar takes
    38 pt above the page (`innerHeight` 806 → 768) and goes when sharing ends. **Stop Sharing**
    (`CefStopMediaCapture`): both tracks `ended`, `onended` fired, the bar went away.
  - **Device chooser** (`OnDeviceChooser`): `navigator.bluetooth.requestDevice({acceptAllDevices:true})` shows our
    chooser with Chrome's model: "example.com wants to pair", Pair / Cancel, "Scanning…", and 14 of the Mac's real
    Bluetooth devices; Cancel rejects the page's promise ("User cancelled the requestDevice() chooser").
    `navigator.usb.requestDevice` shows "example.com wants to connect" / Connect ("No compatible devices found.").
    Selecting a device wasn't tried (nothing to pair with safely).
  - **Cast** (`OnCastDialog`, `CefShowCastDialog`): our request and a page's `PresentationRequest.start()` ("Cast
    example.com") both reach our picker; closing it rejects the page's request ("No screens found").
    `chrome://media-router-internals`: mDNS and DIAL discovery started; no sinks on this network (`dns-sd -B
    _googlecast._tcp` finds none either), so casting itself is checklist step 12. Info.plist gained
    `NSLocalNetworkUsageDescription`.
  - **Web Store**: with a store tab restored at launch, its own Add button went through Chrome's flow and our dialog
    (Dark Reader 4.9.133, FROM_STORE). The old JS-reload loss of a pending prompt (the install then waits forever)
    is fixed: pending prompts are asked again when JS listens.
  - **Auto-update (W3), verified**: see W3.
  - **Content blocker**: `getContentBlocker` lists 55 rulesets in all six categories (ads 5, trackers 3, cookie
    banners 1, annoyances 6, malware 2, regional 38) with filter counts, and version 2026.920.1710.
  - **Tabs between windows**: the drop logic is unit-tested (`layout/windowDrop.test.mjs`); a real mouse drag across
    windows is checklist step 11 in `docs/dia-feature-parity.md`.

- Polish pass (instance `polish`, CEF 154.0.28 + `cef-ui-triggers.patch`, 2026-09-25). Driven through devHarness,
  CDP and the app's DEV AppleScript runner; the screen was locked, so nothing was seen on screen:
  - **Extension search engines.** Two unpacked fixture extensions with `chrome_settings_overrides.search_provider`
    (one `is_default: true`). Chrome's settings list (`getSearchEnginesList` in the hidden chrome://settings,
    `NNExtensions searchEngineList`) reports both with their extension; the app keeps them in
    `settings.extensionSearchEngines`. A typed search went to the default-claiming extension's URL
    (`duckduckgo.com/?q=…&t=nnfixture`); Settings › Search Engine showed "Search Fixture Default is controlling this
    setting" (Manage / Disable), the built-ins' Make Default disabled, and an "Extensions" section with both engines
    (checked in a window snapshot); the other extension's keyword (`wfix`) set Tab-to-search's scope; disabling the
    extension brought the user's own default back (Google), enabling it made it control again.
  - **Edit › AutoFill** (`CefShowAutofillSuggestions`). With a form field focused (CDP `focus()`), the call returns
    true and Chrome's dropdown window opens under the field (a 174×108 level-999 window for a saved address,
    148×54 for Passwords…); with the page blurred it returns false and the menu command opened Settings.
  - **PiP extras** (`NNPictureInPicture.mm`). `NETNYAHOO_PIP_SELFTEST=1` on a canvas-stream video in Chrome's PiP
    window: pill on hover with the host, stash past the right edge (28 pt peek, handle), re-stash after a Chrome
    move, handle click back on screen, stash on the left edge, drag out, Keep Window on Top toggling the level,
    Back to Tab (the app switched back to the tab from another one, PiP closed, the video still playing). All 10
    steps pass; layer snapshots show the pill, its hover state and both handles. A real pointer drag is parity
    checklist step 13.
  - **Raycast** (`extras/raycast-netnyahoo`). The extension's list, focus and close scripts (with `tell current
    application` in place of the bundle id) ran in the app: the list returned every tab with window id, title, URL,
    pinned and selected state; focus selected the tab; close removed it; an unknown tab id fails with AppleScript's
    -1728. Its `npm test` checks the parser against that output. Installing it in Raycast is checklist step 14.
- Offline page, "Where's Big Yahu?" (`chromium-neterror-yahu.patch`, 2026-09-25; Debug build `build-yahu`, CDP):
  - Before the patch, an offline load showed Chrome's dino page, in a Chrome-style tab and in an Alloy-style
    standalone view (an extension popup) alike: the renderer is Chrome's for both, so no Alloy fallback is needed.
  - With CDP `Network.emulateNetworkConditions({offline: true})` (and the cache disabled), `https://example.com/`
    in a tab shows the game: `YAHU_ERROR` `{code: "ERR_INTERNET_DISCONNECTED", url: "https://example.com/"}`, header
    "ERR_INTERNET_DISCONNECTED · example.com", title "example.com · No internet", 63 images from `data:` URLs, no
    other request, no console message. Start plays level 1; Retry while offline shows the game again; Retry after
    going back online loads Example Domain. The same in an extension-popup view (Alloy).
  - `ERR_NAME_NOT_RESOLVED` (`.invalid` host) and `ERR_CONNECTION_REFUSED` (127.0.0.1:59999) keep Chrome's page.
  - `netnyahoo://yahu` typed through the store: the tab reads `netnyahoo://yahu/` "Where's Big Yahu?", the engine
    loads `chrome://yahu/`, and the game runs standalone (no offline header); `chrome://dino` too. Play (clicks,
    hint key) makes no request. A best of 4200 stored through `updateEasterEggHighScore` came back after a reload.
  - The DNS-probe path's document swap (`document.open/write` of the resource, as `UpdateErrorPage` does) run by
    hand on an `ERR_NAME_NOT_RESOLVED` page: the hashed scripts run, `errorPageController` survives, no request.
    The probe itself ending in "no internet" is ledger 43.

- Profile paging (layout/profilePager, 2026-09-25, instance `/tmp/nn-pager`, three profiles plum/blue/green with
  different tabs; synthetic events through `nnSwipe.sidebar(w)` / `nnSwipe.strip(w)` `devSimulate`, frames from
  ScreenCaptureKit in scratchpad `profile-swipe/`):
  - Sidebar swipe held at 25 / 50 / 75 % (position 0.25 / 0.50 / 0.76 = half the scroll distance over the 190 pt
    page): the next profile's page (its own selected row, favicons, New Tab row) slides in clipped to the sidebar,
    the window tint cross-fades plum (56,44,44) → blue (47,50,54) in steps, the dots brighten continuously. A flick
    commits from 18 % (velocity 349 pt/s); a slow release under half returns; the window's profile switches when
    the page lands. Dark and light.
  - Dot click, Next Profile, ⌃1 (a jump over a profile: the target is placed beside the current page) slide the same
    way (0 → −1 page in 0.25–0.3 s, then the switch).
  - Top tab strip: the same swipe pages the chips (page 1144 pt wide, clipped before the profile pill).
  - Devices: phased swipes (trackpad / Magic Mouse) track with System Settings › Swipe between pages **off** (this
    Mac has it off; before, the tracker ignored every swipe here); a wheel mouse's two notches page once, one notch
    doesn't, five in a burst page once, vertical wheel scrolls the list, Shift+wheel pages.

## Still to run
Everything that needs the user present; `docs/dia-feature-parity.md` › "Needs the user present" has the script.
- 15: fullscreen changes Spaces.
- 19–21: autofill dropdowns need a key window.
- 27: Touch ID.
- W2: the Remove sheets need a key window.
- R2: dragging tabs between windows, and Cast with a real device (parity checklist steps 11–12).
- 28–31: visual QA against Dia 1.50.1 (needs the unlocked screen).
- 39, 41: phone passkeys, Safe Storage; 40's Google sign-in in the shipped app (checklist step 6).
- Polish: the PiP extras with a real pointer, and the Raycast extension installed in Raycast (parity checklist
  steps 13–14).
- 43: the offline game after a DNS probe (needs a network with no route to the internet).
- 44: profile paging with a real trackpad, Magic Mouse and wheel mouse.
- Chrome-hosted windows: the checks for a person at an unlocked screen (ledger below, items 1–12).

## Test ledger

**Setup.** `packages/cef/scripts/setup.sh` puts our CEF build in `vendor/cef`, and `NN_CHROME_TABS` defaults to 1: hooks
switch on from `include/cef_netnyahoo.h`, and the build fails with `#error` against stock CEF. Build with your
derived-data folder, and launch with `NETNYAHOO_BACKGROUND=1 NETNYAHOO_DATA_DIR=/tmp/nn-<you>
NETNYAHOO_REMOTE_DEBUGGING_PORT=<port>`.

**Tools.**
- Drive the store with scratchpad `nneval.sh '<js>'` (devHarness `nn`).
- Pages: `cdp-integration.mjs`.
- Ghosts: `ghostWindows()` (from JS, or `NNCef.ghostWindows`: `anchorBrowserId`, `anyTabBrowserId`, `ready`,
  `pageInsets`).
- Test extension: an unpacked fixture that exposes `chrome.tabs` / `chrome.windows` results from its service worker
  (CDP target).

### Tabs (NNWindowHost, NNBrowserView, lib/chromeTabs.ts)

1. **Hosting.** Open 2 tabs. Pass if all of these hold:
   - CDP lists both pages and no `about:blank` ghost placeholder.
   - `ghostWindows()` shows one ghost per window with `anchorBrowserId: 0`.
   - Each page is visible, and rAF runs at 120 fps under `RenderWidgetHostViewCocoa`.
2. **Extensions see our tabs.** Run `chrome.tabs.query({})` and `chrome.windows.getAll({populate:true})` in the
   fixture. Pass if there is one Chrome window per app window and profile, its bounds equal the app window frame,
   and the tab list and URLs equal the sidebar's (pinned first, sidebar order).
3. **Tab ids.** The fixture sets `chrome.action.setBadgeText({tabId, text:"7"})` for one tab. Pass if the toolbar
   badge shows only on that tab (NNExtensions `TabIdOf` via `GetTabId`).
4. **Active tab.**
   - Switch tabs in the sidebar. `chrome.tabs.query({active:true,currentWindow:true})` must return the shown tab.
   - In split view, clicking into a pane must make it the active tab.
5. **Tab-strip sync (`CEF_NN_TAB_STRIP`).**
   - `chrome.tabs.update(id,{active:true})` must switch the app to that tab.
   - `{pinned:true}` must pin it in the sidebar.
   - Dragging a tab in the sidebar must show the new order in `chrome.tabs.query`.
   - Pass only if there are no event loops: dev-console stays clean and CPU is idle after 30 rapid switches.
6. **Chrome-made tabs.** `chrome.tabs.create({url})` must add a tab to the app window that loads, and closing it in
   the app must remove it from `chrome.tabs`.
7. **Popups (`CEF_NN_POPUP_TABS`).**
   - A `target=_blank` link or `window.open(url)` must open an adopted tab whose `window.opener` is set.
   - `window.open(url,'x','width=500,height=600')` must open our popup window.
   - In both cases no new on-screen window of our PID may appear other than ours (`winpid <pid>`).
   - If a Chrome window appears, OnBeforePopup's `ConfigurePopup` path is wrong.
8. **Closing.**
   - `window.close()` in a page must close its tab in the app (OnBeforeClose → windowClose).
   - `chrome.tabs.remove(id)` must do the same.
   - Closing a window's last tab must close its ghost; the next new tab must found a new ghost.
9. **Closing the founder tab.** This is the riskiest item. Open 3 tabs and close the FIRST one: the CefBrowserView's
   own tab. Pass if the other two stay loaded and hosted, and `chrome.tabs` lists 2.
   - If they close too, `Ghost::Start()` must keep a placeholder anchor again. Call `Start()` without a founder in
     `CreateTab` and drop `DropAnchor()`, then fix how extensions see that anchor.
10. **Moving to another window.**
    - Move to Window (new and existing), and drag a tab onto another window. `__marker` must survive, and
      `chrome.tabs.get(id).windowId` must become the target's Chrome window (`MoveToBrowser`).
    - A target window that had no tabs of that profile must end with one ghost and no `about:blank` placeholder
      left.
11. **Moving to another profile.** The page reloads in the new profile (expected). The tab must leave profile A's
    `chrome.tabs` and appear in B's.
12. **Discard / freeze.** A tab slept by lib/tabLifecycle must stay in `chrome.tabs` as `discarded: true` with the
    same id and history, and reload when shown. A frozen tab must thaw when shown.
13. **Active window.** With 2 app windows, focus window B. `chrome.windows.getLastFocused()` must return B's Chrome
    window, and an extension `chrome.commands` shortcut must run for B.
14. **Stray windows.** `chrome.windows.create({url})` from the fixture must open the page as our tab, with no
    visible Chrome window.
15. **Fullscreen (`CEF_NN_TAB_FULLSCREEN`).** `requestFullscreen()` on a video page must put our window into
    fullscreen while the ghost stays unfullscreened and aligned (`ghostWindows`). Esc must exit.

### Content blocker (NNContentBlocker, NNChromePages)

16. **uBlock Origin Lite as a component extension.** Pass if all of these hold:
    - Ads are blocked on a test page in the default profile, in a second profile, and in an incognito window. Only
      incognito was a regression before.
    - Settings › Content blocker lists the rulesets.
    - "Disable on this site" works.
    - The log has no `[blocker] component load failed`.
    - chrome://extensions has no removable uBOL entry.

### Chrome's password manager and autofill

17. **Save prompt.** Serve a fixture login page (http://127.0.0.1) and submit it. Pass if all of these hold:
    - Our "Save password for 127.0.0.1?" shows, with the username and masked password.
    - Chrome's bubble does not show: no extra window.
    - Save → Settings › Passwords lists it.
    - "Never on This Site" → the site appears under "Never saved".
    - "Not Now" leaves nothing saved.
18. **Update prompt.** With 2 logins saved, submit a new password. Pass if "Update saved password?" shows with the
    username picker, and Update changes the chosen login.
19. **Filling.** Reload and focus the username field. Pass if Chrome's dropdown sits right under the field, picking
    a login fills both fields, and a new-password field offers Chrome's generated password.
20. **Other password states.** Auto sign-in and the generated-password confirmation still use Chrome's bubble. It
    must appear over the page (ghost layout), not at the window corner.
21. **Addresses and cards.** Submit an address form. Pass if Chrome's save-address bubble shows over the page and
    the dropdown fills a saved address.

### Chrome UI surfaces (WP4)

22. **Extension action (`CEF_NN_EXTENSION_ACTION`).**
    - An action with no popup that uses `action.onClicked` + activeTab + `scripting.executeScript`: clicking its
      toolbar button must run the script.
    - An action with a popup: our popup must show, `chrome.tabs.query({active:true,currentWindow:true})` from the
      popup must return the page, and the popup must not appear in `chrome.tabs.query({})` (`standalone`).
    - A side-panel extension must open its page in the side panel (verified by r2).
    - The overflow menu must show the extensions, then Pin / Manage / Add Extension….
23. **Permission prompt.** Try getUserMedia, geolocation and `Notification.requestPermission()`. Pass if our prompt
    shows ("Allow … to access your camera?", "Click the lock to change this any time"), with no Chrome bubble
    window, and Allow / Don't Allow stick for the site.
24. **Blocked pop-ups.** `window.open` without a gesture must show "Always allow pop-ups from …?". Only Once must
    open it as a tab (with `window.opener`), and Always Allow must stop further prompts.
25. **Downloads.** Download a file. Pass if the magnet animation and our popover show, and there is no Chrome
    download bubble window.
26. **Tab-modal dialogs over the page.** Try `alert()`, HTTP basic auth (a local server), and a `beforeunload`
    prompt. Chrome's dialog must be centered over the page area, not over the sidebar; in split view, over the
    focused pane. `ghostWindows().pageInsets` must match the page rect.

### Settings

27. **Passwords pane: one prompt.** Needs the user present, because it raises the system auth dialog. It works on
    the stock build too.
    - Settings › Passwords › Unlock must raise exactly one Touch ID prompt, from Chrome's check.
    - Opening a login and revealing its password within 5 minutes must not prompt again.
    - Another profile unlocks on its own.
    - The copy reads "Offer to save and fill passwords" and "Saved on this Mac, separately for each profile…".

### Import (packages/import)

I1. **Browsers.** The importer now covers Chrome (+ Beta/Dev/Canary/Chromium), Brave, Edge, Opera,
    Opera GX, Vivaldi, Island, Arc, Firefox, **Dia** and **Helium**, plus Safari (direct and via the
    export `.zip`). Dia and Helium are ordinary Chromium sources: Dia's data lives under `Dia/User Data`
    with plaintext `Bookmarks`/`History`/SNSS `Sessions` and secrets under Keychain "Dia Safe Storage" /
    "Dia"; Helium (imput's ungoogled-chromium) under `net.imput.helium`, Keychain "Helium Storage Key" /
    "Helium" (confirmed from the binary's `saltysaltHelium Storage Key` string and the Keychain item's
    attributes). Both add only a `BrowserDefinition`; discovery/parse/unlock are unchanged.
I2. **Safari direct.** `SafariDirect` reads `~/Library/Safari` when Netnyahoo has Full Disk Access:
    `Bookmarks.plist` (bookmarks + Reading List), `History.db` (`history_items`⋈`history_visits`,
    CFAbsoluteTime), and `LastSession.plist` (open tabs). `hasAccess()` probes without a prompt; the
    import UI shows a "Give Netnyahoo Full Disk Access" step that opens System Settings
    (`x-apple.systempreferences:…Privacy_AllFiles`) and re-checks on app re-activation. The export
    `.zip` remains the fallback and the only path for Safari passwords/cards.
I3. **Dia sidebar.** Not imported. Dia keeps its spaces / pinned tiles / folders / custom names in a
    SQLCipher-encrypted `tabs.db` (GRDB; schema recovered — tables `nodes`, `tabs`, `tab_groups`,
    `spaces`, `windows`, `content_panes`, `favorites`, `pinned_container`, `live_folders`; columns
    `space_id`, `custom_title`, `custom_icon`, `title_source`, `icon_source`, colour names
    green/purple/…). Its key is derived by CryptoKit HKDF-SHA256, and verifying a decryptor would mean
    reading real browsing data (forbidden by the task's data rules), so it's left out. Dia's open tabs
    still import from its plaintext SNSS `Sessions/`.
I4. **Chrome and Brave need Full Disk Access.** On this macOS both protect their data folders from
    other apps: inside Netnyahoo, listing `Google/Chrome` or `BraveSoftware/Brave-Browser` fails with a
    permission error, while Arc, Dia and Helium read fine. Discovery used to drop them silently; it now
    lists a browser whose folder exists but can't be listed (and has a `Local State`/`Default` marker,
    which can still be stat'ed) with `needsFullDiskAccess`, and the import window routes it to the same
    Full Disk Access step as Safari, re-listing when the app becomes active again.
I5. **Tests.** `swift test` (51 cases, incl. Helium/Dia import, Safari-direct and the protected-folder
    discovery) and `node --test src/index.test.ts` (6) pass; fixtures for Helium, Dia (two profiles,
    SNSS session) and Safari-direct (`Bookmarks.plist`/`History.db`/`LastSession.plist`) come from
    `fixtures/generate.py`. `pnpm -C apps/browser typecheck` passes.
I6. **Real installs, verified 2026-09-25** (background instance, throwaway `NETNYAHOO_DATA_DIR`, counts only):
    discovery lists exactly Chrome (data only: the app isn't installed, so it gets the globe icon; needs
    FDA), Arc (1 profile, 2 spaces), Dia (2 profiles), Safari (no FDA → Full Disk Access step / .zip),
    Brave (needs FDA) and Helium (1 profile). A real Helium import into the throwaway profile read 8
    bookmarks and 11,877 history rows; the store then held 8 bookmarks and 5,000 history entries (the
    history store's `MAX_ENTRIES` cap; the done screen now reports what was kept). Dia's Default profile
    read 7 bookmarks and 1 open tab from its plaintext session, with no failures. Import-window snapshots
    (choose, per-browser kinds, Dia profile picker, Brave/Safari Full Disk Access, Arc spaces) were taken
    with `devSnapshotWindow`.
    - Not verified: real password/cookie decryption (needs the user to approve the Keychain prompt for
      "Helium Storage Key" / "Dia Safe Storage"); Safari direct and Chrome/Brave against real data
      (need Full Disk Access granted by the user).

### Chrome Web Store (integration; hook 10 `CEF_NN_INSTALL_PROMPT`)

W1. **Install from the store. Verified 2026-09-25.**
    - The store's own button runs Chrome's webstorePrivate / WebstoreInstaller flow.
    - Chrome's confirmation goes to our Dia-style dialog through `OnExtensionInstallPrompt`, with Chrome's own
      warning list.
    - Tested with Bitwarden 2026.8.0 (3 warnings) and Dark Reader 4.9.133: each installed as a store extension,
      location FROM_STORE, update_url `https://clients2.google.com/service/update2/crx`, and the page then shows
      "Remove from Netnyahoo".
    - The store opens the extension's welcome tab, and it's adopted as our tab.
    - A Web Store link in Settings now opens the store page: there's no unpacked fallback any more when the engine
      has the hook.
    - Still open:
      - A "Switch to Chrome" banner stays on the store. Adding "Google Chrome" to `navigator.userAgentData.brands`
        and `getHighEntropyValues` in the page, and to the `sec-ch-ua` request header, didn't remove it, so both
        shims were reverted. It's cosmetic; install and remove work.
      - uBlock Origin Lite from the store is untested. We ship it built in, and a store copy would duplicate it.
W2. **Uninstall. Verified at the engine level:** `NNExtensions.uninstall` removed Bitwarden, and it left
    `getExtensionsInfo`. Still to test with the user present:
    - "Remove from Netnyahoo" on the store page and Settings › Extensions › Remove. Both go through our "Remove …?"
      confirmation, a native sheet that needs a key window.
    - Chrome's uninstall dialog isn't hooked; our confirmation replaces it.
W3. **Auto-update. Verified 2026-09-25 (r2).**
    - Our build never checked: ungoogled's `block-requests.patch` returns early from
      `UpdateCheckerImpl::CheckForUpdates`, so every update check (and `developerPrivate.autoUpdate()`) stayed pending,
      and the update client's default URL is update.googleapis.com, which domain substitution cuts off.
      `chromium-extension-updates.patch` removes the early return and points extension update checks at
      `https://clients2.google.com/service/update2/json` (the same protocol; the component updater stays cut off).
    - Test: Dark Reader installed from the store at 4.9.133; with the app quit, its on-disk manifest was set to
      4.9.100 and the app relaunched with `NETNYAHOO_CHROMIUM_SWITCHES="--lang=fr --extensions-update-frequency=30"`
      (a new locale makes Chrome reload the manifest from disk, so it reported 4.9.100; the manifest isn't
      content-verified).
    - Result: the net log shows `clients2.google.com/service/update2/json` and the CRX from
      `clients2.googleusercontent.com/crx/blobs/…`, unpacked into `4.9.133_1` with no prompt. Chrome delayed the
      install while Dark Reader's service worker was busy (its normal rule) and finished it at the next launch:
      `developerPrivate` reports 4.9.133 from `4.9.133_1`, and the old folder was garbage-collected.

### Dia 1.50 "Sunglow" visuals (WP11; needs the unlocked screen, not the patched CEF)

Spec: `docs/dia-spec.md` › "1.50 Sunglow". Launch a `build-sunglow` instance with
`NETNYAHOO_BACKGROUND=1 NETNYAHOO_SHADERS_FORCE_KEY=1` and capture with `screencapture -l`; capture Dia 1.50.1
read-only (never click it).

28. **Painted mark vs Dia.** For each profile colour in light and dark, a Dia 1.50.1 New Tab capture next to ours at
    the same window size. Pass if the mark's outline, size and centre (Dia: 84pt view centred 48pt above the bar)
    match within 0.5pt, and its OKLab lightness 5th/50th/95th percentiles within 0.02 (ours are measured already, via
    `debugSnapshot`, against the paintings themselves).
29. **Selected tab.** Same sidebar tint in both apps (same profile colour, key state, wallpaper). Pass if the selected
    row reads as #121212 at 0.5 over the sidebar (dark) and white at 0.7 (light). Our 2026-09-25 capture read darker
    than that composite (sidebar (54,44,45) → row (29,23,24), expected (36,31,31)), and the 1.49 value read darker by
    the same factor, so check how the Metal backdrop and the row composite first.
30. **Command bar shadow.** Light mode: under the bar's bottom edge, the 0.08 r2 (0, 0.5) + 0.04 r1 (0, 2) shadow
    matches Dia row by row.
31. **Toolbar breadcrumb.** Find when Dia 1.50.1 shows only the host (seen on a trycloudflare.com page whose title
    was "Netnyahoo Build Status") and match it.
32. **Focus. Resolved.** On 2026-09-25 a `build-sunglow` instance launched with `open -g` and `NETNYAHOO_BACKGROUND=1`
    was frontmost right after launch, twice. `NNActivation.mm` now makes such instances BackgroundOnly and guards
    every activation path (logged to `activation.log`); `lsappinfo front` hasn't shown a test instance since
    (Done › Focus).

### netnyahoo:// URLs (core appUrls.ts, cef WebView, NNClient; see docs/store-api.md)

Use the scratchpad `nneval.sh` to drive the store and `cdp-integration.mjs` (with your port) to read pages.

33. **WebUI pages in Chrome-style tabs.** Type `netnyahoo://version`, `gpu`, `flags`, `net-internals`, `inspect`,
    `extensions` and `settings/languages` in the bar. Pass if all of these hold:
    - Each renders in the tab. CDP lists the page as `chrome://…`.
    - The store's `tab.url` and the toolbar read `netnyahoo://…`.
    - The page isn't blank. On stock Alloy, some WebUI hosts don't render at all, so test this on the new engine.
34. **In-page WebUI navigation.** On `netnyahoo://extensions`, open "Keyboard shortcuts" and an extension's Details.
    On `netnyahoo://settings/languages`, click the back arrow. Pass if the bar follows each step as `netnyahoo://…`
    (`extensions/shortcuts`, `?id=…`), and Back / Forward and the back-list popover titles work.
35. **Page-initiated.** On a WebUI page, run `location.href = "netnyahoo://version"` via CDP. It must load
    chrome://version. From an https page, run the same, plus a ⌘-click and a `window.open` on a
    `<a href="netnyahoo://quit">`. Pass if nothing opens, the app keeps running, and no Launch Services prompt appears.
    If a web page's netnyahoo:// navigation reaches `OnProtocolExecution` instead of `OnBeforeBrowse`, move the
    check there.
36. **Chrome-made tabs.** `chrome.tabs.create({url: "chrome://version"})` from the fixture extension (and with no
    url, which gives chrome://newtab). Pass if the sidebar tab reads `netnyahoo://version`. A Chrome New Tab
    (`netnyahoo://newtab` in the store) should show our New Tab page; today it loads Chrome's NTP in a web view.
    If it does, map it in lib/chromeTabs.
37. **chrome://history reached inside the engine** (for example, a Chrome surface opening History). Pass if the tab
    switches to our React History page. Known cost: that tab's web view and its back list are dropped
    (ContentCard unmounts internal tabs).
38. **Extensions reading URLs.** `chrome.tabs.query({})` reports `chrome://version/` for such a tab. That's
    expected: only the app shows netnyahoo://. An extension calling `chrome.tabs.create({url: "netnyahoo://…"})` is
    blocked by NNClient; the optional Chromium patch in the scheme agent's report would fix that.

### Signing and passkeys (passkeys agent)

Signing: Debug = Apple Development (automatic), Release = archive + Developer ID export. Ad-hoc fallback for machines
without the team: `-xcconfig macos/AdHoc.xcconfig` (no hardened runtime, no keychain groups; security keys and
phone passkeys still work). The Chromium side is in the passkeys agent's patch
(scratchpad `passkeys-chromium.patch`): `branding_file_path` → `chrome/app/theme/netnyahoo/BRANDING`
(MAC_BUNDLE_ID=com.netnyahoo.browser, MAC_TEAM_ID=U5L5T3NGVV), the iCloud Keychain NSWindow fallback in
`ChromeAuthenticatorRequestDelegate::ConfigureNSWindow`, and "Netnyahoo Safe Storage" + `CEF_NN_SAFE_STORAGE`.

39. **Phone (hybrid) sign-in, needs the user and a phone.** The QR sheet is verified (above). On webauthn.io Register
    → "Use a phone or tablet", scan the QR with an iPhone/Android camera. Pass if the phone connects (tunnel through
    cable.ua5v.com, which domain substitution left alone), the passkey is saved on the phone, and Authenticate with it
    works.
40. **Touch ID ("Chrome profile") passkeys.** ✅ 2026-09-25 in a Developer ID build (above, "Passkey dialogs were
    invisible"): webauthn.io Register (Platform) offers the Chrome profile, macOS's Touch ID sheet appears when the
    site requires user verification, and the user completed register and sign-in with Touch ID. Still to see in the
    shipped app: the same on Google (checklist step 6).
41. **Safe Storage (`CEF_NN_SAFE_STORAGE`).** In a team-signed Debug run without `NETNYAHOO_DATA_DIR`, pass if:
    - A "Netnyahoo Safe Storage" item appears in the login keychain, with no prompt.
    - Cookies survive a rebuild and relaunch with no prompt.
    - With `NETNYAHOO_DATA_DIR` or an ad-hoc build, no item is touched (mock keychain).
    - One-time cost: the default profile's cookies and saved passwords, which were encrypted with the mock key,
      are lost once.
42. **iCloud Keychain passkeys.** Only after Apple grants `com.apple.developer.web-browser.public-key-credential`.
    Enable the capability on the App ID, then set `CODE_SIGN_ENTITLEMENTS` to
    `Netnyahoo-macOS/Netnyahoo-ICloudPasskeys.entitlements` and rebuild with `-allowProvisioningUpdates`. Pass if all
    of these hold:
    - The dialog offers "iCloud Keychain".
    - The first use raises macOS's "Allow Netnyahoo to use passkeys…" prompt, attached to our window (needs the
      NSWindow fallback in the patch).
    - A passkey created there shows in Passwords.app.

### Offline page (`chromium-neterror-yahu.patch`)

43. **DNS probe ending in "no internet".** Join a Wi-Fi network with no upstream (or unplug the router's WAN), keep
    the Mac's interface up, and load a site not in the DNS cache. Chrome's page first shows the DNS error while the
    probe runs. Pass if, once the probe finishes, the tab switches to the game with the code
    `DNS_PROBE_FINISHED_NO_INTERNET` and the site's host, Retry reloads, and CDP shows no console error. (A fully
    offline Mac gives `ERR_INTERNET_DISCONNECTED` at once, which is verified.)

### Profile paging (layout/profilePager, ProfileSwipe, profiles/ProfileDots)

44. **Real devices.** With 3 profiles and tabs in each, in a key window: (a) two-finger swipes over the sidebar and
    the top tab strip, slow and fast, with Swipe between pages on and off: the pages follow at half the finger
    distance with no stutter, a tick at each halfway detent, a flick commits, a slow release past/under halfway
    commits/returns, rubber band at the ends; (b) the same with one finger on a Magic Mouse; (c) a wheel mouse's
    horizontal scroll and Shift+scroll page once per burst; (d) a swipe over a horizontally scrolled top strip
    scrolls the chips first. Pass if all of that holds and the tab list never janks during a swipe with 50+ tabs.

### Window translucency (WindowBackdrop `vibrancy`, lib/windowTint; dia-spec › Window translucency)
Verified so far: build `build-transl`, instance `/tmp/nn-transl`, captures in the session scratchpad `translucency/`
(composited with the windows below, over our own non-activating helper windows). Inactive, dark, plum: the sidebar
gutter reads (53, 33.5, 36) / (56, 40, 42) / (59, 48, 48) at 7 / 50 / 95 % height, identical over white and black,
against Dia's inactive (52.6, 33.8, 35.8) / (55.7, 40.8, 41.7) / (58.7, 47.6, 48.6). Forced key
(`NetnyahooAreaLight.debugSetWindowActive(true)`): the gutter top goes from (42.5, 27, 30) over black to (73, 58, 60.5)
over white, and a bright disc behind the window's bottom-left shows through the sidebar and, at about half strength,
the New Tab card (`comparison-sheet.png`). Light appearance renders (pink-tinted, blur under it) but has no Dia
reference. Dia itself could only be captured inactive (it's never key while we work), where it is opaque.
Still to run (needs the user at the screen, with Dia key):
1. **Key window vs Dia.** Put Dia (pink profile, New Tab) and Netnyahoo (plum, New Tab) side by side over the same
   wallpaper, each key in turn, and capture the screen (not a window-only capture: those never show the desktop).
   Pass if the sidebar gutter and the card read within 2 levels of Dia's at the top and bottom, and a bright
   wallpaper feature shows through both by the same amount.
2. **Light mode.** Same, in light appearance; the `.hudWindow` inactive fill and the light tint are unmeasured.
3. **Reduce Transparency / Increase Contrast.** Turn each on (System Settings › Accessibility › Display) with
   both apps key: pass if both go opaque the same way.
4. **Other profile colours.** Set a Dia profile to blue/green/…, capture it inactive, and fit its tint with
   scratchpad `translucency/fit.py`; ours derive them from the swatch hue.
5. **Profile swipe.** Page between two profiles with the window key: the blur must stay steady while the tints
   cross-fade (each page layer carries its own blur).

### Chrome-hosted windows (the only path since 0.2.0; `CEF_NN_CLIENT_WINDOW`; docs/research/chrome-hosted-window.md)
Phases 1–3a verified headless behind the flag (2026-09-26; the design doc has the tables). The flip to the only path
(0.2.0) was verified on hidden instances of the 0.2.0 engine (no `chromium-context-menu-hosted.patch`):
- `spike/spike.mjs`: page click and typing, sidebar click, autofill ↓ + Enter, passkey sheet in front and gone on
  navigation, JS alert, no zoom bubble, command bar over the page, `<select>` popup, context menu (12 + 2 of 14; the
  last two need a warm session: in a fresh one they click before the page's insets are laid out).
- `spike/p2.mjs`: keep-alive and ⇧⌘T into an empty window, drag out and back, split view (2–3 panes, alert centred
  on its pane), PiP, DevTools (undocked), sized popups in Chrome windows of their own (passkey sheet over the popup,
  context menu with a real right-click; a CDP-synthesized one shows none there), downloads, find, extension popups,
  swipe paging, traffic lights, HTML5 full screen with Chrome's Esc hint, incognito (dark, Chrome-hosted), the close
  warning sheet. Keys: typed keys reach the page; ⌃PgDn doesn't reach it, as on the flagged build before the flip.
- `spike/p3.mjs`: neighbour window made ahead, paging and ⌃1/⌃2 (store and window agree), full screen with two
  profiles (DEV `fakeFullScreen:`: the other profile's window over the full-screen one, its passkey sheet in front,
  back home, and leaving full screen on the other profile), IME both ways, an extension's ⇧⌘Y command, and
  autofill, passkey and context menu in the second profile's own window.
- `spike/restore3.sh`: a window left on its second profile restores as that profile's window.
- Release smoke test (`SMOKE_APP=<Debug build>`, screen unlocked): 15/15, including the new checks (no hidden
  full-size window; a two-profile session restores on Work alone on screen, its pages in the Work context; the
  passkey sheet directly over the visible window it belongs to, and gone when the page navigates).

Run with the screen unlocked on 2026-09-26 (hidden instances):
- Smoke test z-order checks: pass (see above).
- `swapmeasure.sh`, 10 swaps each: transparent 9 and 17 transient frames, naive 69, snapshot 148; the 0.1.6
  default path (ghost) 158 in 8 swaps. Transparent stays the default. Its transients are our views redrawing in the
  incoming window for 2–6 frames (the design doc › Shipped as default).
- Translucency, inactive, light and dark (`docs/research/chrome-hosted-window/translucent-inactive-light-dark.jpg`): vibrancy material 13 / 29 behind-window,
  tints right. Active can't be captured from a background instance.
- Traffic lights, 2x capture: centres 24.78 / 47.74 / 70.75 pt, 26.73 pt down (Dia 1.50.1: 24.75 / 47.75 / 70.75,
  26.75).

Docked DevTools (after 0.2.0; the design doc › Phase 3 › Docked DevTools): verified headless, `spike/p3.mjs dock
dock2`, 14/14; the regression battery on the same build (spike, p2, p3) as for the flip.

Still to run by a person (screen unlocked, the app in front):
1. **VoiceOver.** Over a window showing a web page. Pass if VO reads the sidebar, the toolbar and the page's own
   content (headings, links), and never Chrome's toolbar or tab strip.
2. **A real key window.** Pass if ⌘-keys a page handles (⌘B in a rich-text editor) stay the page's; ⇧⌘W asks
   before closing a window with several tabs (warn setting on); the command bar keeps focus after the window becomes
   key again.
3. **Window full screen.** ⌃⌘F, the green button and a page's full screen, in and out, with two windows. Pass if
   the page fills the screen, the traffic lights and sidebar come back on exit, and Chrome's Esc hint is centred
   over the page.
4. **Full screen with two profiles.** Enter full screen, page to the other profile (swipe and ⌃2): pass if it shows
   on the full-screen Space with no traffic lights and no gap; open a passkey sheet or alert in one of its tabs (in
   front); ⌃⌘F while on it leaves full screen and ends on that profile's window at the old frame; page back and
   forth in full screen a few times.
5. **Profile swipe by eye**, both ways, fast and slow, ⌃1–9 across three profiles. Pass if it looks as smooth as
   0.1.6 (the measured transient: our views partly drawn for 2–6 frames at the cut).
6. **Window identity with a window paged to its second profile.** Mission Control, ⌘\`, the Window menu, Stage
   Manager, Keep on Top, minimise and restore, moving to another Space. Pass if it behaves as one window.
7. **Translucency, key.** Bright wallpaper behind, dark and light: the blur while key, opaque while inactive, the
   window shadow and corners.
8. **Sign-in popups.** A real OAuth popup (Google, GitHub): saved password autofill and a passkey in the popup show
   over it; the popup closes itself when done.
9. **Download fly-in and extension popups.** A download's fly-in lands on the downloads button; an extension's
   popup opens under its toolbar button, sized to its content.
10. **Drag and drop.** A link or file from the page into the sidebar and back; a file from Finder into the page.
11. **Multiple displays.** Paging, full screen and dialog placement on a second display, and moving a window
    across displays mid-page.
12. **Docked DevTools by hand.** ⌥⌘I and Inspect from the page's menu: DevTools dock on the right; drag the
    split; switch the dock side from DevTools' ⋮ menu; undock and dock back; Inspect an element (the page's
    highlight lines up with the element); type in DevTools' console (keys go to DevTools, not the page).

## Known gaps (by design, for now)
- `chrome.tabs.move` by an extension doesn't reorder the sidebar. Only activation and pinning come back; our order
  is pushed to Chrome.
- The stock-CEF build (`NN_CHROME_TABS=0`, `docs/cef-source-build.md`) still has the Alloy-era gaps: no in-page
  password or autofill filling, no ad blocking in incognito, and extensions don't see our tabs.

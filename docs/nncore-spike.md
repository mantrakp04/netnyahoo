# NNCore spike: our own Chromium layer instead of CEF

Spike for recommendation 5 of `docs/architecture-review.md` (sections B, C and G), run 2026-10-01 on the Chromium 154
tree we build CEF from (`~/chromium-build`, branch 8037).

**Verdict: GO-WITH-CHANGES.** NNCore works. Chrome's framework with a small layer of ours (about 3,200 lines)
runs a plain AppKit app: two profiles in one window, popups that arrive as our own tabs with POST bodies intact,
Chrome's autofill and passkey UI attached to our window, docked DevTools, an MV3 extension with its popup, and
Chromium running the app's run loop with a clean quit. All 29 automated checks pass in a hidden instance.

The changes the plan needs:
- **No mixing in one process.** CEF and NNCore can't both run in the same app process, since each is a full
  Chromium. So "Small Yahu on NNCore while the main windows stay on CEF" doesn't work. The strangler happens at the
  JS API instead: a second native implementation behind the unchanged `packages/cef` API, in its own app build,
  switched over in one go when it reaches parity.
- **The CEF-in-tree tax.** While CEF stays in the Chromium tree, its patches take things out of Chrome that NNCore
  has to put back, and it adds CHECKs that assume a `BrowserView`. That costs 4 small hooks today; 2 of them go away
  with CEF.
- **The real remaining work** is the list under "What the spike does not prove": AppKit focus and keyboard, the
  RN bootstrap, closes and quits that get cancelled, permission prompts, and the renderer-side features CEF gives
  us today.

## What was built

| Path | What |
|---|---|
| `engine/nncore/src/netnyahoo/core/` | Our Chromium-side layer, copied into the tree as `//netnyahoo/core` |
| `engine/nncore/apply.sh` | Copies it in and adds the hooks (idempotent; `--check` reports drift) |
| `spikes/nncore-host/` | A plain AppKit host app (`main.mm`), its build and signing (`build.sh`), and the acceptance run (`acceptance.mjs`) with an MV3 test extension |

How it fits together:
- **The framework.** NNCore is Chrome's own `//chrome:chrome_framework` (`Chromium Framework.framework`, built by
  Chrome's own GN rules, helpers and resources included) with `//netnyahoo/core` linked in. That takes one dep in the
  macOS `//chrome:chrome_dll`. The framework exports our ObjC classes and `NNCoreMain` (`nncore.exports`). The host
  links it directly, and builds with clang outside GN, as the RN app would.
- **Startup.** `ChromeMain` creates `nncore::NNMainDelegate`, a `ChromeMainDelegate` (hook 2). Its content client
  wraps Chrome's main parts, so Chromium runs its own main loop (`MessagePumpNSApplication`, `[NSApp run]`). A
  keep-alive stands in for `AppController`, so the app outlives its last window.
- **One window, several Browsers.** `WindowHost` owns one `NSWindow`, a Views widget (`NativeWidgetMacNSWindow`).
  The host's view tree sits inside its `BridgedContentView`, and is hit-tested first (the existing
  `netnyahooEmbeddedView` patch). Each profile shown in the window gets its own Chrome `Browser`, whose
  `BrowserWindow` is `NNBrowserWindow`: a plain object with no `BrowserView`, frame, tab strip or toolbar. A tab's
  `WebContentsViewCocoa` goes straight into the host's views. Switching profiles is a view swap plus
  `BrowserActiveStateManager::DidBecomeActive`.
- **Popups.** `NNWebContentsDelegate` subclasses Chrome's `BrowserWebContentsDelegate`.
  - `AddNewContents` (window.open, target=_blank) and `OpenURLFromTab` (⌘-click, shift-click, POST forms) keep
    Chrome's own new `WebContents` and its navigation.
  - Popups and new windows are rewritten into tabs of our `Browser`.
  - The host gets `didInsertTab:opener:disposition:` with the original disposition. Nothing is adopted and nothing
    is replayed.
- **The CEF seams.** With CEF in the tree, `//chrome` calls `cef::` hooks (`cef::BrowserDelegate::Create`, the
  password-bubble and install-prompt hooks…). `nn_seams.mm` defines all 16 symbols. Our Browsers get our delegate
  (docked DevTools, keep-without-tabs, the password prompt); everything else keeps Chrome's behaviour.
- **Our UI where Chrome's needs its toolbar.**
  - The action popup is Chrome's `ExtensionViewHost` in an `NSPanel` attached to our window.
  - The password save prompt reaches the host through the existing bubble hook.
  - The find bar is headless: Chrome's `FindTabHelper` searches, and results go to the host.
  - Tab fullscreen is reported to the host, which shows the page full screen itself.

The hooks in Chrome's code (`apply.sh`; the CEF build still builds, checked with `cefclient`):

| Hook | Lines | Compiled by CEF? | After CEF leaves |
|---|---|---|---|
| `chrome/BUILD.gn`: `chrome_dll` depends on `//netnyahoo/core` | 1 | No | Stays |
| `chrome/app/chrome_main.cc`: `nncore::NNMainDelegate` instead of `ChromeMainDelegate` | 4 | No | Stays |
| `browser_window_features.cc`: two CEF-added `CHECK(browser_view)` return early instead | 11 | Yes, same behaviour for CEF | Gone (the CEF code they guard goes) |
| `read_anything_side_panel_controller.cc`: `CHECK_IS_TEST()` skipped for a Browser with a delegate (no side panel UI) | 5 | Yes, same behaviour for CEF | Replaced by our own `SidePanelUI` |

## Acceptance

`node spikes/nncore-host/acceptance.mjs <NNHost.app> <work dir>`. It launches the host hidden (LSBackgroundOnly,
activation policy Prohibited, never key), serves fixture pages, and drives the host through its command file and
Chrome's DevTools protocol. The last run passed 29 of 29. The screen was locked, so nothing here is pixel-checked
(see "Needs a visual check").

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Builds as a framework from the existing out dir; host links it; signing, hardened runtime, helpers | **Pass** (dev signing) | Incremental: our 5 source files compile in seconds, the framework links in about 20 s, and no GN arg changes. `NNHost.app` links `Chromium Framework` directly. Every helper and the app are signed ad hoc with `--options runtime` and Chrome's entitlements; `codesign --verify --deep --strict` passes; 5 helper processes run. Notarization needs: a Developer ID identity with timestamps (drop `disable-library-validation`, which only ad-hoc signatures need), the `keychain-access-groups` entitlement for Touch ID passkeys (Chrome logs it missing), `NSBluetoothAlwaysUsageDescription` for hybrid passkeys, and Chrome's own `process_requirement` check, which fails on ad-hoc builds |
| 2 | Our window and chrome around a WebContents; navigation; title, favicon, progress callbacks | **Pass** | The page sits at our content frame in our window. Title, favicon, progress, loading and navigation-state callbacks fire. Load, back and forward work. A real AppKit click (through AppKit's hit-testing into `RenderWidgetHostViewCocoa`, not DevTools input) follows a link. Chrome's ⌘F command and find in page report 2 matches. Tab fullscreen enter and exit reach the host |
| 3 | Two profiles in ONE window | **Pass** | Profile B's tab shows in the same `NSWindow` (same window number). Each profile is its own Browser with its own `chrome.windows` id. A cookie set in A isn't visible in B. The extension popup's `chrome.windows.getCurrent` is profile A's Browser in our window, with its 8 tabs and the right active tab |
| 4 | Popups land as tabs the host owns, opener and POST intact | **Pass** | target=_blank, window.open, window.open with features, ⌘-click, a form POST to _blank and a ⌘-clicked POST form all arrive as tabs of our Browser. Each carries the opener tab id and Chrome's disposition (`popup`, `background_tab`…). The POST pages show their bodies (`q=hello-post`, `q2=hello-cmd-post`). Chrome makes no window of its own |
| 5 | Autofill and passkey UI anchor to our window; a basic password save prompt | **Pass** (anchoring checked by frame numbers, not pixels) | The password prompt reaches the host (`username: nnuser`), the host saves it, and it is in Chrome's password store. The saved-login dropdown is a child window of ours, its top edge on the field's bottom edge. Chrome's passkey dialog is a child window centred on the page area and hanging from its top edge, as Chrome places tab-modal dialogs. The macOS iCloud Keychain sheet wasn't exercised (it needs the keychain entitlement) |
| 6 | Docked DevTools in our window | **Pass** | `DevToolsDockChanged` gives the host the DevTools view. It is laid out with Chrome's own resizing strategy beside the page (page 435 pt, DevTools 990 pt container), in our window |
| 7 | Unpacked MV3 extension, its action popup, a content script | **Pass** | It installs through `UnpackedInstaller`. Chrome now keeps unpacked extensions disabled outside developer mode, so the API turns it on. The content script marks the fixture page. The action popup opens in a panel attached to our window and runs its script |
| 8 | Chromium's loop runs the app; quit and terminate are clean | **Pass** | The main thread runs `BrowserMainLoop::RunMainMessageLoop` → `MessagePumpNSApplication` → `[NSApp run]`, with no external pump. Quit closes every Browser, the loop ends (`engineWillShutDown`), the process exits 0, and there's no crash report. The app never took focus (`lsappinfo front` sampled every 0.5 s) |
| 9 | One practice rebase (to 155) | **Pass** (on paper; no 155 tree to build against) | Detail below. 2 of our 4 hooks apply to 155's files as they are; the other 2 exist only while CEF is in the tree. Our code needs about 6 small edits |
| 10 | Size | Measured | Detail below |

### Bugs the spike hit and fixed (each is a fact about the CEF-patched tree or a BrowserView-less Browser)
- CEF's patches compile out of `ChromeMainDelegate` the sampling profiler and `--user-data-dir` handling. Without
  the latter, Chrome falls back to `~/Library/Application Support/Chromium`; NNCore now refuses to start without a
  data dir.
- CEF also compiles out the startup browser creator and the main `RunLoop` (CEF runs its own). Without them, Chrome
  exits right after startup.
- CEF removes `AppController`. Without it, nothing keeps the app alive with no windows, and `chrome::AttemptExit`
  ends in `[NSApp terminate:]` through `AppController`. NNCore holds a keep-alive and quits through
  `CloseAllBrowsersAndQuit`.
- Reading mode's side panel `CHECK_IS_TEST()`s when the active tab closes in a Browser without a side panel.
- A null `ExclusiveAccessContext` crashed on the first real (AppKit) mouse event, and a null `FindBar` crashed ⌘F.
  Codex found both by reading the code; DevTools-protocol input had hidden the first one.
- With a remote-debugging port and no startup window, Chrome holds a `REMOTE_DEBUGGING` keep-alive until
  `Browser.close`; NNCore's quit releases it too.
- An extension popup's host kept its renderer alive past profile teardown, so it now closes at shutdown and on
  `window.close()`.

## The API the RN app talks to

`engine/nncore/src/netnyahoo/core/public/NNCore.h` is plain ObjC, with no C++ for the host to see:
- `NNCoreEngine`: run, start and shut down, profiles, quit.
- `NNCoreProfile`: extensions and saved logins.
- `NNCoreWindow`: one per `NSWindow`. It has `hostView`, `openTab:profile:foreground:`, `activeProfile`,
  `activateTab:`, `tabsForProfile:` and `executeChromeCommand:profile:`. Its delegate gets the live-tab events:
  inserted with opener and disposition, removed, activated by Chrome, DevTools dock changes, fullscreen, password
  prompt.
- `NNCoreTab`: `view`, navigation, state (`url`, `title`, `loading`, `progress`, `favicon`, `canGoBack/Forward`),
  `focus`, `find:`, `showDevTools`, `savePendingPassword`, `openActionPopupForExtension:`. Its delegate gets the
  per-tab changes.

`packages/cef/src` stays as it is, and its native side is reimplemented on this:

| JS today (`packages/cef/src`) | Native today | On NNCore |
|---|---|---|
| `<WebView>` props and events (`onNavigation`, title, favicon, progress) | `NNBrowserView`, `NNClient` CEF handlers | `NNCoreTab` and its delegate; coalesced per frame in the module, as rec. 6 asks |
| `onOpenWindow` + `adoptId` + `postBody` | `OnBeforePopup`/`OnOpenURLFromTab` → JS → adopt by id (30 s orphan timer), `cef_nn_load_open_url` replay | `window:didInsertTab:opener:disposition:` hands over a live tab; `adoptId` becomes that tab's id and the WebView just shows its `view` |
| Chrome tab strip sync (`chromeTabs.ts`, `tabStripEcho.ts`) | `OnTabStripChanged`, `SetTabIndex` | `didInsertTab`/`didRemoveTab`/`didActivateTab`, the revisioned transaction contract of rec. 1 |
| Profiles and paging (`profilePager`, `swipe.tsx`) | One Chrome window per profile, `MoveRoot`, `NNChromeWindow` | `activeProfile` on one `NNCoreWindow`; paging is a view swap |
| Passwords, autofill, extensions, zoom, search engines | Hidden WebUI pages driven by `Runtime.evaluate` (`NNChromePages`) | Direct calls in `nncore_api.mm` (as `fetchSavedLogins`, `loadUnpackedExtension` do), i.e. rec. 4 |
| DevTools | `cef-window-devtools`, `NNDevTools` | `devToolsDidChangeForTab:` + `devToolsLayoutForSize:` |
| Shortcuts | `NNClient` key tables, `OnChromeCommand` | `executeChromeCommand:`; the key path still has to be designed (below) |

## What the spike does not prove

Codex's review and my own reading agree on this list. It is the bulk of the remaining work.

Before Small Yahu:
- **Key window, focus, keyboard.** Key equivalents, IME and accessibility through `BridgedContentView` and the
  host's views. The test instance can never be key, so input was proved for clicks, not keys.
  `PreHandleKeyboardEvent` returns "not handled" today.
- **Rendering.** Native compositing is unchecked in pixels (screen locked).
- **The RN bootstrap.** The RN app inside Chromium's loop, with NSApp being Chrome's `BrowserCrApplication`.
- **Cancelled closes and quits.** `WindowHost::Close` latches `closing_` before beforeunload succeeds, and the
  quit drops the app keep-alive before it can fail. Downloads in flight close without asking (our window approves
  it; Chrome's Mac close path expected `AppController` to ask). The `NNCoreWindow` owner should stay alive until
  every Browser has closed. `NNCoreProfile` wrappers must drop their `Profile*` when it goes.
- **`[NSApp terminate:]` from outside** (logout, the Dock): `BrowserCrApplication` sends it to `AppController`,
  which NNCore apps don't create. It needs a small override.

Before the main windows:
- **Permission prompts across profiles.** Chrome finds a window's Browser by the first match, so a prompt from a
  profile not being shown may anchor wrongly.
- **Windows Chrome creates itself.** `chrome.windows.create`, incognito, undocked DevTools and PiP make Views
  `BrowserView` windows. They need a hook where `Browser` creates its window (about 10 lines), or our own `Browser`
  creation for those paths.
- **Our own `SidePanelUI`**, `ExtensionsContainer` and install prompt.
- **The popup pieces.** Blocked-popup replay, COOP/noopener popups across processes, and `activeTab` grants for the
  action popup (we open it directly instead of running the action).
- **Renderer-side features CEF gives us.** Page script injection, process messages and the `netnyahoo://` scheme
  need an inventory. They become an NNCore `ContentRendererClient` and a mojo interface.
- **Renaming.** The framework is still called `Chromium Framework` with `Chromium Helper` apps, since the names come
  from the branding file, a GN arg. Rename at the next full rebuild.

## Practice rebase: 154 → 155

We have no 155 tree, so this compares the 154 (branch 8037) and 155 (branch 8059) versions of every Chromium file
NNCore implements, subclasses or hooks, fetched from googlesource:

| Interface | 154 → 155 change | Edit in NNCore |
|---|---|---|
| `BrowserWindow` | +1 pure virtual (`GetAcceleratorProvider`); `DownloadCloseType` moved out of `UnloadController` | 2 lines |
| `LocationBar` | +2 pure virtuals | 2 stubs |
| `content::BrowserMainParts` | `PostCreateThreads` returns `int` | 1 line in the wrapper |
| `BrowserWebContentsDelegate` | Two unrelated signatures; our two overrides unchanged | None |
| `create_browser_window.h`, `ExtensionView`, `UnpackedInstaller`, `PasswordsModelDelegate`, `TabStripModelObserver`, modal dialog host, `ChromeMainDelegate`, `chrome_main.cc` | Unchanged | None |
| Hooks | `apply.sh` against the 155 files: the `chrome_dll` and `ChromeMain` hooks apply as they are; the read-anything block is identical; the `browser_window_features` hook doesn't apply, since stock 155 has no CEF code there and needs none | None |

So the rebase costs about 6 small edits plus the CEF-era hooks, against today's 37 patches (1,001 Chromium + 3,403
CEF-layer lines) re-applied by context. The biggest 155 risk is outside NNCore: `browser.cc` and
`browser_window_features.cc` keep changing (26 and 80 changed lines), so the Browser-creation hook we will add later
lives in a moving file.

## Size

Today's NNCore (C++/ObjC++, headers included): 3,165 lines. The hooks in Chrome's files: 21 lines. The host and
acceptance run (1,072 lines) are test code. The architecture review estimated 6–9k lines for parity; I'd keep that.

What it deletes when it ships, from the review's inventory:
- **Patches.** About 3,700 of the 4,400 patch lines: all 16 CEF-layer patches (+3,403), plus the Chromium patches
  that exist only for CEF's window model: `webview-native-hosted`, `window-hosted` (its embedded-view part stays, and
  NNCore uses it), `browser-view-hosted-fullscreen`, `devtools-redock-display`, `autofill-card-touchbar`,
  `extension-window-hidden`, the insert-order fixes.
- **`packages/cef/ios`.** 6–8k of its 13.7k lines: `NNClient.mm` (1,430, mostly CEF handler routing),
  `NNWindowHost.mm` (1,063), `NNChromeWindow.mm` (716), `NNPopupWindow.mm`, `NNChromePages.mm` (471) and the page
  scripting in its wrappers, the pump in `NNCef.mm`, most of `NNSwipe.mm` (924) and `SwipeModule.swift` (594).
- **The CEF build.** `libcef_dll_wrapper`, `make_distrib`/`06-distrib.sh`, most of `setup.sh`/`embed.sh` and the
  `CEF_NN_*` marker matrix.
- **Not app size.** NNCore's framework is the same size as CEF's (534 MB vs 536 MB). The win is one Chromium copy
  in the build instead of a distrib plus a vendored copy, not a smaller app.

## Migration plan

1. **Now, done:** this spike.
2. **NNCore runtime work, before any UI** (rec. 1 and 4 land here, as planned): everything under "Before Small Yahu".
   That means the key and focus path, cancellable close and quit, `terminate:`, an `NNCore` Expo module skeleton
   with the RN root inside Chromium's loop, a page-script and process-message replacement, and real key/IME tests.
   The acceptance run grows with each.
3. **`packages/nncore`:** the same JS API as `packages/cef`, implemented on `NNCore.h`, built as a second app target
   (`Netnyahoo NNCore`, dev only). The first surface brought up there is Small Yahu (one tab, one profile, the
   simplest window), then the main window with one profile, then profiles, extensions UI, side panels, PiP and
   Cast.
   - Both app targets build from the same JS, so the store and UI keep moving while the native side catches up.
   - The parity checklist decides when to switch.
4. **Switch:** ship the NNCore build. Then delete `packages/cef/ios`, the CEF patches, the distrib and setup steps,
   and the CEF checkout.
   - Re-sync `~/chromium-build` as plain Chromium + ungoogled + our patches (`enable_cef=false`). That is the one
     5-hour rebuild, and the moment to rename the framework.
   - The CEF-era hooks and `nn_seams.mm` become one small `netnyahoo::` hook patch at the same call sites: Browser
     delegate creation, the password and install-prompt hooks, docked DevTools.

## Revised effort

Codex's estimate, which I adopt: conventional engineer-weeks, then at this repo's measured pace (÷4–6).

| Stage | Conventional | At our pace |
|---|---|---|
| Small Yahu on NNCore behind the existing JS API (includes the runtime work in step 2) | 3–5 weeks | 3–6 working days |
| Main windows at today's parity | +6–10 weeks | +5–13 days |
| Delete CEF; qualify packaging, notarization and the 155 rebase | +2–4 weeks | +2–5 days |
| **Total** | **11–19 weeks** | **about 2–5 weeks** |

That is within the review's 12–20+ engineer-week range, with the uncertainty now in UI seams and input rather than
in whether a Chromium framework can be built, linked, signed and hosted, which this spike settled.

## Codex second opinion

Codex (`gpt-6.1-sol`, high effort, read-only) reviewed the sources and the Chromium call paths. Its call:
**GO-WITH-CHANGES** for continuing NNCore, NO-GO for shipping the spike as it is. Its findings:
- **Fixed after its review:**
  - the null `ExclusiveAccessContext` crash on real AppKit mouse input;
  - the null `FindBar`;
  - the popup's missing close handler;
  - a non-reentrant pending-opener slot (now `base::AutoReset`);
  - startup readiness: the loop now runs only once `PostBrowserStart` ran;
  - the acceptance run's exit code.
  The run went from 26 checks to 29 with tests for native clicks, find and fullscreen.
- **Open, listed above:**
  - cancelled close and quit;
  - download confirmation;
  - host and profile lifetimes;
  - picking the Browser for dialogs across profiles;
  - `activeTab` grants;
  - the key path.
- **Changed the plan:** CEF and NNCore can't coexist in one process. So the strangler is a second native
  implementation behind the same JS API, not one window type at a time inside the CEF app.
- **Agreed:** the widget-backed window is the cheap way to keep Chrome's bubbles attached. It doesn't replace the
  seams Dia implements (side panel, extensions container, permission prompts). Keeping Chrome's `WebContents` and
  navigation for popups is the right foundation.

## Reproduce

```bash
# Chromium side (holds the chromium lock only while compiling):
engine/nncore/apply.sh
cd ~/chromium-build/chromium_git/chromium/src && source ~/chromium-build/scripts/env.sh
~/Documents/netnyahoo/scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework

# Host app, signed, and the acceptance run:
spikes/nncore-host/build.sh /tmp/nncore-host
node spikes/nncore-host/acceptance.mjs /tmp/nncore-host/NNHost.app /tmp/nncore-acceptance
```

`apply.sh` must run again after anything resets the tree (steps 2–4 of `docs/cef-source-build.md`). Building
`cefclient` afterwards still works. It picks up the two CEF-neutral `CHECK` changes, so a CEF distribution built
from this tree includes them.

## Needs a visual check

The screen was locked for the whole spike:
- native composition of the page under our views;
- the autofill dropdown and passkey dialog against their fields, beyond frame numbers;
- the DevTools split;
- the extension panel's placement.

Use the SCK recorder from `docs/agent-brief.md` on `NNHost` once the screen is unlocked.

## Stage 1 runtime

Stage 1 (2026-10-01) closes the runtime gaps above under "Before Small Yahu" in the engine. The RN app's
stage-1 work is in `packages/nncore` and `docs/nncore-parity.md`. `spikes/nncore-host/acceptance.mjs` now
passes 65 checks in a hidden instance: the spike's 29 plus the `S1`–`S6` checks below.

| Item | How | Checks |
|---|---|---|
| `terminate:` and quit | `+[AppController sharedController]` answers a stand-in, so Chrome's `AppController` never exists or takes over `NSApp.delegate`. `-[BrowserCrApplication terminate:]` asks `NSApp.delegate` (`applicationShouldTerminate:`, with `NSTerminateLater` and `-replyToApplicationShouldTerminate:`). NNCore's own `kAEQuitApplication` handler routes the Dock, logout and `osascript` through it, so the delegate is asked once. The keep-alive is dropped only at `NSApplicationWillTerminateNotification`, Chrome's point of no return | S1: host delegate, Cancel, an Apple-event quit answered Later then cancelled by a page, the final quit |
| Cancellable close and quit | A window close runs every Browser's beforeunload first (`UnloadController::TryToCloseWindow`, as `BrowserCloseManager` does), then asks about downloads, then closes. "Stay" resets every Browser (`windowDidCancelClose:`). A quit has phases with a generation per attempt; a quit cancelled by a page fires `engineQuitCancelled` and keeps the keep-alive. The title bar's close asks `windowShouldClose:`. `NNCoreWindow` keeps itself alive until its window has closed, and profile wrappers drop their `Profile*` when it goes | S2 |
| Keys | `NNBrowserWindow::PreHandleKeyboardEvent` asks `window:preHandleKeyEvent:` (YES: the page never sees the key). Menu shortcuts are `NOT_HANDLED_IS_SHORTCUT`. Keys the page leaves go to `window:handleKeyEvent:`, then `NSApp.mainMenu`. Chrome's accelerators never run in our windows: a plain views widget has no `ChromeCommandDispatcherDelegate`. With a host view first responder, AppKit's normal path reaches the menu | S3 (the window is made key by a test-only `isKeyWindow` override): reserved ⌘T, ⌘K after the page, ⌘J the page keeps, ⌘T from an `NSTextField`, one menu action per press |
| Renderer side | `NNContentRendererClient` plus `//netnyahoo/core/mojom`. The page script reaches each renderer on its IPC channel at launch. It runs in every frame's main world in `DidCreateScriptContext`, before page scripts. Also: `post`/`receive`, `evaluate` (strict wrapper, first `post("result")` answers), `executeJavaScript` (main frame or one frame), and the `netnyahoo:` rule as a `NavigationThrottle` (web pages dropped; Chrome's pages: `tab:didRequestAppURL:userGesture:`) | S4 |
| Chrome's own windows | Hook in `Browser`'s constructor: a Browser Chrome makes itself asks `engineWindowForNewBrowserOfProfile:type:`. A returned window gets an `NNBrowserWindow` and the Browser behaves as ours | S5: `chrome.windows.create`, `IDC_NEW_INCOGNITO_WINDOW` |
| The rest of the API | `windowForNSWindow:`, `prepareProfile:`, `adoptTab:`, `placeTab:index:pinned:`, `closeNow`, the new tab callbacks and properties | S6 |

New hooks in Chrome's files, all added by `apply.sh` and checked by `--check`:
- **`browser.cc`, the window factory (8 lines).** Only NNCore sets it, so CEF is unchanged.
- **`sad_tab_controller.cc` (3 lines).** A Browser without a `BrowserView` keeps its sad tab unattached instead of
  crashing. Before this hook, a renderer crash in an NNCore tab crashed the browser.

Known gaps:
- **IME (marked text) and real focus/key-window behaviour** need an unlocked screen. The page's view is an
  `NSTextInputClient` and keys reach it, but marked text was not exercised.
- **Logout cancel.** A quit Apple event is answered at once, as Chrome's is, so logout isn't vetoed by an
  app that later stays.
- **Chrome's multitab close confirmation** (`--close-confirmation`) isn't followed. NNCore never sets that flag.
- **Teardown watchdog.** One acceptance run in about eight hit Chrome's 10 s teardown watchdog after a clean
  `engineWillShutDown` (exit code 2). The acceptance run now samples the process if the quit takes over 5 s.

## Stage 2: per-tab features and UI seams

Stage 2 adds the per-tab features and UI seams `packages/nncore` needs to emit what `packages/cef` emits. Wherever
it's practical, they hand over dictionaries already in the JS shapes of `packages/cef/src`. NNHost passes 93 of 93
checks in `S7`–`S22`. The unresponsive-page check is skipped: Chrome's hang monitor ignores hidden pages.

| Area | What NNCore provides |
|---|---|
| Profile | Allow-listed bool prefs (CEF's per-profile prefs set on load). Chrome's `BrowsingDataRemover`. Component extensions. Deleting a profile and releasing an incognito one. Cast routes |
| Tab state | `securityInfo`, per-site zoom and pinch scale, `focusedEditable`, media capture access, base background colour, `mediaCaptureSourceId` |
| Tab actions | Chrome commands on a background tab. Discard (`WebContentsDiscard`, so the same tab survives). Freeze. Unresponsive pages. Stop sharing. Autofill on demand. Scripts with a user gesture. Restore from `nn_tab_restore_take`'s state, and duplicate |
| Chrome UI the host shows instead | Permission prompts (`SetCreatePermissionPromptFunction`, before Chrome's bubble or chip). Blocked popups. Links to other apps. Extension install prompts. Extension actions, states and side panels. Device choosers. The Cast dialog. Context-menu items (Chrome's menu, plus the host's items; in background mode the menu is reported instead of shown) |
| Events | Download navigations. Activation requests (PiP's back-to-tab, `window.focus()`) |

New hook in Chrome's files, added by `apply.sh` and checked by `--check` and `series.py check`:
- **`chrome/browser/external_protocol/external_protocol_handler.cc` (12 lines).** Placed before the Mac's
  "no app for this scheme" check, so a scheme with no app also reaches the host. Only NNCore sets it.

What a hidden run can't prove: the screen-share picker (getDisplayMedia) is still Chrome's own, and camera,
microphone and geolocation prompts also ask macOS.

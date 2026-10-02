# Agent brief (read first)

You are one of several engineers working **in parallel in the same working tree** on
Netnyahoo, a macOS browser that must reach **full feature and visual parity with Dia**
(The Browser Company). The feature checklist is `docs/dia-feature-parity.md`; the
visual spec (colors, sizes, animations recovered from Dia's binary) is `docs/dia-spec.md`.
The user is demanding: no sloppy work, every hover state/animation/detail matters.

## Stack
- Turborepo + pnpm (hoisted `node_modules` at the repo root).
- `apps/browser`: Expo SDK 54 + react-native-macos 0.81 (Legacy architecture), zustand store,
  inline styles.
- Native code lives in Expo modules under `packages/*/ios` (Swift / Objective-C++):
  - `packages/nncore`: the web engine, **NNCore**: Chrome's own framework (`Chromium Framework.framework`, our patched
    Chromium 154 tree, `docs/cef-source-build.md`) with our layer linked in, and the Expo modules and JS API the app
    uses (`docs/nncore-spike.md`, `docs/nncore-parity.md`).
    - **Chromium runs the process.** `main.swift` calls `NNCoreHost.run`: `ChromeMain` starts with our
      `NNMainDelegate`, `NSApp` is Chrome's `BrowserCrApplication`, and the React Native host (`AppDelegate`) starts
      inside Chrome's run loop. Nothing may touch `NSApp` before that.
    - **Every app window is one `NNCoreWindow`** (a Views-backed `NSWindow`, so Chrome's bubbles, dialogs, menus and
      autofill dropdowns attach to it) holding a Chrome `Browser` per profile shown in it, each with no
      `BrowserView`, tab strip or toolbar (`NNCoreChromeWindow.mm`, the `NNChromeWindowHost` packages/shell looks
      up). Paging between profiles changes the active profile; the window stays.
    - Every tab is a real Chrome tab of its window's Browser; its `WebContents` view is hosted in our React Native
      views (`NNCoreWebView`). Popups, `target=_blank` and ⌘-click keep Chrome's own new `WebContents`.
    - Passwords, autofill, extensions, zoom and search engines call Chrome's services directly through our
      own Chromium code, `//chrome/browser/netnyahoo` (`engine/chromium`), exported as plain C
      (`NNCoreEngineBridge`, `NNCoreServices`); NNCore's own layer is `//netnyahoo/core` (`engine/nncore`).
      No chrome:// page is scripted.
    - JS API in `packages/nncore/src` (`WebView`, downloads, permissions, profiles, extensions, Chrome UI); its
      native modules keep their CEF-era names: `NetnyahooCEF` is `packages/nncore/ios/CefModule.swift`, and
      `NetnyahooExtensions`, `NetnyahooSwipe` and `NetnyahooChromeUI` are `ExtensionsModule.swift`,
      `SwipeModule.swift` and `ChromeUIModule.swift` there.
  - `packages/shell`: menus, shortcuts, windows, native primitives (Surface, Symbol, FadeLabel,
    VisualEffect, WindowDragRegion, ContextMenuArea, ActivitySpinner…).
  - `packages/shaders`: Metal views (window backdrop, New Tab effects). Don't touch unless assigned.
  - `packages/import`: importing from Chromium browsers, Arc, Dia, Firefox and Safari (bookmarks, history, tabs,
    passwords, cookies, autofill, Arc spaces; extensions are listed to reinstall from the Web Store). Its map is
    `packages/import/README.md`.
  - `packages/core`: pure TS (omnibox parsing, suggestions) with tests.
- react-native-macos quirks: RN shadow props crash → use `Surface` for shadows; RCTView resets
  layer props → draw in sublayers; native views must size subviews in `setFrameSize`.
- **Patched dependencies** live in `patches/` and are listed under `patchedDependencies` in
  `pnpm-workspace.yaml` (pnpm 11 reads them there); every `pnpm install` applies them, and the Podfile
  (`macos`) compiles React from `node_modules`, so a rebuild picks a change up (`pod install`
  only if a patch adds or removes files). To change one: `pnpm patch <pkg>@<version> --edit-dir <scratch dir>`,
  edit there, then `scripts/agent/locked pod -- pnpm patch-commit <scratch dir>`, and read the new `.patch`:
  pnpm can add bogus `deleted file` entries (drop them and run `pnpm install` again under the same lock).
  Mark edits `[Netnyahoo: … Netnyahoo]`. Current patches: `react-native-macos` (a view's `transform` survives
  AppKit layout and applies from its centre; RCTTiming's display link, c7ebd600) and `expo-modules-core` (the JS
  runtime is prepared on the JS thread only, 364f5f7e).

## The engine
- NNCore is built outside the repo in `~/chromium-build` (the tree and its patches: `engine/patches`,
  `docs/cef-source-build.md` › "Rebuilding"; `engine/chromium/apply.sh` and `engine/nncore/apply.sh` copy our code in).
  The app's build stages a copy of `out/Release_GN_arm64/Chromium Framework.framework`
  (`packages/nncore/scripts/stage-framework.sh`, into `apps/browser/build-nncore/NNCoreFramework`, or
  `NNCORE_STAGE_DIR`), links it and embeds it (`embed.sh`), so every agent's next build picks up a new framework.
- One agent at a time edits or builds `~/chromium-build`: hold the chromium lock for the whole edit → build cycle
  (`scripts/agent/locked chromium --take <you>`, then each command as `scripts/agent/locked chromium --as <you> --
  …`, and `--release <you>` at the end; an unreleased take expires after 60 min, so renew it by running commands
  with `--as`). Builds are incremental only: `scripts/agent/engine-build [--as <you>] [target…]` (default
  `chrome_framework`; `--help`) runs both `apply.sh` and their checks, then autoninja, under the chromium lock; run it
  with `run_in_background`. By hand, after both `apply.sh`:
  `cd ~/chromium-build/chromium_git/chromium/src && PATH=$HOME/chromium-build/depot_tools:$PATH DEPOT_TOOLS_UPDATE=0 ~/Documents/netnyahoo/scripts/agent/locked chromium [--as <you>] -- autoninja -C out/Release_GN_arm64 chrome_framework`.
  `apply.sh` copies the whole working tree, so other agents' uncommitted engine files get compiled too.
  A new framework changes every agent's next build, so say so in your report. To try one privately, build the app with
  `NNCORE_FRAMEWORK=<framework> …/locked xcodebuild -- xcodebuild … NNCORE_STAGE_DIR=<dir>` (the framework from the
  environment, the stage dir as a build setting).
- New engine code goes in `//chrome/browser/netnyahoo` (`engine/chromium/src`) or `//netnyahoo/core`
  (`engine/nncore/src`), never straight into the tree (`docs/cef-source-build.md` › "Our own code in the tree").
  `engine/patches/series` is the apply order of our patches to Chromium; `engine/patches/series.py check` proves the
  series reproduces the tree. CEF's own patches (`cef-*.patch`) stay in the tree until the next Chromium bump.

### NNCore code map
Engine files are in `engine/nncore/src/netnyahoo/core`, app files in `packages/nncore/ios`, JS in `apps/browser/src`.

| Concern | Engine | App | JS |
| --- | --- | --- | --- |
| Windows, tab ownership | `nn_browser.h` (`WindowHost`, `NNWebContentsDelegate`, `TabBridge`), `nn_browser_window.mm` | `NNCoreChromeWindow.mm`, `NNCoreTabStrip.mm` | `lib/chromeTabs.ts`, `store/liveTabs.ts` |
| Tab activation | `nncore_api.mm` `-activateTab:`, `nn_browser.mm` `ActiveTabChanged` | `NNCoreWebView.mm` `-activate`, `NNCoreTabStrip.mm` | same |
| Focus guard (test instances) | `nn_browser.mm` (`WindowHost` activation) | `NNCoreActivation.mm` (`activation.log`), `NNCoreChromeWindow.mm` | `packages/shell/ios/Windows.swift` |
| Fullscreen | `nn_browser_window.mm` (`ExclusiveAccessContext`), `nn_browser.mm` `FullscreenChanged` | `NNCoreChromeWindow.mm` (acted out in test instances) | `components/ContentCard.tsx`, `components/layout/pageState.ts` |
| Picture in Picture | `nn_picture_in_picture.mm`; Dia's window and controls in `engine/chromium/…/netnyahoo/pip/`; the auto-PiP hook in `engine/nncore/apply.sh` | `NNCorePictureInPicture.mm` | `components/media/pip.ts` |
| Password and autofill bubbles | `nn_password_prompt.mm`, `nn_browser_window.h` (`NNAutofillBubbleHandler`), `nn_autofill_trigger.mm` (dropdown) | `NNCoreChromeWindow.mm` (`window:passwordPrompt:forTab:`) → `NNCoreWebView` event | `components/site/Prompts.tsx`, `site/Autofill.tsx` |
| Share tab, screen share | `nncore_api.mm` (`TabSharingDelegateFor`), `nn_desktop_capture.mm` | `NNCoreHost.mm` `shareTabInstead`, `ChromeUIModule.swift` | `components/media/ShareBar.tsx`, `SharePicker.tsx` |
| Restore, discard | `engine/chromium/…/nn_tab_restore.cc` (closed tabs) | `NNCoreWebView.mm` (`discard:`, `transferKey`) | `lib/tabLifecycle.ts`, `store/windows.ts` |
| Permissions | `nn_permissions.mm` | `NNCoreHost.mm` (`permissionRequest`) | `components/site/permissions.ts`, `Prompts.tsx` |
| Page script | `nn_page_channel.mm`, `renderer/nn_content_renderer_client.cc` | `page_script.js`, `NNCoreWebView.mm` | `onPageMessage` (`packages/nncore/src/WebView.tsx`) |

- **Call path:** JS (`packages/nncore/src`) → `*Module.swift` → `NNCoreHost` / `NNCoreWebView` → `public/NNCore.h` →
  `nncore_api.mm` → `nn_*.mm`. Events come back through an `NNCore*Delegate` method, `-emit:payload:`, and the event
  switch in `CefModule.swift`.
- **Adding to `NNCore.h`:** implement it in `nncore_api.mm` (a new file goes in `BUILD.gn` `sources`); a new class
  must be named `NNCore*` to be exported (the `nncore.exports` wildcard). The pod reads `NNCore.h` from the repo and
  the staged framework may be older, so the app guards new selectors with `respondsToSelector:`.
- **Adding an engine call** (Chrome's services are `nn_*` C calls in `engine/chromium`, which the app finds with
  dlsym through `NNCoreEngineBridge`): (1) write `NN_ENGINE_CALL(nn_<domain>_<verb>)` in
  `engine/chromium/src/chrome/browser/netnyahoo/nn_<domain>.cc` (conventions in `public/nn_engine.h`; a new file goes
  in that `BUILD.gn`; `nn_engine.exports` exports every `nn_*`); (2) `scripts/agent/engine-build`; (3) call it with
  `NNCoreEngineBridge call:` (`callWithSecret:` for secrets), guarded by `exports:`; for JS's `engineCall`, add it to
  `NNCoreEngineCalls.swift`.
- **The page script** is `packages/nncore/ios/page_script.js`, a pod resource: `NNCoreHost.mm` hands it to the
  engine at launch and the renderer runs it in every http(s) and file frame. Changing it needs an app rebuild, not an
  engine one. Its `post(kind, json)` crosses the page channel to `-[NNCoreWebView tab:didReceivePageMessage:…]`,
  which handles it or emits `pageMessage` (JS `onPageMessage`).
- **CEF-era code** (removed in 6bdf66ce): `git show 6bdf66ce^:packages/cef/ios/<file>`. Comments citing
  `packages/cef/…` mean: `NNBrowserView.mm`, `NNClient.mm` → `NNCoreWebView.mm`; `NNChromeWindow.mm`,
  `NNPopupWindow.mm` → `NNCoreChromeWindow.mm`; `NNActivation`, `NNTabStrip`, `NNPictureInPicture`,
  `NNContentBlocker`, `NNEngineBridge` → `NNCore<same>.mm`; `NNPasswords`, `NNAutofill`, `NNZoom` →
  `NNCoreServices.mm`; `NNExtensions.mm` → `ExtensionsModule.swift`; `NNCef.mm` → `NNCoreHost.mm`,
  `NNCoreStartup.mm`; `NNEngine.mm` → `nncore_api.mm`; `helper/page_script.js` → `packages/nncore/ios/`;
  `packages/cef/src` → `packages/nncore/src`.

## Rules
- **Stay inside the files you own** (listed in your task). If you need a change elsewhere,
  make the smallest possible change, or describe it in your report instead. Other agents
  are editing other files right now; never revert or reformat code you don't own.
- **Commit your own work to `main`** (`git add -p` or explicit paths, only your hunks). Never commit another
  agent's work in progress. The index is shared, so a plain `git commit` sweeps in what others staged: commit
  with `git commit --only -- <paths>` (or check `git diff --cached --stat` lists only your files).
- **Never steal focus from the user.** They are working in other apps.
  - Launch the app only with `open -g` (never plain `open`, never `activate`) **and** with
    `NETNYAHOO_BACKGROUND=1`: `open -g` alone does not stop LaunchServices from making the app
    frontmost once its windows appear (this stole the user's keystrokes). With it the process is
    BackgroundOnly and every activation path is guarded (`packages/nncore/ios/NNCoreActivation.mm`); each
    attempt is logged to `$NETNYAHOO_DATA_DIR/activation.log`. `lsappinfo front` must never show
    your pid.
  - Any standalone test program or prototype window you create must be unable to take focus
    (NSApplicationActivationPolicyProhibited/accessory, non-activating panels).
  - Don't use computer-use / screen-control tools on the user's apps. Never click or type in
    Dia (it's a read-only reference). Don't read Dia's user data
    (`~/Library/Application Support/Dia`), nor any other browser's real profile data;
    use fixtures you create. Dia's app bundle (binary, assets) may be read.
- **Isolated builds/instances** (several agents build and run at once). Use your agent name `<you>`:
  - Build (in the background, `run_in_background`): `cd apps/browser && ../../scripts/agent/locked xcodebuild -- xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS -derivedDataPath build-<you> -destination 'platform=macOS,arch=arm64' -configuration Debug build 2>&1 | grep -E "error:|PhaseScriptExecution|\*\* BUILD"`.
    The build stages the engine framework under the chromium lock (`stage-framework.sh`): `--release` your chromium
    take first, or build with `locked xcodebuild --as <you>`. When several builds queue, pass `--wait 1500` (with
    `run_in_background`); `/tmp/nn-<name>.holder` says who holds a lock. Every `scripts/agent` script takes `--help`.
  - Run: `open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=/tmp/nn-<you> --env NETNYAHOO_REMOTE_DEBUGGING_PORT=<port> apps/browser/build-<you>/Build/Products/Debug/Netnyahoo.app`
    (`NETNYAHOO_DATA_DIR` isolates Chrome's and the app's data; each instance needs its own, and a Debug build
    refuses to start without one).
    Kill only your own instance (by PID), never `pkill Netnyahoo`.
  - Open a URL in your instance: CDP `Target.createTarget`, or the dev harness
    (`nn.actions.openUrls([url])`); `open -a` routes to whichever instance macOS picks.
  - Metro (JS dev server) is already running on :8081 and serves this working tree to every
    instance. Don't start another one and don't kill it. Consequences:
    - Every instance runs everyone's current JS, including instances built before your native
      change. JS doesn't guard for older builds: when JS starts needing native code that older builds
      lack (a module, function, view, event or field), bump `NATIVE_API_VERSION`
      (`apps/browser/src/nativeApi.tsx`) and `apiVersion` (`packages/shell/ios/AppModule.swift`)
      together. An instance built before then shows "Native API skew" in one window instead of the
      app, and its dev harness answers every script with that error: rebuild it.
    - A JS exception while modules load (an import cycle, say) opens LogBox, which crashes
      react-native-macos (`RCTView didUpdateShadow`), so every instance dies at launch. Run
      `pnpm -w typecheck` and relaunch your instance after risky import changes.
    - Fast Refresh doesn't always apply (and has crashed Hermes' debugger). Relaunch your instance
      before judging a change.
  - `pod install` (after adding/removing native source files, changing a podspec, or adding native
    packages) must hold the shared lock: `scripts/agent/locked pod -- sh -c 'cd apps/browser/macos &&
    LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install'`.
    Same lock for `pnpm install` and edits to apps/browser/package.json. A new Expo module in an
    existing source file only needs its `expo-module.config.json` entry (the build regenerates
    the module provider).
- **Shared files** several agents must touch — `packages/shell/ios/Menus.swift`,
  `apps/browser/src/lib/commands.ts`, `apps/browser/src/App.tsx`, `apps/browser/src/store/settings.ts`,
  `apps/browser/src/lib/theme.ts`, `packages/nncore/ios/NNCoreInternal.h`, `packages/nncore/ios/NetnyahooNNCore.podspec`,
  `packages/nncore/ios/NNCoreWebView.mm`, `packages/nncore/scripts/acceptance.mjs`, NNCore's `public/NNCore.h`,
  `nncore_api.mm` and `nn_browser*.mm`, the `expo-module.config.json` files: re-read right before each edit, keep
  edits small and additive (add your case/item/field; don't restructure), and never undo someone else's lines.
  Native files there compile into everyone's build: check one pod with `scripts/agent/typecheck-pod <Pod>` before saving more.
- The store API is documented in `docs/store-api.md` (read it before touching app state).
- Tests, test-instance variables and what background mode changes: `docs/testing.md`. Benchmarks and the perf gate:
  `docs/perf/README.md`.
- The Bash tool runs zsh: quote globs (`--include='*.mm'`, `'/tmp/nn-*.holder'`) or use `git grep -n PAT -- '*.mm'`.
- **Verify before reporting done.** At minimum: `pnpm -w typecheck` (or `npx tsc -p <pkg>`)
  passes for what you touched, the app builds, and you exercised the feature in a running
  instance.
  - Drive the app through the dev harness: write a script to `$NETNYAHOO_DATA_DIR/dev-eval.js`
    (first line `// <id>`, body returns a value or promise; no top-level `await`) and read
    `dev-eval-result.json`, waiting with `scripts/agent/await --timeout 60 --pid <app pid> -- grep -q
    '"id":"<id>"' "$NETNYAHOO_DATA_DIR/dev-eval-result.json"` so a crashed instance fails at once. `nn` = store, actions, runCommand, webviews, shell, …
    (`lib/devHarness.ts`); Expo modules are on `globalThis.expo.modules`. `nn.runCommand` takes an object:
    `nn.runCommand({ command: "importBrowserData", arg: null, windowId: null })`; the utility windows' ids are
    `"settings"` and `"import"`.
  - The NNCore acceptance run (`docs/nncore-parity.md` › "How to build and check it"): `METRO_PORT=8081 node
    packages/nncore/scripts/acceptance.mjs <Debug app> <scratch dir> [check…]`.
  - Camera and microphone: a hidden instance captures only from Chrome's fake devices (`docs/testing.md`). Run
    capture tests on a copy without the device entitlements (ad hoc, hardened runtime), so macOS refuses a real
    device without asking (acceptance.mjs's media checks make one): on 2026-10-01 a Debug build's microphone stream
    raised macOS's consent dialog on the owner's screen.
  - Keyboard shortcuts: `nn.shell.devKeyEquivalent(windowId, { key, keyCode, modifiers, focus, asKey })` presses a
    key as AppKit dispatches it (Chrome's window, then the menu bar; a test instance never has the key window), and
    `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` checks every shortcut in every focus.
  - Page content: CDP (`--env NETNYAHOO_REMOTE_DEBUGGING_PORT`, then `http://localhost:<port>/json`,
    `Runtime.evaluate`, `Page.captureScreenshot`). A `NETNYAHOO_BACKGROUND` instance's windows answer NO to
    `-[NSWindow isOccluded]` (`NNCoreHost.mm`), so a covered window shows a tab at once instead of after Chrome's 1 s
    occlusion delay; set `NETNYAHOO_ALLOW_OCCLUSION=1` to test occlusion itself.
  - Native UI: `screencapture -l <windowID>` while nothing covers the window (find the id with CGWindowList by owner
    PID). Wrap every capture in `timeout 20`: with the screen locked they can hang instead of failing.
    For the New Tab intro, launch with `NETNYAHOO_SHADERS_FORCE_KEY=1` (it only plays in a key window).
  - The user's screen may be locked: screen captures then fail or deliver no frames. Fall back to
    `nn.shell.devSnapshotWindow(windowId, path)` (`false` means it failed; the window's layers at 2x; Metal views
    render blank; text opacity is applied twice, so a label at α reads 1 − (1 − α)², don't match colours on it),
    `globalThis.expo.modules.NetnyahooAreaLight.debugSnapshot(dir)` (every Metal view, offscreen, with its frame),
    the accessibility tree and store state, and list "needs visual check" items in your report.
- Code style: read the surrounding code first and match it — naming, comment density
  (short "why" comments, no noise), idioms. Keep files cohesive; new features go in new
  files where sensible.
- Dia fidelity: when you build UI, match Dia, and check it with numbers against a Dia capture
  (same crop, same state) before calling it a match (`docs/dia-spec.md`, `docs/dia-feature-parity.md`).

## Report format (your final message)
1. What you built (bullets, user-visible terms first).
2. Files created/changed.
3. How you verified it (commands + results).
4. Anything unfinished, known bugs, or changes you need from other areas (pod install,
   files owned by others, integration points, a new engine framework).

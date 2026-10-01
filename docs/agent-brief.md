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
      native modules keep their names (`NetnyahooCEF`, `NetnyahooExtensions`, `NetnyahooSwipe`,
      `NetnyahooChromeUI`).
  - `packages/shell`: menus, shortcuts, windows, native primitives (Surface, Symbol, FadeLabel,
    VisualEffect, WindowDragRegion, ContextMenuArea, ActivitySpinner…).
  - `packages/shaders`: Metal views (window backdrop, New Tab effects). Don't touch unless assigned.
  - `packages/import`: importing from other browsers (bookmarks, history, passwords, Arc spaces).
  - `packages/core`: pure TS (omnibox parsing, suggestions) with tests.
- react-native-macos quirks: RN shadow props crash → use `Surface` for shadows; RCTView resets
  layer props → draw in sublayers; native views must size subviews in `setFrameSize`.
- **Patched dependencies** live in `patches/` and are listed under `patchedDependencies` in
  `pnpm-workspace.yaml` (pnpm 11 reads them there); every `pnpm install` applies them, and the Podfile
  (`macos`) compiles React from `node_modules`, so a rebuild picks a change up (`pod install`
  only if a patch adds or removes files). To change one: `pnpm patch <pkg>@<version> --edit-dir <scratch dir>`,
  edit there, then `scripts/agent/locked pod -- pnpm patch-commit <scratch dir>`, and read the new `.patch`:
  pnpm can add bogus `deleted file` entries (drop them and run `pnpm install` again under the same lock).
  Mark edits `[Netnyahoo: … Netnyahoo]`. Current patches:
  - `react-native-macos`: a view's `transform` survives AppKit laying it out (it reset the layer's
    transform on every frame change, so a view resting at a non-zero translate, rotate or scale drew
    untransformed), and applies from the view's centre as on iOS.
  - `react-native-macos`: RCTTiming leaves the display link only while the app is hidden (upstream's macOS check
    was inverted, so every visible launch ran timers off one-shot NSTimers: requestAnimationFrame at ~1000/s),
    tracks hide/unhide, and lets the display link sleep when the next timer is over two frames away (c7ebd600).
  - `expo-modules-core`: the JS runtime is prepared on the JS thread only (a startup race, 364f5f7e).

## The engine
- NNCore is built outside the repo in `~/chromium-build` (the tree and its patches: `engine/patches`,
  `docs/cef-source-build.md` › "Rebuilding"; `engine/chromium/apply.sh` and `engine/nncore/apply.sh` copy our code in).
  The app's build stages a copy of `out/Release_GN_arm64/Chromium Framework.framework`
  (`packages/nncore/scripts/stage-framework.sh`, into `apps/browser/build-nncore/NNCoreFramework`, or
  `NNCORE_STAGE_DIR`), links it and embeds it (`embed.sh`), so every agent's next build picks up a new framework.
- One agent at a time edits or builds `~/chromium-build`: hold the chromium lock for the whole edit → build cycle
  (`scripts/agent/locked chromium --take <you>`, then each command as `scripts/agent/locked chromium --as <you> --
  …`, and `--release <you>` at the end; an unreleased take expires after 60 min, so renew it by running commands
  with `--as`). Builds are incremental only:
  `scripts/agent/locked chromium -- autoninja -C out/Release_GN_arm64 chrome_framework`. A new framework changes
  every agent's next build, so say so in your report. To try one privately, build the app with
  `NNCORE_FRAMEWORK=<framework> …/locked xcodebuild -- xcodebuild … NNCORE_STAGE_DIR=<dir>` (the framework from the
  environment, the stage dir as a build setting).
- New engine code goes in `//chrome/browser/netnyahoo` (`engine/chromium/src`) or `//netnyahoo/core`
  (`engine/nncore/src`), never straight into the tree (`docs/cef-source-build.md` › "Our own code in the tree").
  `engine/patches/series` is the apply order of our patches to Chromium; `engine/patches/series.py check` proves the
  series reproduces the tree. CEF's own patches (`cef-*.patch`) stay in the tree until the next Chromium bump.

## Rules
- **Stay inside the files you own** (listed in your task). If you need a change elsewhere,
  make the smallest possible change, or describe it in your report instead. Other agents
  are editing other files right now; never revert or reformat code you don't own.
- **Commit your own work to `main`** (`git add -p` or explicit paths, only your hunks; trailer in
  `AGENTS.md`). Never commit another agent's work in progress.
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
  - Build (in the background, `run_in_background`): `cd apps/browser && ../../scripts/agent/locked xcodebuild -- xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS -derivedDataPath build-<you> -destination 'platform=macOS,arch=arm64' -configuration Debug build 2>&1 | grep -E "error:|\*\* BUILD"`
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
  the `expo-module.config.json` files: re-read right before each edit, keep edits small and additive
  (add your case/item/field; don't restructure), and never undo someone else's lines.
- The store API is documented in `docs/store-api.md` (read it before touching app state).
- **Verify before reporting done.** At minimum: `pnpm -w typecheck` (or `npx tsc -p <pkg>`)
  passes for what you touched, the app builds, and you exercised the feature in a running
  instance.
  - Drive the app through the dev harness: write a script to `$NETNYAHOO_DATA_DIR/dev-eval.js`
    (first line `// <id>`, body returns a value or promise; no top-level `await`) and read
    `dev-eval-result.json`, waiting with `scripts/agent/await --timeout 60 --pid <app pid> -- grep -q
    '"id":"<id>"' "$NETNYAHOO_DATA_DIR/dev-eval-result.json"` so a crashed instance fails at once. `nn` = store, actions, runCommand, webviews, shell, … (`lib/devHarness.ts`);
    Expo modules are on `globalThis.expo.modules` (e.g. `NetnyahooCEF`, NNCore's module under its old name).
  - The NNCore acceptance run (`docs/nncore-parity.md` › "Acceptance"): `METRO_PORT=8081 node
    packages/nncore/scripts/acceptance.mjs <Debug app> <scratch dir> [check…]`.
  - Camera and microphone: a hidden instance captures only from Chrome's fake devices (NNCoreHost passes
    `--use-fake-device-for-media-stream` and drops Chrome's auto-accept capture switches; the engine keeps the
    microphone on a fake input, `nn_fake_media.mm`). Run capture tests on a copy without the device entitlements
    (ad hoc, hardened runtime), so macOS refuses a real device without asking: acceptance.mjs's media checks make one.
    On 2026-10-01 a Debug build's microphone stream raised macOS's consent dialog on the owner's screen.
  - Keyboard shortcuts: `nn.shell.devKeyEquivalent(windowId, { key, keyCode, modifiers, focus, asKey })` presses a
    key as AppKit dispatches it (Chrome's window, then the menu bar; a test instance never has the key window), and
    `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` checks every shortcut in every focus.
  - Page content: CDP (`--env NETNYAHOO_REMOTE_DEBUGGING_PORT`, then `http://localhost:<port>/json`,
    `Runtime.evaluate`, `Page.captureScreenshot`). A `NETNYAHOO_BACKGROUND` instance keeps painting while covered or with the screen
    locked (`--disable-backgrounding-occluded-windows`); set `NETNYAHOO_ALLOW_OCCLUSION=1` to test occlusion itself.
  - Native UI: the ScreenCaptureKit recorder in the scratchpad folder (`sckrec <windowID> <secs>
    <outDir> x y w h scale`) records one window even when it's covered; find the window id with
    CGWindowList by owner PID. `screencapture -l <windowID>` works too while nothing covers it. Wrap
    every capture in `timeout 20`: with the screen locked they can hang instead of failing.
    For the New Tab intro, launch with `NETNYAHOO_SHADERS_FORCE_KEY=1` (it only plays in a key window).
  - The user's screen may be locked: screen captures then fail or deliver no frames. Fall back to
    `nn.shell.devSnapshotWindow(windowId, path)` (the window's layers at 2x; Metal views render
    blank; text opacity is applied twice, so a label at α reads 1 − (1 − α)², don't match colours on it), `globalThis.expo.modules.NetnyahooAreaLight.debugSnapshot(dir)` (every Metal view,
    offscreen, with its frame), the accessibility tree and store state, and list "needs visual
    check" items in your report.
  - Ready-made helpers (Node 22, no deps) in the scratchpad folder below: `cdp.mjs <expr> [pageIndex]`
    (Runtime.evaluate) and `cdpshot.mjs <out.png> [urlSubstring]` — they hard-code port 9222,
    so copy them and change the port.
- Code style: read the surrounding code first and match it — naming, comment density
  (short "why" comments, no noise), idioms. Keep files cohesive; new features go in new
  files where sensible.
- Dia fidelity: when you build UI, match Dia, and check it with numbers against a Dia capture
  (same crop, same state) before calling it a match. Useful references: `docs/dia-spec.md`,
  `docs/dia-feature-parity.md`, and Dia's UI strings extracted from its binary at
  `/private/tmp/claude-501/-Users-barreloflube-Documents-netnyahoo/a6e87140-35e6-4a65-85e0-018a5c019c75/scratchpad/ui.txt`
  (and `kebab.txt` for feature-flag names). The changelog text is in `changelog.txt` in the
  same folder. Binary analysis of Dia 1.50.1 (disassembly, symbol names, constants) is in
  `sunglow/ba-chrome/` there (`ann2.py <start> <end>` annotates a range, `where.py <float>` finds
  a constant's functions).

## Report format (your final message)
1. What you built (bullets, user-visible terms first).
2. Files created/changed.
3. How you verified it (commands + results).
4. Anything unfinished, known bugs, or changes you need from other areas (pod install,
   files owned by others, integration points, a new engine framework).

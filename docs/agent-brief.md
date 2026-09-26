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
  - `packages/cef`: the web engine — **our own patched build of CEF 154** (154.0.28, Chrome style,
    `docs/cef-source-build.md`).
    - **Every app window is Chrome's own Browser window** (a Chrome-style `CefWindow` with
      `CefBrowserSettings.client_window`), with our React root laid over Chrome's views inside its
      content view (`NNChromeWindow`, `NNWindowHost`; `docs/research/chrome-hosted-window.md`). Chrome's
      tab strip and toolbar are off; its dialogs, bubbles, menus and autofill dropdowns are child windows
      of the app window, so they show over it with no special cases.
    - **One Chrome window per profile**: a window that pages between profiles is a group of Chrome
      windows, and our root moves to the one of the profile shown (`NETNYAHOO_PROFILE_SWAP`, default
      "transparent"). In full screen, another profile's window shows over the full-screen one.
    - Every tab is a real Chrome tab of its window's Browser; its view is hosted in our React Native
      views (`NNBrowserView`). Sized popups get a Chrome window of their own (`NNPopupWindow`).
    - Alloy is used only for extension popups and side panels, PiP windows, and hidden helper pages
      (Chrome's WebUI settings pages that `NNPasswords`, `NNAutofill`, `NNExtensions`… drive, in
      `NNChromePages`).
    - JS API in `packages/cef/src` (`WebView`, downloads, permissions, profiles, extensions, Chrome UI).
      `NN_CHROME_TABS` (`NNCefInternal.h`, default 1) selects all this; `NN_CHROME_TABS=0` is the build
      against stock CEF (below), with plain app windows and Alloy tabs.
  - `packages/shell`: menus, shortcuts, windows, native primitives (Surface, Symbol, FadeLabel,
    VisualEffect, WindowDragRegion, ContextMenuArea, ActivitySpinner…).
  - `packages/shaders`: Metal views (window backdrop, New Tab effects). Don't touch unless assigned.
  - `packages/import`: importing from other browsers (bookmarks, history, passwords, Arc spaces).
  - `packages/core`: pure TS (omnibox parsing, suggestions) with tests.
- react-native-macos quirks: RN shadow props crash → use `Surface` for shadows; RCTView resets
  layer props → draw in sublayers; native views must size subviews in `setFrameSize`.

## The engine
- The CEF distribution is built outside the repo in `~/chromium-build` from the patches in
  `packages/cef/patches/` (`docs/cef-source-build.md` › "Rebuilding"; first build about 2 h,
  incremental 20 s–2 min). `packages/cef/scripts/setup.sh` copies it into `packages/cef/vendor/cef`,
  which every agent's build uses.
- One agent at a time edits or builds `~/chromium-build`: hold `/tmp/nn-chromium.lock` (same
  `mkdir` pattern as the pod lock below) for the whole edit → build → `setup.sh` cycle. A new
  distribution changes every agent's next build, so say so in your report. To try an engine
  change privately, install it elsewhere (`CEF_DIST=<dist> CEF_ROOT=<dir> setup.sh`) and build with
  `xcodebuild … NN_CEF_ROOT=<dir>`.
- Engine APIs our patches add are marked in `include/cef_netnyahoo.h` (`CEF_NN_*`), and
  `NNCefInternal.h` turns each feature on only when its marker exists. Code that needs a new hook
  must compile without it, behind its marker.
- Without `~/chromium-build` (a fresh checkout): `CEF_PREBUILT=1 packages/cef/scripts/setup.sh`
  installs the stock prebuilt, and the app builds with the `NN_CHROME_TABS=0` build setting. It
  loses everything the patches add.

## Rules
- **Stay inside the files you own** (listed in your task). If you need a change elsewhere,
  make the smallest possible change, or describe it in your report instead. Other agents
  are editing other files right now; never revert or reformat code you don't own.
- **No git commits.** The repo has history (GitHub `origin`), but agents leave all changes
  uncommitted for the user to review.
- **Never steal focus from the user.** They are working in other apps.
  - Launch the app only with `open -g` (never plain `open`, never `activate`) **and** with
    `NETNYAHOO_BACKGROUND=1`: `open -g` alone does not stop LaunchServices from making the app
    frontmost once its windows appear (this stole the user's keystrokes). With it the process is
    BackgroundOnly and every activation path is guarded (`packages/cef/ios/NNActivation.mm`); each
    attempt is logged to `$NETNYAHOO_DATA_DIR/activation.log`. `lsappinfo front` must never show
    your pid.
  - Any standalone test program or prototype window you create must be unable to take focus
    (NSApplicationActivationPolicyProhibited/accessory, non-activating panels).
  - Don't use computer-use / screen-control tools on the user's apps. Never click or type in
    Dia (it's a read-only reference). Don't read Dia's user data
    (`~/Library/Application Support/Dia`), nor any other browser's real profile data;
    use fixtures you create. Dia's app bundle (binary, assets) may be read.
- **Isolated builds/instances** (several agents build and run at once). Use your agent name `<you>`:
  - Build: `cd apps/browser && xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS -derivedDataPath build-<you> -destination 'platform=macOS,arch=arm64' -configuration Debug build 2>&1 | grep -E "error:|\*\* BUILD"`
  - Run: `open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=/tmp/nn-<you> --env NETNYAHOO_REMOTE_DEBUGGING_PORT=<port> apps/browser/build-<you>/Build/Products/Debug/Netnyahoo.app`
    (`NETNYAHOO_DATA_DIR` isolates CEF + session data; each instance needs its own).
    Kill only your own instance (by PID), never `pkill Netnyahoo`.
  - Open a URL in your instance: CDP `Target.createTarget`, or the dev harness
    (`nn.actions.openUrls([url])`); `open -a` routes to whichever instance macOS picks.
  - Metro (JS dev server) is already running on :8081 and serves this working tree to every
    instance. Don't start another one and don't kill it. Consequences:
    - Every instance runs everyone's current JS, including instances built before your native
      change. Guard JS that needs a new native module or view (`requireOptionalNativeModule`, as
      `ActivitySpinner` in `packages/shell/src/index.tsx` does).
    - A JS exception while modules load (an import cycle, say) opens LogBox, which crashes
      react-native-macos (`RCTView didUpdateShadow`), so every instance dies at launch. Run
      `pnpm -w typecheck` and relaunch your instance after risky import changes.
    - Fast Refresh doesn't always apply (and has crashed Hermes' debugger). Relaunch your instance
      before judging a change.
  - `pod install` (after adding/removing native source files, changing a podspec, or adding native
    packages) must hold the shared lock: `until mkdir /tmp/nn-pod.lock 2>/dev/null; do sleep 5; done;
    (cd apps/browser/macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install); rmdir /tmp/nn-pod.lock`.
    Same lock for `pnpm install` and edits to apps/browser/package.json. A new Expo module in an
    existing source file only needs its `expo-module.config.json` entry (the build regenerates
    the module provider).
- **Shared files** several agents must touch — `packages/shell/ios/Menus.swift`,
  `apps/browser/src/lib/commands.ts`, `apps/browser/src/App.tsx`, `apps/browser/src/store/settings.ts`,
  `apps/browser/src/lib/theme.ts`, `packages/cef/ios/NNCefInternal.h`, `packages/cef/ios/NetnyahooCEF.podspec`,
  the `expo-module.config.json` files: re-read right before each edit, keep edits small and additive
  (add your case/item/field; don't restructure), and never undo someone else's lines.
- The store API is documented in `docs/store-api.md` (read it before touching app state).
- **Verify before reporting done.** At minimum: `pnpm -w typecheck` (or `npx tsc -p <pkg>`)
  passes for what you touched, the app builds, and you exercised the feature in a running
  instance.
  - Drive the app through the dev harness: write a script to `$NETNYAHOO_DATA_DIR/dev-eval.js`
    (first line `// <id>`, body returns a value or promise; no top-level `await`) and read
    `dev-eval-result.json`. `nn` = store, actions, runCommand, webviews, shell, … (`lib/devHarness.ts`);
    Expo modules are on `globalThis.expo.modules` (e.g. `NetnyahooCEF`).
  - Page content: CDP (`--env NETNYAHOO_REMOTE_DEBUGGING_PORT`, then `http://localhost:<port>/json`,
    `Runtime.evaluate`, `Page.captureScreenshot`). Chromium doesn't paint fully occluded windows.
  - Native UI: the ScreenCaptureKit recorder in the scratchpad folder (`sckrec <windowID> <secs>
    <outDir> x y w h scale`) records one window even when it's covered; find the window id with
    CGWindowList by owner PID. `screencapture -l <windowID>` works too while nothing covers it.
    For the New Tab intro, launch with `NETNYAHOO_SHADERS_FORCE_KEY=1` (it only plays in a key window).
  - The user's screen may be locked: screen captures then fail or deliver no frames. Fall back to
    `nn.shell.devSnapshotWindow(windowId, path)` (the window's layers at 2x; Metal views render
    blank), `globalThis.expo.modules.NetnyahooAreaLight.debugSnapshot(dir)` (every Metal view,
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
   files owned by others, integration points, a new CEF distribution).

# Agent brief (read first)

You are one of several engineers working **in parallel in the same working tree** on
Netnyahoo, a macOS browser that must reach **full feature and visual parity with Dia**
(The Browser Company). The feature checklist is `docs/dia-feature-parity.md`; the
visual spec (colors, sizes, animations recovered from Dia's binary) is `docs/dia-spec.md`.
The user is demanding: no sloppy work, every hover state/animation/detail matters.

## Stack
- Turborepo + pnpm (hoisted `node_modules` at the repo root).
- `apps/browser`: Expo SDK 54 + react-native-macos 0.81 (Legacy architecture), zustand store,
  inline styles (NativeWind is set up but unused — match the existing inline style idiom).
- Native code lives in Expo modules under `packages/*/ios` (Swift / Objective-C++):
  - `packages/cef`: the web engine — Chromium Embedded Framework 154 (Alloy-style child
    views). JS API in `packages/cef/src` (`WebView`, downloads, permissions, profiles).
  - `packages/shell`: menus, shortcuts, native primitives (Surface, Symbol, FadeLabel,
    VisualEffect, WindowDragRegion, ContextMenuArea…).
  - `packages/shaders`: Metal views (New Tab page effects). Don't touch unless assigned.
  - `packages/core`: pure TS (omnibox parsing, suggestions) with tests.
  - `packages/webkit`: **dead** (replaced by CEF). Don't use or edit it.
- react-native-macos quirks: RN shadow props crash → use `Surface` for shadows; RCTView
  resets layer props → draw in sublayers; native views must size subviews in `setFrameSize`.

## Rules
- **Stay inside the files you own** (listed in your task). If you need a change elsewhere,
  make the smallest possible change, or describe it in your report instead. Other agents
  are editing other files right now; never revert or reformat code you don't own.
- **No git commits.** The repo has none; leave all changes uncommitted.
- **Never steal focus from the user.** They are working in other apps.
  - Launch the app only with `open -g` (never plain `open`, never `activate`).
  - Any standalone test program or prototype window you create must be unable to take focus
    (NSApplicationActivationPolicyProhibited/accessory, non-activating panels): a previous test
    window captured the user's keystrokes.
  - Don't use computer-use / screen-control tools on the user's apps. Never click or type in
    Dia (it's a read-only reference). Don't read Dia's user data
    (`~/Library/Application Support/Dia`), nor any other browser's real profile data;
    use fixtures you create.
- **Isolated builds/instances** (several agents build and run at once). Use your agent name `<you>`:
  - Build: `cd apps/browser && xcodebuild -workspace macos/Netnyahoo.xcworkspace -scheme Netnyahoo-macOS -derivedDataPath build-<you> -destination 'platform=macOS,arch=arm64' -configuration Debug build 2>&1 | grep -E "error:|\*\* BUILD"`
  - Run: `open -g -n --env NETNYAHOO_BACKGROUND=1 --env NETNYAHOO_DATA_DIR=/tmp/nn-<you> --env NETNYAHOO_REMOTE_DEBUGGING_PORT=<port> apps/browser/build-<you>/Build/Products/Debug/Netnyahoo.app`
    **`NETNYAHOO_BACKGROUND=1` is mandatory**: `open -g` alone does not stop LaunchServices from making the app
    frontmost once its windows appear (this stole the user's keystrokes). With it the process is BackgroundOnly and
    can't activate (packages/cef/ios/NNActivation.mm); check `$NETNYAHOO_DATA_DIR/activation.log` if in doubt.
    (`NETNYAHOO_DATA_DIR` isolates CEF + session data; each instance needs its own).
    Kill only your own instance (by PID), never `pkill Netnyahoo`.
  - Open a URL in your instance: easiest via CDP `Target.createTarget` or the app's own UI;
    `open -a` routes to whichever instance macOS picks, so avoid it when others run.
  - Metro (JS dev server) is already running on :8081 and serves this working tree to every
    instance. Don't start another one and don't kill it.
  - `pod install` (needed after adding/removing native source files or native packages) must
    hold the shared lock: `until mkdir /tmp/nn-pod.lock 2>/dev/null; do sleep 5; done;
    (cd apps/browser/macos && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install); rmdir /tmp/nn-pod.lock`.
    Same lock for `pnpm install` and edits to apps/browser/package.json.
- **Shared files** several agents must touch — `packages/shell/ios/Menus.swift`,
  `apps/browser/src/lib/commands.ts`, `apps/browser/src/App.tsx`, `apps/browser/src/store/settings.ts`,
  `apps/browser/src/lib/theme.ts`: re-read right before each edit, keep edits small and additive
  (add your case/item/field; don't restructure), and never undo someone else's lines.
- The store API is documented in `docs/store-api.md` (read it before touching app state).
- The user's screen may be locked: `screencapture` then fails. Fall back to the accessibility
  tree, CDP, and store state (lib/devHarness.ts), and list "needs visual check" items in your report.
- **Verify before reporting done.** At minimum: `pnpm -w typecheck` (or `npx tsc -p <pkg>`)
  passes for what you touched, the app builds, and you exercised the feature in a running
  instance. Page content: CDP (`--env NETNYAHOO_REMOTE_DEBUGGING_PORT`, then
  `http://localhost:<port>/json`, `Runtime.evaluate`, `Page.captureScreenshot`). Native UI:
  `screencapture -x -o -l <windowID>` (find the window id with CGWindowList by owner PID).
  Chromium doesn't paint fully-occluded windows, so page pixels come from CDP screenshots.
  Ready-made helpers (Node 22, no deps) in the scratchpad folder below: `cdp.mjs <expr> [pageIndex]`
  (Runtime.evaluate) and `cdpshot.mjs <out.png> [urlSubstring]` — they hard-code port 9222,
  so copy them and change the port.
- Code style: read the surrounding code first and match it — naming, comment density
  (short "why" comments, no noise), idioms. Keep files cohesive; new features go in new
  files where sensible.
- Dia fidelity: when you build UI, match Dia. Useful references: `docs/dia-spec.md`,
  `docs/dia-feature-parity.md`, and Dia's UI strings extracted from its binary at
  `/private/tmp/claude-501/-Users-barreloflube-Documents-netnyahoo/a6e87140-35e6-4a65-85e0-018a5c019c75/scratchpad/ui.txt`
  (and `kebab.txt` for feature-flag names). The changelog text is in `changelog.txt` in the
  same folder.

## Report format (your final message)
1. What you built (bullets, user-visible terms first).
2. Files created/changed.
3. How you verified it (commands + results).
4. Anything unfinished, known bugs, or changes you need from other areas (pod install,
   files owned by others, integration points).

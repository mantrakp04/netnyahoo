# Testing

`pnpm test` at the root runs every unit test (126 cases). Turbo caches the results; a cold run spends most
of its time in `swift test`'s first build. Each package also runs its own:

| Package | Command | Cases |
| --- | --- | --- |
| `apps/browser` | `pnpm --filter @arcadia/browser test` | 72 |
| `packages/core` | `pnpm --filter @arcadia/core test` | 14 |
| `packages/sync` | `pnpm --filter @arcadia/sync test` (`swift test`, then `node --test`) | 5 + 8 |
| `packages/import` | `pnpm --filter @arcadia/import test` (`swift test`) | 26 |
| `extras/raycast-arcadia` | `node --test extras/raycast-arcadia/src/scripts.test.ts` | 1 |

`apps/browser` runs its TypeScript under plain Node: `src/test-loader.mjs` maps `@arcadia/shell`,
`@arcadia/arcadiacore` and `expo-modules-core` to `src/test-native-stub.mjs`. One file:
`node --no-warnings --import ./src/test-loader.mjs --test src/store/tabs.test.mjs` (from `apps/browser`).

End-to-end checks need a built app and are run by hand. Each runs hidden instances through `scripts/lib/instance.mjs`
and prints one line per check (PASS/FAIL, ms), a failure's first lines, then a summary with the path of the log that
holds the rest.

| Check | Run | Guards |
| --- | --- | --- |
| Release smoke test | `.claude/skills/release/scripts/smoke.sh` (the `release` skill) | Every release, whole |
| Shortcuts | `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` | Every shortcut in every focus (0.2.8: ⌘1–9 were swallowed outside a page) |
| Profile swipes | `node apps/browser/scripts/profile-swipe-test.mjs <Debug app>` | The native pager's races (0.2.14–0.2.18 fixes) |
| Tab dragging | `node apps/browser/scripts/tab-drag-test.mjs <Debug app>` | Dragging in the top tab strip moves the tab, never the window (0.2.18); the empty strip moves it over its whole height and a double-click zooms (0.2.25) |
| Windowing | `node apps/browser/scripts/windowing-test.mjs <Debug app>` | Window frames and what the screen shows in passing |
| ⌘-scroll | `node apps/browser/scripts/zoom-scroll-test.mjs <Debug app>` | Trackpad scrolls, mouse zooms (regressed in 0.1.4 and 0.2.12) |
| Hover layout | `node apps/browser/scripts/hover-shift-test.mjs <Debug app>` | Hovering moves nothing: every hover-tracked view in the sidebar, the tab strip and the downloads popover (below) |
| Sync | `node packages/sync/scripts/e2e.mjs <Debug app>` | Two and three hidden instances through one folder (`docs/sync.md`) |
| Import | `node packages/import/scripts/e2e.mjs <Debug app> <scratch dir>` | Cookies, addresses and cards from a fake Chrome home (`packages/import/README.md`) |
| Engine patches | `python3 engine/patches/series.py check` | The patch series reproduces the Chromium tree (`docs/engine-build.md`) |
| Engine (ArcadiaCore) | `node packages/arcadiacore/scripts/acceptance.mjs <Debug app> <scratch dir> [--keep] [check…]` | The app on ArcadiaCore, hidden (`docs/arcadiacore-parity.md`). `--keep` leaves the instance up and `--attach <scratch dir> [check…]` re-runs checks on it in seconds; `--list` gives each check's section and what it needs (brought along automatically) |
| Focus (ArcadiaCore) | `node packages/arcadiacore/scripts/activation-acceptance.mjs <Debug app> <scratch dir> [check…]` | The panes shown, Chrome's active tab and native focus agree |
| Native perf | `node apps/browser/scripts/perf/native-bench.mjs --app <Release app> --out <dir>` | Launch, idle, memory, tab and window latency; the release perf gate (`docs/perf/README.md`) |
| JS perf | `node apps/browser/scripts/perf/js-bench.mjs run --app <Release app> --bundle <main.jsbundle> --label <name>` | What each interaction costs the JS thread (`docs/perf/README.md`) |

## Test instances

Launch with `scripts/agent/ac launch <app> --data <dir> [--env NAME=value]…` (`--help`; then `ac eval`, `ac page`,
`ac quit`), or `launch()` in `scripts/lib/instance.mjs`. `ARCADIA_BACKGROUND=1` and a scratch `ARCADIA_DATA_DIR`
make an instance a test instance; the rest are hooks for one test.

| Variable | Read in | What it does |
| --- | --- | --- |
| `ARCADIA_BACKGROUND=1` | everywhere (below) | A hidden test instance (below) |
| `ARCADIA_DATA_DIR` | `ArcadiaCoreHost.mm`, `packages/shell` `ACIsolation.m` | Scratch data dir (below). A Debug build refuses to start without one |
| `ARCADIA_REMOTE_DEBUGGING_PORT` | `ArcadiaCoreHost.mm` | CDP on that port (`--remote-allow-origins=*`) |
| `ARCADIA_JS_LOCATION=host:port` | `AppDelegate.swift` | This launch's Metro, never written to defaults |
| `ARCADIA_CHROMIUM_SWITCHES` | `ArcadiaCoreHost.mm` | Extra Chrome switches, space-separated (background mode drops the auto-accept capture ones) |
| `ARCADIA_ALLOW_OCCLUSION=1` | `ArcadiaCoreHost.mm` | Background mode keeps Chrome's occlusion |
| `ARCADIA_ALLOW_AUDIO=1` | `ArcadiaCoreHost.mm`, `IntroMusic.swift` | Background mode keeps sound |
| `ARCADIA_DOWNLOADS_DIR` | engine `ac_downloads.cc` | Chrome's download folder |
| `ARCADIA_TEST_REAUTH=granted` | engine `ac_reauth.cc` | Background mode grants macOS re-auth requests (otherwise refused, each reported as `reauth.requested`) |
| `ARCADIA_CONTEXT_MENU_LOG` | engine `ac_context_menu.mm` | Context menus go to the host instead of the screen, in any build; the pick runs on the model that owns it, logged as `[arcadiacore-menu]` in the system log |
| `ARCADIA_FAKE_FULLSCREEN_MS` | `ArcadiaCoreChromeWindow.mm` | Length of the acted-out full-screen transition (the window takes the screen's frame as it starts and its old frame back on the way out, as AppKit does). Dev actions (`devWindow`): `fakeFullScreen:<1\|0>[:<ms>]`, `fakeFullScreenMs:<ms>`, `fakeOcclusion:<visible\|occluded\|off>` (macOS's occlusion state; a test window otherwise counts as seen), `fakeFullScreenOcclusionMs:<ms>` (acted transitions occlude the window, visible again `<ms>` after they end, as a real Space animation), `pageCover:<1\|0>` (the page's picture over it through transitions, `ACPageCover`; 0 is 0.2.30's behaviour), `fullScreenProbe:<ms>` then `fullScreenProbe` (per display frame, what an in-process render of the window, all AppKit's transition shows, has in the page's place: an 8 × 6 colour grid, uniformity, covers; acceptance `fullscreen-transition-picture`) |
| `ARCADIA_TRAFFIC_LIGHTS_LOG=<file>` | `ArcadiaCoreChromeWindow.mm` | Logs every traffic-light change (test instances only) |
| `ARCADIA_PIP_SELFTEST` | `ArcadiaCorePictureInPicture.mm` | On the first PiP window: `close` / `backToTab` click Chrome's buttons (`pip-button-selftest.json`: closed, the prevents-activation tag, app activations), `hover` holds the controls up (`pip-hover.json`, `ARCADIA_PIP_HOVER=close\|back`), anything else runs the style self-test (`pip-selftest.json`), all in the data dir |
| `ARCADIA_TRACE_PIP=1` | engine `ac_picture_in_picture.mm` | PiP windows opening and closing, to `/tmp/ac-pip-trace.log` |
| `ARCADIA_TRACE_VISIBILITY=1` | `ArcadiaCoreHost.mm`, `ArcadiaCoreWebView.mm` | Logs occlusion and each WebView attach/detach (`[arcadiacore-vis]` in the system log) |
| `ARCADIA_SHADERS_FORCE_KEY=1` | `MetalSurface.swift` | Metal views act as in the key window (the New Tab intro) |
| `ARCADIA_RELEASE_NOTES=1` | `AppModule.swift` | Opens the release notes as after an update |
| `ARCADIA_UPDATE_FEED_URL` | `Updater.swift` | Sparkle's feed; an instance with a scratch data dir checks for updates only with one |
| `ARCADIA_SYNC_DEFAULT_FOLDER` | `SyncModule.swift` | The sync folder (`packages/sync/scripts/e2e.mjs`) |
| `ARCADIA_IMPORT_SOURCE_DIR`, `_SAFARI_HOME`, `_TEST_SECRET`, `_DIA_BUNDLE_ID` | `ImportModule.swift` | Import from fixtures: the Application Support root, Safari's home, a fixed Safe Storage secret instead of the keychain, the app Dia's tabs come from (`packages/import/README.md`) |
| `ARCADIA_ONBOARDING=1`, `_WHATS_NEW=1`, `_TELEMETRY=1`, `_LIVE_MOCK=<url>`, `_CALENDAR_FIXTURE=1` | JS, Debug builds only (`launchEnvironment`) | Run onboarding, show What's New, send telemetry, serve live folders from a mock, use the calendar fixture |

`ARCADIA_BACKGROUND=1` changes:
- **Activation:** the process is BackgroundOnly and every activation path is refused and logged to
  `$ARCADIA_DATA_DIR/activation.log` (`ArcadiaCoreActivation.mm`). File panels never show: they answer with the paths in
  `$ARCADIA_DATA_DIR/file-chooser.txt` (one a line, consumed), or cancel. Context menus are reported, not shown.
  It reads as active all the same (`-[NSApplication isActive]`, the one fake), and AppKit's key window follows as in an
  active app: the window made key is key and its notifications go out, so focus runs production's path. A check
  plays the user leaving for another app with `devWindow(n, "fakeAppActive:0")`. Metal views act as in the key
  window too (the New Tab intro plays in it).
- **Clicks:** `devWindow(n, "mouse:<down|up|dragged|moved>:<x>,<y>[,<clicks>]")` posts one event to the queue as the
  window server would (x, y from the window's top left), so a text field's mouse tracking sees its own mouse-up; a
  script times the up itself. AppKit still keeps an inactive app's first click on unselected text or a page to
  itself: `devWindow(n, "fakeActiveClicks")` lets them through, as in the active app. `devWindow(n,
  "responderChanges")` lists the first-responder changes since the last call with their stacks (who took a field's
  focus).
- **Windows:** full screen is acted out (no new Space); windows answer NO to `-[NSWindow isOccluded]`, so a covered
  window shows a tab at once instead of after Chrome's 1 s delay, with `--disable-backgrounding-occluded-windows`;
  PiP windows stay at alpha 0 and click-through; the drag preview stays above its own window only.
- **Media:** `--mute-audio`, no intro music, `--use-fake-device-for-media-stream` with the microphone kept on a fake
  input (`ac_fake_media.mm`), and `--disable-modal-animations` (a locked screen never ends a dialog's close animation).
- **Other:** macOS re-auth prompts never show; requests are refused unless `ARCADIA_TEST_REAUTH=granted`.

A scratch `ARCADIA_DATA_DIR` holds Chrome's user data and the app's documents, its defaults, keychain items and
Sparkle state (`ACIsolation.h`); Chrome gets `--use-mock-keychain`; update checks are off without
`ARCADIA_UPDATE_FEED_URL`; a Release build's telemetry is tagged `test`, and the release-notes page stays closed
unless `ARCADIA_RELEASE_NOTES=1`.

A Release or RC build starts the dev harness (`dev-eval.js`) only when `$ARCADIA_DATA_DIR/perf-probe` exists in a
test instance (`src/lib/perfProbe.ts`): `: > "$ARCADIA_DATA_DIR/perf-probe"` before launch, as
`.claude/skills/release/scripts/smoke.sh` does.

Input and capture hooks on `ac.shell` (Debug builds only; a Release build answers nothing or `null`), for driving
the app as a person would rather than writing a new helper:

| Hook | What it does |
|---|---|
| `devKeyEquivalent(windowId, { key, keyCode, modifiers, focus, asKey })` | Presses one shortcut through the window's real key path |
| `devTypeKeys(windowId, text, interval)` | Types text into the focused field, a key every `interval` ms; resolves with per-key timings |
| `devMenuCommand(command, arg)` | Fires a menu command as if picked from the menu bar |
| `ArcadiaApp.devMenuItems(title, path?)` | A menu bar menu's items as AppKit has them, its own included (Window › Fill, Move & Resize…); `"tiling:<windowId>"` is the window's green-button menu and whether AppKit tiles it; `path` picks an item |
| `ArcadiaApp.devPostKey(windowId, key, keyCode, modifiers)` | Posts one key press to the app's event queue (`"menu:<key>"`: straight to the menu bar's key equivalents). System hot keys (fn-⌃ tiling) can't be posted |
| `devSnapshotWindow(windowId, path, transparent?)` | Writes the window's layers to a PNG in-process (works with the screen locked; `false` = failed) |
| `devRenderIntroMusic(cues, path)` | Renders the onboarding intro music to an audio file, for a video's soundtrack |

## Hover never moves anything

A control that shows on hover (a row's ✕, a live folder's refresh, Show in Finder) goes in a `HoverSlot`
(`components/HoverSlot.tsx`): the slot keeps the width of what it shows at rest, at least the control's, and the control
lies over it. `useHover` and `useRowHover` mark their handlers, and the dev harness's `ac.hoverShift.check({ scopes })`
(`src/lib/hoverShift.ts`) hovers each marked view inside the named components in turn, measures every view under its
parent before and while hovered, and returns what moved or resized; only a HoverSlot's inside may change.
`hover-shift-test.mjs` runs it on the sidebar (with groups, a live folder and its open items), the tab strip and the
downloads popover, and fails on any shift. Run it after changing anything a hover touches.

## What's kept, and why

The suite was cut from 412 unit cases to 82 on 2026-10-01. A case stays when breaking what it guards would
lose or leak data, or when the bug is invisible by eye and has shipped before.

| File | Kept | Why |
| --- | --- | --- |
| `apps/browser/src/store/privacy.test.mjs` | Private windows and incognito: nothing in `session.json`, `downloads.json` or favicon files, no history, no closed-tab records, no dragging tabs across; history time-range clearing; profile deletion queues Chrome's data and keeps shared data | Privacy and data loss. 0.2.11 shipped private tabs saved to disk and a deleted profile's data left behind |
| `apps/browser/src/store/session.test.mjs` | v1 → v2 migration; `hydrate` repairing a damaged session; reopened windows keeping back/forward (0.2.12); shared profile data across a reload; `history.json`'s hand-written serializer; pinned tabs unloading on ⌘W, parking with a closed window, coming back once, surviving a relaunch (0.2.2, 0.2.8) | Session and history persistence |
| `apps/browser/src/store/tabs.test.mjs` | Opener placement and close → activate rules; group contiguity; broken splits dropped; clean-up and abandoned New Tab cleanup never closing a window or the shown tab; Chrome's echo of the app's own tab switch; an extension's default search engine; the mini player staying closed (0.2.12) | Core behaviour that's hard to see by eye |
| `apps/browser/src/components/omnibox/inline.test.mjs` | Every interleaving of typing and inline completion; stale completions never applied | 0.1.6: fast typing dropped or reordered letters |
| `apps/browser/src/sync/adapters.test.mjs`, `engine.test.mjs` | Bookmark delete-vs-add and move cycles, parked pinned tabs, passwords (newest wins); a crash right after a batch lands; nothing published before its journal is on disk | Sync data loss (0.2.11) |
| `apps/browser/src/telemetry/sanitize.test.mjs` | URLs, hosts, paths, user names, quoted text, emails, dev hosts and NSException reasons never leave the Mac | Privacy: telemetry must never carry what the user browsed |
| `packages/core/src/url.test.ts` | Typed text → URL (`resolveInput`, `fixupUrl`); IDN homograph spoofing stays punycode; tracking parameters stripped without touching the rest; `arcadia://` shown, never `chrome://` | URL parsing and security |
| `packages/core/src/suggest.test.ts` | Inline completion never fills a long sign-in URL; free text never autocompletes; open tabs switchable; frecency ranking; a newer fetch aborts the older one | Omnibox ranking |
| `packages/sync` | The 8 convergence cases above, and the crypto's 5 (`docs/sync.md` › Tests) | Sync correctness and encryption |
| `packages/import/tests/ImportTests.swift` | Importing never writes to the source profile, never leaves its data folder, decrypts logins only with the right key and only after consent | Another browser's data and secrets |
| `extras/raycast-arcadia` | Ids are quoted in the AppleScript it sends | Script injection |

## What went, and why

| Removed | Why |
| --- | --- |
| Spring, rubber-band, capsule and layout constants (`swipeMotion`, `stripGroups`), group naming and labels, numbered tabs, release-note postcard timing, favicon index bounds | Pin exact constants or formatting; a visual check catches these |
| Calculator, quick-create commands, Tab-to-search, text fragments, custom engine validation, most `appUrls` cases | Small pure helpers whose failure is visible the moment you use them |
| Live folders (GitHub, Meetings), Little Arcadia, splits beyond integrity, organize beyond clean-up, OTLP encoding | Feature detail rather than data or security; covered by use |
| The rest of `pinnedClose`, `openers`, `idn`, `suggest`, `sanitize`, sync and import | Variations of a kept case |
| `profile-pager-race-test.mjs` | Loaded the pager's source with its dependencies mocked; `profile-swipe-test.mjs` runs the same races against the real app |
| `profile-motion-stall-test.mjs`, `profile-swipe-replay.mjs` (and the owner's trackpad recording) | One-off investigation harnesses for the native pager, done in 0.2.18 |
| `packages/import/src/index.test.ts`, Swift tests for Dia tabs, file imports, Firefox and Chromium parsing | The JS wrapper is a thin bridge; parsing failures show in the importer's own result |

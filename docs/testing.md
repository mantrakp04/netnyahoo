# Testing

`pnpm test` at the root runs every unit test (126 cases). Turbo caches the results; a cold run spends most
of its time in `swift test`'s first build. Each package also runs its own:

| Package | Command | Cases |
| --- | --- | --- |
| `apps/browser` | `pnpm --filter @netnyahoo/browser test` | 72 |
| `packages/core` | `pnpm --filter @netnyahoo/core test` | 14 |
| `packages/sync` | `pnpm --filter @netnyahoo/sync test` (`swift test`, then `node --test`) | 5 + 8 |
| `packages/import` | `pnpm --filter @netnyahoo/import test` (`swift test`) | 26 |
| `extras/raycast-netnyahoo` | `node --test extras/raycast-netnyahoo/src/scripts.test.ts` | 1 |

`apps/browser` runs its TypeScript under plain Node: `src/test-loader.mjs` maps `@netnyahoo/shell`,
`@netnyahoo/nncore` and `expo-modules-core` to `src/test-native-stub.mjs`. One file:
`node --no-warnings --import ./src/test-loader.mjs --test src/store/tabs.test.mjs` (from `apps/browser`).

End-to-end checks need a built app and are run by hand:

| Check | Run | Guards |
| --- | --- | --- |
| Release smoke test | `.claude/skills/release/scripts/smoke.sh` (the `release` skill) | Every release, whole |
| Shortcuts | `node apps/browser/scripts/shortcuts-test.mjs <Debug app>` | Every shortcut in every focus (0.2.8: ⌘1–9 were swallowed outside a page) |
| Profile swipes | `node apps/browser/scripts/profile-swipe-test.mjs <Debug app>` | The native pager's races (0.2.14–0.2.18 fixes) |
| ⌘-scroll | `node apps/browser/scripts/zoom-scroll-test.mjs <Debug app>` | Trackpad scrolls, mouse zooms (regressed in 0.1.4 and 0.2.12) |
| Sync | `node packages/sync/scripts/e2e.mjs <Debug app>` | Two and three hidden instances through one folder (`docs/sync.md`) |
| Engine patches | `python3 engine/patches/series.py check` | The patch series reproduces the Chromium tree (`docs/cef-source-build.md`) |
| Engine (NNCore) | `node packages/nncore/scripts/acceptance.mjs <Debug app> <scratch dir>` | The app on NNCore, hidden (`docs/nncore-parity.md`) |
| Native perf | `node apps/browser/scripts/perf/native-bench.mjs --app <Release app> --out <dir>` | Launch, idle, memory, tab and window latency; the release perf gate (`docs/perf/README.md`) |
| JS perf | `node apps/browser/scripts/perf/js-bench.mjs run --app <Release app> --bundle <main.jsbundle> --label <name>` | What each interaction costs the JS thread (`docs/perf/README.md`) |

## Test instances

Launch with `open -g -n --env NAME=value … <app>` (`docs/agent-brief.md`). `NETNYAHOO_BACKGROUND=1` and a scratch
`NETNYAHOO_DATA_DIR` make an instance a test instance; the rest are hooks for one test.

| Variable | Read in | What it does |
| --- | --- | --- |
| `NETNYAHOO_BACKGROUND=1` | everywhere (below) | A hidden test instance (below) |
| `NETNYAHOO_DATA_DIR` | `NNCoreHost.mm`, `packages/shell` `NNIsolation.m` | Scratch data dir (below). A Debug build refuses to start without one |
| `NETNYAHOO_REMOTE_DEBUGGING_PORT` | `NNCoreHost.mm` | CDP on that port (`--remote-allow-origins=*`) |
| `NETNYAHOO_JS_LOCATION=host:port` | `AppDelegate.swift` | This launch's Metro, never written to defaults |
| `NETNYAHOO_CHROMIUM_SWITCHES` | `NNCoreHost.mm` | Extra Chrome switches, space-separated (background mode drops the auto-accept capture ones) |
| `NETNYAHOO_ALLOW_OCCLUSION=1` | `NNCoreHost.mm` | Background mode keeps Chrome's occlusion |
| `NETNYAHOO_ALLOW_AUDIO=1` | `NNCoreHost.mm`, `IntroMusic.swift` | Background mode keeps sound |
| `NETNYAHOO_DOWNLOADS_DIR` | engine `nn_downloads.cc` | Chrome's download folder |
| `NETNYAHOO_TEST_REAUTH=granted` | engine `nn_reauth.cc` | Background mode grants macOS re-auth requests (otherwise refused, each reported as `reauth.requested`) |
| `NETNYAHOO_CONTEXT_MENU_LOG` | engine `nn_context_menu.mm` | Context menus go to the host instead of the screen, in any build |
| `NETNYAHOO_FAKE_FULLSCREEN_MS` | `NNCoreChromeWindow.mm` | Length of the acted-out full-screen transition |
| `NETNYAHOO_TRAFFIC_LIGHTS_LOG=<file>` | `NNCoreChromeWindow.mm` | Logs every traffic-light change (test instances only) |
| `NETNYAHOO_PIP_SELFTEST` | `NNCorePictureInPicture.mm` | On the first PiP window: `close` / `backToTab` click Chrome's buttons (`pip-button-selftest.json`), `hover` holds the controls up (`pip-hover.json`, `NETNYAHOO_PIP_HOVER=close\|back`), anything else runs the style self-test (`pip-selftest.json`), all in the data dir |
| `NETNYAHOO_TRACE_PIP=1` | engine `nn_picture_in_picture.mm` | PiP windows opening and closing, to `/tmp/nn-pip-trace.log` |
| `NETNYAHOO_TRACE_VISIBILITY=1` | `NNCoreHost.mm`, `NNCoreWebView.mm` | Logs occlusion and each WebView attach/detach (`[nncore-vis]` in the system log) |
| `NETNYAHOO_SHADERS_FORCE_KEY=1` | `MetalSurface.swift` | Metal views act as in the key window (the New Tab intro) |
| `NETNYAHOO_RELEASE_NOTES=1` | `AppModule.swift` | Opens the release notes as after an update |
| `NETNYAHOO_UPDATE_FEED_URL` | `Updater.swift` | Sparkle's feed; an instance with a scratch data dir checks for updates only with one |
| `NETNYAHOO_SYNC_DEFAULT_FOLDER` | `SyncModule.swift` | The sync folder (`packages/sync/scripts/e2e.mjs`) |
| `NETNYAHOO_IMPORT_SOURCE_DIR`, `_SAFARI_HOME`, `_TEST_SECRET`, `_DIA_BUNDLE_ID` | `ImportModule.swift` | Import from fixtures: the Application Support root, Safari's home, a fixed Safe Storage secret instead of the keychain, the app Dia's tabs come from (`packages/import/README.md`) |
| `NETNYAHOO_ONBOARDING=1`, `_WHATS_NEW=1`, `_TELEMETRY=1`, `_LIVE_MOCK=<url>`, `_CALENDAR_FIXTURE=1` | JS, Debug builds only (`launchEnvironment`) | Run onboarding, show What's New, send telemetry, serve live folders from a mock, use the calendar fixture |

`NETNYAHOO_BACKGROUND=1` changes:
- **Activation:** the process is BackgroundOnly and every activation path is refused and logged to
  `$NETNYAHOO_DATA_DIR/activation.log` (`NNCoreActivation.mm`). File panels never show: they answer with the paths in
  `$NETNYAHOO_DATA_DIR/file-chooser.txt` (one a line, consumed), or cancel. Context menus are reported, not shown.
- **Windows:** full screen is acted out (no new Space); windows answer NO to `-[NSWindow isOccluded]`, so a covered
  window shows a tab at once instead of after Chrome's 1 s delay, with `--disable-backgrounding-occluded-windows`;
  PiP windows stay at alpha 0 and click-through; the drag preview stays above its own window only.
- **Media:** `--mute-audio`, no intro music, `--use-fake-device-for-media-stream` with the microphone kept on a fake
  input (`nn_fake_media.mm`), and `--disable-modal-animations` (a locked screen never ends a dialog's close animation).
- **Other:** macOS re-auth prompts never show; requests are refused unless `NETNYAHOO_TEST_REAUTH=granted`.

A scratch `NETNYAHOO_DATA_DIR` holds Chrome's user data and the app's documents, its defaults, keychain items and
Sparkle state (`NNIsolation.h`); Chrome gets `--use-mock-keychain`; update checks are off without
`NETNYAHOO_UPDATE_FEED_URL`; a Release build's telemetry is tagged `test`, and the release-notes page stays closed
unless `NETNYAHOO_RELEASE_NOTES=1`.

A Release or RC build starts the dev harness (`dev-eval.js`) only when `$NETNYAHOO_DATA_DIR/perf-probe` exists in a
test instance (`src/lib/perfProbe.ts`): `: > "$NETNYAHOO_DATA_DIR/perf-probe"` before launch, as
`.claude/skills/release/scripts/smoke.sh` does.

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
| `packages/core/src/url.test.ts` | Typed text → URL (`resolveInput`, `fixupUrl`); IDN homograph spoofing stays punycode; tracking parameters stripped without touching the rest; `netnyahoo://` shown, never `chrome://` | URL parsing and security |
| `packages/core/src/suggest.test.ts` | Inline completion never fills a long sign-in URL; free text never autocompletes; open tabs switchable; frecency ranking; a newer fetch aborts the older one | Omnibox ranking |
| `packages/sync` | The 8 convergence cases above, and the crypto's 5 (`docs/sync.md` › Tests) | Sync correctness and encryption |
| `packages/import/tests/ImportTests.swift` | Importing never writes to the source profile, never leaves its data folder, decrypts logins only with the right key and only after consent | Another browser's data and secrets |
| `extras/raycast-netnyahoo` | Ids are quoted in the AppleScript it sends | Script injection |

## What went, and why

| Removed | Why |
| --- | --- |
| Spring, rubber-band, capsule and layout constants (`swipeMotion`, `stripGroups`), group naming and labels, numbered tabs, release-note postcard timing, favicon index bounds | Pin exact constants or formatting; a visual check catches these |
| Calculator, quick-create commands, Tab-to-search, text fragments, custom engine validation, most `appUrls` cases | Small pure helpers whose failure is visible the moment you use them |
| Live folders (GitHub, Meetings), Small Yahu, splits beyond integrity, organize beyond clean-up, OTLP encoding | Feature detail rather than data or security; covered by use |
| The rest of `pinnedClose`, `openers`, `idn`, `suggest`, `sanitize`, sync and import | Variations of a kept case |
| `profile-pager-race-test.mjs` | Loaded the pager's source with its dependencies mocked; `profile-swipe-test.mjs` runs the same races against the real app |
| `profile-motion-stall-test.mjs`, `profile-swipe-replay.mjs` (and the owner's trackpad recording) | One-off investigation harnesses for the native pager, done in 0.2.18 |
| `packages/import/src/index.test.ts`, Swift tests for Dia tabs, file imports, Firefox and Chromium parsing | The JS wrapper is a thin bridge; parsing failures show in the importer's own result |

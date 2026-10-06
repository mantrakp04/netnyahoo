# J1 launch: the critical path

Where a launch of 0.2.27 (`dist/0.2.27/export/Netnyahoo.app`) spends its time, from the process starting to the
window with its content, the command bar usable and the restored tab painted, and what to cut. Measured 2026-10-06
by the sprint's launch agent; companion to [sprint-baseline.md](sprint-baseline.md) (the journey numbers) and
[sprint.md](sprint.md).

## Headline

1. **The field's slow launches are first launches of a copy macOS hasn't run before, and their extra time is all
   before `main`.** PostHog `perf_launch` (CEF era, 0.2.9 to 0.2.17, the only versions with samples) is 2.7 to 3.5 s
   on the first launch of every new version and 0.5 to 0.9 s on the launches after it, same user, same Mac. In the
   lab, a fresh APFS clone of the app runs nothing of ours for 3 to 8 s on a calm Mac (13 s on a loaded one): an
   injected library's constructor, which runs right after dyld, fires that late. The rest of the launch is the same
   as a warm one. During that wait `syspolicyd` burns ~5.5 s of CPU: Gatekeeper's exec-time scan of the bundle. Its
   result is kept with the bundle's files (it survives a rename, and Sparkle's move into place).
2. **Running the new copy once, hidden, beforehand removes all of it.** A copy exec'd once with an exit-at-`main`
   switch launches next with the constructor at 38 to 84 ms (n=7) instead of 3 to 13 s. `spctl --assess` and
   `codesign --verify --deep` do nothing for it. `gktool scan` (which Sparkle 2.9.6 already runs on an update it
   extracts, when the installer and the update share a signing identity) removes most of it too.
3. **The scan time follows the bundle's bytes.** Chrome's framework ships its whole symbol table (175 MB of its
   441). With the local symbols stripped, a fresh copy's wait before `main` drops from a median of 5.0 s to 3.7 s
   (interleaved, n=4 each, load 10 to 15).
4. **Warm, one tab, a calm Mac: 451 ms to the window, 485 ms to its content, 600 ms to the tab's first paint.**
   Chrome's own start is about a third of it; React Native's start (bridge and Hermes) is 135 ms; our JS before the
   first commit is under 30 ms.
5. **A big session adds ~480 ms to the window's content and ~450 ms to the tab's first paint, almost all of it on the
   main thread turning the first React commit into native views** (200 sidebar rows), not in Chrome and not in
   JS evaluation. Four windows add another ~250 ms to the window and ~250 ms to the first paint.
6. **`perf_launch` measures the wrong moment for a big session.** It stamps the first window root's React effect
   (526 ms, big session) while its content reaches the screen at 963 ms. Fix the metric before ratcheting on it.

## How it was measured

- `scratchpad/sprint/launch/probe.mjs` (not committed; it lives in the sprint scratch folder) launches a copy of the
  0.2.27 export re-signed so it can load `launchmark.dylib` (`DYLD_INSERT_LIBRARIES`), hidden (`open -g -n`,
  `NETNYAHOO_BACKGROUND=1`, own data dir and DevTools port), one instance at a time under the perflab lock. Every
  time below counts from the kernel's process start time (`p_starttime`).
- `launchmark.dylib` writes epoch-ms marks: its constructor (dyld done), `NSApplicationWillFinishLaunching`, the main
  run loop's first entry, React Native's `RCTJavaScriptWillStartLoading`, `…WillStartExecuting`, `…DidLoad`,
  `RCTContentDidAppear` and the Core Animation commit carrying it, window key/main, and every main-thread busy span of
  8 ms or more.
- Also: the app's NSLogs (`[nncore] engine started`, `app delegate launched`), Chrome's `Startup.*` histograms
  (DevTools `Browser.getHistograms`), the perf probe's marks (`bundleStart`, `bundleEnd`, `firstCommit`,
  `firstWindow`), CGWindowList (the window on screen with alpha > 0), the restored tab's paint timing, `sample` of
  the main and JS threads, and CPU time of `syspolicyd`, `trustd`, `mds` and friends across each launch.
- Sessions: **small** is one window, one tab. **big** is `apps/browser/scripts/perf/seed.mjs` (200 tabs in two
  profiles, 5000 history entries, 1000 bookmarks) after one settling launch, with the migrated `history.json`
  removed. (js-bench seeds every run, so its big-session launches also move 5000 visits into Chrome each time.)
  **big4** is big plus three windows of 15 tabs (one on the Work profile).
- The Mac was badly loaded for most of the session (load average 60 to 530 from other agents' builds and benches and
  the owner's apps). The warm table is from the calm stretch (load 6 to 12); first-launch rows give the load.

## Warm launch timeline

Medians (min–max), ms from process start, n=4 each, interleaved, load 6 to 12.

| Phase | small | big | big4 |
|---|---|---|---|
| dyld and static initializers done (`dylibInit`) | 45 (44–75) | 43 (42–44) | 43 (35–45) |
| `ChromeMain` (histogram ProcessCreateToApplicationStart) | 52 | 49 | 50 |
| Chrome's message loop starts (BrowserMessageLoopStartTime) | 155 (130–370) | 146 | 139 |
| AppKit `finishLaunching` (inside Chrome's loop) | 208 | 198 | 192 |
| `engineDidStart` (PostBrowserStart ran) | 223 | 213 | 209 |
| React Native host starts loading the bundle | 245 | 233 | 227 |
| Hermes starts executing it | 358 | 339 | 332 |
| `main.tsx` evaluated (`bundleEnd`) | 376 | 370 | 363 |
| first React commit | 425 | 481 | 419 |
| `firstWindow` mark (what `perf_launch` reports) | 460 | 526 | 454 |
| window on screen | 451 (443–788) | 497 (476–764) | 736 (732–869) |
| its React content on screen (CA commit) | 485 (430–819) | 963 (922–1043) | 770 (727–1169) |
| window key (command bar can take keys) | 425 | 420 | 1188 (1078–1489) |
| restored tab starts navigating | 496 | 772 | 857 |
| restored tab's first contentful paint | 600 (556–1032) | 1056 (1034–1123) | 1294 (1272–1657) |

What each stretch is (small):

| Stretch | ms | What runs |
|---|---|---|
| process start → dyld done | 45 | mapping Chrome's 421 MB framework (warm page cache), hermes, Sparkle; static initializers |
| → Chrome's loop | 105 | `BrowserMainRunnerImpl::Initialize` 38 ms, `PreMainMessageLoopRun` 30 ms (of which the profile 27 ms), the rest content/ICU/resource bundle setup |
| → `engineDidStart` | 70 | AppKit's `finishLaunching` in Chrome's loop, `PostBrowserStart`, NNCore's started callbacks |
| → RN starts loading | 22 | `AppDelegate`: React Native factory, Expo's app delegate subscribers (after the loop first goes idle) |
| → Hermes executing | 113 | bridge setup, native module registry, Expo's JSI install, reading the 3.6 MB bytecode bundle |
| → `main.tsx` done | 18 | module bodies run at import (inline requires: most components load at first render); hydration of `session.json` |
| → first commit | 50 | `openWindow` → the native `NNCoreWindow` and React root (~40 ms), then `runApplication` (7 ms of JS) |
| → content on screen | 60 | native views, layout, the CA commit |
| → tab FCP | 115 | the tab's WebContents is created after the window's content mounts; Chrome's own navigation→FCP is 101 ms |

The Hermes bundle is already bytecode (`c61f bc03`), 3.6 MB, and evaluates in 18 to 26 ms. Chrome's startup is about
150 ms of the 451. Nothing in the warm path does file I/O worth chasing: hard page faults to the message loop are
~385 (small) to ~485 (big), and bookmarks load on Chrome's side in the background (39 to 78 ms, off the critical
path).

### What grows with the profile

| | small → big | big → big4 |
|---|---|---|
| before JS (to Hermes executing) | none (358 → 339) | none |
| first React commit | +56 ms (runApplication 7 → 80 ms of JS) | — |
| first commit → content on screen | +420 ms (60 → 482): native view creation for ~200 sidebar rows (sample: RCTUIManager ~260 ms, CA commit ~290 ms, SF Symbol images ~100 ms) | four windows built one after another, the focused one last |
| tab navigation start | +276 ms (after the content mounts) | +85 ms |
| tab FCP | +456 ms; Chrome's navigation→FCP 101 → 288 ms (the renderer competing with the main thread) | +238 ms (navigation→FCP 484 ms) |
| window key | — | +770 ms |

In the big session the window is on screen (alpha > 0) at 497 ms but its React content only at 781 to 963 ms: for
~300–450 ms the window shows its backdrop without the sidebar or the card.

## First launch of a new copy

Fresh APFS clone of the re-signed export for every launch (`--fresh 1`), `dylibInit` = the injected constructor,
window = CGWindowList, ms from process start.

| Case | dylibInit | window | n, load |
|---|---|---|---|
| warm (same copy again) | 41–45 | 443–547 | many, 6–12 |
| fresh copy, shipped framework | 4397, 4433, 5558, 7670 (median ~5.0 s) | 4929–8094 | 4, 10–15 |
| fresh copy, framework stripped (`strip -x`) | 2962, 3435, 3932, 4353 (median ~3.7 s) | 3484–4978 | 4, 10–15 (interleaved with the row above) |
| fresh copy, after a hidden exec that exits at `main` | 38–84 | 547–984 | 7, 10–500 |
| fresh copy, after `gktool scan` (then `touch` and a rename) | 362–391 | — | 2, ~400 |
| fresh copy, after `spctl --assess` / `codesign --verify --deep` | 9538–12459 | — | 4, ~400 (no effect) |
| Sparkle 2.9.6 update of a 0.2.26 copy, its first launch | 175, 195, 232 (load 5–15); 13210 (load ~200) | 618, 995, 1187; 18300 | 4 updates |
| …the same, with a hidden exec of the updated copy first (took 71 and 160 ms) | 39, 52 | 501, 842 | 2 updates, load 5–15 |
| …the updated copy's later launches | 42–104 | 567–1342 | |

- The process exists (pgrep sees it ~100 ms after `open`) but nothing of ours runs until the scan ends; the
  hidden exec pays the same wait (the prewarm itself took 2.5 to 13.6 s).
- What stays after the scan: the copy's first launch is still ~150–550 ms slower to the window than its second
  (page cache, dyld's first load of the new binaries).
- Sparkle runs `/usr/bin/gktool scan` on the extracted update before installing it (`Autoupdate`, seen in the
  unified log during `update-test.sh`), so a Sparkle update usually arrives scanned: its first launch is 130–190 ms
  slower before `main` than its second (dyld's first load of the new binaries), and 0–500 ms to the window. In one of
  four updates, on a loaded Mac, the updated copy still waited 13 s. The field's 2.7–3.5 s first launches (CEF era,
  same Sparkle) are more than the lab's Sparkle residual: either those copies weren't Sparkle-installed (a DMG or a
  copied build) or the scan didn't take, as in that one trial.
- A new user's first launch (from the DMG) has no installer to scan it ahead of time: only a smaller bundle helps
  there.

## Projects, ranked

Estimates are milliseconds saved to the window with its content (or the tab's first paint where it says FCP), small /
big session, warm unless it says first launch. "Engine" needs a Chromium rebuild (ask the owner first), "native" an
app build, "JS" only a bundle.

| # | Project | Phase it cuts | Saves (small / big) | Risk | Kind | Status |
|---|---|---|---|---|---|---|
| 1 | **Strip the engine's local symbols in `release.sh`** (unstripped copies kept in `dist/<v>/symbols` for `atos`) | first launch of an unscanned copy: Gatekeeper's scan | first launch −1.3 s median (5.0 → 3.7 s); warm 0 | low: UUID and export trie checked; crash reports need the kept files to symbolicate | packaging | done (9ce39c96) |
| 2 | **Prewarm an update before its first launch**: when Sparkle stages an update for install-on-quit (the default, `SUAutomaticallyUpdate`), run the staged copy once, hidden, with `NETNYAHOO_PREWARM=1` (exits at `main`) | first launch after an update: pre-`main` | −130 to −190 ms pre-`main` after Sparkle's own scan (calm); all of the 3–13 s when Sparkle's scan didn't take (1 of 4 updates, loaded Mac). Updates installed from the update window (relaunch at once) don't get it | low (two Codex reviews; hook after Sparkle's preparation, spawned off main, killed at quit or after 90 s) | native | done (be2ca8f7) |
| 3 | **Fix `perf_launch`**: report process start → content on screen (the CA commit) and → the restored tab's FCP, and tag the first launch of a version | measurement | — (big session: today's metric hides 440 ms) | low | JS + native | proposed |
| 4 | **Bound the first render of the sidebar**: mount the rows in view (~30) in the first commit, the rest after the first frame (or window the list) | first commit → content (native view creation) | 0 / −300 to −400 | medium: scroll position, drag and drop, ⌘-number shortcuts, measured heights | JS | proposed |
| 5 | **Start the restored tab's page with the engine, not after React**: at `engineDidStart`, create the focused window's active tab's WebContents from `session.json` and navigate it; the React tab adopts it (`adoptId`, as for Chrome-made tabs) | tab navigation start (496 / 772 ms) | FCP −150 to −200 / −400 | medium: the adopt path at launch, profiles, a session restored without that tab | native + JS | done (e172113b), switch `launchTab`; kept: FCP −350 ms with a 300 ms page, nav −320 ms, nothing at latency 0 (see Done below) |
| 6 | **Focused window first, the others after its first frame** (today the focused one opens last so it comes to front; order the rest behind it instead) | big4: window 736, key 1188 | big4: window −250, FCP −250, key −700 | low–medium: z-order, which window is key | JS + native | done (c9616e01), switch `focusedWindowFirst`; proven on big4, see Done below |
| 7 | **Defer the adjacent profile's warm tab** (and so Chrome loading the Work profile at launch) until after the first frame | big: CPU contention during the first commit | 0 / −50 to −150 | low | JS | proposed |
| 8 | **Start React Native while Chrome starts**: create the bridge and evaluate the bundle on the JS thread from `main`, gating engine-backed native modules until `engineDidStart` | RN start (113 ms) overlapping Chrome's 170 ms | −100 to −150 / same | high: NSApp ownership, RN's main-queue module setup, LogBox | native | proposed |
| 9 | **Trim React Native's start** (245 → 358 ms): profile the bridge setup (module registry, Expo's 30 modules, bundle read); lazy Expo modules, no main-queue setup where not needed | RN start | −30 to −60 | low–medium | native | proposed |
| 10 | **Cache SF Symbol images** by name/size/weight/tint (rows rebuild the same few) | first commit → content | −5 / −50 to −80 | low | native | proposed |
| 11 | **Drop unused locales and maybe SwiftShader from the bundle** (`*.lproj` other than en; `libvk_swiftshader.dylib` 21 MB is WebGL's software fallback) | first launch of an unscanned copy | first launch −0.4 to −0.6 s | locales low (the UI locale is the bundle's, English); SwiftShader medium (GPU-blocklisted Macs) | packaging | proposed |
| 12 | **Official engine build** (`is_official_build=true`, ThinLTO, PGO; today none of them) | Chrome's start (150 ms), the renderer, page loads; fewer bytes to scan | warm −20 to −40; first launch −0.3 to −0.8 s; every page faster | medium: a 5 to 8 h rebuild, longer incremental builds after | engine | owner's call |
| 13 | **Static first frame**: save each window's last frame at quit, show it in the window at once (~60 ms, before Chrome's loop) and swap in the live content when it commits | perceived window | perceived −350 / −850 | medium–high: a stale frame that can't be clicked, multi-window, appearance changes | native | wacky |
| 14 | **Native command bar first**: a plain text field in the window from its first frame that takes typing (the type-ahead holding `Windows.swift` already does for new windows) and hands it to the React command bar | "command bar usable" | usable at window time regardless of JS | medium | native | wacky |
| 15 | **Trim Chrome's startup services** (component updater, optimization guide, segmentation platform, Safe Browsing DB at launch) with `--disable-features`/delays | Chrome's start | −20 to −50 | medium: features that need them | engine switches | needs a startup trace |

Not worth it now: the Hermes bundle (bytecode, 18 to 26 ms to evaluate with inline requires; splitting it saves little
before the first commit), `session.json` reads (72 KB for 200 tabs), the "first idle" wait before React Native starts
(2 ms), lazy WebContents for restored tabs (already lazy: only each window's active tab, plus the adjacent profile's
warm tab, gets a page at launch).

## Done in this sprint

- **9ce39c96** `release.sh` strips the engine (`packages/nncore/scripts/strip-engine.sh`): the framework 441 → 266 MB,
  the bundle 592 → 418 MB, UUIDs and exports unchanged (the script checks), unstripped files in `dist/<v>/symbols`
  (keep that folder with each release: it is what symbolicates a crash in Chrome's framework). `smoke.sh` on a
  stripped, re-signed copy of 0.2.27: every check passes but the two notarization ones (the copy isn't notarized).
- **be2ca8f7** `NETNYAHOO_PREWARM=1` exits at the top of `main.swift`; `UpdatePrewarm` (`packages/shell/ios/Updater.swift`)
  runs the update Sparkle staged in `~/Library/Caches/<bundle id>/org.sparkle-project.Sparkle/Installation` when
  `willInstallUpdateOnQuit` fires. Lab (calm, Sparkle 2.9.6 updating a 0.2.26 copy to 0.2.27): the first launch's
  pre-`main` time 39/52 ms with the prewarm against 175–232 ms without. Not yet exercised through a real
  install-on-quit (the first update that can show it is the one after the release that ships this code, since the
  old app runs the prewarm).
- **c9616e01** #6 focused window first (`focusedWindowFirst`): the key window opens first and the others open behind it
  once its content has committed (`CATransaction.flush()` first, so its frame is not held back by building the
  rest). Timed series 2026-10-06, probe `big4` (4 windows, 8 pages), interleaved, n=8, load 6 to 12, median
  (min–max), ms from process start; before = both switches off, same build:

  | big4 | before | after | 0.2.27 |
  | --- | --- | --- | --- |
  | focused window on screen | 1600 (1141–3233) | 563 (442–1907) | 1615 (1363–2001) |
  | its content (CA commit) | 1385 (1041–2863) | 797 (616–2483) | 1550 (1300–1905) |
  | window key | 1389 (1043–2875) | 519 (428–1801) | 1553 (1309–1907) |
  | tab navigation start | 1134 (870–2191) | 463 (377–1664) | 1367 (1157–1696) |
  | tab first contentful paint | 1713 (1278–3399) | 1534 (707–4304) | 1789 (1466–2116) |
  | last of the other windows on screen | 1600 (1141–2705) | 1465 (1216–4001) | 1615 (1363–2001) |

  The final stack (frames in z order, key window), navigation count (1) and window shifts (0) are identical in all 24
  runs. The 6 s window captures (one PNG per window; run 0 of before and after is byte-identical, the others differ in
  small details such as page content) are in
  `scratchpad/sprint/launchnext/results/snaps/big4-{before,after,r0227}-<run>/`. Window and key are proven (the focused window
  shows ~1.0 s earlier, the others no later). The series cannot split #5 from #6 (both switches were toggled
  together), so the navigation-start gain in this table is shared. Absolute times are about twice the calm-Mac
  numbers in the timeline above (8 pages loading, load 6 to 12); 0.2.27 in the same series is the control.
- **e172113b** #5 the restored tab's page starts before the window (`launchTab`). Isolated A/B, 2026-10-06, one
  window, `focusedWindowFirst` on in both arms and only `launchTab` toggled, interleaved, n=8, load 7 to 15 (the
  probe waited for it), median (min–max), ms from process start:

  | | latency 0, off | latency 0, on | 300 ms page, off | 300 ms page, on |
  | --- | --- | --- | --- | --- |
  | window on screen | 646 (435–2067) | 672 (443–2084) | 420 (373–475) | 600 (426–697) |
  | its content (CA commit) | 951 (632–2045) | 1077 (863–2329) | 814 (633–1008) | 886 (781–1298) |
  | window key | 500 (350–1181) | 496 (405–1189) | 391 (346–430) | 406 (384–637) |
  | tab navigation start | 737 (521–1562) | 415 (366–936) | 568 (508–683) | 364 (350–570) |
  | tab first contentful paint | 1175 (956–2582) | 1127 (926–2540) | 1288 (1123–1471) | 940 (766–1366) |

  With a page that answers after 300 ms (what a real site does), FCP is 350 ms earlier, in all 8 pairs; navigation
  starts 200 ms earlier. At latency 0 FCP does not move (within noise): Chrome paints a hidden WebContents only
  once its view is visible, so the early start only buys the network and parse overlap, which is nothing on
  localhost. Cost: with the 300 ms page the window is shown ~180 ms later (7 of 8 pairs; key unchanged,
  content ~70 to 100 ms later); at latency 0 window and key are the same. The earlier series' single-window sets (big,
  biglat) ran at load up to 55 and are not usable; this run replaces them. Verdict: keep; `launchTab` stays as the
  kill switch. Open: why the window shows later with a slow page (the early load's responses compete with the
  window's first commit on the main thread is the likely cause; not profiled).

# Performance benchmarks

How to measure Netnyahoo and gate a release on it. Every script prints its flags with `--help`, and its header
documents the same flags, so you don't need to read the rest of a script to run it. Results from past
comparisons: [0.2.19 → 0.2.20](0.2.19-to-0.2.20.md), [0.2.22 → 0.2.23](0.2.22-to-0.2.23.md), [0.2.23 → 0.2.24](0.2.23-to-0.2.24.md), [0.2.24 → 0.2.25](0.2.24-to-0.2.25.md), [0.2.25 → 0.2.26](0.2.25-to-0.2.26.md), [0.2.26 → 0.2.27](0.2.26-to-0.2.27.md).

## Files

All of them are in `apps/browser/scripts/perf/`.

| File | Bench | What it is |
|---|---|---|
| `native-bench.mjs` | native | Launch, idle CPU and wakeups, memory, tab and window latency, throttling, on a Release app in hidden instances. Its header maps every section and output row to the function that measures it. |
| `nnperf.swift` | native | Process probes (rusage, phys_footprint, window on screen, quit), built on demand with swiftc. |
| `nnmark.m` | native | Injected into the bench's copy of the app: marks when a window's React content commits. |
| `bench-entry.js`, `bench-channel.js` | native | The JS entry of the bench bundle: the app's `index.js` plus the command channel. |
| `js-bench.mjs` | JS | React commits, renders, store updates and JS tasks per interaction, on a production bundle. |
| `bench-app.js` | JS, render | The scenarios js-bench and render-bench run inside the app. **Not** part of native-bench. |
| `seed.mjs` | JS, render | The big profile those runs start from: 200 tabs, 5000 history entries, 1000 bookmarks. |
| `render-bench.mjs` | render | Wasted renders per interaction, using React's profiling build (`js-bench.mjs bundle <dir> --profiling 1`). |
| `micro-bench.mjs` | Node | Store-side work that grows with a profile (sidebar entries, group names, omnibox) in Node. No app needed. |

The app side of the JS benches is `apps/browser/src/lib/perfProbe.ts`. It only turns on in an isolated instance
whose data folder holds a `perf-probe` file.

Each bench drives the app through files in the instance's `NETNYAHOO_DATA_DIR`:

| Files | Used by | Written by |
|---|---|---|
| `bench-cmd.js` → `bench-result.json` | native-bench | bench-channel.js (first line `// <id>`; the result carries the same id) |
| `bench-boot.json` | native-bench | bench-channel.js as it loads (the "JS running" mark) |
| `bench-marks.jsonl` | native-bench | nnmark.m (`content`/`committed` epoch ms per window) |
| `dev-eval.js` → `dev-eval-result.json` | js-bench, render-bench | the dev harness (`src/lib/devHarness.ts`) |
| `perf-probe` | js-bench, render-bench | the seed. Its contents turn on the probe's options: `selectors`, `renders`, `listeners` |

## Gating a release

The previous release is the control and the new release candidate is the candidate. The gate passes when every
row is the same or better.

1. **Build the candidate with `scripts/release.sh <v> --rc`.** That gives you `dist/<v>-rc/export/Netnyahoo.app`.
   A local Release build is a different app: it's unstripped (about 18 MB against 8.9 MB) and has no secure
   timestamp or notarization ticket, so its launch numbers don't stand for what ships.
2. **Give each app a bench bundle that matches its `NATIVE_API_VERSION`.** native-bench swaps its own bundle
   (`bench-entry.js`) into each app. That bundle has to match the app's native API (`apps/browser/src/nativeApi.tsx`
   against `apiVersion` in `packages/shell/ios/AppModule.swift`). On a mismatch, every command fails with
   "Native API skew".
   - When both apps share a version, run the candidate's bundle on both (the default for `--control`). Then only
     native code differs.
   - When the versions differ (0.2.21 is version 4, 0.2.22 is version 5, 0.2.23 is version 6), pass the control its own bundle with
     `--control-bundle`. Keep the bench bundle you gated a release with as `dist/<v>/bench/main.jsbundle`, so the
     next gate can use it as the control. `dist/0.2.21/bench/` and `dist/0.2.22/bench/` hold the bundles from the
     0.2.22 gate.
   - js-bench runs each app's own `Contents/Resources/main.jsbundle`.
3. **Interleave the two apps.** Run both in one native-bench process with `--control`. It alternates the apps run
   by run, putting the control first on even runs, so both see the same machine. Don't run the apps as two
   separate jobs. The 0.2.22 gate ran 0.2.21 and the RC 15 minutes apart and chased a launch "regression" that
   was only drift. For js-bench, alternate `run --runs 1 --append 1` between the two labels, in a fresh `--out`.
4. **Use a quiet machine.** Before starting, check `ps` for other agents' builds, benches and test instances. When
   the timing is what you're measuring, run one bench at a time.
   - Pick your own `--port`.
   - Keep the display awake (`caffeinate -d`).
   - If the screen locks or the display sleeps, macOS stops giving windows display-link frames. Pages then paint
     about once a second. native-bench leaves those switches and new tabs out and counts them in the "samples
     left out" row. A nonzero count there means rerun with the screen awake.
   - WindowServer captures fail while the screen is locked, but the bench doesn't need any.
   - The instances' windows are on screen, usually in front of everything: when the owner is using the Mac, their
     pointer moving over one wakes that app (hover, cursor updates), whichever version it is. The "idle windows:
     someone used the Mac" rows count the seconds of input during each run's idle windows. Don't call an idle
     regression from runs where they're nonzero. The 0.2.26 gate's idle spikes came in a round the owner was using the
     Mac and didn't come back in 16 more interleaved runs, 8 of them with the owner at work.
5. **Collect enough runs.** Use at least 6 launches and 2 session runs per app. Each session run takes about 5
   minutes with `--idle 60`. The table gives the median with min–max and n.
   - Call a row a regression only when the ranges separate, or when it reproduces in a second interleaved round.
   - Overlapping ranges are noise.
   - Compare runs made with the same `--only`: a sub-phase run settles less than a full session.
6. **Clean up.** Afterwards, run `scripts/agent/unregister-builds` and delete your out dir.

```sh
V=0.2.23 PREV=0.2.22 OUT=<your scratch dir>/gate
scripts/release.sh $V --rc
# Native. Omit --control-bundle when both apps share NATIVE_API_VERSION.
node apps/browser/scripts/perf/native-bench.mjs --out $OUT/nb --port 9478 \
  --app dist/$V-rc/export/Netnyahoo.app --label rc \
  --control dist/$PREV/export/Netnyahoo.app --control-label $PREV --control-bundle dist/$PREV/bench/main.jsbundle \
  --only launch,session,windows --launch-runs 6 --runs 2
# JS: alternate the apps one run at a time.
for i in 1 2 3; do for app in $PREV:dist/$PREV/export/Netnyahoo.app rc:dist/$V-rc/export/Netnyahoo.app; do
  node apps/browser/scripts/perf/js-bench.mjs run --app ${app#*:} --bundle ${app#*:}/Contents/Resources/main.jsbundle \
    --label ${app%%:*} --runs 1 --append 1 --out $OUT/js
done; done
node apps/browser/scripts/perf/js-bench.mjs compare $OUT/js/$PREV.json $OUT/js/rc.json
scripts/agent/unregister-builds
```

For a question that the phases don't answer, don't fork native-bench into a probe. Prepare the copies once with
`--only prepare`, then iterate on them:

- `--prepared` reuses the signed copies without rebuilding or re-signing.
- `--only switch`, `newtab`, `memory`, `idle` or `newwindow` runs one part of a session.
- `--env K=V` passes extra environment, such as a trace switch or an extra `DYLD_INSERT_LIBRARIES`.
- `--hold <secs>` keeps each measured instance alive so you can attach `lldb -p`, `heap` or `vmmap`.

If you need a new measurement, add it as a phase and commit it.

## What the rows measure

### native-bench

Launch rows count from just before `open -g -n`. Command rows count from `Date.now()` in the app's JS as the
command starts.

| Row | Measures |
|---|---|
| launch → window shown | The first on-screen window of at least 300×200 with alpha > 0 (CGWindowList) |
| launch → window shown with its content | The later of that and the commit of the Core Animation transaction carrying the first React content (nnmark) |
| launch → JS running | The bench channel loading, after the app's `index.js` and its imports |
| launch → first page painted | The restored tab's first-contentful-paint |
| launch → first page's first frame | The restored tab's first `requestAnimationFrame` |
| idle CPU, idle wakeups/s | rusage over the whole process tree (or one process kind) across `--idle` seconds, with the channel paused, at 1 tab and at 20 tabs |
| memory (phys_footprint) | The tree's footprint at 1, 10 and 20 tabs, and 30 s after closing back to 1. The "browser process" rows count that process alone. |
| idle windows: someone used the Mac (…with the pointer moving over the window) | Seconds of mouse, trackpad or keyboard input during the run's idle windows (HIDIdleTime polled every 250 ms), and of those, with the pointer moving over the instance's window |
| after an idle minute: command answered | The first command's latency after the 1-tab idle (catches App Nap) |
| samples left out | Switches and new tabs dropped because the page got fewer than 5 frames in 250 ms |
| tab switch → shown | `switchToTab` → the page turns visible and has drawn 2 frames (median of 16 among 20 tabs) |
| new tab → first paint / first frame | Store `newTab` → the page's FCP / first frame (median of 5) |
| new window → on screen / with its content / first paint / first frame | `openWindow` → the window on screen (2 ms polls) / the later of that and its content commit / its page's FCP / first frame |

### js-bench

js-bench reports `<scenario>.<metric>` lines (medians across runs). The header of `js-bench.mjs` lists the report's
shape.

- `*.commits`, `renders`, `hostUpdates`: React's work.
- `storeUpdates`, `listenerMs`: the store and its subscribers.
- `taskMs`: JS time in native→JS tasks.
- `otherJsMs`: JS time outside the measured steps.
- `writes`, `writeKB`: document writes.
- `startup.*`: marks from the bundle's start to the first window.

## Rows that don't compare with CEF-era numbers (0.2.21 and older)

| Row | Why | Compare instead |
|---|---|---|
| launch → window shown, new window → on screen | CEF builds put a window on screen empty and fill it after. NNCore keeps it transparent until its content commits. The same row times an empty window on one engine and a full one on the other. | the "with its content" rows |
| launch → first page painted, new tab → first paint, new window → first paint | CEF stamps first-contentful-paint with the start of the frame. Chrome (NNCore) stamps it with the frame on screen, about a frame later. | the "first frame" rows |
| main-thread samples `engineWork` | The engine's main-thread work goes through different functions: CEF's `CefDoMessageLoopWork` against NNCore's `RunWorkSource`. | treat as indicative only |
| js-bench `taskMs`, `tasks`, `otherJsMs`, `startup.*` task counts | Probe revision 1 (0.2.21) didn't time Expo module events as tasks. Revision 2 (6232fa43) does. | numbers from bundles of one probe revision |

The JS reports stamp `probeRevision` (from `PERF_PROBE_REVISION` in `perfProbe.ts`, inferred for older bundles)
and `benchRevision` (the seed and scenarios). `js-bench.mjs compare` prints a warning line when either differs
between the two reports. The native bench bundles also differ across a native API bump, so on those rows some of
the difference is the JS.

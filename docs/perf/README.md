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
| `micro-bench.mjs` | Node | Store-side work that grows with a profile (sidebar entries, group names, omnibox) in Node. No app needed. Its `counts` and `instr` cases feed the ratchet. |
| `ratchet.mjs`, `ratchet.json` | ratchet | Ceilings on counts that can only go down, and the commands that check, lower and rebuild them. |
| `ratchet-app.js`, `ops.mjs`, `ratchet-proof.mjs` | ratchet | The `launch` scenario the ratchet adds to js-bench, the builtin-call counter micro-bench uses, and the before/after proof that counts track wall-clock. |

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

## The ratchet

Wall-clock can't gate a release by itself: the same build moves ±20% between runs on a busy Mac, and a gate that cries
wolf gets ignored. Counts don't move: React commits, renders, store updates, native→JS tasks, timers and document writes
per interaction mostly come out to the digit in every run, and so do the builtin calls of the Node hot paths.
`ratchet.json` holds a ceiling for each count that proved steady; a ceiling is lowered when a change cuts the count and
raised only by hand, with the reason in the commit. Nothing runs in CI, so the check is a command:

```sh
node apps/browser/scripts/perf/ratchet.mjs run            # 90 s: bundle the tree, run the journeys once, count the Node hot paths, check
node apps/browser/scripts/perf/ratchet.mjs run --instr    # the same, plus the instruction counter
node apps/browser/scripts/perf/ratchet.mjs run --own --app dist/<v>-rc/export/Netnyahoo.app   # a release candidate's own bundle
node apps/browser/scripts/perf/ratchet.mjs check <report.json>          # a js-bench report you already have (several runs: the median run)
node apps/browser/scripts/perf/ratchet.mjs lower <report.json>          # lock in the counts a change cut; prints the diff
node apps/browser/scripts/perf/ratchet.mjs baseline       # rebuild ratchet.json (8 runs, about 11 minutes, a quiet machine)
```

`run` takes about 85 s (6 s of it bundling the tree, 15 s the Node counts, the rest one launch and the nine scenarios of
one hidden instance), and about 170 s when a count is over and the scenarios run a second time. It exits 1 and prints a
table of the counts over their ceiling. A count over in the first run gets one more run, and only a count over in both fails: a real regression is in both, a pointer moving over the hidden window or the window
deactivating mid-scenario is in one. A report of several runs is judged by its median run.

### What is steady

The scenarios run in a fixed order (`ratchet.mjs` header says why): `startup`, `launch` (all the launch's work, read
once it has stopped), `idle`, `typing`, `switchTabs`, `scroll`, `hover`, `pageLoad`, `openClose`, with
`--options '{"seconds":5}'`. The census behind `ratchet.json` is 8 launches of 0.2.27's Release app with the tree's
bundle.

Group totals per scenario over the 16 baseline runs (two batches of 8): a bare number repeated in every run is gated
exact, `a–b~` moved and is gated as noisy (ceiling: the largest plus 10%), `a–b x` moved too much to gate. Each
scenario also has named exact counts (one component's renders, one store key, one task): 471 exact counts in all, 54
noisy totals, 15 Node counts and the instruction count.

| Journey / scenario | commits | renders | hostUpdates | storeUpdates | mounts | listenerCalls | tasks | timers | writes |
|---|---|---|---|---|---|---|---|---|---|
| J1 launch (all of it) | 37–60~ | 654–970~ | 340–516~ | 23–77~ | 5594–5684~ | 470–1942~ | 235–500~ | 394–593~ | 9–15~ |
| idle, 5 s | 0 | 0 | 0 | 0 | 0 | 0 | 25–28~ | 12–18~ | 0 |
| J2 typing, 30 keys | 122–150~ | 1825–2756 x | 1203–1789 x | 19–20~ | 106–187 x | 56 | 113–171 x | 177–198~ | 0 |
| J3 switchTabs, 12 | 24–36 x | 676–850~ | 336–430~ | 25–26~ | 1001–1041~ | 950 | 325–355~ | 575–591~ | 2–3 x |
| scroll | 0–142 x | 0–2116 x | 0–1208 x | 0–12 x | 0–469 x | 0–342 x | 364–651 x | 250–306~ | 0 |
| hover, 24 rows | 25 | 672 | 384 | 1 | 168 | 0 | 36–39~ | 55–64~ | 0 |
| J4 pageLoad, 3 loads | 46–58~ | 2172–2281~ | 1201–1253~ | 84–116~ | 33 | 2430–3380~ | 853–980~ | 1760–2058~ | 5–8~ |
| J2 openClose, 20 tabs open | 67–107~ | 1454–2366~ | 771–1282~ | 98–273 x | 2254–2306~ | 2122–7289 x | 894–1119~ | 1211–1460~ | 4 |
| J2 openClose, 20 tabs close | 43–80 x | 1114–1789~ | 580–958~ | 56–138 x | 1526–1636~ | 1335–3694 x | 687–819~ | 1154–1286~ | 4–5~ |

What repeats: everything `hover` does, the idle app's zeros (no commit, render, store update or write in 5 s), `typing`'s
56 store-listener calls, `switchTabs`' 950, `pageLoad`'s 33 mounts, `openClose`'s 4 writes, and 471 named counts (which
component renders how often, which store key changes, which task runs). What doesn't: anything that follows a page's
load progress (the launch's restore, `pageLoad`, `openClose`: a page reports progress at its own pace), and the
outliers that a stray window event makes in single runs (`scroll` had 3 runs of 16 with work in them, `typing` 4 with
extra commits). `switchTabs` commits, renders, hostUpdates and storeUpdates were identical in all 8 runs of two earlier
censuses on a calmer machine, and `typing` commits were 122 in 7 of 8; one run in 16 of the baselines above broke each,
which is why they are noisy here. The baselines were taken with the machine loaded (agents building: load average about
300), so they are the worst case; `ratchet.mjs baseline` on a quiet machine would move some of these `~` and `x` counts
to exact.

### Policy

- **exact**: a count that took the same value in every baseline run. Its ceiling is that value. Group totals are held to it
  exactly; named counts (one component's renders, one task's calls, one timer) are gated too, so a regression says where
  it is, but get 2 or 5% of room: a timer firing once more says nothing, and the total says whether the work grew.
- **noisy**: a group total that moves between runs because pages and timers finish at their own pace, with its median
  within 30% of its largest value. Its ceiling is the largest value plus 10%: it catches a regression, not a few
  percent. `lower` leaves these alone.
- **micro**: builtin-call counts of `micro-bench.mjs counts` (omnibox keystrokes on the seed profile, sidebar, strip and
  group entries at 500 and 1000 tabs, group names). Exact: Node runs them with nothing else going on.
- **instr**: instructions retired per round of `micro-bench.mjs instr`: the largest of 3 baseline measurements plus 4%.
- Not gated: counts that wobble beyond that, which are the ones driven by how fast a page loads: `openClose` (20 tabs
  loading), `startup` (a race against the rest of the launch; `launch` replaces it), and the byte count of the session
  writes. They stay in the js-bench report.
- A new component, task or timer that has no ceiling shows up in the group total's ceiling, not on its own: `check`
  lists the biggest counts without one.
- The ceilings are for probe revision 2 and bench revision 2 (`perfProbe.ts` `PERF_PROBE_REVISION`, js-bench
  `BENCH_REVISION`). `check` warns when a report has another; rebuild with `baseline` after a change that redefines a
  counter.

### In the release gate

Step 4b of the release skill: `ratchet.mjs run --own --app dist/<v>-rc/export/Netnyahoo.app` must print `ratchet: ok` before
publishing. Counts need no perflab lock (they aren't timings), but run it on a Mac that isn't busy with someone's timing
run. After a release that cut counts, `ratchet.mjs lower` and commit.

### Node instruction counts

Valgrind doesn't run on macOS arm64, and `perf` doesn't exist. What works without root is the CPU's own counter through
`/usr/bin/time -l` (`instructions retired`, from `proc_pid_rusage`). Under `node --predictable` (one thread, no concurrent
compiler) a whole `micro-bench.mjs instr` process repeats within 0.3%, and the difference between a run of 10 rounds and
a run of none, divided by 10, within 0.5% on a quiet machine (289–292 million instructions a round in 6 runs) and 1.7%
with the machine loaded (295–300 million in 4 runs). That is too loose to detect a 2% change, so it gets a 4% tolerance, and the exact builtin-call counts (`ops.mjs`) are the sharper tool. `kpc`
and `xctrace` counters need root or Instruments and weren't tried.

### Do the counts track wall-clock?

`ratchet-proof.mjs` runs one workload on two revisions of the source, exported with `git archive` (nothing is checked
out), and prints the exact builtin calls and the median wall-clock side by side. The pair is `f3417151^` and `f3417151`,
the commit "Strip and sidebar entries look tabs' groups and splits up by index", which stopped `sidebarEntries` from
searching every split for every tab on a title change:

| tabs | builtin calls (exact) | median wall-clock |
|---|---|---|
| 200 | 2,691 → 861 (−68%) | 0.28–0.32 → 0.05–0.12 ms (−62 to −83%) |
| 1000 | 49,271 → 4,121 (−92%) | 19–66 → 0.47–0.60 ms (−97 to −99%); 3.1 → 0.16 ms (−95%) on a calmer machine |

(Five runs under the perflab lock with the load average at about 300, so the milliseconds are inflated and spread out;
the 3.1 → 0.16 ms line is one run on a calmer machine. The calls are the same in every run.)

Both fall, by more on the bigger window, as a quadratic-to-linear fix predicts, and the time falls further than the
calls because a call isn't weighted by what it costs (the old code's calls were array scans). **Proven:** builtin calls
for Node store work: a fix that cut the work cut the count by 68% to 92% and the time by 62% to 99% in every run, and
`ratchet-proof.mjs` repeats it. **Not proven:** the app-side counts (commits, renders, host updates) against
milliseconds. They are the same kind of count and `render-bench.mjs` times each component's renders, but no fix since the
probe existed has been timed by the native bench with the machine quiet enough to see it; the first one should be added
here with its before and after. Until then a drop in a React count is a drop in work, and a rise is a regression only in
the sense that something now renders, commits or stores more than it did.

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

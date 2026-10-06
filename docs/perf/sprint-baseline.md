# Speed sprint baseline: 0.2.27, per journey

Lab numbers for the four journeys in [sprint.md](sprint.md), on the shipped 0.2.27 build
(`dist/0.2.27/export/Netnyahoo.app`, commit dfff107f, NATIVE_API 8), 2026-10-06, hidden instances, display awake
(`caffeinate -d`), perflab lock held for every timing run (released between rounds).

Cells are median, p75 (nearest rank), min–max, n. Phase rows are differences of samples taken in the same run.

## Headline

1. **A launch with a big saved session takes twice as long as a one-tab launch**, and nearly all of the difference is
   in JS: window with its content at 1070 ms against 490 ms, first paint 1257 ms against 615 ms. The native part before JS barely moves
   (499 ms against 387 ms). A real user's profile is bigger than the lab's one tab; the field's p75 of 3.4 s is not
   explained by it alone (lab big session, warm: 1.1 to 1.3 s).
2. **A cold launch costs 4.5 to 13 s, almost all of it before any JS runs.** The first launch of a freshly
   signed or cloned copy of the app took 5.1 to 6.5 s to the window in all four big-session rounds (5.4, 6.5, 5.1,
   5.5 s) and 6.9 s to `firstWindow` in js-bench run 0, against 0.46 to 0.6 s for the same app launched again.
   `--fresh-copy` (a new APFS clone for every launch) reproduces it every time: 4.5, 4.6, 4.8 s on a calm machine,
   then 8 to 9 s as the load rose (5.7 to 13.6 s in an earlier round at load 18 to 30). 98% of that time is "launch →
   JS running", before the bundle evaluates. Field launches after an install, an update, a reboot or a long idle are cold ones, and the field's
   median (2.8 s) sits between warm and cold. This is the first thing to chase for J1 (XprotectService and amfid were
   among the busiest processes in those windows; not yet confirmed as the cause).
3. **Warm, one tab, a quiet machine, launch is already 0.46 s to the window and 0.62 s to first paint**; 79% of it is
   native start → JS running (387 ms).
4. J3 (27 ms) is already near its floor: 10 ms of JS plus the visibility change and two frames.
5. J2's per-keystroke cost is 6.2 ms median and matches the field (p50 6 ms), so the lab is representative there.
   Cmd-T → typeable and J4's Enter → commit → first contentful paint have no lab measurement (end of this file).

## Machine state

- Apple M5 Pro (5 performance + 10 efficiency cores), 48 GiB, macOS 27.2, AC power (battery 11%, charging).
- Rebooted 10 minutes before the first run. `dasd` was at 93% CPU when the first round started (post-boot
  housekeeping); load average 8 to 9 and falling during the first native-bench round.
- From about 10:28 other agents' builds (SWBBuildService, ld, hermesc), Netnyahoo test instances (ratchet,
  field build), OrbStack and XprotectService ran at the same time: load average 25 to 50. native-bench now records
  the 1-minute load average with every launch (`load` in results.json). The rounds below say which load they ran at.
  The "calm" rounds ran at load 7 to 9 (still not an idle machine; a bare machine has load 2 to 4).
- The owner used the Mac during the session round: 82 to 94 s of input in the 120 s of idle windows. The idle rows
  of that round (not part of any journey, not reported here) include their input.

## J1 Launch

native-bench `--only launch`, rows count from just before `open -g -n` (t0).

| Row | 1 tab, warm, round A (n=8) | 1 tab, warm, calm repeat (n=8, load 8) | big session, warm (n=16, load 7 to 13) | big session, first launch of the copy (n=4) |
|---|---|---|---|---|
| window shown | 462 ms, p75 468, 434–508 | 478, p75 497, 461–560 | 615, p75 636, 508–1253 | 5110–6543 |
| JS running | 387, p75 388, 328–395 | 396, p75 417, 344–448 | 499, p75 522, 429–616 | 5019–6295 |
| window with its content | 490, p75 502, 459–557 | 536, p75 553, 479–598 | 1070, p75 1111, 1032–1566 | 5557–7306 |
| page's first frame | 586, p75 597, 552–613 | 621, p75 652, 579–713 | 1197, p75 1235, 1100–1694 | 5688–7483 |
| page's first paint (FCP) | 615, p75 631, 589–642 | 664, p75 693, 628–835 | 1257, p75 1306, 1140–1843 | 5834–7814 |

The big session is `seed.mjs`: 200 tabs in two profiles, 5000 history entries, 1000 bookmarks. Only its
active tab (the bench page) loads; the other 199 are lazy (2 page targets after launch in every run).

Phases (medians, same runs):

| Phase | 1 tab, warm (round A) | big session, warm |
|---|---|---|
| t0 → JS running (process start, framework, NNCore, bundle eval) | 387 ms (79% of content) | 499 ms |
| JS running → window's content committed (first React commit) | 113 | 601 |
| content committed → page's first frame | 94 | 107 |
| first frame → first paint | 30 | 70 |

Where the big session's extra 580 ms is: 110 ms before JS (hydrating session, history and bookmarks at import) and
490 ms in the first render of the window (the sidebar and the 200-tab store).

The field metric (`perf_launch`) is process start → first React effect (`firstWindow` mark), not the window on
screen. js-bench has that mark, with the probe on and the same big session (n=3, run 0 was cold):

| js-bench startup phase | median (min–max) |
|---|---|
| open → process start | 96, 73, 131 ms |
| process start → bundle start | 394 ms (339–6451; run 0 cold: 6451) |
| bundle evaluation | 119 (97–132) |
| bundle end → first commit | 156 (120–207) |
| first commit → `firstWindow` | 60 (44–71) |
| **process start → `firstWindow`** (the field's definition) | warm runs 600 and 729 ms; cold run 6861 ms |

Lab, warm, field definition: about 0.6 to 0.7 s, against the field's p50 2.8 s and p75 3.4 s. A gap of 4x means
the field launches are mostly not the warm ones the lab measures.

Cold launches, `--fresh-copy` (every launch from a new APFS clone of the app, same signature):

| Round | window | JS running | first paint | load |
|---|---|---|---|---|
| launches 0 to 2 | 4527, 4598, 4846 ms | 4451, 4525, 4746 | 4879, 4800, 5076 | 5.9 to 7.2 |
| launches 3 to 5 | 9346, 8760, 8326 | 9132, 8567, 8204 | 9751, 9202, 8618 | 8.7 to 17.2 |

An earlier round at load 18 to 30 gave 5.7 to 13.6 s. After JS is running, a cold launch takes the same 0.1 to 0.4 s
as a warm one.

## J2 New tab and the command bar

| Row | Source | Result |
|---|---|---|
| keystroke → suggestions committed, JS time of one `driver.type` | js-bench `typing` (200-tab, 5000-history seed, probe on; 30 keys of a URL, 60 ms apart) | 6.2 ms, p75 7.4, 2.2–16.4, n=90 (3 runs) |
| per keystroke, React work | same | 4.1 commits and 63 renders per key (122 and 1897 for the 30 keys), 1 store update per 30 keys |
| new tab: store `newTab` → page's first paint | native-bench session | 103 ms, p75 110, 85–125, n=10 (2 runs) |
| new tab: → page's first frame | same | 87 ms, p75 92, 72–101, n=10 |
| JS cost of the `newTab` call | js-bench `openClose` (20 tabs per run) | 6.9 ms, p75 16.0, 5.7–26.6, n=60 |
| new window: `openWindow` → on screen / first frame / first paint | native-bench windows + session | 58 ms (p75 69, 32–97), 116 (p75 151, 82–242), 136 (p75 163, 94–258), n=22 |

The field's `perf_omnibox` p50 is 6 ms, the same quantity as the first row (keystroke in JS to the layout effect
after the commit), so the lab and the field agree. Each key renders 63 components in 4 commits; `SuggestionIcon`,
`SuggestionRow` and `Favicon` lead the render counts.

Missing: ⌘T → command bar open and typeable. No lab row covers the key event reaching JS, `openPanel` →
committed, or the input getting focus. The "new tab" rows start at the store call, not at the key, and open a page
rather than the bar. The omnibox driver (`nn.omnibox`) is only registered when the data folder holds a
`perf-probe` file, which native-bench's instances don't have, so a native phase needs the probe on (and a way to
inject the ⌘T key, or the menu command). Estimated at 2 to 3 hours, so not built here.

## J3 Tab switch

| Row | Source | Result |
|---|---|---|
| click/shortcut handler → page visible and 2 frames drawn | native-bench session (16 per run, among 20 tabs) | 27 ms, p75 29, 22–41, n=32 (2 runs) |
| JS time of the switch (`setSelection` + `activate`) | js-bench `switchTabs` (200-tab seed, probe on) | 10.3 ms, p75 12.6, 5.3–14.8, n=36 |
| React work per switch | same | 2 commits, 56 renders, 2 store updates |
| samples left out (page couldn't paint) | native-bench | 0 |

Phases: about 10 ms of JS, then roughly 17 ms of native visibility change and the two frames that "drawn" waits
for (a frame is 16.7 ms at 60 Hz, 8.3 ms at 120 Hz). Not covered: the click's mouse-down reaching the handler, and a
switch to a tab whose page is not loaded yet (js-bench's first pass wakes them but doesn't time them).

## J4 Navigate

Nothing measures Enter → navigation committed → first contentful paint. Closest rows:

| Row | Source | Result |
|---|---|---|
| new tab → first paint of a local static page (store `newTab`, no network) | native-bench | 103 ms, p75 110, 85–125, n=10 |
| JS time of a page load (`navigate` to the heavy page, tab loading → loaded) | js-bench `pageLoad` | 17 commits, 751 renders, 138 ms of JS tasks, 21 store updates (3 runs); `loadMs` 3147 ms, dominated by the test page's artificial image delays, not by us |

Missing: Enter (the `submit` of the omnibox driver) → `isLoading` / URL committed in the store → the page's FCP,
and the engine's commit → first paint share. Building it needs the probe-enabled omnibox driver (as for J2) plus
the page's FCP over CDP, which native-bench already reads: about 2 hours, not built here. The field events from
8d6e466f (`perf_journeys`) are the other agent's.

## Commands

All from the repo root. `$S` is the scratch dir; the 0.2.27 bench bundle is kept at `dist/0.2.27/bench/main.jsbundle`
(built from the tree, NATIVE_API 8, same as 0.2.27).

```sh
A=dist/0.2.27/export/Netnyahoo.app
B=dist/0.2.27/bench/main.jsbundle
# warm, one tab, plus the session and windows rows (J1, J2 new tab, J3)
scripts/agent/locked perflab -- node apps/browser/scripts/perf/native-bench.mjs --app $A --bundle $B --out $S/native \
  --port 9610 --only launch,session,windows --launch-runs 8 --runs 2
# JS counts and per-key / per-switch JS time (J1 startup marks, J2 typing, J3 switchTabs, J4 pageLoad), 200-tab seed
scripts/agent/locked perflab -- node apps/browser/scripts/perf/js-bench.mjs run --app $A --bundle $A/Contents/Resources/main.jsbundle \
  --label 0.2.27-base --runs 3 --port 47821 --out $S/js        # an 11-character label puts the instance on port 9610
# launch with the big saved session (the first launch of the copy is cold: drop it, or report it apart; use 9 runs)
scripts/agent/locked perflab -- node apps/browser/scripts/perf/native-bench.mjs --app $A --bundle $B --out $S/native-big \
  --port 9614 --only launch --launch-runs 9 --seed big
# cold launches: every launch from its own clone of the app
scripts/agent/locked perflab -- node apps/browser/scripts/perf/native-bench.mjs --app $A --bundle $B --out $S/native-fresh \
  --port 9612 --only launch --launch-runs 6 --fresh-copy
```

Both new flags are `--only launch` options in `native-bench.mjs` (`--seed big`, `--fresh-copy`); each launch row now
also carries `load`, the 1-minute load average when the launch ended.

## What this does not settle

- Warm numbers (rounds A and the repeat) were taken with the machine 10 to 25 minutes after a reboot and other agents
  starting work; a repeat on a quiet machine should tighten them. Their ranges are narrow (±8%).
- The cold-launch cause (page-in of 1.2 GB of framework, XProtect or amfid assessment of a new path, a notarization
  check) is not separated yet. The next step is `sample` of a cold instance's first seconds and a fresh clone with
  the same inodes touched first (`cat` the framework) to tell page cache from policy checks.
- p75 uses small n (8 to 16); treat it as a range, not a percentile.

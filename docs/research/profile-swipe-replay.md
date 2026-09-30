# Recorded profile swipes: 2026-09-30

The owner's recording shows complete horizontal gestures with no response: the first three forward
swipes fail and the fourth switches. The first reverse also fails. The recording does not identify
the running version. The earlier routing fix (`b54f49a7`) shipped in 0.2.12; this audit does not
establish that the owner's process contained it, or that the remaining reported failure is fixed.

The sanitized input fixture contains only motion, timing and window geometry. It contains 24 direct
gestures plus momentum, 1,325 events total. The sidebar is 190pt wide. The sparse fixture has two
pinned pages, two ordinary pages and an active New Tab, with the cursor over the blank sidebar area.
Seven stand-alone MayBegin preflights outside those gestures are omitted. This does not reproduce
the WindowServer's original event-delivery context.

Run against an isolated Debug build with Metro available:

```sh
node apps/browser/scripts/profile-swipe-replay.mjs <Debug-Netnyahoo.app> \
  --only=sequence --rows=2 --dispatch=app --keep-data
```

The simulator restores line deltas first, fixed deltas second, and point deltas last: CG's setters
rewrite related fields. Setting line deltas last changed a requested -13pt into -8pt. The script
checks every decoded AppKit X/Y delta, direct/momentum phase and app monitor entry; the old harness
fails those checks on 1,272 events. Input timestamps are restored, and wall-clock delivery lateness
is reported separately.

## Verified

- Build and workspace typecheck pass; 11 motion/profile unit tests pass.
- The existing nine profile regressions pass, including ordinary and full-screen stale sources,
  overlapping windows, rapid reversals, cancellation and web-content scrolling.
- All 24 recorded gestures pass individually through the app monitor in a scrollable sidebar.
- Fresh full-sequence runs pass in both the scrollable and sparse fixtures: 1,325 exact decoded
  inputs, zero monitor misses, 24 releases, and eight alternating persisted profile changes. The
  source window stays fixed while the React root moves between Chrome windows.
- In the sparse run, maximum dispatch lateness was 86.94ms. These tests establish routing and
  profile commits, not exact physical-input animation timing.
- The native sidebar document and clip widths are both 190pt. No false horizontal-overflow
  rejection occurred. Do not change native scroll arbitration based on that unproven hypothesis.

## Still open

A longer run after the 24 independent cases missed one -2pt changed event at the app monitor.
All 24 begins and releases arrived, but the fidelity assertion correctly failed. This is not a
reproduction of the owner's missing complete gestures.

The separate vertical-sidebar probe leaves the clip at zero in both direct and app dispatch,
despite all events matching and passing through the tracker. Its failing movement assertion is
retained, with trace evidence. Native input forwarding needs further validation; do not report
that probe as passed. Real web-content scrolling and the tracker ownership checks do pass.

## Routing fix verified after the audit

Recognition previously depended on constructing an NSEvent for the current profile window. If that
copy failed, it recognized against the stale source window and found no swipe target. Recognition
now resolves the moving root's current window and converts the pointer location directly, retaining
the original deltas, phases and timestamps. Event copying is used only for native scroll forwarding.

The tenth hidden-instance regression injects copy failure: the legacy route misses the reverse
(`noTarget`, profile stays Work), then the fixed route immediately returns to Personal with the same
inputs and failure. All ten regressions, the Debug build, workspace typecheck and 11 unit tests pass.
A fresh sparse replay passes all 1,325 decoded events, all 24 releases and eight profile commits
through the app monitor. A second run captured the isolated app at 30 fps; extracted frames show
the first forward landing and repeated reversals, with 523 encoded frames over 18.07 seconds.
Evidence is in `output/profile-swipe/replay-audit/routing-fix-*.json` and
`output/profile-swipe/routing-fix-capture/`.

This establishes the copy-failure routing fix; it does not establish that copy failure caused the
owner's original recording. Physical input in the installed app still needs confirmation after the
next release. The vertical probe limitation above remains unchanged.


## Follow-up recording and animation race

The 12:20 recording was preserved at `output/profile-swipe/owner-2026-09-30-1220/capture.mov`
and extracted at 30 fps (441 frames, 14.68 seconds). Sidebar tint changes at approximately 2.33,
2.97, 3.93 and 6.00 seconds; it then stays on Personal through the end. Notification Center also
appears. There is no input log in this recording, so motionless intervals alone do not establish
which gestures reached the app. The installed process was still running from before the unshipped
`b424d923` native fix.

A separate production-class regression establishes another race: a release queued its spring
while waiting for a coordinate rebase; a new drag halted animation, but applying the rebase
started the old queued spring during that drag. The deferred spring now checks the existing
gesture generation, preserving the rebase itself. The saved original source fails this regression;
the fixed production class passes and the next drag releases and switches normally. All eleven
hidden-instance regressions pass, including real RN Animated remaining motionless for 120 ms
after the new drag begins. Evidence: `output/profile-swipe/replay-audit/pager-race-*.{json,log}`.

## Sidebar hit routing

An exact replay then exposed another native miss: AppKit returned a page renderer for a sidebar
point at (109.9, 465.1), outside that renderer's frame (190, 7, 1163, 806). The sidebar pager
contained the point, but normal ancestor matching rejected it. This dropped a whole gesture.

The tracker now recovers only an out-of-bounds renderer hit when the visible pager contains the
point in the same React root, and the pager subtree's own hit contains the point and resolves to
that pager. Real page hits and ordinary sidebar hits retain their routing. A same-build legacy
control reproduces the miss; the guarded fallback switches profiles. The full replay passes all
1,325 inputs, 24 releases and eight alternating profile commits, and all 14 hidden-instance checks
pass. Evidence: `output/profile-swipe/replay-audit/renderer-{hit-failure,guard-native,guard-replay}.json`.

A separate rapid test intermittently paused for 131 ms between the last motion and release. It
therefore emitted zero release velocity and correctly returned a 62 pt drag to its starting
profile. The fixture now preserves intended event timestamps independently of delivery delays,
as the recorded replay already does. The failed trace is retained as `rapid-delayed-release.json`.

These fixes are included in 0.2.14. A physical trackpad check requires updating the installed app.

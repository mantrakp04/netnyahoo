# Profile motion: Zen reference and native settle

The owner reported that 0.2.14 still felt rough and asked for a Zen comparison. Zen was not installed;
this comparison uses its official implementation, not a capture or physical-input measurement of Zen.

## Reference

Zen's source tree was inspected at `95077d3377f2c36acc7f41234586e73adb517f52`:

- [ZenSpacesSwipe.mjs](https://github.com/zen-browser/desktop/blob/dev/src/zen/spaces/ZenSpacesSwipe.mjs):
  gesture lifecycle, quarter-width success threshold and velocity contribution of 0.5.
- [ZenSpaceManager.mjs](https://github.com/zen-browser/desktop/blob/dev/src/zen/spaces/ZenSpaceManager.mjs):
  workspace strips move with transforms and settle through the motion animation system.

The useful difference was animation ownership. Netnyahoo's spring and its animated value were driven
by JavaScript, so a busy JS thread stopped the visible sidebar. We kept the existing tracking scale,
rubber band, flick decision, spring parameters and haptics, and moved the value and spring to native
Animated. Drag decisions still pass through JS; this is not a fully native gesture controller.

## Fix

Native springs do not provide a synchronous per-frame position in JS. Interruptions therefore stop
the spring and obtain its actual native position, buffering the latest cumulative drag and release
until the snapshot arrives. Gesture generations reject old snapshots, queued settles and completions.
Coordinate rebases wait for the snapshot when necessary. A later dot selection supersedes a pending
selection, including a click back to the current profile. The profile window changes after the spring
lands rather than from a per-frame JS listener during the remaining motion.

## Frame evidence

`profile-motion-stall-test.mjs` releases three alternating swipes, waits 80 ms, and blocks JS for
300 ms. Window-only ScreenCaptureKit captures include only the hidden test process, at 30 fps.
The 190 × 260 sidebar crop is compared frame by frame; RMS difference above 1.5 counts as motion.

- Old JS-driven animation: position remains identical across the 300 ms stall; the capture shows
  approximately 300–367 ms without sidebar motion. `output/profile-swipe/zen-motion-baseline/`.
- Native animation after startup: 8/9, 8/9 and 9/9 frame intervals move within the three 300 ms stalls.
  The final stationary frames are the landed page. All three expected profiles are committed and no
  gesture, pending snapshot or spring remains active. `output/profile-swipe/zen-motion-native-warm/`
  contains the video, frame timestamps, results, pixel differences and sampled frame sheet.
  A final neutral-tab capture also passes, with 8/9, 6/9 and 9/9 moving intervals
  (`zen-motion-native-final/`); its reverse lands sooner within the blocked interval.

An initial cold fixture still paused on the reverse. Sampling its main thread identified uBlock's
startup session-rule indexing inside Chromium, not a queued pager rebase or disconnected animation
graph. The steady-state test waits ten seconds after UI readiness; it does not disable the blocker.
Native animation cannot avoid unrelated work that blocks the macOS main thread.

## Regression checks

Nine production-class cases exercise native value ownership, deferred rebases, buffered releases,
double reversal, late completion, dot interruption and reset/disposal. The original source passes
only one case; the fix passes all nine. The immediate pre-click fix passes eight and fails the new
pending-selection regression. All 17 real-app cases pass, including asynchronous RN snapshots, a
completion queued while JS is blocked, pending dot selections and real web-content scrolling. These tests supplement pixel measurements; they do not prove
the feel of physical trackpad input in the owner's installed browser.

The recorded vertical-sidebar probe's zero clip movement is a pre-existing harness limitation,
documented in `profile-swipe-replay.md`. Its events pass through gesture recognition without being
swallowed. Preserve the failing evidence rather than counting that probe as a pass.

The web scrolling fixture activates its seeded tab before navigating it. A loaded CDP target can
be a background tab, which has no visible swipe pane; an automatically opened startup tab exposed
that fixture assumption. The test now asserts the active tab and retains UI/root evidence on failure.

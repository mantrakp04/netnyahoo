# Native profile paging — 0.2.18

0.2.17 moved settling to native Animated but still sent each drag event through JavaScript. The
owner continued to report lag and missed reversals. 0.2.18 moves the gesture controller into AppKit;
React continues to render the sidebar, top strip, dots and tint.

## Motion ownership

`NNSwipe` forwards phased inputs synchronously to the window's `NNPager`. MayBegin interrupts a
settle at its current position. Horizontal recognition starts native tracking, using Dia's half-speed
movement, 100 ms velocity history, 5 pt/s flick threshold and 0.25 s critically damped spring. A
screen display link updates the position at the screen's refresh rate; a 60 Hz timer is the fallback
while unattached. Native direct events drive the existing Animated transform and colour graphs.
No per-frame drag callback needs JavaScript.

Profile pages stay mounted in absolute slots. Selection is announced at release so the target
profile's browser can paint during settling. Stable IDs, monotonic sequences and React acknowledgements
prevent an older selection from rewinding motion. Dots and rapid Next/Previous commands interrupt
from native state. External store selection, profile reordering and deletion reconcile by stable ID.
Single-profile windows retain their native area with recognition disabled. Older binaries keep the
existing JavaScript pager as a compatibility path.

## Verification

- Latest Debug build and workspace typecheck pass.
- `profile-swipe-test.mjs`: 21/21 hidden-instance cases, including reversals, window retargeting,
  blocked JavaScript, latest dots, rapid shortcuts, external selection, reorder, deletion and real
  web-content scrolling.
- `profile-pager-race-test.mjs`: 9/9 compatibility cases for the legacy pager.
- `profile-motion-stall-test.mjs --native-input`: 55 AppKit inputs, three alternating drags and three
  280 ms JavaScript stalls. Correct final profile; native controller idle and selection acknowledged.
- Full-size window-only capture at 30 fps: **8/8, 8/8 and 7/7 frame intervals move inside the three
  stalls**, including both reversals. Sidebar crop RMS changes are 12.1–15.2; resting median is 0.0,
  p95 0.07. This measures 30 fps motion, not 120 fps delivery or physical trackpad feel.

Capture, timestamps, native input results, pixel metrics and frame montage are in
`output/profile-swipe/native-controller/`. The fixture warms both profiles and leaves the ad blocker
on. First-use Chromium helper creation can still block the macOS main thread; a cold recording and
a Mission Control thumbnail capture are retained separately and excluded from this measurement.

The recorded vertical-sidebar clip probe remains a pre-existing harness limitation documented in
`profile-swipe-replay.md`. It is not counted as a pass. Real web scrolling and gesture ownership
checks pass. The owner's physical trackpad comparison remains an installed-build check.

# Native profile paging — 0.2.18

0.2.17 moved settling to native Animated but still sent each drag event through JavaScript. The
owner continued to report lag and missed reversals. 0.2.18 moves the gesture controller into AppKit;
React continues to render the sidebar, top strip, dots and tint.

## Motion ownership

`ACSwipe` forwards phased inputs synchronously to the window's `ACPager`. MayBegin interrupts a
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

The replay, race and motion-stall harnesses named here were removed on 2026-10-01 (`docs/testing.md`);
`profile-swipe-test.mjs` stays.

- Latest Debug build and workspace typecheck pass.
- `profile-swipe-test.mjs`: 21/21 hidden-instance cases, including reversals, window retargeting,
  blocked JavaScript, latest dots, rapid shortcuts, external selection, reorder, deletion and real
  web-content scrolling.
- Final `profile-swipe-replay.mjs --only=sequence --dispatch=app` with the committed bundle: all
  1,325 owner-recorded inputs, 24 releases and eight alternating profile commits pass at original timing.
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

The recorded vertical-sidebar clip probe remained a limitation of the replay harness and was not
counted as a pass. Real web scrolling and gesture ownership
checks pass. The owner's physical trackpad comparison remains an installed-build check.

## Shipped export

0.2.18, build 26, ships from tag `v0.2.18` (`bb8f0d70`), with the completed tab-move crash guard
and its matching CEF distribution. App and DMG notarization passed. The final export passes
19/19 smoke checks plus clean quit, signature and update-feed checks, with no screen-lock skips.
An earlier run missed the autofill suggestion; a fresh full run passes it. Targeted ⌃2 then ⌃1
inputs in the exported app persist Work then Personal. This verifies shortcuts and selection,
not physical trackpad feel.

Published asset hashes and source identity are recorded in `dist/0.2.18/verification.json`.
The update feed, public download, release notes, homepage version and sitemap were checked live.
The tweet image crops the real neutral-page capture of the verified native controller; it redraws
no product pixels.

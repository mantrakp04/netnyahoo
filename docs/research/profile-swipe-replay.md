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

The installed version and a physical-trackpad check of the current release remain necessary.
No additional production gesture fix was made during this audit.

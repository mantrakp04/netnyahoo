# Speed sprint (October 2026)

Modeled on claude.dev's "How we made claude.ai 3x faster in two weeks": pick the journeys people spend their time in,
measure each from the user's action to the rendered result, give every slow stretch a number Claude can drive down,
prove the number tracks what users feel, then lock the win in with a ratchet.

## Journeys

Chosen from PostHog (30 days, opt-in sharing, small n): launches, command bar opens and suggestions, tab use
(158 tabs opened in usage_counts) and profile switches dominate.

| | Journey | Starts | Ends | Field today | Lab today |
|---|---|---|---|---|---|
| J1 | Launch | process start | window with content, then the restored tab painted | p50 2.8 s, p75 3.4 s (perf_launch) | ~0.77 s window |
| J2 | New tab / command bar | ⌘T | bar typeable; each keystroke's suggestions shown | keystroke p50 6 ms (perf_omnibox) | new tab ~105 ms |
| J3 | Tab switch | click or shortcut | the tab's page on screen | not measured | ~28 ms |
| J4 | Navigate | Enter | our share: navigation started; engine share: commit → first paint | not measured | not measured |

The field/lab gap on J1 is the first thing to explain: lab launches restore a tiny session on a warm disk.

## How we work

- **Benches.** `native-bench.mjs` measures wall-clock, one at a time, under `scripts/agent/locked perflab`.
  `js-bench.mjs` and `render-bench.mjs` count work (commits, renders, store updates, tasks).
- **Ratchets.** Deterministic counts become ceilings in `apps/browser/scripts/perf/ratchet.json`. They can only go
  down, and they are checked in the release gate.
- **Field data.** Every release, read the per-journey summary events in PostHog (`field-journeys.md`).
- **One agent per slow stretch.** Each agent's loop: benchmark → fix → before/after → ratchet → next spot.
  User-visible changes come to the owner with before/after captures.

## Documents

- `sprint-baseline.md`: lab numbers per journey.
- `launch-critical-path.md`: J1 timeline and projects.
- `render-census.md`: renders, hooks and selectors per interaction.
- `field-journeys.md`: field events and queries.

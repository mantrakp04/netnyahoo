# Growth log

A running log of what we change on netnyahoo.com to get more Mac downloads, and what happened. Newest entry
at the bottom. Events and flags live in `apps/site/src/scripts/analytics.ts`; PostHog (EU) is the source.

## Baseline — 2026-09-29

536 visitors so far, 91% from X.

| Segment | Share | What they do |
| --- | --- | --- |
| Phones | 52% | 0.7% click Download. 13 s median visit. Most tap "Menu". |
| Macs | 33% | 3.35% click Download. 164 of 176 reach the "In office" screenshot, only 42 reach the closing Download. |
| Windows / Linux | ~15% | Can't use it: the app is Mac-only (Apple Silicon, macOS 14+). |

The Big Yahu game button is the most-clicked element on the page.

Readings: phones are half the traffic and can't install anything, so a phone "Download" is a dead end. Macs
look at the product shot and then most of them leave before the next Download button, which is a whole page
further down.

## 2026-09-29 — Send to my Mac, Mac-only note, download band test

Shipped (site only, not yet deployed):

- **Phones and tablets:** every Download button (header, hero, menu, closing, release notes) reads
  "Send to my Mac". It opens the share sheet with `https://netnyahoo.com/?ref=share`; with no share sheet, or
  when it's dismissed, it copies the link and says "Link copied" (if the browser refuses the clipboard after a
  dismissed sheet, the button becomes "Copy link" for one more tap). A "Mac only" line sits under the buttons.
  Event: `send_to_mac_clicked { location, method: share|copy, outcome: shared|copied|blocked|failed, share? }`.
  Returning visitors show up as `$pageview` with `ref=share` in the URL.
- **Windows / Linux:** Download stays, plus "Mac only for now. Follow the case on GitHub." under the hero and
  closing buttons (`github_clicked { link: notify }`). Event: `non_mac_visit { os }`, once per session.
- **Download band experiment** on Macs (below).
- PostHog: `capture_dead_clicks: true`.

How visitors are sorted: `apps/site/src/components/Visitor.astro`, before first paint, sets
`<html data-device="phone|mac|other">`. Phone = mobile UA, iPadOS, or touch plus a coarse pointer at 1024px
or narrower.

### Experiment: `download-band`

- **Hypothesis:** Macs read the "In office" screenshot and leave before the closing Download. A Download
  band right under that screenshot ("That was a screenshot. This is the app.") raises the share of Mac
  visitors who click Download.
- **Flag key:** `download-band`. **Variants:** `control` (no band), `band` (the band is shown). 50/50.
- **Who's in it:** Mac desktops only. The page calls `posthog.getFeatureFlag("download-band")` only when
  `data-device="mac"`, inside `posthog.onFeatureFlags`, and never when flags failed to load. That call records
  `$feature_flag_called`, which is the exposure. Phones, tablets, Windows and Linux never call it.
  No flag, a load error or a blocked PostHog shows control.
- **Primary metric:** unique `download_clicked` per exposed Mac visitor (any location). Secondary:
  `download_clicked` with `location = office-band`, and the share reaching the closing section
  (`section_viewed { section: closing }`).
- **Stopping rule:** run until each variant has at least 300 exposures, and at least 7 days to cover the
  weekly cycle. Don't call it early on a good-looking day. If traffic is too thin to reach 300 per variant in
  3 weeks, stop and decide on the direction of the effect, noting that it's underpowered.
- **Local check:** `http://localhost:4321/?nnflag=band` (or `control`) forces a variant on localhost only;
  `?nndevice=phone|mac|other` forces the visitor class.

- **PostHog:** experiment 98483 (https://eu.posthog.com/project/287835/experiments/98483), flag 293364,
  launched 2026-09-29 17:23 UTC. Primary metric: funnel on `download_clicked` after exposure (PostHog uses
  `$experiment_exposure`, sent with the flag call). Secondary: `download_clicked` with `location = office-band`.
  Bayesian, test accounts filtered.

Result: _pending._

## Log

- **2026-09-29 17:25 UTC:** shipped the above (site deploy). Checks every 30 min (:13 and :43 local) from the
  owner's session: traffic, conversion by device, `send_to_mac_clicked`, experiment exposures, errors.
- **2026-09-29 19:35 UTC check:** 1,576 visitors so far (473 in the last hour; 91% from t.co), 51% phones.
  - Macs since the deploy: 21/291 clicked Download (7.2%, was 3.35%). Phones: `send_to_mac_clicked` 28 people:
    5 shared, 6 copied, **18 dismissed the share sheet and then the clipboard was refused**; only 1 of them tapped
    the "Copy link" retry, and none got the link.
  - Experiment: control 12/147 (8.2%), band 7/142 (4.9%), P(band wins) 7.7%. Nowhere near the stopping rule;
    no one has clicked the band's own button yet. Checked live: the band shows for `band` and is tagged.
  - Dead clicks: 139 of 236 are on the Big Yahu canvas (WebGL, which PostHog can't see; `yahu_danced` tracks the
    real reaction). Not a bug.
  - **Shipped:** after a dismissed share sheet (or no share sheet and no clipboard), the link now appears in place:
    a select-all field, a Copy button (fresh tap), and "Email it to me" (mailto). Header taps show it under the
    hero's button. Event: `send_to_mac_fallback { location, action: copied|selected|email }`.
- **2026-09-29 ~22:30 UTC check:** ~2,900 visitors (350-470 an hour, still steady; t.co 2,107 of the last 6h).
  - Download clickers 55 all time; since 19:36 UTC, 22 (all desktop: header 11, hero 10, closing 1).
    Mac desktop since 19:36: 15/318 = 4.7%.
  - Phones since 19:36: 42 tapped Send to my Mac, 16 got the link out (5 shared, 11 copied), 26 dismissed the share
    sheet. The in-place fallback shows (one visitor tapped its link field) but no one used Copy or Email; most
    people who dismiss the sheet leave. No change: it's their choice, and the panel costs nothing.
  - Windows 182, Linux 51 visitors since 19:36; 4 clicked "Follow the case on GitHub".
  - Experiment (SQL, since launch): control 16/322 (5.0%), band 16/287 (5.6%). PostHog's cached result (19:35) is
    stale. Band still under 300 exposures, day 1 of 7: keep running. The band's own button: still 0 clicks.
  - New site errors are not ours: `Can't find variable: CONFIG` in `updateFooterPositions` (X's in-app browser
    injects it, iOS 16, Twitter UA) and `window.ethereum.selectedAddress` (a wallet extension). Ignore.
  - Dead clicks: the "In office" screenshot draws 14 (12 people): people expect it to open bigger. Candidate next
    change if it keeps up. Rage clicks 3.
  - App: "Calling the … function has failed" (0.2.11, 2 people) is an unhandled promise rejection from a native
    module call (CodedError). The frames are minified: upload the JS bundle's source map to PostHog to name it.
  - Decision: nothing shipped this round.
- **2026-09-29 ~23:10 UTC, owner's call:** screenshots open full size. The "In office" shot drew 14 dead clicks
  from 12 people. Every screenshot (office and the five pledges) now opens in a lightbox on click or tap:
  - desktop: the whole window, fitted to the screen;
  - phones: 900 px wide, panned to the middle, so it's readable;
  - it closes on tap, click or Escape.
  Event: `screenshot_opened { shot }`. Watch it next to the dead clicks on `img`.
- **2026-09-29 23:17 UTC check:** 2,905 visitors all time. Traffic is tapering: 468/h at 20:00, 347 at 21:00,
  279 at 22:00. The lightbox has only been live ~8 min (26 visitors, no downloads or `screenshot_opened` yet).
  Experiment: band 16/294 (5.4%), control 17/330 (5.2%), even. The band's own button still has no clicks;
  more band-arm downloads came from the hero (14 vs 9). Keep running (under 300 per arm, day 1 of 7).
  No new errors or rage clicks. Nothing shipped.
- **2026-09-30 01:52 UTC check:** 3,299 visitors all time (t.co 1,392 of the last 6h); traffic flat at ~155/h
  since 23:00 (from 468/h at 20:00). 54% phones.
  - Downloads: 66 people all time (50 Mac). Since 23:17 UTC, Mac desktop 7/89 = 7.9% (was 4.7%).
  - Phones since 23:17: 17 tapped Send to my Mac; 6 copied, 1 shared, 11 were blocked (clipboard refused);
    2 used the fallback's "Email it to me".
  - Lightbox: 41 `screenshot_opened` (office 20, address-toolbar 10). It absorbed the office dead clicks.
  - Experiment: control 21/369 (5.7%), band 20/336 (6.0%). Both arms past 300; day 1 of 7, so keep running.
  - App telemetry: 9 opted-in users in 24h (0.2.11 7, 0.2.9 1, 0.2.7 2). One app EXC_BAD_ACCESS report to look at;
    "Calling the <text> function has failed" 6 (needs the source map).
  - Dead clicks: 230 of 267 have no element text (the Big Yahu canvas, as before). Rage clicks 7. Nothing shipped.
- **2026-09-30 03:05 UTC check:** 3,848 visitors all time, 558 since 01:52. Traffic is picking up again
  (152/h at 00:00, 254 at 02:00, 278 in the partial 03:00 hour), still almost all t.co. 59% phones.
  - Downloads: 79 people all time (60 Mac). Since 01:52, Mac desktop 10/131 = 7.6%.
  - Phones since 01:52: Send to my Mac 22 people; blocked 16, copied 4, shared 2; 1 used the fallback's Copy.
  - Screenshots opened 49 times since 01:52 (office 24).
  - Experiment (flag-called persons): band 32/405 (7.9%), control 38/422 (9.0%). No clear winner; keep running.
  - App: 10 opted-in users in 24h; 2 already on 0.2.12. One more "Calling the … function has failed" on 0.2.12
    (the loadUrl race, fixed in 7591eae2, not yet released).
  - "Write to the office" drew 4 dead clicks and 1 rage click, plus 5 rage clicks on an unlabelled button:
    worth a look next.

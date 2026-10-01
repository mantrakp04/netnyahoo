# Growth log

A running log of what we change on netnyahoo.com to get more Mac downloads, and what happened. Newest entry
at the bottom. Events live in `apps/site/src/scripts/analytics.ts`; since 2026-09-30 they go to our own
ClickHouse (see **Telemetry** below; before that, PostHog Cloud EU, whose history was copied over).

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
- **Who's in it:** Mac desktops only. The page asks for the variant only when `data-device="mac"`, and that
  records `$feature_flag_called` (plus `$experiment_exposure`), which is the exposure. Phones, tablets, Windows
  and Linux never ask. Until 2026-09-30 PostHog's flags decided the variant; since the switch the site buckets
  first-party with PostHog's own hash on the visitor id (`apps/site/src/scripts/telemetry/flags.ts`), so every
  visitor keeps the variant PostHog gave them (checked against all 1,318 exposures).
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

## Installs: downloads → first launch → still running

A download isn't an install. What we can count without breaking the privacy promise (added 2026-09-30,
takes effect with the first release after 0.2.13):

- **Downloads:** GitHub's `download_count` for each release's DMG. Sparkle updates are the zip's count.
- **Update checks:** builds after 0.2.13 poll `https://netnyahoo.com/appcast.xml` (`SUFeedURL`). nginx
  (`infra/site/nginx.conf`) answers every request with a 302 to
  `https://github.com/mantrakp04/netnyahoo/releases/latest/download/appcast.xml` and, beside it, mirrors a
  telemetry event `update_check { version, first }` with the day as its timestamp. Only requests whose
  User-Agent is the app's Sparkle (`Netnyahoo/<version> Sparkle/…`) count. Nothing else is passed on: no IP
  (so no country), no headers, no cookie, a fixed `distinct_id` (`update-check`). The redirect never waits on
  the count; if the collector is down or slow, the update still works.
- **First launch:** the app adds `first=1` to its first check ever (`packages/shell/ios/Updater.swift`,
  Sparkle's `feedParameters`). Sparkle checks at the first launch (automatic checks are on in Info.plist),
  so `first` per version ≈ copies of that version that were installed and opened. A first check made while
  offline isn't retried as first.
- **Still running:** a running copy checks at launch (once 8 h have passed since the last check) and every
  8 h, so 1 to 3 checks a day. Copies running on a day are between checks/3 and checks.
- **Test instances** (`NETNYAHOO_BACKGROUND=1` or `NETNYAHOO_DATA_DIR` set: smoke tests, agents) poll GitHub
  directly, so they aren't counted.
- **Copies from 0.2.13 and earlier** still poll GitHub directly. They show up only as the latest release's
  `appcast.xml` download count (all versions together, no days).

Where it's disclosed: Settings › General › "Check for updates automatically", the What's Sent sheet in
Settings › Privacy & Security, and the site's Q&A ("What does it collect?").

**Read the counts:** `node scripts/update-checks.mjs [days]` (reads ClickHouse with the credentials in
`~/.config/netnyahoo/telemetry.env`, see Telemetry). It prints, per version, DMG downloads, first launches,
first/DMG, update downloads and GitHub feed fetches, then checks and first launches per day and version.
Without the env file it prints the GitHub columns. The same query with `node scripts/telemetry-sql.mjs`:

```sql
SELECT toDate(timestamp) AS day, properties['version'] AS version,
       count() AS checks, countIf(properties['first'] = 'true') AS first_launches
FROM telemetry.events
WHERE event = 'update_check' AND match(properties['version'], '^[0-9]+\\.[0-9]+\\.[0-9]+$')
GROUP BY day, version ORDER BY day DESC, version
```

(The version filter drops `0.0.0-selftest`, from a local test of the endpoint on 2026-09-30.)

## Telemetry (since 2026-09-30)

Site analytics, session replays, the app's opt-in telemetry and the update-check count are first-party:
they go to netnyahoo.com and are stored on our own servers (Hexclave, same project as the site). No third
party sees them. The one exception is the footer's "Write to the office" chat, which is still PostHog's
widget: posthog-js loads only when someone clicks it, and only the conversation goes to PostHog.

```
browser / app ──POST──▶ netnyahoo.com/otel/v1/logs ──▶ otel-collector ──▶ ph-clickhouse  (telemetry.otel_logs)
browser ──POST──▶ netnyahoo.com/otel/replay/<session>/<seq>.json[.gz] ──▶ ph-objects (SeaweedFS, replays/<day>/…)
Sparkle ──GET──▶ netnyahoo.com/appcast.xml ──(nginx mirror)──▶ otel-collector
owner's Mac ──▶ netnyahoo.com/_ch/ (read-only ClickHouse user)   netnyahoo.com/_replays/ (token)
```

- **Where it runs:** `infra/telemetry/hexclave.deploy.ts` (ClickHouse, OpenTelemetry Collector, SeaweedFS; all
  private, images pinned by digest) and the routes in `infra/site/nginx.conf`. Only nginx is public. It limits
  bodies (512 KB events, 2 MB replay chunks), rates per visitor (20/s events, 5/s replays), and only accepts
  OTLP logs (no traces or metrics).
- **Format:** each event is an OTLP log record. The body and the `event` attribute are the event name, plus
  `uuid`, `distinct_id`, `$session_id` (site) and every property, under PostHog's names. Senders:
  `apps/site/src/scripts/telemetry/` and `apps/browser/src/telemetry/`. The collector
  (`infra/telemetry/collector/config.yaml`) turns the visitor's address into `$geoip_country_code`/`_name` and
  `$geoip_continent_code`, then drops it. It adds no location to events that carry `$geoip_disable` (the app
  sends it). No IP is ever stored.
- **Tables** (`infra/telemetry/clickhouse/schema.sql`): `telemetry.events` is the one to query (PostHog's
  shape: `uuid, event, distinct_id, session_id, timestamp, properties Map, elements_chain, source`). It unions
  `otel_logs` (new data) and `posthog_events` (PostHog Cloud history, 2026-09-29 09:04 → 2026-09-30).
  `telemetry.logs` holds plain warnings/errors from the site and app (kept 90 days).
  `telemetry.replay_sessions` has one row per recorded session. Events are kept; replays 30 days.
- **Reading it:** `~/.config/netnyahoo/telemetry.env` (not in git, mode 600) has the read-only ClickHouse user
  and the replay token. Use `node scripts/telemetry-sql.mjs "<SQL>"`, `node scripts/update-checks.mjs`, and
  `node scripts/replay.mjs --list` / `<session-id>`. The stats skill's queries are in
  `.claude/skills/stats/queries.md`. Secrets are Hexclave project secrets (`TELEMETRY_*`); a backup is in
  `~/.config/netnyahoo/telemetry-secrets.env`.
- **Checks of the pipeline:** send with service `netnyahoo-selftest` (or version `0.0.0-selftest`); the views
  leave those out.
- **PostHog Cloud** (EU project 287835) is untouched. App versions released before the switch still send
  their opt-in events there. `infra/telemetry/import-posthog.py` loads a Cloud export into `posthog_events`
  (safe to re-run). Export by the time Cloud received events (`created_at`), not by their timestamp: update
  checks carry the day as their timestamp and arrive later. Imported so far: everything received before
  2026-09-30 14:31:00 UTC. Recordings made in PostHog stay
  there: the MCP can't export snapshots, and they expire from Cloud after 30 days.
- **Leftover disks:** a trial self-hosted PostHog (30 Sep) left two detached Hexclave volumes in group
  "posthog": `pgdata` (10 GB, service ph-db) and `redpanda` (5 GB, ph-kafka). Hexclave has no API to delete
  a volume; ask Hexclave support to remove them.

### Parity: what PostHog did, what does it now

| Feature | Before (PostHog) | Now | Checked |
| --- | --- | --- | --- |
| Page views, page leaves (time on page, scroll) | posthog-js | `$pageview`, `$pageleave` with the same `$prev_pageview_*` props | local browser run, then live |
| Clicks | autocapture | `$autocapture` with `$elements_chain` in PostHog's format, `$el_text`, `$external_click_url`; never input values | local browser run |
| Rage, dead clicks, dead swipes | posthog-js | `$rageclick`, `$dead_click`, `$dead_swipe`, same rules and props | synthetic clicks |
| Exceptions | `capture_exceptions` | `$exception` with `$exception_list`, `_types`, `_values`… (site and app) | thrown errors; app harness live |
| Web vitals | `capture_performance` | `$web_vitals` (web-vitals 6.2.2, loaded after the page) | local run |
| Console warnings/errors | PostHog Logs | `telemetry.logs` (site and app) | local run; app harness live |
| Session replay | PostHog recordings, inputs masked | rrweb (@rrweb/record 2.1.6, loaded after the page): inputs and `.nn-private` text masked, no canvas, network or console; sessions over 4 s; kept 30 days | live session replayed with `scripts/replay.mjs` |
| Custom events and `data-track*` props | posthog.capture | same names and props | local run |
| Referrer, UTM, device, OS, browser | posthog-js | same props; UA parsed in the page (matches PostHog on 849 real UAs) | offline check |
| Country | PostHog GeoIP | collector GeoIP, IP dropped | live |
| Visitors and sessions | PostHog ids | same ids reused (posthog-js's stored id), first-party session id | local run |
| `download-band` experiment | PostHog flag 293364 | first-party bucketing with PostHog's hash; `$feature_flag_called` + `$experiment_exposure` | 1,318/1,318 exposures reproduce |
| Support chat ("Write to the office") | PostHog conversations | still PostHog's widget, posthog-js loaded on click only | local run |
| App opt-in telemetry | PostHog `/batch/`, `/i/v1/logs` | OTLP to netnyahoo.com (ships with the next app release) | Node harness against the live endpoint |
| Update checks | nginx → PostHog | nginx → collector | live |
| History (2026-09-29 → switch) | PostHog Cloud | `telemetry.posthog_events`: 76,700 events received by Cloud until 2026-09-30 14:31 UTC, equal to Cloud's count | totals, per-event counts and stats numbers vs Cloud |
| Stats | PostHog MCP / HogQL | ClickHouse SQL (`.claude/skills/stats/queries.md`) | same numbers as Cloud for the migrated window |

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
  - **Shipped (03:20 UTC):** "Write to the office" now opens the chat. `conversations.show()` only revealed
    PostHog's blue bubble in the corner, so the button looked dead (the dead and rage clicks above). Checked live:
    one click opens the message box. Watch `support_opened` and the dead clicks on that button.
- **2026-09-30 ~09:40 UTC check** (first run of the `stats` skill): 5,239 visitors all time, 1,391 since 03:05.
  Traffic climbed through the morning (304/h at 06:00, 317 at 07:00, 388 at 08:00, the best hour yet).
  - Downloads: 113 people all time (88 Mac). Last 24 h, Mac desktop 87/1,399 = 6.2%; Windows 13/729, Linux 10/219.
  - Phones, last 6 h (new panel: Send to my Mac, then Share / Copy link / Email): 15 opened it; share sheet
    dismissed 13, shared 1, copied 7, clipboard blocked 8, email 7. `mac_link_visit` 3 people in 24 h.
  - Installs: GitHub DMG downloads 150 all time (0.2.11 70, 0.2.13 21, 0.2.12 18, 0.2.14 16); Sparkle update zips 23.
    `update_check` is live: 8 copies of 0.2.14 have made their first check (new installs and updates from
    0.2.13, which never set the flag).
  - Opted-in app users, 7 days: 0.2.11 7, 0.2.13 4, 0.2.12 3, 0.2.14 2, 0.2.9 1.
  - GitHub: 19 stars (8 today, 8 yesterday); repo page 5 views in 14 days.
  - Errors: one visitor failed to load the 3D chunk (`error loading dynamically imported module`), which made
    an unhandled rejection; fixed and deployed (abd489e8), the poster stays. The rest is known noise.
- **2026-09-30 12:50 UTC check:** 5,805 visitors all time, 604 since 09:40 (t.co 502, phones 52%). Traffic is
  tapering: 388/h at 08:00 was the peak, then 185, 211, 205, and ~175/h in the 12:00 hour.
  - Downloads: 126 people all time (97 Mac). Since 09:40, Mac desktop 9/160 = 5.6%; Windows 2/94, Linux 2/36.
    Last 24 h, Mac 96/1,544 = 6.2%.
  - Phones since 09:40: the panel opened 12 times (header 10, menu 2); 17 people opened the hero's share sheet
    and dismissed it; 2 emailed the link. No shares or copies recorded. `mac_link_visit` still 3 all time.
  - `github_clicked` 36 (35 people) and `screenshot_opened` 89 (61 people) since 09:40.
  - Installs: DMG downloads 170 all time (+20: 0.2.14 28, 0.2.16 6, 0.2.15 2); Sparkle update zips 27 (+4).
    First launches (`update_check` with `first`): 14 (0.2.14 11, 0.2.15 1, 0.2.16 2); 16 checks today.
  - Opted-in app users, 7 days: 0.2.11 7, 0.2.13 4, 0.2.14 3, 0.2.12 3, 0.2.7 2, 0.2.9 1, 0.2.15 1 (one person
    can appear under several versions after updating).
  - GitHub: 24 stars (13 today, +5 since 09:40). Traffic (GitHub is a day behind): 88 views from 60 people on
    09-29, 50 of them from netnyahoo.com.
  - Errors: 4 Windows visitors got an unhandled `Failed to fetch` when `big-yahu.glb` didn't download (the
    09:40 fix only caught the chunk import). Fixed and deployed (99f6045f); Safari's 2 `Load failed` are
    probably the same fetch. The rest is noise (cross-origin `Script error.`, a wallet). No app exceptions.
    Three local `ExcUserFault` reports (18:14 to 18:19 IST) came from a 0.2.14 test build under `~/Documents`.
    They're IconServices faults inside Chromium's `shortcuts::SetIconForFile`, not crashes.
- **2026-09-30 14:28 UTC: analytics moved off PostHog** (owner's call). The site now sends its events and
  rrweb replays to netnyahoo.com, stored in our own ClickHouse and SeaweedFS ("Telemetry" above). The
  update-check count goes there too; the app follows in its next release. PostHog Cloud's history, 76,700
  events received from 2026-09-29 09:04 to 14:31 UTC today, was copied over; the numbers match Cloud's. The
  next import from Cloud (old app versions) starts at events Cloud received from 14:31:00. Returning visitors keep their id
  and their `download-band` variant, so the experiment carries on. Recordings made in PostHog stay in PostHog.
- **2026-09-30 15:10 UTC check** (first on our own ClickHouse; old app versions read from PostHog Cloud
  through the MCP, events after 14:31): 6,183 visitors all time, 390 since 12:50 (t.co 317, phones 55%).
  Still tapering: 190/h at 12:00, 175 at 13:00, 148 at 14:00.
  - Downloads: 133 people all time (104 Mac), +7. Since 12:50, Mac desktop 9/105 = 8.6%; Windows 0/64,
    Linux 0/16. Last 24 h, Mac 105/1,636 = 6.4%.
  - Phones since 12:50: header panel opened by 9; the hero's share sheet: 7 dismissed, 2 copied, 1 shared,
    1 blocked; closing 2 dismissed. No fallback use. `mac_link_visit` still 3 all time.
  - `github_clicked` 16, `screenshot_opened` 36 (32 people), `notify_clicked` 5, rage clicks 10 (8 people).
  - Experiment: band 48/715 (6.7%), control 49/693 (7.1%). Even; keep running (day 2 of 7).
  - Installs: DMG downloads 180 all time (+10: 0.2.17 7, 0.2.16 +3); Sparkle update zips 30 (+3). First
    launches 21 (+7: 0.2.17 5, 0.2.16 +2). Checks today: 0.2.14 13, 0.2.17 7, 0.2.16 5, 0.2.15 2.
  - Opted-in app users, 7 days: 0.2.11 7, 0.2.13 4, 0.2.12 3, 0.2.14 3, 0.2.7 2, and one each on 0.2.9,
    0.2.15, 0.2.16 and 0.2.17. Since 14:31, Cloud has one 0.2.17 user and no exceptions.
  - GitHub: 25 stars (+1; 14 today). Views on 09-29: 83 from 56 people, 50 of them via netnyahoo.com.
  - Errors: the site's are noise (Brave `Script error.`, a wallet). The app had one real crash: 0.2.15,
    `EXC_BREAKPOINT` from an uncaught NSException (`+[NSApplication _crashOnException:]`), one user, 12:53 UTC.
    The event carries only the crashed thread, so the throw site is unknown; the crash telemetry now gets
    the exception's own backtrace (next release). The local `ExcUserFault` reports are the known IconServices
    faults from test builds.
- **2026-10-01 00:10 UTC check:** 6,537 visitors all time, 393 since 15:10 (t.co 257, direct 126; phones 52%).
  Traffic fell off a cliff at 15:45: ~50 visitors per 15 minutes until 15:30, ~8 after, and a flat ~40/h
  since 16:00. Not a tracking break: pageviews, clicks and other events fell together, the device and referrer
  mix didn't change, and a test visit at 00:04 reached ClickHouse within seconds. The tweet stopped being shown.
  - Downloads: 152 people all time (120 Mac), +19. Since 15:10, Mac desktop 17/106 = 16%; Windows 2/58,
    Linux 0/25. The quieter traffic converts better.
  - Phones since 15:10: header panel 9; the hero's share sheet 12 dismissed, 3 shared, 1 copied; closing 1
    dismissed. `mac_link_visit` 4 all time (+1).
  - `github_clicked` 53 (41 people), `screenshot_opened` 60, `notify_clicked` 8, `support_opened` 2.
    Rage clicks 42 from 19 people; dead clicks 431 from 122.
  - Experiment: band 55/756 (7.3%), control 57/727 (7.8%). Still even; keep running.
  - Installs: DMG downloads 204 (+24: 0.2.18 16, 0.2.17 +8); update zips 40 (+10); first launches 32 (+11:
    0.2.18 7, 0.2.17 +3, 0.2.14 +1). Checks on 09-30: 0.2.14 14, 0.2.17 13, 0.2.18 10, 0.2.16 6, 0.2.15 3.
  - Opted-in app users, 7 days: 0.2.11 7, 0.2.13 4, 0.2.12 3, 0.2.14 3, 0.2.18 3, 0.2.7 2, one each on 0.2.9,
    0.2.15, 0.2.16, 0.2.17. 0.2.18 reports to ClickHouse; Cloud (read through the MCP) had 4 people on
    0.2.11-0.2.17 since 15:03 and no exceptions.
  - GitHub: 27 stars (+2). Traffic still shows 09-29 last (83 views, 56 people, 50 via netnyahoo.com).
  - Errors: none from the app. The site's five are not ours (a Safari extension's adopted stylesheets, X's
    `CONFIG`, a webview's `messageHandlers`, a cross-origin `Script error.`, an I/O read drop).
    0.2.18 includes the NSException throw-site capture (9bc924b0).
  - Infra: ClickHouse answered one stats query with `Too many open files` (errno 24) and several timed out at
    60 s while four queries ran at once. The container likely runs with a low open-file limit; flagged as its
    own task.
- **2026-10-01 00:40 UTC, ClickHouse fixed** (c1a66805, 2e3ceddf, deployed): the `Too many open files` came
  from stats queries reading `events` (FINAL over Map-heavy wide parts, 5 parts in September) on a 2-core
  server; one query alone took 13-30 s and four at once ran out of descriptors. Now: the open-file limit is
  raised at boot, the tables write compact parts below 1 GiB, the reader gets 180 s, and the reader can read
  `system.parts/merges/errors/metrics/asynchronous_metrics/processes`. After the restart each September table
  is one part; six heavy stats queries in parallel finish in 1-4 s with open files flat (47). Ingestion had
  no gap around the 15:45 traffic drop (5-minute counts fall gradually), so that drop was real.
- **2026-10-01 10:05 UTC check:** 7,131 visitors all time, 619 since 00:10 (t.co 438, direct 157, Google 14;
  phones 60%). Steady at 42-91 an hour (peak 05:00-06:00), no further decline.
  - Downloads: 169 people all time (135 Mac), +17. Since 00:10, Mac desktop 15/136 = 11%; Windows 1/78,
    Linux 1/35. Last 24 h, Mac 49/464 = 10.6%.
  - Phones since 00:10: the hero's share sheet 19 dismissed, 3 shared, 1 copied; header panel 7.
    `mac_link_visit` still 4. The 23 dead clicks on "Send to my Mac" are the native share sheet opening
    (no DOM change), not a dead button.
  - `github_clicked` 34 (32 people), `screenshot_opened` 69 (45), `support_opened` 8 (5), `notify_clicked` 9.
    Dead clicks: the Big Yahu canvas 160 (69 people), the hero stage ("Incumbent") 20 (18).
  - Experiment: band 65/803 (8.1%), control 62/762 (8.1%). Dead even.
  - Installs: DMG downloads 229 (+25); first launches 41 (+9); update zips 49 (+9). Today's checks: 0.2.19 12,
    0.2.18 4, 0.2.17 2, 0.2.21 2 (0.2.20 and 0.2.21 shipped this morning).
  - Opted-in app users: 10 in 24 h, 22 in 7 days. Cloud (old versions, read through the MCP) has 3 today, no
    exceptions. One unreleased 0.2.22 is reporting (a release build being tested).
  - GitHub: 27 stars (no change). Views on 09-30: 144 from 81 people; 120 of 14 days' visitors came from
    netnyahoo.com.
  - Errors: none from the app; the site's two are cross-origin `Script error.` (noise).
  - ClickHouse: otel_logs 8 parts (one wide, seven compact), every stats query finished without a timeout.

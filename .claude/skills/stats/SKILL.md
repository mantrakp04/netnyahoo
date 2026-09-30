---
name: stats
description: Netnyahoo's numbers in one short report — site visitors and trend, download clicks and conversion by device, the phone "Send to my Mac" panel, app installs (DMG downloads, first launches from update_check), opted-in app users by version, GitHub stars/traffic, and new errors. Use whenever the owner asks how things are going, "what are the stats", "how many users/downloads/installs", "how's the site doing", "how many updated", GitHub stats, or a growth check-in, even if they don't say "stats".
---

# Netnyahoo stats

The owner wants one short, plain report: where things stand, what changed since the last check, and
anything that needs them. Numbers first, no dashboards to click through. `docs/growth.md` has the
background (what each event means, the experiment, how installs are counted) and a **Log** of past
checks: read its last entry so you can say what changed since then.

## Sources

**GitHub + installs:** `.claude/skills/stats/scripts/github.sh` prints stars (with the last 5 days that
got stars), 14-day repo traffic and referrers, and per version: DMG downloads, Sparkle update zips and
appcast fetches (from `scripts/update-checks.mjs`). The "first" column needs `POSTHOG_PERSONAL_API_KEY`;
without it, get first launches from the PostHog query below instead.

**PostHog:** the `posthog` MCP (`mcp__posthog__exec`), EU project 287835, via `call execute-sql`.
Reuse the conversation_id the server hands you. These queries cover the report; adjust the window to
"since the last log entry" when that's more useful than 24 h.

1. Key events, last 24 h:
   ```sql
   SELECT event, count() AS n, uniq(distinct_id) AS people FROM events
   WHERE timestamp > now() - INTERVAL 24 HOUR AND event IN ('$pageview','download_clicked',
     'send_to_mac_clicked','mac_link_visit','screenshot_opened','update_check','notify_clicked','$exception')
   GROUP BY event ORDER BY n DESC
   ```
2. All-time site totals: `uniq(distinct_id)` over `$pageview`/`download_clicked`, plus download clickers
   with `properties.$os = 'Mac OS X'`.
3. Hourly trend, last 12 h: visitors, download clickers, `send_to_mac_clicked` people per
   `toStartOfHour(timestamp)`. Say whether traffic is rising, flat or tapering.
4. Conversion by platform, last 24 h: visitors and download clickers grouped by `properties.$os` and
   `properties.$device_type`. Mac desktop download rate is the number that matters; phones can't install,
   so their goal is getting the link to a Mac.
5. Phone panel: `send_to_mac_clicked` grouped by `properties.method` (share/copy/email/panel),
   `properties.outcome` (shared/cancelled/copied/blocked) and `properties.via` (main button or link).
   "Got the link out" = shared + copied + email. `mac_link_visit` = a Mac actually opened a sent link.
6. Installs: `update_check` grouped by `properties.version`, `countIf(toString(properties.first)='true')`
   as first launches. Drop `0.0.0-selftest`. Counts start with 0.2.14; older copies poll GitHub directly.
   `distinct_id` is fixed (`update-check`), so count events, never people.
7. Opted-in app users by version, last 7 days: `uniq(distinct_id)` grouped by `properties.$app_version`
   where `properties.$environment = 'production'`. This is only people who turned telemetry on, a floor.
8. Errors, last 24 h: `$exception` grouped by the first ~90 chars of `properties.$exception_values`,
   `properties.$lib` and `properties.$app_version`, with `max(timestamp)`.

## Reading it honestly

- **There's no exact user count.** Say which number is which: DMG downloads (GitHub) ≠ installs
  (first launches) ≠ active copies (update checks: a running copy checks 1–3 times a day, so actives
  ≈ checks/3 to checks) ≠ opted-in users (telemetry, a floor). "Updated" = Sparkle zip downloads.
- The site's "downloads" are clicks on the button (people), not finished downloads.
- Compare with the last log entry in `docs/growth.md`, not from memory.

## Errors

AGENTS.md says errors get fixed without asking. Skip known noise that isn't ours: `Script error.`
(cross-origin, no detail), `Can't find variable: CONFIG` (X's in-app browser), `window.ethereum`
(wallets), `window.webkit.messageHandlers…` / `Java object is gone` (in-app webviews), `Load failed` /
`Failed to fetch` (network). Anything else new: find the cause. Site fixes deploy right away
(`pnpm -C apps/site run deploy`, then commit); app fixes are committed for the next release. Mention
what you fixed in the report.

## Report

Keep it short, in this order, with the change since the last check where you have it:

- **Users:** DMG downloads, first launches (0.2.14+), update zips, opted-in users by version.
- **Site:** visitors (24 h and all time) and the hourly trend; Mac download rate; phones' Send to my Mac
  (tapped → got the link out → Mac visits).
- **GitHub:** stars (and how many were recent), repo views, clones.
- **Errors:** new ones and what you did; say "nothing new" otherwise.
- **Needs you:** only if something does (e.g. the PostHog personal key for `update-checks.mjs`).

Then add a dated entry to the **Log** in `docs/growth.md` (same style as the entries there) and commit
it on its own. If this runs from the growth cron, that log entry is the whole output.

# Stats queries (ClickHouse)

Run with `node scripts/telemetry-sql.mjs "<query>"` (read-only user from `~/.config/arcadia/telemetry.env`),
one at a time: the server has 2 cores, a query over the PostHog history takes 5–30 s, and parallel ones
only queue up behind each other (four at once once ran it out of open files). Put a `timestamp >` filter
first when a query only needs recent events. For a query that runs often, read the two tables under the view
directly and filter on the event first (both sort by event, date); unique counts don't need the view's FINAL.
`scripts/stats-snapshot.mjs` does this: all the headline numbers in one request, about 1 s.
Everything is in `telemetry.events`: PostHog's event and property names, one row per event, `properties`
a `Map(String, String)` (booleans are `'true'`/`'false'`). `source` says who sent it: `arcadia-site`,
`arcadia-app`, `arcadia-feed` (update checks) or `posthog-cloud` (history before the switch, and old app
versions that still report to PostHog Cloud until the next delta import). Times are UTC.

Common filters. They are not SQL macros: paste the expression in place of the name.

```sql
-- the site, production only (the history has localhost too)
SITE  = (source IN ('arcadia-site', 'posthog-cloud') AND properties['$lib'] IN ('web', 'arcadia-web')
         AND properties['$host'] IN ('netnyahoo.com', 'www.netnyahoo.com'))
-- the Mac app's opted-in telemetry
APP   = (source IN ('arcadia-app', 'posthog-cloud') AND properties['$lib'] = 'arcadia-telemetry')
MAC   = (properties['$os'] = 'Mac OS X' AND properties['$device_type'] = 'Desktop')
PHONE = (properties['$device_type'] IN ('Mobile', 'Tablet'))
```

## Site

```sql
-- Visitors: all time, last 24 h, last 6 h
SELECT uniqExact(distinct_id), uniqExactIf(distinct_id, timestamp > now() - INTERVAL 24 HOUR),
       uniqExactIf(distinct_id, timestamp > now() - INTERVAL 6 HOUR)
FROM telemetry.events WHERE event = '$pageview' AND SITE;

-- Visitors per hour (trend), last 24 h
SELECT toStartOfHour(timestamp) AS hour, uniqExact(distinct_id)
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY hour ORDER BY hour;

-- Where they come from (last 6 h)
SELECT properties['$referring_domain'] AS ref, uniqExact(distinct_id) AS visitors
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 6 HOUR
GROUP BY ref ORDER BY visitors DESC LIMIT 10;

-- Device mix (share of phones), last 24 h
SELECT properties['$device_type'] AS device, properties['$os'] AS os, uniqExact(distinct_id)
FROM telemetry.events WHERE event = '$pageview' AND SITE AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY device, os ORDER BY 3 DESC;

-- Download clickers, all time and Mac
SELECT uniqExact(distinct_id), uniqExactIf(distinct_id, MAC)
FROM telemetry.events WHERE event = 'download_clicked' AND SITE;

-- Mac download rate since T: Mac desktop visitors who clicked Download / Mac desktop visitors
SELECT uniqExactIf(distinct_id, event = 'download_clicked') AS clicked,
       uniqExactIf(distinct_id, event = '$pageview') AS visitors, round(100 * clicked / visitors, 1) AS pct
FROM telemetry.events WHERE SITE AND MAC AND timestamp > now() - INTERVAL 24 HOUR;
-- (Windows/Linux: swap MAC for properties['$os'] IN ('Windows') / ('Linux').)

-- Clicks worth watching
SELECT event, count(), uniqExact(distinct_id) FROM telemetry.events
WHERE SITE AND event IN ('github_clicked', 'screenshot_opened', 'notify_clicked', 'support_opened', '$rageclick', '$dead_click')
  AND timestamp > now() - INTERVAL 24 HOUR GROUP BY event;

-- Dead clicks by element text (the mascot canvas has none)
SELECT properties['$el_text'] AS text, count() FROM telemetry.events
WHERE SITE AND event = '$dead_click' AND timestamp > now() - INTERVAL 24 HOUR GROUP BY text ORDER BY 2 DESC LIMIT 10;
```

## Phones: Send to my Mac

```sql
-- Panel funnel: taps, then how the link got out (outcome: shared|copied|blocked|failed; fallback: copied|selected|email)
SELECT event, properties['outcome'] AS outcome, properties['action'] AS action, uniqExact(distinct_id)
FROM telemetry.events WHERE SITE AND event IN ('send_to_mac_clicked', 'send_to_mac_fallback')
  AND timestamp > now() - INTERVAL 24 HOUR GROUP BY event, outcome, action ORDER BY event, 4 DESC;

-- Macs that opened a sent link
SELECT uniqExact(distinct_id) FROM telemetry.events WHERE SITE AND event = 'mac_link_visit';
```

## Experiment `download-band`

```sql
-- Exposed Mac visitors per variant, and how many of them clicked Download after exposure
WITH exposures AS (
  SELECT distinct_id, any(properties['$feature_flag_response']) AS variant, min(timestamp) AS exposed_at
  FROM telemetry.events WHERE event = '$feature_flag_called' AND properties['$feature_flag'] = 'download-band' AND SITE
  GROUP BY distinct_id)
SELECT variant, count() AS exposed,
       countIf(distinct_id IN (SELECT distinct_id FROM telemetry.events WHERE event = 'download_clicked' AND SITE)) AS clicked,
       round(100 * clicked / exposed, 1) AS pct
FROM exposures GROUP BY variant;
```

## App and installs

```sql
-- First launches and checks per version (also: node scripts/update-checks.mjs)
SELECT properties['version'] AS v, countIf(properties['first'] = 'true') AS first_launches, count() AS checks
FROM telemetry.events WHERE event = 'update_check' AND match(v, '^[0-9]+\\.[0-9]+\\.[0-9]+$')
GROUP BY v ORDER BY v;

-- Opted-in app users by version, last 7 days
SELECT properties['$app_version'] AS version, uniqExact(distinct_id)
FROM telemetry.events WHERE APP AND timestamp > now() - INTERVAL 7 DAY GROUP BY version ORDER BY 2 DESC;
```

## Errors

```sql
-- New exceptions, site and app (last 24 h), grouped by type and message
SELECT if(APP, 'app', 'site') AS where, properties['$exception_types'] AS type,
       substring(properties['$exception_values'], 1, 120) AS message, properties['$app_version'] AS app_version,
       count(), uniqExact(distinct_id), max(timestamp)
FROM telemetry.events WHERE event = '$exception' AND (SITE OR APP) AND timestamp > now() - INTERVAL 24 HOUR
GROUP BY where, type, message, app_version ORDER BY 5 DESC LIMIT 30;
-- The stack is in properties['$exception_list'] (JSON). Plain warnings/errors (not events): telemetry.logs.
```

## Replays

`node scripts/replay.mjs --list` lists recorded sessions (`telemetry.replay_sessions`); `node scripts/replay.mjs <session>`
plays one locally. Find the session of an event with `session_id` on `telemetry.events`.

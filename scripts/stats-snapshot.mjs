#!/usr/bin/env node
// The growth numbers at a glance, as one JSON object: what the stats skill reports first, cheap enough to
// poll (the live stats pane runs it every 15 minutes): one ClickHouse request of ~1 s server time, and
// GitHub's numbers alongside.
// usage: node scripts/stats-snapshot.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clickhouse, hasTelemetryEnv } from "./telemetry-env.mjs";

const REPO = "mantrakp04/netnyahoo";

// The queries read the two tables under telemetry.events directly: the view casts every row's property
// map and reads with FINAL, which a unique count doesn't need (a duplicate row doesn't change it). Both
// tables sort by (event, date), so a filter on the event skips most of each. `both` writes one SELECT per
// table from a template: {p} is the property map, {ts} the raw timestamp column, {t} it as UTC, {e} the
// event, {d} the distinct id, and {site}, {app}, {mac} the usual filters (.claude/skills/stats/queries.md).
const OTEL = {
  table: "telemetry.otel_logs",
  p: "LogAttributes", ts: "Timestamp", t: "toDateTime64(Timestamp, 6, 'UTC')", e: "Event", d: "DistinctId",
  site: "ServiceName = 'netnyahoo-site' AND {p}['$lib'] IN ('web', 'netnyahoo-web') AND {p}['$host'] IN ('netnyahoo.com', 'www.netnyahoo.com')",
  app: "ServiceName = 'netnyahoo-app' AND {p}['$lib'] = 'netnyahoo-telemetry'",
  // What the view leaves out: the endpoints' self-tests.
  base: "Event != '' AND ResourceAttributes['service.version'] != '0.0.0-selftest'",
};
const POSTHOG = {
  table: "telemetry.posthog_events",
  p: "properties", ts: "timestamp", t: "timestamp", e: "event", d: "distinct_id",
  site: "{p}['$lib'] IN ('web', 'netnyahoo-web') AND {p}['$host'] IN ('netnyahoo.com', 'www.netnyahoo.com')",
  app: "{p}['$lib'] = 'netnyahoo-telemetry'",
  base: "1",
};
const fill = (sql, t) =>
  sql.replace(/\{(site|app)\}/g, (_, k) => `(${t[k]})`)
    .replaceAll("{mac}", "({p}['$os'] = 'Mac OS X' AND {p}['$device_type'] = 'Desktop')")
    .replace(/\{(p|ts|t|e|d)\}/g, (_, k) => t[k]);
const both = (select, where, { final = false } = {}) =>
  [OTEL, POSTHOG]
    .map((t) => `SELECT ${fill(select, t)} FROM ${t.table}${final ? " FINAL" : ""} WHERE ${fill(where, t)} AND ${t.base}`)
    .join(" UNION ALL ");
const VERSION = "'^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$'";

const gh = async (path) => JSON.parse((await promisify(execFile)("gh", ["api", path])).stdout);
const problems = [];
const attempt = async (name, fn) => {
  try {
    return await fn();
  } catch (error) {
    problems.push(`${name}: ${String(error.message ?? error).split("\n")[0].slice(0, 160)}`);
    return null;
  }
};

const github = attempt("github", async () => {
  const [repo, releases] = await Promise.all([gh(`repos/${REPO}`), gh(`repos/${REPO}/releases?per_page=100`)]);
  const count = (release, ext) => release.assets.find((a) => a.name.endsWith(ext))?.download_count ?? 0;
  const latest = releases.find((r) => !r.draft && !r.prerelease);
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    dmg: releases.reduce((sum, r) => sum + count(r, ".dmg"), 0),
    zips: releases.reduce((sum, r) => sum + count(r, ".zip"), 0),
    latest: latest && { version: latest.tag_name.replace(/^v/, ""), dmg: count(latest, ".dmg"), published: latest.published_at },
  };
});

const telemetry = {};
if (hasTelemetryEnv()) {
  // One request: each round trip to the server costs ~300 ms, more than any of these queries.
  const firstHour = Math.floor(Date.now() / 3_600_000) - 23;
  await attempt("telemetry", async () => {
    const [[site, copies, app, exceptions]] = await clickhouse(`SELECT
      (SELECT tuple(uniqExactIf(d, e = '$pageview'), uniqExactIf(d, e = '$pageview' AND t > now() - INTERVAL 24 HOUR),
                    uniqExactIf(d, e = '$pageview' AND t > now() - INTERVAL 1 HOUR), uniqExactIf(d, e = 'download_clicked'),
                    uniqExactIf(d, e = 'download_clicked' AND mac),
                    uniqExactIf(d, e = 'download_clicked' AND mac AND t > now() - INTERVAL 24 HOUR),
                    uniqExactIf(d, e = '$pageview' AND mac AND t > now() - INTERVAL 24 HOUR),
                    uniqExactResample(${firstHour}, ${firstHour + 24}, 1)(d, if(e = '$pageview', intDiv(toUnixTimestamp(t), 3600), 0)))
       FROM (${both("toString({e}) AS e, {d} AS d, {t} AS t, {mac} AS mac", "{e} IN ('$pageview', 'download_clicked') AND {site}")})),
      -- A running copy checks 1–3 times a day (scripts/update-checks.mjs), so copies are a range per version.
      (SELECT groupArray(tuple(v, yesterday, today, firstYesterday, firstToday, first)) FROM (
         SELECT v, countIf(day = yesterday()) AS yesterday, countIf(day = today()) AS today,
                countIf(isFirst AND day = yesterday()) AS firstYesterday, countIf(isFirst AND day = today()) AS firstToday,
                countIf(isFirst) AS first
         FROM (${both("{p}['version'] AS v, toDate({t}) AS day, {p}['first'] = 'true' AS isFirst", "{e} = 'update_check'", { final: true })})
         WHERE match(v, ${VERSION}) GROUP BY v)),
      (SELECT tuple(uniqExactIf(d, t >= today()), uniqExact(d))
       FROM (${both("{d} AS d, {t} AS t", "{ts} > now() - INTERVAL 7 DAY AND {app}")})),
      (SELECT groupArray(tuple(where, type, message, version, n, last)) FROM (
         SELECT where,
                -- Native crash reports carry only $exception_list.
                coalesce(nullIf(JSONExtractString(types, 1), ''), JSONExtractString(list, 1, 'type')) AS type,
                substring(coalesce(nullIf(JSONExtractString(vals, 1), ''), JSONExtractString(list, 1, 'value')), 1, 120) AS message,
                version, count() AS n, toUnixTimestamp(max(t)) AS last
         FROM (${both(
           "if({app}, 'app', 'site') AS where, {p}['$exception_types'] AS types, {p}['$exception_values'] AS vals, " +
             "{p}['$exception_list'] AS list, {p}['$app_version'] AS version, {t} AS t",
           "{e} = '$exception' AND {ts} > now() - INTERVAL 24 HOUR AND ({site} OR {app})",
           { final: true },
         )})
         GROUP BY where, type, message, version ORDER BY last DESC LIMIT 6))`);

    const [allTime, day, hour, downloads, macDownloads, macClicked, macVisitors, hourly] = site;
    telemetry.site = { allTime, day, hour, downloads, macDownloads };
    telemetry.hourly = hourly.map(Number);
    telemetry.macRate = { clicked: macClicked, visitors: macVisitors };
    const range = (checks, firsts) => ({
      low: copies.reduce((sum, r) => sum + Math.ceil(r[checks] / 3), 0),
      high: copies.reduce((sum, r) => sum + r[checks], 0),
      firsts: copies.reduce((sum, r) => sum + r[firsts], 0),
    });
    telemetry.copies = {
      firstLaunches: copies.reduce((sum, r) => sum + r[5], 0),
      yesterday: range(1, 3),
      today: range(2, 4),
    };
    telemetry.appUsers = { today: app[0], week: app[1] };
    telemetry.exceptions = exceptions.map(([where, type, message, version, count, last]) => ({
      where, type, message, version, count, last: last * 1000,
    }));
  });
} else {
  problems.push("telemetry: ~/.config/netnyahoo/telemetry.env is missing (docs/growth.md, Telemetry)");
}

console.log(JSON.stringify({ at: Date.now(), github: await github, ...telemetry, problems }));

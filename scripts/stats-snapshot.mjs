#!/usr/bin/env node
// The growth numbers at a glance, as one JSON object: what the stats skill reports first, cheap enough to
// poll (the live stats pane runs it every 15 minutes). Queries run one at a time, as
// .claude/skills/stats/queries.md asks: the ClickHouse server has 2 cores.
// usage: node scripts/stats-snapshot.mjs
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { clickhouse, hasTelemetryEnv } from "./telemetry-env.mjs";

const REPO = "mantrakp04/netnyahoo";
const SITE = `(source IN ('netnyahoo-site', 'posthog-cloud') AND properties['$lib'] IN ('web', 'netnyahoo-web')
  AND properties['$host'] IN ('netnyahoo.com', 'www.netnyahoo.com'))`;
const APP = `(source IN ('netnyahoo-app', 'posthog-cloud') AND properties['$lib'] = 'netnyahoo-telemetry')`;
const MAC = `(properties['$os'] = 'Mac OS X' AND properties['$device_type'] = 'Desktop')`;
const CHECK = `event = 'update_check' AND match(properties['version'], '^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$')`;

const gh = async (path) => JSON.parse((await promisify(execFile)("gh", ["api", path])).stdout);
const num = (rows) => rows[0].map(Number);
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
  telemetry.site = await attempt("site", async () => {
    const [allTime, day, hour, downloads, macDownloads] = num(await clickhouse(`
      SELECT uniqExactIf(distinct_id, event = '$pageview'),
             uniqExactIf(distinct_id, event = '$pageview' AND timestamp > now() - INTERVAL 24 HOUR),
             uniqExactIf(distinct_id, event = '$pageview' AND timestamp > now() - INTERVAL 1 HOUR),
             uniqExactIf(distinct_id, event = 'download_clicked'),
             uniqExactIf(distinct_id, event = 'download_clicked' AND ${MAC})
      FROM telemetry.events WHERE event IN ('$pageview', 'download_clicked') AND ${SITE}`));
    return { allTime, day, hour, downloads, macDownloads };
  });
  telemetry.hourly = await attempt("hourly", async () => {
    const rows = await clickhouse(`
      SELECT toUnixTimestamp(toStartOfHour(timestamp)) AS h, uniqExact(distinct_id)
      FROM telemetry.events WHERE timestamp > now() - INTERVAL 24 HOUR AND event = '$pageview' AND ${SITE}
      GROUP BY h ORDER BY h`);
    const seen = new Map(rows.map(([h, n]) => [Number(h), Number(n)]));
    const now = Math.floor(Date.now() / 3_600_000) * 3600;
    return Array.from({ length: 24 }, (_, i) => seen.get(now - (23 - i) * 3600) ?? 0);
  });
  telemetry.macRate = await attempt("macRate", async () => {
    const [clicked, visitors] = num(await clickhouse(`
      SELECT uniqExactIf(distinct_id, event = 'download_clicked'), uniqExactIf(distinct_id, event = '$pageview')
      FROM telemetry.events WHERE timestamp > now() - INTERVAL 24 HOUR AND ${SITE} AND ${MAC}`));
    return { clicked, visitors };
  });
  telemetry.copies = await attempt("copies", async () => {
    // A running copy checks 1–3 times a day (scripts/update-checks.mjs), so copies are a range per version.
    const rows = await clickhouse(`
      SELECT toDate(timestamp) = today() AS isToday, properties['version'] AS v, count(), countIf(properties['first'] = 'true')
      FROM telemetry.events WHERE timestamp >= yesterday() AND ${CHECK} GROUP BY isToday, v`);
    const [firstLaunches] = num(await clickhouse(`
      SELECT countIf(properties['first'] = 'true') FROM telemetry.events WHERE ${CHECK}`));
    const range = (isToday) => {
      const day = rows.filter((r) => Number(r[0]) === (isToday ? 1 : 0));
      return {
        low: day.reduce((sum, r) => sum + Math.ceil(Number(r[2]) / 3), 0),
        high: day.reduce((sum, r) => sum + Number(r[2]), 0),
        firsts: day.reduce((sum, r) => sum + Number(r[3]), 0),
      };
    };
    return { firstLaunches, yesterday: range(false), today: range(true) };
  });
  telemetry.appUsers = await attempt("appUsers", async () => {
    const [today, week] = num(await clickhouse(`
      SELECT uniqExactIf(distinct_id, timestamp >= today()), uniqExact(distinct_id)
      FROM telemetry.events WHERE timestamp > now() - INTERVAL 7 DAY AND ${APP}`));
    return { today, week };
  });
  telemetry.exceptions = await attempt("exceptions", async () =>
    (await clickhouse(`
      SELECT if(${APP}, 'app', 'site') AS where,
             -- Native crash reports carry only $exception_list.
             coalesce(nullIf(JSONExtractString(properties['$exception_types'], 1), ''),
                      JSONExtractString(properties['$exception_list'], 1, 'type')) AS type,
             substring(coalesce(nullIf(JSONExtractString(properties['$exception_values'], 1), ''),
                                JSONExtractString(properties['$exception_list'], 1, 'value')), 1, 120) AS message,
             properties['$app_version'] AS version, count(), toUnixTimestamp(max(timestamp))
      FROM telemetry.events WHERE timestamp > now() - INTERVAL 24 HOUR AND event = '$exception' AND (${SITE} OR ${APP})
      GROUP BY where, type, message, version ORDER BY 6 DESC LIMIT 6`)).map(([where, type, message, version, count, last]) => ({
      where, type, message, version, count: Number(count), last: Number(last) * 1000,
    })),
  );
} else {
  problems.push("telemetry: ~/.config/netnyahoo/telemetry.env is missing (docs/growth.md, Telemetry)");
}

console.log(JSON.stringify({ at: Date.now(), github: await github, ...telemetry, problems }));

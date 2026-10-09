#!/usr/bin/env node
// Downloads → first launches → copies still running, per version, from two counts we already have:
//   - GitHub's download counts for each release's DMG (new downloads) and zip (Sparkle updates);
//   - `update_check` events, one per request to netnyahoo.com/appcast.xml (infra/site/nginx.conf):
//     version, day, and whether it's a copy's first check. No IP, no ID. Builds after 0.2.13 only;
//     older copies poll GitHub directly and aren't counted.
//
// usage: node scripts/update-checks.mjs [days=14]
// The events come from our ClickHouse (docs/growth.md, "Telemetry"), read with the read-only user in
// ~/.config/arcadia/telemetry.env. Without that file, only the GitHub counts print.

import { clickhouse, hasTelemetryEnv } from "./telemetry-env.mjs";

const REPO = "mantrakp04/arcadia";
const days = Math.max(1, Number(process.argv[2] ?? 14) || 14);
const key = hasTelemetryEnv();

async function github() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: { Accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  const byVersion = new Map();
  for (const release of await res.json()) {
    const version = release.tag_name.replace(/^v/, "");
    const count = (ext) => release.assets.find((a) => a.name.endsWith(ext))?.download_count ?? 0;
    byVersion.set(version, { dmg: count(".dmg"), zip: count(".zip"), feed: count("appcast.xml"), published: release.published_at ?? "" });
  }
  return byVersion;
}

// Real versions only (a local test of the endpoint sends 0.0.0-selftest).
const WHERE = `event = 'update_check' AND match(properties['version'], '^[0-9]+\\\\.[0-9]+\\\\.[0-9]+$')`;
const FIRST = `properties['first'] = 'true'`;

const releases = await github();
let firstByVersion = new Map();
let daily = [];
if (key) {
  firstByVersion = new Map(
    (await clickhouse(`SELECT properties['version'] AS v, countIf(${FIRST}) FROM telemetry.events WHERE ${WHERE} GROUP BY v`)).map(([v, n]) => [v, Number(n)]),
  );
  daily = (await clickhouse(
    `SELECT toString(toDate(timestamp)) AS day, properties['version'] AS v, count(), countIf(${FIRST})
     FROM telemetry.events WHERE ${WHERE} AND timestamp >= today() - ${days} GROUP BY day, v ORDER BY day, v`,
  )).map(([day, v, checks, first]) => [day, v, Number(checks), Number(first)]);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log("Per version (all time)");
console.log(`${pad("version", 9)}${pad("published", 12)}${num("DMG", 7)}${num("first", 8)}${num("first/DMG", 11)}${num("updates", 9)}${num("GitHub feed", 13)}`);
for (const [version, r] of [...releases].sort((a, b) => b[1].published.localeCompare(a[1].published))) {
  const first = firstByVersion.get(version);
  const rate = first !== undefined && r.dmg ? `${Math.round((100 * first) / r.dmg)}%` : "";
  console.log(`${pad(version, 9)}${pad(r.published.slice(0, 10), 12)}${num(r.dmg, 7)}${num(first ?? "–", 8)}${num(rate, 11)}${num(r.zip, 9)}${num(r.feed, 13)}`);
}
console.log("\nDMG: downloads from GitHub. first: copies of that version that launched and checked for updates the");
console.log("first time (installs; – = built before the counted feed). updates: Sparkle update downloads (the zip).");
console.log("GitHub feed: fetches of that release's appcast.xml, i.e. update checks (all versions, redirected ones");
console.log("included) while it was the latest release.");

if (!key) {
  console.log("\nNo ~/.config/arcadia/telemetry.env: first launches and daily checks need it (docs/growth.md, Telemetry).");
  process.exit(0);
}
console.log(`\nUpdate checks per day, last ${days} days (UTC)`);
console.log(`${pad("day", 12)}${pad("version", 9)}${num("checks", 8)}${num("first", 7)}${num("running≈", 12)}`);
for (const [day, version, checks, first] of daily) {
  // A running copy checks at launch (once 8 h have passed) and every 8 h: 1 to 3 times a day.
  const low = Math.ceil(checks / 3);
  console.log(`${pad(day, 12)}${pad(version, 9)}${num(checks, 8)}${num(first, 7)}${num(low === checks ? checks : `${low}–${checks}`, 12)}`);
}
console.log("\nrunning≈: copies of that version that ran that day. Each running copy checks 1–3 times a day, so the");
console.log("count is between checks/3 and checks. Nothing identifies a copy, so this stays a range.");

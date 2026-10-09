#!/usr/bin/env node
// Plays back a netnyahoo.com session replay (rrweb) locally.
//
//   node scripts/replay.mjs --list [days=2]     recent recorded sessions (telemetry.replay_sessions)
//   node scripts/replay.mjs <session-id> [--open]
//
// Fetches the session's chunks (replays/<day>/<session>/<seq>.json[.gz], docs/growth.md "Telemetry")
// with the read-only token in ~/.config/arcadia/telemetry.env, writes a self-contained page with
// rrweb-player to the temp folder and prints its path (--open opens it in the default browser).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { clickhouse, telemetryEnv } from "./telemetry-env.mjs";

// The player matches the recorder the site ships (@rrweb/record in apps/site/package.json).
const PLAYER_VERSION = "2.1.6";
const PLAYER_FILES = { js: "dist/rrweb-player.umd.min.cjs", css: "dist/style.min.css" };

const args = process.argv.slice(2);
if (args[0] === "--list") {
  const days = Math.max(1, Number(args[1] ?? 2) || 2);
  const rows = await clickhouse(
    `SELECT session_id, toString(start), duration_s, chunks, pages, clicks, device_type, os, browser, country, first_url
     FROM telemetry.replay_sessions WHERE day >= today() - ${days} ORDER BY start DESC LIMIT 200`,
  );
  console.log(["session", "start (UTC)", "secs", "chunks", "pages", "clicks", "device", "os", "browser", "country", "first page"].join("\t"));
  for (const row of rows) console.log(row.join("\t"));
  process.exit(0);
}

const session = (args.find((a) => !a.startsWith("--")) ?? "").toLowerCase();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session)) {
  console.error("usage: node scripts/replay.mjs <session-id> [--open]   |   node scripts/replay.mjs --list [days]");
  process.exit(2);
}

const env = telemetryEnv();
const auth = { Authorization: `Bearer ${env.REPLAYS_TOKEN}` };

// Chunks are filed under the UTC day they arrived; look at the days the session's events span, and the next.
const [[first, last] = []] = await clickhouse(
  `SELECT toString(min(toDate(timestamp))), toString(max(toDate(timestamp))) FROM telemetry.events WHERE session_id = '${session}'`,
);
const days = new Set();
const start = new Date(`${first && first !== "1970-01-01" ? first : new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const end = new Date(`${last && last !== "1970-01-01" ? last : start.toISOString().slice(0, 10)}T00:00:00Z`);
for (let d = new Date(start); d <= new Date(end.getTime() + 86400000); d = new Date(d.getTime() + 86400000)) {
  days.add(d.toISOString().slice(0, 10));
}

const chunks = [];
for (const day of days) {
  const res = await fetch(`${env.REPLAYS_URL}${day}/${session}/`, { headers: { ...auth, Accept: "application/json" } });
  if (res.status === 404) continue;
  if (!res.ok) throw new Error(`replays: ${res.status} ${await res.text()}`);
  for (const entry of (await res.json()).Entries ?? []) {
    const name = entry.FullPath.split("/").pop();
    const match = /^(\d+)\.json(\.gz)?$/.exec(name);
    if (!match) continue;
    const file = await fetch(`${env.REPLAYS_URL}${day}/${session}/${name}`, { headers: auth });
    if (!file.ok) throw new Error(`replays: ${file.status} for ${name}`);
    const bytes = Buffer.from(await file.arrayBuffer());
    const body = JSON.parse((match[2] ? gunzipSync(bytes) : bytes).toString("utf8"));
    chunks.push({ seq: Number(match[1]), events: body.events ?? [] });
  }
}
if (chunks.length === 0) {
  console.error(`No replay chunks for ${session} (looked in ${[...days].join(", ")}). Replays are kept 30 days.`);
  process.exit(1);
}
chunks.sort((a, b) => a.seq - b.seq);
const events = chunks.flatMap((c) => c.events).sort((a, b) => a.timestamp - b.timestamp);

// The player, cached once per version.
const cache = join(homedir(), ".cache/arcadia/rrweb-player", PLAYER_VERSION);
mkdirSync(cache, { recursive: true });
const asset = async (path) => {
  const file = join(cache, path.replaceAll("/", "_"));
  if (!existsSync(file)) {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/rrweb-player@${PLAYER_VERSION}/${path}`);
    if (!res.ok) throw new Error(`rrweb-player: ${res.status} for ${path}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(file, "utf8");
};
const [js, css] = await Promise.all([asset(PLAYER_FILES.js), asset(PLAYER_FILES.css)]);

const safe = (s) => s.replaceAll("</script", "<\\/script");
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Replay ${session}</title>
<style>${css}</style><style>body{margin:0;padding:16px;background:#1b1a18;color:#eee;font:13px system-ui}p{margin:0 0 12px}</style></head>
<body><p>Session ${session} · ${chunks.length} chunk(s) · ${events.length} events</p><div id="player"></div>
<script>${safe(js)}</script>
<script>
const events = ${safe(JSON.stringify(events))};
const width = Math.min(window.innerWidth - 32, 1280);
const Player = rrwebPlayer.Player ?? rrwebPlayer.default ?? rrwebPlayer;
new Player({ target: document.getElementById("player"), props: { events, width, height: Math.round(width * 0.6), autoPlay: false } });
</script></body></html>`;
const out = join(tmpdir(), `arcadia-replay-${session}.html`);
writeFileSync(out, html);
console.log(out);
if (args.includes("--open")) execFileSync("open", [out]);

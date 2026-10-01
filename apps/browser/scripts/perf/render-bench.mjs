#!/usr/bin/env node
// React render benchmark: how many commits and renders each interaction costs, and how many of those renders
// were wasted (same props, no state or context change), on a production bundle with React's profiling renderer.
//
//   node js-bench.mjs bundle <dir> --profiling 1           the bundle (main.jsbundle) to run
//   node render-bench.mjs run --app <Release Netnyahoo.app> --bundle <dir>/main.jsbundle --label <name>
//                             [--runs 3] [--port 47827] [--out <dir>] [--only idle1,ticker,…] [--idle 60]
//       Clones the app with the bundle swapped in and, per run, launches two hidden instances on fresh data folders:
//       one tab (idle), then 20 tabs (3 pinned, a group of 4) for every interaction. Writes <label>.json.
//   node render-bench.mjs compare <before.json> <after.json>     before/after table (medians)
//   node render-bench.mjs top <report.json> [interaction]        the top offenders of the last run
//
// The app side is the probe in src/lib/perfProbe.ts with its "renders" option (the seed writes it into the data
// folder's perf-probe file) and the scenarios in bench-app.js.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, launch, quit, startServer } from "./js-bench.mjs";
import { buildSeed } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const defaultOut = process.env.NN_PERF_OUT ?? "/tmp/nn-perf-renders";

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// MARK: Seed

// A session of `count` tabs in one profile: 3 pinned, a group of 4, the rest loose; the probe's renders option on.
function writeRenderSeed(dir, origin, version, count) {
  const files = buildSeed(origin, version);
  const session = files["session.json"];
  const w = session.windows[0];
  const base = session.tabs.find((t) => t.profileId === "default");
  const now = Date.now();
  const pinned = Math.min(3, count - 1);
  const grouped = count >= 10 ? 4 : 0;
  const tabs = Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `t-${i}`,
    url: `${origin}/p/tab-${i}`,
    title: `Page tab-${i}`,
    pinned: i < pinned,
    pinnedUrl: i < pinned ? `${origin}/p/tab-${i}` : null,
    createdAt: now - (count - i) * 60_000,
    lastActiveAt: now - (count - i) * 60_000,
  }));
  const active = tabs[Math.min(count - 1, pinned + grouped)];
  active.lastActiveAt = now;
  session.tabs = tabs;
  session.groups = grouped
    ? [{ id: "g-0", windowId: w.id, profileId: "default", name: "Reading", icon: null, color: "blue", collapsed: false, pinned: false, tabIds: tabs.slice(pinned, pinned + grouped).map((t) => t.id), createdAt: now }]
    : [];
  w.tabIds = tabs.map((t) => t.id);
  w.activeTabIds = { default: active.id };
  files["perf-probe"] = "renders";
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
}

// MARK: CDP (the page side of scrolling and media)

async function cdp(port, urlPart, calls) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === "page" && t.url.includes(urlPart));
  if (!target) throw new Error(`no page ${urlPart}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq;
      const timer = setTimeout(() => rej(new Error(`CDP ${method} timed out`)), 10_000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    return await calls(send);
  } finally {
    ws.close();
  }
}

// MARK: Run

const INTERACTIONS = ["idle1", "tabSwitch", "idle20", "openTab", "closeTab", "typeCommandBar", "typeOmnibox", "hover", "ticker", "bgLoad", "media", "pageScroll", "split", "unsplit", "sidebarCollapse", "sidebarExpand", "downloads"];

async function session(clone, dataDir, port, lib, body) {
  const { pid } = await launch(clone, dataDir, port);
  try {
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) ready = await evaluate(dataDir, pid, "return 1;", 2000).then(() => true, (e) => (String(e).includes("exited") ? Promise.reject(e) : false));
    if (!ready) throw new Error("dev harness never answered");
    await evaluate(dataDir, pid, lib, 60_000);
    const call = (name, options = {}, timeoutMs = 180_000) => evaluate(dataDir, pid, `return nnBench.run(${JSON.stringify(name)}, ${JSON.stringify(options)});`, timeoutMs);
    return await body(call);
  } finally {
    await quit(pid);
  }
}

async function run() {
  const { app, bundle: jsbundle, label, runs = "3", port = "47827", out = defaultOut, idle = "60" } = flags;
  if (!app || !jsbundle || !label) throw new Error("run needs --app, --bundle and --label");
  const only = flags.only ? new Set(flags.only.split(",")) : null;
  const want = (name) => !only || only.has(name);
  const clone = join(out, "apps", label, "Netnyahoo.app");
  rmSync(dirname(clone), { recursive: true, force: true });
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("cp", ["-cR", app, clone]);
  cpSync(jsbundle, join(clone, "Contents/Resources/main.jsbundle"));
  const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleShortVersionString", join(clone, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(Number(port));
  const lib = readFileSync(join(here, "bench-app.js"), "utf8");
  const debugPort = 9600 + (label.length % 40) * 5;
  const results = [];
  try {
    for (let r = 0; r < Number(runs); r++) {
      const result = { run: r };
      const log = (name) => process.stderr.write(`[${label} ${r}] ${name}\n`);
      if (want("idle1")) {
        const dir = join(out, "data", `${label}-${r}-1tab`);
        rmSync(dir, { recursive: true, force: true });
        writeRenderSeed(dir, origin, version, 1);
        await session(clone, dir, debugPort, lib, async (call) => {
          log("idle1");
          result.idle1 = (await call("idleFor", { seconds: Number(idle) })).stats;
        });
      }
      const dir = join(out, "data", `${label}-${r}-20tabs`);
      rmSync(dir, { recursive: true, force: true });
      writeRenderSeed(dir, origin, version, 20);
      await session(clone, dir, debugPort, lib, async (call) => {
        log("wake");
        result.loaded = await call("wake");
        if (want("tabSwitch")) {
          log("tabSwitch");
          result.tabSwitch = (await call("tabSwitch", { count: 10 })).stats;
        }
        if (want("idle20")) {
          log("idle20");
          result.idle20 = (await call("idleFor", { seconds: Number(idle) })).stats;
        }
        if (want("openTab") || want("closeTab")) {
          log("openTab/closeTab");
          const x = await call("openCloseTab", { count: 5, origin });
          result.openTab = x.openStats;
          result.closeTab = x.closeStats;
        }
        if (want("typeCommandBar")) {
          log("typeCommandBar");
          result.typeCommandBar = (await call("typeIn", { bar: "panel" })).stats;
        }
        if (want("typeOmnibox")) {
          log("typeOmnibox");
          result.typeOmnibox = (await call("typeIn", { bar: "hero" })).stats;
        }
        if (want("hover")) {
          log("hover");
          result.hover = (await call("hover", { rows: 14, from: 0 })).stats;
        }
        if (want("ticker")) {
          log("ticker");
          const id = await call("openBackground", { path: "/ticker", origin });
          await call("mark", { settleMs: 500 });
          await sleep(10_000);
          result.ticker = (await call("read", { settleMs: 0 })).stats;
          await call("closeTab", { id });
        }
        if (want("bgLoad")) {
          log("bgLoad");
          result.bgLoad = (await call("bgLoad", { origin })).stats;
        }
        if (want("media")) {
          log("media");
          const id = await call("openBackground", { path: "/media", origin });
          // A background tab's play() settles only once Chrome lets it play: start it, then ask.
          result.mediaPlaying = await cdp(debugPort, "/media", async (send) => {
            await send("Runtime.evaluate", { expression: "void document.getElementById('a').play()", userGesture: true });
            await sleep(2000);
            return (await send("Runtime.evaluate", { expression: "!document.getElementById('a').paused", returnByValue: true })).result?.value ?? null;
          }).catch((e) => String(e));
          await call("mark");
          await sleep(10_000);
          result.media = (await call("read", { settleMs: 0 })).stats;
          await call("closeTab", { id });
        }
        if (want("pageScroll")) {
          log("pageScroll");
          const id = await call("openActive", { path: "/long", origin });
          await call("mark", { settleMs: 500 });
          // Down and back up; returns how far it got.
          result.scrolled = await cdp(debugPort, "/long", async (send) => {
            let furthest = 0;
            for (let i = 0; i < 60; i++) {
              await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 300, y: 300, deltaX: 0, deltaY: i < 30 ? 120 : -120 });
              await sleep(16);
              if (i === 29) furthest = (await send("Runtime.evaluate", { expression: "scrollY", returnByValue: true })).result?.value ?? null;
            }
            return furthest;
          }).catch((e) => String(e));
          result.pageScroll = (await call("read", { settleMs: 800 })).stats;
          await call("closeTab", { id });
        }
        if (want("split") || want("unsplit")) {
          log("split");
          const x = await call("split", { origin });
          result.split = x.stats;
          result.unsplit = x.closeStats;
        }
        if (want("sidebarCollapse") || want("sidebarExpand")) {
          log("sidebar");
          const x = await call("sidebar");
          result.sidebarCollapse = x.stats;
          result.sidebarExpand = x.openStats;
        }
        if (want("downloads")) {
          log("downloads");
          result.downloads = (await call("downloads")).stats;
        }
      });
      results.push(result);
    }
  } finally {
    server.close();
  }
  const report = { label, version, bundle: jsbundle, when: new Date().toISOString(), results };
  const file = join(out, `${label}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  printTable(summarize(results));
  console.log(`\nwrote ${file}`);
}

// MARK: Summary

// Host wrappers render whenever their parent does; offenders lists the app's own components.
const HOST = /^(View|Text|Pressable|Image|ScrollView|TextInput|InternalTextInput|Animated\(.*\)|Netnyahoo.*|Surface|Symbol|MouseArea|ContextMenuArea|FadeLabel|VirtualizedList.*|CellRenderer.*|ScrollViewBase|TouchableOpacity|AnimatedComponent.*)$/;

function line(stats) {
  if (!stats) return null;
  return {
    commits: stats.commits,
    renders: sum(stats.renders),
    wasted: sum(stats.wasted),
    renderMs: sum(stats.renderMs),
    wastedMs: sum(stats.wastedMs),
    unstable: sum(stats.unstable),
    commitMs: stats.commitMs,
    jsMs: sum(stats.taskMs) - (stats.walkMs ?? 0),
  };
}

function summarize(results) {
  const out = {};
  for (const name of INTERACTIONS) {
    const lines = results.map((r) => line(r[name])).filter(Boolean);
    if (!lines.length) continue;
    out[name] = Object.fromEntries(Object.keys(lines[0]).map((k) => [k, median(lines.map((l) => l[k]))]));
    out[name].n = lines.length;
  }
  return out;
}

const fmt = (v) => (v === null || v === undefined ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function printTable(summary) {
  console.log("| interaction | commits | renders | wasted | unstable props | render ms | wasted ms | JS ms | n |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const [name, l] of Object.entries(summary))
    console.log(`| ${name} | ${fmt(l.commits)} | ${fmt(l.renders)} | ${fmt(l.wasted)} | ${fmt(l.unstable)} | ${fmt(l.renderMs)} | ${fmt(l.wastedMs)} | ${fmt(l.jsMs)} | ${l.n} |`);
}

function compare(a, b) {
  const A = summarize(JSON.parse(readFileSync(a, "utf8")).results);
  const B = summarize(JSON.parse(readFileSync(b, "utf8")).results);
  const cell = (x, y) => `${fmt(x)} → ${fmt(y)}`;
  console.log("| interaction | commits | renders | wasted | unstable props | render ms | JS ms |\n|---|---:|---:|---:|---:|---:|---:|");
  for (const name of INTERACTIONS) {
    const x = A[name];
    const y = B[name];
    if (!x || !y) continue;
    console.log(`| ${name} | ${cell(x.commits, y.commits)} | ${cell(x.renders, y.renders)} | ${cell(x.wasted, y.wasted)} | ${cell(x.unstable, y.unstable)} | ${cell(x.renderMs, y.renderMs)} | ${cell(x.jsMs, y.jsMs)} |`);
  }
}

// The components that render most (and waste most) in one interaction of the last run, with why they rendered.
function top(file, only) {
  const report = JSON.parse(readFileSync(file, "utf8"));
  const last = report.results.at(-1);
  for (const name of only ? [only] : INTERACTIONS) {
    const stats = last[name];
    if (!stats) continue;
    const l = line(stats);
    console.log(`\n## ${name}: ${l.commits} commits, ${l.renders} renders (${l.wasted} wasted, ${l.unstable} unstable props), ${fmt(l.renderMs)} ms rendering, ${fmt(l.jsMs)} ms JS`);
    const rows = Object.keys(stats.renders)
      .filter((k) => !HOST.test(k))
      .map((k) => ({ k, n: stats.renders[k], w: stats.wasted?.[k] ?? 0, u: stats.unstable?.[k] ?? 0, ms: stats.renderMs?.[k] ?? 0, causes: stats.causes?.[k] ?? {} }))
      .sort((x, y) => y.n - x.n || y.ms - x.ms)
      .slice(0, 15);
    for (const row of rows) {
      const causes = Object.entries(row.causes).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(", ");
      console.log(`  ${String(row.n).padStart(5)} renders ${String(row.w).padStart(5)} wasted ${String(row.u).padStart(5)} unstable ${fmt(row.ms).padStart(7)} ms  ${row.k}  (${causes})`);
    }
    const origins = Object.entries(stats.origins ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(", ");
    if (origins) console.log(`  updates start in: ${origins}`);
    const tasks = Object.entries(stats.commitTasks ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([k, n]) => `${k} ${n}`).join(", ");
    if (tasks) console.log(`  commits happen in: ${tasks}`);
    const keys = Object.entries(stats.storeKeys ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(", ");
    if (keys) console.log(`  store keys: ${keys}`);
  }
}

if (command === "run") await run();
else if (command === "compare") compare(positional[0], positional[1]);
else if (command === "top") top(positional[0], positional[1]);
else {
  console.error("usage: render-bench.mjs run --app … --bundle … --label … | compare <a.json> <b.json> | top <report.json> [interaction]");
  process.exit(64);
}

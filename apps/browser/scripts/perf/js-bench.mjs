#!/usr/bin/env node
// JS/React benchmark for Arcadia on a production (Hermes) bundle: what each interaction costs the JS thread
// (React commits and renders, store updates, native→JS tasks, timers, document writes), counted by the opt-in probe
// in src/lib/perfProbe.ts. Gate recipe and the other benches: docs/perf/README.md.
//
//   node js-bench.mjs bundle <outDir> [--profiling 1]
//       Builds the production JS bundle of the current tree (metro, --dev false) and compiles it with
//       hermesc, as the Release build does. Prints sizes and the biggest packages. --profiling 1 bundles
//       React's profiling renderer, which times each component's render (render-bench.mjs uses it).
//   node js-bench.mjs run --app <Release Arcadia.app> --bundle <main.jsbundle> --label <name> [flags]
//       Clones the app (APFS clone), swaps in the bundle, and for each run seeds a fresh data folder
//       (seed.mjs: 200 tabs, 5000 history entries, 1000 bookmarks), launches a hidden instance, runs
//       the scenarios of bench-app.js through the dev harness and quits it. Writes <out>/<label>.json.
//       The bundle must match the app's NATIVE_API_VERSION; a release's own is <app>/Contents/Resources/main.jsbundle.
//         --runs <n>           launches, one per run (default 5)
//         --scenarios <a,b>    of: startup, persistence, idle, typing, switchTabs, openClose, scroll, pageLoad, hover,
//                              profileSwipe, storeUpdate, idleLate (default all, in that order; startup must stay first)
//         --port <n>           the test page server's port (default 47817); instance CDP ports are 9500 + run + …
//         --out <dir>          default $AC_PERF_OUT or /tmp/ac-perf-js
//         --append 1           add these runs to an existing <label>.json (to interleave two builds' runs: alternate
//                              `run --runs 1 --append 1` between them)
//         --probe <options>    the probe's slower options, written into the perf-probe file: selectors (every store
//                              selector timed by call site), renders (why each component rendered), listeners
//         --lib <a.js,b.js>    the scenario files to load instead of bench-app.js, in order (a copy of another revision of
//                              it; ratchet-app.js adds the scenarios ratchet.mjs needs)
//         --seed small         one window with one tab instead of the 200-tab session (the report's `seed` says which)
//         --trace 1            names anonymous timer callbacks by call site (slower: for finding, not timing)
//         --options '<json>'   options passed to every scenario (bench-app.js), e.g. '{"seconds":20}'
//   node js-bench.mjs compare <before.json> <after.json>
//       Prints a before/after table of medians, after a warning line when the two reports' probe or bench
//       revisions differ (their numbers count different things).
//   node js-bench.mjs summary <report.json>
//       Recomputes a report's summary from its raw results (older reports pick up new lines) and prints it.
//
// The app side is the opt-in probe in src/lib/perfProbe.ts, on only when the data folder holds a
// `perf-probe` file (the seed writes one).
//
// Report (<out>/<label>.json):
//   { label, version (the app's CFBundleShortVersionString), bundle, bundleSize (bytes), when,
//     probeRevision   acPerf.revision of the bundle (PERF_PROBE_REVISION in perfProbe.ts; inferred for bundles from
//                     before it existed: 2 if the probe counts commitTasks, else 1). Mixed after --append: an array.
//     benchRevision   BENCH_REVISION below: this script's seed and scenarios
//     results: [{ run, launchedAt (epoch ms before `open`), probeRevision, <scenario>: what acBench.run returned }]
//       startup      { marks: { bundleStart, bundleEnd, firstCommit, firstWindow, processStart }, stats }
//       idle, scroll, idleLate               { stats }
//       typing       { keys: [ms per key], items, stats }       switchTabs, hover, storeUpdate   { steps: [ms], stats }
//       openClose    { open: [ms], close: [ms], openStats, closeStats }
//       pageLoad     { runs: [{ loadMs, stats }] }              profileSwipe   { runs: [{ ms, stats }] }
//       persistence  { history|session|bookmarks: { ms, bytes } }
//       stats        acPerf.read(): counters keyed by name (commits, renders, mounts, hostUpdates, storeUpdates,
//                    listenerMs, tasks, taskMs, timers, timerMs, writes, writeBytes, writeMs, commitTasks, …)
//     summary: { lines: { "<scenario>.<metric>": { median, min, max, n } }, detail: { <scenario>: top offenders } } }

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSeed } from "./seed.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const repo = resolve(appDir, "../..");
const defaultOut = process.env.AC_PERF_OUT ?? "/tmp/ac-perf-js";
// Bump when the seed or bench-app.js scenarios change what the numbers count.
//   1  until e282ac6e: the seed wrote a favicon index (favicons-default.json) the app deleted at startup
//   2  e282ac6e: no favicon index
//   3  storeUpdate flips isLoading on a background tab (it wrote `progress`, a field the app dropped in 33e88e6f)
const BENCH_REVISION = 3;

const [command, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (xs, p) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null;
};
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MARK: Bundle

export function bundle(outDir, { profiling = false } = {}) {
  mkdirSync(outDir, { recursive: true });
  const js = join(outDir, "main.js");
  const hbc = join(outDir, "main.jsbundle");
  const rn = join(repo, "node_modules/react-native-macos");
  execFileSync(
    process.execPath,
    [
      join(rn, "scripts/bundle.js"), "bundle", "--entry-file", "index.js", "--platform", "macos", "--dev", "false",
      "--minify", "false", "--bundle-output", js, "--sourcemap-output", `${js}.map`, "--assets-dest", join(outDir, "assets"),
      "--config-cmd", `'${process.execPath}' '${join(rn, "cli.js")}' config`,
    ],
    { cwd: appDir, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, ...(profiling ? { AC_REACT_PROFILING: "1" } : {}) } },
  );
  const hermesc = join(appDir, "macos/Pods/hermes-engine/destroot/bin/hermesc");
  execFileSync(hermesc, ["-emit-binary", "-max-diagnostic-width=80", "-O", "-out", hbc, js], { stdio: "inherit" });
  const sizes = { js: statSync(js).size, hbc: statSync(hbc).size, packages: packageSizes(js) };
  writeFileSync(join(outDir, "sizes.json"), JSON.stringify(sizes, null, 2));
  console.log(`JS ${(sizes.js / 1024).toFixed(0)} KB, Hermes bytecode ${(sizes.hbc / 1024).toFixed(0)} KB`);
  for (const [name, bytes] of Object.entries(sizes.packages).slice(0, 15)) console.log(`  ${(bytes / 1024).toFixed(0).padStart(6)} KB  ${name}`);
  return sizes;
}

// Generated bytes per package, from the source map.
function packageSizes(js) {
  const map = JSON.parse(readFileSync(`${js}.map`, "utf8"));
  const lines = readFileSync(js, "utf8").split("\n");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const decode = (seg) => {
    const out = [];
    let value = 0;
    let shift = 0;
    for (const ch of seg) {
      const d = chars.indexOf(ch);
      value += (d & 31) << shift;
      if (d & 32) shift += 5;
      else {
        out.push(value & 1 ? -(value >> 1) : value >> 1);
        value = 0;
        shift = 0;
      }
    }
    return out;
  };
  const bytes = new Array(map.sources.length).fill(0);
  let source = 0;
  map.mappings.split(";").forEach((line, row) => {
    let col = 0;
    const segs = line ? line.split(",").map(decode) : [];
    const cols = segs.map((seg) => (col += seg[0]));
    const length = lines[row]?.length ?? 0;
    segs.forEach((seg, i) => {
      if (seg.length < 2) return;
      source += seg[1];
      bytes[source] += Math.max(0, (cols[i + 1] ?? length) - cols[i]);
    });
  });
  const byPackage = {};
  map.sources.forEach((src, i) => {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(src);
    const key = m ? m[1] : /(apps\/browser\/src|packages\/[^/]+)/.exec(src)?.[1] ?? "other";
    byPackage[key] = (byPackage[key] ?? 0) + bytes[i];
  });
  return Object.fromEntries(Object.entries(byPackage).sort((a, b) => b[1] - a[1]));
}

// MARK: Test server

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// Two seconds of a quiet 440 Hz tone (16-bit mono WAV), for a tab that plays audio.
const TONE = (() => {
  const rate = 8000;
  const samples = rate * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 2000), 44 + i * 2);
  return wav;
})();

export function startServer(port) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/img/") || url.pathname === "/favicon.ico") {
      const delay = Number(url.searchParams.get("d") ?? 0);
      return void setTimeout(() => {
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
        res.end(PNG);
      }, delay);
    }
    if (url.pathname === "/heavy") {
      const run = url.searchParams.get("run") ?? "";
      const images = Array.from({ length: 40 }, (_, i) => `<img src="/img/${i}?d=${40 + ((i * 37) % 900)}&r=${run}" width=40 height=40>`).join("");
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return void res.end(`<!doctype html><html><head><meta name="theme-color" content="#336699"><title>Loading ${run}</title>
<link rel="icon" href="/favicon.ico?d=300&r=${run}"></head><body><h1>Heavy page</h1>${images}
<script>let n=0;const t=setInterval(()=>{document.title='Heavy '+(++n);if(n>=5)clearInterval(t)},150);</script></body></html>`);
    }
    // render-bench.mjs: a page that retitles itself every second and swaps its icon every third, a looping tone,
    // a long page to scroll.
    if (url.pathname === "/ticker") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return void res.end(`<!doctype html><html><head><title>Tick 0</title><link id=i rel="icon" href="/favicon.ico?t=0"></head>
<body><p>ticker</p><script>let n=0;setInterval(()=>{document.title='Tick '+(++n);if(n%3===0)document.getElementById('i').href='/favicon.ico?t='+n},1000);</script></body></html>`);
    }
    if (url.pathname === "/tone.wav") {
      res.writeHead(200, { "content-type": "audio/wav", "cache-control": "no-store" });
      return void res.end(TONE);
    }
    if (url.pathname === "/media") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return void res.end(`<!doctype html><html><head><title>Media</title></head><body><audio id=a src="/tone.wav" loop></audio></body></html>`);
    }
    if (url.pathname === "/long") {
      const rows = Array.from({ length: 400 }, (_, i) => `<p style="height:40px">Row ${i}</p>`).join("");
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
      return void res.end(`<!doctype html><html><head><title>Long page</title></head><body>${rows}</body></html>`);
    }
    const name = url.pathname.split("/").pop();
    res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    res.end(`<!doctype html><html><head><title>Page ${name}</title></head><body><p>${name}</p></body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// MARK: App instances

function pidsOf(binary) {
  const r = spawnSync("ps", ["-ww", "-ax", "-o", "pid=", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  return r.stdout
    .split("\n")
    .map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m && (m[2] === binary || m[2].startsWith(`${binary} `)))
    .map((m) => Number(m[1]));
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ARCADIA_SWITCHES ("name=off,other=on") as the switches file a launch reads: a Release build's JS ignores the
// variable (launchEnvironment is DEBUG-only), so a bench of a Release app sets its switches this way.
export function writeSwitches(dataDir, text) {
  if (!text) return;
  const switches = {};
  for (const part of text.split(",")) {
    const [name, value] = part.split("=").map((x) => x.trim());
    if (name && value) switches[name] = !["off", "0", "false"].includes(value);
  }
  writeFileSync(join(dataDir, "switches-cache.json"), JSON.stringify({ version: 1, switches }));
}

export async function launch(app, dataDir, port) {
  // realpath: ps shows the resolved path (/private/var/… for a clone under tmpdir()'s /var/…).
  const binary = join(realpathSync(app), "Contents/MacOS/Arcadia");
  writeSwitches(dataDir, process.env.ARCADIA_SWITCHES);
  if (pidsOf(binary).length) throw new Error(`an instance of ${app} is already running`);
  const launchedAt = Date.now();
  execFileSync("open", [
    "-g", "-n", "--env", "ARCADIA_BACKGROUND=1", "--env", `ARCADIA_DATA_DIR=${dataDir}`,
    "--env", `ARCADIA_REMOTE_DEBUGGING_PORT=${port}`,
    // Kill switches for this run (docs/kill-switches.md): ARCADIA_SWITCHES=name=off node ratchet.mjs run …
    ...(process.env.ARCADIA_SWITCHES ? ["--env", `ARCADIA_SWITCHES=${process.env.ARCADIA_SWITCHES}`] : []),
    app,
  ]);
  for (let i = 0; i < 200; i++) {
    const [pid] = pidsOf(binary);
    if (pid) return { pid, launchedAt };
    await sleep(50);
  }
  throw new Error("app did not start");
}

export async function quit(pid) {
  if (!alive(pid)) return;
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 150 && alive(pid); i++) await sleep(100);
  if (alive(pid)) process.kill(pid, "SIGKILL");
}

let evalSeq = 0;
export async function evaluate(dataDir, pid, body, timeoutMs = 120_000) {
  const id = `bench-${process.pid}-${++evalSeq}`;
  writeFileSync(join(dataDir, "dev-eval.js"), `// ${id}\n${body}`);
  const file = join(dataDir, "dev-eval-result.json");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!alive(pid)) throw new Error("app exited");
    if (existsSync(file)) {
      try {
        const out = JSON.parse(readFileSync(file, "utf8"));
        if (out.id === id) {
          if (out.error) throw new Error(`in app: ${out.error}`);
          return out.result;
        }
      } catch (error) {
        if (String(error).includes("in app:")) throw error;
      }
    }
    await sleep(50);
  }
  throw new Error(`timed out: ${body.slice(0, 80)}`);
}

// MARK: Run

// --seed small: the seed's profile (history, bookmarks, settings) with a session of one window holding one tab, the
// launch of someone who has barely used the browser (ratchet.mjs gates the first commit's mounts on both).
function smallSession(dataDir) {
  const file = join(dataDir, "session.json");
  const session = JSON.parse(readFileSync(file, "utf8"));
  const win = session.windows[0];
  const keep = win.activeTabIds[win.profileId];
  session.tabs = session.tabs.filter((t) => t.id === keep);
  session.groups = [];
  session.profiles = { [win.profileId]: session.profiles[win.profileId] };
  session.profileOrder = [win.profileId];
  win.tabIds = [keep];
  win.activeTabIds = { [win.profileId]: keep };
  writeFileSync(file, JSON.stringify(session));
}

// A bundle swapped into the copy breaks the app's code seal ("a sealed resource is missing or invalid"), and macOS
// kills a hardened-runtime app with a broken seal a few seconds after launch ("app exited" in evaluate). Sign the copy
// again with the original's identity and entitlements, as native-bench's prepareApp does (no secure timestamp: Apple's
// server sometimes doesn't answer).
function resign(app, clone) {
  const info = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr;
  const identity = info.match(/^Authority=(.+)$/m)?.[1] ?? "-";
  const entitlements = `${clone}.entitlements.plist`;
  writeFileSync(entitlements, execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8" }));
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", "--entitlements", entitlements, clone], { stdio: "inherit" });
}

const ALL = ["startup", "persistence", "idle", "typing", "switchTabs", "openClose", "scroll", "pageLoad", "hover", "profileSwipe", "storeUpdate", "idleLate"];

async function run() {
  const { app, bundle: jsbundle, label, runs = "5", port = "47817", out = defaultOut } = flags;
  if (!app || !jsbundle || !label) throw new Error("run needs --app, --bundle and --label");
  const scenarios = flags.scenarios ? flags.scenarios.split(",") : ALL;
  const clone = join(out, "apps", label, "Arcadia.app");
  rmSync(dirname(clone), { recursive: true, force: true });
  mkdirSync(dirname(clone), { recursive: true });
  execFileSync("cp", ["-cR", app, clone]);
  const swapped = join(clone, "Contents/Resources/main.jsbundle");
  const same = readFileSync(jsbundle).equals(readFileSync(swapped));
  cpSync(jsbundle, swapped);
  if (!same) resign(app, clone);
  const version = execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print CFBundleShortVersionString", join(clone, "Contents/Info.plist")], { encoding: "utf8" }).trim();
  const origin = `http://127.0.0.1:${port}`;
  const server = await startServer(Number(port));
  const libs = (flags.lib ? flags.lib.split(",") : [join(here, "bench-app.js")]).map((file) => readFileSync(file, "utf8"));
  const results = [];
  try {
    for (let r = 0; r < Number(runs); r++) {
      const dataDir = join(out, "data", `${label}-${flags.append ? `${Date.now()}-` : ""}${r}`);
      rmSync(dataDir, { recursive: true, force: true });
      writeSeed(dataDir, origin, version);
      if (flags.seed === "small") smallSession(dataDir);
      // --probe selectors (etc.) turns on the probe's slower options (src/lib/perfProbe.ts).
      if (flags.probe) writeFileSync(join(dataDir, "perf-probe"), flags.probe);
      const { pid, launchedAt } = await launch(clone, dataDir, 9500 + r + (label.length % 50) * 10);
      const result = { run: r, launchedAt };
      try {
        // The harness ignores a script that was already there when it started; ping until it answers.
        let ready = false;
        for (let i = 0; i < 30 && !ready; i++) ready = await evaluate(dataDir, pid, "return 1;", 2000).then(() => true, (e) => (String(e).includes("exited") ? Promise.reject(e) : false));
        if (!ready) throw new Error("dev harness never answered");
        for (const lib of libs) await evaluate(dataDir, pid, lib, 60_000);
        for (const name of scenarios) {
          process.stderr.write(`[${label} ${r}] ${name}\n`);
          // --trace 1 names anonymous timer callbacks by their call sites (slower; for finding, not timing).
          // --options '{"slowMs":300}' passes scenario options.
          const options = JSON.stringify({ ...(flags.options ? JSON.parse(flags.options) : {}), origin, scenario: name });
          const entry = flags.trace && name !== "startup" ? "traced" : name;
          result[name] = await evaluate(dataDir, pid, `return acBench.run(${JSON.stringify(entry)}, ${options});`);
        }
        // Asked last, so startup's counts don't include it. Bundles from before acPerf.revision: 6232fa43 (revision 2)
        // added commitTasks.
        result.probeRevision = await evaluate(dataDir, pid, `return acPerf.revision ?? ("commitTasks" in acPerf.read() ? 2 : 1);`);
      } finally {
        await quit(pid);
      }
      results.push(result);
    }
  } finally {
    server.close();
  }
  const bundleSize = statSync(jsbundle).size;
  // --append 1 adds these runs to an existing report (to interleave two builds' runs under the same load).
  const file = join(out, `${label}.json`);
  if (flags.append && existsSync(file)) results.unshift(...JSON.parse(readFileSync(file, "utf8")).results);
  const revisions = [...new Set(results.map(runRevision))];
  if (revisions.length > 1) console.log(`WARNING: these runs mix probe revisions ${revisions.join(", ")}; their numbers don't compare`);
  const report = {
    label, version, seed: flags.seed ?? "big", bundle: jsbundle, bundleSize, when: new Date().toISOString(),
    probeRevision: revisions.length > 1 ? revisions : revisions[0], benchRevision: BENCH_REVISION,
    results, summary: summarize(results, bundleSize),
  };
  writeFileSync(file, JSON.stringify(report, null, 2));
  printSummary(report.summary);
  console.log(`\nwrote ${file}`);
}

// MARK: Summary

// Host wrappers render whenever their parent does; the detail lists the app's own components.
const HOST = /^(View|Text|Pressable|Image|ScrollView|TextInput|InternalTextInput|Animated\(.*\)|Arcadia.*|Surface|Symbol|MouseArea|ContextMenuArea|FadeLabel|VirtualizedList.*|CellRenderer.*)$/;
const appOnly = (counter) => Object.fromEntries(Object.entries(counter ?? {}).filter(([k]) => !HOST.test(k)));

const top = (counter, n = 6) =>
  Object.entries(counter ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${Math.round(v)}`)
    .join(", ");

function statLine(stats) {
  return {
    commits: stats.commits,
    renders: sum(stats.renders),
    mounts: sum(stats.mounts),
    hostUpdates: stats.hostUpdates,
    storeUpdates: stats.storeUpdates?.browser ?? 0,
    // Module-level store subscribers only (components subscribe through zustand's internal api).
    listenerMs: sum(stats.listenerMs),
    listenerCalls: sum(stats.listenerCalls),
    taskMs: sum(stats.taskMs),
    tasks: sum(stats.tasks),
    writes: sum(stats.writes),
    writeKB: sum(stats.writeBytes) / 1024,
    writeMs: sum(stats.writeMs),
    walkMs: stats.walkMs,
  };
}

function summarize(results, bundleSize) {
  const pick = (fn) => results.map((r) => {
    try {
      return fn(r);
    } catch {
      return null;
    }
  });
  const m = (fn) => {
    const xs = pick(fn).filter((x) => x !== null && x !== undefined);
    return { median: median(xs), min: xs.length ? Math.min(...xs) : null, max: xs.length ? Math.max(...xs) : null, n: xs.length };
  };
  const lines = {};
  const add = (key, fn) => (lines[key] = m(fn));
  const statKeys = (key, fn) => {
    for (const k of ["commits", "renders", "hostUpdates", "storeUpdates", "listenerMs", "taskMs", "writes", "writeKB"]) add(`${key}.${k}`, (r) => statLine(fn(r))[k]);
  };
  lines["bundle.hbcKB"] = { median: bundleSize / 1024, min: bundleSize / 1024, max: bundleSize / 1024, n: 1 };
  add("startup.launchToBundleMs", (r) => r.startup.marks.bundleStart - r.launchedAt);
  add("startup.bundleEvalMs", (r) => r.startup.marks.bundleEnd - r.startup.marks.bundleStart);
  add("startup.bundleToFirstCommitMs", (r) => r.startup.marks.firstCommit - r.startup.marks.bundleStart);
  add("startup.bundleToFirstWindowMs", (r) => r.startup.marks.firstWindow - r.startup.marks.bundleStart);
  add("startup.launchToFirstWindowMs", (r) => r.startup.marks.firstWindow - r.launchedAt);
  statKeys("startup", (r) => r.startup.stats);
  add("persist.historyStringifyMs", (r) => r.persistence.history.ms);
  add("persist.historyKB", (r) => r.persistence.history.bytes / 1024);
  add("persist.sessionStringifyMs", (r) => r.persistence.session.ms);
  add("persist.bookmarksStringifyMs", (r) => r.persistence.bookmarks.ms);
  statKeys("idle10s", (r) => r.idle.stats);
  add("idle10s.timerCallbacks", (r) => sum(Object.fromEntries(Object.entries(r.idle.stats.timers).filter(([k]) => !k.includes("pollDevEval")))));
  add("typing.keyMedianMs", (r) => median(r.typing.keys));
  add("typing.keyP95Ms", (r) => pct(r.typing.keys, 0.95));
  add("typing.keyMaxMs", (r) => Math.max(...r.typing.keys));
  statKeys("typing30", (r) => r.typing.stats);
  // JS time the app spent beyond the measured steps themselves (effects, timers, promise work, events).
  const beyond = (stats, steps) => statLine(stats).taskMs - steps.reduce((a, b) => a + b, 0);
  add("typing30.otherJsMs", (r) => beyond(r.typing.stats, r.typing.keys));
  add("switch.medianMs", (r) => median(r.switchTabs.steps));
  add("switch12.otherJsMs", (r) => beyond(r.switchTabs.stats, r.switchTabs.steps));
  add("open20.otherJsMs", (r) => beyond(r.openClose.openStats, r.openClose.open));
  add("close20.otherJsMs", (r) => beyond(r.openClose.closeStats, r.openClose.close));
  add("hover24.otherJsMs", (r) => beyond(r.hover.stats, r.hover.steps));
  statKeys("switch12", (r) => r.switchTabs.stats);
  add("open.medianMs", (r) => median(r.openClose.open));
  add("close.medianMs", (r) => median(r.openClose.close));
  statKeys("open20", (r) => r.openClose.openStats);
  statKeys("close20", (r) => r.openClose.closeStats);
  statKeys("scroll", (r) => r.scroll.stats);
  add("pageLoad.loadMs", (r) => median(r.pageLoad.runs.map((x) => x.loadMs)));
  for (const k of ["commits", "renders", "hostUpdates", "storeUpdates", "listenerMs", "taskMs", "writes", "writeKB"])
    add(`pageLoad.${k}`, (r) => median(r.pageLoad.runs.map((x) => statLine(x.stats)[k])));
  add("hover.medianMs", (r) => median(r.hover.steps));
  statKeys("hover24", (r) => r.hover.stats);
  add("storeUpdate.medianMs", (r) => median(r.storeUpdate.steps));
  add("storeUpdate.p95Ms", (r) => pct(r.storeUpdate.steps, 0.95));
  statKeys("idleLate10s", (r) => r.idleLate.stats);
  add("idleLate10s.timerCallbacks", (r) => sum(Object.fromEntries(Object.entries(r.idleLate.stats.timers).filter(([k]) => !k.includes("pollDevEval")))));
  add("save.msPerCall", (r) => {
    const all = [r.idle, r.switchTabs, r.pageLoad?.runs?.at(-1), r.typing].filter(Boolean).map((x) => x.stats);
    const ms = all.reduce((a, st) => a + (st.timerMs["setTimeout:save"] ?? 0), 0);
    const n = all.reduce((a, st) => a + (st.timers["setTimeout:save"] ?? 0), 0);
    return n ? ms / n : null;
  });
  add("profileSwipe.commandMs", (r) => median(r.profileSwipe.runs.map((x) => x.ms)));
  for (const k of ["commits", "renders", "hostUpdates", "taskMs"])
    add(`profileSwipe.${k}`, (r) => median(r.profileSwipe.runs.map((x) => statLine(x.stats)[k])));

  // What renders most, from the last run, for reading.
  const last = results.at(-1) ?? {};
  const detail = {};
  const put = (key, stats) => stats && (detail[key] = { renders: top(appOnly(stats.renders), 12), storeKeys: top(stats.storeKeys, 8), tasks: top(stats.tasks, 8), taskMs: top(stats.taskMs, 6), timers: top(stats.timers, 8), timerMs: top(stats.timerMs, 8), writes: top(stats.writeBytes, 5) });
  put("idle", last.idle?.stats);
  put("typing", last.typing?.stats);
  put("switchTabs", last.switchTabs?.stats);
  put("open", last.openClose?.openStats);
  put("close", last.openClose?.closeStats);
  put("scroll", last.scroll?.stats);
  put("pageLoad", last.pageLoad?.runs?.at(-1)?.stats);
  put("hover", last.hover?.stats);
  put("profileSwipe", last.profileSwipe?.runs?.[0]?.stats);
  put("startup", last.startup?.stats);
  put("storeUpdate", last.storeUpdate?.stats);
  put("idleLate", last.idleLate?.stats);
  return { lines, detail };
}

const fmt = (v) => (v === null || v === undefined ? "–" : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));

function printSummary(summary) {
  for (const [key, v] of Object.entries(summary.lines)) console.log(`${key.padEnd(36)} ${fmt(v.median).padStart(9)}   [${fmt(v.min)}–${fmt(v.max)}] n=${v.n}`);
  for (const [key, d] of Object.entries(summary.detail)) {
    console.log(`\n${key}`);
    for (const [k, v] of Object.entries(d)) if (v) console.log(`  ${k}: ${v}`);
  }
}

// A run's probe revision: stamped, or inferred from its counters for reports from before the stamp.
const runRevision = (r) => {
  if (r.probeRevision !== undefined) return r.probeRevision;
  const stats = Object.values(r).find((v) => v?.stats)?.stats;
  return stats ? ("commitTasks" in stats ? 2 : 1) : "unknown";
};
const reportRevisions = (report) => {
  const probe = [...new Set(report.results.map(runRevision))].join("+");
  return { probe: report.probeRevision === undefined ? `${probe} (inferred)` : probe, bench: report.benchRevision ?? "1 (unstamped)" };
};

function compare(a, b) {
  const reports = [a, b].map((file) => JSON.parse(readFileSync(file, "utf8")));
  const [ra, rb] = reports.map(reportRevisions);
  const strip = (v) => String(v).replace(/ \(.*\)$/, "");
  if (strip(ra.probe) !== strip(rb.probe))
    console.log(`WARNING: probe revisions differ (before ${ra.probe}, after ${rb.probe}): taskMs, otherJsMs and the other probe counts measure different things; compare builds on the same bundle or on bundles of one revision (perfProbe.ts PERF_PROBE_REVISION).\n`);
  if (strip(ra.bench) !== strip(rb.bench))
    console.log(`WARNING: bench revisions differ (before ${ra.bench}, after ${rb.bench}): the seed or scenarios changed between the two runs; rerun both with one js-bench.\n`);
  const [A, B] = reports.map((report) => summarize(report.results, report.bundleSize).lines);
  console.log(`| metric | before | after | change |\n|---|---:|---:|---:|`);
  for (const key of Object.keys(A)) {
    const x = A[key]?.median;
    const y = B[key]?.median;
    const change = x && y !== null && y !== undefined ? `${(((y - x) / x) * 100).toFixed(0)}%` : "";
    console.log(`| ${key} | ${fmt(x)} [${fmt(A[key].min)}–${fmt(A[key].max)}] | ${fmt(y)} [${fmt(B[key]?.min)}–${fmt(B[key]?.max)}] | ${change} |`);
  }
}

// render-bench.mjs imports the launcher and server from here; the commands run only from the command line.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === "help" || command === "--help" || command === "-h" || "help" in flags) {
    const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
    console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  } else if (command === "bundle") bundle(positional[0] ?? join(defaultOut, "bundle"), { profiling: !!flags.profiling });
  else if (command === "run") await run();
  else if (command === "compare") compare(positional[0], positional[1]);
  else if (command === "summary") {
    // Recomputes the summary from the raw results (so older reports pick up new summary lines).
    const report = JSON.parse(readFileSync(positional[0], "utf8"));
    report.summary = summarize(report.results, report.bundleSize);
    writeFileSync(positional[0], JSON.stringify(report, null, 2));
    printSummary(report.summary);
  } else {
    console.error("usage: js-bench.mjs bundle <outDir> [--profiling 1] | run --app … --bundle … --label … | compare <a.json> <b.json> | summary <a.json> (--help)");
    process.exit(64);
  }
}

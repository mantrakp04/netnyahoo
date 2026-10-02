#!/usr/bin/env node
// Native performance benchmark: launch, idle cost, memory, tab/window latency and background throttling of a
// Release build, driven in hidden instances (NETNYAHOO_BACKGROUND=1, a throwaway NETNYAHOO_DATA_DIR each run).
//
//   node apps/browser/scripts/perf/native-bench.mjs --app <Release Netnyahoo.app> --out <dir> [options]
//     --label <name>        name of this set of results (default: the app's folder name)
//     --bundle <file>       Hermes bundle of scripts/perf/bench-entry.js to run (built from the working tree when
//                           omitted). Pass the same file to a before and an after run so only native code differs.
//     --runs <n>            session runs (default 3); --launch-runs <n> cold launches (default 5)
//     --idle <secs>         each idle window (default 60)
//     --only <a,b>          phases: launch, session (idle/memory/switch/new tab/window/close), throttle, churn, sample,
//                           windows (new windows alone: 8 per run, --runs runs)
//     --compare <a.json>    print a before/after table against another run's results.json
//     --report <b.json>     print the table for saved results (with --compare, before/after) without running
//
// Results: <out>/<label>/results.json (every sample) and a summary table (median, min–max over runs) on stdout.
// Needs: Node 22+, swiftc (builds scripts/perf/nnperf.swift), clang (builds scripts/perf/nnmark.m, loaded into the copy
// of the app to mark when a window's content appears), the app signed with an identity in the keychain.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "../..");
const repoRoot = resolve(appRoot, "../..");
const { values: opt } = parseArgs({
  options: {
    app: { type: "string" },
    out: { type: "string", default: join(tmpdir(), "nn-native-bench") },
    label: { type: "string" },
    bundle: { type: "string" },
    runs: { type: "string", default: "3" },
    "launch-runs": { type: "string", default: "5" },
    idle: { type: "string", default: "60" },
    only: { type: "string", default: "launch,session,throttle,sample" },
    compare: { type: "string" },
    report: { type: "string" },
    port: { type: "string", default: "9377" },
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...a);
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// MARK: Probes

const toolDir = join(opt.out, ".tools");
function nnperf(...args) {
  const bin = join(toolDir, "nnperf");
  const src = join(here, "nnperf.swift");
  if (!existsSync(bin) || readFileSync(src, "utf8") !== (existsSync(bin + ".src") ? readFileSync(bin + ".src", "utf8") : "")) {
    mkdirSync(toolDir, { recursive: true });
    execFileSync("swiftc", ["-O", src, "-o", bin], { stdio: "inherit" });
    writeFileSync(bin + ".src", readFileSync(src, "utf8"));
  }
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: r.stdout.trim() };
}

// The content marker (nnmark.m), loaded into the benchmark's copy of the app.
function markerLibrary() {
  const lib = join(toolDir, "nnmark.dylib");
  const src = join(here, "nnmark.m");
  if (!existsSync(lib) || readFileSync(src, "utf8") !== (existsSync(lib + ".src") ? readFileSync(lib + ".src", "utf8") : "")) {
    mkdirSync(toolDir, { recursive: true });
    execFileSync("clang", ["-dynamiclib", "-fobjc-arc", "-framework", "AppKit", "-framework", "QuartzCore", "-arch", "arm64", src, "-o", lib], { stdio: "inherit" });
    execFileSync("codesign", ["--force", "--sign", "-", lib]);
    writeFileSync(lib + ".src", readFileSync(src, "utf8"));
  }
  return lib;
}

function processTree(root) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: +pid, ppid: +ppid, command }));
  const tree = [];
  const walk = (pid) => {
    for (const row of rows) if (row.ppid === pid) tree.push(row), walk(row.pid);
  };
  const self = rows.find((r) => r.pid === root);
  if (!self) return [];
  tree.push(self);
  walk(root);
  return tree.map((r) => ({ pid: r.pid, kind: kindOf(r.command) }));
}

function kindOf(command) {
  const type = command.match(/--type=(\S+)/)?.[1];
  if (!type) return "browser";
  if (type === "utility") return `utility:${command.match(/--utility-sub-type=([\w.]+)/)?.[1]?.split(".")[0] ?? "?"}`;
  if (type === "renderer" && command.includes("--extension-process")) return "extension";
  return type;
}

function usage(root) {
  const procs = processTree(root);
  const byPid = new Map(procs.map((p) => [p.pid, p.kind]));
  const lines = procs.length ? nnperf("rusage", ...procs.map((p) => String(p.pid))).out.split("\n").filter(Boolean) : [];
  return lines.map((l) => JSON.parse(l)).map((u) => ({ ...u, kind: byPid.get(u.pid) }));
}

// CPU % and wakeups/s per process kind between two usage() snapshots (processes present in both).
function usageDelta(a, b) {
  const before = new Map(a.map((u) => [u.pid, u]));
  const kinds = {};
  let total = { cpu: 0, wakeups: 0 };
  for (const u of b) {
    const p = before.get(u.pid);
    if (!p) continue;
    const secs = (u.at - p.at) / 1000;
    const cpu = ((u.cpuNs - p.cpuNs) / 1e9 / secs) * 100;
    const wakeups = (u.idleWakeups + u.interruptWakeups - p.idleWakeups - p.interruptWakeups) / secs;
    const k = (kinds[u.kind] ??= { cpu: 0, wakeups: 0, count: 0 });
    k.cpu += cpu;
    k.wakeups += wakeups;
    k.count++;
    total.cpu += cpu;
    total.wakeups += wakeups;
  }
  return { total, kinds };
}

const footprint = (snap) => {
  const kinds = {};
  let total = 0;
  for (const u of snap) {
    kinds[u.kind] = (kinds[u.kind] ?? 0) + u.footprint / 1048576;
    total += u.footprint / 1048576;
  }
  return { totalMB: total, processes: snap.length, kinds };
};

// MARK: Test pages

const PAGE_SCRIPT = `
window.__nn = { vis: [[Date.now(), document.visibilityState]], shown: [], fcp: null, frame: null, ticks: 0, raf: 0, fast: 0 };
// The page's first frame (its first animation frame starts): the same event in every build. First contentful paint
// isn't: CEF (0.2.21) stamps it with that frame's start, Chrome (NNCore) with the frame on screen, ~a frame later.
requestAnimationFrame(() => (__nn.frame = Date.now()));
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.name === "first-contentful-paint") __nn.fcp = performance.timeOrigin + e.startTime;
}).observe({ type: "paint", buffered: true });
document.addEventListener("visibilitychange", () => {
  const t = Date.now();
  __nn.vis.push([t, document.visibilityState]);
  if (document.visibilityState === "visible")
    requestAnimationFrame(() => requestAnimationFrame(() => __nn.shown.push([t, Date.now()])));
});
setInterval(() => __nn.ticks++, 1000);
`;

function staticPage(id) {
  const paras = Array.from({ length: 120 }, (_, i) =>
    `<p>Paragraph ${i} of page ${id}. The quick brown fox jumps over the lazy dog; pack my box with five dozen liquor jugs. ` +
    `Sphinx of black quartz, judge my vow. <a href="#p${i}">anchor ${i}</a></p>`).join("");
  const boxes = Array.from({ length: 60 }, (_, i) =>
    `<div class=b style="background:hsl(${(i * 37 + Number(id.replace(/\D/g, "") || 0) * 11) % 360} 60% 70%)">${i}</div>`).join("");
  return `<!doctype html><meta charset=utf-8><title>Bench ${id}</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;margin:0;padding:24px 48px;background:#fbfaf8;color:#222}
.g{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin:16px 0}.b{height:48px;border-radius:10px;display:grid;place-items:center}
h1{font-size:32px}</style><h1>Bench page ${id}</h1><div class=g>${boxes}</div>${paras}<script>${PAGE_SCRIPT}</script>`;
}

function animPage(id) {
  return `<!doctype html><meta charset=utf-8><title>Anim ${id}</title>
<style>@keyframes s{to{transform:rotate(360deg)}}.s{width:80px;height:80px;background:#c35;animation:s 1s linear infinite;margin:40px}</style>
<h1>Anim ${id}</h1><div class=s></div><script>${PAGE_SCRIPT}
(function f(){ __nn.raf++; requestAnimationFrame(f); })();
setInterval(() => __nn.fast++, 16);</script>`;
}

function startServer() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      const id = url.searchParams.get("id") ?? "0";
      const html = url.pathname === "/anim" ? animPage(id) : url.pathname === "/static" ? staticPage(id) : null;
      if (!html) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html);
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

// MARK: CDP

class Cdp {
  constructor(port) {
    this.port = port;
    this.sockets = new Map();
    this.seq = 0;
  }
  async targets() {
    try {
      const r = await fetch(`http://127.0.0.1:${this.port}/json/list`, { signal: AbortSignal.timeout(3000) });
      return (await r.json()).filter((t) => t.type === "page");
    } catch {
      return [];
    }
  }
  async socket(target) {
    let s = this.sockets.get(target.id);
    if (s && s.readyState === 1) return s;
    s = new WebSocket(target.webSocketDebuggerUrl);
    s.pending = new Map();
    s.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      s.pending.get(msg.id)?.(msg);
      s.pending.delete(msg.id);
    };
    await new Promise((ok, fail) => ((s.onopen = ok), (s.onerror = fail), setTimeout(fail, 3000)));
    this.sockets.set(target.id, s);
    return s;
  }
  async send(target, method, params = {}, timeout = 4000) {
    const s = await this.socket(target);
    const id = ++this.seq;
    return new Promise((ok) => {
      const timer = setTimeout(() => (s.pending.delete(id), ok(null)), timeout);
      s.pending.set(id, (msg) => (clearTimeout(timer), ok(msg.result ?? null)));
      s.send(JSON.stringify({ id, method, params }));
    });
  }
  async state(target) {
    const r = await this.send(target, "Runtime.evaluate", {
      expression: "JSON.stringify(Object.assign({}, window.__nn, { visibility: document.visibilityState }))",
      returnByValue: true,
    }).catch(() => null);
    try {
      return JSON.parse(r?.result?.value ?? "null");
    } catch {
      return null;
    }
  }
  // `id=t1` must not match `id=t13`: page URLs end with their id.
  async find(substring) {
    return (await this.targets()).find((t) => t.url.endsWith(substring) || t.url.includes(substring + "&"));
  }
  close() {
    for (const s of this.sockets.values()) s.close();
    this.sockets.clear();
  }
}

// MARK: App instances

let benchApp = null;

function prepareApp(app, out, bundle) {
  const copy = join(out, "Netnyahoo.app");
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  execFileSync("cp", ["-Rc", app, copy]);
  cpSync(bundle, join(copy, "Contents/Resources/main.jsbundle"));
  const info = spawnSync("codesign", ["-dvv", app], { encoding: "utf8" }).stderr;
  const identity = info.match(/^Authority=(.+)$/m)?.[1] ?? "-";
  const entitlements = join(out, "entitlements.plist");
  // The copy loads the content marker (nnmark.m): DYLD_INSERT_LIBRARIES, an ad-hoc signed library.
  const granted = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { encoding: "utf8" });
  const marker = ["com.apple.security.cs.allow-dyld-environment-variables", "com.apple.security.cs.disable-library-validation"]
    .filter((key) => !granted.includes(`<key>${key}</key>`)).map((key) => `<key>${key}</key><true/>`).join("");
  writeFileSync(entitlements, granted.replace(/<\/dict>\s*<\/plist>\s*$/, `${marker}</dict></plist>`));
  execFileSync("codesign", ["--force", "--sign", identity, "--options", "runtime", "--entitlements", entitlements, copy], { stdio: "inherit" });
  return copy;
}

function buildBundle(out) {
  const js = join(out, "bench.js"), hbc = join(out, "main.jsbundle");
  const node = process.execPath;
  log("bundling scripts/perf/bench-entry.js (production)");
  execFileSync(node, [join(repoRoot, "node_modules/react-native-macos/scripts/bundle.js"), "bundle", "--entry-file", "scripts/perf/bench-entry.js",
    "--platform", "macos", "--dev", "false", "--minify", "false", "--bundle-output", js, "--assets-dest", join(out, "assets"),
    "--config-cmd", `'${node}' '${join(repoRoot, "node_modules/react-native-macos/cli.js")}' config`], { cwd: appRoot, stdio: "inherit" });
  execFileSync(join(appRoot, "macos/Pods/hermes-engine/destroot/bin/hermesc"), ["-emit-binary", "-O", "-out", hbc, js], { stdio: "inherit" });
  return hbc;
}

class Instance {
  constructor(dataDir, port, feed) {
    this.dataDir = dataDir;
    this.port = port;
    this.feed = feed;
    this.cdp = new Cdp(port);
    this.seq = 0;
  }
  async launch() {
    const exe = join(benchApp, "Contents/MacOS", execFileSync("defaults", ["read", join(benchApp, "Contents/Info.plist"), "CFBundleExecutable"], { encoding: "utf8" }).trim());
    const main = `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;
    if (spawnSync("pgrep", ["-f", main]).status === 0) throw new Error("a bench instance is still running");
    this.t0 = Date.now();
    execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${this.dataDir}`,
      "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${this.port}`, "--env", `NETNYAHOO_UPDATE_FEED_URL=${this.feed}`,
      "--env", `DYLD_INSERT_LIBRARIES=${markerLibrary()}`, benchApp,
      // App Nap would stretch the hidden instance's timers (a tab switch after a quiet minute took seconds).
      // BENCH_ALLOW_APP_NAP=1 leaves it on: the control for the App Nap check in the table. --mute-audio: builds
      // before b7899c26 (0.2.21, whose CEF takes its switches from the command line) aren't muted on their own.
      "--args", "--mute-audio", ...(process.env.BENCH_ALLOW_APP_NAP ? [] : ["-NSAppSleepDisabled", "YES"])]);
    for (let i = 0; i < 400 && !this.pid; i++) {
      const r = spawnSync("pgrep", ["-f", main], { encoding: "utf8" });
      if (r.status === 0) this.pid = +r.stdout.trim().split("\n")[0];
      else await sleep(5);
    }
    if (!this.pid) throw new Error("the app didn't start");
    const w = nnperf("waitwindow", String(this.pid), "60");
    this.windowAt = w.code === 0 ? +w.out : NaN;
    const boot = await this.waitFile("bench-boot.json", 60_000);
    this.jsStart = boot?.jsStart ?? NaN;
    return this;
  }
  // The content marker's marks (nnmark.m): {content|committed: epoch ms, window}.
  marks() {
    try {
      return readFileSync(join(this.dataDir, "bench-marks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }
  alive() {
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  async waitFile(name, timeout, accept = () => true) {
    const file = join(this.dataDir, name);
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (!this.alive()) throw new Error(`the app (pid ${this.pid}) died`);
      try {
        const v = JSON.parse(readFileSync(file, "utf8"));
        if (accept(v)) return v;
      } catch {}
      await sleep(20);
    }
    return null;
  }
  // Runs `body` (JS with `nn` in scope) in the app and returns its result.
  async run(body, timeout = 30_000) {
    const id = `b${process.pid}-${++this.seq}-${Date.now()}`;
    writeFileSync(join(this.dataDir, "bench-cmd.js"), `// ${id}\n${body}`);
    const r = await this.waitFile("bench-result.json", timeout, (v) => v.id === id);
    if (!r) throw new Error(`no result for: ${body.slice(0, 80)}`);
    if (r.error) throw new Error(`${r.error} in: ${body.slice(0, 80)}`);
    return r.result;
  }
  async pageState(substring, timeout = 20_000, accept = (s) => s) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const t = await this.cdp.find(substring);
      const s = t && (await this.cdp.state(t));
      if (s && accept(s)) return s;
      await sleep(15);
    }
    return null;
  }
  async quit() {
    this.cdp.close();
    if (!this.pid || !this.alive()) return;
    nnperf("quit", String(this.pid));
    for (let i = 0; i < 100 && this.alive(); i++) await sleep(100);
    if (this.alive()) process.kill(this.pid, "SIGKILL");
    const helpers = () => spawnSync("pgrep", ["-f", benchApp], { encoding: "utf8" }).stdout.trim();
    for (let i = 0; i < 100 && helpers(); i++) await sleep(100);
    for (const p of helpers().split("\n").filter(Boolean)) process.kill(+p, "SIGKILL");
  }
}

// MARK: Phases

const base = () => `http://127.0.0.1:${server.address().port}`;
let server;
const results = { meta: {}, launch: [], session: [], windows: [], throttle: [], sample: [] };

const WINDOW = `(() => { const s = nn.store.getState(); return s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : s.windowOrder.find((id) => s.windows[id] && !s.windows[id].kind); })()`;

async function makeTemplate(dir) {
  log("seeding a session");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // Past onboarding: its intro music would play on the owner's Mac from builds without b7899c26 (0.2.21).
  writeFileSync(join(dir, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  const app = await new Instance(dir, +opt.port, `${base()}/appcast.xml`).launch();
  try {
    await app.run(`const w = ${WINDOW}; nn.store.getState().newTab(w, { url: "${base()}/static?id=seed" }); return w;`);
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    // Leave just the seeded tab.
    await app.run(`const s = nn.store.getState(); const w = ${WINDOW};
      const keep = s.windows[w].tabIds.find((id) => s.tabs[id].url.includes("id=seed"));
      for (const id of s.windows[w].tabIds) if (id !== keep) nn.store.getState().closeTab(id);
      for (const id of s.windowOrder) if (id !== w) nn.store.getState().closeWindow(id);
      nn.store.getState().activate(keep); return keep;`);
    await sleep(4000);
  } finally {
    await app.quit();
  }
  for (const f of ["bench-cmd.js", "bench-result.json", "bench-boot.json"]) rmSync(join(dir, f), { force: true });
}

function freshDir(template, name) {
  const dir = join(opt.out, label, "data", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("cp", ["-Rc", template, dir]);
  return dir;
}

async function launchRuns(template) {
  for (let i = 0; i < +opt["launch-runs"]; i++) {
    const app = new Instance(freshDir(template, `launch-${i}`), +opt.port, `${base()}/appcast.xml`);
    try {
      await app.launch();
      const page = await app.pageState("id=seed", 30_000, (s) => s.fcp);
      // On screen with its content, as for new windows: 0.2.21 showed its first window empty and its content after,
      // 0.2.22 keeps it transparent until the transaction carrying its React content commits.
      const content = app.marks().find((m) => m.content >= app.t0);
      const committed = content && app.marks().find((m) => m.committed >= content.content && m.window === content.window);
      const r = {
        window: app.windowAt - app.t0,
        withContent: committed ? Math.max(app.windowAt, committed.committed) - app.t0 : NaN,
        js: app.jsStart - app.t0,
        firstPaint: (page?.fcp ?? NaN) - app.t0,
        firstFrame: (page?.frame ?? NaN) - app.t0,
      };
      log(`launch ${i}:`, JSON.stringify(r));
      results.launch.push(r);
    } finally {
      await app.quit();
    }
    await sleep(3000);
  }
}

async function idleWindow(app, secs) {
  await app.run(`nn.pause(${secs * 1000 + 1500}); return true;`);
  const a = usage(app.pid);
  await sleep(secs * 1000);
  const b = usage(app.pid);
  await sleep(2000);
  // App Nap check: a napped app answers its first command late and stretches a 100 ms timer (the bench passes
  // -NSAppSleepDisabled; NNCore keeps Cocoa's argument-domain switches off Chrome's command line, AppKit reads them).
  const asked = Date.now();
  const late = await app.run(`return new Promise((r) => { const t = Date.now(); setTimeout(() => r(Date.now() - t - 100), 100); });`);
  return { ...usageDelta(a, b), afterIdle: { commandMs: Date.now() - asked, timerLateMs: late } };
}

// Whether the page on screen can paint right now: frames in 250 ms of requestAnimationFrame. A window macOS stops
// giving display-link frames (the display asleep, or a covered window on some systems) paints about once a second
// whatever the app does, so a sample taken then measures that, not the app: it's counted and left out of the medians.
async function throttled(app) {
  for (const t of await app.cdp.targets()) {
    const r = await app.cdp.send(t, "Runtime.evaluate", {
      expression: `document.visibilityState !== "visible" ? -1 : new Promise((done) => { let n = 0; const t0 = performance.now();
        (function f() { n++; if (performance.now() - t0 < 250) requestAnimationFrame(f); else done(n); })(); })`,
      awaitPromise: true, returnByValue: true,
    }, 3000).catch(() => null);
    const frames = r?.result?.value;
    if (typeof frames === "number" && frames >= 0) return frames < 5;
  }
  return null;
}

async function openTabs(app, from, to, kind = "static") {
  for (let i = from; i < to; i++) {
    await app.run(`nn.store.getState().newTab(${WINDOW}, { url: "${base()}/${kind}?id=t${i}" }); return true;`);
    await app.pageState(`id=t${i}`, 30_000, (s) => s.fcp);
  }
}

async function tabIds(app) {
  return app.run(`const s = nn.store.getState(); return s.windows[${WINDOW}].tabIds.map((id) => [id, s.tabs[id].url]);`);
}

// A new window: command → on screen (CGWindowList: alpha > 0), → on screen with its content (on screen, and the
// transaction carrying its React content committed: 0.2.21 showed a window empty and its content after, 0.2.22 keeps it
// transparent until then), and → its page's first paint.
async function newWindow(app, id) {
  const watcher = spawn(join(toolDir, "nnperf"), ["newwindow", String(app.pid), "20"], { stdio: ["ignore", "pipe", "ignore"] });
  let said = "";
  watcher.stdout.on("data", (d) => (said += d));
  const exited = new Promise((done) => watcher.on("exit", done));
  for (const end = Date.now() + 10_000; !said.includes("ready") && Date.now() < end; ) await Promise.race([exited, sleep(5)]);
  const at = await app.run(`const t = nn.now(); nn.actions.openWindow({ url: "${base()}/static?id=${id}" }); return t;`);
  await exited;
  const shown = JSON.parse(said.split("\n").find((l) => l.startsWith("{")) ?? "null");
  const s = await app.pageState(`id=${id}`, 20_000, (st) => st.fcp);
  const marks = app.marks();
  const content = marks.find((m) => m.content >= at && (!shown || m.window === shown.id));
  const committed = content && marks.find((m) => m.committed >= content.content && m.window === content.window);
  await app.run(`const s = nn.store.getState(); const t = Object.values(s.tabs).find((t) => t.url.includes("id=${id}"));
    if (t) nn.store.getState().closeWindow(t.windowId); return true;`);
  await sleep(1500);
  return {
    window: shown ? shown.at - at : NaN,
    withContent: shown && committed ? Math.max(shown.at, committed.committed) - at : NaN,
    firstPaint: s ? s.fcp - at : NaN,
    firstFrame: s?.frame ? s.frame - at : NaN,
  };
}

async function windowsRun(template, i) {
  const app = new Instance(freshDir(template, `windows-${i}`), +opt.port, `${base()}/appcast.xml`);
  const r = { newWindow: [] };
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(10_000);
    for (let k = 0; k < 8; k++) r.newWindow.push(await newWindow(app, `w${k}`));
    log(`windows ${i}:`, JSON.stringify(r.newWindow));
    results.windows.push(r);
  } finally {
    await app.quit();
  }
}

async function sessionRun(template, i) {
  const secs = +opt.idle;
  const app = new Instance(freshDir(template, `session-${i}`), +opt.port, `${base()}/appcast.xml`);
  const r = { memory: {}, idle: {}, tabSwitch: [], newTab: [], newTabFrame: [], newWindow: [], processes: {}, throttled: { tabSwitch: 0, newTab: 0 } };
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(30_000);
    r.idle.tabs1 = await idleWindow(app, secs);
    r.memory.tabs1 = footprint(usage(app.pid));
    await openTabs(app, 1, 10);
    await sleep(10_000);
    r.memory.tabs10 = footprint(usage(app.pid));
    await openTabs(app, 10, 20);
    await sleep(15_000);
    r.memory.tabs20 = footprint(usage(app.pid));
    r.idle.tabs20 = await idleWindow(app, secs);

    // Tab switches: command → the page's visibilitychange + two frames.
    const tabs = (await tabIds(app)).filter(([, url]) => url.includes("/static?id=t"));
    for (let k = 0; k < 16; k++) {
      const [id, url] = tabs[(k * 7 + 3) % tabs.length];
      const marker = url.match(/id=(t\d+)/)[1];
      const target = await app.cdp.find(`id=${marker}`);
      const before = (await app.cdp.state(target))?.shown.length ?? 0;
      const hidden = await throttled(app);
      const at = await app.run(`const t = nn.now(); nn.actions.switchToTab(${JSON.stringify(id)}); return t;`);
      const s = await app.pageState(`id=${marker}`, 5000, (st) => st.shown.length > before);
      const shown = s?.shown.at(-1);
      if (hidden) r.throttled.tabSwitch++;
      r.tabSwitch.push(shown && !hidden ? shown[1] - at : NaN);
      if (process.env.BENCH_DEBUG) log("switch", marker, "before", before, "at", at - Date.now(), "state", JSON.stringify((await app.cdp.state(target)) ?? null)?.slice(0, 300));
      await sleep(400);
    }

    // New tabs with a page: command → first contentful paint.
    for (let k = 0; k < 5; k++) {
      const hidden = await throttled(app);
      const at = await app.run(`const t = nn.now(); nn.store.getState().newTab(${WINDOW}, { url: "${base()}/static?id=n${k}" }); return t;`);
      const s = await app.pageState(`id=n${k}`, 20_000, (st) => st.fcp);
      if (hidden) r.throttled.newTab++;
      r.newTab.push(s && !hidden ? s.fcp - at : NaN);
      r.newTabFrame.push(s?.frame && !hidden ? s.frame - at : NaN);
      await sleep(800);
    }
    await app.run(`const s = nn.store.getState(); for (const id of Object.keys(s.tabs)) if (s.tabs[id].url.includes("id=n")) nn.store.getState().closeTab(id); return true;`);

    for (let k = 0; k < 3; k++) r.newWindow.push(await newWindow(app, `w${k}`));

    // Close all but the first tab; memory once the renderers are gone.
    r.processes.tabs20 = usage(app.pid).length;
    await app.run(`const s = nn.store.getState(); const w = ${WINDOW}; const keep = s.windows[w].tabIds.find((id) => s.tabs[id].url.includes("id=seed"));
      nn.store.getState().activate(keep); for (const id of s.windows[w].tabIds) if (id !== keep) nn.store.getState().closeTab(id); return true;`);
    await sleep(30_000);
    r.memory.closed = footprint(usage(app.pid));
    r.processes.closed = r.memory.closed.processes;
  } finally {
    await app.quit();
  }
  log(`session ${i}:`, JSON.stringify({ idle: r.idle, mem: Object.fromEntries(Object.entries(r.memory).map(([k, v]) => [k, Math.round(v.totalMB)])), sw: r.tabSwitch, nt: r.newTab, nw: r.newWindow }));
  results.session.push(r);
}

// Hidden tabs: rAF and timer rates of animating pages that aren't shown.
async function throttleRun(template) {
  const app = new Instance(freshDir(template, "throttle"), +opt.port, `${base()}/appcast.xml`);
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await openTabs(app, 0, 4, "anim");
    await app.run(`const s = nn.store.getState(); const w = ${WINDOW}; nn.store.getState().activate(s.windows[w].tabIds.find((id) => s.tabs[id].url.includes("id=seed"))); return true;`);
    await sleep(12_000);
    const read = async () => {
      const out = {};
      for (const t of await app.cdp.targets()) if (t.url.includes("/anim?") || t.url.includes("id=seed")) out[t.url.match(/id=(\w+)/)[1]] = await app.cdp.state(t);
      return out;
    };
    const a = await read();
    const t0 = Date.now();
    await sleep(10_000);
    const b = await read();
    const secs = (Date.now() - t0) / 1000;
    const tabs = {};
    for (const [id, s] of Object.entries(b)) {
      const p = a[id];
      if (!s || !p) continue;
      tabs[id] = { visibility: s.visibility, rafPerSec: (s.raf - p.raf) / secs, fastTimerPerSec: (s.fast - p.fast) / secs, secondTimerPerSec: (s.ticks - p.ticks) / secs };
    }
    const idle = await idleWindow(app, 20);
    results.throttle.push({ tabs, idle });
    log("throttle:", JSON.stringify(tabs), JSON.stringify(idle.total));
  } finally {
    await app.quit();
  }
}

// Leak check: open and close 10 tabs five times; the browser process's footprint after each round.
async function churnRun(template) {
  const app = new Instance(freshDir(template, "churn"), +opt.port, `${base()}/appcast.xml`);
  const rounds = [];
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(10_000);
    const measure = () => {
      const f = footprint(usage(app.pid));
      return { browserMB: f.kinds.browser, totalMB: f.totalMB, processes: f.processes };
    };
    rounds.push(measure());
    for (let round = 0; round < 5; round++) {
      await openTabs(app, round * 10, round * 10 + 10);
      await app.run(`const s = nn.store.getState(); const w = ${WINDOW}; const keep = s.windows[w].tabIds.find((id) => s.tabs[id].url.includes("id=seed"));
        nn.store.getState().activate(keep); for (const id of s.windows[w].tabIds) if (id !== keep) nn.store.getState().closeTab(id); return true;`);
      await sleep(15_000);
      rounds.push(measure());
    }
    results.churn = rounds;
    log("churn:", JSON.stringify(rounds.map((r) => Math.round(r.browserMB))));
  } finally {
    await app.quit();
  }
}

// Main-thread samples: idle with 20 tabs, then while switching tabs and scrolling.
async function sampleRun(template) {
  const app = new Instance(freshDir(template, "sample"), +opt.port, `${base()}/appcast.xml`);
  const dir = join(opt.out, label, "samples");
  mkdirSync(dir, { recursive: true });
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await openTabs(app, 1, 20);
    await sleep(15_000);
    await app.run(`nn.pause(40000); return true;`);
    execFileSync("sample", [String(app.pid), "10", "-mayDie", "-file", join(dir, "idle.txt")], { stdio: "ignore" });
    const tabs = await tabIds(app);
    const sampler = spawn("sample", [String(app.pid), "12", "-mayDie", "-file", join(dir, "switch-scroll.txt")], { stdio: "ignore" });
    const end = Date.now() + 11_000;
    for (let k = 0; Date.now() < end; k++) {
      const [id, url] = tabs[(k * 7 + 3) % tabs.length];
      await app.run(`nn.actions.switchToTab(${JSON.stringify(id)}); return true;`);
      const target = await app.cdp.find(url.match(/id=\w+/)[0]);
      if (target) for (let n = 0; n < 6; n++) await app.cdp.send(target, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: 120 });
      await sleep(150);
    }
    await new Promise((ok) => sampler.on("exit", ok));
    results.sample.push({ idle: summarizeSample(join(dir, "idle.txt")), active: summarizeSample(join(dir, "switch-scroll.txt")) });
    log("samples in", dir);
  } finally {
    await app.quit();
  }
}

// The main thread's samples and where its busy ones go (frames named in `sample`'s call graph).
function summarizeSample(file) {
  const text = readFileSync(file, "utf8");
  const thread = text.split(/\n(?=    \d+ Thread_)/).find((t) => /com\.apple\.main-thread|DispatchQueue_1:/.test(t.split("\n")[0])) ?? "";
  const total = +(thread.match(/^\s+(\d+) Thread_/)?.[1] ?? 0);
  const idleWait = [...thread.matchAll(/^\s*[+!:| ]*(\d+) mach_msg2_trap/gm)].reduce((n, m) => n + +m[1], 0);
  const count = (re) => [...thread.matchAll(new RegExp(`^\\s*[+!:| ]*(\\d+) [^\\n]*${re}`, "gm"))].reduce((n, m) => Math.max(n, +m[1]), 0);
  return {
    samples: total,
    waiting: idleWait,
    busy: total - idleWait,
    // Chromium's own work on the main thread: CEF's pump (0.2.21 and older) or NNCore's run loop source.
    engineWork: count("CefDoMessageLoopWork|MessagePumpCFRunLoopBase::RunWorkSource"),
    metalDraw: count("MTKView draw|\\bdraw\\(in:"),
    caCommit: count("CA::Transaction::commit"),
    rnLayout: count("RCTUIManager|YGNodeCalculateLayout"),
    hermes: count("hermes::vm::"),
  };
}

// MARK: Report

function summary(res) {
  const rows = [];
  const add = (name, xs, unit, digits = 0) => {
    const v = xs.filter(Number.isFinite);
    rows.push({ name, median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length, unit, digits });
  };
  add("launch → window shown", res.launch.map((r) => r.window), "ms");
  add("launch → window shown with its content", res.launch.map((r) => r.withContent), "ms");
  add("launch → JS running", res.launch.map((r) => r.js), "ms");
  add("launch → first page painted", res.launch.map((r) => r.firstPaint), "ms");
  add("launch → first page's first frame", res.launch.map((r) => r.firstFrame), "ms");
  const S = res.session;
  for (const t of ["tabs1", "tabs20"]) {
    add(`idle CPU, ${t.slice(4)} tab(s) (all processes)`, S.map((r) => r.idle[t]?.total.cpu), "%", 2);
    add(`idle wakeups/s, ${t.slice(4)} tab(s) (all processes)`, S.map((r) => r.idle[t]?.total.wakeups), "/s", 1);
    add(`idle CPU, ${t.slice(4)} tab(s) (browser process)`, S.map((r) => r.idle[t]?.kinds.browser?.cpu), "%", 2);
    add(`idle wakeups/s, ${t.slice(4)} tab(s) (browser process)`, S.map((r) => r.idle[t]?.kinds.browser?.wakeups), "/s", 1);
    add(`idle wakeups/s, ${t.slice(4)} tab(s) (GPU process)`, S.map((r) => r.idle[t]?.kinds["gpu-process"]?.wakeups), "/s", 1);
    add(`idle wakeups/s, ${t.slice(4)} tab(s) (renderers)`, S.map((r) => r.idle[t]?.kinds.renderer?.wakeups), "/s", 1);
  }
  for (const m of ["tabs1", "tabs10", "tabs20", "closed"]) add(`memory (phys_footprint), ${m === "closed" ? "after closing back to 1 tab" : m.slice(4) + " tab(s)"}`, S.map((r) => r.memory[m]?.totalMB), "MB");
  add("memory, browser process, 20 tabs", S.map((r) => r.memory.tabs20?.kinds.browser), "MB");
  add("memory, browser process, after closing", S.map((r) => r.memory.closed?.kinds.browser), "MB");
  add("after an idle minute: command answered (App Nap check)", S.map((r) => r.idle.tabs1?.afterIdle?.commandMs), "ms");
  add("samples left out: page couldn't paint (switch + new tab, per run)", S.map((r) => r.throttled ? r.throttled.tabSwitch + r.throttled.newTab : NaN), "");
  add("tab switch → shown (median of 16 per run)", S.map((r) => median(r.tabSwitch)), "ms");
  add("new tab → first paint (median of 5 per run)", S.map((r) => median(r.newTab)), "ms");
  add("new tab → its page's first frame (median of 5 per run)", S.map((r) => median(r.newTabFrame ?? [])), "ms");
  // The window phase's runs too (8 windows each).
  const W = [...S, ...(res.windows ?? [])];
  add("new window → on screen (median per run)", W.map((r) => median(r.newWindow.map((w) => w.window))), "ms");
  add("new window → on screen with its content (median per run)", W.map((r) => median(r.newWindow.map((w) => w.withContent))), "ms");
  add("new window → first paint (median per run)", W.map((r) => median(r.newWindow.map((w) => w.firstPaint))), "ms");
  add("new window → its page's first frame (median per run)", W.map((r) => median(r.newWindow.map((w) => w.firstFrame))), "ms");
  return rows;
}

function printTable(rows, other) {
  const fmt = (r) => (Number.isFinite(r?.median) ? `${r.median.toFixed(r.digits)} ${r.unit} (${r.min.toFixed(r.digits)}–${r.max.toFixed(r.digits)}, n=${r.n})` : "—");
  const lines = other
    ? ["| Metric | Before | After |", "|---|---|---|", ...rows.map((r) => `| ${r.name} | ${fmt(other.find((o) => o.name === r.name))} | ${fmt(r)} |`)]
    : ["| Metric | Median (min–max, runs) |", "|---|---|", ...rows.map((r) => `| ${r.name} | ${fmt(r)} |`)];
  console.log(lines.join("\n"));
}

// MARK: Main

if (opt.report) {
  const other = opt.compare ? summary(JSON.parse(readFileSync(opt.compare, "utf8"))) : null;
  printTable(summary(JSON.parse(readFileSync(opt.report, "utf8"))), other);
  process.exit(0);
}
if (!opt.app) {
  console.error("usage: native-bench.mjs --app <Netnyahoo.app> [--out dir] [--label name] [--bundle main.jsbundle] ...");
  process.exit(64);
}
const label = opt.label ?? basename(dirname(dirname(resolve(opt.app))));
const outDir = join(opt.out, label);
mkdirSync(outDir, { recursive: true });
const cleanup = async () => {
  server?.close();
};
process.on("SIGINT", async () => {
  await cleanup();
  process.exit(130);
});

try {
  server = await startServer();
  const bundle = opt.bundle ? resolve(opt.bundle) : buildBundle(join(outDir, "bundle"));
  benchApp = prepareApp(resolve(opt.app), join(outDir, "app"), bundle);
  results.meta = { app: resolve(opt.app), bundle, label, date: new Date().toISOString(), runs: +opt.runs, idleSecs: +opt.idle };
  const template = join(outDir, "template");
  await makeTemplate(template);
  const only = new Set(opt.only.split(","));
  if (only.has("launch")) await launchRuns(template);
  if (only.has("session")) for (let i = 0; i < +opt.runs; i++) await sessionRun(template, i);
  if (only.has("windows")) for (let i = 0; i < +opt.runs; i++) await windowsRun(template, i);
  if (only.has("throttle")) await throttleRun(template);
  if (only.has("churn")) await churnRun(template);
  if (only.has("sample")) await sampleRun(template);
  writeFileSync(join(outDir, "results.json"), JSON.stringify(results, null, 1));
  const rows = summary(results);
  const other = opt.compare ? summary(JSON.parse(readFileSync(opt.compare, "utf8"))) : null;
  printTable(rows, other);
  if (results.throttle.length) console.log("\nHidden tabs:", JSON.stringify(results.throttle[0].tabs));
  if (results.churn) console.log("\nBrowser process after each open/close-10-tabs round (MB):", results.churn.map((r) => Math.round(r.browserMB)).join(" → "));
  if (results.sample.length) console.log("Main thread samples:", JSON.stringify(results.sample[0]));
} finally {
  await cleanup();
}

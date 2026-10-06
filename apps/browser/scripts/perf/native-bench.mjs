#!/usr/bin/env node
// Native performance benchmark: launch, idle cost, memory, tab/window latency and background throttling of a
// Release build, driven in hidden instances (NETNYAHOO_BACKGROUND=1, a throwaway NETNYAHOO_DATA_DIR each run).
//
// Gate recipe, what each row means and which rows don't compare across engines: docs/perf/README.md.
//
//   node apps/browser/scripts/perf/native-bench.mjs --app <Netnyahoo.app> --out <dir> [options]
//     --label <name>          name of this set of results (default: the folder two levels above the app, so
//                             dist/0.2.22/export/Netnyahoo.app is "0.2.22")
//     --bundle <file>         Hermes bundle of scripts/perf/bench-entry.js to run (built from the working tree when
//                             omitted). Pass the same file to a before and an after run so only native code differs.
//                             It must match the app's NATIVE_API_VERSION, or every command fails with the skew.
//     --control <app>         a baseline app, run in the same process interleaved run by run with --app (control first
//                             on even runs, candidate first on odd ones), so both see the same machine. Prints control →
//                             candidate; each side's results land in <out>/<its label>/results.json.
//     --control-bundle <file> the control's bundle (default: --app's bundle); --control-label <name> (default as --label)
//     --prepared              --app (and --control) are copies this script already prepared (<out>/<label>/app/
//                             Netnyahoo.app: bundle swapped in, signed for the marker): run them in place, without
//                             building a bundle, copying or signing. `--only prepare` makes those copies and exits.
//     --runs <n>              session and windows runs (default 3); --launch-runs <n> cold launches (default 5)
//     --idle <secs>           each idle window (default 60)
//     --only <a,b>            phases (default launch,session,throttle,sample):
//                               launch     cold launches
//                               session    one instance per run with all of: idle, memory, switch, newtab, newwindow
//                               idle, memory, switch, newtab, newwindow
//                                          only those parts of a session run (still with the 20 tabs they're measured
//                                          with; the settling waits only the chosen parts need). Compare runs made
//                                          with the same --only.
//                               newtabkey  J2: a real ⌘T key event into the app → its command bar committed, on screen and
//                                          typeable; a keystroke → its suggestions on screen (one instance per run)
//                               navigate   J4: a real Enter in the command bar with a local test page's URL → the engine
//                                          asked to load, navigation started, committed, first contentful paint; from a new
//                                          tab's bar (⌘T) and from a page's panel (⌘L). Same instance as newtabkey.
//                               windows    8 new windows per run, alone
//                               throttle   hidden animating tabs' rAF and timer rates
//                               churn      leak check: open and close 10 tabs 5 times
//                               sample     main-thread `sample`s, idle and while switching and scrolling
//                               prepare    prepare the app copies and exit (see --prepared)
//     --env K=V               repeatable: extra environment for every instance (DYLD_INSERT_LIBRARIES is appended to
//                             the marker library). Instances stay muted; don't pass NETNYAHOO_ALLOW_AUDIO.
//     --journey-n <n>         iterations of each journey per run in newtabkey and navigate (default 10)
//     --page-port <n>         the test pages' server port (default: any free port)
//     --seed big              launch, newtabkey and navigate phases: start every launch from seed.mjs's big saved session (200 tabs in two
//                             profiles, 5000 history entries, 1000 bookmarks) instead of one tab, to time what a
//                             long-time user's launch does. Its active tab is the bench's id=seed page, so the launch
//                             rows mean the same; the other 199 tabs point at the bench server's /static?id=p-…
//     --fresh-copy            launch phase only: every launch runs from its own APFS clone of the app (same signature,
//                             a new path and inodes), removed after, as the first launch after an install or update
//                             is. Without it only the first launch of a prepared copy is cold; the rest are warm.
//     --hold <secs>           keep each measured instance alive that long before it quits, its pid and data dir logged
//                             (lldb -p <pid>, heap <pid>, vmmap --summary <pid>). Ctrl-C quits it and stops.
//     --port <n>              the instances' CDP port (default 9377). One instance runs at a time.
//     --compare <a.json>      print a before/after table against another run's results.json
//     --report <b.json>       print the table for saved results (with --compare, before/after) without running
//     Environment: BENCH_ALLOW_APP_NAP=1 leaves App Nap on (the control for the App Nap row); BENCH_DEBUG=1 logs switches.
//
// Results: <out>/<label>/results.json (every sample) and a summary table (median, min–max over runs) on stdout.
// Needs: Node 22+, swiftc (builds scripts/perf/nnperf.swift), clang (builds scripts/perf/nnmark.m, loaded into the copy
// of the app to mark when a window's content appears), the app signed with an identity in the keychain.
//
// Sections (MARK:)
//   Probes          nnperf() runs nnperf.swift (rusage, waitwindow, newwindow, quit); markerLibrary() builds nnmark.m;
//                   usage(), usageDelta(), footprint(): CPU, wakeups and phys_footprint per process kind
//   Test pages      PAGE_SCRIPT (window.__nn: fcp, frame, visibility, shown), staticPage, animPage, the local server
//   CDP             Cdp: page targets and their window.__nn
//   App instances   prepareApp (copy, bundle, marker entitlements, re-sign), buildBundle, Instance (hidden `open -g -n`
//                   launch, the bench-cmd.js → bench-result.json channel of bench-channel.js, marks(), quit)
//   Phases          makeTemplate (the seeded data folder each run copies), launchRun, sessionRun, windowsRun, newWindow,
//                   idleWindow, throttled, throttleRun, churnRun, sampleRun
//   Report          summary() builds every row below; printTable
//   Main            options, the candidate and control sides, interleaved()
//
// Rows: the function that measures each, and what it waits on. Launch rows count from just before `open`; command rows
// from Date.now() in the app's JS as the command starts (nn.now()).
//   launch → window shown                   launchRun   nnperf waitwindow: the pid's first on-screen window ≥ 300×200
//                                                        with alpha > 0 (CEF builds show it empty, NNCore with content)
//   launch → window shown with its content  launchRun   the later of that and nnmark's commit of the Core Animation
//                                                        transaction carrying the first React root's content
//   launch → JS running                     launchRun   bench-boot.json, written as bench-channel.js loads (after the
//                                                        app's index.js and its imports)
//   launch → first page painted             launchRun   the seed tab's first-contentful-paint (PerformanceObserver)
//   launch → first page's first frame       launchRun   the seed tab's first requestAnimationFrame callback
//   idle CPU / idle wakeups/s (…)           sessionRun  idle: idleWindow(), nnperf rusage over the process tree --idle
//                                                        secs apart with the channel paused, at 1 tab and at 20
//   memory (phys_footprint), …              sessionRun  memory: footprint() of the tree at 1 tab (30 s after launch,
//                                                        after the idle window), 10 tabs (+10 s), 20 tabs (+15 s), and
//                                                        closed back to 1 (+30 s); "browser process" rows: that process
//   after an idle minute: command answered  sessionRun  idle: the first command after the 1-tab idle (App Nap check)
//   idle windows: someone used the Mac      sessionRun  idle: nnperf input over each idle window: seconds of mouse,
//                                                        trackpad or keyboard input (HIDIdleTime), and of the pointer
//                                                        moving over the instance's window. Nonzero means the idle rows
//                                                        of that run measured the owner's input too
//   samples left out: page couldn't paint   sessionRun  switch/newtab: throttled(), < 5 rAF frames in 250 ms just before
//   tab switch → shown                      sessionRun  switch: nn.actions.switchToTab → the page's visibilitychange to
//                                                        visible + 2 rAFs (16 per run, among 20 tabs)
//   new tab → first paint / first frame     sessionRun  newtab: store newTab → the new page's FCP / first rAF (5 per run)
//   new window → on screen                  newWindow   nn.actions.openWindow → nnperf newwindow (2 ms polls; ≥ 300×200,
//                                                        alpha > 0). 3 per session run (newwindow), 8 per windows run
//   new window → on screen with its content newWindow   the later of that and nnmark's commit for that window
//   new window → first paint / first frame  newWindow   the window's page's FCP / first rAF
//   ⌘T → …, keystroke → suggestions         journeyRun  newtabkey: nnperf postkeys (CGEventPostToPid into this pid) → the app's field timing
//                                                        (journeys.ts + NNCoreFieldTiming.mm; sharing on in the bench's data folder,
//                                                        every non-local fetch answered by bench-offline.js so nothing is uploaded)
//   Enter → engine asked / started / committed / first contentful paint
//                                           journeyRun  navigate: the same, from a real Enter; also the page's own FCP over CDP
// Also printed: "Hidden tabs" (throttleRun), the browser process after each churn round, main-thread sample summaries.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { loadavg, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildSeed } from "./seed.mjs";

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
    control: { type: "string" },
    "control-bundle": { type: "string" },
    "control-label": { type: "string" },
    prepared: { type: "boolean" },
    env: { type: "string", multiple: true, default: [] },
    seed: { type: "string" },
    "fresh-copy": { type: "boolean" },
    "page-port": { type: "string", default: "0" },
    "journey-n": { type: "string", default: "10" },
    hold: { type: "string", default: "0" },
    help: { type: "boolean", short: "h" },
  },
});
if (opt.help) {
  // The header above is the usage.
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}

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
    server.listen(+opt["page-port"], "127.0.0.1", () => resolveServer(server));
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
  // No secure timestamp: both apps' copies are signed the same way, and Apple's timestamp server sometimes doesn't
  // answer ("A timestamp was expected but was not found"), which used to abort the whole run.
  execFileSync("codesign", ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime", "--entitlements", entitlements, copy], { stdio: "inherit" });
  writeFileSync(join(out, "prepared.json"), JSON.stringify({ app, bundle, date: new Date().toISOString() }));
  return copy;
}

// --prepared: a copy prepareApp made (the marker's entitlements say so), run in place.
function checkPrepared(copy) {
  if (copy.startsWith("/Applications/")) throw new Error(`--prepared runs the app in place; ${copy} is the owner's`);
  const granted = spawnSync("codesign", ["-d", "--entitlements", "-", "--xml", copy], { encoding: "utf8" }).stdout ?? "";
  if (!granted.includes("<key>com.apple.security.cs.allow-dyld-environment-variables</key>"))
    throw new Error(`${copy} isn't a copy native-bench prepared (run once without --prepared, or with --only prepare)`);
  try {
    return JSON.parse(readFileSync(join(dirname(copy), "prepared.json"), "utf8"));
  } catch {
    return { app: copy, bundle: join(copy, "Contents/Resources/main.jsbundle") };
  }
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

// Instances still running, for Ctrl-C.
const live = new Set();

class Instance {
  // side: the app being measured (Main); dataDir: this instance's NETNYAHOO_DATA_DIR.
  constructor(side, dataDir) {
    this.side = side;
    this.app = side.app;
    this.dataDir = dataDir;
    this.port = +opt.port;
    this.feed = `${base()}/appcast.xml`;
    this.cdp = new Cdp(this.port);
    this.seq = 0;
    // Extra K=V environment for this instance alone (journeyRun: NN_BENCH_KEYLOG).
    this.env = [];
  }
  async launch() {
    const exe = join(this.app, "Contents/MacOS", execFileSync("defaults", ["read", join(this.app, "Contents/Info.plist"), "CFBundleExecutable"], { encoding: "utf8" }).trim());
    const main = `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;
    if (spawnSync("pgrep", ["-f", main]).status === 0) throw new Error("a bench instance is still running");
    // --env K=V; an extra DYLD_INSERT_LIBRARIES loads after the marker.
    const extra = [...opt.env, ...this.env].filter((e) => !e.startsWith("DYLD_INSERT_LIBRARIES="));
    const dyld = [markerLibrary(), ...opt.env.filter((e) => e.startsWith("DYLD_INSERT_LIBRARIES=")).map((e) => e.slice(22))].join(":");
    this.t0 = Date.now();
    execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${this.dataDir}`,
      "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${this.port}`, "--env", `NETNYAHOO_UPDATE_FEED_URL=${this.feed}`,
      "--env", `DYLD_INSERT_LIBRARIES=${dyld}`, ...extra.flatMap((e) => ["--env", e]), this.app,
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
    live.add(this);
    const w = nnperf("waitwindow", String(this.pid), "60");
    this.windowAt = w.code === 0 ? +w.out : NaN;
    const boot = await this.waitFile("bench-boot.json", 60_000);
    this.jsStart = boot?.jsStart ?? NaN;
    return this;
  }
  // The content marker's marks (nnmark.m): {content|committed: epoch ms, window}.
  marks() {
    try {
      return readFileSync(join(this.dataDir, "bench-marks.jsonl"), "utf8").split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return []; // a line still being written
        }
      });
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
  // A measured instance's end: --hold keeps it alive first.
  async done() {
    const secs = +opt.hold;
    if (secs > 0 && this.pid && this.alive()) {
      log(`holding ${this.side.label} pid ${this.pid} for ${secs} s (data ${this.dataDir}): lldb -p ${this.pid}, heap ${this.pid}, vmmap --summary ${this.pid}`);
      for (const end = Date.now() + secs * 1000; Date.now() < end && this.alive(); ) await sleep(200);
    }
    await this.quit();
  }
  async quit() {
    this.cdp.close();
    live.delete(this);
    if (!this.pid || !this.alive()) return;
    nnperf("quit", String(this.pid));
    for (let i = 0; i < 100 && this.alive(); i++) await sleep(100);
    if (this.alive()) process.kill(this.pid, "SIGKILL");
    const helpers = () => spawnSync("pgrep", ["-f", this.app], { encoding: "utf8" }).stdout.trim();
    for (let i = 0; i < 100 && helpers(); i++) await sleep(100);
    for (const p of helpers().split("\n").filter(Boolean)) process.kill(+p, "SIGKILL");
  }
}

// MARK: Phases

const base = () => `http://127.0.0.1:${server.address().port}`;
let server;

const WINDOW = `(() => { const s = nn.store.getState(); return s.ui.focusedWindowId && s.windows[s.ui.focusedWindowId] ? s.ui.focusedWindowId : s.windowOrder.find((id) => s.windows[id] && !s.windows[id].kind); })()`;

// --seed big: the template is seed.mjs's profile, written without launching anything. No perf-probe file (that
// turns the JS probe on, which native-bench's launches don't run with). The seed's tabs point at /static?id=p-<tab>
// on the bench server, and its active tab of the default profile at the page launchRun waits for.
function writeBigSeed(side) {
  const dir = side.template;
  const version = execFileSync("defaults", ["read", join(side.src, "Contents/Info.plist"), "CFBundleShortVersionString"], { encoding: "utf8" }).trim();
  const files = buildSeed(base(), version);
  delete files["perf-probe"];
  const session = files["session.json"];
  const win = session.windows[0];
  for (const t of session.tabs) {
    const id = t.id === win.activeTabIds.default ? "seed" : `p-${t.id}`;
    t.url = `${base()}/static?id=${id}`;
    if (t.pinnedUrl) t.pinnedUrl = t.url;
  }
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(value));
  log(`seeded the big session (${side.label}): ${session.tabs.length} tabs, ${files["history.json"].history.default.length} history entries`);
}

async function makeTemplate(side) {
  const dir = side.template;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  if (opt.seed) return writeBigSeed(side);
  log(`seeding a session (${side.label})`);
  // Past onboarding: its intro music would play on the owner's Mac from builds without b7899c26 (0.2.21).
  writeFileSync(join(dir, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  const app = await new Instance(side, dir).launch();
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

function freshDir(side, name) {
  const dir = join(side.dir, "data", name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("cp", ["-Rc", side.template, dir]);
  return dir;
}

async function launchRun(side, i) {
  const copy = opt["fresh-copy"] ? join(side.dir, "fresh", `app-${i}`) : null;
  if (copy) {
    rmSync(copy, { recursive: true, force: true });
    mkdirSync(copy, { recursive: true });
    execFileSync("cp", ["-Rc", side.app, join(copy, "Netnyahoo.app")]);
  }
  const app = new Instance(copy ? { ...side, app: join(copy, "Netnyahoo.app") } : side, freshDir(side, `launch-${i}`));
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
      // The machine's 1-minute load average as the launch ends: what else was running (other builds, other agents).
      load: Math.round(loadavg()[0] * 10) / 10,
    };
    if (opt.seed) r.pageTargets = (await app.cdp.targets()).length;
    log(`${side.tag}launch ${i}:`, JSON.stringify(r));
    side.results.launch.push(r);
  } finally {
    await app.done();
    if (copy) rmSync(copy, { recursive: true, force: true });
  }
  await sleep(3000);
}

async function idleWindow(app, secs) {
  await app.run(`nn.pause(${secs * 1000 + 1500}); return true;`);
  // Someone using the Mac meanwhile (the window is on screen, usually in front): its pointer over the window wakes the app.
  const probe = spawn(join(toolDir, "nnperf"), ["input", String(app.pid), String(secs)], { stdio: ["ignore", "pipe", "ignore"] });
  let said = "";
  probe.stdout.on("data", (d) => (said += d));
  const probed = new Promise((done) => (probe.on("close", done), probe.on("error", done)));
  const a = usage(app.pid);
  await sleep(secs * 1000);
  const b = usage(app.pid);
  if ((await Promise.race([probed.then(() => true), sleep(2000)])) !== true) probe.kill();
  let input = null;
  try {
    input = JSON.parse(said.trim());
  } catch {}
  if (!Number.isFinite(input?.inputSecs)) input = null;
  await sleep(2000);
  // App Nap check: a napped app answers its first command late and stretches a 100 ms timer (the bench passes
  // -NSAppSleepDisabled; NNCore keeps Cocoa's argument-domain switches off Chrome's command line, AppKit reads them).
  const asked = Date.now();
  const late = await app.run(`return new Promise((r) => { const t = Date.now(); setTimeout(() => r(Date.now() - t - 100), 100); });`);
  return { ...usageDelta(a, b), input, afterIdle: { commandMs: Date.now() - asked, timerLateMs: late } };
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

async function windowsRun(side, i) {
  const app = new Instance(side, freshDir(side, `windows-${i}`));
  const r = { newWindow: [] };
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(10_000);
    for (let k = 0; k < 8; k++) r.newWindow.push(await newWindow(app, `w${k}`));
    log(`${side.tag}windows ${i}:`, JSON.stringify(r.newWindow));
    side.results.windows.push(r);
  } finally {
    await app.done();
  }
}

// MARK: Journeys: real key events in, the app's field timing out

// The app times a journey only while the user shares diagnostics (telemetry/journeys.ts), so these runs turn sharing
// on in their data folder, with a `bench-offline` file that makes bench-offline.js answer every non-local fetch itself:
// the Release bundle would otherwise send the events to our collector. Input is real: nnperf postkeys posts key events
// to this one pid (CGEventPostToPid), which reach the app as a keyboard's do (NSApp.sendEvent, the menu bar's ⌘T, the
// focused field). Every row starts at the key down's own timestamp (epoch ms, the clock the app's marks use): the instant the app's field timing starts a journey from.
const TELEMETRY_ON = { version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "00000000-0000-4000-8000-0000000000b0", lastVersion: null, sessionOpen: false };

// After a lost iteration: the bar's panel closed and any empty new tab closed, so the next one starts from the same place.
async function recover(app) {
  await app.run(`const s = nn.store.getState(); const w = ${WINDOW};
    if (s.windowUi[w]?.panel.open) s.closePanel(w);
    for (const id of s.windows[w].tabIds) if (!s.tabs[id].url && s.windows[w].tabIds.length > 1) nn.store.getState().closeTab(id);
    return true;`);
  await sleep(1500);
}

function postKeys(app, gap, ...specs) {
  const r = nnperf("postkeys", String(app.pid), String(gap), ...specs);
  if (r.code !== 0) throw new Error(`nnperf postkeys ${specs.join(" ")} failed (${r.code}): ${r.out}`);
  return r.out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// CGEventPostToPid sometimes drops an event (about one in ten here); the app's key log (nnmark.m) says whether this one
// arrived, and a key it never saw is made again. Returns the press that arrived: `at` is the event's own timestamp (when
// the system made the key, the instant the app's field timing starts every journey from), `posted` the moment nnperf
// handed it over, which the event system stamps a few ms to a few tens of ms later (the row "poster → timestamp").
async function postSeen(app, spec) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [press] = postKeys(app, 0, spec);
    for (const end = Date.now() + 1500; Date.now() < end; await sleep(15)) {
      const seen = app.marks().find((m) => m.keydown !== undefined && m.made >= press.at - 5 && m.made < press.at + 400);
      if (seen) return { posted: press.at, at: seen.made, attempts: attempt + 1 };
    }
  }
  return null;
}

const journeyState = (app) => app.run(`const j = nn.journeys(); const s = nn.store.getState();
  return { on: j.on, native: j.native, pending: j.pending, samples: j.samples, counts: j.counts, marks: j.marks,
    tabs: Object.keys(s.tabs).length, focused: s.ui.focusedWindowId };`);

async function waitFor(app, accept, timeout, every = 60) {
  for (const end = Date.now() + timeout; Date.now() < end; ) {
    const st = await journeyState(app);
    if (accept(st)) return st;
    await sleep(every);
  }
  return null;
}

const sampled = (st, step) => st.samples[step]?.length ?? 0;
// The first mark of `kind` for any tab at or after `from` (epoch ms).
function markAfter(st, kind, from) {
  let first = NaN;
  for (const list of Object.values(st.marks))
    for (const [k, at] of list) if (k === kind && at >= from - 1 && !(at >= first)) first = at;
  return first;
}
const markOf = (st, key, kind, from) => (st.marks[key] ?? []).filter(([k, at]) => k === kind && at >= from - 1).map(([, at]) => at).sort((a, b) => a - b)[0] ?? NaN;

const pad2 = (n) => String(n).padStart(2, "0");

// How long a key sat between being made (nnperf's CGEvent, the event's timestamp) and the app's event loop getting to it
// (nnmark.m's key log), for the key nnperf made at `at`.
function delivery(app, at) {
  const keys = app.marks().filter((m) => m.keydown !== undefined && Math.abs(m.made - at) < 100);
  keys.sort((a, b) => Math.abs(a.made - at) - Math.abs(b.made - at));
  return keys[0] ? keys[0].keydown - keys[0].made : NaN;
}

// ⌘T, and its new tab's command bar committed (the key pressed again once if the app didn't act on it: the press that
// counts is the one that did).
async function openNewTab(app) {
  let press, bar = null;
  for (let attempt = 0; attempt < 2 && !bar; attempt++) {
    press = await postSeen(app, "cmd+t");
    if (!press) break;
    bar = await waitFor(app, (st) => st.pending.some((q) => q.journey === "j2" && q.bar !== undefined && q.t0 >= press.at - 5), 2500);
  }
  return { press, bar };
}

// J2: ⌘T → the new tab's command bar committed, on screen, focused; one keystroke → its suggestions on screen.
async function newTabKey(app, i, k) {
  const before = await journeyState(app);
  const { press, bar } = await openNewTab(app);
  const p = bar?.pending.filter((q) => q.journey === "j2" && q.bar !== undefined && q.t0 >= press.at - 5).at(-1);
  if (!p) return { lost: "no bar" };
  // Type once the field has focus (its typeable mark; the app hands marks over once a second), as a person would.
  if (!(await waitFor(app, (st) => markOf(st, p.key, "typeable", press.at) >= 0, 5000, 150))) return { lost: "never typeable", tab: p.key };
  await sleep(150);
  const key = await postSeen(app, "text:n");
  if (!key) return { lost: "key never arrived", tab: p.key };
  const done = await waitFor(app, (st) => sampled(st, "j2_suggest") > sampled(before, "j2_suggest"), 8000, 120);
  if (!done) {
    const now = await journeyState(app);
    const q = now.pending.find((x) => x.key === p.key);
    const d = (v) => (v === undefined ? "-" : Math.round(v - press.at));
    return { lost: `no suggestions (pending: ${q ? `bar ${d(q.bar)} keyAt ${d(q.keyAt)} suggested ${d(q.suggested)}` : "gone"}; typed at +${Math.round(key.at - press.at)} (seen by the app after ${Math.round(delivery(app, key.at))} ms); marks ${(now.marks[p.key] ?? []).map(([k]) => k).join()})`, tab: p.key };
  }
  const last = (step) => (sampled(done, step) > sampled(before, step) ? done.samples[step].at(-1) : NaN);
  return {
    tab: p.key,
    // Cumulative from the ⌘T key down (nnperf's stamp), the app's own steps in ms.
    js: p.heard - press.at,
    commit: p.bar - press.at,
    shown: markOf(done, p.key, "bar", press.at) - press.at,
    typeable: markOf(done, p.key, "typeable", press.at) - press.at,
    suggest: markOf(done, p.key, "suggest", key.at) - key.at,
    // The app's own numbers (its t0 is the event's timestamp), and how far that was from ours.
    appTypeable: last("j2_typeable"),
    appSuggest: last("j2_suggest"),
    t0Skew: p.t0 - press.at,
    delivery: delivery(app, press.at),
    suggestDelivery: delivery(app, key.at),
    postGap: press.at - press.posted,
  };
}

// J4: a URL typed into the bar (from a new tab's bar, or ⌘L's panel over a page), Enter → the engine asked to load,
// navigation started, committed, first contentful paint (the app's marks, and the page's own over CDP).
async function navigateByEnter(app, side, id, from) {
  const url = `127.0.0.1:${server.address().port}/static?id=${id}`;
  let tab = null;
  if (from === "newtab") {
    const { press, bar } = await openNewTab(app);
    tab = bar?.pending.filter((q) => q.journey === "j2" && q.bar !== undefined && q.t0 >= press.at - 5).at(-1)?.key;
    if (!tab) return { lost: "no bar" };
    if (!(await waitFor(app, (st) => markOf(st, tab, "typeable", press.at) >= 0, 5000, 150))) return { lost: "never typeable", tab };
  } else {
    const w = JSON.stringify(await app.run(`return ${WINDOW};`));
    let open = false;
    // A key the app didn't act on (it was still busy, or the window wasn't key yet) is pressed again, once.
    for (let attempt = 0; attempt < 2 && !open; attempt++) {
      if (!(await postSeen(app, "cmd+l"))) continue;
      for (const end = Date.now() + 2500; !open && Date.now() < end; await sleep(60)) open = await app.run(`return !!nn.store.getState().windowUi[${w}]?.panel.open;`);
    }
    if (!open) return { lost: "no panel" };
  }
  await sleep(from === "newtab" ? 150 : 900);
  const [typed] = postKeys(app, 25, `text:${url}`);
  // Every character has to have arrived (the bar's text is what Enter sends), and the app caught up with them.
  const arrived = () => app.marks().filter((m) => m.keydown !== undefined && m.made >= typed.at - 5 && m.made < typed.at + url.length * 60).length;
  for (const end = Date.now() + 6000; arrived() < url.length && Date.now() < end; ) await sleep(30);
  if (arrived() < url.length) return { lost: "typed keys dropped", tab };
  // Let the typed address settle (its suggestions, the inline completion) before Enter, as a person's pause would.
  await journeyState(app);
  await sleep(500);
  const before = await journeyState(app);
  const enter = await postSeen(app, "enter");
  if (!enter) return { lost: "enter never arrived", tab };
  const page = await app.pageState(`id=${id}`, 20_000, (s) => s.fcp);
  const done = await waitFor(app, (st) => sampled(st, "j4_fcp") > sampled(before, "j4_fcp") || (st.counts.j4_no_load ?? 0) > (before.counts.j4_no_load ?? 0), 8000, 120);
  if (!page || !done || sampled(done, "j4_fcp") <= sampled(before, "j4_fcp")) {
    const urls = await app.run(`const s = nn.store.getState(); return Object.values(s.tabs).map((t) => t.url);`);
    return { lost: `${!page ? "no page" : "no sample"} (tabs: ${urls.map((u) => u.slice(-24)).join(" ")})`, tab };
  }
  const at = (kind) => markAfter(done, kind, enter.at) - enter.at;
  const last = (step) => (sampled(done, step) > sampled(before, step) ? done.samples[step].at(-1) : NaN);
  return {
    tab,
    request: at("request"), start: at("start"), commit: at("commit"), fcp: at("fcp"),
    engine: markAfter(done, "fcp", enter.at) - markAfter(done, "request", enter.at),
    pageFcp: page.fcp - enter.at,
    appFcp: last("j4_fcp"),
    delivery: delivery(app, enter.at),
  };
}

async function journeyRun(side, i, parts) {
  const dir = freshDir(side, `journeys-${i}`);
  writeFileSync(join(dir, "telemetry.json"), JSON.stringify({ ...TELEMETRY_ON, crashCursor: Date.now() }));
  writeFileSync(join(dir, "bench-offline"), "1");
  const n = +opt["journey-n"];
  const app = new Instance(side, dir);
  app.env.push("NN_BENCH_KEYLOG=1");
  const r = { j2: [], j4new: [], j4page: [], lost: { j2: [], j4new: [], j4page: [] }, guard: null, load: [Math.round(loadavg()[0])] };
  const note = async (kind, x, k) => {
    if (!x.lost) return void r[kind].push(x);
    r.lost[kind].push(x.lost);
    log(`${side.tag}journeys ${i} ${kind} ${k}: lost (${x.lost})`);
    await recover(app);
  };
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(6000);
    // Nothing may leave: the guard answers a collector URL itself, and the field timing is on with native marks.
    r.guard = await app.run(`return fetch("https://netnyahoo.com/otel/v1/logs", { method: "POST", body: "{}" }).then((res) => {
      const j = nn.journeys();
      return { blocked: res.headers.get("x-bench-blocked"), on: j.on, native: j.native, sharing: nn.telemetry().saved.sharing };
    });`);
    if (r.guard.blocked !== "1") throw new Error("bench-offline.js isn't guarding fetch: refusing to run with sharing on");
    if (!r.guard.on || !r.guard.native) throw new Error(`field timing isn't on in the app: ${JSON.stringify(r.guard)}`);
    const closeTab = (tab) => tab && app.run(`nn.store.getState().closeTab(${JSON.stringify(tab)}); return true;`);
    if (parts.has("newtabkey")) {
      for (let k = 0; k < n; k++) {
        const x = await newTabKey(app, i, k);
        await note("j2", x, k);
        await sleep(1200);
        await closeTab(x.tab);
        await sleep(1000);
      }
      log(`${side.tag}journeys ${i} j2:`, JSON.stringify(r.j2.map((x) => Math.round(x.typeable))));
    }
    if (parts.has("navigate")) {
      for (let k = 0; k < n; k++) {
        const x = await navigateByEnter(app, side, `j${i}n${pad2(k)}`, "newtab");
        await note("j4new", x, k);
        await sleep(1500);
        await closeTab(x.tab);
        await sleep(1000);
      }
      for (let k = 0; k < n; k++) {
        const x = await navigateByEnter(app, side, `j${i}p${pad2(k)}`, "page");
        await note("j4page", x, k);
        await sleep(1800);
      }
      log(`${side.tag}journeys ${i} j4:`, JSON.stringify([r.j4new.map((x) => Math.round(x.fcp)), r.j4page.map((x) => Math.round(x.fcp))]));
    }
    r.blocked = (await app.run(`return nn.blockedFetches();`)).length;
    r.load.push(Math.round(loadavg()[0]));
    side.results.journeys.push(r);
  } finally {
    await app.done();
  }
}

// The parts of a session run (--only session runs them all, in this order, on one instance).
const SESSION_PARTS = ["idle", "memory", "switch", "newtab", "newwindow"];

async function sessionRun(side, i, parts) {
  const has = (part) => parts.has(part);
  const secs = +opt.idle;
  const app = new Instance(side, freshDir(side, `session-${i}`));
  const r = { memory: {}, idle: {}, tabSwitch: [], newTab: [], newTabFrame: [], newWindow: [], processes: {}, throttled: { tabSwitch: 0, newTab: 0 } };
  if (parts.size < SESSION_PARTS.length) r.parts = [...parts];
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    if (has("idle") || has("memory")) await sleep(30_000);
    if (has("idle")) r.idle.tabs1 = await idleWindow(app, secs);
    if (has("memory")) r.memory.tabs1 = footprint(usage(app.pid));
    await openTabs(app, 1, 10);
    if (has("memory")) {
      await sleep(10_000);
      r.memory.tabs10 = footprint(usage(app.pid));
    }
    await openTabs(app, 10, 20);
    await sleep(15_000);
    if (has("memory")) r.memory.tabs20 = footprint(usage(app.pid));
    if (has("idle")) r.idle.tabs20 = await idleWindow(app, secs);

    // Tab switches: command → the page's visibilitychange + two frames.
    const tabs = has("switch") ? (await tabIds(app)).filter(([, url]) => url.includes("/static?id=t")) : [];
    for (let k = 0; k < (has("switch") ? 16 : 0); k++) {
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
    for (let k = 0; k < (has("newtab") ? 5 : 0); k++) {
      const hidden = await throttled(app);
      const at = await app.run(`const t = nn.now(); nn.store.getState().newTab(${WINDOW}, { url: "${base()}/static?id=n${k}" }); return t;`);
      const s = await app.pageState(`id=n${k}`, 20_000, (st) => st.fcp);
      if (hidden) r.throttled.newTab++;
      r.newTab.push(s && !hidden ? s.fcp - at : NaN);
      r.newTabFrame.push(s?.frame && !hidden ? s.frame - at : NaN);
      await sleep(800);
    }
    if (has("newtab"))
      await app.run(`const s = nn.store.getState(); for (const id of Object.keys(s.tabs)) if (s.tabs[id].url.includes("id=n")) nn.store.getState().closeTab(id); return true;`);

    for (let k = 0; k < (has("newwindow") ? 3 : 0); k++) r.newWindow.push(await newWindow(app, `w${k}`));

    // Close all but the first tab; memory once the renderers are gone.
    if (has("memory")) {
      r.processes.tabs20 = usage(app.pid).length;
      await app.run(`const s = nn.store.getState(); const w = ${WINDOW}; const keep = s.windows[w].tabIds.find((id) => s.tabs[id].url.includes("id=seed"));
        nn.store.getState().activate(keep); for (const id of s.windows[w].tabIds) if (id !== keep) nn.store.getState().closeTab(id); return true;`);
      await sleep(30_000);
      r.memory.closed = footprint(usage(app.pid));
      r.processes.closed = r.memory.closed.processes;
    }
  } finally {
    await app.done();
  }
  log(`${side.tag}session ${i}:`, JSON.stringify({ idle: r.idle, mem: Object.fromEntries(Object.entries(r.memory).map(([k, v]) => [k, Math.round(v.totalMB)])), sw: r.tabSwitch, nt: r.newTab, nw: r.newWindow }));
  side.results.session.push(r);
}

// Hidden tabs: rAF and timer rates of animating pages that aren't shown.
async function throttleRun(side) {
  const app = new Instance(side, freshDir(side, "throttle"));
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
    side.results.throttle.push({ tabs, idle });
    log(`${side.tag}throttle:`, JSON.stringify(tabs), JSON.stringify(idle.total));
  } finally {
    await app.done();
  }
}

// Leak check: open and close 10 tabs five times; the browser process's footprint after each round.
async function churnRun(side) {
  const app = new Instance(side, freshDir(side, "churn"));
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
    side.results.churn = rounds;
    log(`${side.tag}churn:`, JSON.stringify(rounds.map((r) => Math.round(r.browserMB))));
  } finally {
    await app.done();
  }
}

// Main-thread samples: idle with 20 tabs, then while switching tabs and scrolling.
async function sampleRun(side) {
  const app = new Instance(side, freshDir(side, "sample"));
  const dir = join(side.dir, "samples");
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
    side.results.sample.push({ idle: summarizeSample(join(dir, "idle.txt")), active: summarizeSample(join(dir, "switch-scroll.txt")) });
    log(`${side.tag}samples in`, dir);
  } finally {
    await app.done();
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
  // Nonzero: someone used the Mac during the idle windows, and the pointer over the bench's window raises its wakeups.
  // A window whose probe failed (input null) makes the run's count unknown, not zero.
  const used = (r, k) => {
    const windows = [r.idle.tabs1, r.idle.tabs20].filter(Boolean);
    return windows.length ? windows.reduce((n, w) => n + (w.input?.[k] ?? NaN), 0) : NaN;
  };
  add("idle windows: someone used the Mac (s, per run)", S.map((r) => used(r, "inputSecs")), "s", 2);
  add("idle windows: …with the pointer moving over the window (s, per run)", S.map((r) => used(r, "overWindowSecs")), "s", 2);
  add("after an idle minute: command answered (App Nap check)", S.map((r) => r.idle.tabs1?.afterIdle?.commandMs), "ms");
  const timedSwitches = (r) => !r.parts || r.parts.includes("switch") || r.parts.includes("newtab");
  add("samples left out: page couldn't paint (switch + new tab, per run)", S.map((r) => r.throttled && timedSwitches(r) ? r.throttled.tabSwitch + r.throttled.newTab : NaN), "");
  add("tab switch → shown (median of 16 per run)", S.map((r) => median(r.tabSwitch)), "ms");
  add("new tab → first paint (median of 5 per run)", S.map((r) => median(r.newTab)), "ms");
  add("new tab → its page's first frame (median of 5 per run)", S.map((r) => median(r.newTabFrame ?? [])), "ms");
  // The window phase's runs too (8 windows each).
  const W = [...S, ...(res.windows ?? [])];
  add("new window → on screen (median per run)", W.map((r) => median(r.newWindow.map((w) => w.window))), "ms");
  add("new window → on screen with its content (median per run)", W.map((r) => median(r.newWindow.map((w) => w.withContent))), "ms");
  add("new window → first paint (median per run)", W.map((r) => median(r.newWindow.map((w) => w.firstPaint))), "ms");
  add("new window → its page's first frame (median per run)", W.map((r) => median(r.newWindow.map((w) => w.firstFrame))), "ms");
  // The journeys: every sample of every run pooled (median, p75 by nearest rank, min–max, n).
  const J = res.journeys ?? [];
  const pooled = (name, get) => {
    const v = J.flatMap((r) => get(r)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return;
    rows.push({ name, median: median(v), p75: v[Math.min(v.length - 1, Math.ceil(v.length * 0.75) - 1)], min: v[0], max: v.at(-1), n: v.length, unit: "ms", digits: 0 });
  };
  const of = (kind, field) => (r) => r[kind].map((x) => x[field]);
  pooled("J2 ⌘T key → JS has the new tab", of("j2", "js"));
  pooled("J2 ⌘T key → its command bar committed", of("j2", "commit"));
  pooled("J2 ⌘T key → that commit on screen", of("j2", "shown"));
  pooled("J2 ⌘T key → bar focused and on screen (typeable)", of("j2", "typeable"));
  pooled("J2 keystroke → its suggestions on screen", of("j2", "suggest"));
  pooled("J2 the app's own ⌘T → typeable (its t0 is the event's timestamp)", of("j2", "appTypeable"));
  pooled("J2 the app's t0 minus the key's timestamp (should be 0)", of("j2", "t0Skew"));
  pooled("J2 nnperf hands ⌘T over → the event's timestamp (not in the rows)", of("j2", "postGap"));
  pooled("J2 ⌘T key made → the app's event loop saw it", of("j2", "delivery"));
  pooled("J2 keystroke made → the app's event loop saw it", of("j2", "suggestDelivery"));
  for (const [kind, from] of [["j4new", "new tab's bar (⌘T)"], ["j4page", "page's panel (⌘L)"]]) {
    pooled(`J4 ${from}: Enter → engine asked to load (our side)`, of(kind, "request"));
    pooled(`J4 ${from}: Enter → Chrome started the navigation`, of(kind, "start"));
    pooled(`J4 ${from}: Enter → document committed`, of(kind, "commit"));
    pooled(`J4 ${from}: Enter → first contentful paint (the app's mark)`, of(kind, "fcp"));
    pooled(`J4 ${from}: Enter → first contentful paint (the page's own, CDP)`, of(kind, "pageFcp"));
    pooled(`J4 ${from}: request → first contentful paint (engine and network)`, of(kind, "engine"));
    pooled(`J4 ${from}: Enter made → the app's event loop saw it`, of(kind, "delivery"));
  }
  if (J.length) {
    for (const kind of ["j2", "j4new", "j4page"]) {
      const lost = J.reduce((n, r) => n + r.lost[kind].length, 0);
      const kept = J.reduce((n, r) => n + r[kind].length, 0);
      if (lost || kept) rows.push({ name: `journeys ${kind}: iterations lost (no bar, panel, page or sample)`, median: lost, min: lost, max: lost, n: lost + kept, unit: "", digits: 0 });
    }
    const loads = J.flatMap((r) => r.load ?? []);
    if (loads.length) rows.push({ name: "journeys: 1-minute load average at each run's start and end", median: median(loads), min: Math.min(...loads), max: Math.max(...loads), n: loads.length, unit: "", digits: 0 });
    rows.push({ name: "journeys: fetches the guard answered (nothing left the machine)", median: J.reduce((n, r) => n + (r.blocked ?? 0), 0), min: 0, max: 0, n: J.length, unit: "", digits: 0 });
  }
  return rows;
}

// `other` is the before column; `names` the two columns' headings.
function printTable(rows, other, names = ["Before", "After"]) {
  const fmt = (r) =>
    Number.isFinite(r?.median) ? `${r.median.toFixed(r.digits)} ${r.unit}${r.p75 === undefined ? "" : `, p75 ${r.p75.toFixed(r.digits)}`} (${r.min.toFixed(r.digits)}–${r.max.toFixed(r.digits)}, n=${r.n})` : "—";
  const lines = other
    ? [`| Metric | ${names[0]} | ${names[1]} |`, "|---|---|---|", ...rows.map((r) => `| ${r.name} | ${fmt(other.find((o) => o.name === r.name))} | ${fmt(r)} |`)]
    : ["| Metric | Median (min–max, runs) |", "|---|---|", ...rows.map((r) => `| ${r.name} | ${fmt(r)} |`)];
  console.log(lines.join("\n"));
}

// MARK: Main

if (opt.report) {
  const other = opt.compare ? summary(JSON.parse(readFileSync(opt.compare, "utf8"))) : null;
  printTable(summary(JSON.parse(readFileSync(opt.report, "utf8"))), other);
  process.exit(0);
}
const fail = (message) => {
  console.error(message);
  process.exit(64);
};
if (!opt.app) fail("usage: native-bench.mjs --app <Netnyahoo.app> [--control <app>] [--out dir] [--only phases] … (--help)");
const JOURNEY_PHASES = ["newtabkey", "navigate"];
const PHASES = ["launch", "session", ...SESSION_PARTS, ...JOURNEY_PHASES, "windows", "throttle", "churn", "sample", "prepare"];
const only = new Set(opt.only.split(",").map((p) => p.trim()).filter(Boolean));
for (const p of only) if (!PHASES.includes(p)) fail(`--only: no phase "${p}"; phases: ${PHASES.join(", ")}`);
if (opt.seed && opt.seed !== "big") fail(`--seed: only "big" exists, got "${opt.seed}"`);
if (opt["fresh-copy"] && ![...only].every((p) => p === "launch" || p === "prepare")) fail("--fresh-copy works with --only launch");
if (opt.seed && ![...only].every((p) => p === "launch" || p === "prepare" || JOURNEY_PHASES.includes(p))) fail("--seed big works with --only launch, newtabkey and navigate (the other phases measure a one-tab session)");
for (const e of opt.env) if (!/^[A-Za-z_]\w*=/.test(e)) fail(`--env wants K=V, got "${e}"`);
if (!(+opt.hold >= 0)) fail(`--hold wants seconds, got "${opt.hold}"`);
if (opt.control && opt.compare) log("--compare is ignored with --control: the control is the before column");

// A side: one app being measured, its prepared copy, seeded template and results. The candidate is --app, the
// control (when given) --control; with both, every phase alternates them run by run.
const labelOf = (app) => basename(dirname(dirname(resolve(app))));
function makeSide(app, label, role) {
  const dir = join(opt.out, label);
  mkdirSync(dir, { recursive: true });
  return { role, label, tag: "", src: resolve(app), dir, template: join(dir, "template"), app: null, bundle: null,
    results: { meta: {}, launch: [], session: [], windows: [], journeys: [], throttle: [], sample: [] } };
}
const candidate = makeSide(opt.app, opt.label ?? labelOf(opt.app), "candidate");
let control = null;
if (opt.control) {
  let label = opt["control-label"] ?? labelOf(opt.control);
  if (label === candidate.label) label += "-control";
  control = makeSide(opt.control, label, "control");
  candidate.tag = `${candidate.label} `;
  control.tag = `${control.label} `;
}
const sides = control ? [candidate, control] : [candidate];

// Runs fn(side, i) for i < n, alternating the sides (control first on even runs) so drift hits both alike.
async function interleaved(n, fn) {
  for (let i = 0; i < n; i++) for (const side of !control ? sides : i % 2 ? [candidate, control] : [control, candidate]) await fn(side, i);
}

const cleanup = async () => {
  for (const app of [...live]) await app.quit().catch(() => {});
  server?.close();
};
process.on("SIGINT", async () => {
  log("interrupted: quitting the instance");
  await cleanup();
  process.exit(130);
});

try {
  server = await startServer();
  for (const side of sides) {
    if (opt.prepared) {
      const from = checkPrepared(side.src);
      side.app = side.src;
      side.bundle = join(side.app, "Contents/Resources/main.jsbundle");
      side.results.meta.preparedFrom = from;
    } else {
      // The control runs the candidate's bundle unless it has its own (each must match its app's NATIVE_API_VERSION).
      const own = side === control ? opt["control-bundle"] : opt.bundle;
      side.bundle = own ? resolve(own) : side === control ? candidate.bundle : buildBundle(join(side.dir, "bundle"));
      side.app = prepareApp(side.src, join(side.dir, "app"), side.bundle);
    }
    const other = sides.find((s) => s !== side);
    Object.assign(side.results.meta, { app: side.src, bundle: side.bundle, label: side.label, date: new Date().toISOString(),
      runs: +opt.runs, idleSecs: +opt.idle, only: [...only], env: opt.env, seed: opt.seed ?? null, freshCopy: !!opt["fresh-copy"], ...(other ? { role: side.role, interleavedWith: other.label } : {}) });
  }
  if (only.has("prepare")) {
    for (const side of sides) console.log(`prepared ${side.app} (rerun with --app ${side.app} --prepared)`);
    process.exit(0);
  }
  for (const side of sides) await makeTemplate(side);
  if (only.has("launch")) await interleaved(+opt["launch-runs"], launchRun);
  const parts = new Set(SESSION_PARTS.filter((p) => only.has("session") || only.has(p)));
  if (parts.size) await interleaved(+opt.runs, (side, i) => sessionRun(side, i, parts));
  const journeys = new Set(JOURNEY_PHASES.filter((p) => only.has(p)));
  if (journeys.size) await interleaved(+opt.runs, (side, i) => journeyRun(side, i, journeys));
  if (only.has("windows")) await interleaved(+opt.runs, windowsRun);
  if (only.has("throttle")) await interleaved(1, throttleRun);
  if (only.has("churn")) await interleaved(1, churnRun);
  if (only.has("sample")) await interleaved(1, sampleRun);
  for (const side of sides) writeFileSync(join(side.dir, "results.json"), JSON.stringify(side.results, null, 1));
  const rows = summary(candidate.results);
  if (control) printTable(rows, summary(control.results), [`${control.label} (control)`, candidate.label]);
  else printTable(rows, opt.compare ? summary(JSON.parse(readFileSync(opt.compare, "utf8"))) : null);
  for (const { results, tag } of sides) {
    if (results.throttle.length) console.log(`\n${tag}Hidden tabs:`, JSON.stringify(results.throttle[0].tabs));
    if (results.churn) console.log(`\n${tag}Browser process after each open/close-10-tabs round (MB):`, results.churn.map((r) => Math.round(r.browserMB)).join(" → "));
    if (results.sample.length) console.log(`${tag}Main thread samples:`, JSON.stringify(results.sample[0]));
  }
  if (control) console.log(`\nresults: ${join(candidate.dir, "results.json")}, ${join(control.dir, "results.json")}`);
} finally {
  await cleanup();
}

// Hidden test instances of Netnyahoo, for every script that drives the app (acceptance runs, *-test.mjs, e2e, smoke):
// launch, find our own pid, evaluate in the app's JS (the dev harness) and in its pages (DevTools), quit. One copy of
// what eleven scripts each did their own way.
//
//   import { launch, attach, session, reporter } from "<repo>/scripts/lib/instance.mjs";
//   const app = await launch("apps/browser/build-me/Build/Products/Debug/Netnyahoo.app", { data: "/tmp/…/data" });
//   await app.eval("return nn.store.getState().windowOrder");            // the dev harness (lib/devHarness.ts)
//   const page = await app.page("127.0.0.1:8080/a");                       // DevTools, one socket per page
//   await page.eval("document.title"); await page.send("Page.reload"); page.on("Page.loadEventFired", fn);
//   await app.quit();
//
// - Always hidden: `open -g -n` with NETNYAHOO_BACKGROUND=1, its own data dir and DevTools port (AGENTS.md).
// - The pid is the one process of the app's binary listening on that DevTools port, started by this launch (it
//   didn't listen before), with its start time kept so a reused pid is never signalled. Diffing process lists picked
//   another run's instance of the same binary and killed it (smoke.sh, 2026-09).
// - `<data>/instance.json` records the instance, so another script (or `scripts/agent/nn`) can attach to it.
// - `eval` fails at once when the app dies, and runs one script at a time (the harness has one dev-eval.js).
// - `js: "pinned"` (default) serves Metro through a proxy that refuses its websockets, so other agents' edits and
//   reload broadcasts can't restart the app's JS mid-run; the proxy runs detached and exits once the app has gone.
//
// `node scripts/lib/instance.mjs --self-test` checks the ownership rules.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const here = fileURLToPath(import.meta.url);

// MARK: Processes

/** A port nothing listens on yet (another instance's DevTools would answer for the wrong app). */
export const freePort = () => new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
export function parsePort(value) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || n < 1 || n > 65535) throw new Error(`a port is an integer 1..65535, got ${value}`);
  return n;
}
const pidList = (text) => [...new Set(text.split(/\s+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
// The main binary, not a helper (`…/Netnyahoo Helper.app/…/Netnyahoo Helper`) nor a longer name.
export const commandIsBinary = (command, binary) => command === binary || command.startsWith(`${binary} `);
export function listenerPids(port) {
  const r = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
  if (r.error || r.status > 1) throw new Error(`lsof failed for port ${port}: ${r.error ?? r.stderr}`);
  return pidList(r.stdout);
}
// `ps -o lstart= -o command=`: a 5-token start time, then the full command.
export function parseProcessLine(line) {
  const m = /^\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*\S)\s*$/.exec(line);
  return m ? { started: m[1], command: m[2] } : null;
}
export function processInfo(pid) {
  const r = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? parseProcessLine(r.stdout) : null;
}
export function binaryPids(binary) {
  const r = spawnSync("ps", ["-ww", "-ax", "-o", "pid=", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) throw new Error(`ps failed: ${r.stderr}`);
  return new Set(r.stdout.split("\n").map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m && commandIsBinary(m[2], binary)).map((m) => Number(m[1])));
}
/** null while nothing listens yet; throws when the port's holder can't be this launch's app. */
export function ownedCandidate(listeners, before, commandOf, binary) {
  if (!listeners.length) return null;
  if (listeners.length !== 1) throw new Error(`port has ${listeners.length} listeners: ${listeners.join(", ")}`);
  const [pid] = listeners;
  const command = commandOf(pid) ?? "";
  if (before.has(pid)) throw new Error(`port listener ${pid} predates the launch`);
  if (!commandIsBinary(command, binary)) throw new Error(`port listener ${pid} is not ${binary}: ${command}`);
  return pid;
}
export const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
/** The app bundle's main executable. */
export const binaryOf = (app) => join(app, "Contents/MacOS",
  execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents/Info.plist")]).toString().trim());
/** The app's windows on screen (CoreGraphics' numbers, layer 0), for screencapture -l. */
export const onScreenWindows = (pid) => JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e",
  `ObjC.import("CoreGraphics"); JSON.stringify(ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)))
     .filter((w) => w.kCGWindowOwnerPID === ${pid} && w.kCGWindowLayer === 0).map((w) => w.kCGWindowNumber))`], { timeout: 20000 }).toString());

// MARK: Fixtures

const profileColors = ["plum", "blue", "green", "orange", "red"];
/**
 * A session.json the app restores at launch (store version 2). Everything is optional and filled in:
 *   profiles: ["Personal", "Work"] or [{ id, name, color }] (the first one's id is "default")
 *   windows:  [{ id, profileId, tabIds, activeTabIds, frame, sidebarOpen, incognito }] (default one window, w1)
 *   tabs:     [{ id, windowId, profileId, url, title, pinned, … }] (windowId defaults to the first window)
 * and anything else the store keeps (settings, groups, splits, focusedWindowId…) is passed through.
 */
export function session({ profiles = ["Personal"], windows = [{}], tabs = [], ...rest } = {}) {
  const ps = profiles.map((p, i) => {
    const o = typeof p === "string" ? { name: p } : p;
    return { id: o.id ?? (i ? o.name.toLowerCase() : "default"), name: o.name ?? o.id, color: o.color ?? profileColors[i % 5], icon: null, createdAt: i, ...o };
  });
  const ws = windows.map((w, i) => ({ id: w.id ?? `w${i + 1}`, profileId: ps[0].id, ...w }));
  const ts = tabs.map((t) => {
    const windowId = t.windowId ?? ws[0].id;
    return { windowId, profileId: ws.find((w) => w.id === windowId)?.profileId ?? ps[0].id, url: "", title: "", favicon: null,
      pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, openerId: null,
      createdAt: 1, lastActiveAt: 1, ...t };
  });
  const fullWindows = ws.map((w, i) => {
    const tabIds = w.tabIds ?? ts.filter((t) => t.windowId === w.id).map((t) => t.id);
    const activeTabIds = w.activeTabIds ?? Object.fromEntries(ps.map((p) => [p.id, ts.find((t) => t.windowId === w.id && t.profileId === p.id)?.id])
      .filter(([, id]) => id));
    return { incognito: false, sidebarOpen: true, frame: [80, 80, 1280, 800], createdAt: i + 1, ...w, tabIds, activeTabIds };
  });
  return {
    version: 2,
    profiles: Object.fromEntries(ps.map((p) => [p.id, p])),
    profileOrder: ps.map((p) => p.id),
    windows: fullWindows, windowOrder: fullWindows.map((w) => w.id), focusedWindowId: fullWindows[0]?.id ?? null, tabs: ts,
    groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
    ...rest,
  };
}

// MARK: Metro

// `node instance.mjs --metro-proxy <data dir> <metro port>`: listens on a free port, prints it, passes the bundle
// through and refuses Metro's websockets (/hot, /message). It exits once the instance recorded in <data>/instance.json
// has been gone for a minute (a relaunch on the same data dir takes it over), or nothing was recorded within five.
async function metroProxyMain(data, metroPort) {
  const proxy = createServer((req, res) => {
    const up = httpRequest({ host: "127.0.0.1", port: metroPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on("error", () => res.destroy());
    req.pipe(up);
  });
  proxy.on("upgrade", (req, socket) => socket.destroy());
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  process.stdout.write(`${proxy.address().port}\n`);
  let seen = Date.now();
  setInterval(() => {
    let pid = null;
    try { pid = JSON.parse(readFileSync(join(data, "instance.json"), "utf8")).pid; } catch {}
    if (pid && isAlive(pid)) seen = Date.now();
    else if (Date.now() - seen > (pid ? 60_000 : 5 * 60_000)) process.exit(0);
  }, 2000);
}
async function startMetroProxy(data, metroPort) {
  const child = spawn(process.execPath, [here, "--metro-proxy", data, String(metroPort)], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise((r, j) => {
    let out = "";
    child.stdout.on("data", (d) => { out += d; if (out.includes("\n")) r(Number(out.trim())); });
    child.on("exit", (code) => j(new Error(`the Metro proxy exited (${code})`)));
    setTimeout(() => j(new Error("the Metro proxy didn't start")), 5000);
  });
  child.stdout.destroy();
  child.unref();
  return { pid: child.pid, port, metroPort };
}

// MARK: DevTools

/** A DevTools session on one target over one socket: eval(expression), send(method, params), on(event, fn). */
async function devtools(target, { name = target.url } = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error(`DevTools connection to ${name} failed`)))));
  let seq = 0, closed = false;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  };
  // The target went (its page closed) with calls unanswered: say so now rather than wait out the timeout.
  ws.onclose = () => {
    closed = true;
    for (const [, r] of pending) r({ error: "the target closed before replying" });
    pending.clear();
  };
  const send = async (method, params = {}, { timeout = 10000 } = {}) => {
    if (closed) throw new Error(`DevTools: ${name} closed (${method})`);
    const id = ++seq;
    const reply = new Promise((r) => pending.set(id, r));
    ws.send(JSON.stringify({ id, method, params }));
    const msg = await Promise.race([reply, sleep(timeout).then(() => ({ error: "cdp timeout" }))]);
    pending.delete(id);
    if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
    return msg.result;
  };
  return {
    target,
    send,
    /** The expression's value (awaited, by value); throws on an exception in the page. */
    async eval(expression, { userGesture = false, awaitPromise = true, timeout } = {}) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture }, { timeout });
      if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    },
    on(event, fn) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return () => listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn));
    },
    get closed() { return closed; },
    close() { try { ws.close(); } catch {} },
  };
}

// MARK: Instances

class Instance {
  constructor(record) {
    Object.assign(this, record);
    this.evalQueue = Promise.resolve();
    this.evalSeq = 0;
  }
  get alive() { return isAlive(this.pid) && this.stillOwned(); }
  /** The same start time and binary: the same process (a reused pid has another start time). */
  stillOwned() {
    const info = processInfo(this.pid);
    return !!info && info.started === this.started && commandIsBinary(info.command, this.binary);
  }
  get exited() { return !isAlive(this.pid); }
  save(meta) {
    if (meta) this.meta = { ...this.meta, ...meta };
    const { evalQueue, evalSeq, ...record } = this;
    writeFileSync(join(this.data, "instance.json"), JSON.stringify(record, null, 2));
    return this;
  }

  /** Runs `body` (a function body: `return …`, may return a promise) in the app's JS through the dev harness. */
  eval(body, { timeout = 20000 } = {}) {
    const run = this.evalQueue.then(() => this.#eval(body, timeout));
    this.evalQueue = run.catch(() => {});
    return run;
  }
  async #eval(body, timeout) {
    const id = `e${Date.now()}-${process.pid}-${++this.evalSeq}`;
    const result = join(this.data, "dev-eval-result.json");
    writeFileSync(join(this.data, "dev-eval.js"), `// ${id}\n${body}`);
    const deadline = Date.now() + timeout;
    for (let polls = 0; Date.now() < deadline; polls++) {
      if (polls % 4 === 0 && !isAlive(this.pid)) throw Object.assign(new Error(`the app (pid ${this.pid}) exited`), { appDied: true });
      try {
        const out = JSON.parse(readFileSync(result, "utf8"));
        if (out.id === id) {
          if (out.error) throw Object.assign(new Error(out.error), { fromApp: true });
          return out.result;
        }
      } catch (e) {
        if (e.fromApp) throw e;
        if (!(e instanceof SyntaxError) && e.code !== "ENOENT") throw e;
      }
      await sleep(25);
    }
    throw new Error(`eval timed out after ${timeout} ms: ${body.slice(0, 80)}`);
  }
  /** Waits until the dev harness answers (and `test`, a body returning truthy, holds). */
  async ready({ timeout = 90000, test = "return true" } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        if ((last = await this.eval(test, { timeout: 3000 }))) return last;
      } catch (e) {
        if (e.appDied) throw e;
        last = e.message;
      }
      await sleep(100);
    }
    throw new Error(`the app's dev harness never answered (is Metro running on :${this.js?.metroPort ?? 8081}?); last: ${last}`);
  }

  async targets() { return (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json(); }
  /** The first page target whose URL contains `urlPart` (or matches the predicate), or null. */
  async pageTarget(urlPart) {
    const test = typeof urlPart === "function" ? urlPart : (t) => t.url.includes(urlPart);
    return (await this.targets()).find((t) => t.type === "page" && test(t)) ?? null;
  }
  /** A DevTools session on a page, waiting up to `timeout` for it to appear. */
  async page(urlPart, { timeout = 10000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const t = await this.pageTarget(urlPart);
      if (t) return devtools(t);
      if (Date.now() > deadline) throw new Error(`no page for ${urlPart}`);
      if (!isAlive(this.pid)) throw new Error(`the app (pid ${this.pid}) exited`);
      await sleep(100);
    }
  }
  /** Chrome's browser target (Target.*, Browser.*). */
  async browser() {
    const version = await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json();
    return devtools({ url: "browser", webSocketDebuggerUrl: version.webSocketDebuggerUrl });
  }
  windows() { return onScreenWindows(this.pid); }

  /**
   * Quits as ⌘Q and Sparkle's updates do (the quit Apple event, to this pid only), then SIGTERM, then SIGKILL; with
   * `graceful: false` straight to the signals. Only ever signals this instance (pid, start time and binary).
   * Resolves to how it went.
   */
  async quit(opts = {}) {
    const how = await this.#quit(opts);
    // The Metro proxy goes with it (a relaunch starts another).
    if (this.js?.mode === "pinned" && (processInfo(this.js.pid)?.command ?? "").includes(`--metro-proxy ${this.data} `))
      try { process.kill(this.js.pid); } catch {}
    return how;
  }
  async #quit({ timeout = 15000, graceful = true }) {
    const gone = async (ms) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (!isAlive(this.pid)) return true;
      return !isAlive(this.pid);
    };
    if (!this.stillOwned()) return { how: "gone" };
    if (graceful) {
      spawnSync("osascript", ["-l", "JavaScript", "-e",
        `ObjC.import("AppKit"); const a = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${this.pid}); a.isNil() ? "none" : a.terminate`], { timeout: 10000 });
      if (await gone(timeout)) return { how: "quit" };
    }
    if (!this.stillOwned()) return { how: "gone" };
    process.kill(this.pid, "SIGTERM");
    if (await gone(3000)) return { how: "SIGTERM" };
    if (this.stillOwned()) process.kill(this.pid, "SIGKILL");
    await gone(2000);
    return { how: "SIGKILL" };
  }
  kill(signal = "SIGKILL") { if (this.stillOwned()) process.kill(this.pid, signal); }
  /** The app's stdout and stderr so far. */
  output() { return existsSync(this.log) ? readFileSync(this.log, "utf8") : ""; }
}

/**
 * Launches `app` hidden. Options:
 *   data      NETNYAHOO_DATA_DIR (default a fresh dir under $TMPDIR); created, and wiped first with `fresh`
 *   session   a session.json to restore (an object; see session()); `files` writes any other files into the data dir
 *   onboarded true: onboarding.json says it's done (no intro); probe: true writes perf-probe (a Release build's harness)
 *   env       { NAME: value } more environment (null leaves a variable out: NETNYAHOO_DATA_DIR: null starts the app
 *             on its default data, as an installed copy; `data` is then the folder its dev harness reads);
 *             `switches` Chromium switches (string or array)
 *   args      arguments after --args (they reach Chrome's command line)
 *   js        "pinned" (default: Metro through a proxy that refuses reloads), "live" (Metro itself), "host:port",
 *             or "none" (a Release build's own bundle); `metroPort` (default METRO_PORT or 8081)
 *   port      the DevTools port (default a free one); `log` the app's stdout and stderr (default <data>/app.out.log)
 *   ready     wait for the dev harness (default true; a body returning truthy to wait for more, or { test, timeout });
 *             an app that never gets ready is quit before the error is thrown
 */
export async function launch(app, opts = {}) {
  app = resolve(app);
  if (app.startsWith("/Applications/")) throw new Error("never an installed app: pass a build (apps/browser/build-*)");
  const data = resolve(opts.data ?? join(process.env.TMPDIR ?? "/tmp", `nn-instance-${process.pid}-${Date.now()}`));
  if (opts.fresh) rmSync(data, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  // A relaunch on this data dir keeps the Metro proxy its last instance had, while it runs.
  let previous = null;
  try { previous = JSON.parse(readFileSync(join(data, "instance.json"), "utf8")); } catch {}
  for (const f of ["dev-eval.js", "dev-eval-result.json", "instance.json"]) rmSync(join(data, f), { force: true });
  if (opts.session) writeFileSync(join(data, "session.json"), JSON.stringify(opts.session));
  if (opts.onboarded) writeFileSync(join(data, "onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  if (opts.probe) writeFileSync(join(data, "perf-probe"), "");
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(data, name), typeof text === "string" ? text : JSON.stringify(text));
  const binary = binaryOf(app);
  const port = opts.port ? parsePort(opts.port) : await freePort();
  const busy = listenerPids(port);
  if (busy.length) throw new Error(`DevTools port ${port} is already in use by pid ${busy.join(", ")}`);
  const metroPort = Number(opts.metroPort ?? process.env.METRO_PORT ?? 8081);
  const jsMode = opts.js ?? "pinned";
  let js = { mode: jsMode, metroPort };
  if (jsMode === "pinned") {
    const kept = previous?.js;
    js = kept?.mode === "pinned" && kept.metroPort === metroPort && isAlive(kept.pid) && listenerPids(kept.port).includes(kept.pid)
      ? kept : { mode: "pinned", ...(await startMetroProxy(data, metroPort)) };
  }
  const location = jsMode === "pinned" ? `localhost:${js.port}` : jsMode === "live" ? `localhost:${metroPort}` : jsMode === "none" ? null : jsMode;
  const switches = [opts.switches].flat().filter(Boolean).join(" ");
  const env = {
    NETNYAHOO_BACKGROUND: "1", NETNYAHOO_DATA_DIR: data, NETNYAHOO_REMOTE_DEBUGGING_PORT: String(port),
    ...(location ? { NETNYAHOO_JS_LOCATION: location } : {}),
    ...(switches ? { NETNYAHOO_CHROMIUM_SWITCHES: switches } : {}),
    ...opts.env,
  };
  const log = resolve(opts.log ?? join(data, "app.out.log"));
  const before = binaryPids(binary);
  const launchedAt = Date.now();
  // As AGENTS.md says: `open -g -n` with the environment, never a plain open, so it can't take focus.
  execFileSync("open", ["-g", "-n", ...Object.entries(env).filter(([, v]) => v !== null && v !== undefined).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    "--stdout", log, "--stderr", log, app, ...(opts.args?.length ? ["--args", ...opts.args] : [])]);
  let owned = null;
  for (const end = Date.now() + (opts.startTimeout ?? 60000); !owned && Date.now() < end; await sleep(100)) {
    let info;
    const pid = ownedCandidate(listenerPids(port), before, (p) => (info = processInfo(p))?.command, binary);
    if (pid && info) owned = { pid, started: info.started };
  }
  if (!owned) throw new Error(`the app didn't listen on DevTools port ${port} within ${(opts.startTimeout ?? 60000) / 1000} s (log: ${log})`);
  const instance = new Instance({ app, binary, data, port, log, launchedAt, js, ...owned, meta: opts.meta ?? {} }).save();
  if (opts.ready !== false)
    try {
      await instance.ready(typeof opts.ready === "string" ? { test: opts.ready } : typeof opts.ready === "object" ? opts.ready : {});
    } catch (e) {
      await instance.quit({ graceful: false });
      throw e;
    }
  return instance;
}

/** The instance recorded in a data dir (or the scratch dir holding data/), if it is still the same process. */
export function attach(dir) {
  dir = resolve(dir);
  const file = [join(dir, "instance.json"), join(dir, "data", "instance.json")].find(existsSync);
  if (!file) throw new Error(`no instance recorded in ${dir}`);
  const instance = new Instance(JSON.parse(readFileSync(file, "utf8")));
  if (!instance.stillOwned()) throw Object.assign(new Error(`the instance in ${dirname(file)} (pid ${instance.pid}) has gone`), { gone: true, instance });
  return instance;
}

// MARK: Output

/**
 * Quiet output: one line per check (`PASS name 120ms`), everything else to a log file. A failure prints its error and
 * the first lines it logged, then the log's path; summary() ends the run with the counts and the path. VERBOSE=1
 * echoes the log too.
 */
export function reporter(logFile, { name = "run" } = {}) {
  mkdirSync(dirname(resolve(logFile)), { recursive: true });
  writeFileSync(logFile, `# ${name} ${new Date().toISOString()}\n`);
  const results = [];
  const started = Date.now();
  let section = [];
  const write = (line) => {
    appendFileSync(logFile, `${line}\n`);
    section.push(line);
    if (process.env.VERBOSE) console.log(line);
  };
  const text = (a) => (typeof a === "string" ? a : a instanceof Error ? (a.stack ?? a.message) : JSON.stringify(a));
  const r = {
    results,
    logFile,
    /** Lines for the log file only. */
    log: (...a) => write(a.map(text).join(" ")),
    /** A line for the terminal too (and the log). */
    say: (...a) => {
      const line = a.map(text).join(" ");
      appendFileSync(logFile, `${line}\n`);
      console.log(line);
    },
    /**
     * Records a check's outcome: `error` null for a pass, `skip` a reason it didn't run, `ms` its time (left out of
     * the line when not given). The lines logged since the last record go under a failure.
     */
    record(checkName, { ms, error = null, evidence, skip } = {}) {
      const status = skip ? "SKIP" : error ? "FAIL" : "PASS";
      const time = skip ? ` (${skip})` : ms !== undefined ? ` ${ms}ms` : "";
      const logged = section;
      section = [];
      results.push({ name: checkName, ok: !error, skipped: !!skip, ms, error: error ? String(error.message ?? error) : undefined, evidence });
      appendFileSync(logFile, `${status} ${checkName}${time}${evidence !== undefined ? ` ${text(evidence)}` : ""}${error ? `: ${text(error)}` : ""}\n`);
      if (!error) {
        console.log(`${status} ${checkName}${time}`);
        return;
      }
      const message = String(error.message ?? error).split("\n");
      const detail = [...message.slice(1), ...logged].filter((l) => l.trim()).slice(0, 19);
      console.log(`FAIL ${checkName}${time}: ${message[0].slice(0, 400)}`);
      for (const l of detail) console.log(`  ${l.slice(0, 300)}`);
      console.log(`  (log: ${logFile})`);
    },
    /** Runs one check: fn's return value is its evidence (logged), a throw its failure. */
    async check(checkName, fn, { onFail } = {}) {
      section = [];
      appendFileSync(logFile, `\n## ${checkName}\n`);
      const t0 = Date.now();
      try {
        const evidence = await fn();
        r.record(checkName, { ms: Date.now() - t0, evidence });
        return true;
      } catch (error) {
        if (onFail) try { await onFail(error); } catch {}
        r.record(checkName, { ms: Date.now() - t0, error });
        return false;
      }
    },
    get failed() { return results.filter((x) => !x.ok); },
    summary() {
      const ran = results.filter((x) => !x.skipped);
      const failed = ran.filter((x) => !x.ok);
      const line = `${ran.length - failed.length}/${ran.length} passed in ${((Date.now() - started) / 1000).toFixed(1)} s` +
        `${failed.length ? `; failed: ${failed.map((x) => x.name).join(", ")}` : ""}. Log: ${logFile}`;
      appendFileSync(logFile, `\n${line}\n`);
      console.log(line);
      return !failed.length;
    },
  };
  return r;
}

// MARK: Self-test and the proxy

if (process.argv[1] === here) {
  const args = process.argv.slice(2);
  if (args[0] === "--metro-proxy") await metroProxyMain(args[1], Number(args[2]));
  else if (args[0] === "--self-test") {
    const bin = "/tmp/Netnyahoo.app/Contents/MacOS/Netnyahoo";
    const cmd = (map) => (pid) => map[pid];
    assert.equal(parsePort("9474"), 9474);
    for (const bad of ["0", "65536", "94.5", "-1", "", "9474x", "1e3"]) assert.throws(() => parsePort(bad), /1\.\.65535/, bad);
    assert.deepEqual(pidList("12\n34\n12\n"), [12, 34]);
    assert.deepEqual(pidList(""), []);
    assert.ok(commandIsBinary(bin, bin));
    assert.ok(commandIsBinary(`${bin} --flag`, bin));
    assert.ok(!commandIsBinary(`${bin}2`, bin));
    assert.ok(!commandIsBinary(`/tmp/Netnyahoo.app/Contents/Frameworks/Netnyahoo Helper.app/Contents/MacOS/Netnyahoo Helper`, bin));
    assert.deepEqual(parseProcessLine(`Wed Sep 30 18:44:18 2026     ${bin} --x\n`), { started: "Wed Sep 30 18:44:18 2026", command: `${bin} --x` });
    assert.equal(parseProcessLine(""), null);
    assert.equal(ownedCandidate([], new Set(), cmd({}), bin), null);
    assert.equal(ownedCandidate([7], new Set([5]), cmd({ 7: bin }), bin), 7);
    // The failure this guards: another run's instance of the same binary must never become ours.
    assert.throws(() => ownedCandidate([5], new Set([5]), cmd({ 5: bin }), bin), /predates/);
    assert.throws(() => ownedCandidate([7], new Set(), cmd({ 7: "/usr/bin/python3 -m http.server" }), bin), /is not/);
    assert.throws(() => ownedCandidate([7], new Set(), cmd({}), bin), /is not/);
    assert.throws(() => ownedCandidate([7, 8], new Set(), cmd({ 7: bin, 8: bin }), bin), /2 listeners/);
    assert.ok(isAlive(process.pid));
    const s = session({ profiles: ["Personal", "Work"], tabs: [{ id: "t1" }, { id: "t2", profileId: "work" }] });
    assert.deepEqual(s.windows[0].tabIds, ["t1", "t2"]);
    assert.deepEqual(s.windows[0].activeTabIds, { default: "t1", work: "t2" });
    assert.deepEqual(s.profileOrder, ["default", "work"]);
    console.log("PASS self-test");
  }
}

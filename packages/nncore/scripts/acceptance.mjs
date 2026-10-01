#!/usr/bin/env node
// Stage 1 acceptance for the app on NNCore (docs/nncore-parity.md): boots the NNCore build of the app hidden
// (NETNYAHOO_BACKGROUND=1, its own data dir and DevTools port), serves fixture pages, and drives the real app
// through its dev harness (lib/devHarness.ts: $NETNYAHOO_DATA_DIR/dev-eval.js) and Chrome's DevTools protocol.
//
//   node packages/nncore/scripts/acceptance.mjs <NetnyahooNNCore.app> <scratch dir> [check…]
//
// It never takes focus and never touches a real profile: the data dir is <scratch dir>/data, wiped first.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";

const [appArg, scratchArg, ...only] = process.argv.slice(2);
if (!appArg || !scratchArg) {
  console.error("usage: acceptance.mjs <NetnyahooNNCore.app> <scratch dir> [check…]");
  process.exit(64);
}
const app = resolve(appArg);
const scratch = resolve(scratchArg);
const data = join(scratch, "data");
// A DevTools port nothing else listens on (another instance's would answer for the wrong app).
const freePort = () => new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
let port;
const downloadsDir = join(scratch, "downloads");
rmSync(data, { recursive: true, force: true });
rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });
mkdirSync(data, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (...a) => console.log(...a);
const stamp = () => new Date().toISOString().slice(11, 23);

// MARK: Fixtures

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const page = (title, body, extra = "") =>
    `<!doctype html><html><head><title>${title}</title><link rel="icon" href="/icon.png">${extra}</head><body>${body}</body></html>`;
  if (url.pathname === "/icon.png") {
    // A 1×1 red PNG.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(png);
  }
  if (url.pathname === "/file.bin") {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="nncore-test.bin"' });
    return res.end(Buffer.alloc(64 * 1024, 7));
  }
  if (url.pathname === "/slow.bin") {
    // 2 MB over about 8 s, for pausing, resuming and cancelling a download that is still running.
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(40 * 50 * 1024), "content-disposition": 'attachment; filename="nncore-slow.bin"' });
    let sent = 0;
    const timer = setInterval(() => {
      if (res.destroyed || sent >= 40) {
        clearInterval(timer);
        if (!res.destroyed) res.end();
        return;
      }
      sent++;
      res.write(Buffer.alloc(50 * 1024, 3));
    }, 200);
    req.on("close", () => clearInterval(timer));
    return;
  }
  if (url.pathname === "/tone.wav") {
    // One second of a quiet 440 Hz tone (the tab is muted while it plays).
    const rate = 8000, n = rate;
    const wav = Buffer.alloc(44 + n * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
    res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav.length) });
    return res.end(wav);
  }
  res.writeHead(200, { "content-type": "text/html" });
  if (url.pathname === "/blocking") return res.end(page("Blocking", `<img src="/nnblock-1.png"><img src="/nnblock-2.png"><img src="/icon.png">`));
  if (url.pathname === "/login") return res.end(page("Login", `<form action="/b" method="get"><input name="u" id="u" autocomplete="username"><input type="password" name="p" id="p" autocomplete="current-password"><button id="go">Sign in</button></form>`));
  if (url.pathname === "/text") return res.end(page("Text", `<p id="t" style="font: 20px sans-serif; margin: 40px">Hello selection world, select me please</p>`));
  if (url.pathname === "/capture-target") return res.end(page("Capture Target", "the tab that tab capture picks"));
  if (url.pathname === "/media") return res.end(page("Media", `<audio id="tone" src="/tone.wav" loop></audio>`));
  if (url.pathname === "/a") return res.end(page("Page A", `<a id="next" href="/b">to B</a> <a id="blank" target="_blank" href="/c">blank</a> <a id="cmd" href="/d">cmd</a>`));
  if (url.pathname === "/b") return res.end(page("Page B", "B"));
  if (url.pathname === "/c") return res.end(page("Page C", "C"));
  if (url.pathname === "/d") return res.end(page("Page D", "D"));
  if (url.pathname === "/e") return res.end(page("Page E", "E"));
  if (url.pathname === "/cookie") return res.end(page("Cookie", `<script>document.cookie="who=" + location.search.slice(1) + "; path=/"</script>`));
  return res.end(page(url.pathname, url.pathname));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// MARK: The app

// The Metro server this tree's JS comes from (METRO_PORT, default 8081), through a proxy that passes the bundle
// and refuses Metro's websockets (/hot, /message): other agents' edits and reload broadcasts can't restart the app's
// JS mid-run. The NNCore build has its own defaults domain, so this never touches the CEF app's.
const metroPort = Number(process.env.METRO_PORT ?? 8081);
const metroProxy = createServer((req, res) => {
  const upstream = httpRequest({ host: "127.0.0.1", port: metroPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  upstream.on("error", () => res.destroy());
  req.pipe(upstream);
});
metroProxy.on("upgrade", (req, socket) => socket.destroy());
await new Promise((r) => metroProxy.listen(0, "127.0.0.1", r));
execFileSync("defaults", ["write", "com.netnyahoo.browser.nncore", "RCT_jsLocation", `localhost:${metroProxy.address().port}`]);
// No Fast Refresh: other agents edit this tree while the run goes, and a reload would restart the app's JS mid-run.
execFileSync("defaults", ["write", "com.netnyahoo.browser.nncore", "RCTDevMenu", "-dict", "hotLoadingEnabled", "-bool", "NO", "isHotLoadingEnabled", "-bool", "NO"]);

// As AGENTS.md says: `open -g -n` with the environment, never a plain open, so it can't take focus.
const exe = join(app, "Contents/MacOS/NetnyahooNNCore");
let stdout = join(scratch, "app.out.log");
let pid, child, launchedAt, exited = null;
function pgrep() {
  try {
    return execFileSync("pgrep", ["-f", `^${exe}`]).toString().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
// Starts the app on the run's data dir (again for the relaunch checks), with a fresh DevTools port.
async function launch(log = "app.out.log") {
  port = await freePort();
  stdout = join(scratch, log);
  const pidsBefore = new Set(pgrep());
  launchedAt = Date.now();
  execFileSync("open", [
    "-g", "-n",
    "--env", "NETNYAHOO_BACKGROUND=1", "--env", "NETNYAHOO_TEST_REAUTH=granted", "--env", `NETNYAHOO_DOWNLOADS_DIR=${downloadsDir}`, "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`,
    // Tab capture without Chrome's picker: getDisplayMedia takes the tab titled "Capture Target" (Chrome's browser-test
    // switch; a tab, so no macOS screen-recording prompt).
    "--env", `NETNYAHOO_CHROMIUM_SWITCHES=--auto-select-tab-capture-source-by-title=Capture Target ${process.env.NETNYAHOO_CHROMIUM_SWITCHES ?? ""}`.trim(),
    // Passed through for experiments (e.g. NETNYAHOO_ALLOW_OCCLUSION=1).
    ...["NETNYAHOO_ALLOW_OCCLUSION", "NETNYAHOO_TRACE_VISIBILITY"].filter((k) => process.env[k]).flatMap((k) => ["--env", `${k}=${process.env[k]}`]),
    "--stdout", stdout, "--stderr", stdout,
    app,
  ]);
  pid = await (async () => {
    for (let i = 0; i < 100; i++) {
      const fresh = pgrep().filter((p) => !pidsBefore.has(p));
      if (fresh.length) return fresh[0];
      await sleep(100);
    }
    throw new Error("the app didn't start");
  })();
  const own = pid;
  child = { pid: own, kill: (sig) => { try { process.kill(own, sig); } catch {} } };
  exited = null;
  writeFileSync(join(scratch, "app.pid"), String(own));
}
await launch();
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
setInterval(() => { if (!exited && !alive()) exited = { pid }; }, 300).unref();
const appLog = { join: () => (existsSync(stdout) ? readFileSync(stdout, "utf8") : "") };

let evalSeq = 0;
async function evalApp(body, timeoutMs = 20000) {
  const id = `e${Date.now()}-${++evalSeq}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`app exited ${JSON.stringify(exited)}`);
    try {
      const out = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8"));
      if (out.id === id) {
        if (out.error) throw new Error(out.error);
        return out.result;
      }
    } catch (e) {
      if (!(e instanceof SyntaxError) && e.code !== "ENOENT") throw e;
    }
    await sleep(100);
  }
  throw new Error(`eval timed out: ${body.slice(0, 80)}`);
}

async function until(what, fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function cdp(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const reply = new Promise((r) => (ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id === 1) r(msg);
  }));
  ws.send(JSON.stringify({ id: 1, method, params }));
  const msg = await Promise.race([reply, sleep(10000).then(() => ({ error: "cdp timeout" }))]);
  ws.close();
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return msg.result;
}

const pageTarget = async (urlPart) => (await targets()).find((t) => t.type === "page" && t.url.includes(urlPart));
const cef = (call) => evalApp(`return globalThis.expo.modules.NetnyahooCEF.${call}`);
const exts = (call) => evalApp(`return globalThis.expo.modules.NetnyahooExtensions.${call}`);
// A copy in the scratch dir: the app reading the checkout under ~/Documents would raise macOS's folder-access
// prompt (and block the main thread on it) for every re-signed build.
const extPath = join(scratch, "fixture-ext");
cpSync(resolve(new URL(".", import.meta.url).pathname, "../../../spikes/nncore-host/fixtures/ext"), extPath, { recursive: true });
// The module's browser id of an app tab.
const browserOf = (tabId) => evalApp(`return nn.pageState.getState().browsers ? Object.entries(nn.pageState.getState().browsers).find(([, t]) => t === "${tabId}")?.[0] ?? null : null`);
// The DevTools target of one app tab (several tabs can show the same URL): marked through the app, then found.
async function pageFor(tabId, urlPart) {
  const candidates = (await targets()).filter((t) => t.type === "page" && t.url.includes(urlPart));
  if (candidates.length <= 1) return candidates[0];
  await evalApp(`return nn.webviews.get(${JSON.stringify(tabId)})?.executeJavaScript(${JSON.stringify(`window.__nnTab = ${JSON.stringify(tabId)}`)})`);
  await sleep(200);
  for (const t of candidates) {
    const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__nnTab)", returnByValue: true }).catch(() => null);
    if (r?.result?.value === tabId) return t;
  }
  return candidates[0];
}
// The window the run works in: the first one, then the one its first tab is in.
let mainWindow = null;
let first;
// The dev event log (NNCoreWebView's devEvents) of an app tab.
const eventsOf = async (tabId) => {
  const browser = await browserOf(tabId);
  return browser ? evalApp(`return globalThis.expo.modules.NetnyahooCEF.devEvents(${browser})`) : [];
};
const state = () =>
  evalApp(`const s = nn.store.getState(); const w = s.windows[${JSON.stringify(mainWindow)}] ?? Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    return { windowId: w?.id, profileId: w?.profileId, tabs: (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url, title: s.tabs[id]?.title, favicon: s.tabs[id]?.favicon?.slice(0, 40), adoptId: s.tabs[id]?.adoptId, profileId: s.tabs[id]?.profileId, loading: s.live[id]?.isLoading, back: s.live[id]?.canGoBack, fwd: s.live[id]?.canGoForward })), active: w ? w.activeTabIds[w.profileId] : null, windows: Object.keys(s.windows).length, profiles: s.profileOrder };`);

// NETNYAHOO_TRACE_VISIBILITY: the first tab's document.visibilityState, sampled every 250 ms over one DevTools
// connection, each change logged with the time and the check running (the app logs its side as [nncore-vis]).
let currentCheck = "";
let visibilityWatch = null;
function watchVisibility(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let last = null, seq = 0;
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const value = msg.result?.result?.value;
    if (value && value !== last) {
      log(`  [vis ${stamp()}] ${last ?? "-"} → ${value} during ${currentCheck}`);
      last = value;
    }
  };
  const timer = setInterval(() => {
    if (ws.readyState === 1)
      ws.send(JSON.stringify({ id: ++seq, method: "Runtime.evaluate", params: { expression: "document.visibilityState + '/' + location.pathname + '/' + document.hasFocus()", returnByValue: true } }));
  }, 250);
  ws.onclose = () => clearInterval(timer);
  visibilityWatch = { stop: () => { clearInterval(timer); try { ws.close(); } catch {} } };
}

async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  if ((process.env.SKIP ?? "").split(",").includes(name)) return;
  const started = Date.now();
  currentCheck = name;
  if (process.env.NETNYAHOO_TRACE_VISIBILITY) log(`  [check ${stamp()}] ${name}`);
  try {
    const evidence = await fn();
    results.push({ name, ok: true, evidence, ms: Date.now() - started });
    log(`PASS ${name}: ${JSON.stringify(evidence)}`);
  } catch (e) {
    let snapshot = null;
    try {
      snapshot = await state();
    } catch {}
    results.push({ name, ok: false, error: String(e?.message ?? e), state: snapshot, ms: Date.now() - started });
    log(`FAIL ${name}: ${e?.message ?? e}\n  state: ${JSON.stringify(snapshot)}`);
    if (process.env.VERBOSE && first)
      try {
        log(`  events of ${first.id}: ${JSON.stringify((await eventsOf(first.id)).slice(-12))}`);
      } catch {}
  }
}

// MARK: Checks

try {
  await check("boot", async () => {
    const info = await until("the dev harness", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    if (info.engine !== "nncore") throw new Error(`engine ${info.engine}`);
    const s = await until("a window", async () => ((await state()).windowId ? state() : null), 30000);
    const front = execFileSync("lsappinfo", ["front"]).toString();
    const asn = execFileSync("lsappinfo", ["info", "-only", "pid", front.trim()]).toString();
    if (asn.includes(`=${child.pid}`)) throw new Error("the app took focus");
    mainWindow = s.windowId;
    // One JS runtime: a second one (the launch callbacks sent twice) makes a second window with its own id prefix.
    await sleep(2000);
    const native = await evalApp(`return nn.shell.windowIds()`);
    if (native.length !== 1) throw new Error(`windows ${JSON.stringify(native)} (a second JS runtime?)`);
    return { chromium: info.chromiumVersion, windows: s.windows, tabs: s.tabs.length, pid: child.pid };
  });

  await check("open-url", async () => {
    await evalApp(`nn.actions.openUrls(["${base}/a"], ${JSON.stringify(mainWindow)}); return true`);
    const s = await until("tab A titled", async () => {
      const s = await state();
      const t = s.tabs.find((t) => t.url?.startsWith(`${base}/a`));
      return t && t.title === "Page A" && !t.loading ? { s, t } : null;
    });
    first = s.t;
    const t = await pageTarget(`${base}/a`);
    if (!t) throw new Error("no CDP target for A");
    if (process.env.NETNYAHOO_TRACE_VISIBILITY) watchVisibility(t);
    return { tab: s.t.id, title: s.t.title, active: s.s.active === s.t.id };
  });

  await check("visibility", async () => {
    // Diagnostic: how Chrome sees the shown page of a hidden (background-mode) window.
    const t = await pageFor(first.id, `${base}/a`);
    const vis = (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
    const windows = (await evalApp(`return globalThis.expo.modules.NetnyahooCEF.chromeWindows()`)).map((w) => ({ visible: w.visible, alpha: w.alpha, key: w.key, frame: w.frame }));
    return { page: vis, windows };
  });

  await check("occlusion", async () => {
    // A background-mode window that something covers (here: one of the app's own windows right above it, which macOS
    // reports as occluding it) keeps its shown page visible and taking input: hidden instances must not depend on
    // the owner's windows (Chrome hides an occluded window's pages and drops their input).
    // With NETNYAHOO_ALLOW_OCCLUSION=1 (Chrome's own behaviour, as the user's app has it) the page goes hidden while
    // covered and must come back visible once uncovered.
    const allow = !!process.env.NETNYAHOO_ALLOW_OCCLUSION;
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const t = await pageFor(first.id, `${base}/a`);
    const vis = async () => (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindowNumber(${browser})`);
    const chromeSees = async () => (await evalApp(`return globalThis.expo.modules.NetnyahooCEF.chromeWindows()`)).find((x) => x.window === windowNumber);
    await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${windowNumber}, "cover")`);
    let samples = [], escape = null, w = null;
    try {
      // macOS reports the window occluded (Chrome's occlusion checker follows it, and waits a second more before
      // telling the page; with the background switch it doesn't run).
      w = await until("macOS to see the window occluded", async () => {
        const x = await chromeSees();
        return x && !x.occlusionVisible && (!allow || x.chromeOccluded) ? x : null;
      }, 10000);
      for (let i = 0; i < 8; i++) {
        samples.push(await vis());
        await sleep(400);
      }
      if (!allow) {
        // Input still reaches the covered page: an Esc it leaves alone comes back to the app.
        const s = await state();
        const before = (await eventsOf(first.id)).filter((x) => x.name === "command" && x.payload?.command === "escape").length;
        await evalApp(`return nn.webviews.get("${first.id}").focus()`);
        await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "\u001b", keyCode: 53, modifiers: [], focus: "page" })`);
        escape = await until("Esc while covered", async () =>
          (await eventsOf(first.id)).filter((x) => x.name === "command" && x.payload?.command === "escape").length > before ? true : null, 5000);
      }
    } finally {
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${windowNumber}, "uncover")`);
    }
    const back = await until("visible again", async () => ((await vis()) === "visible" ? "visible" : null), 10000);
    const expected = allow ? "hidden" : "visible";
    if (allow ? !samples.slice(4).every((v) => v === "hidden") : !samples.every((v) => v === "visible"))
      throw new Error(`while covered the page was ${JSON.stringify(samples)}, expected ${expected}`);
    return { chromeOccluded: w.chromeOccluded, macOSVisible: w.occlusionVisible, samples, escape, back };
  });

  await check("favicon", async () => {
    const t = await until("a favicon", async () => (await state()).tabs.find((t) => t.id === first?.id && t.favicon));
    return { favicon: String(t.favicon).slice(0, 60) };
  });

  await check("navigate-back-forward-reload", async () => {
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/b", { userInitiated: true }); return true`);
    await until("B", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page B" && t.back));
    await evalApp(`return nn.webviews.get("${first.id}").goBack()`);
    await until("back to A", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && t.fwd));
    await evalApp(`return nn.webviews.get("${first.id}").goForward()`);
    await until("forward to B", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page B"));
    const target = await pageTarget(`${base}/b`);
    await cdp(target, "Runtime.evaluate", { expression: "window.__mark = 1" });
    await evalApp(`return nn.webviews.get("${first.id}").reload()`);
    await until("reloaded", async () => {
      const t = await pageTarget(`${base}/b`);
      const r = t && (await cdp(t, "Runtime.evaluate", { expression: "String(window.__mark)", returnByValue: true }));
      return r?.result?.value === "undefined";
    });
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    return { ok: true };
  });

  await check("target-blank", async () => {
    const before = (await state()).tabs.length;
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('blank').click()", userGesture: true });
    const s = await until("a new tab for C", async () => {
      const s = await state();
      const c = s.tabs.find((x) => x.url?.startsWith(`${base}/c`) && x.title === "Page C");
      return s.tabs.length > before && c ? { s, c } : null;
    });
    await sleep(2500);
    const later = (await state()).tabs.find((x) => x.id === s.c.id);
    if (!later) throw new Error("the popup's tab went away");
    return { tabs: s.s.tabs.length, adoptId: s.c.adoptId ?? null, stays: !!later };
  });

  await check("window-open", async () => {
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: `window.open("${base}/e", "_blank")`, userGesture: true });
    const e = await until("E in a tab", async () => (await state()).tabs.find((x) => x.url?.startsWith(`${base}/e`) && x.title === "Page E"));
    return { tab: e.id, adoptId: e.adoptId ?? null };
  });

  await check("cmd-click", async () => {
    const activeBefore = (await state()).active;
    const t = await pageTarget(`${base}/a`);
    const r = await cdp(t, "Runtime.evaluate", {
      expression: "JSON.stringify(document.getElementById('cmd').getBoundingClientRect())",
      returnByValue: true,
    });
    const box = JSON.parse(r.result.value);
    const x = box.x + 4, y = box.y + box.height / 2;
    for (const type of ["mousePressed", "mouseReleased"])
      await cdp(t, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, modifiers: 4 });
    const d = await until("D in a background tab", async () => (await state()).tabs.find((x) => x.url?.startsWith(`${base}/d`)));
    const s = await state();
    if (s.active !== activeBefore) throw new Error("the ⌘-clicked tab came to the front");
    return { tab: d.id, adoptId: d.adoptId ?? null, background: true };
  });

  await check("evaluate", async () => {
    // The page channel (NNCore's renderer side): evaluate runs in the page's main world and answers with post.
    const title = await evalApp(`return nn.webviews.get("${first.id}").evaluate("post('result', JSON.stringify(document.title))")`);
    if (title !== "Page A") throw new Error(`evaluate gave ${JSON.stringify(title)}`);
    const script = await evalApp(`return nn.webviews.get("${first.id}").evaluate("post('result', JSON.stringify(typeof window.Notification))")`);
    return { title, notification: script };
  });

  await check("tab-strips", async () => {
    const tx = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.tabStrips()`);
    const s = await state();
    const strip = tx.strips.find((x) => x.tabs.some((t) => t.key === first.id));
    if (!strip) throw new Error(`no strip names ${first.id}: ${JSON.stringify(tx)}`);
    const keys = strip.tabs.map((t) => t.key);
    const missing = s.tabs.filter((t) => t.url && !keys.includes(t.id)).map((t) => t.id);
    if (missing.length) throw new Error(`tabs missing from the strip: ${missing}`);
    return { rev: tx.rev, strips: tx.strips.length, tabs: keys.length, active: strip.tabs.find((t) => t.active)?.key };
  });

  await check("tab-switch", async () => {
    const s = await state();
    const other = s.tabs.find((x) => x.id !== first.id && x.url);
    await evalApp(`nn.actions.switchToTab("${other.id}"); return true`);
    await until("switched", async () => (await state()).active === other.id);
    const back = await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("switched back", async () => (await state()).active === first.id);
    return { to: other.id, back };
  });

  await check("cmd-t-cmd-w", async () => {
    const s = await state();
    const before = s.tabs.length;
    const t = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "t", keyCode: 17, modifiers: ["command"], focus: "page" })`);
    log("  ⌘T:", JSON.stringify(t));
    const afterT = await until("a new tab (⌘T)", async () => {
      const n = await state();
      return n.tabs.length > before || n.active !== s.active ? n : null;
    });
    const w = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "w", keyCode: 13, modifiers: ["command"], focus: "window" })`);
    await sleep(800);
    const afterW = await state();
    return { t, w, tabs: [before, afterT.tabs.length, afterW.tabs.length] };
  });

  await check("cmd-l-from-page", async () => {
    const s = await state();
    const r = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "l", keyCode: 37, modifiers: ["command"], focus: "page" })`);
    if (!r.fired?.some((f) => f.command === "focusCommandBar")) throw new Error(`⌘L didn't reach the menu: ${JSON.stringify(r)}`);
    return { handledBy: r.handledBy, fired: r.fired.map((f) => f.command) };
  });

  await check("tab-keys-from-page", async () => {
    const s = await state();
    // ⌃Tab opens the tab switcher (it switches when ⌃ is released); ⌘⇧] goes to the next tab at once.
    const ctrlTab = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "\t", keyCode: 48, modifiers: ["control"], focus: "page" })`);
    if (!ctrlTab.fired?.some((f) => f.command === "tabSwitcher")) throw new Error(`⌃Tab: ${JSON.stringify(ctrlTab)}`);
    await evalApp(`nn.runCommand?.("escape"); return true`).catch(() => {});
    const next = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "}", keyCode: 30, modifiers: ["command", "shift"], focus: "page" })`);
    const after = await until("the next tab", async () => {
      const n = await state();
      return n.active !== s.active ? n : null;
    }, 5000);
    return { ctrlTab: ctrlTab.fired.map((f) => f.command), next: (next.fired ?? []).map((f) => f.command), from: s.active, to: after.active };
  });

  await check("window-close", async () => {
    const e = (await state()).tabs.find((x) => x.url?.startsWith(`${base}/e`));
    if (!e) throw new Error("no window.open tab to close");
    const t = await pageTarget(`${base}/e`);
    await cdp(t, "Runtime.evaluate", { expression: "window.close()", userGesture: true });
    await until("the tab gone from the store", async () => !(await state()).tabs.some((x) => x.id === e.id));
    return { closed: e.id };
  });


  await check("status-text", async () => {
    // Hovering a link shows its URL (Chrome's UpdateTargetURL → onStatus → the status bubble's state).
    const t = await pageFor(first.id, `${base}/a`);
    const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true });
    const box = JSON.parse(r.result.value);
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 3, y: box.y + box.height / 2 });
    const status = await until("a status", async () => (await evalApp(`return nn.pageState.getState().pages["${first.id}"]?.status ?? ""`)) || null, 8000);
    return { status };
  });

  await check("load-error", async () => {
    await evalApp(`nn.store.getState().navigate("${first.id}", "http://127.0.0.1:9/nothing", { userInitiated: true }); return true`);
    const e = await until("onLoadError", async () => (await eventsOf(first.id)).find((x) => x.name === "loadError"), 10000);
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    return { loadError: e.payload };
  });

  await check("context-menu-search", async () => {
    // Chrome's own page menu, with the app's "Search <engine> for …" after Copy (background mode reports it
    // instead of showing it).
    await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setSearchEngineName("Acceptance").then(() => true)`);
    // A page on screen: Chrome doesn't run a hidden tab's context menu.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    await sleep(300);
    let t = await pageFor(first.id, `${base}/a`);
    const rightClick = async () => {
    const r = await cdp(t, "Runtime.evaluate", {
      expression: `(() => { const el = document.getElementById('next'); const range = document.createRange(); range.selectNodeContents(el);
        getSelection().removeAllRanges(); getSelection().addRange(range); return JSON.stringify(el.getBoundingClientRect()); })()`,
      returnByValue: true,
    });
    const box = JSON.parse(r.result.value);
    const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
    let e = null;
    for (let attempt = 0; attempt < 3 && !e; attempt++) {
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
      e = await until("a context menu", async () => (await eventsOf(first.id)).findLast((x) => x.name === "contextMenu"), 4000).catch(() => null);
    }
    return e;
    };
    let e = await rightClick();
    if (!e) {
      // Once more on a freshly loaded page (seen flaky in long runs only).
      log("  context menu: none after 3 right-clicks; reloading the page and trying again");
      await evalApp(`return nn.webviews.get("${first.id}").reload()`);
      await sleep(1500);
      t = await pageFor(first.id, `${base}/a`);
      e = await rightClick();
    }
    if (!e) {
      const vis = (await cdp(t, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
      throw new Error(`no context menu reported (page ${vis}); events: ${JSON.stringify((await eventsOf(first.id)).slice(-6).map((x) => x.name))}`);
    }
    const selection = !!(await eventsOf(first.id)).findLast((x) => x.name === "pageMessage" && x.payload?.kind === "selection");
    const labels = e.payload.items.filter((i) => !i.separator).map((i) => i.label);
    const search = labels.filter((l) => /^Search .* for /.test(l));
    if (!search.some((l) => l.startsWith("Search Acceptance for “to B”"))) throw new Error(`no app search item: ${JSON.stringify(labels)}`);
    await cdp(t, "Runtime.evaluate", { expression: "getSelection().removeAllRanges()" });
    return { items: labels.length, search, selectionMessage: selection };
  });

  await check("duplicate-and-reopen", async () => {
    // Duplicate copies the tab's back/forward list (clone:), and ⇧⌘T brings a closed tab back with its own list
    // (restore:, through Chrome's TabRestoreService entry tagged with the tab's id).
    const copyId = await evalApp(`const c = nn.store.getState().duplicateTab("${first.id}"); return typeof c === "string" ? c : c?.id ?? null`);
    if (!copyId) throw new Error("no copy");
    await until("the copy on A with history", async () => (await state()).tabs.find((t) => t.id === copyId && t.title === "Page A" && t.back && !t.loading), 15000);
    await evalApp(`nn.store.getState().closeTab("${copyId}"); return true`);
    await until("the copy closed", async () => !(await state()).tabs.some((t) => t.id === copyId));
    await sleep(500);
    const before = new Set((await state()).tabs.map((t) => t.id));
    await evalApp(`nn.store.getState().reopenClosedTab(${JSON.stringify(mainWindow)}); return true`);
    const back = await until("the reopened tab with history", async () => {
      const s = await state();
      return s.tabs.find((t) => !before.has(t.id) && t.title === "Page A" && t.back && !t.loading);
    }, 15000);
    await evalApp(`nn.store.getState().closeTab("${back.id}"); return true`);
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("first tab active", async () => (await state()).active === first.id);
    return { copy: copyId, reopened: back.id };
  });

  await check("device-chooser", async () => {
    // WebUSB requestDevice: Chrome's chooser comes to the app's sheet (onDeviceChooser); cancelling it rejects
    // the page's promise with NotFoundError.
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      expression: "window.__usb = 'pending'; navigator.usb.requestDevice({ filters: [] }).then(() => (window.__usb = 'picked'), (e) => (window.__usb = e.name))",
      userGesture: true,
    });
    const chooser = await until("the app's chooser", async () => {
      const c = await evalApp(`return globalThis.nnDeviceChoosers?.useChoosers.getState().byTab["${first.id}"] ?? null`);
      if (c) return c;
      const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__usb)", returnByValue: true });
      if (r.result.value !== "pending") throw new Error(`no chooser; the page got ${r.result.value}`);
      return null;
    }, 10000);
    await evalApp(`return globalThis.nnDeviceChoosers.cancelDeviceChooser(${chooser.id}).then(() => true)`);
    const result = await until("the page's answer", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "window.__usb", returnByValue: true });
      return r.result.value !== "pending" ? r.result.value : null;
    }, 8000);
    await until("the sheet gone", async () => !(await evalApp(`return globalThis.nnDeviceChoosers.useChoosers.getState().byTab["${first.id}"] ?? null`)), 5000);
    if (result !== "NotFoundError") throw new Error(`page got ${result}`);
    return { chooser: { id: chooser.id, title: chooser.title, options: chooser.options?.length }, page: result };
  });

  await check("cast-dialog", async () => {
    // Chrome's Cast dialog for the tab comes to the app's popover (onCastDialog), the profile's routes to
    // onCastRoutes, and closing it from the app closes Chrome's.
    const browser = await browserOf(first.id);
    const shown = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.showCastDialog(${browser})`);
    if (!shown) throw new Error("showCastDialog said no (media router off?)");
    const dialog = await until("the app's Cast dialog", async () => evalApp(`return globalThis.nnCast?.useCast.getState().dialogs["${first.id}"] ?? null`), 10000);
    const routes = await evalApp(`return globalThis.nnCast.useCast.getState().routes`);
    await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.closeCastDialog(${dialog.id}).then(() => true)`);
    await until("the dialog closed", async () => !(await evalApp(`return globalThis.nnCast.useCast.getState().dialogs["${first.id}"] ?? null`)), 5000);
    return { header: dialog.header, sinks: dialog.sinks?.length ?? 0, routeProfiles: Object.keys(routes ?? {}) };
  });

  // A tab of the main window at `url`, loaded; foreground or behind.
  const openTab = async (url, title, background = false) => {
    const before = new Set((await state()).tabs.map((t) => t.id));
    await evalApp(`nn.actions.openUrls([${JSON.stringify(url)}], ${JSON.stringify(mainWindow)}); return true`);
    const tab = await until(`a tab for ${url}`, async () => (await state()).tabs.find((t) => !before.has(t.id) && t.title === title && !t.loading), 15000);
    if (background) {
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
      await until("A shown", async () => (await state()).active === first.id);
    }
    return tab;
  };
  const closeTab = (id) => evalApp(`nn.store.getState().closeTab("${id}"); return true`);
  const backToA = async () => {
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
  };

  await check("user-selection", async () => {
    // A mouse selection of page text: the page script reports it (onPageMessage "selection").
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/text", { userInitiated: true }); return true`);
    await until("the text page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Text" && !t.loading));
    try {
      const t = await pageFor(first.id, `${base}/text`);
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('t').getBoundingClientRect())", returnByValue: true });
      const box = JSON.parse(r.result.value);
      const y = box.y + box.height / 2;
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + 2, y, button: "left", buttons: 1, clickCount: 1 });
      for (let k = 1; k <= 8; k++)
        await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 2 + ((box.width - 10) * k) / 8, y, button: "left", buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + box.width - 8, y, button: "left", buttons: 0, clickCount: 1 });
      const e = await until("onPageMessage selection", async () =>
        (await eventsOf(first.id)).findLast((x) => x.name === "pageMessage" && x.payload?.kind === "selection" && x.payload?.data), 6000);
      return { text: String(JSON.stringify(e.payload.data)).slice(0, 80) };
    } finally {
      await backToA();
    }
  });

  await check("password-prompt", async () => {
    // A sign-in form submitted with typed values: Chrome's password manager offers to save (onPasswordPrompt), and
    // the app's answer saves it (resolvePasswordPrompt).
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/login", { userInitiated: true }); return true`);
    await until("the login page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Login" && !t.loading));
    try {
      const t = await pageFor(first.id, `${base}/login`);
      for (const [field, text] of [["u", "nnformuser"], ["p", "form-s3cret"]]) {
        await cdp(t, "Runtime.evaluate", { expression: `document.getElementById('${field}').focus()` });
        await cdp(t, "Input.insertText", { text });
      }
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('go').getBoundingClientRect())", returnByValue: true });
      const box = JSON.parse(r.result.value);
      const at = { x: box.x + box.width / 2, y: box.y + box.height / 2, button: "left", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
      const e = await until("onPasswordPrompt", async () => (await eventsOf(first.id)).findLast((x) => x.name === "passwordPrompt"), 10000);
      await evalApp(`return nn.webviews.get("${first.id}").resolvePasswordPrompt("save")`);
      const saved = await until("the saved login", async () => {
        const list = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.listPasswords("")`);
        return list.passwords?.find((x) => x.username === "nnformuser") ?? null;
      }, 10000);
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.deletePassword("", ${JSON.stringify(saved.origin)}, "nnformuser")`);
      return { prompt: e.payload.kind ?? e.payload.type ?? Object.keys(e.payload), origin: saved.origin };
    } finally {
      await backToA();
    }
  });

  await check("screen-share-picker", async () => {
    // getDisplayMedia through the app's source picker (setDisplayMediaPicker, as the app sets it): the request reaches
    // the app (onDisplayMediaRequest, with displayMediaSources' list), the app picks another tab (its
    // mediaCaptureSourceId), and the engine grants that source to the page (resolveDisplayMedia): the page captures it.
    const target = await openTab(`${base}/capture-target?picker`, "Capture Target", true);
    const t = await pageFor(first.id, `${base}/a`);
    try {
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setDisplayMediaPicker(true).then(() => true)`);
      await evalApp(`return nn.webviews.get("${first.id}").reload()`);
      await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
      await sleep(500);
      const page = await pageFor(first.id, `${base}/a`);
      await cdp(page, "Runtime.evaluate", {
        expression: "window.__cap = 'pending'; navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { window.__stream = s; window.__cap = 'live'; }, (e) => (window.__cap = e.name)); true",
        userGesture: true,
      });
      const request = await until("onDisplayMediaRequest", async () => (await eventsOf(first.id)).findLast((x) => x.name === "displayMediaRequest"), 10000);
      const sourceId = await evalApp(`return nn.webviews.get("${target.id}").mediaCaptureSourceId()`);
      if (!sourceId) throw new Error("no capture source id for the target tab");
      // As the app's picker answers (it closes the sheet too).
      await evalApp(`globalThis.nnSharePicker.answerDisplayMedia("${first.id}", ${JSON.stringify(sourceId)}); return true`);
      const live = await until("a live capture", async () => {
        const v = (await cdp(page, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value;
        if (v !== "pending" && v !== "live") throw new Error(`getDisplayMedia: ${v}`);
        return v === "live" ? v : null;
      }, 15000);
      await cdp(page, "Runtime.evaluate", { expression: "window.__stream?.getTracks().forEach((x) => x.stop()); true" });
      return { sources: Array.isArray(request.payload.sources) ? request.payload.sources.length : request.payload.sources, sourceId: String(sourceId).slice(0, 40), live };
    } finally {
      await closeTab(target.id);
    }
  });

  await check("tab-capture", async () => {
    // Chrome's own picker (the app's turned off; the test switch picks the tab titled "Capture Target"): the capturing
    // tab's media access (onMediaAccess), "Share this tab instead" (changeCaptureSource) and Stop sharing
    // (stopCapture, which ends the page's track).
    const target = await openTab(`${base}/capture-target`, "Capture Target", true);
    const other = await openTab(`${base}/d?share-instead`, "Page D", true);
    await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setDisplayMediaPicker(false).then(() => true)`);
    await evalApp(`return nn.webviews.get("${first.id}").reload()`);
    await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
    await sleep(500);
    const t = await pageFor(first.id, `${base}/a`);
    try {
      await cdp(t, "Runtime.evaluate", {
        expression: "window.__cap = 'pending'; navigator.mediaDevices.getDisplayMedia({ video: true }).then((s) => { window.__stream = s; s.getVideoTracks()[0].onended = () => (window.__cap = 'ended'); window.__cap = 'live'; }, (e) => (window.__cap = e.name)); true",
        userGesture: true,
      });
      const live = await until("a live capture", async () => {
        const v = (await cdp(t, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value;
        if (v !== "pending" && v !== "live") throw new Error(`getDisplayMedia: ${v}`);
        return v === "live" ? v : null;
      }, 15000);
      const access = await until("onMediaAccess", async () => {
        for (const id of [first.id, target.id]) {
          const e = (await eventsOf(id)).findLast((x) => x.name === "mediaAccess");
          if (e) return { tab: id === first.id ? "capturer" : "captured", access: e.payload };
        }
        return null;
      }, 8000);
      const sourceId = await evalApp(`return nn.webviews.get("${target.id}")?.mediaCaptureSourceId() ?? null`);
      const capturer = await browserOf(first.id);
      const instead = await browserOf(other.id);
      const changed = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.changeCaptureSource(${capturer}, ${instead})`);
      if (changed !== true) throw new Error(`changeCaptureSource answered ${changed}`);
      await sleep(1000);
      const stopped = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.stopCapture(${capturer})`);
      const ended = await until("the track ended", async () =>
        (await cdp(t, "Runtime.evaluate", { expression: "window.__cap", returnByValue: true })).result.value === "ended" ? true : null, 8000);
      return { live, access, sourceId: sourceId ? String(sourceId).slice(0, 40) : null, changed, stopped, ended };
    } finally {
      await cdp(t, "Runtime.evaluate", { expression: "window.__stream?.getTracks().forEach((x) => x.stop())" }).catch(() => null);
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setDisplayMediaPicker(true).then(() => true)`);
      await closeTab(target.id);
      await closeTab(other.id);
      await evalApp(`return nn.webviews.get("${first.id}").reload()`);
      await until("A loaded", async () => (await state()).tabs.find((x) => x.id === first.id && x.title === "Page A" && !x.loading), 10000);
    }
  });

  await check("capture-picture", async () => {
    // The page as painted (capturePicture, the dragged tab's picture): a JPEG and the view's frame.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const picture = await evalApp(`return nn.webviews.get("${first.id}").capturePicture(0.3)`);
    if (!picture?.data || !Buffer.from(picture.data, "base64").subarray(0, 2).equals(Buffer.from([0xff, 0xd8])))
      throw new Error(`no JPEG: ${JSON.stringify(picture)?.slice(0, 120)}`);
    return { bytes: Buffer.from(picture.data, "base64").length, frame: picture.frame };
  });

  await check("unresponsive", async () => {
    // A page that stops answering: Chrome's hang monitor (onUnresponsive), the app's "wait" (resolveUnresponsive),
    // and the page answering again (onResponsive).
    const busy = await openTab(`${base}/b?busy`, "Page B");
    try {
      // No DevTools client on the page meanwhile: Chrome ignores a hang while a debugger is attached.
      await evalApp(`return nn.webviews.get("${busy.id}").focus()`);
      await evalApp(`return nn.webviews.get("${busy.id}").executeJavaScript("setTimeout(() => { const end = Date.now() + 40000; while (Date.now() < end); }, 50)")`);
      await sleep(800);
      const s = await state();
      // Input the busy page can't answer: Chrome's hang monitor starts with it.
      const sent = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "a", keyCode: 0, modifiers: [], focus: "page" })`);
      const busyNow = "-";
      const hung = await until("onUnresponsive", async () => (await eventsOf(busy.id)).find((x) => x.name === "unresponsive"), 35000)
        .catch(async (e) => { throw new Error(`${e.message}; page ${busyNow}; key ${JSON.stringify(sent)}; events ${JSON.stringify((await eventsOf(busy.id)).map((x) => x.name).slice(-8))}; active ${(await state()).active === busy.id}`); });
      await evalApp(`return nn.webviews.get("${busy.id}").resolveUnresponsive(false)`);
      const back = await until("onResponsive", async () => (await eventsOf(busy.id)).find((x) => x.name === "responsive"), 45000)
        .catch(async (e) => { throw new Error(`${e.message}; events ${JSON.stringify((await eventsOf(busy.id)).map((x) => x.name).slice(-10))}`); });
      return { unresponsive: !!hung, responsive: !!back };
    } finally {
      await closeTab(busy.id);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("permission-dismissed", async () => {
    // A prompt Chrome drops on its own (its tab closes before the app answers): the app hears so
    // (onPermissionDismissed). A navigation doesn't show it: the app answers "dismiss" itself then.
    await evalApp(`globalThis.__nnDismissed = []; globalThis.__nnDismissSub?.remove(); globalThis.__nnDismissSub = globalThis.expo.modules.NetnyahooCEF.addListener("onPermissionDismissed", (e) => globalThis.__nnDismissed.push(e)); return true`);
    const asker = await openTab(`${base}/c?asker`, "Page C");
    try {
      const t = await pageFor(asker.id, `${base}/c?asker`);
      await cdp(t, "Runtime.evaluate", { expression: "navigator.requestMIDIAccess({ sysex: true }).catch(() => {}); true", userGesture: true });
      const request = await until("the prompt", async () => evalApp(`return nn.pageState.getState().pages["${asker.id}"]?.permission ?? null`), 10000);
      await closeTab(asker.id);
      const dismissed = await until("onPermissionDismissed", async () => {
        const list = await evalApp(`return globalThis.__nnDismissed`);
        return list.find((x) => x.id === request.id) ?? null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; request ${request.id}; got ${JSON.stringify(await evalApp(`return globalThis.__nnDismissed`))}`); });
      return { request: request.id, dismissed };
    } finally {
      await evalApp(`globalThis.__nnDismissSub?.remove(); return true`);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("kill-task", async () => {
    // Chrome's task manager ends a tab's renderer (killTask): the tab shows its crash (onCrashed).
    const victim = await openTab(`${base}/c?kill`, "Page C", true);
    try {
      const browser = Number(await browserOf(victim.id));
      const task = await until("the tab's task", async () => {
        const tasks = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.listTasks()`);
        return tasks.find((x) => (x.browserIds ?? []).includes(browser)) ?? null;
      }, 10000);
      const killed = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.killTask(${task.id})`);
      const crashed = await until("onCrashed", async () => (await eventsOf(victim.id)).find((x) => x.name === "crashed"), 10000);
      return { task: task.title ?? task.id, killed, crashed: crashed.payload.reason };
    } finally {
      await closeTab(victim.id);
    }
  });

  await check("module-events", async () => {
    // Events with no WebView: the blocker's state (onContentBlocker), extensions changing (onChanged); and the
    // screen-share picker's sources (displayMediaSources: screens and windows, no macOS prompt).
    await evalApp(`globalThis.__nnEvents = []; globalThis.__nnSubs?.forEach((x) => x.remove());
      globalThis.__nnSubs = [globalThis.expo.modules.NetnyahooCEF.addListener("onContentBlocker", (e) => globalThis.__nnEvents.push(["blocker", e])),
        globalThis.expo.modules.NetnyahooExtensions.addListener("onChanged", (e) => globalThis.__nnEvents.push(["extensions", e]))]; return true`);
    try {
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setContentBlockerEnabled(false)`);
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.setContentBlockerEnabled(true)`);
      const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
      const configured = await exts(`configure("${installed.id}", "", { incognito: true })`);
      if (configured?.error) throw new Error(`configure: ${configured.error}`);
      await exts(`uninstall("${installed.id}", "")`);
      const events = await until("both events", async () => {
        const list = await evalApp(`return globalThis.__nnEvents`);
        return list.some((x) => x[0] === "blocker") && list.filter((x) => x[0] === "extensions").length >= 2 ? list : null;
      }, 15000).catch(async (e) => { throw new Error(`${e.message}; got ${JSON.stringify(await evalApp(`return globalThis.__nnEvents`)).slice(0, 300)}`); });
      const sources = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.displayMediaSources()`);
      if (!sources.some((x) => x.kind === "screen")) throw new Error("no screen among the display media sources");
      return { blocker: events.filter((x) => x[0] === "blocker").length, extensions: events.filter((x) => x[0] === "extensions").map((x) => x[1].event), configured: true, sources: sources.length };
    } finally {
      await evalApp(`globalThis.__nnSubs?.forEach((x) => x.remove()); return true`);
    }
  });

  await check("save-page", async () => {
    // Chrome's Save Page As (runPageCommand "savePage"), its save panel answered from file-chooser.txt.
    const file = join(scratch, "saved-page.html");
    writeFileSync(join(data, "file-chooser.txt"), file + "\n");
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`return nn.webviews.get("${first.id}").runPageCommand("savePage")`);
    const saved = await until("the saved page", async () => existsSync(file) && readFileSync(file, "utf8").includes("Page A"), 15000);
    return { saved };
  });

  await check("activate-request", async () => {
    // A page focusing the popup it opened (window.focus() on it) while the app shows the opener: Chrome asks the app
    // to bring the popup forward (onActivateRequest "page").
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    const t = await pageFor(first.id, `${base}/a`);
    const before = new Set((await state()).tabs.map((x) => x.id));
    await cdp(t, "Runtime.evaluate", { expression: `window.__popup = window.open("${base}/c?focus-me", "_blank"); true`, userGesture: true });
    const popup = await until("the popup", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Page C" && !x.loading), 10000);
    try {
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
      await until("A shown", async () => (await state()).active === first.id);
      await cdp(t, "Runtime.evaluate", { expression: "window.__popup.focus(); true", userGesture: true });
      const e = await until("onActivateRequest", async () => (await eventsOf(popup.id)).findLast((x) => x.name === "activateRequest"), 8000)
        .catch(async (err) => { throw new Error(`${err.message}; popup events ${JSON.stringify((await eventsOf(popup.id)).map((x) => x.name).slice(-8))}`); });
      return { reason: e.payload.reason };
    } finally {
      await closeTab(popup.id);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("private-release", async () => {
    // A private window's profile goes when its last window closes (releaseProfile): a new private window starts
    // without the old one's cookies.
    const a = await evalApp(`return nn.actions.openWindow({ incognito: true, url: "${base}/cookie?private1" })`);
    await until("the private cookie set", async () => {
      const tabs = await evalApp(`const s = nn.store.getState(); return (s.windows["${a}"]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
      return tabs.includes("Cookie") ? true : null;
    }, 10000);
    await sleep(500);
    await evalApp(`nn.store.getState().closeWindow("${a}"); return true`);
    await sleep(2000);
    const b = await evalApp(`return nn.actions.openWindow({ incognito: true, url: "${base}/b?private2" })`);
    try {
      await until("the second private window's page", async () => {
        const tabs = await evalApp(`const s = nn.store.getState(); return (s.windows["${b}"]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
        return tabs.includes("Page B") ? true : null;
      }, 10000);
      const pt = await pageTarget(`${base}/b?private2`);
      const cookie = (await cdp(pt, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      if (cookie.includes("private1")) throw new Error(`the first private window's cookie survived: ${cookie}`);
      return { cookie: cookie || "(none)" };
    } finally {
      await evalApp(`nn.store.getState().closeWindow("${b}"); return true`);
    }
  });

  await check("extension-popup-and-panel", async () => {
    // The extension's action (executeExtensionAction) opens its popup, and its side panel opens beside the page:
    // both are standalone WebViews, whose tabs stay out of the window's tab strip and close with them.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const windowsBefore = (await cef(`chromeWindows()`)).length;
    try {
      await evalApp(`return nn.extensions.refreshExtensions("").then(() => true)`);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
      await evalApp(`const lists = nn.extensions.useExtensions.getState().lists; const ext = Object.values(lists).flat().find((x) => x.id === "${installed.id}");
        return nn.extensions.activateExtension(${JSON.stringify(mainWindow)}, ext, { x: 100, y: 40, width: 20, height: 20 }).then(() => !!nn.extensions.useExtensions.getState().popup)`);
      const popupTarget = await until("the popup page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/popup.html`)), 10000);
      const strips = await cef(`tabStrips()`);
      const inStrip = strips.strips.some((st) => st.tabs.some((x) => x.key == null));
      const popupVisible = (await cdp(popupTarget, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
      await evalApp(`nn.extensions.closeExtensionPopup(); return true`);
      await until("the popup gone", async () => !(await targets()).some((t) => t.url.includes(`${installed.id}/popup.html`)), 8000);
      await evalApp(`return nn.extensions.openSidePanel(${JSON.stringify(mainWindow)}, "${installed.id}").then(() => !!nn.extensions.useExtensions.getState().sidePanels[${JSON.stringify(mainWindow)}])`);
      const panelTarget = await until("the side panel page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/panel.html`)), 10000);
      const panelVisible = (await cdp(panelTarget, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })).result.value;
      const stripsWithPanel = await cef(`tabStrips()`);
      const panelInStrip = stripsWithPanel.strips.some((st) => st.tabs.length !== strips.strips.find((x) => x.strip === st.strip)?.tabs.length);
      await evalApp(`nn.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`);
      await until("the panel gone", async () => !(await targets()).some((t) => t.url.includes(`${installed.id}/panel.html`)), 8000);
      const windowsAfter = await until("the standalone window closed", async () => {
        const n = (await cef(`chromeWindows()`)).length;
        return n <= windowsBefore ? n : null;
      }, 8000).catch(async () => (await cef(`chromeWindows()`)).length);
      if (inStrip || panelInStrip) throw new Error("a standalone WebView's tab is in the window's strip");
      if (popupVisible !== "visible" || panelVisible !== "visible") throw new Error(`popup ${popupVisible}, panel ${panelVisible}`);
      return { popup: popupVisible, panel: panelVisible, windowsBefore, windowsAfter };
    } finally {
      await evalApp(`nn.extensions.closeExtensionPopup(); nn.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`);
    }
  });

  await check("scroll-zoom", async () => {
    // ⌘-scroll zooms the page with a wheel or a Magic Mouse and scrolls it with a trackpad (devScrollZoom, as
    // packages/cef's zoom-scroll-test).
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const zoom = () => evalApp(`return nn.store.getState().tabs["${first.id}"]?.zoom ?? 1`);
    const reset = async () => {
      await evalApp(`return nn.webviews.get("${first.id}").zoomStep(0)`);
      await until("zoom 100%", async () => ((await zoom()) === 1 ? true : null), 5000);
    };
    const scroll = (steps) => evalApp(`return globalThis.expo.modules.NetnyahooCEF.devScrollZoom(${JSON.stringify(steps)})`);
    const gesture = (trackpad) => [
      { phase: "mayBegin", dy: 0, trackpad }, { phase: "began", dy: 12, trackpad },
      ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
      { phase: "ended", dy: 0, trackpad }, ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
    ];
    await reset();
    const trackpad = await scroll(gesture(true));
    await sleep(800);
    const afterTrackpad = await zoom();
    const wheel = await scroll([{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }]);
    const afterWheel = await until("zoomed", async () => { const z = await zoom(); return z > 1 ? z : null; }, 5000)
      .catch(async (e) => { throw new Error(`${e.message}; trackpad ${JSON.stringify(trackpad)} wheel ${JSON.stringify(wheel)} zoom ${await zoom()} events ${JSON.stringify((await eventsOf(first.id)).filter((x) => x.name === "zoom").slice(-2))}`); });
    await reset();
    if (trackpad.some(Boolean) || afterTrackpad !== 1) throw new Error(`a trackpad ⌘-scroll zoomed: ${JSON.stringify(trackpad)} → ${afterTrackpad}`);
    if (!wheel.some(Boolean)) throw new Error(`the wheel didn't zoom: ${JSON.stringify(wheel)}`);
    return { trackpad, wheel, afterWheel };
  });

  await check("print-preview", async () => {
    // Print (WebViewHandle.print): Chrome's print preview for the page; closed again.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`return nn.webviews.get("${first.id}").print()`);
    const preview = await until("the print preview", async () => (await targets()).find((t) => t.url.startsWith("chrome://print")), 15000);
    // Chrome closes a print preview when its page navigates.
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a?after-print", { userInitiated: true }); return true`);
    await until("the preview closed", async () => !(await targets()).some((t) => t.url.startsWith("chrome://print")), 10000);
    await backToA();
    return { preview: preview.url };
  });

  await check("extension-prompts", async () => {
    // An extension asking for an optional permission: Chrome's install prompt goes to the app's dialog
    // (onInstallPrompt), and the app's answer grants it (resolveInstallPrompt). Its action opening its side panel
    // (chrome.sidePanel.open from the action's click): the app shows the panel (onSidePanel).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    try {
      await evalApp(`return nn.extensions.refreshExtensions("").then(() => true)`);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
      const activate = () => evalApp(`const lists = nn.extensions.useExtensions.getState().lists; const ext = Object.values(lists).flat().find((x) => x.id === "${installed.id}");
        return nn.extensions.activateExtension(${JSON.stringify(mainWindow)}, ext, { x: 100, y: 40, width: 20, height: 20 }).then(() => true)`);
      await activate();
      const popup = await until("the popup page", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/popup.html`)), 10000);
      // Not granted yet (an earlier install of the same extension may have it): Chrome asks again.
      await cdp(popup, "Runtime.evaluate", { expression: "chrome.permissions.remove({ permissions: ['bookmarks'] }).then(() => true)", awaitPromise: true });
      await cdp(popup, "Runtime.evaluate", { expression: "window.__perm = 'pending'; chrome.permissions.request({ permissions: ['bookmarks'] }).then((g) => (window.__perm = String(g)), (e) => (window.__perm = String(e))); true", userGesture: true });
      const request = await until("the app's install dialog", async () => evalApp(`return nn.extensions.useExtensions.getState().install ?? null`), 10000);
      const requestId = request.requestId ?? request.prompt?.requestId ?? request.request?.requestId;
      await exts(`resolveInstallPrompt(${JSON.stringify(requestId)}, true)`);
      const granted = await until("the page's answer", async () => {
        const v = (await cdp(popup, "Runtime.evaluate", { expression: "window.__perm", returnByValue: true })).result.value;
        return v !== "pending" ? v : null;
      }, 10000);
      if (granted !== "true") throw new Error(`permissions.request answered ${granted}`);
      await evalApp(`nn.extensions.closeExtensionPopup(); return true`);
      // The action's click opens the side panel instead of a popup.
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.sidePanel?.open", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      await cdp(worker, "Runtime.evaluate", { expression: "chrome.action.setPopup({ popup: '' }); chrome.action.onClicked.addListener((tab) => chrome.sidePanel.open({ tabId: tab.id })); true" });
      await sleep(300);
      await activate();
      const panel = await until("the side panel", async () => (await targets()).find((t) => t.type === "page" && t.url.includes(`${installed.id}/panel.html`)), 10000);
      const shown = await evalApp(`return !!nn.extensions.useExtensions.getState().sidePanels[${JSON.stringify(mainWindow)}]`);
      return { prompt: request.type ?? request.prompt?.type ?? Object.keys(request), granted, panel: !!panel, shown };
    } finally {
      await evalApp(`nn.extensions.closeExtensionPopup(); nn.extensions.closeSidePanel(${JSON.stringify(mainWindow)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`);
    }
  });

  await check("crash", async () => {
    // A renderer crash reaches the app (onCrashed → the sad tab), and the app keeps running.
    await evalApp(`nn.actions.openUrls(["${base}/crash-me"], ${JSON.stringify(mainWindow)}); return true`);
    const tab = await until("the tab to crash", async () => (await state()).tabs.find((x) => x.url?.includes("crash-me") && !x.loading));
    const t = await pageTarget("crash-me");
    await cdp(t, "Page.crash").catch(() => null);
    const crashed = await until("onCrashed", async () => evalApp(`return nn.pageState.getState().pages["${tab.id}"]?.crashed ?? null`), 10000);
    return { crashed };
  });

  await check("traffic-lights-after-profile-switch", async () => {
    const s = await state();
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindowNumber(${browser})`);
    const lights = () => evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${windowNumber}, "lights")`);
    const before = await lights();
    const id = await evalApp(`return nn.store.getState().createProfile({ name: "Lights" })`);
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${id}"); return true`);
    await until("profile shown", async () => (await state()).profileId === id);
    await sleep(500);
    const during = await lights();
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${s.profileId}"); return true`);
    await until("profile back", async () => (await state()).profileId === s.profileId);
    await sleep(500);
    const after = await lights();
    if (during !== before || after !== before) throw new Error(`lights moved: ${before} → ${during} → ${after}`);
    return { lights: before };
  });


  await check("passwords", async () => {
    // Chrome's password store through //chrome/browser/netnyahoo (nn_passwords_*).
    const origin = "https://example.test";
    const saved = await cef(`savePassword("", "${origin}", "nnuser", "s3cret")`);
    if (saved?.error) throw new Error(saved.error);
    const list = await until("the saved login", async () => {
      const r = await cef(`listPasswords("")`);
      return r.passwords?.find((p) => p.username === "nnuser") ? r : null;
    });
    const revealed = await cef(`getPassword("", "${origin}", "nnuser")`);
    await cef(`deletePassword("", "${origin}", "nnuser")`);
    const after = await cef(`listPasswords("")`);
    if (after.passwords?.some((p) => p.username === "nnuser")) throw new Error("not deleted");
    const autofill = await cef(`getPasswordAutofill("")`);
    await cef(`setPasswordAutofill("", false)`);
    const off = await cef(`getPasswordAutofill("")`);
    await cef(`setPasswordAutofill("", true)`);
    return { listed: list.passwords.length, revealed: revealed?.password ?? revealed, autofill, off };
  });

  await check("autofill", async () => {
    const saved = await cef(`saveAddress("", { fullName: "Big Yahu", city: "Tel Aviv", country: "IL" })`);
    if (saved?.error) throw new Error(saved.error);
    const list = await until("the address", async () => {
      const r = await cef(`listAddresses("")`);
      return r.addresses?.length ? r : null;
    });
    const id = list.addresses[0].id;
    await cef(`deleteAutofillEntry("", "${id}")`);
    const settings = await cef(`getAutofillSettings("")`);
    return { addresses: list.addresses.length, first: list.addresses[0].fullName ?? list.addresses[0].name, settings };
  });

  await check("zoom-levels", async () => {
    await cef(`setZoom("", "zoom.test", 1.5)`);
    const levels = await until("the zoom level", async () => {
      const l = await cef(`getZoomLevels("")`);
      return l["zoom.test"] ? l : null;
    });
    await cef(`setZoom("", "zoom.test", 1)`);
    return { levels };
  });

  await check("extensions", async () => {
    const inspected = await exts(`inspectUnpacked(${JSON.stringify(extPath)})`);
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const list = await until("the extension listed", async () => {
      const r = await exts(`list("")`);
      return r.extensions?.find((e) => e.id === installed.id) ? r : null;
    });
    await exts(`setEnabled("${installed.id}", "", false)`);
    await exts(`uninstall("${installed.id}", "")`);
    const engines = await exts(`searchEngineList("")`);
    return { id: installed.id, name: inspected.name, listed: list.extensions.length, engines: !!engines.list };
  });

  await check("extension-configure", async () => {
    // What the app's Extensions settings pass to configure (pinned, incognito, siteAccess; fileAccess as CEF's API
    // takes it) lands in Chrome: list reads each back, onChanged says "configured", and site access "on click"
    // stops the extension's content script on a fresh page until "on all sites" lets it run again.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const id = installed.id;
    const info = async () => (await exts(`list("")`)).extensions?.find((e) => e.id === id) ?? null;
    const configure = async (options) => {
      const r = await exts(`configure("${id}", "", ${JSON.stringify(options)})`);
      if (r?.error) throw new Error(`configure ${JSON.stringify(options)}: ${r.error}`);
    };
    // The content script's mark on a freshly loaded page (it runs at document_idle), or null after a grace period.
    const scriptRan = async (tag) => {
      const tab = await openTab(`${base}/e?cfg-${tag}`, "Page E");
      try {
        const t = await pageFor(tab.id, `/e?cfg-${tag}`);
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "document.documentElement.dataset.nnext ?? null", returnByValue: true });
          if (r.result.value) return r.result.value;
          await sleep(200);
        }
        return null;
      } finally {
        await closeTab(tab.id);
      }
    };
    await evalApp(`globalThis.__nnCfg = []; globalThis.__nnCfgSub?.remove();
      globalThis.__nnCfgSub = globalThis.expo.modules.NetnyahooExtensions.addListener("onChanged", (e) => globalThis.__nnCfg.push(e)); return true`);
    try {
      const before = await until("the extension listed", info);
      if (!before.siteAccess) throw new Error("the fixture has no site access to change");
      if (!(await scriptRan("before"))) throw new Error("the content script didn't run before any change");
      const set = { pinned: !before.pinned, incognito: !before.incognito, fileAccess: !before.fileAccess };
      for (const [key, value] of Object.entries(set)) {
        await configure({ [key]: value });
        await until(`${key} = ${value}`, async () => (await info())?.[key] === value);
      }
      await configure({ siteAccess: "onClick" });
      const onClick = await until("site access on click", async () => {
        const e = await info();
        return e?.siteAccess === "ON_CLICK" ? e : null;
      });
      const ranOnClick = await scriptRan("onclick");
      if (ranOnClick) throw new Error(`the content script ran with site access on click (${ranOnClick})`);
      await configure({ siteAccess: "allSites" });
      const allSites = await until("site access on all sites", async () => {
        const e = await info();
        return e?.siteAccess === "ON_ALL_SITES" ? e : null;
      });
      const ranAgain = await scriptRan("allsites");
      if (!ranAgain) throw new Error("the content script didn't run again on all sites");
      const configured = await until("onChanged configured", async () => {
        const list = await evalApp(`return globalThis.__nnCfg`);
        const mine = list.filter((x) => x.event === "configured" && x.id === id);
        return mine.length >= 5 ? mine : null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; got ${JSON.stringify(await evalApp(`return globalThis.__nnCfg`)).slice(0, 300)}`); });
      // Back as it was (pinning and incognito are profile prefs that would outlive an uninstall-free run).
      await configure({ pinned: before.pinned, incognito: before.incognito, fileAccess: before.fileAccess });
      return {
        set,
        siteAccess: [before.siteAccess, onClick.siteAccess, allSites.siteAccess],
        contentScript: { onClick: ranOnClick, allSites: ranAgain },
        configuredEvents: configured.length,
      };
    } finally {
      await evalApp(`globalThis.__nnCfgSub?.remove(); return true`).catch(() => null);
      await exts(`uninstall("${id}", "")`).catch(() => null);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`).catch(() => null);
    }
  });

  await check("chrome-windows-create", async () => {
    // A window an extension makes (chrome.windows.create): its tab lands in the app's window, live (tab:<id>).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    // The installed copy's worker (an earlier install's target can linger, without the chrome API).
    const worker = await until("the extension's worker", async () => {
      for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
        const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.windows?.create", returnByValue: true }).catch(() => null);
        if (r?.result?.value === "function") return t;
      }
      return null;
    }, 15000);
    const made = await cdp(worker, "Runtime.evaluate", {
      expression: `chrome.windows.create({ url: "${base}/e?window" }).then((w) => JSON.stringify({ id: w.id, tabs: w.tabs?.length }))`,
      awaitPromise: true,
      returnByValue: true,
    });
    log("  chrome.windows.create:", JSON.stringify(made.result?.value ?? made.exceptionDetails?.exception?.description ?? made));
    const tab = await until("the window's tab in the app", async () => {
      const tabs = await evalApp(`const s = nn.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, adoptId: t.adoptId, windowId: t.windowId }))`);
      return tabs.find((t) => t.url?.includes("e?window")) ?? null;
    }, 15000);
    await exts(`uninstall("${installed.id}", "")`);
    return { tab: tab.id, adoptId: tab.adoptId ?? null, window: tab.windowId };
  });

  await check("content-blocker", async () => {
    // The built-in uBlock Origin Lite, loaded as a component extension and driven through its runtime messages.
    const state = await until("the blocker's state", async () => {
      const s = await cef(`getContentBlocker()`);
      return s?.stats?.ready ? s : null;
    }, 30000);
    await cef(`setContentBlockerAllowed("allowed.test", true)`);
    const allowed = await cef(`isContentBlockerAllowed("allowed.test")`);
    await cef(`setContentBlockerAllowed("allowed.test", false)`);
    return { enabled: state.enabled, lists: state.lists.length, version: state.version, allowed };
  });

  await check("download", async () => {
    // Chrome's download manager through //chrome/browser/netnyahoo (nn_downloads_*): the app's list fills in.
    await evalApp(`nn.actions.openUrls(["${base}/file.bin"], ${JSON.stringify(mainWindow)}); return true`);
    const d = await until("the finished download", async () => {
      const list = await evalApp(`return nn.store.getState().downloads.map((d) => ({ id: d.id, state: d.state, filename: d.filename, path: d.path, received: d.received }))`);
      return list.find((x) => x.filename?.includes("nncore-test") && x.state === "finished") ?? null;
    }, 20000);
    if (!d.path.startsWith(downloadsDir)) throw new Error(`downloaded to ${d.path}, not the scratch dir`);
    return d;
  });

  await check("site-settings", async () => {
    const origin = "https://settings.test";
    await cef(`setSiteSetting("", "${origin}", "popups", "allow")`);
    const settings = await until("the setting", async () => {
      const s = await cef(`getSiteSettings("", "${origin}")`);
      return s?.popups?.value === "allow" ? s : null;
    });
    const origins = await cef(`getSiteSettingsOrigins("")`);
    await cef(`resetSiteSettings("", "${origin}")`);
    const cleared = await cef(`clearSiteData("", "${origin}")`);
    return { popups: settings.popups, origins: origins.length, cleared };
  });

  await check("passwords-more", async () => {
    // The rest of Settings › Passwords: edit, the never-save list, unlock (NETNYAHOO_TEST_REAUTH), export to a file.
    const origin = "https://more.test";
    await cef(`savePassword("", "${origin}", "olduser", "pw1")`);
    const updated = await cef(`updatePassword("", "${origin}", "olduser", "newuser", "pw2")`);
    if (updated?.error) throw new Error(`update: ${updated.error}`);
    const revealed = await until("the edited login", async () => {
      const r = await cef(`getPassword("", "${origin}", "newuser")`);
      return r?.password === "pw2" ? r : null;
    });
    const unlocked = await cef(`unlockPasswords("")`);
    const never = await cef(`getNeverSavePasswordOrigins("")`);
    const allowed = await cef(`allowSavingPasswords("", "https://never.test")`);
    const file = join(scratch, "passwords.csv");
    // The save panel a background instance doesn't show answers from file-chooser.txt.
    writeFileSync(join(data, "file-chooser.txt"), file + "\n");
    const exported = await cef(`exportPasswords("")`);
    const written = await until("the export file", async () => existsSync(file) && readFileSync(file, "utf8").includes("newuser"), 10000);
    await cef(`deletePassword("", "${origin}", "newuser")`);
    return { updated: revealed.password, unlocked, never: never?.origins?.length ?? never, allowed, exported: exported?.status ?? exported, written };
  });

  await check("autofill-cards", async () => {
    // Cards in Chrome's personal data manager: save (with a published test number), list, reveal, delete; settings.
    const saved = await cef(`saveCard("", { name: "Acceptance Test", expMonth: 12, expYear: 2031 }, "4111111111111111")`);
    if (saved?.error) throw new Error(`save: ${saved.error}`);
    const card = await until("the card listed", async () => {
      const r = await cef(`listCards("")`);
      return r?.cards?.find((c) => c.id === saved.id) ?? null;
    });
    const number = await cef(`revealCardNumber("", "${saved.id}")`);
    if (number?.number !== "4111111111111111") throw new Error(`reveal: ${JSON.stringify(number)}`);
    await cef(`deleteAutofillEntry("", "${saved.id}")`);
    await until("the card gone", async () => !(await cef(`listCards("")`))?.cards?.some((c) => c.id === saved.id));
    await cef(`setAutofillSettings("", null, false)`);
    const off = await cef(`getAutofillSettings("")`);
    await cef(`setAutofillSettings("", null, true)`);
    if (off.cards !== false) throw new Error(`cards setting: ${JSON.stringify(off)}`);
    return { card: { last4: card.lastFour ?? card.last4 ?? null, name: card.name }, revealed: true, cardsOff: true };
  });

  await check("settings-services", async () => {
    // Clearing browsing data, resetting a site, the blocker's switches and an external-app allowance, as Settings does.
    await evalApp(`return globalThis.expo.modules.NetnyahooCEF.clearBrowsingData("", ["cache", "history"], null)`, 90000);
    await cef(`setSiteSetting("", "https://reset.test", "sound", "block")`);
    await cef(`resetSiteSettings("", "https://reset.test")`);
    const reset = await until("the site reset", async () => {
      const r = await cef(`getSiteSettings("", "https://reset.test")`);
      return r?.sound?.isDefault ? r.sound : null;
    });
    const before = await cef(`getContentBlocker()`);
    await cef(`setContentBlockerEnabled(false)`);
    const off = await until("the blocker off", async () => ((await cef(`getContentBlocker()`)).enabled === false ? true : null), 15000);
    await cef(`setContentBlockerEnabled(true)`);
    await until("the blocker on", async () => ((await cef(`getContentBlocker()`)).enabled === true ? true : null), 15000);
    const list = before.lists.find((l) => !l.enabled) ?? before.lists[0];
    await cef(`setFilterListEnabled(${JSON.stringify(list.id)}, ${!list.enabled})`);
    const toggled = await until("the list toggled", async () =>
      (await cef(`getContentBlocker()`)).lists.find((l) => l.id === list.id)?.enabled === !list.enabled ? true : null, 20000);
    await cef(`setFilterListEnabled(${JSON.stringify(list.id)}, ${list.enabled})`);
    await cef(`removeExternalAppAllowance("", "https://none.test", "nncore-no-such-app")`);
    const siteData = await evalApp(`return nn.webviews.get("${first.id}")?.clearSiteData() ?? null`);
    if (!siteData || siteData.error) throw new Error(`clearSiteData: ${JSON.stringify(siteData)}`);
    return { reset: reset.value, blockerOff: off, list: list.id, toggled, siteData };
  });

  await check("download-controls", async () => {
    // A running download paused, resumed and cancelled from the app (nn_downloads_pause/_resume/_cancel).
    await evalApp(`nn.actions.openUrls(["${base}/slow.bin"], ${JSON.stringify(mainWindow)}); return true`);
    const find = () => evalApp(`return nn.store.getState().downloads.map((d) => ({ id: d.id, state: d.state, paused: d.paused, filename: d.filename, received: d.received }))`)
      .then((l) => l.find((x) => x.filename?.includes("nncore-slow")) ?? null);
    const d = await until("the slow download running", async () => { const x = await find(); return x?.state === "downloading" && !x.paused && x.received > 0 ? x : null; }, 15000);
    await cef(`pauseDownload("${d.id}")`);
    await until("paused", async () => ((await find())?.paused ? true : null), 8000);
    await cef(`resumeDownload("${d.id}")`);
    await until("running again", async () => { const x = await find(); return x?.state === "downloading" && !x.paused ? true : null; }, 8000);
    await cef(`cancelDownload("${d.id}")`);
    const last = await until("cancelled", async () => { const x = await find(); return x?.state === "cancelled" ? x : null; }, 8000);
    return { id: d.id, state: last.state };
  });

  await check("tasks-components", async () => {
    const tasks = await until("tasks", async () => {
      const t = await cef(`listTasks()`);
      return t.length ? t : null;
    });
    const components = await cef(`components()`);
    const allowances = await cef(`getExternalAppAllowances("")`);
    return { tasks: tasks.length, browserTasks: tasks.filter((t) => t.browserIds.length).length, components: components.length, allowances: allowances.length };
  });

  await check("download-navigation", async () => {
    // A page navigating to a download stays where it was, and the app hears of it (onDownloadNavigation).
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/file.bin?nav", { userInitiated: true }); return true`);
    const e = await until("onDownloadNavigation", async () => (await eventsOf(first.id)).find((x) => x.name === "downloadNavigation"), 15000);
    return e.payload;
  });

  await check("tracing", async () => {
    const started = await cef(`beginTracing()`);
    const during = await cef(`isTracing()`);
    const path = await cef(`endTracing(false)`);
    const after = await cef(`isTracing()`);
    if (!started || !during || after) throw new Error(`tracing ${started} ${during} ${after}`);
    return { started, during, after, path };
  });

  await check("delete-profile-data", async () => {
    // A loaded profile's data goes through Chrome's profile deletion (one never loaded is its folder alone).
    const folder = join(data, "Chromium", "Profile scratch-delete");
    await cef(`listPasswords("scratch-delete")`);
    await until("the profile loaded", async () => existsSync(folder), 10000);
    const result = await cef(`deleteProfileData("scratch-delete")`);
    if (result.remaining.length) throw new Error(`remaining ${JSON.stringify(result)}`);
    // Chrome removes the folder once the profile is destroyed (its Browsers closed, its services gone).
    const gone = await until("the folder gone", async () => !existsSync(folder), 15000).catch(() => false);
    if (!gone) throw new Error("the profile's folder is still there");
    // The app window still shows its own profile (Chrome's deletion moves "last used", not the window).
    const shown = (await cef(`chromeWindows()`)).filter((w) => w.visible || w.alpha >= 0).map((w) => w.profile);
    return { ...result, folderGone: true, windowProfiles: shown };
  });

  await check("page-events", async () => {
    // Zoom steps, the security report, an app link with no app on this Mac, and an Esc the page leaves alone.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A's WebView", async () => evalApp(`return !!nn.webviews.get("${first.id}")`), 8000);
    await evalApp(`return nn.webviews.get("${first.id}").zoomStep(1)`);
    const zoom = await until("onZoom", async () => (await eventsOf(first.id)).filter((x) => x.name === "zoom").pop(), 8000);
    await evalApp(`return nn.webviews.get("${first.id}").zoomStep(0)`);
    const security = await evalApp(`return nn.webviews.get("${first.id}").getSecurityInfo()`);
    // Esc first: the external-app prompt below is the app's own sheet, which takes Esc itself.
    const s = await state();
    await evalApp(`return nn.webviews.get("${first.id}").focus()`);
    await sleep(300);
    const sent = await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "\u001b", keyCode: 53, modifiers: [], focus: "page" })`);
    const escape = await until("onCommand escape", async () => (await eventsOf(first.id)).find((x) => x.name === "command" && x.payload?.command === "escape"), 5000)
      .catch(async (e) => {
        const profile = await evalApp(`const s = nn.store.getState(); return s.windows["${s.windowId}"]?.profileId ?? null`);
        const pt = await pageFor(first.id, `${base}/a`);
        const vis = (await cdp(pt, "Runtime.evaluate", { expression: "document.visibilityState + '/' + document.hasFocus()", returnByValue: true })).result.value;
        const tx = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.tabStrips()`);
        const chromeActive = tx.strips.map((st) => st.tabs.find((x) => x.active)?.key ?? null);
        throw new Error(`${e.message}; key: ${JSON.stringify(sent)}; window profile: ${profile}; active: ${(await state()).active}; Chrome's active: ${JSON.stringify(chromeActive)}; page ${vis}`);
      });
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "location.href = 'nncore-no-such-app://hello'", userGesture: true });
    const external = await until("onExternalApp", async () => evalApp(`return nn.pageState.getState().pages["${first.id}"]?.externalApp ?? null`), 10000);
    const securityEvent = (await eventsOf(first.id)).some((x) => x.name === "security");
    if (!securityEvent) throw new Error("no onSecurity");
    const focused = (await eventsOf(first.id)).some((x) => x.name === "focus");
    // A background tab's window.focus() asks the app to bring it forward (onActivateRequest "page").
    const other = (await state()).tabs.find((x) => x.id !== first.id && x.url?.startsWith(`${base}/d`));
    let activate = null;
    if (other) {
      const ot = await pageTarget(`${base}/d`);
      await cdp(ot, "Runtime.evaluate", { expression: "window.focus()", userGesture: true });
      activate = await until("onActivateRequest", async () => (await eventsOf(other.id)).find((x) => x.name === "activateRequest"), 3000).catch(() => null);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
    return { zoom: zoom.payload.zoom, security: security?.level, securityEvent, focused, activate: activate?.payload?.reason ?? null,
      external: { scheme: external.scheme, app: external.app }, escape: escape.payload.command };
  });

  await check("notifications", async () => {
    // A page's Notification goes to the app (onNotification), and the app's click reaches the page.
    await cef(`setSiteSetting("", "${base}", "notifications", "allow")`);
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      expression: "window.__clicked = false; const n = new Notification('Acceptance', { body: 'hello', tag: 'nn' }); n.onclick = () => (window.__clicked = true); true",
      userGesture: true,
    });
    const e = await until("onNotification", async () => (await eventsOf(first.id)).findLast((x) => x.name === "notification"), 8000);
    await evalApp(`return nn.webviews.get("${first.id}").notificationAction(${JSON.stringify(e.payload.id)}, "click")`);
    const clicked = await until("the page's click", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "window.__clicked", returnByValue: true });
      return r.result.value === true ? true : null;
    }, 8000);
    await cdp(t, "Runtime.evaluate", { expression: "window.__n2 = new Notification('Second'); setTimeout(() => window.__n2.close(), 300); true", userGesture: true });
    const closed = await until("onNotificationClose", async () => (await eventsOf(first.id)).find((x) => x.name === "notificationClose"), 8000);
    await cef(`setSiteSetting("", "${base}", "notifications", "default")`);
    return { title: e.payload.title, body: e.payload.body, clicked, closed: !!closed };
  });

  await check("now-playing", async () => {
    // A playing <audio> with Media Session metadata: onNowPlaying, onMedia, and the app's pause (mediaCommand).
    // The tab is muted first: nothing is heard.
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/media", { userInitiated: true }); return true`);
    await until("the media page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Media" && !t.loading), 10000);
    await evalApp(`return nn.webviews.get("${first.id}").setMuted(true)`);
    const t = await pageTarget(`${base}/media`);
    await cdp(t, "Runtime.evaluate", {
      expression: "navigator.mediaSession.metadata = new MediaMetadata({ title: 'NN Tone', artist: 'Acceptance' }); window.__play = 'pending'; document.getElementById('tone').play().then(() => (window.__play = 'ok'), (e) => (window.__play = e.name)); true",
      userGesture: true,
    });
    try {
    const playing = await until("onNowPlaying playing", async () =>
      (await eventsOf(first.id)).findLast((x) => x.name === "nowPlaying" && x.payload?.state?.title === "NN Tone" && x.payload?.state?.playbackState === "playing"), 10000);
    await evalApp(`return nn.webviews.get("${first.id}").mediaCommand("pause")`);
    await until("paused by the app", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').paused", returnByValue: true });
      return r.result.value === true ? true : null;
    }, 8000);
    const media = (await eventsOf(first.id)).filter((x) => x.name === "media").length;
    if (!media) throw new Error("no onMedia while playing");
    return { title: playing.payload.state.title, artist: playing.payload.state.artist, mediaEvents: media };
    } finally {
      await evalApp(`return nn.webviews.get("${first.id}").setMuted(false)`).catch(() => null);
      await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
      await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    }
  });

  await check("images", async () => {
    // The page's images and favicons as data: PNGs (downloadImage, downloadFavicon, fetchFavicon).
    const image = await evalApp(`return nn.webviews.get("${first.id}").downloadImage("${base}/icon.png", 64)`);
    const favicon = await evalApp(`return nn.webviews.get("${first.id}").downloadFavicon("${base}/icon.png")`);
    const fetched = await cef(`fetchFavicon("${base}/icon.png", "")`);
    const isData = (r) => JSON.stringify(r ?? null).includes("data:image/png");
    if (!isData(image) || !isData(favicon) || !isData(fetched)) throw new Error(`not data URLs: ${JSON.stringify({ image, favicon, fetched }).slice(0, 300)}`);
    return { image: true, favicon: true, fetched: true };
  });

  await check("extension-surfaces", async () => {
    // An installed extension's action state and side panel for a tab, reload, and its DNR blocks counted on the page
    // (onContentBlocked).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const browser = await browserOf(first.id);
    const states = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.actionStates(${browser}, ["${installed.id}"])`);
    if (!states?.[installed.id]) throw new Error(`no action state: ${JSON.stringify(states)}`);
    const panel = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.sidePanelURL(${browser}, "${installed.id}")`);
    const reloaded = await exts(`reload("${installed.id}", "")`);
    if (reloaded?.error) throw new Error(`reload: ${reloaded.error}`);
    await sleep(1000);
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/blocking", { userInitiated: true }); return true`);
    const blocked = await until("onContentBlocked", async () =>
      (await eventsOf(first.id)).findLast((x) => x.name === "contentBlocked" && x.payload?.count >= 2), 10000).catch(() => null);
    await exts(`uninstall("${installed.id}", "")`);
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
    await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    if (!blocked) throw new Error("no onContentBlocked count for the extension's blocked images");
    return { state: states[installed.id], panel, reloaded: true, blocked: blocked.payload };
  });

  await check("frozen", async () => {
    // The app freezes a background page (setFrozen) and wakes it; the page sees freeze and resume.
    const s = await state();
    const other = s.tabs.find((x) => x.id !== first.id && x.id !== s.active && x.url?.startsWith(`${base}/d`));
    if (!other) throw new Error("no background tab");
    const t = await pageTarget(`${base}/d`);
    await cdp(t, "Runtime.evaluate", { expression: "window.__life = []; document.addEventListener('freeze', () => __life.push('freeze')); document.addEventListener('resume', () => __life.push('resume')); true" });
    await evalApp(`return nn.webviews.get("${other.id}")?.setFrozen(true)`);
    await sleep(1500);
    await evalApp(`return nn.webviews.get("${other.id}")?.setFrozen(false)`);
    const life = await until("freeze and resume", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(window.__life)", returnByValue: true });
      const l = JSON.parse(r.result.value ?? "[]");
      return l.includes("freeze") && l.includes("resume") ? l : null;
    }, 8000);
    return { life };
  });

  await check("discard", async () => {
    // A tab in the background discarded by Chrome keeps its place; the app hears onDiscarded.
    const s = await state();
    const other = s.tabs.find((x) => x.id !== first.id && x.id !== s.active && x.url?.startsWith(base));
    if (!other) throw new Error("no background tab to discard");
    const ok = await evalApp(`return nn.webviews.get("${other.id}").discard()`);
    const e = await until("onDiscarded", async () => (await eventsOf(other.id)).find((x) => x.name === "discarded"), 8000);
    return { ok, url: e.payload.url };
  });

  await check("permission-prompt", async () => {
    // A site asking for a permission reaches the app's prompt (onPermission → pageState.permission), and its answer
    // goes back to Chrome. Chrome holds a background tab's prompt until it shows, so the page is shown first.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      // MIDI with sysex: a Chrome permission with no macOS prompt behind it (location and the camera would ask macOS).
      expression: "navigator.requestMIDIAccess({ sysex: true }).then(() => (window.__geo = 'ok'), (e) => (window.__geo = 'denied:' + e.name))",
      userGesture: true,
    });
    const request = await until("the prompt", async () => evalApp(`return nn.pageState.getState().pages["${first.id}"]?.permission ?? null`), 10000);
    await cef(`resolvePermission("${request.id}", "deny", false)`);
    const answer = await until("the page's answer", async () => {
      const r = await cdp(t, "Runtime.evaluate", { expression: "String(window.__geo)", returnByValue: true });
      return r.result.value !== "undefined" ? r.result.value : null;
    }, 10000);
    return { permissions: request.permissions, origin: request.origin, answer };
  });

  await check("popup-blocked", async () => {
    // A popup without a user gesture: Chrome's blocker keeps it, the app hears of it and can open it. The page is
    // loaded again first: the checks before gave it a user activation (CDP's userGesture), which would let it through.
    await evalApp(`return nn.webviews.get("${first.id}").reload()`);
    await sleep(1500);
    await until("A loaded", async () => (await state()).tabs.find((t) => t.id === first.id && !t.loading), 10000);
    const t = await pageFor(first.id, `${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: `window.open("${base}/c?blocked")` });
    const popups = await until("the blocked popup", async () => {
      const p = await evalApp(`return nn.pageState.getState().pages["${first.id}"]?.popups ?? []`);
      return p.length ? p : null;
    }, 10000);
    await evalApp(`return nn.webviews.get("${first.id}").openBlockedPopup("${popups[0].id}")`);
    const opened = await until("the popup as a tab", async () => (await state()).tabs.find((x) => x.url?.includes("c?blocked")), 10000);
    return { popup: popups[0].url, tab: opened.id };
  });

  await check("second-profile", async () => {
    const s = await state();
    const id = await evalApp(`return nn.store.getState().createProfile({ name: "Work" })`);
    if (!id) throw new Error("no profile made");
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${id}"); return true`);
    await until("profile shown", async () => (await state()).profileId === id);
    await evalApp(`nn.actions.openUrls(["${base}/cookie?B"], ${JSON.stringify(mainWindow)}); return true`);
    const tb = await until("cookie page in B", async () => (await state()).tabs.find((x) => x.profileId === id && x.url?.includes("/cookie")));
    const targetsNow = await targets();
    const b = targetsNow.find((t) => t.url.includes("/cookie?B"));
    const a = targetsNow.find((t) => t.url.startsWith(`${base}/a`));
    const cookieA = (await cdp(a, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const cookieB = (await cdp(b, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    if (cookieA.includes("who=B")) throw new Error("profile A sees B's cookie");
    const windows = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`);
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${s.profileId}"); return true`);
    return { profile: id, tab: tb.id, cookieB, cookieA, chromeWindows: windows.chromeWindows };
  });

  await check("settings-window", async () => {
    const before = await evalApp(`return nn.shell.windowIds()`);
    await evalApp(`nn.openSettings(); return true`);
    const after = await until("a settings window", async () => {
      const ids = await evalApp(`return nn.shell.windowIds()`);
      return ids.length > before.length ? ids : null;
    });
    return { before, after };
  });
  await check("incognito-window", async () => {
    const id = await evalApp(`return nn.actions.openWindow({ incognito: true, url: "${base}/b?private" })`);
    const t = await until("a private tab", async () => {
      const tabs = await evalApp(`const s = nn.store.getState(); return (s.windows["${id}"]?.tabIds ?? []).map((i) => ({ url: s.tabs[i]?.url, title: s.tabs[i]?.title, profile: s.tabs[i]?.profileId }))`);
      return tabs.find((x) => x.title === "Page B") ?? null;
    });
    return { window: id, tab: t };
  });

  await check("move-tab-to-window", async () => {
    // The tab keeps its page (same WebContents: no reload) in the new window.
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", { expression: "window.__kept = 42" });
    const windowId = await evalApp(`const id = nn.store.getState().moveTabsToWindow(["${first.id}"], null); return id`);
    await until("the tab in the new window", async () => evalApp(`return nn.store.getState().tabs["${first.id}"]?.windowId === "${windowId}" && nn.store.getState().windows["${windowId}"]?.tabIds.includes("${first.id}")`));
    await sleep(1500);
    const t2 = await pageTarget(`${base}/a`);
    const kept = (await cdp(t2, "Runtime.evaluate", { expression: "String(window.__kept)", returnByValue: true })).result.value;
    if (kept !== "42") throw new Error(`the page reloaded or went: ${kept}`);
    const tx = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.tabStrips()`);
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindowNumber(${browser})`);
    const holding = tx.strips.find((x) => x.tabs.some((tab) => tab.browser === Number(browser)));
    if (!holding || holding.window !== windowNumber) throw new Error(`the tab's strip is window ${holding?.window}, its view is in ${windowNumber}`);
    return { windowId, kept, strip: holding.strip, window: holding.window };
  });

  await check("title-bar-close", async () => {
    // The title bar's close button on the second window: NNCore asks the app (windowShouldClose:), which closes it.
    const ids = await evalApp(`return nn.shell.windowIds()`);
    const browser = await browserOf(first.id);
    const windowNumber = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindowNumber(${browser})`);
    const clicked = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${windowNumber}, "close-button")`);
    const after = await until("one window fewer", async () => {
      const now = await evalApp(`return nn.shell.windowIds()`);
      return now.length < ids.length ? now : null;
    }, 10000);
    return { clicked, before: ids.length, after: after.length };
  });

  await check("small-yahu", async () => {
    const before = await evalApp(`return Object.keys(nn.store.getState().windows)`);
    await evalApp(`nn.runCommand({ command: "newSmallYahu" }); return true`);
    const id = await until("a Small Yahu window", async () => {
      const w = await evalApp(`return Object.values(nn.store.getState().windows).find((w) => w.kind === "small")?.id ?? null`);
      return w;
    });
    const tabId = await until("its tab", async () => evalApp(`return nn.store.getState().windows["${id}"]?.tabIds[0] ?? null`));
    await evalApp(`nn.store.getState().navigate("${tabId}", "${base}/b?small", { userInitiated: true }); return true`);
    await until("Page B in Small Yahu", async () => evalApp(`return nn.store.getState().tabs["${tabId}"]?.title === "Page B"`));
    return { window: id, tab: tabId };
  });

  await check("startup-native-messaging", async () => {
    // As packages/cef's NNCef at startup (NNCoreStartup.mm): the password managers installed on this Mac get their
    // native messaging manifests in the user data dir (only those whose host exists, listed as ours), and Chrome
    // runs a host from that dir for an extension it names (an echo host here: no real app is started).
    const dir = join(data, "Chromium", "NativeMessagingHosts");
    const known = {
      "com.1password.1password": "/Applications/1Password.app/Contents/Library/LoginItems/1Password Browser Helper.app/Contents/MacOS/1Password-BrowserSupport",
      "com.8bit.bitwarden": "/Applications/Bitwarden.app/Contents/MacOS/desktop_proxy",
      "org.keepassxc.keepassxc_browser": "/Applications/KeePassXC.app/Contents/MacOS/keepassxc-proxy",
      "me.proton.pass.nm": "/Applications/Proton Pass.app/Contents/Resources/assets/proton_pass_nm_host",
    };
    const expected = Object.keys(known).filter((name) => existsSync(known[name])).sort();
    const managed = JSON.parse(existsSync(join(dir, ".netnyahoo-managed.json")) ? readFileSync(join(dir, ".netnyahoo-managed.json"), "utf8") : "[]");
    for (const name of expected) {
      const manifest = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
      if (manifest.name !== name || manifest.type !== "stdio" || !existsSync(manifest.path)) throw new Error(`${name}: ${JSON.stringify(manifest)}`);
    }
    if (JSON.stringify(managed.slice().sort()) !== JSON.stringify(expected)) throw new Error(`managed ${JSON.stringify(managed)}, expected ${JSON.stringify(expected)}`);

    const ext = join(scratch, "fixture-ext-nm");
    cpSync(extPath, ext, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
    manifest.permissions = [...manifest.permissions, "nativeMessaging"];
    writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest, null, 2));
    const installed = await exts(`install(${JSON.stringify(ext)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const host = join(scratch, "echo-host.sh");
    writeFileSync(host, "#!/bin/sh\nexec cat\n", { mode: 0o755 });
    const hostManifest = join(dir, "com.netnyahoo.acceptance.echo.json");
    writeFileSync(hostManifest, JSON.stringify({ name: "com.netnyahoo.acceptance.echo", description: "echo", path: host, type: "stdio", allowed_origins: [`chrome-extension://${installed.id}/`] }));
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.runtime?.sendNativeMessage", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const reply = await cdp(worker, "Runtime.evaluate", {
        expression: `chrome.runtime.sendNativeMessage("com.netnyahoo.acceptance.echo", { ping: 42 }).then((r) => JSON.stringify(r), (e) => "error: " + e.message)`,
        awaitPromise: true,
        returnByValue: true,
      });
      const echoed = reply.result?.value;
      if (echoed !== JSON.stringify({ ping: 42 })) throw new Error(`echo host: ${echoed}`);
      return { hosts: expected, echoed };
    } finally {
      rmSync(hostManifest, { force: true });
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
    }
  });

  await check("startup-accept-language", async () => {
    // As CEF's accept_language_list (NNCoreStartup.mm, --accept-lang): pages see the system's preferred languages,
    // "<language>-<region>" then "<language>", in navigator.languages and the Accept-Language header. (Chrome's own
    // default follows the app bundle's English UI locale: "en-US,en" whatever the system's languages.)
    const system = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e",
      `ObjC.import("Foundation"); const out = []; const all = $.NSLocale.preferredLanguages;
       for (let i = 0; i < all.count; i++) { const l = $.NSLocale.localeWithLocaleIdentifier(all.objectAtIndex(i));
         out.push([ObjC.unwrap(l.languageCode), ObjC.unwrap(l.regionCode) ?? null, ObjC.unwrap(l.scriptCode) ?? null]); }
       JSON.stringify(out)`]).toString());
    const expected = [];
    for (let [language, region, script] of system) {
      if (!language) continue;
      if (language === "zh" && !region) region = script === "Hant" ? "TW" : "CN";
      for (const tag of region ? [`${language}-${region}`, language] : [language]) if (!expected.includes(tag)) expected.push(tag);
    }
    let header = null;
    const echo = createServer((req, res) => {
      header = req.headers["accept-language"] ?? "";
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>Languages</title>");
    });
    await new Promise((r) => echo.listen(0, "127.0.0.1", r));
    const tab = await openTab(`http://127.0.0.1:${echo.address().port}/languages`, "Languages");
    try {
      const t = await pageFor(tab.id, "/languages");
      const languages = (await cdp(t, "Runtime.evaluate", { expression: "navigator.languages", returnByValue: true })).result.value;
      const sent = (header ?? "").split(",").map((s) => s.split(";")[0].trim()).filter(Boolean);
      if (JSON.stringify(languages) !== JSON.stringify(expected)) throw new Error(`navigator.languages ${JSON.stringify(languages)}, expected ${JSON.stringify(expected)}`);
      if (JSON.stringify(sent) !== JSON.stringify(expected)) throw new Error(`Accept-Language "${header}", expected ${JSON.stringify(expected)}`);
      return { languages, header };
    } finally {
      await closeTab(tab.id);
      echo.close();
    }
  });

  let personal = null;
  await check("last-used-profile", async () => {
    // Before the quit: Personal sets a cookie, then the window shows another profile, so that profile is Chrome's
    // last used when the app quits (the relaunch check after the quit).
    const s = await state();
    personal = s.profileId;
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    const before = new Set(s.tabs.map((x) => x.id));
    await evalApp(`nn.actions.openUrls(["${base}/cookie?personal"], ${JSON.stringify(mainWindow)}); return true`);
    await until("Personal's cookie page", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Cookie" && !x.loading), 10000);
    const play = await evalApp(`return nn.store.getState().createProfile({ name: "Play" })`);
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${play}"); return true`);
    await until("Play shown", async () => (await state()).profileId === play);
    await evalApp(`nn.actions.openUrls(["${base}/cookie?play"], ${JSON.stringify(mainWindow)}); return true`);
    await until("Play's cookie page", async () => (await state()).tabs.find((x) => x.profileId === play && x.url?.includes("cookie?play") && !x.loading), 10000);
    await sleep(1000);
    return { personal, play };
  });

  await check("quit", async () => {
    const s = await state();
    // A tab opened just before quitting must be in the saved session: the app saved it on the way out
    // (willQuit → flushPersistence, the documents flushed on willTerminate).
    await evalApp(`nn.actions.openUrls(["${base}/quit-marker"], "${s.windowId}"); return true`);
    await until("the marker tab", async () => (await state()).tabs.some((x) => x.url?.includes("quit-marker")));
    const started = Date.now();
    // ⌘Q → the app's Quit item → NSApp terminate: → applicationShouldTerminate (the app saves its session) →
    // NNCore's quit. The app may exit before the harness answers.
    await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" })`, 5000).catch(() => null);
    await until("the app to exit", async () => exited, 20000);
    await sleep(4000);  // a crash in teardown writes its report a moment after the process is gone
    const saved = readFileSync(join(data, "session.json"), "utf8").includes("quit-marker");
    if (!saved) throw new Error("the session wasn't saved on quit");
    // This instance's reports only (another run may be going alongside). ExcUserFault reports are os_fault logs
    // the process survives; they're listed, crashes fail the check.
    const dir = join(process.env.HOME, "Library/Logs/DiagnosticReports");
    const ours = readdirSync(dir).filter((f) => {
      if (!f.includes("NetnyahooNNCore") || statSync(join(dir, f)).mtimeMs < launchedAt) return false;
      try {
        return new RegExp(`"pid"\\s*:\\s*${child.pid}\\b`).test(readFileSync(join(dir, f), "utf8").slice(0, 8000));
      } catch {
        return false;
      }
    });
    const crashes = ours.filter((f) => !f.startsWith("ExcUserFault_"));
    if (crashes.length) throw new Error(`crash report: ${crashes}`);
    return { exitedAfterMs: Date.now() - started, sessionSaved: saved, faults: ours.filter((f) => f.startsWith("ExcUserFault_")) };
  });

  await check("relaunch-profile", async () => {
    // Relaunched with another profile last used: Personal is still Chrome's Default profile (its cookie, not Play's).
    if (!personal) throw new Error("last-used-profile didn't run");
    await launch("app2.out.log");
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    const windowId = await until("a window", async () => (await state()).windowId, 30000);
    mainWindow = windowId;
    await evalApp(`nn.actions.switchProfile("${windowId}", "${personal}"); return true`);
    await until("Personal shown", async () => (await state()).profileId === personal, 10000);
    const before = new Set((await state()).tabs.map((x) => x.id));
    await evalApp(`nn.actions.openUrls(["${base}/b?personal-again"], ${JSON.stringify(windowId)}); return true`);
    await until("a Personal page", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.title === "Page B" && !x.loading), 15000);
    const t = await pageTarget(`${base}/b?personal-again`);
    const cookie = (await cdp(t, "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const info = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.chromeWindows()`);
    await evalApp(`nn.shell.quit?.(); return true`, 3000).catch(() => null);
    await until("the relaunched app to exit", async () => exited, 20000).catch(() => child.kill("SIGTERM"));
    if (!cookie.includes("who=personal") || cookie.includes("who=play")) throw new Error(`Personal's page sees "${cookie}"`);
    return { cookie, windows: info.map((w) => w.profile) };
  });
} finally {
  visibilityWatch?.stop();
  writeFileSync(join(scratch, "results.json"), JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.ok).length;
  log(`${passed}/${results.length} passed`);
  try {
    await evalApp(`nn.shell.quit?.(); return true`, 3000).catch(() => {});
  } catch {}
  await sleep(1500);
  if (!exited) child.kill("SIGTERM");
  await sleep(1000);
  if (!exited) child.kill("SIGKILL");
  server.close();
  metroProxy.close();
  process.exitCode = passed === results.length ? 0 : 1;
}

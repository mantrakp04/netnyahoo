#!/usr/bin/env node
// Stage 1 acceptance for the app on NNCore (docs/nncore-parity.md): boots the NNCore build of the app hidden
// (NETNYAHOO_BACKGROUND=1, its own data dir and DevTools port), serves fixture pages, and drives the real app
// through its dev harness (lib/devHarness.ts: $NETNYAHOO_DATA_DIR/dev-eval.js) and Chrome's DevTools protocol.
//
//   node packages/nncore/scripts/acceptance.mjs <Netnyahoo.app> <scratch dir> [check…]
//
// It never takes focus and never touches a real profile: the data dir is <scratch dir>/data, wiped first.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const [appArg, scratchArg, ...only] = process.argv.slice(2);
if (!appArg || !scratchArg) {
  console.error("usage: acceptance.mjs <Netnyahoo.app> <scratch dir> [check…]");
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
// NETNYAHOO_TRAFFIC_LIGHTS_LOG (every launch): each change to a window's buttons and each AppKit layout pass of them.
const lightsLog = join(scratch, "traffic-lights.log");
rmSync(lightsLog, { force: true });
rmSync(data, { recursive: true, force: true });
rmSync(downloadsDir, { recursive: true, force: true });
mkdirSync(downloadsDir, { recursive: true });
mkdirSync(data, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (...a) => console.log(...a);
const stamp = () => new Date().toISOString().slice(11, 23);

// MARK: Fixtures

// Requests that reached a host other than the fixture's own (the ad hosts mapped here, content-blocker-blocks).
const adServed = [];
const server = createServer((req, res) => {
  if (!req.headers.host?.startsWith("127.0.0.1")) adServed.push(`${req.headers.host}${req.url}`);
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
  // The release smoke test's form (.claude/skills/release/scripts/pages/form.html): one field Chrome remembers.
  if (url.pathname === "/form")
    return res.end(page("Form", `<form action="/form" method="get" autocomplete="on"><input id="c" name="city" autocomplete="on" style="font-size: 20px; margin: 80px; width: 300px"><button id="b">go</button></form>`));
  // A video drawn from a canvas (start(true) adds a WebAudio tone): Picture in Picture without a media file. With
  // ?docpip the page handles Media Session's "enterpictureinpicture" with a document Picture in Picture window.
  if (url.pathname === "/video")
    return res.end(page("Video", `<video id="v" playsinline style="width: 320px; height: 180px"></video><script>
      const c = document.createElement("canvas"); c.width = 320; c.height = 180;
      const g = c.getContext("2d"); let n = 0;
      setInterval(() => { g.fillStyle = "hsl(" + ((n++ * 7) % 360) + ", 70%, 50%)"; g.fillRect(0, 0, 320, 180); }, 33);
      window.start = (audio) => {
        const stream = c.captureStream(30);
        if (audio) {
          const ac = new AudioContext(), osc = ac.createOscillator(), out = ac.createMediaStreamDestination();
          osc.connect(out); osc.start(); stream.addTrack(out.stream.getAudioTracks()[0]);
        }
        const v = document.getElementById("v"); v.srcObject = stream;
        return v.play().then(() => "ok", (e) => e.name);
      };
      if (location.search.includes("docpip"))
        navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
          const w = await documentPictureInPicture.requestWindow({ width: 320, height: 180 });
          w.document.body.append(document.getElementById("v"));
        });
    </script>`));
  if (url.pathname === "/a") return res.end(page("Page A", `<a id="next" href="/b">to B</a> <a id="blank" target="_blank" href="/c">blank</a> <a id="cmd" href="/d">cmd</a>`));
  if (url.pathname === "/painted") return res.end(page("Painted", "painted", "<style>html, body { background: rgb(60, 60, 60) }</style>"));
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
// JS mid-run. The app takes it from NETNYAHOO_JS_LOCATION for that launch only: a Debug build shares its defaults with
// the installed app, so nothing is written there.
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
// As AGENTS.md says: `open -g -n` with the environment, never a plain open, so it can't take focus.
const exe = join(app, "Contents/MacOS", execFileSync("plutil", ["-extract", "CFBundleExecutable", "raw", join(app, "Contents/Info.plist")]).toString().trim());
let stdout = join(scratch, "app.out.log");
let pid, child, launchedAt, exited = null;
function pgrep() {
  try {
    return execFileSync("pgrep", ["-f", `^${exe}`]).toString().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
// Cast without network devices: the engine's test sink, and Chrome's own Cast/DIAL discovery off (on a Mac it can
// raise the Local Network prompt). A Bluetooth chooser without an adapter (no Bluetooth permission prompt). Passed with
// the other test switches below.
process.env.NETNYAHOO_CHROMIUM_SWITCHES = `--netnyahoo-test-media-route-provider --disable-media-route-providers-for-test --netnyahoo-test-bluetooth-chooser ${process.env.NETNYAHOO_CHROMIUM_SWITCHES ?? ""}`.trim();
// The content blocker's check: ad hosts (and a site to allow) answered by the fixture server, never the network.
process.env.NETNYAHOO_CHROMIUM_SWITCHES += ` --host-resolver-rules=${["ib.adnxs.com", "securepubads.g.doubleclick.net", "pagead2.googlesyndication.com", "adpage.test"]
  .map((host) => `MAP ${host} 127.0.0.1:${server.address().port}`).join(", ")}`;
// Starts the app on the run's data dir (again for the relaunch checks), with a fresh DevTools port.
async function launch(log = "app.out.log", env = {}, args = []) {
  port = await freePort();
  stdout = join(scratch, log);
  const pidsBefore = new Set(pgrep());
  launchedAt = Date.now();
  execFileSync("open", [
    "-g", "-n",
    "--env", "NETNYAHOO_BACKGROUND=1", "--env", "NETNYAHOO_TEST_REAUTH=granted", "--env", `NETNYAHOO_DOWNLOADS_DIR=${downloadsDir}`, "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`,
    "--env", `NETNYAHOO_JS_LOCATION=localhost:${metroProxy.address().port}`,
    // Tab capture without Chrome's picker: getDisplayMedia takes the tab titled "Capture Target" (Chrome's browser-test
    // switch; a tab, so no macOS screen-recording prompt).
    "--env", `NETNYAHOO_CHROMIUM_SWITCHES=--auto-select-tab-capture-source-by-title=Capture Target --netnyahoo-test-external-protocol-no-launch ${process.env.NETNYAHOO_CHROMIUM_SWITCHES ?? ""}`.trim(),
    // Passed through for experiments (e.g. NETNYAHOO_ALLOW_OCCLUSION=1).
    ...["NETNYAHOO_ALLOW_OCCLUSION", "NETNYAHOO_TRACE_VISIBILITY"].filter((k) => process.env[k]).flatMap((k) => ["--env", `${k}=${process.env[k]}`]),
    "--env", `NETNYAHOO_TRAFFIC_LIGHTS_LOG=${lightsLog}`,
    ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    "--stdout", stdout, "--stderr", stdout,
    app,
    ...(args.length ? ["--args", ...args] : []),
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
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error(`DevTools connection to ${target.url} failed (${method})`)))));
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

// The first pixel of a PNG (8-bit RGB or RGBA) as [r, g, b, a]: a scanline's first pixel is stored unfiltered
// whatever its filter (no left neighbour, and the first row has no row above).
function firstPixel(base64) {
  const png = Buffer.from(base64, "base64");
  let ihdr = null;
  const idat = [];
  for (let off = 8; off < png.length; ) {
    const len = png.readUInt32BE(off), type = png.toString("latin1", off + 4, off + 8);
    if (type === "IHDR") ihdr = png.subarray(off + 8, off + 8 + len);
    if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    if (type === "IEND") break;
    off += 12 + len;
  }
  const depth = ihdr[8], channels = { 2: 3, 6: 4 }[ihdr[9]];
  if (depth !== 8 || !channels) throw new Error(`PNG depth ${depth}, color type ${ihdr[9]}`);
  const px = inflateSync(Buffer.concat(idat)).subarray(1, 1 + channels);
  return [px[0], px[1], px[2], channels === 4 ? px[3] : 255];
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

  await check("window-profiles", async () => {
    // A window never gets a dead or missing profile (the 0.2.22 RC crashed in WindowHost::BrowserFor(null) opening
    // one), and a private window never shows Personal's: private and second-profile windows right after launch, at
    // once after their profile's last window closed, and a while after (Chrome destroys an off-the-record profile
    // with its last Browser); a private window's new tab after its last tab closed.
    const home = (await state()).windowId;
    const titles = (w) => evalApp(`const s = nn.store.getState(); return (s.windows[${JSON.stringify(w)}]?.tabIds ?? []).map((i) => s.tabs[i]?.title)`);
    const shows = (w, title) => until(`${title} in ${w}`, async () => ((await titles(w)).includes(title) ? true : null), 15000);
    const cookie = async (urlPart) => (await cdp(await until(urlPart, () => pageTarget(urlPart)), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
    const open = (o) => evalApp(`return nn.actions.openWindow(${JSON.stringify(o)})`);
    const close = (w) => evalApp(`nn.store.getState().closeWindow(${JSON.stringify(w)}); return true`);
    const personalTab = await evalApp(`return nn.store.getState().newTab(${JSON.stringify(home)}, { url: "${base}/cookie?personal" })`);
    await shows(home, "Cookie");
    const steps = [];
    // Private windows.
    const p1 = await open({ incognito: true, url: `${base}/cookie?private1` });
    await shows(p1, "Cookie");
    if ((await cookie("/cookie?private1")).includes("personal")) throw new Error("a private window sees Personal's cookie");
    await close(p1);
    const p2 = await open({ incognito: true, url: `${base}/b?private2` });
    await shows(p2, "Page B");
    steps.push("private, reopened at once");
    if ((await cookie("/b?private2")).includes("personal")) throw new Error("the reopened private window sees Personal's cookie");
    // Its last tab closed (Chrome closes its Browser), then a new tab in the same window.
    await evalApp(`const s = nn.store.getState(); s.closeTabs([...s.windows[${JSON.stringify(p2)}].tabIds]); return true`);
    await sleep(2500);
    await evalApp(`nn.store.getState().newTab(${JSON.stringify(p2)}, { url: "${base}/c?private3" }); return true`);
    await shows(p2, "Page C");
    steps.push("private, a tab after its last tab closed");
    await close(p2);
    await sleep(2500);
    const p4 = await open({ incognito: true, url: `${base}/d?private4` });
    await shows(p4, "Page D");
    steps.push("private, reopened later");
    if ((await cookie("/d?private4")).includes("personal")) throw new Error("a later private window sees Personal's cookie");
    // ⌘W on the last private window and ⇧⌘N in the same turn, a few times: Chrome is still destroying the old
    // profile when the new window asks for one.
    let last = p4;
    for (let round = 0; round < 4; round++) {
      const next = await evalApp(`const s = nn.store.getState(); s.closeWindow(${JSON.stringify(last)}); return nn.actions.openWindow({ incognito: true, url: "${base}/e?churn${round}" })`);
      await shows(next, "Page E");
      await sleep(round % 2 ? 200 : 1500);
      await evalApp(`nn.store.getState().newTab(${JSON.stringify(next)}, { url: "${base}/b?churn${round}" }); return true`);
      await shows(next, "Page B");
      last = next;
    }
    steps.push("private, closed and reopened in one turn (4 rounds)");
    await close(last);
    // A second profile's windows.
    const id = await evalApp(`return nn.store.getState().createProfile({ name: "Spare" })`);
    const w1 = await open({ profileId: id, url: `${base}/cookie?spare` });
    await shows(w1, "Cookie");
    await close(w1);
    const w2 = await open({ profileId: id, url: `${base}/b?spare2` });
    await shows(w2, "Page B");
    steps.push("profile, reopened at once");
    await close(w2);
    await sleep(2500);
    const w3 = await open({ profileId: id, url: `${base}/c?spare3` });
    await shows(w3, "Page C");
    steps.push("profile, reopened later");
    const spare = await cookie("/c?spare3");
    await close(w3);
    await evalApp(`nn.store.getState().closeTab(${JSON.stringify(personalTab)}); return true`);
    if (!spare.includes("spare") || spare.includes("personal")) throw new Error(`the profile's window sees "${spare}"`);
    return { steps, spareCookie: spare };
  });

  await check("window-size", async () => {
    // The first window is CEF's 1360 × 860 (frame), centred by AppKit.
    const frame = await evalApp(`return nn.shell.windowFrame(${JSON.stringify(mainWindow)})`);
    if (frame?.[2] !== 1360 || frame?.[3] !== 860) throw new Error(`frame ${JSON.stringify(frame)}`);
    return { frame };
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

  await check("chrome-strings", async () => {
    // Chrome's own strings name the product Netnyahoo, as on CEF (a WebUI page, browser side; NNHost's S29 also
    // checks a renderer error page); the credit still names the Chromium Authors.
    // On screen: a background tab's WebUI page can sit "loading" (Chrome defers it while hidden).
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    await evalApp(`nn.store.getState().navigate("${first.id}", "chrome://version", { userInitiated: true }); return true`);
    // The app shows Chrome's pages under its own scheme (netnyahoo://version).
    await until("chrome://version", async () => (await state()).tabs.find((t) => t.id === first.id && /^(chrome|netnyahoo):\/\/version/.test(t.url ?? "") && t.title === "About Version"), 20000);
    try {
      const t = await pageFor(first.id, "chrome://version");
      const text = (await cdp(t, "Runtime.evaluate", { expression: "document.body?.innerText ?? ''", returnByValue: true })).result?.value ?? "";
      const product = text.split("\n").find((l) => /^\w+\t\d+\.\d+\./.test(l) && !/^CEF/.test(l));
      const credit = text.match(/Copyright \d+ The Chromium Authors/)?.[0];
      if (!/^Netnyahoo\t/.test(product ?? "") || !credit) throw new Error(`version page: ${product} / ${credit}`);
      return { product, credit };
    } finally {
      // (backToA is defined further down.)
      await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/a", { userInitiated: true }); return true`);
      await until("A again", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading));
    }
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

  await check("context-menu-activation-log", async () => {
    // As CEF's background guard: the menu not shown is a line in activation.log (the release smoke test reads it).
    const line = await until("the activation.log line", async () =>
      (existsSync(join(data, "activation.log")) ? readFileSync(join(data, "activation.log"), "utf8") : "").split("\n").findLast((l) => l.includes("context menu (not shown): ")), 5000);
    if (!line.includes("Search Acceptance for “to B”")) throw new Error(`activation.log: ${line}`);
    return { line: line.slice(line.indexOf("context menu")) };
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

  // Chrome's Bluetooth chooser with no adapter behind it (--netnyahoo-test-bluetooth-chooser: its real
  // ChromeBluetoothChooserController, no IOBluetooth, no macOS prompt; what its answers tell the page's side is recorded).
  const chromeUI = (call) => evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.${call}`);
  const chooserOf = (tabId) => evalApp(`return globalThis.nnDeviceChoosers?.useChoosers.getState().byTab["${tabId}"] ?? null`);
  const bluetoothChooser = async (unauthorized) => {
    if (!(await chromeUI(`devShowBluetoothChooser(${await browserOf(first.id)}, ${unauthorized})`))) throw new Error("devShowBluetoothChooser said no (switch off?)");
    return until("the app's Bluetooth chooser", async () => {
      const c = await chooserOf(first.id);
      return c && (unauthorized ? c.unauthorized : c.options?.length) ? c : null;
    }, 10000);
  };
  const chooserEvents = () => chromeUI(`devChooserEvents()`);
  const chooserGone = () => until("the sheet gone", async () => !(await chooserOf(first.id)), 5000);

  await check("bluetooth-chooser", async () => {
    // A Bluetooth chooser's device list in the app's sheet: the app's Scan again (refreshDeviceChooser) asks Chrome to
    // rescan and the list comes back; its pick (selectDevice) answers the page's side with that device.
    await evalApp(`globalThis.__nnChooser = []; globalThis.__nnChooserSub?.remove();
      globalThis.__nnChooserSub = globalThis.expo.modules.NetnyahooChromeUI.addListener("onDeviceChooser", (e) => globalThis.__nnChooser.push(e)); return true`);
    try {
      const before = (await chooserEvents()).length;
      const chooser = await bluetoothChooser(false);
      const sent = (await evalApp(`return globalThis.__nnChooser`)).length;
      await chromeUI(`refreshDeviceChooser(${chooser.id}).then(() => true)`);
      const rescan = await until("Chrome's rescan", async () => (await chooserEvents()).slice(before).find((e) => e.event === "rescan") ?? null, 5000);
      const refreshed = await until("the list sent again", async () => {
        const list = await evalApp(`return globalThis.__nnChooser`);
        return list.slice(sent).find((c) => c.open && c.options?.length && !c.refreshing) ?? null;
      }, 5000);
      await chromeUI(`selectDevice(${chooser.id}, 0).then(() => true)`);
      const selected = await until("the pick answered", async () => (await chooserEvents()).slice(before).find((e) => e.event === "selected") ?? null, 5000);
      await chooserGone();
      if (selected.device !== "nn-test-device") throw new Error(`picked ${selected.device}`);
      return { title: chooser.title, options: refreshed.options.map((o) => o.name), rescan: !!rescan, selected: selected.device };
    } finally {
      await evalApp(`globalThis.__nnChooserSub?.remove(); return true`).catch(() => null);
      const c = await chooserOf(first.id).catch(() => null);
      if (c) await chromeUI(`cancelDeviceChooser(${c.id}).then(() => true)`).catch(() => null);
    }
  });

  await check("bluetooth-settings", async () => {
    // A Bluetooth chooser without macOS's Bluetooth permission shows "Open Bluetooth Settings" (unauthorized):
    // openBluetoothSettings asks Chrome for its System Settings pane, recorded rather than opened
    // (--netnyahoo-test-external-protocol-no-launch), and the chooser stays. On a WebUSB chooser it does nothing
    // (Chrome's default is NOTREACHED).
    const launches = () => evalApp(`return globalThis.expo.modules.NetnyahooCEF.devExternalLaunches()`);
    const isSettings = (x) => /Privacy_Bluetooth/.test(x.url ?? "");
    const t = await pageFor(first.id, `${base}/a`);
    try {
      const before = (await launches()).filter(isSettings).length;
      const events = (await chooserEvents()).length;
      const bt = await bluetoothChooser(true);
      await chromeUI(`openBluetoothSettings(${bt.id}).then(() => true)`);
      const recorded = await until("the Bluetooth settings pane recorded", async () => {
        const list = (await launches()).filter(isSettings);
        return list.length > before ? list.at(-1) : null;
      }, 5000);
      if ((await chooserOf(first.id))?.id !== bt.id) throw new Error("the chooser closed on openBluetoothSettings");
      await chromeUI(`cancelDeviceChooser(${bt.id}).then(() => true)`);
      await chooserGone();
      const cancelled = await until("the cancel answered", async () => (await chooserEvents()).slice(events).find((e) => e.event === "cancelled") ?? null, 5000);
      await cdp(t, "Runtime.evaluate", {
        expression: "window.__usb = 'pending'; navigator.usb.requestDevice({ filters: [] }).then(() => (window.__usb = 'picked'), (e) => (window.__usb = e.name))",
        userGesture: true,
      });
      const usb = await until("the WebUSB chooser", () => chooserOf(first.id), 10000);
      await chromeUI(`openBluetoothSettings(${usb.id}).then(() => true)`);
      await sleep(500);
      const after = (await launches()).filter(isSettings).length;
      if (after !== before + 1) throw new Error(`the WebUSB chooser recorded ${after - before - 1} settings pane(s)`);
      if ((await chooserOf(first.id))?.id !== usb.id) throw new Error("the WebUSB chooser closed on openBluetoothSettings");
      await chromeUI(`cancelDeviceChooser(${usb.id}).then(() => true)`);
      await chooserGone();
      return { unauthorized: bt.unauthorized, recorded: recorded.url, cancelled: !!cancelled, webUSB: "ignored" };
    } finally {
      const c = await chooserOf(first.id).catch(() => null);
      if (c) await chromeUI(`cancelDeviceChooser(${c.id}).then(() => true)`).catch(() => null);
    }
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

  await check("cast-routes", async () => {
    // Casting the tab to the engine's test sink (--netnyahoo-test-media-route-provider: Chrome's media router with no
    // network device; the real providers are off): the app's picker starts it (startCasting), the route reaches
    // onCastRoutes and the dialog's sink, and both ways the app stops it end it: the picker's Stop (stopCasting) and
    // the toolbar's "Stop Casting" menu (terminateCastRoute).
    const browser = await browserOf(first.id);
    const routesNow = () => evalApp(`return Object.values(globalThis.nnCast.useCast.getState().routes).flat()`);
    const dialogNow = () => evalApp(`return globalThis.nnCast.useCast.getState().dialogs["${first.id}"] ?? null`);
    const openDialog = async () => {
      if (!(await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.showCastDialog(${browser})`))) throw new Error("showCastDialog said no");
      return until("the test sink in the app's dialog", async () => {
        const d = await dialogNow();
        const sink = d?.sinks?.find((s) => s.name === "Netnyahoo Test Sink" && s.state === "available");
        return sink ? { dialog: d, sink } : null;
      }, 10000).catch(async (e) => { throw new Error(`${e.message}; dialog ${JSON.stringify(await dialogNow())}`); });
    };
    const casting = async (dialogId, sink) => {
      await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.startCasting(${dialogId}, ${JSON.stringify(sink.id)}, 2).then(() => true)`);
      return until("the route in onCastRoutes", async () => (await routesNow()).find((r) => r.sink === sink.id) ?? null, 10000);
    };
    try {
      const { dialog, sink } = await openDialog();
      if (!(sink.modes & 2)) throw new Error(`the test sink can't cast a tab (modes ${sink.modes})`);
      const route = await casting(dialog.id, sink);
      const connected = await until("the sink connected in the dialog", async () => {
        const d = await dialogNow();
        const s = d?.sinks?.find((x) => x.id === sink.id);
        return s?.routeId === route.id && s.state === "connected" ? { dialog: d, sink: s } : null;
      }, 10000);
      await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.stopCasting(${dialog.id}, ${JSON.stringify(route.id)}).then(() => true)`);
      await until("the route gone after stopCasting", async () => !(await routesNow()).some((r) => r.id === route.id), 10000);
      // Again, then the dialog closed and the route ended from the toolbar's menu.
      const second = await casting(dialog.id, sink);
      await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.closeCastDialog(${dialog.id}).then(() => true)`);
      await until("the dialog closed", async () => !(await dialogNow()), 5000);
      if (!(await routesNow()).some((r) => r.id === second.id)) throw new Error("closing the dialog ended the route");
      await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.terminateCastRoute(${JSON.stringify(second.id)}).then(() => true)`);
      await until("the route gone after terminateCastRoute", async () => !(await routesNow()).some((r) => r.id === second.id), 10000);
      return {
        sink: { name: sink.name, modes: sink.modes },
        started: { route: route.description, source: route.source, castingStarted: connected.dialog.castingStarted, state: connected.sink.state },
        stopped: true,
        terminated: true,
      };
    } finally {
      const d = await dialogNow().catch(() => null);
      if (d) await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.closeCastDialog(${d.id}).then(() => true)`).catch(() => null);
      for (const r of await routesNow().catch(() => []))
        await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.terminateCastRoute(${JSON.stringify(r.id)}).then(() => true)`).catch(() => null);
    }
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
  // A tab's WebView is mounted (a background or restored tab mounts when shown).
  const shownAndMounted = async (id) => {
    await evalApp(`nn.actions.switchToTab(${JSON.stringify(id)}); return true`);
    await until(`${id}'s WebView`, () => evalApp(`return !!nn.webviews.get(${JSON.stringify(id)})`), 15000);
  };
  // A new foreground tab on `url` in the run's window, mounted and loaded (for checks after move-tab-to-window took
  // the first tab to a window of its own).
  const freshTab = async (url) => {
    const id = await evalApp(`return nn.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: ${JSON.stringify(url)} })`);
    await shownAndMounted(id);
    await until(`${url} loaded`, () => evalApp(`const s = nn.store.getState(); return s.tabs[${JSON.stringify(id)}]?.url && !s.live[${JSON.stringify(id)}]?.isLoading ? true : null`));
    return id;
  };
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
      // packages/cef's PasswordPrompt: state, origin, username, passwordLength, federation, usernames.
      const p = e.payload;
      if (p.state !== "save" || p.username !== "nnformuser" || p.passwordLength !== 11 || p.federation !== "" || !Array.isArray(p.usernames) || p.origin !== base)
        throw new Error(`prompt ${JSON.stringify(p)}`);
      await evalApp(`return nn.webviews.get("${first.id}").resolvePasswordPrompt("save")`);
      const saved = await until("the saved login", async () => {
        const list = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.listPasswords("")`);
        return list.passwords?.find((x) => x.username === "nnformuser") ?? null;
      }, 10000);
      // The same user with a new password: "update", answered with the app's edited password.
      const seen = (await eventsOf(first.id)).filter((x) => x.name === "passwordPrompt").length;
      await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/login?again", { userInitiated: true }); return true`);
      await until("the login page again", async () => (await state()).tabs.find((t) => t.id === first.id && t.url?.endsWith("/login?again") && !t.loading));
      const t2 = await pageFor(first.id, `${base}/login?again`);
      await cdp(t2, "Runtime.evaluate", { expression: "document.getElementById('u').value = ''; document.getElementById('p').value = ''" });
      for (const [field, text] of [["u", "nnformuser"], ["p", "form-s3cret-2"]]) {
        await cdp(t2, "Runtime.evaluate", { expression: `document.getElementById('${field}').focus()` });
        await cdp(t2, "Input.insertText", { text });
      }
      const r2 = await cdp(t2, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('go').getBoundingClientRect())", returnByValue: true });
      const box2 = JSON.parse(r2.result.value);
      const at2 = { x: box2.x + box2.width / 2, y: box2.y + box2.height / 2, button: "left", clickCount: 1 };
      await cdp(t2, "Input.dispatchMouseEvent", { type: "mousePressed", ...at2, buttons: 1 });
      await cdp(t2, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at2, buttons: 0 });
      const u = await until("the update prompt", async () => (await eventsOf(first.id)).filter((x) => x.name === "passwordPrompt")[seen], 10000);
      if (u.payload.state !== "update" || !u.payload.usernames.includes("nnformuser") || u.payload.passwordLength !== 13)
        throw new Error(`update prompt ${JSON.stringify(u.payload)}`);
      await evalApp(`return nn.webviews.get("${first.id}").resolvePasswordPrompt("update", { password: "edited-s3cret" })`);
      const edited = await until("the edited password", async () => {
        const r = await cef(`getPassword("", ${JSON.stringify(saved.origin)}, "nnformuser")`);
        return r?.password === "edited-s3cret" ? r : null;
      }, 10000);
      await evalApp(`return globalThis.expo.modules.NetnyahooCEF.deletePassword("", ${JSON.stringify(saved.origin)}, "nnformuser")`);
      return { prompt: { state: p.state, passwordLength: p.passwordLength, usernames: p.usernames }, update: u.payload.state, edited: !!edited, origin: saved.origin };
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
      if (changed !== true) throw new Error(`changeCaptureSource answered ${changed} (Chrome's last-used profile: ${(await cef(`engineInfo()`)).lastUsedProfile})`);
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
    const browser = await browserOf(first.id);
    const scroll = (steps) => evalApp(`return globalThis.expo.modules.NetnyahooCEF.devScrollZoom(${JSON.stringify(steps)}, ${browser})`);
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

  await check("private-windows-create", async () => {
    // A private window an extension makes (chrome.windows.create({incognito: true}), allowed in private windows): its
    // tab lands in a private window of the app, live, never in a normal window. With one open, it goes there.
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    await exts(`configure("${installed.id}", "", { incognito: true })`);
    const privateTabs = () => evalApp(`const s = nn.store.getState(); return Object.values(s.tabs).map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId, incognito: !!s.windows[t.windowId]?.incognito, adoptId: t.adoptId }))`);
    const opened = [];
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.windows?.create", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const create = async (tag) => {
        const made = await cdp(worker, "Runtime.evaluate", {
          expression: `chrome.windows.create({ url: "${base}/cookie?${tag}", incognito: true }).then((w) => JSON.stringify({ incognito: w.incognito }), (e) => "error: " + e.message)`,
          awaitPromise: true,
          returnByValue: true,
        });
        const tab = await until(`the ${tag} tab in the app`, async () => (await privateTabs()).find((t) => t.url?.includes(`cookie?${tag}`) && t.title === "Cookie") ?? null, 15000)
          .catch((e) => { throw new Error(`${e.message}; windows.create: ${made.result?.value ?? JSON.stringify(made.exceptionDetails ?? made)}`); });
        opened.push(tab.windowId);
        return { tab, created: made.result?.value };
      };
      // Personal's cookie, which a private page must not see.
      await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/cookie?personal", { userInitiated: true }); return true`);
      await until("Personal's cookie", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Cookie" && !t.loading));
      const lone = await create("private-ext1");
      if (!lone.tab.incognito) throw new Error(`the private tab landed in a normal window: ${JSON.stringify(lone)}`);
      const cookie = (await cdp(await pageTarget("cookie?private-ext1"), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      if (cookie.includes("personal")) throw new Error(`the private page sees Personal's cookie: ${cookie}`);
      const second = await create("private-ext2");
      if (!second.tab.incognito || second.tab.windowId !== lone.tab.windowId) throw new Error(`the second private tab: ${JSON.stringify(second)} (first in ${lone.tab.windowId})`);
      return { first: { window: lone.tab.windowId, adoptId: lone.tab.adoptId ?? null, cookie: cookie || "(none)" }, second: { sameWindow: true } };
    } finally {
      for (const w of new Set(opened)) await evalApp(`nn.store.getState().closeWindow(${JSON.stringify(w)}); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
      await backToA().catch(() => null);
    }
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

  // The content blocker's rounds on an ad page in a new tab of `profileId` (the window's own when undefined): blocked,
  // allowed for the site (and reloaded, as the app does), blocked again.
  const contentBlockerRounds = async (profileId) => {
    await until("the blocker's state", async () => ((await cef(`getContentBlocker()`))?.stats?.ready ? true : null), 30000);
    const page = `http://adpage.test:${server.address().port}/adpage`;
    const tag0 = profileId ? profileId : "personal";
    // Another profile's page in a window of its own: closing its only tab in the main window would close that window.
    const ownWindow = profileId ? await evalApp(`return nn.actions.openWindow({ profileId: ${JSON.stringify(profileId)}, url: "${page}?${tag0}" })`) : null;
    const tab = ownWindow
      ? await until("the profile's tab", () => evalApp(`return nn.store.getState().windows[${JSON.stringify(ownWindow)}]?.tabIds[0] ?? null`))
      : await evalApp(`return nn.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${page}?${tag0}" })`);
    try {
      const round = async (tag) => {
        tag = `${tag0}-${tag}`;
        await evalApp(`nn.store.getState().navigate(${JSON.stringify(tab)}, "${page}?${tag}", { userInitiated: true }); return true`);
        await until(`the page (${tag})`, () => evalApp(`const s = nn.store.getState(); const t = s.tabs[${JSON.stringify(tab)}];
          return t?.url?.endsWith(${JSON.stringify(`?${tag}`)}) && !s.live[${JSON.stringify(tab)}]?.isLoading ? true : null`));
        const t = await until("its target", () => pageTarget(`/adpage?${tag}`));
        const reached = async (url) => {
          const before = adServed.length;
          const r = (await cdp(t, "Runtime.evaluate", { expression: `fetch("${url}", { mode: "no-cors" }).then(() => "loaded", () => "failed")`, awaitPromise: true, returnByValue: true })).result.value;
          return { fetch: r, reached: adServed.slice(before).some((s) => url.includes(s.split("?")[0])) };
        };
        // The release smoke test's ad script as a <script>: uBOL answers it with its stand-in (an adsbygoogle that does
        // nothing), so it "loads" without the request leaving the browser. CEF failed the stand-in's load instead
        // (ERR_BLOCKED_BY_CLIENT on the extension's web_accessible_resources), which the smoke test took as "blocked".
        const script = async () => {
          const before = adServed.length;
          const url = `http://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?${tag}`;
          const r = (await cdp(t, "Runtime.evaluate", { expression: `new Promise((r) => { const s = document.createElement("script"); s.src = "${url}";
            s.onload = () => r(window.adsbygoogle?.loaded === true ? "stand-in" : "loaded"); s.onerror = () => r("failed"); document.head.append(s); })`, awaitPromise: true, returnByValue: true })).result.value;
          return { script: r, reached: adServed.slice(before).some((s) => s.startsWith("pagead2.")) };
        };
        return { adnxs: await reached(`http://ib.adnxs.com/ut/v3?${tag}`), gpt: await reached(`http://securepubads.g.doubleclick.net/tag/js/gpt.js?${tag}`), adsbygoogle: await script() };
      };
      const blocked = await round("blocked");
      await cef(`setContentBlockerAllowed("adpage.test", true)`);
      const allowed = await round("allowed");
      await cef(`setContentBlockerAllowed("adpage.test", false)`);
      const again = await round("again");
      const stopped = (r) => !r.adnxs.reached && !r.gpt.reached && r.adnxs.fetch === "failed" && !r.adsbygoogle.reached && r.adsbygoogle.script === "stand-in";
      if (!stopped(blocked)) throw new Error(`not blocked: ${JSON.stringify(blocked)}`);
      if (!allowed.adnxs.reached || !allowed.gpt.reached || !allowed.adsbygoogle.reached) throw new Error(`allowing the site let nothing through: ${JSON.stringify(allowed)}`);
      if (!stopped(again)) throw new Error(`blocked again? ${JSON.stringify(again)}`);
      return { blocked, allowed, again };
    } finally {
      if (ownWindow) await evalApp(`nn.store.getState().closeWindow(${JSON.stringify(ownWindow)}); return true`);
      else await evalApp(`nn.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  };

  await check("content-blocker-blocks", async () => {
    // A page's ad requests never reach the ad server: a block rule fails them, and uBOL sends some (gpt.js) to its
    // stand-in script instead, so check the server, not the fetch. Allowing the site lets them through; turning it back
    // off blocks them again. The hosts are mapped to the fixture server.
    return contentBlockerRounds(undefined);
  });

  await check("content-blocker-profile", async () => {
    // The same in a profile made now (the release smoke test's page is in its Work profile): uBOL loads into every
    // profile, and its rulesets must block there from the first page, and follow Personal's allow-list.
    const id = await evalApp(`return nn.store.getState().createProfile({ name: "Blocker" })`);
    if (!id) throw new Error("no profile made");
    return { profile: id, ...(await contentBlockerRounds(id)) };
  });

  await check("internal-pages-not-history", async () => {
    // The content blocker's hidden page (chrome-extension://<uBOL>/manifest.json, opened in every profile it loads
    // into) never reaches a profile's history or the omnibox; a page the user visits does.
    const profiles = ["", ...(await evalApp(`return nn.store.getState().profileOrder.filter((p) => p !== "default")`))];
    await sleep(1500);
    const found = {};
    let pages = 0;
    for (const profile of profiles) {
      const r = JSON.parse(await cef(`engineCall("nn_history_query", ${JSON.stringify(profile)}, ${JSON.stringify(JSON.stringify({ maxUrls: 1000, maxVisits: 1 }))})`));
      const urls = (r.entries ?? []).map((e) => e.u ?? "");
      pages += urls.filter((u) => u.startsWith("http")).length;
      const internal = urls.filter((u) => u.startsWith("chrome-extension://"));
      if (internal.length) found[profile || "personal"] = internal;
    }
    if (Object.keys(found).length) throw new Error(`extension pages in history: ${JSON.stringify(found)}`);
    if (!pages) throw new Error("no history at all (the check proves nothing)");
    return { profiles: profiles.length, webPages: pages };
  });

  await check("crash-reload", async () => {
    // A crashed tab's Reload brings the page back and drops the sad tab (pageState.crashed), as CEF: its first
    // report after the crash names no URL, so the app takes the reload for a new page.
    const tab = await evalApp(`return nn.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${base}/crash-reload" })`);
    try {
      await until("the page", async () => (await state()).tabs.find((t) => t.id === tab && t.title === "/crash-reload" && !t.loading));
      await cdp(await pageTarget("/crash-reload"), "Page.crash").catch(() => null);
      const crashed = await until("the sad tab", () => evalApp(`return nn.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null`), 10000);
      await evalApp(`return nn.webviews.get(${JSON.stringify(tab)}).reload()`);
      const title = await until("the page again", async () => {
        const t = await pageTarget("/crash-reload");
        const r = t && (await cdp(t, "Runtime.evaluate", { expression: "document.title", returnByValue: true }).catch(() => null));
        return r?.result?.value === "/crash-reload" ? r.result.value : null;
      });
      const after = await until("no sad tab", async () => {
        const p = await evalApp(`return { crashed: nn.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null, url: nn.store.getState().tabs[${JSON.stringify(tab)}]?.url }`);
        return !p.crashed && p.url?.endsWith("/crash-reload") ? p : null;
      }, 5000).catch(async () => { throw new Error(`still crashed: ${JSON.stringify(await evalApp(`return nn.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed`))}`); });
      return { crashed: crashed.reason, title, url: after.url };
    } finally {
      await evalApp(`nn.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  });

  await check("crash-debug-url", async () => {
    // chrome://crash crashes the page without committing: the tab keeps its URL (a reload or the restored session
    // doesn't crash it again), as CEF.
    const tab = await evalApp(`return nn.store.getState().newTab(${JSON.stringify(mainWindow)}, { url: "${base}/crash-url" })`);
    try {
      await until("the page", async () => (await state()).tabs.find((t) => t.id === tab && t.title === "/crash-url" && !t.loading));
      await evalApp(`nn.actions.switchToTab(${JSON.stringify(tab)}); nn.store.getState().navigate(${JSON.stringify(tab)}, "chrome://crash", { userInitiated: true }); return true`);
      await until("the sad tab", () => evalApp(`return nn.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null`), 10000);
      await sleep(1000);
      const url = await evalApp(`return nn.store.getState().tabs[${JSON.stringify(tab)}]?.url`);
      if (!url?.startsWith(`${base}/crash-url`)) throw new Error(`the tab's URL became ${url}`);
      await evalApp(`return nn.webviews.get(${JSON.stringify(tab)}).reload()`);
      await until("the page again, not crashed", async () => {
        const p = await evalApp(`return { crashed: nn.pageState.getState().pages[${JSON.stringify(tab)}]?.crashed ?? null, url: nn.store.getState().tabs[${JSON.stringify(tab)}]?.url }`);
        const t = await pageTarget("/crash-url");
        const r = t && (await cdp(t, "Runtime.evaluate", { expression: "document.title", returnByValue: true }).catch(() => null));
        return !p.crashed && p.url?.startsWith(`${base}/crash-url`) && r?.result?.value === "/crash-url" ? p : null;
      });
      return { url };
    } finally {
      await evalApp(`nn.store.getState().closeTab(${JSON.stringify(tab)}); return true`);
    }
  });

  await check("popup-window", async () => {
    // A sized window.open (OAuth, payments) gets a window of its own, as CEF's NNPopupWindow: not a tab, its page the
    // size asked for, window.opener kept both ways; window.close() in it closes the window.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    const opener = await pageFor(first.id, `${base}/a`);
    const popups = async () => (await cef(`engineInfo()`)).popupWindows;
    const before = await popups();
    await cdp(opener, "Runtime.evaluate", { expression: `window.__msg = null; addEventListener("message", (e) => (window.__msg = e.data)); window.open("${base}/popup-page", "pop", "width=480,height=360"); true`, userGesture: true });
    const t = await until("the popup's page", () => pageTarget("/popup-page"));
    await until("a popup window", async () => ((await popups()) === before + 1 ? true : null), 10000);
    const page = (await cdp(t, "Runtime.evaluate", { expression: `JSON.stringify({ size: innerWidth + "x" + innerHeight, opener: !!window.opener })`, returnByValue: true })).result.value;
    await cdp(t, "Runtime.evaluate", { expression: `window.opener.postMessage("from-popup", "*")` });
    const message = await until("the opener's message", async () => (await cdp(opener, "Runtime.evaluate", { expression: "window.__msg", returnByValue: true })).result.value);
    const asTab = (await state()).tabs.some((x) => x.url?.includes("/popup-page"));
    await cdp(t, "Runtime.evaluate", { expression: "window.close()" });
    await until("the popup window closed", async () => ((await popups()) === before && !(await pageTarget("/popup-page")) ? true : null), 10000);
    const { size, opener: hasOpener } = JSON.parse(page);
    if (asTab) throw new Error("the popup became a tab");
    if (size !== "480x360" || !hasOpener) throw new Error(`popup page ${page}`);
    return { size, opener: hasOpener, message };
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

  await check("page-background", async () => {
    // The page's base background (pageBackgroundColor, the app's theme.card: a translucent rgba) under a page that
    // paints none: a 1×1 screenshot of the page shows it; a page that paints its own background covers it.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const pixel = async (t) => {
      const shot = await cdp(t, "Page.captureScreenshot", { format: "png", clip: { x: 600, y: 400, width: 1, height: 1, scale: 1 } });
      return firstPixel(shot.data);
    };
    const transparent = await pixel(await pageFor(first.id, `${base}/a`));
    // Again after a reload (a new document; the base background is the tab's, not the document's).
    await evalApp(`return nn.webviews.get("${first.id}").reload()`);
    await sleep(1000);
    await until("A reloaded", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Page A" && !t.loading), 10000);
    await sleep(500);
    const reloaded = await pixel(await pageFor(first.id, `${base}/a`));
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/painted", { userInitiated: true }); return true`);
    let painted;
    try {
      await until("the painted page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Painted" && !t.loading), 10000);
      await sleep(500);
      painted = await pixel(await pageFor(first.id, `${base}/painted`));
    } finally {
      await backToA();
    }
    // theme.ts's card, light and dark.
    const cards = { light: [255, 255, 255, 0.7], dark: [18, 18, 18, 0.5] };
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 3);
    const theme = Object.entries(cards).find(([, c]) => near(transparent.slice(0, 3), c.slice(0, 3)))?.[0];
    if (!theme || !near(reloaded, transparent)) {
      // Whether a base background reaches the screenshot at all: DevTools' own override, then cleared again.
      const t = await pageFor(first.id, `${base}/a`);
      const ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
      let seq = 0;
      const send = (method, params = {}) => new Promise((r) => {
        const id = ++seq;
        ws.addEventListener("message", function on(m) { const msg = JSON.parse(m.data); if (msg.id === id) { ws.removeEventListener("message", on); r(msg.result ?? msg); } });
        ws.send(JSON.stringify({ id, method, params }));
      });
      const shot = async () => firstPixel((await send("Page.captureScreenshot", { format: "png", clip: { x: 600, y: 400, width: 1, height: 1, scale: 1 } })).data);
      await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 255, g: 0, b: 0, a: 0.5 } });
      const overridden = await shot();
      await send("Emulation.setDefaultBackgroundColorOverride", {});
      const cleared = await shot();
      const dark = (await send("Runtime.evaluate", { expression: "matchMedia('(prefers-color-scheme: dark)').matches", returnByValue: true })).result?.value;
      ws.close();
      throw new Error(`the transparent page shows ${JSON.stringify(transparent)} (after a reload ${JSON.stringify(reloaded)}), not a theme card's color (DevTools' override ${JSON.stringify(overridden)}, cleared ${JSON.stringify(cleared)}, page dark ${dark}, painted ${JSON.stringify(painted)})`);
    }
    // A neutral gray: the screenshot is in the display's color space, where sRGB grays keep their values.
    if (!near(painted, [60, 60, 60, 255])) throw new Error(`the painted page shows ${JSON.stringify(painted)}`);
    return { theme, card: cards[theme], transparentPage: transparent, alpha: +(transparent[3] / 255).toFixed(2), reloaded, paintedPage: painted };
  });

  await check("external-app-answer", async () => {
    // A link to an app this Mac has (shortcuts:, Shortcuts.app, looked up, never launched): the app's prompt
    // (onExternalApp) offers "always allow" for this trustworthy origin; the app's Cancel with the box ticked
    // (resolveExternalApp(id, false, true)) launches nothing and Chrome records no allowance, so the next link asks
    // again. Open with the box ticked (open: true, remember: true) launches it (recorded instead under the run's
    // --netnyahoo-test-external-protocol-no-launch) and Chrome records the allowance.
    const running = () => { try { return execFileSync("pgrep", ["-x", "Shortcuts"]).toString().trim().length > 0; } catch { return false; } };
    const wasRunning = running();
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await until("A shown", async () => (await state()).active === first.id);
    const ask = async (n) => {
      await evalApp(`nn.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } })); return true`);
      const t = await pageFor(first.id, `${base}/a`);
      // A click first: Chrome takes one external link per user interaction (its anti-flood guard); a DevTools
      // userGesture isn't one.
      for (const type of ["mousePressed", "mouseReleased"])
        await cdp(t, "Input.dispatchMouseEvent", { type, x: 600, y: 400, button: "left", clickCount: 1 });
      await cdp(t, "Runtime.evaluate", { expression: `location.href = 'shortcuts://nncore-acceptance-${n}'`, userGesture: true });
      return until(`prompt ${n}`, async () => evalApp(`return nn.pageState.getState().pages["${first.id}"]?.externalApp ?? null`), 10000);
    };
    const decline = async (request) => {
      await evalApp(`nn.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } }));
        return globalThis.expo.modules.NetnyahooCEF.resolveExternalApp(${JSON.stringify(request.id)}, false, true).then(() => true)`);
      await sleep(1500);
    };
    const firstAsk = await ask(1);
    if (!firstAsk.app || !firstAsk.appPath?.endsWith("Shortcuts.app")) throw new Error(`no app found: ${JSON.stringify({ ...firstAsk, icon: !!firstAsk.icon })}`);
    if (!firstAsk.remember) throw new Error("no \"always allow\" offered for a trustworthy origin");
    await decline(firstAsk);
    const allowances = await cef(`getExternalAppAllowances("")`);
    if (JSON.stringify(allowances).includes("shortcuts")) throw new Error(`Chrome recorded an allowance: ${JSON.stringify(allowances)}`);
    const again = await ask(2);
    if (again.id === firstAsk.id) throw new Error("the second link reused the first request");
    await decline(again);
    const third = await ask(3);
    await evalApp(`nn.pageState.setState((s) => ({ pages: { ...s.pages, "${first.id}": { ...s.pages["${first.id}"], externalApp: null } } }));
      return globalThis.expo.modules.NetnyahooCEF.resolveExternalApp(${JSON.stringify(third.id)}, true, true).then(() => true)`);
    const launch = await until("the recorded launch", async () =>
      (await cef(`devExternalLaunches()`)).find((l) => l.url?.includes("nncore-acceptance-3")) ?? null, 8000);
    const remembered = await until("Chrome's allowance", async () => {
      const list = await cef(`getExternalAppAllowances("")`);
      return list.find((a) => a.scheme === "shortcuts") ?? null;
    }, 8000);
    await cef(`removeExternalAppAllowance("", ${JSON.stringify(remembered.origin)}, "shortcuts")`);
    const after = await cef(`getExternalAppAllowances("")`);
    if (after.some((a) => a.scheme === "shortcuts")) throw new Error(`the allowance stayed: ${JSON.stringify(after)}`);
    if (!wasRunning && running()) throw new Error("Shortcuts was launched");
    return { app: firstAsk.app, origin: firstAsk.origin, remember: firstAsk.remember, icon: !!firstAsk.icon,
      declined: [firstAsk.id, again.id], allowancesAfterDecline: allowances.length, opened: launch, allowance: remembered,
      removed: true, launched: false };
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

  // MARK: Media, Picture in Picture, page focus

  // The last event of a kind an app tab sent, and the app's own media state for it.
  const lastEvent = async (tabId, name, test = () => true) => (await eventsOf(tabId)).findLast((x) => x.name === name && test(x.payload ?? {})) ?? null;
  const live = (tabId) => evalApp(`return nn.store.getState().live["${tabId}"] ?? null`);
  const pipWindows = () => cef(`devPictureInPicture()`).catch(() => null);
  const startVideo = async (tabId, audio) => {
    const t = await pageFor(tabId, `${base}/video`);
    const r = await cdp(t, "Runtime.evaluate", { expression: `start(${audio})`, awaitPromise: true, userGesture: true, returnByValue: true });
    if (r.result?.value !== "ok") throw new Error(`the video didn't play: ${JSON.stringify(r.result ?? r)}`);
    await until("the video's first frames", async () => (await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('v').videoWidth", returnByValue: true })).result?.value > 0, 8000);
    return t;
  };

  await check("media-state", async () => {
    // onMedia as packages/cef reports it: `playing` from the page script (a playing element the page hasn't muted),
    // `muted` from Chrome's mute; the app's live.playingAudio follows. The tab is muted: nothing is heard.
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    await evalApp(`nn.store.getState().navigate("${first.id}", "${base}/media", { userInitiated: true }); return true`);
    await until("the media page", async () => (await state()).tabs.find((t) => t.id === first.id && t.title === "Media" && !t.loading), 10000);
    try {
      await evalApp(`return nn.webviews.get("${first.id}").setMuted(true)`);
      const mutedEvent = await until("onMedia muted", async () => lastEvent(first.id, "media", (p) => p.muted === true), 5000);
      const t = await pageFor(first.id, `${base}/media`);
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').play(); true", userGesture: true });
      const on = await until("onMedia playing", async () => {
        const e = await lastEvent(first.id, "media");
        return e?.payload.playing && e.payload.muted ? e : null;
      }, 8000);
      await until("live.playingAudio", async () => (await live(first.id))?.playingAudio === true, 5000);
      const pausedAt = Date.now();
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('tone').pause(); true" });
      const off = await until("onMedia stopped", async () => {
        const e = await lastEvent(first.id, "media");
        return e && !e.payload.playing ? e : null;
      }, 8000);
      const stoppedAfterMs = Date.now() - pausedAt;
      await until("live.playingAudio off", async () => (await live(first.id))?.playingAudio === false, 5000);
      await evalApp(`return nn.webviews.get("${first.id}").setMuted(false)`);
      const unmuted = await until("onMedia unmuted", async () => {
        const e = await lastEvent(first.id, "media");
        return e && e.payload.muted === false ? e : null;
      }, 5000);
      return { muted: mutedEvent.payload, playing: on.payload, stopped: off.payload, stoppedAfterMs, unmuted: unmuted.payload };
    } finally {
      await evalApp(`return nn.webviews.get("${first.id}").setMuted(false)`).catch(() => null);
      await backToA();
    }
  });

  await check("picture-in-picture", async () => {
    // The app's requestPictureInPicture / exitPictureInPicture on a playing video → onPictureInPicture (video), then a
    // page's own documentPictureInPicture.requestWindow → onPictureInPicture (document). Chrome's window is styled as
    // on CEF (rounded, kept on top), and in a hidden run it is transparent and lets clicks through.
    const tab = await openTab(`${base}/video`, "Video");
    try {
      await evalApp(`return nn.webviews.get("${tab.id}").setMuted(true)`);
      const t = await startVideo(tab.id, false);
      const requested = await evalApp(`return nn.webviews.get("${tab.id}").requestPictureInPicture()`);
      if (requested !== true) throw new Error(`requestPictureInPicture answered ${requested}`);
      const on = await until("onPictureInPicture video", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "video" && p.active), 5000);
      const element = (await cdp(t, "Runtime.evaluate", { expression: "document.pictureInPictureElement?.id ?? null", returnByValue: true })).result.value;
      // Chrome's window, styled as packages/cef styles it (NNCorePictureInPicture), invisible and click-through here.
      const video = await until("Chrome's PiP window, styled", async () => (await pipWindows())?.find((w) => w.video && w.styled) ?? null, 5000)
        .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await pipWindows())}`); });
      if (!video.rounded || !video.keepOnTop || video.rim !== 1 || video.level < 3 || video.host !== "127.0.0.1" || !video.backToTab)
        throw new Error(`not styled as on CEF: ${JSON.stringify(video)}`);
      if (video.alpha !== 0 || !video.ignoresMouseEvents) throw new Error(`a hidden run's PiP window shows: ${JSON.stringify(video)}`);
      const menu = await cef(`devPictureInPictureAction("menu")`);
      await evalApp(`return nn.webviews.get("${tab.id}").exitPictureInPicture()`);
      const off = await until("onPictureInPicture video off", async () => {
        const e = await lastEvent(tab.id, "pictureInPicture");
        return e && e.payload.kind === "video" && !e.payload.active ? e : null;
      }, 5000);
      // Document Picture in Picture, opened by the page.
      const doc = await cdp(t, "Runtime.evaluate", {
        expression: "documentPictureInPicture.requestWindow({ width: 320, height: 180 }).then(() => 'ok', (e) => e.name)",
        awaitPromise: true, userGesture: true, returnByValue: true,
      });
      const docOn = await until("onPictureInPicture document", async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === "document" && p.active), 5000)
        .catch((e) => { throw new Error(`${e.message}; requestWindow: ${JSON.stringify(doc.result)}`); });
      const docWindow = await until("the document PiP window", async () => (await pipWindows())?.find((w) => w.visible && !w.styled && !w.video) ?? null, 5000)
        .catch(async (e) => { throw new Error(`${e.message}: ${JSON.stringify(await pipWindows())}`); });
      if (docWindow.alpha !== 0 || !docWindow.ignoresMouseEvents) throw new Error(`a hidden run's document PiP window shows: ${JSON.stringify(docWindow)}`);
      await evalApp(`return nn.webviews.get("${tab.id}").exitPictureInPicture()`);
      const docOff = await until("onPictureInPicture document off", async () => {
        const e = await lastEvent(tab.id, "pictureInPicture");
        return e && e.payload.kind === "document" && !e.payload.active ? e : null;
      }, 5000);
      return { requested, on: on.payload, element, window: { frame: video.frame, level: video.level, alpha: video.alpha }, menu, off: off.payload,
        docOn: docOn.payload, docWindow: { title: docWindow.title, alpha: docWindow.alpha }, docOff: docOff.payload };
    } finally {
      await closeTab(tab.id);
    }
  });

  await check("auto-picture-in-picture", async () => {
    // autoPictureInPicture (Arc's, the app's default): a tab playing a video with sound pops it out when the app
    // shows another tab, and takes it back when shown again; a page handling Media Session's "enterpictureinpicture"
    // opens its own document Picture in Picture instead (as on CEF). The tab is muted: nothing is heard.
    const results = {};
    for (const [path, kind] of [["/video?auto", "video"], ["/video?docpip", "document"]]) {
      const tab = await openTab(`${base}${path}`, "Video");
      try {
        await evalApp(`return nn.webviews.get("${tab.id}").setMuted(true)`);
        await startVideo(tab.id, true);
        await until("live.playingAudio", async () => (await live(tab.id))?.playingAudio === true, 8000);
        await until("onNowPlaying with video", async () => lastEvent(tab.id, "nowPlaying", (p) => p.state?.hasVideo && p.state?.playbackState === "playing"), 5000);
        await sleep(300);
        await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
        const out = await until(`auto PiP (${kind})`, async () => lastEvent(tab.id, "pictureInPicture", (p) => p.kind === kind && p.active), 8000);
        await evalApp(`nn.actions.switchToTab("${tab.id}"); return true`);
        const back = await until(`auto PiP ended (${kind})`, async () => {
          const e = await lastEvent(tab.id, "pictureInPicture");
          return e && e.payload.kind === kind && !e.payload.active ? e : null;
        }, 8000);
        results[kind] = { out: out.payload, back: back.payload };
      } finally {
        await closeTab(tab.id);
      }
    }
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    return results;
  });

  await check("pip-window", async () => {
    // Chrome's PiP window as packages/cef handles it (its self-test, NNCorePictureInPicture): rounded, stashed past
    // either screen edge with a peek and its handle, Chrome remembering the place, Keep Window on Top, Back to Tab
    // (onActivateRequest "pictureInPicture"); then Chrome's own close button (X), which leaves the video playing
    // (the release smoke test's NETNYAHOO_PIP_SELFTEST=close).
    const tab = await openTab(`${base}/video?window`, "Video");
    const selftest = join(data, "pip-selftest.json"), button = join(data, "pip-button-selftest.json");
    rmSync(selftest, { force: true });
    rmSync(button, { force: true });
    try {
      await evalApp(`return nn.webviews.get("${tab.id}").setMuted(true)`);
      const t = await startVideo(tab.id, false);
      const open = async () => {
        if ((await evalApp(`return nn.webviews.get("${tab.id}").requestPictureInPicture()`)) !== true) throw new Error("requestPictureInPicture failed");
        await until("the styled PiP window", async () => (await pipWindows())?.find((w) => w.video && w.styled && w.visible) ?? null, 5000);
      };
      await open();
      if ((await cef(`devPictureInPictureAction("selftest")`)) !== "started") throw new Error("no self-test");
      const result = await until("the PiP self-test", async () => (existsSync(selftest) ? JSON.parse(readFileSync(selftest, "utf8")) : null), 20000);
      const failed = result.steps.filter((x) => !x.pass);
      if (failed.length) throw new Error(`self-test steps failed: ${JSON.stringify(failed)}`);
      const activate = await lastEvent(tab.id, "activateRequest", (p) => p.reason === "pictureInPicture");
      if (!activate) throw new Error("Back to Tab sent no onActivateRequest");
      await until("PiP closed by Back to Tab", async () => lastEvent(tab.id, "pictureInPicture", (p) => !p.active), 5000);
      // Chrome's own close button.
      await sleep(500);
      await open();
      if ((await cef(`devPictureInPictureAction("close")`)) !== "started") throw new Error("no button self-test");
      const closed = await until("the close click", async () => (existsSync(button) ? JSON.parse(readFileSync(button, "utf8")) : null), 10000);
      const time = async () => (await cdp(t, "Runtime.evaluate", { expression: "({ paused: v.paused, time: v.currentTime, pip: !!document.pictureInPictureElement })", returnByValue: true })).result.value;
      const before = await time();
      await sleep(1000);
      const after = await time();
      if (!closed.closed || after.pip || after.paused || after.time === before.time) throw new Error(`close: ${JSON.stringify({ closed, before, after })}`);
      return { steps: result.steps.map((x) => x.step), closeButton: closed.point, playing: [before.time.toFixed(1), after.time.toFixed(1)] };
    } finally {
      await closeTab(tab.id);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("page-focus", async () => {
    // onPageFocus: a click into the other page of a split (Chrome's focus path as in a key window: devFocusPage) makes
    // that tab the active one, as the app does on CEF. The app's own focus() isn't the user's and sends none.
    const other = await openTab(`${base}/b?focus`, "Page B", true);
    try {
      const split = await evalApp(`return nn.store.getState().createSplit(["${first.id}", "${other.id}"])`);
      if (!split) throw new Error("no split");
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
      await until("A active, both shown", async () => (await state()).active === first.id && (await evalApp(`return !!nn.webviews.get("${other.id}")`)), 8000);
      await sleep(500);
      const before = (await eventsOf(other.id)).filter((x) => x.name === "focus").length;
      await evalApp(`return nn.webviews.get("${other.id}").focus()`);
      await sleep(600);
      const fromApp = (await eventsOf(other.id)).filter((x) => x.name === "focus").length - before;
      await evalApp(`return nn.webviews.get("${first.id}").focus()`);
      await sleep(600);
      if ((await state()).active !== first.id) throw new Error("the app's focus() switched tabs");
      const took = await cef(`devFocusPage(${await browserOf(other.id)})`);
      const focus = await until("onPageFocus", async () => {
        const all = (await eventsOf(other.id)).filter((x) => x.name === "focus");
        return all.length > before + fromApp ? all.at(-1) : null;
      }, 5000);
      await until("the clicked pane active", async () => (await state()).active === other.id, 5000);
      if (fromApp) throw new Error(`the app's own focus() sent onPageFocus (${fromApp})`);
      const front = execFileSync("lsappinfo", ["front"]).toString();
      if (execFileSync("lsappinfo", ["info", "-only", "pid", front.trim()]).toString().includes(`=${child.pid}`)) throw new Error("the app took focus");
      return { took, focus: focus.name, active: "clicked pane" };
    } finally {
      await closeTab(other.id);
      await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    }
  });

  await check("autofill-suggestions", async () => {
    // Chrome's autofill dropdown in a page: an entry this profile submitted, offered on a click into the field and
    // picked with ↓ and Return (the release smoke test's steps); the same dropdown from the app's Autofill command
    // (NetnyahooChromeUI.showAutofillSuggestions, reported by the engine's tab:didShowAutofillSuggestions:); and the
    // saved passwords from the command's "passwords".
    await evalApp(`nn.actions.switchToTab("${first.id}"); return true`);
    const go = async (path, title) => {
      await evalApp(`nn.store.getState().navigate("${first.id}", "${base}${path}", { userInitiated: true }); return true`);
      await until(title, async () => (await state()).tabs.find((t) => t.id === first.id && t.title === title && t.url?.endsWith(path) && !t.loading), 10000);
      await sleep(500);
      return pageFor(first.id, `${base}${path}`);
    };
    const shownSince = async (count, needle) => {
      const all = (await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions");
      return all.length > count && JSON.stringify(all.at(-1).payload.items).includes(needle) ? all.at(-1) : null;
    };
    const shownCount = async () => (await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions").length;
    const key = async (t, k) => {
      const code = { ArrowDown: 40, Enter: 13 }[k];
      const at = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      await cdp(t, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...at, ...(k === "Enter" ? { text: "\r" } : {}) });
      if (k === "Enter") await cdp(t, "Input.dispatchKeyEvent", { type: "char", ...at, text: "\r" });
      await cdp(t, "Input.dispatchKeyEvent", { type: "keyUp", ...at });
    };
    const value = async (t) => (await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('c').value", returnByValue: true })).result.value;
    try {
      let t = await go("/form", "Form");
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('c').value = 'Springfield'; document.getElementById('b').click(); 1" });
      t = await until("the form submitted", async () => (await state()).tabs.find((x) => x.id === first.id && x.url?.includes("/form?city=") && !x.loading) && pageFor(first.id, "/form?city="), 10000);
      await sleep(1500);
      // As the smoke test: a DevTools navigation, no focus() from the app, the click alone (the page took focus when
      // the app loaded it, as on CEF).
      await cdp(t, "Page.navigate", { url: `${base}/form` });
      await until("the form again", async () => (await state()).tabs.find((x) => x.id === first.id && x.url === `${base}/form` && !x.loading), 10000);
      await sleep(800);
      t = await pageFor(first.id, `${base}/form`);
      let count = await shownCount();
      const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('c').getBoundingClientRect())", returnByValue: true })).result.value);
      const at = { x: box.x + 20, y: box.y + box.height / 2, button: "left", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at, buttons: 1 });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at, buttons: 0 });
      const clicked = await until("the dropdown on a click", async () => shownSince(count, "Springfield"), 6000);
      await sleep(300);
      await key(t, "ArrowDown");
      await sleep(300);
      await key(t, "Enter");
      const picked = await until("the picked entry in the field", async () => ((await value(t)) === "Springfield" ? true : null), 4000)
        .catch(async (e) => { throw new Error(`${e.message}; field "${await value(t)}"`); });
      // The app's Autofill command on the focused field.
      await cdp(t, "Runtime.evaluate", { expression: "const c = document.getElementById('c'); c.value = ''; c.blur(); c.focus(); 1", userGesture: true });
      await sleep(400);
      count = await shownCount();
      const browser = await browserOf(first.id);
      const shown = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.showAutofillSuggestions(${browser}, false)`);
      const command = await until("the dropdown from showAutofillSuggestions", async () => shownSince(count, "Springfield"), 6000)
        .catch((e) => { throw new Error(`${e.message}; showAutofillSuggestions answered ${shown}`); });
      // Saved passwords (the command's "passwords"), on a sign-in form.
      await cef(`savePassword("", ${JSON.stringify(base)}, "nnfill", "fill-s3cret")`);
      t = await go("/login?fill", "Login");
      await evalApp(`return nn.webviews.get("${first.id}").focus()`);
      await cdp(t, "Runtime.evaluate", { expression: "document.getElementById('u').focus(); 1", userGesture: true });
      await sleep(400);
      count = await shownCount();
      await evalApp(`nn.runCommand({ command: "autofill", arg: "passwords", windowId: ${JSON.stringify(mainWindow)} }); return true`);
      const passwords = await until("the saved passwords", async () => shownSince(count, "nnfill"), 6000)
        .catch(async (e) => {
          const direct = await evalApp(`return globalThis.expo.modules.NetnyahooChromeUI.showAutofillSuggestions(${browser}, true)`);
          await sleep(1500);
          throw new Error(`${e.message}; direct ${direct}; saved ${JSON.stringify(await cef(`listPasswords("")`)).slice(0, 300)}; shown ${JSON.stringify((await eventsOf(first.id)).filter((x) => x.name === "autofillSuggestions").map((x) => x.payload))}`);
        });
      const labels = (e) => e.payload.items.map((i) => `${i.label} (${i.type})`);
      return { click: labels(clicked), picked, command: labels(command), shown, passwords: labels(passwords) };
    } finally {
      await cef(`deletePassword("", ${JSON.stringify(base)}, "nnfill")`).catch(() => null);
      await backToA();
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

  await check("favicon-fetch", async () => {
    // fetchFavicon with no tab (restored and unloaded tabs, bookmarks, history) goes through Chrome's network stack
    // with the profile's own loader, as Chrome fetches icons: plain http to any host (App Transport Security exempts
    // only 127.0.0.1, so NSURLSession failed *.localhost and the web), no cookies or credentials, redirects followed,
    // 200 only, at most 2 MB, Chrome's favicon types only, and a time-out. A private window fetches through its own
    // profile and never one it would have to make.
    const png = (side, rgb) => {
      const chunk = (type, body) => {
        const out = Buffer.alloc(12 + body.length);
        out.writeUInt32BE(body.length, 0);
        out.write(type, 4, "ascii");
        body.copy(out, 8);
        out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
        return out;
      };
      const header = Buffer.alloc(13);
      header.writeUInt32BE(side, 0);
      header.writeUInt32BE(side, 4);
      header.set([8, 2, 0, 0, 0], 8);
      const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: side }, () => Buffer.from(rgb)))]);
      return Buffer.concat([
        Buffer.from("89504e470d0a1a0a", "hex"),
        chunk("IHDR", header),
        chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: side }, () => row)))),
        chunk("IEND", Buffer.alloc(0)),
      ]);
    };
    const icon = png(16, [0, 160, 0]);
    // An .ico holding that PNG, served as text/plain: Chrome decodes favicons by their bytes.
    const ico = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(8), icon]);
    ico.writeUInt32LE(icon.length, 14);
    ico.writeUInt32LE(22, 18);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#0a0"/></svg>`;
    // A TIFF: AppKit decodes it, Chrome never takes one as a favicon.
    const pngPath = join(scratch, "favicon-fetch.png"), tiffPath = join(scratch, "favicon-fetch.tiff");
    writeFileSync(pngPath, icon);
    execFileSync("sips", ["-s", "format", "tiff", pngPath, "--out", tiffPath], { stdio: "ignore" });
    const tiff = readFileSync(tiffPath);
    const seen = [];
    const hung = new Set();
    const icons = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      seen.push({ path: url.pathname + url.search, host: req.headers.host, cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null });
      const send = (status, type, body, headers = {}) => {
        res.writeHead(status, { "content-type": type, ...headers });
        res.end(body);
      };
      if (url.pathname === "/set-cookie") return send(200, "text/html", "<!doctype html><title>Favicon Cookie</title>", { "set-cookie": "nnfav=1; path=/" });
      if (url.pathname === "/icon.png") return send(200, "image/png", icon);
      if (url.pathname === "/icon.ico") return send(200, "text/plain", ico);
      if (url.pathname === "/icon.svg") return send(200, "image/svg+xml", svg);
      if (url.pathname === "/svg-as-text") return send(200, "text/plain", svg);
      if (url.pathname === "/icon.tiff") return send(200, "image/png", tiff);
      if (url.pathname === "/redirect") return send(302, "text/plain", "", { location: "/icon.png?redirected" });
      if (url.pathname === "/missing") return send(404, "image/png", icon);
      if (url.pathname === "/auth") return send(401, "image/png", icon, { "www-authenticate": 'Basic realm="nnfav"' });
      if (url.pathname === "/oversized") return send(200, "image/png", Buffer.concat([icon, Buffer.alloc(3 * 1024 * 1024)]));
      if (url.pathname === "/hang") return hung.add(res);
      send(404, "text/plain", "no");
    });
    await new Promise((r) => icons.listen(0, "127.0.0.1", r));
    // *.localhost is loopback to Chrome, but not ATS-exempt as 127.0.0.1 is.
    const favBase = `http://nnfav.localhost:${icons.address().port}`;
    const fetchIcon = async (url, profile = "") => {
      const started = Date.now();
      const r = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.fetchFavicon(${JSON.stringify(url)}, ${JSON.stringify(profile)})`, 60000);
      return { uri: typeof r?.uri === "string" ? r.uri.slice(0, 22) : null, width: r?.width ?? null, ms: Date.now() - started };
    };
    const ok = (r) => r.uri === "data:image/png;base64,";
    let privateWindow = null;
    try {
      // The time-out runs alongside everything else (in the app: the dev harness answers one script at a time).
      await evalApp(`const h = (globalThis.nnFaviconHang = { started: Date.now() });
        globalThis.expo.modules.NetnyahooCEF.fetchFavicon(${JSON.stringify(`${favBase}/hang`)}, "").then((r) => { h.uri = r?.uri ?? null; h.ms = Date.now() - h.started; }, () => { h.uri = null; h.ms = Date.now() - h.started; });
        return true`);
      // A cookie the profile holds for the host: the icon request never carries it.
      const cookieTab = await openTab(`${favBase}/set-cookie`, "Favicon Cookie");
      const cookie = (await cdp(await pageFor(cookieTab.id, "/set-cookie"), "Runtime.evaluate", { expression: "document.cookie", returnByValue: true })).result.value;
      await closeTab(cookieTab.id);
      if (!cookie.includes("nnfav=1")) throw new Error(`the profile has no cookie for the host: "${cookie}"`);
      const accepted = {
        png: await fetchIcon(`${favBase}/icon.png?cookie`),
        ico: await fetchIcon(`${favBase}/icon.ico`),
        svg: await fetchIcon(`${favBase}/icon.svg`),
        redirect: await fetchIcon(`${favBase}/redirect`),
        https: await fetchIcon("https://github.githubassets.com/favicons/favicon.svg"),
      };
      const refused = {
        missing: await fetchIcon(`${favBase}/missing`),
        auth: await fetchIcon(`${favBase}/auth`),
        oversized: await fetchIcon(`${favBase}/oversized`),
        tiff: await fetchIcon(`${favBase}/icon.tiff`),
        svgAsText: await fetchIcon(`${favBase}/svg-as-text`),
        noHost: await fetchIcon("http://nnfav-nowhere.invalid/favicon.ico"),
        notHttp: await fetchIcon("file:///System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns"),
      };
      const bad = [
        ...Object.entries(accepted).filter(([, r]) => !ok(r)).map(([k, r]) => `${k} not loaded (${JSON.stringify(r)})`),
        ...Object.entries(refused).filter(([, r]) => r.uri !== null).map(([k]) => `${k} loaded`),
      ];
      if (bad.length) throw new Error(bad.join("; "));
      const iconRequest = seen.find((s) => s.path === "/icon.png?cookie");
      if (!iconRequest || iconRequest.cookie) throw new Error(`the icon request carried cookies: ${JSON.stringify(iconRequest)}`);
      if (!seen.some((s) => s.path === "/icon.png?redirected")) throw new Error("the redirect wasn't followed");
      if (seen.some((s) => s.authorization)) throw new Error("credentials were sent");
      // A remote plain-http icon (the dogfood repro's): required when this script reaches it too, else only reported.
      const remoteUrl = "http://neverssl.com/favicon.ico";
      const reachable = await fetch(remoteUrl, { signal: AbortSignal.timeout(8000) }).then((r) => r.ok, () => false);
      const remoteFetch = await fetchIcon(remoteUrl);
      if (reachable && !ok(remoteFetch)) throw new Error(`${remoteUrl} not loaded (${JSON.stringify(remoteFetch)})`);
      const remote = `${ok(remoteFetch) ? "ok" : "null"}${reachable ? "" : " (not reachable from this script)"}`;
      // A private window's profile: fetched through it, handed back as data (Chrome's favicon store refuses it). A
      // private profile no window shows is never made for a fetch.
      const noWindow = await fetchIcon(`${favBase}/icon.png?no-private-window`, "incognito:nnfav");
      if (noWindow.uri !== null) throw new Error("a fetch made a private profile");
      privateWindow = await evalApp(`return nn.actions.openWindow({ incognito: true, url: "${favBase}/icon.png?private-page" })`);
      const privateProfile = await until("the private window's profile", () => evalApp(`return nn.store.getState().windows["${privateWindow}"]?.profileId ?? null`), 10000);
      await until("the private page", () => (seen.some((s) => s.path === "/icon.png?private-page") ? true : null), 10000);
      const privately = await fetchIcon(`${favBase}/icon.png?private`, privateProfile);
      if (!ok(privately)) throw new Error(`the private window's fetch failed: ${JSON.stringify(privately)}`);
      const stored = JSON.parse(await cef(`engineCall("nn_favicons_set", ${JSON.stringify(privateProfile)}, ${JSON.stringify(JSON.stringify({ page: `${favBase}/private-page`, icon: `${favBase}/icon.png?private`, png: "AA==" }))})`).catch((e) => JSON.stringify({ refused: String(e) })));
      if (!stored?.error) throw new Error(`a private profile wrote Chrome's favicon store: ${JSON.stringify(stored)}`);
      // The time-out: nil after Chrome's 30 s, never a hang.
      const timedOut = await until("the hung request's end", () => evalApp(`const h = globalThis.nnFaviconHang; return h.ms ? { uri: h.uri ? h.uri.slice(0, 22) : null, ms: h.ms } : null`), 50000);
      if (timedOut.uri !== null || timedOut.ms < 25000 || timedOut.ms > 50000) throw new Error(`the hung request: ${JSON.stringify(timedOut)}`);
      const ms = (o) => Object.fromEntries(Object.entries(o).map(([k, r]) => [k, r.ms]));
      return { accepted: ms(accepted), refused: ms(refused), timedOutMs: timedOut.ms, remote, private: { noWindow: null, open: "data", storeSet: stored.error } };
    } finally {
      if (privateWindow) await evalApp(`nn.store.getState().closeWindow("${privateWindow}"); return true`).catch(() => null);
      for (const res of hung) res.destroy();
      icons.close();
    }
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
    let other = null;
    for (const x of s.tabs.filter((x) => x.id !== first.id && x.id !== s.active && x.url?.startsWith(base)))
      if (await evalApp(`return !!nn.webviews.get(${JSON.stringify(x.id)})`)) { other = x; break; }
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

  await check("engine-call-guard", async () => {
    // As CEF's NNEngineBridge: the JS reaches only the stores it reads (history, favicons, closed tabs, bookmarks), and
    // never for a private window (the engine would answer with Personal's data).
    const parse = async (call) => JSON.parse(await cef(call));
    const privateHistory = await parse(`engineCall("nn_history_query", "incognito-check", null)`);
    const notAllowed = await parse(`engineCall("nn_passwords_list", "", null)`);
    const history = await parse(`engineCall("nn_history_query", "", ${JSON.stringify(JSON.stringify({ maxUrls: 5, maxVisits: 1 }))})`);
    if (!privateHistory.error || !notAllowed.error || history.error) throw new Error(JSON.stringify({ privateHistory, notAllowed, history }));
    return { privateHistory: privateHistory.error, notAllowed: notAllowed.error, historyEntries: history.entries?.length };
  });

  await check("devtools-toggle", async () => {
    // ⌥⌘I twice opens then closes DevTools (Chrome's IDC_DEV_TOOLS_TOGGLE, as CEF ran it); ⌥⌘J opens the console.
    const tab = await freshTab(`${base}/b?devtools`);
    const devtools = async () => (await targets()).filter((t) => t.url.startsWith("devtools://")).length;
    const handle = (panel) => evalApp(`return nn.webviews.get("${tab}").showDevTools(${JSON.stringify(panel)})`);
    await handle("toggle");
    const opened = await until("DevTools open", async () => ((await devtools()) > 0 ? await devtools() : null), 10000);
    await handle("toggle");
    await until("DevTools closed", async () => ((await devtools()) === 0 ? true : null), 10000);
    await handle("console");
    await until("DevTools on the console", async () => ((await devtools()) > 0 ? true : null), 10000);
    await handle("toggle");
    await until("DevTools closed again", async () => ((await devtools()) === 0 ? true : null), 10000);
    await evalApp(`nn.store.getState().closeTab("${tab}"); return true`);
    return { opened };
  });

  await check("navigation-download-memory", async () => {
    // A page that turned out to be a download is remembered (NavigationDownloads.json, as CEF's): a tab that opens on
    // it without the user asking (a restored tab) stays empty instead of downloading it again.
    const files = () => readdirSync(downloadsDir).filter((f) => f.startsWith("nncore-test")).length;
    const before = files();
    const tab = await freshTab(`${base}/b?memory`);
    await evalApp(`nn.store.getState().navigate("${tab}", "${base}/file.bin?memory", { userInitiated: true }); return true`);
    await until("the download", async () => (files() > before ? true : null), 15000);
    const saved = JSON.parse(readFileSync(join(data, "Chromium", "NavigationDownloads.json"), "utf8"));
    if (!saved[`${base}/file.bin?memory`]) throw new Error(`not remembered: ${JSON.stringify(saved)}`);
    await evalApp(`nn.actions.openUrls(["${base}/file.bin?memory"], ${JSON.stringify(mainWindow)}); return true`);
    // The app opens it in a new tab, or in the window's empty new-tab tab.
    const skipped = await until("downloadNavigation skipped", async () => {
      for (const t of (await state()).tabs) {
        const e = (await eventsOf(t.id)).find((x) => x.name === "downloadNavigation" && x.payload?.skipped);
        if (e) return { tab: t.id, payload: e.payload };
      }
      return null;
    }, 10000);
    await sleep(1500);
    const after = files();
    if (after !== before + 1) throw new Error(`downloaded ${after - before} times`);
    return { skipped, downloads: after - before };
  });

  await check("delete-original-profile-data", async () => {
    // Deleting the original profile's data (Chrome's Default profile, whose folder stays): each store is emptied and
    // checked, as packages/cef's ProfileData.deleteDefault.
    const origin = "https://original.test";
    await cef(`savePassword("", "${origin}", "nnoriginal", "s3cret")`);
    await cef(`saveAddress("", { fullName: "Original Yahu", city: "Haifa", country: "IL" })`);
    await cef(`setZoom("", "original.test", 1.5)`);
    await cef(`setSiteSetting("", "${origin}", "popups", "allow")`);
    await until("the data saved", async () => {
      const p = await cef(`listPasswords("")`), a = await cef(`listAddresses("")`), z = await cef(`getZoomLevels("")`), o = await cef(`getSiteSettingsOrigins("")`);
      return p.passwords?.length && a.addresses?.length && z["original.test"] && o.length ? true : null;
    });
    const result = await evalApp(`return globalThis.expo.modules.NetnyahooCEF.deleteProfileData("")`, 60000);
    const p = await cef(`listPasswords("")`), a = await cef(`listAddresses("")`), z = await cef(`getZoomLevels("")`), o = await cef(`getSiteSettingsOrigins("")`);
    const left = { passwords: p.passwords?.length, addresses: a.addresses?.length, zoom: Object.keys(z).length, origins: o.length };
    if (result?.remaining?.length || Object.values(left).some(Boolean)) throw new Error(JSON.stringify({ result, left }));
    return { remaining: result.remaining, left };
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
      if (!f.includes(basename(exe)) || statSync(join(dir, f)).mtimeMs < launchedAt) return false;
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
    // The next check launches the app again only once this one has gone.
    await until("the relaunched app to exit", async () => exited, 20000).catch(async () => {
      try { process.kill(pid, "SIGTERM"); } catch {}
      await until("the relaunched app killed", async () => exited, 10000);
    });
    if (!cookie.includes("who=personal") || cookie.includes("who=play")) throw new Error(`Personal's page sees "${cookie}"`);
    return { cookie, windows: info.map((w) => w.profile) };
  });

  await check("extension-tab-empty-window", async () => {
    // An extension's tabs.create while the app's window shows no page (its tabs closed: a new-tab placeholder only):
    // Chrome puts its tab in that window's Browser, which no app view holds, so the app hears onTabs and opens the
    // URL as its own tab there. With every app window closed, Chrome 154 itself refuses ("No current window"); that
    // is recorded, not asserted.
    if (exited) await launch("app3.out.log");
    await until("the app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    const windowId = await until("a window", async () => (await state()).windowId, 30000);
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    await evalApp(`globalThis.__nnTabs = []; globalThis.__nnTabsSub?.remove();
      globalThis.__nnTabsSub = globalThis.expo.modules.NetnyahooExtensions.addListener("onTabs", (e) => globalThis.__nnTabs.push(e)); return true`);
    try {
      const worker = await until("the extension's worker", async () => {
        for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(installed.id))) {
          const r = await cdp(t, "Runtime.evaluate", { expression: "typeof chrome?.tabs?.create", returnByValue: true }).catch(() => null);
          if (r?.result?.value === "function") return t;
        }
        return null;
      }, 15000);
      const create = async (url) => {
        const made = await cdp(worker, "Runtime.evaluate", {
          expression: `chrome.tabs.create({ url: "${url}" }).then((t) => JSON.stringify({ id: t.id, windowId: t.windowId }), (e) => "error: " + e.message)`,
          awaitPromise: true,
          returnByValue: true,
        });
        return made.result?.value ?? made.exceptionDetails?.exception?.description;
      };
      // Every tab of the window closed: the app keeps the window with a new-tab placeholder (no page).
      await evalApp(`const s = nn.store.getState(); s.closeTabs([...s.windows["${windowId}"].tabIds]); return true`);
      const empty = await until("the window without pages", async () => {
        const s = await state();
        return s.windowId === windowId && s.tabs.every((t) => !t.url) ? s : null;
      }, 10000);
      await sleep(1000);
      const created = await create(`${base}/e?empty-window`);
      const event = await until("onTabs", async () => (await evalApp(`return globalThis.__nnTabs`)).find((e) => e.url?.includes("e?empty-window")) ?? null, 10000)
        .catch(async (e) => { throw new Error(`${e.message}; tabs.create: ${created}; strips ${JSON.stringify(await cef(`tabStrips()`))}`); });
      const opened = await until("the URL as an app tab", async () =>
        (await state()).tabs.find((t) => t.url?.includes("e?empty-window") && t.title === "Page E") ?? null, 10000);
      // Every window closed.
      await evalApp(`const s = nn.store.getState(); Object.keys(s.windows).forEach((id) => s.closeWindow(id)); return true`);
      await until("no app windows", async () => ((await evalApp(`return Object.keys(nn.store.getState().windows).length`)) === 0 ? true : null), 10000);
      await sleep(1000);
      const noWindow = await create(`${base}/e?no-window`);
      await sleep(1500);
      const noWindowEvent = (await evalApp(`return globalThis.__nnTabs`)).some((e) => e.url?.includes("e?no-window"));
      return { placeholderTabs: empty.tabs.length, tabsCreate: created, onTabs: event, appTab: opened.id, adoptId: opened.adoptId ?? null,
        noWindow: { tabsCreate: noWindow, onTabs: noWindowEvent } };
    } finally {
      await evalApp(`globalThis.__nnTabsSub?.remove(); return true`).catch(() => null);
      await exts(`uninstall("${installed.id}", "")`).catch(() => null);
    }
  });

  await check("traffic-lights-steady", async () => {
    // Tab work makes AppKit lay the title bar out again (the app renames the window to its active tab): the buttons
    // must stay at (18, 20) from the window's top-left, visible and opaque, through every pass. The log samples them
    // synchronously at each pass and at each change to them or the title bar views holding them; on 0.2.22's first
    // NNCore build they went to AppKit's (9, 9) at each switch or close and came back 10–430 ms later.
    const w = (await state()).windowId;
    const W = JSON.stringify(w);
    const from = existsSync(lightsLog) ? readFileSync(lightsLog, "utf8").length : 0;
    const run = async (body) => {
      const result = await evalApp(body);
      await sleep(500);
      return result;
    };
    const tabs = [];
    for (let i = 0; i < 4; i++) tabs.push(await run(`return nn.store.getState().newTab(${W}, { url: "${base}/a?lights${i}" })`));
    for (const id of [tabs[0], tabs[2], tabs[1], tabs[3]]) await run(`nn.actions.switchToTab("${id}"); return true`);
    await run(`return nn.store.getState().createSplit(["${tabs[2]}", "${tabs[3]}"])`);
    await run(`nn.store.getState().closeTab("${tabs[3]}"); return true`);
    await run(`nn.store.getState().toggleSidebar(${W}); return true`);
    await run(`nn.actions.switchToTab("${tabs[0]}"); return true`);
    await run(`nn.store.getState().toggleSidebar(${W}); return true`);
    for (const id of [tabs[0], tabs[1], tabs[2]]) await run(`nn.store.getState().closeTab("${id}"); return true`);
    const other = await run(`return nn.actions.openWindow()`);
    await run(`nn.store.getState().closeWindow(${JSON.stringify(other)}); return true`);
    const lines = readFileSync(lightsLog, "utf8").slice(from).split("\n").filter(Boolean);
    const sample = (line) => line.match(/ -> (.*?) \| /)?.[1] ?? line;
    const bad = lines.filter((line) => {
      const state = sample(line);
      return !state.startsWith("close=(18.0,20.0) ") || !state.endsWith(" hidden=0 alpha=1.00") || / _NSTheme\w*Widget set/.test(line);
    });
    // Each window's buttons are in one place throughout (minimise and zoom too).
    const places = new Map();
    for (const line of lines) {
      const window = line.match(/window=(\d+)/)?.[1];
      places.set(window, (places.get(window) ?? new Set()).add(sample(line)));
    }
    const moved = [...places].filter(([, set]) => set.size > 1).map(([window, set]) => ({ window, places: [...set] }));
    if (!lines.some((line) => line.includes(" layout -> "))) throw new Error("no layout pass logged (is NETNYAHOO_TRAFFIC_LIGHTS_LOG set?)");
    if (bad.length || moved.length) throw new Error(`traffic lights left their spot: ${JSON.stringify({ moved, bad: bad.slice(0, 6) })}`);
    return { samples: lines.length, layoutPasses: lines.filter((line) => line.includes(" layout -> ")).length, at: [...places.values()].map((set) => [...set][0]) };
  });

  await check("launch-cocoa-args", async () => {
    // Cocoa's argument-domain defaults on the command line ("-NSAppSleepDisabled YES", as the perf bench passes them)
    // are AppKit's: the app starts as usual, Chrome never takes "YES" for a page to open, and AppKit still reads them.
    if (!exited) {
      await evalApp(`nn.shell.quit?.(); return true`, 3000).catch(() => null);
      await until("the app to exit", async () => exited, 20000).catch(() => child.kill("SIGKILL"));
    }
    await launch("app-args.out.log", {}, ["-NSAppSleepDisabled", "YES", "-ApplePersistenceIgnoreState", "YES"]);
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    await sleep(2000);
    const pages = (await targets()).filter((t) => t.type === "page").map((t) => t.url);
    if (pages.some((u) => /yes/i.test(u))) throw new Error(`a page for the defaults' value: ${JSON.stringify(pages)}`);
    const argv = execFileSync("ps", ["-o", "args=", "-p", String(pid)]).toString().trim();
    if (!argv.includes("-NSAppSleepDisabled YES")) throw new Error(`the process arguments lost the defaults: ${argv}`);
    return { pages: pages.length, argv: argv.slice(argv.indexOf("-NS")) };
  });

  await check("context-menu-log", async () => {
    // NETNYAHOO_CONTEXT_MENU_LOG, as CEF's Client::RunContextMenu (release builds too): the page menu is dumped to
    // that file instead of shown ({ url, link, items: [{ id, label, type, enabled, visible, submenu? }] }, CEF's
    // menu item types), and the item its ".pick" file names ("<label>\t<flags>") runs. Relaunched with it set.
    const menuLog = join(scratch, "context-menu.json");
    rmSync(menuLog, { force: true });
    if (!exited) {
      await evalApp(`nn.shell.quit?.(); return true`, 3000).catch(() => null);
      await until("the app to exit", async () => exited, 20000).catch(() => child.kill("SIGKILL"));
    }
    await launch("app4.out.log", { NETNYAHOO_CONTEXT_MENU_LOG: menuLog });
    await until("the relaunched app", async () => {
      try {
        return await evalApp(`return globalThis.expo.modules.NetnyahooCEF.engineInfo()`, 3000);
      } catch (e) {
        if (exited) throw e;
        return null;
      }
    }, 90000);
    mainWindow = await until("a window", async () => (await state()).windowId, 30000);
    await evalApp(`nn.actions.openUrls(["${base}/a?menu"], ${JSON.stringify(mainWindow)}); return true`);
    const tab = await until("A", async () => (await state()).tabs.find((t) => t.url?.endsWith("/a?menu") && !t.loading));
    await evalApp(`nn.actions.switchToTab("${tab.id}"); return true`);
    await sleep(500);
    const t = await pageFor(tab.id, "/a?menu");
    const rightClick = async () => {
      const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true })).result.value);
      const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    };
    await rightClick();
    const menu = await until("the menu dumped", async () => (existsSync(menuLog) ? JSON.parse(readFileSync(menuLog, "utf8")) : null), 8000);
    const open = menu.items.find((i) => i.label === "Open Link in New Tab");
    if (!menu.url?.endsWith("/a?menu") || !menu.link?.endsWith("/b") || !open || open.type !== 1 || !menu.items.some((i) => i.type === 4))
      throw new Error(`menu ${JSON.stringify(menu).slice(0, 600)}`);
    const before = new Set((await state()).tabs.map((x) => x.id));
    writeFileSync(`${menuLog}.pick`, "Open Link in New Tab\t0\n");
    await rightClick();
    const opened = await until("the picked item's tab", async () => (await state()).tabs.find((x) => !before.has(x.id) && x.url?.endsWith("/b")), 8000);
    if (existsSync(`${menuLog}.pick`)) throw new Error("the pick file wasn't taken");
    return { items: menu.items.length, link: menu.link, picked: opened.url };
  });

  await check("context-menu-incognito", async () => {
    // The page menu's Open Link in Incognito Window (picked through NETNYAHOO_CONTEXT_MENU_LOG, as context-menu-log):
    // the link opens in a private window of the app, never as a tab of the Personal window.
    const menuLog = join(scratch, "context-menu.json");
    const tab = await until("A", async () => (await state()).tabs.find((t) => t.url?.endsWith("/a?menu") && !t.loading));
    await evalApp(`nn.actions.switchToTab("${tab.id}"); return true`);
    const t = await pageFor(tab.id, "/a?menu");
    const box = JSON.parse((await cdp(t, "Runtime.evaluate", { expression: "JSON.stringify(document.getElementById('next').getBoundingClientRect())", returnByValue: true })).result.value);
    const at = { x: box.x + 3, y: box.y + box.height / 2, button: "right", clickCount: 1 };
    const windowsBefore = await evalApp(`return Object.keys(nn.store.getState().windows)`);
    const tabsBefore = await evalApp(`return Object.keys(nn.store.getState().tabs)`);
    writeFileSync(`${menuLog}.pick`, "Open Link in Incognito Window\t0\n");
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await cdp(t, "Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    const newTabs = () => evalApp(`const s = nn.store.getState(), before = new Set(${JSON.stringify(tabsBefore)});
      return Object.values(s.tabs).filter((t) => !before.has(t.id)).map((t) => ({ id: t.id, url: t.url, title: t.title, windowId: t.windowId,
        incognito: !!s.windows[t.windowId]?.incognito, newWindow: !${JSON.stringify(windowsBefore)}.includes(t.windowId) }))`);
    const landed = await until("the link's page in the app", async () => (await newTabs()).find((t) => t.url?.endsWith("/b") && t.title === "Page B") ?? null, 15000)
      .catch(async (e) => { throw new Error(`${e.message}; new tabs ${JSON.stringify(await newTabs())}`); });
    await sleep(500);
    const all = await newTabs();
    if (!landed.incognito || !landed.newWindow || all.some((x) => !x.incognito)) throw new Error(`Open Link in Incognito Window: ${JSON.stringify(all)}`);
    await evalApp(`nn.store.getState().closeWindow(${JSON.stringify(landed.windowId)}); return true`);
    return landed;
  });
  await check("crash-guard", async () => {
    // A hidden test instance that crashes (here Chrome's own Browser.crash, an abort on the main thread) leaves its
    // record in <data dir>/crashes and exits: no crash report for macOS's reporter, so no "quit unexpectedly" dialog
    // and no focus change on the owner's screen.
    const reports = () => readdirSync(join(process.env.HOME, "Library/Logs/DiagnosticReports")).filter((f) => f.startsWith("Netnyahoo-"));
    const before = new Set(reports());
    const front = execFileSync("lsappinfo", ["front"]).toString().trim();
    const crashed = pid;
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    ws.send(JSON.stringify({ id: 1, method: "Browser.crash" }));
    await until("the instance gone", async () => exited, 15000);
    try { ws.close(); } catch {}
    const record = join(data, "crashes", `crash-${crashed}.txt`);
    await until("its crash record", async () => existsSync(record), 5000);
    await sleep(3000);
    const fresh = reports().filter((f) => !before.has(f));
    const frontAfter = execFileSync("lsappinfo", ["front"]).toString().trim();
    if (fresh.length) throw new Error(`macOS made a crash report: ${fresh}`);
    if (frontAfter !== front) throw new Error(`the frontmost app changed: ${front} → ${frontAfter}`);
    return { record: readFileSync(record, "utf8").split("\n")[0], front: "unchanged" };
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
  server.closeAllConnections?.();
  server.close();
  metroProxy.closeAllConnections?.();
  metroProxy.close();
  process.exitCode = passed === results.length ? 0 : 1;
  // A DevTools socket or a page's keep-alive connection can hold the loop open: the run ends here either way.
  setTimeout(() => process.exit(process.exitCode), 3000);
}

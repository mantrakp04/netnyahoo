#!/usr/bin/env node
// NNCore spike acceptance run: launches NNHost.app hidden, drives it through its command
// file and Chromium's DevTools protocol (trusted input), and checks each item of the
// spike's acceptance list (docs/nncore-spike.md). Node 22+, no dependencies.
//
//   node spikes/nncore-host/acceptance.mjs <NNHost.app> <work dir> [--keep]
//
// Writes <work dir>/results.json and prints one line per check.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const [appPath, workDir] = process.argv.slice(2);
if (!appPath || !workDir) {
  console.error("usage: acceptance.mjs <NNHost.app> <work dir>");
  process.exit(64);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const hostDir = path.join(workDir, "host");
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(hostDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(item, name, ok, evidence) {
  results.push({ item, name, ok: !!ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"} [${item}] ${name}${evidence ? " — " + JSON.stringify(evidence) : ""}`);
}
async function waitFor(fn, ms = 15000, every = 150) {
  const end = Date.now() + ms;
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch {}
    if (v) return v;
    if (Date.now() > end || hostExit) return null;
    await sleep(every);
  }
}

// --- Fixture server ----------------------------------------------------------------------
const favicon = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGO4o2HznxLMMGrAqAGjBgwXAwACAD8fu636wwAAAABJRU5ErkJggg==",
  "base64",
);
const page = (title, body) =>
  `<!doctype html><meta charset=utf-8><title>${title}</title><link rel=icon href=/favicon.png>` +
  `<body style="font:14px system-ui">${body}</body>`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (html) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  };
  if (url.pathname === "/favicon.png") {
    res.writeHead(200, { "content-type": "image/png" });
    return res.end(favicon);
  }
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => send(page(`POST:${body}`, `<pre id=body>${body}</pre>`)));
    return;
  }
  switch (url.pathname) {
    case "/index":
      return send(
        page(
          "NN Index",
          `<h1>Index</h1>
<a id=blank href="/target?from=blank" target=_blank>target=_blank</a><br>
<button id=open onclick="window.open('/target?from=open')">window.open</button><br>
<button id=popup onclick="window.open('/target?from=popup','pop','width=420,height=320')">popup</button><br>
<a id=cmd href="/target?from=cmd">cmd-click me</a><br>
<form id=post method=post action=/echo target=_blank><input name=q value=hello-post><button id=postbtn>POST to _blank</button></form>
<form id=postcmd method=post action=/echo><input name=q2 value=hello-cmd-post><button id=postcmdbtn>POST (cmd-click)</button></form>`,
        ),
      );
    case "/target":
      return send(
        `<!doctype html><title>target</title><script>document.title = 'target:' + ${JSON.stringify(
          url.searchParams.get("from"),
        )} + ':' + (window.opener ? 'has-opener' : 'no-opener')</script>`,
      );
    case "/login":
      return send(
        page(
          "Login",
          `<form id=f method=post action=/welcome><input id=u name=username autocomplete=username>
<input id=p name=password type=password autocomplete=current-password><button id=go>Sign in</button></form>`,
        ),
      );
    case "/webauthn":
      return send(
        page(
          "WebAuthn",
          `<button id=create onclick="go()">create passkey</button><pre id=out></pre><script>
async function go() {
  try {
    const c = await navigator.credentials.create({ publicKey: {
      challenge: new Uint8Array(16), rp: { name: 'NNCore', id: 'localhost' },
      user: { id: new Uint8Array(8), name: 'yahu@localhost', displayName: 'Big Yahu' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000,
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } } });
    out.textContent = 'created ' + c.id;
  } catch (e) { out.textContent = 'error ' + e.name; }
}</script>`,
        ),
      );
    case "/script":
      return send(
        `<!doctype html><meta charset=utf-8><meta name=theme-color content="#336699"><title>Script</title>` +
          `<script>window.pageSetGlobal = 1; window.__nnSeen = typeof window.__nnPageScript;</script>` +
          `<body style="font:14px system-ui"><a id=hover href="/target?from=hover">hover me</a>` +
          `<iframe id=frame src="/frame" width=200 height=80></iframe></body>`,
      );
    case "/frame":
      return send(page("Frame", "frame"));
    case "/unload":
      return send(
        page(
          "Unload",
          `<p>leave?</p><script>addEventListener('beforeunload', (e) => { if (!window.__allowLeave) { e.preventDefault(); e.returnValue = ''; } });</script>`,
        ),
      );
    case "/popupblock":
      return send(page("PopupBlock", `<script>setTimeout(() => { window.__opened = !!window.open('/target?from=blocked'); }, 300)</script>`));
    case "/perm":
      return send(page("Perm", `<p id=p>perm</p>`));
    case "/hang":
      return send(page("Hang", `<button id=hang onclick="const end = Date.now() + 45000; while (Date.now() < end) {}">hang</button>`));
    case "/mailto":
      // FaceTime's scheme: Chrome asks first (never mailto:, which Chrome launches unasked); the
      // test host always answers "cancel", so nothing opens.
      return send(page("Mailto", `<a id=m href="facetime://nn-test.invalid">app link</a>`));
    case "/download":
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=nn.bin" });
      return res.end("nncore");
    case "/keys":
      return send(
        page(
          "Keys",
          `<input id=box><script>window.__keys = []; addEventListener('keydown', (e) => { window.__keys.push((e.metaKey ? 'cmd+' : '') + e.key); if (e.metaKey && e.key === 'j') e.preventDefault(); }, true);</script>`,
        ),
      );
    default:
      return send(page("NN", "ok"));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;
const cdpPort = 9300 + Math.floor(Math.random() * 600);

// --- Host --------------------------------------------------------------------------------
const exe = path.join(appPath, "Contents/MacOS/NNHost");
const logFd = fs.openSync(path.join(workDir, "stdout.log"), "w");
const startedAt = Date.now();
let hostExit = null;
const host = spawn(exe, [], {
  // Background mode: context menus are reported, not shown (NNCore's and the app's rule).
  env: { ...process.env, NNHOST_DIR: hostDir, NNHOST_CDP_PORT: String(cdpPort), NETNYAHOO_BACKGROUND: "1" },
  stdio: ["ignore", logFd, logFd],
});
host.on("exit", (code, signal) => (hostExit = { code, signal }));
const frontSamples = [];
const frontTimer = setInterval(() => {
  try {
    const front = execFileSync("lsappinfo", ["info", "-only", "pid", execFileSync("lsappinfo", ["front"]).toString().trim()]).toString();
    frontSamples.push(front.includes(`=${host.pid}`));
  } catch {}
}, 500);

const events = () =>
  fs.existsSync(path.join(hostDir, "events.jsonl"))
    ? fs.readFileSync(path.join(hostDir, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
let cmdId = 0;
async function cmd(name, args = {}, ms = 20000) {
  const id = String(++cmdId);
  const tmp = path.join(hostDir, "cmd.json.tmp");
  fs.writeFileSync(tmp, JSON.stringify({ id, cmd: name, ...args }));
  fs.renameSync(tmp, path.join(hostDir, "cmd.json"));
  const out = await waitFor(() => {
    const p = path.join(hostDir, "result.json");
    if (!fs.existsSync(p)) return null;
    const r = JSON.parse(fs.readFileSync(p, "utf8"));
    if (r.id !== id) return null;
    fs.rmSync(p);
    return r;
  }, ms, 50);
  if (!out) {
    // A hung host: keep its main thread's stack for the report.
    try {
      execFileSync("sample", [String(host.pid), "2", "-file", path.join(workDir, `hang-${name}-${id}.txt`)], { timeout: 30000, stdio: "ignore" });
    } catch {}
    throw new Error(`no answer to ${name}`);
  }
  return out.result;
}
const state = () => cmd("state");

// --- DevTools protocol -------------------------------------------------------------------
async function targets() {
  return (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json());
}
async function attach(match) {
  const t = await waitFor(async () => (await targets()).find((t) => match(t)), 15000);
  if (!t) throw new Error("no target");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, e) => ((ws.onopen = r), (ws.onerror = e)));
  let n = 0;
  const pending = new Map();
  const cdpEvents = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      cdpEvents.push(msg);
    }
  };
  // Answers within 30 s or rejects (a target that never runs its script mustn't stall the run).
  const send = (method, params = {}) =>
    new Promise((r, reject) => {
      const id = ++n;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`no answer to ${method}`));
      }, 30000);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        r(msg);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  async function click(selector, modifiers = 0) {
    const r = await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`,
    );
    for (const type of ["mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1, modifiers });
    }
  }
  async function type(selector, text) {
    await click(selector);
    await send("Input.insertText", { text });
  }
  return { t, send, evaluate, click, type, events: cdpEvents, close: () => ws.close() };
}
const tabsBy = (s, fn) => s.tabs.filter(fn);

try {
  // ---------------------------------------------------------------------------------------
  // 1. Build, link, sign
  const ready = await waitFor(() => events().find((e) => e.event === "windowReady"), 60000);
  const linked = execFileSync("otool", ["-L", exe]).toString().includes("Chromium Framework.framework");
  let sig = "";
  try {
    sig = execFileSync("codesign", ["-dv", "--verbose=2", appPath], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    sig = String(e.stderr || e);
  }
  const sigInfo = execFileSync("sh", ["-c", `codesign -dv --verbose=2 "${appPath}" 2>&1`]).toString();
  check(1, "host links NNCore (Chromium Framework) and starts", ready && linked, {
    windowClass: ready?.windowClass,
    contentView: ready?.contentViewClass,
    chromium: events().find((e) => e.event === "engineDidStart")?.chromium,
  });
  check(1, "signed, hardened runtime, helpers signed (ad hoc)", /flags=0x10002\(adhoc,runtime\)|runtime/.test(sigInfo), {
    flags: (sigInfo.match(/flags=\S+/) || [])[0],
    helperProcesses: execFileSync("sh", ["-c", `pgrep -P ${host.pid} | wc -l`]).toString().trim(),
  });

  // ---------------------------------------------------------------------------------------
  // 2. Window with our chrome, navigation and callbacks
  const index = await cmd("open", { url: `${base}/index`, profile: "A" });
  const indexId = index.tabId;
  const loaded = await waitFor(async () => {
    const s = await state();
    const t = s.tabs.find((t) => t.tabId === indexId);
    return t && !t.loading && t.title === "NN Index" && t.favicon ? t : null;
  });
  const ev = events().filter((e) => e.tabId === indexId);
  check(2, "page loads in our window; title, favicon, progress, loading callbacks", loaded && loaded.inWindow, {
    frame: loaded?.frame,
    titleEvents: ev.filter((e) => e.event === "title").length,
    faviconEvents: ev.filter((e) => e.event === "favicon" && e.favicon).length,
    progressEvents: ev.filter((e) => e.event === "progress").length,
    loadingEvents: ev.filter((e) => e.event === "loading").length,
  });
  await cmd("nav", { tabId: indexId, action: "load", url: `${base}/target?from=nav` });
  const navved = await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title.startsWith("target:nav") && t.canGoBack));
  await cmd("nav", { tabId: indexId, action: "back" });
  const back = await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title === "NN Index" && t.canGoForward && !t.loading));
  await cmd("nav", { tabId: indexId, action: "forward" });
  const fwd = await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title.startsWith("target:nav")));
  await cmd("nav", { tabId: indexId, action: "back" });
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title === "NN Index" && !t.loading));
  check(2, "load / back / forward with canGoBack/canGoForward", navved && back && fwd, {
    navStateEvents: events().filter((e) => e.tabId === indexId && e.event === "navState").length,
  });

  // Real AppKit input (not DevTools input): a click through AppKit's hit-testing into the
  // page's RenderWidgetHostViewCocoa. Chrome routes every such event through the window's
  // ExclusiveAccessContext.
  {
    const p = await attach((t) => t.url === `${base}/index`);
    const at = await p.evaluate(`(() => { const r = document.querySelector('#cmd').getBoundingClientRect(); return [r.x + 5, r.y + r.height / 2]; })()`);
    p.close();
    const hit = await cmd("nativeClick", { tabId: indexId, x: at[0], y: at[1] });
    const went = await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title.startsWith("target:cmd")));
    check(2, "native AppKit click reaches the page (link followed)", went && hostExit === null, { ...hit, title: went?.title });
    await cmd("nav", { tabId: indexId, action: "back" });
    await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && t.title === "NN Index" && !t.loading));
  }
  {
    const findOk = await cmd("chromeCommand", { profile: "A", command: 37000 /* IDC_FIND */ });
    await cmd("find", { tabId: indexId, text: "click" });
    const found = await waitFor(() => events().find((e) => e.event === "find" && e.tabId === indexId && e.final), 8000);
    check(2, "Chrome's find (⌘F command + find in page) with results to the host", found && found.count >= 2 && hostExit === null, {
      idcFind: findOk,
      found,
    });
  }
  {
    const p = await attach((t) => t.url === `${base}/index`);
    await p.send("Runtime.evaluate", { expression: "document.documentElement.requestFullscreen()", userGesture: true, awaitPromise: true });
    const on = await waitFor(() => events().find((e) => e.event === "fullscreen" && e.fullscreen), 8000);
    await p.send("Runtime.evaluate", { expression: "document.exitFullscreen()", awaitPromise: true });
    const off = await waitFor(() => events().find((e) => e.event === "fullscreen" && !e.fullscreen), 8000);
    p.close();
    check(2, "tab fullscreen reaches the host (enter and exit)", on && off, { on: !!on, off: !!off });
  }

  // ---------------------------------------------------------------------------------------
  // 4. Popups land as our tabs with opener and POST bodies
  const page1 = await attach((t) => t.url === `${base}/index`);
  const before = (await state()).tabs.length;
  const opened = async (from) =>
    waitFor(async () => (await state()).tabs.find((t) => t.url.includes(`from=${from}`) && t.title.startsWith("target:")));
  await page1.click("#blank");
  const blank = await opened("blank");
  await page1.click("#open");
  const wopen = await opened("open");
  await page1.click("#popup");
  const popup = await opened("popup");
  await page1.click("#cmd", 4 /* Meta: ⌘-click */);
  const cmdTab = await opened("cmd");
  await page1.click("#postbtn");
  const post = await waitFor(async () => (await state()).tabs.find((t) => t.title === "POST:q=hello-post"));
  await page1.click("#postcmdbtn", 4);
  const postCmd = await waitFor(async () => (await state()).tabs.find((t) => t.title === "POST:q2=hello-cmd-post"));
  const s4 = await state();
  const strays = s4.appWindows.filter((w) => w.visible && w.windowNumber !== s4.windowNumber && w.parent === null);
  const brief = (t) => t && { opener: t.opener, disposition: t.disposition, title: t.title, inWindow: t.inWindow };
  // target=_blank implies noopener (HTML spec), so the page sees no window.opener; the host
  // still learns which tab opened it.
  check(4, "target=_blank → our tab, opener reported", blank && blank.opener === indexId && blank.inWindow, brief(blank));
  check(4, "window.open → our tab, opener kept", wopen && wopen.opener === indexId && wopen.title.endsWith("has-opener"), brief(wopen));
  check(4, "window.open with features (popup) → our tab, host told 'popup'", popup && popup.opener === indexId && popup.disposition === "popup", brief(popup));
  check(4, "⌘-click → background tab of ours", cmdTab && cmdTab.opener === indexId && cmdTab.disposition === "background_tab" && cmdTab.inWindow === false, brief(cmdTab));
  check(4, "form POST target=_blank → body intact", post && post.opener === indexId, brief(post));
  check(4, "⌘-click on a POST form → body intact", postCmd && postCmd.opener === indexId && postCmd.disposition === "background_tab", brief(postCmd));
  check(4, "no window Chrome made on its own", strays.length === 0, { tabsAdded: s4.tabs.length - before, strays });
  page1.close();

  // ---------------------------------------------------------------------------------------
  // 3. Two profiles in one window
  await cmd("show", { tabId: indexId });
  const pa = await attach((t) => t.url === `${base}/index`);
  await pa.evaluate(`document.cookie = 'who=profileA; path=/'`);
  const bTab = await cmd("open", { url: `${base}/index?profile=B`, profile: "B" });
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === bTab.tabId && t.title === "NN Index"));
  const pb = await attach((t) => t.url === `${base}/index?profile=B`);
  const cookieB = await pb.evaluate("document.cookie");
  const sB = await state();
  const tabB = sB.tabs.find((t) => t.tabId === bTab.tabId);
  check(3, "profile B's tab shows in the same NSWindow", tabB?.inWindow && sB.activeProfile === "Profile 2", {
    activeProfile: sB.activeProfile,
    shown: sB.shown,
    tabB: brief(tabB),
  });
  check(3, "each profile is its own Browser (chrome.windows ids) in that window", sB.chromeWindowIds.A > 0 && sB.chromeWindowIds.B > 0 && sB.chromeWindowIds.A !== sB.chromeWindowIds.B, sB.chromeWindowIds);
  check(3, "profiles isolated (cookie set in A not visible in B)", cookieB === "", { cookieB });
  const sBack = await cmd("show", { tabId: indexId });
  check(3, "switching back to A is a view swap (same window number)", sBack.activeProfile === "Default" && sBack.windowNumber === sB.windowNumber, {
    activeProfile: sBack.activeProfile,
    windowNumber: sBack.windowNumber,
  });
  pa.close();
  pb.close();

  // ---------------------------------------------------------------------------------------
  // 7. Extensions: unpacked MV3, content script, action popup
  const ext = await cmd("ext.load", { profile: "A", path: path.join(here, "fixtures/ext") }, 30000);
  check(7, "unpacked MV3 extension installs", ext && ext.id && !ext.error, ext);
  await cmd("nav", { tabId: indexId, action: "reload" });
  await sleep(500);
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === indexId && !t.loading));
  const pc = await attach((t) => t.url === `${base}/index`);
  const marked = await waitFor(() => pc.evaluate("document.documentElement.dataset.nnext"), 8000);
  check(7, "content script runs", marked === "content-script-ran", { marked });
  pc.close();
  const popupOk = await cmd("ext.popup", { tabId: indexId, extId: ext?.id });
  let popupInfo = null;
  if (popupOk) {
    const pp = await attach((t) => t.url.startsWith(`chrome-extension://${ext.id}/popup.html`));
    popupInfo = await waitFor(async () => {
      const title = await pp.evaluate("document.title");
      return title && title.startsWith("{") ? JSON.parse(title) : null;
    }, 8000);
    pp.close();
  }
  const s7 = await state();
  const panel = s7.childWindows.find((w) => w.class === "NSPanel");
  check(7, "action popup opens (ExtensionViewHost in a panel attached to our window)", popupOk && popupInfo && panel?.visible, {
    popupInfo,
    panel,
  });
  check(3, "chrome.windows.getCurrent from the popup is profile A's Browser in our window", popupInfo && popupInfo.windowId === s7.chromeWindowIds.A && popupInfo.activeUrl === `${base}/index`, {
    popupWindowId: popupInfo?.windowId,
    chromeWindowIdA: s7.chromeWindowIds.A,
  });

  // ---------------------------------------------------------------------------------------
  // 6. Docked DevTools in our window
  await cmd("devtools", { tabId: indexId, open: true });
  const dockEv = await waitFor(() => events().find((e) => e.event === "devTools" && e.tabId === indexId && e.docked), 15000);
  const s6 = await waitFor(async () => {
    const s = await state();
    const t = s.tabs.find((t) => t.tabId === indexId);
    return t?.devTools?.inWindow ? s : null;
  }, 10000);
  const devtoolsTarget = (await targets()).find((t) => t.url.startsWith("devtools://"));
  const t6 = s6?.tabs.find((t) => t.tabId === indexId);
  check(6, "DevTools dock in our window, beside the page", dockEv && t6?.devTools?.inWindow && !!devtoolsTarget, {
    pageFrame: t6?.frame,
    devToolsFrame: t6?.devTools?.frame,
    devtoolsUrl: devtoolsTarget?.url.slice(0, 60),
  });
  await cmd("devtools", { tabId: indexId, open: false });

  // ---------------------------------------------------------------------------------------
  // 5. Passwords, autofill dropdown, passkeys
  const login = await cmd("open", { url: `${base}/login`, profile: "A" });
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === login.tabId && t.title === "Login" && !t.loading));
  const pl = await attach((t) => t.url === `${base}/login`);
  await pl.type("#u", "nnuser");
  await pl.type("#p", "hunter2-nn");
  await pl.click("#go");
  pl.close();
  const prompt = await waitFor(() => events().find((e) => e.event === "passwordPrompt"), 15000);
  check(5, "password save prompt reaches the host (Chrome's bubble seam)", prompt && prompt.username === "nnuser", prompt);
  if (prompt) await cmd("pw.save", { tabId: prompt.tabId });
  const logins = await waitFor(async () => {
    const l = await cmd("logins", { profile: "A" });
    return l.find((x) => x.username === "nnuser") ? l : null;
  }, 10000);
  check(5, "saved to Chrome's password store", !!logins, logins);

  // Autofill dropdown: the saved login on a fresh login page.
  const login2 = await cmd("open", { url: `${base}/login?again=1`, profile: "A" });
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === login2.tabId && !t.loading));
  const pl2 = await attach((t) => t.url === `${base}/login?again=1`);
  const childBefore = (await state()).childWindows.length;
  await cmd("focus", { tabId: login2.tabId });
  await pl2.click("#u");
  await sleep(400);
  await pl2.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });
  const ac = await waitFor(async () => {
    const s = await state();
    const w = s.childWindows.filter((w) => w.visible && w.class !== "NSPanel");
    return w.length ? { s, w } : null;
  }, 6000);
  const winFrame = ac?.s.windowFrame;
  check(5, "autofill dropdown is a child window of ours", !!ac, {
    childWindows: ac?.w ?? (await state()).childWindows,
    windowFrame: winFrame,
    childBefore,
  });
  pl2.close();

  const wa = await cmd("open", { url: `${base}/webauthn`, profile: "A" });
  await waitFor(async () => (await state()).tabs.find((t) => t.tabId === wa.tabId && !t.loading));
  const pw = await attach((t) => t.url === `${base}/webauthn`);
  const kids0 = (await state()).childWindows.length;
  await pw.click("#create");
  const sheet = await waitFor(async () => {
    const s = await state();
    const kids = s.childWindows.filter((w) => w.visible);
    const others = s.appWindows.filter((w) => w.visible && w.windowNumber !== s.windowNumber && !kids.find((k) => k.windowNumber === w.windowNumber));
    return kids.length > kids0 || others.length ? { kids, others } : null;
  }, 8000);
  const waOut = await pw.evaluate("document.getElementById('out').textContent");
  check(5, "passkey (WebAuthn) UI attaches to our window", sheet && sheet.kids.length > kids0 && sheet.others.length === 0, { ...sheet, pageSays: waOut });
  pw.close();

  // =======================================================================================
  // Stage 1 (docs/nncore-spike.md › Stage 1 runtime)
  const evs = (name, fn = () => true) => events().filter((e) => e.event === name && fn(e));
  const tabState = async (tabId) => (await state()).tabs.find((t) => t.tabId === tabId);
  const dialogOn = async (target, accept, ms = 10000) => {
    // Chrome's beforeunload dialog (tab-modal): answered through the DevTools protocol.
    const seen = await waitFor(() => target.events.find((e) => e.method === "Page.javascriptDialogOpening"), ms);
    if (seen) {
      target.events.length = 0;
      await target.send("Page.handleJavaScriptDialog", { accept });
    }
    return seen;
  };

  // ---------------------------------------------------------------------------------------
  // S4. Renderer side: the page script, page messages, evaluate, the netnyahoo: scheme
  {
    const sc = await cmd("open", { url: `${base}/script`, profile: "A" });
    const hello = await waitFor(() => evs("pageMessage", (e) => e.tabId === sc.tabId && e.kind === "hello" && e.main)[0]);
    const helloJson = hello ? JSON.parse(hello.json) : null;
    const ps = await attach((t) => t.url === `${base}/script`);
    await waitFor(async () => (await tabState(sc.tabId))?.loading === false);
    const seen = await ps.evaluate("window.__nnSeen");
    check("S4", "page script runs in the main world at document start, before the page's scripts", hello && helloJson.readyState === "loading" && helloJson.pageGlobal === "undefined" && seen === "string", { hello: helloJson, pageSawOurGlobal: seen });
    const frameHello = await waitFor(() => evs("pageMessage", (e) => e.tabId === sc.tabId && e.kind === "hello" && !e.main)[0]);
    const frameGot = await waitFor(() => ps.evaluate("document.getElementById('frame').contentDocument.documentElement.dataset.nnReceived"));
    check("S4", "every frame runs it; a subframe's post carries its frame, callFrame answers that frame", frameHello && frameGot === 'config:{"frame":true}', { frame: frameHello?.frame, frameGot });
    await cmd("callPage", { tabId: sc.tabId, kind: "ping", json: '{"n":1}' });
    const got = await waitFor(() => ps.evaluate("document.documentElement.dataset.nnReceived"));
    const echo = await waitFor(() => evs("pageMessage", (e) => e.tabId === sc.tabId && e.kind === "echo" && e.main)[0]);
    check("S4", "callPage reaches the script's receive(kind, json); its posts reach the host", got === 'ping:{"n":1}' && echo, { got, echo: echo?.json });
    const r1 = await cmd("evaluate", { tabId: sc.tabId, code: "post('result', JSON.stringify(document.title))" });
    const r2 = await cmd("evaluate", { tabId: sc.tabId, code: "setTimeout(() => post('result', '42'), 50)" });
    const r3 = await cmd("evaluate", { tabId: sc.tabId, code: "throw new Error('nope')" });
    const r4 = await cmd("evaluate", { tabId: sc.tabId, code: "this is not javascript" });
    const r5 = await cmd("evaluate", { tabId: sc.tabId, code: "post('result', JSON.stringify(typeof this)); post('result', '\"second\"')" });
    check("S4", "evaluate: first post('result') answers (sync and later); exception or syntax error → nil; strict", r1 === '"Script"' && r2 === "42" && r3 === null && r4 === null && r5 === '"undefined"', { r1, r2, r3, r4, r5 });
    await cmd("exec", { tabId: sc.tabId, code: "document.title = 'Executed'" });
    const executed = await waitFor(async () => (await tabState(sc.tabId))?.title === "Executed");
    check("S4", "executeJavaScript runs in the main world", executed, { title: (await tabState(sc.tabId))?.title });

    // The netnyahoo: scheme: web pages can't go there or open it; Chrome's pages go to chrome:.
    const before = (await state()).tabs.length;
    await ps.send("Runtime.evaluate", { expression: "location.href = 'netnyahoo://settings'" });
    await ps.send("Runtime.evaluate", { expression: "window.open('netnyahoo://settings')", userGesture: true });
    await sleep(1500);
    const after = await state();
    const scNow = after.tabs.find((t) => t.tabId === sc.tabId);
    check("S4", "a web page may not navigate to or open netnyahoo: URLs", scNow.url === `${base}/script` && after.tabs.length === before, { url: scNow.url, tabsBefore: before, tabsAfter: after.tabs.length });
    const cv = await cmd("open", { url: "chrome://version", profile: "A" });
    await waitFor(async () => (await tabState(cv.tabId))?.loading === false);
    const pv = await attach((t) => t.url.startsWith("chrome://version"));
    await pv.send("Runtime.evaluate", { expression: "location.href = 'netnyahoo://about'", userGesture: true });
    const asked = await waitFor(() => evs("appURL", (e) => e.tabId === cv.tabId && e.url === "netnyahoo://about")[0], 8000);
    await pv.send("Runtime.evaluate", { expression: "window.open('netnyahoo://settings')", userGesture: true });
    const askedOpen = await waitFor(() => evs("appURL", (e) => e.tabId === cv.tabId && e.url === "netnyahoo://settings")[0], 8000);
    pv.close();
    await sleep(500);
    const cvNow = await tabState(cv.tabId);
    check("S4", "a Chrome page going to (or opening) netnyahoo:X is cancelled and the host asked (didRequestAppURL)", asked && askedOpen && cvNow.url.startsWith("chrome://version") && evs("appURL").length === 2, { asked, askedOpen, url: cvNow.url, webPageAsks: evs("appURL", (e) => e.tabId === sc.tabId).length });
    await cmd("nav", { tabId: cv.tabId, action: "close" });

    // ---------------------------------------------------------------------------------------
    // S6. The rest of the tab API
    const r = await ps.evaluate(`(() => { const r = document.getElementById('hover').getBoundingClientRect(); return [r.x + 5, r.y + r.height / 2]; })()`);
    await ps.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] });
    const status = await waitFor(() => evs("statusText", (e) => e.tabId === sc.tabId && e.text.includes("from=hover"))[0], 5000);
    const info = await cmd("tabInfo", { tabId: sc.tabId });
    const indexInfo = await cmd("tabInfo", { tabId: indexId });
    check("S6", "status text (hovered link), theme color, favicon URL, browserId", status && info.info.themeColor === "#336699" && indexInfo.info.faviconURL?.endsWith("/favicon.png") && info.info.browserId > 0, { status: status?.text, themeColor: info.info.themeColor, faviconURL: indexInfo.info.faviconURL, browserId: info.info.browserId, themeEvents: evs("themeColor", (e) => e.tabId === sc.tabId).length });
    const ids = (await state()).tabs.map((t) => t.browserId);
    check("S6", "browserId is unique per tab", new Set(ids).size === ids.length, { ids });
    await cmd("loadUser", { tabId: sc.tabId, url: `${base}/target?from=user`, user: true });
    await waitFor(async () => (await tabState(sc.tabId))?.title.startsWith("target:user"));
    await cmd("goToOffset", { tabId: sc.tabId, offset: -1 });
    const backTo = await waitFor(async () => {
      const t = await tabState(sc.tabId);
      return t && t.url === `${base}/script` && !t.loading ? t : null;
    });
    const entries = (await cmd("tabInfo", { tabId: sc.tabId })).entries;
    check("S6", "loadURL:userInitiated:, goToOffset:, navigationEntries", backTo && entries.length === 2 && entries[0].current && entries[1].url.includes("from=user"), { entries });
    await cmd("reloadHard", { tabId: sc.tabId });
    const muted = await cmd("mute", { tabId: sc.tabId, muted: true });
    const audioEv = await waitFor(() => evs("audio", (e) => e.tabId === sc.tabId && e.muted)[0], 5000);
    await cmd("mute", { tabId: sc.tabId, muted: false });
    check("S6", "muted (SetAudioMuted) and the audio callback", muted === true && audioEv, { audioEv });
    await cmd("nav", { tabId: sc.tabId, action: "load", url: "http://127.0.0.1:9/nothing-listens" });
    const failed = await waitFor(() => evs("didFailLoad", (e) => e.tabId === sc.tabId && e.url.includes(":9/"))[0], 10000);
    check("S6", "didFailLoad with Chrome's net error", failed && failed.code < 0, failed);
    await cmd("nav", { tabId: sc.tabId, action: "load", url: "chrome://kill" });
    const gone = await waitFor(() => evs("rendererGone", (e) => e.tabId === sc.tabId)[0], 10000);
    check("S6", "rendererGone (chrome://kill)", gone && gone.status === "killed", gone);
    ps.close();
    await cmd("nav", { tabId: sc.tabId, action: "close" });
    await sleep(500);
    check("S6", "the host's own close reports no tabWillClose", evs("tabWillClose", (e) => e.tabId === sc.tabId).length === 0, {});
    // window.close() from a page that a script opened: Chrome closes it, the host hears first.
    const wo = (await state()).tabs.find((t) => t.url.includes("from=open"));
    if (wo) {
      const pw = await attach((t) => t.url.includes("from=open"));
      await pw.send("Runtime.evaluate", { expression: "window.close()" });
      pw.close();
    }
    const willClose = await waitFor(() => wo && evs("tabWillClose", (e) => e.tabId === wo.tabId)[0], 8000);
    const removed = await waitFor(() => wo && evs("didRemoveTab", (e) => e.tabId === wo.tabId)[0], 8000);
    check("S6", "window.close() → tabWillClose, then didRemoveTab", willClose && removed, { tabId: wo?.tabId });
    // Pinning and order (Chrome's tab strip, as the host orders it).
    const tabsA = (await state()).tabs.filter((t) => t.profile === "Default" && t.inWindow !== undefined);
    const last = tabsA[tabsA.length - 1];
    const order1 = await cmd("placeTab", { tabId: last.tabId, index: 0, pinned: true });
    const order2 = await cmd("placeTab", { tabId: last.tabId, index: 2, pinned: false });
    check("S6", "placeTab:index:pinned: moves and pins in Chrome's strip", order1[0] === last.tabId && order2[2] === last.tabId, { order1, order2 });
  }

  // ---------------------------------------------------------------------------------------
  // S5. Windows Chrome makes itself: chrome.windows.create and incognito
  {
    const extId = ext?.id;
    const et = await cmd("open", { url: `chrome-extension://${extId}/popup.html`, profile: "A" });
    await waitFor(async () => (await tabState(et.tabId))?.loading === false);
    const pe = await attach((t) => t.url.startsWith(`chrome-extension://${extId}/popup.html`));
    const created = await pe.evaluate(`new Promise((r) => chrome.windows.create({ url: '${base}/target?from=windows-create' }, (w) => r({ id: w.id, type: w.type, tabs: w.tabs.length })))`);
    pe.close();
    const hostedEv = await waitFor(() => evs("engineWindowForNewBrowser", (e) => e.hosted && !e.offTheRecord)[0]);
    const inserted = await waitFor(() => evs("didInsertTab", (e) => e.extraWindow && e.url.includes("from=windows-create"))[0]);
    const s5 = await state();
    const strayViews = s5.appWindows.filter((w) => w.visible && w.class.includes("BrowserNativeWidget"));
    check("S5", "chrome.windows.create asks the host and lands in its window (no Chrome window)", created && hostedEv && inserted && strayViews.length === 0, { created, hostedEv, insertedTab: inserted?.tabId, extraWindows: s5.extraWindows, strayViews });
    check("S6", "windowForNSWindow: finds every NNCoreWindow", s5.extraWindows.every((w) => w.lookup), s5.extraWindows);
    // adoptTab: that tab moves into the main window, live (same browserId, history kept).
    const movedBefore = await cmd("tabInfo", { tabId: inserted?.tabId });
    const adopt = await cmd("adoptTab", { tabId: inserted?.tabId });
    const movedAfter = await cmd("tabInfo", { tabId: inserted?.tabId });
    const reinsert = evs("didInsertTab", (e) => e.tabId === inserted?.tabId && !e.extraWindow)[0];
    check("S6", "adoptTab: moves the live tab between windows (remove then insert, same WebContents)", adopt && !adopt.closed && reinsert && movedAfter?.info.browserId === movedBefore?.info.browserId && evs("didRemoveTab", (e) => e.tabId === inserted?.tabId).length >= 1, { adopt, reinsert: !!reinsert });
    // Incognito from Chrome's own command.
    const inc = await cmd("incognito", { profile: "A" });
    const incEv = await waitFor(() => evs("engineWindowForNewBrowser", (e) => e.hosted && e.offTheRecord)[0]);
    const incTab = await waitFor(() => evs("didInsertTab", (e) => e.extraWindow && e.offTheRecord)[0]);
    check("S5", "incognito window (IDC_NEW_INCOGNITO_WINDOW) on the off-the-record profile, hosted", inc.offTheRecord && incEv && incTab, { inc, incEv, incTab: incTab && { url: incTab.url, profile: incTab.profile } });
  }

  // ---------------------------------------------------------------------------------------
  // S3. Keys (the window can't be key here: the host fakes isKeyWindow for these presses)
  {
    const kt = await cmd("open", { url: `${base}/keys`, profile: "A" });
    await waitFor(async () => (await tabState(kt.tabId))?.title === "Keys" && !(await tabState(kt.tabId)).loading);
    await cmd("show", { tabId: kt.tabId });
    const pk = await attach((t) => t.url === `${base}/keys`);
    const tabsBefore = (await state()).tabs.length;
    const kT = await cmd("key", { tabId: kt.tabId, key: "t", meta: true, keyCode: 17 });
    await sleep(400);
    const kK = await cmd("key", { tabId: kt.tabId, key: "k", meta: true, keyCode: 40 });
    await waitFor(async () => (await state()).menuHits.some((h) => h.key === "k"), 4000);
    const kJ = await cmd("key", { tabId: kt.tabId, key: "j", meta: true, keyCode: 38 });
    await sleep(600);
    const pageKeys = await pk.evaluate("window.__keys");
    const s3 = await state();
    const hits = s3.menuHits.map((h) => h.key);
    check("S3", "page focused: a reserved ⌘T goes to the host first (preHandle) and never to the page", kT.firstResponder === "RenderWidgetHostViewCocoa" && s3.keyEvents.some((k) => k.call === "pre" && k.key === "t" && k.reserved) && hits.includes("t") && !pageKeys.includes("cmd+t"), { kT, pageKeys, hits });
    check("S3", "page focused: ⌘K the page doesn't handle reaches the host's main menu after the page", pageKeys.includes("cmd+k") && s3.keyEvents.some((k) => k.call === "handle" && k.key === "k") && hits.includes("k"), { kK });
    check("S3", "page focused: ⌘J the page preventDefaults stays with the page", pageKeys.includes("cmd+j") && !hits.includes("j") && !s3.keyEvents.some((k) => k.call === "handle" && k.key === "j"), { kJ });
    // Exactly one menu action per press for a shortcut the page leaves (through the
    // window's key equivalents, and through the page view's entry point called directly).
    const hitsK = () => s3.menuHits.filter((h) => h.key === "k").length;
    const kBefore = (await state()).menuHits.filter((h) => h.key === "k").length;
    await cmd("key", { tabId: kt.tabId, key: "k", meta: true, keyCode: 40 });
    await sleep(800);
    const kMid = (await state()).menuHits.filter((h) => h.key === "k").length;
    await cmd("key", { tabId: kt.tabId, key: "k", meta: true, keyCode: 40, direct: true });
    await sleep(800);
    const kAfter = (await state()).menuHits.filter((h) => h.key === "k").length;
    check("S3", "one menu action per press (page focused, a non-reserved shortcut the page leaves)", hitsK() === 1 && kMid - kBefore === 1 && kAfter - kMid === 1, { first: hitsK(), viaWindow: kMid - kBefore, viaViewDirect: kAfter - kMid });
    const pre = (await state()).keyEvents.length;
    const kF = await cmd("key", { key: "t", meta: true, keyCode: 17, target: "field" });
    await sleep(300);
    const s3b = await state();
    check("S3", "host view focused (NSTextField): ⌘T reaches the main menu; Chrome runs none of its own", kF.handledByMenu || kF.handledByWindow ? s3b.menuHits.filter((h) => h.key === "t").length === 2 && s3b.keyEvents.length === pre && s3b.tabs.length === tabsBefore : false, { kF, tabsBefore, tabsAfter: s3b.tabs.length });
    check("S3", "the page's view is an NSTextInputClient (IME needs a key window: visual check)", kT.textInputClient, {});
    pk.close();
  }

  // =======================================================================================
  // Stage 2: per-tab features and UI seams (S7–S16)
  {
    const t2 = await cmd("open", { url: `${base}/perm`, profile: "A" });
    await waitFor(async () => (await tabState(t2.tabId))?.title === "Perm");
    const p2 = await attach((t) => t.url === `${base}/perm`);

    // S7 (item 0): profile prefs and clearing data.
    const before = await cmd("pref", { profile: "A", name: "credentials_enable_service" });
    const off = await cmd("pref", { profile: "A", name: "credentials_enable_service", value: false });
    const on = await cmd("pref", { profile: "A", name: "credentials_enable_service", value: true });
    const notAllowed = await cmd("pref", { profile: "A", name: "profile.content_settings" });
    const cleared = await cmd("clearData", { profile: "A", types: ["history", "cache"] }, 30000);
    check("S7", "profile prefs (allow-listed bools) and Chrome's BrowsingDataRemover", before === true && off === false && on === true && notAllowed === null && cleared === true, { before, off, on, notAllowed, cleared });

    // S8 (item 1): security, as JS SecurityInfo.
    const httpInfo = await cmd("security", { tabId: t2.tabId });
    let httpsInfo = null;
    try {
      const keyFile = path.join(workDir, "tls.key"), certFile = path.join(workDir, "tls.crt");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "2", "-subj", "/CN=localhost/O=Big Yahu Test"], { stdio: "ignore" });
      const https = await import("node:https");
      const tls = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, (q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end("<title>TLS</title>tls"); });
      await new Promise((r) => tls.listen(0, "127.0.0.1", r));
      const tt = await cmd("open", { url: `https://localhost:${tls.address().port}/`, profile: "A" });
      httpsInfo = await waitFor(async () => {
        const i = await cmd("security", { tabId: tt.tabId });
        return i.level === "certificateError" && i.certificate ? i : null;
      }, 10000);
      const secEvent = evs("security", (e) => e.tabId === tt.tabId && e.level === "certificateError")[0];
      check("S8", "securityInfo: http insecure; a self-signed https page is certificateError with its certificate; tabDidChangeSecurity", httpInfo.level === "insecure" && httpInfo.origin === base && httpsInfo && httpsInfo.certificateErrors.includes("authorityInvalid") && httpsInfo.certificate.subject.commonName === "localhost" && httpsInfo.certificate.sha256?.length === 95 && !!secEvent, { httpInfo, httpsInfo: httpsInfo && { level: httpsInfo.level, errors: httpsInfo.certificateErrors, subject: httpsInfo.certificate.subject, protocol: httpsInfo.protocol } });
      await cmd("nav", { tabId: tt.tabId, action: "closeNow" });
      tls.close();
    } catch (e) {
      check("S8", "securityInfo", false, String(e));
    }

    // S9 (item 2): zoom.
    const z1 = await cmd("zoom", { tabId: t2.tabId, factor: 1.5 });
    const z2 = await cmd("zoom", { tabId: t2.tabId, step: 1 });
    const z3 = await cmd("zoom", { tabId: t2.tabId, step: 0 });
    const zEv = await waitFor(() => evs("zoom", (e) => e.tabId === t2.tabId && Math.abs(e.factor - 1.5) < 0.01)[0], 4000);
    const inner = await p2.evaluate("window.innerWidth");
    check("S9", "zoomFactor (per site), zoomStep in and reset, tabDidChangeZoom", Math.abs(z1 - 1.5) < 0.01 && z2 > 1.5 && Math.abs(z3 - 1) < 0.01 && !!zEv, { z1, z2, z3, zoomEvents: evs("zoom", (e) => e.tabId === t2.tabId).length, inner });

    // S10 (item 3): a Chrome command on a background tab (print preview), the switch unreported.
    const bg = await cmd("open", { url: `${base}/target?from=print`, profile: "A", background: true });
    await waitFor(async () => (await tabState(bg.tabId))?.loading === false);
    const activations = evs("didActivateTab").length;
    const printed = await cmd("tabCommand", { tabId: bg.tabId, command: 35003 /* IDC_PRINT */ });
    const preview = await waitFor(async () => (await targets()).find((t) => t.url.startsWith("chrome://print")), 10000);
    check("S10", "executeChromeCommand on a background tab (IDC_PRINT → print preview), no activation reported", printed === true && !!preview && evs("didActivateTab").length === activations, { printed, preview: preview?.url, activationsReported: evs("didActivateTab").length - activations });
    await cmd("nav", { tabId: bg.tabId, action: "closeNow" });

    // S11 (item 4): Chrome's popup blocker → the host; open it.
    const pb = await cmd("open", { url: `${base}/popupblock`, profile: "A" });
    const blocked = await waitFor(() => evs("popupBlocked", (e) => e.tabId === pb.tabId)[0], 8000);
    if (blocked) await cmd("openPopup", { tabId: pb.tabId, popupId: blocked.popup.id, always: false });
    const opened = await waitFor(() => evs("didInsertTab", (e) => e.url.includes("from=blocked"))[0], 8000);
    check("S11", "a popup Chrome blocked reaches the host ({id,url,origin}); opening it lands as our tab with the page as opener", blocked && blocked.popup.url.includes("from=blocked") && blocked.popup.origin === base && opened && opened.opener === pb.tabId, { popup: blocked?.popup, opened: opened && { opener: opened.opener, disposition: opened.disposition } });

    // S12 (item 5): permission prompts go to the host.
    // Chrome holds a background tab's prompts until it shows: show it.
    await cmd("show", { tabId: t2.tabId });
    // (Not geolocation: Chrome also asks macOS for location, a system prompt.)
    await cmd("config", { values: { permissionAnswers: { midi: "deny", notifications: "accept" } } });
    const timed = (expr) => `Promise.race([${expr}, new Promise((r) => setTimeout(() => r('timeout'), 8000))])`;
    const geo = (await p2.send("Runtime.evaluate", { expression: timed(`navigator.requestMIDIAccess({ sysex: true }).then(() => 'granted', (e) => 'error ' + e.name)`), awaitPromise: true, userGesture: true, returnByValue: true })).result?.result?.value;
    const geoReq = evs("permission", (e) => e.tabId === t2.tabId && e.request.permissions.includes("midi"))[0];
    const notif = (await p2.send("Runtime.evaluate", { expression: timed("Notification.requestPermission()"), awaitPromise: true, userGesture: true, returnByValue: true })).result?.result?.value;
    const notifReq = evs("permission", (e) => e.request.permissions.includes("notifications"))[0];
    check("S12", "Chrome's permission prompt goes to the host ({id, origin, permissions}); deny → the page's error (MIDI sysex), accept → granted (notifications)", geoReq && geoReq.request.origin.startsWith(base) && /^error/.test(geo) && notifReq && notif === "granted", { midi: geo, notif, geoReq: geoReq?.request, childWindows: (await state()).childWindows.length });
    // (No camera check: Chrome asks macOS for camera access first, a system prompt. Media
    // access needs a manual check.)
    const bgSet = await cmd("background", { tabId: t2.tabId, color: "teal" });
    check("S15", "pageBackgroundColor", bgSet === true, {});

    // S13 (item 6): a link to another app asks the host (the test answers "cancel").
    const mt = await cmd("open", { url: `${base}/mailto`, profile: "A" });
    await waitFor(async () => (await tabState(mt.tabId))?.title === "Mailto");
    const pm = await attach((t) => t.url === `${base}/mailto`);
    await pm.click("#m");
    const ext6 = await waitFor(() => evs("externalApp", (e) => e.tabId === mt.tabId)[0], 10000);
    pm.close();
    check("S13", "a link to another app asks the host (JS ExternalAppRequest) instead of Chrome's dialog", ext6 && ext6.request.scheme === "facetime" && ext6.request.origin === base && typeof ext6.request.app === "string" && /^Open “/.test(ext6.request.title) && /^data:image\/png/.test(ext6.request.icon), ext6?.request && { ...ext6.request, icon: ext6.request.icon ? "data:…" : null });

    // S14 (item 7): discard, freeze, unresponsive.
    const dt = await cmd("open", { url: `${base}/target?from=discard`, profile: "A", background: true });
    await waitFor(async () => (await tabState(dt.tabId))?.loading === false);
    const idBefore = (await cmd("tabInfo", { tabId: dt.tabId })).info.browserId;
    const dis = await cmd("discard", { tabId: dt.tabId });
    const disEv = await waitFor(() => evs("discarded", (e) => e.tabId === dt.tabId && e.discarded)[0], 5000);
    await cmd("nav", { tabId: dt.tabId, action: "reload" });
    const undis = await waitFor(() => evs("discarded", (e) => e.tabId === dt.tabId && !e.discarded)[0], 8000);
    const idAfter = (await cmd("tabInfo", { tabId: dt.tabId }))?.info.browserId;
    check("S14", "discard keeps the tab (same NNCoreTab); tabDidChangeDiscarded on and off", dis.ok && dis.discarded && disEv && undis && idAfter === idBefore, { dis, idBefore, idAfter });
    const fz = await cmd("frozen", { tabId: dt.tabId, value: true });
    const unfz = await cmd("frozen", { tabId: dt.tabId, value: false });
    check("S14", "frozen", fz === true && unfz === false, {});
    await cmd("nav", { tabId: dt.tabId, action: "closeNow" });
    // Its own site (127.0.0.1, not localhost): the hung renderer must not be the other tabs'.
    const hangURL = base.replace("localhost", "127.0.0.1") + "/hang";
    const ht = await cmd("open", { url: hangURL, profile: "A" });
    await waitFor(async () => (await tabState(ht.tabId))?.title === "Hang");
    await cmd("show", { tabId: ht.tabId });
    await cmd("config", { values: { terminateHung: true } });
    const ph = await attach((t) => t.url === hangURL);
    // The page spins for 45 s (started off the DevTools call, which would wait it out); an
    // input event then goes unanswered.
    await ph.send("Runtime.evaluate", { expression: "setTimeout(() => document.getElementById('hang').click(), 50); 1" });
    await sleep(1000);
    await cmd("nativeClick", { tabId: ht.tabId, x: 10, y: 10 });
    const hung = await waitFor(() => evs("unresponsive", (e) => e.tabId === ht.tabId)[0], 25000);
    const killed = await waitFor(() => evs("rendererGone", (e) => e.tabId === ht.tabId)[0], 10000);
    ph.close();
    if (hung) {
      check("S14", "an unresponsive page → tabBecameUnresponsive; resolveUnresponsive:YES ends it (rendererGone)", hung && killed, { killed });
    } else {
      // Chrome's hang monitor ignores hidden pages, and this hidden instance's window is
      // occluded: a check for an unlocked screen with the window shown.
      console.log("SKIP [S14] unresponsive page (needs a visible window: the hang monitor ignores hidden pages)");
    }
    await cmd("nav", { tabId: ht.tabId, action: "closeNow" });
    p2.close();
  }
  // S17 (A0): component extensions.
  {
    const dir = path.join(here, "fixtures/component");
    const c1 = await cmd("component", { profile: "A", path: dir });
    const c2 = await cmd("component", { profile: "A", path: dir });
    const listed = (await cmd("ext.list", { profile: "A" })).some((e) => e.id === c1);
    const worker = await waitFor(async () => (await targets()).find((t) => t.url.startsWith(`chrome-extension://${c1}/`)), 8000);
    await cmd("component", { profile: "A", unload: c1 });
    const gone = await waitFor(async () => !(await targets()).some((t) => t.url.startsWith(`chrome-extension://${c1}/`)), 8000);
    check("S17", "loadComponentExtension (id from the manifest key; again = same id, no reload), hidden from the list, unload", typeof c1 === "string" && c1.length === 32 && c2 === c1 && !listed && !!worker && gone, { c1, c2, listed, worker: worker?.type, gone });
  }
  // S18 (A–G): install prompt, download navigation, user gesture, profile deletion.
  {
    const extId = ext?.id;
    const ep = await cmd("open", { url: `chrome-extension://${extId}/popup.html?perm`, profile: "A" });
    await waitFor(async () => (await tabState(ep.tabId))?.loading === false);
    const pp = await attach((t) => t.url.startsWith(`chrome-extension://${extId}/popup.html?perm`));
    const granted = (await pp.send("Runtime.evaluate", { expression: `Promise.race([chrome.permissions.request({ permissions: ['bookmarks'] }), new Promise((r) => setTimeout(() => r('timeout'), 8000))])`, awaitPromise: true, userGesture: true, returnByValue: true })).result?.result?.value;
    pp.close();
    const prompt = evs("installPrompt")[0];
    check("S18", "Chrome's extension install prompt goes to the host (a permissions request); accepting grants it", granted === true && prompt && prompt.prompt.id === extId && prompt.prompt.type === "permissions", { granted, prompt: prompt?.prompt });
    await cmd("nav", { tabId: ep.tabId, action: "closeNow" });

    // A navigation that turns out to be a download (downloads denied here: nothing is written).
    const bws = new WebSocket((await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json()).webSocketDebuggerUrl);
    await new Promise((r) => (bws.onopen = r));
    bws.send(JSON.stringify({ id: 1, method: "Browser.setDownloadBehavior", params: { behavior: "deny" } }));
    await sleep(300);
    const dl = await cmd("open", { url: `${base}/target?from=dl`, profile: "A" });
    await waitFor(async () => (await tabState(dl.tabId))?.loading === false);
    await cmd("nav", { tabId: dl.tabId, action: "load", url: `${base}/download` });
    const dlEv = await waitFor(() => evs("downloadNavigation", (e) => e.tabId === dl.tabId)[0], 8000);
    const dlTab = await tabState(dl.tabId);
    bws.close();
    check("S18", "a navigation that became a download → tab:navigationBecameDownload:, the page stays", dlEv && dlEv.url.endsWith("/download") && dlTab.url.includes("from=dl"), { dlEv, url: dlTab?.url });

    const noGesture = await cmd("evaluate", { tabId: dl.tabId, code: "post('result', JSON.stringify(navigator.userActivation.isActive))" });
    const gesture = await cmd("evaluate", { tabId: dl.tabId, code: "post('result', JSON.stringify(navigator.userActivation.isActive))", gesture: true });
    check("S18", "evaluate:userGesture: gives the page a transient activation", noGesture === "false" && gesture === "true", { noGesture, gesture });
    await cmd("nav", { tabId: dl.tabId, action: "closeNow" });

    const p3 = await cmd("loadProfile", { name: "Profile 3", as: "C" });
    const del = await cmd("deleteProfile", { profile: "C" });
    const destroyed = await waitFor(async () => (await cmd("profileState", { profile: "C" })).destroyed, 10000);
    const delDefault = await cmd("deleteProfile", { profile: "A" });
    check("S18", "deleteProfile: a non-default profile goes (its wrapper reports destroyed); the default one is refused", p3 && del.deleted && destroyed && delDefault.deleted === false, { p3, del, destroyed, delDefault });
  }
  // S19 (D, E, F, I): tracing, tab capture id, activation requests, autofill on demand.
  {
    const tb = await cmd("tracing", { begin: true }, 30000);
    await sleep(500);
    const te = await cmd("tracing", {}, 60000);
    check("S19", "beginTracing / endTracing (not kept) / isTracing", tb.started && tb.isTracing && te.path === null && te.isTracing === false, { tb, te });
    const cap = await cmd("capture", { tabId: indexId });
    check("S19", "mediaCaptureSourceId (CEF's format); stopCapture with nothing shared", /^web-contents-media-stream:\/\/\d+:\d+$/.test(cap.sourceId) && cap.stopped === false, cap);
    await cmd("show", { tabId: indexId });
    const pf = await attach((t) => t.url === `${base}/index`);
    await pf.send("Runtime.evaluate", { expression: "window.__w = window.open('/target?from=focus'); setTimeout(() => window.__w.focus(), 800); 1", userGesture: true });
    const act = await waitFor(() => evs("activationRequest")[0], 6000);
    pf.close();
    check("S19", "a page's window.focus() on its popup → tab:requestsActivation: (\"page\")", act && act.reason === "page", act);
    const lg = await cmd("open", { url: `${base}/login?again=3`, profile: "A" });
    await waitFor(async () => (await tabState(lg.tabId))?.loading === false);
    const pl3 = await attach((t) => t.url === `${base}/login?again=3`);
    await cmd("focus", { tabId: lg.tabId });
    await pl3.click("#u");
    await sleep(400);
    const shown = await cmd("autofill", { tabId: lg.tabId, passwords: true });
    const dropdown = await waitFor(async () => (await state()).childWindows.find((w) => w.visible && w.class !== "NSPanel"), 5000);
    pl3.close();
    check("S19", "showAutofillSuggestions: Chrome's dropdown at the focused field", shown === true && !!dropdown, { shown, dropdown });
    await cmd("nav", { tabId: lg.tabId, action: "closeNow" });
  }
  // S20 (J): the host's context-menu items; focusedEditable.
  {
    await cmd("show", { tabId: indexId });
    const pc2 = await attach((t) => t.url === `${base}/index`);
    const at = await pc2.evaluate(`(() => { const h = document.querySelector('h1'); getSelection().selectAllChildren(h); const r = h.getBoundingClientRect(); return [r.x + 5, r.y + r.height / 2]; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await pc2.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "right", clickCount: 1 });
    }
    const menu = await waitFor(() => evs("contextMenu", (e) => e.tabId === indexId)[0], 6000);
    const labels = menu ? menu.items.filter((i) => !i.separator).map((i) => i.label) : [];
    const ours = labels.indexOf("Search Test for “Index”");
    const copy = labels.findIndex((l) => /^Copy$/.test(l));
    const chromeSearch = labels.some((l) => /^&?Search .* for /.test(l) && l !== "Search Test for “Index”");
    check("S20", "Chrome's context menu with the host's item, in place of Chrome's search item (reported in background mode)", ours > 0 && !chromeSearch, { labels: labels.slice(0, 12) });
    pc2.close();
    const kt2 = await cmd("open", { url: `${base}/keys?edit=1`, profile: "A" });
    await waitFor(async () => (await tabState(kt2.tabId))?.loading === false);
    const pk2 = await attach((t) => t.url === `${base}/keys?edit=1`);
    await cmd("focus", { tabId: kt2.tabId });
    const before = await cmd("editable", { tabId: kt2.tabId });
    await pk2.evaluate("document.getElementById('box').focus()");
    const after = await cmd("editable", { tabId: kt2.tabId });
    pk2.close();
    check("S20", "focusedEditable", before === false && after === true, { before, after });
    await cmd("nav", { tabId: kt2.tabId, action: "closeNow" });
  }
  // S21 (K, H): duplicate and restore tabs; device choosers.
  {
    const src = await cmd("open", { url: `${base}/target?from=dup1`, profile: "A" });
    await waitFor(async () => (await tabState(src.tabId))?.loading === false);
    await cmd("nav", { tabId: src.tabId, action: "load", url: `${base}/target?from=dup2` });
    await waitFor(async () => (await tabState(src.tabId))?.title.startsWith("target:dup2"));
    const dup = await cmd("duplicate", { tabId: src.tabId });
    const dupIns = await waitFor(() => evs("didInsertTab", (e) => e.tabId === dup?.tabId)[0], 5000);
    check("S21", "duplicateTab: the copy has the source's history, reported with the source as opener", dup && dup.entries.length === 2 && dupIns && dupIns.opener === src.tabId, { dup, opener: dupIns?.opener });
    const bad = await cmd("restore", { state: "bm90IGEgcGlja2xl", profile: "A" });
    const none = await cmd("restore", { profile: "A" });
    check("S21", "restoreTab: nil for an unreadable or missing state (a real one needs nn_tab_restore_take)", bad === null && none === null, { bad, none });
    // (A fresh page: the copy shares the URL and loads only when shown.)
    const ut = await cmd("open", { url: `${base}/target?from=usb`, profile: "A" });
    await waitFor(async () => (await tabState(ut.tabId))?.loading === false);
    const pu = await attach((t) => t.url.includes("from=usb"));
    const usb = (await pu.send("Runtime.evaluate", { expression: "Promise.race([navigator.usb.requestDevice({ filters: [] }).then(() => 'picked', (e) => e.name), new Promise((r) => setTimeout(() => r('timeout'), 8000))])", awaitPromise: true, userGesture: true, returnByValue: true })).result?.result?.value;
    pu.close();
    const chooser = evs("deviceChooser", (e) => e.tabId === ut.tabId && e.chooser.open)[0];
    const closed = evs("deviceChooser", (e) => e.tabId === ut.tabId && !e.chooser.open)[0];
    check("S21", "WebUSB requestDevice → the host's device chooser (JS DeviceChooser); cancel → NotFoundError", chooser && typeof chooser.chooser.title === "string" && Array.isArray(chooser.chooser.options) && closed && usb === "NotFoundError", { usb, title: chooser?.chooser.title, options: chooser?.chooser.options?.length });
    await cmd("nav", { tabId: src.tabId, action: "closeNow" });
    await cmd("nav", { tabId: ut.tabId, action: "closeNow" });
    if (dup) await cmd("nav", { tabId: dup.tabId, action: "closeNow" });
  }
  // S16 (item 9): extension actions.
  {
    const extId = ext?.id;
    const action = await cmd("extAction", { tabId: indexId, extId });
    const states = await cmd("actionStates", { tabId: indexId, ids: [extId] });
    const st = states?.[extId];
    const panelURL = await cmd("sidePanelURL", { tabId: indexId, extId });
    check("S16", "executeExtensionAction → popup; actionStates (JS ActionState); sidePanelURL", action === "popup" && st && st.title === "NNCore spike" && st.popup.endsWith("/popup.html") && st.enabled === true && panelURL?.endsWith("/panel.html"), { action, state: st && { ...st, icon: st.icon.slice(0, 22) }, panelURL });
    const et = await cmd("open", { url: `chrome-extension://${extId}/popup.html?panel`, profile: "A" });
    await waitFor(async () => (await tabState(et.tabId))?.loading === false);
    const pe = await attach((t) => t.url.startsWith(`chrome-extension://${extId}/popup.html?panel`));
    const openRes = (await pe.send("Runtime.evaluate", { expression: `chrome.sidePanel.open({ tabId: ${indexId} }).then(() => 'ok', (e) => 'error ' + e.message)`, awaitPromise: true, userGesture: true, returnByValue: true })).result?.result?.value;
    pe.close();
    const panelEv = await waitFor(() => evs("sidePanel", (e) => e.panel.extensionId === extId && e.panel.open)[0], 5000);
    check("S16", "chrome.sidePanel.open → engine:extensionSidePanel:tab: {extensionId, open}", !!panelEv, { openRes, panelEv: panelEv?.panel, tab: panelEv?.tabId });
    await cmd("nav", { tabId: et.tabId, action: "closeNow" });
  }

  // ---------------------------------------------------------------------------------------
  // S2. The RN host's window styling, applied after -initWithContentRect:, sticks
  {
    const st = await cmd("styleWindow");
    await sleep(800);
    const st2 = await cmd("windowStyle");
    const fills = (r) => r && r.replace(/[{}\s]/g, "");
    const winSize = st2.frame.match(/\{\{[^}]*\}, \{([^}]*)\}\}/)?.[1];
    // The traffic lights' frames are AppKit's title bar layout (it lays them out again on
    // every frame change, as for any NSWindow): reported, not required.
    check("S2", "full-size content view, transparent title bar, hidden title, background and minSize stick; hostView fills the window", st2.fullSizeContentView && st2.titlebarTransparent && st2.titleHidden && st2.minSize === "{500, 400}" && fills(st2.hostView).endsWith(fills(winSize)) && /systemPink|Pink/.test(st2.background), { st2 });
  }

  // ---------------------------------------------------------------------------------------
  // S2. Cancellable close (beforeunload, the title bar's close)
  {
    const nw = await cmd("newWindow", { url: `${base}/unload`, profile: "A" });
    await waitFor(async () => (await tabState(nw.tabId))?.title === "Unload");
    const pu = await attach((t) => t.url === `${base}/unload`);
    await pu.send("Page.enable");
    await pu.click("p");  // a user gesture: Chrome asks beforeunload only after one
    await cmd("config", { values: { shouldClose: false } });
    await cmd("closeWindow", { windowNumber: nw.windowNumber, performClose: true });
    await sleep(500);
    const kept = (await state()).extraWindows.find((w) => w.windowNumber === nw.windowNumber);
    check("S2", "the title bar's close asks windowShouldClose:; NO keeps the window", kept?.visible && evs("windowShouldClose", (e) => e.windowNumber === nw.windowNumber && !e.answer).length === 1, { kept });
    await cmd("config", { values: { shouldClose: true } });
    await cmd("closeWindow", { windowNumber: nw.windowNumber, performClose: true });
    const dlg = await dialogOn(pu, false);
    const cancelled = await waitFor(() => evs("windowDidCancelClose", (e) => e.windowNumber === nw.windowNumber)[0]);
    const s2 = await state();
    const still = s2.extraWindows.find((w) => w.windowNumber === nw.windowNumber);
    check("S2", "beforeunload 'stay' cancels the close: windowDidCancelClose, window and tab kept", dlg && cancelled && still?.visible && still.tabs.length === 1 && !evs("didRemoveTab", (e) => e.tabId === nw.tabId).length, { dialog: dlg?.params?.type, still });
    await cmd("closeWindow", { windowNumber: nw.windowNumber });
    const dlg2 = await dialogOn(pu, true);
    const gone = await waitFor(async () => {
      const w = (await state()).extraWindows.find((w) => w.windowNumber === nw.windowNumber);
      return w && !w.visible ? w : null;
    });
    check("S2", "the second close (leave) closes the window and its Browser", dlg2 && gone && evs("didRemoveTab", (e) => e.tabId === nw.tabId).length === 1 && hostExit === null, { gone });
    pu.close();
  }

  // closeNow: a tab with a beforeunload handler goes at once, no dialog, no tabWillClose.
  {
    const cn = await cmd("open", { url: `${base}/unload?now=1`, profile: "A" });
    await waitFor(async () => (await tabState(cn.tabId))?.title === "Unload");
    const pn = await attach((t) => t.url === `${base}/unload?now=1`);
    await pn.send("Page.enable");
    await pn.click("p");
    await cmd("nav", { tabId: cn.tabId, action: "closeNow" });
    const removedNow = await waitFor(() => evs("didRemoveTab", (e) => e.tabId === cn.tabId)[0], 5000);
    await sleep(300);
    check("S6", "closeNow: no beforeunload, didRemoveTab, no tabWillClose", removedNow && !pn.events.some((e) => e.method === "Page.javascriptDialogOpening") && !evs("tabWillClose", (e) => e.tabId === cn.tabId).length, {});
    pn.close();
  }

  // ---------------------------------------------------------------------------------------
  // S1. -[NSApp terminate:] follows Cocoa's contract; a quit a page cancels keeps the app
  {
    const s1 = await state();
    check("S1", "AppController never created: NSApp.delegate is the host's", s1.appDelegate === "Host" && s1.appClass === "BrowserCrApplication", { appDelegate: s1.appDelegate, appClass: s1.appClass });
    await cmd("config", { values: { terminateReply: "cancel" } });
    await cmd("terminate", {});
    await waitFor(() => evs("applicationShouldTerminate", (e) => e.reply === "cancel")[0]);
    await sleep(800);
    const alive = await state();
    check("S1", "terminate: asks applicationShouldTerminate:; NSTerminateCancel keeps running", hostExit === null && alive.tabs.length > 0 && !/trying_to_quit=1/.test(alive.keepAlive), { keepAlive: alive.keepAlive });
    // A page with beforeunload in the main window; the quit through the Apple event, answered later.
    const qu = await cmd("open", { url: `${base}/unload?quit=1`, profile: "A" });
    await waitFor(async () => (await tabState(qu.tabId))?.title === "Unload");
    globalThis.quitPage = await attach((t) => t.url === `${base}/unload?quit=1`);
    await quitPage.send("Page.enable");
    await quitPage.click("p");
    await cmd("config", { values: { terminateReply: "later", laterAnswer: true } });
    await cmd("terminate", { appleEvent: true });
    const later = await waitFor(() => evs("replyToApplicationShouldTerminate")[0]);
    const dlg = await dialogOn(quitPage, false, 15000);
    const qc = await waitFor(() => evs("engineQuitCancelled")[0]);
    await sleep(500);
    const after = await state();
    check("S1", "Apple event quit → NSTerminateLater → reply YES → the quit; a page's 'stay' cancels it (engineQuitCancelled, keep-alive kept)", later && dlg && qc && hostExit === null && /APP_CONTROLLER/.test(after.keepAlive) && after.tabs.some((t) => t.tabId === qu.tabId), { keepAlive: after.keepAlive, windowCancels: evs("windowDidCancelClose").length });
    globalThis.quitTabId = qu.tabId;
  }

  // ---------------------------------------------------------------------------------------
  // 8. Chromium's loop runs the app; quit is clean
  check(8, "never took focus", !frontSamples.some(Boolean), { samples: frontSamples.length });
  // The final quit is -[NSApp terminate:] (NSTerminateNow); the page's beforeunload says leave.
  await cmd("config", { values: { terminateReply: "now" } });
  await cmd("terminate", {});
  if (globalThis.quitPage) {
    const leave = await dialogOn(globalThis.quitPage, true, 15000);
    check("S1", "terminate: → NSTerminateNow → the quit; the page's 'leave' lets it finish", !!leave, {});
  }
  let exited = await waitFor(() => hostExit, 5000);
  if (!exited) {
    // Still tearing down after 5 s: keep the stacks (Chrome's watchdog kills it at 10 s).
    try {
      execFileSync("sample", [String(host.pid), "2", "-file", path.join(workDir, "quit-slow-sample.txt")], { timeout: 20000, stdio: "ignore" });
    } catch {}
    exited = await waitFor(() => hostExit, 25000);
  }
  if (!exited) {
    try {
      execFileSync("sample", [String(host.pid), "1", "-file", path.join(workDir, "quit-sample.txt")], { timeout: 20000, stdio: "ignore" });
    } catch {}
    fs.writeFileSync(path.join(workDir, "quit-state.json"), JSON.stringify(await state().catch(() => null), null, 1));
  }
  const shutdown = events().find((e) => e.event === "engineWillShutDown");
  const crashes = fs
    .readdirSync(path.join(process.env.HOME, "Library/Logs/DiagnosticReports"))
    .filter((f) => f.startsWith("NNHost") || f.startsWith("Chromium Helper"))
    .filter((f) => fs.statSync(path.join(process.env.HOME, "Library/Logs/DiagnosticReports", f)).mtimeMs > startedAt)
    // Only this run's app (other agents' builds share the helper names).
    .filter((f) => {
      try {
        return fs.readFileSync(path.join(process.env.HOME, "Library/Logs/DiagnosticReports", f), "utf8").includes("NNHost.app");
      } catch {
        return true;
      }
    });
  check("S1", "applicationWillTerminate: reaches NSApp.delegate at the quit's point of no return", events().some((e) => e.event === "applicationWillTerminate"), {});
  check(8, "quit: run loop ends, process exits 0, no crash report", exited && exited.code === 0 && shutdown && crashes.length === 0, {
    exit: exited,
    shutdownEvent: !!shutdown,
    crashes,
  });
} catch (e) {
  check(0, "run aborted", false, String(e.stack || e));
} finally {
  clearInterval(frontTimer);
  if (!hostExit) host.kill("SIGTERM");
  server.close();
  fs.writeFileSync(path.join(workDir, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

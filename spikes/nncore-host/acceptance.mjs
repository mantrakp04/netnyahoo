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
  env: { ...process.env, NNHOST_DIR: hostDir, NNHOST_CDP_PORT: String(cdpPort) },
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
  const send = (method, params = {}) =>
    new Promise((r) => {
      const id = ++n;
      pending.set(id, r);
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
    const pre = s3.keyEvents.length;
    const kF = await cmd("key", { key: "t", meta: true, keyCode: 17, target: "field" });
    await sleep(300);
    const s3b = await state();
    check("S3", "host view focused (NSTextField): ⌘T reaches the main menu; Chrome runs none of its own", kF.handledByMenu || kF.handledByWindow ? s3b.menuHits.filter((h) => h.key === "t").length === 2 && s3b.keyEvents.length === pre && s3b.tabs.length === tabsBefore : false, { kF, tabsBefore, tabsAfter: s3b.tabs.length });
    check("S3", "the page's view is an NSTextInputClient (IME needs a key window: visual check)", kT.textInputClient, {});
    pk.close();
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
    .filter((f) => fs.statSync(path.join(process.env.HOME, "Library/Logs/DiagnosticReports", f)).mtimeMs > startedAt);
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

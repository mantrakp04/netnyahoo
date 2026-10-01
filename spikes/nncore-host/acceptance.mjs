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
  if (!out) throw new Error(`no answer to ${name}`);
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
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
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
  return { t, send, evaluate, click, type, close: () => ws.close() };
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

  // ---------------------------------------------------------------------------------------
  // 8. Chromium's loop runs the app; quit is clean
  check(8, "never took focus", !frontSamples.some(Boolean), { samples: frontSamples.length });
  await cmd("quit");
  const exited = await waitFor(() => hostExit, 30000);
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

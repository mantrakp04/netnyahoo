#!/usr/bin/env node
// Stage 1 acceptance for the app on NNCore (docs/nncore-parity.md): boots the NNCore build of the app hidden
// (NETNYAHOO_BACKGROUND=1, its own data dir and DevTools port), serves fixture pages, and drives the real app
// through its dev harness (lib/devHarness.ts: $NETNYAHOO_DATA_DIR/dev-eval.js) and Chrome's DevTools protocol.
//
//   node packages/nncore/scripts/acceptance.mjs <NetnyahooNNCore.app> <scratch dir> [check…]
//
// It never takes focus and never touches a real profile: the data dir is <scratch dir>/data, wiped first.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const [appArg, scratchArg, ...only] = process.argv.slice(2);
if (!appArg || !scratchArg) {
  console.error("usage: acceptance.mjs <NetnyahooNNCore.app> <scratch dir> [check…]");
  process.exit(64);
}
const app = resolve(appArg);
const scratch = resolve(scratchArg);
const data = join(scratch, "data");
const port = 9400 + Math.floor(Math.random() * 400);
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const log = (...a) => console.log(...a);

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
  res.writeHead(200, { "content-type": "text/html" });
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

// The Metro server this tree's JS comes from (METRO_PORT, default 8081): the NNCore build has its own defaults
// domain, so this never touches the CEF app's.
execFileSync("defaults", ["write", "com.netnyahoo.browser.nncore", "RCT_jsLocation", `localhost:${process.env.METRO_PORT ?? 8081}`]);

// As AGENTS.md says: `open -g -n` with the environment, never a plain open, so it can't take focus.
const exe = join(app, "Contents/MacOS/NetnyahooNNCore");
const stdout = join(scratch, "app.out.log");
const pidsBefore = new Set(pgrep());
execFileSync("open", [
  "-g", "-n",
  "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`,
  "--stdout", stdout, "--stderr", stdout,
  app,
]);
function pgrep() {
  try {
    return execFileSync("pgrep", ["-f", `^${exe}`]).toString().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}
const pid = await (async () => {
  for (let i = 0; i < 100; i++) {
    const fresh = pgrep().filter((p) => !pidsBefore.has(p));
    if (fresh.length) return fresh[0];
    await sleep(100);
  }
  throw new Error("the app didn't start");
})();
const child = { pid, kill: (sig) => { try { process.kill(pid, sig); } catch {} } };
let exited = null;
const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
setInterval(() => { if (!exited && !alive()) exited = { pid }; }, 300).unref();
const appLog = { join: () => (existsSync(stdout) ? readFileSync(stdout, "utf8") : "") };
writeFileSync(join(scratch, "app.pid"), String(pid));

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
const state = () =>
  evalApp(`const s = nn.store.getState(); const w = Object.values(s.windows)[0];
    return { windowId: w?.id, profileId: w?.profileId, tabs: (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url, title: s.tabs[id]?.title, favicon: s.tabs[id]?.favicon?.slice(0, 40), adoptId: s.tabs[id]?.adoptId, profileId: s.tabs[id]?.profileId, loading: s.live[id]?.isLoading, back: s.live[id]?.canGoBack, fwd: s.live[id]?.canGoForward })), active: w ? w.activeTabIds[w.profileId] : null, windows: Object.keys(s.windows).length, profiles: s.profileOrder };`);

async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  const started = Date.now();
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
    return { chromium: info.chromiumVersion, windows: s.windows, tabs: s.tabs.length, pid: child.pid };
  });

  let first;
  await check("open-url", async () => {
    await evalApp(`nn.actions.openUrls(["${base}/a"]); return true`);
    const s = await until("tab A titled", async () => {
      const s = await state();
      const t = s.tabs.find((t) => t.url?.startsWith(`${base}/a`));
      return t && t.title === "Page A" && !t.loading ? { s, t } : null;
    });
    first = s.t;
    const t = await pageTarget(`${base}/a`);
    if (!t) throw new Error("no CDP target for A");
    return { tab: s.t.id, title: s.t.title, active: s.s.active === s.t.id };
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

  await check("second-profile", async () => {
    const s = await state();
    const id = await evalApp(`return nn.store.getState().createProfile({ name: "Work" })`);
    if (!id) throw new Error("no profile made");
    await evalApp(`nn.actions.switchProfile("${s.windowId}", "${id}"); return true`);
    await until("profile shown", async () => (await state()).profileId === id);
    await evalApp(`nn.actions.openUrls(["${base}/cookie?B"]); return true`);
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

  await check("quit", async () => {
    const s = await state();
    // A tab opened just before quitting must be in the saved session: the app saved it on the way out
    // (willQuit → flushPersistence, the documents flushed on willTerminate).
    await evalApp(`nn.actions.openUrls(["${base}/quit-marker"]); return true`);
    await until("the marker tab", async () => (await state()).tabs.some((x) => x.url?.includes("quit-marker")));
    const started = Date.now();
    // ⌘Q → the app's Quit item → NSApp terminate: → applicationShouldTerminate (the app saves its session) →
    // NNCore's quit. The app may exit before the harness answers.
    await evalApp(`return nn.shell.devKeyEquivalent("${s.windowId}", { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" })`, 5000).catch(() => null);
    await until("the app to exit", async () => exited, 20000);
    const saved = readFileSync(join(data, "session.json"), "utf8").includes("quit-marker");
    if (!saved) throw new Error("the session wasn't saved on quit");
    const reports = readdirSync(join(process.env.HOME, "Library/Logs/DiagnosticReports")).filter(
      (f) => f.includes("NetnyahooNNCore") && statSync(join(process.env.HOME, "Library/Logs/DiagnosticReports", f)).mtimeMs > started,
    );
    if (reports.length) throw new Error(`crash report: ${reports}`);
    return { exitedAfterMs: Date.now() - started, sessionSaved: saved };
  });
} finally {
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
  process.exitCode = passed === results.length ? 0 : 1;
}

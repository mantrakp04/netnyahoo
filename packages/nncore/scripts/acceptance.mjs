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
const port = await new Promise((resolve) => {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});
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
// No Fast Refresh: other agents edit this tree while the run goes, and a reload would restart the app's JS mid-run.
execFileSync("defaults", ["write", "com.netnyahoo.browser.nncore", "RCTDevMenu", "-dict", "hotLoadingEnabled", "-bool", "NO", "isHotLoadingEnabled", "-bool", "NO"]);

// As AGENTS.md says: `open -g -n` with the environment, never a plain open, so it can't take focus.
const exe = join(app, "Contents/MacOS/NetnyahooNNCore");
const stdout = join(scratch, "app.out.log");
const pidsBefore = new Set(pgrep());
execFileSync("open", [
  "-g", "-n",
  "--env", "NETNYAHOO_BACKGROUND=1", "--env", "NETNYAHOO_TEST_REAUTH=granted", "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`,
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
// The window the run works in: the first one, then the one its first tab is in.
let mainWindow = null;
let first;
let eventsOf = async () => [];
const state = () =>
  evalApp(`const s = nn.store.getState(); const w = s.windows[${JSON.stringify(mainWindow)}] ?? Object.values(s.windows).filter((w) => !w.incognito && w.kind !== "small").sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
    return { windowId: w?.id, profileId: w?.profileId, tabs: (w?.tabIds ?? []).map((id) => ({ id, url: s.tabs[id]?.url, title: s.tabs[id]?.title, favicon: s.tabs[id]?.favicon?.slice(0, 40), adoptId: s.tabs[id]?.adoptId, profileId: s.tabs[id]?.profileId, loading: s.live[id]?.isLoading, back: s.live[id]?.canGoBack, fwd: s.live[id]?.canGoForward })), active: w ? w.activeTabIds[w.profileId] : null, windows: Object.keys(s.windows).length, profiles: s.profileOrder };`);

async function check(name, fn) {
  if (only.length && !only.includes(name)) return;
  if ((process.env.SKIP ?? "").split(",").includes(name)) return;
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

  const browserOf = (tabId) => evalApp(`return nn.pageState.getState().browsers ? Object.entries(nn.pageState.getState().browsers).find(([, t]) => t === "${tabId}")?.[0] ?? null : null`);
  eventsOf = async (tabId) => {
    const browser = await browserOf(tabId);
    return browser ? evalApp(`return globalThis.expo.modules.NetnyahooCEF.devEvents(${browser})`) : [];
  };

  await check("status-text", async () => {
    // Hovering a link shows its URL (Chrome's UpdateTargetURL → onStatus → the status bubble's state).
    const t = await pageTarget(`${base}/a`);
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

  const cef = (call) => evalApp(`return globalThis.expo.modules.NetnyahooCEF.${call}`);
  const exts = (call) => evalApp(`return globalThis.expo.modules.NetnyahooExtensions.${call}`);

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

  const extPath = resolve(new URL(".", import.meta.url).pathname, "../../../spikes/nncore-host/fixtures/ext");
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

  await check("chrome-windows-create", async () => {
    // A window an extension makes (chrome.windows.create): its tab lands in the app's window, live (tab:<id>).
    const installed = await exts(`install(${JSON.stringify(extPath)}, "")`);
    if (installed?.error) throw new Error(installed.error);
    const worker = await until("the extension's worker", async () =>
      (await targets()).find((t) => t.type === "service_worker" && t.url.includes(installed.id)), 15000);
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

  await check("permission-prompt", async () => {
    // A site asking for a permission reaches the app's prompt (onPermission → pageState.permission), and its answer
    // goes back to Chrome.
    const t = await pageTarget(`${base}/a`);
    await cdp(t, "Runtime.evaluate", {
      expression: "navigator.geolocation.getCurrentPosition(() => (window.__geo = 'ok'), (e) => (window.__geo = 'denied:' + e.code))",
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
    // A popup without a user gesture: Chrome's blocker keeps it, the app hears of it and can open it.
    const t = await pageTarget(`${base}/a`);
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

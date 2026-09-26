// Chrome-hosted window spike checks over CDP + the dev harness.
// usage: node spike.mjs <dataDirName> <cdpPort> <pid> <pagesOrigin> <outDir> [steps...]
// steps: interact autofill passkey alert zoom overlay select keepalive ax menu (default: the first six).
// Run menu last and keepalive in its own session: a context menu blocks the app's main thread, and
// keepalive closes the tab this session drives.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// SPIKE_DIR holds the data dirs, the compiled windows tool (.claude/skills/release/scripts/windows.swift) and outputs.
const SP = process.env.SPIKE_DIR ?? process.cwd();
const [dataName, port, pid, pages, out, ...stepArgs] = process.argv.slice(2);
const steps = stepArgs.length ? stepArgs : ["interact", "autofill", "passkey", "alert", "zoom", "overlay"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const windows = () =>
  execFileSync(`${SP}/windows`, [pid], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const shot = (name, id) => {
  try {
    execFileSync("screencapture", ["-x", "-o", "-l", String(id), `${out}/${name}.png`]);
  } catch (e) {
    console.log(`  (no capture of ${name}: ${e.message})`);
  }
};

let devSeq = 0;
async function dev(body) {
  const id = `s${Date.now()}_${devSeq++}`;
  const file = `${SP}/${dataName}/dev-eval.js`;
  writeFileSync(file, `// ${id}\n${body}\n`);
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const r = JSON.parse(readFileSync(`${SP}/${dataName}/dev-eval-result.json`, "utf8"));
      if (r.id === id) return r.error ? { error: r.error } : r.result;
    } catch {}
  }
  return { error: "timeout" };
}
const appWindow = () => windows().find((w) => w.layer === 0 && w.w > 600 && w.alpha > 0);
const W = appWindow().id;
const win = (action) => dev(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${W}, ${JSON.stringify(action)})`);
const ghosts = () => dev("return globalThis.expo.modules.NetnyahooCEF.chromeWindows()");

// A CDP session on the tab we drive.
let targets = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page");
let page = targets.find((t) => t.url.includes("page.html") || t.url.includes(pages));
if (!page) {
  await dev(`nn.actions.openUrls(["${pages}/page.html"]); return 1`);
  await sleep(3000);
  targets = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page");
  page = targets.find((t) => t.url.includes("page.html"));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  else for (const l of listeners) l(m);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (m) => resolve(m.result ?? m.error ?? {}));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
async function go(url, wait = 15000) {
  const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(wait)]);
  await sleep(800);
}
const rect = async (selector) =>
  JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`));
async function cdpClick(selector, button = "left") {
  const b = await rect(selector);
  const at = { x: b.x + 20, y: b.y + b.height / 2, button, clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  if (button === "left") await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}
async function key(k) {
  const code = { ArrowDown: 40, Enter: 13, Escape: 27 }[k];
  const base = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(k === "Enter" ? { text: "\r" } : {}) });
  if (k === "Enter") await send("Input.dispatchKeyEvent", { type: "char", ...base, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
/// Window point (top-left, points) of a page element's centre, through the page's inset in the window.
async function windowPoint(selector) {
  const [g] = await ghosts();
  const [top, left] = g.pageInsets;
  const b = await rect(selector);
  return [Math.round(left + b.x + Math.min(20, b.width / 2)), Math.round(top + b.y + b.height / 2)];
}
/// Chrome's windows over the app window: front-to-back order from CGWindowList.
const inFront = (w) => {
  const list = windows();
  return list.findIndex((x) => x.id === w.id) < list.findIndex((x) => x.id === W);
};
await send("Page.enable");
await send("Runtime.enable");
const [g0] = await ghosts();
console.log(`app window ${W} is Chrome's Browser window: hosting=${g0.hosting} (ghost window == parent: ${g0.window === g0.parentWindow}), pageInsets ${g0.pageInsets}`);

for (const step of steps) {
  if (step === "interact") {
    await go(`${pages}/page.html`);
    const before = await evaluate("clicks.textContent");
    const hit = await win("click:700,400");
    await sleep(600);
    check("a click in the page reaches the page (AppKit hit test in Chrome's window)", (await evaluate("clicks.textContent")) !== before, `${hit} → ${await evaluate("clicks.textContent")}`);
    const [x, y] = await windowPoint("#t");
    await win(`click:${x},${y}`);
    await sleep(500);
    const responder = await win("type:spike");
    await sleep(300);
    check("typing reaches the page's text field", (await evaluate("t.value")) === "spike", `${await evaluate("t.value")}; first responder ${responder}`);
    const state = () => dev("const s = nn.store.getState(); const w = Object.values(s.windows)[0]; return JSON.stringify({active: w.activeTabIds, tabs: w.tabIds.length})");
    const s0 = await state();
    const sidebarHit = await win("click:120,71");
    await sleep(800);
    const s1 = await state();
    check("a click in our sidebar reaches React Native (switches tab)", s0 !== s1, `${sidebarHit.split(" < ")[0]}: ${s0} → ${s1}`);
    shot("interact-after-sidebar-click", W);
    // Back to the page's tab, through the sidebar too.
    await win("click:120,108");
    await sleep(1200);
    const s2 = await state();
    check("…and back to the page's tab", s2 === s0, s2);
  }
  if (step === "autofill") {
    await go(`${pages}/form.html`);
    await evaluate(`document.getElementById("c").value="Springfield"; document.getElementById("b").click(); 1`);
    await sleep(2500);
    await cdpClick("#c");
    await sleep(1500);
    const popup = windows().find((w) => w.layer > 0 && w.layer !== 101 && w.alpha > 0);
    if (popup) shot("autofill-dropdown", popup.id);
    shot("autofill-window", W);
    await key("ArrowDown");
    await sleep(300);
    await key("Enter");
    await sleep(800);
    check("autofill dropdown shows and accepts a keyboard pick", (await evaluate(`document.getElementById("c").value`)) === "Springfield", popup ? `popup layer ${popup.layer}` : "no popup window seen");
  }
  if (step === "passkey") {
    await go(`${pages}/passkey.html`);
    await cdpClick("#b");
    await sleep(2500);
    const list = windows();
    const dialog = list.find((w) => /passkey/i.test(w.title));
    check("passkey dialog shows in front of the window", !!dialog && inFront(dialog) && dialog.alpha > 0, dialog ? `${dialog.title} @${dialog.x},${dialog.y} ${dialog.w}x${dialog.h}` : JSON.stringify(list));
    const [g] = await ghosts();
    check("…with no lift: the Browser window is the app window", g.window === W && !g.lifted, `lifted=${g.lifted}`);
    if (dialog) shot("passkey-dialog", dialog.id);
    shot("passkey-window", W);
    writeFileSync(`${out}/passkey-windows.json`, JSON.stringify(list, null, 1));
    await go(`${pages}/form.html`);
    await sleep(1000);
    check("passkey dialog goes when the page moves on", !windows().some((w) => /passkey/i.test(w.title)));
  }
  if (step === "alert") {
    await go(`${pages}/alert.html`);
    const before = windows().map((w) => w.id);
    await cdpClick("#b");
    await sleep(1500);
    const list = windows();
    const dialog = list.find((w) => !before.includes(w.id) && w.alpha > 0);
    check("JS alert: Chrome's dialog in front of the page", !!dialog && inFront(dialog), dialog ? `"${dialog.title}" @${dialog.x},${dialog.y} ${dialog.w}x${dialog.h}` : JSON.stringify(list));
    if (dialog) shot("alert-dialog", dialog.id);
    shot("alert-window", W);
    writeFileSync(`${out}/alert-windows.json`, JSON.stringify(list, null, 1));
    await send("Page.handleJavaScriptDialog", { accept: true });
    await sleep(800);
    check("alert dismissed, page continues", (await evaluate("document.title")) === "after alert");
  }
  if (step === "zoom") {
    await go(`${pages}/page.html`);
    const before = windows().map((w) => w.id);
    await dev(`nn.runCommand({ command: "zoomIn" }); return 1`);
    await sleep(350);
    for (const w of windows().filter((w) => !before.includes(w.id))) shot(`zoom-bubble-early-${w.id}`, w.id);
    await sleep(500);
    const list = windows();
    const fresh = list.filter((w) => !before.includes(w.id) && w.alpha > 0);
    const [g] = await ghosts();
    console.log(`  zoom: new windows ${JSON.stringify(fresh)}; Chrome child windows ${g.chromeWindows}; devicePixelRatio ${await evaluate("devicePixelRatio")}`);
    for (const w of fresh) shot(`zoom-bubble-${w.id}`, w.id);
    shot("zoom-window", W);
    check("zoom: no stray Chrome bubble over the page (or one where the zoom UI is)", fresh.length === 0, JSON.stringify(fresh));
    await dev(`nn.runCommand({ command: "zoomReset" }); return 1`);
    await sleep(500);
  }
  if (step === "overlay") {
    await go(`${pages}/page.html`);
    await dev(`nn.runCommand({ command: "focusCommandBar" }); return 1`);
    await sleep(1200);
    shot("overlay-command-bar", W);
    const hit = await win("hit:700,60");
    console.log(`  overlay: hit test over the page at 700,60 → ${hit}`);
    check("our command bar draws and hit-tests over the page", !/RenderWidgetHostViewCocoa/.test(hit.split(" < ")[0]), hit);
    await dev(`nn.runCommand({ command: "closeTab" }); return 1`); // ⌘W closes the panel first
    await sleep(600);
  }
  if (step === "select") {
    await go(`${pages}/select.html`);
    const [x, y] = await windowPoint("#s");
    const hit = await win(`click:${x},${y}`);
    await sleep(1500);
    const list = windows();
    const menu = list.find((w) => w.layer === 101);
    check("<select> popup shows", !!menu, menu ? `layer ${menu.layer} @${menu.x},${menu.y} ${menu.w}x${menu.h}; clicked ${hit.split(" < ")[0]}` : JSON.stringify(list));
    if (menu) shot("select-popup", menu.id);
    writeFileSync(`${out}/select-windows.json`, JSON.stringify(list, null, 1));
  }
  if (step === "menu") {
    await go(`${pages}/form.html`);
    const [x, y] = await windowPoint("#c");
    const hit = await win(`click:${x},${y},right`);
    await sleep(1500);
    const list = windows();
    const menu = list.find((w) => w.layer === 101);
    check("right-click shows Chrome's page context menu", !!menu, menu ? `layer ${menu.layer} @${menu.x},${menu.y} ${menu.w}x${menu.h}; clicked ${hit.split(" < ")[0]}` : JSON.stringify(list));
    if (menu) shot("context-menu", menu.id);
    writeFileSync(`${out}/menu-windows.json`, JSON.stringify(list, null, 1));
  }
  if (step === "keepalive") {
    // Every web tab of the window closes: the window and its Browser stay (no placeholder tab), and
    // the next page becomes a tab of the same Browser.
    const pageTargets = async () =>
      (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url);
    await dev(`const s = nn.store.getState(); const w = Object.values(s.windows)[0];
      for (const id of [...w.tabIds]) if (/^https?:/.test(s.tabs[id]?.url || "")) nn.actions.closeTab(id); return 1`);
    await sleep(2500);
    const [g1] = await ghosts();
    const t1 = await pageTargets();
    const winAlive = windows().some((w) => w.id === W);
    check("closing every web tab keeps the window and its Browser", winAlive && g1?.hosting && g1.window === W && g1.anyTabBrowserId === 0,
      `window ${winAlive}, anyTab ${g1?.anyTabBrowserId}, pages ${JSON.stringify(t1)}`);
    check("…with no placeholder tab (nothing about:blank for extensions)", !t1.some((u) => u === "about:blank"), JSON.stringify(t1));
    await dev(`nn.actions.openUrls(["${pages}/page.html"]); return 1`);
    await sleep(2500);
    const [g2] = await ghosts();
    const t2 = await pageTargets();
    check("the next page is a tab of the same Browser window", g2?.window === W && g2.anyTabBrowserId > 0 && t2.some((u) => u.includes("page.html")),
      `anyTab ${g2?.anyTabBrowserId}, pages ${JSON.stringify(t2)}`);
  }
  if (step === "ax") {
    // The window's tree as assistive technologies walk it (NSAccessibility, in-process: the AX server
    // answers nothing while the screen is locked).
    const tree = await win("ax");
    writeFileSync(`${out}/ax.txt`, tree);
    const chrome = ["Address and search bar", "Tab search", "AXToolbar", "Sign In to Chromium"].filter((t) => tree.includes(t));
    const ours = ["New Tab", "Back", "Forward"].filter((t) => tree.includes(t));
    check("accessibility: our views, none of Chrome's hidden ones", ours.length === 3 && chrome.length === 0,
      `ours ${JSON.stringify(ours)}, Chrome's ${JSON.stringify(chrome)}`);
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(0);

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [appArg, port = "9473"] = process.argv.slice(2);
const app = appArg && resolve(appArg);
if (!app) {
  console.error("usage: node shortcuts-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "nn-shortcuts-"));

const server = createServer((req, res) => {
  const name = new URL(req.url, "http://x").search.slice(1) || "page";
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${name}</title><body style="font:20px system-ui"><h1>${name}</h1><input id=f value="hello field">`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pages = `http://127.0.0.1:${server.address().port}`;

const tab = (id, pinned) =>
  ({ id, windowId: "w1", profileId: "default", url: `${pages}/?${id}`, title: id, favicon: null, pinned, muted: false, zoom: 1,
     customTitle: null, customIcon: null, pinnedUrl: pinned ? `${pages}/?${id}` : null, openerId: null, createdAt: 1, lastActiveAt: 1 });
const ids = ["pin1", "pin2", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"];
writeFileSync(join(data, "session.json"), JSON.stringify({
  version: 2,
  profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
              "p-work": { id: "p-work", name: "Work", color: "blue", icon: null, createdAt: 1 } },
  profileOrder: ["default", "p-work"],
  windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ids, activeTabIds: { default: "t3" }, sidebarOpen: true,
              frame: [80, 80, 1280, 800], createdAt: 1 }],
  windowOrder: ["w1"], focusedWindowId: "w1",
  tabs: ids.map((id) => tab(id, id.startsWith("pin"))),
  groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
}));

const binary = `${app}/Contents/MacOS/Netnyahoo`;
const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const before = new Set(pids());
execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
  "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, "--env", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows", app]);
let pid;
for (let i = 0; i < 60 && !pid; i++) {
  await sleep(500);
  pid = pids().find((p) => !before.has(p));
}
const finish = (code) => {
  if (pid) spawnSync("kill", ["-KILL", pid]);
  server.close();
  rmSync(data, { recursive: true, force: true });
  process.exit(code);
};
if (!pid) {
  console.error("the app didn't start");
  finish(1);
}
process.on("uncaughtException", (error) => {
  console.error(error);
  finish(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  finish(1);
});

let evalId = 0;
async function nn(body, timeout = 60000) {
  let id;
  for (let start = Date.now(), sent = 0; Date.now() - start < timeout; await sleep(100)) {
    if (Date.now() - sent > 5000) {
      id = `k${Date.now()}-${++evalId}`;
      writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
      sent = Date.now();
    }
    let out;
    try {
      out = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8"));
    } catch {
      continue;
    }
    if (out.id !== id) continue;
    if (out.error) throw new Error(`${out.error}\n${body}`);
    return out.result;
  }
  throw new Error(`no answer to:\n${body}`);
}
for (let i = 0; ; i++) {
  try {
    if ((await nn("return !!nn.shell.devKeyEquivalent", 2000)) === true) break;
  } catch {}
  if (i > 60) {
    console.error("the dev harness never answered (is Metro running on :8081?)");
    finish(1);
  }
}
await sleep(3000);

async function cdp(urlPart, expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === "page" && t.url.includes(urlPart));
  if (!target) return undefined;
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  const value = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m.result?.result?.value);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    setTimeout(() => resolve(undefined), 3000);
  });
  ws.close();
  return value;
}

const state = () => nn(`const s = nn.store.getState(), w = s.windows.w1;
  return { profile: w.profileId, active: w.activeTabIds[w.profileId], tabs: w.tabIds.length, panel: !!s.windowUi.w1?.panel.open };`);
const activeUrl = async () => (await nn(`const s = nn.store.getState(), w = s.windows.w1; return w ? s.tabs[w.activeTabIds[w.profileId]]?.url ?? "" : "no window w1";`));
const press = (key, options) => nn(`return nn.shell.devKeyEquivalent("w1", ${JSON.stringify({ ...key, ...options })});`);

const F = (code) => String.fromCharCode(code);
const K = (key, keyCode, ...modifiers) => ({ key, keyCode, modifiers });
const cmd = (key, keyCode, ...more) => K(key, keyCode, "command", ...more);

const shortcuts = [
  ["⌘,", cmd(",", 43), { command: "openSettings" }, "⌘,"],
  ["⌘Q", cmd("q", 12), { title: /^Quit/ }, "⌘Q", "window-only"],
  ["⌘H", cmd("h", 4), { title: /^Hide / }, "⌘H", "window-only"],
  ["⌘T", cmd("t", 17), { command: "newTab" }, "⌘T"],
  ["⌥⌘T", cmd("t", 17, "option"), { command: "newTabInGroup" }, "⌥⌘T"],
  ["⌘N", cmd("n", 45), { command: "newWindow" }, "⌘N"],
  ["⇧⌘N", cmd("N", 45, "shift"), { command: "newIncognitoWindow" }, "⇧⌘N"],
  ["⇧⌘T", cmd("T", 17, "shift"), { command: "reopenClosedTab" }, "⇧⌘T"],
  ["⌘L", cmd("l", 37), { command: "focusCommandBar" }, "⌘L"],
  ["⌃F5", K(F(0xf708), 96, "control", "function"), { command: "focusCommandBar" }, "(Chrome's)"],
  ["⌘O", cmd("o", 31), { command: "openFile" }, "(Chrome's)"],
  ["⇧⌘W", cmd("W", 13, "shift"), { title: "Close Window" }, "⇧⌘W", "window-only"],
  ["⌘W", cmd("w", 13), { command: "closeTab" }, "⌘W"],
  ["⇧⌘K", cmd("K", 40, "shift"), { command: "closeAllTabs" }, "⇧⌘K"],
  ["⌥⌘K", cmd("k", 40, "option"), { command: "cleanUpTabs" }, "⌥⌘K"],
  ["⌘P", cmd("p", 35), { command: "print" }, "⌘P"],
  ["⌥⌘P", cmd("p", 35, "option"), { command: "printWithSystemDialog" }, "(Chrome's)"],
  ["⇧⌘I", cmd("I", 34, "shift"), { command: "emailPageLocation" }, "(Chrome's)"],
  ["⌘Z", cmd("z", 6), { title: "Undo" }, "⌘Z"],
  ["⇧⌘Z", cmd("Z", 6, "shift"), { title: "Redo" }, "⇧⌘Z"],
  ["⌘X", cmd("x", 7), { title: "Cut" }, "⌘X", "clipboard"],
  ["⌘C", cmd("c", 8), { title: "Copy" }, "⌘C", "clipboard"],
  ["⇧⌘C", cmd("C", 8, "shift"), { command: "copyUrl" }, "⇧⌘C"],
  ["⌥⇧⌘C", cmd("C", 8, "shift", "option"), { command: "copyUrlAsMarkdown" }, "⌥⇧⌘C"],
  ["⌘V", cmd("v", 9), { title: "Paste" }, "⌘V", "clipboard"],
  ["⇧⌘V", cmd("V", 9, "shift"), { title: "Paste and Match Style" }, "⇧⌘V", "clipboard"],
  ["⌘A", cmd("a", 0), { title: "Select All" }, "⌘A"],
  ["⌘F", cmd("f", 3), { command: "findInPage" }, "⌘F"],
  ["⌥⌘F", cmd("f", 3, "option"), { command: "findAndReplace" }, "⌥⌘F"],
  ["⌘G", cmd("g", 5), { command: "findNext" }, "⌘G"],
  ["⇧⌘G", cmd("G", 5, "shift"), { command: "findPrevious" }, "⇧⌘G"],
  ["⌘J", cmd("j", 38), { command: "jumpToSelection" }, "⌘J"],
  ["⌘E", cmd("e", 14), { command: "useSelectionForFind" }, "⌘E is Chat (no AI)"],
  ["⌘:", cmd(":", 41, "shift"), { title: "Show Spelling and Grammar" }, "⌘:", "window-only"],
  ["⌘;", cmd(";", 41), { title: "Check Document Now" }, "⌘;", "window-only"],
  ["⌘.", cmd(".", 47), { command: "stop" }, "(Chrome's)"],
  ["⌘R", cmd("r", 15), { command: "reload" }, "⌘R"],
  ["⇧⌘R", cmd("R", 15, "shift"), { command: "forceReload" }, "⇧⌘R"],
  ["⇧⌘S", cmd("S", 1, "shift"), { command: "toggleTabLayout" }, "⇧⌘S"],
  ["⌘S", cmd("s", 1), { command: "toggleSidebar" }, "⌘S"],
  ["⇧⌘L", cmd("L", 37, "shift"), { command: "toggleSidebar" }, "(Chrome's)"],
  ["⇧⌘F", cmd("F", 3, "shift"), { command: "toggleSidebar" }, "(Chrome's)"],
  ["⌥⌘N", cmd("n", 45, "option"), { command: "openSplitPane" }, "(Chrome's)"],
  ["⌃⇧=", K("+", 24, "control", "shift"), { command: "openSplitPane" }, "⌃⇧="],
  ["⌃⇧]", K("}", 30, "control", "shift"), { command: "focusNextPane" }, "⌃⇧]"],
  ["⌃⇧[", K("{", 33, "control", "shift"), { command: "focusPreviousPane" }, "⌃⇧["],
  ["⇧⌘B", cmd("B", 11, "shift"), { command: "toggleBookmarksBar" }, "⇧⌘B"],
  ["⌘0", cmd("0", 29), { command: "zoomReset" }, "⌘0"],
  ["⌘+", cmd("+", 24, "shift"), { command: "zoomIn" }, "⌘+"],
  ["⌘=", cmd("=", 24), { command: "zoomIn" }, "⌘= (alternate)"],
  ["⌘-", cmd("-", 27), { command: "zoomOut" }, "⌘-"],
  ["🌐F", K("f", 3, "function"), { title: "Enter Full Screen" }, "🌐F", "window-only"],
  ["⌃⌘F", cmd("f", 3, "control"), { title: "Enter Full Screen" }, "(Chrome's)", "window-only"],
  ["F7", K(F(0xf70a), 98, "function"), { command: "caretBrowsing" }, "(Chrome's)"],
  ["⌥⌘U", cmd("u", 32, "option"), { command: "viewSource" }, "⌥⌘U"],
  ["⌥⌘I", cmd("i", 34, "option"), { command: "devTools" }, "⌥⌘I"],
  ["⌥⌘C", cmd("c", 8, "option"), { command: "inspectElements" }, "⌥⌘C"],
  ["⌥⌘J", cmd("j", 38, "option"), { command: "javaScriptConsole" }, "⌥⌘J"],
  ["F12", K(F(0xf70f), 111, "function"), { command: "toggleDevTools" }, "F12"],
  ["⌘[", cmd("[", 33), { command: "back" }, "⌘["],
  ["⌘]", cmd("]", 30), { command: "forward" }, "⌘]"],
  ["⌘←", cmd(F(0xf702), 123, "function"), { command: "back" }, "⌘←", "not-field"],
  ["⌘→", cmd(F(0xf703), 124, "function"), { command: "forward" }, "⌘→", "not-field"],
  ["⇧⌘]", cmd("}", 30, "shift"), { command: "nextTab" }, "⇧⌘]"],
  ["⇧⌘[", cmd("{", 33, "shift"), { command: "previousTab" }, "⇧⌘["],
  ["⌥⌘→", cmd(F(0xf703), 124, "option", "function"), { command: "nextTab" }, "(Chrome's)"],
  ["⌥⌘←", cmd(F(0xf702), 123, "option", "function"), { command: "previousTab" }, "(Chrome's)"],
  ["⌃⇟", K(F(0xf72d), 121, "control", "function"), { command: "nextTab" }, "(Chrome's)"],
  ["⌃⇞", K(F(0xf72c), 116, "control", "function"), { command: "previousTab" }, "(Chrome's)"],
  ["⌥⌘↓", cmd(F(0xf701), 125, "option", "function"), { command: "nextTab" }, "⌥⌘↓ (alternate)"],
  ["⌥⌘↑", cmd(F(0xf700), 126, "option", "function"), { command: "previousTab" }, "⌥⌘↑ (alternate)"],
  ["⌃⇧⇟", K(F(0xf72d), 121, "control", "shift", "function"), { command: "moveTabDown" }, "(Chrome's)"],
  ["⌃⇧⇞", K(F(0xf72c), 116, "control", "shift", "function"), { command: "moveTabUp" }, "(Chrome's)"],
  ["⇧⌘A", cmd("A", 0, "shift"), { command: "searchTabs" }, "⇧⌘A"],
  ["⌃Tab", K("\t", 48, "control"), { command: "tabSwitcher", arg: "forward" }, "⌃Tab"],
  ["⌃⇧Tab", K("\u0019", 48, "control", "shift"), { command: "tabSwitcher", arg: "backward" }, "⌃⇧Tab"],
  ["⌘↩", cmd("\r", 36), { command: "returnToPinnedUrl" }, "⌘↩", "not-field"],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`⌘${n}`, cmd(`${n}`, [18, 19, 20, 21, 23, 22, 26, 28][n - 1]), { command: "selectTab", arg: `${n}` }, `⌘${n} (Chromium)`]),
  ["⌘9", cmd("9", 25), { command: "selectLastTab" }, "⌘9 (Chromium)"],
  ["⌃⌘N", cmd("n", 45, "control"), { command: "newGroupWithTabs" }, "⌃⌘N"],
  ["⌃⌘P", cmd("p", 35, "control"), { command: "newGroupWithTabs" }, "(Chrome's)"],
  ["⌃⌘C", cmd("c", 8, "control"), { command: "newTabInGroup" }, "(Chrome's)"],
  ["⌃⌘W", cmd("w", 13, "control"), { command: "closeTabGroup" }, "(Chrome's)"],
  ["⌘D", cmd("d", 2), { command: "bookmarkPage" }, "⌘D"],
  ["⇧⌘D", cmd("D", 2, "shift"), { command: "bookmarkAllTabs" }, "(Chrome's)"],
  ["⌥⌘B", cmd("b", 11, "option"), { command: "manageBookmarks" }, "⌥⌘B"],
  ["⌘Y", cmd("y", 16), { command: "showHistory" }, "⌘Y"],
  ["⇧⌘⌫", cmd(F(0x7f), 51, "shift"), { command: "clearBrowsingData" }, "⇧⌘⌫", "page-field"],
  ["⌘M", cmd("m", 46), { title: "Minimize" }, "⌘M", "window-only"],
  ["⌥⌘M", cmd("m", 46, "option"), { title: "Minimize All" }, "⌥⌘M", "window-only"],
  ["⇧⌘J", cmd("J", 38, "shift"), { command: "downloads" }, "⇧⌘J"],
  ["⌥⌘L", cmd("l", 37, "option"), { command: "downloads" }, "(Chrome's)"],
  ["⇧⌘M", cmd("M", 46, "shift"), { command: "openProfileMenu" }, "(Chrome's)"],
  ["⌥⇧⌘I", cmd("I", 34, "shift", "option"), { command: "sendFeedback" }, "(Chrome's)"],
  ["⌃1", K("1", 18, "control"), { command: "switchProfile", arg: "default" }, "⌃1"],
  ["⌃2", K("2", 19, "control"), { command: "switchProfile", arg: "p-work" }, "⌃2"],
];

const same = (f, expect) =>
  expect.command
    ? f.command === expect.command && (expect.arg === undefined || f.arg === expect.arg)
    : expect.title instanceof RegExp ? expect.title.test(f.title) : f.title === expect.title;
function verdict(r, expect) {
  if (r.error) return "FAIL";
  const fired = r.fired ?? [], matched = r.matched ?? [];
  if (expect === null) return fired.length ? "FAIL" : "ok";
  if (fired.some((f) => same(f, expect))) return "ok";
  if (!fired.length && matched.some((m) => same(m, expect) && !m.enabled)) return "off";
  return "FAIL";
}
const describe = (r) =>
  r.error ??
  `${r.handledBy}${r.fired?.length ? ` → ${r.fired.map((f) => (f.command ? `${f.command}${f.arg ? `:${f.arg}` : ""}` : f.title)).join(", ")}` : ""}` +
    (r.matched?.length ? ` (matched ${r.matched.map((m) => `${m.command ?? m.title}${m.enabled ? "" : " disabled"}`).join(", ")})` : "");

async function showPage(name) {
  await nn(`nn.store.getState().activate("${name}");`);
  for (let i = 0; i < 40; i++) {
    if ((await cdp(`?${name}`, "document.readyState")) === "complete") return;
    await sleep(250);
  }
}
const focuses = {
  sidebar: { press: { focus: "window" } },
  page: { press: { focus: "page", asKey: true, wait: 800 }, before: () => cdp("?t3", "document.activeElement.blur(), true") },
  field: { press: { focus: "page", asKey: true, wait: 800 }, before: () => cdp("?t3", "document.getElementById('f').focus(), true") },
  commandBar: {
    press: { asKey: true },
    before: async () => {
      await nn(`nn.runCommand({ command: "focusCommandBar", arg: null, windowId: "w1" });`);
      await sleep(400);
    },
    teardown: () => nn(`nn.store.getState().closePanel("w1");`),
  },
  devTools: {
    press: { focus: "devtools", asKey: true, wait: 800 },
    setup: async () => {
      await nn(`nn.runCommand({ command: "devTools", arg: null, windowId: "w1" });`);
      await sleep(3000);
    },
    teardown: () => nn(`nn.runCommand({ command: "devTools", arg: null, windowId: "w1" });`),
  },
};

const results = new Map(shortcuts.map(([name]) => [name, {}]));
let failures = 0;
await showPage("t3");
for (const [focusName, focus] of Object.entries(focuses)) {
  await focus.setup?.();
  for (const [name, key, expect, , only] of shortcuts) {
    if (focusName !== "sidebar" && (only === "window-only" || only === "clipboard")) continue;
    // Text fields consume ⌘↩, ⌘←/→, and ⇧⌘⌫.
    const inField =
      (only === "not-field" && (focusName === "field" || focusName === "commandBar")) || (only === "page-field" && focusName === "field");
    await focus.before?.();
    const r = await press(key, { ...focus.press, dry: true });
    const result = verdict(r, inField ? null : expect);
    if (result === "FAIL") failures++;
    results.get(name)[focusName] = { result, detail: describe(r), responder: r.firstResponder };
  }
  await focus.teardown?.();
}

const cols = Object.keys(focuses);
console.log(`\n${"shortcut".padEnd(8)} ${"Dia".padEnd(26)} ${cols.map((c) => c.padEnd(10)).join(" ")}`);
for (const [name, , , dia] of shortcuts) {
  const row = results.get(name);
  console.log(`${name.padEnd(8)} ${dia.padEnd(26)} ${cols.map((c) => (row[c]?.result ?? "—").padEnd(10)).join(" ")}`);
}
for (const [name] of shortcuts)
  for (const c of cols) {
    const r = results.get(name)[c];
    if (r && r.result !== "ok") console.log(`${r.result.padEnd(4)}  ${name} with the focus in ${c}: ${r.detail} (first responder ${r.responder})`);
  }

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  if (!ok) failures++;
};
await nn(`globalThis.selections = []; nn.store.subscribe((s, p) => { const w = s.windows.w1, a = w?.activeTabIds[w.profileId];
  if (a !== p.windows.w1?.activeTabIds[p.windows.w1.profileId]) globalThis.selections.push(a); }); return 1;`);
const real = async (label, key, focus, expectUrl) => {
  await nn(`globalThis.selections.length = 0; return 1;`);
  const r = await press(key, focus);
  await sleep(300);
  const url = await activeUrl();
  const ok = url.endsWith(`?${expectUrl}`);
  const selected = ok ? [] : await nn(`return globalThis.selections;`);
  check(`${label}: selects ${expectUrl}`, ok, ok ? url : `${url}; ${describe(r)}, first responder ${r.firstResponder}, selected ${selected.join(" → ")}`);
};
const sidebar = { focus: "window" };
const page = { focus: "page", asKey: true, wait: 800, settle: 500 };
await real("⌘1 in the sidebar", cmd("1", 18), sidebar, "pin1");
await real("⌘2 in the sidebar", cmd("2", 19), sidebar, "pin2");
await real("⌘9 in the sidebar", cmd("9", 25), sidebar, "t9");
await real("⌘5 in the sidebar", cmd("5", 23), sidebar, "t3");
await showPage("t3");
await sleep(2000);
await real("⌘1 in a page", cmd("1", 18), page, "pin1");
await showPage("t3");
await cdp("?t3", "document.getElementById('f').focus(), true");
await real("⌘9 in a page's text field", cmd("9", 25), page, "t9");
await showPage("t3");
await cdp("?t3", "document.getElementById('f').focus(), true");
await real("⌘4 in a page's text field", cmd("4", 21), page, "t2");
await nn(`nn.runCommand({ command: "focusCommandBar", arg: null, windowId: "w1" });`);
await sleep(600);
await real("⌘2 in the command bar", cmd("2", 19), { asKey: true }, "pin2");
check("…and the command bar closes", !(await state()).panel, "");
await real("⇧⌘] (Next Tab)", cmd("}", 30, "shift"), sidebar, "t1");
await real("⇧⌘[ (Previous Tab)", cmd("{", 33, "shift"), sidebar, "pin2");
await real("⌥⌘→ (Next Tab)", cmd(F(0xf703), 124, "option", "function"), sidebar, "t1");
await real("⌃⇟ (Next Tab)", K(F(0xf72d), 121, "control", "function"), sidebar, "t2");
await showPage("t3");
await sleep(2000);
{
  const next = await nn(`const s = nn.store.getState(), w = s.windows.w1, ids = w.tabIds.filter((id) => s.tabs[id].profileId === w.profileId);
    return ids[ids.indexOf("t3") + 1];`);
  const before = await activeUrl();
  const r = await press(cmd("}", 30, "shift"), page);
  await sleep(300);
  const now = await nn(`const s = nn.store.getState(), w = s.windows.w1; return w.activeTabIds[w.profileId];`);
  check("⇧⌘] in a page selects the next tab", before.endsWith("?t3") && now === next, `${next} expected, ${now} selected; ${describe(r)}`);
}

let s = await state();
await press(cmd("t", 17), sidebar);
await sleep(400);
let after = await state();
check("⌘T opens a tab and selects it", after.tabs === s.tabs + 1 && (await activeUrl()) === "", `${s.tabs} → ${after.tabs} tabs`);
await nn(`const s = nn.store.getState(), w = s.windows.w1; s.navigate(w.activeTabIds[w.profileId], "${pages}/?closed");`);
await sleep(1500);
await press(cmd("w", 13), sidebar);
await sleep(400);
check("⌘W closes it", (await state()).tabs === s.tabs, `${(await state()).tabs} tabs`);
await sleep(1000);
await press(cmd("T", 17, "shift"), sidebar);
await sleep(400);
check("⇧⌘T reopens it", (await state()).tabs === s.tabs + 1, `${(await state()).tabs} tabs`);
await press(K("2", 19, "control"), sidebar);
await sleep(600);
check("⌃2 switches the window to the second profile", (await state()).profile === "p-work", (await state()).profile);
await press(K("1", 18, "control"), sidebar);
await sleep(600);
check("⌃1 switches back", (await state()).profile === "default", (await state()).profile);
await showPage("t3");
await press(cmd("l", 37), sidebar);
await sleep(400);
check("⌘L opens the command bar", (await state()).panel, "");
await nn(`nn.store.getState().closePanel("w1");`);
await showPage("t3");
await sleep(2000);
await cdp("?t3", "(f => (f.value = 'hello field', f.focus(), f.setSelectionRange(0, 0), true))(document.getElementById('f'))");
await press(cmd("a", 0), page);
const selection = await cdp("?t3", "(f => [f.selectionStart, f.selectionEnd, f.value.length].join())(document.getElementById('f'))");
check("⌘A selects all of a page's text field", selection === "0,11,11", selection);

await press(cmd("q", 12), { focus: "window", wait: 0 });
let quit = false;
for (let i = 0; i < 150 && !quit; i++) {
  await sleep(100);
  quit = !pids().includes(pid);
}
check("⌘Q quits", quit, quit ? "" : "still running after 15 s");
if (quit) pid = undefined;

console.log("");
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
finish(failures ? 1 : 0);

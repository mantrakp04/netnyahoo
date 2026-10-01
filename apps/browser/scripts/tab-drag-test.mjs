// Tab dragging in the top tab strip (and the sidebar's drag onto the page), driven through AppKit's own event path
// (DEV `drag:`: mouseDown, mouseDragged…, mouseUp sent to the window) in a hidden instance.
//
//   node apps/browser/scripts/tab-drag-test.mjs <Debug Netnyahoo.app> [--port=9481] [--keep-data]
//
// Guards the owner's 0.2.18 report: pressing a tab in the strip moved the window (the press climbed the responder
// chain to the strip's WindowDragRegion) and nothing could be dragged. A real mouse is still needed for the feel
// (AppKit's window drag tracks the hardware pointer, which synthetic events can't).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node tab-drag-test.mjs <Debug Netnyahoo.app> [--port=9481] [--keep-data]");
  process.exit(2);
}
const app = resolve(appArg);
assert.notEqual(app, "/Applications/Netnyahoo.app", "use an isolated Debug build");
const port = Number(args.find((a) => a.startsWith("--port="))?.slice(7) ?? 9481);
const keep = args.includes("--keep-data");
const binary = `${app}/Contents/MacOS/Netnyahoo`;
const data = mkdtempSync(join(tmpdir(), "nn-tab-drag-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tab = (id, windowId, pinned = false) => ({ id, windowId, profileId: "default", url: "", title: "", favicon: null, pinned, muted: false, zoom: 1,
  customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: 1, lastActiveAt: id === "t1" ? 2 : 1 });
const fixture = () => ({ version: 2,
  profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
  profileOrder: ["default"],
  settings: { tabLayout: "top" },
  windows: [
    { id: "w1", profileId: "default", incognito: false, tabIds: ["p1", "p2", "t1", "t2", "t3", "t4"], activeTabIds: { default: "t1" }, sidebarOpen: true, frame: [80, 80, 1280, 800], createdAt: 1 },
    { id: "w2", profileId: "default", incognito: false, tabIds: ["l1"], activeTabIds: { default: "l1" }, sidebarOpen: true, frame: [200, 120, 1100, 700], createdAt: 2 },
    { id: "w3", profileId: "default", incognito: false, tabIds: ["g1", "g2", "x1"], activeTabIds: { default: "x1" }, sidebarOpen: true, frame: [140, 100, 1200, 760], createdAt: 3 },
  ],
  windowOrder: ["w1", "w2", "w3"], focusedWindowId: "w1",
  tabs: [tab("p1", "w1", true), tab("p2", "w1", true), tab("t1", "w1"), tab("t2", "w1"), tab("t3", "w1"), tab("t4", "w1"), tab("l1", "w2"),
    tab("g1", "w3"), tab("g2", "w3"), tab("x1", "w3")],
  groups: [{ id: "grp", windowId: "w3", profileId: "default", name: "Group", icon: null, color: null, collapsed: false, pinned: false, tabIds: ["g1", "g2"], createdAt: 1 }], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
});

const pidsOf = () => new Set(spawnSync("pgrep", ["-f", binary], { encoding: "utf8" }).stdout.split(/\s+/).filter(Boolean).map(Number));
let pid = null;
let evalId = 0;
async function nn(body, timeout = 20000) {
  const id = `drag-${Date.now()}-${++evalId}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(50)) {
    if (pid && !alive(pid)) throw new Error(`app ${pid} died`);
    let out;
    try { out = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8")); } catch { continue; }
    if (out.id !== id) continue;
    if (out.error) throw new Error(out.error);
    return out.result;
  }
  throw new Error(`dev harness timeout: ${body.slice(0, 120)}`);
}
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };

// The page's helpers: `win(id)` the native window number of a store window, `act(id, action)` a DEV window action,
// `items(id)` the strip's items as [left, right] runs of the hit test along the strip's middle line.
const HELPERS = `
const C = globalThis.expo.modules.NetnyahooCEF;
const st = () => nn.store.getState();
const win = (id) => C.chromeWindows().then((ws) => { const f = st().windows[id].frame; const w = ws.filter((w) => w.hasRoot).find((w) => { const r = w.frame.match(/[-\\d.]+/g).map(Number); return Math.abs(r[0] - f[0]) < 2 && Math.abs(r[2] - f[2]) < 2; }); return w && w.window; });
const act = (id, a) => win(id).then((n) => C.devWindow(n, a));
const items = (id) => win(id).then((n) => { const xs = []; for (let x = 70; x < st().windows[id].frame[2] - 100; x += 1) xs.push(x);
  return Promise.all(xs.map((x) => C.devWindow(n, "hit:" + x + ",21"))).then((hits) => { const runs = []; let cur = null;
    hits.forEach((h, i) => { const on = /ContextMenuArea|ImageView|Symbol|FadeLabel/.test(h); if (on && !cur) cur = [xs[i], xs[i]]; else if (on) cur[1] = xs[i]; else if (cur) { runs.push(cur); cur = null; } });
    if (cur) runs.push(cur); return runs; }); });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
`;
const run = (body) => nn(`${HELPERS}\n${body}`);
const order = (w) => run(`return st().windows.${w}.tabIds;`);
const drag = (w, points) => run(`return act("${w}", "windowDrags").then(() => act("${w}", "drag:${points.map((p) => p.join(",")).join(";")}")).then(() => settle(${points.length * 12 * 16 + 700})).then(() => act("${w}", "windowDrags")).then((t) => Number(t.split("\\n")[0]));`);

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push(["FAIL", name, error.message]);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

try {
  writeFileSync(join(data, "session.json"), JSON.stringify(fixture()));
  const before = pidsOf();
  spawnSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, app]);
  for (const start = Date.now(); !pid && Date.now() - start < 20000; await sleep(200)) pid = [...pidsOf()].find((p) => !before.has(p)) ?? null;
  assert.ok(pid, "app didn't start");
  // The harness ignores a script already there when it starts: ask again until it answers.
  for (let tries = 0; ; tries++) {
    try {
      await nn("return 1", 3000);
      break;
    } catch (error) {
      if (tries > 30) throw error;
    }
  }
  await sleep(1500);
  await run(`return act("w1", "windowDrags");`);

  const strip = await run(`return items("w1");`);
  // Two pinned tiles, then four tabs.
  assert.equal(strip.length, 6, `strip items ${JSON.stringify(strip)}`);
  const mid = (i) => Math.round((strip[i][0] + strip[i][1]) / 2);

  await check("a tab dragged along the strip reorders and doesn't move the window", async () => {
    const frame = await run(`return st().windows.w1.frame;`);
    // The tab follows from where the drag started (a few points past the press), so go a little past t3's centre.
    const drags = await drag("w1", [[mid(2), 21], [mid(3), 21], [mid(4) + 30, 21]]);
    assert.equal(drags, 0, "window drags");
    assert.deepEqual(await order("w1"), ["p1", "p2", "t2", "t3", "t1", "t4"]);
    assert.deepEqual(await run(`return st().windows.w1.frame;`), frame);
  });

  await check("a lone tab dragged doesn't move its window", async () => {
    const lone = await run(`return items("w2");`);
    const x = Math.round((lone[0][0] + lone[0][1]) / 2);
    const drags = await drag("w2", [[x, 21], [x + 60, 24], [x + 140, 26]]);
    assert.equal(drags, 0, "window drags");
    assert.deepEqual(await order("w2"), ["l1"]);
  });

  await check("a pinned tile trades places with the other pinned tile", async () => {
    const drags = await drag("w1", [[mid(0), 21], [mid(1), 21], [mid(1) + 24, 21]]);
    assert.equal(drags, 0, "window drags");
    assert.deepEqual((await order("w1")).slice(0, 2), ["p2", "p1"]);
  });

  await check("the empty strip still moves the window", async () => {
    const drags = await drag("w1", [[strip[5][1] + 120, 21], [strip[5][1] + 200, 21]]);
    assert.equal(drags, 1, "window drags");
  });

  await check("a group's member trades places inside the group, and a tab moves past the whole group", async () => {
    const items = await run(`return items("w3");`);
    // The group's chip, its two members, then x1.
    assert.equal(items.length, 4, JSON.stringify(items));
    const at = (i) => Math.round((items[i][0] + items[i][1]) / 2);
    assert.equal(await drag("w3", [[at(2), 21], [at(1), 21], [at(1) - 40, 21]]), 0, "window drags");
    assert.deepEqual(await run(`return [st().windows.w3.tabIds, st().groups.grp.tabIds];`), [["g2", "g1", "x1"], ["g2", "g1"]]);
    await drag("w3", [[at(3), 21], [at(1), 21], [at(0) - 30, 21]]);
    assert.deepEqual(await run(`return [st().windows.w3.tabIds, st().groups.grp.tabIds];`), [["x1", "g2", "g1"], ["g2", "g1"]]);
  });

  await check("a tab pulled onto the page's right target splits with the page", async () => {
    const width = await run(`return st().windows.w1.frame[2];`);
    const now = await run(`return items("w1");`);
    const ids = await order("w1");
    const x = Math.round((now[3][0] + now[3][1]) / 2);
    assert.equal(ids[3], "t3");
    const state = await run(`
      const seen = [];
      const iv = setInterval(() => { const d = globalThis.nnTabDrag.getState(); seen.push({ lifted: d.lifted, onPage: d.onPage, target: d.target }); }, 60);
      return act("w1", "drag:${x},21;${x},120;${width - 260},380;${width - 255},390;${width - 250},400;${width - 250},402").then(() => settle(1700)).then(() => { clearInterval(iv); return seen; });`);
    assert.ok(state.some((s) => s.lifted && s.onPage), "lifted onto the page");
    assert.ok(state.some((s) => s.target?.side === "right"), `right target ${JSON.stringify(state.slice(-6))}`);
    const splits = await run(`return Object.values(st().splits).map((v) => v.tabIds);`);
    assert.equal(splits.length, 1);
    assert.equal(splits[0].at(-1), "t3", `split ${JSON.stringify(splits)}`);
  });

  await check("a tab let go over the page away from a target goes back", async () => {
    const now = await run(`return items("w1");`);
    const before = await order("w1");
    const width = await run(`return st().windows.w1.frame[2];`);
    const x = Math.round((now[2][0] + now[2][1]) / 2);
    // Low in the split's left pane: below its targets, which are centred on the pane.
    const splits = await run(`return Object.values(st().splits).map((v) => v.tabIds);`);
    const seen = await run(`
      const seen = [];
      const iv = setInterval(() => { const d = globalThis.nnTabDrag.getState(); seen.push([Math.round(d.x), Math.round(d.y), d.target]); }, 50);
      return act("w1", "drag:${x},21;${x},200;${Math.round(width / 4)},560;${Math.round(width / 4)},740").then(() => settle(1100)).then(() => { clearInterval(iv); return seen; });`);
    assert.deepEqual(await order("w1"), before);
    assert.deepEqual(await run(`return Object.values(st().splits).map((v) => v.tabIds);`), splits, JSON.stringify(seen));
    assert.equal(await run(`return Object.keys(st().windows).length;`), 3);
  });

  await check("a tab dragged out of the window tears off into a new one", async () => {
    const now = await run(`return items("w1");`);
    const x = Math.round((now[2][0] + now[2][1]) / 2);
    const id = (await order("w1"))[2];
    await drag("w1", [[x, 21], [x, -40], [x + 80, -90]]);
    const windows = await run(`return Object.values(st().windows).map((w) => w.tabIds);`);
    assert.equal(windows.length, 4, JSON.stringify(windows));
    assert.ok(windows.some((ids) => ids.length === 1 && ids[0] === id), JSON.stringify(windows));
  });

  await check("a split moves along the strip as one, and a pane pulled out of the window leaves it", async () => {
    const now = await run(`return items("w1");`);
    const ids = await order("w1");
    // p2, p1, the split (t1 | t3), t4.
    assert.deepEqual(ids, ["p2", "p1", "t1", "t3", "t4"]);
    const split = now[2], t4 = now[3];
    const y = 21;
    await drag("w1", [[Math.round(split[0] + 30), y], [Math.round(t4[0]), y], [Math.round(t4[1]) + 20, y]]);
    assert.deepEqual(await order("w1"), ["p2", "p1", "t4", "t1", "t3"]);
    const moved = await run(`return items("w1");`);
    const pane = Math.round(moved[3][0] + (moved[3][1] - moved[3][0]) * 0.75);
    await drag("w1", [[pane, y], [pane, -40], [pane + 40, -90]]);
    const state = await run(`return { windows: Object.values(st().windows).map((w) => w.tabIds), splits: Object.values(st().splits).map((v) => v.tabIds) };`);
    assert.ok(state.windows.some((w) => w.length === 1 && w[0] === "t3"), JSON.stringify(state));
    assert.ok(!state.splits.some((v) => v.includes("t3")), JSON.stringify(state));
  });

  await check("sidebar: a row dragged onto the page's left target splits", async () => {
    // The DEV sidebar controller is the last window's to render: leave w1 alone.
    await run(`for (const id of Object.keys(st().windows)) if (id !== "w1") st().closeWindow(id); st().updateSettings({ tabLayout: "sidebar" }); return settle(1500);`);
    const rows = await run(`const c = globalThis.sidebarDrag; const out = [];
      return Promise.all([...c.items.values()].filter((i) => i.kind === "row" && i.view).map((i) => new Promise((r) => i.view.measureInWindow((x, y, w, h) => r({ id: i.tabIds[0], x, y, w, h })))));`);
    const row = rows.find((r) => r.id === "t2") ?? rows[0];
    assert.ok(row, "a sidebar row");
    const sx = Math.round(row.x + row.w / 2), sy = Math.round(row.y + row.h / 2);
    const left = Math.round(row.x + row.w + 140);
    const state = await run(`
      const seen = [];
      const iv = setInterval(() => { const d = globalThis.nnTabDrag.getState(); seen.push(d.target); }, 60);
      return act("w1", "drag:${sx},${sy};${sx + 40},${sy + 20};${left},380;${left + 4},390;${left + 6},396;${left + 6},398").then(() => settle(1700)).then(() => { clearInterval(iv); return seen; });`);
    assert.ok(state.some((t) => t?.side === "left"), `left target ${JSON.stringify(state.slice(-5))}`);
    const splits = await run(`return Object.values(st().splits).map((v) => v.tabIds);`);
    assert.ok(splits.some((ids) => ids[0] === row.id), JSON.stringify(splits));
  });
} finally {
  if (pid && alive(pid)) process.kill(pid);
  if (!keep) rmSync(data, { recursive: true, force: true });
  else console.log(`data: ${data}`);
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

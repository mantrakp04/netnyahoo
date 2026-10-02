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
import { inflateSync } from "node:zlib";

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
    // Side by side, the same height: a tab dragged from one onto the other's strip.
    { id: "w5", profileId: "default", incognito: false, tabIds: ["a1", "a2"], activeTabIds: { default: "a2" }, sidebarOpen: true, frame: [100, 60, 560, 420], createdAt: 5 },
    { id: "w6", profileId: "default", incognito: false, tabIds: ["b1", "b2", "b3"], activeTabIds: { default: "b1" }, sidebarOpen: true, frame: [700, 60, 560, 420], createdAt: 6 },
  ],
  windowOrder: ["w1", "w2", "w3", "w5", "w6"], focusedWindowId: "w1",
  tabs: [tab("p1", "w1", true), tab("p2", "w1", true), tab("t1", "w1"), tab("t2", "w1"), tab("t3", "w1"), tab("t4", "w1"), tab("l1", "w2"),
    tab("g1", "w3"), tab("g2", "w3"), tab("x1", "w3"), tab("a1", "w5"), tab("a2", "w5"), tab("b1", "w6"), tab("b2", "w6"), tab("b3", "w6")],
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

// An 8-bit RGB(A) PNG's pixels (what devSnapshotWindow writes): { width, height, channels, data }.
function readPng(path) {
  const buf = readFileSync(path);
  let width = 0, height = 0, channels = 4;
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at), type = buf.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(at + 8);
      height = buf.readUInt32BE(at + 12);
      assert.equal(buf[at + 16], 8, "8-bit");
      channels = { 2: 3, 6: 4 }[buf[at + 17]];
    } else if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y ? data[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? data[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      data[y * stride + x] = (v + pred) & 255;
    }
  }
  return { width, height, channels, data };
}
// How much a box varies (luminance's standard deviation), in points (the snapshot is at 2x): an icon drawn there
// varies; covered by a card, it varies by as little as the card lets through.
function contrast(png, [x0, y0, x1, y1]) {
  const values = [];
  for (let y = y0 * 2; y < y1 * 2; y++)
    for (let x = x0 * 2; x < x1 * 2; x++) {
      const i = (y * png.width + x) * png.channels;
      values.push(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
}

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

  // The dragged tab's picture: a native panel that never takes the mouse or activates the app.
  const PREVIEW = `const preview = () => globalThis.expo.modules.NetnyahooShell.devDragPreviewState();`;
  const watch = (w, path, ms) => run(`${PREVIEW}
    const seen = [];
    const iv = setInterval(() => preview().then((p) => seen.push(p)), 30);
    return act("${w}", "drag:${path}").then(() => settle(${ms})).then(() => { clearInterval(iv); return seen; });`);

  await check("a tab dragged along the strip reorders and doesn't move the window", async () => {
    const frame = await run(`return st().windows.w1.frame;`);
    // The tab follows from where the drag started (a few points past the press), so go a little past t3's centre.
    const drags = await drag("w1", [[mid(2), 21], [mid(3), 21], [mid(4) + 30, 21]]);
    assert.equal(drags, 0, "window drags");
    assert.deepEqual(await order("w1"), ["p1", "p2", "t2", "t3", "t1", "t4"]);
    assert.deepEqual(await run(`return st().windows.w1.frame;`), frame);
  });

  await check("a tab dragged along the strip changes nothing until the drop: then one store update and one Chrome strip command", async () => {
    const now = await run(`return items("w1");`);
    const before = await order("w1");
    const at = (i) => Math.round((now[i][0] + now[i][1]) / 2);
    // Only tabs with a page are Chrome's: the two it trades places with get one.
    const live = before.slice(2, 4);
    await run(`${JSON.stringify(live)}.forEach((id, i) => st().navigate(id, "data:text/html,<h1>" + i));
      const ready = () => globalThis.nnChromeTabs.strips().some((s) => ${JSON.stringify(live)}.every((id) => s.tabs.some((t) => t.key === id)));
      const wait = (n) => (ready() || !n ? Promise.resolve(ready()) : settle(100).then(() => wait(n - 1)));
      return wait(100);`);
    // The third item (a tab) right past the fourth's middle, with plenty of moves on the way.
    const path = [[at(2), 21], [at(2) + 20, 21], [at(3), 21], [at(3) + 40, 21]];
    const seen = await run(`
      const cef = globalThis.expo.modules.NetnyahooCEF;
      const send = cef.tabStripCommand;
      const t0 = performance.now();
      const log = { commands: [], windows: [], drag: [], picture: [] };
      cef.tabStripCommand = (...a) => { log.commands.push(performance.now() - t0); return send.apply(cef, a); };
      const unsubscribe = nn.store.subscribe((s, p) => { if (s.windows !== p.windows) log.windows.push(performance.now() - t0); });
      const begin = nn.shell.dragPreview.begin;
      nn.shell.dragPreview.begin = (...a) => { log.picture.push(performance.now() - t0); return begin(...a); };
      // The drag's own store says when it starts and ends (the drop's store update comes right after, in the same task).
      const stop = globalThis.nnTabDrag.subscribe((d, was) => { if (!d.tabIds.length !== !was.tabIds.length) log.drag.push([d.tabIds.length > 0, performance.now() - t0]); });
      return act("w1", "drag:${path.map((p) => p.join(",")).join(";")}").then(() => settle(${path.length * 12 * 16 + 1200})).then(() => {
        stop(); unsubscribe(); cef.tabStripCommand = send; nn.shell.dragPreview.begin = begin;
        return log;
      });`);
    const start = seen.drag.find(([on]) => on)?.[1];
    const drop = seen.drag.find(([on]) => !on)?.[1];
    assert.ok(start !== undefined && drop !== undefined, JSON.stringify(seen.drag));
    assert.deepEqual(seen.commands.filter((t) => t < drop), [], "no strip command while dragging");
    assert.deepEqual(seen.windows.filter((t) => t < drop), [], "no store update while dragging");
    assert.equal(seen.windows.length, 1, `one store update on drop: ${JSON.stringify(seen.windows)}`);
    assert.equal(seen.commands.length, 1, `one strip command on drop: ${JSON.stringify(seen.commands)}`);
    // A reorder never takes the window's picture (it stalls the main thread): only leaving the strip does.
    assert.deepEqual(seen.picture, [], "no drag picture for a reorder");
    const after = await order("w1");
    assert.notDeepEqual(after, before, "it moved");
    // Back where it was, for the cases after this one.
    await run(`const id = ${JSON.stringify(before[2])}; const ids = ${JSON.stringify(before)}.filter((t) => !st().tabs[t].pinned); st().moveTab(id, ids.indexOf(id)); return settle(300);`);
    assert.deepEqual(await order("w1"), before);
  });

  await check("a tab dragged over its right neighbour draws on top of it", async () => {
    const now = await run(`return items("w1");`);
    const before = await order("w1");
    // The third item (a tab) held over the left part of the fourth, short of trading places with it.
    const [a, b] = [now[2], now[3]];
    const x0 = Math.round((a[0] + a[1]) / 2);
    const x1 = x0 + Math.round((a[1] - a[0]) * 0.4);
    // Selected, so it has its card. Under the empty end of the dragged tab (its close button's slot, past its title),
    // the neighbour's icon and title: alone, then with the tab held over them.
    await run(`st().activate(${JSON.stringify(before[2])}); return settle(600);`);
    const end = a[1] + (x1 - x0);
    const icon = [end - 24, 12, end - 6, 30];
    const shots = [join(data, "z-alone.png"), join(data, "z-over.png")];
    await run(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(shots[0])}).then(() => {
      act("w1", "drag:${x0},21;${x0 + 10},21;${x1},21;${x1},21;${x1},21;${x1},21");
      return settle(150 + 12 * 16 * 2 + 200).then(() => nn.shell.devSnapshotWindow("w1", ${JSON.stringify(shots[1])}));
    }).then(() => settle(1500));`);
    const [alone, over] = shots.map((path) => contrast(readPng(path), icon));
    // Drawn under the neighbour, its icon would show over the tab's card at full contrast; the card over it (half
    // opaque in dark, Dia's) dims it.
    assert.ok(alone > 12, `the box holds the icon: ${alone}`);
    assert.ok(over < alone * 0.75, `the neighbour's icon is drawn over the dragged tab: contrast alone ${alone.toFixed(1)}, held over ${over.toFixed(1)}`);
    assert.deepEqual(await order("w1"), before, "it went back");
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

  await check("a group dragged by its chip moves along the strip as one", async () => {
    // x1, the group's chip, g2, g1.
    const items = await run(`return items("w3");`);
    const at = (i) => Math.round((items[i][0] + items[i][1]) / 2);
    assert.equal(await drag("w3", [[Math.round(items[1][0] + 15), 21], [at(0), 21], [items[0][0] - 20, 21]]), 0, "window drags");
    assert.deepEqual(await run(`return [st().windows.w3.tabIds, st().groups.grp.tabIds];`), [["g2", "g1", "x1"], ["g2", "g1"]]);
  });

  await check("a tab dragged onto another window's tabs: the strip makes room at the pointer, and it lands there", async () => {
    // w6 in front of the others under the pointer.
    await run(`nn.store.setState((s) => ({ ui: { ...s.ui, focusOrder: ["w6", "w5", ...s.ui.focusOrder.filter((id) => id !== "w6" && id !== "w5")] } })); return 1;`);
    const from = await run(`return items("w5");`);
    const into = await run(`return items("w6");`);
    const dx = 600; // w6's left edge in w5's coordinates
    const a1 = Math.round((from[0][0] + from[0][1]) / 2);
    // Between b1's and b2's middles.
    const between = dx + Math.round((into[0][1] + into[1][1]) / 2);
    const seen = await run(`${PREVIEW}
      const seen = [];
      const iv = setInterval(() => preview().then((p) => { const d = globalThis.nnTabDrag.getState(); seen.push({ shape: p.shape, insert: d.insert, over: d.overWindow }); }), 30);
      return act("w5", "drag:${a1},21;${a1},-20;${dx - 30},-20;${between},21;${between + 2},22;${between + 3},21").then(() => settle(1400)).then(() => { clearInterval(iv); return seen; });`);
    assert.ok(seen.some((s) => s.over === "w6" && s.insert?.windowId === "w6" && s.insert.beforeId === "b2"), JSON.stringify(seen.slice(-4)));
    assert.ok(seen.some((s) => s.insert && s.shape === "pill"), "the pill over the strip");
    assert.deepEqual(await order("w6"), ["b1", "a1", "b2", "b3"]);
    assert.deepEqual(await order("w5"), ["a2"]);
  });

  await check("a background tab's card shows its own page: its last picture, else its icon and title", async () => {
    // Down onto the page and back into the strip (nothing changes), the card sampled over the page.
    const cardOf = async (id) => {
      const now = await run(`return items("w1");`);
      const i = (await order("w1")).indexOf(id);
      const x = Math.round((now[i][0] + now[i][1]) / 2);
      return run(`${PREVIEW}
        const out = {};
        act("w1", "drag:${x},21;${x},220;640,560;640,600;640,640;${x},100;${x},21");
        setTimeout(() => preview().then((p) => (out.p = p)), 760);
        return settle(2200).then(() => out.p);`);
    };
    const before = await order("w1");
    // t4 was never shown: its icon and title.
    const never = await cardOf("t4");
    assert.equal(never?.shape, "card", JSON.stringify(never));
    assert.ok(never.page && never.placeholder, `placeholder ${JSON.stringify(never)}`);
    // t2 with a page, shown for a moment, then left: its picture from then. (A New Tab page isn't a web page.)
    await run(`st().activate("t2"); st().navigate("t2", "data:text/html,<body style='background:%2366aaff'><h1>t2</h1>"); return settle(3200).then(() => { st().activate("t1"); return settle(600); });`);
    const shown = await cardOf("t2");
    assert.ok(shown?.page && !shown.placeholder, `its picture ${JSON.stringify(shown)}`);
    assert.deepEqual(await order("w1"), before);
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

  await check("a tab let go over the page away from a target opens in a window of its own, as in Dia", async () => {
    const now = await run(`return items("w1");`);
    const id = (await order("w1")).at(-1);
    const windows = await run(`return Object.keys(st().windows).length;`);
    const width = await run(`return st().windows.w1.frame[2];`);
    const x = Math.round((now.at(-1)[0] + now.at(-1)[1]) / 2);
    const splits = await run(`return Object.values(st().splits).map((v) => v.tabIds);`);
    // Low in the split's left pane: below its targets, which are centred on the pane.
    const seen = await watch("w1", `${x},21;${x},200;${Math.round(width / 4)},560;${Math.round(width / 4)},740`, 1400);
    // Every shape it took since the drag began (the pill shows for only 30 ms).
    const shapes = seen.at(-1).shapes;
    assert.deepEqual(shapes.slice(0, 2), ["pill", "card"], `pill, then card: ${shapes}`);
    assert.ok(seen.every((p) => !p.key && !p.activeApp && (p.shape === "hidden" || p.ignoresMouse)), "never key or active, takes no mouse");
    assert.ok(seen.some((p) => p.shape === "card" && p.frame[2] === 209 && p.frame[3] === 110), "a 209 × 110 card");
    assert.equal(seen.at(-1).visible, false, "gone after the drop");
    const after = await run(`return Object.values(st().windows).map((w) => w.tabIds);`);
    assert.equal(after.length, windows + 1, JSON.stringify(after));
    assert.ok(after.some((ids) => ids.length === 1 && ids[0] === id), JSON.stringify(after));
    assert.deepEqual(await run(`return Object.values(st().splits).map((v) => v.tabIds);`), splits);
  });

  await check("a tab dragged out of the window shows its picture there and tears off into a new one", async () => {
    const now = await run(`return items("w1");`);
    const x = Math.round((now[2][0] + now[2][1]) / 2);
    const id = (await order("w1"))[2];
    const windows = await run(`return Object.keys(st().windows).length;`);
    const frame = await run(`return st().windows.w1.frame;`);
    const seen = await watch("w1", `${x},21;${x},-40;${x + 80},-90`, 1200);
    const outside = seen.filter((p) => p.shape === "card");
    assert.ok(outside.length, "a card outside the window");
    // Centred on the pointer, above the window.
    assert.ok(outside.some((p) => p.frame[1] + p.frame[3] / 2 > frame[1] + frame[3]), JSON.stringify(outside.at(-1)));
    // It grows into the new window before it fades.
    assert.ok(seen.some((p) => p.visible && p.frame[2] === frame[2] && p.frame[3] === frame[3]), "grew to the new window");
    const after = await run(`return Object.values(st().windows).map((w) => w.tabIds);`);
    assert.equal(after.length, windows + 1, JSON.stringify(after));
    assert.ok(after.some((ids) => ids.length === 1 && ids[0] === id), JSON.stringify(after));
  });

  await check("a split moves along the strip as one, and a pane pulled out of the window leaves it", async () => {
    await run(`st().newTab("w1"); return settle(800);`);
    const ids = await order("w1");
    const fresh = ids.at(-1);
    // p2, p1, the split (t1 | t3), a new tab.
    assert.deepEqual(ids.slice(0, 4), ["p2", "p1", "t1", "t3"]);
    const now = await run(`return items("w1");`);
    const split = now[2], last = now[3];
    const y = 21;
    await drag("w1", [[Math.round(split[0] + 30), y], [Math.round(last[0]), y], [Math.round(last[1]) + 20, y]]);
    assert.deepEqual(await order("w1"), ["p2", "p1", fresh, "t1", "t3"]);
    const moved = await run(`return items("w1");`);
    const pane = Math.round(moved[3][0] + (moved[3][1] - moved[3][0]) * 0.75);
    await drag("w1", [[pane, y], [pane, -40], [pane + 40, -90]]);
    const state = await run(`return { windows: Object.values(st().windows).map((w) => w.tabIds), splits: Object.values(st().splits).map((v) => v.tabIds) };`);
    assert.ok(state.windows.some((w) => w.length === 1 && w[0] === "t3"), JSON.stringify(state));
    assert.ok(!state.splits.some((v) => v.includes("t3")), JSON.stringify(state));
  });

  await check("a tab dragged into the pinned tabs is pinned, and dragged back out is unpinned", async () => {
    const ids = await order("w1");
    const fresh = ids[2];
    let now = await run(`return items("w1");`);
    const x = Math.round((now[2][0] + now[2][1]) / 2);
    // Onto the first pinned tab's left half.
    assert.equal(await drag("w1", [[x, 21], [now[1][0], 21], [now[0][0] + 6, 21]]), 0, "window drags");
    assert.deepEqual(await run(`return [st().windows.w1.tabIds, st().tabs["${fresh}"].pinned];`), [[fresh, "p2", "p1", "t1"], true]);
    now = await run(`return items("w1");`);
    const cell = Math.round((now[0][0] + now[0][1]) / 2);
    // Out past t1's middle.
    await drag("w1", [[cell, 21], [now[3][0], 21], [now[3][1] - 20, 21]]);
    assert.deepEqual(await run(`return [st().windows.w1.tabIds, st().tabs["${fresh}"].pinned];`), [["p2", "p1", "t1", fresh], false]);
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
  await check("sidebar: nothing moves as a drag starts or ends (the pin target takes no room)", async () => {
    const rows = () => run(`return Promise.all([...globalThis.sidebarDrag.items.values()].filter((i) => (i.kind === "row" || i.kind === "group") && i.view).map((i) => new Promise((r) => i.view.measureInWindow((x, y, w, h) => r([i.key, x, y, w, h])))));`);
    // Nothing pinned: the case whose pin target used to push the list down.
    await run(`const pinned = st().windows.w1.tabIds.filter((id) => st().tabs[id].pinned); if (pinned.length) st().placeTabs(pinned, { pinned: false, beforeId: null }); return settle(800);`);
    const start = (await rows()).sort((a, b) => a[2] - b[2]);
    const top = start.find(([key]) => key.startsWith("t:"));
    assert.ok(top, JSON.stringify(start));
    const [key, x, y, w, h] = top;
    const sx = Math.round(x + w / 2), sy = Math.round(y + h / 2);
    // Pressed, moved a little within its own place, held, let go: the drag shows its pin target meanwhile.
    const during = await run(`act("w1", "drag:${sx},${sy};${sx},${sy + 8};${sx},${sy + 8};${sx},${sy + 8};${sx},${sy + 8}");
      return settle(150 + 12 * 16 * 2 + 150).then(() => Promise.all([...globalThis.sidebarDrag.items.values()].filter((i) => (i.kind === "row" || i.kind === "group") && i.view && i.key !== ${JSON.stringify(key)}).map((i) => new Promise((r) => i.view.measureInWindow((x, y, w, h) => r([i.key, x, y, w, h]))))))
        .then((rows) => ({ rows, ghost: !!globalThis.sidebarDrag.active, zone: !!globalThis.sidebarDrag.regions.get("tiles") }));`);
    await run(`return settle(1500);`);
    const end = await rows();
    const at = (list) => Object.fromEntries(list.map(([k, x, y]) => [k, [x, y]]));
    const [s0, s1, s2] = [at(start), at(during.rows), at(end)];
    assert.ok(during.ghost, "dragging when measured");
    assert.ok(during.zone, "the pin target showed");
    for (const k of Object.keys(s1)) {
      assert.ok(Math.abs(s1[k][1] - s0[k][1]) < 0.5 && Math.abs(s1[k][0] - s0[k][0]) < 0.5, `${k} moved during the drag: ${s0[k]} -> ${s1[k]}`);
    }
    for (const k of Object.keys(s0)) {
      assert.ok(s2[k] && Math.abs(s2[k][1] - s0[k][1]) < 0.5, `${k} moved after the drag: ${s0[k]} -> ${s2[k]}`);
    }
  });

  await check("sidebar: a row let go between two others settles into its place, where the row then is", async () => {
    await run(`st().newTab("w1"); st().newTab("w1"); st().newTab("w1"); return settle(1200);`);
    const rows = await run(`return Promise.all([...globalThis.sidebarDrag.items.values()].filter((i) => i.kind === "row" && !i.parentGroup && i.view).map((i) => new Promise((r) => i.view.measureInWindow((x, y, w, h) => r({ id: i.tabIds[0], x, y, w, h })))));`);
    rows.sort((a, b) => a.y - b.y);
    assert.ok(rows.length >= 3, JSON.stringify(rows));
    const row = rows[0];
    const sx = Math.round(row.x + row.w / 2), sy = Math.round(row.y + row.h / 2);
    // Down past the next row's middle, short of the one after.
    const to = Math.round(rows[1].y + rows[1].h * 0.8);
    const out = await run(`const c = globalThis.sidebarDrag; c.landed = null;
      return act("w1", "drag:${sx},${sy};${sx},${sy + 10};${sx},${to}").then(() => settle(1500)).then(() => {
        const l = c.landed; const it = l && c.items.get(l.key);
        return new Promise((r) => (it ? it.view.measureInWindow((x, y) => r({ landed: l, row: { x, y } })) : r({ landed: l })));
      });`);
    assert.equal(out.landed?.key, `t:${row.id}`, JSON.stringify(out));
    assert.ok(Math.abs(out.landed.x - out.row.x) < 0.5 && Math.abs(out.landed.y - out.row.y) < 0.5, JSON.stringify(out));
  });
} finally {
  if (pid && alive(pid)) process.kill(pid);
  if (!keep) rmSync(data, { recursive: true, force: true });
  else console.log(`data: ${data}`);
}
const failed = results.filter((r) => r[0] === "FAIL");
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

// Windowing seen frame by frame (the owner's 0.2.22 RC recording, rec1522): tab switches, a new window, a tab torn
// off into a new window, and a window's last tab dragged onto another window, recorded off the screen at 60 fps in a
// hidden instance.
//
//   node apps/browser/scripts/windowing-test.mjs <Debug Netnyahoo.app> [--port=9483] [--keep-data]
//
// Each frame is the instance's own windows as the screen composites them (windowing-rec.swift, built here with
// swiftc). A frame that shows neither the state before a change nor the one after it is a glitch: the old page
// blank or half-drawn while the app still shows the old tab, a new window empty but for its traffic lights, an
// emptied window left on screen. The frame checks are skipped when the screen can't be recorded (locked); the
// no-reload check needs no screen.
//
// One line per check; the details (and the recorder's own output) go to windowing-test.log beside the instance's data.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node windowing-test.mjs <Debug Netnyahoo.app> [--port=<DevTools port>] [--keep-data]");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "nn-windowing-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "windowing-test.log"), { name: "windowing-test" });

// Two pages that look nothing alike, so a half-drawn one stands out.
const page = (bg, ink, title) => `<!doctype html><title>${title}</title><body style="margin:0;background:${bg};color:${ink};font:22px Georgia">
  <h1 style="font:900 110px/1 Helvetica;text-align:center;margin:40px 0">${title.toUpperCase()}</h1>
  ${Array.from({ length: 60 }, (_, i) => `<p style="margin:0 40px 18px">Paragraph ${i}: members who stop answering are noticed again.</p>`).join("")}</body>`;
const server = createServer((req, res) => {
  const blue = req.url.startsWith("/blue");
  res.writeHead(200, { "content-type": "text/html" });
  res.end(blue ? page("#1d3557", "#f1faee", "Blue post") : page("#ece6da", "#141210", "Official gazette"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const tab = (id, windowId, url, createdAt) => ({ id, windowId, url, title: url ? id : "", createdAt, lastActiveAt: createdAt });
// Frames are AppKit's (from the bottom of the screen); w2 sits clear of w1, to the right.
const fixture = () => session({
  profiles: [{ id: "default", name: "Personal", color: "plum" }],
  settings: { tabLayout: "sidebar" },
  windows: [
    { id: "w1", tabIds: ["n1", "g1", "b1", "n2"], activeTabIds: { default: "g1" }, frame: [40, 222, 1000, 700] },
    { id: "w2", tabIds: ["m1"], activeTabIds: { default: "m1" }, frame: [1060, 332, 440, 500] },
  ],
  focusedWindowId: "w2",
  tabs: [tab("n1", "w1", "", 1), tab("g1", "w1", `${base}/gazette`, 2), tab("b1", "w1", `${base}/blue`, 3), tab("n2", "w1", "", 4), tab("m1", "w2", `${base}/blue?moved`, 5)],
});

let app = null;
const HELPERS = `
const C = globalThis.expo.modules.NetnyahooCEF;
const st = () => nn.store.getState();
const win = (id) => C.chromeWindows().then((ws) => { const f = st().windows[id].frame; const w = ws.filter((w) => w.hasRoot).find((w) => { const r = w.frame.match(/[-\\d.]+/g).map(Number); return Math.abs(r[0] - f[0]) < 2 && Math.abs(r[2] - f[2]) < 2; }); return w && w.window; });
const act = (id, a) => win(id).then((n) => C.devWindow(n, a));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`);

// MARK: Frames

const recorderSource = join(dirname(fileURLToPath(import.meta.url)), "windowing-rec.swift");
const recorder = join(data, "windowing-rec");
let canRecord = false;

/** Records the instance's windows while `during` runs; resolves to the frames ({t, w, h, g: Uint8Array}). */
async function record(seconds, during) {
  const file = join(data, `frames-${Date.now()}.jsonl`);
  const child = spawn(recorder, [String(app.pid), String(seconds), file], { stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stdout.on("data", (d) => (said += d));
  child.stderr.on("data", (d) => rep.log(`recorder: ${String(d).trim()}`));
  const done = new Promise((r) => child.on("exit", r));
  for (const start = Date.now(); !said.includes("started") && Date.now() - start < 8000; await sleep(20)) if (child.exitCode !== null) break;
  if (!said.includes("started")) {
    child.kill("SIGKILL");
    return null;
  }
  await sleep(300);
  await during();
  // A capture can hang with the screen locked: give it a deadline.
  const ended = await Promise.race([done, sleep((seconds + 10) * 1000).then(() => "timeout")]);
  if (ended === "timeout") child.kill("SIGKILL");
  if (!existsSync(file)) return null;
  const frames = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    const f = JSON.parse(l);
    return { t: f.t, w: f.w, h: f.h, g: Buffer.from(f.g, "base64") };
  });
  return frames.length > 10 ? frames : null;
}

// A store window's frame as a region of the recorded frames (an eighth of the screen's points, from the top).
const regionOf = (frame, H, inset = { left: 0, top: 0, right: 0, bottom: 0 }) => ({
  x: Math.round((frame[0] + inset.left) / 8),
  y: Math.round((H - frame[1] - frame[3] + inset.top) / 8),
  w: Math.round((frame[2] - inset.left - inset.right) / 8),
  h: Math.round((frame[3] - inset.top - inset.bottom) / 8),
});
const crop = (f, r) => {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * r.w + x] = f.g[(r.y + y) * f.w + r.x + x] ?? 0;
  return out;
};
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

/** Runs of identical frames in a region; a run held 3+ frames is a state the screen rested in. Returns the frames
 *  (as runs) that match no resting state: what the screen showed in passing. */
function glitches(frames, r, tolerance = 4) {
  const crops = frames.map((f) => crop(f, r));
  const runs = [];
  for (let i = 0; i < crops.length; i++) {
    if (runs.length && diff(crops[i], crops[runs.at(-1).at]) < 1) runs.at(-1).n++;
    else runs.push({ at: i, n: 1 });
  }
  const resting = runs.filter((run) => run.n >= 3).map((run) => crops[run.at]);
  return runs.filter((run) => run.n < 3 && resting.every((s) => diff(crops[run.at], s) > tolerance)).map((run) => ({ t: frames[run.at].t, frames: run.n }));
}

// A check that returns a reason was skipped (reporter.check has no skip).
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const skip = await fn();
    rep.record(name, { ms: Date.now() - t0, skip: skip || undefined });
  } catch (error) {
    rep.record(name, { ms: Date.now() - t0, error });
  }
}

try {
  mkdirSync(data, { recursive: true });
  const built = spawnSync("swiftc", ["-O", recorderSource, "-o", recorder], { encoding: "utf8" });
  if (built.status !== 0) rep.log(`(no recorder: ${built.stderr.trim().split("\n")[0]})`);
  // perf-probe: a Release build runs the dev harness only for a data folder holding it.
  app = await launch(appPath, { data, port, session: fixture(), onboarded: true, probe: true });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(2500);
  const probe = existsSync(recorder) ? await record(0.5, async () => {}) : null;
  canRecord = !!probe;
  const H = probe ? probe[0].h * 8 : 0;
  if (!canRecord) rep.log("(the screen can't be recorded: frame checks skipped)");

  await check("tab switches show the old page or the new one, never a blank or half-drawn page", async () => {
    if (!canRecord) return "no screen";
    const frame = await run(`return st().windows.w1.frame;`);
    // Each page once first (a page loading for the first time is white until it paints, rightly).
    await run(`nn.actions.switchToTab("b1"); return settle(1500).then(() => { nn.actions.switchToTab("g1"); return settle(1000); });`);
    // Web page to web page, and to and from a New Tab page, 20 switches 400 ms apart.
    const order = ["b1", "g1", "n2", "b1", "n1", "g1", "b1", "n2", "g1", "b1", "g1", "n1", "b1", "g1", "n2", "b1", "n2", "g1", "b1", "g1"];
    const frames = await record(9.5, () => run(`${JSON.stringify(order)}.forEach((id, i) => setTimeout(() => nn.actions.switchToTab(id), i * 400)); return 1;`));
    assert.ok(frames, "no frames");
    // The page area, clear of the sidebar and the toolbar.
    const found = glitches(frames, regionOf(frame, H, { left: 200, top: 56, right: 16, bottom: 16 }));
    // 0.2.22 RC: 7–13 in 20 switches (the old page blank or half-drawn while the app still showed its tab). Left: the
    // incoming page a frame late now and then, or a tile.
    assert.ok(found.length <= 4, `${found.length} frames match neither tab: ${JSON.stringify(found)}`);
  });

  await check("a new window shows up with its content", async () => {
    if (!canRecord) return "no screen";
    const ids = await run(`return Object.keys(st().windows);`);
    let frames;
    let created;
    frames = await record(2.5, async () => { created = await run(`return nn.actions.openWindow();`); });
    assert.ok(frames && created && !ids.includes(created), "a new window");
    const frame = await run(`return st().windows["${created}"].frame;`);
    // Its sidebar (the New Tab page's picture fades in on its own).
    const r = regionOf(frame, H, { left: 8, top: 40, right: frame[2] - 180, bottom: 40 });
    const crops = frames.map((f) => crop(f, r));
    const first = crops.findIndex((c, i) => i > 0 && diff(c, crops[0]) > 4);
    assert.ok(first > 0, "the window never showed");
    // Its first frame on screen is (nearly) what it settles on: not an empty window, nor one still drawing its sidebar.
    const off = diff(crops[first], crops.at(-1));
    assert.ok(off < 6, `first frame ${off.toFixed(1)} levels from the settled window`);
    await run(`st().closeWindow("${created}"); return settle(500);`);
  });

  await check("a tab torn off into a new window: its old window shows its next tab soon", async () => {
    if (!canRecord) return "no screen";
    const w1 = await run(`return st().windows.w1.frame;`);
    // g1's row in w1's tab list: the row a click there activates.
    let row = null;
    for (let y = 60; y <= 200 && row === null; y += 12) {
      await run(`return act("w1", "click:60,${y}").then(() => settle(250));`);
      if ((await run(`return st().windows.w1.activeTabIds.default;`)) === "g1") row = y;
    }
    assert.ok(row !== null, "g1's row in w1's tab list");
    // Each page painted once, the torn one shown last.
    await run(`nn.actions.switchToTab("b1"); return settle(800).then(() => { nn.actions.switchToTab("g1"); return settle(1200); });`);
    const ids = await run(`return Object.keys(st().windows);`);
    // Out of w1 to the right, below w2, so the new window and the dragged card stay clear of w1's page.
    const target = [w1[2] + 300, w1[3] - 50];
    const path = `60,${row};60,${row + 20};${w1[2] - 100},${row + 60};${target.join(",")};${target[0] + 2},${target[1] + 2};${target.join(",")}`;
    const frames = await record(5, () => run(`return act("w1", "drag:${path}").then(() => settle(${6 * 12 * 16 + 1500}));`));
    const torn = (await run(`return Object.values(st().windows).map((w) => [w.id, w.tabIds]);`)).find(([id]) => !ids.includes(id));
    assert.ok(torn && torn[1].includes("g1"), "g1 in a new window");
    assert.ok(frames, "no frames");
    const page = regionOf(w1, H, { left: 200, top: 56, right: 16, bottom: 16 });
    const crops = frames.map((f) => crop(f, page));
    const sd = (c) => { const m = mean(c); return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / c.length); };
    const blank = crops.filter((c) => sd(c) < 3);
    rep.log(`${blank.length} frames of w1's page blank`);
    await run(`st().closeWindow("${torn[0]}"); return settle(500);`);
    // Not there yet: 1–4 frames blank (was 3–5). The next tab now paints through the drag and shows in the batch that
    // takes the torn tab away (it showed an empty card for 2 more frames). Left: the torn page draws only its
    // background in w1 for 1–3 frames before that batch lands, while the new window is built. This guards against it
    // getting worse.
    assert.ok(blank.length <= 5, `${blank.length} frames of w1's page blank`);
  });

  await check("a window's last tab dropped onto another window: the tab keeps its page, the emptied window goes at once", async () => {
    const strips = () => run(`return C.tabStrips().then((tx) => tx.strips.flatMap((s) => s.tabs).filter((t) => t.key === "m1").map((t) => t.browser));`);
    const [browser] = await strips();
    assert.ok(browser, "m1 is live");
    const w2 = await run(`return st().windows.w2.frame;`);
    const w1 = await run(`return st().windows.w1.frame;`);
    // From w2's tab row onto w1's tab list (the pointer in w2's coordinates).
    const target = [w1[0] + 110 - w2[0], (w2[1] + w2[3]) - (w1[1] + w1[3] - 160)];
    const path = `70,70;70,100;-300,150;${target[0] + 30},${target[1]};${target.join(",")};${target[0] + 2},${target[1] + 2};${target.join(",")}`;
    const drag = () => run(`return act("w2", "drag:${path}").then(() => settle(${7 * 12 * 16 + 1200}));`);
    const frames = canRecord ? await record(4.5, drag) : (await drag(), null);
    const after = await run(`return Object.values(st().windows).map((w) => [w.id, w.tabIds]);`);
    assert.deepEqual(after.find(([id]) => id === "w2"), undefined, `w2 closed: ${JSON.stringify(after)}`);
    assert.ok(after.find(([id]) => id === "w1")[1].includes("m1"), `m1 in w1: ${JSON.stringify(after)}`);
    // 0.2.22 RC: the tab closed with its window and the page loaded afresh in a new one (blank, history gone).
    await sleep(800);
    assert.deepEqual(await strips(), [browser], "the same live tab, not a new one");
    if (!frames) return "no screen";
    // w2's place shows w2 as it was, then nothing: not w2 emptied, nor fading out. (0.2.22 RC: ~5 empty frames, then a
    // 0.2 s fade; then 2–4 frames of w2 without its page, its ordering out waiting for the end of the turn.)
    const r = regionOf(w2, H, { left: 8, top: 8, right: 8, bottom: 8 });
    const crops = frames.map((f) => crop(f, r));
    const was = crops[0];
    const between = crops.filter((c) => diff(c, was) > 4 && mean(c) > 3);
    assert.ok(between.length <= 1, `${between.length} frames of w2 neither as it was nor gone`);
    // w1's page goes from its own page to the moved one; at most a frame blank while Chrome draws it in its new
    // window (0.2.22 RC: ~280 ms, the page loading again).
    const page = regionOf(w1, H, { left: 200, top: 56, right: 16, bottom: 16 });
    const blank = frames.map((f) => crop(f, page)).filter((c) => { const m = mean(c); return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / c.length) < 3; });
    assert.ok(blank.length <= 1, `${blank.length} frames of w1's page blank`);
  });
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);

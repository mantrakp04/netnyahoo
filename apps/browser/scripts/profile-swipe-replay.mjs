// Replays the owner's real trackpad profile swipes (fixtures/owner-trackpad-take1.json) through the
// native tracker of an isolated hidden Debug app, and records every tracker decision.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
if (!appArg) {
  console.error("usage: node profile-swipe-replay.mjs <Debug Netnyahoo.app> [--port=9475] [--keep-data] [--only=sequence|1,2,5] [--wait-for-capture] [--profiles=2] [--rows=30] [--no-momentum] [--dispatch=direct|app] [--skip=independent,sequence,page]");
  process.exit(2);
}
const app = resolve(appArg);
const bundlePort = args.find((a) => a.startsWith("--bundle-port="))?.split("=")[1];
if (bundlePort) assert.match(bundlePort, /^\d{2,5}$/);
const bundleArgs = bundlePort ? ["--args", "-RCT_jsLocation", `127.0.0.1:${bundlePort}`] : [];
assert.notEqual(app, "/Applications/Netnyahoo.app", "use an isolated Debug build");
const port = opt("port", "9475");
const keep = args.includes("--keep-data");
const onlySpec = opt("only", "");
const sequenceOnly = onlySpec === "sequence";
const only = sequenceOnly ? [] : onlySpec.split(",").filter(Boolean).map(Number);
const profileCount = Math.max(2, Number(opt("profiles", "2")));
// Regular tabs per profile besides the two pins and the New Tab.
const rows = Number(opt("rows", "30"));
assert.ok(Number.isInteger(rows) && rows >= 0 && rows <= 100, "--rows must be an integer from 0 to 100");
const momentum = !args.includes("--no-momentum");
// app: deliver each step through [NSApp sendEvent:] and the local monitor instead of calling the tracker directly.
const dispatch = opt("dispatch", "direct");
assert.ok(["direct", "app"].includes(dispatch), "--dispatch must be direct or app");
const skip = new Set(opt("skip", "").split(",").filter(Boolean));
if (sequenceOnly) for (const name of ["reverse", "vertical", "strip", "page"]) skip.add(name);
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/owner-trackpad-take1.json"), "utf8"));
const gestures = fixture.gestures.filter((g) => !only.length || only.includes(g.id));
// The owner's cursor in window-content coordinates (screen 185,450 in a window at 76,56).
const [pointX, pointY] = fixture.cursor.local;

const scratch = "/tmp/nn-swipe-replay";
mkdirSync(scratch, { recursive: true });
const data = mkdtempSync(join(scratch, "data-"));
const resultsPath = join(scratch, `results-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = { app, data, fixture: fixture.source, point: [pointX, pointY], momentum, dispatch, rows, cases: [] };
let pid;
let evalId = 0;

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url.startsWith("/scroll-fixture"))
    return res.end('<!doctype html><title>Swipe scroll fixture</title><body style="margin:0"><div style="width:2600px;height:4000px;background:linear-gradient(120deg,#ffd9dd,#addbff)">Native scroll fixture</div>');
  const name = decodeURIComponent(req.url.slice(1)) || "Page";
  res.end(`<!doctype html><title>${name}</title><body style="font:16px system-ui;margin:40px">${name}</body>`);
});

const profileIds = ["default", "work", "travel", "home"].slice(0, profileCount);
const profileNames = { default: "Personal", work: "Work", travel: "Travel", home: "Home" };
const colors = { default: "plum", work: "blue", travel: "green", home: "orange" };
let fixtureOrigin = "";
function seedSession() {
  const tabs = [];
  const tabIds = [];
  const activeTabIds = {};
  const add = (profileId, n, extra) => {
    const id = `${profileId}-${n}`;
    tabIds.push(id);
    tabs.push({ id, windowId: "w1", profileId, url: "netnyahoo://newtab", title: "New Tab", favicon: null, pinned: false, muted: false, zoom: 1,
      customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: tabs.length + 1, lastActiveAt: tabs.length + 1, ...extra });
    return id;
  };
  for (const profileId of profileIds) {
    for (const [n, name] of [["pin-a", "Weather"], ["pin-b", "Notes"]]) {
      const url = `${fixtureOrigin}/${name}`;
      add(profileId, n, { url, title: name, pinned: true, pinnedUrl: url });
    }
    // The default 30 rows make the 860pt window's sidebar scroll vertically.
    for (let i = 0; i < rows; i++) {
      const url = `${fixtureOrigin}/Reading%20${i + 1}`;
      add(profileId, `t${i}`, { url, title: `Reading ${i + 1}`, lastActiveAt: 1 });
    }
    activeTabIds[profileId] = add(profileId, "new", { lastActiveAt: 100 });
  }
  writeFileSync(join(data, "session.json"), JSON.stringify({ version: 2,
    profiles: Object.fromEntries(profileIds.map((id, i) => [id, { id, name: profileNames[id], color: colors[id], icon: null, createdAt: i }])),
    profileOrder: profileIds,
    windows: [{ id: "w1", profileId: "default", incognito: false, tabIds, activeTabIds, sidebarOpen: true, frame: fixture.cursor.window, createdAt: 1 }],
    windowOrder: ["w1"], focusedWindowId: "w1", tabs,
    groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
  }));
}

async function nn(body, timeout = 15000) {
  const id = `replay-${Date.now()}-${++evalId}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  for (let start = Date.now(); Date.now() - start < timeout; await sleep(25)) {
    if (pid && !alive(pid)) throw new Error("app exited");
    let out;
    try { out = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8")); } catch { continue; }
    if (out.id !== id) continue;
    if (out.error) throw new Error(out.error);
    return out.result;
  }
  throw new Error(`dev harness timeout: ${body.slice(0, 120)}`);
}
function alive(p) {
  try { process.kill(Number(p), 0); return true; } catch { return false; }
}
const profile = () => nn('return nn.store.getState().windows.w1.profileId;');
async function waitProfile(expected, deadline) {
  let seen;
  while (Date.now() < deadline) {
    if ((seen = await profile()) === expected) return seen;
    await sleep(25);
  }
  return profile();
}
async function rest(profileId) {
  await nn(`nn.store.getState().switchProfile("w1", ${JSON.stringify(profileId)}); return true;`);
  assert.equal(await waitProfile(profileId, Date.now() + 1800), profileId, `reset to ${profileId}`);
  // Pager linger (150ms) and rebase (100ms) end before the next gesture.
  await sleep(400);
  await nn("globalThis.nnSwipe.received(); return true;");
}
const windows = () => nn('return globalThis.expo.modules.NetnyahooCEF.chromeWindows();');
async function rootWindow() {
  const all = await windows();
  return (all.find((w) => w.hasRoot && w.visible) ?? all.find((w) => w.hasRoot))?.window;
}
function stepsOf(g, offsetMs = 0) {
  return g.steps.filter((s) => momentum || !s.rawMomentumPhase).map((s) => ({ ...s, atMs: s.atMs + offsetMs, timestampMs: s.timestampMs + offsetMs, ...(dispatch === "app" ? { dispatch } : {}) }));
}
const endMs = (g) => g.steps.find((s) => s.phase === "ended" || s.phase === "cancelled")?.atMs ?? 0;
async function replay(steps, window) {
  window ??= await rootWindow();
  const result = await nn(`return globalThis.expo.modules.NetnyahooSwipe.devSimulate(${pointX}, ${pointY}, ${window}, ${JSON.stringify(steps)}, false);`,
    Math.max(15000, (steps.at(-1)?.atMs ?? 0) + 15000));
  const received = await nn("return globalThis.nnSwipe.received();");
  const fidelity = checkFidelity(steps, result);
  if (fidelity.mismatches.length)
    throw fail(`synthetic events differ from the requested steps: ${JSON.stringify(fidelity.mismatches.slice(0, 5))}`, { fidelity, result, received });
  return { window, result, received, fidelity };
}

// AppKit phases for CG raw values: scroll began 1, changed 2, ended 4, cancelled 8, mayBegin 128;
// momentum begin 1, continue 2, end 3 (checked against the owner's capture).
const SCROLL_NS = { 1: 1, 2: 4, 4: 8, 8: 16, 128: 32 };
const MOMENTUM_NS = { 1: 1, 2: 4, 3: 8 };
const NAMED_NS = { began: [1, 0], changed: [4, 0], ended: [8, 0], cancelled: [16, 0], mayBegin: [32, 0],
  momentumBegan: [0, 1], momentum: [0, 4], momentumEnded: [0, 8], wheel: [0, 0] };
evidence.fidelity = { replays: 0, events: 0, checked: 0, mismatches: 0 };
function checkFidelity(steps, result) {
  const mismatches = [];
  const events = result?.events ?? [];
  if (result?.error) mismatches.push({ error: result.error });
  // Routing errors are logged as extra entries before their step's entry.
  for (const e of events) if (e.error) mismatches.push({ routing: e.error });
  const logged = events.filter((e) => !e.error);
  if (logged.length !== steps.length) mismatches.push({ count: { requested: steps.length, actual: logged.length } });
  let checked = 0;
  steps.forEach((s, i) => {
    const e = logged[i];
    if (!e) return;
    const requested = { phase: s.phase };
    const actual = { phase: e.phase };
    if (e.phase !== s.phase) return mismatches.push({ index: i, requested, actual });
    if (s.phase === "swipe") return checked++;
    let [nsPhase, nsMomentumPhase] = NAMED_NS[s.phase] ?? [undefined, undefined];
    if (s.rawPhase !== undefined) nsPhase = SCROLL_NS[s.rawPhase];
    if (s.rawMomentumPhase !== undefined) nsMomentumPhase = MOMENTUM_NS[s.rawMomentumPhase];
    Object.assign(requested, { nsPhase, nsMomentumPhase });
    Object.assign(actual, { nsPhase: e.nsPhase, nsMomentumPhase: e.nsMomentumPhase });
    let bad = e.nsPhase !== nsPhase || e.nsMomentumPhase !== nsMomentumPhase;
    // Line-unit wheel steps report line-scaled deltas, so only precise steps compare points.
    if (s.phase !== "wheel") {
      requested.scrollingDeltaX = s.dxPoint ?? s.dx ?? 0;
      requested.scrollingDeltaY = s.dyPoint ?? s.dy ?? 0;
      actual.scrollingDeltaX = e.scrollingDeltaX;
      actual.scrollingDeltaY = e.scrollingDeltaY;
      bad ||= e.scrollingDeltaX !== requested.scrollingDeltaX || e.scrollingDeltaY !== requested.scrollingDeltaY;
    }
    if (s.dispatch === "app") {
      requested.monitorEntered = true;
      actual.monitorEntered = e.monitorEntered;
      bad ||= e.monitorEntered !== true;
    }
    if (bad) mismatches.push({ index: i, requested, actual });
    checked++;
  });
  const f = evidence.fidelity;
  f.replays++;
  f.events += logged.length;
  f.checked += checked;
  f.mismatches += mismatches.length;
  return { steps: steps.length, events: logged.length, checked, mismatches };
}

// One line per native gesture: where it went, why it stopped, what it emitted.
function summarize(result, received) {
  const acks = result?.acks ?? [];
  const bySeq = new Map();
  for (const a of acks) {
    if (!a.diag || a.seq === undefined) continue;
    const s = bySeq.get(a.seq) ?? { seq: a.seq, emitted: [], waits: {} };
    bySeq.set(a.seq, s);
    if (a.diag === "begin") {
      s.target = a.target || null;
      s.hit = a.hit?.slice(0, 4).map((h) => h.class).join("<");
      s.targets = a.targets?.map((t) => t.miss || "match").join(",");
      s.scrollers = a.scrollers?.map((x) => ({ document: x.document, clipBounds: x.clipBounds, wrapperFrame: x.wrapperFrame, fits: x.fits,
        blocksBack: x.blocksBack, blocksForward: x.blocksForward, wrapperHorizontal: x.wrapperHorizontal, horizontalElasticity: x.horizontalElasticity }));
    } else if (a.diag === "reject") {
      s.reject = a.reason;
      if (a.scrollers) s.rejectScrollers = a.scrollers;
    } else if (a.diag === "wait") s.waits[a.reason] = (s.waits[a.reason] ?? 0) + 1;
    else if (a.diag === "track") s.tracked = { direction: a.direction, available: a.available, dx: a.dx, dy: a.dy };
    else if (a.diag === "emit") s.emitted.push({ phase: a.phase, distance: Math.round(a.distance), velocity: Math.round(a.velocity) });
    else if (a.diag === "endUntracked") s.endUntracked = { dx: a.dx, dy: a.dy };
  }
  const events = result?.events ?? [];
  return {
    where: result?.where,
    gestures: [...bySeq.values()],
    swallowed: events.filter((e) => e.swallowed === true || e.monitorSwallowed === true).length,
    passed: events.filter((e) => e.swallowed === false || e.monitorSwallowed === false).length,
    // App-dispatched steps whose monitor never ran: delivery unknown, not counted either way.
    monitorMissed: events.filter((e) => e.dispatch === "app" && !e.monitorEntered).length,
    maxLateMs: Math.max(0, ...events.map((e) => e.lateMs ?? 0)),
    unlatched: acks.filter((a) => a.diag === "unlatched").length,
    received: received.map((r) => r.phase),
    errors: events.filter((e) => e.error).map((e) => e.error),
  };
}

async function test(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    evidence.cases.push({ name, passed: true, ms: Date.now() - started, ...result });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.cases.push({ name, passed: false, ms: Date.now() - started, error: String(error), ...(error.evidence ?? {}), windows: await windows().catch(() => []) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

async function pageEval(expression) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === "page" && t.url.includes("/scroll-fixture"));
  assert.ok(target, "scroll fixture should have a CDP target");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
    return await new Promise((r, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP fixture timeout")), 3000);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id !== 1) return;
        clearTimeout(timer);
        if (m.error || m.result?.exceptionDetails) reject(new Error(JSON.stringify(m)));
        else r(m.result?.result?.value);
      };
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  } finally { ws.close(); }
}

async function cleanup() {
  if (!pid || !alive(pid)) return;
  spawnSync("kill", ["-TERM", pid]);
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
  if (alive(pid)) spawnSync("kill", ["-KILL", pid]);
}
// A hard deadline so a hung harness never leaves the instance running.
const hardStop = setTimeout(async () => {
  console.error("replay deadline reached; stopping own instance");
  evidence.error = "deadline";
  writeFileSync(resultsPath, JSON.stringify(evidence, null, 2));
  await cleanup();
  process.exit(1);
}, Number(opt("deadline-s", "540")) * 1000);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await cleanup(); process.exit(130); });

try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
  seedSession();
  const binary = `${app}/Contents/MacOS/Netnyahoo`;
  const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const before = new Set(pids());
  const listener = () => spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  assert.equal(listener().length, 0, "the isolated debugging port must be free");
  execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, "--env", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows", app, ...bundleArgs]);
  for (let i = 0; i < 60 && !pid; i++) {
    await sleep(500);
    const candidate = listener()[0];
    if (!candidate) continue;
    assert.ok(!before.has(candidate) && pids().includes(candidate), "the port listener must belong to the newly launched isolated app");
    pid = candidate;
  }
  assert.ok(pid, "the isolated debugging port should start");
  evidence.pid = pid;
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = await nn('return !!globalThis.nnSwipe?.sidebar("w1") && !!globalThis.nnSwipe?.received;', 1500); } catch {}
    if (!ready) await sleep(500);
  }
  assert.ok(ready, "profile swipe dev harness should load; Metro must be running");
  // Freeze this instance's JS while other engineers edit the shared Metro checkout.
  // Call the client locally; do not change the app's persisted developer settings.
  evidence.liveUpdatesDisabled = await nn(`
    const entry=[...globalThis.__r.getModules()].find(([,m])=>m.verboseName?.endsWith("/Libraries/Utilities/HMRClient.js"));
    if (!entry) throw new Error("HMR client missing");
    globalThis.__r(entry[0]).default.disable();
    return true;
  `);

  await nn("nn.store.getState().updateSettings({ sidebarWidth: 190 }); return true;");
  await sleep(1000);
  evidence.setup = {
    sidebarWidth: await nn("return nn.store.getState().settings.sidebarWidth;"),
    profiles: profileIds,
    windows: await windows(),
    systemSwipe: (await replay([]))?.result?.where,
  };
  evidence.snapshotBefore = join(data, "before.png");
  await nn(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(evidence.snapshotBefore)});`).catch(() => {});
  const readyPath = join(data, "ready.json");
  writeFileSync(readyPath, JSON.stringify({ pid, data, windows: await windows() }, null, 2));
  console.log(`READY ${readyPath}`);
  if (args.includes("--wait-for-capture")) {
    const gate = join(data, "start-replay");
    console.log(`Waiting for ${gate}`);
    const deadline = Date.now() + 60000;
    while (!existsSync(gate) && Date.now() < deadline && alive(pid)) await sleep(100);
    assert.ok(existsSync(gate) && alive(pid), "capture gate must open within 60s while the app is alive");
  }

  // Each captured gesture from a resting profile where its direction has a neighbour.
  const independent = [];
  for (const g of sequenceOnly || skip.has("independent") ? [] : gestures) {
    await test(`gesture ${g.id} ${g.direction} dx${g.dx} dy${g.dy} v${g.releaseVelocity}`, async () => {
      const from = g.direction === "forward" ? profileIds[0] : profileIds[1];
      const to = g.direction === "forward" ? profileIds[1] : profileIds[0];
      await rest(from);
      const started = Date.now();
      const { window, result, received } = await replay(stepsOf(g));
      const seen = await waitProfile(to, started + endMs(g) + 1800);
      const summary = summarize(result, received);
      independent.push({ id: g.id, ok: seen === to, reject: summary.gestures[0]?.reject, emitted: summary.gestures[0]?.emitted.map((e) => e.phase).join(",") });
      const out = { gesture: g.id, from, expected: to, profile: seen, window, summary, result };
      if (seen !== to) throw fail(`profile ${seen}, expected ${to} within 1.8s of release; ${JSON.stringify(summary.gestures.map((s) => ({ reject: s.reject, waits: s.waits, emitted: s.emitted.length })))}`, out);
      return out;
    });
  }
  evidence.independent = independent;

  if (!skip.has("reverse")) {
    await test("immediate reverse at the captured gap (gestures 4 → 5)", async () => {
      const [a, b] = [4, 5].map((id) => fixture.gestures.find((g) => g.id === id));
      await rest(profileIds[0]);
      const gap = (b.startT - a.startT) * 1000;
      const started = Date.now();
      const { result, received } = await replay([...stepsOf(a), ...stepsOf(b, gap)]);
      const seen = await waitProfile(profileIds[0], started + gap + endMs(b) + 1800);
      const out = { profile: seen, summary: summarize(result, received), result };
      assert.ok(result.acks?.some((event) => event.diag === "emit" && event.phase === "ended"), "the native tracker must deliver the reverse release");
      if (seen !== profileIds[0]) throw fail(`profile ${seen} after forward+reverse, expected ${profileIds[0]}`, out);
      return out;
    });
  }

  if (!skip.has("sequence")) {
    await test("full captured sequence with original timing", async () => {
      await rest(profileIds[0]);
      await nn(`globalThis.__nnSwitches = []; globalThis.__nnUnsub?.(); globalThis.__nnUnsub = nn.store.subscribe((s, p) => {
        const w = s.windows.w1, q = p.windows.w1;
        if (w && q && w.profileId !== q.profileId) globalThis.__nnSwitches.push({ at: performance.now(), profile: w.profileId });
      }); return true;`);
      const first = gestures[0].startT;
      const steps = gestures.flatMap((g) => stepsOf(g, (g.startT - first) * 1000));
      const started = Date.now();
      const { result, received } = await replay(steps);
      await sleep(Math.max(0, started + (gestures.at(-1).startT - first) * 1000 + endMs(gestures.at(-1)) + 1800 - Date.now()));
      const switches = await nn("globalThis.__nnUnsub?.(); return globalThis.__nnSwitches;");
      // Expected: a clamped walk through the profile order.
      let at = 0;
      const expectedSwitches = [];
      const expected = gestures.map((g) => {
        const next = Math.max(0, Math.min(profileIds.length - 1, at + (g.direction === "forward" ? 1 : -1)));
        if (next !== at) expectedSwitches.push(profileIds[next]);
        at = next;
        return profileIds[at];
      });
      const summary = summarize(result, received);
      const perGesture = summary.gestures.map((s, i) => ({ id: gestures[i]?.id, direction: gestures[i]?.direction, expected: expected[i],
        reject: s.reject, emitted: s.emitted.map((e) => e.phase).join(","), velocity: s.emitted.at(-1)?.velocity }));
      const final = await profile();
      const out = { switches, expectedSwitches, expectedFinal: expected.at(-1), final, perGesture, summary, result };
      const untracked = perGesture.filter((p) => !p.emitted.includes("ended"));
      if (untracked.length || final !== expected.at(-1))
        throw fail(`final ${final} (expected ${expected.at(-1)}); gestures without ended: ${untracked.map((p) => `${p.id}:${p.reject ?? "none"}`).join(" ") || "none"}`, out);
      if (JSON.stringify(switches.map((event) => event.profile)) !== JSON.stringify(expectedSwitches))
        throw fail(`persisted switches ${JSON.stringify(switches.map((event) => event.profile))}, expected ${JSON.stringify(expectedSwitches)}`, out);
      return out;
    });
  }

  if (!skip.has("vertical")) {
    await test("vertical sidebar scrolling stays native", async () => {
      await rest(profileIds[0]);
      const probe = [{ phase: "began", atMs: 0, dx: 0, dy: 0 }, { phase: "ended", atMs: 8, dx: 0, dy: 0 }];
      const clipY = (r) => r.result?.acks?.find((a) => a.diag === "begin")?.scrollers?.[0]?.clipBounds?.[1];
      const before = await replay(probe);
      const steps = [{ phase: "began", atMs: 0, dy: -3 }];
      for (let i = 1; i <= 12; i++) steps.push({ phase: "changed", atMs: i * 8, timestampMs: i * 8, dx: i % 3 === 0 ? 1 : 0, dy: -14 });
      steps.push({ phase: "ended", atMs: 104, timestampMs: 104 });
      const vertical = await replay(steps);
      await sleep(400);
      const after = await replay(probe);
      const out = { clipBefore: clipY(before), clipAfter: clipY(after), summary: summarize(vertical.result, vertical.received), result: vertical.result };
      if (await profile() !== profileIds[0]) throw fail("vertical scroll must not switch profiles", out);
      if (!vertical.result.events.every((e) => !e.swallowed)) throw fail("vertical events must reach the scroll view", out);
      if (out.clipBefore === undefined || out.clipAfter === undefined) throw fail("probe should report the sidebar scroll view", out);
      if (out.clipAfter === out.clipBefore) throw fail("sidebar should scroll vertically", out);
      return out;
    });
  }

  if (!skip.has("strip")) {
    await test("top tab strip swipe (when the layout shows it)", async () => {
      const present = await nn('return !!globalThis.nnSwipe.strip?.("w1");');
      if (!present) return { skipped: "no top tab strip in this layout" };
      await rest(profileIds[0]);
      const g = fixture.gestures.find((x) => x.id === 4);
      const started = Date.now();
      const result = await nn(`return globalThis.nnSwipe.strip("w1").devSimulate(${JSON.stringify(stepsOf(g))});`, 20000);
      const received = await nn("return globalThis.nnSwipe.received();");
      const fidelity = checkFidelity(stepsOf(g), result);
      if (fidelity.mismatches.length) throw fail("strip synthetic input differs from captured input", { fidelity, result, received });
      const seen = await waitProfile(profileIds[1], started + endMs(g) + 1800);
      const out = { profile: seen, summary: summarize(result, received), fidelity, result };
      if (seen !== profileIds[1]) throw fail(`strip swipe left profile ${seen}`, out);
      return out;
    });
  }

  if (!skip.has("page")) {
    await test("web page keeps horizontal scroll and history on a captured flick", async () => {
      await rest(profileIds[0]);
      const tabId = await nn('const s = nn.store.getState(); return s.windows.w1.activeTabIds[s.windows.w1.profileId];');
      const url = `${fixtureOrigin}/scroll-fixture`;
      await nn(`nn.store.getState().navigate(${JSON.stringify(tabId)}, ${JSON.stringify(url)}); return true;`);
      let loaded = false;
      for (let i = 0; i < 30 && !loaded; i++) {
        try { loaded = await pageEval('document.readyState === "complete"'); } catch {}
        if (!loaded) await sleep(100);
      }
      assert.ok(loaded, "local scroll fixture must load");
      const pane = await nn(`return !!globalThis.nnSwipe.pane?.(${JSON.stringify(tabId)});`);
      if (!pane) return { skipped: "no page swipe area" };
      await pageEval("window.scrollTo(400,400); true");
      await sleep(100);
      const before = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
      const g = fixture.gestures.find((x) => x.id === 8);
      const result = await nn(`return globalThis.nnSwipe.pane(${JSON.stringify(tabId)}).devSimulate(${JSON.stringify(stepsOf(g))});`, 20000);
      const fidelity = checkFidelity(stepsOf(g), result);
      if (fidelity.mismatches.length) throw fail("page synthetic input differs from captured input", { fidelity, result });
      await sleep(400);
      const after = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
      const out = { before, after, summary: summarize(result, []), fidelity, result };
      assert.ok(after.x > before.x, "horizontal page scroll must still move web content");
      assert.equal(after.url, before.url, "horizontal scrolling must not navigate history");
      assert.equal(await profile(), profileIds[0]);
      return out;
    });
  }

  evidence.snapshotAfter = join(data, "after.png");
  await nn(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(evidence.snapshotAfter)});`).catch(() => {});
} catch (error) {
  evidence.error = String(error);
  console.error(error);
} finally {
  clearTimeout(hardStop);
  writeFileSync(resultsPath, JSON.stringify(evidence, null, 2));
  await cleanup();
  server.close();
  console.log(`Results: ${resultsPath}`);
  if (evidence.independent) console.log(evidence.independent.map((g) => `${g.id}:${g.ok ? "ok" : `FAIL(${g.reject ?? "no reject"}; ${g.emitted || "no emits"})`}`).join(" "));
  if (keep) console.log(`Data kept: ${data}`);
  else rmSync(data, { recursive: true, force: true });
}
process.exitCode = evidence.error || evidence.cases.some((c) => !c.passed) ? 1 : 0;

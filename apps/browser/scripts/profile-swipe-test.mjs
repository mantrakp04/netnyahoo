import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-swipe-test.mjs <Debug Netnyahoo.app> [--port=9474] [--keep-data] [--stale-window]");
  process.exit(2);
}
const app = resolve(appArg);
assert.notEqual(app, "/Applications/Netnyahoo.app", "use an isolated Debug build");
const port = args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "9474";
const keep = args.includes("--keep-data");
const stale = args.includes("--stale-window");
const data = mkdtempSync(join(tmpdir(), "nn-profile-swipe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = { app, data, stale, cases: [] };
let pid;
let evalId = 0;
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end('<!doctype html><title>Swipe scroll fixture</title><body style="margin:0"><div style="width:2600px;height:4000px;background:linear-gradient(120deg,#ffd9dd,#addbff)">Native scroll fixture</div>');
});

const tab = (id, profileId) => ({ id, windowId: "w1", profileId, url: "netnyahoo://newtab", title: "New Tab", favicon: null,
  pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, openerId: null,
  createdAt: 1, lastActiveAt: 1 });
writeFileSync(join(data, "session.json"), JSON.stringify({ version: 2,
  profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
    work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 } },
  profileOrder: ["default", "work"],
  windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ["t1", "t2"],
    activeTabIds: { default: "t1", work: "t2" }, sidebarOpen: true, frame: [80, 80, 1280, 800], createdAt: 1 }],
  windowOrder: ["w1"], focusedWindowId: "w1", tabs: [tab("t1", "default"), tab("t2", "work")],
  groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
}));

async function nn(body, timeout = 15000) {
  const id = `swipe-${Date.now()}-${++evalId}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  for (let start = Date.now(); Date.now() - start < timeout; await sleep(50)) {
    let out;
    try { out = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8")); } catch { continue; }
    if (out.id !== id) continue;
    if (out.error) throw new Error(out.error);
    return out.result;
  }
  throw new Error(`dev harness timeout: ${body}`);
}
const profile = () => nn('return nn.store.getState().windows.w1.profileId;');
async function waitProfile(expected) {
  for (let start = Date.now(); Date.now() - start < 1800;) {
    if (await profile() === expected) return;
    await sleep(25);
  }
  assert.equal(await profile(), expected, "profile should switch within 1.8s");
}
async function reset() {
  await nn('nn.store.getState().switchProfile("w1", "default"); return true;');
  await waitProfile("default");
  await sleep(250);
}
const windows = () => nn('return globalThis.expo.modules.NetnyahooCEF.chromeWindows();');
async function nativeWindow() {
  const all = await windows();
  return all.find((w) => w.hasRoot && w.profile === "" && w.group) ?? all.find((w) => w.hasRoot);
}
const action = (window, act) => nn(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${window}, ${JSON.stringify(act)});`);
const gesture = (sign, wobble = false, drift = false) => [
  { phase: "began", dx: wobble ? sign : 0, dy: wobble ? 5 : 0 },
  { phase: "changed", dx: 18 * sign, dy: 1 },
  ...(drift ? [{ phase: "changed", dx: 0, dy: 50 }] : []),
  { phase: "changed", dx: 22 * sign, dy: 0 },
  { phase: "changed", dx: 22 * sign, dy: 0 },
  { phase: "ended", dx: 0, dy: 0 },
];
const simulate = (steps, source) => nn(source
  ? `return globalThis.expo.modules.NetnyahooSwipe.devSimulate(120, 400, ${source}, ${JSON.stringify(steps)}, true);`
  : `return globalThis.nnSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});`);
async function test(name, fn) {
  try {
    const result = await fn();
    evidence.cases.push({ name, passed: true, result });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.cases.push({ name, passed: false, error: String(error), windows: await windows().catch(() => []) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

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

try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const binary = `${app}/Contents/MacOS/Netnyahoo`;
  const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const before = new Set(pids());
  execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, "--env", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows", app]);
  for (let i = 0; i < 60 && !pid; i++) { await sleep(500); pid = pids().find((p) => !before.has(p)); }
  assert.ok(pid, "isolated app should start");
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = await nn('return !!globalThis.nnSwipe?.sidebar("w1");', 1500); } catch {}
    if (!ready) await sleep(500);
  }
  assert.ok(ready, "profile swipe dev harness should load; Metro must be running");
  await sleep(1000);

  await test("rapid forward/reverse profile swipes", async () => {
    await reset();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(await simulate(gesture(i % 2 ? 1 : -1)));
      await waitProfile(i % 2 ? "default" : "work");
    }
    return results;
  });
  await test("small vertical start wobble keeps horizontal intent", async () => {
    await reset();
    const result = await simulate(gesture(-1, true));
    await waitProfile("work");
    return result;
  });
  await test("vertical drift after horizontal lock keeps profile swipe", async () => {
    await reset();
    const result = await simulate(gesture(-1, false, true));
    await waitProfile("work");
    return result;
  });
  await test("vertical sidebar scrolling stays native", async () => {
    await reset();
    const result = await simulate([{ phase: "began", dy: 5 }, { phase: "changed", dy: 16 },
      { phase: "changed", dy: 20 }, { phase: "ended" }]);
    assert.equal(await profile(), "default");
    assert.ok(result.events.every((e) => !e.swallowed), "vertical events must reach the scroll view");
    return result;
  });
  await test("cancelled swipe and momentum do not switch profiles", async () => {
    await reset();
    const steps = gesture(-1);
    steps[steps.length - 1].phase = "cancelled";
    steps.push({ phase: "momentumBegan", dx: -25 }, { phase: "momentum", dx: -30 }, { phase: "momentumEnded" });
    const result = await simulate(steps);
    await sleep(350);
    assert.equal(await profile(), "default");
    const next = await simulate(gesture(-1));
    await waitProfile("work");
    return { result, next };
  });
  await test("new gesture recovers after a missing end", async () => {
    await reset();
    const incomplete = await simulate(gesture(-1).slice(0, -1));
    const next = await simulate(gesture(-1));
    await waitProfile("work");
    return { incomplete, next };
  });

  if (stale) {
    await test("stale ordinary window cannot redirect into an overlapping logical window", async () => {
      await reset();
      const sourceInfo = await nativeWindow();
      const source = sourceInfo.window;
      const first = await simulate(gesture(-1), source);
      await waitProfile("work");
      const otherId = await nn('return nn.store.getState().createWindow({profileId:"default", frame:[80,80,1280,800]});');
      try {
        await sleep(500);
        const all = await windows();
        const other = all.find((w) => w.hasRoot && w.profile === "" && w.group !== sourceInfo.group);
        assert.ok(other, "second logical window should exist");
        assert.equal(await action(other.window, "ns:front"), "visible=1", "overlapping logical window should be ordered front");
        const reverse = await simulate(gesture(1), source);
        await waitProfile("default");
        assert.equal(await nn(`return nn.store.getState().windows[${JSON.stringify(otherId)}].profileId;`), "default");
        return { source, first, reverse, other: other.window };
      } finally {
        await nn(`nn.store.getState().closeWindow(${JSON.stringify(otherId)}); return true;`);
      }
    });
    await test("visible full-screen host accepts an immediate reverse through its moved root", async () => {
      await reset();
      const source = (await nativeWindow()).window;
      await action(source, "fakeFullScreen:1");
      try {
        const first = await simulate(gesture(-1), source);
        await waitProfile("work");
        const during = (await windows()).find((w) => w.window === source);
        assert.equal(during.visible, true, "old full-screen host must remain visible for this regression");
        const reverse = await simulate(gesture(1), source);
        await waitProfile("default");
        return { source, during, first, reverse };
      } finally {
        await action(source, "fakeFullScreen:0");
      }
    });
  }
  await test("stale source window reverses even when the retargeted event copy fails", async () => {
    await reset();
    const source = (await nativeWindow()).window;
    const first = await simulate(gesture(-1), source);
    await waitProfile("work");
    const failingCopy = (extra) => gesture(1).map((s) => ({ ...s, retargetCopyFailure: true, ...extra }));
    const legacy = await simulate(failingCopy({ legacyRecognition: true }), source);
    assert.notEqual(legacy.where.targetWindow, legacy.where.sourceWindow, "the source window must be stale after the switch");
    await sleep(600);
    const legacyProfile = await profile();
    const legacyBegin = legacy.acks.find((a) => a.diag === "begin");
    evidence.baselineExpectedFailure = {
      profile: legacyProfile,
      beginWindow: legacyBegin?.window,
      target: legacyBegin?.target,
      targetMisses: legacyBegin?.targets?.map((t) => t.miss),
      reject: legacy.acks.find((a) => a.diag === "reject")?.reason,
    };
    assert.equal(legacyProfile, "work", "legacy clone-first recognition should miss the reverse when the copy fails");
    const reverse = await simulate(failingCopy({}), source);
    await waitProfile("default");
    const begin = reverse.acks.find((a) => a.diag === "begin");
    assert.equal(begin?.window, reverse.where.targetWindow, "recognition should run in the shown profile's window");
    return { source, first, legacy, reverse };
  });
  await test("web page horizontal and vertical scrolling retain renderer ownership", async () => {
    await reset();
    const url = `http://127.0.0.1:${server.address().port}/scroll-fixture`;
    await nn(`nn.store.getState().navigate("t1", ${JSON.stringify(url)}); return true;`);
    let loaded = false;
    for (let i = 0; i < 30 && !loaded; i++) {
      try { loaded = await pageEval('document.readyState === "complete"'); } catch {}
      if (!loaded) await sleep(100);
    }
    assert.ok(loaded, "local scroll fixture must load");
    await pageEval("window.scrollTo(400,400); true");
    await sleep(100);
    const before = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    const horizontal = await nn(`return globalThis.nnSwipe.pane("t1").devSimulate(${JSON.stringify(gesture(-1))}, {ignorePreference:true});`);
    await sleep(250);
    const afterHorizontal = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    assert.ok(afterHorizontal.x > before.x, "horizontal page scroll must still move web content");
    assert.equal(afterHorizontal.url, before.url, "horizontal scrolling must not navigate history");
    const vertical = await nn('return globalThis.nnSwipe.pane("t1").devSimulate([{phase:"began"},{phase:"changed",dy:-18},{phase:"changed",dy:-24},{phase:"ended"}], {ignorePreference:true});');
    await sleep(250);
    const afterVertical = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    assert.ok(afterVertical.y > afterHorizontal.y, "vertical page scroll must still move web content");
    assert.equal(await profile(), "default");
    return { before, afterHorizontal, afterVertical, horizontal, vertical };
  });
  evidence.snapshot = { path: join(data, "profile-swipe.png"),
    saved: await nn(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(join(data, "profile-swipe.png"))});`) };
} catch (error) {
  evidence.error = String(error);
  console.error(error);
} finally {
  writeFileSync(join(data, "profile-swipe-results.json"), JSON.stringify(evidence, null, 2));
  if (pid) {
    spawnSync("kill", ["-TERM", pid]);
    let alive = true;
    for (let i = 0; i < 30 && alive; i++) {
      await sleep(100);
      try { process.kill(Number(pid), 0); } catch { alive = false; }
    }
    if (alive) spawnSync("kill", ["-KILL", pid]);
  }
  server.close();
  if (keep) console.log(`Evidence: ${join(data, "profile-swipe-results.json")}`);
  else rmSync(data, { recursive: true, force: true });
}
process.exitCode = evidence.error || evidence.cases.some((c) => !c.passed) ? 1 : 0;

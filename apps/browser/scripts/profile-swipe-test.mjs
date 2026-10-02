import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Ownership of the launched app: parallel runs share one Debug binary, so the owned PID is the
// single new process of that binary listening on this run's CDP port, and only it is ever killed.
function parsePort(value) {
  const n = Number(value);
  if (!/^\d+$/.test(value) || n < 1 || n > 65535) throw new Error(`--port must be an integer 1..65535, got ${value}`);
  return n;
}
const pidList = (text) => [...new Set(text.split(/\s+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
const commandIsBinary = (command, binary) => command === binary || command.startsWith(`${binary} `);
function listenerPids(port) {
  const r = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8", timeout: 5000 });
  if (r.error || r.status > 1) throw new Error(`lsof failed for port ${port}: ${r.error ?? r.stderr}`);
  return pidList(r.stdout);
}
// `ps -o lstart= -o command=` line: a 5-token start time, then the full command.
function parseProcessLine(line) {
  const m = /^\s*(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*\S)\s*$/.exec(line);
  return m ? { started: m[1], command: m[2] } : null;
}
function processInfo(pid) {
  const r = spawnSync("ps", ["-ww", "-p", String(pid), "-o", "lstart=", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? parseProcessLine(r.stdout) : null;
}
function binaryPids(binary) {
  const r = spawnSync("ps", ["-ww", "-ax", "-o", "pid=", "-o", "command="], { encoding: "utf8", timeout: 5000 });
  if (r.status !== 0) throw new Error(`ps failed: ${r.stderr}`);
  return new Set(r.stdout.split("\n").map((l) => /^\s*(\d+)\s+(.*)$/.exec(l))
    .filter((m) => m && commandIsBinary(m[2], binary)).map((m) => Number(m[1])));
}
// null while nothing listens yet; throws when the port holder cannot be this run's app.
function ownedCandidate(listeners, before, commandOf, binary) {
  if (!listeners.length) return null;
  if (listeners.length !== 1) throw new Error(`port has ${listeners.length} listeners: ${listeners.join(", ")}`);
  const [pid] = listeners;
  const command = commandOf(pid) ?? "";
  if (before.has(pid)) throw new Error(`port listener ${pid} predates the launch`);
  if (!commandIsBinary(command, binary)) throw new Error(`port listener ${pid} is not ${binary}: ${command}`);
  return pid;
}
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  const bin = "/tmp/Netnyahoo.app/Contents/MacOS/Netnyahoo";
  const cmd = (map) => (pid) => map[pid];
  assert.equal(parsePort("9474"), 9474);
  for (const bad of ["0", "65536", "94.5", "-1", "", "9474x", "1e3"]) assert.throws(() => parsePort(bad), /1\.\.65535/, bad);
  assert.deepEqual(pidList("12\n34\n12\n"), [12, 34]);
  assert.deepEqual(pidList(""), []);
  assert.ok(commandIsBinary(bin, bin));
  assert.ok(commandIsBinary(`${bin} --flag`, bin));
  assert.ok(!commandIsBinary(`${bin}2`, bin));
  assert.ok(!commandIsBinary(`/tmp/Netnyahoo.app/Contents/Frameworks/Netnyahoo Helper.app/Contents/MacOS/Netnyahoo Helper`, bin));
  assert.deepEqual(parseProcessLine(`Wed Sep 30 18:44:18 2026     ${bin} --x\n`), { started: "Wed Sep 30 18:44:18 2026", command: `${bin} --x` });
  assert.equal(parseProcessLine(""), null);
  assert.equal(ownedCandidate([], new Set(), cmd({}), bin), null);
  assert.equal(ownedCandidate([7], new Set([5]), cmd({ 7: bin }), bin), 7);
  // The failure this guards: another run's instance of the same binary must never become ours.
  assert.throws(() => ownedCandidate([5], new Set([5]), cmd({ 5: bin }), bin), /predates/);
  assert.throws(() => ownedCandidate([7], new Set(), cmd({ 7: "/usr/bin/python3 -m http.server" }), bin), /is not/);
  assert.throws(() => ownedCandidate([7], new Set(), cmd({}), bin), /is not/);
  assert.throws(() => ownedCandidate([7, 8], new Set(), cmd({ 7: bin, 8: bin }), bin), /2 listeners/);
  assert.ok(isAlive(process.pid));
  console.log("PASS self-test");
  process.exit(0);
}
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-swipe-test.mjs <Debug Netnyahoo.app> [--port=9474] [--keep-data] [--stale-window] [--only=<case name substring>] | --self-test");
  process.exit(2);
}
const app = resolve(appArg);
const bundlePort = args.find((a) => a.startsWith("--bundle-port="))?.split("=")[1];
if (bundlePort) assert.match(bundlePort, /^\d{2,5}$/);
// The app's Metro for this launch (AppDelegate): arguments after --args would reach Chrome's command line.
const bundleArgs = bundlePort ? ["--env", `NETNYAHOO_JS_LOCATION=127.0.0.1:${bundlePort}`] : [];
assert.notEqual(app, "/Applications/Netnyahoo.app", "use an isolated Debug build");
let port;
try { port = parsePort(args.find((a) => a.startsWith("--port="))?.slice("--port=".length) ?? "9474"); } catch (error) {
  console.error(error.message);
  process.exit(2);
}
const keep = args.includes("--keep-data");
const stale = args.includes("--stale-window");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).toLowerCase();
let matched = 0;
const data = mkdtempSync(join(tmpdir(), "nn-profile-swipe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const binary = `${app}/Contents/MacOS/Netnyahoo`;
const evidence = { app, data, stale, cases: [] };
// { pid, port, binary, command, started } once verified; the only process cleanup may signal.
let owned;
let evalId = 0;
// An Error when the owned app has died (recorded once in evidence.death), else null.
function ownedDeath() {
  if (!owned || isAlive(owned.pid)) return null;
  evidence.death ??= { pid: owned.pid, detectedAt: new Date().toISOString(), alive: false,
    portListeners: (() => { try { return listenerPids(port); } catch (e) { return String(e); } })() };
  return Object.assign(new Error(`owned app pid ${owned.pid} died`), { appDied: true });
}
function assertOwnedAlive() {
  const death = ownedDeath();
  if (death) throw death;
}
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url.startsWith("/history")) return res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`);
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
    assertOwnedAlive();
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
// Hardware-like 16ms event timestamps, whenever the main thread gets to each step.
].map((step, index) => ({ ...step, atMs: index * 16, timestampMs: index * 16 }));
// Decoded NSEvent timestamps against the requested ones, and the native release velocity.
function fixtureFidelity(steps, result) {
  const start = Number(result?.startNs) / 1e9;
  const events = (result?.events ?? []).filter((e) => !e.error);
  const decodedMs = events.map((e) => (e.time - start) * 1000);
  const intendedMs = steps.map((s) => s.timestampMs);
  const ended = (result?.acks ?? []).find((a) => a.diag === "emit" && a.phase === "ended");
  const errors = [];
  if (events.length !== steps.length) errors.push(`events ${events.length}, steps ${steps.length}`);
  intendedMs.forEach((ms, i) => {
    if (!(Math.abs((decodedMs[i] ?? NaN) - ms) <= 0.1)) errors.push(`step ${i} timestamp ${decodedMs[i]}ms, requested ${ms}ms`);
  });
  if (!ended) errors.push("no ended emit");
  else if (!(Math.abs(ended.velocity) >= 5)) errors.push(`ended velocity ${ended.velocity}`);
  return { intendedMs, decodedMs, endedVelocity: ended?.velocity ?? null,
    maxLateMs: Math.max(0, ...events.map((e) => e.lateMs ?? 0)), errors };
}
const simulate = (steps, source) => nn(source
  ? `return globalThis.expo.modules.NetnyahooSwipe.devSimulate(120, 400, ${source}, ${JSON.stringify(steps)}, true);`
  : `return globalThis.nnSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});`);
function alternatingGestures(count, gapMs = 112) {
  return Array.from({ length: count }, (_, n) => gesture(n % 2 ? 1 : -1).map((step) => ({
    ...step, atMs: step.atMs + n * gapMs, timestampMs: step.timestampMs + n * gapMs,
  }))).flat();
}
async function nativeBatch(steps, blockedMs = 0) {
  return nn(`
    const simulation=globalThis.nnSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});
    if (${blockedMs}) setTimeout(()=>{
      const until=performance.now()+${blockedMs}; while(performance.now()<until){}
    },20);
    return simulation.then(result=>new Promise(resolve=>setTimeout(()=>{
      globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1").then(state=>resolve({result,state,
        profile:nn.store.getState().windows.w1.profileId,pager:globalThis.nnPager("w1").debug()}));
    },650)));
  `, 15000);
}
async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only)) return;
  matched++;
  try {
    const result = await fn();
    evidence.cases.push({ name, passed: true, result });
    console.log(`PASS ${name}`);
  } catch (error) {
    const death = error.appDied ? error : ownedDeath();
    const failed = { name, passed: false, error: String(error), ...(error.evidence ? { evidence: error.evidence } : {}) };
    evidence.cases.push(failed);
    if (!death) failed.windows = await windows().catch((e) => ({ error: String(e) }));
    console.error(`FAIL ${name}: ${error.message}`);
    // A dead app fails this case with its traces kept, then stops the run.
    const fatal = death ?? ownedDeath();
    if (fatal) {
      failed.appDeath = evidence.death;
      throw fatal;
    }
  }
}

// Same start time and binary means the same process; a reused PID gets a new start time.
function stillOwned() {
  const info = processInfo(owned.pid);
  return info?.started === owned.started && commandIsBinary(info.command, owned.binary) ? info : null;
}
async function stopOwned() {
  if (!stillOwned()) return { signal: null, reason: "owned process already gone or pid reused" };
  if (!listenerPids(owned.port).includes(owned.pid)) return { signal: null, reason: `pid ${owned.pid} no longer listens on ${owned.port}` };
  process.kill(owned.pid, "SIGTERM");
  for (const start = Date.now(); Date.now() - start < 3000; await sleep(100)) {
    if (!stillOwned()) return { signal: "SIGTERM", exited: true };
  }
  // The CDP listener may already be closed mid-shutdown, so start time and command decide here.
  if (!stillOwned()) return { signal: "SIGTERM", exited: true };
  process.kill(owned.pid, "SIGKILL");
  return { signal: "SIGKILL", exited: null };
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
  const occupied = listenerPids(port);
  if (occupied.length) throw new Error(`CDP port ${port} is already in use by pid ${occupied.join(", ")}; pick a free --port`);
  const before = binaryPids(binary);
  evidence.launch = { port, binary, preexistingBinaryPids: [...before] };
  execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, "--env", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows", ...bundleArgs, app]);
  for (const start = Date.now(); !owned && Date.now() - start < 30000; await sleep(250)) {
    let info;
    const pid = ownedCandidate(listenerPids(port), before, (p) => {
      info = processInfo(p);
      return info?.command;
    }, binary);
    if (info) owned = { pid, port, binary, ...info };
  }
  evidence.owner = owned ?? null;
  assert.ok(owned, `isolated app should listen on CDP port ${port} within 30s`);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = await nn('return !!globalThis.nnSwipe?.sidebar("w1");', 1500); } catch (error) { if (error.appDied) throw error; }
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

  await sleep(1000);

  await test("rapid forward/reverse profile swipes", async () => {
    await reset();
    const results = [];
    const fidelity = [];
    for (let i = 0; i < 6; i++) {
      const expected = i % 2 ? "default" : "work";
      try {
        const steps = gesture(i % 2 ? 1 : -1);
        const result = await simulate(steps);
        results.push(result);
        fidelity.push(fixtureFidelity(steps, result));
        if (fidelity.at(-1).errors.length) throw new Error(`fixture fidelity: ${fidelity.at(-1).errors.join("; ")}`);
        await waitProfile(expected);
      } catch (error) {
        // Keep every completed native trace and the state at the failure; a dead app yields null, not a new error.
        error.evidence = { iteration: i, expected, results, fidelity,
          profile: await profile().catch(() => null),
          pager: await nn('return globalThis.nnPager("w1").debug();').catch(() => null) };
        throw error;
      }
    }
    return { results, fidelity };
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
  await test("a new native drag interrupts the current settle synchronously", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(2));
    assert.equal(result.profile, "default");
    assert.equal(result.state.selected, 0);
    assert.equal(result.state.phase, "idle");
    assert.ok(result.pager.ack >= result.state.selectionSequence, "latest selection must be acknowledged");
    return result;
  });
  await test("twelve native reversals keep the latest profile and stable coordinates", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(12));
    assert.equal(result.profile, "default");
    assert.equal(result.state.selected, 0);
    assert.ok(Math.abs(result.state.position) < 0.003);
    assert.equal(result.state.phase, "idle");
    return result;
  });
  await test("queued selection events cannot rewind a native reversal while JS is blocked", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(3), 700);
    assert.equal(result.profile, "work");
    assert.equal(result.state.selected, 1);
    assert.equal(result.state.phase, "idle");
    assert.ok(result.pager.ack >= result.state.selectionSequence, "latest selection must be acknowledged");
    return result;
  });
  await test("rapid profile shortcuts count every queued press", async () => {
    await reset();
    await nn('nn.runCommand({command:"nextProfile",windowId:"w1"}); nn.runCommand({command:"nextProfile",windowId:"w1"}); nn.runCommand({command:"nextProfile",windowId:"w1"}); return true;');
    await waitProfile("work");
    await sleep(450);
    const result = await nn('return globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1");');
    assert.equal(result.profileId, "work");
    assert.equal(result.selected, 1);
    assert.equal(result.phase, "idle");
    return result;
  });
  await test("external profile selection interrupts a native drag without a late rewind", async () => {
    await reset();
    const steps=gesture(-1).map((s)=>({...s, atMs:s.atMs*3, timestampMs:s.timestampMs*3}));
    const result = await nn(`
      const simulation=globalThis.nnSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)},{ignorePreference:true});
      setTimeout(()=>nn.store.getState().switchProfile("w1","work"),40);
      setTimeout(()=>nn.store.getState().switchProfile("w1","default"),56);
      return simulation.then(native=>new Promise(resolve=>setTimeout(()=>{
        globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1").then(state=>resolve({native,state,
          profile:nn.store.getState().windows.w1.profileId}));
      },650)));
    `);
    assert.equal(result.profile,"default");
    assert.equal(result.state.profileId,"default");
    assert.equal(result.state.phase,"idle");
    return result;
  });
  await test("latest profile dot cancels an in-flight native selection", async () => {
    await reset();
    await simulate(gesture(-1));
    await nn('const p=globalThis.nnPager("w1"); p.switchTo("default"); p.switchTo("work"); return true;');
    await waitProfile("work");
    await sleep(650);
    const result = await nn('return globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1");');
    assert.equal(result.selected, 1);
    assert.equal(result.phase, "idle");
    assert.ok(Math.abs(result.position - 1) < 0.003);
    return result;
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
    const fixtureState = await nn(`
      nn.store.getState().activate("t1");
      nn.store.getState().navigate("t1", ${JSON.stringify(url)});
      const w = nn.store.getState().windows.w1;
      return { profileId: w.profileId, activeTabId: w.activeTabIds.default };
    `);
    try {
      assert.equal(fixtureState.profileId, "default", "the fixture's profile must be active");
      assert.equal(fixtureState.activeTabId, "t1", "the fixture tab must own the visible pane");
    } catch (error) { error.evidence = { fixtureState }; throw error; }
    let loaded = false;
    for (let i = 0; i < 30 && !loaded; i++) {
      try { loaded = await pageEval('document.readyState === "complete"'); } catch { assertOwnedAlive(); }
      if (!loaded) await sleep(100);
    }
    assert.ok(loaded, "local scroll fixture must load");
    await pageEval("window.scrollTo(400,400); true");
    await sleep(100);
    const before = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    // A loaded CDP target may still be an inactive tab. Keep UI/root state if its gesture area is absent.
    const webState = await nn(`return {
      window: nn.store.getState().windows.w1,
      pager: globalThis.nnPager("w1").debug(),
      pane: !!globalThis.nnSwipe.pane("t1")
    };`);
    if (!webState.pane) {
      const error = new Error("loaded web fixture has no visible t1 swipe pane");
      error.evidence = { fixtureState, webState, windows: await windows(), before };
      throw error;
    }
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
  // Needs the web page test's renderer: t1 shows the local scroll fixture.
  const routing = (result) => result.acks.find((a) => a.diag === "hitRouting");
  const flagged = (steps, flags) => steps.map((s) => ({ ...s, ...flags }));
  await test("a renderer hit outside its own frame falls back to the sidebar pager", async () => {
    await reset();
    assert.ok(await pageEval("!!document.body"), "the web fixture renderer must exist");
    const legacy = await simulate(flagged(gesture(-1), { wrongRendererHit: true, legacyHitRouting: true }));
    await sleep(600);
    const legacyProfile = await profile();
    const legacyBegin = legacy.acks.find((a) => a.diag === "begin");
    evidence.baselineRendererHit = { profile: legacyProfile, raw: routing(legacy)?.raw?.[0]?.class,
      misses: legacyBegin?.targets?.map((t) => t.miss), reject: legacy.acks.find((a) => a.diag === "reject")?.reason };
    assert.equal(routing(legacy)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa", "injection should hit the real renderer");
    assert.equal(legacyProfile, "default", "legacy hit routing should reject the misrouted renderer hit");
    const fixed = await simulate(flagged(gesture(-1), { wrongRendererHit: true }));
    await waitProfile("work");
    assert.equal(routing(fixed)?.fallback, true, "the pager should take the gesture through the fallback");
    const begin = fixed.acks.find((a) => a.diag === "begin");
    assert.ok(begin.hit.every((h) => h.class !== "RenderWidgetHostViewCocoa"), "the effective hit must not be the renderer");
    return { legacy, fixed };
  });
  await test("a real web hit inside the renderer keeps page ownership", async () => {
    await reset();
    const source = (await nativeWindow()).window;
    const result = await nn(`return globalThis.expo.modules.NetnyahooSwipe.devSimulate(700, 400, ${source}, ${JSON.stringify(gesture(-1))}, true);`);
    await sleep(600);
    assert.equal(routing(result)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa", "the point should hit the page renderer");
    assert.equal(routing(result)?.fallback, false, "a hit inside the renderer must not fall back");
    assert.equal(await profile(), "default", "a web-page swipe must not switch profiles");
    return result;
  });
  await test("a native sidebar hit does not use the renderer fallback", async () => {
    await reset();
    const result = await simulate(gesture(-1));
    await waitProfile("work");
    assert.notEqual(routing(result)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa");
    assert.equal(routing(result)?.fallback, false, "an ordinary sidebar hit should match directly");
    return result;
  });
  // SwipeOverlay: a discrete swipe's delayed dismiss once landed in the next gesture and dropped its navigation.
  await test("a tracked swipe right after a discrete swipe goes back too", async () => {
    await reset();
    const base = `http://127.0.0.1:${server.address().port}/history`;
    const url = () => nn('return nn.store.getState().tabs.t1.url;');
    async function waitUrl(expected, ms) {
      for (let start = Date.now(); Date.now() - start < ms && (await url()) !== expected;) await sleep(50);
      return url();
    }
    await nn('nn.store.getState().activate("t1"); return true;');
    for (const n of [1, 2, 3]) {
      await nn(`nn.store.getState().navigate("t1", ${JSON.stringify(base + n)}); return true;`);
      assert.equal(await waitUrl(base + n, 5000), base + n);
    }
    await sleep(500);
    // The tracked one starts 50 ms after the discrete one and lasts a quarter second, as a hand's does.
    const steps = [{ phase: "swipe", dx: 3, atMs: 0 }, { phase: "began", dx: 0, dy: 0, atMs: 50, timestampMs: 50 }];
    for (let at = 66; at <= 258; at += 16) steps.push({ phase: "changed", dx: 10, dy: 0, atMs: at, timestampMs: at });
    steps.push({ phase: "ended", dx: 0, dy: 0, atMs: 274, timestampMs: 274 });
    const result = await nn(`return globalThis.nnSwipe.pane("t1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});`);
    assert.equal(await waitUrl(base + 1, 3000), base + 1, "both swipes should go back");
    return { events: result.events?.map((e) => [e.phase, e.swallowed ?? e.state]) };
  });
  await test("reordering profiles preserves a native selection queued behind blocked JS", async () => {
    await reset();
    try {
      const result = await nn(`
        const simulation=globalThis.nnSwipe.sidebar("w1").devSimulate(${JSON.stringify(gesture(-1))}, {ignorePreference:true});
        setTimeout(()=>{
          const until=performance.now()+180; while(performance.now()<until){}
          nn.store.getState().reorderProfiles(["work","default"]);
        },20);
        return simulation.then(native=>new Promise(resolve=>setTimeout(()=>{
          globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1").then(state=>resolve({native,state,
            profile:nn.store.getState().windows.w1.profileId,order:nn.store.getState().profileOrder}));
        },650)));
      `);
      assert.equal(result.profile, "work");
      assert.equal(result.state.profileId, "work");
      assert.equal(result.state.selected, 0);
      assert.ok(Math.abs(result.state.position) < 0.003);
      return result;
    } finally {
      await nn('nn.store.getState().reorderProfiles(["default","work"]); return true;');
    }
  });
  await test("removing the other profile keeps the remaining sidebar at its origin", async () => {
    await nn('nn.store.getState().switchProfile("w1","work"); return true;');
    await waitProfile("work");
    await sleep(350);
    await nn('nn.store.getState().deleteProfile("default"); return true;');
    await sleep(350);
    const result = await nn('return globalThis.expo.modules.NetnyahooSwipe.devPagerState("w1");');
    assert.equal(await profile(), "work");
    assert.equal(result.count, 1);
    assert.equal(result.selected, 0);
    assert.ok(Math.abs(result.position) < 0.003);
    assert.equal(result.phase, "idle");
    assert.ok(result.areas >= 1);
    return result;
  });
  evidence.snapshot = { path: join(data, "profile-swipe.png"),
    saved: await nn(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(join(data, "profile-swipe.png"))});`) };
} catch (error) {
  evidence.error = String(error);
  console.error(error);
} finally {
  if (only && !matched && !evidence.error) {
    evidence.error = `--only=${only} matched no test`;
    console.error(`FAIL ${evidence.error}`);
  }
  if (owned) {
    try { evidence.cleanup = await stopOwned(); } catch (error) { evidence.cleanup = { error: String(error) }; }
  }
  writeFileSync(join(data, "profile-swipe-results.json"), JSON.stringify(evidence, null, 2));
  server.close();
  if (keep || evidence.error || evidence.cases.some((c) => !c.passed)) console.log(`Evidence: ${join(data, "profile-swipe-results.json")}`);
  else rmSync(data, { recursive: true, force: true });
}
process.exitCode = evidence.error || evidence.cases.some((c) => !c.passed) ? 1 : 0;

// Profile swipes in the sidebar and swipes on web pages, through the native gesture path (NetnyahooSwipe devSimulate)
// in a hidden instance with two profiles.
//   node apps/browser/scripts/profile-swipe-test.mjs <Debug Netnyahoo.app> [--port=<DevTools port>] [--keep-data]
//     [--stale-window] [--only=<case name substring>] [--bundle-port=<Metro port>]
// One line per case; the details go to profile-swipe.log and the evidence (native traces) to
// profile-swipe-results.json beside the instance's data; both are kept with --keep-data or after a failure.
// The launched app's ownership (scripts/lib/instance.mjs) has its own self-test: `--self-test` runs it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, listenerPids, parsePort, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  const module = fileURLToPath(new URL("../../../scripts/lib/instance.mjs", import.meta.url));
  process.exit(spawnSync(process.execPath, [module, "--self-test"], { stdio: "inherit" }).status ?? 1);
}
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-swipe-test.mjs <Debug Netnyahoo.app> [--port=<DevTools port>] [--keep-data] [--stale-window] [--only=<case name substring>] [--bundle-port=<Metro port>] | --self-test");
  process.exit(2);
}
const app = resolve(appArg);
const bundlePort = args.find((a) => a.startsWith("--bundle-port="))?.split("=")[1];
if (bundlePort) assert.match(bundlePort, /^\d{2,5}$/);
const portArg = args.find((a) => a.startsWith("--port="))?.slice("--port=".length);
let port;
try { port = portArg && parsePort(portArg); } catch (error) {
  console.error(`--port: ${error.message}`);
  process.exit(2);
}
const keep = args.includes("--keep-data");
const stale = args.includes("--stale-window");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).toLowerCase();
let matched = 0;
const scratch = mkdtempSync(join(tmpdir(), "nn-profile-swipe-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "profile-swipe.log"), { name: "profile-swipe-test" });
const evidence = { app, data, stale, cases: [] };
// The instance once launched: the only process cleanup may signal (scripts/lib/instance.mjs).
let owned;
// An Error when the owned app has died (recorded once in evidence.death), else null.
function ownedDeath() {
  if (!owned || !owned.exited) return null;
  evidence.death ??= { pid: owned.pid, detectedAt: new Date().toISOString(), alive: false,
    portListeners: (() => { try { return listenerPids(owned.port); } catch (e) { return String(e); } })() };
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

const tab = (id, profileId) => ({ id, profileId, url: "netnyahoo://newtab", title: "New Tab" });
const fixture = session({ profiles: ["Personal", "Work"], tabs: [tab("t1", "default"), tab("t2", "work")] });

const nn = (body, timeout = 15000) => owned.eval(body, { timeout });
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
  let fatal = null;
  await rep.check(name, async () => {
    const result = await fn();
    evidence.cases.push({ name, passed: true, result });
  }, {
    async onFail(error) {
      const death = error.appDied ? error : ownedDeath();
      const failed = { name, passed: false, error: String(error), ...(error.evidence ? { evidence: error.evidence } : {}) };
      evidence.cases.push(failed);
      if (!death) failed.windows = await windows().catch((e) => ({ error: String(e) }));
      if (error.evidence) rep.log("evidence:", JSON.stringify(error.evidence));
      // A dead app fails this case with its traces kept, then stops the run.
      fatal = death ?? ownedDeath();
      if (fatal) failed.appDeath = evidence.death;
    },
  });
  if (fatal) throw Object.assign(fatal, { reported: true });
}

async function pageEval(expression) {
  const page = await owned.page("/scroll-fixture", { timeout: 0 }).catch(() => null);
  assert.ok(page, "scroll fixture should have a CDP target");
  try {
    return await page.eval(expression, { timeout: 3000 });
  } finally { page.close(); }
}

let stage = "launch";
try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  owned = await launch(app, {
    data, port, session: fixture,
    switches: "--disable-backgrounding-occluded-windows",
    // The app's Metro for this launch: pinned (the module's proxy, which refuses reloads and hot updates) unless
    // --bundle-port names another one.
    ...(bundlePort ? { js: `127.0.0.1:${bundlePort}` } : {}),
    ready: 'return !!globalThis.nnSwipe?.sidebar("w1");',
  });
  evidence.owner = { pid: owned.pid, port: owned.port, binary: owned.binary, started: owned.started, js: owned.js };
  // For the log only (rep.log's lines would show under every later failure).
  appendFileSync(rep.logFile, `instance pid ${owned.pid}, DevTools port ${owned.port}, data ${data}\n`);
  if (bundlePort) {
    // Freeze this instance's JS while other engineers edit that Metro's checkout (a pinned instance can't get
    // updates). Call the client locally; do not change the app's persisted developer settings.
    evidence.liveUpdatesDisabled = await nn(`
      const entry=[...globalThis.__r.getModules()].find(([,m])=>m.verboseName?.endsWith("/Libraries/Utilities/HMRClient.js"));
      if (!entry) throw new Error("HMR client missing");
      globalThis.__r(entry[0]).default.disable();
      return true;
    `);
  }
  stage = "the cases";

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
    // NNCore keeps one NSWindow per logical window across profile switches (chromeWindows reports its active
    // profile and no group), so the source window stays current: the reverse must be recognized there, not in
    // the logical window ordered in front of it at the same point.
    await test("stale ordinary window cannot redirect into an overlapping logical window", async () => {
      await reset();
      const source = (await nativeWindow()).window;
      const first = await simulate(gesture(-1), source);
      await waitProfile("work");
      const otherId = await nn('return nn.store.getState().createWindow({profileId:"default", frame:[80,80,1280,800]});');
      try {
        await sleep(500);
        const all = await windows();
        assert.equal(all.find((w) => w.window === source)?.profile, "work", "the source window should show the swiped-to profile");
        const other = all.find((w) => w.hasRoot && w.window !== source);
        assert.ok(other, "second logical window should exist");
        assert.equal(other.profile, "", "the second logical window should show the default profile");
        assert.equal(await action(other.window, "ns:front"), "visible=1", "overlapping logical window should be ordered front");
        const reverse = await simulate(gesture(1), source);
        assert.equal(reverse.acks.find((a) => a.diag === "begin")?.window, source, "recognition should run in the source window");
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
  stage = "the snapshot";
  evidence.snapshot = { path: join(data, "profile-swipe.png"),
    saved: await nn(`return nn.shell.devSnapshotWindow("w1", ${JSON.stringify(join(data, "profile-swipe.png"))});`) };
} catch (error) {
  evidence.error = String(error);
  if (!error.reported) rep.record(`stopped at ${stage}`, { error });
} finally {
  if (only && !matched && !evidence.error) {
    evidence.error = `--only=${only} matched no test`;
    rep.record(`--only=${only}`, { error: "matched no test" });
  }
  if (owned) {
    try { evidence.cleanup = await owned.quit(); } catch (error) { evidence.cleanup = { error: String(error) }; }
  }
  writeFileSync(join(scratch, "profile-swipe-results.json"), JSON.stringify(evidence, null, 2));
  server.close();
  const failed = evidence.error || evidence.cases.some((c) => !c.passed);
  if (!keep && !failed) {
    rmSync(data, { recursive: true, force: true });
    rmSync(join(scratch, "profile-swipe-results.json"), { force: true });
  } else appendFileSync(rep.logFile, `evidence: ${join(scratch, "profile-swipe-results.json")}\n`);
  process.exitCode = rep.summary() && !failed ? 0 : 1;
}

// Captures the production pager settling while JS is blocked. Verify motion from the window's pixels;
// pager.debug().pos is the last write/snapshot, not a per-frame native animation value.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-motion-stall-test.mjs <Debug Netnyahoo.app> [--port=9474] [--keep-data] [--wait-for-capture]");
  process.exit(2);
}
const app = resolve(appArg);
assert.notEqual(app, "/Applications/Netnyahoo.app", "use an isolated Debug build");
const port = args.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "9474";
const keep = args.includes("--keep-data");
const data = mkdtempSync(join(tmpdir(), "nn-profile-swipe-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = { app, data, cases: [] };
let pid;
let evalId = 0;

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
    if (pid) {
      try { process.kill(Number(pid), 0); } catch { throw new Error("isolated app exited"); }
    }
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
async function test(name, fn) {
  try {
    const result = await fn();
    evidence.cases.push({ name, passed: true, result });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.cases.push({ name, passed: false, error: String(error), ...(error.evidence ? { evidence: error.evidence } : {}),
      windows: await windows().catch(() => []) });
    console.error(`FAIL ${name}: ${error.message}`);
  }
}


try {
  const binary = `${app}/Contents/MacOS/Netnyahoo`;
  const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const before = new Set(pids());
  const listener = () => spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  assert.equal(listener().length, 0, "the isolated debugging port must be free");
  execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, "--env", "NETNYAHOO_CHROMIUM_SWITCHES=--disable-backgrounding-occluded-windows", app]);
  for (let i = 0; i < 60 && !pid; i++) {
    await sleep(500);
    const candidate = listener()[0];
    if (!candidate) continue;
    assert.ok(!before.has(candidate) && pids().includes(candidate), "the port listener must belong to the newly launched isolated app");
    pid = candidate;
  }
  assert.ok(pid, "the isolated debugging port should start");
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    try { ready = await nn('return !!globalThis.nnSwipe?.sidebar("w1");', 1500); } catch {}
    if (!ready) await sleep(500);
  }
  assert.ok(ready, "profile swipe dev harness should load; Metro must be running");
  // Cold ad-block rule indexing uses the Chromium UI thread; measure steady-state paging.
  await sleep(10000);
  evidence.fixture = await nn(`
    const s=nn.store.getState();
    s.closeTabs(s.windows.w1.tabIds.filter(id=>id!=="t1" && id!=="t2"));
    s.activate("t1");
    return {window:nn.store.getState().windows.w1,tabs:Object.keys(nn.store.getState().tabs)};
  `);
  assert.deepEqual(evidence.fixture.tabs.sort(), ["t1", "t2"], "capture only the seeded neutral tabs");

  const readyPath = join(data, "ready.json");
  writeFileSync(readyPath, JSON.stringify({pid:Number(pid),data}));
  console.log(`READY ${readyPath}`);
  if(args.includes("--wait-for-capture")) {
    let gate=false;
    for(let start=Date.now();Date.now()-start<25000;) {
      try { readFileSync(join(data,"start-replay"));gate=true;break; }catch{}
      await sleep(50);
    }
    assert.ok(gate,"capture gate deadline");
  }
  await test("profile settle under a 300ms JS stall", async () => {
    await reset();
    const result = await nn(`
      const p = globalThis.nnPager("w1");
      const trace=[];

      const run = (sign) => new Promise(resolve => {
        p.beginDrag();
        const e={phase:"changed",direction:sign<0?"forward":"back",distance:70,dy:0,velocity:1000,available:true,width:190};
        p.track(e); p.release({...e,phase:"ended"},false);
        trace.push({kind:"release",at:performance.now(),wallAt:Date.now(),sign,state:p.debug()});
        setTimeout(()=>{
          trace.push({kind:"stallStart",at:performance.now(),wallAt:Date.now(),state:p.debug()});
          const until=performance.now()+300; while(performance.now()<until){}
          trace.push({kind:"stallEnd",at:performance.now(),wallAt:Date.now(),state:p.debug()});
        },80);
        setTimeout(()=>{
          trace.push({kind:"landed",at:performance.now(),wallAt:Date.now(),state:p.debug(),profile:nn.store.getState().windows.w1.profileId});
          resolve();
        },1300);
      });
      return run(-1).then(()=>run(1)).then(()=>run(-1)).then(()=>({trace,ended:performance.now()}));
    `);
    const landed = result.trace.filter((t) => t.kind === "landed");
    assert.deepEqual(landed.map((t) => t.profile), ["work", "default", "work"], "each blocked release must finish on its expected profile");
    assert.ok(landed.every((t) => t.state.target === null && !t.state.dragging && !t.state.animating && !t.state.pending), "no gesture or settle remains active");
    return result;
  });
  await sleep(1500);
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
  if (keep) console.log(`Evidence: ${join(data, "profile-swipe-results.json")}`);
  else rmSync(data, { recursive: true, force: true });
}
process.exitCode = evidence.error || evidence.cases.some((c) => !c.passed) ? 1 : 0;

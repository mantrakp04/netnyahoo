// Hovering moves or resizes nothing but a HoverSlot's contents, in the sidebar, the tab strip and the downloads popover.
// Launches a hidden instance with a fixture (tabs, an open and a collapsed group, a live folder with an open item, a
// finished download) and runs the dev harness's check (src/lib/hoverShift.ts) on each surface.
//   node apps/browser/scripts/hover-shift-test.mjs <Debug Netnyahoo.app> [cdpPort]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [appArg, port = "9475"] = process.argv.slice(2);
const app = appArg && resolve(appArg);
if (!app) {
  console.error("usage: node hover-shift-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "nn-hover-shift-"));
const file = join(data, "report.pdf");
writeFileSync(file, "%PDF-1.4\n");

const tab = (id, pinned = false) => ({
  id, windowId: "w1", profileId: "default", url: `https://example.com/?${id}`, title: `Tab ${id} with a title long enough to fade`, favicon: null,
  pinned, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: pinned ? `https://example.com/?${id}` : null, openerId: null,
  createdAt: 1, lastActiveAt: 1,
});
const ids = ["pin1", "pin2", "a1", "a2", "a3", "b1", "b2", ...Array.from({ length: 12 }, (_, i) => `t${i}`)];
writeFileSync(join(data, "session.json"), JSON.stringify({
  version: 2,
  profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 }, work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 } },
  profileOrder: ["default", "work"],
  windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ids, activeTabIds: { default: "t2" }, sidebarOpen: true, frame: [80, 80, 1280, 800], createdAt: 1 }],
  windowOrder: ["w1"], focusedWindowId: "w1",
  tabs: ids.map((id) => tab(id, id.startsWith("pin"))),
  groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
}));

const binary = `${app}/Contents/MacOS/Netnyahoo`;
const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const before = new Set(pids());
execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`, "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, app]);
let pid;
for (let i = 0; i < 60 && !pid; i++) {
  await sleep(500);
  pid = pids().find((p) => !before.has(p));
}
const finish = (code) => {
  if (pid) spawnSync("kill", ["-KILL", pid]);
  rmSync(data, { recursive: true, force: true });
  process.exit(code);
};
if (!pid) {
  console.error("the app didn't start");
  finish(1);
}
process.on("uncaughtException", (e) => (console.error(e), finish(1)));
process.on("unhandledRejection", (e) => (console.error(e), finish(1)));

let evalId = 0;
async function nn(body, timeout = 120000) {
  const id = `h${Date.now()}-${++evalId}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(100)) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      throw new Error("the app died");
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
    if ((await nn("return !!nn.hoverShift", 3000)) === true) break;
  } catch {}
  if (i > 60) {
    console.error("the dev harness never answered (is Metro running on :8081?)");
    finish(1);
  }
}

// The fixture: groups, a live folder with an open item (its row shows ✕ on hover) and a finished download.
await nn(`
  const s = nn.store.getState();
  s.createGroup(["a1", "a2", "a3"], { name: "Open group" });
  const shut = s.createGroup(["b1", "b2"], { name: "Shut group", color: "blue" });
  s.updateGroup(shut, { collapsed: true });
  const { store, engine } = nn.live;
  const folder = store.createFolder("default", "pullRequests");
  const pr = (n, extra) => ({ number: n, repo: "netnyahoo/app", author: "a", authorAvatar: null, draft: false, headRef: "h" + n, baseRef: "main",
    review: null, mergeable: "mergeable", checks: [], comments: 0, unresolvedThreads: 0, additions: 1, deletions: 1, changedFiles: 1, ...extra });
  const item = (n, extra) => ({ id: "pr" + n, source: "github", url: "https://example.com/pr/" + n, title: "Pull request " + n + " with a long title",
    subtitle: "", icon: null, updatedAt: Date.now() - n, section: "authored", pr: pr(n, extra) });
  const items = [item(1, { review: "approved" }), item(2, {}), item(3, { mergeable: "conflicting" })];
  store.applyFetch(folder, items, {});
  store.setStatus(folder, { state: "idle", lastFetch: Date.now(), error: null });
  engine.openLiveItem("w1", folder, items[1], { background: true });
  engine.openLiveItem("w1", folder, items[2], { background: true });
  nn.store.setState((st) => ({ downloads: [{ id: "d1", url: "https://example.com/report.pdf", filename: "report.pdf", path: ${JSON.stringify(file)},
    state: "finished", paused: false, received: 9, total: 9, speed: 0, mimeType: "application/pdf" }, ...st.downloads] }));
  return true;
`);
await sleep(1500);

const surfaces = [
  ["sidebar", `nn.store.getState().updateSettings({ tabLayout: "sidebar" });`, ["Sidebar"]],
  ["tab strip", `nn.store.getState().updateSettings({ tabLayout: "top" });`, ["TopTabStrip"]],
  ["downloads", `nn.store.getState().updateSettings({ tabLayout: "sidebar" }); nn.store.getState().setDownloadsOpen("w1", true);`, ["DownloadsPopover"]],
];
let failed = 0;
for (const [name, setup, scopes] of surfaces) {
  await nn(`${setup} return true;`);
  await sleep(1200);
  const { hovered, shifts } = await nn(`return nn.hoverShift.check({ scopes: ${JSON.stringify(scopes)} });`);
  if (!hovered) {
    console.log(`FAIL ${name}: nothing hover-tracked found`);
    failed++;
    continue;
  }
  if (!shifts.length) {
    console.log(`PASS ${name}: ${hovered} hovered views, nothing moved`);
    continue;
  }
  failed++;
  console.log(`FAIL ${name}: ${shifts.length} views moved or resized (${hovered} hovered)`);
  for (const s of shifts.slice(0, 20)) console.log(`  hovering ${s.hovered}\n    ${s.view}: ${s.before.join(", ")} -> ${s.after.join(", ")}`);
}
finish(failed ? 1 : 0);

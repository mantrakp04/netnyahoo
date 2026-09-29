// ⌘-scroll zooms with a wheel mouse or a Magic Mouse and scrolls with a trackpad.
// CDP's Input.dispatchMouseEvent reaches the renderer directly, past the app's event monitor that
// makes this decision, so the scrolls go through AppKit's dispatch instead (NNZoom devScroll),
// each claiming the device it comes from.
// usage: node zoom-scroll-test.mjs <Debug Netnyahoo.app> [cdpPort]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [appArg, port = "9474"] = process.argv.slice(2);
const app = appArg && resolve(appArg);
if (!app) {
  console.error("usage: node zoom-scroll-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "nn-zoom-scroll-"));

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>tall</title><body style="font:20px system-ui;height:6000px"><h1>tall</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

writeFileSync(join(data, "session.json"), JSON.stringify({
  version: 2,
  profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
  profileOrder: ["default"],
  windows: [{ id: "w1", profileId: "default", incognito: false, tabIds: ["t1"], activeTabIds: { default: "t1" }, sidebarOpen: true,
              frame: [80, 80, 1280, 800], createdAt: 1 }],
  windowOrder: ["w1"], focusedWindowId: "w1",
  tabs: [{ id: "t1", windowId: "w1", profileId: "default", url, title: "tall", favicon: null, pinned: false, muted: false, zoom: 1,
           customTitle: null, customIcon: null, pinnedUrl: null, openerId: null, createdAt: 1, lastActiveAt: 1 }],
  groups: [], splits: [], closedTabs: [], closedWindows: [], closedGroups: [], cleanedTabs: [],
}));

const binary = `${app}/Contents/MacOS/Netnyahoo`;
const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const before = new Set(pids());
execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
  "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, app]);
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
process.on("unhandledRejection", (error) => {
  console.error(error);
  finish(1);
});

let evalId = 0;
async function nn(body, timeout = 60000) {
  let id;
  for (let start = Date.now(), sent = 0; Date.now() - start < timeout; await sleep(100)) {
    if (Date.now() - sent > 5000) {
      id = `z${Date.now()}-${++evalId}`;
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
    if ((await nn("return !!globalThis.expo.modules.NetnyahooCEF.devScrollZoom", 2000)) === true) break;
  } catch {}
  if (i > 60) {
    console.error("the dev harness never answered, or this build has no devScrollZoom");
    finish(1);
  }
}
for (let i = 0; i < 60 && !(await nn(`return nn.store.getState().tabs.t1?.title === "tall";`)); i++) await sleep(500);
await sleep(1500);

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });
const zoom = () => nn(`return nn.store.getState().tabs.t1.zoom;`);
const reset = async () => {
  await nn(`return nn.webviews.get("t1")?.zoomStep(0);`);
  for (let i = 0; i < 20 && (await zoom()) !== 1; i++) await sleep(200);
};
const scroll = (steps) => nn(`return globalThis.expo.modules.NetnyahooCEF.devScrollZoom(${JSON.stringify(steps)});`);
const gesture = (trackpad) => [
  { phase: "mayBegin", dy: 0, trackpad },
  { phase: "began", dy: 12, trackpad },
  ...Array.from({ length: 4 }, () => ({ phase: "changed", dy: 40, trackpad })),
  { phase: "ended", dy: 0, trackpad },
  ...Array.from({ length: 3 }, () => ({ phase: "momentum", dy: 30 })),
];

async function scrollCase(name, steps, expectZoom) {
  await reset();
  const zoomed = await scroll(steps);
  await sleep(800);
  const after = await zoom();
  const scrolled = zoomed.every((z) => !z);
  check(name, expectZoom ? zoomed.some(Boolean) && after > 1 : scrolled && after === 1, `zoomed per event ${JSON.stringify(zoomed)}, zoom ${after}`);
}

await scrollCase("⌘ + two-finger trackpad scroll scrolls (and its momentum too)", gesture(true), false);
await scrollCase("⌘ + Magic Mouse scroll zooms", gesture(false), true);
await scrollCase("⌘ + wheel-mouse notches zoom", [{ phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
await scrollCase("a trackpad scroll that ended doesn't stop the wheel from zooming",
  [...gesture(true), { phase: "wheel", dy: 1 }, { phase: "wheel", dy: 1 }], true);
await reset();

console.log("");
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
const failures = checks.filter((c) => !c.ok).length;
console.log(failures ? `\n${failures} failed` : "\nall passed");
finish(failures ? 1 : 0);

// Hidden-instance checks for history and closed tabs over Chrome's own services (architecture review, rec. 2):
// - a JS reload (Metro) keeps every tab's page: no second load, no second history visit;
// - helper pages (Alloy browsers: the content blocker's extension page, extension popups) aren't history;
// - ⇧⌘T gives a closed tab its own back/forward list, also next to another tab closed on the same page at the same
//   moment, and after a quit.
//   node apps/browser/scripts/chrome-data-test.mjs <Debug Netnyahoo.app> [cdpPort]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [appArg, port = "9481"] = process.argv.slice(2);
const app = appArg && resolve(appArg);
if (!app) {
  console.error("usage: node chrome-data-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = mkdtempSync(join(tmpdir(), "nn-chrome-data-"));

const hits = new Map();
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  hits.set(path, (hits.get(path) ?? 0) + 1);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${path}</title><h1>${path}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${server.address().port}`;

const binary = `${app}/Contents/MacOS/Netnyahoo`;
const pids = () => spawnSync("pgrep", ["-f", `^${binary}`], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
let pid;
async function launch() {
  const before = new Set(pids());
  execFileSync("open", ["-g", "-n", "--env", "NETNYAHOO_BACKGROUND=1", "--env", `NETNYAHOO_DATA_DIR=${data}`,
    "--env", `NETNYAHOO_REMOTE_DEBUGGING_PORT=${port}`, app]);
  pid = undefined;
  for (let i = 0; i < 60 && !pid; i++) {
    await sleep(500);
    pid = pids().find((p) => !before.has(p));
  }
  if (!pid) throw new Error("the app didn't start");
  await ready();
}
const alive = () => pid && spawnSync("kill", ["-0", pid]).status === 0;
const finish = (code) => {
  if (alive()) spawnSync("kill", ["-KILL", pid]);
  server.close();
  rmSync(data, { recursive: true, force: true });
  process.exit(code);
};
process.on("uncaughtException", (error) => {
  console.error(error);
  finish(1);
});

let seq = 0;
// A read: asked again under a new id if the JS reloaded meanwhile (Metro reloads every instance when any agent
// edits the tree, and a reloaded harness skips the script it finds waiting).
async function read(body) {
  for (let i = 0; ; i++) {
    try {
      return await nn(body, 8000);
    } catch (error) {
      if (i >= 4 || !String(error.message).startsWith("timed out")) throw error;
    }
  }
}
async function nn(body, timeout = 30_000) {
  const id = `c${Date.now()}-${++seq}`;
  writeFileSync(join(data, "dev-eval.js"), `// ${id}\n${body}`);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (!alive()) throw new Error("the app quit");
    try {
      const r = JSON.parse(readFileSync(join(data, "dev-eval-result.json"), "utf8"));
      if (r.id === id) {
        if (r.error) throw new Error(r.error);
        return r.result;
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error;
    }
    await sleep(150);
  }
  throw new Error(`timed out: ${body.slice(0, 80)}`);
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if (await nn("return Object.keys(nn.store.getState().windows).length > 0 && !!nn.store.getState().historyReady.default", 2000)) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("the app's JS didn't start");
}
const until = async (what, test, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
};

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `\n      ${detail}` : ""}`);
};

// Chrome's history as it is, not the app's view of it.
const chromeHistory = () =>
  read(`return globalThis.expo.modules.NetnyahooCEF.engineCall("nn_history_query", "", "{}").then((j) => JSON.parse(j).entries.map((e) => [e.u, e.v.length]));`);
const openTab = (url) => nn(`const s = nn.store.getState(); return s.newTab(s.windowOrder[0], { url: ${JSON.stringify(url)} });`);
const tabUrl = (id) => read(`return nn.store.getState().tabs[${JSON.stringify(id)}]?.url ?? null`);
const entries = (id) => read(`return nn.webviews.get(${JSON.stringify(id)}).navigationEntries().then((e) => e.map((x) => new URL(x.url).pathname.replace(/[/]$/, "")));`);
const navigate = async (id, url) => {
  await nn(`nn.store.getState().navigate(${JSON.stringify(id)}, ${JSON.stringify(url)}); return true;`);
  await until(`${url} in the tab`, async () => (await tabUrl(id)) === url);
};

await launch();

// MARK: A JS reload keeps the pages

const kept = await openTab(`${site}/kept`);
await until("the page's visit", async () => (await chromeHistory()).some(([u]) => u === `${site}/kept`));
// The session is saved a moment after a change; a reload before that wouldn't have the tab at all.
await sleep(2000);
await nn(`setTimeout(() => { try { globalThis.nativeModuleProxy.DevSettings.reload(); } catch {} }, 50); return true;`);
await sleep(1500);
await ready();
await sleep(2000);
check("a JS reload doesn't load the open page again", hits.get("/kept") === 1, `${hits.get("/kept")} loads`);
check("nor count it as another visit", (await chromeHistory()).find(([u]) => u === `${site}/kept`)?.[1] === 1, JSON.stringify(await chromeHistory()));
check("the tab keeps its page", (await tabUrl(kept)) === `${site}/kept`, String(await tabUrl(kept)));

// MARK: Helper pages aren't history

check("no extension or helper page is in Chrome's history", !(await chromeHistory()).some(([u]) => !/^https?:/.test(u)), JSON.stringify(await chromeHistory()));

// MARK: Closed tabs get their own back/forward lists

const a = await openTab(`${site}/a-start`);
await until("a-start", async () => (await tabUrl(a)) === `${site}/a-start`);
await navigate(a, `${site}/same`);
const b = await openTab(`${site}/b-start`);
await until("b-start", async () => (await tabUrl(b)) === `${site}/b-start`);
await navigate(b, `${site}/same`);
await sleep(1000);
// Both on the same page, closed a moment apart.
const closed = await nn(`
  const s = nn.store.getState();
  s.closeTab(${JSON.stringify(a)});
  s.closeTab(${JSON.stringify(b)});
  return nn.store.getState().closedTabs.filter((c) => c.tabId === ${JSON.stringify(a)} || c.tabId === ${JSON.stringify(b)}).map((c) => [c.tabId, c.id]);`);
const closedId = (tab) => closed.find(([t]) => t === tab)[1];
await sleep(1500);
const reopen = async (entryId) => {
  const id = await nn(`
    const s = nn.store.getState();
    const before = new Set(Object.keys(s.tabs));
    s.restoreClosed(${JSON.stringify(entryId)}, s.windowOrder[0]);
    const id = Object.keys(nn.store.getState().tabs).find((t) => !before.has(t));
    nn.store.getState().activate(id);
    return id;`);
  try {
    await until("the reopened tab's page", async () => (await read(`return !!nn.webviews.get(${JSON.stringify(id)})`)) && (await entries(id)).includes("/same"));
  } catch (error) {
    console.log("the reopened tab:", JSON.stringify(await entries(id).catch((e) => String(e))));
    throw error;
  }
  return id;
};
const ra = await reopen(closedId(a));
check("the first tab closed on a page gets its own back/forward list", JSON.stringify(await entries(ra)) === '["/a-start","/same"]', JSON.stringify(await entries(ra)));
await nn(`nn.store.getState().closeTab(${JSON.stringify(ra)}); return true;`);
await sleep(1500);

// After a quit: the other tab's entry, from Chrome's file.
const quitting = pid;
await nn(`return nn.shell.devKeyEquivalent(nn.store.getState().windowOrder[0], { key: "q", keyCode: 12, modifiers: ["command"], focus: "window", wait: 0 });`).catch(() => {});
await until("the quit", async () => spawnSync("kill", ["-0", quitting]).status !== 0, 30_000);
await launch();
const rb = await reopen(closedId(b));
check("after a quit, the second gets its own too", JSON.stringify(await entries(rb)) === '["/b-start","/same"]', JSON.stringify(await entries(rb)));

console.log(failed ? `${failed} failed` : "all passed");
finish(failed ? 1 : 0);

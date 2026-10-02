// Hidden-instance checks for history and closed tabs over Chrome's own services (architecture review, rec. 2):
// - a JS reload (Metro) keeps every tab's page: no second load, no second history visit;
// - helper pages (Alloy browsers: the content blocker's extension page, extension popups) aren't history;
// - ⇧⌘T gives a closed tab its own back/forward list, also next to another tab closed on the same page at the same
//   moment, and after a quit.
//   node apps/browser/scripts/chrome-data-test.mjs <Debug Netnyahoo.app> [cdpPort]
// One line per check; the details go to chrome-data-test.log beside the instance's data.
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, port] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: node chrome-data-test.mjs <Debug Netnyahoo.app> [cdpPort]");
  process.exit(2);
}
const appPath = resolve(appArg);
const scratch = mkdtempSync(join(tmpdir(), "nn-chrome-data-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "chrome-data-test.log"), { name: "chrome-data-test" });

const hits = new Map();
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  hits.set(path, (hits.get(path) ?? 0) + 1);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${path}</title><h1>${path}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${server.address().port}`;

// The JS (pinned: Metro through the instance's proxy, so only this script's own reload restarts it) is ready once a
// window and the default profile's history are.
const readyTest = "return Object.keys(nn.store.getState().windows).length > 0 && !!nn.store.getState().historyReady.default";
let app;
const start = () => launch(appPath, { data, port, ready: readyTest });
const nn = (body, timeout = 30_000) => app.eval(body, { timeout });
// A read: asked again under a new id if the JS reloaded meanwhile (a reloaded harness skips the script it finds
// waiting).
async function read(body) {
  for (let i = 0; ; i++) {
    try {
      return await nn(body, 8000);
    } catch (error) {
      if (i >= 4 || !String(error.message).startsWith("eval timed out")) throw error;
    }
  }
}
const until = async (what, test, timeout = 20_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
};

// The instance's pid and port, for the log only (rep.log's lines would show under every later failure).
const note = (line) => appendFileSync(rep.logFile, `${line}\n`);
let mark = Date.now();
const check = (name, ok, detail = "") => {
  rep.record(name, { ms: Date.now() - mark, error: ok ? null : detail || "failed", evidence: ok ? detail : undefined });
  mark = Date.now();
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

let stage = "launch";
try {
  app = await start();
  note(`instance pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  mark = Date.now();

  // MARK: A JS reload keeps the pages

  stage = "JS reload";
  const kept = await openTab(`${site}/kept`);
  await until("the page's visit", async () => (await chromeHistory()).some(([u]) => u === `${site}/kept`));
  // The session is saved a moment after a change; a reload before that wouldn't have the tab at all.
  await sleep(2000);
  await nn(`setTimeout(() => { try { globalThis.nativeModuleProxy.DevSettings.reload(); } catch {} }, 50); return true;`);
  await sleep(1500);
  await app.ready({ test: readyTest });
  await sleep(2000);
  check("a JS reload doesn't load the open page again", hits.get("/kept") === 1, `${hits.get("/kept")} loads`);
  check("nor count it as another visit", (await chromeHistory()).find(([u]) => u === `${site}/kept`)?.[1] === 1, JSON.stringify(await chromeHistory()));
  check("the tab keeps its page", (await tabUrl(kept)) === `${site}/kept`, String(await tabUrl(kept)));

  // MARK: Helper pages aren't history

  check("no extension or helper page is in Chrome's history", !(await chromeHistory()).some(([u]) => !/^https?:/.test(u)), JSON.stringify(await chromeHistory()));

  // MARK: Closed tabs get their own back/forward lists

  stage = "closed tabs";
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
      rep.log("the reopened tab:", JSON.stringify(await entries(id).catch((e) => String(e))));
      throw error;
    }
    return id;
  };
  const ra = await reopen(closedId(a));
  check("the first tab closed on a page gets its own back/forward list", JSON.stringify(await entries(ra)) === '["/a-start","/same"]', JSON.stringify(await entries(ra)));
  await nn(`nn.store.getState().closeTab(${JSON.stringify(ra)}); return true;`);
  await sleep(1500);

  // After a quit (⌘Q, as the owner quits): the other tab's entry, from Chrome's file.
  stage = "quit and relaunch";
  await nn(`return nn.shell.devKeyEquivalent(nn.store.getState().windowOrder[0], { key: "q", keyCode: 12, modifiers: ["command"], focus: "window", wait: 0 });`).catch(() => {});
  await until("the quit", async () => app.exited, 30_000);
  app = await start();
  note(`relaunched: pid ${app.pid}, DevTools port ${app.port}`);
  const rb = await reopen(closedId(b));
  check("after a quit, the second gets its own too", JSON.stringify(await entries(rb)) === '["/b-start","/same"]', JSON.stringify(await entries(rb)));
} catch (error) {
  rep.record(`stopped at ${stage}`, { ms: Date.now() - mark, error });
} finally {
  await app?.quit();
  server.close();
  rmSync(data, { recursive: true, force: true });
}
process.exit(rep.summary() ? 0 : 1);

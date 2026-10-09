#!/usr/bin/env node
// Extension popups in any build, Release exports included (their own JS bundle, no Metro): an unpacked fixture loaded
// with --load-extension, then
//   - chrome.action.openPopup() from its service worker, with no user gesture, as 1Password calls it once its Mac app
//     unlocks: "ok", and the popup's page opens over the active tab;
//   - the popup sizes itself from its page (Chrome's auto-resize), down as well as up;
//   - openPopup over the open popup opens it afresh (a new page).
//
//   node packages/arcadiacore/scripts/popup-check.mjs <Arcadia.app> [scratch dir]
//   JS=localhost:<metro port> for a Debug build (default: the build's own bundle, as a release runs)
//
// Hidden (scripts/lib/instance.mjs: ARCADIA_BACKGROUND=1, its own data dir and DevTools port). Exit 1 on a failure.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { devtools, launch, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, scratchArg] = process.argv.slice(2);
if (!appArg) {
  console.error("usage: popup-check.mjs <Arcadia.app> [scratch dir]");
  process.exit(64);
}
const scratch = resolve(scratchArg ?? join(process.env.TMPDIR ?? "/tmp", `ac-popup-check-${process.pid}`));
rmSync(scratch, { recursive: true, force: true });
const ext = join(scratch, "ext");
mkdirSync(ext, { recursive: true });
writeFileSync(join(ext, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "Popup check", version: "1.0",
  action: { default_title: "Popup check", default_popup: "popup.html" },
  background: { service_worker: "sw.js" },
}));
writeFileSync(join(ext, "sw.js"), "");
writeFileSync(join(ext, "popup.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;width:300px;height:200px;background:#2a6"></body>`);

const server = createServer((req, res) => res.end("<!doctype html><title>Popup check page</title><p>page</p>"));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/page`;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const until = async (what, fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
};

const app = await launch(appArg, {
  data: join(scratch, "data"), js: process.env.JS ?? "none", probe: true, onboarded: true,
  switches: [`--load-extension=${ext}`, "--disable-features=DisableLoadExtensionCommandLineSwitch"],
});
try {
  const browser = await app.browser();
  await browser.send("Target.createTarget", { url: pageUrl });
  const worker = await until("the fixture's service worker", async () => {
    const t = (await app.targets()).find((x) => x.type === "service_worker" && x.url.endsWith("/sw.js"));
    return t ? devtools(t) : null;
  });
  const extensionId = (await worker.send("Runtime.evaluate", { expression: "chrome.runtime.id", returnByValue: true })).result.value;
  await until("the page shown", async () => (await app.targets()).some((t) => t.type === "page" && t.url === pageUrl));
  await sleep(1000);
  const openPopup = async () => (await worker.send("Runtime.evaluate", {
    expression: "chrome.action.openPopup().then(() => 'ok', (e) => e.message)", awaitPromise: true, returnByValue: true,
  }, { timeout: 15000 })).result.value;
  const popupTarget = () => app.targets().then((ts) => ts.find((t) => t.type === "page" && t.url.startsWith(`chrome-extension://${extensionId}/popup.html`)));
  const evalIn = async (t, expression) => {
    const s = await devtools(t);
    try {
      return (await s.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    } finally {
      s.close();
    }
  };

  const started = Date.now();
  const first = await openPopup();
  check("chrome.action.openPopup() from the service worker, no user gesture", first === "ok", `${first}, ${Date.now() - started} ms`);
  const popup = await until("the popup page", popupTarget).catch(() => null);
  check("the popup's page opens", !!popup);
  if (popup) {
    const size = await until("the popup sized to its page", async () => {
      const s = await evalIn(popup, "[innerWidth, innerHeight]");
      return s[0] === 300 && s[1] === 200 ? s : null;
    }, 5000).catch(async () => evalIn(popup, "[innerWidth, innerHeight]"));
    check("the popup takes its page's size", size[0] === 300 && size[1] === 200, size.join("×"));
    await evalIn(popup, "document.body.style.height = '80px'; window.__old = 1");
    const shrunk = await until("the popup shrunk", async () => {
      const s = await evalIn(popup, "[innerWidth, innerHeight]");
      return s[1] === 80 ? s : null;
    }, 5000).catch(async () => evalIn(popup, "[innerWidth, innerHeight]"));
    check("the popup shrinks with its page", shrunk[1] === 80, shrunk.join("×"));
    const again = await openPopup();
    const fresh = await until("a fresh popup", async () => {
      const t = await popupTarget();
      return t && (await evalIn(t, "window.__old === undefined")) ? t : null;
    }, 8000).catch(() => null);
    check("openPopup over the open popup opens it afresh", again === "ok" && !!fresh, again);
  }
} catch (e) {
  check("ran to the end", false, e.message);
} finally {
  await app.quit().catch(() => app.kill());
  server.close();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);

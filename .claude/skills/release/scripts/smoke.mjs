// Smoke test of a release build over CDP; smoke.sh launches the app and calls it.
// usage: node smoke.mjs <cdpPort> <version> <windowsTool> <pid> <pagesOrigin>
// Each check prints PASS/FAIL; exits 1 if any failed. The right-click check runs last: a native
// context menu blocks the app's main thread until it closes, and smoke.sh kills the app after.
import { execFileSync } from "node:child_process";

const [port, version, windowsTool, pid, pages] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const windows = () =>
  execFileSync(windowsTool, [pid], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const browserInfo = await (await fetch(`http://localhost:${port}/json/version`)).json();
check("engine is Chromium 154", /Chrome\/154\./.test(browserInfo.Browser), browserInfo.Browser);

// The after-update tab (smoke.sh recorded an older version and launched with NETNYAHOO_RELEASE_NOTES=1).
let targets = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page");
const notes = targets.filter((t) => new RegExp(`/release-notes/?#${version.replace(/\./g, "\\.")}$`).test(t.url));
check("release notes opened once after the update", notes.length === 1, targets.map((t) => t.url).join(", "));
const page = notes[0] ?? targets.find((t) => t.url.startsWith("http"));
if (!page) {
  console.log("no web page to drive; stopping");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  else for (const l of listeners) l(m);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, (m) => resolve(m.result ?? {}));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
async function go(url, wait = 15000) {
  const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(wait)]);
  await sleep(800);
}
async function click(selector, button = "left") {
  const b = JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`));
  const at = { x: b.x + 20, y: b.y + b.height / 2, button, clickCount: 1 };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  if (button === "left") await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}
async function key(k) {
  const code = { ArrowDown: 40, Enter: 13 }[k];
  const base = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(k === "Enter" ? { text: "\r" } : {}) });
  if (k === "Enter") await send("Input.dispatchKeyEvent", { type: "char", ...base, text: "\r" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
await send("Page.enable");
await send("Runtime.enable");

await go("https://example.com/");
check("a web page loads", (await evaluate("document.title")) === "Example Domain");

const ad = await evaluate(
  `fetch("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",{mode:"no-cors"}).then(()=>"loaded",e=>"blocked")`,
);
const control = await evaluate(`fetch("https://www.iana.org/favicon.ico",{mode:"no-cors"}).then(()=>"loaded",e=>"failed")`);
check("uBlock blocks an ad script, lets other requests through", ad === "blocked" && control === "loaded", `${ad}/${control}`);

const media = JSON.parse(
  await evaluate(
    `JSON.stringify([MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'), MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'), !!document.createElement("canvas").getContext("webgl2")])`,
  ),
);
check("H.264, AAC and WebGL2", media.every(Boolean), JSON.stringify(media));

// The ghost Browser window (alpha 0, the app window's size) must stay behind the app window.
const ghostBehind = () => {
  const list = windows();
  const app = list.findIndex((w) => w.alpha > 0 && w.layer === 0 && w.w > 400);
  const ghost = list.findIndex((w) => w.alpha === 0 && list[app] && w.w === list[app].w && w.h === list[app].h);
  return app >= 0 && ghost > app;
};
check("Chrome's hidden window stays behind the app window", ghostBehind());

// Autofill: save an entry, then pick it from Chrome's dropdown with the keyboard (0.1.3's fix).
await go(`${pages}/form.html`);
await evaluate(`document.getElementById("c").value="Springfield"; document.getElementById("b").click(); 1`);
await sleep(2500);
await click("#c");
await sleep(1500);
await key("ArrowDown");
await sleep(300);
await key("Enter");
await sleep(800);
check("autofill dropdown accepts a suggestion", (await evaluate(`document.getElementById("c").value`)) === "Springfield");

// Passkey dialog comes in front of the app window, and goes when the page moves on.
await go(`${pages}/passkey.html`);
await click("#b");
await sleep(2500);
const dialog = windows().find((w) => /passkey/i.test(w.title));
check("passkey dialog shows in front", !!dialog && windows()[0]?.id === dialog.id, dialog?.title ?? "no passkey window");
await go(`${pages}/form.html`);
await sleep(1000);
check("hidden window drops back after the dialog", ghostBehind());

await go("chrome://version");
check("chrome://version", (await evaluate("document.body.innerText")).includes("154."));

await send("Network.enable");
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await go("https://example.org/");
check("offline page is Where's Big Yahu?", /No internet/.test(await evaluate("document.title")));
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await go(`${pages}/form.html`);

// Last: right-click shows a native menu (NSPopUpMenuWindowLevel, 101; autofill popups are 999).
await click("#c", "right");
await sleep(1500);
const menu = windows().find((w) => w.layer === 101);
check("right-click shows the context menu", !!menu, menu ? `layer ${menu.layer}` : "no menu window");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

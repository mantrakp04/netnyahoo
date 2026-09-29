// Smoke test of a release build over CDP; smoke.sh launches the app and calls it.
// usage: node smoke.mjs <cdpPort> <version> <windowsTool> <pid> <pagesOrigin>
// Each check prints PASS/FAIL; exits 1 if any failed. The right-click check runs last: builds that
// still draw the native context menu block their main thread until it closes. smoke.sh quits the app after.
// SMOKE_LOCKED=1 (smoke.sh: the screen is locked): the checks that read window order or wait for a
// window to go print SKIP, as a locked screen freezes window animations and CGWindowList's order.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [port, version, windowsTool, pid, pages] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const locked = process.env.SMOKE_LOCKED === "1";
/** A check that needs an unlocked screen. */
const checkUnlocked = (name, ok, detail = "") =>
  locked ? console.log(`SKIP  ${name}  (screen locked; ${ok ? "would pass" : "would fail"}${detail ? `: ${detail}` : ""})`) : check(name, ok, detail);
const windows = () =>
  execFileSync(windowsTool, [pid], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const browserInfo = await (await fetch(`http://localhost:${port}/json/version`)).json();
check("engine is Chromium 154", /Chrome\/154\./.test(browserInfo.Browser), browserInfo.Browser);

// The after-update tab (smoke.sh recorded an older version and launched with NETNYAHOO_RELEASE_NOTES=1).
let targets = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page");
const notes = targets.filter((t) => new RegExp(`/release-notes/?#${version.replace(/\./g, "\\.")}$`).test(t.url));
check("release notes opened once after the update", notes.length === 1, targets.map((t) => t.url).join(", "));
const page = notes[0] ?? targets.find((t) => t.url.startsWith("http") && !t.url.includes("/count.html"));
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

// The app window is Chrome's own Browser window of its profile: no hidden Chrome window of the app
// window's size (the old "ghost", alpha 0) anywhere, and one full-size window on screen although the
// window has two profiles, each with a Chrome window (smoke.sh's session: left on Work).
const appWindows = () => windows().filter((w) => w.layer === 0 && w.w > 400 && w.h > 300);
const [appWindow] = appWindows().filter((w) => w.alpha > 0);
const hidden = appWindows().filter((w) => w.alpha === 0);
check("no hidden full-size Chrome window (the app window is Chrome's own)", !!appWindow && hidden.length === 0,
  JSON.stringify(appWindows().map((w) => [w.w, w.h, w.alpha])));
check("a window left on its second profile reopens as that profile's window, alone on screen",
  appWindows().filter((w) => w.alpha > 0).length === 1, JSON.stringify(appWindows().map((w) => [w.title, w.alpha])));
// The page on screen (the after-update tab, opened in the window) is the Work profile's: the same
// browser context as the restored Work tab (its pinned tab), and visible.
const browserWs = new WebSocket(browserInfo.webSocketDebuggerUrl);
await new Promise((r) => (browserWs.onopen = r));
let browserId = 1;
const browserSend = (method) =>
  new Promise((r) => {
    const id = browserId++;
    browserWs.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === id) r(m.result ?? {}); };
    browserWs.send(JSON.stringify({ id, method }));
  });
const { targetInfos = [] } = await browserSend("Target.getTargets");
browserWs.close();
const workContext = targetInfos.find((t) => t.type === "page" && t.url.endsWith("?pin-a"))?.browserContextId;
const shownContext = targetInfos.find((t) => t.targetId === page.id)?.browserContextId;
const shownVisible = await evaluate("document.visibilityState");
check("…showing the Work profile's pages", !!workContext && shownContext === workContext && shownVisible === "visible",
  `work ${workContext}, shown ${shownContext} (${shownVisible})`);

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

// Passkey dialog: a child window of the visible app window (in front of it, over its page), and
// it goes when the page moves on.
await go(`${pages}/passkey.html`);
await click("#b");
await sleep(1500);
// Until the sheet has finished appearing (the window server scales it in), 6 s at most.
let list = windows();
for (let i = 0, last = ""; i < 12; i++) {
  const now = JSON.stringify(list.map((w) => [w.id, w.x, w.y, w.w, w.h]));
  if (now === last && list.some((w) => /passkey/i.test(w.title))) break;
  last = now;
  await sleep(500);
  list = windows();
}
const dialog = list.find((w) => /passkey/i.test(w.title));
check("passkey dialog shows", !!dialog, dialog?.title ?? "no passkey window");
if (dialog) {
  const owner = list.slice(list.indexOf(dialog) + 1).find((w) => w.layer === 0 && w.w > 400 && w.h > 300);
  const inside = owner && dialog.x >= owner.x && dialog.x + dialog.w <= owner.x + owner.w && dialog.y >= owner.y && dialog.y + dialog.h <= owner.y + owner.h;
  checkUnlocked("…in front, directly over the visible app window it belongs to", list[0]?.id === dialog.id && owner?.alpha > 0 && !!inside,
    `dialog @${dialog.x},${dialog.y} ${dialog.w}x${dialog.h}; window under it ${owner ? `@${owner.x},${owner.y} ${owner.w}x${owner.h} alpha ${owner.alpha}` : "none"}`);
}
await go(`${pages}/form.html`);
await sleep(1500);
checkUnlocked("…and closes when the page navigates", !windows().some((w) => /passkey/i.test(w.title)));

// "Allow ads on this site", then off again: each takes effect on the next load of the page. The check
// sends uBlock's own messages from one of its pages in the tab's profile, as NNContentBlocker does.
const ubolPage = "chrome-extension://bnjeokpoejhioagiokhkhmdogkhbnbki/manifest.json";
const adsOnPage = async () => (await go(`${pages}/ad.html`), await evaluate("window.ad"));
async function allowAds(allowed) {
  await go(ubolPage);
  return evaluate(`chrome.runtime.sendMessage({ what: "setFilteringMode", hostname: "localhost", level: ${allowed ? 0 : 2} })`);
}
const adSteps = [await adsOnPage()];
await allowAds(true);
adSteps.push(await adsOnPage());
await allowAds(false);
adSteps.push(await adsOnPage());
check("allowing ads on a site, then not, applies on the next load", adSteps.join(" → ") === "blocked → loaded → blocked", adSteps.join(" → "));

await go("chrome://version");
check("chrome://version", (await evaluate("document.body.innerText")).includes("154."));

await send("Network.enable");
await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await go("https://example.org/");
check("offline page is Where's Big Yahu?", /No internet/.test(await evaluate("document.title")));
await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await go(`${pages}/form.html`);

// A pinned tab's page stays as it was while tabs over it open and close: never reloaded, never
// freed. 0.2.7 reloaded pinned x.com on every other ⌘W (unit tests: store/pinnedClose.test.mjs).
// Work's pinned tab A (smoke.sh) is the tab it showed, so it loaded at launch. Tabs open and close
// here the way Chrome's own do (CDP), as test instances never get the key window for ⌘T / ⌘W.
async function browserCall(method, params = {}) {
  const bws = new WebSocket(browserInfo.webSocketDebuggerUrl);
  await new Promise((r) => (bws.onopen = r));
  const result = await new Promise((r) => {
    bws.onmessage = (e) => r(JSON.parse(e.data).result ?? {});
    bws.send(JSON.stringify({ id: 1, method, params }));
  });
  bws.close();
  return result;
}
async function onPage(target, method, params = {}) {
  const pws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (pws.onopen = r));
  const result = await new Promise((r) => {
    pws.onmessage = (e) => r(JSON.parse(e.data).result ?? {});
    pws.send(JSON.stringify({ id: 1, method, params }));
  });
  pws.close();
  return result;
}
async function pinnedPage() {
  const target = (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.type === "page" && t.url.endsWith("?pin-a"));
  if (!target) return undefined;
  const { result } = await onPage(target, "Runtime.evaluate", { expression: "[window.loadNo, document.visibilityState]", returnByValue: true });
  return { target, id: target.id, loads: result?.value?.[0], visibility: result?.value?.[1] };
}
const pinA = await pinnedPage();
const rounds = [];
for (let i = 0; pinA && i < 5; i++) {
  const { targetId } = await browserCall("Target.createTarget", { url: `${pages}/form.html?over-${i}` });
  await sleep(1200);
  await browserCall("Target.closeTarget", { targetId });
  await sleep(800);
  // Shown again (Chrome's own close picks a tab too, and the app follows it; 3 s at most).
  let shown;
  for (let t = 0; t < 6 && shown?.visibility !== "visible"; t++) {
    await onPage(pinA.target, "Page.bringToFront");
    await sleep(500);
    shown = await pinnedPage();
  }
  rounds.push(shown);
}
check("a pinned tab's page, shown again after a tab over it closed (5 times), is the same page, loaded once",
  !!pinA && pinA.loads === 1 && rounds.every((a) => a?.id === pinA.id && a.loads === 1 && a.visibility === "visible"),
  JSON.stringify({ first: pinA && [pinA.loads, pinA.visibility], rounds: rounds.map((a) => a && [a.id === pinA.id ? "same page" : "new page", a.loads, a.visibility]) }));
// Back to the page the checks drive; the right-click needs it on screen.
await send("Page.bringToFront");
await sleep(800);

// Last: right-click shows Chrome's context menu. Test instances (NETNYAHOO_BACKGROUND) don't draw it,
// since a context menu shows above every app, even over the user's work: they log its items to
// activation.log instead (NNActivation.mm). Builds from before that still draw it, a layer-101 window.
// Once the page has drawn with the field laid out (two animation frames), one right-click.
await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const b = document.querySelector("#c").getBoundingClientRect();
  r(b.width > 0 && b.height > 0);
})))`);
await click("#c", "right");
const menuLog = () => {
  try {
    return readFileSync(`${process.env.SMOKE_DATA}/activation.log`, "utf8").match(/context menu \(not shown\): (.*)/)?.[1];
  } catch {
    return undefined;
  }
};
let logged, menu;
for (const start = Date.now(); !logged && !menu && Date.now() - start < 3000; ) {
  logged = menuLog();
  menu = logged ? undefined : windows().find((w) => w.layer === 101);
}
check(
  "right-click shows the context menu",
  (logged && /Paste/.test(logged)) || !!menu,
  logged ? `logged: ${logged.slice(0, 80)}` : menu ? `layer ${menu.layer}` : "no menu",
);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// usage: node smoke.mjs <cdpPort> <version> <windowsTool> <pid> <pagesOrigin>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [port, version, windowsTool, pid, pages] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const locked = process.env.SMOKE_LOCKED === "1";
const checkUnlocked = (name, ok, detail = "") =>
  locked ? console.log(`SKIP  ${name}  (screen locked; ${ok ? "would pass" : "would fail"}${detail ? `: ${detail}` : ""})`) : check(name, ok, detail);
const windows = () =>
  execFileSync(windowsTool, [pid], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

const browserInfo = await (await fetch(`http://localhost:${port}/json/version`)).json();
check("engine is Chromium 154", /Chrome\/154\./.test(browserInfo.Browser), browserInfo.Browser);

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

// What became of the ad script's request while `run` ran, judged by the network: "blocked" when uBlock failed it
// (ERR_BLOCKED_BY_CLIENT, as on CEF) or redirected it to its no-op stand-in inside the extension (uBOL's optimal mode
// on NNCore: the stand-in loads, so the page's onload fires, but nothing left the browser), "loaded" when the ad
// server answered.
const adScript = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
async function adFate(run) {
  const ids = new Set();
  let fate;
  const listener = (m) => {
    const p = m.params ?? {};
    if (m.method === "Network.requestWillBeSent" && (p.request?.url === adScript || ids.has(p.requestId))) {
      ids.add(p.requestId);
      if (p.request.url.startsWith("chrome-extension://")) fate ??= "blocked";
    } else if (!ids.has(p.requestId)) {
      return;
    } else if (m.method === "Network.loadingFailed") {
      fate ??= /ERR_BLOCKED_BY_CLIENT/.test(p.errorText ?? "") || p.blockedReason ? "blocked" : `failed (${p.errorText})`;
    } else if (m.method === "Network.responseReceived" && new URL(p.response.url).hostname.endsWith("googlesyndication.com")) {
      fate ??= p.response.status < 400 ? "loaded" : `failed (${p.response.status})`;
    }
  };
  listeners.push(listener);
  await run();
  for (const start = Date.now(); !fate && Date.now() - start < 5000; ) await sleep(100);
  listeners.splice(listeners.indexOf(listener), 1);
  return fate ?? (ids.size ? "pending" : "not requested");
}
await send("Network.enable");
const ad = await adFate(() => evaluate(`fetch(${JSON.stringify(adScript)},{mode:"no-cors"}).then(()=>"loaded",e=>"blocked")`));
const control = await evaluate(`fetch("https://www.iana.org/favicon.ico",{mode:"no-cors"}).then(()=>"loaded",e=>"failed")`);
check("uBlock blocks an ad script, lets other requests through", ad === "blocked" && control === "loaded", `${ad}/${control}`);

const media = JSON.parse(
  await evaluate(
    `JSON.stringify([MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'), MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'), !!document.createElement("canvas").getContext("webgl2")])`,
  ),
);
check("H.264, AAC and WebGL2", media.every(Boolean), JSON.stringify(media));

const appWindows = () => windows().filter((w) => w.layer === 0 && w.w > 400 && w.h > 300);
const [appWindow] = appWindows().filter((w) => w.alpha > 0);
const hidden = appWindows().filter((w) => w.alpha === 0);
check("no hidden full-size Chrome window (the app window is Chrome's own)", !!appWindow && hidden.length === 0,
  JSON.stringify(appWindows().map((w) => [w.w, w.h, w.alpha])));
check("a window left on its second profile reopens as that profile's window, alone on screen",
  appWindows().filter((w) => w.alpha > 0).length === 1, JSON.stringify(appWindows().map((w) => [w.title, w.alpha])));
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

await go(`${pages}/passkey.html`);
await click("#b");
await sleep(1500);
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

const ubolPage = "chrome-extension://bnjeokpoejhioagiokhkhmdogkhbnbki/manifest.json";
const adsOnPage = () => adFate(() => go(`${pages}/ad.html`));
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
async function shownPage() {
  for (const t of (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page" && t.url.startsWith("http") && !t.url.endsWith("?home"))) {
    const { result } = await onPage(t, "Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true });
    if (result?.value === "visible") return t.url;
  }
}
const numbered = [];
for (const [key, code] of [["⌘2", 19], ["⌘9", 25], ["⌘1", 18]]) {
  execFileSync(process.env.SMOKE_KEYS, [pid, String(code), "c"]);
  await sleep(1500);
  numbered.push([key, await shownPage()]);
}
const [two, nine, one] = numbered.map(([, url]) => url);
check("⌘2, ⌘9 and ⌘1 select the sidebar's second, last and first (pinned) tab",
  /\?pin-a$/.test(one ?? "") && !!two && !!nine && new Set([one, two, nine]).size === 3 && !/\?pin-a$/.test(two),
  numbered.map(([key, url]) => `${key} ${url?.replace(/^.*\//, "") ?? "nothing shown"}`).join(", "));

await send("Page.bringToFront");
await sleep(800);

await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const b = document.querySelector("#c").getBoundingClientRect();
  r(b.width > 0 && b.height > 0);
})))`);
// Hidden test instances log context menus instead of displaying them over other apps.
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

// smoke.sh launches with NETNYAHOO_PIP_SELFTEST=close: the app clicks Chrome's own close button (X) on the first
// Picture in Picture window. Closing the mini player must leave the video playing (Chrome paused it).
await go(`${pages}/video.html`);
await send("Runtime.evaluate", { expression: "v.play().then(() => v.requestPictureInPicture())", awaitPromise: true, userGesture: true });
const pipClick = () => {
  try {
    return JSON.parse(readFileSync(`${process.env.SMOKE_DATA}/pip-button-selftest.json`, "utf8"));
  } catch {
    return undefined;
  }
};
let closed;
for (const start = Date.now(); !closed && Date.now() - start < 8000; await sleep(250)) closed = pipClick();
const before = await evaluate("v.currentTime");
await sleep(1000);
const after = await evaluate("({ paused: v.paused, time: v.currentTime, pip: !!document.pictureInPictureElement })");
check(
  "closing the Picture in Picture window leaves its video playing",
  !!closed?.closed && !after?.pip && after?.paused === false && after.time !== before,
  closed ? `closed ${closed.closed}, paused ${after?.paused}, ${before?.toFixed(2)} → ${after?.time?.toFixed(2)} s` : "no close click",
);

// smoke.sh left Chrome's last-used profile at Work, as quitting with Work's window in front does, and Chrome starts in
// it. Personal (the app's own profile, Chrome's Default directory) must still be itself: before 0.2.20 Personal's
// pages ran in Work's profile after such a quit (Work's cookies; Personal's history and bookmarks didn't load).
execFileSync(process.env.SMOKE_KEYS, [pid, "18", "t"]); // ⌃1: the first profile, Personal
let homeContext;
for (const start = Date.now(); !homeContext && Date.now() - start < 8000; await sleep(500)) {
  homeContext = (await browserCall("Target.getTargets")).targetInfos?.find((t) => t.type === "page" && t.url.endsWith("?home"))?.browserContextId;
}
check("Personal's pages run in Personal's profile when Work was the last used", !!homeContext && !!workContext && homeContext !== workContext,
  `personal ${homeContext}, work ${workContext}`);

// A page that stops answering is reported: Chrome's hang monitor raises onUnresponsive (the "Page Unresponsive" sheet).
// Chrome ignores a hang while a DevTools client is attached to the page, so the busy page is opened from the browser
// target, and the click that starts the hang monitor is sent from a client that detaches at once. 0.2.20 kept a client
// attached to every tab it showed (its drag pictures) and reported no hang in a one-window session; this two-profile
// session's busy tab isn't captured, so the check passes on 0.2.20 too: it guards hang reporting, not that case. The app's side is read through the dev
// harness's perf probe (smoke.sh writes perf-probe), which counts every event that reaches the app's JS.
async function app(body, timeout = 10000) {
  const id = `smoke-${Date.now()}-${Math.random()}`;
  writeFileSync(`${process.env.SMOKE_DATA}/dev-eval.js`, `// ${id}\n${body}`);
  for (const start = Date.now(); Date.now() - start < timeout; await sleep(100)) {
    let out;
    try {
      out = JSON.parse(readFileSync(`${process.env.SMOKE_DATA}/dev-eval-result.json`, "utf8"));
    } catch {
      continue;
    }
    if (out.id !== id) continue;
    if (out.error) throw new Error(out.error);
    return out.result;
  }
  throw new Error("the dev harness didn't answer");
}
const hangEvents = async () =>
  Object.entries((await app("return globalThis.nnPerf.read().tasks")) ?? {}).filter(([k]) => /Unresponsive/.test(k)).reduce((n, [, c]) => n + c, 0);
let hang;
try {
  const { targetId: busyId } = await browserCall("Target.createTarget", { url: `${pages}/busy.html` });
  await sleep(4000); // busy.html loads, then loops 2.5 s later (after 0.2.20's picture at 1.5 s)
  const before = await hangEvents();
  const busy = (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.id === busyId);
  const pws = new WebSocket(busy.webSocketDebuggerUrl);
  await new Promise((r) => (pws.onopen = r));
  for (const [id, type] of [[1, "mousePressed"], [2, "mouseReleased"]])
    pws.send(JSON.stringify({ id, method: "Input.dispatchMouseEvent", params: { type, x: 200, y: 200, button: "left", clickCount: 1 } }));
  await sleep(300);
  pws.close();
  const start = Date.now();
  while (!hang && Date.now() - start < 28000) {
    await sleep(1000);
    if ((await hangEvents()) > before) hang = `${Math.round((Date.now() - start) / 1000)} s after a click`;
  }
  await browserCall("Target.closeTarget", { targetId: busyId });
} catch (error) {
  console.log(`note: ${error.message}`);
}
check("a page that stops responding is reported (Page Unresponsive)", !!hang, hang ?? "no unresponsive event within 28 s");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

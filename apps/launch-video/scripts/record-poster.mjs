// Records the opening poster's page: a CDP screencast (page pixels, 2×) of netnyahoo.com in a hidden
// Netnyahoo test instance (NETNYAHOO_BACKGROUND=1, NETNYAHOO_REMOTE_DEBUGGING_PORT=$PORT, dark mode,
// 1440×900 window), clicking the site's Big Yahu at `danceAt` ms so he dances (a CDP page event, no
// OS input). The window around it is a ScreenCaptureKit capture of the same window (assets/window-site.webp);
// the frames were retimed to 30 fps and encoded as assets/poster-page.mp4.
//
//   PORT=9377 node scripts/record-poster.mjs <outDir> <seconds> [danceAt]
const PORT = process.env.PORT || 9377;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function connect(match) {
  const t = (await (await fetch(`http://localhost:${PORT}/json`)).json()).find((t) => t.type === "page" && t.url.includes(match));
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m.result), pending.delete(m.id);
    else if (m.method) listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  return { send, evaluate, on: (f) => listeners.push(f) };
}
import { mkdirSync, writeFileSync } from "node:fs";
const [out, secs, danceAt] = [process.argv[2], +process.argv[3], +(process.argv[4] ?? 300)];
mkdirSync(out, { recursive: true });
const c = await connect("netnyahoo.com");
const info = JSON.parse(await c.evaluate(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`));
console.log(info);
await c.send("Page.enable");
const frames = [];
c.on((m) => {
  if (m.method !== "Page.screencastFrame") return;
  frames.push({ ts: m.params.metadata.timestamp, data: m.params.data });
  c.send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
});
await c.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1, maxWidth: info.w * 2, maxHeight: info.h * 2 });
await sleep(danceAt);
const r = JSON.parse(await c.evaluate(`(() => { const b = document.querySelector('.yahu-canvas').getBoundingClientRect(); return JSON.stringify([b.x + b.width / 2, b.y + b.height * 0.45]); })()`));
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1, pointerType: "mouse" });
const tClick = Date.now() / 1000;
await sleep(secs * 1000 - danceAt);
await c.send("Page.stopScreencast");
const t0 = frames[0].ts;
frames.forEach((f, i) => writeFileSync(`${out}/${String(i).padStart(4, "0")}.jpg`, Buffer.from(f.data, "base64")));
writeFileSync(`${out}/frames.json`, JSON.stringify({ info, click: tClick - t0, ts: frames.map((f) => f.ts - t0) }));
console.log("frames", frames.length, "span", (frames.at(-1).ts - t0).toFixed(2));
process.exit(0);

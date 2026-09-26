// usage: node screencast.mjs <port> <urlSubstring> <seconds> <outDir> [actions.json]
// Records a page's CDP screencast (every frame, with timestamps) at the page's device scale; optional timed actions:
// [{ at: seconds, eval: "js" } | { at, scroll: { x, y, dy, speed } } | { at, navigate: url } | { at, reload: true }]
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const [port, match, secs, out, actionsFile] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const actions = actionsFile ? JSON.parse(readFileSync(actionsFile, "utf8")) : [];
const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((p) => p.type === "page" && p.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
let n = 0; const times = []; let t0 = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; }
  if (m.method === "Page.screencastFrame") {
    const { data, metadata, sessionId } = m.params;
    send("Page.screencastFrameAck", { sessionId });
    if (t0 === null) t0 = metadata.timestamp;
    n++; const name = String(n).padStart(5, "0");
    writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
    times.push(`${name} ${(metadata.timestamp - t0).toFixed(4)}`); writeFileSync(`${out}/times.txt`, times.join("\n"));
  }
};
await send("Page.enable");
const { cssVisualViewport: vv } = await send("Page.getLayoutMetrics");
const dpr = await send("Runtime.evaluate", { expression: "devicePixelRatio", returnByValue: true });
const scale = dpr.result.value;
await send("Page.startScreencast", { format: "png", maxWidth: Math.round(vv.clientWidth * scale), maxHeight: Math.round(vv.clientHeight * scale), everyNthFrame: 1 });
const start = Date.now();
for (const a of actions) {
  const wait = a.at * 1000 - (Date.now() - start); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (a.eval) await send("Runtime.evaluate", { expression: a.eval, awaitPromise: false });
  if (a.navigate) await send("Page.navigate", { url: a.navigate });
  if (a.reload) await send("Page.reload", { ignoreCache: true });
  if (a.scroll) send("Input.synthesizeScrollGesture", { x: a.scroll.x, y: a.scroll.y, yDistance: -a.scroll.dy, speed: a.scroll.speed ?? 600, gestureSourceType: "mouse" });
}
const rest = secs * 1000 - (Date.now() - start); if (rest > 0) await new Promise((r) => setTimeout(r, rest));
await Promise.race([send("Page.stopScreencast"), new Promise((r) => setTimeout(r, 1000))]);
writeFileSync(`${out}/times.txt`, times.join("\n"));
console.log(JSON.stringify({ frames: n, viewport: [vv.clientWidth, vv.clientHeight], scale }));
process.exit(0);

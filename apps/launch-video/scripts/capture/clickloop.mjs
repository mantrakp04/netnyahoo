// screenshot loop of the store page with a real CDP click on the Add button at +2.0 s
import { mkdirSync, writeFileSync } from "node:fs";
const [port, match, secs, out, cx, cy] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((p) => p.type === "page" && p.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const t0 = Date.now(); const times = []; let n = 0; let clicked = false;
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: +cx - 300, y: +cy + 200 });
while (Date.now() - t0 < secs * 1000) {
  const el = Date.now() - t0;
  if (el > 1400 && el < 2000) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: +cx, y: +cy });
  if (!clicked && el >= 2000) {
    clicked = true;
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: +cx, y: +cy, button: "left", clickCount: 1 });
    times.push(`press ${Date.now()}`);
    await new Promise((r) => setTimeout(r, 90));
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: +cx, y: +cy, button: "left", clickCount: 1 });
    times.push(`release ${Date.now()}`);
  }
  const t = Date.now();
  const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 95 });
  n++; const name = String(n).padStart(5, "0");
  writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.data, "base64"));
  times.push(`${name} ${t}`);
}
writeFileSync(`${out}/times.txt`, times.join("\n"));
console.log(JSON.stringify({ frames: n }));
process.exit(0);

// usage: node shotloop.mjs <port> <urlSubstring> <seconds> <outDir> [format=png|jpeg] — captureScreenshot in a loop, timestamps in times.txt
import { mkdirSync, writeFileSync } from "node:fs";
const [port, match, secs, out, format = "png"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((p) => p.type === "page" && p.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const t0 = Date.now(); const times = []; let n = 0;
while (Date.now() - t0 < secs * 1000) {
  const t = Date.now();
  const r = await send("Page.captureScreenshot", { format, ...(format === "jpeg" ? { quality: 95 } : {}) });
  n++; const name = String(n).padStart(5, "0");
  writeFileSync(`${out}/${name}.${format === "jpeg" ? "jpg" : "png"}`, Buffer.from(r.data, "base64"));
  times.push(`${name} ${((t - t0) / 1000).toFixed(4)} ${t}`);
}
writeFileSync(`${out}/times.txt`, times.join("\n"));
console.log(JSON.stringify({ frames: n, fps: n / secs }));
process.exit(0);

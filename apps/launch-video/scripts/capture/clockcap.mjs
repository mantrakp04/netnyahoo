// usage: node clockcap.mjs <port> <urlSubstring> <frames> <outDir> [warmupSec]
// Injects apps/launch-video/scripts/clock.js, reloads, then steps the page's clock 1/30 s per captured frame.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
const [port, match, frames, out, warm = "5", mode = "reload"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const clock = readFileSync(new URL("../clock.js", import.meta.url), "utf8");
const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((p) => p.type === "page" && p.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map(); const events = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } else events.push(m.method); };
const send = (method, params = {}) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
const shot = () => send("Page.captureScreenshot", { format: "jpeg", quality: 95 });
await send("Page.enable");
if (mode === "reload") { await send("Page.addScriptToEvaluateOnNewDocument", { source: clock }); await send("Page.reload", {}); }
else await ev(clock);
// keep frames flowing while it loads (no vsync on a locked screen)
const t0 = Date.now(); while (Date.now() - t0 < +warm * 1000) await shot();
const entering = ev("window.__clock ? window.__clock.enter().then(() => 'in') : 'no clock'");
let r; for (let i = 0; i < 20; i++) { await shot(); r = await Promise.race([entering, new Promise((res) => setTimeout(() => res(null), 50))]); if (r) break; }
console.log("enter", JSON.stringify(r?.result?.value ?? r));
for (let n = 1; n <= +frames; n++) {
  await ev("window.__clock.step(1000/30)");
  const s = await shot();
  writeFileSync(`${out}/${String(n).padStart(4, "0")}.jpg`, Buffer.from(s.data, "base64"));
}
console.log("frames", frames);
process.exit(0);

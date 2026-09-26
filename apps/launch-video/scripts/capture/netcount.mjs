// usage: node netcount.mjs <port> <urlSubstring> <seconds> — reloads that page and lists third-party registrable domains it requested
const [port, match, secs] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 15)];
const pages = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((p) => p.type === "page");
const page = pages.find((p) => p.url.includes(match));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const send = (method, params = {}) => ws.send(JSON.stringify({ id: id++, method, params }));
const hosts = new Map(); let requests = 0; let failed = 0; const errs = {};
const reg = (h) => { const p = h.split("."); const two = ["co.uk","com.au","co.in","co.jp","com.br"]; return two.includes(p.slice(-2).join(".")) ? p.slice(-3).join(".") : p.slice(-2).join("."); };
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent") { try { const u = new URL(m.params.request.url); if (!u.protocol.startsWith("http")) return; requests++; const r = reg(u.hostname); hosts.set(r, (hosts.get(r) ?? 0) + 1); } catch {} }
  if (m.method === "Network.loadingFailed") { failed++; errs[m.params.errorText + "|" + (m.params.blockedReason ?? "")] = (errs[m.params.errorText + "|" + (m.params.blockedReason ?? "")] ?? 0) + 1; } };
send("Network.enable"); send("Network.setCacheDisabled", { cacheDisabled: true }); send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, secs * 1000));
const first = reg(new URL(page.url).hostname);
const third = [...hosts].filter(([h]) => h !== first).sort((a, b) => b[1] - a[1]);
console.log(JSON.stringify({ url: page.url, requests, blocked: failed, thirdPartyDomains: third.length, errs, list: third }, null, 0));
process.exit(0);

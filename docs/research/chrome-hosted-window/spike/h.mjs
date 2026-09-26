// Shared helpers for the Chrome-hosted window checks (dev harness, CDP, window list).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const SP = process.env.SPIKE_DIR ?? process.cwd();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function harness(dataName, port, pid) {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
    return ok;
  };
  const windows = () =>
    execFileSync(`${SP}/windows`, [String(pid)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  let seq = 0;
  async function dev(body, timeoutMs = 15000) {
    const id = `h${Date.now()}_${seq++}`;
    writeFileSync(`${SP}/${dataName}/dev-eval.js`, `// ${id}\n${body}\n`);
    for (let i = 0; i < timeoutMs / 200; i++) {
      await sleep(200);
      try {
        const r = JSON.parse(readFileSync(`${SP}/${dataName}/dev-eval-result.json`, "utf8"));
        if (r.id === id) return r.error ? { error: r.error } : r.result;
      } catch {}
    }
    return { error: "timeout" };
  }
  const appWindows = () => windows().filter((w) => w.layer === 0 && w.w > 600 && w.alpha > 0);
  const win = (W, action) => dev(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${W}, ${JSON.stringify(action)})`);
  const winfo = async (W) => JSON.parse(await win(W, "winfo"));
  const ghosts = () => dev("return globalThis.expo.modules.NetnyahooCEF.chromeWindows()");
  const state = (expr) => dev(`const s = nn.store.getState(); return JSON.stringify(${expr})`).then((r) => (typeof r === "string" ? JSON.parse(r) : r));
  const targets = async () => (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page");

  async function cdp(match) {
    const all = (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page" || t.type === "other");
    const page = all.find((t) => (typeof match === "function" ? match(t) : t.url.includes(match)));
    if (!page) return null;
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
        pending.set(id, (m) => resolve(m.result ?? m.error ?? {}));
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) =>
      (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.value;
    const rect = async (selector) =>
      JSON.parse(await evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect())`));
    async function click(selector, button = "left") {
      const b = await rect(selector);
      const at = { x: b.x + Math.min(20, b.width / 2), y: b.y + b.height / 2, button, clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
      if (button === "left") await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
    }
    async function key(k) {
      const code = { ArrowDown: 40, Enter: 13, Escape: 27 }[k];
      const base = { key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, ...(k === "Enter" ? { text: "\r" } : {}) });
      if (k === "Enter") await send("Input.dispatchKeyEvent", { type: "char", ...base, text: "\r" });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    }
    async function go(url, wait = 15000) {
      await send("Page.enable");
      const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(wait)]);
      await sleep(800);
    }
    return { ws, send, evaluate, rect, click, key, go, close: () => ws.close(), url: page.url };
  }
  const shot = (name, id, out) => {
    try {
      execFileSync("screencapture", ["-x", "-o", "-l", String(id), `${out}/${name}.png`], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  const summary = () => {
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    return failed;
  };
  return { check, windows, appWindows, dev, win, winfo, ghosts, state, targets, cdp, shot, summary, results };
}

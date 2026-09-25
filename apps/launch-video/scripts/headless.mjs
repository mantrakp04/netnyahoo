// Drives the offline game (apps/browser/assets/offline-game, the page Netnyahoo shows when the
// network is down) in Remotion's headless Chromium, on a steppable clock, so every frame is exact.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
export const repo = join(here, "../../..");
export const gameDir = join(repo, "apps/browser/assets/offline-game");
const chrome = join(
  here,
  "../node_modules/.remotion/chrome-headless-shell/mac-arm64/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);

// Netnyahoo's tab content size in the capture window (1120×860 window, sidebar open), at 2×.
export const VIEW = { width: 923, height: 806, dpr: 2 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(port = 9399) {
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "nn-lv-"))}`,
    "--headless",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-color-profile=srgb",
    "--disable-renderer-backgrounding",
    "about:blank",
  ], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 50; i++) {
    try {
      targets = await (await fetch(`http://localhost:${port}/json`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch {}
    await sleep(200);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.j(new Error(JSON.stringify(m.error))) : p.r(m.result);
    }
  };
  const send = (method, params = {}) => new Promise((r, j) => {
    const i = ++id;
    pending.set(i, { r, j });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.dpr, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(join(here, "clock.js"), "utf8") });

  return {
    send,
    evaluate,
    /** Opens the game as the offline page for x.com, with a fixed seed and the debug hook. */
    async open(seed) {
      const q = new URLSearchParams({ code: "ERR_INTERNET_DISCONNECTED", url: "https://x.com/", theme: "dark", debug: "1", seed: String(seed) });
      await send("Page.navigate", { url: `file://${gameDir}/index.html?${q}` });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await evaluate("!!(window.__yahu && __yahu.state === 'title')")) return;
      }
      throw new Error("game did not boot");
    },
    async shot(clip, format = "png", quality = 95) {
      const p = { format, captureBeyondViewport: false, fromSurface: true };
      if (format === "jpeg") p.quality = quality;
      if (clip) p.clip = { ...clip, scale: 1 };
      return Buffer.from((await send("Page.captureScreenshot", p)).data, "base64");
    },
    async click(x, y) {
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1, pointerType: "mouse" });
      }
    },
    close() { ws.close(); proc.kill(); },
  };
}

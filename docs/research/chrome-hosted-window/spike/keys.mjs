// Key routing in a window: which layer takes each shortcut and what it did.
// usage: node keys.mjs <dataDirName> <cdpPort> <pid> <pagesOrigin>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// SPIKE_DIR holds the data dirs, the compiled windows tool (.claude/skills/release/scripts/windows.swift) and outputs.
const SP = process.env.SPIKE_DIR ?? process.cwd();
const [dataName, port, pid, pages] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const windows = () =>
  execFileSync(`${SP}/windows`, [pid], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
let seq = 0;
async function dev(body) {
  const id = `k${Date.now()}_${seq++}`;
  writeFileSync(`${SP}/${dataName}/dev-eval.js`, `// ${id}\n${body}\n`);
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    try {
      const r = JSON.parse(readFileSync(`${SP}/${dataName}/dev-eval-result.json`, "utf8"));
      if (r.id === id) return r.error ? { error: r.error } : r.result;
    } catch {}
  }
  return { error: "timeout" };
}
const W = windows().find((w) => w.layer === 0 && w.w > 600 && w.alpha > 0).id;
const win = (action) => dev(`return globalThis.expo.modules.NetnyahooCEF.devWindow(${W}, ${JSON.stringify(action)})`);
const state = async () =>
  JSON.parse(
    await dev(`const s = nn.store.getState(); const w = Object.values(s.windows)[0];
      const ui = s.ui ? Object.values(s.ui)[0] : undefined;
      return JSON.stringify({ tabs: w.tabIds.map((id) => (s.tabs[id]?.url || "").replace(/^https?:\\/\\/localhost:\\d+\\//, "")), panel: !!ui?.panel?.open })`),
  );
const chromeTabs = async () =>
  (await (await fetch(`http://localhost:${port}/json`)).json()).filter((t) => t.type === "page").map((t) => t.url.replace(/^https?:\/\/localhost:\d+\//, "")).sort();

await dev(`nn.actions.openUrls(["${pages}/page.html"]); return 1`);
await sleep(2500);
const [g] = await dev("return globalThis.expo.modules.NetnyahooCEF.ghostWindows()");
await win(`click:${g.pageInsets[1] + 300},${g.pageInsets[0] + 300}`); // focus the page
await sleep(500);

const CMD = 1 << 20, OPT = 1 << 19, SHIFT = 1 << 17;
const cases = [
  ["⌘T (our New Tab)", CMD, "t", 17],
  ["⌥⌘L (Chrome-only: Downloads)", CMD | OPT, "¬", 37],
  ["⌥⌘↑ (Chrome-only: focus toolbar)", CMD | OPT, "", 126],
  ["⇧⌘M (Chrome-only: profile menu)", CMD | SHIFT, "M", 46],
  ["⌘L (our command bar)", CMD, "l", 37],
];
for (const [name, flags, ch, code] of cases) {
  const before = { ...(await state()), chrome: await chromeTabs(), windows: windows().length };
  const handled = await win(`keys:${flags}:${ch}:${code}`);
  await sleep(1500);
  const after = { ...(await state()), chrome: await chromeTabs(), windows: windows().length };
  console.log(`${name}\n  handled by: ${handled}\n  before: ${JSON.stringify(before)}\n  after:  ${JSON.stringify(after)}`);
  await sleep(600);
  await win(`click:${g.pageInsets[1] + 300},${g.pageInsets[0] + 300}`);
  await sleep(400);
}
process.exit(0);

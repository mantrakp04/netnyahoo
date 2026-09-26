// usage: CAPTURE_DIR=… node dev.mjs <instance> <file.js | -e code> [timeoutSec]
// Runs a script through the app's DEV harness (apps/browser/src/lib/devHarness.ts) and prints its result.
import { readFileSync, writeFileSync } from "node:fs";
const L = process.env.CAPTURE_DIR;
const [inst, a, b, c] = process.argv.slice(2);
// harness/*.js files are concatenated by the caller; __CAPTURE_DIR__ is where their snapshots go
const body = (a === "-e" ? b : readFileSync(a, "utf8")).replaceAll("__CAPTURE_DIR__", L);
const timeout = Number((a === "-e" ? c : b) ?? 60);
const id = `m${Date.now()}`;
writeFileSync(`${L}/${inst}/dev-eval.js`, `// ${id}\n${body}\n`);
const t0 = Date.now();
while (Date.now() - t0 < timeout * 1000) {
  await new Promise((r) => setTimeout(r, 300));
  try { const r = JSON.parse(readFileSync(`${L}/${inst}/dev-eval-result.json`, "utf8")); if (r.id === id) { console.log(r.error ? "ERROR " + r.error : typeof r.result === "string" ? r.result : JSON.stringify(r.result)); process.exit(r.error ? 1 : 0); } } catch {}
}
console.log("timeout"); process.exit(2);

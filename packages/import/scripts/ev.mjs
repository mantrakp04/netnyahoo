#!/usr/bin/env node
// Runs one script in a running Netnyahoo instance through its dev harness (apps/browser/src/lib/devHarness.ts) and
// prints the result as JSON. For poking the instance `e2e.mjs --keep` leaves running.
//
//   node packages/import/scripts/ev.mjs <data dir> '<js body>' [timeout seconds, default 30]
//
// <data dir> is the instance's NETNYAHOO_DATA_DIR. The body returns a value or a promise (no top-level await);
// `nn` is the harness (store, actions, runCommand, …), native modules are on globalThis.expo.modules.
// Example: node packages/import/scripts/ev.mjs /tmp/e2e/data 'return globalThis.nnImport?.step'
import fs from "node:fs";
import path from "node:path";

const [dataArg, body, seconds = "30"] = process.argv.slice(2);
if (!dataArg || !body || dataArg === "-h" || dataArg === "--help") {
  const lines = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(dataArg === "-h" || dataArg === "--help" ? 0 : 64);
}
const data = path.resolve(dataArg);
const id = `ev-${Date.now()}`;
fs.writeFileSync(path.join(data, "dev-eval.js"), `// ${id}\n${body}`);
const deadline = Date.now() + Number(seconds) * 1000;
while (Date.now() < deadline) {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(data, "dev-eval-result.json"), "utf8"));
    if (r.id === id) {
      console.log(JSON.stringify(r.error ?? r.result, null, 1));
      process.exit(r.error ? 1 : 0);
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
console.error(`no answer in ${seconds}s (is the instance running on ${data}?)`);
process.exit(2);

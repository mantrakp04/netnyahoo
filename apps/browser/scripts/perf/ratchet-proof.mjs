#!/usr/bin/env node
// Shows that a count tracks wall-clock on a real fix: runs the same Node workload on two revisions of the source and
// prints, for each, the builtin calls (ops.mjs, exact) and the median time. The default pair is f3417151^ and f3417151,
// "Strip and sidebar entries look tabs' groups and splits up by index" (a commit that cut sidebarEntries after a
// title change from 49,271 calls and 3.1 ms to 4,121 calls and 0.16 ms with 1000 tabs). The times are wall-clock:
// run it under `scripts/agent/locked perflab -- node apps/browser/scripts/perf/ratchet-proof.mjs`.
//
//   node ratchet-proof.mjs [<before rev> <after rev>] [--out <dir>]
//
// Each revision's apps/browser/src and packages/core are exported with `git archive` into <out>/<name> (not a worktree:
// nothing is checked out), with this tree's node_modules linked in and its Node test loader and native stub copied in
// (a revision from before them can't run its TypeScript otherwise). Needs revisions whose store has `hydrate`.

import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "../..");
const repo = resolve(appDir, "../..");
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) (args[i].startsWith("--") ? (flags[args[i].slice(2)] = args[++i]) : positional.push(args[i]));
const [beforeRev = "f3417151^", afterRev = "f3417151"] = positional;
const out = resolve(flags.out ?? join(process.env.TMPDIR ?? "/tmp", "ac-ratchet-proof"));

// The workload: a 1000-tab window (every 10th pair a split, groups of 20), one tab retitled, then the sidebar's
// entries asked for. Same code on both revisions.
const micro = readFileSync(join(here, "micro-bench.mjs"), "utf8");
const bigSession = /\/\/ One window with `count` tabs.*?\n}\n/s.exec(micro)[0];
const workload = `
const { useBrowser } = await import("../../src/store/browser.ts");
const { sidebarEntries } = await import("../../src/components/sidebar/entries.ts");
await import("../../src/test-native-stub.mjs");
const { countOps } = await import("./ops.mjs");
const S = () => useBrowser.getState();
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
${bigSession}
for (const count of [200, 1000]) {
  const ids = bigSession(count);
  sidebarEntries(S(), "w");
  const times = [];
  for (let r = 0; r < 60; r++) {
    S().updateTab(ids[(r * 7) % count], { title: "T" + r });
    const t = performance.now();
    sidebarEntries(S(), "w");
    times.push(performance.now() - t);
  }
  S().updateTab(ids[3], { title: "count me" });
  const { total } = countOps(() => sidebarEntries(S(), "w"));
  console.log(JSON.stringify({ count, calls: total, ms: median(times.slice(10)) }));
}
`;

const results = {};
for (const [name, rev] of [["before", beforeRev], ["after", afterRev]]) {
  const dir = join(out, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tar = execFileSync("git", ["-C", repo, "archive", rev, "apps/browser/src", "apps/browser/package.json", "packages/core"], { maxBuffer: 1 << 28 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  symlinkSync(join(appDir, "node_modules"), join(dir, "apps/browser/node_modules"));
  for (const f of ["test-loader.mjs", "test-native-stub.mjs"]) copyFileSync(join(appDir, "src", f), join(dir, "apps/browser/src", f));
  const perf = join(dir, "apps/browser/scripts/perf");
  mkdirSync(perf, { recursive: true });
  copyFileSync(join(here, "ops.mjs"), join(perf, "ops.mjs"));
  writeFileSync(join(perf, "proof.mjs"), workload);
  const lines = execFileSync(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", "scripts/perf/proof.mjs"], { cwd: join(dir, "apps/browser"), encoding: "utf8" });
  results[name] = lines.trim().split("\n").map((l) => JSON.parse(l));
}

console.log(`sidebarEntries after a title change, ${beforeRev} -> ${afterRev}`);
for (const [i, b] of results.before.entries()) {
  const a = results.after[i];
  console.log(`${String(b.count).padStart(5)} tabs: ${b.calls} -> ${a.calls} builtin calls (${((a.calls / b.calls - 1) * 100).toFixed(0)}%), ${b.ms.toFixed(3)} -> ${a.ms.toFixed(3)} ms (${((a.ms / b.ms - 1) * 100).toFixed(0)}%)`);
}
rmSync(out, { recursive: true, force: true });

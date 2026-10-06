#!/usr/bin/env node
// Instructions retired per round of typing "github.com/net" and "react native perf" on the seed profile (micro-bench.mjs
// `suggest-keys=<rounds>`): the CPU's own counter through `/usr/bin/time -l` under `node --predictable`, the difference of a
// run of N rounds and a run of none, divided by N. Same method as ratchet.mjs instrPerRound. Run from apps/browser:
//
//   node scripts/perf/suggest-instr.mjs [rounds=200] [repeats=3]
import { spawnSync } from "node:child_process";

const rounds = Number(process.argv[2] ?? 200);
const repeats = Number(process.argv[3] ?? 3);
const retired = (n) => {
  const r = spawnSync("/usr/bin/time", ["-l", process.execPath, "--no-warnings", "--predictable", "--import", "./src/test-loader.mjs", "scripts/perf/micro-bench.mjs", `suggest-keys=${n}`], { encoding: "utf8" });
  const m = /(\d+)\s+instructions retired/.exec(r.stderr);
  if (!m) throw new Error(`no "instructions retired": ${r.stderr.slice(-300)}`);
  return Number(m[1]);
};
const per = [];
for (let i = 0; i < repeats; i++) per.push((retired(rounds) - retired(0)) / rounds);
per.sort((a, b) => a - b);
console.log(`suggest instructions per round: median ${Math.round(per[repeats >> 1]).toLocaleString()} (min ${Math.round(per[0]).toLocaleString()}, max ${Math.round(per.at(-1)).toLocaleString()}, n=${repeats})`);

// Compares the Chrome startup traces of two native-bench sides (`native-bench.mjs --only launch --trace-startup <cats>`):
// where in the engine's start a launch's time goes.
//
//   node launch-trace.mjs <a/results.json> <b/results.json> [--top 40] [--thread CrBrowserMain] [--proc Browser]
//
// Times are ms after the browser process was created (the trace's Startup.LoadTime.ProcessCreateToApplicationStart):
// ChromeMain's entry, BrowserMain, the end of BrowserMainRunnerImpl::Initialize, and each process kind's first event,
// as medians with every launch's value. Then the slices on the browser's main thread up to BrowserMain + 400 ms, by
// name (a task by where it was posted from), inclusive ms, biggest change first. Nothing between ChromeMain and
// BrowserMain is traced: for that window, nnsample.c and launch-samples.mjs sample the main thread.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: o, positionals: files } = parseArgs({
  allowPositionals: true,
  options: { top: { type: "string", default: "40" }, thread: { type: "string", default: "CrBrowserMain" }, proc: { type: "string", default: "Browser" } },
});
if (files.length !== 2) {
  console.error("usage: node launch-trace.mjs <a/results.json> <b/results.json> [--top n]");
  process.exit(64);
}
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function analyze(file) {
  const ev = JSON.parse(readFileSync(file, "utf8")).traceEvents;
  const procName = new Map(), threadName = new Map();
  for (const e of ev) {
    if (e.ph !== "M") continue;
    if (e.name === "process_name") procName.set(e.pid, e.args.name);
    if (e.name === "thread_name") threadName.set(`${e.pid}:${e.tid}`, e.args.name);
  }
  const browser = [...procName].find(([, n]) => n === o.proc)?.[0];
  const mine = ev.filter((e) => e.pid === browser);
  const at = (name, ph) => mine.find((e) => e.name === name && e.ph === ph)?.ts;
  const created = at("Startup.LoadTime.ProcessCreateToApplicationStart", "b");
  const ms = (ts) => (ts - created) / 1000;
  const init = mine.find((e) => e.name === "BrowserMainRunnerImpl::Initialize" && e.ph === "X");
  const marks = {
    "ChromeMain entered": ms(at("Startup.LoadTime.ProcessCreateToApplicationStart", "e")),
    BrowserMain: ms(mine.find((e) => e.name === "BrowserMain")?.ts),
    "BrowserMain initialized": init ? ms(init.ts + init.dur) : NaN,
  };
  for (const e of ev) {
    if (e.ph === "M" || !e.ts) continue;
    const k = `first event: ${procName.get(e.pid) ?? "?"}`;
    if (!(k in marks) || ms(e.ts) < marks[k]) marks[k] = ms(e.ts);
  }
  // Main-thread slices by name, clipped to BrowserMain + 400 ms.
  const until = marks.BrowserMain + 400;
  const key = (e) => (e.args?.src_func ? `${e.name} @${(e.args.src_file ?? "").split("/").slice(-2).join("/")}:${e.args.src_func}` : e.name);
  const byName = new Map();
  const open = [];
  for (const e of ev) {
    if (e.pid !== browser || threadName.get(`${e.pid}:${e.tid}`) !== o.thread) continue;
    let s;
    if (e.ph === "X") s = { name: key(e), ts: ms(e.ts), dur: (e.dur ?? 0) / 1000 };
    else if (e.ph === "B") open.push(e);
    else if (e.ph === "E" && open.length) {
      const b = open.pop();
      s = { name: key(b), ts: ms(b.ts), dur: (e.ts - b.ts) / 1000 };
    }
    if (!s) continue;
    const end = Math.min(s.ts + s.dur, until);
    if (end > s.ts) byName.set(s.name, (byName.get(s.name) ?? 0) + end - s.ts);
  }
  return { marks, byName };
}

const sides = files.map((f) => {
  const r = JSON.parse(readFileSync(f, "utf8"));
  return { label: r.meta?.label ?? f, runs: (r.launch ?? []).filter((l) => l.trace).map((l) => analyze(l.trace)) };
});
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");
const cell = (xs) => `${fmt(median(xs))} [${xs.filter(Number.isFinite).map((x) => Math.round(x)).sort((a, b) => a - b).join(",")}]`;
console.log(`ms after the browser process was created; n = ${sides.map((s) => s.runs.length).join(" / ")}; ${sides.map((s) => s.label).join(" → ")}`);
const marks = [...new Set(sides.flatMap((s) => s.runs.flatMap((r) => Object.keys(r.marks))))];
for (const m of marks) console.log(`${m.padEnd(36)} ${sides.map((s) => cell(s.runs.map((r) => r.marks[m]))).join("  →  ")}`);
const names = new Set(sides.flatMap((s) => s.runs.flatMap((r) => [...r.byName.keys()])));
const rows = [...names].map((n) => {
  const meds = sides.map((s) => median(s.runs.map((r) => r.byName.get(n) ?? 0)));
  return { n, meds, d: meds[1] - meds[0] };
});
rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log(`\nmain-thread slices up to BrowserMain + 400 ms, inclusive ms (median), biggest change first:`);
for (const r of rows.slice(0, +o.top)) console.log(`${fmt(r.meds[0]).padStart(8)} ${fmt(r.meds[1]).padStart(8)} ${(r.d >= 0 ? "+" : "") + fmt(r.d)}  ${r.n}`);

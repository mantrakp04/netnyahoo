#!/usr/bin/env node
// The release notes' "Faster" table: the old release against the new one, in plain words, from the results
// scripts/release-compare-0.2.17.sh collected.
//
//   node scripts/release-compare-table.mjs <out dir> <old label> <new label>
//
// Reads <out>/nb/<label>/results.json (native-bench: launch, session, windows), <out>/fresh/<label>/results.json
// (the first launch after an install), <out>/switch/<label>/results.json (tab switches alone), <out>/journeys/<new label>/results.json (newtabkey, the new release only) and
// <out>/js/<new label>.json (js-bench typing, the new release only). A row the old release can't be measured on stays
// in the table with "–" in its column and no change. Prints the table (Markdown) to stdout and writes
// <out>/table.md (the same) and <out>/table-detail.md (every row with min–max and n, for whoever judges the gate).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outDir, oldLabel, newLabel] = process.argv.slice(2);
if (!outDir || !oldLabel || !newLabel) {
  console.error("usage: release-compare-table.mjs <out dir> <old label> <new label>");
  process.exit(64);
}
const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const finite = (xs) => xs.filter(Number.isFinite);
const median = (xs) => {
  const v = finite(xs).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN;
};
const stat = (xs) => {
  const v = finite(xs);
  return v.length ? { median: median(v), min: Math.min(...v), max: Math.max(...v), n: v.length } : null;
};

// Per label: the samples of every row, as native-bench's summary() builds them.
function native(label, dir = "nb") {
  const res = read(join(outDir, dir, label, "results.json"));
  if (!res) return null;
  const S = res.session ?? [];
  const W = [...S, ...(res.windows ?? [])];
  const perRun = (rows, get) => rows.map((r) => median(get(r)));
  return {
    open: res.launch.map((r) => r.withContent),
    paint: res.launch.map((r) => r.firstPaint),
    switch: perRun(S, (r) => r.tabSwitch ?? []),
    newTab: perRun(S, (r) => r.newTab ?? []),
    newWindow: perRun(W, (r) => r.newWindow?.map((w) => w.withContent) ?? []),
    cpu1: S.map((r) => r.idle?.tabs1?.total.cpu),
    cpu20: S.map((r) => r.idle?.tabs20?.total.cpu),
    wake1: S.map((r) => r.idle?.tabs1?.total.wakeups),
    wake20: S.map((r) => r.idle?.tabs20?.total.wakeups),
    mem1: S.map((r) => r.memory?.tabs1?.totalMB),
    mem20: S.map((r) => r.memory?.tabs20?.totalMB),
    used: S.map((r) => [r.idle?.tabs1, r.idle?.tabs20].reduce((n, w) => n + (w?.input?.inputSecs ?? 0), 0)),
    leftOut: S.map((r) => (r.throttled ? r.throttled.tabSwitch + r.throttled.newTab : 0)),
  };
}
const oldN = native(oldLabel);
const newN = native(newLabel);
if (!newN) {
  console.error(`no results for ${newLabel} in ${outDir}/nb`);
  process.exit(1);
}
// Tab switches come from their own run (right after the tabs open) when there is one: 0.2.17 freezes background tabs after
// a minute, and the full session's switches come late.
const oldSwitch = native(oldLabel, "switch")?.switch;
const newSwitch = native(newLabel, "switch")?.switch;
const oldFresh = native(oldLabel, "fresh");
const newFresh = native(newLabel, "fresh");

// The new release's journeys (⌘T, keystroke) and js-bench typing: nothing to compare them with on the old release.
const J = read(join(outDir, "journeys", newLabel, "results.json"))?.journeys ?? [];
const pooled = (get) => J.flatMap(get).filter(Number.isFinite);
const jsReport = read(join(outDir, "js", `${newLabel}.json`));
const line = (key) => {
  const l = jsReport?.summary?.lines?.[key];
  return l && Number.isFinite(l.median) ? { median: l.median, min: l.min, max: l.max, n: l.n } : null;
};

// unit: formatting; better: "lower" for everything here; word: what a drop is called.
const rows = [
  ["Opening the app", "ms", "faster", oldN?.open, newN.open],
  ["Opening the app, until the first page has painted", "ms", "faster", oldN?.paint, newN.paint],
  ["Opening the app for the first time after an update", "ms", "faster", oldFresh?.open, newFresh?.open],
  ["Switching tabs", "ms", "faster", oldSwitch ?? oldN?.switch, newSwitch ?? newN.switch],
  ["Opening a new tab, until its page has painted", "ms", "faster", oldN?.newTab, newN.newTab],
  ["Opening a new window", "ms", "faster", oldN?.newWindow, newN.newWindow],
  ["⌘T until you can type in the command bar", "ms", "faster", null, J.length ? pooled((r) => r.j2.map((x) => x.typeable)) : null],
  ["A keystroke in the command bar until its suggestions show", "ms", "faster", null, J.length ? pooled((r) => r.j2.map((x) => x.suggest)) : null],
  ["A keystroke in the command bar: the app's own work", "ms", "faster", null, line("typing.keyMedianMs")],
  ["Typing 30 keys in the command bar: screen updates", "", "fewer", null, line("typing30.commits")],
  ["Typing 30 keys in the command bar: views redrawn", "", "fewer", null, line("typing30.renders")],
  ["Doing nothing with 1 tab open: CPU", "%", "less", oldN?.cpu1, newN.cpu1],
  ["Doing nothing with 1 tab open: wake-ups per second", "/s", "fewer", oldN?.wake1, newN.wake1],
  ["Doing nothing with 20 tabs open: CPU", "%", "less", oldN?.cpu20, newN.cpu20],
  ["Doing nothing with 20 tabs open: wake-ups per second", "/s", "fewer", oldN?.wake20, newN.wake20],
  ["Memory with 1 tab open", "MB", "less", oldN?.mem1, newN.mem1],
  ["Memory with 20 tabs open", "MB", "less", oldN?.mem20, newN.mem20],
].map(([name, unit, word, a, b]) => ({ name, unit, word, a: a && !Array.isArray(a) ? a : a ? stat(a) : null, b: b && !Array.isArray(b) ? b : b ? stat(b) : null }));

const digits = (r, v) => (r.unit === "%" ? (v < 10 ? 2 : 1) : r.unit === "/s" ? (v < 100 ? 1 : 0) : 0);
const fmt = (r, s) => (s ? `${s.median.toFixed(digits(r, s.median))}${r.unit === "%" ? "%" : r.unit ? ` ${r.unit}` : ""}` : "–");
const fmtFull = (r, s) => (s ? `${fmt(r, s)} (${s.min.toFixed(digits(r, s.min))}–${s.max.toFixed(digits(r, s.max))}, n=${s.n})` : "–");
// ×: how many times better; %: the change. Under 5% either way is "the same".
function change(r) {
  if (!r.a || !r.b || !(r.a.median > 0)) return "–";
  const d = r.b.median / r.a.median - 1;
  if (Math.abs(d) < 0.05) return "same";
  const pct = `${d < 0 ? "−" : "+"}${Math.abs(d * 100).toFixed(0)}%`;
  const times = r.a.median / r.b.median;
  if (d < 0) return times >= 1.5 ? `${times.toFixed(1)}× ${r.word} (${pct})` : `${pct} (${r.word})`;
  const worse = { faster: "slower", less: "more", fewer: "more" }[r.word];
  return `${pct} (${worse})`;
}
const table = (cell) =>
  [`| | ${oldLabel} | ${newLabel} | Change |`, "|---|---:|---:|---:|", ...rows.map((r) => `| ${r.name} | ${cell(r, r.a)} | ${cell(r, r.b)} | ${change(r)} |`)].join("\n");

const out = table(fmt);
const notes = [];
if (newN.used.some((s) => s > 0) || oldN?.used.some((s) => s > 0)) notes.push(`Someone used the Mac during the idle windows (${[...(oldN?.used ?? []), ...newN.used].map((s) => s.toFixed(1)).join(", ")} s per run): treat the idle rows with care.`);
const left = [...(oldN?.leftOut ?? []), ...newN.leftOut].reduce((a, b) => a + b, 0);
if (left) notes.push(`${left} tab switches or new tabs were left out because the screen was off (rerun with the display awake).`);
const detail = `${table(fmtFull)}${notes.length ? `\n\n${notes.map((n) => `- ${n}`).join("\n")}` : ""}\n`;
writeFileSync(join(outDir, "table.md"), `${out}\n`);
writeFileSync(join(outDir, "table-detail.md"), detail);
console.log(out);
for (const n of notes) console.error(`note: ${n}`);

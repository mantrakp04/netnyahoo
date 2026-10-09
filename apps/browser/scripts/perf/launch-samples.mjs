// Compares where two apps' main threads spend a launch, from nnsample.c's samples, between two stack marks (by default
// ChromeMain's entry and BrowserMain: the stretch Chrome's startup trace doesn't cover).
//
//   clang -O2 -dynamiclib -arch arm64 nnsample.c -o <tools>/nnsample.dylib && codesign -fs - <tools>/nnsample.dylib
//   node native-bench.mjs … --only launch --env AC_SAMPLE_MS=300 --env DYLD_INSERT_LIBRARIES=<tools>/nnsample.dylib
//   rm <out>/*/template/nnsample.txt        (the seeding launch's; AC_SAMPLE_MS must end before a launch quits)
//   node launch-samples.mjs <out> <labelA>=<unstripped framework A> <labelB>=<unstripped framework B> [--from re] [--to re] [--top n] [--leaf]
//
// The unstripped framework is dist/<version>/symbols/Chromium Framework (release.sh keeps it; match `dwarfdump --uuid`).
// Frames in Chrome's framework are symbolized with atos, the rest with dladdr in the app. Prints each launch's window
// length and the median samples (≈ ms at the ~1 ms period it prints) per function inside the window, inclusive.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: o, positionals: [out, ...sides] } = parseArgs({
  allowPositionals: true,
  options: { from: { type: "string", default: "^ChromeMain$" }, to: { type: "string", default: "content::BrowserMain\\(" }, top: { type: "string", default: "50" }, leaf: { type: "boolean" } },
});
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const short = (s) => s.replace(/ \(in [^)]*\)( \+ \d+)?/, "").replace(/\(.*$/, "").trim().replace(/ \(in .*$/, "").replace(/^-?\[/, "[").slice(0, 120);

const res = [];
for (const spec of sides) {
  const [label, symbols] = spec.split("=");
  const dir = join(out, label, "data");
  const launches = readdirSync(dir).filter((d) => existsSync(join(dir, d, "nnsample.txt")));
  const parsed = launches.map((d) => {
    const lines = readFileSync(join(dir, d, "nnsample.txt"), "utf8").split("\n");
    const sym = new Map();
    const samples = [];
    for (const l of lines) {
      if (l.startsWith("sym ")) {
        const [head, name] = l.split("\t");
        const [, pc, base, ...file] = head.split(" ");
        sym.set(pc, { base: parseInt(base, 16), file: file.join(" "), name });
      } else if (l.startsWith("s ")) {
        const [, t, state, ...pcs] = l.split(" ");
        samples.push({ t: +t / 1000, state: +state, pcs });
      }
    }
    return { d, sym, samples };
  });
  // atos the framework's offsets once.
  const offsets = new Set();
  for (const p of parsed) for (const [pc, s] of p.sym) if (s.file.endsWith("Chromium Framework")) offsets.add(parseInt(pc, 16) - s.base - 1);
  const list = [...offsets];
  const names = new Map();
  for (let i = 0; i < list.length; i += 4000) {
    const chunk = list.slice(i, i + 4000);
    const outp = execFileSync("atos", ["-o", symbols, "-l", "0x0", ...chunk.map((x) => "0x" + x.toString(16))], { encoding: "utf8", maxBuffer: 256 << 20 }).split("\n");
    chunk.forEach((x, k) => names.set(x, short(outp[k] ?? "?")));
  }
  const name = (p, pc) => {
    const s = p.sym.get(pc);
    if (!s) return "?";
    if (s.file.endsWith("Chromium Framework")) return names.get(parseInt(pc, 16) - s.base - 1) ?? "?";
    const lib = s.file.split("/").pop();
    return `${short(s.name)} [${lib}]`;
  };
  const runs = parsed.map((p) => {
    const stacks = p.samples.map((s) => ({ ...s, fns: s.pcs.map((pc) => name(p, pc)) }));
    const from = new RegExp(o.from), to = new RegExp(o.to);
    const a = stacks.find((s) => s.fns.some((f) => from.test(f)));
    const b = stacks.find((s) => s.fns.some((f) => to.test(f)));
    const inWin = stacks.filter((s) => a && s.t >= a.t && (!b || s.t < b.t));
    const incl = new Map();
    for (const s of inWin) for (const f of new Set(o.leaf ? s.fns.slice(0, 1) : s.fns)) incl.set(f, (incl.get(f) ?? 0) + 1);
    return { d: p.d, from: a?.t, to: b?.t, n: inWin.length, incl, period: (stacks.at(-1).t - stacks[0].t) / stacks.length };
  });
  res.push({ label, runs });
}
for (const r of res) {
  console.log(`${r.label}: window ${o.from} → ${o.to}: ms ${r.runs.map((x) => (x.to - x.from).toFixed(0)).join(",")}; from at ${r.runs.map((x) => x.from?.toFixed(0)).join(",")}; samples ${r.runs.map((x) => x.n).join(",")}; period ${median(r.runs.map((x) => x.period)).toFixed(2)} ms`);
}
const fns = new Set(res.flatMap((r) => r.runs.flatMap((x) => [...x.incl.keys()])));
const rows = [...fns].map((f) => {
  const meds = res.map((r) => median(r.runs.map((x) => x.incl.get(f) ?? 0)));
  return { f, meds, d: meds[1] - meds[0] };
});
rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
console.log(`\nmedian samples (≈ms) inside the window, ${o.leaf ? "leaf" : "inclusive"}, biggest change first:`);
for (const r of rows.slice(0, +o.top)) console.log(`${r.meds[0].toFixed(1).padStart(7)} ${r.meds[1].toFixed(1).padStart(7)} ${(r.d >= 0 ? "+" : "") + r.d.toFixed(1).padStart(6)}  ${r.f}`);

// native-bench.mjs's `frames` and `framecounts` phases: the frame rig for the app's own UI (not web pages).
//
// `frames` runs one hidden instance of the big seed (200 tabs, two profiles) with nnframes.m loaded (a CADisplayLink of the
// window's screen at its maximum rate, main-thread and JS-thread run-loop busy time, layout passes). It drives each
// interaction of the four journeys N times and, for each, reads what the probe recorded between the interaction's start
// and the end of its window. Timings: run under the perflab lock.
// `framecounts` is the same list on an instance with the JS perf probe on (a `perf-probe` file), reading what does not
// depend on timing: React commits, host view updates, store updates, native layout passes, mount batches, UI blocks.
// Those are the counts the ratchet can gate (apps/browser/scripts/perf/frames-ratchet.json, `node frames-phase.mjs check`).
//
// Per interaction (a window of fixed length after its start), medians over the repetitions of every run:
//   frames                 display-link ticks delivered in the window (the window's length / the refresh interval is what the
//                          screen asked for)
//   >8.33 / >16.7          ticks that came more than 8.33 (16.7) + 2 ms after the previous one: a 120 Hz (60 Hz) frame the main
//                          thread did not deliver; on a 60 Hz screen every tick is over 8.33 and the column is meaningless
//   dropped                refresh intervals skipped (a 41.7 ms gap at 120 Hz is 4)
//   worst                  the longest gap between two ticks
//   main busy / worst      main-thread run-loop iterations (AfterWaiting → BeforeWaiting, past Core Animation's commit): their
//                          sum and the longest one. The longest is a stall; a single iteration over 8.33 ms always costs a frame.
//   JS busy / worst        the same on React Native's JS thread
//   layout ms              RCTUIManager layout passes (the shadow queue), their sum
// Counts: layoutPasses, mountBatches, uiBlocks, viewUpdates, viewCreates (native); commits, hostUpdates, renders, storeUpdates,
// tasks (JS probe, `framecounts` only).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// scripts/agent/cpu-cap keeps our processes on background QoS (efficiency cores) and SIGSTOPs the busiest while the Mac is
// over its cap. Frame timings from a run it touched are invalid: its log says when it paused one of this run's processes.
const CAP_LOG = process.env.NN_CPU_CAP_LOG ?? "/private/tmp/claude-501/-Users-barreloflube-Documents-netnyahoo/a6e87140-35e6-4a65-85e0-018a5c019c75/scratchpad/cpu-cap.log";
const capRunning = () => spawnSync("pgrep", ["-f", "scripts/agent/cpu-cap"]).status === 0;
const capSize = () => {
  try {
    return readFileSync(CAP_LOG).length;
  } catch {
    return 0;
  }
};
// Pauses of the app (its copy's path, or its pid) since `from` bytes.
const capPauses = (from, app, pid) => {
  try {
    return readFileSync(CAP_LOG, "utf8").slice(from).split("\n").filter((l) => l.includes(": paused ") && (l.includes(app) || new RegExp(`paused ${pid} `).test(l))).length;
  } catch {
    return 0;
  }
};

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The probe library (nnframes.m), built like the marker library.
export function framesLibrary(toolDir, here) {
  const lib = join(toolDir, "nnframes.dylib");
  const src = join(here, "nnframes.m");
  if (!existsSync(lib) || readFileSync(src, "utf8") !== (existsSync(lib + ".src") ? readFileSync(lib + ".src", "utf8") : "")) {
    execFileSync("clang", ["-dynamiclib", "-fobjc-arc", "-framework", "AppKit", "-framework", "QuartzCore", "-arch", "arm64", src, "-o", lib], { stdio: "inherit" });
    execFileSync("codesign", ["--force", "--sign", "-", lib]);
    writeFileSync(lib + ".src", readFileSync(src, "utf8"));
  }
  return lib;
}

// What the probe wrote, read incrementally.
class Records {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.tail = "";
    this.f = [];
    this.m = [];
    this.j = [];
    this.l = [];
    this.keys = [];
    this.info = null;
  }
  read() {
    let text;
    try {
      const buf = readFileSync(this.file);
      text = this.tail + buf.subarray(this.offset).toString("utf8");
      this.offset = buf.length;
    } catch {
      return this;
    }
    const lines = text.split("\n");
    this.tail = lines.pop();
    for (const line of lines) {
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (r.k === "f") this.f.push(r);
      else if (r.k === "r") (r.th === "m" ? this.m : this.j).push(r);
      else if (r.k === "l") this.l.push(r);
      else if (r.k === "key") this.keys.push(r);
      else if (r.k === "info") this.info = r;
    }
    return this;
  }
}

// What happened in [a, b] (epoch ms). `refresh` is one refresh interval of the screen.
export function windowStats(rec, a, b, refresh) {
  const ticks = rec.f;
  const gaps = [];
  let late = 0;
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i].ts < a || ticks[i].ts > b) continue;
    gaps.push(ticks[i].ts - ticks[i - 1].ts);
    late = Math.max(late, ticks[i].now - ticks[i].ts);
  }
  const busy = (list) => {
    let sum = 0, worst = 0, over = 0;
    for (const r of list) {
      const s = Math.max(r.a, a), e = Math.min(r.a + r.d, b);
      if (e > s) sum += e - s;
      if (r.a >= a && r.a <= b) {
        worst = Math.max(worst, r.d);
        if (r.d > 8.33) over++;
      }
    }
    return { sum, worst, over };
  };
  const m = busy(rec.m), j = busy(rec.j);
  const l = rec.l.filter((r) => r.a >= a && r.a <= b);
  return {
    frames: gaps.length,
    over8: gaps.filter((g) => g > 8.33 + 2).length,
    over16: gaps.filter((g) => g > 16.7 + 2).length,
    dropped: gaps.reduce((n, g) => n + Math.max(0, Math.round(g / refresh) - 1), 0),
    worst: gaps.length ? Math.max(...gaps) : NaN,
    late,
    mainBusy: m.sum,
    mainWorst: m.worst,
    mainOver8: m.over,
    jsBusy: j.sum,
    jsWorst: j.worst,
    layoutMs: l.reduce((n, r) => n + r.d, 0),
  };
}

// The interactions, in the order they run. window: how long after its start the frames are read.
// Each `go(c)` starts the interaction and returns its start (epoch ms, the interaction's own clock); `after(c)` puts the app back.
function interactions(c) {
  const { app, key, sleep, run, W, probe, base } = c;
  const seedTab = `(() => { const s = nn.store.getState(); return Object.keys(s.tabs).find((id) => s.tabs[id].url.includes("id=seed")); })()`;
  const reset = () => run(`const s = nn.store.getState(); const w = ${W};
    if (s.windowUi[w]?.panel.open) s.closePanel(w);
    for (const id of s.windows[w].tabIds) if (!s.tabs[id].url && s.windows[w].tabIds.length > 1) nn.store.getState().closeTab(id);
    const seed = ${seedTab}; if (seed && s.windows[w].activeTabId !== seed) nn.store.getState().activate(seed);
    return true;`);
  const store = (code) => run(`globalThis.nnPerf?.reset(); const t = nn.now(); ${code}; return t;`);
  let k = 0;
  return [
    { name: "idle (no interaction)", window: 1500, go: async () => Date.now() },
    { name: "command bar open (⌘T)", window: 600, go: () => key("cmd+t"), after: async () => { await sleep(900); } },
    { name: "command bar close (Esc)", window: 600, before: () => key.open("cmd+t"), go: () => key("esc"), after: reset },
    { name: "command bar open (⌘L)", window: 600, before: reset, go: () => key("cmd+l"), after: async () => { await sleep(900); } },
    { name: "command bar close (Esc, from ⌘L)", window: 600, before: async () => { await reset(); await key.open("cmd+l"); }, go: () => key("esc"), after: reset },
    { name: "tab switch", window: 500, before: reset, go: () => run(`globalThis.nnPerf?.reset(); const t = nn.now(); const s = nn.store.getState(); const w = ${W};
        const ids = s.windows[w].tabIds.filter((id) => !s.tabs[id].pinned); const id = ids[(${k++} * 7 + 3) % ids.length];
        nn.actions.switchToTab(id); return t;`) },
    { name: "sidebar collapse", window: 800, before: reset, go: () => store(`nn.store.getState().toggleSidebar(${W})`) },
    { name: "sidebar expand", window: 800, go: () => store(`nn.store.getState().toggleSidebar(${W})`), after: () => sleep(300) },
    { name: "profile swipe (next profile)", window: 1200, before: reset, go: () => store(`nn.runCommand({ command: "nextProfile", arg: null, windowId: ${W} })`), after: () => sleep(600) },
    { name: "profile swipe (previous profile)", window: 1200, go: () => store(`nn.runCommand({ command: "previousProfile", arg: null, windowId: ${W} })`), after: () => sleep(600) },
    { name: "sidebar scroll (200 tabs, flick down and back)", window: 2300, before: reset,
      go: async () => { await run(`globalThis.nnPerf?.reset(); return 1;`); const t = Date.now(); await probe("scroll", { distance: 4000, seconds: 1, back: true }, false); return t; } },
    { name: "sidebar hover (20 rows, 60 ms apart)", window: 1500, before: reset, go: async () => { await run(`globalThis.nnPerf?.reset(); return 1;`); const t = Date.now(); await probe("hover", { rows: 20, gapMs: 60 }, false); return t; } },
    { name: "new window", window: 1200, before: reset,
      go: () => store(`nn.actions.openWindow({ url: "${base()}/static?id=fw${k++}" })`),
      after: async () => { await sleep(1500); await run(`const s = nn.store.getState(); for (const id of s.windowOrder) if (s.windows[id] && id !== ${W} && !s.windows[id].kind) nn.store.getState().closeWindow(id); return true;`); await sleep(1500); } },
  ];
}

export async function framesRun(c, side, i, { counts }) {
  const { Instance, freshDir, nnperf, sleep, log, WINDOW, base, opt, toolDir } = c;
  const display = JSON.parse(nnperf("display").out || "{}");
  if (display.asleep || display.locked) {
    log(`${side.tag}frames ${i}: the display is ${display.asleep ? "asleep" : "locked"}; macOS gives no frames then, skipped`);
    side.results.frames.push({ skipped: display.asleep ? "display asleep" : "screen locked", counts });
    return;
  }
  const dir = freshDir(side, `frames-${i}${counts ? "c" : ""}`);
  if (counts) writeFileSync(join(dir, "perf-probe"), "");
  const app = new Instance(side, dir);
  app.frames = true;
  app.env.push("NN_BENCH_FRAMES=1");
  const rec = new Records(join(dir, "bench-frames.jsonl"));
  const run = (code) => app.run(code);
  let seq = 0;
  // A probe command (nnframes.m): answered when done; a driver (scroll, hover) answers when its last tick has run, and
  // wait = false returns as soon as the command is written (the window is read after the interaction's length).
  const probe = async (op, args = {}, wait = true) => {
    const id = `f${++seq}-${Date.now()}`;
    writeFileSync(join(dir, "bench-frames-cmd.json"), JSON.stringify({ id, op, ...args }));
    if (!wait) return { id };
    const r = await app.waitFile("bench-frames-result.json", 15_000, (v) => v.id === id);
    if (!r?.ok) throw new Error(`probe ${op}: ${JSON.stringify(r)}`);
    return r;
  };
  // A real key event; retried until the app's event loop saw it (CGEventPostToPid drops about one in ten).
  const key = async (spec) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = nnperf("postkeys", String(app.pid), "0", spec);
      const press = JSON.parse(r.out.split("\n").filter(Boolean)[0]);
      for (const end = Date.now() + 1000; Date.now() < end; await sleep(15)) {
        const seen = rec.read().keys.find((x) => x.made >= press.at - 5 && x.made < press.at + 400);
        if (seen) return seen.made;
      }
    }
    throw new Error(`key ${spec} never arrived`);
  };
  // For a before-step that needs the bar open: press, then give it its animation.
  key.open = async (spec) => {
    await key(spec);
    await sleep(900);
  };
  const capFrom = capSize();
  const out = { info: null, display, counts, interactions: {}, load: [Math.round(c.loadavg()[0])], cpuCap: { running: capRunning(), pauses: 0 } };
  const counters = () => probe("counters");
  const jsCounts = () => run(`const p = globalThis.nnPerf?.read(); if (!p) return null; const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    return { commits: p.commits, hostUpdates: p.hostUpdates, renders: sum(p.renders), storeUpdates: sum(p.storeUpdates), tasks: sum(p.tasks) };`);
  try {
    await app.launch();
    await app.pageState("id=seed", 30_000, (s) => s.fcp);
    await sleep(8000);
    for (const end = Date.now() + 10_000; !rec.read().info && Date.now() < end; ) await sleep(100);
    if (!rec.info) throw new Error("the frame probe didn't start (no display link)");
    const info = await probe("info");
    out.info = { screen: info.screen, maxFPS: info.maxFPS, js: info.js };
    const refresh = 1000 / info.maxFPS;
    log(`${side.tag}frames ${i}${counts ? " (counts)" : ""}: ${info.screen} ${info.maxFPS} Hz, JS thread ${info.js ? "observed" : "NOT found"}`);
    const reps = counts ? Math.min(3, +opt["frames-n"]) : +opt["frames-n"];
    const list = interactions({ app, key, sleep, run, W: WINDOW, probe, base });
    for (const it of list) {
      const rows = [];
      // Stats are computed once the interaction's reps are done: a run-loop iteration that outlasted its window is written
      // when it ends, and counts for nothing before that.
      const taken = [];
      for (let rep = 0; rep < (it.name.startsWith("idle") ? 2 : reps); rep++) {
        try {
          if (it.before) await it.before();
          await sleep(900);
          const c0 = await counters();
          const t0 = await it.go();
          await sleep(it.window + 250);
          const c1 = await counters();
          const extra = {};
          for (const n of ["layoutPasses", "mountBatches", "uiBlocks", "viewUpdates", "viewCreates"]) extra[n] = c1[n] - c0[n];
          if (counts) Object.assign(extra, await jsCounts());
          taken.push({ t0, extra });
        } catch (error) {
          log(`${side.tag}frames ${i} ${it.name} #${rep}: lost (${String(error.message ?? error).slice(0, 160)})`);
        }
        if (it.after) await it.after().catch(() => {});
      }
      await sleep(2500);
      rec.read();
      for (const { t0, extra } of taken) {
        const stats = { ...windowStats(rec, t0, t0 + it.window, refresh), ...extra, expected: Math.round(it.window / refresh) };
        // A window with no ticks at all: the display went off or the screen locked meanwhile.
        if (stats.frames) rows.push(stats);
      }
      out.interactions[it.name] = rows;
      log(`${side.tag}frames ${i} ${it.name}: ${rows.length} reps, frames ${median(rows.map((r) => r.frames))}, >8.33 ${median(rows.map((r) => r.over8))}, worst ${median(rows.map((r) => r.worst)).toFixed?.(1)} ms, main worst ${median(rows.map((r) => r.mainWorst)).toFixed?.(1)} ms`);
    }
    const after = JSON.parse(nnperf("display").out || "{}");
    out.displayAfter = after;
    out.cpuCap.pauses = capPauses(capFrom, app.app, app.pid);
    out.cpuCap.running ||= capRunning();
    out.load.push(Math.round(c.loadavg()[0]));
    side.results.frames.push(out);
  } finally {
    await app.done();
  }
}

// Summary rows (native-bench's table) from side.results.frames, and the markdown table the docs quote.
const METRICS = [
  ["frames", "frames delivered", "", 0],
  ["over8", "ticks over 8.33 ms", "", 0],
  ["over16", "ticks over 16.7 ms", "", 0],
  ["dropped", "refresh intervals skipped", "", 0],
  ["worst", "worst frame", "ms", 1],
  ["mainBusy", "main thread busy", "ms", 1],
  ["mainWorst", "main thread longest stall", "ms", 1],
  ["jsBusy", "JS thread busy", "ms", 1],
  ["jsWorst", "JS thread longest task", "ms", 1],
  ["layoutPasses", "layout passes", "", 0],
  ["mountBatches", "mount batches", "", 0],
  ["uiBlocks", "UI blocks run", "", 0],
  ["viewUpdates", "view updates sent by JS", "", 0],
  ["commits", "React commits", "", 0],
  ["hostUpdates", "React host updates", "", 0],
  ["renders", "React renders", "", 0],
  ["storeUpdates", "store updates", "", 0],
];
const SHOWN = new Set(["frames", "over8", "over16", "worst", "mainBusy", "mainWorst", "jsBusy", "layoutPasses", "commits", "hostUpdates"]);

export function frameRows(results) {
  const runs = (results.frames ?? []).filter((r) => !r.skipped);
  const rows = [];
  const skipped = (results.frames ?? []).length - runs.length;
  if (skipped) rows.push({ name: "frames: runs skipped (display asleep or screen locked)", median: skipped, min: skipped, max: skipped, n: skipped, unit: "", digits: 0 });
  if (!runs.length) return rows;
  const capped = runs.filter((r) => r.cpuCap?.running).length, paused = runs.filter((r) => r.cpuCap?.pauses).length;
  if (capped) rows.push({ name: "frames: runs under scripts/agent/cpu-cap (background QoS: efficiency cores, absolute numbers read worse)", median: capped, min: capped, max: capped, n: runs.length, unit: "", digits: 0 });
  if (paused) rows.push({ name: "frames: runs cpu-cap PAUSED the instance in (timings invalid)", median: paused, min: paused, max: paused, n: runs.length, unit: "", digits: 0 });
  const first = runs.find((r) => r.info);
  if (first) rows.push({ name: `frames: screen ${first.info.screen}, maximum refresh rate (Hz)`, median: first.info.maxFPS, min: first.info.maxFPS, max: first.info.maxFPS, n: runs.length, unit: "Hz", digits: 0 });
  const names = [...new Set(runs.flatMap((r) => Object.keys(r.interactions)))];
  for (const name of names)
    for (const [key, label, unit, digits] of METRICS) {
      if (!SHOWN.has(key)) continue;
      // One value per run: the median of its repetitions (a count that only the counts runs have is left out when none has it).
      const perRun = runs.map((r) => median((r.interactions[name] ?? []).map((x) => x[key]))).filter(Number.isFinite);
      if (!perRun.length) continue;
      rows.push({ name: `frames ${name}: ${label}`, median: median(perRun), min: Math.min(...perRun), max: Math.max(...perRun), n: perRun.length, unit, digits });
    }
  return rows;
}

// The table per interaction, one column per app (labels), medians over every repetition of every run.
export function frameTable(resultsByLabel) {
  const labels = Object.keys(resultsByLabel);
  const keys = ["frames", "over8", "over16", "worst", "mainBusy", "mainWorst", "jsBusy", "jsWorst", "layoutPasses", "mountBatches", "uiBlocks", "commits", "hostUpdates"];
  const names = [...new Set(labels.flatMap((l) => (resultsByLabel[l].frames ?? []).flatMap((r) => Object.keys(r.interactions ?? {}))))];
  const out = [];
  out.push(`| Interaction | App | ${keys.map((k) => METRICS.find((m) => m[0] === k)[1]).join(" | ")} |`);
  out.push(`|---|---|${keys.map(() => "---").join("|")}|`);
  for (const name of names)
    for (const label of labels) {
      const reps = (resultsByLabel[label].frames ?? []).filter((r) => !r.skipped).flatMap((r) => r.interactions[name] ?? []);
      const cell = (k) => {
        const v = median(reps.map((x) => x[k]));
        return Number.isFinite(v) ? (METRICS.find((m) => m[0] === k)[3] ? v.toFixed(1) : Math.round(v)) : "";
      };
      out.push(`| ${name} | ${label} | ${keys.map(cell).join(" | ")} |`);
    }
  return out.join("\n");
}

// `node frames-phase.mjs table <results.json>...`: the markdown table of saved results (labels from each file's meta).
if (process.argv[1] && process.argv[1].endsWith("frames-phase.mjs")) {
  const [cmd, ...files] = process.argv.slice(2);
  if (cmd === "table") {
    const by = {};
    for (const f of files) {
      const r = JSON.parse(readFileSync(f, "utf8"));
      by[r.meta?.label ?? f] = r;
    }
    console.log(frameTable(by));
  } else {
    console.error("usage: frames-phase.mjs table <results.json>...");
    process.exit(64);
  }
}

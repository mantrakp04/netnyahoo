// Scenarios only ratchet.mjs needs, loaded after bench-app.js (js-bench.mjs --lib bench-app.js,ratchet-app.js). Runs
// inside the app like bench-app.js: the dev harness evaluates it as `function (nn) { … }`.

const P = globalThis.nnPerf;
const bench = globalThis.nnBench;
if (!P || !bench) throw new Error("load bench-app.js first (and turn the perf probe on)");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);

const extra = {
  // All the work of the launch, read once it has stopped. `startup` reads the probe when the first window is up,
  // which is a race against the rest of the launch (restore, favicons, history); the probe isn't reset before it, so
  // this read, after commits, store updates and document writes have all been still for quietMs, is the same every time.
  async launch({ quietMs = 2500, timeoutMs = 30000 } = {}) {
    const state = () => {
      const s = P.read();
      return `${s.commits}:${sum(s.storeUpdates)}:${sum(s.writes)}`;
    };
    const end = Date.now() + timeoutMs;
    let last = state();
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(250);
      const now = state();
      if (now !== last) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since >= quietMs) break;
    }
    // firstCommitMounts: what the first React commit mounted (the probe records it; absent in older bundles).
    return { stats: P.read(), settled: Date.now() < end, firstCommitMounts: P.firstCommitMounts ?? null };
  },
};

bench.names.push(...Object.keys(extra));
const run = bench.run;
bench.run = (name, options) => (name in extra ? extra[name](options ?? {}) : run(name, options));
return bench.names;

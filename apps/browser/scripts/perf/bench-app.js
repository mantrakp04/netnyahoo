// Runs inside the app (the dev harness evaluates it as `function (nn) { … }`) and installs
// globalThis.nnBench: the benchmark's scenarios. Each one resets the probe (src/lib/perfProbe.ts),
// drives the app the way its native events would (inside a React batch), and returns timings plus
// the probe's counters. js-bench.mjs loads it and calls nnBench.run(name, options).

const P = globalThis.nnPerf;
if (!P) throw new Error("perf probe is off (no perf-probe file in the data folder)");
const store = nn.store;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const S = () => store.getState();
const windowId = () => S().ui.focusedWindowId;
const activeId = () => {
  const s = S();
  const w = s.windows[windowId()];
  return w.activeTabIds[w.profileId];
};

// The time one batched update takes on the JS thread: store update, selectors, render, commit, layout effects.
function timed(fn) {
  const t = P.now();
  P.batch(fn);
  return P.now() - t;
}

async function until(test, timeoutMs, step = 25) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(step);
  }
  return false;
}

async function quiet(ms = 400) {
  await until(() => !S().live[activeId()]?.isLoading, 8000);
  await sleep(ms);
}

function hostOf(fiber) {
  for (let f = fiber.child; f; f = f.child) if (f.tag === 5) return f;
  return null;
}

const scenarios = {
  async startup() {
    await until(() => P.marks.firstWindow, 20000);
    const info = nn.shell.systemInfo();
    const read = P.read();
    return { marks: { ...P.marks, processStart: info.processStart ?? null, firstCommit: P.firstCommit }, stats: read };
  },

  async idle({ seconds = 10 } = {}) {
    await quiet(1000);
    P.reset();
    await sleep(seconds * 1000);
    return { stats: P.read() };
  },

  async typing({ query = "github.com/facebook/react/pull", gapMs = 60 } = {}) {
    const w = windowId();
    await quiet();
    S().closePanel(w);
    await sleep(200);
    S().openPanel(w);
    const id = `${w}:panel`;
    if (!(await until(() => nn.omnibox.get(id), 3000))) throw new Error("omnibox driver missing");
    await sleep(500);
    const driver = nn.omnibox.get(id);
    P.reset();
    const keys = [];
    for (let i = 1; i <= query.length; i++) {
      keys.push(timed(() => driver.type(query.slice(0, i))));
      await sleep(gapMs);
    }
    const stats = P.read();
    const items = driver.state().items.length;
    S().closePanel(w);
    await sleep(200);
    return { keys, items, stats };
  },

  async switchTabs({ count = 12 } = {}) {
    const w = windowId();
    const s = S();
    const view = s.windows[w].tabIds.filter((id) => s.tabs[id].profileId === s.windows[w].profileId && !s.tabs[id].pinned);
    const ids = view.slice(30, 30 + count);
    const start = activeId();
    // First pass wakes the tabs (each loads its page); the measured pass switches between loaded tabs.
    for (const id of ids) {
      timed(() => {
        S().setSelection(w, []);
        S().activate(id);
      });
      await sleep(250);
    }
    await quiet();
    P.reset();
    const steps = [];
    for (const id of ids) {
      steps.push(
        timed(() => {
          S().setSelection(w, []);
          S().activate(id);
        }),
      );
      await sleep(150);
    }
    const stats = P.read();
    timed(() => S().activate(start));
    await quiet();
    return { steps, stats };
  },

  async openClose({ count = 20, origin } = {}) {
    const w = windowId();
    await quiet();
    P.reset();
    const open = [];
    const ids = [];
    for (let i = 0; i < count; i++) {
      let id;
      open.push(timed(() => (id = S().newTab(w, { url: `${origin}/p/new-${i}-${Date.now()}` }))));
      ids.push(typeof id === "string" ? id : id?.id ?? activeId());
      await sleep(150);
    }
    await quiet();
    const openStats = P.read();
    P.reset();
    const close = [];
    for (const id of ids.reverse()) {
      close.push(timed(() => S().closeTab(id)));
      await sleep(150);
    }
    await sleep(500);
    return { open, close, openStats, closeStats: P.read() };
  },

  async scroll({ distance = 2400, steps = 60 } = {}) {
    await quiet();
    const page = P.findFibers("SidebarPage").find((f) => f.memoizedProps?.current);
    if (!page) throw new Error("no current SidebarPage");
    let scroller = null;
    const visit = (f) => {
      for (let c = f; c && !scroller; c = c.sibling) {
        if (c.stateNode && typeof c.stateNode.scrollTo === "function") scroller = c.stateNode;
        else visit(c.child);
      }
    };
    visit(page.child);
    if (!scroller) throw new Error("no ScrollView");
    scroller.scrollTo({ y: 0, animated: false });
    await sleep(300);
    P.reset();
    for (let i = 1; i <= steps; i++) {
      scroller.scrollTo({ y: (distance * i) / steps, animated: false });
      await sleep(16);
    }
    for (let i = steps - 1; i >= 0; i--) {
      scroller.scrollTo({ y: (distance * i) / steps, animated: false });
      await sleep(16);
    }
    await sleep(300);
    return { stats: P.read() };
  },

  async pageLoad({ origin, runs = 3 } = {}) {
    const results = [];
    for (let r = 0; r < runs; r++) {
      await quiet(600);
      const tab = activeId();
      P.reset();
      const t0 = Date.now();
      timed(() => S().navigate(tab, `${origin}/heavy?run=${r}-${Date.now()}`));
      await until(() => S().live[tab]?.isLoading, 3000, 5);
      await until(() => !S().live[tab]?.isLoading, 15000, 10);
      const loadMs = Date.now() - t0;
      await sleep(1000);
      results.push({ loadMs, stats: P.read() });
    }
    return { runs: results };
  },

  async hover({ rows = 24, gapMs = 60 } = {}) {
    await quiet();
    const fibers = P.findFibers("TabRow", 400).filter((f) => f.alternate || true);
    const hosts = fibers.map(hostOf).filter((h) => h && typeof h.memoizedProps?.onMouseEnter === "function");
    const list = hosts.slice(8, 8 + rows);
    if (list.length < 2) throw new Error(`only ${list.length} hoverable rows`);
    P.reset();
    const steps = [];
    let prev = null;
    for (const h of list) {
      steps.push(
        timed(() => {
          prev?.memoizedProps.onMouseLeave?.({ nativeEvent: {} });
          h.memoizedProps.onMouseEnter({ nativeEvent: {} });
        }),
      );
      prev = h;
      await sleep(gapMs);
    }
    steps.push(timed(() => prev.memoizedProps.onMouseLeave?.({ nativeEvent: {} })));
    await sleep(800);
    return { steps, stats: P.read() };
  },

  async profileSwipe({ settleMs = 1500 } = {}) {
    const w = windowId();
    await quiet();
    const out = [];
    for (const command of ["nextProfile", "previousProfile"]) {
      P.reset();
      const ms = timed(() => nn.runCommand({ command, arg: null, windowId: w }));
      await sleep(settleMs);
      out.push({ command, ms, profile: S().windows[w].profileId, stats: P.read() });
    }
    return { runs: out };
  },

  async persistence() {
    const s = S();
    const time = (value) => {
      const t = P.now();
      const json = JSON.stringify(value);
      return { ms: P.now() - t, bytes: json.length };
    };
    const tabs = Object.values(s.tabs);
    return {
      history: time({ version: 2, history: s.history }),
      bookmarks: time({ version: 2, bookmarks: s.bookmarks }),
      session: time({ version: 2, profiles: s.profiles, settings: s.settings, windows: Object.values(s.windows), tabs, groups: Object.values(s.groups), closedTabs: s.closedTabs, closedWindows: s.closedWindows }),
      counts: { tabs: tabs.length, history: Object.values(s.history).reduce((n, h) => n + h.length, 0), bookmarks: Object.keys(s.bookmarks.nodes).length },
    };
  },
};

// Hermes' runtime compiler takes async methods but not async arrows.
scenarios.traced = function ({ scenario, ...options }) {
  P.traceTimers = true;
  return scenarios[scenario](options).finally(() => (P.traceTimers = false));
};

globalThis.nnBench = {
  names: Object.keys(scenarios),
  run: (name, options) => scenarios[name](options ?? {}),
};
return globalThis.nnBench.names;

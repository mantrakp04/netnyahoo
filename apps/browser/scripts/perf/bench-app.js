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

// Waits until the app has written nothing for `quietMs` (longer than its longest save delay: 2 s for the
// bookmarks cache, 0.8 s for the session), so an idle window doesn't catch saves left over from startup.
async function writesSettled(quietMs = 3000, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    P.reset();
    await sleep(quietMs);
    if (!Object.keys(P.read().writes).length) return true;
  }
  return false;
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
    await writesSettled();
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
    // Session saves are throttled (lib/persist.ts: the first change starts an 800 ms timer). One left from the first
    // pass, or the measured pass's last window still open when the counts are read, made `writes` land at 2 or 3. So
    // the pass starts with no save pending, and its writes are read once the last window has closed: every save the
    // switches caused, and nothing else (the other counts are read as the pass ends, as before).
    await writesSettled(1200, 10000);
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
    await sleep(1200);
    const saved = P.read();
    stats.writes = saved.writes;
    stats.writeBytes = saved.writeBytes;
    stats.writeMs = saved.writeMs;
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

  async hover({ rows = 24, gapMs = 60, from = 8 } = {}) {
    await quiet();
    const fibers = P.findFibers("TabRow", 400).filter((f) => f.alternate || true);
    const hosts = fibers.map(hostOf).filter((h) => h && typeof h.memoizedProps?.onMouseEnter === "function");
    const list = hosts.slice(from, from + rows);
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

  // What one store update costs when nothing on screen depends on it (a background tab's load state flipping;
  // progress isn't a store field since 33e88e6f): every subscribed selector runs, React bails out.
  async storeUpdate({ count = 60 } = {}) {
    await quiet();
    const s = S();
    const w = windowId();
    const bg = s.windows[w].tabIds.find((id) => id !== activeId() && s.live[id] && !s.tabs[id].pinned);
    P.reset();
    const steps = [];
    for (let i = 0; i < count; i++) {
      steps.push(timed(() => S().updateLive(bg, { isLoading: i % 2 === 0 })));
      await sleep(5);
    }
    timed(() => S().updateLive(bg, { isLoading: false }));
    return { steps, stats: P.read() };
  },

  async idleLate({ waitSeconds = 20, seconds = 10 } = {}) {
    await sleep(waitSeconds * 1000);
    return scenarios.idle({ seconds });
  },

  // Which tab is active after each store update while tabs open (finds activation ping-pong).
  async activeTrail({ count = 4, origin } = {}) {
    const w = windowId();
    await quiet();
    const trail = [];
    const t0 = Date.now();
    let last = activeId();
    const stop = store.subscribe((st, prev) => {
      const now = activeId();
      if (now !== last) trail.push({ t: Date.now() - t0, from: last, to: now });
      last = now;
      const a = st.windows[w];
      const b = prev.windows[w];
      if (a !== b && a && b) {
        const fields = Object.keys(a).filter((k) => a[k] !== b[k]);
        if (!fields.includes("activeTabIds") || now === activeId()) trail.push({ t: Date.now() - t0, window: fields.join(",") });
      }
    });
    const opened = [];
    for (let i = 0; i < count; i++) {
      trail.push({ t: Date.now() - t0, open: i });
      timed(() => opened.push(S().newTab(w, { url: `${origin}/p/trail-${i}-${Date.now()}` })));
      await sleep(600);
    }
    await sleep(1000);
    stop();
    for (const id of opened) if (typeof id === "string") S().closeTab(id);
    return { opened, trail };
  },

  // Opening tabs while every switch costs `slowMs` of JS (as renders did with 200 tabs before the sidebar was
  // memoized): counts activations, to catch Chrome's late reports switching back and forth.
  async slowOpen({ count = 10, slowMs = 100, gapMs = 300, origin } = {}) {
    const w = windowId();
    await quiet();
    const stop = store.subscribe((s, prev) => {
      if (s.windows === prev.windows) return;
      const end = P.now() + slowMs;
      while (P.now() < end);
    });
    let switches = 0;
    const count0 = store.subscribe((s, prev) => {
      const a = s.windows[w]?.activeTabIds[s.windows[w].profileId];
      const b = prev.windows[w]?.activeTabIds[prev.windows[w].profileId];
      if (a !== b) switches++;
    });
    const opened = [];
    for (let i = 0; i < count; i++) {
      timed(() => opened.push(S().newTab(w, { url: `${origin}/p/slow-${i}-${Date.now()}` })));
      await sleep(gapMs);
    }
    await sleep(3000);
    stop();
    count0();
    const settledSwitches = switches;
    for (const id of opened) if (typeof id === "string") S().closeTab(id);
    return { opened: opened.length, switches: settledSwitches };
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

Object.assign(scenarios, renderScenarios());
Object.assign(scenarios, censusScenarios());

// Hermes' runtime compiler takes async methods but not async arrows.
scenarios.traced = function ({ scenario, ...options }) {
  P.traceTimers = true;
  return scenarios[scenario](options).finally(() => (P.traceTimers = false));
};

// The render benchmark's interactions (render-bench.mjs, a 20-tab session): each settles, resets the probe, acts
// and reads what rendered until things settle again. The ones a page drives (scrolling, media) are `mark` and
// `read` around the host's CDP calls.
function renderScenarios() {
  const tabsInView = () => {
    const s = S();
    const w = s.windows[windowId()];
    return w.tabIds.filter((id) => s.tabs[id]?.profileId === w.profileId);
  };
  const settle = (ms = 1500) => sleep(ms).then(() => P.read());
  return {
    async mark({ settleMs = 0 } = {}) {
      if (settleMs) await quiet(settleMs);
      P.reset();
      return true;
    },
    async read({ settleMs = 1000 } = {}) {
      return { stats: await settle(settleMs) };
    },
    async wake({ gapMs = 400 } = {}) {
      const start = activeId();
      for (const id of tabsInView()) {
        timed(() => S().activate(id));
        await sleep(gapMs);
      }
      timed(() => S().activate(start));
      await quiet(1000);
      return tabsInView().filter((id) => S().live[id]).length;
    },
    async tabSwitch({ count = 10, gapMs = 300 } = {}) {
      const s = S();
      const ids = tabsInView().filter((id) => !s.tabs[id].pinned).slice(0, count);
      const start = activeId();
      await quiet(800);
      P.reset();
      const steps = [];
      for (const id of ids) {
        steps.push(timed(() => S().activate(id)));
        await sleep(gapMs);
      }
      const stats = await settle(800);
      timed(() => S().activate(start));
      await quiet(800);
      return { steps, stats };
    },
    async openCloseTab({ count = 5, origin, gapMs = 400 } = {}) {
      const w = windowId();
      await quiet(800);
      P.reset();
      const ids = [];
      const open = [];
      for (let i = 0; i < count; i++) {
        let id;
        open.push(timed(() => (id = S().newTab(w, { url: `${origin}/p/r-${i}-${Date.now()}` }))));
        ids.push(typeof id === "string" ? id : activeId());
        await sleep(gapMs);
      }
      const openStats = await settle(1000);
      P.reset();
      const close = [];
      for (const id of ids.reverse()) {
        close.push(timed(() => S().closeTab(id)));
        await sleep(gapMs);
      }
      return { open, close, openStats, closeStats: await settle(1000) };
    },
    async typeIn({ bar = "panel", query = "github.com/facebook/react", gapMs = 60, origin } = {}) {
      const w = windowId();
      await quiet(600);
      let tab = null;
      if (bar === "panel") S().openPanel(w);
      else tab = S().newTab(w);
      const id = `${w}:${bar}`;
      if (!(await until(() => nn.omnibox.get(id), 4000))) throw new Error(`no omnibox driver ${id}`);
      await sleep(800);
      const driver = nn.omnibox.get(id);
      P.reset();
      const keys = [];
      for (let i = 1; i <= query.length; i++) {
        keys.push(timed(() => driver.type(query.slice(0, i))));
        await sleep(gapMs);
      }
      const stats = await settle(600);
      if (bar === "panel") S().closePanel(w);
      else if (typeof tab === "string") S().closeTab(tab);
      await sleep(400);
      return { keys, stats };
    },
    // Opens a page in a background tab (title ticker, media) and returns its id.
    async openBackground({ path, origin, settleMs = 2500 } = {}) {
      const w = windowId();
      const id = S().newTab(w, { url: `${origin}${path}`, background: true });
      await sleep(settleMs);
      return typeof id === "string" ? id : null;
    },
    async openActive({ path, origin, settleMs = 2000 } = {}) {
      const w = windowId();
      const id = S().newTab(w, { url: `${origin}${path}` });
      await quiet(settleMs);
      return typeof id === "string" ? id : null;
    },
    async closeTab({ id } = {}) {
      if (id && S().tabs[id]) S().closeTab(id);
      await sleep(400);
      return true;
    },
    // A background tab loading a page (progress, title, favicon, loading state): only its row should render.
    async bgLoad({ origin } = {}) {
      await quiet(800);
      const s = S();
      const id = tabsInView().find((t) => t !== activeId() && !s.tabs[t].pinned && s.live[t]);
      if (!id) throw new Error("no loaded background tab");
      P.reset();
      S().navigate(id, `${origin}/heavy?run=bg-${Date.now()}`);
      return { stats: await settle(4000) };
    },
    async idleFor({ seconds = 60 } = {}) {
      await quiet(1500);
      await writesSettled();
      P.reset();
      await sleep(seconds * 1000);
      return { stats: P.read() };
    },
    async split({ origin } = {}) {
      const w = windowId();
      await quiet(800);
      P.reset();
      const ms = timed(() => S().openSplitPane(w, { url: `${origin}/p/split-${Date.now()}` }));
      const stats = await settle(2000);
      const splitId = Object.keys(S().splits).find((k) => S().splits[k].windowId === w);
      P.reset();
      const closeMs = splitId ? timed(() => S().separateSplit(splitId)) : null;
      const closeStats = await settle(1500);
      return { ms, stats, closeMs, closeStats };
    },
    async sidebar() {
      const w = windowId();
      await quiet(800);
      P.reset();
      const ms = timed(() => S().toggleSidebar(w));
      const stats = await settle(1200);
      P.reset();
      const openMs = timed(() => S().toggleSidebar(w));
      const openStats = await settle(1200);
      return { ms, stats, openMs, openStats };
    },
    // A download's progress as the engine reports it (onDownload → upsertDownload), ten updates a second.
    async downloads({ updates = 40, gapMs = 100 } = {}) {
      const total = 50_000_000;
      const d = { id: `bench-${Date.now()}`, url: "http://127.0.0.1/file.zip", filename: "file.zip", path: "", state: "downloading", paused: false, received: 0, total, speed: 0, mimeType: "application/zip", profile: S().windows[windowId()].profileId };
      await quiet(800);
      P.reset();
      const steps = [];
      for (let i = 0; i <= updates; i++) {
        const received = Math.round((total * i) / updates);
        steps.push(timed(() => S().upsertDownload({ ...d, received, speed: 5_000_000, state: i === updates ? "complete" : "downloading" })));
        await sleep(gapMs);
      }
      const stats = await settle(1000);
      S().removeDownload(d.id);
      S().setDownloadsOpen(windowId(), false);
      await sleep(400);
      return { steps, stats };
    },
  };
}


// The render census's journeys (census.mjs, docs/perf/render-census.md). Each action is measured alone: reset the
// probe, act, settle, read; a scenario returns `per` (one summary per action) and `stats` (the actions' counters
// summed, for the offender tables).
function censusScenarios() {
  const total = (o) => Object.values(o ?? {}).reduce((a, b) => a + (typeof b === "number" ? b : 0), 0);
  const summary = (r, ms) => ({
    ms,
    commits: r.commits,
    renders: total(r.renders),
    wasted: total(r.wasted),
    hooks: total(r.hooks),
    hostUpdates: r.hostUpdates,
    storeUpdates: total(r.storeUpdates),
    subNotified: total(r.subNotified),
    selectors: total(r.selectorCalls),
    timers: total(r.timersScheduled),
    renderMs: total(r.renderMs),
    commitMs: r.commitMs,
    taskMs: total(r.taskMs),
  });
  const merge = (into, from) => {
    for (const key of Object.keys(from)) {
      const v = from[key];
      if (typeof v === "number") into[key] = (into[key] ?? 0) + v;
      else if (v && typeof v === "object" && !Array.isArray(v)) merge((into[key] ??= {}), v);
    }
    return into;
  };
  const SKIP = new Set(["commitTimes", "commitTaskLog", "taskLog", "since"]);
  // One measured action: probe reset, the action (batched, timed), a settle, the probe's counters.
  async function action(act, settleMs, sink) {
    P.reset();
    const ms = timed(act);
    await sleep(settleMs);
    const r = P.read();
    for (const k of SKIP) delete r[k];
    sink.per.push(summary(r, ms));
    merge(sink.stats, r);
    return r;
  }
  const sink = () => ({ per: [], stats: {} });
  const tabsInView = () => {
    const s = S();
    const w = s.windows[windowId()];
    return w.tabIds.filter((id) => s.tabs[id]?.profileId === w.profileId);
  };
  const run = (command, arg = null) => () => nn.runCommand({ command, arg, windowId: windowId() });
  // The command bar's variant: a floating panel, or the sidebar's dropdown with the address bar there.
  const panelId = (w) => `${w}:${S().settings.addressBar === "sidebar" ? "sidebar" : "panel"}`;
  async function driverOf(id) {
    if (!(await until(() => nn.omnibox.get(id), 4000))) throw new Error(`no omnibox driver ${id}`);
    await sleep(800);
    return nn.omnibox.get(id);
  }
  function untilStore(test, timeoutMs) {
    return new Promise((resolve) => {
      if (test(S())) return resolve(true);
      let timer;
      const off = store.subscribe((st) => {
        if (!test(st)) return;
        off();
        clearTimeout(timer);
        resolve(true);
      });
      timer = setTimeout(() => {
        off();
        resolve(false);
      }, timeoutMs);
    });
  }
  return {
    // The first window's counters since the bundle started (everything until the window was up).
    async cenStartup() {
      await until(() => P.marks.firstWindow, 20000);
      const r = P.read();
      for (const k of SKIP) delete r[k];
      return { per: [summary(r, 0)], stats: r, marks: { ...P.marks, firstCommit: P.firstCommit } };
    },
    // J2, Cmd-T: a blank tab with the new tab page's field.
    async cenNewTab({ count = 4 } = {}) {
      const out = sink();
      for (let i = 0; i < count; i++) {
        await quiet(500);
        let id;
        await action(() => {
          nn.runCommand({ command: "newTab", arg: null, windowId: windowId() });
          id = activeId();
        }, 900, out);
        await until(() => nn.omnibox.get(`${windowId()}:hero`), 3000);
        S().closeTab(id);
        await sleep(500);
      }
      return out;
    },
    // J2: keystrokes in the new tab page's field (per key), then the tab closed.
    async cenTypeHero({ query = "github.com/facebook/react", gapMs = 120 } = {}) {
      const w = windowId();
      await quiet(600);
      const id = S().newTab(w);
      const driver = await driverOf(`${w}:hero`);
      const out = sink();
      for (let i = 1; i <= query.length; i++) await action(() => driver.type(query.slice(0, i)), gapMs, out);
      if (typeof id === "string") S().closeTab(id);
      await sleep(400);
      return out;
    },
    // J2, Cmd-L: the command bar opens over a page, keystrokes, Esc closes it.
    async cenPanel({ query = "github.com/facebook/react", gapMs = 120, repeats = 3 } = {}) {
      const w = windowId();
      await quiet(600);
      const open = sink();
      const close = sink();
      const keys = sink();
      for (let r = 0; r < repeats; r++) {
        await action(run("focusCommandBar"), 900, open);
        const driver = await driverOf(panelId(w));
        if (r === 0) for (let i = 1; i <= query.length; i++) await action(() => driver.type(query.slice(0, i)), gapMs, keys);
        await action(() => driver.key("Escape"), 700, close);
        await quiet(300);
      }
      return { open, keys, close };
    },
    // J4: Enter on a URL in the command bar, then the page load's updates (title, favicon, progress, loading).
    async cenEnter({ origin, repeats = 3 } = {}) {
      const w = windowId();
      const enter = sink();
      const load = sink();
      for (let r = 0; r < repeats; r++) {
        await quiet(600);
        S().openPanel(w, "");
        const driver = await driverOf(panelId(w));
        driver.type(`${origin}/heavy?run=cen-${r}-${Date.now()}`);
        await sleep(600);
        const tab = activeId();
        P.reset();
        const ms = timed(() => driver.submit());
        await sleep(150);
        let rd = P.read();
        for (const k of SKIP) delete rd[k];
        enter.per.push(summary(rd, ms));
        merge(enter.stats, rd);
        P.reset();
        // Woken by the store, not polled: a polling timer would count among the app's timers.
        await untilStore((st) => !st.live[tab]?.isLoading, 15000);
        await sleep(1500);
        rd = P.read();
        for (const k of SKIP) delete rd[k];
        load.per.push(summary(rd, 0));
        merge(load.stats, rd);
      }
      return { enter, load };
    },
    // J3: a click on a sidebar row (what clickTab does) and the shortcuts (⌘1-9, ⌃Tab's next tab), between loaded tabs.
    async cenSwitch({ count = 10, gapMs = 300 } = {}) {
      const w = windowId();
      const s = S();
      const ids = tabsInView().filter((id) => !s.tabs[id].pinned).slice(0, count);
      const start = activeId();
      await quiet(800);
      const click = sink();
      for (const id of ids) {
        await action(() => {
          S().setSelection(w, []);
          S().activate(id);
        }, gapMs, click);
      }
      const shortcut = sink();
      for (let i = 0; i < count; i++) await action(run(i % 2 ? "nextTab" : "selectTab", i % 2 ? null : String(1 + (i % 5))), gapMs, shortcut);
      timed(() => S().activate(start));
      await quiet(800);
      return { click, shortcut };
    },
    // Sidebar hover: the pointer entering and leaving rows.
    async cenHover({ rows = 14, from = 0, gapMs = 150 } = {}) {
      await quiet(800);
      const hosts = P.findFibers("TabRow", 400).map(hostOf).filter((h) => h && typeof h.memoizedProps?.onMouseEnter === "function").slice(from, from + rows);
      if (hosts.length < 2) throw new Error(`only ${hosts.length} hoverable rows`);
      const out = sink();
      let prev = null;
      for (const h of hosts) {
        const before = prev;
        await action(() => {
          before?.memoizedProps.onMouseLeave?.({ nativeEvent: {} });
          h.memoizedProps.onMouseEnter({ nativeEvent: {} });
        }, gapMs, out);
        prev = h;
      }
      await action(() => prev.memoizedProps.onMouseLeave?.({ nativeEvent: {} }), gapMs, out);
      return out;
    },
    // J4's page-load updates in a background tab: its row only should render.
    async cenBgLoad({ origin, repeats = 2 } = {}) {
      const out = sink();
      for (let r = 0; r < repeats; r++) {
        await quiet(800);
        const s = S();
        const id = tabsInView().find((t) => t !== activeId() && !s.tabs[t].pinned && s.live[t]);
        if (!id) throw new Error("no loaded background tab");
        await action(() => S().navigate(id, `${origin}/heavy?run=cenbg-${r}-${Date.now()}`), 3500, out);
      }
      return out;
    },
  };
}

globalThis.nnBench = {
  names: Object.keys(scenarios),
  run: (name, options) => scenarios[name](options ?? {}),
};
return globalThis.nnBench.names;

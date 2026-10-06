#!/usr/bin/env node
// Micro-benchmarks for store-side work that scales with a profile's size, run in Node (V8's JIT: expect Hermes
// in the app to take several times longer). Each prints the median of repeated runs.
//
//   cd apps/browser && node --no-warnings --import ./src/test-loader.mjs scripts/perf/micro-bench.mjs [name…]
//
// Cases (all of them when no name is given):
//   entries        sidebar, strip and group entries of 500/1000-tab windows after a title or progress update
//   groupNames     a big group's automatic name after a progress or title update
//   suggest        omnibox pool rebuilds after a visit, with 25k/50k bookmarks (the longest 4 ms slice)
//   suggest-seed   omnibox keystrokes on js-bench's seed profile (seed.mjs: 5000 history entries, 200 tabs, 1000
//                  bookmarks); `suggest-seed=<query>` types another query. js-bench `typing` is what a key costs in the app.
//   suggest-keys   one keystroke at a time on the seed profile with all 200 tabs, the bar's actions and its known-hosts check (SUGGEST_BEFORE=1: the old code): typing "github.com/net" and "react native perf",
//                  ops (ops.mjs builtin calls) and time per key, cold first key and warm keys. `suggest-keys=<rounds>` repeats the
//                  sequences that many times with nothing printed (suggest-instr.mjs measures instructions that way).
//   counts         not a timing: how many builtin calls (string search, regexp, array, Map/Set…) the hot paths above
//                  make, counted exactly by ops.mjs, so it repeats to the digit on any machine. Prints one
//                  `counts.<case> <n>` line each and a final `COUNTS {json}` line that ratchet.mjs reads. A change that
//                  makes the work cheaper lowers these; ratchet.json holds the ceilings (docs/perf/README.md).
//   instr          the same hot paths repeated INSTR_ROUNDS times (default 10), with nothing printed: ratchet.mjs runs it
//                  under `/usr/bin/time -l node --predictable` with 0 and N rounds and divides the difference of the
//                  "instructions retired" lines (the CPU's own counter, no root needed on Apple silicon) by N.

const { useBrowser } = await import("../../src/store/browser.ts");
const { sidebarEntries, groupEntries } = await import("../../src/components/sidebar/entries.ts");
const { groupLabel } = await import("../../src/store/organize.ts");
const strip = await import("../../src/components/layout/stripGroups.ts");
await import("../../src/test-native-stub.mjs");
const core = await import("../../../../packages/core/src/index.ts");
const { buildSeed } = await import("./seed.mjs");
const { knownHosts } = await import("../../src/components/omnibox/knownHosts.ts");
const { readFileSync } = await import("node:fs");
const { countOps } = await import("./ops.mjs");

const S = () => useBrowser.getState();
const now = () => performance.now();
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const time = (fn, runs = 30) => {
  const out = [];
  for (let i = 0; i < runs; i++) {
    const t = now();
    fn(i);
    out.push(now() - t);
  }
  return median(out);
};
const report = (name, value, unit = "ms") => console.log(`${name.padEnd(52)} ${typeof value === "number" ? value.toFixed(3) : value} ${unit}`);

// One window with `count` tabs: every 10th pair a split, groups of 20 (one of `bigGroup` members), titled pages.
function bigSession(count, bigGroup = 0) {
  const tabs = {};
  const ids = [];
  const t0 = Date.now();
  for (let i = 0; i < count; i++) {
    const id = `t${i}`;
    const host = ["github.com", "x.com", "news.ycombinator.com", "en.wikipedia.org"][i % 4];
    tabs[id] = {
      id, windowId: "w", profileId: "default", url: `https://${host}/page/${i}`, title: `Page ${i} - ${host.split(".")[0]}`,
      favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, openerId: null,
      createdAt: t0 + i, lastActiveAt: t0 + i,
    };
    ids.push(id);
  }
  const groups = {};
  let at = 0;
  if (bigGroup) {
    groups.big = { id: "big", windowId: "w", profileId: "default", name: "", icon: null, color: null, collapsed: false, pinned: false, tabIds: ids.slice(0, bigGroup), createdAt: t0 };
    at = bigGroup;
  }
  for (let g = 0; at + 20 <= count && g < count / 40; g++, at += 40) {
    groups[`g${g}`] = { id: `g${g}`, windowId: "w", profileId: "default", name: "", icon: null, color: null, collapsed: g % 2 === 0, pinned: false, tabIds: ids.slice(at, at + 20), createdAt: t0 };
  }
  const splits = {};
  for (let i = 0; i + 1 < count; i += 10) splits[`s${i}`] = { id: `s${i}`, windowId: "w", tabIds: [ids[i], ids[i + 1]], orientation: "horizontal", sizes: [0.5, 0.5] };
  S().hydrate({
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    profileOrder: ["default"],
    windows: { w: { id: "w", profileId: "default", incognito: false, tabIds: ids, activeTabIds: { default: ids[5] }, sidebarOpen: true, frame: null, createdAt: t0 } },
    windowOrder: ["w"],
    tabs,
    groups,
    splits,
  });
  return ids;
}

// The suggestion code as it was before the keystroke hill-climb (SUGGEST_BEFORE=1): the frozen spec in packages/core, a known-hosts
// list and a list of actions made again on every key.
const BEFORE = process.env.SUGGEST_BEFORE === "1";
const suggestImpl = BEFORE ? await import("../../../../packages/core/src/suggest.reference.ts") : core;
// The command bar's actions (apps/browser/src/components/omnibox/actions.ts as of 0.2.27, a copy of what matters to ranking).
const BAR_ACTIONS = JSON.parse(readFileSync(new URL("./bar-actions.json", import.meta.url), "utf8"));

// js-bench's seed profile as the omnibox sees it: 5000 history entries, 1000 bookmarks, and every one of the 200 tabs.
function seedSource() {
  const seed = buildSeed("http://127.0.0.1:47817");
  const history = seed["history.json"].history.default;
  const tabs = seed["session.json"].tabs;
  const bookmarks = Object.values(seed["bookmarks.json"].bookmarks.nodes)
    .filter((n) => n.kind === "url")
    .map((n) => ({ url: n.url, title: n.title, favicon: n.favicon }));
  return { tabs, history, bookmarks };
}
// Everything one key of the command bar asks of this code: is the text a site this profile knows (Omnibox.tsx tabScope), the
// actions of the window, then the suggestions.
const historyHostsBefore = new WeakMap();
function hostsFor(source) {
  const state = (source.state ??= { tabs: Object.fromEntries(source.tabs.map((t) => [t.id, t])), history: { default: source.history } });
  if (!BEFORE) return knownHosts(state, "default");
  let hosts = [];
  for (const t of Object.values(state.tabs)) if (t.profileId === "default" && t.url) hosts.push(core.hostOf(t.url));
  let past = historyHostsBefore.get(state.history.default);
  if (!past) {
    const seen = new Set();
    for (const h of state.history.default) seen.add(core.hostOf(h.url));
    seen.delete("");
    historyHostsBefore.set(state.history.default, (past = [...seen]));
  }
  return hosts.concat(past);
}
function keystroke(source, q, at) {
  core.findScope(q, { engines: core.BUILT_IN_ENGINES, hosts: hostsFor(source) });
  const actions = BEFORE ? BAR_ACTIONS.map((a) => ({ ...a })) : BAR_ACTIONS;
  return suggestImpl.buildSuggestions(q, source, { now: at, actions });
}
// What the bar has computed before the first key: the pool and the history's hosts (the warm-up effect in useSuggestions).
function warm(source, at) {
  suggestImpl.prepareSuggestions(source, Infinity);
  hostsFor(source);
}
const KEY_SEQUENCES = { url: "github.com/net", phrase: "react native perf" };

const benches = {
  entries() {
    for (const count of [500, 1000]) {
      const ids = bigSession(count);
      let i = 0;
      report(`sidebar entries, ${count} tabs, after a title change`, time(() => {
        S().updateTab(ids[i++ % count], { title: `T${i}` });
        sidebarEntries(S(), "w");
      }));
      report(`sidebar entries, ${count} tabs, after a progress update`, time(() => {
        S().updateLive(ids[i++ % count], { progress: (i % 10) / 10 });
        sidebarEntries(S(), "w");
      }));
      report(`strip entries, ${count} tabs, after a title change`, time(() => {
        S().updateTab(ids[i++ % count], { title: `T${i}` });
        strip.stripEntries(S(), "w", "default");
      }));
      report(`strip entries, ${count} tabs, after a progress update`, time(() => {
        S().updateLive(ids[i++ % count], { progress: (i % 10) / 10 });
        strip.stripEntries(S(), "w", "default");
      }));
    }
    const ids = bigSession(1000, 500);
    let i = 0;
    report("group entries, 500 members, after a title change", time(() => {
      S().updateTab(ids[600 + (i++ % 300)], { title: `T${i}` });
      groupEntries(S(), "big");
    }));
  },

  groupNames() {
    for (const members of [500, 1000]) {
      const ids = bigSession(members + 100, members);
      let i = 0;
      report(`auto group name, ${members} members, after a progress update`, time(() => {
        S().updateLive(ids[i++ % members], { progress: (i % 10) / 10 });
        groupLabel(S(), S().groups.big);
      }));
      report(`auto group name, ${members} members, after an outside title change`, time(() => {
        S().updateTab(ids[members + (i++ % 100)], { title: `T${i}` });
        groupLabel(S(), S().groups.big);
      }));
      report(`auto group name, ${members} members, after a member title change`, time(() => {
        S().updateTab(ids[i++ % members], { title: `Page ${i} - github` });
        groupLabel(S(), S().groups.big);
      }));
    }
  },

  suggest() {
    const history = [];
    const t0 = Date.now();
    for (let i = 0; i < 5000; i++) history.push({ url: `https://h${i % 300}.com/page/${i}`, title: `History ${i}`, favicon: null, visits: 1 + (i % 7), lastVisit: t0 - i * 1000 });
    for (const count of [25_000, 50_000]) {
      const bookmarks = [];
      for (let i = 0; i < count; i++) bookmarks.push({ url: `https://b${i % 900}.com/bm/${i}`, title: `Bookmark ${i}`, favicon: null });
      const source = { tabs: [], history, bookmarks };
      core.prepareSuggestions(source, Infinity);
      core.buildSuggestions("b", source);
      // A visit replaces the history array (one entry moved to the front): the pool is rebuilt.
      const slices = [];
      let h = history;
      for (let k = 0; k < 5; k++) {
        h = [{ ...h[k + 1], lastVisit: Date.now() }, ...h.filter((_, j) => j !== k + 1)];
        const next = { tabs: [], history: h, bookmarks };
        let done = false;
        while (!done) {
          const t = now();
          done = core.prepareSuggestions(next, Date.now() + 4);
          slices.push(now() - t);
        }
      }
      report(`suggestions: longest 4 ms slice after a visit, ${count / 1000}k bookmarks`, Math.max(...slices));
      report(`suggestions: slices per rebuild, ${count / 1000}k bookmarks`, slices.length / 5, "slices");
    }
  },

  "suggest-seed"(query = "github.com/facebook/react/pull") {
    const seed = buildSeed("http://127.0.0.1:47817");
    const history = seed["history.json"].history.default;
    const tabs = seed["session.json"].tabs.filter((t) => t.profileId === "default");
    const bookmarks = Object.values(seed["bookmarks.json"].bookmarks.nodes)
      .filter((n) => n.kind === "url")
      .map((n) => ({ url: n.url, title: n.title, favicon: n.favicon }));
    const source = { tabs, history, bookmarks };
    let t = now();
    core.prepareSuggestions(source, Infinity);
    report("suggestions on the seed profile: prepare (cold)", now() - t);
    const rounds = [];
    for (let r = 0; r < 20; r++) {
      const keys = [];
      for (let i = 1; i <= query.length; i++) {
        t = now();
        core.buildSuggestions(query.slice(0, i), source, { now: Date.now() });
        keys.push(now() - t);
      }
      rounds.push(keys);
    }
    const perKey = rounds.slice(5).flat();
    report(`suggestions on the seed profile: keystroke median (${query.length} keys × 15 warm rounds)`, median(perKey));
    report("suggestions on the seed profile: slowest warm keystroke", Math.max(...perKey));
    report("suggestions on the seed profile: first round, all keys", rounds[0].reduce((a, b) => a + b, 0));
  },

  "suggest-keys"(rounds) {
    const source = seedSource();
    const at = Date.now();
    warm(source, at);
    const type = (query) => {
      for (let i = 1; i <= query.length; i++) keystroke(source, query.slice(0, i), at);
    };
    if (rounds !== undefined) {
      for (let r = 0; r < Number(rounds); r++) for (const q of Object.values(KEY_SEQUENCES)) type(q);
      return;
    }
    for (const [name, query] of Object.entries(KEY_SEQUENCES)) {
      for (let r = 0; r < 5; r++) type(query);
      const perKey = [];
      for (let r = 0; r < 40; r++) {
        for (let i = 1; i <= query.length; i++) {
          const t = now();
          keystroke(source, query.slice(0, i), at);
          perKey.push(now() - t);
        }
      }
      const { total } = countOps(() => type(query));
      report(`suggest-keys.${name} ("${query}"): ops per key`, total / query.length, "calls");
      report(`suggest-keys.${name}: median key`, median(perKey));
      report(`suggest-keys.${name}: whole sequence`, perKey.slice(-query.length).reduce((a, b) => a + b, 0));
    }
  },

  instr() {
    const seed = buildSeed("http://127.0.0.1:47817");
    const history = seed["history.json"].history.default;
    const tabs = seed["session.json"].tabs.filter((t) => t.profileId === "default");
    const bookmarks = Object.values(seed["bookmarks.json"].bookmarks.nodes)
      .filter((n) => n.kind === "url")
      .map((n) => ({ url: n.url, title: n.title, favicon: n.favicon }));
    const source = { tabs, history, bookmarks };
    const at = Date.now();
    const ids = bigSession(1000, 500);
    const rounds = Number(process.env.INSTR_ROUNDS ?? 10);
    for (let r = 0; r < rounds; r++) {
      for (const q of ["github.com/facebook/react/pull", "react native performance"]) for (let i = 1; i <= q.length; i++) core.buildSuggestions(q.slice(0, i), source, { now: at });
      S().updateTab(ids[600 + r], { title: `T${r}` });
      sidebarEntries(S(), "w");
      strip.stripEntries(S(), "w", "default");
      groupEntries(S(), "big");
      S().updateTab(ids[r], { title: `Page ${r} - github` });
      groupLabel(S(), S().groups.big);
    }
  },

  counts() {
    const out = {};
    const add = (name, fn) => {
      const { total, by } = countOps(fn);
      out[name] = total;
      report(`counts.${name}`, total, "calls");
      if (process.env.COUNTS_DETAIL) console.log(`    ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    };

    // The omnibox on the seed profile (5000 history, 200 tabs, 1000 bookmarks): the pool, then each keystroke of the
    // js-bench `typing` query. Fixed `now` so frecency and recency don't depend on the clock.
    const seed = buildSeed("http://127.0.0.1:47817");
    const history = seed["history.json"].history.default;
    const tabs = seed["session.json"].tabs.filter((t) => t.profileId === "default");
    const bookmarks = Object.values(seed["bookmarks.json"].bookmarks.nodes)
      .filter((n) => n.kind === "url")
      .map((n) => ({ url: n.url, title: n.title, favicon: n.favicon }));
    const source = { tabs, history, bookmarks };
    const at = Date.now();
    add("suggest.prepare", () => core.prepareSuggestions(source, Infinity));
    const query = "github.com/facebook/react/pull";
    add("suggest.firstKey", () => core.buildSuggestions(query.slice(0, 1), source, { now: at }));
    add("suggest.typeAll", () => {
      for (let i = 2; i <= query.length; i++) core.buildSuggestions(query.slice(0, i), source, { now: at });
    });
    // The same keys with all 200 tabs (the seed's tabs of the work profile too), a typed URL and a typed phrase.
    const everyTab = seedSource();
    warm(everyTab, at);
    for (const [name, q] of Object.entries(KEY_SEQUENCES)) {
      add(`suggest.keys.${name}`, () => {
        for (let i = 1; i <= q.length; i++) keystroke(everyTab, q.slice(0, i), at);
      });
    }
    add("suggest.typeAllWords", () => {
      for (const q of ["react native performance", "react native performance hermes"]) for (let i = 1; i <= q.length; i++) core.buildSuggestions(q.slice(0, i), source, { now: at });
    });

    // Sidebar, strip and group entries of a 1000-tab window after one title or progress update.
    for (const count of [500, 1000]) {
      const ids = bigSession(count);
      const warm = () => {
        sidebarEntries(S(), "w");
        strip.stripEntries(S(), "w", "default");
      };
      warm();
      S().updateTab(ids[7], { title: "T7" });
      add(`entries.sidebar${count}.afterTitle`, () => sidebarEntries(S(), "w"));
      add(`entries.strip${count}.afterTitle`, () => strip.stripEntries(S(), "w", "default"));
      warm();
      S().updateLive(ids[11], { progress: 0.5 });
      add(`entries.sidebar${count}.afterProgress`, () => sidebarEntries(S(), "w"));
      add(`entries.strip${count}.afterProgress`, () => strip.stripEntries(S(), "w", "default"));
    }
    const ids = bigSession(1000, 500);
    groupEntries(S(), "big");
    S().updateTab(ids[600], { title: "T600" });
    add("entries.group500.afterTitle", () => groupEntries(S(), "big"));
    groupLabel(S(), S().groups.big);
    S().updateLive(ids[5], { progress: 0.5 });
    add("groupLabel.500.afterProgress", () => groupLabel(S(), S().groups.big));
    S().updateTab(ids[6], { title: "Page 6 - github" });
    add("groupLabel.500.afterMemberTitle", () => groupLabel(S(), S().groups.big));
    console.log(`COUNTS ${JSON.stringify(out)}`);
  },
};

// `name` or `name=argument`.
const wanted = new Map(process.argv.slice(2).map((a) => [a.split("=")[0], a.includes("=") ? a.slice(a.indexOf("=") + 1) : undefined]));
for (const name of wanted.keys()) if (!(name in benches)) throw new Error(`no case ${name}; cases: ${Object.keys(benches).join(", ")}`);
for (const [name, run] of Object.entries(benches)) if (!wanted.size || wanted.has(name)) await run(wanted.get(name));


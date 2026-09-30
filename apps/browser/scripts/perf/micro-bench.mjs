#!/usr/bin/env node
// Micro-benchmarks for store-side work that scales with a profile's size, run in Node (V8's JIT: expect Hermes
// in the app to take several times longer). Each prints the median of repeated runs.
//
//   cd apps/browser && node --no-warnings --import ./src/store/test-loader.mjs scripts/perf/micro-bench.mjs [name…]

const { useBrowser } = await import("../../src/store/browser.ts");
const { sidebarEntries, groupEntries } = await import("../../src/components/sidebar/entries.ts");
const { groupLabel } = await import("../../src/store/organize.ts");
const strip = await import("../../src/components/layout/stripGroups.ts");
const favicons = await import("../../src/lib/favicons.ts");
const { webviews } = await import("../../src/lib/webviews.ts");
const stub = await import("../../src/store/test-native-stub.mjs");
const core = await import("../../../../packages/core/src/index.ts");

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

  async favicons() {
    const icons = {};
    const pages = {};
    const hosts = {};
    const t0 = Date.now();
    for (let i = 0; i < 50_000; i++) icons[`i${i}`] = { uri: `file:///icons/${i}.png`, src: `https://h${i}.com/favicon.ico`, at: t0 };
    for (let i = 0; i < 5000; i++) pages[`https://h${i}.com/p`] = `i${i}`;
    for (let i = 0; i < 20_000; i++) hosts[`h${i}.com`] = `i${i}`;
    stub.docs.set("favicons-default.json", JSON.stringify({ icons, pages, hosts }));
    const ids = bigSession(10);
    let n = 0;
    webviews.set(ids[0], { downloadFavicon: async (src) => ({ uri: `file:///icons/new${n++}.png` }) });
    const out = [];
    for (let k = 0; k < 20; k++) {
      S().updateTab(ids[0], { url: `https://new${k}.com/p` });
      const t = now();
      favicons.noteFavicon(ids[0], `https://new${k}.com/favicon.ico`);
      await new Promise((r) => setTimeout(r, 0));
      out.push(lastUpdateEnd - t);
    }
    report("favicon index: record a new icon (50k icons)", median(out));
    {
      // 50k bookmarks with favicons, as compaction reads every favicon source.
      const nodes = { ...S().bookmarks.nodes };
      for (let i = 0; i < 50_000; i++) nodes[`bm${i}`] = { kind: "url", id: `bm${i}`, parentId: "x", title: "", url: `https://b${i}.com/`, favicon: `https://b${i}.com/favicon.ico`, addedAt: 0 };
      useBrowser.setState({ bookmarks: { ...S().bookmarks, nodes } });
      const t = now();
      favicons.flushFavicons();
      report("favicon index: first save after launch (compacts)", now() - t);
      for (let i = 0; i < 500; i++) {
        S().updateTab(ids[0], { url: `https://churn${i}.com/p` });
        favicons.noteFavicon(ids[0], `https://new0.com/favicon.ico`);
      }
      const t2 = now();
      favicons.flushFavicons();
      report("favicon index: save that compacts again (500 changes later)", now() - t2);
    }
    report("favicon index: record a known icon for a new page", time((i) => {
      S().updateTab(ids[0], { url: `https://seen${i}.com/p` });
      favicons.noteFavicon(ids[0], `https://new0.com/favicon.ico`);
    }, 20));
    report("favicon index: save (serialize + write)", time((i) => {
      S().updateTab(ids[0], { url: `https://save${i}.com/p` });
      favicons.noteFavicon(ids[0], `https://new0.com/favicon.ico`);
      favicons.flushFavicons();
    }, 10));
    const index = favicons.useFavicons.getState().profiles.default;
    report("favicon index: icons kept", Object.keys(index.icons).length, "icons");
    report("favicon index: hosts kept", Object.keys(index.hosts).length, "hosts");
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
};

let lastUpdateEnd = 0;
{
  const original = favicons.useFavicons.setState;
  favicons.useFavicons.setState = (...args) => {
    original(...args);
    lastUpdateEnd = now();
  };
}

const wanted = process.argv.slice(2);
for (const [name, run] of Object.entries(benches)) if (!wanted.length || wanted.includes(name)) await run();


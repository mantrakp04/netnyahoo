// A large, deterministic saved session for the JS benchmark: 200 tabs in two profiles (pinned tiles,
// groups, a long list), 5000 history entries and 1000 bookmarks. Tab pages point at the benchmark's
// local server, so a tab that wakes never leaves the machine.
//
//   node seed.mjs <data dir> <server origin> [appVersion]

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (list) => list[Math.floor(rand() * list.length)];

const HOSTS = [
  "github.com", "en.wikipedia.org", "news.ycombinator.com", "developer.apple.com", "stackoverflow.com", "www.youtube.com",
  "docs.google.com", "mail.google.com", "www.nytimes.com", "www.theverge.com", "react.dev", "reactnative.dev", "nodejs.org",
  "developer.mozilla.org", "www.figma.com", "linear.app", "www.notion.so", "twitter.com", "www.reddit.com", "arstechnica.com",
];
const WORDS = [
  "performance", "react", "native", "hermes", "macos", "browser", "sidebar", "profile", "history", "bookmark", "render",
  "commit", "memo", "selector", "store", "zustand", "layout", "animation", "timing", "chromium", "engine", "window", "tab",
  "split", "group", "pinned", "search", "suggestion", "omnibox", "keyboard", "shortcut", "theme", "color", "download",
];
const words = (n) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
const title = (n) => words(n).replace(/^\w/, (c) => c.toUpperCase());

export function buildSeed(origin, appVersion = "") {
  const now = Date.now();
  const profiles = {
    default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 },
    work: { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 },
  };
  const windowId = "w-bench";
  const tabs = [];
  const groups = [];
  const tab = (profileId, i, extra = {}) => {
    const t = {
      id: `t-${profileId}-${i}`,
      windowId,
      profileId,
      url: `${origin}/p/${profileId}-${i}`,
      title: title(3 + (i % 5)),
      favicon: null,
      pinned: false,
      muted: false,
      zoom: 1,
      customTitle: null,
      customIcon: null,
      pinnedUrl: null,
      openerId: null,
      createdAt: now - (400 - i) * 60_000,
      lastActiveAt: now - (400 - i) * 60_000,
      ...extra,
    };
    tabs.push(t);
    return t;
  };
  const layoutProfile = (profileId, count, pinned, groupSizes) => {
    const ids = [];
    let i = 0;
    for (; i < pinned; i++) ids.push(tab(profileId, i, { pinned: true, pinnedUrl: `${origin}/p/${profileId}-${i}` }).id);
    for (const [g, size] of groupSizes.entries()) {
      const members = [];
      for (let k = 0; k < size; k++, i++) members.push(tab(profileId, i).id);
      groups.push({
        id: `g-${profileId}-${g}`, windowId, profileId, name: title(2), icon: null, color: pick(["blue", "green", "orange"]),
        collapsed: false, pinned: false, tabIds: members, createdAt: now,
      });
      ids.push(...members);
    }
    for (; i < count; i++) ids.push(tab(profileId, i).id);
    return ids;
  };
  const personal = layoutProfile("default", 158, 8, [5, 5]);
  const work = layoutProfile("work", 42, 4, [4]);
  const active = { default: personal[20], work: work[10] };
  for (const [p, id] of Object.entries(active)) tabs.find((t) => t.id === id).lastActiveAt = now - 1000 * (p === "default" ? 1 : 2);

  const session = {
    version: 2,
    profiles,
    profileOrder: ["default", "work"],
    orphanedProfileData: [],
    settings: { searchSuggestions: false, warnBeforeClosingLastTab: false, warnBeforeClosingWindow: false },
    windows: [
      {
        id: windowId, profileId: "default", incognito: false, tabIds: [...personal, ...work], activeTabIds: active,
        sidebarOpen: true, frame: [80, 80, 1440, 900], createdAt: now,
      },
    ],
    windowOrder: [windowId],
    focusedWindowId: windowId,
    tabs,
    groups,
    splits: [],
    closedTabs: [],
    closedWindows: [],
  };

  const entries = [];
  const seen = new Set();
  while (entries.length < 5000) {
    const host = pick(HOSTS);
    const path = host === "github.com"
      ? `/${pick(["facebook", "microsoft", "expo", "nodejs"])}/${pick(["react", "react-native", "hermes", "node"])}/${pick(["pull", "issues"])}/${Math.floor(rand() * 40000)}`
      : `/${words(2).replace(/ /g, "/")}/${Math.floor(rand() * 10000)}`;
    const url = `https://${host}${path}`;
    if (seen.has(url)) continue;
    seen.add(url);
    const visits = 1 + Math.floor(rand() ** 3 * 40);
    const last = now - Math.floor(rand() * 90 * 86_400_000);
    const times = Array.from({ length: Math.min(visits, 50) }, (_, k) => last - k * 3_600_000).reverse();
    entries.push({ url, title: title(4 + Math.floor(rand() * 6)), favicon: `https://${host}/favicon.ico`, visits, lastVisit: last, visitTimes: times });
  }
  entries.sort((a, b) => b.lastVisit - a.lastVisit);
  const history = { version: 2, history: { default: entries, work: entries.slice(0, 800) } };

  const nodes = {};
  const roots = {};
  let n = 0;
  const folder = (parentId, name) => {
    const id = `bm-${n++}`;
    nodes[id] = { kind: "folder", id, parentId, title: name, children: [], addedAt: now };
    if (parentId) nodes[parentId].children.push(id);
    return id;
  };
  for (const profileId of ["default", "work"]) {
    const bar = folder(null, "Bookmarks Bar");
    const other = folder(null, "Other Bookmarks");
    roots[profileId] = { bar, other };
    const count = profileId === "default" ? 900 : 100;
    const folders = [bar, other, ...Array.from({ length: 20 }, (_, k) => folder(k % 2 ? bar : other, title(2)))];
    for (let k = 0; k < count; k++) {
      const parentId = k < 12 ? bar : pick(folders);
      const id = `bm-${n++}`;
      const e = entries[Math.floor(rand() * entries.length)];
      nodes[id] = { kind: "url", id, parentId, title: e.title, url: e.url, favicon: null, addedAt: now - k * 1000 };
      nodes[parentId].children.push(id);
    }
  }
  const bookmarks = { version: 2, bookmarks: { nodes, roots } };

  return {
    "session.json": session,
    "history.json": history,
    "bookmarks.json": bookmarks,
    "downloads.json": { version: 2, downloads: [] },
    "release-notes.json": { version: 1, lastVersion: appVersion, pending: null },
    "onboarding.json": { version: 1, completedAt: now },
    "perf-probe": "",
  };
}

export function writeSeed(dir, origin, appVersion) {
  mkdirSync(dir, { recursive: true });
  for (const [name, value] of Object.entries(buildSeed(origin, appVersion))) {
    writeFileSync(join(dir, name), typeof value === "string" ? value : JSON.stringify(value));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, origin = "http://127.0.0.1:47817", version = ""] = process.argv.slice(2);
  if (!dir) throw new Error("usage: node seed.mjs <data dir> [server origin] [app version]");
  writeSeed(dir, origin, version);
}

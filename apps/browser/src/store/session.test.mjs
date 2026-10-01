// What survives a quit, a relaunch and a closed window: session.json, history.json and pinned tabs.
import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("./browser.ts");
const model = await import("./model.ts");
const { historyDocument } = await import("./history.ts");
const { flushPersistence, loadSession, startPersistence } = await import("../lib/persist.ts");
const stub = await import("../test-native-stub.mjs");

const S = () => useBrowser.getState();
const reset = () => S().hydrate({});
const view = (w) => model.viewTabIds(S(), w).map((id) => S().tabs[id].url);
const active = (w) => model.activeTabId(S(), w);

let clock = Date.now();
function at(fn) {
  const now = Date.now;
  Date.now = () => (clock += 1000);
  try {
    return fn();
  } finally {
    Date.now = now;
  }
}
const select = (id) => at(() => S().activate(id));

function windowWith(...hosts) {
  const w = at(() => S().createWindow({ url: `${hosts[0]}.com` }));
  const ids = [model.viewTabIds(S(), w)[0]];
  for (const h of hosts.slice(1)) ids.push(at(() => S().newTab(w, { url: `${h}.com` })));
  return { w, ids };
}

test("v1 session migrates to v2 and round-trips", () => {
  stub.docs.clear();
  stub.docs.set("session.json", JSON.stringify({
    version: 1,
    tabs: [
      { url: "https://b.com", title: "B", favicon: null, pinned: true, muted: false, zoom: 1 },
      { url: "https://a.com", title: "A", favicon: null, pinned: false, muted: true, zoom: 1.5 },
    ],
    activeIndex: 1, closedUrls: ["https://gone.com"],
    history: [{ url: "https://a.com", title: "A", favicon: null, visits: 2, lastVisit: 1 }],
    bookmarks: [{ url: "https://a.com", title: "A", favicon: null }],
    sidebarOpen: false, showFullUrl: true,
  }));
  const { data, migrated } = loadSession();
  assert.ok(migrated);
  S().hydrate(data);
  const w = S().windowOrder[0];
  assert.equal(S().windows[w].sidebarOpen, false);
  assert.equal(S().settings.showFullUrl, true);
  const shown = S().tabs[active(w)];
  assert.equal(shown.url, "https://a.com");
  assert.equal(shown.zoom, 1.5);
  assert.equal(shown.muted, true);
  assert.ok(shown.navigation, "active tab loads");
  assert.equal(S().tabs[model.viewTabIds(S(), w)[0]].navigation, null, "others lazy");
  assert.equal(S().closedTabs[0].tab.url, "https://gone.com");
  assert.equal(S().history.default.length, 1);
  const bar = S().bookmarks.nodes[S().bookmarks.roots.default.bar];
  assert.equal(S().bookmarks.nodes[bar.children[0]].url, "https://a.com");
  assert.ok(stub.docs.get("session.v1.backup.json"));
});

test("hydrate repairs dangling references", () => {
  S().hydrate({
    profiles: { default: { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 } },
    windows: {
      w1: { id: "w1", profileId: "gone", incognito: false, tabIds: ["t1", "missing"], activeTabIds: { gone: "missing" }, sidebarOpen: true, frame: null, createdAt: 0 },
      w2: { id: "w2", profileId: "default", incognito: false, tabIds: [], activeTabIds: {}, sidebarOpen: true, frame: null, createdAt: 0 },
    },
    tabs: {
      t1: { id: "t1", windowId: "w1", profileId: "default", url: "https://a.com", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 },
      t2: { id: "t2", windowId: "nowhere", profileId: "default", url: "https://b.com", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, navigation: null, openerId: null, createdAt: 0, lastActiveAt: 0 },
    },
    groups: { g: { id: "g", windowId: "w1", profileId: "default", name: "", icon: null, color: null, collapsed: false, pinned: false, tabIds: ["missing"], createdAt: 0 } },
  });
  assert.deepEqual(S().windowOrder, ["w1"]);
  assert.equal(S().windows.w1.profileId, "default");
  assert.equal(active("w1"), "t1");
  assert.equal(S().tabs.t2, undefined);
  assert.deepEqual(S().groups, {});
});

// 0.2.12: Reopen Closed Window lost each tab's Back and Forward.
test("a reopened window's tabs wake with their back/forward list", () => {
  reset();
  S().createWindow({ url: "keep.com" });
  const w = S().createWindow({ url: "a.com" });
  const [a] = S().windows[w].tabIds;
  const b = S().newTab(w, { url: "b.com", background: true });
  const lazy = S().newTab(w, { url: "c.com", background: true, snapshot: { url: "https://c.com" } });
  S().updateTab(lazy, { navigation: null });
  S().closeWindow(w);
  S().reopenClosedWindow();
  const w2 = S().windowOrder.at(-1);
  const [ra, rb, rc] = S().windows[w2].tabIds.map((id) => S().tabs[id]);
  assert.equal(ra.adoptId, `restore:${a}`, "the shown tab loads with its history");
  assert.equal(rb.wakeAdoptId, `restore:${b}`, "the others keep it until they wake");
  assert.equal(rb.navigation, null);
  assert.equal(rc.wakeAdoptId, undefined, "a tab that never loaded has none");
  S().activate(rb.id);
  assert.equal(S().tabs[rb.id].adoptId, `restore:${b}`);
  assert.equal(S().tabs[rb.id].wakeAdoptId, undefined);
});

test("profiles sharing data still share it after a save and reload", () => {
  reset();
  const a = S().createProfile({ name: "A" });
  const b = S().createProfile({ name: "B", shareWith: a });
  S().recordVisit(b, "https://a.com/", "A", null, true);
  const saved = JSON.parse(JSON.stringify({ profiles: S().profiles, profileOrder: S().profileOrder, history: S().history, bookmarks: S().bookmarks }));
  reset();
  assert.equal(model.engineProfile(b), b, "registry follows the loaded profiles");
  S().hydrate(saved);
  assert.equal(model.engineProfile(b), a);
  assert.equal(S().history[a], S().history[b]);
  assert.deepEqual(S().bookmarks.roots[a], S().bookmarks.roots[b]);
});

test("a finished load is one visit; its title and icon updates refresh the entry", () => {
  reset();
  const w = S().createWindow({ url: "https://a.com/" });
  const tab = model.viewTabIds(S(), w)[0];
  const entry = (url) => S().history.default?.find((h) => h.url === url);
  const report = (url, title, isLoading) => S().navigated(tab, { url, title }, { isLoading, canGoBack: false, canGoForward: false, themeColor: null });
  report("https://a.com/", "", true);
  assert.equal(entry("https://a.com/"), undefined, "a load in progress isn't a visit");
  report("https://a.com/", "A", false);
  assert.equal(entry("https://a.com/").visits, 1);
  const before = S();
  report("https://a.com/", "A", false);
  assert.equal(S(), before, "a repeated report changes nothing");
  report("https://a.com/", "A, retitled", false);
  assert.deepEqual([entry("https://a.com/").visits, entry("https://a.com/").title], [1, "A, retitled"]);
  S().faviconChanged(tab, "https://a.com/icon.png");
  assert.equal(S().tabs[tab].favicon, "https://a.com/icon.png");
  assert.equal(entry("https://a.com/").favicon, "https://a.com/icon.png");
  report("https://b.com/", "B", false);
  report("https://a.com/", "A", false);
  assert.equal(entry("https://a.com/").visits, 2, "coming back is another visit");
  S().navigate(tab, "netnyahoo://history");
  report("https://a.com/", "A", false);
  assert.equal(entry("https://a.com/").visits, 3, "back from an app page (no engine report in between) is another visit");
});

// history.json is written by a hand-rolled serializer that reuses unchanged entries; it must match JSON.stringify.
test("history.json is byte for byte JSON.stringify's, visit after visit", () => {
  const doc = () => historyDocument(2, S().history);
  const reference = () => JSON.stringify({ version: 2, history: S().history });
  reset();
  S().createProfile({ name: "Work" });
  const work = S().profileOrder[1];
  S().recordVisit("default", "https://a.com/", 'Quotes " and \\ and   and ✨', null, true);
  S().recordVisit("default", "https://b.com/", "B", "https://b.com/favicon.ico", true);
  S().recordVisit(work, "https://c.com/", "", null, true);
  assert.equal(doc(), reference());
  S().recordVisit("default", "https://a.com/", "A again", null, true);
  assert.equal(doc(), reference(), "a changed entry is serialized anew");
  S().recordVisit("default", "https://b.com/", "B", "https://b.com/new.ico");
  assert.equal(doc(), reference(), "a favicon update is serialized anew");
  S().removeHistory("default", ["https://b.com/"]);
  S().clearHistory(work);
  assert.equal(doc(), reference());
  const odd = {
    123: [{ url: "https://x.com/", title: "X", favicon: null, visits: 3, lastVisit: 5 }],
    default: [{ url: "https://z.com/", title: "Z", favicon: undefined, visits: 2, lastVisit: 2, visitTimes: undefined }],
    broken: [null, undefined, 3, "x"],
  };
  assert.equal(historyDocument(2, odd), JSON.stringify({ version: 2, history: odd }), "numeric keys, optional fields, junk");
});

// Pinned tabs (0.2.2): ⌘W unloads a pinned tab instead of closing it, and a closed window parks its pins for the
// profile's next window.

test("⌘W on a pinned tab unloads its page; the tile stays with its title, icon and pinned URL", () => {
  reset();
  const { w, ids: [p, a] } = windowWith("mail", "a");
  S().togglePin(p);
  S().updateTab(p, { title: "Inbox", favicon: "data:mail" });
  select(p);
  S().closeTab(p);
  const tile = S().tabs[p];
  assert.ok(tile, "the pinned tab still exists");
  assert.equal(tile.pinned, true);
  assert.equal(tile.url, "https://mail.com");
  assert.equal(tile.title, "Inbox");
  assert.equal(tile.favicon, "data:mail");
  assert.equal(tile.navigation, null, "no page: its web view unmounts");
  assert.equal(tile.adoptId, undefined);
  assert.equal(tile.unloaded, true);
  assert.deepEqual(view(w), ["https://mail.com", "https://a.com"]);
  assert.equal(active(w), a);
});

// 0.2.8: with a pinned tab open, holding ⌘W alternated forever between a New Tab page and the pinned site.
test("holding ⌘W over pinned tiles ends by closing the window: no unloaded page wakes", () => {
  reset();
  const { w, ids: [x] } = windowWith("x", "a");
  S().togglePin(x);
  select(x);
  const wakes = [];
  for (let i = 0; i < 10 && S().windows[w]; i++) {
    const before = S().tabs[x].navigation;
    S().closeTab(active(w));
    if (S().windows[w] && !before && S().tabs[x].navigation) wakes.push(i);
  }
  assert.deepEqual(wakes, [], "x.com never loads again");
  assert.equal(S().windows[w], undefined, "the window closed, as in Dia");
  assert.deepEqual(S().parkedPins.default.tabs.map((t) => t.id), [x], "the tile waits for the profile's next window");
});

const sidebar = (w) =>
  model.viewTabIds(S(), w).filter((id) => model.inPinnedContainer(S(), id)).map((id) => {
    const t = S().tabs[id];
    const g = Object.values(S().groups).find((g) => g.tabIds.includes(id));
    return `${g ? `${g.name}/` : ""}${t.url}${t.navigation || t.adoptId ? " (loaded)" : ""}`;
  });

function pinnedWindow() {
  const { w, ids: [mail, docs, jira, wiki, a] } = windowWith("mail", "docs", "jira", "wiki", "a");
  S().togglePin(mail);
  S().togglePin(docs);
  const work = S().groupTabs([jira, wiki], { pinned: true });
  S().updateGroup(work, { name: "Work" });
  select(a);
  select(mail);
  return { w, mail, work };
}
const PINS = ["https://mail.com", "https://docs.com", "Work/https://jira.com", "Work/https://wiki.com"];

// 0.2.8: closing a window took its pinned tabs with it, so the next window had none.
test("⌘W until the window closes, then ⌘N: the pinned tabs and pinned groups are back, in order, unloaded", () => {
  reset();
  const { w, mail, work } = pinnedWindow();
  assert.deepEqual(sidebar(w), ["https://mail.com (loaded)", "https://docs.com (loaded)", "Work/https://jira.com (loaded)", "Work/https://wiki.com (loaded)"]);
  for (let i = 0; i < 12 && S().windows[w]; i++) S().closeTab(active(w));
  assert.equal(S().windows[w], undefined, "the window closed");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS, "same tiles, same order, the group still pinned, nothing loaded");
  assert.equal(S().tabs[active(n)].url, "", "the new window shows a New Tab page");
  assert.equal(S().tabs[mail].windowId, n, "same tab id (its key in sync)");
  assert.equal(S().groups[work].pinned, true);
  assert.deepEqual(S().parkedPins, {}, "the park is empty");
  const n2 = S().createWindow();
  assert.deepEqual(sidebar(n2), []);
});

test("⇧⌘T after the close, then ⌘N: no second set of pinned tabs", () => {
  reset();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  S().reopenClosed(null);
  const restored = S().ui.focusedWindowId;
  assert.notEqual(restored, w);
  assert.deepEqual(sidebar(restored), PINS, "the reopened window has them");
  assert.deepEqual(model.viewTabIds(S(), restored).filter((id) => !model.inPinnedContainer(S(), id)).map((id) => S().tabs[id].url), ["https://a.com"]);
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), [], "⌘N: none again");
  assert.equal(Object.values(S().tabs).filter((t) => t.url === "https://mail.com").length, 1);
});

test("quit and relaunch after the window closed: the next window has the pinned tabs, unloaded", () => {
  stub.docs.clear();
  reset();
  const stop = startPersistence();
  const { w } = pinnedWindow();
  S().closeWindow(w);
  flushPersistence();
  stop();
  S().hydrate(loadSession().data);
  assert.equal(S().windowOrder.length, 0, "no window restored");
  const n = S().createWindow();
  assert.deepEqual(sidebar(n), PINS);
});
